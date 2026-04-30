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
    """When RESEND_API_KEY is empty → simple-mode fallback.
    When RESEND_API_KEY is set → email dispatched (no token in response).
    Tests adapt to whichever mode is active."""

    def test_register_and_forgot_flow(self, session):
        suffix = uuid.uuid4().hex[:6]
        email = f"iter14_{suffix}@example.com"
        r = session.post(
            f"{API}/auth/register",
            json={"email": email, "password": "secret12", "name": "Iter14 User"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["email"] == email

        # Forgot password should always 200.
        r2 = session.post(f"{API}/auth/forgot-password", json={"email": email}, timeout=20)
        assert r2.status_code == 200
        d = r2.json()
        assert d.get("ok") is True

        # Detect mode from response shape (test process may not share env with backend).
        if "reset_token" in d:
            # simple-mode: RESEND_API_KEY empty on backend
            assert d.get("simple_mode") is True
            assert isinstance(d["reset_token"], str) and len(d["reset_token"]) > 10
            assert d.get("reset_link", "").endswith(f"token={d['reset_token']}")
        else:
            # email-mode: Resend configured → no token leak, no simple_mode flag
            assert "simple_mode" not in d or d["simple_mode"] is False
            assert "reset_link" not in d

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
            password_reset, welcome, trial_expiring,
            product_created_via_wa, payment_receipt,
        )
        for fn, args in [
            (password_reset, ("Budi", "https://lapakin.my.id/reset-password?token=abc")),
            (welcome, ("Sari",)),
            (trial_expiring, ("Andi", 2)),
            (product_created_via_wa, ("Rina", "Kopi Susu Aren", 25000, 20, "warung-sari")),
            (payment_receipt, (
                "Dimas", "lapakin-pro_monthly-abc123", "Lapakin Pro — 1 Bulan",
                49000, "monthly", "qris",
                "2026-04-29T10:30:00+00:00", "2026-05-29T10:30:00+00:00"
            )),
        ]:
            subj, html, text = fn(*args)
            assert isinstance(subj, str) and len(subj) > 5
            assert isinstance(html, str) and "<!doctype html>" in html.lower()
            assert "Lapakin" in html
            assert isinstance(text, str) and len(text) > 20
