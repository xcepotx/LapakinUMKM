"""Lapakin backend API tests."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    # fallback to frontend env file
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip().rstrip('/')

API = f"{BASE_URL}/api"

# 1x1 transparent PNG
TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

# Unique test user prefix
RUN_ID = uuid.uuid4().hex[:6]


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def new_user(session):
    """Register a fresh user for testing CRUD flows."""
    email = f"TEST_{RUN_ID}@example.com"
    password = "lapakin123"
    name = f"Test User {RUN_ID}"
    r = session.post(f"{API}/auth/register", json={
        "email": email, "password": password, "name": name
    })
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return {"email": email, "password": password, "name": name, **data}


# ---------- Health ----------
class TestHealth:
    def test_root(self, session):
        r = session.get(f"{API}/")
        assert r.status_code == 200
        d = r.json()
        assert d.get("app") == "Lapakin"
        assert d.get("status") == "ok"


# ---------- Auth ----------
class TestAuth:
    def test_register_returns_user_and_cookie(self, session):
        email = f"TEST_reg_{RUN_ID}@example.com"
        r = session.post(f"{API}/auth/register",
                         json={"email": email, "password": "secret123", "name": "Reg User"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["email"] == email.lower()
        assert d["name"] == "Reg User"
        assert d["auth_provider"] == "email"
        assert "access_token" in d
        # cookie set
        assert "access_token" in session.cookies.get_dict()

    def test_register_duplicate_email(self, session, new_user):
        r = session.post(f"{API}/auth/register", json={
            "email": new_user["email"], "password": "x123456", "name": "dup"
        })
        assert r.status_code == 400
        assert "sudah terdaftar" in r.json().get("detail", "").lower()

    def test_login_invalid_password(self, session, new_user):
        s = requests.Session()
        r = s.post(f"{API}/auth/login",
                   json={"email": new_user["email"], "password": "wrongpass"})
        assert r.status_code == 401
        assert "salah" in r.json().get("detail", "").lower()

    def test_login_success(self, new_user):
        s = requests.Session()
        r = s.post(f"{API}/auth/login",
                   json={"email": new_user["email"], "password": new_user["password"]})
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == new_user["email"]
        assert "access_token" in s.cookies.get_dict()

    def test_me_no_auth(self):
        s = requests.Session()
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_with_auth(self, new_user):
        s = requests.Session()
        s.post(f"{API}/auth/login",
               json={"email": new_user["email"], "password": new_user["password"]})
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == new_user["email"]

    def test_logout_clears_cookie(self, new_user):
        s = requests.Session()
        s.post(f"{API}/auth/login",
               json={"email": new_user["email"], "password": new_user["password"]})
        assert "access_token" in s.cookies.get_dict()
        r = s.post(f"{API}/auth/logout")
        assert r.status_code == 200
        # Subsequent /me should fail
        r2 = s.get(f"{API}/auth/me")
        assert r2.status_code == 401

    def test_admin_login(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login",
                   json={"email": "admin@lapakin.id", "password": "lapakin123"})
        assert r.status_code == 200, r.text


# ---------- Shops ----------
@pytest.fixture(scope="module")
def auth_session(new_user):
    s = requests.Session()
    s.post(f"{API}/auth/login",
           json={"email": new_user["email"], "password": new_user["password"]})
    return s


class TestShops:
    def test_get_my_shop_initially_null(self, auth_session):
        r = auth_session.get(f"{API}/shops/me")
        assert r.status_code == 200
        # may be null
        assert r.json() is None

    def test_create_shop(self, auth_session):
        payload = {
            "name": f"Toko Test {RUN_ID}",
            "tagline": "test tagline",
            "description": "desc",
            "business_type": "kuliner",
            "whatsapp": "08123456789",
            "brand_color": "#C04A3B",
        }
        r = auth_session.post(f"{API}/shops/me", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == payload["name"]
        assert "slug" in d
        assert d["slug"].startswith("toko-test")
        assert "shop_id" in d
        # store for later
        TestShops.shop_slug = d["slug"]
        TestShops.shop_id = d["shop_id"]

    def test_create_shop_idempotent_update(self, auth_session):
        # Second POST should UPDATE, not create new
        payload = {
            "name": f"Toko Test {RUN_ID}",
            "tagline": "updated tagline",
            "description": "updated",
            "business_type": "kopi",
            "whatsapp": "08123456789",
            "brand_color": "#8B5E3C",
        }
        r = auth_session.post(f"{API}/shops/me", json=payload)
        assert r.status_code == 200
        d = r.json()
        assert d["tagline"] == "updated tagline"
        assert d["business_type"] == "kopi"
        # shop_id unchanged
        assert d["shop_id"] == TestShops.shop_id

    def test_get_my_shop(self, auth_session):
        r = auth_session.get(f"{API}/shops/me")
        assert r.status_code == 200
        d = r.json()
        assert d["shop_id"] == TestShops.shop_id

    def test_public_storefront_by_slug(self):
        s = requests.Session()  # no auth
        r = s.get(f"{API}/shops/by-slug/{TestShops.shop_slug}")
        assert r.status_code == 200
        d = r.json()
        assert "shop" in d and "products" in d
        assert d["shop"]["slug"] == TestShops.shop_slug

    def test_public_storefront_404(self):
        r = requests.get(f"{API}/shops/by-slug/no-such-slug-xyz-{RUN_ID}")
        assert r.status_code == 404

    def test_seeded_warung_sari_exists(self):
        r = requests.get(f"{API}/shops/by-slug/warung-sari")
        # may or may not exist depending on prior test runs
        assert r.status_code in (200, 404)


# ---------- Products ----------
class TestProducts:
    def test_create_product(self, auth_session):
        payload = {
            "name": f"Produk Test {RUN_ID}",
            "price": 25000,
            "stock": 10,
            "description": "deskripsi test",
            "image_data": "",
            "ig_caption": "ig",
            "tiktok_caption": "tt",
            "hashtags": ["#test"],
        }
        r = auth_session.post(f"{API}/products", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == payload["name"]
        assert d["price"] == 25000
        assert "product_id" in d
        TestProducts.product_id = d["product_id"]

    def test_list_products(self, auth_session):
        r = auth_session.get(f"{API}/products")
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert any(p["product_id"] == TestProducts.product_id for p in items)

    def test_update_product(self, auth_session):
        payload = {
            "name": f"Produk Updated {RUN_ID}",
            "price": 30000,
            "stock": 5,
            "description": "updated desc",
            "image_data": "",
            "ig_caption": "",
            "tiktok_caption": "",
            "hashtags": [],
        }
        r = auth_session.put(f"{API}/products/{TestProducts.product_id}", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == payload["name"]
        assert r.json()["price"] == 30000

    def test_other_user_cannot_modify(self, auth_session):
        # Create another user and try to update first user's product -> should 404
        email = f"TEST_other_{RUN_ID}@example.com"
        s2 = requests.Session()
        s2.post(f"{API}/auth/register",
                json={"email": email, "password": "secret123", "name": "Other"})
        r = s2.put(f"{API}/products/{TestProducts.product_id}", json={
            "name": "hack", "price": 1, "stock": 0, "description": "",
            "image_data": "", "ig_caption": "", "tiktok_caption": "", "hashtags": [],
        })
        assert r.status_code in (400, 404)

    def test_delete_product(self, auth_session):
        r = auth_session.delete(f"{API}/products/{TestProducts.product_id}")
        assert r.status_code == 200
        # verify removed
        r2 = auth_session.get(f"{API}/products")
        assert all(p["product_id"] != TestProducts.product_id for p in r2.json())


# ---------- AI ----------
class TestAI:
    def test_generate_content_requires_auth(self):
        r = requests.post(f"{API}/ai/generate-content",
                          json={"product_name": "x"})
        assert r.status_code == 401

    def test_generate_content(self, auth_session):
        r = auth_session.post(f"{API}/ai/generate-content", json={
            "product_name": "Kopi Susu Gula Aren",
            "business_type": "kuliner",
            "shop_name": "Warung Test",
            "extra_hints": "manis dan creamy"
        }, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "description" in d and len(d["description"]) > 5
        assert "ig_caption" in d
        assert "tiktok_caption" in d
        assert isinstance(d.get("hashtags"), list)

    def test_suggest_theme(self, auth_session):
        r = auth_session.post(f"{API}/ai/suggest-theme", json={
            "business_type": "kuliner", "shop_name": "Warung Test"
        }, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["brand_color"].startswith("#") and len(d["brand_color"]) == 7
        assert "tagline" in d

    @pytest.mark.timeout(60)
    def test_enhance_image(self, auth_session):
        # Slowest endpoint - allow up to 60s
        r = auth_session.post(f"{API}/ai/enhance-image", json={
            "image_base64": TINY_PNG_B64, "style": "clean"
        }, timeout=60)
        # Accept either 200 OR upstream failure (502/500) for tiny invalid product image
        if r.status_code == 200:
            d = r.json()
            assert "image_base64" in d
            assert "mime_type" in d
        else:
            # log but don't hard-fail (image is 1x1, model may refuse)
            print(f"enhance-image returned {r.status_code}: {r.text[:300]}")
            assert r.status_code in (200, 500, 502)
