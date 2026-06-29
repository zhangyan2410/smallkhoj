# Implementation plan

## Steps

1. Add failing unit tests in `scripts/tests/test_initial_release_foundation_gate.py` for:
   - daemon runtime workspace contract pass and missing-marker failure;
   - daemon minimum-version contract pass and missing-marker failure;
   - workflow-state prompt contract pass and missing hook/workflow marker failure.
2. Implement the new checks in `scripts/initial_release_foundation_gate.py`.
3. Wire the checks into the default foundation gate run.
4. Run focused script tests.
5. Run the full supplemented foundation gate against `http://124.222.40.40`.
6. Save evidence under this task.
7. Run Trellis task validation, commit, and archive.

## Validation Commands

```bash
rtk python3 -m unittest scripts/tests/test_initial_release_foundation_gate.py
rtk python3 scripts/initial_release_foundation_gate.py --base-url http://124.222.40.40 --allow-http --json
rtk python3 ./.trellis/scripts/task.py validate 06-29-initial-release-daemon-prompt-gate-refresh
```
