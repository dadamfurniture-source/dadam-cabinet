# 가게나우 (Gaggenau) — `brands/gaggenau.py`

```bash
python -I collect.py --brands gaggenau --sample 3 --out sample_gaggenau   # 수입사 3개 + 글로벌 메뉴마다 1개
python -I collect.py --brands gaggenau --out out_gaggenau                 # 전체 · 요청 약 270개 (6분쯤). 다시 돌릴 때는 --offline
python -I to_sql.py out_gaggenau.json > import-gaggenau.sql               # 브랜드 '가게나우'
```

## 어디서 가져오나 (2026-10-25)

| | 주소 | 내용 |
|---|---|---|
| 국내 판매 목록 | 공식 수입사 ㈜화인어프라이언스 `www.fineappliances.co.kr/oven_list.php` · `cooktops_list.php` · `dishwasher_list.php` → 상세 `oven_view1~8.php` · `cooktops_view1~7.php` · `dishwasher_view.php` | '가게나우 국내 독점 사업자'(회사소개 연혁: 2007 가게나우 · 2018 보쉬 · 2000 지멘스 국내 독점 계약). 주방 16종 — 오븐 8 (BMP250/251-100/130 콤비 전자레인지, BOP210/211-102/132 오븐) · 쿡탑 7 (CX482-101 · CI282-102 · CI262-115 · VI262-120 · VI232-120 · CV282-101 · CV482-105) · 식기세척기 1 (DF270-101) |
| 수입사 '제품 스펙' | 상세 HTML 글자 `제품 규격 590x455x559 (WxHxD)` · `설치타공치수 780(W)x490(H)` · `내부용량` · `도어방향` | 타공의 `(H)` 는 상판 깊이 방향. **쿡탑 '제품 규격'은 `(WxHxD)` 라 적었지만 실제로는 W × D × H** (`793x513x76`) — 외형은 글로벌 값을 쓴다 |
| 외형 · 니치 | 가게나우 글로벌 `www.gaggenau.com/global/sitemap.xml` → `/global/en/mkt-product/{메뉴}/{코드}` 제품 페이지 JSON-LD `additionalProperty` | `Dimensions (HxWxD)` · `Niche height (min)/(max)` · `Niche width (min)/(max)` · `Niche depth` · `Net volume` · `Number of place settings (max)` · `Minimum worktop thickness` · 후드 `Minimum distance above electric/gas cooktops` (구조화 specifications) |
| 쿡탑 타공 (글로벌) | 제품 페이지에 걸린 공식 치수도 `media3.bsh-group.com/Line_Drawings/1400x/{그림}_en-ZZ.jpg` | 페이지 · 스펙시트(`media3.bsh-group.com/Documents/specsheet/en-ZZ/{코드}.pdf`) 어디에도 타공 글자가 없다 (스펙시트 2쪽도 그림). 에이전트가 curl 로 한 장씩(1.3초 간격) 받아 눈으로 읽어 `GG_CUTOUTS` 표에 옮겼다 → `이미지판독` |
| 사진 | 제품 페이지 JSON-LD `image[]` 중 `Product_Shots` (모델 코드가 든 제품 사진 우선) | 주소만 |

- `gaggenau.com/kr` 은 `gaggenau-asia.com`(싱가포르) 로 넘어가고 모델 목록이 없다 (냉장고 수집기 때와 같다). 국내 판매 근거는 수입사 목록뿐이다.
- 수입사 사이트의 `api/documents_list.php?board=spec` (스펙 다운로드 27건) 은 PNG 이미지 · CAD zip 이라 쓰지 않았다. 후드는 수입사 목록에 없다.
- **robots.txt**: fineappliances.co.kr 은 없음(404 → 허용). gaggenau.com 은 `/global/en/mkt-product/` 허용. media3.bsh-group.com 은 없음(404). 모든 HTML 은 Fetcher(1.2초 · 캐시)로, 치수도 그림만 curl 로 받았다 (수집기는 그림을 받지 않는다 — 표에 옮긴 값만 쓴다). 로그인 · 우회 없음.
- **수입사 목록에 없는 글로벌 제품도 싣는다** — 스팀오븐 · 가스쿡탑 · 후드 · 400 시리즈 · Expressive · Minimalistic 오븐. 전부 `국내판매미확인` 이고, `line` 끝에 ` (글로벌)` 을 붙였다 (크기가 같은 색상 변형 BMP250110 이 수입사 행 BMP250-130 에 묶여 국내 판매처럼 보이지 않게 — `collect.py merge` 키에 line 이 있다).
- 수입사 행의 모델 코드는 수입사 표기(`BMP250-130`)를 먼저, 글로벌 표기(`BMP250130`)를 뒤에 넣는다 (SQL `model_code` = 첫 번째).
- 종류: 메뉴 경로로 정한다. `microwave-ovens` · 이름이 'microwave oven'(콤비 아님) → microwave/solo (빌트인), `combimicrowave` → oven/combi, `steam`(스팀 · 콤비스팀) → oven/steam_oven, 그 밖 오븐 → oven/oven, 식기세척기 → dishwasher/built_in (모두 완전 빌트인), 쿡탑 induction/gas/vitroceramique(highlight), `induction-with-downdraft` (CV…) → cooktop/induction + `후드일체형`, Vario 테판야키 · 전기 그릴 → cooktop/None, 후드 wall → chimney · island → island · flat → slim · canopy → built_in, 천장형 · 테이블 환기 · Vario 다운드래프트 모듈 → hood/None.
- 빼는 것: 워밍 드로어(WSP · WS · GW) · 진공 드로어(DVP · DV · GV) · 커피머신 · 노브(CA230100) · 냉장고 · 와인(냉장고 수집기 몫), 북미 전용 — 이름에 인치(`30"`) 또는 전압 208 · 120 V: **CG280212CA** (120 V 가스쿡탑) · **GS460720** (240/208 V 콤비스팀).

## 2026-10-25 수집

수입사 16종 + 글로벌 주방 246쪽 → 변형 245개 (북미 2 뺌) → 크기가 같은 것끼리 **97행 · 모델 코드 261개**. SQL 89행 (검증 8 · 미검증 81) · 건너뜀 8.

| 종류 | 세부 | 행 | 모델 코드 | SQL 검증 | SQL 미검증 | 건너뜀 | 니치 | 타공 | 사진 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cooktop | – (Vario 테판야키 · 전기 그릴) | 2 | 4 | 0 | 2 | 0 | 0 | 2 | 2 |
| cooktop | gas | 8 | 21 | 0 | 7 | 1 | 0 | 8 | 8 |
| cooktop | highlight | 3 | 3 | 0 | 3 | 0 | 0 | 3 | 3 |
| cooktop | induction | 33 | 44 | 5 | 28 | 0 | 0 | 31 | 33 |
| dishwasher | built_in | 7 | 12 | 1 | 6 | 0 | 7 | 0 | 7 |
| hood | – (천장 · 테이블 · 다운드래프트) | 8 | 8 | 0 | 2 | 6 | 0 | 0 | 8 |
| hood | built_in (캐노피) | 3 | 3 | 0 | 3 | 0 | 0 | 0 | 3 |
| hood | chimney | 3 | 3 | 0 | 2 | 1 | 0 | 0 | 3 |
| hood | island | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 1 |
| hood | slim (flat) | 2 | 2 | 0 | 2 | 0 | 0 | 0 | 2 |
| microwave | solo (빌트인) | 2 | 10 | 0 | 2 | 0 | 2 | 0 | 2 |
| oven | combi | 7 | 28 | 1 | 6 | 0 | 7 | 0 | 7 |
| oven | oven | 9 | 58 | 1 | 8 | 0 | 9 | 0 | 9 |
| oven | steam_oven | 9 | 64 | 0 | 9 | 0 | 9 | 0 | 9 |
| 합계 | | 97 | 261 | 8 | 81 | 8 | 34 | 44 | 97 |

국내 판매(수입사) 행 10 — 검증 8 (출처 글자):

| 종류 | 모델 | 외형 W×H×D | 니치 · 타공 |
|---|---|---|---|
| 오븐 combi | BMP250/251-100 · -130 (8코드) | 590 × 455 × 559 | 니치 W 560 · H 450 · D 550 |
| 오븐 oven | BOP210/211-102 · -132 (8코드) | 590 × 595 × 547 | 니치 W 560 · H 590 · D 550 |
| 식기세척기 | DF270-101 | 598 × 815 × 550 | 니치 W 600~608 · H 815~875 · D 550 |
| 쿡탑 | CI262-115 | 590 × 55 × 520 | 타공 560 × 490 |
| 쿡탑 | CX482-101 | 793 × 76 × 513 | 타공 780 × 490 (플러시) |
| 쿡탑 (후드일체형) | CV282-101 | 792 × 227 × 512 | 타공 780 × 490 (플러시) |
| 쿡탑 (후드일체형) | CV482-105 | 805 × 227 × 521 | 타공 784 × 492 |
| 쿡탑 (Vario 28) | VI232-120 | 288 × 50 × 512 | 타공 268 × 492 |
| 쿡탑 | CI282-102 | 793 × 56 × 513 | 타공 780 × 490 — **출처불일치** (아래) |
| 쿡탑 (Vario 60) | VI262-120 | 580 × 50 × 512 | 타공 560 × 492 — **출처불일치** (아래) |

- 니치는 오븐 · 전자레인지 · 식기세척기 34행 모두 글로벌 JSON 글자. 한 값(최소 = 최대)이면 min 만.
- 쿡탑 타공 44행: 수입사 글자 7행 (그중 CI282-102 는 치수도 값으로 바꿈) + 공식 치수도 판독 37행. 플러시(면일체) 설치는 관통 타공을 칸에, 단(rebate) 치수는 `cutout_raw` 에 적었다. 수입사 쿡탑 7종은 모두 치수도와 대조했다 — CI282-102 하나만 달랐다.
- 쿡탑 '옆벽까지' 여유는 치수도 글자 'Minimum distance from the (hob/appliance) cut-out to the (side) wall' 가 있는 것만 `side_gap_mm` (CE 90 · Vario 가스 150 · VG295 300). 그림의 ≥50 · ≥35 따위(뒤 · 앞 여백)는 `cutout_raw` 에만.
- 후드 '조리기구 위 최소 거리'(전기 430~700 · 가스 650~700)는 `install_notes`.

## 정확도가 떨어지는 행 · 사람이 확인할 것

| 모델 | 무엇이 불확실한가 | 페이지 |
|---|---|---|
| **CI282-102** (수입사, 플러시 80cm) | 수입사 '설치타공치수 760(W)x490(H)' ↔ 제조사 치수도(15163906_CI282101_2 · 14928406_CI282102_4) 관통 780+2 × 490+2 · 단 798±1 × 518±1. 793 폭 플러시 쿡탑에 760 은 맞지 않아 보여 **칸에는 780** 을 넣고 둘 다 남겼다 (`출처불일치` · `이미지판독`) | `fineappliances.co.kr/cooktops_view2.php` |
| **VI262-120** (수입사) | 수입사 '제품 규격 590x512x50' ↔ 글로벌 `Dimensions 50x580x512` · 치수도 580. 칸에는 글로벌 580 (`출처불일치`) | `fineappliances.co.kr/cooktops_view4.php` |
| 수입사 플러시 쿡탑 CX482-101 · CV282-101 · CI282-102 | 칸의 타공은 관통 타공뿐. 플러시 설치엔 단(rebate) 798 × 518 (깊이 6.5) 이 따로 필요 — 치수도 판독이라 검증 행 칸에는 넣지 않았다 | 각 수입사 상세 · 치수도 |
| 글로벌 쿡탑 37행 | 타공 · R · 옆벽 여유 모두 치수도 눈 판독 (`이미지판독`). 판독 원문은 `cutout_raw`, 그림 ID 는 `GG_CUTOUTS['drawing']` | 각 `gaggenau.com/global/en/mkt-product/cooktops/…` |
| Vario 모듈 (VG231 · VG232 · VI232121 · VP230 · VR230 · VI242 · VG415/425 · VI414/422 · VP414 · VR414) | 칸의 타공은 **한 대만** 넣을 때 값. 여러 대 나란히 넣으면 공용 타공 (28cm: 2대 561 · 3대 854 · 4대 1147) — `cutout_raw` | 〃 |
| VG415115 행 (VG415 위얹음 + VG425 플러시 묶임) | JSON 외형이 같아 한 행으로 묶였다. 플러시 VG425 는 단 384 × 524 가 더 필요 | 〃 |
| CI262105 · CI272103 | 플러시 관통 깊이가 500 (다른 모델 490 · 492) — 그림 그대로 | 〃 |
| AW240191 (벽부착) · AI240191 (아일랜드) | JSON 에 외형이 없어 치수도에서 W · D · **배기 설치 전체 높이**(652~954 · 744~924)를 읽었다. 높이 범위는 천장 높이(2.25~2.55 m · 2.34~2.52 m)와 후드 아래 1.60 m 기준 | `…/ventilation200wallmountedhoods/AW240191` · `…/ventilation200islandhoods/AI240191` |
| AW290110 (H 1080) · AW442120 (H 1500) | JSON `Dimensions` 높이가 덕트 커버를 다 뺀 값인지 최대값인지 페이지에 설명이 없다. AW442120 은 후드 높이 범위(1300) 밖이라 SQL 에서 빠진다 | `…/wall-mounted-hoods/AW442120` |
| CG492111 · CG492111F · CG492211 (가스 100cm) | 폭 1002 가 쿡탑 범위(`collect.py BOUNDS` 1000) 밖 → `치수확인필요`, SQL 에서 빠진다. 타공(관통 983 × 580, 단 1007 × 604 R9)은 넣어 두었다 | `…/cooktops400series/gas/CG492111` |
| CU421100 · CU428100 (400 시리즈 Induction module, 깊이 610) | 상판 아래 매립형 모듈로 보이나 페이지에 설치 방식 · 타공 글자가 없다. 타공 비움 | `…/cooktops400series/induction/CU421100` |
| 가스쿡탑 외형 높이 | JSON 이 '받침 포함 · 제외' 두 묶음을 붙여 준다 (`148x288x512106x288x512`) — 첫 묶음(받침 포함)을 넣고 원문은 `size_raw` | Vario 가스 행 |
| 천장형(AC250121 · AC402181) · 캐노피(AC200…) 후드 | 세부 구분이 맞는 값이 없어 천장형은 `None`. 캐노피는 상부장 안에 넣는 형태라 `built_in` | 〃 |

## 건너뛴 것

- SQL 에서 빠짐 8행: 테이블 환기 AL200180 · AL200190 (깊이 140 — 범위 밖), AL400122 · AL400192 (JSON 외형 없음), Vario 다운드래프트 VL200120 · VL414115 (외형 없음), AW442120 (높이 1500 범위 밖), CG492111 계열 (폭 1002 범위 밖).
- 수집하지 않음: 워밍 드로어 · 진공 드로어 · 커피머신 · 노브 · 냉장/와인 (수입사 목록의 워머드로워 · 커피머신 · 냉장고/냉동고 · 와인냉장고 포함), 북미 전용 CG280212CA · GS460720.
- 설치 여유(위 · 뒤)는 글자 출처가 없어 비워 두었다.

## 가스 종류 (2026-10-25 3차)

사장님 "가스레인지는 LPG, LNG(도시가스) 두 가지로 나눠야함" → 가스 쿡탑 행에 `gas_types`.

- 근거: 글로벌 제품 페이지 사양 칸 `Gas type` (예 `Natural gas 20 mbar` · `Liquid gas 50 mbar`) 과 `Nozzle set included` (`gas_of`). Natural gas = LNG, Liquid gas = LPG. 노즐 세트가 동봉된 것은 그 가스도 넣고 비고에 '동봉 노즐 세트로 바꿔 쓴다'.
- 가게나우는 **가스마다 모델 코드가 다르다** (같은 크기의 LPG · LNG 판). 전에는 크기가 같아 한 행으로 묶였는데, `collect.py merge` 키에 `gas_types` 가 들어가 가스별로 나뉘었다 → **행 97 → 103** (가스 쿡탑 8 → 14행).

| 행 (모델 코드) | gas_types | 원문 |
|---|---|---|
| CG291210 | LNG · LPG | `Gas type: Natural gas 20 mbar` · `Nozzle set included: Liquid gas 28-37 mbar` (노즐 세트로 전환) |
| CG492111 · CG492111F | LPG | `Liquid gas 50 mbar` |
| CG492211 | LNG | `Natural gas 20 mbar` |
| VG231120F · VG232120F | LPG | `Liquid gas 28-37 mbar` |
| VG231220 | LNG | `Natural gas 20 mbar` |
| VG232220 | LNG | `Natural gas 20 mbar` |
| VG264120F | LPG | `Liquid gas 28-37 mbar` |
| VG264220 | LNG | `Natural gas 20 mbar` |
| VG295150F | LPG | `Liquid gas 28-37 mbar` |
| VG295250 | LNG | `Natural gas 20 mbar` |
| VG415115 · VG415115F · VG425115 · VG425115F | LPG | `Liquid gas 50 mbar` |
| VG415215 · VG425215 | LNG | `Natural gas 20 mbar` |
| VG491115 · VG491115F | LPG | `Liquid gas 50 mbar` |
| VG491215 | LNG | `Natural gas 20 mbar` |

- 가스 종류를 모르는 가스 행: 없음 (14행 모두 사양 칸에 가스가 있다). 모두 `국내판매미확인` — 국내에 LPG 판 · LNG 판 중 무엇이 들어오는지는 수입사 확인 필요.
- 북미 전용 CG280212CA (`Natural gas 15 mbar`, 노즐 `Liquid gas 27.5 mbar`) 는 전처럼 뺐다.

