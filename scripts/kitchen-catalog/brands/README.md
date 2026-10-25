# 브랜드 파일 규약 (`brands/*.py`)

브랜드 하나 = 파일 하나. `collect.py` 가 이 폴더의 `*.py` 를 모두 싣는다 (`_` 로 시작하는 파일은 뺀다).

```python
BRAND_KEY = "haatz"          # --brands 에 쓰는 이름 (소문자)
K = None                     # collect.py 모듈 — collect() 가 받는다

def collect(f, K_, sample=None):
    global K
    K = K_
    rows = []
    ...                       # f.get(url) / f.post_json / f.post_form — robots.txt 확인 · 1.2초 간격 · cache/ 저장
    row = K.base_row(brand="하츠", category="hood", category_subtype="chimney", install_type=None,
                     model_name=name, model_codes=[code], line="…", source_url=url, page_url=url,
                     image_source_url=img, product_type_raw="제조사 메뉴 · 형태 원문")
    d, _ = K.dims_of("(가로 × 깊이 × 높이)", "898 x 500 x 405~755", "wdh")   # 칸 이름으로 순서를 읽는다. 이름이 없으면 기본 순서
    K.put_dims(row, d, raw_text)          # 종류별 범위(K.BOUNDS) 밖이면 '치수확인필요' 가 붙고 SQL 에서 빠진다
    rows.append(row)
    return rows
```

## 행 칸 (`K.base_row`)

| 칸 | 값 |
|---|---|
| `brand` | 한글 브랜드 이름 그대로 (`하츠` · `SK매직` · `린나이` · `백조` · `보쉬` …) |
| `category` | `microwave` · `oven` · `dishwasher` · `cooktop` · `hood` · `rice_cooker` · `sink` |
| `category_subtype` | 아래 목록 안의 값만. 맞는 값이 없으면 `None` 으로 두고 `product_type_raw` 에 원문 |
| `install_type` | `freestanding` · `built_in` · `None` |
| `width_mm` · `height_mm` · `depth_mm` | `K.put_dims` 로만 넣는다 (외경). 싱크볼 H = 볼 깊이 |
| `niche_min/max_{w,h,d}_mm` | 빌트인 설치 공간 (제조사가 적은 값) · 원문은 `niche_raw` |
| `cutout_w_mm` · `cutout_d_mm` · `cutout_r_mm` | 상판 타공 (쿡탑 · 싱크볼) · 원문은 `cutout_raw` |
| `faucet_hole_mm` | 싱크볼 수전 구멍 지름 |
| `side_gap_mm` · `top_gap_mm` · `back_gap_mm` | 제조사가 적은 설치 여유 · 원문은 `install_notes` |
| `capacity_l` · `place_count` | 용량 L · 인용 (식기세척기 · 밥솥) |
| `model_codes` | 판매 모델 코드 (색상 변형 모두) |
| `tags` | 아래 검증 태그 |

세부 구분 (DB 검사 `database/appliance-models-kitchen.sql` 과 같은 목록):

| 종류 | subtype |
|---|---|
| microwave | `solo` 전자레인지 · `combi` 광파 · 오븐 겸용 |
| oven | `oven` · `steam_oven` · `combi` (빌트인 복합오븐) |
| dishwasher | `built_in` · `freestanding` · `countertop` |
| cooktop | `induction` · `highlight` · `hybrid` · `gas` |
| hood | `chimney` · `slim` · `built_in` · `island` |
| rice_cooker | `pressure_ih` · `ih` · `pressure` · `electric` |
| sink | (아직 없음 — `None`. 제조사 구분 원문은 `product_type_raw`) |

## 검증 태그 (`tags`) — 하나라도 붙으면 미검증

| 태그 | 언제 |
|---|---|
| `이미지판독` | 사양이 이미지에만 있어 사람이(에이전트가) 눈으로 읽어 옮겼다 |
| `요약문` | 사양표가 아닌 설명 · 요약 글에서 읽었다 |
| `고시불일치` | 판매 코드와 상품정보고시 코드가 다르다 |
| `치수순서추정` | W · D · H 순서 표시가 없어 순서를 추정했다 |
| `국내판매미확인` | 해외 사이트 값이라 국내 판매 모델인지 모른다 |
| `출처불일치` | 같은 회사의 웹 페이지 · 카탈로그(PDF) 값이 서로 다르다 — 어느 쪽인지 모른다 |
| `매뉴얼` | 제품 사용설명서 · 설치설명서 PDF 글자에서 읽었다 (검증으로 친다 — 태그는 출처 표시만) |
| `치수확인필요` | (put_dims 가 붙인다) 범위 밖 — SQL 에서 빠진다 |

## 지킬 것

- 제조사 · 공식 수입사 사이트만 쓴다. 다나와 · 쿠팡 · 네이버쇼핑 · 11번가 · 오픈마켓 · 블로그 값은 쓰지 않는다 (찾는 데 검색엔진을 쓰는 것은 된다 — 값은 공식 페이지에서).
- `f.get` 등 Fetcher 로만 받는다 — robots.txt 가 막은 경로는 쓰지 않는다. 로그인 · CAPTCHA · 403 우회 · 브라우저 흉내 헤더 없음.
- 공식 PDF(사용설명서 · 설치설명서 · 스펙시트)는 된다. 글자는 `pdftotext`, 그림은 PyMuPDF(`fitz`)로 쪽 이미지를 만들어 읽는다 (→ `이미지판독`).
- 실행은 늘 `python -I collect.py --brands <key> --sample 3 --out sample_<key>` · `--out out_<key>` — `kitchen.json` 을 덮지 않는다.
- 다른 브랜드 파일 · `collect.py` · `to_sql.py` 는 고치지 않는다. 필요한 도움 함수는 자기 파일 안에 둔다.
- 브랜드마다 `brands/<key>.md` 에 출처 표 · 수집 수 · **정확도가 떨어지는 행과 이유**를 적는다 (사장님이 직접 확인한다).
