# Implementation Plan

## Phase 1: Spec First

1. [x] Update `.trellis/spec/backend/runtime-slock-integration.md`:
   - remove script-based default `ccs-claude` launcher contract;
   - forbid implicit `cc-switch.ps1`;
   - forbid personal hardcoded paths;
   - require local command detection and CC Switch DB metadata parsing for Claude and Codex.

## Phase 2: TDD

1. [x] Add failing tests in `agent/daemon/aaa-daemon/test/daemon-runtime.test.mjs`:
   - no implicit `cc-switch.ps1` fallback;
   - no hardcoded `/Users/lee` command discovery;
   - Claude command detection supports env/PATH/Windows command candidates;
   - Codex command detection supports env/PATH/Windows command candidates;
   - CC Switch DB loads both Claude and Codex providers with sanitized output;
   - selected Claude CC Switch provider resolves to detected `claudeCommand`, not wrapper scripts.

## Phase 3: Implementation

1. [x] Add shared command-detection helpers.
2. [x] Add `detectClaudeCommand`.
3. [x] Expand/improve `detectCodexCommand`.
4. [x] Replace `detectCcsClaudeProviders` default behavior with DB-backed provider loading.
5. [x] Extend `RuntimeProviderInventory` and provider launch resolution.
6. [x] Update heartbeat/detected runtime sanitization.

## Phase 4: Validation

1. [x] `rtk npm test -- --runInBand` in `agent/daemon/aaa-daemon`.
2. [x] Targeted source search:
   - no `/Users/lee/.local/bin/ccs-claude`;
   - no `.claude/cc-switch.ps1` implicit fallback;
   - no `ccs-claude` launch dependency in product path.
3. [ ] Commit and push when green.

## Notes

- This task intentionally prioritizes product behavior over preserving script-based local convenience.
- Real Windows/Linux execution remains a follow-up validation step on those machines.
