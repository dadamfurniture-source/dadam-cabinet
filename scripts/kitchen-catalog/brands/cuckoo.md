# 쿠쿠 (`brands/cuckoo.py`, `--brands cuckoo`, brand `쿠쿠`)

2026-10-25 개정. 밥솥(기존 — 홈 화면 상품만이던 것을 넓힘) + 인덕션 · 하이브리드 · 1구 전기레인지 · 스탠드 가스레인지 ·
식기세척기 · 전자레인지 · 광파/복합오븐레인지(새로).

```bash
python -I collect.py --brands cuckoo --sample 3 --out sample_cuckoo
python -I collect.py --brands cuckoo --out out_cuckoo      # 상품 페이지 약 255개 (캐시 뒤 0개)
```

브랜드 이름은 `Cuckoo` → `쿠쿠` 로 바꿨다 (to_sql 은 둘 다 `쿠쿠` 로 넣으므로 DB 결과는 같다).

## 어디서 가져오나

| 무엇 | 주소 | 비고 |
|---|---|---|
| 상품 찾기 ① | `https://www.cuckoo.co.kr/` 홈 화면 상품 링크 (168) | 기존과 같다 |
| 상품 찾기 ② | `/planning` · `/planning?exhibitGubun=R` 기획전 목록 → `/planning/planningView?page=1&idx=…` 12개 본문 (그림 지도 `<area alt="CIR-E349FAW" href=productView…>`) | robots.txt 허용 경로 |
| 상품 찾기 ③ | 주방가전 상품 페이지 안의 '함께 사면 좋은 제품' · 색상 변형(JSON-LD `hasVariant`) 링크 — 링크 글자 · 그림 alt 가 주방가전일 때만 따라간다 | 부속품(내솥 · 패킹 · 필터 · 세제) · 공기청정기 등은 따라가지 않는다 |
| 상품 찾기 ④ | 검색엔진(WebSearch `site:cuckoo.co.kr productView …`)으로 찾은 공식 상품 번호 101개 (`CK_SEEDS`) | 검색은 주소 찾기에만. 값은 늘 공식 상품 페이지에서 |
| 치수 ① (정본) | 상품 페이지 '상세 정보' 표(상품정보고시) `크기(길이,폭,높이) 392x269x265(mm)` — 길이 = 깊이 | 칸 이름이 `크기(넓이,길이,폭)` · `크기(넓이,폭,길이)` · `크기` 처럼 맞지 않는 곳은 값 순서(밥솥 길이 × 폭 × 높이, 그 밖 가로 × 깊이 × 높이)로 읽고 `치수순서추정`. 값에 표시가 붙은 곳(`38.3cm(길이)x26.2cm(폭)x26.0cm(높이)` · `238㎜(W) × 329㎜(L) × 220㎜(H)`)은 그 표시대로(검증). `조리실:…/제품외형:440*341*258` 은 외형만 |
| 치수 ② | 같은 페이지 '상세정보' 요약 글(`geo_detail_cont`) — `W588 x D508 x H57mm` · `291(W) x 371(L) x 46(H)` · `588 x 508 x 57mm` | `요약문` (미검증). 표시 없는 셋은 `치수순서추정`도. '조리실 내부 크기' 는 건너뛴다 |
| 치수 ③ | 상품 페이지 '제품설명서' 단추 · JSON-LD `사용설명서` PDF (`https://cdn.cuckoo.co.kr/upload_cuckoo/_bo_rep/manual/…pdf`) 의 '제품규격 · 제품의 크기' | 52개를 curl 로 하나씩 받아(1.3초 간격, 약 1 GB) 읽었다. **글자가 거의 다 외곽선 · 스캔 그림** — 사양 쪽을 그림으로 그려 눈으로 읽어 `CK_MANUAL` 에 옮겼다 → `이미지판독`. 글자로 뽑히는 2개(CMW-PF2310EW · CRP-PHTR0610FSM)만 `매뉴얼` |

- robots.txt (`www.cuckoo.co.kr`): `/mycuckoo/` · `/searchWord/` · `/rest/` · 주문 경로 · 추적 파라미터를 막는다. 상품 목록 API(`/rest/mall/mallProductSearch`)와 **제품설명서 검색(`/rest/customer/productManualSearch` · `/rest/common/downloadManualFile`)도 `/rest/` 라 쓰지 않았다.** 분류 목록 페이지(`/mall/productList?categoryCd=`)는 허용이지만 상품을 `/rest/` 로 그려 HTML 에 링크가 없다. `cdn.cuckoo.co.kr/robots.txt` 는 홈으로 넘어간다(규칙 없음).
- 종류는 상품 페이지 JSON-LD 빵부스러기(밥솥 · 인덕션 · 가스레인지 · 식기세척기 · 전자레인지)로, 빵부스러기가 없는 옛 페이지는 상품 이름으로 가린다.
- 설치: 3구 전기레인지는 빌트인 · 프리스탠딩 겸용이라 `built_in` (설명서마다 '빌트인 설치 요령'), 1구 · 케이스포함 · 가스레인지(스탠드)는 `freestanding`. 식기세척기 6인용 이하 `countertop`, CDW-BS1210U 는 설명서대로 프리스탠딩(세미빌트인은 BS12B10U), 14인용 스팀샷 시리즈는 `built_in`.
- 설명서 값이 고시(검증)와 ±2 mm 안이면 고시를 그대로 둔다. 요약 글 · 추정 행은 설명서 값으로 바꾸고 `이미지판독` (요약 글과 숫자가 같아도 — 칸 방향 확인).
- 특가 · 타임딜 페이지엔 '제품설명서' 단추가 없는 곳이 있어 같은 모델 코드의 다른 페이지 설명서를 쓴다. 14인용 스팀샷(BS1410B · BSST14B · BSGL14B · BS1420B) 은 시리즈 공통 설명서 한 개를 쓴다.
- 요약 글에서만 읽은 밥솥 중 같은 인분 · 같은 세 치수(±2)인 확인된 행과 W · D 만 반대인 것은 확인된 행의 방향으로 칸을 옮기고 `치수순서추정`을 더한다 (요약 글은 폭 · 깊이를 뒤바꾼 곳이 많다 — 트윈프레셔 6인용 'W383 x D262' · 설명서 '38.3cm(길이) x 26.2cm(폭)').

## 수집 수 (out_cuckoo.json → to_sql 기준)

| 종류 | 행 | 모델 코드 | 검증 | 미검증 | SQL 건너뜀 |
|---|---:|---:|---:|---:|---:|
| 밥솥 | 39 | 62 | 11 | 26 | 2 |
| 쿡탑 (인덕션 · 하이브리드 · 1구 · 가스) | 24 | 54 | 0 | 8 | 16 |
| 식기세척기 | 6 | 13 | 0 | 5 | 1 |
| 전자레인지 · 광파/복합오븐 | 18 | 21 | 2 | 9 | 7 |
| **합계** | **87** | **150** | **13** | **48** | **26** |

전과 비교 (kitchen.json 2026-10-25 아침): 밥솥만 10행(SQL) · 14코드 · 검증 1 → 4종류 61행(SQL) · 150코드 · 검증 13 · 미검증 48.

- 상품 페이지 255개 확인 → 주방가전 변형 186 → 같은 크기끼리 87행. 주방가전이 아니라 뺀 것: 밥솥 분류의 부속품 · 세트 12, 빵부스러기 없는(판매 끝 · 빈) 페이지 21, 공기청정기 14, 프라이팬 · 웍 6, 에어프라이어 1.
- 사용설명서 대조(행 기준): 요약 글 값을 설명서가 확인 20 · 설명서로 고침 12 · 고시와 같음 1.
- 타공이 들어간 쿡탑 2행 (CIR-E30 · GP30 · FL30 시리즈 — 560 × 480 mm, 뒤 벽 60 mm, 모서리 R30/C30 이하 · 설명서 '빌트인 설치 요령' 그림).
- 미검증이 많은 까닭: 쿠쿠 최근 상품 페이지는 상품정보고시 표가 비어 있고(요약 글뿐), 설명서는 그림이다. 검증 13행은 모두 상품정보고시 표 값이다.

## 정확도가 떨어지는 행 (사장님 확인용)

| 모델 | 무엇이 불확실한가 | 주소 |
|---|---|---|
| 설명서를 눈으로 읽은 행 (`이미지판독`, 밥솥 20 · 쿡탑 4 · 식기세척기 3 · 전자레인지/광파 3) | 설명서 '제품의 크기' 그림을 사람이 옮겼다 — 오독 가능. PDF 와 쪽은 비고(`사용설명서 n쪽 '…'`)와 `source_url` | 각 행 `source_url` |
| CRP-LHTR0610FG*M · LHLR0610FW (트윈프레셔 6인용) | 요약 글 'W383 x D262' — 설명서 81 · 76쪽 '38.3cm(길이) x 26.2cm(폭)' 으로 W262 D383 로 고침 | https://www.cuckoo.co.kr/mall/productView?productNo=5420 · 11275 |
| CRP-NHTR1010FGW 사일런스 10인용 | 요약 글 'W411 x D302' → 설명서 71쪽 41.1(길이) × 30.2(폭) 로 W302 D411 | https://www.cuckoo.co.kr/mall/productView?productNo=7224 |
| CRP-T0310FGW 미니 3인용 | 요약 글 'W335 x D240 x H227' 은 쁘띠(MHTR0310) 값이 옮겨진 것 — 설명서 51쪽 31.6 × 22.6 × 23.3 cm 로 고침 | https://www.cuckoo.co.kr/mall/productView?productNo=6343 |
| CIR-FL301FB · FL301MFB 초고온 3구 | 요약 글 높이 67 ↔ 설명서 30쪽 6.1 cm — 설명서 값(61) | https://www.cuckoo.co.kr/mall/productView?productNo=5150 |
| CDW-D0620TWE 더 슬림 6인용 | 요약 글 D345 ↔ 설명서 31쪽 (D)350 — 설명서 값 | https://www.cuckoo.co.kr/mall/productView?productNo=9530 |
| 14인용 스팀샷 CDW-BSST14BDG · BS1420BGI(E) · BS1410BDGE · BS1410BWE | 요약 글 D570 ↔ 시리즈 설명서 39쪽 (D)575 — 설명서 값. 설명서 단추는 CDW-BS1420BGI 페이지에만 있다 | https://www.cuckoo.co.kr/mall/productView?productNo=7108 |
| CDW-BS1210UDG 12인용 | 프리스탠딩 598 × 600 × 845. 상판을 떼고 빌트인하면 높이 815, 설치 공간 폭 600 · 높이 820 · 깊이 600 이상 (설명서 39쪽 그림, 비고에만) | https://www.cuckoo.co.kr/mall/productView?productNo=5918 |
| 요약 글만 있는 3구 인덕션 (CIR-E347 · E349 · EP347 · EP349 · G301FAP · HS301/302 · H301 · KS301 등) | 모두 '588 x 508 x 57' (같은 시리즈 설명서 E30 · EP30 · GP30 과 같은 값)지만 그 모델 설명서는 없다 — `요약문`. 타공은 넣지 않았다 | 예: https://www.cuckoo.co.kr/mall/productView?productNo=9570 |
| CRP-DHPNL0615FGW 그레이스 화이트 6인용 | 요약 글 '380(W) x 268(D) x 261(H)' — W > D 로 다른 6인용과 반대인데 맞출 확인 행(±2)이 없다 | https://www.cuckoo.co.kr/mall/productView?productNo=10159 |
| CRP-ST1015FWGM 더 라이트 10인용 | 요약 글 'W389 x D290' — 위와 같은 의심 | https://www.cuckoo.co.kr/mall/productView?productNo=9582 |
| CRP-JHR1060FD 10인용 | 고시 칸 이름 '크기(넓이,길이,폭)' 이 틀렸다 — 설명서 66쪽 42.3(길이) × 30.5(폭) × 29.0 으로 W305 D423 (`이미지판독`) | https://www.cuckoo.co.kr/mall/productView?productNo=7785 |
| CR-0671V 전기보온밥솥 | 고시 '258mm(길이) X 262mm(폭)' — 길이가 폭보다 짧다 (표시대로 D258 W262, 검증) | https://www.cuckoo.co.kr/mall/productView?productNo=2867 |
| CIR-D103FW 포터블 1구 | 요약 글 '350x300x37mm' 표시 없음 — 가로 × 깊이 × 높이로 추정 | https://www.cuckoo.co.kr/mall/productView?productNo=9901 |
| CIHR-D3487MFB 하이브리드 케이스포함 | 요약 글 '588 x 508 x 68.5' 는 상판 본체 값으로 보인다 — 케이스(87 mm) 높이는 들어 있지 않을 수 있다 | https://www.cuckoo.co.kr/mall/productView?productNo=4600 |

## 건너뛴 것 (SQL 에서 빠지는 행 26)

| 상품 | 이유 |
|---|---|
| CIR-JS301FW · KS301FB(AI 트리플 프리존 첫 페이지) · GSNL301FW · EP349FAW · G301FAW(7016) · EP340FAW · CIHR-F301FB · FL306FB · D303FB · CIR-CLT315MFS · CLT387MFS(케이스포함) · DP102FW · DP103FW(셰프스틱 1구) | 상품 페이지에 고시 표 · 요약 글 크기 · 설명서 단추가 모두 없다 |
| CIR-CLT301FS · CL301FDG 초고온 3구 | 요약 글 '588 x 508 x 5.57mm' (높이 오타) → 범위 밖 |
| CGC-BNL201SGW 2구 가스레인지 | 크기 없음 (같은 2구 CGC-BNL201SDS 는 595 × 380 × 161.8 요약문) |
| CMW-SF2310EW · S2310EW · S2510EW(요약 글은 조리실 크기뿐) · DF2320EGW · DF2020EGW · B2310DS 전자레인지 | 크기 없음 |
| CDW-BD0610TG 프리미엄 식기세척기 6인용 | 크기 없음 |
| CRP-DHPNL0615FGW(10306 페이지) · CRP-MHTR0310FG 어반그레이 | 그 페이지엔 크기 없음 (같은 모델 다른 페이지 · 색상은 들어갔다) |
| 에어프라이어(CAF · CAFO) · 커피머신 · 프라이팬 · 웍 · 부속품 | 이번 종류가 아님 |

## 더 넓히려면

- 쿠쿠몰 전체 목록은 `/rest/` 로만 나온다 — robots.txt 를 지키는 한 홈 · 기획전 · 상품 페이지 링크 · 검색엔진이 한계다. 새 상품 번호를 알면 `CK_SEEDS` 에 넣으면 된다.
- 쿠쿠 고객센터에 '제품설명서(텍스트 PDF)' 를 요청하면 `이미지판독` 행을 검증으로 바꿀 수 있다.
