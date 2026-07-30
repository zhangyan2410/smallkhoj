import uuid

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from main import app
from models import (
    Account,
    Channel,
    Member,
    Server,
    ServerMembership,
    Task,
    TaskAssignment,
    TaskRun,
    TaskRunTemplate,
)
from routers import public_api
from tests.postgres_test_support import disposable_postgres, run_alembic


def _headers(server_id: uuid.UUID, token: str) -> dict[str, str]:
    return {
        "X-Public-Key": public_api.PUBLIC_API_KEY,
        "X-Account-Token": token,
        "X-Server-Id": str(server_id),
    }


async def _seed_identity(session_factory, *, role="member"):
    server = Server(id=uuid.uuid4(), name=f"template-server-{uuid.uuid4().hex[:8]}")
    member = Member(
        id=uuid.uuid4(),
        server_id=server.id,
        kind="human",
        display_name=f"template-member-{uuid.uuid4().hex[:8]}",
    )
    token = f"template_session_{uuid.uuid4().hex}"
    account = Account(
        id=uuid.uuid4(),
        name=f"template-account-{uuid.uuid4().hex[:12]}",
        display_name=member.display_name,
        server_id=server.id,
        member_id=member.id,
        session_token_hash=public_api._hash_token(token),
    )
    membership = ServerMembership(
        id=uuid.uuid4(),
        server_id=server.id,
        account_id=account.id,
        member_id=member.id,
        role=role,
        status="active",
    )
    async with session_factory.begin() as db:
        db.add_all([server, member, account, membership])
    return server, member, token


def _template_payload(slug: str, *, visibility="user"):
    return {
        "slug": slug,
        "name": slug.replace("-", " ").title(),
        "systemInstruction": "Execute this Server-scoped template.",
        "visibility": visibility,
    }


@pytest.mark.asyncio
async def test_template_http_routes_enforce_tenant_scope_and_builtin_privilege():
    async with disposable_postgres() as postgres:
        run_alembic(postgres.database_url, "upgrade", "head")
        engine = create_async_engine(postgres.database_url)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        try:
            server_a, member_a, token_a = await _seed_identity(sessions, role="member")
            server_b, member_b, token_b = await _seed_identity(sessions, role="owner")
            builtin = TaskRunTemplate(
                id=uuid.UUID("11111111-1111-4111-8111-111111111111"),
                server_id=None,
                slug="general-task-runner",
                name="General Task Runner",
                system_instruction="Execute a general task.",
                visibility="builtin",
                status="active",
            )
            async with sessions.begin() as db:
                db.add(builtin)
                channel_a = Channel(
                    id=uuid.uuid4(),
                    server_id=server_a.id,
                    name="template-tasks",
                    kind="public",
                )
                agent_a = Member(
                    id=uuid.uuid4(),
                    server_id=server_a.id,
                    kind="agent",
                    display_name="template-agent-a",
                    config={"permissions": {}},
                )
                db.add_all([channel_a, agent_a])
                await db.flush()
                task_a = Task(
                    task_number=1,
                    channel_id=channel_a.id,
                    title="Tenant-scoped template assignment",
                    status="todo",
                    creator_id=member_a.id,
                    data={},
                )
                db.add(task_a)

            async def override_db():
                async with sessions() as db:
                    yield db

            previous = app.dependency_overrides.copy()
            app.dependency_overrides[public_api.get_db] = override_db
            try:
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app),
                    base_url="http://testserver",
                ) as client:
                    create_a = await client.post(
                        "/api/v1/task-run-templates",
                        headers=_headers(server_a.id, token_a),
                        json=_template_payload("shared-playbook"),
                    )
                    create_b = await client.post(
                        "/api/v1/task-run-templates",
                        headers=_headers(server_b.id, token_b),
                        json=_template_payload("shared-playbook"),
                    )

                    assert create_a.status_code == 200, create_a.text
                    assert create_b.status_code == 200, create_b.text
                    template_a = create_a.json()["template"]
                    template_b = create_b.json()["template"]
                    assert template_a["serverId"] == str(server_a.id)
                    assert template_b["serverId"] == str(server_b.id)
                    assert template_a["createdBy"] == str(member_a.id)
                    assert template_b["createdBy"] == str(member_b.id)

                    duplicate_a = await client.post(
                        "/api/v1/task-run-templates",
                        headers=_headers(server_a.id, token_a),
                        json=_template_payload("shared-playbook"),
                    )
                    assert duplicate_a.status_code == 409

                    create_builtin = await client.post(
                        "/api/v1/task-run-templates",
                        headers=_headers(server_a.id, token_a),
                        json=_template_payload("untrusted-builtin", visibility="builtin"),
                    )
                    assert create_builtin.status_code == 403
                    owner_create_builtin = await client.post(
                        "/api/v1/task-run-templates",
                        headers=_headers(server_b.id, token_b),
                        json=_template_payload("owner-untrusted-builtin", visibility="builtin"),
                    )
                    assert owner_create_builtin.status_code == 403

                    list_a = await client.get(
                        "/api/v1/task-run-templates",
                        headers=_headers(server_a.id, token_a),
                    )
                    assert list_a.status_code == 200
                    listed_ids = {item["id"] for item in list_a.json()["templates"]}
                    assert listed_ids == {str(builtin.id), template_a["id"]}
                    assert template_b["id"] not in listed_ids

                    cross_patch = await client.patch(
                        f"/api/v1/task-run-templates/{template_b['id']}",
                        headers=_headers(server_a.id, token_a),
                        json={"name": "Cross-tenant mutation"},
                    )
                    cross_disable = await client.post(
                        f"/api/v1/task-run-templates/{template_b['id']}/disable",
                        headers=_headers(server_a.id, token_a),
                        json={},
                    )
                    assert cross_patch.status_code == 404
                    assert cross_disable.status_code == 404

                    cross_run = await client.post(
                        f"/api/v1/tasks/{task_a.id}/assignments",
                        headers=_headers(server_a.id, token_a),
                        json={
                            "assignee": str(agent_a.id),
                            "templateId": template_b["id"],
                            "autoStart": True,
                        },
                    )
                    assert cross_run.status_code == 404

                    builtin_patch = await client.patch(
                        f"/api/v1/task-run-templates/{builtin.id}",
                        headers=_headers(server_a.id, token_a),
                        json={"name": "Mutated builtin"},
                    )
                    assert builtin_patch.status_code == 404

                    own_patch = await client.patch(
                        f"/api/v1/task-run-templates/{template_a['id']}",
                        headers=_headers(server_a.id, token_a),
                        json={"name": "Updated A"},
                    )
                    assert own_patch.status_code == 200, own_patch.text
                    assert own_patch.json()["template"]["name"] == "Updated A"

                    own_disable = await client.post(
                        f"/api/v1/task-run-templates/{template_a['id']}/disable",
                        headers=_headers(server_a.id, token_a),
                        json={},
                    )
                    assert own_disable.status_code == 200, own_disable.text
                    assert own_disable.json()["template"]["status"] == "disabled"
            finally:
                app.dependency_overrides = previous

            async with sessions() as db:
                assert await db.scalar(select(func.count()).select_from(TaskAssignment)) == 0
                assert await db.scalar(select(func.count()).select_from(TaskRun)) == 0
        finally:
            await engine.dispose()
