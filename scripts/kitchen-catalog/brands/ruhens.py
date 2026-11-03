"""루헨스(원봉) 하부장 가전 — 언더싱크 정수기 (ruhens.co.kr). (2026-11-03)

목록: 정수기 화면(/product/water-purifier.php)의 거름 '언더싱크' 가 부르는 POST /product/_ajax.php
      (CCODE=000101 정수기, type02[]=언더싱크).
상세: /product/view.php?PNO=… '제품 규격' 표 `외형치수 | 310(W)×120(D)×400(H)㎜` — 값의 (W) · (D) · (H) 로 순서를 읽는다.
구분: 표 · 설명에 냉수 · 온수가 없으면 정수만(purify).
robots.txt: 없음 (404 → 허용).
"""
import html
import re
import sys

BRAND_KEY = "ruhens"
K = None   # collect.py 가 넘긴다

RH = "https://www.ruhens.co.kr"


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


def collect(f, K_, sample=None):
    global K
    K = K_
    st, h = f.post_form(RH + "/product/_ajax.php", {"CCODE": "000101", "type02[]": "언더싱크"})
    items = []
    for m in re.finditer(r'href=["\']([^"\']*view\.php\?PNO=(\d+))["\'][^>]*>(.*?)</a>', h if st == 200 else "", re.S):
        t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", m.group(3)))).strip()
        if m.group(2) not in [x[0] for x in items]:
            items.append((m.group(2), t))
    print(f"[ruhens] 언더싱크 {len(items)}", file=sys.stderr)
    rows = []
    for pno, list_text in items:
        url = f"{RH}/product/view.php?PNO={pno}"
        st, ph = f.get(url)
        if st != 200:
            continue
        lines = text_lines(ph)
        mdl = cell(lines, "모델명")
        size = cell(lines, "외형치수")
        name = cell(lines, "제품명") or "정수기"
        img = re.search(r'src=["\'](/FileData/product/[^"\']+\.(?:jpg|png))["\']', ph, re.I)
        body = "\n".join(lines)
        cold, hot = "냉수" in body, "온수" in body
        sub = "hot_cold" if cold and hot else "cold" if cold else "hot" if hot else "purify"
        row = K.base_row(brand="루헨스", category="water_purifier", category_subtype=sub, install_type="built_in",
                         model_name=f"{name} {mdl} (언더싱크)" if mdl else name, model_codes=[mdl] if mdl else [], line="언더싱크",
                         source_url=url, page_url=url, image_source_url=(RH + img.group(1)) if img else None,
                         product_type_raw=" / ".join(x for x in [f"목록 '{list_text[:60]}'", f"전원 {cell(lines, '전원')}" if cell(lines, "전원") else None,
                                                                 f"사용기준 {cell(lines, '사용기준')}" if cell(lines, "사용기준") else None] if x))
        marks = "".join(re.findall(r"\((W|D|H)\)", size or "", flags=re.I)).upper()
        label = f"({' x '.join(marks)})" if sorted(marks) == ["D", "H", "W"] else None
        d, _ = K.dims_of(label, size, "wdh") if size else (None, None)
        if size and not label:
            row["tags"].append("치수순서추정")
        K.put_dims(row, d, size)
        rows.append(row)
        if sample and len(rows) >= sample:
            break
    return rows
