# Task evidence GET endpoint follow-up 2026-06-10T21:44:00Z

## Prior blocker

`REAL_task_evidence_20260610T192733Z-notes.md` found that the Add Evidence and Submit Review server actions called `GET /api/v1/tasks/{taskId}`, but the endpoint was missing, causing silent no-op form submissions.

## Current verification

The public single-task endpoint now exists:

```http
GET /api/v1/tasks/4ff80113-1ec7-40f5-b0c3-78900d482ad3
HTTP/1.1 200 OK
```

The response includes the same serialized task shape as the list endpoint: `id`, `number`, `taskNumber`, `channelId`, `title`, `status`, `creatorMember`, `assigneeMember`, `data`, `createdAt`, and `updatedAt`.

## Verdict

The prior blocker is resolved. The task evidence server actions can load current task data before merging new `data.evidence.entries[]` records.
