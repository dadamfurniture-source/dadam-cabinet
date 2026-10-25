"""SK매직 주방가전 — skmagic.com 고객지원(매뉴얼 찾기 · 제품 지원 · FAQ). (2026-10-25)

SK매직은 2024년 가스레인지 · 전기레인지 · 전기오븐 사업을 경동나비엔에 넘겼고(나비엔 매직), skmagic.com 판매 메뉴에
주방가전이 없다. 옛 상품 페이지(/goods/indexGoodsDetail)는 '판매중인 상품이 아닙니다' 로 돌려보낸다.
남은 공식 글은 고객지원의 제품 지원 페이지(모델 코드 · 이름 · 사진)와 FAQ 뿐이다. 사용설명서는 파일 이름만 보이고 받기 링크가 없다.
치수가 적힌 공식 글은 FAQ '트리플케어 식기세척기 빌트인 설치시방서' 하나 — 그 글에 맞는 6인용 트리플케어(DWA19…)만 행을 만든다.
"""
import json
import re
import sys

BRAND_KEY = "skmagic"
K = None   # collect.py 가 넘긴다 (split_dims · dims_of · base_row · put_dims · F …)

SK = "https://www.skmagic.com"
FAQ_DW = "129"                      # FAQ > 제품 > 식기세척기 (가스레인지 126 · 전기레인지 127 · 오븐 128 · 전자레인지 130)


def support_items(f, keyword):
    """매뉴얼 찾기 검색 → [(goodsId, manualNo)] (쪽마다 10개)."""
    out = []
    for page in range(1, 20):
        form = {"mdlNm": keyword, "sort": ""} if page == 1 else {"page": page, "mdlNm": keyword, "sort": ""}
        st, h = f.post_form(SK + "/customer/pageManual", form)
        got = re.findall(r"goGoodsSupportDetail\('(G\d+)','(\d+)','faq'\)", h) if st == 200 else []
        new = [g for g in got if g not in out]
        if not new:
            break
        out += new
        if str(page + 1) not in re.findall(r"<span>(\d+)</span>", h):
            break
    return out


def support_page(f, gid, mno):
    """제품 지원 페이지 (POST) → 모델 코드 · 이름 · 사진 · 사용설명서 파일 이름."""
    st, h = f.post_form(SK + "/customer/indexGoodsSupportDetail", {"goodsId": gid, "manualNo": mno, "clickGb": "faq"},
                        headers={"Accept": "text/html"})
    if st != 200:
        return None
    code = re.search(r'class="prdCode">\s*([^<]+?)\s*<', h)
    name = re.search(r'class="prdName">\s*([^<]+?)\s*<', h)
    img = re.search(r'class="thumbnail"><img src="([^"]+)"', h)
    man = re.search(r'class="manual">.*?<p class="txt">(.*?)</p>', h, re.S)
    return {"gid": gid, "code": code.group(1) if code else None, "name": K.F.html.unescape(name.group(1)) if name else "",
            "img": img.group(1) if img else None, "manual": re.sub(r"\s+", " ", man.group(1)).strip() if man else None}


def faq_texts(f, gb):
    """FAQ 목록 (POST, 쪽마다 10개) — 쪽 안의 JSON-LD FAQPage 에서 질문 · 답."""
    out = []
    for page in range(1, 20):
        st, h = f.post_form(SK + "/customer/faq/indexFaqList", {"searchType": "", "searchWord": "", "bbsGbNo": gb,
                                                               "upBbsGbNo": "117", "page": page}, headers={"Accept": "text/html"})
        m = re.search(r'<script type="application/ld\+json">\s*(\{.*?"FAQPage".*?\})\s*</script>', h or "", re.S)
        if st != 200 or not m:
            break
        qs = json.loads(m.group(1)).get("mainEntity", [])
        new = [(q["name"].strip(), re.sub(r"\s+", " ", q["acceptedAnswer"]["text"])) for q in qs]
        if not new or new[0] in out:
            break
        out += new
        if str(page + 1) not in re.findall(r"<span>(\d+)</span></a>", h):
            break
    return out


def collect(f, K_, sample=None):
    global K
    K = K_
    faq = faq_texts(f, FAQ_DW)
    spec = next(((q, a) for q, a in faq if "트리플케어" in q and "시방서" in q), None)
    print(f"[skmagic] 식기세척기 FAQ {len(faq)} · 설치시방서 {'있음' if spec else '없음'}", file=sys.stderr)
    if not spec:
        return []
    q, a = spec
    size = re.search(r"제품 사이즈\s*:\s*(W\s*\d+\s*X\s*D\s*\d+\s*X\s*H\s*\d+)\s*mm", a)
    niche = re.search(r"최소 내부 공간\s*:\s*(W\s*\d+\s*X\s*D\s*\d+\s*X\s*H\s*\d+)\s*mm(\s*\(주의사항[^)]*\))?", a)
    other = next((f"FAQ '{x}' — {y.strip()}" for x, y in faq if "설치 가능한 사이즈" in x), None)
    rows = []
    for gid, mno in support_items(f, "트리플케어"):
        p = support_page(f, gid, mno)
        # 시방서의 '제품 사이즈 W540 · H520' 은 6인용(DWA19…) 크기다 — 14인용 트리플케어(DWA90…)에는 붙이지 않는다
        if not p or not p["code"] or "14인용" in p["name"] or any(p["code"] in r["model_codes"] for r in rows):
            continue
        row = K.base_row(brand="SK매직", category="dishwasher", category_subtype="built_in", install_type="built_in",
                         model_name=re.sub(r"^\[[^\]]*\]\s*", "", p["name"]), model_codes=[p["code"]], line="트리플케어",
                         source_url=f"{SK}/customer/faq/indexFaqList#bbsGbNo={FAQ_DW}", page_url=f"{SK}/customer/indexManual",
                         image_source_url=p["img"], sale_status="판매종료(고객지원만)",
                         product_type_raw=f"FAQ '{q}' · 제품 지원 {gid} · 사용설명서 {p['manual'] or '-'}")
        d, _ = K.dims_of("(W x D x H)", size.group(1).replace("X", "x") if size else None, "wdh") if size else (None, None)
        K.put_dims(row, d, size.group(0) if size else None)
        row["tags"].append("요약문")      # 사양표가 아니라 FAQ 설치 안내 글 — 사람이 확인하기 전까지 미검증
        if niche:
            nd, _ = K.dims_of("(W x D x H)", niche.group(1).replace("X", "x"), "wdh")
            row["niche_min_w_mm"], row["niche_min_d_mm"], row["niche_min_h_mm"] = nd["w"][0], nd["d"][0], nd["h"][0]
            row["niche_raw"] = niche.group(0).strip()
        notes = [x for x in [re.search(r"반드시 금속 프레임[^-]*", a), re.search(r"천장부 마감 필요[^)]*\)", a)] if x]
        row["install_notes"] = " · ".join([n.group(0).strip() for n in notes] + ([other] if other else [])) or None
        rows.append(row)
        if sample and len(rows) >= sample:
            break
    return rows
