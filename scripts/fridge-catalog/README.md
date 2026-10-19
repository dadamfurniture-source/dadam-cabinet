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

## 데이코 (Dacor) · LG SIGNATURE Kitchen Suite (SKS) — 빌트인

기본 실행(`samsung,lg`)에는 들어가지 않는다. 둘 다 각자 고를 수 있다 (`--brands dacor`, `--brands sks`).

```bash
python -I collect.py --brands dacor,sks --out dacor_sks           # 요청 ~12개 (목록 2 + 제품 페이지 8 + robots 2)
python -I to_sql.py dacor_sks.json > import-dacor-sks.sql         # 데이코 → '데이코', SKS → 'LG' + line 'SIGNATURE Kitchen Suite'
```

| | 데이코 | SKS |
|---|---|---|
| 목록 | `www.dacorkorea.com` 홈 메뉴의 `/products/refrigerators/*` (삼성전자가 운영. samsung.com/sec 목록 · 사이트맵엔 DR* 코드가 없다) | `lge.co.kr/kr/business/sks/signaturekitchenMain.do` 'Products' 중 이름에 냉장 · 냉동 · 와인이 든 페이지 (`columns.do` · `ice-water-fridge.do` · `island.do`). lge.co.kr 일반 목록(plp)에는 없다 |
| 치수 | 페이지 '제품 상세 스펙표' `제품크기 (W x H x D)` 첫 줄 = Door Panel 제외 (둘째 줄 패널 · 설치자재 포함은 원문에) | '제품 스펙' 탭 `제품 치수 (WxHxD, mm)` (핸들 제외) |
| 니치 | `설치공간 (W x H x D)` … `(권장)` | `설치 치수 (WxHxD, mm)` — 깊이 `635~655` 같은 범위 |
| 패널레디 | `색상 / 재질` · `도어` 에 `Panel Ready` / `가구 패널 부착 가능` | 안내 문구에 `가구 패널` (아일랜드 냉장고만) |

- robots.txt: dacorkorea.com 은 없음(404 → 허용), lge.co.kr 은 `/kr/business/` 허용. 한 번에 하나씩 1.2초 이상 간격.
- 니치는 새 키 `niche_min_{w,h,d}_mm` · `niche_max_{w,h,d}_mm` 로 넣는다. 한 값이면 min 만, `a~b` 범위면 min · max. 원문은 `niche_raw` (비고에도 남는다). 값이 안 나와 있으면 비운다.
- `to_sql.py` 는 모든 행에 니치 키 6개를 함께 내보낸다 (DB 칸은 `database/appliance-models-niche.sql`). 삼성 · LG · 위니아 행의 다른 값은 그대로다.
- 세부 구분: 패널레디(가구 도어를 붙이는 완전 빌트인)만 `built_in` — `to_sql.refine_subtype` 도 `panel_ready` 행은 그대로 둔다. 와인은 패널레디 틀이어도 유리 도어라 `wine`. 단일 온도 컬럼은 `one_door`, 냉장+냉동 한 몸은 LG 코드 관례(S… = 양문형)로 `side_by_side` 아니면 `french_4door`.
- SKS 세트(CFL1830 = 냉동 CF18 + 냉장 CL30)는 단품이 따로 있어 건너뛴다. Professional · Transitional (디자인) 과 좌 · 우경첩 코드는 크기가 같아 한 행에 묶인다.

### 2026-10-19 수집 — 14행 (데이코 5 · SKS 9)

| 브랜드 | 세부 | W×H×D | 니치 W×H×D | 패널레디 | 이름 · 코드 |
|---|---|---|---|---|---|
| 데이코 | built_in | 1048×2118×605 | 1065×2135×670 | O | T-TYPE 냉장고 615L · DRF427520AP |
| 데이코 | built_in | 604×2118×605 | 610×2135×670 | O | 컬럼 냉장고 373L · DRR24981RAP |
| 데이코 | built_in | 604×2118×605 | 610×2135×670 | O | 컬럼 냉동고 347L · DRZ24981LAP |
| 데이코 | built_in | 604×2118×605 | 610×2135×670 | O | 컬럼 김치냉장고 376L · DRQ24982RAP, DRQ24992RAP |
| 데이코 | wine | 604×2118×605 | 610×2135×670 | (틀) | 와인 셀러 100병 · DRW24980RAP |
| SKS | one_door | 451×2121×629 | 457×2135×635~655 | | 컬럼 냉동고 256L · CF18, CFM18 |
| SKS | one_door | 603×2121×629 | 610×2135×635~655 | | 컬럼 냉동고 375L · CF24, CFM24 |
| SKS | one_door | 603×2121×629 | 610×2135×635~655 | | 컬럼 냉장고 386L · CL24, CLM24 |
| SKS | one_door | 756×2121×629 | 762×2135×635~655 | | 컬럼 냉장고 502L · CL30, CLM30 |
| SKS | wine | 603×2121×629 | (안 나옴) | | 컬럼 와인셀러 113병 · CW24R/L, CWM24R/L |
| SKS | wine | 451×2121×629 | 457×2135×635~655 | | 컬럼 와인셀러 71병 · CW18R/L, CWM18R/L |
| SKS | side_by_side | 1067×2121×645 | 1070×2130×700 | | 얼음정수기냉장고 686L · S695RE13BW |
| SKS | built_in | 595×815×590 | 600×820×600 | O | 아일랜드 냉장고 89L · U092CN421 (STS 패널 UP-S24RH 또는 가구 패널) |
| SKS | wine | 595×815×590 | 600×820×600 | | 아일랜드 와인셀러 41병 · U412WN34L |

### 데이코 · SKS 주의

- 데이코 깊이 605 는 Door Panel 을 뺀 값이다. 패널 · 설치자재를 붙이면 630 (T-TYPE 은 폭도 1060). 삼성 셰프컬렉션 BRF425220AP(1048×2118×605)와 같은 기준이다.
- 데이코 김치 페이지는 표의 모델명이 `DRQ24982RAP`, 페이지 제목 · 스펙시트 파일명이 `DRQ24992RAP` 이다. 둘 다 코드로 남겼다 — 신형 교체로 보이나 확인 필요.
- SKS 컬럼 24 용량 칸이 `냉동고 (CF24/CL24) 375L / 냉장고 (CFM24/CLM24) 386L` 로 괄호 속 코드 묶음이 어긋나 있다. 냉동고 · 냉장고 이름으로 골라 CF24 · CFM24 = 375L, CL24 · CLM24 = 386L 로 넣었다.
- SKS 코드(CF24 · CL30 · CW24R …)는 브랜드관에 적힌 짧은 이름이다. 실제 판매 코드가 더 길 수 있다.
- SKS 아일랜드 니치 높이 원문은 `820~828 or 836↑` — 대안이 둘이라 최대는 비우고 최소 820 만 넣었다. 깊이 `600↑` 은 최소 600.
- SKS 컬럼 와인셀러 24 는 설치 치수가 페이지에 없다 (18 만 있다) — 비워 둔다. 얼음정수기 냉장고 페이지의 `S695SI34B` 는 케어 서비스 문구에만 나오고 사양이 없어 뺐다.
- 얼음정수기 냉장고 S695RE13BW 는 좌우 문 두 짝(냉동 254L · 냉장 432L) 이라 `side_by_side` 로 넣었다 (LG 코드 S… = 양문형).
