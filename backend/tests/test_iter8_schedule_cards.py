"""Backend tests for Iteration 8 — Auto Schedule + Toko Cards Generator (IG post/story)."""
import os
import io
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://learn-indonesian-22.preview.emergentagent.com").rstrip("/")
SARI_EMAIL = "sari@warung.id"
SARI_PASS = "newpass123"
JAKARTA = timezone(timedelta(hours=7))


@pytest.fixture(scope="module")
def sari_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": SARI_EMAIL, "password": SARI_PASS}, timeout=20)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def original_shop_state(sari_session):
    """Snapshot warung-sari shop state, restore after the module."""
    r = sari_session.get(f"{BASE_URL}/api/shops/me", timeout=20)
    assert r.status_code == 200
    snapshot = r.json()
    yield snapshot
    # Restore key fields
    payload = {
        "name": snapshot.get("name"),
        "tagline": snapshot.get("tagline", ""),
        "description": snapshot.get("description", ""),
        "business_type": snapshot.get("business_type", "kuliner"),
        "whatsapp": snapshot.get("whatsapp", ""),
        "brand_color": snapshot.get("brand_color", "#C04A3B"),
        "logo_url": snapshot.get("logo_url", ""),
        "sells_by": snapshot.get("sells_by", "hours"),
        "is_open": snapshot.get("is_open", True),
        "auto_schedule_enabled": snapshot.get("auto_schedule_enabled", False),
        "schedule": snapshot.get("schedule", []),
    }
    sari_session.post(f"{BASE_URL}/api/shops/me", json=payload, timeout=20)


# ---------------- ShopIn schedule fields ----------------
class TestScheduleFields:
    def test_persist_auto_schedule_and_schedule(self, sari_session, original_shop_state):
        sched = [
            {"open": "08:00", "close": "21:00"},  # Mon
            {"open": "08:00", "close": "21:00"},  # Tue
            {"open": "08:00", "close": "21:00"},  # Wed
            {"open": "08:00", "close": "21:00"},  # Thu
            {"open": "08:00", "close": "21:00"},  # Fri
            {"open": "09:00", "close": "22:00"},  # Sat
            None,                                 # Sun
        ]
        payload = {
            "name": original_shop_state.get("name"),
            "business_type": original_shop_state.get("business_type", "kuliner"),
            "sells_by": "hours",
            "is_open": True,
            "auto_schedule_enabled": True,
            "schedule": sched,
        }
        r = sari_session.post(f"{BASE_URL}/api/shops/me", json=payload, timeout=20)
        assert r.status_code == 200, r.text
        shop = r.json()
        assert shop["auto_schedule_enabled"] is True
        assert shop["schedule"] == sched

        # GET /api/shops/me roundtrip
        r2 = sari_session.get(f"{BASE_URL}/api/shops/me", timeout=20)
        assert r2.status_code == 200
        s2 = r2.json()
        assert s2["auto_schedule_enabled"] is True
        assert s2["schedule"] == sched


# ---------------- schedule_status on public storefront ----------------
class TestScheduleStatus:
    @staticmethod
    def _hhmm_window_around_now(minutes_before=60, minutes_after=120):
        now = datetime.now(JAKARTA)
        op = (now - timedelta(minutes=minutes_before)).strftime("%H:%M")
        cl = (now + timedelta(minutes=minutes_after)).strftime("%H:%M")
        # Avoid wrap that makes cl < op
        if cl < op:
            cl = "23:59"
        return op, cl

    def test_open_window_now(self, sari_session):
        now = datetime.now(JAKARTA)
        today = now.weekday()
        op, cl = self._hhmm_window_around_now()
        sched = [None] * 7
        sched[today] = {"open": op, "close": cl}
        payload = {
            "name": "Warung Sari",
            "business_type": "kuliner",
            "sells_by": "hours",
            "is_open": False,  # manual is False, but auto should override
            "auto_schedule_enabled": True,
            "schedule": sched,
        }
        r = sari_session.post(f"{BASE_URL}/api/shops/me", json=payload, timeout=20)
        assert r.status_code == 200, r.text

        # Check public endpoint
        rp = requests.get(f"{BASE_URL}/api/shops/by-slug/warung-sari", timeout=20)
        assert rp.status_code == 200
        data = rp.json()
        ss = data["shop"].get("schedule_status")
        assert ss is not None, f"schedule_status missing: {data['shop']}"
        assert ss.get("auto") is True
        assert ss.get("is_open_now") is True, f"Expected open, got {ss}"
        assert ss.get("closes_at") == cl
        # is_open should be overridden to True
        assert data["shop"]["is_open"] is True

    def test_closed_today_returns_next_opens_at(self, sari_session):
        # Set today=closed (None), tomorrow opens 08:00
        now = datetime.now(JAKARTA)
        today = now.weekday()
        sched = [None] * 7
        tomorrow = (today + 1) % 7
        sched[tomorrow] = {"open": "08:00", "close": "21:00"}
        payload = {
            "name": "Warung Sari",
            "business_type": "kuliner",
            "sells_by": "hours",
            "auto_schedule_enabled": True,
            "schedule": sched,
        }
        r = sari_session.post(f"{BASE_URL}/api/shops/me", json=payload, timeout=20)
        assert r.status_code == 200

        rp = requests.get(f"{BASE_URL}/api/shops/by-slug/warung-sari", timeout=20)
        ss = rp.json()["shop"].get("schedule_status")
        assert ss.get("auto") is True
        assert ss.get("is_open_now") is False
        # Day prefix expected since opens_at is on a different day
        labels = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]
        expected_label = labels[tomorrow]
        assert ss.get("opens_at") is not None
        assert ss["opens_at"].startswith(expected_label), f"Expected '{expected_label} 08:00', got {ss['opens_at']}"
        assert "08:00" in ss["opens_at"]

    def test_auto_disabled_uses_manual_is_open(self, sari_session):
        # auto disabled -> manual is_open should drive shop.is_open
        payload = {
            "name": "Warung Sari",
            "business_type": "kuliner",
            "sells_by": "hours",
            "is_open": True,
            "auto_schedule_enabled": False,
            "schedule": [],
        }
        r = sari_session.post(f"{BASE_URL}/api/shops/me", json=payload, timeout=20)
        assert r.status_code == 200

        rp = requests.get(f"{BASE_URL}/api/shops/by-slug/warung-sari", timeout=20)
        data = rp.json()
        ss = data["shop"].get("schedule_status")
        assert ss is not None
        assert ss.get("auto") is False
        assert data["shop"]["is_open"] is True


# ---------------- Toko Card endpoints ----------------
class TestProductCards:
    @pytest.fixture(scope="class")
    def a_product_id(self):
        # Get a product from warung-sari
        r = requests.get(f"{BASE_URL}/api/shops/by-slug/warung-sari", timeout=20)
        assert r.status_code == 200
        products = r.json()["products"]
        assert len(products) > 0
        return products[0]["product_id"]

    def test_post_png_dimensions(self, a_product_id):
        from PIL import Image
        r = requests.get(f"{BASE_URL}/api/og/product/{a_product_id}/post.png", timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("image/png")
        assert "cache-control" in {k.lower() for k in r.headers.keys()}
        img = Image.open(io.BytesIO(r.content))
        assert img.size == (1080, 1080), f"Got size {img.size}"

    def test_story_png_dimensions(self, a_product_id):
        from PIL import Image
        r = requests.get(f"{BASE_URL}/api/og/product/{a_product_id}/story.png", timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("image/png")
        img = Image.open(io.BytesIO(r.content))
        assert img.size == (1080, 1920), f"Got size {img.size}"

    def test_post_png_404_for_unknown(self):
        r = requests.get(f"{BASE_URL}/api/og/product/no-such-product-xyz/post.png", timeout=15)
        assert r.status_code == 404

    def test_story_png_404_for_unknown(self):
        r = requests.get(f"{BASE_URL}/api/og/product/no-such-product-xyz/story.png", timeout=15)
        assert r.status_code == 404

    def test_card_renders_with_no_image(self, sari_session):
        from PIL import Image
        # Create a product with no image
        cr = sari_session.post(f"{BASE_URL}/api/products",
                               json={"name": "TEST_NoImage Card", "price": 12345, "stock": 0},
                               timeout=20)
        assert cr.status_code == 200, cr.text
        pid = cr.json()["product_id"]
        try:
            r = requests.get(f"{BASE_URL}/api/og/product/{pid}/post.png", timeout=30)
            assert r.status_code == 200, r.text
            img = Image.open(io.BytesIO(r.content))
            assert img.size == (1080, 1080)
        finally:
            sari_session.delete(f"{BASE_URL}/api/products/{pid}", timeout=20)
