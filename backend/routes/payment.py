"""Payment routes: create Snap transaction, receive webhook, check status,
list payment history."""
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from deps import db, logger, require_user
from payment_service import (
    PLANS, is_configured, create_snap_transaction,
    verify_webhook_signature, MIDTRANS_CLIENT_KEY, MIDTRANS_IS_PRODUCTION, snap_url,
)

router = APIRouter()


# ---- Models ----
class CreateTransactionIn(BaseModel):
    plan_id: str  # e.g. "pro_monthly"


# ---- Helpers ----
async def _activate_subscription(user_id: str, plan_id: str, order_id: str,
                                  payment_type: str = "", amount_idr: Optional[int] = None):
    """Upgrade user tier + extend expiry. Idempotent per (user_id, order_id).
    Sends receipt email on successful activation (best-effort, no raise)."""
    plan = PLANS.get(plan_id)
    if not plan:
        logger.warning("activate_subscription: unknown plan_id=%s", plan_id)
        return
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        logger.warning("activate_subscription: user not found %s", user_id)
        return
    now = datetime.now(timezone.utc)
    # If user already on same tier with future expiry, stack duration; else start fresh from now.
    cur_tier = user.get("tier") or "free"
    cur_exp = user.get("subscription_expires_at")
    start = now
    if cur_tier == plan["tier"] and cur_exp:
        try:
            exp_dt = datetime.fromisoformat(cur_exp.replace("Z", "+00:00"))
            if exp_dt > now:
                start = exp_dt
        except Exception:
            pass
    new_exp = start + timedelta(days=plan["duration_days"])
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {
            "tier": plan["tier"],
            "trial": False,  # paid cancels trial
            "trial_expires_at": None,
            "trial_used": True,
            "trial_expired": False,
            "trial_expired_at": None,
            "subscription_plan_id": plan_id,
            "subscription_cycle": plan["cycle"],
            "subscription_started_at": now.isoformat(),
            "subscription_expires_at": new_exp.isoformat(),
            "subscription_last_order_id": order_id,
            "subscription_status": "active",
            "subscription_unsuspended_at": now.isoformat(),
            "subscription_suspended_at": None,
            "subscription_suspend_reason": None,
            "tier_updated_at": now.isoformat(),
        }}
    )
    logger.info("Activated %s (%s) for user %s until %s",
                plan["tier"], plan["cycle"], user_id, new_exp.isoformat())

    # Receipt email (best-effort; no-op when Resend not configured)
    try:
        if user.get("email"):
            from email_service import send_email
            from email_templates import payment_receipt
            subj, html, text = payment_receipt(
                name=user.get("name") or "",
                order_id=order_id,
                plan_label=plan["label"],
                amount_idr=amount_idr if amount_idr is not None else plan["price_idr"],
                cycle=plan["cycle"],
                payment_type=payment_type,
                paid_at_iso=now.isoformat(),
                next_billing_iso=new_exp.isoformat(),
            )
            await send_email(user["email"], subj, html, text)
    except Exception:
        logger.exception("payment receipt email failed")

@router.post("/payment/start-pro-trial")
async def start_pro_trial(request: Request):
    user = await require_user(request)

    current_tier = user.get("tier") or "free"
    trial_used = bool(user.get("trial_used"))

    if current_tier != "free":
        raise HTTPException(
            status_code=400,
            detail="Trial Pro hanya tersedia untuk akun Gratis.",
        )

    if trial_used:
        raise HTTPException(
            status_code=400,
            detail="Trial Pro sudah pernah digunakan.",
        )

    now = datetime.now(timezone.utc)
    trial_expires_at = now + timedelta(days=10)

    update = {
        "tier": "pro",
        "trial": True,
        "trial_used": True,
        "trial_started_at": now.isoformat(),
        "trial_expires_at": trial_expires_at.isoformat(),
        "trial_expired": False,
        "trial_expired_at": None,
        "subscription_plan_id": None,
        "subscription_cycle": None,
        "subscription_expires_at": None,
        "updated_at": now.isoformat(),
    }

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": update},
    )

    return {
        "ok": True,
        "tier": "pro",
        "trial": True,
        "trial_used": True,
        "trial_started_at": now.isoformat(),
        "trial_expires_at": trial_expires_at.isoformat(),
        "trial_expired": False,
        "trial_expired_at": None,
        "message": "Trial Pro aktif selama 10 hari.",
    }

# ---- Public config endpoint (for frontend Snap loader) ----
@router.get("/payment/config")
async def payment_config():
    """Expose Snap client key + script URL so frontend loads correct Snap.js."""
    return {
        "configured": is_configured(),
        "client_key": MIDTRANS_CLIENT_KEY if is_configured() else "",
        "snap_url": snap_url(),
        "is_production": MIDTRANS_IS_PRODUCTION,
        "plans": {pid: {**p} for pid, p in PLANS.items()},
    }


# ---- Create transaction ----
@router.post("/payment/create-transaction")
async def create_transaction(data: CreateTransactionIn, request: Request):
    """Create Midtrans Snap token for a subscription upgrade."""
    user = await require_user(request)
    if data.plan_id not in PLANS:
        raise HTTPException(status_code=400, detail="Paket tidak valid")
    if not is_configured():
        raise HTTPException(
            status_code=503,
            detail="Pembayaran belum aktif. Admin belum mengonfigurasi Midtrans.",
        )
    plan = PLANS[data.plan_id]

    # Reuse in-flight pending order for same plan (prevent duplicate tokens on retry)
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    existing = await db.payments.find_one(
        {"user_id": user["user_id"], "plan_id": data.plan_id,
         "status": "pending", "created_at": {"$gte": cutoff}},
        {"_id": 0},
    )
    if existing and existing.get("snap_token"):
        return {
            "snap_token": existing["snap_token"],
            "redirect_url": existing.get("snap_redirect_url"),
            "order_id": existing["order_id"],
            "client_key": MIDTRANS_CLIENT_KEY,
            "snap_url": snap_url(),
            "reused": True,
        }

    order_id = f"lapakin-{data.plan_id}-{uuid.uuid4().hex[:10]}"
    full_name = (user.get("name") or "Lapakin User").strip()
    parts = full_name.split(" ", 1)
    first = parts[0]
    last = parts[1] if len(parts) > 1 else ""

    payload = {
        "transaction_details": {
            "order_id": order_id,
            "gross_amount": plan["price_idr"],
        },
        "credit_card": {"secure": True},
        "customer_details": {
            "first_name": first,
            "last_name": last,
            "email": user.get("email") or "",
        },
        "item_details": [{
            "id": data.plan_id,
            "price": plan["price_idr"],
            "quantity": 1,
            "name": plan["label"][:50],
        }],
        "expiry": {"unit": "minute", "duration": 15},
        "callbacks": {
            # Midtrans will redirect browser back to app after finish (desktop CC flow).
            "finish": f"{request.headers.get('origin') or ''}/dashboard/billing?order_id={order_id}",
        },
    }

    try:
        result = await create_snap_transaction(payload)
    except Exception as e:
        logger.exception("Midtrans create_transaction failed")
        raise HTTPException(status_code=502, detail=f"Gagal buat transaksi Midtrans: {str(e)[:200]}")

    snap_token = result.get("token")
    redirect_url = result.get("redirect_url")
    await db.payments.insert_one({
        "order_id": order_id,
        "user_id": user["user_id"],
        "user_email": user.get("email"),
        "plan_id": data.plan_id,
        "amount": plan["price_idr"],
        "status": "pending",
        "snap_token": snap_token,
        "snap_redirect_url": redirect_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    return {
        "snap_token": snap_token,
        "redirect_url": redirect_url,
        "order_id": order_id,
        "client_key": MIDTRANS_CLIENT_KEY,
        "snap_url": snap_url(),
        "reused": False,
    }


# ---- Webhook ----
@router.post("/payment/webhook")
async def payment_webhook(request: Request):
    """Midtrans notification webhook. Verifies signature, activates tier on
    success, ignores replays. Always returns 200 so Midtrans doesn't retry
    forever on benign duplicates."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Body bukan JSON valid")

    order_id = body.get("order_id") or ""
    status_code = body.get("status_code") or ""
    gross_amount = body.get("gross_amount") or ""
    signature_key = body.get("signature_key") or ""
    transaction_status = body.get("transaction_status") or ""
    transaction_id = body.get("transaction_id") or ""
    payment_type = body.get("payment_type") or ""
    fraud_status = body.get("fraud_status") or ""

    if not order_id:
        raise HTTPException(status_code=400, detail="order_id required")

    if not verify_webhook_signature(order_id, status_code, str(gross_amount), signature_key):
        logger.warning("Midtrans webhook signature invalid for order %s", order_id)
        raise HTTPException(status_code=403, detail="Invalid signature")

    payment = await db.payments.find_one({"order_id": order_id}, {"_id": 0})
    if not payment:
        logger.warning("Midtrans webhook for unknown order %s", order_id)
        return {"ok": True, "ignored": "order_not_found"}

    # Map Midtrans status → our status
    if transaction_status in ("capture", "settlement"):
        if fraud_status and fraud_status != "accept":
            new_status = "pending"
        else:
            new_status = "success"
    elif transaction_status in ("deny", "cancel", "expire", "failure"):
        new_status = "failed"
    elif transaction_status == "refund" or transaction_status == "partial_refund":
        new_status = "refunded"
    else:
        new_status = "pending"

    await db.payments.update_one(
        {"order_id": order_id},
        {"$set": {
            "status": new_status,
            "transaction_id": transaction_id,
            "payment_type": payment_type,
            "transaction_status": transaction_status,
            "fraud_status": fraud_status,
            "webhook_last_body": body,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )

    # Activate tier once (idempotent via subscription_last_order_id check).
    if new_status == "success" and payment.get("status") != "success":
        await _activate_subscription(
            user_id=payment["user_id"],
            plan_id=payment["plan_id"],
            order_id=order_id,
            payment_type=payment_type,
            amount_idr=payment.get("amount"),
        )

    logger.info("Midtrans webhook processed: %s → %s (%s)", order_id, new_status, transaction_status)
    return {"ok": True, "status": new_status}


# ---- Status check (client polling after Snap closes) ----
@router.get("/payment/status/{order_id}")
async def payment_status(order_id: str, request: Request):
    """Auth required — only the owner can check their own payment.
    Returns latest status from DB."""
    user = await require_user(request)
    payment = await db.payments.find_one({"order_id": order_id}, {"_id": 0})
    if not payment:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    if payment.get("user_id") != user.get("user_id"):
        raise HTTPException(status_code=403, detail="Bukan transaksi kamu")
    return {
        "order_id": payment["order_id"],
        "status": payment.get("status") or "pending",
        "plan_id": payment.get("plan_id"),
        "amount": payment.get("amount"),
        "payment_type": payment.get("payment_type"),
        "created_at": payment.get("created_at"),
        "updated_at": payment.get("updated_at"),
    }


# ---- History ----
@router.get("/payment/history")
async def payment_history(request: Request, limit: int = 20):
    user = await require_user(request)
    items = await db.payments.find(
        {"user_id": user["user_id"]},
        {"_id": 0, "snap_token": 0, "snap_redirect_url": 0, "webhook_last_body": 0},
    ).sort("created_at", -1).limit(max(1, min(limit, 100))).to_list(limit)
    return items
