# Evidence directory

Use one marker for one candidate run:

```text
REAL_windows-computer-install-setup-connect_<YYYYMMDDHHMMSS>
```

Store only reviewable, redacted evidence. Suggested files:

```text
<marker>-preflight.txt
<marker>-install.txt
<marker>-setup.txt
<marker>-connect.txt
<marker>-reconnect.txt
<marker>-upgrade-rollback.txt
<marker>-ui.snapshot.txt
<marker>-ui.png
<marker>-summary.md
```

Mac-only install/setup evidence uses the same candidate marker and a separate prefix:

```text
macos-install-real-8000_20260806234756.md
macos-setup-real-8000_20260806234756.md
macos-install-path-fix-8000_20260807002251.md
```

Every summary must name the candidate commit, frontend/API URLs, OS/CPU/PowerShell or macOS/Node versions, command exit codes, and PASS/BLOCKED status. Replace all `sk_connect_` and `sk_machine_` values with `<REDACTED_...>` before copying files here. Do not store browser cookies, database dumps, private keys, or raw server credentials.

For browser evidence, record the exact WebDriver `tabId` and `tabUrl`, use `./twd`, and keep the same marker across DOM checks, screenshots, API reconciliation, and trace output. A stale tab, static screenshot, or typecheck result cannot prove a real-host acceptance gate.

## Historical UI candidate and current artifact evidence

The original 2026-08-06 UI/runtime run used historical candidate `4d02667139a2`, backend
`http://127.0.0.1:8000`, frontend `http://127.0.0.1:3000`, and WebDriver
`tabId=1617513010` at `/computers`. Its service identity and PASS results are retained for UI
context only; they do not identify the current release artifact:

- `live-runtime-report.md` — service identity, Integration Gate 51/51, and browser acceptance summary;
- `daemon-runtime-recheck.md` — historical 305/305 suite, current 307/307 recheck, and diagnosis of the stale-credential 502;
- `computers-dom.json` / `computers-eval.json` — initial same-tab DOM and marker evaluation;
- `computers-dialog-dom.txt` / `computers-dialog-eval.json` — dialog-open DOM/eval on the same tab;
- `computers-windows-dom.txt` / `computers-windows-eval.json` — Windows-tab fail-closed DOM/eval on the same tab.

After the readability and locale pass, the frontend process was refreshed from
the same worktree and the exact tab was re-authenticated. The final browser
evidence is:

- `computers-readable-final-zh.png` / `computers-readable-final-zh-eval.json` —
  Chinese locale: phase labels are only `安装 / 初始化 / 连接`, the shell label
  is only `终端`, and the computer-name field is 829px × 44px at 16px.
- `computers-readable-final-en.png` / `computers-readable-final-en-eval.json` —
  English locale: the same surface renders `Install / Setup / Connect`,
  `Terminal`, and English guidance through the language switch.

Both captures use `tabId=1617513010`, `tabUrl=http://127.0.0.1:3000/computers`,
and a preview with no connect ticket. PNG files remain local-only when the
repository ignore policy excludes image blobs; the JSON eval files are the
reviewable assertions.

The corresponding `computers.png` screenshot remains local-only because repository policy intentionally ignores evidence image blobs. Windows-side evidence must use a fresh marker and redact all connect/machine credentials before handoff.

The current source/release candidate is `0b6222202921001e88d6aec159410ad54543edb6`.
Its `darwin-arm64` 0.2.6 artifact was rebuilt locally and served from the current worktree
FastAPI StaticFiles mount at `http://localhost:8000` with lifespan disabled. That carrier-only
process proved HTTP 200, manifest/source revision, checksum, isolated install, Setup idempotence,
and fake-upstream Connect/register/heartbeat. The same candidate also fixes the real Unix PATH
handoff between Install and Setup; see `macos-install-path-fix-8000_20260807002251.md`. It did
not run database lifespan and is not a real backend Online/cloud acceptance. The earlier 26a
artifact evidence remains historical and is linked above.

`release-artifacts/` is gitignored generated output. The roughly 191 MB archive must not be
committed; Windows must rebuild and publish a real `win32-x64` PE artifact after fetching the
current `main`.
