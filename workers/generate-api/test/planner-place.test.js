/**
 * 플래너 도면 덩어리 (2026-10-20, src/planner-place.js). 값은 design_spec 에서만, 카메라는 kitchen.js 가 푼다.
 * 가상 방(답을 아는 카메라)으로 도면 줄이 늘지 않고 제 자리에 칠해지는지 본다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import encodeJpeg from 'jpeg-js/lib/encoder.js';
import { inflateSync } from 'node:zlib';
import { parseKitchenPoints, renderFacesMassing, solveKitchenCamera } from '../src/kitchen.js';
import { plannerPlaceBlocks, plannerPlaceFaces } from '../src/planner-place.js';
import { buildPlannerPrompt } from '../src/prompts.js';

/** 가상 방 — kitchen.test.js 와 같은 카메라. 왼쪽 끝(-1800)이 런의 왼쪽 모서리, 오른쪽 옆벽(1800) */
function virtualRoom({
  W = 1600,
  H = 1200,
  f = 1000,
  hf = 1450,
  D = 4200,
  yawDeg = 10,
  wallH = 2400,
} = {}) {
  const t = (yawDeg * Math.PI) / 180;
  const r1 = [Math.cos(t), 0, Math.sin(t)];
  const r2 = [0, 1, 0];
  const r3 = [-Math.sin(t), 0, Math.cos(t)];
  const proj = (X, h, z) => {
    const c = [0, 1, 2].map((i) => X * r1[i] + (hf - h) * r2[i] + (D - z) * r3[i]);
    return [(f * c[0]) / c[2] + W / 2, (f * c[1]) / c[2] + H / 2];
  };
  const L = -1800,
    R = 1800;
  const json = {
    back_floor: [proj(-1400, 0, 0), proj(1400, 0, 0)],
    back_ceiling: [proj(-1400, wallH, 0), proj(1400, wallH, 0)],
    left_end: { floor: proj(L, 0, 0), ceiling: proj(L, wallH, 0), side_wall: true },
    right_end: { floor: proj(R, 0, 0), ceiling: proj(R, wallH, 0), side_wall: true },
    side_floor: [proj(R, 0, 0), proj(R, 0, 1200)],
    side_ceiling: [proj(R, wallH, 0), proj(R, wallH, 1200)],
  };
  return { json, size: { width: W, height: H }, L, proj };
}

/** 싱크대 2200 — 하부 800·400·1000 (깊이 600, 높이 870), 상부 900·900 (깊이 350, 바닥에서 1500) */
const spec = (over = {}) => ({
  wallRunMm: 2200,
  ceilingMm: 2400,
  layout: { shape: 'straight' },
  sections: {
    lower: {
      widthMm: 2200,
      heightMm: 870,
      depthMm: 600,
      fromLeftMm: 0,
      fromFloorMm: 0,
      modules: [
        { widthMm: 800, kind: 'door', doorCount: 2 },
        { widthMm: 400, kind: 'door', doorCount: 1 },
        { widthMm: 1000, kind: 'door', doorCount: 2 },
      ],
    },
    upper: {
      widthMm: 1800,
      heightMm: 900,
      depthMm: 350,
      fromLeftMm: 0,
      fromFloorMm: 1500,
      modules: [
        { widthMm: 900, kind: 'door', doorCount: 2 },
        { widthMm: 900, kind: 'door', doorCount: 2 },
      ],
    },
  },
  ...over,
});

test('덩어리: 도면 값 그대로 — 폭·높이·깊이·바닥 높이, 모듈 경계', () => {
  const p = plannerPlaceBlocks(spec());
  assert.equal(p.runMm, 2200);
  const lower = p.blocks.find((b) => b.key === 'lower');
  assert.deepEqual(
    [lower.x0, lower.x1, lower.bottom, lower.top, lower.depth],
    [0, 2200, 0, 870, 600]
  );
  assert.deepEqual(lower.cuts, [800, 1200]);
  const upper = p.blocks.find((b) => b.key === 'upper');
  assert.deepEqual([upper.bottom, upper.top, upper.depth], [1500, 2400, 350]);
});

test('덩어리: 모르는 값은 칠하지 않는다 — 깊이 없음 · 바닥 높이 모르는 상부장 · 꺾인 벽 · ㄱ자', () => {
  const noDepth = spec();
  delete noDepth.sections.upper.depthMm;
  assert.deepEqual(
    plannerPlaceBlocks(noDepth).blocks.map((b) => b.key),
    ['lower']
  );
  const noFloor = spec({ ceilingMm: undefined });
  delete noFloor.sections.upper.fromFloorMm;
  assert.deepEqual(
    plannerPlaceBlocks(noFloor).blocks.map((b) => b.key),
    ['lower']
  );
  // 높이 기준이 하나도 없으면 하부장 바닥도 모른다 (prompts.js plannerHeights 와 같은 규칙)
  const none = spec({ ceilingMm: undefined });
  delete none.sections.lower.fromFloorMm;
  delete none.sections.upper.fromFloorMm;
  assert.equal(plannerPlaceBlocks(none), null);
  assert.equal(plannerPlaceBlocks(spec({ layout: { shape: 'corner', walls: 2 } })), null);
  assert.equal(
    plannerPlaceBlocks(
      spec({ walls: [{ side: 'left', sections: { lower: { modules: [{ widthMm: 600 }] } } }] })
    ),
    null
  );
});

test('덩어리: 후드 칸은 비워 둔다', () => {
  const s = spec();
  s.sections.upper.modules = [
    { widthMm: 800, kind: 'door', doorCount: 2 },
    { widthMm: 600, kind: 'appliance', label: '후드' },
    { widthMm: 400, kind: 'door', doorCount: 1 },
  ];
  const upper = plannerPlaceBlocks(s).blocks.find((b) => b.key === 'upper');
  assert.deepEqual(upper.holes, [[800, 1400]]);
  const v = virtualRoom();
  const cam = solveKitchenCamera(parseKitchenPoints(v.json, v.size), v.size.width, v.size.height, {
    wallH: 2400,
  });
  const fronts = plannerPlaceFaces(cam, plannerPlaceBlocks(s)).filter((f) => f.kind === 'front');
  assert.equal(fronts.length, 3, '하부 1 + 상부 2 (후드 칸 양옆)');
});

test('가상 방: 줄 끝이 도면 길이에서 끝난다 — 벽에 맞춰 늘리지 않는다', () => {
  const v = virtualRoom();
  const cam = solveKitchenCamera(parseKitchenPoints(v.json, v.size), v.size.width, v.size.height, {
    wallH: 2400,
  });
  assert.ok(cam, '풀린다');
  const faces = plannerPlaceFaces(cam, plannerPlaceBlocks(spec()));
  const front = faces.find((f) => f.kind === 'front' && f.pts[0][1] === 870); // 하부장 앞면 (윗변 870)
  const xs = front.pts.map((p) => p[0]);
  const run = Math.max(...xs) - Math.min(...xs);
  assert.ok(Math.abs(run - 2200) < 1e-6, `run ${run}`);
  // 오른쪽 위 모서리가 참 카메라의 (L+2200, 870, 600) 과 몇 px 안
  const p = cam.project(Math.max(...xs), 870, 600);
  const q = v.proj(v.L + 2200, 870, 600);
  assert.ok(Math.hypot(p.x - q[0], p.y - q[1]) < 12, `${p.x},${p.y} vs ${q}`);
  // 먼 면부터 — 문짝 경계(gap)는 맨 뒤에 칠한다
  const kinds = faces.map((f) => f.kind);
  assert.ok(kinds.lastIndexOf('front') < kinds.indexOf('gap'));
});

test('가상 방: 런이 사진의 벽보다 넓으면 사진이 이긴다 — 벽 폭으로 줄인다', () => {
  const v = virtualRoom();
  const cam = solveKitchenCamera(parseKitchenPoints(v.json, v.size), v.size.width, v.size.height, {
    wallH: 2400,
  });
  const wide = spec({ wallRunMm: 5000 });
  wide.sections.lower.widthMm = 5000;
  wide.sections.lower.modules = [{ widthMm: 2500 }, { widthMm: 2500 }];
  const front = plannerPlaceFaces(cam, plannerPlaceBlocks(wide)).find(
    (f) => f.kind === 'front' && f.pts[0][1] === 870
  );
  const xs = front.pts.map((p) => p[0]);
  assert.ok(Math.abs(Math.max(...xs) - cam.xR) < 1e-6 && Math.abs(Math.min(...xs) - cam.xL) < 1e-6);
});

function solid(w, h, rgb) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return {
    base64: Buffer.from(encodeJpeg({ data, width: w, height: h }, 95).data).toString('base64'),
    mimeType: 'image/jpeg',
  };
}
function pngPixels(b64, w) {
  const png = Buffer.from(b64, 'base64');
  const chunks = [];
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o);
    if (png.toString('ascii', o + 4, o + 8) === 'IDAT')
      chunks.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  return (x, y) => {
    const o = y * (w * 3 + 1) + 1 + x * 3;
    return [raw[o], raw[o + 1], raw[o + 2]];
  };
}

test('칠하기: 하부장 앞면은 밝은 판, 도면 줄 끝 오른쪽 벽은 사진 그대로', async () => {
  const v = virtualRoom();
  const room = solid(1600, 1200, [128, 128, 128]);
  const place = plannerPlaceBlocks(spec());
  const r = await renderFacesMassing(
    room,
    parseKitchenPoints(v.json, v.size),
    { wallH: 2400, focalMm: 24 },
    (cam) => plannerPlaceFaces(cam, place),
    ['front']
  );
  assert.ok(r, '그려진다');
  const px = pngPixels(r.base64, 1600);
  const at = (X, h, z) => {
    const q = v.proj(X, h, z);
    return px(Math.round(q[0]), Math.round(q[1]));
  };
  assert.ok(
    at(v.L + 600, 450, 600).every((c) => c > 190),
    '하부장 앞면'
  );
  assert.ok(
    at(v.L + 450, 1950, 350).every((c) => c > 190),
    '상부장 앞면'
  );
  assert.ok(
    at(v.L + 3000, 450, 0).every((c) => Math.abs(c - 128) < 8),
    '줄 끝 오른쪽 벽'
  );
});

test('프롬프트: 도면 덩어리가 있으면 IMAGE A 가 그 자리를 지키라고 말하고, 없으면 예전 문장', () => {
  const c = {
    category: 'sink',
    wallW: 3600,
    wallH: 2400,
    confidence: 0.8,
    designSpec: spec(),
    aspect: '16:9',
  };
  const off = buildPlannerPrompt(c);
  const on = buildPlannerPrompt({ ...c, placeGuide: true });
  assert.match(
    off,
    /IMAGE A — ROOM PHOTO: the customer's real room\. Edit this photo only inside the EDIT ZONE below\./
  );
  assert.match(
    on,
    /already painted in as plain off-white blocks at their exact position, size and depth/
  );
  assert.match(on, /do not stretch, move or extend any run/);
  assert.equal(
    on.replace(/IMAGE A — [^\n]*/, ''),
    off.replace(/IMAGE A — [^\n]*/, ''),
    'IMAGE A 줄만 다르다'
  );
});

// ─── 잡 흐름 ───

const ROW_ID = '88888888-8888-4888-8888-888888888888';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ENV = {
  GEMINI_API_KEY: 'g',
  GEMINI_RETRY_DELAYS_MS: '0',
  ANTHROPIC_API_KEY: 'sk-ant',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
};
const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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

async function runPlannerJob({ flag, existing = null }) {
  const { GenerateJob } = await import('../src/job.js');
  const v = virtualRoom();
  // 선 찾기 바탕은 긴 변 1024 로 줄인 그림 (1600 → 1024) — 답도 그 픽셀로
  const k = 1024 / 1600;
  const sc = (p) => [p[0] * k, p[1] * k];
  const j = v.json;
  const points = {
    back_floor: j.back_floor.map(sc),
    back_ceiling: j.back_ceiling.map(sc),
    left_end: { ...j.left_end, floor: sc(j.left_end.floor), ceiling: sc(j.left_end.ceiling) },
    right_end: { ...j.right_end, floor: sc(j.right_end.floor), ceiling: sc(j.right_end.ceiling) },
    side_floor: j.side_floor.map(sc),
    side_ceiling: j.side_ceiling.map(sc),
  };
  const roomJpeg = Buffer.from(solid(1600, 1200, [128, 128, 128]).base64, 'base64');
  const seen = { lines: 0, uploads: [], install: null };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.anthropic.com/')) {
      const body = JSON.parse(init.body);
      const text = JSON.stringify(body).includes('Find lines and corners')
        ? (seen.lines++, JSON.stringify(points))
        : '{}';
      return jsonRes({
        id: 'm',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-5-5',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    }
    if (u.includes('/storage/v1/object/')) {
      if ((init.method || 'GET') === 'POST') {
        seen.uploads.push(u.split('/generations/')[1]);
        return jsonRes({ Key: 'ok' });
      }
      return new Response(roomJpeg, { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (u.includes('/rest/v1/generations')) {
      if ((init.method || 'GET') === 'GET') return jsonRes([{ id: ROW_ID, options: {} }]);
      return jsonRes([{ id: ROW_ID }]);
    }
    const body = JSON.parse(init.body);
    const parts = body.contents[0].parts;
    const prompt = parts.at(-1).text;
    if (body.generationConfig.responseModalities.length === 1) {
      const text = prompt.startsWith('Measure and describe')
        ? JSON.stringify({
            wall_width_mm: 3600,
            wall_height_mm: 2400,
            confidence: 'medium',
            site_condition: 'finished',
            existing_furniture: existing,
          })
        : JSON.stringify({ ok: true, issues: [], note: 'n' });
      return jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
    }
    seen.install = {
      prompt,
      mimes: parts.filter((p) => p.inlineData).map((p) => p.inlineData.mimeType),
    };
    return jsonRes({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: { mimeType: 'image/png', data: Buffer.from('OUT').toString('base64') },
              },
            ],
          },
        },
      ],
    });
  };
  try {
    const job = new GenerateJob(fakeState(), {
      ...ENV,
      ...(flag ? { PLANNER_PLACE_GUIDE: flag } : {}),
    });
    await job.fetch(
      new Request('https://generate-job/start', {
        method: 'POST',
        body: JSON.stringify({
          id: ROW_ID,
          userId: USER_ID,
          creditRef: 'c',
          category: 'sink',
          options: {
            mode: 'planner',
            variants: false,
            image_provider: 'gemini',
            aspect: '4:3',
            design_spec: spec(),
          },
          inputs: {
            room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' },
            refs: [],
            renders: [
              {
                role: 'elevation',
                path: `${USER_ID}/${ROW_ID}/render-elevation.png`,
                url: 'u',
                mime: 'image/png',
              },
            ],
          },
          startedAt: Date.now(),
        }),
      })
    );
    await job.alarm();
  } finally {
    globalThis.fetch = realFetch;
  }
  return seen;
}

test('잡: 스위치를 켜면 빈 벽 사진에 도면 덩어리를 칠해 IMAGE A 로 준다', async () => {
  const seen = await runPlannerJob({ flag: 'on' });
  assert.equal(seen.lines, 1, '선 찾기 한 번');
  assert.ok(seen.uploads.some((p) => p.endsWith('/place.png')));
  assert.equal(seen.install.mimes[0], 'image/png', '칠한 그림(PNG)이 첫 장');
  assert.match(seen.install.prompt, /already painted in as plain off-white blocks/);
});

test('잡: 스위치가 꺼져 있거나 기존 가구가 있으면 예전 그대로 — 방 사진이 IMAGE A', async () => {
  for (const o of [
    { flag: null },
    { flag: 'off' },
    { flag: 'on', existing: 'old dark cabinets' },
  ]) {
    const seen = await runPlannerJob(o);
    assert.equal(seen.lines, 0, JSON.stringify(o));
    assert.equal(seen.install.mimes[0], 'image/jpeg', JSON.stringify(o));
    assert.doesNotMatch(seen.install.prompt, /already painted in/);
  }
});
