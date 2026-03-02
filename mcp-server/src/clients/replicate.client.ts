// ═══════════════════════════════════════════════════════════════
// Replicate Client - Flux LoRA 학습 + 추론 API
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
