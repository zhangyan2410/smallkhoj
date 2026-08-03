from __future__ import annotations

import json
import sys


for line in sys.stdin:
    request = json.loads(line)
    method = request["method"]
    request_id = request["id"]
    params = request.get("params", {})
    if method == "initialize":
        result = {"protocolVersion": 1, "agentCapabilities": {"loadSession": False}}
    elif method == "session/new":
        result = {"sessionId": "acp-session-1"}
    elif method == "session/prompt":
        text = params["prompt"][0]["text"]
        print(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "method": "session/update",
                    "params": {
                        "sessionId": params["sessionId"],
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": {"type": "text", "text": f"echo:{text}"},
                        },
                    },
                }
            ),
            flush=True,
        )
        result = {"stopReason": "end_turn"}
    elif method == "session/set_config_option":
        result = {
            "configOptions": [
                {
                    "id": params["configId"],
                    "currentValue": params["value"],
                }
            ]
        }
    elif method == "session/cancel":
        result = {}
    else:
        result = {"method": method, "accepted": True}
    print(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}), flush=True)
