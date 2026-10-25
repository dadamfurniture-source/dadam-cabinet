# 밀레 (Miele) — `brands/miele.py`

```bash
python -I collect.py --brands miele --sample 3 --out sample_miele   # 제품군마다 3개
python -I collect.py --brands miele --out out_miele                 # 전체 · 요청 약 65개 (2분쯤). 다시 돌릴 때는 --offline
python -I to_sql.py out_miele.json > import-miele.sql               # 브랜드 '밀레'
```

## 어디서 가져오나 (2026-10-25)

| | 주소 | 내용 |
|---|---|---|
| 목록 | `www.miele.co.kr/category/{id}/…` (주방 카테고리 18개, 12개씩 `?page=N`) + `www.miele.co.kr/e/sitemap.xml` 의 `/product/` 주소 | 밀레코리아 공식 온라인 스토어. 카테고리와 사이트맵 합집합 — 사이트맵에만 있는 주방 상품 3쪽(같은 모델의 다른 자재번호)도 넣었다 |
| 치수 · 니치 · 타공 | 상품 페이지 `www.miele.co.kr/product/{자재번호}/{슬러그}` 의 사양 표 (서버가 그린 HTML) | 아래 칸 이름 그대로 |
| 사진 | 상품 페이지 JSON-LD `primaryImageOfPage` (`media.miele.com/dam/…_HighresDigitalRGB.png`) | 주소만 |
| 판매 상태 | JSON-LD `offers.availability` → `sale_status` (`InStock` 온라인 판매 · `InStoreOnly` 매장 전용) | |

사양 표 칸 → 행 칸:

| 칸 이름 (원문) | 행 칸 |
|---|---|
| `치수(mm)(너비)` · `(높이)` · `(깊이)` (쿡탑) · `기기 너비/높이/깊이(mm)` (식기세척기) — 낱칸 우선 | `width/height/depth_mm` |
| `기기 치수(W x H x D)(mm)` (오븐) · `치수(H x W x D)(mm)` — 낱칸이 없을 때. 순서는 칸 이름에서 읽는다 (`K.dims_of`) | 〃 |
| `최소/최대 설치 너비(mm)` · `최소/최대 설치 높이(mm)` · `설치 깊이(mm)` (원문 `설치 공간 치수(W x H x D)(mm)` = `560-568 x 590-595 x 550`) | `niche_min/max_*` (최소 = 최대면 min 만) · `niche_raw` |
| `일반 매립 설치 따내기 치수(너비/깊이)(mm)` = `노출형 설치를 위한 컷아웃 치수(W x D)(mm)` | `cutout_w/d_mm` |
| `완전매립 설치 … 내부/외부 따내기 치수` · `플러시-핏 설치를 위한 컷아웃 치수` | `cutout_raw` 에만 (칸에 넣지 않는다) |
| `오븐내부 용량(ℓ)` · `장소 설정 개수` | `capacity_l` · `place_count` |
| `도어 열림에 필요한 깊이(cm)` · `최소/최대 전면 패널 무게(kg)` · `도어 힌지` · `연결 박스를 포함한 케이스 높이 (mm)` · 배기/재순환 액세서리 | `install_notes` |
| 체크 표시 칸 (`빌트언더 식기세척기` · `완전 빌트인 식기세척기` · `세미 빌트인 식기세척기` · `완전매립` · `일반 매립형 설치` …) · 밀레 메뉴 · 자재번호 | `product_type_raw` |

- 칸 이름에 `&nbsp;` 가 섞여 있어(`설치 공간 치수(W&nbsp;x&nbsp;H…)`) 공백으로 바꿔 읽는다.
- 종류는 상품 주소 슬러그(밀레 제품군)로 정한다: `ovens-…` → oven/oven, `compact-ovens-with-microwave-…`(H 7xxx BM) → oven/combi, `steam-ovens-…`(DG) · `combi-steam-ovens-…`(DGC, 콤비스팀오븐) → oven/steam_oven, `induction-hobs-…` · `combiset-induction-…` → cooktop/induction, `induction-hobs-with-vapour-extraction-…`(KMDA) → cooktop/induction + `후드일체형` 태그, `electric-hobs-…` → cooktop/highlight, `dishwashers-built-in-…` → dishwasher/built_in, `dishwashers-freestanding-…` → dishwasher/freestanding. 모두 빌트인(`built_in`), 프리스탠딩 식기세척기만 `freestanding`.
- `line`: 모델 번호가 7xxx 이면 `Generation 7000`, 아니면 `일반` (H 2861 BP · KM 6542 FR · G 5264 C SCVi).
- **robots.txt**: `/cart` · `/*checkout*` · `/*compare*` · `/*&query=*` · `/pmedia/*` 등 금지, `/*?page=*` 허용. 파이썬 robotparser 는 `*` 를 못 읽어 수집기가 그런 주소를 직접 뺀다 (상품 · 카테고리 주소엔 해당 없음). Fetcher 로 한 번에 하나씩 1.2초 간격.
- **403**: 2026-10-20 냉장고 수집 때는 miele.co.kr 이 스크립트 접속에 403 이었다 (`../fridge-catalog/README.md`). 2026-10-25 에는 같은 UA 로 홈 · 사이트맵 · 카테고리 · 상품 페이지 모두 200 이었다. 우회는 없다 — 403 이 나오면 수집기가 그 자리에서 멈춘다.

## 2026-10-25 수집

상품 페이지 43쪽 (자재번호 기준) → 크기가 같은 것끼리 **23행 · 모델 코드 40개, 모두 검증** (밀레코리아 사양 표 글자). SQL 23행 · 건너뜀 0.

| 종류 | 세부 | 행 | 모델 코드 | 검증 / 미검증 |
|---|---|---:|---:|---|
| 빌트인 오븐 | oven | 3 | 4 (H 7464 BP · H 7860 BP / H 7860 BPX / H 2861 BP) | 3 / 0 |
| 빌트인 오븐 | combi (전자레인지 콤비 45cm) | 2 | 4 (H 7240 BM · H 7440 BM · H 7840 BM / H 7840 BMX) | 2 / 0 |
| 빌트인 오븐 | steam_oven (스팀 · 콤비스팀 45cm) | 2 | 4 (DG 7240 / DGC 7440 · DGC 7840 · DGC 7840X) | 2 / 0 |
| 쿡탑 | induction (KMDA 후드일체형 2행 포함) | 9 | 14 | 9 / 0 |
| 쿡탑 | highlight | 1 | 1 (KM 6542 FR) | 1 / 0 |
| 식기세척기 | built_in (빌트언더 · 세미 · 완전 빌트인) | 5 | 11 | 5 / 0 |
| 식기세척기 | freestanding | 1 | 2 (G 7314 C SC · G 7114 C SC) | 1 / 0 |
| 전자레인지 | – | 0 | 0 | 밀레코리아 `microwave-ovens` 카테고리가 비어 있다 (단독 빌트인 전자레인지 없음) |
| 후드 | – | 0 | 0 | miele.co.kr 메뉴 · 사이트맵에 후드 카테고리가 없다 (후드 기능은 KMDA 후드일체형 인덕션뿐) |

- 니치가 들어간 행 13 (오븐 7 · 식기세척기 6), 타공이 들어간 쿡탑 10행. 대표 사진 23행 모두.
- 오븐 니치: 60cm 오븐 W 560~568 × H 590~595 × D 550, 45cm (BM · DG · DGC) W 560~568 × H 450~452 × D 550 (DGC 555).
- 식기세척기 니치: W 600 × H 805~870 × D 570 (SCi · SCU) / 550 (SCVi), XXL (G 7789) H 845~910.
- 설치 여유(옆 · 위 · 뒤) 칸은 밀레 사양 표에 없다 — 비워 둔다.

## 정확도가 떨어지는 행 · 사람이 확인할 것

| 모델 | 무엇이 불확실한가 | 페이지 |
|---|---|---|
| KM 7220 FL | 완전매립 값이 뒤섞여 있다: 플러시-핏 원문 `600/500 x 500/624`, 내부 600×500 · 외부 500×624 (외부가 내부보다 작다). 일반 매립 560×490 만 칸에 넣었다. 외형이 같은 KM 7363 FL(620×53×520)은 타공 600×490 이라 560 이 맞는지도 확인 필요 | https://www.miele.co.kr/product/12434230/induction-hobs-independent-km-7220-fl |
| KMDA 7473 FL-U · KMDA 7476 FL (200) / KMDA 7876-1 FL · KMDA 7876 FL-U (238) | 높이 200 · 238 은 상판 아래 배기 모듈을 포함한 케이스 높이다 (`연결 박스를 포함한 케이스 높이`). 하부장 서랍 · 배기 덕트 공간은 설치 도면으로 확인. 타공 780×500 은 '일반 매립 따내기' 값 (노출형 컷아웃 칸 없음) | https://www.miele.co.kr/product/11798830/induction-hobs-with-vapour-extraction-kmda-7476-fl |
| CS 7612 FL | 묶음 칸 이름이 `치수(W x D)(mm)` 인데 값은 숫자 3개 `378 x 51 x 520` — 낱칸(너비 378 · 높이 51 · 깊이 520)을 썼다 | https://www.miele.co.kr/product/11797310/combiset-induction-cs-7612-fl |
| G 7314 C SC · G 7114 C SC (프리스탠딩) | 프리스탠딩인데 사양 표에 '설치' 칸(600 × 845~880 × 600)이 있어 니치로 넣었다 — 상판 아래 넣을 때의 공간으로 보인다 | https://www.miele.co.kr/product/11285930/dishwashers-freestanding-g-7314-c-sc-autodos |
| G 7114 C SCi · G 7104 C SCi · G 7314 C SCi · G 5264 C SCVi · 프리스탠딩 2종 | 사양 표에 `장소 설정 개수`(인용)가 없어 `place_count` 를 비웠다 (G 7130 · G 7180 · G 7789 계열만 12) | https://www.miele.co.kr/product/11874520/dishwashers-built-in-g-7114-c-sci-autodos |
| G 7130 C SCU (빌트언더) + G 7130 C SCi · G 7604 C SCi · G 7714 C SCi | 크기가 같아 한 행으로 묶였다 — 빌트언더(전면 일체)와 세미 빌트인이 섞인 행이다. `product_type_raw` 는 첫 모델(SCU) 것만 남는다 | https://www.miele.co.kr/product/12513970/dishwashers-built-in-g-7130-c-scu-autodos |
| H 7464 BP + H 7860 BP | 다른 모델이지만 크기 · 용량 · 니치가 같아 한 행 (수집기 공통 규칙). H 7860 BPX 는 깊이 568 이라 따로 | https://www.miele.co.kr/product/11146340/ovens-lt-60-cm-h-7464-bp |

- 판매 상태 `InStoreOnly`(매장 전용) 행이 많다 (스팀 · 콤비스팀 · KMDA · KM 7220/7363 · CS 7612 · 식기세척기 일부). 사이트에 올라 있을 뿐 재고 여부는 모른다.
- 사이트맵에만 있는 자재번호 3개(12513980 G 7130 C SCU · 11874490 G 7114 C SC · 11550890 G 7314 C SC)는 같은 모델 코드의 다른 자재번호다 (색상 · 판매 경로 차이로 보인다) — 같은 행에 묶였다.

## 건너뛴 것

| 상품 | 이유 |
|---|---|
| ESW 7010 (워밍 드로어, 자재번호 11148470 · 11148500) | 주방 5종(오븐 · 전자레인지 · 식기세척기 · 쿡탑 · 후드) 아님 |
| CVA 7440 · CVA 7840 · CVA 7845 (빌트인 커피머신) · 카운터탑 커피머신 | 범위 밖 |
| 냉장고 · 냉동고 · 와인 유닛 · MasterCool | 냉장고 수집기(`../fridge-catalog`, `manual/miele.json`) 범위 |
| `others-barbecue-hood-complete` · `others-oven-rack-perfectclean` | 부품 · 액세서리 (바비큐 후드는 그릴 뚜껑, 레인지후드 아님) |
| 세탁기 · 건조기 · 청소기 · 세제 · 부품 | 범위 밖 |
