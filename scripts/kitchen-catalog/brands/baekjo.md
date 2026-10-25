# 백조씽크 (`baekjo`) — 싱크볼

2026-10-25 수집. 같은 사이트의 수입 브랜드는 `blanco.md` · `apell.md` · `elleci.md` (읽는 코드는 이 파일 `baekjo.py` 의 `site_rows()` 를 같이 쓴다).

## 출처

| 무엇 | 어디 (공식) | 비고 |
|---|---|---|
| 상품 목록 · 분류 · 대표 사진 | `https://baekjosink.com/wp-json/wp/v2/product_list?per_page=100&_embed=wp:featuredmedia` · `/wp-json/wp/v2/products-category` | 사이트(WordPress)가 쓰는 공개 목록. robots.txt 는 `/wp-admin/` 만 막는다 |
| 치수 · 따내기 | 상품 페이지 `https://baekjosink.com/product_list/<slug>/` 의 `전체 사이즈 (T)` · `볼 사이즈 (B)` · `배수구 (H)` · `따내기 사이즈 (C)` | 글자 |
| 치수 순서 | 모든 상품 페이지 주석 `(가로, 세로 ±2mm / 높이 ±5mm)` → 가로 × 세로 × 높이 (W × D × H) | 도면 PDF 4장과 대조 (아래) |
| 도면 (대조만) | 상품 페이지 `PDF 다운로드` — `wp-content/uploads/…-도면.pdf` | 값은 옮기지 않았다 |

- 뺀 분류: 수전 · 기타기기(액세서리) · 스텐상판 · 후드 · LAY-ON TABLE(작업대 `COOKING TABLE` · 가스대 `GAS TABLE`). 사이즈 칸이 한 값뿐인 상품(CONI 6002 · 6004 수전)도 뺐다.
- 도면 대조 (이미지로 보고 순서만 확인): CALMFORTE 860 (가로 860 · 세로 460 · 깊이 200 · 따내기 828 × 432 R24) · SS 900 (900 × 550<600> × 290) · SUBLINE 800-U (830 × 460) · RS 490 (Ø490 · 깊이 185) — 모두 페이지 순서와 같다.
  **BS 324 (US 씽크볼) 는 도면이 가로 382 · 세로 324 인데 페이지는 `324X382X180`** — 순서가 반대다. 그래서 US 씽크볼 분류 전부와 가로 < 세로 로 읽힌 행은 `치수순서추정` (미검증).
- 높이(H): 페이지 '전체 사이즈' 세 번째 값 = 날개 윗면부터 볼 바닥까지. Lay-on(상판 일체형)은 윗면부터 볼 바닥까지 전체 높이 (SS 900 도면: 290, 볼 자체 깊이는 201).
- 수전 구멍(`faucet_hole_mm`): 싱크볼 페이지에 없다 — 인셋 · 언더 볼은 수전을 상판에 단다. 백조 수전 페이지에는 수전마다 `타공 권장 사이즈 Φ 33 ~ 38 mm` 가 있다 (수전은 이번 종류가 아니라 넣지 않았다).

## 수집 수 (`out_baekjo.json`)

| | 수 |
|---|---:|
| 상품 페이지 (REST 목록 전체) | 273 |
| 싱크볼로 읽은 모델 (한 페이지 두 모델 JS 870 · JS 1020 나눔) | 180 |
| 크기 · 따내기가 같은 것끼리 묶은 행 (`collect.py merge`) | 158 |
| 모델 코드 | 204 |
| SQL 로 가는 행 / 검증 / 미검증 | 155 / 142 / 13 |
| 건너뜀 (치수 범위 밖) | 3 |
| 따내기 가로 × 세로가 있는 행 (그중 R 있음) | 112 (100) |
| 수전 구멍 | 0 |
| 대표 사진 원본 주소 | 157 |

## 정확도가 떨어지는 행 — 사장님 확인용

| 모델 | 무엇이 불확실한가 | 주소 |
|---|---|---|
| US 씽크볼 9종: BS 324 · BS 380 · BS 584-16 · BS 594-16 · BS 800-16 · BD 813-16/813R-16 · BD 820-18/16 · BD 822-18/16/822R · BD 832 | 가로 · 세로 순서 (BS 324 도면이 페이지와 반대) · 따내기 `실측요망(Inquiry Required)` | `https://baekjosink.com/products-category/us-sink/` |
| SS 610 (610 × 635) · SQS(R)380 (430 × 457) · Age-Friendly 430 (430 × 476) · IS 430 (430 × 480) | 가로 < 세로 로 읽힘 — 좁은 볼이라 맞을 수 있으나 BS 324 처럼 반대일 수 있다 | 각 상품 페이지 `/product_list/ss-610/` · `/sqsr380/` · `/age-friendly-430/` · `/is-430/` |
| 따내기 없음 (제조사가 `실측요망` · `문의요망` · `편차발생, 실측요망`): CYGNUS 760 · Q833 · PE600 · GD 640/QUIET 640 · OS 800 · IS 530 · CS 1100 · GD 844 · GD 940 · FARM (STS) · FARM (BK) · Age-Friendly 430 · Age-Friendly 835 (+ US 9종) | 상판 따내기 값이 없다 — 상판 발주서에 `[확인 필요]` 로 나온다 | 각 상품 페이지 |
| 따내기에 `(※ 날개편차발생, 실측권장)` 이 붙은 행: CALMFORTE 760 · 800 · 860 · 860 MAX · GD 540 · GD 760 · GRAND 800 · GRAND 860 · GD 960 · BJ 84 · Galaxy 850(QLD 850) · ENAMELED 540 · ENAMELED 860 | 값은 있으나 제조사가 실물 실측을 권한다 (프레스 볼 날개 편차) | 각 상품 페이지 |
| 따내기 R 없음: MANO860 · MANO680 · MANO530 (`(인셋)` · `(인셋권장)`) · SQS 1711 · SQS 1717 · ZR 007 · ZR 008 · ZR 009 · LD 830 · LD 950 · LD 9511 · CALMFORTE 950L | 모서리 R 이 페이지에 없다 | 각 상품 페이지 |
| COLINA 850 · RECO85 · SWSR 850 | 따내기 `822 × 487 × R41 (DS850 비확장 언더 기준)` — DS 850 언더 기준값을 빌려 적었다 | `/product_list/colina-850/` · `/reco85/` · `/swsr-850/` |
| RS 490 (원형) | 따내기 `지름 466 (수전면적체크)` → 가로 · 세로 466, R 233 로 넣음 (원) | `/product_list/rs-490/` |
| MANO860 · MANO680 · MANO530 | 전체 사이즈가 가로 × 세로뿐 — 높이 200 은 볼 사이즈 세 번째 값 | `/product_list/mano860/` 등 |
| Lay-on 29종 → 22행 (SS · NSS · SSC · LW · JS · NJS · JSC · SD · LSD) | 높이 290 · 305 · 307 은 볼 깊이가 아니라 윗면~볼 바닥 전체. `550(600)` 은 깊이 600 변형도 있다는 뜻 — 550 만 넣음 | `/products-category/lay-on-sink/` |
| 묶인 행 (크기 · 따내기가 같아 한 행, 이름은 첫 모델): SQS 1717 + SQS 2311 (볼 배치 다름) · SS 1200 L/R + SSC 1200 + SD 1200 L/R + LSD 1200 (1볼 · 2볼 섞임) · SS 1067 + SD 1067 · SS 900 + NSS 900 · JS 1200 + NJS 1200 · JS 1500 + JSC 1500 · DS 850 + FDS 850 + SDS 850 + NS 850 · HE 940 + HN 947 · RD 890 + RS 890 · HN 500 + WDS 500 · EDSH 880 + DS 880 · COLINA 850 + RECO85 · Galaxy 850 + QLD 850 · CECNRW 8630 + ECNRW 8630 | 다른 모델이 한 행에 묶였다 (모델 코드는 모두 남음) — 상판 따내기에는 영향 없음 | — |

## 건너뜀

| 모델 | 이유 |
|---|---|
| SQS(R)230 (280 × 457 × 220) · CALMFORTE 230 (280 × 450 × 210) | 가로 280 이 `collect.py BOUNDS` 싱크볼 하한 300 밖 → `치수확인필요` (SQL 제외). 값 자체는 페이지 그대로 |
| JS 1800 L/R (1800 × 550 × 305, Lay-on) | 가로 1800 이 상한 1600 밖 |
| 수전 38 · 기타기기 17 · 후드 7 · 스텐상판 2 · 작업대 · 가스대 2 · 도마 1 | 싱크볼이 아님 |

## 제조사가 쓰는 종류 낱말 (세부 구분을 정할 때)

- 메뉴: `인셋/언더씽크볼` (하위 `인셋/언더` · `중형배수구` · `법랑씽크` · `팜씽크` · `Age-Friendly 씽크`) · `PREMIUM 씽크볼` · `CONI 씽크볼` · `US 씽크볼` · `Lay-on 씽크볼` (하위 `SINGLE LAY-ON` · `DOUBLE LAY-ON` · `JUMBO LAY-ON` · `LAY-ON TABLE`)
- 라인: `BAEKJO` · `Calm:forte` · `Bel:forte` · `Quiet` · `CONI` (`line` 칸)
- 따내기 단서: `(인셋 설치 기준)` · `(인셋)` · `(인셋권장)` · `(DS850 비확장 언더 기준)` · `날개편차발생, 실측권장`
- 이름 끝: `L/R` (배수구 좌 · 우) · `P…(포켓)` · `-100R` · `-50R` · `-30R` (안쪽 모서리 R) · `(2EA)` 2볼
- 행의 `product_type_raw` 에 메뉴 이름을 그대로 넣었다. Calm:forte · Bel:forte · CONI 분류는 인셋/언더 표시가 없어 비어 있다.

## 실행

```bash
python -I collect.py --brands baekjo --sample 3 --out sample_baekjo
python -I collect.py --brands baekjo --out out_baekjo        # 요청 약 280 (캐시 뒤 0)
```
