# Agent Context Inspector

## Goal

Build a product-visible way to inspect and manage what context an agent actually receives, starting with Claude Code and Codex. The core value is not another static project summary; it is an observable context manifest that shows the runtime/session prompt shape, token/size footprint, cache-friendly stable prefix, variable tail, and specific content blocks for a selected agent run.

## User Need

The operator needs to understand and control agent context because SmallKhoj/Trellis is accumulating more injected rules, specs, task files, runtime prompts, and channel/task context. Without a visible inspector, it is unclear what the agent saw at startup, what changed on the first user message, what changed on later turns, and whether context layout is hurting prompt-cache reuse.

## Product Principles

- Stable prefix matters: context that rarely changes should stay at the front and remain byte-stable as much as possible to improve cache hit behavior.
- Runtime reality matters: the inspector should show what Claude Code / Codex actually received or persisted, not only what SmallKhoj intended to send.
- Clear blocks over raw dumps: users should see named sections, sizes, token estimates/usages, source files, and previews, with drill-down for exact content.
- Observation before control: first make startup/first-turn/follow-up context visible; then add tools to tune or pin sections.

## Confirmed Facts From Current Code

- Trellis Codex `SessionStart` hook emits compact session context under `hookSpecificOutput.additionalContext` and reports `systemMessage: Trellis context injected (<chars> chars)`.
- The Codex hook already structures injected context into blocks: `<session-context>`, `<current-state>`, `<trellis-workflow>`, `<guidelines>`, `<task-status>`, and `<ready>`.
- The daemon Claude runtime builds a large Slock system prompt in `buildSlockSystemPrompt(...)`.
- The daemon already captures Claude runtime `sessionId`, runtime stream events, first output, result events, and last-turn token usage.
- Claude token usage is currently read from the real session JSONL under `.claude/projects/<project>/<sessionId>.jsonl`, using assistant `message.usage` as ground truth.
- CodeGraph is available and useful for code-map exploration, but it does not answer runtime context visibility by itself.

## Requirements

1. Capture Context Manifests
   - Record startup context for supported runtimes: Claude Code first, Codex next.
   - Distinguish context phases: launch/startup, first user message, follow-up message, resumed session.
   - Record block names, source, byte size, estimated tokens when possible, and runtime-reported token usage when available.
   - Record whether a block is intended to be stable prefix, session-stable, task-variable, message-variable, or tool/runtime-generated.

2. Inspect Context Structure
   - Show a readable manifest for a selected agent/workspace/session/run.
   - Let the operator drill into a block preview and exact content when safe.
   - Mask or omit secrets by default.
   - Show context ordering so cache-prefix stability can be evaluated.

3. Compare Turns
   - Compare startup vs first message vs later message.
   - Highlight which blocks changed and how much they changed.
   - Surface prefix stability: where the first changed byte/block appears.

4. Support Claude Code and Codex Investigation
   - Determine how Claude Code structures startup prompt, first user turn, subsequent turns, and session JSONL usage.
   - Determine how Codex structures project instructions, SessionStart hook additional context, first user turn, and follow-up turns.
   - Document runtime-specific observability limits and fallback strategies.

5. Product Surface
   - Add a visible Context Inspector/Manifest surface in SmallKhoj once capture is reliable.
   - The surface should be navigable from agent/workspace/session/runtime detail, not buried in logs.
   - It should answer: "What did this agent know when it answered?"

## Acceptance Criteria

- [ ] For a Claude Code runtime session, SmallKhoj can produce a context manifest showing startup/system prompt blocks, first delivered message block, follow-up delivered message block, session id, and token usage source.
- [ ] For a Codex session, SmallKhoj can produce a context manifest showing project instructions / SessionStart additional context blocks, first user message context, follow-up context where observable, and size metrics.
- [ ] The manifest labels each block by stability class: stable prefix, session-stable, task-variable, message-variable, or runtime-generated.
- [ ] The manifest shows byte size for each block and either token estimate or runtime usage where available.
- [ ] The manifest can compare two turns and show changed blocks plus the first changed prefix boundary.
- [ ] Secrets are masked by default; raw exact content view requires an explicit operator action.
- [ ] The UI or CLI can inspect a selected agent workspace/session without reading unrelated full chat history.
- [ ] Documentation explains what is directly observed versus inferred for Claude Code and Codex.

## Out of Scope For MVP

- Editing or rewriting all prompts from the UI.
- Automatic prompt-cache optimization.
- Full provider-neutral token accounting for every model.
- Storing raw unmasked secrets or credential files.
- Replacing Trellis or CodeGraph.

## Open Questions

- Should the first MVP be daemon-only/CLI visible first, or should it immediately include a frontend panel?
- Should raw exact content be stored persistently, or should the manifest store hashes/previews and re-read raw content only from local session files when requested?
- How much Codex runtime context can be observed from local app/session files versus hook output alone?
