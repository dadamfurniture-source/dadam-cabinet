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
// V1 (현행) — planner-vite 의 현재 출력. 향후 W4-2 에서 V2 로 마이그레이션 예정.
// 좌표계: Three.js Y-up, mm, 박스 중심
//   x = 가로 (좌↔우, 가구 중심선 기준)
//   y = 수직 (바닥↔천장, 바닥=0)
//   z = 깊이 (벽↔정면)
// 회전: rotationY (radians, Y축 CCW). secondary 모듈만 ±π/2.
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
