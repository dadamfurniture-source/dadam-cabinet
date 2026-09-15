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

### 옵션

| 옵션 | 기본 | 뜻 |
|------|------|-----|
| `sheetSize {w,h}` | 전역 `SHEET_W/H` → 1220×2440 | 기본 원판 |
| `sheetSizes {'PB_15': {w,h}, 'PB': {w,h}}` | — | 자재(_두께)별 원판. `자재_두께` 키가 `자재` 키보다 우선 |
| `kerf` | 전역 `CUT_KERF` → 4 | 톱날. 조각 사이·스트립 사이 |
| `trim` | 10 | 네 변 가장자리 트림. 배치 가능 영역 = `(w-2·trim) × (h-2·trim)`, 좌표는 원판 좌상단 기준 절대값 |
| `noRotateMaterials [RegExp\|string]` | 무늬목 · 우드 · wood · 결 PET · PET(우드/결) | 자재 이름으로 회전 금지 |
| `partClass fn(partName)` | `partClassOf` | 원판을 섞지 않는 그룹을 가르는 부재 구분 |

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

## 5. 시험

- `__tests__/nesting-engine.test.js` — 골든 5벌: 결정성(순서 뒤집어도 같은 JSON), 수량 보존(`partId#k` 정확히 한 번, 미배치 포함), 겹침 없음·트림 안쪽·커프 간격, 겹침 재단 시트의 배치 동일성, offcuts 정합, 옵션(결·회전 금지·원판 크기·트림·커프), `detaildesign.html` 스크립트 순서.
- `workers/workflow-api/test/cut-plan.test.js` — `validateCutPlan` 각 규칙, `createSnapshot` INSERT 행(`cut_plan_payload`·`sheet_count`·NULL), 컬럼 미적용 DB 폴백.
- `__tests__/workflow-cut-plan-sql.test.js` — SQL 멱등·파괴 문장 없음·적용 안내.

## 6. TODO (다른 도메인 · 후속 PR)

- **`DrawingVisualizer.packParts` 제거** (`js/detaildesign/extractors.js:1685`, BOM 도메인이지만 이 PR 과 동시에 다른 세션이 수정 중이라 뺐다). `DadamAgent.generateDrawings` 가 `NestingEngine.plan` 의 시트를 그리도록 바꾼 뒤 지운다.
- **`NestingOptimizer` 제거** (`js/detaildesign/persistence-init.js:9`, Design UI 도메인). `showNestingOptimizer` 모달을 CNC 탭 '원판 배치' 로 대체하거나 `window._cncData.cutPlan` 을 읽게 한다.
- 자재별 원판 크기·결 방향을 어디서 받을지 [확인 필요] — 지금은 `bom.materials` 행에 `grain` 이 없어 이름 규칙(무늬목·우드·결 PET)만 작동한다. 카탈로그(`materials-catalog-v2.sql`)에 `grain`·`sheet_w/h` 를 두고 `extractors.js` 가 행에 실어 주면 엔진은 그대로 쓴다.
- B5 작업지시서: `cut_plan_payload.sheets[]` 로 시트별 재단표 + 배치 SVG 축소판, `parts[].partId` 로 부재 라벨 QR.
