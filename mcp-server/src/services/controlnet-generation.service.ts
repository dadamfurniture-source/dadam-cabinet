// ═══════════════════════════════════════════════════════════════
// ControlNet Image Generation Service
// 도면 데이터 → 라인아트 → ControlNet 이미지 생성 파이프라인
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { generateDrawingData } from './drawing.service.js';
import { renderLineartPng } from './svg-renderer.service.js';
import {
  generateWithControlNetAndWait,
  fetchImageAsBase64,
  type ControlNetInput,
  type ControlNetType,
} from '../clients/replicate.client.js';
import { AppError } from '../utils/errors.js';
import type { StructuredDesignData } from '../types/index.js';

const log = createLogger('controlnet-generation');

// ─────────────────────────────────────────────────────────────────
// 재질 프롬프트 맵핑
// ─────────────────────────────────────────────────────────────────

const MATERIAL_PROMPTS: Record<string, string> = {
  'PB-W01': 'white particle board panel',
  'PB-W02': 'ivory particle board panel',
  'MDF-G01': 'gray MDF panel matte finish',
  'WD-OK01': 'natural oak wood grain veneer',
  'WD-WN01': 'dark walnut wood veneer',
  'ST-SS01': 'brushed stainless steel countertop',
  'ST-QZ01': 'engineered quartz countertop white',
};

const STYLE_PROMPTS: Record<string, string> = {
  modern: 'modern minimalist clean lines, flat panel doors, concealed hinges',
  nordic: 'scandinavian nordic style, light wood tones, warm atmosphere',
  classic: 'classic traditional style, raised panel doors, crown molding',
  natural: 'natural organic style, wood grain texture, warm earth tones',
  industrial: 'industrial style, dark metal accents, exposed hardware',
  luxury: 'luxury premium finish, high gloss surfaces, gold accents',
};

const CATEGORY_PROMPTS: Record<string, string> = {
  sink: 'kitchen sink cabinet with countertop and sink basin',
  l_shaped_sink: 'L-shaped kitchen sink cabinet with corner countertop',
  island_kitchen: 'kitchen island with countertop and storage below',
  wardrobe: 'built-in wardrobe closet with multiple compartments',
  vanity: 'bathroom vanity cabinet with mirror above',
  shoe_cabinet: 'entryway shoe storage cabinet',
  fridge_cabinet: 'tall refrigerator surround cabinet',
  storage_cabinet: 'utility storage cabinet with shelves',
};

// ─────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────

export interface ControlNetGenerationInput {
  /** 설계 데이터 */
  designData: StructuredDesignData;
  /** 카테고리 (sink, wardrobe 등) */
  category: string;
  /** 스타일 (modern, nordic 등) */
  style?: string;
  /** 재질 코드 (PB-W01 등) */
  materialCode?: string;
  /** 추가 프롬프트 */
  additionalPrompt?: string;
  /** 배경 이미지 (img2img, base64) */
  backgroundImage?: string;
  /** img2img 강도 (0.0~1.0) */
  promptStrength?: number;
  /** ControlNet 레이어 타입 (기본: lineart) */
  controlNetType?: ControlNetType;
  /** ControlNet 강도 (기본: 0.75) */
  controlNetStrength?: number;
  /** ControlNet 적용 시작점 (기본: 0.0) */
  controlNetStart?: number;
  /** ControlNet 적용 종료점 (기본: 0.8) */
  controlNetEnd?: number;
  /** LoRA weights URL */
  loraWeights?: string;
  /** LoRA 스케일 (기본: 0.6) */
  loraScale?: number;
  /** 해상도 (기본: 1024) */
  width?: number;
  height?: number;
  /** 시드 (재현성) */
  seed?: number;
}

export interface ControlNetGenerationResult {
  /** 생성된 이미지 base64 */
  image: string;
  /** 라인아트 이미지 base64 (디버그용) */
  lineartImage: string;
  /** 사용된 프롬프트 */
  prompt: string;
  /** 생성 메타데이터 */
  metadata: {
    category: string;
    style: string;
    controlNetType: ControlNetType;
    controlNetStrength: number;
    hasLora: boolean;
    hasBackground: boolean;
    resolution: { width: number; height: number };
  };
}

// ─────────────────────────────────────────────────────────────────
// 프롬프트 빌더
// ─────────────────────────────────────────────────────────────────

function buildControlNetPrompt(input: ControlNetGenerationInput): string {
  const parts: string[] = [];

  // 카테고리
  const categoryPrompt = CATEGORY_PROMPTS[input.category] || `Korean ${input.category} furniture`;
  parts.push(`photorealistic ${categoryPrompt}`);

  // 스타일
  const style = input.style || 'modern';
  const stylePrompt = STYLE_PROMPTS[style] || STYLE_PROMPTS.modern;
  parts.push(stylePrompt);

  // 재질
  if (input.materialCode && MATERIAL_PROMPTS[input.materialCode]) {
    parts.push(MATERIAL_PROMPTS[input.materialCode]);
  } else {
    parts.push('white PB panel body');
  }

  // 공통
  parts.push('professional interior photography, soft natural lighting');
  parts.push('modern Korean apartment, 8k quality, all doors closed');

  // 추가 프롬프트
  if (input.additionalPrompt) {
    parts.push(input.additionalPrompt);
  }

  return parts.join(', ');
}

const NEGATIVE_PROMPT = [
  'blurry', 'cartoon', 'sketch', 'wireframe', 'low quality', 'distorted',
  'deformed', 'text', 'watermark', 'logo', 'numbers', 'dimensions',
  'labels', 'annotations', 'arrows', 'rulers', 'people', 'pets',
].join(', ');

// ─────────────────────────────────────────────────────────────────
// 메인 생성 함수
// ─────────────────────────────────────────────────────────────────

/**
 * 설계 데이터 → ControlNet 이미지 생성 전체 파이프라인
 *
 * 1. StructuredDesignData → DrawingData (도면 좌표)
 * 2. DrawingData → 라인아트 SVG → PNG (ControlNet 입력)
 * 3. 프롬프트 생성 + ControlNet + (선택) LoRA → Replicate 호출
 * 4. 결과 이미지 base64 반환
 */
export async function generateWithDrawingControlNet(
  input: ControlNetGenerationInput,
): Promise<ControlNetGenerationResult> {
  const startTime = Date.now();

  // Step 1: 설계 데이터 → 도면 좌표
  log.info({ category: input.category }, 'Step 1: Generating drawing data');
  const drawingData = generateDrawingData(input.designData);

  // Step 2: 도면 → 라인아트 PNG
  log.info('Step 2: Rendering lineart PNG');
  const resolution = input.width || 1024;
  const lineartBase64 = renderLineartPng(drawingData, { resolution });
  const lineartDataUri = `data:image/png;base64,${lineartBase64}`;

  // Step 3: 프롬프트 생성
  const prompt = buildControlNetPrompt(input);
  log.info({ promptLength: prompt.length }, 'Step 3: Prompt built');

  // Step 4: ControlNet 호출
  const controlNetType = input.controlNetType || 'lineart';
  const controlNetStrength = input.controlNetStrength ?? 0.75;

  const controlNetInput: ControlNetInput = {
    prompt,
    negativePrompt: NEGATIVE_PROMPT,
    controlNets: [{
      type: controlNetType,
      image: lineartDataUri,
      conditioningScale: controlNetStrength,
      start: input.controlNetStart ?? 0.0,
      end: input.controlNetEnd ?? 0.8,
    }],
    width: input.width || 1024,
    height: input.height || 1024,
    numInferenceSteps: 30,
    guidanceScale: 7.5,
    scheduler: 'K_EULER',
    seed: input.seed,
  };

  // 배경 이미지 (img2img)
  if (input.backgroundImage) {
    controlNetInput.image = input.backgroundImage.startsWith('data:')
      ? input.backgroundImage
      : `data:image/png;base64,${input.backgroundImage}`;
    controlNetInput.promptStrength = input.promptStrength ?? 0.8;
  }

  // LoRA
  if (input.loraWeights) {
    controlNetInput.loraWeights = input.loraWeights;
    controlNetInput.loraScale = input.loraScale ?? 0.6;
  }

  log.info({
    controlNetType,
    controlNetStrength,
    hasLora: !!input.loraWeights,
    hasBackground: !!input.backgroundImage,
  }, 'Step 4: Calling Replicate ControlNet');

  const outputs = await generateWithControlNetAndWait(controlNetInput);

  if (!outputs || outputs.length === 0) {
    throw new AppError('ControlNet generation returned no output', 500, 'CONTROLNET_NO_OUTPUT');
  }

  // 결과 이미지 URL → base64
  const imageUrl = outputs[0];
  const imageBase64 = await fetchImageAsBase64(imageUrl);

  const elapsed = Date.now() - startTime;
  log.info({
    elapsed,
    category: input.category,
    imageSize: imageBase64.length,
  }, 'ControlNet generation complete');

  return {
    image: imageBase64,
    lineartImage: lineartBase64,
    prompt,
    metadata: {
      category: input.category,
      style: input.style || 'modern',
      controlNetType,
      controlNetStrength,
      hasLora: !!input.loraWeights,
      hasBackground: !!input.backgroundImage,
      resolution: {
        width: input.width || 1024,
        height: input.height || 1024,
      },
    },
  };
}
