"""운영본부 오케스트레이터 — 상담/발주/제작/설치/A·S/매출매입 관리"""

from dataclasses import dataclass
from typing import AsyncGenerator

from claude_agent_sdk import AgentDefinition, ClaudeAgentOptions, query

from agents.operations.prompts import (
    ACCOUNTING_AGENT_PROMPT,
    AFTER_SERVICE_AGENT_PROMPT,
    CONSULTATION_AGENT_PROMPT,
    INSTALLATION_AGENT_PROMPT,
    MANUFACTURING_AGENT_PROMPT,
    NOTIFICATION_AGENT_PROMPT,
    ORDERING_AGENT_PROMPT,
    SCHEDULE_AGENT_PROMPT,
)

# ===== 운영 요청 타입 =====


@dataclass
class OrderEvent:
    """주문 생명주기 이벤트"""

    event_type: str  # status_change | payment_received | schedule_trigger | as_request | manual
    order_id: str
    data: dict | None = None
    triggered_by: str | None = None  # user_id or "system"


# ===== 운영 에이전트 빌더 =====


def _build_operations_agents() -> dict[str, AgentDefinition]:
    """운영본부 전체 에이전트 구성"""

    ops_tools_base = [
        "mcp__operations__update_order_status",
        "mcp__operations__create_schedule",
        "mcp__operations__send_notification",
        "mcp__supabase__read_project",
    ]

    return {
        "consultation": AgentDefinition(
            description="상담 관리 에이전트. 고객 문의 응대, 실측 일정, 견적 확정, 계약 처리에 사용.",
            prompt=CONSULTATION_AGENT_PROMPT,
            tools=[
                *ops_tools_base,
                "mcp__operations__create_revenue",
            ],
            model="sonnet",
        ),
        "ordering": AgentDefinition(
            description="발주 관리 에이전트. 자재 발주서 생성, 공장 제작 의뢰, 재고 확인에 사용.",
            prompt=ORDERING_AGENT_PROMPT,
            tools=[
                *ops_tools_base,
                "mcp__operations__create_purchase_order",
                "mcp__operations__create_expense",
                "mcp__operations__check_availability",
                "mcp__pricing__get_materials",
            ],
            model="sonnet",
        ),
        "manufacturing": AgentDefinition(
            description="제작 관리 에이전트. 공장 제작 진행률 추적, 품질 검수, 납기 관리에 사용.",
            prompt=MANUFACTURING_AGENT_PROMPT,
            tools=[
                *ops_tools_base,
                "mcp__operations__create_expense",
            ],
            model="haiku",
        ),
        "installation": AgentDefinition(
            description="설치 조율 에이전트. 배송/설치 일정 조율, 기사 배정, 완료 검수에 사용.",
            prompt=INSTALLATION_AGENT_PROMPT,
            tools=[
                *ops_tools_base,
                "mcp__operations__check_availability",
                "mcp__supabase__upload_image",
            ],
            model="sonnet",
        ),
        "after-service": AgentDefinition(
            description="A/S 관리 에이전트. A/S 접수, 원인 분류, 기사 배정, 비용 산정에 사용.",
            prompt=AFTER_SERVICE_AGENT_PROMPT,
            tools=[
                *ops_tools_base,
                "mcp__operations__create_as_ticket",
                "mcp__operations__check_availability",
                "mcp__operations__create_revenue",
                "mcp__operations__create_expense",
            ],
            model="sonnet",
        ),
        "accounting": AgentDefinition(
            description="매출매입 관리 에이전트. 매출/매입 전표, 손익 분석, 수금/지급 추적에 사용.",
            prompt=ACCOUNTING_AGENT_PROMPT,
            tools=[
                "mcp__operations__create_revenue",
                "mcp__operations__create_expense",
                "mcp__operations__get_project_pnl",
                "mcp__operations__get_monthly_summary",
                "mcp__supabase__read_project",
            ],
            model="opus",
        ),
        "scheduler": AgentDefinition(
            description="일정 총괄 에이전트. 프로젝트 타임라인 생성, 리소스 충돌 감지, 일정 재조율에 사용.",
            prompt=SCHEDULE_AGENT_PROMPT,
            tools=[
                "mcp__operations__create_schedule",
                "mcp__operations__check_availability",
                "mcp__operations__detect_conflicts",
                "mcp__operations__send_notification",
                "mcp__supabase__read_project",
            ],
            model="sonnet",
        ),
        "notifier": AgentDefinition(
            description="알림 발송 에이전트. 고객/내부/거래처에게 카카오톡, SMS, 이메일, 슬랙 알림 발송에 사용.",
            prompt=NOTIFICATION_AGENT_PROMPT,
            tools=["mcp__operations__send_notification"],
            model="haiku",
        ),
    }


# ===== 이벤트 기반 라우팅 =====

EVENT_ROUTING = {
    # 상태 변경 이벤트 → 어떤 에이전트가 처리?
    "payment_received:contract_deposit": [
        ("accounting", "계약금 {amount}원이 입금되었습니다. 매출 전표를 생성하세요."),
        (
            "ordering",
            "계약이 확정되었습니다. BOM 기반으로 자재 발주서를 생성하고 공장에 제작을 의뢰하세요.",
        ),
        (
            "scheduler",
            "계약이 확정되었습니다. 표준 리드타임 기반으로 전체 프로젝트 일정을 생성하세요.",
        ),
        ("notifier", "고객에게 '계약금 입금 확인 + 제작 일정 안내' 알림을 발송하세요."),
    ],
    "payment_received:interim": [
        ("accounting", "중도금 {amount}원이 입금되었습니다. 매출 전표를 생성하세요."),
        ("notifier", "고객에게 '중도금 입금 확인' 알림을 발송하세요."),
    ],
    "payment_received:balance": [
        (
            "accounting",
            "잔금 {amount}원이 입금되었습니다. 매출 전표를 생성하고 프로젝트 최종 손익을 산출하세요.",
        ),
        ("notifier", "고객에게 '잔금 입금 확인 + A/S 보증 안내' 알림을 발송하세요."),
    ],
    "status_change:manufactured": [
        (
            "manufacturing",
            "공장에서 제작 완료 보고가 들어왔습니다. 품질 검수 체크리스트를 작성하세요.",
        ),
        ("accounting", "제작비 매입 전표를 생성하세요."),
        ("scheduler", "제작이 완료되었습니다. 배송/설치 일정을 확정하세요."),
        ("notifier", "고객에게 '제작 완료 + 설치 예정일 안내' 알림을 발송하세요."),
    ],
    "status_change:installed": [
        ("installation", "설치가 완료되었습니다. 시공 사진과 완료 보고서를 작성하세요."),
        ("accounting", "잔금을 청구하세요. 설치비 매입 전표도 생성하세요."),
        ("notifier", "고객에게 '설치 완료 + 잔금 안내' 알림을 발송하세요."),
    ],
    "as_request": [
        (
            "after-service",
            "A/S 요청이 접수되었습니다. 사진을 분석하여 원인을 분류하고, 보증기간을 확인하여 기사를 배정하세요.",
        ),
    ],
    "schedule_reminder": [
        ("notifier", "내일 예정된 일정이 있습니다. 관련 담당자와 고객에게 알림을 발송하세요."),
    ],
    "overdue_check": [
        ("accounting", "미수금/미지급금 연체 현황을 확인하세요."),
        ("notifier", "연체 건에 대해 내부 알림을 발송하세요."),
    ],
}


async def handle_operations_event(event: OrderEvent) -> AsyncGenerator[dict, None]:
    """운영 이벤트를 처리하는 오케스트레이터

    이벤트 타입에 따라 적절한 에이전트들을 자동 호출합니다.
    """
    yield {
        "type": "ops_status",
        "stage": "started",
        "event": event.event_type,
        "order_id": event.order_id,
    }

    agents = _build_operations_agents()

    # 이벤트에 매핑된 에이전트 작업 목록 조회
    routing_key = event.event_type
    if event.data and "category" in event.data:
        routing_key = f"{event.event_type}:{event.data['category']}"

    tasks = EVENT_ROUTING.get(routing_key, [])

    if not tasks:
        # 라우팅에 없는 이벤트 → CEO가 판단
        prompt = f"""
운영 이벤트가 발생했습니다:
- 이벤트: {event.event_type}
- 주문 ID: {event.order_id}
- 데이터: {event.data}

적절한 에이전트를 사용하여 이 이벤트를 처리하세요.
"""
    else:
        task_instructions = "\n".join(
            f"{i + 1}. {agent_name} 에이전트: {instruction.format(**(event.data or {}))}"
            for i, (agent_name, instruction) in enumerate(tasks)
        )
        prompt = f"""
다음 운영 이벤트를 처리하세요:
- 이벤트: {event.event_type}
- 주문 ID: {event.order_id}
- 데이터: {event.data}

## 처리할 작업 (순서대로 또는 병렬로)
{task_instructions}

각 에이전트에게 주문 ID와 필요한 데이터를 전달하세요.
"""

    try:
        async for message in query(
            prompt=prompt,
            options=ClaudeAgentOptions(
                allowed_tools=["Agent", "mcp__operations__update_order_status"],
                agents=agents,
            ),
        ):
            if hasattr(message, "content"):
                yield {"type": "ops_progress", "content": str(message.content)}
            if hasattr(message, "result"):
                yield {"type": "ops_result", "order_id": event.order_id, "data": message.result}
    except Exception as e:
        yield {"type": "ops_error", "order_id": event.order_id, "error": str(e)}


# ===== 수동 운영 명령 =====


async def run_consultation(order_id: str, action: str, data: dict | None = None):
    """상담 에이전트 직접 호출"""
    OrderEvent(
        event_type="manual",
        order_id=order_id,
        data={"action": action, **(data or {})},
        triggered_by="manual",
    )
    agents = _build_operations_agents()

    async for msg in query(
        prompt=f"주문 {order_id}에 대해 다음 작업을 수행하세요: {action}\n데이터: {data}",
        options=ClaudeAgentOptions(
            allowed_tools=["Agent"],
            agents={"consultation": agents["consultation"]},
        ),
    ):
        yield msg


async def run_monthly_report(year: int, month: int):
    """월간 경영 리포트 생성"""
    agents = _build_operations_agents()

    async for msg in query(
        prompt=f"""
{year}년 {month}월 경영 리포트를 작성하세요:

1. accounting 에이전트로 월별 매출/매입/손익 요약을 조회하세요.
2. scheduler 에이전트로 일정 충돌 및 납기 위험을 확인하세요.
3. 결과를 종합하여 다음을 포함한 리포트를 작성하세요:
   - 매출/매입/영업이익
   - 미수금/미지급금 현황
   - 진행중 프로젝트 현황
   - 납기 위험 건
   - A/S 현황
""",
        options=ClaudeAgentOptions(
            allowed_tools=["Agent"],
            agents={
                "accounting": agents["accounting"],
                "scheduler": agents["scheduler"],
            },
        ),
    ):
        yield msg
