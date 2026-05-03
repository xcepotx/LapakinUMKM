"""Auth routes: register, login, logout, me, Google OAuth, forgot/reset password."""
import uuid
import secrets
import os
from datetime import datetime, timezone, timedelta

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from deps import (
    db, logger, hash_password, verify_password, create_access_token
)
from deps import require_user
from models import RegisterIn, LoginIn, ForgotIn, ResetIn
from email_service import send_email
from email_templates import welcome as welcome_email, password_reset as reset_email
from pydantic import BaseModel
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

router = APIRouter()

class GoogleIdTokenIn(BaseModel):
    credential: str

def _public_app_url() -> str:
    return os.environ.get("PUBLIC_APP_URL", "https://lapakin.my.id").rstrip("/")

def _parse_iso_datetime(value):
    if not value:
        return None

    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None

async def _upsert_google_user(email: str, name: str = "", picture: str = "") -> dict:
    now = datetime.now(timezone.utc).isoformat()
    user = await db.users.find_one({"email": email})

    defaults = {
        "tier": "free",
        "trial": False,
        "trial_used": False,
        "trial_started_at": None,
        "trial_expires_at": None,
        "trial_expired": False,
        "trial_expired_at": None,
        "subscription_plan_id": None,
        "subscription_cycle": None,
        "subscription_expires_at": None,
    }

    if user:
        update = {
            "picture": picture or user.get("picture", ""),
            "updated_at": now,
        }

        if user.get("auth_provider") == "email":
            update["auth_provider"] = "both"
        elif not user.get("auth_provider"):
            update["auth_provider"] = "google"

        if not user.get("name"):
            update["name"] = name or email.split("@")[0]

        for key, value in defaults.items():
            if key not in user or user.get(key) is None:
                update[key] = value

        await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
        return await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id,
        "email": email,
        "name": name or email.split("@")[0],
        "picture": picture or "",
        "auth_provider": "google",
        "shop_id": None,
        "created_at": now,
        **defaults,
    }

    await db.users.insert_one(doc)
    return doc


async def _accept_pending_team_invite(user: dict) -> dict:
    """Attach user to a shop when their email has a pending team invite."""
    if not user or user.get("shop_id"):
        return user

    email = (user.get("email") or "").lower().strip()
    if not email:
        return user

    invite = await db.team_invites.find_one(
        {"email": email, "status": "pending"},
        {"_id": 0},
        sort=[("created_at", 1)],
    )
    if not invite:
        return user

    shop = await db.shops.find_one({"shop_id": invite.get("shop_id")}, {"_id": 0})
    if not shop:
        await db.team_invites.update_one(
            {"invite_id": invite["invite_id"]},
            {"$set": {
                "status": "revoked",
                "revoked_reason": "shop_not_found",
                "revoked_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        return user

    try:
        from tiers import get_limits, get_tier, is_unlimited
        owner = await db.users.find_one({"user_id": shop.get("owner_user_id")}, {"_id": 0}) or {}
        tier = get_tier(owner)
        limit = get_limits(tier).get("max_users_per_shop", 1)
        current_count = await db.users.count_documents({"shop_id": shop["shop_id"]})
        if not is_unlimited(limit) and current_count >= limit:
            logger.warning("pending team invite blocked by tier limit: email=%s shop=%s", email, shop["shop_id"])
            return user
    except Exception:
        logger.exception("team invite limit check failed")
        return user

    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "shop_id": shop["shop_id"],
            "shop_role": invite.get("role") or "staff",
            "team_joined_at": now,
            "updated_at": now,
        }},
    )
    await db.team_invites.update_one(
        {"invite_id": invite["invite_id"]},
        {"$set": {
            "status": "accepted",
            "accepted_at": now,
            "accepted_user_id": user["user_id"],
        }},
    )

    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return updated or user


async def _expire_trial_if_needed(user: dict) -> dict:
    trial_expires_at = _parse_iso_datetime(user.get("trial_expires_at"))
    now = datetime.now(timezone.utc)

    has_expired_trial_date = trial_expires_at and trial_expires_at < now
    is_current_trial = bool(user.get("trial"))
    is_legacy_expired_trial = (
        not user.get("trial")
        and bool(user.get("trial_used"))
        and not bool(user.get("trial_expired"))
        and has_expired_trial_date
        and not user.get("subscription_plan_id")
    )

    if has_expired_trial_date and (is_current_trial or is_legacy_expired_trial):
        update = {
            "tier": "free",
            "trial": False,
            "trial_used": True,
            "trial_expired": True,
            "trial_expired_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }

        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": update},
        )

        user.update(update)

    return user

@router.post("/auth/google/id-token")
async def google_id_token_login(data: GoogleIdTokenIn, response: Response):
    google_client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()

    if not google_client_id:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID belum dikonfigurasi")

    try:
        info = google_id_token.verify_oauth2_token(
            data.credential,
            google_requests.Request(),
            google_client_id,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Token Google tidak valid")

    email = (info.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="Email Google tidak ditemukan")

    if info.get("email_verified") is False:
        raise HTTPException(status_code=400, detail="Email Google belum terverifikasi")

    user = await _upsert_google_user(
        email=email,
        name=info.get("name") or "",
        picture=info.get("picture") or "",
    )

    user = await _expire_trial_if_needed(user)
    user = await _accept_pending_team_invite(user)

    token = create_access_token(user["user_id"], email)
    response.set_cookie(
        "access_token",
        token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=7 * 24 * 3600,
        path="/",
    )

    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user.get("name"),
        "picture": user.get("picture", ""),
        "auth_provider": user.get("auth_provider", "google"),
        "shop_id": user.get("shop_id"),
        "role": user.get("role", "user"),
        "tier": user.get("tier", "free"),
        "trial": bool(user.get("trial")),
        "trial_used": bool(user.get("trial_used")),
        "trial_started_at": user.get("trial_started_at"),
        "trial_expires_at": user.get("trial_expires_at"),
        "trial_expired": bool(user.get("trial_expired")),
        "trial_expired_at": user.get("trial_expired_at"),
        "subscription_expires_at": user.get("subscription_expires_at"),
        "subscription_plan_id": user.get("subscription_plan_id"),
        "subscription_cycle": user.get("subscription_cycle"),
        "access_token": token,
    }

@router.post("/auth/register")
async def register(data: RegisterIn, response: Response):
    email = data.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email sudah terdaftar")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    # Trial Pro 14 hari otomatis untuk user baru
    now = datetime.now(timezone.utc)
    trial_end = (now + timedelta(days=14)).isoformat()
    user_doc = {
        "user_id": user_id,
        "email": email,
        "password_hash": hash_password(data.password),
        "name": data.name.strip(),
        "picture": "",
        "auth_provider": "email",
        "shop_id": None,
        "tier": "free",
        "trial": False,
        "trial_used": False,
        "trial_started_at": None,
        "trial_expires_at": None,
        "created_at": now.isoformat(),
    }
    await db.users.insert_one(user_doc)
    user_doc = await _accept_pending_team_invite(user_doc)
    token = create_access_token(user_id, email)
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none",
                        max_age=7 * 24 * 3600, path="/")
    # Welcome email (fire-and-forget; no-ops when RESEND_API_KEY absent)
    try:
        subj, html, text = welcome_email(data.name)
        await send_email(email, subj, html, text)
    except Exception:
        logger.exception("welcome email failed")
    return {
        "user_id": user_id,
        "email": email,
        "name": data.name,
        "picture": "",
        "auth_provider": "email",
        "shop_id": user_doc.get("shop_id"),
        "tier": "free",
        "trial": False,
        "trial_used": False,
        "trial_started_at": None,
        "trial_expires_at": None,
        "access_token": token,
    }

@router.post("/auth/login")
async def login(data: LoginIn, response: Response):
    email = data.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email atau password salah")
    token = create_access_token(user["user_id"], email)
    user = await _expire_trial_if_needed(user)
    user = await _accept_pending_team_invite(user)
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none",
                        max_age=7 * 24 * 3600, path="/")
    return {
        "user_id": user["user_id"],
        "email": email,
        "name": user.get("name"),
        "picture": user.get("picture", ""),
        "auth_provider": user.get("auth_provider", "email"),
        "shop_id": user.get("shop_id"),
        "role": user.get("role", "user"),
        "tier": user.get("tier", "free"),
        "trial": bool(user.get("trial")),
        "trial_used": bool(user.get("trial_used")),
        "trial_started_at": user.get("trial_started_at"),
        "trial_expires_at": user.get("trial_expires_at"),
        "trial_expired": bool(user.get("trial_expired")),
        "trial_expired_at": user.get("trial_expired_at"),
        "subscription_expires_at": user.get("subscription_expires_at"),
        "subscription_plan_id": user.get("subscription_plan_id"),
        "subscription_cycle": user.get("subscription_cycle"),
        "access_token": token,
    }

@router.post("/auth/logout")
async def logout(request: Request, response: Response):
    response.delete_cookie("access_token", path="/")
    sess_token = request.cookies.get("session_token")
    if sess_token:
        await db.user_sessions.delete_one({"session_token": sess_token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


@router.get("/auth/me")
async def get_me(request: Request):
    user = await require_user(request)
    user = await _expire_trial_if_needed(user)
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user.get("name"),
        "picture": user.get("picture", ""),
        "auth_provider": user.get("auth_provider", "email"),
        "shop_id": user.get("shop_id"),
        "role": user.get("role", "user"),
        "tier": user.get("tier", "free"),
        "trial": bool(user.get("trial")),
        "trial_used": bool(user.get("trial_used")),
        "trial_started_at": user.get("trial_started_at"),
        "trial_expires_at": user.get("trial_expires_at"),
        "trial_expired": bool(user.get("trial_expired")),
        "trial_expired_at": user.get("trial_expired_at"),
        "subscription_expires_at": user.get("subscription_expires_at"),
        "subscription_plan_id": user.get("subscription_plan_id"),
        "subscription_cycle": user.get("subscription_cycle"),
    }

@router.post("/auth/forgot-password")
async def forgot_password(data: ForgotIn):
    """Sends reset link via email when RESEND_API_KEY configured. When not
    configured, falls back to 'simple mode' (token returned in response) so
    local/dev still works without external deps."""
    from email_service import is_configured as email_ok
    email = data.email.lower().strip()
    user = await db.users.find_one({"email": email})
    # Always return same shape to avoid email enumeration
    generic = {"ok": True, "message": "Jika email terdaftar, link reset akan dikirim ke inbox kamu."}
    if not user:
        return generic
    token = secrets.token_urlsafe(32)
    await db.password_reset_tokens.insert_one({
        "token": token,
        "user_id": user["user_id"],
        "email": email,
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        "used": False,
        "created_at": datetime.now(timezone.utc),
    })
    reset_link = f"{_public_app_url()}/reset-password?token={token}"
    # Try to send email; log result
    try:
        subj, html, text = reset_email(user.get("name") or "", reset_link)
        email_id = await send_email(email, subj, html, text)
    except Exception:
        logger.exception("password reset email failed")
        email_id = None
    logger.info("Password reset requested for %s (email_id=%s)", email, email_id)
    # Simple-mode fallback: if Resend not configured, surface token in response
    # so local dev / testing can still complete the flow.
    if not email_ok():
        return {
            **generic,
            "reset_token": token, "expires_in_minutes": 60, "simple_mode": True,
            "reset_link": reset_link,
        }
    return generic


@router.post("/auth/reset-password")
async def reset_password(data: ResetIn):
    rec = await db.password_reset_tokens.find_one({"token": data.token, "used": False})
    if not rec:
        raise HTTPException(status_code=400, detail="Token tidak valid atau sudah dipakai")
    expires_at = rec.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Token sudah kadaluarsa")
    new_hash = hash_password(data.new_password)
    cur = await db.users.find_one({"user_id": rec["user_id"]})
    new_auth = "both" if (cur or {}).get("auth_provider") == "google" else "email"
    await db.users.update_one(
        {"user_id": rec["user_id"]},
        {"$set": {"password_hash": new_hash, "auth_provider": new_auth}}
    )
    await db.password_reset_tokens.update_one({"token": data.token}, {"$set": {"used": True}})
    return {"ok": True, "message": "Password berhasil di-reset."}
