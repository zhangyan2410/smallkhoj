import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from routers import public_api
from services.member_identity import (
    CROCKFORD_ALPHABET,
    MemberIdentityError,
    generate_server_handle,
    normalize_description,
    normalize_handle,
    parse_member_reference,
)

FIXTURE_PATH = Path(__file__).resolve().parents[2] / "contracts" / "member-name-cases.json"


def _fixture():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", _fixture()["valid"])
def test_normalize_handle_matches_shared_valid_contract(case):
    value = normalize_handle(case["input"])
    assert value.handle == case["handle"]
    assert value.handle_key == case["handleKey"]


@pytest.mark.parametrize("case", _fixture()["invalid"])
def test_normalize_handle_matches_shared_invalid_contract(case):
    with pytest.raises(MemberIdentityError) as error:
        normalize_handle(case["input"])
    assert error.value.code == case["reasonCode"]


def test_normalize_handle_counts_unicode_codepoints():
    assert normalize_handle("张" * 32).handle == "张" * 32
    with pytest.raises(MemberIdentityError, match="at most 32"):
        normalize_handle("张" * 33)


def test_normalize_description_trims_outer_space_and_preserves_newlines():
    assert normalize_description(" \n擅长后端排障\n数据库迁移 \n") == "擅长后端排障\n数据库迁移"
    assert normalize_description(" \n\t ") is None
    assert normalize_description(None) is None


def test_normalize_description_counts_unicode_codepoints():
    assert normalize_description("能" * 200) == "能" * 200
    with pytest.raises(MemberIdentityError) as error:
        normalize_description("能" * 201)
    assert error.value.code == "DESCRIPTION_TOO_LONG"


def test_generate_server_handle_matches_product_grammar():
    values = {generate_server_handle() for _ in range(64)}
    assert all(len(value) == 5 and value[0] == "s" for value in values)
    assert all(set(value[1:]) <= set(CROCKFORD_ALPHABET) for value in values)
    assert len(values) > 1


def test_parse_member_reference_separates_reserved_server_qualifier():
    bare = parse_member_reference("@张翰")
    qualified = parse_member_reference("@Ean-s7k2m")

    assert (bare.handle, bare.handle_key, bare.server_handle) == ("张翰", "张翰", None)
    assert (qualified.handle, qualified.handle_key, qualified.server_handle) == ("Ean", "ean", "s7k2m")


@pytest.mark.asyncio
async def test_better_auth_bootstrap_requires_explicit_product_name():
    with pytest.raises(HTTPException) as error:
        await public_api._bootstrap_better_auth_account(
            object(),
            external_user_id="better-auth-user",
            name=None,
        )
    assert error.value.status_code == 400
    assert error.value.detail["reasonCode"] == "NAME_REQUIRED"
