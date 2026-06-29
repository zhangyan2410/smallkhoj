# Initial release deployment bundle

## Goal

Create a repeatable no-secret deployment bundle generator for the 7-15 initial release. The bundle should let us upload a small tarball to Tencent Cloud Lighthouse and run host probe, deploy preflight, post-deploy smoke, compose, and Caddy configuration without copying the full repository.

## Requirements

- Provide a repository-local CLI under `scripts/` that creates a `.tar.gz` bundle.
- The bundle must include only deployment runtime files: production compose, Caddyfile, deployment docs, and deployment probe/preflight/smoke scripts plus a generated README and manifest.
- The bundle must not include `.env.prod`, local databases, node modules, Python caches, git metadata, task archives, or secrets.
- The generated manifest must include file paths, sizes, SHA-256 hashes, and the current git commit when available.
- The generated README must show the command order for Lighthouse: host probe, env/preflight, compose up, post-deploy smoke.
- Tests must inspect the tarball contents and manifest without extracting untrusted paths.

## Acceptance Criteria

- [x] A new deployment bundle CLI exists under `scripts/`.
- [x] Tests cover bundle contents, manifest hashes, README generation, and exclusion of env/secrets.
- [x] A local bundle can be generated under `/tmp`.
- [x] Deployment docs include how to create and use the bundle.
- [x] The task is archived and committed.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
