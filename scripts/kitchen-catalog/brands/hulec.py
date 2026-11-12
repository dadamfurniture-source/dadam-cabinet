"""휴렉 (HULEC) 싱크대 설치형 음식물처리기 — www.hulec.co.kr (휴렉 공식몰, 카페24). 2026-11-03

하부장 가전 (사장님 2026-11-03 "모델까지 수집해 카탈로그에 넣음") — 종류 food_disposer.

목록: 홈 메뉴 '제품소개' 중 '(설치형)' 소개 페이지 — 지니(설치형) /product/intro3.html · 윈디(설치형) /product/intro4.html.
      스탠딩(히어로 · 히트 · 베로)은 싱크대 위 · 바닥에 두는 독립형이라 뺀다. '빌틴(빌트인형)' 메뉴는 HTML 주석으로 막혀 있다 (판매 안 함).
치수: 소개 페이지의 '설명서 다운로드' PDF (houssen02.cafe24.com/hulec/manual_*.pdf) '제품규격' 표.
      PDF 가 글자 층 없이 그림뿐이라 2026-11-03 에 쪽을 그림으로 만들어 눈으로 읽었다 → 아래 MANUAL 에 옮겼다 (태그 '이미지판독' · '매뉴얼').
      이 파일은 PDF 를 받지 않는다 — 소개 페이지가 같은 설명서를 걸고 있는지, 설치장소가 '싱크대' 인지만 다시 본다.
      설명서가 바뀌면(주소가 다르면) 치수를 넣지 않는다 (치수확인필요 → SQL 에서 빠진다).
robots.txt: www.hulec.co.kr — 카페24 기본 (/exec/front/ · /member/ · /myshop/ · /skin-*/ · 게시판 쪽 넘김 금지). 소개 · 상품 페이지만 부른다.
            houssen02.cafe24.com — 'User-agent: Yeti' 만 있다 (우리 UA 는 막지 않음). 2026-11-03 확인.
"""
import math
import re
import sys

BRAND_KEY = "hulec"
K = None   # collect.py 가 넘긴다

HL = "https://www.hulec.co.kr"
BRAND = "휴렉"

# 설명서 '제품규격' 표 (그림을 눈으로 읽음 · 2026-11-03). 설명서 주소 → 값
MANUAL = {
    "https://houssen02.cafe24.com/hulec/manual_gini.pdf": {
        "code": "HB-3100H", "name": "휴렉 지니 (설치형) 음식물처리기",
        "subtype": "grinder_microbial",
        # '기기별 외관치수 — 디스포저 ( H285 x W185 x D185 ) · 2차 처리기 ( H337 x W470 x D244 )' — 하부장에 놓이는 것은 2차 처리기
        "label": "2차 처리기 (H x W x D)", "size": "337 x 470 x 244",
        "raw": "기기별 외관치수: 디스포저 (H285 x W185 x D185) · 2차 처리기 (H337 x W470 x D244)",
        "notes": "디스포저(1차 분쇄기)는 싱크볼 배수구 아래 H285 x W185 x D185 — 외경 칸은 하부장 바닥에 놓는 2차 처리기",
        "type": "주방용오물분쇄기 · 분쇄 + 미생물 분해 (특수 가공 미생물 담체 · 분말 미생물) · 1회 최대 500g · 정격 500W · 총중량 12.5kg (설치부품 포함)",
        "page": "/product/intro3.html", "product_no": "257",
    },
    "https://houssen02.cafe24.com/hulec/manual_windi.pdf": {
        "code": "SM-9100K", "name": "휴렉 윈디 (설치형) 음식물처리기",
        "subtype": "dryer",
        # '제품치수 235 ㎜(W) × 340.5 ㎜(D) × 406.5 ㎜(H)' — 싱크대 배수구에 붙는 한 몸 (싱크대장착부 · 보관함 서랍)
        "label": "제품치수 (W x D x H)", "size": "235 x 340.5 x 406.5",
        "raw": "제품치수: 235 ㎜(W) × 340.5 ㎜(D) × 406.5 ㎜(H)",
        "notes": "싱크볼 배수구에 붙는 한 몸 (싱크대장착부 · 앞 보관함 서랍 · 뒤 송풍 · 배수 · 급수 호스 연결부). 소수 치수는 올려 넣었다 (340.5 → 341 · 406.5 → 407)",
        "type": "건조분쇄식 · 설치장소 싱크대 및 수납 스페이스 · 1회 500g · 감량률 95% 내외 · 소비전력 195W · 9.3kg",
        "page": "/product/intro4.html", "product_no": "319",
    },
}


def manual_link(h):
    m = re.search(r'href="(https?://houssen02\.cafe24\.com/hulec/manual_\w+\.pdf)"', h)
    return m.group(1).replace("http://", "https://") if m else None


def product_image(f, product_no):
    """상품 페이지 대표 사진 (big)."""
    st, h = f.get(f"{HL}/product/detail.html?product_no={product_no}")
    if st != 200:
        return None
    m = re.search(r'(?:src|ec-data-src)="(//www\.hulec\.co\.kr/web/product/big/[^"]+\.(?:jpg|png))"', h)
    return "https:" + m.group(1) if m else None


def ceil_dims(size, label):
    """'235 x 340.5 x 406.5' — 소수는 올린다 (장 안 치수를 줄이지 않게). 칸 순서는 이름에서."""
    seq = K.order_of(label, "whd")
    nums = [math.ceil(float(x)) for x in re.findall(r"\d+(?:\.\d+)?", size)]
    if len(nums) < 3:
        return None
    return {k: (v, v) for k, v in zip(seq, nums[:3])}


def collect(f, K_, sample=None):
    global K
    K = K_
    rows = []
    items = list(MANUAL.items())
    if sample:
        items = items[:sample]
    for want_pdf, m in items:
        url = HL + m["page"]
        st, h = f.get(url)
        if st != 200:
            print(f"[hulec] {url} {st} — 건너뜀", file=sys.stderr)
            continue
        t = re.sub(r"\s+", " ", K.F.html_to_text(h))
        place = re.search(r"설치장소\s*:\s*([^*]+?)\s*\*", t)
        if not place or "싱크대" not in place.group(1):
            print(f"[hulec] {m['page']} 설치장소가 싱크대가 아니다 — 건너뜀", file=sys.stderr)
            continue
        pdf = manual_link(h)
        row = K.base_row(brand=BRAND, category="food_disposer", category_subtype=m["subtype"], install_type="built_in",
                         model_name=m["name"], model_codes=[m["code"]], line="설치형", source_url=pdf or want_pdf,
                         page_url=url, image_source_url=product_image(f, m["product_no"]),
                         product_type_raw=f"{m['type']} · 설치장소 {place.group(1).strip()}")
        row["tags"] += ["이미지판독", "매뉴얼"]
        row["install_notes"] = m["notes"]
        if pdf != want_pdf:   # 설명서가 바뀌었다 — 옮겨 적은 값을 쓰지 않는다
            print(f"[hulec] {m['page']} 설명서 주소가 다르다 ({pdf}) — 치수 없이", file=sys.stderr)
            K.put_dims(row, None, None)
        else:
            K.put_dims(row, ceil_dims(m["size"], m["label"]), m["raw"])
        rows.append(row)
    return rows

