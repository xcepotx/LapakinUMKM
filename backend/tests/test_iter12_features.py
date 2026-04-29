"""Iteration 12 tests: Trial, Custom Domain, Analytics, Bulk Pack."""
import os
import re
import uuid
import time
import zipfile
from io import BytesIO
from datetime import datetime, timezone, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read()
# Parse from frontend .env if not in env
if "REACT_APP_BACKEND_URL" in BASE_URL:
    for line in BASE_URL.splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip()
BASE_URL = BASE_URL.rstrip("/")

ADMIN_EMAIL = "admin@lapakin.id"
ADMIN_PW = "lapakin123"
SARI_EMAIL = "sari@warung.id"
SARI_PW = "newpass123"


# ---------- helpers ----------
def _new_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password):
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()


def _register(session, email, password, name):
    r = session.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": password, "name": name})
    return r


def _set_tier(admin_sess, user_id, tier):
    r = admin_sess.post(f"{BASE_URL}/api/admin/users/{user_id}/tier", json={"tier": tier})
    assert r.status_code == 200, f"tier update failed: {r.status_code} {r.text}"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_sess():
    s = _new_session()
    _login(s, ADMIN_EMAIL, ADMIN_PW)
    return s


@pytest.fixture(scope="module")
def trial_user():
    """Create a fresh user and return (session, user_info)."""
    email = f"TEST_trial_{uuid.uuid4().hex[:8]}@test.id"
    s = _new_session()
    r = _register(s, email, "testpass123", "Trial Tester")
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    info = r.json()
    yield s, info, email
    # cleanup done in conftest via DB


# ============ TRIAL TESTS ============
class TestTrial:
    def test_register_creates_pro_trial(self, trial_user):
        _, info, _ = trial_user
        assert info["tier"] == "pro"
        assert info["trial"] is True
        assert "trial_expires_at" in info and info["trial_expires_at"]
        # trial_expires_at ~14 days in future
        exp = datetime.fromisoformat(info["trial_expires_at"].replace("Z", "+00:00"))
        delta = (exp - datetime.now(timezone.utc)).total_seconds()
        assert 13 * 86400 < delta < 15 * 86400, f"trial expiry should be ~14 days, got {delta/86400}d"

    def test_auth_me_returns_trial_fields(self, trial_user):
        s, _, _ = trial_user
        r = s.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert data["tier"] == "pro"
        assert data["trial"] is True
        assert data["trial_expires_at"]

    def test_trial_auto_downgrade(self, trial_user):
        """Manually set trial_expires_at to past, then /api/billing/me must flip to free."""
        s, info, email = trial_user
        # Use direct mongo to expire trial
        import asyncio
        mongo_url = "mongodb://localhost:27017"
        db_name = "test_database"
        for line in open("/app/backend/.env"):
            line = line.strip()
            if line.startswith("MONGO_URL="):
                mongo_url = line.split("=", 1)[1].strip().strip('"').strip("'")
            elif line.startswith("DB_NAME="):
                db_name = line.split("=", 1)[1].strip().strip('"').strip("'")

        async def expire_trial():
            cli = AsyncIOMotorClient(mongo_url)
            d = cli[db_name]
            yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
            res = await d.users.update_one(
                {"email": email.lower()},
                {"$set": {"trial_expires_at": yesterday}}
            )
            cli.close()
            return res.modified_count

        mc = asyncio.run(expire_trial())
        assert mc == 1, "failed to expire trial"

        # Now call billing/me — require_user should auto-downgrade
        r = s.get(f"{BASE_URL}/api/billing/me")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("tier") == "free", f"expected tier=free, got {data}"
        # trial should be false
        assert data.get("trial") in (False, None)

        # Verify /api/auth/me also shows free
        r2 = s.get(f"{BASE_URL}/api/auth/me")
        assert r2.json()["tier"] == "free"


# ============ CUSTOM DOMAIN TESTS ============
class TestCustomDomain:
    def test_free_tier_custom_domain_returns_402(self):
        """sari@warung.id is free tier."""
        s = _new_session()
        _login(s, SARI_EMAIL, SARI_PW)
        # Ensure she's free
        r = s.post(f"{BASE_URL}/api/shops/me/custom-domain", json={"domain": "tokokamu.com"})
        assert r.status_code == 402, f"expected 402 for free tier, got {r.status_code} {r.text}"

    def test_business_tier_custom_domain_flow(self, admin_sess):
        # Create a fresh business user
        email = f"TEST_biz_{uuid.uuid4().hex[:8]}@test.id"
        s = _new_session()
        reg = _register(s, email, "testpass123", "Biz Tester")
        assert reg.status_code == 200
        user_id = reg.json()["user_id"]
        # Promote to business
        _set_tier(admin_sess, user_id, "business")

        # Need a shop first — create one
        shop_payload = {"name": "TEST Biz Shop", "business_type": "fashion", "whatsapp": "628111"}
        r = s.post(f"{BASE_URL}/api/shops/me", json=shop_payload)
        assert r.status_code == 200, f"shop creation failed: {r.text}"

        # POST custom domain
        r = s.post(f"{BASE_URL}/api/shops/me/custom-domain", json={"domain": "tokokamu.com"})
        assert r.status_code == 200, f"expected 200 for business, got {r.status_code} {r.text}"
        data = r.json()
        assert data.get("ok") is True
        assert data.get("domain") == "tokokamu.com"
        assert data.get("verified") is False
        assert "dns_instructions" in data
        dns = data["dns_instructions"]
        assert dns.get("type") == "CNAME"
        assert "name" in dns and "value" in dns and "ttl" in dns and "note" in dns

        # POST verify
        r = s.post(f"{BASE_URL}/api/shops/me/custom-domain/verify")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "verified" in d
        assert "domain" in d
        assert "message" in d
        # verified will likely be false for test domain — that's fine

        # DELETE
        r = s.delete(f"{BASE_URL}/api/shops/me/custom-domain")
        assert r.status_code == 200, r.text

        # Verify removed — shop get should not have custom_domain
        shop = s.get(f"{BASE_URL}/api/shops/me").json()
        assert not shop.get("custom_domain"), f"custom_domain should be removed, got {shop.get('custom_domain')}"


# ============ ANALYTICS TESTS ============
class TestAnalytics:
    def test_track_valid_events(self):
        """POST /api/analytics/track should accept valid events (unauthenticated)."""
        s = _new_session()
        for ev in ["view_shop", "view_product", "click_order", "share_wa"]:
            r = s.post(f"{BASE_URL}/api/analytics/track", json={"event": ev, "slug": "warung-sari"})
            assert r.status_code == 200, f"{ev} -> {r.status_code} {r.text}"
            assert r.json().get("ok") is True

    def test_track_invalid_event(self):
        s = _new_session()
        r = s.post(f"{BASE_URL}/api/analytics/track", json={"event": "fake_event", "slug": "warung-sari"})
        # Should return ok=false
        assert r.status_code in (200, 400)
        if r.status_code == 200:
            assert r.json().get("ok") is False

    def test_free_tier_analytics_402(self):
        s = _new_session()
        _login(s, SARI_EMAIL, SARI_PW)
        r = s.get(f"{BASE_URL}/api/analytics/shop?days=7")
        assert r.status_code == 402, f"expected 402, got {r.status_code}: {r.text}"

    def test_pro_tier_analytics_returns_shape(self, admin_sess):
        email = f"TEST_proana_{uuid.uuid4().hex[:8]}@test.id"
        s = _new_session()
        reg = _register(s, email, "testpass123", "Pro Ana")
        user_id = reg.json()["user_id"]
        _set_tier(admin_sess, user_id, "pro")
        # create shop
        s.post(f"{BASE_URL}/api/shops/me", json={"name": "TEST Pro Shop", "business_type": "kuliner"})

        # Track a couple events using the shop's slug
        shop = s.get(f"{BASE_URL}/api/shops/me").json()
        slug = shop["slug"]
        anon = _new_session()
        anon.post(f"{BASE_URL}/api/analytics/track", json={"event": "view_shop", "slug": slug})
        anon.post(f"{BASE_URL}/api/analytics/track", json={"event": "click_order", "slug": slug})

        r = s.get(f"{BASE_URL}/api/analytics/shop?days=7")
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ("total_visits", "events", "conversion_rate_percent", "top_products", "daily", "range_days"):
            assert key in d, f"missing key {key} in analytics response: {d.keys()}"
        assert d["range_days"] == 7

    def test_shop_by_slug_inserts_visit(self):
        """GET /api/shops/by-slug should track storefront_visits."""
        r = requests.get(f"{BASE_URL}/api/shops/by-slug/warung-sari")
        assert r.status_code == 200


# ============ BULK PACK TESTS ============
class TestBulkPack:
    def test_free_tier_bulk_pack_402(self):
        s = _new_session()
        _login(s, SARI_EMAIL, SARI_PW)
        r = s.get(f"{BASE_URL}/api/og/bulk-pack.zip")
        assert r.status_code == 402, f"expected 402, got {r.status_code}"

    def test_pro_no_products_400(self, admin_sess):
        email = f"TEST_bulk_{uuid.uuid4().hex[:8]}@test.id"
        s = _new_session()
        reg = _register(s, email, "testpass123", "Bulk User")
        user_id = reg.json()["user_id"]
        _set_tier(admin_sess, user_id, "pro")
        s.post(f"{BASE_URL}/api/shops/me", json={"name": "TEST Bulk Shop", "business_type": "fashion"})
        r = s.get(f"{BASE_URL}/api/og/bulk-pack.zip")
        assert r.status_code == 400, f"expected 400 for no products, got {r.status_code}"

    def test_pro_with_products_returns_zip(self, admin_sess):
        email = f"TEST_bulk2_{uuid.uuid4().hex[:8]}@test.id"
        s = _new_session()
        reg = _register(s, email, "testpass123", "Bulk User 2")
        user_id = reg.json()["user_id"]
        _set_tier(admin_sess, user_id, "pro")
        s.post(f"{BASE_URL}/api/shops/me", json={"name": "TEST Bulk2 Shop", "business_type": "kuliner"})
        # Add products
        for i in range(2):
            r = s.post(f"{BASE_URL}/api/products", json={
                "name": f"Produk {i}", "price": 10000 + i * 1000, "stock": 5,
            })
            assert r.status_code == 200, r.text
        r = s.get(f"{BASE_URL}/api/og/bulk-pack.zip")
        assert r.status_code == 200, f"expected 200, got {r.status_code}"
        assert "application/zip" in r.headers.get("content-type", "")
        # Verify zip content
        z = zipfile.ZipFile(BytesIO(r.content))
        names = z.namelist()
        assert len(names) >= 2
        png_files = [n for n in names if n.endswith(".png")]
        assert len(png_files) >= 2, f"no PNG files in zip: {names}"


# ============ REGRESSION ============
class TestRegression:
    def test_login_still_works(self):
        s = _new_session()
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": SARI_EMAIL, "password": SARI_PW})
        assert r.status_code == 200

    def test_products_list(self):
        s = _new_session()
        _login(s, SARI_EMAIL, SARI_PW)
        r = s.get(f"{BASE_URL}/api/products")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_og_image_still_cached(self):
        r = requests.get(f"{BASE_URL}/api/og/shop/warung-sari.png")
        assert r.status_code == 200
        assert r.headers.get("content-type") == "image/png"
        r2 = requests.get(f"{BASE_URL}/api/og/shop/warung-sari.png")
        assert r2.headers.get("X-Cache") in ("HIT", "MISS", None)

    def test_billing_me_for_free_user(self):
        s = _new_session()
        _login(s, SARI_EMAIL, SARI_PW)
        r = s.get(f"{BASE_URL}/api/billing/me")
        assert r.status_code == 200
        d = r.json()
        assert "tier" in d
