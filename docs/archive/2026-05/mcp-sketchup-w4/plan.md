# Planner SketchUp 호환 전면 재설계 (Z-up, corner-anchor)

> 이전 plan (center→corner fix) 은 PR 머지 + 데모로 완료. 본 plan 은 새 task — 사용자가 `tmp/sketchuptest` 결과를 보고 "planner 자체를 SketchUp 로직/구조에 호환되도록" 변경 요청.

## Context

W3-4 디자이너 PC E2E 시도에서 발견된 문제들:
1. **center→corner 변환 누락** — 머지 (#262 후속 hotfix) 로 해결
2. **origin align 누락** — 해결 (가구 좌하단을 SketchUp 원점에 정렬)
3. **rotationY 처리 누락** — 차선(secondary) 모듈이 SketchUp 에서 회전 안 됨 (planner UI 의 L자 → SketchUp 에서 흩어진 막대기)
4. **머티리얼 미적용** — set_material 호출 없음 (mhyrr 가 create_component 의 material 필드 무시)
5. **좌표/단위/회전 보정 로직이 mcp-server 측에 누적** — 매번 변환 함수 호출, 한 곳에서 빠지면 즉시 어긋남

사용자 결정 (옵션 C): **planner-vite 의 `lib/planner.ts` 자체를 SketchUp 좌표계/관례로 변경**. UI 렌더링 (Three.js) 도 Z-up. 변환 함수 제거, 무손실 호환.

탐색 결과 (Phase 1):
- `planner-vite/src/lib/planner.ts` (1644 LOC) — deriveCabinet 가 3단계 변환 (PlannerState → CabinetModule[] → CabinetPart[] 평탄화). Y-up mm 중심.
- `planner-vite/src/App.tsx` (1110 LOC) — Three.js 렌더, boxGeometry args/mesh.position 모두 Y-up.
- mhyrr v0.1.0 (실 검증) — Z-up inch corner, ComponentDefinition 미지원, transform_component (누적 변환) + set_material 지원.
- `lib/planner.ts` (root, 854 LOC) — planner-vite 와 별도 미러. PRESETS / 타입만 외부에서 사용 (BOM/image-gen 은 자체 DTO 사용 — 영향 없음 확인).
- `components/planner/{DadamPlanner,EmbedCanvas}.tsx` — legacy (replaced by planner-vite). Deprecate 권장.

## A. 새 데이터 모델 (`CabinetPart` v2)

```ts
// planner-vite/src/lib/planner.ts + mcp-server/src/types/planner.types.ts (mirror)
export interface CabinetPart {
  id: string;
  label: string;

  // 좌표계: Z-up, right-handed (SketchUp native)
  //   x = 가로 (좌↔우, +x 우측)
  //   y = 깊이 (정면↔벽, +y 벽 방향)
  //   z = 수직 (바닥↔천장, +z 위)
  // 단위: mm (mcp-server 에서만 inch 변환)
  // 기준점: 박스 최소 모서리 (AABB min-corner, 회전 전)
  //   = (x_min, y_min, z_min) before rotation
  x: number;
  y: number;
  z: number;
  width:  number;  // 가로 (+x 방향 extent)
  depth:  number;  // 깊이 (+y 방향 extent)
  height: number;  // 수직 (+z 방향 extent)

  // 회전: Z축 (수직) 중심, degree, CCW. 코너 (x,y,z) 가 pivot.
  // 0 = 도어가 -y 방향 (정면 보임), 90 = +x, -90 = -x, 180 = +y.
  // 캐비닛은 수직축 회전만 — quaternion/matrix 불필요.
  rotationZDeg?: number;

  // 시맨틱/렌더링 — 기존 유지
  colorKey: ColorKey;
  wireframe?: boolean;
  essential?: boolean;
  moduleType?: ModuleType;
  moduleKind?: ModuleKind;
  doorCount?: number;
  drawerCount?: number;
  isDoor?: boolean;
  parentModuleId?: string;
  doorIndex?: number;
  openDirection?: DoorOpenDirection;
}
```

**제거되는 항목**: `plannerToSketchup()`, center→corner shim, `originAlign` 의 center 보정 분기, `rotationY` (radians, Three.js Y축).

**유지되는 항목**: `ColorKey × MaterialTone` 색상 시스템 (semantic, 활용도 높음).

## B. 단계별 PR 분할 (W4-1 ~ W4-6)

각 단계는 독립 머지/롤백 가능, 단계마다 vitest 그린.

### W4-1 — mcp-server 측 V2 shim 도입 (저위험, ~1일)
- `mcp-server/src/types/planner.types.ts` 에 `CabinetPartV2` 추가 (CabinetPart v1 와 공존)
- `sketchup-builder.service.ts` 에 `migrateV1ToV2(part) → CabinetPartV2` 함수
- `partToCommand` 가 V2 만 받도록 리팩터 (V1 은 migrateV1ToV2 통과)
- 기존 변환 4종 (Y-up→Z-up, center→corner, mm 유지, rotationY→rotationZDeg) 모두 migrate 안에 흡수
- **검증**: 기존 vitest 가 byte-identical 명령 생성. V2 round-trip 신규 테스트 +10개
- **회귀 위험**: 0 — 외부 API 변경 없음, partToCommand 내부 리팩터

### W4-2 — planner-vite/src/lib/planner.ts 재작성 (고위험, ~3-4일)
- `deriveCabinet` 의 모든 `parts.push({...})` (~20곳) 재작성:
  - y↔z swap (Y-up → Z-up)
  - center → corner (`x - width/2`, `y` → `z`, 등)
  - `rotationY: ±Math.PI/2` → `rotationZDeg: ∓90` (CCW 부호 주의)
  - 필드 이름 변경 (`width/height/depth` 의미 명확화)
- `planner-vite/src/lib/coords.ts` 신규 — `cornerToCenter(part)`, `rotateAroundCorner` 헬퍼 (renderer 용)
- `sketchup-client.ts` — V2 직접 전송
- **검증 (keystone)**: snapshot 테스트로 "옛 deriveCabinet → migrateV1ToV2" 와 "새 deriveCabinet 직접" 결과 동일성 검증. 6 preset × 3 layout shape (I/L/U) 전수.
- **회귀 위험**: 고 — 단위 테스트 통과 + planner UI 시각 검증 후만 머지

### W4-3 — App.tsx 렌더러 Z-up 전환 (~2일)
- `THREE.Object3D.DEFAULT_UP.set(0, 0, 1)` 모듈 최상단
- `<PerspectiveCamera up={[0,0,1]} position={[x, y_was_z, z_was_y → ...]}>` 재계산
- `<OrbitControls target={[0, 0, 900]}>` (이전 `[0, 900, 0]`)
- `<directionalLight position={[1800, 1200, 2200]}>` (z 수직 기준)
- `ModuleBox`: `<group position={[posX + w/2, posY + d/2, posZ + h/2]}>` (mesh.position 은 center, part 는 corner)
- `<boxGeometry args={[w, d, h]}>` (X-Y-Z extent 순서)
- 드래그 axis: primary X 그대로, secondary 의 Z → Y 로 변경
- 회전: `rotation={[0, 0, deg2rad(part.rotationZDeg)]}` (이전 `[0, rotationY, 0]`)
- **검증**: Playwright/vitest screenshot, 6 preset 정면+원근 캡처. 1주 feature flag `VITE_PLANNER_Z_UP=1` A/B
- **회귀 위험**: 시각적 고 / 논리적 중. 체크리스트: 메인/secondary 드래그, top 뷰 치수 라벨, popup 앵커

### W4-4 — mcp-server V1 shim 제거 (~0.5일)
W4-2/W4-3 prod 1주 안정 후:
- `CabinetPart` V1 삭제, `CabinetPartV2` → `CabinetPart` rename
- `migrateV1ToV2` 삭제
- `partToCommand` 단순화:
  ```ts
  position:   [mmToInch(part.x), mmToInch(part.y), mmToInch(part.z)],
  dimensions: [mmToInch(part.width), mmToInch(part.depth), mmToInch(part.height)],
  ```
- `plannerToSketchup` 삭제 (constants/sketchup.ts)
- `sketchup.schema.ts` `cabinetPartSchema` 필드 갱신 (`rotationZDeg` 추가)
- `sync-planner.mjs` 미러 갱신
- **회귀 위험**: 저 — 삭제만

### W4-5 — 회전 + 머티리얼 mhyrr 명령 추가 (~1.5일)
- `partToCommand` 가 3개 명령 시퀀스 생성:
  1. `create_component` (cube)
  2. `rotationZDeg ≠ 0` 이면 `transform_component` { axis: [0,0,1], angle, origin: position }
  3. `set_material` { component_id, material_name: `dadam_{tone}_{colorKey}` }
- 머티리얼 사전 등록: 빌드 시작 시 1회 `eval_ruby` (allowlist 신규 키 `ENSURE_MATERIALS`) 로 16개 머티리얼 (4 tone × 4 key) idempotent 추가
- 컴포넌트 식별: mhyrr 가 entity ID 반환 안 하면 outliner name (`dadam.{cat}.{partId}`) 으로 lookup (`eval_ruby` allowlist `FIND_BY_NAME`)
- 명령 순서: `START_OP → ENSURE_MATERIALS → CLEAR? → (create+transform?+set_material) × N → COMMIT_OP`
- **검증**: 단위 테스트 + 디자이너 PC E2E (secondary 90° 회전 검증, 도어 머티리얼 시각 차이, Ctrl+Z 단일 undo)
- **회귀 위험**: 중 — `transform_component` 누적 변환 주의. 명시적 corner+rotation 테스트

### W4-6 — legacy 코드 정리 (~1일)
- `components/planner/{DadamPlanner,EmbedCanvas}.tsx` 사용처 grep 후 deprecate/delete
- `lib/planner.ts` (root) — `app/page.tsx` 의 PRESETS 만 사용. preset table 은 좌표 없으므로 영향 없음
- `bom.service.ts` 는 `StructuredDesignData` (자체 DTO) — 독립, 영향 없음 (grep 확인 완료)
- **회귀 위험**: 저

## C. 회전 + 머티리얼 명령 시퀀스

각 부품당 mhyrr 명령:
```
create_component   (cube, position=corner, dimensions)
  ↓ (rotationZDeg ≠ 0 시)
transform_component (axis=[0,0,1], angle=rotationZDeg, origin=position)
  ↓
set_material        (material_name='dadam_{tone}_{key}')
```

`transform_component` 의 누적 변환은 컴포넌트 생성 직후 1회만 호출하므로 안전. 머티리얼은 빌드 시작 시 1회 사전 등록 (16개 idempotent) → 부품 빌드 시 fast lookup.

## D. 위험 / 호환성

- **Supabase 저장 디자인**: `PlannerState` (사용자 입력만, 좌표 없음) — `deriveCabinet` 으로 재계산. 마이그레이션 불필요 ✓ (확인됨, line 59-93)
- **다른 도메인**: BOM (자체 DTO), image-gen (좌표 미사용) — 영향 없음 ✓
- **Three.js Z-up**: 공식 지원 (`Object3D.DEFAULT_UP` + camera.up). OrbitControls/ContactShadows/Environment 모두 orientation-agnostic
- **디자이너 PC E2E**: W4-5 머지 전 필수. feature flag `MCP_SKETCHUP_ROTATE_MATERIAL=1` 으로 안전 ramp

## E. 검증 전략

- **Vitest 단위**: sketchup-builder 기존 + V2, migrateV1ToV2 round-trip, deriveCabinet snapshot 동일성 (W4-2 keystone)
- **Vitest 통합**: route + bridge + mhyrr mock 명령 시퀀스
- **디자이너 PC E2E**: 6 preset × 3 layout shape (I/L/U) — `mcp-server/scripts/sketchup-e2e/`
- **시각 회귀**: Playwright snapshot (planner-vite 6 preset 정면+원근), W4-3 동안 feature flag 로 1주 A/B

## Critical Files

| 파일 | 영향 |
|------|------|
| `planner-vite/src/lib/planner.ts` (1644 LOC) | **W4-2 재작성** — 모든 parts.push 갱신, 회전 부호 |
| `planner-vite/src/App.tsx` (1110 LOC) | **W4-3 Z-up 전환** — camera/light/orbit/mesh |
| `planner-vite/src/lib/coords.ts` (신규) | corner↔center 헬퍼 |
| `planner-vite/src/lib/sketchup-client.ts` | V2 직접 전송 |
| `mcp-server/src/types/planner.types.ts` | V2 타입 (W4-1) → V1 제거 (W4-4) |
| `mcp-server/src/services/sketchup-builder.service.ts` | migrate (W4-1) → 단순화 (W4-4) → 회전/머티리얼 (W4-5) |
| `mcp-server/src/constants/sketchup.ts` | `plannerToSketchup` 제거 (W4-4), `ENSURE_MATERIALS`/`FIND_BY_NAME` allowlist 추가 (W4-5) |
| `mcp-server/src/schemas/sketchup.schema.ts` | V2 필드 (W4-4) |
| `mcp-server/scripts/sync-planner.mjs` | EXPORTS_TO_SYNC 갱신 |
| `mcp-server/tests/sketchup-builder.service.test.ts` | 전수 갱신 |
| `mcp-server/tests/sketchup.route.test.ts` | 갱신 |
| `components/planner/{DadamPlanner,EmbedCanvas}.tsx` | **W4-6 deprecate/delete** |
| `lib/planner.ts` (root) | sync 미러 또는 deprecate |

## 예상 일정

- W4-1: 1일 / W4-2: 3-4일 / W4-3: 2일 / W4-4: 0.5일 / W4-5: 1.5일 / W4-6: 1일
- 총 **~9-10일** (한 사람 기준, 검증 시간 포함)
- 단계 사이 1주 prod 안정성 관찰 권장 → 실제 약 **3-4주**

## Out of Scope (별건)

- mhyrr fork (ComponentDefinition + persistent connection)
- 텍스처 (RGB 외 목재 무늬)
- BIM/IFC export
- 동시 빌드 큐잉, SSE 진행률 UI 통합
