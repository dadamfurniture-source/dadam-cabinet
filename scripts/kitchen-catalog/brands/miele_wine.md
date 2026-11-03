# 밀레 (Miele) 와인셀러 — `brands/miele_wine.py`

2026-11-03 하부장 가전 (종류 `wine_cellar`). 주방가전 `brands/miele.py` 는 고치지 않았다.

```bash
python -I collect.py --brands miele_wine --sample 3 --out sample_miele_wine
python -I collect.py --brands miele_wine --out out_miele_wine        # 요청 6개 (robots · 카테고리 2 · 상품 3)
```

## 어디서 가져오나

| | 주소 | 내용 |
|---|---|---|
| 목록 | `www.miele.co.kr/category/1015036/built-under-wine-units` (빌트언더 2) · `/category/1015034/built-in-wine-units` (빌트인 1) | 메뉴가 세부 구분을 정한다 — 빌트언더 → `under_counter`, 빌트인 → `built_in` |
| 치수 | 상품 페이지 사양 표 `기기 너비/높이/깊이(mm)` (묶음 `기기 치수(W x H x D)(mm)` 와 같다) | 제조사 글자 → 검증 |
| 니치 | `최소/최대 설치 너비(mm)` · `최소/최대 설치 높이(mm)` · `설치 깊이(mm)` | |
| 용량 · 병 | `총 사용 가능 용량(L)` · `0.75 l 보르도 병 기준(병 수량)` | 병 수는 이름과 `product_type_raw` 에 |
| 사진 | JSON-LD `primaryImageOfPage` (`media.miele.com/dam/…`) | 주소만 |

- robots.txt (2026-11-03 읽음): `/cart` · `*checkout*` · `*compare*` · `*logout*` · `/*/account/*` · `*&query=*` · `/pmedia/*` 등만 막는다. `/category/` · `/product/` 허용.

## 수집 (2026-11-03)

| 세부 | 행 | 모델 코드 | 검증 | W×H×D | 니치 W×H×D |
|---|---:|---:|---:|---|---|
| under_counter | 2 | 2 | 2 | KWT 6322 UG 597×820×577 (34병 · 94 L) | 600 × 820~870 × 580 |
| | | | | KWTUS 7054 F 597×819×579 (44병 · 110 L) | 600 × 820~880 × 560 |

- 빠진 것: '빌트인 와인셀러' 메뉴의 **KWT 2671 ViS** (MasterCool 컬럼, 높이 2127) — 하부장 칸이 아니다. 사이트맵에만 있는 KWT 2611 Vi 도 같은 컬럼이다. 둘 다 냉장고 수집기 `manual/miele.json` 에 refrigerator/wine 으로 있다.

## 정확도가 떨어지는 곳

- **KWTUS 7054 F 설치 깊이 560 < 기기 깊이 579.** 사이트 값 그대로 넣고 `install_notes` 에 남겼다. 앞판(유리 도어)이 장 앞으로 나오는 설치로 보이나 설치설명서로 확인하지 않았다 — 장 깊이를 정하기 전에 확인한다.
- KWTUS 7054 F 는 사이트 판매 상태가 `InStoreOnly` (매장 전용).
