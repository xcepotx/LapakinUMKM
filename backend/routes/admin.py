"""Admin routes: all require role=admin."""
import uuid
import secrets
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Request

from deps import (
    db, require_admin, log_admin_action, hash_password, asyncio_gather_safe,
    TWILIO_ACCOUNT_SID, TWILIO_WHATSAPP_FROM,
)
from models import TierIn, StatusIn, FeaturedIn, BroadcastIn
from tiers import VALID_TIERS, get_tier
from routes.whatsapp import _wa_send

router = APIRouter()


@router.get("/admin/llm/status")
async def admin_llm_status(request: Request):
    """Return which LLM provider(s) are configured + priority order + recent activity.
    Useful for ops dashboard to verify AI setup after VPS deploy.
    """
    await require_admin(request)
    from llm_service import available_providers, active_provider
    chain = available_providers()

    # Recent fallback events (last 7 days) — populated by llm_service.chat_text
    now = datetime.now(timezone.utc)
    seven = (now - timedelta(days=7)).isoformat()
    recent_fallbacks = await db.llm_events.find(
        {"kind": "fallback", "at": {"$gte": seven}},
        {"_id": 0},
    ).sort("at", -1).limit(5).to_list(5)
    last_success_by_provider = {}
    for p in chain:
        doc = await db.llm_events.find_one(
            {"kind": "success", "provider": p},
            {"_id": 0, "at": 1},
            sort=[("at", -1)],
        )
        if doc:
            last_success_by_provider[p] = doc["at"]

    # Usage counts last 30 days by provider
    thirty = (now - timedelta(days=30)).isoformat()
    usage_pipeline = [
        {"$match": {"kind": "success", "at": {"$gte": thirty}}},
        {"$group": {"_id": "$provider", "count": {"$sum": 1}}},
    ]
    usage_docs = await db.llm_events.aggregate(usage_pipeline).to_list(20)
    usage_30d = {d["_id"]: d["count"] for d in usage_docs}

    return {
        "active": active_provider(),
        "chain": chain,
        "count": len(chain),
        "ok": len(chain) > 0,
        "usage_30d": usage_30d,
        "recent_fallbacks": recent_fallbacks,
        "last_success": last_success_by_provider,
    }



# 1. Dashboard Overview
@router.get("/admin/stats")
async def admin_stats(request: Request):
    await require_admin(request)
    now = datetime.now(timezone.utc)
    seven = (now - timedelta(days=7)).isoformat()
    thirty = (now - timedelta(days=30)).isoformat()
    [users_total, users_7d, users_30d, shops_total, shops_active, shops_suspended,
     products_total, products_7d, ai_total, ai_7d] = await asyncio_gather_safe([
        db.users.count_documents({}),
        db.users.count_documents({"created_at": {"$gte": seven}}),
        db.users.count_documents({"created_at": {"$gte": thirty}}),
        db.shops.count_documents({}),
        db.shops.count_documents({"status": {"$ne": "suspended"}}),
        db.shops.count_documents({"status": "suspended"}),
        db.products.count_documents({}),
        db.products.count_documents({"created_at": {"$gte": seven}}),
        db.ai_usage.count_documents({}),
        db.ai_usage.count_documents({"timestamp": {"$gte": seven}}),
    ])
    daily = []
    for i in range(13, -1, -1):
        day_start = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        u = await db.users.count_documents({"created_at": {"$gte": day_start.isoformat(), "$lt": day_end.isoformat()}})
        s = await db.shops.count_documents({"created_at": {"$gte": day_start.isoformat(), "$lt": day_end.isoformat()}})
        p = await db.products.count_documents({"created_at": {"$gte": day_start.isoformat(), "$lt": day_end.isoformat()}})
        a = await db.ai_usage.count_documents({"timestamp": {"$gte": day_start.isoformat(), "$lt": day_end.isoformat()}})
        daily.append({"date": day_start.strftime("%d/%m"), "users": u, "shops": s, "products": p, "ai_calls": a})
    return {
        "users": {"total": users_total, "last_7d": users_7d, "last_30d": users_30d},
        "shops": {"total": shops_total, "active": shops_active, "suspended": shops_suspended},
        "products": {"total": products_total, "last_7d": products_7d},
        "ai_usage": {"total": ai_total, "last_7d": ai_7d},
        "daily": daily,
    }


# 2. List shops
@router.get("/admin/shops")
async def admin_list_shops(request: Request, q: str = "", limit: int = 100):
    await require_admin(request)
    flt = {}
    if q:
        flt["$or"] = [{"name": {"$regex": q, "$options": "i"}},
                      {"slug": {"$regex": q, "$options": "i"}}]
    shops = await db.shops.find(flt, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    for s in shops:
        s["product_count"] = await db.products.count_documents({"shop_id": s["shop_id"]})
        owner = await db.users.find_one({"user_id": s["owner_user_id"]}, {"_id": 0, "email": 1, "name": 1, "tier": 1})
        s["owner"] = owner
    return shops


# 3. List users
@router.get("/admin/users")
async def admin_list_users(request: Request, q: str = "", limit: int = 200):
    await require_admin(request)
    flt = {}
    if q:
        flt["$or"] = [{"email": {"$regex": q, "$options": "i"}},
                      {"name": {"$regex": q, "$options": "i"}}]
    users = await db.users.find(flt, {"_id": 0, "password_hash": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return users


# 4. Suspend / activate shop
@router.put("/admin/shops/{shop_id}/status")
async def admin_set_shop_status(shop_id: str, data: StatusIn, request: Request):
    admin = await require_admin(request)
    if data.status not in ("active", "suspended"):
        raise HTTPException(status_code=400, detail="Status harus 'active' atau 'suspended'")
    res = await db.shops.update_one({"shop_id": shop_id}, {"$set": {"status": data.status}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")
    await log_admin_action(admin, f"shop_{data.status}", "shop", shop_id, {"status": data.status})
    return {"ok": True, "status": data.status}


# 9. Featured shop toggle
@router.put("/admin/shops/{shop_id}/featured")
async def admin_set_shop_featured(shop_id: str, data: FeaturedIn, request: Request):
    admin = await require_admin(request)
    res = await db.shops.update_one({"shop_id": shop_id}, {"$set": {"featured": bool(data.featured)}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")
    await log_admin_action(admin, "shop_featured_toggle", "shop", shop_id, {"featured": data.featured})
    return {"ok": True, "featured": data.featured}


# 5. Admin delete any product
@router.delete("/admin/products/{product_id}")
async def admin_delete_product(product_id: str, request: Request):
    admin = await require_admin(request)
    p = await db.products.find_one({"product_id": product_id}, {"_id": 0, "name": 1, "shop_id": 1})
    if not p:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    await db.products.delete_one({"product_id": product_id})
    await log_admin_action(admin, "product_delete", "product", product_id,
                           {"name": p.get("name"), "shop_id": p.get("shop_id")})
    return {"ok": True}


@router.get("/admin/products")
async def admin_list_products(request: Request, q: str = "", shop_id: str = "", limit: int = 200):
    await require_admin(request)
    flt = {}
    if q:
        flt["name"] = {"$regex": q, "$options": "i"}
    if shop_id:
        flt["shop_id"] = shop_id
    items = await db.products.find(
        flt, {"_id": 0, "image_data": 0, "images": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    return items


# 6. Generate reset password token for a user
@router.post("/admin/users/{user_id}/reset-password")
async def admin_reset_password(user_id: str, request: Request):
    admin = await require_admin(request)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    token = secrets.token_urlsafe(32)
    await db.password_reset_tokens.insert_one({
        "token": token, "user_id": user_id, "email": user["email"],
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        "used": False, "created_at": datetime.now(timezone.utc),
    })
    await log_admin_action(admin, "user_reset_password", "user", user_id, {"email": user.get("email")})
    return {"ok": True, "reset_token": token, "expires_in_minutes": 60}


# 11. Subscription Manager — set tier
@router.put("/admin/users/{user_id}/tier")
@router.post("/admin/users/{user_id}/tier")
async def admin_set_user_tier(user_id: str, data: TierIn, request: Request):
    admin = await require_admin(request)
    if data.tier not in VALID_TIERS:
        raise HTTPException(status_code=400, detail=f"Tier harus salah satu dari {VALID_TIERS}")
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    old_tier = get_tier(user)
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"tier": data.tier, "tier_updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    await log_admin_action(admin, "user_tier_change", "user", user_id,
                           {"from": old_tier, "to": data.tier})
    return {"ok": True, "user_id": user_id, "tier": data.tier}


# 7. Audit log
@router.get("/admin/audit")
async def admin_audit_log(request: Request, limit: int = 200):
    await require_admin(request)
    logs = await db.audit_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)
    return logs


# 8. Broadcast
@router.get("/admin/broadcasts")
async def admin_list_broadcasts(request: Request):
    await require_admin(request)
    items = await db.broadcasts.find({}, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    return items


@router.post("/admin/broadcasts")
async def admin_create_broadcast(data: BroadcastIn, request: Request):
    admin = await require_admin(request)
    bid = f"bc_{uuid.uuid4().hex[:12]}"
    doc = {
        "broadcast_id": bid, "title": data.title.strip(), "message": data.message.strip(),
        "target": data.target, "variant": data.variant, "active": data.active,
        "dismissed_by": [], "created_by": admin["user_id"], "created_by_email": admin["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.broadcasts.insert_one(doc)
    await log_admin_action(admin, "broadcast_create", "broadcast", bid, {"title": data.title})

    wa_sent = 0
    if data.target == "whatsapp" and TWILIO_ACCOUNT_SID and TWILIO_WHATSAPP_FROM:
        async for link in db.wa_links.find({}, {"_id": 0, "phone": 1}):
            try:
                await _wa_send(link["phone"], f"📢 {data.title}\n\n{data.message}")
                wa_sent += 1
            except Exception:
                pass
    return {**{k: v for k, v in doc.items() if k != "_id"}, "wa_sent": wa_sent}


@router.put("/admin/broadcasts/{broadcast_id}/active")
async def admin_toggle_broadcast(broadcast_id: str, data: FeaturedIn, request: Request):
    admin = await require_admin(request)
    # FeaturedIn reuses same shape: {featured: bool}
    res = await db.broadcasts.update_one(
        {"broadcast_id": broadcast_id}, {"$set": {"active": bool(data.featured)}}
    )
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Broadcast tidak ditemukan")
    await log_admin_action(admin, "broadcast_toggle", "broadcast", broadcast_id, {"active": data.featured})
    return {"ok": True}


@router.delete("/admin/broadcasts/{broadcast_id}")
async def admin_delete_broadcast(broadcast_id: str, request: Request):
    admin = await require_admin(request)
    res = await db.broadcasts.delete_one({"broadcast_id": broadcast_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Broadcast tidak ditemukan")
    await log_admin_action(admin, "broadcast_delete", "broadcast", broadcast_id)
    return {"ok": True}


# 10. AI usage stats
@router.get("/admin/ai-usage")
async def admin_ai_usage(request: Request, days: int = 30):
    await require_admin(request)
    days = max(1, min(days, 90))
    now = datetime.now(timezone.utc)
    series = []
    for i in range(days - 1, -1, -1):
        d_start = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        d_end = d_start + timedelta(days=1)
        enh = await db.ai_usage.count_documents({"kind": "enhance", "timestamp": {"$gte": d_start.isoformat(), "$lt": d_end.isoformat()}})
        cnt = await db.ai_usage.count_documents({"kind": "content", "timestamp": {"$gte": d_start.isoformat(), "$lt": d_end.isoformat()}})
        thm = await db.ai_usage.count_documents({"kind": "theme", "timestamp": {"$gte": d_start.isoformat(), "$lt": d_end.isoformat()}})
        series.append({"date": d_start.strftime("%d/%m"), "enhance": enh, "content": cnt, "theme": thm})
    totals = {
        "enhance": await db.ai_usage.count_documents({"kind": "enhance"}),
        "content": await db.ai_usage.count_documents({"kind": "content"}),
        "theme": await db.ai_usage.count_documents({"kind": "theme"}),
    }
    pipeline = [
        {"$group": {"_id": "$user_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]
    top = []
    async for doc in db.ai_usage.aggregate(pipeline):
        u = await db.users.find_one({"user_id": doc["_id"]}, {"_id": 0, "email": 1, "name": 1})
        top.append({"user_id": doc["_id"], "count": doc["count"],
                    "email": (u or {}).get("email"), "name": (u or {}).get("name")})
    return {"series": series, "totals": totals, "top_users": top, "days": days}
