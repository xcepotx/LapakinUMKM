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
import re

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



# LAPAKIN_CONTENT_STUDIO_PREMIUM_RENDERER_V1
def _rgba(rgb, alpha: int = 255):
    return rgb + (alpha,)


# LAPAKIN_CONTENT_STUDIO_PREMIUM_RENDERER_V1
def _mix_rgb(a, b, t: float):
    t = max(0.0, min(1.0, t))
    return (
        int(a[0] + (b[0] - a[0]) * t),
        int(a[1] + (b[1] - a[1]) * t),
        int(a[2] + (b[2] - a[2]) * t),
    )


# LAPAKIN_CONTENT_STUDIO_PREMIUM_RENDERER_V1
def _is_dark_style(style: dict) -> bool:
    bg = style.get("bg") or (255, 255, 255)
    return (bg[0] * 0.299 + bg[1] * 0.587 + bg[2] * 0.114) < 90


# LAPAKIN_CONTENT_STUDIO_PREMIUM_RENDERER_V1
def _clean_text(value, limit: int = 140) -> str:
    value = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 1)].rstrip() + "…"


# LAPAKIN_CONTENT_STUDIO_PREMIUM_RENDERER_V1
def _product_description(product: dict, limit: int = 112) -> str:
    return _clean_text(
        product.get("description")
        or product.get("caption")
        or product.get("short_description")
        or "Pilihan favorit yang siap bikin pelanggan balik lagi.",
        limit,
    )


# LAPAKIN_CONTENT_STUDIO_PREMIUM_RENDERER_V1
def _product_category(product: dict) -> str:
    value = (
        product.get("category_name")
        or product.get("category")
        or product.get("type")
        or "Pilihan"
    )
    return _clean_text(value, 18).upper()


# LAPAKIN_CONTENT_STUDIO_PREMIUM_RENDERER_V1
def _shop_url(shop: dict) -> str:
    slug = shop.get("slug") or ""
    return f"lapakin.my.id/toko/{slug}" if slug else "lapakin.my.id"


# LAPAKIN_CONTENT_STUDIO_PREMIUM_RENDERER_V1
def _shadowed_round_rect(
    canvas: Image.Image,
    box,
    radius: int,
    fill,
    outline=None,
    width: int = 1,
    shadow=(42, 24, 16, 38),
    blur: int = 22,
    offset=(0, 12),
):
    sx1, sy1, sx2, sy2 = box
    shadow_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    sd.rounded_rectangle(
        (sx1 + offset[0], sy1 + offset[1], sx2 + offset[0], sy2 + offset[1]),
        radius=radius,
        fill=shadow,
    )
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(shadow_layer)

    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


# LAPAKIN_CONTENT_STUDIO_PREMIUM_RENDERER_V1
def _draw_capsule(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, font, bg, fg, padx=22, pady=10):
    text = str(text or "")
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    w = tw + padx * 2
    h = th + pady * 2
    draw.rounded_rectangle((x, y, x + w, y + h), radius=h // 2, fill=bg)
    draw.text((x + padx, y + pady - 1), text, font=font, fill=fg)
    return w, h


# LAPAKIN_CONTENT_STUDIO_PREMIUM_RENDERER_V1
def _draw_centered_text(draw, text, y, font, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((SLIDE_SIZE - tw) // 2, y), text, font=font, fill=fill)


# LAPAKIN_CONTENT_STUDIO_PREMIUM_RENDERER_V1
def _draw_premium_background(canvas: Image.Image, style: dict):
    d = ImageDraw.Draw(canvas, "RGBA")
    bg = style["bg"]
    accent = style["accent"]
    dark = _is_dark_style(style)

    if dark:
        d.rectangle((0, 0, SLIDE_SIZE, SLIDE_SIZE), fill=_rgba(bg, 255))
        d.ellipse((-260, -220, 420, 460), fill=_rgba(accent, 28))
        d.ellipse((700, 650, 1340, 1260), fill=_rgba(accent, 30))
        d.ellipse((620, -180, 1260, 360), fill=(255, 255, 255, 10))
    else:
        top = _mix_rgb(bg, (255, 255, 255), 0.35)
        bottom = _mix_rgb(bg, accent, 0.06)
        for y in range(SLIDE_SIZE):
            ratio = y / max(1, SLIDE_SIZE - 1)
            col = _mix_rgb(top, bottom, ratio)
            d.line((0, y, SLIDE_SIZE, y), fill=_rgba(col, 255))

        d.ellipse((-230, -220, 430, 420), fill=_rgba(accent, 22))
        d.ellipse((720, -180, 1320, 390), fill=_rgba(accent, 20))
        d.ellipse((680, 670, 1320, 1250), fill=_rgba((255, 255, 255), 130))


# LAPAKIN_CONTENT_STUDIO_PREMIUM_RENDERER_V1
def _paste_rounded_image(canvas: Image.Image, img: Image.Image, box, radius: int):
    x1, y1, x2, y2 = box
    fit = _fit_cover(img, x2 - x1, y2 - y1)
    mask = _round_rect_mask(x2 - x1, y2 - y1, radius)
    canvas.paste(fit, (x1, y1), mask)

# ---------- Slide renderers ----------
def _render_cover(shop: dict, style: dict, cover_img: Optional[Image.Image]) -> Image.Image:
    """Slide 1 — premium editorial cover."""
    canvas = Image.new("RGBA", (SLIDE_SIZE, SLIDE_SIZE), style["bg"] + (255,))
    _draw_premium_background(canvas, style)

    draw = ImageDraw.Draw(canvas, "RGBA")
    dark = _is_dark_style(style)
    ink = style["ink"]
    muted = style["muted"]
    accent = style["accent"]

    # Hero image card
    hero_box = (72, 96, SLIDE_SIZE - 72, 604)
    card_fill = (24, 24, 26, 235) if dark else (255, 252, 247, 245)
    card_outline = _rgba(style["card_border"], 255)
    _shadowed_round_rect(
        canvas,
        hero_box,
        radius=46,
        fill=card_fill,
        outline=card_outline,
        width=2,
        shadow=(0, 0, 0, 90 if dark else 38),
        blur=28,
        offset=(0, 18),
    )

    if cover_img:
        _paste_rounded_image(canvas, cover_img, (92, 116, SLIDE_SIZE - 92, 584), 34)
        # Soft editorial fade so text area still feels connected
        fade = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        fd = ImageDraw.Draw(fade, "RGBA")
        for y in range(360, 610):
            ratio = (y - 360) / 250
            fd.line((92, y, SLIDE_SIZE - 92, y), fill=(0, 0, 0, int(48 * ratio)))
        canvas.alpha_composite(fade)
    else:
        ph_font = _try_font(86)
        _draw_centered_text(draw, "Katalog", 300, ph_font, _rgba(muted, 180))

    pill_font = _try_font(26)
    _draw_capsule(
        draw,
        92,
        124,
        "KATALOG PILIHAN",
        pill_font,
        _rgba((255, 255, 255), 238) if cover_img else _rgba(accent, 255),
        _rgba(accent, 255) if cover_img else _rgba(style["footer_ink"], 255),
        padx=22,
        pady=10,
    )

    # Bottom editorial panel
    panel_box = (72, 650, SLIDE_SIZE - 72, 990)
    _shadowed_round_rect(
        canvas,
        panel_box,
        radius=46,
        fill=(20, 20, 22, 236) if dark else (255, 255, 255, 238),
        outline=_rgba(style["card_border"], 220),
        width=2,
        shadow=(0, 0, 0, 70 if dark else 26),
        blur=24,
        offset=(0, 12),
    )

    name = shop.get("name") or "Toko Saya"
    tagline = shop.get("tagline") or "Pilihan produk terbaik dari toko kami."

    label_font = _try_font(24)
    draw.text((118, 692), "CONTENT STUDIO", font=label_font, fill=_rgba(accent, 255))

    name_font = _try_font(78)
    y = 730
    for line in _wrap_text(name, name_font, 830, draw)[:2]:
        draw.text((116, y), line, font=name_font, fill=_rgba(ink, 255))
        y += 82

    tag_font = _try_regular_font(34)
    for line in _wrap_text(tagline, tag_font, 820, draw)[:2]:
        draw.text((118, y + 8), line, font=tag_font, fill=_rgba(muted, 255))
        y += 42

    foot_font = _try_regular_font(25)
    draw.text((118, 944), _shop_url(shop), font=foot_font, fill=_rgba(muted, 230))

    return canvas.convert("RGB")



def _render_product_slide(
    idx: int,
    total: int,
    product: dict,
    shop: dict,
    style: dict,
    product_img: Optional[Image.Image],
) -> Image.Image:
    """Slide N — premium product showcase."""
    canvas = Image.new("RGBA", (SLIDE_SIZE, SLIDE_SIZE), style["bg"] + (255,))
    _draw_premium_background(canvas, style)

    draw = ImageDraw.Draw(canvas, "RGBA")
    dark = _is_dark_style(style)
    ink = style["ink"]
    muted = style["muted"]
    accent = style["accent"]

    # Top mini brand row
    pill_font = _try_font(23)
    _draw_capsule(
        draw,
        72,
        62,
        _product_category(product),
        pill_font,
        _rgba(accent, 255),
        _rgba(style["footer_ink"], 255),
        padx=20,
        pady=9,
    )

    pos_font = _try_font(24)
    pos_text = f"{idx}/{total}"
    pbox = draw.textbbox((0, 0), pos_text, font=pos_font)
    pw = (pbox[2] - pbox[0]) + 30
    ph = (pbox[3] - pbox[1]) + 18
    draw.rounded_rectangle(
        (SLIDE_SIZE - 72 - pw, 62, SLIDE_SIZE - 72, 62 + ph),
        radius=ph // 2,
        fill=(0, 0, 0, 175) if not dark else (255, 255, 255, 36),
    )
    draw.text(
        (SLIDE_SIZE - 72 - pw + 15, 69),
        pos_text,
        font=pos_font,
        fill=(255, 255, 255, 255),
    )

    # Hero product image
    hero_box = (72, 118, SLIDE_SIZE - 72, 628)
    _shadowed_round_rect(
        canvas,
        hero_box,
        radius=46,
        fill=(28, 28, 30, 235) if dark else (255, 255, 255, 245),
        outline=_rgba(style["card_border"], 240),
        width=2,
        shadow=(0, 0, 0, 100 if dark else 42),
        blur=30,
        offset=(0, 18),
    )

    if product_img:
        _paste_rounded_image(canvas, product_img, (92, 138, SLIDE_SIZE - 92, 608), 34)
    else:
        ph_font = _try_font(76)
        _draw_centered_text(draw, "Produk", 344, ph_font, _rgba(muted, 210))

    # Info card overlapping bottom area
    info_box = (72, 588, SLIDE_SIZE - 72, 1008)
    _shadowed_round_rect(
        canvas,
        info_box,
        radius=52,
        fill=(20, 20, 22, 244) if dark else (255, 252, 247, 248),
        outline=_rgba(style["card_border"], 235),
        width=2,
        shadow=(0, 0, 0, 95 if dark else 30),
        blur=26,
        offset=(0, 12),
    )

    # Small sales badge
    sale_font = _try_font(24)
    _draw_capsule(
        draw,
        118,
        630,
        "SIAP PESAN",
        sale_font,
        _rgba(accent, 255),
        _rgba(style["footer_ink"], 255),
        padx=20,
        pady=9,
    )

    # Name
    name_font = _try_font(66)
    name = product.get("name") or "Produk"
    y = 690
    for line in _wrap_text(name, name_font, 820, draw)[:2]:
        draw.text((116, y), line, font=name_font, fill=_rgba(ink, 255))
        y += 72

    # Price
    price_text = _format_idr(product.get("price") or 0)
    price_font = _try_font(76)
    draw.text((116, y + 6), price_text, font=price_font, fill=_rgba(accent, 255))
    y += 96

    # Description / selling point
    desc = _product_description(product)
    desc_font = _try_regular_font(31)
    for line in _wrap_text(desc, desc_font, 790, draw)[:2]:
        draw.text((118, y), line, font=desc_font, fill=_rgba(muted, 255))
        y += 40

    # Footer line
    footer_y = 956
    draw.line((118, footer_y - 24, SLIDE_SIZE - 118, footer_y - 24), fill=_rgba(style["card_border"], 180), width=2)

    url_font = _try_regular_font(25)
    draw.text((118, footer_y), _shop_url(shop), font=url_font, fill=_rgba(muted, 225))

    tiny_font = _try_font(23)
    cta_text = "Order via toko"
    cbox = draw.textbbox((0, 0), cta_text, font=tiny_font)
    cw = cbox[2] - cbox[0] + 36
    ch = cbox[3] - cbox[1] + 20
    cx = SLIDE_SIZE - 118 - cw
    cy = footer_y - 4
    draw.rounded_rectangle((cx, cy, cx + cw, cy + ch), radius=ch // 2, fill=_rgba(accent, 255))
    draw.text((cx + 18, cy + 9), cta_text, font=tiny_font, fill=_rgba(style["footer_ink"], 255))

    return canvas.convert("RGB")



def _render_cta_slide(shop: dict, style: dict) -> Image.Image:
    """Slide N+1 — premium closing CTA."""
    canvas = Image.new("RGBA", (SLIDE_SIZE, SLIDE_SIZE), style["bg"] + (255,))
    _draw_premium_background(canvas, style)

    draw = ImageDraw.Draw(canvas, "RGBA")
    dark = _is_dark_style(style)
    ink = style["ink"]
    muted = style["muted"]
    accent = style["accent"]

    # Central premium card
    card_box = (84, 118, SLIDE_SIZE - 84, 952)
    _shadowed_round_rect(
        canvas,
        card_box,
        radius=64,
        fill=(20, 20, 22, 244) if dark else (255, 252, 247, 248),
        outline=_rgba(style["card_border"], 240),
        width=2,
        shadow=(0, 0, 0, 100 if dark else 34),
        blur=30,
        offset=(0, 18),
    )

    pill_font = _try_font(25)
    _draw_capsule(
        draw,
        132,
        170,
        "ORDER ONLINE",
        pill_font,
        _rgba(accent, 255),
        _rgba(style["footer_ink"], 255),
        padx=22,
        pady=10,
    )

    head_font = _try_font(86)
    headline = "Siap pesan hari ini?"
    y = 255
    for line in _wrap_text(headline, head_font, 790, draw)[:2]:
        draw.text((132, y), line, font=head_font, fill=_rgba(ink, 255))
        y += 94

    sub_font = _try_regular_font(38)
    sub_text = "Klik link toko, pilih menu favorit, lalu lanjut order via WhatsApp."
    for line in _wrap_text(sub_text, sub_font, 760, draw)[:3]:
        draw.text((136, y + 12), line, font=sub_font, fill=_rgba(muted, 255))
        y += 46

    # Link CTA
    link_text = _shop_url(shop)
    link_font = _try_font(39)
    link_box = (132, 570, SLIDE_SIZE - 132, 676)
    draw.rounded_rectangle(link_box, radius=34, fill=_rgba(accent, 255))
    lbb = draw.textbbox((0, 0), link_text, font=link_font)
    ltw = lbb[2] - lbb[0]
    draw.text(
        ((SLIDE_SIZE - ltw) // 2, 601),
        link_text,
        font=link_font,
        fill=_rgba(style["footer_ink"], 255),
    )

    # WA / trust rows
    row_font = _try_regular_font(32)
    row_y = 735
    rows = ["Menu langsung dari toko", "Cocok untuk order cepat", "Dibuat otomatis dengan Lapakin"]
    if shop.get("whatsapp"):
        rows[1] = f"WhatsApp: {shop.get('whatsapp')}"

    for item in rows:
        draw.ellipse((136, row_y + 8, 158, row_y + 30), fill=_rgba(accent, 255))
        draw.text((176, row_y), item, font=row_font, fill=_rgba(ink, 235))
        row_y += 54

    foot_font = _try_regular_font(25)
    foot_text = shop.get("name") or "Toko online"
    draw.text((136, 895), foot_text, font=foot_font, fill=_rgba(muted, 230))

    return canvas.convert("RGB")




# LAPAKIN_CONTENT_STUDIO_PROMO_TOGGLE_V1
def _normalize_content_studio_promo(promo) -> dict:
    if not isinstance(promo, dict):
        return {"enabled": False}

    enabled = bool(promo.get("enabled"))
    title = _clean_text(promo.get("title") or "Promo Spesial", 48) if "_clean_text" in globals() else str(promo.get("title") or "Promo Spesial")[:48]
    description = _clean_text(promo.get("description") or "Ada penawaran spesial untuk pembelian hari ini.", 150) if "_clean_text" in globals() else str(promo.get("description") or "Ada penawaran spesial untuk pembelian hari ini.")[:150]
    use_code = bool(promo.get("use_code"))
    code = re.sub(r"[^A-Za-z0-9_-]", "", str(promo.get("code") or "").strip().upper())[:24]
    note = _clean_text(promo.get("note") or "Berlaku sesuai ketentuan toko.", 90) if "_clean_text" in globals() else str(promo.get("note") or "Berlaku sesuai ketentuan toko.")[:90]

    return {
        "enabled": enabled,
        "title": title,
        "description": description,
        "use_code": use_code,
        "code": code,
        "note": note,
    }


# LAPAKIN_CONTENT_STUDIO_PROMO_TOGGLE_V1
def _render_promo_slide(shop: dict, style: dict, promo: dict) -> Image.Image:
    """Optional premium promo slide."""
    canvas = Image.new("RGBA", (SLIDE_SIZE, SLIDE_SIZE), style["bg"] + (255,))

    if "_draw_premium_background" in globals():
        _draw_premium_background(canvas, style)

    draw = ImageDraw.Draw(canvas, "RGBA")

    def rgba(rgb, alpha=255):
        return rgb + (alpha,)

    def is_dark():
        bg = style.get("bg") or (255, 255, 255)
        return (bg[0] * 0.299 + bg[1] * 0.587 + bg[2] * 0.114) < 90

    def shop_url():
        if "_shop_url" in globals():
            return _shop_url(shop)
        slug = shop.get("slug") or ""
        return f"lapakin.my.id/toko/{slug}" if slug else "lapakin.my.id"

    dark = is_dark()
    ink = style["ink"]
    muted = style["muted"]
    accent = style["accent"]

    # Fallback decorative background if premium helper is not available.
    if "_draw_premium_background" not in globals():
        draw.rectangle((0, 0, SLIDE_SIZE, SLIDE_SIZE), fill=rgba(style["bg"], 255))
        draw.ellipse((-260, -240, 430, 430), fill=rgba(accent, 28))
        draw.ellipse((700, 690, 1320, 1260), fill=rgba(accent, 24))

    card_box = (82, 118, SLIDE_SIZE - 82, 952)

    if "_shadowed_round_rect" in globals():
        _shadowed_round_rect(
            canvas,
            card_box,
            radius=64,
            fill=(20, 20, 22, 244) if dark else (255, 252, 247, 248),
            outline=rgba(style["card_border"], 240),
            width=2,
            shadow=(0, 0, 0, 100 if dark else 34),
            blur=30,
            offset=(0, 18),
        )
    else:
        draw.rounded_rectangle(
            card_box,
            radius=64,
            fill=(20, 20, 22, 244) if dark else (255, 252, 247, 248),
            outline=rgba(style["card_border"], 240),
            width=2,
        )

    # Badge
    badge_font = _try_font(25)
    if "_draw_capsule" in globals():
        _draw_capsule(
            draw,
            132,
            170,
            "PROMO SPESIAL",
            badge_font,
            rgba(accent, 255),
            rgba(style["footer_ink"], 255),
            padx=22,
            pady=10,
        )
    else:
        draw.rounded_rectangle((132, 170, 386, 218), radius=24, fill=rgba(accent, 255))
        draw.text((154, 181), "PROMO SPESIAL", font=badge_font, fill=rgba(style["footer_ink"], 255))

    # Headline
    title_font = _try_font(88)
    y = 265
    for line in _wrap_text(promo.get("title") or "Promo Spesial", title_font, 790, draw)[:2]:
        draw.text((132, y), line, font=title_font, fill=rgba(ink, 255))
        y += 94

    # Description
    desc_font = _try_regular_font(38)
    for line in _wrap_text(promo.get("description") or "Ada penawaran spesial untuk pembelian hari ini.", desc_font, 760, draw)[:3]:
        draw.text((136, y + 10), line, font=desc_font, fill=rgba(muted, 255))
        y += 48

    # Code / no-code box
    box_y = 565
    code_box = (132, box_y, SLIDE_SIZE - 132, box_y + 156)
    draw.rounded_rectangle(code_box, radius=42, fill=rgba(accent, 255))

    if promo.get("use_code") and promo.get("code"):
        small_font = _try_font(26)
        code_font = _try_font(72)
        draw.text((174, box_y + 30), "PAKAI KODE PROMO", font=small_font, fill=rgba(style["footer_ink"], 225))
        code = promo.get("code")
        cbb = draw.textbbox((0, 0), code, font=code_font)
        cw = cbb[2] - cbb[0]
        draw.text(((SLIDE_SIZE - cw) // 2, box_y + 68), code, font=code_font, fill=rgba(style["footer_ink"], 255))
    else:
        no_code_font = _try_font(48)
        text = "Tanpa kode promo"
        tbb = draw.textbbox((0, 0), text, font=no_code_font)
        tw = tbb[2] - tbb[0]
        draw.text(((SLIDE_SIZE - tw) // 2, box_y + 52), text, font=no_code_font, fill=rgba(style["footer_ink"], 255))

    # Note
    note_font = _try_regular_font(31)
    note = promo.get("note") or "Berlaku sesuai ketentuan toko."
    note_y = 765
    for line in _wrap_text(note, note_font, 760, draw)[:2]:
        draw.text((136, note_y), line, font=note_font, fill=rgba(muted, 255))
        note_y += 40

    # Footer
    footer_font = _try_regular_font(25)
    draw.line((136, 874, SLIDE_SIZE - 136, 874), fill=rgba(style["card_border"], 180), width=2)
    draw.text((136, 900), shop_url(), font=footer_font, fill=rgba(muted, 230))

    return canvas.convert("RGB")

# ---------- Public API ----------
async def render_carousel(shop: dict, products: list, style_name: str = "hangat", promo: Optional[dict] = None) -> list:
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

    # 3. Promo optional
    promo_data = _normalize_content_studio_promo(promo)
    if promo_data.get("enabled"):
        promo_slide = _render_promo_slide(shop, style, promo_data)
        slides.append((f"{len(slides) + 1:02d}_promo.png", promo_slide))

    # 4. CTA
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
