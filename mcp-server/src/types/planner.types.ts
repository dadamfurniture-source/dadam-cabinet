// ═══════════════════════════════════════════════════════════════
// Planner 타입 미러 — lib/planner.ts (Next.js 측)에서 추출
//
// mcp-server는 stdio 환경이라 Three.js/React 의존 불가.
// SketchUp 통합에 필요한 데이터 타입만 별도 파일로 미러한다.
//
// 동기화: `npm run sync-planner` (drift 검사) / `--write` (자동 수정).
// CI 에서 mcp-server-ci.yml 의 "Planner mirror drift check" 가 강제.
// 새 export 추가 시 mcp-server/scripts/sync-planner.mjs 의 EXPORTS_TO_SYNC 도 함께 갱신.
// ═══════════════════════════════════════════════════════════════

export type CabinetCategory = 'sink' | 'wardrobe' | 'vanity' | 'shoe' | 'fridge' | 'storage';

export type MaterialTone = 'cream' | 'oak' | 'walnut' | 'graphite';

export type ModuleSection = 'lower' | 'upper' | 'full';

export type ModuleKind = 'door' | 'drawer' | 'open';

export type DoorOpenDirection = 'left' | 'right' | 'both';

export type DoorType = 'swing' | 'sliding' | 'liftup';

export type ModuleType = 'storage' | 'sink' | 'cook' | 'hood' | 'drawer';

export type ColorKey = 'body' | 'accent' | 'shadow' | 'trim';

// lib/planner.ts:93-110 에서 미러
// V1 (legacy) — Three.js Y-up center 좌표계. W4-3 에서 deriveCabinet 이 V2 출력으로
// 전환됨. mcp-server 의 SketchUp 빌드 경로는 V2 만 받음 (sketchup.schema.ts).
// 본 인터페이스는 sync-planner.mjs 가 lib/planner.ts (root) 미러를 유지하기 위해
// 남아있을 뿐 — mcp-server 의 코드 어디에서도 import 되지 않음. W4-6 에서 root
// lib/planner.ts 가 V2 로 갱신되면 본 인터페이스도 동시 제거 예정.
//
// @deprecated W4-4 이후 mcp-server 내부 사용 없음. CabinetPartV2 사용할 것.
export interface CabinetPart {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  colorKey: ColorKey;
  wireframe?: boolean;
  essential?: boolean;
  moduleType?: ModuleType;
  isDoor?: boolean;
  parentModuleId?: string;
  doorIndex?: number;
  openDirection?: 'left' | 'right';
  rotationY?: number; // W1 누락 — radians, Y축 회전. W4-1 에서 노출.
}

// ───────────────────────────────────────────────────────────────
// V2 (W4 — SketchUp 호환 신규)
// ───────────────────────────────────────────────────────────────
// 좌표계: Z-up, right-handed (SketchUp native)
//   x = 가로 (좌↔우)
//   y = 깊이 (정면↔벽)
//   z = 수직 (바닥↔천장)
// 단위: mm (mcp-server 에서만 inch 변환)
// 기준점: AABB 최소 모서리 (x_min, y_min, z_min) — 회전 전
// 회전: rotationZDeg (degrees, Z축 CCW). pivot = (x, y, z) 코너.
//
// 본 V2 는 planner-vite/src/lib/planner.ts 와 mirror 되어야 함.
// W4-1 단계에서는 mcp-server 내부에서만 사용 — V1 입력은 migrateV1ToV2 통과.
export interface CabinetPartV2 {
  id: string;
  label: string;
  x: number;        // corner x (가로)
  y: number;        // corner y (깊이)
  z: number;        // corner z (수직)
  width: number;    // +x 방향 extent (가로)
  depth: number;    // +y 방향 extent (깊이)
  height: number;   // +z 방향 extent (수직)
  rotationZDeg?: number;
  colorKey: ColorKey;
  wireframe?: boolean;
  essential?: boolean;
  moduleType?: ModuleType;
  isDoor?: boolean;
  parentModuleId?: string;
  doorIndex?: number;
  openDirection?: 'left' | 'right';
  // W9-81: 부모 transform 상속 — 자식 마감재가 부모 모듈 회전 따라가도록.
  //   parentTransform 있으면 builder 가 corner 를 pivot 기준 회전 후 V2 좌표 산출.
  //   자식의 rotationZDeg 는 parent.rotationZDeg 와 누적 (corner pivot 자체 회전).
  parentTransform?: {
    rotationZDeg: number;     // 부모 모듈 회전 (deg)
    pivotX: number;           // 부모 모듈 중심 X (V2 좌표계)
    pivotY: number;           // 부모 모듈 중심 Y (V2 좌표계)
  };
}

// lib/planner.ts:139-147 에서 미러
export interface MaterialPalette {
  name: string;
  body: string;
  accent: string;
  shadow: string;
  trim: string;
}

export const MATERIALS: Record<MaterialTone, MaterialPalette> = {
  cream: { name: 'Warm Cream', body: '#f1ede3', accent: '#d4c4a8', shadow: '#b7aa90', trim: '#c8bda8' },
  oak: { name: 'Natural Oak', body: '#d1b089', accent: '#9e7144', shadow: '#6f5031', trim: '#8a6a42' },
  walnut: { name: 'Deep Walnut', body: '#8b6447', accent: '#b48a6a', shadow: '#5d412c', trim: '#6e5238' },
  graphite: { name: 'Graphite', body: '#696a6b', accent: '#c2b49c', shadow: '#3d4042', trim: '#555657' },
};
