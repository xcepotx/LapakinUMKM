"""Unified LLM client with provider fallback.

Selection priority (first non-empty key wins):
  1) GEMINI_API_KEY  → Google Gemini direct (production-recommended)
  2) OPENAI_API_KEY  → OpenAI direct
  3) EMERGENT_LLM_KEY → Emergent Universal Key (works only inside Emergent platform)

This abstraction lets us deploy on user's own VPS without depending on Emergent's
free-tier external-access restriction. It uses the official SDKs (no proxy) so
quota/billing is on the user's own provider account.
"""
from __future__ import annotations

import os
from typing import Optional

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "").strip()


def active_provider() -> str:
    """Return name of the LLM provider that will be used."""
    if GEMINI_API_KEY:
        return "gemini"
    if OPENAI_API_KEY:
        return "openai"
    if EMERGENT_LLM_KEY:
        return "emergent"
    return "none"


async def chat_text(
    system: str,
    user: str,
    *,
    model_hint: str = "gemini-2.5-flash",
    session_id: Optional[str] = None,
) -> str:
    """Send a chat completion and return the raw text response.
    Throws RuntimeError if no provider configured.
    Throws on upstream API errors.
    """
    provider = active_provider()
    if provider == "none":
        raise RuntimeError(
            "Tidak ada API key LLM yang tersedia. "
            "Set GEMINI_API_KEY, OPENAI_API_KEY, atau EMERGENT_LLM_KEY di .env"
        )

    if provider == "gemini":
        return await _chat_gemini(system, user, model_hint)

    if provider == "openai":
        return await _chat_openai(system, user, model_hint)

    # Emergent path — works inside preview only
    return await _chat_emergent(system, user, model_hint, session_id)


async def _chat_gemini(system: str, user: str, model_hint: str) -> str:
    """Direct Google Gemini API call. Free tier: 15 req/min."""
    from google import genai
    from google.genai import types as genai_types

    client = genai.Client(api_key=GEMINI_API_KEY)
    # Map our model hints
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
    # Map model hint
    model = "gpt-4o-mini" if "flash" in model_hint or "mini" in model_hint else "gpt-4o"
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
