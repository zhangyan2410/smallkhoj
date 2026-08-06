# Live runtime acceptance (2026-08-06)

Collector context: repo `/Users/code/project/smallkhoj`, branch `main`, HEAD `4d02667139a2`, 3 worktrees; initial listeners had no 3000/8000/38190/38191, host PostgreSQL 127.0.0.1:5432 PID 805. Safety contract treated host 5432 as protected and did not migrate/stamp/cleanup it.

## Candidate identity

Started current worktree directly after `./dev.sh restart` processes exited under non-interactive shell. Backend command `AUTH_BRIDGE_SECRET=... uv run python main.py` from `/Users/code/project/smallkhoj/backend`; PID 19042 (cwd `/Users/code/project/smallkhoj/backend`) with child 19045. Frontend `npm run dev` from `/Users/code/project/smallkhoj/frontend`; after the readability CSS refresh, npm parent/Next PIDs are 37305/37311. URLs: `http://127.0.0.1:8000/docs`, `http://127.0.0.1:3000/`.

## Tests

`rtk node --test tools/integration-gate.compatibility.test.mjs tools/integration-gate/*.test.mjs`: PASS, 51 tests, 0 failures.

Frontend quality gate after the readability/locale change: `bun test` PASS,
273/273; onboarding/i18n narrow target PASS 6/6; `bun run typecheck` PASS;
`bun run lint` PASS with 0 errors and one
pre-existing `payloadString` unused warning.

With the candidate backend/frontend running, the daemon suite was rerun with an isolated temporary Aura state directory so a stale user credential could not redirect the fake-upstream tests:

`cd agent/daemon/aaa-daemon && npm run build && node --test --test-concurrency=1 test/*.test.mjs`: PASS, 305 tests, 0 failures, 0 cancelled. The detailed rerun and the initial stale-credential 502 diagnosis are in [daemon-runtime-recheck.md](./daemon-runtime-recheck.md).

Production frontend build also passed with a non-development temporary public API
key and local build-only auth/database values; the key was not committed.

## Browser evidence

Authenticated with `TWD_PORT=28765`, account `zy-ean`, trusted bridge secret. Exact tabId `1617513010`; `/computers` tabUrl `http://127.0.0.1:3000/computers`.

- DOM snapshot: `computers-dom.json`
- Screenshot: `computers.png` (local validation artifact; image blobs are intentionally ignored by `.gitignore`)
- Eval evidence: `computers-eval.json`

The same tab was then reopened with the onboarding dialog visible and captured again:

- `computers-dialog-dom.txt`, `computers-dialog-eval.json`, and local-only `computers-dialog.png` show the Install/Setup/Connect surface with `tabId=1617513010`.
- Selecting the Windows tab in that same dialog produced `computers-windows-dom.txt` and `computers-windows-eval.json`; the eval confirms `Windows` selected, the Unix command absent, no ticket string, and the intentional `Windows 安装器暂不可用` fail-closed warning because this Mac checkout has no Windows manifest. The matching `computers-windows.png` is local-only.
- Final readability/locale capture after the frontend refresh is in `computers-readable-final-zh-eval.json` and `computers-readable-final-en-eval.json` (same `tabId=1617513010`, exact `/computers` URL). The computer-name field is full-width 829px × 44px at 16px; Chinese renders only `安装 / 初始化 / 连接`, `终端`, and Chinese guidance, while English renders `Install / Setup / Connect`, `Terminal`, and English prose. Preview remains ticket-free in both captures; PNGs are local-only evidence blobs.

Snapshot shows Chinese default copy, Windows and macOS / Linux tabs, Install/Setup/Connect sections. Eval lists only `Windows` and `macOS / Linux` platform tabs and the unselected platform command is absent from visible DOM. Initial preview contains no ticket; Connect remains “生成连接命令”.

## Limits

No Windows hardware/runtime was available; Windows manifest unavailable/fail-closed and actual Windows command execution remain unexecuted. Ticket issuance/expiry/reconnect interaction was not exercised because it requires creating a daemon registration and would write runtime data; no shared DB test writes were performed intentionally.

The earlier ACP 127 string is documented in `daemon-runtime-recheck.md`: it is a deliberate negative child-exit test, while the production default dynamically resolves `@zed-industries/codex-acp@0.16.0` through npx. The package is not bundled, so Windows offline/cache/PATH behavior remains a real acceptance item rather than a Mac blocker.
