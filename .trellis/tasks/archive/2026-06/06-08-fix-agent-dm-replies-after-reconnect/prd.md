# Fix Agent DM Replies After Daemon Reconnect

## Problem

After the previous daemon was stopped and a daemon was reconnected, newly created thread/DM UI shows agents such as `glm2` and `glm3` online, but direct messages to those agents do not receive replies.

The bug may be in one of two areas:

- Runtime lifecycle: backend marks workspaces or members online/running even though the daemon did not start the runtime after reconnect.
- Thread/DM routing: direct messages created after the thread work are persisted but not delivered to the target agent runtime.

## Goals

- Identify whether DM messages reach the daemon/runtime after reconnect.
- Fix the root cause so DM messages to an online agent launch or reach that agent runtime.
- Separate Computers page flows for connecting a new computer and reconnecting an existing computer.
- Keep thread behavior single-level and preserve existing channel/DM contracts.
- Add regression coverage for private agent chat after daemon reconnect/runtime startup.

## Non-Goals

- Redesign the full daemon connection model.
- Change user-facing DM target naming beyond existing contracts.
- Require a real Claude/GLM provider in automated tests; fake runtime coverage is enough.

## Acceptance Criteria

- Backend only reports runtime/workspace state in a way that matches the daemon/runtime lifecycle.
- A human DM to an agent is delivered to the correct target runtime after daemon reconnect/control startup.
- Computers page exposes a distinct reconnect command for existing computers instead of overloading the new-computer form.
- Existing channel message delivery tests keep passing.
- E2E or integration coverage exercises the DM path, not only public API message rendering.
