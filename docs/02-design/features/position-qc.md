# 기본안 위치 검사 — 기록 전용 (position QC)

> 만드는 쪽: `workers/generate-api/src/position.js` (새 파일) · 붙는 곳: `src/job.js` 기본안 검사(QC) 다음
> 프롬프트·스키마·플래너 정답: `src/prompts.js` **맨 끝에 덧붙이기만** · Gemini 호출: `src/gemini.js` `callGemini` 선택 인자
> 시험: `test/position.test.js` (단위 + 잡 시험) · 결정: 사장님, 2026-10-20 "기본안 검사에 위치 검사(기록 전용)를 상시로"
> 근거 자료: 측정 파이프라인 1·2부(기본안 41장+)와 저장된 Flash 원응답 재생. **이미지·장별 측정값은 리포 밖**
> (`D:/ohouse/gen-eval3/` — 리포가 PUBLIC 이라 회사 이미지·건별 데이터는 넣지 않는다). 이 문서에는 합계 수치만 적는다.
> 판: 2026-10-20 비판 반영본 (must_fix 9건 전부 · should_fix 대부분 — §15 에 남은 것)
> 판: 2026-10-20 R2(84회) 검증·코드 검토 반영본 — 기록 `v: 2`. origin/main(b42eb671 — #938 도면 덩어리 ㄱ자 `PLANNER_PLACE_CORNERS` · #941 같은 방 벽 하나·뒷벽 모서리 고정 · #944 렌즈 판정) 위로 옮김.
> 바뀐 것: 도면 덩어리 앵커·런 틀·ㄱ자 보류(§2.3) · 덩어리 칠 자리 클램프 없음(§2.4) · 후드 세로 소실점·vz 지평선/정면 검사·vh 위치 검사·직선 2개 σ_u(§4·§5) ·
> 깊이 비율 범위(§2.2) · 과부하 건너뛰기·재실행 기록·alarm() doneAt 가드(§3.6·§7) · 기록 2 KB 보장(§6) · R2 결과(§5.5·§9·§11)

## 한 문단

싱크대·아일랜드 연출컷의 **기본안 1장**이 나오면, 그 그림에서 싱크·쿡탑·후드·하부장 줄 끝이 **지시한 자리**에
그려졌는지 mm 로 잰다. `gemini-3.8-flash` 를 **두 번**(전체 이미지 1 + 상판~상부장 띠 확대 1) 불러 점을 받고, 원근(벽 방향
소실점 vh·깊이 소실점 vz)을 VLM 점만으로 풀어 벽 %·런 % 로 바꾼 뒤 경로별 정답과 비교한다.
문턱(300 mm · 후드−쿡탑 150 mm)을 넘으면 **경보를 기록만** 한다 — 다시 그리지 않고, 상태·단계 라벨·진행률·크레딧·
완료 시각에 아무 영향이 없다. 결과는 `generations.images[]` 의 base 칸에 `qc` 옆 `position` 으로 남는다.
실패·시간 초과·판정 불가는 조용히 넘어가고 그 사실만 남긴다. 장당 약 0.7센트(≈ 9원, 실측 토큰 기준), 손님 대기 0.
경보는 **오프라인에서 검증된 경로(글 % · 일자 플래너)만** 내고, 나머지 경로는 측정만 한다(`ok:null`, 넘은 항목은 `shadow`).

```
설치(install) → QC (Flash, 그대로) → [재시도면 다시 설치] → 최종 기본안
                                                         └─ 위치 검사 시작 (기다리지 않음) ── 업로드·판독·추천안과 겹쳐 돈다
                                                              ① Flash 전체 이미지 → 점 30여 개
                                                              ② 점으로 띠 범위 → JPEG 디코드·자르기·2배 → JPEG q92 → Flash 띠 확대
                                                              ③ 합치기(띠 우선) → vz·vh → 벽 %·런 % → mm → 정답과 비교 → σ·보류·경계
                                                              ④ images[base].position ── done 패치에 함께, 늦으면 done 뒤 images 만 한 번 더
```

---

## 1. 목적·범위

| | 내용 |
|---|---|
| 왜 | 생성기가 지시를 어기는 일이 실제로 있다 — 플래너 일자 도면의 하부장 줄 오른끝 늘림(일자 15장 중 14장 + 쪽, 중앙 +223 mm), 옛 후드 칸 코드의 후드 +420~+458 mm, 분석이 못 읽은 아일랜드의 싱크·쿡탑 +373·+493 mm, 쿡탑에서 629 mm 떨어진 후드. QC(Flash 예/아니오)는 이 중 상당수를 통과시켰다. **얼마나 어긋났는지를 mm 로 상시 기록**해 프롬프트·공급자 변경(예: 2026-10-20 줄 길이 고정 #898, 도면 덩어리)의 효과를 숫자로 본다 |
| 대상 | 기본안(`slot:'base'`) 1장. 품목 `KITCHEN_CATEGORIES`(`sink`·`island`)만 |
| 대상 아님 | 추천안 v1~v3 (기본안 위치를 10 mm 안으로 물려받음이 측정됨) · 붙박이장·냉장고장·기타 품목 (호출 0, 기록 없음) · 꺼진 게이트 |
| 성격 | **기록 전용.** 재시도·QC 이슈 코드·`internal_only`·화면 표시·크레딧 어느 것도 바꾸지 않는다 |
| 켜고 끄기 | `wrangler.toml [vars] POSITION_QC`. 이 PR 은 `"off"` 로 넣는다 — `"on"` 은 §11.4 R2(경로별)·운영 CPU 여유 확인 뒤. 시험 ENV 기본 = 꺼짐 → 기존 잡 시험 그대로 |
| 경보 경로 | `POSITION_ALARM_ROUTES` (기본 `text_pct,planner`). 목록 밖 경로는 측정만(`ok:null`), 넘은 항목 이름은 `shadow[]` |
| ok 규칙 (2026-10-20 결정) | 플래너 계열(`planner`·`planner_walls`·`planner_place`)은 **도면 반대쪽 자유 끝**(왼쪽 앵커면 `run_right_wall`, 오른쪽 앵커면 `run_left_wall`)이 판정됐을 때만 `ok:true`. 경보가 있으면 `ok:false` 는 그대로, 자유 끝이 보류인데 경보도 없으면 `ok:null`. 근거: planner_place 재생(gen-eval3/place_validate)에서 줄을 600 mm 넘게 늘린 장이 줄 왼끝·런 안 싱크만 맞아 `ok:true` 로 찍혔다(잘못된 안심). 기록의 `freeEnd` 가 어느 끝인지 적는다 |

### 경로 판별 (잡 안에 이미 있는 조건만 쓴다)

| 순서 | 조건 | `route` | v1 경보 | 정답 |
|---|---|---|---|---|
| 0 | 품목이 `KITCHEN_CATEGORIES` 밖 · 게이트 꺼짐 | — | — | 호출 없음, `position` 키도 없음 |
| 1 | 플래너 + 도면 덩어리를 칠해 IMAGE A 로 줬음 (`placeImg` — `PLANNER_PLACE_GUIDE='on'`·빈 벽·Claude 키, 일자 또는 `PLANNER_PLACE_CORNERS='on'` 이면 ㄱ자·ㄷ자) | `planner_place` | 측정만 | **칠한 자리** (§2.3) > 도면 글 > 분석 wallW. ㄱ자·ㄷ자를 칠했으면 벽 기준은 `place_corner` 보류 |
| 2 | 플래너 + 꺾인 벽 `walls[]` | `planner_walls` | 측정만 | 주벽 줄만 (§2.2) — 재생 오경보 3/6, 런 틀 식도 이번에 고침 |
| 3 | 플래너 + 모양이 ㄱ자·ㄷ자인데 `walls[]` 없음 (한 줄로 편 도면) | `planner_unfolded` | 측정만 | 없음 |
| 4 | 플래너 (일자·모양 모름) | `planner` | **켬** | 도면 mm (§2.2) |
| 5 | `ctx.mockVolume && ck.guide.kind === 'kitchen'` (싱크대 덩어리 합성) | `mock_kitchen` | 측정만 | 칠한 자리 (§2.4). design_spec 이 같이 있으면 싱크·쿡탑은 `spec_conflict` 보류 |
| 6 | 플래너가 아닌데 `opts.design_spec` 있음 (옛 '도면 요약' 경로) | `spec_text` | 측정만 | 없음 — 프롬프트가 "photo wins — scale the run" |
| 7 | 그 밖 | `text_pct` | **켬** | 글 % (§2.1) |

재생 세트(42장)의 경로 분포는 플래너 20 · 글 % 11 · ㄱ자 4 · 덩어리 2 · 도면 덩어리 0 이다. 덩어리·도면 덩어리·ㄱ자는 분모가 작거나
(0/0) 오경보가 커서 운영 2주 집계 뒤 경로별로 켠다.

---

## 2. 경로별 정답

정답을 만들 수 없는 항목은 `expected` 에서 빠지고, 그 항목은 **측정만 기록하고 경보를 내지 않는다**.
도면 mm 는 주벽 좌표 — 0 = 모든 모듈의 왼쪽 끝(`js/planner/ai-photo.js`). `fromLeftMm` 은 **왼쪽 끝**(중심 아님).

### 2.1 글 % 경로 (`text_pct`)

설치 프롬프트(`CATEGORIES.sink.spec`)가 "Undermount sink about **waterPct**% of the way from the left", "cooktop about
**exhaustPct**% from the left with a slim concealed hood above it" 이라고 말한다. 그 % 가 정답이다 (분석이 못 읽어 기본값으로
지시했어도 지시값이 정답이다).

| 항목 | 정답 | 비교 |
|---|---|---|
| 싱크 `sink_wall` | `clamp(waterPct, 400/wallW·100, 100 − 400/wallW·100)` % (볼 반폭 400) | 벽 % 와 런 %(CBL~CBR) **둘 다** 문턱을 넘을 때만 경보 — 하나만 넘으면 보류 `frames` (냉장고·키큰장이 런을 줄인 장) |
| 쿡탑 `cook_wall` | `clamp(exhaustPct, 300/wallW·100, …)` % (반폭 300) | 같음 |
| 후드 `hood_cook` | 측정 쿡탑 중심 대비 (정답 0) | 벽 % × wallW. 벽 끝 문이 실패하면 σ0 × 1.5 (`approx`, 미검증 — R3) |
| 줄 끝 | 지시 없음 ("Straight kitchen run along the wall") | 측정만 |

- 싱크·쿡탑 지시 중심이 700 mm(400 + 300) 안이면 한 줄에 함께 놓일 수 없다 → 둘 다 보류 `conflict`.
- 문턱: 300 mm. 설치 문장은 %만 말하므로 '10 pp' 와 같은 뜻이다 — wallW 를 모르면(분석 실패) 기본값 3000 이 남아 10 pp = 300 mm.
  기록에 pp(`alerts[].pp`)를 함께 남긴다.

### 2.2 플래너 경로 (`planner`, `planner_walls`)

정답은 `opts.design_spec` + 분석 `wall.wallW`. 정답 계산은 **생성 프롬프트와 같은 코드**로 한다 — `prompts.js` 끝에 덧붙인
`plannerPositionFrame(spec, category, wall)` 이 같은 모듈의 비공개 `plannerRows`(가전 걸기·H1 쿡탑 포함)·`plannerWallGroups`·
`plannerLayout`·`isHoodCell` 을 부른다. `runAnchor`·`wallKnown`·`runShort` 는 `buildPlannerPrompt` 안 규칙의 복제이고,
시험이 같은 도면의 프롬프트 글(줄 길이 고정 문장 유무)과 대조한다 — 한쪽만 바뀌면 깨진다.

**런 틀 (상판 뒷선 끝 CBL·CBR 에 맞는 도면 mm `[R0, R1]`)**

| 경우 | R0 | R1 |
|---|---|---|
| 일자 | 하부 구간 `fromLeftMm` | `fromLeftMm + widthMm` (절대 좌표) |
| 줄 끝 모듈이 냉장고 칸(`kind appliance` + 냉장 이름, 냉장고장 단) | 그 칸을 뺀 첫 모듈 시작 | 뺀 마지막 모듈 끝 — 상판이 덮지 않는다 |
| 모듈 폭 합 < 구간 폭 − 50 (가운데가 끊긴 줄) | 런 틀 없음 (`run_gap`) | |
| ㄱ자 왼쪽 꺾임, corner `main`·`return` | 0 (상판은 모서리에서) | 하부 끝 |
| ㄱ자 왼쪽 꺾임, corner `open` | 하부 왼끝 | 하부 끝 |
| ㄱ자 오른쪽 꺾임, corner `main`·`open` | 하부 왼끝 | 하부 끝 |
| ㄱ자 오른쪽 꺾임, corner `return` | 하부 왼끝 | 하부 끝 + 꺾인 다리 하부 `depthMm` (없으면 `corner_depth` 보류) |
| 펼친 ㄱ자·ㄷ자 / 하부 없음 | 없음 (`unfolded` · `no_lower`) | |

재생 프레임(왼쪽 main, 하부 fromLeftMm 50 · widthMm 2349 → `[0, 2399]`)과 같은 식이다 (시험 고정).
`widthMm` 에는 끝 마감재(EP)가 들어 있지 않다 — EP 는 `wallRunMm` 에만 들고, 왼쪽 EP 가 있으면 `fromLeftMm = 20` 이다(±20~50 mm 정의 차).

**물체 정답 — 후보 둘을 다 기록**

| 물체 | 정답 `x` | 대안 `alt` (σ 에 `|x − alt|/2`) |
|---|---|---|
| 싱크 | `appliances[sink]` 중심 `fromLeftMm + widthMm/2` | 싱크가 걸린 하부 모듈 중심 (프롬프트가 실제로 말하는 것: "L3 …, sink bowl") |
| 쿡탑 | 도면 `cooktop` 가전 중심 | 걸린 모듈 중심 |
| 쿡탑 (도면에 없음 + H1 후드 칸) | **H1 중심** — 문장이 "directly under the hood H1" (`src: implied_h1`) | 그 밑 하부 모듈 중심 |
| 후드 | `appliances[hood]` 중심, 없으면 상부 줄 H1 칸 중심 (`src: appliance`·`h1`) | 걸린 상부 모듈 중심 |

**두 틀**

| 틀 | 계산 | 언제 판정하나 |
|---|---|---|
| 벽 기준 (`*_wall`, `run_left_wall`·`run_right_wall`) | 측정 벽 % × wallW ↔ 벽 X. `runAnchor 'left'` 면 X = x, `'right'` 면 X = wallW − runMm + x | `wallKnown` (아니면 `wall_unknown`) · `runAnchor` 있음 (`no_anchor`) · `runShort` (`scale_free`) · 벽 끝 문 통과 (`wall_end`) · QC `room_changed` 아님 |
| 런 기준 (`*_run`) | `R0 + (R1 − R0) · run% / 100` ↔ 도면 x | 런 틀 있음 · 끝점 판정 가능(§5.3) · 응답 layout 이 꺾임 아님 · **같은 물체의 벽 기준 항목이 판정되지 않았을 때만** |

- **벽 틀 우선** (must_fix): 줄 끝을 늘린 장에서는 벽 위 제자리인 싱크가 런 틀에서 반대쪽으로 옮겨진 것처럼 보인다(재생: 줄 오른끝 +284 → 런 싱크 −167, 벽 싱크 +31). 같은 물체의 벽 기준 항목이 판정되면 런 값은 기록만(`wall_frame`). 벽 기준이 보류면 런 틀이 판정하고 경보에 `frame:'run'`, 그 경보가 줄 끝 위반(|d| ≥ 150)과 부호가 반대면 `cause:'run_end'`.
- **분석 wallW 흔들림** (must_fix): 프롬프트가 mm 와 % 를 함께 주므로 생성기가 어느 쪽을 따랐는지 모른다 — 앵커에서 거리 D 인 점은 D·Δw/w 만큼 갈린다. 벽 기준 항목 σ² 에 `σ_w = D_anchor × 150 / wallW` 를 더한다(오른쪽 앵커면 오른쪽 모서리부터 잰 거리).
- 키큰장 쪽(`tallSide` — 하부 구간 기준 왼·오) 벽 끝이 상판 뒷선 끝 1 pp 안이면 벽 끝 문 실패(키큰장 옆면을 벽 끝으로).
- 후드 깊이 비율 `t` = `upper.depthMm / lower.depthMm` (없으면 350/650), **0.3~0.9 로 막는다** (v2). 도면 `depthMm` 은 몸통 깊이라
  상판 앞선 깊이(정본: 배치 공간 깊이 = 물끊기 10 + 도어 자리 20 + 몸통 + 뒤 여유, `docs/design-rules/corner.md`)보다 작다 — 비율이 10~18 % 커지고,
  상부가 하부 이상이면 1 을 넘어 투영이 발산한다. 상판 깊이를 지어내지 않고 수치 범위만 막는다(남는 차는 σ_t).
- 쿡탑 정답 출처 `src` 는 고른 값 그대로: `appliance`(가전 중심) · `module`(걸린 모듈 중심 대체) · `implied_h1` (v2 — 예전에는 `design` 으로 덮어 대체값을 가를 수 없었다).
- ㄱ자 `walls[]` 는 **주벽 줄만** 본다 (꺾인 벽 줄은 재지 않는다). v1 은 측정만.

### 2.3 도면 덩어리 (`planner_place`)

`planner-place.js` 가 칠한 자리가 정답 1순위다. `s = min(1, span / runMm)`, `span = cam.xR − cam.xL` (카메라로 푼 주벽 보이는 끝 —
분석 wallW 가 아님). 주벽 줄은 **앵커 쪽 벽 면**에 붙는다 (`plannerPlaceFaces` 와 같은 식, v2):

| `placeBlocks.anchor` | 칠 좌표 X (xL 기준 mm) | 언제 |
|---|---|---|
| 없음·`left` | `x · s` | 일자 · 왼쪽 꺾임(ㄱ자 왼쪽, ㄷ자) |
| `right` | `span − (rightMm − x) · s` | 오른쪽만 꺾이고 corner `main` (주벽 바닥 줄 오른끝 `rightMm` = 오른쪽 벽 면) |

프롬프트는 "keep each block's outer edges exactly where they are".

| 항목 | 정답 (span 틀, mm) |
|---|---|
| 줄 끝 `run_left_wall`·`run_right_wall` | **런 틀 `F.run` 을 X 로** (끝 냉장고 칸은 상판 밖, ㄱ자 왼쪽 꺾임은 모서리 0 — §2.2 표). 런 틀이 없으면 칠한 하부 덩어리 끝을 적되 그 사유(`run_gap` 등)로 보류 |
| 싱크·쿡탑·후드 `*_wall` | X(도면 x) |
| 런 기준 `*_run` | §2.2 그대로 (배율과 무관) |

- v1 은 줄 끝을 하부 덩어리 `x0·s`/`x1·s` 로 두어, 끝 냉장고 칸이 있으면 냉장고 폭(700~900 mm)만큼, 오른쪽 앵커면 `span − rightMm·s` 만큼,
  왼쪽 꺾임 corner `return` 이면 꺾인 다리 깊이만큼 틀렸다 (시험 고정).
- **충돌이면 벽 기준 보류 `place_conflict`**: 프롬프트의 `runShort`(분석 wallW 기준)와 칠(`runMm < span`)이 갈리거나, `|s − 1| > 0.03` 이거나,
  둘 다 짧은데 프롬프트의 줄 길이(runMm/wallW)를 칠 틀로 옮긴 값과 칠한 길이가 150 mm 넘게 다를 때 (예: wallW 3600 · span 3000 · runMm 3200 →
  프롬프트 89 %, 칠 100 %). 기록에 `expected.span`·`s`·`anchor` 를 남긴다.
- **ㄱ자·ㄷ자를 칠한 장(`placeBlocks.returns`)은 벽 기준 전부 `place_corner` 보류** (값은 기록). 측정 질의가 꺾인 다리 쪽 벽 끝·상판 끝을 어떻게 잡는지
  재생 근거가 0장이다. 런 기준은 §2.2 의 ㄱ자 규칙 그대로(측정만 경로). 기록 `expected.returns` = 꺾인 줄 수.
- `ck.place` 에는 `cam {f, hf, D, xL, xR}` 만 있고 회전·마스크가 없다 → 이미지 좌표 대조(§2.4 같은)는 못 한다. 하려면 job.js 1-d 가
  `ck.place` 에 칠한 하부 윗면 다각형(이름표 포함)을 함께 저장해야 한다 (§15). 재생 세트에 이 경로 그림이 0장이라 v1 은 측정만.

### 2.4 싱크대 덩어리 (`mock_kitchen`)

정답 = 칠한 자리. `wall_analysis.guide = { kind:'kitchen', cam:{xL, xR, …}, mask:[…] }`. 기본안을 **칠한 마스크의 이미지 좌표로 직접** 대조한다
(출력 자기 런으로 재지 않는다 — 줄이 사진 밖으로 나가면 CBL↔xL 대응이 성립하지 않는다).

- 마스크 순서 (`kitchenFaces` → `renderFacesMassing`, 문짝 틈 제외): 끝에서 cooktop `at(-1)` · sink `at(-2)` · counter-edge `at(-3)` · counter-top `at(-4)`.
  counter-top 점 `[0]` 뒤-왼(X = xL) · `[1]` 뒤-오(X = xR) · `[2]` 앞-오 · `[3]` 앞-왼. 시험이 가상 카메라로 이 순서를 못박는다.
- 마스크 vh = `[0]–[1]` 과 `[3]–[2]` 의 교점 → u. 측정점의 상판 뒷선 x(기본안 %) → `X = span · s_cr(x, ct0.x, ct1.x, u_mask)` (mm, xL 기준).

| 항목 | 정답 | σ0 |
|---|---|---|
| `sink_mask` | **칠한 자리 그대로** `span · waterPct/100` (모르면 30 %) | 115 (점 σ + 정합 1~2 %W) |
| `cook_mask` | 칠한 자리 그대로 `span · exhaustPct/100` (모르면 70 %) | 85 |
| `run_left_mask`·`run_right_mask` | 0 · span | 75 |
| `hood_cook` | 0 (둘 다 마스크 X) | 40 |

- v2: 예전 정답은 `clamp(…, 400, span − 400)`(쿡탑 300)였다 — "생성기는 안으로 당긴다" 는 정본에 없는 가정이라 뺐다(CLAUDE.md 임의 규칙 금지).
  `kitchenFaces` 는 클램프 없이 볼 ±400·쿡탑 ±300 을 칠한다. **칠한 볼·쿡탑이 상판 끝을 넘으면 그 항목 `mask_edge` 보류** — R1 재생 덩어리 2장은
  쿡탑 지시가 94~95 % 라 6회 모두 이 보류로 간다(측정만 경로라 경보 영향 없음). 클램프를 정답으로 되살릴지는 §14.
- 보류: design_spec 이 같이 있으면 싱크·쿡탑 `spec_conflict`(칠은 분석 %, 글은 도면 요약 자리) · 칠한 뒷선 끝이 사진 끝(x ≤ 1 %·≥ 99 %)이면 그 줄 끝 `mask_edge` ·
  기본안과 방 사진 가로세로비 차 > 1 % 면 `aspect` (`imageDimensions` 머리글만) · QC `room_changed`.
- 줄 끝(`run_*_mask`)은 방 사진과 기본안 사이 정합이 없다(R2: `mask_wall` 1.2~2.7 pp 드리프트 — 9f5bbc05 줄 오른끝 63 대 정답 318). 측정만 유지하고, 경보를 켜려면
  `mask_wall` 만큼 보정하거나 기본안 자기 벽 끝 기준을 함께 써야 한다.
- 기록만: 칠한 벽 끝 대비 기본안 WL·WR 차 `measured.mask_wall` (pp) — 생성기가 벽 모서리를 옮겼나.

### 2.5 정답 없음

`spec_text` · `planner_unfolded` · 하부 없음 → `expected` 가 비거나 전부 보류, `ok: null`. 측정값은 남겨 나중 집계에 쓴다.

---

## 3. Flash 호출

### 3.1 결정 — 2회 (전체 1 + 띠 확대 1)

저장된 Flash 원응답(측정 가능 33장 × 3회)을 워커와 같은 계산으로 재생한 비교 (옛 플래너 프롬프트 #898 이전·도면 덩어리 없음 기준):

| 변형 | 런 기준 싱크 \|오차\| p90 / 최대 | 벽 기준 싱크 p90 / 최대 | 줄 오른끝(벽) p90 / 최대 | vh(u) 오차 p90 / 최대 | 이미지 단위 오경보 |
|---|---|---|---|---|---|
| 전체 1회 | 151 / **1072** mm | 337 / 3355 | 510 / 7593 | 0.76 / 3.5 | 22 / 51 |
| 전체 + 띠 (벽 끝 문 없음) | 122 / 179 | 890 / 1571 | 1064 / 2195 | 0.17 / 0.38 | 22 / 51 |
| **전체 + 띠 + 벽 끝 문 (채택)** | **122 / 179** | **222 / 393** | **111 / 473** | 0.17 / 0.38 | **7 / 51** |
| + 도면 질의(DEPTH_LINES) 3회째 | 132 / 181 | 992 / 1584 | 1434 / 2195 | — | vz 이득 없음 |

- **1회만은 안 된다** — 전체 이미지만으로 푼 vh 가 폭주한다. 쿡탑 뒤-오른 모서리를 옆벽 쪽으로 잡는 버릇(+2.4 pp)도 띠에서 고쳐졌다.
- **3회째(도면 질의)는 넣지 않는다** — 한 질의에 섞으면 WR 이 상부장 앞면 끝으로 밀린다.

### 3.2 프롬프트 — 오프라인 검증본을 **글자 그대로**

`prompts.js` 끝: `buildPositionPrompt({ zoom })` = 정의(`[DEF_GEN_A, ITEM2_OLD, DEF_GEN_B, FLAGS_GEN]` 끝 줄바꿈 제거 후 `\n` 이음)
+ (zoom 이면 `\n\n` + 띠 문장) + `\n\n` + 좌표 문장. 문자열은 오프라인 소스에서 기계로 옮겼고(셸 heredoc 을 거치지 않음),
`md5(정의 + 좌표 + 띠 좌표).slice(0,10) === '7d7a7f69a5'` 를 시험이 고정한다. 정의 4,712자, 전부 ASCII, 역슬래시·`${` 없음.

- 상판 뒷선 문장은 옛것(ITEM2_OLD). 접합선 문장은 GPT 용이었다 — 뒷턱 윗선 오인은 기하(σ·보류)로 막는다.
- 머리말 `TASK: mark precise geometric landmarks …` 은 잡 시험 목업이 가로채는 머리말과 겹치지 않는다.

### 3.3 응답 스키마 (`POSITION_SCHEMA`)

오프라인 `geminiGenSchema(false)` 그대로 (대문자 형·`nullable`·`required` = `propertyOrdering` = 키 순서) — `test/fixtures/position-schema.json` 과 deepEqual.
키: `kitchen_installed`·`layout`·`content_x`·`WL`/`WR` {evidence, wall_type, flag, p}·`CBL CBR CFL CFR U1 U2` {flag, p}·`F`·`SINK` {flag, box, back_mid}·
`K` {kind, flag, BL, BR, FR, FL, box}·`HOOD` {hood_type, flag, HL, HR, box}·`notes`. 점 `[y, x]` 0~1000.

파서 `parsePositionLandmarks(text)` (prompts.js): 코드 울타리 제거 → `JSON.parse` → 객체가 아니면 `null`.
점 변환·검증은 `position.js toLandmarks`: 숫자 아님·범위 밖(visible 은 −10~1010, clipped·occluded 는 −250~1250, 되돌림 뒤 −25~125 %)·
순서 뒤집힘(WL ≥ WR, CBL ≥ CBR) → 그 점 `bad` → 그 점에 기대는 항목 보류 `bad_points`. 기록에 NaN·Infinity 가 들어가지 않는다(시험).

### 3.4 요청 설정 — 오프라인과 같은 조건

```js
callGemini(env, {
  prompt, images: [이미지 1장], want: 'text', model: env.POSITION_MODEL || 'gemini-3.8-flash',  // GEMINI_TEXT_MODEL 을 따라가지 않는다
  retryDelaysMs: [],            // callGemini 안의 과부하 재시도(10/30/60초, Retry-After 60초까지)를 끈다 — §3.6
  noTemperature: true,          // temperature 키 없음 (Gemini 3 기본값 — 오프라인이 넣지 않았다)
  extraConfig: { responseMimeType: 'application/json', responseSchema: POSITION_SCHEMA,
                 mediaResolution: 'MEDIA_RESOLUTION_HIGH', thinkingConfig: { thinkingLevel: 'low' }, maxOutputTokens: 8192 },
  signal: AbortSignal.timeout(남은 예산과 30초 중 작은 값),   // 모든 경로(gateway → direct → proxy)에 같은 신호 하나
  withMeta: true,               // thought 아닌 글 파트를 이어 붙이고 usage·finish
})
```

### 3.5 띠 자르기 (2차 이미지)

| | 규칙 |
|---|---|
| x | 점 {WL WR CBL CBR CFL CFR U1 U2 HL HR F K_BL K_FR} 중 absent 아닌 것의 x% 최소 − 4 ~ 최대 + 4 |
| y | 위 = {U1 U2 HL HR} 최소, 아래 = {CFL CFR K_FL K_FR CBL CBR WL WR} 최대. 한쪽만 있으면 ±18, 둘 다 없으면 35~65. 폭 = max(8, 아래−위), 위아래로 max(3, 폭×0.25) |
| 자름 | 0~100 으로 자르고 원본 픽셀로 반올림. 폭 < 5 %W 면 띠 생략 (`crop`) |
| 배율 | 2배 쌍선형, 긴 변 ≤ 3072 (`POSITION_ZOOM_SCALE` 로 R2 비교) |
| 인코딩 | **JPEG q92** (`jpeg-js` 인코더). 오프라인 조건(lanczos 2배·q92)에 가깝고 PNG(필터 없음 → 5~7 MB)보다 수십 배 작다(실측 0.2~0.3 MB). `POSITION_ZOOM_FORMAT='png'` 로 바꿀 수 있다 |
| 되돌림 | 원본 x% = (crop.x0 + x/1000 · crop.w) / W · 100 (y 도 같은 식) |

- jpeg-js 인코더는 끝에서 `Buffer.from` 을 부른다. 워커(`nodejs_compat` 없음)에는 Buffer 가 없어 **동기 호출 동안만** `Uint8Array` 로 대신한다
  (`encodeJpegBytes`). 워커 번들(esbuild CJS 래퍼에서 `module` 이 정의돼 그 줄로 간다)과 같은 조건을 로컬 `wrangler dev`(workerd, compat 2024-01-01)에서
  2K 기본안으로 확인했다 — 디코드·2배·JPEG 가 되고, 호출 뒤 전역 Buffer 는 다시 없다.
- 디코드는 `jpeg-js/lib/decoder.js` (`useTArray`). **바이트 머리(FF D8 FF)로 JPEG 를 판별**한다. JPEG 가 아니면(PNG — 리포에 PNG 디코더 없음) 2차 없이
  측정만(`nz:'not_jpeg'`). 6 MP 넘는 기본안은 CPU·메모리 때문에 띠 생략(`nz:'big'`). 디코드한 RGBA 는 띠를 만든 즉시 놓는다.

### 3.6 시간·재시도

| | 값 | 근거 |
|---|---|---|
| 호출당 상한 | 30초 — `signal` 하나를 모든 경로에 넘기고, 목·proxy 처럼 신호를 무시하는 경우를 위해 같은 시간의 `Promise.race` 도 건다 | 오프라인 지연 중앙 5.7 / 5.1초 |
| 전체 상한 | 시작부터 75초. 2차를 보낼 때 35초 미만이 남았으면 띠 생략(`budget`). 안전장치: 75 + 5초에 `error:'timeout'` 기록으로 풀린다 | 2회 합 중앙 약 11~13초 (R2 연기 시험 12.1·13.4초) |
| 재시도 | 429·500·503 만 **5초 뒤 1회** — `Retry-After`(최대 60초)를 따르지 않는다. 남은 예산이 35초 이상일 때만. 시간 초과·4xx·파싱 실패는 재시도 없음 | 기록 전용이라 과부하 때 오래 기다릴 이유가 없다 |
| 과부하 건너뛰기 (v2) | 같은 모델(`POSITION_MODEL`, 기본 Flash — QC·분석과 같은 키·할당량)이 **이 isolate 에서 최근 2분 안에** 429·5xx 를 받았으면(`gemini.js geminiOverloadAt(model)`, 모델별) 새 호출을 보내지 않는다: 1차 전이면 `error:'skipped_overload'`(호출 0), 띠 전이면 `nz:'overload'`(1차 값만, 측정만) | 손님 쪽 호출(10/30/60초 재시도)과 같은 할당량 — 과부하 때 위치 검사가 손님 대기를 늘리지 않게. 다른 isolate 의 과부하는 모른다 |
| 장당 최대 호출 | **4회** (전체 1 + 띠 1, 과부하 재시도 각 1). 알람 재실행(기본안 뒤 실패)은 같은 기본안을 다시 재지 않는다 — 기록이 없으면 `error:'rerun'` (§7) | 요구 '장당 1~2회' |

### 3.7 `gemini.js` 확장 (최소 변경)

`callGemini(env, { …기존…, extraConfig, noTemperature, signal, withMeta })` · `send(…, callerSignal)`.
넘기지 않으면 요청 바이트·응답 모양이 한 글자도 같다(시험: 기존 text·image 호출의 generationConfig). 기존 호출부는 새 인자를 쓰지 않는다(정적 시험 —
`temperature: null` 의미 변경도 없음: `null ?? 0.2` 는 그대로이고 새 플래그는 따로 있다).

---

## 4. 기하 (VLM 점만으로)

재생 도구(`sim_flash_only.py`)의 계산을 JS 순수 함수로 옮겼다. **R1(API 0) 대조: 126회차, 점·발 x 차 p90 0.004 pp · 최대 0.005 pp, u 일치, 누락 불일치 0.**
좌표는 픽셀(x% · W, y% · H)에서 계산하고 결과만 % 로 바꾼다.

1. 뒷선 `back` = CBL–CBR (없으면 WL–WR), 앞선 = CFL–CFR, 상부장 아랫선 = U1–U2.
2. **vh** = {back, front, U} 최소제곱 교점. `u = 100/(vh_x% − 50)`, `|vh_x − W/2| ≥ 5W` 또는 `|u| < 0.029` 면 선형(u = 0).
   - **vh 위치 검사 (v2)**: vh 가 유한하고 x 가 상판 뒷선 구간 `[CBL, CBR] ± 5 %W` 안이면 `vhBad` — 직선 위 점은 소실점 한쪽에만 맺히므로(사이면 카메라 뒤) 물리적으로 불가능하다.
     앞선 끝점 하나만 옆벽 쪽으로 잘못 찍혀도 선들이 이미지 안에서 만나고, 그러면 교차비 분모가 0 을 지나 375 %·−18 % 같은 값이 나온다 → 그 장 벽·런·후드−쿡탑 보류 `vh`.
3. **vz**: 쿡탑 옆변(K_BL→K_FL, K_BR→K_FR) 교점이 뒷선보다 1 %H 위·x −50~150 %W 안이면 우선, 상판 끝 선분은 그와 4° 안일 때만 더함. 최소제곱 후 잔차 2.5° 넘는 선분을 하나씩 뺀다. 해가 범위 밖이면 vz 없음.
   - **지평선 검사 (v2)**: vh 가 유한한데 `|vz.y − vh.y| > 8 %H` 면 vz 를 버린다 (`measured.vz_drop:'horizon'`). 두 점은 같은 지평선 위에 있어야 한다.
     R1 원응답 99회: 걸린 15회 모두 틀린 vz(융합 대비 > 5 pp), 맞는 vz 를 거른 것 0 (`gen-eval3/vz_check.json`). R2 오경보 0a802b7f·42e498eb 의 원인(vz y 40.9·16.2, 융합 약 49).
   - **정면 검사 (v2)**: vh 가 무한원(정면 벽)이면 깊이 방향이 광축과 거의 같아 vz 는 주점 세로줄 가까이 있다 (직교 `(vh−c)·(vz−c) = −f²` → vh 가 5W 밖이면 `|vz.x − c.x| ≤ f²/5W ≈ 폭의 10~17 %`).
     `|vz.x − 50 %| > 25 %W` 면 버린다 (`vz_drop:'frontal'`). R1 원응답 vh 무한원 43회: vz 오차 > 30 pp 3회(가운데에서 37·57·88 pp)를 모두 거르고, 맞는 vz(≤ 16.6 pp)는 거르지 않는다.
   - vz 를 버리면 상판 위 점은 투영하지 않고 Δ 이동 σ_z 를 쓴다(§5.2). Δ 도 없으면 `no_depth`.
4. **상판 위 점**(싱크 볼 뒷변 중점, 쿡탑 뒷변 두 모서리): `x_back = back ∩ line(vz, p)`. 뒷선보다 0.2 %H 넘게 위(뒤)면 투영하지 않는다. 카메라 pitch 와 무관(상판 평면 위).
5. **후드 앞선**(HL·HR, 깊이 비율 t) — v2 에서 세로 소실점으로 바꿨다. 예전(v1)은 후드 점과 이미지 x 만 같은 상판 위 점을 찾아 pitch 0(세로선이 이미지 세로)일 때만 맞았다
   (가상 방 정면: pitch 5° +17 mm · 10° +34 · 15° +52 · 20° +70 · −10° −34).
   - 세로 소실점 `vv = c + (f²/s)·(0, 1)`, s = 주점 c 에서 지평선까지 거리, **지평선 = vz 를 지나는 수평선(roll 0)**. vz–vh 를 이으면 먼 vh 의 y 오차가 roll 이 되어 vv 가 옆으로 크게 흔들렸다(R1 재생).
   - f: vh·vz 직교 `f² = −(vh−c)·(vz−c)` (kitchen.js 와 같은 범위 검사: 가정값의 0.5~2.2 배, |vh−c| < 2.5 대각선). 안 되면 가정 초점거리 — 덩어리 합성과 같은 `kitchen.js massingFocal(room_focal35, ck.lens)`: EXIF → 렌즈 판정(#944, 광각 13·표준 24 — 덩어리를 그린 잡에서만 묻는다) → 24 mm. job.js 는 `ck.lens` 를 위치 입력에 넘긴다.
   - 후드 점 p → 세로선 `p–vv` ∩ 상판 위 깊이 t 직선(뒷선 양끝의 깊이 t 점을 이은 선) = 상판 높이로 내린 점 → vz 쪽으로 뒷선에.
   - 가상 방: 사선(f 를 푼다)·정면 참 f 는 pitch −10~20° 에서 0 mm, 정면 가정 f(24 mm, 참 19.5 mm)는 옛 오차의 1/3 (pitch 10° +11 mm). pitch 0 이면 옛 값과 같다.
   - R1 원응답에서는 보정량이 대개 0.1~0.6 pp(5~18 mm)로 작다. 재생 정답(융합 측정)도 pitch 0 계산이라 이 보정을 검증하지 못한다 — 후드−쿡탑(정답 0 가정) rms 는 1.06 → 1.17 pp 로
     잡음 수준에서 엇갈렸다(사선 같은 방 묶음은 치우침 +0.14 → −0.05 pp). 그래서 **보정량의 절반을 σ_v 로** 더한다(§5.2).
6. 교차비 `s_cr(x, L, R, u) = 100·(x−L)/(R−L)·(u(R−50)−100)/(u(x−50)−100)` — 벽 % = (WL, WR), 런 % = (CBL, CBR).
7. **중심은 양 끝을 먼저 % 로 바꾼 뒤 평균**: 후드(HL·HR)와 **쿡탑(K_BL·K_BR — 이번에 바꿈)**. 재생의 옛 정의(이미지 중점 K_BM)는 대조용으로만 남긴다 — 사선(u≈−0.76)에서 약 +40 mm 치우쳤다.

---

## 5. 채점·경보

### 5.1 항목과 문턱

`d = 측정 − 정답`. 경보 = `|d| > 문턱` (보류가 아닐 때). 정확히 문턱이면 경보 아님(시험).

| 경로 | 항목 `k` | 틀 | 문턱 | σ0 |
|---|---|---|---|---|
| text_pct | `sink_wall` · `cook_wall` | 벽 (+ 런 동의 규칙) | 300 mm | 100 · 30 |
| 전 경로 | `hood_cook` | 벽(text) · 런(planner) · 마스크(mock) | 150 mm | 40 |
| planner* | `sink_wall` · `cook_wall` · `hood_wall` | 벽 | 300 | 100 · 30 · 25 |
| planner* | `run_left_wall` · `run_right_wall` | 벽 | 300 | 20 · 70 |
| planner* | `sink_run` · `cook_run` · `hood_run` | 런 (벽 항목 판정 시 기록만) | 300 | 90 · 40 · 30 |
| mock_kitchen | `sink_mask` · `cook_mask` · `run_left_mask` · `run_right_mask` | 마스크 | 300 | 115 · 85 · 75 · 75 |

### 5.2 σ (항목마다, mm)

```
σ² = max(σ0, σ_p)² + σ_u² + σ_z² + σ_t² + σ_v² + σ_w² + σ_alt²
```

| 성분 | 계산 |
|---|---|
| σ0 | 위 표 (재생 오차 — 중앙/0.674, 꼬리 두꺼운 줄 끝은 p90/1.645) |
| σ_p | **점마다 pp 오차를 그 자리의 mm 로** — 점 하나를 σ 만큼 옮겨 다시 재고(소실점 고정) 제곱합. 점 σ(pp) = VLM 대 블라인드 \|차\| 중앙/0.674: WL 0.21 · WR 0.34 · CBL 0.15 · CBR 0.47 · 싱크 0.53 · 쿡탑 모서리 0.42 · HL 0.25 · HR 0.37. 원근이 강한 벽의 먼 쪽에서 커진다 (σ0 를 바닥으로) |
| σ_u | {back∩front, back∩U, front∩U} 쌍별 u 로 다시 잰 범위/2 (직선 3개일 때). **직선 2개뿐이면(상부장 없음 등, v2)** 둘째 직선 끝점 y 를 ±0.3 %H 흔든 4개 u 로 다시 잰 범위/2 — y 오차 자료가 없어 점 σ(x)의 대표값 (R3). 예전에는 0 이라 앞선 끝점 하나가 틀린 장도 σ 가 커지지 않았다 |
| σ_z | vz 없을 때 상판 위 점: 끝 쌍의 앞뒤 어긋남 Δ(x) 를 보간해 (z/650)·Δ 만큼 옮긴 차 (z = 싱크 200 · 쿡탑 80, 후드는 t·650). vz 도 Δ 도 없으면 보류 `no_depth` |
| σ_t | 후드: t = 0.47 · 0.61 (chimney·separate_box 는 0.85) 로 다시 잰 차/2 |
| σ_v (v2) | 후드: 세로 소실점 보정량 \|보정 − 이미지 세로(옛 계산)\| / 2 (§4-5) |
| σ_w | 플래너 벽 기준: `D_anchor × 150 / wallW` (§2.2) |
| σ_alt | 플래너: 가전 중심 ↔ 걸린 모듈 중심 차/2 (§2.2) |

### 5.3 판정 보류 `measured.hold[k]`

| 사유 | 조건 |
|---|---|
| `no_zoom` | 띠 확대를 못 함(JPEG 아님·6 MP 초과·디코드·예산·과부하(v2)·2차 실패) → **모든 항목** 측정만. 사유는 `measured.nz` |
| `no_run` | `kitchen_installed:false` · layout `island_only`·`none` · 뒷선 없음 (풍경 사진 등 — 오경보 0 이 정답) → 측정만, `ok` 없음 |
| `conflict` · `spec_conflict` · `place_conflict` · `place_corner` · `mask_edge` · `no_mask` | 정답끼리 부딪힘·칠 정보 부족·ㄱ자 칠(벽 기준)·칠한 볼·쿡탑·줄 끝이 상판·사진 끝 (§2) |
| `vh` (v2) | 벽 방향 소실점이 상판 뒷선 구간 안·근처 (§4-2) — 벽·런·후드−쿡탑(마스크 대조 제외) |
| `wall_unknown` · `no_anchor` · `scale_free` | 플래너 벽 기준 조건 (§2.2) |
| `run_gap` · `corner_depth` · `unfolded` · `no_lower` | 런 틀을 만들 수 없음 (도면 덩어리 경로는 줄 끝 벽 기준도 이 사유로 보류 — §2.3) |
| `absent` · `bad_points` | 물체를 못 찾음(슬림 매립 후드는 놓치기 쉬워 "있을 때만") · 점 검증 실패 |
| `wall_end` | 벽 끝 문 실패 (벽 기준 항목) |
| `room_changed` | QC 가 `room_changed` 를 냈고 재시도하지 않은 그림 (벽·마스크 항목) — 시작을 QC 뒤로 옮겨 공짜로 안다 |
| `aspect` | 마스크 대조인데 가로세로비 차 > 1 % |
| `run_end_missing` · `run_end_clipped` | 런 틀·줄 끝: CBL·CBR 이 없음, 또는 **clipped 이거나 x ≤ 1 %·≥ 99 %** (사진 밖 추정 점에 틀이 묶인다) |
| `layout` | 도면(또는 글 %)이 일자인데 응답이 L_shape·U_shape — 런 기준만 보류 |
| `on_island` | 품목 island 이고 싱크·쿡탑이 상판 앞선보다 앞(아래) — 아일랜드 위 |
| `no_depth` | §5.2 |
| `wall_frame` · `frames` | §2.2 벽 틀 우선 · §2.1 런 동의 |
| `sd` | σ > 문턱/2 (300 mm 항목 150, 후드 75) |

### 5.4 경계·ok·경로

- 경계 `edge: true` = 경보이면서 `|d| − 문턱 < σ`.
- `ok`: `null` — 경보 경로가 아니거나 판정한 항목이 없음 · `false` — 경보가 하나라도(경계 포함) · `true` — 판정 항목이 있고 경보 없음.
- `alerts[]` = `{ k, d, thr, sd, edge, frame?, cause?, pp? }`, 순서는 §5.1. 경보 경로가 아니면 넘은 항목 이름만 `shadow[]`.

### 5.5 문턱 근거 — 측정 오차와 오경보 예상

> 아래 재생 수치는 **옛 플래너 프롬프트(#898 이전, 배율 문장)·도면 덩어리 없음** 기준이다. 줄 길이 고정(#898)·도면 덩어리 뒤에는
> 줄 끝 위반 빈도(곧 '기대 경보' 분포)가 달라진다 — 운영 집계로 다시 맞춘다.

**항목 단위 (워커 계산 = 전체+띠+문, 융합 측정 대비, 33장 × 3회)** — \|오차\| mm: 런 싱크 중앙 62 · p90 122 · 최대 179 / 런 쿡탑 25·82·138 /
런 후드 21·53·78 / 벽 줄 왼끝 0·24·124 / 벽 줄 오른끝 1·111·473 / **벽 싱크 66·222·393 (가장 약함)** / 벽 쿡탑 19·45·135 / 벽 후드 16·51·74.

**R1 — 워커 JS 채점 재생 (저장된 Flash 원응답, API 0, 이번 구현 그대로, 모든 경로 경보를 켠 채)**

| 항목 | 맞춘 경보 | 오경보 | 놓침 | 맞춘 무경보 | 보류 (주된 사유) |
|---|---|---|---|---|---|
| 글 % 싱크 | 0 | 1 (경계) | 0 | 10 | 19 (wall_end 16) |
| 글 % 쿡탑 | 0 | 0 | 0 | 13 | 17 (wall_end 16) |
| 글 % 후드−쿡탑 | 3 | 0 | 0 | 27 | 0 |
| 플래너 벽 싱크 | 2 | 3 | 1 | 9 | 36 (wall_end 30) |
| 플래너 벽 줄 오른끝 | 6 | 2 (경계, 돌출벽 방 정의 차) | 0 | 7 | 36 |
| 플래너 벽 줄 왼끝 | 0 | 0 | 0 | 21 | 30 |
| 플래너 런 싱크 | 0 | 0 | 0 | 34 | 17 (wall_frame 13) |
| 플래너 벽·런 후드 | 6 | 0 | 0 | 5 | 13 |
| 덩어리 마스크 4항목 | 0 | 0 | 3 (줄 오른끝, 정답 자체가 경계) | 21 | 0 |
| 덩어리 후드−쿡탑 | 4 | 0 | 2 (경계) | 0 | 0 |
| ㄱ자 런 싱크 | 5 | 3 | 0 | 2 | 2 |

**이미지 단위 (경보가 하나라도 났나):** v1 경보 경로(글 % + 일자 플래너) 무위반 47회 중 오경보 3회 — **3회 모두 경계 표시**(확정 오경보 0).
맞춤 15 · 놓침 18 (대부분 벽 끝 문이 막은 보류 — 보류는 "모름" 이지 "통과" 가 아니다). ㄱ자는 오경보 5/5 라 측정만으로 둔다.

**R2 — 실제 Flash 재생 (v1 코드, 42장 × 2회 = 84회, 이미지 생성 0, 정답 = 융합 측정 `replay_truth.json`)** — `gen-eval3/replay_report.json`

| | 결과 |
|---|---|
| 항목 오차 (판정한 것만, \|측정 − 융합\| 중앙/p90/최대 mm) | 글 %: 싱크 104/233/233 · 쿡탑 33/66/78 · 후드−쿡탑 11/22/46 / 플래너 벽: 싱크 82/144/144 · 줄 왼끝 0/24/24 · 줄 오른끝 18/141/141 · 후드 19/31/31 / 플래너 런: 싱크 36/76/224 · 후드 21/39/39 · 쿡탑 31/39/39 · 후드−쿡탑 6/20/20 / 덩어리: 싱크 15/45/45 · 쿡탑 40/89/89 · 줄 왼끝 19/35/35 · 줄 오른끝 127/255/255(정합 없음) / ㄱ자 런 싱크 121/160/160 |
| 보류까지 넣으면 | 플래너 벽 싱크 최대 1,634 · 줄 오른끝 최대 2,195 mm — 키큰장·냉장고 옆면을 벽 끝으로 18~30 pp 잘못 읽은 장, 모두 벽 끝 문이 막았다 |
| 이미지 점 x 오차 (pp, 중앙/p90/최대) | WL 0.1/1.15/7.7 · WR 0.15/7.6/30.2 · CBL 0.09/0.35/7.75 · CBR 0.1/1.85/6.4 · 싱크 0.8/1.77/2.65 · 쿡탑 모서리 0.1~0.2/0.25~0.5 · 후드 0.1/0.35~0.5. **싱크 점만 체계적으로 치우친다**: 사선(\|u\| > 0.5) −1.0 pp, 정면 +0.5 pp — 같은 응답의 수전 F 는 0.0 pp (§14) |
| 운영 경보 경로 재현율 (이미지) | 12/22 (글 % 4/6, 플래너 8/16). 판정하고도 놓친 이미지 0 — 놓친 10회는 모두 보류(벽 끝 문 7 · room_changed 2 · σ 1). 플래너에서 판정만 하면 8/8 |
| 오경보 (무위반 회차) | 3/32 (9.4 %), 모두 글 % 싱크 — 0a802b7f r1 −341~ · 42e498eb r2 −329~ (원인 vz, v2 지평선 검사로 막음) · 1a1b0425 r2 −511 (정답이 mm 로는 −278 경계, 10 pp 로는 −11.1 경보인 장). 플래너 0/18 |
| 벽 끝 문 (측정 가능 66회) | 통과 32회: 맞음 31·샘 1 / 닫힘 34회: 정당 14(열었으면 +900~+2,200 mm 오경보)·헛보류 20. 완화안 2종은 샘이 2 → 6·7 로 늘어 손해(`gate_variants.json`) — **문은 그대로** |
| 반복성 (같은 장 2회) | 경보 집합 같음 33/42 · ok 같음 34/42. 경로별 ok 같음: 글 % 6/11 · 플래너 19/20 · ㄱ자 2/4 · 덩어리 2/2. 갈린 9장 중 5장은 벽 끝 문이 회차마다 뒤집혔다. 점 x 회차 차 중앙 0.1~0.2 pp, 싱크 벽 mm 중앙 35·p90 209·최대 336 → **경보 한 건은 표본 하나** (§12) |
| §11.4 기준 | 글 % 확정 오경보 1/14 · 측정 불가 오경보 0 → 빠듯하게 통과 / 플래너 오경보 0 → 통과 (경계 아닌 진짜 줄 오른끝 경보 10회 중 맞춤 3·판정 놓침 1·보류로 잃음 6) |

**R2' — v2 코드, R2 의 오경보·놓침 사례만 다시 (실제 Flash, 13장 × 2회)**: 아래 §11.3 표.

---

## 6. 기록 형식 — `generations.images[]` base 칸의 `position`

`qc` 옆에 붙는다. **2 KB 이하**(시험), 저장 경로·URL·키·원응답·evidence 글 없음. 숫자는 % 소수 1자리, mm 정수.

(예시 값은 지어낸 것 — 실제 장의 값이 아니다)

```json
{
  "v": 2, "route": "planner", "ok": false,
  "alerts": [ { "k": "run_right_wall", "d": 420, "thr": 300, "sd": 140, "edge": true } ],
  "measured": {
    "kitchen": true, "layout": "straight", "zoom": true,
    "img":   { "WL": 30.0, "WR": 80.0, "CBL": 30.0, "CBR": 80.0, "sink": 65.0 },
    "types": { "WL": "corner", "WR": "corner", "hood": "none" },
    "u": -0.8, "vz": null,
    "gate":  { "ok": true },
    "wall_pct": { "runL": 0, "runR": 100, "sink": 75.0 }, "run_pct": { "sink": 75.0 },
    "mm":   { "sink_wall": 2000, "run_left_wall": 0, "run_right_wall": 2620, "sink_run": 1650 },
    "sd":   { "sink_wall": 140, "run_left_wall": 22, "run_right_wall": 140, "sink_run": 92 },
    "hold": { "sink_run": "wall_frame" }
  },
  "expected": { "wallW": 2620, "wall_known": true, "anchor": "left", "run": [0, 2200],
                "mm": { "sink_wall": 1700, "run_left_wall": 0, "run_right_wall": 2200, "sink_run": 1700 }, "src": { "sink": "appliance" } },
  "model": "gemini-3.8-flash", "calls": 2, "ms": 13000, "ms_decode": 0, "zoom_px": [1800, 1000],
  "tokens": { "in": 4800, "out": 800 }, "size": { "b": [1800, 2400], "r": [1200, 1600] }, "provider": "gemini"
}
```

| 필드 | 뜻 |
|---|---|
| `v` | 형식·질의(해시)·기하·문턱·σ 의 판. 바뀌면 올린다 — 집계는 판별로 |
| `route` | §1 경로 7종 |
| `ok` / `alerts` / `shadow` | §5.4 |
| `measured.img` | 합친 점의 이미지 x% (투영 전; `sink` = 볼 뒷변 중점, `kl`·`kr` = 쿡탑 뒷변 두 모서리, `F` = 수전 밑동 — v2, 싱크 측정점 결정용 기록만) |
| `measured.vz_drop` | (v2) vz 를 버린 사유 `horizon`·`frontal` (§4-3). 이때 `vz: null` |
| `measured.nz` | 띠 생략 사유 (`not_jpeg`·`big`·`crop`·`budget`·`overload`(v2)·`decode`·`parse_2`·`timeout_2`·`http_*`·`no_run`) |
| `measured.mm` / `sd` / `hold` | 항목별 측정 mm · σ · 보류 사유 (키는 §5.1) |
| `measured.mask_wall` | 덩어리: 칠한 벽 끝 대비 기본안 WL·WR 차 (pp) |
| `expected` | 정답 mm · 틀(`run`, `anchor`, `wallW`, `run_hold`, 덩어리 `span`·`mask_u`, 도면 덩어리 `span`·`s`·`returns`) · 출처(`src`) |
| `calls` · `ms` · `tokens` | 보낸 호출 수(재시도 포함) · 시작~기록 ms · usage 합(`out` = candidates + thoughts) |
| `ms_decode` · `zoom_px` | 띠 만들기 시간 · 띠 크기. **워커는 CPU 가 도는 동안 시계가 멈춘다**(I/O 에서만 흐름) — 운영 `ms_decode` 는 0 에 가깝고, CPU 는 `zoom_px`·`size` 로 Node 실측에서 환산한다 |
| `size` | 기본안 `b`·방 사진 `r` 의 [가로, 세로] |
| `provider` | 그린 공급자 (Gemini 가 정상으로 그려 칸에 표시가 없어도 `gemini`) |
| `error` | 코드만 — `timeout_1`·`timeout_2`·`http_429`·`http_5xx`·`http_4xx`·`net_1`·`net_2`·`parse_1`·`parse_2`·`decode`·`budget`·`no_image`·`internal`·`timeout`(안전장치)·`skipped_overload`(v2, 호출 0)·`rerun`(v2, 알람 재실행 — 다시 재지 않음, 호출 0) |
| `cut` | 2 KB 를 넘어 뺀 단계 수 — 빼는 순서: `sd` → `wall_pct`·`run_pct` → `img` → `types` → `expected.src` → `gate.why` → `size` → (v2) 경보 `{k, d, edge}` → 측정 `{zoom, nz, gate.ok, mm, hold}` → 정답 `{mm}` → 측정 `{zoom, nz, gate.ok}` → 경보 `{k, d}` → 정답 → 측정·shadow·tokens. 마지막까지 가면 13 항목 경보 `{k, d}` 와 머리 필드만 남아 **늘 2 KB 안** (최대 기록 시험) |

- 주인 `GET /api/generate/:id` 에는 `qc` 처럼 보인다(`PUBLIC_COLUMNS` 가 images 를 통째로) — 목록 API 로 손님 브라우저까지 모델·토큰·경보가 간다(키·URL·원응답은 없음).
  공유 응답·화면(label·url 만)에는 나가지 않는다. 숨기려면 worker.js 목록 응답에서 `position` 을 빼야 한다(이 PR 밖, §14).
- 로그 줄은 `[Job <id>] position <route> ok= alerts= error= calls= ms` — 잡 id 는 로그에만, 기록에는 없다.
- 옛 행·꺼진 게이트·주방 아닌 품목에는 `position` 키가 없다. 집계는 "키 없음" 과 `ok:null` 을 구별한다.

---

## 7. 호출 위치 — `job.js` (최소 변경)

```js
import { positionSkipped, startPositionCheck } from './position.js';   // 한 줄, ';' + 줄바꿈 (루트 jest loadEsm 이 지운다)

async alarm() {
  const ck = …ckpt…;
  if (ck.doneAt) { await deleteAll(); await deleteAlarm(); return; }   // v2: attempt 를 올리고 검사(fail)하기 **전에** — 아래
  ck.attempt += 1; …
}

async function runPipeline(env, job, ck, save) {
  …
  // ═══ 2. 설치 + 3. 검사 ═══
  let pos = null;
  const positionInput = (qc, provider) => ({ category, base, room, wall, options: opts, guide: ck.guide,
    mockVolume: !!ctx.mockVolume, place: placeImg ? ck.place : null, placeBlocks, qc, provider: provider || 'gemini', jobId: job.id, lens: ck.lens });
  if (!ck.images.base) {
    …설치 · QC · 재시도 그대로…
    pos = startPositionCheck(env, positionInput(qc, base.meta && base.meta.provider));   // 최종 기본안 — QC 결정 뒤, 업로드 전
    const up = await uploadObject(…base…);
    ck.images.base = { label, path, url, qc, ...(base.meta || {}) };
    if (pos) pos.attachTo(ck.images.base);        // 끝나는 순간 .position — 이후 images 패치에 slotList 가 저절로 싣는다
    …
  } else {
    base = await fetchObjectBase64(…);
    // v2: 알람 재실행은 같은 기본안을 다시 재지 않는다 (장당 호출 수). 기록이 없으면 그 사실만
    if (!ck.images.base.position) { const skipped = positionSkipped(env, positionInput(…), 'rerun'); if (skipped) ck.images.base.position = skipped; }
  }
  …
  // ═══ 5. 마무리 ═══
  const posLate = !!pos && !pos.done;            // 이 줄과 done 패치 객체 사이에 다른 await 없음 (시험)
  await updateById(… { status: 'done', …, images: slotList(ck.images), … });
  if (posLate) {                                 // 추천안 없는 경로에서만 생긴다
    await save({ doneAt: Date.now() });
    const cap = JOB_TIMEOUT_MS - (Date.now() - startedAt) - 20_000;
    if ((await pos.wait(cap)) && ck.images.base.position) await updateById(… { images: slotList(ck.images) });   // images 하나뿐
  }   // try/catch — 실패는 삼킨다
}
```

- **QC 결정 뒤 시작한다** (should_fix 반영). 재시도 장에서 첫 측정을 버리는 경합·두 번째 디코드·0.3~0.7센트 낭비가 없고, QC 와 같은 Flash 할당량을 같은 순간에
  나눠 쓰지 않는다(429 가 나면 QC 가 10/30/60초를 기다리던 것). 추천안 경로는 60초 넘게 여유가 있고, 플래너는 판독 20~60초 안에 끝난다.
- **늦은 패치**: `variants:false` 비플래너처럼 QC 직후 done 하는 경로에서만. `status`·`step_label` 이 없으므로 "done 패치는 하나" 와 DB CHECK 에 걸리지 않는다(시험).
  잡 마감 20초 전까지만 기다린다 — 넘기면 파이프라인 마감이 fail() 로 done 행을 덮는다.
- **doneAt 가드는 alarm() 첫머리** (v2, 검토 should): v1 은 `runPipeline` 첫 줄에 두어, 늦은 대기 중 배포로 DO 가 리셋되면 alarm() 이 그 전에
  `attempt > MAX_ATTEMPTS`·10분 초과를 검사해 `fail()` 로 끝난 행을 '완료 (추천안 일부 실패)'·error·새 completed_at 으로 덮을 수 있었다(이미 한 번 재시도한 잡·백오프로 10분을 넘긴 잡).
  이제 체크포인트에 `doneAt` 이 있으면 attempt 를 올리기 전에 storage 를 비우고 끝낸다 — PATCH 0 (시험: attempt 2 · 11분 지난 잡).
- **재실행**: 기본안 뒤에 실패해 다시 돌면(추천안·판독·패치 실패) 위치 기록은 체크포인트에 없을 수 있다(첫 시도의 기록은 메모리에서 끝났다).
  v1 은 다시 재서 한 잡이 최대 8회 호출했다 — v2 는 `error:'rerun'` 만 남기고 호출 0 (시험: 첫 시도 2회 뒤 재실행 0회).
- 시험: 게이트 켬/끔 잡의 상태·단계·진행률·크레딧 패치가 position 필드·늦은 images 패치만 빼고 같다 · QC 재시도 장은 두 번째 기본안을 잰다 · HTTP 오류여도 done ·
  붙박이장은 호출 0 · 늦은 패치는 images 만.
- `plumbing-pass2.test.js` 가 잘라 읽는 `askPlumbing` 근처, 덩어리 되붙이기(`baseMask`), 설치 입력 images 배열(냉장고 모델 사진 작업 예정)은 건드리지 않는다.

---

## 8. 실패 처리

모든 실패는 **조용히** — 로그 한 줄(`[position] route ok= alerts= error= calls= ms`) + `position.error` 코드. 잡 흐름에는 아무 영향이 없다.

| 상황 | 기록 |
|---|---|
| 1차 시간 초과·HTTP 오류(재시도 1회 뒤) | `error`, `calls`, `ms`, `expected` |
| 1차 JSON 깨짐·객체 아님 | `error:'parse_1'`, `ok:null` |
| 기본안이 JPEG 아님 · 6 MP 초과 · 디코드 실패 · 2차 실패·예산 부족 | 1차 값으로 `measured`, 전 항목 `no_zoom`, `nz` 사유 (디코드·2차 실패는 `error` 도) |
| 사진에 주방 없음 | `measured.nz:'no_run'`, `ok` 없음 |
| 기본안 머리글을 못 읽음 | `error:'decode'` |
| position.js 안의 예상 못 한 예외 · 목이 동기로 던짐 | `error:'internal'`/코드 — `runPositionCheck` 가 최상위에서 잡는다 |
| 내부 예산이 지켜지지 않음 (신호를 무시하는 경로) | 75 + 5초에 `error:'timeout'` 기록으로 풀림 |
| 같은 모델 최근 과부하 (v2) | 1차 전 `error:'skipped_overload'`(호출 0) · 띠 전 `nz:'overload'` (§3.6) |
| 알람 재실행 (v2) | 기록이 없으면 `error:'rerun'`(호출 0) — 다시 재지 않는다 |
| 잡 전체 실패(환불) | 위치 기록은 버려진다 |

---

## 9. 비용·지연·자원

| | 값 |
|---|---|
| 토큰 (R2 84회) | 장당 입력 약 4,795 · 출력 p50 769 · p90 914 · 최대 1,075 (thought 포함) |
| 단가 | `gemini-3.8-flash` 입력 $0.75 / 출력 $3.75 per 1M (**제3자 단가, 공식 미확인** — `tokens` 로 운영 재계산) |
| 장당 | R2 실측 약 **$0.0065(0.65센트)**, 최대 $0.0076 (84회 합 $0.55). 단가 2배여도 1.5센트 이하 — 예산 1~2센트 안 |
| 지연 | 손님 체감 **0**. 장당 p50 13.1 · p90 16.1 · 최대 38.8초, 호출당 p50 6.6 · p90 8.1 · 최대 19.4초 (기준 호출당 p90 ≤ 15초 통과). 공급자별 장당 p50: Gemini 그림 14.9 · GPT 그림 12.2초. 오류·시간 초과 0/84 |
| CPU (Node 실측, 같은 V8) | 띠 디코드·자르기·인코드 p50 285 ms · 최대 733 ms (띠 최대 3072×1575). 6 MP 초과는 띠 생략. **운영 GenerateJob 의 CPU p99 는 아직 못 봤다** — 켜기 전 확인. 띠 만들기는 동기 덩어리라 그동안 DO 이벤트 루프를 막고, 1차 응답 시점(기본안 뒤 10~20초)이 추천안 호출·되붙이기(같은 jpeg-js 로 2장 디코드 + 인코드)와 겹친다 — alarm CPU 30초 한도를 나눠 쓴다. 워커는 CPU 가 도는 동안 시계가 멈춰 `ms_decode` 로는 이 비용을 볼 수 없다(`zoom_px`·`size` 로 Node 실측에서 환산). 여유가 적으면 `POSITION_ZOOM_MAX_EDGE=2048`(v2, 띠 긴 변 상한 — 검증 조건에서 멀어지므로 재생으로 다시 본다) · `POSITION_ZOOM_SCALE=1` · `cpu_ms` 상향, 또는 추천안 경로에서 띠 만들기를 되붙이기 뒤로 미루는 안(미구현) |
| 기록 크기 (R2) | p50 951 B · 최대 1,380 B, 잘린 기록 0. v2 는 최대 기록도 2 KB 안을 보장(§6) |
| 메모리 | 2K RGBA 약 16 MB(잠깐) + 띠 RGBA 약 10 MB. 디코드 즉시 원본을 놓는다 |
| 요청 본문 | 2차 JPEG 0.2~0.3 MB (base64 4/3배) — proxy 경로도 부담 없음 |

---

## 10. 파일별 변경

| 파일 | 변경 | 규칙 |
|---|---|---|
| `src/position.js` (새) | 경로·정답·점 변환·띠·기하·채점·기록·`runPositionCheck`·`startPositionCheck`·`positionSkipped` | 순수 함수 export (오프라인 재생이 같은 함수). JPEG 인코드는 guide.js `encodeJpeg`(#927), 가정 초점거리는 kitchen.js `massingFocal`(#944) 을 같이 쓴다 |
| `src/prompts.js` | **맨 끝에 덧붙이기만**: 질의 문자열 6개, `positionDefinition`·`positionPromptHashSource`·`buildPositionPrompt`, `POSITION_SCHEMA`, `parsePositionLandmarks`, `plannerPositionFrame` | 기존 줄 수정 0 · import 없음 |
| `src/gemini.js` | `callGemini` 선택 인자 4개, `send` 의 호출자 신호, `withMeta` 응답, (v2) 모델별 과부하 시각 `geminiOverloadAt` | 넘기지 않으면 바이트 불변 |
| `src/job.js` | import 1줄 · (v2) `alarm()` 첫머리 doneAt 가드 · QC 다음 시작·attach(`jobId`·`lens`) · 재실행 분기(다시 재지 않음) · 마무리 늦은 패치 | QC 근처·alarm 첫머리·마무리만 (설치 입력 images 배열은 그대로) |
| `wrangler.toml` | `POSITION_QC = "off"` (+ 주석) | 켜기는 §11.4 뒤 |
| `test/position.test.js` · `test/fixtures/position-schema.json` | 62 시험 | |

---

## 11. 시험·검증

### 11.1 `test/position.test.js` (node --test, 62개 — v2 에서 16개 더함)

v2 에서 더한 것: **실제 보내는 질의 조립 전체의 해시**(전체 `b63d4b281b` · 띠 `6258986872` = 오프라인 `promptFor('gen', zoom, 'core')`) ·
**후드 세로 소실점**(가상 방 pitch 5~20°·−10°, 정면·사선, 참 f·가정 f, 옛 계산과 비교, σ_v) · **vz 지평선·정면 검사** · **vh 위치 검사**(벽·런·후드−쿡탑 보류) ·
**직선 2개 σ_u** · **도면 덩어리 ㄱ자**(upstream `plannerPlaceBlocks(spec, {corners:true})` — 오른쪽 앵커 X, 왼쪽 꺾임 줄 왼끝 0, place_corner) · **도면 덩어리 줄 끝 = 런 틀**(끝 냉장고 칸·run_gap 보류) ·
쿡탑 출처·깊이 비율 범위 · 가정 초점거리 = massingFocal(EXIF → 렌즈 → 24) · 덩어리 칠 자리 클램프 없음·mask_edge · 플래너 후드−쿡탑 σ0 ×1.5 · **최대 기록 2 KB** · **과부하 건너뛰기**(시작 전·띠 전) · positionSkipped ·
callGemini 모델별 과부하 시각·**지역 차단 전환 신호 2개(=)** · job.js 정적(alarm 첫머리 doneAt 가드·재실행 다시 재지 않음) ·
잡 5개 더(**추천안 있는 잡: 위치 호출 2회·done 하나·base 칸에만** · **알람 재실행은 다시 재지 않음 → rerun** · **doneAt 체크포인트 alarm 은 PATCH 0 (attempt 2·11분 지난 잡)** · **플래너 잡: 도면 덩어리 켬 → planner_place, 끔 → planner** · **QC 429 직후 → skipped_overload, 생성은 done**).

v1 부터 있던 것:

질의 해시·형태 · 스키마 fixture · 파서(울타리·깨짐·배열·null) · 직선·교점·최소제곱 · 교차비·선형 대체 · **가상 사선 방**(벽 % 0.2 pp 안: 싱크·쿡탑·후드 앞면,
선형이면 수 pp 틀림) · 가상 정면 방 · vz(쿡탑 우선·4° 제외·뒷선 아래 해 기각) · 뒷선 위 점 투영 생략 · 점 변환·되돌림 · 점 검증(bad) · 합치기 · 띠 범위 ·
**Buffer 없는 런타임의 JPEG 인코드** · 경로 판별 7종 · 글 % 클램프·conflict · 플래너 정답(fromLeftMm 왼쪽 끝·H1 쿡탑·후드 출처·깊이 비율) · 키큰장·끝 냉장고 칸·끊긴 줄 ·
**ㄱ자 corner main/return/open × 왼/오** · **정답 ↔ 프롬프트 대조**(7 도면) · 오른쪽 앵커 X·σ_w · **도면 덩어리 배율·충돌** · **덩어리 마스크 순서·교차비·spec_conflict** ·
채점(글 % 경보·경계·frames, 문턱 경계값, 후드−쿡탑, wall_end, **벽 틀 우선·cause run_end**, 보류 사유 묶음, 경보 경로 끄기·shadow, 벽 끝 문) · 기록(2 KB·URL 없음·유한 수·빼는 순서) ·
실행(두 호출의 인자, parse_1·parse_2·4xx, **429 Retry-After 60 → 5초 1회·예산 부족이면 안 함**, 시간 초과, PNG·6 MP·주방 아님·동기 throw·머리글 실패) ·
startPositionCheck(게이트·attach·wait·안전장치) · callGemini(기존 모양 불변·새 인자·thought 제외 이어 붙이기·**429 즉시 throw·지역 차단 전환도 같은 신호**) ·
기존 호출부 새 인자 미사용 · job.js 정적(QC 다음·업로드 전·추천안 밖·늦은 패치·가드) · 잡 5개(게이트 켬/끔 흐름 같음·늦은 패치·HTTP 오류·QC 재시도·붙박이장).

### 11.2 돌린 것

- 워커: `workers/generate-api` 에서 `npm test` — **501 통과** (origin/main b42eb671 기준 439 + 위치 62). **PR CI 에서는 돌지 않는다**(main push 의 worker-deploy 에서만) — 머지 뒤 배포 런을 확인한다.
- 루트 jest 중 워커 소스를 읽는 **12개** 스위트 (gen-import · generate-layout · generate-prompts · planner-ai-photo-fridge-model/-hood/-tiers/-walls ·
  planner-elevation-labels · plumbing-pass2 · test-marker-guard · wall-analysis-read · wall-manual-plumbing) — 173 통과.
- `wrangler deploy --dry-run` 번들 성공 (v2). 로컬 `wrangler dev`(workerd)의 디코드·띠·JPEG 확인은 v1 때 (JPEG 인코드는 이제 guide.js `encodeJpeg` — 추천안 되붙이기가 운영에서 쓰는 같은 함수).

### 11.3 오프라인 재현 — `D:/ohouse/gen-eval3/` (리포 밖)

| 단계 | 도구 | 상태 |
|---|---|---|
| R1 JS 재생 (API 0) | `tools/replay_r1.mjs` → `replay_r1_out.json`, `tools/r1_confusion.mjs` | **완료** — 기하 일치(§4), 혼동표 §5.5 |
| R2 실제 요청 (Flash 만, 이미지 생성 0) | `replay.mjs` (워커가 보낼 바이트 그대로 `runPositionCheck`) → `replay_out.json`, `tools/r2_analyze.mjs` → `replay_report.json` | **완료 (v1, 42장 × 2회)** — §5.5·§9 |
| R1' v2 재채점 (API 0) | `fix/r1_fix.mjs --src` (옛 코드 사본 `fix/before/src` · 새 코드) · `fix/r1_conf.mjs` | **완료** — 아래 |
| R2' v2 오경보·놓침 사례 재요청 | `fix/replay_fix.mjs` (13장 × 2회 = 26회, $0.17, 원응답 저장) → `fix/rescore.mjs` 로 **같은 원응답을 옛·새 코드로 채점** | **완료** — 아래 |
| R3 σ·보류 조정 | σ0·σ_z 의 z·후드−쿡탑 approx·점 σ·직선 2개 σ_u 의 y σ·세로 소실점 보정의 독립 정답 | 남음 |

**R1' (저장된 R1 원응답 126회, 옛 v1 ↔ 새 v2 같은 응답)**: 운영 경보 경로(글 %·일자 플래너)의 이미지 단위 결과는 같다(글 % tp3·fp1·fn6 · 플래너 tp12·fp2·fn12).
항목 차이는 플래너 벽 싱크 1회가 σ 보류로(직선 2개 σ_u), 런 싱크 1회가 판정으로(벽 틀 보류 → 런), 덩어리 쿡탑 6회가 `mask_edge` 보류로(칠한 쿡탑이 상판 끝을 넘는 장),
덩어리 후드−쿡탑 2회가 σ 보류로(정면 검사로 틀린 vz 를 버림) 바뀐 것뿐이다. 후드 값은 세로 소실점 보정으로 0.1~0.6 pp 움직였다(§4-5).

**R2' (실제 Flash 26회, 같은 원응답을 옛·새 코드로)**:

| | 옛 v1 | 새 v2 |
|---|---|---|
| 글 % 이미지 (10회) | tp 2 · fp 0 · fn 2 · tn 6 | 같다 |
| 일자 플래너 이미지 (10회) | tp 1 · fn 9 (전부 보류 — 벽 끝 문·room_changed·σ) | 같다 |
| ㄱ자 (4회, 측정만) | tp 2 · fp 2 (50c2de6f 런 싱크 −333~·−302~, 싱크 점 정의) | 같다 |
| 덩어리 (2회, 측정만) | 후드−쿡탑 tp 2 (−212·−151~) | 후드−쿡탑 2회 σ 보류 — 두 회차 모두 vz 가 틀려(가운데에서 29·45 pp, 융합 45.7) 정면 검사로 버렸다 |
| vz 를 버린 회차 | — | 5회 (지평선 3 · 정면 2), **5회 모두 융합 vz 와 10~45 pp 다른 틀린 vz** |
| 오류·시간 초과 · 지연 · 기록 | 0/26 | 0/26 · 장당 p50 12.3 · p90 14.1 · 최대 15.8초 · 기록 p50 962 B · 최대 1,401 B |

- **R2 의 글 % 오경보 3건(0a802b7f r1·42e498eb r2·1a1b0425 r2)은 R2' 표본에서 다시 나오지 않았다**(옛 코드로도 0) — 회차 변동이다. 그 세 회차의 원응답은 저장되지 않아
  같은 응답으로 v2 효과를 잴 수는 없다. 기록된 vz 로 보면 42e498eb r2(vz y 16.2, 같은 방 vh y 약 49)는 지평선 검사에 걸리고, 0a802b7f r1(40.9)은 경계, 1a1b0425 r2(42.8)는 걸리지 않는다.
- 운영 경보 경로의 판정 결과는 v1 과 같고, v2 의 차이는 **틀린 vz 를 버려 보류가 느는 쪽**(측정만 경로)이다.

### 11.4 켜기 전 통과 기준 (경로별 — must_fix)

| 경로 | 기준 (R2) |
|---|---|
| 글 % | 확정(경계 아님) 오경보 ≤ 1 / 무위반 회차 · 측정 불가 사진 오경보 0 |
| 일자 플래너 | 확정 오경보 ≤ 2 · 줄 오른끝 진짜 경보(경계 아님)를 보류로 잃는 수 기록 |
| ㄱ자 · 덩어리 · 도면 덩어리 | 측정만 유지 — 운영 2주 집계(장 수 ≥ 20) 뒤 경로별로 `POSITION_ALARM_ROUTES` 에 더한다 |
| 공급자 | GPT · Gemini 를 나눠 센다 (`provider`) |
| 공통 | 호출당 p90 ≤ 15초 · 오류율 ≤ 5 % · 운영 GenerateJob CPU 여유 |

---

## 12. 운영 후 집계

기록은 `generations.images` jsonb 안에만 있다. Supabase SQL 편집기(사장님 권한) 또는 로컬 서비스 키 스크립트로 본다.

```sql
-- 경로·공급자별 요약 (최근 14일, 판 v = 2 — 판이 다르면 섞지 않는다)
with b as (
  select g.id, g.created_at, e->'position' as p
  from generations g, jsonb_array_elements(g.images) e
  where e->>'slot' = 'base' and e ? 'position'
    and g.created_at > now() - interval '14 days'
    and (e->'position'->>'v')::int = 2
)
select p->>'route' as route, p->>'provider' as provider, count(*) as n,
       count(*) filter (where p->>'ok' = 'false') as alarmed,
       count(*) filter (where p->>'ok' = 'false'
                          and exists (select 1 from jsonb_array_elements(p->'alerts') a
                                      where (a->>'edge')::boolean is not true)) as alarmed_firm,
       count(*) filter (where jsonb_array_length(coalesce(p->'shadow', '[]'::jsonb)) > 0) as shadow,
       count(*) filter (where p->>'ok' is null) as undecided,
       count(*) filter (where p ? 'error') as errored,
       percentile_cont(0.9) within group (order by (p->>'ms')::int) as ms_p90,
       sum((p->'tokens'->>'in')::bigint) as tok_in, sum((p->'tokens'->>'out')::bigint) as tok_out
from b group by 1, 2 order by 3 desc;

-- 항목별 오차 분포 (경보 아닌 것까지 — 문턱 재조정용)
select p->>'route' as route, m.key as k, count(*) as n,
       percentile_cont(0.5) within group (order by (m.value)::numeric - (p->'expected'->'mm'->>m.key)::numeric) as d_med,
       percentile_cont(0.9) within group (order by abs((m.value)::numeric - (p->'expected'->'mm'->>m.key)::numeric)) as d_abs_p90
from b, jsonb_each_text(p->'measured'->'mm') m
where p->'expected'->'mm' ? m.key
group by 1, 2 order by 1, 2;

-- 보류 사유 · 띠 생략 사유 · 오류 코드
select p->>'route' as route, h.value as reason, count(*) from b, jsonb_each_text(p->'measured'->'hold') h group by 1, 2 order by 3 desc;
select p->'measured'->>'nz' as nz, count(*) from b where p->'measured' ? 'nz' group by 1;
select p->>'error' as code, count(*) from b where p ? 'error' group by 1;
```

- **경보 한 건은 표본 하나다** (R2 반복성: 같은 장 2회의 ok 일치 글 % 6/11 · 플래너 19/20). 집계에서 단건 경보를 확정으로 세지 않는다 — `edge`(경계)·`sd` 와 함께 보고,
  확정 정밀도는 2주 블라인드 눈 판정으로 낸다. 같은 장을 두 번 재 합의하는 안(2표본 합의)·seed 고정은 장당 비용·규칙이 바뀌므로 사장님 확인 뒤 v3 후보 (§14).
- 글 % 경로는 정답 정의상 300 mm 와 10 pp 가 갈리는 장이 있다(1a1b0425 −278 mm / −11.1 pp, 01bed548 −356 mm / −8.1 pp) — `alerts[].pp` 를 함께 남기고 어느 쪽을 기준으로 셀지는 §14.
- vz 를 버린 회차(`measured.vz_drop`)·과부하 건너뛰기(`error:'skipped_overload'`·`nz:'overload'`)·재실행(`error:'rerun'`) 비율을 따로 센다 — 보류가 늘어난 이유를 가른다.

| 주기 | 할 일 |
|---|---|
| 켠 뒤 2주 | 위 표. 오류율 > 5 % 면 원인 확인. `tokens` 로 실제 장당 비용, `zoom_px`·`size` 로 CPU 환산. Gemini 기본안 PNG 비율(`nz:'not_jpeg'`) 확인 |
| 2주 | 경보 장 전부 + 무경보 장 같은 수를 블라인드로 눈 판정 → 확정 경보 정밀도·경계 비율 → σ0·문턱·경보 경로 조정 → `v` 올림 |
| 매월 | 경로·공급자별 `run_right_wall`·`sink_*`·`hood_*` 의 `d` 중앙값 추이 — 프롬프트 변경 효과. `qc.issues`·`internal_only` 와 교차표 |

---

## 13. 하지 않는 것

- **다시 그리지 않는다.** 재시도·QC 이슈·`internal_only`·상태·단계 라벨·진행률·크레딧·환불·`elapsed_ms` 어느 것도 바꾸지 않는다.
- 추천안 v1~v3 · 붙박이장(덩어리 `guide.points` 포함)·냉장고장·기타 품목 · 꺾인 벽 줄·상부장 줄 끝·문짝 경계·키큰장 위치(도면 질의 3회째).
- GPT·ER2·Pro 심판, LSD 기하, 여러 회 반복 측정의 중앙값 — 워커는 Flash 2회 한 벌만.
- 원본 방 사진을 재서 분석 `waterPct`·`wallW` 가 맞는지 검사 — 지시값을 정답으로 본다.
- 화면·공유 응답·사용자 알림 · DB 스키마 변경 · 문턱·σ 자동 조정 · 프롬프트 글 손보기(바꾸면 R2 재검증 뒤 해시·`v` 를 함께).
- PNG 디코더 작성 (PNG 기본안은 측정만 — 운영 비율이 의미 있으면 `DecompressionStream` 디코드를 따로).

---

## 14. 상위 확인이 필요한 결정

1. **켜는 시점**: 이 PR 은 `POSITION_QC = "off"`. R2 전체(경로별 기준 §11.4)와 운영 CPU 여유 확인 뒤 `"on"` — 누가 언제 볼지.
2. **늦은 패치 허용**: 추천안 없는 경로에서 done 뒤 `images` 만 담은 PATCH 가 한 번 더 간다(구현함). 싫으면 그 경로는 done 전에 끝난 것만 기록.
3. **띠 배율**: 2배 JPEG q92(검증 조건에 가까움)로 했다. HIGH 해상도는 이미지 토큰이 고정이라 1배로도 같을 수 있다 — R2 에서 `--scale 1` 을 함께 재 볼지.
4. **벽 기준 판정 범위**: 엄격한 벽 끝 문으로 벽 기준 항목은 절반가량 보류된다(R1: 플래너 벽 항목 51회 중 30회 wall_end · R2: 닫힘 34회 중 헛보류 20).
   R2 오프라인 실험에서 완화안 2종은 손해였다(샘 2 → 6·7) — **문은 그대로 두기를 권한다**. 보류로 잃는 진짜 줄 오른끝 경보(6/10회)를 줄이려면 문이 차(diff)로만 닫힐 때 띠를 한 번 더 묻는
   3번째 호출 실험(장당 +50 % 비용)이 R3 후보.
5. **단가**: Flash 단가 공식 확인 (제3자 $0.75/$3.75).
6. **싱크 측정점 (v2 에서 바꾸지 않음)**: 지금은 '볼 뒷변 중점'(측정 교훈). R2 에서 Flash 의 볼 중점은 사선에서 −1.0 pp·정면 +0.5 pp 치우치고, 같은 응답의 수전 밑동 F 는 0.0 pp 였다.
   오프라인 시뮬(API 0)로 F 를 싱크 자리로 쓰면 싱크 항목 이미지 오경보 6 → 2(글 % 1 → 0, ㄱ자 3 → 0), 맞춤 7 → 7, 글 % 싱크 오차 중앙 76 → 42 · p90 176 → 101 mm (`gen-eval3/sink_variant.json`).
   (a) F 로 바꾸기 (b) 볼 중점과 F 가 1 pp 넘게 갈리면 보류 (c) 그대로 — 결정이 필요하다. v2 는 `measured.img.F` 를 함께 기록만 한다(바꾸면 판 v 를 올린다).
7. **글 % 문턱의 단위**: 설치 문장은 % 만 말한다. 정답 정의상 300 mm 와 10 pp 가 갈리는 장이 있다(§12) — 운영 집계를 mm 로 셀지 pp 로 셀지.
8. **덩어리 쿡탑·볼 정답의 클램프**: v2 는 칠한 자리 그대로(클램프 없음) + 상판 끝을 넘으면 `mask_edge` 보류(§2.4). "생성기는 안으로 당긴다" 를 정답으로 둘지(예전 v1) — 정본에 없는 가정이라 확인이 필요하다.
9. **2표본 합의·seed 고정**: 경보 한 건이 표본 하나라(§12) 같은 장을 두 번 재 합의하는 안은 장당 비용 2배 · 규칙 추가다 — 하지 않았다.
10. **위치 기록의 노출**: 목록 API(`PUBLIC_COLUMNS` 의 images)로 손님 브라우저까지 위치 기록(모델·토큰·경보)이 간다 — `qc` 와 같은 수준. 숨기려면 worker.js 목록 응답에서 `position` 을 빼는 작은 PR (이 PR 밖).
11. **planner_place 경보 켜기 (보류, 2026-10-20)**: 덩어리 5장 + 운영 1장 재생(오경보 0, 그러나 줄 끝 보류 13/17)으로는 켜지 않는다. 조건: (a) ok 규칙 변경(위 표, 이 PR) (b) `run_right_place`(칠한 덩어리 끝 대 그린 줄 끝 — 같은 화면 틀이라 원근 가정 없음, 사장님 기록 전용 승인) — job.js 가 `ck.place.ref`(칠한 하부 뒷선·앞선 양 끝·벽 모서리·소실점)를 저장해야 하므로 Image Gen 선행 (c) 운영 planner_place ≥ 20장(방 3·공급자별) 블라인드 대조에서 경계 아닌 오경보 0·장 재현율 ≥ 80 %·줄 끝 보류 ≤ 30 %. 자료 gen-eval3/place_validate/judge.json.

---

## 15. 남은 것 (이번에 안 한 것)

| 항목 | 이유·다음 |
|---|---|
| 도면 덩어리 이미지 좌표 대조 | `ck.place` 에 칠한 하부 윗면 다각형(이름표)·회전이 없다. job.js 1-d(위치 검사 밖)에서 `ck.place` 에 함께 저장해야 한다 — Image Gen 다음 작업. 재생 그림 0장이라 PLANNER_PLACE_GUIDE 켠 뒤 실제 표본 ≥ 20장을 모아 재생 |
| 도면 덩어리 ㄱ자의 벽 기준 | v2 는 앵커·런 틀을 맞췄지만 판정은 `place_corner` 로 막았다 — 꺾인 다리 쪽 벽 끝·상판 끝을 측정 질의가 어떻게 잡는지 재생 근거가 생기면 푼다 |
| 후드 세로 소실점의 독립 정답 | 재생 정답(융합)이 pitch 0 계산이라 v2 보정을 실제 그림으로 검증하지 못했다(§4-5). 덩어리·도면 덩어리 경로는 칠한 카메라 `cam.f` 가 있어 독립 f 로 쓸 수 있다(미구현) |
| 후드−쿡탑 축척을 쿡탑 자체 폭으로 | 글 % 설치 문장은 쿡탑 폭을 말하지 않는다 — 폭을 가정하면 정본에 없는 규칙이 된다. 플래너(가전 widthMm)·덩어리(칠 600)만 가능 — R3 에서 필요하면 |
| vz 가 없을 때 후드의 pitch | vz 를 버리거나 못 풀면 세로 소실점도 없다 — 후드는 Δ 이동 σ_z 만 (pitch 몫은 σ 에 없다) |
| 띠 만들기 CPU 를 되붙이기 뒤로 | 추천안 경로에서 띠 디코드·인코드가 되붙이기와 겹친다(§9). 운영 CPU p99 를 본 뒤 필요하면 — job.js 를 더 넓혀야 해서 이번에는 `POSITION_ZOOM_MAX_EDGE` 손잡이만 |
| 운영 CPU p99 | 대시보드 확인 필요 (§9) |
| 점 σ·σ_z 의 z·후드−쿡탑 approx·직선 2개 σ_u 의 y σ | R3 |
