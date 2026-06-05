# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

<!--
Document your project's database conventions here.

Questions to answer:
- What ORM/query library do you use?
- How are migrations managed?
- What are the naming conventions for tables/columns?
- How do you handle transactions?
-->

(To be filled by the team)

---

## Query Patterns

<!-- How should queries be written? Batch operations? -->

(To be filled by the team)

---

## Migrations

<!-- How to create and run migrations -->

## Scenario: Computer Binding Columns On Members

### 1. Scope / Trigger
- Trigger: P1 unified Member model stores agent computer/runtime bindings in explicit DB columns while keeping older config payloads readable.

### 2. Signatures
- `members.computer_id UUID REFERENCES computers(id) ON DELETE SET NULL`
- `members.backend VARCHAR(40)`
- Compatibility config keys: `config.computerId`, `config.workspaceId`, `config.backend`
- Binding table: `agent_workspaces(agent_id, computer_id, runtime, updated_at)`

### 3. Contracts
- Explicit columns are the source of truth for query/auth paths.
- Serializers still emit `computerId`, `workspaceId`, and `backend` for agents.
- Startup table creation must use `ADD COLUMN IF NOT EXISTS` for local existing DBs.
- Seed/backfill must keep local `aaa` and `deepseek` rows populated in both explicit columns and compatibility config keys.

### 4. Validation & Error Matrix
- Missing `members.computer_id` on an old DB -> startup adds it.
- Missing `members.backend` on an old DB -> startup adds it.
- Existing row only has `config.computerId` -> startup backfills `members.computer_id` when the UUID references a real computer.
- Existing row only has `config.backend` -> startup backfills `members.backend`.

### 5. Good/Base/Bad Cases
- Good: agent API auth validates a machine token through `members.computer_id` and serializers return `computerId`, `workspaceId`, and `backend`.
- Base: old rows with config-only bindings continue to serialize and authenticate through fallback paths.
- Bad: writing only `config.workspaceId` without an `agent_workspaces` row, because query/auth paths cannot join or filter reliably.

### 6. Tests Required
- Assert DB startup exposes `members.computer_id` and `members.backend`.
- Assert seeded agents have explicit `computer_id/backend` and compatibility `config.workspaceId`.
- Assert `/api/v1/members`, `/api/v1/computers`, `/internal/agent-api/profile`, and `/internal/agent-api/channel-members` return agent binding fields.
- Assert machine-token auth works for an agent bound through `members.computer_id`.

### 7. Wrong vs Correct
#### Wrong
Only read or write agent computer binding through `member.config`.

#### Correct
Write `members.computer_id` and `members.backend` first, keep `config.computerId`, `config.workspaceId`, and `config.backend` synchronized for old clients.

---

## Naming Conventions

<!-- Table names, column names, index names -->

(To be filled by the team)

---

## Common Mistakes

<!-- Database-related mistakes your team has made -->

(To be filled by the team)
