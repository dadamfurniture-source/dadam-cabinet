# Blanco (`blanco_faucet`) — 주방 수전 (국내 공식 유통 백조씽크)

2026-10-25 수집. 백조씽크 사이트 `Brand > Blanco` 분류 중 `수전` 분류. 읽는 코드 · 칸 · 규칙은 `baekjo_faucet.md` 와 같다 (`baekjo_faucet.py faucet_rows()`).

## 출처

| 무엇 | 어디 (공식) | 비고 |
|---|---|---|
| 목록 · 사진 | `https://baekjosink.com/wp-json/wp/v2/product_list` (분류 `blanco` + `faucet`) | robots.txt `/wp-admin/` 만 금지 |
| 수전 구멍 · 높이 | 상품 페이지 `높이(H)` · `지름(C) Φ 35` · `타공 권장 사이즈 Φ 33 ~ 35 mm` | 글자 |
| W · D | 상품 페이지 `도면 PDF 다운로드` `wp-content/uploads/2023/09/<모델>-도면.pdf` — Blanco 원 도면 (바닥 ø · 토수 길이 · 높이 · 토수구 높이) | 그림 → `이미지판독` |

- W = 도면의 **바닥 지름 ø52 · ø54**, D = 몸통 중심 ~ 토수구 (도면 치수), H = 페이지 `높이(H)` (도면과 같음).
- 수전 구멍 = 페이지 `Φ 33 ~ 35 mm` 의 작은 값 **33** + `치수범위`.

## 수집 수 (`out_blanco_faucet.json`)

| | 수 |
|---|---:|
| 행 / 모델 코드 | 8 / 8 |
| 수전 구멍 있는 행 | **8** (모두 33 + 치수범위) |
| SQL 로 가는 행 / 검증 / 미검증 | 5 / 0 / 5 (MILI · MILA · MIDA · CATRIS-S · MILA-S — 도면 판독 `이미지판독`) |
| 건너뜀 (W 없음) | 3 — CATRIS-S Flexo · MIDA-S · LINUS-S |

## 정확도가 떨어지는 행 — 사장님 확인용

| 모델 | 무엇이 불확실한가 | 주소 |
|---|---|---|
| 8종 모두 | 수전 구멍 33 은 페이지 `Φ 33 ~ 35` 의 작은 값 (Blanco 원 도면은 35 를 쓰는 곳이 많다) | 각 상품 페이지 |
| MIDA | 도면 `ømin.35 / ømax.45` 인데 페이지는 `Φ 33 ~ 35` → 33 넣고 `출처불일치` | `/product_list/mida/` · `uploads/2023/09/MIDA-도면.pdf` |
| MILA-S | 도면에 전체 높이가 없다 (263 은 토수구 높이) → 높이는 페이지 297 | `/product_list/mila-s/` |
| MILI | 도면의 `ø45` (상판 쪽 표시) 뜻을 모른다 — 쓰지 않음 | `uploads/2023/09/MILI-도면.pdf` |
| CATRIS-S Flexo | 도면에 바닥 지름이 없다 (높이 475 · 토수 187 은 size_raw) → SQL 제외 | `/product_list/catris-s-flexo/` |
| MIDA-S | 도면에 바닥 지름 · 전체 높이가 없다 (토수 186 · `ø35`) → SQL 제외 | `/product_list/mida-s/` |
| LINUS-S | 페이지에 MIDA-S 도면이 붙어 있다 (높이 284 ≠ MIDA-S 336) → 도면 값을 쓰지 않음, 높이만 | `/product_list/mida-s-2/` |

## 실행

```bash
python -I collect.py --brands blanco_faucet --sample 3 --out sample_blanco_faucet
python -I collect.py --brands blanco_faucet --out out_blanco_faucet
```
