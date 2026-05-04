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
