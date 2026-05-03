"""Midtrans Snap payment service. No-op stub mode when keys aren't set, so
backend still boots in dev/CI without external credentials."""
import os
import asyncio
import hashlib
import hmac
import logging
from typing import Optional

import midtransclient

logger = logging.getLogger("lapakin")

MIDTRANS_SERVER_KEY = os.environ.get("MIDTRANS_SERVER_KEY", "")
MIDTRANS_CLIENT_KEY = os.environ.get("MIDTRANS_CLIENT_KEY", "")
MIDTRANS_IS_PRODUCTION = os.environ.get("MIDTRANS_IS_PRODUCTION", "false").lower() == "true"

# Plan catalog — maps plan_id → {tier, cycle, price_idr, duration_days, label}
PLANS = {
    "starter_monthly": {
        "tier": "starter", "cycle": "monthly", "price_idr": 19000,
        "duration_days": 30, "label": "Lapakin Starter Bulanan",
    },
    "starter_yearly": {
        "tier": "starter", "cycle": "yearly", "price_idr": 190000,
        "duration_days": 365, "label": "Lapakin Starter Tahunan",
    },
    "pro_monthly": {
        "tier": "pro", "cycle": "monthly", "price_idr": 49000,
        "duration_days": 30, "label": "Lapakin Pro — 1 Bulan",
    },
    "pro_yearly": {
        "tier": "pro", "cycle": "yearly", "price_idr": 490000,
        "duration_days": 365, "label": "Lapakin Pro — 1 Tahun",
    },
    "business_monthly": {
        "tier": "business", "cycle": "monthly", "price_idr": 149000,
        "duration_days": 30, "label": "Lapakin Bisnis — 1 Bulan",
    },
    "business_yearly": {
        "tier": "business", "cycle": "yearly", "price_idr": 1490000,
        "duration_days": 365, "label": "Lapakin Bisnis — 1 Tahun",
    },
}


def is_configured() -> bool:
    return bool(MIDTRANS_SERVER_KEY and MIDTRANS_CLIENT_KEY)


def get_snap_client() -> Optional[midtransclient.Snap]:
    if not is_configured():
        return None
    return midtransclient.Snap(
        is_production=MIDTRANS_IS_PRODUCTION,
        server_key=MIDTRANS_SERVER_KEY,
        client_key=MIDTRANS_CLIENT_KEY,
    )


async def create_snap_transaction(transaction_data: dict) -> dict:
    """Sync SDK → wrap in asyncio.to_thread to keep FastAPI loop non-blocking.
    Returns {token, redirect_url}. Raises on failure."""
    snap = get_snap_client()
    if not snap:
        raise RuntimeError("Midtrans belum dikonfigurasi (MIDTRANS_SERVER_KEY/CLIENT_KEY kosong).")
    return await asyncio.to_thread(snap.create_transaction, transaction_data)


def verify_webhook_signature(order_id: str, status_code: str,
                             gross_amount: str, signature_key: str) -> bool:
    """SHA512(order_id + status_code + gross_amount + server_key) == signature_key."""
    if not MIDTRANS_SERVER_KEY or not signature_key:
        return False
    raw = f"{order_id}{status_code}{gross_amount}{MIDTRANS_SERVER_KEY}"
    computed = hashlib.sha512(raw.encode("utf-8")).hexdigest()
    return hmac.compare_digest(computed, signature_key)


def snap_url() -> str:
    """Frontend Snap.js URL."""
    return ("https://app.midtrans.com/snap/snap.js"
            if MIDTRANS_IS_PRODUCTION
            else "https://app.sandbox.midtrans.com/snap/snap.js")
