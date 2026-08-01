# Release Pipeline

> End-to-end ordered pipeline from local verification through squash merge to
> the registry-free Tencent Lighthouse deployment, plus the schema-aware
> rollback contract. This is the **entry overview**; each phase links to its
> detailed contract spec. Read this first when asked "how do we verify /
> merge / deploy", then drill into the linked specs for the exact assertions.

## Scenario: Verify -> Merge -> Deploy -> Rollback Pipeline

### 1. Scope / Trigger

Use this spec whenever work needs the ordered release pipeline:

- answering "how do we verify / test / merge / deploy / release this project";
- planning a release candidate, a squash merge, or a cloud deploy;
- diagnosing where in the pipeline a change currently sits; or
- deciding whether an image rollback is allowed after a failed deploy.

This is a navigation overview. The authoritative contracts live in the linked
sibling specs and in `Makefile`, `.github/workflows/ci.yml`, and `scripts/`.
When this overview and a linked source disagree, the linked source wins.

### 2. Signatures

Pipeline phases (in order):

```text
0. Local candidate      clean worktree + make ci green
1. Capacity gate        formal-300-500-30-v1 passes on the candidate tree
2. Squash merge         gh pr merge --squash --match-head-commit <SHA>
3. Tree equality        origin/main^{tree} == candidate tree
4. Image build/transfer production_image_transfer.py --apply (registry-free)
5. App-only deploy      docker compose up -d ... backend frontend caddy
6. Post-deploy smoke    post_deploy_smoke.py against the public base URL
7. Health window        10-minute window, sampled every 60s
   Rollback             schema-aware: allowed only when Alembic revision unchanged
```

Authoritative commands:

```bash
# Phase 0 — deterministic local gate (Makefile: `ci` aggregate target)
make ci                       # = scripts-test backend-ci frontend-ci compose-check diff-check

# Phase 0 — per-stack full chains
# backend: uv lock --check -> uv sync --dev --locked -> alembic upgrade head &&
#          alembic check -> ruff check . -> pytest -q
# frontend: bun install --frozen-lockfile -> bun run test -> bun run lint ->
#           tsc --noEmit (+e2e) -> bun run build (asserts .next/standalone/server.js)
make backend-ci
make frontend-ci

# Phase 0 — committed deterministic E2E (NOT UI acceptance; starts services externally)
make e2e-authenticated        # = verify-e2e-env; cd frontend && bun run e2e

# Phase 0 — UI acceptance (project WebDriver wrapper; do NOT call twd.py directly,
#           do NOT substitute Playwright for repo UI verification)
./twd --compact tabs
./twd goto --url-match 127.0.0.1:<port> http://127.0.0.1:<port>/
./twd --compact scan --text --url-match 127.0.0.1:<port>

# Phase 2 — squash merge (no --delete-branch: avoid delete failure aborting a successful merge)
gh pr merge <PR> --squash --match-head-commit <candidate-SHA>

# Phase 4 — registry-free image build + transfer (requires clean HEAD == SHA)
python3 scripts/production_image_transfer.py \
  --host 124.222.40.40 --user ubuntu \
  --identity-file /Users/lee/.ssh/tengxun-ssh-key.pem \
  --remote-dir /opt/smallkhoj-deploy \
  --platform linux/amd64 \
  --capacity-report <accepted-formal-report.json> \
  --use-vpn-proxy --apply

# Phase 5 — app-only deploy (NEVER include `db` in the deploy command)
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d \
  --force-recreate --no-deps --no-build --pull never backend frontend caddy

# Phase 6 — post-deploy smoke (health route is /api/health, NOT /health)
python3 scripts/post_deploy_smoke.py --base-url http://124.222.40.40 --allow-http --json
```

Deploy target:

```text
Host:     124.222.40.40  (Tencent Lighthouse lhins-6gznhrts, ap-shanghai)
User:     ubuntu
Base URL: http://124.222.40.40   (HTTP:80 today; HTTPS/domain/ICP not yet established)
Remote:   /opt/smallkhoj-deploy  (image archive)  /  /home/ubuntu/smallkhoj-deploy (release worker)
Secrets:  /Volumes/ORICO/smallkhoj-secrets/release-worker.env (external drive; never committed)
```

Runtime image tags loaded on the server:

```text
smallkhoj-backend:local-release
smallkhoj-frontend:local-release
smallkhoj-caddy:local-release
```

### 3. Contracts

#### Phase 0 — Local verification

- `make ci` is the deterministic static/build matrix. It does NOT start runtime
  services; CI and local release scripts start isolated candidates before
  `make e2e-authenticated`.
- `make e2e-authenticated` does NOT start runtime and does NOT bind Docker; its
  body is `verify-e2e-env; cd frontend && bun run e2e`.
- E2E requires `E2E_DATABASE_SCOPE=disposable` AND both `DATABASE_URL` and
  `BETTER_AUTH_DATABASE_URL` targeting loopback with an explicit safe database
  name marker, identifying the same database. It fails before browser startup
  when this proof is absent.
- UI acceptance evidence MUST come from `./twd` with a marker
  `REAL_<task-slug>_<timestamp>` recorded under `.trellis/tasks/<task>/evidence/`.
  The committed Playwright flow (`make e2e-authenticated`) is deterministic
  cross-layer CI coverage, NOT UI acceptance, and must not replace visible
  `./twd` evidence.
- `dev.sh` is `local-dev` convenience only and must NOT be used as release
  evidence. See `deployment-environment-contracts.md`.

#### Phase 1 — Capacity gate

- Release requires an accepted `formal-300-500-30-v1` report on the candidate
  tree: 300 steady SSE / 500 peak SSE / 30 active users / 1800s active / 60s
  peak / 60s cleanup. See `formal-capacity` scenario in
  `deployment-environment-contracts.md`.
- A short `smoke` run is diagnostic only; `acceptance.passed=true` is reserved
  for the formal profile. Trusting a mutable passing summary without
  recomputation is a release-blocking validation bug.

#### Phase 2 — Squash merge

- `main` is the stable line. Non-trivial work uses a sibling worktree plus a
  `feat/*` branch; verify in the worktree; merge by PR + squash.
- Use `gh pr merge <PR> --squash --match-head-commit <candidate-SHA>` without
  `--delete-branch`. Removing `--delete-branch` avoids a branch-delete failure
  aborting an already-successful merge.
- Terminology ladder (strictly distinct):
  candidate verified != merged != released != healthy. Do not claim
  `complete`/`merged`/`released`/`deployed`/`cloud healthy` before the
  corresponding phase actually succeeds.

#### Phase 3 — Tree equality

- After squash merge, require `origin/main^{tree} == candidate tree`. The squash
  must preserve the candidate tree. Image revision labels use the merge commit
  SHA; preserve the tested-tree -> merge-SHA mapping in release evidence.
- A post-squash tree that differs from the formally tested candidate tree blocks
  image transfer; rebuild/retest the correct candidate.

#### Phase 4 — Registry-free image transfer

- Current cloud deploy is registry-free: local build -> `docker save` ->
  SSH/SCP upload -> remote `docker load` -> remote `docker compose`. No
  container registry, no CI image push, no `git push`-to-deploy.
- Precondition: `git status --porcelain` completely empty AND supplied
  `--source-revision` == current `HEAD` AND formal capacity report candidate
  tree == current `HEAD^{tree}`.
- Build context must be a clean Git candidate. Staged/unstaged/untracked files
  are release blockers. The `org.opencontainers.image.revision` label must
  equal the checked-out `HEAD`.
- Frontend production build injects `PUBLIC_API_KEY` via BuildKit secret
  (`--secret id=public_api_key,env=PUBLIC_API_KEY`), never via build args.
  BuildKit deliberately does NOT include secret content in the cache key, so a
  same-source/different-key rebuild may show `CACHED`; hash-compare the
  production public key SHA-256 against the running backend key before deploy.
- Every real transfer, including `--skip-build`, requires `--capacity-report`.
  A stale/failed/forged report or a candidate-tree mismatch is a release
  blocker.
- On success, atomically persist schema-versioned JSON release evidence
  (`<output-archive>.release-evidence.json`): binds tested candidate HEAD/tree,
  merge HEAD/tree, formal profile + report path/hash, image tag/ID/revision/
  platform, archive path/hash. Contains no secret values.

#### Phase 5 — App-only deploy

- The only deploy command is `docker compose ... up -d --force-recreate
  --no-deps --no-build --pull never backend frontend caddy`.
- NEVER include `db` in the deploy command. A previous helper
  (`lighthouse --compose-up --use-loaded-images`) was rejected because it ran
  `docker compose pull db` / `docker compose up db`; do not reintroduce it.
- Bundle naming on the remote: `smallkhoj-deploy-__B_SHORT__` where `__B_SHORT__`
  is `git rev-parse --short=12 HEAD`, under `__REMOTE_ROOT__`.

#### Phase 6 — Post-deploy smoke and health

- Health endpoint is `/api/health`, NOT `/health`. `deploy/caddy/Caddyfile`
  routes `/api` and `/api/*` to backend; `/health` is routed to frontend and is
  NOT valid backend-health evidence. `scripts/post_deploy_smoke.py` probes
  `/api/health`.
- Phase 7 requires a 10-minute health window sampled every 60 seconds (ten
  samples, no-clobber), with connection-budget parity `48 / 100` against
  PostgreSQL `max_connections=100`.

#### Rollback (schema-aware, fail-closed)

- Deploy records the Alembic revision BEFORE and AFTER.
- revision unchanged -> `IMAGE_ROLLBACK_ALLOWED=schema-unchanged`: mechanical
  image rollback to the prior tag is permitted.
- revision changed or unknown -> `IMAGE_ROLLBACK_FORBIDDEN=schema-changed-or-unknown`:
  stop caddy/frontend/backend, KEEP `db` running, preserve DB and logs, and
  request a maintainer decision. NEVER start an old app image and NEVER
  auto-restore/drop/overwrite the production DB.
- Before deploy, create an external rollback anchor (directory outside
  OLD/NEW bundles, mode `0700`, no-clobber): `.env.prod.old` (0600),
  `docker-compose.prod.yml.old` (0600), three `smallkhoj-<service>:rollback-pre-__B_SHORT__-__UTC__`
  tags, `docker save` archives of the prior app images, pre-deploy Alembic
  revision, DB dump, and a SHA-256 ledger. A same-named tag MUST stop deploy;
  overwriting is forbidden.
- **Partial-service rollback must keep credentials consistent across
  services.** `NEXT_PUBLIC_API_KEY` is compiled into the frontend browser
  bundle at build time (see `deployment-environment-contracts.md`), while
  backend `PUBLIC_API_KEY` is runtime env. Rolling back ONLY the frontend
  image to a build that baked an older key, while the backend `.env.prod`
  already moved to a new key, makes every authenticated request return 401
  `Invalid API key` and hangs server-component route changes
  (`requireCurrentAccount` retries/redirects). A partial rollback is only safe
  when the rolled-back image's baked key equals the current backend
  `PUBLIC_API_KEY`; otherwise roll back both backend env and frontend image
  to the same key generation together. Verify the key match before
  `compose up`, not after users report a hang.

#### Daemon distribution (parallel track)

- Daemon source: `agent/daemon/aaa-daemon/` (current version `0.2.1`).
  Backend `MINIMUM_DAEMON_VERSION=0.2.0`; lower daemon versions get `426`.
- `scripts/build_daemon_distribution.py` produces
  `smallkhoj-daemon-v<version>-<platform>.tar.gz` + `.sha256` + `.manifest.json`
  + `install.sh`; `--source-revision` must be a 40-char SHA == current HEAD.
- Upload artifacts to `/downloads/smallkhoj-daemon/`; clients install via
  `curl ... | SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL=<base> bash` into
  `~/.smallkhoj/daemon/versions/v<ver>-<plat>/`.
- Daemon rollback: republish/retain the previous artifact directory, rerun its
  `install.sh`, restart the daemon. Keep at least the previous known-good
  artifact and checksum until the release is accepted.
- The bundled daemon tgz must expose the `aura` bin; `smallkhoj-daemon` is a
  compatibility alias. See the "Compatible Daemon Package Rollout" scenario in
  `deployment-environment-contracts.md`.

#### `rtk` is NOT a project build tool

- `rtk` (Rust Token Killer, `rtk-ai/rtk`) is a user-global, third-party
  token-optimizing CLI proxy that compresses terminal output fed to an LLM.
  The convention "prefix shell commands with `rtk`" is a developer convenience
  documented in `~/.codex/RTK.md`; it is NOT referenced by the Makefile, CI,
  or any release script.
- CI/Makefile/scripts use raw tools (`uv run`, `bun run`, `docker`, `make`).
  Do NOT inject `rtk` into commands documented as release evidence.
- Footgun: `rtk test <args>` always returns 0 (even `rtk test false`); it runs
  a test-suite command, it is NOT the shell `test`/`[` builtin and must not be
  used for file/value assertions.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Asked "is it deployed/released" after only a localhost check | Invalid evidence; rerun against `local-prod` or `cloud-prod`. A localhost check never proves cloud production works. |
| `make ci` green but no formal capacity report | Not release-ready; run `formal-300-500-30-v1` on the candidate tree. |
| A short `smoke` run labeled as formal capacity | Reject; `acceptance.passed=true` is reserved for the formal profile. |
| Squash merge succeeded but `origin/main^{tree} != candidate tree` | Block image transfer; rebuild/retest the correct candidate. |
| `gh pr merge` used with `--delete-branch` | Risk: a branch-delete failure aborts a successful merge; drop the flag. |
| Image build on Apple Silicon without `--platform linux/amd64` | Invalid deploy artifact for the x86_64 Lighthouse host; rebuild with `--platform`. |
| `production_image_transfer.py` run with a dirty tree or SHA != HEAD | Release blocker; clean the tree and supply the exact HEAD SHA. |
| `docker compose up -d` includes `db` | Contract violation; deploy app-only (`backend frontend caddy`), never `db`. |
| Health probe hits `/health` and returns frontend | Wrong endpoint; backend health is `/api/health` (Caddy routes `/health` to frontend). |
| Post-deploy and pre-deploy Alembic revisions differ, then rollback attempted | `IMAGE_ROLLBACK_FORBIDDEN`; keep DB running, preserve data, request maintainer decision. |
| A same-named rollback tag already exists | Stop deploy; never overwrite an existing rollback anchor. |
| Hosted daemon tgz version != `DAEMON_RELEASE_VERSION` | Daemon onboarding blocker; regenerate/upload the matching artifact. |
| `rtk test` used to assert a file/value condition | Invalid assertion; `rtk test` always returns 0. Use shell `test`/`[` or raw tooling. |
| Claiming `complete`/`released`/`cloud healthy` before the phase succeeds | Terminology violation; use the strict ladder candidate != merged != released != healthy. |

### 5. Good/Base/Bad Cases

- Good: clean candidate -> `make ci` green -> `formal-300-500-30-v1` passes ->
  squash merge preserving tree -> transfer with capacity report -> app-only
  deploy -> `/api/health` smoke -> 10-minute window; rollback anchor recorded.
- Good: storing the large Docker archive on `/Volumes/ORICO/...` for release.
- Base: a labeled `smoke` run validates Docker/query/report wiring while
  `acceptance.passed=false`; formal capacity still pending.
- Bad: `localhost:3000/login` opened, therefore "release deployment is ready".
- Bad: `docker compose up -d db backend frontend caddy` (db in deploy command).
- Bad: probing `/health`, seeing a 200, and calling backend healthy.
- Bad: rolling back an image after a schema-changing migration without a
  maintainer decision.
- Bad: documenting release commands with an `rtk` prefix as if it were a
  required project tool.

### 6. Tests Required

For any change touching the pipeline:

- Local gate: `make ci` (aggregate) or the per-stack `make backend-ci` /
  `make frontend-ci` chains.
- Compose syntax: `make compose-check`
  (`docker compose -f docker-compose.prod.yml config --no-interpolate --quiet`).
- Workflow contract tests: `make scripts-test`
  (`python3 -m unittest discover -s scripts/tests -p 'test_*.py'`), including
  `test_delivery_contract.py`, `test_production_image_transfer.py`,
  `test_validate_delivery_env.py`, `test_build_daemon_distribution.py`.
- UI-facing changes: visible `./twd` evidence with a `REAL_` marker; the
  committed Playwright flow is cross-layer CI, not UI acceptance.
- Release-level: `python3 scripts/initial_release_foundation_gate.py
  --base-url <url> --allow-http --json`.
- Post-deploy: `python3 scripts/post_deploy_smoke.py --base-url <url>
  --allow-http --json` plus `/api/health`, `/docs`, `/login`, and daemon WS.
- For image transfer changes: dry-run with `--capacity-report` first; after a
  real transfer, validate `<output-archive>.release-evidence.json` hashes,
  image identities, and tested-tree -> merge-SHA mapping.

### 7. Wrong vs Correct

#### Wrong

```text
make ci passed and I opened localhost:3000/login, so the cloud release is ready.
```

#### Correct

```text
make ci is the local static/build gate only. Release still needs formal capacity
on the candidate tree, squash merge with tree equality, registry-free image
transfer with capacity report, app-only deploy, and /api/health smoke against
http://124.222.40.40.
```

#### Wrong

```text
docker compose up -d db backend frontend caddy   # bring everything up
```

#### Correct

```text
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d \
  --force-recreate --no-deps --no-build --pull never backend frontend caddy
# db is never in the deploy command
```

#### Wrong

```text
curl http://124.222.40.40/health   # 200, backend is healthy
```

#### Correct

```text
curl http://124.222.40.40/api/health   # backend health route
# /health is routed to frontend by Caddy and is not backend-health evidence
```

#### Wrong

```text
The deploy failed, so I rolled back the frontend image to the previous tag.
```

#### Correct

```text
The deploy failed. I compared pre/post Alembic revisions. They differ, so
IMAGE_ROLLBACK_FORBIDDEN: I stopped app services, kept db running, preserved
the DB and logs, and asked the maintainer for a decision.
```
