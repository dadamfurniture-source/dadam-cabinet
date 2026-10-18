/**
 * 사진 위 가이드 선 (깊이 계획 3a, 2026-10-18).
 * 10/18 붙박이장: 튀어나온 벽을 분석이 잡고 글로 "그 벽 앞면에 맞춰라" 해도 GPT 가 앞면을 끌어내지 못했다.
 * 그래서 앞면 선을 계산해 사진 사본에 그려 보낸다.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import encodeJpeg from 'jpeg-js/lib/encoder.js';
import { buildGuidePointsPrompt, computeGuide, encodePng, parseGuidePoints, renderGuideImage } from '../src/guide.js';
import { buildInstallPrompt, buildQcPrompt } from '../src/prompts.js';
import { GenerateJob } from '../src/job.js';

/** 사장님 붙박이장 사진에서 눈으로 찍은 점 ([y, x] 0~1000) */
const REAL = {
  back_floor: [[676, 124], [721, 826]],
  back_ceiling: [[374, 115], [341, 826]],
  return_front: { top: [289, 903], bottom: [810, 903] },
  return_back: { top: [341, 826], bottom: [721, 826] },
  far_floor: [[676, 124], [727, 0]],
  far_ceiling: [[374, 115], [346, 0]],
};

function grayJpeg(w, hgt) {
  const data = new Uint8Array(w * hgt * 4).fill(128);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return Buffer.from(encodeJpeg({ data, width: w, height: hgt }, 90).data).toString('base64');
}

test('점 해석: 필수(뒷벽 바닥·천장선, 튀어나온 벽 앞 모서리)가 없으면 null', () => {
  const g = parseGuidePoints('```json\n' + JSON.stringify(REAL) + '\n```', 'right');
  assert.equal(g.side, 'right');
  assert.deepEqual(g.returnFront.bottom, { x: 0.903, y: 0.81 });
  assert.equal(parseGuidePoints(JSON.stringify({ ...REAL, return_front: null }), 'right'), null);
  assert.equal(parseGuidePoints(JSON.stringify({ ...REAL, back_floor: [[1, 2]] }), 'right'), null);
  assert.equal(parseGuidePoints('nope', 'right'), null);
});

test('앞면 선은 튀어나온 벽 앞 모서리를 지나 뒷벽 소실점으로 간다', () => {
  const W = 768, H = 1024;
  const g = computeGuide(parseGuidePoints(JSON.stringify(REAL), 'right'), W, H);
  const { ob, rb, ot, rt } = g.front;
  assert.ok(Math.abs(rb.x - 0.903 * W) < 1 && Math.abs(rb.y - 0.81 * H) < 1);
  // 앞면 바닥선이 뒷벽 바닥선보다 아래(카메라 쪽)
  assert.ok(ob.y > 0.727 * H - 5, `왼쪽 앞 모서리 ${ob.y}`);
  // 소실점 확인: 뒷벽 바닥선·천장선·앞면 바닥선·앞면 천장선이 한 점에서 만난다
  const line = (a, b) => [a.y - b.y, b.x - a.x, a.x * b.y - b.x * a.y];
  const meet = (l1, l2) => {
    const z = l1[0] * l2[1] - l1[1] * l2[0];
    return { x: (l1[1] * l2[2] - l1[2] * l2[1]) / z, y: (l1[2] * l2[0] - l1[0] * l2[2]) / z };
  };
  const P = ([y, x]) => ({ x: (x / 1000) * W, y: (y / 1000) * H });
  const vp = meet(line(P(REAL.back_floor[0]), P(REAL.back_floor[1])), line(P(REAL.back_ceiling[0]), P(REAL.back_ceiling[1])));
  const vpFront = meet(line(ob, rb), line(ot, rt));
  assert.ok(Math.hypot(vp.x - vpFront.x, vp.y - vpFront.y) < 2, `${JSON.stringify(vp)} vs ${JSON.stringify(vpFront)}`);
  assert.ok(g.segments.length >= 6, '앞면 4선 + 물러나는 모서리');
});

test('정면 사진(바닥·천장선이 평행)도 그린다 — 앞면 선은 뒷벽 선과 평행', () => {
  const pts = parseGuidePoints(JSON.stringify({
    back_floor: [[700, 100], [700, 800]],
    back_ceiling: [[300, 100], [300, 800]],
    return_front: { top: [250, 900], bottom: [780, 900] },
  }), 'right');
  const g = computeGuide(pts, 1000, 1000);
  assert.ok(Math.abs(g.front.ob.y - 780) < 0.5 && Math.abs(g.front.rb.y - 780) < 0.5);
  assert.ok(Math.abs(g.front.ob.x) < 1e-9); // 옆벽 선이 없으면 사진 가장자리까지
});

test('앞 모서리가 뒷벽보다 안쪽이면(점이 틀렸으면) 그리지 않는다', () => {
  const pts = parseGuidePoints(JSON.stringify({ ...REAL, return_front: { top: [400, 903], bottom: [650, 903] } }), 'right');
  assert.equal(computeGuide(pts, 768, 1024), null);
});

test('PNG: 서명·크기·압축이 맞다', async () => {
  const rgb = new Uint8Array(4 * 3 * 3).fill(200);
  const png = await encodePng({ width: 4, height: 3, rgb });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const dv = new DataView(png.buffer);
  assert.equal(dv.getUint32(16), 4);
  assert.equal(dv.getUint32(20), 3);
  const idatLen = dv.getUint32(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLen));
  assert.equal(raw.length, 3 * (4 * 3 + 1));
});

test('JPEG 사본 위에 자홍색 선을 그린 PNG 를 만든다 (긴 변 1024 이하)', async () => {
  const room = { base64: grayJpeg(300, 400), mimeType: 'image/jpeg' };
  const r = await renderGuideImage(room, parseGuidePoints(JSON.stringify(REAL), 'right'));
  assert.equal(r.mimeType, 'image/png');
  assert.equal(r.width, 300);
  assert.equal(r.height, 400);
  // 앞면 바닥선 위 한 점(튀어나온 벽 앞 모서리 근처)이 자홍색인지 PNG 를 풀어 본다
  const png = Buffer.from(r.base64, 'base64');
  const raw = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)));
  const px = (x, y) => { const o = y * (300 * 3 + 1) + 1 + x * 3; return [raw[o], raw[o + 1], raw[o + 2]]; };
  const rb = r.guide.front.rb;
  assert.deepEqual(px(Math.round(rb.x) - 6, Math.round(rb.y)), [255, 0, 255]);
  assert.ok(px(10, 10).every((v) => Math.abs(v - 128) < 6)); // 선 밖은 그대로(회색 근처)
  // PNG 가 아니면 그리지 않는다
  assert.equal(await renderGuideImage({ base64: 'x', mimeType: 'image/png' }, {}), null);
});

test('프롬프트: 가이드가 있으면 GUIDE 줄·참고 이미지 위치·guide_left 검사', () => {
  const c = { category: 'wardrobe', wallW: 3550, wallH: 2350, refCount: 1, guide: true, sideReturn: { side: 'right', depthMm: 700 } };
  const p = buildInstallPrompt(c);
  assert.match(p, /\nGUIDE: the last image is this same photo with magenta guide lines/);
  assert.match(p, /The image between the first photo and the last is a style reference/);
  assert.match(buildQcPrompt(c), /- guide_left: magenta or pink guide lines/);
  const off = { ...c, guide: false };
  assert.doesNotMatch(buildInstallPrompt(off), /GUIDE:/);
  assert.doesNotMatch(buildQcPrompt(off), /guide_left/);
});

// ─── 잡 흐름 ───

const ROW_ID = '66666666-6666-4666-8666-666666666666';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ENV = {
  GEMINI_API_KEY: 'g',
  GEMINI_RETRY_DELAYS_MS: '0',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
};
const jsonRes = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
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

async function runJob({ category = 'wardrobe', sideReturn = { side: 'right', depth_mm: 700 }, points = REAL, env = {}, anthropic } = {}) {
  const roomJpeg = Buffer.from(grayJpeg(120, 160), 'base64');
  const seen = { uploads: [], install: null, guideAsked: 0, patched: [], claude: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.anthropic.com/')) {
      const body = JSON.parse(typeof init.body === 'string' ? init.body : await new Response(init.body).text());
      seen.claude.push(body);
      return anthropic(body);
    }
    if (u.includes('/storage/v1/object/')) {
      if ((init.method || 'GET') === 'POST') { seen.uploads.push(u.split('/generations/')[1]); return jsonRes({ Key: 'ok' }); }
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
      let text;
      if (prompt.startsWith('Measure and describe')) {
        text = JSON.stringify({ wall_width_mm: 3550, wall_height_mm: 2350, confidence: 'medium', site_condition: 'finished', camera_side: 'left', side_return: sideReturn });
      } else if (prompt.startsWith('Find lines and corners')) {
        seen.guideAsked++;
        text = JSON.stringify(points);
      } else {
        text = JSON.stringify({ ok: true, issues: [], note: 'n' });
      }
      return jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
    }
    if (prompt.startsWith('Edit the first photo')) {
      seen.install = { prompt, mimes: parts.filter((p) => p.inlineData).map((p) => p.inlineData.mimeType) };
    }
    return jsonRes({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('OUT').toString('base64') } }] } }] });
  };
  const job = new GenerateJob(fakeState(), { ...ENV, ...env });
  await job.fetch(new Request('https://generate-job/start', {
    method: 'POST',
    body: JSON.stringify({
      id: ROW_ID, userId: USER_ID, creditRef: 'c', category, options: { variants: false },
      inputs: { room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' }, refs: [] },
      startedAt: Date.now(),
    }),
  }));
  await job.alarm();
  return seen;
}

test('잡: 붙박이장 + 튀어나온 벽이면 가이드를 그려 마지막 이미지로 보내고 기록한다', async () => {
  const seen = await runJob();
  assert.equal(seen.guideAsked, 1);
  assert.ok(seen.uploads.some((p) => p.endsWith('/guide.png')));
  assert.deepEqual(seen.install.mimes, ['image/jpeg', 'image/png']);
  assert.match(seen.install.prompt, /\nGUIDE: /);
  const wa = seen.patched.find((p) => p.wall_analysis && p.wall_analysis.guide);
  assert.ok(wa, 'wall_analysis.guide 를 남긴다');
  assert.equal(seen.patched.at(-1).status, 'done');
});

test('잡: 튀어나온 벽이 없거나 붙박이장이 아니면 가이드를 만들지 않는다', async () => {
  let seen = await runJob({ sideReturn: null });
  assert.equal(seen.guideAsked, 0);
  assert.deepEqual(seen.install.mimes, ['image/jpeg']);
  seen = await runJob({ category: 'sink' });
  assert.equal(seen.guideAsked, 0);
});

test('잡: 점을 못 찾으면 가이드 없이 글 지시로 그린다', async () => {
  const seen = await runJob({ points: { back_floor: null } });
  assert.equal(seen.guideAsked, 1);
  assert.deepEqual(seen.install.mimes, ['image/jpeg']);
  assert.doesNotMatch(seen.install.prompt, /GUIDE:/);
  assert.equal(seen.patched.at(-1).status, 'done');
});

// ─── 선 찾기는 Claude Haiku 5.5 (2026-10-18 사장님) — 줄인 바탕 PNG 의 픽셀 [x, y] ───

/** REAL(0~1000 [y,x]) → w×h 픽셀 [x,y] */
function toPixels(src, w, hgt) {
  const c = ([y, x]) => [(x / 1000) * w, (y / 1000) * hgt];
  return {
    back_floor: src.back_floor.map(c),
    back_ceiling: src.back_ceiling.map(c),
    return_front: { top: c(src.return_front.top), bottom: c(src.return_front.bottom) },
    return_back: { top: c(src.return_back.top), bottom: c(src.return_back.bottom) },
    far_floor: src.far_floor.map(c),
    far_ceiling: src.far_ceiling.map(c),
  };
}

const claudeOk = (json) => () =>
  new Response(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5',
    content: [{ type: 'text', text: JSON.stringify(json) }],
    stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
  }), { headers: { 'Content-Type': 'application/json' } });

test('픽셀 [x, y] 로 받은 점도 같은 0~1 좌표가 된다', () => {
  const size = { width: 768, height: 1024 };
  const fromPx = parseGuidePoints(toPixels(REAL, 768, 1024), 'right', size);
  const fromNorm = parseGuidePoints(JSON.stringify(REAL), 'right');
  assert.ok(Math.abs(fromPx.returnFront.bottom.x - fromNorm.returnFront.bottom.x) < 1e-9);
  assert.ok(Math.abs(fromPx.backFloor[1].y - fromNorm.backFloor[1].y) < 1e-9);
  assert.match(buildGuidePointsPrompt('right', size), /The image is 768 x 1024 pixels\. Every point is \[x, y\]/);
  assert.match(buildGuidePointsPrompt('right'), /normalized to 0-1000/);
});

test('잡: Claude 키가 있으면 Haiku 5.5 가 선을 찾는다 — 거절 대체 없이, 줄인 PNG 와 픽셀 프롬프트로', async () => {
  const seen = await runJob({ env: { ANTHROPIC_API_KEY: 'sk-ant-test' }, anthropic: claudeOk(toPixels(REAL, 120, 160)) });
  assert.equal(seen.claude.length, 1);
  const body = seen.claude[0];
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.fallbacks, undefined);
  assert.equal(body.output_config.format.type, 'json_schema');
  const [img, txt] = body.messages[0].content;
  assert.equal(img.source.media_type, 'image/png');
  assert.match(txt.text, /The image is 120 x 160 pixels/);
  assert.equal(seen.guideAsked, 0, 'Gemini 에 묻지 않는다');
  const wa = seen.patched.find((p) => p.wall_analysis && p.wall_analysis.guide);
  assert.equal(wa.wall_analysis.guide.by, 'claude-haiku-5-5');
  assert.deepEqual(seen.install.mimes, ['image/jpeg', 'image/png']);
});

test('잡: Haiku 가 실패하면 Gemini 가 선을 찾는다', async () => {
  const seen = await runJob({
    env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    anthropic: () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }), { status: 400 }),
  });
  assert.equal(seen.claude.length, 1);
  assert.equal(seen.guideAsked, 1);
  const wa = seen.patched.find((p) => p.wall_analysis && p.wall_analysis.guide);
  assert.equal(wa.wall_analysis.guide.by, 'gemini-3.8-flash');
});
