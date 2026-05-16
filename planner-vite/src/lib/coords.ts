// ═══════════════════════════════════════════════════════════════
// 좌표 변환 헬퍼 (planner-vite)
//
// W4-2: planner V1 (Y-up center mm radians) → V2 (Z-up corner mm degrees)
// 변환 함수. mcp-server 의 migrateV1ToV2 와 동일 logic — planner-vite
// 측에도 내장 (mcp-server 의존성 없이 독립 동작).
//
// W4-2 단계에서는 sketchup-client.ts 가 mcp-server 로 전송 직전에
// migratePartV1ToV2 호출. deriveCabinet 출력과 App.tsx 렌더는 V1 그대로
// 유지 (W4-2b/W4-3 에서 V2 본격 전환).
// ═══════════════════════════════════════════════════════════════

import type { CabinetPart, CabinetPartV2 } from './planner';

/**
 * planner V1 (Y-up center radians) → V2 (Z-up corner degrees) 부품 변환.
 *
 * 좌표축:
 *   V1 Y-up: x=가로, y=수직, z=깊이
 *   V2 Z-up: x=가로, y=깊이, z=수직
 *   매핑: (x, y, z)_V1 → (x, z, y)_V2 (V2 의 y/z 가 V1 의 z/y)
 *
 * 기준점:
 *   V1: 박스 중심 (Three.js mesh.position 관례)
 *   V2: 박스 최소 모서리 (각 축에서 dimension/2 빼기)
 *
 * 회전:
 *   V1: rotationY (radians, Y축 CCW)
 *   V2: rotationZDeg (degrees, Z축 CCW)
 *   부호 보존 (수학 검증: Y-up Y회전 +π/2 == Z-up Z회전 +π/2 동일 결과)
 *
 * 치수 필드 의미 매핑:
 *   V1: width=+x, height=+y(수직), depth=+z(깊이) extents
 *   V2: width=+x, depth=+y(깊이), height=+z(수직) extents
 *   → V2.depth = V1.depth, V2.height = V1.height (의미는 같지만 +y/+z 매핑 swap)
 */
export function migratePartV1ToV2(p: CabinetPart): CabinetPartV2 {
  // V1 (x, y, z) center → V2 (x, z, y) center
  const centerX = p.x;
  const centerY = p.z;
  const centerZ = p.y;
  // V2 치수: x extent = width, y extent = depth (V1 z extent), z extent = height (V1 y extent)
  const sizeX = p.width;
  const sizeY = p.depth;
  const sizeZ = p.height;
  return {
    id: p.id,
    label: p.label,
    x: centerX - sizeX / 2,
    y: centerY - sizeY / 2,
    z: centerZ - sizeZ / 2,
    width: sizeX,
    depth: sizeY,
    height: sizeZ,
    rotationZDeg: p.rotationY != null ? (p.rotationY * 180) / Math.PI : undefined,
    colorKey: p.colorKey,
    wireframe: p.wireframe,
    essential: p.essential,
    moduleType: p.moduleType,
    moduleKind: p.moduleKind,
    doorCount: p.doorCount,
    drawerCount: p.drawerCount,
  };
}

/**
 * V2 (Z-up corner mm degrees) → V1 (Y-up center mm radians) 역변환.
 *
 * W4-3 에서 App.tsx 가 derived.parts (V2) 를 받지만 ModuleBox 렌더 코드가
 * V1 가정으로 작성되어 있어 useMemo 어댑터로 V1 변환 후 사용. W4-3b 에서
 * App.tsx 가 V2 직접 받게 되면 본 함수도 제거 예정.
 *
 * migratePartV1ToV2 와 정확히 역. 6 preset round-trip 테스트로 보장.
 */
export function migratePartV2ToV1(p: CabinetPartV2): CabinetPart {
  // V2 corner → center
  const v2CenterX = p.x + p.width / 2;
  const v2CenterY = p.y + p.depth / 2;
  const v2CenterZ = p.z + p.height / 2;
  // V2 (x, z, y) center → V1 (x, y, z) center  (swap z↔y back)
  const v1X = v2CenterX;
  const v1Y = v2CenterZ; // V2 z (수직) → V1 y (수직)
  const v1Z = v2CenterY; // V2 y (깊이) → V1 z (깊이)
  // V2 (width=+x, depth=+y, height=+z) → V1 (width=+x, height=+y, depth=+z)
  const v1Width = p.width;
  const v1Height = p.height;
  const v1Depth = p.depth;
  return {
    id: p.id,
    label: p.label,
    x: v1X,
    y: v1Y,
    z: v1Z,
    width: v1Width,
    height: v1Height,
    depth: v1Depth,
    rotationY: p.rotationZDeg != null ? (p.rotationZDeg * Math.PI) / 180 : undefined,
    colorKey: p.colorKey,
    wireframe: p.wireframe,
    essential: p.essential,
    moduleType: p.moduleType,
    moduleKind: p.moduleKind,
    doorCount: p.doorCount,
    drawerCount: p.drawerCount,
  };
}
