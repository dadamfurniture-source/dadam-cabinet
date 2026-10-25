# 콜러 (`kohler_faucet`) — 주방 수전 (KOHLER Korea)

2026-10-25 수집.

## 출처

| 무엇 | 어디 (공식) | 비고 |
|---|---|---|
| 목록 | `https://www.kohler.co.kr/browse/kitchen/Categories/kitchen-faucets` (제품 6개, `totalProducts 6`) | robots.txt 는 `/results/…` 검색 결과만 막는다 (직접 읽음) |
| 이름 · SKU · 사진 · 설치 방식 | 제품 페이지 `/productDetails/<모델>?skuid=<SKU>` (`安裝: 대붙이`, `og:image`) | 페이지 `치수:` 칸은 비어 있다 |
| 수전 구멍 · 바닥 지름 · 높이 · 토수 | 제품 페이지 `러프 인 / 사양 시트` · `설치 가이드` 링크 = `https://techcomm.kohler.com/techcomm/pdf/…pdf` (중국어 설치설명서 `安装尺寸` 그림, 숫자는 PDF 글자 층) | `매뉴얼`. techcomm robots.txt 없음 (404) |

- 수전 구멍 `Ø33~Ø40` 처럼 범위 → 작은 값 + `치수범위` (원문 `cutout_raw`). W = 바닥(몸통) 지름, D = 몸통 중심 ~ 토수구, 토수구 높이 · 상판 두께 · 호스는 `install_notes`.
- 설명서 그림의 모델 코드가 국내 판매 코드와 다른 4종은 `국내판매미확인` (그 코드의 치수 — 국내 모델과 같은지 모른다).
- 판독값은 `kohler_faucet.py DRAWINGS`. PDF 6장은 한 장씩 받아 글자 층 숫자와 그림을 맞췄다 (플러그인은 PDF 를 받지 않는다).

## 수집 수 (`out_kohler_faucet.json`)

| | 수 |
|---|---:|
| 목록 제품 / 행 | 6 / 5 (Graze 22061T-4 제외) |
| 모델 코드 (모델 + SKU) | 10 |
| 수전 구멍 있는 행 | 4 (모두 범위: 33 · 33 · 33.5 · 36) |
| SQL 로 가는 행 / 검증 / 미검증 | 5 / 1 (Malleco 562T-B4) / 4 (`국내판매미확인`) |

## 정확도가 떨어지는 행 — 사장님 확인용

| 모델 | 무엇이 불확실한가 | 주소 |
|---|---|---|
| Simplice 597T-B4 | 설명서는 `597T-C4`. 구멍 `Ø33.5~Ø41` → 33.5 (DB 는 정수라 SQL 에서 34) · 바닥 Ø50.8 → 51 | `techcomm…/1516334826385_597T-C4.pdf` |
| Elate 13963T-B4 | 설명서는 `13963T-C4`. 구멍 `Ø36~Ø42` → 36 · 바닥 Ø50.8 → 51 | `techcomm…/1516334718908_13963T-C4.pdf` |
| Taut 스윙 21369T-4 | 설명서는 74053T-4 · 21368T-4 · 21369T-4 · 21370T-4 공용인데 그림은 `74053T-4`. 구멍 `Ø33~Ø36` → 33 · 몸통 Ø45 | `techcomm…/1517307026119_21369T.pdf` |
| Taut 풀다운 21367T-4 | 설명서는 21366T-4 · 21367T-4 공용, 그림은 `21366T-4`. **수전 구멍 지름 표기 없음** (상판 아래 `Ø51` 은 뜻을 몰라 쓰지 않음). W 45 = 몸통 Ø45 | `techcomm…/1517307005794_21367T.pdf` |
| Malleco 562T-B4 | 그림 코드가 판매 코드와 같다 (검증). 구멍 `Ø33~Ø40` → 33 | `techcomm…/1474613547603_562t.pdf` |

## 건너뜀

| 모델 | 이유 |
|---|---|
| Graze 세미 프로 22061T-4 | 제품 페이지에 사양 시트 · 설치 가이드 PDF 가 없다 — 치수 · 수전 구멍 모름 |

## 실행

```bash
python -I collect.py --brands kohler_faucet --sample 3 --out sample_kohler_faucet
python -I collect.py --brands kohler_faucet --out out_kohler_faucet     # 요청 7 (캐시 뒤 0)
```
