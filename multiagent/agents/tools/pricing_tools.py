"""가격/견적 MCP 도구 — 고객 견적서 14건 기반 단가 적용"""

import json
import logging

from claude_agent_sdk import create_sdk_mcp_server, tool

from agents.data.pricing_data import (
    CABINET_PRICES,
    COUNTERTOP_CATEGORIES,
    COUNTERTOP_PRICES,
    DEFAULT_FIXTURES,
    DISCOUNTS,
    DOOR_SURCHARGE,
    FIXTURES,
    LABOR,
    VAT_RATE,
)

logger = logging.getLogger(__name__)

# ─── 기존 하드코딩 단가 (하위호환) ───
BASE_PRICES = {
    "base_cabinet": {
        "300": 120_000, "450": 150_000, "600": 180_000, "900": 250_000,
    },
    "upper_cabinet": {
        "300": 80_000, "450": 100_000, "600": 120_000, "900": 170_000,
    },
    "tall_cabinet": {
        "300": 200_000, "450": 280_000, "600": 350_000, "900": 480_000,
    },
}

INSTALLATION_BASE = {
    "sink": 200_000, "island": 250_000, "closet": 150_000,
    "fridge_cabinet": 100_000, "shoe_cabinet": 80_000,
    "vanity": 100_000, "storage": 120_000, "utility_closet": 100_000,
}


# =============================================================================
# 새 견적 산출 함수 — 고객 견적 데이터 기반
# =============================================================================

def _calc_cabinet_price(category: str, width_mm: int, position: str = "lower") -> int:
    """캐비닛 단가 계산 (per 1000mm 비례).

    Args:
        category: 가구 카테고리
        width_mm: 모듈 폭 (mm)
        position: "lower" 또는 "upper"
    """
    prices = CABINET_PRICES.get(category, CABINET_PRICES.get("sink", {}))

    if category == "closet":
        # 붙박이장은 per 자(303mm) 기준 — 자 수 = 전체폭 / 303
        ja_count = max(1, round(width_mm / 303))
        key = "hinged_under_10" if ja_count < 10 else "hinged_over_10"
        per_ja = prices.get(key, 100_000)
        return per_ja * ja_count

    per_1000 = prices.get(position, prices.get("lower", 160_000))
    return int(per_1000 * width_mm / 1000)


def _merge_layout_and_vision(layout_data: dict, image_analysis: dict | None) -> dict:
    """Layout Engine 결과와 Vision 분석 결과를 교차검증/병합.

    Vision 분석이 있으면 상부장 정보와 부자재 존재 여부를 보강.
    Layout Engine 결과가 기본, Vision은 보충.
    """
    merged = {
        "lower_cabinets": [],
        "upper_cabinets": [],
        "countertop_length_mm": 0,
        "has_sink": False,
        "has_cooktop": False,
        "has_hood": False,
        "door_count": 0,
        "drawer_count": 0,
        "wall_width_mm": 0,
    }

    # Layout Engine 모듈 → lower_cabinets
    modules = layout_data.get("modules", [])
    total_width = 0
    for m in modules:
        w = m.get("width", 600)
        total_width += w
        merged["lower_cabinets"].append({
            "width_mm": w,
            "type": m.get("type", "door"),
        })

    merged["countertop_length_mm"] = total_width
    merged["wall_width_mm"] = total_width

    # Vision 분석 결과 보강
    if image_analysis and "error" not in image_analysis:
        # 상부장 — Vision에서만 파악 가능
        vision_uppers = image_analysis.get("upper_cabinets", [])
        if vision_uppers:
            merged["upper_cabinets"] = vision_uppers

        # 부자재 존재 여부
        merged["has_sink"] = image_analysis.get("has_sink", False)
        merged["has_cooktop"] = image_analysis.get("has_cooktop", False)
        merged["has_hood"] = image_analysis.get("has_hood", False)
        merged["door_count"] = image_analysis.get("door_count", 0)
        merged["drawer_count"] = image_analysis.get("drawer_count", 0)

        # Vision의 wall_width가 있으면 countertop 길이 보정
        vision_wall = image_analysis.get("estimated_wall_width_mm", 0)
        if vision_wall > 0:
            merged["wall_width_mm"] = vision_wall
            # countertop은 layout 기준 유지 (더 정확)

    return merged


def calculate_quote(
    modules: dict,
    category: str,
    wall_width: int,
    style: str = "modern",
    grade: str = "basic",
    include_demolition: bool = False,
    discounts: list[str] | None = None,
) -> dict:
    """고객 견적서 기반 견적 산출.

    Args:
        modules: _merge_layout_and_vision() 결과
        category: 가구 카테고리
        wall_width: 벽면 폭 (mm)
        style: 스타일
        grade: "basic" / "mid" / "premium"
        include_demolition: 철거 포함 여부
        discounts: 적용할 할인 코드 리스트

    Returns:
        견적 데이터 dict
    """
    items = []
    subtotal = 0

    # 1. 하부장
    for cab in modules.get("lower_cabinets", []):
        w = cab.get("width_mm", 600)
        price = _calc_cabinet_price(category, w, "lower")
        subtotal += price
        items.append({
            "name": f"하부장 {w}mm ({cab.get('type', 'door')})",
            "quantity": 1,
            "unit_price": price,
            "total": price,
        })

    # 2. 상부장
    for cab in modules.get("upper_cabinets", []):
        w = cab.get("width_mm", 600)
        price = _calc_cabinet_price(category, w, "upper")
        subtotal += price
        items.append({
            "name": f"상부장 {w}mm",
            "quantity": 1,
            "unit_price": price,
            "total": price,
        })

    # 3. 상판 (per 1000mm, 해당 카테고리만)
    countertop_price = 0
    if category in COUNTERTOP_CATEGORIES:
        ct_length = modules.get("countertop_length_mm", wall_width)
        per_1000 = COUNTERTOP_PRICES.get(grade, COUNTERTOP_PRICES["basic"])
        countertop_price = int(per_1000 * ct_length / 1000)
        subtotal += countertop_price
        items.append({
            "name": f"인조대리석 상판 ({grade})",
            "quantity": 1,
            "unit_price": countertop_price,
            "total": countertop_price,
        })

    # 4. 부자재 (카테고리별 기본 포함 항목)
    fixture_total = 0
    fixture_items = DEFAULT_FIXTURES.get(category, [])
    for fix_name in fixture_items:
        fix_prices = FIXTURES.get(fix_name, {})
        fix_price = fix_prices.get(grade, fix_prices.get("basic", 0))
        fixture_total += fix_price
        items.append({
            "name": f"부자재 ({fix_name})",
            "quantity": 1,
            "unit_price": fix_price,
            "total": fix_price,
        })
    subtotal += fixture_total

    # 5. 인건비 — 운반+설치 기본 포함
    install_fee = LABOR["delivery_install"]
    items.append({
        "name": "운반+설치",
        "quantity": 1,
        "unit_price": install_fee,
        "total": install_fee,
    })

    demolition_fee = 0
    if include_demolition:
        # 전체 주방(3000mm 이상)이면 대규모 철거
        demo_key = "demolition_large" if wall_width >= 3000 else "demolition_small"
        demolition_fee = LABOR[demo_key]
        items.append({
            "name": "철거",
            "quantity": 1,
            "unit_price": demolition_fee,
            "total": demolition_fee,
        })

    labor_total = install_fee + demolition_fee

    # 6. 할인
    discount_amount = 0
    applied_discounts = []
    if discounts:
        for code in discounts:
            rate = DISCOUNTS.get(code, 0)
            if rate > 0:
                amt = int(subtotal * rate)
                discount_amount += amt
                applied_discounts.append({
                    "code": code,
                    "rate": rate,
                    "amount": -amt,
                })

    # 7. 합산
    supply_amount = subtotal + labor_total - discount_amount
    vat = int(supply_amount * VAT_RATE)
    total = supply_amount + vat

    return {
        "items": items,
        "subtotal": subtotal,
        "countertop": countertop_price,
        "fixtures": fixture_total,
        "installation": install_fee,
        "demolition": demolition_fee,
        "discounts": applied_discounts,
        "discount_amount": discount_amount,
        "supply_amount": supply_amount,
        "vat": vat,
        "total": total,
        "grade": grade,
    }


# =============================================================================
# MCP 도구 (기존 호환)
# =============================================================================

@tool(
    "get_modules",
    "카테고리별 사용 가능한 모듈 종류와 규격을 조회합니다.",
    {
        "type": "object",
        "properties": {
            "category": {"type": "string", "description": "가구 카테고리"},
        },
        "required": ["category"],
    },
)
async def get_modules(args: dict) -> dict:
    modules = {
        "sink": {
            "base_modules": ["sink_bowl", "gas_range", "drawer_3", "door_2", "corner"],
            "upper_modules": ["door_2", "dish_rack", "range_hood", "corner"],
            "widths": [300, 450, 600, 900],
            "depth": 580,
            "height": {"base": 850, "upper": 600},
        },
        "closet": {
            "base_modules": ["shelf", "drawer", "hanging_rod", "shoe_rack"],
            "widths": [300, 450, 600, 900],
            "depth": 580,
            "height": {"full": 2400},
            "door_types": ["hinged", "sliding"],
        },
        "fridge_cabinet": {
            "base_modules": ["fridge_space", "upper_storage", "side_panel"],
            "widths": [600, 900],
            "depth": 600,
        },
    }

    category = args["category"]
    data = modules.get(category, {"message": f"{category} 카테고리 모듈 정보 준비중"})
    return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}


@tool(
    "get_prices",
    "모듈 구성에 대한 가격을 조회합니다.",
    {
        "type": "object",
        "properties": {
            "modules": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string"},
                        "width_mm": {"type": "integer"},
                        "door_type": {"type": "string"},
                    },
                },
                "description": "모듈 리스트",
            },
            "countertop_material": {"type": "string"},
            "countertop_area_m2": {"type": "number"},
        },
        "required": ["modules"],
    },
)
async def get_prices(args: dict) -> dict:
    total = 0
    items = []

    for module in args["modules"]:
        module_type = module["type"]
        width = str(module.get("width_mm", 600))
        price_map = BASE_PRICES.get(module_type, BASE_PRICES.get("base_cabinet", {}))
        base_price = price_map.get(width, price_map.get("600", 180_000))

        door_type = module.get("door_type", "wrapping")
        door_extra = DOOR_SURCHARGE.get(door_type, 0)

        module_total = base_price + door_extra
        total += module_total
        items.append({
            "module": f"{module_type} {width}mm",
            "base_price": base_price,
            "door_surcharge": door_extra,
            "total": module_total,
        })

    if args.get("countertop_material") and args.get("countertop_area_m2"):
        ct_grade_map = {
            "artificial_marble": "basic",
            "natural_stone": "premium",
            "stainless": "mid",
            "solid_surface": "mid",
        }
        ct_grade = ct_grade_map.get(args["countertop_material"], "basic")
        ct_per_1000 = COUNTERTOP_PRICES.get(ct_grade, 150_000)
        # m² → mm 변환: area_m2 * 1000000 / 580(depth) = length_mm
        length_mm = args["countertop_area_m2"] * 1_000_000 / 580
        ct_price = int(ct_per_1000 * length_mm / 1000)
        total += ct_price
        items.append({
            "module": f"상판 ({args['countertop_material']})",
            "total": ct_price,
        })

    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps({"items": items, "subtotal": total}, ensure_ascii=False),
            }
        ]
    }


@tool(
    "get_installation_cost",
    "카테고리별 설치비를 조회합니다.",
    {
        "type": "object",
        "properties": {
            "category": {"type": "string"},
            "include_demolition": {"type": "boolean", "description": "기존 철거 포함 여부"},
        },
        "required": ["category"],
    },
)
async def get_installation_cost(args: dict) -> dict:
    base = LABOR["delivery_install"]
    demolition = 0
    if args.get("include_demolition"):
        demolition = LABOR["demolition_small"]
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "installation_fee": base,
                        "demolition_fee": demolition,
                        "total": base + demolition,
                    }
                ),
            }
        ]
    }


@tool(
    "get_materials",
    "BOM용 자재 정보를 조회합니다. (Pro+)",
    {
        "type": "object",
        "properties": {
            "module_type": {"type": "string"},
            "width_mm": {"type": "integer"},
            "door_type": {"type": "string"},
        },
        "required": ["module_type", "width_mm"],
    },
)
async def get_materials(args: dict) -> dict:
    width = args["width_mm"]
    materials = [
        {"name": "본체 측판 (18T PB)", "spec": "580x850mm", "qty": 2},
        {"name": "본체 상판 (18T PB)", "spec": f"{width}x580mm", "qty": 1},
        {"name": "본체 하판 (18T PB)", "spec": f"{width}x580mm", "qty": 1},
        {"name": "뒷판 (9T MDF)", "spec": f"{width}x850mm", "qty": 1},
        {"name": f"도어 ({args.get('door_type', 'wrapping')})", "spec": f"{width}x720mm", "qty": 1},
        {"name": "경첩", "spec": "35mm 풀커버", "qty": 2},
        {"name": "선반", "spec": f"{width - 36}x550mm", "qty": 1},
    ]
    return {"content": [{"type": "text", "text": json.dumps(materials, ensure_ascii=False)}]}


pricing_server = create_sdk_mcp_server(
    name="pricing",
    version="1.0.0",
    tools=[get_modules, get_prices, get_installation_cost, get_materials],
)
