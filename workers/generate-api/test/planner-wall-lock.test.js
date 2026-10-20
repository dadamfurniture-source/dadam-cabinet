/**
 * 2026-10-20: 같은 방 사진이면 벽 하나 · 뒷벽 모서리 고정 · ㄱ자 % 한 값 (플래너 모드).
 *
 * 실측 (mm 측정 세션, PR #898 뒤 GPT 6장, 같은 방 사진 md5 같음):
 *   - 같은 사진인데 분석 벽 폭(wallW)이 3900~4400 으로 흔들려 프롬프트의 줄 길이 % 가 50 → 56 % 로 바뀌었다.
 *   - ㄱ자 2장이 뒷벽 오른 모서리를 92.5·93.0 % 에(원본 89.7 %), 일자 1장이 97.2 % 에(원본 85.7 %) 그렸다 — 벽을 넓혀 남는 벽을 만든다.
 *   - ㄱ자 프롬프트에 53 %(줄 머리, 모듈 2349 기준)와 55 %(BINDING, 런 2400 기준)가 같이 들어갔다.
 *
 * 고정하는 것:
 *   1) 잡 — 방 사진 바이트 SHA-256 를 wall_analysis.roomPhoto 에 남기고, 같은 사용자의 같은 해시 행이 있으면 그 분석을 다시 쓴다
 *      (분석 호출 없음). 사람이 넣은 벽 폭은 그래도 이긴다. 플래너가 아니면 찾지도 남기지도 않는다.
 *   2) 접수 — 플래너 재생성은 원본의 wall_width_override 를 잇는다 (일반 경로와 같게)
 *   3) 프롬프트 — KEEP 에 뒷벽(주벽) 양 끝 모서리 문장, FINAL SELF-CHECK 에 모서리 항목. 일자·ㄱ자 공통
 *   4) 프롬프트 — 줄 길이 고정 문장이 있으면 벽 % 는 런(마감재 포함, wallRunMm) 기준 한 값뿐 — 줄 머리에는 % 를 붙이지 않는다
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GenerateJob } from '../src/job.js';
import worker from '../src/worker.js';
import { buildPlannerPrompt, normalizeDesignSpec } from '../src/prompts.js';

const ROW_ID = '22222222-2222-4222-8222-222222222222';
const OLD_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROOM_SHA = createHash('sha256').update(Buffer.from('ROOM')).digest('hex');

const ENV = {
  GEMINI_API_KEY: 'test-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
};
const b64 = (s) => Buffer.from(s).toString('base64');
const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let calls;
let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const SPEC = {
  version: 1,
  category: 'sink',
  wallRunMm: 2200,
  sections: {
    lower: {
      widthMm: 2200, heightMm: 870, fromLeftMm: 0,
      modules: [
        { widthMm: 800, kind: 'door', doorCount: 2 },
        { widthMm: 400, kind: 'door', doorCount: 1 },
        { widthMm: 1000, kind: 'door', doorCount: 2 },
      ],
    },
  },
};
const PLANNER_OPTIONS = { design_spec: SPEC, mode: 'planner', aspect: '16:9', variants: false, image_provider: 'gemini' };
const INPUTS = {
  room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' },
  refs: [],
  renders: [{ role: 'elevation', path: `${USER_ID}/${ROW_ID}/render-elevation.png`, url: 'u', mime: 'image/png' }],
};

/** 앞서 같은 사진으로 분석한 행 (wallW 4100) */
const OLD_ANALYSIS = {
  wallW: 4100, wallH: 2400, waterPct: 48, exhaustPct: 70, confidence: 'medium', brief: 'old brief',
  existing: 'old white cabinets', site: 'finished', siteNotes: null, tile: null, cameraSide: null, sideReturn: null,
  read: { width: true, height: true, water: false, exhaust: false },
};
const oldRow = () => ({
  id: OLD_ID,
  wall_analysis: { ...OLD_ANALYSIS, roomPhoto: { sha256: ROOM_SHA, analysis: OLD_ANALYSIS, from: OLD_ID } },
});

/** prior: 해시 조회에 돌려줄 행 (없으면 빈 목록) */
function installJob({ prior = null } = {}) {
  calls = { image: [], text: [], patched: [], lookups: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('/storage/v1/object/')) {
      if ((init.method || 'GET') === 'POST') return jsonRes({ Key: 'ok' });
      const name = u.split('/').pop().split('.')[0];
      const bytes = { room: 'ROOM', 'render-elevation': 'ELEV' }[name] || 'X';
      return new Response(Buffer.from(bytes), { headers: { 'Content-Type': u.endsWith('.png') ? 'image/png' : 'image/jpeg' } });
    }
    if (u.includes('/rest/v1/generations')) {
      if ((init.method || 'GET') === 'GET') {
        if (u.includes('sha256')) {
          calls.lookups.push(u);
          return jsonRes(prior ? [prior] : []);
        }
        return jsonRes([{ id: ROW_ID, options: PLANNER_OPTIONS }]);
      }
      calls.patched.push(JSON.parse(init.body));
      return jsonRes([{ id: ROW_ID }]);
    }
    if (u.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(init.body);
      const parts = body.contents[0].parts;
      const prompt = parts[parts.length - 1].text;
      if (body.generationConfig.responseModalities.length === 1) {
        calls.text.push(prompt);
        const text = prompt.startsWith('Measure and describe')
          ? JSON.stringify({ wall_width_mm: 3600, wall_height_mm: 2400, confidence: 'medium', existing_furniture: 'dark glossy kitchen cabinets', site_condition: 'finished' })
          : JSON.stringify({ ok: true, issues: [], note: 'n' });
        return jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
      }
      calls.image.push({ prompt });
      return jsonRes({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64('OUT') } }] } }] });
    }
    throw new Error(`unexpected fetch ${u}`);
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

async function runJob(options, inputs = INPUTS) {
  const job = new GenerateJob(fakeState(), ENV);
  await job.fetch(
    new Request('https://generate-job/start', {
      method: 'POST',
      body: JSON.stringify({ id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'sink', options, inputs, startedAt: Date.now() }),
    })
  );
  await job.alarm();
}
const savedWall = () => calls.patched.find((p) => p.wall_analysis && !p.wall_analysis.guide && !p.wall_analysis.place)?.wall_analysis;
const analysed = () => calls.text.filter((t) => t.startsWith('Measure and describe')).length;

// ─── 1. 잡: 같은 사진이면 벽 하나 ───

// 2026-10-20 phash: 플래너는 새 사진을 3회 분석해 중앙값 (모의 응답은 셋 다 3600). 여기 방 바이트('ROOM')는 JPEG 가 아니라
//   지각 해시가 null → sha256 조회만 한다. 지각 해시·중앙값은 planner-wall-phash.test.js.
test('처음 보는 사진: 분석하고 방 사진 해시·분석 원본을 wall_analysis.roomPhoto 에 남긴다 (조회는 사용자 범위)', async () => {
  installJob();
  await runJob(PLANNER_OPTIONS);
  assert.equal(analysed(), 3);
  assert.equal(calls.lookups.length, 1);
  assert.ok(calls.lookups[0].includes(`user_id=eq.${USER_ID}`), calls.lookups[0]);
  assert.ok(calls.lookups[0].includes(`wall_analysis->roomPhoto->>sha256=eq.${ROOM_SHA}`), calls.lookups[0]);
  assert.ok(calls.lookups[0].includes(`id=neq.${ROW_ID}`));
  assert.ok(calls.lookups[0].includes('order=created_at.asc'));
  const w = savedWall();
  assert.equal(w.wallW, 3600);
  assert.equal(w.roomPhoto.sha256, ROOM_SHA);
  assert.equal(w.roomPhoto.from, ROW_ID);
  assert.equal(w.roomPhoto.phash, null);
  assert.equal(w.roomPhoto.rounds, 3);
  assert.equal(w.roomPhoto.analysis.wallW, 3600);
  assert.equal('roomPhoto' in w.roomPhoto.analysis, false);
  assert.ok(calls.image[0].prompt.includes('about 3600 mm in IMAGE A'));
});

test('같은 사진 두 번째: 첫 분석의 벽(4100)을 그대로 — 분석 호출 없음', async () => {
  installJob({ prior: oldRow() });
  await runJob(PLANNER_OPTIONS);
  assert.equal(analysed(), 0, '분석을 다시 부르지 않는다');
  const w = savedWall();
  assert.equal(w.wallW, 4100);
  assert.equal(w.confidence, 'medium');
  assert.equal(w.existing, 'old white cabinets');
  assert.deepEqual(w.roomPhoto, { sha256: ROOM_SHA, phash: null, analysis: OLD_ANALYSIS, from: OLD_ID, pooled: 1 });
  assert.ok(calls.image[0].prompt.includes('about 4100 mm in IMAGE A'));
  assert.doesNotMatch(calls.image[0].prompt, /3600 mm in IMAGE A/);
});

test('사람이 넣은 벽 폭이 이긴다 — 재사용 분석 위에 덮고, 남기는 분석 원본은 그대로', async () => {
  installJob({ prior: oldRow() });
  await runJob({ ...PLANNER_OPTIONS, wall_width_override: 3900 });
  const w = savedWall();
  assert.equal(w.wallW, 3900);
  assert.equal(w.confidence, 'user');
  assert.equal(w.roomPhoto.analysis.wallW, 4100);
  assert.equal(w.roomPhoto.analysis.confidence, 'medium');
  assert.ok(calls.image[0].prompt.includes('about 3900 mm in IMAGE A'));
});

test('해시 행의 분석이 망가졌으면 다시 분석한다', async () => {
  installJob({ prior: { id: OLD_ID, wall_analysis: { roomPhoto: { sha256: ROOM_SHA, analysis: { wallW: 'x' } } } } });
  await runJob(PLANNER_OPTIONS);
  assert.equal(analysed(), 3);
  assert.equal(savedWall().wallW, 3600);
  assert.equal(savedWall().roomPhoto.from, ROW_ID);
});

test('플래너가 아니면 해시를 찾지도 남기지도 않는다', async () => {
  installJob({ prior: oldRow() });
  await runJob({ variants: false });
  assert.equal(calls.lookups.length, 0);
  assert.equal(analysed(), 1);
  assert.equal('roomPhoto' in savedWall(), false);
});

// ─── 2. 접수: 플래너 재생성은 원본 벽 폭을 잇는다 ───

test('플래너 재생성은 원본의 wall_width_override 를 잇고, 새로 보낸 값이 이긴다', async () => {
  const parent = {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: USER_ID,
    category: 'sink',
    inputs: {
      room: { path: 'p/room.jpg', url: 'u', mime: 'image/jpeg' },
      refs: [],
      renders: [{ role: 'elevation', path: 'p/render-elevation.png', url: 'u2', mime: 'image/png' }],
    },
    options: { design_spec: { version: 1, category: 'sink', wallRunMm: 2200 }, mode: 'planner', aspect: '4:3', variants: false, wall_width_override: 3950 },
  };
  const post = async (body) => {
    let inserted = null;
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) return jsonRes({ id: USER_ID, email: 'a@b.c' });
      // 2026-10-20 등급 관문 (src/tier-gate.js) — 플래너 재생성도 지나므로 expert 로 둔다
      if (u.includes('/rest/v1/profiles')) return jsonRes([{ tier: 'expert' }]);
      if (u.includes('/rest/v1/rpc/')) return jsonRes([{ ref: 'r', balance: 80, cost: 20 }]);
      if (u.includes('/rest/v1/generations')) {
        const m = init.method || 'GET';
        if (m === 'GET') return jsonRes(u.includes(`id=eq.${parent.id}`) ? [parent] : []);
        if (m === 'POST') {
          inserted = JSON.parse(init.body);
          return jsonRes([{ id: ROW_ID, ...inserted }]);
        }
        return jsonRes([{ id: ROW_ID }]);
      }
      throw new Error(`unexpected fetch ${u}`);
    };
    const env = {
      ...ENV,
      GENERATE_JOB: { idFromName: (n) => ({ name: n }), get: () => ({ fetch: async () => new Response('{"ok":true}', { status: 202 }) }) },
    };
    const res = await worker.fetch(
      new Request('https://generate.example/api/generate', {
        method: 'POST',
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env
    );
    assert.equal(res.status, 202);
    return inserted.options;
  };
  assert.equal((await post({ parent_id: parent.id })).wall_width_override, 3950);
  assert.equal((await post({ parent_id: parent.id, wall_width_override: 4200 })).wall_width_override, 4200);
});

// ─── 3·4. 프롬프트 ───

const one = (w, label = '도어') => ({ widthMm: w, kind: 'door', doorCount: 1, drawerCount: 0, label });
const two = (w) => ({ widthMm: w, kind: 'door', doorCount: 2, drawerCount: 0, label: '양문' });
/** planner-walls.test.js 의 시드 evalc1 ㄱ자 (주벽 런 2400, 하부 모듈 2349 가 50 에서 시작) */
function cornerSpec() {
  return normalizeDesignSpec(
    {
      category: 'sink',
      wallRunMm: 2400,
      sections: {
        lower: { widthMm: 2349, heightMm: 870, depthMm: 550, fromLeftMm: 50, modules: [one(650, '멍장'), one(436), two(842), one(421)], fromFloorMm: 0 },
        upper: { widthMm: 2400, heightMm: 780, depthMm: 290, fromLeftMm: 0, modules: [two(960), two(960), one(480)], fromFloorMm: 1520 },
      },
      appliances: [{ kind: 'sink', fromLeftMm: 1300, widthMm: 700 }],
      finishes: {},
      layout: { shape: 'corner', walls: 2 },
      ceilingMm: 2300,
      walls: [
        {
          side: 'left', corner: 'main', runMm: 1574, cornerEdge: 'left',
          sections: { lower: { widthMm: 936, heightMm: 870, depthMm: 550, fromCornerMm: 638, fromFloorMm: 0, modules: [two(936)] } },
        },
      ],
    },
    'sink'
  );
}
const cornerPrompt = (wallW = 4400) =>
  buildPlannerPrompt({
    category: 'sink', designSpec: cornerSpec(), wallW, wallH: 2400, confidence: 'high', massing: true, labeledElevation: true,
    returnElevations: [{ side: 'left', labeled: true }],
  });
const straightPrompt = () =>
  buildPlannerPrompt({ category: 'sink', designSpec: normalizeDesignSpec(SPEC, 'sink'), wallW: 3600, wallH: 2400, confidence: 'medium' });

test('KEEP: 뒷벽 양 끝 모서리는 IMAGE A 자리 그대로 — ㄱ자는 back wall, 일자는 main wall', () => {
  const c = cornerPrompt();
  assert.ok(c.includes(
    "The back wall's left and right corners stay exactly where IMAGE A shows them — do not widen or move the wall to make room for the units or for bare wall."
  ));
  const s = straightPrompt();
  assert.ok(s.includes(
    "The main wall's left and right corners stay exactly where IMAGE A shows them — do not widen or move the wall to make room for the units or for bare wall."
  ));
  // KEEP 문단 안 (EDIT ZONE 문단의 끝)
  const keep = s.split('\n\n').find((x) => x.startsWith('EDIT ZONE:'));
  assert.match(keep, /\nKEEP everything outside the edit zone[\s\S]*The main wall's left and right corners stay exactly where IMAGE A shows them/);
});

test('FINAL SELF-CHECK: 뒷벽 양 끝 모서리가 IMAGE A 와 같은 자리', () => {
  assert.match(cornerPrompt(), /; both back-wall corners at the same place as in IMAGE A; no other built-in unit anywhere\.$/);
  assert.match(straightPrompt(), /; both main-wall corners at the same place as in IMAGE A; no other built-in unit anywhere\.$/);
});

test('ㄱ자 % 한 값: 벽 4400 에서 런 2400 = 55 % 뿐 — 줄 머리에 모듈 2349 기준 53 % 가 없다', () => {
  const p = cornerPrompt(4400);
  assert.ok(p.includes('  BASE ROW (2349 mm long, starts 50 mm from the left end of the run; bottom at 0 mm, top at 870 mm from the floor):'));
  assert.ok(p.includes('The back-wall run is 2400 mm long — about 55 % of the back wall (about 4400 mm in IMAGE A).'));
  assert.ok(p.includes('back wall base row ends at about 55 % of the wall (2400 mm)'));
  assert.doesNotMatch(p, /53 %/);
  const pcts = [...p.matchAll(/(\d+) % of the (?:back )?wall/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(pcts)], ['55']);
});

test('일자도 줄 길이 고정이면 % 는 런 기준 한 값 — 줄 머리에는 % 를 붙이지 않는다', () => {
  const p = straightPrompt();
  assert.ok(p.includes('  BASE ROW (870 mm high, 2200 mm long, starts at the left corner):'));
  const pcts = [...p.matchAll(/(\d+) % of the wall/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(pcts)], ['61']);
});
