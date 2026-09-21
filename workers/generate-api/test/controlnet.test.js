/**
 * ControlNet 경로 (src/controlnet.js) — fal.ai 큐 계약과 요청 JSON 을 고정한다.
 *
 *   1) 모델 선택: 아는 모델만, 모르면 기본(flux-control-lora-canny i2i)
 *   2) 요청 JSON 필드명 — fal API 페이지에서 확인한 이름 그대로
 *   3) 프롬프트 — 구조는 조건 이미지, 문장은 "그대로 따르라" + 마감 + 매립 손잡이 규칙
 *   4) 큐: 제출 → 폴링 → 결과 → 내려받기, 헤더 `Key`, 실패·타임아웃은 던진다
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROLNET_MODELS,
  DEFAULT_CONTROLNET_MODEL,
  FAL_QUEUE_BASE,
  buildControlNetInput,
  buildControlNetPrompt,
  controlNetFinishPhrase,
  controlNetModel,
  runControlNet,
  runFal,
} from '../src/controlnet.js';

const CTX = {
  category: 'sink',
  doorColor: 'white',
  doorFinish: 'matte',
  designSpec: {
    category: 'sink',
    wallRunMm: 3600,
    sections: { lower: { modules: [{ kind: 'drawer', drawerCount: 3, widthMm: 600 }, { kind: 'door', doorCount: 2, widthMm: 800 }] } },
    appliances: [{ kind: 'dishwasher', fromLeftMm: 1400, widthMm: 600 }],
    finishes: { door: { name: '아크 플렛화이트', nameEn: 'Arc Flat White', colorHex: '#f4f4f0', tone: 'matte' }, top: { nameEn: 'Calacatta engineered stone', tone: 'gloss' } },
  },
};

test('모델 선택 — 아는 것만, 모르면 기본', () => {
  assert.equal(controlNetModel({}), DEFAULT_CONTROLNET_MODEL);
  assert.equal(controlNetModel({ CONTROLNET_MODEL: 'nope' }), DEFAULT_CONTROLNET_MODEL);
  assert.equal(controlNetModel({ CONTROLNET_MODEL: 'fal-ai/qwen-image-edit-2509' }), 'fal-ai/qwen-image-edit-2509');
  for (const m of Object.keys(CONTROLNET_MODELS)) assert.ok(CONTROLNET_MODELS[m].kind);
});

test('마감 한 줄 — 영문 이름·색·톤, 없으면 door_color/door_finish', () => {
  const s = controlNetFinishPhrase(CTX);
  assert.match(s, /Door and drawer fronts: Arc Flat White \(#f4f4f0\) matte\./);
  assert.match(s, /Countertop: Calacatta engineered stone high-gloss\./);
  assert.equal(controlNetFinishPhrase({ doorColor: 'oak', doorFinish: 'gloss' }), 'Door and drawer fronts: oak gloss.');
});

test('프롬프트 — 구조를 그대로 따르라, 도면 요약, 매립 손잡이, 방 보존, FIX', () => {
  const p = buildControlNetPrompt(CTX);
  assert.match(p, /built-in 싱크대 \(sink\)/);
  assert.match(p, /exactly as the structure image shows/);
  assert.match(p, /do not move, resize, add or remove any module/);
  assert.match(p, /Left to right: /);
  assert.match(p, /handleless fronts, all doors and drawers closed/);
  assert.match(p, /Keep the room/);
  assert.doesNotMatch(p, /Previous attempt/);
  assert.match(buildControlNetPrompt(CTX, { fix: ['handles', 'flat_mockup'] }), /Previous attempt failed: handles, flat_mockup/);
});

test('요청 JSON — flux control-lora i2i 필드명과 기본값', () => {
  const env = { CONTROLNET_STRENGTH: '0.7' };
  const input = buildControlNetInput(env, { prompt: 'P', baseUrl: 'https://x/room.jpg', controlUrl: 'https://x/control.png', size: { width: 1600, height: 1200 }, seed: 7 });
  assert.deepEqual(Object.keys(input).sort(), ['control_lora_image_url', 'control_lora_strength', 'enable_safety_checker', 'guidance_scale', 'image_size', 'image_url', 'num_images', 'num_inference_steps', 'output_format', 'prompt', 'seed', 'strength'].sort());
  assert.equal(input.image_url, 'https://x/room.jpg');
  assert.equal(input.control_lora_image_url, 'https://x/control.png');
  assert.equal(input.strength, 0.7);
  assert.equal(input.control_lora_strength, 1);
  assert.deepEqual(input.image_size, { width: 1600, height: 1200 });
  assert.equal(input.num_images, 1);
  assert.equal(input.output_format, 'jpeg');
  assert.equal(input.seed, 7);
  // 크기가 없으면 image_size 를 아예 안 보낸다 (모델 기본을 따른다)
  assert.equal('image_size' in buildControlNetInput({}, { prompt: 'P', baseUrl: 'a', controlUrl: 'b' }), false);
});

test('요청 JSON — qwen-edit 는 image_urls 에 [바탕, 조건] 이고 프롬프트가 그림 번호를 말한다', () => {
  const input = buildControlNetInput({}, { model: 'fal-ai/qwen-image-edit-2509', prompt: 'P', baseUrl: 'a', controlUrl: 'b', size: { width: 800, height: 600 } });
  assert.deepEqual(input.image_urls, ['a', 'b']);
  assert.match(input.prompt, /^Picture 1 is the room/);
  assert.match(input.prompt, /Picture 2 is the structure map/);
  assert.equal('image_url' in input, false);
  assert.equal(input.num_images, 1);
});

test('모르는 모델은 던진다', () => {
  assert.throws(() => buildControlNetInput({}, { model: 'x/y', prompt: 'P', baseUrl: 'a', controlUrl: 'b' }), /unknown controlnet model/);
});

/** fal 큐를 흉내내는 fetch — 제출 · 상태 2회(대기·진행) · 완료 · 결과 · 이미지 */
function fakeFal({ statuses = ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'], images = [{ url: 'https://v3.fal.media/files/x.jpg', content_type: 'image/jpeg' }], fail = null } = {}) {
  const calls = [];
  let i = 0;
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    if (url === `${FAL_QUEUE_BASE}/${DEFAULT_CONTROLNET_MODEL}` && init.method === 'POST') {
      return new Response(JSON.stringify({ request_id: 'req-1', status_url: 'https://q/status', response_url: 'https://q/result' }), { status: 200 });
    }
    if (url === 'https://q/status') {
      const s = statuses[Math.min(i++, statuses.length - 1)];
      return new Response(JSON.stringify(fail && s === 'COMPLETED' ? fail : { status: s }), { status: 200 });
    }
    if (url === 'https://q/result') return new Response(JSON.stringify({ images, seed: 42 }), { status: 200 });
    if (url === 'https://v3.fal.media/files/x.jpg') return new Response(new Uint8Array([255, 216, 255, 217]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    return new Response('nope', { status: 404 });
  };
  return { f, calls };
}

test('큐: 제출 → 폴링 → 결과 → 내려받기, Key 헤더, base64', async () => {
  const { f, calls } = fakeFal();
  const r = await runFal({ FAL_KEY: 'k' }, DEFAULT_CONTROLNET_MODEL, { prompt: 'P' }, { fetch: f, sleep: async () => {}, pollMs: 0 });
  assert.equal(r.base64, btoa(String.fromCharCode(255, 216, 255, 217)));
  assert.equal(r.mimeType, 'image/jpeg');
  assert.equal(r.requestId, 'req-1');
  assert.equal(r.seed, 42);
  assert.equal(calls[0].headers.Authorization, 'Key k');
  assert.equal(calls[0].body.prompt, 'P');
  assert.equal(calls.filter((c) => c.url === 'https://q/status').length, 3);
  assert.equal(calls[calls.length - 1].url, 'https://v3.fal.media/files/x.jpg');
});

test('FAL_KEY 가 없으면 부르기 전에 던진다', async () => {
  await assert.rejects(() => runFal({}, DEFAULT_CONTROLNET_MODEL, {}, { fetch: async () => { throw new Error('must not fetch'); } }), /FAL_KEY not configured/);
});

test('상태에 error 가 오면 던진다 · 이미지가 없으면 던진다 · 시간을 넘기면 던진다', async () => {
  const bad = fakeFal({ fail: { status: 'COMPLETED', error: 'boom', error_type: 'internal_server_error' } });
  await assert.rejects(() => runFal({ FAL_KEY: 'k' }, DEFAULT_CONTROLNET_MODEL, {}, { fetch: bad.f, sleep: async () => {}, pollMs: 0 }), /fal failed: internal_server_error boom/);
  const none = fakeFal({ images: [] });
  await assert.rejects(() => runFal({ FAL_KEY: 'k' }, DEFAULT_CONTROLNET_MODEL, {}, { fetch: none.f, sleep: async () => {}, pollMs: 0 }), /no image/);
  const slow = fakeFal({ statuses: ['IN_QUEUE'] });
  let t = 0;
  const realNow = Date.now;
  Date.now = () => (t += 100_000);
  try {
    await assert.rejects(() => runFal({ FAL_KEY: 'k' }, DEFAULT_CONTROLNET_MODEL, {}, { fetch: slow.f, sleep: async () => {}, pollMs: 0, timeoutMs: 150_000 }), /fal timeout/);
  } finally { Date.now = realNow; }
});

test('runControlNet — ctx 로 프롬프트를 만들고 URL 두 개를 넘기며 meta 를 돌려준다', async () => {
  const { f, calls } = fakeFal();
  const r = await runControlNet({ FAL_KEY: 'k' }, { ctx: CTX, baseUrl: 'https://s/room.jpg', controlUrl: 'https://s/control.png', size: { width: 1600, height: 1200 }, fix: ['handles'] }, { fetch: f, sleep: async () => {}, pollMs: 0 });
  assert.equal(r.mimeType, 'image/jpeg');
  assert.equal(r.meta.model, DEFAULT_CONTROLNET_MODEL);
  assert.equal(r.meta.requestId, 'req-1');
  assert.match(r.meta.prompt, /Previous attempt failed: handles/);
  assert.equal(calls[0].body.image_url, 'https://s/room.jpg');
  assert.equal(calls[0].body.control_lora_image_url, 'https://s/control.png');
  assert.deepEqual(calls[0].body.image_size, { width: 1600, height: 1200 });
});
