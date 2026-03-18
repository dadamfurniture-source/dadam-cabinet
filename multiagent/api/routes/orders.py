"""주문/운영 API — 상담~설치~A/S 생명주기 + 운영 에이전트 트리거"""

import json as json_mod
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.middleware.auth import CurrentUser, get_current_user
from api.schemas.common import APIResponse
from shared.supabase_client import get_service_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/orders", tags=["Orders"])


async def _fire_ops_event(event_type: str, order_id: str, data: dict | None = None):
    """운영 에이전트 이벤트를 백그라운드에서 실행 (실패해도 API 응답에 영향 없음)"""
    try:
        from agents.operations.orchestrator import OrderEvent, handle_operations_event

        event = OrderEvent(
            event_type=event_type, order_id=order_id, data=data, triggered_by="system"
        )
        async for _ in handle_operations_event(event):
            pass  # consume generator
    except Exception as e:
        logger.warning(f"Operations event failed: {event_type} / {order_id} / {e}")


# Valid status transitions (from → [allowed to states])
VALID_TRANSITIONS = {
    "consulting": ["quoted"],
    "quoted": ["contracted", "consulting"],
    "contracted": ["ordering"],
    "ordering": ["manufacturing"],
    "manufacturing": ["manufactured"],
    "manufactured": ["installing"],
    "installing": ["installed"],
    "installed": ["settled"],
}

PAYMENT_STAGES = {
    "contract_deposit": {"from": "quoted", "to": "contracted", "ratio": 0.3},
    "interim": {"from": "manufacturing", "to": None, "ratio": 0.4},
    "balance": {"from": "installed", "to": "settled", "ratio": 0.3},
}


class OrderCreateRequest(BaseModel):
    project_id: str
    quote_id: str
    delivery_address: str | None = None
    notes: str | None = None


class OrderStatusUpdate(BaseModel):
    status: str
    reason: str | None = None


class PaymentRecord(BaseModel):
    payment_type: str  # contract_deposit, interim, balance
    amount: int
    payment_method: str | None = "bank_transfer"
    notes: str | None = None


class ASRequest(BaseModel):
    type: str  # product_defect, installation_defect, customer_fault, natural_wear
    description: str
    photos: list[str] = []


# ===== 주문 CRUD =====


@router.post("", response_model=APIResponse)
async def create_order(
    body: OrderCreateRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """견적 기반으로 주문 생성 (상담 시작)"""
    client = get_service_client()

    # 견적 조회
    quote = client.table("quotes").select("*").eq("id", body.quote_id).single().execute()
    if not quote.data:
        raise HTTPException(404, "견적을 찾을 수 없습니다.")

    order = (
        client.table("orders")
        .insert(
            {
                "project_id": body.project_id,
                "customer_id": user.id,
                "quote_id": body.quote_id,
                "contract_amount": quote.data["total_price"],
                "delivery_address": body.delivery_address,
                "notes": body.notes,
                "status": "consulting",
            }
        )
        .execute()
    )

    # 상태 이력 기록
    client.table("order_status_history").insert(
        {
            "order_id": order.data[0]["id"],
            "to_status": "consulting",
            "changed_by": user.id,
            "reason": "주문 생성",
        }
    ).execute()

    return APIResponse(
        message="주문이 생성되었습니다.",
        data=order.data[0],
    )


@router.get("", response_model=APIResponse)
async def list_orders(
    page: int = 1,
    per_page: int = 20,
    status: str | None = None,
    user: CurrentUser = Depends(get_current_user),
):
    """내 주문 목록 조회"""
    per_page = min(per_page, 100)
    client = get_service_client()

    query = (
        client.table("orders")
        .select("*, projects(name, category)", count="exact")
        .eq("customer_id", user.id)
        .order("created_at", desc=True)
        .range((page - 1) * per_page, page * per_page - 1)
    )

    if status:
        query = query.eq("status", status)

    result = query.execute()

    return APIResponse(
        data={
            "items": result.data,
            "total": result.count or 0,
            "page": page,
            "per_page": per_page,
        }
    )


@router.get("/{order_id}", response_model=APIResponse)
async def get_order(
    order_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """주문 상세 조회 (일정, 매출, A/S 포함)"""
    client = get_service_client()

    order = (
        client.table("orders")
        .select("*, projects(name, category, style)")
        .eq("id", order_id)
        .eq("customer_id", user.id)
        .single()
        .execute()
    )

    if not order.data:
        raise HTTPException(404, "주문을 찾을 수 없습니다.")

    # 관련 데이터
    schedules = (
        client.table("schedules")
        .select("*")
        .eq("order_id", order_id)
        .order("scheduled_at")
        .execute()
    )

    history = (
        client.table("order_status_history")
        .select("*")
        .eq("order_id", order_id)
        .order("created_at")
        .execute()
    )

    as_tickets = (
        client.table("after_service_tickets").select("*").eq("order_id", order_id).execute()
    )

    return APIResponse(
        data={
            "order": order.data,
            "schedules": schedules.data,
            "history": history.data,
            "as_tickets": as_tickets.data,
        }
    )


@router.get("/{order_id}/timeline", response_model=APIResponse)
async def get_order_timeline(
    order_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """주문 타임라인 (상태이력 + 일정 통합)"""
    client = get_service_client()

    # 소유권 확인
    order = (
        client.table("orders")
        .select("id")
        .eq("id", order_id)
        .eq("customer_id", user.id)
        .single()
        .execute()
    )
    if not order.data:
        raise HTTPException(404, "주문을 찾을 수 없습니다.")

    history = (
        client.table("order_status_history")
        .select("to_status, reason, created_at")
        .eq("order_id", order_id)
        .order("created_at")
        .execute()
    )

    schedules = (
        client.table("schedules")
        .select("type, title, scheduled_at, status")
        .eq("order_id", order_id)
        .order("scheduled_at")
        .execute()
    )

    # 통합 타임라인
    timeline = []
    for h in history.data:
        timeline.append(
            {
                "type": "status_change",
                "status": h["to_status"],
                "reason": h.get("reason"),
                "at": h["created_at"],
            }
        )
    for s in schedules.data:
        timeline.append(
            {
                "type": "schedule",
                "schedule_type": s["type"],
                "title": s["title"],
                "status": s["status"],
                "at": s["scheduled_at"],
            }
        )

    timeline.sort(key=lambda x: x["at"])

    return APIResponse(data={"timeline": timeline})


# ===== 상태 변경 =====


@router.put("/{order_id}/status", response_model=APIResponse)
async def update_order_status(
    order_id: str,
    body: OrderStatusUpdate,
    background: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
):
    """주문 상태 변경 (유효 전이만 허용) + 운영 에이전트 트리거"""
    client = get_service_client()

    order = (
        client.table("orders")
        .select("id, status, customer_id")
        .eq("id", order_id)
        .eq("customer_id", user.id)
        .single()
        .execute()
    )
    if not order.data:
        raise HTTPException(404, "주문을 찾을 수 없습니다.")

    current = order.data["status"]
    if body.status not in VALID_TRANSITIONS.get(current, []):
        raise HTTPException(
            400,
            f"'{current}' → '{body.status}' 전이는 허용되지 않습니다. "
            f"가능한 상태: {VALID_TRANSITIONS.get(current, [])}",
        )

    # 상태 업데이트
    client.table("orders").update({"status": body.status}).eq("id", order_id).execute()

    # 이력 기록
    client.table("order_status_history").insert(
        {
            "order_id": order_id,
            "from_status": current,
            "to_status": body.status,
            "changed_by": user.id,
            "reason": body.reason,
        }
    ).execute()

    # 운영 에이전트 트리거 (비동기)
    background.add_task(
        _fire_ops_event, f"status_change:{body.status}", order_id, {"status": body.status}
    )

    return APIResponse(
        message=f"상태가 '{body.status}'로 변경되었습니다.",
        data={"order_id": order_id, "from": current, "to": body.status},
    )


# ===== 결제 기록 =====


@router.post("/{order_id}/payment", response_model=APIResponse)
async def record_payment(
    order_id: str,
    body: PaymentRecord,
    background: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
):
    """결제 기록 + 자동 상태 전이 + 운영 이벤트 발행"""
    if body.payment_type not in PAYMENT_STAGES:
        raise HTTPException(400, f"유효하지 않은 결제 유형: {body.payment_type}")

    client = get_service_client()
    stage = PAYMENT_STAGES[body.payment_type]

    order = (
        client.table("orders")
        .select("id, status, contract_amount, customer_id")
        .eq("id", order_id)
        .eq("customer_id", user.id)
        .single()
        .execute()
    )
    if not order.data:
        raise HTTPException(404, "주문을 찾을 수 없습니다.")

    # 매출 전표 생성 (revenue_entries)
    payment = (
        client.table("revenue_entries")
        .insert(
            {
                "order_id": order_id,
                "category": body.payment_type,
                "amount": body.amount,
                "status": "collected",
                "payment_method": body.payment_method,
                "notes": body.notes,
            }
        )
        .execute()
    )

    # 자동 상태 전이 (stage에 to 상태가 있으면)
    status_changed = False
    if stage["to"] and order.data["status"] == stage["from"]:
        client.table("orders").update({"status": stage["to"]}).eq("id", order_id).execute()
        client.table("order_status_history").insert(
            {
                "order_id": order_id,
                "from_status": stage["from"],
                "to_status": stage["to"],
                "changed_by": "system",
                "reason": f"{body.payment_type} 결제에 의한 자동 전이",
            }
        ).execute()
        status_changed = True

    # 운영 에이전트 트리거 (비동기)
    background.add_task(
        _fire_ops_event,
        f"payment_received:{body.payment_type}",
        order_id,
        {"amount": body.amount, "category": body.payment_type},
    )

    return APIResponse(
        message=f"{body.payment_type} 결제가 기록되었습니다.",
        data={
            "payment": payment.data[0] if payment.data else None,
            "status_changed": status_changed,
            "new_status": stage["to"] if status_changed else order.data["status"],
        },
    )


# ===== A/S 접수 =====


@router.post("/{order_id}/as", response_model=APIResponse)
async def create_as_ticket(
    order_id: str,
    body: ASRequest,
    background: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
):
    """A/S 접수 → 운영 에이전트 자동 처리"""
    client = get_service_client()

    # 주문 확인 (설치 완료 이후만 A/S 가능)
    order = (
        client.table("orders")
        .select("id, status, customer_id")
        .eq("id", order_id)
        .eq("customer_id", user.id)
        .single()
        .execute()
    )
    if not order.data:
        raise HTTPException(404, "주문을 찾을 수 없습니다.")

    if order.data["status"] not in ("installed", "settled"):
        raise HTTPException(400, "설치 완료 이후에만 A/S를 접수할 수 있습니다.")

    ticket = (
        client.table("after_service_tickets")
        .insert(
            {
                "order_id": order_id,
                "customer_id": user.id,
                "type": body.type,
                "description": body.description,
                "photos": body.photos,
                "status": "received",
            }
        )
        .execute()
    )

    # 운영 에이전트 트리거 (비동기)
    background.add_task(
        _fire_ops_event,
        "as_request",
        order_id,
        {"type": body.type, "description": body.description},
    )

    return APIResponse(
        message="A/S가 접수되었습니다.",
        data=ticket.data[0] if ticket.data else None,
    )


# ===== 운영 이벤트 스트림 =====


ALLOWED_EVENT_TYPES = {
    "status_check",
    "schedule_update",
    "payment_summary",
    "as_status",
    "manufacturing_status",
    "installation_status",
}


@router.get("/{order_id}/ops-stream")
async def ops_event_stream(
    order_id: str,
    event_type: str,
    user: CurrentUser = Depends(get_current_user),
):
    """운영 에이전트 처리 결과를 SSE로 스트리밍"""
    if event_type not in ALLOWED_EVENT_TYPES:
        raise HTTPException(
            400, f"허용되지 않은 이벤트 유형입니다. 가능: {sorted(ALLOWED_EVENT_TYPES)}"
        )

    from agents.operations.orchestrator import OrderEvent, handle_operations_event

    client = get_service_client()

    # 소유권 확인
    order = (
        client.table("orders")
        .select("id, status, contract_amount")
        .eq("id", order_id)
        .eq("customer_id", user.id)
        .single()
        .execute()
    )
    if not order.data:
        raise HTTPException(404, "주문을 찾을 수 없습니다.")

    event = OrderEvent(
        event_type=event_type,
        order_id=order_id,
        data={"status": order.data["status"], "amount": order.data.get("contract_amount")},
        triggered_by=user.id,
    )

    async def generate():
        async for msg in handle_operations_event(event):
            yield f"data: {json_mod.dumps(msg, ensure_ascii=False)}\n\n"
        yield 'data: {"type": "done"}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
