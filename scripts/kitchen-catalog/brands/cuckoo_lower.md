# 쿠쿠 하부장 가전 (`cuckoo_lower`) — 언더싱크 · 빌트인 정수기 2행 (모두 이미지판독)

2026-11-03 수집. 코드는 `cuckoo_lower.py` (주방가전 `cuckoo.py` 는 그대로).

```bash
python -I collect.py --brands cuckoo_lower --out out_cuckoo_lower
```

## 출처

| 무엇 | 어디 (공식) | robots.txt | 비고 |
|---|---|---|---|
| 목록 | `https://www.cuckoo.co.kr/rental/productList?cateUid=222`(냉온) · `223`(얼음) · `224`(정수전용) · `226`(대용량) · `227`(무전원) | `/rest/` · `/mycuckoo/` · 주문 · 추적 파라미터만 막음 → 허용 | 한 쪽에 13개만 그리고 '더보기' 는 스크립트 — 222 · 226 은 정렬을 바꿔(`&filter=&sort=3` · `4`) 다시 열어 채웠다. 렌탈 정수기 52개 중 이름에 '언더싱크' · '빌트인' 3개 |
| 상세 | `/rental/productView?idx=1278 · 1279 · 328` | 허용 | 페이지 글자에는 모델명 · 렌탈료뿐 |
| 치수 · 구분 | 상세 페이지가 띄우는 상품 설명 그림 `https://gi.esmplus.com/cuckoohs/spec/<모델>/10.jpg` · `…/CP-AD011UGW.jpg` 의 '제품정보고시' 표 | gi.esmplus.com robots.txt 없음(404) | 그림을 사람이 읽었다 → `이미지판독` (미검증). `source_url` 이 그 그림 주소 |
| 사진 | 목록 칸 사진 `cdn.cuckoo.co.kr/upload_cuckoo/_bo_rental/product/…` | cdn robots.txt 규칙 없음 | |

## 수집 수

| 종류 | 구분 | 행 | 모델 코드 | 검증 | 미검증 |
|---|---|---:|---:|---:|---:|
| water_purifier | hot_cold (냉온정, 스팀100 빌트인) | 1 | 2 (CP-AAS100ULWH · CP-AAS100ULDSV) | 0 | 1 (`이미지판독`) |
| water_purifier | purify (무전원 직수, 인스퓨어 언더싱크) | 1 | 1 (CP-AD011UGW) | 0 | 1 (`이미지판독`) |

| 모델 | 본체 W × D × H (그림 원문) | 그 밖 |
|---|---|---|
| CP-AAS100ULWH · CP-AAS100ULDSV 스팀100 빌트인 | `본체 : 166(W) X 390(D) X 418(H)mm` | 파우셋 61(W) × 187(D) × 306(H) → `install_notes`. 220V 2,600W (냉수 0.6A · 온수 2,500W) — 싱크대 아래 콘센트가 필요하다 |
| CP-AD011UGW 인스퓨어 직수(무전원 빌트인 언더싱크) | `크기/중량 W145 x D365 x H330mm / 약 3kg` | 파우셋 크기는 정보고시에 없다 |

- 렌탈 코드 끝 `(S)` 는 떼고 정보고시 모델명으로 넣었다 (원문은 `product_type_raw` '렌탈 코드 …').
- 타공(파우셋 구멍) 지름 · 설치 여유는 그림에도 없다.

## 정확도가 떨어지는 행 — 사장님 확인용

| 모델 | 무엇이 불확실한가 | 주소 |
|---|---|---|
| CP-AAS100ULWH · ULDSV | 그림 글자를 사람이 읽었다 (`이미지판독`). 두 색 그림이 같은 값 | https://www.cuckoo.co.kr/rental/productView?idx=1278 · 1279 |
| CP-AD011UGW | 같은 까닭 (`이미지판독`). 정보고시 '크기/중량' 이 본체만인지 파우셋을 포함한 값인지 적혀 있지 않다 — 상세 사진은 싱크대 안 박스 하나 | https://www.cuckoo.co.kr/rental/productView?idx=328 |

## 못 모은 것

| 무엇 | 이유 |
|---|---|
| 쿠쿠 언더싱크 음식물처리기 | 렌탈 '(렌탈)음식물처리기' 3개(CFD-C151MODG 12.5L · CFD-D301DCNG/DCNW 건조분쇄형) 모두 이름 · 분류에 싱크대 설치 표시가 없다 (싱크대 위 · 바닥에 두는 형) |
| 쿠쿠 무전원 정수기 CP-AR011W · 인앤아웃 10's · 그 밖 | 상세 그림이 카운터 위에 두는 형 (CP-AR011W 110(W) × 158(D) × 305(H)) — 언더싱크 아님 |
| 렌탈 'POU정수필터' CPPU-C1710S · C · CP | 업소용 필터 (정수기 본체 아님) — 넣지 않음 |
| 전체 목록 | 렌탈 목록 '더보기' 와 몰 목록은 스크립트 · `/rest/`(robots 금지)로 그린다 — 정렬을 바꿔 다시 연 데까지만 본다 |
