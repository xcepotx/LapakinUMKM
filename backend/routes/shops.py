"""Shops routes: CRUD, public fetch, toggle-open, custom domain."""
import os
import re as _re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from deps import db, require_user, slugify
from models import ShopIn, CustomDomainIn
from tiers import get_limits, require_feature
from schedule_utils import compute_schedule_status
from og_render import OG_PNG_CACHE

router = APIRouter()


@router.get("/shops/me")
async def get_my_shop(request: Request):
    user = await require_user(request)
    if not user.get("shop_id"):
        return None
    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    return shop


@router.post("/shops/me")
async def create_or_update_shop(data: ShopIn, request: Request):
    user = await require_user(request)
    now = datetime.now(timezone.utc).isoformat()
    payload = data.model_dump()
    if user.get("shop_id"):
        # update
        await db.shops.update_one(
            {"shop_id": user["shop_id"]},
            {"$set": {**payload, "updated_at": now}}
        )
        # Invalidate OG image cache (cover/brand/name/tagline may have changed)
        OG_PNG_CACHE.pop(user["shop_id"], None)
        shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
        return shop
    # On first creation, smart-default sells_by based on business_type
    if payload.get("sells_by") in (None, "", "stock"):
        bt = (payload.get("business_type") or "").lower()
        if bt in ("kuliner", "kopi"):
            payload["sells_by"] = "hours"
            payload["is_open"] = True
    # create with unique slug
    base_slug = slugify(data.name)
    slug = base_slug
    n = 1
    while await db.shops.find_one({"slug": slug}):
        n += 1
        slug = f"{base_slug}-{n}"
    shop_id = f"shop_{uuid.uuid4().hex[:12]}"
    doc = {
        "shop_id": shop_id, "slug": slug, "owner_user_id": user["user_id"],
        **payload, "created_at": now,
    }
    await db.shops.insert_one(doc)
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"shop_id": shop_id}})
    return {k: v for k, v in doc.items() if k != "_id"}


@router.post("/shops/me/toggle-open")
async def toggle_shop_open(request: Request):
    """Quick toggle for shop is_open flag (used by F&B mode='hours' toko)."""
    user = await require_user(request)
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")
    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")
    new_state = not bool(shop.get("is_open", True))
    await db.shops.update_one(
        {"shop_id": user["shop_id"]},
        {"$set": {"is_open": new_state, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"is_open": new_state}


@router.get("/shops/by-slug/{slug}")
async def get_shop_public(slug: str):
    shop = await db.shops.find_one({"slug": slug}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")
    if shop.get("status") == "suspended":
        raise HTTPException(status_code=404, detail="Toko tidak tersedia")
    products = await db.products.find({"shop_id": shop["shop_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    schedule_status = compute_schedule_status(shop)
    if schedule_status.get("auto"):
        shop["is_open"] = bool(schedule_status.get("is_open_now"))
    shop["schedule_status"] = schedule_status
    owner = await db.users.find_one({"user_id": shop.get("owner_user_id")}, {"_id": 0, "tier": 1})
    owner_tier = (owner or {}).get("tier") or "free"
    shop["owner_tier"] = owner_tier
    shop["remove_branding"] = bool(get_limits(owner_tier).get("remove_branding"))
    # Track a pageview (best-effort, fire-and-forget)
    try:
        await db.storefront_visits.insert_one({
            "shop_id": shop.get("shop_id"),
            "slug": slug,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass
    return {"shop": shop, "products": products}


# ----------- Custom Domain (BISNIS tier) -----------
@router.post("/shops/me/custom-domain")
async def set_custom_domain(data: CustomDomainIn, request: Request):
    user = await require_user(request)
    require_feature(user, "custom_domain")
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")
    domain = (data.domain or "").strip().lower()
    if not _re.match(r"^([a-z0-9-]+\.)+[a-z]{2,}$", domain):
        raise HTTPException(status_code=400, detail="Format domain tidak valid. Contoh: tokokamu.com")
    existing = await db.shops.find_one({"custom_domain": domain, "shop_id": {"$ne": user["shop_id"]}})
    if existing:
        raise HTTPException(status_code=409, detail="Domain ini sudah dipakai toko lain")
    await db.shops.update_one(
        {"shop_id": user["shop_id"]},
        {"$set": {
            "custom_domain": domain,
            "custom_domain_verified": False,
            "custom_domain_requested_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    host = os.environ.get("CUSTOM_DOMAIN_TARGET", "lapakin.my.id")
    return {
        "ok": True,
        "domain": domain,
        "verified": False,
        "dns_instructions": {
            "type": "CNAME",
            "name": domain,
            "value": host,
            "ttl": 3600,
            "note": f"Tambahkan record CNAME di registrar domain kamu: {domain} → {host}. Setelah itu klik 'Verifikasi DNS'.",
        },
    }


@router.post("/shops/me/custom-domain/verify")
async def verify_custom_domain(request: Request):
    user = await require_user(request)
    require_feature(user, "custom_domain")
    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    if not shop or not shop.get("custom_domain"):
        raise HTTPException(status_code=400, detail="Belum request custom domain")
    domain = shop["custom_domain"]
    target = os.environ.get("CUSTOM_DOMAIN_TARGET", "lapakin.my.id")
    try:
        import socket as _sock
        _sock.gethostbyname(domain)
        target_ips = set(i[4][0] for i in _sock.getaddrinfo(target, None))
        domain_ips = set(i[4][0] for i in _sock.getaddrinfo(domain, None))
        verified = bool(target_ips & domain_ips)
    except Exception:
        verified = False
    await db.shops.update_one(
        {"shop_id": user["shop_id"]},
        {"$set": {
            "custom_domain_verified": verified,
            "custom_domain_verified_at": datetime.now(timezone.utc).isoformat() if verified else None,
        }}
    )
    return {"verified": verified, "domain": domain,
            "message": "DNS verified ✅" if verified else "DNS belum pointing ke Lapakin. Tunggu propagasi (max 24 jam) lalu coba lagi."}


@router.delete("/shops/me/custom-domain")
async def remove_custom_domain(request: Request):
    user = await require_user(request)
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")
    await db.shops.update_one(
        {"shop_id": user["shop_id"]},
        {"$unset": {"custom_domain": "", "custom_domain_verified": "",
                    "custom_domain_requested_at": "", "custom_domain_verified_at": ""}}
    )
    return {"ok": True}
