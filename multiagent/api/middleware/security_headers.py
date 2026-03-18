"""보안 헤더 미들웨어 — OWASP 권장 HTTP 보안 헤더 자동 추가"""

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """모든 응답에 보안 헤더를 추가합니다.

    - X-Content-Type-Options: MIME 스니핑 방지
    - X-Frame-Options: 클릭재킹 방지
    - Strict-Transport-Security: HTTPS 강제
    - Referrer-Policy: 리퍼러 정보 최소화
    - X-XSS-Protection: 레거시 XSS 필터
    - Permissions-Policy: 브라우저 기능 접근 제한
    - Content-Security-Policy: 인라인 스크립트 허용 (SPA 특성), 외부는 CDN 화이트리스트
    """

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

        # HSTS: HTTPS 환경에서만 적용 (로컬 개발 시 제외)
        if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        # CSP: 인라인 스크립트 허용 (static HTML + inline JS 구조), Supabase CDN 허용
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:; "
            "connect-src 'self' https://*.supabase.co https://api.stripe.com https://cdn.jsdelivr.net; "
            "frame-ancestors 'none'"
        )

        return response
