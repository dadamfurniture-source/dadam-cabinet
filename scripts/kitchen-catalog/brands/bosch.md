# 보쉬 (Bosch) — `brands/bosch.py`

```bash
python -I collect.py --brands bosch --sample 3 --out sample_bosch   # 메뉴마다 1개 (최대 12)
python -I collect.py --brands bosch --out out_bosch                 # 전체 · 요청 약 105개 (2~3분). 다시 돌릴 때는 --offline
python -I to_sql.py out_bosch.json > import-bosch.sql               # 브랜드 '보쉬'
```

## 국내 판매 모델을 공식 사이트에서 알 수 없다 — 전부 `국내판매미확인`

| 확인한 곳 (2026-10-25) | 결과 |
|---|---|
| `www.bosch-home.co.kr` (보쉬 한국어 사이트, robots.txt 허용) | BSH Home Appliances Pte. Ltd.(싱가포르)가 운영하는 **소개 사이트**. `/ko/sitemap.xml` · `/ko/sherpa-sitemap-1.xml` 에 제품 상세가 하나도 없다. `/ko/products/cooking-baking` · `/hobs` · `/dishwashers` 는 종류 소개 글뿐, '모델 종류' 탭도 글 묶음. `/ko/productslist` 404. `/ko/products/dishwashers/dishwasher`(식기세척기 설치 안내)는 일반 안내 — 모델 값 없음 |
| `/ko/distributors` (국내 유통처) | 대형가전 ㈜화인어프라이언스 (`www.fineappliances.co.kr`), 소형가전 ㈜엠펠 |
| `www.fineappliances.co.kr` | 가게나우 제품만 싣는다. 보쉬는 회사소개 연혁 '2018 독일 BOSCH 가전제품 국내 독점 계약체결' 뿐 |
| `media3.bsh-group.com/Documents/specsheet/ko-KR/{코드}.pdf` | 한국 로케일 스펙시트 없음 (404 png 로 넘어간다) |

그래서 **한국 사이트를 운영하는 같은 법인(BSH 싱가포르)의 지역 사이트 `www.bosch-home.com.sg`** 의 빌트인 주방 제품을 싣는다. 국내에서 파는 모델인지는 모른다 — 행 전부 `국내판매미확인` (SQL 미검증). 화인어프라이언스에 국내 취급 모델 목록을 받아 맞춰 보는 것이 다음 단계다.

## 어디서 가져오나

| | 주소 | 내용 |
|---|---|---|
| 목록 | `www.bosch-home.com.sg/sitemap.xml` 의 `/en/product/{경로}/{코드}` 중 `SITE_PATHS` | built-in-ovens · built-in-ovens-with-microwave · compact-ovens · steam-appliances · microwaves · cooker-hoods(built-in · wall-mounted · venting-hobs) · induction-hobs · electro-hobs · gas-hobs · built-in / free-standing dishwashers (액세서리 · 세정제 제외) |
| 외형 · 니치 · 타공 | 제품 페이지 JSON-LD `additionalProperty` (+ 구조화 specifications) | 아래 표 |
| 후드 전체 높이 | BSH 스펙시트 PDF `media3.bsh-group.com/Documents/specsheet/en-SG/{코드}.pdf` 글자 `Dimensions exhaust air (HxWxD mm): 614-954 x 898 x 500` | 침니 · 아일랜드 후드만. 냉장고 수집기의 `gg_pdf_text`(Fetcher 와 같은 robots · 1.2초 간격 · UA, 글자만 `cache/` 에) 로 받는다 → `매뉴얼` 출처 표시 |
| 사진 | JSON-LD `image[]` 의 `Product_Shots` (모델 코드 앞 6자가 든 제품 사진 우선) | 주소만 |

| 칸 (원문) | 행 칸 |
|---|---|
| `Dimensions` `595x594x548` | 높이 × 폭 × 깊이 로 읽는다 — 이 사이트는 칸 이름에 순서가 없지만, 같은 BSH 칸이 gaggenau.com 에서는 `Dimensions (HxWxD)` 이고 값도 그 순서(쿡탑 51x606x527 · 식기세척기 815x598x550)다 |
| `Minimum/Maximum height for installation` · `Minimum/Maximum width for installation` · `Depth for installation` | 오븐 · 전자레인지 · 식기세척기 니치 (`niche_min/max_*`). 빌트인 · 슬라이드 후드는 장 안쪽 폭 · 깊이로 니치에 |
| `Required niche size for installation (HxWxD)` `51 x 560-560 x 490-500` | 쿡탑 상판 타공 W · D (범위면 작은 값, 원문은 `cutout_raw`). 첫 칸 51 = 상판 밑 깊이 |
| 위가 없는 쿡탑(도미노 · 환기 일체형) — `Minimum width for installation` · `height/depth for installation` | 타공 W = 폭. 타공 D 는 height · depth 중 300 이상 · 제품 깊이 미만인 값이 하나뿐일 때만 (아래 '불확실') |
| 후드 `Width of the appliance` · `Height of the appliance` · `Depth of the product` · `Height of the chimney` | 외형 (높이는 본체뿐) · 덕트 커버 높이는 `install_notes` |
| `Minimum distance above an electric hob / a gas hob` | 후드 `install_notes` |
| `Usable volume (of cavity)` · `Cavity capacity` · `Maximum number of place settings (EU 2017/1369)` | `capacity_l` · `place_count` |

- 종류: 경로 + 제품명. steam → oven/steam_oven, microwave 겸용 빌트인 · 콤팩트 → oven/combi, 빌트인 전자레인지 → microwave (오븐 · hot air 면 combi, 그릴만이면 solo), venting-hobs → cooktop/induction + `후드일체형`, 후드 telescopic → slim · island → island · wall → chimney · built-in → built_in, hobs gas · electro(highlight) · induction, 식기세척기 free-standing → freestanding.
- `line` = 이름 앞 `Series 2/4/6/8`.
- robots.txt (bosch-home.com.sg · bosch-home.co.kr) 는 제품 · 사이트맵 경로를 막지 않는다. media3.bsh-group.com 은 없음(404). 로그인 · 우회 없음.

## 2026-10-25 수집

싱가포르 사이트 주방 제품 93쪽 → 크기가 같은 것끼리 **61행 · 모델 코드 93개**. SQL 61행 (검증 0 · 미검증 61) · 건너뜀 0.

| 종류 | 세부 | 행 | 모델 코드 | SQL 검증 | SQL 미검증 | 건너뜀 | 니치 | 타공 | 사진 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cooktop | gas | 8 | 14 | 0 | 8 | 0 | 0 | 8 | 8 |
| cooktop | highlight | 2 | 2 | 0 | 2 | 0 | 0 | 2 | 2 |
| cooktop | induction | 9 | 15 | 0 | 9 | 0 | 0 | 9 | 9 |
| dishwasher | built_in | 5 | 5 | 0 | 5 | 0 | 5 | 0 | 5 |
| dishwasher | freestanding | 9 | 12 | 0 | 9 | 0 | 0 | 0 | 9 |
| hood | chimney | 5 | 7 | 0 | 5 | 0 | 0 | 0 | 5 |
| hood | island | 2 | 2 | 0 | 2 | 0 | 0 | 0 | 2 |
| hood | slim | 7 | 7 | 0 | 7 | 0 | 7 | 0 | 7 |
| microwave | solo | 1 | 2 | 0 | 1 | 0 | 1 | 0 | 1 |
| oven | combi | 2 | 3 | 0 | 2 | 0 | 2 | 0 | 2 |
| oven | oven | 6 | 15 | 0 | 6 | 0 | 6 | 0 | 6 |
| oven | steam_oven | 5 | 9 | 0 | 5 | 0 | 5 | 0 | 5 |
| 합계 | | 61 | 93 | 0 | 61 | 0 | 26 | 19 | 61 |

- 니치: 60 × 60 오븐 W 560~568 × H 575~597 (Series 2) / 585~595 × D 550, 45cm 콤팩트 W 560~568 × H 450~455 × D 550, 빌트인 식기세척기 W 600~608 (45cm 450~458) × H 815~875 × D 550.
- 타공: 60cm 인덕션 · 전기 560 × 490 (범위 490~500), 78cm (아시아형 PMD · PMI · PPI) 700 × 400, 90cm 가스 PMD93 880 × 455, 도미노 270 × 490.
- 침니 · 아일랜드 후드 7행: 외형 높이 = 스펙시트 '배기' 전체 높이 범위의 낮은 값 (`치수범위` · `매뉴얼`). 예: DWB97CM50B 614~954, DIB97IM50M 744~924, DWK91LT60 855~1098.

## 정확도가 떨어지는 행 · 사람이 확인할 것

| 모델 | 무엇이 불확실한가 | 페이지 |
|---|---|---|
| **전체 61행** | 싱가포르 판매 모델 — 국내 판매 · 국내 코드인지 모른다 (`국내판매미확인`). 'K' 로 끝나는 코드(HBF134EB0K · HJA715B…0K · PCC6A5B90K · PRA3A6B70K · SPS2IKW55K · BEL554MS0K)도 한국용이라는 근거는 없다 | `bosch-home.com.sg/en/product/…` |
| 외형 순서 | `Dimensions` 칸에 순서 표시가 없어 BSH 공통(높이 × 폭 × 깊이)으로 읽었다 — 값이 모두 맞아 보이나(쿡탑 높이 45~80) 원문은 `size_raw` | 각 행 |
| PVS601B16E · PXX895D66E (환기 일체형 인덕션) | 타공 D 를 'height for installation'(500 · 490)에서 골랐다 — 같은 칸이 도미노에선 상판 밑 깊이(45)라 뜻이 제품마다 다르다. 원문 `cutout_raw`. 하부장 · 덕트 공간(외형 높이 227 · 223)은 스펙시트 그림으로 확인 | `…/cooker-hoods/venting-hobs/PVS601B16E` · `…/PXX895D66E` |
| 도미노 PRA3A6 · PRB3A6 · PIB375 · PXX375 · PKF375 | 타공 270 × 490 을 'width/depth for installation' 에서 읽었다 (위와 같은 판단) | `…/domino-gas-hobs/…` |
| 가스 쿡탑 외형 높이 | JSON 이 '받침 포함 · 제외' 두 묶음을 붙여 준다 (`59x306x52745x306x527`) — 첫 묶음(받침 포함)을 넣었다 | PRA3A6 · PRB3A6 |
| 침니 · 아일랜드 후드 높이 | 페이지 높이(46 · 53 · 60)는 캐노피뿐이고 덕트 커버 높이를 더하면 틀린다 (46 + 582 = 628 ≠ 614). 스펙시트 '배기' 범위의 낮은 값을 넣었다 — 재순환 설치는 더 높다 (DWB97CM50B 614~1064). DWB97CM50B 는 치수도(MCZ_02614933)도 614~954 로 같았다 | `…/wall-mounted-cooker-hoods/…` |
| 슬라이드(telescopic) 후드 니치 | 'Minimum width for installation' · 'Depth for installation' 를 장 안쪽 폭 · 깊이로 넣었다 (DFS 524 × 290, DFT 598 × 300, DHI 550/850 × 280) — DFT 의 598 은 후드 폭과 같아 '장 폭'일 수 있다 | `…/built-in-cooker-hoods/…` |
| CMG7241B1 · CMG7361B1B · HMG7361B1 (전자레인지 겸용) | oven/combi 로 넣었다. 용량은 `Cavity capacity` | 〃 |
| 프리스탠딩 식기세척기 | 니치 칸이 없다 (사이트에 설치 공간 값 없음) | 〃 |

## 건너뛴 것

- 싱가포르 사이트의 액세서리(오븐 트레이 · 후드 필터 · 가스 받침), 세정제, 냉장고 · 세탁기 · 커피머신 · 소형가전.
- 보쉬 한국 사이트 · 수입사 사이트는 모델 값이 없어 쓰지 않았다 (위 표).
