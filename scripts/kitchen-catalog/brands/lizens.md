# 리젠스 (`lizens`) — 싱크볼

2026-10-25 수집. 같은 사이트의 수입 브랜드는 `reginox.md` · `altainox.md` (읽는 코드는 `lizens.py` 의 `site_rows()` 를 같이 쓴다).
웹에 없는 2026 카탈로그 모델 10종은 `manual/lizens.json` (손으로 옮긴 행 — 아래).

## 출처

| 무엇 | 어디 (공식) | 비고 |
|---|---|---|
| 목록 | `https://lizens.co.kr/` 메뉴의 `/kr/sinks/list.do?gc2=5,6,7,8,9,10,12,13,21` · `/kr/layons/list.do?gc2=14,15` (`&pn=` 쪽 넘김) | robots.txt `Allow: /` |
| 치수 · 컷아웃 | 제품 페이지 `/kr/sinks/display.do?seq=N` 규격표 `S(외부사이즈)` · `B(내부사이즈)` · `C(컷아웃사이즈)` · `D(배수구사이즈)` · `Cabinet(캐비닛사이즈)` | 글자 |
| 치수 순서 | 리젠스 **2026 카탈로그** `https://lizens.co.kr/catalogfiledownload.do?seq=25` (2026_catalog.pdf, 43쪽) 규격 일람 앞 'HOW TO READ': SIZE `제품 가로 × 세로` · CUT-OUT `인셋 · 언더별 가로 × 세로 × 코너 R` | 한글이 PDF 글꼴에서 글자로 안 나와 쪽 그림으로 읽었다 (값이 아니라 표기 규칙만) |
| 대조 · 웹에 없는 모델 | 같은 카탈로그 규격 일람 p54~79 (PDF 28~40쪽) — PyMuPDF 글자 블록 | `manual/lizens.json` · 아래 '카탈로그와 다름' |

- 외부사이즈 `S` 에 높이가 없다 → 높이(H) = `B(내부사이즈)` 세 번째 값 = 볼 깊이 (2볼은 깊은 쪽, `220(180)` · `150(260)` 은 앞 값). 백조는 '전체 사이즈' 높이(날개~바닥)라 몇 mm 다를 수 있다.
- 컷아웃이 `… (UNDER) / … (INSET)` 둘이면 **UNDER** 값을 칸에 넣었다 (리젠스 페이지: "언더방식만 권장합니다"). 원문은 `cutout_raw`.
- 칸을 비운 컷아웃: 범위 값(리폼볼 `940~960 x 470~495 x R13(인셋)`) · 모서리 R 이 여럿(Bowls `R90/R1088/R4695`) · 세 번째 값이 R 이 아님(ISS 480(L) `380 x 350 x 180`).
- 외부사이즈가 내부(볼)보다 작은 페이지는 오기로 보고 `치수확인필요` (SQL 제외): GQE 9803 엠보 `S 840 x 515 · B 910 x 400 x 230` (카탈로그 980 × 520).
- `ST 300~1200` (작업대) · `SG 600` (가스대) 은 볼이 없어 뺐다.
- 수전 구멍: 페이지 · 카탈로그 모두 없다. `Cabinet(캐비닛사이즈)` (권장 하부장 폭)은 `install_notes` 에만 넣었다.

## 수집 수

| | `out_lizens.json` | `manual/lizens.json` |
|---|---:|---:|
| 제품 페이지 (리젠스 분류) | 120 (작업대 · 가스대 2 제외 118) | 카탈로그 10 |
| 행 (크기가 같은 것 묶음) / 모델 코드 | 83 / 118 | 10 / 15 |
| SQL 행 / 검증 / 미검증 | 77 / 76 / 1 | 10 / 10 (`매뉴얼`) / 0 |
| 건너뜀 | 6 | 0 |
| 컷아웃 가로 × 세로 (R 포함) | 50 (50) | 4 (4) |
| 수전 구멍 | 0 | 0 |
| 대표 사진 | 83 | 0 (카탈로그) |

`manual/lizens.json` 모델: QWE(EN) 1103 · 9603 · 8603 (Works, 인셋 범위 컷아웃만) · QWCR 8345 E(EN) · GQ(E) 8403 (인셋 범위) · HQCR 9645/HQ 9 · HQCR 8645/HQ 8 · HQCR 6645/HQ 6 (ALTERA, 언더 R8) · HREN 9003/HR 9 · HREN 8603/HR 8 (ALTERA, 인셋 범위).
ALTERA 의 볼 크기는 규격 일람(`610 x 440 x 230`)과 제품 소개 쪽(`610 X 400 X 230`)이 달라, 컷아웃 세로 406 과 맞는 제품 소개 쪽 값을 썼다.
SQL: `python -I to_sql.py out_lizens.json manual/lizens.json` (모델 코드가 겹치지 않는다).

## 정확도가 떨어지는 행 — 사장님 확인용

웹 페이지와 2026 카탈로그가 다른 모델 (페이지 값을 넣고 비고에 카탈로그 값을 남겼다 — `lizens.py CATALOG_DIFF`):

| 모델 | 웹 페이지 | 2026 카탈로그 (PDF 쪽) |
|---|---|---|
| GQE 9803 엠보 | 외경 840 × 515 (볼보다 작음 → SQL 제외) | GQ(E) 9803 980 × 520 (28) |
| LS 850 | 컷아웃 UNDER 826 × 491 R39 | UNDER 820 × 485 R38 (31) |
| LISD 870 · LISDP 870 | 컷아웃 UNDER 838 × 448 R34 | UNDER 841 × 452 R37 (30) |
| GOYO 840 · LQ 840 | 컷아웃 806 × 430 R29 | UNDER 806 × 426 R28 (38 · 32) |
| ISS 480(L) | 컷아웃 `380 x 350 x 180` (볼 크기 복사로 보임 — 칸 비움) | UNDER 450 × 400 R39 · INSET 452 × 402 R40 (34) |
| GOYO 950 | 외경 955 × 460 | 950 × 440 (38) — 컷아웃 921 × 426 은 같음 |
| LD 900 | 외경 900 × 520 · 깊이 210 | 892 × 520 · 깊이 200 (29) |
| LUT 900 | 외경 900 × 520 · 깊이 100 (`868 x 460 x 100 / 818 x 410 x 96`) | 892 × 520 · 깊이 210 (29) |
| LQCR 8345E 엠보 · LQCR 8345N | 외경 830 × 450 (LQCR 8345 행에 묶임) | 830 × 515 (32) |
| GOYO 490 · GOYO 540 · GOYO 750 · LQ 490 · LQ 940 | 볼 깊이 220 · 200 · 210 · 220 · 200 | 210 · 210 · 200 · 210 · 210 (38 · 34 · 29) |
| LS 540(GD 선정) | 볼 깊이 185 | 85 (34, 카탈로그 오타로 보임) |

그 밖:

| 모델 | 무엇이 불확실한가 | 주소 |
|---|---|---|
| ISL 870 | 규격표 칸 이름이 모두 비어 있다 — 다른 페이지 순서(S · B · C · D)로 읽음 → `치수순서추정` | `https://lizens.co.kr/kr/sinks/display.do?seq=126` |
| Bowls LB 350 · LB 390(L/S) · LB 490(L) · LB 780 | 컷아웃이 둥근 모양 (`R90/R1044/R1070`) — 칸 비움, 원문만 | `/kr/sinks/list.do?gc2=8` |
| 리폼볼 GQEN 6503 · 7403 · 9003 · GQEN 9803 | 인셋 컷아웃이 범위 (기존 구멍에 맞추는 교체용) — 칸 비움 | `/kr/layons/list.do?gc2=15` |
| GQ 8503 (+Glass Black) · GQE 8603 (+GQEN 8603) · GQE 8503 Glass Black | 컷아웃이 페이지에 없다 | `/kr/layons/list.do?gc2=14` · `gc2=15` |
| GQ 9803 · GQE 9003 · GQE 9403 | 웹은 언더 컷아웃(916 × 485 등), 카탈로그는 인셋 범위만 | `/kr/layons/…` |
| Layon (SS · SD · SSC · JS · JSC, 상판 일체형) | 컷아웃 없음 (상판 위에 얹는 일체형). 높이 = 볼 깊이 150 · 152 | `/kr/sinks/list.do?gc2=12` |
| 묶인 행: LDS 850 (+LDSP · LDSC · DSC · LDSCP · DSP · DS · DSCP · DSL · DSR 850) · JSC 870 (+JS 870 · HS 870) · LIS 630(L) (+LIS 630(S) · ISS 630(L/S)) · ESP 840 (+ESC · ESCP) · LQCR 8345 (+E · N · EN · COLOR) · SS 1200 (+SSC 1200 · SD 1200) 등 | 크기 · 컷아웃이 같은 다른 모델이 한 행 (코드는 모두 남음) | — |

## 건너뜀

| 모델 | 이유 |
|---|---|
| GQE 9803 엠보 | 외경 < 볼 (페이지 오기) → `치수확인필요` |
| LQ 270 (270 × 440) | 가로 270 이 싱크볼 하한 300 밖 |
| JS 1800 (Layon, 1800 × 550) | 가로 1800 이 상한 1600 밖 |
| SD 900 (Layon) | 내부사이즈(B) 없음 → 높이 없음 |
| SC 360 | B `360 x 400` 에 깊이 없음 (카탈로그 PDF 35쪽: 볼 300 × 313 × 180, 컷아웃 UNDER 340 × 380 R40 — 웹 · 카탈로그 볼 크기가 달라 옮기지 않았다) |
| LB 490(S) | B `520 x 410` 에 깊이 없음 |
| ST 300~1200 · SG 600 | 작업대 · 가스대 (볼 없음) |

## 제조사가 쓰는 종류 낱말 (세부 구분을 정할 때)

- 웹 메뉴: 싱크볼 > `Jumbo` · `Single` · `Double` · `Bowls` · `Quadra` · `GOYO` · `Layon` · `Reginox` · `Altainox`, 리폼싱크볼 > `일반` · `Embo` (`product_type_raw` 에 `싱크볼 > Jumbo` 처럼)
- 설치: `UNDER` · `INSET` (웹은 `언더` · `인셋` 도 씀) — `product_type_raw` 에 `컷아웃 INSET·UNDER`
- 카탈로그 2026 꼬리표: `UNDER` · `INSET` · `INSET UNDER WIDE` · `UNDER WIDE DEEP` · `UNDER DEEP` · `UNDER WIDE DEEP EMBO` · `INSET WIDE DEEP EMBO COATING` · `INSET WIDE DEEP` · `UNDER WIDE DEEP SIDE` · `UNDER WIDE DEEP COATING` · `UNDER DEEP EMBO` · 시리즈 `Works` · `ALTERA` · `HIGH-END QUADRA (GOYO+)`
- 이름: `(L)`/`(S)` · `(L)/(S)` = 큰 · 작은 배수구 (162 · 89), `P` = 포켓, `E` = 엠보, `N` · `EN` = 나노 코팅

## 실행

```bash
python -I collect.py --brands lizens --sample 3 --out sample_lizens
python -I collect.py --brands lizens --out out_lizens          # 요청 약 160 (캐시 뒤 0)
python -I to_sql.py out_lizens.json manual/lizens.json > import-lizens.sql
```

`manual/lizens.json` 은 카탈로그 PDF(curl 로 받음, 20MB)를 PyMuPDF 글자 블록으로 읽어 웹에 없는 10종만 옮긴 것이다 — 수집기가 다시 만들지 않는다.
