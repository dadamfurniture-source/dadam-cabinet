"""토스페이먼츠 빌링 API 얇은 래퍼.

구독(빌링) 전용. 1회성 결제(기본 결제 패키지)는 별도 PR에서 추가.

docs: https://docs.tosspayments.com/reference
"""

from __future__ import annotations

import base64
import logging
from typing import Any

import httpx

from shared.config import settings

logger = logging.getLogger(__name__)

TOSS_API_BASE = "https://api.tosspayments.com"


class TossError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(f"[{code}] {message}")


def _auth_header() -> dict[str, str]:
    if not settings.toss_secret_key:
        raise TossError("CONFIG_MISSING", "TOSS_SECRET_KEY is not configured", 500)
    token = base64.b64encode(f"{settings.toss_secret_key}:".encode()).decode()
    return {"Authorization": f"Basic {token}", "Content-Type": "application/json"}


async def _post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{TOSS_API_BASE}{path}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, json=payload, headers=_auth_header())

    if resp.status_code >= 400:
        try:
            err = resp.json()
            raise TossError(
                err.get("code", "UNKNOWN"),
                err.get("message", "Toss API error"),
                resp.status_code,
            )
        except ValueError:
            raise TossError("INVALID_RESPONSE", resp.text, resp.status_code)

    return resp.json()


async def issue_billing_key(auth_key: str, customer_key: str) -> dict[str, Any]:
    """프론트 위젯이 반환한 authKey 를 billingKey 로 교환."""
    return await _post(
        "/v1/billing/authorizations/issue",
        {"authKey": auth_key, "customerKey": customer_key},
    )


async def charge_billing_key(
    billing_key: str,
    customer_key: str,
    amount: int,
    order_id: str,
    order_name: str,
    customer_email: str | None = None,
    customer_name: str | None = None,
    tax_free_amount: int = 0,
) -> dict[str, Any]:
    """빌링키로 자동결제 승인."""
    payload: dict[str, Any] = {
        "customerKey": customer_key,
        "amount": amount,
        "orderId": order_id,
        "orderName": order_name,
        "taxFreeAmount": tax_free_amount,
    }
    if customer_email:
        payload["customerEmail"] = customer_email
    if customer_name:
        payload["customerName"] = customer_name

    return await _post(f"/v1/billing/{billing_key}", payload)
