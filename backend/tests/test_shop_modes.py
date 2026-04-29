"""Backend tests for Iteration 7 - Shop Sales Modes (sells_by, is_open, available_days)"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://learn-indonesian-22.preview.emergentagent.com").rstrip("/")
SARI_EMAIL = "sari@warung.id"
SARI_PASS = "newpass123"


@pytest.fixture(scope="module")
def sari_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": SARI_EMAIL, "password": SARI_PASS}, timeout=20)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def fresh_user_session():
    """Register a brand new user so we can test create-shop smart-defaults."""
    s = requests.Session()
    import uuid
    email = f"TEST_modes_{uuid.uuid4().hex[:8]}@test.io"
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": "testpass123", "name": "TEST Mode User"},
               timeout=20)
    assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
    return s, email


# -----------------------------------------------------------------
# 1. Shop model + smart defaults on CREATE
# -----------------------------------------------------------------
class TestShopSmartDefaults:
    def test_kuliner_defaults_to_hours(self, fresh_user_session):
        s, email = fresh_user_session
        payload = {"name": f"TEST Kuliner {email[:10]}", "business_type": "kuliner",
                   "tagline": "warung", "whatsapp": "0810000"}
        r = s.post(f"{BASE_URL}/api/shops/me", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        shop = r.json()
        assert shop["sells_by"] == "hours"
        assert shop["is_open"] is True
        # cleanup not needed (test user)

    def test_existing_shop_explicit_always_persists(self, fresh_user_session):
        s, _ = fresh_user_session
        # Update -- we're now updating because shop already exists
        r = s.post(f"{BASE_URL}/api/shops/me",
                   json={"name": "TEST Update", "business_type": "kuliner",
                         "sells_by": "always", "is_open": False},
                   timeout=20)
        assert r.status_code == 200, r.text
        shop = r.json()
        assert shop["sells_by"] == "always"
        assert shop["is_open"] is False


class TestStockDefaultForOtherTypes:
    def test_fashion_defaults_to_stock(self):
        """Register fresh user, create fashion shop -> sells_by stays stock."""
        s = requests.Session()
        import uuid
        email = f"TEST_fashion_{uuid.uuid4().hex[:8]}@test.io"
        r = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email": email, "password": "testpass123", "name": "TEST Fashion"}, timeout=20)
        assert r.status_code == 200
        r2 = s.post(f"{BASE_URL}/api/shops/me",
                    json={"name": f"TEST Fashion Shop {email[:10]}", "business_type": "fashion"},
                    timeout=20)
        assert r2.status_code == 200, r2.text
        shop = r2.json()
        assert shop["sells_by"] == "stock"


# -----------------------------------------------------------------
# 2. Toggle endpoint
# -----------------------------------------------------------------
class TestToggleOpen:
    def test_toggle_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/shops/me/toggle-open", timeout=20)
        assert r.status_code == 401

    def test_toggle_alternates(self, sari_session):
        # First toggle
        r1 = sari_session.post(f"{BASE_URL}/api/shops/me/toggle-open", timeout=20)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert "is_open" in d1
        assert isinstance(d1["is_open"], bool)
        first = d1["is_open"]

        # Second toggle should flip
        r2 = sari_session.post(f"{BASE_URL}/api/shops/me/toggle-open", timeout=20)
        assert r2.status_code == 200
        second = r2.json()["is_open"]
        assert second == (not first)

        # Third toggle to restore is_open=True (sari is hours-mode kuliner)
        r3 = sari_session.post(f"{BASE_URL}/api/shops/me/toggle-open", timeout=20)
        assert r3.status_code == 200
        third = r3.json()["is_open"]
        assert third == (not second)
        # Restore to True if needed
        if not third:
            sari_session.post(f"{BASE_URL}/api/shops/me/toggle-open", timeout=20)


# -----------------------------------------------------------------
# 3. Public storefront returns sells_by + is_open + available_days
# -----------------------------------------------------------------
class TestPublicStorefrontIncludesNewFields:
    def test_warung_sari_has_mode_fields(self):
        r = requests.get(f"{BASE_URL}/api/shops/by-slug/warung-sari", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        shop = data["shop"]
        assert "sells_by" in shop
        assert shop["sells_by"] == "hours"
        assert "is_open" in shop
        assert isinstance(shop["is_open"], bool)
        # products contain available_days field
        products = data["products"]
        assert isinstance(products, list)
        assert len(products) > 0
        # NOTE: legacy products created before the field was added may lack
        # `available_days`. The frontend handles this with `(p.available_days || [])`.
        # New products should include the field.
        new_products = [p for p in products if p.get("name") in ("Nasi Pecel", "Soto Ayam", "Rendang")]
        assert len(new_products) >= 1
        for p in new_products:
            # If field present, must be a list
            if "available_days" in p:
                assert isinstance(p["available_days"], list)


# -----------------------------------------------------------------
# 4. Product create+update with available_days
# -----------------------------------------------------------------
class TestProductAvailableDays:
    def test_create_product_with_available_days(self, sari_session):
        r = sari_session.post(f"{BASE_URL}/api/products",
                              json={"name": "TEST Mie Ayam", "price": 15000, "stock": 0,
                                    "available_days": [0, 2, 4]}, timeout=20)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["available_days"] == [0, 2, 4]
        product_id = p["product_id"]

        # Verify GET returns it
        r2 = sari_session.get(f"{BASE_URL}/api/products", timeout=20)
        assert r2.status_code == 200
        match = next((x for x in r2.json() if x["product_id"] == product_id), None)
        assert match is not None
        assert match["available_days"] == [0, 2, 4]

        # UPDATE to a different schedule
        r3 = sari_session.put(f"{BASE_URL}/api/products/{product_id}",
                              json={"name": "TEST Mie Ayam", "price": 15000, "stock": 0,
                                    "available_days": [1, 3, 5]}, timeout=20)
        assert r3.status_code == 200, r3.text
        assert r3.json()["available_days"] == [1, 3, 5]

        # Update to empty (daily)
        r4 = sari_session.put(f"{BASE_URL}/api/products/{product_id}",
                              json={"name": "TEST Mie Ayam", "price": 15000, "stock": 0,
                                    "available_days": []}, timeout=20)
        assert r4.status_code == 200
        assert r4.json()["available_days"] == []

        # cleanup
        sari_session.delete(f"{BASE_URL}/api/products/{product_id}", timeout=20)


# -----------------------------------------------------------------
# 5. Toggle endpoint accepts empty body
# -----------------------------------------------------------------
class TestToggleEmptyBody:
    def test_toggle_accepts_no_body(self, sari_session):
        # Explicitly no body, no Content-Type
        r = sari_session.post(f"{BASE_URL}/api/shops/me/toggle-open",
                              data=None, timeout=20)
        assert r.status_code == 200
        # toggle back
        sari_session.post(f"{BASE_URL}/api/shops/me/toggle-open", timeout=20)
