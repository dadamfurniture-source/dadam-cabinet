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
쌓인 단(`tiers`, 2026-10-19)은 통 하나에 번호 하나 — 라벨은 그 통의 단들을 합친 상자 가운데에 선다.
라벨·치수선은 **주석**이다 — 그려야 할 가구의 일부가 아니다.

### `sections.*.modules[]`

| 필드 | 형 | 규칙 |
|---|---|---|
| `widthMm` | number | 50–4000 |
| `kind` | string | `door` · `drawer` · `open` · `appliance`. 모르는 값은 `door` 로 |
| `doorCount` | number | 0–12. `kind:'door'` 에서 생략하면 1로 본다 |
| `drawerCount` | number | 0–12 |
| `label` | string | 플래너의 한국어 이름(예: `서랍 3단`). 40자로 자름. 프롬프트에 `[…]` 로 붙는다 |
| `tiers` | array | 선택 (2026-10-19). 이 모듈(한 통)에 **세로로 쌓인 단**, 아래부터. 최대 8개. 아래 "쌓인 단" |

### `sections.*.modules[].tiers` — 쌓인 단 (2026-10-19)

`modules[]` 는 왼→오 한 줄이라 세로 축이 없다. 키큰장은 통마다 하부·중간·상부 단을 쌓고(#738),
냉장고장은 냉장고 자리를 비우고 그 위에 박스만 단다. 이것을 모듈 여럿으로 보내면 **가로로 나란한 유닛**으로 읽힌다
(실측 2026-10-19: 키큰장 한 통이 "T1 600, T2 600, T3 600 left to right" 가 되었다). 그래서 **한 통 = 모듈 하나**,
단은 그 안의 `tiers` 로 보낸다.

| 필드 | 형 | 규칙 |
|---|---|---|
| `kind` | string | `door` · `drawer` · `open` · `appliance`. 모르는 값은 `door` |
| `heightMm` | number | 50–3600 으로 자름. 맨 아래 단이 `appliance` 면 **바닥에서 위 박스 아랫면까지** (냉장고 + 위 간격) |
| `doorCount` | number | 0–12. `kind:'door'` 에서 생략하면 1 |
| `drawerCount` | number | 0–12 |
| `label` | string | 40자. 가전 자리는 `냉장고`(또는 `식기세척기`) — 워커가 이것으로 가전 종류를 안다 |

모듈(통) 쪽 규칙:

- `widthMm` = 통 폭, `doorCount` · `drawerCount` = **단의 합** (옛 워커·요약이 그대로 읽어도 숫자가 맞게).
- `kind` — 맨 아래 단이 가전 자리면 `appliance`(냉장고장), 아니면 옛 규칙대로 서랍이 있으면 `drawer`, 도어가 있으면 `door`.
- `label` — 키큰장 `키큰장 3단`, 냉장고장 `냉장고장` (`냉장` 이 들어 있어 옛 워커도 냉장고 자리로 읽는다).
- 냉장고장의 냉장고 자리는 `appliances[]` 에도 `fridge` 로 오른다 (통의 왼쪽 끝·폭). 플래너에 냉장고 본체가 놓여 있으면 그 본체가 그 자리다 — 두 번 넣지 않는다.
- `tiers` 가 없으면 예전과 같다 (프롬프트·검사·역판독 바이트 그대로).

```json
"tall": {
  "widthMm": 1300, "heightMm": 2300, "depthMm": 700, "fromLeftMm": 1800,
  "modules": [
    { "widthMm": 600, "kind": "door", "doorCount": 3, "drawerCount": 0, "label": "키큰장 3단",
      "tiers": [
        { "heightMm": 861, "kind": "door", "doorCount": 1, "drawerCount": 0, "label": "하부장" },
        { "heightMm": 979, "kind": "door", "doorCount": 1, "drawerCount": 0, "label": "중간장" },
        { "heightMm": 460, "kind": "door", "doorCount": 1, "drawerCount": 0, "label": "상부장" }
      ] },
    { "widthMm": 680, "kind": "appliance", "doorCount": 2, "drawerCount": 0, "label": "냉장고장",
      "tiers": [
        { "heightMm": 1885, "kind": "appliance", "doorCount": 0, "drawerCount": 0, "label": "냉장고" },
        { "heightMm": 415, "kind": "door", "doorCount": 2, "drawerCount": 0, "label": "상부장" }
      ] }
  ]
}
```

플래너 모드 프롬프트(`buildPlannerPrompt`)가 말하는 것 — 통 하나에 번호 하나:

```
    T1   600 mm  tall column — 3 stacked doors (bottom 861 mm, middle 979 mm, top 460 mm)
    T2   680 mm  refrigerator opening (open from the floor up to 1885 mm, with no cabinet, shelf or panel inside; a refrigerator stands in it: if IMAGE A shows a refrigerator in this spot, keep that one, otherwise draw a neutral free-standing two-door refrigerator, plain matte white or, if the fronts are dark, brushed stainless, with no logo or display, sized to fill the opening) with a 2-door cabinet above (415 mm high)
FINAL SELF-CHECK …; tall row 1 unit + 1 appliance opening, 5 doors, 0 drawers; …
```

- 냉장고 자리 (2026-10-20 사장님 결정 — "냉장고가 특정되면 해당 냉장고 사진을 넣어서 보여주고, 아니라면 가능한 중립 냉장고로 보여줘"):
  장·선반·판은 없고 **냉장고를 그린다**. 사진(IMAGE A)의 그 자리에 냉장고가 보이면 그것을 유지, 없으면 그 자리에 걸린
  `appliances[]` fridge 의 `model`(아래 "냉장고 모델")로 `this refrigerator: Samsung BESPOKE 409L, model RR40C7805AP, 595 × 1853 × 700 mm (W × H × D), single-door type`,
  모델이 없으면 위의 중립 냉장고. 중립 냉장고 색은 워커가 정하지 않고 "흰색, 전면이 어두우면 스테인리스" 로 모델에게 맡긴다 (새 문턱값 없음).
  옛 문장(`may stand there — keep the one IMAGE A shows, do not invent a built-in one`)은 허용일 뿐이라 사진에 냉장고가 없을 때 무엇을 그릴지 정하지 않았다
  (실측 GPT 2장: 둘 다 독립형 냉장고를 그렸고 검사가 둘 다 `appliances_visible` 로 잡았다). 1단계는 사진 없이 글로만 — 모델 사진은 `appliance_models` 에 사진이 생긴 뒤.
  도면에 냉장고 자리가 있으면 DO NOT 의 "없는 가전" 에서 `refrigerator` 를 뺀다 (모듈·단 라벨로 안다).
- 자체 점검: 가전 자리가 있는 통은 `appliance opening`, 없는 통은 `unit` 하나. 도어·서랍은 단의 합.
- 검사 LAYOUT 요약·설치 프롬프트: `600 mm column of 3 stacked doors` · `680 mm refrigerator opening with a 2-door cabinet above`.
- 역판독 기대값(`verify.js expectedFromSpec`): 통 하나 = 바닥 세그먼트 하나. 키큰장은 `tall` + 단의 도어·서랍 합.
  냉장고장은 `refrigerator`(예전 가전 칸과 같은 이름 — 플래너 판독이 그렇게 읽는다). 위 박스 도어는 가전 칸처럼 세지 않는다.
- 플래너 판독(`layout.js plannerReadPlan` · `buildPlannerReadPrompt`): 통 하나에 번호 하나. 키큰장은
  `3 doors (one column of 3 stacked sections)`, 냉장고장은 냉장고 자리(냉장고가 있든 비어 있든 refrigerator 로 보고)
  + "위 2도어 장은 이 번호의 것 — 덤 유닛이 아니다". 기대 도어는 키큰장 단의 합, 냉장고장 0 (가전 칸 규칙).

### 후드 칸 — 상부장 사이의 노출 후드 (2026-10-19)

`modules[]` 는 줄 안에서 왼→오로 **빈틈 없이** 이어 놓인다(워커가 `fromLeftMm` 부터 폭을 더해 자리를 매긴다).
그래서 상부 `U1 800(x0) | 후드 600(x800) | U2 800(x1400)` 을 `[800, 800]` 으로만 보내면 U2 가 x800 에 놓이고,
후드(가운데 1100)가 U2 에 붙어 "U2 밑의 슬림 후드" 가 된다 — 실측(2026-10-19 GPT)에서 상부장을 이어 붙이고 후드를 오른쪽 장 밑에 넣었다.
그래서 **장과 x 가 겹치지 않는 후드**는 그 줄 안의 칸 하나로 보낸다.

| 경우 | 플래너가 보내는 것 | 프롬프트 |
|---|---|---|
| 노출형 — 후드가 어느 상부장과도 x 가 겹치지 않는다 | 상부 `modules[]` 에 `{ "widthMm": 틈 폭, "kind": "appliance", "doorCount": 0, "drawerCount": 0, "label": "후드" }` 한 칸 (이웃 상부장 사이 틈 전체. 한쪽이 줄 끝이면 후드 폭까지) + `appliances[]` 의 `hood` | `H1 600 mm range hood — not a cabinet: … slim stainless-steel chimney (or canopy) hood …` |
| 내장형 — 후드가 상부장과 x 가 겹친다 | 칸 없음, `appliances[]` 의 `hood` 만 (예전 그대로) | 그 장에 `…, slim concealed hood under it` (예전 그대로) |

- 번호: 후드 칸은 줄 번호를 받지 않고 `H1`·`H2`… (줄 순서 lower→upper→tall, 줄 안 왼→오). `U1 | H1 | U2`. 정면 입면 라벨·판독도 같은 규칙.
- 줄 안 위치·폭 비율·기준 줄 대비 시작/끝은 후드 칸을 포함한다 (`U1 : H1 : U2 = 1.5 : 1 : 1.5`). 후드 칸 자리는 빈 구역(EMPTY ZONES)이 아니다.
- CLOSED LIST 범위에서 빠지고 `H1 is a range hood, not a cabinet.` 를 덧붙인다. 자체 점검 `wall row 2 units + range hood H1 with no cabinet in its gap, 4 doors`.
- **쿡탑**: 플래너에는 쿡탑 섹션이 없다. 후드 칸이 있고 `appliances[]` 에 `cooktop` 이 없으면 후드 칸 가운데가 걸린 하부장 상판에
  `flush induction cooktop on the countertop, directly under the hood H1` 을 붙이고 DO NOT 의 "없는 가전" 에서 `cooktop` 을 뺀다.
  그 하부장이 가전 칸이거나 싱크가 걸렸으면 두지 않는다. 후드 칸이 없는 도면(내장형·후드 없음)은 예전 그대로 — 도면에 없는 쿡탑·후드는 계속 막는다.
- 검사 LAYOUT 요약·설치 프롬프트: `600 mm range hood gap (no cabinet)`.
- 플래너 판독: H1 은 `seen: 'hood'`(새 값) · 도어 0. 후드 칸에 장을 지었으면(`cabinet`) 대조의 `parts.hood` 가 0 이고 **ok 가 아니다**(내부 확인용).
  후드가 안 보여도 장이 없으면(`open`·`missing`) 지킨 것으로 본다(이슈만). 후드로 보인 칸은 `uppers` 에 넣지 않는다(gen-import 가 상부 영역으로 만들지 않게).

### `walls[]` — ㄱ자·ㄷ자의 꺾인 벽 (2026-10-19, 플래너 모드만 읽는다)

예전 패널은 꺾인 구간을 한 줄로 **펴서** 보냈다 (시드 evalc1: 하부 `650 436 936 842 421` — 꺾인 936 이 가운데, `wallRunMm` 3335,
notes "꺾인 구간을 한 벽으로 폈습니다"). 실측(2026-10-19 GPT)에서 기존 ㄱ자 주방 사진에는 꺾인 쪽에도 상부장을 붙였고,
공사현장 사진에는 꺾인 장을 방 안쪽으로 튀어나온 장으로 그렸다. 그래서 **주벽 = 최상위 `sections`(예전 그대로), 꺾인 벽 = `walls[]`**.

| 필드 | 형 | 규칙 |
|---|---|---|
| `side` | string | `left` · `right` — 주벽(뒷벽)을 바라볼 때 어느 옆벽인가. 그 밖이면 그 벽을 통째로 버림. 같은 side 는 앞의 것 하나 |
| `corner` | string | 선택. 모서리를 누가 차지하나: `main`(주벽 런이 모서리까지, 꺾인 런은 그 앞에서 시작) · `return`(꺾인 런이 모서리까지) · `open`(둘 다 닿지 않음) |
| `runMm` | number | 선택. 모서리(주벽 면)에서 꺾인 런 끝까지. 300–12000 |
| `cornerEdge` | string | 선택. 이 벽 정면 입면(`elevation_{side}`) 그림에서 모서리 쪽 가장자리 `left` · `right` |
| `sections` | object | `lower`·`upper`·`tall` — 최상위와 같은 모양, 단 자리는 `fromLeftMm` 대신 **`fromCornerMm`**(주벽 면에서 나온 거리, 0–12000), 모듈은 **모서리에서 방 쪽으로** |
| `appliances` | array | 선택. 최상위와 같은 모양, 자리는 `fromCornerMm` |

최대 2개. `sections` 가 비면 그 벽은 버린다. `walls` 가 있으면 최상위 `wallRunMm`·`fromLeftMm` 는 **주벽만**의 값이다.

```json
"layout": { "shape": "corner", "walls": 2 },
"walls": [
  { "side": "left", "corner": "main", "runMm": 1574, "cornerEdge": "left",
    "sections": { "lower": { "widthMm": 936, "heightMm": 870, "depthMm": 550, "fromCornerMm": 638, "fromFloorMm": 0,
      "modules": [{ "widthMm": 936, "kind": "door", "doorCount": 2, "drawerCount": 0, "label": "양문" }] } } }
]
```

프롬프트(`buildPlannerPrompt`):
- 번호: 꺾인 벽 줄은 같은 머리 글자로 **주벽에 이어서** (주벽 L1–L4 → 왼쪽 벽 L5). 정면 입면 라벨·판독도 같은 규칙.
- `LAYOUT: L-shape — the main run stands on the BACK wall of IMAGE A and a return run stands on the LEFT wall, joined to it at the left corner. … never a free-standing block or peninsula. At the left corner L1 runs into the corner; L5 starts in front of it, … No wall units on the left wall. The right wall gets no cabinets.`
- `FIXED GEOMETRY — each wall exactly as its own elevation shows:` 아래 `BACK WALL (IMAGE B), left to right:` · `LEFT WALL — the return (IMAGE D), from the corner toward the room:` — 벽마다 기준 줄·비율·시작 자리(`starts 638 mm out from the back wall`). 모서리 유닛에 `, in the left corner — L5 stands in front of it`.
- 빈 구역·자체 점검은 벽 이름을 앞에 (`left wall: above the return (L5) — no wall units, bare wall up to the ceiling`), EDIT ZONE `the back wall and the left wall`. 도면에 없는 쿡탑·후드는 계속 막는다.
- 그림: 꺾인 벽 입면은 3/4(IMAGE C) **다음 글자** (D · 3/4 가 없으면 C). 입면을 못 받으면 "IMAGE B shows only the back wall; build the return from the list below."
- 검사 LAYOUT 요약: ` | left wall lower (from the corner) = 936 mm 2-door cabinet`. 설치 프롬프트(일반 연출컷)는 `walls` 를 읽지 않는다.
- 역판독: 판독 계획에 `BASE ROW — LEFT WALL, the return (from the corner outward)` 줄(L5), 꺾인 벽 입면을 IMAGE 3… 으로. 기대값(`expectedFromSpec`)은 주벽 바닥 → 꺾인 벽 바닥 순서, 상부장 도어는 벽을 합친다.
- `walls` 가 없으면 예전 그대로 (펴진 ㄱ자 문단 `IMAGE B shows it unfolded into one flat strip`).

렌더 역할 (플래너 모드 `renders[]`): `elevation_left` · `elevation_left_labeled` · `elevation_right` · `elevation_right_labeled` (선택, 최대 7장).
`design_spec.walls` 에 그 벽이 있을 때만 싣는다. 번호 붙은 것은 설치 때 GPT 에만, 역판독에는 공급자와 상관없이.

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
| `model` | object | 선택 (2026-10-20). **`fridge` 만** — 아래 "냉장고 모델". 다른 가전에 오면 버림 |

#### `appliances[].model` — 냉장고 모델 (2026-10-20)

플래너 배치 단계(`mockup-shell.html` W9-44 모델 고르기)에서 고른 냉장고. 값은 `appliance_models` 의 행 그대로다.
플래너 모드의 냉장고 자리 문장만 읽는다 — 설치 프롬프트(`buildDesignSpecBlock`)·검사 요약은 읽지 않는다 (바이트 그대로).

| 필드 | 형 | 규칙 |
|---|---|---|
| `brand` | string | `appliance_models.brand` (`삼성` · `LG` · `위니아` …). 30자. 프롬프트는 `삼성`→`Samsung`, `위니아`→`Winia`, `데이코`→`Dacor` 로 바꾸고 그 밖의 한글 브랜드는 뺀다 |
| `name` | string | `model_name` (코드 없이). 80자. 프롬프트는 한글이 든 낱말을 뺀다 (`BESPOKE 1도어 키친핏 409L` → `BESPOKE 409L`) |
| `code` | string | `model_code`. 40자. 이름에 이미 있으면 한 번만 말한다 |
| `widthMm` · `heightMm` · `depthMm` | number | 50–4000 · 100–3600 · 50–1200 으로 자름. 숫자가 아니면 400 (`appliances[].model.heightMm …`) |
| `subtype` | string | `appliance_models.subtype`. `french_4door` · `side_by_side` · `two_door` · `one_door` 는 문 형태로 말하고(`four-door french-door type` …), `built_in` · `kimchi_stand` · `kimchi_lid` · `wine` · `small` 은 받기만 한다. 그 밖은 버림 |

- `name` 도 `code` 도 없으면(또는 객체가 아니면) `model` 키가 없다 → 중립 냉장고.
- 모델은 가전이 걸린 모듈(냉장고장 통)에 붙는다 — 가전 자리(`fromLeftMm` + 폭/2)가 그 통 안이어야 한다.

```json
"appliances": [
  { "kind": "fridge", "fromLeftMm": 2420, "widthMm": 680,
    "model": { "brand": "삼성", "name": "BESPOKE 1도어 키친핏 409L", "code": "RR40C7805AP",
               "widthMm": 595, "heightMm": 1853, "depthMm": 700, "subtype": "one_door" } }
]
```

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
| 받지 않는 것 | `reference_images` (보내도 무시). `realize` · `engine` · `control_*` 는 2026-10-19 경로째 지웠다 — 어느 모드도 읽지 않고, 옛 행을 재생성해도 잇지 않는다 |
| 렌더 | 역할마다 한 장, 최대 3장(`elevation` → `elevation_labeled` → `massing`) — 2026-10-19 부터 꺾인 벽 입면(`elevation_left`·`_labeled`·`elevation_right`·`_labeled`)까지 최대 7장, 다른 role 은 버림. 버킷 `{user}/{gen}/render-{role}.{ext}`, `inputs.renders[] = {role, path, url, mime}`. 번호 입면·3/4 는 업로드가 실패해도 잡은 간다 |
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
| `LAYOUT` | `layout` → 없으면 `notes` 의 `ㄱ자`·`ㄷ자` → 그래도 모르면 **문단 없음** (일자로 단정하지 않는다). ㄱ자·ㄷ자면 벽 대비 % 와 남는 벽 구역을 말하지 않는다 (2026-10-20: `walls[]` ㄱ자는 주벽 기준으로 말한다 — `BINDING`) |
| `FIXED GEOMETRY` | 줄마다 번호·폭·종류, `→ widths L1 : L2 : L3 = 2 : 1 : 2.5` (가장 좁은 모듈 = 1, **2026-10-20 부터 소수 둘째 자리** — 예전 0.5 단위는 600 : 680 을 `1 : 1`, 800 : 600 을 `1.5 : 1` 로 말해 냉장고장을 도면보다 넓게 그렸다. 이제 `1 : 1.13` · `1.33 : 1`. 정수·0.5 배는 예전과 같은 글자). 둘째 줄부터는 기준 줄(하부, 없으면 가장 긴 줄)의 모듈 경계로 시작·끝: `U1–U2 start above the left end of L1 and end above L3, 400 mm before the right end of the base row` |
| 높이 | `fromFloorMm`·`ceilingMm` 중 하나라도 오면 줄마다 `bottom at X mm, top at Y mm from the floor` (`fromFloorMm` 없는 하부·키큰장·붙박이장은 0). 아무것도 없으면 예전처럼 `870 mm high` |
| `CLOSED LIST` | `L1–L3 and U1–U2 are the only built-in units` — 다른 장·서랍장·선반·판 없음 |
| `BINDING` | 순서·개수·줄 안 폭 비율(±10 %)·기준 줄 대비 위치는 구속, 벽에 맞추는 것은 **전체 배율만** (옛 "mm·% 는 참고" 를 바꿈). 2026-10-20: **벽 폭을 알고 런이 벽보다 짧으면** 배율 문장 대신 고정 문장 — `The run is 2200 mm long — about 61 % of the wall (about 3600 mm in IMAGE A). Do not stretch the units to fill the wall; keep the remaining 1400 mm (about 39 %) right of the run as bare wall. Keep each door's proportions as IMAGE B shows — do not widen any door.` (분석 벽 폭이 ±150~200 mm 흔들려 mm 와 % 를 함께). 실측(싱크대 연출컷 26건 mm 측정): 일자 15장 중 14장이 하부장 줄 오른끝을 늘렸다(중앙 +223 mm), ㄱ자는 벽의 55 % 인 주벽 줄을 84~88 % 까지. 런이 붙은 벽 끝: 일자·모양 모름은 왼쪽 모서리(예전 가정), `walls[]` ㄱ자는 꺾인 벽 쪽 모서리 — 왼쪽 꺾임은 늘, 오른쪽 꺾임은 `corner:'main'` 일 때만(주벽 좌표 0 이 주벽 줄 왼쪽 끝이라). ㄷ자·펴진 ㄱ자·벽 모름·런 ≥ 벽은 배율 문장 그대로 |
| `EMPTY ZONES` | 벽장 높이·바닥 높이에서 아무 줄도 덮지 않는 구간, 하부 윗면~상부 아랫면, 맨 위 줄~천장 틈(`open or closed exactly as IMAGE B shows` — 막음 여부 필드가 아직 없다), 남는 벽(결정 ①′). 2026-10-19: 50 mm 이하 틈(EP 20 같은 마감재 한 장 — 모듈이 아니라 런 폭에만 든다)은 빈 구역으로 세지 않는다 (`PLANNER_FINISH_GAP_MM`). 층 전체가 빈 것은 그대로. 2026-10-20: 남는 벽 항목은 자리만(`the main wall right of the run, floor to ceiling`, ㄱ자 `back wall: right of the run, …`) — 크기는 `BINDING` 한 번 |
| `EDIT ZONE` / `KEEP` | 목표 벽의 붙박이만 철거·교체. 카메라·다른 벽·창·문·조명·움직이는 물건(냉장고·카트·조명·화분)은 그대로. 2026-10-19 (주방 품목): 목표 벽들(주벽+꺾인 벽)의 **옛 붙박이 가전**도 함께 철거 — 도면에 없는 싱크·가스레인지/쿡탑·후드·빌트인 오븐(늘)·식세기는 이름으로 지우고 그 자리는 새 상판·전면·빈 벽, 도면에 있는 것은 `… is new, only where the list above puts it`. 꺾인 벽 `appliances[]` 도 도면에 있는 셈. KEEP 의 이동식은 `a free-standing refrigerator, microwave, …` (실측: ㄱ자 주방 사진에 옛 가스레인지·슬림 후드가 남았다) |
| `FINAL SELF-CHECK` | 맨 끝. 줄마다 유닛·도어·서랍 수, 빈 구역 수, `no other built-in unit anywhere`. 2026-10-19: 한 줄에 외문(1짝) 칸과 2짝 이상 칸이 섞이면 문 수를 칸별로 — 줄 끝 `→ doors U1 2 + U2 2 + U3 1 = 5 doors`, 자체 점검 `wall row 3 units, U1 2 + U2 2 + U3 1 = 5 doors`. 고른 줄은 합계만 (실측: 상부 2·2·1 을 6짝으로 그렸다). 2026-10-20: 고정 문장이 나갈 때 주벽 줄 점검 뒤에 `base row ends at about 61 % of the wall (2200 mm)` (런 끝에 닿는 줄 이름, 끝 마감재 50 mm 이하는 무시) |

검사: 플래너 모드이고 도면이 천장 틈을 두었으면(`ceilingMm` 과 맨 위 줄 윗면) `gap_to_ceiling` 줄 끝에
"그만한 틈은 의도된 것 — 그보다 분명히 클 때만" 을 붙인다. 2026-10-20: 플래너 모드이고 도면에 냉장고 자리(냉장고장 통의
가전 단 또는 냉장고 가전 칸, 꺾인 벽 포함)가 있으면 `appliances_visible` 줄 끝에
`; a refrigerator standing in the refrigerator opening of the design is expected — do not report it` 를 붙인다 (그 자리에 냉장고를 그리라고 했다).
그 밖의 검사 프롬프트는 바이트 그대로.

### 내부 확인용 (`options.internal_only`, 계획서 §6.3 · §11-⑦)

도면과 맞는다고 확인되지 않은 플래너 결과는 고객에게 나가지 않는다. 새 열 없이 `generations.options` 에 둔다.

| 항목 | 규칙 |
|---|---|
| 언제 붙나 | `mode:'planner'` 잡이 done 으로 끝날 때 `layout.verify.ok !== true` — 불일치(`false`) · 대조 실패(`null`, `verify.error`) · 대조를 못 돈 경우 모두. ok 면 **키 자체가 없다**. 2026-10-20: 플래너 판독의 ok 는 상부 도어 총수가 도면과 같고 도면 밖 상부 줄 덤이 없어야 한다 |
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
