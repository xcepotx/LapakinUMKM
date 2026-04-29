"""Public utility routes: health, featured shops, broadcasts (user side), billing, analytics."""
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Request

from deps import db, require_user
from models import AnalyticsTrackIn
from tiers import (
    TIER_LIMITS, VALID_TIERS, get_tier, get_limits,
    current_month_bucket, get_usage, is_unlimited, require_feature,
)

router = APIRouter()


# ---------- Health ----------
@router.get("/")
async def root():
    return {"app": "Lapakin", "status": "ok"}


# ---------- Featured shops (for landing) ----------
@router.get("/featured-shops")
async def get_featured_shops():
    shops = await db.shops.find(
        {"featured": True, "status": {"$ne": "suspended"}},
        {"_id": 0, "shop_id": 1, "slug": 1, "name": 1, "tagline": 1,
         "business_type": 1, "brand_color": 1}
    ).limit(8).to_list(8)
    return shops


# ---------- Active broadcast banner ----------
@router.get("/me/broadcast")
async def get_my_active_broadcast(request: Request):
    user = await require_user(request)
    bc = await db.broadcasts.find_one(
        {"active": True, "dismissed_by": {"$ne": user["user_id"]}},
        {"_id": 0}, sort=[("created_at", -1)]
    )
    return bc


@router.post("/me/broadcast/{broadcast_id}/dismiss")
async def dismiss_broadcast(broadcast_id: str, request: Request):
    user = await require_user(request)
    await db.broadcasts.update_one({"broadcast_id": broadcast_id},
                                   {"$addToSet": {"dismissed_by": user["user_id"]}})
    return {"ok": True}


# ---------- Billing / Tier ----------
@router.get("/billing/tiers")
async def billing_tiers():
    """Public — return available tiers and their limits/features."""
    return {"tiers": TIER_LIMITS, "valid": VALID_TIERS}


@router.get("/billing/me")
async def billing_me(request: Request):
    """Current user's tier + month-to-date usage with limits."""
    user = await require_user(request)
    tier = get_tier(user)
    limits = get_limits(tier)
    ym = current_month_bucket()
    kinds = ["ai_photo", "ai_copy", "ai_cover", "toko_card", "broadcast"]
    usage = {}
    for k in kinds:
        used = await get_usage(db.monthly_usage, user["user_id"], k, ym)
        limit_key = f"{k}_per_month"
        lim = limits.get(limit_key, 0)
        usage[k] = {
            "used": used,
            "limit": "unlimited" if is_unlimited(lim) else lim,
            "remaining": "unlimited" if is_unlimited(lim) else max(0, lim - used),
        }
    product_count = 0
    if user.get("shop_id"):
        product_count = await db.products.count_documents({"shop_id": user["shop_id"]})
    pmax = limits["max_products"]
    return {
        "tier": tier,
        "tier_label": limits.get("label", tier),
        "trial": bool(user.get("trial")),
        "trial_expires_at": user.get("trial_expires_at"),
        "subscription_expires_at": user.get("subscription_expires_at"),
        "subscription_plan_id": user.get("subscription_plan_id"),
        "subscription_cycle": user.get("subscription_cycle"),
        "year_month": ym,
        "limits": limits,
        "usage": usage,
        "products": {
            "used": product_count,
            "limit": "unlimited" if is_unlimited(pmax) else pmax,
            "remaining": "unlimited" if is_unlimited(pmax) else max(0, pmax - product_count),
        },
    }


# ---------- Analytics ----------
@router.post("/analytics/track")
async def analytics_track(data: AnalyticsTrackIn):
    """Public endpoint — called from Storefront client-side to track events."""
    if data.event not in ("view_product", "click_order", "share_wa", "view_shop"):
        return {"ok": False}
    shop = None
    if data.slug:
        shop = await db.shops.find_one({"slug": data.slug}, {"_id": 0, "shop_id": 1})
    if not shop and data.product_id:
        product = await db.products.find_one({"product_id": data.product_id}, {"_id": 0, "shop_id": 1})
        if product:
            shop = {"shop_id": product["shop_id"]}
    if not shop:
        return {"ok": False}
    try:
        await db.analytics_events.insert_one({
            "shop_id": shop["shop_id"],
            "event": data.event,
            "product_id": data.product_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass
    return {"ok": True}


@router.get("/analytics/shop")
async def analytics_shop(request: Request, days: int = 7):
    """Get analytics for current user's shop. PRO+ tier only."""
    user = await require_user(request)
    require_feature(user, "analytics")
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")
    shop_id = user["shop_id"]
    days = max(1, min(90, int(days)))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    total_visits = await db.storefront_visits.count_documents({
        "shop_id": shop_id, "timestamp": {"$gte": since}
    })
    pipeline = [
        {"$match": {"shop_id": shop_id, "timestamp": {"$gte": since}}},
        {"$group": {"_id": "$event", "count": {"$sum": 1}}},
    ]
    events = {}
    async for row in db.analytics_events.aggregate(pipeline):
        events[row["_id"]] = row["count"]

    top_products_pipe = [
        {"$match": {
            "shop_id": shop_id,
            "timestamp": {"$gte": since},
            "event": {"$in": ["click_order", "view_product"]},
            "product_id": {"$ne": None},
        }},
        {"$group": {"_id": "$product_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ]
    top_products = []
    async for row in db.analytics_events.aggregate(top_products_pipe):
        prod = await db.products.find_one(
            {"product_id": row["_id"]}, {"_id": 0, "name": 1, "price": 1}
        )
        if prod:
            top_products.append({
                "product_id": row["_id"], "name": prod.get("name"),
                "price": prod.get("price"), "interactions": row["count"]
            })

    day_pipe = [
        {"$match": {"shop_id": shop_id, "timestamp": {"$gte": since}}},
        {"$group": {"_id": {"$substr": ["$timestamp", 0, 10]}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    daily = []
    async for row in db.storefront_visits.aggregate(day_pipe):
        daily.append({"date": row["_id"], "visits": row["count"]})

    clicks = events.get("click_order", 0)
    conv_rate = round((clicks / total_visits * 100), 2) if total_visits > 0 else 0

    return {
        "range_days": days,
        "total_visits": total_visits,
        "events": events,
        "conversion_rate_percent": conv_rate,
        "top_products": top_products,
        "daily": daily,
    }
