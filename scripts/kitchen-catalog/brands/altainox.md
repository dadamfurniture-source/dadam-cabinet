# 알타이녹스 (`altainox`) — 싱크볼 (이탈리아 Altainox)

2026-10-25 수집. 국내 정식 수입사 **리젠스** 사이트 싱크볼 > Altainox (`https://lizens.co.kr/kr/sinks/list.do?gc2=21`). 리젠스 홈 "리젠스 정식 수입볼 / Made in Itary".
읽는 방법 · 치수 순서 · 높이(= 볼 깊이)는 `lizens.md` 와 같다 (`lizens.py site_rows()`). 알타이녹스 국내 사이트(altainox.co.kr)는 리젠스 홈의 링크로만 보았고 쓰지 않았다.

## 수집 수 (`out_altainox.json`)

| | 수 |
|---|---:|
| 행 / 모델 코드 | 4 / 4 (CANOVA 540 · 740 · 840 · 940) |
| SQL 행 / 검증 / 미검증 / 건너뜀 | 4 / 4 / 0 / 0 |
| 컷아웃 (R 포함) | 4 (4) — 언더 · 인셋 표시 없음 (볼 + 6mm, R15) |
| 수전 구멍 | 0 |
| 대표 사진 | 4 |

## 정확도가 떨어지는 행

- 없음 — 2026 카탈로그(PDF 37쪽) CANOVA 4종 값과 같다. 컷아웃에 언더 · 인셋 표시가 없지만 카탈로그는 UNDER 로 적었다.

## 제조사가 쓰는 종류 낱말

- 웹 메뉴 `Altainox` · 카탈로그 `UNDER`

## 실행

```bash
python -I collect.py --brands altainox --out out_altainox
```
