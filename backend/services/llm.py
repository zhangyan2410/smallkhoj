"""LLM 调用服务。后续可扩展为多 provider 支持（参考 khoj processor/conversation/）。"""
import os
from typing import AsyncIterator

import httpx
from openai import AsyncOpenAI

from config import settings


def get_llm_client() -> AsyncOpenAI:
    """创建异步 OpenAI 兼容客户端。绕过全局代理避免 socksio 依赖。"""
    http_client = httpx.AsyncClient(
        proxy=None,  # 绕过 http_proxy 环境变量
        trust_env=False,
    )
    return AsyncOpenAI(
        api_key=settings.llm_api_key,
        base_url=settings.llm_api_base,
        http_client=http_client,
    )


async def chat_stream(content: str) -> AsyncIterator[str]:
    """流式聊天，返回 token 迭代器。"""
    client = get_llm_client()
    stream = await client.chat.completions.create(
        model=settings.llm_model,
        messages=[{"role": "user", "content": content}],
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
