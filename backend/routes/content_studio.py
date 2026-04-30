"""Content Studio — generate IG carousel + multi-platform captions for shop owners.

Tier-gated (Pro/Bisnis only). Pro: 10/month, Bisnis: unlimited.

POST /content-studio/generate
  Body: {product_ids: [str], style: "minimal"|"hangat"|"bold"}
  Returns: {
    slides: [{filename, png_b64, content_type}],
    captions: {ig, tiktok, whatsapp},
    quota: {used, limit, remaining}
  }

GET /content-studio/quota
  Returns current month usage for the authenticated user's tier.
"""
from __future__ import annotations

import json as _json
import re
import uuid
from typing import List

from fastapi import APIRouter, HTTPException, Request

from content_studio_render import STYLES, render_carousel
from deps import db, logger, require_user
from llm_service import chat_text as llm_chat_text
from tiers import current_month_bucket, get_limits, get_tier, is_unlimited

router = APIRouter()

KIND = "content_studio"
LIMIT_KEY = "content_studio_per_month"


async def _check_and_count_quota(user: dict) -> dict:
    """Verify tier eligibility + monthly quota. Returns quota dict."""
    tier = get_tier(user)
    limits = get_limits(tier)
    limit = limits.get(LIMIT_KEY, 0)
    if limit == 0 and not is_unlimited(limit):
        raise HTTPException(
            status_code=402,
            detail="Content Studio hanya tersedia untuk paket Pro & Bisnis. Upgrade untuk akses fitur ini."
        )
    ym = current_month_bucket()
    doc = await db.monthly_usage.find_one(
        {"user_id": user["user_id"], "year_month": ym, "kind": KIND},
        {"_id": 0, "count": 1},
    )
    used = int((doc or {}).get("count", 0))
    if not is_unlimited(limit) and used >= limit:
        raise HTTPException(
            status_code=429,
            detail=f"Kuota Content Studio bulan ini ({limit}x) sudah habis. Reset bulan depan atau upgrade ke Bisnis untuk unlimited."
        )
    return {
        "used": used,
        "limit": limit,
        "remaining": -1 if is_unlimited(limit) else max(0, limit - used),
        "tier": tier,
    }


async def _generate_captions(shop: dict, products: List[dict]) -> dict:
    """Use LLM to draft 3-platform captions. Returns dict {ig, tiktok, whatsapp}."""
    product_lines = "\n".join(
        f"- {p.get('name')}: Rp {p.get('price'):,} ({p.get('description', '')[:50]})"
        for p in products
    )
    system = (
        "Kamu adalah social media manager UMKM Indonesia yang santai dan jago bikin caption viral. "
        "Hindari bahasa korporat. Pakai 'kamu', emoji secukupnya (max 5 per caption). "
        "Selalu balas JSON valid tanpa pembungkus markdown."
    )
    prompt = (
        f"Toko: {shop.get('name')} ({shop.get('business_type') or 'umum'})\n"
        f"Tagline: {shop.get('tagline') or '-'}\n"
        f"Link toko: lapakin.my.id/toko/{shop.get('slug')}\n"
        f"WhatsApp: {shop.get('whatsapp') or '-'}\n\n"
        f"Produk yang sedang di-promote ({len(products)} item):\n{product_lines}\n\n"
        "Buat 3 caption untuk platform berbeda — JSON dengan field PERSIS:\n"
        "{\n"
        '  "ig": "Caption Instagram 4-7 baris dengan hook di awal, hashtag relevan di akhir (max 10 hashtag). Cocok untuk carousel post.",\n'
        '  "tiktok": "Caption TikTok 1-3 baris pendek, langsung to the point, ada hook + CTA + 3-5 hashtag.",\n'
        '  "whatsapp": "Pesan WhatsApp broadcast 3-5 baris yang siap copy-paste, ramah, ada list produk + link toko di akhir."\n'
        "}\n"
        "Bahasa Indonesia santai, hindari kata-kata generic. Kembalikan HANYA JSON valid."
    )
    try:
        text = await llm_chat_text(
            system=system,
            user=prompt,
            model_hint="gemini-2.5-flash",
            session_id=f"content_{uuid.uuid4().hex[:8]}",
        )
        raw = (text or "").strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE | re.MULTILINE).strip()
        try:
            parsed = _json.loads(raw)
        except Exception:
            match = re.search(r"\{[\s\S]*\}", raw)
            if not match:
                raise ValueError("AI returned non-JSON")
            parsed = _json.loads(match.group(0))
        return {
            "ig": parsed.get("ig") or "",
            "tiktok": parsed.get("tiktok") or "",
            "whatsapp": parsed.get("whatsapp") or "",
        }
    except Exception as e:
        logger.warning(f"content_studio caption generation failed: {e}")
        # Best-effort fallback
        url = f"lapakin.my.id/toko/{shop.get('slug')}"
        return {
            "ig": f"✨ Cek menu terbaru di {shop.get('name')}!\n\nKlik link di bio atau order langsung via WhatsApp 👇\n\n#umkm #jualanonline #lapakin",
            "tiktok": f"{shop.get('name')} buka pesanan baru! Order sekarang di {url} 🔥 #umkm #jualanonline",
            "whatsapp": f"Halo!\n\nLagi promo nih di {shop.get('name')}. Cek menu lengkap + langsung order:\n{url}\n\nDitunggu pesanannya 🙏",
        }


# ---------------- Endpoints ----------------
@router.get("/content-studio/quota")
async def get_quota(request: Request):
    user = await require_user(request)
    return await _check_and_count_quota(user)


@router.get("/content-studio/styles")
async def list_styles(request: Request):
    """Public list of available visual styles (for UI radio selector)."""
    await require_user(request)
    return {
        "styles": [
            {"key": "minimal", "label": "Minimal",
             "description": "Putih bersih, type-driven. Cocok semua bidang."},
            {"key": "hangat", "label": "Hangat",
             "description": "Warna brand Lapakin, hangat. Cocok kuliner & fashion lokal."},
            {"key": "bold", "label": "Bold",
             "description": "Hitam + kuning kontras. Eye-catching, cocok promo besar."},
        ]
    }


@router.post("/content-studio/generate")
async def generate_carousel(request: Request):
    """Generate IG carousel + multi-platform captions for given products."""
    user = await require_user(request)
    body = await request.json()
    product_ids = body.get("product_ids") or []
    style = (body.get("style") or "hangat").strip().lower()

    if not isinstance(product_ids, list) or not (1 <= len(product_ids) <= 8):
        raise HTTPException(status_code=400, detail="Pilih 1-8 produk untuk carousel")
    if style not in STYLES:
        raise HTTPException(status_code=400, detail="Style tidak valid")
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")

    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    # Tier + quota gate (raises if blocked)
    quota = await _check_and_count_quota(user)

    products = await db.products.find(
        {"shop_id": shop["shop_id"], "product_id": {"$in": product_ids}},
        {"_id": 0},
    ).to_list(len(product_ids))
    # Preserve user's order
    by_id = {p["product_id"]: p for p in products}
    products = [by_id[pid] for pid in product_ids if pid in by_id]
    if len(products) == 0:
        raise HTTPException(status_code=404, detail="Tidak ada produk yang ditemukan")

    # Render slides + captions in parallel-ish
    slides = await render_carousel(shop, products, style_name=style)
    captions = await _generate_captions(shop, products)

    # Increment usage atomically
    from datetime import datetime, timezone
    ym = current_month_bucket()
    res = await db.monthly_usage.find_one_and_update(
        {"user_id": user["user_id"], "year_month": ym, "kind": KIND},
        {"$inc": {"count": 1},
         "$setOnInsert": {"updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
        return_document=True,
    )
    new_used = int(res.get("count", 1))
    quota_after = {
        **quota,
        "used": new_used,
        "remaining": -1 if is_unlimited(quota["limit"]) else max(0, quota["limit"] - new_used),
    }

    return {
        "slides": slides,
        "captions": captions,
        "style": style,
        "quota": quota_after,
        "shop_name": shop.get("name"),
    }
