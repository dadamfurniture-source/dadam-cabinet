# 냉장고 모델 수집기

사장님 요청 (2026-10-19): 냉장고 모델을 최대한 많이 `appliance_models` 에 넣는다.
범위는 냉장고 · 김치냉장고 · 와인셀러 · 소형, 브랜드는 삼성 · LG 먼저다.

## 어디서 가져오나

| | 모델 목록 | 공식 치수 (W×H×D) | 설치 여유 |
|---|---|---|---|
| 삼성 | `samsung.com/sec/cxhr/pf/goodsList` (카테고리 JSON) | `/sec/xhr/pf/compGoodsSpecList` (비교하기 API) | `samsung.com/sec/buying-guide/` 설치 가이드 |
| LG | `apiv2.lge.co.kr/plpsvc/.../category/{catId}/model` | `apiv2.lge.co.kr/pdpsvc/.../models/{id}/spec` | `lge.co.kr/story/setup-guide/refrigerator-installation-guide` |

- 두 회사가 자기 상품 페이지에서 부르는 공개 JSON 이다. 로그인 · CAPTCHA 우회는 없다.
- robots.txt 를 지키고, 요청은 한 번에 하나씩 1.2초 간격으로 보낸다. 받은 응답은 `cache/` 에 둬서 다시 돌려도 새로 받지 않는다.
- 다나와 등 가격비교 사이트는 쓰지 않는다. 제조사 목록으로 충분하고, 그쪽 약관이 자동 수집과 DB 재사용을 막는다.
- 크기가 같은 색상 · 마감 변형은 한 행으로 묶고, 모델 코드는 `model_codes` 에 모두 남긴다.

## 순서

```bash
python -I collect.py --out fridges                    # 15~20분 · fridges.json / fridges.csv
python -I to_sql.py fridges.json > import-fridges.sql  # Supabase SQL 편집기에 붙여 넣을 파일
```

1. 처음 한 번은 `database/appliance-models-catalog.sql` 을 Supabase 에서 실행한다 (칸 + 가져오기 함수).
2. `import-fridges.sql` 을 실행한다. 같은 브랜드에서 모델 코드가 겹치면 갱신하고, 없으면 추가한다. 여러 번 실행해도 중복이 생기지 않는다.
3. 관리자 → 가전 모델 관리에서 확인한다. 세부 구분과 설치 여유는 사람이 한 번 훑어본다 (아래 주의).

## 주의

- 세부 구분(4도어 · 양문형 …)은 상품 이름으로 추정한다. 냉동고 단품이 `two_door` 로 들어가는 등 틀릴 수 있다.
- 깊이 기준이 제조사마다 다르다. 삼성 일부는 후면 핸들을 빼고 적고, LG 설치 가이드는 운반 핸들(약 20mm)을 뺀 값이다. 원문은 비고(notes)에 남긴다.
- 설치 여유는 시리즈 단위 설치 가이드 글에서 뽑는다. 도면 이미지에만 있는 값은 없다. 관리 화면에서 고친 여유는 다시 가져와도 덮어쓰지 않는다.
- 소수 여유(16.5mm)는 올림해서 넣는다 — 여유를 줄이지 않는다.
- `to_sql.py` 가 세부 구분을 한 번 더 바로잡는다: 세워 쓰는 냉동고 단품은 `one_door`, `built_in` 은 가구 도어를 붙이는 완전 빌트인(삼성 BR*)만 — LG '빌트인 타입'은 도어 형태로 다시 나누고 설치 방식 칸에 원래 값을 둔다. 이름의 HTML 태그, 모델 코드 끝 `_` 는 지운다.

## 2026-10-19 첫 수집

모델 코드 840개 → 크기가 같은 것끼리 187행 (삼성 94 · LG 93). 설치 여유가 들어온 행: 옆 47 · 위 14 · 뒤 25.
