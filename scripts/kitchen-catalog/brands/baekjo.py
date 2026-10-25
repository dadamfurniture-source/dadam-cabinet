"""백조씽크 싱크볼 — baekjosink.com (WordPress) REST 목록 → 상품 페이지 사양 칸 (2026-10-25).

  목록   /wp-json/wp/v2/product_list?_embed=wp:featuredmedia (100개씩) — 상품마다 분류 번호 · 대표 사진 원본 주소
  분류   /wp-json/wp/v2/products-category — 수전 · 기타기기 · 스텐상판 · 후드 · LAY-ON TABLE(작업대 · 가스대)은 뺀다
  사양   상품 페이지 '전체 사이즈 (T)' · '볼 사이즈 (B)' · '배수구 (H)' · '따내기 사이즈 (C)'

같은 사이트가 수입 브랜드(Blanco · Apell · Elleci)도 판다 (백조씽크 = 국내 공식 유통). 그 상품은
blanco.py · apell.py · elleci.py 가 이 파일의 site_rows() 를 불러 그 브랜드 이름으로 낸다 — 이 파일 collect() 는 백조 상품만.

치수 순서: 칸 이름 '전체 사이즈 (T)' 에는 순서 표시가 없다. 모든 상품 페이지에 붙은 주석
'(가로, 세로 ±2mm / 높이 ±5mm)' 의 순서(가로 × 세로 × 높이 = W × D × H)로 읽는다 — 공식 도면 PDF 와 대조해 맞았다
(CALMFORTE 860 · SS 900 · SUBLINE 800-U · RS 490). 다만 US 씽크볼 BS 324 도면은 가로 382 · 세로 324 인데 페이지는
'324X382X180' 이라 순서가 반대다 → US 씽크볼 분류와 가로 < 세로 로 읽힌 행은 '치수순서추정' (미검증).
따내기(상판 타공)도 같은 순서로 읽는다. 수전 구멍은 페이지에 없다 (언더 · 인셋 볼은 상판에 수전을 단다).
"""
import json
import re
import sys

BRAND_KEY = "baekjo"
K = None   # collect.py 가 넘긴다

SITE = "https://baekjosink.com"
# 싱크볼이 아닌 분류 — 이 분류에 든 상품은 뺀다 (LAY-ON TABLE = 작업대 · 가스대)
NOT_SINK = {"faucet", "etc", "stainless-steel-table-plate", "hood", "lay-on-table"}
# 수입 브랜드 분류 → 한글 브랜드 이름
IMPORT_BRANDS = {"blanco": "블랑코", "apell": "아펠", "elleci": "엘레치"}
# 브랜드 · 라인 분류는 종류(product_type_raw)에 넣지 않는다
BRAND_SLUGS = set(IMPORT_BRANDS) | {"baekjo", "calmforte", "belforte", "quiet", "coni-sink"}
LABELS = {
    "size": r"전체\s*사이즈\s*\(T\)",
    "bowl": r"볼\s*사이즈\s*\(B\)",
    "drain": r"배수구\s*\(H\)",
    "cut": r"따내기\s*사이즈\s*\(C\)",
    "acc": r"액세서리\s*\(A\)",
}
STOP = re.compile(r"^(구매하기|상세정보|•)")
ORDER_NOTE = re.compile(r"\(가로,\s*세로\s*±\s*\d+\s*mm\s*/\s*높이\s*±\s*\d+\s*mm\)")
NO_CUT = re.compile(r"실측|문의|편차발생|Inquiry")


def _json(f, url):
    st, x = f.get(url)
    if st != 200:
        return None
    try:
        return json.loads(x)
    except ValueError:
        return None


def products(f):
    """→ (상품 목록, {분류 번호: slug}, {slug: 이름})"""
    cats = _json(f, f"{SITE}/wp-json/wp/v2/products-category?per_page=100") or []
    slug = {c["id"]: c["slug"] for c in cats}
    name = {c["slug"]: K.F.html.unescape(c["name"]) for c in cats}
    out = []
    for page in range(1, 20):
        j = _json(f, f"{SITE}/wp-json/wp/v2/product_list?per_page=100&page={page}&_embed=wp:featuredmedia")
        if not j:
            break
        out += j
        if len(j) < 100:
            break
    return out, slug, name


def spec_block(text):
    """상품 페이지 글 → ({'size': '860 X 460 X 200 mm', 'cut': '…', …}, 순서 주석 있음?)"""
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    try:
        i0 = lines.index("PRODUCT")
    except ValueError:
        return {}, False
    spec, cur = {}, None
    for ln in lines[i0 + 1:i0 + 60]:
        if STOP.match(ln):
            break
        key = next((k for k, p in LABELS.items() if re.fullmatch(p, ln)), None)
        if key:
            cur = key
            spec.setdefault(key, "")
            continue
        if cur:
            spec[cur] = (spec[cur] + " " + ln).strip()
    tail = " ".join(lines[i0:i0 + 80])
    return spec, bool(ORDER_NOTE.search(tail))


def cutout_of(raw):
    """따내기 글 → (가로, 세로, R) · 없으면 None.
    '828 X 432 X R24 mm (※ …)' · '788 X 408 (X R9) mm' · '788*408*(R9)' · '(인셋 설치 기준) 840X480XR15mm' · '643 X 415 mm'
    원형 '지름 466' → (466, 466, 233). '–' · '실측요망' · '문의 요망' · '편차발생, 실측요망' → None"""
    if not raw or NO_CUT.search(raw) and not re.search(r"\d{3}\s*[xX×*]\s*\d{3}", raw):
        return None
    t = raw.replace(",", " ")
    m = re.search(r"지름\s*(\d{3,4})", t)
    if m and not re.search(r"\d{3}\s*[xX×*]\s*\d{3}", t):
        dia = int(m.group(1))
        return dia, dia, dia // 2 if dia % 2 == 0 else None
    m = re.search(r"(\d{3,4})\s*[xX×*]\s*(\d{2,4})(?:\s*\(?\s*[xX×*]?\s*\(?\s*R\s*(\d{1,3})\s*\)?)?", t)
    if not m:
        return None
    rest = t[m.end():]
    if re.match(r"\s*[xX×*]\s*\d", rest):      # 세 번째 값이 R 이 아닌 숫자 — 무엇인지 모른다
        return None
    return int(m.group(1)), int(m.group(2)), (int(m.group(3)) if m.group(3) else None)


def image_of(p):
    for m in (p.get("_embedded") or {}).get("wp:featuredmedia") or []:
        u = (m or {}).get("source_url")
        if u and str(u).startswith("https://"):
            return u
    return None


def brand_of(slugs):
    for s, b in IMPORT_BRANDS.items():
        if s in slugs:
            return b
    return "백조"


def line_of(title, slugs, brand):
    t = title.upper()
    if "CALMFORTE" in t or "calmforte" in slugs:
        return "Calm:forte"
    if "BELFORTE" in t or "belforte" in slugs:
        return "Bel:forte"
    if "QUIET" in t or "quiet" in slugs:
        return "Quiet"
    if "coni-sink" in slugs:
        return "CONI"
    if brand == "백조":
        return "BAEKJO"
    # 수입 브랜드는 시리즈 이름 (ELON XL 8S → ELON XL · FERRARA PLUS 840 → FERRARA PLUS) — 크기 · 따내기가 같은
    #   다른 시리즈(ELON XL 8S · ZIA 9)가 collect.py merge 에서 한 행으로 묶이지 않게
    return re.sub(r"[\s-]*\d.*$", "", title).strip() or brand


def codes_of(title):
    """'GD 540, (E)QUIET 540' → ['GD 540', '(E)QUIET 540'] — 제조사가 한 페이지에 적은 이름들 그대로"""
    parts = [p.strip() for p in re.split(r",\s+|\s+/\s+", title) if p.strip()]
    return parts or [title]


def split_models(title, size, bowl, cut):
    """한 페이지에 두 모델 — 'JS 870, JS 1020' · T '870 X 480 X 200 mm / 1020 X 480 X 200' → 모델마다 (이름, T, B, C)."""
    sizes = [s for s in re.split(r"\s+/\s+", size or "") if len(K.split_dims(s)) >= 3]
    names = codes_of(title)
    if len(sizes) < 2 or len(names) != len(sizes):
        return [(title, size, bowl, cut)]
    bowls = re.split(r"\s+/\s+", bowl or "")
    cuts = re.split(r"\s+/\s+", cut or "")
    out = []
    for i, nm in enumerate(names):
        out.append((nm, sizes[i], bowls[i] if len(bowls) == len(sizes) else bowl,
                    cuts[i] if len(cuts) == len(sizes) else cut))
    return out


def make_row(p, url, brand, slugs, cname, has_note, name, size, bowl, cut, drain, split_from):
    parts = K.split_dims(size)
    bparts = K.split_dims(bowl)
    notes = []
    kinds = [cname.get(s, s) for s in slugs if s not in BRAND_SLUGS]
    lay_on = "lay-on-sink" in slugs
    if lay_on:
        kinds.append("상판 일체형 — 상판 따내기 없음")
    for q in re.findall(r"\(([^)]*(?:인셋|언더)[^)]*)\)", cut or ""):   # '(인셋 설치 기준)' · '(인셋권장)' · '(DS850 비확장 언더 기준)'
        if f"따내기 {q}" not in kinds:
            kinds.append(f"따내기 {q}")
    row = K.base_row(brand=brand, category="sink", category_subtype=None, install_type=None,
                     model_name=name, model_codes=codes_of(name), line=line_of(name, slugs, brand),
                     source_url=url, page_url=url, image_source_url=image_of(p),
                     product_type_raw=" / ".join(kinds) or None)
    if split_from:
        notes.append(f"한 페이지 두 모델 '{split_from}' 에서 나눔")
    label = "(W x D x H)" if has_note else None
    if not has_note:
        row["tags"].append("치수순서추정")
    if len(parts) >= 3:
        d, _ = K.dims_of(label, size, "wdh")
        raw = size
    elif len(parts) == 2 and len(bparts) >= 3:
        # MANO 시리즈 — 전체 사이즈가 가로 × 세로뿐. 볼 깊이는 볼 사이즈 세 번째 값
        d = {"w": parts[0], "d": parts[1], "h": bparts[2]}
        raw = f"전체 {size} · 볼 {bowl}"
        notes.append("높이 = 볼 사이즈 세 번째 값 (전체 사이즈에 높이 없음)")
    else:
        return None
    if d and d["w"][0] < d["d"][0] and "치수순서추정" not in row["tags"]:
        row["tags"].append("치수순서추정")     # 가로 < 세로 — 페이지 순서가 도면과 반대인 모델이 있다 (BS 324)
    if "us-sink" in slugs and "치수순서추정" not in row["tags"]:
        row["tags"].append("치수순서추정")
    K.put_dims(row, d, raw)
    bw = K.split_dims(bowl) if bowl and not re.search(r",|2EA|/|&", bowl) else []
    if d and len(bw) >= 2 and (bw[0][0] > d["w"][0] or bw[1][0] > d["d"][0]):
        # 전체 사이즈가 볼 사이즈보다 작다 — 페이지 오기. SQL 에서 뺀다
        row["tags"].append("치수확인필요")
        notes.append(f"전체 사이즈 {size} 가 볼 사이즈 {bowl} 보다 작다 — 페이지 오기로 보고 뺌")
    if re.search(r"\d\s*\(\s*\d+\s*\)", size):
        notes.append(f"괄호 값은 다른 변형 (예: 깊이 550(600) · 높이 235(245))")
    if lay_on:
        notes.append("Lay-on 높이 = 윗면부터 볼 바닥까지 (도면 SS 900: 290, 볼 깊이 201)")
    cut = (cut or "").strip()
    if cut and cut not in ("–", "-"):
        row["cutout_raw"] = cut
        c = cutout_of(cut)
        if c:
            row["cutout_w_mm"], row["cutout_d_mm"], row["cutout_r_mm"] = c
            if re.search(r"지름", cut):
                notes.append(f"원형 따내기 지름 {c[0]} → 가로 · 세로 {c[0]}, R {c[2]}")
    if bowl:
        notes.append(f"볼 사이즈 {bowl}")
    if drain:
        notes.append(f"배수구 {drain}")
    row["install_notes"] = " · ".join(notes) or None
    return row


def site_rows(f, K_, want_brand, sample=None):
    """백조씽크 사이트에서 want_brand('백조' · '블랑코' · '아펠' · '엘레치') 상품만 행으로."""
    global K
    K = K_
    prods, slug, cname = products(f)
    print(f"[baekjosink] products={len(prods)}", file=sys.stderr)
    rows = []
    for p in prods:
        slugs = [slug.get(i, str(i)) for i in p.get("products-category") or []]
        if set(slugs) & NOT_SINK or brand_of(slugs) != want_brand:
            continue
        url = p["link"]
        st, h = f.get(url)
        if st != 200:
            continue
        spec, has_note = spec_block(K.F.html_to_text(h))
        size = spec.get("size") or ""
        if len(K.split_dims(size)) < 2:          # 수전 · 부속 (사이즈 칸이 없거나 '390mm / …' 처럼 한 값)
            continue
        title = K.F.html.unescape(p["title"]["rendered"]).strip()
        models = split_models(title, size, spec.get("bowl"), spec.get("cut"))
        for name, sz, bw, ct in models:
            row = make_row(p, url, want_brand, slugs, cname, has_note, name, sz, bw, ct, spec.get("drain"),
                           title if len(models) > 1 else None)
            if row:
                rows.append(row)
        if sample and len(rows) >= sample:
            break
    return rows


def collect(f, K_, sample=None):
    return site_rows(f, K_, "백조", sample)
