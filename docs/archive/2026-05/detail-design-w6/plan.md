# Detail Design 3단계 워크플로우 재구성 (Top View 배치 + 모듈 section)

> 이전 plan (Z-up corner-anchor) 은 sketchup W4 사이클로 완료 + archive. 본 plan 은 새 task — 사용자가 detail design 워크플로우를 **"Top view 에서 가구 배치 → 모듈 구조 → 디테일"** 의 3단계로 재구성 요청.

## Context

현재 detail design 워크플로우는 **카테고리 우선** 입력 — 사용자가 sink/wardrobe/vanity 등 6 preset 중 하나 고르고, 모듈을 수동 추가. 한계:

1. **fullHeight binary 분기** — preset.fullHeight=true (wardrobe/shoe/fridge/storage) 면 키큰장만, false (sink/vanity) 면 하부+상부. **한 가구 안에 키큰장+하부장+상부장 혼합 불가**.
2. **Top View 인터랙티브 X** — 현재 카메라 극상단(z=2400) + group 회전만, 드래그/추가 불가 (App.tsx L737-742 view='top')
3. **layoutShape I/L/U 만** — secondary/tertiary 차선 모듈로 ㄱ자/ㄷ자 표현하지만 임의 polygon (ㄴ자, ㅁ자) 불가
4. **모듈 단위 디테일 (높이 override, 색상별 도어) 표현 어려움** — preset 의 lowerHeight/upperHeight 가 가구 전체 고정

사용자 결정 (4 핵심):
- **단위**: 한 가구 (multi-cabinet X), 그 안에서 여러 **segment (사각형)** 자유 배치 + 90° snap 회전 → ㄱ자/ㄷ자/임의 구조
- **카테고리**: 보조 라벨로 강등 (BOM/이미지 힌트, optional)
- **3단계**: 배치(segments) → 구조(section: lower/upper/tall) → 디테일(높이/도어/색상)
- **구현 위치**: planner-vite 자체 확장 (옵션 B). detaildesign.html 은 iframe wrapper 로 유지.

## 코드베이스 탐색 결과 (Phase 1)

- `planner-vite/src/lib/planner.ts` (1704 LOC) — PlannerState (L63-97), ModuleEntry (L50-61), PRESETS (L207-322 — fullHeight binary), deriveCabinet (L957-1689)
- `planner-vite/src/App.tsx` (1518 LOC) — 좌측 패널 없음, 3D 캔버스 직접 +버튼/팝업, ModulePopup (L413-511), LayoutSetupPanel (L548-702), view 토글 (L737-738)
- `js/detaildesign/ui-step1.js` (~2700 LOC) — Step 1 stepper, `_syncPlannerState` (L584-629) 가 lowerModules/upperModules 분리 후 postMessage UPDATE_PLANNER
- `js/detaildesign/ui-workspace.js` (1000+ LOC) — Step 2 좌측 모듈 추가 form (preset 별 분기 wardrobe/fridge/...)
- `js/detaildesign/extractors.js` (1127 LOC) — BOM 추출 (pos='lower'/'upper'/'wardrobe' 필터링, L101-209)
- `mcp-server/src/services/sketchup-import.service.ts` (~700 LOC) — ReconstructedPlannerData 가 lowerModules/upperModules 만 반환
- `planner-vite/src/lib/sketchup-client.ts` (378 LOC) — ImportedPlannerData 타입 (L145-200)

## A. 새 데이터 모델 (`planner-vite/src/lib/planner.ts`)

기존 PlannerState 의 lowerModules/upperModules/layoutShape/secondary*/tertiary* 는 **deprecated 표기 후 W6-2~W6-6 공존**, W6-8 에서 제거.

```ts
// 신규 — Top view 평면 segment (Step 1)
export type Rotation90 = 0 | 90 | 180 | 270;

export interface CabinetSegment {
  id: string;
  x: number;          // mm, 회전 전 좌하단 (+x 우측, +y 후방)
  y: number;
  width: number;      // 회전 전 +x extent
  depth: number;      // 회전 전 +y extent
  rotationDeg: Rotation90;
  label?: string;     // "ㄱ자 좌측" 등
}

// 신규 — 통합 모듈 (section + segmentId)
export type ModuleSectionV2 = 'lower' | 'upper' | 'tall';

export interface ModuleEntryV2 {
  id: string;
  segmentId: string;
  section: ModuleSectionV2;
  kind: 'door' | 'drawer' | 'open';
  width: number;
  heightOverride?: number;   // Step 3 모듈별 높이 조정
  depthOverride?: number;
  moduleType?: ModuleType;
  doorCount?: number;
  drawerCount?: number;
  doorColor?: string;        // Step 3
  doorFinish?: string;       // Step 3
}

// PlannerState 확장
export interface PlannerState {
  presetId: CabinetCategory;  // 보조 라벨 (BOM 힌트, 자동 모듈 배치 활성 조건)
  width: number; height: number; depth: number;
  material: MaterialTone;
  moldingH: number; toeKickH: number;
  finishLeftW: number; finishRightW: number;

  // 신규 (W6-1 도입)
  schemaVersion: 2;
  segments: CabinetSegment[];
  modulesV2: ModuleEntryV2[];
  step?: 'layout' | 'structure' | 'detail';
  tallHeight?: number;

  // legacy (W6-1 ~ W6-7 공존, W6-8 제거)
  /** @deprecated W6-8 제거. 대신 segments[] */
  layoutShape?: 'I' | 'L' | 'U';
  lowerModules?: ModuleEntry[];
  upperModules?: ModuleEntry[];
  lowerCount?: number; upperCount?: number;
  secondaryW?: number; secondaryD?: number;
  tertiaryW?: number; tertiaryD?: number;
  secondaryStartSide?: 'left' | 'right';
  tertiaryStartFrom?: 'prime' | 'secondary';
  secondaryFillerW?: number;
  distributorStart: number | null;
  distributorEnd: number | null;
  ventStart: number | null;
}
```

### Migration 규칙 (`migrateLegacyToV2`)

| Legacy | V2 |
|---|---|
| `layoutShape='I'` | `segments=[{x:0,y:0,width:state.width,depth:state.depth,rotationDeg:0,label:'주선'}]` |
| `layoutShape='L'` (`secondaryStartSide='left'`) | `[prime, {x:-secondaryD, y:0, width:secondaryD, depth:secondaryW, rotationDeg:0, label:'차선'}]` |
| `layoutShape='L'` (right) | `[prime, {x:state.width, y:0, width:secondaryD, depth:secondaryW, rotationDeg:0, label:'차선'}]` |
| `layoutShape='U'` | prime + secondary + tertiary 3개 (`tertiaryStartFrom` 분기) |
| `lowerModules[i]` (`orientation='normal'`) | `{...m, segmentId:'prime', section: preset.fullHeight ? 'tall' : 'lower'}` |
| `lowerModules[i]` (secondary/tertiary) | 해당 segment 의 modules |
| `upperModules` | `{...m, section:'upper'}` |
| `moduleType='blind-corner'`/`'corner-filler'` | modules[] 제거, segment edge `cornerFiller` 플래그로 표시 (`deriveCabinetV2` 자동 생성) |

## B. PR 시리즈 (W6-1 ~ W6-8, 총 8.5일)

각 PR 독립 머지/롤백 가능, 단계마다 vitest + Playwright 그린, 회귀 0.

### W6-1: 데이터 모델 + migration 함수 (0.25일)
- `planner-vite/src/lib/planner.ts` L9 부근에 `CabinetSegment`/`ModuleEntryV2`/`Rotation90` export, L63-97 PlannerState 에 V2 필드 추가 (legacy JSDoc @deprecated).
- 동 파일 끝부분에 `migrateLegacyToV2(s)` + `isV2State(s)` 추가.
- 신규 `planner-vite/src/lib/__tests__/migration.test.ts` — 8 케이스 (I/L-left/L-right/U-prime/U-secondary × fullHeight on/off, blind-corner 통합, V2 idempotent).
- App.tsx/deriveCabinet 변경 0. **회귀 0**.

### W6-2: `deriveCabinetV2` + golden test (1일)
- `planner-vite/src/lib/planner.ts` L957-1689 의 `deriveCabinet` 에 분기 추가 — V2 입력은 `deriveCabinetV2` 호출, 아니면 `migrateLegacyToV2` 후 호출.
- `deriveCabinetV2`:
  - `segments[]` 순회 → 각 segment 회전 행렬 → world 좌표 변환
  - `modulesV2[].segmentId` grouping → segment local 좌표 → world
  - 코너 필러/멍장은 segment 인접 edge 에서 자동 생성 (기존 L1046-1100 chain 좌표를 segment chain 으로 1:1 포팅)
  - 출력 `CabinetPartV2[]` (App.tsx 렌더 변경 0)
- 신규 `deriveCabinet-v2.test.ts` — 10 케이스 (I/L-left/L-right/U/U-secondary × 6 preset) 의 `deriveCabinet(legacy)` vs `deriveCabinetV2(migrate(legacy))` part.x/y/z ±1mm 일치.
- **회귀**: legacy → V2 round-trip 동등성 — 기존 vitest snapshot 모두 통과.

### W6-3: Step 1 — SegmentEditor (Top View 인터랙티브) (2일)
- 신규 `planner-vite/src/components/SegmentEditor.tsx` (~400 LOC)
- App.tsx 변경:
  - L737-742 부근 `step` state 추가 (`'layout' | 'structure' | 'detail' | null`)
  - top view + `step==='layout'` 시 SegmentEditor 오버레이
- SegmentEditor 기능:
  - SVG 2D 캔버스 (mm → px scale, 1500x1500 grid, 50mm snap)
  - segments[] 표시 (회전 반영 사각형, label, ±handle)
  - "+ Segment 추가" 버튼 → 기본 1500x600 추가 (커서 위치)
  - 드래그 이동, 회전 (90° 4 방향 토글), 삭제 (X), width/depth 직접 입력
  - 인접 segment edge auto-snap (10mm 이내)
  - 하단 "구조 배치로 →" → `step='structure'`
- 신규 `SegmentEditor.test.tsx` — 추가/드래그/회전/삭제 4 케이스.

### W6-4: Step 2 — StructureEditor (모듈 section 배치) (1.5일)
- 신규 `planner-vite/src/components/StructureEditor.tsx` (~350 LOC)
- 로직:
  - segments[] 3D + top inset 시각화
  - 활성 segment 선택 (top-view 클릭) → 우측 패널에 모듈 list
  - 모듈 ±/추가 버튼, **section radio 3 (lower/upper/tall)**
  - tall 추가 시 동일 X 범위의 lower/upper 자동 제거 확인 다이얼로그
  - 자동 배치: `autoCalculateModulesV2(state, segmentId)` (기존 `autoCalculateModules` segment 버전)
  - 하단 "디테일 →" → `step='detail'`
- App.tsx L988-998 의 `addLower`/`addUpper`/`deleteMod`/`updateMod` 를 V2 시그니처 (`addModule(segmentId, section)`, `updateModule(id, changes)`) 로 확장 (legacy 어댑터 유지).

### W6-5: Step 3 — ModulePopup 확장 (디테일) (1일)
- `App.tsx` L413-511 `ModulePopup` 확장 — V2 모듈만:
  - 높이 (`heightOverride`) — section 기본값 + 슬라이더 + 직접 입력
  - 도어 유무 (kind: door/drawer/open 유지)
  - 서랍 수 (drawerCount: 1-5), 도어 수 (doorCount: 1-2)
  - 재질 (`doorFinish` select), 색상 (`doorColor` select)
- 하단 "완료" → `step` clear, 일반 편집 모드.

### W6-6: Step indicator + URL 동기화 (0.5일)
- App.tsx 상단 3단계 progress bar (배치 → 구조 → 디테일)
- URL `?step=layout|structure|detail` 양방향
- postMessage `STEP_CHANGE` 부모(detaildesign) 전파
- `LayoutSetupPanel` (L548-702): V2 모드에서 숨김, V1 만 표시 (마이그레이션 배너).

### W6-7: 외부 어댑터 (1일)
- `js/detaildesign/ui-step1.js` L581-690 `_syncPlannerState` — `item.modules` → V2 PlannerState 변환, legacy + V2 payload 동시 송신 (양쪽 호환)
- `js/detaildesign/extractors.js` L101-209 — section='tall' 케이스 추가, pos 매핑 (`lower`/`upper`/`wardrobe`→`tall`)
- `mcp-server/src/services/sketchup-import.service.ts` L383-512 `reconstructPlannerData` — segments[] (단일 segment 'I') + modulesV2 optional 필드
- `planner-vite/src/lib/sketchup-client.ts` L145-200 — ImportedPlannerData 에 동일 필드
- `planner-vite/src/App.tsx` L944-985 `applyImportedData` — V2 우선 적용

### W6-8: legacy 필드 제거 (0.5일, 디자이너 PC 검증 후)
- PlannerState 의 `lowerModules`/`upperModules`/`layoutShape`/`secondary*`/`tertiary*` deprecated 필드 제거
- `deriveCabinet` V1 분기 제거, V2 only
- `LayoutSetupPanel` 완전 삭제
- `ui-step1.js` legacy payload 송신 제거 (V2 only)

## C. 백워드 호환

| 케이스 | 처리 |
|---|---|
| Supabase `design_items.modules` (detaildesign V0) | 변경 0. `_syncPlannerState` 어댑터에서 V2 변환 후 postMessage. |
| URL 파라미터 `?layoutShape=L&secondaryW=...` | App.tsx L719-726 파싱 후 즉시 `migrateLegacyToV2` 적용. |
| postMessage `UPDATE_PLANNER` legacy payload | App.tsx L767 setPlanner 내부 schemaVersion 없으면 migration 자동 호출. **외부 detaildesign 변경 0**. |
| SketchUp import (V0 PlannerState) | sketchup-import.service V2 필드 추가, `applyImportedData` V2 우선. |
| 기존 vitest snapshot | W6-2 의 deriveCabinetV2 가 동일 part 좌표 보장 (golden test). |

## D. 위험 / 미해결

| 위험 | 완화책 |
|---|---|
| ㄷ자 (tertiary from secondary) segment 표현 정확성 | W6-2 golden test 에 `tertiaryStartFrom='secondary'` 케이스 명시. L1046-1100 chain 좌표 1:1 포팅. |
| 코너 필러/멍장 → segment edge 자동 생성 변환 | W6-1 migration 에서 blind-corner/corner-filler 제거 후 segment edge `cornerFiller` 플래그. `deriveCabinetV2` edge 마다 휠라/멍장 생성. |
| detaildesign 의 `item.specs.lowerLayoutShape` 등과 V2 segments 동기화 | W6-7 `_syncPlannerState` 에서 V2→legacy 역변환도 함께 송신 (BOM 호환). |
| preset 강등 후 sink/cook/hood 고정모듈 자동 배치 | preset 유지 (보조 라벨). autoCalculateModulesV2 의 sink/cook/hood 는 preset='sink' + segment 1개일 때만 활성. |
| segment 회전 후 module width vs depth 의미 | segment local (+x=width, +y=depth) 고정. `deriveCabinetV2` 회전 행렬 적용 시 part.x/y 변환, width/depth 는 world 축 swap. |
| tall + lower/upper 같은 segment 공존 시 BOM 모순 | W6-4 UI 에서 tall 추가 시 동일 X 범위 lower/upper 자동 제거 + 확인 다이얼로그. |

## E. 검증 전략

- **Vitest 단위**: W6-1 migration 8 케이스, W6-2 golden test 10 케이스 (legacy ↔ V2 round-trip ±1mm)
- **Vitest 통합**: extractors.js (V2 + legacy 양쪽), sketchup-import.service (V2 출력)
- **Playwright**: `?step=layout` 직접 진입 → segment CRUD → `?step=structure` → section 배치 → `?step=detail` → 색상 변경 → BOM 산출
- **디자이너 PC E2E**: 새 워크플로우로 가구 → SketchUp 으로 보내기 → 기존 마킹/import 호환 확인
- **회귀**: 기존 vitest + detaildesign legacy V1 path 변경 0

## Critical Files

| 파일 | 현 LOC | 변경 폭 | 핵심 영역 |
|---|---|---|---|
| `planner-vite/src/lib/planner.ts` | 1704 | +500 / -200 | L9-97 타입, L344-369 createPlannerState, L435-955 autoCalculateModules, L957-1689 deriveCabinet |
| `planner-vite/src/App.tsx` | 1518 | +400 / -250 | L413-511 ModulePopup, L548-702 LayoutSetupPanel 제거, L737-998 step state |
| `planner-vite/src/components/SegmentEditor.tsx` | 0 (신규) | +400 | Step 1 SVG top-view |
| `planner-vite/src/components/StructureEditor.tsx` | 0 (신규) | +350 | Step 2 segment-별 모듈 배치 |
| `planner-vite/src/lib/__tests__/migration.test.ts` | 0 (신규) | +300 | 8 케이스 |
| `planner-vite/src/lib/__tests__/deriveCabinet-v2.test.ts` | 0 (신규) | +400 | 10 케이스 |
| `js/detaildesign/ui-step1.js` | ~2700 | +120 / -10 | L581-690 _syncPlannerState |
| `js/detaildesign/extractors.js` | 1127 | +80 / -20 | L101-209 BOM 추출 (section='tall') |
| `mcp-server/src/services/sketchup-import.service.ts` | ~700 | +50 | L383-512 reconstructPlannerData |
| `planner-vite/src/lib/sketchup-client.ts` | 378 | +20 | L145-200 ImportedPlannerData |

## 예상 일정

W6-1: 0.25일 / W6-2: 1.0일 / W6-3: 2.0일 / W6-4: 1.5일 / W6-5: 1.0일 / W6-6: 0.5일 / W6-7: 1.0일 / W6-8: 0.5일

총 **6.75일** + 디자이너 PC 검증 1일 버퍼 = **~7.75일** (6-9일 범위 내).

## Verification (end-to-end)

1. `cd planner-vite && pnpm test` — migration + deriveCabinet-v2 + SegmentEditor 테스트 모두 그린
2. `cd planner-vite && pnpm dev` → `http://localhost:5173/?step=layout` 진입 → segment 3개 추가 → ㄷ자 구성 → `?step=structure` → tall 모듈 2개 + lower 4개 + upper 3개 → `?step=detail` → 모듈 색상 변경
3. `cd mcp-server && pnpm test` — extractors V2, sketchup-import V2 통과
4. `dadamfurniture.com` (production) 로그인 → detail design → planner iframe 새 워크플로우 검증 (legacy V1 디자인 로드 시 자동 migration)
5. 디자이너 PC: 새 V2 가구 빌드 → SketchUp 으로 보내기 → 기존 sketchup-import 로 다시 가져오기 (round-trip)
6. BOM 산출: V2 가구 → /api/bom → tall 모듈 자재 포함 확인

## 즉시 시작 가능 — W6-1 작업 항목

1. `planner-vite/src/lib/planner.ts` L9 다음에 `CabinetSegment`/`ModuleEntryV2`/`Rotation90` export
2. 같은 파일 L63-97 PlannerState 에 V2 필드 추가 (기존 모두 deprecated JSDoc)
3. 파일 끝 (L1704 이후) 에 `migrateLegacyToV2(s)` + `isV2State(s)` 함수 추가 — 위 "Migration 규칙" 표 그대로
4. 신규 `planner-vite/src/lib/__tests__/migration.test.ts` — 8 케이스
5. `pnpm --filter planner-vite test` 통과 확인
6. 커밋: `W6-1: PlannerState V2 데이터 모델 + legacy 마이그레이션 함수 도입 (회귀 0)`

## Out of Scope (별 cycle)

- multi-cabinet (한 화면 여러 가구) — 사용자가 NO 결정
- 임의 회전 (90° 외 각도) — 사용자가 90 snap 결정
- 카테고리 (preset) 완전 폐기 — 보조 라벨로 유지
- BOM 의 새 모듈 디테일 (doorColor/doorFinish) 의 자재 코드 매핑 — 별 cycle (현재 BOM 은 color 미사용)
- AI 기반 segment 자동 추천 (기존 사진 분석 → segment[] 제안) — 향후 cycle
