# TWD auth and target tab guard

## Goal

Make local browser verification stable after frontend restarts or hot reloads redirect a connected tab back to `/login`.

## Requirements

- Provide project-level helpers that agents can use instead of broad `./twd --url-match 127.0.0.1:3000` for authenticated SmallKhoj pages.
- `twd-auth <name>` logs in through `POST /api/v1/auth/login`, gets a `sessionToken`, and injects the `smallkhoj_session` cookie into a connected local frontend tab.
- `twd-open <path>` ensures auth, opens the requested frontend path, and fails loudly if the final browser path is not the requested path.
- `twd-eval <path> <script>` ensures the requested page is open and authenticated before running JavaScript, then verifies the browser is still on the requested path.
- Prefer narrow target matching such as `127.0.0.1:3000/tasks` over broad `127.0.0.1:3000`.
- If multiple local tabs exist and the helper cannot choose safely, fail with candidate URLs instead of silently selecting one.

## Acceptance Criteria

- [ ] `./tools/twd-guard/twd-auth zy-ean` injects a valid local session cookie into an existing local frontend tab.
- [ ] `./tools/twd-guard/twd-open /tasks` lands on `/tasks`, including when the starting tab is `/login`.
- [ ] `./tools/twd-guard/twd-eval /tasks "return {path: location.pathname}"` returns `/tasks`.
- [ ] A wrong or ambiguous target does not silently pass.
- [ ] Project WebDriver guidance tells future agents to prefer these helpers for authenticated frontend verification.

## Notes

- Defaults should match local dev: frontend `http://127.0.0.1:3000`, API `http://localhost:8000`, public key `sk_public_local`, account `zy-ean`.
