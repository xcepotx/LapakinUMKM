try:
    from deps import get_current_user
except Exception:
    get_current_user = None

from fastapi import Request, HTTPException
import json
"""
Lapakin Backend - AI-powered CMS for Indonesian SMEs (UMKM)

Thin aggregator: all endpoints live in `routes/*`. This file wires routers,
middleware, startup indexes, and admin seeding.
"""
import os
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware

from deps import db, client, logger, hash_password, verify_password
# Re-export for backward-compat with existing tests (e.g. `from server import _parse_product_text`).
from routes.whatsapp import _parse_product_text  # noqa: F401

from routes import ALL_ROUTERS
from pydantic import BaseModel


app = FastAPI(title="Lapakin API")
api = APIRouter(prefix="/api")

# Mount all feature routers onto the /api prefix
for _r in ALL_ROUTERS:
    api.include_router(_r)

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.shops.create_index("slug", unique=True)
    await db.shops.create_index("shop_id", unique=True)
    await db.shops.create_index("owner_user_id")
    await db.products.create_index("product_id", unique=True)
    await db.products.create_index("shop_id")
    await db.sales_entries.create_index("sale_id", unique=True)
    await db.sales_entries.create_index([("shop_id", 1), ("sale_date", -1)])
    await db.sales_entries.create_index([("user_id", 1), ("sale_month", 1)])
    await db.sales_entries.create_index([("shop_id", 1), ("payment_status", 1)])
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.password_reset_tokens.create_index("token", unique=True)
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.wa_pair_codes.create_index("code")
    await db.wa_pair_codes.create_index("expires_at", expireAfterSeconds=0)
    await db.wa_pair_codes.create_index("user_id", unique=True)
    await db.wa_links.create_index("user_id", unique=True)
    await db.wa_links.create_index("phone", unique=True)
    await db.team_invites.create_index([("email", 1), ("status", 1)])
    await db.team_invites.create_index([("shop_id", 1), ("status", 1)])
    await db.team_invites.create_index("invite_id", unique=True)
    await db.audit_logs.create_index("timestamp")
    await db.audit_logs.create_index("admin_user_id")
    await db.broadcasts.create_index("created_at")
    await db.broadcasts.create_index("active")
    await db.ai_usage.create_index("user_id")
    await db.ai_usage.create_index("timestamp")
    await db.ai_usage.create_index("kind")
    await db.monthly_usage.create_index(
        [("user_id", 1), ("year_month", 1), ("kind", 1)], unique=True
    )
    await db.storefront_visits.create_index([("shop_id", 1), ("timestamp", -1)])
    await db.analytics_events.create_index([("shop_id", 1), ("timestamp", -1)])
    await db.analytics_events.create_index([("shop_id", 1), ("event", 1)])
    await db.shops.create_index("custom_domain", sparse=True, unique=True)
    await db.payments.create_index("order_id", unique=True)
    await db.payments.create_index([("user_id", 1), ("created_at", -1)])
    await db.payments.create_index("status")

    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@lapakin.id").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "lapakin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": admin_email, "password_hash": hash_password(admin_password),
            "name": "Admin Lapakin", "picture": "", "auth_provider": "email",
            "shop_id": None, "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Admin user seeded: %s", admin_email)
    elif not verify_password(admin_password, existing.get("password_hash") or ""):
        await db.users.update_one(
            {"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}}
        )


@app.on_event("shutdown")
async def on_shutdown():
    client.close()




def _server_normalize_storefront_tier(user):
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


def _server_storefront_ai_allowed_for_tier(tier):
    return str(tier or "free").lower() in {"pro", "business"}

class ServerStorefrontCopyAIIn(BaseModel):
    shop_name: str = ""
    shop_description: str = ""
    business_category: str = ""
    instagram: str = ""
    tiktok: str = ""
    storefront_mode: str = "catalog"
    storefront_style: str = "classic"
    current: dict = {}


def _server_clean_storefront_copy(value, max_len=220):
    if value is None:
        return ""
    value = str(value).strip()
    value = " ".join(value.split())
    return value[:max_len]


def _server_fallback_storefront_copy(data: ServerStorefrontCopyAIIn):
    shop_name = _server_clean_storefront_copy(data.shop_name, 80) or "Toko Kamu"
    mode = data.storefront_mode or "catalog"
    style = data.storefront_style or "classic"
    description = _server_clean_storefront_copy(data.shop_description, 160)

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
        "storefront_hero_title": _server_clean_storefront_copy(hero_title, 90),
        "storefront_hero_subtitle": _server_clean_storefront_copy(hero_subtitle, 220),
        "storefront_cta_label": _server_clean_storefront_copy(cta_label, 36),
        "storefront_featured_title": _server_clean_storefront_copy(featured_title, 60),
        "storefront_about_title": _server_clean_storefront_copy(about_title, 80),
    }


async def _server_generate_storefront_copy(data: ServerStorefrontCopyAIIn):
    fallback = _server_fallback_storefront_copy(data)
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

        parsed = json.loads(response.choices[0].message.content or "{}")

        return {
            "storefront_hero_title": _server_clean_storefront_copy(parsed.get("storefront_hero_title") or fallback["storefront_hero_title"], 90),
            "storefront_hero_subtitle": _server_clean_storefront_copy(parsed.get("storefront_hero_subtitle") or fallback["storefront_hero_subtitle"], 220),
            "storefront_cta_label": _server_clean_storefront_copy(parsed.get("storefront_cta_label") or fallback["storefront_cta_label"], 36),
            "storefront_featured_title": _server_clean_storefront_copy(parsed.get("storefront_featured_title") or fallback["storefront_featured_title"], 60),
            "storefront_about_title": _server_clean_storefront_copy(parsed.get("storefront_about_title") or fallback["storefront_about_title"], 80),
        }, "ai"
    except Exception:
        return fallback, "fallback"


@app.post("/api/shops/storefront-copy-ai")
async def server_storefront_copy_ai(data: ServerStorefrontCopyAIIn, request: Request):
    if get_current_user is None:
        raise HTTPException(status_code=401, detail="Tidak terautentikasi")

    try:
        user = await get_current_user(request)
    except Exception:
        raise HTTPException(status_code=401, detail="Tidak terautentikasi")

    tier = _server_normalize_storefront_tier(user)

    if not _server_storefront_ai_allowed_for_tier(tier):
        raise HTTPException(
            status_code=403,
            detail="AI Enhance template tersedia mulai paket Pro.",
        )

    copy, source = await _server_generate_storefront_copy(data)
    return {
        "copy": copy,
        "source": source,
    }


