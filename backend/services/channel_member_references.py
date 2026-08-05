"""Channel-scoped member reference projection and Unicode mention resolution."""

from __future__ import annotations

import unicodedata
import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, replace
from typing import Any

from sqlalchemy import select

from models import Account, ChannelMember, Member, Server
from services.member_identity import MemberIdentityError, parse_member_reference


@dataclass(frozen=True, slots=True)
class ChannelRosterMember:
    member_id: uuid.UUID
    kind: str
    handle: str
    handle_key: str
    origin_server_id: uuid.UUID
    server_handle: str
    status: str | None = None
    description: str | None = None
    display_name: str | None = None
    origin_server_name: str | None = None
    reference: str = ""

    def compact_payload(self) -> dict[str, str]:
        return {
            "memberId": str(self.member_id),
            "kind": self.kind,
            "reference": self.reference,
        }

    def agent_payload(self, *, include_description: bool) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "memberId": str(self.member_id),
            "kind": self.kind,
            "handle": self.handle,
            "reference": self.reference,
            "status": self.status,
        }
        if self.kind == "agent" and include_description:
            payload["description"] = self.description
        return payload

    def human_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "memberId": str(self.member_id),
            "kind": self.kind,
            "handle": self.handle,
            "reference": self.reference,
            "status": self.status,
            "originServerName": self.origin_server_name,
        }
        if self.kind == "human" and self.display_name:
            payload["displayName"] = self.display_name
        if self.kind == "agent":
            payload["description"] = self.description
        return payload


def project_channel_roster(rows: Iterable[ChannelRosterMember]) -> list[ChannelRosterMember]:
    members = list(rows)
    groups: dict[str, list[ChannelRosterMember]] = defaultdict(list)
    for member in members:
        groups[member.handle_key].append(member)

    projected = []
    for member in members:
        collision = len(groups[member.handle_key]) > 1
        suffix = f"-{member.server_handle}" if collision else ""
        projected.append(replace(member, reference=f"@{member.handle}{suffix}"))
    return projected


async def load_channel_roster(db: Any, *, channel_id: uuid.UUID) -> list[ChannelRosterMember]:
    result = await db.execute(
        select(Member, Server.server_handle, Server.name, Account.display_name)
        .join(ChannelMember, ChannelMember.member_id == Member.id)
        .join(Server, Server.id == Member.origin_server_id)
        .outerjoin(Account, Account.id == Member.account_id)
        .where(
            ChannelMember.channel_id == channel_id,
            Member.deleted_at.is_(None),
        )
        .order_by(ChannelMember.joined_at, Member.id)
    )
    return project_channel_roster(
        ChannelRosterMember(
            member_id=member.id,
            kind=member.kind,
            handle=member.handle,
            handle_key=member.handle_key,
            origin_server_id=member.origin_server_id,
            server_handle=server_handle,
            status=member.status,
            description=member.description if member.kind == "agent" else None,
            display_name=display_name if member.kind == "human" else None,
            origin_server_name=server_name,
        )
        for member, server_handle, server_name, display_name in result.all()
    )


async def load_agent_channel_roster(db: Any, *, channel_id: uuid.UUID) -> list[ChannelRosterMember]:
    """Agent-safe roster load: deliberately does not select presentation names."""

    result = await db.execute(
        select(Member, Server.server_handle)
        .join(ChannelMember, ChannelMember.member_id == Member.id)
        .join(Server, Server.id == Member.origin_server_id)
        .where(
            ChannelMember.channel_id == channel_id,
            Member.deleted_at.is_(None),
        )
        .order_by(ChannelMember.joined_at, Member.id)
    )
    return project_channel_roster(
        ChannelRosterMember(
            member_id=member.id,
            kind=member.kind,
            handle=member.handle,
            handle_key=member.handle_key,
            origin_server_id=member.origin_server_id,
            server_handle=server_handle,
            status=member.status,
            description=member.description if member.kind == "agent" else None,
        )
        for member, server_handle in result.all()
    )


def reference_updates(
    before: Iterable[ChannelRosterMember],
    after: Iterable[ChannelRosterMember],
) -> list[dict[str, str]]:
    previous = {member.member_id: member.reference for member in before}
    return [
        {"memberId": str(member.member_id), "reference": member.reference}
        for member in after
        if previous.get(member.member_id) != member.reference
    ]


def _is_reference_character(character: str) -> bool:
    if character == "-":
        return True
    category = unicodedata.category(character)
    return category.startswith("L") or category == "Nd"


def member_reference_tokens(content: str) -> list[str]:
    tokens: list[str] = []
    index = 0
    while index < len(content):
        if content[index] != "@":
            index += 1
            continue
        if index > 0 and (_is_reference_character(content[index - 1]) or content[index - 1] == "@"):
            index += 1
            continue
        end = index + 1
        while end < len(content) and _is_reference_character(content[end]):
            end += 1
        token = content[index:end]
        if len(token) > 1 and not token.endswith("-"):
            tokens.append(token)
        index = max(end, index + 1)
    return tokens


def resolve_channel_mentions(
    content: str,
    roster: Iterable[ChannelRosterMember],
    *,
    selected_member_ids: Iterable[uuid.UUID] = (),
) -> list[uuid.UUID]:
    members = list(roster)
    by_id = {member.member_id: member for member in members}
    by_key: dict[str, list[ChannelRosterMember]] = defaultdict(list)
    by_qualified: dict[tuple[str, str], list[ChannelRosterMember]] = defaultdict(list)
    for member in members:
        by_key[member.handle_key].append(member)
        by_qualified[(member.handle_key, member.server_handle)].append(member)

    tokens = member_reference_tokens(content or "")
    normalized_tokens = {unicodedata.normalize("NFKC", token).casefold() for token in tokens}
    resolved: list[uuid.UUID] = []

    def append(member_id: uuid.UUID) -> None:
        if member_id not in resolved:
            resolved.append(member_id)

    for selected_id in selected_member_ids:
        member = by_id.get(selected_id)
        if member is None:
            continue
        canonical = unicodedata.normalize("NFKC", member.reference).casefold()
        if canonical in normalized_tokens:
            append(member.member_id)

    for token in tokens:
        try:
            parsed = parse_member_reference(token)
        except MemberIdentityError:
            continue
        if parsed.server_handle:
            matches = by_qualified.get((parsed.handle_key, parsed.server_handle), [])
        else:
            matches = by_key.get(parsed.handle_key, [])
        if len(matches) == 1:
            append(matches[0].member_id)
    return resolved

