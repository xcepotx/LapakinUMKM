"""
Lapakin tier / subscription configuration.

3 tiers: free, pro, business.
Each tier has limits on: max_products, monthly AI photo enhancer,
monthly AI copywriting, monthly Toko Card downloads, branding, etc.

Usage tracking is per-month (YYYY-MM bucket) in MongoDB collection
`monthly_usage` with key (user_id, year_month, kind).
"""
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import HTTPException

JAKARTA = timezone(timedelta(hours=7))

# Sentinel for unlimited
UNLIMITED = -1

TIER_LIMITS = {
    "free": {
        "label": "Gratis",
        "price_idr_month": 0,
        "price_idr_year": 0,
        "max_products": 5,
        "max_users_per_shop": 1,
        "max_shops_per_user": 1,
        "ai_photo_per_month": 5,
        "ai_copy_per_month": 5,
        "ai_cover_per_month": 2,
        "toko_card_per_month": 5,
        "broadcast_per_month": 0,            # WhatsApp broadcast
        "remove_branding": False,             # "Powered by Lapakin"
        "custom_subdomain": False,            # nama.lapakin.my.id
        "custom_domain": False,               # tokokamu.com
        "multi_shift_schedule": False,
        "instagram_autopost": False,
        "csv_export": False,
        "api_access": False,
        "analytics": False,
        "priority_support": False,
    },
    "pro": {
        "label": "Pro",
        "price_idr_month": 49000,
        "price_idr_year": 490000,
        "max_products": 100,
        "max_users_per_shop": 2,
        "max_shops_per_user": 1,
        "ai_photo_per_month": 100,
        "ai_copy_per_month": UNLIMITED,
        "ai_cover_per_month": 20,
        "toko_card_per_month": UNLIMITED,
        "broadcast_per_month": 4,
        "remove_branding": True,
        "custom_subdomain": True,
        "custom_domain": False,
        "multi_shift_schedule": True,
        "instagram_autopost": False,
        "csv_export": True,
        "api_access": False,
        "analytics": True,
        "priority_support": True,
    },
    "business": {
        "label": "Bisnis",
        "price_idr_month": 149000,
        "price_idr_year": 1490000,
        "max_products": UNLIMITED,
        "max_users_per_shop": 5,
        "max_shops_per_user": 3,
        "ai_photo_per_month": UNLIMITED,
        "ai_copy_per_month": UNLIMITED,
        "ai_cover_per_month": UNLIMITED,
        "toko_card_per_month": UNLIMITED,
        "broadcast_per_month": UNLIMITED,
        "remove_branding": True,
        "custom_subdomain": True,
        "custom_domain": True,
        "multi_shift_schedule": True,
        "instagram_autopost": True,
        "csv_export": True,
        "api_access": True,
        "analytics": True,
        "priority_support": True,
    },
}

VALID_TIERS = list(TIER_LIMITS.keys())

def get_tier(user: dict) -> str:
    t = (user or {}).get("tier") or "free"
    return t if t in VALID_TIERS else "free"

def get_limits(tier: str) -> dict:
    return TIER_LIMITS.get(tier, TIER_LIMITS["free"])

def is_unlimited(value: int) -> bool:
    return value == UNLIMITED

def current_month_bucket() -> str:
    """YYYY-MM in Jakarta timezone (so monthly reset aligns with Indonesian biz day)."""
    now = datetime.now(JAKARTA)
    return f"{now.year:04d}-{now.month:02d}"

# ----- Usage tracking helpers (need a Motor collection) -----
async def get_usage(coll, user_id: str, kind: str, ym: Optional[str] = None) -> int:
    """Get current month's usage count for given kind."""
    ym = ym or current_month_bucket()
    doc = await coll.find_one({"user_id": user_id, "year_month": ym, "kind": kind}, {"_id": 0, "count": 1})
    return int((doc or {}).get("count", 0))

async def increment_usage(coll, user_id: str, kind: str) -> int:
    """Atomically increment monthly usage counter and return new count."""
    ym = current_month_bucket()
    res = await coll.find_one_and_update(
        {"user_id": user_id, "year_month": ym, "kind": kind},
        {"$inc": {"count": 1}, "$setOnInsert": {"updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
        return_document=True,
    )
    return int(res.get("count", 1))

async def check_quota(coll, user: dict, kind: str, limit_key: str) -> dict:
    """Raise 402 Payment Required if monthly limit exceeded.

    `kind` is the usage bucket name (e.g., 'ai_photo', 'ai_copy', 'toko_card').
    `limit_key` is the corresponding TIER_LIMITS key (e.g., 'ai_photo_per_month').
    Returns {used, limit, remaining} dict for UI hints.
    """
    tier = get_tier(user)
    limit = get_limits(tier).get(limit_key, 0)
    used = await get_usage(coll, user["user_id"], kind)
    if not is_unlimited(limit) and used >= limit:
        raise HTTPException(
            status_code=402,
            detail=f"Kuota {kind} bulanan tier {tier} sudah habis ({used}/{limit}). Upgrade tier untuk lanjut.",
        )
    return {
        "used": used,
        "limit": "unlimited" if is_unlimited(limit) else limit,
        "remaining": "unlimited" if is_unlimited(limit) else max(0, limit - used),
    }

def require_feature(user: dict, feature_key: str):
    """Raise 402 if tier doesn't have the boolean feature flag enabled."""
    tier = get_tier(user)
    if not get_limits(tier).get(feature_key, False):
        raise HTTPException(
            status_code=402,
            detail=f"Fitur '{feature_key}' tidak tersedia di tier {tier}. Upgrade untuk membuka fitur ini.",
        )
