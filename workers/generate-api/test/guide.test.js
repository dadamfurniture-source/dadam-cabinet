/**
 * 사진 위 가이드 선 (깊이 계획 3a, 2026-10-18).
 * 10/18 붙박이장: 튀어나온 벽을 분석이 잡고 글로 "그 벽 앞면에 맞춰라" 해도 GPT 가 앞면을 끌어내지 못했다.
 * 그래서 앞면 선을 계산해 사진 사본에 그려 보낸다.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import encodeJpeg from 'jpeg-js/lib/encoder.js';
import decodeJpeg from 'jpeg-js/lib/decoder.js';
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

test('잡(기본=덩어리 합성): 합성본이 편집 대상(첫 사진)이 되고, 다듬기 프롬프트·flat_mockup 검사로 간다', async () => {
  const seen = await runJob();
  assert.equal(seen.guideAsked, 1);
  assert.ok(seen.uploads.some((p) => p.endsWith('/guide.png')));
  assert.ok(seen.uploads.some((p) => p.endsWith('/massing.png')));
  assert.deepEqual(seen.install.mimes, ['image/png'], '방 사진 대신 합성본 한 장');
  assert.match(seen.install.prompt, /^Edit the first photo: it already shows the new built-in .+ as a plain off-white mock volume/);
  assert.match(seen.install.prompt, /GEOMETRY IS FIXED/);
  assert.doesNotMatch(seen.install.prompt, /\nGUIDE: /);
  const wa = seen.patched.find((p) => p.wall_analysis && p.wall_analysis.guide);
  assert.ok(wa.wall_analysis.guide.massing, '합성본 경로를 남긴다');
  assert.equal(seen.patched.at(-1).status, 'done');
});

test('잡(GUIDE_MODE=outline): 윤곽선만 마지막 이미지로 — 예전 방식', async () => {
  const seen = await runJob({ env: { GUIDE_MODE: 'outline' } });
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
  assert.deepEqual(seen.install.mimes, ['image/png']); // 기본은 덩어리 합성본 한 장
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

test('덩어리: 앞면 사각형 안은 오프화이트로 칠하고, 밖(뒷벽)은 그대로 둔다', async () => {
  const room = { base64: grayJpeg(300, 400), mimeType: 'image/jpeg' };
  const { renderMassingImage } = await import('../src/guide.js');
  const r = await renderMassingImage(room, parseGuidePoints(JSON.stringify(REAL), 'right'), { doors: 8 });
  assert.equal(r.width, 300);
  assert.equal(r.height, 400);
  const png = Buffer.from(r.base64, 'base64');
  // IDAT 가 여러 개일 수 있다 — 모두 모아 푼다
  const chunks = [];
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o);
    const type = png.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') chunks.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const px = (x, y) => { const o = y * (300 * 3 + 1) + 1 + x * 3; return [raw[o], raw[o + 1], raw[o + 2]]; };
  // 앞면 한가운데(문짝 틈을 피한 곳)는 밝은 판
  const f = r.guide.front;
  const cx = Math.round((f.ob.x + f.rb.x) / 2 + 9), cy = Math.round((f.ot.y + f.ob.y) / 2);
  assert.ok(px(cx, cy).every((v) => v > 200), `앞면 ${px(cx, cy)}`);
  // 천장 위쪽(덩어리 밖)은 원래 회색
  assert.ok(px(150, 20).every((v) => Math.abs(v - 128) < 6));
});

// 2026-10-19: 추천안이 옆 세면대 서랍까지 칠했다 → 장 영역만 추천안, 나머지는 기본안
test('되붙이기: 장 앞면 영역 안은 추천안, 멀리 밖은 기본안 — 크기가 다르면 하지 않는다', async () => {
  const { pasteVariantInside } = await import('../src/guide.js');
  const solid = (w, hgt, rgb) => {
    const data = new Uint8Array(w * hgt * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; }
    return { base64: Buffer.from(encodeJpeg({ data, width: w, height: hgt }, 95).data).toString('base64'), mimeType: 'image/jpeg' };
  };
  const base = solid(300, 400, [128, 128, 128]);
  const variant = solid(300, 400, [40, 160, 60]);
  const pts = parseGuidePoints(JSON.stringify(REAL), 'right');
  const r = await pasteVariantInside(base, variant, pts);
  // 2026-10-20: 결과는 JPEG 다 (PNG 1.6~2.3MB → 휴대폰에서 늦게 떴다)
  assert.equal(r.mimeType, 'image/jpeg');
  const dec = decodeJpeg(Buffer.from(r.base64, 'base64'), { useTArray: true, formatAsRGBA: true });
  assert.equal(dec.width, 300);
  const px = (x, y) => { const o = (y * 300 + x) * 4; return [dec.data[o], dec.data[o + 1], dec.data[o + 2]]; };
  const g = computeGuide(pts, 300, 400).front;
  const inside = px(Math.round((g.ob.x + g.rb.x) / 2), Math.round((g.ot.y + g.ob.y) / 2));
  assert.ok(inside[1] > 140 && inside[0] < 70, `안 ${inside}`);
  // 튀어나온 벽 너머 오른쪽(세면대 자리)과 천장은 기본안 회색
  for (const [x, y] of [[295, 250], [150, 30]]) {
    assert.ok(px(x, y).every((v) => Math.abs(v - 128) < 8), `밖 ${x},${y} ${px(x, y)}`);
  }
  assert.equal(await pasteVariantInside(base, solid(200, 400, [0, 0, 0]), pts), null);
  assert.equal(await pasteVariantInside({ ...base, mimeType: 'image/png' }, variant, pts), null);
});

// ─── 튀어나온 옆벽 다시 보기 (2026-10-20) — 분석이 놓치면 Haiku 에게 한 번 더 ───

/** 옆벽 확인 질문과 선 찾기 질문을 나눠 답한다 */
const claudeBy = (check, points) => (body) => {
  const text = body.messages[0].content.at(-1).text;
  return claudeOk(text.startsWith('This photo shows a room.') ? check : points)();
};

test('옆벽 확인: 분석이 놓쳤어도 Haiku 가 확실(high)하다면 받아 덩어리 합성까지 간다', async () => {
  const seen = await runJob({
    sideReturn: null,
    env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    anthropic: claudeBy({ side: 'right', confidence: 'high', note: 'grey column at right end' }, toPixels(REAL, 120, 160)),
  });
  assert.equal(seen.claude.length, 2, '옆벽 확인 + 선 찾기');
  assert.match(seen.claude[0].messages[0].content.at(-1).text, /^This photo shows a room\./);
  assert.equal(seen.claude[0].model, 'claude-haiku-5-5');
  assert.equal(seen.claude[0].fallbacks, undefined);
  const wa = seen.patched.find((p) => p.wall_analysis && p.wall_analysis.sideReturn);
  assert.deepEqual(wa.wall_analysis.sideReturn, { side: 'right', depthMm: null, by: 'claude-haiku-5-5' });
  assert.ok(seen.uploads.some((p) => p.endsWith('/massing.png')));
  assert.deepEqual(seen.install.mimes, ['image/png'], '덩어리 합성본이 편집 대상');
  assert.match(seen.install.prompt, /flush with the front face of the protruding wall/);
});

test('옆벽 확인: 확실하지 않거나(medium) none 이면 받지 않는다 — 예전처럼 글로 그린다', async () => {
  for (const check of [{ side: 'right', confidence: 'medium', note: 'maybe' }, { side: 'none', confidence: 'high', note: 'flat' }]) {
    const seen = await runJob({ sideReturn: null, env: { ANTHROPIC_API_KEY: 'sk-ant-test' }, anthropic: claudeBy(check, toPixels(REAL, 120, 160)) });
    assert.equal(seen.claude.length, 1, '옆벽 확인만 묻고 선은 찾지 않는다');
    assert.ok(!seen.uploads.some((p) => p.endsWith('/massing.png')));
    assert.deepEqual(seen.install.mimes, ['image/jpeg']);
  }
});

test('옆벽 확인: 분석이 이미 잡았거나, 벽 끝까지 채우는 장이 아니거나, 키가 없으면 묻지 않는다', async () => {
  let seen = await runJob({ env: { ANTHROPIC_API_KEY: 'sk-ant-test' }, anthropic: claudeBy({ side: 'left', confidence: 'high', note: '' }, toPixels(REAL, 120, 160)) });
  assert.ok(!seen.claude.some((b) => b.messages[0].content.at(-1).text.startsWith('This photo shows a room.')), '분석이 잡았으면 묻지 않는다');
  seen = await runJob({ category: 'sink', sideReturn: null, env: { ANTHROPIC_API_KEY: 'sk-ant-test', GUIDE_MODE: 'outline' }, anthropic: claudeBy({ side: 'right', confidence: 'high', note: '' }, {}) });
  assert.ok(!seen.claude.some((b) => b.messages[0].content.at(-1).text.startsWith('This photo shows a room.')), '싱크대는 묻지 않는다');
  seen = await runJob({ sideReturn: null });
  assert.equal(seen.claude.length, 0, '키가 없으면 묻지 않는다');
});

test('JPEG 인코딩: 워커처럼 전역 Buffer 가 없어도 되고, 끝나면 전역을 그대로 둔다 (2026-10-20)', async () => {
  const { encodeJpeg: enc } = await import('../src/guide.js');
  const w = 64, h = 48;
  const data = new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256));
  const saved = globalThis.Buffer;
  delete globalThis.Buffer;
  let bytes;
  try {
    bytes = enc({ width: w, height: h, data });
    assert.equal(typeof globalThis.Buffer, 'undefined', '빌려 쓴 Buffer 를 치운다');
  } finally {
    globalThis.Buffer = saved;
  }
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual([bytes[0], bytes[1], bytes.at(-2), bytes.at(-1)], [0xff, 0xd8, 0xff, 0xd9], 'SOI … EOI');
  const back = decodeJpeg(Buffer.from(bytes), { useTArray: true });
  assert.equal(back.width, w);
  assert.equal(back.height, h);
});

test('덩어리 나눔선(lines): 세로선·가로선 자리는 어둡고 바로 옆은 밝다 (2026-10-20 냉장고장)', async () => {
  const room = { base64: grayJpeg(300, 400), mimeType: 'image/jpeg' };
  const { renderMassingImage } = await import('../src/guide.js');
  const points = parseGuidePoints(JSON.stringify(REAL), 'right');
  const r = await renderMassingImage(room, points, { lines: { vertical: [0.5], horizontal: [{ v: 0.3, u0: 0, u1: 1 }] } });
  const png = Buffer.from(r.base64, 'base64');
  const chunks = [];
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o);
    const type = png.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') chunks.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const px = (x, y) => { const o = y * (300 * 3 + 1) + 1 + x * 3; return [raw[o], raw[o + 1], raw[o + 2]]; };
  const f = r.guide.front;
  const left = f.ob.x <= f.rb.x;
  const [tl, tr, br, bl] = left ? [f.ot, f.rt, f.rb, f.ob] : [f.rt, f.ot, f.ob, f.rb];
  // doors 는 1 이라 앞면 안쪽(걸레받이·가장자리 제외)의 어두운 픽셀은 나눔선뿐이다 — 줄·열을 훑어 한 무리인지 본다
  const dark = (v) => v < 170;
  const y = Math.round((tl.y + bl.y) / 2 + (br.y - tr.y) * 0.1);
  const xs = [];
  for (let x = Math.round(Math.min(tl.x, bl.x)) + 4; x < Math.round(Math.max(tr.x, br.x)) - 4; x++) if (dark(px(x, y)[0])) xs.push(x);
  assert.ok(xs.length >= 1 && xs.length <= 6, `세로선 픽셀 ${xs.join(',')}`);
  assert.ok(Math.max(...xs) - Math.min(...xs) <= 4, `세로선이 한 무리 ${xs.join(',')}`);
  const x = Math.round(tl.x + (tr.x - tl.x) * 0.25);
  const ys = [];
  for (let yy = Math.round(Math.max(tl.y, tr.y)) + 4; yy < Math.round(Math.min(bl.y, br.y)) * 0.85; yy++) if (dark(px(x, yy)[0])) ys.push(yy);
  assert.ok(ys.length >= 1 && ys.length <= 6, `가로선 픽셀 ${ys.join(',')}`);
  assert.ok(Math.max(...ys) - Math.min(...ys) <= 4, `가로선이 한 무리 ${ys.join(',')}`);
});
