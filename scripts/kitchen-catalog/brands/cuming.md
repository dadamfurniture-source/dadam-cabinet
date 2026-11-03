# 현대큐밍 하부장 가전 (`cuming`) — 언더싱크 정수기 1행

2026-11-03 수집. 코드는 `cuming.py`. 브랜드 이름은 `현대큐밍` (회사 현대렌탈케어).

```bash
python -I collect.py --brands cuming --out out_cuming
```

## 출처

| 무엇 | 어디 (공식) | robots.txt | 비고 |
|---|---|---|---|
| 회사 사이트 | `www.hyundairentalcare.co.kr` | `Allow: /` | 제품 메뉴가 다이렉트몰로 이어진다 |
| 목록 | 다이렉트몰 `https://www.hdquming.com/product/list.html?cate_no=53` (정수기) `&page=2…` | `/admin` · `/api` · `/exec/front/` · `/member/` · `/myshop/` · 게시판 쪽 넘김 등만 막음 | 정수기 33칸 중 이름에 '언더싱크' · '빌트인' 1개 |
| 치수 · 구분 | `/product/detail.html?product_no=607` '제품사양' 표 | 허용 | `제품타입 언더싱크형 정수기 (무전원 직수형 정수기)` · `제품 크기 85x198x270mm(WxDxH)` · 기본 정보 `모델 HQPU10UW0E` |
| 사진 | 상세 `og:image` (`/web/product/big/202408/…png`) | | |

## 수집 수

| 종류 | 구분 | 행 | 모델 코드 | 검증 | 미검증 |
|---|---|---:|---:|---:|---:|
| water_purifier | purify (무전원 직수) | 1 | 1 (HQPU10UW0E 딜라이트 언더싱크 스노우 화이트) | 1 | 0 |

## 정확도가 떨어지는 행

없음 — 표 글자, 값 뒤에 (WxDxH) 표시.

## 못 모은 것

| 무엇 | 이유 |
|---|---|
| 현대큐밍 음식물처리기 (cate_no=104 '에코업 음식물처리기' 1개) | 이름 · 분류에 싱크대 설치 표시가 없다. 이번 범위(정수기)를 넘어 열지 않았다 |
| `www.cuming.co.kr` | 접속되지 않는다 (공식 주소가 아님) |
