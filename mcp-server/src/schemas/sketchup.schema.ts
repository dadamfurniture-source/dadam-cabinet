// ═══════════════════════════════════════════════════════════════
// SketchUp Build 공유 zod 스키마
//
// W3-2: HTTP route 와 MCP 도구가 동일한 입력 검증을 공유하기 위해 분리.
// W4-4: V1 (Y-up center) 스키마 제거. V2 (Z-up corner mm degrees) 만 허용.
//   planner-vite 가 W4-3 부터 V2 직송 — V1 입력은 더 이상 들어오지 않음.
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';

export const sketchupCategoryEnum = z.enum([
  'sink',
  'wardrobe',
  'fridge',
  'vanity',
  'shoe',
  'storage',
]);

export const sketchupToneEnum = z.enum(['cream', 'oak', 'walnut', 'graphite']);

export const sketchupColorKeyEnum = z.enum(['body', 'accent', 'shadow', 'trim']);

// CabinetPart (V2, SketchUp 호환): Z-up corner mm rotationZDeg degrees
//   x = corner x (가로 +x extent=width)
//   y = corner y (깊이 +y extent=depth)
//   z = corner z (수직 +z extent=height)
//   rotationZDeg: Z축 CCW degrees, pivot=(x,y,z)
export const cabinetPartSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  width: z.number(),
  depth: z.number(),
  height: z.number(),
  rotationZDeg: z.number().optional(),
  colorKey: sketchupColorKeyEnum,
  wireframe: z.boolean().optional(),
  essential: z.boolean().optional(),
  moduleType: z.enum(['storage', 'sink', 'cook', 'hood', 'drawer']).optional(),
  isDoor: z.boolean().optional(),
  parentModuleId: z.string().optional(),
  doorIndex: z.number().optional(),
  openDirection: z.enum(['left', 'right']).optional(),
});

// V4-4: schemaVersion 은 호환을 위해 옵션. 미지정 또는 'v2' 모두 V2 로 해석.
// 'v1' 등 다른 값은 거부 (silent V1 해석 방지).
export const sketchupBuildSchema = z.object({
  schemaVersion: z.literal('v2').optional(),
  parts: z.array(cabinetPartSchema).min(1),
  category: sketchupCategoryEnum,
  materialTone: sketchupToneEnum,
  clearExisting: z.boolean().optional().default(false),
  transactional: z.boolean().optional().default(true),
  // W4-5c: rotation/material 명령 옵션 기본값 true 전환.
  // W4-5b 의 디자이너 PC E2E (mhyrr v0.1.0, 11/11 명령 성공) 후 안전 확인됨.
  // 비활성화하려면 명시적 false 전송.
  applyRotation: z.boolean().optional().default(true),
  applyMaterial: z.boolean().optional().default(true),
  // 빌드 후 SketchUp active view zoom_extents 자동 호출 (기본 true)
  autoZoom: z.boolean().optional().default(true),
  // Si-1b: 빌드 후 entity group.name 자동 설정 (기본 true)
  applyEntityNames: z.boolean().optional().default(true),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  ping: z.boolean().optional().default(true),
});

export type SketchupBuildInput = z.infer<typeof sketchupBuildSchema>;
