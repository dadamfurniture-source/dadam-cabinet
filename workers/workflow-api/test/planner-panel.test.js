/**
 * 간편 플래너 여러 업체 공통 줄 (src/planner-panel.js, DB 0069 — 2026-11-17 사장님 결정):
 *   넘어가는 것은 모듈 구성만 · 나를 빼고 3곳 이상 · 프로젝트에 이어진 설계만 · 업체가 모이기 전에는 본사가 고른 씨앗.
 *   줄 유전체 받기(학습 묶음과 같이) · 다시 묶기 · 내려주기 · 씨앗 표시. 가짜 DB 로만 (실제 DB 를 부르지 않는다)
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { putLearn } from '../src/planner-learn.js';
import {
  PANEL_MIN_COMPANIES,
  deleteSeed,
  genomeLinesOf,
  lineKeyOf,
  listSeeds,
  panelOf,
  putSeed,
  rebuildPanel,
  runDailyPanelRebuild,
  runPanelRebuild,
  saveDraftGenome,
} from '../src/planner-panel.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const PLATFORM = 'f0000000-0000-4000-8000-0000000000c1';
const HQ = 'f0000000-0000-4000-8000-0000000000aa';
const P = [1, 2, 3, 4, 5].map((i) => `f0000000-0000-4000-8000-0000000000b${i}`);
const BOSS = 'a0000000-0000-4000-8000-000000000001'; // 다담 본사 대표
const HQ_STAFF = 'a0000000-0000-4000-8000-000000000002'; // 다담 공장 직원
const STAFF = [1, 2, 3, 4, 5].map((i) => `a0000000-0000-4000-8000-00000000001${i}`); // 협력업체 직원
const u = (id) => ({ id });

/** 키큰장 맨 앞 + 가스대 앞 서랍 3단 / 개수대 뒤 서랍 3단 + 맨 뒤 오픈장 / 상부 플랩 */
const lineA = (w = 900) => ({
  k: 'floor',
  fx: ['sink', 'cooktop'],
  cells: [
    { l: ['TL-D1-600-L'], r: [], w },
    { l: [], r: ['LB-DR3-600'], w: 1000 },
    { l: [], r: [], w: 400 },
  ],
});
const LINE_B = {
  k: 'floor',
  fx: ['sink', 'cooktop'],
  cells: [
    { l: [], r: [], w: 800 },
    { l: ['LB-DR3-600'], r: [], w: 900 },
    { l: [], r: ['LB-OPEN-450'], w: 600 },
  ],
};
const LINE_S = {
  k: 'upper',
  fx: ['hood'],
  cells: [
    { l: ['UB-FLAP-450'], r: [], w: 900 },
    { l: [], r: [], w: 900 },
  ],
};
const DOORS_ONLY = {
  k: 'floor',
  fx: ['sink'],
  cells: [
    { l: [], r: [], w: 900 },
    { l: [], r: [], w: 900 },
  ],
};

const json = (rows, status = 200) => ({
  ok: status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => rows,
  text: async () => JSON.stringify(rows),
});

function makeDb({ panel = true } = {}) {
  return {
    companies: [
      { id: PLATFORM, kind: 'platform', name: '다담 본사', plan: null, status: 'active' },
      { id: HQ, kind: 'hq', name: '다담 공장', plan: null, status: 'active' },
      ...P.map((id, i) => ({
        id,
        kind: 'partner',
        name: `팩토리 ${i + 1}`,
        plan: 'expert',
        status: 'active',
      })),
    ],
    company_members: [
      { user_id: BOSS, company_id: PLATFORM, role: 'owner', status: 'active' },
      { user_id: HQ_STAFF, company_id: HQ, role: 'staff', status: 'active' },
      ...P.map((id, i) => ({ user_id: STAFF[i], company_id: id, role: 'staff', status: 'active' })),
    ],
    admin_roles: [],
    planner_drafts: [],
    planner_draft_learn: [],
    planner_save_issues: [],
    designs: [],
    planner_draft_genome: panel ? [] : null,
    planner_genome_panel: panel ? [] : null,
    planner_genome_seeds: panel ? [] : null,
  };
}

const KEYS = {
  planner_drafts: ['company_id', 'id'],
  planner_draft_learn: ['company_id', 'draft_id'],
  planner_draft_genome: ['company_id', 'draft_id'],
  planner_genome_panel: ['item', 'kind', 'line_key'],
  planner_genome_seeds: ['company_id', 'draft_id'],
};

function matches(row, key, expr) {
  const v = row[key];
  if (expr === 'is.null') return v === null || v === undefined;
  if (expr === 'not.is.null') return v !== null && v !== undefined;
  const m = /^(eq)\.([\s\S]*)$/.exec(expr);
  if (!m) throw new Error(`가짜 DB: 모르는 필터 ${key}=${expr}`);
  return String(v) === m[2];
}

let seq = 0;
async function withDb(db, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const s = String(url);
    const method = init.method || 'GET';
    const m = /\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/.exec(s);
    if (!m) throw new Error(`unexpected fetch ${method} ${s}`);
    const [, table, qs = ''] = m;
    if (db[table] === null)
      return json({ code: '42P01', message: `relation "public.${table}" does not exist` }, 404);
    if (!db[table]) throw new Error(`unexpected table ${table}`);
    const q = new URLSearchParams(qs);
    const filters = [...q.entries()].filter(
      ([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k)
    );
    const hit = () => db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e)));
    if (method === 'GET') return json(hit().slice(0, Number(q.get('limit')) || undefined));
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const list = Array.isArray(body) ? body : [body];
      const keys = KEYS[table];
      const out = [];
      for (const b of list) {
        const old = keys ? db[table].find((r) => keys.every((k) => r[k] === b[k])) : null;
        if (old && q.get('on_conflict')) {
          Object.assign(old, b);
          out.push(old);
        } else if (old) {
          return json({ code: '23505', message: 'duplicate key 23505' }, 409);
        } else {
          const row = {
            created_at: new Date(Date.UTC(2026, 10, 17) + (seq += 1)).toISOString(),
            discarded_at: null,
            ...b,
          };
          db[table].push(row);
          out.push(row);
        }
      }
      return json(out, 201);
    }
    if (method === 'PATCH') {
      const rows = hit();
      rows.forEach((r) => Object.assign(r, JSON.parse(init.body)));
      return json(rows);
    }
    if (method === 'DELETE') {
      const gone = hit();
      db[table] = db[table].filter((r) => !gone.includes(r));
      return json(gone);
    }
    throw new Error(`unexpected ${method} ${s}`);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

/** 설계 하나 — 줄 유전체와 함께. linked = 앱으로 보내 프로젝트에 이은 설계 */
function addDraft(db, company, id, lines, { linked = true, discarded = false } = {}) {
  db.planner_drafts.push({
    company_id: company,
    id,
    rev: 1,
    item: 'sink',
    created_by: null,
    discarded_at: discarded ? '2026-11-17T00:00:00Z' : null,
  });
  db.planner_draft_genome.push({ company_id: company, draft_id: id, rev: 1, item: 'sink', lines });
  if (linked)
    db.designs.push({
      company_id: company,
      source: 'planner-lite',
      source_ref: id,
      project_id: 'c0000000-0000-4000-8000-000000000001',
    });
}
/** 업체 넷이 쓴 줄들 — 줄 가: 팩토리 1 · 2 · 3 (3곳), 줄 나: 팩토리 2 · 4 (2곳), 다담 공장의 씨앗 줄 */
function seedWorld(db) {
  addDraft(db, P[0], 'd-p1-0001', [lineA(900)]);
  addDraft(db, P[0], 'd-p1-0002', [lineA(950)]); // 같은 업체가 두 번 — 업체는 한 번만 센다
  addDraft(db, P[1], 'd-p2-0001', [lineA(1100), LINE_B, lineA(1100)]); // 한 설계에 같은 줄이 두 벽 — 한 번
  addDraft(db, P[2], 'd-p3-0001', [lineA(1000), DOORS_ONLY]);
  addDraft(db, P[3], 'd-p4-0001', [LINE_B]);
  addDraft(db, P[3], 'pr-0a1b2c3d', [lineA(700)]); // 제작 의뢰로 받은 사본 — 세지 않는다
  addDraft(db, P[3], 'd-p4-0002', [lineA(700)], { linked: false }); // 프로젝트에 안 이어진 설계 — 세지 않는다
  addDraft(db, P[3], 'd-p4-0003', [lineA(700)], { discarded: true }); // 버린 설계 — 세지 않는다
  addDraft(db, HQ, 'd-hq-0001', [LINE_S], { linked: false });
  db.planner_genome_seeds.push({ company_id: HQ, draft_id: 'd-hq-0001', marked_by: BOSS });
}

async function rejects(p, status, code) {
  await assert.rejects(p, (e) => {
    assert.equal(e.statusCode, status, e.message);
    if (code) assert.equal(e.code, code);
    return true;
  });
}

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

test('줄 유전체 모양 — 아는 칸만 다시 짓는다 (이름 · 메모 같은 칸은 버린다), 모양이 아니면 null', () => {
  const clean = genomeLinesOf([{ ...lineA(912.4), name: '김씨네 주방', memo: '고객 요청' }]);
  assert.deepEqual(clean, [
    {
      k: 'floor',
      fx: ['sink', 'cooktop'],
      cells: [
        { l: ['TL-D1-600-L'], r: [], w: 912 },
        { l: [], r: ['LB-DR3-600'], w: 1000 },
        { l: [], r: [], w: 400 },
      ],
    },
  ]);
  assert.doesNotMatch(JSON.stringify(clean), /김씨네|고객/);
  assert.equal(
    lineKeyOf(clean[0]),
    'sink,cooktop#TL-D1-600-L/|/LB-DR3-600|/',
    '줄 열쇠에 칸 폭은 없다'
  );
  assert.equal(lineKeyOf(lineA(500)), lineKeyOf(lineA(1500)), '폭만 다른 줄은 같은 구성');
  for (const bad of [
    null,
    {},
    [{ k: 'stack', fx: [], cells: [{ l: [], r: [], w: 1 }] }], // 모르는 줄
    [
      {
        k: 'floor',
        fx: ['fridge'],
        cells: [
          { l: [], r: [] },
          { l: [], r: [] },
        ],
      },
    ], // 모르는 설비
    [{ k: 'floor', fx: ['sink'], cells: [{ l: [], r: [] }] }], // 칸 수 ≠ 설비장 수 + 1
    [{ k: 'floor', fx: [], cells: [{ l: ['../x'], r: [] }] }], // 모듈 id 가 아니다
    [{ k: 'floor', fx: [], cells: [{ l: ['고객 이름'], r: [] }] }],
    Array.from({ length: 25 }, () => DOORS_ONLY),
  ]) {
    assert.equal(genomeLinesOf(bad), null, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(PANEL_MIN_COMPANIES, 3);
});

test('줄 유전체 받기 — 학습 묶음과 같이 오면 따로 적는다, 표가 없거나 모양이 아니면 묶음만 받는다', async () => {
  const db = makeDb();
  db.planner_drafts.push({
    company_id: P[0],
    id: 'd-test-0001',
    rev: 1,
    item: 'sink',
    created_by: STAFF[0],
    discarded_at: null,
  });
  const bundle = {
    record: { record_id: 'planner-lite:design:d-test-0001', item: 'sink' },
    samples: [],
  };
  await withDb(db, async () => {
    const plain = await putLearn(ENV, {
      user: u(STAFF[0]),
      params: { id: 'd-test-0001' },
      body: { rev: 1, bundle },
    });
    assert.deepEqual(plain, { saved: true, rev: 1 }, 'genome 을 안 보내면 예전 응답 그대로');
    assert.equal(db.planner_draft_genome.length, 0);
    const r = await putLearn(ENV, {
      user: u(STAFF[0]),
      params: { id: 'd-test-0001' },
      body: { rev: 1, bundle, genome: [lineA(900)] },
    });
    assert.deepEqual(
      r,
      { saved: false, same: true, rev: 1, genome: true },
      '묶음은 같아도 줄 유전체는 적는다'
    );
    assert.deepEqual(
      db.planner_draft_genome.map((g) => [g.company_id, g.draft_id, g.rev, g.item, g.lines.length]),
      [[P[0], 'd-test-0001', 1, 'sink', 1]]
    );
    // 다시 보내면 그 줄을 고친다 (설계마다 한 줄)
    await putLearn(ENV, {
      user: u(STAFF[0]),
      params: { id: 'd-test-0001' },
      body: { rev: 1, bundle, genome: [lineA(900), LINE_B] },
    });
    assert.deepEqual(
      [db.planner_draft_genome.length, db.planner_draft_genome[0].lines.length],
      [1, 2]
    );
    // 모양이 아니면 적지 않는다 — 묶음 받기는 그대로
    const bad = await putLearn(ENV, {
      user: u(STAFF[0]),
      params: { id: 'd-test-0001' },
      body: { rev: 1, bundle, genome: [{ k: 'floor', name: 'x' }] },
    });
    assert.equal(bad.genome, false);
    assert.equal(db.planner_draft_genome[0].lines.length, 2);
    assert.equal(
      await saveDraftGenome(ENV, {
        companyId: P[0],
        draftId: 'd-test-0001',
        rev: 1,
        item: '고객',
        genome: [lineA()],
      }),
      false,
      '품목 모양이 아니면 적지 않는다'
    );
  });
  // 0069 적용 전 — 묶음은 받고 줄 유전체만 건너뛴다
  const old = makeDb({ panel: false });
  old.planner_drafts.push({
    company_id: P[0],
    id: 'd-test-0001',
    rev: 1,
    item: 'sink',
    created_by: STAFF[0],
    discarded_at: null,
  });
  await withDb(old, async () => {
    const r = await putLearn(ENV, {
      user: u(STAFF[0]),
      params: { id: 'd-test-0001' },
      body: { rev: 1, bundle, genome: [lineA(900)] },
    });
    assert.deepEqual(r, { saved: true, rev: 1, genome: false });
    assert.equal(old.planner_draft_learn.length, 1);
  });
});

test('다시 묶기 — 프로젝트에 이어진 설계만 · 업체마다 한 번 · 3곳 이상만, 씨앗 줄은 따로. 사본 · 버린 설계 · 안 이어진 설계는 세지 않는다', async () => {
  const db = makeDb();
  seedWorld(db);
  await withDb(db, async () => {
    const r = await runPanelRebuild(ENV);
    assert.deepEqual(r, { lines: 1, seeds: 1, companies: 4, designs: 5 });
    const rows = db.planner_genome_panel;
    assert.equal(rows.length, 2);
    const a = rows.find((x) => !x.seed);
    assert.deepEqual([a.item, a.kind, a.line_key, a.n], ['sink', 'floor', lineKeyOf(lineA()), 3]);
    assert.deepEqual(
      a.company_ids.slice().sort(),
      [P[0], P[1], P[2]].sort(),
      '줄 가를 쓴 업체 셋 — 사본 · 버린 · 안 이어진 설계의 팩토리 4는 없다'
    );
    assert.deepEqual(
      a.line.cells.map((c) => c.w),
      [975, 1000, 400],
      '칸 폭은 가운데값 (900 · 950 · 1000 · 1100)'
    );
    assert.equal(
      rows.some((x) => x.line_key === lineKeyOf(LINE_B)),
      false,
      '2곳뿐인 줄은 표에 들어가지 않는다'
    );
    const s = rows.find((x) => x.seed);
    assert.deepEqual(
      [s.kind, s.line_key, s.n, s.company_ids],
      ['upper', `seed:${lineKeyOf(LINE_S)}`, 1, [HQ]]
    );
    // 다시 돌리면 표를 비우고 채운다 (겹쳐 쌓이지 않는다)
    await runPanelRebuild(ENV);
    assert.equal(db.planner_genome_panel.length, 2);
    // 팩토리 4도 프로젝트에 이으면 줄 가는 4곳 · 줄 나는 여전히 2곳
    db.designs.push({
      company_id: P[3],
      source: 'planner-lite',
      source_ref: 'd-p4-0002',
      project_id: 'c0000000-0000-4000-8000-000000000002',
    });
    assert.deepEqual(await runPanelRebuild(ENV), { lines: 1, seeds: 1, companies: 4, designs: 6 });
    assert.equal(db.planner_genome_panel.find((x) => !x.seed).n, 4);
    // 본사 대표 · 실장만 손으로 돌린다
    assert.equal((await rebuildPanel(ENV, { user: u(BOSS) })).lines, 1);
    await rejects(rebuildPanel(ENV, { user: u(STAFF[0]) }), 403, 'not_platform');
  });
  // 0069 적용 전 — 손으로 돌리면 409, 하루 한 번 도는 길은 조용히 지나간다
  const old = makeDb({ panel: false });
  await withDb(old, async () => {
    await rejects(runPanelRebuild(ENV), 409, 'db_pending');
    assert.equal(await runDailyPanelRebuild(ENV), null);
  });
});

test('내려주기 — 나를 빼고 3곳 이상인 줄만, 씨앗은 따로. 업체 · 설계 id · 업체 수는 내려가지 않는다', async () => {
  const db = makeDb();
  seedWorld(db);
  await withDb(db, async () => {
    await runPanelRebuild(ENV);
    // 팩토리 5 (그 줄을 쓰지 않은 새 업체) — 줄 가(3곳) + 씨앗 줄
    const p5 = await panelOf(ENV, { user: u(STAFF[4]), query: { item: 'sink' } });
    assert.deepEqual(
      p5.pop.map((x) => [x.k, x.seed, x.w]),
      [
        ['floor', false, 0.75],
        ['upper', true, 0.25],
      ],
      '무게는 내려보내는 줄들 안의 몫'
    );
    assert.deepEqual(Object.keys(p5.pop[0]).sort(), ['cells', 'fx', 'k', 'seed', 'w']);
    assert.deepEqual(p5.pop[0].cells[0], { l: ['TL-D1-600-L'], r: [], w: 975 });
    const text = JSON.stringify(p5);
    for (const id of [...P, HQ, PLATFORM, 'd-p1-0001', 'd-hq-0001'])
      assert.equal(text.includes(id), false, `응답에 ${id} 가 없다`);
    assert.doesNotMatch(text, /company|draft|"n"/);
    // 팩토리 1 (줄 가를 쓴 셋 중 하나) — 나를 빼면 2곳이라 줄 가는 오지 않는다. 씨앗만
    const p1 = await panelOf(ENV, { user: u(STAFF[0]), query: { item: 'sink' } });
    assert.deepEqual(
      p1.pop.map((x) => [x.k, x.seed, x.w]),
      [['upper', true, 1]]
    );
    // 다담 공장 — 씨앗은 내 설계라 오지 않는다, 줄 가는 온다
    const hq = await panelOf(ENV, { user: u(HQ_STAFF), query: { item: 'sink' } });
    assert.deepEqual(
      hq.pop.map((x) => [x.k, x.seed, x.w]),
      [['floor', false, 1]]
    );
    // 다른 품목에는 없다 · item 이 없으면 422 · 구성원이 아니면 403
    assert.deepEqual(await panelOf(ENV, { user: u(STAFF[4]), query: { item: 'shoerack' } }), {
      pop: [],
    });
    await rejects(panelOf(ENV, { user: u(STAFF[4]), query: {} }), 422);
    await rejects(
      panelOf(ENV, { user: u('a0000000-0000-4000-8000-0000000000ff'), query: { item: 'sink' } }),
      403,
      'not_member'
    );
  });
  const old = makeDb({ panel: false });
  await withDb(old, async () => {
    await rejects(panelOf(ENV, { user: u(STAFF[4]), query: { item: 'sink' } }), 409, 'db_pending');
  });
});

test('씨앗 — 본사 대표 · 실장이 다담 공장 설계만 고른다, 다시 고르면 그대로, 표시를 뺀다', async () => {
  const db = makeDb();
  addDraft(db, HQ, 'd-hq-0001', [LINE_S], { linked: false });
  addDraft(db, HQ, 'd-hq-0002', [LINE_S], { linked: false, discarded: true });
  addDraft(db, P[0], 'd-p1-0001', [lineA()]);
  await withDb(db, async () => {
    assert.deepEqual(await putSeed(ENV, { user: u(BOSS), params: { id: 'd-hq-0001' } }), {
      seed: true,
      draft_id: 'd-hq-0001',
    });
    assert.deepEqual(await putSeed(ENV, { user: u(BOSS), params: { id: 'd-hq-0001' } }), {
      seed: true,
      draft_id: 'd-hq-0001',
    });
    assert.deepEqual(
      db.planner_genome_seeds.map((s) => [s.company_id, s.draft_id, s.marked_by]),
      [[HQ, 'd-hq-0001', BOSS]]
    );
    assert.deepEqual(await listSeeds(ENV, { user: u(BOSS) }), { seeds: ['d-hq-0001'] });
    // 협력업체 설계 · 버린 설계 · 없는 설계는 씨앗이 못 된다 (한 업체의 구성이 3곳 규칙 없이 퍼지지 않게)
    await rejects(putSeed(ENV, { user: u(BOSS), params: { id: 'd-p1-0001' } }), 404);
    await rejects(putSeed(ENV, { user: u(BOSS), params: { id: 'd-hq-0002' } }), 404);
    await rejects(putSeed(ENV, { user: u(BOSS), params: { id: 'pr-0a1b2c3d' } }), 422);
    await rejects(putSeed(ENV, { user: u(BOSS), params: { id: '../x' } }), 422);
    // 본사 대표 · 실장이 아니면 못 한다
    await rejects(
      putSeed(ENV, { user: u(HQ_STAFF), params: { id: 'd-hq-0001' } }),
      403,
      'not_platform'
    );
    await rejects(listSeeds(ENV, { user: u(STAFF[0]) }), 403, 'not_platform');
    await rejects(
      deleteSeed(ENV, { user: u(STAFF[0]), params: { id: 'd-hq-0001' } }),
      403,
      'not_platform'
    );
    assert.deepEqual(await deleteSeed(ENV, { user: u(BOSS), params: { id: 'd-hq-0001' } }), {
      seed: false,
      draft_id: 'd-hq-0001',
    });
    assert.equal(db.planner_genome_seeds.length, 0);
  });
});
