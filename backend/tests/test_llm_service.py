"""
Tests for llm_service — provider chain detection + fallback logic.
"""
from unittest.mock import AsyncMock, patch

import pytest

import llm_service


def test_no_provider_when_all_empty(monkeypatch):
    monkeypatch.setattr(llm_service, "GEMINI_API_KEY", "")
    monkeypatch.setattr(llm_service, "OPENAI_API_KEY", "")
    monkeypatch.setattr(llm_service, "EMERGENT_LLM_KEY", "")
    assert llm_service.active_provider() == "none"
    assert llm_service.available_providers() == []


def test_gemini_priority(monkeypatch):
    monkeypatch.setattr(llm_service, "GEMINI_API_KEY", "AIza-test")
    monkeypatch.setattr(llm_service, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(llm_service, "EMERGENT_LLM_KEY", "sk-emergent-test")
    assert llm_service.active_provider() == "gemini"
    assert llm_service.available_providers() == ["gemini", "openai", "emergent"]


def test_openai_when_no_gemini(monkeypatch):
    monkeypatch.setattr(llm_service, "GEMINI_API_KEY", "")
    monkeypatch.setattr(llm_service, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(llm_service, "EMERGENT_LLM_KEY", "")
    assert llm_service.active_provider() == "openai"
    assert llm_service.available_providers() == ["openai"]


@pytest.mark.asyncio
async def test_no_providers_raises(monkeypatch):
    monkeypatch.setattr(llm_service, "GEMINI_API_KEY", "")
    monkeypatch.setattr(llm_service, "OPENAI_API_KEY", "")
    monkeypatch.setattr(llm_service, "EMERGENT_LLM_KEY", "")
    with pytest.raises(RuntimeError, match="Tidak ada API key"):
        await llm_service.chat_text("sys", "user")


@pytest.mark.asyncio
async def test_fallback_gemini_fails_uses_openai(monkeypatch):
    """Gemini 429 → automatically fall through to OpenAI."""
    monkeypatch.setattr(llm_service, "GEMINI_API_KEY", "AIza-test")
    monkeypatch.setattr(llm_service, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(llm_service, "EMERGENT_LLM_KEY", "")

    async def _gemini_fail(*a, **kw):
        raise RuntimeError("429 QUOTA_EXCEEDED")

    async def _openai_ok(*a, **kw):
        return "OPENAI_SUCCESS"

    monkeypatch.setattr(llm_service, "_chat_gemini", _gemini_fail)
    monkeypatch.setattr(llm_service, "_chat_openai", _openai_ok)
    result = await llm_service.chat_text("sys", "user")
    assert result == "OPENAI_SUCCESS"


@pytest.mark.asyncio
async def test_all_providers_fail_raises(monkeypatch):
    monkeypatch.setattr(llm_service, "GEMINI_API_KEY", "AIza-test")
    monkeypatch.setattr(llm_service, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(llm_service, "EMERGENT_LLM_KEY", "sk-emergent-test")

    async def _fail(*a, **kw):
        raise RuntimeError("boom")

    monkeypatch.setattr(llm_service, "_chat_gemini", _fail)
    monkeypatch.setattr(llm_service, "_chat_openai", _fail)
    monkeypatch.setattr(llm_service, "_chat_emergent", _fail)
    with pytest.raises(RuntimeError, match="Semua provider LLM gagal"):
        await llm_service.chat_text("sys", "user")


@pytest.mark.asyncio
async def test_first_provider_succeeds_no_fallback(monkeypatch):
    monkeypatch.setattr(llm_service, "GEMINI_API_KEY", "AIza-test")
    monkeypatch.setattr(llm_service, "OPENAI_API_KEY", "sk-test")

    async def _gemini_ok(*a, **kw):
        return "GEMINI_WORKS"

    openai_mock = AsyncMock()
    monkeypatch.setattr(llm_service, "_chat_gemini", _gemini_ok)
    monkeypatch.setattr(llm_service, "_chat_openai", openai_mock)
    result = await llm_service.chat_text("sys", "user")
    assert result == "GEMINI_WORKS"
    openai_mock.assert_not_called()  # Fallback not triggered
