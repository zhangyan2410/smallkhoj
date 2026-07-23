"""WebSocket 聊天路由。参考 khoj 的 /api/chat/ws 协议。"""

import base64
import binascii
import hmac

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import settings
from services.llm import chat_stream

router = APIRouter()
CHAT_WEBSOCKET_PROTOCOL = "smallkhoj.chat.v1"
CHAT_WEBSOCKET_KEY_PROTOCOL_PREFIX = "smallkhoj.public-key."


def _chat_websocket_key(protocol_header: str | None) -> str | None:
    protocols = [item.strip() for item in (protocol_header or "").split(",")]
    if CHAT_WEBSOCKET_PROTOCOL not in protocols:
        return None
    encoded_values = [
        item.removeprefix(CHAT_WEBSOCKET_KEY_PROTOCOL_PREFIX)
        for item in protocols
        if item.startswith(CHAT_WEBSOCKET_KEY_PROTOCOL_PREFIX)
    ]
    if len(encoded_values) != 1 or not encoded_values[0]:
        return None
    encoded = encoded_values[0]
    try:
        padded = encoded + "=" * (-len(encoded) % 4)
        return base64.b64decode(padded, altchars=b"-_", validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        return None


def _chat_websocket_authenticated(ws: WebSocket) -> bool:
    provided_key = _chat_websocket_key(ws.headers.get("sec-websocket-protocol"))
    return bool(provided_key) and hmac.compare_digest(provided_key, settings.public_api_key)


@router.websocket("/api/chat/ws")
async def chat_websocket(ws: WebSocket):
    if not _chat_websocket_authenticated(ws):
        await ws.close(code=1008, reason="Policy violation")
        return
    await ws.accept(subprotocol=CHAT_WEBSOCKET_PROTOCOL)
    try:
        while True:
            data = await ws.receive_json()
            content = data.get("q", "")
            if not content:
                await ws.send_json({"type": "error", "message": "empty query"})
                continue

            # 发送开始信号
            await ws.send_json({"type": "status", "status": "thinking"})

            # 流式发送 LLM 回复
            async for token in chat_stream(content):
                await ws.send_json({"type": "message", "content": token})

            # 结束信号（参考 khoj 的 end_response）
            await ws.send_json({"type": "status", "status": "done"})

    except WebSocketDisconnect:
        pass
