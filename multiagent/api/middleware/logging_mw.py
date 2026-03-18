"""요청/응답 로깅 미들웨어 — 감사 추적 + 성능 모니터링"""

import logging
import time

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

logger = logging.getLogger("api.access")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """모든 API 요청의 메서드, 경로, 상태코드, 응답시간을 로깅."""

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        # Static 파일, health check는 스킵
        path = request.url.path
        if path.startswith("/static") or path == "/health" or path == "/favicon.ico":
            return await call_next(request)

        start = time.perf_counter()
        client_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if not client_ip and request.client:
            client_ip = request.client.host

        response = await call_next(request)

        duration_ms = round((time.perf_counter() - start) * 1000, 1)
        status = response.status_code

        # 로그 레벨: 4xx=WARNING, 5xx=ERROR, else=INFO
        if status >= 500:
            log_fn = logger.error
        elif status >= 400:
            log_fn = logger.warning
        else:
            log_fn = logger.info

        log_fn(
            "%s %s %d %sms [%s]",
            request.method,
            path,
            status,
            duration_ms,
            client_ip,
        )

        response.headers["X-Response-Time"] = f"{duration_ms}ms"
        return response
