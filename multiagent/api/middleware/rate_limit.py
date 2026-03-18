"""Rate Limiting 미들웨어 — IP 기반 요청 제한 (인메모리)"""

import time
from collections import defaultdict

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """경로별 차등 Rate Limiting.

    - /api/v1/payments/webhook: 100/min (Stripe)
    - /api/v1/admin/*: 30/min
    - /api/v1/enterprise/*: 60/min
    - /api/v1/*: 120/min (일반 API)
    - Other: 300/min (static files 등)
    """

    def __init__(self, app):
        super().__init__(app)
        self._buckets: dict[str, list[float]] = defaultdict(list)

    def _get_limit(self, path: str) -> int:
        if path.startswith("/api/v1/payments/webhook"):
            return 100
        if path.startswith("/api/v1/admin"):
            return 30
        if path.startswith("/api/v1/enterprise"):
            return 60
        if path.startswith("/api/v1"):
            return 120
        return 300

    def _get_client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        # Health check 등은 제한 없이 통과
        if request.url.path in ("/health", "/"):
            return await call_next(request)

        client_ip = self._get_client_ip(request)
        path_prefix = (
            request.url.path.rsplit("/", 1)[0]
            if "/api/v1" in request.url.path
            else request.url.path
        )
        bucket_key = f"{client_ip}:{path_prefix}"
        limit = self._get_limit(request.url.path)

        now = time.time()
        window = 60.0  # 1분 윈도우

        # 만료된 요청 제거
        timestamps = self._buckets[bucket_key]
        self._buckets[bucket_key] = [t for t in timestamps if now - t < window]

        if len(self._buckets[bucket_key]) >= limit:
            return Response(
                content='{"success":false,"message":"요청 한도를 초과했습니다. 잠시 후 다시 시도하세요."}',
                status_code=429,
                media_type="application/json",
                headers={
                    "Retry-After": "60",
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                },
            )

        self._buckets[bucket_key].append(now)

        response = await call_next(request)
        remaining = max(0, limit - len(self._buckets[bucket_key]))
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
