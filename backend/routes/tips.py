"""Daily Tips — personalized actionable nudges for UMKM owners.

Strategy:
  1) Compute shop signals (last_product_at, products_count, today_orders, hours_status, ...).
  2) Pick the highest-priority RULE-BASED tip if applicable (deterministic, free, fast).
  3) Otherwise generate an AI tip via Gemini Flash (Emergent LLM Key).
  4) Cache one tip per shop per day in `daily_tips` collection (idempotent).

Tips have shape: {
  tip_id, shop_id, date (YYYY-MM-DD),
  title, body, emoji,
  cta_label (optional), cta_url (optional),
  source: "rule" | "ai",
  rule_key: "no_products" | "off_peak" | "no_recent_orders" | ...,
  dismissed_at (set when user dismisses),
  created_at,
}
"""
from __future__ import annotations

import json as _json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from deps import db, logger, require_user
from schedule_utils import _now_jakarta, compute_schedule_status
from llm_service import chat_text as llm_chat_text

router = APIRouter()


# ------------- Signal collection -------------
async def _shop_signals(shop: dict) -> dict:
    """Gather lightweight stats used to choose / craft a tip."""
    shop_id = shop["shop_id"]
    now_jkt = _now_jakarta()
    today = now_jkt.date().isoformat()
    seven_days_ago = (now_jkt - timedelta(days=7)).isoformat()
    fourteen_days_ago = (now_jkt - timedelta(days=14)).isoformat()

    products_count = await db.products.count_documents({"shop_id": shop_id})
    last_product = await db.products.find_one(
        {"shop_id": shop_id},
        sort=[("created_at", -1)],
        projection={"_id": 0, "created_at": 1, "name": 1},
    )
    visits_7d = await db.storefront_visits.count_documents(
        {"shop_id": shop_id, "timestamp": {"$gte": seven_days_ago}}
    )
    visits_prev_7d = await db.storefront_visits.count_documents(
        {"shop_id": shop_id, "timestamp": {"$gte": fourteen_days_ago, "$lt": seven_days_ago}}
    )
    sched = compute_schedule_status(shop)

    return {
        "today": today,
        "now_hour": now_jkt.hour,
        "now_min": now_jkt.minute,
        "weekday": now_jkt.weekday(),  # 0=Mon
        "products_count": products_count,
        "last_product_at": (last_product or {}).get("created_at"),
        "last_product_name": (last_product or {}).get("name"),
        "visits_7d": visits_7d,
        "visits_prev_7d": visits_prev_7d,
        "is_open_now": sched.get("is_open_now"),
        "snoozed": sched.get("snoozed"),
        "sells_by": shop.get("sells_by") or "stock",
        "business_type": shop.get("business_type") or "umum",
    }


def _days_since(iso: Optional[str]) -> Optional[int]:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0, (datetime.now(timezone.utc) - dt).days)
    except Exception:
        return None


# ------------- Rule-based tips (deterministic, instant) -------------
def _rule_no_products(s: dict) -> Optional[dict]:
    if s["products_count"] == 0:
        return {
            "rule_key": "no_products",
            "emoji": "🚀",
            "title": "Yuk tambah produk pertamamu",
            "body": "Toko kamu sudah online tapi masih kosong. Upload 1 foto produk di AI Studio — AI bantu bikin deskripsi & caption IG/TikTok dalam 30 detik.",
            "cta_label": "Buka AI Studio",
            "cta_url": "/dashboard/ai-studio",
        }
    return None


def _rule_stale_catalog(s: dict) -> Optional[dict]:
    days = _days_since(s["last_product_at"])
    if days is not None and days >= 14 and s["products_count"] >= 1:
        return {
            "rule_key": "stale_catalog",
            "emoji": "📸",
            "title": f"Sudah {days} hari belum tambah produk baru",
            "body": "Pelanggan suka toko yang sering update — kasih kesan 'fresh'. Coba upload 1 produk baru atau foto ulang produk best-seller pakai AI.",
            "cta_label": "Tambah Produk",
            "cta_url": "/dashboard/ai-studio",
        }
    return None


def _rule_traffic_drop(s: dict) -> Optional[dict]:
    a, b = s["visits_7d"], s["visits_prev_7d"]
    if b >= 5 and a < int(b * 0.6):
        drop_pct = int((1 - a / b) * 100) if b else 0
        return {
            "rule_key": "traffic_drop",
            "emoji": "📉",
            "title": f"Pengunjung turun {drop_pct}% minggu ini",
            "body": "Coba kirim WhatsApp broadcast ke pelanggan lama — promo kecil atau menu baru sering bikin mereka mampir lagi.",
            "cta_label": "Buat Broadcast",
            "cta_url": "/dashboard/whatsapp",
        }
    return None


def _rule_traffic_growing(s: dict) -> Optional[dict]:
    a, b = s["visits_7d"], s["visits_prev_7d"]
    if a >= 10 and a > int(b * 1.4):
        gain_pct = int((a / max(b, 1) - 1) * 100)
        return {
            "rule_key": "traffic_growing",
            "emoji": "🔥",
            "title": f"Tokomu lagi naik {gain_pct}%!",
            "body": "Pengunjung minggu ini lebih rame dari minggu lalu. Manfaatkan momentum: bikin promo terbatas hari ini biar mereka langsung beli, bukan cuma lihat-lihat.",
            "cta_label": "Atur Promo",
            "cta_url": "/dashboard/settings",
        }
    return None


def _rule_kuliner_peak(s: dict) -> Optional[dict]:
    """Kuliner: peak hours 10:30 (lunch) and 17:00 (dinner)."""
    if (s["business_type"] or "").lower() not in ("kuliner", "kopi"):
        return None
    h = s["now_hour"]
    # 10:00–11:00 lunch prep
    if h == 10 and s["is_open_now"]:
        return {
            "rule_key": "kuliner_lunch_peak",
            "emoji": "🍽️",
            "title": "Sebentar lagi jam makan siang!",
            "body": "Order kuliner Indonesia paling rame jam 11:30–13:00. Pastikan menu hari ini sudah update di toko, dan kirim broadcast ke grup WA pelanggan tetap.",
            "cta_label": "Cek Menu",
            "cta_url": "/dashboard/products",
        }
    # 16:00–17:00 dinner prep
    if h == 16 and s["is_open_now"]:
        return {
            "rule_key": "kuliner_dinner_peak",
            "emoji": "🌆",
            "title": "Bersiap untuk jam makan malam",
            "body": "Antara jam 18:00–20:00 biasanya order naik 2x lipat. Pastikan stok bahan cukup dan WhatsApp Anda online.",
            "cta_label": "Status WA Bot",
            "cta_url": "/dashboard/whatsapp",
        }
    return None


def _rule_monday_morning(s: dict) -> Optional[dict]:
    if s["weekday"] == 0 and s["now_hour"] == 8:  # Monday 08:00
        return {
            "rule_key": "monday_morning",
            "emoji": "☀️",
            "title": "Selamat pagi! Senin baru, semangat baru",
            "body": "Awal minggu adalah momen terbaik bikin promo baru. UMKM yang punya promo 'Senin Hemat' rata-rata dapat 28% lebih banyak repeat order.",
            "cta_label": "Atur Promo",
            "cta_url": "/dashboard/settings",
        }
    return None


def _rule_friday_eve(s: dict) -> Optional[dict]:
    if s["weekday"] == 4 and s["now_hour"] >= 16:  # Friday afternoon
        return {
            "rule_key": "friday_eve",
            "emoji": "🎉",
            "title": "Akhir pekan tiba — siap-siap order naik",
            "body": "Order online akhir pekan biasanya naik 35% buat semua bidang UMKM. Cek stok / bahan sebelum tutup hari ini, dan post foto produk baru di IG malam ini.",
        }
    return None


def _rule_no_cover(s: dict, shop: dict) -> Optional[dict]:
    if not shop.get("cover_image"):
        return {
            "rule_key": "no_cover",
            "emoji": "🎨",
            "title": "Toko kamu belum punya cover banner",
            "body": "Cover banner bikin toko kamu terlihat 10x lebih profesional saat di-share di WhatsApp/IG. AI bisa bikin cover sesuai gaya brand-mu.",
            "cta_label": "Buat Cover dengan AI",
            "cta_url": "/dashboard/settings",
        }
    return None


def _rule_no_promo(s: dict, shop: dict) -> Optional[dict]:
    if not shop.get("promo_active") and s["products_count"] >= 3:
        return {
            "rule_key": "no_promo",
            "emoji": "🏷️",
            "title": "Belum punya promo aktif?",
            "body": "Promo sederhana 'Beli 2 Gratis 1' atau 'Diskon 10% pakai kode hari ini' bisa naikkan konversi 2-3x. Coba aktifkan minimal 3 hari.",
            "cta_label": "Atur Promo",
            "cta_url": "/dashboard/settings",
        }
    return None


_RULES = [
    _rule_no_products,
    _rule_stale_catalog,
    _rule_traffic_drop,
    _rule_traffic_growing,
    _rule_kuliner_peak,
    _rule_monday_morning,
    _rule_friday_eve,
    _rule_no_cover,
    _rule_no_promo,
]


def _pick_rule_tip(signals: dict, shop: dict) -> Optional[dict]:
    """Iterate rules in priority order; return first match."""
    for rule in _RULES:
        try:
            if rule.__code__.co_argcount == 2:
                tip = rule(signals, shop)
            else:
                tip = rule(signals)
            if tip:
                return tip
        except Exception as e:
            logger.info(f"tip rule {rule.__name__} failed: {e}")
    return None


# ------------- AI fallback -------------
async def _ai_tip(shop: dict, signals: dict) -> Optional[dict]:
    """Generate a tip via configured LLM provider. Best-effort; returns None on failure."""
    try:
        system = (
            "Kamu adalah mentor UMKM Indonesia yang hangat, praktis, dan memotivasi. "
            "Bahasamu santai (kayak ngobrol di warung), pakai 'kamu', tidak menggurui. "
            "Selalu balas JSON valid tanpa pembungkus markdown."
        )
        prompt = (
            f"Buat 1 tips singkat untuk pemilik toko UMKM hari ini.\n\n"
            f"Konteks toko:\n"
            f"- Nama: {shop.get('name')}\n"
            f"- Bidang: {shop.get('business_type')}\n"
            f"- Tagline: {shop.get('tagline') or '-'}\n"
            f"- Jumlah produk: {signals['products_count']}\n"
            f"- Hari ini: {['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu'][signals['weekday']]} "
            f"jam {signals['now_hour']:02d}:{signals['now_min']:02d} WIB\n"
            f"- Kunjungan toko 7 hari terakhir: {signals['visits_7d']}\n\n"
            f"Hasilkan JSON dengan field PERSIS:\n"
            f"{{\n"
            f'  "emoji": "1 emoji yang cocok",\n'
            f'  "title": "judul singkat 5-9 kata, action-oriented",\n'
            f'  "body": "1-2 kalimat tips konkret + 1 alasan KENAPA. Hindari kata-kata mutiara generic. Contoh data/angka boleh."\n'
            f"}}\n"
            f"Kembalikan HANYA JSON valid."
        )
        text = await llm_chat_text(
            system=system,
            user=prompt,
            model_hint="gemini-2.5-flash",
            session_id=f"tip_{uuid.uuid4().hex[:8]}",
        )
        raw = text.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.IGNORECASE | re.MULTILINE).strip()
        try:
            parsed = _json.loads(raw)
        except Exception:
            match = re.search(r"\{[\s\S]*\}", raw)
            if not match:
                return None
            parsed = _json.loads(match.group(0))
        if not parsed.get("title") or not parsed.get("body"):
            return None
        return {
            "rule_key": "ai",
            "emoji": parsed.get("emoji") or "💡",
            "title": parsed["title"],
            "body": parsed["body"],
        }
    except Exception as e:
        logger.info(f"ai_tip failed: {e}")
        return None


# ------------- Endpoints -------------
@router.get("/tips/today")
async def get_tip_today(request: Request):
    """Return today's tip for the authenticated user's shop. Cached per (shop, date)."""
    user = await require_user(request)
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")
    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    now = datetime.now(timezone.utc)
    today = _now_jakarta().date().isoformat()

    # Return cached tip if exists for today (and not dismissed)
    cached = await db.daily_tips.find_one(
        {"shop_id": shop["shop_id"], "date": today},
        {"_id": 0},
    )
    if cached:
        return cached

    # Compute new tip
    signals = await _shop_signals(shop)
    tip_data = _pick_rule_tip(signals, shop)
    source = "rule"
    if not tip_data:
        tip_data = await _ai_tip(shop, signals)
        source = "ai"
    if not tip_data:
        # Final hardcoded fallback (should rarely happen)
        tip_data = {
            "rule_key": "fallback",
            "emoji": "💪",
            "title": "Konsistensi adalah kunci",
            "body": "Posting 1 produk per minggu, balas WA pelanggan dalam 10 menit, dan minta review dari pelanggan repeat. 3 kebiasaan sederhana yang bikin toko UMKM tumbuh stabil.",
        }
        source = "fallback"

    tip = {
        "tip_id": f"tip_{uuid.uuid4().hex[:10]}",
        "shop_id": shop["shop_id"],
        "date": today,
        "source": source,
        "emoji": tip_data.get("emoji", "💡"),
        "title": tip_data["title"],
        "body": tip_data["body"],
        "rule_key": tip_data.get("rule_key", source),
        "cta_label": tip_data.get("cta_label"),
        "cta_url": tip_data.get("cta_url"),
        "dismissed_at": None,
        "created_at": now.isoformat(),
    }
    try:
        await db.daily_tips.insert_one({**tip, "_owner_user_id": user["user_id"]})
    except Exception:
        pass  # racy or dup — fine, just return
    return tip


@router.post("/tips/today/dismiss")
async def dismiss_tip_today(request: Request):
    """Mark today's tip as dismissed (so frontend hides it; tomorrow gets fresh one)."""
    user = await require_user(request)
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")
    today = _now_jakarta().date().isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.daily_tips.update_one(
        {"shop_id": user["shop_id"], "date": today},
        {"$set": {"dismissed_at": now_iso}},
    )
    return {"ok": True}


@router.post("/tips/today/refresh")
async def refresh_tip_today(request: Request):
    """Force-regenerate today's tip (Pro feature: max 3x/day)."""
    user = await require_user(request)
    if not user.get("shop_id"):
        raise HTTPException(status_code=400, detail="Belum punya toko")
    today = _now_jakarta().date().isoformat()

    # Rate limit: 3 refresh per day max
    refresh_count = await db.tip_refreshes.count_documents(
        {"shop_id": user["shop_id"], "date": today}
    )
    if refresh_count >= 3:
        raise HTTPException(status_code=429, detail="Sudah 3x refresh hari ini. Tunggu besok ya 🙏")

    shop = await db.shops.find_one({"shop_id": user["shop_id"]}, {"_id": 0})
    if not shop:
        raise HTTPException(status_code=404, detail="Toko tidak ditemukan")

    # Delete cached tip
    await db.daily_tips.delete_one({"shop_id": user["shop_id"], "date": today})
    # Force AI generation (skip rules so user gets variety)
    signals = await _shop_signals(shop)
    tip_data = await _ai_tip(shop, signals)
    if not tip_data:
        raise HTTPException(status_code=503, detail="Gagal generate tip baru. Coba lagi nanti.")

    now = datetime.now(timezone.utc)
    tip = {
        "tip_id": f"tip_{uuid.uuid4().hex[:10]}",
        "shop_id": shop["shop_id"],
        "date": today,
        "source": "ai_refresh",
        "emoji": tip_data.get("emoji", "💡"),
        "title": tip_data["title"],
        "body": tip_data["body"],
        "rule_key": "ai_refresh",
        "cta_label": tip_data.get("cta_label"),
        "cta_url": tip_data.get("cta_url"),
        "dismissed_at": None,
        "created_at": now.isoformat(),
    }
    await db.daily_tips.insert_one({**tip, "_owner_user_id": user["user_id"]})
    await db.tip_refreshes.insert_one({
        "shop_id": user["shop_id"], "date": today, "at": now.isoformat()
    })
    return tip
