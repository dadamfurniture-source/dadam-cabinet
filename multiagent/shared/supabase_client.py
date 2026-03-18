"""Supabase 클라이언트 — 서비스용(service_role) + 사용자용(anon) 분리"""

from functools import lru_cache

from supabase import Client, create_client

from shared.config import settings


@lru_cache(maxsize=1)
def get_service_client() -> Client:
    """서버 에이전트용 클라이언트 (RLS 바이패스)
    - 에이전트가 모든 테이블에 자유롭게 접근
    - API 라우트의 내부 로직에서 사용
    """
    return create_client(settings.supabase_url, settings.supabase_service_key)


def get_user_client(access_token: str) -> Client:
    """사용자 인증 기반 클라이언트 (RLS 적용)
    - 프론트엔드에서 전달받은 JWT 토큰으로 생성
    - 해당 사용자의 데이터만 접근 가능
    """
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    client.auth.set_session(access_token, "")
    return client
