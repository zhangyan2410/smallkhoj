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
1. Deployment gate      formal capacity for release claims, or explicit task scope for functional deploys
2. Squash merge         gh pr merge --squash --match-head-commit <SHA>
3. Tree equality        origin/main^{tree} == candidate tree
4. Image build/transfer production_image_transfer.py (non-dry-run, registry-free)
5. App-only deploy      docker compose up -d ... backend frontend caddy
6. Post-deploy smoke    OPTIONAL — only when the user explicitly requests it
7. Health window        OPTIONAL — only when the user explicitly requests it
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
# Formal release/capacity claim:
python3 scripts/production_image_transfer.py \
  --host 124.222.40.40 --user ubuntu \
  --identity-file /Users/lee/.ssh/tengxun-ssh-key.pem \
  --remote-dir /home/ubuntu/smallkhoj-deploy \
  --platform linux/amd64 \
  --capacity-report <accepted-formal-report.json> \
  --use-vpn-proxy

# Functional deployment for one active Trellis task (capacityClaim=not-asserted):
# Add --skip-daemon-build when release-artifacts/smallkhoj-daemon was prepared
# from externally procured win32-x64 PE inputs on this same clean candidate.
python3 scripts/production_image_transfer.py \
  --host 124.222.40.40 --user ubuntu \
  --identity-file /Users/lee/.ssh/tengxun-ssh-key.pem \
  --remote-dir /home/ubuntu/smallkhoj-deploy \
  --platform linux/amd64 \
  --task-scoped --task-id <task-id> --skip-daemon-build \
  --use-vpn-proxy

# Phase 5 — app-only deploy (NEVER include `db` in the deploy command)
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d \
  --force-recreate --no-deps --no-build --pull never backend frontend caddy

# Phase 6 — post-deploy smoke (OPTIONAL: only run when the user explicitly asks)
# Health route is /api/health, NOT /health.
python3 scripts/post_deploy_smoke.py --base-url http://124.222.40.40 --daemon-package-version <published-package-version> --allow-http --json
```

Deploy target:

```text
Host:     124.222.40.40  (Tencent Lighthouse lhins-6gznhrts, ap-shanghai)
User:     ubuntu
Base URL: http://124.222.40.40   (HTTP:80 today; HTTPS/domain/ICP not yet established)
Remote:   /home/ubuntu/smallkhoj-deploy (current image archive + bundle parent)
          /home/ubuntu/smallkhoj-deploy/smallkhoj-deploy (Compose bundle)
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

#### Phase 1 — Deployment gate

- A formal release or capacity claim requires an accepted
  `formal-300-500-30-v1` report on the candidate tree: 300 steady SSE / 500
  peak SSE / 30 active users / 1800s active / 60s peak / 60s cleanup. See
  `formal-capacity` scenario in
  `deployment-environment-contracts.md`.
- A short `smoke` run is diagnostic only; `acceptance.passed=true` is reserved
  for the formal profile. Trusting a mutable passing summary without
  recomputation is a release-blocking validation bug.
- This formal gate applies when the operator is making a release-readiness or
  capacity claim. A task-scoped functional deployment may opt into
  `production_image_transfer.py --task-scoped --task-id <task-id>` instead; its
  release evidence must say `capacityClaim=not-asserted` and it must not be
  presented as formal capacity or initial-release evidence.

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
  `--source-revision` == current `HEAD`. Formal transfers additionally require
  the capacity report candidate tree to equal `current HEAD^{tree}`; task-scoped
  transfers require an existing matching Trellis task and make no capacity claim.
- Build context must be a clean Git candidate. Staged/unstaged/untracked files
  are release blockers. The `org.opencontainers.image.revision` label must
  equal the checked-out `HEAD`.
- Frontend production build injects `PUBLIC_API_KEY` via BuildKit secret
  (`--secret id=public_api_key,env=PUBLIC_API_KEY`), never via build args.
  BuildKit deliberately does NOT include secret content in the cache key, so a
  same-source/different-key rebuild may show `CACHED`; hash-compare the
  production public key SHA-256 against the running backend key before deploy.
- Every real transfer, including `--skip-build`, requires exactly one explicit
  deployment gate: an accepted `--capacity-report` for a formal release, or
  `--task-scoped --task-id <task-id>` for a functional task deployment. A
  stale/failed/forged formal report, a missing task, or a candidate-tree
  mismatch is a blocker.
- `--skip-daemon-build` is the single-machine Windows carrier path: it reuses a
  prebuilt, checksum-validated daemon artifact directory while still building
  the backend/frontend/Caddy images. It must not be combined with
  `--skip-build`.
- On success, atomically persist schema-versioned JSON release evidence
  (`<output-archive>.release-evidence.json`): binds tested candidate HEAD/tree,
  merge HEAD/tree, deployment scope (and formal profile + report path/hash when
  applicable), image tag/ID/revision/platform, and archive path/hash. Contains
  no secret values.

### Scenario: Docker save archive format compatibility

#### 1. Scope / Trigger

This applies to every registry-free image transfer that validates the archive
created by `docker save`, including Apple Silicon/Colima builders and remote
`docker load` targets.

#### 2. Signatures

- Input: `/tmp/smallkhoj-production-images.tar` (or the configured
  `--output-archive`) containing Docker `manifest.json` entries.
- Validator: `validate_saved_image_archive(archive_path, expected_identities)`.

#### 3. Contracts

- The validator must bind every candidate tag to the exact inspected image ID.
- It must accept both Docker's legacy config form `<digest>.json` and
  OCI/containerd's form `blobs/sha256/<digest>`.
- OCI config paths must match `^blobs/sha256/[0-9a-f]{64}$`; malformed or
  unrelated paths fail closed.
- Archive identity validation happens before SCP/upload and release evidence
  persistence.

#### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Legacy `<digest>.json` config matches inspected ID | Accept |
| OCI `blobs/sha256/<digest>` config matches inspected ID | Accept |
| Config path is malformed, duplicated, or points at an unexpected ID | Fail with archive identity error |

#### 5. Good/Base/Bad Cases

- Good: validate the archive produced by the current Docker/Colima runtime,
  then upload it unchanged.
- Base: retain legacy-format coverage for older Docker engines.
- Bad: assume every `Config` member ends in `.json`; this rejects valid OCI
  archives before transfer.

#### 6. Tests Required

- `scripts/tests/test_production_image_transfer.py` must cover legacy and OCI
  config paths, exact tag/ID binding, and malformed OCI rejection.
- A real transfer must pass the archive validator before any SCP side effect.

#### 7. Wrong vs Correct

Wrong: reject `Config: "blobs/sha256/<digest>"` because it lacks `.json`.

Correct: normalize either supported config representation to `sha256:<digest>`
and compare it with the inspected image identity.

#### Phase 5 — App-only deploy

- The only deploy command is `docker compose ... up -d --force-recreate
  --no-deps --no-build --pull never backend frontend caddy`.
- NEVER include `db` in the deploy command. A previous helper
  (`lighthouse --compose-up --use-loaded-images`) was rejected because it ran
  `docker compose pull db` / `docker compose up db`; do not reintroduce it.
- Bundle naming on the remote: `smallkhoj-deploy-__B_SHORT__` where `__B_SHORT__`
  is `git rev-parse --short=12 HEAD`, under `__REMOTE_ROOT__`.

#### Phase 6 — Post-deploy smoke and health (OPTIONAL)

**Smoke and health window are NOT part of the default deploy flow.** Only run
them when the user explicitly requests smoke testing or a health check after
deploy. Do not auto-run or assume they are required.

When the user does ask for them:
- Health endpoint is `/api/health`, NOT `/health`. `deploy/caddy/Caddyfile`
  routes `/api` and `/api/*` to backend; `/health` is routed to frontend and is
  NOT valid backend-health evidence. `scripts/post_deploy_smoke.py` probes
  `/api/health`.
- Phase 7 health window (if requested): 10-minute window sampled every 60 seconds
  (ten samples, no-clobber), with connection-budget parity `48 / 100` against
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

- Daemon source: `agent/daemon/aaa-daemon/`; its `package.json.version` is
  the sole manually maintained current candidate version. GitHub Actions reads
  that field after checkout and exports it to both
  `DAEMON_RELEASE_VERSION` and `E2E_DAEMON_VERSION` for the authenticated
  candidate flow. The workflow must not copy the current semantic version into
  either variable.
- Backend `MINIMUM_DAEMON_VERSION` is a separate compatibility policy; lower
  daemon versions get `426`. It must not be derived from the current package
  version merely to advertise a newer candidate, and production Compose must
  receive it explicitly from `.env.prod`.
- Production `DAEMON_RELEASE_VERSION` remains an explicit published-artifact
  selection. It may temporarily differ from the source candidate while a
  package is awaiting publication, but it must equal the version in the
  actually bundled and hosted tgz before onboarding is released.
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

#### Daemon-only carrier refresh

- A Daemon-only payload change still requires a new Backend carrier image because
  the Backend image serves `release-artifacts/smallkhoj-daemon/`.
- For an existing production database, load/recreate only `backend` with
  `--force-recreate --no-deps --no-build --pull never`; keep `frontend`, `caddy`,
  and `db` running.
- The smoke command must receive the actually published package version through
  `--daemon-package-version`, `DAEMON_RELEASE_VERSION`, or one unambiguous local
  generated artifact. There is no hardcoded fallback version.
- Backend local configuration follows the same boundary: source
  `package.json.version` is a candidate only and is not advertised unless the
  matching generated npm tarball is present. Production Compose remains
  explicitly configured from `.env.prod`.
- Record old/new package SHA-256, source revision, carrier image revision,
  Alembic before/after, health, package GET, and WebSocket auth rejection. A
  same-version replacement is an exception requiring a rollback copy and an
  npm/npx cache note; version equality alone is not artifact identity.

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
| `make ci` green but no formal capacity report | Not ready for a formal release/capacity claim; a functional task-scoped deploy may proceed only with `--task-scoped --task-id <task-id>` and must retain `capacityClaim=not-asserted`. |
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
  deploy; rollback anchor recorded. (Smoke/health only if explicitly requested.)
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
  --base-url <url> --daemon-package-version <published-package-version>
  --allow-http --json`.
- Post-deploy (OPTIONAL — only when user explicitly requests): `python3 scripts/post_deploy_smoke.py --base-url <url>
  --daemon-package-version <published-package-version> --allow-http --json`
  plus `/api/health`, `/docs`, `/login`, and daemon WS.
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
transfer with capacity report, and app-only deploy against
http://124.222.40.40. (Smoke/health checks only if explicitly requested.)
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
