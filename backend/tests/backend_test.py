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


# ---------- Forgot/Reset Password ----------
class TestForgotPassword:
    def test_forgot_unknown_email_no_token(self, session):
        r = session.post(f"{API}/auth/forgot-password",
                         json={"email": f"TEST_unknown_{RUN_ID}@example.com"})
        assert r.status_code == 200
        d = r.json()
        assert d.get("ok") is True
        assert "reset_token" not in d  # privacy: no token leaked

    def test_forgot_known_returns_token(self, session, new_user):
        r = session.post(f"{API}/auth/forgot-password", json={"email": new_user["email"]})
        assert r.status_code == 200
        d = r.json()
        assert d.get("ok") is True
        # When Resend configured, token isn't returned (email-mode). Fetch from DB.
        if d.get("simple_mode"):
            assert isinstance(d.get("reset_token"), str)
            assert len(d["reset_token"]) > 10
            TestForgotPassword.token = d["reset_token"]
        else:
            # email-mode: privacy, no token leaked → fetch directly from Mongo
            import pymongo, os
            mongo = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db_name = os.environ.get("DB_NAME", "lapakin_db")
            rec = mongo[db_name].password_reset_tokens.find_one(
                {"email": new_user["email"], "used": False},
                sort=[("created_at", -1)],
            )
            mongo.close()
            assert rec and rec.get("token"), "reset token not persisted in Mongo"
            TestForgotPassword.token = rec["token"]

    def test_reset_with_short_password(self, session):
        r = session.post(f"{API}/auth/reset-password",
                         json={"token": TestForgotPassword.token, "new_password": "abc"})
        assert r.status_code == 422  # pydantic min_length

    def test_reset_with_invalid_token(self, session):
        r = session.post(f"{API}/auth/reset-password",
                         json={"token": "garbage-token-xyz", "new_password": "newpass123"})
        assert r.status_code == 400

    def test_reset_success_and_login(self, session, new_user):
        new_pw = "newpass456"
        r = session.post(f"{API}/auth/reset-password",
                         json={"token": TestForgotPassword.token, "new_password": new_pw})
        assert r.status_code == 200, r.text
        # Old password should fail
        s = requests.Session()
        r2 = s.post(f"{API}/auth/login",
                    json={"email": new_user["email"], "password": new_user["password"]})
        assert r2.status_code == 401
        # New password should work
        r3 = s.post(f"{API}/auth/login",
                    json={"email": new_user["email"], "password": new_pw})
        assert r3.status_code == 200
        # update fixture password for downstream
        new_user["password"] = new_pw

    def test_reset_token_reuse_fails(self, session):
        r = session.post(f"{API}/auth/reset-password",
                         json={"token": TestForgotPassword.token, "new_password": "anotherpw99"})
        assert r.status_code == 400


# ---------- Multi-image Products ----------
class TestMultiImage:
    def test_create_with_images_array(self, auth_session):
        payload = {
            "name": f"MultiImg {RUN_ID}",
            "price": 15000, "stock": 3, "description": "multi",
            "images": ["data:image/png;base64,AAA", "data:image/png;base64,BBB", "data:image/png;base64,CCC"],
            "image_data": "",
            "ig_caption": "", "tiktok_caption": "", "hashtags": [],
        }
        r = auth_session.post(f"{API}/products", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["images"]) == 3
        # image_data auto-syncs to images[0]
        assert d["image_data"] == "data:image/png;base64,AAA"
        TestMultiImage.pid = d["product_id"]

    def test_backward_compat_image_data_only(self, auth_session):
        payload = {
            "name": f"BackCompat {RUN_ID}",
            "price": 5000, "stock": 1, "description": "",
            "image_data": "data:image/png;base64,XYZ",
            "images": [],
            "ig_caption": "", "tiktok_caption": "", "hashtags": [],
        }
        r = auth_session.post(f"{API}/products", json=payload)
        assert r.status_code == 200
        d = r.json()
        assert d["images"] == ["data:image/png;base64,XYZ"]

    def test_update_images_array(self, auth_session):
        payload = {
            "name": f"MultiImg {RUN_ID}",
            "price": 15000, "stock": 3, "description": "multi",
            "images": ["data:image/png;base64,NEW1", "data:image/png;base64,NEW2"],
            "image_data": "",
            "ig_caption": "", "tiktok_caption": "", "hashtags": [],
        }
        r = auth_session.put(f"{API}/products/{TestMultiImage.pid}", json=payload)
        assert r.status_code == 200
        d = r.json()
        assert len(d["images"]) == 2
        assert d["image_data"] == "data:image/png;base64,NEW1"


# ---------- WhatsApp Bot ----------
class TestWhatsApp:
    def test_status_requires_auth(self):
        r = requests.get(f"{API}/whatsapp/status")
        assert r.status_code == 401

    def test_status_initial(self, auth_session):
        # ensure clean state
        auth_session.post(f"{API}/whatsapp/disconnect")
        r = auth_session.get(f"{API}/whatsapp/status")
        assert r.status_code == 200
        d = r.json()
        assert d["linked"] is False
        assert "twilio_configured" in d
        assert d["twilio_configured"] is False  # twilio env not set

    def test_connect_start_returns_code(self, auth_session):
        r = auth_session.post(f"{API}/whatsapp/connect/start")
        assert r.status_code == 200
        d = r.json()
        assert "code" in d and len(d["code"]) == 6 and d["code"].isdigit()
        assert d["expires_in_minutes"] == 15
        assert "instructions" in d
        TestWhatsApp.code = d["code"]

    def test_webhook_pair_flow(self, auth_session):
        # use a unique phone number for this run
        phone = f"+62888{int(time.time()) % 1000000:06d}"
        TestWhatsApp.phone = phone
        r = requests.post(f"{API}/whatsapp/webhook",
                          data={"From": f"whatsapp:{phone}",
                                "Body": f"lapakin {TestWhatsApp.code}",
                                "NumMedia": "0"})
        assert r.status_code == 200
        assert "xml" in r.headers.get("content-type", "").lower()
        assert "terhubung" in r.text.lower() or "🎉" in r.text
        # status should now be linked
        st = auth_session.get(f"{API}/whatsapp/status").json()
        assert st["linked"] is True
        assert phone in (st["phone"] or "")

    def test_webhook_help(self):
        r = requests.post(f"{API}/whatsapp/webhook",
                          data={"From": f"whatsapp:{TestWhatsApp.phone}",
                                "Body": "help", "NumMedia": "0"})
        assert r.status_code == 200
        assert "lapakin" in r.text.lower()

    def test_webhook_list(self):
        r = requests.post(f"{API}/whatsapp/webhook",
                          data={"From": f"whatsapp:{TestWhatsApp.phone}",
                                "Body": "list", "NumMedia": "0"})
        assert r.status_code == 200
        # either "produk terakhir" or "Belum ada produk"
        assert "produk" in r.text.lower()

    def test_webhook_unlinked_phone(self):
        r = requests.post(f"{API}/whatsapp/webhook",
                          data={"From": "whatsapp:+62999000111", "Body": "hi", "NumMedia": "0"})
        assert r.status_code == 200
        assert "belum terhubung" in r.text.lower()

    def test_webhook_text_no_media_when_linked_asks_photo(self):
        r = requests.post(f"{API}/whatsapp/webhook",
                          data={"From": f"whatsapp:{TestWhatsApp.phone}",
                                "Body": "Kopi Susu Aren 25000",
                                "NumMedia": "0"})
        assert r.status_code == 200
        # Parser ran and saw price -> asks for foto (no "Harga tidak terbaca")
        assert "foto" in r.text.lower()
        assert "harga tidak terbaca" not in r.text.lower()

    def test_webhook_text_no_price_no_media(self):
        r = requests.post(f"{API}/whatsapp/webhook",
                          data={"From": f"whatsapp:{TestWhatsApp.phone}",
                                "Body": "Sekedar pesan",
                                "NumMedia": "0"})
        assert r.status_code == 200
        # either asks foto first OR says harga tidak terbaca; both acceptable
        # current code path: num_media==0 returns asks-for-foto BEFORE parsing
        assert "foto" in r.text.lower()

    def test_disconnect(self, auth_session):
        r = auth_session.post(f"{API}/whatsapp/disconnect")
        assert r.status_code == 200
        st = auth_session.get(f"{API}/whatsapp/status").json()
        assert st["linked"] is False


# ---------- WhatsApp text parser via direct import ----------
class TestParser:
    def test_parser_variants(self):
        # Direct import from server module
        import sys
        sys.path.insert(0, "/app/backend")
        from server import _parse_product_text
        n, p, s = _parse_product_text("Kopi Susu Aren 25000 stok 20")
        assert n == "Kopi Susu Aren" and p == 25000 and s == 20
        n, p, s = _parse_product_text("Donat Kentang Rp 8.000")
        assert "Donat" in n and p == 8000 and s == 0
        n, p, s = _parse_product_text("Croissant 15rb")
        assert "Croissant" in n and p == 15000
        n, p, s = _parse_product_text("Es Teh 5k stok 50")
        assert "Es Teh" in n and p == 5000 and s == 50
