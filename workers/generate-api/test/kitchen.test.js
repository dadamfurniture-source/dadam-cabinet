/**
 * 싱크대 덩어리 합성 (2026-10-19). 카메라 풀기는 답을 아는 가상 방으로 검산한다.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import encodeJpeg from 'jpeg-js/lib/encoder.js';
import decodeJpeg from 'jpeg-js/lib/decoder.js';
import {
  LENS_FOCAL35,
  buildLensPrompt,
  massingFocal,
  parseLens,
  buildKitchenPointsPrompt,
  kitchenFaces,
  parseKitchenPoints,
  renderKitchenMassing,
  solveKitchenCamera,
} from '../src/kitchen.js';
import { pasteVariantInPolys } from '../src/guide.js';
import { buildInstallPrompt } from '../src/prompts.js';
import { GenerateJob } from '../src/job.js';

/** 가상 방: 카메라 높이 hf, 벽 거리 D, 왼쪽으로 yaw 돈 카메라, 초점 f → 사진 픽셀 */
function virtualRoom({ W = 800, H = 1000, f = 500, hf = 1500, D = 3500, yawDeg = 20, wallH = 2400 } = {}) {
  const t = (yawDeg * Math.PI) / 180;
  const r1 = [Math.cos(t), 0, Math.sin(t)];
  const r2 = [0, 1, 0];
  const r3 = [-Math.sin(t), 0, Math.cos(t)];
  const proj = (X, h, z) => {
    const c = [0, 1, 2].map((i) => X * r1[i] + (hf - h) * r2[i] + (D - z) * r3[i]);
    return [(f * c[0]) / c[2] + W / 2, (f * c[1]) / c[2] + H / 2];
  };
  const R = 1200; // 오른쪽 옆벽 (X)
  const json = {
    back_floor: [proj(-600, 0, 0), proj(900, 0, 0)],
    back_ceiling: [proj(-600, wallH, 0), proj(900, wallH, 0)],
    left_end: { floor: proj(-800, 0, 0), ceiling: proj(-800, wallH, 0), side_wall: false },
    right_end: { floor: proj(R, 0, 0), ceiling: proj(R, wallH, 0), side_wall: true },
    side_floor: [proj(R, 0, 0), proj(R, 0, 1500)],
    side_ceiling: [proj(R, wallH, 0), proj(R, wallH, 1500)],
  };
  return { json, size: { width: W, height: H }, truth: { f, hf, D, xL: -800, xR: R }, proj };
}

test('선 찾기 프롬프트는 픽셀 [x, y] 이고, 옆벽 선이 없으면 쓰지 않는다', () => {
  assert.match(buildKitchenPointsPrompt({ width: 768, height: 1024 }), /The image is 768 x 1024 pixels/);
  const v = virtualRoom();
  assert.ok(parseKitchenPoints(v.json, v.size));
  assert.equal(parseKitchenPoints({ ...v.json, side_floor: null }, v.size), null);
  assert.equal(parseKitchenPoints('nope', v.size), null);
});

test('가상 방: 두 소실점으로 초점거리를, 벽 높이로 카메라 높이·벽 거리를 되찾는다', () => {
  const v = virtualRoom();
  const cam = solveKitchenCamera(parseKitchenPoints(v.json, v.size), v.size.width, v.size.height, { wallH: 2400 });
  assert.ok(cam, '풀린다');
  assert.ok(Math.abs(cam.f - v.truth.f) / v.truth.f < 0.03, `f ${cam.f}`);
  assert.ok(Math.abs(cam.hf - v.truth.hf) < 40, `hf ${cam.hf}`);
  assert.ok(Math.abs(cam.D - v.truth.D) / v.truth.D < 0.04, `D ${cam.D}`);
  assert.ok(Math.abs(cam.xL - v.truth.xL) < 60 && Math.abs(cam.xR - v.truth.xR) < 60, `x ${cam.xL}..${cam.xR}`);
  // 600mm 앞 바닥점이 실제 투영과 몇 픽셀 안에서 맞는다
  const p = cam.project(0, 0, 600);
  const q = v.proj(0, 0, 600);
  assert.ok(Math.hypot(p.x - q[0], p.y - q[1]) < 6, `${p.x},${p.y} vs ${q}`);
  assert.equal(cam.leftOpen, true);
  assert.equal(cam.rightOpen, false);
});

test('정면 사진(뒷벽 선이 평행)이면 초점거리는 기본값(EXIF 없으면 24mm 쪽)으로', () => {
  const v = virtualRoom({ yawDeg: 0 });
  const cam = solveKitchenCamera(parseKitchenPoints(v.json, v.size), v.size.width, v.size.height, { wallH: 2400, focalMm: 24 });
  assert.ok(cam);
  const fDefault = (24 / 43.27) * Math.hypot(v.size.width, v.size.height);
  assert.ok(Math.abs(cam.f - fDefault) < 1e-6);
});

test('초점거리 출처를 남긴다: 소실점 vp · EXIF exif · 가정 default (2026-10-20)', () => {
  const at = (yawDeg, o) => {
    const v = virtualRoom({ yawDeg });
    return solveKitchenCamera(parseKitchenPoints(v.json, v.size), v.size.width, v.size.height, { wallH: 2400, focalMm: 24, ...o });
  };
  assert.equal(at(20, {}).focalSource, 'vp');
  assert.equal(at(0, {}).focalSource, 'default');
  assert.equal(at(0, { focalFromExif: true }).focalSource, 'exif');
});

test('정면 사진은 선만으로 초점거리가 정해지지 않는다 — (f, D) 를 같이 키우면 Haiku 가 찾는 선이 똑같다 (2026-10-20 조사)', () => {
  // 광각(f 작음·벽 가까움)과 표준(f 큼·벽 멂)이 같은 사진 선을 낸다 → 풀린 벽 거리는 가정한 화각에 비례할 뿐이다
  const near = virtualRoom({ yawDeg: 0, f: 330, D: 2700 });
  const far = virtualRoom({ yawDeg: 0, f: 550, D: 4500 });
  // 뒷벽 선·양 끝은 같은 픽셀이다 (옆벽 점은 같은 선 위의 다른 자리 — 선은 같다)
  const r3 = (o) => JSON.parse(JSON.stringify(o), (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
  for (const k of ['back_floor', 'back_ceiling', 'left_end', 'right_end']) assert.deepEqual(r3(near.json[k]), r3(far.json[k]), k);
  const a = solveKitchenCamera(parseKitchenPoints(near.json, near.size), 800, 1000, { wallH: 2400, focalMm: 24 });
  const b = solveKitchenCamera(parseKitchenPoints(far.json, far.size), 800, 1000, { wallH: 2400, focalMm: 24 });
  assert.ok(Math.abs(a.D - b.D) < 1e-6, `${a.D} vs ${b.D}`);
});

test('살짝만 돈 사진(벽 방향 소실점이 아주 멂)도 초점거리는 기본값 — 멀리 있는 소실점은 흔들린다', () => {
  const v = virtualRoom({ yawDeg: 5 });
  const cam = solveKitchenCamera(parseKitchenPoints(v.json, v.size), v.size.width, v.size.height, { wallH: 2400, focalMm: 24 });
  assert.ok(cam);
  const fDefault = (24 / 43.27) * Math.hypot(v.size.width, v.size.height);
  assert.ok(Math.abs(cam.f - fDefault) < 1e-6);
  // 20° 돈 사진은 소실점이 가까워 그대로 푼다 (위 시험: f 500 을 되찾는다)
});

test('면 목록: 열린 끝(왼쪽)만 끝면이 있고, 개수대·쿡탑·문짝 틈이 있다', () => {
  const v = virtualRoom();
  const cam = solveKitchenCamera(parseKitchenPoints(v.json, v.size), v.size.width, v.size.height, { wallH: 2400 });
  const kinds = kitchenFaces(cam, { waterPct: 30, exhaustPct: 70 }).map((f) => f.kind);
  for (const k of ['upper-front', 'upper-bottom', 'lower-front', 'plinth', 'counter-top', 'counter-edge', 'sink', 'cooktop', 'gap']) {
    assert.ok(kinds.includes(k), k);
  }
  assert.ok(kinds.filter((k) => k.endsWith('-end')).length <= 2);
});

function solid(w, h, rgb) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; }
  return { base64: Buffer.from(encodeJpeg({ data, width: w, height: h }, 95).data).toString('base64'), mimeType: 'image/jpeg' };
}
function jpegPixels(b64) {
  const d = decodeJpeg(Buffer.from(b64, 'base64'), { useTArray: true, formatAsRGBA: true });
  return (x, y) => { const o = (y * d.width + x) * 4; return [d.data[o], d.data[o + 1], d.data[o + 2]]; };
}
function pngPixels(b64, w) {
  const png = Buffer.from(b64, 'base64');
  const chunks = [];
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o);
    if (png.toString('ascii', o + 4, o + 8) === 'IDAT') chunks.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  return (x, y) => { const o = y * (w * 3 + 1) + 1 + x * 3; return [raw[o], raw[o + 1], raw[o + 2]]; };
}

test('합성: 하부장 앞면 자리는 밝은 판, 천장 위쪽은 그대로 — mask 다각형을 돌려준다', async () => {
  const v = virtualRoom();
  const room = solid(800, 1000, [128, 128, 128]);
  const r = await renderKitchenMassing(room, parseKitchenPoints(v.json, v.size), { wallH: 2400, focalMm: 24 });
  assert.ok(r, '그려진다');
  assert.ok(r.mask.length >= 6);
  const px = pngPixels(r.base64, 800);
  const q = v.proj(-300, 500, 600); // 하부장 앞면 가운데쯤 (문짝 틈 피함)
  assert.ok(px(Math.round(q[0]), Math.round(q[1])).every((c) => c > 190), `${px(Math.round(q[0]), Math.round(q[1]))}`);
  assert.ok(px(400, 20).every((c) => Math.abs(c - 128) < 8));
});

test('되붙이기(다각형): 안은 추천안, 밖은 기본안', async () => {
  const base = solid(200, 200, [128, 128, 128]);
  const variant = solid(200, 200, [30, 150, 60]);
  const poly = [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.75, y: 0.75 }, { x: 0.25, y: 0.75 }];
  const r = await pasteVariantInPolys(base, variant, [poly]);
  assert.equal(r.mimeType, 'image/jpeg');
  const px = jpegPixels(r.base64);
  assert.ok(px(100, 100)[1] > 130 && px(100, 100)[0] < 60);
  assert.ok(px(10, 10).every((c) => Math.abs(c - 128) < 8));
  assert.equal(await pasteVariantInPolys(base, solid(100, 200, [0, 0, 0]), [poly]), null);
});

test('프롬프트: 싱크대 덩어리면 주방 문장, 붙박이장 덩어리면 예전 문장', () => {
  const c = { category: 'sink', wallW: 3000, wallH: 2400, waterPct: 30, exhaustPct: 70, refCount: 0, mockVolume: true, mockKind: 'kitchen' };
  const p = buildInstallPrompt(c);
  assert.match(p, /plain off-white mock volumes at their exact position, depth and size: base cabinets/);
  assert.match(p, /single-lever mixer faucet/);
  assert.doesNotMatch(p, /protruding wall/);
  assert.match(buildInstallPrompt({ ...c, category: 'wardrobe', mockKind: 'wardrobe' }), /flush with the front face of the protruding wall/);
});

// ─── 잡 흐름 ───

const ROW_ID = '77777777-7777-4777-8777-777777777777';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ENV = {
  GEMINI_API_KEY: 'g', GEMINI_RETRY_DELAYS_MS: '0', ANTHROPIC_API_KEY: 'sk-ant',
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', GENERATIONS_BUCKET: 'generations',
};
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let realFetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });
function fakeState() {
  const m = new Map();
  return { storage: {
    get: async (k) => m.get(k), put: async (k, v) => void m.set(k, structuredClone(v)),
    setAlarm: async () => {}, deleteAll: async () => m.clear(), deleteAlarm: async () => {},
  } };
}

async function runJob({ existing = null, options = {}, out = null, variantOut = null, maskJson = null, yawDeg, lens } = {}) {
  const v = virtualRoom(yawDeg == null ? {} : { yawDeg });
  const roomJpeg = Buffer.from(solid(800, 1000, [150, 150, 150]).base64, 'base64');
  const seen = { claude: [], install: null, uploads: [], bodies: {}, patched: [] };
  // 이미지 응답: 기본 'OUT'(PNG 흉내). out/variantOut 을 주면 그 JPEG — 기본안은 out, 추천안은 variantOut
  const outB64 = out ? out.base64 : Buffer.from('OUT').toString('base64');
  const outMime = out ? 'image/jpeg' : 'image/png';
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.anthropic.com/')) {
      const body = JSON.parse(init.body);
      seen.claude.push(body);
      // 바탕은 긴 변 1024 로 줄인 그림 — 800x1000 은 그대로. 기본안 윤곽 요청에는 maskJson
      const isMask = /^This render shows/.test(body.messages[0].content[1].text);
      const answer = isMask ? maskJson || { blocks: [] } : v.json;
      return jsonRes({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    }
    if (u.includes('/storage/v1/object/')) {
      if ((init.method || 'GET') === 'POST') {
        const key = u.split('/generations/')[1];
        seen.uploads.push(key);
        seen.bodies[key.split('/').at(-1)] = init.body;
        return jsonRes({ Key: 'ok' });
      }
      return new Response(roomJpeg, { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (u.includes('/rest/v1/generations')) {
      if ((init.method || 'GET') === 'GET') return jsonRes([{ id: ROW_ID, options: {} }]);
      seen.patched.push(JSON.parse(init.body));
      return jsonRes([{ id: ROW_ID }]);
    }
    const body = JSON.parse(init.body);
    const parts = body.contents[0].parts;
    const prompt = parts.at(-1).text;
    if (body.generationConfig.responseModalities.length === 1) {
      const text = prompt.startsWith('Measure and describe')
        ? JSON.stringify({ wall_width_mm: 3000, wall_height_mm: 2400, confidence: 'medium', site_condition: 'finished', existing_furniture: existing })
        : prompt.startsWith('Was this room photo taken')
        ? ((seen.lensAsked = (seen.lensAsked || 0) + 1), JSON.stringify({ lens: lens || 'unsure', confidence: 'high' }))
        : JSON.stringify({ ok: true, issues: [], note: 'n' });
      return jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
    }
    const isInstall = prompt.startsWith('Edit the first photo');
    if (isInstall) seen.install = { prompt, mimes: parts.filter((p) => p.inlineData).map((p) => p.inlineData.mimeType) };
    const data = !isInstall && variantOut ? variantOut.base64 : outB64;
    return jsonRes({ candidates: [{ content: { parts: [{ inlineData: { mimeType: outMime, data } }] } }] });
  };
  const job = new GenerateJob(fakeState(), { ...ENV });
  await job.fetch(new Request('https://generate-job/start', { method: 'POST', body: JSON.stringify({
    id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'sink', options: { variants: false, ...options },
    inputs: { room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' }, refs: [] }, startedAt: Date.now(),
  }) }));
  await job.alarm();
  return seen;
}

test('잡: 빈 벽 싱크대 → Haiku 가 선을 찾고 덩어리 합성본이 편집 대상, 기록에 mask·카메라', async () => {
  const seen = await runJob({ options: { room_focal35: 24 } });
  assert.equal(seen.claude.length, 1);
  assert.equal(seen.claude[0].model, 'claude-haiku-5-5');
  assert.match(seen.claude[0].messages[0].content[1].text, /a built-in kitchen will run along it/);
  assert.ok(seen.uploads.some((p) => p.endsWith('/massing.png')));
  assert.deepEqual(seen.install.mimes, ['image/png']);
  assert.match(seen.install.prompt, /mock volumes at their exact position/);
  const wa = seen.patched.find((p) => p.wall_analysis && p.wall_analysis.guide);
  assert.equal(wa.wall_analysis.guide.kind, 'kitchen');
  assert.ok(wa.wall_analysis.guide.mask.length >= 6);
  assert.ok(wa.wall_analysis.guide.cam.D > 0);
  // 가상 방은 20° 돈 사진이라 두 소실점으로 풀린다 (EXIF 24 가 있어도 소실점이 이긴다)
  assert.equal(wa.wall_analysis.guide.cam.focalSource, 'vp');
});

test('잡: 기존 가구가 있는 사진은 싱크대 덩어리 합성을 하지 않는다 (글 지시)', async () => {
  const seen = await runJob({ existing: 'old dark cabinets' });
  assert.equal(seen.claude.length, 0);
  assert.deepEqual(seen.install.mimes, ['image/jpeg']);
});

test('잡: 추천안 되붙이기는 기본안에서 다시 찾은 가구 윤곽(baseMask)을 쓴다', async () => {
  // 기본안(회색)·추천안(초록). Haiku 는 기본안 위쪽 왼쪽 사분면만 가구라고 답한다 (픽셀, 800x1000).
  const maskJson = { blocks: [{ name: 'upper', outline: [[400, 0], [0, 0], [0, 500], [400, 500]] }, { name: 'speck', outline: [[1, 1], [3, 1], [3, 3]] }] };
  const seen = await runJob({
    options: { variants: true },
    out: solid(800, 1000, [128, 128, 128]),
    variantOut: solid(800, 1000, [30, 150, 60]),
    maskJson,
  });
  assert.equal(seen.claude.length, 2, '선 찾기 + 기본안 윤곽');
  assert.match(seen.claude[1].messages[0].content[1].text, /fitted kitchen/);
  const wa = seen.patched.filter((p) => p.wall_analysis && p.wall_analysis.guide).at(-1);
  assert.equal(wa.wall_analysis.guide.baseMask.length, 1, '작은 조각은 버린다');
  const v1 = seen.bodies['v1.jpg'];
  assert.ok(v1, '추천안이 JPEG 로 되붙여 올라간다 (2026-10-20 PNG → JPEG)');
  assert.ok(!seen.bodies['v1.png']);
  const px = jpegPixels(Buffer.from(await new Response(v1).arrayBuffer()).toString('base64'));
  assert.ok(px(150, 200)[1] > 130 && px(150, 200)[0] < 60, `윤곽 안은 추천안 ${px(150, 200)}`);
  assert.ok(px(650, 800).every((c) => Math.abs(c - 128) < 8), `윤곽 밖은 기본안 ${px(650, 800)}`);
});

// ─── 렌즈 판정으로 화각 고르기 (2026-10-20 사장님 승인: 광각 13 · 표준 24) ───

test('화각 고르기: EXIF 가 이기고, 없으면 분석의 렌즈 판정, 그것도 없으면 24', () => {
  assert.deepEqual(LENS_FOCAL35, { ultra_wide: 13, standard: 24 });
  assert.deepEqual(massingFocal(26, 'ultra_wide'), { focalMm: 26, basis: 'exif' });
  assert.deepEqual(massingFocal(undefined, 'ultra_wide'), { focalMm: 13, basis: 'lens-ultra_wide' });
  assert.deepEqual(massingFocal(null, 'standard'), { focalMm: 24, basis: 'lens-standard' });
  assert.deepEqual(massingFocal(undefined, undefined), { focalMm: 24, basis: 'default' });
  assert.deepEqual(massingFocal(5, 'unsure'), { focalMm: 24, basis: 'default' }, '말이 안 되는 EXIF 는 버린다');
});

test('정면 광각 사진: 13mm 로 풀면 벽 거리가 24mm 의 13/24 — 깊이가 제대로 선다', () => {
  const v = virtualRoom({ yawDeg: 0 });
  const p = parseKitchenPoints(v.json, v.size);
  const a = solveKitchenCamera(p, v.size.width, v.size.height, { wallH: 2400, ...((m) => ({ focalMm: m.focalMm, focalBasis: m.basis }))(massingFocal(null, 'standard')) });
  const b = solveKitchenCamera(p, v.size.width, v.size.height, { wallH: 2400, ...((m) => ({ focalMm: m.focalMm, focalBasis: m.basis }))(massingFocal(null, 'ultra_wide')) });
  assert.equal(b.focalSource, 'lens-ultra_wide');
  assert.ok(Math.abs(b.D / a.D - 13 / 24) < 1e-9, `${b.D} / ${a.D}`);
  assert.ok(Math.abs(b.hf - a.hf) < 1e-6, '카메라 높이는 그대로');
});

test('잡: EXIF 없는 정면 사진은 렌즈를 따로 한 번 묻고, 광각이면 13mm 로 풀어 기록한다 · EXIF 가 있으면 묻지 않는다', async () => {
  let seen = await runJob({ yawDeg: 0, lens: 'ultra_wide' });
  assert.equal(seen.lensAsked, 1);
  let wa = seen.patched.filter((p) => p.wall_analysis && p.wall_analysis.guide).at(-1);
  assert.equal(wa.wall_analysis.guide.cam.focalSource, 'lens-ultra_wide');
  seen = await runJob({ yawDeg: 0, lens: 'ultra_wide', options: { room_focal35: 26 } });
  assert.equal(seen.lensAsked, undefined, 'EXIF 가 있으면 묻지 않는다');
  wa = seen.patched.filter((p) => p.wall_analysis && p.wall_analysis.guide).at(-1);
  assert.equal(wa.wall_analysis.guide.cam.focalSource, 'exif');
  seen = await runJob({ yawDeg: 0 });
  assert.equal(seen.lensAsked, 1);
  wa = seen.patched.filter((p) => p.wall_analysis && p.wall_analysis.guide).at(-1);
  assert.equal(wa.wall_analysis.guide.cam.focalSource, 'default', 'unsure 면 24');
});

test('렌즈 질문: 시험한 문장 그대로, 답 풀기는 ultra_wide·standard 만', () => {
  assert.match(buildLensPrompt(), /^Was this room photo taken with a phone's ultra-wide lens \(the 0\.5x camera/);
  assert.equal(parseLens('{"lens":"ultra_wide","confidence":"high"}'), 'ultra_wide');
  assert.equal(parseLens('```json\n{"lens":"standard"}\n```'), 'standard');
  assert.equal(parseLens('{"lens":"unsure"}'), null);
  assert.equal(parseLens('nope'), null);
});
