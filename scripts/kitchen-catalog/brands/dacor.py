"""데이코 (Dacor, 삼성전자 브랜드) 주방 빌트인 — www.dacorkorea.com (삼성전자 운영). 2026-10-25

목록: 홈 메뉴 '쿠킹 · 클리닝' 의 /products/(cooktops|wall-ovens|dishwashers|ventilation)/<slug>/ — HTML 주석으로 막아 둔
      메뉴(오븐 136L · 드로워 · 옛 75L)는 단종으로 보고 뺀다.
치수: 각 페이지 정적 HTML '제품 상세 스펙표' (냉장고 수집기 dc_spec 그대로) — 칸 이름에서 순서를 읽는다
      ('제품크기 (W x H x D)' · '크기 (가로 x 높이 x 깊이)'). 쿡탑 '따내기 크기 (W x D)' → 상판 타공.
설치 공간: 오븐 = 사용설명서 PDF '설치에 필요한 치수' 표 (manual/dacor.json, 태그 '매뉴얼'),
          식기세척기 = 상품 페이지 설치 도면의 대체 글(alt) '제품 설치 치수 …' (설명 글 → '요약문', 미검증).
사진: 다른 제품 페이지의 '관련 제품' 칸 누끼 사진 (냉장고 수집기 dc_thumbs 그대로). robots.txt 없음(404 → 허용).
"""
import json
import os
import re
import sys

BRAND_KEY = "dacor"
K = None   # collect.py 가 넘긴다 (split_dims · dims_of · base_row · put_dims · F …)

DC = "https://www.dacorkorea.com"
BRAND = "데이코"
CATS = {"cooktops": "cooktop", "wall-ovens": "oven", "dishwashers": "dishwasher", "ventilation": "hood"}
MANUAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "manual", "dacor.json")


def pages(f):
    """홈 메뉴의 주방 제품 페이지 (주석 처리된 링크는 뺀다)."""
    st, h = f.get(DC + "/")
    live = re.sub(r"(?s)<!--.*?-->", "", h)
    out = []
    for p in re.findall(r'href="(/products/(?:%s)/[\w-]+)/?"' % "|".join(CATS), live):
        if p + "/" not in out:
            out.append(p + "/")
    return out


def manual():
    if not os.path.exists(MANUAL):
        return {}
    with open(MANUAL, encoding="utf-8") as fp:
        return json.load(fp).get("models", {})


def apply_manual(row, man):
    """manual/dacor.json 의 값 (설명서 PDF 에서 읽은 값) — 페이지에 없는 칸만 채운다. 근거 태그를 단다."""
    for code in row["model_codes"]:
        m = man.get(code)
        if not m:
            continue
        used = False
        for k, v in m.items():
            if k in ("tag", "source", "note") or v is None:
                continue
            if k in ("install_notes", "niche_raw", "cutout_raw"):
                row[k] = " | ".join(x for x in (row.get(k), v) if x)
                continue
            if row.get(k) is None:
                row[k] = v
                used = True
        if used and m.get("tag") and m["tag"] not in row["tags"]:
            row["tags"].append(m["tag"])
        if m.get("source"):
            row["install_notes"] = " | ".join(x for x in (row.get("install_notes"), "설명서: " + m["source"]) if x)


def dishwasher_niche(h, row):
    """설치 도면 대체 글: '… 싱크 하부장의 폭이 600, 깊이가 595, 그 중 도어 패널이 차지하는 깊이가 20, 그리고 하부장 높이가 815~865 …'.
    사양표가 아니라 그림 설명 글이다 → '요약문' (미검증)."""
    alt = next((a for a in re.findall(r'alt="([^"]*)"', h) if "설치 치수" in a and "하부장" in a), None)
    if not alt:
        return
    alt = K.F.html.unescape(alt)
    w = re.search(r"하부장의 폭이\s*(\d+)", alt)
    d = re.search(r"하부장의 폭이\s*\d+,\s*깊이가\s*(\d+)", alt)
    hh = re.search(r"하부장 높이가\s*(\d+)\s*~\s*(\d+)", alt)
    if not (w and d and hh):
        return
    row["niche_min_w_mm"], row["niche_min_d_mm"] = int(w.group(1)), int(d.group(1))
    row["niche_min_h_mm"], row["niche_max_h_mm"] = int(hh.group(1)), int(hh.group(2))
    row["niche_raw"] = "상품 페이지 설치 도면 설명: " + re.sub(r"\s+", " ", alt)[:400]
    if "요약문" not in row["tags"]:
        row["tags"].append("요약문")
    panel = re.search(r"도어 패널 권장 치수는 ([^.]+)", alt)
    if panel:
        row["install_notes"] = " | ".join(x for x in (row.get("install_notes"), "하부장 도어 패널 권장 " + panel.group(1)) if x)


def collect(f, K_, sample=None):
    global K
    K = K_
    man = manual()
    paths = pages(f)
    print(f"[dacor] kitchen pages={paths}", file=sys.stderr)
    per_cat, rows, thumbs = {}, [], {}
    for path in paths:
        cat = CATS[path.split("/")[2]]
        if sample and per_cat.get(cat, 0) >= sample:
            continue
        page = DC + path
        st, h = f.get(page)
        for k, v in K.F.dc_thumbs(h).items():
            thumbs.setdefault(k, v)
        spec = K.F.dc_spec(h) if st == 200 else {}
        code = (spec.get("모델명") or "").strip().upper()
        if not spec or not code:
            print(f"  [dacor] no spec table / model {page} (status {st}) - skipped", file=sys.stderr)
            continue
        per_cat[cat] = per_cat.get(cat, 0) + 1
        kind = spec.get("타입") or ""
        ptype = spec.get("제품 타입") or spec.get("제품타입") or ""
        title = re.search(r"<title>([^<|]*\b([A-Z]{2,4}\d{2}[A-Z0-9]{4,})\b[^<|]*)\|", h)
        sub, inst = None, "built_in"
        if cat == "oven":
            mw = "전자레인지" in (spec.get("소비전력") or "") or "Microwave" in (spec.get("열원") or "")
            sub = "combi" if mw else "oven"
        elif cat == "cooktop":
            sub = "induction" if "인덕션" in kind else None
        elif cat == "dishwasher":
            sub = "built_in" if "빌트인" in ptype else None
            inst = "built_in" if "빌트인" in ptype else None
        elif cat == "hood":
            sub = "chimney" if "침니" in ptype else None
            inst = None
        raw_type = " / ".join(x for x in [kind, ptype, spec.get("색상 (패널)"), spec.get("도어개폐")] if x)
        if title and title.group(2) != code:
            raw_type += f" / 페이지 제목 코드 {title.group(2)} (스펙표 모델명 {code} 을 쓴다)"
        row = K.base_row(brand=BRAND, category=cat, category_subtype=sub, install_type=inst,
                         model_name=f"데이코 {kind}".strip(), model_codes=[code], line="일반",
                         source_url=page, page_url=page, image_source_url=None, product_type_raw=raw_type)
        sk = next((k for k in spec if "크기" in k and "/" not in k and "따내기" not in k and "포장" not in k), None)
        size = spec.get(sk) if sk else None
        d, _ = K.dims_of(sk, size, "whd") if size else (None, None)
        K.put_dims(row, d, size)
        capv = spec.get("용량") or ""
        if cat == "dishwasher":
            row["place_count"] = K.place_count(capv)
        else:
            row["capacity_l"] = K.litres(capv)
        ck = next((k for k in spec if "따내기" in k and "/" not in k), None)
        if ck and cat == "cooktop":
            parts = K.split_dims(spec[ck])
            if len(parts) >= 2:            # '724~728 x 498~499 mm' = 가로 × 깊이 — 범위는 낮은 값, 원문은 cutout_raw
                row["cutout_w_mm"], row["cutout_d_mm"] = parts[0][0], parts[1][0]
                row["cutout_raw"] = f"따내기 크기 (W x D) {spec[ck]}"
            depth = spec.get("매입 깊이")
            if depth:
                row["install_notes"] = f"매입 깊이 {depth}"
        if cat == "dishwasher":
            dishwasher_niche(h, row)
        apply_manual(row, man)
        rows.append(row)
    for r in rows:
        r["image_source_url"] = thumbs.get(r["page_url"][len(DC):])
    return rows
