// ═══════════════════════════════════════════════════════════════
// Sink HITL Schemas - Human-in-the-Loop 학습 데이터 스키마
// Phase 1: 랜덤 생성 + 사용자 수정 + diff 기록
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { DimensionMmSchema, PositiveDimensionSchema } from './common.schemas.js';

// ─── 환경 (벽 + 마감재 + 유틸리티) ───

export const SinkEnvSchema = z.object({
  width: PositiveDimensionSchema,       // 벽 가로 (mm)
  height: PositiveDimensionSchema,      // 벽 세로 (mm)
  depth: PositiveDimensionSchema,       // 싱크대 깊이 (mm)
  finishLeftW: DimensionMmSchema,       // 좌측 마감재 폭
  finishRightW: DimensionMmSchema,      // 우측 마감재 폭
  moldingH: DimensionMmSchema,          // 상부 몰딩 높이
  toeKickH: DimensionMmSchema,          // 걸레받이 높이
  distributorStart: DimensionMmSchema.nullable(), // 분전반 시작 (좌기준 mm)
  distributorEnd: DimensionMmSchema.nullable(),   // 분전반 끝
  ventStart: DimensionMmSchema.nullable(),        // 환풍구 시작
  ventEnd: DimensionMmSchema.nullable(),          // 환풍구 끝
  measurementBase: z.enum(['left', 'right']),     // 측정 기준
});

export type SinkEnv = z.infer<typeof SinkEnvSchema>;

// ─── 모듈 ───

export const SinkModuleKindSchema = z.enum(['door', 'drawer', 'open']);
export const SinkModuleTypeSchema = z.enum([
  'sink', 'cook', 'hood', 'lt', 'storage', 'drawer', 'blank',
]);

export const SinkModuleSchema = z.object({
  idx: z.number().int().nonnegative(),
  width: PositiveDimensionSchema,
  kind: SinkModuleKindSchema,
  type: SinkModuleTypeSchema,
  doorCount: z.number().int().min(1).max(2).optional(),
  drawerCount: z.number().int().min(1).max(5).optional(),
});

export type SinkModule = z.infer<typeof SinkModuleSchema>;

// ─── Design ───

export const SinkDesignSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  version: z.literal('v1'),
  env: SinkEnvSchema,
  lower: z.array(SinkModuleSchema),
  upper: z.array(SinkModuleSchema),
  meta: z.object({
    generated_by: z.enum(['random', 'hybrid', 'human-correction', 'cbr']),
    parent_id: z.string().optional(),
    seed: z.number().int().optional(),
    user_notes: z.string().max(2000).optional(),
  }),
});

export type SinkDesign = z.infer<typeof SinkDesignSchema>;

// ─── Diff ───

export const SinkDiffOpSchema = z.object({
  op: z.enum(['replace', 'add', 'remove', 'move']),
  path: z.string(),
  from: z.unknown().optional(),
  to: z.unknown().optional(),
  tag: z.string(),
});

export type SinkDiffOp = z.infer<typeof SinkDiffOpSchema>;

export const SinkDiffPairSchema = z.object({
  pair_id: z.string(),
  timestamp: z.string(),
  generated: SinkDesignSchema,
  corrected: SinkDesignSchema,
  diffs: z.array(SinkDiffOpSchema),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export type SinkDiffPair = z.infer<typeof SinkDiffPairSchema>;

// ─── API Payload Schemas ───

export const GenerateRequestSchema = z.object({
  env: SinkEnvSchema,
  seed: z.number().int().optional(),
});

export const SaveCorrectionRequestSchema = z.object({
  generated: SinkDesignSchema,
  corrected: SinkDesignSchema,
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});
