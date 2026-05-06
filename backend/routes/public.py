"""Public utility routes: health, featured shops, broadcasts (user side), billing, analytics."""
from datetime import datetime, timezone, timedelta
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from deps import db, require_user
from llm_service import active_provider
from models import AnalyticsTrackIn
from pricing_config import get_tier_limits_with_pricing
from tiers import (
    TIER_LIMITS, VALID_TIERS, get_tier, get_limits,
    current_month_bucket, get_usage, is_unlimited, require_feature,
)

APP_VERSION = "1.0.0"

router = APIRouter()


def _lapakin_expose_product_status_fields(product):
    """Return a product dict with stable status fields for API consumers."""
    if not isinstance(product, dict):
        return product
    out = dict(product)
    try:
        out["sort_order"] = int(out.get("sort_order") or 0)
    except Exception:
        out["sort_order"] = 0
    raw_status = str(out.get("availability_status") or "").strip().lower()
    allowed_statuses = {"active", "out_of_stock", "hidden"}
    if raw_status not in allowed_statuses:
        raw_status = "hidden" if out.get("is_active") is False else "active"
    out["availability_status"] = raw_status
    out["is_active"] = raw_status != "hidden"
    return out


# ---------- Health ----------
@router.get("/")
async def root():
    return {"app": "Lapakin", "status": "ok"}


@router.get("/health")
async def health():
    db_ok = True
    try:
        await db.command("ping")
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "mongodb": "connected" if db_ok else "disconnected",
        "llm_provider_active": active_provider(),
        "version": APP_VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


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
    tiers = await get_tier_limits_with_pricing(db)
    return {"tiers": tiers, "valid": VALID_TIERS}


@router.get("/billing/me")
async def billing_me(request: Request):
    """Current user's tier + month-to-date usage with limits."""
    user = await require_user(request)
    tier = get_tier(user)
    all_limits = await get_tier_limits_with_pricing(db)
    limits = all_limits.get(tier, all_limits["free"])
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

# LAPAKIN_GROWTH_SPRINT_V2
# ---------- Storefront Growth Sprint: campaign analytics + lead capture ----------
class StorefrontEventIn(BaseModel):
    event_type: str
    shop_slug: Optional[str] = None
    shop_id: Optional[str] = None
    campaign_slug: Optional[str] = None
    product_id: Optional[str] = None
    source: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class StorefrontLeadIn(BaseModel):
    shop_slug: Optional[str] = None
    shop_id: Optional[str] = None
    campaign_slug: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    fulfillment_method: Optional[str] = "discuss"
    notes: Optional[str] = None
    items: List[Dict[str, Any]] = Field(default_factory=list)
    total: Optional[float] = None
    source: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


STOREFRONT_GROWTH_EVENTS = {
    "page_view",
    "promo_view",
    "promo_cta_click",
    "product_click",
    "whatsapp_checkout_click",
    "lead_created",
}



class StorefrontLeadStatusIn(BaseModel):
    status: str

def _growth_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _growth_day(value: Optional[str] = None) -> str:
    return (value or _growth_now_iso())[:10]


def _safe_shop_id(shop: Optional[dict]) -> Optional[str]:
    if not shop:
        return None
    return shop.get("shop_id") or shop.get("id") or str(shop.get("_id") or "") or None


async def _resolve_growth_shop(shop_id: Optional[str] = None, shop_slug: Optional[str] = None) -> Optional[dict]:
    if shop_id:
        shop = await db.shops.find_one(
            {"$or": [{"shop_id": shop_id}, {"id": shop_id}]},
            {"_id": 0},
        )
        if shop:
            return shop

    if shop_slug:
        shop = await db.shops.find_one(
            {"$or": [{"slug": shop_slug}, {"shop_slug": shop_slug}]},
            {"_id": 0},
        )
        if shop:
            return shop

    return None


def _request_growth_context(request: Request) -> Dict[str, Optional[str]]:
    return {
        "user_agent": request.headers.get("user-agent"),
        "referer": request.headers.get("referer"),
    }


async def _insert_growth_event(request: Request, payload: StorefrontEventIn, shop: Optional[dict] = None) -> bool:
    if payload.event_type not in STOREFRONT_GROWTH_EVENTS:
        return False

    shop = shop or await _resolve_growth_shop(payload.shop_id, payload.shop_slug)
    if not shop:
        return False

    timestamp = _growth_now_iso()
    shop_id = _safe_shop_id(shop)
    shop_slug = shop.get("slug") or shop.get("shop_slug") or payload.shop_slug

    await db.analytics_events.insert_one({
        "shop_id": shop_id,
        "shop_slug": shop_slug,
        "event": payload.event_type,
        "event_type": payload.event_type,
        "campaign_slug": payload.campaign_slug,
        "product_id": payload.product_id,
        "source": payload.source,
        "metadata": payload.metadata or {},
        "timestamp": timestamp,
        "day": _growth_day(timestamp),
        "month": timestamp[:7],
        **_request_growth_context(request),
    })
    return True


@router.post("/storefront/events")
async def storefront_growth_track_event(data: StorefrontEventIn, request: Request):
    # Public best-effort campaign analytics endpoint for storefront pages.
    try:
        stored = await _insert_growth_event(request, data)
        return {"ok": True, "stored": stored}
    except Exception:
        return {"ok": True, "stored": False}


@router.post("/storefront/leads")
async def storefront_growth_create_lead(data: StorefrontLeadIn, request: Request):
    # Public best-effort lead capture before WhatsApp checkout.
    try:
        shop = await _resolve_growth_shop(data.shop_id, data.shop_slug)
        if not shop:
            return {"ok": True, "stored": False, "reason": "shop_not_found"}

        timestamp = _growth_now_iso()
        shop_id = _safe_shop_id(shop)
        shop_slug = shop.get("slug") or shop.get("shop_slug") or data.shop_slug
        lead_id = f"lead_{uuid.uuid4().hex[:16]}"

        lead_doc = {
            "lead_id": lead_id,
            "shop_id": shop_id,
            "shop_slug": shop_slug,
            "campaign_slug": data.campaign_slug,
            "customer_name": (data.customer_name or "").strip() or None,
            "customer_phone": (data.customer_phone or "").strip() or None,
            "fulfillment_method": data.fulfillment_method or "discuss",
            "notes": (data.notes or "").strip() or None,
            "items": data.items or [],
            "total": data.total,
            "source": data.source,
            "metadata": data.metadata or {},
            "status": "new",
            "created_at": timestamp,
            "day": _growth_day(timestamp),
            "month": timestamp[:7],
            **_request_growth_context(request),
        }
        await db.storefront_leads.insert_one(lead_doc)

        await _insert_growth_event(
            request,
            StorefrontEventIn(
                event_type="lead_created",
                shop_id=shop_id,
                shop_slug=shop_slug,
                campaign_slug=data.campaign_slug,
                source=data.source,
                metadata={"lead_id": lead_id},
            ),
            shop,
        )

        return {"ok": True, "stored": True, "lead_id": lead_id}
    except Exception:
        return {"ok": True, "stored": False}


@router.get("/shops/storefront-analytics")
async def storefront_growth_analytics(request: Request, days: int = 30):
    user = await require_user(request)
    shop_id = user.get("shop_id")
    if not shop_id:
        raise HTTPException(status_code=400, detail="Belum punya toko")

    days = max(1, min(180, int(days or 30)))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    shop = await db.shops.find_one({"shop_id": shop_id}, {"_id": 0}) or {}
    campaign_slug = shop.get("storefront_promo_slug") or ""
    match = {"shop_id": shop_id, "timestamp": {"$gte": since}}

    totals = {
        "page_view": 0,
        "promo_view": 0,
        "promo_cta_click": 0,
        "product_click": 0,
        "whatsapp_checkout_click": 0,
        "lead_created": 0,
    }

    async for row in db.analytics_events.aggregate([
        {"$match": {**match, "event": {"$in": list(totals.keys())}}},
        {"$group": {"_id": "$event", "count": {"$sum": 1}}},
    ]):
        if row.get("_id") in totals:
            totals[row["_id"]] = row.get("count", 0)

    campaign = {"page_views": 0, "promo_views": 0, "promo_cta_clicks": 0, "whatsapp_checkout_clicks": 0, "leads": 0}
    if campaign_slug:
        async for row in db.analytics_events.aggregate([
            {"$match": {**match, "campaign_slug": campaign_slug, "event": {"$in": list(totals.keys())}}},
            {"$group": {"_id": "$event", "count": {"$sum": 1}}},
        ]):
            event = row.get("_id")
            count = row.get("count", 0)
            if event == "page_view":
                campaign["page_views"] = count
            elif event == "promo_view":
                campaign["promo_views"] = count
            elif event == "promo_cta_click":
                campaign["promo_cta_clicks"] = count
            elif event == "whatsapp_checkout_click":
                campaign["whatsapp_checkout_clicks"] = count
            elif event == "lead_created":
                campaign["leads"] = count

    top_products = []
    async for row in db.analytics_events.aggregate([
        {"$match": {**match, "event": "product_click", "product_id": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$product_id", "clicks": {"$sum": 1}}},
        {"$sort": {"clicks": -1}},
        {"$limit": 5},
    ]):
        product_id = row.get("_id")
        product = await db.products.find_one({"product_id": product_id}, {"_id": 0, "name": 1})
        top_products.append({
            "product_id": product_id,
            "name": (product or {}).get("name") or product_id,
            "clicks": row.get("clicks", 0),
        })

    daily = []
    async for row in db.analytics_events.aggregate([
        {"$match": {**match, "event": {"$in": ["page_view", "promo_cta_click", "whatsapp_checkout_click", "lead_created"]}}},
        {"$group": {"_id": {"day": {"$substr": ["$timestamp", 0, 10]}, "event": "$event"}, "count": {"$sum": 1}}},
        {"$sort": {"_id.day": 1}},
    ]):
        day = row.get("_id", {}).get("day")
        event = row.get("_id", {}).get("event")
        if not day or event not in totals:
            continue
        found = next((item for item in daily if item["day"] == day), None)
        if not found:
            found = {"day": day, "page_view": 0, "promo_cta_click": 0, "whatsapp_checkout_click": 0, "lead_created": 0}
            daily.append(found)
        found[event] = row.get("count", 0)

    return {
        "days": days,
        "totals": totals,
        "campaign_slug": campaign_slug,
        "campaign": campaign,
        "top_products": top_products,
        "daily": daily,
    }


@router.get("/shops/storefront-leads")
async def storefront_growth_leads(request: Request, limit: int = 30):
    user = await require_user(request)
    shop_id = user.get("shop_id")
    if not shop_id:
        raise HTTPException(status_code=400, detail="Belum punya toko")

    limit = max(1, min(100, int(limit or 30)))
    leads = await db.storefront_leads.find(
        {"shop_id": shop_id},
        {"_id": 0, "user_agent": 0, "referer": 0},
    ).sort("created_at", -1).limit(limit).to_list(limit)

    return {"leads": leads}


# LAPAKIN_LEAD_INBOX_STATUS_ENDPOINT
@router.put("/shops/storefront-leads/{lead_id}/status")
@router.patch("/shops/storefront-leads/{lead_id}/status")
async def storefront_growth_update_lead_status(lead_id: str, data: StorefrontLeadStatusIn, request: Request):
    user = await require_user(request)
    shop_id = user.get("shop_id")
    if not shop_id:
        raise HTTPException(status_code=400, detail="Belum punya toko")

    allowed = {"new", "contacted", "done", "cancelled"}
    status = (data.status or "").strip().lower()
    if status not in allowed:
        raise HTTPException(status_code=400, detail="Status lead tidak valid")

    lead = await db.storefront_leads.find_one({"lead_id": lead_id, "shop_id": shop_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead tidak ditemukan")

    now = _growth_now_iso() if "_growth_now_iso" in globals() else datetime.now(timezone.utc).isoformat()
    await db.storefront_leads.update_one(
        {"lead_id": lead_id, "shop_id": shop_id},
        {"$set": {"status": status, "updated_at": now}},
    )
    updated = await db.storefront_leads.find_one(
        {"lead_id": lead_id, "shop_id": shop_id},
        {"_id": 0, "user_agent": 0, "referer": 0},
    )
    return {"ok": True, "lead": updated}
# /LAPAKIN_LEAD_INBOX_STATUS_ENDPOINT

# /LAPAKIN_GROWTH_SPRINT_V2

