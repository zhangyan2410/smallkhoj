from __future__ import annotations

import json
import sys
import time


for line in sys.stdin:
    payload = json.loads(line)
    if payload.get("mode") == "sleep":
        time.sleep(float(payload.get("seconds", 1)))
    print(json.dumps({"type": "ack", "input": payload}), flush=True)
