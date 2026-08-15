# mcp-sketchup-w5 Plan — Planner Three.js Z-up 본격 전환

> **선행**: mcp-sketchup-w4 (78% 강행 보고서, archived)
> **목적**: W4 keystone 미달 (W4-3 Three.js Z-up) 해소. W4-3a 의 useMemo 어댑터 (V2→V1) 부담 제거.
> **기간**: ~2일 + 1주 feature flag A/B = **~9일 lead time**
> **회귀 위험**: 시각적 高 / 논리적 中

## 배경

W4 사이클에서 mcp-server 송신 경로는 V2 (Z-up corner mm degrees) 로 통일됐으나, planner-vite 의 렌더 경로는 V1 (Y-up center mm radians) 유지. `App.tsx:747` 의 `useMemo` 어댑터 (`migratePartV2ToV1`) 가 매 deriveCabinet 호출마다 N 개 part 양방향 변환 — 코드 가독성 + 성능 부담.

본 사이클은 **렌더 path 도 V2 native** 로 전환하여 어댑터 제거.

## 단계별 PR 분할 (W5-1 ~ W5-6)

각 단계 독립 머지/롤백, 단계마다 vitest 그린 + feature flag (`?planner3d=zup`) 격리.

### W5-1 — Three.js DEFAULT_UP=Z-up + feature flag (~0.5일)
- `App.tsx` 최상단: `THREE.Object3D.DEFAULT_UP.set(0, 0, 1)` (feature flag 검사 후)
- `<PerspectiveCamera up={[0,0,1]} position={...}>` 재계산
- `<OrbitControls target={[0, 0, 900]}>` (이전 `[0, 900, 0]`)
- `<directionalLight position={[1800, 1200, 2200]}>` (z 수직 기준)
- `<ContactShadows>` rotation 검증
- URL 파라미터 `?planner3d=zup` 으로 활성화. 기본 false (기존 동작).
- **회귀 위험**: 시각 高 (전체 카메라 전환), 활성 사용자 0 (feature flag)
- 검증: Playwright/vitest snapshot, 6 preset 정면+원근

### W5-2 — ModuleBox / UtilityMesh V2 native (~1일)
- ModuleBox 가 `CabinetPartV2` 직접 받음 (V1 어댑터 인터페이스 제거)
- `<group position={[part.x + part.width/2, part.y + part.depth/2, part.z + part.height/2]}>` — cornerToCenter 계산
- `<boxGeometry args={[part.width, part.depth, part.height]}>` — V2 extent 순서
- `rotation={[0, 0, deg2rad(part.rotationZDeg ?? 0)]}` — Z축 (degree → radian)
- `coords.ts` 에 `cornerToCenter(part)` helper 추가
- popup 앵커 (DimLabel, blindPanel +/✓ 버튼, Html position) 좌표 재계산
- feature flag 미적용 시 V1 어댑터 path 유지 (점진 마이그레이션)
- **회귀 위험**: 시각 中 (mesh 위치/회전 변경)

### W5-3 — 드래그 axis 재정의 (~0.5일)
- `classifyPart` 의 `dragAxis: 'x' | 'z'` → `'x' | 'y'` (V2 의 y=깊이)
- ModuleBox 의 plane.normal 재계산:
  - primary `(1,0,0)` (X축 plane, 그대로)
  - secondary `(0,1,0)` (V2 Y축 plane, 이전 Z-up 의 z plane)
- dragOrigin / posX / posY 좌표 재배치

### W5-4 — DimLabel 좌표 재계산 (~0.5일)
- `DimLabel position={...}` 의 V2 좌표 의미 반영
- 모듈 라벨: `[mp.x + mp.width/2, mp.y - 20, mp.z + mp.height + 30]` 등
- 가구 가로/높이 라벨 (`[0, -30, depth/2+80]`) → `[width/2, -30, 80]` 등

### W5-5 — useMemo 어댑터 제거 (~0.5일)
- `App.tsx:747` 의 `partsV1` useMemo 삭제
- `coords.ts` 의 `migratePartV2ToV1` 삭제
- 모든 `partsV1.find / filter / map` → `derived.parts.find / filter / map`
- W5-1~W5-4 머지 + 1주 prod 안정성 관찰 후만 진행

### W5-6 — feature flag 제거 + 기본값 활성화 (~0.5일)
- `?planner3d=zup` 파라미터 검사 제거
- DEFAULT_UP=Z-up 무조건 적용
- 1주 prod 안정성 관찰 (W5-5 머지 후) 확인 후

## Critical Files

| 파일 | 영향 |
|------|------|
| `planner-vite/src/App.tsx` (1187 LOC) | **W5-1/2/3/4/5/6 핵심** — camera/light/orbit/mesh/rotation 모두 재배치 |
| `planner-vite/src/lib/coords.ts` | W5-2 cornerToCenter 추가, W5-5 migratePartV2ToV1 제거 |
| `planner-vite/src/lib/planner.ts` | 변경 없음 (deriveCabinet 출력 V2 그대로) |
| `planner-vite/src/lib/sketchup-client.ts` | 변경 없음 |

## 검증 전략

### Vitest
- 기존 32/32 그린 유지 (coords round-trip 등)
- W5-2 cornerToCenter unit test 추가

### Playwright (옵션, 도입 안 됐으면 생략)
- 6 preset × 3 view (perspective/front/top) × 2 flag 상태 = 36 snapshot
- 위치 픽셀 차이 < 5px 허용

### 디자이너 PC E2E
- W4 의 11/11 명령 시퀀스 그대로 작동 확인 (송신 경로는 변화 없음, 렌더만 변화)
- secondary 90° 모듈의 SketchUp 결과 planner UI 와 시각적 일치
- 비정사각 박스 회전 케이스 (별도, W5-7 corner-pivot 보정과 같이)

### Feature Flag A/B (1주)
- `?planner3d=zup` 활성/비활성 동시 운영
- 사용자 피드백 수집 (디자이너 검수)
- 회귀 신호 시 즉시 flag off

## 위험 + 회복 전략

### 시각 회귀 (높음)
- **위험**: 카메라 위치/시점이 사용자에게 익숙한 각도에서 어긋나면 작업 흐름 방해
- **회복**: feature flag off (즉시) + camera position 미세 조정 후 재배포

### 회전 부호 (중)
- **위험**: V2 rotationZDeg degrees + Z축 회전 → Three.js Y-up 시절의 rotationY radians + Y축 회전과 부호 다를 수 있음
- **검증**: 수학적 동일성 — V1 의 (rotationY=π/2, Y-up Y축) == V2 의 (rotationZDeg=90, Z-up Z축) — 이건 좌표축 변환 시 동일 회전 효과 (이미 W4-1 migration 에서 검증)
- **회복**: rotation 부호 케이스 테스트 (±90, ±180) + 디자이너 PC 시각 검증

### 드래그 (낮음)
- **위험**: secondary 모듈 드래그 시 Z→Y axis 변경 누락하면 wrong direction
- **회복**: classifyPart 로직 + ModuleBox dragAxis 동시 변경 (한 PR 내)

## 일정

| 단계 | 작업 | 누적 |
|------|------|------|
| W5-1 | Three.js Z-up + feature flag | 0.5일 |
| W5-2 | ModuleBox V2 native | 1.5일 |
| W5-3 | 드래그 axis | 2일 |
| W5-4 | DimLabel | 2.5일 |
| (소강) | 1주 prod 안정 관찰 | 9.5일 |
| W5-5 | 어댑터 제거 | 10일 |
| W5-6 | flag 제거 | 10.5일 |

## Out of Scope (별 PDCA cycle)

- **W5-7 비정사각 corner-pivot 보정** — mhyrr transform_component 의 position+rotation 조합 (W4 의 H 갭, 별 cycle)
- **W4-6c legacy components/planner 일괄 삭제** — production 트래픽 검증 후
- **mhyrr fork** — origin/axis 파라미터 추가, ComponentDefinition 지원

## 성공 기준

- `useMemo` 어댑터 제거 (round-trip 변환 부담 해소)
- vitest 그린 유지
- 디자이너 PC E2E (mhyrr 11/11) 유지
- feature flag A/B 1주간 시각 회귀 보고 0건
- planner UI 시각 = SketchUp 빌드 결과 (좌표축 동일)
