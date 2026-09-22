# 플래너 구조 실사화 — 디테일 단계 이미지 생성 교체 계획 (울트라플랜)

> 작성: 2026-09-23 / 기준 커밋: `1af5b52` (origin/main)
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

**새 구조는 한 줄이다: 플래너가 스스로 찍은 3D 렌더를 모델에게 보여 주고, 설계된 프롬프트로
"이 장면을 사진으로 다시 찍은 것처럼" 만들게 한다.** 고객 방 사진은 받지 않는다. 합성도, 벽 검출도,
원근 맞추기도, 조건 모델(ControlNet)도 없다.

왜 이게 될 것인가 — 첫 실측(§2)이 실패한 이유는 **두 장면이 한 그림 안에서 싸웠기 때문**이다
(사진 속 기존 주방 + 얹은 도면). 새 구조에서는 그림 전체가 도면 하나다. 모델이 지킬 것과 바꿀 것이
갈리지 않는다: 형태는 전부 지키고, 표면(재질·빛·그림자)만 사진으로 바꾼다. 이미지 생성 모델이 가장
잘하는 편집이 바로 "렌더를 사진처럼" 이다.

구조의 정확도는 **네 겹**으로 지킨다: ① 렌더가 형태를 보여 주고, ② 프롬프트가 개수·순서를 번호로
못박고, ③ 결과를 기계가 역판독해 도면과 대조하고(이미 있다), ④ 어긋나면 **무엇이 틀렸는지 적어**
한 번 더 그린다.

---

## 1. 무엇을 바꾸고 무엇을 남기나 [결정]

| | 지금 (2026-09-22) | 새 구조 |
|---|---|---|
| 사용자 입력 | 방 사진(또는 합성본) 업로드 + 체크박스 + 조건 PNG | **없음. 버튼 하나** |
| 모델이 받는 그림 | 방 사진 / 합성본 / 윤곽선 | **플래너 3D 렌더 2장** (실내 원근 + 정면 입면) |
| 벽 치수의 출처 | 사진 분석 (AI 추정) | **도면** (배치 공간의 실치수) |
| 배경(방) | 고객 방 | 렌더가 가진 **가상 방**(벽·바닥·천장) |
| 엔진 | Gemini 실사화 / fal ControlNet | **Gemini 한 가지** (렌더 편집) |
| 결과 | 한 장 | 한 장 (+ 대조 점수) |

**남기는 것** — 이미 검증된 부품:

| 부품 | 파일 | 새 구조에서의 역할 |
|---|---|---|
| 도면 요약 `design_spec` | `js/planner/ai-photo.js` `plannerAiPhotoBuildSpec` | 프롬프트의 번호 목록, 대조의 정답 |
| 역판독 대조 | `workers/generate-api/src/verify.js` · `layout.js` | ③ 겹 — 그대로 |
| 요청 시간 제한 · 파이프라인 마감 | `gemini.js` · `job.js` (#722) | 그대로 |
| 추천안 끄기 (한 장) | `variants:false` (#715) | 그대로 |
| 렌더 캡처 | `js/planner/planner-capture.js` | ① 겹 — 프리셋 하나 추가 |
| 연출컷 경로 | `ai-design.html` | **건드리지 않는다** (방 사진 기반 서비스는 거기 남는다) |

**지우는 것** — §8 에 목록. 전부 디테일 단계 전용이었고 git 이력에 남는다.

---

## 2. 지금까지 확인한 것 — 이 설계의 근거 [확인]

| 사실 | 근거 |
|---|---|
| 글만으로는 개수·순서가 흔들린다 | 생성 편집 모델은 형상을 "비슷하게 다시 그린다" (Nano Banana 아이덴티티 0.434). `photo-composite-research.plan.md` §2.1 |
| Gemini 에는 구조를 강제할 파라미터가 없다 | 마스크·ControlNet 류는 Imagen 전용, 2026-08-17 종료. 같은 문서 §2.1 |
| **3D 프록시 렌더를 조건으로 주면 기하 오차가 5배 준다** | DIRECT (ICML 2026) Matching Error 98.9 → 17.8. 같은 문서 §2.1 |
| 여러 장을 줄 때는 **이름을 붙이고 역할을 문장으로** 준다 | Google 공식 가이드. 같은 문서 §2.7 |
| 합성 실측은 구조를 못 지켰다 | 잡 `116a8dd2`: 역판독 0.45/3, 도어 5→9, 없는 식세기·냉장고 생성. 같은 문서 §4.8 |
| 그 실패의 원인은 **장면 충돌** | 합성본이 벽 3600 중 2200 만 덮어 기존 장이 남았고, 모델은 남은 주방과 얹은 도면을 섞어 "완성된 주방"을 그렸다 |
| 역판독 채점기는 이미 돈다 | 모든 도면 요약 생성에서 자동, `layout.verify {ok, score, parts, issues}` |
| 역판독은 벽 사실 네 개만 쓴다 | `layout.js` 가 `wall_analysis` 에서 읽는 것은 `wallW·wallH·waterPct·exhaustPct` 뿐 — **전부 도면에서 계산된다** (§6.2) |

---

## 3. 새 구조 한눈에

```
[브라우저 · 디테일 단계]
  도면 ──► design_spec (모듈 번호·폭·도어/서랍 수·가전·예림 마감)
    │
    └──► 3D 씬 자동 캡처 2장 (사람 손 없음)
          ① interior : 눈높이 1500mm, 3/4 원근, 가상 방(벽·바닥·천장), 예림 텍스처, 그림자
          ② front    : 정면 입면 (직교에 가까움) — 개수 참고용
          │
          ▼ POST /api/generate  { mode:'planner', renders:[①,②], design_spec, variants:false }
[워커]
  접수 ─ 도면 요약 검증 → 크레딧 20 → 렌더 2장 버킷 저장 → 잡
  ① 분석      건너뛴다 — 벽 사실은 도면에서 계산 (§6.2)
  ② 실사화    Gemini 3 Pro Image · [렌더①, 렌더②] + 실사화 프롬프트 v2 (§4)
  ③ 검사      규칙 위반 + 렌더 티(`cg_look`)
  ④ 역판독    기본안을 읽어 도면과 대조 → ok / 점수 / 사유
  ④′ 어긋나면 사유를 번호로 적어 ② 를 한 번 더 (§4.5) → 둘 중 점수 높은 것
  ⑤ 완료      한 장 + 대조 결과
```

---

## 4. 프롬프트 설계 — 이 계획의 핵심

### 4.1 원칙 [결정]

1. **그림이 형태를, 글이 개수를 말한다.** 둘은 같은 도면에서 나왔으니 모순이 없다. 글은 그림을
   **가리키며** 말한다 ("IMAGE A shows exactly 3 base units") — 그림과 글이 서로를 확인한다.
2. **숫자는 문장이 아니라 번호 목록으로.** "왼쪽부터 서랍장, 도어장…" 대신 `L1 · L2 · L3` 처럼
   번호를 붙이고, **줄 끝에 합계를 두 번** 적는다 (단위 수, 도어 수). 모델은 목록의 개수를 문장보다 잘 센다.
3. **바꿀 것과 지킬 것을 둘 다 적는다.** Google 가이드: "Be explicit about what to keep exactly the same."
4. **이미지마다 이름과 역할.** `IMAGE A = SCENE (edit this)`, `IMAGE B = FRONT ELEVATION (count reference, do not copy its flat look)`.
5. **금지 목록은 짧고 구체적으로.** 첫 실측이 만든 실패(없는 가전, 늘어난 도어)를 그대로 이름으로 부른다.
6. **"렌더"가 아니라 "사진".** 출력이 CG 처럼 보이는 것이 이 방식의 두 번째 위험이다 — 카메라·렌즈·빛을
   사진 용어로 준다 (Google 권장: 서술형 + 사진 용어).
7. **온도를 낮춘다.** 지금 이미지 0.4 → 실사화는 **0.2** 로 시작 (§7 에서 잰다).

### 4.2 프롬프트 v2 초안 (영문 — 모델은 한국어 제품명을 못 읽는다 [확인: `nameEn` 필수])

```
You receive two images of the SAME kitchen design made in our 3D planner.
IMAGE A — SCENE: the view to turn into a photograph. Keep its camera, framing and every object.
IMAGE B — FRONT ELEVATION: the same cabinets seen straight on. Use it only to count and place parts.
          Do not copy its flat look and do not add it to the picture.

TASK: Re-render IMAGE A as a real interior photograph of this built-in kitchen, installed and finished.
Change only surfaces: materials, lighting, shadows, reflections, small real-world detail.
Do not change geometry.

FIXED GEOMETRY — left to right, exactly as the images show:
  BASE ROW (870 mm high, 2200 mm long):
    L1  800 mm  2-door cabinet
    L2  400 mm  single-door cabinet
    L3 1000 mm  2-door cabinet
    → 3 base units, 5 doors, 0 drawers in total.
  WALL ROW (780 mm high, starts at the left end):
    U1  900 mm  2-door cabinet
    U2  900 mm  2-door cabinet
    → 2 wall units, 4 doors in total.
  APPLIANCES: sink bowl in L3 with a faucet behind it. No other appliance.

COUNT CHECK: the photo must show exactly 3 base units with 5 doors and 2 wall units with 4 doors —
the same numbers IMAGE A and IMAGE B show.

MATERIALS: fronts Arc Flat White (#f4f4f0) matte; carcass and visible sides Arc Flat White;
countertop 12 mm Calacatta engineered stone.
HANDLES: none. Flat handleless fronts; base doors open by reaching behind the door edge.

ROOM: keep the room of IMAGE A — its walls, floor, ceiling and window positions. Finish them as a real
apartment: smooth light walls, the same floor colour, a light neutral backsplash between the rows.
CAMERA AND LIGHT: 24 mm lens at eye level as in IMAGE A, soft daylight from the left, natural exposure,
contact shadows under the base row and along the countertop edge.

DO NOT: add or remove any cabinet, door or drawer; add a dishwasher, refrigerator, oven or hood that is
not listed; add handles or knobs; open any door; change the camera; add text, labels or watermarks.

OUTPUT: one photorealistic photograph, not a 3D render.
```

위 숫자와 제품명은 **전부 `design_spec` 에서 자동으로 채운다.** 사람이 쓰는 칸이 없다.
템플릿 정본은 `workers/generate-api/src/prompts.js` 한 곳 [확인: CLAUDE.md 규약].

### 4.3 품목별 차이 [결정]

| 품목 | FIXED GEOMETRY 에서 달라지는 것 |
|---|---|
| 싱크대 | BASE / WALL / TALL 세 줄, 가전 줄 (싱크·쿡탑·후드·식세기·냉장고) |
| 붙박이장 | 한 줄 — `W1..Wn` 통, 통마다 도어 수·서랍 수, 커튼박스·몰딩 |
| 냉장고장 | 냉장고 자리를 `OPENING` 으로 명시 ("leave an empty opening, do not draw a fridge" 또는 "fridge inside" 선택) |
| 수납장·신발장 | 한 줄, 선반형(open)은 "open shelving, no door" |

ㄱ자는 한 벽으로 편 도면을 보낸다 (지금 요약도 그렇게 한다, notes 에 적힘) — 렌더 ① 은 실제 ㄱ자로 찍히므로
글의 "한 벽" 과 그림이 어긋난다. **ㄱ자는 P5 에서 따로 잰다** [결정].

### 4.4 이미 있는 규칙은 그대로 [확인]

손잡이(매립형, 전 품목), 문 닫힘, 글자 금지 — `CLAUDE.md` 손잡이 규칙과 지금 설치 프롬프트의 문장을 그대로 옮긴다.

### 4.5 어긋났을 때 — 사유를 번호로 적어 다시 그린다 [결정]

지금 재시도는 QC 코드 이름에 붙은 **일반 문장**을 붙인다 ("Rebuild the run to match LAYOUT…").
새 구조는 역판독 결과로 **이번 그림에서 무엇이 틀렸는지**를 쓴다:

```
FIX (the previous attempt drew the wrong structure):
- BASE ROW: you drew 9 doors; the design has exactly 5 (L1 2, L2 1, L3 2).
- WALL ROW: you drew 8 doors; the design has exactly 4 (U1 2, U2 2).
- You added a dishwasher and a refrigerator. Remove both; they are not in the design.
```

`verify.js` 가 이미 `expected` · `read` · `issues` 를 낸다 — 문장만 만들면 된다.
재시도 결과도 다시 대조하고, **둘 중 점수가 높은 것**을 낸다 (지금은 재시도본을 다시 안 잰다 [확인]).

---

## 5. 렌더 입력 준비 — 플래너 쪽 [결정]

모델에게 보여 줄 그림이 좋을수록 결과가 좋다. 지금 3D 씬은 **작업용 화면**이라 그대로는 약하다 [확인]:

| 지금 | 문제 | 바꿀 것 |
|---|---|---|
| 배경 단색 `#f4efe7`, 벽·천장 없음 (바닥 판 하나) | 모델이 방을 통째로 지어내야 한다 | **가상 방 껍데기**: 뒷벽·옆벽 하나·바닥·천장(`ceilingHeight`) — 캡처 동안만 |
| 그리드·원점 마커·배치 상자가 찍힌다 | 모델이 선과 상자를 가구로 읽을 수 있다 | 캡처 동안 숨김 |
| 가전은 반투명 상자 (`buildMarkerMesh` opacity 0.35) | "없는 식세기·냉장고" 를 부른다 | **가전 대역**: 싱크볼·수전 막대·쿡탑 판·후드 상자·냉장고 몸체 — 불투명, 단순 형태 |
| 그림자가 안 그려진다 (프러스텀 10mm) | 입체감이 약해 CG 티 | `docs/02-design/features/shadow-frustum.md` 수정 적용 |
| 프리셋은 front(12°)·iso(45°, 위에서 내려다봄) | 실내 사진 시점이 아니다 | **`interior` 프리셋**: 높이 1500mm, 가로 화각 ~70°(24mm 상당), 런 중심을 향해 25° 비껴 |
| 디테일 룩(예림 텍스처·PBR)은 캡처 한 장 동안만 켜진다 | — | 그대로 쓴다 (`pushLook/popLook`) |

**모두 캡처 순간에만** 켜지고 꺼진다 — 작업 화면은 바뀌지 않는다. `planner-capture.js` 의
`capturePixels` 가 이미 화면을 건드리지 않는 오프스크린 경로다 [확인].

렌더 크기: 긴 변 1536px JPEG(①), 1024px PNG(②). 비율은 ① 을 **16:9** 로 [확인 필요 §11-3].

---

## 6. 워커 파이프라인 교체

### 6.1 요청 계약 [결정]

```
POST /api/generate
{
  mode: 'planner',                       // 새 값. 없으면 지금 연출컷 경로 그대로 (ai-design.html)
  category: 'sink',
  design_spec: { … },                    // 지금과 같은 계약 (design-spec-prompt.md)
  renders: [
    { role: 'scene',     base64, mime: 'image/jpeg', camera: {…} },   // ① interior
    { role: 'elevation', base64, mime: 'image/png',  camera: {…} },   // ② front
  ],
  variants: false
}
```

`room_image` 는 `mode:'planner'` 에서 받지 않는다. `realize` · `engine` · `control_*` 도 받지 않는다 (§8).

### 6.2 벽 사실을 도면에서 계산한다 [결정]

분석 단계를 건너뛰므로 `wall_analysis` 를 도면으로 채운다. 역판독(`layout.js`)이 쓰는 네 값이 전부 여기서 나온다:

| 값 | 계산 |
|---|---|
| `wallW` | `design_spec.wallRunMm` |
| `wallH` | 천장 높이 (`ceilingHeight`, 요약에 추가) |
| `waterPct` | 싱크 가전의 중심 ÷ 런 폭 |
| `exhaustPct` | 후드(없으면 쿡탑)의 중심 ÷ 런 폭 |
| `confidence` | `'plan'` (사진 추정이 아님을 표시) |

견적(`quote.js`)도 이 `wallW` 를 쓴다 — 사진 추정보다 정확하다.

### 6.3 단계 [결정]

| 단계 | 지금 | 새 구조 (`mode:'planner'`) |
|---|---|---|
| ① 분석 | 방 사진 → 벽 JSON (Gemini 텍스트) | **건너뜀** — §6.2 |
| ② 설치 | 방 사진 편집 | **렌더 ① 편집**, 렌더 ② 참고 · 프롬프트 v2 · 온도 0.2 |
| ③ 검사 | 결과 한 장 | 같음 + `cg_look`(렌더처럼 보임) 코드. `room_changed` 는 "렌더의 방이 바뀜" 으로 뜻을 바꾼다 |
| ④ 역판독 | 결과 한 장 | 같음 — 사실은 §6.2 |
| ④′ 재시도 | QC 에 걸리면 일반 FIX 로 1회 | **대조가 ok 가 아니면** 사유 FIX(§4.5)로 1회, 재시도본도 대조, 높은 점수를 채택 |
| ⑤ 완료 | base (+ 어긋나면 mockup) | base 한 장 + `layout.verify`. mockup 슬롯 없음 — 대신 **렌더 ① 을 `plan` 슬롯**으로 같이 돌려준다 ("도면 그대로" 는 이제 렌더다) |

### 6.4 비용 (1달러 1,400원) [확인: 공식 단가]

| 경우 | 이미지 호출 | 텍스트·비전 | 합계 |
|---|---|---|---|
| 한 번에 대조 통과 | 1 × $0.134 | 검사 + 역판독 ≈ $0.035 | **약 240원** |
| 재시도 1회 | 2 × $0.134 | 검사 + 역판독 2회 ≈ $0.07 | **약 470원** |

분석 호출이 빠져 지금보다 조금 싸다. 크레딧 20 유지 [확인 필요 §11-4].

---

## 7. 어떻게 재고 고르나 [결정]

### 7.1 평가 도면 8개

플래너 안에서 만든다 — 방 사진이 필요 없으니 **표본을 우리가 만들 수 있다**. 이게 새 구조의 큰 장점이다.

| # | 도면 | 노리는 실패 |
|---|---|---|
| D1 | 싱크대 2200, 하부 800·400·1000 + 상부 900·900 (첫 실측과 같은 도면) | 기준선 비교 |
| D2 | 싱크대 3600, 서랍장 포함 + 식세기 + 쿡탑·후드 | 서랍 수, 가전 순서 |
| D3 | 싱크대 + 키큰장 + 냉장고 자리 | TALL 줄, 빈 자리 |
| D4 | 상부장 없는 싱크대 | 없는 상부장을 그리는지 |
| D5 | 붙박이장 3600 네 통 (샘플) | 통 수, 도어 수 |
| D6 | 냉장고장 | 냉장고 자리 |
| D7 | 수납장 + 오픈 선반 | 오픈 칸에 문을 다는지 |
| D8 | 좁은 벽 1500 | 작은 도면에서 부풀리는지 |

### 7.2 실험 팔

| 팔 | 입력 | 묻는 것 |
|---|---|---|
| T0 | 글만 (프롬프트 v2, 그림 없음) | 순수 프롬프트 엔지니어링의 한계 |
| R1 | 렌더 ① + 글 | 그림 한 장의 값 |
| R2 | 렌더 ① ② + 글 | 입면 참고의 값 |
| R3 | R2 + 사유 FIX 재시도 | 재시도의 값 |
| R4 | R3, 온도 0.4 | 온도의 영향 |

8 도면 × 5 팔 ≈ 40 생성, 재시도 포함 약 55 이미지 ≈ **$9 ≈ 13,000원**. 연구 계정 크레딧으로 돈다.

### 7.3 채점

- **구조** — 역판독 `score/max` (자동). 이미 있다.
- **실사감** — 사람 쌍 비교: 같은 도면의 두 팔 결과를 좌우 섞어 "고객에게 보여 주겠나" 하나만 묻는다.
- **렌더 티** — 검사 코드 `cg_look` 비율 (자동).

### 7.4 미리 정한 판정

| 관측 | 결론 |
|---|---|
| R2 또는 R3 의 대조 ok 비율 ≥ 7/8 | 그 팔을 제품 기본으로 |
| T0 가 R1 과 대조 점수 차 < 0.5 | 렌더 캡처를 빼고 글만 — 더 단순하다 |
| R3 가 R2 보다 ok 비율 +2 이상 | 재시도를 기본으로 (비용 약 2배 감수) |
| 어느 팔도 ok 비율 < 5/8 | 멈추고 보고 — 렌더 품질(§5)부터 다시 |

---

## 8. 지우는 것 — "완전히 교체" [결정]

새 경로가 제품에서 도는 것을 확인한 **뒤에** 지운다 (P6). 순서를 거꾸로 하면 그 사이 디테일 단계가 빈다.

| 파일 | 지우는 것 | 줄 |
|---|---|---|
| `js/planner/ai-photo.js` | 방 사진 올리기·끌어놓기, 실사화 체크박스, 구조 조건 드롭존, `setFile`·`setControl`·`readImage` 사진 경로, `realize`·`engine`·`control_*` 본문 | 약 400 / 1345 |
| `workers/generate-api/src/controlnet.js` + 시험 | 통째로 | 190 + 시험 |
| `workers/generate-api/src/worker.js` | `realize`·`engine`·`control_image`·`control_size` 수신, control 업로드 | 약 40 |
| `workers/generate-api/src/job.js` | `engine` 분기, `mockup` 슬롯 | 약 30 |
| `workers/generate-api/src/prompts.js` | 실사화 분기(`GEOMETRY IS FIXED` 판), `REALIZE_QC_FIXES`(`flat_mockup`) | 약 40 |
| `js/planner/photo-solve.js` + 시험 + 벤치 2개 | 통째로 (어느 페이지도 싣지 않는다 [확인]) | 761 + 718 + 243 |
| `test-utils/photo-composite-bench.html`, `test-utils/fixtures/photo-composite/` | 통째로 | 220 + 이미지 2장 |
| `wrangler.toml` | `CONTROLNET_*` 변수 | 3 |
| 시크릿 | `FAL_KEY` — 사장님이 지운다 [확인 필요 §11-5] | — |

**남기는 것**: `design_spec` 계약과 검증, `verify.js`·`layout.js`, 시간 제한, `variants:false`,
연출컷(`ai-design.html`)의 방 사진 경로 전부. 연구 문서 두 개는 경위로 남긴다.

---

## 9. 단계 — PR 단위

| # | 일 | 크기 | 브랜치 | 선행 |
|---|---|---|---|---|
| **P1** | 캡처 `interior` 프리셋 + 가상 방 껍데기 + 가전 대역 + 캡처 중 그리드·마커 숨김 | M | `agent/planner-capture-interior` | — |
| **P2** | 그림자 프러스텀 수정 (평소 3D 화면에도 적용 — 별도 확인 [확인 필요 §11-6]) | S | `agent/planner-shadow-frustum` | — |
| **P3** | 워커 `mode:'planner'` — 요청 계약, 벽 사실 계산(§6.2), 프롬프트 v2, 온도, `cg_look`, `plan` 슬롯 | L | `agent/imggen-planner-mode` | — |
| **P4** | 사유 FIX 재시도 + 재시도본 대조 + 높은 점수 채택 | M | `agent/imggen-verify-retry` | P3 |
| **P5** | 평가: 도면 8개 저장본, 팔 5개 실행 스크립트, 결과표 — 계획서 §7 에 기록 | M | `agent/imggen-planner-eval` | P1·P3·P4 |
| **P6** | 패널 교체: 버튼 하나 「실사 이미지 만들기」, 자동 캡처, 결과·대조 표시 / 옛 UI 제거 | M | `agent/planner-realize-panel` | P5 판정 |
| **P7** | 정리: §8 목록 삭제, 문서 갱신 | M | `agent/imggen-realize-cleanup` | P6 배포 확인 |

P1·P2·P3 은 서로 안 겹쳐 **나란히** 간다. P5 의 판정(§7.4)이 P6 의 모양(재시도 기본 여부, 입면 사용 여부)을 정한다.

---

## 10. 위험

1. **여전히 개수가 틀린다.** 조건 모델이 없으니 보장은 없다. 네 겹(§0)으로 줄이고, 못 줄이면
   **숨기지 않는다** — 패널에 대조 결과를 그대로 보이고 렌더(`plan` 슬롯)를 옆에 둔다.
2. **CG 처럼 보인다.** 입력이 렌더라 출력이 렌더를 닮을 수 있다. 사진 용어 프롬프트 + 가상 방 +
   그림자 + `cg_look` 검사로 막는다. §7 의 실사감 쌍 비교가 판정한다.
3. **방이 고객 집이 아니다.** 이번 지시의 결과로 받아들이는 한계다. 연출컷(`ai-design.html`)이 방 사진
   서비스로 남는다. 방 분위기를 고르게 할지는 [확인 필요 §11-2].
4. **ㄱ자·다면 배치.** 요약은 한 벽으로 펴는데 렌더는 실제 모양이다. P5 에서 따로 잰다.
5. **붙박이장 내부.** 문이 닫힌 그림이라 통 안 구성은 안 보인다 — 겉 도어 수만 대조한다 [확인: `layout.js` 가 그렇게 합친다].
6. **모델 교체.** `gemini-3-pro-image` 가 바뀌면 다시 잰다 — P5 스크립트가 그대로 돈다.

---

## 11. [확인 필요] — 사장님 답이 필요한 것

1. **방 사진을 디테일 단계에서 완전히 빼는 것** 이 맞는지. 이 계획은 "사진 합성을 하지 말고" 를
   "디테일 단계는 방 사진을 받지 않는다" 로 읽었다. 방 사진 서비스는 연출컷에 남는다.
2. 배경 방의 분위기를 **글 프리셋**으로 고르게 할지 (예: 화이트 모던 / 우드 내추럴 / 그레이 톤다운) — 기본은 중립 밝은 방.
3. 이미지 비율 — 16:9 (가로로 넓은 주방에 유리) 또는 4:3.
4. 크레딧 20 유지 — 재시도를 기본으로 하면 원가가 약 470원까지 오른다.
5. **ControlNet 코드와 `FAL_KEY` 삭제** 동의 — 이 구조에서는 쓰지 않는다.
6. 그림자 수정(P2)을 평소 3D 화면에도 켤지 (`shadow-frustum.md`, 작업 카드 `task_24afcdcb`).
7. 대조가 어긋난 결과도 고객에게 보여 줄지, 아니면 내부 확인용으로만 둘지.

---

## 12. 첫 걸음

**P1 · P3 를 나란히 시작한다.** P1 이 좋은 렌더를, P3 가 그 렌더를 받을 워커 경로를 만든다.
둘이 붙으면 D1(첫 실측과 같은 도면)을 한 장 돌려 **같은 도면에서 합성 방식 0.45/3 과 나란히** 비교한다 —
그 한 장이 이 방향이 맞는지를 가장 싸게 알려 준다.
