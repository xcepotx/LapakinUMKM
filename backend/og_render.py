"""Pillow-based rendering for OpenGraph shop images + Toko Cards (IG post/story).
Also owns the in-memory OG PNG cache (shared by routes)."""
import base64
import hashlib
import logging
from io import BytesIO
from typing import Optional

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger("lapakin")

# Module-level cache: shop_id → (png_bytes, cover_hash, timestamp_epoch)
OG_PNG_CACHE: dict = {}
OG_CACHE_TTL = 600  # 10 minutes


# ---------- Helpers ----------
def cover_hash(cover: str) -> str:
    if not cover:
        return ""
    return hashlib.md5(cover[:200].encode("utf-8", errors="ignore")).hexdigest()[:12]


def hex_to_rgb(hex_color: str) -> tuple:
    h = (hex_color or "#C04A3B").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
    except Exception:
        return (192, 74, 59)


def _try_font(size: int):
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _try_regular_font(size: int):
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _wrap_text(text: str, font, max_width: int, draw):
    """Word-wrap text to fit max_width, returning list of lines."""
    if not text:
        return []
    words = text.split()
    lines, cur = [], ""
    for w in words:
        candidate = (cur + " " + w).strip()
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if (bbox[2] - bbox[0]) <= max_width:
            cur = candidate
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _decode_image(data_url_or_b64: str) -> Optional[Image.Image]:
    if not data_url_or_b64:
        return None
    try:
        s = data_url_or_b64
        if "," in s and s.startswith("data:"):
            s = s.split(",", 1)[1]
        raw = base64.b64decode(s)
        return Image.open(BytesIO(raw)).convert("RGB")
    except Exception:
        return None


# ---------- OG shop image (1200x630) ----------
def generate_fallback_og_image(shop_name: str, tagline: str, brand_hex: str) -> bytes:
    """Generate a 1200x630 OG image when shop has no cover_image."""
    W, H = 1200, 630
    bg = hex_to_rgb(brand_hex)
    img = Image.new("RGB", (W, H), bg)
    draw = ImageDraw.Draw(img)

    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for i in range(120):
        alpha = int(60 * (1 - i / 120))
        od.ellipse((W - 600 - i, -300 - i, W + 200 + i, 300 + i), fill=(255, 255, 255, alpha))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)

    title_font = _try_font(96)
    tag_font = _try_font(40)
    small_font = _try_font(28)

    # Avatar circle with first letter
    initial = (shop_name or "L")[0].upper()
    cx, cy, r = 130, 130, 60
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255))
    bbox = draw.textbbox((0, 0), initial, font=_try_font(70))
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((cx - tw / 2, cy - th / 2 - 10), initial, fill=bg, font=_try_font(70))

    name = (shop_name or "Toko Lapakin")[:40]
    draw.text((90, 240), name, fill=(255, 255, 255), font=title_font)

    if tagline:
        tag = tagline[:80]
        draw.text((90, 360), tag, fill=(255, 255, 255, 220), font=tag_font)

    draw.text((90, 540), "Lapakin · Toko online UMKM Indonesia",
              fill=(255, 255, 255, 200), font=small_font)

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def decode_data_url_png(data_url: str) -> Optional[bytes]:
    """Convert base64 data URL (any image type) to PNG bytes resized to 1200x630."""
    try:
        if not data_url:
            return None
        if "," in data_url:
            data_url = data_url.split(",", 1)[1]
        raw = base64.b64decode(data_url)
        img = Image.open(BytesIO(raw)).convert("RGB")
        target_ratio = 1200 / 630
        w, h = img.size
        ratio = w / h
        if ratio > target_ratio:
            new_w = int(h * target_ratio)
            left = (w - new_w) // 2
            img = img.crop((left, 0, left + new_w, h))
        else:
            new_h = int(w / target_ratio)
            top = (h - new_h) // 2
            img = img.crop((0, top, w, top + new_h))
        img = img.resize((1200, 630), Image.LANCZOS)
        out = BytesIO()
        img.save(out, format="PNG", optimize=True)
        return out.getvalue()
    except Exception as e:
        logger.warning(f"Failed to decode cover image: {e}")
        return None


# ---------- Toko Cards (IG Post / Story) ----------
def render_product_card(product: dict, shop: dict, format_type: str) -> bytes:
    """Render product as IG post (1080x1080) or story (1080x1920)."""
    brand_rgb = hex_to_rgb(shop.get("brand_color") or "#C04A3B")
    shop_name = shop.get("name") or "Toko"
    product_name = product.get("name") or "Produk"
    price = product.get("price") or 0
    tagline = (shop.get("tagline") or "")[:80]

    imgs = product.get("images") or ([product["image_data"]] if product.get("image_data") else [])
    primary = _decode_image(imgs[0]) if imgs else None

    if format_type == "post":
        W, H = 1080, 1080
        img_h = 700
    else:  # story
        W, H = 1080, 1920
        img_h = 1300

    canvas = Image.new("RGB", (W, H), brand_rgb)

    if primary:
        pw, ph = primary.size
        target_ratio = W / img_h
        ratio = pw / ph
        if ratio > target_ratio:
            new_w = int(ph * target_ratio)
            left = (pw - new_w) // 2
            primary = primary.crop((left, 0, left + new_w, ph))
        else:
            new_h = int(pw / target_ratio)
            top = (ph - new_h) // 2
            primary = primary.crop((0, top, pw, top + new_h))
        primary = primary.resize((W, img_h), Image.LANCZOS)
        canvas.paste(primary, (0, 0))
    else:
        draw_p = ImageDraw.Draw(canvas)
        for y in range(img_h):
            mix = y / img_h
            r = int(brand_rgb[0] * (1 - mix * 0.2))
            g = int(brand_rgb[1] * (1 - mix * 0.2))
            b = int(brand_rgb[2] * (1 - mix * 0.2))
            draw_p.line([(0, y), (W, y)], fill=(r, g, b))

    panel = Image.new("RGB", (W, H - img_h), (255, 255, 255))
    canvas.paste(panel, (0, img_h))
    draw = ImageDraw.Draw(canvas)

    # Top brand strip on photo
    strip_h = 80
    strip = Image.new("RGBA", (W, strip_h), (0, 0, 0, 100))
    canvas.paste(Image.alpha_composite(canvas.crop((0, 0, W, strip_h)).convert("RGBA"), strip), (0, 0))
    draw_strip = ImageDraw.Draw(canvas)
    initial = (shop_name or "L")[0].upper()
    cx, cy, r = 50, strip_h // 2, 24
    draw_strip.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255))
    bbox = draw_strip.textbbox((0, 0), initial, font=_try_font(28))
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw_strip.text((cx - tw / 2, cy - th / 2 - 3), initial, fill=brand_rgb, font=_try_font(28))
    draw_strip.text((90, cy - 18), shop_name[:28], fill=(255, 255, 255), font=_try_font(32))

    pad_x = 60
    content_y = img_h + 50
    name_font = _try_font(64 if format_type == "post" else 80)
    price_font = _try_font(80 if format_type == "post" else 100)
    tag_font = _try_regular_font(28 if format_type == "post" else 36)
    foot_font = _try_regular_font(24 if format_type == "post" else 30)

    name_lines = _wrap_text(product_name, name_font, W - 2 * pad_x, draw)[:2]
    for i, line in enumerate(name_lines):
        draw.text((pad_x, content_y + i * (name_font.size + 8)), line, fill=(30, 30, 30), font=name_font)
    content_y += len(name_lines) * (name_font.size + 8) + 25

    price_text = f"Rp {price:,}".replace(",", ".")
    draw.text((pad_x, content_y), price_text, fill=brand_rgb, font=price_font)
    content_y += price_font.size + 30

    if tagline:
        tag_lines = _wrap_text(tagline, tag_font, W - 2 * pad_x, draw)[:2]
        for i, line in enumerate(tag_lines):
            draw.text((pad_x, content_y + i * (tag_font.size + 6)), line, fill=(110, 110, 110), font=tag_font)

    footer_text = f"lapakin.id/toko/{shop.get('slug', '')}"
    fb = draw.textbbox((0, 0), footer_text, font=foot_font)
    fw = fb[2] - fb[0]
    draw.text((W - pad_x - fw, H - 50 - foot_font.size), footer_text, fill=(160, 160, 160), font=foot_font)

    buf = BytesIO()
    canvas.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
