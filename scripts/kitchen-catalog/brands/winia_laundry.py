"""위니아 세탁기 · 건조기 (2026-11-20 사장님 「냉장고, 세탁기 등의 경우 조합되거나 결합되는 경우의 수 모두 포함」).

목록  POST www.winia.com/product/list_ajax (냉장고 수집기 wn_list 와 같은 길) — 메인 메뉴 링크의 TYPE · GNB_SEQ
        TYPE 7 세탁기: GNB 2075 드럼 · 2076 일반 · 2077 벽걸이드럼     TYPE 8 건조기: GNB 2078
      MNG_NAME 으로 나눈다: 드럼 세탁기 → drum (이름 '빌트인형' → install_type built_in), 일반 세탁기 → top_load,
      벽걸이드럼 → mini, 건조기 → dryer ('타입' 히트펌프 → heat_pump). 스마트 패키지(세탁기+건조기)는 행으로 넣지 않는다
      (단품이 따로 있다 — 조합은 laundry_build.py 가 패키지 사양으로 묶음을 만든다).
치수  /product/view?PRODUCT_SEQ= 정적 HTML '제품사양' 표 (wn_spec) '제품크기(WxHxD)mm' · '제품크기 (WxHxD)mm'.

robots.txt: `User-agent: * / Allow: /` (2026-11-20 원문 확인).
㈜위니아는 2023년 기업회생 절차 — 목록은 2018 ~ 2023년형이고 '지금 판매 중' 이 아니라 '사이트에 올라 있음' 이다.
"""
import re
import sys

BRAND_KEY = "winia_laundry"
# 주방가전 기본 실행(collect.py)에는 싣지 않는다 — 세탁기 · 건조기는 laundry_build.py 가 따로 모은다 (kitchen.json 에 섞이지 않게)
IN_KITCHEN = False
K = None

LISTS = (("7", "2075_2076_2077"), ("8", "2078"))
BOUNDS = {
    "washing_machine": {"w": (300, 800), "h": (300, 2000), "d": (250, 1000)},
    "dryer": {"w": (300, 800), "h": (300, 1100), "d": (250, 1000)},
}


def in_bounds(cat, d):
    b = BOUNDS[cat]
    return all(b[k][0] <= d[k][0] <= b[k][1] and b[k][0] <= d[k][1] <= b[k][1] for k in "whd")


def put_dims(row, d, raw):
    row["size_raw"] = raw
    if not d:
        row["tags"].append("치수확인필요")
        return
    row["width_mm"], row["height_mm"], row["depth_mm"] = d["w"][0], d["h"][0], d["d"][0]
    if any(d[k][0] != d[k][1] for k in "whd"):
        row["tags"].append("치수범위")
    if not in_bounds(row["category"], d):
        row["tags"].append("치수확인필요")


def kg(v):
    m = re.search(r"(\d+(?:\.\d+)?)\s*kg", v or "", flags=re.I)
    return K.F.to_num(m.group(1)) if m else None


def classify(p, title):
    mng = p.get("MNG_NAME") or ""
    if "패키지" in mng or "패키지" in title:
        return None, None
    if "건조기" in mng:
        return "dryer", None
    if "벽걸이" in mng:
        return "washing_machine", "mini"
    if "드럼" in mng:
        return "washing_machine", "drum"
    if "일반" in mng:
        return "washing_machine", "top_load"
    return None, None


def dry_subtype(v):
    v = v or ""
    if "히트펌프" in v:
        return "heat_pump"
    if "가스" in v:
        return "gas"
    if "히터" in v or "전기" in v or "열풍" in v:
        return "electric"
    return None


def size_of(spec, which=None):
    """'제품크기(WxHxD)mm' 칸. 패키지는 같은 이름이 두 번(세탁기 · 건조기) — wn_spec 은 첫 값만 남기므로 공백 다른 칸 이름으로 둘째를 찾는다."""
    keys = [k for k in spec if "WXHXD" in k.upper().replace(" ", "")]
    return keys


def collect(f, K_, sample=None):
    global K
    K = K_
    F = K.F
    rows, seen = [], set()
    for t, g in LISTS:
        total, ml = F.wn_list(f, t, g)
        print(f"[winia_laundry] TYPE {t}: total={total} listed={len(ml)}", file=sys.stderr)
        if sample:
            ml = ml[:sample]
        for p in ml:
            code = (p.get("PRODUCT_MODEL_NAME") or "").strip()
            title = re.sub(r"\s+", " ", p.get("PRODUCT_TITLE") or "").strip()
            cat, sub = classify(p, title)
            if not cat or not code or code in seen:
                continue
            seen.add(code)
            page = f"{F.WN}/product/view?PRODUCT_SEQ={p['PRODUCT_SEQ']}"
            st, h = f.get(page)
            spec = F.wn_spec(h) if st == 200 else {}
            if not spec:
                print(f"  [winia_laundry] no spec {code} {page}", file=sys.stderr)
                continue
            row = K.base_row(brand="Winia", category=cat, category_subtype=sub,
                             install_type="built_in" if "빌트인" in title else "freestanding", model_name=title,
                             model_codes=[code], line="위니아", source_url=page, page_url=page,
                             image_source_url=F.wn_image(h, p), sale_status=p.get("STATUS"))
            sk = next(iter(size_of(spec)), None)
            d, _ = K.dims_of(sk, spec.get(sk), "whd") if sk else (None, None)
            put_dims(row, d, f"{sk}: {spec.get(sk)}" if sk else None)
            wash = kg(spec.get("세탁용량"))
            dry = kg(spec.get("건조용량"))
            if cat == "dryer" and not dry:
                dry = kg(title)
            if cat == "washing_machine" and not wash:
                wash = kg(title)
            method = (spec.get("건조타입") or spec.get("타입")) if cat == "dryer" else None
            if cat == "dryer":
                row["category_subtype"] = dry_subtype(method)
            # 건조 겸용이라도 벽걸이(mini)는 크기 구분을 남긴다 — 건조 용량은 비고
            if cat == "washing_machine" and sub != "mini" and "건조겸용" in (spec.get("타입 (세탁전용 / 건조겸용)") or spec.get("타입(세탁전용 / 건조겸용)") or "").replace(" ", ""):
                row["category_subtype"] = "combo"
            row["capacity_wash_kg"], row["capacity_dry_kg"] = wash, dry
            parts = []
            if wash:
                parts.append(f"세탁 {wash}kg")
            if dry:
                parts.append(f"건조 {dry}kg")
            if method:
                parts.append(f"건조 방식 {method}")
            parts.append(f"제조사 메뉴 {p.get('MNG_NAME')}")
            if p.get("YEAR"):
                parts.append(f"{p['YEAR']}년형")
            row["product_type_raw"] = " · ".join(parts)
            rows.append(row)
    return rows
