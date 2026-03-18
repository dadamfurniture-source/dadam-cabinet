"""Enterprise API — API Key 관리 + 브랜드 커스터마이징 + CAD Export"""

import hashlib
import logging
import re
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from api.middleware.auth import CurrentUser, get_current_user, require_enterprise
from api.schemas.common import APIResponse
from shared.supabase_client import get_service_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/enterprise", tags=["Enterprise"])


def _safe_filename(name: str) -> str:
    """파일명에 안전한 문자만 남김"""
    return re.sub(r"[^\w\-.]", "_", name)[:100]


# ===== API Key 관리 =====


class CreateApiKeyRequest(BaseModel):
    name: str
    scopes: list[str] = ["read", "write"]
    expires_days: int | None = None


@router.post("/api-keys", response_model=APIResponse)
async def create_api_key(
    body: CreateApiKeyRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """API Key 생성 (Enterprise)"""
    require_enterprise(user)
    client = get_service_client()

    # 키 개수 제한 (최대 10개)
    existing = (
        client.table("api_keys")
        .select("id", count="exact")
        .eq("user_id", user.id)
        .eq("is_active", True)
        .execute()
    )
    if (existing.count or 0) >= 10:
        raise HTTPException(400, "API Key는 최대 10개까지 생성 가능합니다.")

    # 키 생성: dk_live_ + 48 random chars
    raw_key = f"dk_live_{secrets.token_urlsafe(36)}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    key_prefix = raw_key[:16]

    expires_at = None
    if body.expires_days:
        from datetime import timedelta

        expires_at = (datetime.utcnow() + timedelta(days=body.expires_days)).isoformat()

    valid_scopes = {"read", "write", "export", "admin"}
    scopes = [s for s in body.scopes if s in valid_scopes] or ["read"]

    record = (
        client.table("api_keys")
        .insert(
            {
                "user_id": user.id,
                "name": body.name,
                "key_hash": key_hash,
                "key_prefix": key_prefix,
                "scopes": scopes,
                "expires_at": expires_at,
            }
        )
        .execute()
    )

    return APIResponse(
        message="API Key가 생성되었습니다. 이 키는 다시 표시되지 않습니다.",
        data={
            "id": record.data[0]["id"],
            "key": raw_key,
            "prefix": key_prefix,
            "scopes": scopes,
            "expires_at": expires_at,
        },
    )


@router.get("/api-keys", response_model=APIResponse)
async def list_api_keys(
    user: CurrentUser = Depends(get_current_user),
):
    """API Key 목록 (Enterprise)"""
    require_enterprise(user)
    client = get_service_client()

    result = (
        client.table("api_keys")
        .select("id, name, key_prefix, scopes, is_active, last_used_at, expires_at, created_at")
        .eq("user_id", user.id)
        .order("created_at", desc=True)
        .execute()
    )

    return APIResponse(data={"keys": result.data})


@router.delete("/api-keys/{key_id}", response_model=APIResponse)
async def revoke_api_key(
    key_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """API Key 비활성화 (Enterprise)"""
    require_enterprise(user)
    client = get_service_client()

    result = (
        client.table("api_keys")
        .update({"is_active": False, "updated_at": datetime.utcnow().isoformat()})
        .eq("id", key_id)
        .eq("user_id", user.id)
        .execute()
    )

    if not result.data:
        raise HTTPException(404, "API Key를 찾을 수 없습니다.")

    return APIResponse(message="API Key가 비활성화되었습니다.")


# ===== 브랜드 커스터마이징 =====


class BrandSettingsUpdate(BaseModel):
    company_name: str | None = None
    logo_url: str | None = None
    primary_color: str | None = None
    secondary_color: str | None = None
    footer_text: str | None = None
    contact_info: dict | None = None
    watermark_text: str | None = None


@router.get("/brand", response_model=APIResponse)
async def get_brand_settings(
    user: CurrentUser = Depends(get_current_user),
):
    """브랜드 설정 조회 (Enterprise)"""
    require_enterprise(user)
    client = get_service_client()

    result = client.table("brand_settings").select("*").eq("user_id", user.id).execute()

    if result.data:
        return APIResponse(data=result.data[0])

    # 기본값 반환
    return APIResponse(
        data={
            "company_name": user.company_name,
            "primary_color": "#2563eb",
            "secondary_color": "#1e293b",
        }
    )


@router.put("/brand", response_model=APIResponse)
async def update_brand_settings(
    body: BrandSettingsUpdate,
    user: CurrentUser = Depends(get_current_user),
):
    """브랜드 설정 업데이트 (Enterprise)"""
    require_enterprise(user)
    client = get_service_client()

    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.utcnow().isoformat()

    # Upsert
    existing = client.table("brand_settings").select("id").eq("user_id", user.id).execute()

    if existing.data:
        client.table("brand_settings").update(update_data).eq("user_id", user.id).execute()
    else:
        update_data["user_id"] = user.id
        client.table("brand_settings").insert(update_data).execute()

    return APIResponse(message="브랜드 설정이 저장되었습니다.", data=update_data)


# ===== CAD Export (DXF) =====


@router.get("/export/{project_id}/drawing.dxf")
async def export_drawing_dxf(
    project_id: str,
    drawing_type: str = "front_elevation",
    user: CurrentUser = Depends(get_current_user),
):
    """CAD DXF 도면 다운로드 (Enterprise)"""
    require_enterprise(user)
    client = get_service_client()

    project = (
        client.table("projects")
        .select("id, name, category")
        .eq("id", project_id)
        .eq("user_id", user.id)
        .single()
        .execute()
    )
    if not project.data:
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")

    layout = (
        client.table("layouts")
        .select("layout_json")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not layout.data:
        raise HTTPException(404, "레이아웃 데이터가 없습니다.")

    import json as json_mod

    layout_json = layout.data[0].get("layout_json")
    if isinstance(layout_json, str):
        layout_json = json_mod.loads(layout_json)

    # 브랜드 설정 조회
    brand = client.table("brand_settings").select("*").eq("user_id", user.id).execute()
    brand_data = brand.data[0] if brand.data else None

    dxf_content = _generate_dxf(layout_json, project.data, brand_data)

    filename = f"dadam_{_safe_filename(project.data['name'])}_{drawing_type}.dxf"

    return Response(
        content=dxf_content,
        media_type="application/dxf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ===== 화이트라벨 견적서 =====


@router.get("/export/{project_id}/branded-quote.html")
async def export_branded_quote(
    project_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """브랜드 커스텀 견적서 HTML (Enterprise)"""
    require_enterprise(user)
    client = get_service_client()

    project = (
        client.table("projects")
        .select("*")
        .eq("id", project_id)
        .eq("user_id", user.id)
        .single()
        .execute()
    )
    if not project.data:
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")

    quote = (
        client.table("quotes")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not quote.data:
        raise HTTPException(404, "견적 데이터가 없습니다.")

    brand = client.table("brand_settings").select("*").eq("user_id", user.id).execute()
    brand_data = brand.data[0] if brand.data else {}

    import json as json_mod

    quote_json = quote.data[0].get("quote_json") or quote.data[0]
    if isinstance(quote_json, str):
        quote_json = json_mod.loads(quote_json)

    html = _generate_branded_quote_html(project.data, quote_json, brand_data)

    return Response(
        content=html,
        media_type="text/html",
        headers={
            "Content-Disposition": f'inline; filename="quote_{_safe_filename(project.data["name"])}.html"'
        },
    )


# ===== API 사용량 조회 =====


@router.get("/usage", response_model=APIResponse)
async def get_api_usage(
    days: int = 30,
    user: CurrentUser = Depends(get_current_user),
):
    """API 사용량 통계 (Enterprise)"""
    require_enterprise(user)
    days = min(days, 365)  # 최대 1년
    client = get_service_client()

    from datetime import timedelta, timezone

    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    logs = (
        client.table("api_usage_logs")
        .select("endpoint, method, status_code, created_at", count="exact")
        .eq("user_id", user.id)
        .gte("created_at", since)
        .order("created_at", desc=True)
        .limit(1000)
        .execute()
    )

    # 엔드포인트별 집계
    by_endpoint = {}
    for log in logs.data:
        ep = log["endpoint"]
        by_endpoint[ep] = by_endpoint.get(ep, 0) + 1

    return APIResponse(
        data={
            "total_requests": logs.count or len(logs.data),
            "period_days": days,
            "by_endpoint": by_endpoint,
            "recent": logs.data[:20],
        }
    )


# ===== DXF 생성 헬퍼 =====


def _generate_dxf(layout_json: dict, project: dict, brand: dict | None) -> str:
    """레이아웃 JSON에서 DXF R12 포맷 생성 (AutoCAD 호환)"""
    modules = layout_json.get("modules", [])
    specs = layout_json.get("cabinet_specs", {})
    lower_h = specs.get("lower_height_mm", 870)
    upper_h = specs.get("upper_height_mm", 720)
    toe_kick = specs.get("toe_kick_mm", 150)
    specs.get("depth_mm", 580)
    total_w = layout_json.get("total_width_mm", 2400)

    lines = []

    # DXF Header
    lines.extend(
        [
            "0",
            "SECTION",
            "2",
            "HEADER",
            "9",
            "$ACADVER",
            "1",
            "AC1009",
            "9",
            "$INSUNITS",
            "70",
            "4",  # mm
            "0",
            "ENDSEC",
        ]
    )

    # Tables section (minimal)
    lines.extend(
        [
            "0",
            "SECTION",
            "2",
            "TABLES",
            "0",
            "TABLE",
            "2",
            "LTYPE",
            "70",
            "1",
            "0",
            "LTYPE",
            "2",
            "CONTINUOUS",
            "70",
            "0",
            "3",
            "Solid line",
            "72",
            "65",
            "73",
            "0",
            "40",
            "0.0",
            "0",
            "ENDTAB",
            "0",
            "TABLE",
            "2",
            "LAYER",
            "70",
            "3",
        ]
    )

    # Layers
    for layer_name, color in [("OUTLINE", "7"), ("DIMENSION", "1"), ("TEXT", "3")]:
        lines.extend(
            [
                "0",
                "LAYER",
                "2",
                layer_name,
                "70",
                "0",
                "62",
                color,
                "6",
                "CONTINUOUS",
            ]
        )
    lines.extend(["0", "ENDTAB", "0", "ENDSEC"])

    # Entities section
    lines.extend(["0", "SECTION", "2", "ENTITIES"])

    # Overall cabinet outline
    _add_rect(lines, 0, toe_kick, total_w, lower_h, "OUTLINE")

    # Individual modules
    x_offset = 0
    for mod in modules:
        w = mod.get("width_mm", 450)
        features = mod.get("features", [])
        door_count = mod.get("door_count", 1)

        # Module outline
        _add_rect(lines, x_offset, toe_kick, w, lower_h - toe_kick, "OUTLINE")

        # Door lines
        door_w = w / door_count
        for d in range(door_count):
            dx = x_offset + d * door_w
            _add_rect(lines, dx + 2, toe_kick + 2, door_w - 4, lower_h - toe_kick - 4, "OUTLINE")

        # Feature labels
        cx = x_offset + w / 2
        cy = lower_h / 2
        if "sink_bowl" in features:
            _add_text(lines, cx, cy, "SINK", "TEXT", 30)
        elif "gas_range" in features:
            _add_text(lines, cx, cy, "COOKTOP", "TEXT", 30)

        # Width dimension
        _add_text(lines, cx, toe_kick - 20, f"{w}", "DIMENSION", 20)

        x_offset += w

    # Upper modules
    upper_modules = layout_json.get("upper_modules", [])
    upper_base_y = lower_h + 100  # gap between lower and upper
    for mod in upper_modules:
        w = mod.get("width_mm", 600)
        pos = mod.get("position_mm", 0)
        _add_rect(lines, pos, upper_base_y, w, upper_h, "OUTLINE")

        features = mod.get("features", [])
        cx = pos + w / 2
        cy = upper_base_y + upper_h / 2
        if "range_hood" in features:
            _add_text(lines, cx, cy, "HOOD", "TEXT", 30)

    # Title block
    company = "DADAM AI"
    if brand and brand.get("company_name"):
        company = brand["company_name"]

    _add_text(lines, total_w / 2, -60, f"{company} - {project.get('name', '')}", "TEXT", 40)
    _add_text(
        lines,
        total_w / 2,
        -100,
        f"Category: {project.get('category', '')} | Scale: 1:1 (mm)",
        "TEXT",
        25,
    )
    _add_text(lines, total_w, -140, f"Date: {datetime.utcnow().strftime('%Y-%m-%d')}", "TEXT", 20)

    # Watermark
    if brand and brand.get("watermark_text"):
        _add_text(lines, total_w / 2, lower_h / 2 + 200, brand["watermark_text"], "TEXT", 60)

    lines.extend(["0", "ENDSEC", "0", "EOF"])
    return "\n".join(lines)


def _add_rect(lines: list, x: float, y: float, w: float, h: float, layer: str):
    """DXF LINE entities for rectangle"""
    corners = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
    for i in range(4):
        x1, y1 = corners[i]
        x2, y2 = corners[(i + 1) % 4]
        lines.extend(
            [
                "0",
                "LINE",
                "8",
                layer,
                "10",
                f"{x1:.1f}",
                "20",
                f"{y1:.1f}",
                "30",
                "0.0",
                "11",
                f"{x2:.1f}",
                "21",
                f"{y2:.1f}",
                "31",
                "0.0",
            ]
        )


def _add_text(lines: list, x: float, y: float, text: str, layer: str, height: float = 25):
    """DXF TEXT entity"""
    lines.extend(
        [
            "0",
            "TEXT",
            "8",
            layer,
            "10",
            f"{x:.1f}",
            "20",
            f"{y:.1f}",
            "30",
            "0.0",
            "40",
            f"{height:.1f}",
            "1",
            text,
            "72",
            "1",  # center-aligned
            "11",
            f"{x:.1f}",
            "21",
            f"{y:.1f}",
            "31",
            "0.0",
        ]
    )


# ===== 화이트라벨 견적서 헬퍼 =====


def _generate_branded_quote_html(
    project: dict,
    quote_json: dict,
    brand: dict,
) -> str:
    """브랜드 커스텀 견적서 HTML 생성"""
    company = brand.get("company_name", "다담 AI")
    primary = brand.get("primary_color", "#2563eb")
    secondary = brand.get("secondary_color", "#1e293b")
    logo_url = brand.get("logo_url", "")
    footer = brand.get("footer_text", f"Powered by {company}")
    contact = brand.get("contact_info", {})

    items = quote_json.get("items", [])
    total = quote_json.get("total_price", sum(i.get("total", 0) for i in items))
    tax = int(total * 0.1)

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

    logo_html = (
        f'<img src="{logo_url}" alt="{company}" style="max-height:60px">' if logo_url else ""
    )

    contact_html = ""
    if contact:
        parts = []
        if contact.get("phone"):
            parts.append(f"Tel: {contact['phone']}")
        if contact.get("email"):
            parts.append(f"Email: {contact['email']}")
        if contact.get("address"):
            parts.append(contact["address"])
        if contact.get("website"):
            parts.append(contact["website"])
        contact_html = " | ".join(parts)

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>견적서 - {company}</title>
<style>
body {{ font-family: -apple-system, 'Malgun Gothic', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: {secondary}; }}
h1 {{ font-size: 24px; margin-bottom: 4px; color: {primary}; }}
table {{ width: 100%; border-collapse: collapse; margin: 16px 0; }}
th, td {{ border: 1px solid #e2e8f0; padding: 8px 12px; font-size: 14px; }}
th {{ background: #f8fafc; text-align: left; }}
.total-row {{ font-weight: 700; background: #f0f9ff; }}
.header {{ display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; border-bottom: 3px solid {primary}; padding-bottom: 16px; }}
.stamp {{ text-align: right; font-size: 13px; color: #64748b; }}
.contact {{ font-size: 12px; color: #64748b; margin-top: 4px; }}
@media print {{ body {{ padding: 20px; }} }}
</style>
</head>
<body>
<div class="header">
    <div>
        {logo_html}
        <h1>견 적 서</h1>
        <p style="color:#64748b">{company}</p>
        <p class="contact">{contact_html}</p>
    </div>
    <div class="stamp">
        <p>견적일: {datetime.now().strftime("%Y-%m-%d")}</p>
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

<footer style="margin-top:48px;text-align:center;font-size:12px;color:#94a3b8">
    {footer}
</footer>
</body>
</html>"""
