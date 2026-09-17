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

### `sections.{lower|upper|tall}`

| 필드 | 형 | 자르는 범위(mm) |
|---|---|---|
| `widthMm` | number | 100–12000 |
| `heightMm` | number | 100–3600 |
| `depthMm` | number | 50–1200 |
| `fromLeftMm` | number | 0–12000 — 이 구간의 **왼쪽 끝**이 런 왼쪽 끝에서 얼마인지 |
| `modules` | array | 왼→오 순서. 최대 40개, 넘으면 앞에서 40개만 |

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

## 바꿀 때

1. 필드 이름을 바꾸면 **이 문서와 플래너를 같이** 고친다 (플래너가 이 문서를 따라 보낸다).
2. `test/fixtures/install-prompt-baseline.json` 은 **옛 경로가 안 변했다는 증거**다.
   일부러 옛 프롬프트를 고칠 때만 다시 뜬다 — 테스트가 빨개졌다고 fixture 를 덮어쓰면 증거가 사라진다.
3. 워커 테스트: `cd workers/generate-api && npm test`
