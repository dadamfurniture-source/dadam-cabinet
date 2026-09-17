# 방 사진 + 도면 → AI 합성 이미지 계획 (울트라플랜)

> 다시 씀: 2026-09-17 / 기준 커밋: `a94afc0` (origin/main)
> 첫 판(2026-09-16, 기하 방식)은 §1 의 이유로 폐기하고 통째로 다시 썼다.
>
> 표기: **[확인]** 코드 근거 있음 (`파일:줄` 병기) · **[결정]** 이 계획이 정하는 것 ·
> **[확인 필요]** 사장님·현장만 답할 수 있는 것. 지어내지 않는다.

---

## 0. 한 문단 요약

디테일 단계에서 **방 사진을 올리고 버튼 하나를 누르면**, AI 가 사진에서 **벽의 마감 끝과 길이
치수**를 읽고, **플래너에 그려 둔 품목 내용**을 그 벽에 설치한 실제 사진 같은 이미지를 만든다.

**사람이 맞추는 단계는 없다.** 사각형을 끌지도, 화각을 고르지도, 미세조정을 하지도 않는다.
사진을 올리고 누르면 끝이다. 원근·조명·재질은 전부 AI 가 맞춘다 — 우리가 계산하지 않는다.

이것은 새 배관이 아니다. **이미 도는 연출컷 파이프라인(`workers/generate-api`)에 입력 하나를
더하는 일**이다. 지금 그 파이프라인은 가구를 "600mm 모듈의 직선 주방" 같은 **범용 문장**으로
설명한다 (§2·§3). 그 자리에 사용자가 실제로 그린 도면을 넣는 것, 그게 이 계획의 전부다.

---

## 1. 왜 기하 방식을 접었나 (2026-09-17)

사장님 말씀 그대로:

> "내가 원하는 기능이 아니야. 복잡하면 안되. 바닥 도형 배치는 완전히 제거하고, AI로 벽의
> 마감 끝을 분석, 길이 치수 분석해서, 플래너의 도면의 품목 내용을 자동으로 결합해서 실제
> 이미지 처럼 만들어 주길 원하는 거야."

첫 판은 **기하**로 풀려 했다. 사진 위 바닥에 사각형 네 귀퉁이를 사람이 맞추면, 그 대응에서
호모그래피를 풀어 카메라를 역산하고, 그 카메라로 3D 가구를 렌더해 사진에 얹는 방식이었다.
수학은 맞게 돌았지만 **사용자가 할 일이 늘었다** — 그것이 틀린 점이다. 원하던 것은
"사진 올리고 누르면 되는" 기능이었다.

P0~P2 는 되돌렸다.

| PR | 내용 | 상태 |
|---|---|---|
| #673 (P0) | `js/planner/photo-solve.js` — 사각형 → 카메라 역산 (순수 수학) | 제거 |
| #676 (P1) | `photo-bg.js`·`photo-mode.js` — 사진 레이어·사각형 편집기·실시간 합성 | 제거 |
| #679 (P2) | 그림자 받개 · 빛 맞추기 · 톤 맞추기 | 제거 |

되돌리며 **남긴 것은 하나뿐**이다: P2 를 만들다 나온 발견 —
**이 앱은 그림자를 그린 적이 없다** (`docs/02-design/features/shadow-frustum.md`).
`DirectionalLightShadow` 의 기본 프러스텀이 mm 단위 씬에서 10mm × 10mm 상자라 비어 있다.
사진 합성과 무관하게 평소 3D 화면에도 해당하는 사실이라 문서로 남겼다.

> **이 기록은 되살리자는 뜻이 아니다.** 그림자 발견은 평소 3D 화면 이야기이고,
> 사각형 맞추기·카메라 역산은 다시 만들지 않는다. 혹시 나중에 "정확한 원근이 꼭 필요하다"는
> 결론이 나면 그때 git 이력(`#673`·`#676`·`#679`)에서 꺼내면 된다 — 그 전에는 꺼내지 않는다.

---

## 2. 이미 있는 것 [확인]

**중요한 사실부터**: 지금도 사용자는 방 사진을 올려 AI 가구 이미지를 만들고 있다
(`ai-design.html`). 없는 것은 그 이미지와 **자기 도면**의 연결뿐이다.

### 2.1 잡 흐름

| 단계 | 하는 일 | 근거 |
|---|---|---|
| 접수 | `POST /api/generate` → `createGeneration()`. JWT 먼저 확인(본문 파싱 전), 사용자당 동시 1건(409), 크레딧 차감, `generations` 행 삽입, 방 사진을 버킷에 올려 `inputs` 갱신, Durable Object 에 넘기고 **202** 반환 | `workers/generate-api/src/worker.js:191-347` (라우트 표 `:157-173`, 202 반환 `:325-334`) |
| 실행 | DO `GenerateJob` — 체크포인트 + 알람 재시도(최대 2회, `MAX_ATTEMPTS` `:42`). 미국 콜로(`locationHint`) | `job.js:60-143`, `jobStub` `:146-150` |
| 파이프라인 | `runPipeline` | `job.js:170-400` |
| 조회 | `GET /api/generate/:id` — 상태 폴링(3초). 목록 라우트는 **없다** | `worker.js:402-411`, `ai-design.html:1211`·`POLL_MS` `:337` |

`runPipeline` 의 단계는 **analyzing → rendering → qc → variants → done** 이다
(`STEP` 표 `job.js:52-58`, `generations.status` CHECK 과 같은 이름 `database/generations-schema.sql:22-23`).

| 단계 | 줄 | 하는 일 |
|---|---|---|
| `analyzing` | `job.js:192-222` | 방 사진 한 장으로 `buildAnalysisPrompt()` 호출 → `parseAnalysis` → `generations.wall_analysis` 에 기록 (`:221`). **실패해도 조용히 3000×2400 기본값으로 계속 간다** (`:211-213`) |
| `rendering` | `job.js:239-250` | `buildInstallPrompt(ctx)` + [방 사진, 참고 이미지…] → 기본안 한 장 |
| `qc` | `job.js:251-271` | `buildQcPrompt` 로 자가 검사, 실패하면 `{fix: qc.issues}` 로 **1회 재렌더** |
| 기본안 저장 | `job.js:274-285` | 버킷 업로드 + `images`·`quote` 행 갱신 |
| `variants` | `job.js:290-377` | 테마 팔레트 추출 → 마감 3안(`v1`~`v3`)을 기본안에서 파생 |
| `done` | `job.js:379-399` | `status`·`progress`·`elapsed_ms`·`completed_at` 마감 |

출력 버킷은 `generations` (`supabase.js:132-133`, DDL `database/generations-schema.sql:90-92`).

### 2.2 프롬프트 — 여기가 핵심이다

**`buildAnalysisPrompt()` — `prompts.js:99-109`. 인자가 없다.**
사진 한 장만 보고 한국 아파트 표준 치수(문틀 900×2100, 콘센트 70×120, 천장 2300-2400)를
자로 삼아 JSON 으로 답하라고 한다. 요구하는 필드는 `prompts.js:103` 한 줄에 그대로 있다:

```
{"wall_width_mm":number,"wall_height_mm":number,"water_supply_from_left_mm":number|null,
 "exhaust_from_left_mm":number|null,"confidence":"high"|"medium"|"low","room_brief":string,
 "existing_furniture":string|null,"site_condition":"finished"|"construction",
 "site_notes":string|null,"wall_tile":{"present":boolean,"light_neutral":boolean,"description":string|null}}
```

**즉 "벽의 길이 치수를 AI 가 읽는다"는 사장님 요구는 이미 구현되어 있다.**
`wall_width_mm`·`wall_height_mm` 가 그것이고, 수전(`water_supply_from_left_mm`)·
배기(`exhaust_from_left_mm`)·타일(`wall_tile`)·기존 가구(`existing_furniture`)까지 읽는다.
파서는 `parseAnalysis` `:112-158` (기본값 3000×2400, `clampWall` 은 1000~6000mm `:160-162`).

**`buildInstallPrompt(c, opts)` — `prompts.js:207-242`.** 방 사진에 가구를 **설치**하라고 지시한다.
반환 문자열은 `:235-241`:

| 줄 | 내용 |
|---|---|
| `:235` | `Edit the first photo: install a built-in ${cat.label} (${key}) on the main wall.` |
| `:236` | 방을 사진 그대로 유지하라 (카메라·벽·천장·바닥·창·조명) |
| `:237` | `WALL: about ${c.wallW} x ${c.wallH} mm.` ← **치수 입력은 이 한 줄뿐이고, 사진에서 잰 값이다** |
| `:238` | `FURNITURE: ${cat.spec(c)}` ← **가구 설명은 이 한 줄이 전부다** |
| `:239-241` | 마감·손잡이 없음(매립형)·사진처럼 |

**`CATEGORIES[key].spec` 은 범용 문장이다 — `prompts.js:30-85`.**
항목 모양은 `{ label: '싱크대', spec: (c) => '영어 산문' }` 이고, `spec` 이 받는 `c` 에는
사진에서 잰 벽 치수와 스타일 옵션뿐이다. **도면도, BOM 도, 모듈 목록도, 치수도 들어오지 않는다.**

- `sink` `:33-39` — "Straight kitchen run along the wall. … Lower cabinets in **600 mm modules**
  under one continuous stone countertop. …"
- `wardrobe` `:50-52` — "Floor-to-ceiling wardrobe covering the full wall width with
  `${wardrobeDoors(c.wallW)}` **equal** full-height flat doors arranged in mirrored pairs."
- `storage` `:56-58` · `vanity` `:69-71` · `shoe` `:75-77` · `office` `:81-83` — **인자를 아예 받지 않는다.**
  즉 모든 사용자에게 **바이트 동일한 문장**이 나간다.

유일한 "계산"은 `wardrobeDoors(wallW)` `:88-92` — 벽 폭 구간에 따라 4·6·8짝. 키는 여덟이다:
`sink`·`island`·`wardrobe`·`storage`·`fridge`·`vanity`·`shoe`·`office`.
모르는 키는 조용히 `storage` 가 된다 (`resolveCategory` `:94-96`).

그 밖의 프롬프트: `buildQcPrompt` `:248-268`, `buildThemePalettePrompt` `:321-327`,
`buildVariantPrompt` `:412-418`, `buildTwoToneVariantPrompt` `:404-410`.
이 파일은 **import 가 없어야 한다** (`prompts.js:13` — 시험이 export 만 떼어 평가한다).

### 2.3 표·크레딧·화면

| 항목 | 내용 | 근거 |
|---|---|---|
| `generations` 표 | `status`·`progress`·`step_label`·`category`·`options`·`inputs`·`wall_analysis`·`quote`·`images`·`layout`·`credit_*`·`share_*` | `database/generations-schema.sql:18-47` |
| **도면과의 연결** | **없다.** `design_id`·`item_unique_id` 같은 칸이 없고 `parent_id` 는 다른 생성을 가리킬 뿐이다 | 같은 파일 `:21` · `detail-bom-deepening.plan.md:220` 이 이미 지적 |
| 크레딧 | 1회 **20** (`credit_costs` 행). 워커에는 숫자가 없고 DB RPC 가 정한다 | `database/credit-amounts.sql:23-25` (폴백 20 `:62`), 호출 `worker.js:243` |
| 환불 | 기본안이 없으면 실패 처리 + 환불, 있으면 `done` 으로 인정 | `job.js:118-142` |
| 사진 업로드 | `<input type="file" accept="image/jpeg,image/png">` → `FileReader.readAsDataURL` → **긴 변 1600px 로 축소 후 JPEG 재인코딩** → base64 | `ai-design.html:200`, `readImage` `:480-512` (`MAX_EDGE` `:341`) |
| 요청 본문 | `room_image`·`image_type`·`category`·`design_style`·`door_color`·`reference_images`·`wall_width_override`·`fridge_options` | `ai-design.html:1138-1149` |
| 이력 | `my-designs.html` 이 PostgREST 로 직접 읽는다 (워커 목록 라우트 없음) | `my-designs.html:379-388` |
| 공유 | `design-share.html#t=` → `GET /api/share` + `X-Share-Token` | `design-share.html:162,173,177` · `worker.js:463-490` |
| 견적 | `buildQuote(category, wallW)` — **품목 키와 AI 가 잰 벽 폭만** 본다. 도면·BOM 과 무관 | `quote.js:38-82` |

### 2.4 이미 있는 **반대 방향** — 이게 제일 중요한 선례다

**연출컷 → 플래너**는 이미 끝까지 돌아간다.

- `workers/generate-api/src/layout.js` — 완성된 기본안을 Claude 비전에 보여 **구성**만 읽는다
  (세그먼트 순서·가전 위치 %·도어 수). `LAYOUT_SCHEMA` · `buildLayoutPrompt()` · `normalizeLayout()`
- `js/detaildesign/gen-import.js` — 그 결과를 플래너 배치 payload 로 바꿔 넣는다

그리고 그 파일은 **소유권을 명시적으로 고정해 두었다** (`layout.js:8-13`):

> 벽 치수·급수·배기 = `wall_analysis` (사진에서 잰 값) · 가전 폭 = `PLANNER_SECTIONS` ·
> 모듈 분할 = 플래너 엔진 · 구성 = Claude

또한 워커는 브라우저 파일을 import 할 수 없어 플래너 상수를 **옮겨 적고 시험이 대조한다**
(`APPLIANCE_W`, `layout.js:31-35`). **이 계획이 만드는 것은 정확히 그 반대 방향이고,
같은 규율을 그대로 쓴다.**

### 2.5 플래너가 이미 들고 있는 것

| 자산 | 내용 | 근거 |
|---|---|---|
| 도면 payload | `buildPlannerPayload(type)` → `{type, source, modules[{id,section,W,H,D,x,y,rotation,isFixed,finishings[],areaH?,blind?}], structures, hasStructures}` | `mockup-structure.html:5981-6036` |
| 섹션 정본 | `PLANNER_SECTIONS` — `label`·`w`·`h`·`moduleH` (하부장 870 / 상부장 780 / 키큰장 2300 / 붙박이장 2310 …) | `js/planner/planner-sections.js:47-79` |
| 배치 공간 | `planeBoxOf(o, pivot)` → `{x,y,w,d,cx,cy,rot}` (mm) | `mockup-structure.html:1749-1757` |
| 마감(디테일) | 저장 키 `dadam_detail_v1`, 슬롯 `door·drawerFront·body·top·handle·finishing·kick` | `planner-store.js:44-47`, `planner-finish.js:277-284` |
| 마감 카탈로그 | 마감 7(`:34-42`) × 색 10(`:48-61`) → 코드(`PET-OAK-M` 꼴) + hex + 한글 라벨 | `js/detaildesign/bom-finish-color.js:34-61` |
| 손잡이 규칙 | 전 품목 매립형(handleless) | `CLAUDE.md` · 프롬프트에 이미 반영 `prompts.js:240` |

---

## 3. 빠진 것 — 딱 하나

**가구 설명이 사용자의 실제 도면과 무관하다.**

사용자가 플래너에서 3600mm 붙박이장을 5통으로 나누고, 왼쪽 두 통에 서랍 4단을 넣고,
몸통은 모시베이지, 도어는 월넛 PET 매트로 지정했다고 하자. 그 정보 중 **단 하나도**
이미지 생성에 도달하지 않는다. 프롬프트가 받는 문장은 여전히 이것이다:

> "Floor-to-ceiling wardrobe covering the full wall width with 6 **equal** full-height flat doors
> arranged in mirrored pairs."

`buildInstallPrompt` 의 `FURNITURE:` 줄 하나(`prompts.js:238`)가 가구의 전부이고,
그 줄은 `CATEGORIES[key].spec(c)` 이며, `c` 에는 도면이 없다.

**여기에 플래너의 품목 내용을 넣는 것이 이 계획의 전부다.** 다른 것은 바꾸지 않는다 —
단계 이름도, 크레딧도, 저장 위치도, 화면도 그대로다.

---

## 4. 설계

### 4.1 원칙 [결정]

1. **플래너는 구조화된 도면 요약(JSON)을 보내고, 문장은 워커가 만든다.**
   프롬프트 문자열을 브라우저에서 조립하지 않는다. 이유: 프롬프트 정본은 `src/prompts.js`
   한 파일이라는 규약이 이미 있고(`CLAUDE.md`), 문장을 두 곳에서 만들면 곧 갈라진다.
   `layout.js` 가 반대 방향에서 지킨 규율과 같다 (§2.4).
2. **사람이 맞추는 단계를 만들지 않는다.** 사진 올리기 + 버튼 하나. 화각·사각형·미세조정 없음.
3. **치수의 출처를 섞지 않는다.** 벽은 AI(`wall_analysis`), 가구는 도면. 둘을 평균내지 않는다.
   가구 폭이 AI 가 잰 벽 폭보다 크면 **도면을 따르고** 그 사실을 프롬프트에 적는다.
4. **기존 연출컷 경로를 깨지 않는다.** 도면 요약이 없으면 지금과 **바이트 동일한** 프롬프트가
   나가야 한다. 새 입력은 전부 선택이다.
5. **정확도를 약속하지 않는다.** 이미지 모델은 근사다. mm 를 지킨 도면이 아니라 "내 설계처럼
   보이는 사진"이 결과물이다 (§7 첫 항목).

### 4.2 계약 초안 — **필드 이름은 워커 PR 이 정한다**

아래는 무엇을 보낼지를 정하는 초안이고, **최종 필드 이름·형태는 R1(워커 PR)이 확정한다.**
플래너 PR(R2)은 그 확정본을 따른다. 여기 적힌 이름을 그대로 굳히지 말 것.

요청 본문에 한 칸을 더한다 (`ai-design.html:1138-1149` 의 형제):

```jsonc
// POST /api/generate 에 추가되는 선택 필드 (초안)
"design_summary": {
  "version": 1,
  "source": "mockup-structure",          // buildPlannerPayload 의 source 를 그대로
  "category": "wardrobe",                // generations.category 와 같아야 한다
  "wall_mm": { "width": 3600, "height": 2400 },   // 도면이 아는 벽. AI 값과 다르면 §4.1-3
  "runs": [                              // 좌→우. layout.js 의 세그먼트 어휘를 맞춘다
    {
      "section": "wardrobe",             // PLANNER_SECTIONS 의 키
      "width_mm": 3600,
      "height_mm": 2310,
      "depth_mm": 600,
      "bays": [                          // 통 — 제작 단위
        { "width_mm": 720, "doors": 1, "drawers": 4, "shelves": 3, "rod": true },
        { "width_mm": 720, "doors": 1, "drawers": 0, "shelves": 5, "rod": true }
      ]
    }
  ],
  "finish": {                            // dadam_detail_v1 슬롯 → 사람이 읽는 말
    "door":   { "code": "PET-WNT-M", "label": "월넛 PET 매트", "hex": "#8b6447" },
    "body":   { "code": "MFB-BGE-S", "label": "모시베이지 멜라민", "hex": "#e2ddd0" },
    "top":    null, "handle": null, "finishing": null, "kick": null
  },
  "notes": ["손잡이 없음 (매립형)"]
}
```

만드는 쪽: `mockup-structure.html` 의 `buildPlannerPayload` **를 고치지 않는다** —
그 함수는 상세설계 브리지의 정본이고 골든 바이트 불변 시험이 지킨다
(`test-utils/planner-golden.js`). **별도 함수**가 같은 모델(`modules`·`structures`·
`areas`·`dadam_detail_v1`)에서 요약을 만든다.

쓰는 쪽 (`prompts.js`):

- `CATEGORIES[key].spec(c)` 는 **폴백으로 남긴다.** 도면 요약이 없을 때만 쓴다.
- 요약이 있으면 `FURNITURE:` 줄을 요약에서 만든 문장으로 **바꾼다** — 새 함수
  (가칭 `buildFurnitureSpec(summary)`), 같은 파일, import 없음(`prompts.js:13`).
- 문장은 **구간과 치수를 말한다**: "3600 mm wide floor-to-ceiling wardrobe in 5 bays of
  720 mm; the two leftmost bays each have a stack of 4 drawers in the lower half …"
- `WALL:` 줄(`:237`)은 그대로 둔다 — 벽의 주인은 여전히 `wall_analysis` 다.
- 매립형 손잡이 문장(`:240`)은 손대지 않는다.

`generations` 에 요약을 남길 곳: 새 칼럼을 파기 전에 **기존 `options` JSONB 안에 넣는 것으로
시작한다** (`database/generations-schema.sql:29`). 도면과의 진짜 연결(`design_id`·
`item_unique_id`)은 `detail-bom-deepening.plan.md:220` 이 이미 필요하다고 적어 둔 별건이다 —
이 계획은 그것을 기다리지 않는다.

### 4.3 안 하는 것

- 카메라 역산·호모그래피·3D 렌더 합성 (§1)
- 사진 위 편집기·사각형·화각 슬라이더·미세조정
- `buildPlannerPayload` 골든 변경
- 평소 3D 화면의 그림자 (`shadow-frustum.md` 의 [확인 필요])
- 단계 이름·크레딧·버킷·공유 방식 변경

---

## 5. 단계

### R1. 워커 — 도면 요약 입력 + 프롬프트 (M) `agent/imggen-design-summary`
- `worker.js` `createGeneration`: `design_summary` 를 받아 검증하고 `options` 에 싣는다
  (`:207-238` 근처). 없으면 지금과 **동일**.
- `job.js`: `ctx` 에 요약을 넘긴다 (`:225-235`).
- `prompts.js`: `buildFurnitureSpec(summary)` 신규 + `buildInstallPrompt` 의 `FURNITURE:` 분기.
  `spec` 폴백 유지.
- 시험: 요약이 없으면 프롬프트 **바이트 동일**(회귀 방어), 요약이 있으면 통 수·치수·마감이
  문장에 나타난다. `prompts.js` 는 import 가 없어야 한다.
- **계약(필드 이름·형태)을 여기서 확정하고 문서화한다.** R2 는 이 확정본만 본다.

### ~~R2. 플래너 UI — 사진 올리기 + 버튼 + 결과 (M)~~ ✅ 2026-09-17 `agent/planner-ai-photo`
문서: `docs/02-design/features/planner-ai-photo.md` · 만든 것: `js/planner/ai-photo.js`
- 디테일 단계 우측에 섹션 하나 (`data-sec="aiphoto"` + `PANEL_SEC_TITLE` + 디테일 모드 CSS 예외 —
  규약은 `planner-detail.js:94-95`).
- 화면 요소는 셋뿐이다: **사진 올리기 · 만들기 버튼 · 결과 썸네일**. 크레딧 20 은 **누르기 전에** 보인다.
- 요약 생성기 `plannerAiPhotoBuildSpec`(순수) — 필드 이름은 R1 이 확정한
  `docs/02-design/features/design-spec-prompt.md` 를 따른다. `buildPlannerPayload` 는 손대지 않았고,
  요약을 읽는 것만으로 `structures` 가 생기지 않는다(`getStructure` 대신 `structures[id] || null`).
- `POST /api/generate` 호출, 3초 폴링, 잡의 한국어 `step_label` 을 그대로 표시.
- 사진 축소는 `readImage` (`ai-design.html:480-512`) 와 같은 규칙(긴 변 1600px JPEG) — 그 페이지에서
  가져오지 않고 같은 규칙을 다시 적었다(품목이 다른 도메인 파일이다).
- 오류: 402 · 409 · 400 `bad_design_spec`(크레딧 차감 전) · 401 · `design=local`(설계 먼저 저장).
- 마지막 잡 id 를 스코프별 `localStorage` 에 남겨 새로고침해도 돌던 잡에 다시 붙는다.
- 시험: `__tests__/ai-photo.test.js`(계약 문서의 표를 읽어 필드 이름 대조) ·
  `__tests__/planner-ai-photo-ui.test.js`(`bootPlanner`).
- 남은 확인: 실제 붙박이장 도면 하나로 눌러 **통 수와 서랍 위치가 도면과 같은지** 눈으로 보는 것 (§7-1).

### R3. 결과 보관 · 재생성 · 내 연출컷 연결 (S) `agent/planner-photo-history`
- 결과를 디테일 단계에서 다시 보기, 재생성(`parent_id` 경로 `worker.js:223-228`).
- `my-designs.html` 목록에 함께 뜨게 한다 (이미 `generations` 를 읽으므로 별도 배관 불필요,
  `:379-388`) — 도면 기반으로 만든 것임을 표시만 더한다.
- 공유 링크(`design-share.html#t=`) 연결 여부는 §7.

---

## 6. 결정된 것

| 날짜 | 결정 |
|---|---|
| 2026-09-17 | **크레딧은 연출컷과 같은 20.** 같은 파이프라인·같은 모델·같은 잡이므로 따로 값을 두지 않는다 (`credit_costs` 의 `generate` 행, `database/credit-amounts.sql:23-25`). 새 `action` 을 만들지 않는다. |
| 2026-09-17 | **사진 모드는 전부 제거.** 사각형 맞추기·카메라 역산·그림자 받개·빛·톤 (#673·#676·#679). 되살리지 않는다. 남긴 것은 `shadow-frustum.md` 하나. |
| 2026-09-17 | **사람이 맞추는 단계를 두지 않는다.** 사진 올리기 + 버튼 하나. |
| 2026-09-17 | **프롬프트 정본은 `workers/generate-api/src/prompts.js` 한 파일.** 플래너는 구조화 JSON 만 보낸다. |
| 2026-09-17 | **도면 요약이 없으면 프롬프트는 지금과 바이트 동일.** 기존 연출컷 경로는 건드리지 않는다. |

---

## 7. [확인 필요]

1. **치수를 얼마나 정확히 지킬 것을 기대하시는가?**
   이미지 모델은 근사다. "3600mm 를 720mm 5통으로" 라고 적어도 결과가 4통이나 6통으로
   나올 수 있다. 통 수·서랍 위치 같은 **구성**은 상당히 잘 따르지만, mm 단위 비율은 보장할 수
   없다. 결과물의 자리매김을 정해야 한다 — ⓐ "내 설계로 만든 이미지"(고객에게 보여 주는 그림)
   인가, ⓑ "설계 검증"(치수가 맞는지 확인하는 도구)인가. ⓑ 라면 이 방식으로는 안 된다.
   지금 계획은 ⓐ 를 전제한다. 어긋난 결과에 "실제 제작 도면과 다를 수 있습니다" 를 붙일지도
   여기서 정해진다.
2. **결과를 고객 공유 링크에 넣을 것인가?**
   `design-share.html#t=` 는 지금 연출컷을 공유한다 (`worker.js:430-490`).
   도면 기반 이미지를 같은 링크에 얹으면 고객이 그것을 **확정 설계**로 읽을 위험이 있다
   (1번과 같은 문제). 별도 표시가 필요한지, 아니면 사내 전용으로 둘지.
3. **방 사진을 얼마나 오래 보관하는가?**
   지금 방 사진은 `generations` 버킷에 `{user}/{gen}/room.jpg` 로 **무기한** 남는다
   (`worker.js:277-301`). 고객 집 사진이라 개인정보다. 보관 기간(예: 90일 후 원본 삭제,
   결과 이미지는 유지)과 삭제 주체를 정해야 한다. 학습 사용은 이미 `consent_training`
   동의로 막혀 있다 (`my-designs.html:516`).
4. **품목 여덟 중 어디까지 도면 기반으로 할 것인가?**
   플래너가 도면을 만드는 품목은 싱크·붙박이장·냉장고장 쪽이다. `vanity`·`shoe`·`office` 는
   플래너 섹션이 없어 (`layout.js:26` 이 같은 이유로 제외) 도면 요약을 만들 수 없다.
   이들은 지금의 범용 문장을 그대로 쓰면 되는지 확인 필요.
