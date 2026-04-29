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
    image_data: Optional[str] = ""  # base64 data URL or raw base64
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
            "shop_id": user.get("shop_id")}

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
    doc = {
        "product_id": product_id, "shop_id": user["shop_id"],
        **data.model_dump(),
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
    await db.products.update_one({"product_id": product_id}, {"$set": data.model_dump()})
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
    await require_user(request)
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
        return {"image_base64": out["data"], "mime_type": out.get("mime_type", "image/png")}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("enhance-image failed")
        raise HTTPException(status_code=500, detail=f"Gagal enhance gambar: {str(e)[:200]}")

@api.post("/ai/generate-content")
async def ai_generate_content(data: AIContentIn, request: Request):
    await require_user(request)
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
    await require_user(request)
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
        return {"brand_color": color, "tagline": parsed.get("tagline", "").strip()}
    except Exception:
        logger.exception("suggest-theme failed")
        return {"brand_color": "#C04A3B", "tagline": ""}

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
