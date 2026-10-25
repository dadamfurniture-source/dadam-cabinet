"""위니아 주방가전 — winia.com 제품 목록(list_ajax) → 상세 '제품사양' 표. (2026-10-25)

전자레인지 · 복합오븐(전자레인지 겸용) · 인덕션/하이브리드 전기레인지 · 식기세척기 · 딤채쿡 밥솥.
냉장고 수집기(../fridge-catalog/collect.py)의 위니아 도움 함수(wn_spec · wn_image)를 K.F 로 그대로 쓴다.

사양표 칸 이름에 순서가 적혀 있다 ('제품 사이즈(WxHxD)mm' · '사이즈(W x D x H)mm'). 그런데 2023년 전자레인지 4종과
밥솥은 이름(WxHxD)과 값의 순서가 어긋난다 (BKRL240BGBWM(A) '469 x 377 x 280' — 사용설명서 '469(폭)×377(깊이)×280(높이)').
사용설명서(위니아에이드 winiaaid.com — winia.com 상세 페이지가 거는 공식 설명서 내려받기) PDF 글자에서 읽은 값을
아래 WN_MANUAL 에 옮겨 두었다. PDF 는 Fetcher 로 받을 수 없어(이진 파일) 사람이 따로 받아 읽었다 — 출처 주소 · 쪽을 남긴다.
"""
import json
import re
import sys

BRAND_KEY = "winia"
K = None   # collect.py 가 넘긴다

WN = "https://www.winia.com"
WN_HDR = {"Origin": WN, "Referer": WN + "/product/list"}
WAID = "https://www.winiaaid.com/file/download?fileId={}&fileSeq={}"

# (TYPE, GNB_SEQ, 메뉴) — winia.com 메인 메뉴 '주방가전' · '밥솥' 의 목록 값
WN_MENUS = [
    ("4", "2080", "전자레인지"),
    ("4", "2079", "오븐"),        # 위니아 '오븐' 메뉴 6종은 모두 가열방식에 전자레인지가 있다 → microwave combi
    ("5", "2081", "인덕션"),
    ("5", "2082", "하이브리드"),
    ("6", "2083", "식기세척기"),
    ("3", "2072", "당질저감 밥솥"),
]


def _m(fid, seq):
    return WAID.format(fid, seq)


# 사용설명서에서 읽은 값 — 모델 코드 → 고칠 것.
#   dims: (W, D, H) mm · tags: 붙일 태그 · note: 비고(product_type_raw 에 덧붙인다)
#   cutout: (W, D) 상판 타공 · back_gap: 뒤 벽 여유 (쿡탑 설치 그림 — 그림 글자라 '이미지판독')
_KRL20 = dict(dims=(440, 335, 259), raw="440(폭)×335(깊이)×259(높이) mm", page=3,
              note="상품 페이지 'WxHxD 440 x 335 x 259' 는 칸 이름과 순서가 다르다 — 사용설명서 3쪽 순서로 넣음")
_CD06 = dict(dims=(262, 392, 269), raw="제품크기 길이 392mm · 폭 262mm · 높이 269mm", page=5,
             note="상품 페이지 '사이즈(WxHxD) 262 x 396 x 267' 은 높이 칸이 396 이라 맞지 않다 — 사용설명서 5쪽 표 값")
_CD10 = dict(dims=(310, 388, 302), raw="제품크기 길이 310mm · 폭 388mm · 높이 302mm", page=5, tags=["치수순서추정"],
             note="높이 302 는 사용설명서 5쪽 표. 가로 · 깊이는 상품 페이지 'W 310' 과 설명서 '폭 388' 이 어긋나 밥솥 모양(깊이 > 가로)으로 추정")
_COOK = dict(cutout=(560, 480), back_gap=40, page=9, tags=["이미지판독"],
             cutout_raw="사용설명서 9쪽 설치 그림: 상판 타공 560 mm × 480 mm, 매립 깊이 85 mm",
             install_notes="사용설명서 9쪽: 뒷부분은 벽면에서 최소 40 mm 이상 떨어뜨려 절단 (그림 판독)")
WN_MANUAL = {
    "BKRL240BGBWM(A)": dict(dims=(469, 377, 280), raw="469(폭)×377(깊이)×280(높이) mm", page=3, pdf=_m("F000001043434", "1043435"),
                            note="상품 페이지 'WxHxD 469 x 377 x 280' 은 칸 이름과 순서가 다르다 — 사용설명서 3쪽 순서로 넣음"),
    "EKRL201DGBWM(A)": dict(_KRL20, pdf=_m("F000001043432", "1043433")),
    "BKRL201AGWWM(A)": dict(_KRL20, pdf=_m("F000001043430", "1043431")),
    "EKRM200CGBWM(A)": dict(dims=(440, 359, 259), raw="440(폭)×358.5(깊이)×259(높이) mm", page=3, pdf=_m("F000001043419", "1043420"),
                            note="상품 페이지 'WxHxD 440 x 359 x 259' 는 칸 이름과 순서가 다르다 — 사용설명서 3쪽 순서로 넣음"),
    "WCDD06ASFL": dict(_CD06, pdf=_m("F000000399807", "399808")),
    "WCDD06ADUL": dict(_CD06, pdf=_m("F000000399771", "399772")),
    "WCDD06ADCL": dict(_CD06, pdf=_m("F000000399773", "399774")),
    "ECDD06ASFL": dict(_CD06, pdf=_m("F000000399787", "399788")),
    "ECDD06ADUL": dict(_CD06, pdf=_m("F000000399792", "399793")),
    "ECDD06ADCL": dict(_CD06, pdf=_m("F000000399781", "399782")),
    "WCDD10BRAT": dict(_CD10, pdf=_m("F000000399809", "399810")),
    "WCDD10BRPT": dict(_CD10, pdf=_m("F000000399756", "399759")),
    "WCDD10BRTT": dict(_CD10, pdf=_m("F000000399762", "399763")),
    # 상품 페이지 '크기(WxHxD) 412 x 378 x 422' · 설명서 17쪽 '412(폭)×378(깊이)×422(높이)' — 높이 · 깊이가 서로 다르다. 어느 쪽인지 모른다
    "EWW03YEW": dict(page=17, pdf=_m("F000000747823", "747824"), tags=["치수순서의심"],
                     note="사용설명서 17쪽은 412(폭)×378(깊이)×422(높이) — 상품 페이지(높이 378 · 깊이 422)와 높이 · 깊이가 반대"),
    "EEI33ASDSBS01": dict(_COOK, pdf=_m("F000000525379", "525381")),
    "WEI33ASDFBS01": dict(_COOK, pdf=_m("F000000557092", "557093")),
    "EER32ASDSBS01": dict(_COOK, pdf=_m("F000000525376", "525377")),
    "WER32ASDFBS01": dict(_COOK, pdf=_m("F000000557090", "557091")),
    # 상품 페이지 값을 그대로 두되 설명서 값이 다른 곳 — 비고에만 남긴다 (몇 mm 차이, 어느 쪽이 맞는지 모른다)
    "NKRM231EWW": dict(page=2, pdf=_m("F000000668152", "668153"), note="사용설명서 2쪽은 465(폭) x 381(깊이) x 280(높이) — 깊이 381 (상품 페이지 363)"),
    "MWD23ET": dict(page=22, pdf=_m("F000000907170", "907171"), note="사용설명서 22쪽은 (높이x폭x깊이) 280 X 465 X 358 — 깊이 358 (상품 페이지 362)"),
    "WKRL260EBW": dict(page=31, pdf=_m("F000000668177", "668178"), note="사용설명서 31쪽은 465(폭)×368(깊이)×280(높이) — 깊이 368 (상품 페이지 362)"),
    "GKRL262DSW": dict(page=24, pdf=_m("F000000389281", "389298"), note="사용설명서 24쪽은 (높이x폭x깊이) 280 × 465 × 375 — 깊이 375 (상품 페이지 370)"),
    "EKRL150EGW": dict(page=27, pdf=_m("F000000667729", "667730"), note="사용설명서 27쪽은 424(폭)x316(깊이)x229(높이) — 깊이 316 (상품 페이지 320)"),
    "EKRL150EWW": dict(page=27, pdf=_m("F000000667732", "667733"), note="사용설명서 27쪽은 424(폭)x316(깊이)x229(높이) — 깊이 316 (상품 페이지 320)"),
    "WKRM152DWK": dict(page=16, pdf=_m("F000001592517", "1592518"), note="사용설명서 16쪽은 424(폭)×224(높이)×333(깊이) — 높이 224 (상품 페이지 229)"),
    "EKRL263DWW": dict(page=2, pdf=_m("F000000421921", "421923"), note="사용설명서 2쪽은 465(폭)×365(깊이)×280(높이) — 깊이 365 (상품 페이지 370)"),
    "EKCL281DTW": dict(page=54, pdf=_m("F000000389299", "389300"), note="사용설명서 54쪽은 513(폭) X 311(높이) X 383(깊이) — 깊이 383 (상품 페이지 382)"),
}


def wn_list(f, type_, gnb):
    out, page, total = [], 0, None
    while True:
        st, body = f.post_form(f"{WN}/product/list_ajax", {"pageNo": page, "pageSize": 400, "TYPE": type_, "GNB_SEQ": gnb,
                                                           "PRODUCT_SEQS": "", "PRODUCT_SEQ": ""}, WN_HDR)
        ro = (json.loads(body) or {}).get("resultObject") or {}
        total = ro.get("totCnt") or 0
        ml = ro.get("list") or []
        out.extend(ml)
        if not ml or len(out) >= total or (ro.get("pageInfo") or {}).get("lastPage", True):
            break
        page += 1
    return total, out


def classify(menu, title, spec):
    """→ (category, subtype, install_type)"""
    heat = spec.get("가열방식") or ""
    if menu in ("전자레인지", "오븐"):
        combi = any(x in heat for x in ("오븐", "컨벡션", "그릴")) or menu == "오븐"
        if menu == "오븐" and "전자레인지" not in heat and not spec.get("고주파 출력(W)"):
            return "oven", "oven", "freestanding"   # (지금 목록엔 없다) 전자레인지 기능이 없는 전기오븐
        return "microwave", ("combi" if combi else "solo"), "freestanding"
    if menu in ("인덕션", "하이브리드"):
        standing = "스탠딩" in title
        return "cooktop", ("hybrid" if menu == "하이브리드" else "induction"), ("freestanding" if standing else "built_in")
    if menu == "식기세척기":
        return "dishwasher", "countertop", "freestanding"   # 6인용 '설치형'(수도 연결) · 3인용 '무설치형' 모두 싱크대 위에 올리는 크기
    if menu == "당질저감 밥솥":
        return "rice_cooker", K.rice_subtype(title + " " + (spec.get("구분") or "")), "freestanding"
    return None, None, None


def line_of(title):
    for w in ("클라쎄", "딤채쿡"):
        if title.startswith(w):
            return w
    return "위니아"


def size_of(spec):
    """외형 크기 칸 — 조리실 · 내부 · 포장 칸은 뺀다."""
    for k, v in spec.items():
        if any(x in k for x in ("조리실", "내부", "포장")):
            continue
        if "사이즈" in k or "크기" in k:
            return k, v
    return None, None


def make_row(p, menu, code, page, h, spec, title):
    cat, sub, inst = classify(menu, title, spec)
    row = K.base_row(brand="위니아", category=cat, category_subtype=sub, install_type=inst, model_name=title,
                     model_codes=[code], line=line_of(title), source_url=page, page_url=page,
                     image_source_url=K.F.wn_image(h, p), sale_status=p.get("STATUS"),
                     product_type_raw=" / ".join(x for x in [menu, spec.get("구분"), spec.get("가열방식"),
                                                            f"{p['YEAR']}년형" if p.get("YEAR") else None] if x))
    sk, sv = size_of(spec)
    d, _ = K.dims_of(sk, sv, "whd") if sv else (None, None)
    raw = f"{sk}: {sv}" if sv else None
    man = WN_MANUAL.get(code)
    if man:
        row["tags"] += [t for t in man.get("tags", []) if t not in row["tags"]]
        row["product_type_raw"] = " · ".join(x for x in [row["product_type_raw"], man.get("note")] if x)
        if man.get("dims"):
            w, dd, hh = man["dims"]
            d = {"w": (w, w), "d": (dd, dd), "h": (hh, hh)}
            raw = f"사용설명서 {man['page']}쪽 {man['raw']} (상품 페이지 {sv})"
            if "치수순서추정" not in row["tags"]:
                row["tags"].append("매뉴얼")
            row["source_url"] = man["pdf"]
        if man.get("cutout") and inst == "built_in":
            row["cutout_w_mm"], row["cutout_d_mm"] = man["cutout"]
            row["cutout_raw"] = man["cutout_raw"]
            row["back_gap_mm"] = man.get("back_gap")
            row["install_notes"] = man.get("install_notes")
            row["source_url"] = man["pdf"]
    elif cat == "rice_cooker" and d and d["h"][0] > d["d"][0]:
        # 밥솥 사양표 '사이즈(WxHxD)' 가 실제로는 가로 × 깊이 × 높이다 (279 x 416 x 270 — 높이 416 은 맞지 않다).
        #   설명서 글자가 없는 모델(WCDG06 · WCDE06 — 설명서가 그림뿐)은 가로 × 깊이 × 높이로 읽고 미검증
        d = {"w": d["w"], "d": d["h"], "h": d["d"]}
        row["tags"].append("치수순서추정")
        row["product_type_raw"] += " · 사양표 '사이즈(WxHxD)' 의 둘째 값(416)이 높이로 맞지 않아 가로 × 깊이 × 높이로 읽음"
    K.put_dims(row, d, raw)
    if cat == "microwave":
        row["capacity_l"] = K.F.first_num(spec.get("용량(L)")) or K.litres(title)
    if cat in ("dishwasher", "rice_cooker"):
        row["place_count"] = K.place_count(spec.get("용량") or title)
    return row


def collect(f, K_, sample=None):
    global K
    K = K_
    items, seen = [], set()
    for type_, gnb, menu in WN_MENUS:
        total, ml = wn_list(f, type_, gnb)
        print(f"[winia] {menu}: totCnt={total} listed={len(ml)}", file=sys.stderr)
        if sample:
            ml = ml[:sample]
        for p in ml:
            if p["PRODUCT_SEQ"] in seen:
                continue
            seen.add(p["PRODUCT_SEQ"])
            items.append((menu, p))
    rows, done = [], set()
    queue = list(items)
    while queue:
        menu, p = queue.pop(0)
        code = (p.get("PRODUCT_MODEL_NAME") or "").strip()
        if code and code in done:
            continue
        page = f"{WN}/product/view?PRODUCT_SEQ={p['PRODUCT_SEQ']}"
        st, h = f.get(page)
        spec = K.F.wn_spec(h) if st == 200 else {}
        if not spec:
            print(f"  [winia] 사양표 없음 {code or '?'} {page} (status {st})", file=sys.stderr)
            continue
        m = re.search(r'<p class="title">([^<]+)</p>\s*<p class="code">\s*<span>([^<]+)', h)
        title = re.sub(r"\s+", " ", K.F.html.unescape(m.group(1) if m else (p.get("PRODUCT_TITLE") or ""))).strip()
        page_code = K.F.html.unescape(m.group(2)).strip() if m else code
        if not code:
            code = page_code
            if not code or code in done:
                continue
        done.add(code)
        if not sample:   # 상세의 색상 칩 중 목록에 없는 상품도 따라간다 (같은 메뉴로 본다)
            for s in re.findall(r"fnMoveDetail\((\d+)\)", h):
                if int(s) not in seen:
                    seen.add(int(s))
                    queue.append((menu, dict(p, PRODUCT_SEQ=int(s), PRODUCT_MODEL_NAME=None, PRODUCT_TITLE=None)))
                    print(f"  [winia] 색상 칩 {s} (from {code}) — 목록에 없어 따라감", file=sys.stderr)
        rows.append(make_row(p, menu, code, page, h, spec, title))
    return rows
