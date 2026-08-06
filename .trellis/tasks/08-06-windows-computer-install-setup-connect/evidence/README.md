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

Every summary must name the candidate commit, frontend/API URLs, OS/CPU/PowerShell or macOS/Node versions, command exit codes, and PASS/BLOCKED status. Replace all `sk_connect_` and `sk_machine_` values with `<REDACTED_...>` before copying files here. Do not store browser cookies, database dumps, private keys, or raw server credentials.

For browser evidence, record the exact WebDriver `tabId` and `tabUrl`, use `./twd`, and keep the same marker across DOM checks, screenshots, API reconciliation, and trace output. A stale tab, static screenshot, or typecheck result cannot prove a real-host acceptance gate.

## Current Mac candidate evidence

The 2026-08-06 Mac run used candidate `4d02667139a2`, backend `http://127.0.0.1:8000`, frontend `http://127.0.0.1:3000`, and WebDriver `tabId=1617513010` at `/computers`:

- `live-runtime-report.md` — service identity, Integration Gate 51/51, and browser acceptance summary;
- `daemon-runtime-recheck.md` — isolated full daemon suite (305/305) and diagnosis of the stale-credential 502;
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
