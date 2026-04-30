"""Tests for Iteration 15 — Midtrans Snap payment gateway.
With MIDTRANS_SERVER_KEY empty (dev default), create-transaction returns 503
and the activation flow is exercised via direct DB manipulation + a forged
webhook signature using a fake server_key.

These tests focus on business logic that doesn't need real Midtrans:
  - /api/payment/config surfaces plans + snap_url
  - /api/payment/create-transaction rejects invalid plan
  - /api/payment/create-transaction returns 503 when not configured
  - Webhook rejects invalid signature
  - _activate_subscription upgrades tier + sets subscription_expires_at
  - PLANS catalog keys + prices match tiers.py
"""
import os
import uuid
import hashlib
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.timeout = 20
    return s


@pytest.fixture(scope="module")
def user_token(session):
    """Create a fresh user so we can hit authenticated payment endpoints."""
    suffix = uuid.uuid4().hex[:8]
    email = f"pay_{suffix}@example.com"
    r = session.post(f"{API}/auth/register", json={
        "email": email, "password": "secret12", "name": "Pay User"
    })
    assert r.status_code == 200, r.text
    return r.json()["access_token"], r.json()["user_id"], email


class TestPaymentConfig:
    def test_public_config(self, session):
        r = session.get(f"{API}/payment/config")
        assert r.status_code == 200
        d = r.json()
        assert "configured" in d and "plans" in d
        # Plan catalog
        for pid in ("pro_monthly", "pro_yearly", "business_monthly", "business_yearly"):
            assert pid in d["plans"], f"missing plan {pid}"
        assert d["plans"]["pro_monthly"]["price_idr"] == 49000
        assert d["plans"]["pro_yearly"]["price_idr"] == 490000
        assert d["plans"]["business_monthly"]["price_idr"] == 149000
        assert d["plans"]["business_yearly"]["price_idr"] == 1490000
        # Snap URL should point to sandbox by default
        assert "sandbox.midtrans.com" in d["snap_url"] or "app.midtrans.com" in d["snap_url"]


class TestCreateTransaction:
    def test_invalid_plan_400(self, session, user_token):
        tok, _, _ = user_token
        r = session.post(f"{API}/payment/create-transaction",
                         json={"plan_id": "invalid_plan"},
                         headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 400

    def test_not_configured_503(self, session, user_token):
        """Adapts to whether backend has Midtrans keys set."""
        tok, _, _ = user_token
        # Ask backend itself whether it's configured
        cfg = session.get(f"{API}/payment/config").json()
        r = session.post(f"{API}/payment/create-transaction",
                         json={"plan_id": "pro_monthly"},
                         headers={"Authorization": f"Bearer {tok}"})
        if cfg.get("configured"):
            # 200 with snap_token, OR 502 if keys are invalid/expired (Midtrans rejects).
            assert r.status_code in (200, 502), r.text
            if r.status_code == 200:
                d = r.json()
                assert d.get("snap_token")
                assert d.get("order_id", "").startswith("lapakin-pro_monthly-")
        else:
            assert r.status_code == 503
            assert "Midtrans" in r.json()["detail"] or "Pembayaran" in r.json()["detail"]

    def test_requires_auth(self):
        # Use fresh session so no access_token cookie leaks from user_token fixture
        fresh = requests.Session()
        r = fresh.post(f"{API}/payment/create-transaction", json={"plan_id": "pro_monthly"})
        assert r.status_code == 401


class TestWebhook:
    def test_invalid_signature_403(self, session):
        r = session.post(f"{API}/payment/webhook", json={
            "order_id": "fake-order",
            "status_code": "200",
            "gross_amount": "49000",
            "signature_key": "not-a-valid-sha512",
            "transaction_status": "settlement",
        })
        # When server_key empty, verify returns False too → 403
        assert r.status_code in (403, 400)


class TestPaymentService:
    """Direct test of PLANS + signature helpers (no HTTP)."""

    def test_plans_match_tier_prices(self):
        from payment_service import PLANS
        from tiers import TIER_LIMITS
        assert PLANS["pro_monthly"]["price_idr"] == TIER_LIMITS["pro"]["price_idr_month"]
        assert PLANS["pro_yearly"]["price_idr"] == TIER_LIMITS["pro"]["price_idr_year"]
        assert PLANS["business_monthly"]["price_idr"] == TIER_LIMITS["business"]["price_idr_month"]
        assert PLANS["business_yearly"]["price_idr"] == TIER_LIMITS["business"]["price_idr_year"]

    def test_signature_false_when_no_key(self):
        # With empty server key, verify should return False
        from payment_service import verify_webhook_signature, MIDTRANS_SERVER_KEY
        if not MIDTRANS_SERVER_KEY:
            assert verify_webhook_signature("abc", "200", "49000", "anysig") is False

    def test_signature_algorithm_sha512(self):
        """If a key is set, verify computes SHA512(order_id + status_code + amount + server_key)."""
        from payment_service import verify_webhook_signature
        import payment_service
        # Temporarily set a fake key to test the algorithm
        orig = payment_service.MIDTRANS_SERVER_KEY
        try:
            payment_service.MIDTRANS_SERVER_KEY = "SB-Mid-server-FAKE"
            raw = "order123" + "200" + "49000" + "SB-Mid-server-FAKE"
            good = hashlib.sha512(raw.encode("utf-8")).hexdigest()
            assert verify_webhook_signature("order123", "200", "49000", good) is True
            assert verify_webhook_signature("order123", "200", "49000", "wrong") is False
        finally:
            payment_service.MIDTRANS_SERVER_KEY = orig


class TestSubscriptionActivation:
    """Simulate a successful webhook path by directly calling the activator,
    since we can't receive a real Midtrans webhook in dev."""

    def test_activate_sets_tier_and_expiry(self):
        import asyncio
        from routes.payment import _activate_subscription
        from deps import db
        import uuid as _uuid
        from datetime import datetime, timezone

        uid = f"test_{_uuid.uuid4().hex[:8]}"

        async def _run():
            await db.users.insert_one({
                "user_id": uid, "email": f"{uid}@test.local", "name": "Activate",
                "auth_provider": "email", "tier": "free",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            try:
                await _activate_subscription(uid, "pro_monthly", f"order_{_uuid.uuid4().hex[:6]}",
                                              payment_type="qris", amount_idr=49000)
                u = await db.users.find_one({"user_id": uid}, {"_id": 0})
                assert u["tier"] == "pro"
                assert u.get("trial") is False
                assert u.get("subscription_expires_at") is not None
                assert u.get("subscription_plan_id") == "pro_monthly"
                assert u.get("subscription_cycle") == "monthly"
            finally:
                await db.users.delete_one({"user_id": uid})

        asyncio.run(_run())

    def test_activate_sends_receipt_email(self, monkeypatch):
        """_activate_subscription should invoke email_service.send_email
        with the receipt template once activation succeeds."""
        import asyncio
        import os
        import pymongo
        from motor.motor_asyncio import AsyncIOMotorClient
        import uuid as _uuid
        from datetime import datetime, timezone

        uid = f"rcpt_{_uuid.uuid4().hex[:8]}"
        captured = {}

        async def fake_send_email(to, subject, html, text=None, reply_to=None):
            captured["to"] = to
            captured["subject"] = subject
            captured["html"] = html
            captured["text"] = text
            return "fake_id_123"

        import email_service
        monkeypatch.setattr(email_service, "send_email", fake_send_email)

        # Seed user synchronously
        mc = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db_name = os.environ.get("DB_NAME", "lapakin_db")
        mdb = mc[db_name]
        mdb.users.insert_one({
            "user_id": uid, "email": f"{uid}@test.local", "name": "Receipt User",
            "auth_provider": "email", "tier": "free",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

        # Re-bind the global motor client to a fresh loop for this test
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        import deps
        new_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        monkeypatch.setattr(deps, "client", new_client)
        monkeypatch.setattr(deps, "db", new_client[db_name])
        # routes/payment.py imports `db` at module load — patch its ref too
        from routes import payment as payment_module
        monkeypatch.setattr(payment_module, "db", new_client[db_name])
        try:
            loop.run_until_complete(
                payment_module._activate_subscription(
                    uid, "pro_yearly", "order_rcpt_test",
                    payment_type="gopay", amount_idr=490000
                )
            )
        finally:
            new_client.close()
            loop.close()
            mdb.users.delete_one({"user_id": uid})
            mc.close()

        assert captured.get("to") == f"{uid}@test.local"
        assert "Pembayaran" in captured.get("subject", "") or "Rp" in captured.get("subject", "")
        assert "order_rcpt_test" in captured.get("html", "")
        assert "Pro" in captured.get("html", "") and "Tahun" in captured.get("html", "")
        assert "490.000" in captured.get("html", "") or "490,000" in captured.get("html", "")
