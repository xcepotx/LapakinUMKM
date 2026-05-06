"""OpenGraph routes: shop share HTML/PNG, product IG post/story, bulk card pack."""
import re
import time
import zipfile
from datetime import datetime, timezone
from io import BytesIO

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, Response as FastResponse

from deps import db, logger, require_user
from tiers import require_feature
from og_render import (
    OG_PNG_CACHE, OG_CACHE_TTL,
    cover_hash, generate_fallback_og_image, decode_data_url_png,
    render_product_card,
)

router = APIRouter()


# ---------- helpers ----------
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


# ---------- Shop OG PNG ----------
@router.api_route("/og/shop/{slug}.png", methods=["GET", "HEAD"])
async def og_image(slug: str):
    """Serve a 1200x630 PNG suitable for OpenGraph preview (cached)."""
    shop = await db.shops.find_one({"slug": slug}, {"_id": 0})
    if not shop or shop.get("status") == "suspended":
        png = generate_fallback_og_image("Lapakin", "Toko online UMKM Indonesia", "#C04A3B")
        return FastResponse(
            content=png, media_type="image/png",
            headers={"Cache-Control": "public, max-age=300"},
        )

    shop_id = shop.get("shop_id")
    cover = shop.get("cover_image") or ""
    chash = cover_hash(cover) + (shop.get("brand_color") or "") + (shop.get("name") or "") + (shop.get("tagline") or "")
    cached = OG_PNG_CACHE.get(shop_id)
    now = time.time()
    if cached and cached[1] == chash and (now - cached[2]) < OG_CACHE_TTL:
        return FastResponse(content=cached[0], media_type="image/png",
                            headers={"Cache-Control": "public, max-age=600", "X-Cache": "HIT"})

    png = decode_data_url_png(cover) if cover else None
    if not png:
        png = generate_fallback_og_image(
            shop.get("name") or "Toko",
            shop.get("tagline") or "",
            shop.get("brand_color") or "#C04A3B",
        )
    OG_PNG_CACHE[shop_id] = (png, chash, now)
    # Cap cache size — drop oldest entry if >100 shops cached.
    if len(OG_PNG_CACHE) > 100:
        oldest_id = min(OG_PNG_CACHE.keys(), key=lambda k: OG_PNG_CACHE[k][2])
        OG_PNG_CACHE.pop(oldest_id, None)

    return FastResponse(
        content=png, media_type="image/png",
        headers={"Cache-Control": "public, max-age=600", "X-Cache": "MISS"},
    )


# ---------- Shop OG HTML ----------
@router.api_route("/og/shop/{slug}", methods=["GET", "HEAD"])
async def og_html(slug: str, request: Request):
    """Return HTML page with full OpenGraph + Twitter Card meta tags."""
    shop = await db.shops.find_one({"slug": slug}, {"_id": 0})
    base = _public_base_url(request)
    if not shop or shop.get("status") == "suspended":
        title = "Toko tidak ditemukan · Lapakin"
        desc = "Toko UMKM ini sudah tidak tersedia di Lapakin."
        og_img_url = ""
    else:
        title = f"{shop.get('name') or 'Toko'} · Lapakin"
        desc = (shop.get("storefront_seo_description") or shop.get("tagline") or shop.get("description")
                or shop.get("about") or "Toko online UMKM Indonesia di Lapakin.")[:200]
        og_img_url = shop.get("storefront_seo_image") or f"{base}/api/og/shop/{slug}.png"

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
<!-- JS redirect (bots don't execute JS). We intentionally REMOVED meta refresh so
     FB/LinkedIn bots stay on this page and read the OG tags correctly. -->
<script>setTimeout(function(){{window.location.replace({canonical!r});}},10);</script>
</body>
</html>"""
    return HTMLResponse(content=html, headers={"Cache-Control": "public, max-age=300"})


# ---------- Product Cards ----------
@router.get("/og/product/{product_id}/post.png")
async def product_card_post(product_id: str):
    product = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    shop = await db.shops.find_one({"shop_id": product.get("shop_id")}, {"_id": 0}) or {}
    png = render_product_card(product, shop, "post")
    return FastResponse(content=png, media_type="image/png",
                        headers={"Cache-Control": "public, max-age=600"})


@router.get("/og/product/{product_id}/story.png")
async def product_card_story(product_id: str):
    product = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    shop = await db.shops.find_one({"shop_id": product.get("shop_id")}, {"_id": 0}) or {}
    png = render_product_card(product, shop, "story")
    return FastResponse(content=png, media_type="image/png",
                        headers={"Cache-Control": "public, max-age=600"})


# ---------- Bulk Card Pack (PRO+ tier) ----------
@router.get("/og/bulk-pack.zip")
async def bulk_card_pack(request: Request):
    """Download a ZIP with IG Post + Story PNG for every product in user's shop."""
    user = await require_user(request)
    require_feature(user, "remove_branding")  # proxy for "paid tier"
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")
    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0}) or {}
    products = await db.products.find({"shop_id": user["shop_id"]}, {"_id": 0}).to_list(500)
    if not products:
        raise HTTPException(status_code=400, detail="Belum ada produk untuk di-pack")

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in products:
            safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", p.get("name", "produk"))[:40]
            try:
                post_png = render_product_card(p, shop, "post")
                zf.writestr(f"{safe}-post-1080x1080.png", post_png)
            except Exception as e:
                logger.warning(f"bulk pack post render failed: {e}")
            try:
                story_png = render_product_card(p, shop, "story")
                zf.writestr(f"{safe}-story-1080x1920.png", story_png)
            except Exception as e:
                logger.warning(f"bulk pack story render failed: {e}")
        readme = (
            f"Toko Cards Pack · {shop.get('name', '')}\n"
            f"Generated: {datetime.now(timezone.utc).isoformat()}\n"
            f"Total produk: {len(products)}\n\n"
            f"Cara pakai:\n"
            f"- File -post-1080x1080.png → upload sebagai IG/TikTok post\n"
            f"- File -story-1080x1920.png → upload sebagai IG/WA Status\n"
        )
        zf.writestr("README.txt", readme)

    buf.seek(0)
    slug = shop.get("slug", "toko")
    return FastResponse(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{slug}-cards-pack.zip"'},
    )
