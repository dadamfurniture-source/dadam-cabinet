"""삼성 세탁기 · 건조기 (2026-11-20 사장님 「냉장고, 세탁기 등의 경우 조합되거나 결합되는 경우의 수 모두 포함」).

목록  samsung.com/sec goodsList dispClsfNo=100043932 (세탁기/건조기 모두보기 — 카테고리 페이지 HTML 의 dispClsfNo)
      하위 메뉴(dispClsfNo) 로 종류를 나눈다:
        100043933 Bespoke AI 콤보 → washing_machine combo        100043934 원바디 → washing_machine washtower
        100043949 드럼 (WD… 콤보 섞임) → drum / combo            100043950 통버블 · 컴팩트 → top_load / drum / combo
        100043951 건조기 → dryer                                 100043935 · 100043939 세탁기+건조기 패키지 → 뺀다 (단품이 따로 있다)
치수  compGoodsSpecList '크기(가로 × 높이 × 깊이)' — 칸 이름에서 순서를 읽는다.
용량  '세탁 용량' · '건조 용량' (kg) → 비고. capacity_l 은 비운다 (L 가 아니다).
건조 방식  '건조 방식' (인버터 히트펌프 + 히터 → heat_pump).

robots.txt: /sec/xhr/ · /sec/cxhr/ · 상품 페이지 모두 허용 (금지는 /*/search/ · /*/c/p/ · /*/multistore/* 등).
"""
import re
import sys

BRAND_KEY = "samsung_laundry"
# 주방가전 기본 실행(collect.py)에는 싣지 않는다 — 세탁기 · 건조기는 laundry_build.py 가 따로 모은다 (kitchen.json 에 섞이지 않게)
IN_KITCHEN = False
K = None

LIST_DISP = "100043932"
PACKAGE_DISP = {"100043935", "100043939"}
# 종류별 치수 범위 (mm) — collect.py BOUNDS 에 없는 종류라 여기 둔다 (밖이면 '치수확인필요' → SQL 에서 빠진다)
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


def kg_of(v):
    m = re.search(r"(\d+(?:\.\d+)?)\s*kg", v or "", flags=re.I)
    return K.F.to_num(m.group(1)) if m else None


def dry_subtype(v):
    v = v or ""
    if "히트펌프" in v:
        return "heat_pump"
    if "가스" in v:
        return "gas"
    if "히터" in v or "전기" in v:
        return "electric"
    return None


def classify(p, name, mdl):
    disp = p.get("dispClsfNo") or ""
    url = p.get("goodsDetailUrl") or ""
    if disp == "100043951" or mdl.startswith("DV"):
        return "dryer", None
    if "원바디" in name or url.split("/")[0] == "washing-machines" and "onebody" in url:
        return "washing_machine", "washtower"
    if "콤보" in name or "건조 겸용" in name or mdl.startswith("WD"):
        return "washing_machine", "combo"
    if "top-loader" in url or mdl.startswith("WA") or "통버블" in name:
        return "washing_machine", "top_load"
    return "washing_machine", "drum"


def line_of(name):
    if "Infinite" in name:
        return "Infinite"
    if "Bespoke" in name:
        return "Bespoke"
    return "일반"


def head(name):
    """'Bespoke AI 건조기 20kg (109.2mm LCD)+상단 설치 키트' → 괄호 밖 첫 '+' 앞까지."""
    depth = 0
    for i, ch in enumerate(name):
        depth += (ch == "(") - (ch == ")")
        if ch == "+" and depth == 0:
            return name[:i].strip()
    return name.strip()


def is_package(p, name):
    """세탁기+건조기 · +수납함 · +에어드레서 · +상단 설치 키트 묶음은 뺀다 (단품이 따로 있다).
    건조기 '+상단 설치 키트' 상품 가운데 단품이 목록에 없는 것은 남긴다 (판매 코드가 키트 포함 상품 코드 — 비고)."""
    if (p.get("dispClsfNo") or "") in PACKAGE_DISP:
        return True
    return "+" in re.sub(r"\([^)]*\)", "", name)   # '(71.1mm LCD+다이얼)' 의 + 는 묶음이 아니다


def collect(f, K_, sample=None):
    global K
    K = K_
    F = K.F
    count, prods = F.ss_list(f, LIST_DISP)
    print(f"[samsung_laundry] count={count} listed={len(prods)}", file=sys.stderr)
    names = {re.sub(r"\s+", " ", p.get("goodsNm") or "").strip(): p for p in prods}
    single_codes = set()
    for p in prods:
        nm = re.sub(r"\s+", " ", p.get("goodsNm") or "").strip()
        if not is_package(p, nm):
            single_codes.update(F.ss_variants(p))
    keep = []
    for p in prods:
        nm = re.sub(r"\s+", " ", p.get("goodsNm") or "").strip()
        mdl = p.get("mdlCode") or ""
        if is_package(p, nm):
            # 건조기 + 상단 설치 키트 상품인데 같은 이름의 단품이 없으면 (DV80F20DDTN · DV20CB8890BVL) 남긴다
            base = head(nm)
            if mdl.startswith("DV") and "상단 설치 키트" in nm and "세탁기" not in nm and base not in names:
                keep.append((p, nm, True))
            continue
        keep.append((p, nm, False))
    if sample:
        keep = keep[:sample]
    rows, done = [], set()
    for p, nm, kit_pkg in keep:
        for mdl, gid in F.ss_variants(p).items():
            if mdl in done:
                continue
            done.add(mdl)
            spec = F.ss_spec(f, gid)
            if not spec:
                continue
            cat, sub = classify(p, nm, mdl)
            row = K.base_row(brand="Samsung", category=cat, category_subtype=sub, install_type="freestanding",
                             model_name=(head(nm) if kit_pkg else nm), model_codes=[mdl], line=line_of(nm),
                             source_url=f"{F.SS}/sec/xhr/pf/compGoodsSpecList?goodsIds={gid}", image_source_url=F.ss_image(p),
                             page_url=f"{F.SS}/sec/{p['goodsDetailUrl']}", sale_status=p.get("saleStatCd"))
            k, v = K.ss_pick(spec, ["크기(", "외관 크기", "크기"], exclude=("포장", "내부", "박스", "도어 열림"))
            d, _ = K.dims_of(k, v, "whd")
            put_dims(row, d, v)
            wash = kg_of(spec.get("세탁 용량"))
            dry = kg_of(spec.get("건조 용량"))
            method = spec.get("건조 방식") or spec.get("건조방식")
            if cat == "dryer":
                row["category_subtype"] = dry_subtype(method)
            row["capacity_wash_kg"], row["capacity_dry_kg"] = wash, dry
            parts = []
            if wash:
                parts.append(f"세탁 {wash}kg")
            if dry:
                parts.append(f"건조 {dry}kg")
            if method:
                parts.append(f"건조 방식 {method}")
            if spec.get("모델명 (세탁기)") or spec.get("모델명 (건조기)"):
                parts.append(f"구성 세탁기 {spec.get('모델명 (세탁기)') or '?'} · 건조기 {spec.get('모델명 (건조기)') or '?'}")
            if kit_pkg:
                parts.append("판매 코드가 '건조기+상단 설치 키트' 상품 코드 (단품 목록 없음)")
            parts.append(f"제조사 메뉴 {p.get('dispClsfNo')}")
            if spec.get("동일모델의 출시년월"):
                parts.append(f"출시 {spec['동일모델의 출시년월']}")
            row["product_type_raw"] = " · ".join(parts)
            rows.append(row)
    return rows
