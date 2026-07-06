# Implementation Plan

## Phase 1: Research Capture Reality

- [ ] Use CodeGraph to map current Claude runtime/session usage code.
- [ ] Create a small probe script or documented manual procedure for Claude Code:
  - launch/startup context
  - first user message
  - follow-up message
  - session JSONL usage
- [ ] Create a small probe script or documented manual procedure for Codex:
  - project instructions
  - SessionStart hook additionalContext
  - first user message context
  - follow-up behavior or available local logs
- [ ] Record findings in `research/claude-code-context.md` and `research/codex-context.md`.

## Phase 2: Manifest Model

- [ ] Define `ContextManifest` and `ContextBlock` types.
- [ ] Implement block hashing, byte sizing, masking, preview extraction, and prefix diff.
- [ ] Add focused tests for masking and prefix boundary detection.

## Phase 3: Claude Runtime Integration

- [ ] Capture daemon Slock system prompt as a manifest block.
- [ ] Capture sent user/runtime message blocks.
- [ ] Attach session id and usage from existing Claude JSONL usage reader.
- [ ] Expose manifest through daemon trace or backend API.

## Phase 4: Codex Integration

- [ ] Capture Codex SessionStart hook output as structured blocks.
- [ ] Identify what local Codex session/log files can be safely observed.
- [ ] Add Codex-specific manifest capture once the Codex daemon runtime exists.

## Phase 5: Product Surface

- [ ] Add a minimal Context tab for agent/workspace/session detail.
- [ ] Show block table and selected-block preview.
- [ ] Add turn comparison view for startup vs first turn vs follow-up.
- [ ] Add real-test evidence with `./twd` and `./smallkhoj-trace`.

## Validation

- Unit tests for block classification, masking, byte sizing, and prefix diff.
- Daemon test proving Claude manifest contains system prompt, delivered message, session id, and usage source.
- Browser/real test showing an operator can inspect a selected agent session context manifest.
