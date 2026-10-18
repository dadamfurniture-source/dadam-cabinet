# design_spec — 플래너 도면 요약을 설치 프롬프트에 싣는 계약

> 워커: `workers/generate-api/src/prompts.js` (`normalizeDesignSpec` · `buildDesignSpecBlock` · `buildInstallPrompt`),
> 입구: `workers/generate-api/src/worker.js` `POST /api/generate`.
> 테스트: `workers/generate-api/test/design-spec.test.js` · `install-prompt-snapshot.test.js` · `generate-design-spec-route.test.js`.
> **이 문서가 필드 이름의 정본이다.** 플래너(보내는 쪽)는 여기를 따른다.

## 무엇이 달라지는가

지금까지 설치 프롬프트의 가구 설명은 **품목마다 고정된 한 문단**(`CATEGORIES[key].spec`)이었다.
사진은 제대로 읽으면서(벽 폭·높이·급수·배기·타일) 정작 **사용자가 그린 설계는 모른 채** 그렸다.

`design_spec` 은 그 구멍 하나를 메운다. 플래너가 도면 요약을 한 덩이 얹어 보내면
`FURNITURE:` 블록이 범용 문단 대신 **실제 모듈·치수·가전 위치**로 바뀌고,
`FINISH:` 줄이 `door_color` + `door_finish` 대신 **실제 자재명(예림 LUX)** 으로 바뀐다.

```
방 사진 ─→ 분석(벽 폭·높이·급수·배기·타일)  ┐
                                          ├─→ 설치 프롬프트 ─→ 이미지
플래너 도면 ─→ design_spec (이 문서)        ┘
```

**없으면 아무것도 달라지지 않는다.** `design_spec` 을 안 보내면 프롬프트는 예전과 한 글자도 다르지 않다
(`test/fixtures/install-prompt-baseline.json` 이 옛 출력 전문을 붙들고 있다).
독립형 `ai-design.html` 경로는 손대지 않았다.

## 크레딧

**그대로 20** (연출컷과 같다, 2026-09-17 결정). `consume_credit` 은 계속 `'generate'` 하나로 부른다.
새 `credit_costs` 행을 만들지 않는다 — `consume_credit` 은 모르는 action 을 조용히 `generate` 단가로
떨어뜨리므로(`database/credit-amounts.sql:61-62`) 행 없는 키를 넣으면 알아채지 못하는 함정이 된다.

## 요청

```
POST /api/generate
Authorization: Bearer <supabase jwt>
{
  "room_image": "<base64>",
  "category": "sink",
  "design_spec": { ... }          ← 선택. 없으면 null 로 저장되고 옛 경로 그대로
}
```

저장 위치는 `generations.options.design_spec` 이다 (JSONB, 새 컬럼 없음).
잡(`GenerateJob`)에도 같은 `options` 가 그대로 넘어가므로 프롬프트를 만드는 쪽이 같은 값을 본다.

## 필드

최상위. 모두 선택이지만 `wallRunMm` · `sections` · `appliances` · `finishes` 중 **적어도 하나**는 있어야 한다.

| 필드 | 형 | 규칙 |
|---|---|---|
| `category` | string | 생략 가능. 주면 요청의 `category` 와 **같아야 한다**. 다르거나 모르는 키면 `400 bad_design_spec` |
| `wallRunMm` | number | 가구가 차지하는 **전체 폭**. 300–12000 으로 자름 |
| `sections` | object | `lower` · `upper` · `tall` 세 칸. 그 밖의 키는 무시 |
| `appliances` | array | 최대 12개. 모르는 `kind` 는 조용히 버림 |
| `finishes` | object | `door` · `body` · `top` 세 칸. 그 밖의 키는 무시 |
| `notes` | string | 자유 서술. 300자로 자르고 줄바꿈은 공백으로 편다 |
| `layout` | object | 선택 (2026-10-19, **플래너 모드만 읽는다**). `{ shape: 'straight'\|'corner'\|'u', walls?: number }`. `shape` 가 셋 밖이면 통째로 버림, `walls` 는 1–4 로 자름 |
| `ceilingMm` | number | 선택 (2026-10-19, 플래너 모드만). 바닥에서 천장까지. 1500–4000 으로 자름 |

### `sections.{lower|upper|tall}`

| 필드 | 형 | 자르는 범위(mm) |
|---|---|---|
| `widthMm` | number | 100–12000 |
| `heightMm` | number | 100–3600 |
| `depthMm` | number | 50–1200 |
| `fromLeftMm` | number | 0–12000 — 이 구간의 **왼쪽 끝**이 런 왼쪽 끝에서 얼마인지 |
| `fromFloorMm` | number | 선택 (2026-10-19, 플래너 모드만). 0–3600 — 바닥에서 이 구간 **아랫면**까지 (상부장이면 보통 1400–1500) |
| `modules` | array | 왼→오 순서. 최대 40개, 넘으면 앞에서 40개만 |

### 배치·높이 — 플래너가 채우는 법 (2026-10-19)

위 표의 `layout` · `sections.*.fromFloorMm` · `ceilingMm` 를 플래너는 **아는 값만** 보낸다. 모르면 키 자체가 없다.
기존 필드·순서는 그대로이고 새 키는 뒤에 붙는다 (최상위는 `notes` 뒤에 `layout` · `ceilingMm`, 구간은 `modules` 뒤에 `fromFloorMm`).

| 필드 | 형 | 규칙 | 플래너가 채우는 법 (`js/planner/ai-photo.js`) |
|---|---|---|---|
| `layout.shape` | string | `straight` · `corner` · `u` | 장(마감재 빼고)의 회전 0·90·180·270 가짓수 — 하나 `straight`, 이웃한 둘(90° 차) `corner`(ㄱ자), 셋 `u`(ㄷ자). 마주 보는 둘(0·180)·넷·90° 배수가 아닌 회전은 모름 → 키 없음 (`plannerAiPhotoLayoutOf`) |
| `layout.walls` | number | 1 · 2 · 3 | 위 가짓수 (정면 벽 수) |
| `sections.*.fromFloorMm` | number | mm 정수 ≥ 0 | 그 줄 **아랫면**의 바닥 기준 높이 — 줄 안 모듈 중 가장 낮은 값. 3D 와 같은 `baseYOf` (상부장 = 천장 − 높이, 하부·키큰장 = 0, 모듈이 정한 값 우선) |
| `ceilingMm` | number | 1500–4000, 밖이면 키 없음 | 플래너 3D 의 천장 높이 (`dadam_origin_v1.ceiling`, 배치 단계 값. 저장값이 없으면 플래너 기본 2300 — 상부장도 그 높이에 매달려 있다) |

정면 입면(IMAGE B)의 번호·치수선: 2026-10-19 부터 플래너는 입면 위에 모듈 번호(`L1`·`U1`·`T1`·`W1`)와
치수선(칸 폭·줄 전체 mm, 줄 높이 mm)을 얇은 회색으로 얹어 보낸다. 번호는 이 문서의 `sections.*.modules[]` 를
워커 `plannerRows` 와 **같은 규칙**(구간 `lower`→`upper`→`tall`, 줄 안 왼→오 1부터, 붙박이장은 한 줄 `W`)으로 매긴 것이다.
라벨·치수선은 **주석**이다 — 그려야 할 가구의 일부가 아니다.

### `sections.*.modules[]`

| 필드 | 형 | 규칙 |
|---|---|---|
| `widthMm` | number | 50–4000 |
| `kind` | string | `door` · `drawer` · `open` · `appliance`. 모르는 값은 `door` 로 |
| `doorCount` | number | 0–12. `kind:'door'` 에서 생략하면 1로 본다 |
| `drawerCount` | number | 0–12 |
| `label` | string | 플래너의 한국어 이름(예: `서랍 3단`). 40자로 자름. 프롬프트에 `[…]` 로 붙는다 |

`kind` 별 영어 문장:

| kind | 프롬프트 문구 |
|---|---|
| `door`, `doorCount: 1` | `900 mm single-door cabinet` |
| `door`, `doorCount: 2` | `900 mm 2-door cabinet` |
| `drawer`, `drawerCount: 3` | `900 mm 3-drawer stack` |
| `drawer`, `drawerCount: 1` | `900 mm single drawer front` |
| `open` | `600 mm open shelving with no door` |
| `appliance` | `700 mm appliance opening` |

### `appliances[]`

| 필드 | 형 | 규칙 |
|---|---|---|
| `kind` | string | `sink` · `hood` · `cooktop` · `fridge` · `dishwasher`. `refrigerator`→`fridge`, `range`/`hob`→`cooktop` 로 받아 준다. 그 밖은 버림 |
| `fromLeftMm` | number | 0–12000 — 가전의 **왼쪽 끝**이 런 왼쪽 끝에서 얼마인지 (중심이 아니다) |
| `widthMm` | number | 50–4000 |

### `finishes.{door|body|top}`

예림 LUX 카탈로그(`database/seed/yerim-lux.json`)의 한 행을 그대로 옮기면 된다.

| 필드 | 형 | 카탈로그 대응 | 규칙 |
|---|---|---|---|
| `name` | string | `color_name` 을 포함한 한국어 전체 이름 | 60자로 자름 |
| `nameEn` | string | 모델이 읽을 **영어 묘사** (예: `matte white PET laminate`) | 60자로 자름 |
| `colorHex` | string | `color_hex` | `#rrggbb` 로 정규화(3자리도 받음). 형식이 아니면 버림 |
| `tone` | string | `tone` | `matte` · `gloss` · `satin` · `woodgrain` · `texture`. 그 밖은 버림 |
| `vendorCode` | string | `vendor_code` | 24자로 자름 |

`nameEn` 이 프롬프트의 주어다. 없으면 `name` 을 쓰고, 둘 다 없으면 그 칸은 통째로 무시한다
(=`door` 가 비면 옛 `door_color` + `door_finish` 로 돌아간다).
**영어 묘사를 꼭 채워 보낼 것** — Gemini 에게 `모시베이지` 는 색이 아니다.

## 검증 — 언제 400 이고 언제 조용히 고치나

| 입력 | 결과 |
|---|---|
| `design_spec` 없음 / `null` | `options.design_spec = null`, 프롬프트 옛 경로 그대로 |
| 객체가 아님 (문자열·배열·숫자) | `400 bad_design_spec` |
| `category` 불일치 | `400 bad_design_spec` |
| 숫자 자리에 `NaN` · `Infinity` · `"abc"` · `{}` | `400 bad_design_spec` (필드 이름이 메시지에 들어간다) |
| 숫자가 말이 안 되게 큼/작음 | **자른다** (`wallRunMm: 999999` → `12000`) |
| `null` · `""` | 그 필드는 "없음" |
| 배열이 너무 김 | 앞에서 잘라 쓴다 (모듈 40, 가전 12) |
| 모르는 `kind` | 모듈은 `door` 로, 가전은 버림 |
| 모르는 구간·마감 칸 | 무시 |
| JSON 이 20000자 초과 | `400 bad_design_spec` |
| 쓸 내용이 하나도 없음 (`{}`) | `400 bad_design_spec` |

400 은 **크레딧을 차감하기 전에** 난다 — 틀린 요약으로 20 크레딧이 날아가지 않는다.

에러 응답:

```json
{ "success": false, "code": "bad_design_spec", "error": "design_spec.category (wardrobe) does not match category (sink)" }
```

## 재생성 (`parent_id`)

`design_spec` 없이 `parent_id` 만 보내면 **원본의 요약을 그대로 이어받는다**.
원본과 품목이 달라져서 검증에 걸리면 400 이 아니라 **조용히 버리고** 범용 문단으로 돌아간다
(품목을 바꿔 다시 그리는 길을 막지 않는다).

## 예시

```json
{
  "category": "sink",
  "wallRunMm": 3600,
  "sections": {
    "lower": {
      "widthMm": 3600, "heightMm": 870, "depthMm": 600, "fromLeftMm": 0,
      "modules": [
        { "widthMm": 900, "kind": "drawer", "drawerCount": 3, "label": "서랍 3단" },
        { "widthMm": 700, "kind": "appliance", "label": "싱크볼" },
        { "widthMm": 600, "kind": "door", "doorCount": 1 },
        { "widthMm": 800, "kind": "drawer", "drawerCount": 2 },
        { "widthMm": 600, "kind": "open" }
      ]
    },
    "upper": {
      "widthMm": 2700, "heightMm": 900, "depthMm": 350, "fromLeftMm": 0,
      "modules": [{ "widthMm": 900, "kind": "door", "doorCount": 2 }]
    }
  },
  "appliances": [
    { "kind": "sink", "fromLeftMm": 900, "widthMm": 700 },
    { "kind": "cooktop", "fromLeftMm": 2200, "widthMm": 600 }
  ],
  "finishes": {
    "door": {
      "name": "예림 LUX Supreme PET Matt 매트 화이트",
      "nameEn": "matte white PET laminate",
      "colorHex": "#F2F0EC", "tone": "matte", "vendorCode": "SM-01"
    },
    "body": { "nameEn": "warm beige melamine board", "colorHex": "#e4dccd", "tone": "matte" },
    "top": { "nameEn": "light grey engineered stone" }
  },
  "notes": "좌측 900 서랍장은 세탁기 옆이라 폭 고정"
}
```

이 요약 + 벽 분석(3500 x 2400) + 브리프가 만드는 설치 프롬프트 전문:

```
Edit the first photo: install a built-in 싱크대 (sink) on the main wall.
Keep the room exactly as photographed: camera angle, walls, ceiling, floor, windows, lighting and everything outside the furniture.
If furniture already exists on that wall, remove it and replace it cleanly with no demolition marks.
ROOM: light oak floor, soft daylight from the left window
WALL: about 3500 x 2400 mm.
FURNITURE: this is the customer's own planner drawing, not a generic layout — build exactly this. The whole run is 3600 mm wide.
- Lower (base) run — 3600 mm wide, 870 mm high, 600 mm deep, starting 0 mm from the left end of the run. Left to right: 900 mm 3-drawer stack [서랍 3단]; 700 mm appliance opening [싱크볼]; 600 mm single-door cabinet; 800 mm 2-drawer stack; 600 mm open shelving with no door.
- Upper (wall) run — 2700 mm wide, 900 mm high, 350 mm deep, starting 0 mm from the left end of the run. Left to right: 900 mm 2-door cabinet.
APPLIANCES: an undermount sink with a single-lever mixer faucet (matte black or brushed steel) on the countertop behind it — the faucet is mandatory (left edge 900 mm from the left end of the run, 700 mm wide); a flush induction cooktop (left edge 2200 mm from the left end of the run, 600 mm wide).
The module order and the door/drawer counts above are binding; the millimetres are guidance. If they disagree with the wall measured in the photo, the photo wins — scale the run to fit the real wall and keep the order and the counts.
PLANNER NOTES: 좌측 900 서랍장은 세탁기 옆이라 폭 고정
FINISH: matte white PET laminate (예림 LUX Supreme PET Matt 매트 화이트, SM-01, colour #f2f0ec) flat-panel fronts, modern minimal style, consistent on every panel. Carcass and visible side panels: matte warm beige melamine board (colour #e4dccd). Countertop and worktop surfaces: light grey engineered stone.
HANDLES: none. Every door and drawer is a flat handleless front; lower doors open by reaching behind the door edge. No bar handles, knobs, chrome hardware or push-to-open buttons.
All doors and drawers closed. Photorealistic interior photograph with natural lighting and correct shadows. No text, labels or watermarks.
```

`REMOVE FIRST` · `SITE` · `WALL TILE` · 참고 이미지 · `FIX` 블록은 요약이 있든 없든 예전과 똑같이 붙는다.

## 모델이 지키는 것 / 못 지키는 것

**기대해도 되는 것**

- 구간이 **몇 개**로 나뉘고 **어느 순서**인지 (왼→오)
- 각 모듈이 **문이냐 서랍이냐 오픈이냐**, 서랍이면 **몇 단**인지
- 가전의 **좌우 순서**와 대략의 자리 (싱크가 왼쪽 1/4 쯤, 쿡탑이 가운데 오른쪽 쯤)
- 마감의 **색과 질감** — `nameEn` 을 채웠을 때

**기대하면 안 되는 것 (프롬프트로 고칠 수 없다)**

| 못 지키는 것 | 왜 |
|---|---|
| mm 정확도 | 이미지 모델은 치수를 재지 않는다. 900 mm 를 850 이나 960 으로 그린다. 그래서 프롬프트가 "치수는 참고, 순서와 개수가 구속" 이라고 못박는다 |
| 벽보다 넓은 런 | `wallRunMm` 이 사진의 벽보다 넓으면 **사진이 이긴다**. 런을 줄여 맞춘다 (사진이 방에 대한 진실이다) |
| 가전 위치 mm | 원근이 있는 사진에서 "왼쪽에서 2200 mm" 는 그릴 수도 검사할 수도 없다. 순서와 대략의 구역까지다 |
| 모듈 20개 넘는 촘촘한 분할 | 분할선이 뭉개진다. 15개쯤부터 신뢰도가 떨어진다 |
| `vendorCode` 를 자재로 인식 | `SM-01` 은 모델에게 아무 뜻이 없다. 프롬프트에 싣는 건 사람이 결과를 되짚기 위해서다. 실제 색은 `nameEn` + `colorHex` 가 만든다 |
| `label` (한국어) | 보조일 뿐이다. `kind` · `doorCount` · `drawerCount` 가 실제로 그림을 정한다 |

## QC

`design_spec` 이 있는 실행만 코드 하나를 더 받는다.

| 코드 | 검사 | 재시도 문장 |
|---|---|---|
| `layout_mismatch` | 전면의 **개수·좌→우 순서·문/서랍 구분**이 `LAYOUT` 줄과 다른가 | 순서와 개수를 맞춰 다시 그린다 (폭은 벽에 맞춰 조정 허용) |

검사 프롬프트에는 이때만 `LAYOUT the render must match, left to right — …` 한 줄이 붙는다.
요약이 없으면 그 줄도 코드도 없다 — 근거 없이 판정하게 두지 않는다.

**가전 위치 코드는 넣지 않았다.** 모델이 원근 사진에서 "싱크가 왼쪽에서 1050 mm 인가" 를 눈으로 셀 수 없다.
셀 수 있는 것은 전면의 개수와 순서뿐이라 `layout_mismatch` 하나로 충분하다.
(싱크와 관련해 눈에 보이는 검사는 기존 `faucet_missing` 이 이미 맡고 있다.)

코드 목록은 둘로 나뉜다:

- `QC_ISSUE_CODES` — 모든 실행이 받는 공통 코드 (예전 그대로)
- `ALL_QC_ISSUE_CODES` — 공통 + 요약 전용. `parseQc` 가 받아 주는 전체

## 플래너 모드 (`mode:'planner'`, 2026-10-08)

정본 계획: `docs/01-plan/planner-render-realize.plan.md` §4 · §6. 위의 설치 프롬프트와 **다른 빌더**
(`buildPlannerPrompt`)를 쓴다 — `mode` 가 없으면 위 내용이 한 글자도 바뀌지 않는다.

```
POST /api/generate
{
  "mode": "planner",
  "room_image": "<base64>", "image_type": "image/jpeg",
  "category": "sink",
  "design_spec": { ... },                                   ← 필수. 없으면 400 bad_design_spec (차감 전)
  "renders": [
    { "role": "elevation", "base64": "...", "mime": "image/png" },   ← 필수. 번호 없는 입면. 없으면 400 missing_render (차감 전)
    { "role": "elevation_labeled", "base64": "...", "mime": "image/png" }, ← 선택 (2026-10-19). 번호·치수선 붙은 입면 — GPT 에만 간다
    { "role": "massing",   "base64": "...", "mimeType": "image/jpeg" } ← 선택
  ],
  "aspect": "16:9",                                         ← 선택. 16:9 · 4:3 · 3:4 · 1:1 · 9:16, 그 밖은 16:9
  "image_provider": "gemini"                                ← 선택. 'gemini' | 'openai'. 없거나 모르는 값이면 재생성 원본 값 → PLANNER_IMAGE_PROVIDER (2026-10-19 기본 'openai')
}
```

| 항목 | 규칙 |
|---|---|
| 받지 않는 것 | `realize` · `engine` · `control_*` · `reference_images` (보내도 무시) |
| 렌더 | 역할마다 한 장, 최대 3장(`elevation` → `elevation_labeled` → `massing`), 다른 role 은 버림. 버킷 `{user}/{gen}/render-{role}.{ext}`, `inputs.renders[] = {role, path, url, mime}`. 번호 입면·3/4 는 업로드가 실패해도 잡은 간다 |
| options | `mode:'planner'`, `aspect`, `variants:false`(항상) |
| 재생성 | `parent_id` 만 보내면 원본의 모드·요약·렌더·비율을 잇는다. 원본에 입면이 없으면 400 |
| 설치 | `[방 사진, 입면, 3/4?]` + 프롬프트 v3(2026-10-19), 온도 0.2, `aspectRatio` = `options.aspect` |
| 이미지 공급자 (2026-10-18 · 2026-10-19 기본 GPT) | 요청 `image_provider`('gemini'\|'openai') → 재생성 원본의 `options.image_provider` → `PLANNER_IMAGE_PROVIDER`(wrangler.toml, `'openai'` 만 GPT · 없거나 다른 값이면 Gemini). 결정된 값은 `options.image_provider` 에 **늘** 기록된다(일반 경로 options 모양은 그대로). 잡은 이 값만 읽는다 — 기록 없는 옛 행은 Gemini. GPT 편집은 `/v1/images/edits`(`image[]` 첫 장 = 방 사진), 온도 없음. 크기는 비율에서: 16:9 → 2048x1152 · 4:3 → 2048x1536 · 1:1 → 1760x1760 · 3:4 → 1536x2048 · 9:16 → 1152x2048. 키가 없거나 GPT 가 실패하면 Gemini 가 대신 그린다. 누가 그렸는지: `images[base].provider·model`(GPT 면 `usage` 도), 대신 그렸으면 `fallback:true · fallback_reason`, 행의 `model`. 전역 `IMAGE_PROVIDER` 는 플래너 모드에 닿지 않는다. 지금 기본값은 `/health` 의 `planner_image_provider` |
| IMAGE B (2026-10-19) | GPT 로 그리면 `elevation_labeled` 가 있으면 그것, 없으면 `elevation`. **Gemini 로 그리면(기본이든 GPT 실패 대체든) 늘 `elevation`(번호 없음)** — Gemini 는 번호 라벨을 도어 위에 글자로 그려 넣었다. 프롬프트의 "IMAGE B may carry ID labels…" 문장은 번호 입면을 실제로 보낼 때만(`buildPlannerPrompt({labeledElevation:true})`). 대체 때는 번호 없는 입면 + 문장 없는 프롬프트로 다시 만든다 |
| 검사 | 공통 + `layout_mismatch` + **`existing_left`**(남는 벽에 기존 가구) · **`pasted_reference`**(렌더를 붙임). **재시도 없음** — `images[base].qc` 에 기록만 |
| 역판독 | 그대로 (`layout.verify`) |
| 결과 | `base` 한 장. 추천안·`mockup` 슬롯 없음 |

### 프롬프트 v3 (2026-10-19)

실측 8장(사진 4 × Gemini/GPT)의 실패 — 방에 원래 있던 모양(ㄱ자)을 따라감, 상부장 줄이 하부 폭에 맞춰 늘어남,
`gap_to_ceiling` 거짓 경보, 소품 삭제·카메라 재구성 — 을 사진·실수 이름이 아니라 **design_spec 에서 계산되는 일반 규칙**으로 막는다.
시험: `test/planner-prompt.test.js`.

| 문단 | 무엇을 계산하나 |
|---|---|
| IMAGE B | 번호 입면을 보낼 때만(GPT): 입면의 번호(L·U·T·W, 줄 안 왼쪽부터 1)·치수선은 주석 — 그리지 말 것. 번호 없는 입면이면 문장 없음 (2026-10-19) |
| `LAYOUT` | `layout` → 없으면 `notes` 의 `ㄱ자`·`ㄷ자` → 그래도 모르면 **문단 없음** (일자로 단정하지 않는다). ㄱ자·ㄷ자면 벽 대비 % 와 남는 벽 구역을 말하지 않는다 |
| `FIXED GEOMETRY` | 줄마다 번호·폭·종류, `→ widths L1 : L2 : L3 = 2 : 1 : 2.5` (가장 좁은 모듈 = 1, 0.5 단위). 둘째 줄부터는 기준 줄(하부, 없으면 가장 긴 줄)의 모듈 경계로 시작·끝: `U1–U2 start above the left end of L1 and end above L3, 400 mm before the right end of the base row` |
| 높이 | `fromFloorMm`·`ceilingMm` 중 하나라도 오면 줄마다 `bottom at X mm, top at Y mm from the floor` (`fromFloorMm` 없는 하부·키큰장·붙박이장은 0). 아무것도 없으면 예전처럼 `870 mm high` |
| `CLOSED LIST` | `L1–L3 and U1–U2 are the only built-in units` — 다른 장·서랍장·선반·판 없음 |
| `BINDING` | 순서·개수·줄 안 폭 비율(±10 %)·기준 줄 대비 위치는 구속, 벽에 맞추는 것은 **전체 배율만** (옛 "mm·% 는 참고" 를 바꿈) |
| `EMPTY ZONES` | 벽장 높이·바닥 높이에서 아무 줄도 덮지 않는 구간, 하부 윗면~상부 아랫면, 맨 위 줄~천장 틈(`open or closed exactly as IMAGE B shows` — 막음 여부 필드가 아직 없다), 남는 벽(결정 ①′) |
| `EDIT ZONE` / `KEEP` | 목표 벽의 붙박이만 철거·교체. 카메라·다른 벽·창·문·조명·움직이는 물건(냉장고·카트·조명·화분)은 그대로 |
| `FINAL SELF-CHECK` | 맨 끝. 줄마다 유닛·도어·서랍 수, 빈 구역 수, `no other built-in unit anywhere` |

검사: 플래너 모드이고 도면이 천장 틈을 두었으면(`ceilingMm` 과 맨 위 줄 윗면) `gap_to_ceiling` 줄 끝에
"그만한 틈은 의도된 것 — 그보다 분명히 클 때만" 을 붙인다. 그 밖의 검사 프롬프트는 바이트 그대로.

### 내부 확인용 (`options.internal_only`, 계획서 §6.3 · §11-⑦)

도면과 맞는다고 확인되지 않은 플래너 결과는 고객에게 나가지 않는다. 새 열 없이 `generations.options` 에 둔다.

| 항목 | 규칙 |
|---|---|
| 언제 붙나 | `mode:'planner'` 잡이 done 으로 끝날 때 `layout.verify.ok !== true` — 불일치(`false`) · 대조 실패(`null`, `verify.error`) · 대조를 못 돈 경우 모두. ok 면 **키 자체가 없다** |
| 어떻게 | done 패치와 **같은 PATCH** 로. 지금 행의 `options` 를 읽어 `internal_only: true` 만 더한다(덮어쓰지 않음). 기본안이 있어 `fail()` 이 done 으로 닫는 길도 같다 |
| 크레딧 | 환불하지 않는다 — 이미지는 나왔다 |
| 플래너가 아니면 | 아무것도 안 한다 — 마무리 패치가 바이트 그대로 |
| 공유 발급 `POST /api/generate/:id/share` | **409** `{ success:false, error:'internal_only', code:'internal_only', message:'도면과 다른 결과는 공유할 수 없습니다' }`. 토큰을 만들지 않고 행도 건드리지 않는다 |
| 공유 열람 `GET /api/share` | 이미 나간 링크라도 **410** `code:'internal_only'` ("공유할 수 없는 결과입니다") — 회수·만료와 같은 410 계열 (`checkShareAccessible`) |
| 내 연출컷 (`my-designs.html`) | 목록 쿼리에서 거른다: `.or('options->>internal_only.is.null,options->>internal_only.neq.true')`. `.not(…, 'eq', 'true')` 는 키 없는 행(NULL)까지 빼므로 쓰지 않는다 |
| 본인 조회 `GET /api/generate/:id` | 그대로 보인다 (`options.internal_only` 포함) — 디테일 패널이 "내부 확인용 — 고객 공유 불가" 를 그린다 (P5) |

## 바꿀 때

1. 필드 이름을 바꾸면 **이 문서와 플래너를 같이** 고친다 (플래너가 이 문서를 따라 보낸다).
2. `test/fixtures/install-prompt-baseline.json` 은 **옛 경로가 안 변했다는 증거**다.
   일부러 옛 프롬프트를 고칠 때만 다시 뜬다 — 테스트가 빨개졌다고 fixture 를 덮어쓰면 증거가 사라진다.
3. 워커 테스트: `cd workers/generate-api && npm test`
