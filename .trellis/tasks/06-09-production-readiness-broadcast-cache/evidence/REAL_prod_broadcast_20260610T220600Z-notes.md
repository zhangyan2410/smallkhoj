# REAL_prod_broadcast_20260610T220600Z

## Scope

This pass produced a production readiness gap analysis and a concrete multi-instance test plan rather than adding Redis/broadcast code.

## Evidence

* Gap analysis: `../architecture-gap-analysis.md`
* Identified process-local assumptions:
  * `DaemonControlHub` socket peers are in memory.
  * lifecycle command pushes only reach daemons connected to the same backend process.
  * durable rows exist in `event_records`, but live fanout is process-local.
* Specified required backend changes:
  * broadcast interface
  * Redis/Postgres pub-sub implementation option
  * commit-before-publish ordering
  * local in-memory default
* Multi-instance behavior is testable with two backend ports, one shared DB, and one broadcast backend.

## Local Development

No Redis is required for local single-process work. The current in-process hub remains the default.
