"""LLM 调用服务。后续可扩展为多 provider 支持（参考 khoj processor/conversation/）。"""
from typing import AsyncIterator

from openai import AsyncOpenAI

from config import settings


def get_llm_client() -> AsyncOpenAI:
    """创建异步 OpenAI 兼容客户端。"""
    return AsyncOpenAI(
        api_key=settings.llm_api_key,
        base_url=settings.llm_api_base,
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
