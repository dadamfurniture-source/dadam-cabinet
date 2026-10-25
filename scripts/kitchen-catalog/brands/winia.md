# 위니아 (`brands/winia.py`, `--brands winia`, brand `위니아`)

2026-10-25 수집. 전자레인지 · 복합오븐(전자레인지 겸용) · 인덕션/하이브리드 전기레인지 · 식기세척기 · 딤채쿡 밥솥.

```bash
python -I collect.py --brands winia --sample 3 --out sample_winia   # 메뉴마다 3개
python -I collect.py --brands winia --out out_winia                 # 전체 (요청 약 77개, 캐시 뒤 0개)
```

## 어디서 가져오나

| 무엇 | 주소 | 비고 |
|---|---|---|
| 목록 | `POST https://www.winia.com/product/list_ajax` (form) — `TYPE` · `GNB_SEQ` | 냉장고 수집기와 같은 API. 전자레인지 `4/2080` · 오븐 `4/2079` · 인덕션 `5/2081` · 하이브리드 `5/2082` · 식기세척기 `6/2083` · 당질저감 밥솥 `3/2072` (홈 화면 메뉴 링크에서 읽음) |
| 치수 | `https://www.winia.com/product/view?PRODUCT_SEQ=…` '제품사양' 표 | `제품 사이즈(WxHxD)mm` · `사이즈(W x D x H)mm` · `크기(WxHxD)mm` — 칸 이름의 순서로 읽는다. 조리실 · 내부 칸은 뺀다 |
| 사용설명서 | `https://www.winiaaid.com/solution/manualList?modelName=…` (위니아에이드 — winia.com 상세 페이지의 '사용설명서' 단추가 거는 공식 내려받기) → `/file/download?fileId=…&fileSeq=…` PDF | 목록 HTML 은 Fetcher, PDF 는 curl 로 따로 받아 읽고(1.5초 간격) 값을 `WN_MANUAL` 에 옮겼다 |

- robots.txt: `www.winia.com` 은 냉장고 수집기 때와 같다 (상품 경로 허용). `www.winiaaid.com/robots.txt` 는 404 (제한 없음).
- 목록 한 칸 = 모델 코드 하나. 상세의 색상 칩(`fnMoveDetail`) 중 목록에 없는 상품도 따라간다.
- 종류: '오븐' 메뉴 6종은 모두 가열방식에 '전자레인지'가 있어 `microwave` `combi` (설명서 정격출력 '전자레인지 700~800 W'). 전자레인지 메뉴는 `solo`. 인덕션 `induction` · 하이브리드 `hybrid` — '스탠딩8cm/15cm' 은 `freestanding`, 나머지는 `built_in`. 식기세척기 2종은 싱크대 위 크기라 `countertop` (6인용 '설치형'=수도 연결, 3인용 '무설치형').

## 수집 수 (out_winia.json → to_sql 기준)

| 종류 | 행 | 모델 코드 | 검증 | 미검증 | SQL 건너뜀 |
|---|---:|---:|---:|---:|---:|
| 전자레인지 · 복합오븐 | 23 | 48 | 23 | 0 | 0 |
| 쿡탑 (인덕션 · 하이브리드) | 8 | 8 | 4 | 4 | 0 |
| 식기세척기 | 2 | 2 | 1 | 1 | 0 |
| 밥솥 | 3 | 13 | 1 | 2 | 0 |
| **합계** | **36** | **71** | **29** | **7** | **0** |

- 타공이 들어간 쿡탑 4행 (560 × 480 mm, 뒤 벽 40 mm — 설명서 9쪽 그림).
- 대표 사진 36행 (`/common/file/imageView?IMG_PATH=…`).

## 사용설명서로 고친 · 확인한 것

| 모델 | 상품 페이지 | 사용설명서 | 처리 |
|---|---|---|---|
| BKRL240BGBWM(A) 24L | `WxHxD 469 x 377 x 280` | 3쪽 `469(폭)×377(깊이)×280(높이)` | 설명서 순서로 (H 377 → D) · `매뉴얼` |
| EKRL201DGBWM(A) · BKRL201AGWWM(A) 20L | `WxHxD 440 x 335 x 259` | 3쪽 `440(폭)×335(깊이)×259(높이)` | 설명서 순서로 · `매뉴얼` |
| EKRM200CGBWM(A) 20L | `WxHxD 440 x 359 x 259` | 3쪽 `440(폭)×358.5(깊이)×259(높이)` | 설명서 순서로 (D 359) · `매뉴얼` |
| WCDD06A* · ECDD06A* 6인용 (6코드) | `사이즈(WxHxD) 262 x 396 x 267` (높이 396 은 맞지 않음) | 5쪽 표 길이 392 · 폭 262 · 높이 269 | 설명서 값 W262 D392 H269 · `매뉴얼` |
| WCDD10BR* 10인용 (3코드) | `310 x 388 x 302` | 5쪽 표 **길이 310 · 폭 388** · 높이 302 (6인용 설명서와 길이/폭 뜻이 반대) | 높이 302 는 설명서, 가로 310 · 깊이 388 은 밥솥 모양으로 추정 · `치수순서추정` |
| 전자레인지 12종 (EKRM230EBW · WKRL230EBW · EKRM201EEW · EKRL202EGW · WKRL205EYW · EKRM151EEW · WKRM203EWW · WKRM204DLKP1 · WKRL200DWK · EKRL205DWK · MWC20ET · GKRL310ESW) · 복합오븐 4종 (GKCL340EBW · GKSL343DTW · WKCL291DBW · WKCL240EEW) | — | 설명서 '제품 크기 · 외형치수' 글자 | 상품 페이지와 같다 (확인만) |

## 정확도가 떨어지는 행 (사장님 확인용)

| 모델 | 무엇이 불확실한가 | 주소 |
|---|---|---|
| EEI33ASDSBS01 · WEI33ASDFBS01 · EER32ASDSBS01 · WER32ASDFBS01 | 외경 580 × 500 은 사양표(검증)지만 **타공 560 × 480 · 뒤 벽 40 mm 는 설명서 9쪽 그림 숫자를 눈으로 읽음** → 행 전체 `이미지판독` (미검증) | https://www.winia.com/product/view?PRODUCT_SEQ=2814 · 2813 · 2815 · 2812 |
| EWW03YEW 식기세척기 3인용 | 상품 페이지 `크기(WxHxD) 412 x 378 x 422` (높이 378 · 깊이 422) ↔ 설명서 17쪽 `412(폭)×378(깊이)×422(높이)` — 높이 · 깊이가 반대. 상품 페이지 값으로 넣고 `치수순서의심` | https://www.winia.com/product/view?PRODUCT_SEQ=3187 |
| WCDG06BSWHW · WCDE06BS* 딤채쿡 6인용 (4코드) | 사양표 `사이즈(WxHxD) 279 x 416 x 270` — 높이 416 은 맞지 않아 가로 × 깊이 × 높이로 읽음. 설명서(WCDG06)가 그림뿐이라 확인 못 함 · `치수순서추정` | https://www.winia.com/product/view?PRODUCT_SEQ=3524 |
| WCDD10BR* 딤채쿡 10인용 | 위 표 — 가로 · 깊이 방향 추정 | https://www.winia.com/product/view?PRODUCT_SEQ=2719 |
| 상품 페이지 값을 그대로 둔 전자레인지 (검증, 비고에 설명서 값) | 설명서 숫자가 몇 mm 다르다: NKRM231EWW 깊이 363 ↔ 381 · MWD23ET 362 ↔ 358 · WKRL260EBW 362 ↔ 368 · GKRL262DSW 370 ↔ 375 · EKRL263DWW 370 ↔ 365 · EKRL150EGW/EWW 320 ↔ 316 · WKRM152DWK 높이 229 ↔ 224 · EKCL281DTW 깊이 382 ↔ 383 | 각 상품 페이지 (비고 '사용설명서 n쪽은 …') |

- 전자레인지 설명서의 설치 간격은 "벽이나 물건에서 10~20 cm 이상" 이라 위 · 옆 · 뒤 칸으로 나누지 않았다 (여유 칸 비움).

## 건너뛴 것

- 목록 71개(전자레인지 42 · 오븐 6 · 인덕션 4 · 하이브리드 4 · 식기세척기 2 · 밥솥 13)를 모두 넣었다. 건너뛴 상품 없음.
- 위니아 '주방가전' 의 에어프라이어 · 전기주전자 · 정수기는 이번 종류에 없어 받지 않았다.
- 스탠딩 8cm/15cm 쿡탑과 EKRM205C* · EKRL204CWW 는 위니아에이드에 설명서가 없다 (상품 페이지 값만).
