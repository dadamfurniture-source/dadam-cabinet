// ═══════════════════════════════════════════════════════════════
// Generation Zod Schemas - 이미지 생성 입력 검증
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import {
  CategorySchema,
  KitchenLayoutSchema,
  Base64ImageSchema,
  MimeTypeSchema,
  SafeTextSchema,
  StyleSchema,
} from './common.schemas.js';

// ─── 벽 분석 입력 ───

export const WallAnalysisParamsSchema = z.object({
  image: Base64ImageSchema,
  imageType: MimeTypeSchema.default('image/jpeg'),
  provider: z.enum(['gemini', 'claude']).optional(),
  useReferenceImages: z.boolean().default(true),
  referenceCategories: z.array(z.string()).optional(),
});

// ─── 이미지 생성 입력 ───

export const GenerationInputSchema = z.object({
  roomImage: Base64ImageSchema,
  imageType: MimeTypeSchema.default('image/jpeg'),
  category: CategorySchema,
  designStyle: StyleSchema.optional(),
  styleName: SafeTextSchema.optional(),
  styleKeywords: SafeTextSchema.optional(),
  styleMoodPrompt: SafeTextSchema.optional(),
  styleCountertopPrompt: SafeTextSchema.optional(),
  kitchenLayout: KitchenLayoutSchema.optional(),
});

// ─── ControlNet 생성 입력 ───

export const ControlNetGenerationInputSchema = z.object({
  designData: z.record(z.unknown()),
  style: StyleSchema.optional(),
  kitchenLayout: KitchenLayoutSchema.optional(),
  additionalPrompt: SafeTextSchema.optional(),
  loraWeights: z.number().min(0).max(2).optional(),
  controlNetStrength: z.number().min(0).max(2).optional(),
  resolution: z.number().int().min(256).max(2048).optional(),
  seed: z.number().int().nonnegative().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
});

// ─── 구조 검증 옵션 ───

export const VerificationOptionsSchema = z.object({
  threshold: z.number().min(0).max(1).default(0.4),
  edgeSensitivity: z.number().int().min(1).max(255).default(30),
  compareResolution: z.number().int().min(64).max(2048).default(512),
  dilationRadius: z.number().int().min(0).max(10).default(3),
});

// ─── Chat 입력 ───

export const ChatInputSchema = z.object({
  message: z.string()
    .min(1, '메시지가 비어있습니다')
    .max(10_000, '메시지는 10,000자 이하여야 합니다'),
  context: z.record(z.unknown()).default({}),
});

// ─── RAG 검색 입력 ───

export const RagSearchInputSchema = z.object({
  category: z.string().min(1, '카테고리가 비어있습니다'),
  style: z.string().min(1, '스타일이 비어있습니다'),
  limit: z.number().int().positive().max(100).default(25),
});

// ─── Quote 입력 ───

export const QuoteGradeSchema = z.enum(['basic', 'mid', 'premium']);

// ─── 타입 추출 ───

export type WallAnalysisParamsInput = z.infer<typeof WallAnalysisParamsSchema>;
export type GenerationInputParsed = z.infer<typeof GenerationInputSchema>;
export type ChatInputParsed = z.infer<typeof ChatInputSchema>;
export type RagSearchInputParsed = z.infer<typeof RagSearchInputSchema>;
