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
import asyncio
import os
import time
import httpx
import json
import base64
import shutil
import subprocess
import tempfile

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


# LAPAKIN_CONTENT_STUDIO_PROMO_AI_ENHANCE_V1
def _content_studio_promo_format_idr(value) -> str:
    try:
        amount = int(float(value or 0))
    except Exception:
        amount = 0

    if amount <= 0:
        return ""

    return "Rp " + f"{amount:,}".replace(",", ".")


# LAPAKIN_CONTENT_STUDIO_PROMO_AI_ENHANCE_V1
def _content_studio_promo_clean_text(value, limit: int = 180) -> str:
    value = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 1)].rstrip() + "…"


# LAPAKIN_CONTENT_STUDIO_PROMO_AI_ENHANCE_V1
def _content_studio_promo_normalize_suggestion(data: dict, fallback: dict) -> dict:
    if not isinstance(data, dict):
        data = {}

    title = _content_studio_promo_clean_text(data.get("title") or fallback.get("title") or "Promo Spesial", 48)
    description = _content_studio_promo_clean_text(data.get("description") or fallback.get("description") or "Ada promo menarik untuk produk pilihan hari ini.", 150)
    use_code = bool(data.get("use_code", fallback.get("use_code", False)))
    code = re.sub(r"[^A-Za-z0-9_-]", "", str(data.get("code") or fallback.get("code") or "").strip().upper())[:24]
    note = _content_studio_promo_clean_text(data.get("note") or fallback.get("note") or "Berlaku sesuai ketentuan toko.", 90)

    if not code:
        use_code = False

    return {
        "enabled": True,
        "title": title,
        "description": description,
        "use_code": use_code,
        "code": code if use_code else "",
        "note": note,
    }


# LAPAKIN_CONTENT_STUDIO_PROMO_AI_ENHANCE_V1
def _content_studio_promo_fallback(shop: dict, products: list) -> dict:
    first = products[0] if products else {}
    product_name = first.get("name") or first.get("product_name") or "produk pilihan"
    shop_name = shop.get("name") or "toko kamu"

    return {
        "enabled": True,
        "title": "Promo Hari Ini",
        "description": f"Dapatkan penawaran spesial untuk {product_name} dan produk pilihan dari {shop_name}.",
        "use_code": False,
        "code": "",
        "note": "Berlaku hari ini atau selama stok masih tersedia.",
    }


# LAPAKIN_CONTENT_STUDIO_PROMO_AI_ENHANCE_V1
@router.post("/content-studio/promo-suggest")
async def suggest_content_studio_promo(request: Request):
    user = await require_user(request)

    try:
        body = await request.json()
    except Exception:
        body = {}

    product_ids = body.get("product_ids") or []
    selected_products = body.get("selected_products") or []

    if not isinstance(product_ids, list):
        product_ids = []

    if not isinstance(selected_products, list):
        selected_products = []

    shop_id = (
        user.get("shop_id")
        or user.get("active_shop_id")
        or user.get("current_shop_id")
    )

    shop = None
    if shop_id:
        shop = await db.shops.find_one({"shop_id": shop_id}, {"_id": 0})

    if not shop:
        shop = await db.shops.find_one(
            {
                "$or": [
                    {"owner_user_id": user.get("user_id")},
                    {"user_id": user.get("user_id")},
                ],
                "status": {"$ne": "deleted"},
            },
            {"_id": 0},
        )

    shop = shop or {"name": user.get("shop_name") or "Toko kamu"}

    products = []

    if product_ids:
        query = {"product_id": {"$in": product_ids}}
        if shop.get("shop_id"):
            query["shop_id"] = shop.get("shop_id")

        db_products = await db.products.find(query, {"_id": 0}).to_list(length=max(1, len(product_ids)))
        by_id = {p.get("product_id"): p for p in db_products}
        products = [by_id[pid] for pid in product_ids if pid in by_id]

    if not products and selected_products:
        for item in selected_products[:8]:
            if not isinstance(item, dict):
                continue
            products.append({
                "name": item.get("name") or item.get("product_name") or "Produk",
                "price": item.get("price") or 0,
                "category": item.get("category_name") or item.get("category") or "",
                "description": item.get("description") or item.get("caption") or "",
            })

    if not products:
        raise HTTPException(status_code=400, detail="Pilih minimal 1 produk untuk AI Enhance promo")

    fallback = _content_studio_promo_fallback(shop, products)

    product_lines = []
    for p in products[:8]:
        name = p.get("name") or p.get("product_name") or "Produk"
        price = _content_studio_promo_format_idr(p.get("price"))
        category = p.get("category_name") or p.get("category") or ""
        desc = _content_studio_promo_clean_text(p.get("description") or p.get("caption") or "", 90)

        parts = [name]
        if price:
            parts.append(price)
        if category:
            parts.append(f"Kategori: {category}")
        if desc:
            parts.append(desc)

        product_lines.append(" - " + " | ".join(parts))

    system = (
        "Kamu adalah social media strategist UMKM Indonesia. "
        "Tugasmu membuat promo singkat yang cocok untuk slide carousel Instagram. "
        "Bahasa harus natural, jualan, tidak korporat, dan cocok untuk toko kecil."
    )

    prompt = (
        f"Nama toko: {shop.get('name') or 'Toko UMKM'}\n"
        f"Tagline/deskripsi toko: {shop.get('tagline') or shop.get('description') or '-'}\n\n"
        "Produk yang dipilih:\n"
        + "\n".join(product_lines)
        + "\n\n"
        "Buat rekomendasi promo dalam JSON valid dengan field PERSIS:\n"
        "{\n"
        '  "title": "maks 5 kata, catchy",\n'
        '  "description": "1 kalimat promo yang jelas dan menarik",\n'
        '  "use_code": true/false,\n'
        '  "code": "kode singkat uppercase jika use_code true, kosong jika false",\n'
        '  "note": "catatan kecil, contoh: Berlaku sampai stok habis"\n'
        "}\n\n"
        "Aturan:\n"
        "- Jangan klaim diskon besar kalau tidak jelas.\n"
        "- Boleh pilih promo aman seperti Bonus, Paket Hemat, Promo Hari Ini, atau Tanpa Kode.\n"
        "- Jika pakai kode, kode harus pendek seperti HEMAT10, MURAH, JAJAN, atau MENU.\n"
        "- Jangan pakai markdown."
    )

    try:
        text = await llm_chat_text(
            system=system,
            user=prompt,
            model_hint="gemini-2.5-flash",
            session_id=f"content_promo_{uuid.uuid4().hex[:8]}",
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

        return _content_studio_promo_normalize_suggestion(parsed, fallback)

    except Exception as e:
        logger.warning(f"content_studio promo suggestion failed: {e}")
        return _content_studio_promo_normalize_suggestion(fallback, fallback)


@router.post("/content-studio/generate")
async def generate_carousel(request: Request):
    """Generate IG carousel + multi-platform captions for given products."""
    user = await require_user(request)
    body = await request.json()
    product_ids = body.get("product_ids") or []
    style = (body.get("style") or "hangat").strip().lower()
    # LAPAKIN_CONTENT_STUDIO_PROMO_TOGGLE_V1
    promo = body.get("promo") or {}

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
    slides = await render_carousel(shop, products, style_name=style, promo=promo)
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



# LAPAKIN_CONTENT_STUDIO_ASYNC_JOB_DB_V2
# Async wrapper dengan MongoDB job store + temp file untuk result besar.
# Alasan:
# - in-memory job tidak aman saat backend multi-worker/reload
# - result carousel berisi base64 PNG dan bisa terlalu besar untuk 1 dokumen MongoDB
CONTENT_STUDIO_JOB_TTL_SECONDS = 60 * 60
CONTENT_STUDIO_JOB_RESULT_DIR = os.getenv(
    "CONTENT_STUDIO_JOB_RESULT_DIR",
    "/tmp/lapakin-content-studio-jobs",
)


# LAPAKIN_CONTENT_STUDIO_ASYNC_JOB_DB_V2
def _content_studio_internal_generate_url() -> str:
    return os.getenv(
        "CONTENT_STUDIO_INTERNAL_GENERATE_URL",
        "http://127.0.0.1:8001/api/content-studio/generate",
    )


# LAPAKIN_CONTENT_STUDIO_ASYNC_JOB_DB_V2
def _content_studio_job_result_path(job_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", str(job_id or ""))
    return os.path.join(CONTENT_STUDIO_JOB_RESULT_DIR, f"{safe}.json")


# LAPAKIN_CONTENT_STUDIO_ASYNC_JOB_DB_V2
async def _content_studio_cleanup_jobs_db():
    now = time.time()
    cutoff = now - CONTENT_STUDIO_JOB_TTL_SECONDS

    old_jobs = await db.content_studio_jobs.find(
        {"created_at_ts": {"$lt": cutoff}},
        {"_id": 0, "job_id": 1, "result_file": 1},
    ).to_list(length=200)

    for job in old_jobs:
        result_file = job.get("result_file") or _content_studio_job_result_path(job.get("job_id"))
        try:
            if result_file and os.path.exists(result_file):
                os.remove(result_file)
        except Exception:
            pass

    await db.content_studio_jobs.delete_many({
        "created_at_ts": {"$lt": cutoff}
    })


# LAPAKIN_CONTENT_STUDIO_ASYNC_JOB_DB_V2
def _content_studio_public_job(job: dict) -> dict:
    if not job:
        return {}

    job.pop("_id", None)
    job.pop("payload", None)
    job.pop("result_file", None)
    return job


# LAPAKIN_CONTENT_STUDIO_ASYNC_JOB_DB_V2
def _content_studio_write_result_file(job_id: str, result: dict) -> str:
    os.makedirs(CONTENT_STUDIO_JOB_RESULT_DIR, exist_ok=True)

    final_path = _content_studio_job_result_path(job_id)
    tmp_path = f"{final_path}.tmp"

    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    os.replace(tmp_path, final_path)
    return final_path


# LAPAKIN_CONTENT_STUDIO_ASYNC_JOB_DB_V2
def _content_studio_read_result_file(path_value: str) -> dict:
    if not path_value or not os.path.exists(path_value):
        return {}

    with open(path_value, "r", encoding="utf-8") as f:
        return json.load(f)


# LAPAKIN_CONTENT_STUDIO_ASYNC_JOB_DB_V2
async def _run_content_studio_generate_job_db(job_id: str, payload: dict, forwarded_headers: dict):
    now = time.time()

    await db.content_studio_jobs.update_one(
        {"job_id": job_id},
        {"$set": {
            "status": "running",
            "message": "Konten sedang dibuat...",
            "started_at_ts": now,
            "updated_at_ts": now,
        }}
    )

    try:
        headers = {}
        for key in ("authorization", "cookie"):
            value = forwarded_headers.get(key)
            if value:
                headers[key] = value

        async with httpx.AsyncClient(timeout=600.0, follow_redirects=True) as client:
            response = await client.post(
                _content_studio_internal_generate_url(),
                json=payload,
                headers=headers,
            )

        if response.status_code >= 400:
            detail = None
            try:
                detail = response.json().get("detail")
            except Exception:
                detail = response.text[:500]

            await db.content_studio_jobs.update_one(
                {"job_id": job_id},
                {"$set": {
                    "status": "failed",
                    "message": detail or f"Generate gagal: HTTP {response.status_code}",
                    "finished_at_ts": time.time(),
                    "updated_at_ts": time.time(),
                }}
            )
            return

        result = response.json()
        result_file = _content_studio_write_result_file(job_id, result)

        await db.content_studio_jobs.update_one(
            {"job_id": job_id},
            {"$set": {
                "status": "done",
                "message": "Konten selesai dibuat.",
                "result_file": result_file,
                "finished_at_ts": time.time(),
                "updated_at_ts": time.time(),
            }}
        )

    except Exception as exc:
        await db.content_studio_jobs.update_one(
            {"job_id": job_id},
            {"$set": {
                "status": "failed",
                "message": str(exc) or "Generate konten gagal.",
                "finished_at_ts": time.time(),
                "updated_at_ts": time.time(),
            }}
        )


# LAPAKIN_CONTENT_STUDIO_ASYNC_JOB_DB_V2
@router.post("/content-studio/generate-job")
async def start_content_studio_generate_job(request: Request):
    user = await require_user(request)

    try:
        payload = await request.json()
    except Exception:
        payload = {}

    await _content_studio_cleanup_jobs_db()

    job_id = f"cs_{uuid.uuid4().hex[:16]}"
    now = time.time()

    doc = {
        "job_id": job_id,
        "user_id": user.get("user_id"),
        "shop_id": user.get("shop_id"),
        "status": "queued",
        "message": "Masuk antrean generate konten.",
        "payload": payload,
        "created_at_ts": now,
        "updated_at_ts": now,
    }

    await db.content_studio_jobs.insert_one(doc)

    forwarded_headers = {
        "authorization": request.headers.get("authorization") or "",
        "cookie": request.headers.get("cookie") or "",
    }

    asyncio.create_task(_run_content_studio_generate_job_db(job_id, payload, forwarded_headers))

    return {
        "job_id": job_id,
        "status": "queued",
        "message": "Generate konten dimulai.",
    }


# LAPAKIN_CONTENT_STUDIO_ASYNC_JOB_DB_V2
@router.get("/content-studio/generate-job/{job_id}")
async def get_content_studio_generate_job(job_id: str, request: Request):
    user = await require_user(request)
    await _content_studio_cleanup_jobs_db()

    job = await db.content_studio_jobs.find_one(
        {
            "job_id": job_id,
            "user_id": user.get("user_id"),
        },
        {"_id": 0}
    )

    if not job:
        raise HTTPException(status_code=404, detail="Job generate tidak ditemukan atau sudah kedaluwarsa")

    if job.get("status") == "done":
        result = _content_studio_read_result_file(job.get("result_file"))
        if not result:
            await db.content_studio_jobs.update_one(
                {"job_id": job_id},
                {"$set": {
                    "status": "failed",
                    "message": "Hasil generate tidak ditemukan. Silakan generate ulang.",
                    "updated_at_ts": time.time(),
                }}
            )
            raise HTTPException(status_code=404, detail="Hasil generate tidak ditemukan. Silakan generate ulang.")

        job["result"] = result

    return _content_studio_public_job(job)

# LAPAKIN_CONTENT_STUDIO_EXPORT_VIDEO_V1
def _content_studio_require_video_tier(user: dict):
    tier = get_tier(user)
    limits = get_limits(tier)
    limit = limits.get(LIMIT_KEY, 0)

    if limit == 0 and not is_unlimited(limit):
        raise HTTPException(
            status_code=402,
            detail="Export video MP4 hanya tersedia untuk paket Pro & Bisnis."
        )

    return tier


# LAPAKIN_CONTENT_STUDIO_EXPORT_VIDEO_V1
def _content_studio_decode_slide_png(slide: dict, index: int) -> bytes:
    if not isinstance(slide, dict):
        raise HTTPException(status_code=400, detail=f"Slide #{index} tidak valid")

    raw = str(slide.get("png_b64") or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail=f"Slide #{index} tidak punya gambar")

    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1]

    if len(raw) > 10_000_000:
        raise HTTPException(status_code=413, detail=f"Slide #{index} terlalu besar untuk dibuat video")

    try:
        data = base64.b64decode(raw, validate=False)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Slide #{index} gagal dibaca")

    if len(data) < 20:
        raise HTTPException(status_code=400, detail=f"Slide #{index} kosong")

    return data


# LAPAKIN_CONTENT_STUDIO_EXPORT_VIDEO_V1
def _content_studio_run_ffmpeg(cmd: list, timeout: int = 90):
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Pembuatan video terlalu lama. Coba kurangi jumlah slide.")

    if proc.returncode != 0:
        err = (proc.stderr or b"").decode("utf-8", errors="ignore")[-900:]
        logger.warning(f"content_studio video ffmpeg failed: {err}")
        raise HTTPException(status_code=500, detail="Gagal membuat video MP4. Pastikan ffmpeg tersedia di server.")


# LAPAKIN_CONTENT_STUDIO_EXPORT_VIDEO_V1
def _content_studio_safe_video_filename(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value or "content-studio")).strip("-").lower()
    return value[:80] or "content-studio"


# LAPAKIN_CONTENT_STUDIO_EXPORT_VIDEO_V1
@router.post("/content-studio/video")
async def export_content_studio_video(request: Request):
    user = await require_user(request)
    tier = _content_studio_require_video_tier(user)

    if not shutil.which("ffmpeg"):
        raise HTTPException(
            status_code=503,
            detail="ffmpeg belum tersedia di server. Install ffmpeg untuk export video."
        )

    try:
        body = await request.json()
    except Exception:
        body = {}

    slides = body.get("slides") or []
    if not isinstance(slides, list) or not (1 <= len(slides) <= 12):
        raise HTTPException(status_code=400, detail="Video membutuhkan 1 sampai 12 slide")

    try:
        duration = float(body.get("duration_per_slide") or 3)
    except Exception:
        duration = 3.0

    duration = max(1.0, min(8.0, duration))

    transition = str(body.get("transition") or "fade").strip().lower()
    if transition not in {"fade", "none"}:
        transition = "fade"

    filename_base = _content_studio_safe_video_filename(body.get("filename") or "content-studio-video")

    with tempfile.TemporaryDirectory(prefix="lapakin-cs-video-") as tmpdir:
        segment_paths = []

        for idx, slide in enumerate(slides, start=1):
            image_path = os.path.join(tmpdir, f"{idx:02d}_slide.png")
            segment_path = os.path.join(tmpdir, f"{idx:02d}_segment.mp4")

            with open(image_path, "wb") as f:
                f.write(_content_studio_decode_slide_png(slide, idx))

            vf_parts = [
                "scale=1080:1080:force_original_aspect_ratio=decrease",
                "pad=1080:1080:(ow-iw)/2:(oh-ih)/2",
                "setsar=1",
            ]

            if transition == "fade":
                fade_d = min(0.35, max(0.18, duration / 6))
                fade_out_start = max(0.0, duration - fade_d)
                vf_parts.append(f"fade=t=in:st=0:d={fade_d:.2f}")
                vf_parts.append(f"fade=t=out:st={fade_out_start:.2f}:d={fade_d:.2f}")

            vf_parts.append("format=yuv420p")

            cmd = [
                "ffmpeg",
                "-y",
                "-loop", "1",
                "-t", f"{duration:.2f}",
                "-i", image_path,
                "-vf", ",".join(vf_parts),
                "-r", "30",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                segment_path,
            ]

            await asyncio.to_thread(_content_studio_run_ffmpeg, cmd, 90)
            segment_paths.append(segment_path)

        concat_path = os.path.join(tmpdir, "concat.txt")
        with open(concat_path, "w", encoding="utf-8") as f:
            for path in segment_paths:
                f.write(f"file '{path}'\n")

        output_path = os.path.join(tmpdir, "output.mp4")
        concat_cmd = [
            "ffmpeg",
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_path,
            "-c", "copy",
            "-movflags", "+faststart",
            output_path,
        ]

        await asyncio.to_thread(_content_studio_run_ffmpeg, concat_cmd, 120)

        with open(output_path, "rb") as f:
            video_bytes = f.read()

    return {
        "filename": f"{filename_base}.mp4",
        "content_type": "video/mp4",
        "video_b64": base64.b64encode(video_bytes).decode("ascii"),
        "duration_per_slide": duration,
        "transition": transition,
        "slide_count": len(slides),
        "tier": tier,
    }

