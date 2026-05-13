"""Error Center service utilities for Lapakin.

LAPAKIN_ERROR_CENTER_PHASE1_BACKEND_V1

Tujuan:
- Simpan error backend/frontend ke MongoDB collection `error_logs`
- Deduplicate berdasarkan fingerprint
- Redact data sensitif
- Jangan pernah membuat request gagal hanya karena logging gagal
"""
from __future__ import annotations

import hashlib
import os
import re
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import Request


SENSITIVE_KEYS = {
    "password",
    "password_hash",
    "token",
    "access_token",
    "refresh_token",
    "authorization",
    "cookie",
    "set-cookie",
    "api_key",
    "apikey",
    "secret",
    "client_secret",
    "signature",
    "credential",
    "card",
    "cvv",
}


def error_center_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def error_center_environment() -> str:
    return (
        os.getenv("APP_ENV")
        or os.getenv("ENVIRONMENT")
        or os.getenv("NODE_ENV")
        or os.getenv("LAPAKIN_ENV")
        or "unknown"
    )


def error_center_clean_text(value: Any, limit: int = 1200) -> str:
    text = str(value or "")
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def error_center_redact(value: Any, depth: int = 0) -> Any:
    if depth > 5:
        return "[max-depth]"

    if isinstance(value, dict):
        out = {}
        for key, val in value.items():
            key_s = str(key)
            key_l = key_s.lower()
            if any(secret in key_l for secret in SENSITIVE_KEYS):
                out[key_s] = "[redacted]"
            else:
                out[key_s] = error_center_redact(val, depth + 1)
        return out

    if isinstance(value, list):
        return [error_center_redact(item, depth + 1) for item in value[:50]]

    if isinstance(value, str):
        if len(value) > 2000:
            return value[:2000] + "…"
        return value

    return value


def error_center_feature_from_path(path: str) -> str:
    path = str(path or "")

    rules = [
        ("/content-studio", "content_studio"),
        ("/admin", "admin"),
        ("/shops", "shops"),
        ("/products", "products"),
        ("/payment", "payment"),
        ("/analytics", "analytics"),
        ("/storefront", "storefront"),
        ("/og", "og"),
        ("/bot", "ai_bot"),
        ("/auth", "auth"),
        ("/sales", "sales"),
    ]

    for needle, feature in rules:
        if needle in path:
            return feature

    return "general"


def error_center_stack_excerpt(stack: str, limit: int = 5000) -> str:
    stack = str(stack or "")
    if len(stack) <= limit:
        return stack
    return stack[-limit:]


def error_center_fingerprint(source: str, severity: str, path: str, message: str, stack: str = "") -> str:
    first_stack_line = ""
    for line in str(stack or "").splitlines():
        line = line.strip()
        if line and "/site-packages/" not in line:
            first_stack_line = line
            break

    raw = "|".join([
        str(source or ""),
        str(severity or ""),
        str(path or ""),
        error_center_clean_text(message, 220),
        error_center_clean_text(first_stack_line, 220),
    ])

    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()[:32]


async def write_error_log(doc: dict) -> str:
    """Upsert error log safely. Returns error_id if possible."""
    try:
        from deps import db, logger
    except Exception:
        return doc.get("error_id") or ""

    try:
        now = error_center_now_iso()
        doc = dict(doc or {})

        error_id = doc.get("error_id") or f"err_{uuid.uuid4().hex[:16]}"
        doc["error_id"] = error_id
        doc["environment"] = doc.get("environment") or error_center_environment()
        doc["source"] = doc.get("source") or "backend"
        doc["severity"] = doc.get("severity") or "error"
        doc["status"] = doc.get("status") or "open"
        doc["message"] = error_center_clean_text(doc.get("message"), 1200)
        doc["stack"] = error_center_stack_excerpt(doc.get("stack") or "")
        doc["path"] = error_center_clean_text(doc.get("path"), 500)
        doc["method"] = error_center_clean_text(doc.get("method"), 20)
        doc["feature"] = doc.get("feature") or error_center_feature_from_path(doc.get("path"))
        doc["metadata"] = error_center_redact(doc.get("metadata") or {})
        doc["fingerprint"] = doc.get("fingerprint") or error_center_fingerprint(
            doc.get("source"),
            doc.get("severity"),
            doc.get("path"),
            doc.get("message"),
            doc.get("stack"),
        )

        set_on_insert = {
            "error_id": error_id,
            "fingerprint": doc["fingerprint"],
            "source": doc["source"],
            "first_seen": doc.get("created_at") or now,
            "created_at": doc.get("created_at") or now,
            "status": doc["status"],
        }

        set_latest = {
            "last_seen": now,
            "updated_at": now,
            "environment": doc["environment"],
            "severity": doc["severity"],
            "message": doc["message"],
            "stack": doc["stack"],
            "path": doc["path"],
            "method": doc["method"],
            "status_code": doc.get("status_code"),
            "feature": doc["feature"],
            "user_id": doc.get("user_id") or "",
            "shop_id": doc.get("shop_id") or "",
            "slug": doc.get("slug") or "",
            "browser": error_center_clean_text(doc.get("browser"), 400),
            "metadata": doc["metadata"],
        }

        await db.error_logs.update_one(
            {"fingerprint": doc["fingerprint"]},
            {
                "$setOnInsert": set_on_insert,
                "$set": set_latest,
                "$inc": {"count": 1},
            },
            upsert=True,
        )

        saved = await db.error_logs.find_one(
            {"fingerprint": doc["fingerprint"]},
            {"_id": 0, "error_id": 1},
        )

        return (saved or {}).get("error_id") or error_id
    except Exception as exc:
        try:
            logger.exception("error center write failed: %s", exc)
        except Exception:
            pass
        return doc.get("error_id") or ""


def request_public_metadata(request: Request) -> dict:
    try:
        headers = request.headers
        return {
            "query": str(request.url.query or "")[:1000],
            "client_host": getattr(request.client, "host", "") if request.client else "",
            "user_agent": headers.get("user-agent", "")[:500],
            "referer": headers.get("referer", "")[:500],
            "origin": headers.get("origin", "")[:300],
            "x_forwarded_for": headers.get("x-forwarded-for", "")[:300],
        }
    except Exception:
        return {}


async def log_backend_exception(request: Request, exc: Exception) -> str:
    stack = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    message = f"{type(exc).__name__}: {exc}"

    return await write_error_log({
        "source": "backend",
        "severity": "critical",
        "message": message,
        "stack": stack,
        "path": str(request.url.path),
        "method": request.method,
        "status_code": 500,
        "feature": error_center_feature_from_path(str(request.url.path)),
        "metadata": request_public_metadata(request),
    })


async def log_backend_response_error(request: Request, status_code: int) -> str:
    path = str(request.url.path)

    if path.startswith("/api/admin/error-logs") or path.startswith("/api/errors/client"):
        return ""

    return await write_error_log({
        "source": "backend",
        "severity": "error" if int(status_code or 0) < 503 else "critical",
        "message": f"HTTP {status_code} response at {request.method} {path}",
        "stack": "",
        "path": path,
        "method": request.method,
        "status_code": int(status_code or 500),
        "feature": error_center_feature_from_path(path),
        "metadata": request_public_metadata(request),
    })


async def log_client_error(request: Request, payload: dict) -> str:
    payload = payload if isinstance(payload, dict) else {}

    path = error_center_clean_text(payload.get("path") or payload.get("url") or "", 500)
    message = error_center_clean_text(payload.get("message") or payload.get("error") or "Client error", 1200)
    stack = error_center_stack_excerpt(payload.get("stack") or "")
    severity = str(payload.get("severity") or "error").lower()
    if severity not in {"info", "warning", "error", "critical"}:
        severity = "error"

    metadata = {
        "client_payload": error_center_redact(payload.get("metadata") or {}),
        "request": request_public_metadata(request),
        "component": error_center_clean_text(payload.get("component"), 200),
        "release": error_center_clean_text(payload.get("release"), 100),
    }

    return await write_error_log({
        "source": "frontend",
        "severity": severity,
        "message": message,
        "stack": stack,
        "path": path,
        "method": error_center_clean_text(payload.get("method") or "", 20),
        "status_code": payload.get("status_code"),
        "feature": payload.get("feature") or error_center_feature_from_path(path),
        "user_id": payload.get("user_id") or "",
        "shop_id": payload.get("shop_id") or "",
        "slug": payload.get("slug") or "",
        "browser": payload.get("browser") or request.headers.get("user-agent", ""),
        "metadata": metadata,
    })


def public_error_log(doc: dict) -> dict:
    doc = dict(doc or {})
    doc.pop("_id", None)
    return doc
