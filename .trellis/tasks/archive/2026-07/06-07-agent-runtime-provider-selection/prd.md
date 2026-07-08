# Agent Runtime Provider Selection

## Goal

Make Create Agent explicitly select the runtime provider/model instead of using a free-text `backend` field that effectively defaults toward Claude. The UI should show configured CC Switch providers when available, but still allow agent creation on machines without `ccs-claude` or CC Switch.

## What I Already Know

* Current Members page has a `Backend` free-text input with placeholder `Claude`.
* `POST /api/v1/members/agents` accepts `runtime`, `runtimeCommand`, `runtimeModel`, and `backend`.
* The backend stores `backend` on `Member.backend` and in `Member.config.backend`.
* The backend stores `runtime`, `runtime_command`, and `runtime_model` on `AgentWorkspace`.
* Daemon startup supports `--runtime-command`, repeated `--runtime-command-arg`, and `--runtime-model`.
* On this machine, `/Users/lee/.local/bin/ccs-claude list` exists and outputs configured providers:
  * `42` / `deepseek-v4-pro`
  * `DeepSeek` / `glm-5.1`
  * `Kimi` / `kimi-for-coding`
  * `MiniMax` / `MiniMax-M3`
  * `Zhipu GLM` / `glm-5.1`
  * `cc` / `claude-sonnet-4-6`
* Windows or other computers may not have `ccs-claude` or CC Switch configured; agent creation must still work.

## Assumptions

* The frontend should not shell out directly.
* Provider discovery should be backend-side or daemon-side because it needs local machine access.
* The first version can discover providers from the machine running the backend/dev server.
* Missing provider discovery should degrade to manual/default options, not block creation.
* The selected provider should be persisted as structured runtime metadata, not only a display string.

## Open Questions

* Should provider discovery be tied to the backend host for now, or should it be reported by each connected daemon/computer?

## Requirements

* Replace Create Agent's free-text `Backend` input with a selector that can show configured providers.
* Include provider label and default model in the selection.
* Persist selection into agent/workspace fields:
  * display provider label (`backend`)
  * executable command (`runtimeCommand`) when known
  * model (`runtimeModel`) when known
* If no `ccs-claude` / CC Switch providers exist, show a safe fallback that still allows creation.
* Make the fallback explicit in UI so users know provider discovery is unavailable.
* Do not require Windows machines to have `ccs-claude`.
* Keep the design forward-compatible with per-computer provider discovery from daemon heartbeat/registration.

## Candidate Design

### Option A: Backend-local provider discovery for MVP

Add a public management API such as `GET /api/v1/runtime-providers`.

The backend:
* Checks `ccs-claude` in PATH and `/Users/lee/.local/bin/ccs-claude` where applicable.
* Runs `ccs-claude list`.
* Parses rows into provider options.
* Returns fallback options when command/config is missing.

Create Agent UI:
* Fetches providers.
* Renders a select.
* Submits `backend`, `runtimeCommand`, and `runtimeModel`.

Pros:
* Fastest to implement.
* Works for local dev immediately.
* Does not require daemon protocol changes.

Cons:
* Represents backend host providers, not necessarily the selected computer's providers.
* Less correct once backend controls multiple remote computers.

### Option B: Daemon-reported provider discovery

Daemon detects local `ccs-claude` providers and includes them in computer registration/heartbeat metadata.

Create Agent UI:
* Shows provider options scoped to the selected computer.
* Falls back when selected computer has no provider list.

Pros:
* Correct for multi-computer.
* Windows/macOS differences naturally attach to each computer.

Cons:
* Requires daemon protocol/model changes.
* More implementation surface.

## Recommendation

Implement Option A now, with payload/schema shaped so Option B can reuse it later. Treat provider `source` as `backend-local` or `fallback` now, and later allow `computer:<id>`.

## Future Follow-Up: Per-Computer Provider Discovery

After the local/backend-discovery MVP, add runtime provider discovery to the daemon lifecycle:

* Daemon probes local runtime providers on its own computer:
  * `ccs-claude list` when available.
  * fallback/default Claude Code availability when `claude` exists.
  * no provider list when neither is installed.
* Daemon includes structured provider options in `/internal/agent-api/daemon/connect`, `/daemon/register`, or `/daemon/heartbeat`.
* Backend stores provider options on the computer or runtime metadata, scoped by `computerId`.
* Create Agent UI filters provider options by the selected Computer.
* If the selected Computer has no reported providers, UI shows fallback/manual creation and explains that runtime discovery is unavailable for that computer.
* Windows machines without `ccs-claude` remain valid connected computers; they simply report no CC Switch providers until a supported launcher exists.
* Provider option schema should remain compatible with the MVP:
  * `label`
  * `provider`
  * `model`
  * `runtime`
  * `runtimeCommand`
  * `runtimeCommandArgs`
  * `source`
  * optional `computerId`

## Acceptance Criteria

* [ ] Create Agent UI uses a select for runtime provider/model instead of free-text `Backend`.
* [ ] When `ccs-claude list` works, configured providers appear in the select.
* [ ] Selecting `Zhipu GLM / glm-5.1` submits and persists `backend="Zhipu GLM"`, `runtimeCommand="ccs-claude"`, and `runtimeModel="glm-5.1"` or equivalent command metadata.
* [ ] When providers are unavailable, UI shows fallback options and still allows agent creation.
* [ ] Existing Create Agent API continues to accept manual/fallback creation.
* [ ] Lint/typecheck pass for changed frontend/backend code.

## Out Of Scope

* Installing CC Switch or `ccs-claude`.
* Windows implementation of `ccs-claude`.
* Automatically starting the selected runtime after Create Agent.
* Full per-computer provider discovery unless chosen explicitly.

## Technical Notes

* Likely files:
  * `frontend/app/members/page.tsx`
  * `frontend/lib/control-plane.ts`
  * `backend/routers/public_api.py`
* Existing `ccs-claude list` output is a fixed-width table with current marker, name, id, model, haiku, sonnet, opus.
