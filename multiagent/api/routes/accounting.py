"""매출매입 API — 경영지원"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth import CurrentUser, get_current_user, require_pro
from api.schemas.common import APIResponse
from shared.supabase_client import get_service_client

router = APIRouter(prefix="/accounting", tags=["Accounting"])

MAX_PER_PAGE = 100


# ===== 매출 =====


@router.get("/revenue", response_model=APIResponse)
async def list_revenue(
    order_id: str | None = None,
    status: str | None = None,
    year: int | None = None,
    month: int | None = None,
    page: int = 1,
    per_page: int = 50,
    user: CurrentUser = Depends(get_current_user),
):
    """매출 전표 목록 조회 (Pro+, 자기 주문만)"""
    require_pro(user)
    per_page = min(per_page, MAX_PER_PAGE)

    client = get_service_client()

    # 유저의 주문만 조회
    user_orders = client.table("orders").select("id").eq("customer_id", user.id).execute()
    user_order_ids = [o["id"] for o in user_orders.data]

    if not user_order_ids:
        return APIResponse(data={"items": [], "total": 0})

    query = (
        client.table("revenue_entries")
        .select("*, orders(order_number)", count="exact")
        .in_("order_id", user_order_ids)
        .order("created_at", desc=True)
        .range((page - 1) * per_page, page * per_page - 1)
    )

    if order_id:
        if order_id not in user_order_ids:
            raise HTTPException(403, "접근 권한이 없는 주문입니다.")
        query = query.eq("order_id", order_id)
    if status:
        query = query.eq("status", status)
    if year and month:
        start = f"{year}-{month:02d}-01"
        end = f"{year}-{month + 1:02d}-01" if month < 12 else f"{year + 1}-01-01"
        query = query.gte("created_at", start).lt("created_at", end)

    result = query.execute()
    return APIResponse(data={"items": result.data, "total": result.count or 0, "page": page})


# ===== 매입 =====


@router.get("/expense", response_model=APIResponse)
async def list_expense(
    order_id: str | None = None,
    vendor_id: str | None = None,
    category: str | None = None,
    status: str | None = None,
    page: int = 1,
    per_page: int = 50,
    user: CurrentUser = Depends(get_current_user),
):
    """매입 전표 목록 조회 (Pro+, 자기 주문만)"""
    require_pro(user)
    per_page = min(per_page, MAX_PER_PAGE)

    client = get_service_client()

    user_orders = client.table("orders").select("id").eq("customer_id", user.id).execute()
    user_order_ids = [o["id"] for o in user_orders.data]

    if not user_order_ids:
        return APIResponse(data={"items": [], "total": 0})

    query = (
        client.table("expense_entries")
        .select("*, orders(order_number), vendors(name)", count="exact")
        .in_("order_id", user_order_ids)
        .order("created_at", desc=True)
        .range((page - 1) * per_page, page * per_page - 1)
    )

    if order_id:
        if order_id not in user_order_ids:
            raise HTTPException(403, "접근 권한이 없는 주문입니다.")
        query = query.eq("order_id", order_id)
    if vendor_id:
        query = query.eq("vendor_id", vendor_id)
    if category:
        query = query.eq("category", category)
    if status:
        query = query.eq("status", status)

    result = query.execute()
    return APIResponse(data={"items": result.data, "total": result.count or 0, "page": page})


# ===== 손익 =====


@router.get("/pnl/{order_id}", response_model=APIResponse)
async def get_order_pnl(
    order_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """프로젝트별 손익 조회 (Pro+, 자기 주문만)"""
    require_pro(user)

    client = get_service_client()

    # 소유권 확인
    order = (
        client.table("orders")
        .select("*")
        .eq("id", order_id)
        .eq("customer_id", user.id)
        .single()
        .execute()
    )
    if not order.data:
        raise HTTPException(404, "주문을 찾을 수 없습니다.")

    revenues = client.table("revenue_entries").select("*").eq("order_id", order_id).execute()
    expenses = client.table("expense_entries").select("*").eq("order_id", order_id).execute()

    total_rev = sum(r["amount"] for r in revenues.data)
    collected = sum(r["amount"] for r in revenues.data if r["status"] == "collected")
    total_exp = sum(e["amount"] for e in expenses.data)
    paid = sum(e["amount"] for e in expenses.data if e["status"] == "paid")

    exp_by_cat = {}
    for e in expenses.data:
        exp_by_cat[e["category"]] = exp_by_cat.get(e["category"], 0) + e["amount"]

    gross_profit = total_rev - total_exp
    margin = gross_profit / total_rev if total_rev > 0 else 0

    return APIResponse(
        data={
            "order_id": order_id,
            "order_number": order.data.get("order_number"),
            "contract_amount": order.data.get("contract_amount", 0),
            "revenue": {
                "total": total_rev,
                "collected": collected,
                "outstanding": total_rev - collected,
                "entries": revenues.data,
            },
            "expense": {
                "total": total_exp,
                "paid": paid,
                "outstanding": total_exp - paid,
                "by_category": exp_by_cat,
                "entries": expenses.data,
            },
            "gross_profit": gross_profit,
            "margin_rate": round(margin, 4),
        }
    )


@router.get("/summary", response_model=APIResponse)
async def get_monthly_summary(
    year: int,
    month: int,
    user: CurrentUser = Depends(get_current_user),
):
    """월별 매출/매입 요약 (Pro+, 자기 주문만)"""
    require_pro(user)

    client = get_service_client()
    start = f"{year}-{month:02d}-01"
    end = f"{year}-{month + 1:02d}-01" if month < 12 else f"{year + 1}-01-01"

    # 유저의 주문 ID 목록
    user_orders = client.table("orders").select("id").eq("customer_id", user.id).execute()
    user_order_ids = [o["id"] for o in user_orders.data]

    if not user_order_ids:
        return APIResponse(
            data={
                "period": f"{year}-{month:02d}",
                "revenue": {"total": 0, "collected": 0},
                "expense": {"total": 0, "paid": 0},
                "gross_profit": 0,
                "cash_flow": 0,
                "overdue": {"receivable": 0, "payable": 0},
            }
        )

    revenues = (
        client.table("revenue_entries")
        .select("category, amount, status")
        .in_("order_id", user_order_ids)
        .gte("created_at", start)
        .lt("created_at", end)
        .execute()
    )
    expenses = (
        client.table("expense_entries")
        .select("category, amount, status")
        .in_("order_id", user_order_ids)
        .gte("created_at", start)
        .lt("created_at", end)
        .execute()
    )

    rev_total = sum(r["amount"] for r in revenues.data)
    rev_collected = sum(r["amount"] for r in revenues.data if r["status"] == "collected")
    exp_total = sum(e["amount"] for e in expenses.data)
    exp_paid = sum(e["amount"] for e in expenses.data if e["status"] == "paid")

    overdue_rev = (
        client.table("revenue_entries")
        .select("order_id, amount")
        .in_("order_id", user_order_ids)
        .in_("status", ["pending", "invoiced"])
        .lt("due_date", date.today().isoformat())
        .execute()
    )
    overdue_exp = (
        client.table("expense_entries")
        .select("order_id, amount")
        .in_("order_id", user_order_ids)
        .eq("status", "approved")
        .lt("due_date", date.today().isoformat())
        .execute()
    )

    return APIResponse(
        data={
            "period": f"{year}-{month:02d}",
            "revenue": {"total": rev_total, "collected": rev_collected},
            "expense": {"total": exp_total, "paid": exp_paid},
            "gross_profit": rev_total - exp_total,
            "cash_flow": rev_collected - exp_paid,
            "overdue": {
                "receivable": sum(r["amount"] for r in overdue_rev.data),
                "payable": sum(e["amount"] for e in overdue_exp.data),
            },
        }
    )
