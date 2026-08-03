from __future__ import annotations

import json
import sys


for line in sys.stdin:
    request = json.loads(line)
    method = request["method"]
    request_id = request["id"]
    if method == "turn/start":
        print(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "method": "turn/started",
                    "params": {"threadId": request["params"]["threadId"], "turnId": "turn-1"},
                }
            ),
            flush=True,
        )
    if method == "initialize":
        result = {"codexHome": "/tmp", "platformFamily": "unix", "platformOs": "macos", "userAgent": "fake"}
    elif method == "thread/start":
        result = {"thread": {"id": "thread-1"}}
    elif method == "turn/start":
        result = {"turn": {"id": "turn-1"}}
    elif method == "turn/steer":
        result = {"turnId": "turn-1"}
    else:
        result = {"method": method, "accepted": True}
    print(
        json.dumps(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": result,
            }
        ),
        flush=True,
    )
