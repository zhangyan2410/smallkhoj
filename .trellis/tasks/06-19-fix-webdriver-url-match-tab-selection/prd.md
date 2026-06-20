# Fix WebDriver URL Match Tab Selection

## Goal

Fix the project WebDriver CLI/wrapper behavior where `./twd --url-match 127.0.0.1:3000` can inspect or act on a stale/wrong browser tab, causing agents to report UI state that does not match the user's real browser.

## Observed Problem

During chat sidebar verification, `./twd --url-match 127.0.0.1:3000` returned a stale DM page that showed only one DM, while the user's actual visible browser page showed the chat sidebar with three DMs:

- `members-flow-001`
- `minimax`
- `verify-fix-002`

The business UI was correct. The verification tool selected or reused the wrong tab/session.

## Requirements

- Diagnose how `--url-match` selects tabs when multiple `127.0.0.1:3000` tabs exist.
- Make tab selection deterministic enough for agent verification:
  - prefer the currently active/focused matching tab if available
  - otherwise require a more specific match or report ambiguity instead of silently choosing an arbitrary stale tab
  - preserve existing successful `--url-match` usage where only one matching tab exists
- Improve CLI output or failure mode so an agent can see which URL/tab is actually being inspected.
- Add or update tests where the WebDriver tool has a testable selection layer.
- Do not change chat business code for this task.

## Acceptance Criteria

- [ ] With multiple matching localhost tabs, `./twd` no longer silently inspects the wrong stale tab.
- [ ] Ambiguous matches either select the active matching tab or fail with a clear ambiguity message that lists candidate URLs.
- [ ] `./twd --compact tabs` / action output remains usable and not overly verbose.
- [ ] Existing simple single-tab usage still works.
- [ ] A focused regression test or documented manual reproduction is added.

## Scope

Likely files:

- `twd`
- `agent/daemon/webdriver/twd`
- `agent/daemon/webdriver/tmwebdriver_core.py`
- related WebDriver CLI command files under `agent/daemon/webdriver/`

Out of scope:

- `frontend/app/chat/[channel]/channel-client.tsx`
- chat sidebar UI
- DMS backend API
