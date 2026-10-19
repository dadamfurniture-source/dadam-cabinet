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

## 위니아 (딤채 · 클라쎄)

기본 실행(`samsung,lg`)에는 들어가지 않는다. 따로 돌린다.

```bash
python -I collect.py --brands winia --sample 10 --out winia_sample   # 시험
python -I collect.py --brands winia --out winia                       # 전체 · 약 10분 (요청 ~440개)
python -I to_sql.py winia.json > import-winia.sql                     # 브랜드 '위니아'
```

| | 어디서 |
|---|---|
| 모델 목록 | `POST www.winia.com/product/list_ajax` (form: `TYPE`, `GNB_SEQ`, `pageNo`, `pageSize`) — 카테고리 페이지가 부르는 JSON. TYPE=1 냉장고/와인셀러(보르도 · 프렌치 · 양문형 · 일반형 · 냉동고), TYPE=2 김치냉장고(스탠드형 · 뚜껑형 · 쁘띠형) |
| 공식 치수 | `www.winia.com/product/view?PRODUCT_SEQ=…` 정적 HTML '제품사양' 표의 `제품 크기 (WxHxD)mm` / `사이즈(WxHxD)mm` (예: `810 x 1,870 x 798`) |
| 용량 | 냉장고는 사양표 `전체 용량`, 김치냉장고는 사양표에 없어 제목(`딤채 스탠드형 551L`)에서 |
| 설치 여유 | **없음** — winia.com HTML 어디에도 없다 (매뉴얼 PDF 는 winiaaid.com). 여유 칸은 비워 둔다 |

- robots.txt 는 `Allow: /` 이다. 로그인 없이 공개 페이지만, 1.2초 이상 간격으로 하나씩.
- 목록 한 칸 = 모델 코드 하나 (색상 · 마감 변형도 따로 올라온다). 상세의 색상 칩 중 목록에 없는 상품(2건)도 따라간다.
- 세부 구분: 김치는 목록 메뉴(스탠드 · 뚜껑, 쁘띠형은 스탠드 + `쁘띠형` 태그), 냉장고는 메뉴(상냉장/하냉동 → 4도어, 양문형, 냉동고 → 키 1m 이상 `one_door`), 용량 150L 이하는 `small`, 나머지 `two_door`.
- 시리즈(line): 김치 `딤채` · `클라쎄`, 냉장고 `보르도` 아니면 `일반`. 연식은 tags (`2024년형`).

### 2026-10-19 수집

목록 436칸(냉장고 77 · 김치 359) + 색상 칩 2 → 모델 코드 435개 → 크기가 같은 것끼리 61행.

| 세부 구분 | 행 | 코드 |
|---|---|---|
| kimchi_stand | 19 | 228 |
| kimchi_lid | 9 | 130 |
| two_door | 11 | 31 |
| side_by_side | 7 | 16 |
| french_4door | 5 | 13 |
| small | 6 | 9 |
| one_door (세워 쓰는 냉동고) | 4 | 8 |

### 위니아 주의

- ㈜위니아는 2023년 기업회생 절차에 들어갔다. 사이트가 언제 닫힐지 모른다 — `cache/www.winia.com/` 에 원본이 남아 있으니 `--offline` 으로 다시 만들 수 있다.
- 김치냉장고 대부분이 2023 · 2024년형이고, 2027년형 뚜껑형(DDL*) 몇 개만 새로 올라왔다. 냉장고는 2017~2023년형이다 — '현재 판매 중' 이 아니라 '사이트에 올라 있음' 이다.
- `DDLE18ABWRS3` (뚜껑형 174L) 은 목록에 세 번 있지만 상세가 모두 '페이지를 찾을 수 없습니다' — 빠졌다.
- 보르도 와인셀러 · 보르도 냉장고는 957×1840×917 4도어 몸체에 와인 칸이 든 냉장고라 `wine` 이 아니라 `french_4door` (+ `와인셀러` 태그) 로 넣었다. winia.com 목록에 따로 파는 소형 와인셀러는 없다.
- '중형냉장고' 메뉴(479L · 501L, 폭 768~833)는 사양표에 도어 수가 없어 `two_door` 로 넣었다. 사진으로 확인이 필요하다.
- 같은 이름 · 용량인데 깊이가 다른 행이 있다 (예: 딤채 스탠드형 551L 깊이 798 · 800 · 818) — 모델별 공식 사양표 값이라(연식 · 마감 차이로 보인다) 그대로 따로 둔다.
