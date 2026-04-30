"""
Tests for Content Studio — tier gating + endpoint shape.
"""
import os
import uuid
from pathlib import Path

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


def _register_and_login(tier_force: str | None = None):
    email = f"cs_test_{uuid.uuid4().hex[:8]}@example.com"
    httpx.post(f"{API}/auth/register",
               json={"email": email, "password": "testpass12", "name": "CS Test"}, timeout=10)
    r = httpx.post(f"{API}/auth/login", json={"email": email, "password": "testpass12"}, timeout=10)
    token = r.json()["access_token"]

    if tier_force:
        # Force tier directly in DB
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient

        async def _force():
            c = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = c[os.environ["DB_NAME"]]
            await db.users.update_one(
                {"email": email},
                {"$set": {"tier": tier_force, "trial": False, "trial_expires_at": None}},
            )
        asyncio.run(_force())
    return email, token


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_quota_requires_auth():
    r = httpx.get(f"{API}/content-studio/quota", timeout=10)
    assert r.status_code == 401


def test_styles_listing():
    _, token = _register_and_login()
    r = httpx.get(f"{API}/content-studio/styles", headers=_h(token), timeout=10)
    assert r.status_code == 200
    keys = [s["key"] for s in r.json()["styles"]]
    assert set(keys) == {"minimal", "hangat", "bold"}


def test_free_tier_blocked():
    _, token = _register_and_login(tier_force="free")
    r = httpx.get(f"{API}/content-studio/quota", headers=_h(token), timeout=10)
    assert r.status_code == 402
    assert "Pro" in r.text or "Bisnis" in r.text


def test_pro_tier_quota_starts_full():
    _, token = _register_and_login(tier_force="pro")
    r = httpx.get(f"{API}/content-studio/quota", headers=_h(token), timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data["tier"] == "pro"
    assert data["limit"] == 10
    assert data["used"] == 0
    assert data["remaining"] == 10


def test_business_tier_unlimited():
    _, token = _register_and_login(tier_force="business")
    r = httpx.get(f"{API}/content-studio/quota", headers=_h(token), timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data["tier"] == "business"
    # Unlimited represented as -1
    assert data["limit"] == -1
    assert data["remaining"] == -1


def test_generate_validates_inputs():
    _, token = _register_and_login(tier_force="pro")
    # No products
    r = httpx.post(f"{API}/content-studio/generate",
                   headers=_h(token),
                   json={"product_ids": [], "style": "hangat"}, timeout=10)
    assert r.status_code == 400

    # Invalid style
    r = httpx.post(f"{API}/content-studio/generate",
                   headers=_h(token),
                   json={"product_ids": ["x"], "style": "neon"}, timeout=10)
    assert r.status_code == 400

    # No shop yet
    r = httpx.post(f"{API}/content-studio/generate",
                   headers=_h(token),
                   json={"product_ids": ["x"], "style": "hangat"}, timeout=10)
    assert r.status_code == 400


def test_render_module_smoke():
    """Smoke: render module produces 3 valid styles + sample carousel offline."""
    import asyncio
    from content_studio_render import STYLES, render_carousel

    assert set(STYLES.keys()) == {"minimal", "hangat", "bold"}
    shop = {
        "name": "Demo Shop",
        "slug": "demo",
        "tagline": "Tag tag",
        "whatsapp": "+62811",
        "cover_image": None,
    }
    products = [
        {"product_id": "p1", "name": "Item A", "price": 25000, "description": "Mantap", "images": []},
        {"product_id": "p2", "name": "Item B", "price": 35000, "description": "Enak", "images": []},
    ]

    slides = asyncio.run(render_carousel(shop, products, style_name="bold"))
    # Cover + N products + CTA
    assert len(slides) == 4
    for s in slides:
        assert s["filename"].endswith(".png")
        assert s["content_type"] == "image/png"
        assert len(s["png_b64"]) > 1000  # non-trivial PNG payload
