import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from models import Member
from services.pi_llm_relay import (
    require_pi_runtime_member,
    resolve_pi_llm_config,
    validate_pi_relay_request,
)


def test_pi_llm_config_falls_back_to_existing_proven_llm_supply():
    config = resolve_pi_llm_config(SimpleNamespace(
        pi_llm_api_key="",
        pi_llm_api_base="",
        pi_llm_model="",
        llm_api_key="minimax-secret",
        llm_api_base="https://api.minimax.example/v1",
        llm_model="MiniMax-M2.1",
    ))

    assert config.api_key == "minimax-secret"
    assert config.api_base == "https://api.minimax.example/v1"
    assert config.model == "MiniMax-M2.1"


def test_relay_allows_only_chat_completions_and_configured_model():
    config = resolve_pi_llm_config(SimpleNamespace(
        pi_llm_api_key="key",
        pi_llm_api_base="https://provider.example/v1/",
        pi_llm_model="allowed-model",
        llm_api_key="",
        llm_api_base="",
        llm_model="",
    ))

    upstream_url, payload = validate_pi_relay_request(
        path="chat/completions",
        body={"model": "allowed-model", "messages": [], "stream": True},
        config=config,
    )

    assert upstream_url == "https://provider.example/v1/chat/completions"
    assert payload["model"] == "allowed-model"

    with pytest.raises(HTTPException) as model_error:
        validate_pi_relay_request(
            path="chat/completions",
            body={"model": "attacker-model", "messages": []},
            config=config,
        )
    assert model_error.value.status_code == 400

    with pytest.raises(HTTPException) as path_error:
        validate_pi_relay_request(path="../admin", body={"model": "allowed-model"}, config=config)
    assert path_error.value.status_code == 404


def test_relay_accepts_anthropic_messages_path():
    config = resolve_pi_llm_config(SimpleNamespace(
        pi_llm_api_key="sk-secret",
        pi_llm_api_base="https://provider.example",
        pi_llm_model="allowed-model",
        llm_api_key="",
        llm_api_base="",
        llm_model="",
    ))

    # Anthropic Messages API path: messages 或 v1/messages
    upstream_url, payload = validate_pi_relay_request(
        path="v1/messages",
        body={"model": "allowed-model", "messages": [], "max_tokens": 1024},
        config=config,
    )
    assert upstream_url == "https://provider.example/v1/messages"
    assert payload["model"] == "allowed-model"



def test_relay_rejects_missing_service_credential_without_echoing_secrets():
    config = resolve_pi_llm_config(SimpleNamespace(
        pi_llm_api_key="",
        pi_llm_api_base="https://provider.example/v1",
        pi_llm_model="allowed-model",
        llm_api_key="",
        llm_api_base="",
        llm_model="",
    ))

    with pytest.raises(HTTPException) as exc:
        validate_pi_relay_request(
            path="chat/completions",
            body={"model": "allowed-model"},
            config=config,
        )

    assert exc.value.status_code == 503
    assert "key" not in str(exc.value.detail).lower()


def test_only_pi_bound_agents_can_use_builtin_llm_relay():
    server_id = uuid.uuid4()
    pi_member = Member(
        origin_server_id=server_id,
        kind="agent",
        handle="Guide",
        handle_key="guide",
        backend="pi",
        config={"runtime": "pi"},
    )
    regular = Member(
        origin_server_id=server_id,
        kind="agent",
        handle="Claude",
        handle_key="claude",
        backend="claude_code",
        config={},
    )

    require_pi_runtime_member(pi_member)
    with pytest.raises(HTTPException) as exc:
        require_pi_runtime_member(regular)

    assert exc.value.status_code == 403
