// ═══════════════════════════════════════════════════════════════
// SketchUp Build 공유 zod 스키마
//
// W3-2: HTTP route 와 MCP 도구가 동일한 입력 검증을 공유하기 위해 분리.
// CabinetPart 의 필드는 planner.types.ts 의 인터페이스를 그대로 미러.
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

export const cabinetPartSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  width: z.number(),
  height: z.number(),
  depth: z.number(),
  colorKey: sketchupColorKeyEnum,
  wireframe: z.boolean().optional(),
  essential: z.boolean().optional(),
  moduleType: z.enum(['storage', 'sink', 'cook', 'hood', 'drawer']).optional(),
  isDoor: z.boolean().optional(),
  parentModuleId: z.string().optional(),
  doorIndex: z.number().optional(),
  openDirection: z.enum(['left', 'right']).optional(),
});

export const sketchupBuildSchema = z.object({
  parts: z.array(cabinetPartSchema).min(1),
  category: sketchupCategoryEnum,
  materialTone: sketchupToneEnum,
  clearExisting: z.boolean().optional().default(false),
  transactional: z.boolean().optional().default(true),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  /** true 면 빌드 전 SketchUp 확장 ping 으로 가용성 확인 후 진행. */
  ping: z.boolean().optional().default(true),
});

export type SketchupBuildInput = z.infer<typeof sketchupBuildSchema>;
