"""Shared dependencies & helpers: db client, auth, logging, config."""
from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt as pyjwt
from fastapi import HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient

from tiers import increment_usage


# ---------- Config ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']

# Optional Twilio config (WhatsApp Bot — works without these but bot will be disabled)
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_WHATSAPP_FROM = os.environ.get("TWILIO_WHATSAPP_FROM", "")  # e.g. "whatsapp:+14155238886" (sandbox)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("lapakin")


# ---------- Auth primitives ----------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "type": "access",
               "exp": datetime.now(timezone.utc) + timedelta(days=7)}
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def slugify(text: str) -> str:
    text = re.sub(r'[^a-zA-Z0-9\s-]', '', text or '').strip().lower()
    text = re.sub(r'[\s_-]+', '-', text)
    return text[:40] or f"toko-{uuid.uuid4().hex[:6]}"


async def get_user_from_token(request: Request) -> Optional[dict]:
    """Read auth from cookie 'access_token' (JWT) OR 'session_token' (Google),
    or Authorization Bearer header."""
    token = request.cookies.get("access_token")
    if token:
        try:
            payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            if payload.get("type") == "access":
                user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
                if user:
                    return user
        except pyjwt.PyJWTError:
            pass

    sess_token = request.cookies.get("session_token")
    if sess_token:
        sess = await db.user_sessions.find_one({"session_token": sess_token}, {"_id": 0})
        if sess:
            expires_at = sess.get("expires_at")
            if isinstance(expires_at, str):
                expires_at = datetime.fromisoformat(expires_at)
            if expires_at and expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at and expires_at > datetime.now(timezone.utc):
                user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0, "password_hash": 0})
                if user:
                    return user

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        bearer = auth_header[7:]
        try:
            payload = pyjwt.decode(bearer, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            if payload.get("type") == "access":
                user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
                if user:
                    return user
        except pyjwt.PyJWTError:
            pass
    return None


async def require_user(request: Request) -> dict:
    user = await get_user_from_token(request)
    if not user:
        raise HTTPException(status_code=401, detail="Tidak terautentikasi")
    # Auto-downgrade expired trial: pro + trial=true + trial_expires_at < now → free
    if user.get("trial") and user.get("trial_expires_at"):
        try:
            exp = datetime.fromisoformat(user["trial_expires_at"].replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            if exp < now:
                await db.users.update_one(
                    {"user_id": user["user_id"]},
                    {"$set": {"tier": "free", "trial": False,
                              "trial_ended_at": now.isoformat()}}
                )
                user["tier"] = "free"
                user["trial"] = False
            else:
                # H-3 trial expiring email (best-effort, once per user)
                days_left = (exp - now).days
                if 0 <= days_left <= 3 and not user.get("trial_reminder_sent_at"):
                    try:
                        from email_service import send_email
                        from email_templates import trial_expiring
                        subj, html, text = trial_expiring(
                            user.get("name") or "", max(1, days_left + 1)
                        )
                        await send_email(user["email"], subj, html, text)
                        await db.users.update_one(
                            {"user_id": user["user_id"]},
                            {"$set": {"trial_reminder_sent_at": now.isoformat()}}
                        )
                    except Exception:
                        logger.exception("trial reminder email failed")
        except Exception:
            pass
    return user


async def require_admin(request: Request) -> dict:
    user = await require_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Akses admin saja")
    return user


async def log_admin_action(admin: dict, action: str, target_type: str = "",
                           target_id: str = "", meta: Optional[dict] = None):
    await db.audit_logs.insert_one({
        "log_id": f"log_{uuid.uuid4().hex[:12]}",
        "admin_user_id": admin["user_id"],
        "admin_email": admin["email"],
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "meta": meta or {},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


async def track_ai_usage(user_id: str, kind: str):
    """Record an AI call for analytics + monthly tier usage. Best-effort, never raises."""
    try:
        await db.ai_usage.insert_one({
            "user_id": user_id, "kind": kind,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        bucket = {
            "enhance": "ai_photo",
            "content": "ai_copy",
            "theme": "ai_copy",
            "cover": "ai_cover",
            "about": "ai_copy",
        }.get(kind)
        if bucket:
            await increment_usage(db.monthly_usage, user_id, bucket)
    except Exception:
        pass


async def asyncio_gather_safe(coros):
    import asyncio
    return await asyncio.gather(*coros)
