"""Storefront Pro tests: extended Shop fields + AI generate-about + generate-cover."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE_URL}/api"

RUN_ID = uuid.uuid4().hex[:6]


@pytest.fixture(scope="module")
def auth_session():
    """Register a fresh user and return logged-in session."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_sfpro_{RUN_ID}@example.com"
    pw = "lapakin123"
    r = s.post(f"{API}/auth/register",
               json={"email": email, "password": pw, "name": f"SFPro {RUN_ID}"})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def shop_with_pro_fields(auth_session):
    """Create a shop with all Storefront Pro fields populated."""
    payload = {
        "name": f"Toko SFPro {RUN_ID}",
        "tagline": "tagline pro",
        "description": "deskripsi pro",
        "business_type": "kuliner",
        "whatsapp": "08123450099",
        "brand_color": "#8B5E3C",
        # New Storefront Pro fields
        "cover_image": "data:image/png;base64,COVERAAAA",
        "about": "Cerita awal kami sederhana, dari dapur kecil di Jakarta.",
        "hours": "Senin-Sabtu 08:00-21:00",
        "address": "Jl. Mawar No. 12, Jakarta",
        "instagram": "tokosfpro",
        "tiktok": "tokosfpro_id",
        "shopee": "https://shopee.co.id/tokosfpro",
        "promo_active": True,
        "promo_title": "Diskon Pembukaan",
        "promo_description": "Diskon 20% untuk semua pembelian minggu ini",
        "promo_code": "PROMO20",
        "story": [
            {"image": "data:image/png;base64,STORY1", "caption": "Pagi yang sibuk"},
            {"image": "data:image/png;base64,STORY2", "caption": "Pelanggan setia"},
        ],
    }
    r = auth_session.post(f"{API}/shops/me", json=payload)
    assert r.status_code == 200, r.text
    return r.json(), payload


# ---------- Shop model: extended fields persist ----------
class TestShopProFields:
    def test_create_shop_persists_all_new_fields(self, shop_with_pro_fields):
        shop, payload = shop_with_pro_fields
        assert shop["cover_image"] == payload["cover_image"]
        assert shop["about"].startswith("Cerita")
        assert shop["hours"] == payload["hours"]
        assert shop["address"] == payload["address"]
        assert shop["instagram"] == "tokosfpro"
        assert shop["tiktok"] == "tokosfpro_id"
        assert shop["shopee"].startswith("https://shopee")
        assert shop["promo_active"] is True
        assert shop["promo_title"] == "Diskon Pembukaan"
        assert shop["promo_code"] == "PROMO20"
        assert isinstance(shop["story"], list) and len(shop["story"]) == 2
        assert shop["story"][0]["caption"] == "Pagi yang sibuk"

    def test_get_my_shop_returns_new_fields(self, auth_session, shop_with_pro_fields):
        r = auth_session.get(f"{API}/shops/me")
        assert r.status_code == 200
        d = r.json()
        assert d["cover_image"].startswith("data:image/png;base64,")
        assert d["promo_active"] is True
        assert len(d["story"]) == 2
        assert d["instagram"] == "tokosfpro"

    def test_update_shop_modifies_pro_fields(self, auth_session, shop_with_pro_fields):
        shop, payload = shop_with_pro_fields
        updated = {
            **payload,
            "promo_active": False,
            "promo_title": "Promo Selesai",
            "story": [{"image": "data:image/png;base64,NEWSTORY", "caption": "Update"}],
            "hours": "24 Jam",
        }
        r = auth_session.post(f"{API}/shops/me", json=updated)
        assert r.status_code == 200
        d = r.json()
        assert d["promo_active"] is False
        assert d["promo_title"] == "Promo Selesai"
        assert len(d["story"]) == 1
        assert d["story"][0]["caption"] == "Update"
        assert d["hours"] == "24 Jam"
        # Verify persistence via GET
        r2 = auth_session.get(f"{API}/shops/me")
        assert r2.json()["hours"] == "24 Jam"
        assert r2.json()["promo_active"] is False

    def test_public_storefront_returns_pro_fields(self, shop_with_pro_fields):
        shop, _ = shop_with_pro_fields
        slug = shop["slug"]
        r = requests.get(f"{API}/shops/by-slug/{slug}")
        assert r.status_code == 200
        d = r.json()
        assert "shop" in d and "products" in d
        s = d["shop"]
        # All Pro fields exposed publicly
        for key in ["cover_image", "about", "hours", "address",
                    "instagram", "tiktok", "shopee",
                    "promo_active", "promo_title", "promo_description", "promo_code",
                    "story", "whatsapp", "brand_color"]:
            assert key in s, f"missing {key} in public storefront response"
        assert isinstance(s["story"], list)


# ---------- AI: generate-about ----------
class TestAIGenerateAbout:
    def test_requires_auth(self):
        r = requests.post(f"{API}/ai/generate-about",
                          json={"shop_name": "x", "business_type": "kuliner"})
        assert r.status_code == 401

    @pytest.mark.timeout(60)
    def test_generates_indonesian_about(self, auth_session):
        r = auth_session.post(f"{API}/ai/generate-about", json={
            "shop_name": "Warung Sari",
            "business_type": "kuliner",
            "tagline": "Masakan rumahan",
            "description": "Warung kecil keluarga"
        }, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "about" in d
        about = d["about"]
        assert isinstance(about, str)
        assert len(about) > 30, f"too short: {about}"
        # Should look like Bahasa Indonesia: contains common indo words
        lower = about.lower()
        # Heuristic: at least one common Bahasa marker
        assert any(w in lower for w in ["kami", "yang", "dengan", "untuk", "dari", "di", "ini"]), \
            f"doesn't look like Bahasa Indonesia: {about[:200]}"

    def test_validates_required_fields(self, auth_session):
        # missing business_type
        r = auth_session.post(f"{API}/ai/generate-about", json={"shop_name": "x"})
        assert r.status_code == 422


# ---------- AI: generate-cover (single call, slow) ----------
class TestAIGenerateCover:
    def test_requires_auth(self):
        r = requests.post(f"{API}/ai/generate-cover",
                          json={"shop_name": "x", "business_type": "kuliner"})
        assert r.status_code == 401

    def test_validates_required_fields(self, auth_session):
        r = auth_session.post(f"{API}/ai/generate-cover", json={"style": "warm"})
        assert r.status_code == 422

    @pytest.mark.timeout(90)
    def test_generates_cover_image(self, auth_session):
        # ONE call only — Nano Banana is slow & costly
        r = auth_session.post(f"{API}/ai/generate-cover", json={
            "shop_name": f"Toko Cover {RUN_ID}",
            "business_type": "kuliner",
            "style": "warm",
        }, timeout=90)
        # Accept 200 OR upstream 500/502 (model may refuse), per testing policy
        if r.status_code == 200:
            d = r.json()
            assert "image_base64" in d and len(d["image_base64"]) > 100
            assert "mime_type" in d
            assert d["mime_type"].startswith("image/")
        else:
            print(f"generate-cover returned {r.status_code}: {r.text[:300]}")
            assert r.status_code in (500, 502)
