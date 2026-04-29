"""Iteration 9 — verify OG share-URL behaviour (HTML still serves crawler meta + meta-refresh + JS redirect)."""
import os
import re
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
SLUG = "warung-sari"


def test_og_html_contains_og_meta_tags():
    r = requests.get(f"{BASE_URL}/api/og/shop/{SLUG}", allow_redirects=False, timeout=15)
    assert r.status_code == 200, f"expected 200, got {r.status_code}"
    html = r.text
    # Required OG / Twitter tags
    assert 'property="og:image"' in html
    assert 'property="og:title"' in html
    assert 'property="og:description"' in html
    assert 'property="og:url"' in html
    assert 'name="twitter:card"' in html


def test_og_html_canonical_url_is_storefront_not_api():
    r = requests.get(f"{BASE_URL}/api/og/shop/{SLUG}", allow_redirects=False, timeout=15)
    html = r.text
    # og:url MUST point to /toko/<slug>, NOT /api/og/shop/<slug>
    m = re.search(r'property="og:url"\s+content="([^"]+)"', html)
    assert m is not None, "og:url meta missing"
    canonical = m.group(1)
    assert canonical.endswith(f"/toko/{SLUG}"), f"canonical should end with /toko/{SLUG}, got {canonical}"
    assert "/api/og/shop/" not in canonical, f"canonical must not be the OG endpoint URL: {canonical}"


def test_og_html_has_meta_refresh_redirect():
    """Iteration 10: meta http-equiv=refresh was REMOVED because FB/LinkedIn bots
    were following it and ending up at React index.html. The JS redirect (next test)
    handles human browsers; bots stay on the OG endpoint and read the correct tags."""
    r = requests.get(f"{BASE_URL}/api/og/shop/{SLUG}", allow_redirects=False, timeout=15)
    html_no_comments = re.sub(r"<!--.*?-->", "", r.text, flags=re.DOTALL)
    assert not re.search(r'<meta[^>]+http-equiv\s*=\s*"refresh"', html_no_comments), \
        "iter10: meta http-equiv=refresh must be removed (FB bot followed it)"


def test_og_html_has_js_redirect():
    r = requests.get(f"{BASE_URL}/api/og/shop/{SLUG}", allow_redirects=False, timeout=15)
    html = r.text
    assert "window.location.replace" in html, "JS redirect required as fallback"
    # storefront URL should appear inside the script
    assert f"/toko/{SLUG}" in html


def test_og_html_image_url_points_to_png_endpoint():
    r = requests.get(f"{BASE_URL}/api/og/shop/{SLUG}", allow_redirects=False, timeout=15)
    html = r.text
    m = re.search(r'property="og:image"\s+content="([^"]+)"', html)
    assert m is not None
    assert m.group(1).endswith(f"/api/og/shop/{SLUG}.png")


def test_og_png_still_serves_image():
    r = requests.get(f"{BASE_URL}/api/og/shop/{SLUG}.png", timeout=20)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("image/")


def test_product_story_png_exists_for_share_button():
    """The WA share button fetches /api/og/product/{id}/story.png — verify endpoint serves a PNG."""
    # find a product id in warung-sari
    s = requests.get(f"{BASE_URL}/api/shops/by-slug/{SLUG}", timeout=15)
    assert s.status_code == 200
    products = s.json().get("products", [])
    assert products, "warung-sari should have products for this test"
    pid = products[0]["product_id"]
    r = requests.get(f"{BASE_URL}/api/og/product/{pid}/story.png", timeout=30)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("image/")
    assert int(r.headers.get("content-length", "0")) > 1000
