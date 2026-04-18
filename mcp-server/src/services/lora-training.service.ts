// ═══════════════════════════════════════════════════════════════
// LoRA Training Service
// ───────────────────────────────────────────────────────────────
// 1) furniture_images 에서 is_training=true 행을 모음
// 2) 각 image_url 을 다운로드해 zip 으로 묶음
// 3) zip 을 training-zips Supabase Storage 버킷에 업로드 (public URL 획득)
// 4) Replicate Flux LoRA 트레이너 호출 (replicate.client.startLoraTraining)
// 5) lora_models 행을 status='training' 으로 INSERT
// 6) 백그라운드 폴링: 학습 완료 시 status='ready' + model_version 업데이트
// ═══════════════════════════════════════════════════════════════

import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import { Buffer } from 'node:buffer';
import { getConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { fetchWithRetry } from '../clients/base-http.client.js';
import { startLoraTraining, getTrainingStatus } from '../clients/replicate.client.js';

const log = createLogger('lora-training');

// 카테고리별 트리거 워드 (rare token 으로 모델이 외우기 쉽게)
const TRIGGER_WORD_BY_CATEGORY: Record<string, string> = {
  fridge_cabinet: 'DADAMFRIDGE2026',
  fridge: 'DADAMFRIDGE2026',
};

const MIN_TRAINING_IMAGES = 10;
const MAX_TRAINING_IMAGES = 100;
const POLL_INTERVAL_MS = 30_000;       // 30s
const POLL_MAX_DURATION_MS = 90 * 60_000; // 90 min

// 카테고리별 fridge_cabinet/fridge 처럼 같은 카테고리로 취급할 alias
const CATEGORY_ALIASES: Record<string, string[]> = {
  fridge_cabinet: ['fridge_cabinet', 'fridge'],
  fridge: ['fridge_cabinet', 'fridge'],
};

interface TrainingImage {
  id: string;
  image_url: string;
  description?: string | null;
  style?: string | null;
}

interface LoraModelRow {
  id: string;
  category: string;
  model_id: string;
  model_version: string | null;
  trigger_word: string;
  status: 'training' | 'ready' | 'failed' | 'deprecated';
  replicate_training_id: string | null;
  metadata: Record<string, unknown>;
  training_images_count?: number | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────
// 헤더 / URL 헬퍼
// ─────────────────────────────────────────────────────────────────

function supabaseRestHeaders(userToken: string, prefer?: string): Record<string, string> {
  const config = getConfig();
  const h: Record<string, string> = {
    'apikey': config.supabase.anonKey,
    'Authorization': `Bearer ${userToken}`,
    'Content-Type': 'application/json',
  };
  if (prefer) h['Prefer'] = prefer;
  return h;
}

function supabaseStorageHeaders(userToken: string, contentType?: string): Record<string, string> {
  const config = getConfig();
  const h: Record<string, string> = {
    'apikey': config.supabase.anonKey,
    'Authorization': `Bearer ${userToken}`,
  };
  if (contentType) h['Content-Type'] = contentType;
  return h;
}

function restUrl(path: string): string {
  return `${getConfig().supabase.url}/rest/v1/${path}`;
}
function storageUploadUrl(bucket: string, path: string): string {
  return `${getConfig().supabase.url}/storage/v1/object/${bucket}/${path}`;
}
function storagePublicUrl(bucket: string, path: string): string {
  return `${getConfig().supabase.url}/storage/v1/object/public/${bucket}/${path}`;
}

// ─────────────────────────────────────────────────────────────────
// 1. 학습 이미지 조회
// ─────────────────────────────────────────────────────────────────

export async function gatherTrainingImages(
  userToken: string,
  category: string,
): Promise<TrainingImage[]> {
  const cats = CATEGORY_ALIASES[category] || [category];
  const inFilter = `(${cats.join(',')})`;
  const url = restUrl(
    `furniture_images?select=id,image_url,description,style&category=in.${encodeURIComponent(inFilter)}&is_training=eq.true&order=created_at.desc&limit=${MAX_TRAINING_IMAGES}`,
  );
  const res = await fetchWithRetry('supabase', url, {
    headers: supabaseRestHeaders(userToken),
    timeout: 15000,
  });
  const rows = await res.json() as TrainingImage[];
  return rows.filter((r) => !!r.image_url);
}

// ─────────────────────────────────────────────────────────────────
// 2. zip 패키징 (메모리 스트림)
// ─────────────────────────────────────────────────────────────────

async function downloadImage(url: string): Promise<{ buffer: Buffer; ext: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`이미지 다운로드 실패 ${res.status}: ${url}`);
  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  // URL 끝의 확장자 추출 (없으면 jpg)
  const m = url.split('?')[0].match(/\.([a-z0-9]{1,5})$/i);
  const ext = (m ? m[1] : 'jpg').toLowerCase();
  return { buffer, ext: /^[a-z0-9]+$/.test(ext) ? ext : 'jpg' };
}

async function packageImagesAsZip(images: TrainingImage[]): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 6 } });
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));

  archive.pipe(stream);

  let i = 0;
  for (const img of images) {
    try {
      const { buffer, ext } = await downloadImage(img.image_url);
      const filename = `img_${String(++i).padStart(3, '0')}.${ext}`;
      archive.append(buffer, { name: filename });
    } catch (e) {
      log.warn({ url: img.image_url, error: (e as Error).message }, '이미지 zip 추가 스킵');
    }
  }

  if (i === 0) throw new Error('zip 에 추가된 이미지 0장 — 모든 다운로드 실패');

  const finalize = new Promise<void>((resolve, reject) => {
    stream.on('end', () => resolve());
    stream.on('error', reject);
    archive.on('error', reject);
  });
  await archive.finalize();
  await finalize;
  return Buffer.concat(chunks);
}

// ─────────────────────────────────────────────────────────────────
// 3. Supabase Storage 업로드
// ─────────────────────────────────────────────────────────────────

async function uploadZipToStorage(
  userToken: string,
  category: string,
  zipBuffer: Buffer,
): Promise<string> {
  const objectPath = `${category}/${Date.now()}.zip`;
  const url = storageUploadUrl('training-zips', objectPath);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...supabaseStorageHeaders(userToken, 'application/zip'),
      'x-upsert': 'true',
    },
    body: new Uint8Array(zipBuffer),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown');
    throw new Error(`zip 업로드 실패 ${res.status}: ${errText.substring(0, 200)}`);
  }
  return storagePublicUrl('training-zips', objectPath);
}

// ─────────────────────────────────────────────────────────────────
// 4. lora_models CRUD
// ─────────────────────────────────────────────────────────────────

async function insertLoraModel(
  userToken: string,
  row: Omit<LoraModelRow, 'id' | 'created_at'>,
): Promise<LoraModelRow> {
  const res = await fetchWithRetry('supabase', restUrl('lora_models'), {
    method: 'POST',
    headers: supabaseRestHeaders(userToken, 'return=representation'),
    body: JSON.stringify(row),
    timeout: 10000,
  });
  const rows = await res.json() as LoraModelRow[];
  if (rows.length === 0) throw new Error('lora_models INSERT 실패 — 0 rows (RLS?)');
  return rows[0];
}

async function updateLoraModel(
  userToken: string,
  id: string,
  patch: Partial<LoraModelRow>,
): Promise<void> {
  const res = await fetchWithRetry('supabase', restUrl(`lora_models?id=eq.${id}`), {
    method: 'PATCH',
    headers: supabaseRestHeaders(userToken),
    body: JSON.stringify(patch),
    timeout: 10000,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown');
    log.warn({ id, status: res.status, error: errText.substring(0, 200) }, 'lora_models UPDATE 실패');
  }
}

export async function listLoraModels(
  userToken: string,
  category?: string,
): Promise<LoraModelRow[]> {
  let url = restUrl('lora_models?select=*&order=created_at.desc');
  if (category) {
    const cats = CATEGORY_ALIASES[category] || [category];
    url += `&category=in.(${cats.join(',')})`;
  }
  const res = await fetchWithRetry('supabase', url, {
    headers: supabaseRestHeaders(userToken),
    timeout: 10000,
  });
  return res.json() as Promise<LoraModelRow[]>;
}

export async function getLoraStatus(
  userToken: string,
  id: string,
): Promise<LoraModelRow | null> {
  const res = await fetchWithRetry('supabase', restUrl(`lora_models?id=eq.${id}&select=*`), {
    headers: supabaseRestHeaders(userToken),
    timeout: 10000,
  });
  const rows = await res.json() as LoraModelRow[];
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────
// 5. 학습 시작 (전체 흐름 orchestrator)
// ─────────────────────────────────────────────────────────────────

export interface StartTrainingResult {
  loraModelId: string;
  replicateTrainingId: string;
  category: string;
  triggerWord: string;
  imagesCount: number;
  zipUrl: string;
}

export async function startTrainingForCategory(
  userToken: string,
  category: string,
  options: { steps?: number; resolution?: number } = {},
): Promise<StartTrainingResult> {
  const triggerWord = TRIGGER_WORD_BY_CATEGORY[category];
  if (!triggerWord) {
    throw new Error(`지원하지 않는 카테고리: ${category}. 현재 ${Object.keys(TRIGGER_WORD_BY_CATEGORY).join(', ')} 만 가능`);
  }

  log.info({ category, triggerWord }, '[1/5] 학습 이미지 수집');
  const images = await gatherTrainingImages(userToken, category);
  if (images.length < MIN_TRAINING_IMAGES) {
    throw new Error(`학습 이미지 부족: ${images.length}장 (최소 ${MIN_TRAINING_IMAGES}장 필요)`);
  }
  log.info({ count: images.length }, '[1/5] 수집 완료');

  log.info({ count: images.length }, '[2/5] zip 패키징');
  const zipBuffer = await packageImagesAsZip(images);
  log.info({ sizeKB: Math.round(zipBuffer.length / 1024) }, '[2/5] zip 완료');

  log.info('[3/5] Supabase Storage 업로드');
  const zipUrl = await uploadZipToStorage(userToken, category, zipBuffer);
  log.info({ zipUrl }, '[3/5] 업로드 완료');

  log.info('[4/5] Replicate 학습 시작');
  const training = await startLoraTraining({
    inputImagesUrl: zipUrl,
    triggerWord,
    steps: options.steps || 1000,
    resolution: options.resolution || 512,
  });
  log.info({ trainingId: training.id, status: training.status }, '[4/5] 학습 시작');

  log.info('[5/5] lora_models 행 생성');
  const lora = await insertLoraModel(userToken, {
    category,
    model_id: 'flux-dev-lora',
    model_version: null,
    trigger_word: triggerWord,
    status: 'training',
    replicate_training_id: training.id,
    training_images_count: images.length,
    metadata: {
      zip_url: zipUrl,
      training_started_at: new Date().toISOString(),
      steps: options.steps || 1000,
      resolution: options.resolution || 512,
    },
  });
  log.info({ loraModelId: lora.id }, '[5/5] DB 저장 완료');

  // 백그라운드 폴링 — 사용자 토큰으로 업데이트하도록 클로저로 토큰 보관
  void schedulePolling(userToken, lora.id, training.id);

  return {
    loraModelId: lora.id,
    replicateTrainingId: training.id,
    category,
    triggerWord,
    imagesCount: images.length,
    zipUrl,
  };
}

// ─────────────────────────────────────────────────────────────────
// 6. 백그라운드 폴링
// ─────────────────────────────────────────────────────────────────

const activePolls = new Map<string, NodeJS.Timeout>();

function schedulePolling(userToken: string, loraId: string, trainingId: string): Promise<void> {
  if (activePolls.has(loraId)) {
    log.warn({ loraId }, '이미 폴링 중 — 스킵');
    return Promise.resolve();
  }

  const startedAt = Date.now();
  log.info({ loraId, trainingId }, '폴링 시작');

  return new Promise((resolve) => {
    const tick = async () => {
      try {
        const elapsed = Date.now() - startedAt;
        if (elapsed > POLL_MAX_DURATION_MS) {
          log.warn({ loraId, elapsedMs: elapsed }, '폴링 타임아웃');
          await updateLoraModel(userToken, loraId, {
            status: 'failed',
            metadata: { polling_timeout: true, elapsed_ms: elapsed },
          });
          stopPolling(loraId);
          return resolve();
        }

        const status = await getTrainingStatus(trainingId);
        log.debug({ loraId, status: status.status }, '폴링');

        if (status.status === 'succeeded') {
          const modelVersion = status.output?.version || status.version || '';
          await updateLoraModel(userToken, loraId, {
            status: 'ready',
            model_version: modelVersion,
            metadata: {
              completed_at: status.completed_at || new Date().toISOString(),
              weights_url: status.output?.weights,
              predict_time: status.metrics?.predict_time,
            },
          });
          log.info({ loraId, modelVersion }, '학습 완료');
          stopPolling(loraId);
          return resolve();
        }
        if (status.status === 'failed' || status.status === 'canceled') {
          await updateLoraModel(userToken, loraId, {
            status: 'failed',
            metadata: { failed_at: new Date().toISOString(), error: status.error || status.status },
          });
          log.warn({ loraId, error: status.error }, '학습 실패');
          stopPolling(loraId);
          return resolve();
        }
      } catch (e) {
        log.warn({ loraId, error: (e as Error).message }, '폴링 에러 — 다음 tick 에서 재시도');
      }
    };

    const handle = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    activePolls.set(loraId, handle);
    // 초기 1회 즉시 실행 (5s 후)
    setTimeout(() => { void tick(); }, 5000);
  });
}

function stopPolling(loraId: string): void {
  const handle = activePolls.get(loraId);
  if (handle) {
    clearInterval(handle);
    activePolls.delete(loraId);
  }
}

// 서버 재시작 시 status='training' 인 행을 다시 폴링 큐에 넣는 helper (옵션)
export async function resumePollingOnStartup(serviceToken: string): Promise<number> {
  try {
    const url = restUrl(`lora_models?status=eq.training&select=id,replicate_training_id`);
    const res = await fetchWithRetry('supabase', url, {
      headers: supabaseRestHeaders(serviceToken),
      timeout: 10000,
    });
    const rows = await res.json() as Array<{ id: string; replicate_training_id: string | null }>;
    let resumed = 0;
    for (const row of rows) {
      if (row.replicate_training_id) {
        void schedulePolling(serviceToken, row.id, row.replicate_training_id);
        resumed++;
      }
    }
    return resumed;
  } catch (e) {
    log.warn({ error: (e as Error).message }, '재시작 폴링 복구 실패');
    return 0;
  }
}
