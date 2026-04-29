"""Email service wrapper for Resend. Runs in no-op-logging mode when
`RESEND_API_KEY` is empty, so local dev + CI keeps working without keys."""
import os
import asyncio
import logging
from typing import Optional

import resend

logger = logging.getLogger("lapakin")

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "noreply@lapakin.my.id")
SENDER_NAME = os.environ.get("SENDER_NAME", "Lapakin")

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY


def is_configured() -> bool:
    return bool(RESEND_API_KEY and SENDER_EMAIL)


async def send_email(
    to: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> Optional[str]:
    """Send transactional email. Returns Resend email_id on success, None on
    failure or when not configured (no-op logging mode). Never raises."""
    if not is_configured():
        logger.info("[EMAIL-NOOP→%s] subject=%r (RESEND_API_KEY not set)", to, subject)
        return None
    params = {
        "from": f"{SENDER_NAME} <{SENDER_EMAIL}>",
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if text:
        params["text"] = text
    if reply_to:
        params["reply_to"] = reply_to
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        email_id = (result or {}).get("id")
        logger.info("[EMAIL→%s] id=%s subject=%r", to, email_id, subject)
        return email_id
    except Exception as e:
        logger.warning("[EMAIL-FAIL→%s] subject=%r err=%s", to, subject, str(e)[:200])
        return None
