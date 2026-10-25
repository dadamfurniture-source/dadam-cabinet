"""일렉트로룩스 (Electrolux) 주방가전 — www.electrolux.co.kr (한국 법인 공식 몰). 2026-10-25

목록: 사이트맵(sitemap.xml)의 /appliances/(ovens|hobs|kitchen-hoods|dishwashers)/<코드>/ + 같은 메뉴 페이지의 제품 링크.
      단종 페이지도 사이트맵에 남아 있다 — 페이지 schema.org availability (InStock · Discontinued) 를 sale_status 에 둔다.
치수: 상품 페이지 '기술사양' — 'Size W x D x H, mm' (칸 이름 = 순서) · '제품 크기' 너비 · 깊이 · 높이 · 타공 너비 · 타공 깊이.
      '개방 시 너비 · 폭 · 높이' 는 빌트인(설치 공간) 값의 번역이다 (KOBAS31X 560 · 550 · 600 = 설명서 캐비닛 너비 · 깊이 ·
      작업대 하부 높이) → 설명서 값이 있으면 그것을 쓰고, 없으면 이 값을 설치 공간으로 둔다.
보충: 단종 모델 중 페이지에 사양이 없는 것 · 오븐 설치 공간 · 타공 모서리 R 은 공식 PDF(사용설명서 · Dimension Guide) 값
      → manual/electrolux.json (글자 = '매뉴얼', 그림 = '이미지판독').
robots.txt: /appliances/ 허용 (막는 곳은 /my-account · /login · /util 등).
"""
import json
import os
import re
import sys

BRAND_KEY = "electrolux"
K = None   # collect.py 가 넘긴다 (split_dims · dims_of · base_row · put_dims · F …)

EX = "https://www.electrolux.co.kr"
BRAND = "일렉트로룩스"
MENUS = {"ovens": "oven", "hobs": "cooktop", "kitchen-hoods": "hood", "dishwashers": "dishwasher"}
MANUAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "manual", "electrolux.json")


def T(s):
    return re.sub(r"\s+", " ", K.F.html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def product_paths(f):
    st, x = f.get(EX + "/sitemap.xml")
    out = []
    pat = r"/appliances/(?:%s)/[a-z0-9-]+/" % "|".join(MENUS)
    for u in re.findall(r"<loc>([^<]+)</loc>", x):
        m = re.search(pat + "$", u)
        if m and m.group(0) not in out:
            out.append(m.group(0))
    for menu in MENUS:
        st, h = f.get(f"{EX}/appliances/{menu}/")
        for p in re.findall(r'href="(/appliances/%s/[a-z0-9-]+/)"' % menu, h):
            if p not in out:
                out.append(p)
    return out


def spec_of(h):
    """'기술사양' 블록 → (요약 {이름: 값}, {머리: [(이름, 값)]})."""
    i = h.find('data-id="specifications"')
    seg = h[i:h.find("</ul>", i)] if i > 0 else ""
    summary = {T(a): T(b) for a, b in re.findall(r'(?s)<span class="label">(.*?)</span>\s*<span class="value">(.*?)</span>', seg)}
    groups = {}
    for col in re.findall(r'(?s)<div class="spec-column">(.*?)(?=<div class="spec-column">|$)', seg):
        h4 = re.search(r"(?s)<h4>(.*?)</h4>", col)
        rows = []
        for r in re.findall(r'(?s)<div class="spec-row[^"]*"[^>]*>(.*?)</div>', col):
            t = T(r)
            if ":" in t:
                k, v = t.split(":", 1)
                rows.append((k.strip(), v.strip()))
        groups[T(h4.group(1)) if h4 else ""] = rows
    return summary, groups


def manual():
    if not os.path.exists(MANUAL):
        return {}
    with open(MANUAL, encoding="utf-8") as fp:
        return json.load(fp).get("models", {})


def classify(menu, name, gen, steam=False):
    """→ (category, subtype, install_type) 또는 건너뛸 이유 문자열."""
    kind = " ".join(v for k, v in gen if "종류" in k or "유형" in k or "타입" in k)
    if menu == "ovens":
        if "워밍" in name or "드로어" in name:
            return "워밍 드로어 (오븐 · 전자레인지 아님)"
        if "전자레인지" in name or "전자 레인지" in name:
            return ("microwave", "solo", "freestanding") if "스탠드" in name else ("microwave", None, None)
        if "콤비" in name:
            return "oven", "combi", "built_in"
        if steam:                       # KOBAS31X — 페이지 '스팀부스트' · 설명서 표지 '스팀 오븐'
            return "oven", "steam_oven", "built_in"
        return "oven", "oven", "built_in"
    if menu == "hobs":
        return "cooktop", "induction" if ("인덕션" in name + kind) else None, "built_in"
    if menu == "kitchen-hoods":
        sub = "island" if "아일랜드" in name + kind else ("chimney" if "침니" in name + kind else None)
        return "hood", sub, None
    if menu == "dishwashers":            # 페이지가 설치 방식을 적지 않으면 비운다 (ESF7552ROX '설치 타입: 식기세척기')
        if "프리스탠딩" in kind:
            return "dishwasher", "freestanding", "freestanding"
        if "빌트인" in kind:
            return "dishwasher", "built_in", "built_in"
        return "dishwasher", None, None
    return "메뉴 밖"


def line_of(name):
    m = re.search(r"UltimateTaste \d+|UltimateCare \d+|얼티밋케어 \d+|프리미엄 식기세척기 \d+", name)
    return m.group(0).replace("얼티밋케어", "UltimateCare") if m else "일반"


def collect(f, K_, sample=None):
    global K
    K = K_
    man = manual()
    paths = product_paths(f)
    print(f"[electrolux] kitchen product pages={len(paths)}", file=sys.stderr)
    rows, skipped, per_cat = [], [], {}
    for path in paths:
        menu = path.split("/")[2]
        if sample and per_cat.get(menu, 0) >= sample:
            continue
        page = EX + path
        st, h = f.get(page)
        if st != 200:
            skipped.append(f"{path} (status {st})")
            continue
        per_cat[menu] = per_cat.get(menu, 0) + 1
        sku = re.search(r'"sku"\s*:\s*"([^"]+)"', h)
        code = (sku.group(1) if sku else path.rstrip("/").rsplit("/", 1)[-1]).upper()
        h1 = re.search(r"(?s)<h1[^>]*>(.*?)</h1>", h)
        name = T(h1.group(1)) if h1 else code
        avail = re.search(r'"availability"\s*:\s*"https?://schema\.org/(\w+)"', h)
        summary, groups = spec_of(h)
        gen = groups.get("일반정보", [])
        size_rows = groups.get("제품 크기", [])
        c = classify(menu, name, gen, steam=bool(re.search(r"스팀부스트|SteamBoost|스팀 오븐", T(h[:h.find('data-id="specifications"')]))))
        if isinstance(c, str):
            skipped.append(f"{code} {name} ({c})")
            continue
        cat, sub, inst = c
        og = re.search(r'<meta property="og:image" content="([^"?]+)', h)
        row = K.base_row(brand=BRAND, category=cat, category_subtype=sub, install_type=inst, model_name=f"일렉트로룩스 {name}",
                         model_codes=[code], line=line_of(name), source_url=page, page_url=page,
                         image_source_url=K.F.abs_url(og.group(1), EX) if og else None,
                         sale_status=avail.group(1) if avail else None,
                         product_type_raw=" / ".join(f"{k}: {v}" for k, v in gen
                                                     if re.search(r"종류|유형|타입|배기", k) and "화구" not in k) or None)
        sz = {k.replace(" ", ""): v for k, v in size_rows}

        def mmv(*keys):
            for k in keys:
                v = sz.get(k)
                if v:
                    return v
            return None
        sk = next((k for k in summary if "W x D x H" in k or "WxDxH" in k.replace(" ", "")), None)
        w, d, hgt = mmv("너비"), mmv("깊이"), mmv("높이")
        raw = None
        if w and d and hgt:
            raw = f"너비 {w} · 깊이 {d} · 높이 {hgt}"
            dims, _ = K.dims_of("(W x D x H)", f"{w} x {d} x {hgt}".replace("mm", "").replace("-", "~"), "wdh")
        elif sk:
            raw = f"{sk} {summary[sk]}"
            dims, _ = K.dims_of(sk, summary[sk].replace("-", "~"), "wdh")
        else:
            dims = None
        if dims or code not in man:
            K.put_dims(row, dims, raw)
        cw, cd = mmv("타공너비"), mmv("타공깊이")
        if cat == "cooktop" and cw and cd:
            row["cutout_w_mm"], row["cutout_d_mm"] = K.F.first_num(cw), K.F.first_num(cd)
            row["cutout_raw"] = f"타공 너비 {cw} · 타공 깊이 {cd}"
        nw, nd, nh = mmv("개방시너비"), mmv("개방시폭"), mmv("개방시높이")
        niche_page = f"상품 페이지 '개방 시' 너비 {nw} · 폭 {nd} · 높이 {nh}" if (nw and nd and nh) else None
        capv = " ".join(v for k, v in gen if "용량" in k)
        if cat == "dishwasher":
            row["place_count"] = K.F.first_num(capv)
        elif capv:
            row["capacity_l"] = K.F.first_num(capv)
        hob_gap = [f"{k} {v}" for k, v in size_rows if "간격" in k]
        if hob_gap:
            row["install_notes"] = " · ".join(dict.fromkeys(hob_gap))
        m = man.get(code)
        if m:
            used = False
            if row["width_mm"] is None and m.get("dims"):
                md = m["dims"]
                K.put_dims(row, {a: (md[a], md[a]) for a in "whd"}, md.get("raw"))
                used = True
            for k, v in m.items():
                if k in ("tag", "source", "dims") or v is None:
                    continue
                if k in ("install_notes", "niche_raw", "cutout_raw", "size_raw"):
                    row[k] = " | ".join(x for x in (row.get(k), v) if x)
                    continue
                if row.get(k) is None:
                    row[k] = v
                    used = True
            if used and m.get("tag") and m["tag"] not in row["tags"]:
                row["tags"].append(m["tag"])
            if m.get("source"):
                row["install_notes"] = " | ".join(x for x in (row.get("install_notes"), "근거: " + m["source"]) if x)
        if niche_page:
            if row["niche_min_w_mm"] is None:
                row["niche_min_w_mm"], row["niche_min_d_mm"], row["niche_min_h_mm"] = (K.F.first_num(nw), K.F.first_num(nd),
                                                                                          K.F.first_num(nh))
            row["niche_raw"] = " | ".join(x for x in (row.get("niche_raw"), niche_page) if x)
        if row["width_mm"] is None:
            skipped.append(f"{code} {name} (페이지 · 공식 PDF 모두 치수 없음)")
            continue
        rows.append(row)
    for s in skipped:
        print(f"  [electrolux] skipped: {s}", file=sys.stderr)
    return rows
