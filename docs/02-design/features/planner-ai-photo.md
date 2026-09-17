# 플래너 「사진으로 만들기」 — 도면 그대로 방 사진에 합성 (R2)

> 만드는 쪽: `js/planner/ai-photo.js` · 붙는 곳: `mockup-structure.html` 디테일 모드 우측
> (`data-sec="aiphoto"`) · 계약 정본: **`docs/02-design/features/design-spec-prompt.md`**
> 시험: `__tests__/ai-photo.test.js` · `__tests__/planner-ai-photo-ui.test.js`
> 계획: `docs/01-plan/photo-composite.plan.md` §5 R2

## 한 문단

디테일 모드 우측에 섹션이 하나 선다. **방 사진을 올리고 버튼을 한 번 누르면 끝이다.**
플래너는 지금 그려 둔 도면을 구조화 JSON(`design_spec`)으로 요약해 방 사진과 함께
`POST /api/generate` 로 보내고, 3초마다 상태를 읽어 잡이 주는 한국어 단계 라벨을 그대로
보여 준다. 끝나면 결과 썸네일과 「다시 만들기」 버튼이 선다.

**사람이 맞추는 단계는 없다.** 사각형 끌기·화각 고르기·그림자/빛/톤 조절은 #682 에서
일부러 지웠고 어떤 형태로도 되살리지 않는다 (계획 §1 · §4.3 · §6).

## 화면

| 요소 | 내용 |
|---|---|
| 비용 줄 | **`20 크레딧 / 1장`** + 오른쪽에 도면 한 줄 요약(`싱크대 · 3600mm · 모듈 8 · 가전 2`). **버튼을 누르기 전에** 보인다 |
| 사진 올리기 | 끌어놓기 또는 눌러서 고르기. JPG·PNG·20MB 이하, 긴 변 1600px 로 줄여 JPEG 재인코딩 |
| 버튼 | 「사진으로 만들기」 — 사진이 없거나 도면이 비면 잠긴다. 끝난 뒤에는 「다시 만들기」 |
| 진행 | 막대 + `기본안을 그리는 중 · 30%` (서버의 `step_label` 이 먼저, 없으면 옮겨 적은 표) |
| 결과 | 썸네일 격자 (`generations` 버킷은 공개라 `images[].url` 을 그대로 쓴다). 누르면 새 탭에서 크게 |

크레딧은 `credit_costs` 의 `generate` 행이 정본(20)이고, 화면의 숫자는 **누르기 전에 보여
주기 위한 표시용 사본**이다 (`PLANNER_AI_PHOTO_CREDIT`). 차감은 서버가 한다.

## 도면 요약 매핑

`plannerAiPhotoBuildSpec(input)` 하나가 만든다 — **순수 함수**다. `buildPlannerPayload` 는
건드리지 않는다 (골든 바이트 불변, 계획 §4.2). 계약의 필드 이름은 워커 문서가 정본이고,
`__tests__/ai-photo.test.js` 가 그 문서의 표를 읽어 우리가 보내는 키와 대조한다.

| 계약 필드 | 플래너의 출처 | 규칙 |
|---|---|---|
| `category` | `modules[].section` | 붙박이장 있으면 `wardrobe`, 냉장고장 있으면 `fridge`, 하부/상부/분배기/후드 있으면 `sink`, 키큰장만이면 `storage`. 플래너 URL 에는 품목 종류가 없다 (스코프는 `design`·`item` 번호뿐) |
| `wallRunMm` | 모든 모듈의 좌우 끝 (마감재 포함) | 구간 폭 합이 그보다 크면 그쪽을 쓴다 (ㄱ자 참고) |
| `sections.lower` | `lower` · `dishwasher` | |
| `sections.upper` | `upper` | |
| `sections.tall` | `tall` · `fridge` · `wardrobe` · `refrigerator` | 셋뿐이다 — 그 밖의 키는 계약이 무시한다 |
| `sections.*.widthMm` | 그 구간 모듈의 x 범위 ↔ 모듈 폭 합 중 **큰 쪽** | |
| `sections.*.heightMm` / `depthMm` | 그 구간 모듈의 `H` / `D` 최댓값 | `H` 는 전체 높이(다리발·좌대 + 몸통 + 상판·상몰딩)다 |
| `sections.*.fromLeftMm` | 그 구간의 **왼쪽 끝** − 런의 왼쪽 끝 | 계약이 정한 대로 **왼쪽 끝**이다. 중심이 아니다 |
| `sections.*.modules[]` | 모듈의 칸(`verticalCount`·`areaTypes`·`areaWidths`) | 좌→우. 최대 40 |
| `modules[].widthMm` | `areaWidths[i]`, 없으면 `W / verticalCount` | |
| `modules[].kind` | `areaTypes[i]` → `drawer` / `open` / 그 밖 `door` (먹장·멍장 포함) | 가전 본체(`refrigerator`·`dishwasher`)는 `appliance` |
| `modules[].doorCount` | 양문(`areaIs2D[i]`)이면 2, 아니면 1 | |
| `modules[].drawerCount` | 하부 서랍줄 `drawerCount` + 붙박이장 **바깥** 서랍 단수 | 통 안 서랍(문 뒤)은 세지 않는다 |
| `modules[].label` | `서랍 3단` · `양문` · `오픈` · `먹장` · `도어 2 + 서랍 3단` | 40자. 프롬프트에 `[…]` 로 붙는 보조 정보다 |
| `appliances[]` | 분배기 → `sink` · 후드 → `hood` · 냉장고 → `fridge` · 식기세척기 → `dishwasher` | `fromLeftMm` 은 가전의 **왼쪽 끝**. 최대 12 |
| `finishes.door` / `body` / `top` | `plannerFinishResolve(detail, slot, 모듈, 섹션)` → 모듈마다 해석해 **가장 많이 나온 코드** | 해석 순서는 부재 > 모듈 > 섹션 > 품목 |
| `finishes.*.name` / `colorHex` / `tone` / `vendorCode` | `PlannerCatalog.byCode[code]` (예림 LUX 144 + 상판) | `tone` 은 `matte`·`gloss`, 나뭇결이면 `woodgrain`. 카탈로그의 `single` 은 계약에 없어 싣지 않는다 |
| `finishes.*.nameEn` | **언제나 채운다** — 아래 참고 | |
| `notes` | 양 끝 마감재(EP·몰딩·휠라·비움) · ㄱ자 평탄화 | 300자 |

### `nameEn` 을 언제나 채우는 이유

> "`nameEn` 이 프롬프트의 주어다. 없으면 `name` 을 쓰고, 둘 다 없으면 그 칸은 통째로 무시한다
> … **영어 묘사를 꼭 채워 보낼 것** — Gemini 에게 `모시베이지` 는 색이 아니다."
> — `design-spec-prompt.md`

카탈로그에는 영어 이름 열이 없다. 그래서 세 단계로 짜낸다:

1. **자재** — `finish` 열(`Supreme PET Matt` → `PET laminate`, `Body MFC` → `melamine board` …).
   없으면 코드 앞조각(`PET-` · `MFB-` · `VNR-` …).
2. **색** — 한국어 색 이름을 **긴 것부터** 대조 (`라이트그레이` 가 `그레이` 보다 먼저).
   꾸밈말(`매트`·`라이트`·`웜`·`펄` …)도 앞에 붙는다. 못 찾으면 코드 가운데 조각(`OAK` → oak),
   그것도 없으면 **hex 를 HSL 로 풀어** 이름을 짓는다(`#3a3d42` → `dark grey`).
3. **광택** — `matte` / `high-gloss`.

셋 다 실패해도 `neutral laminate panel` 로 떨어진다 — 빈 값으로 보내면 그 칸이 통째로
버려져 옛 `door_color` 로 돌아가기 때문이다. `vendorCode`(`YPM-12`)는 사람이 결과를 되짚기
위한 것이고 **모델에게는 아무 뜻이 없다** (워커 문서의 "못 지키는 것" 표).

### 계약이 원하지만 플래너에서 낼 수 없는 것

| 계약 | 왜 못 내는가 |
|---|---|
| `appliances[].kind: 'cooktop'` | 플래너에 쿡탑 섹션이 없다. 가전 자리 표시는 분배기·후드 둘뿐이다 (`PLANNER_MARKER_SECTIONS`). 지어내지 않는다 |
| 세로 구성 | 계약의 `modules[]` 는 **좌→우 한 줄**이라 "위 도어 + 아래 서랍" 을 놓을 자리가 없다. 그런 모듈은 칸으로 쪼개지 않고 한 덩이로 보낸다 — `kind:'drawer'` · `doorCount`=위 도어 수 · `drawerCount`=서랍 단수 · `label`=`도어 2 + 서랍 3단`. 쪼개면 "칸마다 서랍 3단" 으로 읽힌다 |
| 서랍 앞판 마감 | `finishes` 는 `door`·`body`·`top` 세 칸뿐이다. 플래너의 `drawerFront`·`handle`·`finishing`·`kick` 슬롯은 실을 자리가 없다 |
| ㄱ자 정확도 | 90° 로 꺾인 구간은 x 축에 눌러 편다 — AI 가 받는 벽은 하나다. 자리(`fromLeftMm`)는 눌린 값, 모듈 폭은 그 장의 실제 폭이라 둘이 어긋날 수 있어 `notes` 에 그 사실을 적는다 |
| 설계 ↔ 생성 연결 | `generations` 에 `design_id`·`item_unique_id` 칸이 없다. 요약은 `options.design_spec` 에만 남는다 (별건 — `detail-bom-deepening.plan.md:220`) |

### 읽는 것만으로 무엇도 바꾸지 않는다

요약은 `getStructure(id)` 를 **부르지 않는다**. 그 함수는 구조가 없으면 만들어 저장하므로,
요약을 그리는 것만으로 `structures` 가 채워져 `buildPlannerPayload` 의 `hasStructures` 가
뒤집힌다. 페이지는 `structures[id] || null` 을 넘기고, 구조가 없는 모듈은 기본형(도어 한 짝)
으로 본다. `planner-ai-photo-ui.test.js` 가 payload 바이트로 지킨다.

## 오류 문구

| 상황 | 화면에 뜨는 말 |
|---|---|
| 402 `insufficient_credit` | 크레딧이 부족합니다 (1회 20 크레딧) — 구독을 올리면 더 만들 수 있습니다 |
| 409 (동시 실행 1건) | 이미 생성 중인 작업이 있습니다 — 끝난 뒤 다시 눌러 주세요 |
| 400 `bad_design_spec` | 도면 요약을 서버가 받지 못했습니다 — **크레딧은 차감되지 않았습니다** (+ 서버 메시지) |
| 401 | 로그인이 풀렸습니다 — 다시 로그인한 뒤 눌러 주세요 |
| `design=local` (설계 미저장) | 설계를 먼저 저장하면 사진으로 만들 수 있습니다 — **요청을 보내지 않는다** |
| 품목 없음(bootstrap) | 품목을 먼저 추가하세요 |
| 로그인 전 | 로그인하면 사진으로 만들 수 있습니다 — 요청을 보내지 않는다 |
| 404 / 5xx / 네트워크 | 생성 결과를 찾을 수 없습니다 / 생성 서버가 응답하지 않습니다 / 생성 서버에 닿지 못했습니다 |
| 잡 `failed` | 서버가 준 `error` 를 그대로 (크레딧은 워커가 환불한다, `job.js:118-142`) |

400 은 **크레딧을 차감하기 전에** 난다 (워커 문서 "검증"). 그래서 문구가 그 사실을 말한다.

## 끊기지 않게 하기

마지막 잡 id 를 **스코프별** `localStorage`(`dadam_aiphoto_job_v1::{design}:{item}`)에 남긴다.
디테일 모드에 들어올 때 `PlannerAiPhoto.onDetailEnter()` 가 그 id 로 상태를 한 번 읽고,
아직 도는 중이면 폴링을 잇는다. 끝난 잡이면 결과만 다시 그린다. 없어진 잡(404)이면 기억을 지운다.
새로고침·다른 단계를 다녀오는 것으로 20 크레딧짜리 잡을 잃지 않는다.

## AI 가 지키는 것 / 못 지키는 것

워커 문서가 정한 그대로다 (`design-spec-prompt.md` "모델이 지키는 것 / 못 지키는 것").

**기대해도 되는 것**

- 구간이 몇 개로 나뉘고 어느 순서인지 (왼→오)
- 각 모듈이 문이냐 서랍이냐 오픈이냐, 서랍이면 몇 단인지
- 가전의 좌우 순서와 대략의 자리
- 마감의 색과 질감 (`nameEn` 을 채웠을 때 — 우리는 언제나 채운다)

**기대하면 안 되는 것**

- **mm 정확도.** "이미지 모델은 치수를 재지 않는다" — 900mm 를 850 이나 960 으로 그린다.
  프롬프트가 "치수는 참고, 순서와 개수가 구속" 이라고 못박는다
- **벽보다 넓은 런** — 사진이 이긴다. 런을 줄여 벽에 맞춘다
- **가전 위치 mm** — 원근 사진에서 "왼쪽에서 2200mm" 는 그릴 수도 검사할 수도 없다
- **모듈 20개 넘는 촘촘한 분할** — 15개쯤부터 분할선이 뭉개진다
- **`vendorCode` 를 자재로 인식** — `SM-01` 은 모델에게 아무 뜻이 없다

그래서 결과 아래에 **"치수는 참고이고 구성(순서·개수)이 구속입니다 — 실제 제작 도면과
다를 수 있습니다"** 를 붙인다 (계획 §7-1 의 ⓐ 자리매김).

## 안 하는 것

- 카메라 역산·호모그래피·3D 렌더 합성 (#673·#676·#679 에서 제거)
- 사진 위 편집기·사각형·화각 슬라이더·그림자 받개·빛/톤 맞추기
- `buildPlannerPayload` 골든 변경 · 프롬프트 문장을 브라우저에서 조립하는 일
- 단계 이름·크레딧·버킷·공유 방식 변경
