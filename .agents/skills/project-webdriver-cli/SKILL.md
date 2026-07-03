---
name: project-webdriver-cli
description: Use the SmallKhoj project WebDriver CLI for browser/UI verification, DOM assertions, screenshots, marker-based real-test evidence, and local app interaction. Trigger for frontend or browser-facing changes, requests to verify visible UI behavior, screenshots/snapshots, DOM checks, or when project guidance mentions WebDriver/twd. Prefer the CLI wrapper `./twd`; do not read or invoke `twd.py` unless debugging the WebDriver tool itself.
---

# Project WebDriver CLI

Use this skill for browser-visible verification in SmallKhoj.

## Rule

Use the CLI wrapper from the repository root:

```bash
./twd --help
```

Do not call `python ./twd.py ...` during normal app verification. Treat `twd.py`, `tmwebdriver_core.py`, and extension internals as implementation details; open them only when the task is to debug or change the WebDriver tool itself.

Do not use Playwright for this repository's browser/UI verification.

## Quick Start

Check whether a browser tab is connected:

```bash
./twd --compact tabs
```

For authenticated SmallKhoj frontend pages, prefer the guarded helpers first:

```bash
./tools/twd-guard/twd-open /tasks
./tools/twd-guard/twd-eval /tasks "return { path: location.pathname }"
./tools/twd-guard/twd-auth zy-ean
```

These helpers log in through the local API, inject the `smallkhoj_session` cookie, use a narrow target match such as `127.0.0.1:3000/tasks`, and fail if the final browser path is not the requested path. Use raw `./twd` commands when testing WebDriver behavior itself or when the page is intentionally unauthenticated.

If no tab is connected, the usual setup is a long-running master process:

```bash
./twd serve
```

`serve` is persistent and blocks the terminal. Start it only when you need to run the WebDriver bridge and can keep that process open. The CLI emits JSON; use `--compact` before the subcommand for token-efficient output.

## Common Commands

Navigate a matching tab:

```bash
./twd goto --url-match 127.0.0.1:3000 "http://127.0.0.1:3000/chat/all"
```

Read visible page text:

```bash
./twd --compact scan --text --url-match 127.0.0.1:3000
```

When `--url-match` matches multiple tabs, the CLI prefers the unique active matching tab if that signal is available. If it cannot determine a unique active tab, it fails with `code=AMBIGUOUS_TAB` and a `candidates` list. Use a more specific URL fragment or `--tab <id>` instead of accepting a broad localhost match.

Take an optimized snapshot, writing long output to a file:

```bash
./twd snapshot --url-match 127.0.0.1:3000 --out .trellis/tasks/<task>/evidence/page.snapshot.txt
```

Execute focused JavaScript. Always use an explicit `return`:

```bash
./twd --compact eval --url-match 127.0.0.1:3000 "return { title: document.title, text: document.body.innerText.slice(0, 500) }"
```

Input and click with selector plus visible text/label filters:

```bash
./twd input --url-match 127.0.0.1:3000 "textarea,input[name=content]" "REAL_<marker>" --contains "Message"
./twd click --url-match 127.0.0.1:3000 "button" --contains "Send"
```

Capture a screenshot:

```bash
./twd screenshot --url-match 127.0.0.1:3000 .trellis/tasks/<task>/evidence/REAL_<marker>.png
```

Run an action with before/after snapshot, diff, and transient text capture:

```bash
./twd act --url-match 127.0.0.1:3000 --monitor 2 --settle 0.5 "document.querySelector('button[type=submit]')?.click(); return true"
```

## Evidence Pattern

For frontend/browser-facing work:

1. Use a unique marker such as `REAL_<feature>_<YYYYMMDDHHMMSS>`.
2. Drive the real local app through `./twd`.
3. Verify visible DOM state with `scan`, `snapshot`, or `eval`.
4. Save screenshots/snapshots under the active task's `evidence/` directory when useful.
5. Cross-check backend/API/database state when the UI depends on persisted data.
6. Use `./smallkhoj-trace summary` for runtime/control-plane flow; use WebDriver only for browser-visible behavior.

Keep large DOM or HTML output out of chat. Prefer `--out` files, `--compact`, and small `eval` return objects.

For any command that acts on a tab, check the returned `tabUrl` along with `tabId` before treating the result as UI evidence.

## Troubleshooting

- `ok=false` with `NO_TAB`: no connected browser tab. Start/verify the WebDriver master and Chrome extension, then retry `tabs`.
- `ok=false` with `AMBIGUOUS_TAB`: your `--url-match` matched multiple tabs and no unique active tab was known. Use one of the returned candidate URLs as a narrower match, or pass `--tab`.
- Port mismatch: `./twd` auto-discovers the active bridge when no port is specified. Set `TWD_PORT=<port>` only when you intentionally want a specific bridge instance.
- Long output: write to `--out` or return a small slice from `eval`.
- Need real browser event details or CDP: use `cdp`, `screenshot`, or `act` before opening WebDriver source files.
