"""밀레 (Miele) 빌트인 · 빌트언더 와인셀러 — miele.co.kr (밀레코리아 공식 온라인 스토어). 2026-11-03 하부장 가전.

목록: 와인셀러 카테고리 두 개 — '빌트언더 와인셀러'(1015036) · '빌트인 와인셀러'(1015034). 한 쪽에 다 나온다 (2개 · 1개).
치수: 상품 페이지 SSR HTML 의 사양 표 (brands/miele.py 와 같은 표 — 도움 함수는 이 파일에 따로 둔다)
  외형   '기기 너비/높이/깊이(mm)' 낱칸 (묶음 '기기 치수(W x H x D)(mm)' 는 원문에만)
  니치   '최소/최대 설치 너비(mm)' · '최소/최대 설치 높이(mm)' · '설치 깊이(mm)'
  용량   '총 사용 가능 용량(L)' · 병 수 '0.75 l 보르도 병 기준(병 수량)'
빼는 것: 높이 950 넘는 컬럼(MasterCool KWT 2611 Vi · 2671 ViS, 2127) — 냉장고 수집기가 refrigerator/wine 으로 넣었다.
robots.txt (2026-11-03 읽음): /cart · *checkout* · *compare* · *logout* · /*/account/* · *&query=* · /pmedia/* … 만 막는다.
  /category/ · /product/ 허용. 403 이 나오면 멈춘다 (우회하지 않는다).
"""
import html
import re
import sys

BRAND_KEY = "miele_wine"
K = None   # collect.py 가 넘긴다

MC = "https://www.miele.co.kr"
# (카테고리 경로, 세부 구분, 한글 이름) — 메뉴가 세부 구분을 정한다
CATS = [
    ("1015036/built-under-wine-units", "under_counter", "빌트언더 와인셀러"),
    ("1015034/built-in-wine-units", "built_in", "빌트인 와인셀러"),
]
MAX_H = 950   # 이보다 높으면 하부장 칸이 아니다 (키큰 컬럼 — 냉장고 수집기 몫)


def spec_table(h):
    """→ [(이름, 값)] 표 순서 그대로 (brands/miele.py 와 같은 읽기)."""
    out = []
    for m in re.finditer(r'<span id="[^"]*-label-\d+"[^>]*>(.*?)</span>.*?<dd class="table__value"[^>]*>(.*?)</dd>', h, re.S):
        k = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", m.group(1)))).strip()
        v = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", m.group(2)))).strip()
        if v == "로딩 중...":   # 체크 아이콘 칸 (값이 그림) — 이름만 남는 표시 칸
            v = ""
        out.append((k, v))
    return out


def first(spec, *names):
    for n in names:
        for k, v in spec:
            if k == n and v:
                return v
    return None


def mm(v):
    m = re.search(r"\d+(?:[.,]\d+)?", v or "")
    return int(round(float(m.group(0).replace(",", ".")))) if m else None


def image_of(h):
    m = re.search(r'"primaryImageOfPage":\{"@type":"ImageObject","url":"([^"]+)"', h)
    if m:
        return m.group(1)
    m = re.search(r'https://media\.miele\.com/dam/[^"\s?]+\.(?:png|jpg|webp)', h)
    return m.group(0) if m else None


def availability(h):
    m = re.search(r'"availability":"https://schema\.org/(\w+)"', h)
    return m.group(1) if m else None


def discover(f):
    """→ [(path, 세부 구분, 한글 이름)] — 앞 카테고리가 먼저 (한 제품이 두 곳에 걸리면 첫 것)."""
    found = {}
    for cat, sub, kname in CATS:
        st, h = f.get(f"{MC}/category/{cat}")
        if st == 403:
            raise PermissionError(f"miele.co.kr 403 — 우회하지 않고 멈춘다: {cat}")
        links = list(dict.fromkeys(re.findall(r'href="(/product/\d+/[^"?#]+)"', h))) if st == 200 else []
        print(f"[miele_wine] category {cat}: {len(links)}", file=sys.stderr)
        for p in links:
            found.setdefault(p, (sub, kname))
    return [(p, s, k) for p, (s, k) in found.items()]


def collect(f, K_, sample=None):
    global K
    K = K_
    rows = []
    items = discover(f)
    if sample:
        items = items[:sample]
    for path, sub, kname in items:
        url = MC + path
        st, h = f.get(url)
        if st == 403:
            print(f"[miele_wine] 403 — 우회하지 않고 멈춘다: {url}", file=sys.stderr)
            break
        if st != 200:
            print(f"[miele_wine] {st} {url} — 건너뜀", file=sys.stderr)
            continue
        spec = spec_table(h)
        code = first(spec, "모델 식별 코드")
        w, hh, d = mm(first(spec, "기기 너비(mm)")), mm(first(spec, "기기 높이(mm)")), mm(first(spec, "기기 깊이(mm)"))
        if hh and hh > MAX_H:
            print(f"[miele_wine] {code}: 높이 {hh} > {MAX_H} — 키큰 컬럼이라 뺀다 (냉장고 wine)", file=sys.stderr)
            continue
        t = re.search(r"<title>Miele - (.*?) – ([^<]*)</title>", h)
        title = html.unescape(t.group(1)).strip() if t else (code or path)
        bottles = mm(first(spec, "0.75 l 보르도 병 기준(병 수량)"))
        num4 = re.search(r"(?<!\d)(\d)\d{3}(?!\d)", code or "")
        row = K.base_row(brand="밀레", category="wine_cellar", category_subtype=sub, install_type="built_in",
                         model_name=f"{kname} {bottles}병 {title}" if bottles else f"{kname} {title}",
                         model_codes=[code] if code else [],
                         line="Generation 7000" if num4 and num4.group(1) == "7" else "일반",
                         source_url=url, page_url=url, image_source_url=image_of(h), sale_status=availability(h))
        combo = first(spec, "기기 치수(W x H x D)(mm)")
        dd = {"w": (w, w), "h": (hh, hh), "d": (d, d)} if None not in (w, hh, d) else None
        if not dd and combo:   # 낱칸이 없으면 이름에 순서가 적힌 묶음 칸
            dd, _ = K.dims_of("(W x H x D)", combo, "")
        K.put_dims(row, dd, f"너비 {w} · 높이 {hh} · 깊이 {d} (mm)" + (f" / 기기 치수(W x H x D)(mm) = {combo}" if combo else ""))
        # 니치 — 최소/최대 설치 너비 · 높이, 설치 깊이 (한 값이면 min 만)
        bits = []
        for ax, lo_n, hi_n in (("w", "최소 설치 너비(mm)", "최대 설치 너비(mm)"), ("h", "최소 설치 높이(mm)", "최대 설치 높이(mm)"),
                               ("d", "최소 설치 깊이(mm)", "최대 설치 깊이(mm)")):
            lo, hi = mm(first(spec, lo_n)), mm(first(spec, hi_n))
            if ax == "d" and lo is None:
                lo = mm(first(spec, "설치 깊이(mm)"))
            if lo is not None:
                row[f"niche_min_{ax}_mm"] = lo
            if hi is not None and hi != lo:
                row[f"niche_max_{ax}_mm"] = hi
        bits = [f"{k} = {v}" for k, v in spec if v and k.startswith(("최소 설치", "최대 설치", "설치 깊이"))]
        row["niche_raw"] = " · ".join(dict.fromkeys(bits)) or None
        cap = first(spec, "총 사용 가능 용량(L)", "와인칸(l)")
        row["capacity_l"] = mm(cap)
        notes = []
        if row.get("niche_min_d_mm") and d and row["niche_min_d_mm"] < d:
            notes.append(f"설치 깊이 {row['niche_min_d_mm']} < 기기 깊이 {d} — 사이트 값 그대로 (도어 · 앞판이 장 앞으로 나오는지 설치설명서 확인)")
        for k in ("도어 힌지", "도어 경첩 기술", "매립형 도어 오프너", "온도구역 수"):
            v = first(spec, k)
            if v:
                notes.append(f"{k} {v}")
        row["install_notes"] = " · ".join(notes) or None
        flags = [k for k, v in spec if k in ("빌트인 제품", "완전빌트인 제품", "빌트언더 제품", "양문 설치 가능", "방향전환 가능 도어 경첩") and not v]
        row["product_type_raw"] = " / ".join(x for x in [
            f"밀레 메뉴 {kname}", " · ".join(dict.fromkeys(flags)) or None, f"보르도 {bottles}병" if bottles else None,
            f"총 사용 가능 용량 {cap} L" if cap else None, (lambda n: n and f"자재번호 {n}")(first(spec, "제조사 제품 번호"))] if x)
        rows.append(row)
    return rows
