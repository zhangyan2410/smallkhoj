"""Application writers must delegate global message sequencing to PostgreSQL."""

from __future__ import annotations

import ast
import inspect

from models import Message
from routers import agent_api, public_api
from services import reminder_scheduler


def _message_constructor_keywords(function) -> list[set[str]]:
    tree = ast.parse(inspect.getsource(function))
    calls: list[set[str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "Message":
            calls.append({keyword.arg for keyword in node.keywords if keyword.arg is not None})
    return calls


def test_message_model_matches_final_generated_always_schema():
    identity = Message.__table__.c.seq.identity
    assert identity is not None
    assert identity.always is True


def test_agent_send_omits_database_owned_message_seq():
    constructors = _message_constructor_keywords(agent_api.send_message)
    assert constructors
    assert all("seq" not in keywords for keywords in constructors)


def test_public_message_create_omits_database_owned_message_seq():
    constructors = _message_constructor_keywords(public_api.create_channel_message)
    assert constructors
    assert all("seq" not in keywords for keywords in constructors)


def test_reminder_writer_omits_database_owned_message_seq():
    constructors = _message_constructor_keywords(reminder_scheduler.fire_due_reminders)
    assert constructors
    assert all("seq" not in keywords for keywords in constructors)
    assert not hasattr(reminder_scheduler, "_next_message_seq")
