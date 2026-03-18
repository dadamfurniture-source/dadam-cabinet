"""고객 견적서 14건 분석 + 엑셀 product 시트 기반 통합 단가표

모든 캐비닛 단가는 per 1000mm 기준 (실측 폭 비례 계산).
붙박이장은 per 자(303mm) 기준.
"""

# ─── 캐비닛 단가 (per 1000mm) ───
CABINET_PRICES = {
    "sink": {  # 씽크대
        "lower": 160_000,   # 하부장 per 1000mm
        "upper": 140_000,   # 상부장 per 1000mm
    },
    "island": {  # 아일랜드
        "lower": 180_000,
        "upper": 140_000,
    },
    "closet": {  # 붙박이장 — per 자(303mm) 기준
        "hinged_under_10": 100_000,  # 여닫이 10자 미만
        "hinged_over_10": 90_000,    # 여닫이 10자 이상
        "sliding_under_10": 130_000, # 슬라이딩 10자 미만
        "sliding_over_10": 120_000,  # 슬라이딩 10자 이상
    },
    "shoe_cabinet": {  # 신발장
        "lower": 400_000,  # per 1000mm
    },
    "vanity": {  # 화장대
        "lower": 250_000,  # per 1000mm
    },
    "storage": {  # 수납장
        "D600": 160_000,  # 깊이 600mm
        "D400": 130_000,  # 깊이 400mm
        "D300": 120_000,  # 깊이 300mm
        "lower": 160_000, # 기본(D600)
    },
    "fridge_cabinet": {  # 냉장고장
        "lower": 180_000,
        "upper": 140_000,
    },
    "utility_closet": {  # 다용도실장
        "lower": 160_000,
        "upper": 130_000,
    },
}

# ─── 인조대리석 상판 (per 1000mm) ───
COUNTERTOP_PRICES = {
    "basic": 150_000,      # 일반 인조대리석
    "mid": 190_000,        # 에버모인급
    "premium": 230_000,    # 슈프림급
}

# 상판이 필요한 카테고리
COUNTERTOP_CATEGORIES = {"sink", "island", "vanity"}

# ─── 부자재 ───
FIXTURES = {
    "faucet": {"basic": 40_000, "mid": 110_000, "premium": 150_000},
    "sink_bowl": {"basic": 80_000, "mid": 385_000, "premium": 450_000},
    "hood": {"basic": 65_000, "mid": 80_000, "premium": 230_000},
}

# 카테고리별 기본 포함 부자재
DEFAULT_FIXTURES = {
    "sink": ["faucet", "sink_bowl", "hood"],
    "island": ["faucet", "sink_bowl"],
    "vanity": ["faucet", "sink_bowl"],
}

# ─── 도어 추가비 (per door) ───
DOOR_SURCHARGE = {
    "wrapping": 0,         # 래핑 (기본)
    "high_glossy": 30_000, # 하이그로시
    "paint": 50_000,       # 도장
    "solid_wood": 80_000,  # 원목
}

# ─── 인건비 ───
LABOR = {
    "delivery_install": 200_000,   # 운반 + 설치 기본
    "demolition_small": 300_000,   # 철거 소규모 (1~2개 장)
    "demolition_large": 500_000,   # 철거 대규모 (전체 주방)
    "electrical": 150_000,         # 전기작업 (콘센트/조명)
}

# ─── 할인 ───
DISCOUNTS = {
    "brand_event": 0.05,   # 브랜드 이벤트 5%
    "bulk_order": 0.03,    # 대량주문 3%
    "repeat_customer": 0.05,  # 재주문 고객 5%
}

VAT_RATE = 0.10
