# 가게나우 (Gaggenau) 와인셀러 — `brands/gaggenau_wine.py`

2026-11-03 하부장 가전 (종류 `wine_cellar`). 주방가전 `brands/gaggenau.py` 는 고치지 않았다 (도움 함수는 이 파일에 따로).

```bash
python -I collect.py --brands gaggenau_wine --sample 3 --out sample_gaggenau_wine
python -I collect.py --brands gaggenau_wine --out out_gaggenau_wine   # 요청 약 15개 (사이트맵은 주방가전 캐시와 같다)
```

## 어디서 가져오나

| | 주소 | 내용 |
|---|---|---|
| 국내 판매 | 공식 수입사 ㈜화인어프라이언스 `www.fineappliances.co.kr/wine_list.php` → `wine_view1.php` · `wine_view2.php` | '와인냉장고' 2종. 상세 '제품 스펙' 글자 `제품 규격 597x818~868x575 (WxHxD)` · `내부용량 34병 (750ml기준)` |
| 글로벌 | `www.gaggenau.com/global/sitemap.xml` 의 `/global/en/mkt-product/wine-climate-cabinets/…` (10종) | JSON-LD `Dimensions (HxWxD)` · `Niche dimensions (HxWxD)` · `Installation` · 병 수 |
| 사진 | 수입사 목록 썸네일 (`/img/wine_t2_1.jpg`) · 글로벌 `Product_Shots` | 주소만 |

- robots.txt (2026-11-03): fineappliances.co.kr 없음(404 → 허용). gaggenau.com 은 `/*ajax/` · `/productdrawings/` · `/manual/` · `/*/comparison/` · `/*/search/` … 를 막고 `/global/en/mkt-product/` 허용. 치수도 그림은 받지 않았다.
- 세부 구분: 글로벌 `Installation` 에 `under-counter` → `under_counter`, `Integrated` 만 → `built_in`. 수입사 RW404-261 은 수입사 글에 설치 방식이 없어 높이(818~868, 상판 아래 칸)와 '빌트인 구조' 문구로 `under_counter` (근거는 `product_type_raw`).

## 수집 (2026-11-03)

| 출처 | 세부 | 모델 | W×H×D | 니치 W×H×D | 검증 |
|---|---|---|---|---|---|
| 수입사 | under_counter | RW404-261 (34병) | 597 × 818(~868) × 575 | (그림뿐 — 비움) | 검증 (`치수범위`) |
| 글로벌 | under_counter | RW204070 (38병) | 597 × 859 × 564 | 600 × 860 × 565 | `국내판매미확인` |
| 글로벌 | under_counter | RW404264 (34병) | 597 × 818 × 570 | 600 × 820 × 580 | `국내판매미확인` |

- 행 3 · 모델 코드 4 (RW404-261 · RW404261 · RW204070 · RW404264) · 검증 1 · 미검증 2 · 니치 2행.
- 빠진 것 (높이 950 넘는 컬럼 — 하부장 칸 아님, 냉장고 수집기가 refrigerator/wine 으로 넣었다): 수입사 **RW466-964** (603×2029×608, 99병), 글로벌 RW222263 (1218) · RW282263 (1770) · RW414305 · RW414365 · RW466305 · RW466365 (2125) · RVW417170 · RVW467170 (2123).

## 정확도가 떨어지는 곳

- **RW404-261 높이 818~868** — 수입사 글자가 범위(다리 조절)라 낮은 값 818 을 넣고 `치수범위` 를 달았다 (검증은 유지).
- **RW404-261(수입사)과 RW404264(글로벌)** 는 코드가 달라 따로 넣었다. 글로벌 RW404264 페이지의 제품 사진 파일 이름이 `…RW404261…` 이라 같은 제품의 다른 판일 수 있다 — 깊이가 다르다 (수입사 575 · 글로벌 570). 국내 판매 모델은 수입사 RW404-261 이다.
- 글로벌 두 행은 국내 수입사 목록에 없다 — `국내판매미확인` (미검증). 판매 상태도 글로벌 사이트 `OutOfStock`.
- 냉장고 수집기(2026-10-20, 글로벌 사이트맵)가 RW204070 · RW404264 를 refrigerator/wine 으로 넣었을 가능성이 크다 (그 수집기 `GG_DRAWINGS` 에 RW204070 · RW404261 치수도가 있다) — 가져오기 SQL 이 같은 코드를 와인셀러로 옮긴다.
