# Agent Runtime Capability Probe Harness

This is a task-local, disposable capability probe harness. It does not modify
SmallKhoj production runtime code and it does not read or write Provider auth,
MCP, or global configuration.

## Non-negotiable safety rules

- A Provider receives at most two model-bearing inputs across the entire live
  probe campaign, even when a later case uses a different run ID. `turn/steer`
  counts as an input; a failed write never refunds a reservation. The shared
  ledger lives only under `/tmp/.../_live-budget/`; the task-local
  `evidence/live-budget-reconciliation-20260714.json` records the one-time
  migration from the earlier per-run ledger layout.
- Raw output exists only under `/tmp/smallkhoj-agent-runtime-capability-matrix`.
  Task evidence is written only after credential-shaped strings and home paths
  are redacted; the raw JSONL file is then deleted.
- Every spawned process must be registered with its PID, process group, cwd,
  and start marker. Cleanup never uses `pkill`, `killall`, or a global process
  name.
- Fixtures are disposable Git repositories below `/tmp`. The SmallKhoj
  checkout, home directory, external network, and real user workspaces are
  outside the probe contract.
- `preflight` accepts only `--version`, `--help`, and the local Codex schema
  generation command. It rejects prompts, sessions, resume flags, and shell
  command strings.

## Commands

```bash
rtk python3 .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cli.py \
  preflight \
  --manifest .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cases/static-preflight.json \
  --dry-run

rtk python3 -m unittest discover \
  -s .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests -v
```

Running `preflight` without `--dry-run` is still non-model-bearing, but creates
only disposable `/tmp` fixtures and sanitized task evidence. Live Provider
probes are a separate gate and must obey the shared per-provider ledger.
