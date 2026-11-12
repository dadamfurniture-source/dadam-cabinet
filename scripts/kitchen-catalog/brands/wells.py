"""교원 웰스 하부장 가전 — 언더싱크(시스템형) 정수기 (kyowonwells.com). (2026-11-03)

목록: 제품 > 물(categoryGroup=water) 화면이 부르는 POST /Product/PartialProductList (쪽마다 9개, 빈 쪽까지).
상세: /Product/Detail?grpIdx=…&productIdx=… '제품규격' 표.
  '형태' 가 '시스템형'(파우셋 + 싱크대 안 본체) 인 것만 넣는다. 데스크탑 · 스탠드 · 세척수기는 뺀다.
  '제품(본체) 크기(W x D x H) | 180mm X 352mm X 325mm' — 칸 이름의 (W x D x H) 로 순서를 읽는다.
  '기능 | 냉수/온수/정수' → hot_cold · cold · hot · purify. 파우셋 크기는 설치 안내(install_notes)로.
robots.txt: `Allow: /Product/*` (제품 하위 페이지 허용), 막는 곳은 /Member/* · /login · /Mypage · /Benefit/EventView.
"""
import html
import re
import sys

BRAND_KEY = "wells"
K = None   # collect.py 가 넘긴다

WL = "https://www.kyowonwells.com"


def text_lines(h):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", h, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", t))
    t = re.sub(r"[ \t\r]+", " ", t)
    return [x.strip() for x in t.split("\n") if x.strip()]


def cell(lines, label):
    for i, x in enumerate(lines[:-1]):
        if x == label:
            return lines[i + 1]
    return None


def list_items(f):
    out = []
    for page in range(1, 10):
        st, h = f.post_form(WL + "/Product/PartialProductList", {"categoryGroup": "water", "page": str(page)})
        items = re.findall(r'<li.*?</li>', h, re.S) if st == 200 else []
        got = 0
        for it in items:
            a = re.search(r'href="(/Product/Detail\?grpIdx=\d+&(?:amp;)?productIdx=\d+)"', it)
            if not a:
                continue
            url = WL + html.unescape(a.group(1))
            title = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", it))).strip()
            if all(url != o[0] for o in out):
                out.append((url, title))
                got += 1
        if not got:
            break
    return out


def subtype_of(func):
    s = func or ""
    cold, hot = "냉수" in s, "온수" in s
    return "hot_cold" if cold and hot else "cold" if cold else "hot" if hot else "purify"


def collect(f, K_, sample=None):
    global K
    K = K_
    items = list_items(f)
    print(f"[wells] 물 제품 {len(items)}", file=sys.stderr)
    rows = []
    for url, title in items:
        # 목록 글에 '시스템' · '빌트인' · '언더싱크' 가 있는 정수기만 연다 (데스크탑 · 스탠드는 열지 않는다 — 요청을 줄인다)
        if not re.search(r"정수기", title) or not re.search(r"시스템|빌트인|언더싱크", title):
            continue
        st, h = f.get(url)
        if st != 200:
            continue
        lines = text_lines(h)
        kind = cell(lines, "형태")
        if (kind or "").strip() != "시스템형":      # 언더싱크(본체가 싱크대 안)만
            continue
        name_raw = cell(lines, "제품명") or title
        spec_code = re.findall(r"\(([A-Z]{2}\d{3}[A-Z]{0,4})\)", name_raw)
        list_code = re.findall(r"\(([A-Z]{2}\d{3}(?:\s*/\s*[A-Z]{2}\d{3})*)\)", title)
        rent_code = re.findall(r"※\s*([A-Z]{2}\d{3}[A-Z]{2,4})\(", "\n".join(lines))
        codes = []
        for c in spec_code + [x.strip() for grp in list_code for x in grp.split("/")] + rent_code:
            if c and c not in codes:
                codes.append(c)
        size_label = next((x for x in lines if x.startswith("제품(본체) 크기")), None)
        size = cell(lines, size_label) if size_label else None
        faucet_label = next((x for x in lines if x.startswith("파우셋 크기")), None)
        faucet = cell(lines, faucet_label) if faucet_label else None
        img = re.search(r'<img src="(/upload/product/[^"]+)"[^>]*alt="[^"]+"', h)
        func = cell(lines, "기능")
        row = K.base_row(brand="웰스", category="water_purifier", category_subtype=subtype_of(func), install_type="built_in",
                         model_name=re.sub(r"\s*\([^)]*\)\s*$", "", re.sub(r"\(\d+년[^)]*\)", "", name_raw)).strip(),
                         model_codes=codes, line="시스템형", source_url=url, page_url=url,
                         image_source_url=(WL + img.group(1)) if img else None,
                         product_type_raw=" / ".join(x for x in [f"형태 {kind}", f"기능 {func}" if func else None,
                                                                 f"정수방식 {cell(lines, '정수방식')}" if cell(lines, "정수방식") else None,
                                                                 f"목록 '{title[:60]}'"] if x))
        d, _ = K.dims_of(size_label, size, "wdh") if size else (None, None)
        K.put_dims(row, d, size)
        if faucet:
            row["install_notes"] = f"{faucet_label} {faucet} (상판 위 파우셋 — 본체는 싱크대 안)"
        rows.append(row)
        if sample and len(rows) >= sample:
            break
    return rows
