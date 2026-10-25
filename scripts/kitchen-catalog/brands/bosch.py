"""보쉬 (Bosch, BSH) 빌트인 주방가전 — 오븐 · 콤팩트(전자레인지 겸용) · 스팀오븐 · 전자레인지 · 쿡탑 · 후드 · 식기세척기. (2026-10-25)

국내 판매 모델 목록이 공식 사이트에 없다:
  bosch-home.co.kr  — BSH Home Appliances Pte. Ltd.(싱가포르) 가 운영하는 한국어 소개 사이트. 사이트맵 · 메뉴에 제품 상세가 하나도 없다
                      ('/ko/products/…' 는 종류 소개 글뿐, '/ko/productslist' 404). 국내 유통처 = 대형가전 ㈜화인어프라이언스
  fineappliances.co.kr — 그 유통처 사이트는 가게나우 제품만 싣는다 (2018 보쉬 국내 독점 계약은 '회사소개' 연혁에만)
그래서 한국 사이트를 운영하는 BSH 싱가포르 법인의 지역 사이트 bosch-home.com.sg 제품을 싣는다 — 전부 '국내판매미확인'.

  목록   www.bosch-home.com.sg/sitemap.xml 의 /en/product/… 중 주방 빌트인 경로 (SITE_PATHS)
  치수   제품 페이지 JSON-LD additionalProperty — 'Dimensions' (BSH 공통 꼴 높이 x 폭 x 깊이. 가게나우 같은 칸은 'Dimensions (HxWxD)'),
         'Minimum/Maximum height · width for installation', 'Depth for installation' → 니치,
         쿡탑 'Required niche size for installation (HxWxD) 51 x 560-560 x 490-500' → 상판 타공 W · D,
         후드 'Width of the appliance' · 'Height of the appliance' · 'Depth of the product' · 'Height of the chimney'
robots.txt (bosch-home.com.sg) — /en/product/ 허용. Fetcher 로만 (1.2초 · 캐시). 액세서리 · 세정제 · 냉장고 · 세탁기는 뺀다.
"""
import json
import re
import sys

BRAND_KEY = "bosch"
K = None   # collect.py 가 넘긴다

BRAND = "보쉬"
SITE = "https://www.bosch-home.com.sg"
SITEMAP = SITE + "/sitemap.xml"
PRODUCT_PREFIX = "/en/product/"
SITE_NOTE = "bosch-home.com.sg (BSH 싱가포르 — bosch-home.co.kr 운영 법인)"
# 사이트맵 /en/product/{경로}/{코드} 중 실을 경로 (앞부분 일치). 액세서리 · 세정제는 넣지 않는다
SITE_PATHS = ("cooking-baking/cookers-and-ovens/", "cooking-baking/steam-appliances/", "cooking-baking/microwaves/",
               "cooking-baking/cooker-hoods/", "cooking-baking/induction-and-electro-hobs/induction-hobs/",
               "cooking-baking/induction-and-electro-hobs/electro-hobs/", "cooking-baking/gas-hobs/",
               "dishwashers/built-in-dishwashers/", "dishwashers/free-standing-dishwashers/")
# 침니 · 아일랜드 후드 전체 높이 (덕트 커버 포함) — 제품 페이지엔 본체 높이(46 mm 등)와 덕트 커버 높이만 있고 둘을 더하면 틀린다
#   (DWB97CM50B: 46 + 582 = 628 인데 공식 치수도 · 스펙시트는 614~954). 그래서 BSH 스펙시트 PDF 글자
#   'Dimensions exhaust air (HxWxD mm): 614-954 x 898 x 500' 를 읽는다 (→ '매뉴얼' 출처 표시).
#   PDF 는 냉장고 수집기의 gg_pdf_text 로 받는다 — Fetcher 와 같은 robots.txt 확인 · 1.2초 간격 · UA, 글자만 cache/ 에 둔다
SHEET = "https://media3.bsh-group.com/Documents/specsheet/{loc}/{code}.pdf"
SHEET_LOC = "en-SG"
# 페이지 · 스펙시트에 높이 글자가 없을 때만 쓰는 공식 치수도(Line_Drawings) 판독값 (→ '이미지판독').
#   코드: {"h": (낮은 값, 높은 값), "w": 폭 또는 None, "d": 깊이 또는 None, "id": 그림 ID, "note": 원문 요약}
HOOD_DRAWN = {}

# ----------------------------------------------------------------------------- BSH 제품 페이지 (gaggenau · bosch · siemens 공통 꼴)
# 같은 코드가 gaggenau.py · siemens.py 에도 있다 (브랜드 파일끼리 서로 부르지 않는다 — brands/README.md)

SPEC_RE = re.compile(r'"key":"[A-Z_0-9]+","name":\{[^{}]*"text":"([^"]*)"\},"value":\{[^{}]*"text":"([^"]*)"\},'
                     r'"requiresValueTranslation":(?:true|false),"unit":(?:null|"([^"]*)")')


def bsh_page(h):
    """제품 페이지 HTML → {name, mpn, avail, props{이름: (값, 단위)}, images[url]}.
    JSON-LD Product.additionalProperty 가 먼저, 구조화 specifications 로 채운다."""
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
    for m in SPEC_RE.finditer(h.replace('\\"', '"')):
        name, val, unit = m.group(1).strip(), m.group(2).strip(), (m.group(3) or "").strip()
        if name and val and not val.startswith(("specifications.", "GENERAL.")):
            out["props"].setdefault(name, (val, unit))
    return out


def prop(p, *names):
    """첫 번째로 있는 속성 값 (단위 없이). 이름이 정확히 같은 것만 — 'Dimensions' 가 포장 치수로 새지 않게."""
    for n in names:
        v = p["props"].get(n, ("",))[0]
        if v and not v.startswith(("GENERAL.", "specifications.")):    # 'GENERAL.N_A' = 값 없음
            return v
    return None


def num(s):
    m = re.search(r"\d+(?:[.,]\d+)?", s or "")
    return K.F.to_num(m.group(0).replace(",", ".")) if m else None


def hwd(value):
    """'455x590x559' (HxWxD) → {'w':(lo,hi),'h':…,'d':…}. 두 묶음이 붙은 값 '148x288x512106x288x512' 은 첫 묶음."""
    v = (value or "").replace(" ", "")
    m = re.fullmatch(r"(\d+)x(\d+)x(\d+?)(\d+)x\2x\3", v)
    if m:
        v = f"{m.group(1)}x{m.group(2)}x{m.group(3)}"
    d, _ = K.dims_of("(HxWxD)", v, "hwd")
    return d


def rng(s):
    """'560-568' · '490 - 500' · '815' → (lo, hi). 없으면 (None, None)."""
    nums = [K.F.to_num(x) for x in re.findall(r"\d+(?:\.\d+)?", s or "")]
    if not nums:
        return None, None
    return nums[0], (nums[1] if len(nums) > 1 else nums[0])


def put_niche(row, wmin, wmax, hmin, hmax, dmin, dmax, raw):
    """니치 — 한 값이면 min 만, 범위면 min · max (냉장고 수집기와 같은 규칙)."""
    for k, lo, hi in (("w", wmin, wmax), ("h", hmin, hmax), ("d", dmin, dmax)):
        if lo is None:
            continue
        row[f"niche_min_{k}_mm"] = lo
        if hi is not None and hi != lo:
            row[f"niche_max_{k}_mm"] = hi
    row["niche_raw"] = raw


def drawing_ids(p):
    return [re.sub(r"_[a-z]{2}-[A-Z]{2}$", "", u.rsplit("/", 1)[-1].split("?")[0].rsplit(".", 1)[0])
            for u in p["images"] if "/Line_Drawings/" in u]


def pick_image(p, code):
    """Product_Shots 중 모델 코드(앞 6자)가 든 제품 사진 → 제품 사진 → 첫 장. 연출 · 문 열림 · 부분 사진은 뒤로."""
    shots = [u for u in p["images"] if "/Product_Shots/" in u]
    if not shots:
        return None
    bad = lambda u: re.search(r"(?i)open|_IS_|_DS_|\d(?:IS|DS|SHS|PHS)\d|PGA|KUL_KUR|Inspiration|Detail|Live_Everyday", u)  # noqa
    good = [u for u in shots if not bad(u)]
    stem = re.sub(r"\d{3}[A-Z]?$", "", code)[:6]
    return next((u for u in good if stem in u), None) or (good or shots)[0]


# ----------------------------------------------------------------------------- 보쉬 · 지멘스 (같은 BSH 지역 사이트 꼴)


def site_products(f):
    """→ [(code, url, 경로)] — 사이트맵의 {PRODUCT_PREFIX}{경로}/{코드} 중 SITE_PATHS (액세서리 · 세정 · 드로어 제외)."""
    st, xml = f.get(SITEMAP)
    out, seen = [], set()
    for u in re.findall(r"<loc>([^<]+)</loc>", xml):
        m = re.search(re.escape(PRODUCT_PREFIX) + r"(.+)/([A-Z0-9]{6,14})$", u)
        if not m or m.group(2) in seen or not (m.group(1) + "/").startswith(SITE_PATHS):
            continue
        if re.search(r"accessor|cleaning|drawer|dishwashersacc", m.group(1)):
            continue
        seen.add(m.group(2))
        out.append((m.group(2), u, m.group(1)))
    return out


def classify(path, name, p):
    """→ (category, subtype, install_type, 원문). 메뉴 경로 + 제품명 (보쉬 SG · 지멘스 HK 메뉴 이름을 함께 읽는다)."""
    pl, nl = path.lower(), (name or "").lower()
    seg = pl.rsplit("/", 1)[-1]
    inst_raw = " / ".join(x for x in [prop(p, "Built-in / Free-standing"), prop(p, "Installation typology"),
                                      prop(p, "Installation type"), prop(p, "Where can the appliance be installed")] if x)
    raw = " / ".join(x for x in [path, name, inst_raw] if x)
    free = "free-standing" in pl or "freestanding" in pl or \
        re.search(r"free-?standing", (prop(p, "Built-in / Free-standing") or prop(p, "Installation type") or "").lower())
    if pl.startswith(("dishwashers", "dish-care")):
        if "tabletop" in (prop(p, "Installation typology") or "").lower():
            return "dishwasher", "countertop", "freestanding", raw    # 지멘스 SK26E82208 '콤팩트 55 cm' (높이 450)
        return "dishwasher", ("freestanding" if free else "built_in"), ("freestanding" if free else "built_in"), raw
    if "/microwaves" in pl or pl.startswith("cooking-baking/microwaves"):
        return "microwave", ("combi" if re.search(r"oven|hot ?air", nl) else "solo"), ("freestanding" if free else "built_in"), raw
    if re.search(r"cookers-and-ovens|steam-appliances|/ovens|steam-ovens", pl):
        if "freestanding" in nl or "free-standing" in nl or "range cooker" in nl:
            return None, None, None, raw                      # 프리스탠딩 레인지(오븐 + 쿡탑 한 몸) — 이번 종류가 아니다
        if "steam" in pl or "steam" in nl:
            return "oven", "steam_oven", "built_in", raw
        if "microwave" in pl or "microwave" in nl:
            return "oven", "combi", "built_in", raw            # 전자레인지 겸용 빌트인 (콤팩트) 오븐
        return "oven", "oven", "built_in", raw
    if "venting-hobs" in pl or "integrated ventilation" in nl:
        return "cooktop", "induction", "built_in", raw         # 환기 일체형 인덕션 → 후드일체형 태그
    if "cooker-hoods" in pl or "/ventilation" in pl:
        typ = seg + " " + (prop(p, "Installation typology") or "").lower() + " " + nl
        sub = (None if "ceiling" in typ                              # 천장형 — 맞는 값이 없다
               else "island" if "island" in typ else "slim" if re.search(r"telescopic|slide|flat", typ)
               else "built_in" if re.search(r"built-in|integrated|canopy", typ)
               else "chimney" if "wall" in typ or "chimney" in typ else None)
        return "hood", sub, ("built_in" if sub in ("built_in", "slim") else None), raw
    if "hobs" in pl:
        sub = ("gas" if "gas" in seg or re.search(r"\bgas\b", nl) else "highlight" if "electro" in seg or "electric hob" in nl
               else "induction" if "induction" in seg or "induction" in nl else None)
        return "cooktop", sub, "built_in", raw
    return None, None, None, raw


def sheet_text(f, code):
    """BSH 스펙시트 PDF 글자 → (주소, 글자). 없으면 None. (냉장고 수집기 gg_pdf_text — robots · 1.2초 · 글자 캐시)"""
    url = SHEET.format(loc=SHEET_LOC, code=code)
    try:
        st, t = K.F.gg_pdf_text(f, url)
    except Exception as e:   # 오프라인 캐시 없음 등
        print(f"  [{BRAND_KEY}] {code}: 스펙시트 못 읽음 ({e})", file=sys.stderr)
        return None
    return (url, t) if st == 200 and t else None


def line_of(name):
    m = re.match(r"(Series \d|Serie \d|iQ\d00|studioLine)", name or "")
    return m.group(1) if m else None


def build_row(code, url, path, p, f=None):
    cat, sub, inst, raw = classify(path, p["name"], p)
    if cat is None:
        return None
    name = p["name"] or code
    row = K.base_row(brand=BRAND, category=cat, category_subtype=sub, install_type=inst,
                     model_name=f"{BRAND} {name}", model_codes=[code], line=line_of(name),
                     source_url=url, page_url=url, image_source_url=pick_image(p, code),
                     product_type_raw=f"{raw} / 출처 {SITE_NOTE}")
    row["tags"].append("국내판매미확인")
    if "venting-hobs" in path.lower():
        row["tags"].append("후드일체형")
    row["sale_status"] = p["avail"]
    notes = []
    # 외형 — 'Dimensions' = 높이 x 폭 x 깊이 (BSH 공통). 후드는 칸이 따로 있다
    dv = prop(p, "Dimensions (HxWxD)", "Dimensions")
    d = hwd(dv) if dv else None
    size_raw = f"Dimensions {dv} mm (높이 x 폭 x 깊이)" if dv else None
    if cat == "hood":
        hw, hh = prop(p, "Width of the appliance"), prop(p, "Height of the appliance")
        hd = prop(p, "Depth of the product", "Depth")       # 보쉬 SG 'Depth of the product' · 지멘스 HK 'Depth'
        ch = prop(p, "Height of the chimney")
        if hw and hh and hd and not d:
            d = {"w": rng(hw), "h": rng(hh), "d": rng(hd)}
            size_raw = f"Width of the appliance {hw} · Height of the appliance {hh} · Depth {hd} mm"
        if ch:
            notes.append(f"Height of the chimney {ch} mm (덕트 커버 높이)")
        # 침니 · 아일랜드 — 페이지 높이는 본체(캐노피)뿐. 덕트 커버 포함 전체 높이를 찾는다
        lo_hi = None
        if sub in ("chimney", "island"):
            a, b = num(prop(p, "Appliance height exhaust air min")), num(prop(p, "Appliance height exhaust air max"))
            if a and b:
                lo_hi = (a, b, f"Appliance height exhaust air min {a} · max {b} mm")
            sheet = sheet_text(f, code) if not lo_hi and f else None
            if not lo_hi and sheet:
                m = re.search(r"Dimensions exhaust air \(HxWxD mm\):\s*(\d+)\s*-\s*(\d+)\s*x\s*(\d+)\s*x\s*(\d+)", sheet[1])
                if m:
                    lo_hi = (int(m.group(1)), int(m.group(2)), f"스펙시트 {sheet[0]} '{m.group(0)}'")
                    row["tags"].append("매뉴얼")
        e = HOOD_DRAWN.get(code)
        if not lo_hi and e:
            # 페이지 · 스펙시트에 높이 글자가 없는 후드 — 공식 치수도 판독 (폭 · 깊이는 페이지 글자를 먼저)
            if not d and (hw or e.get("w")) and (hd or e.get("d")):
                d = {"w": rng(hw) if hw else (e["w"], e["w"]), "h": e["h"], "d": rng(hd) if hd else (e["d"], e["d"])}
                size_raw = f"Width of the appliance {hw or e.get('w')} · Depth {hd or e.get('d')} mm"
            lo_hi = (e["h"][0], e["h"][1], f"공식 치수도 {e['id']} 판독 — {e['note']}")
            row["tags"].append("이미지판독")
        if lo_hi and d:
            d["h"] = (lo_hi[0], lo_hi[1])
            size_raw += f" → 외형 높이 {lo_hi[0]}~{lo_hi[1]} ({lo_hi[2]})"
    K.put_dims(row, d, size_raw)
    # 니치 (오븐 · 전자레인지 · 식기세척기)
    nh = (prop(p, "Minimum height for installation"), prop(p, "Maximum height for installation"))
    nw = (prop(p, "Minimum width for installation"), prop(p, "Maximum width for installation"))
    nd = prop(p, "Depth for installation")
    if cat in ("oven", "microwave", "dishwasher") and any(nh + nw + (nd,)) or \
            cat == "hood" and sub in ("built_in", "slim") and nw[0]:     # 빌트인 · 슬라이드 후드 = 장 안쪽 폭 · 깊이
        rg = lambda a, b: (a or "-") + (f"~{b}" if b and b != a else "")  # noqa: E731
        put_niche(row, num(nw[0]), num(nw[1]), num(nh[0]), num(nh[1]), num(nd), None,
                  f"installation height {rg(*nh)} · width {rg(*nw)} · depth {nd or '-'} mm ({SITE_NOTE})")
    # 상판 타공 (쿡탑) — 'Required niche size for installation (HxWxD) 51 x 560-560 x 490-500' 또는
    #   'Minimum width for installation 270' · 'Depth for installation 490' (도미노). 'height for installation' = 상판 밑 깊이
    rn = prop(p, "Required niche size for installation (HxWxD)")
    if cat == "cooktop":
        w0 = w1 = d0 = d1 = None
        src = None
        if rn:
            parts = [x.strip() for x in re.sub(r"\s*mm\s*$", "", rn).split("x")]
            if len(parts) == 3:
                (w0, w1), (d0, d1) = rng(parts[1]), rng(parts[2])
                src = f"Required niche size for installation (HxWxD) {rn}"
        if not (w0 and d0) and nw[0]:
            # 'height · depth for installation' 의 뜻이 제품마다 다르다 — 도미노 PRA3A6: height 45(상판 밑) · depth 490(타공 깊이),
            #   환기 일체형 PVS601B16E: height 500(타공 깊이) · depth 227(상판 밑). 상판 깊이 방향 타공이 될 수 있는 값
            #   (300 이상 · 제품 깊이 미만) 이 하나뿐일 때만 그것을 타공 D 로 쓴다. 둘 다 / 둘 다 아니면 비운다
            dd = d["d"][0] if d else 700
            cand = [x for x in {num(nh[0]), num(nd)} if x and 300 <= x < dd]
            if len(cand) == 1:
                w0, w1, d0, d1 = num(nw[0]), num(nw[1]) or num(nw[0]), cand[0], cand[0]
                src = f"installation width {nw[0]}" + (f"~{nw[1]}" if nw[1] and nw[1] != nw[0] else "") + \
                    f" · height {nh[0]} · depth {nd} mm (타공 깊이 = {cand[0]})"
        if w0 and d0:
            row["cutout_w_mm"], row["cutout_d_mm"] = w0, d0
            row["cutout_raw"] = f"{src} — 타공 W {w0}" + (f"~{w1}" if w1 != w0 else "") + \
                f" · D {d0}" + (f"~{d1}" if d1 != d0 else "") + " (범위면 작은 값)"
    if cat == "cooktop":
        for n in ("Minimum worktop thickness", "Width"):
            v = prop(p, n)
            if v:
                notes.append(f"{n} {v}")
    if cat == "hood":
        for n in ("Minimum distance above electric cooktops", "Minimum distance above gas cooktops",
                  "Minimum distance above an electric hob", "Minimum distance above a gas hob"):
            v = prop(p, n)
            if v:
                notes.append(f"{n} {v} mm")
    vol = prop(p, "Usable volume (of cavity) - NEW (2010/30/EC)", "Net volume", "Usable volume", "Net capacity",
               "Cavity capacity")
    if vol and cat in ("oven", "microwave"):
        row["capacity_l"] = num(vol)
    pc = prop(p, "Maximum number of place settings (EU 2017/1369)", "Number of place settings (max)",
              "Number of place settings")
    if pc and cat == "dishwasher":
        row["place_count"] = num(pc)
    if cat == "dishwasher":
        for n in ("Installation typology", "Depth with open door 90 degree", "Height of removable worktop"):
            v = prop(p, n)
            if v:
                notes.append(f"{n} {v}")
    hinge = prop(p, "Door hinge", "Door hinge position")
    if hinge:
        notes.append(f"도어 경첩 {hinge}")
    if notes:
        row["install_notes"] = " · ".join(notes)
    dids = drawing_ids(p)
    if dids:
        row["product_type_raw"] += " / 치수도 " + ", ".join(dids[:4])
    return row


def collect(f, K_, sample=None):
    global K
    K = K_
    prods = site_products(f)
    print(f"[{BRAND_KEY}] {SITE} 주방 제품={len(prods)}", file=sys.stderr)
    if sample:
        groups = {}
        for x in prods:
            groups.setdefault("/".join(x[2].split("/")[:3]), []).append(x)
        prods = [y for g in groups.values() for y in g[:1]][:sample * 4]
    rows = []
    for code, u, path in prods:
        st, h = f.get(u)
        if st != 200:
            print(f"  [{BRAND_KEY}] {code}: status={st} — 건너뜀", file=sys.stderr)
            continue
        p = bsh_page(h)
        if p["mpn"] and p["mpn"] != code:
            print(f"  [{BRAND_KEY}] {code}: 페이지 mpn={p['mpn']} 다름", file=sys.stderr)
        row = build_row(code, u, path, p, f)
        if row:
            rows.append(row)
        else:
            print(f"  [{BRAND_KEY}] {code}: 이번 종류 아님 ({path}) — 건너뜀", file=sys.stderr)
    return rows
