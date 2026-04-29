"""Tests for Iteration 14 — Resend email service integration.
Since RESEND_API_KEY is empty by default, all sends go through no-op logging
mode. These tests verify:
  1. Register + forgot-password still work when email is in no-op mode.
  2. Simple-mode fallback returns reset_token only when RESEND not configured.
  3. Email templates render without raising.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.timeout = 20
    return s


class TestEmailNoopMode:
    """RESEND_API_KEY is empty in dev → simple-mode fallback should kick in."""

    def test_register_and_forgot_flow(self, session):
        suffix = uuid.uuid4().hex[:6]
        email = f"iter14_{suffix}@example.com"
        r = session.post(
            f"{API}/auth/register",
            json={"email": email, "password": "secret12", "name": "Iter14 User"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        # Welcome email fired but we can't verify inbox — just ensure register succeeded.
        assert r.json()["email"] == email

        # Forgot password should return simple_mode=True with reset_token (no Resend).
        r2 = session.post(f"{API}/auth/forgot-password", json={"email": email}, timeout=20)
        assert r2.status_code == 200
        d = r2.json()
        assert d.get("ok") is True
        assert d.get("simple_mode") is True
        assert isinstance(d.get("reset_token"), str) and len(d["reset_token"]) > 10
        # reset_link should contain PUBLIC_APP_URL + token
        assert d.get("reset_link", "").endswith(f"token={d['reset_token']}")

    def test_forgot_unknown_email_privacy(self, session):
        r = session.post(
            f"{API}/auth/forgot-password",
            json={"email": f"does-not-exist-{uuid.uuid4().hex[:6]}@example.com"},
            timeout=20,
        )
        assert r.status_code == 200
        d = r.json()
        assert d.get("ok") is True
        # Privacy: no token/link for unknown emails
        assert "reset_token" not in d
        assert "reset_link" not in d


class TestTemplatesRenderCleanly:
    """Templates must produce (subject, html, text) without raising."""

    def test_all_templates(self):
        from email_templates import (
            password_reset, welcome, trial_expiring, product_created_via_wa,
        )
        for fn, args in [
            (password_reset, ("Budi", "https://lapakin.my.id/reset-password?token=abc")),
            (welcome, ("Sari",)),
            (trial_expiring, ("Andi", 2)),
            (product_created_via_wa, ("Rina", "Kopi Susu Aren", 25000, 20, "warung-sari")),
        ]:
            subj, html, text = fn(*args)
            assert isinstance(subj, str) and len(subj) > 5
            assert isinstance(html, str) and "<!doctype html>" in html.lower()
            assert "Lapakin" in html
            assert isinstance(text, str) and len(text) > 20
