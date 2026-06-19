# Agent Context Inspector Design Notes

## Shape

Introduce a `ContextManifest` concept:

```text
ContextManifest
  runId / sessionId / agentId / workspaceId
  runtime: claude_code | codex_cli
  phase: startup | first_turn | followup_turn | resume
  capturedAt
  blocks[]
  usage
  prefixAnalysis
```

Each block:

```text
id
title
source: trellis_hook | slock_system_prompt | daemon_delivery | runtime_session_jsonl | codex_project_instruction | inferred
stability: stable_prefix | session_stable | task_variable | message_variable | runtime_generated
order
bytes
tokenEstimate?
hash
preview
masked
rawRef?
```

## Capture Sources

Claude Code:

- Daemon-generated Slock system prompt from `buildSlockSystemPrompt`.
- Runtime user messages sent by `ClaudeRuntimeDriver.writeUserMessage`.
- Claude stream-json events emitted by the runtime.
- Claude session JSONL usage under `.claude/projects/<project>/<sessionId>.jsonl`.

Codex:

- Project instruction files: `AGENTS.md`, `CLAUDE.md` where applicable, `.codex/config.toml`.
- Codex SessionStart hook output from `.codex/hooks/session-start.py`.
- Codex session/log files if accessible from local Codex state.
- Later daemon Codex runtime driver once implemented.

## Cache-Prefix Analysis

For each adjacent turn pair:

1. Build ordered block list.
2. Compare block hashes in order.
3. Mark the first changed block as the prefix boundary.
4. Report stable prefix bytes/tokens before that boundary.
5. Report changed bytes/tokens after that boundary.

This gives the operator a simple view of prompt-cache friendliness without pretending to know every provider's exact cache internals.

## UI/CLI Surface

MVP can start as a CLI/API endpoint:

```text
GET /api/v1/agents/{agentId}/context-manifests
GET /api/v1/context-manifests/{manifestId}
GET /api/v1/context-manifests/{a}/diff/{b}
```

Frontend panel later:

- Agent detail -> Runtime Session -> Context tab.
- Blocks table: order, title, source, stability, bytes, tokens, changed.
- Side panel for preview/exact content.
- Diff mode between startup/first/follow-up turns.

## Security

- Mask credentials, bearer tokens, `sk_*`, `.env`-like lines, and token files.
- Store hashes/previews by default.
- Raw content view is explicit and local/operator-only.

## Key Trade-Off

Direct observation is preferred over inferred reconstruction. Where runtime internals are not observable, label the block `inferred` and show the source basis.
