// ═══════════════════════════════════════════════════════════════
// Input Validator Middleware - 요청 입력 검증
// ═══════════════════════════════════════════════════════════════

import { ValidationError } from '../utils/errors.js';

const VALID_CATEGORIES = ['sink', 'wardrobe', 'fridge', 'vanity', 'shoe', 'storage'];
const MAX_BASE64_SIZE = 10 * 1024 * 1024; // 10MB
const VALID_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateCategory(category: unknown): string {
  const cat = String(category || 'sink');
  if (!VALID_CATEGORIES.includes(cat)) {
    throw new ValidationError(`Invalid category: ${cat}. Must be one of: ${VALID_CATEGORIES.join(', ')}`, 'category');
  }
  return cat;
}

export function validateBase64Image(data: unknown, field: string): string {
  if (!data || typeof data !== 'string') {
    throw new ValidationError('Image data is required', field);
  }

  if (data.length > MAX_BASE64_SIZE) {
    throw new ValidationError(`Image exceeds maximum size of ${MAX_BASE64_SIZE / 1024 / 1024}MB`, field);
  }

  return data;
}

export function validateMimeType(mimeType: unknown): string {
  const mime = String(mimeType || 'image/jpeg');
  if (!VALID_MIME_TYPES.includes(mime)) {
    throw new ValidationError(`Invalid MIME type: ${mime}. Must be one of: ${VALID_MIME_TYPES.join(', ')}`, 'image_type');
  }
  return mime;
}

export function validateMessage(message: unknown): string {
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw new ValidationError('Message is required', 'message');
  }
  return message.trim();
}
