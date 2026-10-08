# 플래너 구조 실사화 — 디테일 단계 이미지 생성 교체 계획 (울트라플랜)

> 작성: 2026-09-23 · **결정 반영: 2026-10-08** (§11) / 기준 커밋: `30695e9` (origin/main)
> 이 문서가 디테일 단계 이미지 생성의 **정본**이다. 앞선 두 문서는 경위 기록으로 남긴다:
> `photo-composite.plan.md` (방 사진 + 도면 요약), `photo-composite-research.plan.md` (합성·ControlNet 연구와 실측).
>
> 표기: **[확인]** 코드·측정 근거 있음 · **[결정]** 이 계획이 정하는 것 ·
> **[확인 필요]** 사장님만 답할 수 있는 것. 지어내지 않는다.

---

## 0. 한 문단 요약

사장님 지시 (2026-09-23):

> "그냥 사진 합성을 하지말고, 플래너의 구조만 최대한 그대로 실사화 해서 표현 할 수 있도록 프롬프트
> 엔지니어링을 통해서 작업 하는 방법으로 하자. 디테일 디자인에서 작업된 이미지 생성 구조를 완전히 교체할 거야."

그리고 결정 (2026-10-08): **"고객 방 사진은 그대로 배경으로 두어야 할 것 같아."**

그래서 새 구조는 이렇다. **고객 방 사진이 배경이고, 그 위의 가구는 모델이 플래너 도면을 보고 새로
그린다.** 우리가 픽셀을 얹지 않는다 — 합성본도, 벽 사각형도, 원근 맞추기도, 조건 모델(ControlNet)도 없다.
모델은 세 가지를 받는다: ① 방 사진(편집할 그림), ② 플래너가 스스로 찍은 도면 렌더(무엇을 지을지 보여 주는
참고 그림), ③ 도면 요약에서 자동으로 채운 프롬프트(개수·순서를 번호로 못박은 글).

이게 첫 실측과 무엇이 다른가 — 첫 실측은 **도면을 사진에 붙여 놓고** "다시 그려라" 했고, 붙은 도면과
사진 속 기존 주방이 한 그림에서 싸웠다(역판독 0.45/3). 새 구조는 붙이지 않는다. 사진은 방을, 렌더는
설계를, 글은 개수를 말한다 — 셋의 역할이 갈리고 겹치지 않는다. 그리고 **남는 벽의 기존 가구는 지우고
빈 벽으로 둔다** (§11-① 결정) — 첫 실측 실패의 직접 원인을 막는다.

---

## 1. 무엇을 바꾸고 무엇을 남기나 [결정]

| | 지금 (2026-09-22) | 새 구조 |
|---|---|---|
| 사용자 입력 | 방 사진 + 실사화 체크박스 + 구조 조건 PNG | **방 사진 + 버튼 하나** |
| 모델이 받는 그림 | 방 사진 / 합성본 / 윤곽선 | 방 사진 + **플래너 렌더 2장** (정면 입면 · 가구만의 3/4 뷰) — 참고용, 붙이지 않음 |
| 가구의 출처 | 글(요약) 또는 붙인 도면 | **렌더(형태) + 번호 목록 글(개수)** |
| 남는 벽 | 기존 가구가 남음 | **지우고 빈 벽** |
| 엔진 | Gemini 실사화 / fal ControlNet | **Gemini 한 가지** |
| 재시도 | QC 에 걸리면 1회 | **없음** — 한 번 그리고 대조만 (§11-④) |
| 결과 | 한 장 | 한 장 16:9 + 대조 결과. 어긋나면 **내부 확인용** (§11-⑦) |

**남기는 것** — 이미 검증된 부품:

| 부품 | 파일 | 새 구조에서의 역할 |
|---|---|---|
| 방 사진 분석 (벽 폭·높이·급수·배기·기존 가구·타일) | `prompts.js` `buildAnalysisPrompt` · `job.js` ① | 그대로 — 방은 여전히 사진에서 읽는다 |
| 도면 요약 `design_spec` | `js/planner/ai-photo.js` `plannerAiPhotoBuildSpec` | 프롬프트 번호 목록, 대조의 정답 |
| 역판독 대조 | `verify.js` · `layout.js` | 그대로 |
| 요청 시간 제한 · 파이프라인 마감 | `gemini.js` · `job.js` (#722) | 그대로 |
| 추천안 끄기 (한 장) | `variants:false` (#715) | 그대로 |
| 렌더 캡처 | `planner-capture.js` | 프리셋·대역 추가 (§5) |
| 연출컷 경로 | `ai-design.html` | **건드리지 않는다** |

---

## 2. 지금까지 확인한 것 — 이 설계의 근거 [확인]

| 사실 | 근거 |
|---|---|
| 글만으로는 개수·순서가 흔들린다 | 생성 편집 모델은 형상을 "비슷하게 다시 그린다" (Nano Banana 아이덴티티 0.434). `photo-composite-research.plan.md` §2.1 |
| Gemini 에는 구조를 강제할 파라미터가 없다 | 마스크·ControlNet 류는 Imagen 전용, 2026-08-17 종료. 같은 문서 §2.1 |
| 3D 프록시 렌더를 함께 주면 기하 오차가 준다 | DIRECT (ICML 2026) Matching Error 98.9 → 17.8 (5배). 같은 문서 §2.1 |
| 여러 장을 줄 때는 **이름을 붙이고 역할을 문장으로** | Google 공식 가이드. 같은 문서 §2.7 |
| 입력 이미지는 장당 약 1.5원 | 560 토큰 ≈ $0.0011. 참고 그림을 아낄 이유가 없다 |
| 합성 실측은 구조를 못 지켰다 | 잡 `116a8dd2`: 역판독 0.45/3, 도어 5→9, 없는 식세기·냉장고. 같은 문서 §4.8 |
| 그 원인은 **장면 충돌**과 **남은 기존 가구** | 합성본이 벽 3600 중 2200 만 덮었고, 모델이 남은 주방과 얹은 도면을 섞었다 |
| 지금 ref 문장은 렌더를 "베끼지 말라" 고 말한다 | `prompts.js` style ref 문장 "Never copy the reference layout" — 새 역할이 필요하다 |
| 반투명 가전 상자가 렌더에 찍힌다 | `buildMarkerMesh` opacity 0.35 — 없는 가전을 부를 수 있다 |
| 그림자가 안 그려진다 | `shadow-frustum.md` — 프러스텀 10mm |

---

## 3. 새 구조 한눈에

```
[브라우저 · 디테일 단계]
  방 사진 ──► 16:9 로 가운데 자르기(미리보기) ──► JPEG 1600px
  도면 ──► design_spec
     └──► 자동 캡처 2장 — 가구만, 흰 배경, 그리드·마커 숨김, 가전 대역, 그림자, 예림 마감
           Ⓑ elevation : 정면 입면 (개수·비율 참고)
           Ⓒ massing   : 3/4 뷰 (깊이·옆면·상판 앞코 참고)
          │
          ▼ POST /api/generate { mode:'planner', room_image, renders:[Ⓑ,Ⓒ], design_spec, variants:false }
[워커]
  접수   도면 요약 검증 → 크레딧 20 → 사진·렌더 저장 → 잡
  ① 분석   방 사진 → 벽 폭·높이·급수·배기·기존 가구·타일 (지금 그대로)
  ② 설치   Gemini 3 Pro Image · [Ⓐ 방 사진, Ⓑ, Ⓒ] + 프롬프트 v2 (§4) · 온도 0.2 · 16:9
  ③ 검사   규칙 위반 — 기록만, 재시도 없음
  ④ 역판독 결과를 읽어 도면과 대조 → ok / 점수 / 사유
  ⑤ 완료   한 장. ok 가 아니면 internal_only — 공유·내 연출컷에 안 나간다 (§11-⑦)
```

---

## 4. 프롬프트 설계 — 이 계획의 핵심

### 4.1 원칙 [결정]

1. **세 장의 역할을 이름으로 가른다.** `IMAGE A = ROOM PHOTO (edit this)` · `IMAGE B = FRONT ELEVATION (the exact design)` ·
   `IMAGE C = 3/4 VIEW (depth reference)`. B·C 는 "참고" 이지 "붙일 것" 이 아님을 적는다.
2. **그림이 형태를, 글이 개수를 말한다.** 글은 그림을 **가리키며** 말한다 ("IMAGE B shows exactly 3 base units").
3. **숫자는 번호 목록으로, 합계는 두 번.** `L1 · L2 · L3` + 줄 끝 합계 + COUNT CHECK 한 줄.
4. **치수는 비율로도 준다.** "L1 is 36 % of the run" — 모델은 mm 보다 비율을 잘 지킨다. 사진에서 잰 벽과 어긋나면
   **사진이 이긴다**는 지금 규칙은 유지 (순서·개수는 구속, mm 는 참고).
5. **남는 벽을 명시한다.** "The run starts at the left corner and ends at {x} % of the wall. Remove any existing furniture
   on the rest of the wall and leave it as a finished empty wall." (§11-①)
6. **금지 목록은 첫 실측의 실패를 이름으로.** 없는 가전, 늘어난 도어, 남은 기존 장.
7. **온도 0.2, 비율 16:9.** 지금은 0.4·비율 미지정 [확인: `gemini.js`].

### 4.2 프롬프트 v2 초안 (영문 — 모델은 한국어 제품명을 못 읽는다 [확인: `nameEn` 필수])

```
You receive three images.
IMAGE A — ROOM PHOTO: the customer's real room. Edit this photo. Keep its camera, walls, ceiling, floor,
          windows and lighting exactly as photographed.
IMAGE B — FRONT ELEVATION from our planner: the exact cabinet design to build, seen straight on.
IMAGE C — 3/4 VIEW of the same design: shows depth, side panels and the countertop edge.
IMAGE B and IMAGE C are design references. Do not paste them into the photo and do not copy their
plain white background or flat look. Build the real cabinets they show, in the room of IMAGE A.

TASK: install this built-in kitchen on the main wall of IMAGE A as a real, finished installation.

FIXED GEOMETRY — left to right, exactly as IMAGE B shows:
  BASE ROW (870 mm high, 2200 mm long, 61 % of the wall from the left corner):
    L1  800 mm (36 % of the run)  2-door cabinet
    L2  400 mm (18 %)             single-door cabinet
    L3 1000 mm (46 %)             2-door cabinet, sink bowl with a faucet
    → 3 base units, 5 doors, 0 drawers.
  WALL ROW (780 mm high, starts at the left corner):
    U1  900 mm  2-door cabinet
    U2  900 mm  2-door cabinet
    → 2 wall units, 4 doors.
COUNT CHECK: exactly 3 base units with 5 doors and 2 wall units with 4 doors — the same numbers IMAGE B shows.

REST OF THE WALL: the cabinets end at 61 % of the wall. Remove all existing furniture on the rest of the
wall (dark glossy kitchen cabinets with stainless hood) and leave it as a smooth finished empty wall,
with no demolition marks or ghost outlines.

MATERIALS: fronts Arc Flat White (#f4f4f0) matte; carcass and visible sides Arc Flat White;
countertop 12 mm Calacatta engineered stone.
HANDLES: none. Flat handleless fronts; base doors open by reaching behind the door edge.

DO NOT: add or remove any cabinet, door or drawer; add a dishwasher, refrigerator, oven or hood that is
not listed; keep any existing cabinet; add handles or knobs; open any door; change the camera;
add text, labels or watermarks.

OUTPUT: one photorealistic photograph of the finished room, 16:9.
```

숫자·제품명·기존 가구 설명은 **전부 자동으로** 채운다 — `design_spec` (구조·마감)과 ① 분석 결과(`existing`, 벽 폭).
템플릿 정본은 `workers/generate-api/src/prompts.js` 한 곳 [확인: CLAUDE.md 규약].
사진 분석이 실패해 기본값(3000×2400)일 때는 `61 % of the wall` 같은 비율 문장을 빼고 순서·개수만 남긴다 [결정].

### 4.3 품목별 차이 [결정]

| 품목 | FIXED GEOMETRY 에서 달라지는 것 |
|---|---|
| 싱크대 | BASE / WALL / TALL 세 줄, 가전 줄 (싱크·쿡탑·후드·식세기·냉장고) |
| 붙박이장 | 한 줄 — `W1..Wn` 통, 통마다 도어 수·서랍 수, 커튼박스·몰딩 |
| 냉장고장 | 냉장고 자리를 `OPENING` 으로 ("leave an empty opening for the refrigerator" / "fridge inside" — 요약의 값대로) |
| 수납장·신발장 | 한 줄, 선반형(open)은 "open shelving, no door" |

ㄱ자는 요약이 한 벽으로 편다 (notes 에 적힘). 입면 Ⓑ 도 편 모양으로 찍는다 — **글과 그림이 같은 모양을 말한다** [결정].

### 4.4 이미 있는 규칙은 그대로 [확인]

손잡이(매립형, 전 품목), 문 닫힘, 글자 금지, 공사현장 → 완공 방, 어두운 타일 → 밝은 무채색 —
지금 설치 프롬프트의 `SITE` · `WALL TILE` 문단을 그대로 옮긴다.

### 4.5 재시도는 하지 않는다 [결정 — §11-④]

한 번 그리고 ③ 검사 · ④ 대조 결과를 **기록만** 한다. 원가 약 240원 고정. 지금의 "QC 에 걸리면 1회 재시도" 도
`mode:'planner'` 에서는 끈다. 대조 결과가 쌓이면(§7) 재시도의 값을 따로 재서 다시 결정한다.

---

## 5. 렌더 입력 준비 — 플래너 쪽 [결정]

방은 사진이 보여 주므로 렌더는 **가구만** 또렷하면 된다. 가상 방은 만들지 않는다.

| 지금 | 문제 | 바꿀 것 (캡처 순간에만) |
|---|---|---|
| 배경 단색 `#f4efe7` + 바닥 판 + 그리드 | 모델이 선·판을 가구로 읽을 수 있다 | **흰 배경**, 그리드·바닥 판·원점 마커·배치 상자 숨김 |
| 가전은 반투명 상자 (opacity 0.35) | "없는 식세기·냉장고" 를 부른다 | **가전 대역**: 싱크볼·수전 막대·쿡탑 판·후드 상자·냉장고 몸체 — 불투명, 단순 형태, 회색 |
| 그림자 없음 (프러스텀 10mm) | 깊이가 안 읽힌다 | 프러스텀 수정 — **캡처에만** (§11-⑥) |
| 프리셋 front(12°)·iso(45°, 위에서) | iso 는 내려다보는 각 | **`massing` 프리셋**: 눈높이 1500mm, 30° 비껴, 화각 40° — 옆면·상판 앞코가 보이게 |
| 디테일 룩(예림 텍스처·PBR) | — | 그대로 (`pushLook/popLook`) |

정면 입면 Ⓑ 는 `front` 프리셋 그대로 (FOV 12°, 직교 근사). 크기: Ⓑ 긴 변 1536px PNG, Ⓒ 1024px JPEG.
`capturePixels` 가 이미 화면을 건드리지 않는 오프스크린 경로다 [확인].

**API (P1, 2026-10-08)** — `js/planner/planner-capture.js`
- Ⓑ `PlannerCapture.capture({ kind: 'front', longEdge: 1536, clean: true })`
- Ⓒ `PlannerCapture.capture({ kind: 'massing', longEdge: 1024, clean: true })` — 16:9, 세로 화각 23.14° (가로 40° 에서)
- 반환: `{ ok, kind, width, height, camera, blob, fileName, toneMapped, clean }`. `camera.clean = true` 가 남는다.
  blob 은 지금 PNG 뿐이다 — Ⓒ 의 JPEG 변환은 P5 가 한다.
- 흰 배경은 배경색이 아니라 **알파 0 으로 지우고 흰색 위에 얹는다** (`plannerCaptureOverWhite`). 흰색을 배경색으로
  넣으면 OutputPass 의 ACES 가 #e7e7e7 근처 회색으로 누른다.
- 가전 대역은 마커가 있는 섹션만 — 지금 `sink`·`hood` 둘 (`PLANNER_MARKER_SECTIONS`). 냉장고·식세기는 장 경로로 그려져
  마커가 없고, 쿡탑은 섹션이 없다. 대역 모양표(`plannerCaptureStandInSpec`)에는 다섯 다 있다.
- 그림자: 그림자 카메라를 경계에 맞추고 바닥(y=0)에 그림자만 받는 판(ShadowMaterial 0.22)을 깐다. 지금 조명
  `d1`(5000, 8000, 5000) 은 앞·오른쪽·위라 바닥 그림자는 대부분 가구 뒤로 떨어져 **옅다** [확인: 브라우저].

**방 사진 16:9** (§11-③): 패널이 업로드 때 가운데를 16:9 로 자르고 미리보기에 자른 테두리를 보여 준다.
세로 사진은 위아래가 많이 잘린다는 안내를 띄운다 [결정].

---

## 6. 워커 파이프라인

### 6.1 요청 계약 [결정]

```
POST /api/generate
{
  mode: 'planner',                       // 새 값. 없으면 지금 연출컷 경로 그대로 (ai-design.html)
  room_image, image_type,                // 16:9 로 잘린 방 사진
  category: 'sink',
  design_spec: { … },                    // 지금 계약 (design-spec-prompt.md) — wallRunMm·ceilingMm 포함
  renders: [
    { role: 'elevation', base64, mime: 'image/png'  },   // Ⓑ
    { role: 'massing',   base64, mime: 'image/jpeg' },   // Ⓒ
  ],
  variants: false
}
```

`realize` · `engine` · `control_*` 는 `mode:'planner'` 에서 받지 않는다 (§8). 렌더는 `inputs.renders[]` 로 버킷에 저장.

### 6.2 단계 [결정]

| 단계 | 지금 | `mode:'planner'` |
|---|---|---|
| ① 분석 | 방 사진 → 벽 JSON | **그대로** |
| ② 설치 | `[room, ...style refs]` + 범용/요약 프롬프트, 0.4 | `[room, Ⓑ, Ⓒ]` + **프롬프트 v2**, **0.2**, **16:9** |
| ③ 검사 | 결과 한 장, 걸리면 재시도 1회 | 결과 한 장, **기록만**. 새 코드 `existing_left`(남은 기존 가구) |
| ④ 역판독 | 결과 → 대조 | **그대로**. 남는 벽은 `open` 으로 읽히고 대조에서 빠진다 [확인: `verify.js` 가 open 을 뺀다] |
| ⑤ 완료 | base (+ 어긋나면 mockup) | base 한 장. **ok 가 아니면 `internal_only:true`** (§6.3) |

### 6.3 어긋난 결과는 내부 확인용 [결정 — §11-⑦]

| 곳 | ok | ok 가 아님 / 대조 실패 |
|---|---|---|
| 디테일 패널 | 이미지 + ✓ 대조 점수 | 이미지 + ⚠ 사유 + **"내부 확인용 — 고객 공유 불가"** 표시 + 정면 입면 Ⓑ 를 옆에 |
| 공유 링크 (`POST /:id/share`) | 발급 | **409** "도면과 다른 결과는 공유할 수 없습니다" |
| 내 연출컷 (`my-designs.html`) | 보임 | **숨김** (목록 쿼리에서 거름) |

`generations.options.internal_only` 에 둔다 — 새 열 없이 [결정]. 크레딧은 환불하지 않는다 (이미지는 나왔다).

### 6.4 비용 (1달러 1,400원) [확인: 공식 단가]

| 항목 | 호출 | 원 |
|---|---|---|
| 분석 (Gemini 텍스트, 사진 1장) | 1 | 약 7 |
| 설치 (Gemini 3 Pro Image 2K, 입력 3장) | 1 | 약 190 |
| 검사 (Gemini 텍스트) | 1 | 약 7 |
| 역판독 (Claude 비전) | 1 | 약 40 |
| **합계 — 재시도 없음** | | **약 245원 고정** |

크레딧 20 유지 (§11-④).

---

## 7. 어떻게 재고 고르나 [결정]

### 7.1 표본 — 방 사진 × 도면

방 사진이 배경이므로 표본 사진이 다시 필요하다. **빈 벽·공사현장 사진이 핵심**이다 — 실제 고객 상황.

| 방 사진 | 확보 |
|---|---|
| S1~S3 빈 벽·공사현장 | **[확인 필요 §12-1]** 실제 현장 사진 |
| S4 기존 주방 있는 정면 (포트폴리오 `kitchen-n7-1` 왼쪽 판) | 있음 — "기존 가구 지우기" 를 잰다 |
| S5 비스듬한 각도 (`kitchen-n6-1` 왼쪽 판) | 있음 |

| 도면 | 노리는 실패 |
|---|---|
| D1 싱크대 2200 — 하부 800·400·1000 + 상부 900·900 (첫 실측과 같은 도면) | 기준선 비교 |
| D2 싱크대 3600 — 서랍장 + 식세기 + 쿡탑·후드 | 서랍 수, 가전 순서 |
| D3 싱크대 + 키큰장 + 냉장고 자리 | TALL 줄, 빈 자리 |
| D4 붙박이장 3600 네 통 | 통 수, 도어 수 |
| D5 수납장 + 오픈 선반 | 오픈 칸에 문을 다는지 |

### 7.2 실험 팔

| 팔 | 모델이 받는 것 | 묻는 것 |
|---|---|---|
| T0 | 방 사진 + 지금의 요약 문단 (배포된 경로) | 기준선 |
| T1 | 방 사진 + **프롬프트 v2** (그림 없음) | 순수 프롬프트 엔지니어링의 값 |
| R1 | 방 사진 + 입면 Ⓑ + v2 | 입면 한 장의 값 |
| R2 | 방 사진 + Ⓑ + Ⓒ + v2 | 3/4 뷰의 값 |
| R3 | R2, 온도 0.4 | 온도의 영향 |

5 사진 × 5 도면 중 대표 조합 10개 × 5 팔 = 50 생성 ≈ **$7 ≈ 10,000원**. 연구 계정 크레딧으로 돈다.

### 7.3 채점

- **구조** — 역판독 `score/max`, ok 비율 (자동).
- **남은 기존 가구** — 검사 코드 `existing_left` 비율 (자동).
- **실사감** — 사람 쌍 비교: 같은 조합의 두 팔을 좌우 섞어 "고객에게 보여 주겠나" 하나만.

### 7.4 미리 정한 판정

| 관측 | 결론 |
|---|---|
| R1 또는 R2 의 ok 비율 ≥ 8/10 | 그 팔을 제품 기본으로 |
| T1 이 R1 과 점수 차 < 0.5 | 렌더 캡처를 빼고 글만 — 더 단순하다 |
| R2 가 R1 보다 ok 비율 +2 이상 | 3/4 뷰를 기본으로 |
| 어느 팔도 ok 비율 < 5/10 | 멈추고 보고 — 재시도 재검토(§4.5) 또는 렌더 품질(§5) |

---

## 8. 지우는 것 — "완전히 교체" [결정 — §11-⑤]

새 경로가 제품에서 도는 것을 확인한 **뒤에** 지운다 (P7). 순서를 거꾸로 하면 그 사이 디테일 단계가 빈다.

| 파일 | 지우는 것 |
|---|---|
| `js/planner/ai-photo.js` | 실사화 체크박스, 구조 조건 드롭존, `setControl`, `realize`·`engine`·`control_*` 본문 (방 사진 올리기는 **남긴다**) |
| `workers/generate-api/src/controlnet.js` + `test/controlnet.test.js` | 통째로 |
| `workers/generate-api/src/worker.js` | `realize`·`engine`·`control_image`·`control_size` 수신, control 업로드 |
| `workers/generate-api/src/job.js` | `engine` 분기, `mockup` 슬롯 |
| `workers/generate-api/src/prompts.js` | 실사화 분기(`GEOMETRY IS FIXED` 판), `REALIZE_QC_FIXES`(`flat_mockup`) |
| `js/planner/photo-solve.js` + 시험 + 벤치 2개 | 통째로 (어느 페이지도 싣지 않는다 [확인]) |
| `test-utils/photo-composite-bench.html`, `test-utils/fixtures/photo-composite/` | 통째로 |
| `wrangler.toml` | `CONTROLNET_*` 변수 |
| 시크릿 `FAL_KEY` | P7 배포 확인 뒤 사장님이 지운다 (대시보드 또는 `npx wrangler secret delete FAL_KEY`) |

git 이력에는 남는다.

---

## 9. 단계 — PR 단위

| # | 일 | 크기 | 브랜치 | 선행 |
|---|---|---|---|---|
| **P1** | 캡처: `massing` 프리셋 + 흰 배경·숨김 + 가전 대역 + 캡처 중 그림자 | M | `agent/planner-capture-massing` | — |
| **P2** | 워커 `mode:'planner'` — 계약, 프롬프트 v2, 온도 0.2·16:9, 재시도 끔, `existing_left`, `renders` 저장 | L | `agent/imggen-planner-mode` | — |
| **P3** | 내부 확인용 — `internal_only`, 공유 409, 내 연출컷 숨김 | S | `agent/imggen-internal-only` | P2 |
| **P4** | 평가 — 표본 조합 10개, 팔 5개 실행 스크립트, 결과표 (§7 에 기록) | M | `agent/imggen-planner-eval` | P1·P2 · 표본 사진 |
| **P5** | 패널 교체 — 방 사진 + 16:9 자르기 미리보기 + 버튼 하나, 자동 캡처, 결과·대조·내부용 표시 | M | `agent/planner-realize-panel` | P4 판정 |
| **P6** | 정리 — §8 삭제, 문서 갱신 | M | `agent/imggen-realize-cleanup` | P5 배포 확인 |

P1·P2 는 서로 안 겹쳐 **나란히** 간다. P4 의 판정(§7.4)이 P5 의 모양(Ⓒ 사용 여부)을 정한다.

---

## 10. 위험

1. **여전히 개수가 틀린다.** 조건 모델도 재시도도 없으니 보장은 없다. 그래서 어긋난 결과는 **고객에게 안 나간다**
   (§6.3). 내부 확인용 비율이 높으면 §7.4 판정대로 재시도를 다시 꺼낸다.
2. **기존 가구가 남는다.** 지우기는 모델의 일이라 보장이 없다. `existing_left` 검사로 재고, 빈 벽 표본으로 판정한다.
3. **렌더를 붙여 버린다.** 모델이 Ⓑ 를 사진에 붙이는 실패가 가능하다. "do not paste" 문장 + 흰 배경 렌더 + 검사 코드
   `flat_mockup` 을 이름만 바꿔 남긴다(`pasted_reference`).
4. **16:9 자르기.** 세로 사진은 벽이 잘릴 수 있다 — 미리보기로 사용자가 본다.
5. **붙박이장 내부.** 문이 닫힌 그림이라 통 안은 안 보인다 — 겉 도어 수만 대조한다 [확인: `layout.js`].
6. **모델 교체.** `gemini-3-pro-image` 가 바뀌면 P4 스크립트로 다시 잰다.

---

## 11. 결정 기록 — 2026-10-08 (채팅 선택)

| # | 질문 | 결정 | 계획에 반영된 곳 |
|---|---|---|---|
| ① | 디테일 단계에서 방 사진을 뺄지 | **"고객 방 사진은 그대로 배경으로"** | §0·§1·§3 — 방 사진이 편집 대상, 렌더는 참고 |
| ①′ | 도면이 벽보다 짧을 때 남는 벽 | **기존 가구 지우고 빈 벽** | §4.1-5 · §4.2 REST OF THE WALL · 검사 `existing_left` |
| ② | 배경 방 분위기 프리셋 | **나중에 정한다** | 방 사진이 배경이 되며 우선순위가 낮아졌다. P4 결과 뒤 다시 |
| ③ | 결과 비율 | **16:9** | §5 업로드 자르기 · §6.2 `aspectRatio` |
| ④ | 재시도와 크레딧 | **재시도 없이 20 유지** | §4.5 · §6.4 약 245원 고정 |
| ⑤ | ControlNet 코드와 `FAL_KEY` | **새 경로 확인 뒤 삭제** | §8 · P6 |
| ⑥ | 그림자를 평소 3D 화면에도 | **캡처에만** | §5 |
| ⑦ | 어긋난 결과 | **내부 확인용만** | §6.3 · P3 |

---

## 12. [확인 필요] — 남은 것

1. **빈 벽·공사현장 표본 사진 3장 이상** — 평가(P4)의 핵심 표본. 실제 현장 사진이어야 의미가 있다.
2. 그 사진의 연구용 보관 기간과 고객 동의.
3. 방 분위기 프리셋 (§11-②) — P4 결과를 보고.

---

## 13. 첫 걸음

**P1 · P2 를 나란히 시작한다.** 둘이 붙으면 S4(기존 주방 사진) × D1(첫 실측과 같은 도면)을 한 장 돌려
**같은 조건에서 첫 실측 0.45/3 과 나란히** 비교한다 — 기존 가구 지우기와 개수 지키기를 한 장으로 본다.
