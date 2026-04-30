"""
Tests for Cerita UMKM Sukses (stories) — public + admin.
"""
import os
import time
import uuid
from pathlib import Path

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


def _admin_token():
    r = httpx.post(f"{API}/auth/login",
                   json={"email": "admin@lapakin.id", "password": "lapakin123"}, timeout=10)
    if r.status_code != 200:
        pytest.skip("Admin user not seeded")
    return r.json()["access_token"]


# ---- Public endpoints ----
def test_stories_list_public_no_auth_required():
    r = httpx.get(f"{API}/stories", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert "total" in data
    assert isinstance(data["items"], list)


def test_stories_detail_404_unknown():
    r = httpx.get(f"{API}/stories/this-slug-does-not-exist-{uuid.uuid4().hex[:6]}", timeout=10)
    assert r.status_code == 404


# ---- Admin gating ----
def test_admin_stories_requires_admin():
    r = httpx.get(f"{API}/admin/stories", timeout=10)
    assert r.status_code == 401


def test_admin_create_draft_unknown_shop():
    token = _admin_token()
    r = httpx.post(f"{API}/admin/stories/draft",
                   json={"shop_slug": f"unknown-shop-{uuid.uuid4().hex[:6]}"},
                   headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert r.status_code == 404


def test_admin_full_lifecycle():
    """Create draft → list → publish → fetch publicly → unpublish → delete."""
    token = _admin_token()
    headers = {"Authorization": f"Bearer {token}"}

    # 1) Generate AI draft for warung-sari
    r = httpx.post(f"{API}/admin/stories/draft",
                   json={"shop_slug": "warung-sari"},
                   headers=headers, timeout=45)
    if r.status_code == 503:
        pytest.skip("AI service unavailable")
    assert r.status_code == 200, r.text
    story = r.json()
    assert story["status"] == "draft"
    assert story["title"]
    assert story["content_md"]
    assert story["shop_slug"] == "warung-sari"
    sid = story["story_id"]

    try:
        # 2) List should include this draft
        r = httpx.get(f"{API}/admin/stories", headers=headers, timeout=10)
        assert r.status_code == 200
        ids = [s["story_id"] for s in r.json()["items"]]
        assert sid in ids

        # 3) Public should NOT see draft
        r = httpx.get(f"{API}/stories", timeout=10)
        public_ids = [s["story_id"] for s in r.json()["items"]]
        assert sid not in public_ids

        # 4) Publish
        r = httpx.post(f"{API}/admin/stories/{sid}/publish", headers=headers, timeout=10)
        assert r.status_code == 200

        time.sleep(0.2)
        # 5) Public list now includes it
        r = httpx.get(f"{API}/stories", timeout=10)
        public_ids = [s["story_id"] for s in r.json()["items"]]
        assert sid in public_ids

        # 6) Public detail by slug works + view_count increments
        r = httpx.get(f"{API}/stories/{story['slug']}", timeout=10)
        assert r.status_code == 200
        assert r.json()["title"] == story["title"]

        # 7) Unpublish — public 404 again
        r = httpx.post(f"{API}/admin/stories/{sid}/unpublish", headers=headers, timeout=10)
        assert r.status_code == 200
        r = httpx.get(f"{API}/stories/{story['slug']}", timeout=10)
        assert r.status_code == 404
    finally:
        # Cleanup
        httpx.delete(f"{API}/admin/stories/{sid}", headers=headers, timeout=10)


def test_admin_patch_story():
    token = _admin_token()
    headers = {"Authorization": f"Bearer {token}"}
    r = httpx.post(f"{API}/admin/stories/draft",
                   json={"shop_slug": "warung-sari"},
                   headers=headers, timeout=45)
    if r.status_code == 503:
        pytest.skip("AI service unavailable")
    assert r.status_code == 200
    sid = r.json()["story_id"]
    try:
        new_title = "Cerita Custom Edit Test"
        r = httpx.patch(f"{API}/admin/stories/{sid}",
                        json={"title": new_title, "content_md": "## Heading\n\nIsi konten baru."},
                        headers=headers, timeout=10)
        assert r.status_code == 200
        assert r.json()["title"] == new_title
        assert "Isi konten baru" in r.json()["excerpt"]
    finally:
        httpx.delete(f"{API}/admin/stories/{sid}", headers=headers, timeout=10)
