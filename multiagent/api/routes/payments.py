"""결제/구독 API — Stripe Checkout + Webhook + 플랜 관리"""

import logging

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from api.middleware.auth import CurrentUser, get_current_user
from api.schemas.common import APIResponse
from shared.config import settings
from shared.supabase_client import get_service_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["Payments"])

stripe.api_key = settings.stripe_secret_key

STRIPE_PRICES = {
    "basic": settings.stripe_price_basic,
    "pro": settings.stripe_price_pro,
    "enterprise": settings.stripe_price_enterprise,
}


class CheckoutRequest(BaseModel):
    plan: str  # basic, pro, enterprise
    success_url: str = "/"
    cancel_url: str = "/"


class CancelRequest(BaseModel):
    reason: str | None = None


# ===== 현재 구독 조회 =====


@router.get("/subscription", response_model=APIResponse)
async def get_subscription(
    user: CurrentUser = Depends(get_current_user),
):
    """현재 구독 상태 조회"""
    client = get_service_client()

    sub = (
        client.table("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not sub.data:
        return APIResponse(
            data={
                "plan": "free",
                "status": "active",
                "stripe_customer_id": None,
                "current_period_end": None,
            }
        )

    return APIResponse(data=sub.data[0])


# ===== Stripe Checkout 세션 생성 =====


@router.post("/checkout", response_model=APIResponse)
async def create_checkout_session(
    body: CheckoutRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Stripe Checkout 세션 생성 → 프론트에서 redirect"""
    if body.plan not in STRIPE_PRICES or body.plan == "free":
        raise HTTPException(400, f"유효하지 않은 플랜: {body.plan}")

    price_id = STRIPE_PRICES[body.plan]
    if not price_id:
        raise HTTPException(500, f"Stripe Price ID가 설정되지 않았습니다: {body.plan}")

    # 기존 Stripe Customer 조회
    client = get_service_client()
    sub = (
        client.table("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    customer_id = (
        sub.data[0]["stripe_customer_id"]
        if sub.data and sub.data[0].get("stripe_customer_id")
        else None
    )

    session_params = {
        "mode": "subscription",
        "payment_method_types": ["card"],
        "line_items": [{"price": price_id, "quantity": 1}],
        "success_url": body.success_url + "?session_id={CHECKOUT_SESSION_ID}",
        "cancel_url": body.cancel_url,
        "metadata": {"user_id": user.id, "plan": body.plan},
        "subscription_data": {"metadata": {"user_id": user.id, "plan": body.plan}},
    }

    if customer_id:
        session_params["customer"] = customer_id
    else:
        session_params["customer_email"] = user.email

    try:
        session = stripe.checkout.Session.create(**session_params)
    except stripe.StripeError as e:
        logger.error(f"Stripe checkout error: {e}")
        raise HTTPException(500, "결제 세션 생성에 실패했습니다.")

    return APIResponse(
        message="결제 세션이 생성되었습니다.",
        data={"checkout_url": session.url, "session_id": session.id},
    )


# ===== 플랜 변경 (업/다운그레이드) =====


@router.post("/change-plan", response_model=APIResponse)
async def change_plan(
    body: CheckoutRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """기존 구독의 플랜 변경"""
    if body.plan not in STRIPE_PRICES:
        raise HTTPException(400, f"유효하지 않은 플랜: {body.plan}")

    client = get_service_client()
    sub = (
        client.table("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not sub.data or not sub.data[0].get("stripe_subscription_id"):
        raise HTTPException(400, "활성 구독이 없습니다. 먼저 checkout을 진행하세요.")

    stripe_sub_id = sub.data[0]["stripe_subscription_id"]
    new_price_id = STRIPE_PRICES[body.plan]

    if not new_price_id:
        raise HTTPException(500, f"Stripe Price ID가 설정되지 않았습니다: {body.plan}")

    try:
        stripe_sub = stripe.Subscription.retrieve(stripe_sub_id)
        item_id = stripe_sub["items"]["data"][0]["id"]

        stripe.Subscription.modify(
            stripe_sub_id,
            items=[{"id": item_id, "price": new_price_id}],
            proration_behavior="create_prorations",
            metadata={"user_id": user.id, "plan": body.plan},
        )
    except stripe.StripeError as e:
        logger.error(f"Stripe plan change error: {e}")
        raise HTTPException(500, "플랜 변경에 실패했습니다.")

    client.table("subscriptions").update(
        {
            "plan": body.plan,
        }
    ).eq("id", sub.data[0]["id"]).execute()

    client.table("profiles").update(
        {
            "plan": body.plan,
        }
    ).eq("id", user.id).execute()

    return APIResponse(
        message=f"플랜이 {body.plan}으로 변경되었습니다.",
        data={"plan": body.plan},
    )


# ===== 구독 취소 =====


@router.post("/cancel", response_model=APIResponse)
async def cancel_subscription(
    body: CancelRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """구독 취소 (현재 기간 종료 후 만료)"""
    client = get_service_client()
    sub = (
        client.table("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not sub.data or not sub.data[0].get("stripe_subscription_id"):
        raise HTTPException(400, "활성 구독이 없습니다.")

    try:
        stripe.Subscription.modify(
            sub.data[0]["stripe_subscription_id"],
            cancel_at_period_end=True,
        )
    except stripe.StripeError as e:
        logger.error(f"Stripe cancel error: {e}")
        raise HTTPException(500, "구독 취소에 실패했습니다.")

    client.table("subscriptions").update(
        {
            "status": "cancelled",
            "cancel_at": sub.data[0].get("current_period_end"),
        }
    ).eq("id", sub.data[0]["id"]).execute()

    return APIResponse(message="구독이 현재 기간 종료 후 취소됩니다.")


# ===== Stripe Webhook =====


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """Stripe 이벤트 수신 — 구독 상태 동기화"""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    webhook_secret = settings.stripe_webhook_secret

    if not webhook_secret:
        logger.error("STRIPE_WEBHOOK_SECRET is not configured")
        raise HTTPException(500, "Webhook secret not configured")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(400, "Invalid webhook signature")

    event_type = event["type"]
    data = event["data"]["object"]
    client = get_service_client()

    if event_type == "checkout.session.completed":
        _handle_checkout_completed(client, data)

    elif event_type == "customer.subscription.updated":
        _handle_subscription_updated(client, data)

    elif event_type == "customer.subscription.deleted":
        _handle_subscription_deleted(client, data)

    elif event_type == "invoice.payment_failed":
        _handle_payment_failed(client, data)

    return {"status": "ok"}


def _handle_checkout_completed(client, session):
    """Checkout 완료 → 구독 레코드 생성 + 프로필 플랜 업데이트"""
    user_id = session.get("metadata", {}).get("user_id")
    plan = session.get("metadata", {}).get("plan", "basic")

    if not user_id:
        logger.warning("Checkout completed without user_id in metadata")
        return

    stripe_sub_id = session.get("subscription")
    stripe_customer_id = session.get("customer")

    sub_data = {
        "user_id": user_id,
        "plan": plan,
        "stripe_customer_id": stripe_customer_id,
        "stripe_subscription_id": stripe_sub_id,
        "status": "active",
    }

    if stripe_sub_id:
        try:
            stripe_sub = stripe.Subscription.retrieve(stripe_sub_id)
            sub_data["current_period_start"] = _ts_to_iso(stripe_sub.get("current_period_start"))
            sub_data["current_period_end"] = _ts_to_iso(stripe_sub.get("current_period_end"))
        except Exception:
            pass

    existing = (
        client.table("subscriptions")
        .select("id")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if existing.data:
        client.table("subscriptions").update(sub_data).eq("id", existing.data[0]["id"]).execute()
    else:
        client.table("subscriptions").insert(sub_data).execute()

    client.table("profiles").update({"plan": plan}).eq("id", user_id).execute()
    logger.info(f"Checkout completed: user={user_id}, plan={plan}")


def _handle_subscription_updated(client, subscription):
    """구독 상태 변경 동기화"""
    stripe_sub_id = subscription.get("id")
    status = subscription.get("status")
    plan = subscription.get("metadata", {}).get("plan")

    sub = (
        client.table("subscriptions")
        .select("id, user_id")
        .eq("stripe_subscription_id", stripe_sub_id)
        .limit(1)
        .execute()
    )

    if not sub.data:
        return

    update_data = {
        "status": "active"
        if status == "active"
        else ("past_due" if status == "past_due" else "cancelled"),
        "current_period_start": _ts_to_iso(subscription.get("current_period_start")),
        "current_period_end": _ts_to_iso(subscription.get("current_period_end")),
    }

    if plan:
        update_data["plan"] = plan
        client.table("profiles").update({"plan": plan}).eq("id", sub.data[0]["user_id"]).execute()

    client.table("subscriptions").update(update_data).eq("id", sub.data[0]["id"]).execute()


def _handle_subscription_deleted(client, subscription):
    """구독 삭제 → free로 다운그레이드"""
    stripe_sub_id = subscription.get("id")

    sub = (
        client.table("subscriptions")
        .select("id, user_id")
        .eq("stripe_subscription_id", stripe_sub_id)
        .limit(1)
        .execute()
    )

    if sub.data:
        client.table("subscriptions").update(
            {
                "status": "cancelled",
                "plan": "free",
            }
        ).eq("id", sub.data[0]["id"]).execute()

        client.table("profiles").update({"plan": "free"}).eq("id", sub.data[0]["user_id"]).execute()
        logger.info(f"Subscription deleted: user={sub.data[0]['user_id']} → free")


def _handle_payment_failed(client, invoice):
    """결제 실패 → past_due 상태로 변경"""
    stripe_sub_id = invoice.get("subscription")
    if not stripe_sub_id:
        return

    sub = (
        client.table("subscriptions")
        .select("id")
        .eq("stripe_subscription_id", stripe_sub_id)
        .limit(1)
        .execute()
    )

    if sub.data:
        client.table("subscriptions").update({"status": "past_due"}).eq(
            "id", sub.data[0]["id"]
        ).execute()


def _ts_to_iso(ts) -> str | None:
    """Unix timestamp → ISO 8601"""
    if ts is None:
        return None
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
