from typing import Optional
import re
import json
"""Shops routes: CRUD, public fetch, toggle-open, custom domain."""
import os
import re as _re
import uuid
from datetime import datetime, timezone, timedelta
from urllib.parse import quote_plus

from fastapi import APIRouter, HTTPException, Request

from deps import db, require_user, slugify, logger
from models import ShopIn, CustomDomainIn
from tiers import get_limits, get_tier, is_unlimited, require_feature
from schedule_utils import compute_schedule_status
from og_render import OG_PNG_CACHE
from pydantic import BaseModel

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


def normalize_storefront_testimonials(value):
    if not isinstance(value, list):
        return []

    items = []
    for raw in value[:3]:
        if not isinstance(raw, dict):
            continue

        name = str(raw.get("name") or raw.get("customer_name") or "").strip()[:80]
        text = str(raw.get("text") or raw.get("comment") or raw.get("message") or "").strip()[:280]

        try:
            rating = int(raw.get("rating") or 5)
        except Exception:
            rating = 5

        rating = max(1, min(5, rating))

        if name or text:
            items.append({
                "name": name,
                "text": text,
                "rating": rating,
            })

    return items


ALLOWED_STOREFRONT_MODES = {"catalog", "food_menu", "services"}
ALLOWED_STOREFRONT_STYLES = {"classic", "modern", "compact", "premium", "playful"}
ALLOWED_STOREFRONT_RENDERERS = {"legacy", "template"}
ALLOWED_WEBSITE_MODES = {"lapakin_template", "external_custom"}
ALLOWED_EXTERNAL_WEBSITE_BEHAVIORS = {"handoff", "redirect"}
# LAPAKIN_STOREFRONT_LAYOUT_VARIANT_V1
ALLOWED_STOREFRONT_LAYOUT_VARIANTS = {
    "",
    "food_warm_menu",
    "laundry_clean_service",
    "fashion_visual_catalog",
    "service_trust_cta",
    "craft_story_catalog",
}

def _clean_external_website_url(value):
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) > 300:
        raw = raw[:300]
    if not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    if raw.startswith("http://") and not raw.startswith("http://localhost") and not raw.startswith("http://127.0.0.1"):
        raw = "https://" + raw[len("http://"):]
    return raw


def _with_storefront_defaults(shop):
    if not shop:
        return shop
    shop.setdefault("storefront_mode", "catalog")
    shop.setdefault("storefront_style", "classic")
    shop.setdefault("storefront_featured_product_ids", [])
    shop.setdefault("storefront_show_promo", False)
    shop.setdefault("storefront_promo_title", "")
    shop.setdefault("storefront_promo_text", "")
    shop.setdefault("storefront_promo_cta_label", "")
    shop.setdefault("storefront_promo_slug", "")
    shop.setdefault("storefront_show_payment_instruction", False)
    shop.setdefault("storefront_payment_method_label", "")
    shop.setdefault("storefront_payment_instruction", "")
    shop.setdefault("storefront_qris_image", "")
    shop.setdefault("storefront_seo_title", "")
    shop.setdefault("storefront_seo_description", "")
    shop.setdefault("storefront_seo_image", "")
    shop.setdefault("storefront_payment_confirmation_text", "")
    shop.setdefault("storefront_whatsapp_checkout_template", "Halo {shop_name}, saya mau pesan:\n\n{items}\n\nTotal: {total}\nNama: {customer_name}\nCatatan: {notes}\n{payment_instruction}")
    shop.setdefault("storefront_whatsapp_product_template", "Halo {shop_name}, saya mau tanya produk:\n\n{product_name}\nHarga: {product_price}\n\nApakah masih tersedia?")
    shop.setdefault("storefront_show_location_map", False)
    shop.setdefault("storefront_location_title", "")
    shop.setdefault("storefront_location_address", "")
    shop.setdefault("storefront_google_maps_url", "")
    shop.setdefault("storefront_location_embed_url", "")
    shop.setdefault("storefront_renderer", "legacy")
    shop.setdefault("website_mode", "lapakin_template")
    shop.setdefault("external_website_url", "")
    shop.setdefault("external_website_label", "")
    shop.setdefault("external_website_behavior", "handoff")
    # LAPAKIN_STOREFRONT_LAYOUT_VARIANT_V1
    shop.setdefault("storefront_layout_variant", "")

    # LAPAKIN_SHOP_SETTINGS_CONTRACT_V1
    # Defaults + legacy alias sync for Pengaturan Toko.
    shop.setdefault("order_whatsapp_enabled", True)
    shop.setdefault("pickup_available", False)
    shop.setdefault("delivery_available", False)
    shop.setdefault("has_offline_store", bool(shop.get("show_location", False)))
    shop.setdefault("show_location", bool(shop.get("has_offline_store", False)))

    whatsapp = str(shop.get("whatsapp") or shop.get("whatsapp_number") or "").strip()
    shop["whatsapp"] = whatsapp
    shop["whatsapp_number"] = whatsapp

    payment_instruction = str(
        shop.get("payment_instruction")
        or shop.get("storefront_payment_instruction")
        or shop.get("payment_notes")
        or ""
    ).strip()
    shop["payment_instruction"] = payment_instruction
    shop["storefront_payment_instruction"] = payment_instruction
    shop["payment_notes"] = payment_instruction

    store_address = str(
        shop.get("store_address")
        or shop.get("address")
        or shop.get("location_address")
        or shop.get("storefront_location_address")
        or ""
    ).strip()
    shop["store_address"] = store_address
    shop["address"] = store_address
    shop["location_address"] = store_address
    shop["storefront_location_address"] = store_address

    google_maps_url = str(
        shop.get("google_maps_url")
        or shop.get("google_maps_link")
        or shop.get("storefront_google_maps_url")
        or ""
    ).strip()
    shop["google_maps_url"] = google_maps_url
    shop["google_maps_link"] = google_maps_url
    shop["storefront_google_maps_url"] = google_maps_url

    shop.setdefault("service_area", "")
    return shop


def _normalize_shop_settings_payload(payload):
    """Normalize dashboard Pengaturan Toko fields before saving.

    Keeps canonical dashboard fields and legacy/storefront aliases in sync so
    no frontend field disappears after save/reload.
    """
    if not isinstance(payload, dict):
        return payload

    if "website_mode" in payload:
        mode = str(payload.get("website_mode") or "lapakin_template").strip().lower()
        if mode not in ALLOWED_WEBSITE_MODES:
            raise HTTPException(status_code=400, detail="Mode website tidak valid")
        payload["website_mode"] = mode

    if "external_website_url" in payload:
        payload["external_website_url"] = _clean_external_website_url(payload.get("external_website_url"))

    if "external_website_label" in payload:
        payload["external_website_label"] = str(payload.get("external_website_label") or "Website Custom").strip()[:80]

    if "external_website_behavior" in payload:
        behavior = str(payload.get("external_website_behavior") or "handoff").strip().lower()
        if behavior not in ALLOWED_EXTERNAL_WEBSITE_BEHAVIORS:
            raise HTTPException(status_code=400, detail="Behavior website custom tidak valid")
        payload["external_website_behavior"] = behavior

    if "whatsapp" in payload or "whatsapp_number" in payload:
        whatsapp = str(payload.get("whatsapp") or payload.get("whatsapp_number") or "").strip()[:40]
        payload["whatsapp"] = whatsapp
        payload["whatsapp_number"] = whatsapp

    for field in ["order_whatsapp_enabled", "pickup_available", "delivery_available"]:
        if field in payload:
            payload[field] = bool(payload.get(field))

    if "has_offline_store" in payload or "show_location" in payload:
        has_offline_store = bool(payload.get("has_offline_store") or payload.get("show_location"))
        payload["has_offline_store"] = has_offline_store
        payload["show_location"] = has_offline_store

    if (
        "payment_instruction" in payload
        or "storefront_payment_instruction" in payload
        or "payment_notes" in payload
    ):
        payment_instruction = _clean_storefront_payment_text(
            payload.get("payment_instruction")
            or payload.get("storefront_payment_instruction")
            or payload.get("payment_notes")
            or "",
            500,
        )
        payload["payment_instruction"] = payment_instruction
        payload["storefront_payment_instruction"] = payment_instruction
        payload["payment_notes"] = payment_instruction

    if (
        "store_address" in payload
        or "address" in payload
        or "location_address" in payload
        or "storefront_location_address" in payload
    ):
        store_address = _clean_storefront_location_text(
            payload.get("store_address")
            or payload.get("address")
            or payload.get("location_address")
            or payload.get("storefront_location_address")
            or "",
            300,
        )
        payload["store_address"] = store_address
        payload["address"] = store_address
        payload["location_address"] = store_address
        payload["storefront_location_address"] = store_address

    if (
        "google_maps_url" in payload
        or "google_maps_link" in payload
        or "storefront_google_maps_url" in payload
    ):
        google_maps_url = _clean_google_maps_url(
            payload.get("google_maps_url")
            or payload.get("google_maps_link")
            or payload.get("storefront_google_maps_url")
            or ""
        )
        payload["google_maps_url"] = google_maps_url
        payload["google_maps_link"] = google_maps_url
        payload["storefront_google_maps_url"] = google_maps_url

    if "service_area" in payload:
        payload["service_area"] = _clean_storefront_location_text(payload.get("service_area"), 120)

    return payload






async def _unique_shop_slug(name: str) -> str:
    base_slug = slugify(name)
    slug = base_slug
    n = 1
    while await db.shops.find_one({"slug": slug}):
        n += 1
        slug = f"{base_slug}-{n}"
    return slug


def _is_staff(user: dict) -> bool:
    return user.get("shop_role") == "staff"


PHASE_E_NON_MANAGEABLE_SHOP_STATUSES = {
    "tier_suspended",
    "deleted",
    "admin_deleted",
    "admin_suspended",
    "banned",
    "disabled",
    "inactive",
    "suspended",
}


def _phase_e_manageable_shop_count_query(user_id: str) -> dict:
    return {
        "owner_user_id": user_id,
        "status": {"$nin": list(PHASE_E_NON_MANAGEABLE_SHOP_STATUSES)},
        "tier_suspended": {"$ne": True},
        "deleted": {"$ne": True},
        "is_deleted": {"$ne": True},
        "admin_deleted": {"$ne": True},
        "deleted_at": {"$in": [None, ""]},
    }


async def _owner_shop_limit(user: dict) -> dict:
    user_id = (user or {}).get("user_id")
    tier = get_tier(user)
    limit = get_limits(tier).get("max_shops_per_user", 1)
    effective_status = (user or {}).get("subscription_status") or ""

    # Reuse downgrade tier logic when Phase A/D helper exists.
    # Important: subscription_status=suspended / expired must behave as limit 1
    # even when user.tier still says pro/business.
    try:
        if "_downgrade_effective_tier" in globals():
            effective_tier = await _downgrade_effective_tier(user)
            if effective_tier:
                tier = effective_tier.get("plan") or tier
                effective_status = effective_tier.get("status") or effective_status
                limit = effective_tier.get("shop_limit", limit)
    except Exception as exc:
        try:
            logger.warning(f"phase_e_owner_shop_limit_effective_tier_failed: {exc}")
        except Exception:
            pass

    used = 0
    if user_id:
        used = await db.shops.count_documents(_phase_e_manageable_shop_count_query(user_id))

    unlimited = is_unlimited(limit)
    numeric_limit = None

    if not unlimited:
        try:
            numeric_limit = int(limit)
        except Exception:
            numeric_limit = 1

    return {
        "tier": tier,
        "status": effective_status,
        "limit_raw": limit,
        "limit": "unlimited" if unlimited else numeric_limit,
        "used": used,
        "remaining": "unlimited" if unlimited else max(0, numeric_limit - used),
        "can_create": unlimited or used < numeric_limit,
    }


async def _enforce_owner_shop_create_limit(user: dict):
    limit_state = await _owner_shop_limit(user)

    if limit_state.get("can_create"):
        return limit_state

    limit_display = limit_state.get("limit")
    used_display = limit_state.get("used", 0)
    tier_display = limit_state.get("tier") or "free"

    raise HTTPException(
        status_code=402,
        detail=(
            f"SHOP_LIMIT_REACHED: Batas toko paket {tier_display} sudah penuh "
            f"({used_display}/{limit_display}). Upgrade untuk tambah toko."
        ),
        headers={"X-Lapakin-Error-Code": "SHOP_LIMIT_REACHED"},
    )

class StorefrontCopyAIIn(BaseModel):
    shop_name: str = ""
    shop_description: str = ""
    business_category: str = ""
    instagram: str = ""
    tiktok: str = ""
    storefront_mode: str = "catalog"
    storefront_style: str = "classic"
    current: dict = {}


def _clean_storefront_copy_value(value, max_len=220):
    if value is None:
        return ""
    value = str(value).strip()
    value = " ".join(value.split())
    return value[:max_len]


def _fallback_storefront_copy(data: StorefrontCopyAIIn):
    shop_name = _clean_storefront_copy_value(data.shop_name, 80) or "Toko Kamu"
    mode = data.storefront_mode or "catalog"
    style = data.storefront_style or "classic"
    description = _clean_storefront_copy_value(data.shop_description, 160)

    if mode == "food_menu":
        hero_title = f"Menu favorit {shop_name}, siap menemani harimu"
        hero_subtitle = description or "Pilih menu favorit, cek harga, lalu pesan langsung lewat WhatsApp."
        cta_label = "Pesan Menu Sekarang"
        featured_title = "Menu Favorit Hari Ini"
        about_title = f"Cerita rasa dari {shop_name}"
    elif mode == "services":
        hero_title = f"Layanan terpercaya dari {shop_name}"
        hero_subtitle = description or "Lihat pilihan layanan, konsultasikan kebutuhanmu, lalu hubungi kami lewat WhatsApp."
        cta_label = "Konsultasi Sekarang"
        featured_title = "Layanan Unggulan"
        about_title = f"Kenal lebih dekat dengan {shop_name}"
    else:
        hero_title = f"Pilihan terbaik dari {shop_name}"
        hero_subtitle = description or "Lihat produk pilihan, cek detail dan harga, lalu order langsung lewat WhatsApp."
        cta_label = "Chat & Order Sekarang"
        featured_title = "Produk Favorit"
        about_title = f"Cerita di balik {shop_name}"

    if style == "premium":
        hero_title = hero_title.replace("Pilihan terbaik", "Koleksi pilihan")
        cta_label = "Konsultasi & Order"
    elif style == "playful":
        if mode == "food_menu":
            hero_title = f"Menu enak dari {shop_name}, siap bikin harimu lebih seru"
        elif mode == "catalog":
            hero_title = f"Temukan produk favoritmu di {shop_name}"
    elif style == "compact":
        hero_subtitle = hero_subtitle[:140]

    return {
        "storefront_hero_title": _clean_storefront_copy_value(hero_title, 90),
        "storefront_hero_subtitle": _clean_storefront_copy_value(hero_subtitle, 220),
        "storefront_cta_label": _clean_storefront_copy_value(cta_label, 36),
        "storefront_featured_title": _clean_storefront_copy_value(featured_title, 60),
        "storefront_about_title": _clean_storefront_copy_value(about_title, 80),
    }


async def _generate_storefront_copy_with_ai(data: StorefrontCopyAIIn):
    fallback = _fallback_storefront_copy(data)
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()

    if not api_key:
        return fallback, "fallback"

    system_prompt = (
        "Kamu adalah copywriter UX untuk Lapakin, platform storefront UMKM Indonesia. "
        "Tulis copy pendek, jelas, natural, dan siap dipakai di website toko. "
        "Bahasa Indonesia. Jangan pakai tanda kutip. Jangan terlalu bombastis. "
        "Output wajib JSON valid dengan key: storefront_hero_title, storefront_hero_subtitle, "
        "storefront_cta_label, storefront_featured_title, storefront_about_title."
    )

    user_prompt = {
        "shop_name": data.shop_name,
        "shop_description": data.shop_description,
        "business_category": data.business_category,
        "instagram": data.instagram,
        "tiktok": data.tiktok,
        "storefront_mode": data.storefront_mode,
        "storefront_style": data.storefront_style,
        # LAPAKIN_BACKEND_VARIANT_PAYLOADS_V1
        "storefront_layout_variant": data.storefront_layout_variant or "",
        "current": data.current or {},
        "rules": {
            "storefront_hero_title": "maksimal 90 karakter",
            "storefront_hero_subtitle": "maksimal 220 karakter",
            "storefront_cta_label": "maksimal 36 karakter",
            "storefront_featured_title": "maksimal 60 karakter",
            "storefront_about_title": "maksimal 80 karakter",
        },
    }

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
            ],
            response_format={"type": "json_object"},
            temperature=0.75,
            max_tokens=500,
        )

        raw = response.choices[0].message.content or "{}"
        parsed = json.loads(raw)

        copy = {
            "storefront_hero_title": _clean_storefront_copy_value(
                parsed.get("storefront_hero_title") or fallback["storefront_hero_title"],
                90,
            ),
            "storefront_hero_subtitle": _clean_storefront_copy_value(
                parsed.get("storefront_hero_subtitle") or fallback["storefront_hero_subtitle"],
                220,
            ),
            "storefront_cta_label": _clean_storefront_copy_value(
                parsed.get("storefront_cta_label") or fallback["storefront_cta_label"],
                36,
            ),
            "storefront_featured_title": _clean_storefront_copy_value(
                parsed.get("storefront_featured_title") or fallback["storefront_featured_title"],
                60,
            ),
            "storefront_about_title": _clean_storefront_copy_value(
                parsed.get("storefront_about_title") or fallback["storefront_about_title"],
                80,
            ),
        }

        return copy, "ai"
    except Exception:
        return fallback, "fallback"



class StorefrontCopyAIIn(BaseModel):
    shop_name: str = ""
    shop_description: str = ""
    business_category: str = ""
    instagram: str = ""
    tiktok: str = ""
    storefront_mode: str = "catalog"
    storefront_style: str = "classic"
    current: dict = {}


def _clean_storefront_copy_value(value, max_len=220):
    if value is None:
        return ""
    value = str(value).strip()
    value = " ".join(value.split())
    return value[:max_len]


def _fallback_storefront_copy(data: StorefrontCopyAIIn):
    shop_name = _clean_storefront_copy_value(data.shop_name, 80) or "Toko Kamu"
    mode = data.storefront_mode or "catalog"
    style = data.storefront_style or "classic"
    description = _clean_storefront_copy_value(data.shop_description, 160)

    if mode == "food_menu":
        hero_title = f"Menu favorit {shop_name}, siap menemani harimu"
        hero_subtitle = description or "Pilih menu favorit, cek harga, lalu pesan langsung lewat WhatsApp."
        cta_label = "Pesan Menu Sekarang"
        featured_title = "Menu Favorit Hari Ini"
        about_title = f"Cerita rasa dari {shop_name}"
    elif mode == "services":
        hero_title = f"Layanan terpercaya dari {shop_name}"
        hero_subtitle = description or "Lihat pilihan layanan, konsultasikan kebutuhanmu, lalu hubungi kami lewat WhatsApp."
        cta_label = "Konsultasi Sekarang"
        featured_title = "Layanan Unggulan"
        about_title = f"Kenal lebih dekat dengan {shop_name}"
    else:
        hero_title = f"Pilihan terbaik dari {shop_name}"
        hero_subtitle = description or "Lihat produk pilihan, cek detail dan harga, lalu order langsung lewat WhatsApp."
        cta_label = "Chat & Order Sekarang"
        featured_title = "Produk Favorit"
        about_title = f"Cerita di balik {shop_name}"

    if style == "premium":
        hero_title = hero_title.replace("Pilihan terbaik", "Koleksi pilihan")
        cta_label = "Konsultasi & Order"
    elif style == "playful":
        if mode == "food_menu":
            hero_title = f"Menu enak dari {shop_name}, siap bikin harimu lebih seru"
        elif mode == "catalog":
            hero_title = f"Temukan produk favoritmu di {shop_name}"
    elif style == "compact":
        hero_subtitle = hero_subtitle[:140]

    return {
        "storefront_hero_title": _clean_storefront_copy_value(hero_title, 90),
        "storefront_hero_subtitle": _clean_storefront_copy_value(hero_subtitle, 220),
        "storefront_cta_label": _clean_storefront_copy_value(cta_label, 36),
        "storefront_featured_title": _clean_storefront_copy_value(featured_title, 60),
        "storefront_about_title": _clean_storefront_copy_value(about_title, 80),
    }


async def _generate_storefront_copy_with_ai(data: StorefrontCopyAIIn):
    fallback = _fallback_storefront_copy(data)
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()

    if not api_key:
        return fallback, "fallback"

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)

        system_prompt = (
            "Kamu adalah copywriter UX untuk Lapakin, platform storefront UMKM Indonesia. "
            "Tulis copy pendek, jelas, natural, dan siap dipakai di website toko. "
            "Bahasa Indonesia. Jangan pakai tanda kutip. Jangan terlalu bombastis. "
            "Output wajib JSON valid dengan key: storefront_hero_title, storefront_hero_subtitle, "
            "storefront_cta_label, storefront_featured_title, storefront_about_title."
        )

        user_prompt = {
            "shop_name": data.shop_name,
            "shop_description": data.shop_description,
            "business_category": data.business_category,
            "instagram": data.instagram,
            "tiktok": data.tiktok,
            "storefront_mode": data.storefront_mode,
            "storefront_style": data.storefront_style,
            # LAPAKIN_BACKEND_VARIANT_PAYLOADS_V1
            "storefront_layout_variant": data.storefront_layout_variant or "",
            "current": data.current or {},
            "rules": {
                "storefront_hero_title": "maksimal 90 karakter",
                "storefront_hero_subtitle": "maksimal 220 karakter",
                "storefront_cta_label": "maksimal 36 karakter",
                "storefront_featured_title": "maksimal 60 karakter",
                "storefront_about_title": "maksimal 80 karakter",
            },
        }

        response = client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
            ],
            response_format={"type": "json_object"},
            temperature=0.75,
            max_tokens=500,
        )

        raw = response.choices[0].message.content or "{}"
        parsed = json.loads(raw)

        copy = {
            "storefront_hero_title": _clean_storefront_copy_value(parsed.get("storefront_hero_title") or fallback["storefront_hero_title"], 90),
            "storefront_hero_subtitle": _clean_storefront_copy_value(parsed.get("storefront_hero_subtitle") or fallback["storefront_hero_subtitle"], 220),
            "storefront_cta_label": _clean_storefront_copy_value(parsed.get("storefront_cta_label") or fallback["storefront_cta_label"], 36),
            "storefront_featured_title": _clean_storefront_copy_value(parsed.get("storefront_featured_title") or fallback["storefront_featured_title"], 60),
            "storefront_about_title": _clean_storefront_copy_value(parsed.get("storefront_about_title") or fallback["storefront_about_title"], 80),
        }

        return copy, "ai"
    except Exception:
        return fallback, "fallback"



def _normalize_storefront_tier(user):
    if not user:
        return "free"

    tier = (
        user.get("tier")
        or user.get("plan")
        or user.get("subscription_tier")
        or user.get("account_tier")
        or "free"
    )

    tier = str(tier or "free").lower()
    if tier not in {"free", "starter", "pro", "business"}:
        return "free"

    return tier


def _storefront_features_for_tier(tier):
    tier = str(tier or "free").lower()

    if tier == "business":
        return {
            "templates": True,
            "styles": {"classic", "modern", "compact", "premium", "playful"},
            "editor": True,
            "ai": True,
            "advanced": True,
        }

    if tier == "pro":
        return {
            "templates": True,
            "styles": {"classic", "modern", "compact", "premium", "playful"},
            "editor": True,
            "ai": True,
            "advanced": False,
        }

    if tier == "starter":
        return {
            "templates": True,
            "styles": {"classic", "modern", "compact"},
            "editor": True,
            "ai": False,
            "advanced": False,
        }

    return {
        "templates": False,
        "styles": {"classic"},
        "editor": False,
        "ai": False,
        "advanced": False,
    }




def _sanitize_storefront_featured_product_ids(payload, features):
    if not payload:
        return payload

    field = "storefront_featured_product_ids"

    if field not in payload:
        return payload

    if not features.get("templates"):
        payload.pop(field, None)
        return payload

    raw_ids = payload.get(field)

    if raw_ids in (None, ""):
        payload[field] = []
        return payload

    if not isinstance(raw_ids, list):
        raise HTTPException(status_code=400, detail="Produk unggulan template tidak valid")

    max_items = int(features.get("featured_limit", 0) or 0)

    cleaned = []
    seen = set()

    for item in raw_ids:
        value = str(item or "").strip()
        if not value or value in seen:
            continue

        seen.add(value)
        cleaned.append(value)

    if max_items <= 0 and cleaned:
        raise HTTPException(status_code=403, detail="Produk unggulan template tersedia mulai paket Starter")

    if max_items > 0 and len(cleaned) > max_items:
        cleaned = cleaned[:max_items]

    payload[field] = cleaned
    return payload




def _clean_storefront_promo_text(value, max_len=180, *extra_args):
    if value is None:
        return ""
    value = str(value).strip()
    value = " ".join(value.split())
    return value[:max_len]




def _clean_storefront_promo_slug(value, max_len=48, *extra_args):
    if value is None:
        return ""

    value = str(value).strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")

    return value[:max_len]


def _sanitize_storefront_promo_payload(payload, features):
    if not payload:
        return payload

    promo_fields = [
        "storefront_show_promo",
        "storefront_show_testimonials",
        "storefront_testimonials",
        "storefront_promo_title",
        "storefront_promo_text",
        "storefront_promo_cta_label",
        "storefront_promo_slug",
    ]

    if not features.get("templates") or not features.get("promo"):
        for field in promo_fields:
            payload.pop(field, None)
        return payload

    if "storefront_show_promo" in payload:
        payload["storefront_show_promo"] = bool(payload.get("storefront_show_promo"))

    if "storefront_promo_title" in payload:
        payload["storefront_promo_title"] = _clean_storefront_promo_text(
            payload.get("storefront_promo_title"),
            80,
        )

    if "storefront_promo_text" in payload:
        payload["storefront_promo_text"] = _clean_storefront_promo_text(
            payload.get("storefront_promo_text"),
            180,
        )

    if "storefront_promo_cta_label" in payload:
        payload["storefront_promo_cta_label"] = _clean_storefront_promo_text(
            payload.get("storefront_promo_cta_label"),
            36,
        )

    if "storefront_promo_slug" in payload:
        payload["storefront_promo_slug"] = _clean_storefront_promo_slug(
            payload.get("storefront_promo_slug"),
            48,
        )

    return payload




def _clean_storefront_payment_text(value, max_len=500, *extra_args):
    """Clean storefront payment text.

    Defensive signature: older patch attempts may accidentally pass extra
    positional args into this helper. Ignore non-integer extras and use the
    first integer as max length when present.
    """
    for arg in (max_len, *extra_args):
        if isinstance(arg, int):
            max_len = arg
            break
    else:
        max_len = 500

    try:
        text = str(value or "").strip()
    except Exception:
        text = ""

    if max_len <= 0:
        max_len = 500

    return text[:max_len]




def _clean_storefront_seo_text(value, max_len=180):
    text = str(value or "").strip()
    text = " ".join(text.split())
    return text[:max_len]


def _clean_storefront_qris_image(value, *extra_args):
    if value is None:
        return ""
    value = str(value).strip()
    if not value:
        return ""
    # Allow either base64 data URL uploaded from dashboard or an existing https image URL.
    if value.startswith("data:image/"):
        # Keep payload bounded; QRIS image should be compressed client-side before upload.
        return value[:1200000]
    if value.startswith("https://") or value.startswith("http://"):
        return value[:1000]
    return ""



def _clean_storefront_whatsapp_template_text(value, max_len=1200):
    try:
        text = str(value or "").strip()
    except Exception:
        text = ""

    if max_len <= 0:
        max_len = 1200

    return text[:max_len]


def _sanitize_storefront_whatsapp_template_payload(payload, templates_enabled=True):
    if not payload:
        return payload

    fields = [
        "storefront_whatsapp_checkout_template",
        "storefront_whatsapp_product_template",
    ]

    if not templates_enabled:
        for field in fields:
            payload.pop(field, None)
        return payload

    if "storefront_whatsapp_checkout_template" in payload:
        payload["storefront_whatsapp_checkout_template"] = _clean_storefront_whatsapp_template_text(
            payload.get("storefront_whatsapp_checkout_template"),
            1200,
        )

    if "storefront_whatsapp_product_template" in payload:
        payload["storefront_whatsapp_product_template"] = _clean_storefront_whatsapp_template_text(
            payload.get("storefront_whatsapp_product_template"),
            800,
        )

    return payload

def _sanitize_storefront_payment_payload(payload, templates_enabled=True):
    if not payload:
        return payload

    payment_fields = [
        "storefront_show_payment_instruction",
        "storefront_show_testimonials",
        "storefront_testimonials",
        "storefront_payment_method_label",
        "storefront_payment_instruction",
        "payment_instruction",
        "payment_notes",
        "storefront_qris_image",
        "storefront_payment_confirmation_text",
    ]

    if not templates_enabled:
        for field in payment_fields:
            payload.pop(field, None)
        return payload

    if "storefront_show_payment_instruction" in payload:
        payload["storefront_show_payment_instruction"] = bool(payload.get("storefront_show_payment_instruction"))

    if "storefront_payment_method_label" in payload:
        payload["storefront_payment_method_label"] = _clean_storefront_payment_text(
            payload.get("storefront_payment_method_label"),
            80,
        )

    if "storefront_payment_instruction" in payload:
        payload["storefront_payment_instruction"] = _clean_storefront_payment_text(
            payload.get("storefront_payment_instruction"),
            500,
        )

    if "storefront_payment_confirmation_text" in payload:
        payload["storefront_payment_confirmation_text"] = _clean_storefront_payment_text(
            payload.get("storefront_payment_confirmation_text"),
            160,
        )


    if "storefront_seo_title" in payload:
        payload["storefront_seo_title"] = _clean_storefront_seo_text(
            payload.get("storefront_seo_title"),
            70,
        )
    if "storefront_seo_description" in payload:
        payload["storefront_seo_description"] = _clean_storefront_seo_text(
            payload.get("storefront_seo_description"),
            160,
        )
    if "storefront_seo_image" in payload:
        payload["storefront_seo_image"] = _clean_storefront_qris_image(
            payload.get("storefront_seo_image"),
        )

    if "storefront_qris_image" in payload:
        payload["storefront_qris_image"] = _clean_storefront_qris_image(
            payload.get("storefront_qris_image"),
        )

    return payload




def _clean_storefront_location_text(value, max_len=300, *extra_args):
    if value is None:
        return ""
    value = str(value).strip()
    value = " ".join(value.split())
    return value[:max_len]


def _is_allowed_google_maps_url(value):
    if not value:
        return False
    value = str(value).strip()
    if not (value.startswith("https://") or value.startswith("http://")):
        return False
    lowered = value.lower()
    return (
        "google.com/maps" in lowered
        or "maps.google." in lowered
        or "maps.app.goo.gl" in lowered
        or "goo.gl/maps" in lowered
    )


def _clean_google_maps_url(value, max_len=1000, *extra_args):
    if value is None:
        return ""
    value = str(value).strip()
    if not value:
        return ""
    if not _is_allowed_google_maps_url(value):
        return ""
    return value[:max_len]


def _clean_google_maps_embed_url(value, max_len=1000, *extra_args):
    if value is None:
        return ""
    value = str(value).strip()
    if not value:
        return ""
    lowered = value.lower()
    allowed = (
        value.startswith("https://www.google.com/maps/embed")
        or value.startswith("https://maps.google.com/maps")
        or value.startswith("http://maps.google.com/maps")
        or "google.com/maps/embed" in lowered
    )
    if not allowed:
        return ""
    return value[:max_len]


def _make_google_maps_search_embed_url(address, *extra_args):
    """Build Google Maps embed URL from address.

    Defensive signature: some older sanitizer patches may pass extra args.
    Ignore extras and use only the first argument as address.
    """
    address = _clean_storefront_location_text(address, 300)
    if not address:
        return ""
    return "https://maps.google.com/maps?q=" + quote_plus(address) + "&output=embed"


def _sanitize_storefront_location_payload(payload):
    if not payload:
        return payload

    if "storefront_show_location_map" in payload:
        payload["storefront_show_location_map"] = bool(payload.get("storefront_show_location_map"))

    if "storefront_location_title" in payload:
        payload["storefront_location_title"] = _clean_storefront_location_text(
            payload.get("storefront_location_title"),
            80,
        )

    if "storefront_location_address" in payload:
        payload["storefront_location_address"] = _clean_storefront_location_text(
            payload.get("storefront_location_address"),
            300,
        )

    if "storefront_google_maps_url" in payload:
        payload["storefront_google_maps_url"] = _clean_google_maps_url(
            payload.get("storefront_google_maps_url"),
            1000,
        )

    if "storefront_location_embed_url" in payload:
        payload["storefront_location_embed_url"] = _clean_google_maps_embed_url(
            payload.get("storefront_location_embed_url"),
            1000,
        )

    if not payload.get("storefront_location_embed_url") and payload.get("storefront_location_address"):
        payload["storefront_location_embed_url"] = _make_google_maps_search_embed_url(
            payload.get("storefront_location_address")
        )

    return payload


def _apply_storefront_tier_guard(payload, user):
    if not payload:
        return payload

    tier_for_featured_products = _normalize_storefront_tier(user)
    features = dict(_storefront_features_for_tier(tier_for_featured_products))
    features["promo"] = tier_for_featured_products in {"pro", "business"}
    featured_limits_by_tier = {
        "free": 0,
        "starter": 3,
        "pro": 6,
        "business": 12,
    }
    features["featured_limit"] = featured_limits_by_tier.get(tier_for_featured_products, 0)
    editable_copy_fields = [
        "storefront_hero_title",
        "storefront_hero_subtitle",
        "storefront_cta_label",
        "storefront_featured_title",
        "storefront_about_title",
    ]

    if not features["templates"]:
        payload["storefront_renderer"] = "legacy"
        payload["storefront_mode"] = "catalog"
        payload["storefront_style"] = "classic"
        payload.pop("storefront_featured_product_ids", None)

        for field in editable_copy_fields:
            payload.pop(field, None)

        return payload

    style = payload.get("storefront_style")
    if style and style not in features["styles"]:
        payload["storefront_style"] = "classic"

    if not features["editor"]:
        for field in editable_copy_fields:
            payload.pop(field, None)

    payload = _sanitize_storefront_featured_product_ids(payload, features)

    payload = _sanitize_storefront_promo_payload(payload, features)

    payload = _sanitize_storefront_payment_payload(payload, features.get("templates"))

    payload = _sanitize_storefront_whatsapp_template_payload(payload, features.get("templates"))

    payload = _sanitize_storefront_location_payload(payload)

    return payload



def _normalize_featured_product_ids(value, max_items=12):
    if value in (None, ""):
        return []

    if not isinstance(value, list):
        raise HTTPException(status_code=400, detail="Produk unggulan template tidak valid")

    cleaned = []
    seen = set()

    for item in value:
        product_id = str(item or "").strip()
        if not product_id or product_id in seen:
            continue
        seen.add(product_id)
        cleaned.append(product_id)

    return cleaned[:max_items]


@router.post("/storefront-copy-ai")
async def generate_storefront_copy_ai_v2(data: StorefrontCopyAIIn):
    copy, source = await _generate_storefront_copy_with_ai(data)
    return {
        "copy": copy,
        "source": source,
    }


@router.post("/storefront-copy-ai")
async def generate_storefront_copy_ai(data: StorefrontCopyAIIn):
    copy, source = await _generate_storefront_copy_with_ai(data)
    return {
        "copy": copy,
        "source": source,
    }




# ----------- Shop Readiness -----------
def _readiness_has_text(value):
    return bool(str(value or "").strip())


def _readiness_product_has_image(product):
    images = product.get("images")
    return bool(product.get("image_data") or (isinstance(images, list) and len(images) > 0))


def _readiness_product_category(product):
    return str(
        product.get("category_name")
        or product.get("category")
        or product.get("product_category")
        or ""
    ).strip()


def _readiness_item(key, label, ok, points, max_points, href, action_label, description=""):
    return {
        "key": key,
        "label": label,
        "status": "done" if ok else "todo",
        "points": points if ok else 0,
        "max_points": max_points,
        "href": href,
        "action_label": action_label,
        "description": description,
    }


def _readiness_group(key, title, items, description=""):
    max_points = sum(int(item.get("max_points") or 0) for item in items)
    points = sum(int(item.get("points") or 0) for item in items)
    score = round((points / max_points) * 100) if max_points else 0

    if score >= 90:
        status = "excellent"
    elif score >= 70:
        status = "ready"
    elif score >= 40:
        status = "needs_work"
    else:
        status = "not_ready"

    return {
        "key": key,
        "title": title,
        "description": description,
        "score": score,
        "points": points,
        "max_points": max_points,
        "status": status,
        "items": items,
    }


def _build_shop_readiness(shop, products):
    shop = _with_storefront_defaults(dict(shop or {}))
    products = [_lapakin_expose_product_status_fields(dict(p or {})) for p in (products or [])]

    active_products = [
        p for p in products
        if p.get("is_active") is not False and p.get("availability_status") != "hidden"
    ]

    products_with_image = [p for p in active_products if _readiness_product_has_image(p)]
    products_with_detail = [
        p for p in active_products
        if _readiness_has_text(p.get("description")) or _readiness_has_text(_readiness_product_category(p))
    ]

    whatsapp = str(shop.get("whatsapp") or shop.get("whatsapp_number") or "").strip()
    payment_instruction = str(
        shop.get("payment_instruction")
        or shop.get("storefront_payment_instruction")
        or shop.get("payment_notes")
        or ""
    ).strip()

    has_offline_store = bool(shop.get("has_offline_store") or shop.get("show_location"))
    store_address = str(
        shop.get("store_address")
        or shop.get("address")
        or shop.get("location_address")
        or shop.get("storefront_location_address")
        or ""
    ).strip()
    google_maps_url = str(
        shop.get("google_maps_url")
        or shop.get("google_maps_link")
        or shop.get("storefront_google_maps_url")
        or ""
    ).strip()

    profile_items = [
        _readiness_item(
            "shop_name",
            "Nama toko",
            _readiness_has_text(shop.get("name")),
            5,
            5,
            "/dashboard/settings#identity",
            "Lengkapi",
            "Nama toko tampil di website, kartu share, dan jawaban asisten.",
        ),
        _readiness_item(
            "business_type",
            "Jenis bisnis",
            _readiness_has_text(shop.get("business_type")),
            5,
            5,
            "/dashboard/settings#identity",
            "Pilih jenis",
            "Dipakai AI untuk menyesuaikan copy, layout, dan rekomendasi.",
        ),
        _readiness_item(
            "tagline",
            "Tagline toko",
            _readiness_has_text(shop.get("tagline")),
            5,
            5,
            "/dashboard/settings#identity",
            "Isi tagline",
            "Tagline membantu pelanggan cepat paham keunggulan toko.",
        ),
        _readiness_item(
            "description",
            "Deskripsi singkat",
            _readiness_has_text(shop.get("description") or shop.get("about")),
            5,
            5,
            "/dashboard/settings#identity",
            "Isi deskripsi",
            "Deskripsi toko dipakai untuk SEO, halaman website, dan Lapakin Asisten.",
        ),
    ]

    product_items = [
        _readiness_item(
            "has_product",
            "Minimal 1 produk aktif",
            len(active_products) >= 1,
            10,
            10,
            "/dashboard/ai-studio",
            "Tambah produk",
            "Website dan asisten butuh minimal satu produk untuk ditawarkan.",
        ),
        _readiness_item(
            "has_three_products",
            "Minimal 3 produk",
            len(active_products) >= 3,
            5,
            5,
            "/dashboard/products",
            "Kelola produk",
            "Tiga produk membuat website terlihat lebih siap dan tidak kosong.",
        ),
        _readiness_item(
            "product_images",
            "Produk punya foto",
            len(products_with_image) >= 1,
            5,
            5,
            "/dashboard/products",
            "Tambah foto",
            "Foto produk meningkatkan kepercayaan pelanggan.",
        ),
        _readiness_item(
            "product_details",
            "Produk punya detail/kategori",
            len(products_with_detail) >= 1,
            5,
            5,
            "/dashboard/products",
            "Lengkapi detail",
            "Detail produk membantu pelanggan dan asisten menjawab lebih akurat.",
        ),
    ]

    order_items = [
        _readiness_item(
            "whatsapp",
            "Nomor WhatsApp toko",
            _readiness_has_text(whatsapp),
            8,
            8,
            "/dashboard/settings?section=contact#contact",
            "Isi WhatsApp",
            "Nomor ini dipakai tombol order dan checkout.",
        ),
        _readiness_item(
            "order_whatsapp_enabled",
            "Order via WhatsApp aktif",
            bool(shop.get("order_whatsapp_enabled", True)),
            4,
            4,
            "/dashboard/settings?section=order#order",
            "Aktifkan order",
            "Pelanggan bisa langsung mengirim pesanan ke WhatsApp.",
        ),
        _readiness_item(
            "pickup_or_delivery",
            "Pickup atau delivery tersedia",
            bool(shop.get("pickup_available") or shop.get("delivery_available")),
            5,
            5,
            "/dashboard/settings?section=order#order",
            "Atur pengiriman",
            "Pilih minimal salah satu cara pemenuhan pesanan.",
        ),
        _readiness_item(
            "payment_instruction",
            "Instruksi pembayaran",
            _readiness_has_text(payment_instruction),
            5,
            5,
            "/dashboard/settings?section=payment#payment",
            "Isi pembayaran",
            "Instruksi pembayaran membantu pelanggan tahu langkah berikutnya.",
        ),
        _readiness_item(
            "payment_qris_or_label",
            "QRIS atau label pembayaran",
            _readiness_has_text(shop.get("storefront_qris_image") or shop.get("storefront_payment_method_label")),
            3,
            3,
            "/dashboard/settings?section=payment#payment",
            "Lengkapi QRIS",
            "Opsional, tapi membuat checkout manual lebih jelas.",
        ),
    ]

    location_items = [
        _readiness_item(
            "service_area",
            "Area layanan",
            _readiness_has_text(shop.get("service_area")),
            5,
            5,
            "/dashboard/settings?section=location#location",
            "Isi area",
            "Area layanan membantu pelanggan tahu apakah toko melayani lokasi mereka.",
        ),
        _readiness_item(
            "offline_address",
            "Alamat toko / online-only",
            (not has_offline_store) or _readiness_has_text(store_address),
            5,
            5,
            "/dashboard/settings?section=location#location",
            "Isi alamat",
            "Jika toko online-only, alamat tidak wajib. Jika punya lokasi offline, alamat sebaiknya diisi.",
        ),
        _readiness_item(
            "google_maps",
            "Google Maps / online-only",
            (not has_offline_store) or _readiness_has_text(google_maps_url),
            5,
            5,
            "/dashboard/settings?section=location#location",
            "Tambah Maps",
            "Google Maps direkomendasikan untuk toko offline atau lokasi pickup.",
        ),
    ]

    website_items = [
        _readiness_item(
            "storefront_template",
            "Template website aktif",
            str(shop.get("storefront_renderer") or "legacy") == "template",
            4,
            4,
            "/dashboard/website",
            "Atur website",
            "Template baru membuat tampilan website lebih siap dipromosikan.",
        ),
        _readiness_item(
            "storefront_mode_style",
            "Mode dan style website",
            _readiness_has_text(shop.get("storefront_mode")) and _readiness_has_text(shop.get("storefront_style")),
            4,
            4,
            "/dashboard/website",
            "Pilih tampilan",
            "Mode dan style membantu AI memilih layout yang cocok.",
        ),
        _readiness_item(
            "storefront_copy",
            "Hero, subtitle, dan CTA",
            _readiness_has_text(shop.get("storefront_hero_title"))
            and _readiness_has_text(shop.get("storefront_hero_subtitle"))
            and _readiness_has_text(shop.get("storefront_cta_label")),
            4,
            4,
            "/dashboard/website",
            "Lengkapi copy",
            "Copy utama menentukan kesan pertama pelanggan.",
        ),
        _readiness_item(
            "featured_products",
            "Produk unggulan",
            isinstance(shop.get("storefront_featured_product_ids"), list)
            and len(shop.get("storefront_featured_product_ids") or []) > 0,
            3,
            3,
            "/dashboard/website",
            "Pilih produk",
            "Produk unggulan membantu pelanggan langsung melihat produk terbaik.",
        ),
    ]

    groups = [
        _readiness_group("profile", "Profil Toko", profile_items, "Identitas dasar toko untuk website dan asisten."),
        _readiness_group("products", "Produk", product_items, "Katalog yang akan ditampilkan dan dijelaskan oleh asisten."),
        _readiness_group("order", "Order & Pembayaran", order_items, "Data penting agar pelanggan bisa order dengan lancar."),
        _readiness_group("location", "Lokasi & Layanan", location_items, "Area layanan, pickup, dan data lokasi jika ada toko offline."),
        _readiness_group("website", "Website Content", website_items, "Bahan untuk membuat website dengan AI."),
    ]

    total_points = sum(group["points"] for group in groups)
    total_max = sum(group["max_points"] for group in groups)
    score = round((total_points / total_max) * 100) if total_max else 0

    assistant_points = (
        groups[0]["points"]
        + groups[1]["points"]
        + groups[2]["points"]
        + groups[3]["points"]
    )
    assistant_max = (
        groups[0]["max_points"]
        + groups[1]["max_points"]
        + groups[2]["max_points"]
        + groups[3]["max_points"]
    )
    assistant_score = round((assistant_points / assistant_max) * 100) if assistant_max else 0

    if score >= 90:
        level = "excellent"
        summary = "Toko sudah siap dipromosikan. Website dan data operasional terlihat matang."
    elif score >= 70:
        level = "ready_for_ai"
        summary = "Toko sudah cukup siap untuk dibuatkan website dengan AI."
    elif score >= 40:
        level = "almost_ready"
        summary = "Toko hampir siap. Lengkapi beberapa data penting agar hasil website lebih bagus."
    else:
        level = "not_ready"
        summary = "Lengkapi data dasar toko, produk, dan order sebelum membuat website."

    next_item = None
    for group in groups:
        for item in group["items"]:
            if item["status"] != "done":
                next_item = item
                break
        if next_item:
            break

    next_best_action = None
    if next_item:
        next_best_action = {
            "label": next_item["action_label"],
            "title": next_item["label"],
            "href": next_item["href"],
            "description": next_item.get("description", ""),
        }

    return {
        "score": score,
        "level": level,
        "summary": summary,
        "can_generate_website": score >= 70,
        "assistant_score": assistant_score,
        "can_enable_assistant": assistant_score >= 70,
        "points": total_points,
        "max_points": total_max,
        "products_count": len(products),
        "active_products_count": len(active_products),
        "groups": groups,
        "next_best_action": next_best_action,
    }


@router.get("/shops/readiness")
async def get_shop_readiness(request: Request):
    user = await require_user(request)

    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")

    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    shop = _with_storefront_defaults(shop)

    products = await db.products.find(
        {"shop_id": user["shop_id"]},
        {"_id": 0},
    ).sort("sort_order", 1).to_list(length=500)

    return _build_shop_readiness(shop, products)



# ----------- Website AI Generate -----------
def _website_ai_infer_mode(shop):
    current = str(shop.get("storefront_mode") or "").strip()
    if current in ALLOWED_STOREFRONT_MODES:
        return current

    business_type = str(shop.get("business_type") or shop.get("category") or "").lower()
    if business_type in {"kuliner", "kopi", "makanan", "minuman", "fnb", "f&b"}:
        return "food_menu"
    if business_type in {"jasa", "service", "layanan"}:
        return "services"
    return "catalog"


def _website_ai_infer_style(shop, user):
    current = str(shop.get("storefront_style") or "").strip()
    tier = _normalize_storefront_tier(user)
    features = _storefront_features_for_tier(tier)
    allowed_styles = features.get("styles") or {"classic"}

    if current in allowed_styles:
        return current

    if "modern" in allowed_styles:
        return "modern"

    return "classic"


def _website_ai_pick_featured_product_ids(products, max_items=6):
    cleaned = []

    def has_image(product):
        images = product.get("images")
        return bool(product.get("image_data") or (isinstance(images, list) and images))

    active_products = [
        dict(product or {})
        for product in (products or [])
        if product.get("is_active") is not False and product.get("availability_status") != "hidden"
    ]

    preferred = sorted(
        active_products,
        key=lambda item: (
            0 if has_image(item) else 1,
            int(item.get("sort_order") or 0),
            str(item.get("name") or ""),
        ),
    )

    seen = set()
    for product in preferred:
        product_id = str(product.get("product_id") or "").strip()
        if not product_id or product_id in seen:
            continue
        seen.add(product_id)
        cleaned.append(product_id)
        if len(cleaned) >= max_items:
            break

    return cleaned



# LAPAKIN_AI_GENERATE_LAYOUT_VARIANT_V1
def _website_ai_infer_layout_variant(shop: dict) -> str:
    raw = " ".join([
        str(shop.get("storefront_layout_variant") or ""),
        str(shop.get("business_type") or ""),
        str(shop.get("category") or ""),
        str(shop.get("category_name") or ""),
        str(shop.get("business_category") or ""),
        str(shop.get("description") or ""),
        str(shop.get("tagline") or ""),
        str(shop.get("name") or ""),
    ]).lower()

    explicit = str(shop.get("storefront_layout_variant") or "").strip()
    if explicit in ALLOWED_STOREFRONT_LAYOUT_VARIANTS and explicit:
        return explicit

    if any(term in raw for term in ["laundry", "laundri", "cuci", "setrika", "dry clean", "dryclean"]):
        return "laundry_clean_service"

    if any(term in raw for term in ["fashion", "baju", "pakaian", "busana", "hijab", "sepatu", "tas", "aksesoris", "clothing"]):
        return "fashion_visual_catalog"

    if any(term in raw for term in ["kerajinan", "craft", "handmade", "souvenir", "hampers", "kriya", "rajut", "batik", "anyaman"]):
        return "craft_story_catalog"

    mode = _website_ai_infer_mode(shop)

    if any(term in raw for term in ["jasa", "service", "servis", "repair", "konsultan", "konsultasi", "booking", "salon", "barber", "ac", "maintenance"]) or mode == "services":
        return "service_trust_cta"

    if any(term in raw for term in ["kuliner", "makanan", "minuman", "warung", "kopi", "cafe", "resto", "bakso", "nasi", "snack", "kue", "catering", "food"]) or mode == "food_menu":
        return "food_warm_menu"

    return "fashion_visual_catalog"


def _website_ai_layout_variant_mode_style(variant: str) -> tuple[str, str]:
    mapping = {
        "food_warm_menu": ("food_menu", "playful"),
        "laundry_clean_service": ("services", "modern"),
        "fashion_visual_catalog": ("catalog", "modern"),
        "service_trust_cta": ("services", "premium"),
        "craft_story_catalog": ("catalog", "classic"),
    }
    return mapping.get(variant, ("catalog", "modern"))




# LAPAKIN_AI_DRAFT_BEFORE_APPLY_V1
AI_WEBSITE_DRAFT_FIELDS = {
    "storefront_renderer",
    "storefront_mode",
    "storefront_style",
    "storefront_layout_variant",
    "storefront_hero_title",
    "storefront_hero_subtitle",
    "storefront_cta_label",
    "storefront_featured_title",
    "storefront_about_title",
    "storefront_promo_title",
    "storefront_promo_text",
    "storefront_seo_title",
    "storefront_seo_description",
    "storefront_featured_product_ids",
}


def _filter_website_ai_draft_payload(payload: dict) -> dict:
    if not isinstance(payload, dict):
        return {}

    return {
        key: value
        for key, value in payload.items()
        if key in AI_WEBSITE_DRAFT_FIELDS
    }


async def _build_shop_website_ai_draft(user: dict):
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")

    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    shop = _with_storefront_defaults(shop)

    products = await db.products.find(
        {"shop_id": user["shop_id"]},
        {"_id": 0},
    ).sort("sort_order", 1).to_list(length=500)

    readiness = _build_shop_readiness(shop, products)
    if readiness.get("score", 0) < 70:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Readiness toko belum cukup untuk membuat website dengan AI.",
                "readiness": readiness,
                "next_best_action": readiness.get("next_best_action"),
            },
        )

    tier = _normalize_storefront_tier(user)
    features = _storefront_features_for_tier(tier)
    if not features.get("templates"):
        raise HTTPException(
            status_code=403,
            detail="Fitur website template/AI tersedia mulai paket Starter.",
        )

    featured_limit_by_tier = {
        "starter": 3,
        "pro": 6,
        "business": 12,
    }
    featured_limit = featured_limit_by_tier.get(tier, 3)

    storefront_layout_variant = _website_ai_infer_layout_variant(shop)
    variant_mode, variant_style = _website_ai_layout_variant_mode_style(storefront_layout_variant)

    storefront_mode = variant_mode or _website_ai_infer_mode(shop)
    storefront_style = variant_style or _website_ai_infer_style(shop, user)

    current_copy = {
        "storefront_hero_title": shop.get("storefront_hero_title") or "",
        "storefront_hero_subtitle": shop.get("storefront_hero_subtitle") or "",
        "storefront_cta_label": shop.get("storefront_cta_label") or "",
        "storefront_featured_title": shop.get("storefront_featured_title") or "",
        "storefront_about_title": shop.get("storefront_about_title") or "",
    }

    copy, source = await _generate_storefront_copy_with_ai(StorefrontCopyAIIn(
        shop_name=shop.get("name") or "",
        shop_description=shop.get("description") or shop.get("about") or "",
        business_category=shop.get("business_type") or shop.get("category") or "",
        instagram=shop.get("instagram") or "",
        tiktok=shop.get("tiktok") or "",
        storefront_mode=storefront_mode,
        storefront_style=storefront_style,
        current=current_copy,
    ))

    draft_payload = {
        "storefront_renderer": "template",
        "storefront_mode": storefront_mode,
        "storefront_style": storefront_style,
        "storefront_layout_variant": storefront_layout_variant,
        **copy,
        "storefront_featured_product_ids": _website_ai_pick_featured_product_ids(products, featured_limit),
    }

    if not shop.get("storefront_seo_title"):
        draft_payload["storefront_seo_title"] = f"{shop.get('name') or 'Toko UMKM'} · Lapakin"
    if not shop.get("storefront_seo_description"):
        draft_payload["storefront_seo_description"] = (
            shop.get("description")
            or shop.get("tagline")
            or "Toko online UMKM Indonesia di Lapakin."
        )[:160]

    draft_payload = _filter_website_ai_draft_payload(draft_payload)
    draft_payload = _apply_storefront_tier_guard(draft_payload, user)
    draft_payload = _normalize_shop_settings_payload(draft_payload)

    return {
        "ok": True,
        "source": source,
        "message": "Draft website berhasil dibuat dengan AI.",
        "generated": draft_payload,
        "readiness": readiness,
        "shop_slug": shop.get("slug"),
        "storefront_url": f"/toko/{shop.get('slug')}" if shop.get("slug") else "",
        "applied": False,
    }


async def _apply_shop_website_ai_draft(user: dict, raw_payload: dict):
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")

    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    products = await db.products.find(
        {"shop_id": user["shop_id"]},
        {"_id": 0},
    ).sort("sort_order", 1).to_list(length=500)

    draft = raw_payload.get("generated") or raw_payload.get("draft") or raw_payload
    update_payload = _filter_website_ai_draft_payload(draft)

    if not update_payload:
        raise HTTPException(status_code=400, detail="Draft website kosong atau tidak valid")

    update_payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    update_payload = _apply_storefront_tier_guard(update_payload, user)
    update_payload = _normalize_shop_settings_payload(update_payload)

    await db.shops.update_one(
        {"shop_id": user["shop_id"]},
        {"$set": update_payload},
    )

    OG_PNG_CACHE.pop(user["shop_id"], None)

    updated_shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    updated_shop = _with_storefront_defaults(updated_shop)
    readiness_after = _build_shop_readiness(updated_shop, products)

    return {
        "ok": True,
        "source": raw_payload.get("source") or "draft",
        "message": "Draft website AI berhasil diterapkan.",
        "generated": update_payload,
        "readiness": readiness_after,
        "shop_slug": updated_shop.get("slug") or shop.get("slug"),
        "storefront_url": f"/toko/{updated_shop.get('slug') or shop.get('slug')}" if (updated_shop.get("slug") or shop.get("slug")) else "",
        "applied": True,
    }


@router.post("/shops/website-ai/draft")
async def draft_shop_website_ai(request: Request):
    user = await require_user(request)
    return await _build_shop_website_ai_draft(user)


@router.post("/shops/website-ai/apply")
async def apply_shop_website_ai(request: Request):
    user = await require_user(request)

    try:
        raw_payload = await request.json()
    except Exception:
        raw_payload = {}

    return await _apply_shop_website_ai_draft(user, raw_payload)


@router.post("/shops/website-ai/generate")
async def generate_shop_website_ai(request: Request):
    user = await require_user(request)
    draft = await _build_shop_website_ai_draft(user)
    applied = await _apply_shop_website_ai_draft(user, draft)
    applied["source"] = draft.get("source")
    return applied




@router.get("/shops/me")
async def get_my_shop(request: Request):
    user = await require_user(request)
    if not user.get("shop_id"):
        return None
    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    shop = _with_storefront_defaults(shop)
    return shop


@router.post("/shops/me")
async def create_or_update_shop(data: ShopIn, request: Request):
    user = await require_user(request)
    now = datetime.now(timezone.utc).isoformat()
    payload = data.model_dump()
    
    payload = _normalize_shop_settings_payload(payload)
# featured_picker_persist_guard
    if "storefront_featured_product_ids" in payload:
        current_tier_for_featured = (locals().get("user") or {}).get("tier") or "free"
        featured_limit_by_tier = {
            "free": 0,
            "starter": 3,
            "pro": 6,
            "business": 12,
        }
        featured_limit = featured_limit_by_tier.get(str(current_tier_for_featured).lower(), 0)
        if featured_limit <= 0:
            payload.pop("storefront_featured_product_ids", None)
        else:
            payload["storefront_featured_product_ids"] = _normalize_featured_product_ids(
                payload.get("storefront_featured_product_ids", []),
            )

    raw_storefront_mode = payload.get("storefront_mode")
    raw_storefront_style = payload.get("storefront_style")
    raw_storefront_renderer = payload.get("storefront_renderer")
    # LAPAKIN_STOREFRONT_LAYOUT_VARIANT_V1
    raw_storefront_layout_variant = payload.get("storefront_layout_variant")
    raw_website_mode = payload.get("website_mode")
    raw_external_website_behavior = payload.get("external_website_behavior")

    if raw_website_mode in (None, ""):
        payload.pop("website_mode", None)
    elif raw_website_mode not in ALLOWED_WEBSITE_MODES:
        raise HTTPException(status_code=400, detail="Mode website tidak valid")
    else:
        payload["website_mode"] = raw_website_mode

    if raw_external_website_behavior in (None, ""):
        payload.pop("external_website_behavior", None)
    elif raw_external_website_behavior not in ALLOWED_EXTERNAL_WEBSITE_BEHAVIORS:
        raise HTTPException(status_code=400, detail="Behavior website custom tidak valid")
    else:
        payload["external_website_behavior"] = raw_external_website_behavior

    if raw_storefront_mode in (None, ""):
        payload.pop("storefront_mode", None)
    elif raw_storefront_mode not in ALLOWED_STOREFRONT_MODES:
        raise HTTPException(status_code=400, detail="Mode tampilan website tidak valid")
    else:
        payload["storefront_mode"] = raw_storefront_mode

    if raw_storefront_style in (None, ""):
        payload.pop("storefront_style", None)
    elif raw_storefront_style not in ALLOWED_STOREFRONT_STYLES:
        raise HTTPException(status_code=400, detail="Style tampilan website tidak valid")
    else:
        payload["storefront_style"] = raw_storefront_style

    if raw_storefront_renderer in (None, ""):
        payload.pop("storefront_renderer", None)
    elif raw_storefront_renderer not in ALLOWED_STOREFRONT_RENDERERS:
        raise HTTPException(status_code=400, detail="Renderer tampilan website tidak valid")
    else:
        payload["storefront_renderer"] = raw_storefront_renderer

    # LAPAKIN_STOREFRONT_LAYOUT_VARIANT_V1
    if raw_storefront_layout_variant in (None, ""):
        payload.pop("storefront_layout_variant", None)
    elif raw_storefront_layout_variant not in ALLOWED_STOREFRONT_LAYOUT_VARIANTS:
        raise HTTPException(status_code=400, detail="Variant desain website tidak valid")
    else:
        payload["storefront_layout_variant"] = raw_storefront_layout_variant

    payload = _sanitize_storefront_payment_payload(
        payload,
        templates_enabled=(payload.get("storefront_renderer") or "template") != "legacy" or bool(user.get("shop_id")),
    )
    payload = _sanitize_storefront_whatsapp_template_payload(
        payload,
        templates_enabled=(payload.get("storefront_renderer") or "template") != "legacy" or bool(user.get("shop_id")),
    )
    payload = _sanitize_storefront_location_payload(payload)

    # Keep dashboard Pengaturan Toko canonical fields and legacy aliases synced
    # after storefront sanitizers mutate payment/location fields.
    payload = _normalize_shop_settings_payload(payload)

    if user.get("shop_id"):
        # update
        if "storefront_testimonials" in payload:
            payload["storefront_testimonials"] = normalize_storefront_testimonials(payload.get("storefront_testimonials"))
        if "storefront_show_testimonials" in payload:
            payload["storefront_show_testimonials"] = bool(payload.get("storefront_show_testimonials"))

        await db.shops.update_one(
            {"shop_id": user["shop_id"]},
            {"$set": {**payload, "updated_at": now}}
        )
        # Invalidate OG image cache (cover/brand/name/tagline may have changed)
        OG_PNG_CACHE.pop(user["shop_id"], None)
        shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
        shop = _with_storefront_defaults(shop)
        return shop
    # On first creation, smart-default sells_by based on business_type
    if payload.get("sells_by") in (None, "", "stock"):
        bt = (payload.get("business_type") or "").lower()
        if bt in ("kuliner", "kopi"):
            payload["sells_by"] = "hours"
            payload["is_open"] = True
    # create with unique slug
    slug = await _unique_shop_slug(data.name)
    shop_id = f"shop_{uuid.uuid4().hex[:12]}"
    doc = {
        "shop_id": shop_id, "slug": slug, "owner_user_id": user["user_id"],
        **payload, "created_at": now,
    }
    doc.setdefault("storefront_mode", "catalog")
    doc.setdefault("storefront_style", "classic")
    doc.setdefault("storefront_featured_product_ids", [])
    doc.setdefault("storefront_show_promo", False)
    doc.setdefault("storefront_promo_title", "")
    doc.setdefault("storefront_promo_text", "")
    doc.setdefault("storefront_promo_cta_label", "")
    doc.setdefault("storefront_promo_slug", "")
    doc.setdefault("storefront_show_payment_instruction", False)
    doc.setdefault("storefront_payment_method_label", "")
    doc.setdefault("storefront_payment_instruction", "")
    doc.setdefault("storefront_qris_image", "")
    doc.setdefault("storefront_seo_title", "")
    doc.setdefault("storefront_seo_description", "")
    doc.setdefault("storefront_seo_image", "")
    doc.setdefault("storefront_payment_confirmation_text", "")
    doc.setdefault("storefront_whatsapp_checkout_template", "Halo {shop_name}, saya mau pesan:\n\n{items}\n\nTotal: {total}\nNama: {customer_name}\nCatatan: {notes}\n{payment_instruction}")
    doc.setdefault("storefront_whatsapp_product_template", "Halo {shop_name}, saya mau tanya produk:\n\n{product_name}\nHarga: {product_price}\n\nApakah masih tersedia?")
    doc.setdefault("storefront_show_location_map", False)
    doc.setdefault("storefront_location_title", "")
    doc.setdefault("storefront_location_address", "")
    doc.setdefault("storefront_google_maps_url", "")
    doc.setdefault("storefront_location_embed_url", "")
    doc.setdefault("storefront_renderer", "legacy")
    doc.setdefault("website_mode", "lapakin_template")
    doc.setdefault("external_website_url", "")
    doc.setdefault("external_website_label", "")
    doc.setdefault("external_website_behavior", "handoff")
    await _enforce_owner_shop_create_limit(user)
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
    shop = _with_storefront_defaults(shop)
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")
    new_state = not bool(shop.get("is_open", True))
    await db.shops.update_one(
        {"shop_id": user["shop_id"]},
        {"$set": {"is_open": new_state, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"is_open": new_state}


@router.post("/shops/me/snooze")
async def snooze_shop(request: Request):
    """Temporarily close the shop for N minutes (F&B 'istirahat singkat').
    Body: {"minutes": int}  — 15/30/60 recommended. 0 = cancel snooze.
    """
    user = await require_user(request)
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")
    try:
        body = await request.json()
    except Exception:
        body = {}
    minutes = int(body.get("minutes", 0) or 0)
    if minutes < 0 or minutes > 480:  # max 8 hours
        raise HTTPException(status_code=400, detail="Durasi snooze 0–480 menit")

    now = datetime.now(timezone.utc)
    if minutes == 0:
        await db.shops.update_one(
            {"shop_id": user["shop_id"]},
            {"$set": {"snooze_until": None, "updated_at": now.isoformat()}},
        )
        return {"snooze_until": None, "snoozed": False}

    until = (now + timedelta(minutes=minutes)).isoformat()
    await db.shops.update_one(
        {"shop_id": user["shop_id"]},
        {"$set": {"snooze_until": until, "updated_at": now.isoformat()}},
    )
    return {"snooze_until": until, "snoozed": True, "minutes": minutes}


@router.get("/shops/mine")
async def list_my_shops(request: Request):
    """List shops/cabang owned by user and current active shop.

    Staff only sees the active shop assigned to them.
    """
    user = await require_user(request)

    if _is_staff(user):
        shops = []
        if user.get("shop_id"):
            shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
            shop = _with_storefront_defaults(shop)
            if shop:
                shops = [shop]
        return {
            "active_shop_id": user.get("shop_id"),
            "is_staff": True,
            "can_create": False,
            "tier": user.get("tier") or "free",
            "limit": 1,
            "used": len(shops),
            "remaining": 0,
            "shops": shops,
        }

    shops = await db.shops.find(
        {"owner_user_id": user["user_id"]},
        {"_id": 0},
    ).sort("created_at", 1).to_list(50)

    limit_state = await _owner_shop_limit(user)

    return {
        "active_shop_id": user.get("shop_id"),
        "is_staff": False,
        **limit_state,
        "shops": shops,
    }


@router.post("/shops/switch/{shop_id}")
async def switch_active_shop(shop_id: str, request: Request):
    """Switch current active shop for owner.

    Existing routes keep working because they read user.shop_id.
    """
    user = await require_user(request)

    if _is_staff(user):
        raise HTTPException(status_code=403, detail="Staff tidak bisa mengganti cabang aktif")

    shop = await db.shops.find_one(
        {"shop_id": shop_id, "owner_user_id": user["user_id"]},
        {"_id": 0},
    )
    if not shop:
        raise HTTPException(status_code=404, detail="Cabang tidak ditemukan")

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "shop_id": shop_id,
            "active_shop_switched_at": datetime.now(timezone.utc).isoformat(),
        }},
    )

    return {"ok": True, "active_shop_id": shop_id, "shop": shop}


@router.post("/shops/branches")
async def create_branch_shop(data: ShopIn, request: Request):
    """Create a new shop/cabang for the current owner and switch to it."""
    user = await require_user(request)


    now = datetime.now(timezone.utc).isoformat()
    payload = data.model_dump()

    # featured_picker_persist_guard
    if "storefront_featured_product_ids" in payload:
        current_tier_for_featured = (locals().get("user") or {}).get("tier") or "free"
        featured_limit_by_tier = {
            "free": 0,
            "starter": 3,
            "pro": 6,
            "business": 12,
        }
        featured_limit = featured_limit_by_tier.get(str(current_tier_for_featured).lower(), 0)
        if featured_limit <= 0:
            payload.pop("storefront_featured_product_ids", None)
        else:
            payload["storefront_featured_product_ids"] = _normalize_featured_product_ids(
            "storefront_show_testimonials",
            "storefront_testimonials",
                payload.get("storefront_featured_product_ids"),
                "storefront_show_testimonials",
                "storefront_testimonials",
                featured_limit,
            )

    if payload.get("sells_by") in (None, "", "stock"):
        bt = (payload.get("business_type") or "").lower()
        if bt in ("kuliner", "kopi"):
            payload["sells_by"] = "hours"
            payload["is_open"] = True

    slug = await _unique_shop_slug(data.name)
    shop_id = f"shop_{uuid.uuid4().hex[:12]}"

    doc = {
        "shop_id": shop_id,
        "slug": slug,
        "owner_user_id": user["user_id"],
        "branch": True,
        **payload,
        "created_at": now,
        "updated_at": now,
    }

    await _enforce_owner_shop_create_limit(user)
    await db.shops.insert_one(doc)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "shop_id": shop_id,
            "active_shop_switched_at": now,
        }},
    )

    return {k: v for k, v in doc.items() if k != "_id"}





@router.patch("/shops/me/open-status")
async def update_my_shop_open_status(request: Request):
    """Allow owner/staff to manually open/close the active shop.

    This is separate from full shop settings because staff may need operational
    access to close/reopen the shop without editing core settings.
    """
    user = await require_user(request)

    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")

    payload = await request.json()
    is_open = bool(payload.get("is_open"))

    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})

    shop = _with_storefront_defaults(shop)
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    now = datetime.now(timezone.utc).isoformat()

    update = {
        "is_open": is_open,
        "manual_open_override": True,
        "manual_open_override_by": user.get("user_id"),
        "manual_open_override_at": now,
        "updated_at": now,
    }

    # Kalau dibuka kembali, override tetap dicatat tapi status kembali buka.
    # Jadwal otomatis tetap tersimpan dan tidak dimatikan.
    await db.shops.update_one(
        {"shop_id": user["shop_id"]},
        {"$set": update},
    )

    updated = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    return updated


@router.get("/shops/by-slug/{slug}")
async def get_shop_public(slug: str):
    shop = await db.shops.find_one({"slug": slug}, {"_id": 0})
    shop = _with_storefront_defaults(shop)
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")
    if shop.get("status") == "suspended":
        raise HTTPException(status_code=404, detail="Toko tidak tersedia")
    products = await db.products.find({"shop_id": shop["shop_id"]}, {"_id": 0}).sort([("sort_order", 1), ("created_at", -1)]).to_list(200)
    schedule_status = compute_schedule_status(shop)
    if schedule_status.get("auto") and not shop.get("manual_open_override"):
        shop["is_open"] = bool(schedule_status.get("is_open_now"))
    shop["schedule_status"] = schedule_status
    owner = await db.users.find_one({"user_id": shop.get("owner_user_id")}, {"_id": 0, "tier": 1})
    owner_tier = (owner or {}).get("tier") or "free"
    shop["owner_tier"] = owner_tier
    shop["remove_branding"] = bool(get_limits(owner_tier).get("remove_branding"))
    shop["headless_enabled"] = shop.get("website_mode") == "external_custom"
    shop["public_data_endpoint"] = f"/api/shops/by-slug/{shop.get('slug', slug)}"
    # Track a pageview (best-effort, fire-and-forget)
    try:
        await db.storefront_visits.insert_one({
            "shop_id": shop.get("shop_id"),
            "slug": slug,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass
    return {"shop": shop, "products": [_lapakin_expose_product_status_fields(p) for p in products]}


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
    shop = _with_storefront_defaults(shop)
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



# ----------- Share / OG Health Check -----------
@router.get("/shops/me/share-health")
async def share_health(request: Request):
    """Quick diagnostic for owner dashboard:
    - Resolves whether <slug>.lapakin.my.id DNS points to this server (Pro+)
    - Reports OG HTML / OG image reachability on both /toko/<slug> and subdomain
    - Tier gating: custom_subdomain feature must be enabled
    Returns JSON used by the OG Health widget in Dashboard.
    """
    import socket
    import httpx
    user = await require_user(request)
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")
    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    shop = _with_storefront_defaults(shop)
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    slug = shop["slug"]
    tier = user.get("tier") or "free"
    can_subdomain = bool(get_limits(tier).get("custom_subdomain"))

    # Base URL from the current request (so works on preview, prod, local)
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "https"
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    apex_base = f"{proto}://{host}"
    subdomain_host = f"{slug}.lapakin.my.id"
    subdomain_base = f"https://{subdomain_host}"

    result = {
        "slug": slug,
        "tier": tier,
        "can_use_subdomain": can_subdomain,
        "apex": {"host": host, "url": f"{apex_base}/toko/{slug}"},
        "subdomain": {
            "host": subdomain_host,
            "url": subdomain_base,
            "dns_resolves": None,        # True / False / None (unchecked)
            "reachable": None,
            "og_valid": None,
        },
        "og_image_url": f"{apex_base}/api/og/shop/{slug}.png",
    }

    if not can_subdomain:
        return result

    # 1) DNS resolve
    try:
        socket.setdefaulttimeout(2.5)
        socket.gethostbyname(subdomain_host)
        result["subdomain"]["dns_resolves"] = True
    except Exception:
        result["subdomain"]["dns_resolves"] = False
        return result  # No point checking HTTP if DNS fails

    # 2) HTTP reachability + og:title detection (use facebook UA to hit OG HTML path)
    try:
        async with httpx.AsyncClient(timeout=4.0, follow_redirects=True, verify=True) as client:
            r = await client.get(
                subdomain_base + "/",
                headers={"User-Agent": "facebookexternalhit/1.1"},
            )
            result["subdomain"]["reachable"] = r.status_code == 200
            body = (r.text or "").lower()
            result["subdomain"]["og_valid"] = (
                r.status_code == 200
                and 'property="og:title"' in body
                and 'property="og:image"' in body
            )
    except Exception as e:
        logger.info(f"share-health subdomain check failed: {e}")
        result["subdomain"]["reachable"] = False
        result["subdomain"]["og_valid"] = False

    # Fire one-shot "subdomain live" email the first time it resolves cleanly
    if (result["subdomain"]["dns_resolves"]
            and result["subdomain"]["og_valid"]
            and not user.get("subdomain_live_notified_at")):
        try:
            from email_service import send_email
            from email_templates import subdomain_live
            subject, html, text = subdomain_live(
                user.get("name") or "",
                shop.get("name") or slug,
                subdomain_base,
            )
            sent = await send_email(
                to=user["email"],
                subject=subject,
                html=html,
                text=text,
            )
            if sent:
                await db.users.update_one(
                    {"user_id": user["user_id"]},
                    {"$set": {"subdomain_live_notified_at": datetime.now(timezone.utc).isoformat()}},
                )
                result["subdomain"]["just_notified"] = True
        except Exception as e:
            logger.info(f"subdomain_live email failed: {e}")

    return result


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
class DowngradeShopSelectIn(BaseModel):
    shop_id: str


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
def _downgrade_norm(value):
    return str(value or "").strip()


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
def _downgrade_lower(value):
    return _downgrade_norm(value).lower()


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
def _downgrade_user_id(user):
    user = user or {}
    for key in ["user_id", "id", "uid", "sub"]:
        if user.get(key):
            return str(user.get(key))
    return ""


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
def _downgrade_user_email(user):
    user = user or {}
    for key in ["email", "email_lower", "user_email"]:
        if user.get(key):
            return _downgrade_lower(user.get(key))
    return ""


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
async def _downgrade_require_user(request: Request):
    import inspect

    result = require_user(request)
    if inspect.isawaitable(result):
        return await result
    return result


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
def _downgrade_owned_shop_query(user):
    user_id = _downgrade_user_id(user)
    email = _downgrade_user_email(user)

    ors = []

    if user_id:
        ors.extend([
            {"owner_user_id": user_id},
            {"user_id": user_id},
            {"created_by_user_id": user_id},
        ])

    if email:
        ors.extend([
            {"owner_email": email},
            {"email": email},
            {"user_email": email},
            {"created_by_email": email},
            {"owner.email": email},
        ])

    if not ors:
        ors.append({"__never_match__": True})

    return {"$or": ors}


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
def _downgrade_is_deleted_shop(shop):
    shop = shop or {}
    status = _downgrade_lower(shop.get("status"))
    return bool(shop.get("deleted_at")) or status in {"deleted", "removed"}


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
def _downgrade_is_tier_suspended(shop):
    shop = shop or {}
    return shop.get("tier_suspended") is True or _downgrade_lower(shop.get("status")) == "tier_suspended"


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
def _downgrade_is_manageable_shop(shop):
    shop = shop or {}

    if _downgrade_is_deleted_shop(shop):
        return False

    if _downgrade_is_tier_suspended(shop):
        return False

    status = _downgrade_lower(shop.get("status") or "active")
    if status in {"inactive", "suspended", "admin_suspended", "banned", "disabled"}:
        return False

    return True


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
def _downgrade_plan_from_doc(doc):
    doc = doc or {}

    for key in [
        "tier",
        "plan",
        "plan_code",
        "membership_tier",
        "current_tier",
        "subscription_tier",
        "package",
        "package_code",
    ]:
        value = _downgrade_lower(doc.get(key))
        if value:
            return value

    return ""


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
def _downgrade_status_from_doc(doc):
    doc = doc or {}

    for key in ["subscription_status", "subscription_suspend_reason", "billing_status", "membership_status", "status"]:  # LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V11
        value = _downgrade_lower(doc.get(key))
        if value:
            return value

    return ""


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
def _downgrade_limit_from_plan(plan, status=""):
    plan = _downgrade_lower(plan)
    status = _downgrade_lower(status)

    if status in {"expired", "canceled", "cancelled", "past_due", "unpaid", "inactive", "suspended", "subscription_expired"}:  # LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V11
        return 1

    if plan in {"business", "biz", "enterprise"}:
        return 999

    if plan in {"pro", "trial_pro", "trial-pro"}:
        return 3

    # Free/default: hanya 1 toko aktif.
    return 1


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
async def _downgrade_effective_tier(user):
    user_id = _downgrade_user_id(user)
    email = _downgrade_user_email(user)

    plan = _downgrade_plan_from_doc(user)
    status = _downgrade_status_from_doc(user)

    query_ors = []
    if user_id:
        query_ors.extend([{"user_id": user_id}, {"owner_user_id": user_id}])
    if email:
        query_ors.extend([{"email": email}, {"user_email": email}, {"owner_email": email}])

    # Coba baca subscription/membership terbaru kalau ada.
    if query_ors:
        for col_name in ["subscriptions", "memberships", "billing_accounts", "user_subscriptions"]:
            try:
                docs = await db[col_name].find({"$or": query_ors}, {"_id": 0}).sort("updated_at", -1).limit(3).to_list(3)
            except Exception:
                docs = []

            for doc in docs:
                doc_plan = _downgrade_plan_from_doc(doc)
                doc_status = _downgrade_status_from_doc(doc)

                if doc_plan:
                    plan = doc_plan
                if doc_status:
                    status = doc_status

                # Kalau ada doc active/trialing, pakai itu.
                if doc_status in {"active", "trialing", "trial", "paid"}:
                    return {
                        "plan": plan or "free",
                        "status": doc_status,
                        "shop_limit": _downgrade_limit_from_plan(plan, doc_status),
                    }

    return {
        "plan": plan or "free",
        "status": status or "unknown",
        "shop_limit": _downgrade_limit_from_plan(plan, status),
    }


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
async def _downgrade_product_count(shop_id):
    if not shop_id:
        return 0

    try:
        return await db.products.count_documents({"shop_id": shop_id})
    except Exception:
        return 0


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
async def _downgrade_shop_payload(shop):
    shop = dict(shop or {})
    shop.pop("_id", None)

    return {
        "shop_id": shop.get("shop_id") or "",
        "name": shop.get("name") or shop.get("shop_name") or "Toko",
        "slug": shop.get("slug") or "",
        "status": shop.get("status") or "active",
        "business_type": shop.get("business_type") or shop.get("type") or "",
        "owner_user_id": shop.get("owner_user_id") or "",
        "owner_email": shop.get("owner_email") or shop.get("email") or "",
        "tier_suspended": _downgrade_is_tier_suspended(shop),
        "manageable": _downgrade_is_manageable_shop(shop),
        "product_count": await _downgrade_product_count(shop.get("shop_id")),
        "created_at": shop.get("created_at") or "",
        "updated_at": shop.get("updated_at") or "",
    }


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
async def _downgrade_get_owned_shops(user):
    query = _downgrade_owned_shop_query(user)
    shops = await db.shops.find(query, {"_id": 0}).sort("created_at", 1).limit(100).to_list(100)

    # Deduplicate by shop_id.
    seen = set()
    rows = []
    for shop in shops:
        shop_id = shop.get("shop_id")
        if not shop_id or shop_id in seen:
            continue
        seen.add(shop_id)
        rows.append(shop)

    return rows


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
async def _downgrade_resolution_payload(user):
    tier = await _downgrade_effective_tier(user)
    shops = await _downgrade_get_owned_shops(user)

    non_deleted = [s for s in shops if not _downgrade_is_deleted_shop(s)]
    manageable = [s for s in non_deleted if _downgrade_is_manageable_shop(s)]
    tier_suspended = [s for s in non_deleted if _downgrade_is_tier_suspended(s)]

    current_shop_id = (
        user.get("current_shop_id")
        or user.get("selected_shop_id")
        or user.get("active_shop_id")
        or user.get("shop_id")
        or ""
    )  # LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V11

    current_valid = any(
        s.get("shop_id") == current_shop_id and _downgrade_is_manageable_shop(s)
        for s in non_deleted
    )

    shop_limit = int(tier.get("shop_limit") or 1)

    needs_resolution = False
    reason = ""

    if shop_limit <= 1 and len(manageable) > 1:
        needs_resolution = True
        reason = "tier_limit_exceeded"
    elif shop_limit <= 1 and len(non_deleted) > 1 and not current_valid and len(tier_suspended) == 0:
        needs_resolution = True
        reason = "current_shop_invalid_after_downgrade"
    elif current_shop_id and not current_valid and non_deleted:
        needs_resolution = True
        reason = "current_shop_invalid"

    selected_shop = None
    for s in non_deleted:
        if s.get("shop_id") == current_shop_id:
            selected_shop = s
            break

    if not selected_shop and manageable:
        selected_shop = manageable[0]
    elif not selected_shop and non_deleted:
        selected_shop = non_deleted[0]

    return {
        "needs_resolution": needs_resolution,
        "reason": reason,
        "tier": tier,
        "current_shop_id": current_shop_id,
        "current_shop_valid": current_valid,
        "selected_shop": await _downgrade_shop_payload(selected_shop) if selected_shop else None,
        "shops": [await _downgrade_shop_payload(s) for s in non_deleted],
        "summary": {
            "total": len(non_deleted),
            "manageable": len(manageable),
            "tier_suspended": len(tier_suspended),
            "shop_limit": shop_limit,
        },
    }


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
@router.get("/shops/downgrade-resolution")
async def get_downgrade_shop_resolution(request: Request):
    user = await _downgrade_require_user(request)
    return await _downgrade_resolution_payload(user)


# LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V1
@router.post("/shops/downgrade-resolution/select")
async def select_downgrade_shop(data: DowngradeShopSelectIn, request: Request):
    from datetime import datetime, timezone

    user = await _downgrade_require_user(request)
    user_id = _downgrade_user_id(user)
    email = _downgrade_user_email(user)
    shop_id = _downgrade_norm(data.shop_id)

    if not user_id:
        raise HTTPException(status_code=400, detail="User tidak valid")

    if not shop_id:
        raise HTTPException(status_code=400, detail="shop_id wajib diisi")

    tier = await _downgrade_effective_tier(user)
    shops = await _downgrade_get_owned_shops(user)
    non_deleted = [s for s in shops if not _downgrade_is_deleted_shop(s)]

    selected = None
    for shop in non_deleted:
        if shop.get("shop_id") == shop_id:
            selected = shop
            break

    if not selected:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan atau bukan milik user")

    now = datetime.now(timezone.utc).isoformat()
    shop_limit = int(tier.get("shop_limit") or 1)

    # Selalu perbaiki owner link untuk semua toko milik user yang match.
    all_shop_ids = [s.get("shop_id") for s in non_deleted if s.get("shop_id")]

    if all_shop_ids:
        await db.shops.update_many(
            {"shop_id": {"$in": all_shop_ids}},
            {
                "$set": {
                    "owner_user_id": user_id,
                    "owner_email": email,
                    "updated_at": now,
                }
            },
        )

    # Toko pilihan aktif kembali.
    await db.shops.update_one(
        {"shop_id": shop_id},
        {
            "$set": {
                "status": "active",
                "tier_suspended": False,
                "owner_user_id": user_id,
                "owner_email": email,
                "updated_at": now,
                "reactivated_reason": "selected_after_tier_downgrade",
            },
            "$unset": {
                "suspended_by": "",
                "suspended_reason": "",
                "suspended_at": "",
                "tier_suspended_at": "",
                "tier_suspended_reason": "",
            },
        },
    )

    # Kalau limit 1, toko lain ditangguhkan karena tier.
    suspended_ids = []
    if shop_limit <= 1:
        for shop in non_deleted:
            sid = shop.get("shop_id")
            if not sid or sid == shop_id:
                continue

            # Jangan override toko yang memang admin suspended/deleted.
            if _downgrade_is_deleted_shop(shop):
                continue

            old_status = shop.get("status") or "active"

            await db.shops.update_one(
                {"shop_id": sid},
                {
                    "$set": {
                        "status": "tier_suspended",
                        "tier_suspended": True,
                        "tier_suspended_at": now,
                        "tier_suspended_reason": "tier_downgrade_limit",
                        "suspended_by": "system",
                        "suspended_reason": "tier_downgrade_limit",
                        "status_before_tier_suspend": old_status,
                        "owner_user_id": user_id,
                        "owner_email": email,
                        "updated_at": now,
                    }
                },
            )
            suspended_ids.append(sid)

    selected_after = await db.shops.find_one({"shop_id": shop_id}, {"_id": 0}) or {}

    # Update current shop user supaya dashboard tidak /toko/undefined.
    user_filter = {"user_id": user_id}
    matched = await db.users.count_documents(user_filter)
    if not matched and email:
        user_filter = {"email": email}

    await db.users.update_one(
        user_filter,
        {
            "$set": {
                "shop_id": shop_id,
                "current_shop_id": shop_id,
                "selected_shop_id": shop_id,
                "active_shop_id": shop_id,  # LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V11
                "current_shop_slug": selected_after.get("slug") or "",
                "updated_at": now,
            }
        },
    )

    # Optional membership owner record.
    try:
        await db.shop_members.update_one(
            {"shop_id": shop_id, "user_id": user_id},
            {
                "$set": {
                    "shop_id": shop_id,
                    "user_id": user_id,
                    "email": email,
                    "role": "owner",
                    "status": "active",
                    "updated_at": now,
                },
                "$setOnInsert": {
                    "created_at": now,
                },
            },
            upsert=True,
        )
    except Exception:
        pass

    try:
        await db.shop_downgrade_events.insert_one({
            "event_type": "select_shop_after_downgrade",
            "user_id": user_id,
            "email": email,
            "selected_shop_id": shop_id,
            "suspended_shop_ids": suspended_ids,
            "tier": tier,
            "created_at": now,
        })
    except Exception:
        pass

    return {
        "ok": True,
        "selected_shop": await _downgrade_shop_payload(selected_after),
        "suspended_shop_ids": suspended_ids,
        "tier": tier,
        "resolution": await _downgrade_resolution_payload({
            **dict(user or {}),
            "shop_id": shop_id,
            "current_shop_id": shop_id,
            "selected_shop_id": shop_id,
            "active_shop_id": shop_id,  # LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_A_V11
        }),
    }


# LAPAKIN_TIER_SUSPENDED_RESTORE_PHASE_D1_V1
class RestoreTierSuspendedShopsIn(BaseModel):
    shop_ids: list[str] = []
    restore_all: bool = False


# LAPAKIN_TIER_SUSPENDED_RESTORE_PHASE_D1_V1
def _restore_tier_status_blocks_restore(tier):
    status = _downgrade_lower((tier or {}).get("status"))

    return status in {
        "expired",
        "suspended",
        "subscription_expired",
        "past_due",
        "unpaid",
        "inactive",
        "canceled",
        "cancelled",
    }


# LAPAKIN_TIER_SUSPENDED_RESTORE_PHASE_D1_V1
def _restore_is_restorable_tier_suspended_shop(shop):
    shop = shop or {}

    if not _downgrade_is_tier_suspended(shop):
        return False

    reason = _downgrade_lower(shop.get("tier_suspended_reason") or shop.get("suspended_reason"))
    if reason != "tier_downgrade_limit":
        return False

    status = _downgrade_lower(shop.get("status"))
    if status in {"deleted", "removed", "admin_suspended", "banned"}:
        return False

    return True


# LAPAKIN_TIER_SUSPENDED_RESTORE_PHASE_D1_V1
async def _restore_payload(user):
    tier = await _downgrade_effective_tier(user)
    shops = await _downgrade_get_owned_shops(user)

    non_deleted = [s for s in shops if not _downgrade_is_deleted_shop(s)]
    active_manageable = [s for s in non_deleted if _downgrade_is_manageable_shop(s)]
    restorable = [s for s in non_deleted if _restore_is_restorable_tier_suspended_shop(s)]

    shop_limit = int((tier or {}).get("shop_limit") or 1)
    plan_blocks_restore = _restore_tier_status_blocks_restore(tier)

    if plan_blocks_restore:
        remaining_slots = 0
        can_restore = False
        reason = "subscription_not_active"
    elif shop_limit >= 999:
        remaining_slots = len(restorable)
        can_restore = len(restorable) > 0
        reason = "" if can_restore else "no_restorable_shop"
    else:
        remaining_slots = max(0, shop_limit - len(active_manageable))
        can_restore = remaining_slots > 0 and len(restorable) > 0
        reason = "" if can_restore else ("shop_limit_reached" if restorable else "no_restorable_shop")

    return {
        "can_restore": can_restore,
        "reason": reason,
        "tier": tier,
        "summary": {
            "shop_limit": shop_limit,
            "active_manageable": len(active_manageable),
            "tier_suspended_restorable": len(restorable),
            "remaining_slots": remaining_slots,
        },
        "active_shops": [await _downgrade_shop_payload(s) for s in active_manageable],
        "restorable_shops": [await _downgrade_shop_payload(s) for s in restorable],
    }


# LAPAKIN_TIER_SUSPENDED_RESTORE_PHASE_D1_V1
@router.get("/shops/tier-suspended-restore")
async def get_tier_suspended_restore(request: Request):
    user = await _downgrade_require_user(request)
    return await _restore_payload(user)


# LAPAKIN_TIER_SUSPENDED_RESTORE_PHASE_D1_V1
@router.post("/shops/tier-suspended-restore")
async def restore_tier_suspended_shops(data: RestoreTierSuspendedShopsIn, request: Request):
    from datetime import datetime, timezone

    user = await _downgrade_require_user(request)
    user_id = _downgrade_user_id(user)
    email = _downgrade_user_email(user)

    if not user_id:
        raise HTTPException(status_code=400, detail="User tidak valid")

    payload = await _restore_payload(user)
    tier = payload.get("tier") or {}
    summary = payload.get("summary") or {}

    if not payload.get("can_restore"):
        raise HTTPException(
            status_code=403,
            detail="Paket saat ini belum bisa mengaktifkan toko tambahan.",
        )

    remaining_slots = int(summary.get("remaining_slots") or 0)
    restorable = payload.get("restorable_shops") or []
    restorable_ids = [s.get("shop_id") for s in restorable if s.get("shop_id")]

    requested_ids = [str(x).strip() for x in (data.shop_ids or []) if str(x).strip()]

    if data.restore_all:
        selected_ids = restorable_ids[:remaining_slots]
    else:
        selected_ids = requested_ids

    selected_ids = list(dict.fromkeys(selected_ids))

    if not selected_ids:
        raise HTTPException(status_code=400, detail="Pilih toko yang ingin diaktifkan.")

    invalid_ids = [sid for sid in selected_ids if sid not in restorable_ids]
    if invalid_ids:
        raise HTTPException(status_code=404, detail="Ada toko yang tidak bisa direstore.")

    if len(selected_ids) > remaining_slots:
        raise HTTPException(
            status_code=400,
            detail=f"Slot toko aktif tidak cukup. Maksimal restore {remaining_slots} toko.",
        )

    now = datetime.now(timezone.utc).isoformat()

    await db.shops.update_many(
        {"shop_id": {"$in": selected_ids}, "owner_user_id": user_id},
        {
            "$set": {
                "status": "active",
                "tier_suspended": False,
                "owner_user_id": user_id,
                "owner_email": email,
                "updated_at": now,
                "reactivated_reason": "tier_upgrade_restore",
                "reactivated_at": now,
            },
            "$unset": {
                "suspended_by": "",
                "suspended_reason": "",
                "suspended_at": "",
                "tier_suspended_at": "",
                "tier_suspended_reason": "",
            },
        },
    )

    # Kalau current shop kosong atau mengarah ke toko suspended, pastikan user tetap punya current shop aktif.
    current_shop_id = (
        user.get("current_shop_id")
        or user.get("selected_shop_id")
        or user.get("active_shop_id")
        or user.get("shop_id")
        or ""
    )

    current = await db.shops.find_one({"shop_id": current_shop_id, "owner_user_id": user_id}, {"_id": 0}) if current_shop_id else None
    current_ok = bool(current and _downgrade_is_manageable_shop(current))

    if not current_ok and selected_ids:
        selected = await db.shops.find_one({"shop_id": selected_ids[0]}, {"_id": 0}) or {}
        await db.users.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "shop_id": selected_ids[0],
                    "current_shop_id": selected_ids[0],
                    "selected_shop_id": selected_ids[0],
                    "active_shop_id": selected_ids[0],
                    "current_shop_slug": selected.get("slug") or "",
                    "updated_at": now,
                }
            },
        )

    try:
        await db.shop_downgrade_events.insert_one({
            "event_type": "restore_tier_suspended_after_upgrade",
            "user_id": user_id,
            "email": email,
            "restored_shop_ids": selected_ids,
            "tier": tier,
            "created_at": now,
        })
    except Exception:
        pass

    return {
        "ok": True,
        "restored_shop_ids": selected_ids,
        "tier": tier,
        "restore": await _restore_payload({
            **dict(user or {}),
            "user_id": user_id,
            "email": email,
        }),
    }

