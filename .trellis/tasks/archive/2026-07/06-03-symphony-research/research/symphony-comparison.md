# Research: OpenAI Symphony vs Our Agent Delegation Control Plane

- **Query**: Thorough comparison of OpenAI Symphony (codex orchestration framework) with our Slock control plane implementation
- **Scope**: Mixed (external Symphony repo + spec, internal codebase analysis)
- **Date**: 2026-06-03

## Findings

### Source Files

| Source | Location | Description |
|---|---|---|
| Symphony SPEC.md | https://github.com/openai/symphony/blob/main/SPEC.md | Language-agnostic orchestration spec (~1500+ lines, 16 sections) |
| Symphony Elixir README | https://github.com/openai/symphony/blob/main/elixir/README.md | Reference implementation setup |
| `backend/models/slock.py` | Our data models (Server, Member, Computer, AgentWorkspace, Task, EventRecord, etc.) |
| `backend/routers/agent_api.py` | Worker-facing API (2609 lines) |
| `backend/routers/public_api.py` | Supervisor-facing API (786 lines) |
| `agent/daemon/aaa-daemon/src/proxy/agent-proxy.ts` | Local HTTP proxy with freshness hold and event buffering |
| `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts` | Claude Code runtime driver (spawn, stdin/stdout streaming, session tracking) |
| `agent/daemon/aaa-daemon/src/slock-cli.ts` | Worker CLI for communicating through proxy |
| `.trellis/tasks/06-02-agent-delegation-control-plane/prd.md` | Full PRD with 122 acceptance criteria |

---

## Architecture Comparison Table

| Dimension | Symphony (OpenAI) | Our System (Slock Control Plane) |
|---|---|---|
| **Core purpose** | Long-running daemon that polls issue tracker, spawns coding agents per issue, manages concurrency/retries | Multi-agent collaboration platform with supervisor control plane, worker daemons, channels, tasks, events, reminders |
| **Orchestration model** | Single orchestrator process; poll-based scheduling; in-memory state; no persistent DB required | FastAPI backend with PostgreSQL; dual API surface (worker + supervisor); persistent event sourcing |
| **Task source** | External issue tracker (Linear) via GraphQL polling | Internal task model (Tasks table) created by supervisor via public API; channel-based routing |
| **Agent lifecycle** | Per-issue workspace + coding-agent subprocess (Codex app-server); agent runs until issue done or timeout | Per-computer AgentWorkspace with daemon-managed runtime (Claude Code in stream-json mode); session resume; daemon proxy layer |
| **Workspace model** | Filesystem-per-issue: `<workspace.root>/<sanitized-issue-id>`; hooks for after_create, before_run, after_run, before_remove | AgentWorkspace row in DB with runtime, cwd, pid, sessionId; daemon manages workspace directory; `.slock/slock` CLI wrapper |
| **Concurrency control** | `max_concurrent_agents` (default 10) + `max_concurrent_agents_by_state`; claimed set prevents double-dispatch | No explicit concurrency limiter yet; relies on supervisor judgment and natural backpressure from task assignment |
| **Retry / failure recovery** | Exponential backoff with configurable max; stall detection; continuation retries after clean exit (1s); reconciliation loop | No built-in retry/backoff mechanism; tasks have status transitions but no automatic retry scheduling |
| **Communication pattern** | Orchestrator -> Codex app-server (stdio protocol); agent uses tools to write back to tracker; no direct agent-to-agent | Worker polls `/events` (JSON or SSE) -> daemon proxy buffers -> injects into Claude stdin as user messages; agents communicate via channels/DMs/threads |
| **Event model** | Agent emits events to orchestrator callback (session_started, turn_completed, turn_failed, etc.); in-memory only | Append-only `event_records` table with global monotonic seq; typed events (message_received, task_created, task_claimed, etc.); JSON polling + SSE streaming |
| **State machine** | Unclaimed -> Claimed -> Running -> RetryQueued -> Released; run attempt phases (PreparingWorkspace through Succeeded/Failed/TimedOut/Stalled) | Task status: todo -> in_progress -> in_review -> done/blocked; workspace status: stopped/running/idle |
| **Configuration** | `WORKFLOW.md` with YAML front matter + Markdown prompt body; hot-reload on file change; env var indirection | Database-driven config (member.config.permissions/actions); seed data for local dev; CLI flags for daemon startup |
| **Safety / sandbox** | Workspace path validation (must be under root); sanitized workspace keys; configurable Codex approval_policy and thread_sandbox; hook timeouts | Freshness hold (proxy blocks sends when pending messages exist); permission gates (sendMessage, createTask, etc.); token-based auth with hash verification |
| **Observability** | Structured logs + optional HTTP dashboard (Phoenix LiveView) + JSON API (`/api/v1/state`, `/api/v1/<issue>`, `/api/v1/refresh`) | ActivityLog table; frontend `/daemon` dashboard; `/api/v1/computers`, `/api/v1/activity`, etc. |
| **Implementation language** | Elixir/OTP (reference implementation); spec is language-agnostic | Python (FastAPI backend) + TypeScript (daemon/proxy) + Next.js (frontend) |
| **Persistence** | In-memory scheduler state; filesystem workspaces; no DB | PostgreSQL with SQLAlchemy ORM; full relational model; event sourcing |

---

## What They Do Better (Adopt)

### 1. Structured Retry with Exponential Backoff
Symphony has a precise retry model: failure-driven retries use `min(10000 * 2^(attempt-1), max_retry_backoff_ms)`, continuation retries use 1s fixed delay, and retry entries track attempt count, due_at, error reason, and timer handles. Our system has no automatic retry mechanism at all -- if a worker fails, the task stays in its last status and requires manual supervisor intervention.

**Recommendation**: Add a retry/backoff subsystem to the backend. Track attempt count on tasks or a separate run_attempts table. Implement configurable max_retry_backoff and auto-requeue.

### 2. Workspace Lifecycle Hooks
Symphony defines four hook points (after_create, before_run, after_run, before_remove) with timeout enforcement and clear failure semantics (after_create failure is fatal to workspace creation, after_run failure is logged but ignored). This makes workspace bootstrapping (git clone, dependency install, code generation) declarative and in-repo.

**Recommendation**: Add workspace hooks to AgentWorkspace -- at minimum `before_start` and `after_stop`. Store them in workspace config or a WORKFLOW.md equivalent. Enforce timeouts.

### 3. Stall Detection
Symphony tracks `last_codex_timestamp` per running session and terminates workers that exceed `stall_timeout_ms` (default 5 minutes). This prevents zombie workers from holding slots forever.

**Recommendation**: Add a stall detector that runs on a periodic tick, checks workspace `started_at` vs last activity timestamp, and auto-terminates stale workspaces.

### 4. Turn-Level Concurrency Limits
Symphony supports `max_concurrent_agents_by_state` -- per-state concurrency caps (e.g., max 3 issues in "In Progress" at once). This is more granular than a single global limit.

**Recommendation**: Extend task dispatch with configurable per-status concurrency limits.

### 5. In-Repo Workflow Contract (WORKFLOW.md)
Symphony's `WORKFLOW.md` is version-controlled with the codebase, supports hot-reload, and is self-contained (prompt + runtime config + hooks). This means the "how should agents work on this repo" policy travels with the repo.

**Recommendation**: Consider a `.slock/WORKFLOW.md` or equivalent that defines agent behavior, permissions, and hooks per-project, versioned in git.

### 6. Hot Configuration Reload
Symphony MUST detect WORKFLOW.md changes and re-apply config without restart. Invalid reloads MUST NOT crash the service. This is critical for production operation.

**Recommendation**: Implement a file watcher or polling mechanism for workflow config, with validation-before-apply semantics.

### 7. Codex App-Server Protocol Integration
Symphony speaks the Codex app-server protocol natively (session management, thread lifecycle, turn streaming, approval policy injection). Our system uses Claude Code's stream-json mode via stdin/stdout, which works but is lower-level and more brittle.

**Recommendation**: If migrating to Codex-style app-server mode becomes viable, adopt the app-server protocol for tighter session lifecycle control.

---

## What We Do Better (Preserve)

### 1. Persistent Event Sourcing with Append-Only Event Log
Our `event_records` table provides a global monotonic sequence number, typed events, and JSON payloads. This is fundamentally more robust than Symphony's in-memory-only state. Workers can replay events after disconnection, the supervisor has full audit history, and the system survives restarts without losing state.

### 2. Rich Multi-Agent Communication Model
We have channels (public, private, DM), threads/replies, message reactions, and channel membership -- essentially a full messaging platform for human-agent and agent-agent collaboration. Symphony has no inter-agent communication at all; each agent is an isolated unit talking only to the issue tracker.

### 3. Supervisor Control Plane with Dual API Surface
Our system has a deliberate supervisor-facing API (`/api/v1/*`) separate from the worker-facing API (`/internal/agent-api/*`). The supervisor can create tasks, assign agents, send messages, adjust permissions, manage reminders, and update agent configuration -- all through structured API endpoints. Symphony's "supervisor" is the issue tracker itself, which is far less flexible.

### 4. Token-Based Authentication with Hash Verification
Our `api_keys` table with `token_hash` and resource-type-scoped keys (agent vs computer) provides real authentication. Symphony relies on environment variables and trusts the local environment.

### 5. Permission System
Our `member.config.permissions` allows fine-grained control over what each agent can do (sendMessage, createTask, claimTask, fileWrite, etc.). Symphony has no equivalent -- its approval policy is binary and process-wide.

### 6. Local Proxy with Freshness Hold
Our daemon proxy buffers events and enforces a "freshness hold" -- blocking worker sends when there are unread incoming messages. This prevents race conditions where a worker responds to stale context. Symphony has no equivalent mechanism; it assumes the agent always has current context.

### 7. Reminder System with Scheduled Firing
Our reminders can be scheduled, fire as channel messages, and support repeating intervals. This enables time-based workflows (e.g., "check back in 2 hours"). Symphony has no equivalent.

### 8. Multi-Computer / Multi-Workspace Fleet Management
Our model supports multiple computers, each with multiple agent workspaces, registered via daemon lifecycle API with heartbeats. Symphony runs on a single machine and dispatches to local workspaces only (with optional SSH workers in the Elixir implementation).

### 9. File/Attachment Management
We have a full file upload/download/attachment system tied to channels and messages. Symphony has no file management -- agents work in filesystem workspaces but there is no structured file sharing.

### 10. SSE Real-Time Streaming
Our backend supports both JSON polling and SSE streaming for events, allowing workers to receive near-real-time notifications without constant HTTP requests. Symphony's communication is strictly request-response between orchestrator and agent.

---

## Common Patterns (Independent Convergence)

### 1. Per-Task Workspace Isolation
Both systems create isolated directories per work unit. Symphony uses `<workspace.root>/<sanitized-issue-id>`, we use the AgentWorkspace's `cwd` field. Both ensure agent commands run only inside the workspace.

### 2. Task Status Lifecycle
Both track task/issue status through discrete states. Symphony: Unclaimed -> Claimed -> Running -> Released. Ours: todo -> in_progress -> in_review -> done/blocked. Both support task cancellation and state-based filtering.

### 3. Agent Subprocess Management
Both spawn coding agents as child processes with stdin/stdout communication. Both track session IDs. Both handle process exit (normal and abnormal).

### 4. Concurrency-Aware Dispatch
Both limit how many agents can run simultaneously. Symphony has explicit `max_concurrent_agents` with per-state overrides. We rely on supervisor judgment but the concept is the same.

### 5. Structured Observability
Both emit structured events/logs for debugging. Symphony uses Elixir Logger with `key=value` phrasing. We use ActivityLog + EventRecord with JSON payloads.

### 6. Supervisor/Automator Boundary
Both draw a clear line: the orchestrator schedules and monitors, but does not write tickets/code directly. Symphony: "Ticket writes are performed by the coding agent." Ours: "Supervisor creates tasks, worker executes them."

---

## Gap Analysis (Blind Spots Revealed)

### 1. No Automatic Retry/Recovery
**Our gap**: If a worker crashes or a task times out, nothing happens automatically. The task sits in its current status until a human intervenes. Symphony's retry queue with exponential backoff is a critical production feature we lack.

### 2. No Workspace Bootstrapping Hooks
**Our gap**: When a new workspace is created, there is no automated setup (git clone, dependency install, etc.). Symphony's hooks make this declarative and reproducible.

### 3. No Turn-Level Timeout
**Our gap**: We have no concept of "turn timeout" -- a worker can run indefinitely without producing output. Symphony enforces `turn_timeout_ms` (default 1 hour) and `stall_timeout_ms` (default 5 min).

### 4. No Token/Rate-Limit Accounting
**Our gap**: We do not track token consumption or rate limits from the LLM provider. Symphony tracks input_tokens, output_tokens, total_tokens, and rate_limits per session and in aggregate.

### 5. No Hot Configuration Reload
**Our gap**: Config changes (permissions, agent settings) require direct API calls or database updates. There is no file-based, hot-reloadable configuration mechanism.

### 6. No Explicit Workspace Safety Invariants
**Our gap**: We do not validate that workspace paths stay within an expected root directory. Symphony has three mandatory safety invariants: (1) agent runs only in workspace path, (2) workspace path must be under root, (3) workspace key is sanitized.

### 7. No Prompt Template System
**Our gap**: Task descriptions are freeform. Symphony uses a template engine (Liquid-compatible) with issue variables, making prompts deterministic and reproducible.

### 8. No Startup Recovery/Reconciliation
**Our gap**: After a backend restart, there is no automatic reconciliation of in-flight workspaces/tasks. Symphony performs terminal workspace cleanup and re-polls active issues on every restart.

### 9. No SSH/Remote Worker Support
**Our gap**: Our daemon runs locally. Symphony's Elixir implementation supports SSH worker dispatch, enabling distributed execution across multiple machines. (We have the data model for multi-computer but not the remote execution transport.)

### 10. No Graceful Workspace Cleanup
**Our gap**: When a task completes or is cancelled, we do not clean up the workspace directory. Symphony cleans terminal workspaces both during reconciliation and at startup.

---

## Specific Recommendations (Prioritized)

### P0 -- Critical for Production Use

1. **Add retry/backoff mechanism** (Section 7.2-7.4 equivalent)
   - Add `run_attempts` table or `attempt_count`/`last_error` fields to Task
   - Implement exponential backoff: `min(10s * 2^(attempt-1), max_backoff)`
   - Add configurable `max_retry_backoff_ms` and `max_attempts`
   - Auto-requeue failed tasks with backoff timer

2. **Add turn-level timeouts and stall detection** (Section 10.6 equivalent)
   - Track `last_activity_at` on AgentWorkspace
   - Periodic tick checks elapsed time since last activity
   - Auto-terminate stale workspaces (configurable threshold, e.g., 5 min stall, 1 hour hard timeout)
   - Emit `workspace_stalled` / `workspace_timed_out` events

3. **Add workspace safety invariants** (Section 9.5 equivalent)
   - Validate workspace cwd is under configured root
   - Sanitize workspace directory names
   - Enforce agent process cwd matches workspace path

### P1 -- Important for Reliability

4. **Add workspace lifecycle hooks** (Section 9.4 equivalent)
   - `before_start`: run before agent launches (e.g., git pull, npm install)
   - `after_stop`: run after agent exits (e.g., cleanup, artifact collection)
   - Store hooks in workspace config or project WORKFLOW.md
   - Enforce timeout on hooks (default 60s)

5. **Add startup reconciliation** (Section 8.5-8.6 equivalent)
   - On backend startup, scan workspaces with status "running"
   - Check if daemon is still connected via heartbeat
   - Mark orphaned workspaces as "stopped"
   - Clean up stale workspace directories for terminal tasks

6. **Add token/rate-limit tracking** (Section 13.5 equivalent)
   - Parse token usage from Claude/Codex stream events
   - Store per-session and aggregate totals in AgentWorkspace and ActivityLog
   - Expose via `/api/v1/computers` and dashboard

### P2 -- Nice to Have / Polish

7. **Add prompt template system** (Section 12 equivalent)
   - Support Liquid-like templates for task descriptions
   - Auto-populate with issue metadata (title, description, labels, priority)
   - Store template in project WORKFLOW.md or workspace config

8. **Add hot-reloadable workflow config** (Section 6.2 equivalent)
   - Support `.slock/WORKFLOW.md` with YAML front matter
   - File watcher detects changes, validates, applies without restart
   - Invalid config does not crash the service

9. **Add per-status concurrency limits** (Section 8.3 equivalent)
   - Configurable `max_concurrent_by_status` (e.g., max 3 in "in_progress")
   - Enforce during task dispatch

10. **Add workspace cleanup on task completion** (Section 8.6 equivalent)
    - Auto-clean workspace directory when task reaches terminal state
    - Optional `before_remove` hook
    - Configurable retention policy (keep last N workspaces)

---

## Symphony's Design Philosophy (from README and SPEC)

1. **"Manage work, not agents"**: Teams should focus on the issue tracker board, not on supervising individual coding agent sessions.
2. **In-repo policy**: WORKFLOW.md lives in the repository, so agent behavior is version-controlled alongside the code.
3. **Language-agnostic spec**: The SPEC.md is intentionally implementation-neutral. OpenAI encourages teams to implement Symphony in any language.
4. **Trusted environment first**: The default posture is high-trust (auto-approve, no sandbox). Security hardening is deployment-specific.
5. **No persistent DB needed**: In-memory state + filesystem workspaces + tracker API = full recovery. This simplifies deployment.
6. **Single orchestrator authority**: One process owns all scheduling decisions, avoiding distributed coordination complexity.

## Key Differences in Philosophy

| Aspect | Symphony | Our System |
|---|---|---|
| **State persistence** | Intentionally in-memory; tracker is source of truth | Persistent PostgreSQL; we are the source of truth |
| **Communication richness** | Minimal; agent talks only to tracker | Rich; channels, DMs, threads, reactions, reminders |
| **Human interaction** | Humans work in the issue tracker; Symphony is invisible | Humans use the control plane dashboard directly |
| **Agent autonomy** | Agent runs independently until done or stuck | Agent is continuously supervised and can be redirected |
| **Scope** | Narrowly focused: poll tracker, spawn agent, track completion | Broad: multi-agent collaboration platform with task management |

## Caveats / Not Found

- The Symphony SPEC.md was truncated at section 16.1 (Service Startup algorithms). Sections 16.2+ were not retrieved due to proxy/network limitations accessing raw.githubusercontent.com. The first 15 sections plus the start of 16 were sufficient for this analysis.
- The OpenAI announcement blog (https://openai.com/index/open-source-codex-orchestration-symphony/) returned 403 from defuddle. Analysis is based on the GitHub README and SPEC.md only.
- The harness engineering blog referenced by Symphony also returned 403.
- Our system's PRD lists 122 acceptance criteria, all checked off. The "Current Gaps" section of the PRD aligns with several gaps identified in this comparison, confirming the analysis direction.
