"""운영 MCP 도구 — 주문/일정/매출매입"""

import json
from datetime import date, datetime, timedelta

from claude_agent_sdk import create_sdk_mcp_server, tool

from shared.supabase_client import get_service_client as _get_client

# ===== 주문 관리 =====


@tool(
    "update_order_status",
    "주문 상태를 변경하고 이력을 기록합니다. 상태 전이 규칙을 자동 검증합니다.",
    {
        "type": "object",
        "properties": {
            "order_id": {"type": "string"},
            "new_status": {
                "type": "string",
                "enum": [
                    "consulting",
                    "quoted",
                    "contracted",
                    "ordering",
                    "manufacturing",
                    "manufactured",
                    "installing",
                    "installed",
                    "as_received",
                    "as_completed",
                    "settled",
                ],
            },
            "reason": {"type": "string", "description": "상태 변경 사유"},
            "changed_by": {"type": "string", "description": "변경자 ID (agent명 또는 user ID)"},
        },
        "required": ["order_id", "new_status"],
    },
)
async def update_order_status(args: dict) -> dict:
    client = _get_client()

    # 유효한 상태 전이 규칙
    valid_transitions = {
        "consulting": ["quoted"],
        "quoted": ["contracted", "consulting"],
        "contracted": ["ordering"],
        "ordering": ["manufacturing"],
        "manufacturing": ["manufactured"],
        "manufactured": ["installing"],
        "installing": ["installed"],
        "installed": ["settled", "as_received"],
        "as_received": ["as_completed"],
        "as_completed": ["settled"],
    }

    # 현재 상태 조회
    current = client.table("orders").select("status").eq("id", args["order_id"]).single().execute()
    current_status = current.data["status"]

    allowed = valid_transitions.get(current_status, [])
    if args["new_status"] not in allowed:
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"상태 전이 불가: {current_status} → {args['new_status']}. "
                    f"허용: {allowed}",
                }
            ]
        }

    # 상태 업데이트
    client.table("orders").update(
        {
            "status": args["new_status"],
            "updated_at": datetime.utcnow().isoformat(),
        }
    ).eq("id", args["order_id"]).execute()

    # 이력 기록
    client.table("order_status_history").insert(
        {
            "order_id": args["order_id"],
            "from_status": current_status,
            "to_status": args["new_status"],
            "changed_by": args.get("changed_by"),
            "reason": args.get("reason"),
        }
    ).execute()

    return {
        "content": [
            {
                "type": "text",
                "text": f"주문 상태 변경: {current_status} → {args['new_status']}",
            }
        ]
    }


# ===== 일정 관리 =====


@tool(
    "create_schedule",
    "새 일정을 생성합니다. 리소스 충돌을 자동 확인합니다.",
    {
        "type": "object",
        "properties": {
            "order_id": {"type": "string"},
            "type": {
                "type": "string",
                "enum": [
                    "measurement",
                    "material_delivery",
                    "manufacturing_start",
                    "manufacturing_end",
                    "quality_check",
                    "delivery",
                    "installation",
                    "as_visit",
                ],
            },
            "title": {"type": "string"},
            "scheduled_at": {"type": "string", "description": "ISO 8601 일시"},
            "duration_min": {"type": "integer", "description": "소요 시간(분)"},
            "assignee_id": {"type": "string", "description": "담당자 ID"},
            "location": {"type": "string"},
        },
        "required": ["order_id", "type", "title", "scheduled_at"],
    },
)
async def create_schedule(args: dict) -> dict:
    client = _get_client()

    # 담당자 충돌 확인
    if args.get("assignee_id"):
        scheduled = datetime.fromisoformat(args["scheduled_at"])
        day_start = scheduled.replace(hour=0, minute=0, second=0).isoformat()
        day_end = scheduled.replace(hour=23, minute=59, second=59).isoformat()

        conflicts = (
            client.table("schedules")
            .select("*")
            .eq("assignee_id", args["assignee_id"])
            .gte("scheduled_at", day_start)
            .lte("scheduled_at", day_end)
            .neq("status", "cancelled")
            .execute()
        )

        if len(conflicts.data) >= 2:  # 일 최대 2건
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"충돌: 담당자가 해당일에 이미 {len(conflicts.data)}건 배정됨. "
                        f"다른 날짜 또는 담당자를 선택하세요.",
                    }
                ]
            }

    client.table("schedules").insert(
        {
            "order_id": args["order_id"],
            "type": args["type"],
            "title": args["title"],
            "scheduled_at": args["scheduled_at"],
            "duration_min": args.get("duration_min", 60),
            "assignee_id": args.get("assignee_id"),
            "location": args.get("location"),
            "status": "scheduled",
        }
    ).execute()

    return {
        "content": [
            {
                "type": "text",
                "text": f"일정 생성: {args['title']} ({args['scheduled_at']})",
            }
        ]
    }


@tool(
    "check_availability",
    "리소스(기사/공장/차량)의 특정 기간 가용 시간을 확인합니다.",
    {
        "type": "object",
        "properties": {
            "resource_type": {
                "type": "string",
                "enum": ["installer", "factory", "vehicle", "as_technician", "consultant"],
            },
            "date_from": {"type": "string", "description": "조회 시작일 (YYYY-MM-DD)"},
            "date_to": {"type": "string", "description": "조회 종료일 (YYYY-MM-DD)"},
            "resource_id": {"type": "string", "description": "특정 리소스 ID (없으면 전체 조회)"},
        },
        "required": ["resource_type", "date_from", "date_to"],
    },
)
async def check_availability(args: dict) -> dict:
    client = _get_client()

    # 리소스 목록 조회
    query = (
        client.table("resources")
        .select("*")
        .eq("type", args["resource_type"])
        .eq("is_active", True)
    )
    if args.get("resource_id"):
        query = query.eq("id", args["resource_id"])
    resources = query.execute()

    availability = []
    for resource in resources.data:
        # 해당 기간 배정 건수 조회
        schedules = (
            client.table("schedules")
            .select("scheduled_at, title, duration_min")
            .eq("assignee_id", resource["id"])
            .gte("scheduled_at", args["date_from"])
            .lte("scheduled_at", args["date_to"])
            .neq("status", "cancelled")
            .execute()
        )

        availability.append(
            {
                "resource_id": resource["id"],
                "name": resource["name"],
                "capacity": resource["capacity"],
                "booked_count": len(schedules.data),
                "available_slots": resource["capacity"] - len(schedules.data),
                "bookings": schedules.data,
            }
        )

    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(availability, ensure_ascii=False, default=str),
            }
        ]
    }


@tool(
    "detect_conflicts",
    "전체 일정에서 충돌/위험 요소를 감지합니다.",
    {
        "type": "object",
        "properties": {
            "date_from": {"type": "string"},
            "date_to": {"type": "string"},
        },
        "required": ["date_from", "date_to"],
    },
)
async def detect_conflicts(args: dict) -> dict:
    client = _get_client()
    conflicts = []

    # 기사 이중 배정 확인
    schedules = (
        client.table("schedules")
        .select("*, resources!assignee_id(name, capacity)")
        .gte("scheduled_at", args["date_from"])
        .lte("scheduled_at", args["date_to"])
        .neq("status", "cancelled")
        .execute()
    )

    # 날짜+담당자별 그룹핑
    from collections import defaultdict

    daily_load = defaultdict(list)
    for s in schedules.data:
        if s.get("assignee_id"):
            day = s["scheduled_at"][:10]
            key = f"{s['assignee_id']}_{day}"
            daily_load[key].append(s)

    for key, items in daily_load.items():
        if len(items) > 2:
            conflicts.append(
                {
                    "type": "overbooked",
                    "assignee": key.split("_")[0],
                    "date": key.split("_")[1],
                    "count": len(items),
                    "items": [i["title"] for i in items],
                }
            )

    # 납기 위험 확인 (제작 종료 > 설치일)
    orders_at_risk = (
        client.table("orders")
        .select("id, estimated_install, status")
        .in_("status", ["manufacturing", "ordering"])
        .lte("estimated_install", args["date_to"])
        .execute()
    )

    for order in orders_at_risk.data:
        if order.get("estimated_install"):
            conflicts.append(
                {
                    "type": "deadline_risk",
                    "order_id": order["id"],
                    "estimated_install": order["estimated_install"],
                    "current_status": order["status"],
                }
            )

    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "conflicts_count": len(conflicts),
                        "conflicts": conflicts,
                    },
                    ensure_ascii=False,
                    default=str,
                ),
            }
        ]
    }


# ===== 매출매입 관리 =====


@tool(
    "create_revenue",
    "매출 전표를 생성합니다. 계약금/중도금/잔금/A·S 수익 등.",
    {
        "type": "object",
        "properties": {
            "order_id": {"type": "string"},
            "category": {
                "type": "string",
                "enum": ["contract_deposit", "interim", "balance", "as_fee"],
            },
            "amount": {"type": "integer", "description": "공급가액 (원)"},
            "due_date": {"type": "string", "description": "수금 예정일 (YYYY-MM-DD)"},
            "notes": {"type": "string"},
        },
        "required": ["order_id", "category", "amount"],
    },
)
async def create_revenue(args: dict) -> dict:
    client = _get_client()
    tax = int(args["amount"] * 0.1)

    client.table("revenue_entries").insert(
        {
            "order_id": args["order_id"],
            "category": args["category"],
            "amount": args["amount"],
            "tax_amount": tax,
            "status": "pending",
            "due_date": args.get("due_date"),
            "notes": args.get("notes"),
        }
    ).execute()

    category_names = {
        "contract_deposit": "계약금",
        "interim": "중도금",
        "balance": "잔금",
        "as_fee": "A/S 수수료",
    }

    return {
        "content": [
            {
                "type": "text",
                "text": f"매출 전표 생성: {category_names.get(args['category'])} "
                f"{args['amount']:,}원 + 부가세 {tax:,}원 = {args['amount'] + tax:,}원",
            }
        ]
    }


@tool(
    "create_expense",
    "매입 전표를 생성합니다. 자재비/제작비/물류비/설치비 등.",
    {
        "type": "object",
        "properties": {
            "order_id": {"type": "string"},
            "vendor_id": {"type": "string"},
            "category": {
                "type": "string",
                "enum": ["material", "manufacturing", "logistics", "installation", "misc"],
            },
            "amount": {"type": "integer", "description": "공급가액 (원)"},
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "qty": {"type": "integer"},
                        "unit_price": {"type": "integer"},
                        "total": {"type": "integer"},
                    },
                },
                "description": "매입 항목 상세",
            },
            "po_number": {"type": "string", "description": "발주번호"},
            "due_date": {"type": "string"},
        },
        "required": ["order_id", "category", "amount"],
    },
)
async def create_expense(args: dict) -> dict:
    client = _get_client()
    tax = int(args["amount"] * 0.1)

    client.table("expense_entries").insert(
        {
            "order_id": args["order_id"],
            "vendor_id": args.get("vendor_id"),
            "category": args["category"],
            "amount": args["amount"],
            "tax_amount": tax,
            "status": "pending",
            "items_json": args.get("items"),
            "po_number": args.get("po_number"),
            "due_date": args.get("due_date"),
        }
    ).execute()

    return {
        "content": [
            {
                "type": "text",
                "text": f"매입 전표 생성: {args['category']} {args['amount']:,}원 + 부가세 {tax:,}원",
            }
        ]
    }


@tool(
    "get_project_pnl",
    "프로젝트(주문)별 손익을 계산합니다.",
    {
        "type": "object",
        "properties": {
            "order_id": {"type": "string"},
        },
        "required": ["order_id"],
    },
)
async def get_project_pnl(args: dict) -> dict:
    client = _get_client()

    order = client.table("orders").select("*").eq("id", args["order_id"]).single().execute()
    revenues = (
        client.table("revenue_entries").select("*").eq("order_id", args["order_id"]).execute()
    )
    expenses = (
        client.table("expense_entries").select("*").eq("order_id", args["order_id"]).execute()
    )

    total_revenue = sum(r["amount"] for r in revenues.data)
    collected = sum(r["amount"] for r in revenues.data if r["status"] == "collected")
    total_expense = sum(e["amount"] for e in expenses.data)
    paid = sum(e["amount"] for e in expenses.data if e["status"] == "paid")

    # 카테고리별 매입 집계
    expense_by_cat = {}
    for e in expenses.data:
        cat = e["category"]
        expense_by_cat[cat] = expense_by_cat.get(cat, 0) + e["amount"]

    gross_profit = total_revenue - total_expense
    margin_rate = gross_profit / total_revenue if total_revenue > 0 else 0

    pnl = {
        "order_id": args["order_id"],
        "contract_amount": order.data.get("contract_amount", 0),
        "revenue": {
            "total": total_revenue,
            "collected": collected,
            "outstanding": total_revenue - collected,
        },
        "expense": {
            "total": total_expense,
            "paid": paid,
            "outstanding": total_expense - paid,
            "by_category": expense_by_cat,
        },
        "gross_profit": gross_profit,
        "margin_rate": round(margin_rate, 4),
    }

    return {"content": [{"type": "text", "text": json.dumps(pnl, ensure_ascii=False)}]}


@tool(
    "get_monthly_summary",
    "월별 매출/매입/손익 요약을 조회합니다.",
    {
        "type": "object",
        "properties": {
            "year": {"type": "integer"},
            "month": {"type": "integer"},
        },
        "required": ["year", "month"],
    },
)
async def get_monthly_summary(args: dict) -> dict:
    client = _get_client()
    year, month = args["year"], args["month"]
    start = f"{year}-{month:02d}-01"
    if month == 12:
        end = f"{year + 1}-01-01"
    else:
        end = f"{year}-{month + 1:02d}-01"

    revenues = (
        client.table("revenue_entries")
        .select("category, amount, status")
        .gte("created_at", start)
        .lt("created_at", end)
        .execute()
    )

    expenses = (
        client.table("expense_entries")
        .select("category, amount, status")
        .gte("created_at", start)
        .lt("created_at", end)
        .execute()
    )

    rev_total = sum(r["amount"] for r in revenues.data)
    rev_collected = sum(r["amount"] for r in revenues.data if r["status"] == "collected")
    exp_total = sum(e["amount"] for e in expenses.data)
    exp_paid = sum(e["amount"] for e in expenses.data if e["status"] == "paid")

    # 매출 카테고리별
    rev_by_cat = {}
    for r in revenues.data:
        rev_by_cat[r["category"]] = rev_by_cat.get(r["category"], 0) + r["amount"]

    exp_by_cat = {}
    for e in expenses.data:
        exp_by_cat[e["category"]] = exp_by_cat.get(e["category"], 0) + e["amount"]

    overdue_rev = (
        client.table("revenue_entries")
        .select("order_id, amount, due_date")
        .eq("status", "invoiced")
        .lt("due_date", date.today().isoformat())
        .execute()
    )

    overdue_exp = (
        client.table("expense_entries")
        .select("order_id, vendor_id, amount, due_date")
        .eq("status", "approved")
        .lt("due_date", date.today().isoformat())
        .execute()
    )

    summary = {
        "period": f"{year}-{month:02d}",
        "revenue": {
            "total": rev_total,
            "collected": rev_collected,
            "outstanding": rev_total - rev_collected,
            "by_category": rev_by_cat,
            "count": len(revenues.data),
        },
        "expense": {
            "total": exp_total,
            "paid": exp_paid,
            "outstanding": exp_total - exp_paid,
            "by_category": exp_by_cat,
            "count": len(expenses.data),
        },
        "gross_profit": rev_total - exp_total,
        "cash_flow": rev_collected - exp_paid,
        "overdue": {
            "receivable_count": len(overdue_rev.data),
            "receivable_amount": sum(r["amount"] for r in overdue_rev.data),
            "payable_count": len(overdue_exp.data),
            "payable_amount": sum(e["amount"] for e in overdue_exp.data),
        },
    }

    return {"content": [{"type": "text", "text": json.dumps(summary, ensure_ascii=False)}]}


@tool(
    "create_purchase_order",
    "발주서(PO)를 생성합니다.",
    {
        "type": "object",
        "properties": {
            "order_id": {"type": "string"},
            "vendor_id": {"type": "string"},
            "type": {"type": "string", "enum": ["material", "manufacturing", "logistics"]},
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "spec": {"type": "string"},
                        "qty": {"type": "integer"},
                        "unit_price": {"type": "integer"},
                    },
                },
            },
            "expected_delivery": {"type": "string", "description": "예상 납품일 (YYYY-MM-DD)"},
            "notes": {"type": "string"},
        },
        "required": ["order_id", "vendor_id", "type", "items"],
    },
)
async def create_purchase_order(args: dict) -> dict:
    client = _get_client()

    # PO 번호 자동 생성
    year = datetime.now().year
    count = (
        client.table("purchase_orders")
        .select("id", count="exact")
        .like("po_number", f"PO-{year}-%")
        .execute()
    )
    seq = (count.count or 0) + 1
    po_number = f"PO-{year}-{seq:04d}"

    total = sum(item.get("qty", 1) * item.get("unit_price", 0) for item in args["items"])

    client.table("purchase_orders").insert(
        {
            "order_id": args["order_id"],
            "vendor_id": args["vendor_id"],
            "po_number": po_number,
            "type": args["type"],
            "items_json": args["items"],
            "total_amount": total,
            "status": "draft",
            "expected_delivery": args.get("expected_delivery"),
            "notes": args.get("notes"),
        }
    ).execute()

    return {
        "content": [
            {
                "type": "text",
                "text": f"발주서 생성: {po_number} / 금액: {total:,}원 / 거래처: {args['vendor_id']}",
            }
        ]
    }


# ===== A/S =====


@tool(
    "create_as_ticket",
    "A/S 티켓을 생성합니다.",
    {
        "type": "object",
        "properties": {
            "order_id": {"type": "string"},
            "customer_id": {"type": "string"},
            "type": {"type": "string", "enum": ["defect", "damage", "adjustment", "add_on"]},
            "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
            "description": {"type": "string"},
            "photos": {"type": "array", "items": {"type": "string"}, "description": "사진 URL"},
        },
        "required": ["order_id", "customer_id", "type", "description"],
    },
)
async def create_as_ticket(args: dict) -> dict:
    client = _get_client()

    # 보증기간 확인 (설치 완료 후 1년)
    order = (
        client.table("orders")
        .select("actual_install")
        .eq("id", args["order_id"])
        .single()
        .execute()
    )
    install_date = order.data.get("actual_install")
    is_warranty = False
    warranty_expires = None

    if install_date:
        install_dt = datetime.fromisoformat(install_date.replace("Z", "+00:00"))
        warranty_expires = (install_dt + timedelta(days=365)).date().isoformat()
        is_warranty = date.today().isoformat() <= warranty_expires

    client.table("after_service_tickets").insert(
        {
            "order_id": args["order_id"],
            "customer_id": args["customer_id"],
            "type": args["type"],
            "priority": args.get("priority", "normal"),
            "description": args["description"],
            "photos": args.get("photos", []),
            "status": "received",
            "is_warranty": is_warranty,
            "warranty_expires": warranty_expires,
        }
    ).execute()

    warranty_text = "무상 보증 기간 내" if is_warranty else "보증 만료 (유상)"
    return {
        "content": [
            {
                "type": "text",
                "text": f"A/S 티켓 생성: {args['type']} / {warranty_text} / 우선순위: {args.get('priority', 'normal')}",
            }
        ]
    }


# ===== 알림 =====


@tool(
    "send_notification",
    "고객/내부/거래처에게 알림을 발송합니다.",
    {
        "type": "object",
        "properties": {
            "recipient_id": {"type": "string"},
            "recipient_type": {"type": "string", "enum": ["customer", "staff", "vendor"]},
            "channel": {"type": "string", "enum": ["kakao", "sms", "email", "slack", "in_app"]},
            "title": {"type": "string"},
            "body": {"type": "string"},
            "related_order": {"type": "string"},
        },
        "required": ["recipient_id", "recipient_type", "channel", "title", "body"],
    },
)
async def send_notification(args: dict) -> dict:
    client = _get_client()

    # DB에 알림 기록
    client.table("notifications").insert(
        {
            "recipient_id": args["recipient_id"],
            "recipient_type": args["recipient_type"],
            "channel": args["channel"],
            "title": args["title"],
            "body": args["body"],
            "related_order": args.get("related_order"),
            "status": "pending",
        }
    ).execute()

    # TODO: 실제 발송 연동
    # kakao → 카카오 알림톡 API
    # sms → NHN Cloud / Twilio
    # email → SendGrid / AWS SES
    # slack → Slack Webhook

    return {
        "content": [
            {
                "type": "text",
                "text": f"알림 발송 예약: [{args['channel']}] {args['title']} → {args['recipient_type']}",
            }
        ]
    }


# MCP 서버 생성
operations_server = create_sdk_mcp_server(
    name="operations",
    version="1.0.0",
    tools=[
        update_order_status,
        create_schedule,
        check_availability,
        detect_conflicts,
        create_revenue,
        create_expense,
        get_project_pnl,
        get_monthly_summary,
        create_purchase_order,
        create_as_ticket,
        send_notification,
    ],
)
