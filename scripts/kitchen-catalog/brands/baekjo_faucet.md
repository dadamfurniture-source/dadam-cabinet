# 백조씽크 (`baekjo_faucet`) — 주방 수전

2026-10-25 수집. 사장님 결정(2026-10-25): **상판 · 싱크볼 수전 구멍 지름은 수전 모델에서 가져온다.**
같은 사이트의 Blanco 수전은 `blanco_faucet.md` (읽는 코드는 이 파일 `baekjo_faucet.py` 의 `faucet_rows()` 를 같이 쓴다).
다른 수전 회사 조사 결과는 맨 아래 절.

## 출처

| 무엇 | 어디 (공식) | 비고 |
|---|---|---|
| 상품 목록 · 분류 · 대표 사진 | `https://baekjosink.com/wp-json/wp/v2/product_list` (`baekjo.py products()` 그대로 — baekjo.py 는 고치지 않음) | robots.txt 는 `/wp-admin/` 만 막는다 (직접 읽음) |
| 수전 구멍 · 높이 | 상품 페이지 `/product_list/<slug>/` 의 `높이(H)` · `지름(C)` · `타공 권장 사이즈` · `컬러` (CONI 수전: `전체 사이즈 (T)` · `따내기 사이즈 (C)`) | 글자 |
| W · D (2023 모델) | 상품 페이지 `도면 PDF 다운로드` — `wp-content/uploads/2023/09/<모델>-도면.pdf` | 글자 층 없는 그림 → 눈으로 읽음 (`이미지판독`) |
| D · 높이 (2025 모델) | 상품 페이지 긴 상세 이미지 끝 `제품 사양` 표 (가로 · 세로 · 타공 치수 · 모델명) — `wp-content/uploads/2025/06/<모델>_상세….jpg` | 그림 → `이미지판독`. 앞모습 폭이 없다 |
| CONI 6002 · 6004 | 상세 이미지 `wp-content/uploads/2026/01/6002.jpg` · `6004.jpg` 의 `제품 사양` 표 + 도면 (ø45) | `이미지판독` |

- 수전 구멍(`faucet_hole_mm`) = 페이지 글자 `타공 권장 사이즈` (CONI 는 `따내기 사이즈`). `Φ 33 ~ 38 mm` 처럼 범위면 **작은 값 33** + `치수범위`, 원문은 `cutout_raw` (상세 이미지 · 도면의 `타공 치수 38Ø` 도 같이 적었다).
- W(본체 폭)는 2023 도면 4장(정면 폭, 옆 손잡이 포함)과 CONI(몸통 ø45)에만 있다. **W 가 없는 행은 `K.put_dims(None)` → `치수확인필요` 로 SQL 에서 빠진다** (`to_sql.py` 는 W · D · H 가 다 있어야 넣는다). 높이 · 토수는 `size_raw` 에 남겼다.
- 2025 상세 이미지 16장 · CONI 2장 모두 `권장하는 수전 타공의 중심과 벽 사이의 거리는 120mm 이상입니다` → `install_notes`.
- 도면 판독값은 `baekjo_faucet.py DRAWINGS` (파일 주소 같이). 이미지 · PDF 는 robots.txt 확인 뒤 1.5초 간격으로 한 장씩 받아 읽었다 (저장소에는 넣지 않음).

## 수집 수 (`out_baekjo_faucet.json`)

| | 수 |
|---|---:|
| 수전 상품 페이지 (분류 `faucet` 30 + CONI 수전 2) | 32 |
| 행 / 모델 코드 (상세 이미지 모델명 `ORA 432` 등 포함) | 32 / 51 |
| 수전 구멍 있는 행 | **32** (33 + 치수범위 29 · 38 3 — FOSS-M · CONI 6002 · CONI 6004) |
| SQL 로 가는 행 / 검증 / 미검증 | 6 / 0 / 6 (모두 도면을 눈으로 읽어 `이미지판독`) |
| 건너뜀 (W 없음 → `치수확인필요`) | 26 — 수전 구멍은 행에 있다 |
| 대표 사진 | 32 (RIVA-U 는 REST 사진이 없어 상품 페이지 첫 사진) |

수전 구멍 값 자체는 32행 모두 **페이지 글자**에서 읽었다 (행 태그의 `이미지판독` 은 W · D · 높이 때문).

## 정확도가 떨어지는 행 — 사장님 확인용

| 모델 | 무엇이 불확실한가 | 주소 |
|---|---|---|
| 백조 수전 거의 전부 (29행) | 수전 구멍 = `Φ 33 ~ 38` 의 작은 값 **33**. 2025 상세 이미지는 `타공 치수 38Ø` 이라 실제로는 38 로 뚫는 경우가 많을 수 있다 | 각 상품 페이지 |
| 2025 16종: ORA · FOSS-I · FOSS-V · ALTO-U · ALTO-O · RIVA-U · RIVA 497 · HORN 545 · SEVEN · SLIM-U · SLIM-V · HORN-D · FOSS-D · ARC-U · ARC-D · FOSS-Z | 앞모습 폭(W) 없음 → SQL 제외. D 는 표의 `가로` (토수구 ~ 몸통 끝, 몸통 중심 기준 아님) | `/product_list/ora/` 등 |
| ALTO-O | 높이: 페이지 440 · 상세 이미지 545 (모델명 ALTO-O 545). 페이지 440 은 ALTO-U 와 같아 복사 오기로 보인다 → `출처불일치` | `/product_list/alto-o-545/` |
| FOSS-Z | 수전 구멍: 페이지 Φ33~38 · 상세 이미지 `36Ø~38Ø` → 33 넣고 `출처불일치` | `/product_list/foss-z/` |
| KAI 553 | 높이: 페이지 410 · 도면 522 (모델명 553) → 페이지 410 을 넣고 `출처불일치` | `/product_list/kai-553/` · `uploads/2023/09/KAI-553-도면.pdf` |
| DORIS 645 | 높이: 페이지 645 · 도면 527 → 페이지 645 를 넣고 `출처불일치` | `/product_list/doris-645/` · `uploads/2023/09/DORIS-645-도면.pdf` |
| LYNN 313 · EDLYN 354 · KAI 553 · DORIS 645 | W 106 · 107 · 109 · 121 은 도면 **정면 폭(옆 손잡이 포함)** — 본체 지름 표기가 없다 | 각 `-도면.pdf` |
| CONI 6002 | 높이: 페이지 `390mm` · 상세 이미지 380 → `출처불일치`. D 240 은 표의 `가로`. 도면 `타공홀 ø36~ø38` · 페이지 `38Ø` → 38 | `/product_list/coni-6002/` |
| CONI 6004(3way) | D 250 은 표의 `가로` | `/product_list/coni-60043way/` |
| FOSS-M | 씽크볼 내장형 폭포수 (레코85/W · 깜뽀르테8535/W 전용). `높이(H) 220x28mm` 는 외경이 아니다. `타공 권장 38mm` 는 날개(핸들) 구멍으로 보인다 | `/product_list/foss-m/` |
| BF-B1000 · BF-B4000 · BROOKS 420 · SEIO 402 · INO 327 · INO-U 368 · FORD 290 · GALICE 277 · NILE 500 / NILE 500-S | 도면이 `(* 별도 문의)` — W · D 없음, 높이만 (BROOKS 는 색상 zip 만) | 각 상품 페이지 |
| FOSS-V · EDLYN 354 | 높이 페이지 360 · 354 / 이미지 · 도면 363 · 353 — 페이지 허용오차(±5) 안이라 태그 없이 비고만 | — |

## 건너뜀

| 무엇 | 이유 |
|---|---|
| 수전 26행 SQL 제외 | W(본체 폭)가 공식 자료에 없음 → `치수확인필요` (행 · 수전 구멍은 json 에 있다) |
| 기타기기 · 부속 | 수전이 아님 (분류 `faucet` 만 읽음) |

## 다른 수전 회사 조사 (2026-10-25)

| 회사 | 결과 |
|---|---|
| 대림바스 | 수집 — `daelim_faucet.md` |
| 콜러 (kohler.co.kr) | 수집 — `kohler_faucet.md` |
| 리젠스 (FONTANA) | 수집 — `lizens_faucet.md` |
| 아메리칸스탠다드 | `www.americanstandard.co.kr/robots.txt` 가 `User-agent: *` 에 `Disallow: /` → 쓰지 않음 |
| 그로헤 (grohe.co.kr) | 제품 목록이 브라우저 스크립트로만 채워진다 (HTML 에 제품 없음 · sitemap.xml 도 같은 화면 · 제품 주소 `/en-KR/product/<이름>-<번호>` 규칙을 알 수 없음) → 못 모음 |
| 한스그로헤 (hansgrohe.co.kr) | 어느 주소든 같은 251,274 B 껍데기 화면 (스크립트로만 내용) → 못 모음 |
| 계림 (계림바스 · 계림요업) | 공식 사이트를 못 찾음 — `gyerim.co.kr` 은 계림종합건설, `kyerim.co.kr` 은 계림재단, `keyrim.com` 은 403 (우회하지 않음) |
| 와토스 | `www.watos.com` 이 호스팅 503 안내 화면으로 넘어간다 |
| (덤) 로얄앤컴퍼니 · 이누스 | `royalnco.co.kr` 응답 없음 · `inus.co.kr` 은 무관한 사이트 |

## 실행

```bash
python -I collect.py --brands baekjo_faucet --sample 3 --out sample_baekjo_faucet
python -I collect.py --brands baekjo_faucet --out out_baekjo_faucet     # 요청 약 40 (캐시 뒤 0)
```
