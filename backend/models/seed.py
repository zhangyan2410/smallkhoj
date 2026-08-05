"""Runtime data seeding.

Schema (tables, indexes, constraints, extensions) is managed by Alembic — run
``alembic upgrade head`` as a deploy step (the docker-compose backend service does
this automatically before uvicorn starts). See ``docs/migration-workflow.md``.

This module is intentionally NOT a schema source. The only things it does at startup:
  1. Seed builtin ``task_run_templates`` rows (data, not schema).
  2. Backfill ``members.computer_id`` / ``members.backend`` from the legacy
     ``config`` JSON column (one-time data repair).

Never add table/index DDL here — that is Alembic's job. Add a new
``alembic revision --autogenerate`` after editing ``models/slock.py``.
"""

import asyncio
import json

from sqlalchemy import text

from models import engine
from services.agent_permissions import DEFAULT_LEGACY_AGENT_PERMISSIONS


async def create_tables():
    """Run idempotent runtime data seeds; the legacy name is retained for callers.

    Kept here (and kept in ``main.py:lifespan``) so that builtin templates and
    compatible data seeds run on every boot. Schema creation and upgrades live
    exclusively in ``alembic upgrade head`` and must succeed before app startup.
    """
    async with engine.begin() as conn:
        # ── Data seeding: builtin task_run_templates ────────────────────────
        # Two builtin templates (general-task-runner, research-analyst) shipped
        # with the app. Idempotent via ON CONFLICT (slug) DO NOTHING.
        await conn.execute(text("""
            INSERT INTO task_run_templates (
                id,
                slug,
                name,
                description,
                category,
                system_instruction,
                tool_policy,
                skill_policy,
                memory_policy,
                output_policy,
                runtime_policy,
                start_policy,
                role_presets,
                visibility,
                status,
                created_at,
                updated_at
            ) VALUES
            (
                '11111111-1111-4111-8111-111111111111',
                'general-task-runner',
                'General Task Runner',
                'Default structured TaskRun template for backward-compatible agent assignments.',
                'general',
                'Work on the assigned task, use available Slock tools when needed, and post a concise result to the source channel or thread.',
                CAST(:general_tool_policy AS JSONB),
                CAST(:general_skill_policy AS JSONB),
                CAST(:general_memory_policy AS JSONB),
                CAST(:general_output_policy AS JSONB),
                CAST(:general_runtime_policy AS JSONB),
                CAST(:general_start_policy AS JSONB),
                CAST(:general_role_presets AS JSONB),
                'builtin',
                'active',
                now(),
                now()
            ),
            (
                '22222222-2222-4222-8222-222222222222',
                'research-analyst',
                'Research Analyst',
                'Researches a task and writes durable notes plus a concise channel result.',
                'research',
                'Research the assigned objective, cite useful evidence, write task memory when appropriate, and report a concise result.',
                CAST(:research_tool_policy AS JSONB),
                CAST(:research_skill_policy AS JSONB),
                CAST(:research_memory_policy AS JSONB),
                CAST(:research_output_policy AS JSONB),
                CAST(:research_runtime_policy AS JSONB),
                CAST(:research_start_policy AS JSONB),
                CAST(:research_role_presets AS JSONB),
                'builtin',
                'active',
                now(),
                now()
            )
            ON CONFLICT (slug)
            WHERE visibility = 'builtin' AND server_id IS NULL
            DO NOTHING
        """), {
            "general_tool_policy": json.dumps({"allowedToolGroups": ["slock", "read", "shell"], "writeSlockCommands": True}),
            "general_skill_policy": json.dumps({"allowAdditionalSkills": True}),
            "general_memory_policy": json.dumps({
                "readScopes": ["channel", "thread", "task"],
                "writeScopes": ["task"],
                "summaryOnCompletion": True,
                "suggestSummaryAtContextRatio": 0.85,
            }),
            "general_output_policy": json.dumps({
                "expectedOutputTypes": ["message"],
                "channelMessageRequired": True,
                "multipleOutputsAllowed": True,
            }),
            "general_runtime_policy": json.dumps({"defaultAgentRuntimeAllowed": True, "contextIsolation": "required"}),
            "general_start_policy": json.dumps({"autoStart": True, "executionStrategy": "parallel"}),
            "general_role_presets": json.dumps([{
                "roleKey": "general",
                "displayName": "General Task Runner",
                "purpose": "Complete the assigned task and report the result.",
                "instructionTemplate": "Complete the task using available context and tools.",
                "toolPolicy": {"allowedToolGroups": ["slock", "read", "shell"]},
                "skillPolicy": {"allowAdditionalSkills": True},
                "memoryPolicy": {"readScopes": ["channel", "thread", "task"], "writeScopes": ["task"]},
                "outputPolicy": {"expectedOutputTypes": ["message"], "channelMessageRequired": True},
                "runtimePolicy": {"contextIsolation": "required"},
                "loopPolicy": {"completionPolicy": "single_turn_result"},
                "contextPolicy": {"suggestSummaryAtContextRatio": 0.85},
                "editableFields": ["displayName", "purpose", "instructionTemplate", "outputPolicy"],
            }]),
            "research_tool_policy": json.dumps({"allowedToolGroups": ["slock", "read", "web"], "writeSlockCommands": True}),
            "research_skill_policy": json.dumps({"requiredSkills": ["research"], "allowAdditionalSkills": True}),
            "research_memory_policy": json.dumps({
                "readScopes": ["channel", "thread", "task"],
                "writeScopes": ["task"],
                "summaryOnCompletion": True,
                "suggestSummaryAtContextRatio": 0.85,
            }),
            "research_output_policy": json.dumps({
                "expectedOutputTypes": ["message", "memory"],
                "channelMessageRequired": True,
                "multipleOutputsAllowed": True,
            }),
            "research_runtime_policy": json.dumps({"defaultAgentRuntimeAllowed": True, "contextIsolation": "required"}),
            "research_start_policy": json.dumps({"autoStart": True, "executionStrategy": "parallel"}),
            "research_role_presets": json.dumps([{
                "roleKey": "researcher",
                "displayName": "Researcher",
                "purpose": "Collect facts and write sourced notes.",
                "instructionTemplate": "Investigate the task using available context and tools, then write durable notes and a concise result.",
                "toolPolicy": {"allowedToolGroups": ["slock", "read", "web"]},
                "skillPolicy": {"requiredSkills": ["research"], "allowAdditionalSkills": True},
                "memoryPolicy": {"readScopes": ["channel", "thread", "task"], "writeScopes": ["task"]},
                "outputPolicy": {"expectedOutputTypes": ["message", "memory"], "channelMessageRequired": True},
                "runtimePolicy": {"contextIsolation": "required"},
                "loopPolicy": {"completionPolicy": "single_turn_result"},
                "contextPolicy": {"suggestSummaryAtContextRatio": 0.85},
                "editableFields": ["displayName", "purpose", "instructionTemplate", "outputPolicy"],
            }]),
        })

        # ── Data backfill: explicit permissions for legacy agents ──────────
        # Agents created before explicit default-deny permissions existed had
        # no permissions key and implicitly received all known capabilities.
        # Preserve that compatibility by materializing the old effective
        # policy. An explicitly empty map remains empty/default-deny.
        await conn.execute(text("""
            UPDATE members
            SET config = COALESCE(config, '{}'::jsonb)
                || jsonb_build_object('permissions', CAST(:agent_permissions AS JSONB))
            WHERE type = 'agent'
              AND (
                  config IS NULL
                  OR NOT (config ? 'permissions')
                  OR config->'permissions' = 'null'::jsonb
              )
        """), {
            "agent_permissions": json.dumps(DEFAULT_LEGACY_AGENT_PERMISSIONS),
        })

        # ── Data backfill: members.computer_id from legacy config JSON ──────
        await conn.execute(text("""
            UPDATE members AS m
            SET computer_id = (m.config->>'computerId')::uuid
            WHERE m.computer_id IS NULL
              AND m.config ? 'computerId'
              AND (m.config->>'computerId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              AND EXISTS (
                SELECT 1
                FROM computers AS c
                WHERE c.id = (m.config->>'computerId')::uuid
              )
        """))

        # ── Data backfill: members.backend from legacy config JSON ──────────
        await conn.execute(text("""
            UPDATE members
            SET backend = config->>'backend'
            WHERE backend IS NULL
              AND config ? 'backend'
        """))
    print("[DB] Runtime data seeding complete")


async def main():
    await create_tables()


if __name__ == "__main__":
    asyncio.run(main())
