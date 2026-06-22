# Quality Gate

## Scope

Stabilize authenticated frontend verification by adding guarded wrappers around project `./twd`.

## Acceptance

| Requirement | Result | Evidence |
| --- | --- | --- |
| `twd-auth zy-ean` injects a valid local session cookie | Pass | Returned `hasCookie: true` on the connected local frontend tab. |
| `twd-open /tasks` recovers from `/login` | Pass | Manually navigated the local tab to `/login`, then `./tools/twd-guard/twd-open /tasks` returned `pathname: "/tasks"`. |
| `twd-eval /tasks "return {path: location.pathname}"` runs against the target page | Pass | Returned `result.path: "/tasks"` and guard `pathname: "/tasks"`. |
| Full chat DM URLs with encoded route suffix work | Pass | `./tools/twd-guard/twd-eval 'http://127.0.0.1:3000/chat/dm%3A1b5c6c75-cd6e-4257-9bdb-ee59168ab097-784c1903-7a22-4e01-b5d8-044a92730ff7' ...` returned the exact encoded `pathname`, decoded DM path, and `hasComposer: true`. |
| Selected computer URLs with query suffix work | Pass | `./tools/twd-guard/twd-eval 'http://127.0.0.1:3000/computers?computer=c331f3f8-4197-4a4b-af3a-4633f34cca4a' ...` returned exact `search: "?computer=c331f3f8-4197-4a4b-af3a-4633f34cca4a"`. |
| Avoid fixed tab ids across commands | Pass | Unit test covers single local tab selection using narrow `--url-match` instead of `--tab`. |
| Future agent guidance updated | Pass | `.agents/skills/project-webdriver-cli/SKILL.md` now points agents to `./tools/twd-guard/twd-open`, `./tools/twd-guard/twd-eval`, and `./tools/twd-guard/twd-auth` for authenticated pages. |

## Commands Run

```bash
node --check tools/twd-guard/twd-auth-guard.mjs
node --test tools/twd-guard/twd-auth-guard.test.mjs
python3 ./.trellis/scripts/task.py validate 06-22-twd-auth-target-guard
./tools/twd-guard/twd-auth zy-ean
./twd --compact goto --url-match '127.0.0.1:3000/chat/dm%3A1b5c6c75-cd6e-4257-9bdb-ee59168ab097-5fe6445a-151b-4c36-8f65-764e931bb028' --wait 5 http://127.0.0.1:3000/login
./tools/twd-guard/twd-open /tasks
./tools/twd-guard/twd-eval /tasks "return {path: location.pathname}"
./tools/twd-guard/twd-eval 'http://127.0.0.1:3000/chat/dm%3A1b5c6c75-cd6e-4257-9bdb-ee59168ab097-784c1903-7a22-4e01-b5d8-044a92730ff7' "return {href: location.href, pathname: location.pathname, decodedPath: decodeURIComponent(location.pathname), title: document.title, hasComposer: !!document.querySelector('textarea, [contenteditable=true], input[name=content]')}"
./tools/twd-guard/twd-eval 'http://127.0.0.1:3000/computers?computer=c331f3f8-4197-4a4b-af3a-4633f34cca4a' "return {href: location.href, pathname: location.pathname, search: location.search, title: document.title}"
graphify update .
```

## Notes

- The guard starts a detached `./twd serve` process when port `18765` is not open, then waits before running tab-sensitive commands.
- Cross-command tab selection intentionally uses narrow `--url-match`; tab ids are only returned as evidence, not reused as the primary selector.
