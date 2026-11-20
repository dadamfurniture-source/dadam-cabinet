# 네스팅 엔진 — 재단 배치 단일화 (B4)

계획서 `docs/01-plan/detail-bom-deepening.plan.md` §1.3 · §4.6 · §5 B4. 출력 스키마의 정본은 `docs/design-rules/bom-protocol.md` §7-3.

## 1. 왜

원판 배치 계산이 **세 벌** 있었고 결(grain)도 없고 저장도 안 됐다 (§1.3):

| 구현 | 위치 | 방식 | 쓰던 곳 |
|------|------|------|---------|
| `calcCuttingPlan` | `js/detaildesign/ai-design-report.js` | 스트립 길로틴, H/V × 정방향/회전 4후보, 최대 5장 겹침, 잔재→소부품 시뮬레이션 | CNC 탭 · XLSX · 배치 워드 |
| `DrawingVisualizer.packParts` | `js/detaildesign/extractors.js:1685` | MaxRects 비슷한 freeRects, KERF 4 | `DadamAgent.generateDrawings` (도면 미리보기) |
| `NestingOptimizer` | `js/detaildesign/persistence-init.js:9` | 자재 그룹 분류 + 자체 배치, MARGIN 10 | `showNestingOptimizer` 모달 |

B4 는 첫 번째(가장 정교하고 화면이 쓰는 것)를 순수 함수로 옮겨 **`js/detaildesign/nesting-engine.js`** 하나로 만들고,
CNC 탭·XLSX 가 그것을 쓰며, 스냅샷 동결 시 같은 결과를 `design_snapshots.cut_plan_payload` 에 저장한다.
작업지시서 v2(B5)의 시트별 재단표·부재 라벨은 이 저장값만 읽는다.

## 2. API

```js
const cutPlan = NestingEngine.plan(materials, opts);
```

- `materials`: `bom.materials` 행 (`{partId, part, material, thickness, w, h, qty, edge, itemLabel, grain?}`). B1 이후 모든 행에 `partId` 가 있다.
- 전역 스크립트(`detaildesign.html`, `data-constants.js` 뒤 · `ai-design-report.js` 앞)와 CommonJS(`require`) 이중 노출. DOM·전역 상태를 건드리지 않는다.
- 보조: `NestingEngine.partClassOf(partName)` (본체/도어/뒷판), `basePartId('x#3') → 'x'`, `rotatableOf(row)`, `DEFAULTS`, `NO_ROTATE_MATERIALS`.
- 재단 방식 (2026-11-17): `NestingEngine.STRATEGIES` (`[{id, label}]` — 표준 · 부재 최적화 · 최소 재단), `NestingEngine.compare(materials, opts)` (세 방식을 한 번에 — `{plans, rows}`), `NestingEngine.cutCount(sheet)` (낸 원판 한 장을 자르는 횟수). §3-1.

### 옵션

| 옵션 | 기본 | 뜻 |
|------|------|-----|
| `sheetSize {w,h}` | 전역 `SHEET_W/H` → 1220×2440 | 기본 원판 |
| `sheetSizes {'PB_15': {w,h}, 'PB': {w,h}}` | — | 자재(_두께)별 원판. `자재_두께` 키가 `자재` 키보다 우선 |
| `kerf` | 전역 `CUT_KERF` → 4 | 톱날. 조각 사이·스트립 사이 |
| `trim` | 10 | 네 변 가장자리 트림. 배치 가능 영역 = `(w-2·trim) × (h-2·trim)`, 좌표는 원판 좌상단 기준 절대값 |
| `noRotateMaterials [RegExp\|string]` | 무늬목 · 우드 · wood · 결 PET · PET(우드/결) | 자재 이름으로 회전 금지 |
| `partClass fn(partName)` | `partClassOf` | 원판을 섞지 않는 그룹을 가르는 부재 구분 |
| `strategy` | — (지금 방식 그대로) | 재단 방식 `standard` · `material` · `cuts` (§3-1). 모르는 값은 `RangeError` |
| `colorOf fn(row)` | — (색을 보지 않는다) | 판의 색 이름. 색이 다른 판을 한 원판에 섞지 않는다 (묶음 키에 색) |
| `searchBudget` | 묶음 크기에 따라 14 ~ 204 | 묶음마다 만들어 볼 후보 배치 수 (`strategy` 가 있을 때만) |
| `small` | — (소부품은 원판에 놓지 않는다) | 소부품 모드 `place`(더하기 — 한 변 ≤ 70 도 원판에) · `stock`(빼기 — 재고 밴드에 맞는 부재는 `bandStock` 블록, 나머지 소부품은 원판에) (§3-2). 모르는 값은 `RangeError` |
| `bandStock {width, length, material, thickness}` | — | `small: stock` 일 때 재고 밴드 (예 60 × 2440 · PB 15T). 모양이 틀리면 `RangeError` |

`strategy` 도 `colorOf` 도 주지 않으면 §3 의 알고리즘 그대로이고 결과 JSON 이 한 글자도 바뀌지 않는다 — CNC 탭(`ai-design-report.js`)과 스냅샷(`workflow-client.js`)이 그렇게 부른다.

행 단위 회전 금지: `grain` 이 있고 `'none'` 이 아니거나 `rotatable === false`. 결 부재는 `parts[].grain` 에 그 값이, 회전 가능한 부재는 `'none'` 이 적힌다.

## 3. 알고리즘 (calcCuttingPlan 이식)

1. **정규화·정렬** — 치수·수량이 양수인 행만. `material → thickness → partClass → h↓ → w↓ → partId` 로 정렬한다. 이 정렬이 결정성의 뿌리다 (Map 순서·안정 정렬이 그 뒤를 따른다).
2. **소부품 분리** — 한 변이 70mm 이하인 행(밴드·보강목·덧대)은 원판에 놓지 않고 `smallParts` 로 낸다. 잔재에서 뽑는 대상이다.
3. **그룹** — `자재|두께|부재구분`. 본체·도어·뒷판 원판을 섞지 않는다 (CNC 탭 규격 목록의 그룹과 같다).
4. **need** — 그룹 안에서 같은 `(w, h, 회전가능)` 을 하나로 묶고 수량을 합친다. 각 need 는 `partId#k` 낱개 큐를 가진다.
5. **단독 원판** — 같은 need 만으로 원판을 채워 2장 이상 겹칠 수 있으면 먼저 뺀다 (최대 5장).
6. **혼합 배치** — 남은 need 로 H(가로→세로)·V(세로→가로) × 정방향/회전 네 후보를 만들고 `실제 생산량(배치×예상 겹침) → 배치 수 → 잔재에서 뽑는 소부품 수 → 60~70 자투리 길이 → 활용 면적 → 스트립 수↓` 로 고른다. 회전 후보에서도 회전 금지 need 는 제자리 치수를 유지한다.
7. **스트립** — 첫 need 의 h(H)/w(V) 로 스트립 크기를 정하고 같은 치수를 먼저 채운 뒤(1차) 남는 자리에 더 작은 need 를 넣는다(2차, `fromRemainder`).
8. **전개** — 배치 한 종을 `stack` 장의 시트로 늘어놓고, 스트립·조각 순서대로 큐에서 `partId#k` 를 꺼내 절대 좌표를 적는다. 스트립 잔여(≥60)와 원판 잔여(≥60)를 `offcuts` 로 낸다.

### 3-1. 재단 방식 (2026-11-17 사장님 「재단은 총 3가지 중 선택」)

`opts.strategy` 를 주면 §3 의 5 · 6 단계(원판마다 그때 가장 많이 놓이는 배치를 고른다) 대신, **묶음 하나를 여러 방식으로 끝까지 놓아 보고(후보) 그 가운데서 고른다**. 1 ~ 4 · 8 단계는 그대로다.

| 방식 | 사장님 말 | 고르는 차례 |
|------|-----------|-------------|
| `standard` 표준 | 「1220 이 먼저 잘리고, 회전해서 2440 이 다음에」 — 그림으로 확인: **첫 톱질이 2440 변과 나란하다** (1220 폭을 긴 띠로 켠 뒤 띠를 돌려 토막). 「그렇게 했을 때 부재에 따른 최소 원장 갯수」 | 첫 톱질이 원판 긴 변과 나란한 후보만 → 못 놓은 수 → **원판 수** → 앞 장부터 꽉 → 자르는 횟수 → 다시 쓸 자투리 넓이 |
| `material` 부재 최적화 | 「잘리는 횟수에 관계없이 원장의 넓이가 최대로 많이 남도록」 | 모든 후보 + 지금 방식 → 못 놓은 수 → **원판 수** → 앞 장부터 꽉 → 다시 쓸 자투리 넓이 → 가장 큰 자투리 → 자르는 횟수 |
| `cuts` 최소 재단 | 「재단 횟수가 최소」 · 「(표준보다) 한 장까지는 더 써도 됨」 | 원판 수 ≤ 표준 + 1 인 후보 → **자르는 횟수** → 원판 수 → 앞 장부터 꽉 → 다시 쓸 자투리 넓이 |

- **기본 조건 — 앞 장부터 꽉** (2026-11-19 사장님 「재단의 기본 조건은 원장 한 장에서 나오는 자투리 자재가 최대한 적게 나오도록 부재들이 배치되어야 해」 · 그림을 보고 고르심 「톱질 방향은 그대로 · 앞 장부터 꽉」): 원판 수가 같으면 앞 원판부터 꽉 채운 후보를 고른다 — 남는 넓이가 마지막 원판에 모인다. 표준의 첫 톱질 방향은 그대로다 (방향 때문에 원판이 더 드는 묶음은 그대로 둔다).
  - 값 `front`: 후보의 원판마다 놓인 넓이(mm² 정수, 겹친 배치는 장수만큼)를 큰 것부터 세워, 앞에서 k 장까지의 합을 k = 1..n 에 대해 모두 더한다. 클수록 앞 장이 꽉 차 있다. 한 장이면 늘 같은 값이라 다음 기준으로 넘어간다.
  - 고른 후보의 원판은 **꽉 찬 것부터** 낸다 (겹친 원판은 붙어 있다) — `sheets[].no` · `layout.no` 가 그 차례다.
  - [확인 필요 — 사장님 값이 아니라 만든 사람의 판단이다]: ① 첫 장부터 차례로 견주지 않고 쌓은 합으로 견준다 (첫 장의 아주 작은 차이가 뒤 장을 다 이기지 않게) ② 부재 최적화에서도 원판 수 바로 다음에 둔다 (다시 쓸 자투리 넓이보다 앞) ③ 최소 재단에서는 횟수 · 원판 수가 같은 후보 사이에서만 본다 ④ 「몇 % 안이면 같다」 같은 문턱은 두지 않는다 — 그래서 표준의 자르는 횟수가 는다.

- **후보는 모두 띠 재단이다** — 끝에서 끝까지 직선으로 켜는 톱으로 자를 수 있는 배치만 (부재 최적화도). 후보 방식은 204가지(`VARIANTS`) — 다섯 가지를 곱한 198가지에 「원판 한 장을 가장 넓게」 6가지(아래)를 더했다: 첫 톱질 방향(긴 변 먼저 · 짧은 변 먼저 · 원판마다 더 넓게 쓰는 쪽) × 부재 돌리기(부재마다 · 그린 대로 · 돌릴 수 있는 것은 모두) × 다음 띠 폭(들어가는 가장 넓은 것 · 가장 꽉 차는 것 · 가장 넓게 쓰는 것) × 좁은 부재 같이 놓기(함 · 안 함) × 되풀이(같은 배치를 겹칠 만큼 · 원판마다 새로 · 같은 부재로 꽉 차는 원판 먼저 · 띠를 다 만든 뒤 넓은 것부터 원판에). 0번 후보는 §3 의 지금 방식 그대로다.
- **원판 한 장을 가장 넓게 (`fill` 후보 6가지, 2026-11-19)** — 긴 변 먼저만 (부재 돌리기 셋 × 좁은 부재 같이 놓기 둘). 원판 한 장을 짤 때 띠 폭 조합을 넓은 것부터 찾고(`designSheetFill`), 띠마다 길이 조합을 찾아(`buildStripFill` — 띠 폭과 같은 부재 + 더 좁은 부재 한 줄) 놓인 넓이가 가장 큰 배치를 고른 뒤 남은 부재로 다음 장을 짠다. 그 배치를 겹칠 수 있는 만큼 겹친다. 띠 재단 · 「한 번 더 켜기」(좁은 부재 한 줄)는 다른 후보와 같다 — 띠의 남는 자리에 좁은 부재를 여러 줄 나란히 놓지는 않는다 (자르는 횟수 셈이 달라지는 일이라 넣지 않았다). 찾는 가지 수는 띠 하나 200 · 원판 한 장 300 에서 끊는다 [확인 필요: 셈 한도다 — 사장님 값이 아니다. 30 ~ 3000 으로 바꿔도 시험 계산의 표준 원판 수는 같았다].
- **표준의 띠 안 좁은 부재** — 띠를 토막 낸 뒤 폭이 더 좁은 부재는 한 번 더 켠다 (`fromRemainder`). 2026-11-17 사장님 「허락」 (금지하면 시험 계산에서 원판이 약 10 % 더 든다).
- **긴 변 먼저** — 원판이 세로로 길면(1220 × 2440) 세로 띠 `V`, 가로로 길면 `H`. 결 · 회전 금지 규칙은 방식과 상관없이 그대로다.
- **다시 쓸 자투리** — 긴 변 600 · 짧은 변 400 이상 (재고 자투리 화면의 「쓸 수 있는 것」 — `workers/workflow-api/src/stock-needs.js CANDIDATE_MIN`).
- **자르는 횟수** — bom-protocol §7-3. 겹친 원판(최대 5장)은 한 번, 가장자리 트림 재단은 세지 않는다.
- **묶음마다 지켜지는 것** — 표준으로 고른 후보가 다른 두 모음에도 들어 있어서: 부재 최적화 원판 ≤ 표준 · 최소 재단 원판 ≤ 표준 + 1 · 최소 재단 횟수 ≤ 표준. 부재 최적화 원판 ≤ 지금 방식(0번 후보). 표준은 지금 방식보다 원판이 늘 수 있다 (지금 방식은 가로 · 세로 띠를 섞는다 — 골든 9벌 × 수량 1 · 2, 묶음 62개 가운데 1개).
- **「가장 적은」은 만들어 본 후보 가운데서다** — 증명된 최소가 아니다. 화면 · 문서에 「최소 보장」 · 「최적」이라 적지 않는다.
- **후보 수 한도** — `clamp(⌊400000 ÷ (치수 종류 × 조각 수)⌋, 14, 204)`, `opts.searchBudget` 을 주면 그 수. 개수로만 줄인다 (시간으로 끊으면 같은 입력에서 다른 결과가 나온다). 앞 14개(앞 장부터 꽉 둘 + 열둘)는 한도가 가장 작을 때도 세 방식이 모두 고를 것이 있게 정해 둔 차례다 — 맨 앞이 긴 변 먼저라 한도가 하나여도 표준이 고를 것이 있다. [확인 필요: 400000 · 14 는 골든 9벌에서 걸린 시간(BOM 하나 7 ~ 24 ms)을 보고 잡은 값이다 — 사장님 값이 아니다]
- **색** — `opts.colorOf(row)` 를 주면 묶음 키가 `자재|두께|구분|색`. 색이 없는 줄은 빈 글 묶음으로 따로다. 색이 다른 판은 한 원판에 섞이지 않는다.

### 3-2. 소부품 더하기 · 빼기 (2026-11-19 사장님 「소부품 더하기, 빼기로 구분해서 더하기는 2.밴드도 원장에 놓기 : 재단에 포함 시키고, 빼기는 밴드 재고 운영, 60*2440의 밴드를 18개 기본 재고로 만들고 8개가 남으면 새로운 밴드재고 만들기로 요청.」)

`opts.small` 이 없으면 §3 그대로(2단계 소부품 분리). 있으면 소부품 분리를 하지 않는다:

- **`place` (더하기)** — 한 변 ≤ 70 인 부재도 다른 부재와 같이 묶음 · 원판에 놓는다. `smallParts` 는 빈 배열. 원판 · 띠 끝에서 더 놓아 볼지 가르는 문턱(`EDGE_LIMIT`)이 70 → 0 (좁은 부재가 원판 끝 자리를 쓴다 — 이 모드일 때만). 원판보다 긴 부재(붙박이장 상몰딩 2440 등 — 쓸 수 있는 길이는 2440 − 여백 2 × 10)는 큰 부재처럼 `unallocated`
- **`stock` (빼기)** — `bandStock` 에 맞는 부재(재질 · 두께가 같고 · 부재 구분 본체 · 짧은 변 = 폭 · 긴 변 ≤ 길이)는 원판에 놓지 않고 `bandStock` 블록으로: 색(`colorOf`)마다 묶어 긴 것부터 들어가는 첫 본에 (1차원 first-fit decreasing, 조각 사이 톱날 하나, 끝 다듬기 없음). 나머지 소부품(18T 밴드 · MDF · 도어재 몰딩 · 더 긴 부재)은 `place` 처럼 원판에
- 조각 id 는 원판 조각과 같은 `partId#k` — 라벨 · 작업지시서가 같은 번호로 읽는다

시험 계산 (골든 9벌, 표준): 원판 89 → 더하기 102 · 빼기 99장, 재단 552 → 792 · 645회, 빼기의 재고 밴드 120개 → 42본. 더하기의 붙박이장은 2440 길이 몰딩 6개가 못 놓음.

시험 계산 (골든 9벌 × 수량 1 · 2): 지금 279장 · 1440회 → 표준 246장 · 1546회 · 부재 최적화 238장 · 1535회 · 최소 재단 267장 · 1266회 (2026-11-19 — 앞 장부터 꽉을 넣기 전인 2026-11-17 에는 표준 252장 · 1391회 · 부재 최적화 239장 · 1489회 · 최소 재단 268장 · 1264회). 원판 수가 같은 묶음의 예 — sink15 몸통 PB 15T: 원판마다 수율 89 · 87 · 68 · 68 · 65 % → 94 · 90 · 88 · 88 · 16 %.

### 옛 코드와 다른 점

- **트림 10mm** — 옛 코드는 0. 배치 가능 영역이 20mm 씩 줄어 장수·수율이 조금 달라질 수 있다.
- **결 회전 금지** — 옛 코드는 모든 부재를 회전했다.
- **커프 누락 수정** — 1차 배치에서 너비가 다른 두 need 를 이어 붙일 때 사이 커프를 빠뜨려 원판을 최대 4mm 넘칠 수 있었다 (SVG `clipPath` 가 가렸다). 이제 `gap` 으로 둔다.
- **조각마다 제 이름** — 옛 코드는 치수가 같은 부재 이름을 `', '` 로 묶어 한 조각에 썼다. 이제 조각마다 자기 `part`·`partId`·`edge`·`itemLabel`.
- **그룹 순서** — 자재 이름을 `localeCompare` 가 아닌 코드 포인트 비교로 정렬한다 (환경에 무관한 결정성).
- SVG `clipPath` id 가 그룹마다 `#1` 부터 겹치던 것을 시트 번호로 바로잡았다.

## 4. 소비자

| 어디 | 무엇을 |
|------|--------|
| `ai-design-report.js` `generateCNCTab` | `NestingEngine.plan(materials)` → 배치 SVG(시트 절대 좌표, 같은 `layout.no` 는 그림 한 장 + `xN` 배지), 잔재·자투리 종합(`offcuts`), 잔재→보강목 추출 시뮬레이션(`smallParts` 는 탭이 따로 모은다), `window._cncData.cutPlan` |
| `ai-design-report.js` XLSX '원판 배치'·요약 탭 | `panelDetails` — `compatStripsOf(sheet)` 가 옛 `strips[].pieces[].count` 모양으로 만든다 |
| `workflow-client.js` `createSnapshot` | 동결 직전 `NestingEngine.plan(report.materials.materials)` 을 POST 본문 `cutPlan` 으로. `_reportData` 는 `ui-step1.js` 소유라 손대지 않는다 |
| `workers/workflow-api/src/snapshots.js` | `validateCutPlan` → `cut_plan_payload` · `sheet_count`. 컬럼이 없는 DB(PGRST204/42703)면 배치만 빼고 저장·목록 |
| `database/workflow-cut-plan.sql` | `ADD COLUMN IF NOT EXISTS cut_plan_payload JSONB`, `sheet_count INT` |
| 간편 플래너 (`dadam-planner-lite server/nesting.js` — 엔진을 서브모듈로 읽는다) | BOM 창 재단 탭 · 「앱으로 보내기」의 `cutPlan`. 2026-11-17 부터 `strategy` · `colorOf` 를 준다 — 플래너에서 온 스냅샷의 `cut_plan_payload` 에는 §7-3 의 「재단 방식 · 색으로 붙는 칸」이 들어 있을 수 있다 |

## 5. 시험

- `__tests__/nesting-engine.test.js` — 골든 5벌: 결정성(순서 뒤집어도 같은 JSON), 수량 보존(`partId#k` 정확히 한 번, 미배치 포함), 겹침 없음·트림 안쪽·커프 간격, 겹침 재단 시트의 배치 동일성, offcuts 정합, 옵션(결·회전 금지·원판 크기·트림·커프), `detaildesign.html` 스크립트 순서.
- 같은 파일, 재단 방식: 옵션이 없으면 결과가 그대로(고정 입력 지문 · 새 칸 없음), 방식마다 골든 9벌에서 보존 · 기하 · 결정성 · 겹침 · 자르는 횟수(`sheets[].cuts` = `cutCount`), 표준은 모든 원판이 긴 변 먼저, 묶음마다 지켜지는 것 셋, `compare` = `plan` 세 번, 후보 수를 하나로 줄여도 같은 약속, 색이 섞이지 않음 · `sheetsByMaterial` 키 그대로.
- 같은 파일, 앞 장부터 꽉: 묶음 안 원판이 꽉 찬 것부터 · `unusedArea` 셈, 원판 수가 같은 묶음에서 부재 최적화의 앞 장 채움 ≥ 표준, 후보를 늘려도 표준의 원판이 늘지 않고 앞 장 채움이 줄지 않음, 고정 입력 둘(앞 두 장이 꽉 차고 마지막 장에 남는 것 · 띠 길이 조합으로 세 장 → 두 장).
- `workers/workflow-api/test/cut-plan.test.js` — `validateCutPlan` 각 규칙, `createSnapshot` INSERT 행(`cut_plan_payload`·`sheet_count`·NULL), 컬럼 미적용 DB 폴백.
- `__tests__/workflow-cut-plan-sql.test.js` — SQL 멱등·파괴 문장 없음·적용 안내.

## 6. TODO (다른 도메인 · 후속 PR)

- **`DrawingVisualizer.packParts` 제거** (`js/detaildesign/extractors.js:1685`, BOM 도메인이지만 이 PR 과 동시에 다른 세션이 수정 중이라 뺐다). `DadamAgent.generateDrawings` 가 `NestingEngine.plan` 의 시트를 그리도록 바꾼 뒤 지운다.
- **`NestingOptimizer` 제거** (`js/detaildesign/persistence-init.js:9`, Design UI 도메인). `showNestingOptimizer` 모달을 CNC 탭 '원판 배치' 로 대체하거나 `window._cncData.cutPlan` 을 읽게 한다.
- 자재별 원판 크기·결 방향을 어디서 받을지 [확인 필요] — 지금은 `bom.materials` 행에 `grain` 이 없어 이름 규칙(무늬목·우드·결 PET)만 작동한다. 카탈로그(`materials-catalog-v2.sql`)에 `grain`·`sheet_w/h` 를 두고 `extractors.js` 가 행에 실어 주면 엔진은 그대로 쓴다.
- B5 작업지시서: `cut_plan_payload.sheets[]` 로 시트별 재단표 + 배치 SVG 축소판, `parts[].partId` 로 부재 라벨 QR.
