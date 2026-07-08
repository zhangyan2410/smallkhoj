# Database Observation SOP

## Purpose

Use this SOP for read-only marker debugging. Start from a unique `REAL_*` marker, then follow it from browser/API to database rows and event records.

## Find The Active Database

Do not assume the port. Check the running backend first:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

Then test likely local databases:

```bash
for port in 5432 55432; do
  PGPASSWORD=smallkhoj psql -h 127.0.0.1 -p "$port" -U smallkhoj -d smallkhoj \
    -c "select count(*) from messages;"
done
```

This evidence run used PostgreSQL on `127.0.0.1:5432`. Port `55432` was a separate worker/test database and did not contain the marker.

## Safe Read-Only Rules

* Use `SELECT` only.
* Do not run `UPDATE`, `DELETE`, `INSERT`, `TRUNCATE`, or DDL from an observation session.
* Copy IDs from results into the next query rather than editing rows.

## Marker Queries

Messages:

```sql
SELECT m.id, m.short_id, c.name AS channel, m.content, m.created_at
FROM messages m
JOIN channels c ON c.id = m.channel_id
WHERE m.content LIKE '%REAL_marker_here%'
ORDER BY m.created_at DESC
LIMIT 5;
```

Event records:

```sql
SELECT e.seq, e.event_type, e.message_id, e.payload->>'content' AS content
FROM event_records e
WHERE e.payload::text LIKE '%REAL_marker_here%'
ORDER BY e.seq DESC
LIMIT 10;
```

Tasks by marker:

```sql
SELECT t.id, t.task_number, t.title, t.status, t.created_at
FROM tasks t
WHERE t.title LIKE '%REAL_marker_here%' OR t.description LIKE '%REAL_marker_here%'
ORDER BY t.created_at DESC
LIMIT 5;
```

## Evidence Run

Marker: `REAL_debug_workbench_20260610T220300Z`

Saved DB output: `evidence/REAL_db_observe_20260610T220300Z-psql.txt`

Result: the marker appears in `messages` and corresponding `message.created` rows in `event_records`, matching the browser/API search result in the debug workbench.
