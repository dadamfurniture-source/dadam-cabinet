/**
 * 2026-10-20: 벽 폭 고정(#941)을 사진 바이트가 아니라 **화면 기준**으로, 새 사진은 **여러 번 분석한 중앙값**으로 (플래너 모드).
 *
 * 실측: 같은 화면을 다시 저장한 JPEG 는 바이트가 달라 #941 의 sha256 이 이어받지 못했고, 한 번 분석한 값(4500)이 고정됐다.
 *   이전 13회 분석의 중앙값은 4350, 사진 실측은 4.3~4.5 m — 첫 값 하나가 분포의 끝일 수 있다.
 * 사장님 결정: 같은 그림(재저장·재압축)은 같은 사진으로 묶는다. 다른 기기의 다른 사진은 새로 분석(그대로).
 *
 * 고정하는 것:
 *   1) 지각 해시(dHash 9×8, 64비트 16진) — 리포의 실제 주방 사진으로 문턱(≤ 6)의 근거를 남긴다
 *   2) 조회 — 같은 사용자의 최근 50행에서 phash 거리 ≤ 6 또는 sha256 같은 행. 같은 그림 행이 여럿이면 wallW 중앙값, from = 고른 행, pooled = 수
 *   3) 새 사진은 분석 3회 → 숫자 칸 중앙값, 글은 벽 폭이 중앙값인 회차. 1회 실패해도 2회 중앙값, 전부 실패면 기본값
 *   4) 재사용이면 호출 0, 사람 값 우선, 플래너가 아니면 1회·찾지도 남기지도 않음 (예전 그대로)
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import encodeJpeg from 'jpeg-js/lib/encoder.js';
import decodeJpeg from 'jpeg-js/lib/decoder.js';
import { GenerateJob } from '../src/job.js';
import {
  ANALYSIS_ROUNDS, PHASH_MAX_DISTANCE, ROOM_PHOTO_LOOKUP_LIMIT,
  dhashRgba, hammingHex, medianAnalysis, roomPhotoPhash, roomPhotoSha256, samePhoto,
} from '../src/room-photo.js';

// ─── fixture: 리포의 실제 주방 사진 (app/portfolio, 1220×508) ───
const PORTFOLIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../app/portfolio');
const photo = (name) => readFileSync(path.join(PORTFOLIO, `${name}.jpg`));
const decode = (buf) => decodeJpeg(buf, { useTArray: true, formatAsRGBA: true });
const encode = (img, q) => Buffer.from(encodeJpeg(img, q).data);
/** 최근접 축소 — 다른 크기로 다시 저장한 화면 */
function resize(img, s) {
  const w = Math.round(img.width * s), h = Math.round(img.height * s);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (Math.min(img.height - 1, Math.floor(y / s)) * img.width + Math.min(img.width - 1, Math.floor(x / s))) * 4;
      const o = (y * w + x) * 4;
      data[o] = img.data[i]; data[o + 1] = img.data[i + 1]; data[o + 2] = img.data[i + 2]; data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}
const hashOf = (buf) => dhashRgba(decode(buf));

// ─── 1. 지각 해시 ───

test('같은 사진 재압축(품질 40~95·재저장 사슬·축소 0.5~0.8)은 거리 ≤ 4 — 문턱 6 안', () => {
  let worst = 0;
  for (const name of ['kitchen-n6-1', 'kitchen-n1-2', 'kitchen-n3-2', 'kitchen-n7-1', 'funiture-n4-1']) {
    const img = decode(photo(name));
    const h0 = dhashRgba(img);
    const variants = [40, 60, 75, 90, 95].map((q) => encode(img, q));
    let chain = img; // 90 → 75 → 60 으로 세 번 다시 저장
    for (const q of [90, 75, 60]) chain = decode(encode(chain, q));
    variants.push(encode(chain, 85));
    for (const s of [0.8, 0.6, 0.5]) variants.push(encode(resize(img, s), 85));
    for (const v of variants) {
      const d = hammingHex(h0, hashOf(v));
      worst = Math.max(worst, d);
      assert.ok(d <= PHASH_MAX_DISTANCE, `${name}: 같은 사진인데 거리 ${d}`);
    }
  }
  assert.ok(worst <= 4, `실측 최대 ${worst} (문턱 ${PHASH_MAX_DISTANCE} 의 근거)`);
});

test('다른 사진은 같은 주방의 다른 각도라도 거리 ≥ 20 — 문턱 6 과 멀다', () => {
  const names = ['kitchen-n1-1', 'kitchen-n1-2', 'kitchen-n1-3', 'kitchen-n1-4', 'kitchen-n2-1', 'kitchen-n3-2', 'kitchen-n3-3',
    'kitchen-n4-1', 'kitchen-n6-1', 'kitchen-n6-2', 'kitchen-n6-3', 'kitchen-n7-1'];
  const hashes = names.map((n) => hashOf(photo(n)));
  let closest = 64;
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) closest = Math.min(closest, hammingHex(hashes[i], hashes[j]));
  }
  assert.ok(closest >= 20, `다른 사진 최소 거리 ${closest}`);
});

test('dHash 모양: 16자리 16진, 해밍 거리, 모양이 다르면 Infinity', () => {
  const h = hashOf(photo('kitchen-n6-1'));
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(hammingHex(h, h), 0);
  assert.equal(hammingHex('00', 'ff'), 8);
  assert.equal(hammingHex('0f', '0e'), 1);
  assert.equal(hammingHex(h, null), Infinity);
  assert.equal(hammingHex(h, h.slice(1)), Infinity);
  assert.equal(hammingHex('zz', '00'), Infinity);
});

test('roomPhotoPhash: JPEG 만 — PNG·깨진 바이트·빈 값은 null (그러면 sha256 만으로)', () => {
  const jpg = photo('kitchen-n6-1');
  assert.equal(roomPhotoPhash({ base64: jpg.toString('base64'), mimeType: 'image/jpeg' }), hashOf(jpg));
  assert.equal(roomPhotoPhash({ base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64'), mimeType: 'image/png' }), null);
  assert.equal(roomPhotoPhash({ base64: Buffer.from([0xff, 0xd8, 0x00]).toString('base64') }), null);
  assert.equal(roomPhotoPhash({ base64: '' }), null);
  assert.equal(roomPhotoPhash(null), null);
});

test('samePhoto: sha256 같으면 늘, 아니면 phash 거리 ≤ 6', () => {
  assert.equal(samePhoto({ sha256: 'a', phash: '0000000000000000' }, { sha256: 'a', phash: 'ffffffffffffffff' }), true);
  assert.equal(samePhoto({ sha256: 'a', phash: '0000000000000000' }, { sha256: 'b', phash: '000000000000003f' }), true);  // 6
  assert.equal(samePhoto({ sha256: 'a', phash: '0000000000000000' }, { sha256: 'b', phash: '000000000000007f' }), false); // 7
  assert.equal(samePhoto({ sha256: 'a', phash: null }, { sha256: 'b', phash: '0000000000000000' }), false);
  assert.equal(samePhoto({ sha256: 'a', phash: '0000000000000000' }, { sha256: 'b' }), false);
});

// ─── 2. 분석 중앙값 (순수 함수) ───

const round = (wallW, extra = {}) => ({
  wallW, wallH: 2400, waterPct: 48, exhaustPct: 70, confidence: 'medium', brief: `brief ${wallW}`, existing: `old ${wallW}`,
  site: 'finished', siteNotes: null, tile: null, cameraSide: null, sideReturn: null,
  read: { width: true, height: true, water: false, exhaust: false },
  ...extra,
});

test('3회: 숫자 칸은 중앙값, 글은 벽 폭이 중앙값인 회차 — 읽은 회차의 값만 섞는다', () => {
  const m = medianAnalysis([
    round(4500, { wallH: 2300, waterPct: 40, read: { width: true, height: true, water: true, exhaust: false } }),
    round(4300, { wallH: 2500 }),
    round(4350, { wallH: 2400, waterPct: 44, exhaustPct: 60, read: { width: true, height: true, water: true, exhaust: true } }),
  ]);
  assert.equal(m.count, 3);
  assert.equal(m.chosen, 2);
  assert.equal(m.analysis.wallW, 4350);
  assert.equal(m.analysis.wallH, 2400);
  assert.equal(m.analysis.waterPct, 42, '급수는 읽은 두 회차(40·44)의 중앙값');
  assert.equal(m.analysis.exhaustPct, 60, '배기는 읽은 한 회차');
  assert.deepEqual(m.analysis.read, { width: true, height: true, water: true, exhaust: true });
  assert.equal(m.analysis.brief, 'brief 4350');
  assert.equal(m.analysis.existing, 'old 4350');
});

test('2회(짝수)는 가운데 둘의 평균, 1회는 그대로, 벽 폭을 못 읽은 회차는 벽 폭에 안 섞인다', () => {
  assert.equal(medianAnalysis([round(4500), round(4300)]).analysis.wallW, 4400);
  const one = medianAnalysis([round(4100)]);
  assert.deepEqual(one.analysis, round(4100));
  const m = medianAnalysis([round(3000, { read: { width: false, height: false, water: false, exhaust: false } }), round(4500), round(4300)]);
  assert.equal(m.analysis.wallW, 4400);
  assert.equal(m.analysis.brief, 'brief 4500', '중앙값 4400 에 가장 가까운 회차 — 4500·4300 이 같은 거리면 앞선 것');
  const none = medianAnalysis([round(3000, { read: { width: false, height: false, water: false, exhaust: false } })]);
  assert.equal(none.analysis.wallW, 3000);
  assert.equal(none.analysis.read.width, false);
});

test('쓸 회차가 없으면 null, 망가진 회차는 뺀다, read 없는 옛 모양은 다 읽은 것으로', () => {
  assert.equal(medianAnalysis([]), null);
  assert.equal(medianAnalysis([null, { wallW: 'x' }]), null);
  const m = medianAnalysis([{ wallW: 4100, wallH: 2400 }, { wallW: 'x' }, { wallW: 4500, wallH: 2400 }]);
  assert.equal(m.count, 2);
  assert.equal(m.analysis.wallW, 4300);
});

// ─── 3·4. 잡 ───

const ROW_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const A_ID = '44444444-4444-4444-8444-444444444441';
const B_ID = '44444444-4444-4444-8444-444444444442';
const C_ID = '44444444-4444-4444-8444-444444444443';
const D_ID = '44444444-4444-4444-8444-444444444444';
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

/** 이번 잡의 방 사진: 원본 사진을 품질 60 으로 다시 저장한 것 — 바이트(sha256)는 다르고 그림은 같다 */
const ORIGINAL = photo('kitchen-n6-1');
const ROOM_JPEG = encode(decode(ORIGINAL), 60);
const ROOM_SHA = createHash('sha256').update(ROOM_JPEG).digest('hex');
const ORIGINAL_PHASH = hashOf(ORIGINAL);
const OTHER_PHASH = hashOf(photo('kitchen-n3-2'));
assert.notEqual(createHash('sha256').update(ORIGINAL).digest('hex'), ROOM_SHA);
assert.ok(hammingHex(ORIGINAL_PHASH, hashOf(ROOM_JPEG)) <= PHASH_MAX_DISTANCE);

const SPEC = {
  version: 1, category: 'sink', wallRunMm: 2200,
  sections: { lower: { widthMm: 2200, heightMm: 870, fromLeftMm: 0, modules: [{ widthMm: 800, kind: 'door', doorCount: 2 }, { widthMm: 400, kind: 'door', doorCount: 1 }, { widthMm: 1000, kind: 'door', doorCount: 2 }] } },
};
const PLANNER_OPTIONS = { design_spec: SPEC, mode: 'planner', aspect: '16:9', variants: false, image_provider: 'gemini' };
const INPUTS = {
  room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' },
  refs: [],
  renders: [{ role: 'elevation', path: `${USER_ID}/${ROW_ID}/render-elevation.png`, url: 'u', mime: 'image/png' }],
};
/** 앞서 분석한 행 */
const priorRow = (id, wallW, { sha256 = `sha-${id}`, phash = ORIGINAL_PHASH, from = id, createdAt = '2026-10-19T00:00:00Z', analysis = null } = {}) => {
  const a = analysis || round(wallW);
  return { id, created_at: createdAt, wall_analysis: { ...a, roomPhoto: { sha256, phash, analysis: a, from } } };
};

let calls;
let realFetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

/**
 * @param {object} o
 * @param {object[]} [o.shaRows] sha256 조회에 돌려줄 행
 * @param {object[]} [o.phashRows] phash 조회에 돌려줄 행
 * @param {Array<number|'fail'|object>} [o.widths] 분석 호출마다 돌려줄 벽 폭 (또는 'fail' → 400, 또는 JSON 통째)
 */
function installJob({ shaRows = [], phashRows = [], widths = [4500, 4300, 4350] } = {}) {
  calls = { image: [], text: [], patched: [], lookups: [] };
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('/storage/v1/object/')) {
      if ((init.method || 'GET') === 'POST') return jsonRes({ Key: 'ok' });
      const name = u.split('/').pop().split('.')[0];
      if (name === 'room') return new Response(ROOM_JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
      return new Response(Buffer.from('ELEV'), { headers: { 'Content-Type': 'image/png' } });
    }
    if (u.includes('/rest/v1/generations')) {
      if ((init.method || 'GET') === 'GET') {
        if (u.includes('roomPhoto->>sha256')) { calls.lookups.push(u); return jsonRes(shaRows); }
        if (u.includes('roomPhoto->>phash')) { calls.lookups.push(u); return jsonRes(phashRows); }
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
        let text = JSON.stringify({ ok: true, issues: [], note: 'n' });
        if (prompt.startsWith('Measure and describe')) {
          const w = widths[n++ % widths.length];
          if (w === 'fail') return new Response('{"error":"bad"}', { status: 400 });
          const j = typeof w === 'object' ? w : { wall_width_mm: w, wall_height_mm: 2400, confidence: 'medium', existing_furniture: `old ${w}`, room_brief: `brief ${w}`, site_condition: 'finished' };
          text = JSON.stringify(j);
        }
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
  await job.fetch(new Request('https://generate-job/start', {
    method: 'POST',
    body: JSON.stringify({ id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'sink', options, inputs, startedAt: Date.now() }),
  }));
  await job.alarm();
}
const savedWall = () => calls.patched.find((p) => p.wall_analysis && !p.wall_analysis.guide && !p.wall_analysis.place)?.wall_analysis;
const analysed = () => calls.text.filter((t) => t.startsWith('Measure and describe')).length;

test('처음 보는 사진: 3회 분석의 중앙값(4500·4300·4350 → 4350), sha256 과 phash 를 남긴다, 조회는 sha256 + 최근 50행 phash', async () => {
  installJob();
  await runJob(PLANNER_OPTIONS);
  assert.equal(analysed(), ANALYSIS_ROUNDS);
  assert.equal(calls.lookups.length, 2);
  const sha = calls.lookups.find((u) => u.includes('sha256'));
  const ph = calls.lookups.find((u) => u.includes('phash'));
  assert.ok(sha.includes(`user_id=eq.${USER_ID}`) && sha.includes(`wall_analysis->roomPhoto->>sha256=eq.${ROOM_SHA}`) && sha.includes(`id=neq.${ROW_ID}`), sha);
  assert.ok(ph.includes(`user_id=eq.${USER_ID}`) && ph.includes('wall_analysis->roomPhoto->>phash=not.is.null') && ph.includes(`id=neq.${ROW_ID}`), ph);
  assert.ok(ph.includes('order=created_at.desc') && ph.includes(`limit=${ROOM_PHOTO_LOOKUP_LIMIT}`), ph);
  const w = savedWall();
  assert.equal(w.wallW, 4350);
  assert.equal(w.existing, 'old 4350');
  assert.equal(w.brief, 'brief 4350');
  assert.equal(w.roomPhoto.sha256, ROOM_SHA);
  assert.equal(hammingHex(w.roomPhoto.phash, ORIGINAL_PHASH) <= PHASH_MAX_DISTANCE, true);
  assert.equal(w.roomPhoto.from, ROW_ID);
  assert.equal(w.roomPhoto.rounds, 3);
  assert.equal(w.roomPhoto.analysis.wallW, 4350);
  assert.equal('roomPhoto' in w.roomPhoto.analysis, false);
  assert.ok(calls.image[0].prompt.includes('about 4350 mm in IMAGE A'));
});

test('같은 그림(바이트 다름)의 행이 여럿: phash 로 찾아 wallW 중앙값, 다른 사진은 빼고, 같은 from 은 하나로 — 분석 호출 0', async () => {
  installJob({
    phashRows: [
      priorRow(A_ID, 4100, { createdAt: '2026-10-19T00:00:01Z' }),
      priorRow(B_ID, 4500, { createdAt: '2026-10-19T00:00:02Z' }),
      priorRow(C_ID, 4300, { createdAt: '2026-10-19T00:00:03Z' }),
      priorRow(D_ID, 4100, { from: A_ID, createdAt: '2026-10-19T00:00:04Z' }), // A 를 이어받은 행 — 같은 분석의 사본
      priorRow('55555555-5555-4555-8555-555555555555', 5500, { phash: OTHER_PHASH }), // 다른 사진
    ],
  });
  await runJob(PLANNER_OPTIONS);
  assert.equal(analysed(), 0);
  const w = savedWall();
  assert.equal(w.wallW, 4300);
  assert.equal(w.existing, 'old 4300');
  assert.equal(w.roomPhoto.from, C_ID);
  assert.equal(w.roomPhoto.pooled, 3);
  assert.equal(w.roomPhoto.sha256, ROOM_SHA);
  assert.equal(w.roomPhoto.analysis.wallW, 4300);
  assert.ok(calls.image[0].prompt.includes('about 4300 mm in IMAGE A'));
});

test('sha256 같은 옛 행(phash 없음)도 후보 — phash 행과 합쳐 중앙값', async () => {
  installJob({
    shaRows: [priorRow(A_ID, 4100, { sha256: ROOM_SHA, phash: undefined })],
    phashRows: [priorRow(B_ID, 4500), priorRow(C_ID, 4300)],
  });
  await runJob(PLANNER_OPTIONS);
  assert.equal(analysed(), 0);
  assert.equal(savedWall().wallW, 4300);
  assert.equal(savedWall().roomPhoto.pooled, 3);
  assert.equal(savedWall().roomPhoto.from, C_ID);
});

test('같은 행이 두 조회에 다 나와도 한 번만 센다', async () => {
  const a = priorRow(A_ID, 4100, { sha256: ROOM_SHA });
  installJob({ shaRows: [a], phashRows: [a, priorRow(B_ID, 4500)] });
  await runJob(PLANNER_OPTIONS);
  assert.equal(savedWall().wallW, 4300);
  assert.equal(savedWall().roomPhoto.pooled, 2);
});

test('사람이 넣은 벽 폭이 이긴다 — 모아 쓴 분석 위에 덮고, 남기는 분석 원본은 그대로', async () => {
  installJob({ phashRows: [priorRow(A_ID, 4100), priorRow(B_ID, 4500)] });
  await runJob({ ...PLANNER_OPTIONS, wall_width_override: 3900 });
  const w = savedWall();
  assert.equal(analysed(), 0);
  assert.equal(w.wallW, 3900);
  assert.equal(w.confidence, 'user');
  assert.equal(w.roomPhoto.analysis.wallW, 4300);
  assert.ok(calls.image[0].prompt.includes('about 3900 mm in IMAGE A'));
});

test('3회 중 1회 실패: 남은 2회의 중앙값 (4500·4300 → 4400), rounds 2', async () => {
  installJob({ widths: [4500, 'fail', 4300] });
  await runJob(PLANNER_OPTIONS);
  assert.equal(analysed(), 3, '세 번 다 부른다');
  const w = savedWall();
  assert.equal(w.wallW, 4400);
  assert.equal(w.roomPhoto.rounds, 2);
  assert.equal(w.roomPhoto.analysis.wallW, 4400);
});

test('3회 전부 실패: 예전 기본값(3000×2400), roomPhoto 를 남기지 않는다 (다음 요청이 기본값을 잇지 않게)', async () => {
  installJob({ widths: ['fail', 'fail', 'fail'] });
  await runJob(PLANNER_OPTIONS);
  assert.equal(analysed(), 3);
  const w = savedWall();
  assert.equal(w.wallW, 3000);
  assert.equal(w.wallH, 2400);
  assert.equal('roomPhoto' in w, false);
});

test('급수·배기: 읽은 회차들의 중앙값, 못 읽은 회차의 기본값은 안 섞는다', async () => {
  const j = (w, extra) => ({ wall_width_mm: w, wall_height_mm: 2400, confidence: 'medium', ...extra });
  installJob({ widths: [j(4500, { water_supply_from_left_mm: 1800 }), j(4300), j(4350, { water_supply_from_left_mm: 1900, exhaust_from_left_mm: 2600 })] });
  await runJob(PLANNER_OPTIONS);
  const w = savedWall();
  assert.equal(w.wallW, 4350);
  assert.equal(w.waterPct, 42, '40 (1800/4500) 과 44 (1900/4350) 의 중앙값');
  assert.equal(w.exhaustPct, 60, '2600/4350 한 회차');
  assert.deepEqual(w.read, { width: true, height: true, water: true, exhaust: true });
});

test('플래너가 아니면 1회 분석, 찾지도 남기지도 않는다 (예전 그대로)', async () => {
  installJob({ phashRows: [priorRow(A_ID, 4100)] });
  await runJob({ variants: false });
  assert.equal(calls.lookups.length, 0);
  assert.equal(analysed(), 1);
  assert.equal(savedWall().wallW, 4500);
  assert.equal('roomPhoto' in savedWall(), false);
});

test('roomPhotoSha256 는 바이트 그대로', async () => {
  assert.equal(await roomPhotoSha256({ base64: ROOM_JPEG.toString('base64') }), ROOM_SHA);
  assert.equal(await roomPhotoSha256({ base64: '' }), null);
});
