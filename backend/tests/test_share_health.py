"""
Regression test for /api/shops/me/share-health endpoint.
Checks: auth gating, tier-based feature flag, response shape.
"""
import asyncio
import os
import uuid
from pathlib import Path

import httpx
import pytest
from dotenv import load_dotenv

# Load backend .env so MONGO_URL is available for direct DB tweaks
load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


def _unique_email() -> str:
    return f"sh_test_{uuid.uuid4().hex[:8]}@example.com"


@pytest.fixture(scope="module")
def client():
    with httpx.Client(timeout=20.0) as c:
        yield c


def _register_and_login(client, email=None, password="testpass12"):
    email = email or _unique_email()
    client.post(f"{API}/auth/register", json={"email": email, "password": password, "name": "Test User"})
    r = client.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    token = r.json().get("access_token")
    assert token
    return email, token


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_share_health_requires_auth(client):
    r = client.get(f"{API}/shops/me/share-health")
    assert r.status_code == 401


def test_share_health_requires_shop(client):
    _, token = _register_and_login(client)
    r = client.get(f"{API}/shops/me/share-health", headers=_auth_headers(token))
    assert r.status_code == 400
    assert "Belum punya toko" in r.text


def test_share_health_free_tier_shows_upsell(client):
    # New user default = trial pro. Force downgrade to free by expiring trial.
    email, token = _register_and_login(client)
    headers = _auth_headers(token)
    unique = uuid.uuid4().hex[:6]
    name = f"SH Free {unique}"
    r = client.post(
        f"{API}/shops/me",
        headers=headers,
        json={"name": name, "whatsapp": "+6281234567890", "business_type": "umum"},
    )
    assert r.status_code in (200, 201), r.text
    shop = r.json()
    slug = shop["slug"]

    # Force tier=free in DB (trial pro → expired free)
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _force_free():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        await db.users.update_one(
            {"email": email},
            {"$set": {"tier": "free", "trial": False, "trial_expires_at": None}},
        )
    asyncio.run(_force_free())

    r = client.get(f"{API}/shops/me/share-health", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["slug"] == slug
    assert data["tier"] == "free"
    assert data["can_use_subdomain"] is False
    assert "subdomain" in data and data["subdomain"]["host"] == f"{slug}.lapakin.my.id"
    # No DNS resolve attempt on free tier (saves bandwidth)
    assert data["subdomain"]["dns_resolves"] is None
    assert data["apex"]["url"].endswith(f"/toko/{slug}")
    assert data["og_image_url"].endswith(f"/api/og/shop/{slug}.png")


def test_share_health_pro_tier_attempts_dns_check(client):
    """Pro/trial users get DNS + HTTP reachability probe."""
    # New users default = trial pro (14 days) → can_use_subdomain = True
    _, token = _register_and_login(client)
    headers = _auth_headers(token)
    name = f"SH Pro {uuid.uuid4().hex[:6]}"
    r = client.post(
        f"{API}/shops/me",
        headers=headers,
        json={"name": name, "whatsapp": "+6281234567890", "business_type": "umum"},
    )
    assert r.status_code in (200, 201), r.text

    r = client.get(f"{API}/shops/me/share-health", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["can_use_subdomain"] is True
    # DNS check attempted (True if prod wildcard set, False if not) — never None for Pro
    assert data["subdomain"]["dns_resolves"] in (True, False)
