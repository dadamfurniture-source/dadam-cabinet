# SK매직 하부장 가전 (`skmagic_lower`) — 언더싱크 정수기 1행

2026-11-03 수집. 코드는 `skmagic_lower.py` (주방가전 `skmagic.py` 는 그대로).

```bash
python -I collect.py --brands skmagic_lower --out out_skmagic_lower
```

## 출처

| 무엇 | 어디 (공식) | robots.txt | 비고 |
|---|---|---|---|
| 목록 | 정수기 메뉴(`dispClsfNo=100000005`)가 부르는 `POST https://www.skmagic.com/goods/indexSubGoodsList` (`rows=100`) | `User-agent: *` `Disallow:` (모두 허용) | 73칸 중 이름에 '언더싱크' · '빌트인' 이 든 것만 연다 → 1개 |
| 치수 · 구분 | 상품 페이지 `/goods/indexGoodsDetail?goodsId=G000020814` '기본사양' 표 | 허용 | `크기(mm) 265(W) X 105(D) X 355(H)` · 주요스펙 냉수 X · 온수 X · 직수 O · 정격전압 무전력 |
| 사진 | 상품 페이지 `og:image` (`static.skmagic.com/image/goods/…`) | | |

## 수집 수

| 종류 | 구분 | 행 | 모델 코드 | 검증 | 미검증 |
|---|---|---:|---:|---:|---:|
| water_purifier | purify (정수만, 무전원 직수) | 1 | 1 (WPU9100CREWH) | 1 | 0 |

- 타공(파우셋 구멍) · 설치 여유 · 설치 공간: 상품 페이지에 없다 (빈 칸). 소개 글의 '싱크대 아래 10cm 공간' 같은 문구는 상품 페이지 글자에 없어 넣지 않았다.

## 정확도가 떨어지는 행

없음 — 표 글자 그대로이고 (W) · (D) · (H) 표시가 붙어 있다. 출시 2017-03 모델이라 오래됐다.

## 못 모은 것

| 무엇 | 이유 |
|---|---|
| SK매직 언더싱크 음식물처리기 | skmagic.com 판매 메뉴에 음식물처리기가 없다 (정수기 · 공기청정기 · 비데 · 매트리스뿐) |
| 사용설명서 (설치 · 타공) | 상품 페이지 '사용설명서 다운로드' 는 다른 사이트(skintellixservice.com, robots.txt 없음)의 검색 화면으로 가고, 파일은 스크립트(`.download(...)`)로만 받는다 — 받지 않았다 |
