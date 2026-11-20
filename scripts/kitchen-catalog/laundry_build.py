#!/usr/bin/env python3
"""세탁기 · 건조기 모델 + 조합 묶음(냉장고 나란히 · 세탁 쌓기) 수집 (2026-11-20 사장님
「냉장고, 세탁기 등의 경우 조합되거나 결합되는 경우의 수 모두 포함」 · 「모델, 치수, 사진은 공용 카탈로그」).

  python -I laundry_build.py --out <폴더>            # 받기 + 만들기 (요청 약 400개, 10분쯤)
  python -I laundry_build.py --out <폴더> --offline  # cache 만으로 다시 만든다

<폴더> 에 laundry.json/.csv (모델 행) · combos.json (묶음) · import-laundry.sql · import-combos.sql · robots.txt.log · cache/
DB 정의는 database/migrations/0073_appliance_laundry_combos.sql (dryer 종류 · 세부 구분 · appliance_combos · import_appliance_combos).
**0073 을 먼저 적용하고, import-laundry.sql → import-combos.sql 순서로 돌린다** (묶음은 모델 코드로 모델을 찾는다).

모델 행  brands/samsung_laundry.py · lg_laundry.py · winia_laundry.py (collect.py 공용 부분을 쓴다)
묶음     제조사가 안내한 것만 — 키트 상품 페이지 · 설치가이드의 호환 문구를 규칙으로 옮겼다 (아래 *_RULES).
         경우의 수는 늘어놓지 않는다: 나란히 = 같은 묶음 모델 1 ~ max_units 대, 쌓기 = lower × upper.
         다른 브랜드끼리 · 사이 여유를 모르는 조합은 만들지 않는다.
"""
import argparse
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


K = load("kitchen_collect", os.path.join(HERE, "collect.py"))
T = load("kitchen_to_sql", os.path.join(HERE, "to_sql.py"))
F = K.F
BRAND_FILES = ["samsung_laundry", "lg_laundry", "winia_laundry"]
KO = {"Samsung": "삼성", "LG": "LG", "Winia": "위니아"}

SS_BG = f"{F.SS}/sec/buying-guide/"
LG_WASH_GUIDE = f"{F.LG_WWW}/story/setup-guide/washer-installation-guide"
LG_FRIDGE_GUIDE = f"{F.LG_WWW}/story/setup-guide/refrigerator-installation-guide"


# --------------------------------------------------------------------------- 모델 행


def merge(rows):
    """같은 상품 이름 · 크기 · 용량 · 구분인 색상 변형은 한 행으로 (모델 코드는 모두 남긴다).
    주방가전과 달리 상품 이름과 코드 앞 두 글자도 키에 넣는다 — 쌓기 키트 호환이 코드 계열(FX · FG · WF80H …)로 갈려서
    크기만 같은 다른 계열을 한 행으로 묶으면 묶음 규칙이 틀린다."""
    out = {}
    for r in rows:
        if r.get("width_mm") is None:
            key = ("nodims", r["brand"]) + tuple(r["model_codes"])
        else:
            key = (r["brand"], r["category"], r["category_subtype"], r["line"], r["model_name"], (r["model_codes"] or [""])[0][:2],
                   r["width_mm"], r["height_mm"], r["depth_mm"],
                   r.get("capacity_wash_kg"), r.get("capacity_dry_kg"), r["install_type"], tuple(sorted(r["tags"])))
        if key not in out:
            r = dict(r)
            r["model_codes"] = list(r["model_codes"])
            r["source_urls"] = [r["source_url"]]
            out[key] = r
            continue
        o = out[key]
        for c in r["model_codes"]:
            if c and c not in o["model_codes"]:
                o["model_codes"].append(c)
        o["source_urls"].append(r["source_url"])
        if not o.get("image_source_url") and r.get("image_source_url"):
            o["image_source_url"] = r["image_source_url"]
    return list(out.values())


def sql_models(ok, skipped):
    lines = [
        "-- 세탁기 · 건조기 모델 가져오기 — scripts/kitchen-catalog/laundry_build.py 가 만든 파일 (2026-11-20 수집)",
        f"-- 행 {len(ok)}개 (검증 {sum(1 for r in ok if r['verified'])} · 미검증 {sum(1 for r in ok if not r['verified'])}) · 건너뜀 {len(skipped)}개",
        "-- 먼저 database/migrations/0073_appliance_laundry_combos.sql 을 적용해 두어야 한다 (dryer 종류 · 세탁기/건조기 세부 구분).",
        "-- 여러 번 실행해도 중복이 생기지 않는다 (같은 브랜드 · 겹치는 모델 코드면 갱신). 이 파일 다음에 import-combos.sql.",
    ]
    for row, why in skipped:
        lines.append(f"--   건너뜀 [{why}] {row['brand']} {row['category']} {row['model_name']} {','.join(row['model_codes'][:3])}")
    lines.append("")
    for i in range(0, len(ok), T.BATCH):
        chunk = json.dumps(ok[i:i + T.BATCH], ensure_ascii=False)
        assert "$laundry$" not in chunk
        lines.append(f"SELECT import_appliance_models($laundry${chunk}$laundry$::jsonb);")
    lines.append("")
    lines.append("SELECT category, subtype, brand, count(*), count(*) FILTER (WHERE verified) AS verified FROM appliance_models"
                 " WHERE category IN ('washing_machine', 'dryer') GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- 묶음 도움


def pat(p):
    """제조사 표기 'WF**CB*' · 'WF80H*****' · 'WW1*T*******' → 정규식. 가운데 * 는 한 글자, 끝의 * 묶음은 아무 글자."""
    m = re.match(r"^(.*?)(\**)$", p)
    body, tail = m.group(1), m.group(2)
    rx = "".join("." if c == "*" else re.escape(c) for c in body) + (".*" if tail else "")
    return re.compile("^" + rx + "$")


def code_match(r, pats):
    ps = [pat(p) for p in pats]
    return any(p.match(c) for c in r["model_codes"] for p in ps)


def label(r):
    return f"{r['model_codes'][0]} ({r['model_name']}, {r.get('width_mm')}×{r.get('depth_mm')}×{r.get('height_mm')})"


def stack(brand, name, lower, upper, kit_name=None, kit_code=None, source_url=None, verified=True, notes="", line=None):
    return {"brand": brand, "name": name, "family": "laundry", "kind": "stack", "line": line, "gap_mm": None, "max_units": 2,
            "kit_name": kit_name, "kit_code": kit_code, "source_url": source_url, "verified": verified, "notes": notes[:1000],
            "members": [{"code": r["model_codes"][0], "role": "lower"} for r in lower] +
                       [{"code": r["model_codes"][0], "role": "upper"} for r in upper],
            "_detail": {"lower": [label(r) for r in lower], "upper": [label(r) for r in upper]}}


def side(brand, name, items, gap, max_units, kit_name=None, kit_code=None, source_url=None, verified=True, notes="", line=None):
    codes = []
    for it in items:
        for c in it["codes"]:
            if c not in codes:
                codes.append(c)
    return {"brand": brand, "name": name, "family": "fridge", "kind": "side", "line": line, "gap_mm": gap, "max_units": max_units,
            "kit_name": kit_name, "kit_code": kit_code, "source_url": source_url, "verified": verified, "notes": notes[:1000],
            "members": [{"code": c, "role": "any"} for c in codes],
            "_detail": {"models": [f"{it['codes'][0]} ({it['name']})" + (f" +{len(it['codes']) - 1} 색상 코드" if len(it["codes"]) > 1 else "")
                                   for it in items]}}


# --------------------------------------------------------------------------- 세탁 쌓기 — 삼성


def ss_kit_url(f, code):
    count, prods = F.ss_list(f, "37070000")   # 리빙가전 소모품/액세서리 — SKK-* 상단 설치 키트 상품
    for p in prods:
        if code in F.ss_variants(p):
            return f"{F.SS}/sec/{p['goodsDetailUrl']}", sorted(F.ss_variants(p))
    return None, [code]


def ss_kit_text(f, url):
    if not url:
        return ""
    st, h = f.get(url)
    t = re.sub(r"\s+", " ", F.html_to_text(h)) if st == 200 else ""
    i = t.find("상단 설치 키트 별매")
    if i < 0:
        return ""
    s = t[max(0, t.rfind("*", 0, i)):i + 260]
    s = re.split(r"\* (?:보유|해당 이미지|상기 이미지|별도의 설치)", s)[0]
    return re.sub(r"\s+", " ", s).strip()


def samsung_stacks(f, rows):
    S = [r for r in rows if r["brand"] == "Samsung"]
    washers = [r for r in S if r["category"] == "washing_machine" and r["category_subtype"] == "drum"]
    dryers = [r for r in S if r["category"] == "dryer"]
    out, log = [], []
    gen = lambda r: r["line"] == "일반"   # noqa: E731 — BESPOKE 표기가 없는 모델 (제품 페이지 '세탁기/건조기별 호환 키트' 표의 정의)
    excl_w, excl_d = ["WF**A*", "WF**B*", "WF**CB*"], ["DV**A*", "DV**B*", "DV**CB*", "DV**DB*"]
    rules = [
        ("SKK-NRG", "삼성 Bespoke AI 세탁기 + 건조기 직렬 (WF80H · DV80H)",
         lambda r: code_match(r, ["WF80H*****"]), lambda r: code_match(r, ["DV80H*****"]), True, ""),
        ("SKK-NWG", "삼성 Bespoke AI 세탁기 + 건조기 직렬 (WF90F · WF80F · DV90F · DV80F)",
         lambda r: code_match(r, ["WF90F*****", "WF80F*****"]), lambda r: code_match(r, ["DV90F*****", "DV80F*****"]), True, ""),
        ("SKK-SRV", "삼성 Bespoke AI 슬림 세탁기 + 건조기 직렬 (WW13BB8 · DV10BB8)",
         lambda r: code_match(r, ["WW13BB8*"]), lambda r: code_match(r, ["DV10BB8*"]), True, ""),
        ("SKK-ANV", "삼성 Bespoke AI 세탁기 + 건조기 직렬 (WF**CB · DV**CB 등)",
         lambda r: code_match(r, ["WF**A*", "WF**B*", "WF**CB*"]), lambda r: code_match(r, ["DV**CB*", "DV**DB*"]), True, ""),
        ("SKK-ATW", "삼성 일반 세탁기 16kg 이상 + 건조기 14kg 이상 직렬",
         lambda r: gen(r) and (r.get("capacity_wash_kg") or 0) >= 16 and not code_match(r, excl_w),
         lambda r: gen(r) and (r.get("capacity_dry_kg") or 0) >= 14 and not code_match(r, excl_d), True,
         "BESPOKE 와 일반(BESPOKE 표기 없음) 세탁기 · 건조기는 키트 직렬설치가 서로 불가 (제품 페이지 '세탁기/건조기별 호환 키트') — 일반끼리만 넣었다."),
        ("SKK-TKV", "삼성 일반 세탁기 16kg 이상 + 9kg 건조기 직렬",
         lambda r: gen(r) and (r.get("capacity_wash_kg") or 0) >= 16,
         lambda r: gen(r) and r.get("capacity_dry_kg") == 9, True,
         "호환 키트 표 'SKK-TK*: 일반 세탁기 16kg 이상 / 일반 건조기 9kg'. 22/21년형 Bespoke AI 세탁기도 된다고 적혀 있으나 지금 목록에 없다."),
        ("SKK-UUW", "삼성 일반 세탁기 13/12kg + 9kg 건조기 직렬 (WW1*T)",
         lambda r: code_match(r, ["WW1*T*"]), lambda r: gen(r) and r.get("capacity_dry_kg") == 9, True,
         "키트 페이지 '호환 가능모델 : WW1*T*******' · 호환 키트 표 'SKK-UU*: 일반 세탁기 13/12kg / 일반 건조기 9kg'."),
    ]
    for kit, name, lw, up, ver, extra in rules:
        url, kit_codes = ss_kit_url(f, kit)
        text = ss_kit_text(f, url)
        lower = [r for r in washers if lw(r)]
        upper = [r for r in dryers if up(r)]
        if not lower or not upper:
            log.append(f"삼성 {kit}: 아래 {len(lower)} · 위 {len(upper)} — 지금 목록에 짝이 없어 만들지 않음")
            continue
        notes = " · ".join(x for x in [
            f"키트 페이지: {text}" if text else None,
            f"키트 색상 코드 {', '.join(kit_codes)}" if len(kit_codes) > 1 else None,
            extra or None,
            "보유 드럼세탁기 설치 가능 여부 사전 확인 · 설치 비용 별도 (키트 페이지)"] if x)
        out.append(stack("삼성", name, lower, upper, kit_name="건조기 상단 설치 키트", kit_code=kit, source_url=url,
                         verified=ver, notes=notes))
    log.append("삼성 SKK-ALV · SKK-ALB (WF**A*/B*/CB* × DV**A*/B*): 지금 목록의 DV**B* 는 슬림 DV10BB8 뿐 — 슬림은 SKK-SRV 전용이라 넣지 않음")
    log.append("삼성 SKK-UDW (WW10TP34*) · SKK-DDY (WW90T3 · WW90J3 · WD80R3): 세탁기가 지금 목록에 없어 만들지 않음")
    return out, log


# --------------------------------------------------------------------------- 세탁 쌓기 — LG


def lg_stacks(rows):
    L = [r for r in rows if r["brand"] == "LG"]
    drum = [r for r in L if r["category"] == "washing_machine" and r["category_subtype"] == "drum"]
    dry = [r for r in L if r["category"] == "dryer"]
    minis = [r for r in L if r["category"] == "washing_machine" and r["category_subtype"] == "mini"]
    combos = [r for r in L if r["category"] == "washing_machine" and r["category_subtype"] == "combo"]
    wkg = lambda r: r.get("capacity_wash_kg") or 0   # noqa: E731
    dkg = lambda r: r.get("capacity_dry_kg") or 0    # noqa: E731
    c0 = lambda r, *p: any(c.startswith(p) for c in r["model_codes"])   # noqa: E731
    src = LG_WASH_GUIDE
    common = "스태킹 키트는 단독 주문 · 자가 설치 불가, 전문 기사 설치. 필요 공간: 문열림 기준, 좌우 · 깊이 각 50mm 이상 (LG 세탁 건조기 설치가이드)"
    out, log = [], []

    def add(name, lower, upper, kit_name, ver, notes):
        if not lower or not upper:
            log.append(f"LG {name}: 아래 {len(lower)} · 위 {len(upper)} — 짝이 없어 만들지 않음")
            return
        out.append(stack("LG", name, lower, upper, kit_name=kit_name, kit_code=None, source_url=src, verified=ver, notes=notes))

    fx = [r for r in drum if c0(r, "FX") and 21 <= wkg(r) <= 25]
    rd = [r for r in dry if c0(r, "RD") and 19 <= dkg(r) <= 25]
    rg = [r for r in dry if c0(r, "RG")]
    fg = [r for r in drum if c0(r, "FG")]
    add("LG 트롬 세탁기 FX 21~25kg + 건조기 RD 19~25kg 직렬 (전용 스태킹 키트 · 블루투스)", fx, rd,
        "전용 스태킹 키트 (블루투스 연결 가능)", True,
        "가이드 '세탁기 21~25kg 플랫 디자인 (FX**) + 건조기 19~25kg 플랫 디자인 (RD**)' · 키트 40,000원 · " + common)
    add("LG 트롬 세탁기 FG + 건조기 RD · RG 직렬 (전용 스태킹 키트 · 블루투스 불가)", fg, rd + rg,
        "전용 스태킹 키트 (블루투스 연결 불가 · 리모컨 포함)", True,
        "가이드 '세탁기 FX****C 또는 FG** + 건조기 RD****C 또는 RG** — 둘 중 하나라도 해당되면 블루투스 불가, 리모컨 별도' · 키트 50,000원 · " + common)
    add("LG 트롬 세탁기 FX 21~25kg + 건조기 RG 직렬 (전용 스태킹 키트 · 블루투스 불가)", fx, rg,
        "전용 스태킹 키트 (블루투스 연결 불가 · 리모컨 포함)", True,
        "가이드 '세탁기 FX****C 또는 FG** + 건조기 RD****C 또는 RG**' (지금 목록에 FX****C · RD****C 코드는 없다) · 키트 50,000원 · " + common)
    old = [r for r in drum if c0(r, "F17", "F19", "F21") and 17 <= wkg(r) <= 24]
    flat = [r for r in dry if c0(r, "RD", "RG") and 14 <= dkg(r) <= 25]
    add("LG 트롬 세탁기 17~24kg (구디자인) + 건조기 RD · RG 14~25kg 직렬 (일반 스태킹 키트)", old, flat,
        "일반 스태킹(직렬형) 키트", False,
        "가이드 '세탁기 17~24kg 구디자인 (트롬플러스 제외) + 건조기 14~25kg 플랫디자인 (RD**/RG**)' · 키트 무료(기본구성). "
        "확인 필요: 어느 모델이 '구디자인'인지 가이드에 코드가 없어 F17 · F19 · F21 로 시작하는 트롬 세탁기로 골랐다 "
        "(F24 는 가이드에서 FX25 와 같은 도면 '추가 적용 모델' 이라 뺐다). 반대 조합(플랫 세탁기 + 구디자인 건조기 14~19kg)은 건조기 판정을 못 해 넣지 않았다. " + common)
    add("LG 트롬 세탁기 9~12kg + 건조기 RH9 · RH10 직렬 (전용 브라켓)",
        [r for r in drum if c0(r, "F9", "FR", "F10", "F12") and 9 <= wkg(r) <= 12], [r for r in dry if c0(r, "RH9", "RH10")],
        "전용 브라켓", True, "가이드 '세탁기 9~12kg (F9*/FR*/F10*/F12**) + 건조기 9~10kg (RH9**/RH10**)' · 키트 무료(기본구성) · " + common)
    add("LG 트롬 세탁기 9~25kg + 히트펌프 건조기 8~10kg (서랍형 키트)",
        [r for r in drum if 9 <= wkg(r) <= 25 and wkg(r) != 22 and not any(re.match(r"^F17.*PR$", c) for c in r["model_codes"])],
        [r for r in dry if r["category_subtype"] == "heat_pump" and dkg(r) in (8, 9, 10)],
        "서랍형 키트", True,
        "가이드 '세탁기 2009년 이후 9~25kg (22kg 및 F17**PR 제외) + 히트펌프 건조기 8,9,10kg' · 필요 높이 = 아래 세탁기 높이 + 940mm (키트 + 건조기 + 상단 여백), "
        "좌우 각 +50 · 깊이 +50 · 키트 12만원")
    add("LG 드럼 세탁기 + 건조기 (범용 스태킹 키트 · 앵글)",
        [r for r in drum if r["line"] != "LG SIGNATURE"], dry, "범용 스태킹 키트 (앵글)", True,
        "가이드 'LG전자 모든 드럼 세탁기 + 건조기 조합' · 폭 830mm(제품 + 좌우 여백) 확보 · 벽 타공 시공 필요 · 키트 14만 3천원 · "
        "미니워시/키높이 수납장이 결합된 세탁기 · 건조기, 시그니처 세탁기 · 세탁건조기, 워시콤보는 직렬 불가 (가이드). 타사 제품 조합도 된다고 하나 다른 브랜드 묶음은 만들지 않았다")
    gap_ok = {14, 16, 17, 19, 20, 21, 22, 25}
    add("LG 트롬 미니워시 FX4 (아래) + 드럼세탁기 · 건조기 · 워시콤보 FH25 (위)",
        [r for r in minis if c0(r, "FX4")],
        [r for r in drum if r.get("width_mm") == 700 and r.get("depth_mm") in (770, 830)] +
        [r for r in dry if r.get("width_mm") == 700 and dkg(r) in gap_ok] + [r for r in combos if c0(r, "FH25")],
        None, True,
        "미니워시 페이지 '2008년 이후 생산 된 드럼세탁기 중 폭 700mm, 깊이가 770mm 또는 830mm인 경우 설치 가능 (FC25*로 시작하는 워시콤보 모델에는 호환되지 않습니다)' · "
        "'LG 트롬 건조기 14/16/17/19/20/21/22/25kg 미니워시와 동일한 가로폭 700mm 인 경우' · 세탁 건조기 설치가이드 '워시콤보 (FH25)+미니워시 (FX4)'. "
        "세탁기 · 건조기 아래에 설치하는 제품으로 단독 설치 불가. 확인 필요: 가이드에 'AI 워시콤보 (FC2521)+미니워시 (FX4)' 도 있으나 미니워시 페이지와 어긋나 넣지 않았다 (FC25 는 FC4 미니워시)")
    add("LG 트롬 미니워시 FC4 (아래) + AI 워시콤보 FC25 (위)", [r for r in minis if c0(r, "FC4")], [r for r in combos if c0(r, "FC25")],
        None, True, "미니워시 페이지 'FC4*** 미니워시 모델과 결합 가능한 워시콤보는 FC25*** 모델입니다' · 워시콤보 투입구가 약 30cm 높아진다")
    add("LG 트롬 미니워시 FX2 (아래) + 워시콤보 컴팩트 FH11 (위)", [r for r in minis if c0(r, "FX2")], [r for r in combos if c0(r, "FH11")],
        None, True, "미니워시 페이지 'FX2*** 미니워시 모델과 결합 가능한 워시콤보 컴팩트는 FH11*** 모델입니다'")
    # 미니워시 묶음은 쌓기 키트가 아니라 결합 — 위 · 아래 자리만 쓴다 (lower = 미니워시)
    return out, log


# --------------------------------------------------------------------------- 세탁 쌓기 — 위니아


def winia_stacks(f, rows):
    W = [r for r in rows if r["brand"] == "Winia"]
    tot, ml = F.wn_list(f, "8", "2078")
    pkg = next((p for p in ml if "패키지" in (p.get("MNG_NAME") or "")), None)
    if not pkg:
        return [], ["위니아 스마트 패키지 없음"]
    page = f"{F.WN}/product/view?PRODUCT_SEQ={pkg['PRODUCT_SEQ']}"
    st, h = f.get(page)
    spec = F.wn_spec(h)
    keys = [k for k in spec if "WXHXD" in k.upper().replace(" ", "")]
    dims = [tuple(x[0] for x in K.split_dims(spec[k])) for k in keys]
    if len(dims) < 2 or "서랍형 스마트 키트" not in F.html_to_text(h):
        return [], ["위니아 스마트 패키지: 세탁기 · 건조기 크기 두 칸 또는 '서랍형 스마트 키트' 문구를 못 찾음"]
    (ww, wh, wd), (dw, dh, dd) = dims[0], dims[1]
    lower = [r for r in W if r["category"] == "washing_machine" and r.get("capacity_wash_kg") == 12
             and (r["width_mm"], r["height_mm"], r["depth_mm"]) == (ww, wh, wd)]
    upper = [r for r in W if r["category"] == "dryer" and r.get("capacity_dry_kg") == 10
             and (r["width_mm"], r["height_mm"], r["depth_mm"]) == (dw, dh, dd)]
    if not lower or not upper:
        return [], [f"위니아 스마트 패키지: 크기가 같은 단품 아래 {len(lower)} · 위 {len(upper)}"]
    notes = (f"'위니아 스마트 패키지 (세탁기 12kg + 건조기 10kg)' 상품 ({', '.join(p['PRODUCT_MODEL_NAME'] for p in ml if '패키지' in (p.get('MNG_NAME') or ''))}) — "
             f"'공간 활용의 최적화된 서랍형 스마트 키트'. 패키지 사양의 세탁기 {ww}×{wh}×{wd} · 건조기 {dw}×{dh}×{dd} (W×H×D) 와 크기 · 용량이 같은 단품을 넣었다. "
             "확인 필요: 패키지 구성 모델 코드가 페이지에 없어 단품 코드는 크기로 골랐다")
    return [stack("위니아", "위니아 드럼 세탁기 12kg + 건조기 10kg (스마트 패키지 · 서랍형 스마트 키트)", lower, upper,
                  kit_name="서랍형 스마트 키트", source_url=page, verified=False, notes=notes)], []


# --------------------------------------------------------------------------- 냉장고 나란히 — 삼성


def ss_fridge_items(f):
    items = []
    for disp in ("36010000", "36020000"):
        count, prods = F.ss_list(f, disp)
        for p in prods:
            nm = re.sub(r"\s+", " ", p.get("goodsNm") or "").strip()
            if p.get("goodsTpCd") == "20" or "+" in nm:
                continue
            items.append({"name": nm, "codes": list(F.ss_variants(p)), "mdl": p["mdlCode"]})
    seen, out = set(), []
    for it in items:
        if it["mdl"] not in seen:
            seen.add(it["mdl"])
            out.append(it)
    return out


def samsung_sides(f):
    items = ss_fridge_items(f)
    pre = lambda it, *p: it["mdl"].startswith(p)   # noqa: E731
    inf = lambda it: "Infinite" in it["name"]       # noqa: E731
    bes = [it for it in items if "Bespoke" in it["name"] and not inf(it)]
    one = [it for it in bes if "1도어 키친핏" in it["name"]]
    one_std = [it for it in one if pre(it, "RR40", "RZ34", "RQ34")]
    one_var = [it for it in one if pre(it, "RZ24", "RW")]
    one_handle = [it for it in one if pre(it, "RR70", "RZ70")]
    inf_one = [it for it in items if inf(it) and "1도어 키친핏" in it["name"]]
    inf_four = [it for it in items if inf(it) and "4도어 키친핏" in it["name"]]
    four = [it for it in bes if re.search(r"[43]도어 키친핏", it["name"])]
    two = [it for it in bes if "2도어 키친핏" in it["name"]]
    base = ("삼성 냉장고 구매가이드 '키친핏 조합' 설치 유의사항 — 2대 이상 페어 설치 시 별매품 페어키트로 제품 사이를 연결. "
            "프리스탠딩과 프리스탠딩 · 프리스탠딩과 키친핏은 페어 불가. 4+4 조합을 제외한 페어설치시 힌지와 힌지가 맞닿도록 설치 불가. 제품과 냉장고장 간 최소 12mm")
    out, log = [], []

    def add(name, members, gap, mu, kit, ver, notes, line):
        if len(members) < 1 or (mu >= 2 and sum(len(m["codes"]) for m in members) < 1):
            log.append(f"삼성 {name}: 모델 없음")
            return
        out.append(side("삼성", name, members, gap, mu, kit_name="페어키트", kit_code=kit, source_url=SS_BG, verified=ver,
                        notes=notes + " · " + base, line=line))

    add("삼성 Bespoke 1도어 키친핏 냉장 · 냉동 · 김치 (1+1+1+1)", one_std, 10, 4, "RA-C00K1DAA", True,
        "가이드 '1+1+1+1도어' · '오토 오픈 도어 사용 편의성을 위해 1도어 냉장/냉동/김치는 10 mm' (RR40* · RZ34* 모델 절)", "Bespoke")
    add("삼성 Bespoke 1도어 키친핏 변온 · 와인 포함 (1+1+1+1)", one_std + one_var, 15, 4, "RA-C00K1DAA", True,
        "사이 여유: 1도어 변온/와인은 도어 개폐 방향에 따라 7 mm 혹은 15 mm (RZ24* · RW24* 절) — 넓은 값 15 를 넣었다. 냉장/냉동/김치끼리는 10 mm", "Bespoke")
    add("삼성 Bespoke 1도어 키친핏 도어핸들 RR70 · RZ70 (1+1+1+1)", one_handle, 10, 4, "RA-C00K1DAA", True,
        "가이드 'RR70*(냉장)/RZ70*(냉동) 도어핸들 모델' 절 '제품간 간격은 10mm', 설치 간격은 핸들 모델 기준. "
        "같은 2026년형 김치플러스 1도어 RQ70 은 이 절에 이름이 없어 넣지 않았다 (확인 필요)", "Bespoke")
    add("삼성 Infinite Line 1도어 키친핏 (1+1 · 1+1+1+1)", inf_one, 10, 4, "RA-C00K1CAA", True,
        "가이드 Infinite Line '1+1+1+1도어' · '1+1도어' · 제품 간 간격 10 mm · 1도어 조합은 RA-C00K1CAA 페어키트 · Infinite Line 4도어와 1도어 간 페어 불가 · "
        "제품과 냉장고장 간 최소 5 mm (1도어 키친핏 절)", "Infinite Line")
    add("삼성 Infinite Line 4도어 키친핏 냉장고 + 김치플러스 (4+4)", inf_four, 10, 2, "RA-C00K1DAA", True,
        "가이드 Infinite Line '4+4도어' · 제품 간 간격 10 mm · 4도어 조합은 RA-C00K1DAA · 4+4 는 맞닿는 도어 오픈 각도를 90도로 조정", "Infinite Line")
    add("삼성 Bespoke 4도어 키친핏 + 김치플러스 4 · 3도어 키친핏 (4+4 · 4+3)", four, 15, 2, "RA-C00K1DAA", True,
        "가이드 '4+4도어' · '4+3도어' · 제품 간 간격 7~15 mm (RM***63*/64* · RF60* 절) — 넓은 값 15 를 넣었다", "Bespoke")
    add("삼성 Bespoke 4도어 키친핏 + 김치플러스 4 · 3도어 + 1도어 키친핏 (4+4+1 · 4+3+1 · 4+1)", four + one_std + one_var, 15, 3, "RA-C00K1DAA", False,
        "가이드 '4+4+1도어' · '4+3+1도어' · '4+1도어' · 간격 7~15 mm — 넓은 값 15. 확인 필요: 묶음 규칙으로는 4도어 3대 같은 안내 없는 조합도 나온다 "
        "(안내된 3대 조합은 4도어 1~2대 + 1도어 1대뿐)", "Bespoke")
    add("삼성 Bespoke 2도어 키친핏 + 1도어 키친핏 (2+1)", two + one_std + one_var, 15, 2, "RA-C00K1DAA", True,
        "가이드 '2+1도어' · 간격 7~15 mm — 넓은 값 15. 1,070 mm 냉장고장에서 1도어 변온/와인 모델과 페어 설치 시 2도어 모델은 냉장고장과 9 mm. "
        "2도어 2대 조합은 안내 없음 (묶음 규칙으로는 나온다 — 확인 필요)", "Bespoke")
    return out, log


# --------------------------------------------------------------------------- 냉장고 나란히 — LG (설치가이드의 조합 절)


def lg_fridge_items(f):
    items = []
    for cat in ("CT50000065", "CT50073000", "CT50000072"):
        total, ml = F.lg_list(f, cat)
        for m in ml:
            sub = m.get("subCategoryName") or ""
            nm = re.sub(r"\s+", " ", m.get("modelDisplayName") or "").strip()
            if "키트" in sub or "세트" in sub or "+" in nm or "KIT" in (m.get("modelName") or "").upper():
                continue
            items.append(m)
    return items


def lg_codes_for(f, prefixes, items, cache={}):
    """가이드의 모델 앞자리(Q405 · X324 …)로 시작하는 목록 모델 + 그 색상 변형 코드 (pdp spec modelName — 냉장고 수집기와 같은 값)."""
    out = []
    for m in items:
        mn = m.get("modelName") or ""
        if not any(mn.startswith(p) for p in prefixes):
            continue
        codes = [mn]
        for og in m.get("optionGroupList") or []:
            for o in og.get("optionList") or []:
                vid = o.get("modelId")
                if not vid or vid == m.get("modelId"):
                    continue
                if vid not in cache:
                    sp = F.lg_spec(f, vid)
                    cache[vid] = (sp or {}).get("modelName") or (sp or {}).get("salesModelCode")
                if cache[vid] and cache[vid] not in codes:
                    codes.append(cache[vid])
        out.append({"name": re.sub(r"\s+", " ", m.get("modelDisplayName") or "").strip(), "codes": codes})
    return out


HEAD = re.compile(r"\((\d{2})년형・([A-Z0-9_*]+)\)")


def lg_guide_pairs(f):
    """설치가이드 글 → [{nodes:[(code, label)], mult:{code:n}, gap, kit}] 와 별칭 {code: [동일 적용 코드…]}."""
    st, h = f.get(LG_FRIDGE_GUIDE)
    lines = [x.strip() for x in F.html_to_text(h).split("\n")]
    heads = [i for i, l in enumerate(lines) if HEAD.search(l) and len(l) < 160 and not l.startswith(("*", "동일", "냉장고 동일", "컨버터블 패키지 동일"))]
    alias, pairs = {}, []
    for n, i in enumerate(heads):
        l = lines[i]
        end = heads[n + 1] if n + 1 < len(heads) else len(lines)
        body = lines[i + 1:end]
        segs = [s.strip() for s in l.split("+")]
        nodes = []
        for s in segs:
            m = HEAD.search(s)
            if not m:
                continue
            code = m.group(2).rstrip("*").split("_")[0]
            mult = 2 if re.search(r"×\s*2대", s) else 1
            nodes.append((code, s.split("(")[0].strip(), mult))
        for b in body[:4]:
            mm = re.match(r"^(냉장고 |컨버터블 패키지 )?동일 적용 모델\s*:\s*(.+)$", b)
            if not mm:
                continue
            same = [c.rstrip("*").split("_")[0] for c in re.findall(r"([A-Z]\d{3}[A-Z0-9_*]*)", mm.group(2))]
            tgt = None
            if len(nodes) == 1:
                tgt = nodes[0][0]
            elif mm.group(1) and mm.group(1).startswith("냉장고"):
                tgt = next((c for c, lb, _ in nodes if "냉장" in lb and "컨버터블" not in lb), None)
            elif mm.group(1):
                tgt = next((c for c, lb, _ in nodes if "컨버터블" in lb), None)
            if tgt:
                alias.setdefault(tgt, [])
                alias[tgt] += [c for c in same if c not in alias[tgt]]
        if len(nodes) < 2 and not any(mu == 2 for _, _, mu in nodes):
            continue
        text = " ".join(body)
        g = re.search(r"간격은 (\d+)\s*mm (?:이상 )?필요", text)
        k = re.search(r"\(((?:FM|OC)-KIT\d+)\)", text, flags=re.I)
        kits = k.group(1).upper() if k else None
        need = re.search(r"필요 키트\s*:\s*(.+?)(?:이|가) 필요", text)   # '필요 키트: OC-KIT8 1개, FM-KIT2 1개가 필요합니다' (3대 조합)
        if need:
            kits = "+".join(x.upper() for x in re.findall(r"((?:FM|OC)-KIT\d+)", need.group(1), flags=re.I)) or kits
        pairs.append({"heading": l, "nodes": [(c, lb) for c, lb, _ in nodes], "mult": {c: mu for c, _, mu in nodes},
                      "units": sum(mu for _, _, mu in nodes), "gap": int(g.group(1)) if g else None, "kit": kits})
    return pairs, alias


def lg_sides(f):
    pairs, alias = lg_guide_pairs(f)
    items = lg_fridge_items(f)
    labels = {}
    for p in pairs:
        for c, lb in p["nodes"]:
            labels.setdefault(c, lb)
    out, log = [], []
    groups = {}
    for p in pairs:
        if p["gap"] is None or p["kit"] is None:
            log.append(f"LG 가이드 절 '{p['heading']}': 간격 {p['gap']} · 키트 {p['kit']} — 모르는 값이 있어 넣지 않음")
            continue
        groups.setdefault((p["kit"], p["gap"], 3 if p["units"] >= 3 else 2), []).append(p)
    convertible = lambda c: c[0] in "XYZ" and "컨버터블" in labels.get(c, "")   # noqa: E731
    for (kit, gap, units), ps in sorted(groups.items()):
        edges, selfs = set(), set()
        nodes = set()
        for p in ps:
            cs = [c for c, _ in p["nodes"]]
            nodes.update(cs)
            for c in cs:
                if p["mult"].get(c, 1) >= 2:
                    selfs.add(c)
            for a in cs:
                for b in cs:
                    if a < b:
                        edges.add((a, b))
        cover, left = [], set(edges)
        while left:
            a, b = sorted(left)[0]
            cl = {a, b}
            for n in sorted(nodes):
                if n not in cl and all(tuple(sorted((n, c))) in edges for c in cl):
                    cl.add(n)
            cover.append(cl)
            left -= {e for e in left if e[0] in cl and e[1] in cl}
        for s in sorted(selfs):
            # 같은 모델 2대가 안내된 앞자리: 다른 묶음에 들어 있어도 컨버터블은 혼자 묶음을 하나 더 둔다
            #   (OC-KIT8 페이지 '3대(냉장·냉동·김치) 조합 시 2개' — 3대까지는 컨버터블끼리만)
            if not any(s in cl for cl in cover) or (convertible(s) and kit.upper() == "OC-KIT8" and units == 2 and {s} not in cover):
                cover.append({s})
        for cl in cover:
            members, missing = [], []
            for c in sorted(cl):
                got = lg_codes_for(f, [c] + alias.get(c, []), items)
                (members.extend(got) if got else missing.append(c))
            present = [c for c in sorted(cl) if c not in missing]
            if not members or (len(present) < 2 and not (set(present) & selfs)):
                log.append(f"LG {kit} 간격 {gap}: {'+'.join(sorted(cl))} — 지금 목록에 모델이 모자라 넣지 않음 (없는 앞자리 {', '.join(missing)})")
                continue
            only_conv = all(convertible(c) for c in present)
            mu = 3 if (only_conv and kit.upper() == "OC-KIT8") or units >= 3 else 2
            listed = [p["heading"] for p in ps if set(c for c, _ in p["nodes"]) <= cl]
            dbl = sorted(set(present) & selfs)
            no_dbl = sorted(set(present) - selfs)
            names = " + ".join(f"{labels.get(c, c)} {c}" + (f"({'/'.join(alias[c])})" if alias.get(c) else "") for c in present)
            notes = [f"설치가이드 조합 절: {' | '.join(listed)}", f"세트(페어) 설치 시 제품 본체 간 간격 {gap}mm · {kit} 필요"]
            if dbl:
                notes.append(f"같은 모델 2대 안내 있음: {', '.join(dbl)}")
            if no_dbl and mu >= 2:
                notes.append(f"같은 모델 2대 안내 없음: {', '.join(no_dbl)} (묶음 규칙으로는 나온다 — 확인 필요)")
            if mu == 3 and only_conv:
                notes.append("OC-KIT8 상품 페이지 '3대(냉장·냉동·김치) 조합 시 2개의 OC-KIT8' — 3대까지")
            if missing:
                notes.append(f"지금 목록에 없는 앞자리: {', '.join(missing)}")
            notes.append("컨버터블 패키지는 도어 핸들이 두 제품 사이를 향하면 간격 +12mm (가이드)" if any(convertible(c) for c in present) else "")
            out.append(side("LG", f"LG Fit & Max · 컨버터블 페어 {'+'.join(present)} ({kit})"[:120], members, gap, mu,
                            kit_name={"FM-KIT2": "26년형 연결 설치용 Fit & Max 설치키트", "OC-KIT7": "25년형 2대 페어용 Fit & Max 설치키트",
                                      "OC-KIT8": "컨버터블 2대 페어용 Fit & Max 설치키트"}.get(kit.upper(), "페어설치키트"),
                            kit_code=kit, source_url=LG_FRIDGE_GUIDE, verified=True,
                            notes=" · ".join(x for x in notes if x) + f" · 모델: {names}", line="Fit & Max"))
    return out, log


# --------------------------------------------------------------------------- robots.txt 기록


def robots_rules(txt):
    """User-agent: * 묶음의 Disallow · Allow (원문 그대로 — 파이썬 robotparser 를 믿지 않는다)."""
    groups, cur, ua_line = [], None, False
    for raw in txt.splitlines():
        l = raw.split("#")[0].strip()
        if not l or ":" not in l:
            continue
        k, v = [x.strip() for x in l.split(":", 1)]
        k = k.lower()
        if k == "user-agent":
            if not ua_line:
                cur = {"ua": [], "rules": []}
                groups.append(cur)
            cur["ua"].append(v)
            ua_line = True
        elif k in ("disallow", "allow") and cur is not None:
            cur["rules"].append((k, v))
            ua_line = False
        else:
            ua_line = False
    star = [g for g in groups if "*" in g["ua"]]
    return star[0]["rules"] if star else []


def rule_hit(path, rule):
    if not rule:
        return False
    rx = "^" + "".join(".*" if c == "*" else ("$" if c == "$" else re.escape(c)) for c in rule)
    return re.match(rx, path) is not None


def allowed_by(rules, path):
    best = None
    for k, v in rules:
        if rule_hit(path, v) and (best is None or len(v) > len(best[1]) or (len(v) == len(best[1]) and k == "allow")):
            best = (k, v)
    return best is None or best[0] == "allow", best


def robots_log(f, cache_dir):
    import urllib.parse
    used = {}
    for root, _, files in os.walk(cache_dir):
        for fn in files:
            if not fn.endswith(".json"):
                continue
            try:
                c = json.load(open(os.path.join(root, fn), encoding="utf-8"))
            except Exception:
                continue
            u = urllib.parse.urlparse(c["url"])
            used.setdefault(f"{u.scheme}://{u.netloc}", set()).add(u.path)
    out = ["# robots.txt 확인 기록 — laundry_build.py (2026-11-20). User-agent: * 묶음을 원문에서 직접 읽어 판정 (파이썬 robotparser 를 믿지 않음)",
           "# UA = " + F.UA, ""]
    for base in sorted(used):
        r = f._raw(base + "/robots.txt", "GET", None, {}, check_robots=False)
        st = r[0] if r else None
        txt = r[1] if r and r[0] < 400 else ""
        rules = robots_rules(txt) if txt else []
        paths = sorted(p for p in used[base] if p != "/robots.txt")
        bad = [(p, hit) for p in paths for ok, hit in [allowed_by(rules, p)] if not ok]
        out.append(f"{base}  robots.txt {st}  " + ("(없음 → 전부 허용)" if not txt else f"User-agent * 규칙 {len(rules)}개"))
        out.append(f"  받은 경로 {len(paths)}개 — " + ("모두 허용" if not bad else f"금지에 걸림 {len(bad)}개: " + ", ".join(f"{p} ({h})" for p, h in bad[:10])))
        for p in sorted({re.sub(r"/[^/]*$", "/", p) for p in paths})[:12]:
            out.append(f"    {p}")
        out.append("")
    return "\n".join(out) + "\n"


# --------------------------------------------------------------------------- main


def sql_combos(combos):
    rows = [{k: v for k, v in c.items() if not k.startswith("_")} for c in combos]
    lines = [
        "-- 가전 조합 묶음 가져오기 (냉장고 나란히 · 세탁 쌓기) — scripts/kitchen-catalog/laundry_build.py 가 만든 파일 (2026-11-20 수집)",
        f"-- 묶음 {len(rows)}개 (냉장고 나란히 {sum(1 for r in rows if r['family'] == 'fridge')} · 세탁 쌓기 {sum(1 for r in rows if r['family'] == 'laundry')}) · "
        f"검증 {sum(1 for r in rows if r['verified'])} · 미검증 {sum(1 for r in rows if not r['verified'])}",
        "-- 순서: 0073_appliance_laundry_combos.sql 적용 → import-laundry.sql → 이 파일. 모델은 같은 브랜드의 모델 코드로 찾는다.",
        "-- 결과의 missing = DB 에 없는 모델 코드 (냉장고는 10-19 수집 뒤 나온 모델일 수 있다). 여러 번 실행해도 된다 (같은 브랜드 · 이름이면 고친다).",
        "",
    ]
    for i in range(0, len(rows), 40):
        chunk = json.dumps(rows[i:i + 40], ensure_ascii=False)
        assert "$combo$" not in chunk
        lines.append(f"SELECT import_appliance_combos($combo${chunk}$combo$::jsonb);")
    lines.append("")
    lines.append("SELECT c.brand, c.family, c.kind, c.name, c.gap_mm, c.max_units, c.kit_code, count(m.*) AS models,"
                 " count(m.*) FILTER (WHERE m.role = 'lower') AS lower_n, count(m.*) FILTER (WHERE m.role = 'upper') AS upper_n"
                 " FROM appliance_combos c LEFT JOIN appliance_combo_members m ON m.combo_id = c.id GROUP BY c.id ORDER BY 1, 2, 4;")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--delay", type=float, default=1.2)
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--sample", type=int, default=0)
    a = ap.parse_args()
    sys.stderr.reconfigure(encoding="utf-8")
    os.makedirs(a.out, exist_ok=True)
    cache = os.path.join(a.out, "cache")
    f = F.Fetcher(cache, a.delay, a.offline)
    rows = []
    for key in BRAND_FILES:
        m = load(f"laundry_{key}", os.path.join(HERE, "brands", key + ".py"))
        got = m.collect(f, K, a.sample or None)
        print(f"[{key}] rows={len(got)}", file=sys.stderr)
        rows += got
    merged = K.flag_permuted(merge(rows))
    base = os.path.join(a.out, "laundry")
    K.write(merged, base)
    ok, skipped = T.build(merged)
    with open(os.path.join(a.out, "import-laundry.sql"), "w", encoding="utf-8") as fp:
        fp.write(sql_models(ok, skipped))
    # 묶음은 SQL 에 들어가는 행만으로 (치수 · 코드가 없는 행은 DB 에 없다)
    in_sql = {(r["brand"], r["model_code"]) for r in ok}
    usable = [r for r in merged if (KO.get(r["brand"], r["brand"]), (r["model_codes"] or [None])[0]) in in_sql]
    combos, log = [], []
    for fn in (lambda: samsung_stacks(f, usable), lambda: lg_stacks(usable), lambda: winia_stacks(f, usable),
               lambda: samsung_sides(f), lambda: lg_sides(f)):
        c, lg = fn()
        combos += c
        log += lg
    names = set()
    for c in combos:
        assert (c["brand"], c["name"].lower()) not in names, c["name"]
        names.add((c["brand"], c["name"].lower()))
    with open(os.path.join(a.out, "combos.json"), "w", encoding="utf-8") as fp:
        json.dump({"collected_at": F.now_iso(), "combos": combos, "not_made": log}, fp, ensure_ascii=False, indent=1)
    with open(os.path.join(a.out, "import-combos.sql"), "w", encoding="utf-8") as fp:
        fp.write(sql_combos(combos))
    with open(os.path.join(a.out, "robots.txt.log"), "w", encoding="utf-8") as fp:
        fp.write(robots_log(f, cache))
    print(f"variants={len(rows)} merged={len(merged)} sql_rows={len(ok)} skipped={len(skipped)} combos={len(combos)} "
          f"net={f.net_count} cache_hits={f.cache_hits}", file=sys.stderr)
    for l in log:
        print("  [not made] " + l, file=sys.stderr)


if __name__ == "__main__":
    main()
