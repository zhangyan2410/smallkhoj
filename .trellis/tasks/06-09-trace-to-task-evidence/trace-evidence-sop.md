# Trace Evidence SOP

## Purpose

Turn `smallkhoj-trace` output into concise task evidence without pasting full logs into product notes.

## Capture

```bash
mkdir -p .trellis/tasks/<task>/evidence
./smallkhoj-trace summary --json \
  > .trellis/tasks/<task>/evidence/REAL_trace_evidence_<timestamp>-trace-summary.raw.json
```

## Summarize

Create a short Markdown note with:

* marker
* browser/API source link
* trace raw file path
* 3-6 relevant facts
* any blocked/missing trace lines

Keep the raw JSON beside the summary for deep debugging.

## Evidence Run

Marker: `REAL_debug_workbench_20260610T220300Z`

Raw trace: `evidence/REAL_trace_evidence_20260610T220300Z-trace-summary.raw.json`

Workbench screenshot: `evidence/REAL_trace_evidence_20260610T220300Z-01-workbench-reference.png`

Concise summary: `evidence/REAL_trace_evidence_20260610T220300Z-notes.md`
