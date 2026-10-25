# 블랑코 (`blanco`) — 싱크볼 (독일 BLANCO)

2026-10-25 수집. 국내 공식 유통사 **백조씽크** 사이트 Brand > Blanco 분류 (`https://baekjosink.com/products-category/blanco/`).
백조씽크는 2020년 블랑코와 국내 독점 유통 계약을 맺었다 (아시아경제 2020-03-05 기사 — 찾는 데만 썼다). 읽는 방법 · 치수 순서 · 도면 대조는 `baekjo.md` 와 같다 (`baekjo.py site_rows()`).
blanco.com 본사 사이트는 한국 페이지가 없어 쓰지 않았다.

## 수집 수 (`out_blanco.json`)

| | 수 |
|---|---:|
| Blanco 분류 상품 | 18 (그중 수전 8 제외) |
| 행 / 모델 코드 | 10 / 10 |
| SQL 행 / 검증 / 미검증 / 건너뜀 | 10 / 10 / 0 / 0 |
| 따내기 (R 포함) | 10 (10) |
| 수전 구멍 | 0 (페이지에 없음) |
| 대표 사진 | 10 |

## 정확도가 떨어지는 행

| 모델 | 무엇이 불확실한가 | 주소 |
|---|---|---|
| SUBLINE 800-U · 500-U · ETAGON 500-U · 700-U · CLARON 700-U | 따내기 = 볼 크기 (예 800 × 400 R10). 언더 기준으로 보이나 페이지에 언더 · 인셋 표시가 없다 | `https://baekjosink.com/product_list/subline-800-u/` 등 |
| ELON XL 8S | 따내기 `(인셋 설치 기준) 840X480XR15mm` — 인셋 기준만 있다 | `/product_list/elon-xl-8s/` |
| ZIA 9 | ELON XL 8S 와 외경 · 따내기가 같다 (2볼). 시리즈를 `line` 에 넣어 한 행으로 묶이지 않게 했다 | `/product_list/zia-9/` |
| 모델 코드 | 페이지 이름(SUBLINE 800-U 등)을 그대로 넣었다 — Blanco 품번(6자리)은 페이지에 없다 | — |

## 제조사가 쓰는 종류 낱말

- 이름 끝 `-U` (언더) · `-IU` (인셋 · 언더 겸용) — Blanco 이름 규칙. 페이지에 설명은 없다 (`product_type_raw` 비움).
- 따내기 단서 `(인셋 설치 기준)`.
- 배수구 `89(SS)` · `89 & 89 (DY)`.

## 실행

```bash
python -I collect.py --brands blanco --out out_blanco
```
