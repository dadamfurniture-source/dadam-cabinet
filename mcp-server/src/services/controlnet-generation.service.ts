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
import { fetchWithRetry } from '../clients/base-http.client.js';
import { getConfig } from '../utils/config.js';
import { AppError } from '../utils/errors.js';
import { verifyStructuralFidelity, type VerificationResult } from './structural-verification.service.js';
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
  /** 구조 검증 활성화 (기본: false) */
  enableVerification?: boolean;
  /** 구조 검증 통과 임계값 (기본: 0.4) */
  verificationThreshold?: number;
  /** 미달 시 최대 재시도 횟수 (기본: 2) */
  maxRetries?: number;
}

export interface ControlNetGenerationResult {
  /** 생성된 이미지 base64 */
  image: string;
  /** 라인아트 이미지 base64 (디버그용) */
  lineartImage: string;
  /** 사용된 프롬프트 */
  prompt: string;
  /** 구조 검증 결과 (enableVerification=true 시) */
  verification?: VerificationResult;
  /** 생성 메타데이터 */
  metadata: {
    category: string;
    style: string;
    controlNetType: ControlNetType;
    controlNetStrength: number;
    hasLora: boolean;
    hasBackground: boolean;
    resolution: { width: number; height: number };
    /** 재시도 횟수 (검증 실패 시) */
    retryCount?: number;
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
  let imageBase64 = await fetchImageAsBase64(imageUrl);

  // ── 구조 검증 (enableVerification=true 시) ──
  let verification: VerificationResult | undefined;
  let retryCount = 0;
  const maxRetries = input.maxRetries ?? 2;
  const verificationThreshold = input.verificationThreshold ?? 0.4;

  if (input.enableVerification) {
    verification = await verifyStructuralFidelity(imageBase64, lineartBase64, {
      threshold: verificationThreshold,
    });

    // 미달 시 ControlNet strength 증가하며 재시도
    let currentStrength = controlNetStrength;
    while (!verification.passed && retryCount < maxRetries) {
      retryCount++;
      currentStrength = Math.min(currentStrength + 0.1, 1.5);

      log.warn({
        score: verification.score,
        retryCount,
        newStrength: currentStrength,
      }, 'Structural verification failed, retrying with higher strength');

      controlNetInput.controlNets[0].conditioningScale = currentStrength;

      const retryOutputs = await generateWithControlNetAndWait(controlNetInput);
      if (retryOutputs && retryOutputs.length > 0) {
        imageBase64 = await fetchImageAsBase64(retryOutputs[0]);
        verification = await verifyStructuralFidelity(imageBase64, lineartBase64, {
          threshold: verificationThreshold,
        });
      }
    }

    log.info({
      finalScore: verification.score,
      passed: verification.passed,
      retries: retryCount,
    }, 'Structural verification complete');
  }

  const elapsed = Date.now() - startTime;
  log.info({
    elapsed,
    category: input.category,
    imageSize: imageBase64.length,
    verificationScore: verification?.score,
  }, 'ControlNet generation complete');

  return {
    image: imageBase64,
    lineartImage: lineartBase64,
    prompt,
    verification,
    metadata: {
      category: input.category,
      style: input.style || 'modern',
      controlNetType,
      controlNetStrength: controlNetInput.controlNets[0].conditioningScale ?? controlNetStrength,
      hasLora: !!input.loraWeights,
      hasBackground: !!input.backgroundImage,
      resolution: {
        width: input.width || 1024,
        height: input.height || 1024,
      },
      retryCount: retryCount > 0 ? retryCount : undefined,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// LoRA 자동 매칭 (Supabase lora_models 테이블 조회)
// ─────────────────────────────────────────────────────────────────

interface LoraModelRecord {
  category: string;
  model_version: string;
  trigger_word: string;
  status: string;
  metadata?: {
    trainer_type?: string;
  };
}

/**
 * 카테고리별 SDXL LoRA 모델 자동 조회
 * trainer_type=sdxl인 모델 우선, 없으면 flux 모델 반환
 */
export async function getLoraForCategory(category: string): Promise<{
  loraWeights: string;
  triggerWord: string;
} | null> {
  try {
    const config = getConfig();
    const url = `${config.supabase.url}/rest/v1/lora_models?category=eq.${category}&status=eq.ready&select=model_version,trigger_word,metadata&order=created_at.desc&limit=5`;

    const res = await fetchWithRetry('supabase', url, {
      method: 'GET',
      headers: {
        'apikey': config.supabase.anonKey,
        'Authorization': `Bearer ${config.supabase.anonKey}`,
      },
      timeout: 10000,
    });

    const models = await res.json() as LoraModelRecord[];
    if (!models || models.length === 0) {
      log.warn({ category }, 'No LoRA model found for category');
      return null;
    }

    // SDXL 트레이너 모델 우선
    const sdxlModel = models.find(m => m.metadata?.trainer_type === 'sdxl');
    const model = sdxlModel || models[0];

    log.info({
      category,
      trainerType: model.metadata?.trainer_type || 'flux',
      triggerWord: model.trigger_word,
    }, 'LoRA model matched');

    return {
      loraWeights: model.model_version,
      triggerWord: model.trigger_word,
    };
  } catch (error) {
    log.warn({ category, error }, 'Failed to fetch LoRA model, proceeding without LoRA');
    return null;
  }
}

/**
 * LoRA 자동 매칭 + ControlNet 생성
 * loraWeights가 없으면 카테고리에서 자동 조회
 */
export async function generateWithAutoLora(
  input: ControlNetGenerationInput,
): Promise<ControlNetGenerationResult> {
  // LoRA 자동 매칭
  if (!input.loraWeights) {
    const lora = await getLoraForCategory(input.category);
    if (lora) {
      input.loraWeights = lora.loraWeights;
      // 프롬프트에 트리거 워드 삽입
      input.additionalPrompt = [lora.triggerWord, input.additionalPrompt].filter(Boolean).join(', ');
      log.info({ triggerWord: lora.triggerWord }, 'Auto-matched LoRA, trigger word added to prompt');
    }
  }

  return generateWithDrawingControlNet(input);
}

// ─────────────────────────────────────────────────────────────────
// A/B 테스트: Gemini vs ControlNet 비교 생성
// ─────────────────────────────────────────────────────────────────

import {
  geminiImageGeneration,
  extractImageFromGeminiResponse,
} from '../clients/gemini.client.js';
import { claudeVisionAnalysis } from '../clients/claude.client.js';

export interface ABTestResult {
  controlnet: ControlNetGenerationResult;
  gemini: {
    image: string;
    prompt: string;
  } | null;
  comparison: {
    controlnetElapsedMs: number;
    geminiElapsedMs: number | null;
  };
}

/**
 * A/B 테스트: 동일 입력으로 ControlNet + Gemini 양쪽 생성
 */
export async function generateABTest(
  input: ControlNetGenerationInput,
): Promise<ABTestResult> {
  // ControlNet 생성
  const cnStart = Date.now();
  const controlnetResult = await generateWithAutoLora(input);
  const cnElapsed = Date.now() - cnStart;

  // Gemini 생성 (기존 파이프라인)
  let geminiResult: ABTestResult['gemini'] = null;
  let geminiElapsed: number | null = null;

  try {
    const geminiPrompt = buildControlNetPrompt(input);
    const gmStart = Date.now();

    const geminiResponse = await geminiImageGeneration(
      geminiPrompt,
      input.backgroundImage,
      input.backgroundImage ? 'image/png' : undefined,
    );
    const geminiImage = extractImageFromGeminiResponse(geminiResponse);
    geminiElapsed = Date.now() - gmStart;

    if (geminiImage) {
      geminiResult = { image: geminiImage, prompt: geminiPrompt };
    }
  } catch (error) {
    log.warn({ error }, 'Gemini A/B test generation failed');
  }

  log.info({
    category: input.category,
    controlnetMs: cnElapsed,
    geminiMs: geminiElapsed,
  }, 'A/B test completed');

  return {
    controlnet: controlnetResult,
    gemini: geminiResult,
    comparison: {
      controlnetElapsedMs: cnElapsed,
      geminiElapsedMs: geminiElapsed,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Claude Vision 자동 프롬프트 생성
// 라인아트 이미지를 분석하여 최적화된 SDXL 프롬프트 생성
// ─────────────────────────────────────────────────────────────────

const PROMPT_GENERATION_SYSTEM = `You are a professional interior design image generation prompt engineer.
Given a lineart/blueprint image of Korean built-in furniture, generate an optimized SDXL text-to-image prompt.

RULES:
- Output ONLY the prompt text, no explanations
- Keep under 200 words
- Focus on: furniture type, material, finish, style, lighting, camera angle
- Include: "photorealistic, interior photography, 8k quality"
- Never include: text, labels, dimensions, annotations
- Use English only`;

/**
 * Claude Vision으로 라인아트 이미지를 분석하여
 * SDXL 이미지 생성에 최적화된 프롬프트 자동 생성
 */
export async function generateAutoPrompt(
  lineartBase64: string,
  category: string,
  style: string = 'modern',
  materialCode?: string,
): Promise<string> {
  const userPrompt = `Analyze this furniture blueprint/lineart and generate an SDXL image generation prompt.

Category: ${category} (Korean built-in furniture)
Style: ${style}
${materialCode ? `Material: ${materialCode}` : ''}

Generate a detailed photorealistic prompt for this furniture layout.
Focus on the structure visible in the blueprint.`;

  try {
    const response = await claudeVisionAnalysis(
      lineartBase64,
      'image/png',
      userPrompt,
      PROMPT_GENERATION_SYSTEM,
    );

    const generatedPrompt = response.content?.[0]?.text?.trim();
    if (!generatedPrompt) {
      log.warn('Claude Vision returned empty prompt, using fallback');
      return buildControlNetPrompt({ designData: {} as StructuredDesignData, category, style, materialCode });
    }

    log.info({
      category,
      promptLength: generatedPrompt.length,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    }, 'Auto-prompt generated via Claude Vision');

    return generatedPrompt;
  } catch (error) {
    log.warn({ error }, 'Claude Vision auto-prompt failed, using template fallback');
    return buildControlNetPrompt({ designData: {} as StructuredDesignData, category, style, materialCode });
  }
}

/**
 * Claude Vision 자동 프롬프트 + ControlNet 생성
 * useAutoPrompt=true 시 Claude Vision으로 프롬프트 자동 생성
 */
export async function generateWithAutoPrompt(
  input: ControlNetGenerationInput & { useAutoPrompt?: boolean },
): Promise<ControlNetGenerationResult> {
  if (input.useAutoPrompt) {
    // 먼저 라인아트 생성
    const drawingData = generateDrawingData(input.designData);
    const lineartBase64 = renderLineartPng(drawingData, { resolution: input.width || 1024 });

    // Claude Vision으로 프롬프트 생성
    const autoPrompt = await generateAutoPrompt(
      lineartBase64,
      input.category,
      input.style,
      input.materialCode,
    );

    // 자동 생성 프롬프트를 additionalPrompt로 오버라이드
    input.additionalPrompt = autoPrompt;
  }

  return generateWithAutoLora(input);
}
