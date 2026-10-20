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

## 리페르 (Liebherr) · 마이디어 (Midea) · 스메그 (Smeg)

기본 실행(`samsung,lg`)에는 들어가지 않는다. 셋 다 각자 고를 수 있다 (`--brands liebherr`, `--brands midea`, `--brands smeg`).

```bash
python -I collect.py --brands liebherr,midea,smeg --sample 6 --out lms_sample   # 시험
python -I collect.py --brands liebherr,midea,smeg --out lms                     # 전체 · 요청 ~100개 (약 3분)
python -I to_sql.py lms.json > import-lms.sql                                   # 브랜드 '리페르' · '마이디어' · '스메그'
```

| | 리페르 | 마이디어 | 스메그 |
|---|---|---|---|
| 한국 판매 | 수입사 코스모앤컴퍼니 (백화점 · 하이마트 등) | 마이디어코리아 | 공식 수입사 (주)제이컬렉션 = 스메그코리아 |
| 목록 | `www.liebherr.com/sitemap-en-kr.xml` 의 `/en-kr/p/…` 중 가정용 (아래) | `www.midea.com/kr/sitemap.xml` 의 `/kr/refrigerator/…` 상품 경로 | `j-collection.co.kr/product/product_list.php?cate=15`(냉장고) · `629`(와인셀러) → 'MORE' 버튼이 부르는 `POST /product/product_proc.php` (`reg_state=list`, `page`, `page_size`) |
| 치수 | 제품 페이지 `__NEXT_DATA__` 속성 4431 `Exterior dimensions: height/width/depth` (cm) · 조합(양문형)은 5739 (mm) — **H/W/D 순서** | 상품 페이지 '전체 사양' `크기` (`833x1775x740mm`) | 상세 `product_view.php?pseq=` '상품 정보 고시' `크기, 용량, 형태` — **W×D×H 순서** (`(가로x세로x높이)601x728x1530mm`) |
| 모델 코드 | `productSetName` (`SCNsdh 5253_126620` 의 `_…` 는 변형 번호라 뗀다) | JSON-LD `Product.model` | 페이지 제목 끝 코드 (= 목록 `data-promodel`) |
| 니치 · 도어 | 4491 `Nischenmaße` (범위) → `niche_min/max_*`, 4518 도어 방식(고정 Festtür / 슬라이딩 Schlepptür), 4582 설치 방식 `Integrierbar` → `built_in` + `panel_ready` | 없음 | 없음 |
| 설치 여유 | 없음 (PDF 뿐) | 없음 | 상세의 안내 문장 → `install_notes` + 숫자가 분명한 것만 칸으로 (아래) |

- robots.txt: liebherr.com 은 제품 경로 금지 없음. midea.com 은 `Disallow: /*?*` (쿼리 URL 금지) — 사이트맵의 경로형 URL 만 쓴다 (파이썬 robotparser 는 와일드카드를 못 읽어서 `?` 든 URL 은 수집기가 직접 뺀다). j-collection.co.kr 은 robots.txt 없음(404 → 허용). 셋 다 로그인 없이 공개 페이지만, 한 번에 하나씩 1.2초 이상 간격.
- 리페르 범위는 **한국 사이트(en-kr) 가정용만**이다. ko-kr 사이트맵엔 건설장비뿐이고, en-kr 의 `/p/` 1,635개 대부분은 업무용 · 의료용 · 건설장비다. 슬러그 끝 숫자(목록 템플릿) 묶음마다 한 쪽을 열어 `hierarchyLevels` 2단계 `Haushalt` + `customerSegment` `Consumer` 인 묶음만 남긴다 (2026-10-20: 5묶음 12쪽). 제품마다 `countries` 에 `KR` 이 있는지도 본다. 글로벌(de-de 등) 통합형 카탈로그는 긁지 않는다.
- 리페르 en-kr 가정용은 전부 프리스탠딩이다 — **통합형(빌트인) 한국 공식 모델 0개**. 그래서 니치 · 도어 방식 칸은 비어 있다. 같은 코드가 통합형 페이지(4491 · 4518 · 4582 가 있는 페이지)에서도 돈다는 것은 캐시된 de-de `IRe 5100` 으로 확인했다 (니치 H 1772~1788 · W 560~570 · D 550, 고정 도어, panel_ready).
- 리페르 용량은 순용량(4424 Net) — 양문형 조합은 두 칸의 합. 와인셀러는 순용량 칸이 없어 총용량(Gross). 조합 중 한 칸이라도 용량이 없으면(XRCsdh 5265 의 SWNsdh 5264) 합이 틀리므로 비운다. 용량 기준은 `product_type_raw` 에 남긴다.
- 마이디어 `크기` 순서가 페이지마다 다르다 (`833x1775x740` = W×H×D, `562x595x1778` · `908x736x1775` = W×D×H). 첫 값은 늘 너비, 나머지 둘 중 큰 값을 높이로 읽는다 (마이디어 KR 냉장고는 모두 세워 쓰는 형태). 원문은 `size_raw`.
- 마이디어 상품 페이지 일부는 다른 상품 페이지를 복사해 만들어 sku-map(`skuTitle`) · 사양 `용량` 이 틀려 있다 (예: 3도어 233L 페이지 sku = 미니바 `MDRD86FGO30`, 용량 44L). JSON-LD `model` · 제목의 용량을 정본으로 쓰고 sku-map 값은 `product_type_raw` 에 남긴다.
- 스메그 설치 안내 → 칸: `경첩 방향으로 약 Ncm` → `door_swing_side_mm` (도어 열 때 경첩 쪽 여유, 비고에 '도어 열림 측면'), `제품 위쪽에 / 상단 Ncm` → `top_gap_mm`, `좌/우 Ncm` → `side_gap_mm`, `후면과 벽면 사이에 최소 Ncm` → `back_gap_mm`. `뒤쪽 벽 사이의 거리는 75mm 이하` 같은 상한은 칸에 넣지 않고 `install_notes` 에만 둔다. (`install_notes` 는 to_sql 비고로 가지 않는다 — JSON/CSV 에만 있다.)
- 스메그 상단 '사이즈' 칸(`…mm(WxDxH)`)은 HTML 주석 처리돼 있어 쓰지 않는다 — 고시 정보가 정본. FAB5 는 둘이 다르다 (고시 734 · 주석 740).
- 세부 구분: 리페르 `Side-by-Side combination` → `side_by_side`, 냉장+냉동 한 몸(SCNsdh)과 냉동+와인칸(SWNsdh) → `two_door` (+ `와인칸` 태그 — 위니아 보르도와 같은 기준), 냉장 · 냉동 단품 → `one_door`, `Wine storage fridge` → `wine`. 마이디어: 양문형 · 3/4도어(LG 기준 → `french_4door`) · 150L 이하 `small` · 냉동고/1도어/스탠딩 `one_door` · 나머지 `two_door`. 스메그: 와인셀러 `wine`, 150L 이하 `small` (FAB5 · FAB10 · SMEG500), FAB28 `one_door`, FAB30 · FAB32 · 콜로니얼 · 클래식 `two_door`.
- 스메그 KR 페이지엔 도어 수가 적혀 있지 않다. FAB28 = 냉동칸이 안에 든 1도어, FAB30(상냉동) · FAB32(하냉동) = 2도어는 스메그 제품군 구성으로 넣었다 (`SM_DOORS`). 콜로니얼 · 클래식 · FAB32 일부 페이지엔 '투도어' 가 있다.

### 2026-10-20 수집 — 모델 코드 80개 → 39행 (리페르 11 · 마이디어 16 · 스메그 12), SQL 36행

| 브랜드 | 세부 구분 | 행 | 코드 |
|---|---|---|---|
| 리페르 | side_by_side | 4 | 4 (XCCsdh 5250 · XRCsdh 5265 · XRFsdh 5220 · XRFsdh 5265, 모두 1204×1855×675) |
| 리페르 | one_door | 3 | 3 (SRBsdh 5260 · SRsdh 5220 · SFNsdh 5227, 597×1855×675) |
| 리페르 | two_door | 2 | 2 (SCNsdh 5253 좌 · 우경첩 한 행, SWNsdh 5264) |
| 리페르 | wine | 2 | 2 (WKb 1712 언더카운터 657×850×663 · WKb 4612) |
| 마이디어 | two_door | 4 | 5 |
| 마이디어 | small | 4 | 7 |
| 마이디어 | french_4door | 3 | 3 (4도어 2 + 3도어 1) |
| 마이디어 | one_door | 3 | 3 (스탠딩 냉장고 362L + 냉동고 2 — 냉동고 둘은 페이지에 크기가 없다) |
| 마이디어 | side_by_side | 2 | 2 |
| 스메그 | two_door | 6 | 17 (FAB30 8 · FAB32 6 · 콜로니얼 2 · 클래식 1) |
| 스메그 | small | 3 | 18 (FAB5 8 · FAB10 8 · SMEG500 2) |
| 스메그 | one_door | 2 | 13 (FAB28) |
| 스메그 | wine | 1 | 1 (SCV115A 198병) |

### 리페르 · 마이디어 · 스메그 주의

- 리페르 한국 마이크로사이트(`/en-kr/fridges-freezers/liebherr-korean-7645557`)에 올라 있는 모델은 6개 (XRFsdh 5265 · XRFsdh 5220 · XCCsdh 5250 · SCNsdh 5253 · WKb 1712 · WKb 4612) 다. en-kr 가정용 페이지는 그보다 많아 XRCsdh 5265 · SRBsdh 5260 · SRsdh 5220 · SFNsdh 5227 · SWNsdh 5264 도 들어갔다 (양문형 조합의 단품). 실제 수입 여부는 코스모앤컴퍼니에 확인이 필요하다.
- 리페르 XCCsdh 5250 은 SCNsdh 5253 두 대 조합, XRFsdh · XRCsdh 는 냉동/와인 단품 + 냉장 단품 조합이다 (구성은 `product_type_raw`). 단품 코드는 다른 행과 겹치지 않게 `model_codes` 에 넣지 않았다.
- 리페르 깊이 675 는 공식 외형 깊이 (손잡이 포함 여부는 페이지에 없음).
- 마이디어 KR 냉장고 페이지는 **전부 `OutOfStock`** 이다 (`sale_status`). 사이트에 올라 있을 뿐 지금 파는지는 모른다.
- 마이디어 양문형 698L `MDRS925FGO50` 크기 원문이 `910x1130x1810mm` — 깊이 1130 은 냉장고로 맞지 않아 비우고 `치수확인필요` 태그를 달았다 (SQL 에서 빠진다). 냉동고 `MDRU255FEG01`(178L) · `MDRU385FEG21H`(272L) 는 페이지에 크기가 없어 SQL 에서 빠진다.
- 마이디어 `MDRB424FGO50`(2도어 콤비 302L) 은 크기가 `MDRT437MTO50`(314L) 과 똑같은 595×1620×695 이고 페이지가 그 복사본이다 — 크기도 복사된 값일 수 있다. 3도어 233L `MDRM372FGO50` 은 폭 562 의 좁은 3도어라 `french_4door` 가 어색할 수 있다.
- 스메그 같은 시리즈인데 원문이 조금씩 달라 행이 나뉜다: FAB28 270L(11색) · 266.1L(유니언잭 · 이태리), FAB32 331.1L(2022) · 331L(2019), FAB30 폭 600(7색) · 601(레드 FAB30RRD5). 고시 정보 원문 그대로라 합치지 않았다.
- 스메그 고시의 모델명이 제목과 다른 곳이 있다: `FA8005RPO5` 페이지 고시 = `FA8005RAO5`, `FAB30RPG5` 페이지 고시 = `FAB30RPG3`. 제목 코드(목록과 같은 값)를 쓴다. 클래식 `FA3905RX5` 는 크기 · 용량 · 설치 문구가 콜로니얼과 글자까지 같다 — 복사일 수 있다.
- 스메그 `SMEG500`(피아트 500 모양 냉장고, 100L) 원문 `1250x800x830mm` 를 W×D×H 로 읽어 1250×830×800 으로 넣었다. 와인셀러 메뉴는 2개로 표시되지만 목록엔 SCV115A 하나뿐이다.
- 스메그 글로벌(smeg.com)의 도어 개방 치수는 쓰지 않았다 — 국가 사이트마다 코드 접미사가 달라 KR 코드로 열리지 않는다 (`/uk/products/FAB28RCR5` 404).
