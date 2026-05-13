import html
"""OpenGraph routes: shop share HTML/PNG, product IG post/story, bulk card pack."""
import re
import time
import hashlib
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




# LAPAKIN_OG_WHATSAPP_THUMB_V1
def _lapakin_og_version(*parts) -> str:
    raw = "|".join(str(p or "") for p in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


# LAPAKIN_OG_WHATSAPP_THUMB_V1
def _lapakin_optimize_og_png(png: bytes) -> bytes:
    """
    WhatsApp kadang mengambil title/description tapi skip thumbnail kalau file OG terlalu besar.
    Tetap keluarkan PNG 1200x630, tapi diperkecil via adaptive palette + optimize.
    Kalau gagal, fallback ke PNG original supaya endpoint tidak rusak.
    """
    try:
        from PIL import Image

        src = Image.open(BytesIO(png))
        src.load()

        # Pastikan ukuran tidak berubah. Test existing mengharapkan 1200x630.
        if src.mode not in ("RGB", "RGBA"):
            src = src.convert("RGBA")

        # Hilangkan alpha ke background putih agar hasil paletted PNG lebih stabil.
        if src.mode == "RGBA":
            bg = Image.new("RGB", src.size, "white")
            bg.paste(src, mask=src.getchannel("A"))
            src = bg
        else:
            src = src.convert("RGB")

        # Adaptive palette signifikan mengecilkan PNG photo-rich untuk kebutuhan thumbnail OG.
        paletted = src.convert("P", palette=Image.Palette.ADAPTIVE, colors=192)

        out = BytesIO()
        paletted.save(out, format="PNG", optimize=True, compress_level=9)

        optimized = out.getvalue()

        # Pakai versi optimized hanya kalau benar-benar lebih kecil dan masih PNG valid.
        if optimized.startswith(b"\x89PNG\r\n\x1a\n") and len(optimized) < len(png):
            return optimized

        return png
    except Exception:
        return png




# LAPAKIN_PRODUCT_SHARE_OG_V1
def _format_og_price(value) -> str:
    try:
        amount = int(float(value or 0))
    except Exception:
        amount = 0

    if amount <= 0:
        return ""

    return "Rp " + f"{amount:,}".replace(",", ".")


# LAPAKIN_PRODUCT_SHARE_OG_V1
def _compact_og_text(*parts, limit: int = 200) -> str:
    value = " ".join(str(part or "").strip() for part in parts if str(part or "").strip())
    value = re.sub(r"\s+", " ", value).strip()
    return value[:limit]


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
    png = _lapakin_optimize_og_png(png)
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
        # LAPAKIN_PRODUCT_SHARE_OG_V1
        # Jika URL toko punya ?product=<product_id>, crawler social harus melihat OG produk,
        # sedangkan human tetap melihat storefront dan popup produk.
        product_id = (request.query_params.get("product") or request.query_params.get("product_id") or "").strip()
        product = None

        if product_id:
            product = await db.products.find_one({
                "product_id": product_id,
                "shop_id": shop.get("shop_id"),
            }, {"_id": 0})

            if product and product.get("is_active") is False:
                product = None

        if product:
            product_name = product.get("name") or product.get("product_name") or "Produk"
            shop_name = shop.get("name") or "Toko"
            product_price = _format_og_price(product.get("price"))
            product_desc = product.get("description") or product.get("caption") or ""
            title = f"{product_name} · {shop_name}"
            desc = _compact_og_text(product_price, "—" if product_price and product_desc else "", product_desc or shop.get("tagline") or shop.get("description"), limit=200)

            og_img_version = _lapakin_og_version(
                shop.get("shop_id"),
                shop.get("name"),
                product.get("product_id"),
                product.get("name"),
                product.get("price"),
                product.get("description"),
                product.get("image_url"),
                product.get("updated_at"),
            )
            og_img_url = f"{base}/api/og/product/{product_id}/post.png?v={og_img_version}"
            canonical = f"{base}/toko/{slug}?product={product_id}"
            og_img_width = "1080"
            og_img_height = "1080"
        else:
            title = f"{shop.get('name') or 'Toko'} · Lapakin"
            desc = (shop.get("storefront_seo_description") or shop.get("tagline") or shop.get("description")
                    or shop.get("about") or "Toko online UMKM Indonesia di Lapakin.")[:200]
            og_img_version = _lapakin_og_version(
                shop.get("shop_id"),
                shop.get("name"),
                shop.get("tagline"),
                shop.get("description"),
                shop.get("brand_color"),
                shop.get("cover_image"),
                shop.get("storefront_seo_image"),
            )
            og_img_url = shop.get("storefront_seo_image") or f"{base}/api/og/shop/{slug}.png?v={og_img_version}"
            canonical = f"{base}/toko/{slug}"
            og_img_width = "1200"
            og_img_height = "630"

    if not shop or shop.get("status") == "suspended":
        canonical = f"{base}/toko/{slug}"
        og_img_width = "1200"
        og_img_height = "630"
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
{f'<meta property="og:image:secure_url" content="{og_img_url}" />' if og_img_url else ''}
{'<meta property="og:image:type" content="image/png" />' if og_img_url else ''}
{f'<meta property="og:image:width" content="{og_img_width}" />' if og_img_url else ''}
{f'<meta property="og:image:height" content="{og_img_height}" />' if og_img_url else ''}
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
    png = _lapakin_optimize_og_png(png)
    return FastResponse(content=png, media_type="image/png",
                        headers={"Cache-Control": "public, max-age=600"})


@router.get("/og/product/{product_id}/story.png")
async def product_card_story(product_id: str):
    product = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    shop = await db.shops.find_one({"shop_id": product.get("shop_id")}, {"_id": 0}) or {}
    png = render_product_card(product, shop, "story")
    png = _lapakin_optimize_og_png(png)
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


# LAPAKIN_MALL_PHASE1D_PRODUCT_DETAIL_OG_V1
def _mall_og_base_url(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or "https"
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""

    if not host:
        return ""

    return f"{proto}://{host}".rstrip("/")


# LAPAKIN_MALL_PHASE1E_SUBDOMAIN_READY_V1
def _mall_og_is_mall_host(request: Request) -> bool:
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").split(":")[0].lower()
    return host in {"mall.lapakin.my.id", "mall-dev.lapakin.my.id", "mall.dev.lapakin.my.id"} or host.startswith("mall.")


# LAPAKIN_MALL_PHASE1D_PRODUCT_DETAIL_OG_V1
def _mall_og_escape(value) -> str:
    return html.escape(str(value or ""), quote=True)


# LAPAKIN_MALL_PHASE1D_PRODUCT_DETAIL_OG_V1
def _mall_og_price(value) -> str:
    try:
        amount = int(float(value or 0))
        return "Rp " + f"{amount:,}".replace(",", ".")
    except Exception:
        return "Rp 0"


# LAPAKIN_MALL_PHASE1D_PRODUCT_DETAIL_OG_V1
async def _mall_og_listing_payload(listing_id: str, request: Request):
    listing = await db.mall_listings.find_one(
        {
            "$or": [
                {"listing_id": listing_id},
                {"product_id": listing_id},
            ],
            "status": "approved",
            "$and": [
                {"$or": [{"hidden": {"$ne": True}}, {"hidden": {"$exists": False}}]},
            ],
        },
        {"_id": 0},
    )

    if not listing:
        return None

    product = await db.products.find_one({"product_id": listing.get("product_id")}, {"_id": 0}) or {}
    shop = await db.shops.find_one({"shop_id": listing.get("shop_id")}, {"_id": 0}) or {}

    if not product or not shop:
        return None

    shop_status = str(shop.get("status") or "active").lower()
    product_status = str(product.get("status") or "").lower()
    availability = str(product.get("availability_status") or "").lower()

    if shop_status in {"deleted", "suspended", "inactive"}:
        return None

    if product_status in {"hidden", "deleted", "inactive"} or availability in {"hidden", "out_of_stock"} or product.get("is_active") is False:
        return None

    base_url = _mall_og_base_url(request)
    listing_id = listing.get("listing_id") or listing.get("product_id")
    product_id = product.get("product_id") or ""
    # LAPAKIN_MALL_PHASE1E_SUBDOMAIN_READY_V1
    detail_path = f"/p/{listing_id}" if _mall_og_is_mall_host(request) else f"/mall/p/{listing_id}"
    detail_url = f"{base_url}{detail_path}" if base_url else detail_path
    og_image = f"{base_url}/api/og/product/{product_id}/post.png?v=mall-{listing_id}" if base_url and product_id else ""

    category = listing.get("mall_category") or product.get("category_name") or product.get("category") or "Produk UMKM"
    title = f"{product.get('name') or 'Produk'} · Lapakin Mall"
    description = f"{_mall_og_price(product.get('price'))} — {shop.get('name') or 'Toko Lapakin'} · {category}"

    if listing.get("highlight"):
        description = f"{_mall_og_price(product.get('price'))} — {listing.get('highlight')}"

    return {
        "title": title,
        "description": description,
        "detail_url": detail_url,
        "og_image": og_image,
        "listing_id": listing_id,
        "product_id": product_id,
    }


# LAPAKIN_MALL_PHASE1D_PRODUCT_DETAIL_OG_V1
@router.get("/og/mall/{listing_id}", response_class=HTMLResponse)
async def og_mall_listing_html(listing_id: str, request: Request):
    payload = await _mall_og_listing_payload(listing_id, request)

    if not payload:
        fallback = _mall_og_base_url(request) + "/mall"
        return HTMLResponse(
            f"""<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Lapakin Mall</title>
  <meta http-equiv="refresh" content="0; url={_mall_og_escape(fallback)}" />
</head>
<body>
  <a href="{_mall_og_escape(fallback)}">Buka Lapakin Mall</a>
</body>
</html>""",
            status_code=404,
        )

    title = _mall_og_escape(payload["title"])
    description = _mall_og_escape(payload["description"])
    detail_url = _mall_og_escape(payload["detail_url"])
    og_image = _mall_og_escape(payload["og_image"])

    image_tags = ""
    if og_image:
        image_tags = f"""
  <meta property="og:image" content="{og_image}" />
  <meta property="og:image:secure_url" content="{og_image}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1080" />
  <meta property="og:image:height" content="1080" />
  <meta name="twitter:image" content="{og_image}" />"""

    html_doc = f"""<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>{title}</title>
  <link rel="canonical" href="{detail_url}" />
  <meta name="description" content="{description}" />

  <meta property="og:type" content="product" />
  <meta property="og:site_name" content="Lapakin Mall" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{description}" />
  <meta property="og:url" content="{detail_url}" />
  <meta property="og:locale" content="id_ID" />{image_tags}

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{title}" />
  <meta name="twitter:description" content="{description}" />

  <meta http-equiv="refresh" content="0; url={detail_url}" />
  <script>
    window.location.replace("{detail_url}");
  </script>
</head>
<body>
  <main style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px;">
    <h1>{title}</h1>
    <p>{description}</p>
    <p><a href="{detail_url}">Buka produk di Lapakin Mall</a></p>
  </main>
</body>
</html>"""

    return HTMLResponse(html_doc)

