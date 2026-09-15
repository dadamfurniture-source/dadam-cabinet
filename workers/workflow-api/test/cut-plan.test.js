/**
 * B4: 스냅샷에 실린 재단 배치(cutPlan) 검증.
 *
 * 서버는 배치를 다시 계산하지 않는다 — 원판 규격·결·트림은 클라이언트(nesting-engine.js)가 안다.
 * 대신 형태와 BOM 정합만 본다: partId 가 자재 행에 있고 행별 개수 ≤ qty, 원판 안에 있고, 겹치지 않는다.
 * 컬럼 미적용 DB(PGRST204/42703)에서는 배치만 빼고 저장한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCutPlan,
  basePartId,
  isMissingCutPlanColumn,
  CUT_PLAN_COLUMNS,
  createSnapshot,
} from '../src/snapshots.js';
import { ValidationError, DbError, ConflictError } from '../src/supabase.js';

function bom() {
  return {
    materials: [
      { partId: '0-l1-body:side-0', part: '측판', material: 'PB', thickness: 15, w: 550, h: 720, qty: 2 },
      { partId: '0-l1-door#0-0', part: '도어', material: 'MDF', thickness: 18, w: 396, h: 716, qty: 1 },
      { part: '선반', material: 'PB', thickness: 15, w: 500, h: 300, qty: 1 }, // partId 없는 옛 행 → row-2
    ],
  };
}

function goodPlan() {
  return {
    version: 1,
    sheetSize: { w: 1220, h: 2440 },
    kerf: 4,
    trim: 10,
    sheets: [
      {
        no: 1, material: 'PB', thickness: 15, partClass: '본체', size: { w: 1220, h: 2440 },
        layout: { no: 1, stack: 1, index: 1, dir: 'H', rotated: false },
        parts: [
          { partId: '0-l1-body:side-0#0', w: 550, h: 720, x: 10, y: 10, rot: false, grain: 'none' },
          { partId: '0-l1-body:side-0#1', w: 550, h: 720, x: 564, y: 10, rot: false, grain: 'none' },
          { partId: 'row-2#0', w: 500, h: 300, x: 10, y: 734, rot: false, grain: 'none' },
        ],
        usedArea: 942000, yield: 0.3165,
      },
      {
        no: 2, material: 'MDF', thickness: 18, partClass: '도어', size: { w: 1220, h: 2440 },
        layout: { no: 1, stack: 1, index: 1, dir: 'H', rotated: true },
        // rot: 부재 396×716 을 눕혀 발자국 716×396
        parts: [{ partId: '0-l1-door#0-0#0', w: 396, h: 716, x: 10, y: 10, rot: true, grain: 'none' }],
        usedArea: 283536, yield: 0.0952,
      },
    ],
    offcuts: [{ sheetNo: 1, kind: 'sheet', x: 10, y: 1038, w: 1200, h: 1392, free: 1392 }],
    summary: { sheetsByMaterial: { PB_15: 1, MDF_18: 1 }, sheetCount: 2, totalYield: 0.2 },
  };
}

test('basePartId — 마지막 #숫자만 뗀다 (partId 안의 door#0 은 남긴다)', () => {
  assert.equal(basePartId('0-l1-door#0-0#3'), '0-l1-door#0-0');
  assert.equal(basePartId('0-l1-body:side-0#0'), '0-l1-body:side-0');
  assert.equal(basePartId('0-l1-door#0'), '0-l1-door');
  assert.equal(basePartId('plain'), 'plain');
  assert.equal(basePartId('a#b'), 'a#b');
});

test('배치가 없으면 null — 선택 사항', () => {
  assert.equal(validateCutPlan(undefined, bom()), null);
  assert.equal(validateCutPlan(null, bom()), null);
});

test('정상 배치 통과 — sheetCount 는 sheets 길이', () => {
  const out = validateCutPlan(goodPlan(), bom());
  assert.equal(out.sheetCount, 2);
  assert.equal(out.cutPlan.sheets.length, 2);
});

test('version 이 1 이 아니면 422', () => {
  const p = goodPlan();
  p.version = 2;
  assert.throws(() => validateCutPlan(p, bom()), ValidationError);
  assert.throws(() => validateCutPlan([], bom()), ValidationError);
  assert.throws(() => validateCutPlan('x', bom()), ValidationError);
});

test('sheets 가 배열이 아니면 422', () => {
  const p = goodPlan();
  p.sheets = {};
  assert.throws(() => validateCutPlan(p, bom()), ValidationError);
});

test('BOM 에 없는 partId 는 422 — 자재 행과 배치가 어긋났다', () => {
  const p = goodPlan();
  p.sheets[0].parts[0].partId = '9-zz-body:side-0#0';
  assert.throws(
    () => validateCutPlan(p, bom()),
    (e) => e instanceof ValidationError && e.details.some((d) => /bom\.materials 에 없음/.test(d)),
  );
});

test('행별 배치 개수가 qty 를 넘으면 422', () => {
  const p = goodPlan();
  p.sheets[0].parts.push({ partId: '0-l1-body:side-0#2', w: 550, h: 720, x: 10, y: 1100, rot: false });
  assert.throws(
    () => validateCutPlan(p, bom()),
    (e) => e instanceof ValidationError && e.details.some((d) => /배치 3개 > 수량 2/.test(d)),
  );
});

test('qty 보다 적게 놓인 것은 허용 — 원판보다 큰 부재는 미배치로 남는다', () => {
  const p = goodPlan();
  p.sheets[0].parts.pop(); // row-2 를 빼도 통과
  assert.doesNotThrow(() => validateCutPlan(p, bom()));
});

test('같은 시트에서 겹치면 422', () => {
  const p = goodPlan();
  p.sheets[0].parts[1].x = 300; // 첫 측판(10..560) 위로
  assert.throws(
    () => validateCutPlan(p, bom()),
    (e) => e instanceof ValidationError && e.details.some((d) => /겹침/.test(d)),
  );
});

test('원판을 벗어나면 422 — rot 을 반영한 발자국으로 본다', () => {
  const p = goodPlan();
  // 도어 396×716 을 rot 으로 눕히면 발자국 716×396: x=600 이면 1316 > 1220
  p.sheets[1].parts[0].x = 600;
  assert.throws(
    () => validateCutPlan(p, bom()),
    (e) => e instanceof ValidationError && e.details.some((d) => /벗어남/.test(d)),
  );
  // rot 을 풀면 396 너비라 들어간다
  p.sheets[1].parts[0].rot = false;
  assert.doesNotThrow(() => validateCutPlan(p, bom()));
});

test('시트 no 중복·치수 0·material 공백은 422', () => {
  let p = goodPlan();
  p.sheets[1].no = 1;
  assert.throws(() => validateCutPlan(p, bom()), (e) => e instanceof ValidationError && e.details.some((d) => /중복/.test(d)));
  p = goodPlan();
  p.sheets[0].size.w = 0;
  assert.throws(() => validateCutPlan(p, bom()), (e) => e instanceof ValidationError && e.details.some((d) => /size/.test(d)));
  p = goodPlan();
  p.sheets[0].material = '';
  assert.throws(() => validateCutPlan(p, bom()), (e) => e instanceof ValidationError && e.details.some((d) => /material/.test(d)));
});

test('문자열 좌표·치수도 받는다 (UI 가 문자열을 넣는 경우가 흔함)', () => {
  const p = goodPlan();
  p.sheets[0].parts[0].x = '10';
  p.sheets[0].parts[0].w = '550';
  assert.doesNotThrow(() => validateCutPlan(p, bom()));
});

// ── 컬럼 미적용 DB 감지 ─────────────────────────────────────────
test('isMissingCutPlanColumn — PGRST204/42703 + 컬럼 이름일 때만', () => {
  assert.deepEqual(CUT_PLAN_COLUMNS, ['cut_plan_payload', 'sheet_count']);
  assert.ok(isMissingCutPlanColumn(new DbError(`Supabase 400: {"code":"PGRST204","message":"Could not find the 'cut_plan_payload' column of 'design_snapshots' in the schema cache"}`, 400)));
  assert.ok(isMissingCutPlanColumn(new DbError('Supabase 400: {"code":"42703","message":"column design_snapshots.sheet_count does not exist"}', 400)));
  assert.equal(isMissingCutPlanColumn(new DbError('Supabase 400: {"code":"PGRST204","message":"Could not find the \'other\' column"}', 400)), false);
  assert.equal(isMissingCutPlanColumn(new DbError('Supabase 500: boom', 500)), false);
  assert.equal(isMissingCutPlanColumn(new ConflictError('23505 cut_plan_payload')), false);
  assert.equal(isMissingCutPlanColumn(new Error('PGRST204 cut_plan_payload')), false);
});

// ── createSnapshot 이 INSERT 하는 행 ─────────────────────────────
// PostgREST 경로별로 응답을 돌려주는 가짜 fetch. POST 본문을 기록한다.
function withFakeSupabase(fn, { missingColumnOnce = false } = {}) {
  const original = globalThis.fetch;
  const posts = [];
  let failedOnce = false;
  const json = (rows, status = 200) => ({
    ok: true, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows),
  });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    if (method === 'POST' && /\/design_snapshots$/.test(u.split('?')[0])) {
      const body = JSON.parse(init.body);
      if (missingColumnOnce && !failedOnce) {
        failedOnce = true;
        return {
          ok: false, status: 400, headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({ code: 'PGRST204', message: "Could not find the 'cut_plan_payload' column of 'design_snapshots' in the schema cache" }),
        };
      }
      posts.push(body);
      return json([{ id: 'S1', created_at: '2026-09-15T00:00:00Z', ...body }], 201);
    }
    if (/\/designs\?/.test(u)) return json([{ id: 'D1', user_id: 'U1', title: '테스트 설계' }]);
    if (/\/pricing_rule_sets\?/.test(u)) return json([{ id: 'RS1', name: 'seed', is_active: true }]);
    if (/\/pricing_rules\?/.test(u)) return json([]);
    if (/\/design_snapshots\?/.test(u)) return json([]); // 해시 조회·rev 조회 모두 빈 결과
    throw new Error('unexpected fetch ' + method + ' ' + u);
  };
  return Promise.resolve(fn(posts)).finally(() => { globalThis.fetch = original; });
}

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const USER = { id: 'U1' };

function snapshotBody(cutPlan) {
  const b = {
    design: { items: [{ categoryId: 'sink', w: 2400, modules: [{ pos: 'lower', type: 'sink', w: 900 }] }] },
    bom: bom(),
    hardware: {},
  };
  if (cutPlan !== undefined) b.cutPlan = cutPlan;
  return b;
}

test('createSnapshot — cutPlan 을 cut_plan_payload 로, 장수를 sheet_count 로 넣는다', async () => {
  await withFakeSupabase(async (posts) => {
    const { snapshot, reused } = await createSnapshot(ENV, { designId: 'D1', user: USER, body: snapshotBody(goodPlan()) });
    assert.equal(reused, false);
    assert.equal(posts.length, 1);
    const row = posts[0];
    assert.equal(row.design_id, 'D1');
    assert.equal(row.rev, 1);
    assert.equal(row.panel_count, 4, 'Σqty = 2+1+1');
    assert.equal(row.sheet_count, 2);
    assert.equal(row.cut_plan_payload.version, 1);
    assert.equal(row.cut_plan_payload.sheets.length, 2);
    assert.equal(snapshot.sheet_count, 2);
  });
});

test('createSnapshot — cutPlan 이 없으면 두 컬럼은 NULL (배치 안 함 ≠ 0장)', async () => {
  await withFakeSupabase(async (posts) => {
    await createSnapshot(ENV, { designId: 'D1', user: USER, body: snapshotBody(undefined) });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].cut_plan_payload, null);
    assert.equal(posts[0].sheet_count, null);
  });
});

test('createSnapshot — 어긋난 cutPlan 은 INSERT 전에 422', async () => {
  await withFakeSupabase(async (posts) => {
    const bad = goodPlan();
    bad.sheets[0].parts[0].partId = 'nope#0';
    await assert.rejects(
      () => createSnapshot(ENV, { designId: 'D1', user: USER, body: snapshotBody(bad) }),
      ValidationError,
    );
    assert.equal(posts.length, 0, 'INSERT 가 나가면 안 된다');
  });
});

test('createSnapshot — 컬럼 미적용 DB(PGRST204)면 배치만 빼고 저장한다', async () => {
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    await withFakeSupabase(async (posts) => {
      const { snapshot } = await createSnapshot(ENV, { designId: 'D1', user: USER, body: snapshotBody(goodPlan()) });
      assert.equal(posts.length, 1, '두 번째 시도만 기록된다');
      assert.ok(!('cut_plan_payload' in posts[0]), 'cut_plan_payload 를 빼고 보낸다');
      assert.ok(!('sheet_count' in posts[0]), 'sheet_count 를 빼고 보낸다');
      assert.equal(posts[0].panel_count, 4, '나머지 행은 그대로');
      assert.equal(snapshot.id, 'S1');
      assert.ok(warned.some((w) => /workflow-cut-plan\.sql/.test(w)), '적용할 SQL 파일을 로그로 알린다');
    }, { missingColumnOnce: true });
  } finally {
    console.warn = warn;
  }
});
