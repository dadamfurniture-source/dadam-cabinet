# 엘레치 (`elleci`) — 싱크볼 (이탈리아 Elleci, 화강석 합성)

2026-10-25 수집. 국내 공식 유통사 **백조씽크** 사이트 Brand > Elleci 분류 (`https://baekjosink.com/products-category/elleci/`) — MIXOLOGY · DIALOGO 360 은 BAEKJO · PREMIUM 분류에도 같이 걸려 있다 (Elleci 분류가 있으면 엘레치로).
읽는 방법 · 치수 순서는 `baekjo.md` 와 같다 (`baekjo.py site_rows()`).

## 수집 수 (`out_elleci.json`)

| | 수 |
|---|---:|
| 행 / 모델 코드 | 8 / 8 |
| SQL 행 / 검증 / 미검증 / 건너뜀 | 8 / 8 / 0 / 0 |
| 따내기 (R 포함) | 8 (2) |
| 수전 구멍 | 0 (페이지에 없음) |
| 대표 사진 | 8 |

## 정확도가 떨어지는 행

| 모델 | 무엇이 불확실한가 | 주소 |
|---|---|---|
| 8종 모두 | 따내기가 `(인셋 설치 기준)` 값뿐 — 언더 설치 따내기는 없다 | `https://baekjosink.com/products-category/elleci/` |
| BLACK HOLE 940 · BEST 870 · BEST 360 · FOX360 · QUADRA 130 · KARISMA 105 | 따내기 R 없음 | 각 상품 페이지 |
| KARISMA 105 | 배수구 `사각배수구` | `/product_list/karisma-105/` |

## 제조사가 쓰는 종류 낱말

- 따내기 단서 `(인셋 설치 기준)` · `(인셋)`. 메뉴 `PREMIUM 씽크볼` (MIXOLOGY · DIALOGO 360).

## 실행

```bash
python -I collect.py --brands elleci --out out_elleci
```
