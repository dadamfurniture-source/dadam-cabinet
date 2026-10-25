# LG SIGNATURE Kitchen Suite (SKS) — `brands/sks.py`

브랜드는 `LG`, 라인은 `SIGNATURE Kitchen Suite` 로 넣는다. 냉장고 수집기와 같은 기준이고, 태그에 `SKS` 를 붙인다. 이 제품들은 lge.co.kr 일반 목록(plp)에 없다. 브랜드관 `lge.co.kr/kr/business/sks/*.do` 의 정적 HTML 이 정본이다.

```bash
python -I collect.py --brands sks --sample 3 --out sample_sks
python -I collect.py --brands sks --out out_sks          # 요청 5개 (브랜드관 홈 1 + 제품 4)
```

## 출처

| 무엇 | 어디서 | 근거 태그 |
|---|---|---|
| 목록 | 브랜드관 홈 `signaturekitchenMain.do` 의 'Products' 링크 중 주방 제품 (인덕션 · 광파오븐 · 스팀 오븐 · 식기세척기). 냉장 · 와인 페이지는 냉장고 수집기가 모은다 | — |
| 모델 코드 | '제품 상세 스펙' 탭의 사진 설명 (`HN952VAE`, `DBS14 / 본체 : DBE7PT / 패널 : D-DTB1`) | — |
| 외경 | `제품 치수 (WxHxD, mm)` (칸 이름 순서) | 검증 |
| 오븐 · 식기세척기 설치 공간 | `설치 치수 (WxHxD, mm)`. 범위는 min/max 로 나눈다 (`600 X 820~880 X 600`) | 검증 |
| 쿡탑 타공 | `설치 치수` `860 X 486 (매립 깊이 149)` → 가로 860 × 깊이 486. 설명서 '매입절취 860 (W) × 486 (D) × 149 (H)' 와 같다 | 검증 |
| 옆 · 뒤 여유 | '다운로드' 탭 사용설명서 PDF (`image5.lge.co.kr/uploads/kr/business/download/signaturekitchen/*.pdf`) → `manual/sks.json` | `매뉴얼` |
| 사진 | 스펙 탭에서 설명에 그 모델 코드가 든 사진 칸 (`product_spec1_pc.png` …). 냉장고 수집기의 `sks_image` 그대로 | — |

- robots.txt: lge.co.kr 의 `/kr/business/` 는 허용이다. image5.lge.co.kr 에는 robots.txt 가 없다 (404 → 허용). 한 번에 하나씩, 1.2초 이상 간격으로 받았다.

## 2026-10-25 수집 — 4행 · SQL 4행 (검증 4 · 미검증 0)

| 종류 | 행 | 모델 코드 | 검증 | 모델 |
|---|---:|---:|---:|---|
| 쿡탑 | 1 | 1 | 1 | HN952VAE 인덕션 5구 930×105×535 · 타공 860×486 · 옆/뒤 50 |
| 빌트인 오븐 | 2 | 2 | 2 | MZ3217BGS 광파오븐 32L `combi` 594×460×471 · 설치 공간 560×458×556 · 뒤 50 / LS271LM 스팀 오븐 70L `steam_oven` 594×597×575 · 설치 공간 560×595×556 · 옆 5 · 뒤 50 |
| 식기세척기 | 1 | 3 | 1 | DBS14 (Professional) · DBS14M (Transitional) · 본체 DBE7PT — 14인용 598×815×574 · 설치 공간 600×820~880×600 |

- 광파오븐은 오븐 · 그릴 · 스팀 · 레인지(전자레인지)를 겸하고 빌트인 전용이라 `oven` `combi` 로 넣었다 (삼성 빌트인 기준과 같다).
- 뒤 여유 50 은 설명서의 '가구장(설치장) 뒷면과 벽 사이 최소 50 mm' 다. 장 뒷판과 벽 사이 값이다.

## 정확도가 떨어지는 행 · 사장님 확인 필요

| 모델 | 무엇이 불확실한가 | 어디서 확인 |
|---|---|---|
| DBS14 · DBS14M · DBE7PT 식기세척기 | 깊이가 출처마다 다르다. 웹 '제품 치수' 는 574 (핸들 제외)인데, 같은 페이지 상품정보고시 '제품 크기' 와 설명서 '제품 규격' 은 **554** 다. 574 를 넣었다. 패널(D-DTB1 / D-DTM1)을 붙인 깊이로 보이지만 확인이 필요하다. 원문은 `size_raw` 에 있다 | https://www.lge.co.kr/kr/business/sks/dishwasher.do · 설명서 dishwasher.pdf 56쪽 |
| MZ3217BGS 광파오븐 | 외경 깊이 471 은 웹 표와 설명서 표가 같다. 그런데 웹 도면 설명 글(대체 글)에는 '깊이 559mm' 가 있다 (문 · 손잡이 포함으로 보인다). 워밍 드로어(LZ8811G, 별매)를 붙인 치수 594 × 600 × 553 · 설치 공간 560 × 595 × 556 은 원문에만 남겼다 | https://www.lge.co.kr/kr/business/sks/lightwave-oven.do |
| 모델 코드 | 브랜드관에 적힌 코드다 (HN952VAE 등). 식기세척기 고시의 품명은 `DBE7PT.AKOR` 이다 | |

## 뺀 것 · 없는 것

- 워밍 드로어 LZ8811G: 광파오븐용 별매 서랍이라 대상이 아니다.
- **후드 · 가스 쿡탑 · 레인지**: 2026-10-25 한국 브랜드관에 페이지가 없다. 옛 경로 `/kr/business/signaturekitchen/…` 는 지금 브랜드관 홈으로 넘어간다. 미국 SKS 사이트 제품은 국내 판매를 확인할 수 없어 넣지 않았다.
- 냉장 · 와인 (컬럼 · 얼음정수기 · 아일랜드)은 냉장고 수집기가 모은다.
