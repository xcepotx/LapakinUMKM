"""Instagram publishing routes.

MVP:
- manual connect with IG User ID + Page/IG access token
- publish product card to Instagram feed
"""
import asyncio
import os
from datetime import datetime, timezone
from io import BytesIO
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from deps import db, require_user, logger
from tiers import require_feature
from og_render import render_product_card

router = APIRouter()

GRAPH_VERSION = os.getenv("META_GRAPH_API_VERSION", "v22.0")
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"


class InstagramConnectIn(BaseModel):
    instagram_user_id: str
    access_token: str


def _public_base_url(request: Request) -> str:
    configured = (
        os.getenv("PUBLIC_APP_URL")
        or os.getenv("REACT_APP_PUBLIC_URL")
        or os.getenv("FRONTEND_URL")
        or ""
    ).strip().rstrip("/")

    if configured:
        return configured

    origin = (request.headers.get("origin") or "").strip().rstrip("/")
    if origin:
        return origin

    host = request.headers.get("host") or "dev.lapakin.my.id"
    proto = request.headers.get("x-forwarded-proto") or "https"
    return f"{proto}://{host}".rstrip("/")


def _rupiah(n: int) -> str:
    try:
        return f"Rp {int(n or 0):,}".replace(",", ".")
    except Exception:
        return "Rp 0"


def _caption_for(product: dict, shop: dict) -> str:
    tags = product.get("hashtags") or []
    if isinstance(tags, list):
        tags_text = " ".join(str(t) for t in tags if t)
    else:
        tags_text = str(tags or "")

    base = (
        product.get("ig_caption")
        or product.get("description")
        or f"{product.get('name') or 'Produk'} — {_rupiah(product.get('price') or 0)}"
    )

    shop_name = shop.get("name") or ""
    order_line = ""
    if shop.get("slug"):
        order_line = f"\n\nPesan di toko: {_public_shop_url(shop)}"

    caption = "\n\n".join([base.strip(), tags_text.strip()]).strip()
    if shop_name and shop_name.lower() not in caption.lower():
        caption = f"{caption}\n\n— {shop_name}".strip()
    return f"{caption}{order_line}".strip()


def _public_shop_url(shop: dict) -> str:
    base = os.getenv("PUBLIC_APP_URL", "https://dev.lapakin.my.id").rstrip("/")
    slug = shop.get("slug") or ""
    return f"{base}/toko/{slug}" if slug else base


async def _get_user_shop(request: Request):
    user = await require_user(request)
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Toko belum dibuat")
    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")
    return user, shop


@router.get("/instagram/status")
async def instagram_status(request: Request):
    user, shop = await _get_user_shop(request)
    return {
        "connected": bool(shop.get("instagram_user_id") and shop.get("instagram_access_token")),
        "instagram_user_id": shop.get("instagram_user_id") or "",
        "instagram_handle": shop.get("instagram") or "",
        "tier": user.get("tier") or "free",
        "connected_at": shop.get("instagram_connected_at"),
        "last_publish_at": shop.get("instagram_last_publish_at"),
    }


@router.post("/instagram/connect/manual")
async def instagram_connect_manual(data: InstagramConnectIn, request: Request):
    """Temporary/dev connect flow.

    Store IG User ID + access token on the shop so we can validate publishing.
    Do not expose this as the final OAuth UX.
    """
    user, shop = await _get_user_shop(request)

    ig_user_id = data.instagram_user_id.strip()
    token = data.access_token.strip()

    if not ig_user_id or not token:
        raise HTTPException(status_code=400, detail="Instagram User ID dan access token wajib diisi")

    # Lightweight validation: ask Graph for profile metadata.
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                f"{GRAPH_BASE}/{ig_user_id}",
                params={"fields": "id,username", "access_token": token},
            )
        if r.status_code >= 400:
            raise HTTPException(
                status_code=400,
                detail=f"Token/IG User ID tidak valid: {r.text[:200]}",
            )
        meta = r.json()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Instagram connect validation failed")
        raise HTTPException(status_code=502, detail=f"Gagal validasi Instagram: {str(exc)[:120]}")

    now = datetime.now(timezone.utc).isoformat()
    await db.shops.update_one(
        {"shop_id": shop["shop_id"]},
        {"$set": {
            "instagram_connected": True,
            "instagram_user_id": ig_user_id,
            "instagram_access_token": token,
            "instagram": meta.get("username") or shop.get("instagram") or "",
            "instagram_connected_at": now,
            "instagram_connected_by": user["user_id"],
        }},
    )

    return {
        "ok": True,
        "connected": True,
        "instagram_user_id": ig_user_id,
        "username": meta.get("username") or "",
        "connected_at": now,
    }


@router.get("/instagram/products/{product_id}/post.jpg")
async def instagram_product_post_jpg(product_id: str):
    """Public JPEG product card URL for Meta to fetch.

    Existing OG endpoint serves PNG. This endpoint converts it to JPEG for safer
    Instagram feed publishing.
    """
    product = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")

    shop = await db.shops.find_one({"shop_id": product.get("shop_id")}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    png_bytes = render_product_card(product, shop, "post")
    try:
        from PIL import Image
        img = Image.open(BytesIO(png_bytes)).convert("RGB")
        out = BytesIO()
        img.save(out, format="JPEG", quality=92, optimize=True)
        body = out.getvalue()
    except Exception:
        logger.exception("Failed to convert IG product card to JPG")
        raise HTTPException(status_code=500, detail="Gagal membuat JPG produk")

    return Response(
        content=body,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=300"},
    )


async def _wait_for_container(container_id: str, token: str) -> dict:
    last = {}
    async with httpx.AsyncClient(timeout=20) as client:
        for _ in range(8):
            r = await client.get(
                f"{GRAPH_BASE}/{container_id}",
                params={
                    "fields": "status_code,status",
                    "access_token": token,
                },
            )
            if r.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail=f"Gagal cek status container IG: {r.text[:200]}",
                )

            last = r.json()
            status_code = last.get("status_code")

            if status_code == "FINISHED":
                return last
            if status_code in ("ERROR", "EXPIRED"):
                raise HTTPException(
                    status_code=502,
                    detail=f"Container IG gagal diproses: {last.get('status') or status_code}",
                )

            await asyncio.sleep(3)

    raise HTTPException(
        status_code=504,
        detail=f"Container IG belum siap dipublish: {last.get('status_code') or 'UNKNOWN'}",
    )


@router.post("/instagram/products/{product_id}/publish")
async def instagram_publish_product(product_id: str, request: Request):
    user, shop = await _get_user_shop(request)

    # Existing tier flag: currently Business-only unless tiers.py is changed.
    require_feature(user, "instagram_autopost")

    ig_user_id = shop.get("instagram_user_id")
    token = shop.get("instagram_access_token")
    if not ig_user_id or not token:
        raise HTTPException(
            status_code=400,
            detail="Instagram belum terhubung. Hubungkan IG User ID + access token dulu.",
        )

    product = await db.products.find_one(
        {"product_id": product_id, "shop_id": shop["shop_id"]},
        {"_id": 0},
    )
    if not product:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")

    base = _public_base_url(request)
    image_url = f"{base}/api/instagram/products/{product_id}/post.jpg"
    caption = _caption_for(product, shop)

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            create = await client.post(
                f"{GRAPH_BASE}/{ig_user_id}/media",
                data={
                    "image_url": image_url,
                    "caption": caption,
                    "access_token": token,
                },
            )

            if create.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail=f"Gagal membuat container Instagram: {create.text[:300]}",
                )

            container_id = create.json().get("id")
            if not container_id:
                raise HTTPException(status_code=502, detail="Instagram tidak mengembalikan container ID")

        await _wait_for_container(container_id, token)

        async with httpx.AsyncClient(timeout=30) as client:
            publish = await client.post(
                f"{GRAPH_BASE}/{ig_user_id}/media_publish",
                data={
                    "creation_id": container_id,
                    "access_token": token,
                },
            )

        if publish.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=f"Gagal publish Instagram: {publish.text[:300]}",
            )

        media_id = publish.json().get("id")
        now = datetime.now(timezone.utc).isoformat()

        await db.instagram_posts.insert_one({
            "shop_id": shop["shop_id"],
            "user_id": user["user_id"],
            "product_id": product_id,
            "ig_user_id": ig_user_id,
            "container_id": container_id,
            "media_id": media_id,
            "image_url": image_url,
            "caption": caption,
            "created_at": now,
            "status": "published",
        })
        await db.shops.update_one(
            {"shop_id": shop["shop_id"]},
            {"$set": {
                "instagram_last_publish_at": now,
                "instagram_last_media_id": media_id,
            }},
        )

        return {
            "ok": True,
            "media_id": media_id,
            "container_id": container_id,
            "image_url": image_url,
            "published_at": now,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Instagram publish failed")
        raise HTTPException(status_code=502, detail=f"Gagal publish Instagram: {str(exc)[:200]}")
