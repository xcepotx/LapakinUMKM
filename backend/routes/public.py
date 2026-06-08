from fastapi.responses import RedirectResponse
"""Public utility routes: health, featured shops, broadcasts (user side), billing, analytics."""
from datetime import datetime, timezone, timedelta
import hmac
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from deps import db, require_user
from llm_service import active_provider
from models import AnalyticsTrackIn
from pricing_config import get_tier_limits_with_pricing
from tiers import (
    TIER_LIMITS, VALID_TIERS, get_tier, get_limits,
    current_month_bucket, get_usage, is_unlimited, require_feature,
)
from schedule_utils import compute_schedule_status

APP_VERSION = "1.0.0"

router = APIRouter()


def _lapakin_normalize_lead_followup_status(value):
    raw = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "": "baru",
        "new": "baru",
        "baru": "baru",
        "di_hubungi": "dihubungi",
        "dihubungi": "dihubungi",
        "contacted": "dihubungi",
        "followed_up": "dihubungi",
        "followup": "dihubungi",
        "deal": "deal",
        "won": "deal",
        "converted": "deal",
        "success": "deal",
        "batal": "batal",
        "cancelled": "batal",
        "canceled": "batal",
        "lost": "batal",
        "failed": "batal",
    }
    return aliases.get(raw, "baru")


def _lapakin_lead_followup_now_iso():
    return datetime.now(timezone.utc).isoformat()




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
def _public_storefront_shop_payload(shop: dict, owner_tier: str = "free") -> dict:
    if not isinstance(shop, dict):
        return {}

    schedule_status = compute_schedule_status(shop)
    out = {
        "shop_id": shop.get("shop_id"),
        "slug": shop.get("slug"),
        "name": shop.get("name"),
        "tagline": shop.get("tagline") or "",
        "description": shop.get("description") or "",
        "business_type": shop.get("business_type") or "",
        "category": shop.get("category") or shop.get("category_name") or "",
        "brand_color": shop.get("brand_color") or "#C04A3B",
        "logo_url": shop.get("logo_url") or "",
        "cover_image": shop.get("cover_image") or "",
        "about": shop.get("about") or "",
        "hours": shop.get("hours") or "",
        "whatsapp": shop.get("whatsapp") or shop.get("whatsapp_number") or "",
        "order_whatsapp_enabled": shop.get("order_whatsapp_enabled") is not False,
        "pickup_available": bool(shop.get("pickup_available")),
        "delivery_available": bool(shop.get("delivery_available")),
        "store_address": shop.get("store_address") or shop.get("address") or shop.get("location_address") or "",
        "google_maps_url": shop.get("google_maps_url") or shop.get("google_maps_link") or "",
        "service_area": shop.get("service_area") or "",
        "instagram": shop.get("instagram") or "",
        "tiktok": shop.get("tiktok") or "",
        "shopee": shop.get("shopee") or "",
        "website_mode": shop.get("website_mode") or "lapakin_template",
        "external_website_url": shop.get("external_website_url") or "",
        "external_website_label": shop.get("external_website_label") or "Buka Website Custom",
        "external_website_behavior": shop.get("external_website_behavior") or "handoff",
        "public_read_key_required": bool(shop.get("public_read_key_enabled")),
        "storefront_mode": shop.get("storefront_mode") or "catalog",
        "storefront_style": shop.get("storefront_style") or "classic",
        "storefront_renderer": shop.get("storefront_renderer") or "legacy",
        "storefront_hero_title": shop.get("storefront_hero_title") or "",
        "storefront_hero_subtitle": shop.get("storefront_hero_subtitle") or "",
        "storefront_cta_label": shop.get("storefront_cta_label") or "",
        "storefront_featured_title": shop.get("storefront_featured_title") or "",
        "storefront_featured_product_ids": shop.get("storefront_featured_product_ids") or [],
        "storefront_payment_method_label": shop.get("storefront_payment_method_label") or "",
        "storefront_payment_instruction": shop.get("storefront_payment_instruction") or shop.get("payment_instruction") or "",
        "storefront_show_payment_instruction": bool(shop.get("storefront_show_payment_instruction")),
        "storefront_whatsapp_checkout_template": shop.get("storefront_whatsapp_checkout_template") or "",
        "storefront_whatsapp_product_template": shop.get("storefront_whatsapp_product_template") or "",
        "seo": {
            "title": shop.get("storefront_seo_title") or shop.get("seo_title") or "",
            "description": shop.get("storefront_seo_description") or shop.get("seo_description") or "",
            "image": shop.get("storefront_seo_image") or shop.get("seo_image") or shop.get("cover_image") or "",
        },
        "schedule_status": schedule_status,
        "is_open": bool(schedule_status.get("is_open_now")) if schedule_status.get("auto") and not shop.get("manual_open_override") else shop.get("is_open") is not False,
        "owner_tier": owner_tier,
        "remove_branding": bool(get_limits(owner_tier).get("remove_branding")),
    }
    return out


def _public_storefront_product_payload(product: dict) -> dict:
    product = _lapakin_expose_product_status_fields(product or {})
    return {
        "product_id": product.get("product_id"),
        "shop_id": product.get("shop_id"),
        "name": product.get("name"),
        "description": product.get("description") or "",
        "price": product.get("price") or 0,
        "stock": product.get("stock") or 0,
        "category_id": product.get("category_id") or "",
        "category": product.get("category") or product.get("category_name") or "",
        "category_name": product.get("category_name") or product.get("category") or "",
        "image_data": product.get("image_data") or "",
        "images": product.get("images") or [],
        "sort_order": product.get("sort_order") or 0,
        "is_active": product.get("is_active") is not False,
        "availability_status": product.get("availability_status") or "active",
        "available_days": product.get("available_days") or [],
        "created_at": product.get("created_at"),
    }


@router.get("/public/storefront/{slug}")
async def public_headless_storefront(slug: str, request: Request):
    """Curated public data contract for external/custom tenant websites."""
    shop = await db.shops.find_one({"slug": slug}, {"_id": 0})
    if not shop or shop.get("status") == "suspended":
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    if shop.get("public_read_key_enabled"):
        expected_key = str(shop.get("public_read_key") or "")
        provided_key = str(
            request.headers.get("X-Lapakin-Public-Key")
            or request.query_params.get("key")
            or ""
        )
        if not expected_key or not hmac.compare_digest(provided_key, expected_key):
            raise HTTPException(status_code=401, detail="Public read key diperlukan")

    owner = await db.users.find_one({"user_id": shop.get("owner_user_id")}, {"_id": 0, "tier": 1})
    owner_tier = (owner or {}).get("tier") or "free"
    products = await db.products.find({"shop_id": shop["shop_id"]}, {"_id": 0}).sort([("sort_order", 1), ("created_at", -1)]).to_list(500)
    public_products = [
        _public_storefront_product_payload(product)
        for product in products
        if _lapakin_expose_product_status_fields(product).get("availability_status") != "hidden"
    ]
    categories = sorted({p.get("category_name") or p.get("category") for p in public_products if p.get("category_name") or p.get("category")})

    try:
        await db.storefront_visits.insert_one({
            "shop_id": shop.get("shop_id"),
            "slug": slug,
            "source": "headless_api",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass

    return {
        "ok": True,
        "version": "2026-06-08",
        "mode": "headless_storefront",
        "shop": _public_storefront_shop_payload(shop, owner_tier),
        "products": public_products,
        "categories": categories,
        "links": {
            "lapakin_storefront": f"/toko/{slug}",
            "headless_endpoint": f"/api/public/storefront/{slug}",
        },
    }


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



@router.put("/shops/storefront-leads/{lead_id}/notes")
@router.patch("/shops/storefront-leads/{lead_id}/notes")
async def update_storefront_lead_internal_notes(lead_id: str, request: Request):
    user = await require_user(request)
    shop_id = user.get("shop_id")
    if not shop_id:
        raise HTTPException(status_code=400, detail="Toko belum dibuat")

    try:
        body = await request.json()
    except Exception:
        body = {}

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Payload tidak valid")

    internal_notes = str(body.get("internal_notes", body.get("owner_notes", "")) or "").strip()[:2000]
    now = datetime.now(timezone.utc).isoformat()

    result = await db.storefront_leads.update_one(
        {"shop_id": shop_id, "lead_id": lead_id},
        {"$set": {"internal_notes": internal_notes, "updated_at": now}},
    )
    if not getattr(result, "matched_count", 0):
        raise HTTPException(status_code=404, detail="Lead tidak ditemukan")

    lead = await db.storefront_leads.find_one(
        {"shop_id": shop_id, "lead_id": lead_id},
        {"_id": 0},
    )
    return lead or {"ok": True, "lead_id": lead_id, "internal_notes": internal_notes}



@router.patch("/shops/storefront-leads/{lead_id}")
@router.put("/shops/storefront-leads/{lead_id}")
async def update_storefront_lead_followup(lead_id: str, request: Request):
    user = await require_user(request)
    shop_id = user.get("shop_id")
    if not shop_id:
        raise HTTPException(status_code=400, detail="Toko belum dibuat")

    try:
        body = await request.json()
    except Exception:
        body = {}

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Payload tidak valid")

    update = {}
    now = _lapakin_lead_followup_now_iso()

    if "status" in body or "follow_up_status" in body:
        status_value = body.get("status", body.get("follow_up_status"))
        normalized_status = _lapakin_normalize_lead_followup_status(status_value)
        update["status"] = normalized_status
        update["follow_up_status"] = normalized_status
        if normalized_status != "baru":
            update["followed_up_at"] = now

    if any(key in body for key in ("internal_notes", "owner_notes", "follow_up_notes")):
        notes_value = body.get("internal_notes", body.get("owner_notes", body.get("follow_up_notes", "")))
        update["internal_notes"] = str(notes_value or "").strip()[:2000]

    if not update:
        raise HTTPException(status_code=400, detail="Tidak ada perubahan lead")

    update["updated_at"] = now

    result = await db.storefront_leads.update_one(
        {"shop_id": shop_id, "lead_id": lead_id},
        {"$set": update},
    )
    if not getattr(result, "matched_count", 0):
        raise HTTPException(status_code=404, detail="Lead tidak ditemukan")

    lead = await db.storefront_leads.find_one(
        {"shop_id": shop_id, "lead_id": lead_id},
        {"_id": 0},
    )
    return lead or {"ok": True, "lead_id": lead_id, **update}



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


# LAPAKIN_MALL_PHASE1A_PUBLIC_MVP_V1
def _mall_clean_text(value, limit=500):
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "…"


# LAPAKIN_MALL_PHASE1A_PUBLIC_MVP_V1
def _mall_pick_first(doc, keys):
    for key in keys:
        value = str((doc or {}).get(key) or "").strip()
        if value:
            return value
    return ""


# LAPAKIN_MALL_PHASE1A_PUBLIC_MVP_V1
def _mall_normalize_wa(raw):
    import re

    digits = re.sub(r"\D+", "", str(raw or ""))
    if not digits:
        return ""

    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0"):
        digits = "62" + digits[1:]
    if digits.startswith("8"):
        digits = "62" + digits

    return digits


# LAPAKIN_MALL_PHASE1A_PUBLIC_MVP_V1
def _mall_listing_image_for_card_v3(product):
    product = product or {}

    for key in ["image_url", "thumbnail_url", "photo_url", "image_data"]:
        value = product.get(key)
        if value:
            return value

    images = product.get("images")
    if isinstance(images, list) and images:
        return images[0]

    return ""


# LAPAKIN_MALL_IMAGE_FALLBACK_OG_DEV_V1
def _mall_listing_image_for_card_v3(product):
    image = _mall_listing_image_for_card_v3(product)
    if image:
        return image

    product_id = str((product or {}).get("product_id") or "").strip()
    if product_id:
        return ""

    return ""


# LAPAKIN_MALL_PHASE1A_PUBLIC_MVP_V1
def _mall_product_active(product):
    if not product:
        return False

    availability = str(product.get("availability_status") or "").lower()
    if availability in {"hidden", "out_of_stock"}:
        return False

    if product.get("is_active") is False:
        return False

    status = str(product.get("status") or "").lower()
    if status in {"hidden", "deleted", "inactive"}:
        return False

    return True


# LAPAKIN_MALL_PHASE1A_PUBLIC_MVP_V1
def _mall_shop_active(shop):
    if not shop:
        return False

    status = str(shop.get("status") or "active").lower()
    if status in {"deleted", "suspended", "inactive"}:
        return False

    if shop.get("deleted_at"):
        return False

    return bool(shop.get("slug"))


# LAPAKIN_MALL_PHASE1A_PUBLIC_MVP_V1
def _mall_public_base_url(request: Request):
    proto = request.headers.get("x-forwarded-proto") or "https"
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""

    if not host:
        return ""

    return f"{proto}://{host}".rstrip("/")


# LAPAKIN_MALL_PHASE1E_SUBDOMAIN_READY_V1
def _mall_is_mall_host(request: Request):
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").split(":")[0].lower()
    return host in {"mall.lapakin.my.id", "mall-dev.lapakin.my.id", "mall.dev.lapakin.my.id"} or host.startswith("mall.")


# LAPAKIN_MALL_PHASE1A_PUBLIC_MVP_V1
def _mall_build_order_url(shop, product):
    import urllib.parse

    raw_phone = _mall_pick_first(shop, [
        "whatsapp",
        "whatsapp_number",
        "wa_number",
        "phone",
        "phone_number",
        "contact_phone",
        "order_phone",
        "order_whatsapp",
        "contact_whatsapp",
    ])

    phone = _mall_normalize_wa(raw_phone)
    if not phone:
        return ""

    message = (
        f"Halo {shop.get('name') or 'Toko'}, saya lihat produk "
        f"{product.get('name') or 'ini'} dari Lapakin Mall. "
        "Saya mau pesan, apakah masih tersedia?"
    )

    return f"https://wa.me/{phone}?text={urllib.parse.quote(message)}"


# LAPAKIN_MALL_PHASE1A_PUBLIC_MVP_V1



# LAPAKIN_MALL_RAW_IMAGE_ENDPOINT_SAFE_DEV_V3
def _mall_listing_image_for_card_v3(product):
    product = product or {}

    for key in ["image_url", "thumbnail_url", "photo_url"]:
        value = str(product.get(key) or "").strip()
        if value:
            return value

    product_id = str(product.get("product_id") or "").strip()
    if product_id:
        return f"/api/mall/raw-product-image/{product_id}"

    return ""

def _mall_make_listing_response(listing, product, shop, request: Request):
    product = product or {}
    shop = shop or {}
    listing = listing or {}

    base_url = _mall_public_base_url(request)
    slug = shop.get("slug") or ""
    product_id = product.get("product_id") or listing.get("product_id") or ""
    shop_id = shop.get("shop_id") or listing.get("shop_id") or ""
    category = (
        listing.get("mall_category")
        or product.get("category_name")
        or product.get("category")
        or "Lainnya"
    )

    storefront_url = f"/toko/{slug}" if slug else ""
    public_storefront_url = f"{base_url}/toko/{slug}" if base_url and slug else storefront_url

    # LAPAKIN_MALL_PHASE1E_SUBDOMAIN_READY_V1
    listing_detail_id = listing.get("listing_id") or product_id
    detail_path = f"/p/{listing_detail_id}" if _mall_is_mall_host(request) else f"/mall/p/{listing_detail_id}"
    public_detail_url = f"{base_url}{detail_path}" if base_url else detail_path
    share_og_url = f"{base_url}/api/og/mall/{listing_detail_id}" if base_url else f"/api/og/mall/{listing_detail_id}"

    return {
        "listing_id": listing.get("listing_id"),
        "shop_id": shop_id,
        "product_id": product_id,
        "name": product.get("name") or listing.get("title") or "Produk",
        "description": _mall_clean_text(
            listing.get("highlight")
            or product.get("description")
            or product.get("caption")
            or "",
            260,
        ),
        "price": product.get("price") or 0,
        "stock": product.get("stock"),
        "image": _mall_listing_image_for_card_v3(product),  # LAPAKIN_MALL_IMAGE_FALLBACK_OG_DEV_V1
        "category": category,
        "badge": listing.get("mall_badge") or ("Unggulan" if listing.get("featured") else ""),
        "featured": bool(listing.get("featured")),
        "rank": listing.get("mall_rank") or 100,
        "shop": {
            "shop_id": shop_id,
            "name": shop.get("name") or "Toko",
            "slug": slug,
            "tagline": shop.get("tagline") or shop.get("description") or "",
            "business_type": shop.get("business_type") or "",
            "city": shop.get("city") or shop.get("service_area") or "",
            "brand_color": shop.get("brand_color") or "#C04A3B",
        },
        "links": {
            "storefront": storefront_url,
            "public_storefront": public_storefront_url,
            "detail": detail_path,
            "public_detail": public_detail_url,
            "share_og": share_og_url,
            "order": _mall_build_order_url(shop, product),
        },  # LAPAKIN_MALL_PHASE1D_PRODUCT_DETAIL_OG_V1
    }


# LAPAKIN_MALL_PHASE1A_PUBLIC_MVP_V1
async def _mall_load_approved_listings():
    return await db.mall_listings.find(
        {
            "status": "approved",
            "$or": [
                {"hidden": {"$ne": True}},
                {"hidden": {"$exists": False}},
            ],
        },
        {"_id": 0},
    ).sort([("featured", -1), ("mall_rank", 1), ("created_at", -1)]).limit(120).to_list(120)  # LAPAKIN_MALL_PERFORMANCE_DEV_V1


# LAPAKIN_MALL_PHASE1A_PUBLIC_MVP_V1
@router.get("/mall/listings")
async def public_mall_listings(request: Request, q: str = "", category: str = "all", limit: int = 32):  # LAPAKIN_MALL_PERFORMANCE_DEV_V1
    limit = max(1, min(int(limit or 32), 64))  # LAPAKIN_MALL_PERFORMANCE_DEV_V1
    q_norm = str(q or "").strip().lower()
    category_norm = str(category or "all").strip().lower()

    listings = await _mall_load_approved_listings()

    product_ids = [item.get("product_id") for item in listings if item.get("product_id")]
    shop_ids = [item.get("shop_id") for item in listings if item.get("shop_id")]

    products_by_id = {}
    shops_by_id = {}

    if product_ids:
        products = await db.products.find(
            {"product_id": {"$in": product_ids}},
            {"_id": 0, "image_data": 0, "images": 0},
        ).to_list(len(product_ids))  # LAPAKIN_MALL_PERFORMANCE_DEV_V1
        products_by_id = {item.get("product_id"): item for item in products}

    if shop_ids:
        shops = await db.shops.find({"shop_id": {"$in": shop_ids}}, {"_id": 0}).to_list(len(shop_ids))
        shops_by_id = {item.get("shop_id"): item for item in shops}

    items = []
    categories = set()

    for listing in listings:
        product = products_by_id.get(listing.get("product_id")) or {}
        shop = shops_by_id.get(listing.get("shop_id")) or {}

        if not _mall_product_active(product):
            continue
        if not _mall_shop_active(shop):
            continue

        row = _mall_make_listing_response(listing, product, shop, request)
        categories.add(row.get("category") or "Lainnya")

        if category_norm not in {"all", ""} and str(row.get("category") or "").lower() != category_norm:
            continue

        if q_norm:
            haystack = " ".join([
                str(row.get("name") or ""),
                str(row.get("description") or ""),
                str(row.get("category") or ""),
                str(row.get("shop", {}).get("name") or ""),
                str(row.get("shop", {}).get("business_type") or ""),
                str(row.get("shop", {}).get("city") or ""),
            ]).lower()

            if q_norm not in haystack:
                continue

        items.append(row)

        if len(items) >= limit:
            break

    return {
        "items": items,
        "categories": sorted(categories),
        "summary": {
            "total": len(items),
            "total_approved_raw": len(listings),
            "q": q,
            "category": category,
        },
    }


# LAPAKIN_MALL_PHASE1A_PUBLIC_MVP_V1
@router.post("/mall/events")
async def public_mall_event(request: Request):
    from datetime import datetime, timezone

    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            payload = {}
    except Exception:
        payload = {}

    event = str(payload.get("event") or payload.get("event_type") or "").strip().lower()
    allowed = {
        "mall_view",
        "mall_search",
        "mall_product_click",
        "mall_product_view",
        "mall_order_click",
        "mall_store_click",
    }

    if event not in allowed:
        event = "mall_view"

    doc = {
        "event_id": f"mall_evt_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
        "event_type": event,
        "listing_id": _mall_clean_text(payload.get("listing_id"), 120),
        "product_id": _mall_clean_text(payload.get("product_id"), 120),
        "shop_id": _mall_clean_text(payload.get("shop_id"), 120),
        "query": _mall_clean_text(payload.get("query"), 160),
        "category": _mall_clean_text(payload.get("category"), 160),
        "path": _mall_clean_text(payload.get("path") or request.url.path, 260),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "request": {
            "user_agent": request.headers.get("user-agent", ""),
            "referer": request.headers.get("referer", ""),
            "origin": request.headers.get("origin", ""),
            "client_host": request.client.host if request.client else "",
            "x_forwarded_for": request.headers.get("x-forwarded-for", ""),
        },
    }

    try:
        await db.mall_events.insert_one(doc)
    except Exception:
        pass

    return {"ok": True}


# LAPAKIN_MALL_PHASE1D_PRODUCT_DETAIL_OG_V1
@router.get("/mall/listings/{listing_id}")
async def public_mall_listing_detail(listing_id: str, request: Request):
    listing_id = _mall_clean_text(listing_id, 140)
    if not listing_id:
        raise HTTPException(status_code=404, detail="Produk Mall tidak ditemukan")

    listing = await db.mall_listings.find_one(
        {
            "$or": [
                {"listing_id": listing_id},
                {"product_id": listing_id},
            ],
            "status": "approved",
            "$and": [
                {"$or": [{"hidden": {"$ne": True}}, {"hidden": {"$exists": False}}]},
            ],
        },
        {"_id": 0},
    )

    if not listing:
        raise HTTPException(status_code=404, detail="Produk Mall tidak ditemukan")

    product = await db.products.find_one({"product_id": listing.get("product_id")}, {"_id": 0}) or {}
    shop = await db.shops.find_one({"shop_id": listing.get("shop_id")}, {"_id": 0}) or {}

    if not _mall_product_active(product) or not _mall_shop_active(shop):
        raise HTTPException(status_code=404, detail="Produk Mall tidak tersedia")

    item = _mall_make_listing_response(listing, product, shop, request)

    all_listings = await _mall_load_approved_listings()
    product_ids = [row.get("product_id") for row in all_listings if row.get("product_id") and row.get("product_id") != listing.get("product_id")]
    shop_ids = [row.get("shop_id") for row in all_listings if row.get("shop_id")]

    products_by_id = {}
    shops_by_id = {}

    if product_ids:
        products = await db.products.find(
            {"product_id": {"$in": product_ids}},
            {"_id": 0, "image_data": 0, "images": 0},
        ).to_list(len(product_ids))  # LAPAKIN_MALL_PERFORMANCE_DEV_V1
        products_by_id = {row.get("product_id"): row for row in products}

    if shop_ids:
        shops = await db.shops.find({"shop_id": {"$in": shop_ids}}, {"_id": 0}).to_list(len(shop_ids))
        shops_by_id = {row.get("shop_id"): row for row in shops}

    related = []
    category = str(item.get("category") or "").lower()
    shop_id = item.get("shop_id")

    for row in all_listings:
        if row.get("listing_id") == listing.get("listing_id"):
            continue

        related_product = products_by_id.get(row.get("product_id")) or {}
        related_shop = shops_by_id.get(row.get("shop_id")) or {}

        if not _mall_product_active(related_product) or not _mall_shop_active(related_shop):
            continue

        related_item = _mall_make_listing_response(row, related_product, related_shop, request)
        same_category = str(related_item.get("category") or "").lower() == category
        same_shop = related_item.get("shop_id") == shop_id

        if same_category or same_shop:
            related.append(related_item)

        if len(related) >= 8:
            break

    if len(related) < 4:
        for row in all_listings:
            if row.get("listing_id") == listing.get("listing_id"):
                continue

            if any(existing.get("listing_id") == row.get("listing_id") for existing in related):
                continue

            related_product = products_by_id.get(row.get("product_id")) or {}
            related_shop = shops_by_id.get(row.get("shop_id")) or {}

            if not _mall_product_active(related_product) or not _mall_shop_active(related_shop):
                continue

            related.append(_mall_make_listing_response(row, related_product, related_shop, request))

            if len(related) >= 8:
                break

    return {
        "item": item,
        "related": related,
    }


# LAPAKIN_MALL_CARD_RAW_PRODUCT_IMAGE_DEV_V1
def _mall_parse_image_data(value):
    import base64
    import re

    raw = str(value or "").strip()
    if not raw:
        return None, None

    if raw.startswith("http://") or raw.startswith("https://") or raw.startswith("/"):
        return "redirect", raw

    media_type = "image/jpeg"
    payload = raw

    if raw.startswith("data:"):
        match = re.match(r"^data:([^;]+);base64,(.*)$", raw, flags=re.S)
        if not match:
            return None, None
        media_type = match.group(1) or "image/jpeg"
        payload = match.group(2)

    try:
        return media_type, base64.b64decode(payload)
    except Exception:
        return None, None


# LAPAKIN_MALL_CARD_RAW_PRODUCT_IMAGE_DEV_V1
def _mall_find_raw_product_image(product):
    product = product or {}

    # Prefer real product photo fields. Do not use generated OG poster.
    for key in ["image_url", "thumbnail_url", "photo_url", "image_data"]:
        value = product.get(key)
        media_type, payload = _mall_parse_image_data(value)
        if media_type and payload:
            return media_type, payload

    images = product.get("images")
    if isinstance(images, list):
        for value in images:
            media_type, payload = _mall_parse_image_data(value)
            if media_type and payload:
                return media_type, payload

    return None, None


# LAPAKIN_MALL_CARD_RAW_PRODUCT_IMAGE_DEV_V1
@router.get("/mall/product-image/{product_id}")
async def public_mall_product_image(product_id: str):
    product_id = _mall_clean_text(product_id, 140)
    product = await db.products.find_one({"product_id": product_id}, {"_id": 0})

    if not product:
        raise HTTPException(status_code=404, detail="Gambar produk tidak ditemukan")

    media_type, payload = _mall_find_raw_product_image(product)

    if media_type == "redirect" and payload:
        return RedirectResponse(url=payload)

    if media_type and payload:
        return Response(
            content=payload,
            media_type=media_type,
            headers={
                "Cache-Control": "public, max-age=86400",
            },
        )

    raise HTTPException(status_code=404, detail="Gambar produk tidak tersedia")


# LAPAKIN_MALL_REMOVE_OG_POSTER_CARD_DEV_V1


# LAPAKIN_MALL_RAW_IMAGE_ENDPOINT_SAFE_DEV_V3
def _mall_raw_image_candidate(value):
    if value is None:
        return ""

    if isinstance(value, dict):
        for key in ["url", "image_url", "thumbnail_url", "src", "data", "image_data"]:
            candidate = value.get(key)
            if candidate:
                return str(candidate)
        return ""

    return str(value)


# LAPAKIN_MALL_RAW_IMAGE_ENDPOINT_SAFE_DEV_V3
def _mall_parse_raw_product_image(value):
    import base64
    import re

    raw = _mall_raw_image_candidate(value).strip()
    if not raw:
        return None, None

    if raw.startswith("http://") or raw.startswith("https://") or raw.startswith("/"):
        return "redirect", raw

    media_type = "image/jpeg"
    payload = raw

    if raw.startswith("data:"):
        match = re.match(r"^data:([^;]+);base64,(.*)$", raw, flags=re.S)
        if not match:
            return None, None
        media_type = match.group(1) or "image/jpeg"
        payload = match.group(2)

    try:
        return media_type, base64.b64decode(payload)
    except Exception:
        return None, None


# LAPAKIN_MALL_RAW_IMAGE_ENDPOINT_SAFE_DEV_V3
def _mall_find_raw_product_image_v3(product):
    product = product or {}

    for key in ["image_url", "thumbnail_url", "photo_url", "image_data"]:
        media_type, payload = _mall_parse_raw_product_image(product.get(key))
        if media_type and payload:
            return media_type, payload

    images = product.get("images")
    if isinstance(images, list):
        for item in images:
            media_type, payload = _mall_parse_raw_product_image(item)
            if media_type and payload:
                return media_type, payload

    return None, None


# LAPAKIN_MALL_RAW_IMAGE_ENDPOINT_SAFE_DEV_V3
@router.get("/mall/raw-product-image/{product_id}")
async def public_mall_raw_product_image_v3(product_id: str):
    product_id = _mall_clean_text(product_id, 140)
    product = await db.products.find_one({"product_id": product_id}, {"_id": 0})

    if not product:
        raise HTTPException(status_code=404, detail="Gambar produk tidak ditemukan")

    media_type, payload = _mall_find_raw_product_image_v3(product)

    if media_type == "redirect" and payload:
        return RedirectResponse(url=payload)

    if media_type and payload:
        return Response(
            content=payload,
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=86400"},
        )

    raise HTTPException(status_code=404, detail="Gambar produk tidak tersedia")

