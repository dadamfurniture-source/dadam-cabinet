# 피코그램 · 퓨리얼 하부장 가전 (`picogram`) — 언더싱크 정수기 3행 (모두 이미지판독)

2026-11-03 수집. 코드는 `picogram.py`. 브랜드 이름은 제품 브랜드 `퓨리얼` (제조 · 판매원 ㈜피코그램, `line` = 피코그램).

```bash
python -I collect.py --brands picogram --out out_picogram
```

## 출처

| 무엇 | 어디 (공식) | robots.txt | 비고 |
|---|---|---|---|
| 회사 사이트 | `www.picogram.co.kr/product/undersink/` (Eco · Puri · PnP · 맥스트림 · 퓨리얼 하이브리드 홈 시스템) | 없음 (404 쪽 → 허용) | OEM 필터 틀 — 필터 길이(8" · 10" · 11" · 13" · 15" · 17" · 20")만, 본체 치수 없음 → 행 없음 |
| 목록 | 퓨리얼 브랜드몰 `https://www.pureal.co.kr/shop/big_section.php?cno1=1041` (언더싱크 정수기) | `/a/` · `/_manage/` 만 막음 | 이름에 '언더싱크' 3개 |
| 모델명 | 상세 `/shop/detail.php?pno=…` 글자 `모델명 PPU-200` 등 | 허용 | |
| 치수 | 상세 그림 '제품 정보' 표 (`picopureal.wisacdn.com/_data/product/ppu200/PPU200_info_03-10.jpg` · `…/ppu500/ppu500_27.jpg` · `…/detailpage/pureal_hybrid_filter_1_pd.jpg`) | wisacdn robots.txt 없음 (404) | 그림을 사람이 읽었다 → `이미지판독` (미검증). `source_url` 이 그 그림 주소 |
| 사진 | 상세의 `#addimg` 상품 사진 | | |

## 수집 수

| 종류 | 구분 | 행 | 모델 코드 | 검증 | 미검증 |
|---|---|---:|---:|---:|---:|
| water_purifier | purify (직수 여과, 무전원) | 3 | 3 (PPU-200 · PPU-500 · PPC-200) | 0 | 3 (`이미지판독`) |

| 모델 | 그림 원문 | 넣은 W × H × D |
|---|---|---|
| PPU-200 퓨온싱크 (필터 3개) | `제품 크기 W97.5 X D226 X H252 (mm)` | 98 × 252 × 226 (97.5 반올림) |
| PPU-500 하이브리드 홈 (필터 1개) | `제품 크기 W95 X D97 X H500mm` | 95 × 500 × 97 |
| PPC-200 대용량 언더싱크 (업소용 겸 가정, 필터 1개) | `제품크기 W184 x D135 x H496 mm` | 184 × 496 × 135 |

## 정확도가 떨어지는 행 — 사장님 확인용

| 모델 | 무엇이 불확실한가 | 주소 |
|---|---|---|
| PPU-200 | 그림 표기는 W97.5 · D226 인데 상품 사진은 필터 3개가 옆으로 나란한 틀이라 226 이 가로로 보인다 — 표기대로 넣고 `install_notes` 에 '방향 확인 필요' | https://www.pureal.co.kr/shop/detail.php?pno=D2010416BAE665B450E2BE51B8C5A6CE |
| PPU-500 | 2026-11-03 목록에 'Sold out' (판매 중인지 모름) | https://www.pureal.co.kr/shop/detail.php?pno=EE63290C7E538126FCFB6D6D46C8054F |
| PPC-200 | 이름에 '업소용' — 설치장소는 '가정/업소용/사무실/옥내용' | https://www.pureal.co.kr/shop/detail.php?pno=632040F5D8F5203F3A314A77B9E416CB |
| 셋 모두 | 그림 글자를 사람이 읽었다 (`이미지판독`). 타공(조리수 밸브 구멍) 지름은 없다 — FAQ '싱크대 타공이 필요' 라고만 | |

## 못 모은 것

| 무엇 | 이유 |
|---|---|
| 피코그램 OEM 언더싱크 필터 시스템 (picogram.co.kr 7종) | 본체 치수가 없다 (필터 길이 inch 만) |
| 퓨리얼 음식물처리기 (브랜드몰 cno1=1006) | 이번 범위(정수기) 밖 — 열지 않았다 |
