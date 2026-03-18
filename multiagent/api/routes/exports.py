"""B2B 내보내기 API — Pro+ 상세설계/BOM/견적서 다운로드"""

import csv
import io
import json as json_mod
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from api.middleware.auth import PLAN_ORDER, CurrentUser, get_current_user, require_pro
from api.schemas.common import APIResponse
from shared.supabase_client import get_service_client


def _safe_filename(name: str) -> str:
    """파일명에 안전한 문자만 허용"""
    return re.sub(r"[^\w\-.]", "_", name)[:100]


router = APIRouter(prefix="/exports", tags=["Exports (B2B)"])


def _get_project_data(project_id: str, user_id: str):
    """프로젝트 + 레이아웃 + 견적 + 상세설계 조회"""
    client = get_service_client()

    project = (
        client.table("projects")
        .select("*")
        .eq("id", project_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not project.data:
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")

    layout = (
        client.table("layouts")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    quote = (
        client.table("quotes")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    detail = (
        client.table("detail_designs")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    return {
        "project": project.data,
        "layout": layout.data[0] if layout.data else None,
        "quote": quote.data[0] if quote.data else None,
        "detail_design": detail.data[0] if detail.data else None,
    }


# ===== SVG 상세설계 도면 =====


@router.get("/{project_id}/drawing.svg")
async def export_drawing_svg(
    project_id: str,
    drawing_type: str = "front_elevation",
    user: CurrentUser = Depends(get_current_user),
):
    """상세설계 SVG 도면 다운로드 (Pro+)"""
    require_pro(user)
    data = _get_project_data(project_id, user.id)
    layout_json = _get_layout_json(data)

    from agents.tools.drawing_tools import _generate_front_elevation

    svg = _generate_front_elevation(layout_json)

    project_name = _safe_filename(data["project"]["name"])
    filename = f"dadam_{project_name}_{drawing_type}.svg"

    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


# ===== BOM 공통 로직 =====


def _build_bom(layout_json: dict) -> list[dict]:
    """레이아웃 JSON에서 모듈별 BOM 부품 리스트 생성"""
    modules = layout_json.get("modules", [])
    specs = layout_json.get("cabinet_specs", {})
    depth = specs.get("depth_mm", 580)

    bom_items = []
    for i, mod in enumerate(modules):
        w = mod.get("width_mm", 450)
        h = specs.get("lower_height_mm", 870)
        features = mod.get("features", [])
        door_count = mod.get("door_count", 1)
        door_h = h - specs.get("toe_kick_mm", 150)
        door_w = w // door_count

        parts = [
            {"name": "Side panel (18T PB)", "size": f"{depth}x{h}mm", "qty": 2},
            {"name": "Top panel (18T PB)", "size": f"{w}x{depth}mm", "qty": 1},
            {"name": "Bottom panel (18T PB)", "size": f"{w}x{depth}mm", "qty": 1},
            {"name": "Back panel (9T MDF)", "size": f"{w}x{h}mm", "qty": 1},
            {"name": "Shelf (18T PB)", "size": f"{w - 36}x{depth - 20}mm", "qty": 1},
            {"name": "Door panel", "size": f"{door_w}x{door_h}mm", "qty": door_count},
            {"name": "Hinge (35mm full-overlay)", "size": "soft-close", "qty": door_count * 2},
            {"name": "Handle", "size": "128mm center", "qty": door_count},
        ]

        if "sink_bowl" in features:
            parts.append(
                {
                    "name": "Sink cutout reinforcement",
                    "size": f"{w - 100}x{depth - 100}mm",
                    "qty": 1,
                }
            )

        bom_items.append(
            {
                "module_index": i + 1,
                "type": mod.get("type", "base_cabinet"),
                "width_mm": w,
                "features": features,
                "parts": parts,
            }
        )

    return bom_items


def _get_layout_json(data: dict) -> dict:
    """프로젝트 데이터에서 레이아웃 JSON 추출"""
    layout_data = data["layout"]
    if not layout_data:
        raise HTTPException(404, "레이아웃 데이터가 없습니다.")

    layout_json = layout_data.get("layout_json") or layout_data
    if isinstance(layout_json, str):
        layout_json = json_mod.loads(layout_json)
    return layout_json


# ===== BOM 자재 명세서 =====


@router.get("/{project_id}/bom.json", response_model=APIResponse)
async def export_bom_json(
    project_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """BOM 자재 명세서 JSON (Pro+)"""
    require_pro(user)
    data = _get_project_data(project_id, user.id)
    layout_json = _get_layout_json(data)
    bom_items = _build_bom(layout_json)

    total_parts = sum(sum(p["qty"] for p in m["parts"]) for m in bom_items)
    total_edge_1mm = sum(m["width_mm"] * 2 for m in bom_items)
    total_edge_04mm = sum(m["width_mm"] * 4 for m in bom_items)

    return APIResponse(
        data={
            "project_id": project_id,
            "project_name": data["project"]["name"],
            "category": data["project"]["category"],
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "module_count": len(bom_items),
            "total_parts": total_parts,
            "modules": bom_items,
            "edge_banding": {
                "1mm_PVC_meters": round(total_edge_1mm / 1000, 1),
                "0.4mm_PVC_meters": round(total_edge_04mm / 1000, 1),
            },
        }
    )


# ===== BOM CSV 다운로드 =====


@router.get("/{project_id}/bom.csv")
async def export_bom_csv(
    project_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """BOM 자재 명세서 CSV 다운로드 (Pro+)"""
    require_pro(user)
    data = _get_project_data(project_id, user.id)
    layout_json = _get_layout_json(data)
    bom_items = _build_bom(layout_json)

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    writer.writerow(["Module", "Type", "Width(mm)", "Part", "Size", "Qty"])
    for m in bom_items:
        for p in m["parts"]:
            writer.writerow(
                [m["module_index"], m["type"], m["width_mm"], p["name"], p["size"], p["qty"]]
            )

    csv_content = output.getvalue()
    project_name = _safe_filename(data["project"]["name"])

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="dadam_{project_name}_bom.csv"',
        },
    )


# ===== 견적서 HTML =====


@router.get("/{project_id}/quote.html")
async def export_quote_html(
    project_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """견적서 HTML (인쇄용, Pro+에서 상세 BOM 포함)"""
    data = _get_project_data(project_id, user.id)
    is_pro = PLAN_ORDER.get(user.plan, 0) >= PLAN_ORDER["pro"]

    quote_data = data["quote"]
    if not quote_data:
        raise HTTPException(404, "견적 데이터가 없습니다.")

    quote_json = quote_data.get("quote_json") or quote_data
    if isinstance(quote_json, str):
        quote_json = json_mod.loads(quote_json)

    project = data["project"]
    items = quote_json.get("items", [])
    total = quote_json.get("total_price", sum(i.get("total", 0) for i in items))
    tax = int(total * 0.1)

    # Build item rows
    item_rows = ""
    for idx, item in enumerate(items, 1):
        item_rows += f"""
        <tr>
            <td>{idx}</td>
            <td>{item.get("name", item.get("module", "-"))}</td>
            <td style="text-align:right">{item.get("qty", 1)}</td>
            <td style="text-align:right">{item.get("unit_price", item.get("base_price", 0)):,}</td>
            <td style="text-align:right">{item.get("total", 0):,}</td>
        </tr>"""

    # Pro+ BOM section
    bom_section = ""
    if is_pro and data["layout"]:
        bom_section = """
        <div style="page-break-before:always;margin-top:40px">
            <h2>자재 명세서 (BOM)</h2>
            <p style="color:#666">Pro+ 플랜 전용 - 공장 발주용 상세 자재 리스트</p>
            <p>BOM 상세 데이터는 <code>/api/v1/exports/{project_id}/bom.csv</code>에서 다운로드하세요.</p>
        </div>"""

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>견적서 - {project.get("name", "다담 AI")}</title>
<style>
body {{ font-family: -apple-system, 'Malgun Gothic', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #1e293b; }}
h1 {{ font-size: 24px; margin-bottom: 4px; }}
table {{ width: 100%; border-collapse: collapse; margin: 16px 0; }}
th, td {{ border: 1px solid #e2e8f0; padding: 8px 12px; font-size: 14px; }}
th {{ background: #f8fafc; text-align: left; }}
.total-row {{ font-weight: 700; background: #f0f9ff; }}
.header {{ display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; border-bottom: 3px solid #2563eb; padding-bottom: 16px; }}
.stamp {{ text-align: right; font-size: 13px; color: #64748b; }}
@media print {{ body {{ padding: 20px; }} }}
</style>
</head>
<body>
<div class="header">
    <div>
        <h1>견 적 서</h1>
        <p style="color:#64748b">다담 AI - 주문제작 가구 시뮬레이션</p>
    </div>
    <div class="stamp">
        <p>견적일: {datetime.now(timezone.utc).strftime("%Y-%m-%d")}</p>
        <p>프로젝트: {project.get("name", "-")}</p>
        <p>카테고리: {project.get("category", "-")}</p>
    </div>
</div>

<table>
<thead>
    <tr><th>No</th><th>항목</th><th style="text-align:right">수량</th><th style="text-align:right">단가</th><th style="text-align:right">금액</th></tr>
</thead>
<tbody>
    {item_rows}
</tbody>
<tfoot>
    <tr><td colspan="4" style="text-align:right">공급가액</td><td style="text-align:right">{total:,}원</td></tr>
    <tr><td colspan="4" style="text-align:right">부가세 (10%)</td><td style="text-align:right">{tax:,}원</td></tr>
    <tr class="total-row"><td colspan="4" style="text-align:right">합계</td><td style="text-align:right">{total + tax:,}원</td></tr>
</tfoot>
</table>

<p style="font-size:13px;color:#64748b;margin-top:24px">
* 본 견적서는 AI 시뮬레이션 기반이며, 실측 후 변동될 수 있습니다.<br>
* 견적 유효기간: 발행일로부터 30일
</p>

{bom_section}

<footer style="margin-top:48px;text-align:center;font-size:12px;color:#94a3b8">
    Powered by 다담 AI | dadamfurniture.com
</footer>
</body>
</html>"""

    project_name = _safe_filename(project.get("name", "quote"))
    return Response(
        content=html,
        media_type="text/html",
        headers={
            "Content-Disposition": f'inline; filename="dadam_{project_name}_quote.html"',
        },
    )


# ===== 내보내기 가능 항목 조회 =====


@router.get("/{project_id}/available", response_model=APIResponse)
async def list_available_exports(
    project_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """프로젝트에서 내보내기 가능한 항목 목록"""
    data = _get_project_data(project_id, user.id)
    is_pro = PLAN_ORDER.get(user.plan, 0) >= PLAN_ORDER["pro"]

    exports = []

    # 견적서는 모든 플랜에서 가능
    if data["quote"]:
        exports.append(
            {
                "type": "quote_html",
                "label": "견적서 (HTML)",
                "url": f"/api/v1/exports/{project_id}/quote.html",
                "available": True,
            }
        )

    # Pro+ 전용
    if data["layout"]:
        exports.append(
            {
                "type": "drawing_svg",
                "label": "상세설계 도면 (SVG)",
                "url": f"/api/v1/exports/{project_id}/drawing.svg",
                "available": is_pro,
                "requires_plan": "pro",
            }
        )
        exports.append(
            {
                "type": "bom_json",
                "label": "자재 명세서 (JSON)",
                "url": f"/api/v1/exports/{project_id}/bom.json",
                "available": is_pro,
                "requires_plan": "pro",
            }
        )
        exports.append(
            {
                "type": "bom_csv",
                "label": "자재 명세서 (CSV)",
                "url": f"/api/v1/exports/{project_id}/bom.csv",
                "available": is_pro,
                "requires_plan": "pro",
            }
        )

    return APIResponse(data={"exports": exports, "plan": user.plan})
