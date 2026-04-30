"""Cerita UMKM Sukses — public-facing success stories of real Lapakin merchants.

Workflow:
  1) Admin marks a shop as story candidate via POST /admin/stories/draft (with shop_id)
  2) Backend generates AI draft from shop data (name, business_type, about, products, analytics)
  3) Admin reviews + edits via PATCH /admin/stories/<id>
  4) Admin publishes via POST /admin/stories/<id>/publish
  5) Public reads at GET /api/stories (list) and GET /api/stories/<slug> (detail)

Story doc shape:
  {
    story_id, slug, shop_id, shop_slug, shop_name,
    title, hero_image, content_md (markdown),
    excerpt, status: draft|published, published_at,
    created_at, updated_at, view_count
  }
"""
from __future__ import annotations

import json as _json
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from deps import db, logger, require_admin, slugify
from llm_service import chat_text as llm_chat_text

router = APIRouter()


def _excerpt_from_md(md: str, n: int = 180) -> str:
    """Strip markdown then truncate to ~n chars."""
    if not md:
        return ""
    # Remove headings, bold, italic, links
    txt = re.sub(r"^#+\s*", "", md, flags=re.MULTILINE)
    txt = re.sub(r"\*\*([^*]+)\*\*", r"\1", txt)
    txt = re.sub(r"\*([^*]+)\*", r"\1", txt)
    txt = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt[:n] + ("…" if len(txt) > n else "")


# ---------------- Public endpoints ----------------
@router.get("/stories")
async def list_published_stories(limit: int = 20, offset: int = 0):
    """Public list of published stories (newest first)."""
    cursor = db.stories.find(
        {"status": "published"},
        projection={
            "_id": 0,
            "content_md": 0,  # exclude full content from list
        },
    ).sort("published_at", -1).skip(offset).limit(min(50, limit))
    items = await cursor.to_list(length=limit)
    total = await db.stories.count_documents({"status": "published"})
    return {"items": items, "total": total}


@router.get("/stories/{slug}")
async def get_story_by_slug(slug: str):
    story = await db.stories.find_one({"slug": slug, "status": "published"}, {"_id": 0})
    if not story:
        raise HTTPException(status_code=404, detail="Cerita tidak ditemukan")
    # Increment view count (best-effort)
    try:
        await db.stories.update_one({"slug": slug}, {"$inc": {"view_count": 1}})
        story["view_count"] = (story.get("view_count") or 0) + 1
    except Exception:
        pass
    return story


# ---------------- Admin endpoints ----------------
async def _generate_story_draft(shop: dict) -> dict:
    """Use configured LLM provider to generate a story draft from shop context."""
    try:
        # Gather a few products as flavor
        products = await db.products.find(
            {"shop_id": shop["shop_id"]},
            projection={"_id": 0, "name": 1, "description": 1, "price": 1},
        ).limit(5).to_list(5)
        product_lines = "\n".join(
            f"- {p.get('name')}: {p.get('description', '')[:60]}"
            for p in products
        ) or "(belum ada produk)"

        system = (
            "Kamu adalah penulis cerita UMKM Indonesia yang hangat dan inspiratif. "
            "Tulisanmu personal, dekat dengan pembaca, gaya storytelling jurnalisme — "
            "bukan promosi keras. Selalu balas JSON valid tanpa pembungkus markdown."
        )
        prompt = (
            f"Buat cerita inspiratif tentang UMKM ini untuk dipublish di blog Lapakin.\n\n"
            f"Data toko:\n"
            f"- Nama toko: {shop.get('name')}\n"
            f"- Bidang: {shop.get('business_type')}\n"
            f"- Tagline: {shop.get('tagline') or '-'}\n"
            f"- Tentang: {shop.get('about') or '-'}\n"
            f"- Lokasi: {shop.get('location_extra') or shop.get('location') or '-'}\n"
            f"- Produk-produk:\n{product_lines}\n\n"
            f"Tulis cerita dengan struktur:\n"
            f"1. Pembuka (1 paragraf): hook menarik tentang penjual/brand\n"
            f"2. Latar belakang (1-2 paragraf): bagaimana mereka mulai\n"
            f"3. Tantangan & solusi (1-2 paragraf): pakai contoh konkret\n"
            f"4. Penutup (1 paragraf): pelajaran untuk UMKM lain\n\n"
            f"Hasilkan JSON dengan field PERSIS:\n"
            f"{{\n"
            f'  "title": "Judul cerita 6-12 kata, menarik tapi tidak clickbait",\n'
            f'  "content_md": "Konten markdown 350-500 kata dengan paragraf yang dipisah \\n\\n. Pakai ## untuk subheading kalau perlu."\n'
            f"}}\n"
            f"Bahasa Indonesia santai, hindari bahasa korporat. Kembalikan HANYA JSON valid."
        )
        text = await llm_chat_text(
            system=system,
            user=prompt,
            model_hint="gemini-2.5-flash",
            session_id=f"story_{uuid.uuid4().hex[:8]}",
        )
        raw = text.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE | re.MULTILINE).strip()
        try:
            parsed = _json.loads(raw)
        except Exception:
            match = re.search(r"\{[\s\S]*\}", raw)
            if not match:
                raise ValueError("AI returned non-JSON")
            parsed = _json.loads(match.group(0))
        if not parsed.get("title") or not parsed.get("content_md"):
            raise ValueError("Missing required fields")
        return parsed
    except Exception as e:
        logger.error(f"_generate_story_draft failed: {e}")
        raise HTTPException(status_code=503, detail=f"AI gagal generate draft: {e}")


@router.post("/admin/stories/draft")
async def admin_create_story_draft(request: Request):
    """Admin creates a story draft from a shop. Body: {shop_slug | shop_id}."""
    await require_admin(request)
    body = await request.json()
    shop = None
    if body.get("shop_id"):
        shop = await db.shops.find_one({"shop_id": body["shop_id"]}, {"_id": 0})
    elif body.get("shop_slug"):
        shop = await db.shops.find_one({"slug": body["shop_slug"]}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    draft = await _generate_story_draft(shop)
    now = datetime.now(timezone.utc).isoformat()
    base_slug = slugify(draft["title"])[:50] or f"cerita-{shop['slug']}"
    # Ensure unique slug
    slug = base_slug
    suffix = 2
    while await db.stories.find_one({"slug": slug}, {"_id": 0, "story_id": 1}):
        slug = f"{base_slug}-{suffix}"
        suffix += 1
    story = {
        "story_id": f"story_{uuid.uuid4().hex[:10]}",
        "slug": slug,
        "shop_id": shop["shop_id"],
        "shop_slug": shop["slug"],
        "shop_name": shop["name"],
        "title": draft["title"],
        "content_md": draft["content_md"],
        "excerpt": _excerpt_from_md(draft["content_md"]),
        "hero_image": shop.get("cover_image") or shop.get("logo"),
        "status": "draft",
        "published_at": None,
        "view_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    await db.stories.insert_one(story)
    story.pop("_id", None)
    return story


@router.get("/admin/stories")
async def admin_list_stories(request: Request):
    await require_admin(request)
    cursor = db.stories.find({}, {"_id": 0}).sort("created_at", -1).limit(100)
    items = await cursor.to_list(100)
    return {"items": items}


@router.patch("/admin/stories/{story_id}")
async def admin_update_story(story_id: str, request: Request):
    await require_admin(request)
    body = await request.json()
    allowed = {"title", "content_md", "excerpt", "hero_image"}
    update = {k: v for k, v in body.items() if k in allowed}
    if not update:
        raise HTTPException(status_code=400, detail="Tidak ada field yang diupdate")
    if "content_md" in update and "excerpt" not in update:
        update["excerpt"] = _excerpt_from_md(update["content_md"])
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.stories.update_one({"story_id": story_id}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Cerita tidak ditemukan")
    story = await db.stories.find_one({"story_id": story_id}, {"_id": 0})
    return story


@router.post("/admin/stories/{story_id}/publish")
async def admin_publish_story(story_id: str, request: Request):
    await require_admin(request)
    now = datetime.now(timezone.utc).isoformat()
    r = await db.stories.update_one(
        {"story_id": story_id},
        {"$set": {"status": "published", "published_at": now, "updated_at": now}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Cerita tidak ditemukan")
    return {"ok": True, "published_at": now}


@router.post("/admin/stories/{story_id}/unpublish")
async def admin_unpublish_story(story_id: str, request: Request):
    await require_admin(request)
    r = await db.stories.update_one(
        {"story_id": story_id},
        {"$set": {"status": "draft", "published_at": None,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Cerita tidak ditemukan")
    return {"ok": True}


@router.delete("/admin/stories/{story_id}")
async def admin_delete_story(story_id: str, request: Request):
    await require_admin(request)
    r = await db.stories.delete_one({"story_id": story_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Cerita tidak ditemukan")
    return {"ok": True}
