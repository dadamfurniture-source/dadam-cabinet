"""싱크퓨어 (SinkPure, (주)신화창조) 싱크대 디스포저 — sinkpure.com (본사) · sink-pure.imweb.me (본사 쇼핑몰). 2026-11-03

하부장 가전 (사장님 2026-11-03 "모델까지 수집해 카탈로그에 넣음") — 종류 food_disposer.

가정용 (분쇄 + 2차 수거통 — 싱크볼 배수구 아래에 분쇄기, 옆에 수거통):
  치수 = 본사 '싱크퓨어 가정용' 페이지(/bbs/content.php?co_id=p_home)의 시리즈별 그림 '사이즈 높이 × 가로 × 두께(직경)'.
         글자가 그림에만 있어 2026-11-03 에 눈으로 읽어 아래 HOME 에 옮겼다 (태그 '이미지판독'). 그림 파일 이름으로 묶어,
         페이지에서 그 그림이 빠지면 치수를 넣지 않는다 (치수확인필요 → SQL 에서 빠진다).
  모델 코드 = 본사 쇼핑몰 메뉴 '고급 SP400 · 최고급 SP500 · 최고급플러스 SP600' 과 상품 이름 '싱크퓨어 음식물 처리기 고급형 SP400'.
         코드가 없는 표준형 · 700 프리미엄(특별주문생산) · 600 프리미엄 플러스(수출 · 특별주문생산)는 뺀다 (sinkpure.md).
  가로 350 = 분쇄기 + 옆 수거통을 함께 잰 폭, 두께 · 직경 172 = 분쇄기 지름 (수거통 지름은 적혀 있지 않다).
업소용: '싱크퓨어 업소용' 페이지(co_id=p_place) 글자 표 — 설치방식 '언더싱크형(기존 싱크대 아래 장착)' 인 모델만 (독립형 KDF750A 는 뺀다).
robots.txt: sinkpure.com 없음(404 → 허용). sink-pure.imweb.me 는 첫 줄이 'Allow: /' 라 파이썬 robotparser 가 아래 Disallow
            (/site_join · /site_join_agree · /shop_cart · /?mode*) 를 놓친다 — 이 파일은 상품 소개 페이지(/disposer-sp400 …)만 부른다.
"""
import re
import sys

BRAND_KEY = "sinkpure"
K = None   # collect.py 가 넘긴다

SP = "https://sinkpure.com"
SHOP = "https://sink-pure.imweb.me"
BRAND = "싱크퓨어"
CERT = "한국물기술인증원 주방용오물분쇄기 인증 (2024-09 · 2024-10 · 2025-21호)"

# 가정용 페이지 그림 (눈으로 읽음 · 2026-11-03). 그림 파일 이름 → 값
HOME = {
    "f9914b80ec0daaae8795312c175665ba_1778119350_7823.png": {
        "code": "SP400", "shop": "disposer-sp400", "grade": "고급형", "series": "400 시리즈",
        "size": "높이: 290 X 가로: 350 X 두께: 172", "spec": "0.6HP / 4,200rpm · 본체 4.5kg · 속도조절칼날 > 3열미세칼날강판 > 강력허머 칼날 분쇄",
    },
    "f9914b80ec0daaae8795312c175665ba_1778119329_9172.jpg": {
        "code": "SP500", "shop": "disposer-sp500", "grade": "최고급형", "series": "500 시리즈",
        "size": "높이: 310 X 가로: 350 X 두께: 172", "spec": "0.75HP / 4,000rpm · 본체 4.7kg · 속도조절칼날 > 3열미세칼날강판 > 강력허머 칼날 분쇄",
    },
    "f9914b80ec0daaae8795312c175665ba_1778119310_8421.jpg": {
        "code": "SP600", "shop": "disposer-sp600", "grade": "최고급플러스", "series": "600 시리즈",
        "size": "높이: 380 X 가로: 350 X 직경: 172", "spec": "1HP / 3,800rpm · 본체 5.7kg · 뚜껑 · 발판 동시 사용 · 속도조절칼날 > 3열미세칼날강판 > 강력허머 분쇄",
    },
}


def dims(size):
    """'높이: 290 X 가로: 350 X 두께: 172' → {'h','w','d'} — 이름 붙은 칸만 (두께 · 직경 = 깊이)."""
    key = {"높이": "h", "가로": "w", "두께": "d", "직경": "d"}
    out = {}
    for name, v1, v2 in re.findall(r"(높이|가로|두께|직경)\s*:\s*(\d+)(?:\s*\((\d+)\))?", size):
        lo = int(v1)
        hi = int(v2) if v2 else lo
        out[key[name]] = (min(lo, hi), max(lo, hi))
    return out if sorted(out) == ["d", "h", "w"] else None


def home_rows(f, sample):
    url = f"{SP}/bbs/content.php?co_id=p_home"
    st, h = f.get(url)
    imgs = set(re.findall(r"/data/editor/\d+/([\w.]+)", h)) if st == 200 else set()
    items = list(HOME.items())
    if sample:
        items = items[:sample]
    rows = []
    for img, m in items:
        sst, sh = f.get(f"{SHOP}/{m['shop']}")
        st_txt = re.sub(r"\s+", " ", K.F.html_to_text(sh)) if sst == 200 else ""
        name = re.search(r"싱크퓨어 음식물 처리기 (\S+) (SP\d{3})", st_txt)
        if not name or name.group(2) != m["code"]:
            print(f"[sinkpure] 쇼핑몰 {m['shop']} 에서 {m['code']} 를 찾지 못했다 — 건너뜀", file=sys.stderr)
            continue
        row = K.base_row(brand=BRAND, category="food_disposer", category_subtype="grinder", install_type="built_in",
                         model_name=f"싱크퓨어 음식물 처리기 {name.group(1)} {m['code']}", model_codes=[m["code"]], line="가정용",
                         source_url=url, page_url=f"{SHOP}/{m['shop']}",
                         product_type_raw=f"{m['series']} {m['grade']} · 분쇄 + 2차 수거형 · {m['spec']} · {CERT}")
        row["tags"].append("이미지판독")
        row["install_notes"] = "싱크볼 배수구 아래 분쇄기 + 옆 2차 수거통. 가로 350 은 둘을 함께 잰 폭, 두께 · 직경 172 는 분쇄기 지름 (수거통 지름은 없다)"
        if img not in imgs:
            print(f"[sinkpure] 가정용 페이지에 {m['code']} 그림이 없다 — 치수 없이", file=sys.stderr)
            K.put_dims(row, None, None)
        else:
            K.put_dims(row, dims(m["size"]), f"사이즈 {m['size']} (가정용 페이지 그림)")
        rows.append(row)
    return rows


def place_rows(f):
    """업소용 페이지 글자 — '<코드> 사이즈 높이: 350 X 가로: 350 X 두께: 400(540) … 설치방식 언더싱크형(…)'."""
    url = f"{SP}/bbs/content.php?co_id=p_place"
    st, h = f.get(url)
    t = re.sub(r"\s+", " ", K.F.html_to_text(h)) if st == 200 else ""
    rows = []
    for m in re.finditer(r"(KDF\w+) 사이즈 (높이:.*?)(?= 모터사양) 모터사양 (.*?) 작동시간 (.*?) 처리용량 (.*?) 작동방법 (\S+) 설치방식 (\S+?)(?=\s|$)", t):
        code, size, motor, run, cap, op, inst = m.groups()
        if "언더싱크" not in inst:
            continue
        row = K.base_row(brand=BRAND, category="food_disposer", category_subtype=None, install_type="built_in",
                         model_name=f"싱크퓨어 업소용 {code}", model_codes=[code], line="업소용", source_url=url, page_url=url,
                         product_type_raw=f"업소용 · 모터 {motor} · 작동시간 {run} · 처리용량 {cap} · {op} · 설치방식 {inst}")
        row["install_notes"] = "두께 '400(540)' 의 괄호 값 뜻은 페이지에 없다 — 작은 값을 넣었다"
        K.put_dims(row, dims(size), "사이즈 " + size.strip())
        rows.append(row)
    return rows


def collect(f, K_, sample=None):
    global K
    K = K_
    rows = home_rows(f, sample)
    rows += place_rows(f)
    return rows
