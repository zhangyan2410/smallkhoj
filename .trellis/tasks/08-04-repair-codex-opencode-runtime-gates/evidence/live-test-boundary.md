# Live Foundation/UI test boundary

Status: `BLOCKED_CANDIDATE_IDENTITY`

The read-only real-test context collected during this task showed:

- frontend `:3000` process start: 11:13;
- backend `:8000` process start: 13:40;
- current candidate HEAD `5b192d4` commit time: 16:43.

The final read-only collector refresh also observed frontend `/` HTTP 200 at
`:3000`, while backend `/docs` at `:8000` was unreachable despite a listener.
Health alone still would not prove candidate identity.

Both shared services predate the candidate identity, so their responses cannot
prove the current working-tree Gate/UI behavior. No live Foundation result or
browser result from those processes is reported as PASS.

Safety constraints preserved:

- shared frontend/backend processes were not restarted, stopped, or killed;
- protected host PostgreSQL `127.0.0.1:5432` received no test Agent/data writes;
- `./twd` and live Foundation were not run against the stale candidate;
- no local provider/runtime configuration was changed to manufacture a pass.

Repository-pure Gate, backend, daemon, and frontend checks remain valid because
they use fake transports, temporary files/directories, and no shared services.
