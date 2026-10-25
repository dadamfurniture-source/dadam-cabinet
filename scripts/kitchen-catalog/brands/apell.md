# 아펠 (`apell`) — 싱크볼 (이탈리아 Apell)

2026-10-25 수집. 국내 공식 유통사 **백조씽크** 사이트 Brand > Apell 분류 (`https://baekjosink.com/products-category/apell/`).
읽는 방법 · 치수 순서는 `baekjo.md` 와 같다 (`baekjo.py site_rows()`).

## 수집 수 (`out_apell.json`)

| | 수 |
|---|---:|
| 행 / 모델 코드 | 7 / 7 |
| SQL 행 / 검증 / 미검증 / 건너뜀 | 7 / 7 / 0 / 0 |
| 따내기 (R 포함) | 7 (4) |
| 수전 구멍 | 0 (페이지에 없음) |
| 대표 사진 | 7 |

## 정확도가 떨어지는 행

| 모델 | 무엇이 불확실한가 | 주소 |
|---|---|---|
| SFERA 901K (860 × 490) · LINEAR SERIES (1140 × 480) · FERRARA ZERO (728 × 406) | 따내기 R 없음 · 언더/인셋 표시 없음 | `https://baekjosink.com/product_list/sfera-901k/` · `/linear-series/` · `/ferrara-zero/` |
| LINEAR SERIES | 이름이 시리즈 이름 (한 페이지 한 크기 1160 × 500 × 215) | `/product_list/linear-series/` |
| FERRARA PLUS (750 × 440) | 이름에 크기가 없다 — 같은 시리즈 540 · 840 · 940 과 다른 페이지 | `/product_list/ferrara-plus/` |

## 제조사가 쓰는 종류 낱말

- 메뉴 낱말 없음 (Apell 분류만). 배수구 `Ø 162 or Ø 89`.

## 실행

```bash
python -I collect.py --brands apell --out out_apell
```
