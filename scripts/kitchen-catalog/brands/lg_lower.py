"""LG — 하부장 안에 들어가는 가전 (2026-11-03 사장님 "모델까지 수집해 카탈로그에 넣음").

  로봇청소기 스테이션 (robot_vacuum) — 목록 plp CT50000111 (청소기) 의 로봇청소기 중
    · 홈봇 AI 오브제컬렉션 로니 '히든스테이션' (N95TWU · N95THU) → toe_kick — 싱크대 하단 걸레받이 공간 전용 (프리스탠딩 불가)
    · 코드제로 AI 로보킹 올인원 '(자동 급배수)' (B95AWBTH) → built_in — LG 설치가이드의 '자동 급배수 빌트인 스타일 설치'
      (하부장 안). 같은 모델을 일반(프리스탠딩)으로도 놓는다 — product_type_raw 에 적는다
    · 오브제스테이션 · 프리스탠딩 · 일반 스테이션 모델은 모으지 않는다
    치수  pdp spec 의 '크기 & 무게 (타워/스테이션)' · '(올인원타워)' 묶음 '크기 (WxHxD, mm)' — 같은 이름 칸이 '본체'(로봇) 묶음에도
          있어 lg_flat 을 쓰지 않고 묶음 제목으로 고른다
    설치  /story/user-guide/robot-vacuum-cleaners-install-guide '빌트인 설치환경 [단위 : mm]' (싱크대 폭 · 깊이 · 걸레받이 높이)
  언더싱크 정수기 (water_purifier) — plp CT50000175 (정수기) 중 사양 '제품 유형' 이 '언더싱크형' 인 것
    치수  '제품 크기 (WxHxD, mm)' = 싱크대 아래 본체. 파우셋 '(ØXHXD, mm)' 는 원문만 비고로
    설치  /story/user-guide/lg-water-purifiers-install-guide '빌트인 정수기' — 출수구 타공 지름 · 하부장 안 본체 여유(벽 · 옆)
  와인셀러 (wine_cellar) — SIGNATURE Kitchen Suite 아일랜드 와인셀러 (브랜드관 lge.co.kr/kr/business/sks, 냉장고 수집기
    sks_collect 그대로 읽고 높이 950 이하 와인만). lge.co.kr 일반 와인셀러 메뉴(CT50115000) 8모델은 사양 · 페이지 글에
    '빌트인' · '언더카운터' 표시가 없어 모으지 않는다 (brands/lg_lower.md)
  음식물처리기 — LG 는 팔지 않는다 (lge.co.kr 카테고리에 없음)

robots.txt (2026-11-03 직접 읽음): www.lge.co.kr — /shop/ · /add-to-cart/ · /my-page* · /mkt/ajax/ · /search · /sch ·
/category/ricecooker · /category/small-kitchen-appliances 금지, 그 밖 허용 (상품 · /story/ · /kr/business/sks 허용).
apiv2.lge.co.kr — robots.txt 없음 (404 → 허용).
"""
import re
import sys

BRAND_KEY = "lg_lower"
K = None

ROBOT_CAT = "CT50000111"        # 청소기 (하위: 로봇청소기 CT50000119)
PURIFIER_CAT = "CT50000175"     # 정수기
ROBOT_GUIDE = "/story/user-guide/robot-vacuum-cleaners-install-guide"
PURIFIER_GUIDE = "/story/user-guide/lg-water-purifiers-install-guide"
BUILTIN_PURIFIER = re.compile(r"^WU[589]\d3")   # 설치비 표 '빌트인 정수기(WU9*3**/8*3**/5*3**)' — 가이드 값을 쓰는 코드


def _norm(s):
    return re.sub(r"\s+", " ", re.sub(r"<br\s*/?>", " ", s or "")).strip()


def _variants(m):
    vids = [m["modelId"]]
    for og in m.get("optionGroupList") or []:
        for o in og.get("optionList") or []:
            if o.get("modelId") and o["modelId"] not in vids:
                vids.append(o["modelId"])
    return vids


def _group_size(spec, want):
    """techSpecs 묶음 제목에 want 중 하나가 든 묶음의 '크기 (WxHxD, mm)' → (칸 이름, 값)."""
    for g in spec.get("techSpecs") or []:
        title = g.get("title") or ""
        if any(w in title for w in want):
            for s in g.get("spec") or []:
                if (s.get("name") or "").startswith("크기"):
                    return s["name"], (s.get("value") or "").strip()
    return None, None


def _guide_text(f, path):
    st, h = f.get(K.F.LG_WWW + path)
    return _norm(K.F.html_to_text(h)) if st == 200 else ""


# --------------------------------------------------------------------------- 로봇청소기


def robot_guides(f):
    """설치가이드 → {'roni': (칸, raw), 'roboking': (칸, raw)}. 글이 바뀌어 못 읽으면 빈 칸."""
    t = _guide_text(f, ROBOT_GUIDE)
    out = {"roni": ({}, None), "roboking": ({}, None)}
    a = t.find("RONi(로니) 히든 스테이션 설치 공간을 확인해 주세요")
    b = t.find("LG 코드제로 AI 로보킹 올인원 자동 급배수 빌트인 스타일 설치")
    if a >= 0:
        seg = t[a:a + 1500]
        m = re.search(r"빌트인 설치환경 \[단위 : mm\] (.+?)(?= 규격장 \(가로폭)", seg)
        raw = m.group(1) if m else None
        cells = {}
        w = re.search(r"싱크대 폭 (\d+) 이상 설치 가능\(필수\)", seg)
        d = re.search(r"싱크대 깊이 (\d+) 이상 설치 가능\(필수\)", seg)
        h = re.search(r"(\d+) 이상 - (\d+) 미만 설치 가능\(필수\)", seg)
        if w:
            cells["niche_min_w_mm"] = int(w.group(1))
        if d:
            cells["niche_min_d_mm"] = int(d.group(1))
        if h:   # 걸레받이 공간 높이 150 이상 - 180 미만 = 기본 시공. 180 이상 · 150 미만은 추가 시공 조건부 — 최대는 비운다
            cells["niche_min_h_mm"] = int(h.group(1))
        out["roni"] = (cells, ("RONi 히든스테이션 빌트인 설치환경 [mm]: " + raw) if raw else None)
    if b >= 0:
        seg = t[b:b + 1500]
        m = re.search(r"빌트인 설치환경 \[단위 : mm\] (.+?)(?= 규격장 시공 상세)", seg)
        raw = m.group(1) if m else None
        cells = {}
        w = re.search(r"싱크대 폭\(외부 판 제외\) (\d+)-(\d+) 설치 가능\(권장\)", seg)
        d = re.search(r"싱크대 깊이 (\d+) 이상 설치 가능\(권장\)", seg)
        if w:
            cells["niche_min_w_mm"] = int(w.group(1))
        if d:
            cells["niche_min_d_mm"] = int(d.group(1))
        out["roboking"] = (cells, ("로보킹 올인원 자동 급배수 빌트인 설치환경 [mm]: " + raw) if raw else None)
    return out


def robots(f, sample=None):
    total, ml = K.F.lg_list(f, ROBOT_CAT)
    picks = []
    for m in ml:
        name = _norm(m.get("modelDisplayName"))
        if "로봇" not in (m.get("subCategoryName") or ""):
            continue
        if "히든스테이션" in name:
            picks.append((m, "toe_kick", "roni"))
        elif "(자동 급배수)" in name:
            picks.append((m, "built_in", "roboking"))
    print(f"[lg_lower] robot_vacuum: listed={total} picks={[p[0].get('modelName') for p in picks]}", file=sys.stderr)
    if sample:
        picks = picks[:sample]
    guides = robot_guides(f)
    rows, done = [], set()
    for m, sub, gkey in picks:
        name = _norm(m.get("modelDisplayName"))
        for vid in _variants(m):
            if vid in done:
                continue
            done.add(vid)
            spec = K.F.lg_spec(f, vid)
            if not spec:
                continue
            fl = K.F.lg_flat(spec)
            if fl.get("자동 급배수") != "O":
                continue
            code = spec.get("modelName") or spec.get("salesModelCode")
            kind = ("걸레받이 히든스테이션 (싱크대 하단 걸레받이 공간 빌트인 전용)" if sub == "toe_kick"
                    else "올인원타워 자동 급배수 — 빌트인 스타일(하부장 안) · 일반 설치 둘 다")
            row = K.base_row(brand="LG", category="robot_vacuum", category_subtype=sub, install_type="built_in",
                             model_name=name, model_codes=[code], line=K.F.lg_line(name),
                             source_url=f"{K.F.LG_API}/pdpsvc/ajax/v1/models/{vid}/spec",
                             page_url=K.F.LG_WWW + (m.get("modelUrlPath") or ""),
                             image_source_url=K.F.abs_image_url(m.get("largeImageAddr") or m.get("mediumImageAddr"), K.F.LG_WWW),
                             sale_status=m.get("modelStatusCode"),
                             product_type_raw=f"{m.get('subCategoryName')} / {kind} / 색상 {fl.get('색상 (올인원타워)') or ''}".strip())
            sk, sv = _group_size(spec, ("타워", "스테이션"))
            d, _ = K.dims_of(sk, sv, "whd")
            K.put_dims(row, d, sv)
            cells, raw = guides[gkey]
            row.update(cells)
            if raw:
                row["niche_raw"] = raw
            rows.append(row)
    return rows


# --------------------------------------------------------------------------- 언더싱크 정수기


def purifier_guide(f):
    """빌트인 정수기 설치가이드 → (칸, install_notes, cutout_raw)."""
    t = _guide_text(f, PURIFIER_GUIDE)
    a = t.find("빌트인 정수기 내용 시작")
    seg = t[a:a + 3000] if a >= 0 else ""
    cells, notes, cut = {}, [], None
    hole = re.search(r"설치 가능 지름 (\d+)mm 타공 가능 및 싱크볼 상판 데코링 (\d+)mm 고정 가능", seg)
    if hole:
        cells["faucet_hole_mm"] = int(hole.group(1))
        cut = hole.group(0) + " (LG 빌트인 정수기 설치가이드 — 상판에 설치할 때도 같은 타공)"
    gap = re.search(r"벽 쪽으로 (\d+)mm, 옆 쪽으로 (\d+)mm 여유 공간이 필요합니다", seg)
    if gap:
        cells["back_gap_mm"], cells["side_gap_mm"] = int(gap.group(1)), int(gap.group(2))
        notes.append(gap.group(0))
    for pat in [r"싱크볼 하판 파우셋 고정을 위해, 가로 \d+mm, 세로 \d+mm 여유공간 확보 가능",
                r"출수구와 본체 간의 거리는 최대 \d+mm 까지 설치 가능합니다\. \([^)]*\)", r"원수로부터 \d+m 이내 주방 공간에 설치 가능합니다"]:
        x = re.search(pat, seg)
        if x:
            notes.append(x.group(0))
    note = " · ".join(notes) + " (LG 빌트인 정수기 설치가이드 · WU923AS 기준)" if notes else None
    return cells, note, cut


def purifier_subtype(direct):
    t = direct or ""
    cold, hot = "냉수" in t, "온수" in t
    return "hot_cold" if cold and hot else "cold" if cold else "hot" if hot else "purify"


def purifiers(f, sample=None):
    total, ml = K.F.lg_list(f, PURIFIER_CAT)
    print(f"[lg_lower] water_purifier: listed={total}", file=sys.stderr)
    if sample:
        ml = [m for m in ml if (m.get("modelName") or "").startswith("WU")][:sample]
    cells, note, cut = purifier_guide(f)
    rows, done = [], set()
    for m in ml:
        name = _norm(m.get("modelDisplayName"))
        for vid in _variants(m):
            if vid in done:
                continue
            done.add(vid)
            spec = K.F.lg_spec(f, vid)
            if not spec:
                continue
            fl = K.F.lg_flat(spec)
            if "언더싱크" not in (fl.get("제품 유형") or ""):
                continue
            code = spec.get("modelName") or spec.get("salesModelCode")
            # 라인 = 오브제컬렉션 · 일반 + 이름 괄호의 형태(빌트인 · 듀얼) — 크기가 같아도 다른 제품끼리 한 행으로 묶이지 않게
            series = re.search(r"\(([^,)]+)", name)
            line = K.F.lg_line(name) + (f" {series.group(1).strip()}" if series else "")
            row = K.base_row(brand="LG", category="water_purifier", category_subtype=purifier_subtype(fl.get("직수방식")),
                             install_type="built_in", model_name=name, model_codes=[code], line=line,
                             source_url=f"{K.F.LG_API}/pdpsvc/ajax/v1/models/{vid}/spec",
                             page_url=K.F.LG_WWW + (m.get("modelUrlPath") or ""),
                             image_source_url=K.F.abs_image_url(m.get("largeImageAddr") or m.get("mediumImageAddr"), K.F.LG_WWW),
                             sale_status=m.get("modelStatusCode"),
                             product_type_raw=" / ".join(x for x in [fl.get("제품분류"), fl.get("제품 유형"), fl.get("직수방식")] if x))
            sk = next((k for k in fl if k.startswith("제품 크기")), None)
            d, _ = K.dims_of(sk, fl.get(sk), "whd") if sk else (None, None)
            K.put_dims(row, d, fl.get(sk) if sk else None)
            if BUILTIN_PURIFIER.match(code or ""):
                row.update(cells)
                if cut and cells.get("faucet_hole_mm"):
                    row["cutout_raw"] = cut
                parts = [note] if note else []
            else:
                parts = []
            fk = next((k for k in fl if k.startswith("파우셋 크기")), None)
            if fk:
                parts.append(f"{fk} {fl[fk]}")
            if parts:
                row["install_notes"] = " · ".join(parts)
            rows.append(row)
    return rows


# --------------------------------------------------------------------------- SKS 와인셀러


def sks_wine(f, sample=None):
    """냉장고 수집기 sks_collect (브랜드관 냉장 계열 페이지) 중 와인 · 높이 950 이하 → wine_cellar under_counter.
    키큰 컬럼 와인셀러(2121)는 이미 DB 냉장고 wine 이라 모으지 않는다."""
    got = K.F.sks_collect(f)
    rows = []
    for r in got:
        if r.get("category_subtype") != "wine" or not r.get("height_mm") or r["height_mm"] > 950:
            continue
        row = K.base_row(brand="LG", category="wine_cellar", category_subtype="under_counter", install_type="built_in",
                         model_name=r.get("model_name"), model_codes=list(r.get("model_codes") or []),
                         line="SIGNATURE Kitchen Suite", source_url=r.get("source_url"), page_url=r.get("page_url"),
                         image_source_url=r.get("image_source_url"),
                         product_type_raw=r.get("product_type_raw"))
        row["tags"].append("SKS")
        d, _ = K.dims_of("(WxHxD)", r.get("size_raw"), "whd")   # 브랜드관 '제품 치수 (WxHxD, mm)'
        K.put_dims(row, d, r.get("size_raw"))
        for k in K.NICHE_KEYS:
            if r.get(k) is not None:
                row[k] = r[k]
        row["niche_raw"] = r.get("niche_raw")
        row["install_notes"] = r.get("install_notes")
        rows.append(row)
    print(f"[lg_lower] wine_cellar (SKS): sks rows={len(got)} under_counter={len(rows)}", file=sys.stderr)
    return rows[:sample] if sample else rows


def collect(f, K_, sample=None):
    global K
    K = K_
    return robots(f, sample) + purifiers(f, sample) + sks_wine(f, sample)
