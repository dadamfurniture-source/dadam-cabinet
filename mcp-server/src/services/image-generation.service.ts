// ═══════════════════════════════════════════════════════════════
// Image Generation Service - 닫힌문/열린문 이미지 생성 파이프라인
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import {
  geminiImageGeneration,
  extractImageFromGeminiResponse,
} from '../clients/gemini.client.js';
import { buildClosedDoorPrompt, type ClosedDoorPromptParams } from '../prompts/templates/closed-door.prompt.js';
import { buildOpenDoorPrompt } from '../prompts/templates/open-door.prompt.js';
import { buildDesignToImagePrompt } from '../prompts/templates/design-to-image.prompt.js';
import { buildStyleColorPrompt } from '../prompts/templates/style-color.prompt.js';
import { AppError } from '../utils/errors.js';

const log = createLogger('image-generation');

export interface GeneratedImages {
  closedImage: string;
  openImage: string | null;
}

export async function generateClosedAndOpenDoorImages(
  params: ClosedDoorPromptParams,
  roomImage: string,
  imageType: string
): Promise<GeneratedImages> {
  // 닫힌 도어 이미지 생성
  const closedPrompt = buildClosedDoorPrompt(params);
  log.info({ category: params.category }, 'Generating closed door image');

  const closedResponse = await geminiImageGeneration(closedPrompt, roomImage, imageType);
  const closedImage = extractImageFromGeminiResponse(closedResponse);

  if (!closedImage) {
    throw new AppError('Failed to generate closed door image', 500, 'IMAGE_GENERATION_FAILED');
  }

  log.info('Closed door image generated');

  // 열린 도어 이미지 생성
  let openImage: string | null = null;
  try {
    const openPrompt = buildOpenDoorPrompt(params.category);
    const openResponse = await geminiImageGeneration(openPrompt, closedImage, 'image/png');
    openImage = extractImageFromGeminiResponse(openResponse);
    log.info('Open door image generated');
  } catch (error) {
    log.warn({ error }, 'Open door generation failed, returning closed only');
  }

  return { closedImage, openImage };
}

export async function generateDesignImage(
  category: string,
  style: string,
  specs: Record<string, unknown>,
  items: unknown[]
): Promise<string> {
  const prompt = buildDesignToImagePrompt(category, style, specs, items);

  log.info({ category }, 'Generating design image');
  const response = await geminiImageGeneration(prompt);
  const image = extractImageFromGeminiResponse(response);

  if (!image) {
    throw new AppError('Failed to generate design image', 500, 'IMAGE_GENERATION_FAILED');
  }

  return image;
}

export async function generateStyleColorImage(
  style: string,
  styleKeywords: string,
  styleAtmosphere: string,
  colorPrompt: string,
  cabinetSpecs?: Record<string, unknown>
): Promise<string> {
  const prompt = buildStyleColorPrompt(style, styleKeywords, styleAtmosphere, colorPrompt, cabinetSpecs);

  log.info({ style }, 'Generating style-based image');
  const response = await geminiImageGeneration(prompt);
  const image = extractImageFromGeminiResponse(response);

  if (!image) {
    throw new AppError('Failed to generate style image', 500, 'IMAGE_GENERATION_FAILED');
  }

  return image;
}
