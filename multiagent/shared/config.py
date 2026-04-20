"""다담 SaaS 설정 — pydantic-settings로 환경변수 자동 로딩 + 검증"""

import logging
import sys

from pydantic import Field
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    # Supabase (필수)
    supabase_url: str = Field(default="")
    supabase_anon_key: str = Field(default="")
    supabase_service_key: str = Field(default="", alias="SUPABASE_SERVICE_ROLE_KEY")

    # API Keys (선택 — 기능별 필요 시 검증)
    anthropic_api_key: str = ""
    google_api_key: str = ""
    replicate_api_token: str = ""
    openai_api_key: str = ""

    # Stripe
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_basic: str = ""
    stripe_price_pro: str = ""
    stripe_price_enterprise: str = ""

    # Toss Payments (빌링)
    toss_client_key: str = ""
    toss_secret_key: str = ""
    toss_webhook_secret: str = ""
    toss_price_basic_krw: int = 99000
    toss_price_pro_krw: int = 199000
    toss_price_enterprise_krw: int = 299000
    default_payment_provider: str = "toss"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Monitoring
    sentry_dsn: str = ""

    # App
    environment: str = "development"
    api_base_url: str = "http://localhost:8000"
    cors_origins_raw: str = Field(
        default="http://localhost:3000,http://localhost:8000",
        alias="CORS_ORIGINS",
    )

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins_raw.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
        "populate_by_name": True,
    }


settings = Settings()

# 프로덕션에서 필수 설정 누락 시 경고
if settings.is_production:
    missing = []
    if not settings.supabase_url:
        missing.append("SUPABASE_URL")
    if not settings.supabase_service_key:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if missing:
        logger.critical(f"FATAL: Missing required env vars for production: {missing}")
        sys.exit(1)

    # Stripe 미설정 시 경고만 (계정 없으면 결제 기능 비활성)
    if not settings.stripe_webhook_secret:
        logger.warning("STRIPE_WEBHOOK_SECRET not set — payment features disabled")
