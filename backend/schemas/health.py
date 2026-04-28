"""Health 相关 schema。"""
from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    version: str
    model_config = {"from_attributes": True}
