import uuid

from services.channel_member_references import (
    ChannelRosterMember,
    member_reference_tokens,
    project_channel_roster,
    reference_updates,
    resolve_channel_mentions,
)


def _member(handle, handle_key, server_handle, *, kind="agent"):
    return ChannelRosterMember(
        member_id=uuid.uuid4(),
        kind=kind,
        handle=handle,
        handle_key=handle_key,
        origin_server_id=uuid.uuid4(),
        server_handle=server_handle,
    )


def test_projection_qualifies_every_collision_member_and_restores_bare_reference():
    first = _member("ean", "ean", "s7k2m", kind="human")
    second = _member("Ean", "ean", "s9p4x")

    before = project_channel_roster([first])
    collided = project_channel_roster([first, second])
    after = project_channel_roster([first])

    assert before[0].reference == "@ean"
    assert [member.reference for member in collided] == ["@ean-s7k2m", "@Ean-s9p4x"]
    assert reference_updates(before, collided) == [
        {"memberId": str(first.member_id), "reference": "@ean-s7k2m"},
        {"memberId": str(second.member_id), "reference": "@Ean-s9p4x"},
    ]
    assert reference_updates(collided, after) == [
        {"memberId": str(first.member_id), "reference": "@ean"},
    ]


def test_unicode_tokenizer_and_resolver_are_channel_scoped_and_ambiguity_safe():
    first = _member("张翰", "张翰", "s7k2m", kind="human")
    second = _member("张翰", "张翰", "s9p4x")
    unique = _member("研发-1", "研发-1", "s1111")
    roster = project_channel_roster([first, second, unique])
    content = "请 @张翰-s7k2m 和 @研发-1 看一下；@张翰 与 @unknown 保持普通文本。"

    assert member_reference_tokens(content) == ["@张翰-s7k2m", "@研发-1", "@张翰", "@unknown"]
    assert resolve_channel_mentions(content, roster) == [first.member_id, unique.member_id]


def test_selected_member_id_must_still_have_its_canonical_token_in_content():
    member = _member("Ean", "ean", "s7k2m")
    roster = project_channel_roster([member])

    assert resolve_channel_mentions("你好 @Ean", roster, selected_member_ids=[member.member_id]) == [
        member.member_id
    ]
    assert resolve_channel_mentions("token 已被删掉", roster, selected_member_ids=[member.member_id]) == []
