# 도면↔BOM 원장 (C1a) — 3D 부재와 BOM 행의 1:1 대조 보고

> 계획: `docs/01-plan/detail-bom-deepening.plan.md` §4.5 (BOM 은 부재 모델로 수렴한다) · §5 C1a
> 시험: `__tests__/scene-bom-ledger.test.js` · 허용 목록: `test-utils/ledger-allowlist.json`
> 유틸: `test-utils/scene-parts.js` (3D) · `test-utils/bom-parts.js` (BOM) · `test-utils/ledger-diff.js` (대조)
> 이 문서는 C1b(`js/planner/part-model.js`)가 **무엇을 먼저 옮길지** 정하는 입력이다.

## 0. 한 문단 요약

"도면에 나타난 모든 자재를 정확히" 는 3D 가 그린 부재 목록과 BOM 이 센 부재 목록이 **같은 목록**일 때만 참이다.
지금은 아니다. 골든 3벌 + ㄱ자 코너 배치를 실제 경로(전체 자동계산 → `renderAll3D` / `buildPlannerPayload` →
`_convertPlannerModules` → `MaterialExtractor.extract`)로 흘려 (플래너 모듈, 부재 종류) 362 묶음을 대조하니
**53 묶음만 맞고 309 건이 어긋난다.** 측판·표준 하부장 도어·멍장 목대·키큰장 하부 단 도어는 이미 같다.
어긋남은 원인 15 묶음으로 나뉘고, 그중 **키큰장 단이 하부장 규칙을 타는 것**(도어 H−30 · 선반 강제 · 걸레받이
폭에 3단이 다 더해짐)과 **상부장 없는 배치의 상몰딩**은 지금 발주가 틀리는 BOM 버그다. 나머지는 3D 가 그리지 않거나
단순화한 것(밴드·뒷판 2.7T·사쿠리·라인 단위 부재)과 3D 쪽 오류(상부 도어 내림 잘림·멍장 도어 15 과다)다.
309 건은 허용 목록에 이유와 함께 **전부** 기록됐고, 시험은 새 차이도 낡은 항목도 막는다 — 항목은 코드를 고쳐야만 줄어든다.

## 1. 방법

### 1.1 3D 쪽 — `test-utils/scene-parts.js`

- 플래너는 `if (three || !window.THREE) return;` 으로 three 가 없으면 3D 를 건너뛴다. `require('three')`(CJS 빌드)를
  `window.THREE` 에 올리고 WebGL 이 필요한 `WebGLRenderer` 와 addons 의 `OrbitControls` 만 스텁으로 바꾼다.
  기하·userData 를 만드는 코드는 renderer 를 쓰지 않으므로 **부재 목록은 브라우저와 같다** (그리기만 안 한다).
- `bootPlanner3D(layout)` = `bootPlanner` + `autoCalcAllAreas()` + `renderAll3D({fit:false})` (자동계산 안의 renderAll3D 는
  try/catch 로 삼키므로 직접 한 번 더 부른다).
- `three.moduleGroup` 을 순회해 Mesh 만 센다. `PLANNER_FINISH_PAINT_SKIP` (`edge` `reveal` `doorEdge` `carcass-line`
  `pick` `area` `module` `leg`) 는 표시용이거나 철물(다리발)이라 뺀다. `open` 칸의 와이어프레임 틀은
  `plannerFinishPartKeyOf` 가 null 을 주므로 빠진다. 나머지는 전부 — 먹장·멍판·목찬넬·좌대·상판 포함.
- 행 = `{ moduleId, family, a ≥ b, t, qty }`. `a,b` 는 두께 `t`(가장 짧은 변)를 뺀 두 변(큰 순) — BOM 이 w/h 를
  어느 쪽으로 적든 **순서 없는 쌍**으로 비교한다. `family` 는 partKey 에서 순번(`#…`)을 떼고 BOM 이름으로 접은 것:
  `body:left/right → body:side`, `body:back → back`, `channel:channelFace/Base → channel:front/back`, `brace → body:brace`.

### 1.2 BOM 쪽 — `test-utils/bom-parts.js`

- 같은 플래너에서 `buildPlannerPayload('PLANNER_DONE')` → `ui-step1.js _convertPlannerModules(payload, specs)`
  (planner-to-bom.test.js 와 같은 절단) → `MaterialExtractor.extract({items:[item]})`.
- 스펙은 `data-constants.js DEFAULT_SPECS` 의 싱크 부분 그대로(`LEDGER_SPECS`) — 목찬넬 손잡이, 좌·우 휠라 60.
  허용 목록이 스펙을 함께 저장하고 시험이 같은지 본다 (스펙이 달라지면 차이의 뜻이 달라진다).
- B1 `partId` 를 **아는 모듈 id 로 접두어를 벗겨** partKey 를 얻는다 (id 에 `-` 가 있어 쪼개 읽지 않는다 — §7-1).
  셀 모듈 `planner-X-i` 는 플래너 모듈 X 로, 멍장 `corner-blind-{pos}[-k]` 는 payload 순서의 k 번째 멍장으로 되돌린다.
  품목 단위 행(상몰딩·걸레받이·목찬넬·좌우 마감)은 `ep`.

### 1.3 대조 — `test-utils/ledger-diff.js`

단위는 **(플래너 모듈, family)** 다. 그 안에서 판 치수 다중집합을 ±1mm 로 짝짓는다.

| kind | 뜻 |
|---|---|
| `only3d` | 3D 에는 있는데 BOM 에 없는 종류 |
| `onlyBom` | BOM 에는 있는데 3D 에 없는 종류 |
| `dims` | 종류는 같은데 치수/수량 다중집합이 안 맞는다 (w/h 순서 없음, ±1mm) |
| `thickness` | 치수·수량은 맞는데 두께만 다르다 (지금은 0 건 — 두께가 다른 판은 치수도 달랐다) |

차이 id = `fixture|moduleId|family|kind`. 시험은 실제 차이 집합과 허용 목록이 **정확히** 같아야 통과한다:
목록 밖의 새 차이, 사라진 항목(낡은 허용), 내용(치수·수량)이 바뀐 항목, `cause`/`reason` 이 빈 항목 — 넷 다 실패하고 표를 찍는다.
갱신은 `UPDATE_LEDGER_ALLOWLIST=1 npx jest __tests__/scene-bom-ledger.test.js` (기존 항목의 cause·reason 은 id 로 이어받고
새 항목은 빈 이유로 들어와 다음 실행이 실패한다 — 사람이 적는다).

### 1.4 픽스처

| 이름 | 출처 | 내용 |
|---|---|---|
| straight | `test-utils/planner-golden.js` | 직선 하부 3공간(1200·1000·1400) · 상부 2 · 분배기 · 후드 |
| lShape | 〃 | ㄱ자 — 하부 회전 0/90, 상부, **키큰장 600 (3단 스택)**, 분배기 |
| oblique | 〃 | 135° 사선 — 하부 2공간(회전 0 · 135, 각각 2모듈) · 상부 1 (사선 공간도 자동계산이 채운다) |
| cornerL | `planner-corner-blind.test.js lShapeLayout(false)` 와 같은 배치 | ㄱ자 하부 3600 + 1970 → **멍장 1** + 수납 5 |

`test-utils/bom-golden/fixtures.js` 의 `sinkCorner` 는 상세설계 모듈 픽스처(플래너 배치가 아님)라 플래너에 부팅할 수 없다.
그 대신 cornerL 이 같은 멍장 경로(`corner-blind-lower`, 멍 665 · 도어 418)를 실제 자동계산으로 만든다.

## 2. 숫자

| 픽스처 | 모듈 | 3D 행 (판) | BOM 행 (판) | 묶음 | 일치 | 차이 | only3d / onlyBom / dims |
|---|---|---|---|---|---|---|---|
| straight | 10 | 87 (108) | 73 (107) | 105 | 14 | 91 | 32 / 18 / 41 |
| lShape | 11 | 94 (115) | 78 (112) | 115 | 16 | 99 | 37 / 21 / 41 |
| oblique | 6 | 55 (68) | 50 (74) | 68 | 10 | 58 | 18 / 13 / 27 |
| cornerL | 6 | 60 (70) | 52 (73) | 74 | 13 | 61 | 22 / 14 / 25 |
| **합** | 33 | 296 (361) | 253 (366) | **362** | **53** | **309** | 109 / 66 / 134 |

**이미 맞는 것** (일치 53 묶음): 모든 모듈의 측판 `body:side`(예 708×550×15 ×2), 표준 하부장 도어 `door`
(양문 396×678 ×2, 단문 396×678 ×1 …), 키큰장 하부 단 도어(596×771), 멍장 경첩목대 `body:batten-front/side`(708×60×15).
즉 몸통 폭·높이와 하부 도어 공식은 두 쪽이 같은 값을 낸다 — 대조 장치가 실제로 짝을 짓는다는 증거이기도 하다
(시험 "표준 하부장의 도어는 이미 맞는다").

## 3. 허용 목록 — 원인별

309 건, 원인 15 묶음. 판정: **BOM 버그**(발주가 틀린다) · **3D 오류**(도면이 규칙과 다르다) · **단순화**(3D 가 일부러
안 그리거나 어림한 것 — 부재 모델이 정리) · **확인 필요**(규칙 자체를 정해야 한다).

| # | cause | 건 | kind | 무엇이 다른가 | 판정 |
|---|---|---|---|---|---|
| 1 | 라인 단위 부재 | 77 | only3d 61 / onlyBom 16 | 걸레받이·상몰딩·목찬넬(전면·지면): BOM 은 품목 단위 `ep` 한 장(모듈 폭 합), 3D 는 런/모듈마다 한 장. 셈이 아니라 **묶음 단위**의 차이. 단, lShape 걸레받이·목찬넬 6000(키큰장 3단 600×3 이 다 더해짐)과 cornerL 상몰딩(상부장 없음)은 값 자체가 틀리다 | 단순화 + **BOM 버그 2** |
| 2 | 천판↔밴드 | 46 | only3d 23 / onlyBom 23 | 하부장·키큰장·멍장 몸통은 천판 없이 밴드 2장(70 × W−2T, sink.md). 3D 는 천판 통짜(W−2T × D−T) | 단순화 |
| 3 | 뒷판 모델 | 31 | dims | 3D 뒷판 15T 를 측판 사이에 끼움(W−2T × H). BOM 하부 2.7T 덧댐(W−2T × H−T), 상부 2.7T 사쿠리홈(W−20 × H−1) | 단순화 |
| 4 | 처짐방지목 | 31 | dims 21 / onlyBom 10 | 3D 는 양문 가운데 장식용 한 장(60 × 도어H×0.9)만. BOM 은 70 × (H−2T) 를 W≥800(하부)/≥700(상부)이면 2장, 목찬넬 −70; 단문에도 낸다 | 3D 오류 |
| 5 | 선반 치수 | 30 | dims | 3D 선반 4mm 시각 여유(W−2T−4 × D−T−4). BOM 하부 W−2T × D−T, 상부 D−34(사쿠리), 멍장 −75 | 단순화 |
| 6 | 지판 깊이 | 23 | dims | 3D 지판은 15T 뒷판 앞에서 끝나 D−15. BOM 하부장 지판은 D 그대로(뒷판이 뒤에 덧대므로) | 단순화 (3 의 결과) |
| 7 | 사쿠리홈 깊이 | 16 | dims | 상부장 천판·지판: 3D D−15, BOM D−18 (3mm) | 단순화 (3 의 결과) |
| 8 | 가전 영역 모듈 | 14 | only3d | 분배기(`sink`) 배치 공간에 자동계산이 장(700×500×370)을 세워 3D 가 몸통·도어·상판을 그린다. 브리지는 sink 를 가전으로 보고 BOM 에서 뺀다 | **확인 필요** |
| 9 | 상판 미산출 | 10 | only3d | 상판(런 한 장, 12T)을 3D 는 그리고 BOM 은 아직 없다 | BOM 미구현 (B2) |
| 10 | 밴드 미표현 | 8 | onlyBom | 상부장 밴드(보강목) 2장(W−2T × 70)을 3D 가 안 그린다 | 단순화 |
| 11 | 상부 도어 내림 잘림 | 8 | dims | BOM 상부 도어 = 몸통 + 15 (오버랩). 3D 는 도어 내림 15 가 배치 공간 바닥 제한(`areaLimitsFor bottomLimit`)에 잘려 몸통 −4 | 3D 오류 |
| 12 | 스펙 마감재 | 8 | onlyBom | 좌·우 휠라 60 은 스펙 `finishLeft/RightType` 에서 나오고 도면에는 없다 (브리지가 경고만 한다) | **확인 필요** |
| 13 | 멍장 정면 치수 | 3 | dims | 3D 도어 칸 폭 = doorW + 목대 15 → 도어 429 (BOM 414). 멍가림판·멍판 마감재 높이에서 도어 갭 4 를 뺀다(704 vs 708), 멍판 폭 646 vs 650 | 3D 오류 |
| 14 | 키큰장 단 규칙 | 3 | dims 2 / onlyBom 1 | 브리지가 키큰장 단(중간장·상부장)을 `pos:'lower'` 로 보내 하부장 규칙을 탄다: 도어 H−30(3D 푸쉬 H−4), 선반 0 인 상부 단에 선반 1 강제(`shelfCount` 무시), 걸레받이·목찬넬 폭에 3단 폭이 다 더해진다(#1) | **BOM 버그** |
| 15 | 좌대 미산출 | 1 | only3d | 키큰장 좌대(W × 60 × D)를 3D 는 그리고 싱크대 BOM 경로엔 없다 | BOM 미구현 (B2) |

같은 원인이 모듈마다 되풀이되므로 건수는 모듈 수에 비례한다. 원인 하나를 고치면 여러 픽스처의 항목이 한꺼번에 사라진다.

## 4. 수정 우선순위

건수가 아니라 **발주가 틀리는가**로 순서를 정했다. 각 항목은 고치면 허용 목록에서 지워져야 하고(시험이 낡은 항목을 막는다),
그 diff 가 곧 수정의 증거다.

### P1 — BOM 버그 (지금 발주가 틀린다)

1. **키큰장 단 → 하부장 규칙** (#14, #1 의 일부; 파일: `js/detaildesign/ui-step1.js _convertPlannerModules`, `extractors.js extractSink`).
   브리지가 tall 을 `pos:'lower'`, `type:'tall'` 로 보내지만 `extractSink` 하부 루프는 `type` 을 보지 않는다.
   중간장·상부장 단의 도어가 H−30 으로 재단되고(푸쉬는 H−4 여야), 선반이 강제되고, `totalLowerW` 에 3단 폭이 세 번 들어가
   걸레받이·목찬넬이 라인보다 1200 길다. 또 `areaWidths` 가 비어 "자동계산 전" 경고가 뜬다 — 스택은 셀을 안 나누므로
   경고 자체가 틀렸다. `sink.md §5` 키큰장 부재표(단별 도어 규칙·좌대·상몰딩)를 `type:'tall'` 가지로 따로 낸다.
2. **상부장 없는 배치의 상몰딩** (#1 cornerL; `extractSink` `moldingW = totalUpperW || effectiveW`). 상부가 0 이면 하부 폭으로
   떨어져 없는 상몰딩 4866 이 나간다. `totalUpperW > 0` 일 때만.
3. **상판·좌대 미산출** (#9, #15) — 계획 B2 그대로. 3D 는 이미 런 단위 상판(W × 12 × D)과 좌대(W × 60 × D)를 갖고 있으니
   부재 모델이 생기면 BOM 이 그 행을 그대로 읽으면 된다.

### P2 — 3D 오류 (도면이 규칙과 다르다; `mockup-structure.html` 3D 빌더)

4. **상부 도어 내림 잘림** (#11; `addFrontPanel` doorDrop + `areaLimitsFor`). 규칙은 H+15 인데 배치 공간 H 가 모듈 H 와
   같아 `bottomLimit = 0` 이 되고 내림이 0 으로 잘린다. 배치 단계가 상부 공간을 몸통 +15 로 잡거나, 내림은 제한에서 빼야 한다.
5. **멍장 도어 15 과다** (#13; `createModuleMesh` 셀 폭 = doorW + 목대 15 → `innerW = colW − 4`). 도어는 목대에 물리므로
   `doorW − 4` 로 그려야 한다(BOM 과 corner.md §3.5). 멍가림판·마감재 높이의 갭 4 도 몸통 H 로.
6. **처짐방지목** (#4; `addFrontPanel` 양문 brace). 장식용 60 × 0.9h 한 장 대신 BOM 규칙(70 × H−2T, W 문턱 2장, 단문 포함)을
   그린다. 부재 모델이 오면 자연히 해결.

### P3 — 단순화 (부재 모델 C1b 가 한 정의로 정리)

7. **몸통 뒷면 모델** (#3 뒷판, #6 지판 깊이, #7 사쿠리 — 합 70 건). 3D 가 뒷판을 15T 끼움으로 그려 지판·천판·선반 깊이가
   전부 D−15 로 밀린다. 부재 모델이 "뒷판 2.7T 덧댐(하부) / 사쿠리홈(상부)" 을 정의하면 세 원인이 함께 사라진다.
   **C1b 첫 이전 후보** — 코너/멍장 다음에 몸통을 옮길 때 이것부터.
8. **천판↔밴드** (#2, 46 건) · **밴드 미표현** (#10). 하부·키큰장 천판 자리는 밴드 2장, 상부장은 천판 + 보강목 2장.
9. **선반 4mm 여유** (#5). 3D 만의 시각 여유 — 부재 모델에서는 재단 치수를 갖고 그릴 때만 줄인다.
10. **라인 단위 부재** (#1 나머지 61+14 건). 걸레받이·상몰딩·목찬넬을 "런/라인 한 장" 으로 정의하면 3D 도 BOM 도 같은
    묶음이 된다. 3D 의 런 단위(영역 첫 모듈에 한 장)가 BOM 의 품목 단위보다 제작에 가깝다 — BOM 을 런 단위로 옮기는 쪽.

### P4 — 규칙 확인 필요 [사용자 결정]

11. **분배기 영역의 장** (#8). 자동계산이 `sink` 배치 공간에 장을 세운다. 개수대 하부장은 실제로 하부 라인 안의 셀(브리지가
    `개수대` 로 라벨)이므로 이 장은 중복이거나, 아니면 분배기 상판 밑 공간을 뜻하는 것이다. 어느 쪽이든 3D 와 BOM 중 하나는 틀리다.
12. **마감재의 출처** (#12). 좌·우 휠라는 스펙에서 나온다. 계획 D 축이 "도면에 그린 마감재(finishings)" 를 정본으로 하면
    스펙 값은 폴백으로 내려야 한다.

## 5. C1b 로 넘기는 것

- 부재 모델 `part-model.js` 는 modules + structures + detail 에서 **이 문서의 family 이름**으로 부재를 내야 한다
  (`body:side` `body:top` `body:bottom` `back` `shelf` `body:band` `body:brace` `door` `drawer` `blind` `blindfin`
  `body:batten-*` `channel:front/back` `top` `kick` `pedestal` `molding` …). 이름 표는 `ledger-diff.js KNOWN_FAMILIES`
  와 `bom-protocol.md §7-1` 이 정본이다.
- 이전 순서 제안: 코너/멍장(P2-5) → 몸통 뒷면(P3-7, 70 건) → 천판/밴드(P3-8, 54 건) → 라인 단위 부재(P3-10, 75 건)
  → 전면(P2-4·6). 각 이전 PR 은 허용 목록에서 항목을 지우는 diff 를 동반해야 한다.
- P1 은 부재 모델을 기다리지 않는다 — `extractors.js`/`ui-step1.js` 에서 바로 고친다 (BOM 도메인, 별도 PR).

## 6. 한계 (이 시험이 아직 안 보는 것)

- 붙박이장·냉장고장: 플래너가 그 구조를 만들지 않아(`_isNativeOnly`) 브리지가 막는다. 골든 BOM 시험이 따로 있다.
- 서랍: 자동계산이 `horizontalLayout:'doorOnly'` 로 만들어 픽스처에 서랍 셀이 없다 → `drawer`·`drawerbox:*` 는 대조 안 됨.
- 도면에 놓은 마감재(EP·몰딩·휠라 모듈)와 두 칸 이상 셀 모듈, 알루미늄 찬넬, 도어 내림이 실제로 그려지는 배치.
- 철물(다리발·경첩·레일)은 자재 원장 밖이다 (`HardwareExtractor`).
- `thickness` 종류는 정의돼 있지만 지금은 0 건 — 두께가 다른 판은 치수도 달라 `dims` 로 잡힌다.
