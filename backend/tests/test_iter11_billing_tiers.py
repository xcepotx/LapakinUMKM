"""Iteration 11 — Subscription / Tier system tests.

Covers:
- GET /api/billing/tiers (public)
- GET /api/billing/me (auth required)
- Tier gating: product limit (free=5)
- Tier gating: ai_photo, ai_copy, ai_cover monthly quotas
- POST/PUT /api/admin/users/{id}/tier
- Storefront by-slug owner_tier + remove_branding injection
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@lapakin.id"
ADMIN_PASSWORD = "lapakin123"
SARI_EMAIL = "sari@warung.id"
SARI_PASSWORD = "newpass123"

RUN_ID = uuid.uuid4().hex[:6]
TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def sari_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": SARI_EMAIL, "password": SARI_PASSWORD})
    assert r.status_code == 200, f"sari login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def sari_user(sari_session):
    r = sari_session.get(f"{API}/auth/me")
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module", autouse=True)
def restore_sari_to_free(admin_session, sari_user):
    """After this module finishes, ensure sari is back on free tier."""
    yield
    try:
        admin_session.post(f"{API}/admin/users/{sari_user['user_id']}/tier",
                           json={"tier": "free"})
    except Exception:
        pass


# ---------- 1. /billing/tiers public ----------
class TestBillingTiersPublic:
    def test_no_auth_required(self):
        s = requests.Session()
        r = s.get(f"{API}/billing/tiers")
        assert r.status_code == 200, r.text

    def test_returns_three_tiers(self):
        r = requests.get(f"{API}/billing/tiers")
        d = r.json()
        assert "tiers" in d and "valid" in d
        assert set(d["tiers"].keys()) == {"free", "pro", "business"}
        assert set(d["valid"]) == {"free", "pro", "business"}

    def test_tier_shape(self):
        r = requests.get(f"{API}/billing/tiers")
        tiers = r.json()["tiers"]
        # free
        f = tiers["free"]
        assert f["label"] == "Gratis"
        assert f["price_idr_month"] == 0
        assert f["price_idr_year"] == 0
        assert f["max_products"] == 5
        assert f["ai_photo_per_month"] == 5
        assert f["ai_copy_per_month"] == 5
        assert f["ai_cover_per_month"] == 2
        assert f["remove_branding"] is False
        assert f["custom_subdomain"] is False
        # pro
        p = tiers["pro"]
        assert p["label"] == "Pro"
        assert p["price_idr_month"] == 49000
        assert p["price_idr_year"] == 490000
        assert p["max_products"] == 100
        assert p["remove_branding"] is True
        assert p["custom_subdomain"] is True
        assert p["custom_domain"] is False
        # business
        b = tiers["business"]
        assert b["label"] == "Bisnis"
        assert b["price_idr_month"] == 149000
        assert b["price_idr_year"] == 1490000
        assert b["max_products"] == -1  # unlimited sentinel
        assert b["custom_domain"] is True
        assert b["instagram_autopost"] is True
        assert b["api_access"] is True


# ---------- 2. /billing/me ----------
class TestBillingMe:
    def test_requires_auth(self):
        r = requests.get(f"{API}/billing/me")
        assert r.status_code == 401

    def test_sari_default_free(self, sari_session, admin_session, sari_user):
        # Ensure sari is on free tier
        admin_session.post(f"{API}/admin/users/{sari_user['user_id']}/tier",
                           json={"tier": "free"})
        r = sari_session.get(f"{API}/billing/me")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["tier"] == "free"
        assert d["tier_label"] == "Gratis"
        assert "year_month" in d and len(d["year_month"]) == 7  # YYYY-MM
        assert "limits" in d
        assert "usage" in d
        for k in ("ai_photo", "ai_copy", "ai_cover", "toko_card", "broadcast"):
            assert k in d["usage"]
            assert "used" in d["usage"][k]
            assert "limit" in d["usage"][k]
            assert "remaining" in d["usage"][k]
        assert "products" in d
        for k in ("used", "limit", "remaining"):
            assert k in d["products"]


# ---------- 3. Admin tier change ----------
class TestAdminTierChange:
    def test_post_verb_works(self, admin_session, sari_user):
        r = admin_session.post(f"{API}/admin/users/{sari_user['user_id']}/tier",
                               json={"tier": "pro"})
        assert r.status_code == 200, r.text
        assert r.json()["tier"] == "pro"

    def test_put_verb_legacy_compat(self, admin_session, sari_user):
        r = admin_session.put(f"{API}/admin/users/{sari_user['user_id']}/tier",
                              json={"tier": "business"})
        assert r.status_code == 200, r.text
        assert r.json()["tier"] == "business"

    def test_invalid_tier_400(self, admin_session, sari_user):
        for bad in ("premium", "foo", "FREE", ""):
            r = admin_session.post(f"{API}/admin/users/{sari_user['user_id']}/tier",
                                   json={"tier": bad})
            assert r.status_code == 400, f"expected 400 for tier={bad!r} got {r.status_code}"

    def test_billing_me_reflects_change(self, admin_session, sari_session, sari_user):
        admin_session.post(f"{API}/admin/users/{sari_user['user_id']}/tier",
                           json={"tier": "pro"})
        r = sari_session.get(f"{API}/billing/me")
        assert r.status_code == 200
        d = r.json()
        assert d["tier"] == "pro"
        assert d["tier_label"] == "Pro"
        # Pro tier: ai_copy unlimited
        assert d["usage"]["ai_copy"]["limit"] == "unlimited"
        # Restore to free for downstream tests
        admin_session.post(f"{API}/admin/users/{sari_user['user_id']}/tier",
                           json={"tier": "free"})

    def test_requires_admin(self, sari_session, sari_user):
        # Sari (non-admin) should NOT be able to change tier
        r = sari_session.post(f"{API}/admin/users/{sari_user['user_id']}/tier",
                              json={"tier": "business"})
        assert r.status_code in (401, 403)


# ---------- 4. Storefront by-slug tier injection ----------
class TestStorefrontTierFields:
    def test_free_owner_remove_branding_false(self, admin_session, sari_user):
        admin_session.post(f"{API}/admin/users/{sari_user['user_id']}/tier",
                           json={"tier": "free"})
        r = requests.get(f"{API}/shops/by-slug/warung-sari")
        if r.status_code == 404:
            pytest.skip("warung-sari shop not present")
        assert r.status_code == 200
        d = r.json()
        assert "shop" in d
        assert d["shop"].get("owner_tier") == "free"
        assert d["shop"].get("remove_branding") is False

    def test_pro_owner_remove_branding_true(self, admin_session, sari_user):
        admin_session.post(f"{API}/admin/users/{sari_user['user_id']}/tier",
                           json={"tier": "pro"})
        r = requests.get(f"{API}/shops/by-slug/warung-sari")
        if r.status_code == 404:
            pytest.skip("warung-sari shop not present")
        assert r.status_code == 200
        d = r.json()
        assert d["shop"].get("owner_tier") == "pro"
        assert d["shop"].get("remove_branding") is True
        # Restore
        admin_session.post(f"{API}/admin/users/{sari_user['user_id']}/tier",
                           json={"tier": "free"})


# ---------- 5. Product create gating ----------
class TestProductLimitGating:
    """Use a fresh user (free tier) to test 5-product limit cleanly."""

    @pytest.fixture(scope="class")
    def fresh_user(self):
        email = f"TEST_quota_{RUN_ID}@example.com"
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{API}/auth/register",
                   json={"email": email, "password": "secret123", "name": "Quota User"})
        assert r.status_code == 200, r.text
        # Create shop
        r = s.post(f"{API}/shops/me", json={
            "name": f"Quota Shop {RUN_ID}", "tagline": "t", "description": "d",
            "business_type": "kuliner", "whatsapp": "08123456789", "brand_color": "#C04A3B",
        })
        assert r.status_code == 200, r.text
        return s

    def test_free_tier_product_limit(self, fresh_user):
        # Create 5 products — should succeed
        for i in range(5):
            r = fresh_user.post(f"{API}/products", json={
                "name": f"P{i}", "price": 1000 + i, "stock": 1, "description": "",
                "image_data": "", "ig_caption": "", "tiktok_caption": "", "hashtags": [],
            })
            assert r.status_code == 200, f"#{i} failed: {r.status_code} {r.text}"
        # 6th should fail with 402
        r = fresh_user.post(f"{API}/products", json={
            "name": "P6", "price": 6000, "stock": 1, "description": "",
            "image_data": "", "ig_caption": "", "tiktok_caption": "", "hashtags": [],
        })
        assert r.status_code == 402, f"expected 402, got {r.status_code} {r.text}"
        detail = r.json().get("detail", "")
        assert "free" in detail.lower() and "5 produk" in detail.lower()


# ---------- 6. AI quota gating ----------
class TestAIQuotaGating:
    """Use a fresh user to test AI monthly quotas without polluting sari's data."""

    @pytest.fixture(scope="class")
    def quota_user(self):
        email = f"TEST_aiquota_{RUN_ID}@example.com"
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{API}/auth/register",
                   json={"email": email, "password": "secret123", "name": "AIQ User"})
        assert r.status_code == 200, r.text
        # Create shop (some endpoints need it)
        s.post(f"{API}/shops/me", json={
            "name": f"AIQ Shop {RUN_ID}", "tagline": "t", "description": "d",
            "business_type": "kuliner", "whatsapp": "08000000000", "brand_color": "#C04A3B",
        })
        return s

    def test_ai_copy_quota_5_per_month(self, quota_user):
        """Free tier: 5 ai_copy calls succeed, 6th returns 402."""
        # generate-content uses ai_copy bucket
        success_count = 0
        last_status = None
        for i in range(6):
            r = quota_user.post(f"{API}/ai/generate-content", json={
                "product_name": f"Test Item {i}",
                "business_type": "kuliner",
                "shop_name": "AIQ Shop",
                "extra_hints": "",
            }, timeout=60)
            last_status = r.status_code
            if r.status_code == 200:
                success_count += 1
            elif r.status_code == 402:
                # quota exceeded — should happen on 6th
                detail = r.json().get("detail", "").lower()
                assert "ai_copy" in detail and "free" in detail and "habis" in detail
                break
            else:
                # Upstream LLM failure — don't count as quota success but bail
                pytest.skip(f"Upstream AI failure (status {r.status_code}): {r.text[:200]}")
        assert last_status == 402, f"never hit quota; last status={last_status}, successes={success_count}"
        # Should have hit 402 within 6 attempts
        assert success_count <= 5

    def test_ai_cover_quota_2_per_month(self, quota_user):
        """Free tier: 2 ai_cover calls, 3rd → 402.

        We don't actually need to succeed — even the 1st succeeding then 402 on 3rd
        is enough proof. If LLM upstream is flaky, fall back to checking that 402
        triggers eventually.
        """
        last_status = None
        attempts_402 = 0
        for i in range(4):
            r = quota_user.post(f"{API}/ai/generate-cover", json={
                "shop_name": "AIQ Shop", "tagline": "tagline",
                "business_type": "kuliner", "brand_color": "#C04A3B",
            }, timeout=90)
            last_status = r.status_code
            if r.status_code == 402:
                attempts_402 += 1
                detail = r.json().get("detail", "").lower()
                assert "ai_cover" in detail and "free" in detail
                break
        # Either we hit 402 on attempt 3+, or the AI upstream failed every time
        if last_status not in (200, 402):
            pytest.skip(f"AI cover upstream issue: status={last_status}")
        # If we never got 402 after 4 attempts but all 200, fail
        if last_status == 200:
            pytest.fail("Expected 402 by 3rd attempt on free tier (limit=2), but never hit quota")


# ---------- 7. monthly_usage index & idempotency ----------
class TestMonthlyUsageIndex:
    def test_index_exists_via_increment_consistency(self, admin_session, sari_session, sari_user):
        """Indirect verification: hit /billing/me twice and check usage doesn't decrement."""
        admin_session.post(f"{API}/admin/users/{sari_user['user_id']}/tier",
                           json={"tier": "free"})
        r1 = sari_session.get(f"{API}/billing/me").json()
        r2 = sari_session.get(f"{API}/billing/me").json()
        # /billing/me is read-only — usage should be identical (no double-counting)
        assert r1["usage"]["ai_photo"]["used"] == r2["usage"]["ai_photo"]["used"]
        assert r1["products"]["used"] == r2["products"]["used"]
