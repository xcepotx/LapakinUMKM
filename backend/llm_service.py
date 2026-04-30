"""Unified LLM client with provider fallback chain.

Provider order (priority):
  1) GEMINI_API_KEY  → Google Gemini direct (production-recommended, free tier)
  2) OPENAI_API_KEY  → OpenAI direct
  3) EMERGENT_LLM_KEY → Emergent Universal Key (works only inside Emergent platform)

Fallback behavior:
  - If a provider returns transient error (429 quota, 5xx upstream, network),
    automatically try the next provider in chain
  - If a provider returns non-transient error (401 auth, 400 bad request),
    log and also fallback (provider might be misconfigured)
  - All providers exhausted → raise last exception so caller can handle

Configure via `.env`:
    GEMINI_API_KEY=AIza...
    OPENAI_API_KEY=sk-...
    EMERGENT_LLM_KEY=sk-emergent-...

Users just set ANY ONE key. Adding multiple keys enables automatic failover.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger("lapakin.llm")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "").strip()


def _providers_in_order() -> list:
    """Return list of available providers in priority order."""
    out = []
    if GEMINI_API_KEY:
        out.append("gemini")
    if OPENAI_API_KEY:
        out.append("openai")
    if EMERGENT_LLM_KEY:
        out.append("emergent")
    return out


def active_provider() -> str:
    """Return name of the primary LLM provider (first in chain)."""
    chain = _providers_in_order()
    return chain[0] if chain else "none"


def available_providers() -> list:
    """Public helper — returns ordered list of providers usable right now."""
    return _providers_in_order()


async def chat_text(
    system: str,
    user: str,
    *,
    model_hint: str = "gemini-2.5-flash",
    session_id: Optional[str] = None,
) -> str:
    """Send a chat completion and return the raw text response.

    Tries providers in priority order. Falls back to next on any failure.
    Raises RuntimeError if no provider configured or all failed.
    """
    chain = _providers_in_order()
    if not chain:
        raise RuntimeError(
            "Tidak ada API key LLM yang tersedia. "
            "Set GEMINI_API_KEY, OPENAI_API_KEY, atau EMERGENT_LLM_KEY di .env"
        )

    last_err: Optional[Exception] = None
    for idx, provider in enumerate(chain):
        try:
            if provider == "gemini":
                text = await _chat_gemini(system, user, model_hint)
            elif provider == "openai":
                text = await _chat_openai(system, user, model_hint)
            elif provider == "emergent":
                text = await _chat_emergent(system, user, model_hint, session_id)
            else:
                continue
            if idx > 0:
                logger.info(
                    f"llm.chat_text — fell back to '{provider}' "
                    f"after '{chain[0]}' failed (attempt #{idx + 1})"
                )
            return text
        except Exception as e:
            last_err = e
            msg = str(e)[:200]
            logger.warning(
                f"llm.chat_text — provider '{provider}' failed: {msg}. "
                f"{'Trying next…' if idx < len(chain) - 1 else 'No more providers.'}"
            )
            continue

    # All providers exhausted
    assert last_err is not None
    raise RuntimeError(
        f"Semua provider LLM gagal. Terakhir: {type(last_err).__name__}: {last_err}"
    )


# ---------------- Provider implementations ----------------
async def _chat_gemini(system: str, user: str, model_hint: str) -> str:
    """Direct Google Gemini API call. Free tier: 15 req/min."""
    from google import genai
    from google.genai import types as genai_types

    client = genai.Client(api_key=GEMINI_API_KEY)
    model = "gemini-2.5-flash"
    if "pro" in model_hint.lower():
        model = "gemini-2.5-pro"
    response = client.models.generate_content(
        model=model,
        contents=user,
        config=genai_types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="text/plain",
        ),
    )
    return response.text or ""


async def _chat_openai(system: str, user: str, model_hint: str) -> str:
    """Direct OpenAI API call."""
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    model = "gpt-4o-mini" if ("flash" in model_hint or "mini" in model_hint) else "gpt-4o"
    resp = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return (resp.choices[0].message.content or "").strip()


async def _chat_emergent(system: str, user: str, model_hint: str, session_id: Optional[str]) -> str:
    """Emergent Universal Key — works only inside Emergent preview environment."""
    import uuid
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id or f"sess_{uuid.uuid4().hex[:8]}",
        system_message=system,
    )
    if "gemini" in model_hint:
        chat = chat.with_model("gemini", "gemini-2.5-flash")
    else:
        chat = chat.with_model("openai", "gpt-4o-mini")
    return await chat.send_message(UserMessage(text=user))
