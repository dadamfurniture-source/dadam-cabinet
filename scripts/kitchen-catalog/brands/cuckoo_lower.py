"""쿠쿠 하부장 가전 — 언더싱크 · 빌트인 정수기 (cuckoo.co.kr 렌탈 상품). (2026-11-03)

목록: 렌탈 정수기 분류 페이지 /rental/productList?cateUid=… (222 냉온 · 223 얼음 · 224 정수전용 · 226 대용량 · 227 무전원).
      한 쪽에 13개까지 그린다. '더보기' 는 스크립트라 쓰지 않고, 같은 목록을 정렬(sort=3 가격낮은순 · 4 가격높은순)로
      한 번 더 열어 빠진 상품을 채운다. 이름에 '언더싱크' · '빌트인' 이 든 상품만 연다.
상세: /rental/productView?idx=… — 사양은 글자가 아니라 상품 설명 그림(gi.esmplus.com/cuckoohs/spec/<모델>/…, 쿠쿠가 올린
      공식 상세 그림)의 '제품정보고시' 표에만 있다. 그림을 사람이 읽어 아래 CK_SPEC 에 옮겼다 → '이미지판독' (미검증).
음식물처리기: 렌탈 '(렌탈)음식물처리기'(cateUid=220) 3개 — CFD-C151MODG(12.5L) · CFD-D301DCN*(건조분쇄형).
      이름 · 분류에 싱크대 설치 표시가 없다 (싱크대 위 · 바닥에 두는 형) → 넣지 않는다.
robots.txt (www.cuckoo.co.kr): /rest/ · /mycuckoo/ · 주문 · 추적 파라미터만 막는다 — /rental/productList · productView 허용.
  gi.esmplus.com · cdn.cuckoo.co.kr robots.txt 없음(404 · 규칙 없음) — 그림은 2026-11-03 robots 확인 뒤 한 장씩 받아 읽었다.
"""
import html
import re
import sys

BRAND_KEY = "cuckoo_lower"
K = None   # collect.py 가 넘긴다

CK = "https://www.cuckoo.co.kr"
LISTS = ["222", "223", "224", "226", "227"]
SORT_AGAIN = ["222", "226"]          # 13개 넘는 분류 (24 · 14개) — 정렬을 바꿔 다시 연다
UNDER = re.compile(r"언더싱크|빌트인")
ESM = "https://gi.esmplus.com/cuckoohs/spec"

# 상품 설명 그림 '제품정보고시' 를 사람이 읽은 값 — 모델 코드(끝 (S) 뗀 것) → 값.
#   dims = (W, D, H) mm, 그림 표기 그대로. faucet = 파우셋(상판 위) 크기 원문
CK_SPEC = {
    "CP-AAS100ULDSV": dict(dims=(166, 390, 418), raw="본체 : 166(W) X 390(D) X 418(H)mm",
                           faucet="파우셋 : 61(W) X 187(D) X 306(H)mm", sub="hot_cold",
                           kind="전기냉수기 / 쿠쿠 냉온정정수기 · 220V 60Hz 2,600W (냉수 0.6A · 온수 2,500W)",
                           img=f"{ESM}/CP-AAS100ULDSV/10.jpg"),
    "CP-AAS100ULWH": dict(dims=(166, 390, 418), raw="본체 : 166(W) X 390(D) X 418(H)mm",
                          faucet="파우셋 : 61(W) X 187(D) X 306(H)mm", sub="hot_cold",
                          kind="전기냉수기 / 쿠쿠 냉온정정수기 · 220V 60Hz 2,600W (냉수 0.6A · 온수 2,500W)",
                          img=f"{ESM}/CP-AAS100ULWH/10.jpg"),
    "CP-AD011UGW": dict(dims=(145, 365, 330), raw="크기/중량 W145 x D365 x H330mm / 약 3kg", faucet=None, sub="purify",
                        kind="쿠쿠 직수 정수기 (무전원 빌트인 언더싱크)", img=f"{ESM}/CP-AD011UGW.jpg"),
}


def list_items(f):
    items = {}
    urls = [f"{CK}/rental/productList?cateUid={c}" for c in LISTS]
    urls += [f"{CK}/rental/productList?cateUid={c}&filter=&sort={s}" for c in SORT_AGAIN for s in (3, 4)]
    for url in urls:
        st, h = f.get(url)
        if st != 200:
            continue
        for m in re.finditer(r'data-no="(\d+)".*?<img src="([^"]+)"[^>]*>.*?class="category">([^<]*)</span>\s*'
                             r'<span class="code_no">([^<]*)</span>', h, re.S):
            idx, img, code, name = m.group(1), m.group(2), m.group(3).strip(), html.unescape(m.group(4)).strip()
            items.setdefault(idx, (code, name, img))
    return items


def disposer_names(f):
    st, h = f.get(f"{CK}/rental/productList?cateUid=220")
    return [(m.group(1).strip(), html.unescape(m.group(2)).strip())
            for m in re.finditer(r'class="category">([^<]*)</span>\s*<span class="code_no">([^<]*)</span>', h if st == 200 else "")]


def collect(f, K_, sample=None):
    global K
    K = K_
    items = list_items(f)
    picks = {i: v for i, v in items.items() if UNDER.search(v[1])}
    disp = disposer_names(f)
    print(f"[cuckoo_lower] 렌탈 정수기 {len(items)} · 언더싱크/빌트인 {len(picks)} · 음식물처리기 {len(disp)} "
          f"(싱크대 설치형 {sum(1 for c, n in disp if re.search(r'싱크|빌트인|언더', n))})", file=sys.stderr)
    rows = []
    for idx, (code, name, img) in sorted(picks.items(), key=lambda x: int(x[0])):
        url = f"{CK}/rental/productView?idx={idx}"
        st, h = f.get(url)
        if st != 200:
            continue
        base = re.sub(r"\(S\)$", "", code)
        spec = CK_SPEC.get(base)
        shown = re.findall(re.escape(ESM) + r"/[^\"' ]+", h)
        row = K.base_row(brand="쿠쿠", category="water_purifier", category_subtype=(spec or {}).get("sub"), install_type="built_in",
                         model_name=re.sub(r"^\[[^\]]*\]\s*", "", name), model_codes=[base], line="인스퓨어",
                         source_url=(spec or {}).get("img") or url, page_url=url,
                         image_source_url=img if img.startswith("https://") else None,
                         product_type_raw=" / ".join(x for x in [f"렌탈 코드 {code}", (spec or {}).get("kind"),
                                                                 f"상세 그림 {len(shown)}장"] if x))
        if not spec:
            K.put_dims(row, None, None)
            rows.append(row)
            continue
        w, d_, hh = spec["dims"]
        dd, _ = K.dims_of("(W x D x H)", f"{w} x {d_} x {hh}", "wdh")
        K.put_dims(row, dd, spec["raw"])
        row["tags"].append("이미지판독")
        if spec.get("faucet"):
            row["install_notes"] = f"{spec['faucet']} (상판 위 파우셋 — 본체는 싱크대 안, 상품 설명 그림 '제품정보고시')"
        rows.append(row)
        if sample and len(rows) >= sample:
            break
    return rows
