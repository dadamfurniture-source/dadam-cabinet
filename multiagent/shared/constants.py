"""다담 SaaS 상수 정의"""

# 지원 가구 카테고리
CATEGORIES = {
    "sink": "싱크대",
    "island": "아일랜드",
    "closet": "붙박이장",
    "fridge_cabinet": "냉장고장",
    "shoe_cabinet": "신발장",
    "vanity": "화장대",
    "storage": "수납장",
    "utility_closet": "창고장",
}

# 카테고리 영어명 (이미지 생성 프롬프트용)
CATEGORIES_EN = {
    "sink": "kitchen sink cabinet",
    "island": "kitchen island",
    "closet": "built-in wardrobe closet",
    "fridge_cabinet": "built-in fridge cabinet",
    "shoe_cabinet": "entryway shoe cabinet",
    "vanity": "vanity dressing table",
    "storage": "built-in storage cabinet",
    "utility_closet": "utility storage closet",
}

# 요금제
PLANS = {
    "free": {
        "name": "Free",
        "price_krw": 0,
        "simulations_per_month": 3,
        "styles_per_request": 1,
        "features": ["basic_simulation", "basic_quote"],
    },
    "basic": {
        "name": "Basic",
        "price_krw": 9_900,
        "simulations_per_month": -1,  # unlimited
        "styles_per_request": 5,
        "features": ["basic_simulation", "basic_quote", "multi_style", "detailed_quote"],
    },
    "pro": {
        "name": "Pro",
        "price_krw": 49_000,
        "simulations_per_month": -1,
        "styles_per_request": 10,
        "features": [
            "basic_simulation",
            "basic_quote",
            "multi_style",
            "detailed_quote",
            "detail_design",
            "bom",
            "customer_management",
        ],
    },
    "enterprise": {
        "name": "Enterprise",
        "price_krw": 199_000,
        "simulations_per_month": -1,
        "styles_per_request": -1,
        "features": [
            "basic_simulation",
            "basic_quote",
            "multi_style",
            "detailed_quote",
            "detail_design",
            "bom",
            "customer_management",
            "cad_export",
            "api_access",
            "brand_custom",
            "dxf_export",
            "white_label_quote",
        ],
    },
}

# 이미지 생성 스타일
STYLES = ["modern", "nordic", "classic", "natural", "industrial", "luxury"]

# LoRA 모델 매핑 (기존 다담AI 자산)
LORA_MODELS = {
    "sink": "l_shaped_sink",
    "island": "island_kitchen",
    "closet": "builtin_closet",
    "fridge_cabinet": "fridge_cabinet",
    "shoe_cabinet": "shoe_cabinet",
    "vanity": "vanity_table",
    "storage": "storage_cabinet",
    "utility_closet": "utility_closet",
}
