/**
 * 플래너 도면 덩어리 (2026-10-20, src/planner-place.js). 값은 design_spec 에서만, 카메라는 kitchen.js 가 푼다.
 * 가상 방(답을 아는 카메라)으로 도면 줄이 늘지 않고 제 자리에 칠해지는지 본다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import encodeJpeg from 'jpeg-js/lib/encoder.js';
import { inflateSync } from 'node:zlib';
import { parseKitchenPoints, renderFacesMassing, solveKitchenCamera } from '../src/kitchen.js';
import { plannerPlaceBlocks, plannerPlaceFaces, plannerPlaceRef } from '../src/planner-place.js';
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

async function runPlannerJob({ flag, existing = null, design = spec(), extraEnv = {}, extraOpts = {} }) {
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
  const seen = { lines: 0, uploads: [], install: null, place: undefined };
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
      // 행에 복사된 wall_analysis.place (ck.place 전체) — 마지막 것
      const patch = init.body ? JSON.parse(init.body) : {};
      if (patch.wall_analysis && 'place' in patch.wall_analysis) seen.place = patch.wall_analysis.place;
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
      ...extraEnv,
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
            design_spec: design,
            ...extraOpts,
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

// ─── ㄱ자·ㄷ자 (2026-10-20, 스위치 PLANNER_PLACE_CORNERS) ───

/** ㄱ자 — 주벽 하부 2400 (왼쪽 모서리까지), 왼쪽 벽 하부 1200 (주벽 하부 앞에서, fromCornerMm 600) */
const cornerSpec = ({ side = 'left', corner = 'main', retWidth = 1200 } = {}) => {
  const s = spec({ wallRunMm: 2400, layout: { shape: 'corner', walls: 2 } });
  s.sections.lower.widthMm = 2400;
  s.sections.lower.modules = [{ widthMm: 1200 }, { widthMm: 1200 }];
  s.walls = [
    {
      side,
      corner,
      runMm: 600 + retWidth,
      cornerEdge: 'right',
      sections: {
        lower: {
          widthMm: retWidth,
          heightMm: 870,
          depthMm: 600,
          fromCornerMm: 600,
          fromFloorMm: 0,
          modules: [{ widthMm: retWidth / 2 }, { widthMm: retWidth / 2 }],
        },
      },
    },
  ];
  return s;
};

test('ㄱ자 덩어리: 스위치 없이는 예전처럼 칠하지 않고, 켜면 꺾인 줄을 모서리에서 잰다', () => {
  assert.equal(plannerPlaceBlocks(cornerSpec()), null);
  const p = plannerPlaceBlocks(cornerSpec(), { corners: true });
  assert.equal(p.anchor, 'left');
  assert.equal(p.runMm, 2400);
  assert.deepEqual(
    p.returns.map((b) => [b.wall, b.key, b.x0, b.x1, b.depth, b.cuts]),
    [['left', 'lower', 600, 1800, 600, [1200]]]
  );
  // 일자 도면은 스위치와 상관없이 그대로
  assert.deepEqual(plannerPlaceBlocks(spec(), { corners: true }), plannerPlaceBlocks(spec()));
});

test('ㄱ자 덩어리: 주벽 줄이 붙는 끝을 모르면 칠하지 않는다 — 오른쪽 꺾임 return·open, 펴진 ㄱ자, 일자인데 walls[]', () => {
  assert.equal(
    plannerPlaceBlocks(cornerSpec({ side: 'right', corner: 'return' }), { corners: true }),
    null
  );
  assert.equal(
    plannerPlaceBlocks(cornerSpec({ side: 'right', corner: 'open' }), { corners: true }),
    null
  );
  const r = plannerPlaceBlocks(cornerSpec({ side: 'right', corner: 'main' }), { corners: true });
  assert.equal(r.anchor, 'right');
  assert.equal(r.rightMm, 2400, '주벽 바닥 줄 오른끝 = 오른쪽 벽 면');
  // walls[] 없이 펴서 온 ㄱ자는 접는 자리를 모른다
  assert.equal(
    plannerPlaceBlocks(spec({ layout: { shape: 'corner', walls: 2 } }), { corners: true }),
    null
  );
  const contra = cornerSpec();
  contra.layout = { shape: 'straight' };
  assert.equal(plannerPlaceBlocks(contra, { corners: true }), null);
});

/** 가상 방의 참 초점거리 (f 1000 px, 대각선 2000 px → 35mm 환산). 꺾인 줄은 깊이 방향이라 초점거리가 틀리면 끝이 샌다 */
const TRUE_FOCAL = (1000 / 2000) * 43.27;

const solved = (json = virtualRoom().json) => {
  const v = virtualRoom();
  return solveKitchenCamera(parseKitchenPoints(json, v.size), v.size.width, v.size.height, {
    wallH: 2400,
    focalMm: TRUE_FOCAL,
  });
};

test('가상 방 ㄱ자: 꺾인 줄은 왼쪽 벽에 붙어 깊이만큼 나오고 모서리에서 도면 길이만큼 간다', () => {
  const v = virtualRoom();
  const cam = solved();
  assert.ok(cam.leftWall && cam.rightWall);
  const faces = plannerPlaceFaces(cam, plannerPlaceBlocks(cornerSpec(), { corners: true }));
  const front = faces.find((f) => f.kind === 'front' && f.normal[0] === 1);
  assert.ok(front, '꺾인 줄 앞면이 보인다');
  const xs = front.pts.map((p) => p[0]);
  const zs = front.pts.map((p) => p[2]);
  assert.ok(
    xs.every((x) => Math.abs(x - (cam.xL + 600)) < 1e-6),
    '앞면 = 왼쪽 벽 면 + 깊이 600'
  );
  assert.deepEqual([Math.min(...zs), Math.max(...zs)], [600, 1800]);
  // 방 쪽 끝 윗 모서리가 참 카메라의 (L+600, 870, 1800) 과 몇 px 안
  const p = cam.project(cam.xL + 600, 870, 1800);
  const q = v.proj(v.L + 600, 870, 1800);
  assert.ok(Math.hypot(p.x - q[0], p.y - q[1]) < 15, `${p.x},${p.y} vs ${q}`);
  // 주벽 줄은 일자와 똑같이 왼쪽 모서리에서 2400
  const main = faces.find((f) => f.kind === 'front' && f.normal[2] === 1 && f.pts[0][1] === 870);
  const mx = main.pts.map((pt) => pt[0]);
  assert.ok(
    Math.abs(Math.min(...mx) - cam.xL) < 1e-6 && Math.abs(Math.max(...mx) - (cam.xL + 2400)) < 1e-6
  );
  // 꺾인 줄 경계(1200)는 앞면 위 얇은 띠
  const gap = faces.find((f) => f.kind === 'gap' && f.normal[0] === 1);
  assert.deepEqual(
    [Math.min(...gap.pts.map((pt) => pt[2])), Math.max(...gap.pts.map((pt) => pt[2]))],
    [1197, 1203]
  );
});

test('가상 방 ㄱ자 오른쪽: 주벽 줄 오른끝이 오른쪽 벽 면, 꺾인 줄은 오른쪽 벽에서 나온다', () => {
  const cam = solved();
  const faces = plannerPlaceFaces(
    cam,
    plannerPlaceBlocks(cornerSpec({ side: 'right', corner: 'main' }), { corners: true })
  );
  const main = faces.find((f) => f.kind === 'front' && f.normal[2] === 1 && f.pts[0][1] === 870);
  const mx = main.pts.map((pt) => pt[0]);
  assert.ok(
    Math.abs(Math.max(...mx) - cam.xR) < 1e-6 && Math.abs(Math.min(...mx) - (cam.xR - 2400)) < 1e-6
  );
  const ret = faces.find((f) => f.kind === 'front' && f.normal[0] === -1);
  assert.ok(ret.pts.every((pt) => Math.abs(pt[0] - (cam.xR - 600)) < 1e-6));
});

test('가상 방 ㄱ자: 사진에 그 옆벽이 안 보이면 칠하지 않는다', () => {
  const j = virtualRoom().json;
  const cam = solved({ ...j, left_end: { ...j.left_end, side_wall: false } });
  assert.ok(cam && !cam.leftWall);
  assert.deepEqual(plannerPlaceFaces(cam, plannerPlaceBlocks(cornerSpec(), { corners: true })), []);
  // 일자는 예전 그대로 칠한다
  assert.ok(plannerPlaceFaces(cam, plannerPlaceBlocks(spec())).length);
});

test('가상 방 ㄱ자: 카메라 쪽으로 사진 밖까지 가는 꺾인 줄은 사진 끝에서 자르고, 잘린 끝엔 끝면이 없다', async () => {
  const v = virtualRoom();
  const cam = solved();
  const place = plannerPlaceBlocks(cornerSpec({ retWidth: 3800 }), { corners: true });
  const faces = plannerPlaceFaces(cam, place);
  const front = faces.find((f) => f.kind === 'front' && f.normal[0] === 1);
  const zMax = Math.max(...front.pts.map((p) => p[2]));
  assert.ok(zMax > 1800 && zMax < 4400, `잘린 끝 ${zMax}`);
  assert.ok(!faces.some((f) => f.kind === 'end' && f.normal[2] === 1 && f.pts[0][2] === zMax));
  const r = await renderFacesMassing(
    solid(1600, 1200, [128, 128, 128]),
    parseKitchenPoints(v.json, v.size),
    { wallH: 2400, focalMm: TRUE_FOCAL },
    (c) => plannerPlaceFaces(c, place),
    ['front']
  );
  assert.ok(r, '투영 검사를 통과해 그려진다');
});

test('칠하기 ㄱ자: 꺾인 줄 앞면은 밝은 판, 그 위 옆벽과 앞 바닥은 사진 그대로', async () => {
  const v = virtualRoom();
  const place = plannerPlaceBlocks(cornerSpec(), { corners: true });
  const r = await renderFacesMassing(
    solid(1600, 1200, [128, 128, 128]),
    parseKitchenPoints(v.json, v.size),
    { wallH: 2400, focalMm: TRUE_FOCAL },
    (cam) => plannerPlaceFaces(cam, place),
    ['front']
  );
  const px = pngPixels(r.base64, 1600);
  const at = (X, h, z) => {
    const q = v.proj(X, h, z).map(Math.round);
    assert.ok(q[0] >= 0 && q[0] < 1600 && q[1] >= 0 && q[1] < 1200, `사진 안 ${q}`);
    return px(q[0], q[1]);
  };
  assert.ok(
    at(v.L + 600, 450, 1300).every((c) => c > 190),
    '꺾인 줄 앞면'
  );
  assert.ok(
    at(v.L, 1200, 700).every((c) => Math.abs(c - 128) < 8),
    '꺾인 줄 위 옆벽'
  );
  assert.ok(
    at(v.L + 900, 0, 1300).every((c) => Math.abs(c - 128) < 8),
    '꺾인 줄 앞 바닥'
  );
});

test('프롬프트: 꺾인 벽이 있으면 덩어리를 "제 벽의 입면" 대로 그리라고 말한다', () => {
  const c = {
    category: 'sink',
    wallW: 3600,
    wallH: 2400,
    confidence: 0.8,
    aspect: '16:9',
    placeGuide: true,
  };
  assert.match(
    buildPlannerPrompt({ ...c, designSpec: cornerSpec() }),
    /as the real units its wall's elevation shows/
  );
  assert.match(buildPlannerPrompt({ ...c, designSpec: spec() }), /as the real units IMAGE B shows/);
});

test('잡 ㄱ자: PLANNER_PLACE_CORNERS 를 켜야 칠하고, 꺼져 있으면 예전 그대로', async () => {
  const on = await runPlannerJob({
    flag: 'on',
    design: cornerSpec(),
    extraEnv: { PLANNER_PLACE_CORNERS: 'on' },
  });
  assert.equal(on.lines, 1);
  assert.ok(on.uploads.some((p) => p.endsWith('/place.png')));
  assert.equal(on.install.mimes[0], 'image/png');
  for (const extraEnv of [{}, { PLANNER_PLACE_CORNERS: 'off' }]) {
    const off = await runPlannerJob({ flag: 'on', design: cornerSpec(), extraEnv });
    assert.equal(off.lines, 0, JSON.stringify(extraEnv));
    assert.equal(off.install.mimes[0], 'image/jpeg');
  }
});

test('가상 방 ㄷ자: 꺾인 줄이 양쪽 옆벽에 하나씩, 주벽 줄은 왼쪽 모서리에서', () => {
  const s = cornerSpec();
  s.layout = { shape: 'u', walls: 3 };
  s.walls.push({ ...cornerSpec({ side: 'right' }).walls[0], side: 'right' });
  const p = plannerPlaceBlocks(s, { corners: true });
  assert.equal(p.anchor, 'left');
  assert.deepEqual(
    p.returns.map((b) => b.wall),
    ['left', 'right']
  );
  const cam = solved();
  const fronts = plannerPlaceFaces(cam, p).filter((f) => f.kind === 'front');
  const l = fronts.find((f) => f.normal[0] === 1);
  const r = fronts.find((f) => f.normal[0] === -1);
  assert.ok(l.pts.every((pt) => Math.abs(pt[0] - (cam.xL + 600)) < 1e-6));
  assert.ok(r.pts.every((pt) => Math.abs(pt[0] - (cam.xR - 600)) < 1e-6));
});

// ─── 칠한 기준 좌표 ck.place.ref (2026-10-20, 위치 검사 run_right_place 의 선행 조건) ───
//   좌표 관례는 position.js 와 같다 — 이미지 % 0~100 (toPct · img.CBL = px / W × 100), 소실점 x 도 % (uOfVh 의 vh[0]/W×100).

const refKeys = ['w', 'h', 'bl', 'br', 'fl', 'fr', 'wl', 'wr', 'vx'];
const inImage = (p) => p && p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;
const xy = (p) => ({ x: p.x, y: p.y });

test('ref 일자: 캔버스 크기 · 하부 줄 뒷선·앞선 양 끝 · 벽 모서리 · 벽 방향 소실점 — 참 카메라와 1 % 안', () => {
  const v = virtualRoom();
  const cam = solved();
  const place = plannerPlaceBlocks(spec());
  const ref = plannerPlaceRef(cam, place);
  assert.deepEqual(Object.keys(ref), refKeys);
  assert.deepEqual([ref.w, ref.h], [1600, 1200], '캔버스 = 2·cx × 2·cy');
  // X 는 앵커 기준 도면 mm (하부 줄 양 끝)
  assert.deepEqual([ref.bl.X, ref.br.X, ref.fl.X, ref.fr.X], [0, 2200, 0, 2200]);
  for (const k of ['bl', 'br', 'fl', 'fr', 'wl', 'wr']) assert.ok(inImage(ref[k]), `${k} ${JSON.stringify(ref[k])}`);
  // 참 카메라의 점과 비교 (이미지 %) — 뒷선 = 상판 높이 870 · 벽(z 0), 앞선 = 상판 앞 끝(z 600)
  const pct = (q) => ({ x: (q[0] / 1600) * 100, y: (q[1] / 1200) * 100 });
  const near = (p, q, tol = 1) => Math.hypot(p.x - q.x, p.y - q.y) < tol; // 1 % ≈ 16 px
  assert.ok(near(ref.bl, pct(v.proj(v.L, 870, 0))), `bl ${JSON.stringify(ref.bl)}`);
  assert.ok(near(ref.br, pct(v.proj(v.L + 2200, 870, 0))), `br ${JSON.stringify(ref.br)}`);
  assert.ok(near(ref.fl, pct(v.proj(v.L, 870, 600))), `fl ${JSON.stringify(ref.fl)}`);
  assert.ok(near(ref.fr, pct(v.proj(v.L + 2200, 870, 600))), `fr ${JSON.stringify(ref.fr)}`);
  // 벽 모서리는 뒷선 높이 — 왼쪽 앵커라 bl = wl, 오른쪽 벽(1800)은 줄 끝(400)보다 오른쪽
  assert.deepEqual(ref.wl, xy(ref.bl));
  assert.ok(near(ref.wr, pct(v.proj(1800, 870, 0))), `wr ${JSON.stringify(ref.wr)}`);
  assert.ok(ref.wr.x > ref.br.x);
  assert.ok(ref.fl.y > ref.bl.y, '앞선이 뒷선보다 아래 (카메라가 상판보다 높다)');
  // 벽 방향 소실점 — 요 10° 의 참값 x = f·cot(10°) + W/2 (이미지 오른쪽 멀리), %
  const vxTrue = ((1000 / Math.tan((10 * Math.PI) / 180) + 800) / 1600) * 100;
  assert.ok(Math.abs(ref.vx - vxTrue) < 0.1 * vxTrue, `vx ${ref.vx} vs ${vxTrue}`);
  // 소수 둘째 자리 · 정수 mm — 200 B 안팎
  assert.ok(JSON.stringify(ref).length < 260, JSON.stringify(ref));
  for (const k of refKeys.slice(2, 8)) {
    assert.equal(ref[k].x, Math.round(ref[k].x * 100) / 100, k);
    assert.equal(ref[k].y, Math.round(ref[k].y * 100) / 100, k);
  }
});

test('ref 일자: 런이 벽보다 넓으면 칠한 대로(벽 끝에서 끝) — X 는 도면 mm 그대로', () => {
  const cam = solved();
  const wide = spec({ wallRunMm: 5000 });
  wide.sections.lower.widthMm = 5000;
  wide.sections.lower.modules = [{ widthMm: 2500 }, { widthMm: 2500 }];
  const ref = plannerPlaceRef(cam, plannerPlaceBlocks(wide));
  assert.equal(ref.br.X, 5000);
  assert.deepEqual(xy(ref.br), ref.wr, '칠은 오른쪽 벽 면에서 끝난다');
});

test('ref ㄱ자: 주벽 하부 줄만 — 왼쪽 앵커는 왼쪽 벽 면에서, 오른쪽 앵커(corner main)는 오른쪽 벽 면에서 끝난다', () => {
  const cam = solved();
  const left = plannerPlaceRef(cam, plannerPlaceBlocks(cornerSpec(), { corners: true }));
  assert.deepEqual([left.bl.X, left.br.X], [0, 2400]);
  assert.deepEqual(xy(left.bl), left.wl);
  assert.ok(left.br.x < left.wr.x, '주벽 줄 2400 은 벽 3600 보다 짧다');
  const right = plannerPlaceRef(
    cam,
    plannerPlaceBlocks(cornerSpec({ side: 'right', corner: 'main' }), { corners: true })
  );
  assert.deepEqual([right.bl.X, right.br.X], [0, 2400], '도면 좌표 그대로 (앵커 기준)');
  assert.deepEqual(xy(right.br), right.wr, '오른끝 = 오른쪽 벽 면');
  assert.ok(right.bl.x > right.wl.x);
  // 꺾인 줄은 ref 에 없다 (주벽만)
  assert.deepEqual(Object.keys(left), refKeys);
});

test('ref: 하부 줄이 없으면(상부만·키큰장만) 없다 — null', () => {
  const cam = solved();
  const upperOnly = spec();
  delete upperOnly.sections.lower;
  const p = plannerPlaceBlocks(upperOnly);
  assert.deepEqual(p.blocks.map((b) => b.key), ['upper']);
  assert.equal(plannerPlaceRef(cam, p), null);
  const tallOnly = spec();
  delete tallOnly.sections.lower;
  delete tallOnly.sections.upper;
  tallOnly.sections.tall = { widthMm: 600, heightMm: 2200, depthMm: 600, fromLeftMm: 0, fromFloorMm: 0, modules: [{ widthMm: 600 }] };
  assert.equal(plannerPlaceRef(cam, plannerPlaceBlocks(tallOnly)), null);
  assert.equal(plannerPlaceRef(null, p), null);
  assert.equal(plannerPlaceRef(cam, null), null);
});

test('잡: 칠한 직후 ck.place.ref 를 저장하고 wall_analysis.place 복사본에도 들어간다', async () => {
  const seen = await runPlannerJob({ flag: 'on' });
  assert.ok(seen.place && seen.place.ref, 'wall_analysis.place.ref');
  const ref = seen.place.ref;
  assert.deepEqual(Object.keys(ref), refKeys);
  assert.deepEqual([ref.w, ref.h], [1600, 1200], '칠한 캔버스(원본 해상도) 크기');
  assert.deepEqual([ref.bl.X, ref.br.X], [0, 2200]);
  assert.ok(inImage(ref.bl) && inImage(ref.br) && inImage(ref.fl) && inImage(ref.fr));
  assert.ok(seen.place.cam && seen.place.path, '기존 필드는 그대로');
});

test('잡: 상부만 있는 도면은 칠하되 ref 키가 없다', async () => {
  const upperOnly = spec();
  delete upperOnly.sections.lower;
  const seen = await runPlannerJob({ flag: 'on', design: upperOnly });
  assert.ok(seen.place && seen.place.path, '칠했다');
  assert.equal('ref' in seen.place, false);
});

// ─── 요청 옵션 place_guide:false (2026-10-20) — 운영 변수 배포 없이 덩어리 안내를 끈 생성 ───

test('잡: options.place_guide === false 면 스위치가 켜져 있어도 칠하지 않는다 — 방 사진이 IMAGE A', async () => {
  const seen = await runPlannerJob({ flag: 'on', extraOpts: { place_guide: false } });
  assert.equal(seen.lines, 0, '선 찾기 없음');
  assert.equal(seen.place, undefined, 'ck.place 를 만들지 않는다');
  assert.ok(!seen.uploads.some((p) => p.endsWith('/place.png')));
  assert.equal(seen.install.mimes[0], 'image/jpeg');
  assert.doesNotMatch(seen.install.prompt, /already painted in/);
  // false 만 끈다 — true 는 지금과 같다
  const on = await runPlannerJob({ flag: 'on', extraOpts: { place_guide: true } });
  assert.equal(on.install.mimes[0], 'image/png');
});
