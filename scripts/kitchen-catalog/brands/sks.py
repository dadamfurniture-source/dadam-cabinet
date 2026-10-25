"""LG SIGNATURE Kitchen Suite (SKS) 주방 빌트인 — lge.co.kr/kr/business/sks 브랜드관. 2026-10-25

lge.co.kr 일반 목록(plp)에는 없다. 브랜드관 홈(signaturekitchenMain.do) 'Products' 링크 중 주방(인덕션 · 광파오븐 ·
스팀 오븐 · 식기세척기) 페이지의 정적 HTML '제품 상세 스펙' 탭 (냉장고 수집기 sks_collect 와 같은 틀):
  사진 설명 = 모델 코드 ('HN952VAE', 'DBS14 / 본체 : DBE7PT / 패널 : D-DTB1')
  '제품 치수 (WxHxD, mm)' → 외경, '설치 치수 (WxHxD, mm)' → 오븐 · 식기세척기 설치 공간 · 쿡탑 상판 타공(가로 × 깊이 두 값)
설치 여유(옆 · 뒤)는 '다운로드' 탭 사용설명서 PDF 글자 → manual/sks.json (태그 '매뉴얼').
2026-10-25 브랜드관에 후드 · 가스 쿡탑 페이지는 없다 (냉장 계열은 냉장고 수집기가 모은다). robots.txt: /kr/business/ 허용.
"""
import json
import os
import re
import sys

BRAND_KEY = "sks"
K = None   # collect.py 가 넘긴다 (split_dims · dims_of · base_row · put_dims · F …)

SKS = "https://www.lge.co.kr/kr/business/sks"
KITCHEN = re.compile(r"인덕션|오븐|식기세척기|후드|쿡탑|레인지")
FRIDGE = re.compile(r"냉장|냉동|와인")
MANUAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "manual", "sks.json")
CODE = re.compile(r"\b([A-Z][A-Z0-9]{3,})\b")


def pages(f):
    st, h = f.get(f"{SKS}/signaturekitchenMain.do")
    out = []
    for path, label in re.findall(r'<a[^>]+href="(/kr/business/sks/[\w-]+\.do)(?:#[^"]*)?"[^>]*>(.*?)</a>', h, re.S):
        lab = K.F._text(label, " ")
        if KITCHEN.search(lab) and not FRIDGE.search(lab) and path not in dict(out):
            out.append((path, lab))
    return out


def classify(path):
    """→ (category, subtype). 페이지 = 제품 종류 하나."""
    p = path.rsplit("/", 1)[-1]
    if "induction" in p:
        return "cooktop", "induction"
    if "lightwave" in p:          # 광파오븐 — 오븐 · 그릴 · 스팀 · 레인지 복합, 빌트인 전용
        return "oven", "combi"
    if "steam" in p:
        return "oven", "steam_oven"
    if "dishwasher" in p:
        return "dishwasher", "built_in"
    if "hood" in p:
        return "hood", None
    return None, None


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
            row["install_notes"] = " | ".join(x for x in (row.get("install_notes"), "설명서: " + m["source"]) if x)
        break


def first_part(v):
    """'594 x 460 x 471 (워밍 드로어 미포함) / 594 x 600 x 553 (워밍 드로어 포함)' → 첫 묶음 (괄호 뺌)."""
    return re.sub(r"\([^)]*\)", " ", (v or "").split("/")[0]).strip()


def collect(f, K_, sample=None):
    global K
    K = K_
    man = manual()
    paths = pages(f)
    print(f"[sks] kitchen pages={paths}", file=sys.stderr)
    rows, per_cat = [], {}
    for path, label in paths:
        cat, sub = classify(path)
        if not cat:
            print(f"  [sks] {path}: unknown kind - skipped", file=sys.stderr)
            continue
        if sample and per_cat.get(cat, 0) >= sample:
            continue
        page = K.F.LG_WWW + path
        st, h = f.get(page)
        h = re.sub(r"(?s)<!--.*?-->", "", h)
        for sec in re.findall(r'(?s)id="productSpec\d+">(.*?)(?=<section |$)', h):
            for tab_id, tab in re.findall(r'(?s)<div class="tabs-content" id="(tab[\d-]+)">(.*?)(?=<div class="tabs-content"|$)', sec):
                img_items = [(K.F._text(a, " "), K.F._text(b, " / ").replace("\n", " "))
                             for a, b in re.findall(r'(?s)class="item-text">\s*<p class="title">(.*?)</p>\s*'
                                                    r'<span class="desc">(.*?)</span>', tab)]
                summary = [K.F._text(x, " ") for x in re.findall(r"(?s)<li>(.*?)</li>", " ".join(
                    re.findall(r'(?s)<ul class="bullet-list">(.*?)</ul>', tab)))]
                notes = [K.F._text(x, " ") for x in re.findall(r"(?s)<li>(.*?)</li>", " ".join(
                    re.findall(r'(?s)<ul class="(?:noti-list|multiple-list)">(.*?)</ul>', tab)))]
                notes = [n for n in notes if re.search(r"\d ?mm|설치|전원|워밍", n) and not re.search(r"제품 이미지|상담사", n)]
                for blk in re.split(r'<div class="spec-table(?! download)', tab)[1:]:
                    pairs = [(K.F._text(a, " ").replace("\n", " "), K.F._text(b, " / ").replace("\n", " ")) for a, b in
                             re.findall(r'(?s)<p class="list-tit">(.*?)</p>\s*<p class="list-cont">(.*?)</p>', blk)]
                    get = lambda key: next(((k, v) for k, v in pairs if k.replace(" ", "").startswith(key)), (None, None))  # noqa
                    sk, size = get("제품치수")
                    if not size:
                        continue
                    codes, body = [], None
                    for t, desc in img_items:
                        m = CODE.search(desc)
                        if m and m.group(1) not in codes:
                            codes.append(m.group(1))
                        b = re.search(r"본체\s*:\s*([A-Z][A-Z0-9]{3,})", desc)
                        body = body or (b.group(1) if b else None)
                    nk, nv = get("품명및모델명")
                    if body and body not in codes:
                        codes.append(body)          # 식기세척기 본체 코드 (상품정보고시 '품명 및 모델명' DBE7PT.AKOR)
                    if not codes:
                        print(f"  [sks] {path}#{tab_id}: no model code - skipped", file=sys.stderr)
                        continue
                    designs = [t for t, _ in img_items if t in ("Professional", "Transitional")]
                    kind = next((t for t, _ in img_items if t not in ("Professional", "Transitional")), None) or label
                    name = f"SKS {kind}" + (f" ({' / '.join(designs)})" if designs else "")
                    row = K.base_row(brand="LG", category=cat, category_subtype=sub, install_type="built_in",
                                     model_name=name, model_codes=codes, line="SIGNATURE Kitchen Suite",
                                     source_url=f"{page}#{tab_id}", page_url=page,
                                     image_source_url=K.F.sks_image(tab, codes[0]),
                                     product_type_raw=" / ".join(x for x in [kind, " / ".join(designs) or None,
                                                                             " · ".join(summary[:3]) or None] if x))
                    row["tags"].append("SKS")
                    d, _ = K.dims_of(sk, first_part(size), "whd")
                    K.put_dims(row, d, size)
                    if "/" in size:
                        row["size_raw"] = size      # 워밍 드로어 포함 치수 등 둘째 묶음은 원문에만
                    ik, inst = get("설치치수")
                    if inst and cat == "cooktop":
                        parts = K.split_dims(first_part(inst))
                        if len(parts) >= 2:         # '860 X 486 (매립 깊이 149)' = 가로 × 깊이 (설명서 '매입절취 860 (W) × 486 (D) × 149 (H)')
                            row["cutout_w_mm"], row["cutout_d_mm"] = parts[0][0], parts[1][0]
                            row["cutout_raw"] = f"{ik} {inst}"
                    elif inst:
                        row.update(K.F.parse_niche(first_part(inst)))
                        row["niche_raw"] = f"{ik} {inst}"
                    capk, capv = get("조리용량")
                    capv = capv or next((s for s in summary if re.search(r"\d+\s*L\b", s)), "")
                    if cat == "dishwasher":
                        row["place_count"] = K.place_count(" ".join(summary) + " " + (capv or ""))
                    else:
                        row["capacity_l"] = K.litres(capv)
                    if notes:
                        row["install_notes"] = " | ".join(dict.fromkeys(notes))[:600]
                    if nv:
                        row["product_type_raw"] += f" / 상품정보고시 품명 및 모델명 {nv}"
                    gk, gsize = get("제품크기")
                    if gsize and gsize.replace(" ", "").upper() != size.replace(" ", "").upper():
                        row["size_raw"] = f"{size} · 상품정보고시 '{gk}' {gsize}"
                    apply_manual(row, man)
                    rows.append(row)
                    per_cat[cat] = per_cat.get(cat, 0) + 1
    return rows
