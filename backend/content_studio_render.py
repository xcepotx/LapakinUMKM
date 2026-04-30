"""Pillow-based renderer for Content Studio carousel slides.

Generates 1080x1080 PNG slides for a multi-product Instagram carousel.
3 visual styles: minimal (white), hangat (terracotta brand), bold (dark high-contrast).

Each carousel has:
  - Slide 1: COVER (shop name + tagline + cover image)
  - Slide 2..N: PRODUCT (image + name + price + short description)
  - Slide N+1: CTA (link toko + WhatsApp + "Order via WA")

All slides share the chosen style — colors, typography, accents.
"""
from __future__ import annotations

import base64
import logging
from io import BytesIO
from typing import Optional

import httpx
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from og_render import _try_font, _try_regular_font, _wrap_text

logger = logging.getLogger("lapakin")

SLIDE_SIZE = 1080  # 1:1 IG post


# ---------- Style presets ----------
STYLES = {
    "minimal": {
        "bg": (255, 255, 255),
        "ink": (24, 24, 27),
        "muted": (115, 115, 115),
        "accent": (24, 24, 27),
        "card_bg": (250, 250, 248),
        "card_border": (228, 228, 222),
        "footer_bg": (24, 24, 27),
        "footer_ink": (255, 255, 255),
    },
    "hangat": {
        "bg": (252, 245, 235),         # warm cream
        "ink": (60, 30, 20),
        "muted": (138, 92, 75),
        "accent": (192, 74, 59),       # brand terracotta
        "card_bg": (255, 255, 255),
        "card_border": (235, 215, 195),
        "footer_bg": (192, 74, 59),
        "footer_ink": (255, 255, 255),
    },
    "bold": {
        "bg": (16, 16, 18),            # near-black
        "ink": (255, 255, 255),
        "muted": (170, 170, 175),
        "accent": (255, 220, 0),       # bright yellow
        "card_bg": (32, 32, 36),
        "card_border": (60, 60, 64),
        "footer_bg": (255, 220, 0),
        "footer_ink": (16, 16, 18),
    },
}


# ---------- Asset helpers ----------
async def _fetch_image(url: str) -> Optional[Image.Image]:
    """Fetch image from URL or data: URI. Returns RGBA image or None."""
    if not url:
        return None
    try:
        if url.startswith("data:"):
            header, b64 = url.split(",", 1)
            data = base64.b64decode(b64)
        else:
            async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as c:
                r = await c.get(url)
                if r.status_code != 200:
                    return None
                data = r.content
        img = Image.open(BytesIO(data)).convert("RGBA")
        return img
    except Exception as e:
        logger.info(f"content_studio: fetch_image failed for {url[:80]}: {e}")
        return None


def _fit_cover(img: Image.Image, w: int, h: int) -> Image.Image:
    """Resize + center-crop image to fill (w, h) keeping aspect ratio."""
    src_ratio = img.width / img.height
    tgt_ratio = w / h
    if src_ratio > tgt_ratio:
        new_h = h
        new_w = int(h * src_ratio)
    else:
        new_w = w
        new_h = int(w / src_ratio)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    left = (new_w - w) // 2
    top = (new_h - h) // 2
    return img.crop((left, top, left + w, top + h))


def _round_rect_mask(w: int, h: int, radius: int) -> Image.Image:
    """Return a 'L' mask for rounded rectangle."""
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, w, h), radius=radius, fill=255)
    return mask


def _format_idr(n: int) -> str:
    try:
        return "Rp " + format(int(n), ",d").replace(",", ".")
    except Exception:
        return f"Rp {n}"


# ---------- Slide renderers ----------
def _render_cover(shop: dict, style: dict, cover_img: Optional[Image.Image]) -> Image.Image:
    """Slide 1 — full-bleed cover image with shop name + tagline overlaid."""
    canvas = Image.new("RGBA", (SLIDE_SIZE, SLIDE_SIZE), style["bg"] + (255,))
    if cover_img:
        bg = _fit_cover(cover_img, SLIDE_SIZE, SLIDE_SIZE)
        # Slight blur + dark gradient for legibility
        bg = bg.filter(ImageFilter.GaussianBlur(1.2))
        canvas.paste(bg, (0, 0))
        # Dark gradient overlay (bottom 60%)
        overlay = Image.new("RGBA", (SLIDE_SIZE, SLIDE_SIZE), (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        for y in range(SLIDE_SIZE // 3, SLIDE_SIZE):
            ratio = (y - SLIDE_SIZE // 3) / (SLIDE_SIZE * 2 // 3)
            alpha = int(160 * ratio)
            od.line([(0, y), (SLIDE_SIZE, y)], fill=(0, 0, 0, alpha))
        canvas = Image.alpha_composite(canvas, overlay)

    draw = ImageDraw.Draw(canvas)
    # "KATALOG" pill
    pill_font = _try_font(28)
    pill_text = "KATALOG"
    pbox = draw.textbbox((0, 0), pill_text, font=pill_font)
    pw = (pbox[2] - pbox[0]) + 40
    ph = (pbox[3] - pbox[1]) + 22
    px = 80
    py = 80
    pill_bg = style["accent"] if cover_img is None else (255, 255, 255)
    pill_fg = (255, 255, 255) if cover_img is None else style["accent"]
    draw.rounded_rectangle((px, py, px + pw, py + ph), radius=ph // 2, fill=pill_bg + (255,))
    draw.text((px + 20, py + 8), pill_text, font=pill_font, fill=pill_fg)

    # Shop name (large)
    name = shop.get("name") or "Toko Saya"
    name_color = (255, 255, 255) if cover_img else style["ink"]
    name_font = _try_font(96)
    name_lines = _wrap_text(name, name_font, SLIDE_SIZE - 160, draw)[:2]
    y = SLIDE_SIZE - 280
    for line in name_lines:
        draw.text((80, y), line, font=name_font, fill=name_color + (255,))
        y += 110

    # Tagline
    tagline = shop.get("tagline") or ""
    if tagline:
        tag_font = _try_regular_font(40)
        tag_color = (255, 255, 255, 230) if cover_img else style["muted"] + (255,)
        for line in _wrap_text(tagline, tag_font, SLIDE_SIZE - 160, draw)[:1]:
            draw.text((80, y + 10), line, font=tag_font, fill=tag_color)

    return canvas.convert("RGB")


def _render_product_slide(
    idx: int,
    total: int,
    product: dict,
    shop: dict,
    style: dict,
    product_img: Optional[Image.Image],
) -> Image.Image:
    """Slide N — single product showcase."""
    canvas = Image.new("RGBA", (SLIDE_SIZE, SLIDE_SIZE), style["bg"] + (255,))
    draw = ImageDraw.Draw(canvas)

    # Product image area (top 60%)
    img_h = 640
    if product_img:
        fit = _fit_cover(product_img, SLIDE_SIZE - 80, img_h)
        mask = _round_rect_mask(SLIDE_SIZE - 80, img_h, 36)
        canvas.paste(fit, (40, 60), mask)
    else:
        # Placeholder card
        draw.rounded_rectangle((40, 60, SLIDE_SIZE - 40, 60 + img_h),
                               radius=36, fill=style["card_bg"] + (255,),
                               outline=style["card_border"] + (255,), width=2)
        ph_font = _try_font(72)
        emoji = "📦"
        bbox = draw.textbbox((0, 0), emoji, font=ph_font)
        draw.text(((SLIDE_SIZE - (bbox[2] - bbox[0])) // 2, 60 + img_h // 2 - 50),
                  emoji, font=ph_font, fill=style["muted"] + (255,))

    # Slide counter pill (top-right)
    pos_text = f"{idx}/{total}"
    pos_font = _try_font(24)
    pbox = draw.textbbox((0, 0), pos_text, font=pos_font)
    pw = (pbox[2] - pbox[0]) + 28
    ph = (pbox[3] - pbox[1]) + 18
    draw.rounded_rectangle((SLIDE_SIZE - 60 - pw, 80, SLIDE_SIZE - 60, 80 + ph),
                           radius=ph // 2, fill=(0, 0, 0, 140))
    draw.text((SLIDE_SIZE - 60 - pw + 14, 87), pos_text, font=pos_font, fill=(255, 255, 255, 255))

    # Product info area
    info_top = 60 + img_h + 40

    # Name
    name_font = _try_font(58)
    name = product.get("name") or "Produk"
    name_lines = _wrap_text(name, name_font, SLIDE_SIZE - 160, draw)[:2]
    y = info_top
    for line in name_lines:
        draw.text((80, y), line, font=name_font, fill=style["ink"] + (255,))
        y += 64

    # Price
    price_text = _format_idr(product.get("price") or 0)
    price_font = _try_font(64)
    draw.text((80, y + 10), price_text, font=price_font, fill=style["accent"] + (255,))

    # Slug at bottom
    if shop.get("slug"):
        slug_font = _try_regular_font(26)
        url = f"lapakin.my.id/toko/{shop['slug']}"
        draw.text((80, SLIDE_SIZE - 64), url, font=slug_font, fill=style["muted"] + (255,))

    return canvas.convert("RGB")


def _render_cta_slide(shop: dict, style: dict) -> Image.Image:
    """Slide N+1 — CTA card with shop link + WhatsApp."""
    canvas = Image.new("RGBA", (SLIDE_SIZE, SLIDE_SIZE), style["bg"] + (255,))
    draw = ImageDraw.Draw(canvas)

    # Big "ORDER SEKARANG" headline
    head_font = _try_font(96)
    head_text = "Order Sekarang"
    bbox = draw.textbbox((0, 0), head_text, font=head_font)
    hw = bbox[2] - bbox[0]
    draw.text(((SLIDE_SIZE - hw) // 2, 280), head_text, font=head_font, fill=style["ink"] + (255,))

    sub_font = _try_regular_font(40)
    sub_text = "Klik link toko atau chat WhatsApp"
    bbox2 = draw.textbbox((0, 0), sub_text, font=sub_font)
    sw = bbox2[2] - bbox2[0]
    draw.text(((SLIDE_SIZE - sw) // 2, 400), sub_text, font=sub_font, fill=style["muted"] + (255,))

    # Link toko box
    if shop.get("slug"):
        link_text = f"lapakin.my.id/toko/{shop['slug']}"
        link_font = _try_font(44)
        lbb = draw.textbbox((0, 0), link_text, font=link_font)
        lw = (lbb[2] - lbb[0]) + 64
        lh = 96
        lx = (SLIDE_SIZE - lw) // 2
        ly = 540
        draw.rounded_rectangle((lx, ly, lx + lw, ly + lh),
                               radius=lh // 2, fill=style["accent"] + (255,))
        # Center link text
        ltbb = draw.textbbox((0, 0), link_text, font=link_font)
        ltw = ltbb[2] - ltbb[0]
        # Use footer_ink only for bold (yellow accent + dark ink). Otherwise white.
        link_ink = style["footer_ink"] if style["footer_bg"] == style["accent"] else (255, 255, 255)
        draw.text(((SLIDE_SIZE - ltw) // 2, ly + 22), link_text,
                  font=link_font, fill=link_ink + (255,))

    # WhatsApp box
    if shop.get("whatsapp"):
        wa = shop["whatsapp"]
        wa_label = f"WA: {wa}"
        wa_font = _try_regular_font(36)
        wbb = draw.textbbox((0, 0), wa_label, font=wa_font)
        ww = wbb[2] - wbb[0]
        draw.text(((SLIDE_SIZE - ww) // 2, 700), wa_label,
                  font=wa_font, fill=style["ink"] + (255,))

    # Footer powered by Lapakin
    foot_font = _try_regular_font(24)
    foot_text = "Toko online dibuat dengan Lapakin"
    fbb = draw.textbbox((0, 0), foot_text, font=foot_font)
    fw = fbb[2] - fbb[0]
    draw.text(((SLIDE_SIZE - fw) // 2, 980), foot_text,
              font=foot_font, fill=style["muted"] + (255,))

    return canvas.convert("RGB")


# ---------- Public API ----------
async def render_carousel(shop: dict, products: list, style_name: str = "hangat") -> list:
    """Render a full carousel: cover + product slides + CTA.
    Returns list of dicts: [{filename, png_b64, content_type}].
    """
    style = STYLES.get(style_name) or STYLES["hangat"]

    # Pre-fetch images in parallel
    cover_img = await _fetch_image(shop.get("cover_image") or "")
    product_imgs = []
    for p in products:
        first_img = (p.get("images") or [None])[0] if p.get("images") else None
        product_imgs.append(await _fetch_image(first_img or ""))

    slides = []
    # 1. Cover
    cover = _render_cover(shop, style, cover_img)
    slides.append(("01_cover.png", cover))

    # 2. Product slides
    total = len(products)
    for i, (p, pimg) in enumerate(zip(products, product_imgs), start=1):
        s = _render_product_slide(i, total, p, shop, style, pimg)
        slides.append((f"{i + 1:02d}_{(p.get('name') or 'produk')[:30]}.png", s))

    # 3. CTA
    cta = _render_cta_slide(shop, style)
    slides.append((f"{len(slides) + 1:02d}_cta.png", cta))

    # Encode to base64 PNG
    out = []
    for fname, im in slides:
        buf = BytesIO()
        im.save(buf, format="PNG", optimize=True)
        out.append({
            "filename": fname,
            "png_b64": base64.b64encode(buf.getvalue()).decode("ascii"),
            "content_type": "image/png",
        })
    return out
