"""AI endpoints: photo enhance, content generation, theme suggestion, about, cover."""
import re
import uuid
import json as _json

from fastapi import APIRouter, HTTPException, Request

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

from deps import db, logger, require_user, track_ai_usage, EMERGENT_LLM_KEY
from models import AIContentIn, AIThemeIn, AIAboutIn, AICoverIn, AIEnhanceIn
from tiers import check_quota

router = APIRouter()


def _new_chat(session_id: str, system_message: str) -> LlmChat:
    return LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system_message)


@router.post("/ai/enhance-image")
async def ai_enhance_image(data: AIEnhanceIn, request: Request):
    user = await require_user(request)
    await check_quota(db.monthly_usage, user, "ai_photo", "ai_photo_per_month")
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
        chat = _new_chat(f"cnt_{uuid.uuid4().hex[:8]}", system)
        chat.with_model("gemini", "gemini-2.5-flash")
        text = await chat.send_message(UserMessage(text=prompt))
        raw = text.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE | re.MULTILINE).strip()
        try:
            parsed = _json.loads(raw)
        except Exception:
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
        chat = _new_chat(f"thm_{uuid.uuid4().hex[:8]}", system)
        chat.with_model("gemini", "gemini-2.5-flash")
        text = await chat.send_message(UserMessage(text=prompt))
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
        chat = _new_chat(f"abt_{uuid.uuid4().hex[:8]}", system)
        chat.with_model("gemini", "gemini-2.5-flash")
        text = await chat.send_message(UserMessage(text=prompt))
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
