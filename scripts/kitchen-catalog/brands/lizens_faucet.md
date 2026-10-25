# 리젠스 (`lizens_faucet`) — 주방 수전 FONTANA

2026-10-25 수집. 리젠스 홈 메뉴 `수전` (싱크볼은 `lizens.md`).

## 출처

| 무엇 | 어디 (공식) | 비고 |
|---|---|---|
| 목록 | `https://lizens.co.kr/kr/faucets/list.do?gc1=3&pn=1,2…` | robots.txt `Allow:/` (직접 읽음) |
| 이름 · 재질 · 기능 · 사진 | 제품 페이지 `/kr/faucets/display.do?seq=N` 규격표 HEAD · BODY · JOINT · Remark(`2Func. Head/ Pull-out`) | 치수 · 수전 구멍 없음 |
| 수전 구멍 · 높이 · 토수 | 제품 페이지 `제품도면 다운로드` = `/upload/drawing/<번호>_0.png` (`FONTANA 4612 X · UX · TX SPECIFICATION SHEET`) | 그림 → 눈으로 읽음 (`이미지판독`) |

- 도면 수전 구멍 `MIN ∮36 / MAX ∮40` → **36** + `치수범위`, 원문 `cutout_raw`.
- 도면에 앞모습 폭(본체 지름)이 없다 (79 는 몸통 중심 ~ 손잡이) → `K.put_dims(None)` → `치수확인필요` (SQL 제외). 높이 · 토수는 `size_raw`.
- 리젠스 2026 카탈로그(`/catalogfiledownload.do?seq=25`)에는 수전이 없다 (받아서 확인).

## 수집 수 (`out_lizens_faucet.json`)

| | 수 |
|---|---:|
| 행 / 모델 코드 | 4 / 4 |
| 수전 구멍 있는 행 | 3 (36 + 치수범위, 도면 그림 → `이미지판독`) |
| SQL 로 가는 행 | 0 (모두 W 없음) |

## 정확도가 떨어지는 행 — 사장님 확인용

| 모델 | 무엇이 불확실한가 | 주소 |
|---|---|---|
| TF-K4612U(BN) · TF-K4612(BN) · TF-K4612T | 도면 제목 `4612 UX · 4612 X · 4612 TX` 와 페이지 이름을 끝 글자로 맞췄다. 값(높이 400 · 288 · 347 / 토수 223 · 229 · 228 / 구멍 36~40)은 그림을 눈으로 읽음 | `display.do?seq=41` · `40` · `39` |
| TF-K4617(BN) | 제품도면이 없다 — 치수 · 수전 구멍 모름 (행만 남김) | `display.do?seq=452` |

## 실행

```bash
python -I collect.py --brands lizens_faucet --sample 3 --out sample_lizens_faucet
python -I collect.py --brands lizens_faucet --out out_lizens_faucet
```
