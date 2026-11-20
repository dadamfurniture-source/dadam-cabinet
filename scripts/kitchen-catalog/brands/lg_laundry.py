"""LG 세탁기 · 건조기 · 워시타워 · 워시콤보 (2026-11-20 사장님 「냉장고, 세탁기 등의 경우 조합되거나 결합되는 경우의 수 모두 포함」).

목록  apiv2.lge.co.kr plp/category/{id}/model — 카테고리 페이지(lge.co.kr/category/…) HTML 에서 가장 많이 나오는 CT 번호
        CT50000101 세탁기 (subCategoryName 드럼세탁기 · 통돌이 · 미니세탁기)
        CT50000107 의류건조기
        CT50387000 세탁 건조기 (워시타워 · 워시콤보 · 세탁기+건조기 세트)
      종류는 제조사 하위 메뉴가 정한다: 드럼세탁기 → drum (이름에 '건조 겸용' → combo), 통돌이 → top_load, 미니세탁기 → mini,
      워시타워 → washtower, 워시콤보 → combo, 건조기 → dryer ('건조방식' 히트펌프 → heat_pump · 히터식 → electric).
      이름에 '+' 가 든 세트(세탁기+미니워시 · 건조기+스태킹키트 · 세탁기+건조기)와 키높이 수납함(FP7*, 가전 아님)은 뺀다.
치수  pdp/models/{id}/spec '크기 (WxHxD, mm)' · '크기 (WxHxD)' (칸 이름에서 순서).
용량  '세탁 용량 (kg)' · '건조 용량 (kg)' · 워시타워 '용량 (kg) = 세탁 25 / 건조 25' → 비고.

robots.txt: www.lge.co.kr 은 /shop/ · /search · /my-page* 등만 금지, apiv2.lge.co.kr 은 robots.txt 없음(404 → 허용).
"""
import re
import sys

BRAND_KEY = "lg_laundry"
# 주방가전 기본 실행(collect.py)에는 싣지 않는다 — 세탁기 · 건조기는 laundry_build.py 가 따로 모은다 (kitchen.json 에 섞이지 않게)
IN_KITCHEN = False
K = None

CATS = {"CT50000101": "washers", "CT50000107": "dryers", "CT50387000": "all-in-one"}
BOUNDS = {
    "washing_machine": {"w": (300, 800), "h": (300, 2000), "d": (250, 1000)},
    "dryer": {"w": (300, 800), "h": (300, 1100), "d": (250, 1000)},
}


def in_bounds(cat, d):
    b = BOUNDS[cat]
    return all(b[k][0] <= d[k][0] <= b[k][1] and b[k][0] <= d[k][1] <= b[k][1] for k in "whd")


def put_dims(row, d, raw):
    row["size_raw"] = raw
    if not d:
        row["tags"].append("치수확인필요")
        return
    row["width_mm"], row["height_mm"], row["depth_mm"] = d["w"][0], d["h"][0], d["d"][0]
    if any(d[k][0] != d[k][1] for k in "whd"):
        row["tags"].append("치수범위")
    if not in_bounds(row["category"], d):
        row["tags"].append("치수확인필요")


def num(v):
    m = re.search(r"(\d+(?:\.\d+)?)", v or "")
    return K.F.to_num(m.group(1)) if m else None


def classify(m, name):
    sub = m.get("subCategoryName") or ""
    if sub == "건조기":
        return "dryer", None
    if sub == "워시타워":
        return "washing_machine", "washtower"
    if sub == "워시콤보" or "건조 겸용" in name or "세탁건조기" in name:
        return "washing_machine", "combo"
    if sub == "통돌이":
        return "washing_machine", "top_load"
    if sub == "미니세탁기":
        return "washing_machine", "mini"
    if sub == "드럼세탁기":
        return "washing_machine", "drum"
    return None, None


def dry_subtype(v):
    v = v or ""
    if "히트펌프" in v:
        return "heat_pump"
    if "가스" in v:
        return "gas"
    if "히터" in v or "전기" in v:
        return "electric"
    return None


def line_of(name):
    if "SIGNATURE" in name.upper():
        return "LG SIGNATURE"
    if "오브제컬렉션" in name:
        return "오브제컬렉션"
    for w in ("워시타워", "워시콤보", "통돌이", "꼬망스", "트롬"):
        if w in name:
            return w
    return "일반"


def skip(m, name):
    sub = m.get("subCategoryName") or ""
    if "+" in name or "세트" in sub or not sub or sub == "None":
        return True
    if "수납함" in name or (m.get("modelName") or "").startswith("FP7"):
        return True
    return False


def collect(f, K_, sample=None):
    global K
    K = K_
    F = K.F
    rows, done = [], set()
    for cat_id, menu in CATS.items():
        total, ml = F.lg_list(f, cat_id)
        ml = [m for m in ml if not skip(m, re.sub(r"\s+", " ", m.get("modelDisplayName") or "").strip())]
        print(f"[lg_laundry] {menu}: total={total} kept={len(ml)}", file=sys.stderr)
        if sample:
            ml = ml[:sample]
        for m in ml:
            name = re.sub(r"\s+", " ", m.get("modelDisplayName") or "").strip()
            cat, sub = classify(m, name)
            if not cat:
                continue
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
                if not spec:
                    continue
                flat = F.lg_flat(spec)
                code = spec.get("modelName") or spec.get("salesModelCode")
                row = K.base_row(brand="LG", category=cat, category_subtype=sub, install_type="freestanding", model_name=name,
                                 model_codes=[code], line=line_of(name), source_url=f"{F.LG_API}/pdpsvc/ajax/v1/models/{vid}/spec",
                                 image_source_url=F.abs_image_url(m.get("largeImageAddr") or m.get("mediumImageAddr"), F.LG_WWW),
                                 page_url=F.LG_WWW + (m.get("modelUrlPath") or ""), sale_status=m.get("modelStatusCode"))
                sk = next((k for k in flat if k.startswith("크기") and "포장" not in k and "열림" not in k), None)
                d, _ = K.dims_of(sk, flat.get(sk), "whd") if sk else (None, None)
                put_dims(row, d, flat.get(sk) if sk else None)
                wash = num(flat.get("세탁 용량 (kg)") or flat.get("세탁 용량"))
                dry = num(flat.get("건조 용량 (kg)") or flat.get("건조 용량"))
                both = flat.get("용량 (kg)") or ""
                mw = re.search(r"세탁\s*(\d+(?:\.\d+)?)", both)
                md = re.search(r"건조\s*(\d+(?:\.\d+)?)", both)
                wash = wash or (F.to_num(mw.group(1)) if mw else None)
                dry = dry or (F.to_num(md.group(1)) if md else None)
                method = flat.get("건조방식") or flat.get("건조 방식")
                if cat == "dryer":
                    row["category_subtype"] = dry_subtype(method)
                row["capacity_wash_kg"], row["capacity_dry_kg"] = wash, dry
                parts = []
                if wash:
                    parts.append(f"세탁 {wash}kg")
                if dry:
                    parts.append(f"건조 {dry}kg")
                if method:
                    parts.append(f"건조 방식 {method}")
                if flat.get("모델명 (세탁기)") or flat.get("모델명 (건조기)"):
                    parts.append(f"구성 세탁기 {flat.get('모델명 (세탁기)') or '?'} · 건조기 {flat.get('모델명 (건조기)') or '?'}")
                open_k = next((k for k in flat if "열림 시 크기" in k), None)
                if open_k:
                    parts.append(f"{open_k} {flat[open_k]}")
                parts.append(f"제조사 메뉴 {m.get('subCategoryName')}")
                if flat.get("동일모델의 출시년월"):
                    parts.append(f"출시 {flat['동일모델의 출시년월']}")
                row["product_type_raw"] = " · ".join(parts)
                rows.append(row)
    return rows
