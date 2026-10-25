"""리젠스 주방 수전 (FONTANA) — lizens.co.kr 홈 메뉴 '수전' /kr/faucets/list.do?gc1=3 → 제품 페이지 (2026-10-25).

  목록   /kr/faucets/list.do?gc1=3&pn=1,2… (쪽마다 12개)
  사양   제품 페이지 규격표 HEAD · BODY · JOINT · Remark (재질 · 기능뿐 — 치수 · 수전 구멍 없음)
  도면   제품 페이지 '제품도면 다운로드' = /upload/drawing/<번호>_0.png (그림, 'FONTANA 4612 X · UX · TX SPECIFICATION SHEET')

수전 구멍 · 높이 · 토수 길이는 도면 그림에만 있다 → 2026-10-25 에이전트가 눈으로 읽어 DRAWINGS 에 옮겼다 ('이미지판독').
도면 'MIN ∮36 / MAX ∮40' → 수전 구멍 36 + '치수범위' (원문 cutout_raw). 앞모습 폭(본체 지름)은 도면에 없어
K.put_dims(None) — '치수확인필요' (SQL 제외), 높이 · 토수는 size_raw 에만.
리젠스 2026 카탈로그(/catalogfiledownload.do?seq=25)에는 수전이 없다.
"""
import re
import sys

BRAND_KEY = "lizens_faucet"
K = None   # collect.py 가 넘긴다

SITE = "https://lizens.co.kr"
LIST = SITE + "/kr/faucets/list.do?gc1=3"

# 제품 번호(seq) → 도면에서 읽은 값. 도면 제목(4612 X · UX · TX)과 페이지 이름(TF-K4612 · U · T)의 대응은 이름 끝 글자로 맞췄다
DRAWINGS = {
    "41": dict(title="FONTANA 4612 UX", h=400, d=223, hole="MIN Ø36 / MAX Ø40",
               note="도면: 높이 400 · 토수 223 · 위에서 본 길이 239 · 토수구 높이 202 · 손잡이 79 / 156 / 66 · 상판 아래 45"),
    "40": dict(title="FONTANA 4612 X", h=288, d=229, hole="MIN Ø36 / MAX Ø40",
               note="도면: 높이 288 · 토수 229 · 위에서 본 길이 277 · 토수구 높이 249 · 손잡이 79 / 156 / 66 · 상판 아래 45"),
    "39": dict(title="FONTANA 4612 TX", h=347, d=228, hole="MIN Ø36 / MAX Ø40",
               note="도면: 높이 347 · 토수 228 · 위에서 본 길이 244 · 토수구 높이 246 · 손잡이 79 / 156 / 66 · 상판 아래 45"),
}


def items(f):
    seen = []
    for pn in range(1, 20):
        st, x = f.get(f"{LIST}&pn={pn}")
        got = [s for s in re.findall(r"href='display\.do\?seq=(\d+)'", x) if s not in seen]
        if st != 200 or not got:
            break
        seen += got
    return seen


def page(h):
    title = re.search(r'<h5 class="cl-title mb-3 fnb">([^<]*)</h5>', h)
    pairs = [(K.F.html.unescape(a).strip(), K.F.html.unescape(b).strip())
             for a, b in re.findall(r"<li class='d-flex'>\s*<span>([^<]*)</span>\s*<span>([^<]*)</span>", h)]
    img = re.search(r"src='(/upload/goods/[^']+)'", h)
    drawing = re.search(r"src='(/upload/drawing/[^']+)'", h)
    return ((K.F.html.unescape(title.group(1)).strip() if title else None), pairs,
            (K.F.abs_url(img.group(1), SITE) if img else None), (K.F.abs_url(drawing.group(1), SITE) if drawing else None))


def collect(f, K_, sample=None):
    global K
    K = K_
    seqs = items(f)
    print(f"[lizens faucet] pages={len(seqs)}", file=sys.stderr)
    rows = []
    for seq in seqs:
        url = f"{SITE}/kr/faucets/display.do?seq={seq}"
        st, h = f.get(url)
        if st != 200:
            continue
        title, pairs, img, drawing = page(h)
        if not title:
            continue
        remark = next((b for a, b in pairs if a.lower() == "remark"), None)
        series = re.match(r"([A-Z]+)", title)
        code = re.sub(r"^[A-Z]+\s+", "", title)          # 'FONTANA TF-K4612(BN)' → 'TF-K4612(BN)'
        row = K.base_row(brand="리젠스", category="faucet", category_subtype=None, install_type=None,
                         model_name=title, model_codes=[code], line=(series.group(1) if series else None),
                         source_url=url, page_url=url, image_source_url=img,
                         product_type_raw=" · ".join(x for x in ["수전", remark] if x))
        notes = [f"재질 {' / '.join(f'{a} {b}' for a, b in pairs if a.lower() != 'remark')}"] if pairs else []
        dw = DRAWINGS.get(seq)
        if dw:
            m = re.findall(r"\d+", dw["hole"])
            row["faucet_hole_mm"] = min(int(x) for x in m)
            row["cutout_raw"] = f"도면 수전 구멍 {dw['hole']}"
            row["tags"] += ["치수범위", "이미지판독"]
            notes.append(f"공식 도면(눈으로 읽음): {drawing} ('{dw['title']} SPECIFICATION SHEET')")
            notes.append(dw["note"])
            notes.append("도면 제목 4612 X · UX · TX ↔ 페이지 TF-K4612 · 4612U · 4612T 는 이름 끝 글자로 맞춤")
            K.put_dims(row, None, f"높이 {dw['h']} · 토수(D) {dw['d']} · 폭(W) 도면에 없음")
        else:
            notes.append("제품도면 없음 — 치수 · 수전 구멍 모름")
            K.put_dims(row, None, None)
        row["install_notes"] = " · ".join(notes) or None
        rows.append(row)
        if sample and len(rows) >= sample:
            break
    return rows
