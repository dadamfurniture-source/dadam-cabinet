# 대림바스 (`daelim_faucet`) — 주방 수전

2026-10-25 수집.

## 출처

| 무엇 | 어디 (공식) | 비고 |
|---|---|---|
| 목록 · 품번 · 종류 · 사진 | `POST https://www.daelimbath.com/product/getProductList` `{page, order_by:'', cate, bigcate}` — 수전금구 > 주방수전 (`bigcate 95 · cate 132`, 30개) · BLACK > 주방수전 (`186 · 194`, RADICE 7개) | 제품 목록 화면이 부르는 요청. robots.txt 없음 (404). FÜLEN > 수전(201)은 욕실 수전뿐이라 뺐다 |
| 제품 페이지 | `/product/product_view?idx=N` | `page_url` |
| 사진 | `/upload/product/<img_down>` | 제품 페이지 큰 사진과 같은 파일 |
| 수전 구멍 · 높이 · 토수 | 제품마다 `시공도면` PDF `/upload/product/<const_down>` (CAD 도면, 숫자가 PDF 글자 층에 있다) | `매뉴얼` |

- 수전 구멍: 도면 글자 `설치구멍 Ø38` · `시공홀 Ø35` · `설치구멍 Ø42~Ø43` · `MinØ38 MaxØ40`. 범위면 작은 값 + `치수범위`.
- 높이 · 토수구 높이 · 토수 길이 · 호스 길이 중 어느 숫자가 무엇인지는 그림을 보고 정했다 (32장 중 29장을 그림으로 확인, 나머지 3장 BFK-535 · DL-K3215 · DL-YK4A19SN 은 같은 틀의 BFK-435 · DL-K3015 · DL-K2119SN 과 숫자가 같음).
  판독표 `daelim_faucet.py DRAWINGS` 의 숫자는 32장 모두 PDF 글자 층에 있는지 대조했다 (어긋남 0).
- 앞모습 폭(W)은 6장에만 있다 → BFK-537 `Ø54` · DL-K2115SN `Ø53` · DL-K2119SN · DL-YK4A19SN `Ø52.5` · DL-K5619 `Ø52` · BFK-635 정면 몸통 폭 `51`.
  나머지는 `K.put_dims(None)` → `치수확인필요` (SQL 제외) — **수전 구멍은 행에 있다**. 높이 · 토수는 `size_raw`.
- RADICE 색상 3 · 2 · 2 종은 같은 도면이라 한 행 (코드는 모두 남김, 색상은 `install_notes`).
- 플러그인은 PDF 를 받지 않는다 (HTML · JSON 만). PDF 32장은 robots.txt 확인 뒤 1.5초 간격으로 한 장씩 받아 읽었다.

## 수집 수 (`out_daelim_faucet.json`)

| | 수 |
|---|---:|
| 제품 (주방수전 30 + RADICE 7) → 행 (RADICE 색상 묶음) | 37 → 33 |
| 모델 코드 | 38 |
| 수전 구멍 있는 행 | **29** (Ø38 23 · Ø38~40 1 · Ø42~43 2 · Ø35 3) |
| 수전 구멍 없는 행 | 4 — 벽붙이 3 (BFK-432 · DL-K1110 · DL-K1612, 상판 구멍 없음) · BFK-635 (도면에 표기 없음) |
| SQL 로 가는 행 / 검증 / 미검증 | 6 / 6 / 0 |
| 건너뜀 (W 없음 → `치수확인필요`) | 27 (1홀 24 + 벽붙이 3) |

## 정확도가 떨어지는 행 — 사장님 확인용

| 모델 | 무엇이 불확실한가 | 주소 |
|---|---|---|
| 1홀 24종 (BFK-435 · BFK-535 · DL-K1015 · K1119 · K1417 · K1615 · K3015 · K3215 · K3217 · K5115 · K5415 · K5515 · K6215 · K6217 · K6219 · K7215 · K8015 · K9015 · K9115 · K9315 · KV805A · RADICE A19 · A49 · K15) | 도면에 앞모습 폭이 없어 SQL 제외 (수전 구멍 · 높이 · 토수는 json 에 있음) | 각 시공도면 |
| DL-K1417 · DL-K6217 | 높이 209 · 199 는 헤드 끝까지 — 위로 솟은 손잡이 끝 높이는 도면에 없다 | `/upload/product/DL-K1417-CR1H_do.pdf` · `DL-K6217-CR1_do.pdf` |
| DL-K2119SN · DL-YK4A19SN | 토수 220 은 토수구 **끝** ~ 몸통 중심 (다른 도면은 토수구 중심) | `DL-K2119SNCR1_do.pdf` · `DL-YK4A19SNCR1_do.pdf` |
| BFK-635 | `1홀 주방 수전` 인데 도면에 수전 구멍 지름이 없다. W 51 은 정면 몸통 폭 (지름 아님) | `DL-BFK635_do.pdf` |
| BFK-435 · BFK-535 | 다른 시리즈인데 도면 숫자가 같다 (326.5 · 268 · 217 · Ø38) | `BFK-435_do.pdf` · `DL-BFK535_do.pdf` |
| DL-KV805A (벨벳) | 사이트가 DL-K8015 시공도면을 같이 건다 — 같은 몸체인지 모른다 | `idx=655` |
| DL-K9015 · DL-K9315 | 수전 구멍 `Ø42~Ø43` (다른 모델 38 보다 크다, 터치센서식) → 42 | 각 시공도면 |
| HFK K15 (RADICE) | 폭포수 헤드 수전 — 헤드 폭 283, `싱크볼까지 MAX 55` (싱크볼 날개 가까이 단다) | `HFK%20K15_do.pdf` |
| 벽붙이 3종 | 상판 수전 구멍 없음 — 배관 간격 150~200 / 150~210 은 `install_notes` | 각 시공도면 |

## 실행

```bash
python -I collect.py --brands daelim_faucet --sample 3 --out sample_daelim_faucet
python -I collect.py --brands daelim_faucet --out out_daelim_faucet     # 요청 3 (목록 POST, 캐시 뒤 0)
```
