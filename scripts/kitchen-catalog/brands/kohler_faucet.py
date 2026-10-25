"""콜러(KOHLER Korea) 주방 수전 — kohler.co.kr '주방 > 주방 수전' 목록 → 제품 페이지 (2026-10-25).

  목록   /browse/kitchen/Categories/kitchen-faucets (제품 6개 · totalProducts 6). robots.txt 는 /results/ 등 검색 결과만 막는다
  제품   /productDetails/<모델>?skuid=<SKU> — 이름 · SKU · 사진(og:image) · '러프 인 / 사양 시트' · '설치 가이드' PDF 링크
  사양   제품 페이지 '치수:' 칸이 비어 있다. 치수는 링크된 techcomm.kohler.com PDF(중국어 설치설명서) '安装尺寸' 그림의
         글자 층 숫자 — Ø33~Ø40 (수전 구멍) · Ø51 (바닥) · 높이 · 토수 길이. 2026-10-25 robots.txt(없음, 404) 확인 뒤
         한 장씩 받아 읽고 그림과 맞춰 DRAWINGS 에 옮겼다 ('매뉴얼').

설명서 그림의 모델 코드가 국내 판매 코드와 다른 것 (13963T-C4 · 597T-C4 · 21366T-4 · 74053T-4)은 '국내판매미확인'
(그 코드의 치수 — 국내 모델과 같은지 모른다). 수전 구멍이 범위면 작은 값 + '치수범위', 원문 cutout_raw.
Graze 22061T-4 는 제품 페이지에 PDF 가 없어 뺀다 (치수 · 구멍 모름).
"""
import re
import sys

BRAND_KEY = "kohler_faucet"
K = None   # collect.py 가 넘긴다

SITE = "https://www.kohler.co.kr"
LIST = SITE + "/browse/kitchen/Categories/kitchen-faucets"
TC = "https://techcomm.kohler.com/techcomm/pdf/"

# 모델 → 설명서 '安装尺寸' 값 (PDF 글자 층 숫자). w 바닥(몸통) 지름 · h 높이 · d 토수 길이(몸통 중심 ~ 토수구) · out 토수구 높이
DRAWINGS = {
    "562T-B4": dict(pdf=TC + "1474613547603_562t.pdf", fig="562T-B4", w=51, h=384, d=229, out=233, hole="Ø33~Ø40",
                    note="바닥 Ø51 · 손잡이 140 / 177 · 상판 두께 64 Max. · 호스 873"),
    "13963T-B4": dict(pdf=TC + "1516334718908_13963T-C4.pdf", fig="13963T-C4", w=50.8, h=304, d=228, out=258, hole="Ø36~Ø42",
                      note="바닥 Ø50.8 · 손잡이 82 / 182 · 상판 두께 Max.80 · 호스 1600 / 800"),
    "597T-B4": dict(pdf=TC + "1516334826385_597T-C4.pdf", fig="597T-C4", w=50.8, h=372, d=202, out=201, hole="Ø33.5~Ø41",
                    note="바닥 Ø50.8 · 손잡이 87 / 63.5 · 상판 두께 Max 63.5 · 호스 1600 / 814"),
    "21367T-4": dict(pdf=TC + "1517307005794_21367T.pdf", fig="21366T-4", w=45, h=389, d=222, out=208, hole=None,
                     note="몸통 Ø45 · 목 Ø28 · 상판 아래 Ø51 · 헤드 85 · 손잡이 84 / 150 / 115 / 63 · 상판 두께 45 Max. · 호스 530 — "
                          "수전 구멍 지름 표기 없음 (설명서는 21366T-4 · 21367T-4 공용, 그림은 21366T-4)"),
    "21369T-4": dict(pdf=TC + "1517307026119_21369T.pdf", fig="74053T-4", w=45, h=323, d=182, out=232, hole="Ø33~Ø36",
                     note="몸통 Ø45 · 손잡이 70 / 138 / 115 / 58 · 상판 두께 40 최대 · 호스 560 "
                          "(설명서는 74053T-4 · 21368T-4 · 21369T-4 · 21370T-4 공용, 그림은 74053T-4. 영문판 1287539-2A-C(74053T).pdf 도 같은 값)"),
}


def num(x):
    return int(x) if float(x).is_integer() else x


def rnd(x):
    return int(float(x) + 0.5)


def hole_of(raw):
    ns = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", raw or "")]
    if not ns:
        return None, False
    return (num(min(ns[:2])), True) if len(ns) >= 2 else (num(ns[0]), False)


def collect(f, K_, sample=None):
    global K
    K = K_
    st, h = f.get(LIST)
    links = []
    for m in re.finditer(r'href="(/productDetails/([^"?]+)\?skuid=([^"]+))"', h):
        if m.group(2) not in [x[1] for x in links]:
            links.append((m.group(1), m.group(2), m.group(3)))
    total = re.search(r'id="totalProducts" value="(\d+)"', h)
    print(f"[kohler faucet] listed={len(links)} total={total.group(1) if total else '?'}", file=sys.stderr)
    if total and int(total.group(1)) > len(links):
        print("[kohler faucet] 목록 첫 쪽보다 제품이 많다 — 나머지는 /browse/lazy (아직 안 읽음)", file=sys.stderr)
    rows = []
    for path, model, sku in links:
        dw = DRAWINGS.get(model)
        if not dw:
            print(f"[kohler faucet] {model}: 설명서 치수 없음 — 건너뜀", file=sys.stderr)
            continue
        url = SITE + path
        st, ph = f.get(url)
        if st != 200:
            continue
        title = re.search(r"<title>([^<|]*)", ph)
        name = re.sub(r"\s+", " ", K.F.html.unescape(title.group(1))).strip() if title else model
        img = re.search(r'property="og:image" content="([^"]+)"', ph)
        text = re.sub(r"\s+", " ", K.F.html_to_text(ph))
        mt = re.search(r"安裝:\s*(\S+)", text)
        series = re.match(r"([A-Za-z]+)", name)
        kind = re.sub(r"^[A-Za-z]+™?\s*", "", name)
        row = K.base_row(brand="콜러", category="faucet", category_subtype=None, install_type=None,
                         model_name=name, model_codes=[model, sku], line=(series.group(1) if series else None),
                         source_url=dw["pdf"], page_url=url,
                         image_source_url=(img.group(1) if img and img.group(1).startswith("https://") else
                                           ("https:" + img.group(1) if img and img.group(1).startswith("//") else None)),
                         product_type_raw=" · ".join(x for x in [mt.group(1) if mt else None, kind] if x))
        notes = [f"설치설명서 그림 ({dw['fig']}): {dw['note']}", f"PDF {dw['pdf']}"]
        hole, ranged = hole_of(dw.get("hole"))
        if hole:
            row["faucet_hole_mm"] = hole
            row["cutout_raw"] = f"설치설명서 安装尺寸 {dw['hole']}"
            if ranged:
                row["tags"].append("치수범위")
        d = {k: (rnd(dw[k]), rnd(dw[k])) for k in ("w", "h", "d")}
        K.put_dims(row, d, f"폭(W, 바닥 지름) {dw['w']} · 높이 {dw['h']} · 토수(D) {dw['d']} · 토수구 높이 {dw['out']}")
        row["tags"].append("매뉴얼")
        if dw["fig"] != model:
            row["tags"].append("국내판매미확인")
            notes.insert(0, f"설명서 그림 모델 코드 {dw['fig']} 가 국내 판매 코드 {model} 와 다르다 — 같은 치수인지 모른다")
        row["install_notes"] = " · ".join(notes)
        rows.append(row)
        if sample and len(rows) >= sample:
            break
    return rows
