"""
AI WA Bot — context & configuration routes.

Semua endpoint di sini dipakai oleh service ai-wa-bot (repo terpisah).
Tidak ada perubahan ke collection existing (shops, products, users).
Collection baru: bot_settings, bot_faqs, bot_shop_profile, bot_conversations.

Mount di: /api/bot/*
"""

import uuid
import hmac
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel

from deps import db, require_user, require_admin, log_admin_action

router = APIRouter()

# ─────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────

class BotSettingsIn(BaseModel):
    enabled: Optional[bool] = None
    mode: Optional[str] = None          # off | simulator_only | draft_only | auto_reply
    tone: Optional[str] = None          # ramah | santai | profesional | singkat
    bot_name: Optional[str] = None      # nama bot saat balas, default "Admin"
    language: Optional[str] = "id"
    outside_hours_message: Optional[str] = None
    fallback_message: Optional[str] = None
    handoff_keywords: Optional[List[str]] = None
    max_auto_replies: Optional[int] = None


class BotShopProfileIn(BaseModel):
    order_methods: Optional[List[str]] = None   # ["pickup", "delivery", "cod"]
    service_area: Optional[str] = None
    min_order: Optional[int] = None             # rupiah
    preorder_policy: Optional[str] = None
    store_notes: Optional[str] = None
    payment_notes: Optional[str] = None
    bank_accounts: Optional[List[dict]] = None  # [{bank, number, name}]


class BotFAQIn(BaseModel):
    question: str
    answer: str
    category: Optional[str] = "lainnya"
    # produk|harga|payment|jam_buka|lokasi|delivery|pickup|promo|preorder|komplain|lainnya
    is_active: Optional[bool] = True


class BotEventIn(BaseModel):
    shop_id: str
    event_type: str     # message.received | message.answered | handoff.required | dsb
    payload: Optional[dict] = {}


class BotConversationSummaryIn(BaseModel):
    shop_id: str
    customer_phone: str
    customer_name: Optional[str] = ""
    status: Optional[str] = "open"     # open | resolved | handoff
    last_intent: Optional[str] = None
    handoff_required: Optional[bool] = False
    message_count: Optional[int] = 0
    last_message_at: Optional[str] = None


# ─────────────────────────────────────────────
# Helper: ambil shop milik user
# ─────────────────────────────────────────────

async def _get_user_shop(user: dict):
    shop_id = user.get("shop_id")
    if not shop_id:
        raise HTTPException(status_code=404, detail="User belum punya toko")
    shop = await db.shops.find_one({"shop_id": shop_id}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")
    return shop


async def _get_shop_by_id(shop_id: str):
    shop = await db.shops.find_one({"shop_id": shop_id}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")
    return shop


# ─────────────────────────────────────────────
# Helper: hitung Bot Readiness Score
# ─────────────────────────────────────────────

async def _calculate_readiness(shop_id: str) -> dict:
    shop        = await db.shops.find_one({"shop_id": shop_id}, {"_id": 0}) or {}
    products    = await db.products.find(
        {"shop_id": shop_id, "is_active": {"$ne": False}}, {"_id": 0, "price": 1}
    ).to_list(100)
    settings    = await db.bot_settings.find_one({"shop_id": shop_id}, {"_id": 0}) or {}
    faqs        = await db.bot_faqs.find(
        {"shop_id": shop_id, "is_active": True}, {"_id": 0}
    ).to_list(100)
    profile     = await db.bot_shop_profile.find_one({"shop_id": shop_id}, {"_id": 0}) or {}
    payment_ok  = bool(
        shop.get("storefront_payment_instruction")
        or shop.get("storefront_qris_image")
        or profile.get("bank_accounts")
        or profile.get("payment_notes")
    )

    checklist = {
        "nama_toko":        (bool(shop.get("name")),         10),
        "deskripsi_toko":   (bool(shop.get("description")),  10),
        "whatsapp_ada":     (bool(shop.get("whatsapp")),     10),
        "produk_minimal_3": (len(products) >= 3,             15),
        "harga_lengkap":    (all(p.get("price", 0) > 0 for p in products) and len(products) > 0, 10),
        "jam_buka_ada":     (bool(shop.get("hours") or shop.get("schedule")), 10),
        "payment_ada":      (payment_ok,                     10),
        "faq_minimal_5":    (len(faqs) >= 5,                 10),
        "handoff_keyword":  (bool(settings.get("handoff_keywords")), 10),
        "fallback_message": (bool(settings.get("fallback_message")),  5),
        "sudah_simulasi":   (bool(settings.get("last_simulated_at")),  5),  # bonus
    }

    score = sum(bobot for _, (ok, bobot) in checklist.items() if ok)

    if score < 50:
        status, label = "not_ready", "Belum Siap"
    elif score < 80:
        status, label = "need_setup", "Perlu Setup"
    else:
        status, label = "ready", "Siap Aktif"

    return {
        "score":          score,
        "status":         status,
        "label":          label,
        "checklist":      {k: {"ok": ok, "points": bobot} for k, (ok, bobot) in checklist.items()},
        "can_simulate":   True,
        "can_draft":      score >= 50,
        "can_auto_reply": score >= 80,
    }


# ─────────────────────────────────────────────
# CONTEXT API — dipakai oleh ai-wa-bot service
# ─────────────────────────────────────────────

@router.get("/bot/shops/{shop_id}/context")
async def bot_get_shop_context(shop_id: str, request: Request):
    """
    Endpoint utama untuk ai-wa-bot service.
    Menggabungkan data toko existing + bot config tanpa ubah schema existing.
    Akses: service token (X-Bot-Token header) atau admin.
    """
    # Service token auth — ai-wa-bot service pakai header ini
    bot_token = request.headers.get("X-Bot-Token", "")
    import os
    valid_token = os.environ.get("BOT_SERVICE_TOKEN", "")
    is_service  = valid_token and bot_token == valid_token

    if not is_service:
        # Fallback: cek admin auth
        try:
            await require_admin(request)
        except Exception:
            raise HTTPException(status_code=401, detail="Unauthorized. Pakai X-Bot-Token header.")

    # Data existing — read only
    shop = await _get_shop_by_id(shop_id)
    owner = await db.users.find_one(
        {"user_id": shop["owner_user_id"]}, {"_id": 0, "password_hash": 0}
    ) or {}
    products = await db.products.find(
        {"shop_id": shop_id, "is_active": {"$ne": False}},
        {"_id": 0, "product_id": 1, "name": 1, "price": 1, "stock": 1,
         "description": 1, "availability_status": 1, "available_days": 1}
    ).sort("sort_order", 1).to_list(200)

    # Data bot — collection baru
    bot_settings = await db.bot_settings.find_one({"shop_id": shop_id}, {"_id": 0}) or {}
    bot_faqs     = await db.bot_faqs.find(
        {"shop_id": shop_id, "is_active": True}, {"_id": 0}
    ).sort("category", 1).to_list(200)
    bot_profile  = await db.bot_shop_profile.find_one({"shop_id": shop_id}, {"_id": 0}) or {}
    readiness    = await _calculate_readiness(shop_id)

    return {
        "shop": {
            # Field existing
            "shop_id":      shop.get("shop_id"),
            "name":         shop.get("name"),
            "description":  shop.get("description"),
            "whatsapp":     shop.get("whatsapp"),
            "category":     shop.get("category") or shop.get("business_type"),
            "address":      shop.get("address"),
            "hours":        shop.get("hours"),
            "schedule":     shop.get("schedule", []),
            "about":        shop.get("about"),
            "is_active":    shop.get("is_active", True),
            "availability_status": shop.get("availability_status"),
            "is_open":      shop.get("is_open", True),
            "snooze_until": shop.get("snooze_until"),
            "promo_active": shop.get("promo_active", False),
            "promo_title":  shop.get("promo_title"),
            "promo_description": shop.get("promo_description"),
            # Field tambahan dari bot_shop_profile
            "order_methods": bot_profile.get("order_methods", []),
            "service_area":  bot_profile.get("service_area"),
            "min_order":     bot_profile.get("min_order"),
            "preorder_policy": bot_profile.get("preorder_policy"),
            "store_notes":   bot_profile.get("store_notes"),
        },
        "payment": {
            "instruction":  shop.get("storefront_payment_instruction"),
            "qris_image":   shop.get("storefront_qris_image"),
            "method_label": shop.get("storefront_payment_method_label"),
            "confirmation_text": shop.get("storefront_payment_confirmation_text"),
            # Dari bot_shop_profile
            "bank_accounts": bot_profile.get("bank_accounts", []),
            "payment_notes": bot_profile.get("payment_notes"),
        },
        "products":     products,
        "faqs":         bot_faqs,
        "bot_settings": {
            "enabled":       bot_settings.get("enabled", False),
            "mode":          bot_settings.get("mode", "off"),
            "tone":          bot_settings.get("tone", "ramah"),
            "bot_name":      bot_settings.get("bot_name", "Admin"),
            "language":      bot_settings.get("language", "id"),
            "outside_hours_message": bot_settings.get(
                "outside_hours_message",
                "Halo kak! Saat ini kami sedang tutup. Kami akan balas segera saat buka ya 🙏"
            ),
            "fallback_message": bot_settings.get(
                "fallback_message",
                "Maaf kak, untuk pertanyaan ini silakan hubungi admin kami ya 🙏"
            ),
            "handoff_keywords": bot_settings.get(
                "handoff_keywords",
                ["komplain", "refund", "batal", "bicara admin", "minta manusia"]
            ),
            "max_auto_replies": bot_settings.get("max_auto_replies", 10),
        },
        "owner": {
            "user_id": owner.get("user_id"),
            "name":    owner.get("name"),
            "tier":    owner.get("tier", "free"),
        },
        "readiness": readiness,
    }


@router.get("/bot/shops/by-wa/{phone}/context")
async def bot_get_context_by_phone(phone: str, request: Request):
    """Lookup context berdasarkan nomor WA — dipakai saat terima pesan masuk."""
    bot_token = request.headers.get("X-Bot-Token", "")
    import os
    valid_token = os.environ.get("BOT_SERVICE_TOKEN", "")
    is_service  = valid_token and bot_token == valid_token

    if not is_service:
        try:
            await require_admin(request)
        except Exception:
            raise HTTPException(status_code=401, detail="Unauthorized")

    # Normalize: hapus "whatsapp:", "+", spasi
    clean = phone.replace("whatsapp:", "").replace("+", "").replace(" ", "").strip()

    # Cari di shops.whatsapp (bisa format 08xx atau 628xx)
    shop = await db.shops.find_one({
        "$or": [
            {"whatsapp": clean},
            {"whatsapp": f"0{clean[2:]}" if clean.startswith("62") else clean},
            {"whatsapp": f"62{clean[1:]}" if clean.startswith("0") else clean},
        ]
    }, {"_id": 0, "shop_id": 1})

    # Fallback: cari di wa_links (Twilio pairing yang sudah ada)
    if not shop:
        wa_link = await db.wa_links.find_one({"phone": f"whatsapp:+{clean}"}, {"_id": 0})
        if wa_link:
            user = await db.users.find_one({"user_id": wa_link["user_id"]}, {"_id": 0})
            if user and user.get("shop_id"):
                shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0, "shop_id": 1})

    if not shop:
        raise HTTPException(status_code=404, detail=f"Toko dengan nomor WA {phone} tidak ditemukan")

    # Delegate ke context endpoint utama
    class _FakeRequest:
        def __init__(self, orig):
            self.headers = orig.headers
    return await bot_get_shop_context(shop["shop_id"], request)


# ─────────────────────────────────────────────
# BOT SETTINGS — owner manage konfigurasi bot
# ─────────────────────────────────────────────

@router.get("/bot/settings")
async def bot_get_settings(request: Request):
    """Owner: ambil konfigurasi bot toko miliknya."""
    user = await require_user(request)
    shop = await _get_user_shop(user)
    shop_id = shop["shop_id"]

    settings = await db.bot_settings.find_one({"shop_id": shop_id}, {"_id": 0}) or {}
    readiness = await _calculate_readiness(shop_id)

    return {
        "settings": {
            "shop_id":       shop_id,
            "enabled":       settings.get("enabled", False),
            "mode":          settings.get("mode", "off"),
            "tone":          settings.get("tone", "ramah"),
            "bot_name":      settings.get("bot_name", "Admin"),
            "language":      settings.get("language", "id"),
            "outside_hours_message": settings.get("outside_hours_message", ""),
            "fallback_message":      settings.get("fallback_message", ""),
            "handoff_keywords":      settings.get("handoff_keywords", []),
            "max_auto_replies":      settings.get("max_auto_replies", 10),
            "quota_monthly":         settings.get("quota_monthly", 100),
            "quota_used":            settings.get("quota_used", 0),
            "last_simulated_at":     settings.get("last_simulated_at"),
            "created_at":            settings.get("created_at"),
            "updated_at":            settings.get("updated_at"),
        },
        "readiness": readiness,
    }


@router.put("/bot/settings")
async def bot_update_settings(data: BotSettingsIn, request: Request):
    """Owner: update konfigurasi bot."""
    user = await require_user(request)
    shop = await _get_user_shop(user)
    shop_id = shop["shop_id"]

    # Validasi mode
    valid_modes = {"off", "simulator_only", "draft_only", "auto_reply"}
    if data.mode and data.mode not in valid_modes:
        raise HTTPException(status_code=400, detail=f"Mode tidak valid. Pilihan: {valid_modes}")

    # Validasi tone
    valid_tones = {"ramah", "santai", "profesional", "singkat", "ceria"}
    if data.tone and data.tone not in valid_tones:
        raise HTTPException(status_code=400, detail=f"Tone tidak valid. Pilihan: {valid_tones}")

    # Auto_reply butuh readiness >= 80
    if data.mode == "auto_reply":
        readiness = await _calculate_readiness(shop_id)
        if not readiness["can_auto_reply"]:
            raise HTTPException(
                status_code=400,
                detail=f"Bot readiness score {readiness['score']}/100. Minimal 80 untuk aktifkan auto-reply."
            )

    now = datetime.now(timezone.utc).isoformat()
    update = {"updated_at": now}

    if data.enabled is not None:     update["enabled"] = data.enabled
    if data.mode is not None:        update["mode"]    = data.mode
    if data.tone is not None:        update["tone"]    = data.tone
    if data.bot_name is not None:    update["bot_name"] = data.bot_name
    if data.language is not None:    update["language"] = data.language
    if data.outside_hours_message is not None:
        update["outside_hours_message"] = data.outside_hours_message
    if data.fallback_message is not None:
        update["fallback_message"] = data.fallback_message
    if data.handoff_keywords is not None:
        update["handoff_keywords"] = data.handoff_keywords
    if data.max_auto_replies is not None:
        update["max_auto_replies"] = max(1, min(data.max_auto_replies, 50))

    await db.bot_settings.update_one(
        {"shop_id": shop_id},
        {"$set": update, "$setOnInsert": {
            "shop_id":       shop_id,
            "quota_monthly": 100,
            "quota_used":    0,
            "created_at":    now,
        }},
        upsert=True,
    )

    return {"ok": True, "updated": list(update.keys())}


@router.post("/bot/settings/simulate-ping")
async def bot_simulate_ping(request: Request):
    """Tandai bahwa owner sudah mencoba simulator — update last_simulated_at."""
    user = await require_user(request)
    shop = await _get_user_shop(user)
    now  = datetime.now(timezone.utc).isoformat()

    await db.bot_settings.update_one(
        {"shop_id": shop["shop_id"]},
        {"$set": {"last_simulated_at": now, "updated_at": now},
         "$setOnInsert": {"shop_id": shop["shop_id"], "created_at": now}},
        upsert=True,
    )
    return {"ok": True, "last_simulated_at": now}


# ─────────────────────────────────────────────
# BOT SHOP PROFILE — data tambahan toko untuk bot
# ─────────────────────────────────────────────

@router.get("/bot/profile")
async def bot_get_profile(request: Request):
    """Owner: ambil data tambahan toko untuk bot."""
    user = await require_user(request)
    shop = await _get_user_shop(user)
    profile = await db.bot_shop_profile.find_one(
        {"shop_id": shop["shop_id"]}, {"_id": 0}
    ) or {}
    return {"profile": profile}


@router.put("/bot/profile")
async def bot_update_profile(data: BotShopProfileIn, request: Request):
    """Owner: update data tambahan toko untuk bot."""
    user = await require_user(request)
    shop = await _get_user_shop(user)
    shop_id = shop["shop_id"]
    now = datetime.now(timezone.utc).isoformat()

    update = {"updated_at": now}
    if data.order_methods is not None:  update["order_methods"]  = data.order_methods
    if data.service_area is not None:   update["service_area"]   = data.service_area
    if data.min_order is not None:      update["min_order"]      = data.min_order
    if data.preorder_policy is not None: update["preorder_policy"] = data.preorder_policy
    if data.store_notes is not None:    update["store_notes"]    = data.store_notes
    if data.payment_notes is not None:  update["payment_notes"]  = data.payment_notes
    if data.bank_accounts is not None:  update["bank_accounts"]  = data.bank_accounts

    await db.bot_shop_profile.update_one(
        {"shop_id": shop_id},
        {"$set": update, "$setOnInsert": {"shop_id": shop_id, "created_at": now}},
        upsert=True,
    )
    return {"ok": True}


# ─────────────────────────────────────────────
# BOT FAQs — knowledge base per toko
# ─────────────────────────────────────────────

@router.get("/bot/faqs")
async def bot_list_faqs(request: Request):
    """Owner: list semua FAQ toko."""
    user = await require_user(request)
    shop = await _get_user_shop(user)
    faqs = await db.bot_faqs.find(
        {"shop_id": shop["shop_id"]}, {"_id": 0}
    ).sort("category", 1).to_list(500)
    return {"faqs": faqs, "total": len(faqs)}


@router.post("/bot/faqs")
async def bot_create_faq(data: BotFAQIn, request: Request):
    """Owner: tambah FAQ baru."""
    user = await require_user(request)
    shop = await _get_user_shop(user)
    now  = datetime.now(timezone.utc).isoformat()

    faq_id = f"faq_{uuid.uuid4().hex[:12]}"
    doc = {
        "faq_id":     faq_id,
        "shop_id":    shop["shop_id"],
        "question":   data.question.strip(),
        "answer":     data.answer.strip(),
        "category":   data.category or "lainnya",
        "is_active":  data.is_active if data.is_active is not None else True,
        "source":     "manual",
        "hit_count":  0,
        "created_at": now,
        "updated_at": now,
    }
    await db.bot_faqs.insert_one(doc)
    doc.pop("_id", None)
    return {"ok": True, "faq": doc}


@router.put("/bot/faqs/{faq_id}")
async def bot_update_faq(faq_id: str, data: BotFAQIn, request: Request):
    """Owner: update FAQ."""
    user = await require_user(request)
    shop = await _get_user_shop(user)

    faq = await db.bot_faqs.find_one({"faq_id": faq_id, "shop_id": shop["shop_id"]})
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ tidak ditemukan")

    now    = datetime.now(timezone.utc).isoformat()
    update = {"updated_at": now}
    if data.question:  update["question"]  = data.question.strip()
    if data.answer:    update["answer"]    = data.answer.strip()
    if data.category:  update["category"]  = data.category
    if data.is_active is not None: update["is_active"] = data.is_active

    await db.bot_faqs.update_one({"faq_id": faq_id}, {"$set": update})
    return {"ok": True}


@router.delete("/bot/faqs/{faq_id}")
async def bot_delete_faq(faq_id: str, request: Request):
    """Owner: hapus FAQ."""
    user = await require_user(request)
    shop = await _get_user_shop(user)

    result = await db.bot_faqs.delete_one({"faq_id": faq_id, "shop_id": shop["shop_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="FAQ tidak ditemukan")
    return {"ok": True}


# ─────────────────────────────────────────────
# BOT READINESS
# ─────────────────────────────────────────────

@router.get("/bot/readiness")
async def bot_get_readiness(request: Request):
    """Owner: cek readiness score bot toko."""
    user = await require_user(request)
    shop = await _get_user_shop(user)
    readiness = await _calculate_readiness(shop["shop_id"])
    return readiness


# ─────────────────────────────────────────────
# EVENT & CONVERSATION — dikirim dari ai-wa-bot service
# ─────────────────────────────────────────────

@router.post("/bot/events")
async def bot_receive_event(data: BotEventIn, request: Request):
    """
    Terima event dari ai-wa-bot service.
    Contoh: message.answered, handoff.required, bot.error
    """
    bot_token   = request.headers.get("X-Bot-Token", "")
    import os
    valid_token = os.environ.get("BOT_SERVICE_TOKEN", "")
    if valid_token and bot_token != valid_token:
        raise HTTPException(status_code=401, detail="Invalid bot token")

    now = datetime.now(timezone.utc).isoformat()
    await db.bot_events.insert_one({
        "event_id":   f"evt_{uuid.uuid4().hex[:12]}",
        "shop_id":    data.shop_id,
        "event_type": data.event_type,
        "payload":    data.payload or {},
        "created_at": now,
    })

    # Update quota usage jika message answered by bot
    if data.event_type == "message.answered_by_bot":
        await db.bot_settings.update_one(
            {"shop_id": data.shop_id},
            {"$inc": {"quota_used": 1}},
        )

    return {"ok": True}


@router.post("/bot/conversations/summary")
async def bot_receive_conversation_summary(data: BotConversationSummaryIn, request: Request):
    """Terima summary conversation dari ai-wa-bot service untuk ditampilkan di inbox owner."""
    bot_token   = request.headers.get("X-Bot-Token", "")
    import os
    valid_token = os.environ.get("BOT_SERVICE_TOKEN", "")
    if valid_token and bot_token != valid_token:
        raise HTTPException(status_code=401, detail="Invalid bot token")

    now = datetime.now(timezone.utc).isoformat()
    conv_id = f"conv_{uuid.uuid4().hex[:12]}"

    await db.bot_conversations.update_one(
        {"shop_id": data.shop_id, "customer_phone": data.customer_phone},
        {
            "$set": {
                "status":           data.status,
                "last_intent":      data.last_intent,
                "handoff_required": data.handoff_required,
                "message_count":    data.message_count,
                "last_message_at":  data.last_message_at or now,
                "customer_name":    data.customer_name,
                "updated_at":       now,
            },
            "$setOnInsert": {
                "conv_id":        conv_id,
                "shop_id":        data.shop_id,
                "customer_phone": data.customer_phone,
                "created_at":     now,
            }
        },
        upsert=True,
    )
    return {"ok": True}


# ─────────────────────────────────────────────
# INBOX — owner lihat conversation history
# ─────────────────────────────────────────────

@router.get("/bot/inbox")
async def bot_get_inbox(
    request: Request,
    status: str = "all",
    limit: int = 50,
):
    """Owner: lihat inbox conversation bot."""
    user = await require_user(request)
    shop = await _get_user_shop(user)
    shop_id = shop["shop_id"]

    query: dict = {"shop_id": shop_id}
    if status != "all":
        query["status"] = status

    convs = await db.bot_conversations.find(
        query, {"_id": 0}
    ).sort("last_message_at", -1).limit(min(limit, 100)).to_list(100)

    return {
        "conversations": convs,
        "total": len(convs),
        "status_filter": status,
    }


@router.post("/bot/inbox/{conv_id}/resolve")
async def bot_resolve_conversation(conv_id: str, request: Request):
    """Owner: tandai conversation sebagai resolved."""
    user = await require_user(request)
    shop = await _get_user_shop(user)
    now  = datetime.now(timezone.utc).isoformat()

    result = await db.bot_conversations.update_one(
        {"conv_id": conv_id, "shop_id": shop["shop_id"]},
        {"$set": {"status": "resolved", "resolved_at": now, "updated_at": now}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Conversation tidak ditemukan")
    return {"ok": True}


# ─────────────────────────────────────────────
# ADMIN endpoints
# ─────────────────────────────────────────────

@router.get("/admin/bot/overview")
async def admin_bot_overview(request: Request):
    """Admin: overview status bot semua toko."""
    await require_admin(request)
    import asyncio

    bot_enabled, bot_simulator, bot_auto, handoff_pending = await asyncio.gather(
        db.bot_settings.count_documents({"enabled": True}),
        db.bot_settings.count_documents({"mode": "simulator_only"}),
        db.bot_settings.count_documents({"mode": "auto_reply"}),
        db.bot_conversations.count_documents({"handoff_required": True, "status": {"$ne": "resolved"}}),
    )

    # Event stats hari ini
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    events_today = await db.bot_events.count_documents({"created_at": {"$gte": today}})
    answered_today = await db.bot_events.count_documents({
        "event_type": "message.answered_by_bot", "created_at": {"$gte": today}
    })

    return {
        "bot_enabled":     bot_enabled,
        "bot_simulator":   bot_simulator,
        "bot_auto_reply":  bot_auto,
        "handoff_pending": handoff_pending,
        "events_today":    events_today,
        "answered_today":  answered_today,
    }


@router.get("/admin/bot/shops")
async def admin_bot_shops(
    request: Request,
    q: str = "",
    limit: int = 100,
):
    """Admin: list toko beserta status bot-nya."""
    await require_admin(request)
    limit = max(1, min(limit, 300))

    query: dict = {}
    if q:
        query = {"$or": [
            {"name": {"$regex": q, "$options": "i"}},
            {"slug": {"$regex": q, "$options": "i"}},
        ]}

    shops = await db.shops.find(query, {"_id": 0,
        "shop_id": 1, "name": 1, "slug": 1, "whatsapp": 1,
        "owner_user_id": 1, "is_active": 1,
    }).sort("created_at", -1).limit(limit).to_list(limit)

    shop_ids = [s["shop_id"] for s in shops]
    bot_settings_list = await db.bot_settings.find(
        {"shop_id": {"$in": shop_ids}}, {"_id": 0}
    ).to_list(limit)
    settings_map = {s["shop_id"]: s for s in bot_settings_list}

    items = []
    for shop in shops:
        sid = shop["shop_id"]
        s   = settings_map.get(sid, {})
        items.append({
            **shop,
            "bot_enabled":  s.get("enabled", False),
            "bot_mode":     s.get("mode", "off"),
            "bot_quota_used": s.get("quota_used", 0),
            "last_simulated_at": s.get("last_simulated_at"),
        })

    return {"items": items, "total": len(items)}


@router.post("/admin/bot/shops/{shop_id}/enable")
async def admin_bot_enable(shop_id: str, request: Request):
    """Admin: paksa enable bot untuk toko tertentu."""
    admin = await require_admin(request)
    now   = datetime.now(timezone.utc).isoformat()

    await db.bot_settings.update_one(
        {"shop_id": shop_id},
        {"$set": {"enabled": True, "updated_at": now},
         "$setOnInsert": {"shop_id": shop_id, "mode": "simulator_only",
                          "tone": "ramah", "quota_monthly": 100,
                          "quota_used": 0, "created_at": now}},
        upsert=True,
    )
    await log_admin_action(admin, "ai_bot.enable", "shop", shop_id)
    return {"ok": True}


@router.post("/admin/bot/shops/{shop_id}/disable")
async def admin_bot_disable(shop_id: str, request: Request):
    """Admin: paksa disable bot."""
    admin = await require_admin(request)
    now   = datetime.now(timezone.utc).isoformat()

    await db.bot_settings.update_one(
        {"shop_id": shop_id},
        {"$set": {"enabled": False, "mode": "off", "updated_at": now}},
    )
    await log_admin_action(admin, "ai_bot.disable", "shop", shop_id)
    return {"ok": True}


# ─────────────────────────────────────────────
# CONNECT TOKEN — untuk redirect ke ai-wa-bot
# ─────────────────────────────────────────────

@router.post("/bot/connect-token")
async def generate_connect_token(request: Request):
    """
    Generate short-lived token untuk connect akun Lapakin ke AI WA Bot.
    Token valid 10 menit.
    Owner klik tombol di dashboard → hit endpoint ini → redirect ke bot.dev
    """
    import hashlib, hmac, base64
    
    user = await require_user(request)
    shop = await _get_user_shop(user)
    shop_id = shop["shop_id"]
    now = datetime.now(timezone.utc)
    
    # Build payload
    payload = {
        "user_id":    user["user_id"],
        "email":      user["email"],
        "name":       user["name"],
        "shop_id":    shop_id,
        "shop_name":  shop.get("name", ""),
        "whatsapp":   shop.get("whatsapp", ""),
        "exp":        int((now + timedelta(minutes=10)).timestamp()),
        "iat":        int(now.timestamp()),
    }
    
    # Encode payload
    import json as _json
    payload_str = _json.dumps(payload, separators=(",", ":"))
    payload_b64 = base64.urlsafe_b64encode(payload_str.encode()).decode().rstrip("=")
    
    # Sign dengan BOT_SERVICE_TOKEN sebagai secret
    import os
    secret = os.environ.get("BOT_SERVICE_TOKEN", "fallback-secret")
    sig = hmac.new(
        secret.encode(),
        payload_b64.encode(),
        hashlib.sha256
    ).hexdigest()[:16]
    
    token = f"{payload_b64}.{sig}"
    
    # Simpan token ke DB untuk validasi nanti
    await db.bot_connect_tokens.insert_one({
        "token":   token,
        "user_id": user["user_id"],
        "shop_id": shop_id,
        "payload": payload,
        "used":    False,
        "expires_at": payload["exp"],
        "created_at": now.isoformat(),
    })
    
    # URL redirect ke ai-wa-bot
    bot_url = os.environ.get("BOT_DASHBOARD_URL", "https://bot.dev.lapakin.my.id")
    redirect_url = f"{bot_url}/connect?token={token}"
    
    return {
        "ok":           True,
        "token":        token,
        "redirect_url": redirect_url,
        "expires_in":   600,  # 10 menit
    }


@router.get("/bot/connect-token/validate/{token}")
async def validate_connect_token(token: str, request: Request):
    """
    Validate token dari ai-wa-bot service.
    Dipanggil oleh ai-wa-bot saat user redirect ke /connect
    """
    import os
    bot_token_header = request.headers.get("X-Bot-Token", "")
    valid_token = os.environ.get("BOT_SERVICE_TOKEN", "")
    
    if valid_token and bot_token_header != valid_token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    now = int(datetime.now(timezone.utc).timestamp())
    
    # Cari token di DB
    rec = await db.bot_connect_tokens.find_one({"token": token}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Token tidak ditemukan")
    if rec.get("used"):
        raise HTTPException(status_code=400, detail="Token sudah dipakai")
    if rec.get("expires_at", 0) < now:
        raise HTTPException(status_code=400, detail="Token sudah expired")
    
    # Mark as used
    await db.bot_connect_tokens.update_one(
        {"token": token},
        {"$set": {"used": True, "used_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {
        "ok":      True,
        "payload": rec["payload"],
    }


# ─────────────────────────────────────────────
# QUICK ACCESS — untuk user yang sudah connect
# ─────────────────────────────────────────────

@router.get("/bot/access-url")
async def get_bot_access_url(request: Request):
    """
    Return URL untuk akses AI WA Bot dashboard.
    Kalau sudah connect → generate login token langsung.
    Kalau belum → generate connect token (first time flow).
    """
    import os, base64, hashlib, hmac, json as _json

    user  = await require_user(request)
    shop  = await _get_user_shop(user)
    now   = datetime.now(timezone.utc)
    bot_url = os.environ.get("BOT_DASHBOARD_URL", "https://bot.dev.lapakin.my.id")
    secret  = os.environ.get("BOT_SERVICE_TOKEN", "fallback-secret")

    payload = {
        "user_id":   user["user_id"],
        "email":     user["email"],
        "name":      user["name"],
        "shop_id":   shop["shop_id"],
        "shop_name": shop.get("name", ""),
        "whatsapp":  shop.get("whatsapp", ""),
        "exp":       int((now + timedelta(minutes=10)).timestamp()),
        "iat":       int(now.timestamp()),
    }

    payload_str = _json.dumps(payload, separators=(",", ":"))
    payload_b64 = base64.urlsafe_b64encode(payload_str.encode()).decode().rstrip("=")
    sig   = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()[:16]
    token = f"{payload_b64}.{sig}"

    await db.bot_connect_tokens.insert_one({
        "token":      token,
        "user_id":    user["user_id"],
        "shop_id":    shop["shop_id"],
        "payload":    payload,
        "used":       False,
        "expires_at": payload["exp"],
        "created_at": now.isoformat(),
    })

    return {
        "ok":          True,
        "redirect_url": f"{bot_url}/connect?token={token}",
    }
