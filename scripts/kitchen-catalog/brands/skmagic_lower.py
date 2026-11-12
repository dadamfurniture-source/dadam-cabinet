"""SK매직 하부장 가전 — 언더싱크 정수기 (skmagic.com 정수기 목록 → 상품 페이지 '기본사양'). (2026-11-03)

목록: 정수기 메뉴(dispClsfNo=100000005)가 부르는 POST /goods/indexSubGoodsList (rows 를 크게 한 번).
      이름에 '언더싱크' · '빌트인' 이 든 상품만 연다 (나머지는 데스크형 · 스탠드형).
치수: 상품 페이지 '기본사양' 표 `크기(mm) | 265(W) X 105(D) X 355(H)` — 값의 (W) · (D) · (H) 표시로 순서를 읽는다.
구분: 같은 표 '주요스펙' 의 냉수 · 온수 O/X → purify(정수만) · cold · hot · hot_cold.
음식물처리기: skmagic.com 판매 메뉴에 없다 (정수기 · 공기청정기 · 비데 · 매트리스뿐) — 행 없음.
robots.txt (www.skmagic.com): `User-agent: *` `Disallow:` (모두 허용).
"""
import html
import re
import sys

BRAND_KEY = "skmagic_lower"
K = None   # collect.py 가 넘긴다

SK = "https://www.skmagic.com"
LIST_FORM = {"dispClsfNo": "100000005", "menuNo": "1001", "page": "1", "rows": "100"}   # 빈 거름 칸은 보내지 않아도 같은 목록
UNDER = re.compile(r"언더싱크|빌트인")


def text_of(h):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", h, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", t))
    t = re.sub(r"[ \t\r]+", " ", t)
    return [x.strip() for x in t.split("\n") if x.strip()]


def cell(lines, label):
    """표 '이름 | 값' — 이름 다음 줄 값."""
    for i, x in enumerate(lines[:-1]):
        if x == label:
            return lines[i + 1]
    return None


def list_items(f):
    st, h = f.post_form(SK + "/goods/indexSubGoodsList", LIST_FORM)
    out = []
    if st != 200:
        return out
    blocks = re.split(r'(?=<li[^>]*data-compare-goods-id=")', h)[1:]   # 상품 칸마다 (칸 안에 다른 li 가 있어 </li> 로 자르지 않는다)
    for b in blocks:
        m = re.match(r'<li[^>]*data-compare-goods-id="(G\d+)"[^>]*data-compare-product="([^"]+)"', b)
        if not m:
            continue
        gid, code, body = m.group(1), m.group(2), b
        nm = re.search(r'class="item-name02">.*?<a[^>]*>(.*?)</a>', body, re.S)
        bn = re.search(r'class="item-benefit02">(.*?)</div>', body, re.S)
        name = html.unescape(re.sub(r"\s+", " ", nm.group(1))).strip() if nm else ""
        benefit = html.unescape(re.sub(r"\s+", " ", bn.group(1))).strip() if bn else ""
        if UNDER.search(name) and all(gid != o[0] for o in out):
            out.append((gid, code, name, benefit))
    return out


def subtype_of(lines):
    spec = lines[lines.index("주요스펙"):] if "주요스펙" in lines else []
    cold = (cell(spec, "냉수") or "").strip().upper() == "O"
    hot = (cell(spec, "온수") or "").strip().upper() == "O"
    return "hot_cold" if cold and hot else "cold" if cold else "hot" if hot else "purify"


def collect(f, K_, sample=None):
    global K
    K = K_
    items = list_items(f)
    print(f"[skmagic_lower] 정수기 목록에서 언더싱크 · 빌트인 {len(items)}", file=sys.stderr)
    rows, done = [], set()
    for gid, code, list_name, benefit in items:
        if code in done:
            continue
        url = f"{SK}/goods/indexGoodsDetail?goodsId={gid}"
        st, h = f.get(url)
        if st != 200:
            continue
        lines = text_of(h)
        mdl = cell(lines, "모델명") or code
        name = cell(lines, "상품명") or list_name
        size = cell(lines, "크기(mm)")
        img = re.search(r'og:image" content="([^"]+)"', h)
        row = K.base_row(brand="SK매직", category="water_purifier", category_subtype=subtype_of(lines), install_type="built_in",
                         model_name=re.sub(r"^\[[^\]]*\]\s*", "", name), model_codes=[mdl], line="언더싱크",
                         source_url=url, page_url=url, image_source_url=img.group(1) if img else None,
                         product_type_raw=" / ".join(x for x in ["정수기 > " + list_name, benefit, "정격전압 " + (cell(lines, "정격전압") or "-"),
                                                                 "직수 " + (cell(lines, "직수") or "-")] if x))
        marks = "".join(re.findall(r"\((W|D|H)\)", size or "", flags=re.I)).upper()
        label = f"({' x '.join(marks)})" if sorted(marks) == ["D", "H", "W"] else None
        d, _ = K.dims_of(label, size, "wdh") if size else (None, None)
        if size and not label:
            row["tags"].append("치수순서추정")
        K.put_dims(row, d, size)
        rows.append(row)
        done.add(code)
        if sample and len(rows) >= sample:
            break
    return rows
