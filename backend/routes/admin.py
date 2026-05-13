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
from error_log_service import log_client_error, public_error_log

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






def _admin_parse_iso_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _admin_now_iso():
    return datetime.now(timezone.utc).isoformat()


async def _admin_write_audit_log(
    admin: dict,
    action: str,
    target_type: str,
    target_id: str,
    before: dict | None = None,
    after: dict | None = None,
    reason: str = "",
    target_email: str = "",
):
    audit = {
        "audit_id": f"audit_{uuid.uuid4().hex[:12]}",
        "created_at": _admin_now_iso(),
        "admin_user_id": (admin or {}).get("user_id"),
        "admin_email": (admin or {}).get("email"),
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "target_user_id": target_id if target_type == "user" else None,
        "target_email": target_email,
        "before": before or {},
        "after": after or {},
        "reason": reason or "",
    }
    await db.admin_audit_logs.insert_one(audit)
    audit.pop("_id", None)
    return audit


def _admin_trial_public_state(user: dict) -> dict:
    return {
        "trial": bool(user.get("trial")),
        "trial_used": bool(user.get("trial_used")),
        "trial_expired": bool(user.get("trial_expired")),
        "trial_started_at": user.get("trial_started_at"),
        "trial_expires_at": user.get("trial_expires_at"),
        "trial_expired_at": user.get("trial_expired_at"),
        "tier": user.get("tier") or "free",
    }


@router.get("/admin/audit-logs")
async def admin_audit_logs(request: Request, limit: int = 50, target_user_id: str = ""):
    await require_admin(request)
    limit = max(1, min(int(limit or 50), 200))
    query = {}
    if target_user_id:
        query["target_user_id"] = target_user_id
    items = await db.admin_audit_logs.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": items, "limit": limit}


@router.post("/admin/users/{user_id}/trial/extend")
async def admin_extend_user_trial(user_id: str, request: Request):
    admin = await require_admin(request)
    try:
        body = await request.json()
    except Exception:
        body = {}

    days = int(body.get("days") or 7)
    days = max(1, min(days, 365))
    reason = str(body.get("reason") or "").strip()

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    now = datetime.now(timezone.utc)
    current_expiry = _admin_parse_iso_dt(user.get("trial_expires_at"))
    base = current_expiry if current_expiry and current_expiry > now else now
    new_expiry = base + timedelta(days=days)
    now_iso = now.isoformat()

    before = _admin_trial_public_state(user)
    updates = {
        "trial": True,
        "trial_used": True,
        "trial_expired": False,
        "trial_expires_at": new_expiry.isoformat(),
        "updated_at": now_iso,
    }
    if not user.get("trial_started_at"):
        updates["trial_started_at"] = now_iso

    await db.users.update_one({"user_id": user_id}, {"$set": updates})
    updated = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    after = _admin_trial_public_state(updated or {})

    audit = await _admin_write_audit_log(
        admin=admin or {},
        action="trial.extend",
        target_type="user",
        target_id=user_id,
        target_email=user.get("email") or "",
        before=before,
        after={**after, "extended_days": days},
        reason=reason,
    )

    if "_admin_enrich_user_for_admin" in globals():
        updated = await _admin_enrich_user_for_admin(updated)

    return {"ok": True, "user": updated, "audit": audit}


@router.post("/admin/users/{user_id}/trial/end")
async def admin_end_user_trial(user_id: str, request: Request):
    admin = await require_admin(request)
    try:
        body = await request.json()
    except Exception:
        body = {}

    reason = str(body.get("reason") or "").strip()
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    now_iso = _admin_now_iso()
    before = _admin_trial_public_state(user)
    updates = {
        "trial": False,
        "trial_used": True,
        "trial_expired": True,
        "trial_expired_at": now_iso,
        "trial_expires_at": now_iso,
        "updated_at": now_iso,
    }

    await db.users.update_one({"user_id": user_id}, {"$set": updates})
    updated = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    after = _admin_trial_public_state(updated or {})

    audit = await _admin_write_audit_log(
        admin=admin or {},
        action="trial.end",
        target_type="user",
        target_id=user_id,
        target_email=user.get("email") or "",
        before=before,
        after=after,
        reason=reason,
    )

    if "_admin_enrich_user_for_admin" in globals():
        updated = await _admin_enrich_user_for_admin(updated)

    return {"ok": True, "user": updated, "audit": audit}



def _admin_payment_amount(payment: dict) -> float:
    for key in ("amount", "amount_total", "total", "total_amount", "nominal", "price"):
        value = payment.get(key)
        if value in (None, ""):
            continue
        try:
            return float(value)
        except Exception:
            continue
    return 0.0


def _admin_payment_public_state(payment: dict) -> dict:
    return {
        "payment_id": payment.get("payment_id") or payment.get("id"),
        "user_id": payment.get("user_id"),
        "email": payment.get("email") or payment.get("user_email"),
        "status": payment.get("status"),
        "plan_id": payment.get("plan_id"),
        "tier": payment.get("tier"),
        "amount": _admin_payment_amount(payment),
        "updated_at": payment.get("updated_at"),
    }


async def _admin_find_payment(payment_id: str):
    return await db.payments.find_one(
        {"$or": [{"payment_id": payment_id}, {"id": payment_id}]},
        {"_id": 0},
    )


async def _admin_enrich_payment_row(payment: dict) -> dict:
    row = dict(payment or {})
    user = None
    if row.get("user_id"):
        user = await db.users.find_one({"user_id": row.get("user_id")}, {"_id": 0, "password_hash": 0})
    if not user and (row.get("email") or row.get("user_email")):
        user = await db.users.find_one({"email": row.get("email") or row.get("user_email")}, {"_id": 0, "password_hash": 0})

    if user:
        row["email"] = row.get("email") or user.get("email")
        row["user_email"] = row.get("user_email") or user.get("email")
        row["user_name"] = user.get("name")
        row["tier"] = row.get("tier") or user.get("tier")

        shop = None
        if user.get("shop_id"):
            shop = await db.shops.find_one({"shop_id": user.get("shop_id")}, {"_id": 0})
        if not shop and user.get("user_id"):
            shop = await db.shops.find_one({"owner_user_id": user.get("user_id")}, {"_id": 0})
        if shop:
            row["shop_id"] = shop.get("shop_id")
            row["shop_name"] = shop.get("name")
            row["shop_slug"] = shop.get("slug")
    return row


def _admin_payment_status_query(status: str) -> dict:
    status = (status or "pending").lower()
    if status == "all":
        return {}
    if status == "pending":
        return {"status": {"$in": ["pending", "pending_review", "waiting", "review"]}}
    if status == "approved":
        return {"status": {"$in": ["approved", "paid", "success", "completed"]}}
    if status == "rejected":
        return {"status": {"$in": ["rejected", "failed", "cancelled"]}}
    return {"status": status}




def _admin_truthy_string(value) -> bool:
    return bool(str(value or "").strip())


def _admin_store_health_status(score: int) -> str:
    if score >= 80:
        return "healthy"
    if score >= 50:
        return "onboarding"
    return "critical"


async def _admin_health_event_counts() -> tuple[dict, dict]:
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

    visits = {}
    whatsapp_clicks = {}

    for name in candidates:
        if name not in collection_names:
            continue

        collection = db[name]
        try:
            docs = await collection.aggregate([
                {"$group": {
                    "_id": {"shop_id": "$shop_id", "slug": {"$ifNull": ["$shop_slug", "$slug"]}},
                    "visits": {"$sum": {"$cond": [
                        {"$or": [
                            {"$in": ["$event", ["page_view", "storefront_view", "visit", "store_visit"]]},
                            {"$in": ["$event_type", ["page_view", "storefront_view", "visit", "store_visit"]]},
                            {"$in": ["$type", ["page_view", "storefront_view", "visit", "store_visit"]]},
                            {"$in": ["$action", ["page_view", "storefront_view", "visit", "store_visit"]]},
                        ]},
                        {"$ifNull": ["$visits", {"$ifNull": ["$count", 1]}]},
                        0,
                    ]}},
                    "wa": {"$sum": {"$cond": [
                        {"$or": [
                            {"$in": ["$event", ["whatsapp_click", "wa_click", "contact_click"]]},
                            {"$in": ["$event_type", ["whatsapp_click", "wa_click", "contact_click"]]},
                            {"$in": ["$type", ["whatsapp_click", "wa_click", "contact_click"]]},
                            {"$in": ["$action", ["whatsapp_click", "wa_click", "contact_click"]]},
                        ]},
                        {"$ifNull": ["$count", 1]},
                        0,
                    ]}},
                }},
                {"$limit": 5000},
            ]).to_list(5000)
        except Exception:
            continue

        for doc in docs:
            key = doc.get("_id") or {}
            for ref in [key.get("shop_id"), key.get("slug")]:
                if not ref:
                    continue
                visits[ref] = visits.get(ref, 0) + int(doc.get("visits") or 0)
                whatsapp_clicks[ref] = whatsapp_clicks.get(ref, 0) + int(doc.get("wa") or 0)

    return visits, whatsapp_clicks


async def _admin_product_counts_by_shop() -> dict:
    counts = {}
    try:
        docs = await db.products.aggregate([
            {"$group": {
                "_id": "$shop_id",
                "count": {"$sum": 1},
                "active": {"$sum": {"$cond": [{"$ne": ["$is_active", False]}, 1, 0]}},
            }},
            {"$limit": 5000},
        ]).to_list(5000)
    except Exception:
        docs = []

    for doc in docs:
        key = doc.get("_id")
        if key:
            counts[key] = {"count": int(doc.get("count") or 0), "active": int(doc.get("active") or 0)}
    return counts


def _admin_shop_payment_ready(shop: dict) -> bool:
    keys = [
        "store_qris",
        "qris_image",
        "qris_image_url",
        "payment_instruction",
        "storefront_payment_instruction",
        "bank_account",
    ]
    return any(_admin_truthy_string(shop.get(key)) for key in keys)


def _admin_shop_template_ready(shop: dict) -> bool:
    keys = [
        "storefront_whatsapp_template",
        "storefront_whatsapp_product_template",
        "storefront_whatsapp_cart_template",
        "whatsapp_template",
    ]
    return any(_admin_truthy_string(shop.get(key)) for key in keys)


def _admin_shop_seo_ready(shop: dict) -> bool:
    return _admin_truthy_string(shop.get("storefront_seo_title")) and _admin_truthy_string(shop.get("storefront_seo_description"))


def _admin_storefront_ready(shop: dict) -> bool:
    if shop.get("is_active") is False:
        return False
    if str(shop.get("status") or "").lower() in {"inactive", "suspended", "disabled"}:
        return False
    return True


def _admin_billing_ready(user: dict | None) -> bool:
    if not user:
        return False
    tier = str(user.get("tier") or "free").lower()
    if tier in {"starter", "pro", "business"}:
        return True
    if user.get("trial") and not user.get("trial_expired"):
        return True
    return False


def _admin_score_shop_health(shop: dict, user: dict | None, product_counts: dict, visits_map: dict, wa_map: dict) -> dict:
    shop_id = shop.get("shop_id")
    slug = shop.get("slug")
    product_info = product_counts.get(shop_id, {})
    products_count = int(product_info.get("count") or 0)
    active_products = int(product_info.get("active") or 0)
    visits = int(visits_map.get(shop_id, 0) or visits_map.get(slug, 0) or 0)
    wa_clicks = int(wa_map.get(shop_id, 0) or wa_map.get(slug, 0) or 0)

    checks = {
        "products_ok": products_count >= 3 or active_products >= 3,
        "whatsapp_ok": _admin_truthy_string(shop.get("whatsapp")),
        "payment_ok": _admin_shop_payment_ready(shop),
        "seo_ok": _admin_shop_seo_ready(shop),
        "template_ok": _admin_shop_template_ready(shop),
        "storefront_ok": _admin_storefront_ready(shop),
        "traffic_ok": visits > 0,
        "billing_ok": _admin_billing_ready(user),
    }

    score = 0
    gaps = []

    if checks["products_ok"]:
        score += 20
    elif products_count > 0:
        score += 10
        gaps.append("Produk kurang dari 3")
    else:
        gaps.append("Belum ada produk")

    if checks["whatsapp_ok"]:
        score += 15
    else:
        gaps.append("Nomor WhatsApp belum lengkap")

    if checks["payment_ok"]:
        score += 15
    else:
        gaps.append("QRIS/instruksi pembayaran belum lengkap")

    if checks["seo_ok"]:
        score += 10
    else:
        gaps.append("SEO title/description belum lengkap")

    if checks["template_ok"]:
        score += 10
    else:
        gaps.append("Template WhatsApp belum lengkap")

    if checks["storefront_ok"]:
        score += 10
    else:
        gaps.append("Storefront tidak aktif")

    if checks["traffic_ok"]:
        score += 10
    else:
        gaps.append("Belum ada kunjungan storefront tercatat")

    if wa_clicks > 0:
        score += 5
    else:
        gaps.append("Belum ada klik WhatsApp tercatat")

    if checks["billing_ok"]:
        score += 5
    else:
        gaps.append("Billing/trial owner belum aktif")

    score = max(0, min(100, int(score)))
    status = _admin_store_health_status(score)

    public_url = f"/toko/{slug}" if slug else ""

    return {
        "shop_id": shop_id,
        "slug": slug,
        "name": shop.get("name"),
        "created_at": shop.get("created_at"),
        "updated_at": shop.get("updated_at"),
        "public_url": public_url,
        "score": score,
        "health_status": status,
        "checks": checks,
        "gaps": gaps,
        "products_count": products_count,
        "active_products_count": active_products,
        "visits": visits,
        "whatsapp_clicks": wa_clicks,
        "owner_user_id": (user or {}).get("user_id"),
        "owner_email": (user or {}).get("email"),
        "owner_tier": (user or {}).get("tier") or "free",
        "owner_trial": bool((user or {}).get("trial")),
        "owner_trial_expired": bool((user or {}).get("trial_expired")),
    }




def _admin_onboarding_now_iso():
    return datetime.now(timezone.utc).isoformat()


def _admin_followup_public_state(doc: dict | None) -> dict:
    doc = doc or {}
    return {
        "shop_id": doc.get("shop_id"),
        "status": doc.get("status") or "new",
        "last_note": doc.get("last_note"),
        "last_follow_up_at": doc.get("last_follow_up_at"),
        "next_follow_up_at": doc.get("next_follow_up_at"),
        "done_at": doc.get("done_at"),
        "updated_at": doc.get("updated_at"),
    }


async def _admin_find_shop_for_onboarding(shop_id: str) -> dict:
    shop = await db.shops.find_one({"shop_id": shop_id}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return shop


async def _admin_get_onboarding_followup(shop_id: str) -> dict:
    doc = await db.admin_onboarding_followups.find_one({"shop_id": shop_id}, {"_id": 0})
    return doc or {
        "shop_id": shop_id,
        "status": "new",
        "notes": [],
        "last_note": "",
        "last_follow_up_at": None,
        "next_follow_up_at": None,
        "created_at": None,
        "updated_at": None,
    }


def _admin_onboarding_status_match(followup_status: str, requested: str) -> bool:
    requested = requested or "open"
    followup_status = followup_status or "new"
    if requested == "all":
        return True
    if requested == "open":
        return followup_status != "done"
    return followup_status == requested


def _admin_onboarding_health_match(health_status: str, requested: str) -> bool:
    requested = requested or "attention"
    if requested == "all":
        return True
    if requested == "attention":
        return health_status in {"critical", "onboarding"}
    return health_status == requested


async def _admin_onboarding_build_items(status: str, health: str, q: str, limit: int):
    # Reuse Store Health score helpers when present.
    if "_admin_product_counts_by_shop" not in globals() or "_admin_health_event_counts" not in globals() or "_admin_score_shop_health" not in globals():
        raise HTTPException(status_code=500, detail="Store health helpers are not available")

    shop_query = {}
    if q:
        shop_query = {"$or": [
            {"name": {"$regex": q, "$options": "i"}},
            {"slug": {"$regex": q, "$options": "i"}},
            {"whatsapp": {"$regex": q, "$options": "i"}},
        ]}

    shops = await db.shops.find(shop_query, {"_id": 0}).sort("created_at", -1).limit(500).to_list(500)
    owner_ids = [shop.get("owner_user_id") for shop in shops if shop.get("owner_user_id")]
    shop_ids = [shop.get("shop_id") for shop in shops if shop.get("shop_id")]

    users = []
    if owner_ids or shop_ids:
        user_query = {"$or": []}
        if owner_ids:
            user_query["$or"].append({"user_id": {"$in": owner_ids}})
        if shop_ids:
            user_query["$or"].append({"shop_id": {"$in": shop_ids}})
        users = await db.users.find(user_query, {"_id": 0, "password_hash": 0}).to_list(1000)

    by_user_id = {user.get("user_id"): user for user in users if user.get("user_id")}
    by_shop_id = {user.get("shop_id"): user for user in users if user.get("shop_id")}

    product_counts, event_counts = await asyncio.gather(
        _admin_product_counts_by_shop(),
        _admin_health_event_counts(),
    )
    visits_map, wa_map = event_counts

    followup_docs = await db.admin_onboarding_followups.find(
        {"shop_id": {"$in": shop_ids}},
        {"_id": 0},
    ).to_list(1000) if shop_ids else []
    followup_by_shop = {doc.get("shop_id"): doc for doc in followup_docs if doc.get("shop_id")}

    items = []
    summary = {"open": 0, "new": 0, "contacted": 0, "waiting": 0, "done": 0}

    for shop in shops:
        user = by_user_id.get(shop.get("owner_user_id")) or by_shop_id.get(shop.get("shop_id"))
        health_item = _admin_score_shop_health(shop, user, product_counts, visits_map, wa_map)
        followup = followup_by_shop.get(shop.get("shop_id")) or {}
        followup_status = followup.get("status") or "new"

        if followup_status != "done":
            summary["open"] += 1
        if followup_status in summary:
            summary[followup_status] += 1

        if not _admin_onboarding_status_match(followup_status, status):
            continue
        if not _admin_onboarding_health_match(health_item.get("health_status"), health):
            continue

        item = {
            **health_item,
            "followup_status": followup_status,
            "last_note": followup.get("last_note") or "",
            "last_follow_up_at": followup.get("last_follow_up_at"),
            "next_follow_up_at": followup.get("next_follow_up_at"),
            "followup_updated_at": followup.get("updated_at"),
            "owner_whatsapp": (user or {}).get("whatsapp") or (user or {}).get("phone"),
            "whatsapp": shop.get("whatsapp"),
        }
        items.append(item)

    # Prioritize low score and items that have next follow-up date.
    items.sort(key=lambda item: (
        1 if item.get("next_follow_up_at") else 2,
        item.get("next_follow_up_at") or "9999",
        item.get("score", 0),
    ))

    return items[:limit], summary




def _admin_ops_today_window():
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return now, start.isoformat(), end.isoformat()


async def _admin_ops_store_critical_count():
    try:
        if "_admin_onboarding_build_items" in globals():
            items, _summary = await _admin_onboarding_build_items(status="all", health="critical", q="", limit=500)
            return len(items)
    except Exception:
        return 0
    return 0




def _admin_notifications_now():
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    return now, today_start, today_end


def _admin_notification_followup_message(item: dict) -> str:
    target = item.get("target_label") or item.get("target_email") or "Bapak/Ibu"
    if item.get("type") == "trial":
        return f"Halo {target}, trial Lapakin akan segera berakhir. Mau saya bantu cek toko dan lanjutkan aktivasi agar toko tetap bisa dipakai?"
    if item.get("type") == "payment":
        return f"Halo {target}, pembayaran Lapakin Anda sedang menunggu review. Mohon pastikan bukti transfer sudah lengkap agar bisa segera kami proses."
    if item.get("type") == "onboarding":
        return f"Halo {target}, kami ingin bantu melengkapi toko Lapakin Anda. Ada beberapa hal yang perlu dicek agar toko siap jualan."
    if item.get("type") == "store_health":
        return f"Halo {target}, health score toko Anda masih perlu ditingkatkan. Kami bisa bantu lengkapi produk, WhatsApp, payment, dan template."
    return f"Halo {target}, ada follow-up dari tim Lapakin."


def _admin_notification_base(notification_id: str, type_: str, title: str, message: str, target_label: str = "", target_email: str = "", target_id: str = "", source: str = "", priority: str = "normal", due_at: str | None = None, created_at: str | None = None, extra: dict | None = None) -> dict:
    item = {
        "notification_id": notification_id,
        "type": type_,
        "title": title,
        "message": message,
        "target_label": target_label,
        "target_email": target_email,
        "target_id": target_id,
        "source": source,
        "priority": priority,
        "due_at": due_at,
        "created_at": created_at or _admin_now_iso() if "_admin_now_iso" in globals() else datetime.now(timezone.utc).isoformat(),
        "extra": extra or {},
    }
    item["follow_up_message"] = _admin_notification_followup_message(item)
    return item


async def _admin_build_notification_candidates(limit: int = 100) -> list[dict]:
    now, today_start, today_end = _admin_notifications_now()
    now_iso = now.isoformat()
    soon_7_iso = (now + timedelta(days=7)).isoformat()
    items = []

    # Trial expiring reminders.
    trial_users = await db.users.find(
        {"trial": True, "trial_expires_at": {"$gte": now_iso, "$lte": soon_7_iso}},
        {"_id": 0, "password_hash": 0},
    ).sort("trial_expires_at", 1).limit(80).to_list(80)
    for user in trial_users:
        email = user.get("email") or ""
        title = f"Trial mau habis: {email or user.get('name') or user.get('user_id')}"
        msg = f"Trial berakhir pada {user.get('trial_expires_at') or '-'}."
        items.append(_admin_notification_base(
            notification_id=f"trial_{user.get('user_id')}",
            type_="trial",
            title=title,
            message=msg,
            target_label=user.get("name") or email,
            target_email=email,
            target_id=user.get("user_id") or "",
            source="billing",
            priority="medium",
            due_at=user.get("trial_expires_at"),
            created_at=user.get("updated_at") or user.get("created_at"),
            extra={"tier": user.get("tier") or "free"},
        ))

    # Payment pending reminders.
    pending_statuses = ["pending", "pending_review", "waiting", "review"]
    payments = await db.payments.find(
        {"status": {"$in": pending_statuses}},
        {"_id": 0},
    ).sort("created_at", 1).limit(80).to_list(80)
    for payment in payments:
        payment_id = payment.get("payment_id") or payment.get("id") or ""
        email = payment.get("email") or payment.get("user_email") or ""
        amount = _admin_payment_amount(payment) if "_admin_payment_amount" in globals() else (payment.get("amount") or payment.get("total") or 0)
        title = f"Payment pending: {email or payment_id}"
        msg = f"Pembayaran {payment_id or '-'} menunggu review. Nominal: {amount}."
        items.append(_admin_notification_base(
            notification_id=f"payment_{payment_id}",
            type_="payment",
            title=title,
            message=msg,
            target_label=email or payment.get("user_id") or payment_id,
            target_email=email,
            target_id=payment_id,
            source="payments",
            priority="high",
            due_at=payment.get("created_at"),
            created_at=payment.get("created_at"),
            extra={"amount": amount, "status": payment.get("status")},
        ))

    # Onboarding due reminders.
    followups = await db.admin_onboarding_followups.find(
        {"status": {"$ne": "done"}, "next_follow_up_at": {"$lte": today_end.isoformat()}},
        {"_id": 0},
    ).sort("next_follow_up_at", 1).limit(80).to_list(80)
    shop_ids = [doc.get("shop_id") for doc in followups if doc.get("shop_id")]
    shops = await db.shops.find({"shop_id": {"$in": shop_ids}}, {"_id": 0}).to_list(200) if shop_ids else []
    shops_by_id = {shop.get("shop_id"): shop for shop in shops if shop.get("shop_id")}
    owner_ids = [shop.get("owner_user_id") for shop in shops if shop.get("owner_user_id")]
    users = await db.users.find({"user_id": {"$in": owner_ids}}, {"_id": 0, "password_hash": 0}).to_list(200) if owner_ids else []
    users_by_id = {user.get("user_id"): user for user in users if user.get("user_id")}
    for doc in followups:
        shop = shops_by_id.get(doc.get("shop_id")) or {}
        user = users_by_id.get(shop.get("owner_user_id")) or {}
        title = f"Onboarding due: {shop.get('name') or doc.get('shop_name') or doc.get('shop_id')}"
        msg = doc.get("last_note") or "Follow-up onboarding jatuh tempo."
        items.append(_admin_notification_base(
            notification_id=f"onboarding_{doc.get('shop_id')}",
            type_="onboarding",
            title=title,
            message=msg,
            target_label=shop.get("name") or doc.get("shop_name") or "",
            target_email=user.get("email") or "",
            target_id=doc.get("shop_id") or "",
            source="onboarding",
            priority="medium",
            due_at=doc.get("next_follow_up_at"),
            created_at=doc.get("updated_at") or doc.get("created_at"),
            extra={"status": doc.get("status"), "slug": shop.get("slug")},
        ))

    # Critical store health reminders.
    try:
        if "_admin_onboarding_build_items" in globals():
            critical_items, _summary = await _admin_onboarding_build_items(status="open", health="critical", q="", limit=80)
            for item in critical_items:
                shop_id = item.get("shop_id")
                if not shop_id:
                    continue
                title = f"Toko critical: {item.get('name') or item.get('slug') or shop_id}"
                gaps = ", ".join((item.get("gaps") or [])[:3])
                msg = f"Health score {item.get('score')}/100. Gap: {gaps or 'perlu dicek'}."
                items.append(_admin_notification_base(
                    notification_id=f"store_health_{shop_id}",
                    type_="store_health",
                    title=title,
                    message=msg,
                    target_label=item.get("name") or item.get("slug") or "",
                    target_email=item.get("owner_email") or "",
                    target_id=shop_id,
                    source="store_health",
                    priority="high",
                    due_at=today_end.isoformat(),
                    created_at=item.get("updated_at") or item.get("created_at"),
                    extra={"score": item.get("score"), "gaps": item.get("gaps") or []},
                ))
    except Exception:
        pass

    # Deduplicate by notification_id.
    unique = {}
    for item in items:
        if item.get("notification_id") and item.get("notification_id") not in unique:
            unique[item["notification_id"]] = item
    return list(unique.values())[: max(1, min(limit, 300))]


async def _admin_apply_notification_state(items: list[dict]) -> list[dict]:
    ids = [item.get("notification_id") for item in items if item.get("notification_id")]
    states = await db.admin_notification_states.find({"notification_id": {"$in": ids}}, {"_id": 0}).to_list(1000) if ids else []
    by_id = {state.get("notification_id"): state for state in states if state.get("notification_id")}
    now = datetime.now(timezone.utc)

    output = []
    for item in items:
        state = by_id.get(item.get("notification_id")) or {}
        status = state.get("status") or "open"
        snoozed_until = state.get("snoozed_until")
        if status == "snoozed" and snoozed_until:
            try:
                snooze_dt = datetime.fromisoformat(str(snoozed_until).replace("Z", "+00:00"))
                if snooze_dt <= now:
                    status = "open"
            except Exception:
                pass
        item = {**item, **{
            "status": status,
            "state_note": state.get("note") or "",
            "snoozed_until": snoozed_until,
            "done_at": state.get("done_at"),
            "state_updated_at": state.get("updated_at"),
        }}
        output.append(item)
    return output


def _admin_notification_matches(item: dict, status: str, type_: str, q: str) -> bool:
    status = status or "open"
    type_ = type_ or "all"

    if type_ != "all" and item.get("type") != type_:
        return False

    if status == "open":
        if item.get("status") != "open":
            return False
    elif status == "done":
        if item.get("status") != "done":
            return False
    elif status == "snoozed":
        if item.get("status") != "snoozed":
            return False
    elif status != "all":
        return False

    if q:
        needle = q.lower()
        haystack = " ".join(str(item.get(key) or "") for key in ["title", "message", "target_label", "target_email", "target_id", "source"]).lower()
        if needle not in haystack:
            return False

    return True




async def _admin_nav_badges_notifications_open():
    try:
        if "_admin_build_notification_candidates" in globals() and "_admin_apply_notification_state" in globals():
            candidates = await _admin_build_notification_candidates(limit=300)
            items = await _admin_apply_notification_state(candidates)
            return sum(1 for item in items if item.get("status") == "open")
    except Exception:
        return 0
    return 0


async def _admin_nav_badges_store_critical():
    try:
        if "_admin_onboarding_build_items" in globals():
            items, _summary = await _admin_onboarding_build_items(status="all", health="critical", q="", limit=500)
            return len(items)
    except Exception:
        return 0
    return 0


@router.get("/admin/nav-badges")
async def admin_nav_badges(request: Request):
    await require_admin(request)
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    soon_7_iso = (now + timedelta(days=7)).isoformat()
    today_end_iso = now.replace(hour=23, minute=59, second=59, microsecond=999999).isoformat()

    pending_payment_statuses = ["pending", "pending_review", "waiting", "review"]

    trial_expiring_7d, payment_pending, onboarding_open, onboarding_due_today, notifications_open, store_critical = await asyncio.gather(
        db.users.count_documents({"trial": True, "trial_expires_at": {"$gte": now_iso, "$lte": soon_7_iso}}),
        db.payments.count_documents({"status": {"$in": pending_payment_statuses}}),
        db.admin_onboarding_followups.count_documents({"status": {"$ne": "done"}}),
        db.admin_onboarding_followups.count_documents({"status": {"$ne": "done"}, "next_follow_up_at": {"$lte": today_end_iso}}),
        _admin_nav_badges_notifications_open(),
        _admin_nav_badges_store_critical(),
    )

    ops_tasks = sum(1 for count in [trial_expiring_7d, payment_pending, onboarding_due_today, store_critical, notifications_open] if int(count or 0) > 0)

    badges = {
        "ops": ops_tasks,
        "notifications": notifications_open,
        "billing": trial_expiring_7d,
        "payments": payment_pending,
        "store_health": store_critical,
        "onboarding": onboarding_open,
    }

    return {
        "ok": True,
        "badges": badges,
        "details": {
            "trial_expiring_7d": trial_expiring_7d,
            "payment_pending": payment_pending,
            "store_critical": store_critical,
            "onboarding_open": onboarding_open,
            "onboarding_due_today": onboarding_due_today,
            "notifications_open": notifications_open,
        },
    }

@router.get("/admin/notifications")
async def admin_notifications(request: Request, status: str = "open", type: str = "all", q: str = "", limit: int = 100):
    await require_admin(request)
    limit = max(1, min(int(limit or 100), 300))
    candidates = await _admin_build_notification_candidates(limit=300)
    items_with_state = await _admin_apply_notification_state(candidates)

    summary = {
        "total": len(items_with_state),
        "open": sum(1 for item in items_with_state if item.get("status") == "open"),
        "done": sum(1 for item in items_with_state if item.get("status") == "done"),
        "snoozed": sum(1 for item in items_with_state if item.get("status") == "snoozed"),
        "high_priority": sum(1 for item in items_with_state if item.get("status") == "open" and item.get("priority") == "high"),
        "trial": sum(1 for item in items_with_state if item.get("status") == "open" and item.get("type") == "trial"),
        "payment": sum(1 for item in items_with_state if item.get("status") == "open" and item.get("type") == "payment"),
        "onboarding": sum(1 for item in items_with_state if item.get("status") == "open" and item.get("type") == "onboarding"),
        "store_health": sum(1 for item in items_with_state if item.get("status") == "open" and item.get("type") == "store_health"),
    }

    filtered = [item for item in items_with_state if _admin_notification_matches(item, status, type, q)]
    priority_rank = {"high": 0, "medium": 1, "normal": 2}
    filtered.sort(key=lambda item: (priority_rank.get(item.get("priority"), 3), item.get("due_at") or "9999"))

    return {
        "items": filtered[:limit],
        "summary": summary,
        "status": status,
        "type": type,
        "limit": limit,
    }


@router.post("/admin/notifications/{notification_id}/done")
async def admin_notification_done(notification_id: str, request: Request):
    admin = await require_admin(request)
    try:
        body = await request.json()
    except Exception:
        body = {}

    note = str(body.get("note") or "").strip()
    now_iso = datetime.now(timezone.utc).isoformat()
    before = await db.admin_notification_states.find_one({"notification_id": notification_id}, {"_id": 0}) or {}

    update = {
        "notification_id": notification_id,
        "status": "done",
        "note": note,
        "done_at": now_iso,
        "updated_at": now_iso,
        "updated_by": (admin or {}).get("user_id"),
        "updated_by_email": (admin or {}).get("email"),
    }
    await db.admin_notification_states.update_one(
        {"notification_id": notification_id},
        {"$set": update, "$setOnInsert": {"created_at": now_iso}},
        upsert=True,
    )
    after = await db.admin_notification_states.find_one({"notification_id": notification_id}, {"_id": 0}) or {}

    if "_admin_write_audit_log" in globals():
        await _admin_write_audit_log(
            admin=admin or {},
            action="notification.done",
            target_type="notification",
            target_id=notification_id,
            before=before,
            after=after,
            reason=note,
        )

    return {"ok": True, "state": after}


@router.post("/admin/notifications/{notification_id}/snooze")
async def admin_notification_snooze(notification_id: str, request: Request):
    admin = await require_admin(request)
    try:
        body = await request.json()
    except Exception:
        body = {}

    days = int(body.get("days") or 3)
    days = max(1, min(days, 60))
    note = str(body.get("note") or "").strip()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    snoozed_until = (now + timedelta(days=days)).isoformat()
    before = await db.admin_notification_states.find_one({"notification_id": notification_id}, {"_id": 0}) or {}

    update = {
        "notification_id": notification_id,
        "status": "snoozed",
        "note": note,
        "snoozed_until": snoozed_until,
        "updated_at": now_iso,
        "updated_by": (admin or {}).get("user_id"),
        "updated_by_email": (admin or {}).get("email"),
    }
    await db.admin_notification_states.update_one(
        {"notification_id": notification_id},
        {"$set": update, "$setOnInsert": {"created_at": now_iso}},
        upsert=True,
    )
    after = await db.admin_notification_states.find_one({"notification_id": notification_id}, {"_id": 0}) or {}

    if "_admin_write_audit_log" in globals():
        await _admin_write_audit_log(
            admin=admin or {},
            action="notification.snooze",
            target_type="notification",
            target_id=notification_id,
            before=before,
            after=after,
            reason=note,
        )

    return {"ok": True, "state": after}

@router.get("/admin/ops/overview")
async def admin_ops_overview(request: Request):
    await require_admin(request)
    now, today_start_iso, today_end_iso = _admin_ops_today_window()
    soon_7_iso = (now + timedelta(days=7)).isoformat()
    pending_statuses = ["pending", "pending_review", "waiting", "review"]
    reviewed_statuses = ["approved", "paid", "success", "completed", "rejected", "failed", "cancelled"]

    trial_expiring_7d, payment_pending, users_today, shops_today, payments_reviewed_today, onboarding_due_today, recent_audit_logs, store_critical = await asyncio.gather(
        db.users.count_documents({"trial": True, "trial_expires_at": {"$gte": now.isoformat(), "$lte": soon_7_iso}}),
        db.payments.count_documents({"status": {"$in": pending_statuses}}),
        db.users.count_documents({"created_at": {"$gte": today_start_iso, "$lt": today_end_iso}}),
        db.shops.count_documents({"created_at": {"$gte": today_start_iso, "$lt": today_end_iso}}),
        db.payments.count_documents({"reviewed_at": {"$gte": today_start_iso, "$lt": today_end_iso}, "status": {"$in": reviewed_statuses}}),
        db.admin_onboarding_followups.count_documents({"status": {"$ne": "done"}, "next_follow_up_at": {"$lte": today_end_iso}}),
        db.admin_audit_logs.find({}, {"_id": 0}).sort("created_at", -1).limit(8).to_list(8),
        _admin_ops_store_critical_count(),
    )

    tasks = []

    def add_task(key, label, count, helper, path, priority="normal"):
        if int(count or 0) > 0:
            tasks.append({"key": key, "label": label, "count": int(count or 0), "helper": helper, "path": path, "priority": priority})

    add_task("payment_pending", "Review payment pending", payment_pending, "Approve/reject payment manual yang menunggu review.", "/admin/payments", "high")
    add_task("store_critical", "Follow-up toko critical", store_critical, "Bantu toko dengan Store Health Score kritis.", "/admin/store-health", "high")
    add_task("trial_expiring_7d", "Follow-up trial mau habis", trial_expiring_7d, "Hubungi owner sebelum trial berakhir.", "/admin/billing")
    add_task("onboarding_due_today", "Onboarding follow-up due", onboarding_due_today, "Ada follow-up onboarding yang jatuh tempo.", "/admin/onboarding")

    return {
        "ok": True,
        "today_start": today_start_iso,
        "today_end": today_end_iso,
        "summary": {
            "trial_expiring_7d": trial_expiring_7d,
            "payment_pending": payment_pending,
            "store_critical": store_critical,
            "onboarding_due_today": onboarding_due_today,
            "users_today": users_today,
            "shops_today": shops_today,
            "payments_reviewed_today": payments_reviewed_today,
        },
        "tasks": tasks,
        "recent_audit_logs": recent_audit_logs,
    }

@router.get("/admin/onboarding/queue")
async def admin_onboarding_queue(request: Request, status: str = "open", health: str = "attention", q: str = "", limit: int = 100):
    await require_admin(request)
    limit = max(1, min(int(limit or 100), 300))
    items, summary = await _admin_onboarding_build_items(status=status, health=health, q=q, limit=limit)
    return {"items": items, "summary": summary, "status": status, "health": health, "limit": limit}


@router.post("/admin/onboarding/{shop_id}/note")
async def admin_onboarding_add_note(shop_id: str, request: Request):
    admin = await require_admin(request)
    try:
        body = await request.json()
    except Exception:
        body = {}

    note = str(body.get("note") or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="Note is required")

    shop = await _admin_find_shop_for_onboarding(shop_id)
    before_doc = await _admin_get_onboarding_followup(shop_id)
    before = _admin_followup_public_state(before_doc)
    now_iso = _admin_onboarding_now_iso()
    note_doc = {
        "note_id": f"note_{uuid.uuid4().hex[:12]}",
        "note": note,
        "created_at": now_iso,
        "admin_user_id": (admin or {}).get("user_id"),
        "admin_email": (admin or {}).get("email"),
    }

    updates = {
        "$set": {
            "shop_id": shop_id,
            "shop_name": shop.get("name"),
            "shop_slug": shop.get("slug"),
            "status": before_doc.get("status") or "new",
            "last_note": note,
            "last_follow_up_at": now_iso,
            "updated_at": now_iso,
        },
        "$setOnInsert": {"created_at": now_iso},
        "$push": {"notes": note_doc},
    }
    await db.admin_onboarding_followups.update_one({"shop_id": shop_id}, updates, upsert=True)
    after_doc = await _admin_get_onboarding_followup(shop_id)
    after = _admin_followup_public_state(after_doc)

    if "_admin_write_audit_log" in globals():
        await _admin_write_audit_log(
            admin=admin or {},
            action="onboarding.note",
            target_type="shop",
            target_id=shop_id,
            target_email="",
            before=before,
            after=after,
            reason=note,
        )

    return {"ok": True, "followup": after_doc}


@router.post("/admin/onboarding/{shop_id}/status")
async def admin_onboarding_update_status(shop_id: str, request: Request):
    admin = await require_admin(request)
    try:
        body = await request.json()
    except Exception:
        body = {}

    status = str(body.get("status") or "").strip().lower()
    if status not in {"new", "contacted", "waiting", "done"}:
        raise HTTPException(status_code=400, detail="Invalid onboarding status")

    note = str(body.get("note") or "").strip()
    next_follow_up_at = str(body.get("next_follow_up_at") or "").strip() or None

    shop = await _admin_find_shop_for_onboarding(shop_id)
    before_doc = await _admin_get_onboarding_followup(shop_id)
    before = _admin_followup_public_state(before_doc)
    now_iso = _admin_onboarding_now_iso()

    update_set = {
        "shop_id": shop_id,
        "shop_name": shop.get("name"),
        "shop_slug": shop.get("slug"),
        "status": status,
        "next_follow_up_at": next_follow_up_at,
        "updated_at": now_iso,
    }
    if note:
        update_set["last_note"] = note
        update_set["last_follow_up_at"] = now_iso
    if status == "done":
        update_set["done_at"] = now_iso

    update_doc = {
        "$set": update_set,
        "$setOnInsert": {"created_at": now_iso},
    }
    if note:
        update_doc["$push"] = {"notes": {
            "note_id": f"note_{uuid.uuid4().hex[:12]}",
            "note": note,
            "created_at": now_iso,
            "admin_user_id": (admin or {}).get("user_id"),
            "admin_email": (admin or {}).get("email"),
            "status": status,
        }}

    await db.admin_onboarding_followups.update_one({"shop_id": shop_id}, update_doc, upsert=True)
    after_doc = await _admin_get_onboarding_followup(shop_id)
    after = _admin_followup_public_state(after_doc)

    if "_admin_write_audit_log" in globals():
        await _admin_write_audit_log(
            admin=admin or {},
            action="onboarding.status_update",
            target_type="shop",
            target_id=shop_id,
            target_email="",
            before=before,
            after=after,
            reason=note,
        )

    return {"ok": True, "followup": after_doc}


@router.post("/admin/onboarding/{shop_id}/done")
async def admin_onboarding_mark_done(shop_id: str, request: Request):
    admin = await require_admin(request)
    try:
        body = await request.json()
    except Exception:
        body = {}

    note = str(body.get("note") or "").strip() or "Onboarding selesai"
    shop = await _admin_find_shop_for_onboarding(shop_id)
    before_doc = await _admin_get_onboarding_followup(shop_id)
    before = _admin_followup_public_state(before_doc)
    now_iso = _admin_onboarding_now_iso()

    await db.admin_onboarding_followups.update_one(
        {"shop_id": shop_id},
        {
            "$set": {
                "shop_id": shop_id,
                "shop_name": shop.get("name"),
                "shop_slug": shop.get("slug"),
                "status": "done",
                "last_note": note,
                "last_follow_up_at": now_iso,
                "done_at": now_iso,
                "updated_at": now_iso,
            },
            "$setOnInsert": {"created_at": now_iso},
            "$push": {"notes": {
                "note_id": f"note_{uuid.uuid4().hex[:12]}",
                "note": note,
                "created_at": now_iso,
                "admin_user_id": (admin or {}).get("user_id"),
                "admin_email": (admin or {}).get("email"),
                "status": "done",
            }},
        },
        upsert=True,
    )
    after_doc = await _admin_get_onboarding_followup(shop_id)
    after = _admin_followup_public_state(after_doc)

    if "_admin_write_audit_log" in globals():
        await _admin_write_audit_log(
            admin=admin or {},
            action="onboarding.done",
            target_type="shop",
            target_id=shop_id,
            target_email="",
            before=before,
            after=after,
            reason=note,
        )

    return {"ok": True, "followup": after_doc}

@router.get("/admin/store-health")
async def admin_store_health(request: Request, status: str = "all", q: str = "", limit: int = 100):
    await require_admin(request)
    limit = max(1, min(int(limit or 100), 500))

    query = {}
    if q:
        query = {"$or": [
            {"name": {"$regex": q, "$options": "i"}},
            {"slug": {"$regex": q, "$options": "i"}},
            {"whatsapp": {"$regex": q, "$options": "i"}},
        ]}

    shops = await db.shops.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    owner_ids = [shop.get("owner_user_id") for shop in shops if shop.get("owner_user_id")]
    shop_ids = [shop.get("shop_id") for shop in shops if shop.get("shop_id")]

    users = []
    if owner_ids or shop_ids:
        user_query = {"$or": []}
        if owner_ids:
            user_query["$or"].append({"user_id": {"$in": owner_ids}})
        if shop_ids:
            user_query["$or"].append({"shop_id": {"$in": shop_ids}})
        users = await db.users.find(user_query, {"_id": 0, "password_hash": 0}).to_list(5000)

    by_user_id = {user.get("user_id"): user for user in users if user.get("user_id")}
    by_shop_id = {user.get("shop_id"): user for user in users if user.get("shop_id")}

    product_counts, event_counts = await asyncio.gather(
        _admin_product_counts_by_shop(),
        _admin_health_event_counts(),
    )
    visits_map, wa_map = event_counts

    items = []
    for shop in shops:
        user = by_user_id.get(shop.get("owner_user_id")) or by_shop_id.get(shop.get("shop_id"))
        item = _admin_score_shop_health(shop, user, product_counts, visits_map, wa_map)
        items.append(item)

    summary = {
        "total": len(items),
        "healthy": sum(1 for item in items if item.get("health_status") == "healthy"),
        "onboarding": sum(1 for item in items if item.get("health_status") == "onboarding"),
        "critical": sum(1 for item in items if item.get("health_status") == "critical"),
    }

    if status and status != "all":
        items = [item for item in items if item.get("health_status") == status]

    items.sort(key=lambda item: item.get("score", 0))
    return {"items": items, "summary": summary, "status": status, "limit": limit}

@router.get("/admin/payments")
async def admin_list_payments(request: Request, status: str = "pending", q: str = "", limit: int = 100):
    await require_admin(request)
    limit = max(1, min(int(limit or 100), 300))
    query = _admin_payment_status_query(status)

    if q:
        search = {"$or": [
            {"payment_id": {"$regex": q, "$options": "i"}},
            {"id": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
            {"user_email": {"$regex": q, "$options": "i"}},
            {"user_id": {"$regex": q, "$options": "i"}},
            {"plan_id": {"$regex": q, "$options": "i"}},
        ]}
        query = {"$and": [query, search]} if query else search

    docs = await db.payments.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    items = [await _admin_enrich_payment_row(payment) for payment in docs]

    pending_query = _admin_payment_status_query("pending")
    approved_query = _admin_payment_status_query("approved")
    rejected_query = _admin_payment_status_query("rejected")
    pending_docs = await db.payments.find(pending_query, {"_id": 0}).to_list(1000)

    pending, approved, rejected = await asyncio.gather(
        db.payments.count_documents(pending_query),
        db.payments.count_documents(approved_query),
        db.payments.count_documents(rejected_query),
    )

    return {
        "items": items,
        "status": status,
        "limit": limit,
        "summary": {
            "pending": pending,
            "approved": approved,
            "rejected": rejected,
            "pending_amount": sum(_admin_payment_amount(payment) for payment in pending_docs),
        },
    }


@router.post("/admin/payments/{payment_id}/approve")
async def admin_approve_payment(payment_id: str, request: Request):
    admin = await require_admin(request)
    try:
        body = await request.json()
    except Exception:
        body = {}

    note = str(body.get("note") or "").strip()
    payment = await _admin_find_payment(payment_id)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    before = _admin_payment_public_state(payment)
    now_iso = datetime.now(timezone.utc).isoformat()
    updates = {
        "status": "approved",
        "approved_at": now_iso,
        "reviewed_at": now_iso,
        "reviewed_by": (admin or {}).get("user_id"),
        "admin_note": note,
        "updated_at": now_iso,
    }
    await db.payments.update_one(
        {"$or": [{"payment_id": payment_id}, {"id": payment_id}]},
        {"$set": updates},
    )

    updated = await _admin_find_payment(payment_id)
    after = _admin_payment_public_state(updated or {})

    # If existing manual activation helper exists, call it so paid tier activation stays consistent.
    activation_result = None
    try:
        if "_activate_manual_tier_payment" in globals():
            activation_result = await _activate_manual_tier_payment(updated or payment, admin or {})
    except Exception as exc:
        activation_result = {"activation_error": str(exc)}

    if "_admin_write_audit_log" in globals():
        await _admin_write_audit_log(
            admin=admin or {},
            action="payment.approve",
            target_type="payment",
            target_id=payment_id,
            target_email=payment.get("email") or payment.get("user_email") or "",
            before=before,
            after={**after, "activation_result": activation_result},
            reason=note,
        )

    return {"ok": True, "payment": updated, "activation_result": activation_result}


@router.post("/admin/payments/{payment_id}/reject")
async def admin_reject_payment(payment_id: str, request: Request):
    admin = await require_admin(request)
    try:
        body = await request.json()
    except Exception:
        body = {}

    note = str(body.get("note") or "").strip()
    payment = await _admin_find_payment(payment_id)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    before = _admin_payment_public_state(payment)
    now_iso = datetime.now(timezone.utc).isoformat()
    updates = {
        "status": "rejected",
        "rejected_at": now_iso,
        "reviewed_at": now_iso,
        "reviewed_by": (admin or {}).get("user_id"),
        "admin_note": note,
        "updated_at": now_iso,
    }
    await db.payments.update_one(
        {"$or": [{"payment_id": payment_id}, {"id": payment_id}]},
        {"$set": updates},
    )
    updated = await _admin_find_payment(payment_id)
    after = _admin_payment_public_state(updated or {})

    if "_admin_write_audit_log" in globals():
        await _admin_write_audit_log(
            admin=admin or {},
            action="payment.reject",
            target_type="payment",
            target_id=payment_id,
            target_email=payment.get("email") or payment.get("user_email") or "",
            before=before,
            after=after,
            reason=note,
        )

    return {"ok": True, "payment": updated}

@router.get("/admin/billing/overview")
async def admin_billing_overview(request: Request):
    await require_admin(request)
    now_iso, soon_iso = _admin_iso_now_window(7)
    pending_statuses = ["pending", "pending_review", "waiting", "review"]

    [
        users_total,
        trial_active,
        trial_expiring_7d,
        trial_expired,
        paid_active,
        payment_pending,
    ] = await asyncio.gather(
        db.users.count_documents({}),
        db.users.count_documents({"trial": True}),
        db.users.count_documents({"trial": True, "trial_expires_at": {"$gte": now_iso, "$lte": soon_iso}}),
        db.users.count_documents({"$or": [{"trial_expired": True}, {"trial_expires_at": {"$lt": now_iso}, "trial_used": True}]}),
        db.users.count_documents({"tier": {"$in": ["starter", "pro", "business"]}}),
        db.payments.count_documents({"status": {"$in": pending_statuses}}),
    )

    return {
        "users_total": users_total,
        "trial_active": trial_active,
        "trial_expiring_7d": trial_expiring_7d,
        "trial_expired": trial_expired,
        "paid_active": paid_active,
        "payment_pending": payment_pending,
        "window_days": 7,
    }


@router.get("/admin/billing/users")
async def admin_billing_users(request: Request, filter: str = "all", q: str = "", limit: int = 100):
    await require_admin(request)
    limit = max(1, min(int(limit or 100), 300))
    now_iso, soon_iso = _admin_iso_now_window(7)

    query = _admin_billing_user_query(filter, now_iso, soon_iso)

    if query.pop("__payment_pending__", False):
        payments = await db.payments.find(
            {"status": {"$in": ["pending", "pending_review", "waiting", "review"]}},
            {"_id": 0, "user_id": 1, "email": 1},
        ).to_list(1000)
        user_ids = [p.get("user_id") for p in payments if p.get("user_id")]
        emails = [p.get("email") for p in payments if p.get("email")]
        query = {"$or": []}
        if user_ids:
            query["$or"].append({"user_id": {"$in": user_ids}})
        if emails:
            query["$or"].append({"email": {"$in": emails}})
        if not query["$or"]:
            return {"items": [], "filter": filter, "limit": limit}

    if q:
        search = {"$or": [
            {"email": {"$regex": q, "$options": "i"}},
            {"name": {"$regex": q, "$options": "i"}},
        ]}
        if query:
            query = {"$and": [query, search]}
        else:
            query = search

    users = await db.users.find(query, {"_id": 0, "password_hash": 0}).sort("trial_expires_at", 1).limit(limit).to_list(limit)

    # Prefer existing rich admin user enrichment if present.
    if "_admin_enrich_user_for_admin" in globals():
        items = [await _admin_enrich_user_for_admin(user) for user in users]
    elif "_with_admin_user_lifecycle" in globals():
        items = [_with_admin_user_lifecycle(user) for user in users]
    else:
        items = users

    return {"items": items, "filter": filter, "limit": limit}



def _admin_iso_now_window(days: int = 7):
    now = datetime.now(timezone.utc)
    return now.isoformat(), (now + timedelta(days=days)).isoformat()


def _admin_billing_user_query(filter_name: str, now_iso: str, soon_iso: str) -> dict:
    if filter_name == "trial_active":
        return {"trial": True}
    if filter_name == "trial_expiring_7d":
        return {"trial": True, "trial_expires_at": {"$gte": now_iso, "$lte": soon_iso}}
    if filter_name == "trial_expired":
        return {
            "$or": [
                {"trial_expired": True},
                {"trial_expires_at": {"$lt": now_iso}, "trial_used": True},
            ]
        }
    if filter_name == "paid_active":
        return {"tier": {"$in": ["starter", "pro", "business"]}}
    if filter_name == "payment_pending":
        return {"__payment_pending__": True}
    return {}


@router.get("/admin/billing/overview")
async def admin_billing_overview(request: Request):
    await require_admin(request)
    now_iso, soon_iso = _admin_iso_now_window(7)
    pending_statuses = ["pending", "pending_review", "waiting", "review"]

    users_total, trial_active, trial_expiring_7d, trial_expired, paid_active, payment_pending = await asyncio.gather(
        db.users.count_documents({}),
        db.users.count_documents({"trial": True}),
        db.users.count_documents({"trial": True, "trial_expires_at": {"$gte": now_iso, "$lte": soon_iso}}),
        db.users.count_documents({"$or": [{"trial_expired": True}, {"trial_expires_at": {"$lt": now_iso}, "trial_used": True}]}),
        db.users.count_documents({"tier": {"$in": ["starter", "pro", "business"]}}),
        db.payments.count_documents({"status": {"$in": pending_statuses}}),
    )

    return {
        "users_total": users_total,
        "trial_active": trial_active,
        "trial_expiring_7d": trial_expiring_7d,
        "trial_expired": trial_expired,
        "paid_active": paid_active,
        "payment_pending": payment_pending,
        "window_days": 7,
    }


@router.get("/admin/billing/users")
async def admin_billing_users(request: Request, filter: str = "all", q: str = "", limit: int = 100):
    await require_admin(request)
    limit = max(1, min(int(limit or 100), 300))
    now_iso, soon_iso = _admin_iso_now_window(7)

    query = _admin_billing_user_query(filter, now_iso, soon_iso)

    if query.pop("__payment_pending__", False):
        payments = await db.payments.find(
            {"status": {"$in": ["pending", "pending_review", "waiting", "review"]}},
            {"_id": 0, "user_id": 1, "email": 1},
        ).to_list(1000)
        user_ids = [p.get("user_id") for p in payments if p.get("user_id")]
        emails = [p.get("email") for p in payments if p.get("email")]
        or_query = []
        if user_ids:
            or_query.append({"user_id": {"$in": user_ids}})
        if emails:
            or_query.append({"email": {"$in": emails}})
        if not or_query:
            return {"items": [], "filter": filter, "limit": limit}
        query = {"$or": or_query}

    if q:
        search = {"$or": [
            {"email": {"$regex": q, "$options": "i"}},
            {"name": {"$regex": q, "$options": "i"}},
        ]}
        query = {"$and": [query, search]} if query else search

    users = await db.users.find(query, {"_id": 0, "password_hash": 0}).sort("trial_expires_at", 1).limit(limit).to_list(limit)

    if "_admin_enrich_user_for_admin" in globals():
        items = [await _admin_enrich_user_for_admin(user) for user in users]
    elif "_with_admin_user_lifecycle" in globals():
        items = [_with_admin_user_lifecycle(user) for user in users]
    else:
        items = users

    return {"items": items, "filter": filter, "limit": limit}

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


# LAPAKIN_ADMIN_SHOP_SOFT_DELETE_V1
@router.delete("/admin/shops/{shop_id}")
async def admin_soft_delete_shop(shop_id: str, request: Request):
    """Soft delete toko dari admin.

    Tidak melakukan hard delete dependency seperti products, sales, leads,
    analytics, stories, payment, atau audit. Toko dibuat tidak tampil publik,
    tidak featured, dan owner aktif dipindah/unset bila perlu.
    """
    admin = await require_admin(request)
    admin_user = admin
    shop = await db.shops.find_one({"shop_id": shop_id}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    dependency_collections = {
        "products": "products",
        "product_categories": "product_categories",
        "sales": "sales",
        "orders": "orders",
        "storefront_leads": "storefront_leads",
        "storefront_events": "storefront_events",
        "analytics_events": "analytics_events",
        "stories": "stories",
    }

    dependency_counts = {}
    for label, collection_name in dependency_collections.items():
        try:
            dependency_counts[label] = await getattr(db, collection_name).count_documents({"shop_id": shop_id})
        except Exception:
            dependency_counts[label] = 0

    now = datetime.utcnow().isoformat()
    actor = admin_user if isinstance(admin_user, dict) else {}
    actor_id = actor.get("user_id") or actor.get("email") or actor.get("name") or "admin"

    await db.shops.update_one(
        {"shop_id": shop_id},
        {
            "$set": {
                "status": "suspended",
                "is_active": False,
                "featured": False,
                "deleted_at": now,
                "deleted_by": actor_id,
                "delete_reason": "admin_soft_delete",
                "updated_at": now,
            }
        },
    )

    owner_user_id = shop.get("owner_user_id")
    switched_active_shop_id = None

    if owner_user_id:
        owner = await db.users.find_one({"user_id": owner_user_id}, {"_id": 0})
        if owner and owner.get("shop_id") == shop_id:
            replacement = await db.shops.find_one(
                {
                    "owner_user_id": owner_user_id,
                    "shop_id": {"$ne": shop_id},
                    "deleted_at": {"$exists": False},
                    "status": {"$ne": "suspended"},
                },
                {"_id": 0},
            )

            if replacement:
                switched_active_shop_id = replacement.get("shop_id")
                await db.users.update_one(
                    {"user_id": owner_user_id},
                    {"$set": {"shop_id": switched_active_shop_id, "updated_at": now}},
                )
            else:
                await db.users.update_one(
                    {"user_id": owner_user_id},
                    {"$unset": {"shop_id": ""}, "$set": {"updated_at": now}},
                )

    try:
        await db.admin_audit_logs.insert_one(
            {
                "action": "shop_delete",
                "shop_id": shop_id,
                "shop_slug": shop.get("slug"),
                "shop_name": shop.get("name"),
                "actor": actor_id,
                "dependency_counts": dependency_counts,
                "created_at": now,
            }
        )
    except Exception:
        pass

    return {
        "ok": True,
        "soft_deleted": True,
        "shop_id": shop_id,
        "slug": shop.get("slug"),
        "dependency_counts": dependency_counts,
        "owner_active_shop_id": switched_active_shop_id,
    }


# LAPAKIN_ERROR_CENTER_PHASE1_BACKEND_V1
class AdminErrorLogStatusIn(BaseModel):
    status: str = "resolved"
    note: Optional[str] = ""


# LAPAKIN_ERROR_CENTER_PHASE1_BACKEND_V1
@router.post("/errors/client")
async def collect_client_error(request: Request):
    """Client-side error collector. Public endpoint, data is redacted/deduped server-side."""
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    error_id = await log_client_error(request, payload)
    return {"ok": True, "error_id": error_id}


# LAPAKIN_ERROR_CENTER_PHASE1_BACKEND_V1
def _admin_error_log_query(status: str, source: str, severity: str, feature: str, q: str) -> dict:
    query = {}

    if status and status != "all":
        query["status"] = status

    if source and source != "all":
        query["source"] = source

    if severity and severity != "all":
        query["severity"] = severity

    if feature and feature != "all":
        query["feature"] = feature

    if q:
        needle = str(q).strip()
        query["$or"] = [
            {"message": {"$regex": needle, "$options": "i"}},
            {"path": {"$regex": needle, "$options": "i"}},
            {"feature": {"$regex": needle, "$options": "i"}},
            {"error_id": {"$regex": needle, "$options": "i"}},
        ]

    return query


# LAPAKIN_ERROR_CENTER_PHASE1_BACKEND_V1
@router.get("/admin/error-logs")
async def admin_error_logs(
    request: Request,
    status: str = "open",
    source: str = "all",
    severity: str = "all",
    feature: str = "all",
    q: str = "",
    limit: int = 100,
):
    await require_admin(request)

    limit = max(1, min(int(limit or 100), 300))
    query = _admin_error_log_query(status, source, severity, feature, q)

    items = await db.error_logs.find(query, {"_id": 0}).sort("last_seen", -1).limit(limit).to_list(limit)

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

    summary = {
        "open": await db.error_logs.count_documents({"status": "open"}),
        "resolved": await db.error_logs.count_documents({"status": "resolved"}),
        "ignored": await db.error_logs.count_documents({"status": "ignored"}),
        "today": await db.error_logs.count_documents({"last_seen": {"$gte": today_start}}),
        "critical_open": await db.error_logs.count_documents({"status": "open", "severity": "critical"}),
        "frontend_open": await db.error_logs.count_documents({"status": "open", "source": "frontend"}),
        "backend_open": await db.error_logs.count_documents({"status": "open", "source": "backend"}),
    }

    return {
        "items": [public_error_log(item) for item in items],
        "summary": summary,
        "filters": {
            "status": status,
            "source": source,
            "severity": severity,
            "feature": feature,
            "q": q,
            "limit": limit,
        },
    }



# LAPAKIN_ERROR_CENTER_PHASE4A_OVERVIEW_RETENTION_V1
def _admin_error_logs_day_key(value):
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return ""


# LAPAKIN_ERROR_CENTER_PHASE4A_OVERVIEW_RETENTION_V1
def _admin_error_logs_bucket(items: list[dict], key: str, limit: int = 8) -> list[dict]:
    counts = {}
    for item in items:
        value = item.get(key) or "unknown"
        counts[value] = counts.get(value, 0) + int(item.get("count") or 1)

    rows = [{"key": k, "count": v} for k, v in counts.items()]
    rows.sort(key=lambda row: row["count"], reverse=True)
    return rows[:limit]


# LAPAKIN_ERROR_CENTER_PHASE4A_OVERVIEW_RETENTION_V1
@router.get("/admin/error-logs/overview")
async def admin_error_logs_overview(request: Request, days: int = 14):
    await require_admin(request)

    days = max(7, min(int(days or 14), 90))
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    start_iso = start.isoformat()

    docs = await db.error_logs.find(
        {"last_seen": {"$gte": start_iso}},
        {
            "_id": 0,
            "source": 1,
            "severity": 1,
            "feature": 1,
            "status": 1,
            "last_seen": 1,
            "count": 1,
        },
    ).sort("last_seen", -1).limit(5000).to_list(5000)

    daily_map = {}
    for i in range(days):
        day = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        daily_map[day] = {
            "date": day,
            "total": 0,
            "open": 0,
            "critical": 0,
            "frontend": 0,
            "backend": 0,
        }

    for item in docs:
        day = _admin_error_logs_day_key(item.get("last_seen"))
        if day not in daily_map:
            continue

        amount = int(item.get("count") or 1)
        daily_map[day]["total"] += amount

        if item.get("status") == "open":
            daily_map[day]["open"] += amount

        if item.get("severity") == "critical":
            daily_map[day]["critical"] += amount

        if item.get("source") == "frontend":
            daily_map[day]["frontend"] += amount
        elif item.get("source") == "backend":
            daily_map[day]["backend"] += amount

    open_docs = await db.error_logs.find(
        {"status": "open"},
        {"_id": 0, "source": 1, "severity": 1, "feature": 1, "count": 1},
    ).sort("last_seen", -1).limit(5000).to_list(5000)

    return {
        "days": days,
        "daily": list(daily_map.values()),
        "by_source": _admin_error_logs_bucket(open_docs, "source"),
        "by_severity": _admin_error_logs_bucket(open_docs, "severity"),
        "by_feature": _admin_error_logs_bucket(open_docs, "feature", limit=10),
        "open_total_weighted": sum(int(item.get("count") or 1) for item in open_docs),
    }


# LAPAKIN_ERROR_CENTER_PHASE4A_OVERVIEW_RETENTION_V1
@router.post("/admin/error-logs/cleanup")
async def admin_error_logs_cleanup(request: Request):
    admin = await require_admin(request)

    try:
        body = await request.json()
    except Exception:
        body = {}

    days = max(7, min(int(body.get("days") or 30), 365))
    dry_run = bool(body.get("dry_run", True))

    raw_statuses = body.get("statuses") or ["resolved", "ignored"]
    if not isinstance(raw_statuses, list):
        raw_statuses = ["resolved", "ignored"]

    statuses = [str(s).strip().lower() for s in raw_statuses if str(s).strip().lower() in {"resolved", "ignored"}]
    if not statuses:
        statuses = ["resolved", "ignored"]

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    query = {
        "status": {"$in": statuses},
        "last_seen": {"$lt": cutoff},
    }

    count = await db.error_logs.count_documents(query)

    deleted = 0
    if not dry_run:
        result = await db.error_logs.delete_many(query)
        deleted = int(getattr(result, "deleted_count", 0) or 0)

        try:
            await log_admin_action(
                admin,
                "error_logs_cleanup",
                "error_log",
                "bulk",
                {
                    "days": days,
                    "statuses": statuses,
                    "deleted": deleted,
                    "cutoff": cutoff,
                },
            )
        except Exception:
            pass

    return {
        "ok": True,
        "dry_run": dry_run,
        "matched": count,
        "deleted": deleted,
        "days": days,
        "statuses": statuses,
        "cutoff": cutoff,
    }


# LAPAKIN_ERROR_CENTER_PHASE1_BACKEND_V1
@router.get("/admin/error-logs/{error_id}")
async def admin_error_log_detail(error_id: str, request: Request):
    await require_admin(request)

    item = await db.error_logs.find_one({"error_id": error_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Error log tidak ditemukan")

    return public_error_log(item)


# LAPAKIN_ERROR_CENTER_PHASE1_BACKEND_V1
@router.patch("/admin/error-logs/{error_id}/status")
async def admin_update_error_log_status(error_id: str, data: AdminErrorLogStatusIn, request: Request):
    admin = await require_admin(request)

    status = (data.status or "").strip().lower()
    if status not in {"open", "resolved", "ignored"}:
        raise HTTPException(status_code=400, detail="Status harus open, resolved, atau ignored")

    existing = await db.error_logs.find_one({"error_id": error_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Error log tidak ditemukan")

    now = datetime.now(timezone.utc).isoformat()
    update = {
        "status": status,
        "updated_at": now,
        "admin_note": (data.note or "").strip()[:500],
        "status_updated_by": (admin or {}).get("user_id"),
        "status_updated_by_email": (admin or {}).get("email"),
    }

    if status == "resolved":
        update["resolved_at"] = now
    elif status == "ignored":
        update["ignored_at"] = now

    await db.error_logs.update_one({"error_id": error_id}, {"$set": update})

    try:
        await log_admin_action(
            admin,
            f"error_log_{status}",
            "error_log",
            error_id,
            {"from": existing.get("status"), "to": status},
        )
    except Exception:
        pass

    item = await db.error_logs.find_one({"error_id": error_id}, {"_id": 0})
    return {"ok": True, "item": public_error_log(item)}


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1B_READONLY_V2
def _admin_tenant_view_int(value, default=0):
    try:
        return int(value or default)
    except Exception:
        return default


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1B_READONLY_V2
def _admin_tenant_view_price(value):
    try:
        return int(float(value or 0))
    except Exception:
        return 0


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1B_READONLY_V2
async def _admin_tenant_view_count(collection, query):
    try:
        return await collection.count_documents(query)
    except Exception:
        return 0


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1B_READONLY_V2
async def _admin_tenant_view_find_many(collection, query, projection=None, limit=20, sort_field="created_at"):
    try:
        cursor = collection.find(query, projection or {"_id": 0})
        if sort_field:
            cursor = cursor.sort(sort_field, -1)
        return await cursor.limit(limit).to_list(limit)
    except Exception:
        return []


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1B_READONLY_V2
def _admin_tenant_view_clean_doc(doc):
    doc = dict(doc or {})
    doc.pop("_id", None)
    for key in list(doc.keys()):
        lower = str(key).lower()
        if any(secret in lower for secret in ["password", "token", "secret", "api_key", "apikey", "credential", "authorization", "cookie"]):
            doc[key] = "[redacted]"
    return doc


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1B_READONLY_V2


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_ANALYTICS_ROBUST_V1
def _admin_tenant_view_parse_datetime(value):
    from datetime import datetime, timezone

    if not value:
        return None

    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    try:
        text = str(value).strip()
        if not text:
            return None

        # YYYY-MM-DD
        if len(text) == 10 and text[4] == "-" and text[7] == "-":
            return datetime.fromisoformat(text + "T00:00:00+00:00")

        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_ANALYTICS_ROBUST_V1
def _admin_tenant_view_doc_datetime(doc: dict):
    for key in ["created_at", "timestamp", "ts", "date", "day", "updated_at"]:
        dt = _admin_tenant_view_parse_datetime((doc or {}).get(key))
        if dt:
            return dt
    return None


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_ANALYTICS_ROBUST_V1
def _admin_tenant_view_doc_event_name(doc: dict) -> str:
    doc = doc or {}
    for key in ["event", "event_type", "type", "action", "name"]:
        value = str(doc.get(key) or "").strip()
        if value:
            return value

    # Dokumen agregat biasanya tidak punya event name tapi punya visits/count.
    if doc.get("visits") is not None or doc.get("count") is not None:
        return "storefront_view"

    return ""


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_ANALYTICS_ROBUST_V1
def _admin_tenant_view_doc_amount(doc: dict) -> int:
    doc = doc or {}
    for key in ["visits", "count", "total", "value"]:
        try:
            if doc.get(key) is not None:
                return max(0, int(float(doc.get(key) or 0)))
        except Exception:
            pass
    return 1


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_ANALYTICS_ROBUST_V1
def _admin_tenant_view_doc_matches_shop(doc: dict, shop_id: str, slug: str) -> bool:
    doc = doc or {}
    shop_id = str(shop_id or "")
    slug = str(slug or "")

    shop_candidates = [
        doc.get("shop_id"),
        doc.get("target_shop_id"),
        doc.get("store_id"),
        doc.get("tenant_shop_id"),
    ]

    slug_candidates = [
        doc.get("slug"),
        doc.get("shop_slug"),
        doc.get("store_slug"),
        doc.get("tenant_slug"),
    ]

    if shop_id and any(str(value or "") == shop_id for value in shop_candidates):
        return True

    if slug and any(str(value or "") == slug for value in slug_candidates):
        return True

    metadata = doc.get("metadata") or {}
    if isinstance(metadata, dict):
        if shop_id and str(metadata.get("shop_id") or "") == shop_id:
            return True
        if slug and str(metadata.get("slug") or metadata.get("shop_slug") or "") == slug:
            return True

    return False


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_ANALYTICS_ROBUST_V1
async def _admin_tenant_view_load_analytics_docs(shop_id: str, slug: str, start_dt, limit_per_collection: int = 5000):
    """Load analytics docs robustly across old/new collection shapes."""
    collection_names = [
        "analytics_events",
        "storefront_events",
        "storefront_analytics",
        "storefront_daily_analytics",
        "storefront_visits",
        "shop_analytics",
        "analytics",
    ]

    query = {
        "$or": [
            {"shop_id": shop_id},
            {"target_shop_id": shop_id},
            {"store_id": shop_id},
            {"tenant_shop_id": shop_id},
            {"slug": slug},
            {"shop_slug": slug},
            {"store_slug": slug},
            {"tenant_slug": slug},
            {"metadata.shop_id": shop_id},
            {"metadata.slug": slug},
            {"metadata.shop_slug": slug},
        ]
    }

    docs = []
    seen = set()

    for collection_name in collection_names:
        try:
            collection = db[collection_name]
            rows = await collection.find(query, {"_id": 0}).sort("created_at", -1).limit(limit_per_collection).to_list(limit_per_collection)
        except Exception:
            rows = []

        for row in rows:
            if not _admin_tenant_view_doc_matches_shop(row, shop_id, slug):
                continue

            dt = _admin_tenant_view_doc_datetime(row)
            if dt and start_dt and dt < start_dt:
                continue

            fingerprint = (
                collection_name,
                str(row.get("created_at") or row.get("timestamp") or row.get("date") or ""),
                str(row.get("event") or row.get("event_type") or row.get("type") or row.get("action") or ""),
                str(row.get("product_id") or ""),
                str(row.get("lead_id") or ""),
                str(row.get("visits") or row.get("count") or ""),
            )

            if fingerprint in seen:
                continue

            seen.add(fingerprint)
            row["_source_collection"] = collection_name
            docs.append(row)

    return docs

@router.get("/admin/tenant-view/{shop_id}")
async def admin_tenant_view_readonly(shop_id: str, request: Request, days: int = 30):
    """Admin-only read-only tenant dashboard.

    Tidak memakai endpoint tenant owner seperti /shops/me atau /products,
    supaya admin tidak mendapat akses write/impersonation.
    """
    from datetime import datetime, timezone, timedelta

    admin = await require_admin(request)

    shop = await db.shops.find_one(
        {
            "shop_id": shop_id,
            "$and": [
                {"$or": [{"status": {"$ne": "deleted"}}, {"status": {"$exists": False}}]},
                {"$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]},
            ],
        },
        {"_id": 0},
    )

    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    slug = shop.get("slug") or ""
    owner_user_id = shop.get("owner_user_id") or shop.get("user_id") or ""

    owner = {}
    if owner_user_id:
        owner = await db.users.find_one(
            {"user_id": owner_user_id},
            {
                "_id": 0,
                "password_hash": 0,
                "password": 0,
                "reset_token": 0,
                "refresh_token": 0,
            },
        ) or {}

    products = await db.products.find({"shop_id": shop_id}, {"_id": 0}).sort("created_at", -1).limit(200).to_list(200)

    total_products = len(products)
    active_products = 0
    hidden_products = 0
    out_of_stock_products = 0
    inventory_value = 0

    for product in products:
        availability = str(product.get("availability_status") or "").lower()
        is_active = product.get("is_active", True)

        if availability == "hidden" or is_active is False:
            hidden_products += 1
        else:
            active_products += 1

        if availability == "out_of_stock":
            out_of_stock_products += 1

        inventory_value += _admin_tenant_view_price(product.get("price")) * max(0, _admin_tenant_view_int(product.get("stock"), 0))

    now = datetime.now(timezone.utc)
    days = max(1, min(int(days or 30), 365))
    start_iso = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

    base_event_query = {
        "$or": [
            {"shop_id": shop_id},
            {"slug": slug},
            {"shop_slug": slug},
        ],
        "created_at": {"$gte": start_iso},
    }

    start_dt = now - timedelta(days=days - 1)
    analytics_docs = await _admin_tenant_view_load_analytics_docs(shop_id, slug, start_dt)

    analytics_totals = {
        "view_shop": 0,
        "view_product": 0,
        "click_order": 0,
        "share_wa": 0,
        "storefront_view": 0,
        "whatsapp_checkout_click": 0,
        "product_click": 0,
        "product_share_click": 0,
        "lead_created": 0,
    }

    daily = {}
    for i in range(days):
        date_key = (now - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        daily[date_key] = {"date": date_key, "visits": 0, "orders": 0, "leads": 0}

    view_events = {
        "view_shop",
        "page_view",
        "storefront_view",
        "visit",
        "store_visit",
        "storefront_visit",
        "view_store",
    }
    product_events = {"view_product", "product_click", "product_view"}
    order_events = {
        "click_order",
        "whatsapp_checkout_click",
        "cart_checkout",
        "order_click",
        "checkout_click",
        "whatsapp_click",
        "wa_click",
    }
    share_events = {"share_wa", "product_share_click", "share_product", "share"}
    lead_events = {"lead_created", "lead", "order_lead"}

    def add_daily_by_dt(dt, key, amount=1):
        try:
            date_key = dt.strftime("%Y-%m-%d") if dt else ""
        except Exception:
            date_key = ""

        if date_key in daily:
            daily[date_key][key] += amount

    analytics_sources = {}

    for doc in analytics_docs:
        event_name = _admin_tenant_view_doc_event_name(doc)
        amount = _admin_tenant_view_doc_amount(doc)
        dt = _admin_tenant_view_doc_datetime(doc)
        source_collection = doc.get("_source_collection") or "unknown"
        analytics_sources[source_collection] = analytics_sources.get(source_collection, 0) + amount

        if event_name in analytics_totals:
            analytics_totals[event_name] += amount

        if event_name in view_events:
            # Simpan ke storefront_view supaya UI tenant-view konsisten.
            if event_name != "view_shop":
                analytics_totals["storefront_view"] += amount
            else:
                analytics_totals["view_shop"] += 0
            add_daily_by_dt(dt, "visits", amount)

        elif event_name in product_events:
            if event_name != "view_product":
                analytics_totals["product_click"] += amount

        elif event_name in order_events:
            if event_name != "click_order" and event_name != "whatsapp_checkout_click":
                analytics_totals["whatsapp_checkout_click"] += amount
            add_daily_by_dt(dt, "orders", amount)

        elif event_name in share_events:
            if event_name != "share_wa" and event_name != "product_share_click":
                analytics_totals["share_wa"] += amount

        elif event_name in lead_events:
            if event_name != "lead_created":
                analytics_totals["lead_created"] += amount
            add_daily_by_dt(dt, "leads", amount)

    leads_query = {
        "$or": [
            {"shop_id": shop_id},
            {"slug": slug},
            {"shop_slug": slug},
        ],
    }

    leads = await _admin_tenant_view_find_many(db.storefront_leads, leads_query, {"_id": 0}, limit=50, sort_field="created_at")
    total_leads = await _admin_tenant_view_count(db.storefront_leads, leads_query)

    try:
        await log_admin_action(
            admin,
            "tenant_view_readonly_open",
            "shop",
            shop_id,
            {"shop_name": shop.get("name"), "slug": slug, "mode": "read_only"},
        )
    except Exception:
        pass

    return {
        "mode": "admin_readonly",
        "readonly": True,
        "shop": _admin_tenant_view_clean_doc(shop),
        "owner": _admin_tenant_view_clean_doc(owner),
        "summary": {
            "products_total": total_products,
            "products_active": active_products,
            "products_hidden": hidden_products,
            "products_out_of_stock": out_of_stock_products,
            "inventory_value": inventory_value,
            "leads_total": total_leads,
            "days": days,
        },
        "analytics": {
            "totals": analytics_totals,
            "daily": list(daily.values()),
            "legacy_events_sample": 0,
            "storefront_events_sample": len(analytics_docs),
            "sources": analytics_sources,
        },
        "products": products,
        "leads": leads,
        "links": {
            "storefront": f"/toko/{slug}" if slug else "",
            "public_storefront": f"/toko/{slug}" if slug else "",
        },
    }


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_SUPPORT_NOTES_V1
class AdminTenantSupportNoteIn(BaseModel):
    note: str
    category: Optional[str] = "general"
    priority: Optional[str] = "normal"


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_SUPPORT_NOTES_V1
def _admin_tenant_support_note_clean(value, limit=2000):
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "…"


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_SUPPORT_NOTES_V1
async def _admin_tenant_support_note_shop(shop_id: str):
    return await db.shops.find_one(
        {
            "shop_id": shop_id,
            "$and": [
                {"$or": [{"status": {"$ne": "deleted"}}, {"status": {"$exists": False}}]},
                {"$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]},
            ],
        },
        {"_id": 0, "shop_id": 1, "name": 1, "slug": 1},
    )


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_SUPPORT_NOTES_V1
@router.get("/admin/tenant-view/{shop_id}/notes")
async def admin_tenant_support_notes(shop_id: str, request: Request, include_archived: bool = False, limit: int = 50):
    await require_admin(request)

    shop = await _admin_tenant_support_note_shop(shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    query = {"shop_id": shop_id}
    if not include_archived:
        query["archived_at"] = {"$exists": False}

    limit = max(1, min(int(limit or 50), 200))

    items = await db.admin_support_notes.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)

    return {
        "items": items,
        "summary": {
            "total_visible": await db.admin_support_notes.count_documents({"shop_id": shop_id, "archived_at": {"$exists": False}}),
            "total_archived": await db.admin_support_notes.count_documents({"shop_id": shop_id, "archived_at": {"$exists": True}}),
        },
    }


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_SUPPORT_NOTES_V1
@router.post("/admin/tenant-view/{shop_id}/notes")
async def admin_tenant_support_note_create(shop_id: str, data: AdminTenantSupportNoteIn, request: Request):
    import uuid
    from datetime import datetime, timezone

    admin = await require_admin(request)

    shop = await _admin_tenant_support_note_shop(shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    note = _admin_tenant_support_note_clean(data.note, 2000)
    if not note:
        raise HTTPException(status_code=400, detail="Catatan tidak boleh kosong")

    priority = str(data.priority or "normal").strip().lower()
    if priority not in {"low", "normal", "high", "urgent"}:
        priority = "normal"

    category = _admin_tenant_support_note_clean(data.category or "general", 60) or "general"

    now = datetime.now(timezone.utc).isoformat()
    item = {
        "note_id": f"note_{uuid.uuid4().hex[:16]}",
        "shop_id": shop_id,
        "shop_name": shop.get("name"),
        "shop_slug": shop.get("slug"),
        "note": note,
        "category": category,
        "priority": priority,
        "created_at": now,
        "updated_at": now,
        "created_by_user_id": (admin or {}).get("user_id"),
        "created_by_email": (admin or {}).get("email"),
    }

    await db.admin_support_notes.insert_one(dict(item))

    try:
        await log_admin_action(
            admin,
            "tenant_support_note_create",
            "shop",
            shop_id,
            {
                "note_id": item["note_id"],
                "shop_name": shop.get("name"),
                "category": category,
                "priority": priority,
            },
        )
    except Exception:
        pass

    return {"ok": True, "item": item}


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_SUPPORT_NOTES_V1
@router.patch("/admin/tenant-view/{shop_id}/notes/{note_id}/archive")
async def admin_tenant_support_note_archive(shop_id: str, note_id: str, request: Request):
    from datetime import datetime, timezone

    admin = await require_admin(request)

    shop = await _admin_tenant_support_note_shop(shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    existing = await db.admin_support_notes.find_one({"shop_id": shop_id, "note_id": note_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Catatan tidak ditemukan")

    now = datetime.now(timezone.utc).isoformat()
    await db.admin_support_notes.update_one(
        {"shop_id": shop_id, "note_id": note_id},
        {
            "$set": {
                "archived_at": now,
                "archived_by_user_id": (admin or {}).get("user_id"),
                "archived_by_email": (admin or {}).get("email"),
                "updated_at": now,
            }
        },
    )

    try:
        await log_admin_action(
            admin,
            "tenant_support_note_archive",
            "shop",
            shop_id,
            {
                "note_id": note_id,
                "shop_name": shop.get("name"),
            },
        )
    except Exception:
        pass

    item = await db.admin_support_notes.find_one({"shop_id": shop_id, "note_id": note_id}, {"_id": 0})
    return {"ok": True, "item": item}


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2A_ASSISTED_ACTIONS_V1
class AdminTenantAssistActionIn(BaseModel):
    action: str
    note: Optional[str] = ""


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2A_ASSISTED_ACTIONS_V1
def _admin_tenant_assist_public_base_url(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or "https"
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    if not host:
        return ""
    return f"{proto}://{host}".rstrip("/")


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2A_ASSISTED_ACTIONS_V1
def _admin_tenant_assist_pick_first(doc: dict, keys: list[str]) -> str:
    for key in keys:
        value = str((doc or {}).get(key) or "").strip()
        if value:
            return value
    return ""


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2A_ASSISTED_ACTIONS_V1
def _admin_tenant_assist_normalize_wa(raw: str) -> str:
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


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2A_ASSISTED_ACTIONS_V1
async def _admin_tenant_assist_shop(shop_id: str):
    return await db.shops.find_one(
        {
            "shop_id": shop_id,
            "$and": [
                {"$or": [{"status": {"$ne": "deleted"}}, {"status": {"$exists": False}}]},
                {"$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]},
            ],
        },
        {"_id": 0},
    )


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2A_ASSISTED_ACTIONS_V1
async def _admin_tenant_assist_counts(shop_id: str, slug: str):
    products_total = await db.products.count_documents({"shop_id": shop_id})

    active_products = await db.products.count_documents({
        "shop_id": shop_id,
        "$and": [
            {"$or": [{"is_active": {"$ne": False}}, {"is_active": {"$exists": False}}]},
            {"$or": [{"availability_status": {"$nin": ["hidden", "out_of_stock"]}}, {"availability_status": {"$exists": False}}]},
        ],
    })

    lead_query = {
        "$or": [
            {"shop_id": shop_id},
            {"slug": slug},
            {"shop_slug": slug},
        ]
    }

    leads_total = await db.storefront_leads.count_documents(lead_query)
    notes_total = await db.admin_support_notes.count_documents({"shop_id": shop_id, "archived_at": {"$exists": False}})

    return {
        "products_total": products_total,
        "active_products": active_products,
        "leads_total": leads_total,
        "support_notes_active": notes_total,
    }


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2A_ASSISTED_ACTIONS_V1
async def _admin_tenant_assist_tracking_probe(shop_id: str, slug: str):
    from datetime import datetime, timezone, timedelta

    start_dt = datetime.now(timezone.utc) - timedelta(days=30)
    docs = []

    try:
        loader = globals().get("_admin_tenant_view_load_analytics_docs")
        if loader:
            docs = await loader(shop_id, slug, start_dt)
    except Exception:
        docs = []

    sources = {}
    last_seen = ""

    for doc in docs:
        source = doc.get("_source_collection") or "unknown"
        sources[source] = sources.get(source, 0) + 1

        value = str(doc.get("created_at") or doc.get("timestamp") or doc.get("date") or "")
        if value and value > last_seen:
            last_seen = value

    return {
        "ok": len(docs) > 0,
        "events_30d_sample": len(docs),
        "sources": sources,
        "last_seen": last_seen,
    }


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2A_ASSISTED_ACTIONS_V1
@router.post("/admin/tenant-view/{shop_id}/assist-action")
async def admin_tenant_assist_action(shop_id: str, data: AdminTenantAssistActionIn, request: Request):
    import urllib.parse
    from datetime import datetime, timezone

    admin = await require_admin(request)

    shop = await _admin_tenant_assist_shop(shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    action = str(data.action or "").strip().lower()
    allowed = {"copy_debug_bundle", "test_whatsapp_cta", "og_debug", "tracking_probe"}
    if action not in allowed:
        raise HTTPException(status_code=400, detail="Action tidak valid")

    slug = shop.get("slug") or ""
    base_url = _admin_tenant_assist_public_base_url(request)
    public_storefront = f"{base_url}/toko/{slug}" if base_url and slug else f"/toko/{slug}" if slug else ""
    counts = await _admin_tenant_assist_counts(shop_id, slug)

    owner = {}
    owner_user_id = shop.get("owner_user_id") or shop.get("user_id") or ""
    if owner_user_id:
        owner = await db.users.find_one(
            {"user_id": owner_user_id},
            {"_id": 0, "password": 0, "password_hash": 0, "refresh_token": 0, "reset_token": 0},
        ) or {}

    response = {
        "ok": True,
        "action": action,
        "mode": "admin_assisted_readonly",
        "shop_id": shop_id,
        "shop_name": shop.get("name"),
        "slug": slug,
        "message": "",
        "debug_text": "",
    }

    if action == "test_whatsapp_cta":
        raw_phone = _admin_tenant_assist_pick_first(shop, [
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

        phone = _admin_tenant_assist_normalize_wa(raw_phone)
        message = f"Halo, saya mau cek toko {shop.get('name') or ''} di Lapakin"
        wa_url = f"https://wa.me/{phone}?text={urllib.parse.quote(message)}" if phone else ""

        response.update({
            "message": "Nomor WhatsApp/order terdeteksi." if phone else "Nomor WhatsApp/order belum terdeteksi.",
            "phone_raw": raw_phone,
            "phone_normalized": phone,
            "wa_url": wa_url,
            "debug_text": "\n".join([
                "WhatsApp CTA Test",
                f"Shop: {shop.get('name') or '-'}",
                f"Shop ID: {shop_id}",
                f"Slug: {slug or '-'}",
                f"Phone raw: {raw_phone or '-'}",
                f"Phone normalized: {phone or '-'}",
                f"WA URL: {wa_url or '-'}",
            ]),
        })

    elif action == "og_debug":
        version = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        storefront_cache_busted = f"{public_storefront}?v=admin-og-{version}" if public_storefront else ""
        og_image = f"{base_url}/api/og/shop/{slug}.png?v=admin-og-{version}" if base_url and slug else ""
        og_html = f"{base_url}/api/og/shop/{slug}?v=admin-og-{version}" if base_url and slug else ""

        response.update({
            "message": "OG debug links dibuat. Gunakan cache-busted URL untuk test preview WA/FB.",
            "storefront_cache_busted_url": storefront_cache_busted,
            "og_image_url": og_image,
            "og_html_url": og_html,
            "debug_text": "\n".join([
                "OG Debug Links",
                f"Shop: {shop.get('name') or '-'}",
                f"Shop ID: {shop_id}",
                f"Slug: {slug or '-'}",
                f"Storefront: {public_storefront or '-'}",
                f"Cache-busted share URL: {storefront_cache_busted or '-'}",
                f"OG image: {og_image or '-'}",
                f"OG HTML endpoint: {og_html or '-'}",
            ]),
        })

    elif action == "tracking_probe":
        probe = await _admin_tenant_assist_tracking_probe(shop_id, slug)

        response.update({
            "message": "Tracking probe menemukan event 30 hari." if probe.get("ok") else "Tracking probe belum menemukan event 30 hari.",
            "tracking": probe,
            "debug_text": "\n".join([
                "Tracking Probe",
                f"Shop: {shop.get('name') or '-'}",
                f"Shop ID: {shop_id}",
                f"Slug: {slug or '-'}",
                f"Events sample 30d: {probe.get('events_30d_sample', 0)}",
                f"Sources: {probe.get('sources') or {}}",
                f"Last seen: {probe.get('last_seen') or '-'}",
            ]),
        })

    elif action == "copy_debug_bundle":
        tracking = await _admin_tenant_assist_tracking_probe(shop_id, slug)
        debug_lines = [
            "Lapakin Tenant Debug Bundle",
            f"Generated: {datetime.now(timezone.utc).isoformat()}",
            f"Shop: {shop.get('name') or '-'}",
            f"Shop ID: {shop_id}",
            f"Slug: {slug or '-'}",
            f"Storefront: {public_storefront or '-'}",
            f"Owner: {owner.get('email') or owner.get('name') or '-'}",
            f"Status: {shop.get('status') or 'active'}",
            f"Products: {counts.get('products_total', 0)} total / {counts.get('active_products', 0)} active",
            f"Leads: {counts.get('leads_total', 0)}",
            f"Active support notes: {counts.get('support_notes_active', 0)}",
            f"Tracking events 30d sample: {tracking.get('events_30d_sample', 0)}",
            f"Tracking sources: {tracking.get('sources') or {}}",
            f"Last tracking seen: {tracking.get('last_seen') or '-'}",
        ]

        response.update({
            "message": "Debug bundle dibuat.",
            "counts": counts,
            "tracking": tracking,
            "debug_text": "\n".join(debug_lines),
        })

    try:
        await log_admin_action(
            admin,
            f"tenant_assist_{action}",
            "shop",
            shop_id,
            {
                "shop_name": shop.get("name"),
                "slug": slug,
                "mode": "admin_assisted_readonly",
            },
        )
    except Exception:
        pass

    return response


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2B_OG_TIMELINE_V1
def _admin_tenant_timeline_public_base_url(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or "https"
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    if not host:
        return ""
    return f"{proto}://{host}".rstrip("/")


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2B_OG_TIMELINE_V1
async def _admin_tenant_timeline_shop(shop_id: str):
    return await db.shops.find_one(
        {
            "shop_id": shop_id,
            "$and": [
                {"$or": [{"status": {"$ne": "deleted"}}, {"status": {"$exists": False}}]},
                {"$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]},
            ],
        },
        {"_id": 0, "shop_id": 1, "name": 1, "slug": 1},
    )


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2B_OG_TIMELINE_V1
async def _admin_tenant_timeline_record(shop_id: str, shop: dict, kind: str, title: str, description: str, admin: dict, metadata: dict | None = None):
    import uuid
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    item = {
        "event_id": f"evt_{uuid.uuid4().hex[:16]}",
        "shop_id": shop_id,
        "shop_name": (shop or {}).get("name"),
        "shop_slug": (shop or {}).get("slug"),
        "kind": kind,
        "title": str(title or "")[:200],
        "description": str(description or "")[:1000],
        "metadata": metadata or {},
        "created_at": now,
        "created_by_user_id": (admin or {}).get("user_id"),
        "created_by_email": (admin or {}).get("email"),
    }

    await db.admin_tenant_timeline.insert_one(dict(item))
    return item


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2B_OG_TIMELINE_V1
@router.post("/admin/tenant-view/{shop_id}/refresh-og-cache")
async def admin_tenant_refresh_og_cache(shop_id: str, request: Request):
    from datetime import datetime, timezone

    admin = await require_admin(request)

    shop = await _admin_tenant_timeline_shop(shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    slug = shop.get("slug") or ""
    if not slug:
        raise HTTPException(status_code=400, detail="Slug toko belum tersedia")

    base_url = _admin_tenant_timeline_public_base_url(request)
    token = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    cache_bust = f"admin-og-{token}"

    storefront_url = f"{base_url}/toko/{slug}" if base_url else f"/toko/{slug}"
    share_url = f"{storefront_url}?v={cache_bust}"
    og_image_url = f"{base_url}/api/og/shop/{slug}.png?v={cache_bust}" if base_url else f"/api/og/shop/{slug}.png?v={cache_bust}"
    og_html_url = f"{base_url}/api/og/shop/{slug}?v={cache_bust}" if base_url else f"/api/og/shop/{slug}?v={cache_bust}"

    debug_text = "\n".join([
        "Lapakin OG Refresh / Cache-busted Links",
        f"Shop: {shop.get('name') or '-'}",
        f"Shop ID: {shop_id}",
        f"Slug: {slug}",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        "",
        "Use this URL to force WA/FB to fetch a fresh preview:",
        share_url,
        "",
        "Direct OG image:",
        og_image_url,
        "",
        "OG HTML endpoint:",
        og_html_url,
        "",
        "Note: this does not purge WhatsApp/Meta cache globally; it provides a fresh cache-busted URL for support/testing.",
    ])

    item = await _admin_tenant_timeline_record(
        shop_id,
        shop,
        "og_refresh",
        "Refresh OG cache-busted URL",
        "Admin generated fresh OG/cache-busted share links.",
        admin,
        {
            "share_url": share_url,
            "og_image_url": og_image_url,
            "og_html_url": og_html_url,
            "cache_bust": cache_bust,
        },
    )

    try:
        await log_admin_action(
            admin,
            "tenant_refresh_og_cache",
            "shop",
            shop_id,
            {
                "shop_name": shop.get("name"),
                "slug": slug,
                "share_url": share_url,
            },
        )
    except Exception:
        pass

    return {
        "ok": True,
        "message": "OG cache-busted links dibuat dan dicatat di timeline.",
        "event": item,
        "share_url": share_url,
        "og_image_url": og_image_url,
        "og_html_url": og_html_url,
        "debug_text": debug_text,
    }


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2B_OG_TIMELINE_V1
@router.get("/admin/tenant-view/{shop_id}/timeline")
async def admin_tenant_timeline(shop_id: str, request: Request, limit: int = 60):
    await require_admin(request)

    shop = await _admin_tenant_timeline_shop(shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    limit = max(10, min(int(limit or 60), 200))
    items = []

    # Internal support timeline events.
    try:
        events = await db.admin_tenant_timeline.find({"shop_id": shop_id}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    except Exception:
        events = []

    for event in events:
        items.append({
            "id": event.get("event_id"),
            "kind": event.get("kind") or "event",
            "title": event.get("title") or "Admin event",
            "description": event.get("description") or "",
            "created_at": event.get("created_at"),
            "actor": event.get("created_by_email") or "admin",
            "metadata": event.get("metadata") or {},
            "source": "timeline",
        })

    # Support notes.
    try:
        notes = await db.admin_support_notes.find({"shop_id": shop_id}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    except Exception:
        notes = []

    for note in notes:
        archived = bool(note.get("archived_at"))
        items.append({
            "id": note.get("note_id"),
            "kind": "note_archived" if archived else "note",
            "title": "Support note archived" if archived else "Support note added",
            "description": note.get("note") or "",
            "created_at": note.get("archived_at") or note.get("created_at"),
            "actor": note.get("archived_by_email") or note.get("created_by_email") or "admin",
            "metadata": {
                "priority": note.get("priority"),
                "category": note.get("category"),
            },
            "source": "support_notes",
        })

    # Audit logs related to this shop, best-effort across old schemas.
    audit_query = {
        "$or": [
            {"target_id": shop_id},
            {"target": shop_id},
            {"resource_id": shop_id},
            {"entity_id": shop_id},
            {"details.shop_id": shop_id},
            {"metadata.shop_id": shop_id},
        ]
    }

    try:
        audits = await db.audit_logs.find(audit_query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    except Exception:
        audits = []

    for audit in audits:
        action = audit.get("action") or audit.get("event") or "audit"
        items.append({
            "id": audit.get("audit_id") or audit.get("log_id") or f"audit_{str(audit.get('created_at') or '')}",
            "kind": "audit",
            "title": str(action).replace("_", " ").title(),
            "description": str(audit.get("description") or audit.get("detail") or "")[:1000],
            "created_at": audit.get("created_at") or audit.get("timestamp"),
            "actor": audit.get("admin_email") or audit.get("email") or audit.get("user_email") or "admin",
            "metadata": audit.get("details") or audit.get("metadata") or {},
            "source": "audit_logs",
        })

    def sort_key(item):
        return str(item.get("created_at") or "")

    items.sort(key=sort_key, reverse=True)

    return {
        "items": items[:limit],
        "summary": {
            "total": len(items[:limit]),
            "timeline_events": len(events),
            "notes": len(notes),
            "audits": len(audits),
        },
    }


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2C_SUPPORT_CASE_V1
class AdminTenantSupportCaseIn(BaseModel):
    status: Optional[str] = "open"
    priority: Optional[str] = "normal"
    summary: Optional[str] = ""
    next_step: Optional[str] = ""


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2C_SUPPORT_CASE_V1
def _admin_tenant_support_case_clean(value, limit=1000):
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "…"


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2C_SUPPORT_CASE_V1
def _admin_tenant_support_case_default(shop_id: str, shop: dict):
    return {
        "case_id": f"case_{shop_id}",
        "shop_id": shop_id,
        "shop_name": (shop or {}).get("name"),
        "shop_slug": (shop or {}).get("slug"),
        "status": "open",
        "priority": "normal",
        "summary": "",
        "next_step": "",
        "created_at": None,
        "updated_at": None,
        "created_by_email": "",
        "updated_by_email": "",
        "is_default": True,
    }


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2C_SUPPORT_CASE_V1
@router.get("/admin/tenant-view/{shop_id}/case")
async def admin_tenant_support_case_get(shop_id: str, request: Request):
    await require_admin(request)

    shop = await _admin_tenant_timeline_shop(shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    item = await db.admin_support_cases.find_one(
        {"shop_id": shop_id},
        {"_id": 0},
        sort=[("updated_at", -1)],
    )

    return {
        "item": item or _admin_tenant_support_case_default(shop_id, shop),
    }


# LAPAKIN_ADMIN_TENANT_VIEW_PHASE2C_SUPPORT_CASE_V1
@router.patch("/admin/tenant-view/{shop_id}/case")
async def admin_tenant_support_case_update(shop_id: str, data: AdminTenantSupportCaseIn, request: Request):
    from datetime import datetime, timezone

    admin = await require_admin(request)

    shop = await _admin_tenant_timeline_shop(shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    status = str(data.status or "open").strip().lower()
    if status not in {"open", "in_progress", "resolved"}:
        raise HTTPException(status_code=400, detail="Status harus open, in_progress, atau resolved")

    priority = str(data.priority or "normal").strip().lower()
    if priority not in {"low", "normal", "high", "urgent"}:
        priority = "normal"

    summary = _admin_tenant_support_case_clean(data.summary, 1200)
    next_step = _admin_tenant_support_case_clean(data.next_step, 1200)

    now = datetime.now(timezone.utc).isoformat()
    existing = await db.admin_support_cases.find_one({"shop_id": shop_id}, {"_id": 0})

    set_on_insert = {
        "case_id": f"case_{shop_id}",
        "shop_id": shop_id,
        "shop_name": shop.get("name"),
        "shop_slug": shop.get("slug"),
        "created_at": now,
        "created_by_user_id": (admin or {}).get("user_id"),
        "created_by_email": (admin or {}).get("email"),
    }

    update = {
        "status": status,
        "priority": priority,
        "summary": summary,
        "next_step": next_step,
        "updated_at": now,
        "updated_by_user_id": (admin or {}).get("user_id"),
        "updated_by_email": (admin or {}).get("email"),
    }

    if status == "resolved":
        update["resolved_at"] = now
        update["resolved_by_email"] = (admin or {}).get("email")
    else:
        update["resolved_at"] = None
        update["resolved_by_email"] = ""

    await db.admin_support_cases.update_one(
        {"shop_id": shop_id},
        {
            "$setOnInsert": set_on_insert,
            "$set": update,
        },
        upsert=True,
    )

    item = await db.admin_support_cases.find_one({"shop_id": shop_id}, {"_id": 0})

    previous_status = (existing or {}).get("status")
    previous_priority = (existing or {}).get("priority")

    timeline_description = "\n".join([
        f"Status: {previous_status or '-'} → {status}",
        f"Priority: {previous_priority or '-'} → {priority}",
        f"Summary: {summary or '-'}",
        f"Next step: {next_step or '-'}",
    ])

    try:
        await _admin_tenant_timeline_record(
            shop_id,
            shop,
            "support_case",
            "Support case updated",
            timeline_description,
            admin,
            {
                "status": status,
                "priority": priority,
                "previous_status": previous_status,
                "previous_priority": previous_priority,
            },
        )
    except Exception:
        pass

    try:
        await log_admin_action(
            admin,
            "tenant_support_case_update",
            "shop",
            shop_id,
            {
                "shop_name": shop.get("name"),
                "slug": shop.get("slug"),
                "status": status,
                "priority": priority,
            },
        )
    except Exception:
        pass

    return {
        "ok": True,
        "item": item,
    }


# LAPAKIN_ADMIN_SUPPORT_QUEUE_PHASE2D_V1
def _admin_support_queue_clean_status(value: str) -> str:
    value = str(value or "active").strip().lower()
    if value in {"all", "open", "in_progress", "resolved", "active"}:
        return value
    return "active"


# LAPAKIN_ADMIN_SUPPORT_QUEUE_PHASE2D_V1
def _admin_support_queue_clean_priority(value: str) -> str:
    value = str(value or "all").strip().lower()
    if value in {"all", "low", "normal", "high", "urgent"}:
        return value
    return "all"


# LAPAKIN_ADMIN_SUPPORT_QUEUE_PHASE2D_V1
async def _admin_support_queue_enrich_cases(items: list[dict]) -> list[dict]:
    shop_ids = [item.get("shop_id") for item in items if item.get("shop_id")]
    shops_by_id = {}

    if shop_ids:
        shops = await db.shops.find(
            {"shop_id": {"$in": shop_ids}},
            {"_id": 0, "shop_id": 1, "name": 1, "slug": 1, "status": 1, "owner_user_id": 1, "user_id": 1},
        ).to_list(len(shop_ids))
        shops_by_id = {shop.get("shop_id"): shop for shop in shops}

    owner_ids = []
    for shop in shops_by_id.values():
        owner_id = shop.get("owner_user_id") or shop.get("user_id")
        if owner_id:
            owner_ids.append(owner_id)

    owners_by_id = {}
    if owner_ids:
        owners = await db.users.find(
            {"user_id": {"$in": owner_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1, "tier": 1, "plan": 1},
        ).to_list(len(owner_ids))
        owners_by_id = {owner.get("user_id"): owner for owner in owners}

    enriched = []
    for item in items:
        row = dict(item or {})
        row.pop("_id", None)

        shop = shops_by_id.get(row.get("shop_id")) or {}
        owner_id = shop.get("owner_user_id") or shop.get("user_id")
        owner = owners_by_id.get(owner_id) or {}

        row["shop"] = shop
        row["owner"] = owner
        row["shop_name"] = row.get("shop_name") or shop.get("name") or "-"
        row["shop_slug"] = row.get("shop_slug") or shop.get("slug") or ""

        enriched.append(row)

    return enriched


# LAPAKIN_ADMIN_SUPPORT_QUEUE_PHASE2D_V1
@router.get("/admin/support-cases")
async def admin_support_cases_queue(
    request: Request,
    status: str = "active",
    priority: str = "all",
    q: str = "",
    limit: int = 100,
):
    await require_admin(request)

    status = _admin_support_queue_clean_status(status)
    priority = _admin_support_queue_clean_priority(priority)
    limit = max(1, min(int(limit or 100), 300))

    query = {}

    if status == "active":
        query["status"] = {"$in": ["open", "in_progress"]}
    elif status != "all":
        query["status"] = status

    if priority != "all":
        query["priority"] = priority

    if q:
        needle = str(q).strip()
        query["$or"] = [
            {"shop_name": {"$regex": needle, "$options": "i"}},
            {"shop_slug": {"$regex": needle, "$options": "i"}},
            {"shop_id": {"$regex": needle, "$options": "i"}},
            {"summary": {"$regex": needle, "$options": "i"}},
            {"next_step": {"$regex": needle, "$options": "i"}},
            {"updated_by_email": {"$regex": needle, "$options": "i"}},
        ]

    items = await db.admin_support_cases.find(query, {"_id": 0}).sort("updated_at", -1).limit(limit).to_list(limit)
    enriched_items = await _admin_support_queue_enrich_cases(items)

    summary = {
        "open": await db.admin_support_cases.count_documents({"status": "open"}),
        "in_progress": await db.admin_support_cases.count_documents({"status": "in_progress"}),
        "resolved": await db.admin_support_cases.count_documents({"status": "resolved"}),
        "urgent": await db.admin_support_cases.count_documents({"status": {"$in": ["open", "in_progress"]}, "priority": "urgent"}),
        "high": await db.admin_support_cases.count_documents({"status": {"$in": ["open", "in_progress"]}, "priority": "high"}),
        "active": await db.admin_support_cases.count_documents({"status": {"$in": ["open", "in_progress"]}}),
    }

    return {
        "items": enriched_items,
        "summary": summary,
        "filters": {
            "status": status,
            "priority": priority,
            "q": q,
            "limit": limit,
        },
    }


# LAPAKIN_MALL_PHASE1B_ADMIN_MANAGEMENT_V1
class AdminMallListingIn(BaseModel):
    product_id: str
    status: Optional[str] = "approved"
    mall_category: Optional[str] = ""
    mall_badge: Optional[str] = ""
    mall_rank: Optional[int] = 100
    featured: Optional[bool] = False
    highlight: Optional[str] = ""


# LAPAKIN_MALL_PHASE1B_ADMIN_MANAGEMENT_V1
class AdminMallListingUpdateIn(BaseModel):
    status: Optional[str] = None
    mall_category: Optional[str] = None
    mall_badge: Optional[str] = None
    mall_rank: Optional[int] = None
    featured: Optional[bool] = None
    highlight: Optional[str] = None
    hidden: Optional[bool] = None


# LAPAKIN_MALL_PHASE1B_ADMIN_MANAGEMENT_V1
def _admin_mall_clean_text(value, limit=500):
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "…"


# LAPAKIN_MALL_PHASE1B_ADMIN_MANAGEMENT_V1
def _admin_mall_status(value, default="approved"):
    value = str(value or default).strip().lower()
    if value not in {"pending", "approved", "rejected", "hidden"}:
        return default
    return value


# LAPAKIN_MALL_PHASE1B_ADMIN_MANAGEMENT_V1
def _admin_mall_product_active(product):
    if not product:
        return False

    availability = str(product.get("availability_status") or "").lower()
    if availability in {"hidden", "out_of_stock"}:
        return False

    status = str(product.get("status") or "").lower()
    if status in {"hidden", "deleted", "inactive"}:
        return False

    if product.get("is_active") is False:
        return False

    return True


# LAPAKIN_MALL_PHASE1B_ADMIN_MANAGEMENT_V1
def _admin_mall_shop_active(shop):
    if not shop:
        return False

    status = str(shop.get("status") or "active").lower()
    if status in {"deleted", "suspended", "inactive"}:
        return False

    if shop.get("deleted_at"):
        return False

    return bool(shop.get("slug"))


# LAPAKIN_MALL_PHASE1B_ADMIN_MANAGEMENT_V1
def _admin_mall_product_image(product):
    product = product or {}

    for key in ["image_url", "thumbnail_url", "photo_url", "image_data"]:
        value = product.get(key)
        if value:
            return value

    images = product.get("images")
    if isinstance(images, list) and images:
        return images[0]

    return ""


# LAPAKIN_MALL_PHASE1B_ADMIN_MANAGEMENT_V1
async def _admin_mall_enrich_listings(listings):
    product_ids = [item.get("product_id") for item in listings if item.get("product_id")]
    shop_ids = [item.get("shop_id") for item in listings if item.get("shop_id")]

    products_by_id = {}
    shops_by_id = {}

    if product_ids:
        products = await db.products.find({"product_id": {"$in": product_ids}}, {"_id": 0}).to_list(len(product_ids))
        products_by_id = {item.get("product_id"): item for item in products}

    if shop_ids:
        shops = await db.shops.find({"shop_id": {"$in": shop_ids}}, {"_id": 0}).to_list(len(shop_ids))
        shops_by_id = {item.get("shop_id"): item for item in shops}

    rows = []
    for listing in listings:
        row = dict(listing or {})
        row.pop("_id", None)

        product = products_by_id.get(row.get("product_id")) or {}
        shop = shops_by_id.get(row.get("shop_id")) or {}

        row["product"] = {
            "product_id": product.get("product_id") or row.get("product_id"),
            "name": product.get("name") or "-",
            "description": product.get("description") or product.get("caption") or "",
            "price": product.get("price") or 0,
            "stock": product.get("stock"),
            "category": product.get("category_name") or product.get("category") or "",
            "image": _admin_mall_product_image(product),
            "availability_status": product.get("availability_status"),
            "is_active": product.get("is_active", True),
            "active_for_mall": _admin_mall_product_active(product),
        }

        row["shop"] = {
            "shop_id": shop.get("shop_id") or row.get("shop_id"),
            "name": shop.get("name") or "-",
            "slug": shop.get("slug") or "",
            "status": shop.get("status") or "active",
            "business_type": shop.get("business_type") or "",
            "brand_color": shop.get("brand_color") or "#C04A3B",
            "active_for_mall": _admin_mall_shop_active(shop),
        }

        rows.append(row)

    return rows


# LAPAKIN_MALL_PHASE1B_ADMIN_MANAGEMENT_V1
@router.get("/admin/mall/listings")
async def admin_mall_listings(request: Request, status: str = "all", q: str = "", limit: int = 100):
    await require_admin(request)

    status = str(status or "all").strip().lower()
    limit = max(1, min(int(limit or 100), 300))

    query = {}
    if status != "all":
        query["status"] = _admin_mall_status(status)

    if q:
        needle = str(q).strip()
        query["$or"] = [
            {"listing_id": {"$regex": needle, "$options": "i"}},
            {"product_id": {"$regex": needle, "$options": "i"}},
            {"shop_id": {"$regex": needle, "$options": "i"}},
            {"mall_category": {"$regex": needle, "$options": "i"}},
            {"mall_badge": {"$regex": needle, "$options": "i"}},
            {"highlight": {"$regex": needle, "$options": "i"}},
        ]

    listings = await db.mall_listings.find(query, {"_id": 0}).sort([("featured", -1), ("mall_rank", 1), ("created_at", -1)]).limit(limit).to_list(limit)
    items = await _admin_mall_enrich_listings(listings)

    summary = {
        "all": await db.mall_listings.count_documents({}),
        "pending": await db.mall_listings.count_documents({"status": "pending"}),
        "approved": await db.mall_listings.count_documents({"status": "approved"}),
        "rejected": await db.mall_listings.count_documents({"status": "rejected"}),
        "hidden": await db.mall_listings.count_documents({"status": "hidden"}),
        "featured": await db.mall_listings.count_documents({"featured": True, "status": "approved"}),
    }

    return {
        "items": items,
        "summary": summary,
        "filters": {
            "status": status,
            "q": q,
            "limit": limit,
        },
    }


# LAPAKIN_MALL_PHASE1B_ADMIN_MANAGEMENT_V1
@router.get("/admin/mall/candidate-products")
async def admin_mall_candidate_products(request: Request, q: str = "", limit: int = 80):
    await require_admin(request)

    limit = max(1, min(int(limit or 80), 200))
    query = {}

    if q:
        needle = str(q).strip()
        query["$or"] = [
            {"name": {"$regex": needle, "$options": "i"}},
            {"description": {"$regex": needle, "$options": "i"}},
            {"caption": {"$regex": needle, "$options": "i"}},
            {"category": {"$regex": needle, "$options": "i"}},
            {"category_name": {"$regex": needle, "$options": "i"}},
            {"product_id": {"$regex": needle, "$options": "i"}},
            {"shop_id": {"$regex": needle, "$options": "i"}},
        ]

    products = await db.products.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)

    shop_ids = [item.get("shop_id") for item in products if item.get("shop_id")]
    product_ids = [item.get("product_id") for item in products if item.get("product_id")]

    shops_by_id = {}
    listing_product_ids = set()

    if shop_ids:
        shops = await db.shops.find({"shop_id": {"$in": shop_ids}}, {"_id": 0}).to_list(len(shop_ids))
        shops_by_id = {item.get("shop_id"): item for item in shops}

    if product_ids:
        listings = await db.mall_listings.find({"product_id": {"$in": product_ids}}, {"_id": 0, "product_id": 1, "status": 1}).to_list(len(product_ids))
        listing_product_ids = {item.get("product_id") for item in listings if item.get("product_id")}

    items = []
    for product in products:
        shop = shops_by_id.get(product.get("shop_id")) or {}
        active = _admin_mall_product_active(product) and _admin_mall_shop_active(shop)

        items.append({
            "product_id": product.get("product_id"),
            "shop_id": product.get("shop_id"),
            "name": product.get("name") or "-",
            "description": product.get("description") or product.get("caption") or "",
            "price": product.get("price") or 0,
            "stock": product.get("stock"),
            "category": product.get("category_name") or product.get("category") or shop.get("business_type") or "Pilihan UMKM",
            "image": _admin_mall_product_image(product),
            "active_for_mall": active,
            "already_listed": product.get("product_id") in listing_product_ids,
            "shop": {
                "shop_id": shop.get("shop_id"),
                "name": shop.get("name") or "-",
                "slug": shop.get("slug") or "",
                "status": shop.get("status") or "active",
                "active_for_mall": _admin_mall_shop_active(shop),
            },
        })

    return {
        "items": items,
        "summary": {
            "total": len(items),
            "active_candidates": len([item for item in items if item.get("active_for_mall") and not item.get("already_listed")]),
        },
    }


# LAPAKIN_MALL_PHASE1B_ADMIN_MANAGEMENT_V1
@router.post("/admin/mall/listings")
async def admin_mall_create_listing(data: AdminMallListingIn, request: Request):
    import uuid
    from datetime import datetime, timezone

    admin = await require_admin(request)

    product_id = _admin_mall_clean_text(data.product_id, 120)
    if not product_id:
        raise HTTPException(status_code=400, detail="product_id wajib diisi")

    product = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")

    shop = await db.shops.find_one({"shop_id": product.get("shop_id")}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko produk tidak ditemukan")

    if not _admin_mall_product_active(product):
        raise HTTPException(status_code=400, detail="Produk tidak aktif/hidden/habis, tidak bisa masuk mall")

    if not _admin_mall_shop_active(shop):
        raise HTTPException(status_code=400, detail="Toko tidak aktif atau slug tidak valid, tidak bisa masuk mall")

    existing = await db.mall_listings.find_one({"product_id": product_id}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Produk sudah ada di Mall")

    now = datetime.now(timezone.utc).isoformat()
    status = _admin_mall_status(data.status, "approved")
    rank = int(data.mall_rank or 100)

    doc = {
        "listing_id": f"mall_{uuid.uuid4().hex[:14]}",
        "shop_id": product.get("shop_id"),
        "product_id": product_id,
        "status": status,
        "mall_category": _admin_mall_clean_text(data.mall_category or product.get("category_name") or product.get("category") or shop.get("business_type") or "Pilihan UMKM", 120),
        "mall_badge": _admin_mall_clean_text(data.mall_badge, 60),
        "mall_rank": rank,
        "featured": bool(data.featured),
        "highlight": _admin_mall_clean_text(data.highlight or product.get("description") or product.get("caption") or "", 500),
        "hidden": status == "hidden",
        "created_at": now,
        "updated_at": now,
        "approved_at": now if status == "approved" else "",
        "created_by_user_id": (admin or {}).get("user_id"),
        "created_by_email": (admin or {}).get("email"),
        "source": "admin",
    }

    await db.mall_listings.insert_one(dict(doc))

    try:
        await log_admin_action(
            admin,
            "mall_listing_create",
            "mall_listing",
            doc["listing_id"],
            {
                "product_id": product_id,
                "shop_id": product.get("shop_id"),
                "shop_name": shop.get("name"),
                "status": status,
            },
        )
    except Exception:
        pass

    enriched = await _admin_mall_enrich_listings([doc])
    return {"ok": True, "item": enriched[0] if enriched else doc}


# LAPAKIN_MALL_PHASE1B_ADMIN_MANAGEMENT_V1
@router.patch("/admin/mall/listings/{listing_id}")
async def admin_mall_update_listing(listing_id: str, data: AdminMallListingUpdateIn, request: Request):
    from datetime import datetime, timezone

    admin = await require_admin(request)

    existing = await db.mall_listings.find_one({"listing_id": listing_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Listing Mall tidak ditemukan")

    now = datetime.now(timezone.utc).isoformat()
    update = {
        "updated_at": now,
        "updated_by_user_id": (admin or {}).get("user_id"),
        "updated_by_email": (admin or {}).get("email"),
    }

    if data.status is not None:
        status = _admin_mall_status(data.status, existing.get("status") or "approved")
        update["status"] = status
        update["hidden"] = status == "hidden"
        if status == "approved" and not existing.get("approved_at"):
            update["approved_at"] = now

    if data.mall_category is not None:
        update["mall_category"] = _admin_mall_clean_text(data.mall_category, 120)

    if data.mall_badge is not None:
        update["mall_badge"] = _admin_mall_clean_text(data.mall_badge, 60)

    if data.mall_rank is not None:
        update["mall_rank"] = int(data.mall_rank or 100)

    if data.featured is not None:
        update["featured"] = bool(data.featured)

    if data.highlight is not None:
        update["highlight"] = _admin_mall_clean_text(data.highlight, 500)

    if data.hidden is not None:
        update["hidden"] = bool(data.hidden)
        if bool(data.hidden):
            update["status"] = "hidden"

    await db.mall_listings.update_one({"listing_id": listing_id}, {"$set": update})

    item = await db.mall_listings.find_one({"listing_id": listing_id}, {"_id": 0})
    enriched = await _admin_mall_enrich_listings([item])

    try:
        await log_admin_action(
            admin,
            "mall_listing_update",
            "mall_listing",
            listing_id,
            {
                "product_id": existing.get("product_id"),
                "shop_id": existing.get("shop_id"),
                "changes": update,
            },
        )
    except Exception:
        pass

    return {"ok": True, "item": enriched[0] if enriched else item}


# LAPAKIN_MALL_PHASE1F_ANALYTICS_V1
def _admin_mall_analytics_date_key(value):
    text = str(value or "")
    if len(text) >= 10:
        return text[:10]
    return ""


# LAPAKIN_MALL_PHASE1F_ANALYTICS_V1
async def _admin_mall_analytics_enrich_products(product_stats: dict, limit: int = 10):
    product_ids = [pid for pid in product_stats.keys() if pid]
    if not product_ids:
        return []

    products = await db.products.find({"product_id": {"$in": product_ids}}, {"_id": 0}).to_list(len(product_ids))
    products_by_id = {p.get("product_id"): p for p in products}

    shop_ids = [p.get("shop_id") for p in products if p.get("shop_id")]
    shops_by_id = {}
    if shop_ids:
        shops = await db.shops.find({"shop_id": {"$in": shop_ids}}, {"_id": 0, "shop_id": 1, "name": 1, "slug": 1}).to_list(len(shop_ids))
        shops_by_id = {s.get("shop_id"): s for s in shops}

    rows = []
    for product_id, stats in product_stats.items():
        product = products_by_id.get(product_id) or {}
        shop = shops_by_id.get(product.get("shop_id")) or {}

        rows.append({
            "product_id": product_id,
            "name": product.get("name") or product_id,
            "price": product.get("price") or 0,
            "shop_id": product.get("shop_id") or stats.get("shop_id") or "",
            "shop_name": shop.get("name") or "-",
            "shop_slug": shop.get("slug") or "",
            "views": stats.get("views", 0),
            "detail_views": stats.get("detail_views", 0),
            "product_clicks": stats.get("product_clicks", 0),
            "order_clicks": stats.get("order_clicks", 0),
            "store_clicks": stats.get("store_clicks", 0),
        })

    rows.sort(key=lambda row: (row["order_clicks"], row["detail_views"], row["product_clicks"], row["views"]), reverse=True)
    return rows[:limit]


# LAPAKIN_MALL_PHASE1F_ANALYTICS_V1
async def _admin_mall_analytics_enrich_shops(shop_stats: dict, limit: int = 10):
    shop_ids = [sid for sid in shop_stats.keys() if sid]
    if not shop_ids:
        return []

    shops = await db.shops.find({"shop_id": {"$in": shop_ids}}, {"_id": 0, "shop_id": 1, "name": 1, "slug": 1, "business_type": 1}).to_list(len(shop_ids))
    shops_by_id = {s.get("shop_id"): s for s in shops}

    rows = []
    for shop_id, stats in shop_stats.items():
        shop = shops_by_id.get(shop_id) or {}

        rows.append({
            "shop_id": shop_id,
            "name": shop.get("name") or shop_id,
            "slug": shop.get("slug") or "",
            "business_type": shop.get("business_type") or "",
            "views": stats.get("views", 0),
            "detail_views": stats.get("detail_views", 0),
            "product_clicks": stats.get("product_clicks", 0),
            "order_clicks": stats.get("order_clicks", 0),
            "store_clicks": stats.get("store_clicks", 0),
        })

    rows.sort(key=lambda row: (row["order_clicks"], row["detail_views"], row["product_clicks"], row["views"]), reverse=True)
    return rows[:limit]


# LAPAKIN_MALL_PHASE1F_ANALYTICS_V1
@router.get("/admin/mall/analytics")
async def admin_mall_analytics(request: Request, days: int = 30, limit: int = 10):
    from datetime import datetime, timezone, timedelta

    await require_admin(request)

    days = max(1, min(int(days or 30), 180))
    limit = max(3, min(int(limit or 10), 30))

    now = datetime.now(timezone.utc)
    start_date = now - timedelta(days=days - 1)
    cutoff = start_date.strftime("%Y-%m-%dT00:00:00")

    events = await db.mall_events.find(
        {"created_at": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("created_at", -1).limit(20000).to_list(20000)

    totals = {
        "mall_view": 0,
        "mall_search": 0,
        "mall_product_click": 0,
        "mall_product_view": 0,
        "mall_order_click": 0,
        "mall_store_click": 0,
        "total_events": 0,
    }

    daily = {}
    for i in range(days):
        key = (start_date + timedelta(days=i)).strftime("%Y-%m-%d")
        daily[key] = {
            "date": key,
            "views": 0,
            "searches": 0,
            "product_views": 0,
            "product_clicks": 0,
            "order_clicks": 0,
            "store_clicks": 0,
        }

    product_stats = {}
    shop_stats = {}

    for event in events:
        event_type = str(event.get("event_type") or event.get("event") or "").strip().lower()
        if event_type not in totals:
            continue

        totals[event_type] += 1
        totals["total_events"] += 1

        date_key = _admin_mall_analytics_date_key(event.get("created_at"))
        if date_key in daily:
            if event_type == "mall_view":
                daily[date_key]["views"] += 1
            elif event_type == "mall_search":
                daily[date_key]["searches"] += 1
            elif event_type == "mall_product_view":
                daily[date_key]["product_views"] += 1
            elif event_type == "mall_product_click":
                daily[date_key]["product_clicks"] += 1
            elif event_type == "mall_order_click":
                daily[date_key]["order_clicks"] += 1
            elif event_type == "mall_store_click":
                daily[date_key]["store_clicks"] += 1

        product_id = str(event.get("product_id") or "").strip()
        shop_id = str(event.get("shop_id") or "").strip()

        if product_id:
            stats = product_stats.setdefault(product_id, {
                "shop_id": shop_id,
                "views": 0,
                "detail_views": 0,
                "product_clicks": 0,
                "order_clicks": 0,
                "store_clicks": 0,
            })

            if shop_id and not stats.get("shop_id"):
                stats["shop_id"] = shop_id

            if event_type == "mall_view":
                stats["views"] += 1
            elif event_type == "mall_product_view":
                stats["detail_views"] += 1
            elif event_type == "mall_product_click":
                stats["product_clicks"] += 1
            elif event_type == "mall_order_click":
                stats["order_clicks"] += 1
            elif event_type == "mall_store_click":
                stats["store_clicks"] += 1

        if shop_id:
            stats = shop_stats.setdefault(shop_id, {
                "views": 0,
                "detail_views": 0,
                "product_clicks": 0,
                "order_clicks": 0,
                "store_clicks": 0,
            })

            if event_type == "mall_view":
                stats["views"] += 1
            elif event_type == "mall_product_view":
                stats["detail_views"] += 1
            elif event_type == "mall_product_click":
                stats["product_clicks"] += 1
            elif event_type == "mall_order_click":
                stats["order_clicks"] += 1
            elif event_type == "mall_store_click":
                stats["store_clicks"] += 1

    product_views = totals["mall_product_view"] + totals["mall_product_click"]
    conversion_rate = round((totals["mall_order_click"] / product_views) * 100, 2) if product_views > 0 else 0

    listing_summary = {
        "all": await db.mall_listings.count_documents({}),
        "approved": await db.mall_listings.count_documents({"status": "approved"}),
        "pending": await db.mall_listings.count_documents({"status": "pending"}),
        "rejected": await db.mall_listings.count_documents({"status": "rejected"}),
        "hidden": await db.mall_listings.count_documents({"status": "hidden"}),
        "featured": await db.mall_listings.count_documents({"status": "approved", "featured": True}),
    }

    return {
        "totals": totals,
        "daily": list(daily.values()),
        "top_products": await _admin_mall_analytics_enrich_products(product_stats, limit),
        "top_shops": await _admin_mall_analytics_enrich_shops(shop_stats, limit),
        "listing_summary": listing_summary,
        "conversion_rate": conversion_rate,
        "filters": {
            "days": days,
            "limit": limit,
        },
    }

