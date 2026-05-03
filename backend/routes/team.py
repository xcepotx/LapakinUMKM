"""Team member routes for shop owners.

MVP:
- Owner can add an existing registered user to the same shop by email.
- If the email is not registered yet, create a pending invite.
- When invited user registers/logs in, auth.py accepts the pending invite.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from deps import db, require_user
from tiers import get_limits, get_tier, is_unlimited

router = APIRouter()


class TeamMemberIn(BaseModel):
    email: str


async def _get_my_shop(user: dict):
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")
    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")
    return shop


def _normalize_email(email: str) -> str:
    return (email or "").lower().strip()


def _validate_email(email: str):
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Format email anggota tidak valid")


def _is_owner(user: dict, shop: dict) -> bool:
    return user.get("user_id") == shop.get("owner_user_id")


async def _require_shop_owner(user: dict, shop: dict):
    if not _is_owner(user, shop):
        raise HTTPException(status_code=403, detail="Hanya owner toko yang bisa mengelola anggota tim")


def _member_payload(user: dict, owner_user_id: str) -> dict:
    role = "owner" if user.get("user_id") == owner_user_id else (user.get("shop_role") or "staff")
    return {
        "user_id": user.get("user_id"),
        "email": user.get("email"),
        "name": user.get("name") or "",
        "picture": user.get("picture") or "",
        "role": role,
        "status": "active",
        "joined_at": user.get("team_joined_at") or user.get("created_at") or "",
    }


def _invite_payload(invite: dict) -> dict:
    return {
        "invite_id": invite.get("invite_id"),
        "email": invite.get("email"),
        "role": invite.get("role") or "staff",
        "status": invite.get("status") or "pending",
        "created_at": invite.get("created_at") or "",
    }


async def _team_limit_state(shop: dict, owner: dict):
    tier = get_tier(owner)
    max_members = get_limits(tier).get("max_users_per_shop", 1)

    active_count = await db.users.count_documents({"shop_id": shop["shop_id"]})
    pending_count = await db.team_invites.count_documents({
        "shop_id": shop["shop_id"],
        "status": "pending",
    })
    used = active_count + pending_count

    return {
        "tier": tier,
        "limit_raw": max_members,
        "limit": "unlimited" if is_unlimited(max_members) else max_members,
        "used": used,
        "active_count": active_count,
        "pending_count": pending_count,
        "remaining": "unlimited" if is_unlimited(max_members) else max(0, max_members - used),
    }


@router.get("/team/members")
async def list_team_members(request: Request):
    user = await require_user(request)
    shop = await _get_my_shop(user)

    members_raw = await db.users.find(
        {"shop_id": shop["shop_id"]},
        {"_id": 0, "password_hash": 0},
    ).sort("created_at", 1).to_list(100)

    owner_id = shop.get("owner_user_id")
    members = sorted(
        [_member_payload(m, owner_id) for m in members_raw],
        key=lambda m: 0 if m["role"] == "owner" else 1,
    )

    pending_raw = await db.team_invites.find(
        {"shop_id": shop["shop_id"], "status": "pending"},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)

    owner = await db.users.find_one({"user_id": owner_id}, {"_id": 0}) or user
    limit_state = await _team_limit_state(shop, owner)

    return {
        "shop_id": shop["shop_id"],
        "owner_user_id": owner_id,
        "is_owner": _is_owner(user, shop),
        "tier": limit_state["tier"],
        "limit": limit_state["limit"],
        "used": limit_state["used"],
        "active_count": limit_state["active_count"],
        "pending_count": limit_state["pending_count"],
        "remaining": limit_state["remaining"],
        "members": members,
        "pending_invites": [_invite_payload(i) for i in pending_raw],
    }


@router.post("/team/members")
async def add_team_member(data: TeamMemberIn, request: Request):
    user = await require_user(request)
    shop = await _get_my_shop(user)
    await _require_shop_owner(user, shop)

    email = _normalize_email(data.email)
    _validate_email(email)

    owner = await db.users.find_one({"user_id": shop.get("owner_user_id")}, {"_id": 0}) or user
    limit_state = await _team_limit_state(shop, owner)

    if not is_unlimited(limit_state["limit_raw"]) and limit_state["used"] >= limit_state["limit_raw"]:
        raise HTTPException(
            status_code=402,
            detail=f"Limit anggota tim paket {limit_state['tier']} sudah penuh ({limit_state['used']}/{limit_state['limit_raw']}). Upgrade untuk menambah anggota.",
        )

    target = await db.users.find_one({"email": email}, {"_id": 0})

    if target:
        if target.get("role") == "admin":
            raise HTTPException(status_code=400, detail="Akun admin tidak bisa ditambahkan sebagai anggota toko")

        if target.get("user_id") == shop.get("owner_user_id"):
            raise HTTPException(status_code=400, detail="Owner sudah otomatis menjadi anggota tim")

        if target.get("shop_id") == shop["shop_id"]:
            raise HTTPException(status_code=400, detail="User ini sudah menjadi anggota tim toko ini")

        if target.get("shop_id") and target.get("shop_id") != shop["shop_id"]:
            raise HTTPException(status_code=409, detail="User ini sudah terhubung ke toko lain")

        now = datetime.now(timezone.utc).isoformat()
        await db.users.update_one(
            {"user_id": target["user_id"]},
            {"$set": {
                "shop_id": shop["shop_id"],
                "shop_role": "staff",
                "team_joined_at": now,
                "updated_at": now,
            }},
        )

        updated = await db.users.find_one({"user_id": target["user_id"]}, {"_id": 0, "password_hash": 0})
        return {"ok": True, "status": "active", "member": _member_payload(updated, shop.get("owner_user_id"))}

    existing_invite = await db.team_invites.find_one({
        "shop_id": shop["shop_id"],
        "email": email,
        "status": "pending",
    }, {"_id": 0})

    if existing_invite:
        return {
            "ok": True,
            "status": "pending_invite",
            "invite": _invite_payload(existing_invite),
            "message": "Undangan untuk email ini sudah ada. Minta anggota daftar dengan email tersebut.",
        }

    now = datetime.now(timezone.utc).isoformat()
    invite = {
        "invite_id": f"invite_{uuid.uuid4().hex[:12]}",
        "shop_id": shop["shop_id"],
        "owner_user_id": shop.get("owner_user_id"),
        "email": email,
        "role": "staff",
        "status": "pending",
        "created_at": now,
        "created_by": user["user_id"],
    }
    await db.team_invites.insert_one(invite)

    return {
        "ok": True,
        "status": "pending_invite",
        "invite": _invite_payload(invite),
        "message": "Undangan tersimpan. Minta anggota daftar akun Lapakin dengan email ini.",
    }


@router.delete("/team/members/{user_id}")
async def remove_team_member(user_id: str, request: Request):
    user = await require_user(request)
    shop = await _get_my_shop(user)
    await _require_shop_owner(user, shop)

    if user_id == shop.get("owner_user_id"):
        raise HTTPException(status_code=400, detail="Owner toko tidak bisa dihapus dari tim")

    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target or target.get("shop_id") != shop["shop_id"]:
        raise HTTPException(status_code=404, detail="Anggota tim tidak ditemukan")

    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"user_id": user_id},
        {"$unset": {"shop_id": "", "shop_role": "", "team_joined_at": ""},
         "$set": {"updated_at": now}},
    )

    return {"ok": True, "removed_user_id": user_id}


@router.delete("/team/invites/{invite_id}")
async def revoke_team_invite(invite_id: str, request: Request):
    user = await require_user(request)
    shop = await _get_my_shop(user)
    await _require_shop_owner(user, shop)

    invite = await db.team_invites.find_one({
        "invite_id": invite_id,
        "shop_id": shop["shop_id"],
        "status": "pending",
    }, {"_id": 0})

    if not invite:
        raise HTTPException(status_code=404, detail="Undangan tidak ditemukan")

    now = datetime.now(timezone.utc).isoformat()
    await db.team_invites.update_one(
        {"invite_id": invite_id},
        {"$set": {"status": "revoked", "revoked_at": now, "revoked_by": user["user_id"]}},
    )

    return {"ok": True, "revoked_invite_id": invite_id}
