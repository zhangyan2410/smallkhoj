#!/usr/bin/env python3
"""
Supervisor Event Watcher — polls /events, only surfaces task status changes.

Writes notifications to a file that the supervisor LLM can read on demand,
instead of burning context tokens on every poll cycle.

Usage:
  python scripts/watcher.py [--backend URL] [--notify FILE] [--interval SECONDS]

The watcher maintains its own cursor so it only sees new events each cycle.
When a task reaches `in_review` or `done`, it appends a one-line summary
to the notify file. The supervisor reads the file when ready, then clears it.
"""

import json
import os
import sys
import time
import argparse
from pathlib import Path

try:
    import urllib.request
    import urllib.error
except ImportError:
    sys.exit("Python 3 required")


DEFAULT_BACKEND = os.environ.get("SMALLKHOJ_BACKEND", "http://127.0.0.1:8000")
DEFAULT_NOTIFY = os.environ.get(
    "SMALLKHOJ_NOTIFY_FILE",
    str(Path(__file__).resolve().parent.parent / ".trellis" / ".runtime" / "supervisor-notifications.jsonl"),
)
DEFAULT_INTERVAL = int(os.environ.get("SMALLKHOJ_WATCH_INTERVAL", "5"))
AGENT_TOKEN = os.environ.get("SMALLKHOJ_AGENT_TOKEN", "sk_agent_aaa_local")
AGENT_ID = os.environ.get("SMALLKHOJ_AGENT_ID", "aaaa0000-0000-0000-0000-000000000001")

# Task events that warrant supervisor attention
NOTIFY_STATUSES = {"in_review", "done"}
# Also notify on task_created so supervisor knows work was dispatched
NOTIFY_TYPES = {"task_created", "task_updated"}


def api_get(path: str, params: dict | None = None) -> dict:
    url = f"{DEFAULT_BACKEND}{path}"
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
        if qs:
            url += f"?{qs}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {AGENT_TOKEN}",
        "X-Agent-Id": AGENT_ID,
    })
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def append_notification(notify_path: str, event: dict):
    line = {
        "ts": event.get("occurredAt") or time.strftime("%Y-%m-%dT%H:%M:%S"),
        "type": event.get("type"),
        "taskNumber": event.get("taskNumber"),
        "status": event.get("status"),
        "title": event.get("title"),
        "actor": event.get("description", ""),
        "eventSeq": event.get("eventSeq"),
    }
    Path(notify_path).parent.mkdir(parents=True, exist_ok=True)
    with open(notify_path, "a") as f:
        f.write(json.dumps(line, ensure_ascii=False) + "\n")


def poll_once(cursor_file: str, notify_path: str) -> int:
    """One poll cycle. Returns number of notifications written."""
    # Read saved cursors
    event_log_cursor = "0"
    if os.path.exists(cursor_file):
        try:
            with open(cursor_file) as f:
                event_log_cursor = f.read().strip() or "0"
        except Exception:
            pass

    resp = api_get("/internal/agent-api/events", {"eventLogCursor": event_log_cursor})
    events = resp.get("events", [])
    new_cursor = resp.get("eventLogCursor", event_log_cursor)

    count = 0
    for ev in events:
        ev_type = ev.get("type", "")
        if ev_type not in NOTIFY_TYPES:
            continue
        # For task_updated, only notify on interesting statuses
        if ev_type == "task_updated":
            status = ev.get("status") or ev.get("details", {}).get("status", "")
            if status not in NOTIFY_STATUSES:
                continue
        append_notification(notify_path, ev)
        count += 1

    # Save cursor
    with open(cursor_file, "w") as f:
        f.write(str(new_cursor))

    return count


def read_notifications(notify_path: str) -> list[dict]:
    """Read and clear notifications. Returns list of notification dicts."""
    if not os.path.exists(notify_path):
        return []
    with open(notify_path) as f:
        lines = f.readlines()
    # Clear the file
    with open(notify_path, "w") as f:
        f.truncate(0)
    return [json.loads(line) for line in lines if line.strip()]


def main():
    global DEFAULT_BACKEND

    parser = argparse.ArgumentParser(description="Supervisor Event Watcher")
    parser.add_argument("--backend", default=DEFAULT_BACKEND, help="Backend URL")
    parser.add_argument("--notify", default=DEFAULT_NOTIFY, help="Notification file path")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL, help="Poll interval in seconds")
    parser.add_argument("--once", action="store_true", help="Poll once and exit")
    parser.add_argument("--read", action="store_true", help="Read and clear pending notifications, then exit")
    args = parser.parse_args()

    DEFAULT_BACKEND = args.backend

    cursor_file = str(Path(args.notify).with_suffix(".cursor"))

    if args.read:
        notifs = read_notifications(args.notify)
        if not notifs:
            print("No pending notifications.")
        else:
            for n in notifs:
                status = n.get("status", "")
                tn = n.get("taskNumber", "?")
                title = n.get("title", "")
                actor = n.get("actor", "")
                print(f"[{n.get('ts', '')}] {n['type']} #{tn} status={status} | {title} | {actor}")
        return

    if args.once:
        n = poll_once(cursor_file, args.notify)
        print(f"Polled once: {n} notification(s)")
        return

    print(f"Watcher started — polling {args.backend} every {args.interval}s")
    print(f"Notifications → {args.notify}")
    print(f"Cursor file   → {cursor_file}")
    print("Press Ctrl+C to stop.\n")

    while True:
        try:
            n = poll_once(cursor_file, args.notify)
            if n:
                print(f"[{time.strftime('%H:%M:%S')}] {n} new task notification(s)")
        except urllib.error.URLError as e:
            print(f"[{time.strftime('%H:%M:%S')}] Backend unreachable: {e}")
        except Exception as e:
            print(f"[{time.strftime('%H:%M:%S')}] Error: {e}")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
