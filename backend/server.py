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
import base64
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import bcrypt
import jwt as pyjwt
import httpx
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

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
    """Record an AI call for analytics. Best-effort, never raises."""
    try:
        await db.ai_usage.insert_one({
            "user_id": user_id, "kind": kind,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
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
            "shop_id": user.get("shop_id"), "access_token": token}

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
    if user.get("shop_id"):
        # update
        await db.shops.update_one(
            {"shop_id": user["shop_id"]},
            {"$set": {**data.model_dump(), "updated_at": now}}
        )
        shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
        return shop
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
        **data.model_dump(), "created_at": now,
    }
    await db.shops.insert_one(doc)
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"shop_id": shop_id}})
    return {k: v for k, v in doc.items() if k != "_id"}

@api.get("/shops/by-slug/{slug}")
async def get_shop_public(slug: str):
    shop = await db.shops.find_one({"slug": slug}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")
    if shop.get("status") == "suspended":
        raise HTTPException(status_code=404, detail="Toko tidak tersedia")
    products = await db.products.find({"shop_id": shop["shop_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"shop": shop, "products": products}

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

# 11. Subscription Manager — set tier
@api.put("/admin/users/{user_id}/tier")
async def admin_set_user_tier(user_id: str, data: TierIn, request: Request):
    admin = await require_admin(request)
    if data.tier not in ("free", "premium"):
        raise HTTPException(status_code=400, detail="Tier harus 'free' atau 'premium'")
    res = await db.users.update_one({"user_id": user_id}, {"$set": {"tier": data.tier}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    await log_admin_action(admin, "user_tier_change", "user", user_id, {"tier": data.tier})
    return {"ok": True, "tier": data.tier}

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
