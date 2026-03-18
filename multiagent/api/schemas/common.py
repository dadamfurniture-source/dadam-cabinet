"""공통 API 스키마"""

from pydantic import BaseModel


class APIResponse(BaseModel):
    success: bool = True
    message: str = ""
    data: dict | list | None = None
