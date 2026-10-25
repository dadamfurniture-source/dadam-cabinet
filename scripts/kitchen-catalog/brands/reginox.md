# 레지녹스 (`reginox`) — 싱크볼 (네덜란드 Reginox)

2026-10-25 수집. 국내 정식 수입사 **리젠스** 사이트 싱크볼 > Reginox (`https://lizens.co.kr/kr/sinks/list.do?gc2=13`). 리젠스 홈 GLOBAL BRAND "1796년부터 제조한 … Holland 'Reginox'".
읽는 방법 · 치수 순서 · 높이(= 볼 깊이)는 `lizens.md` 와 같다 (`lizens.py site_rows()`).

## 수집 수 (`out_reginox.json`)

| | 수 |
|---|---:|
| 제품 페이지 (색상마다 한 쪽) | 20 |
| 행 (색상 묶음) / 모델 코드 (이름 + 색상) | 5 / 20 |
| SQL 행 / 검증 / 미검증 / 건너뜀 | 3 / 3 / 0 / 2 |
| 컷아웃 (R 포함) | 3 (3) — 모두 UNDER |
| 수전 구멍 | 0 |
| 대표 사진 | 5 |

## 정확도가 떨어지는 행 · 건너뜀

| 모델 | 무엇이 | 주소 |
|---|---|---|
| OHIO 18×40 (S) (220 × 440 × 145) | 가로 220 이 싱크볼 하한 300 밖 → SQL 제외 (값은 페이지 그대로) | `https://lizens.co.kr/kr/sinks/display.do?seq=79` ~ `82` · `86` |
| OHIO 50×40 (S) Midnight SKY | 외부사이즈(S) 칸이 없다 → 치수 없음, SQL 제외. 다른 색상 페이지는 540 × 440 | `/kr/sinks/display.do?seq=74` |
| OHIO 80×42 (L)/(S) | 색상 페이지마다 배수구가 `89 / 162` 또는 `162` 로 다르다 (비고 첫 페이지 값만) | `/kr/sinks/display.do?seq=67` ~ `70` · `83` |
| 2026 카탈로그 이름 | 카탈로그는 `OHIO 8042 (S/S)` · `REGICOLOR 8042 ARCTIC WHITE` 처럼 적는다 — 웹 이름을 코드로 넣었다. 치수 · 컷아웃은 카탈로그와 같다 | 카탈로그 PDF 35~37쪽 |

## 제조사가 쓰는 종류 낱말

- `UNDER` (모든 컷아웃) · 색상 `Atomic Grey` · `Jet Black` · `Arctic White` · `Midnight SKY` · `(L)/(S)` 배수구 크기

## 실행

```bash
python -I collect.py --brands reginox --out out_reginox
```
