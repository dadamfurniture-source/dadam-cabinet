"""밀레 (Miele) — miele.co.kr (밀레코리아 공식 온라인 스토어) 상품 페이지의 '사양' 표. 2026-10-25.

목록: 주방 카테고리 페이지 (12개씩 ?page=N) + /e/sitemap.xml 의 /product/ 주소 중 주방 제품.
치수: 상품 페이지 SSR HTML 의 사양 표 (<span id="…-label-N">이름</span> … <dd class="table__value">값</dd>).
  외형   '치수(mm)(너비/높이/깊이)' · '기기 너비/높이/깊이(mm)' 낱칸 우선, 없으면 '기기 치수(W x H x D)(mm)' · '치수(H x W x D)(mm)'
  니치   '최소/최대 설치 너비(mm)' · '최소/최대 설치 높이(mm)' · '설치 깊이(mm)' (원문 '설치 공간 치수(W x H x D)(mm)' = '560-568 x 590-595 x 550')
  타공   '일반 매립 설치 따내기 치수(너비/깊이)(mm)' · '노출형 설치를 위한 컷아웃 치수(W x D)(mm)' (완전매립 값은 cutout_raw 에만)
2026-10-20 냉장고 수집 때는 miele.co.kr 이 스크립트에 403 이었다. 오늘은 200 — 403 이 나오면 멈춘다 (우회하지 않는다).
"""
import html
import re
import sys

BRAND_KEY = "miele"
K = None   # collect.py 가 넘긴다

MC = "https://www.miele.co.kr"
# 주방 카테고리 (홈 메뉴 · 사이트맵의 /category/ 주소). 앞의 것이 먼저 — 한 제품이 여러 카테고리에 걸리면 첫 것으로 분류한다
CATS = [
    ("1013135/ovens", "ovens"),
    ("1013126/microwave-combination-ovens", "microwave-combination-ovens"),
    ("1013130/microwave-ovens", "microwave-ovens"),
    ("1013127/steam-ovens", "steam-ovens"),
    ("1013128/combination-steam-ovens", "combination-steam-ovens"),
    ("1022125/ovens-and-built-in-cookers", "ovens-and-built-in-cookers"),
    ("1022126/steam-ovens-and-combination-steam-ovens", "steam-ovens-and-combination-steam-ovens"),
    ("1013780/induction-hobs-with-vapour-extraction", "induction-hobs-with-vapour-extraction"),
    ("1013779/induction-hobs", "induction-hobs"),
    ("1013781/electric-hobs", "electric-hobs"),
    ("1013783/smartline", "smartline"),
    ("1013778/hobs", "hobs"),
    ("1015063/dishwashers", "dishwashers"),
    ("1022133/semi-integrated-dishwashers", "semi-integrated-dishwashers"),
    ("1022134/fully-integrated-dishwashers", "fully-integrated-dishwashers"),
    ("24/freestanding-dishwashers", "freestanding-dishwashers"),
    ("93/built-under-dishwashers", "built-under-dishwashers"),
    ("1022127/warming-and-vacuum-sealing-drawers", "warming-and-vacuum-sealing-drawers"),   # 건너뛴다 — 목록에만 남긴다
]
# 상품 주소 슬러그 앞부분 = 밀레 제품군 → (종류, 세부, 설치, 한글 이름). 제조사 메뉴가 종류를 정한다.
SLUG = [
    (r"compact-ovens-with-microwave", ("oven", "combi", "built_in", "빌트인 전자레인지 콤비 오븐")),
    (r"combi-steam-ovens", ("oven", "steam_oven", "built_in", "빌트인 콤비스팀오븐")),
    (r"steam-ovens", ("oven", "steam_oven", "built_in", "빌트인 스팀오븐")),
    (r"microwave", ("microwave", "solo", "built_in", "빌트인 전자레인지")),
    (r"ovens", ("oven", "oven", "built_in", "빌트인 오븐")),
    (r"induction-hobs-with-vapour-extraction", ("cooktop", "induction", "built_in", "후드일체형 인덕션")),
    (r"induction-hobs|combiset-induction", ("cooktop", "induction", "built_in", "인덕션")),
    (r"electric-hobs|combiset-highlight|combiset-electric", ("cooktop", "highlight", "built_in", "하이라이트")),
    (r"gas-hobs|combiset-gas", ("cooktop", "gas", "built_in", "가스쿡탑")),
    (r"cooker-hoods|hoods", ("hood", None, "built_in", "후드")),
    (r"dishwashers-built-in", ("dishwasher", "built_in", "built_in", "빌트인 식기세척기")),
    (r"dishwashers-freestanding", ("dishwasher", "freestanding", "freestanding", "프리스탠딩 식기세척기")),
]
SKIP_SLUG = re.compile(r"^(warming-drawers|vacuum|gourmet|coffee|others-|accessor|heat-pump|washing|tumble|refrigerators|freezers|"
                       r"fridge|wine|mastercool|filter|special|bagged|bagless|cordless|robot|floor|sheets|insert|miele-c|mounting|pull-outs)")
ROBOTS_WILDCARD = ("compare", "checkout", "&query=", "/cart", "logout", "/account/", "/pmedia/", "csrf")   # robotparser 가 * 를 못 읽는다
# 사양 표에서 '값 없음(체크 표시)' 으로 나오는 칸의 이름 — 설치 · 종류 원문으로 남긴다
TYPE_FLAGS = ("빌트언더 식기세척기", "완전 빌트인 식기세척기", "반빌트인 식기세척기", "세미 빌트인 식기세척기", "프리스탠딩 식기세척기",
              "대형 XXL 사이즈 식기세척기", "후드 결합형 인덕션 쿡탑", "프레임없음 – 노출형", "완전매립", "일반 매립형 설치",
              "스테인리스 스틸 프레임", "완전매립형 쿠커후드", "쿡탑과 별도")


def spec_table(h):
    """→ [(이름, 값)] 표 순서 그대로 (같은 이름이 두 번 나오기도 한다 — 화구 수 · 유형)."""
    out = []
    for m in re.finditer(r'<span id="[^"]*-label-\d+"[^>]*>(.*?)</span>.*?<dd class="table__value"[^>]*>(.*?)</dd>', h, re.S):
        k = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", m.group(1)))).strip()   # 이름에 &nbsp; 가 섞여 있다
        v = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", m.group(2)))).strip()
        if v == "로딩 중...":   # 체크 아이콘 칸 (값이 그림)
            v = ""
        out.append((k, v))
    return out


def first(spec, *names):
    for n in names:
        for k, v in spec:
            if k == n and v:
                return v
    return None


def num(v):
    m = re.search(r"\d+(?:[.,]\d+)?", v or "")
    return float(m.group(0).replace(",", ".")) if m else None


def mm(v):
    x = num(v)
    return int(round(x)) if x is not None else None


def discover(f):
    """→ [(path, [카테고리 키 …])] — 카테고리 페이지(쪽마다 12개) + 사이트맵. 주방 제품만."""
    found = {}
    for cat, key in CATS:
        page, got = 1, []
        while True:
            u = f"{MC}/category/{cat}" + (f"?page={page}" if page > 1 else "")
            st, h = f.get(u)
            if st == 403:
                raise PermissionError(f"miele.co.kr 403 — 우회하지 않고 멈춘다: {u}")
            links = list(dict.fromkeys(re.findall(r'href="(/product/\d+/[^"?#]+)"', h))) if st == 200 else []
            new = [x for x in links if x not in got]
            got += new
            if not new or f'?page={page + 1}"' not in h:
                break
            page += 1
        print(f"[miele] category {key}: {len(got)} (pages {page})", file=sys.stderr)
        for p in got:
            found.setdefault(p, []).append(key)
    st, x = f.get(MC + "/e/sitemap.xml")
    sm = [u.replace(MC, "") for u in re.findall(r"<loc>([^<]+)</loc>", x or "") if "/product/" in u]
    extra = 0
    for p in sm:
        slug = p.split("/", 3)[3]
        if p not in found and any(re.match(rx, slug) for rx, _ in SLUG) and not SKIP_SLUG.match(slug):
            found[p] = ["sitemap"]
            extra += 1
    print(f"[miele] sitemap products={len(sm)} kitchen-only-in-sitemap={extra}", file=sys.stderr)
    return list(found.items())


def classify(path):
    slug = path.split("/", 3)[3]
    if SKIP_SLUG.match(slug):
        return None
    for rx, v in SLUG:
        if re.match(rx, slug):
            return v
    return None


def outer(spec):
    """외형 — 낱칸(너비 · 높이 · 깊이) 우선, 없으면 순서가 적힌 묶음 칸. → (d, raw, note)"""
    w = first(spec, "치수(mm)(너비)", "기기 너비(mm)")
    hh = first(spec, "치수(mm)(높이)", "기기 높이(mm)")
    dd = first(spec, "치수(mm)(깊이)", "기기 깊이(mm)")
    combo = next(((k, v) for k, v in spec if re.match(r"(기기 )?치수\(", k) and v), None)
    note = None
    if w and hh and dd:
        d = {"w": (mm(w), mm(w)), "h": (mm(hh), mm(hh)), "d": (mm(dd), mm(dd))}
        raw = f"너비 {w} · 높이 {hh} · 깊이 {dd} (mm)" + (f" / {combo[0]} = {combo[1]}" if combo else "")
        if combo:
            dc, _ = K.dims_of(combo[0], combo[1], "")
            if dc and any(dc[k][0] != d[k][0] for k in "whd"):
                note = f"묶음 칸 '{combo[0]} = {combo[1]}' 는 낱칸과 순서가 다르다 — 낱칸(너비 · 높이 · 깊이)을 썼다"
        return d, raw, note
    if combo:
        d, seq = K.dims_of(combo[0], combo[1], "")
        return d, f"{combo[0]} = {combo[1]}", None
    return None, None, None


def niche(spec):
    """니치 — 최소/최대 설치 너비 · 높이, 설치 깊이. 한 값이면 min 만 (최소 = 최대면 max 비움)."""
    out = {}
    for ax, lo_n, hi_n in (("w", "최소 설치 너비(mm)", "최대 설치 너비(mm)"), ("h", "최소 설치 높이(mm)", "최대 설치 높이(mm)"),
                           ("d", "최소 설치 깊이(mm)", "최대 설치 깊이(mm)")):
        lo, hi = mm(first(spec, lo_n)), mm(first(spec, hi_n))
        if ax == "d" and lo is None:
            lo = mm(first(spec, "설치 깊이(mm)"))
        if lo is not None:
            out[f"niche_min_{ax}_mm"] = lo
        if hi is not None and hi != lo:
            out[f"niche_max_{ax}_mm"] = hi
    combo = first(spec, "설치 공간 치수(W x H x D)(mm)")
    if not out and combo:   # 낱칸이 없으면 묶음 칸 '560-568 x 590-595 x 550' 를 읽는다 (- = 범위)
        parts = re.split(r"\s*x\s*", combo)
        if len(parts) == 3:
            for ax, p in zip("whd", parts):
                ns = [int(n) for n in re.findall(r"\d+", p)]
                if ns:
                    out[f"niche_min_{ax}_mm"] = ns[0]
                    if len(ns) > 1 and ns[1] != ns[0]:
                        out[f"niche_max_{ax}_mm"] = ns[1]
    raw = None
    if out:   # 묶음 칸이 있으면 그것만 (낱칸과 같은 값), 없으면 낱칸들
        bits = [f"{k} = {v}" for k, v in spec if v and k.startswith(("최소 설치", "최대 설치", "설치 깊이"))]
        raw = f"설치 공간 치수(W x H x D)(mm) = {combo}" if combo else " · ".join(dict.fromkeys(bits))
    return out, raw


def cutout(spec):
    """상판 타공 — 일반 매립(노출형) 값을 칸으로, 완전매립(플러시) 값은 원문에만."""
    w = mm(first(spec, "일반 매립 설치 따내기 치수(너비)(mm)"))
    d = mm(first(spec, "일반 매립 설치 따내기 치수(깊이)(mm)"))
    surf = first(spec, "노출형 설치를 위한 컷아웃 치수(W x D)(mm)")
    if (w is None or d is None) and surf:
        p = re.findall(r"\d+", surf)
        if len(p) >= 2:
            w, d = int(p[0]), int(p[1])
    bits = [f"{k} = {v}" for k, v in spec if v and re.search(r"컷아웃|따내기", k)]
    raw = " · ".join(dict.fromkeys(bits)) or None
    note = None
    iw, iD = mm(first(spec, "완전매립 설치를 위한 내부 따내기 치수(너비)(mm)")), mm(first(spec, "완전매립 설치 내부 따내기 치수(깊이)(mm)"))
    ow, oD = mm(first(spec, "완전매립 설치 포함 외부 따내기 치수(너비)(mm)")), mm(first(spec, "완전매립 설치 포함 외부 따내기 치수(깊이)(mm)"))
    if None not in (iw, iD, ow, oD) and (ow < iw or oD < iD):
        note = f"완전매립 외부 따내기({ow}×{oD})가 내부({iw}×{iD})보다 작다 — 사이트 값이 뒤섞인 것으로 보인다 (일반 매립 값만 칸에 넣었다)"
    return w, d, raw, note


def image_of(h):
    m = re.search(r'"primaryImageOfPage":\{"@type":"ImageObject","url":"([^"]+)"', h)
    if m:
        return m.group(1)
    m = re.search(r'https://media\.miele\.com/dam/[^"\s?]+\.(?:png|jpg|webp)', h)
    return m.group(0) if m else None


def availability(h):
    m = re.search(r'"availability":"https://schema\.org/(\w+)"', h)
    return m.group(1) if m else None


def collect(f, K_, sample=None):
    global K
    K = K_
    items = discover(f)
    rows, skipped, per = [], [], {}
    for path, cats in items:
        if any(b in path for b in ROBOTS_WILDCARD):
            continue
        cl = classify(path)
        if not cl:
            skipped.append((path, cats))
            continue
        cat, sub, inst, kname = cl
        if sample and per.get(kname, 0) >= sample:
            continue
        url = MC + path
        st, h = f.get(url)
        if st == 403:
            print(f"[miele] 403 — 우회하지 않고 멈춘다: {url}", file=sys.stderr)
            break
        if st != 200:
            print(f"[miele] {st} {url} — 건너뜀", file=sys.stderr)
            continue
        per[kname] = per.get(kname, 0) + 1
        spec = spec_table(h)
        code = first(spec, "모델 식별 코드")
        matnr = first(spec, "제조사 제품 번호")
        t = re.search(r"<title>Miele - (.*?) – ([^<]*)</title>", h)
        title = html.unescape(t.group(1)).strip() if t else (code or path)
        tags = []
        flags = [k for k, v in spec if k in TYPE_FLAGS and not v]
        if cat == "cooktop" and "vapour-extraction" in path:
            tags.append("후드일체형")
        num4 = re.search(r"(?<!\d)(\d)\d{3}(?!\d)", code or "")   # 'DGC 7840X' 도 7000
        line = "Generation 7000" if num4 and num4.group(1) == "7" else "일반"
        row = K.base_row(brand="밀레", category=cat, category_subtype=sub, install_type=inst,
                         model_name=f"{kname} {title}", model_codes=[code] if code else [], line=line,
                         source_url=url, page_url=url, image_source_url=image_of(h), sale_status=availability(h), tags=tags)
        d, size_raw, dim_note = outer(spec)
        K.put_dims(row, d, size_raw)
        nz, nraw = niche(spec)
        if cat in ("oven", "microwave", "dishwasher") and nz:
            row.update(nz)
            row["niche_raw"] = nraw
        cut_note = None
        if cat == "cooktop":
            cw, cd, craw, cut_note = cutout(spec)
            if cw and cd:
                row["cutout_w_mm"], row["cutout_d_mm"] = cw, cd
            row["cutout_raw"] = craw
            if not (cw and cd):
                row["install_type"] = None
        cap = first(spec, "오븐내부 용량(ℓ)", "오븐내부 용량(l)")
        if cap and cat in ("oven", "microwave"):
            row["capacity_l"] = K.F.to_num(str(num(cap)))
        pc = first(spec, "장소 설정 개수")
        if pc and cat == "dishwasher":
            row["place_count"] = mm(pc)
        notes = []
        for k in ("도어 열림에 필요한 깊이(cm)", "최소 전면 패널 무게(kg)", "최대 전면 패널 무게(kg)", "도어 힌지",
                  "연결 박스를 포함한 케이스 높이 (mm)", "최소 작업대 두께(mm)"):
            v = first(spec, k)
            if v:
                notes.append(f"{k} {v}")
        for k in ("옵션 액세서리를 통해 유도되는 배기 공기", "옵션 액세서리를 통해 유도되는 재순환 공기"):
            v = first(spec, k)
            if v:
                notes.append(f"{k}: {v}")
        row["install_notes"] = " · ".join(notes) or None
        row["product_type_raw"] = " / ".join(x for x in [
            "밀레 메뉴 " + ",".join(cats), " · ".join(flags) or None, matnr and f"자재번호 {matnr}",
            dim_note, cut_note] if x)
        rows.append(row)
    for path, cats in skipped:
        print(f"[miele] 건너뜀 (주방 5종 아님): {path} {cats}", file=sys.stderr)
    return rows
