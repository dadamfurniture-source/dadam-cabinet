#!/usr/bin/env python3
"""주방가전 치수 수집기 (stdlib only) — 2026-10-25 사장님 "전자레인지 및 주방가전 데이터 수집".

냉장고 수집기(../fridge-catalog/collect.py)의 공용 부분(Fetcher · 삼성/LG 목록 · 사양 API)을 그대로 불러 쓴다.
그 파일은 고치지 않는다.

  삼성   samsung.com/sec goodsList + compGoodsSpecList — 전자레인지 · 큐커 멀티/오븐 · 식기세척기 · 인덕션 · 후드
  LG     apiv2.lge.co.kr plp/pdp                     — 광파오븐/전자레인지 · 식기세척기 · 전기레인지 (본 사이트에 후드 없음)
  쿠첸   cuchenmall.co.kr 사이트맵 → 상품 페이지 '기본사양' (밥솥)
  쿠쿠   cuckoo.co.kr 홈 화면에 걸린 상품 페이지 '핵심 사양' (밥솥) — 상품 목록 API(/rest/)는 robots.txt 가 막아 쓰지 않는다

종류는 제조사 메뉴가 정한다. 삼성 '큐커 멀티/오븐' 메뉴만 사양의 설치 방식으로 나눈다 (빌트인 → oven, 프리스탠딩 → microwave).

Usage:
  python -I collect.py --sample 3 --out sample      # 종류마다 몇 개씩
  python -I collect.py --out kitchen                # 전체 → kitchen.json / kitchen.csv
  python -I collect.py --offline --out kitchen      # 캐시만으로 다시 만든다
"""
import argparse
import csv
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("fridge_collect", os.path.join(HERE, "..", "fridge-catalog", "collect.py"))
F = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(F)

# 종류별로 받는 치수 범위 (mm) — 벗어나면 '치수확인필요' 를 달고 SQL 에서 뺀다 (to_sql.py)
BOUNDS = {
    "microwave":   {"w": (300, 800), "h": (200, 600), "d": (250, 700)},
    "oven":        {"w": (400, 1000), "h": (300, 1000), "d": (300, 750)},
    "dishwasher":  {"w": (400, 700), "h": (400, 900), "d": (400, 700)},
    "cooktop":     {"w": (250, 1000), "h": (20, 300), "d": (250, 650)},
    "hood":        {"w": (400, 1300), "h": (50, 1300), "d": (250, 700)},
    "rice_cooker": {"w": (150, 500), "h": (150, 500), "d": (150, 550)},
}
NICHE_KEYS = ("niche_min_w_mm", "niche_min_h_mm", "niche_min_d_mm", "niche_max_w_mm", "niche_max_h_mm", "niche_max_d_mm")
CUTOUT_KEYS = ("cutout_w_mm", "cutout_d_mm", "cutout_r_mm")
GAP_KEYS = ("side_gap_mm", "top_gap_mm", "back_gap_mm")

# --------------------------------------------------------------------------- 치수 글자


def split_dims(value):
    """'898 x  500 x 405~755 mm' → [(898, 898), (500, 500), (405, 755)]. 칸 구분은 x · X · × · *."""
    if not value:
        return []
    v = str(value).replace(",", "")
    v = re.sub(r"\((?:W|H|D|가로|세로|높이|깊이)\)", "", v, flags=re.I)
    parts = re.split(r"\s*[xX×*]\s*", v)
    out = []
    for p in parts:
        nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", p)]
        if not nums:
            continue
        lo, hi = nums[0], (nums[1] if len(nums) > 1 and "~" in p else nums[0])
        if "cm" in v.lower() and "mm" not in v.lower():
            lo, hi = lo * 10, hi * 10
        out.append((int(round(lo)), int(round(hi))))
    return out


def order_of(label, default):
    """사양 이름에서 칸 순서를 읽는다 — '(가로 × 높이 × 깊이)' · '(WxHxD)' · '(W X H X D)'. 없으면 default ('wdh' 등)."""
    s = str(label or "")
    m = re.search(r"\(([^)]*)\)", s)
    inner = (m.group(1) if m else "").upper()
    toks = re.findall(r"가로|높이|깊이|세로|W|H|D", inner)
    key = {"가로": "w", "W": "w", "높이": "h", "세로": "h", "H": "h", "깊이": "d", "D": "d"}
    seq = "".join(key[t] for t in toks)
    return seq if sorted(seq) == ["d", "h", "w"] else default


def dims_of(label, value, default):
    """→ ({'w':(lo,hi), 'h':…, 'd':…}, 순서) 또는 (None, 순서)."""
    parts = split_dims(value)
    seq = order_of(label, default)
    if len(parts) < 3:
        return None, seq
    return dict(zip(seq, parts[:3])), seq


def in_bounds(cat, d):
    b = BOUNDS[cat]
    return all(b[k][0] <= d[k][0] <= b[k][1] and b[k][0] <= d[k][1] <= b[k][1] for k in "whd")


def gaps_of(text):
    """LG 전자레인지 · 광파오븐 '설치환경' 글 → 여유 칸. 예: '제품의 윗면은 20cm 이상 띄움, 측면/뒷면은 벽과 10cm 이상 띄움'."""
    t = re.sub(r"\s+", " ", text or "")
    g = {}

    def cm(pat):
        m = re.search(pat + r"[^\d,.]{0,12}(\d+(?:\.\d+)?)\s*(cm|mm)", t)
        if not m:
            return None
        x = float(m.group(1)) * (10 if m.group(2) == "cm" else 1)
        return int(round(x))
    top = cm(r"(?:윗면|상단|위쪽)")
    side_back = cm(r"측면\s*/\s*뒷면")
    side = side_back or cm(r"(?:측면|좌우|옆면)")
    back = side_back or cm(r"(?:뒷면|후면)")
    if top is not None:
        g["top_gap_mm"] = top
    if side is not None:
        g["side_gap_mm"] = side
    if back is not None:
        g["back_gap_mm"] = back
    if t:
        g["install_notes"] = t[:400]
    return g


def place_count(text):
    m = re.search(r"(\d+)\s*인(?:용|분)", text or "")
    return int(m.group(1)) if m else None


def litres(text):
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:L|ℓ)\b", text or "", flags=re.I)
    return F.to_num(m.group(1)) if m else None


def base_row(**kw):
    row = {k: None for k in ("brand", "category", "category_subtype", "line", "model_name", "width_mm", "height_mm",
                             "depth_mm", "capacity_l", "place_count", "install_type", "size_raw", "niche_raw",
                             "cutout_raw", "product_type_raw", "install_notes", "source_url", "image_source_url",
                             "page_url", "sale_status") + NICHE_KEYS + CUTOUT_KEYS + GAP_KEYS}
    row.update({"model_codes": [], "tags": [], "collected_at": F.now_iso()})
    row.update(kw)
    return row


def put_dims(row, d, raw):
    """외경 — 범위가 있으면(후드 높이 405~755) 낮은 값을 넣고 원문은 size_raw 에 남긴다."""
    row["size_raw"] = raw
    if not d:
        row["tags"].append("치수확인필요")
        return
    row["width_mm"], row["height_mm"], row["depth_mm"] = d["w"][0], d["h"][0], d["d"][0]
    if any(d[k][0] != d[k][1] for k in "whd"):
        row["tags"].append("치수범위")
    if not in_bounds(row["category"], d):
        row["tags"].append("치수확인필요")


# --------------------------------------------------------------------------- 삼성

SS_KITCHEN = {"100034611": "microwave", "100044008": "qooker-oven", "36080000": "dishwasher",
              "36070000": "cooktop", "100027453": "hood"}


def ss_pick(spec, keys, exclude=("포장", "내부", "조리실", "박스")):
    for want in keys:
        for k, v in spec.items():
            if want in k and not any(x in k for x in exclude) and v and v != "-":
                return k, v
    return None, None


def ss_classify(menu, name, spec):
    """→ (category, subtype, install_type)"""
    inst = (spec.get("설치방식") or spec.get("설치 방식") or "")
    if menu == "microwave":
        return "microwave", ("combi" if ("오븐" in name or "큐커" in name) else "solo"), "freestanding"
    if menu == "qooker-oven":
        if "빌트인" in inst:
            sub = "combi" if spec.get("전자레인지") == "있음" else ("steam_oven" if "스팀오븐" in (spec.get("구분") or "") else "oven")
            return "oven", sub, "built_in"
        return "microwave", "combi", "freestanding"
    if menu == "dishwasher":
        if "카운터탑" in name:
            return "dishwasher", "countertop", "freestanding"
        if "프리스탠딩" in name:
            return "dishwasher", "freestanding", "freestanding"
        return "dishwasher", "built_in", "built_in"
    if menu == "cooktop":
        sub = "hybrid" if "하이브리드" in name else ("highlight" if "하이라이트" in name else "induction")
        return "cooktop", sub, None
    if menu == "hood":
        t = spec.get("제품 타입") or name
        sub = ("chimney" if "침니" in t else "island" if "아일랜드" in t else "slim" if "슬림" in t
               else "built_in" if "빌트인" in t or "매립" in t else None)
        return "hood", sub, None
    return None, None, None


def ss_row(p, menu, mdl, gid, spec):
    name = re.sub(r"\s+", " ", p.get("goodsNm") or "").strip()
    cat, sub, inst = ss_classify(menu, name, spec)
    row = base_row(brand="Samsung", category=cat, category_subtype=sub, install_type=inst, model_name=name,
                   model_codes=[mdl], line=("Infinite Line" if "Infinite" in name else "Bespoke" if "Bespoke" in name else "일반"),
                   source_url=f"{F.SS}/sec/xhr/pf/compGoodsSpecList?goodsIds={gid}", image_source_url=F.ss_image(p),
                   page_url=f"{F.SS}/sec/{p['goodsDetailUrl']}", sale_status=p.get("saleStatCd"),
                   product_type_raw=" / ".join(x for x in [spec.get("구분"), spec.get("제품 타입"), spec.get("설치방식") or spec.get("설치 방식")] if x))
    if "후드일체형" in name:
        row["tags"].append("후드일체형")
    k, v = ss_pick(spec, ["외관 크기", "크기(", "외관", "외부 치수", "크기"], exclude=("포장", "내부", "조리실", "박스", "타공", "플렉스존"))
    # '외부 치수'(쿡탑 · 후드)는 칸 이름이 없다 — 600 x 520 x 50 처럼 가로 × 깊이 × 높이
    d, _ = dims_of(k, v, "wdh" if (k or "").startswith("외부 치수") else "whd")
    put_dims(row, d, v)
    _, capv = ss_pick(spec, ["용량"], exclude=("가용", "포장"))
    row["capacity_l"] = litres(capv) if capv and cat != "dishwasher" else None
    row["place_count"] = place_count(capv) if cat == "dishwasher" else None
    tk, tv = ss_pick(spec, ["타공 사이즈", "타공"], exclude=("포장",))
    if tv:
        parts = split_dims(tv)
        if cat == "cooktop" and len(parts) >= 2:          # '560 x 480 mm' = 가로 × 깊이
            row["cutout_w_mm"], row["cutout_d_mm"] = parts[0][0], parts[1][0]
            row["cutout_raw"] = tv
            row["install_type"] = "built_in"
        elif cat in ("oven", "microwave", "dishwasher") and len(parts) >= 3:   # 빌트인 오븐 '560 X 579 X 549' = 가로 × 높이 × 깊이
            row["niche_min_w_mm"], row["niche_min_h_mm"], row["niche_min_d_mm"] = parts[0][0], parts[1][0], parts[2][0]
            row["niche_raw"] = f"{tk} {tv}"
    if cat == "cooktop" and not tv:
        row["install_type"] = "freestanding"
    return row


def samsung_collect(f, sample=None):
    rows, done = [], set()
    for disp, menu in SS_KITCHEN.items():
        count, prods = F.ss_list(f, disp)
        # 냉장고 수집기는 goodsTpCd 20(패키지)을 뺐지만, 식기세척기 · 후드일체형 인덕션은 단품도 20 이다 (설치 · 키트 상품).
        #   빼지 않는다 — 부속품을 붙인 묶음(…+정수필터)도 본체 치수가 같아 merge 에서 한 행으로 합쳐진다
        print(f"[samsung] {menu}: count={count} listed={len(prods)}", file=sys.stderr)
        if sample:
            prods = prods[:sample]
        for p in prods:
            for mdl, gid in F.ss_variants(p).items():
                if mdl in done:
                    continue
                done.add(mdl)
                spec = F.ss_spec(f, gid)
                if spec:
                    rows.append(ss_row(p, menu, mdl, gid, spec))
    return rows


# --------------------------------------------------------------------------- LG

LG_KITCHEN = {"CT50019018": "microwave-oven", "CT50000086": "dishwasher", "CT50000076": "cooktop"}


def lg_classify(menu, m, flat, name):
    sub = m.get("subCategoryName") or ""
    if menu == "microwave-oven":
        inst = "built_in" if "빌트인" in (flat.get("형태") or "") + name else "freestanding"
        return "microwave", ("combi" if "광파" in sub or "오븐" in sub else "solo"), inst
    if menu == "dishwasher":
        t = flat.get("설치타입") or ""
        if "빌트인" in t and "프리" not in t:
            return "dishwasher", "built_in", "built_in"
        if "프리" in t and "빌트인" not in t:
            return "dishwasher", "freestanding", "freestanding"
        return "dishwasher", "built_in", "built_in"
    if menu == "cooktop":
        return "cooktop", ("hybrid" if "하이브리드" in sub + name else "highlight" if "하이라이트" in sub + name else "induction"), None
    return None, None, None


def lg_row(m, menu, vid, spec):
    flat = F.lg_flat(spec)
    name = re.sub(r"\s+", " ", m.get("modelDisplayName") or "").strip()
    cat, sub, inst = lg_classify(menu, m, flat, name)
    code = spec.get("modelName") or spec.get("salesModelCode")
    row = base_row(brand="LG", category=cat, category_subtype=sub, install_type=inst, model_name=name, model_codes=[code],
                   line=F.lg_line(name), source_url=f"{F.LG_API}/pdpsvc/ajax/v1/models/{vid}/spec",
                   image_source_url=F.abs_image_url(m.get("largeImageAddr") or m.get("mediumImageAddr"), F.LG_WWW),
                   page_url=F.LG_WWW + (m.get("modelUrlPath") or ""), sale_status=m.get("modelStatusCode"),
                   product_type_raw=" / ".join(x for x in [m.get("subCategoryName"), flat.get("형태"), flat.get("설치타입")] if x))
    sk = next((k for k in flat if "크기" in k and "포장" not in k and "상판 제거" not in k and "내부" not in k), None)
    d, _ = dims_of(sk, flat.get(sk), "whd") if sk else (None, None)
    put_dims(row, d, flat.get(sk) if sk else None)
    ck = next((k for k in flat if k.startswith("용량")), None)
    if ck:
        row["capacity_l"] = F.first_num(flat[ck]) if cat != "dishwasher" else None
        row["place_count"] = place_count(flat[ck]) if cat == "dishwasher" else None
    tk = next((k for k in flat if "타공" in k), None)
    if tk and cat == "cooktop":
        parts = split_dims(flat[tk])
        seq = order_of(tk, "whd")
        if len(parts) >= 3 and sorted(seq) == ["d", "h", "w"]:   # '싱크대 타공치수 (W X H X D)(mm) = 560 x 65 x 480'
            dd = dict(zip(seq, parts[:3]))
            row["cutout_w_mm"], row["cutout_d_mm"] = dd["w"][0], dd["d"][0]
            row["cutout_raw"] = f"{tk} {flat[tk]}"
        row["install_type"] = "built_in"
    elif cat == "cooktop":
        row["install_type"] = "freestanding"
    env = flat.get("설치환경")
    if env:
        row.update(gaps_of(env))
    return row


def lg_collect(f, sample=None):
    rows, done = [], set()
    for cat_id, menu in LG_KITCHEN.items():
        total, ml = F.lg_list(f, cat_id)
        ml = [m for m in ml if not F.lg_is_kit(m) and "세트" not in (m.get("subCategoryName") or "")]
        print(f"[lg] {menu}: total={total} listed={len(ml)}", file=sys.stderr)
        if sample:
            ml = ml[:sample]
        for m in ml:
            vids = [m["modelId"]]
            for og in m.get("optionGroupList") or []:
                for o in og.get("optionList") or []:
                    if o.get("modelId") and o["modelId"] not in vids:
                        vids.append(o["modelId"])
            for vid in vids:
                if vid in done:
                    continue
                done.add(vid)
                spec = F.lg_spec(f, vid)
                if spec:
                    rows.append(lg_row(m, menu, vid, spec))
    return rows


# --------------------------------------------------------------------------- 밥솥 (쿠첸 · 쿠쿠)


def rice_subtype(name):
    n = name.upper()
    if "IH" in n and "압력" in name:
        return "pressure_ih"
    if "IH" in n:
        return "ih"
    if "압력" in name:
        return "pressure"
    return "electric"


def is_rice_cooker(name):
    return "밥솥" in name and not re.search(r"패키지|내솥|패킹|부품|커버|증기|세트|\+|&", name)


CM = "https://www.cuchenmall.co.kr"


def cuchen_collect(f, sample=None):
    st, x = f.get(CM + "/sitemap-geo.xml")
    urls = [u.replace("&amp;", "&") for u in re.findall(r"<loc>([^<]+)</loc>", x) if "detail.php" in u]
    print(f"[cuchen] sitemap detail pages={len(urls)}", file=sys.stderr)
    rows = []
    for u in urls:
        st, h = f.get(u)
        if st != 200:
            continue
        title = re.search(r"<title>([^<|]*)", h)
        name = F.html.unescape(title.group(1)).strip() if title else ""
        if not is_rice_cooker(name):
            continue
        t = F.html_to_text(h)
        # '기본사양 · 사이즈' 다음 줄 — '298(W)*408(D)*307(H)(mm)' · '215*258*208 (W*D*H)' · '368*264*268(mm)' (순서 표시 없음)
        size = re.search(r"사이즈\s*\n\s*(\d[^\n]{4,60})", t)
        # 판매 코드 = 상품 이름 바로 다음 줄. 상품정보고시 '품명 및 모델명' 이 다른 상품에서 복사된 곳이 있다
        #   (미니밥솥 더 동글: 판매 CRE-D0401W · 고시 CRM-E0101W) — 판매 코드만 모델 코드로, 다르면 미검증
        shown = re.search(re.escape(name) + r"\s*\n\s*([A-Z]{2,4}-[A-Z0-9]{3,})", t)
        notice = re.search(r"품명 및 모델명\s*\n?\s*([A-Z]{2,4}-[A-Z0-9]{3,})", t)
        code = (shown or notice).group(1) if (shown or notice) else None
        img = re.search(r'<meta property="og:image" content="([^"]+)"', h)
        row = base_row(brand="Cuchen", category="rice_cooker", category_subtype=rice_subtype(name), install_type="freestanding",
                       model_name=name, model_codes=[code] if code else [], line="쿠첸",
                       source_url=u, page_url=u, image_source_url=F.abs_url(img.group(1), CM) if img else None,
                       place_count=place_count(name))
        if shown and notice and shown.group(1) != notice.group(1):
            row["tags"].append("고시불일치")
            row["product_type_raw"] = f"상품정보고시 모델명 {notice.group(1)}"
        raw = size.group(1).strip() if size else None
        seq = "".join(re.findall(r"[WDH]", raw or ""))
        if raw and sorted(seq) != ["D", "H", "W"]:
            row["tags"].append("치수순서추정")   # 순서 표시가 없다 — 쿠첸이 표시한 곳의 순서(가로*깊이*높이)로 읽고 미검증
        d, _ = dims_of(f"({'x'.join(seq)})", raw, "wdh") if raw else (None, None)
        put_dims(row, d, raw)
        rows.append(row)
        if sample and len(rows) >= sample:
            break
    return rows


CK = "https://www.cuckoo.co.kr"


def cuckoo_collect(f, sample=None):
    """홈 화면에 걸린 상품 페이지만 (목록 API /rest/ 는 robots.txt 금지). 전체 목록이 아니다."""
    st, h = f.get(CK + "/")
    nos = list(dict.fromkeys(re.findall(r"/mall/productView\?productNo=(\d+)", h)))
    print(f"[cuckoo] home product links={len(nos)}", file=sys.stderr)
    rows = []
    for no in nos:
        u = f"{CK}/mall/productView?productNo={no}"
        st, ph = f.get(u)
        if st != 200:
            continue
        # 이름 · 판매 코드 = 상품 이름 칸 두 개 (첫째 이름, 둘째 코드). og:title 은 없다
        names = [re.sub(r"^\([^)]*\)\s*", "", F.html.unescape(x).strip())   # '(타임딜)' · '(특가판매)' 앞말은 뗀다
                 for x in re.findall(r'class="[^"]*prd[^"]*name[^"]*"[^>]*>([^<]+)<', ph)]
        name = names[0] if names else ""
        if not is_rice_cooker(name):
            continue
        code = next((x for x in names[1:] if re.fullmatch(r"[A-Z]{2,4}-[A-Z0-9]{3,}", x)), None)
        t = F.html_to_text(ph)
        i = t.find("핵심 사양")
        summary = t[i:i + 300] if i >= 0 else ""
        img = re.search(r'<meta property="og:image" content="([^"]+)"', ph)
        row = base_row(brand="Cuckoo", category="rice_cooker", category_subtype=rice_subtype(name + " " + summary[:120]),
                       install_type="freestanding", model_name=name, model_codes=[code] if code else [], line="쿠쿠",
                       source_url=u, page_url=u, image_source_url=F.abs_url(img.group(1), CK) if img else None,
                       place_count=place_count(name))
        # 정본 = 상품정보고시 '크기(길이,폭,높이) 392x269x265(mm)' (길이 = 깊이). '핵심 사양' 요약 글은 폭 · 깊이가
        #   뒤바뀐 곳이 있다 (트윈프레셔 6인용: 요약 'W383 x D262' · 고시 없음) — 고시가 없을 때만 쓰고 미검증
        notice = re.search(r"크기\(길이,\s*폭,\s*높이\)\s*\n?\s*([\d.]+\s*[xX×*]\s*[\d.]+\s*[xX×*]\s*[\d.]+)", t)
        if notice:
            raw = notice.group(1)
            d, _ = dims_of("(DxWxH)", raw, "dwh")
        else:
            size = (re.search(r"([WDH]\s*\d{2,3}(?:\.\d+)?\s*[xX×*]\s*[WDH]\s*\d{2,3}(?:\.\d+)?\s*[xX×*]\s*[WDH]\s*\d{2,3}(?:\.\d+)?)\s*mm", summary)
                    or re.search(r"(\d{2,3}(?:\.\d+)?\s*\([WDH]\)\s*[xX×*]\s*\d{2,3}(?:\.\d+)?\s*\([WDH]\)\s*[xX×*]\s*\d{2,3}(?:\.\d+)?\s*\([WDH]\))\s*mm", summary))
            raw = size.group(1) if size else None
            seq = "".join(re.findall(r"[WDH]", raw or ""))
            d, _ = dims_of(f"({'x'.join(seq)})", raw, "wdh") if raw else (None, None)
            row["tags"].append("요약문")   # 사양표가 아니라 요약 글 — 사람이 확인하기 전까지 미검증
        put_dims(row, d, raw)
        rows.append(row)
        if sample and len(rows) >= sample:
            break
    return rows


# --------------------------------------------------------------------------- 묶기 · 쓰기

COLS = ["brand", "category", "category_subtype", "line", "tags", "model_name", "model_codes", "width_mm", "height_mm",
        "depth_mm", "capacity_l", "place_count", "install_type", *NICHE_KEYS, *CUTOUT_KEYS, *GAP_KEYS, "size_raw",
        "niche_raw", "cutout_raw", "product_type_raw", "install_notes", "source_url", "page_url", "source_urls",
        "image_source_url", "sale_status", "collected_at"]


def merge(rows):
    """크기 · 구분이 같은 색상 변형은 한 행으로 (모델 코드는 모두 남긴다) — 냉장고 수집기 merge 와 같고 종류 · 타공을 키에 더한다."""
    out = {}
    for r in rows:
        if r.get("width_mm") is None:
            key = ("nodims", r["brand"]) + tuple(r["model_codes"]) + (r["page_url"],)
        else:
            key = (r["brand"], r["category"], r["category_subtype"], r["line"], r["width_mm"], r["height_mm"], r["depth_mm"],
                   r["capacity_l"], r["place_count"], r["install_type"], r["cutout_w_mm"], r["cutout_d_mm"],
                   r["niche_min_w_mm"], r["niche_min_h_mm"], r["niche_min_d_mm"])
        if key not in out:
            r = dict(r)
            r["model_codes"] = list(r["model_codes"])
            r["source_urls"] = [r["source_url"]]
            out[key] = r
            continue
        o = out[key]
        for c in r["model_codes"]:
            if c and c not in o["model_codes"]:
                o["model_codes"].append(c)
        o["source_urls"].append(r["source_url"])
        if not o.get("image_source_url") and r.get("image_source_url"):
            o["image_source_url"] = r["image_source_url"]
        for k in GAP_KEYS:
            if o.get(k) is None and r.get(k) is not None:
                o[k] = r[k]
    return list(out.values())


def flag_permuted(rows, tol=2):
    """같은 브랜드 · 종류 · 인분에서 세 치수를 크기순으로 놓으면 ±tol 안으로 같은데 W · H · D 에 넣은 순서가 다른 행들 —
    어느 쪽이 맞는지 모른다. 모두 '치수순서의심' (미검증). 쿠첸 페이지가 색상마다 따로 적어 이름 · 순서가 어긋난 곳이 있다
    (121 플러스 10인용 네이처 화이트 397(W)*301(D) · 블라썸화이트 301(W)*397(D))."""
    have = [r for r in rows if r.get("width_mm") is not None]
    for i, a in enumerate(have):
        for b in have[i + 1:]:
            if (a["brand"], a["category"], a.get("place_count")) != (b["brand"], b["category"], b.get("place_count")):
                continue
            da, db = (a["width_mm"], a["height_mm"], a["depth_mm"]), (b["width_mm"], b["height_mm"], b["depth_mm"])
            same_set = all(abs(x - y) <= tol for x, y in zip(sorted(da), sorted(db)))
            same_order = all(abs(x - y) <= tol for x, y in zip(da, db))
            if same_set and not same_order:
                for r in (a, b):
                    if "치수순서의심" not in r["tags"]:
                        r["tags"].append("치수순서의심")
    return rows


def write(rows, base):
    with open(base + ".json", "w", encoding="utf-8") as fp:
        json.dump(rows, fp, ensure_ascii=False, indent=1)
    with open(base + ".csv", "w", encoding="utf-8-sig", newline="") as fp:
        w = csv.DictWriter(fp, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            rr = dict(r)
            for k in ("model_codes", "tags", "source_urls"):
                if isinstance(rr.get(k), list):
                    rr[k] = ";".join(str(x) for x in rr[k])
            w.writerow(rr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brands", default="samsung,lg,cuchen,cuckoo")
    ap.add_argument("--sample", type=int, default=0, help="menu items per category (0 = all)")
    ap.add_argument("--out", default=None)
    ap.add_argument("--delay", type=float, default=1.2)
    ap.add_argument("--cache", default=os.path.join(HERE, "cache"))
    ap.add_argument("--offline", action="store_true", help="cache only")
    a = ap.parse_args()
    f = F.Fetcher(a.cache, a.delay, a.offline)
    brands = [b.strip().lower() for b in a.brands.split(",")]
    rows = []
    if "samsung" in brands:
        rows += samsung_collect(f, a.sample or None)
    if "lg" in brands:
        rows += lg_collect(f, a.sample or None)
    if "cuchen" in brands:
        rows += cuchen_collect(f, a.sample or None)
    if "cuckoo" in brands:
        rows += cuckoo_collect(f, a.sample or None)
    merged = flag_permuted(merge(rows))
    base = os.path.join(HERE, a.out or ("sample" if a.sample else "kitchen"))
    write(merged, base)
    print(f"variants={len(rows)} merged_rows={len(merged)} net_requests={f.net_count} cache_hits={f.cache_hits}"
          f" -> {base}.json/.csv", file=sys.stderr)


if __name__ == "__main__":
    main()
