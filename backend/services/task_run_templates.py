"""TaskRun template helpers."""

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, case, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import TaskRunTemplate
from services.task_runs import DEFAULT_TASK_RUN_TEMPLATE_SNAPSHOT


TEMPLATE_STATUSES = {"active", "disabled"}
TEMPLATE_VISIBILITIES = {"builtin", "server", "user"}
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$")


def _dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def default_template_snapshot() -> dict[str, Any]:
    return dict(DEFAULT_TASK_RUN_TEMPLATE_SNAPSHOT)


def template_snapshot(template: TaskRunTemplate | None) -> dict[str, Any]:
    if template is None:
        return default_template_snapshot()
    return {
        "id": str(template.id),
        "slug": template.slug,
        "name": template.name,
        "description": template.description,
        "category": template.category,
        "systemInstruction": template.system_instruction,
        "toolPolicy": _dict(template.tool_policy),
        "skillPolicy": _dict(template.skill_policy),
        "memoryPolicy": _dict(template.memory_policy),
        "outputPolicy": _dict(template.output_policy),
        "runtimePolicy": _dict(template.runtime_policy),
        "startPolicy": _dict(template.start_policy),
        "rolePresets": _list(template.role_presets),
        "visibility": template.visibility,
        "status": template.status,
        "updatedAt": template.updated_at.isoformat() if template.updated_at else None,
    }


def serialize_task_run_template(template: TaskRunTemplate) -> dict[str, Any]:
    return {
        "id": str(template.id),
        "serverId": str(template.server_id) if template.server_id else None,
        "slug": template.slug,
        "name": template.name,
        "description": template.description,
        "category": template.category,
        "systemInstruction": template.system_instruction,
        "toolPolicy": _dict(template.tool_policy),
        "skillPolicy": _dict(template.skill_policy),
        "memoryPolicy": _dict(template.memory_policy),
        "outputPolicy": _dict(template.output_policy),
        "runtimePolicy": _dict(template.runtime_policy),
        "startPolicy": _dict(template.start_policy),
        "rolePresets": _list(template.role_presets),
        "visibility": template.visibility,
        "status": template.status,
        "createdBy": str(template.created_by) if template.created_by else None,
        "createdAt": template.created_at.isoformat() if template.created_at else None,
        "updatedAt": template.updated_at.isoformat() if template.updated_at else None,
    }


def _validate_template_payload(payload: dict[str, Any], *, partial: bool = False) -> dict[str, Any]:
    allowed = {
        "slug",
        "name",
        "description",
        "category",
        "systemInstruction",
        "toolPolicy",
        "skillPolicy",
        "memoryPolicy",
        "outputPolicy",
        "runtimePolicy",
        "startPolicy",
        "rolePresets",
        "visibility",
        "status",
    }
    data = {key: payload[key] for key in allowed if key in payload}
    if not partial:
        for key in ("slug", "name", "systemInstruction"):
            if not data.get(key):
                raise ValueError(f"Missing {key}")
    if "slug" in data:
        slug = str(data["slug"]).strip().lower()
        if not SLUG_RE.match(slug):
            raise ValueError("Invalid slug")
        data["slug"] = slug
    for key in ("name", "systemInstruction"):
        if key in data:
            value = str(data[key]).strip()
            if not value:
                raise ValueError(f"Missing {key}")
            data[key] = value
    for key in ("description", "category"):
        if key in data and data[key] is not None:
            data[key] = str(data[key]).strip() or None
    for key in ("toolPolicy", "skillPolicy", "memoryPolicy", "outputPolicy", "runtimePolicy", "startPolicy"):
        if key in data and not isinstance(data[key], dict):
            raise ValueError(f"{key} must be an object")
    if "rolePresets" in data:
        if not isinstance(data["rolePresets"], list):
            raise ValueError("rolePresets must be an array")
        for index, preset in enumerate(data["rolePresets"]):
            if not isinstance(preset, dict):
                raise ValueError(f"rolePresets[{index}] must be an object")
            role_key = str(preset.get("roleKey") or "").strip()
            if not role_key:
                raise ValueError(f"rolePresets[{index}].roleKey is required")
            for policy_key in (
                "toolPolicy",
                "skillPolicy",
                "memoryPolicy",
                "outputPolicy",
                "runtimePolicy",
                "loopPolicy",
                "contextPolicy",
            ):
                if policy_key in preset and not isinstance(preset[policy_key], dict):
                    raise ValueError(f"rolePresets[{index}].{policy_key} must be an object")
            if "editableFields" in preset and not isinstance(preset["editableFields"], list):
                raise ValueError(f"rolePresets[{index}].editableFields must be an array")
    if "status" in data:
        status = str(data["status"])
        if status not in TEMPLATE_STATUSES:
            raise ValueError("Invalid status")
        data["status"] = status
    if "visibility" in data:
        visibility = str(data["visibility"])
        if visibility not in TEMPLATE_VISIBILITIES:
            raise ValueError("Invalid visibility")
        data["visibility"] = visibility
    return data


def _visible_template_filter(server_id: uuid.UUID):
    return or_(
        and_(
            TaskRunTemplate.visibility == "builtin",
            TaskRunTemplate.server_id.is_(None),
        ),
        TaskRunTemplate.server_id == server_id,
    )


async def list_templates(
    db: AsyncSession,
    *,
    server_id: uuid.UUID,
) -> list[TaskRunTemplate]:
    result = await db.execute(
        select(TaskRunTemplate)
        .where(_visible_template_filter(server_id))
        .order_by(TaskRunTemplate.status, TaskRunTemplate.name)
    )
    return list(result.scalars().all())


async def get_template_by_ref(
    db: AsyncSession,
    ref: str | uuid.UUID | None,
    *,
    server_id: uuid.UUID,
) -> TaskRunTemplate | None:
    if not ref:
        return None
    parsed: uuid.UUID | None = ref if isinstance(ref, uuid.UUID) else None
    if parsed is None:
        try:
            parsed = uuid.UUID(str(ref))
        except (TypeError, ValueError):
            parsed = None
    stmt = select(TaskRunTemplate).where(
        TaskRunTemplate.status == "active",
        _visible_template_filter(server_id),
    )
    if parsed:
        stmt = stmt.where(TaskRunTemplate.id == parsed)
    else:
        stmt = stmt.where(TaskRunTemplate.slug == str(ref).strip().lower()).order_by(
            case((TaskRunTemplate.server_id == server_id, 0), else_=1)
        )
    result = await db.execute(stmt.limit(1))
    return result.scalar_one_or_none()


async def get_default_template(db: AsyncSession) -> TaskRunTemplate | None:
    result = await db.execute(
        select(TaskRunTemplate).where(
            TaskRunTemplate.slug == "general-task-runner",
            TaskRunTemplate.visibility == "builtin",
            TaskRunTemplate.server_id.is_(None),
            TaskRunTemplate.status == "active",
        )
    )
    return result.scalar_one_or_none()


async def create_template(
    db: AsyncSession,
    payload: dict[str, Any],
    *,
    server_id: uuid.UUID | None,
    created_by: uuid.UUID | None = None,
    visibility: str = "user",
    allow_builtin: bool = False,
) -> TaskRunTemplate:
    data = _validate_template_payload({**payload, "visibility": payload.get("visibility", visibility)})
    resolved_visibility = data.get("visibility") or visibility
    if resolved_visibility == "builtin":
        if not allow_builtin:
            raise PermissionError("Builtin templates are system-managed")
        resolved_server_id = None
    else:
        if server_id is None:
            raise ValueError("server_id is required for non-builtin templates")
        resolved_server_id = server_id
    template = TaskRunTemplate(
        server_id=resolved_server_id,
        slug=data["slug"],
        name=data["name"],
        description=data.get("description"),
        category=data.get("category"),
        system_instruction=data["systemInstruction"],
        tool_policy=data.get("toolPolicy") or {},
        skill_policy=data.get("skillPolicy") or {},
        memory_policy=data.get("memoryPolicy") or {},
        output_policy=data.get("outputPolicy") or {},
        runtime_policy=data.get("runtimePolicy") or {},
        start_policy=data.get("startPolicy") or {"autoStart": True, "executionStrategy": "parallel"},
        role_presets=data.get("rolePresets") or [],
        visibility=resolved_visibility,
        status=data.get("status") or "active",
        created_by=created_by,
    )
    db.add(template)
    await db.flush()
    return template


def _assert_writable(template: TaskRunTemplate, *, server_id: uuid.UUID) -> None:
    if template.visibility == "builtin" or template.server_id != server_id:
        raise LookupError("TaskRun template not found")


async def update_template(
    db: AsyncSession,
    template: TaskRunTemplate,
    payload: dict[str, Any],
    *,
    server_id: uuid.UUID,
) -> TaskRunTemplate:
    _assert_writable(template, server_id=server_id)
    data = _validate_template_payload(payload, partial=True)
    if "visibility" in data:
        raise ValueError("TaskRun template visibility is immutable")
    field_map = {
        "systemInstruction": "system_instruction",
        "toolPolicy": "tool_policy",
        "skillPolicy": "skill_policy",
        "memoryPolicy": "memory_policy",
        "outputPolicy": "output_policy",
        "runtimePolicy": "runtime_policy",
        "startPolicy": "start_policy",
        "rolePresets": "role_presets",
    }
    for key, value in data.items():
        setattr(template, field_map.get(key, key), value)
    template.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return template


async def disable_template(
    db: AsyncSession,
    template: TaskRunTemplate,
    *,
    server_id: uuid.UUID,
) -> TaskRunTemplate:
    _assert_writable(template, server_id=server_id)
    template.status = "disabled"
    template.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return template
