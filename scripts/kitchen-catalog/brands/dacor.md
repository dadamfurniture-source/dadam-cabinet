# 데이코 (Dacor) — `brands/dacor.py`

삼성전자의 빌트인 브랜드. 데이코 제품은 samsung.com/sec 목록에 없고, 삼성전자가 운영하는 `www.dacorkorea.com` 에서만 판다. 그래서 이 사이트를 정본으로 쓴다.

```bash
python -I collect.py --brands dacor --sample 3 --out sample_dacor
python -I collect.py --brands dacor --out out_dacor      # 요청 6개 (robots 1 + 홈 1 + 제품 4~5)
```

## 출처

| 무엇 | 어디서 | 근거 태그 |
|---|---|---|
| 목록 | 홈 메뉴 '쿠킹 · 클리닝' 의 `/products/(cooktops\|wall-ovens\|dishwashers\|ventilation)/…/`. HTML 주석으로 막아 둔 메뉴는 단종으로 보고 뺀다 | — |
| 외경 · 모델 코드 · 용량 | 각 페이지의 '제품 상세 스펙표'. 냉장고 수집기의 `dc_spec` 을 그대로 쓴다. 칸 이름 `제품크기 (W x H x D)` · `크기 (가로 x 높이 x 깊이)` 에서 순서를 읽는다 | 검증 |
| 쿡탑 타공 | 스펙표 `따내기 크기 (W x D)` `724~728 x 498~499 mm` (낮은 값을 넣고 원문은 남긴다). R3 은 설명서 값 | 검증 |
| 오븐 설치 공간 · 뒤 여유 | 사용설명서 PDF '설치에 필요한 치수' 표 → `manual/dacor.json` | `매뉴얼` (검증으로 친다) |
| 식기세척기 설치 공간 | 상품 페이지 설치 도면의 대체 글(alt) '…싱크 하부장의 폭이 600, 깊이가 595, … 하부장 높이가 815~865…' | `요약문` (미검증) |
| 사진 | 다른 제품 페이지의 '관련 제품' 칸에 있는 누끼 사진 (`collection-product-item-*.png`). 냉장고 수집기의 `dc_thumbs` 그대로 | — |

- robots.txt 는 없다 (404 → 허용). 한 번에 하나씩, 1.2초 이상 간격으로 받았다.
- PDF 는 `/partners/product-info/` (제품 정보 다운로드)에 걸린 스펙시트 4개와 사용설명서 5개다. curl 로 하나씩 받아 pdftotext 로 읽었다.
  - 스펙시트: `Dacor-Induction-Cooktop-spec-sheet.pdf` · `Dacor-Single-Wall-oven-spec-sheet(50L, 75L).pdf` · `Dacor-Dish-washer-spec-sheet.pdf` · `Dacor-Wall-Hood-spec-sheet.pdf`
  - 사용설명서: `singleWallOvenUserManual_75L.pdf` · `singleWallSmartOvenUserManual_50L.pdf` · `inductionCooktopUserManual.pdf` · `wallHoodUserManual.pdf` · `DisiwasherUserManual.pdf`
- 식기세척기 설명서는 글꼴 인코딩이 깨져서 글자로 읽히지 않는다. 그래서 alt 글을 썼다.

## 2026-10-25 수집 — 5행 · SQL 5행 (검증 4 · 미검증 1)

| 종류 | 행 | 모델 코드 | 검증 | 미검증 | 모델 |
|---|---:|---:|---:|---:|---|
| 빌트인 오븐 | 2 | 2 | 2 | 0 | DOB24M977SD 75L `oven` 595×595×570 · 설치 공간 560×590~600×550 / DOC24M977SD 50L 컴팩트 `combi` (전자레인지 겸용) 594×453×570 · 설치 공간 564~568×446~450×550 |
| 쿡탑 | 1 | 1 | 1 | 0 | DTI30M977BB 인덕션 762×101×540 · 타공 724×498 R3 |
| 식기세척기 | 1 | 1 | 0 | 1 | DDW24B899B00 트루 빌트인 14인용 595×815×572 · 하부장 600×815~865×595 |
| 후드 | 1 | 1 | 1 | 0 | DHD36U970WB 침니형 898×405~755×515 (`치수범위`) |

- 뒤 여유 `back_gap_mm 50` 은 오븐 2종에 넣었다. 출처는 설명서의 '전기오븐장 뒷판과 뒷벽면 5 cm 이상' 과 표의 '최소 50(뒤)' 이다. 이 값은 제품과 벽 사이가 아니라 **장 뒷판과 벽 사이**다.
- 사진 5/5. 오븐 '하부장(작업대 아래)' 설치 값은 `niche_raw` 에만 남겼다 (75L 높이 최소 600).

## 정확도가 떨어지는 행 · 사장님 확인 필요

| 모델 | 무엇이 불확실한가 | 어디서 확인 |
|---|---|---|
| DDW24B899B00 식기세척기 | 설치 공간 600 × 815~865 × 595 는 도면 그림의 대체 글에서 읽었다 (`요약문`). 깊이 595 에는 도어 패널 20 이 들어 있다고 적혀 있다. 그림의 제품 치수는 598 × 820 × 575 이고, 스펙표는 595 × 815 × 572 다 (외경은 스펙표 값을 쓴다) | https://www.dacorkorea.com/products/dishwashers/dishwasher-built-under/ · https://www.dacorkorea.com/downloads/Dacor-Dish-washer-spec-sheet.pdf 1쪽 '제품 설치 치수' |
| 모델 코드 5개 모두 | 페이지 제목의 코드와 스펙표의 모델명이 다르다. 오븐 75L 제목 DOB24M977SM ↔ 표 DOB24M977SD, 50L DOC24M977SM ↔ DOC24M977SD, 식기세척기 DW60M9995UM ↔ DDW24B899B00, 후드 DHD36M965VM ↔ DHD36U970WB. 스펙표 · 제품 정보 다운로드 · 설명서 표지에 모두 있는 **스펙표 모델명만** 코드로 넣고, 제목 코드는 `product_type_raw` 에 남겼다. SM 은 다운로드 페이지에서 주석 처리된 옛 모델이다 | 각 제품 페이지 · https://www.dacorkorea.com/partners/product-info/ |
| DOB24M977SD · DOC24M977SD 설치 공간 | 설명서 표의 글자 값(A~E)이 너비 · 높이 · 깊이 중 무엇인지는 표 옆 그림의 글자 위치로 맞췄다. 스펙시트 그림의 Min.560 · Min.590~Max.600 · Min.550 과 같은지도 대조했다 | 설명서 75L 15~16쪽 · 50L 16쪽 |
| DHD36U970WB 후드 | 높이 405~755 는 범위다. 낮은 값 405 를 넣었다 (`치수범위`). 설명서 그림도 Min 405 / Max 755 다 | https://www.dacorkorea.com/products/ventilation/wall-hood/ |

## 뺀 것

- 오븐 136L DOB30M977SM: 메뉴 · 다운로드 링크가 주석 처리돼 있어 단종으로 봤다. 페이지에 스펙표도 없다 (그림 대체 글만 757 × 731 × 587).
- 드로워 DWR24M972DM (컴팩트 오븐 전용 서랍): 오븐 · 쿡탑 등 대상이 아니고, 메뉴에서도 주석 처리돼 있다.
- 냉장 계열 (T-TYPE · 컬럼 · 김치 · 와인)은 냉장고 수집기가 모은다.
