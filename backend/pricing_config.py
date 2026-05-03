"""Dynamic pricing settings.

Admin can override tier prices from dashboard without editing tiers.py.
Tier 1/free is always Rp0.
"""
from copy import deepcopy
from datetime import datetime, timezone

from tiers import TIER_LIMITS

PRICING_SETTINGS_KEY = "pricing_tiers"

TIER_ORDER = ["free", "starter", "pro", "business"]

DEFAULT_PRICES = {
    "free": {"price_idr_month": 0, "price_idr_year": 0},
    "starter": {"price_idr_month": 19000, "price_idr_year": 190000},
    "pro": {"price_idr_month": 49000, "price_idr_year": 490000},
    "business": {"price_idr_month": 149000, "price_idr_year": 1490000},
}


def _normalize_price(value):
    try:
        n = int(value or 0)
    except Exception:
        n = 0
    return max(0, n)


def _default_pricing_payload():
    tiers = {}
    for tier in TIER_ORDER:
        limits = TIER_LIMITS.get(tier, {})
        defaults = DEFAULT_PRICES.get(tier, {})
        tiers[tier] = {
            "tier": tier,
            "label": limits.get("label", tier.title()),
            "price_idr_month": _normalize_price(limits.get("price_idr_month", defaults.get("price_idr_month", 0))),
            "price_idr_year": _normalize_price(limits.get("price_idr_year", defaults.get("price_idr_year", 0))),
        }

    # Tier 1 must always be free.
    tiers["free"]["price_idr_month"] = 0
    tiers["free"]["price_idr_year"] = 0
    return tiers


async def get_pricing_settings(db):
    doc = await db.app_settings.find_one({"key": PRICING_SETTINGS_KEY}, {"_id": 0})
    saved = (doc or {}).get("tiers") or {}
    defaults = _default_pricing_payload()

    merged = {}
    for tier in TIER_ORDER:
        item = {**defaults[tier], **(saved.get(tier) or {})}
        item["tier"] = tier
        item["label"] = defaults[tier]["label"]
        item["price_idr_month"] = _normalize_price(item.get("price_idr_month"))
        item["price_idr_year"] = _normalize_price(item.get("price_idr_year"))

        if tier == "free":
            item["price_idr_month"] = 0
            item["price_idr_year"] = 0

        merged[tier] = item

    return merged


async def save_pricing_settings(db, incoming: dict, admin_user_id: str = ""):
    current = await get_pricing_settings(db)
    now = datetime.now(timezone.utc).isoformat()

    for tier in TIER_ORDER:
        if tier not in incoming:
            continue

        data = incoming.get(tier) or {}

        if tier == "free":
            current[tier]["price_idr_month"] = 0
            current[tier]["price_idr_year"] = 0
            continue

        current[tier]["price_idr_month"] = _normalize_price(data.get("price_idr_month"))
        current[tier]["price_idr_year"] = _normalize_price(data.get("price_idr_year"))

    await db.app_settings.update_one(
        {"key": PRICING_SETTINGS_KEY},
        {"$set": {
            "key": PRICING_SETTINGS_KEY,
            "tiers": current,
            "updated_at": now,
            "updated_by": admin_user_id,
        }},
        upsert=True,
    )

    return current


async def get_tier_limits_with_pricing(db):
    pricing = await get_pricing_settings(db)
    tiers = deepcopy(TIER_LIMITS)

    for tier, price in pricing.items():
        if tier in tiers:
            tiers[tier]["price_idr_month"] = price["price_idr_month"]
            tiers[tier]["price_idr_year"] = price["price_idr_year"]

    return tiers


async def get_plan_price(db, tier: str, cycle: str):
    pricing = await get_pricing_settings(db)
    item = pricing.get(tier) or pricing.get("free")
    if cycle == "yearly":
        return int(item.get("price_idr_year") or 0)
    return int(item.get("price_idr_month") or 0)
