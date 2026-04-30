"""
Tests for daily tips + AI rule-based selector + endpoint.
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


def _login():
    """Use Bu Sari demo user for live integration test."""
    r = httpx.post(f"{API}/auth/login", json={"email": "sari@warung.id", "password": "sari12345"}, timeout=10)
    if r.status_code != 200:
        pytest.skip("Bu Sari demo user not available")
    return r.json()["access_token"]


def _register_new_user():
    """Register fresh user without shop."""
    email = f"tip_test_{uuid.uuid4().hex[:8]}@example.com"
    httpx.post(f"{API}/auth/register",
               json={"email": email, "password": "testpass12", "name": "Tip Test"}, timeout=10)
    r = httpx.post(f"{API}/auth/login", json={"email": email, "password": "testpass12"}, timeout=10)
    return email, r.json()["access_token"]


# ---- Endpoint tests ----
def test_tips_today_requires_auth():
    r = httpx.get(f"{API}/tips/today", timeout=10)
    assert r.status_code == 401


def test_tips_today_no_shop():
    _, token = _register_new_user()
    r = httpx.get(f"{API}/tips/today", headers={"Authorization": f"Bearer {token}"}, timeout=10)
    assert r.status_code == 400
    assert "Belum punya toko" in r.text


def test_tips_today_returns_tip_for_shop():
    token = _login()
    r = httpx.get(f"{API}/tips/today", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["title"]
    assert data["body"]
    assert data["emoji"]
    assert data["source"] in ("rule", "ai", "ai_refresh", "fallback")
    assert data["date"]
    assert data["shop_id"]
    # Idempotent: second call returns same tip
    r2 = httpx.get(f"{API}/tips/today", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert r2.status_code == 200
    assert r2.json()["tip_id"] == data["tip_id"]


# ---- Rule unit tests ----
def test_rule_no_products():
    from routes.tips import _rule_no_products
    s = {"products_count": 0}
    tip = _rule_no_products(s)
    assert tip is not None
    assert tip["rule_key"] == "no_products"
    assert "AI Studio" in tip.get("cta_label", "")


def test_rule_no_products_skipped_when_has_products():
    from routes.tips import _rule_no_products
    assert _rule_no_products({"products_count": 5}) is None


def test_rule_traffic_drop():
    from routes.tips import _rule_traffic_drop
    s = {"visits_7d": 3, "visits_prev_7d": 20}
    tip = _rule_traffic_drop(s)
    assert tip is not None
    assert "turun" in tip["title"]


def test_rule_traffic_growing():
    from routes.tips import _rule_traffic_growing
    s = {"visits_7d": 30, "visits_prev_7d": 10}
    tip = _rule_traffic_growing(s)
    assert tip is not None
    assert "naik" in tip["title"]
