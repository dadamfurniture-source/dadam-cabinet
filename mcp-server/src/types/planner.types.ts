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
