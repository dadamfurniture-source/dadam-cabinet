"""글로벌 에러 핸들러 — 일관된 에러 응답 포맷"""

import logging
import traceback

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


def register_error_handlers(app: FastAPI):
    """FastAPI 앱에 글로벌 에러 핸들러 등록"""

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "message": exc.detail if isinstance(exc.detail, str) else str(exc.detail),
                "data": None,
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        errors = []
        for error in exc.errors():
            field = " → ".join(str(loc) for loc in error["loc"])
            errors.append({"field": field, "message": error["msg"]})

        return JSONResponse(
            status_code=422,
            content={
                "success": False,
                "message": "요청 데이터가 유효하지 않습니다.",
                "data": {"errors": errors},
            },
        )

    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception):
        logger.error(f"Unhandled error: {request.method} {request.url.path} — {exc}")
        logger.debug(traceback.format_exc())

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "message": "서버 내부 오류가 발생했습니다.",
                "data": None,
            },
        )
