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

// V1 (legacy, Y-up center mm rotationY radians) — 기존 호환
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
  rotationY: z.number().optional(),
});

// V2 (W4 — SketchUp 호환, Z-up corner mm rotationZDeg degrees)
// 필드 shape 는 V1 과 유사하지만 의미가 다름. discriminator (schemaVersion)
// 로 명시적 구분 — 잘못된 좌표 의미로 해석되는 silent failure 방지.
export const cabinetPartV2Schema = z.object({
  id: z.string().min(1),
  label: z.string(),
  x: z.number(),         // corner x (가로)
  y: z.number(),         // corner y (깊이)
  z: z.number(),         // corner z (수직)
  width: z.number(),     // +x extent
  depth: z.number(),     // +y extent
  height: z.number(),    // +z extent
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

// sketchupBuildSchema 는 V1 (back-compat) 또는 V2 (schemaVersion:'v2' 명시) 받음.
// V1 입력: schemaVersion 미지정 또는 'v1', parts 는 cabinetPartSchema (Y-up center)
// V2 입력: schemaVersion: 'v2', parts 는 cabinetPartV2Schema (Z-up corner)
//
// z.union 사용 — discriminatedUnion 은 V1 의 schemaVersion optional 분기를
// 지원 안 함. route 가 입력 받은 후 schemaVersion 으로 V1/V2 처리.
const sketchupBuildV2Schema = z.object({
  schemaVersion: z.literal('v2'),
  parts: z.array(cabinetPartV2Schema).min(1),
  category: sketchupCategoryEnum,
  materialTone: sketchupToneEnum,
  clearExisting: z.boolean().optional().default(false),
  transactional: z.boolean().optional().default(true),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  ping: z.boolean().optional().default(true),
});

const sketchupBuildV1Schema = z.object({
  schemaVersion: z.literal('v1').optional(),
  parts: z.array(cabinetPartSchema).min(1),
  category: sketchupCategoryEnum,
  materialTone: sketchupToneEnum,
  clearExisting: z.boolean().optional().default(false),
  transactional: z.boolean().optional().default(true),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  ping: z.boolean().optional().default(true),
});

export const sketchupBuildSchema = z.union([sketchupBuildV2Schema, sketchupBuildV1Schema]);

export type SketchupBuildInput = z.infer<typeof sketchupBuildSchema>;
export type SketchupBuildInputV1 = z.infer<typeof sketchupBuildV1Schema>;
export type SketchupBuildInputV2 = z.infer<typeof sketchupBuildV2Schema>;
