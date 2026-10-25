# 스메그 (Smeg) — `brands/smeg.py`

출처는 공식 수입사 (주)제이컬렉션 = 스메그코리아 `www.j-collection.co.kr` 이다 (냉장고 수집기와 같다). 수입사 고시 값의 칸 순서가 틀린 곳은 같은 모델 코드의 제조사 글로벌 페이지 `www.smeg.com/products/<코드>` 로 맞춘다. 브랜드는 `스메그` 로 넣는다.

```bash
python -I collect.py --brands smeg --sample 3 --out sample_smeg
python -I collect.py --brands smeg --out out_smeg        # 요청 ~80개 (목록 14 + 상세 40 + smeg.com 24)
```

## 출처

| 무엇 | 어디서 | 근거 태그 |
|---|---|---|
| 목록 | 냉장고 수집기의 `sm_list` 를 쓴다 (`product_list.php?cate=` → 'MORE' 가 부르는 `POST /product/product_proc.php`). 메뉴: 오븐 `16` · 인덕션 `24` · 후드/오븐 일체형 인덕션 `787` · 주방후드 `31` · 식기세척기 `28` · 오븐/1구인덕션 `772` · 프로페셔널 소형오븐 `203` | — |
| 외경 · 인용 · 용량 | 상세 `product_view.php?pseq=` 의 '상품 정보 고시' `크기, 용량, 형태`. 칸 순서는 원문 괄호에서 읽는다 — `(WxDxH)` · `(가로x세로x높이)` (세로 = 깊이) | 검증 |
| 순서 바로잡기 | 고시에 순서가 없거나, 그 순서로 읽으면 종류별 범위를 벗어나는 경우 (예: 쿡탑 깊이 50). ① 같은 메뉴 수입사 페이지 비교표에서 같은 세 숫자에 붙은 순서 `900x450x430mm(WxHxD)` 를 쓴다. ② 없으면 smeg.com 의 `Width` · `Depth` · `Product Height` 칸을 쓴다. ③ 그래도 없으면 기본 순서로 읽고 `치수순서추정` 을 단다. 어떤 길로 읽었는지 `size_raw` 에 적는다 | 검증 (③만 미검증) |
| 쿡탑 타공 | smeg.com `Worktop Cut-Out` (`478-482x555-560 mm` · `490x750 mm`). 외경 안에 들어가는 쪽을 가로 · 깊이로 정한다 | 검증 |
| 빌트인 오븐 · 식기세척기 설치 공간 | 공식 도면 그림에만 있다 → `manual/smeg.json`. 오븐은 제조사 제품 시트 PDF (`pi-exchange.smeg.it/catalog/<코드>/en-ZW` 4쪽, smeg.com 'Product sheet' 링크), 식기세척기는 수입사 상세 페이지 설치 그림 | `이미지판독` (미검증) |
| 여유 | 수입사 설치 문장: '뒷 공간 5cm, 양 옆 공간 3cm' → 뒤 50 · 옆 30, '가구장 뒷판과 벽면 사이에 최소 25mm' → 뒤 25 | 검증 |
| 사진 | 상세 `pro_view_swiper_single` 첫 장 (`/upload/product/…`) | — |

- robots.txt: j-collection.co.kr 은 `/product/` 를 허용한다 (막는 곳은 /member · /order 등). smeg.com 은 `/products/` 를 허용한다. pi-exchange.smeg.it 에는 robots.txt 가 없다 (404). **doc.smeg.it (설명서 PDF)는 robots.txt 가 `Disallow: /` 라 쓰지 않는다.** 처음에 robots.txt 를 보기 전에 PDF 1개(28 KB)를 받았지만, 확인한 뒤 열지 않고 지웠다.
- 같은 크기 · 구분인 색상 변형은 플러그인 안에서 한 행으로 묶는다. 이때 태그도 합친다. collect.merge 는 첫 행의 태그만 남기기 때문이다.

## 2026-10-25 수집 — 16행 · 모델 코드 30 · SQL 16행 (검증 11 · 미검증 5)

| 종류 | 행 | 모델 코드 | 검증 | 미검증 | 모델 |
|---|---:|---:|---:|---:|---|
| 빌트인 오븐 | 4 | 7 | 0 | 4 | 리니아 SO6102TB3 · TG `oven` / 빅토리아 SOP6902S2PN · PX · PP `steam_oven` (Combi Steam) / 옴니셰프 SO6104APB3 `combi` (전자레인지 900W 포함) / 클래식 SO6302TX `oven` — 모두 597×592×548 · 설치 공간 560~568 × 583~585 × 560↑ (`이미지판독`) |
| 카운터탑 오븐 | 4 | 10 | 4 | 0 | 리얼스팀 콤비오븐 COF01 5색 `steam_oven` 500×400×510 · 30L · 옆 30 · 뒤 50 / 프로페셔널 ALFA43K · ALFA43XMFDSK · ALFA43XE1HDSK `oven` 602×537×584 · 60L / ALFA43XE2HDSK · SPS43GHK1 `steam_oven` 같은 크기 — 모두 `freestanding` |
| 쿡탑 | 4 | 7 | 4 | 0 | 클래식 SI364BM · SI364FXM, 빅토리아 SI964PM · SI964XM 596×60×510 · 타공 555×478 / 후드일체형 HOBD382MB2 · HOBD482D2 830×230×520 · 타공 750×490 · 뒤 25 / 포터블 1구 PIC01WHMEU 315×54×412 (`freestanding`) |
| 후드 | 3 | 5 | 3 | 0 | 돌체스틸노보 KSVV90NRA · KSVV90NX 900×450×430 / 빅토리아 KT90PE · KT90BLE `chimney` 900×740×480 (굴뚝 기둥 제외) / 클래식 KD90HXE `chimney` 900×800×540 |
| 식기세척기 | 1 | 1 | 0 | 1 | 레트로 ST2FABCRK2 빌트인 12인용 598×818×584 · 하부장 600 × 820↑ × 575↑ (`이미지판독`) |

- 사진 16/16. 설치 공간 5행, 타공 3행, 여유 5행.
- 오븐 용량은 smeg.com 의 `Net volume of the cavity` (68 L)에서, 카운터탑 오븐 용량은 고시 '30리터' · '60리터' 에서 읽었다.

## 정확도가 떨어지는 행 · 사장님 확인 필요

| 모델 | 무엇이 불확실한가 | 어디서 확인 |
|---|---|---|
| 빌트인 오븐 4행 (SO6102 · SOP6902 · SO6104APB3 · SO6302TX) | 설치 공간 너비 560~568 · 높이 583~585 · 깊이 min.560 은 제품 시트 4쪽 그림을 눈으로 읽은 값이다. 깊이 방향의 490-500(바닥) · min.15 · 35-40 · 400-554 는 `niche_raw` 에만 남겼다. 외경은 고시와 smeg.com 이 597 × 548 × 592 (W × D × H)로 같다 | https://pi-exchange.smeg.it/catalog/SOP6902S2PP/en-ZW (코드만 바꿔서) |
| SOP6902S2PN · SOP6902S2PX | 상품정보고시 '품명 및 모델명' 이 둘 다 크림 색상 코드 `SOP6902S2PP` 다 (`고시불일치`). 외경 · 제품 시트 'Alternative products' 는 같다 | https://www.j-collection.co.kr/product/product_view.php?pseq=4205 · 4204 |
| SI364BM · SI364FXM | 고시가 `596x50x510mm(WxDxH)` · `596x60x510mm(WxDxH)` 로 순서가 틀렸다 (깊이 50/60). BM 은 숨김 사이즈 칸도 높이 50 인데, smeg.com 과 수입사 비교표는 596 × 510 × **60** 이다. smeg.com 값(높이 60)을 넣었다 | pseq=4463 · 4877 · https://www.smeg.com/products/SI364BM |
| KT90PE · KT90BLE | 고시 `900X740X480mm(굴뚝 기둥 제외)` 에는 순서가 없다. 주방후드 메뉴의 다른 페이지 비교표에 같은 값이 `(WxHxD)` 로 있어 900 × 740 × 480 으로 넣었다 (제품 시트 그림도 900 · 480 · 740 이고, 굴뚝 포함 전체 높이는 min 900 ~ max 1175). 그런데 KT90 페이지 자체 비교표와 smeg.com 은 **895 × 740 × 530** 이다 | pseq=3171 · https://www.smeg.com/products/KT90PE |
| KD90HXE | 고시 `900X800X540mm(WxDxH)` 대로 읽으면 깊이가 800 이 된다. 비교표의 `(WxHxD)` 로 읽어 900 × 800 × 540 을 넣었다 (제품 시트 그림: 높이 min.800 ~ max.1230, 깊이 540). smeg.com 은 900 × 555 × 1230 이다. 높이 800 은 굴뚝을 가장 낮췄을 때 값이다 | pseq=3333 · https://pi-exchange.smeg.it/catalog/KD90HXE/en-ZW 3쪽 |
| KSVV90NRA · KSVV90NX | smeg.com 에 이 코드가 없다 (한국 전용 코드). 고시에는 순서가 없어 비교표 `900x450x430mm(WxHxD)` 순서로 읽었다. 수입사 비교표상 '트윈슬로프 패널 구조 · 실내 재순환형' (굴뚝 기둥 없음)이라 `category_subtype` 을 비웠다 | pseq=3172 · 3173 |
| ST2FABCRK2 | 설치 공간(하부장 폭 600 · 높이 820 min · 깊이 575 min)은 그림을 눈으로 읽었다. 그림의 제품 높이는 818 - 888 (다리 조절), 손잡이 포함 깊이는 630 이다. smeg.com 에 이 코드가 없다 | https://www.j-collection.co.kr/images/product_detail/ST2FAB2/st2fab2_img_15.png |
| COF01 · ALFA43 · SPS43 | 카운터탑(올려 쓰는) 오븐이다. 전자레인지 기능이 없어 `oven` `freestanding` 으로 넣었다. 오븐장에 넣을 때의 설치 공간 값은 없다. 여유(옆 3 cm · 뒤 5 cm)는 수입사 문장 값이다. ALFA43 · SPS43 은 '프로페셔널(전문가용)' 메뉴 상품이다 | pseq=4712 · 4645 · 4003 |
| PIC01WHMEU | 고시 깊이 412.5 를 반올림해 412 로 넣었다 | pseq=4893 |

## 뺀 것

- 빅토리아 오븐일체형 인덕션 TR90IMP · TR90IMBL (900×600×900): 쿡탑과 오븐이 한 몸인 레인지라 뺐다.
- 부속품: JCIDT-6080 인덕션 프레임 · 에어프라이 트레이 · JCSRD-32 스텐 오븐랙 · JCSRD-31 바퀴 · 기본 트레이3820 · JCWR-03 우드 오븐랙. 고시에 정격전압 · 소비전력 칸이 없는 상품은 부속품으로 본다.
- 프로페셔널 대형오븐 메뉴 `204` (ALFA1035E1HDS 798×792×1102 · ALFA625E1HDS 798×757×793)와 업소용 식기세척기 메뉴 `205` (UD511DK 언더카운터 · 바구니): 업소용이라 목록을 읽지 않았다.
- 냉장고 · 와인셀러는 냉장고 수집기가 모은다. 커피머신 · 토스터 · 포트 등 소형가전은 범위 밖이다.
