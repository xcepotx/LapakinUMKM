"""Admin routes: all require role=admin."""
import asyncio
import os
import platform
from pathlib import Path
import shutil
import time
import uuid
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Query, Request

from deps import (
    db, require_admin, log_admin_action, hash_password, asyncio_gather_safe,
    TWILIO_ACCOUNT_SID, TWILIO_WHATSAPP_FROM,
)
from models import TierIn, StatusIn, FeaturedIn, BroadcastIn
from tiers import VALID_TIERS, get_tier
from payment_service import get_plan_with_dynamic_price
from pricing_config import get_pricing_settings, save_pricing_settings
from routes.whatsapp import _wa_send

router = APIRouter()

class AdminPricingIn(BaseModel):
    tiers: dict


class ManualPaymentReviewIn(BaseModel):
    admin_note: Optional[str] = ""



def _read_proc_stat_cpu():
    try:
        with open("/proc/stat", "r") as f:
            parts = f.readline().split()
        if not parts or parts[0] != "cpu":
            return None
        values = [int(x) for x in parts[1:]]
        idle = values[3] + (values[4] if len(values) > 4 else 0)
        total = sum(values)
        return total, idle
    except Exception:
        return None


async def _cpu_percent_sample():
    first = _read_proc_stat_cpu()
    if not first:
        return None
    await asyncio.sleep(0.2)
    second = _read_proc_stat_cpu()
    if not second:
        return None

    total_delta = second[0] - first[0]
    idle_delta = second[1] - first[1]
    if total_delta <= 0:
        return None
    return round(max(0, min(100, (1 - idle_delta / total_delta) * 100)), 1)


def _read_meminfo():
    data = {}
    try:
        with open("/proc/meminfo", "r") as f:
            for line in f:
                key, val = line.split(":", 1)
                data[key] = int(val.strip().split()[0]) * 1024
    except Exception:
        return None

    total = data.get("MemTotal", 0)
    available = data.get("MemAvailable", 0)
    used = max(0, total - available)
    pct = round((used / total) * 100, 1) if total else 0
    return {
        "total_bytes": total,
        "used_bytes": used,
        "available_bytes": available,
        "percent": pct,
    }


def _read_uptime_seconds():
    try:
        with open("/proc/uptime", "r") as f:
            return int(float(f.read().split()[0]))
    except Exception:
        return None


async def _run_cmd(*args):
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=2)
        except asyncio.TimeoutError:
            proc.kill()
            return ""
        return out.decode("utf-8", errors="ignore").strip()
    except Exception:
        return ""


async def _service_status(service_name: str):
    active = await _run_cmd("systemctl", "is-active", service_name)
    enabled = await _run_cmd("systemctl", "is-enabled", service_name)
    main_pid = await _run_cmd("systemctl", "show", service_name, "--property=MainPID", "--value")
    sub_state = await _run_cmd("systemctl", "show", service_name, "--property=SubState", "--value")
    since = await _run_cmd("systemctl", "show", service_name, "--property=ActiveEnterTimestamp", "--value")

    return {
        "name": service_name,
        "active": active or "unknown",
        "enabled": enabled or "unknown",
        "sub_state": sub_state or "",
        "main_pid": int(main_pid) if main_pid.isdigit() else None,
        "active_since": since or "",
    }


async def _process_info(pid):
    if not pid:
        return {}
    proc_dir = f"/proc/{pid}"
    try:
        stat = Path(proc_dir, "stat").read_text().split()
        rss_pages = int(stat[23])
        page_size = os.sysconf("SC_PAGE_SIZE")
        rss_bytes = rss_pages * page_size
    except Exception:
        rss_bytes = None

    try:
        cmdline = Path(proc_dir, "cmdline").read_text().replace("\x00", " ").strip()
    except Exception:
        cmdline = ""

    return {
        "pid": pid,
        "rss_bytes": rss_bytes,
        "cmdline": cmdline,
    }




@router.get("/admin/server/metrics")
async def admin_server_metrics(request: Request):
    """VPS/server health metrics for admin-only ops dashboard."""
    await require_admin(request)

    cpu_percent = await _cpu_percent_sample()
    memory = _read_meminfo()

    disk_total, disk_used, disk_free = shutil.disk_usage("/")
    disk_percent = round((disk_used / disk_total) * 100, 1) if disk_total else 0

    try:
        load_1, load_5, load_15 = os.getloadavg()
        load_average = {
            "1m": round(load_1, 2),
            "5m": round(load_5, 2),
            "15m": round(load_15, 2),
        }
    except Exception:
        load_average = {"1m": None, "5m": None, "15m": None}

    service = await _service_status("lapakin-backend.service")
    process = await _process_info(service.get("main_pid"))

    return {
        "ok": True,
        "hostname": platform.node(),
        "platform": platform.platform(),
        "python_version": platform.python_version(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "uptime_seconds": _read_uptime_seconds(),
        "cpu": {
            "percent": cpu_percent,
            "cores": os.cpu_count(),
            "load_average": load_average,
        },
        "memory": memory,
        "disk": {
            "mount": "/",
            "total_bytes": disk_total,
            "used_bytes": disk_used,
            "free_bytes": disk_free,
            "percent": disk_percent,
        },
        "service": service,
        "process": process,
    }


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




def _admin_first_present(doc: dict, *keys):
    for key in keys:
        value = doc.get(key)
        if value not in (None, ""):
            return value
    return None


def _admin_user_lifecycle_summary(user: dict) -> dict:
    created_at = _admin_first_present(user, "created_at", "registered_at")
    updated_at = _admin_first_present(user, "updated_at")
    trial_started_at = _admin_first_present(user, "trial_started_at", "trial_start_at", "trial_start")
    trial_expires_at = _admin_first_present(user, "trial_expires_at", "trial_until", "trial_end_at")
    trial_ended_at = _admin_first_present(user, "trial_expired_at", "trial_ended_at")
    tier_updated_at = _admin_first_present(user, "tier_updated_at")
    subscription_started_at = _admin_first_present(user, "subscription_started_at")
    subscription_expires_at = _admin_first_present(user, "subscription_expires_at")

    return {
        "account_created_at": created_at,
        "account_updated_at": updated_at,
        "trial_started_at": trial_started_at,
        "trial_expires_at": trial_expires_at,
        "trial_ended_at": trial_ended_at,
        "trial": bool(user.get("trial")),
        "trial_used": bool(user.get("trial_used")),
        "trial_expired": bool(user.get("trial_expired")),
        "tier": user.get("tier") or "free",
        "tier_updated_at": tier_updated_at,
        "subscription_status": user.get("subscription_status"),
        "subscription_plan_id": user.get("subscription_plan_id"),
        "subscription_cycle": user.get("subscription_cycle"),
        "subscription_started_at": subscription_started_at,
        "subscription_expires_at": subscription_expires_at,
    }


def _admin_amount_value(doc: dict) -> float:
    for key in ("amount", "amount_total", "total", "total_amount", "nominal", "price"):
        value = doc.get(key)
        if value in (None, ""):
            continue
        try:
            return float(value)
        except Exception:
            continue
    return 0.0


async def _admin_user_shop_summary(user: dict) -> dict:
    query = None
    if user.get("shop_id"):
        query = {"shop_id": user.get("shop_id")}

    shop = None
    if query:
        shop = await db.shops.find_one(query, {"_id": 0})

    if not shop and user.get("user_id"):
        shop = await db.shops.find_one({"owner_user_id": user.get("user_id")}, {"_id": 0})

    if not shop:
        return {
            "shop_id": user.get("shop_id"),
            "name": None,
            "slug": None,
            "status": None,
            "created_at": None,
            "updated_at": None,
        }

    return {
        "shop_id": shop.get("shop_id"),
        "name": shop.get("name"),
        "slug": shop.get("slug"),
        "status": shop.get("status"),
        "renderer": shop.get("storefront_renderer"),
        "mode": shop.get("storefront_mode"),
        "style": shop.get("storefront_style"),
        "created_at": shop.get("created_at"),
        "updated_at": shop.get("updated_at"),
    }


async def _admin_user_deposit_summary(user: dict) -> dict:
    user_id = user.get("user_id")
    email = user.get("email")
    query_parts = []
    if user_id:
        query_parts.append({"user_id": user_id})
    if email:
        query_parts.append({"email": email})
    query = {"$or": query_parts} if query_parts else {"user_id": "__none__"}

    payments = await db.payments.find(query, {"_id": 0}).sort("created_at", -1).limit(25).to_list(25)

    total_success = 0.0
    pending_count = 0
    last_payment_at = None
    last_payment_status = None

    for idx, payment in enumerate(payments):
        status = str(payment.get("status") or "").lower()
        if idx == 0:
            last_payment_at = payment.get("created_at") or payment.get("updated_at")
            last_payment_status = payment.get("status")
        if status in {"success", "paid", "approved", "completed"}:
            total_success += _admin_amount_value(payment)
        elif status in {"pending", "pending_review", "waiting", "review"}:
            pending_count += 1

    wallet = None
    if user_id:
        wallet = await db.wallets.find_one({"user_id": user_id}, {"_id": 0})
        if not wallet:
            wallet = await db.deposits.find_one({"user_id": user_id}, {"_id": 0})

    balance = 0.0
    if wallet:
        for key in ("balance", "deposit_balance", "saldo", "amount"):
            if wallet.get(key) not in (None, ""):
                try:
                    balance = float(wallet.get(key))
                    break
                except Exception:
                    pass

    return {
        "balance": balance,
        "total_success_amount": total_success,
        "pending_count": pending_count,
        "last_payment_at": last_payment_at,
        "last_payment_status": last_payment_status,
        "payments_count_sample": len(payments),
    }


async def _admin_enrich_user_for_admin(user: dict) -> dict:
    doc = dict(user or {})
    lifecycle = _admin_user_lifecycle_summary(doc)
    doc["admin_lifecycle"] = lifecycle

    for key, value in lifecycle.items():
        if key.endswith("_at") and not doc.get(key):
            doc[key] = value
    if not doc.get("account_created_at"):
        doc["account_created_at"] = lifecycle.get("account_created_at")
    if not doc.get("account_updated_at"):
        doc["account_updated_at"] = lifecycle.get("account_updated_at")

    shop = await _admin_user_shop_summary(doc)
    doc["admin_shop"] = shop
    doc["shop_name"] = shop.get("name")
    doc["shop_slug"] = shop.get("slug")
    doc["shop_status"] = shop.get("status")

    deposit = await _admin_user_deposit_summary(doc)
    doc["admin_deposit"] = deposit

    return doc



# 3. List users
@router.get("/admin/pricing")
async def admin_get_pricing(request: Request):
    admin = await require_admin(request)
    tiers = await get_pricing_settings(db)
    return {"tiers": tiers}


@router.put("/admin/pricing")
async def admin_update_pricing(data: AdminPricingIn, request: Request):
    admin = await require_admin(request)
    tiers = await save_pricing_settings(db, data.tiers or {}, admin.get("user_id", ""))

    await log_admin_action(
        admin,
        "pricing_update",
        "pricing",
        "tiers",
        {"tiers": tiers},
    )

    return {"ok": True, "tiers": tiers}


@router.get("/admin/users")
async def admin_list_users(request: Request, q: str = "", limit: int = 200):
    await require_admin(request)
    flt = {}
    if q:
        flt["$or"] = [{"email": {"$regex": q, "$options": "i"}},
                      {"name": {"$regex": q, "$options": "i"}}]
    users = await db.users.find(flt, {"_id": 0, "password_hash": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return [await _admin_enrich_user_for_admin(user) for user in users]


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
    now = datetime.now(timezone.utc)

    set_fields = {
        "tier": data.tier,
        "tier_updated_at": now.isoformat(),
        "subscription_status": "active",
        "subscription_unsuspended_at": now.isoformat(),
        "subscription_suspended_at": None,
        "subscription_suspend_reason": None,
    }

    if data.tier == "free":
        set_fields.update({
            "subscription_plan_id": None,
            "subscription_cycle": None,
            "subscription_expires_at": None,
        })
    else:
        exp_raw = user.get("subscription_expires_at")
        exp = None
        if exp_raw:
            try:
                exp = datetime.fromisoformat(str(exp_raw).replace("Z", "+00:00"))
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
            except Exception:
                exp = None

        if not exp or exp < now:
            set_fields["subscription_expires_at"] = (now + timedelta(days=30)).isoformat()

        set_fields["subscription_plan_id"] = user.get("subscription_plan_id") or f"{data.tier}_manual"
        set_fields["subscription_cycle"] = user.get("subscription_cycle") or "manual"

    await db.users.update_one(
        {"user_id": user_id},
        {"$set": set_fields}
    )
    await log_admin_action(admin, "user_tier_change", "user", user_id,
                           {"from": old_tier, "to": data.tier})
    return {"ok": True, "user_id": user_id, "tier": data.tier}




async def _admin_enrich_top_store_rows(rows: list[dict]) -> list[dict]:
    if not rows:
        return []

    shop_ids = [row.get("shop_id") for row in rows if row.get("shop_id")]
    slugs = [row.get("slug") for row in rows if row.get("slug")]
    query_parts = []
    if shop_ids:
        query_parts.append({"shop_id": {"$in": shop_ids}})
    if slugs:
        query_parts.append({"slug": {"$in": slugs}})

    shops = []
    if query_parts:
        shops = await db.shops.find({"$or": query_parts}, {"_id": 0}).to_list(500)

    by_shop_id = {shop.get("shop_id"): shop for shop in shops if shop.get("shop_id")}
    by_slug = {shop.get("slug"): shop for shop in shops if shop.get("slug")}

    enriched = []
    for row in rows:
        shop = by_shop_id.get(row.get("shop_id")) or by_slug.get(row.get("slug")) or {}
        enriched.append({
            "shop_id": row.get("shop_id") or shop.get("shop_id"),
            "slug": row.get("slug") or shop.get("slug"),
            "shop_name": shop.get("name") or row.get("shop_name") or row.get("slug") or row.get("shop_id") or "Toko tanpa nama",
            "visits": int(row.get("visits") or 0),
        })
    return enriched


async def _admin_try_top_store_aggregation(collection_name: str, limit: int = 8) -> list[dict]:
    collection = db[collection_name]
    event_names = ["page_view", "storefront_view", "visit", "store_visit"]

    pipelines = [
        [
            {"$match": {"$or": [
                {"event": {"$in": event_names}},
                {"event_type": {"$in": event_names}},
                {"type": {"$in": event_names}},
                {"action": {"$in": event_names}},
            ]}},
            {"$group": {"_id": {"shop_id": "$shop_id", "slug": "$shop_slug"}, "visits": {"$sum": 1}}},
            {"$sort": {"visits": -1}},
            {"$limit": limit},
        ],
        [
            {"$match": {"$or": [
                {"event": {"$in": event_names}},
                {"event_type": {"$in": event_names}},
                {"type": {"$in": event_names}},
                {"action": {"$in": event_names}},
            ]}},
            {"$group": {"_id": {"shop_id": "$shop_id", "slug": "$slug"}, "visits": {"$sum": 1}}},
            {"$sort": {"visits": -1}},
            {"$limit": limit},
        ],
        [
            {"$group": {"_id": {"shop_id": "$shop_id", "slug": "$shop_slug"}, "visits": {"$sum": {"$ifNull": ["$visits", {"$ifNull": ["$count", 1]}]}}}},
            {"$sort": {"visits": -1}},
            {"$limit": limit},
        ],
        [
            {"$group": {"_id": {"shop_id": "$shop_id", "slug": "$slug"}, "visits": {"$sum": {"$ifNull": ["$visits", {"$ifNull": ["$count", 1]}]}}}},
            {"$sort": {"visits": -1}},
            {"$limit": limit},
        ],
    ]

    for pipeline in pipelines:
        try:
            docs = await collection.aggregate(pipeline).to_list(limit)
        except Exception:
            continue

        rows = []
        for doc in docs:
            key = doc.get("_id") or {}
            shop_id = key.get("shop_id") if isinstance(key, dict) else None
            slug = key.get("slug") if isinstance(key, dict) else None
            visits = int(doc.get("visits") or 0)
            if not shop_id and not slug:
                continue
            if visits <= 0:
                continue
            rows.append({"shop_id": shop_id, "slug": slug, "visits": visits})

        if rows:
            return rows

    return []


@router.get("/admin/analytics/top-stores")
async def admin_top_stores_visits(request: Request, limit: int = 8):
    await require_admin(request)
    limit = max(1, min(int(limit or 8), 20))

    collection_names = set(await db.list_collection_names())
    candidates = [
        "analytics_events",
        "storefront_events",
        "storefront_analytics",
        "storefront_analytics_daily",
        "shop_analytics_daily",
        "storefront_visits",
        "visit_logs",
    ]

    rows = []
    used_collection = None
    for name in candidates:
        if name not in collection_names:
            continue
        rows = await _admin_try_top_store_aggregation(name, limit=limit)
        if rows:
            used_collection = name
            break

    enriched = await _admin_enrich_top_store_rows(rows)
    total_visits = sum(int(row.get("visits") or 0) for row in enriched)
    return {
        "ok": True,
        "limit": limit,
        "source_collection": used_collection,
        "total_visits": total_visits,
        "rows": enriched,
    }

# Manual QRIS tier payment review
async def _activate_manual_tier_payment(payment: dict, admin: dict):
    plan_id = payment.get("plan_id")
    plan = await get_plan_with_dynamic_price(db, plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail="Paket pembayaran tidak valid")

    user = await db.users.find_one({"user_id": payment.get("user_id")}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User pembayaran tidak ditemukan")

    now = datetime.now(timezone.utc)
    cur_tier = user.get("tier") or "free"
    cur_exp = user.get("subscription_expires_at")
    start = now
    if cur_tier == plan.get("tier") and cur_exp:
        try:
            exp_dt = datetime.fromisoformat(str(cur_exp).replace("Z", "+00:00"))
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
            if exp_dt > now:
                start = exp_dt
        except Exception:
            pass

    new_exp = start + timedelta(days=int(plan.get("duration_days") or 30))
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "tier": plan["tier"],
            "trial": False,
            "trial_expires_at": None,
            "trial_used": True,
            "trial_expired": False,
            "trial_expired_at": None,
            "subscription_plan_id": plan_id,
            "subscription_cycle": plan.get("cycle"),
            "subscription_started_at": now.isoformat(),
            "subscription_expires_at": new_exp.isoformat(),
            "subscription_last_order_id": payment.get("order_id"),
            "subscription_status": "active",
            "subscription_unsuspended_at": now.isoformat(),
            "subscription_suspended_at": None,
            "subscription_suspend_reason": None,
            "tier_updated_at": now.isoformat(),
        }},
    )
    await log_admin_action(
        admin,
        "manual_payment_approved",
        "payment",
        payment.get("order_id"),
        {"user_id": user["user_id"], "from": get_tier(user), "to": plan["tier"], "plan_id": plan_id},
    )
    return {"tier": plan["tier"], "expires_at": new_exp.isoformat()}


def _public_admin_manual_payment(doc: dict):
    if not doc:
        return None
    return {
        "order_id": doc.get("order_id"),
        "user_id": doc.get("user_id"),
        "user_email": doc.get("user_email"),
        "user_name": doc.get("user_name"),
        "plan_id": doc.get("plan_id"),
        "plan_label": doc.get("plan_label") or doc.get("plan_id"),
        "tier": doc.get("tier"),
        "cycle": doc.get("cycle"),
        "amount": doc.get("amount"),
        "status": doc.get("status"),
        "proof_image": doc.get("proof_image"),
        "proof_filename": doc.get("proof_filename"),
        "proof_uploaded_at": doc.get("proof_uploaded_at"),
        "admin_note": doc.get("admin_note"),
        "reviewed_by": doc.get("reviewed_by"),
        "reviewed_at": doc.get("reviewed_at"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


@router.get("/admin/manual-payments")
async def admin_manual_payments(
    request: Request,
    status: str = Query(default="pending_review"),
    limit: int = Query(default=100, ge=1, le=200),
):
    await require_admin(request)
    query = {"provider": "manual_qris"}
    if status and status != "all":
        query["status"] = status
    docs = await db.payments.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": [_public_admin_manual_payment(d) for d in docs]}


@router.post("/admin/manual-payments/{order_id}/approve")
async def admin_manual_payment_approve(order_id: str, data: ManualPaymentReviewIn, request: Request):
    admin = await require_admin(request)
    payment = await db.payments.find_one({"order_id": order_id, "provider": "manual_qris"}, {"_id": 0})
    if not payment:
        raise HTTPException(status_code=404, detail="Pembayaran manual tidak ditemukan")
    if payment.get("status") == "success":
        return {"ok": True, "already_approved": True}
    if not payment.get("proof_image"):
        raise HTTPException(status_code=400, detail="Bukti pembayaran belum diupload")

    activation = await _activate_manual_tier_payment(payment, admin)
    now = datetime.now(timezone.utc)
    await db.payments.update_one(
        {"order_id": order_id, "provider": "manual_qris"},
        {"$set": {
            "status": "success",
            "payment_type": "manual_qris",
            "admin_note": data.admin_note or "Disetujui admin Lapakin",
            "reviewed_by": admin.get("user_id"),
            "reviewed_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }},
    )
    return {"ok": True, "order_id": order_id, **activation}


@router.post("/admin/manual-payments/{order_id}/reject")
async def admin_manual_payment_reject(order_id: str, data: ManualPaymentReviewIn, request: Request):
    admin = await require_admin(request)
    payment = await db.payments.find_one({"order_id": order_id, "provider": "manual_qris"}, {"_id": 0})
    if not payment:
        raise HTTPException(status_code=404, detail="Pembayaran manual tidak ditemukan")
    if payment.get("status") == "success":
        raise HTTPException(status_code=400, detail="Pembayaran sudah disetujui")

    now = datetime.now(timezone.utc)
    await db.payments.update_one(
        {"order_id": order_id, "provider": "manual_qris"},
        {"$set": {
            "status": "rejected",
            "admin_note": data.admin_note or "Bukti pembayaran ditolak. Silakan upload ulang bukti yang benar.",
            "reviewed_by": admin.get("user_id"),
            "reviewed_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }},
    )
    await log_admin_action(
        admin,
        "manual_payment_rejected",
        "payment",
        order_id,
        {"user_id": payment.get("user_id"), "plan_id": payment.get("plan_id")},
    )
    return {"ok": True, "order_id": order_id}


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
