// ═══════════════════════════════════════════════════════════════
// Wall Analysis Service - 벽면 분석, 기본값 처리, 데이터 정규화
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import {
  geminiVisionAnalysis,
  geminiMultiImageAnalysis,
  extractTextFromGeminiResponse,
} from '../clients/gemini.client.js';
import { extractJsonFromText } from '../utils/json-extractor.js';
import { getReferenceImagesByCategory, loadStorageImage } from '../clients/supabase.client.js';
import { buildFewShotPrompt, WALL_ANALYSIS_ZERO_SHOT_PROMPT } from '../prompts/wall-analysis-fewshot.js';
import { calculateFurniturePlacement, getDefaultWallData } from './furniture-placement.service.js';
import type {
  WallAnalysis,
  ReferenceImageCategory,
  ImageInput,
  ReferenceImage,
} from '../types/index.js';

const log = createLogger('wall-analysis');

const DEFAULT_REFERENCE_CATEGORIES: ReferenceImageCategory[] = [
  'water_pipe', 'exhaust_duct', 'gas_pipe',
];

export interface WallAnalysisParams {
  image: string;
  imageType: string;
  useReferenceImages?: boolean;
  referenceCategories?: ReferenceImageCategory[];
}

export async function analyzeWall(params: WallAnalysisParams): Promise<WallAnalysis> {
  const {
    image,
    imageType,
    useReferenceImages = true,
    referenceCategories = DEFAULT_REFERENCE_CATEGORIES,
  } = params;

  let wallData: WallAnalysis = getDefaultWallData();

  try {
    const parsed = await performWallAnalysis(image, imageType, useReferenceImages, referenceCategories);
    wallData = { ...wallData, ...parsed };

    // 배관 위치 간편 접근용 필드 설정
    if (parsed.utility_positions) {
      const waterSupply = parsed.utility_positions.water_supply;
      const exhaustDuct = parsed.utility_positions.exhaust_duct;
      const gasPipe = parsed.utility_positions.gas_pipe || parsed.utility_positions.gas_line;

      if (waterSupply?.detected) {
        wallData.water_pipe_x = waterSupply.from_origin_mm || waterSupply.from_left_mm;
      }
      if (exhaustDuct?.detected) {
        wallData.exhaust_duct_x = exhaustDuct.from_origin_mm || exhaustDuct.from_left_mm;
      }
      if (gasPipe?.detected) {
        wallData.gas_pipe_x = gasPipe.from_origin_mm || gasPipe.from_left_mm;
      }
    }

    log.info({
      width: wallData.wall_width_mm,
      height: wallData.wall_height_mm,
      water: wallData.water_pipe_x,
      exhaust: wallData.exhaust_duct_x,
      gas: wallData.gas_pipe_x,
    }, 'Wall analysis complete');
  } catch (error) {
    log.warn({ error }, 'Wall analysis failed, using defaults');
  }

  // 가구 배치 좌표 계산
  wallData.furniture_placement = calculateFurniturePlacement(wallData);

  return wallData;
}

async function performWallAnalysis(
  image: string,
  imageType: string,
  useReferenceImages: boolean,
  referenceCategories: ReferenceImageCategory[]
): Promise<WallAnalysis> {
  let wallData: WallAnalysis | null = null;

  if (useReferenceImages) {
    log.info('Attempting Few-Shot analysis with reference images');

    const { images, referenceImages } = await prepareAnalysisImages(
      image, imageType, referenceCategories
    );

    if (referenceImages.length > 0) {
      log.info({ refCount: referenceImages.length }, 'Using reference images');
      const prompt = buildFewShotPrompt(referenceImages, images.length - 1);
      const response = await geminiMultiImageAnalysis(images, prompt);
      const text = extractTextFromGeminiResponse(response);
      if (text) {
        wallData = extractJsonFromText(text) as WallAnalysis | null;
      }
    }
  }

  // 폴백: Zero-Shot
  if (!wallData) {
    log.info('Falling back to Zero-Shot analysis');
    const response = await geminiVisionAnalysis(image, imageType, WALL_ANALYSIS_ZERO_SHOT_PROMPT);
    const text = extractTextFromGeminiResponse(response);
    if (text) {
      wallData = extractJsonFromText(text) as WallAnalysis | null;
    }
  }

  if (!wallData) {
    throw new Error('Failed to analyze wall structure');
  }

  return applyDefaults(wallData);
}

async function prepareAnalysisImages(
  targetImage: string,
  targetMimeType: string,
  categories: ReferenceImageCategory[]
): Promise<{ images: ImageInput[]; referenceImages: ReferenceImage[] }> {
  const refImages = await getReferenceImagesByCategory(categories);

  // 카테고리별 최대 2개씩 선택
  const selectedImages: ReferenceImage[] = [];
  const categoryCount = new Map<string, number>();

  for (const img of refImages) {
    const count = categoryCount.get(img.category) || 0;
    if (count < 2) {
      selectedImages.push(img);
      categoryCount.set(img.category, count + 1);
    }
  }

  const imageInputs: ImageInput[] = [];

  for (const refImg of selectedImages) {
    const base64 = await loadStorageImage(refImg.storage_path);
    if (base64) {
      const ext = refImg.storage_path.split('.').pop()?.toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      imageInputs.push({
        data: base64,
        mime_type: mimeType,
        role: 'reference',
        label: refImg.name,
      });
    }
  }

  imageInputs.push({
    data: targetImage,
    mime_type: targetMimeType,
    role: 'target',
    label: '분석 대상',
  });

  return { images: imageInputs, referenceImages: selectedImages };
}

function applyDefaults(data: Partial<WallAnalysis>): WallAnalysis {
  return {
    tile_detected: data.tile_detected ?? false,
    tile_type: data.tile_type ?? 'unknown',
    tile_size_mm: data.tile_size_mm ?? { width: 300, height: 600 },
    tile_count: data.tile_count,
    wall_dimensions_mm: data.wall_dimensions_mm,
    wall_width_mm: data.wall_dimensions_mm?.width ?? data.wall_width_mm ?? 3000,
    wall_height_mm: data.wall_dimensions_mm?.height ?? data.wall_height_mm ?? 2400,
    utility_positions: data.utility_positions,
    furniture_placement: data.furniture_placement,
    reference_used: data.reference_used,
    confidence: data.confidence ?? 'low',
    notes: data.notes,
  };
}
