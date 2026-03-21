// ═══════════════════════════════════════════════════════════════
// Replicate Client - Flux LoRA 학습 + 추론 + ControlNet API
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { fetchWithRetry } from './base-http.client.js';
import { ExternalApiError } from '../utils/errors.js';

const log = createLogger('replicate-client');

const REPLICATE_BASE = 'https://api.replicate.com/v1';

function getApiKey(): string {
  const key = process.env.REPLICATE_API_KEY;
  if (!key) throw new Error('REPLICATE_API_KEY not set');
  return key;
}

function headers(): Record<string, string> {
  return {
    'Authorization': `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  };
}

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

export interface LoraTrainingInput {
  /** 학습 이미지 zip URL (Supabase Storage public URL) */
  inputImagesUrl: string;
  /** 트리거 워드 (예: DADAM_SINK) */
  triggerWord: string;
  /** 학습 스텝 (기본 1000) */
  steps?: number;
  /** 학습률 (기본 0.0004) */
  learningRate?: number;
  /** 해상도 (기본 512) */
  resolution?: number;
}

export interface TrainingStatus {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  model?: string;
  version?: string;
  output?: {
    version?: string;
    weights?: string;
  };
  error?: string;
  logs?: string;
  metrics?: {
    predict_time?: number;
  };
  created_at: string;
  completed_at?: string;
}

export interface PredictionInput {
  /** 학습된 LoRA 모델 버전 */
  modelVersion: string;
  /** 생성 프롬프트 */
  prompt: string;
  /** 입력 이미지 (img2img, base64 URL 또는 HTTP URL) */
  image?: string;
  /** 입력 이미지 영향도 (0.0~1.0, 기본 0.75) */
  strength?: number;
  /** 생성 이미지 수 (기본 1) */
  numOutputs?: number;
  /** 가이던스 스케일 (기본 7.5) */
  guidanceScale?: number;
  /** 추론 스텝 (기본 28) */
  numInferenceSteps?: number;
  /** 출력 형식 */
  outputFormat?: 'png' | 'webp' | 'jpg';
  /** 해상도 */
  width?: number;
  height?: number;
}

export interface Prediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string[];
  error?: string;
  metrics?: {
    predict_time?: number;
  };
  created_at: string;
  completed_at?: string;
}

// ─────────────────────────────────────────────────────────────
// ControlNet 타입
// ─────────────────────────────────────────────────────────────

export type ControlNetType =
  | 'none' | 'canny' | 'lineart' | 'lineart_anime'
  | 'soft_edge_hed' | 'soft_edge_pidi'
  | 'depth_midas' | 'depth_leres'
  | 'openpose' | 'qr';

export interface ControlNetLayer {
  /** ControlNet 타입 */
  type: ControlNetType;
  /** 조건 이미지 (base64 data URI 또는 HTTP URL) */
  image: string;
  /** 조건 강도 (0.0~4.0, 기본 0.75) */
  conditioningScale?: number;
  /** 적용 시작점 (0.0~1.0, 기본 0.0) */
  start?: number;
  /** 적용 종료점 (0.0~1.0, 기본 1.0) */
  end?: number;
}

export interface ControlNetInput {
  /** 프롬프트 */
  prompt: string;
  /** 네거티브 프롬프트 */
  negativePrompt?: string;
  /** ControlNet 레이어 (최대 3개) */
  controlNets: ControlNetLayer[];
  /** LoRA weights URL (Replicate model 또는 HuggingFace URL) */
  loraWeights?: string;
  /** LoRA 스케일 (0.0~1.0, 기본 0.6) */
  loraScale?: number;
  /** img2img 입력 이미지 */
  image?: string;
  /** img2img 강도 (0.0~1.0, 기본 0.8) */
  promptStrength?: number;
  /** 해상도 */
  width?: number;
  height?: number;
  /** 추론 스텝 (기본 30) */
  numInferenceSteps?: number;
  /** 가이던스 스케일 (기본 7.5) */
  guidanceScale?: number;
  /** 시드 (재현성) */
  seed?: number;
  /** 출력 수 (기본 1) */
  numOutputs?: number;
  /** 스케줄러 */
  scheduler?: 'DDIM' | 'DPMSolverMultistep' | 'HeunDiscrete' | 'KarrasDPM' | 'K_EULER_ANCESTRAL' | 'K_EULER' | 'PNDM';
}

// ─────────────────────────────────────────────────────────────
// LoRA 학습
// ─────────────────────────────────────────────────────────────

const FLUX_TRAINER = 'ostris/flux-dev-lora-trainer';
const FLUX_TRAINER_VERSION = 'e440909d01a3b47efab37a893702ed90c708d8e2ede3465f1e8aac1c9e2efff5';

/**
 * Flux LoRA 학습 시작
 * @returns training ID
 */
export async function startLoraTraining(
  input: LoraTrainingInput,
  destinationModel?: string
): Promise<TrainingStatus> {
  const body: Record<string, unknown> = {
    version: FLUX_TRAINER_VERSION,
    input: {
      input_images: input.inputImagesUrl,
      trigger_word: input.triggerWord,
      steps: input.steps || 1000,
      learning_rate: input.learningRate || 0.0004,
      resolution: input.resolution || 512,
      autocaption: true,
      batch_size: 1,
    },
  };

  if (destinationModel) {
    body.destination = destinationModel;
  }

  log.info({ triggerWord: input.triggerWord, steps: input.steps }, 'Starting LoRA training');

  const res = await fetchWithRetry('replicate', `${REPLICATE_BASE}/trainings`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    timeout: 30000,
  });

  const data = await res.json() as TrainingStatus;
  log.info({ trainingId: data.id, status: data.status }, 'Training started');
  return data;
}

/**
 * 학습 상태 확인
 */
export async function getTrainingStatus(trainingId: string): Promise<TrainingStatus> {
  const res = await fetchWithRetry('replicate', `${REPLICATE_BASE}/trainings/${trainingId}`, {
    method: 'GET',
    headers: headers(),
    timeout: 15000,
  });

  return res.json() as Promise<TrainingStatus>;
}

/**
 * 학습 완료까지 대기 (polling)
 */
export async function waitForTraining(
  trainingId: string,
  pollInterval = 10000,
  maxWait = 1800000  // 30분
): Promise<TrainingStatus> {
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const status = await getTrainingStatus(trainingId);

    if (status.status === 'succeeded') {
      log.info({ trainingId, elapsed: Date.now() - start }, 'Training completed');
      return status;
    }
    if (status.status === 'failed' || status.status === 'canceled') {
      throw new ExternalApiError('replicate', `Training ${status.status}: ${status.error || 'unknown'}`);
    }

    log.debug({ trainingId, status: status.status }, 'Training in progress...');
    await new Promise(r => setTimeout(r, pollInterval));
  }

  throw new ExternalApiError('replicate', `Training timeout after ${maxWait / 1000}s`);
}

// ─────────────────────────────────────────────────────────────
// 이미지 생성 (추론)
// ─────────────────────────────────────────────────────────────

/**
 * Flux LoRA 모델로 이미지 생성
 */
export async function generateWithLora(input: PredictionInput): Promise<Prediction> {
  const body = {
    version: input.modelVersion,
    input: {
      prompt: input.prompt,
      ...(input.image && { image: input.image }),
      ...(input.strength != null && { prompt_strength: 1 - input.strength }),
      num_outputs: input.numOutputs || 1,
      guidance_scale: input.guidanceScale || 7.5,
      num_inference_steps: input.numInferenceSteps || 28,
      output_format: input.outputFormat || 'png',
      ...(input.width && { width: input.width }),
      ...(input.height && { height: input.height }),
    },
  };

  log.info({ version: input.modelVersion.substring(0, 12) }, 'Starting LoRA prediction');

  const res = await fetchWithRetry('replicate', `${REPLICATE_BASE}/predictions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    timeout: 30000,
  });

  return res.json() as Promise<Prediction>;
}

/**
 * 예측 상태 확인
 */
export async function getPredictionStatus(predictionId: string): Promise<Prediction> {
  const res = await fetchWithRetry('replicate', `${REPLICATE_BASE}/predictions/${predictionId}`, {
    method: 'GET',
    headers: headers(),
    timeout: 15000,
  });

  return res.json() as Promise<Prediction>;
}

/**
 * 이미지 생성 완료까지 대기 → base64 반환
 */
export async function generateAndWait(
  input: PredictionInput,
  pollInterval = 3000,
  maxWait = 120000  // 2분
): Promise<string[]> {
  const prediction = await generateWithLora(input);
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const status = await getPredictionStatus(prediction.id);

    if (status.status === 'succeeded' && status.output) {
      log.info({
        predictionId: prediction.id,
        elapsed: Date.now() - start,
        outputs: status.output.length,
      }, 'Prediction completed');
      return status.output;
    }
    if (status.status === 'failed' || status.status === 'canceled') {
      throw new ExternalApiError('replicate', `Prediction ${status.status}: ${status.error || 'unknown'}`);
    }

    await new Promise(r => setTimeout(r, pollInterval));
  }

  throw new ExternalApiError('replicate', `Prediction timeout after ${maxWait / 1000}s`);
}

/**
 * 이미지 URL을 base64로 변환
 */
export async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new ExternalApiError('replicate', `Failed to fetch image: ${res.status}`);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

// ─────────────────────────────────────────────────────────────
// ControlNet 이미지 생성 (fofr/sdxl-multi-controlnet-lora)
// ─────────────────────────────────────────────────────────────

const CONTROLNET_MODEL = 'fofr/sdxl-multi-controlnet-lora';

/**
 * SDXL ControlNet + LoRA로 이미지 생성
 * 최대 3개의 ControlNet 레이어 + 선택적 LoRA 적용
 */
export async function generateWithControlNet(input: ControlNetInput): Promise<Prediction> {
  const apiInput: Record<string, unknown> = {
    prompt: input.prompt,
    negative_prompt: input.negativePrompt || 'blurry, cartoon, sketch, wireframe, low quality, distorted, deformed',
    width: input.width || 1024,
    height: input.height || 1024,
    num_outputs: input.numOutputs || 1,
    num_inference_steps: input.numInferenceSteps || 30,
    guidance_scale: input.guidanceScale || 7.5,
    scheduler: input.scheduler || 'K_EULER',
    disable_safety_checker: true,
    apply_watermark: false,
  };

  if (input.seed != null) apiInput.seed = input.seed;
  if (input.image) {
    apiInput.image = input.image;
    apiInput.prompt_strength = input.promptStrength ?? 0.8;
  }

  // LoRA 설정
  if (input.loraWeights) {
    apiInput.lora_weights = input.loraWeights;
    apiInput.lora_scale = input.loraScale ?? 0.6;
  }

  // ControlNet 레이어 (최대 3개)
  for (let i = 0; i < Math.min(input.controlNets.length, 3); i++) {
    const cn = input.controlNets[i];
    const idx = i + 1;
    apiInput[`controlnet_${idx}`] = cn.type;
    apiInput[`controlnet_${idx}_image`] = cn.image;
    apiInput[`controlnet_${idx}_conditioning_scale`] = cn.conditioningScale ?? 0.75;
    apiInput[`controlnet_${idx}_start`] = cn.start ?? 0.0;
    apiInput[`controlnet_${idx}_end`] = cn.end ?? 1.0;
  }

  log.info({
    controlNets: input.controlNets.map(cn => cn.type),
    hasLora: !!input.loraWeights,
    width: apiInput.width,
    height: apiInput.height,
  }, 'Starting ControlNet prediction');

  const res = await fetchWithRetry('replicate', `${REPLICATE_BASE}/models/${CONTROLNET_MODEL}/predictions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ input: apiInput }),
    timeout: 30000,
  });

  return res.json() as Promise<Prediction>;
}

/**
 * ControlNet 이미지 생성 완료까지 대기 → 이미지 URL 반환
 */
export async function generateWithControlNetAndWait(
  input: ControlNetInput,
  pollInterval = 3000,
  maxWait = 180000  // 3분
): Promise<string[]> {
  const prediction = await generateWithControlNet(input);
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const status = await getPredictionStatus(prediction.id);

    if (status.status === 'succeeded' && status.output) {
      log.info({
        predictionId: prediction.id,
        elapsed: Date.now() - start,
        outputs: status.output.length,
        predictTime: status.metrics?.predict_time,
      }, 'ControlNet prediction completed');
      return status.output;
    }
    if (status.status === 'failed' || status.status === 'canceled') {
      throw new ExternalApiError('replicate', `ControlNet prediction ${status.status}: ${status.error || 'unknown'}`);
    }

    await new Promise(r => setTimeout(r, pollInterval));
  }

  throw new ExternalApiError('replicate', `ControlNet prediction timeout after ${maxWait / 1000}s`);
}
