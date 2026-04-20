"""토스페이먼츠 빌링 구독 API.

플로우:
1. 프론트 위젯이 `@tosspayments/payment-sdk` 로 카드 인증 → authKey 획득
2. POST /payments/toss/issue-billing-key → authKey 를 billingKey 로 교환 + 첫 과금
3. POST /payments/toss/charge → 관리자 수동 재시도 (스케줄러가 없을 때 대체)
4. POST /payments/toss/cancel → 빌링키 폐기 + 구독 종료
5. POST /payments/toss/webhook → 가상계좌 입금/결제 실패 이벤트
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from api.middleware.auth import CurrentUser, get_current_user
from api.schemas.common import APIResponse
from shared.config import settings
from shared.supabase_client import get_service_client
from shared.toss_client import (
    TossError,
    charge_billing_key,
    issue_billing_key,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments/toss", tags=["Payments - Toss"])

PLAN_PRICES: dict[str, int] = {
    "basic": settings.toss_price_basic_krw,
    "pro": settings.toss_price_pro_krw,
    "enterprise": settings.toss_price_enterprise_krw,
}

PLAN_NAMES: dict[str, str] = {
    "basic": "다담가구 Basic 플랜 (월간)",
    "pro": "다담가구 Pro 플랜 (월간)",
    "enterprise": "다담가구 Enterprise 플랜 (월간)",
}


class IssueBillingKeyRequest(BaseModel):
    auth_key: str
    customer_key: str
    plan: str


class CancelRequest(BaseModel):
    reason: str | None = None


def _customer_key(user: CurrentUser) -> str:
    return f"dadam-{user.id}"


def _validate_plan(plan: str) -> int:
    if plan not in PLAN_PRICES:
        raise HTTPException(400, f"유효하지 않은 플랜: {plan}")
    return PLAN_PRICES[plan]


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ===== 빌링키 발급 + 첫 과금 =====


@router.post("/issue-billing-key", response_model=APIResponse)
async def issue_billing_key_endpoint(
    body: IssueBillingKeyRequest,
    user: CurrentUser = Depends(get_current_user),
):
    amount = _validate_plan(body.plan)
    expected_key = _customer_key(user)

    if body.customer_key != expected_key:
        raise HTTPException(400, "customerKey 불일치")

    try:
        billing = await issue_billing_key(body.auth_key, body.customer_key)
    except TossError as e:
        logger.error(f"Toss issue_billing_key failed: {e}")
        raise HTTPException(e.status_code, e.message)

    billing_key = billing["billingKey"]
    client = get_service_client()

    order_id = f"dadam-sub-{user.id}-{uuid.uuid4().hex[:12]}"
    try:
        charge = await charge_billing_key(
            billing_key=billing_key,
            customer_key=body.customer_key,
            amount=amount,
            order_id=order_id,
            order_name=PLAN_NAMES[body.plan],
            customer_email=user.email,
            customer_name=user.company_name,
        )
    except TossError as e:
        logger.error(f"Toss first charge failed: {e}")
        raise HTTPException(e.status_code, f"첫 과금 실패: {e.message}")

    now = _now_utc()
    next_charge = now + timedelta(days=30)

    sub_data = {
        "user_id": user.id,
        "plan": body.plan,
        "provider": "toss",
        "provider_customer_id": body.customer_key,
        "provider_subscription_id": billing_key,
        "billing_key": billing_key,
        "amount_krw": amount,
        "status": "active",
        "current_period_start": now.isoformat(),
        "current_period_end": next_charge.isoformat(),
        "next_charge_at": next_charge.isoformat(),
    }

    existing = (
        client.table("subscriptions")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if existing.data:
        sub_id = existing.data[0]["id"]
        client.table("subscriptions").update(sub_data).eq("id", sub_id).execute()
    else:
        res = client.table("subscriptions").insert(sub_data).execute()
        sub_id = res.data[0]["id"] if res.data else None

    client.table("profiles").update({"plan": body.plan}).eq("id", user.id).execute()

    client.table("payment_history").insert(
        {
            "user_id": user.id,
            "subscription_id": sub_id,
            "provider": "toss",
            "order_id": order_id,
            "payment_key": charge.get("paymentKey"),
            "plan": body.plan,
            "amount_krw": amount,
            "status": "done" if charge.get("status") == "DONE" else "pending",
            "method": charge.get("method"),
            "receipt_url": (charge.get("receipt") or {}).get("url"),
            "raw_response": charge,
        }
    ).execute()

    return APIResponse(
        message=f"{body.plan} 플랜 구독이 시작되었습니다.",
        data={
            "plan": body.plan,
            "amount_krw": amount,
            "next_charge_at": next_charge.isoformat(),
            "receipt_url": (charge.get("receipt") or {}).get("url"),
        },
    )


# ===== 관리자 수동 재시도 (스케줄러 없을 때 보강용) =====


@router.post("/charge", response_model=APIResponse)
async def manual_charge(user: CurrentUser = Depends(get_current_user)):
    client = get_service_client()
    sub_res = (
        client.table("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .eq("provider", "toss")
        .in_("status", ["active", "past_due"])
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not sub_res.data:
        raise HTTPException(400, "활성 Toss 구독이 없습니다.")

    sub = sub_res.data[0]
    billing_key = sub.get("billing_key")
    if not billing_key:
        raise HTTPException(500, "빌링키가 없습니다.")

    order_id = f"dadam-sub-{user.id}-{uuid.uuid4().hex[:12]}"
    try:
        charge = await charge_billing_key(
            billing_key=billing_key,
            customer_key=sub["provider_customer_id"],
            amount=sub["amount_krw"],
            order_id=order_id,
            order_name=PLAN_NAMES.get(sub["plan"], "다담가구 구독"),
            customer_email=user.email,
        )
    except TossError as e:
        client.table("payment_history").insert(
            {
                "user_id": user.id,
                "subscription_id": sub["id"],
                "provider": "toss",
                "order_id": order_id,
                "plan": sub["plan"],
                "amount_krw": sub["amount_krw"],
                "status": "failed",
                "failure_code": e.code,
                "failure_message": e.message,
            }
        ).execute()
        raise HTTPException(e.status_code, e.message)

    now = _now_utc()
    next_charge = now + timedelta(days=30)

    client.table("subscriptions").update(
        {
            "status": "active",
            "current_period_start": now.isoformat(),
            "current_period_end": next_charge.isoformat(),
            "next_charge_at": next_charge.isoformat(),
        }
    ).eq("id", sub["id"]).execute()

    client.table("payment_history").insert(
        {
            "user_id": user.id,
            "subscription_id": sub["id"],
            "provider": "toss",
            "order_id": order_id,
            "payment_key": charge.get("paymentKey"),
            "plan": sub["plan"],
            "amount_krw": sub["amount_krw"],
            "status": "done" if charge.get("status") == "DONE" else "pending",
            "method": charge.get("method"),
            "receipt_url": (charge.get("receipt") or {}).get("url"),
            "raw_response": charge,
        }
    ).execute()

    return APIResponse(message="결제 재시도 성공", data={"next_charge_at": next_charge.isoformat()})


# ===== 구독 취소 =====


@router.post("/cancel", response_model=APIResponse)
async def cancel_toss_subscription(
    body: CancelRequest,
    user: CurrentUser = Depends(get_current_user),
):
    client = get_service_client()
    sub_res = (
        client.table("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .eq("provider", "toss")
        .eq("status", "active")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not sub_res.data:
        raise HTTPException(400, "활성 Toss 구독이 없습니다.")

    sub = sub_res.data[0]

    client.table("subscriptions").update(
        {
            "status": "cancelled",
            "cancel_at": sub.get("current_period_end"),
            "next_charge_at": None,
        }
    ).eq("id", sub["id"]).execute()

    logger.info(f"Toss subscription cancelled: user={user.id} reason={body.reason}")

    return APIResponse(
        message="구독이 현재 기간 종료 후 취소됩니다.",
        data={"cancel_at": sub.get("current_period_end")},
    )


# ===== 웹훅 =====


@router.post("/webhook")
async def toss_webhook(request: Request):
    """가상계좌 입금/결제 실패 이벤트.

    Toss 는 서명 헤더를 기본 제공하지 않음 — IP 화이트리스트 또는
    webhook_secret 기반 공유 토큰(헤더 매칭)으로 검증 필요.
    MVP 단계에서는 payload 로깅 + 멱등 저장만 수행.
    """
    payload = await request.json()
    client = get_service_client()

    event_id = payload.get("eventId") or payload.get("transactionKey") or str(uuid.uuid4())
    event_type = payload.get("eventType") or payload.get("status", "unknown")

    existing = (
        client.table("payment_events")
        .select("id")
        .eq("provider", "toss")
        .eq("event_id", event_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        return {"status": "duplicate"}

    client.table("payment_events").insert(
        {
            "provider": "toss",
            "event_id": event_id,
            "event_type": event_type,
            "payload": payload,
        }
    ).execute()

    logger.info(f"Toss webhook received: type={event_type} id={event_id}")

    return {"status": "ok"}


# ===== 공개 메타데이터 (프론트 플랜 카드용) =====


@router.get("/plans", response_model=APIResponse)
async def list_plans():
    """인증 불필요 — pricing 페이지에서 플랜/가격 표시용."""
    return APIResponse(
        data={
            "client_key": settings.toss_client_key,
            "plans": [
                {
                    "id": "basic",
                    "name": "Basic",
                    "price_krw": PLAN_PRICES["basic"],
                    "order_name": PLAN_NAMES["basic"],
                },
                {
                    "id": "pro",
                    "name": "Pro",
                    "price_krw": PLAN_PRICES["pro"],
                    "order_name": PLAN_NAMES["pro"],
                },
                {
                    "id": "enterprise",
                    "name": "Enterprise",
                    "price_krw": PLAN_PRICES["enterprise"],
                    "order_name": PLAN_NAMES["enterprise"],
                },
            ],
        }
    )
