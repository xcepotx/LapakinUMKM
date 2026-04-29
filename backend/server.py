"""
Lapakin Backend - AI-powered CMS for Indonesian SMEs (UMKM)
"""
from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import uuid
import time
import base64
import hashlib
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import bcrypt
import jwt as pyjwt
import httpx
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, HTMLResponse, Response as FastResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from PIL import Image, ImageDraw, ImageFont
from io import BytesIO

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

from tiers import (
    TIER_LIMITS, VALID_TIERS, get_tier, get_limits, current_month_bucket,
    get_usage, increment_usage, check_quota, require_feature, is_unlimited,
)

# ----------- Setup -----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']

# Optional Twilio config (WhatsApp Bot — works without these but bot will be disabled)
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_WHATSAPP_FROM = os.environ.get("TWILIO_WHATSAPP_FROM", "")  # e.g. "whatsapp:+14155238886" (sandbox)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("lapakin")

app = FastAPI(title="Lapakin API")
api = APIRouter(prefix="/api")

# ----------- Auth helpers -----------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "type": "access",
               "exp": datetime.now(timezone.utc) + timedelta(days=7)}
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def slugify(text: str) -> str:
    text = re.sub(r'[^a-zA-Z0-9\s-]', '', text or '').strip().lower()
    text = re.sub(r'[\s_-]+', '-', text)
    return text[:40] or f"toko-{uuid.uuid4().hex[:6]}"

async def get_user_from_token(request: Request) -> Optional[dict]:
    """Read auth from cookie 'access_token' (JWT) OR 'session_token' (Google),
    or Authorization Bearer header."""
    # 1. Try JWT access_token cookie
    token = request.cookies.get("access_token")
    if token:
        try:
            payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            if payload.get("type") == "access":
                user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
                if user:
                    return user
        except pyjwt.PyJWTError:
            pass

    # 2. Try Google session_token cookie
    sess_token = request.cookies.get("session_token")
    if sess_token:
        sess = await db.user_sessions.find_one({"session_token": sess_token}, {"_id": 0})
        if sess:
            expires_at = sess.get("expires_at")
            if isinstance(expires_at, str):
                expires_at = datetime.fromisoformat(expires_at)
            if expires_at and expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at and expires_at > datetime.now(timezone.utc):
                user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0, "password_hash": 0})
                if user:
                    return user

    # 3. Authorization Bearer (JWT)
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        bearer = auth_header[7:]
        try:
            payload = pyjwt.decode(bearer, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            if payload.get("type") == "access":
                user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
                if user:
                    return user
        except pyjwt.PyJWTError:
            pass
    return None

async def require_user(request: Request) -> dict:
    user = await get_user_from_token(request)
    if not user:
        raise HTTPException(status_code=401, detail="Tidak terautentikasi")
    return user

async def require_admin(request: Request) -> dict:
    user = await require_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Akses admin saja")
    return user

async def log_admin_action(admin: dict, action: str, target_type: str = "", target_id: str = "", meta: Optional[dict] = None):
    await db.audit_logs.insert_one({
        "log_id": f"log_{uuid.uuid4().hex[:12]}",
        "admin_user_id": admin["user_id"],
        "admin_email": admin["email"],
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "meta": meta or {},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

async def track_ai_usage(user_id: str, kind: str):
    """Record an AI call for analytics + monthly tier usage. Best-effort, never raises."""
    try:
        await db.ai_usage.insert_one({
            "user_id": user_id, "kind": kind,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        # Map AI kind → monthly usage bucket for tier enforcement
        bucket = {
            "enhance": "ai_photo",
            "content": "ai_copy",
            "theme": "ai_copy",
            "cover": "ai_cover",
            "about": "ai_copy",
        }.get(kind)
        if bucket:
            await increment_usage(db.monthly_usage, user_id, bucket)
    except Exception:
        pass

# ----------- Models -----------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    auth_provider: str
    shop_id: Optional[str] = None

class ShopIn(BaseModel):
    name: str
    tagline: Optional[str] = ""
    description: Optional[str] = ""
    business_type: str  # kuliner / kopi / fashion / kerajinan / kecantikan / lainnya
    whatsapp: Optional[str] = ""
    brand_color: Optional[str] = "#C04A3B"
    logo_url: Optional[str] = ""
    # New (Storefront Pro)
    cover_image: Optional[str] = ""           # base64 data URL
    about: Optional[str] = ""                 # AI-generated story
    hours: Optional[str] = ""                 # e.g., "Senin-Sabtu 08:00-21:00"
    address: Optional[str] = ""
    instagram: Optional[str] = ""             # handle without @
    tiktok: Optional[str] = ""                # handle without @
    shopee: Optional[str] = ""                # URL
    promo_active: Optional[bool] = False
    promo_title: Optional[str] = ""
    promo_description: Optional[str] = ""
    promo_code: Optional[str] = ""
    story: List[dict] = []                    # [{image, caption}] max 5
    # Sales mode (Iteration 7)
    sells_by: Optional[str] = "stock"         # "stock" | "hours" | "always"
    is_open: Optional[bool] = True            # only relevant when sells_by == "hours"
    # Auto-schedule (Iteration 8) — 7 entries idx 0=Senin..6=Minggu.
    # Each entry: {"open": "HH:MM", "close": "HH:MM"} or None/empty = tutup hari itu.
    auto_schedule_enabled: Optional[bool] = False
    schedule: List[Optional[dict]] = []

class ShopOut(ShopIn):
    shop_id: str
    slug: str
    owner_user_id: str
    created_at: str

class ProductIn(BaseModel):
    name: str
    price: int = Field(ge=0)
    stock: int = Field(ge=0, default=0)
    description: Optional[str] = ""
    image_data: Optional[str] = ""  # primary image (kept for backward compat — first item of images)
    images: List[str] = []           # all images (data URLs or base64)
    ig_caption: Optional[str] = ""
    tiktok_caption: Optional[str] = ""
    hashtags: List[str] = []
    # Per-product day availability (Iteration 7) — empty list = setiap hari.
    # 0=Senin … 6=Minggu (Python's weekday() convention).
    available_days: List[int] = []

class ProductOut(ProductIn):
    product_id: str
    shop_id: str
    created_at: str

class GoogleSessionIn(BaseModel):
    session_id: str

class AIContentIn(BaseModel):
    product_name: str
    business_type: Optional[str] = ""
    shop_name: Optional[str] = ""
    extra_hints: Optional[str] = ""

class AIThemeIn(BaseModel):
    business_type: str
    shop_name: str

class AIAboutIn(BaseModel):
    shop_name: str
    business_type: str
    tagline: Optional[str] = ""
    description: Optional[str] = ""

class AICoverIn(BaseModel):
    shop_name: str
    business_type: str
    style: Optional[str] = "warm"  # warm / minimal / vibrant

class AIEnhanceIn(BaseModel):
    image_base64: str  # raw base64, no data: prefix
    style: Optional[str] = "clean"  # clean / lifestyle / minimal

# ----------- Auth Endpoints -----------
@api.post("/auth/register")
async def register(data: RegisterIn, response: Response):
    email = data.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email sudah terdaftar")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user_doc = {
        "user_id": user_id,
        "email": email,
        "password_hash": hash_password(data.password),
        "name": data.name.strip(),
        "picture": "",
        "auth_provider": "email",
        "shop_id": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user_doc)
    token = create_access_token(user_id, email)
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none",
                        max_age=7 * 24 * 3600, path="/")
    return {"user_id": user_id, "email": email, "name": data.name, "picture": "",
            "auth_provider": "email", "shop_id": None, "access_token": token}

@api.post("/auth/login")
async def login(data: LoginIn, response: Response):
    email = data.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email atau password salah")
    token = create_access_token(user["user_id"], email)
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none",
                        max_age=7 * 24 * 3600, path="/")
    return {"user_id": user["user_id"], "email": email, "name": user.get("name"),
            "picture": user.get("picture", ""), "auth_provider": user.get("auth_provider", "email"),
            "shop_id": user.get("shop_id"),
            "role": user.get("role", "user"), "tier": user.get("tier", "free"),
            "access_token": token}

@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    # Clear both cookies
    response.delete_cookie("access_token", path="/")
    sess_token = request.cookies.get("session_token")
    if sess_token:
        await db.user_sessions.delete_one({"session_token": sess_token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}

@api.get("/auth/me")
async def get_me(request: Request):
    user = await require_user(request)
    return {"user_id": user["user_id"], "email": user["email"], "name": user.get("name"),
            "picture": user.get("picture", ""), "auth_provider": user.get("auth_provider", "email"),
            "shop_id": user.get("shop_id"), "role": user.get("role", "user"),
            "tier": user.get("tier", "free")}

@api.post("/auth/google/session")
async def google_session(data: GoogleSessionIn, response: Response):
    """Exchange Emergent OAuth session_id for our session_token cookie."""
    async with httpx.AsyncClient(timeout=15) as cx:
        r = await cx.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": data.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Sesi Google tidak valid")
    info = r.json()
    email = (info.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="Email Google tidak ditemukan")

    # Find or create user
    user = await db.users.find_one({"email": email})
    if user:
        # Link Google to existing account
        update = {"picture": info.get("picture") or user.get("picture", "")}
        if user.get("auth_provider") == "email":
            update["auth_provider"] = "both"
        elif not user.get("auth_provider"):
            update["auth_provider"] = "google"
        if not user.get("name"):
            update["name"] = info.get("name") or email.split("@")[0]
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
        user_id = user["user_id"]
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id, "email": email, "name": info.get("name") or email.split("@")[0],
            "picture": info.get("picture") or "", "auth_provider": "google",
            "shop_id": None, "created_at": datetime.now(timezone.utc).isoformat(),
        })

    # Create session token doc (use the one from Emergent if provided, else generate)
    sess_token = info.get("session_token") or secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id, "session_token": sess_token, "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc),
    })
    response.set_cookie("session_token", sess_token, httponly=True, secure=True, samesite="none",
                        max_age=7 * 24 * 3600, path="/")
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return {"user_id": user_doc["user_id"], "email": user_doc["email"], "name": user_doc.get("name"),
            "picture": user_doc.get("picture", ""), "auth_provider": user_doc.get("auth_provider"),
            "shop_id": user_doc.get("shop_id")}

# ----------- Forgot Password (simple mode: token returned in response) -----------
class ForgotIn(BaseModel):
    email: EmailStr

class ResetIn(BaseModel):
    token: str
    new_password: str = Field(min_length=6)

@api.post("/auth/forgot-password")
async def forgot_password(data: ForgotIn):
    """Simple-mode reset: token is returned in response (and logged) so the
    UI can show a copyable reset link. In production swap to email send."""
    email = data.email.lower().strip()
    user = await db.users.find_one({"email": email})
    # Always return same shape to avoid email enumeration; only generate token if user exists
    if not user:
        return {"ok": True, "message": "Jika email terdaftar, link reset akan diberikan."}
    token = secrets.token_urlsafe(32)
    await db.password_reset_tokens.insert_one({
        "token": token,
        "user_id": user["user_id"],
        "email": email,
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        "used": False,
        "created_at": datetime.now(timezone.utc),
    })
    logger.info("Password reset token generated for %s", email)
    return {"ok": True, "message": "Token reset berhasil dibuat.",
            "reset_token": token, "expires_in_minutes": 60,
            "simple_mode": True}

@api.post("/auth/reset-password")
async def reset_password(data: ResetIn):
    rec = await db.password_reset_tokens.find_one({"token": data.token, "used": False})
    if not rec:
        raise HTTPException(status_code=400, detail="Token tidak valid atau sudah dipakai")
    expires_at = rec.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Token sudah kadaluarsa")
    new_hash = hash_password(data.new_password)
    await db.users.update_one({"user_id": rec["user_id"]},
                              {"$set": {"password_hash": new_hash, "auth_provider": "both" if (await db.users.find_one({"user_id": rec["user_id"]}) or {}).get("auth_provider") == "google" else "email"}})
    await db.password_reset_tokens.update_one({"token": data.token}, {"$set": {"used": True}})
    return {"ok": True, "message": "Password berhasil di-reset."}

# ----------- Shops -----------
@api.get("/shops/me")
async def get_my_shop(request: Request):
    user = await require_user(request)
    if not user.get("shop_id"):
        return None
    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    return shop

@api.post("/shops/me")
async def create_or_update_shop(data: ShopIn, request: Request):
    user = await require_user(request)
    now = datetime.now(timezone.utc).isoformat()
    payload = data.model_dump()
    if user.get("shop_id"):
        # update
        await db.shops.update_one(
            {"shop_id": user["shop_id"]},
            {"$set": {**payload, "updated_at": now}}
        )
        # Invalidate OG image cache (cover/brand/name/tagline may have changed)
        _OG_PNG_CACHE.pop(user["shop_id"], None)
        shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
        return shop
    # On first creation, smart-default sells_by based on business_type
    # if user didn't pick anything (defaults to "stock" otherwise).
    if payload.get("sells_by") in (None, "", "stock"):
        bt = (payload.get("business_type") or "").lower()
        if bt in ("kuliner", "kopi"):
            payload["sells_by"] = "hours"
            payload["is_open"] = True
    # create with unique slug
    base_slug = slugify(data.name)
    slug = base_slug
    n = 1
    while await db.shops.find_one({"slug": slug}):
        n += 1
        slug = f"{base_slug}-{n}"
    shop_id = f"shop_{uuid.uuid4().hex[:12]}"
    doc = {
        "shop_id": shop_id, "slug": slug, "owner_user_id": user["user_id"],
        **payload, "created_at": now,
    }
    await db.shops.insert_one(doc)
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"shop_id": shop_id}})
    return {k: v for k, v in doc.items() if k != "_id"}

@api.post("/shops/me/toggle-open")
async def toggle_shop_open(request: Request):
    """Quick toggle for shop is_open flag (used by F&B mode='hours' toko)."""
    user = await require_user(request)
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")
    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")
    new_state = not bool(shop.get("is_open", True))
    await db.shops.update_one(
        {"shop_id": user["shop_id"]},
        {"$set": {"is_open": new_state, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"is_open": new_state}

@api.get("/shops/by-slug/{slug}")
async def get_shop_public(slug: str):
    shop = await db.shops.find_one({"slug": slug}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")
    if shop.get("status") == "suspended":
        raise HTTPException(status_code=404, detail="Toko tidak tersedia")
    products = await db.products.find({"shop_id": shop["shop_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    # Compute live schedule status (mode=hours + auto_schedule_enabled).
    schedule_status = compute_schedule_status(shop)
    if schedule_status.get("auto"):
        # Override is_open with auto-computed value when auto-schedule is enabled.
        shop["is_open"] = bool(schedule_status.get("is_open_now"))
    shop["schedule_status"] = schedule_status
    # Inject owner's tier capabilities for storefront-side branding decisions.
    owner = await db.users.find_one({"user_id": shop.get("owner_user_id")}, {"_id": 0, "tier": 1})
    owner_tier = (owner or {}).get("tier") or "free"
    shop["owner_tier"] = owner_tier
    shop["remove_branding"] = bool(get_limits(owner_tier).get("remove_branding"))
    return {"shop": shop, "products": products}

# ----------- Open Graph (dynamic share preview per toko) -----------
# Simple in-memory cache: shop_id → (png_bytes, cover_hash, timestamp)
# This makes WhatsApp/FB OG image fetches near-instant even when shop has a
# large base64 cover_image. Cache invalidates when cover changes.
_OG_PNG_CACHE: dict = {}
_OG_CACHE_TTL = 600  # 10 minutes

def _cover_hash(cover: str) -> str:
    if not cover:
        return ""
    return hashlib.md5(cover[:200].encode("utf-8", errors="ignore")).hexdigest()[:12]

def _hex_to_rgb(hex_color: str) -> tuple:
    h = (hex_color or "#C04A3B").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
    except Exception:
        return (192, 74, 59)

def _generate_fallback_og_image(shop_name: str, tagline: str, brand_hex: str) -> bytes:
    """Generate a 1200x630 OG image when shop has no cover_image."""
    W, H = 1200, 630
    bg = _hex_to_rgb(brand_hex)
    img = Image.new("RGB", (W, H), bg)
    draw = ImageDraw.Draw(img)

    # Soft gradient overlay (radial-ish)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for i in range(120):
        alpha = int(60 * (1 - i / 120))
        od.ellipse((W - 600 - i, -300 - i, W + 200 + i, 300 + i), fill=(255, 255, 255, alpha))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)

    # Try to load a decent font, fall back to default
    def _try_font(size: int):
        for path in [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]:
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
        return ImageFont.load_default()

    title_font = _try_font(96)
    tag_font = _try_font(40)
    small_font = _try_font(28)

    # Avatar circle with first letter
    initial = (shop_name or "L")[0].upper()
    cx, cy, r = 130, 130, 60
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255))
    bbox = draw.textbbox((0, 0), initial, font=_try_font(70))
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((cx - tw / 2, cy - th / 2 - 10), initial, fill=bg, font=_try_font(70))

    # Shop name (wrap if too long)
    name = (shop_name or "Toko Lapakin")[:40]
    draw.text((90, 240), name, fill=(255, 255, 255), font=title_font)

    if tagline:
        tag = tagline[:80]
        draw.text((90, 360), tag, fill=(255, 255, 255, 220), font=tag_font)

    # Footer brand line
    draw.text((90, 540), "Lapakin · Toko online UMKM Indonesia", fill=(255, 255, 255, 200), font=small_font)

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()

def _decode_data_url_png(data_url: str) -> Optional[bytes]:
    """Convert base64 data URL (any image type) to PNG bytes resized to 1200x630."""
    try:
        if not data_url:
            return None
        if "," in data_url:
            data_url = data_url.split(",", 1)[1]
        raw = base64.b64decode(data_url)
        img = Image.open(BytesIO(raw)).convert("RGB")
        # Resize/crop to 1200x630 (FB recommended)
        target_ratio = 1200 / 630
        w, h = img.size
        ratio = w / h
        if ratio > target_ratio:
            new_w = int(h * target_ratio)
            left = (w - new_w) // 2
            img = img.crop((left, 0, left + new_w, h))
        else:
            new_h = int(w / target_ratio)
            top = (h - new_h) // 2
            img = img.crop((0, top, w, top + new_h))
        img = img.resize((1200, 630), Image.LANCZOS)
        out = BytesIO()
        img.save(out, format="PNG", optimize=True)
        return out.getvalue()
    except Exception as e:
        logger.warning(f"Failed to decode cover image: {e}")
        return None

@api.get("/og/shop/{slug}.png")
async def og_image(slug: str):
    """Serve a 1200x630 PNG suitable for OpenGraph preview.
    Uses in-memory cache to keep WhatsApp/FB crawler fetches near-instant
    (decoding a large base64 cover_image takes 200-800ms — too slow for
    WA's ~2-3s timeout window)."""
    shop = await db.shops.find_one({"slug": slug}, {"_id": 0})
    if not shop or shop.get("status") == "suspended":
        png = _generate_fallback_og_image("Lapakin", "Toko online UMKM Indonesia", "#C04A3B")
        return FastResponse(
            content=png, media_type="image/png",
            headers={"Cache-Control": "public, max-age=300"},
        )

    shop_id = shop.get("shop_id")
    cover = shop.get("cover_image") or ""
    chash = _cover_hash(cover) + (shop.get("brand_color") or "") + (shop.get("name") or "") + (shop.get("tagline") or "")
    cached = _OG_PNG_CACHE.get(shop_id)
    now = time.time()
    if cached and cached[1] == chash and (now - cached[2]) < _OG_CACHE_TTL:
        return FastResponse(content=cached[0], media_type="image/png",
                            headers={"Cache-Control": "public, max-age=600", "X-Cache": "HIT"})

    png = _decode_data_url_png(cover) if cover else None
    if not png:
        png = _generate_fallback_og_image(
            shop.get("name") or "Toko",
            shop.get("tagline") or "",
            shop.get("brand_color") or "#C04A3B",
        )
    _OG_PNG_CACHE[shop_id] = (png, chash, now)
    # Cap cache size — drop oldest entry if >100 shops cached.
    if len(_OG_PNG_CACHE) > 100:
        oldest_id = min(_OG_PNG_CACHE.keys(), key=lambda k: _OG_PNG_CACHE[k][2])
        _OG_PNG_CACHE.pop(oldest_id, None)

    return FastResponse(
        content=png, media_type="image/png",
        headers={"Cache-Control": "public, max-age=600", "X-Cache": "MISS"},
    )

def _esc(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

def _public_base_url(request: Request) -> str:
    """Build the externally-visible base URL, honouring X-Forwarded-* headers."""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "https"
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    # Prefer https in production for OG/social crawlers
    if "preview.emergent" in host or "lapakin" in host or "." in host:
        proto = "https"
    return f"{proto}://{host}"

@api.get("/og/shop/{slug}")
async def og_html(slug: str, request: Request):
    """Return HTML page with full OpenGraph + Twitter Card meta tags.
    Crawlers (WhatsApp, Facebook, Twitter, Telegram, LinkedIn, Slack, Discord)
    fetch this page to render rich previews; humans get redirected to the
    React storefront via meta-refresh + JS."""
    shop = await db.shops.find_one({"slug": slug}, {"_id": 0})
    base = _public_base_url(request)
    if not shop or shop.get("status") == "suspended":
        title = "Toko tidak ditemukan · Lapakin"
        desc = "Toko UMKM ini sudah tidak tersedia di Lapakin."
        og_img_url = ""
    else:
        title = f"{shop.get('name') or 'Toko'} · Lapakin"
        desc = (shop.get("tagline") or shop.get("description")
                or shop.get("about") or "Toko online UMKM Indonesia di Lapakin.")[:200]
        og_img_url = f"{base}/api/og/shop/{slug}.png"

    canonical = f"{base}/toko/{slug}"
    html = f"""<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>{_esc(title)}</title>
<meta name="description" content="{_esc(desc)}" />
<link rel="canonical" href="{canonical}" />
<!-- Open Graph -->
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Lapakin" />
<meta property="og:title" content="{_esc(title)}" />
<meta property="og:description" content="{_esc(desc)}" />
<meta property="og:url" content="{canonical}" />
{f'<meta property="og:image" content="{og_img_url}" />' if og_img_url else ''}
{'<meta property="og:image:width" content="1200" />' if og_img_url else ''}
{'<meta property="og:image:height" content="630" />' if og_img_url else ''}
<meta property="og:locale" content="id_ID" />
<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{_esc(title)}" />
<meta name="twitter:description" content="{_esc(desc)}" />
{f'<meta name="twitter:image" content="{og_img_url}" />' if og_img_url else ''}
</head>
<body>
<p>Mengarahkan ke <a href="{canonical}">{_esc(title)}</a>…</p>
<!-- JS redirect (bots don't execute JS, so they stay here and read the OG tags;
     human browsers execute it and get to the React storefront).
     We intentionally REMOVED <meta http-equiv="refresh"> because some bots
     (Facebook, LinkedIn) follow it and end up at the React index.html with
     the root OG tags, which is wrong. -->
<script>setTimeout(function(){{window.location.replace({canonical!r});}},10);</script>
</body>
</html>"""
    return HTMLResponse(content=html, headers={"Cache-Control": "public, max-age=300"})

# ----------- Auto-schedule helpers (Iteration 8) -----------
JAKARTA_OFFSET = timedelta(hours=7)  # WIB

def _now_jakarta() -> datetime:
    return datetime.now(timezone.utc) + JAKARTA_OFFSET

def _parse_hhmm(s: str) -> Optional[tuple]:
    """Parse 'HH:MM' → (hour, minute). Returns None on failure."""
    if not s or not isinstance(s, str):
        return None
    try:
        parts = s.strip().split(":")
        if len(parts) != 2:
            return None
        h, m = int(parts[0]), int(parts[1])
        if 0 <= h <= 23 and 0 <= m <= 59:
            return (h, m)
    except Exception:
        return None
    return None

def compute_schedule_status(shop: dict) -> dict:
    """Given a shop doc, compute live open/close status from schedule + Jakarta time.
    Returns dict {is_open_now, opens_at, closes_at, next_change_in_minutes}.
    Only meaningful when shop.sells_by=='hours' and shop.auto_schedule_enabled==True."""
    if not shop:
        return {"is_open_now": False}
    if (shop.get("sells_by") or "stock") != "hours":
        return {"is_open_now": True, "auto": False}
    if not shop.get("auto_schedule_enabled"):
        return {"is_open_now": bool(shop.get("is_open", True)), "auto": False}

    schedule = shop.get("schedule") or []
    now = _now_jakarta()
    today_idx = now.weekday()  # 0=Mon..6=Sun
    today_min = now.hour * 60 + now.minute

    today_entry = schedule[today_idx] if today_idx < len(schedule) else None
    is_open_now = False
    closes_at = None
    if today_entry and isinstance(today_entry, dict):
        op = _parse_hhmm(today_entry.get("open", ""))
        cl = _parse_hhmm(today_entry.get("close", ""))
        if op and cl:
            op_min = op[0] * 60 + op[1]
            cl_min = cl[0] * 60 + cl[1]
            if op_min <= today_min < cl_min:
                is_open_now = True
                closes_at = today_entry["close"]

    # Find next opening (look ahead up to 7 days)
    opens_at = None
    if not is_open_now:
        for offset in range(0, 8):
            d_idx = (today_idx + offset) % 7
            entry = schedule[d_idx] if d_idx < len(schedule) else None
            if not entry or not isinstance(entry, dict):
                continue
            op = _parse_hhmm(entry.get("open", ""))
            if not op:
                continue
            op_min = op[0] * 60 + op[1]
            if offset == 0 and op_min <= today_min:
                continue  # today already passed open time
            day_label = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"][d_idx]
            opens_at = f"{day_label} {entry['open']}" if offset > 0 else entry["open"]
            break

    return {
        "is_open_now": is_open_now,
        "auto": True,
        "opens_at": opens_at,
        "closes_at": closes_at,
    }

# ----------- Toko Cards Generator (Iteration 8) -----------
def _try_font_path(size: int):
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()

def _try_regular_font(size: int):
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()

def _wrap_text(text: str, font, max_width: int, draw):
    """Word-wrap text to fit max_width, returning list of lines."""
    if not text:
        return []
    words = text.split()
    lines, cur = [], ""
    for w in words:
        candidate = (cur + " " + w).strip()
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if (bbox[2] - bbox[0]) <= max_width:
            cur = candidate
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines

def _decode_image(data_url_or_b64: str) -> Optional[Image.Image]:
    if not data_url_or_b64:
        return None
    try:
        s = data_url_or_b64
        if "," in s and s.startswith("data:"):
            s = s.split(",", 1)[1]
        raw = base64.b64decode(s)
        return Image.open(BytesIO(raw)).convert("RGB")
    except Exception:
        return None

def _render_product_card(product: dict, shop: dict, format_type: str) -> bytes:
    """Render product as IG post (1080x1080) or story (1080x1920)."""
    brand_rgb = _hex_to_rgb(shop.get("brand_color") or "#C04A3B")
    shop_name = shop.get("name") or "Toko"
    product_name = product.get("name") or "Produk"
    price = product.get("price") or 0
    tagline = (shop.get("tagline") or "")[:80]

    # Pick first image
    imgs = product.get("images") or ([product["image_data"]] if product.get("image_data") else [])
    primary = _decode_image(imgs[0]) if imgs else None

    if format_type == "post":
        W, H = 1080, 1080
        img_h = 700  # photo area height
    else:  # story
        W, H = 1080, 1920
        img_h = 1300

    canvas = Image.new("RGB", (W, H), brand_rgb)

    # Photo area: object-cover fill into top portion
    if primary:
        pw, ph = primary.size
        target_ratio = W / img_h
        ratio = pw / ph
        if ratio > target_ratio:
            new_w = int(ph * target_ratio)
            left = (pw - new_w) // 2
            primary = primary.crop((left, 0, left + new_w, ph))
        else:
            new_h = int(pw / target_ratio)
            top = (ph - new_h) // 2
            primary = primary.crop((0, top, pw, top + new_h))
        primary = primary.resize((W, img_h), Image.LANCZOS)
        canvas.paste(primary, (0, 0))
    else:
        # Branded gradient placeholder
        draw_p = ImageDraw.Draw(canvas)
        for y in range(img_h):
            mix = y / img_h
            r = int(brand_rgb[0] * (1 - mix * 0.2))
            g = int(brand_rgb[1] * (1 - mix * 0.2))
            b = int(brand_rgb[2] * (1 - mix * 0.2))
            draw_p.line([(0, y), (W, y)], fill=(r, g, b))

    # Bottom white panel with content
    panel = Image.new("RGB", (W, H - img_h), (255, 255, 255))
    canvas.paste(panel, (0, img_h))
    draw = ImageDraw.Draw(canvas)

    # Top brand strip on photo
    strip_h = 80
    strip = Image.new("RGBA", (W, strip_h), (0, 0, 0, 100))
    canvas.paste(Image.alpha_composite(canvas.crop((0, 0, W, strip_h)).convert("RGBA"), strip), (0, 0))
    draw_strip = ImageDraw.Draw(canvas)
    initial = (shop_name or "L")[0].upper()
    cx, cy, r = 50, strip_h // 2, 24
    draw_strip.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255))
    bbox = draw_strip.textbbox((0, 0), initial, font=_try_font_path(28))
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw_strip.text((cx - tw / 2, cy - th / 2 - 3), initial, fill=brand_rgb, font=_try_font_path(28))
    draw_strip.text((90, cy - 18), shop_name[:28], fill=(255, 255, 255), font=_try_font_path(32))

    # Bottom content
    pad_x = 60
    content_y = img_h + 50
    name_font = _try_font_path(64 if format_type == "post" else 80)
    price_font = _try_font_path(80 if format_type == "post" else 100)
    tag_font = _try_regular_font(28 if format_type == "post" else 36)
    foot_font = _try_regular_font(24 if format_type == "post" else 30)

    # Wrap product name to 2 lines max
    name_lines = _wrap_text(product_name, name_font, W - 2 * pad_x, draw)[:2]
    for i, line in enumerate(name_lines):
        draw.text((pad_x, content_y + i * (name_font.size + 8)), line, fill=(30, 30, 30), font=name_font)
    content_y += len(name_lines) * (name_font.size + 8) + 25

    # Price
    price_text = f"Rp {price:,}".replace(",", ".")
    draw.text((pad_x, content_y), price_text, fill=brand_rgb, font=price_font)
    content_y += price_font.size + 30

    # Tagline (if room)
    if tagline:
        tag_lines = _wrap_text(tagline, tag_font, W - 2 * pad_x, draw)[:2]
        for i, line in enumerate(tag_lines):
            draw.text((pad_x, content_y + i * (tag_font.size + 6)), line, fill=(110, 110, 110), font=tag_font)

    # Footer: "powered by Lapakin · /toko/<slug>"
    footer_text = f"lapakin.id/toko/{shop.get('slug', '')}"
    fb = draw.textbbox((0, 0), footer_text, font=foot_font)
    fw = fb[2] - fb[0]
    draw.text((W - pad_x - fw, H - 50 - foot_font.size), footer_text, fill=(160, 160, 160), font=foot_font)

    buf = BytesIO()
    canvas.save(buf, format="PNG", optimize=True)
    return buf.getvalue()

@api.get("/og/product/{product_id}/post.png")
async def product_card_post(product_id: str):
    product = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    shop = await db.shops.find_one({"shop_id": product.get("shop_id")}, {"_id": 0}) or {}
    png = _render_product_card(product, shop, "post")
    return FastResponse(content=png, media_type="image/png",
                        headers={"Cache-Control": "public, max-age=600"})

@api.get("/og/product/{product_id}/story.png")
async def product_card_story(product_id: str):
    product = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    shop = await db.shops.find_one({"shop_id": product.get("shop_id")}, {"_id": 0}) or {}
    png = _render_product_card(product, shop, "story")
    return FastResponse(content=png, media_type="image/png",
                        headers={"Cache-Control": "public, max-age=600"})

# ----------- Products -----------
@api.get("/products")
async def list_my_products(request: Request):
    user = await require_user(request)
    if not user.get("shop_id"):
        return []
    products = await db.products.find({"shop_id": user["shop_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return products

@api.post("/products")
async def create_product(data: ProductIn, request: Request):
    user = await require_user(request)
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Toko belum dibuat")
    # Tier limit: max products
    limits = get_limits(get_tier(user))
    if not is_unlimited(limits["max_products"]):
        cur_count = await db.products.count_documents({"shop_id": user["shop_id"]})
        if cur_count >= limits["max_products"]:
            raise HTTPException(
                status_code=402,
                detail=f"Tier {get_tier(user)} dibatasi {limits['max_products']} produk. Upgrade ke Pro untuk hingga 100 produk.",
            )
    product_id = f"prod_{uuid.uuid4().hex[:12]}"
    payload = data.model_dump()
    # sync images <-> image_data
    if not payload.get("images") and payload.get("image_data"):
        payload["images"] = [payload["image_data"]]
    elif payload.get("images") and not payload.get("image_data"):
        payload["image_data"] = payload["images"][0]
    doc = {
        "product_id": product_id, "shop_id": user["shop_id"],
        **payload,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.products.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@api.put("/products/{product_id}")
async def update_product(product_id: str, data: ProductIn, request: Request):
    user = await require_user(request)
    p = await db.products.find_one({"product_id": product_id})
    if not p or p["shop_id"] != user.get("shop_id"):
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    payload = data.model_dump()
    if not payload.get("images") and payload.get("image_data"):
        payload["images"] = [payload["image_data"]]
    elif payload.get("images") and not payload.get("image_data"):
        payload["image_data"] = payload["images"][0]
    await db.products.update_one({"product_id": product_id}, {"$set": payload})
    updated = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    return updated

@api.delete("/products/{product_id}")
async def delete_product(product_id: str, request: Request):
    user = await require_user(request)
    p = await db.products.find_one({"product_id": product_id})
    if not p or p["shop_id"] != user.get("shop_id"):
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    await db.products.delete_one({"product_id": product_id})
    return {"ok": True}

# ----------- AI Endpoints -----------
def _new_chat(session_id: str, system_message: str) -> LlmChat:
    return LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system_message)

@api.post("/ai/enhance-image")
async def ai_enhance_image(data: AIEnhanceIn, request: Request):
    user = await require_user(request)
    await check_quota(db.monthly_usage, user, "ai_photo", "ai_photo_per_month")
    # Strip data URL prefix if present
    img_b64 = data.image_base64
    if img_b64.startswith("data:"):
        img_b64 = img_b64.split(",", 1)[-1]

    style_hint = {
        "clean": "clean studio backdrop in soft warm cream color (#FDFBF7), bright even soft lighting, slight shadow, professional product photography",
        "lifestyle": "warm lifestyle context with natural wooden surface and soft window light, cozy Indonesian cafe vibe, shallow depth of field",
        "minimal": "pure minimal background, off-white seamless paper, sharp focus, high-key e-commerce style",
    }.get(data.style or "clean", "clean white background, professional lighting")

    prompt = (
        f"Reimagine this product photo as a professional product shot for an Indonesian online shop. "
        f"Keep the EXACT same product unchanged in shape, color, branding and details. "
        f"Improve lighting and place it on {style_hint}. "
        f"Make the product look attractive, sharp, and ready for e-commerce. "
        f"Output a single high-quality image only."
    )
    try:
        chat = _new_chat(f"img_{uuid.uuid4().hex[:8]}",
                         "You are a world-class product photo retoucher.")
        chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])
        msg = UserMessage(text=prompt, file_contents=[ImageContent(img_b64)])
        text, images = await chat.send_message_multimodal_response(msg)
        if not images:
            raise HTTPException(status_code=502, detail="AI tidak menghasilkan gambar")
        out = images[0]
        await track_ai_usage(user["user_id"], "enhance")
        return {"image_base64": out["data"], "mime_type": out.get("mime_type", "image/png")}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("enhance-image failed")
        raise HTTPException(status_code=500, detail=f"Gagal enhance gambar: {str(e)[:200]}")

@api.post("/ai/generate-content")
async def ai_generate_content(data: AIContentIn, request: Request):
    user = await require_user(request)
    await check_quota(db.monthly_usage, user, "ai_copy", "ai_copy_per_month")
    system = (
        "Kamu adalah copywriter ahli produk UMKM Indonesia. "
        "Selalu balas dalam Bahasa Indonesia santai, hangat, persuasif, gaya warung modern. "
        "Selalu kembalikan JSON valid, tanpa markdown, tanpa pembungkus apapun."
    )
    prompt = (
        f"Buat konten untuk produk berikut:\n"
        f"- Nama produk: {data.product_name}\n"
        f"- Jenis bisnis: {data.business_type or '-'}\n"
        f"- Nama toko: {data.shop_name or '-'}\n"
        f"- Catatan tambahan: {data.extra_hints or '-'}\n\n"
        f"Hasilkan JSON dengan field berikut PERSIS:\n"
        f"{{\n"
        f'  "description": "deskripsi produk 2-3 kalimat menjual untuk halaman web (Bahasa Indonesia)",\n'
        f'  "ig_caption": "caption Instagram singkat 2-4 kalimat dengan emoji yang relevan",\n'
        f'  "tiktok_caption": "caption TikTok hook pertama detik, gaya Gen-Z, max 2 kalimat",\n'
        f'  "hashtags": ["#tag1", "#tag2", ...] (8 hashtag relevan dalam bahasa Indonesia/English populer)\n'
        f"}}\n"
        f"Kembalikan HANYA JSON valid, jangan tulis apapun di luar JSON."
    )
    try:
        chat = _new_chat(f"cnt_{uuid.uuid4().hex[:8]}", system)
        chat.with_model("gemini", "gemini-2.5-flash")
        text = await chat.send_message(UserMessage(text=prompt))
        import json as _json
        # try direct parse, then strip code fences
        raw = text.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE | re.MULTILINE).strip()
        try:
            parsed = _json.loads(raw)
        except Exception:
            # find first { ... }
            m = re.search(r"\{[\s\S]*\}", raw)
            if not m:
                raise HTTPException(status_code=502, detail="AI tidak mengembalikan JSON valid")
            parsed = _json.loads(m.group(0))
        await track_ai_usage(user["user_id"], "content")
        return {
            "description": parsed.get("description", "").strip(),
            "ig_caption": parsed.get("ig_caption", "").strip(),
            "tiktok_caption": parsed.get("tiktok_caption", "").strip(),
            "hashtags": parsed.get("hashtags", []) if isinstance(parsed.get("hashtags"), list) else [],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("generate-content failed")
        raise HTTPException(status_code=500, detail=f"Gagal generate konten: {str(e)[:200]}")

@api.post("/ai/suggest-theme")
async def ai_suggest_theme(data: AIThemeIn, request: Request):
    user = await require_user(request)
    system = "Kamu adalah brand designer. Balas selalu JSON valid, tanpa markdown."
    prompt = (
        f"Toko UMKM bernama '{data.shop_name}' bergerak di bidang '{data.business_type}'. "
        f"Sarankan tema brand. Kembalikan JSON:\n"
        f'{{ "brand_color": "#hex 6 digit warna utama yang cocok dan hangat", '
        f'"tagline": "tagline singkat Bahasa Indonesia maksimal 8 kata yang catchy" }}\n'
        f"Hindari ungu/violet generik, pilih warna hangat membumi (terracotta, hijau lumut, oker, kayu, dsb)."
    )
    try:
        chat = _new_chat(f"thm_{uuid.uuid4().hex[:8]}", system)
        chat.with_model("gemini", "gemini-2.5-flash")
        text = await chat.send_message(UserMessage(text=prompt))
        import json as _json
        raw = text.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE | re.MULTILINE).strip()
        try:
            parsed = _json.loads(raw)
        except Exception:
            m = re.search(r"\{[\s\S]*\}", raw)
            parsed = _json.loads(m.group(0)) if m else {}
        color = parsed.get("brand_color", "#C04A3B")
        if not re.match(r"^#[0-9A-Fa-f]{6}$", color or ""):
            color = "#C04A3B"
        await track_ai_usage(user["user_id"], "theme")
        return {"brand_color": color, "tagline": parsed.get("tagline", "").strip()}
    except Exception:
        logger.exception("suggest-theme failed")
        return {"brand_color": "#C04A3B", "tagline": ""}

@api.post("/ai/generate-about")
async def ai_generate_about(data: AIAboutIn, request: Request):
    user = await require_user(request)
    await check_quota(db.monthly_usage, user, "ai_copy", "ai_copy_per_month")
    system = (
        "Kamu adalah copywriter brand UMKM Indonesia. "
        "Tulis cerita singkat dan hangat tentang toko (3-4 kalimat) dalam Bahasa Indonesia. "
        "Gaya: personal, jujur, tidak lebay. Selalu balas dalam JSON valid tanpa markdown."
    )
    prompt = (
        f"Buat cerita 'Tentang Kami' untuk toko UMKM:\n"
        f"- Nama: {data.shop_name}\n"
        f"- Jenis: {data.business_type}\n"
        f"- Tagline: {data.tagline or '-'}\n"
        f"- Deskripsi singkat: {data.description or '-'}\n\n"
        f"Hasilkan JSON: {{\"about\": \"3-4 kalimat hangat dan personal\"}}.\n"
        f"Hindari klaim berlebihan. Fokus ke kepercayaan & cerita."
    )
    try:
        chat = _new_chat(f"abt_{uuid.uuid4().hex[:8]}", system)
        chat.with_model("gemini", "gemini-2.5-flash")
        text = await chat.send_message(UserMessage(text=prompt))
        import json as _json
        raw = text.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE | re.MULTILINE).strip()
        try:
            parsed = _json.loads(raw)
        except Exception:
            m = re.search(r"\{[\s\S]*\}", raw)
            parsed = _json.loads(m.group(0)) if m else {"about": raw[:400]}
        await track_ai_usage(user["user_id"], "content")
        return {"about": (parsed.get("about") or "").strip()}
    except Exception as e:
        logger.exception("generate-about failed")
        raise HTTPException(status_code=500, detail=f"Gagal generate cerita: {str(e)[:200]}")

@api.post("/ai/generate-cover")
async def ai_generate_cover(data: AICoverIn, request: Request):
    user = await require_user(request)
    await check_quota(db.monthly_usage, user, "ai_cover", "ai_cover_per_month")
    style_hint = {
        "warm": "warm earthy tones, terracotta and cream, hand-crafted feeling, soft natural light, Indonesian aesthetic",
        "minimal": "minimal off-white background, modern sans serif vibe, single product hero composition",
        "vibrant": "vibrant warm colors, festive Indonesian market vibe, lively and inviting",
    }.get(data.style or "warm", "warm earthy tones, Indonesian aesthetic")

    business_visual = {
        "kuliner": "delicious Indonesian food spread on rustic wooden table",
        "kopi": "cozy specialty coffee shop scene, espresso steam, beans",
        "fashion": "stylish clothing rack, fabric textures, atmospheric studio",
        "kerajinan": "handmade crafts on natural wood, artisanal workshop",
        "kecantikan": "skincare product flatlay with natural elements",
    }.get(data.business_type, f"product display for {data.business_type} business")

    prompt = (
        f"Wide cinematic banner image (16:6 aspect ratio feel), {business_visual}, {style_hint}. "
        f"Professional storefront cover photo for an Indonesian small business named '{data.shop_name}'. "
        f"NO TEXT, NO LOGOS, NO LETTERS in the image. Just atmospheric scene. "
        f"Shallow depth of field, magazine quality."
    )
    try:
        chat = _new_chat(f"cov_{uuid.uuid4().hex[:8]}",
                         "You are a master commercial photographer.")
        chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])
        msg = UserMessage(text=prompt)
        text, images = await chat.send_message_multimodal_response(msg)
        if not images:
            raise HTTPException(status_code=502, detail="AI tidak menghasilkan gambar")
        out = images[0]
        await track_ai_usage(user["user_id"], "cover")
        return {"image_base64": out["data"], "mime_type": out.get("mime_type", "image/png")}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("generate-cover failed")
        raise HTTPException(status_code=500, detail=f"Gagal generate cover: {str(e)[:200]}")

# ----------- WhatsApp Bot (Twilio) -----------
def _twilio_client():
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN):
        return None
    try:
        from twilio.rest import Client as TwilioClient
        return TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    except Exception:
        logger.exception("Twilio client init failed")
        return None

def _normalize_wa_number(num: str) -> str:
    n = (num or "").replace("whatsapp:", "").strip()
    n = re.sub(r"[^\d+]", "", n)
    return n

async def _wa_send(to: str, body: str):
    cli = _twilio_client()
    if not cli or not TWILIO_WHATSAPP_FROM:
        logger.info("[WA-NOOP→%s] %s", to, body)
        return
    try:
        cli.messages.create(from_=TWILIO_WHATSAPP_FROM,
                            to=f"whatsapp:{_normalize_wa_number(to)}",
                            body=body)
    except Exception:
        logger.exception("Twilio send failed")

async def _download_media(url: str) -> Optional[str]:
    """Download Twilio media URL (basic-auth) and return base64 string."""
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN):
        return None
    try:
        async with httpx.AsyncClient(timeout=30, auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)) as cx:
            r = await cx.get(url)
        if r.status_code != 200:
            return None
        return base64.b64encode(r.content).decode("ascii")
    except Exception:
        logger.exception("Twilio media download failed")
        return None

def _parse_product_text(text: str):
    """Parse free-form Indonesian text like:
       'Kopi Susu Aren 25000 stok 20'
       'Donat Kentang Rp 8000'
       'Croissant 15rb'
    Returns (name, price, stock).
    """
    if not text:
        return None, 0, 0
    raw = text.strip()
    # stock
    stock_match = re.search(r"(?:stok|stock)\s*[:=]?\s*(\d{1,5})", raw, re.IGNORECASE)
    stock = int(stock_match.group(1)) if stock_match else 0
    if stock_match:
        raw = raw[:stock_match.start()].strip()
    # price (supports 25000, 25rb, 25k, Rp 25.000, 25.000, 25,000)
    price_match = re.search(
        r"(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(rb|ribu|k)?",
        raw, re.IGNORECASE
    )
    price = 0
    if price_match:
        num = price_match.group(1).replace(".", "").replace(",", "")
        try:
            price = int(num)
            unit = (price_match.group(2) or "").lower()
            if unit in ("rb", "ribu", "k"):
                price *= 1000
        except Exception:
            pass
        # remove price portion to get name
        raw = (raw[:price_match.start()] + raw[price_match.end():]).strip()
    # cleanup name
    name = re.sub(r"\s+", " ", raw).strip(" -:.,") or "Produk Baru"
    return name, price, stock

@api.post("/whatsapp/connect/start")
async def whatsapp_connect_start(request: Request):
    """Generate a 6-digit pairing code for current user. Owner sends 'lapakin <code>'
    via WhatsApp to our Twilio number to link their phone to this account."""
    user = await require_user(request)
    code = f"{secrets.randbelow(900000) + 100000}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    await db.wa_pair_codes.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"user_id": user["user_id"], "code": code,
                  "expires_at": expires_at, "used": False,
                  "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    sandbox_hint = TWILIO_WHATSAPP_FROM or "whatsapp:+14155238886 (Twilio sandbox)"
    return {
        "code": code,
        "expires_in_minutes": 15,
        "instructions": (
            f"Kirim WhatsApp ke {sandbox_hint} dengan pesan: "
            f"\"lapakin {code}\". Setelah terhubung, kamu bisa langsung kirim "
            f"foto + nama produk + harga ke nomor itu."
        ),
        "twilio_configured": bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM),
    }

@api.get("/whatsapp/status")
async def whatsapp_status(request: Request):
    user = await require_user(request)
    link = await db.wa_links.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {
        "linked": bool(link),
        "phone": link.get("phone") if link else None,
        "linked_at": link.get("linked_at") if link else None,
        "twilio_configured": bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM),
    }

@api.post("/whatsapp/disconnect")
async def whatsapp_disconnect(request: Request):
    user = await require_user(request)
    await db.wa_links.delete_one({"user_id": user["user_id"]})
    return {"ok": True}

@api.post("/whatsapp/webhook")
async def whatsapp_webhook(request: Request):
    """Twilio webhook (form-encoded POST). Returns TwiML XML reply."""
    form = await request.form()
    from_num = _normalize_wa_number(form.get("From", ""))
    body = (form.get("Body") or "").strip()
    media_url = form.get("MediaUrl0") or ""
    num_media = int(form.get("NumMedia") or 0)

    def _twiml(msg: str) -> PlainTextResponse:
        safe = (msg or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        xml = f"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>{safe}</Message></Response>"
        return PlainTextResponse(xml, media_type="application/xml")

    if not from_num:
        return _twiml("")

    # Pairing flow
    pair_match = re.match(r"^\s*lapakin\s+(\d{6})\s*$", body, re.IGNORECASE)
    if pair_match:
        code = pair_match.group(1)
        rec = await db.wa_pair_codes.find_one({"code": code, "used": False})
        if not rec:
            return _twiml("Kode tidak valid atau sudah dipakai. Cek lagi di dashboard Lapakin ya.")
        expires = rec.get("expires_at")
        if isinstance(expires, str):
            expires = datetime.fromisoformat(expires)
        if expires and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires and expires < datetime.now(timezone.utc):
            return _twiml("Kode sudah kadaluarsa. Buat kode baru di dashboard.")
        await db.wa_links.update_one(
            {"user_id": rec["user_id"]},
            {"$set": {"user_id": rec["user_id"], "phone": from_num,
                      "linked_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        await db.wa_pair_codes.update_one({"code": code}, {"$set": {"used": True}})
        return _twiml("WhatsApp kamu sudah terhubung ke Lapakin! 🎉\n\nSekarang kirim foto produk + nama & harga, contoh:\n\nKopi Susu Aren 25000 stok 20")

    # Find linked user
    link = await db.wa_links.find_one({"phone": from_num})
    if not link:
        return _twiml("Halo! Nomor ini belum terhubung ke akun Lapakin. Buka dashboard di lapakin.id, klik 'Hubungkan WhatsApp', lalu kirim 'lapakin <kode>' ke nomor ini.")

    user = await db.users.find_one({"user_id": link["user_id"]}, {"_id": 0})
    if not user or not user.get("shop_id"):
        return _twiml("Akunmu belum punya toko. Buka dashboard Lapakin dan setup toko dulu ya.")

    # Help / status commands
    low = body.lower()
    if low in ("", "help", "menu", "halo", "hi", "hai"):
        return _twiml("👋 Lapakin WhatsApp Bot siap.\n\nCara pakai:\n• Kirim FOTO + nama produk + harga\n  Contoh: Kopi Susu Aren 25000 stok 20\n\n• Ketik 'list' untuk lihat 5 produk terakhir\n• Ketik 'unlink' untuk lepas WhatsApp")
    if low == "unlink":
        await db.wa_links.delete_one({"user_id": link["user_id"]})
        return _twiml("WhatsApp dilepas dari Lapakin. Sampai jumpa! 👋")
    if low == "list":
        items = await db.products.find({"shop_id": user["shop_id"]}, {"_id": 0, "name": 1, "price": 1, "stock": 1}).sort("created_at", -1).to_list(5)
        if not items:
            return _twiml("Belum ada produk di tokomu.")
        lines = [f"• {p['name']} — Rp {int(p.get('price') or 0):,}".replace(",", ".") + f" (stok {p.get('stock', 0)})" for p in items]
        return _twiml("5 produk terakhir:\n\n" + "\n".join(lines))

    # Need media for product creation
    if num_media == 0 or not media_url:
        return _twiml("Kirim foto produk ya, beserta nama & harga. Contoh: Kopi Susu Aren 25000 stok 20")

    name, price, stock = _parse_product_text(body)
    if price <= 0:
        return _twiml("Harga tidak terbaca. Coba kirim ulang dengan format: <nama> <harga>. Contoh: Kopi Susu Aren 25000")

    img_b64 = await _download_media(media_url)
    if not img_b64:
        return _twiml("Maaf, gagal ambil foto dari WhatsApp. Coba kirim ulang atau pakai dashboard Lapakin.")
    image_data_url = f"data:image/jpeg;base64,{img_b64}"

    product_id = f"prod_{uuid.uuid4().hex[:12]}"
    doc = {
        "product_id": product_id, "shop_id": user["shop_id"],
        "name": name, "price": price, "stock": stock,
        "description": "", "image_data": image_data_url, "images": [image_data_url],
        "ig_caption": "", "tiktok_caption": "", "hashtags": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": "whatsapp",
    }
    await db.products.insert_one(doc)
    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0, "slug": 1})
    base = os.environ.get("PUBLIC_BASE_URL", "")
    link_text = f"\n\nLihat: {base}/toko/{shop['slug']}" if base and shop else ""
    return _twiml(f"✅ Produk \"{name}\" sudah tayang di tokomu!\nHarga: Rp {price:,}".replace(",", ".") + f" • Stok: {stock}{link_text}")

# ----------- Public: Featured shops (for landing) -----------
@api.get("/featured-shops")
async def get_featured_shops():
    shops = await db.shops.find(
        {"featured": True, "status": {"$ne": "suspended"}},
        {"_id": 0, "shop_id": 1, "slug": 1, "name": 1, "tagline": 1,
         "business_type": 1, "brand_color": 1}
    ).limit(8).to_list(8)
    return shops

# ----------- User: active broadcast banner -----------
@api.get("/me/broadcast")
async def get_my_active_broadcast(request: Request):
    user = await require_user(request)
    bc = await db.broadcasts.find_one(
        {"active": True, "dismissed_by": {"$ne": user["user_id"]}},
        {"_id": 0}, sort=[("created_at", -1)]
    )
    return bc

@api.post("/me/broadcast/{broadcast_id}/dismiss")
async def dismiss_broadcast(broadcast_id: str, request: Request):
    user = await require_user(request)
    await db.broadcasts.update_one({"broadcast_id": broadcast_id},
                                   {"$addToSet": {"dismissed_by": user["user_id"]}})
    return {"ok": True}

# ===================================================================
# ADMIN ENDPOINTS — all require role=admin
# ===================================================================

class TierIn(BaseModel):
    tier: str  # "free" | "premium"

class StatusIn(BaseModel):
    status: str  # "active" | "suspended"

class FeaturedIn(BaseModel):
    featured: bool

class BroadcastIn(BaseModel):
    title: str
    message: str
    target: str = "all"  # "all" | "whatsapp"
    variant: str = "info"  # "info" | "success" | "warning"
    active: bool = True

# 1. Dashboard Overview
@api.get("/admin/stats")
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
    # Daily growth (last 14 days)
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
@api.get("/admin/shops")
async def admin_list_shops(request: Request, q: str = "", limit: int = 100):
    await require_admin(request)
    flt = {}
    if q:
        flt["$or"] = [{"name": {"$regex": q, "$options": "i"}},
                      {"slug": {"$regex": q, "$options": "i"}}]
    shops = await db.shops.find(flt, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    # join product counts
    for s in shops:
        s["product_count"] = await db.products.count_documents({"shop_id": s["shop_id"]})
        owner = await db.users.find_one({"user_id": s["owner_user_id"]}, {"_id": 0, "email": 1, "name": 1, "tier": 1})
        s["owner"] = owner
    return shops

# 3. List users
@api.get("/admin/users")
async def admin_list_users(request: Request, q: str = "", limit: int = 200):
    await require_admin(request)
    flt = {}
    if q:
        flt["$or"] = [{"email": {"$regex": q, "$options": "i"}},
                      {"name": {"$regex": q, "$options": "i"}}]
    users = await db.users.find(flt, {"_id": 0, "password_hash": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return users

# 4. Suspend / activate shop
@api.put("/admin/shops/{shop_id}/status")
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
@api.put("/admin/shops/{shop_id}/featured")
async def admin_set_shop_featured(shop_id: str, data: FeaturedIn, request: Request):
    admin = await require_admin(request)
    res = await db.shops.update_one({"shop_id": shop_id}, {"$set": {"featured": bool(data.featured)}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")
    await log_admin_action(admin, "shop_featured_toggle", "shop", shop_id, {"featured": data.featured})
    return {"ok": True, "featured": data.featured}

# 5. Admin delete any product
@api.delete("/admin/products/{product_id}")
async def admin_delete_product(product_id: str, request: Request):
    admin = await require_admin(request)
    p = await db.products.find_one({"product_id": product_id}, {"_id": 0, "name": 1, "shop_id": 1})
    if not p:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    await db.products.delete_one({"product_id": product_id})
    await log_admin_action(admin, "product_delete", "product", product_id,
                           {"name": p.get("name"), "shop_id": p.get("shop_id")})
    return {"ok": True}

@api.get("/admin/products")
async def admin_list_products(request: Request, q: str = "", shop_id: str = "", limit: int = 200):
    await require_admin(request)
    flt = {}
    if q:
        flt["name"] = {"$regex": q, "$options": "i"}
    if shop_id:
        flt["shop_id"] = shop_id
    items = await db.products.find(flt, {"_id": 0, "image_data": 0, "images": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return items

# 6. Generate reset password token for a user
@api.post("/admin/users/{user_id}/reset-password")
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

# 11. Subscription Manager — set tier (free | pro | business)
@api.put("/admin/users/{user_id}/tier")
@api.post("/admin/users/{user_id}/tier")
async def admin_set_user_tier(user_id: str, data: TierIn, request: Request):
    admin = await require_admin(request)
    if data.tier not in VALID_TIERS:
        raise HTTPException(status_code=400, detail=f"Tier harus salah satu dari {VALID_TIERS}")
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    old_tier = get_tier(user)
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"tier": data.tier, "tier_updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    await log_admin_action(admin, "user_tier_change", "user", user_id,
                           {"from": old_tier, "to": data.tier})
    return {"ok": True, "user_id": user_id, "tier": data.tier}

# 7. Audit log
@api.get("/admin/audit")
async def admin_audit_log(request: Request, limit: int = 200):
    await require_admin(request)
    logs = await db.audit_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)
    return logs

# 8. Broadcast
@api.get("/admin/broadcasts")
async def admin_list_broadcasts(request: Request):
    await require_admin(request)
    items = await db.broadcasts.find({}, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    return items

@api.post("/admin/broadcasts")
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
        # Send to all linked WA numbers (best-effort)
        async for link in db.wa_links.find({}, {"_id": 0, "phone": 1}):
            try:
                await _wa_send(link["phone"], f"📢 {data.title}\n\n{data.message}")
                wa_sent += 1
            except Exception:
                pass
    return {**{k: v for k, v in doc.items() if k != "_id"}, "wa_sent": wa_sent}

@api.put("/admin/broadcasts/{broadcast_id}/active")
async def admin_toggle_broadcast(broadcast_id: str, data: FeaturedIn, request: Request):
    admin = await require_admin(request)
    # FeaturedIn reuses same shape: {featured: bool}
    res = await db.broadcasts.update_one({"broadcast_id": broadcast_id}, {"$set": {"active": bool(data.featured)}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Broadcast tidak ditemukan")
    await log_admin_action(admin, "broadcast_toggle", "broadcast", broadcast_id, {"active": data.featured})
    return {"ok": True}

@api.delete("/admin/broadcasts/{broadcast_id}")
async def admin_delete_broadcast(broadcast_id: str, request: Request):
    admin = await require_admin(request)
    res = await db.broadcasts.delete_one({"broadcast_id": broadcast_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Broadcast tidak ditemukan")
    await log_admin_action(admin, "broadcast_delete", "broadcast", broadcast_id)
    return {"ok": True}

# 10. AI usage stats
@api.get("/admin/ai-usage")
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
    # Top users
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

async def asyncio_gather_safe(coros):
    import asyncio
    return await asyncio.gather(*coros)

# ----------- Health -----------
@api.get("/")
async def root():
    return {"app": "Lapakin", "status": "ok"}

# ----------- Billing / Tier (Iteration 11) -----------

@api.get("/billing/tiers")
async def billing_tiers():
    """Public — return available tiers and their limits/features."""
    return {"tiers": TIER_LIMITS, "valid": VALID_TIERS}

@api.get("/billing/me")
async def billing_me(request: Request):
    """Current user's tier + month-to-date usage with limits."""
    user = await require_user(request)
    tier = get_tier(user)
    limits = get_limits(tier)
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
        "year_month": ym,
        "limits": limits,
        "usage": usage,
        "products": {
            "used": product_count,
            "limit": "unlimited" if is_unlimited(pmax) else pmax,
            "remaining": "unlimited" if is_unlimited(pmax) else max(0, pmax - product_count),
        },
    }

# ----------- Mount router & middleware -----------
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
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.password_reset_tokens.create_index("token", unique=True)
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.wa_pair_codes.create_index("code")
    await db.wa_pair_codes.create_index("expires_at", expireAfterSeconds=0)
    await db.wa_pair_codes.create_index("user_id", unique=True)
    await db.wa_links.create_index("user_id", unique=True)
    await db.wa_links.create_index("phone", unique=True)
    await db.audit_logs.create_index("timestamp")
    await db.audit_logs.create_index("admin_user_id")
    await db.broadcasts.create_index("created_at")
    await db.broadcasts.create_index("active")
    await db.ai_usage.create_index("user_id")
    await db.ai_usage.create_index("timestamp")
    await db.ai_usage.create_index("kind")
    await db.monthly_usage.create_index([("user_id", 1), ("year_month", 1), ("kind", 1)], unique=True)
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
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})

@app.on_event("shutdown")
async def on_shutdown():
    client.close()
