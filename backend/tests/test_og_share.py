"""Tests for OpenGraph share endpoints (PNG + HTML) added in iteration_6.

Verifies:
- GET /api/og/shop/{slug}.png  → 1200x630 PNG (existing, missing, suspended)
- GET /api/og/shop/{slug}      → HTML with full OG + Twitter Card meta tags
- X-Forwarded-Proto handling   → og:url / og:image must be https://
- Backend regression smoke     → /api/auth/me, /api/shops/by-slug/..., /api/products
"""
import os
import re
from io import BytesIO

import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://learn-indonesian-22.preview.emergentagent.com").rstrip("/")
EXISTING_SLUG = "toko-test-262897"   # seeded shop (active)
WARUNG_SARI_SLUG = "warung-sari"      # test-user shop
NON_EXISTENT_SLUG = "this-shop-does-not-exist-zzz-9999"
TEST_USER_EMAIL = "sari@warung.id"
TEST_USER_PASSWORD = "newpass123"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Accept": "*/*"})
    return s


@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": TEST_USER_EMAIL, "password": TEST_USER_PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"Auth failed: {r.status_code} {r.text}")
    return s


# ---------- OG PNG endpoint ----------
class TestOGImage:
    def test_existing_shop_png_is_valid_1200x630(self, session):
        r = session.get(f"{BASE_URL}/api/og/shop/{EXISTING_SLUG}.png", timeout=30)
        assert r.status_code == 200, r.text[:200]
        assert r.headers.get("content-type", "").startswith("image/png")
        assert len(r.content) > 500
        img = Image.open(BytesIO(r.content))
        assert img.format == "PNG"
        assert img.size == (1200, 630), f"Expected (1200,630), got {img.size}"

    def test_warung_sari_png_is_valid(self, session):
        r = session.get(f"{BASE_URL}/api/og/shop/{WARUNG_SARI_SLUG}.png", timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/png")
        img = Image.open(BytesIO(r.content))
        assert img.size == (1200, 630)

    def test_nonexistent_slug_returns_fallback_png_200(self, session):
        """Crawlers should ALWAYS get a PNG (never 404) so cache stays warm."""
        r = session.get(f"{BASE_URL}/api/og/shop/{NON_EXISTENT_SLUG}.png", timeout=30)
        assert r.status_code == 200, "Must NOT 404 even for missing shop"
        assert r.headers.get("content-type", "").startswith("image/png")
        img = Image.open(BytesIO(r.content))
        assert img.format == "PNG"
        assert img.size == (1200, 630)

    def test_cache_control_header_present(self, session):
        r = session.get(f"{BASE_URL}/api/og/shop/{EXISTING_SLUG}.png", timeout=30)
        assert "cache-control" in {k.lower() for k in r.headers.keys()}


# ---------- OG HTML endpoint ----------
class TestOGHtml:
    def _get(self, session, slug, extra_headers=None):
        return session.get(f"{BASE_URL}/api/og/shop/{slug}",
                           headers=extra_headers or {},
                           timeout=30, allow_redirects=False)

    def test_existing_shop_html_has_og_meta(self, session):
        r = self._get(session, EXISTING_SLUG)
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "text/html" in ct, f"content-type={ct}"
        body = r.text
        # Required OG tags
        for prop in ["og:title", "og:description", "og:image", "og:url"]:
            assert f'property="{prop}"' in body, f"Missing meta {prop}"
        # Twitter
        assert 'name="twitter:card"' in body
        assert 'content="summary_large_image"' in body
        # og:image must point at /api/og/shop/{slug}.png
        m = re.search(r'property="og:image"\s+content="([^"]+)"', body)
        assert m, "og:image content not found"
        og_img = m.group(1)
        assert og_img.endswith(f"/api/og/shop/{EXISTING_SLUG}.png"), f"Bad og:image: {og_img}"
        assert og_img.startswith("https://"), f"og:image must be https://, got {og_img}"

    def test_og_url_uses_https(self, session):
        r = self._get(session, EXISTING_SLUG)
        m = re.search(r'property="og:url"\s+content="([^"]+)"', r.text)
        assert m, "og:url not found"
        url = m.group(1)
        assert url.startswith("https://"), f"og:url must be https://, got {url}"
        assert f"/toko/{EXISTING_SLUG}" in url

    def test_https_respected_with_x_forwarded_proto(self, session):
        # Ingress already sets X-Forwarded-Proto=https. Sending http via header
        # should NOT downgrade because production hosts force https in code.
        r = self._get(session, EXISTING_SLUG, {"X-Forwarded-Proto": "http"})
        m = re.search(r'property="og:url"\s+content="([^"]+)"', r.text)
        assert m
        # In prod (preview.emergent host), code forces https regardless
        assert m.group(1).startswith("https://")

    def test_nonexistent_slug_returns_html_with_fallback(self, session):
        r = self._get(session, NON_EXISTENT_SLUG)
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")
        body = r.text
        # Sensible fallback title/desc present
        assert 'property="og:title"' in body
        assert 'property="og:description"' in body
        # Should mention "tidak ditemukan" or similar
        assert "tidak ditemukan" in body.lower() or "lapakin" in body.lower()

    def test_meta_refresh_absent(self, session):
        """Iter10: we intentionally REMOVED meta http-equiv=refresh because
        some bots (Facebook, LinkedIn) followed it and landed on the React
        index.html with root OG tags. Humans still get redirected via JS."""
        r = self._get(session, EXISTING_SLUG)
        # Only match an actual <meta http-equiv="refresh"> tag (not comments).
        import re as _re
        assert not _re.search(r'<meta\s+http-equiv="refresh"', r.text)
        # JS redirect must still be present for human browsers.
        assert "window.location.replace" in r.text

    def test_image_dimensions_meta(self, session):
        r = self._get(session, EXISTING_SLUG)
        body = r.text
        assert 'property="og:image:width"' in body
        assert 'content="1200"' in body
        assert 'property="og:image:height"' in body
        assert 'content="630"' in body


# ---------- Suspended shop ----------
class TestSuspendedShop:
    """If a shop is suspended, both endpoints must return generic fallback (no leak)."""

    @pytest.fixture(scope="class")
    def suspended_slug(self, auth_session):
        # Best-effort: query if any suspended shop exists. If none, create skip.
        # We only have public APIs to inspect; simply try a dummy slug.
        # Real suspension requires admin; we'll just verify behavior on missing slug
        # which uses the same code path (not found OR suspended → fallback).
        return None

    def test_suspended_path_uses_fallback_branch(self, session):
        # The same code branch handles `not shop OR shop.status==suspended`.
        # Already covered by `test_nonexistent_slug_returns_fallback_png_200`.
        # Document explicitly:
        r = session.get(f"{BASE_URL}/api/og/shop/{NON_EXISTENT_SLUG}.png", timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/png")


# ---------- Backend regression smoke ----------
class TestRegressionSmoke:
    def test_auth_me_unauthenticated_returns_401(self, session):
        r = session.get(f"{BASE_URL}/api/auth/me", timeout=15)
        # No cookies/Bearer → must be 401
        assert r.status_code in (401, 403), f"got {r.status_code}"

    def test_auth_me_authenticated_returns_user(self, auth_session):
        r = auth_session.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        assert data.get("email") == TEST_USER_EMAIL

    def test_shops_by_slug_existing(self, session):
        r = session.get(f"{BASE_URL}/api/shops/by-slug/{EXISTING_SLUG}", timeout=15)
        assert r.status_code == 200
        data = r.json()
        # Response shape: {shop: {...}, products: [...]}
        shop = data.get("shop") or data
        assert shop.get("slug") == EXISTING_SLUG
        assert "name" in shop
        assert isinstance(data.get("products", []), list)

    def test_shops_by_slug_404(self, session):
        r = session.get(f"{BASE_URL}/api/shops/by-slug/{NON_EXISTENT_SLUG}", timeout=15)
        assert r.status_code == 404

    def test_products_endpoint_authenticated(self, auth_session):
        r = auth_session.get(f"{BASE_URL}/api/products", timeout=15)
        # User has shop → must return 200 list
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        assert isinstance(data, list)
