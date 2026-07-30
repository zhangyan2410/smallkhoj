"""Validation and secret boundary for Pi's OpenAI-compatible model relay."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from fastapi import HTTPException

from models import Member


@dataclass(frozen=True)
class PiLlmConfig:
    api_key: str
    api_base: str
    model: str


def resolve_pi_llm_config(settings: Any) -> PiLlmConfig:
    return PiLlmConfig(
        api_key=str(getattr(settings, "pi_llm_api_key", "") or getattr(settings, "llm_api_key", "")).strip(),
        api_base=str(getattr(settings, "pi_llm_api_base", "") or getattr(settings, "llm_api_base", "")).strip().rstrip("/"),
        model=str(getattr(settings, "pi_llm_model", "") or getattr(settings, "llm_model", "")).strip(),
    )


def require_pi_runtime_member(member: Member) -> None:
    config = member.config or {}
    if member.kind != "agent" or not (member.backend == "pi" or config.get("runtime") == "pi"):
        raise HTTPException(403, "Built-in LLM relay is available only to Pi runtime Agents")


def validate_pi_relay_request(
    *,
    path: str,
    body: dict,
    config: PiLlmConfig,
) -> tuple[str, dict]:
    if not config.api_key or not config.api_base or not config.model:
        raise HTTPException(503, "Built-in LLM service is not configured")
    parsed = urlsplit(config.api_base)
    if parsed.scheme not in {"https", "http"} or not parsed.netloc:
        raise HTTPException(503, "Built-in LLM service endpoint is invalid")
    normalized_path = path.strip("/")
    # 两种协议格式都支持：OpenAI (/v1/chat/completions) 和 Anthropic (/v1/messages)
    if normalized_path == "chat/completions":
        suffix = "chat/completions"
    elif normalized_path in ("messages", "v1/messages"):
        suffix = "v1/messages"
    else:
        raise HTTPException(404, "Unsupported built-in LLM operation")
    # model 校验：OpenAI 用 body.model，Anthropic 也用 body.model
    requested_model = str(body.get("model") or "").strip()
    if requested_model != config.model:
        raise HTTPException(400, "Requested model is not available for the built-in Runtime")
    return f"{config.api_base}/{suffix}", dict(body)
