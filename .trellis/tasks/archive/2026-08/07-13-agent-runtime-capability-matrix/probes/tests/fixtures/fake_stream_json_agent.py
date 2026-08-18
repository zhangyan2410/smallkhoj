from __future__ import annotations

import json
import sys
import time


session_id = "session-1"
for line in sys.stdin:
    message = json.loads(line)
    text = message["message"]["content"][0]["text"]
    print(json.dumps({"type": "system", "session_id": session_id}), flush=True)
    print(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": f"working:{text}"}]}}), flush=True)
    time.sleep(0.1)
    print(json.dumps({"type": "result", "result": f"done:{text}", "session_id": session_id}), flush=True)
