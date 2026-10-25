"""백조씽크 주방 수전 — baekjosink.com REST 목록(baekjo.py 의 products())의 '수전' 분류 + CONI 수전 (2026-10-25).

사장님 결정 (2026-10-25): 상판 · 싱크볼의 수전 구멍 지름은 싱크볼이 아니라 수전 모델에서 가져온다.

  목록   /wp-json/wp/v2/product_list (baekjo.py products() 그대로) — 분류 'faucet', 또는 'CONI 씽크볼' 분류 안의
         '전체 사이즈' 가 한 값뿐이고 따내기가 'Ø' 인 상품 (CONI 6002 · 6004 수전 — baekjo.py 가 뺀 것)
  사양   상품 페이지 '높이(H)' · '지름(C)' · '타공 권장 사이즈' · '컬러' (CONI: '전체 사이즈 (T)' · '따내기 사이즈 (C)')
  수전 구멍 = '타공 권장 사이즈' (CONI 는 '따내기 사이즈'). 'Φ 33 ~ 38 mm' 처럼 범위면 작은 값 + '치수범위' 태그, 원문은 cutout_raw

W · D 는 페이지 글자에 없다. 공식 도면만 쓴다 (값은 아래 DRAWINGS — 2026-10-25 에이전트가 눈으로 읽음 → '이미지판독'):
  2023 모델  상품 페이지 '도면 PDF 다운로드' (wp-content/uploads/2023/09/<모델>-도면.pdf, 글자 층 없는 그림)
  2025 모델  상품 페이지 상세 이미지 끝의 '제품 사양' 표 (가로 · 세로 · 타공 치수 · 모델명) — 앞모습 폭(W)이 없다
  CONI      상세 이미지의 '제품 사양' 표 · 도면 (가로 · 세로 · ø45)
W(본체 폭)를 공식 자료에서 못 찾은 모델은 K.put_dims(None) — '치수확인필요' 로 SQL 에서 빠지고, 높이 · 가로는 size_raw 에만 남긴다.

같은 사이트의 수입 브랜드(Blanco) 수전은 blanco_faucet.py 가 이 파일의 faucet_rows() 를 불러 '블랑코' 로 낸다.
baekjo.py 는 고치지 않고 불러 쓴다 (blanco.py 와 같은 방식).
"""
import importlib.util
import os
import re
import sys

BRAND_KEY = "baekjo_faucet"
K = None   # collect.py 가 넘긴다

LABELS = {
    "h": r"높이\s*\(H\)",
    "dia": r"지름\s*\(C\)",
    "hole": r"타공\s*권장\s*사이즈",
    "color": r"컬러",
    # CONI 수전은 싱크볼 칸 이름을 그대로 쓴다
    "size": r"전체\s*사이즈\s*\(T\)",
    "bowl": r"볼\s*사이즈\s*\(B\)",
    "drain": r"배수구\s*\(H\)",
    "cut": r"따내기\s*사이즈\s*\(C\)",
    "acc": r"액세서리\s*\(A\)",
}
STOP = re.compile(r"^(구매하기|상세정보|•)")
WALL_NOTE = "타공 중심 ~ 벽 120mm 이상 권장 (상세 이미지 '설치 시 주의사항')"

# 공식 도면 · 상세 이미지에서 눈으로 읽은 값 (slug → 값). 2026-10-25.
#   w   앞모습 폭 — 백조 2023 도면은 본체 지름 표기가 없어 '옆 손잡이까지 포함한 정면 폭', Blanco · CONI 는 바닥 지름(ø)
#   d   토수구 길이 — 2023 · Blanco 도면은 '몸통 중심 ~ 토수구' 치수, 2025 · CONI 는 '제품 사양' 표의 '가로'(토수구 ~ 몸통 끝)
#   h   도면 · 표의 전체 높이 (페이지 '높이(H)' 와 다르면 페이지 값을 넣고 '출처불일치' — 아래 h_pick 이 정한다)
#   src 어디서 읽었나 (사장님 확인용 주소)
U = "https://baekjosink.com/wp-content/uploads/"
DRAWINGS = {
    # --- 백조 2023 (도면 PDF) ---
    "lynn-313": dict(w=106, h=313, d=205, src=U + "2023/09/LYNN-313-도면.pdf",
                     note="도면: 정면 폭 106(손잡이 포함) · 높이 313 · 토수 205 · 전체 길이 255 · 토수구 높이 254"),
    "edlyn-354": dict(w=107, h=353, d=169, src=U + "2023/09/EDLYN-354-도면.pdf",
                      note="도면: 정면 폭 107(손잡이 포함) · 높이 353 · 토수 169 · 토수구 높이 253 · 목 ø28"),
    "kai-553": dict(w=109, h=522, d=215, src=U + "2023/09/KAI-553-도면.pdf",
                    note="도면: 정면 폭 109(손잡이 포함) · 높이 522 · 토수 215 · 전체 길이 257 · 토수구 높이 179"),
    "doris-645": dict(w=121, h=527, d=208, src=U + "2023/09/DORIS-645-도면.pdf",
                      note="도면: 정면 폭 121(손잡이 포함) · 높이 527 · 토수 208 · 전체 길이 270 · 토수구 높이 135"),
    # --- 백조 2025 (상세 이미지 '제품 사양' 표 — 앞모습 폭 없음) ---
    "ora": dict(h=432, d=265, code="ORA 432", hole_img="38Ø", src=U + "2025/06/ORA-432_상세.jpg"),
    "foss-i": dict(h=380, d=245, code="FOSS-I 380", hole_img="38Ø", src=U + "2025/06/FOSS-I_상세원터치-수정-버전.jpg"),
    "foss-v": dict(h=363, d=230, code="FOSS-V 360", hole_img="38Ø", src=U + "2025/06/FOSS-V_상세원터치-수정-버전.jpg"),
    "alto-u": dict(h=440, d=258, code="ALTO-U 470", hole_img="38Ø", src=U + "2025/06/ALTO-U-470-상세페이지-1.jpg"),
    "alto-o-545": dict(h=545, d=255, code="ALTO-O 545", hole_img="38Ø", src=U + "2025/06/ALTO-O-545-BN-1001-1.jpg"),
    "riva-u": dict(h=423, d=245, code="RIVA-U 454", hole_img="38Ø", src=U + "2025/06/RIVA-U-454BNGG.jpg"),
    "riva": dict(h=465, d=240, code="RIVA-497", hole_img="38Ø", src=U + "2025/06/RIVA-497-상세.jpg"),
    "horn": dict(h=440, d=257, code="HORN-545", hole_img="38Ø", src=U + "2025/06/HORN-545_상세-2.jpg"),
    "seven": dict(h=445, d=260, code="SEVEN 424", hole_img="38Ø", src=U + "2025/06/SEVEN-424-상세.jpg"),
    "slim-u": dict(h=475, d=235, code="SLIM-U 475", hole_img="38Ø", src=U + "2025/06/SLIM-U-475-상세-1.jpg"),
    "slim-v": dict(h=380, d=250, code="SLIM-V 486", hole_img="38Ø", src=U + "2025/06/SLIM-V-486-상세.jpg"),
    "horn-d": dict(h=433, d=280, code="HORN-D 433", hole_img="38Ø", src=U + "2025/06/HORN-D-433-100.jpg"),
    "foss-d": dict(h=380, d=250, code="FOSS-D 316", hole_img="38Ø", src=U + "2025/06/FOSS-D_상세원터치-수정-버전.jpg"),
    "arc-u": dict(h=420, d=270, code="ARC-U 420", hole_img="38Ø", src=U + "2025/06/ARC-U_상세.jpg"),
    "arc-d": dict(h=360, d=260, code="ARC-D 370", hole_img="38Ø", src=U + "2025/06/ARC-D-370-상세-100.jpg"),
    "foss-z": dict(h=433, d=232, code="FOSS-Z 433", hole_img="36Ø~38Ø", src=U + "2025/06/KakaoTalk_20250630_114638944-1.jpg"),
    # --- CONI (상세 이미지 '제품 사양' 표 + 도면) ---
    "coni-6002": dict(w=45, h=380, d=240, code="CONI-6002", hole_img="38 파이 · 도면 '타공홀 ø36~ø38'",
                      src=U + "2026/01/6002.jpg", note="도면: 몸통 ø45 · 정면 폭 100(손잡이 포함) · 손잡이 높이 110"),
    "coni-60043way": dict(w=45, h=390, d=250, code="CONI-6004", hole_img="38 파이", src=U + "2026/01/6004.jpg",
                          note="도면: 몸통 ø45 · 정면 폭 100(손잡이 포함) · 토수구 높이 250 · 손잡이 높이 110"),
    # --- Blanco (백조 사이트 도면 PDF — Blanco 원 도면) ---
    "mili": dict(w=52, h=310, d=210, src=U + "2023/09/MILI-도면.pdf",
                 note="도면: 바닥 ø52 · 높이 310 · 토수 210 · 전체 길이 244 · 토수구 높이 233 · ø45 (구멍 쪽 표시)"),
    "mila": dict(w=52, h=270, d=210, src=U + "2023/09/MILA-도면.pdf",
                 note="도면: 바닥 ø52 · 높이 270 · 토수 210 · 토수구 높이 241"),
    "mida": dict(w=52, h=327, d=182, src=U + "2023/09/MIDA-도면.pdf", hole_img="ømin.35 ~ ømax.45",
                 note="도면: 바닥 ø52 · 높이 327 · 토수 182 · 토수구 높이 221 · 수전 구멍 ømin.35 / ømax.45"),
    "catris-s": dict(w=54, h=480, d=187, src=U + "2023/09/CATRIS-S-도면.pdf",
                     note="도면: 바닥 ø54 · 몸통 ø44 · 높이 480 · 토수 187 · 전체 길이 283 · 토수구 높이 157 · 상판 두께 max.50"),
    "mila-s": dict(w=52, d=208, src=U + "2023/09/MILA-S-도면.pdf",
                   note="도면: 바닥 ø52 · 토수 208 · 토수구 높이 263 (전체 높이 표기 없음 → 페이지 높이)"),
    "catris-s-flexo": dict(d=187, h=475, src=U + "2023/09/CATRIS-S-FLEXO-도면.pdf",
                           note="도면: 높이 475 · 토수 187 · 토수구 높이 159 — 바닥 지름 표기 없음"),
    "mida-s": dict(d=186, src=U + "2023/09/MIDA-S-도면.pdf",
                   note="도면: 토수 186 · 토수구 높이 200 · 손잡이 68+68 · ø35 · 상판 두께 max.50 — 바닥 지름 · 전체 높이 표기 없음"),
}
# 페이지에 붙은 도면이 다른 모델 것 — 쓰지 않는다
WRONG_DRAWING = {"mida-s-2": "LINUS-S 페이지에 MIDA-S 도면이 붙어 있다 (높이 284 vs MIDA-S 336) — 도면 값을 쓰지 않음"}


def _baekjo():
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "baekjo.py")
    spec = importlib.util.spec_from_file_location("kitchen_brand_baekjo_shared_faucet", here)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def to_num(s):
    x = float(s)
    return int(x) if x.is_integer() else x


def hole_of(raw):
    """'Φ 33 ~ 38 mm' → (33, True) · 'Φ 33~38' → (33, True) · '38mm' · '38Ø' → (38, False). 없으면 (None, False)."""
    t = (raw or "").replace(",", "")
    nums = re.findall(r"\d+(?:\.\d+)?", t)
    if not nums:
        return None, False
    if "~" in t and len(nums) >= 2:
        return to_num(min(float(nums[0]), float(nums[1]))), True
    return to_num(nums[0]), False


def spec_block(text):
    """상품 페이지 글 → {'h': '432mm', 'hole': 'Φ 33 ~ 38 mm', 'color': 'Brushed Nickel (무광) / White (무광)', …}"""
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    try:
        i0 = lines.index("PRODUCT")
    except ValueError:
        return {}
    spec, cur = {}, None
    for ln in lines[i0 + 1:i0 + 40]:
        if STOP.match(ln):
            break
        key = next((k for k, p in LABELS.items() if re.fullmatch(p, ln)), None)
        if key:
            cur = key
            spec.setdefault(key, "")
            continue
        if cur:
            spec[cur] = (spec[cur] + (" / " if cur == "color" and spec[cur] else " ") + ln).strip()
    return spec


def detail_words(text):
    """상세정보 글 → 종류 낱말 (풀아웃 · 폭포수 · 직수/분사 …)"""
    t = re.sub(r"\s+", " ", text)
    i = t.find("추천제품 상세정보")
    body = t[i:i + 1500] if i >= 0 else ""
    words = []
    for pat, w in ((r"씽크볼 내부에 삽입", "씽크볼 내장형"), (r"폭포수", "폭포수"), (r"[Pp]ull-?out", "풀아웃"),
                   (r"3way", "3way"), (r"직수\s*/\s*(?:분사|스프레이)", "직수·분사"), (r"직수 형태로", "직수"),
                   (r"헤드 분리", "헤드 분리"), (r"360도 회전", "360도 회전")):
        if re.search(pat, body) and w not in words:
            words.append(w)
    m = re.search(r"([^.]*모델에만 설치가 가능합니다)", body)
    return words, (m.group(1).strip() if m else None)


def is_faucet(slugs, spec):
    if "faucet" in slugs:
        return True
    # CONI 씽크볼 분류 안의 수전 — '전체 사이즈' 가 한 값('390mm / …')이고 따내기가 'Ø'
    return "coni-sink" in slugs and len(K.split_dims(spec.get("size") or "")) < 2 and "Ø" in (spec.get("cut") or "")


def family(title):
    t = re.sub(r"\s*/.*$", "", title).strip()
    return re.sub(r"[\s-]*\d.*$", "", t).strip() or t


def make_row(p, url, brand, slugs, cname, title, spec, text, img):
    slug = url.rstrip("/").rsplit("/", 1)[-1]
    dw = DRAWINGS.get(slug, {})
    words, only_for = detail_words(text)
    coni = "coni-sink" in slugs
    kinds = ["CONI 수전" if coni else "수전"] + words
    codes = [c.strip() for c in re.split(r"\s+/\s+", title) if c.strip()]
    if dw.get("code") and dw["code"] not in codes:
        codes.append(dw["code"])
    row = K.base_row(brand=brand, category="faucet", category_subtype=None, install_type=None,
                     model_name=title, model_codes=codes, line=("CONI" if coni else family(title)),
                     source_url=url, page_url=url, image_source_url=img, product_type_raw=" · ".join(kinds))
    notes = []
    # 수전 구멍 — 페이지 글자 ('타공 권장 사이즈', CONI 는 '따내기 사이즈')
    hole_raw = (spec.get("hole") or spec.get("cut") or "").strip()
    hole, ranged = hole_of(hole_raw)
    raw_parts = []
    if hole_raw:
        raw_parts.append(("타공 권장 사이즈 " if spec.get("hole") else "따내기 사이즈 (C) ") + hole_raw)
    if spec.get("dia"):
        raw_parts.append(f"지름(C) {spec['dia']}")
    if dw.get("hole_img"):
        raw_parts.append(f"상세 이미지 · 도면 타공 {dw['hole_img']}")
    row["cutout_raw"] = " · ".join(raw_parts) or None
    if hole:
        row["faucet_hole_mm"] = hole
        if ranged:
            row["tags"].append("치수범위")
    img_min, img_ranged = hole_of(dw.get("hole_img"))
    if hole and img_ranged and img_min > hole and "파이" not in (dw.get("hole_img") or ""):
        # FOSS-Z: 페이지 'Φ 33 ~ 38' · 상세 이미지 '36Ø~38Ø' / MIDA: 페이지 'Φ 33 ~ 35' · 도면 'ømin.35'
        row["tags"].append("출처불일치")
        notes.append(f"수전 구멍 하한이 다르다: 페이지 {hole_raw} · 공식 자료 {dw['hole_img']} — 작은 값 {hole} 을 넣음")
    # 높이 — 페이지 '높이(H)' (CONI 는 '전체 사이즈' 첫 값)
    page_h_raw = (spec.get("h") or (spec.get("size") or "").split("/")[0]).strip()
    if coni and "/" in (spec.get("size") or "") and not spec.get("color"):
        spec["color"] = spec["size"].split("/", 1)[1].strip()          # '390mm / Brushed Nickel(무광)'
    hs = re.findall(r"\d+(?:\.\d+)?", page_h_raw or "")
    page_h = to_num(hs[0]) if hs and not re.search(r"\d\s*[xX×]\s*\d", page_h_raw) else None
    h = page_h
    if dw.get("h") and page_h and abs(dw["h"] - page_h) > 5:
        # 페이지 허용오차(높이 ±5mm)를 넘는 차이 — 어느 쪽인지 모른다
        row["tags"].append("출처불일치")
        notes.append(f"높이: 페이지 {page_h} · 도면/상세 이미지 {dw['h']} — 페이지 값을 넣음")
        if slug == "alto-o-545":
            notes.append("ALTO-O 페이지 높이 440 은 ALTO-U 와 같은 값이라 복사 오기로 보인다 (상세 이미지 · 모델명 545)")
    elif dw.get("h") and page_h and dw["h"] != page_h:
        notes.append(f"높이: 페이지 {page_h} · 도면/상세 이미지 {dw['h']} (허용오차 ±5 안)")
    if h is None:
        h = dw.get("h")
    size_txt = " · ".join(x for x in [
        f"페이지 높이(H) {page_h_raw}" if page_h_raw else None,
        f"공식 도면/상세 이미지 높이 {dw['h']}" if dw.get("h") else None,
        f"토수(D) {dw['d']}" if dw.get("d") else None,
        f"폭(W) {dw['w']}" if dw.get("w") else "폭(W) 공식 자료에 없음"] if x)
    if dw.get("w") and dw.get("d") and h:
        d = {"w": (dw["w"], dw["w"]), "h": (h, h), "d": (dw["d"], dw["d"])}
        K.put_dims(row, d, size_txt)
    else:
        K.put_dims(row, None, size_txt)       # W 가 없다 → '치수확인필요' (SQL 제외), 값은 size_raw 에만
    if dw:
        row["tags"].append("이미지판독")
        notes.append(f"공식 자료(눈으로 읽음): {dw['src']}")
        if dw.get("note"):
            notes.append(dw["note"])
        if dw.get("w") and slug in ("lynn-313", "edlyn-354", "kai-553", "doris-645"):
            notes.append("W = 도면 정면 폭 (옆 손잡이 포함 — 본체 지름 표기 없음)")
        if dw.get("d") and (slug in ("coni-6002", "coni-60043way") or dw.get("code")):
            notes.append("D = '제품 사양' 표의 가로 (토수구 ~ 몸통 끝, 몸통 중심 기준 토수 길이 아님)")
        if dw.get("code"):
            notes.append(WALL_NOTE)
            notes.append(f"상세 이미지 모델명 {dw['code']}")
    if slug in WRONG_DRAWING:
        notes.append(WRONG_DRAWING[slug])
    if only_for:
        notes.append(only_for)
    if spec.get("color"):
        notes.append(f"색상 {spec['color']}")
    row["install_notes"] = " · ".join(notes) or None
    return row


def faucet_rows(f, K_, want_brand, sample=None):
    """백조씽크 사이트 수전 중 want_brand ('백조' · '블랑코') 것만 행으로."""
    global K
    K = K_
    B = _baekjo()
    B.K = K_
    prods, slug, cname = B.products(f)
    rows = []
    for p in prods:
        slugs = [slug.get(i, str(i)) for i in p.get("products-category") or []]
        if B.brand_of(slugs) != want_brand or not ("faucet" in slugs or "coni-sink" in slugs):
            continue
        url = p["link"]
        st, h = f.get(url)
        if st != 200:
            continue
        text = K.F.html_to_text(h)
        spec = spec_block(text)
        if not is_faucet(slugs, spec):
            continue
        title = K.F.html.unescape(p["title"]["rendered"]).strip()
        img = B.image_of(p)
        if not img:      # REST 대표 사진이 없는 상품 (RIVA-U) — 상품 페이지 첫 사진
            m = re.search(r'class="sp-image" src="(https://[^"]+)"', h)
            img = K.F.abs_url(m.group(1), url) if m else None
        rows.append(make_row(p, url, want_brand, slugs, cname, title, spec, text, img))
        if sample and len(rows) >= sample:
            break
    print(f"[baekjosink faucet] {want_brand}: {len(rows)}", file=sys.stderr)
    return rows


def collect(f, K_, sample=None):
    return faucet_rows(f, K_, "백조", sample)
