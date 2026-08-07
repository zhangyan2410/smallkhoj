# 统一提交与云端发布工作流入口

## Goal

Provide one operator-controlled release workflow entry that makes the normal
SmallKhoj path predictable: inspect the candidate, choose the scope-matched
checks, derive the daemon/artifact version from the candidate, optionally commit
and push, build/validate the Windows carrier and production images, transfer the
images and bundle, perform an app-only cloud update, and run version-aware smoke.
The workflow must be fast by default, fail closed at dangerous boundaries, and
avoid requiring the user to supervise every individual Agent decision.

## Confirmed facts

- `make ci` is the broad local matrix (`Makefile:114`) and is too slow as the
  default release preflight.
- `scripts/production_image_transfer.py` enforces a clean HEAD, image revision
  labels, daemon artifact checksums, and either a formal capacity report or an
  explicit task-scoped gate. Its current archive validator must support both
  legacy Docker Config paths and OCI `blobs/sha256/<digest>` paths.
- `scripts/post_deploy_smoke.py` in the repository already supports
  `--daemon-package-version` and resolves explicit version → `DAEMON_RELEASE_VERSION`
  → one generated release manifest (`scripts/post_deploy_smoke.py:121-170, 600-626`).
  The observed `0.2.1` failure came from a stale remote deployment bundle, not
  the current source.
- `scripts/make_deployment_bundle.py` packages the compose file and deployment
  scripts but is separate from image transfer; stale remote bundles can therefore
  pair old smoke/version logic with new images.
- `docker-compose.prod.yml:16,60,80,111` selects app images through
  `SMALLKHOJ_BACKEND_IMAGE`, `SMALLKHOJ_FRONTEND_IMAGE`, and
  `SMALLKHOJ_CADDY_IMAGE`; an app-only deployment must never include `db`.
- The current `docker save` archive was 849.2MB; `gzip -1` reduced it to about
  444MB, `gzip -9` to about 416MB, and `zstd -1` to about 431MB. The remote host
  has both gzip and zstd.
- Release secrets must remain outside Git and may be read transiently from the
  server-side `.env.prod`; the workflow must never echo or persist secret values.

## Requirements

### R1. One explicit release entry

Expose one documented command (recommended: `make release`) with a dry-run/plan
mode as the default. A separate explicit apply/execute mode is required before
any commit, push, SSH upload, remote compose, or other external mutation.

### R2. Scope-aware fast path

The entry must support a fast task-scoped deployment path without automatically
running the full `make ci` matrix or formal capacity profile. Formal release and
capacity claims remain opt-in and must retain the existing fail-closed gate.

### R3. Candidate identity and version derivation

The workflow must bind one candidate identity across Git HEAD/tree, daemon
manifest `sourceRevision`, image revision labels, deployment bundle manifest,
image tags, and smoke `--daemon-package-version`. No historical daemon version
literal may be used as a fallback. A missing/ambiguous version fails before
external side effects.

### R4. Bundle and image consistency

The deployment bundle and image archive must be generated from the same clean
candidate. The remote app-only compose must use the candidate image tags through
command-level or atomically updated non-secret env values; it must not silently
fall back to stale tags from an older `.env.prod`.

### R5. Compressed archive transfer

After image identity/archive validation, optionally compress the Docker save tar
with gzip or zstd, upload the compressed file, decompress remotely, verify the
original tar SHA-256, and only then load the images. Release evidence records the
raw archive hash and compression metadata. The default for the first MVP should
be gzip level 1 or another fast, widely available mode.

### R6. Safe cloud update

The workflow must deploy only `backend frontend caddy` with `--no-deps --no-build
--pull never`; it must not recreate or pull `db`. Before and after image IDs,
container states, and database identity must be checkable without exposing
secrets. Smoke must run against the actual cloud URL with the candidate daemon
package version.

### R7. Commit/push control

Commit and push are separate explicit steps in the plan and must be visible
before execution. A clean candidate may be deployed without creating a commit;
if the workflow commits, the committed/pushed HEAD becomes the only candidate
identity used for all later artifacts.

## Acceptance Criteria

- [ ] Default invocation prints a complete plan and performs no external
  mutation.
- [ ] Fast task-scoped mode completes the focused check set without invoking
  the full `make ci` matrix unless explicitly requested.
- [ ] Version selection resolves from the generated manifest or explicit input;
  the workflow and remote bundle contain no historical hardcoded `0.2.1`
  fallback.
- [ ] A stale remote bundle or stale compose image tags fail closed before
  app-only restart, or are replaced through the workflow's explicit candidate
  update step.
- [ ] Raw and compressed archive hashes are recorded; decompression and remote
  `docker load` verify the raw archive identity before images are used.
- [ ] Cloud execution proves new backend/frontend/caddy image IDs are running,
  database container identity is unchanged, and candidate-version smoke passes.
- [ ] A single focused unit/contract test target covers plan generation,
  version resolution, compression/decompression, stale-tag detection, and the
  `db` exclusion.

## Out of scope

- Replacing Docker/Compose, introducing a registry, or changing the database
  schema.
- Automatically running formal `formal-300-500-30-v1` capacity tests for every
  task-scoped deployment.
- Automatically archiving/completing unrelated Trellis tasks.
- Hiding commit/push/cloud mutations behind an implicit default invocation.

## Open question

- Decide whether the single entry should be a Make target (`make release`) or a
  dedicated Python CLI (`python3 scripts/release_workflow.py`) with Make as a
  thin wrapper. Recommended: Python owns the plan/state machine and `make
  release` is the discoverable wrapper, because the existing release logic and
  JSON evidence are Python-based while Make remains easy to find.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
