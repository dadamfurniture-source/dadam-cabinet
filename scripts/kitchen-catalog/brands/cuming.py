"""현대큐밍(현대렌탈케어) 하부장 가전 — 언더싱크 정수기 (다이렉트몰 hdquming.com). (2026-11-03)

현대렌탈케어 회사 사이트(hyundairentalcare.co.kr)의 제품 메뉴는 다이렉트몰 www.hdquming.com 으로 이어진다 (카페24).
목록: /product/list.html?cate_no=53 (정수기) 쪽마다 — 이름에 '언더싱크' · '빌트인' 이 든 상품만 연다.
상세: /product/detail.html?product_no=… '제품사양' 표 — `제품타입 | 언더싱크형 정수기 (무전원 직수형 정수기)` ·
      `제품 크기 | 85x198x270mm(WxDxH)` (값 뒤 (WxDxH) 로 순서를 읽는다) · 기본 정보 `모델 | HQPU10UW0E`.
robots.txt (www.hdquming.com): /admin · /api · /exec/front/ · /member/ · /myshop/ · 게시판 쪽 넘김 등만 막는다 — 목록 · 상세 허용.
음식물처리기(cate_no=104): '에코업 음식물처리기' 1개뿐, 이름에 싱크대 설치 표시가 없어 넣지 않는다.
"""
import html
import re
import sys

BRAND_KEY = "cuming"
K = None   # collect.py 가 넘긴다

HQ = "https://www.hdquming.com"
UNDER = re.compile(r"언더싱크|빌트인")


def text_lines(h):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", h, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", t))
    t = re.sub(r"[ \t\r]+", " ", t)
    return [x.strip() for x in t.split("\n") if x.strip()]


def cell(lines, label, start=0):
    for i in range(start, len(lines) - 1):
        if lines[i] == label:
            return lines[i + 1]
    return None


def list_items(f):
    out = []
    for page in range(1, 10):
        url = f"{HQ}/product/list.html?cate_no=53" + (f"&page={page}" if page > 1 else "")
        st, h = f.get(url)
        got = 0
        for m in re.finditer(r'<li[^>]+id="anchorBoxId_(\d+)".*?</li>', h if st == 200 else "", re.S):
            pn = m.group(1)
            name = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", m.group(0)))).strip()   # 칸 글 전체 (상품명 · 값)
            if all(pn != o[0] for o in out):
                out.append((pn, name))
                got += 1
        if not got:
            break
    return out


def subtype_of(kind):
    s = kind or ""
    cold, hot = "냉" in s, bool(re.search(r"온수|냉온|온정", s))
    return "hot_cold" if cold and hot else "cold" if cold else "hot" if hot else "purify"


def collect(f, K_, sample=None):
    global K
    K = K_
    items = list_items(f)
    picks = [(pn, n) for pn, n in items if UNDER.search(n)]
    print(f"[cuming] 정수기 {len(items)} · 언더싱크 · 빌트인 {len(picks)}", file=sys.stderr)
    rows = []
    for pn, list_name in picks:
        url = f"{HQ}/product/detail.html?product_no={pn}"
        st, h = f.get(url)
        if st != 200:
            continue
        lines = text_lines(h)
        spec_at = lines.index("제품사양") if "제품사양" in lines else 0
        kind = cell(lines, "제품타입", spec_at)
        size = cell(lines, "제품 크기", spec_at)
        mdl = cell(lines, "모델")
        name = cell(lines, "상품명") or list_name
        img = re.search(r'og:image" content="([^"]+)"', h)
        if not kind or "언더싱크" not in kind:
            continue
        m = re.search(r"\(([WDH])\s*x\s*([WDH])\s*x\s*([WDH])\)", size or "", re.I)
        label = f"({m.group(1)} x {m.group(2)} x {m.group(3)})" if m else None
        row = K.base_row(brand="현대큐밍", category="water_purifier", category_subtype=subtype_of(kind), install_type="built_in",
                         model_name=name, model_codes=[mdl] if mdl else [], line="딜라이트" if "딜라이트" in name else None,
                         source_url=url, page_url=url, image_source_url=img.group(1) if img else None,
                         product_type_raw=" / ".join(x for x in [f"제품타입 {kind}", f"정수 방식 {cell(lines, '정수 방식', spec_at)}"
                                                                 if cell(lines, "정수 방식", spec_at) else None] if x))
        d, _ = K.dims_of(label, re.sub(r"\([WDH]x[WDH]x[WDH]\)", "", size or "", flags=re.I), "wdh") if size else (None, None)
        if size and not label:
            row["tags"].append("치수순서추정")
        K.put_dims(row, d, size)
        rows.append(row)
        if sample and len(rows) >= sample:
            break
    return rows
