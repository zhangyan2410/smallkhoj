# P1: Computer Entity + Unified Member Model

## Goal

Bring the existing Computer/AgentWorkspace implementation into alignment with the finalized Slock design: members are a unified human+agent model, agent-specific computer/backend data is queryable as explicit member columns, daemon registration keeps those columns in sync, and the frontend exposes standalone Computers and Members views.

## Source Of Truth

- `zy-think/design/slock-design-spec.md` section 1.2 and 1.3
- Existing P1 task notes in `task.md`
- Current backend already has first-pass Computer, AgentWorkspace, machine token registration, and public list APIs from the control-plane work

## Requirements

- Add explicit agent columns on `members`:
  - `computer_id UUID REFERENCES computers(id) ON DELETE SET NULL`
  - `backend VARCHAR(40)`
- Keep backward compatibility with existing `member.config.computerId`, `member.config.workspaceId`, and `member.config.backend` while shifting serializers/auth to prefer explicit columns.
- Backfill or initialize these columns during table creation/seed for existing local databases.
- Daemon registration and heartbeat workspace upsert must keep `member.computer_id` and `member.backend` synchronized with the registered workspace.
- `resolve_agent` must accept a machine token for agents bound through the explicit `members.computer_id` column, with config fallback for older rows.
- Public and agent-facing member serializers must include `computerId`, `workspaceId`, and `backend` for agents.
- Add standalone frontend routes:
  - `/computers` shows registered computers, detected runtimes, heartbeat/status, and linked agent workspaces.
  - `/members` shows unified human + agent members, profile fields, status, skills, backend, and computer binding.
- Keep existing `/daemon` dashboard working.

## Non-Goals

- Do not implement token rotation, production secret issuance, or permissions enforcement changes.
- Do not add a full member profile editor.
- Do not redesign the existing dashboard.
- Do not implement P2 thread/file/reminder UI.

## Acceptance Criteria

- [ ] Fresh DB creation includes `members.computer_id` and `members.backend`.
- [ ] Existing DB startup adds missing member columns without manual migration.
- [ ] Local seed/backfill sets aaa/deepseek agent computer/backend columns.
- [ ] `POST /internal/agent-api/daemon/register` updates member computer/backend columns for registered workspaces.
- [ ] `GET /api/v1/members` returns unified human+agent list with `computerId`, `workspaceId`, and `backend`.
- [ ] `GET /api/v1/computers` still returns computers with `agentWorkspaces`.
- [ ] `/computers` renders computer cards and workspace rows from public API data.
- [ ] `/members` renders both humans and agents with agent metadata.
- [ ] Backend syntax checks pass.
- [ ] Frontend lint/build pass, or any environment blocker is documented.
