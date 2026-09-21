/**
 * ControlNet 경로 — fal.ai 로 "구조 조건 이미지" 를 네이티브로 받는 모델을 부른다 (2026-09-22).
 *
 * 왜: Gemini 에는 구조를 강제할 입력이 없다 (마스크·윤곽선·깊이 조건 없음, Imagen 은 2026-08 종료).
 *   실사화(realize)는 합성본을 바탕 사진으로 줘서 "설득" 하는 방식이고, 이 경로는 구조 조건을
 *   모델이 학습된 입력으로 받는다. 계획서 docs/01-plan/photo-composite-research.plan.md §5-C.
 *
 * 입력은 전부 **공개 URL** 이다 — 방 사진(또는 합성본)과 구조 조건 이미지는 이미 Supabase 공개 버킷에
 *   올라가 있으므로(worker.js inputs.room / inputs.control) base64 를 다시 나르지 않는다.
 *   fal 문서: "You can pass your own URLs as long as they are publicly accessible."
 *
 * 모델은 env.CONTROLNET_MODEL 로 고른다. 스키마가 문서로 확인된 것만 둔다:
 *   - fal-ai/flux-control-lora-canny/image-to-image  (기본) image_url + control_lora_image_url + strength
 *   - fal-ai/flux-control-lora-depth/image-to-image
 *   - fal-ai/qwen-image-edit-2509 / 2511                image_urls:[바탕, 조건] — 조건은 프롬프트로 지시 (HF 카드)
 *   flux-general/inpainting 의 controlnet_unions 는 `path` 유효값이 미확인이라 아직 안 둔다.
 *
 * 큐 계약 (https://fal.ai/docs/model-apis/model-endpoints/queue):
 *   POST https://queue.fal.run/{model}  Authorization: Key $FAL_KEY  → {request_id, status_url, response_url}
 *   GET  status_url → {status: IN_QUEUE|IN_PROGRESS|COMPLETED, error?}
 *   GET  response_url → {images:[{url,width,height,content_type}], seed, timings}
 */
import { CATEGORIES, resolveCategory, designSpecDigest } from './prompts.js';

export const FAL_QUEUE_BASE = 'https://queue.fal.run';
export const DEFAULT_CONTROLNET_MODEL = 'fal-ai/flux-control-lora-canny/image-to-image';

/** 문서로 스키마를 확인한 모델만. kind 가 요청 JSON 모양을 정한다. */
export const CONTROLNET_MODELS = {
  'fal-ai/flux-control-lora-canny/image-to-image': { kind: 'flux-control-lora', control: 'canny', pricePerMp: 0.04 },
  'fal-ai/flux-control-lora-depth/image-to-image': { kind: 'flux-control-lora', control: 'depth', pricePerMp: 0.04 },
  'fal-ai/qwen-image-edit-2509': { kind: 'qwen-edit', pricePerMp: 0.03 },
  'fal-ai/qwen-image-edit-2511': { kind: 'qwen-edit', pricePerMp: 0.03 },
};

export function controlNetModel(env) {
  const m = env && env.CONTROLNET_MODEL;
  return CONTROLNET_MODELS[m] ? m : DEFAULT_CONTROLNET_MODEL;
}

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 마감 한 줄 — design_spec.finishes 의 영문 이름·색·톤. 없으면 door_color/door_finish. */
export function controlNetFinishPhrase(c) {
  const fin = (c.designSpec && c.designSpec.finishes) || null;
  const one = (f) => {
    if (!f) return null;
    const name = f.nameEn || f.name || null;
    const parts = [name, f.colorHex ? `(${f.colorHex})` : null, f.tone === 'gloss' ? 'high-gloss' : f.tone === 'matte' ? 'matte' : null].filter(Boolean);
    return parts.length ? parts.join(' ') : null;
  };
  const door = one(fin && fin.door) || `${c.doorColor || 'white'} ${c.doorFinish || 'matte'}`;
  const body = one(fin && fin.body);
  const top = one(fin && fin.top);
  return `Door and drawer fronts: ${door}.` + (body ? ` Carcass and visible sides: ${body}.` : '') + (top ? ` Countertop: ${top}.` : '');
}

/**
 * 조건 모델용 프롬프트 — 짧고 서술형. 구조는 조건 이미지가 말하므로 문장은 "그대로 따르라" 와 재질·규칙만.
 * fix 는 QC 가 낸 코드 목록 (prompts.js QC_FIXES 키) — 한 줄로 덧붙인다.
 */
export function buildControlNetPrompt(c, opts = {}) {
  const key = resolveCategory(c.category);
  const label = CATEGORIES[key].label;
  const digest = designSpecDigest(c.designSpec);
  const fix = Array.isArray(opts.fix) && opts.fix.length ? ` Previous attempt failed: ${opts.fix.join(', ')} — fix these.` : '';
  return (
    `Photorealistic interior photograph. A built-in ${label} (${key}) is installed on the main wall exactly as the structure image shows: ` +
    `follow every outer edge, module boundary, door and drawer split, count and position — do not move, resize, add or remove any module.` +
    (digest ? ` Left to right: ${digest}.` : '') +
    ` ${controlNetFinishPhrase(c)}` +
    ` Flat handleless fronts, all doors and drawers closed, no handles, knobs or bars.` +
    ` Real materials with grain and sheen, depth on side panels and countertop edge, contact shadows and reflections consistent with the room's lighting.` +
    ` Keep the room — walls, ceiling, floor, windows, camera — exactly as photographed. No text or watermarks.` +
    fix
  );
}

/**
 * 요청 JSON. 필드명은 fal API 페이지에서 확인한 것만 쓴다.
 * @param {{model?:string, prompt:string, baseUrl:string, controlUrl:string, size?:{width:number,height:number}, seed?:number}} p
 */
export function buildControlNetInput(env, p) {
  const model = p.model || controlNetModel(env);
  const cfg = CONTROLNET_MODELS[model];
  if (!cfg) throw new Error(`unknown controlnet model: ${model}`);
  const size = p.size && Number.isFinite(Number(p.size.width)) && Number.isFinite(Number(p.size.height))
    ? { width: clamp(Math.round(Number(p.size.width)), 256, 4096), height: clamp(Math.round(Number(p.size.height)), 256, 4096) }
    : null;
  const seed = Number.isFinite(Number(p.seed)) ? Number(p.seed) : undefined;
  if (cfg.kind === 'flux-control-lora') {
    return {
      prompt: p.prompt,
      image_url: p.baseUrl,
      control_lora_image_url: p.controlUrl,
      // strength 1.0 = 바탕을 완전히 다시 그린다, 0 = 그대로. 합성본이 바탕이므로 0.8 근처가 출발점.
      strength: clamp(num(env && env.CONTROLNET_STRENGTH, 0.8), 0, 1),
      control_lora_strength: clamp(num(env && env.CONTROLNET_CONTROL_STRENGTH, 1), 0, 2),
      ...(size ? { image_size: size } : {}),
      num_inference_steps: 28,
      guidance_scale: 3.5,
      num_images: 1,
      output_format: 'jpeg',
      enable_safety_checker: true,
      ...(seed !== undefined ? { seed } : {}),
    };
  }
  // qwen-edit: 조건 이미지를 image_urls 에 같이 넣고 프롬프트에서 지시한다 (별도 필드 없음)
  return {
    prompt: `Picture 1 is the room (with a flat cabinet mockup already placed). Picture 2 is the structure map of those cabinets in the same camera view. ${p.prompt}`,
    image_urls: [p.baseUrl, p.controlUrl],
    ...(size ? { image_size: size } : {}),
    num_inference_steps: 40,
    guidance_scale: 4,
    num_images: 1,
    output_format: 'jpeg',
    enable_safety_checker: true,
    ...(seed !== undefined ? { seed } : {}),
  };
}

function bytesToBase64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

/**
 * fal 큐: 제출 → 상태 폴링 → 결과 → 첫 이미지 내려받기.
 * @returns {Promise<{base64:string, mimeType:string, url:string, requestId:string, model:string, elapsedMs:number, seed:any}>}
 */
export async function runFal(env, model, input, opt = {}) {
  if (!env || !env.FAL_KEY) throw new Error('FAL_KEY not configured');
  const f = opt.fetch || fetch;
  const sleep = opt.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = num(opt.timeoutMs, 180_000);
  const pollMs = num(opt.pollMs, 2_000);
  // 요청 하나의 시간 제한 — 전체 180초 제한은 폴링 루프 머리에서만 검사되므로, 안 돌아오는 fetch 는 스스로 끊는다
  const requestMs = num(opt.requestTimeoutMs, 60_000);
  const sig = () => AbortSignal.timeout(requestMs);
  const headers = { Authorization: `Key ${env.FAL_KEY}`, 'Content-Type': 'application/json' };
  const t0 = Date.now();

  const sub = await f(`${FAL_QUEUE_BASE}/${model}`, { method: 'POST', headers, body: JSON.stringify(input), signal: sig() });
  const subText = await sub.text();
  if (!sub.ok) throw new Error(`fal submit ${sub.status}: ${subText.slice(0, 200)}`);
  const ticket = JSON.parse(subText);
  if (!ticket.request_id) throw new Error('fal submit returned no request_id');
  const statusUrl = ticket.status_url || `${FAL_QUEUE_BASE}/${model}/requests/${ticket.request_id}/status`;
  const responseUrl = ticket.response_url || `${FAL_QUEUE_BASE}/${model}/requests/${ticket.request_id}`;

  let status = 'IN_QUEUE';
  while (status !== 'COMPLETED') {
    if (Date.now() - t0 > timeoutMs) throw new Error(`fal timeout after ${Math.round((Date.now() - t0) / 1000)}s (${status})`);
    await sleep(pollMs);
    const st = await f(statusUrl, { headers: { Authorization: headers.Authorization }, signal: sig() });
    const stText = await st.text();
    if (!st.ok) throw new Error(`fal status ${st.status}: ${stText.slice(0, 200)}`);
    const j = JSON.parse(stText);
    status = j.status || status;
    if (j.error || j.error_type) throw new Error(`fal failed: ${j.error_type || ''} ${typeof j.error === 'string' ? j.error : JSON.stringify(j.error)}`.trim());
  }

  const res = await f(responseUrl, { headers: { Authorization: headers.Authorization }, signal: sig() });
  const resText = await res.text();
  if (!res.ok) throw new Error(`fal result ${res.status}: ${resText.slice(0, 200)}`);
  const out = JSON.parse(resText);
  const img = Array.isArray(out.images) && out.images[0];
  if (!img || !img.url) throw new Error('fal returned no image');

  const dl = await f(img.url, { signal: AbortSignal.timeout(Math.max(requestMs, 120_000)) });
  if (!dl.ok) throw new Error(`fal image download ${dl.status}`);
  const bytes = new Uint8Array(await dl.arrayBuffer());
  const mimeType = img.content_type || dl.headers.get('content-type') || 'image/jpeg';
  return { base64: bytesToBase64(bytes), mimeType, url: img.url, requestId: ticket.request_id, model, elapsedMs: Date.now() - t0, seed: out.seed };
}

/**
 * 잡에서 부르는 한 줄. ctx 는 job.js 의 설치 ctx (category·designSpec·doorColor…).
 * @param {{ctx:object, baseUrl:string, controlUrl:string, size?:object, fix?:string[], seed?:number}} p
 */
export async function runControlNet(env, p, opt) {
  const model = controlNetModel(env);
  const prompt = buildControlNetPrompt(p.ctx, { fix: p.fix });
  const input = buildControlNetInput(env, { model, prompt, baseUrl: p.baseUrl, controlUrl: p.controlUrl, size: p.size, seed: p.seed });
  const r = await runFal(env, model, input, opt);
  return { base64: r.base64, mimeType: r.mimeType, meta: { model, requestId: r.requestId, elapsedMs: r.elapsedMs, seed: r.seed, prompt } };
}
