"""AI endpoints: photo enhance, content generation, theme suggestion, about, cover.

All endpoints route through llm_service for provider fallback (Gemini → OpenAI → Emergent).
"""
import re
import json as _json

from fastapi import APIRouter, HTTPException, Request

from deps import db, logger, require_user, track_ai_usage
from models import AIContentIn, AIThemeIn, AIAboutIn, AICoverIn, AIEnhanceIn
from tiers import check_quota
from llm_service import chat_text, chat_image_text2img, chat_image_edit

router = APIRouter()


def _parse_json_response(raw: str) -> dict:
    """Strip markdown fences and parse JSON. Raises HTTPException 502 if invalid."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE | re.MULTILINE).strip()
    try:
        return _json.loads(raw)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            raise HTTPException(status_code=502, detail="AI tidak mengembalikan JSON valid")
        return _json.loads(m.group(0))


@router.post("/ai/enhance-image")
async def ai_enhance_image(data: AIEnhanceIn, request: Request):
    user = await require_user(request)
    await check_quota(db.monthly_usage, user, "ai_photo", "ai_photo_per_month")

    img_b64 = data.image_base64
    if img_b64.startswith("data:"):
        img_b64 = img_b64.split(",", 1)[-1]

    # LAPAKIN_PRODUCT_IMAGE_ENHANCE_V15
    product_name = str(data.product_name or "").strip()
    business_type = str(data.business_type or "").strip()
    product_category = str(data.product_category or "").strip()
    style = str(data.style or "clean").strip()

    style_hint = {
        "clean": "clean premium studio setup, soft warm cream background (#FDFBF7), natural contact shadow, bright even lighting, centered product, e-commerce ready",
        "product_studio": "premium marketplace product photo, soft off-white background, subtle surface shadow, clean crop, crisp details, polished but realistic",
        "food_appetizing": "warm appetizing food photography, clean cream table surface, natural soft shadow, richer but realistic food colors, fresh and inviting Indonesian home-cooking feel",
        "lifestyle": "simple lifestyle scene with warm neutral surface, soft window light, minimal props, product remains the main focus",
        "warm_lifestyle": "warm handmade/local product scene, neutral textured surface, subtle artisan mood, soft shadow, uncluttered background",
        "minimal": "minimal high-key e-commerce photo, off-white seamless paper, sharp focus, clean edges, subtle realistic shadow",
    }.get(style, "clean premium studio setup, soft warm cream background, professional lighting")

    context_bits = []
    if product_name:
        context_bits.append(f"Product name: {product_name}.")
    if business_type:
        context_bits.append(f"Business type: {business_type}.")
    if product_category:
        context_bits.append(f"Product category: {product_category}.")

    context = " ".join(context_bits)

    prompt = (
        f"Enhance this product photo for an Indonesian UMKM online storefront. "
        f"{context} "
        f"Keep the EXACT same product, food, packaging, label, shape, color, quantity, and branding. "
        f"Do not invent new toppings, ingredients, logos, text, packaging, or extra items. "
        f"Do not crop out important parts of the product. "
        f"Improve framing, center the subject, fix exposure, improve contrast, clean visual clutter, and use {style_hint}. "
        f"Make it look more attractive and ready for product cards, catalog, and storefront hero, while staying realistic. "
        f"Output one final high-quality image only."
    )
    try:
        out = await chat_image_edit(prompt, img_b64)
        await track_ai_usage(user["user_id"], "enhance")
        return {"image_base64": out["data"], "mime_type": out.get("mime_type", "image/png")}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("enhance-image failed")
        raise HTTPException(status_code=500, detail=f"Gagal enhance gambar: {str(e)[:200]}")


@router.post("/ai/generate-content")
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
        text = await chat_text(system, prompt, model_hint="gemini-2.5-flash")
        parsed = _parse_json_response(text)
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


@router.post("/ai/suggest-theme")
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
        text = await chat_text(system, prompt, model_hint="gemini-2.5-flash")
        parsed = _parse_json_response(text)
        color = parsed.get("brand_color", "#C04A3B")
        if not re.match(r"^#[0-9A-Fa-f]{6}$", color or ""):
            color = "#C04A3B"
        await track_ai_usage(user["user_id"], "theme")
        return {"brand_color": color, "tagline": parsed.get("tagline", "").strip()}
    except Exception:
        logger.exception("suggest-theme failed")
        return {"brand_color": "#C04A3B", "tagline": ""}


@router.post("/ai/generate-about")
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
        text = await chat_text(system, prompt, model_hint="gemini-2.5-flash")
        try:
            parsed = _parse_json_response(text)
        except HTTPException:
            parsed = {"about": text.strip()[:400]}
        await track_ai_usage(user["user_id"], "content")
        return {"about": (parsed.get("about") or "").strip()}
    except Exception as e:
        logger.exception("generate-about failed")
        raise HTTPException(status_code=500, detail=f"Gagal generate cerita: {str(e)[:200]}")


@router.post("/ai/generate-cover")
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
        out = await chat_image_text2img(prompt)
        await track_ai_usage(user["user_id"], "cover")
        return {"image_base64": out["data"], "mime_type": out.get("mime_type", "image/png")}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("generate-cover failed")
        raise HTTPException(status_code=500, detail=f"Gagal generate cover: {str(e)[:200]}")
