"""가게나우 (Gaggenau, BSH) 빌트인 · 언더카운터 와인셀러 — 2026-11-03 하부장 가전.

  국내 판매  공식 수입사 ㈜화인어프라이언스 (fineappliances.co.kr) '와인냉장고' 목록 wine_list.php → 상세 wine_view*.php
             '제품 스펙' (제품 규격 '597x818~868x575 (WxHxD)' · 내부용량 '34병 (750ml기준)'). 2종 — RW466-964 (높이 2029,
             키큰 컬럼이라 뺀다) · RW404-261 (언더카운터).
  글로벌     가게나우 글로벌 사이트맵의 /global/en/mkt-product/wine-climate-cabinets/… 제품 페이지 JSON-LD additionalProperty
             'Dimensions (HxWxD)' · 'Niche dimensions (HxWxD)' · 'Installation' · 병 수. 수입사 목록에 없으니 모두 '국내판매미확인',
             line 끝에 ' (글로벌)' (brands/gaggenau.py 와 같은 규칙).
  빼는 것    높이 950 넘는 컬럼 (Vario 400 · Expressive · RW222 · RW282) — 냉장고 수집기가 refrigerator/wine 으로 넣었다.

robots.txt (2026-11-03): fineappliances.co.kr 없음(404 → 허용). gaggenau.com 은 /*ajax/ · /productdrawings/ · /manual/ ·
  /*/comparison/ · /*/search/ … 를 막고 /global/en/mkt-product/ 는 허용. Fetcher 로만 (1.2초 · 캐시). 치수도 그림은 받지 않는다.
"""
import json
import re
import sys

BRAND_KEY = "gaggenau_wine"
K = None   # collect.py 가 넘긴다

BRAND = "가게나우"
FA = "https://www.fineappliances.co.kr"
GG = "https://www.gaggenau.com"
MAX_H = 950


def bsh_page(h):
    """제품 페이지 → {name, mpn, avail, props{이름: (값, 단위)}, images} (brands/gaggenau.py bsh_page 의 JSON-LD 부분)."""
    out = {"name": None, "mpn": None, "avail": None, "props": {}, "images": []}
    for m in re.finditer(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', h, re.S):
        try:
            d = json.loads(m.group(1))
        except ValueError:
            continue
        if d.get("@type") != "Product":
            continue
        out["name"], out["mpn"] = (d.get("name") or "").strip(), d.get("mpn")
        out["avail"] = ((d.get("offers") or {}).get("availability") or "").rsplit("/", 1)[-1] or None
        out["images"] = [i for i in (d.get("image") or []) if isinstance(i, str)]
        for p in d.get("additionalProperty") or []:
            if p.get("name"):
                out["props"][p["name"].strip()] = (str(p.get("value") or "").strip(), (p.get("unitText") or "").strip())
        break
    return out


def prop(p, *names):
    for n in names:
        if n in p["props"]:
            return p["props"][n][0]
    return None


def hwd(value):
    """'818x597x570' · '1220.0 x 560.0 x 550.0' (HxWxD) → {'w':(lo,hi), …}."""
    d, _ = K.dims_of("(HxWxD)", (value or "").replace(" ", ""), "hwd")
    return d


def pick_image(p, code):
    """Product_Shots 중 모델 코드가 든 제품 사진 → 제품 사진 → 첫 장 (연출 · 문 열림은 뒤로)."""
    shots = [u for u in p["images"] if "/Product_Shots/" in u]
    if not shots:
        return None
    bad = lambda u: re.search(r"(?i)open|_IS_|_DS_|\d(?:IS|DS|SHS|PHS)\d|PGA|Inspiration|Detail", u)  # noqa
    good = [u for u in shots if not bad(u)]
    stem = re.sub(r"\d{3}[A-Z]?$", "", code)[:6]
    return next((u for u in good if stem in u), None) or (good or shots)[0]


def fa_specs(text):
    """상세 '제품 스펙' 칸 → {이름: 값}."""
    i, j = text.find("제품 스펙"), text.find("상세기능")
    if i < 0:
        return {}
    lines = [x.strip() for x in text[i + 5:j if j > i else None].splitlines() if x.strip()]
    keys = ("정격소비 전력", "제품 규격", "내부용량", "도어방향", "설치타공치수", "정격소비전압")
    out, k = {}, None
    for x in lines:
        if x in keys:
            k = x
        elif k:
            out[k] = x
            k = None
    return out


def fa_rows(f):
    st, h = f.get(f"{FA}/wine_list.php")
    if st != 200:
        print(f"[gaggenau_wine] 수입사 목록 status={st}", file=sys.stderr)
        return []
    # 목록 칸: <p class="text-gray">400Series</p> <p …>Wine Climate Cabinet</p> <p class="item_box_tit">RW404-261 </p> … href="./wine_view2.php" … <img src="./img/wine_t2_1.jpg">
    items = re.findall(r'(?s)<p class="text-gray">([^<]*)</p>\s*<p[^>]*item_box_txt[^>]*>([^<]*)</p>\s*<p class="item_box_tit">([^<]*)</p>'
                       r'.*?href="\./(wine_view\d*\.php)".*?<img src="\./([^"]+)"', h)
    rows = []
    for series, kind, code_kr, view, img in items:
        code_kr = code_kr.strip().replace(" ", "")
        u = f"{FA}/{view}"
        st, vh = f.get(u)
        if st != 200:
            continue
        t = "\n".join(x.strip() for x in K.F.html_to_text(re.sub(r"(?s)<!--.*?-->", " ", vh)).splitlines() if x.strip())
        if code_kr not in t:
            print(f"[gaggenau_wine] {u}: 목록 코드 {code_kr} 가 상세에 없다 — 건너뜀", file=sys.stderr)
            continue
        sp = fa_specs(t)
        size = sp.get("제품 규격")
        d, _ = K.dims_of("(WxHxD)", size, "whd") if size else (None, None)
        if d and d["h"][0] > MAX_H:
            print(f"[gaggenau_wine] {code_kr}: 높이 {d['h'][0]} > {MAX_H} — 키큰 컬럼이라 뺀다 (냉장고 wine)", file=sys.stderr)
            continue
        bottles = re.search(r"(\d+)\s*병", sp.get("내부용량") or "")
        line = series.strip().replace("Series", " 시리즈")
        row = K.base_row(brand=BRAND, category="wine_cellar", category_subtype="under_counter", install_type="built_in",
                         model_name=f"가게나우 {kind.strip()}" + (f" {bottles.group(1)}병" if bottles else ""),
                         model_codes=[code_kr, code_kr.replace("-", "")], line=line, source_url=u, page_url=u,
                         image_source_url=f"{FA}/{img}")
        K.put_dims(row, d, f"수입사 제품 규격 {size}" if size else None)
        notes = []
        if "빌트인 구조" in t:
            notes.append("수입사 상세: '주방과의 일체감을 극대화하는 빌트인 구조'")
        if sp.get("정격소비 전력"):
            notes.append(f"정격소비 전력 {sp['정격소비 전력']}")
        row["install_notes"] = " · ".join(notes) or None
        row["product_type_raw"] = " / ".join(x for x in [
            f"수입사: 와인냉장고 · {series.strip()} {kind.strip()}", f"내부용량 {sp.get('내부용량')}" if sp.get("내부용량") else None,
            f"세부 구분 언더카운터 — 높이 {d['h'][0]}~{d['h'][1]} (상판 아래 칸) · 수입사 '빌트인 구조'" if d else None,
            "니치(설치 공간)는 수입사 '도면 이미지'(그림)에만 있어 비움"] if x)
        rows.append(row)
    return rows


def gg_global(f):
    st, xml = f.get(f"{GG}/global/sitemap.xml")
    out, seen = [], set()
    for u in re.findall(r"<loc>([^<]+)</loc>", xml or ""):
        m = re.match(rf"{re.escape(GG)}/global/en/mkt-product/(wine-climate-cabinets/[^/]+)/(R[A-Z]{{1,2}}\d{{6}})$", u)
        if m and m.group(2) not in seen:
            seen.add(m.group(2))
            out.append((m.group(2), u, m.group(1)))
    return out


def global_rows(f, have_codes, sample=None):
    rows = []
    items = gg_global(f)
    print(f"[gaggenau_wine] 글로벌 와인 제품 {len(items)}", file=sys.stderr)
    for code, url, path in items[:sample] if sample else items:
        if code in have_codes:
            continue
        st, h = f.get(url)
        if st != 200:
            print(f"[gaggenau_wine] {st} {url} — 건너뜀", file=sys.stderr)
            continue
        p = bsh_page(h)
        dv = prop(p, "Dimensions (HxWxD)", "Dimensions")
        d = hwd(dv) if dv else None
        if d and d["h"][0] > MAX_H:
            print(f"[gaggenau_wine] {code}: 높이 {d['h'][0]} > {MAX_H} — 키큰 컬럼이라 뺀다 (냉장고 wine)", file=sys.stderr)
            continue
        inst = prop(p, "Installation") or ""
        sub = "under_counter" if "under-counter" in inst.lower() else "built_in" if re.search(r"(?i)integrated|built-in", inst) else None
        bottles = prop(p, "Maximum number of 0.75 l standard wine bottles")
        series = "200 시리즈" if "200" in path else "400 시리즈" if "400" in path else "Expressive" if "expressive" in path else "기타"
        row = K.base_row(brand=BRAND, category="wine_cellar", category_subtype=sub, install_type="built_in",
                         model_name=f"가게나우 {p['name'] or code}" + (f" {bottles}병" if bottles else ""), model_codes=[code],
                         line=series + " (글로벌)", source_url=url, page_url=url, image_source_url=pick_image(p, code),
                         sale_status=p["avail"], tags=["국내판매미확인"])
        K.put_dims(row, d, f"Dimensions (HxWxD) {dv} mm (gaggenau.com/global)" if dv else None)
        nv = prop(p, "Niche dimensions (HxWxD)")
        nd = hwd(nv) if nv else None
        if nd:
            for ax in "whd":
                row[f"niche_min_{ax}_mm"] = nd[ax][0]
                if nd[ax][1] != nd[ax][0]:
                    row[f"niche_max_{ax}_mm"] = nd[ax][1]
            row["niche_raw"] = f"Niche dimensions (HxWxD) {nv} mm (gaggenau.com/global)"
        notes = [f"{n} {prop(p, n)}" for n in ("Door hinge", "Opening door assist", "Number of bottle trays") if prop(p, n)]
        row["install_notes"] = " · ".join(notes) or None
        row["product_type_raw"] = " / ".join(x for x in [f"글로벌: {path}", f"Installation {inst}" if inst else None,
                                                         f"0.75 l 병 {bottles}" if bottles else None] if x)
        rows.append(row)
    return rows


def collect(f, K_, sample=None):
    global K
    K = K_
    rows = fa_rows(f)
    have = {c for r in rows for c in r["model_codes"]}
    rows += global_rows(f, have, sample)
    return rows
