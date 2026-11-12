// ═══════════════════════════════════════════════════════════════
// Planner 타입 — SketchUp 통합(빌드 · 가져오기)에 쓰는 데이터 타입
//
// 처음에는 옛 3D 플래너(lib/planner.ts)의 미러였다. 그 플래너는 지워졌고,
// 이제 이 파일이 mcp-server 안의 정본이다.
// ═══════════════════════════════════════════════════════════════

export type CabinetCategory = 'sink' | 'wardrobe' | 'vanity' | 'shoe' | 'fridge' | 'storage';

export type MaterialTone = 'cream' | 'oak' | 'walnut' | 'graphite';

export type ModuleSection = 'lower' | 'upper' | 'full';

export type ModuleKind = 'door' | 'drawer' | 'open';

export type DoorOpenDirection = 'left' | 'right' | 'both';

export type DoorType = 'swing' | 'sliding' | 'liftup';

export type ModuleType = 'storage' | 'sink' | 'cook' | 'hood' | 'drawer';

export type ColorKey = 'body' | 'accent' | 'shadow' | 'trim';

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
