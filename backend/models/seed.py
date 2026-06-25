"""Database init: create and upgrade tables only."""

import asyncio
import json

from sqlalchemy import text

from models import Base, engine


async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64)"))
        await conn.execute(text("ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP WITH TIME ZONE"))
        await conn.execute(text("ALTER TABLE computers ADD COLUMN IF NOT EXISTS machine_id VARCHAR(80)"))
        await conn.execute(text("ALTER TABLE computers ADD COLUMN IF NOT EXISTS active_daemon_id VARCHAR(80)"))
        await conn.execute(text("ALTER TABLE computers ADD COLUMN IF NOT EXISTS daemon_lease_expires_at TIMESTAMP WITH TIME ZONE"))
        await conn.execute(text(
            "ALTER TABLE members "
            "ADD COLUMN IF NOT EXISTS computer_id UUID REFERENCES computers(id) ON DELETE SET NULL"
        ))
        await conn.execute(text("ALTER TABLE members ADD COLUMN IF NOT EXISTS backend VARCHAR(40)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_members_computer ON members(computer_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_computers_server_machine ON computers(server_id, machine_id)"))
        await conn.execute(text("""
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1
                FROM computers
                WHERE machine_id IS NOT NULL
                GROUP BY server_id, machine_id
                HAVING count(*) > 1
              ) THEN
                CREATE UNIQUE INDEX IF NOT EXISTS uq_computers_server_machine
                ON computers(server_id, machine_id)
                WHERE machine_id IS NOT NULL;
              END IF;
            END $$;
        """))
        await conn.execute(text("""
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM computers GROUP BY server_id, name HAVING count(*) > 1
              ) THEN
                CREATE UNIQUE INDEX IF NOT EXISTS uq_computers_server_name
                ON computers(server_id, name);
              END IF;
            END $$;
        """))
        await conn.execute(text("""
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM members GROUP BY server_id, display_name HAVING count(*) > 1
              ) THEN
                CREATE UNIQUE INDEX IF NOT EXISTS uq_members_server_display_name
                ON members(server_id, display_name);
              END IF;
            END $$;
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS accounts (
                id UUID PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                display_name VARCHAR(255),
                server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
                member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                session_token_hash VARCHAR(64),
                last_login_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
            )
        """))
        await conn.execute(text("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)"))
        await conn.execute(text("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS session_token_hash VARCHAR(64)"))
        await conn.execute(text("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE"))
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_name ON accounts(name)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_accounts_member ON accounts(member_id)"))
        await conn.execute(text(
            "ALTER TABLE channel_members "
            "ADD COLUMN IF NOT EXISTS last_read_seq BIGINT NOT NULL DEFAULT 0"
        ))
        await conn.execute(text(
            "ALTER TABLE messages "
            "ADD COLUMN IF NOT EXISTS mentions UUID[] NOT NULL DEFAULT '{}'::uuid[]"
        ))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS task_run_templates (
                id UUID PRIMARY KEY,
                slug VARCHAR(120) NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                category VARCHAR(80),
                system_instruction TEXT NOT NULL,
                tool_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
                skill_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
                memory_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
                output_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
                runtime_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
                start_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
                role_presets JSONB NOT NULL DEFAULT '[]'::jsonb,
                visibility VARCHAR(20) NOT NULL DEFAULT 'user',
                status VARCHAR(20) NOT NULL DEFAULT 'active',
                created_by UUID REFERENCES members(id) ON DELETE SET NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT uq_task_run_templates_slug UNIQUE (slug),
                CONSTRAINT ck_task_run_templates_status CHECK (status IN ('active', 'disabled')),
                CONSTRAINT ck_task_run_templates_visibility CHECK (visibility IN ('builtin', 'server', 'user'))
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_task_run_templates_status ON task_run_templates(status)"))
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
            ON CONFLICT (slug) DO NOTHING
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
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS task_assignments (
                id UUID PRIMARY KEY,
                task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                assignee_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                assignee_type VARCHAR(20) NOT NULL DEFAULT 'agent',
                role VARCHAR(80) NOT NULL DEFAULT 'worker',
                role_key VARCHAR(80),
                role_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
                assignment_mode VARCHAR(40) NOT NULL DEFAULT 'task_created',
                status VARCHAR(20) NOT NULL DEFAULT 'active',
                template_id UUID REFERENCES task_run_templates(id) ON DELETE SET NULL,
                template_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
                execution_strategy VARCHAR(40) NOT NULL DEFAULT 'parallel',
                run_order INTEGER,
                created_by UUID REFERENCES members(id) ON DELETE SET NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT ck_task_assignments_assignee_type CHECK (assignee_type IN ('member', 'agent')),
                CONSTRAINT ck_task_assignments_mode CHECK (assignment_mode IN ('leader_designated', 'direct_drag', 'agent_delegated', 'system', 'task_created')),
                CONSTRAINT ck_task_assignments_status CHECK (status IN ('active', 'completed', 'cancelled'))
            )
        """))
        await conn.execute(text("ALTER TABLE task_assignments DROP CONSTRAINT IF EXISTS ck_task_assignments_role"))
        await conn.execute(text("ALTER TABLE task_assignments ALTER COLUMN role TYPE VARCHAR(80)"))
        await conn.execute(text("ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS role_key VARCHAR(80)"))
        await conn.execute(text("ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS role_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb"))
        await conn.execute(text("ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES task_run_templates(id) ON DELETE SET NULL"))
        await conn.execute(text("ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS template_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb"))
        await conn.execute(text("ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS execution_strategy VARCHAR(40) NOT NULL DEFAULT 'parallel'"))
        await conn.execute(text("ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS run_order INTEGER"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_task_assignments_task ON task_assignments(task_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_task_assignments_assignee ON task_assignments(assignee_id, status)"))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS task_runs (
                id UUID PRIMARY KEY,
                task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                assignment_id UUID REFERENCES task_assignments(id) ON DELETE SET NULL,
                agent_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
                thread_root_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
                parent_run_id UUID REFERENCES task_runs(id) ON DELETE SET NULL,
                template_id UUID REFERENCES task_run_templates(id) ON DELETE SET NULL,
                template_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
                role_key VARCHAR(80),
                role_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
                attempt INTEGER NOT NULL DEFAULT 1,
                status VARCHAR(20) NOT NULL DEFAULT 'queued',
                trigger_type VARCHAR(40) NOT NULL DEFAULT 'task_created',
                runtime_workspace_id UUID REFERENCES agent_workspaces(id) ON DELETE SET NULL,
                computer_id UUID REFERENCES computers(id) ON DELETE SET NULL,
                daemon_id VARCHAR(80),
                runtime VARCHAR(40),
                runtime_provider VARCHAR(80),
                runtime_model VARCHAR(120),
                prompt_profile VARCHAR(80) NOT NULL DEFAULT 'task.worker',
                workspace_session_id VARCHAR(255),
                runtime_session_id VARCHAR(255),
                context_session_id VARCHAR(255) NOT NULL,
                cwd TEXT,
                context_scope VARCHAR(20) NOT NULL DEFAULT 'task',
                context_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
                context_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
                token_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
                tool_usage_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
                completion_policy VARCHAR(40) NOT NULL DEFAULT 'single_turn_result',
                output_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
                output_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
                failure_code VARCHAR(80),
                failure_reason TEXT,
                started_at TIMESTAMP WITH TIME ZONE,
                completed_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT ck_task_runs_status CHECK (status IN ('queued', 'dispatched', 'running', 'awaiting_input', 'completed', 'failed', 'cancelled')),
                CONSTRAINT ck_task_runs_context_scope CHECK (context_scope IN ('channel', 'thread', 'task', 'run'))
            )
        """))
        await conn.execute(text("ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES task_run_templates(id) ON DELETE SET NULL"))
        await conn.execute(text("ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS template_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb"))
        await conn.execute(text("ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS role_key VARCHAR(80)"))
        await conn.execute(text("ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS role_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb"))
        await conn.execute(text("ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS completion_policy VARCHAR(40) NOT NULL DEFAULT 'single_turn_result'"))
        await conn.execute(text("ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS output_refs JSONB NOT NULL DEFAULT '[]'::jsonb"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id, created_at)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_task_runs_agent ON task_runs(agent_id, status)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_task_runs_assignment ON task_runs(assignment_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_task_runs_workspace ON task_runs(runtime_workspace_id)"))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS saved_items (
                id UUID PRIMARY KEY,
                server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
                account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                item_type VARCHAR(20) NOT NULL,
                item_id UUID NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT uq_saved_items_account_item UNIQUE (account_id, item_type, item_id)
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_saved_items_account ON saved_items(account_id, created_at)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_saved_items_server ON saved_items(server_id, created_at)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_saved_items_item ON saved_items(item_type, item_id)"))
        await conn.execute(text("ALTER TABLE event_records DROP COLUMN IF EXISTS activity_id"))
        await conn.execute(text("""
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conrelid = 'event_records'::regclass
                  AND contype = 'p'
                  AND conname = 'event_records_pkey'
                  AND pg_get_constraintdef(oid) LIKE 'PRIMARY KEY (seq)%'
              ) THEN
                ALTER TABLE event_records DROP CONSTRAINT event_records_pkey;
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conrelid = 'event_records'::regclass
                  AND contype = 'p'
              ) THEN
                ALTER TABLE event_records ADD PRIMARY KEY (id);
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conrelid = 'event_records'::regclass
                  AND conname = 'uq_event_records_server_seq'
              ) THEN
                ALTER TABLE event_records
                ADD CONSTRAINT uq_event_records_server_seq UNIQUE (server_id, seq);
              END IF;
            END $$;
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_messages_parent "
            "ON messages(parent_id) WHERE parent_id IS NOT NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_event_records_server_seq "
            "ON event_records(server_id, seq)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_event_records_server_channel_seq "
            "ON event_records(server_id, channel_id, seq) WHERE channel_id IS NOT NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_event_records_server_actor_seq "
            "ON event_records(server_id, actor_id, seq) WHERE actor_id IS NOT NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_event_records_server_type_seq "
            "ON event_records(server_id, event_type, seq)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_event_records_created "
            "ON event_records(server_id, created_at DESC)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_event_records_message "
            "ON event_records(message_id) WHERE message_id IS NOT NULL"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_event_records_task "
            "ON event_records(task_id) WHERE task_id IS NOT NULL"
        ))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS memory_entries (
                id UUID PRIMARY KEY,
                server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
                scope_type VARCHAR(20) NOT NULL,
                scope_id UUID NOT NULL,
                path TEXT NOT NULL,
                title TEXT,
                entry_kind VARCHAR(40) NOT NULL DEFAULT 'note',
                content_text TEXT,
                blob_key TEXT,
                file_id UUID REFERENCES files(id) ON DELETE SET NULL,
                mime_type VARCHAR(120),
                size_bytes BIGINT NOT NULL DEFAULT 0,
                content_sha256 VARCHAR(64) NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
                source_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
                source_thread_id UUID REFERENCES messages(id) ON DELETE SET NULL,
                source_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
                source_path TEXT,
                author_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
                visibility VARCHAR(20) NOT NULL DEFAULT 'inherited',
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                deleted_at TIMESTAMP WITH TIME ZONE,
                CONSTRAINT ck_memory_entries_scope_type CHECK (scope_type IN ('agent', 'channel', 'task', 'thread'))
            )
        """))
        await conn.execute(text("ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS entry_kind VARCHAR(40) NOT NULL DEFAULT 'note'"))
        await conn.execute(text("ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS file_id UUID REFERENCES files(id) ON DELETE SET NULL"))
        await conn.execute(text("ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'inherited'"))
        await conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_entries_scope_path_active
            ON memory_entries(server_id, scope_type, scope_id, path)
            WHERE deleted_at IS NULL
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_memory_entries_scope_updated
            ON memory_entries(server_id, scope_type, scope_id, updated_at DESC)
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_memory_entries_source_message
            ON memory_entries(server_id, source_message_id)
            WHERE source_message_id IS NOT NULL
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_memory_entries_source_task
            ON memory_entries(server_id, source_task_id)
            WHERE source_task_id IS NOT NULL
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS memory_proposals (
                id UUID PRIMARY KEY,
                server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
                scope_type VARCHAR(20) NOT NULL,
                scope_id UUID NOT NULL,
                path TEXT NOT NULL,
                base_entry_id UUID REFERENCES memory_entries(id) ON DELETE SET NULL,
                base_sha256 VARCHAR(64),
                proposed_content_text TEXT,
                proposed_blob_key TEXT,
                author_member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                reason TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'open',
                reviewer_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
                review_note TEXT,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                resolved_at TIMESTAMP WITH TIME ZONE,
                CONSTRAINT ck_memory_proposals_scope_type CHECK (scope_type IN ('agent', 'channel', 'task', 'thread')),
                CONSTRAINT ck_memory_proposals_status CHECK (status IN ('open', 'accepted', 'rejected', 'superseded'))
            )
        """))
        await conn.execute(text("ALTER TABLE memory_proposals ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb"))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_memory_proposals_scope_status
            ON memory_proposals(server_id, scope_type, scope_id, status, updated_at DESC)
        """))
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
        await conn.execute(text("""
            UPDATE members
            SET backend = config->>'backend'
            WHERE backend IS NULL
              AND config ? 'backend'
        """))
    print("[DB] Tables ready")


async def main():
    await create_tables()


if __name__ == "__main__":
    asyncio.run(main())
