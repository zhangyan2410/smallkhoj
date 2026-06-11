"""Database init: create and upgrade tables only."""

import asyncio

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
