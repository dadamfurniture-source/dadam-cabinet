// ═══════════════════════════════════════════════════════════════
// Common Zod Schemas - 공통 입력 검증 스키마
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';

// ─── 카테고리 / 레이아웃 ───

export const CategorySchema = z.enum([
  'sink', 'wardrobe', 'fridge', 'vanity', 'shoe', 'storage',
]);

export const KitchenLayoutSchema = z.enum([
  'i_type', 'l_type', 'u_type', 'peninsula',
]);

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);

// ─── 치수 ───

/** mm 단위 양수 (0 허용), 최대 20m */
export const DimensionMmSchema = z.number()
  .int('치수는 정수여야 합니다')
  .nonnegative('치수는 0 이상이어야 합니다')
  .max(20_000, '치수는 20,000mm 이하여야 합니다');

/** mm 단위 양수 (0 미허용), 최대 20m */
export const PositiveDimensionSchema = z.number()
  .int('치수는 정수여야 합니다')
  .positive('치수는 양수여야 합니다')
  .max(20_000, '치수는 20,000mm 이하여야 합니다');

// ─── 이미지 ───

/** Base64 인코딩된 이미지 (최대 10MB) */
export const Base64ImageSchema = z.string()
  .min(1, '이미지 데이터가 비어있습니다')
  .max(10 * 1024 * 1024, '이미지는 10MB 이하여야 합니다');

export const MimeTypeSchema = z.enum([
  'image/jpeg', 'image/png', 'image/webp',
]);

// ─── 문자열 ───

/** 사용자 입력 텍스트 (프롬프트 인젝션 방지용 길이 제한) */
export const SafeTextSchema = z.string()
  .min(1)
  .max(2_000, '텍스트는 2,000자 이하여야 합니다');

/** 스타일명 (짧은 문자열) */
export const StyleSchema = z.string()
  .min(1)
  .max(100, '스타일명은 100자 이하여야 합니다');
