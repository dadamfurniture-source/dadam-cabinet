"""스메그 (Smeg) 주방가전 — 공식 수입사 (주)제이컬렉션 = 스메그코리아 www.j-collection.co.kr. 2026-10-25

목록: 냉장고 수집기 sm_list 그대로 (GET product_list.php?cate= → 'MORE' 버튼 POST /product/product_proc.php).
      주방 메뉴: 오븐 16 · 인덕션 24 · 후드/오븐 일체형 인덕션 787 · 주방후드 31 · 식기세척기 28 · 오븐/1구인덕션 772 ·
      프로페셔널 소형오븐 203 (가정에서도 쓰는 60L 4단 카운터탑 오븐). 대형오븐 204 · 업소용 식기세척기 205 는 업소용이라 뺀다.
치수: 상세 product_view.php?pseq= 의 '상품 정보 고시' '크기, 용량, 형태' — 칸 순서는 원문 괄호 '(WxDxH)' · '(가로x세로x높이)'
      (세로 = 깊이)에서 읽는다. 고시 순서가 없거나 그 순서로 읽으면 종류별 범위(K.BOUNDS)를 벗어나면(쿡탑 깊이 50 등 — 고시 표기 오류):
        ① 같은 메뉴 수입사 페이지 비교표의 같은 세 숫자에 붙은 순서 '900x450x430mm(WxHxD)'
        ② 같은 모델 코드의 제조사 글로벌 페이지 smeg.com/products/<코드> 'Width / Depth / Product Height' (칸 이름이 있다)
        ③ 그래도 없으면 종류별 기본 순서 + '치수순서추정' (미검증)
      쿡탑 상판 타공 = 같은 코드 smeg.com 'Worktop Cut-Out' (예 '478-482x555-560 mm' — 외경보다 작게 들어가는 쪽이 가로/깊이).
설치 공간: 빌트인 오븐 · 식기세척기 = 공식 도면 그림을 눈으로 읽은 값 → manual/smeg.json (태그 '이미지판독', 미검증).
robots.txt: j-collection.co.kr 은 /product/ 허용, smeg.com 은 /products/ 허용. doc.smeg.it(설명서)는 robots.txt 가 모두 막아 쓰지 않는다.
"""
import json
import os
import re
import sys

BRAND_KEY = "smeg"
K = None   # collect.py 가 넘긴다 (split_dims · dims_of · base_row · put_dims · F …)

SM = "https://www.j-collection.co.kr"
GLOBAL = "https://www.smeg.com/products/{code}"
BRAND = "스메그"
CATES = {"16": "오븐", "24": "인덕션", "787": "후드/오븐 일체형 인덕션", "31": "주방후드", "28": "식기세척기",
         "772": "오븐/1구인덕션", "203": "프로페셔널 소형오븐"}
ACCESSORY = re.compile(r"트레이|인덕션프레임|프레임 */ *케이스|오븐랙|스텐랙|우드렉|바퀴|바구니|디바이더|DIY")   # '골드프레임' 후드는 본품
LINES = ("빅토리아", "리니아", "클래식", "돌체스틸노보", "옴니셰프", "레트로", "유니버설", "리얼스팀")
MANUAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "manual", "smeg.json")
TRIPLE = r"(\d{2,4}(?:[.,]\d)?)\s*[xX×*]\s*(\d{2,4}(?:[.,]\d)?)\s*[xX×*]\s*(\d{2,4}(?:[.,]\d)?)"
DEFAULT_ORDER = {"cooktop": "wdh", "hood": "whd", "oven": "wdh", "dishwasher": "wdh", "microwave": "wdh"}


def num(s):
    return float(str(s).replace(",", "."))


def order_from(text):
    """괄호 안 칸 이름 → 'wdh' 등. '(WxDxH)' · '( W x D x H )' · '(가로x세로x높이)' (세로 = 깊이, 높이가 따로 있을 때)."""
    for g in re.findall(r"\(([^()]*)\)", text or ""):
        toks = re.findall(r"가로|세로|높이|깊이|폭|W|H|D", g.upper())
        m = {"가로": "w", "폭": "w", "W": "w", "높이": "h", "H": "h", "깊이": "d", "D": "d",
             "세로": "d" if "높이" in g else "h"}
        seq = "".join(m[t] for t in toks)
        if len(seq) == 3 and sorted(seq) == ["d", "h", "w"]:
            return seq
    return None


def kr_page(f, seq):
    page = f"{SM}/product/product_view.php?pseq={seq}"
    st, h = f.get(page)
    h = re.sub(r"(?s)<!--.*?-->", "", h)      # 위쪽 '사이즈' 칸은 주석 처리돼 있다 — 고시 정보가 정본 (냉장고 수집기와 같다)
    t = re.search(r"<title>\s*스메그\s+(.*?)\s*\|", h)
    notice = {K.F.html.unescape(k).strip(): re.sub(r"\s+", " ", K.F.html.unescape(re.sub(r"<[^>]+>", " ", v))).strip()
              for k, v in re.findall(r'(?s)<li class="pro_info_li">\s*<div class="title">(.*?)</div>\s*'
                                     r'<div class="text">(.*?)</div>', h)}
    img = re.search(r'(?s)class="pro_view_swiper_single".*?<img src="([^"]+)"', h)
    text = K.F.html.unescape(re.sub(r"(?s)<script.*?</script>|<style.*?</style>", " ", h))
    lines = [re.sub(r"\s+", " ", x).strip() for x in re.sub(r"<[^>]+>", "\n", text).split("\n")]
    return {"page": page, "status": st, "html": h, "title": re.sub(r"\s+", " ", K.F.html.unescape(t.group(1))).strip() if t else None,
            "notice": notice, "img": K.F.abs_url(img.group(1), SM) if img else None, "lines": [x for x in lines if x]}


def labeled_triples(h):
    """수입사 페이지 비교표의 순서 붙은 세 숫자: '900x450x430mm(WxHxD)' · <th>사이즈<br>(WxDxH)</th><td>596x510x60mm</td>…"""
    out = []
    plain = K.F.html.unescape(re.sub(r"<[^>]+>", " ", h))
    for m in re.finditer(TRIPLE + r"\s*mm\s*(\([^)]*\))", plain):
        o = order_from(m.group(4))
        if o:
            out.append((tuple(num(x) for x in m.groups()[:3]), o))
    for tr in re.findall(r"(?s)<tr>(.*?)</tr>", h):
        th = re.search(r"(?s)<th[^>]*>(.*?)</th>", tr)
        o = order_from(K.F.html.unescape(re.sub(r"<[^>]+>", " ", th.group(1)))) if th else None
        if o:
            for td in re.findall(r"(?s)<td[^>]*>(.*?)</td>", tr):
                m = re.search(TRIPLE, td)
                if m:
                    out.append((tuple(num(x) for x in m.groups()), o))
    return out


def global_spec(f, code):
    """smeg.com/products/<코드> 의 'Width: 597 mm' · 'Depth (mm): 548 mm' · 'Product Height (mm): 592 mm' · 'Worktop Cut-Out: …'.
    같은 코드가 글로벌에 없으면 (KR 전용 코드 KSVV90… · ST2FABCRK2) None."""
    u = GLOBAL.format(code=code)
    st, h = f.get(u)
    if st != 200:
        return None
    t = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", " ", h)
    t = K.F.html.unescape(re.sub(r"<[^>]+>", "\n", t))
    t = re.sub(r"[ \t]+", " ", t)
    i, j = t.find(" Product code:"), t.find("You might also be interested")
    seg = re.sub(r"\n\s*\n+", "\n", t[i:j if j > i else None])
    kv = {}
    for m in re.finditer(r"\n\s*([^\n:]{2,60}):\s*\n\s*([^\n]{1,120})", seg):
        kv.setdefault(m.group(1).strip(), m.group(2).strip())

    def mm(*keys):
        for k in keys:
            if kv.get(k):
                x = re.match(r"([\d.,]+)\s*mm", kv[k])
                if x:
                    return num(x.group(1))
        return None
    g = {"url": u, "w": mm("Width", "Product Width", "Width (mm)"), "d": mm("Depth (mm)", "Depth", "Product Depth"),
         "h": mm("Product Height (mm)", "Product Height", "Height (mm)"), "cutout": kv.get("Worktop Cut-Out"),
         "hood_type": kv.get("Hood Type"), "method": kv.get("Cooking Method") or kv.get("Cooking method"),
         "family": kv.get("Product Family"), "cap": kv.get("Net volume of the cavity") or kv.get("Capacity"),
         "mw": "Microwave" in seg, "hob_elec": kv.get("Minimum distance from ELECTRIC hob"),
         "hob_gas": kv.get("Minimum distance from GAS hob")}
    return g


def resolve_dims(cat, key, size, pool, g):
    """→ (dims dict, 근거 설명, 태그 목록)."""
    m = re.search(TRIPLE, size or "")
    if not m:
        if g and g["w"] and g["d"] and g["h"]:
            return ({"w": g["w"], "d": g["d"], "h": g["h"]}, f"고시에 크기 없음 → smeg.com 칸 이름 값", [])
        return None, "크기 없음", []
    tri = tuple(num(x) for x in m.groups())

    def ok(o):
        d = {a: (int(round(v)), int(round(v))) for a, v in zip(o, tri)}
        return K.in_bounds(cat, d)
    own = order_from(f"{key} {size}")
    if own and ok(own):
        return dict(zip(own, tri)), f"고시 칸 순서 {own.upper()}", []
    hits = {o for t, o in pool if t == tri}
    if len(hits) == 1 and ok(next(iter(hits))):
        o = next(iter(hits))
        why = (f"고시 순서 표기 {own.upper()} 로 읽으면 범위 밖이라" if own else "고시에 순서 표기가 없어") +             f" 수입사 비교표의 같은 값 순서 {o.upper()} 로 읽음"
        return dict(zip(o, tri)), why, []
    if g and g["w"] and g["d"] and g["h"]:
        gd = {"w": g["w"], "d": g["d"], "h": g["h"]}
        if sorted(gd.values()) == sorted(tri):
            return gd, (f"고시 순서 표기 {own.upper()} 로 읽으면 범위 밖이라" if own else "고시에 순서 표기가 없어") +                 " smeg.com 칸 이름(Width/Depth/Height)으로 읽음", []
        return gd, f"고시 값으로는 순서를 정할 수 없고 값도 달라 smeg.com 칸 이름 값 W{g['w']:g} D{g['d']:g} H{g['h']:g} 을 쓴다 (확인 필요)", []
    o = DEFAULT_ORDER.get(cat, "wdh")
    return dict(zip(o, tri)), f"순서 표시 없음 — 기본 순서 {o.upper()} 로 읽음", ["치수순서추정"]


def cutout_of(raw, w, d):
    """'478-482x555-560 mm' · '490x750 mm' → (가로 lo, 깊이 lo). 두 값 중 외경 가로 · 깊이보다 작게 들어가는 배치를 고른다."""
    parts = [[num(x) for x in re.findall(r"[\d.,]+", p)] for p in re.split(r"\s*[xX×]\s*", (raw or "").replace("mm", ""))]
    parts = [p for p in parts if p]
    if len(parts) != 2:
        return None
    a, b = parts
    for cw, cd in ((a, b), (b, a)):
        if cw[0] < w and cd[0] < d and (cw[0] >= cd[0] or w < d):
            return int(cw[0]), int(cd[0])
    return None


def manual():
    if not os.path.exists(MANUAL):
        return {}
    with open(MANUAL, encoding="utf-8") as fp:
        return json.load(fp).get("models", {})


def apply_manual(row, man):
    for code in row["model_codes"]:
        m = man.get(code)
        if not m:
            continue
        used = False
        for k, v in m.items():
            if k in ("tag", "source", "note") or v is None:
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
        return


def gaps(lines):
    """수입사 페이지 설치 문장 중 숫자가 분명한 여유만: '뒷 공간 5cm, 양 옆 공간 3cm' · '가구장 뒷판과 벽면 사이에 최소 25mm'."""
    t = " ".join(lines)
    out = {}

    def v(p):
        m = re.search(p + r"\s*(\d+(?:\.\d+)?)\s*(cm|mm)", t)
        return int(round(float(m.group(1)) * (10 if m.group(2) == "cm" else 1))) if m else None
    back = v(r"뒷\s*공간") or v(r"뒷판과 벽면 사이에 최소")
    side = v(r"양\s*옆\s*공간")
    if back:
        out["back_gap_mm"] = back
    if side:
        out["side_gap_mm"] = side
    return out


def classify(cate, name, code, g):
    """→ (category, subtype, install_type, line, skip 이유)."""
    if ACCESSORY.search(name):
        return None, None, None, None, "부속품"
    line = next((w for w in LINES if w in name), "일반")
    if cate == "16":
        if g and g.get("mw") or "콤비" in name:
            return "oven", "combi", "built_in", line, None
        if g and "Steam" in (g.get("method") or ""):
            return "oven", "steam_oven", "built_in", line, None
        return "oven", "oven", "built_in", line, None
    if cate == "24":
        return "cooktop", "induction", "built_in", line, None
    if cate == "787":
        if "오븐일체형" in name.replace(" ", "") or code.startswith("TR"):
            return None, None, None, None, "오븐 일체형 레인지(프리스탠딩 쿡탑+오븐)"
        return "cooktop", "induction", "built_in", line, None
    if cate == "31":
        chimney = (g and "Decorative wall hood" in (g.get("hood_type") or ""))
        return "hood", "chimney" if chimney else None, None, line, None
    if cate == "28":
        return "dishwasher", "built_in" if "빌트인" in name else "freestanding", "built_in" if "빌트인" in name else "freestanding", line, None
    if cate == "772":
        if "인덕션" in name:
            return "cooktop", "induction", "freestanding", line, None
        if "오븐" in name:
            return "oven", "steam_oven" if "스팀" in name else "oven", "freestanding", line, None
        return None, None, None, None, "오븐 · 쿡탑 아님"
    if cate == "203":
        if not re.match(r"(ALFA|SPS)\d", code):
            return None, None, None, None, "부속품"
        return "oven", "steam_oven" if "스팀" in name else "oven", "freestanding", "프로페셔널", None
    return None, None, None, None, "메뉴 밖"


def premerge(rows):
    """색상 변형(크기 · 구분이 같은 것)을 한 행으로 — 모델 코드 · 태그는 모두 합친다 (collect.merge 는 첫 행 태그만 남긴다)."""
    out = {}
    for r in rows:
        key = (r["category"], r["category_subtype"], r["line"], r["width_mm"], r["height_mm"], r["depth_mm"], r["capacity_l"],
               r["place_count"], r["install_type"], r["cutout_w_mm"], r["cutout_d_mm"], r["niche_min_w_mm"], r["niche_min_h_mm"],
               r["niche_min_d_mm"])
        if r["width_mm"] is None or key not in out:
            out[key if r["width_mm"] is not None else id(r)] = r
            continue
        o = out[key]
        for c in r["model_codes"]:
            if c not in o["model_codes"]:
                o["model_codes"].append(c)
        for t in r["tags"]:
            if t not in o["tags"]:
                o["tags"].append(t)
        if r["product_type_raw"] and r["product_type_raw"] not in (o["product_type_raw"] or ""):
            extra = [x for x in r["product_type_raw"].split(" / ") if x not in (o["product_type_raw"] or "")]
            if extra:
                o["product_type_raw"] = " / ".join([o["product_type_raw"] or ""] + extra).strip(" /")
        for k in K.GAP_KEYS:
            if o.get(k) is None and r.get(k) is not None:
                o[k] = r[k]
    return list(out.values())


def collect(f, K_, sample=None):
    global K
    K = K_
    man = manual()
    items = []
    for cate in CATES:
        total, seqs = K.F.sm_list(f, cate)
        print(f"[smeg] cate {cate} ({CATES[cate]}): total_row={total} listed={len(seqs)}", file=sys.stderr)
        items += [(cate, s) for s in (seqs[:sample] if sample else seqs)]
    pages, pools = [], {}
    for cate, seq in items:
        p = kr_page(f, seq)
        if p["status"] != 200 or not p["title"] or not p["notice"]:
            print(f"  [smeg] no title/notice {p['page']} (status {p['status']}) - skipped", file=sys.stderr)
            continue
        # 고시 칸 자체는 빼고 (고시 순서 표기가 틀린 것을 바로잡으려는 것이다) 비교표 · 설명 글의 순서만 모은다
        pools.setdefault(cate, []).extend(labeled_triples(re.sub(r'(?s)<li class="pro_info_li">.*?</li>', " ", p["html"])))
        pages.append((cate, p))
    rows, skipped = [], []
    for cate, p in pages:
        title = p["title"]
        code = title.split(" ")[-1].upper()
        name = title[:-len(code)].strip()
        cat0 = classify(cate, name, code, None)
        if not cat0[4] and not any("소비전력" in k or "정격" in k for k in p["notice"]):
            cat0 = (None, None, None, None, "부속품 (고시에 정격전압 · 소비전력 없음)")
        if cat0[4]:
            skipped.append(f"{code} {name} ({cat0[4]})")
            continue
        g = global_spec(f, code) if cate != "203" else None
        cat, sub, inst, line, why = classify(cate, name, code, g)
        notice = p["notice"]
        sk = next((k for k in notice if "크기" in k or "규격" in k), None)
        size = notice.get(sk) or ""
        nmodel = notice.get("품명 및 모델명") or ""
        tags = []
        if code.replace(" ", "") not in nmodel.upper().replace(" ", ""):
            tags.append("고시불일치")      # 상품정보고시 모델명이 다른 색상 코드 (빅토리아 오븐 SOP6902S2PN · PX 고시 = S2PP)
        raw_type = [CATES[cate], name]
        if "고시불일치" in tags:
            raw_type.append(f"상품정보고시 품명 및 모델명 '{nmodel}'")
        if g:
            raw_type += [x for x in (g.get("family"), g.get("method"), g.get("hood_type")) if x]
        if "후드일체형" in name:
            tags.append("후드일체형")
        row = K.base_row(brand=BRAND, category=cat, category_subtype=sub, install_type=inst, model_name=f"스메그 {name}",
                         model_codes=[code], line=line, source_url=p["page"], page_url=p["page"], image_source_url=p["img"],
                         product_type_raw=" / ".join(raw_type))
        row["tags"] += tags
        dims, how, dtags = resolve_dims(cat, sk, size, pools.get(cate, []), g)
        d = {a: (int(round(v)), int(round(v))) for a, v in dims.items()} if dims else None
        K.put_dims(row, d, f"{sk} {size}".strip() if size else None)
        row["tags"] += [t for t in dtags if t not in row["tags"]]
        if how and not how.startswith("고시 칸 순서"):
            row["size_raw"] = f"{row['size_raw'] or ''} · {how}".strip(" ·")
            if g and "smeg.com" in how:
                row["source_url"] = g["url"]
        capm = re.search(r"(\d+(?:\.\d+)?)\s*(?:L|ℓ|리터)", size)
        if cat == "dishwasher":
            row["place_count"] = K.place_count(size)
        elif cat == "oven":
            row["capacity_l"] = K.F.to_num(capm.group(1)) if capm else (K.F.first_num(g["cap"]) if g and g.get("cap") else None)
        if cat == "cooktop" and inst == "built_in" and g and g.get("cutout") and row["width_mm"]:
            c = cutout_of(g["cutout"], row["width_mm"], row["depth_mm"])
            if c:
                row["cutout_w_mm"], row["cutout_d_mm"] = c
                row["cutout_raw"] = f"smeg.com 'Worktop Cut-Out' {g['cutout']}"
        notes = [x for x in p["lines"] if re.search(r"\d ?(cm|mm)", x) and re.search(r"설치|공간|간격|가구장|타공|걸레받이", x)
                 and len(x) < 200 and not re.search(TRIPLE, x) and not re.search(r"식빵|머핀|베이킹|요리|냄비|용기", x)]
        if g and (g.get("hob_elec") or g.get("hob_gas")):
            notes.append(f"쿡탑과 최소 거리 (smeg.com): 전기 {g.get('hob_elec')} · 가스 {g.get('hob_gas')}")
        if notes:
            row["install_notes"] = " | ".join(dict.fromkeys(notes))[:700]
        row.update(gaps(p["lines"]))
        apply_manual(row, man)
        rows.append(row)
    for s in skipped:
        print(f"  [smeg] skipped: {s}", file=sys.stderr)
    return premerge(rows)
