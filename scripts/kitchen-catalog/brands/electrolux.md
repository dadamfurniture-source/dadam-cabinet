# 일렉트로룩스 (Electrolux) — `brands/electrolux.py`

출처는 한국 법인 공식 몰 `www.electrolux.co.kr` 이다. 사이트 이름 표기에 맞춰 브랜드는 `일렉트로룩스` 로 넣는다.

```bash
python -I collect.py --brands electrolux --sample 3 --out sample_electrolux
python -I collect.py --brands electrolux --out out_electrolux     # 요청 ~22개 (robots · 사이트맵 · 메뉴 4 · 제품 16)
```

## 출처

| 무엇 | 어디서 | 근거 태그 |
|---|---|---|
| 목록 | `sitemap.xml` 의 `/appliances/(ovens\|hobs\|kitchen-hoods\|dishwashers)/<코드>/` 와 메뉴 페이지의 제품 링크를 합친다. 단종 페이지도 사이트맵에 남아 있다. 판매 상태는 페이지 schema.org `availability` 값(`InStock` · `Discontinued`)을 `sale_status` 에 넣는다 | — |
| 외경 · 타공 · 용량 | 상품 페이지 '기술사양' — `Size W x D x H, mm` 와 '제품 크기' 의 너비 · 깊이 · 높이 · 타공 너비 · 타공 깊이 (칸 이름이 있다) | 검증 |
| 오븐 설치 공간 | 한국어 사용설명서 PDF '2.1 설치' 표 (캐비닛 최소 높이 · 너비 · 깊이) → `manual/electrolux.json`. 페이지의 '개방 시 너비 · 폭 · 높이' 는 'Built-in(설치 공간)' 을 잘못 옮긴 말로 보여 원문만 `niche_raw` 에 남긴다 (KOBAS31X 560 · 550 · 600 = 설명서 너비 · 깊이 · 작업대 하부 높이) | `매뉴얼` |
| 단종 인덕션 치수 | 상품 페이지에 사양이 없는 CIV60334 · CIV60344 · LIV63344 는 설명서 PDF 7쪽 설치 그림을 눈으로 읽었다 | `이미지판독` (미검증) |
| 타공 R · 비고 | Dimension Guide PDF (`…-dim-….pdf`) 글자 | `매뉴얼` |
| 사진 | 페이지 `og:image` (`/globalassets/appliances/…-1500x1500.png`, 크기 지정 쿼리는 뗀다) | — |

- robots.txt 는 `/appliances/` 와 `/globalassets/` 를 허용한다 (막는 곳은 /my-account · /login · /util · /Episerver 등). 페이지는 Fetcher 로, PDF 17개는 curl 로 하나씩 1.4초 이상 간격으로 받았다.

## 2026-10-25 수집 — 변형 13 → 11행 · SQL 11행 (검증 10 · 미검증 1)

| 종류 | 행 | 모델 코드 | 검증 | 미검증 | 모델 |
|---|---:|---:|---:|---:|---|
| 빌트인 오븐 | 2 | 2 | 2 | 0 | KOBAS31X 70L `steam_oven` 595×594×567 · 설치 공간 560 × 578(작업대 하부 600) × 550 (판매 중) / KVLBE00X 43L 콤비(전자레인지) `combi` 595×455×567 · 설치 공간 560 × 444(460) × 550 (단종, 설명서 값) |
| 쿡탑 | 4 | 6 | 3 | 1 | EIS62344 590×44×520 · 타공 560×490 / EIV63344 같은 크기 (품절) / EIS84041 80cm 780×51×520 · 타공 750×490 R5 / CIV60334 · CIV60344 · LIV63344 (단종) 590×44×520 `이미지판독` |
| 식기세척기 | 4 | 4 | 4 | 0 | EFF9482SXA 14인용 598×850×603 · ESZ69300SX 15인용 598×850×603 · ESF5512LOX 13인용 600×850×625 (모두 프리스탠딩) · ESF7552ROX 13인용 600×850×610 (설치 방식 없음 → `category_subtype` 비움) |
| 후드 | 1 | 1 | 1 | 0 | ECI6300S 아일랜드 60cm 598 × 770~1200 × 483 (`치수범위`) |

- 판매 상태: InStock 8행 · Discontinued 2행 (KVLBE00X, CIV/LIV 묶음). 사진 11/11.
- 모든 인덕션은 `built_in` 이다. 쿡탑 옆 · 뒤 여유는 설명서 그림에만 있다 (옆 벽 min. 50 · 뒤 min. 55 · 후드까지 min. 500). 그래서 검증 행에는 숫자 칸으로 넣지 않고 `install_notes` 에만 두었다 (그림 값을 넣으면 검증 행이 미검증이 된다).

## 정확도가 떨어지는 행 · 사장님 확인 필요

| 모델 | 무엇이 불확실한가 | 어디서 확인 |
|---|---|---|
| CIV60334 · CIV60344 · LIV63344 (단종 인덕션) | 상품 페이지에 사양이 없다. 외경 590 × 520 × 44 와 타공 560+1 × 490+1 · max R5 는 설명서 그림을 눈으로 읽은 값이다 (`이미지판독`). 타공은 `cutout_raw` 글로만 넣고 숫자 칸은 비웠다 — 같은 크기의 검증 행(EIV63344)과 collect.merge 가 한 행으로 묶으면 검증 여부가 섞이기 때문이다 | https://www.electrolux.co.kr/globalassets/user-manual/e-civ60334-um.pdf · e-civ60344-um.pdf · induction/e-liv63344-um.pdf 7쪽 |
| EIS84041 | 페이지 높이는 51 인데 Dimension Guide 그림은 44 다. 51 을 넣었다 | https://www.electrolux.co.kr/appliances/hobs/eis84041/ · eis84041-dim-oct22.pdf |
| ECI6300S 아일랜드 후드 | 페이지 높이는 770-1200 인데 Dimension Guide 는 750-1200 이다. 770 을 넣었다. 페이지의 '설치 종류: 빌트인' 은 아일랜드 후드와 맞지 않아 `install_type` 을 비웠다 | https://www.electrolux.co.kr/appliances/kitchen-hoods/eci6300s/ · kr-eci6300s-dm.pdf |
| ESF7552ROX 식기세척기 | 페이지 '설치 타입: 식기세척기' 뿐이라 설치 방식을 모른다. 설명서 제품 설명에 '1 Worktop'(상판)이 있어 프리스탠딩으로 보인다. 설명서 너비는 596 이고 페이지는 600 이다 | https://www.electrolux.co.kr/appliances/dishwashers/esf7552rox/ · /globalassets/e-esf7552rox-um-jan21.pdf 13장 |
| KOBAS31X 설치 공간 | 키큰장(상부) 설치 높이는 최소 578 이고, 작업대 하부 설치는 600 이다. `niche_min_h_mm` 에는 578 을 넣었다. Dimension Guide 그림 표기는 Wall Mount 590 · Underbench 600 이다 | e-kobas31x-um-kr-dec22.pdf 5쪽 · e-kobas31x-dim-apr21.pdf |
| EIS62344 | 페이지가 거는 설명서는 `e-cis62344-um-ko-apr21.pdf`(CIS62344)로, 다른 코드의 설명서다. 쓰지 않았다 | https://www.electrolux.co.kr/appliances/hobs/eis62344/ |

## 뺀 것

- EMM23K18GW 23L 스탠드형 전자레인지 (단종): 페이지에 사양이 없고, 설명서(영문)에도 외경이 없다. 설명서의 여유 값(옆 · 뒤 7.5 cm, 위 30 cm, 바닥에서 85 cm)만 있다. 페이지 제목 코드는 EMM20K18GWI 로 다르다.
- EIV65344 (단종): 페이지에 사양이 없다. 걸린 설명서 `eiv65344--um-ko.pdf` 는 표지가 EIV63344 인 다른 모델 파일이다.
- KBD4X 빌트인 워밍 드로어 (단종): 오븐 · 쿡탑 등 대상이 아니다.
- 냉장고 (`/appliances/frigers/`) · 커피머신 · 소형가전은 범위 밖이다.
