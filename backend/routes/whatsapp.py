"""WhatsApp Bot routes (Twilio-powered, optional)."""
import os
import re
import base64
import uuid
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

from deps import (
    db, logger, require_user,
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM,
)

router = APIRouter()


# ---------- Twilio helpers ----------
def _twilio_client():
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN):
        return None
    try:
        from twilio.rest import Client as TwilioClient
        return TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    except Exception:
        logger.exception("Twilio client init failed")
        return None


def _normalize_wa_number(num: str) -> str:
    n = (num or "").replace("whatsapp:", "").strip()
    n = re.sub(r"[^\d+]", "", n)
    return n


async def _wa_send(to: str, body: str):
    cli = _twilio_client()
    if not cli or not TWILIO_WHATSAPP_FROM:
        logger.info("[WA-NOOP→%s] %s", to, body)
        return
    try:
        cli.messages.create(from_=TWILIO_WHATSAPP_FROM,
                            to=f"whatsapp:{_normalize_wa_number(to)}",
                            body=body)
    except Exception:
        logger.exception("Twilio send failed")


async def _download_media(url: str) -> Optional[str]:
    """Download Twilio media URL (basic-auth) and return base64 string."""
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN):
        return None
    try:
        async with httpx.AsyncClient(timeout=30, auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)) as cx:
            r = await cx.get(url)
        if r.status_code != 200:
            return None
        return base64.b64encode(r.content).decode("ascii")
    except Exception:
        logger.exception("Twilio media download failed")
        return None


def _parse_product_text(text: str):
    """Parse free-form Indonesian text like 'Kopi Susu Aren 25000 stok 20'.
    Returns (name, price, stock)."""
    if not text:
        return None, 0, 0
    raw = text.strip()
    stock_match = re.search(r"(?:stok|stock)\s*[:=]?\s*(\d{1,5})", raw, re.IGNORECASE)
    stock = int(stock_match.group(1)) if stock_match else 0
    if stock_match:
        raw = raw[:stock_match.start()].strip()
    price_match = re.search(
        r"(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(rb|ribu|k)?",
        raw, re.IGNORECASE
    )
    price = 0
    if price_match:
        num = price_match.group(1).replace(".", "").replace(",", "")
        try:
            price = int(num)
            unit = (price_match.group(2) or "").lower()
            if unit in ("rb", "ribu", "k"):
                price *= 1000
        except Exception:
            pass
        raw = (raw[:price_match.start()] + raw[price_match.end():]).strip()
    name = re.sub(r"\s+", " ", raw).strip(" -:.,") or "Produk Baru"
    return name, price, stock


# ---------- Routes ----------
@router.post("/whatsapp/connect/start")
async def whatsapp_connect_start(request: Request):
    """Generate a 6-digit pairing code. Owner sends 'lapakin <code>' via WhatsApp to our Twilio number."""
    user = await require_user(request)
    code = f"{secrets.randbelow(900000) + 100000}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    await db.wa_pair_codes.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"user_id": user["user_id"], "code": code,
                  "expires_at": expires_at, "used": False,
                  "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    sandbox_hint = TWILIO_WHATSAPP_FROM or "whatsapp:+14155238886 (Twilio sandbox)"
    return {
        "code": code,
        "expires_in_minutes": 15,
        "instructions": (
            f"Kirim WhatsApp ke {sandbox_hint} dengan pesan: "
            f"\"lapakin {code}\". Setelah terhubung, kamu bisa langsung kirim "
            f"foto + nama produk + harga ke nomor itu."
        ),
        "twilio_configured": bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM),
    }


@router.get("/whatsapp/status")
async def whatsapp_status(request: Request):
    user = await require_user(request)
    link = await db.wa_links.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {
        "linked": bool(link),
        "phone": link.get("phone") if link else None,
        "linked_at": link.get("linked_at") if link else None,
        "twilio_configured": bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM),
    }


@router.post("/whatsapp/disconnect")
async def whatsapp_disconnect(request: Request):
    user = await require_user(request)
    await db.wa_links.delete_one({"user_id": user["user_id"]})
    return {"ok": True}


@router.post("/whatsapp/webhook")
async def whatsapp_webhook(request: Request):
    """Twilio webhook (form-encoded POST). Returns TwiML XML reply."""
    form = await request.form()
    from_num = _normalize_wa_number(form.get("From", ""))
    body = (form.get("Body") or "").strip()
    media_url = form.get("MediaUrl0") or ""
    num_media = int(form.get("NumMedia") or 0)

    def _twiml(msg: str) -> PlainTextResponse:
        safe = (msg or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        xml = f"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>{safe}</Message></Response>"
        return PlainTextResponse(xml, media_type="application/xml")

    if not from_num:
        return _twiml("")

    # Pairing flow
    pair_match = re.match(r"^\s*lapakin\s+(\d{6})\s*$", body, re.IGNORECASE)
    if pair_match:
        code = pair_match.group(1)
        rec = await db.wa_pair_codes.find_one({"code": code, "used": False})
        if not rec:
            return _twiml("Kode tidak valid atau sudah dipakai. Cek lagi di dashboard Lapakin ya.")
        expires = rec.get("expires_at")
        if isinstance(expires, str):
            expires = datetime.fromisoformat(expires)
        if expires and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires and expires < datetime.now(timezone.utc):
            return _twiml("Kode sudah kadaluarsa. Buat kode baru di dashboard.")
        await db.wa_links.update_one(
            {"user_id": rec["user_id"]},
            {"$set": {"user_id": rec["user_id"], "phone": from_num,
                      "linked_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        await db.wa_pair_codes.update_one({"code": code}, {"$set": {"used": True}})
        return _twiml("WhatsApp kamu sudah terhubung ke Lapakin! 🎉\n\nSekarang kirim foto produk + nama & harga, contoh:\n\nKopi Susu Aren 25000 stok 20")

    link = await db.wa_links.find_one({"phone": from_num})
    if not link:
        return _twiml("Halo! Nomor ini belum terhubung ke akun Lapakin. Buka dashboard di lapakin.id, klik 'Hubungkan WhatsApp', lalu kirim 'lapakin <kode>' ke nomor ini.")

    user = await db.users.find_one({"user_id": link["user_id"]}, {"_id": 0})
    if not user or not user.get("shop_id"):
        return _twiml("Akunmu belum punya toko. Buka dashboard Lapakin dan setup toko dulu ya.")

    low = body.lower()
    if low in ("", "help", "menu", "halo", "hi", "hai"):
        return _twiml("👋 Lapakin WhatsApp Bot siap.\n\nCara pakai:\n• Kirim FOTO + nama produk + harga\n  Contoh: Kopi Susu Aren 25000 stok 20\n\n• Ketik 'list' untuk lihat 5 produk terakhir\n• Ketik 'unlink' untuk lepas WhatsApp")
    if low == "unlink":
        await db.wa_links.delete_one({"user_id": link["user_id"]})
        return _twiml("WhatsApp dilepas dari Lapakin. Sampai jumpa! 👋")
    if low == "list":
        items = await db.products.find(
            {"shop_id": user["shop_id"]},
            {"_id": 0, "name": 1, "price": 1, "stock": 1}
        ).sort("created_at", -1).to_list(5)
        if not items:
            return _twiml("Belum ada produk di tokomu.")
        lines = [f"• {p['name']} — Rp {int(p.get('price') or 0):,}".replace(",", ".")
                 + f" (stok {p.get('stock', 0)})" for p in items]
        return _twiml("5 produk terakhir:\n\n" + "\n".join(lines))

    if num_media == 0 or not media_url:
        return _twiml("Kirim foto produk ya, beserta nama & harga. Contoh: Kopi Susu Aren 25000 stok 20")

    name, price, stock = _parse_product_text(body)
    if price <= 0:
        return _twiml("Harga tidak terbaca. Coba kirim ulang dengan format: <nama> <harga>. Contoh: Kopi Susu Aren 25000")

    img_b64 = await _download_media(media_url)
    if not img_b64:
        return _twiml("Maaf, gagal ambil foto dari WhatsApp. Coba kirim ulang atau pakai dashboard Lapakin.")
    image_data_url = f"data:image/jpeg;base64,{img_b64}"

    product_id = f"prod_{uuid.uuid4().hex[:12]}"
    doc = {
        "product_id": product_id, "shop_id": user["shop_id"],
        "name": name, "price": price, "stock": stock,
        "description": "", "image_data": image_data_url, "images": [image_data_url],
        "ig_caption": "", "tiktok_caption": "", "hashtags": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": "whatsapp",
    }
    await db.products.insert_one(doc)
    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0, "slug": 1})
    base = os.environ.get("PUBLIC_BASE_URL", "")
    link_text = f"\n\nLihat: {base}/toko/{shop['slug']}" if base and shop else ""
    return _twiml(f"✅ Produk \"{name}\" sudah tayang di tokomu!\nHarga: Rp {price:,}".replace(",", ".")
                  + f" • Stok: {stock}{link_text}")
