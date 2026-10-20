/**
 * 2026-10-20: 고른 냉장고 모델의 제품 사진을 설치 호출 참고 이미지로 (사장님 결정 "모델 사진 = (b)").
 *
 * 고정하는 것:
 *   1) 프롬프트 — fridgePhoto 가 있으면 맨 뒤 글자로 "IMAGE {n} — PRODUCT PHOTO of the chosen refrigerator (model …):
 *      match its look; size it to the opening." · 이미지 수 한 장 더. 없으면 예전 바이트 그대로
 *   2) plannerChosenFridgeModel — 냉장고장 자리에 모델 문장이 쓰일 때만 그 모델
 *   3) 잡 — 모델 코드(+브랜드)로 appliance_models.image_path 를 찾아 버킷 appliance-images 에서 읽어 맨 뒤에 붙인다
 *      (Gemini · GPT 둘 다). 사진 없음 · 칸 없음(SQL 미실행) · 읽기 실패면 글만으로 그린다. 모델이 없으면 찾지도 않는다
 *   4) 검사(QC)에는 붙이지 않는다
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GenerateJob } from '../src/job.js';
import { buildPlannerPrompt, normalizeDesignSpec, plannerChosenFridgeModel } from '../src/prompts.js';

const ROW_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '33333333-3333-4333-8333-333333333333';

/** planner-fridge-opening.test.js 의 사이트 도면 — 키큰장 600 + 냉장고장 680 (냉장고 자리 1885 + 위 2도어 415) */
function siteRaw(fridgeApp = {}) {
  return {
    category: 'fridge',
    wallRunMm: 3120,
    sections: {
      lower: {
        widthMm: 1800, heightMm: 870, depthMm: 650, fromLeftMm: 0,
        modules: [
          { widthMm: 900, kind: 'drawer', doorCount: 0, drawerCount: 3, label: '서랍 3단' },
          { widthMm: 900, kind: 'door', doorCount: 2, drawerCount: 0, label: '양문' },
        ],
      },
      tall: {
        widthMm: 1300, heightMm: 2300, depthMm: 700, fromLeftMm: 1800,
        modules: [
          {
            widthMm: 600, kind: 'door', doorCount: 3, drawerCount: 0, label: '키큰장 3단',
            tiers: [
              { heightMm: 861, kind: 'door', doorCount: 1, drawerCount: 0, label: '하부장' },
              { heightMm: 979, kind: 'door', doorCount: 1, drawerCount: 0, label: '중간장' },
              { heightMm: 460, kind: 'door', doorCount: 1, drawerCount: 0, label: '상부장' },
            ],
          },
          {
            widthMm: 680, kind: 'appliance', doorCount: 2, drawerCount: 0, label: '냉장고장',
            tiers: [
              { heightMm: 1885, kind: 'appliance', doorCount: 0, drawerCount: 0, label: '냉장고' },
              { heightMm: 415, kind: 'door', doorCount: 2, drawerCount: 0, label: '상부장' },
            ],
          },
        ],
      },
    },
    appliances: [
      { kind: 'sink', fromLeftMm: 900, widthMm: 700 },
      { kind: 'fridge', fromLeftMm: 2420, widthMm: 680, ...fridgeApp },
    ],
  };
}

const MODEL = {
  brand: '삼성', name: 'BESPOKE 1도어 키친핏 409L', code: 'RR40C7805AP',
  widthMm: 595, heightMm: 1853, depthMm: 700, subtype: 'one_door',
};
const SPEC_MODEL = normalizeDesignSpec(siteRaw({ model: MODEL }), 'fridge');
const SPEC_PLAIN = normalizeDesignSpec(siteRaw(), 'fridge');

const PHOTO_LINE = 'IMAGE D — PRODUCT PHOTO of the chosen refrigerator (model RR40C7805AP): match its look; size it to the opening.';

// ─── 1) 프롬프트 ───

const ctx = (spec, extra = {}) => ({
  category: 'fridge', wallW: 3600, wallH: 2300, confidence: 'medium', designSpec: spec, aspect: '16:9', ...extra,
});

test('프롬프트 — 사진이 있으면 맨 뒤 글자 한 줄 + 이미지 수 하나 더 (3/4 있으면 D, 없으면 C)', () => {
  const p = buildPlannerPrompt(ctx(SPEC_MODEL, { massing: true, fridgePhoto: { code: 'RR40C7805AP' } }));
  assert.match(p, /^You receive four images\./);
  assert.ok(p.includes(`are design references. Do not paste them into the photo and do not copy their plain white background or flat look. Build the real cabinets they show, in the room of IMAGE A.\n${PHOTO_LINE}\n`), p.slice(0, 1500));
  const p2 = buildPlannerPrompt(ctx(SPEC_MODEL, { fridgePhoto: { code: 'RR40C7805AP' } }));
  assert.match(p2, /^You receive three images\./);
  assert.ok(p2.includes('IMAGE C — PRODUCT PHOTO of the chosen refrigerator (model RR40C7805AP): match its look; size it to the opening.'));
});

test('프롬프트 — 꺾인 벽 입면 뒤에 붙는다 (B · C · D · E → F 가 사진)', () => {
  const raw = siteRaw({ model: MODEL });
  raw.layout = { shape: 'corner', walls: 2 };
  raw.walls = [
    { side: 'left', corner: 'main', sections: { lower: { fromCornerMm: 0, widthMm: 900, heightMm: 870, modules: [{ widthMm: 900, kind: 'door', doorCount: 2 }] } } },
    { side: 'right', corner: 'main', sections: { lower: { fromCornerMm: 0, widthMm: 900, heightMm: 870, modules: [{ widthMm: 900, kind: 'door', doorCount: 2 }] } } },
  ];
  raw.layout = { shape: 'u', walls: 3 };
  const spec = normalizeDesignSpec(raw, 'fridge');
  const p = buildPlannerPrompt(ctx(spec, {
    massing: true,
    returnElevations: [{ side: 'left', labeled: false }, { side: 'right', labeled: false }],
    fridgePhoto: { code: 'RR40C7805AP' },
  }));
  assert.match(p, /^You receive six images\./);
  assert.ok(p.includes('IMAGE F — PRODUCT PHOTO of the chosen refrigerator (model RR40C7805AP)'));
});

test('프롬프트 — 사진이 없으면 예전 바이트 그대로', () => {
  const a = buildPlannerPrompt(ctx(SPEC_MODEL, { massing: true }));
  const b = buildPlannerPrompt(ctx(SPEC_MODEL, { massing: true, fridgePhoto: null }));
  assert.equal(a, b);
  assert.ok(!a.includes('PRODUCT PHOTO'));
});

// ─── 2) 고른 모델 ───

test('plannerChosenFridgeModel — 냉장고장 자리에 모델이 걸렸을 때만', () => {
  assert.deepEqual(plannerChosenFridgeModel(SPEC_MODEL, 'fridge'), SPEC_MODEL.appliances.find((a) => a.kind === 'fridge').model);
  assert.equal(plannerChosenFridgeModel(SPEC_PLAIN, 'fridge'), null);
  assert.equal(plannerChosenFridgeModel(null, 'fridge'), null);
  // 냉장고가 자리 밖(어느 통에도 안 걸림)이면 모델 문장이 없다 → null
  const off = normalizeDesignSpec({ ...siteRaw({ model: MODEL }), appliances: [{ kind: 'fridge', fromLeftMm: 0, widthMm: 100, model: MODEL }] }, 'fridge');
  assert.equal(plannerChosenFridgeModel(off, 'fridge'), null);
});

// ─── 3) 잡 ───

const ENV = {
  GEMINI_API_KEY: 'test-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
};
const BYTES = { room: 'ROOM', 'render-elevation': 'ELEV', 'render-massing': 'MASS', photo: 'FRIDGE' };
const b64 = (s) => Buffer.from(s).toString('base64');
const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let calls;
let realFetch;
let options;

/**
 * photo: 'ok' | 'none' | 'no-columns' | 'read-fail'
 */
function install({ photo = 'ok' } = {}) {
  calls = { image: [], text: [], textImages: [], openai: [], models: [], photoReads: [], patched: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    if (u.startsWith('https://api.openai.com/')) {
      const f = init.body;
      calls.openai.push({
        prompt: f.get('prompt'),
        images: await Promise.all(f.getAll('image[]').map(async (b) => Buffer.from(await b.arrayBuffer()).toString())),
        types: f.getAll('image[]').map((b) => b.type),
      });
      return jsonRes({ data: [{ b64_json: b64('GPT') }], usage: { input_tokens: 1, output_tokens: 1 } });
    }
    if (u.includes('/rest/v1/appliance_models')) {
      calls.models.push(decodeURIComponent(u));
      if (photo === 'no-columns') return new Response('{"message":"column appliance_models.image_path does not exist"}', { status: 400 });
      return jsonRes(photo === 'none' ? [] : [{ id: MODEL_ID, image_path: `${MODEL_ID}/photo.png` }]);
    }
    if (u.includes('/storage/v1/object/appliance-images/')) {
      calls.photoReads.push(u);
      if (photo === 'read-fail') return new Response('boom', { status: 500 });
      return new Response(Buffer.from(BYTES.photo), { headers: { 'Content-Type': 'image/png' } });
    }
    if (u.includes('/storage/v1/object/')) {
      if (method === 'POST') return jsonRes({ Key: 'ok' });
      const name = u.split('/').pop().split('.')[0];
      const mime = u.endsWith('.png') ? 'image/png' : 'image/jpeg';
      return new Response(Buffer.from(BYTES[name] || 'X'), { headers: { 'Content-Type': mime } });
    }
    if (u.includes('/rest/v1/generations')) {
      if (method === 'GET') return jsonRes([{ id: ROW_ID, options }]);
      calls.patched.push(JSON.parse(init.body));
      return jsonRes([{ id: ROW_ID }]);
    }
    if (u.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(init.body);
      const parts = body.contents[0].parts;
      const prompt = parts[parts.length - 1].text;
      const imgs = parts.filter((p) => p.inlineData).map((p) => Buffer.from(p.inlineData.data, 'base64').toString());
      if (body.generationConfig.responseModalities.length === 1) {
        calls.text.push(prompt);
        calls.textImages.push(imgs);
        const text = prompt.startsWith('Measure and describe')
          ? JSON.stringify({ wall_width_mm: 3600, wall_height_mm: 2300, confidence: 'medium', existing_furniture: 'none', site_condition: 'finished' })
          : JSON.stringify({ ok: true, issues: [], note: 'n' });
        return jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
      }
      calls.image.push({ prompt, images: imgs, mimes: parts.filter((p) => p.inlineData).map((p) => p.inlineData.mimeType) });
      return jsonRes({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64('OUT') } }] } }] });
    }
    throw new Error(`unexpected fetch ${method} ${u}`);
  };
}

function fakeState() {
  const m = new Map();
  return {
    storage: {
      get: async (k) => m.get(k),
      put: async (k, v) => void m.set(k, structuredClone(v)),
      setAlarm: async () => {},
      deleteAll: async () => m.clear(),
      deleteAlarm: async () => {},
    },
  };
}

const INPUTS = {
  room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' },
  refs: [],
  renders: [
    { role: 'elevation', path: `${USER_ID}/${ROW_ID}/render-elevation.png`, url: 'u', mime: 'image/png' },
    { role: 'massing', path: `${USER_ID}/${ROW_ID}/render-massing.jpg`, url: 'u', mime: 'image/jpeg' },
  ],
};

async function run(opts, envExtra = {}) {
  options = opts;
  const job = new GenerateJob(fakeState(), { ...ENV, ...envExtra });
  await job.fetch(
    new Request('https://generate-job/start', {
      method: 'POST',
      body: JSON.stringify({ id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'fridge', options: opts, inputs: INPUTS, startedAt: Date.now() }),
    })
  );
  await job.alarm();
  return calls.patched[calls.patched.length - 1];
}

const OPTS = (spec) => ({ design_spec: spec, mode: 'planner', aspect: '16:9', variants: false });

beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('잡(Gemini) — 사진이 있으면 [방, 입면, 3/4, 냉장고 사진] + IMAGE D 줄, 검사에는 안 붙인다', async () => {
  install({ photo: 'ok' });
  const last = await run(OPTS(SPEC_MODEL));
  assert.equal(last.status, 'done');
  const call = calls.image[0];
  assert.deepEqual(call.images, ['ROOM', 'ELEV', 'MASS', 'FRIDGE']);
  assert.equal(call.mimes[3], 'image/png');
  assert.match(call.prompt, /^You receive four images\./);
  assert.ok(call.prompt.includes(PHOTO_LINE));
  // 모델 코드 + 브랜드로, 가져온 사진이 있는 행만 찾는다
  assert.equal(calls.models.length, 1);
  const q = calls.models[0];
  assert.ok(q.includes('or=(model_code.eq."RR40C7805AP",model_codes.cs.{"RR40C7805AP"})'), q);
  assert.ok(q.includes('image_path=not.is.null'), q);
  assert.ok(q.includes('brand=eq.삼성'), q);
  assert.deepEqual(calls.photoReads, [`https://example.supabase.co/storage/v1/object/appliance-images/${MODEL_ID}/photo.png`]);
  // 검사(QC)·분석은 냉장고 사진을 받지 않는다
  for (const imgs of calls.textImages) assert.ok(!imgs.includes('FRIDGE'));
});

test('잡(GPT) — 편집 호출 image[] 맨 뒤에도 냉장고 사진', async () => {
  install({ photo: 'ok' });
  await run({ ...OPTS(SPEC_MODEL), image_provider: 'openai' }, { OPENAI_API_KEY: 'sk-test' });
  assert.equal(calls.openai.length, 1);
  const o = calls.openai[0];
  assert.deepEqual(o.images, ['ROOM', 'ELEV', 'MASS', 'FRIDGE']);
  assert.equal(o.types[3], 'image/png');
  assert.ok(o.prompt.includes(PHOTO_LINE));
});

for (const [photo, why] of [['none', '가져온 사진이 없으면'], ['no-columns', '사진 칸이 없으면(SQL 미실행)'], ['read-fail', '사진을 못 읽으면']]) {
  test(`잡 — ${why} 글만으로 그린다 (세 장, PRODUCT PHOTO 없음)`, async () => {
    install({ photo });
    const last = await run(OPTS(SPEC_MODEL));
    assert.equal(last.status, 'done');
    const call = calls.image[0];
    assert.deepEqual(call.images, ['ROOM', 'ELEV', 'MASS']);
    assert.match(call.prompt, /^You receive three images\./);
    assert.ok(!call.prompt.includes('PRODUCT PHOTO'));
    // 모델 문장(고른 모델 우선)은 그대로
    assert.ok(call.prompt.includes('draw this refrigerator: Samsung BESPOKE 409L, model RR40C7805AP'));
  });
}

test('잡 — 모델을 안 골랐으면 찾지도 않는다', async () => {
  install({ photo: 'ok' });
  await run(OPTS(SPEC_PLAIN));
  assert.equal(calls.models.length, 0);
  assert.equal(calls.photoReads.length, 0);
  assert.deepEqual(calls.image[0].images, ['ROOM', 'ELEV', 'MASS']);
});
