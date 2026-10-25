# 지멘스 (Siemens) — `brands/siemens.py`

```bash
python -I collect.py --brands siemens --sample 3 --out sample_siemens   # 메뉴마다 1개 (최대 12)
python -I collect.py --brands siemens --out out_siemens                 # 전체 · 요청 약 50개 (1분쯤). 다시 돌릴 때는 --offline
python -I to_sql.py out_siemens.json > import-siemens.sql               # 브랜드 '지멘스'
```

## 국내 공식 사이트 · 모델 목록이 없다 — 전부 `국내판매미확인`

| 확인한 곳 (2026-10-25) | 결과 |
|---|---|
| `www.siemens-home.bsh-group.com/kr` · `/kr/ko` | **401 Unauthorized** — 공개되지 않은 경로. 우회하지 않았다 |
| 지멘스 국제 사이트 `www.siemens-home.bsh-group.com/` 국가 선택 · `robots.txt` 사이트맵 목록 (46개) | 한국이 없다. 아시아 · 태평양은 중국(`.cn`) · 홍콩(`.com.hk`) · 태국(`.in.th`) · 인도 · 호주 |
| `www.fineappliances.co.kr` (화인어프라이언스) | 회사소개 연혁 '2000 독일 SIEMENS 가전제품 국내 독점 계약체결 · 3대 백화점 입점' 뿐, 제품 목록은 가게나우만 |
| `media3.bsh-group.com/Documents/specsheet/ko-KR/{코드}.pdf` | 한국 로케일 스펙시트 없음 |

그래서 **아시아 영어 BSH 지역 사이트 중 홍콩 `www.siemens-home.bsh-group.com.hk/en`** 의 빌트인 주방 제품을 싣는다 (보쉬 플러그인과 같은 사이트 꼴 · 같은 코드). 국내 판매 모델인지 모른다 — 행 전부 `국내판매미확인`. 코드 끝이 `HK` 인 홍콩 전용 모델(가스쿡탑 ER7EA233HK · 인덕션 EH8P5262HK/63HK · 후드 LU83S7x0HK · LC532VC9HK · LC53BVB9HK)은 국내에 없을 가능성이 크다. 화인어프라이언스에 국내 취급 모델을 받아 맞춰 보는 것이 다음 단계다.

## 어디서 가져오나

| | 주소 | 내용 |
|---|---|---|
| 목록 | `www.siemens-home.bsh-group.com.hk/en/sitemap.xml` 의 `/en/mkt-product/{경로}/{코드}` 중 `SITE_PATHS` | hobs · ovens · microwaves · steam-ovens-and-steamers · ventilation · built-in / freestanding dishwashers · dishwashers-55-cm (워밍 드로어 · 액세서리 제외) |
| 외형 · 니치 · 타공 | 제품 페이지 JSON-LD `additionalProperty` | 칸은 보쉬와 같다 (`brands/bosch.md`) — `Dimensions`(높이 × 폭 × 깊이) · `Minimum/Maximum height/width for installation` · `Depth for installation` · `Required niche size for installation (HxWxD)` |
| 후드 전체 높이 | 같은 페이지 `Appliance height exhaust air min/max` (덕트 커버 포함, 배기) | 글자. 없으면 스펙시트 `media3.bsh-group.com/Documents/specsheet/en-HK/{코드}.pdf` 의 'Dimensions exhaust air' (이번엔 쓸 일 없었다) |
| 후드 외형 (페이지에 높이가 없는 것) | 공식 치수도 `media3.bsh-group.com/Line_Drawings/1400x/{그림}_en-HK.jpg` 를 눈으로 읽은 `HOOD_DRAWN` 표 | → `이미지판독` |
| 사진 | JSON-LD `image[]` 의 `Product_Shots` | 주소만 |

- robots.txt (siemens-home.bsh-group.com.hk) 는 `/en/mkt-product/` 를 막지 않는다. media3.bsh-group.com 은 없음(404). 치수도 그림만 curl 로 한 장씩(1.3초 간격) 받아 읽었다 — 수집기는 그림을 받지 않는다.
- `line` = 이름 앞 `iQ100/300/500/700`.
- 식기세척기 `Installation typology = Tabletop` (SK26E82208, 높이 450) → `countertop`.

## 2026-10-25 수집

홍콩 사이트 주방 제품 44쪽 → 크기가 같은 것끼리 **36행 · 모델 코드 44개**. SQL 34행 (검증 0 · 미검증 34) · 건너뜀 2.

| 종류 | 세부 | 행 | 모델 코드 | SQL 검증 | SQL 미검증 | 건너뜀 | 니치 | 타공 | 사진 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cooktop | gas | 3 | 5 | 0 | 3 | 0 | 0 | 3 | 3 |
| cooktop | induction | 6 | 7 | 0 | 6 | 0 | 0 | 6 | 6 |
| dishwasher | built_in | 1 | 1 | 0 | 1 | 0 | 1 | 0 | 1 |
| dishwasher | countertop | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 1 |
| dishwasher | freestanding | 3 | 3 | 0 | 3 | 0 | 0 | 0 | 3 |
| hood | – (천장형 LR97CAQ50) | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 1 |
| hood | built_in (빌트언더 LU83S7x0HK) | 1 | 3 | 0 | 1 | 0 | 0 | 0 | 1 |
| hood | chimney | 3 | 3 | 0 | 1 | 2 | 0 | 0 | 3 |
| hood | slim (telescopic) | 2 | 2 | 0 | 2 | 0 | 2 | 0 | 2 |
| microwave | solo (빌트인, 그릴) | 2 | 4 | 0 | 2 | 0 | 2 | 0 | 2 |
| oven | combi | 2 | 2 | 0 | 2 | 0 | 2 | 0 | 2 |
| oven | oven | 5 | 5 | 0 | 5 | 0 | 5 | 0 | 5 |
| oven | steam_oven | 6 | 7 | 0 | 6 | 0 | 6 | 0 | 6 |
| 합계 | | 36 | 44 | 0 | 34 | 2 | 18 | 9 | 36 |

- 니치: 60 × 60 오븐 W 560~568 × H 575~597 (iQ100) / 585~595 × D 550, 90 × 48 오븐 VB558C0S0 W 860~864 × H 477~480 × D 560, 45cm 콤팩트 W 560~568 × H 450~458 × D 550, 빌트인 전자레인지 W 560~568 × H 362~382 × D 300, 식기세척기 SN67ZX86DM W 600~608 × H 815~875 × D 550.
- 타공: 60cm 인덕션 560 × 490 (범위 490~500), 90cm EX975LXC1E 880 × 490, 78cm EH8P526xHK 700 × 400, 가스 ER7EA233HK 680 × 350, 도미노 270 × 490.

## 정확도가 떨어지는 행 · 사람이 확인할 것

| 모델 | 무엇이 불확실한가 | 페이지 |
|---|---|---|
| **전체 36행** | 홍콩 판매 모델 — 국내 판매 · 국내 코드인지 모른다 (`국내판매미확인`) | `siemens-home.bsh-group.com.hk/en/mkt-product/…` |
| **LC532VC9HK · LC53BVB9HK** (벽부착 후드) | 페이지에 높이가 없고, 치수도(24796563_LC53BVB9HK)에도 캐노피 82 · 굴뚝 상자 525 · 배기 칼라 79 만 있고 전체 높이 숫자가 없다 (더하면 틀릴 수 있다 — 보쉬 DWB97 에서 확인). 외형을 비워 **SQL 에서 빠진다**. 폭 895 · 깊이 505 는 페이지 글자, 설치 높이 쿡탑 위 650~750 | `…/wall-chimney-hoods/LC532VC9HK` · `…/LC53BVB9HK` |
| LU83S710HK · LU83S720HK · LU83S750HK (빌트언더 후드) | 높이 191 은 같은 계열 LU83A710HK 치수도 판독 (본체 155 · 아래 돌출 포함 191, 배기 칼라 제외) — `이미지판독`. 폭 705 · 깊이 520 은 페이지 글자 | `…/integratedhoods/LU83S710HK` |
| LC99BDN30B (벽부착) | 외형 높이 = 'Appliance height exhaust air min 635' (배기 635~895, 재순환 803~1080) | `…/wall-chimney-hoods/LC99BDN30B` |
| LR97CAQ50 (천장형) | 세부 구분이 맞는 값이 없어 `None` | `…/ceiling-hoods/LR97CAQ50` |
| 도미노 ER3A6 · EH375 · EX375 | 타공 270 × 490 을 'width/depth for installation' 에서 읽었다 (보쉬와 같은 판단 — `brands/bosch.md`). 가스 도미노 외형 높이는 받침 포함 첫 묶음 | `…/domino-hobs/…` |
| CP269AGS0K (콤팩트 전자레인지 + 스팀) · HN978GQB1 (오븐 + 스팀 + 전자레인지) | 스팀 기능이 있어 `steam_oven` 으로 넣었다 (전자레인지 겸용이기도 하다) | `…/ovens/…` |
| 외형 순서 | `Dimensions` 칸에 순서 표시가 없어 BSH 공통(높이 × 폭 × 깊이)으로 읽었다 | 각 행 |

## 건너뛴 것

- SQL 에서 빠짐 2행: LC532VC9HK · LC53BVB9HK (외형 높이 없음 — 위).
- 수집하지 않음: 워밍 드로어 BI710C1B1W · BI710D1B1B, 식기세척기 액세서리 SZ73300, 오븐 · 후드 액세서리, 냉장고 · 세탁기 · 커피머신.

## 가스 종류 (2026-10-25 3차)

사장님 "가스레인지는 LPG, LNG(도시가스) 두 가지로 나눠야함" → 가스 쿡탑 행에 `gas_types`.

- 근거: 홍콩 제품 페이지 사양 칸 `Gas type` (`gas_of`, 보쉬와 같은 코드). 스펙시트 `media3.bsh-group.com/Documents/specsheet/en-HK/ER3A6AB70X.pdf` 도 '(gas type: Towngas)' 로 같다.
- **Towngas (홍콩 제조가스)** 는 한국 도시가스(LNG)와 다른 가스라 옮기지 않았다 → `gas_types` 비움, 비고에 원문.
- 크기가 같아 묶였던 도미노 행이 가스별로 나뉘었다 → **행 36 → 38** (가스 쿡탑 3 → 5행).

| 행 | gas_types | 원문 |
|---|---|---|
| ER3A6AD70L | LPG | `Liquidgas G30,31 28-30/37 mbar` |
| ER3A6BD70L | LPG | `Liquidgas G30,31 28-30/37 mbar` |
| ER3A6AB70X | **None** | `Towngas 15 mbar (HK)` |
| ER3A6BB70X | **None** | `Towngas 15 mbar (HK)` |
| ER7EA233HK | **None** | `Towngas 15 mbar (HK)` (홍콩 전용 코드) |

- 가스 종류를 모르는(Towngas 전용) 가스 행 **3행**. 모두 `국내판매미확인`.

