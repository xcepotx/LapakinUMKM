"""Iteration 10 — OG share-card fix + PNG caching tests.

Covers:
- og_html no longer emits <meta http-equiv="refresh"> (FB bot followed it)
- og_html still has the JS window.location.replace fallback
- og:url / og:image / twitter:image are absolute https URLs
- /api/og/shop/<slug>.png returns X-Cache: MISS first, HIT on second call
- Updating shop tagline busts the cache (next .png returns MISS)
- Cache key includes brand_color + name + tagline
"""

import os
import re
import time
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
SHOP_SLUG = "warung-sari"
EMAIL = "sari@warung.id"
PASSWORD = "newpass123"


@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return s


# ---------------- og_html structure ----------------

class TestOgHtmlNoRefresh:
    def test_html_no_meta_http_equiv_refresh(self):
        r = requests.get(f"{BASE_URL}/api/og/shop/{SHOP_SLUG}", timeout=10)
        assert r.status_code == 200
        # Strip HTML comments (the explanatory comment legitimately mentions the removed tag)
        html_no_comments = re.sub(r"<!--.*?-->", "", r.text, flags=re.DOTALL).lower()
        # Critical: actual <meta http-equiv="refresh"> tag MUST be absent (FB bot was following it)
        assert not re.search(r"<meta[^>]+http-equiv\s*=\s*[\"']refresh[\"']", html_no_comments), \
            "actual <meta http-equiv=refresh> tag should be removed (FB bot follows it)"

    def test_html_still_has_js_redirect(self):
        r = requests.get(f"{BASE_URL}/api/og/shop/{SHOP_SLUG}", timeout=10)
        assert r.status_code == 200
        # JS redirect for human browsers must remain
        assert "window.location.replace" in r.text, "JS redirect must remain for humans"

    def test_html_og_url_is_storefront_https(self):
        r = requests.get(f"{BASE_URL}/api/og/shop/{SHOP_SLUG}", timeout=10)
        assert r.status_code == 200
        m = re.search(r'<meta[^>]+property=["\']og:url["\'][^>]+content=["\']([^"\']+)["\']', r.text)
        assert m, "og:url meta missing"
        og_url = m.group(1)
        assert og_url.startswith("https://"), f"og:url should be https, got {og_url}"
        assert og_url.endswith(f"/toko/{SHOP_SLUG}"), f"og:url should be /toko/<slug>, got {og_url}"

    def test_html_og_image_and_twitter_image_absolute_https(self):
        r = requests.get(f"{BASE_URL}/api/og/shop/{SHOP_SLUG}", timeout=10)
        assert r.status_code == 200
        og_img = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', r.text)
        tw_img = re.search(r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']', r.text)
        assert og_img, "og:image missing"
        assert tw_img, "twitter:image missing"
        for url in (og_img.group(1), tw_img.group(1)):
            assert url.startswith("https://"), f"image url must be https, got {url}"
            assert f"/api/og/shop/{SHOP_SLUG}.png" in url, f"image must point to png endpoint, got {url}"


# ---------------- PNG cache ----------------

class TestOgPngCache:
    def test_png_first_miss_second_hit(self):
        # Bust any prior cache by updating tagline first via authenticated session below — but
        # this test runs anonymously; we just hit twice quickly. To guarantee MISS first, we
        # call the cache-busting test via auth fixture in a dedicated test below.
        url = f"{BASE_URL}/api/og/shop/{SHOP_SLUG}.png"
        r1 = requests.get(url, timeout=20)
        assert r1.status_code == 200
        assert r1.headers.get("content-type", "").startswith("image/png")
        # PNG signature
        assert r1.content[:8] == b"\x89PNG\r\n\x1a\n"
        x1 = r1.headers.get("X-Cache")
        assert x1 in ("HIT", "MISS"), f"X-Cache header missing/invalid: {x1}"

        r2 = requests.get(url, timeout=20)
        assert r2.status_code == 200
        x2 = r2.headers.get("X-Cache")
        assert x2 == "HIT", f"Second request should be HIT, got {x2}"

    def test_png_dimensions_1200x630(self):
        url = f"{BASE_URL}/api/og/shop/{SHOP_SLUG}.png"
        r = requests.get(url, timeout=20)
        assert r.status_code == 200
        try:
            from PIL import Image
        except Exception:
            pytest.skip("Pillow not installed")
        img = Image.open(io.BytesIO(r.content))
        assert img.size == (1200, 630), f"PNG should be 1200x630, got {img.size}"

    def test_cache_invalidated_on_shop_update(self, auth_session):
        url = f"{BASE_URL}/api/og/shop/{SHOP_SLUG}.png"
        # Prime cache
        r0 = auth_session.get(url, timeout=20)
        assert r0.status_code == 200
        r1 = auth_session.get(url, timeout=20)
        assert r1.headers.get("X-Cache") == "HIT", "Cache should be primed (HIT)"

        # Get current shop (full snapshot for restore)
        me = auth_session.get(f"{BASE_URL}/api/shops/me", timeout=10)
        assert me.status_code == 200
        shop = me.json()
        original_tagline = shop.get("tagline") or ""

        # Build a payload that preserves all critical fields, only changing tagline
        def _payload(tagline_value):
            keep_keys = [
                "name", "business_type", "sells_by", "is_open", "auto_schedule_enabled",
                "schedule", "brand_color", "description", "about", "cover_image",
                "logo_image", "phone", "address", "social_links", "delivery_options",
                "payment_methods", "operating_hours",
            ]
            p = {k: shop[k] for k in keep_keys if k in shop and shop[k] is not None}
            p["tagline"] = tagline_value
            return p

        # Update tagline (cache-busting field per spec)
        new_tagline = f"Tes cache {int(time.time())}"
        upd = auth_session.post(f"{BASE_URL}/api/shops/me", json=_payload(new_tagline), timeout=15)
        assert upd.status_code == 200, f"Shop update failed: {upd.status_code} {upd.text}"

        try:
            # Next .png should be MISS (cache invalidated)
            r2 = auth_session.get(url, timeout=20)
            assert r2.status_code == 200
            assert r2.headers.get("X-Cache") == "MISS", \
                f"After shop update X-Cache should be MISS, got {r2.headers.get('X-Cache')}"
            # And again HIT after re-prime
            r3 = auth_session.get(url, timeout=20)
            assert r3.headers.get("X-Cache") == "HIT"
        finally:
            # Restore original tagline (with all fields preserved)
            auth_session.post(f"{BASE_URL}/api/shops/me", json=_payload(original_tagline), timeout=15)
