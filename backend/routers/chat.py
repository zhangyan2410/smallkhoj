"""WebSocket 聊天路由。参考 khoj 的 /api/chat/ws 协议。"""
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.llm import chat_stream

router = APIRouter()


@router.websocket("/api/chat/ws")
async def chat_websocket(ws: WebSocket):
    await ws.accept()
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
