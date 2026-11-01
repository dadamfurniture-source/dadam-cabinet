/**
 * 공장 작업자 (src/work/factory.js — DB 0024 factory_workers).
 *
 *   작업자 종류 → 공정: 재단(cutting) → cutter · 엣지(edge) → edge · 조립(assembly) → asm. 작업(모집) 종류는 그대로 셋
 *   작업자: 승인된 작업자 + 열린 공장 배정만 (아니면 403 not_worker · not_factory). 보는 계획은 배정의 plan_user_id
 *     기록: 공정은 내 종류 안에서(아니면 422 role), 주문은 계획 주인의 본사 수주만(아니면 422 order_id), 작업자 칸을 채운다
 *     지시 완료: 내 계획의 지시만 (아니면 404)
 *   잇기: 승인된 작업자 + 살아 있는 링크 → 배정(plan = 링크 만든 사람, link_id) · 링크 끊기 · 지난 기록에 작업자
 *     이어진 링크는 열면 「작업자 계정에 이어졌습니다」
 *   본사: 대표 · 실장 · 관리자만 (아니면 403 not_factory_admin). 내 계획 배정 · 배정할 수 있는 작업자(승인 · 공장 종류 · 열린 배정 없음)
 *     배정: 승인 작업자만(409) · 공장 종류가 있어야(422) · 열린 배정이 있으면 409 / 끝내기: 내 계획 배정만(404)
 *   일당 · 금액은 작업자 화면에 없고 고객은 가린 이름, 본사 목록에도 휴대폰은 없다.
 * 사람 · 번호는 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { pepperedHash } from '../src/util/hash.js';
import { WORK_KINDS, WORKER_KINDS, KIND_LABEL, kindsOf } from '../src/work/validate.js';
import { resolveWorker } from '../src/production/worker-access.js';
import { maskOrderLabel, workerAssignmentText } from '../src/production/redact.js';
import { getMe } from '../src/work/workers.js';
import {
  FACTORY_ROLE_OF_KIND,
  factoryRolesOf,
  factoryView,
  getFactoryToday,
  addFactoryWorklog,
  markFactoryAssignmentDone,
  linkFactoryAccount,
  listFactoryWorkers,
  assignFactoryWorker,
  endFactoryWorker,
} from '../src/work/factory.js';
import worker from '../src/worker.js';
import { HQ, PARTNER, companyRoute } from './fixtures/company.js';

const ENV = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 's',
  SHARE_TOKEN_PEPPER: 'test-pepper',
};
const HQ_OWNER = 'a0000000-0000-4000-8000-000000000001';
const HQ_MANAGER = 'a0000000-0000-4000-8000-000000000002';
const HQ_STAFF = 'a0000000-0000-4000-8000-000000000003';
const ADMIN = 'a0000000-0000-4000-8000-000000000004';
const P_OWNER = 'a0000000-0000-4000-8000-000000000005';
const U_CUT = 'b0000000-0000-4000-8000-000000000001';
const U_INSTALL = 'b0000000-0000-4000-8000-000000000002';
const U_PEND = 'b0000000-0000-4000-8000-000000000003';
const U_NONE = 'b0000000-0000-4000-8000-000000000004';
const U_SUSP = 'b0000000-0000-4000-8000-000000000005';
const W_CUT = 'd0000000-0000-4000-8000-000000000001';
const W_INSTALL = 'd0000000-0000-4000-8000-000000000002';
const W_PEND = 'd0000000-0000-4000-8000-000000000003';
const W_SUSP = 'd0000000-0000-4000-8000-000000000005';
const F_CUT = 'f1000000-0000-4000-8000-000000000001';
const LINK = 'c1000000-0000-4000-8000-000000000001';
const LINK_OLD = 'c1000000-0000-4000-8000-000000000002';
const PA_MINE = 'c2000000-0000-4000-8000-000000000001';
const PA_OTHER = 'c2000000-0000-4000-8000-000000000002';
const TOKEN = 'tok-factory-link-0000000001';
const TOKEN_OLD = 'tok-factory-link-0000000002';
const PHONE = '010-0000-0009';

const MEMBERS = [
  { user_id: HQ_OWNER, company_id: HQ, role: 'owner', status: 'active' },
  { user_id: HQ_MANAGER, company_id: HQ, role: 'manager', status: 'active' },
  { user_id: HQ_STAFF, company_id: HQ, role: 'staff', status: 'active' },
  { user_id: P_OWNER, company_id: PARTNER, role: 'owner', status: 'active' },
];

const json = (rows, status = 200) => ({
  ok: status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => rows,
  text: async () => JSON.stringify(rows),
});
const conflict = () => ({
  ok: false,
  status: 409,
  headers: { get: () => 'application/json' },
  json: async () => ({}),
  text: async () => '{"code":"23505"}',
});

// ── 가짜 PostgREST (eq · is.null · in · ov, 고유 색인 둘) ───────────────

const later = (h) => new Date(Date.now() + h * 3600000).toISOString();

function makeDb(over = {}) {
  const db = {
    workers: [
      {
        id: W_CUT,
        user_id: U_CUT,
        display_name: '김재단',
        phone: PHONE,
        kinds: ['cutting', 'assembly'],
        status: 'approved',
      },
      {
        id: W_INSTALL,
        user_id: U_INSTALL,
        display_name: '이설치',
        phone: PHONE,
        kinds: ['install'],
        status: 'approved',
      },
      {
        id: W_PEND,
        user_id: U_PEND,
        display_name: '박대기',
        phone: PHONE,
        kinds: ['edge'],
        status: 'pending',
      },
      {
        id: W_SUSP,
        user_id: U_SUSP,
        display_name: '최정지',
        phone: PHONE,
        kinds: ['edge'],
        status: 'suspended',
      },
    ],
    factory_workers: [],
    production_worker_links: [],
    production_worklogs: [],
    production_assignments: [
      {
        id: PA_MINE,
        user_id: HQ_OWNER,
        work_date: '2026-11-01',
        status: 'instructed',
        kind: 'task',
        role: 'cutter',
        text: '홍길동 (SO-1) 재단 (일당 15만)',
        order_label: '홍길동 (SO-1)',
      },
      {
        id: PA_OTHER,
        user_id: HQ_MANAGER,
        work_date: '2026-11-01',
        status: 'instructed',
        kind: 'task',
        role: 'cutter',
        text: '다른 계획',
        order_label: null,
      },
    ],
    orders: [
      { id: 'O-HQ', company_id: HQ, design_id: 'D-HQ' },
      { id: 'O-MGR', company_id: HQ, design_id: 'D-MGR' },
    ],
    designs: [
      { id: 'D-HQ', user_id: HQ_OWNER, company_id: HQ },
      { id: 'D-MGR', user_id: HQ_MANAGER, company_id: HQ },
    ],
    // /work/me 배지 — 비어 있으면 행마다 거르지 않는다
    work_jobs: [],
    work_assignments: [],
    work_applications: [],
    work_job_events: [],
    ...over,
  };
  return db;
}

const UNIQUE = {
  factory_workers: [
    (r) => (r.ended_at ? null : `open|${r.worker_id}`),
    (r) => (r.link_id ? `link|${r.link_id}` : null),
  ],
};

function matches(row, key, expr) {
  const v = row[key];
  if (expr === 'is.null') return v === null || v === undefined;
  const m = /^(eq|in|ov)\.([\s\S]*)$/.exec(expr);
  if (!m) throw new Error(`가짜 DB: 모르는 필터 ${key}=${expr}`);
  if (m[1] === 'eq') return String(v) === m[2];
  if (m[1] === 'in')
    return m[2]
      .replace(/^\(|\)$/g, '')
      .split(',')
      .includes(String(v));
  const want = m[2].replace(/^\{|\}$/g, '').split(',');
  return Array.isArray(v) && v.some((x) => want.includes(x));
}

function dbRoute(db) {
  const people = (u) =>
    companyRoute(u, { members: MEMBERS }) ||
    (u.includes('/admin_roles?')
      ? json(u.includes(`user_id=eq.${ADMIN}`) ? [{ role: 'admin' }] : [])
      : null);
  return (u, method, body) => {
    const hit = people(u);
    if (hit) return hit;
    const m = /\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/.exec(u);
    if (!m) return null;
    const [, table, qs = ''] = m;
    if (!db[table]) return null;
    const q = new URLSearchParams(qs);
    const filters = [...q.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
    const pick = () => db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e)));
    if (method === 'GET') {
      const rows = pick();
      const limit = Number(q.get('limit')) || rows.length;
      return json(rows.slice(0, limit));
    }
    if (method === 'POST') {
      const row = {
        id: randomUUID(),
        assigned_at: new Date().toISOString(),
        ended_at: null,
        ...body,
      };
      for (const f of UNIQUE[table] || []) {
        const k = f(row);
        if (k && db[table].some((o) => f(o) === k)) return conflict();
      }
      db[table].push(row);
      return json([row], 201);
    }
    if (method === 'PATCH') {
      const rows = pick();
      rows.forEach((r) => Object.assign(r, body));
      return json(rows);
    }
    return null;
  };
}

async function withDb(db, fn) {
  const original = globalThis.fetch;
  const calls = [];
  const route = dbRoute(db);
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method, body });
    if (u.endsWith('/auth/v1/user')) {
      const tok = String((init.headers && init.headers.Authorization) || '').replace(
        /^Bearer /,
        ''
      );
      return tok ? json({ id: tok }) : json({}, 401);
    }
    const res = route(u, method, body);
    if (!res) throw new Error(`unexpected fetch ${method} ${u}`);
    return res;
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}
const writes = (calls) => calls.filter((c) => c.method !== 'GET' && c.url.includes('/rest/v1/'));

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

async function linkRow(id, token, over = {}) {
  return {
    id,
    user_id: HQ_OWNER,
    label: '재단 김',
    token_hash: await pepperedHash(ENV.SHARE_TOKEN_PEPPER, 'worker', token),
    expires_at: later(24 * 30),
    revoked_at: null,
    ...over,
  };
}

// ── 종류 · 화면 (순수) ───────────────────────────────────────────

test('종류 — 작업자 종류 = 작업 종류 셋 + 재단 · 엣지, 공장 공정은 재단 · 엣지 · 조립', () => {
  assert.deepEqual([...WORK_KINDS], ['install', 'as', 'assembly'], '작업(모집) 종류는 그대로');
  assert.deepEqual([...WORKER_KINDS], ['install', 'as', 'assembly', 'cutting', 'edge']);
  assert.equal(KIND_LABEL.cutting, '재단');
  assert.equal(KIND_LABEL.edge, '엣지');
  assert.deepEqual(kindsOf(['edge', 'cutting', 'edge']), ['edge', 'cutting']);
  assert.throws(
    () => kindsOf(['welding']),
    (e) => e.statusCode === 422
  );
  assert.deepEqual(FACTORY_ROLE_OF_KIND, { cutting: 'cutter', edge: 'edge', assembly: 'asm' });
  assert.deepEqual(
    factoryRolesOf(['assembly', 'install', 'cutting']),
    ['cutter', 'asm'],
    '재단 · 엣지 · 조립 차례'
  );
  assert.deepEqual(factoryRolesOf(['install', 'as']), []);
  assert.deepEqual(factoryRolesOf(null), []);
});

test('화면 한 장 — 내 공정만, 지시는 가린 이름 · 일당 없음, 기록의 주문 이름도 가린다', () => {
  const today = '2026-11-01';
  const plan = {
    jobs: [
      {
        id: 'O-HQ',
        workerLabel: '홍*동 (SO-1)',
        due: '2026-11-10',
        counts: { sheetsPB: 3, sheetsBack: 1, edgeFaces: 20, boxes: 2, drawers: 1, doors: 2 },
        stages: { cutter: [today, today], edge: [today, today], asm: [today, today] },
      },
    ],
    skipped: [{ workerLabel: '김*수 (SO-2)', reason: 'BOM 없음' }],
  };
  const pa = {
    id: PA_MINE,
    kind: 'task',
    role: 'cutter',
    text: '홍길동 (SO-1) 재단 (일당 15만)',
    order_label: '홍길동 (SO-1)',
    status: 'instructed',
    done_at: null,
  };
  const log = {
    id: 'L',
    role: 'cutter',
    order_id: 'O-HQ',
    order_label: '홍길동 (SO-1)',
    units: 3,
    minutes: 40,
    created_at: today,
  };
  const v = factoryView({
    worker: { display_name: '김재단' },
    roles: ['cutter', 'asm'],
    plan,
    today,
    assignments: [pa],
    logs: [log],
  });
  assert.deepEqual(Object.keys(v), [
    'worker',
    'today',
    'roles',
    'work',
    'activeJobs',
    'skipped',
    'assignments',
    'logs',
  ]);
  assert.deepEqual(Object.keys(v.work), ['cutter', 'asm'], '엣지는 내 공정이 아니라 없다');
  assert.equal(v.work.cutter[0].units, 4);
  assert.equal(v.activeJobs, 1);
  assert.deepEqual(v.skipped, [{ label: '김*수 (SO-2)', reason: 'BOM 없음' }]);
  assert.equal(v.assignments[0].text, workerAssignmentText(pa));
  assert.equal(v.logs[0].order_label, maskOrderLabel(log.order_label));
  const text = JSON.stringify(v);
  assert.ok(!text.includes('홍길동') && !text.includes('일당'), '실명 · 일당 없음');
});

// ── 작업자 ───────────────────────────────────────────────────────

test('작업자 — 승인 + 열린 공장 배정만, 아니면 403 (not_worker · not_factory), 아무것도 쓰지 않는다', async () => {
  const db = makeDb();
  const calls = [];
  const tries = (user) => [
    getFactoryToday(ENV, { user }),
    addFactoryWorklog(ENV, { user, body: { role: 'cutter', units: 1, minutes: 10 } }),
    markFactoryAssignmentDone(ENV, { user, params: { id: PA_MINE }, body: {} }),
  ];
  for (const [user, code] of [
    [{ id: U_NONE }, 'not_worker'],
    [{ id: U_PEND }, 'not_worker'],
    [{ id: U_SUSP }, 'not_worker'],
    [{ id: U_CUT }, 'not_factory'],
  ]) {
    await withDb(db, async (c) => {
      for (const p of tries(user))
        await assert.rejects(
          p,
          (e) => e.statusCode === 403 && e.code === code,
          `${user.id} ${code}`
        );
      calls.push(...c);
    });
  }
  assert.equal(writes(calls).length, 0);
});

test('기록 — 내 공정 · 계획 주인의 본사 수주만, 작업자 칸을 채우고 링크는 비운다', async () => {
  const db = makeDb({
    factory_workers: [
      {
        id: F_CUT,
        worker_id: W_CUT,
        plan_user_id: HQ_OWNER,
        link_id: null,
        assigned_at: later(-1),
        ended_at: null,
      },
    ],
  });
  await withDb(db, async (calls) => {
    const user = { id: U_CUT };
    await assert.rejects(
      addFactoryWorklog(ENV, { user, body: { role: 'edge', units: 1, minutes: 10 } }),
      (e) => e.statusCode === 422 && e.details.field === 'role',
      '엣지는 내 종류가 아님'
    );
    await assert.rejects(
      addFactoryWorklog(ENV, {
        user,
        body: { role: 'cutter', units: 1, minutes: 10, order_id: 'O-MGR' },
      }),
      (e) => e.statusCode === 422 && e.details.field === 'order_id',
      '다른 사람 계획의 수주'
    );
    assert.equal(writes(calls).length, 0);
    const out = await addFactoryWorklog(ENV, {
      user,
      body: { role: 'asm', units: 2, minutes: 30, order_id: 'O-HQ', order_label: '홍길동 (SO-1)' },
    });
    assert.equal(out.role, 'asm');
    const row = db.production_worklogs[0];
    assert.deepEqual(
      [row.user_id, row.worker_id, row.link_id, row.worker_label, row.company_id, row.order_id],
      [HQ_OWNER, W_CUT, null, '김재단', HQ, 'O-HQ']
    );
  });
});

test('지시 완료 — 내 계획의 지시만 (남의 계획은 404), 체크 풀기도 된다', async () => {
  const db = makeDb({
    factory_workers: [
      {
        id: F_CUT,
        worker_id: W_CUT,
        plan_user_id: HQ_OWNER,
        link_id: null,
        assigned_at: later(-1),
        ended_at: null,
      },
    ],
  });
  await withDb(db, async () => {
    const user = { id: U_CUT };
    await assert.rejects(
      markFactoryAssignmentDone(ENV, { user, params: { id: PA_OTHER }, body: {} }),
      (e) => e.statusCode === 404
    );
    assert.equal(db.production_assignments[1].status, 'instructed');
    await markFactoryAssignmentDone(ENV, { user, params: { id: PA_MINE }, body: {} });
    assert.equal(db.production_assignments[0].status, 'done');
    await markFactoryAssignmentDone(ENV, { user, params: { id: PA_MINE }, body: { done: false } });
    assert.deepEqual(
      [db.production_assignments[0].status, db.production_assignments[0].done_at],
      ['instructed', null]
    );
  });
});

test('/work/me — 승인된 작업자의 열린 공장 배정이면 factory { roles, from_link }, 아니면 null', async () => {
  const db = makeDb({
    factory_workers: [
      {
        id: F_CUT,
        worker_id: W_CUT,
        plan_user_id: HQ_OWNER,
        link_id: LINK,
        assigned_at: later(-1),
        ended_at: null,
      },
    ],
  });
  await withDb(db, async () => {
    const me = await getMe(ENV, { user: { id: U_CUT } });
    assert.deepEqual(me.factory, { roles: ['cutter', 'asm'], from_link: true });
    assert.equal((await getMe(ENV, { user: { id: U_INSTALL } })).factory, null);
    assert.equal((await getMe(ENV, { user: { id: U_NONE } })).factory, null);
  });
});

// ── 내 계정에 잇기 ───────────────────────────────────────────────

test('잇기 — 승인된 작업자: 링크를 만든 사람의 계획으로 배정, 링크를 끊고 지난 기록에 작업자를 채운다', async () => {
  const db = makeDb({
    production_worker_links: [await linkRow(LINK, TOKEN)],
    production_worklogs: [
      { id: 'WL1', link_id: LINK, worker_id: null, role: 'cutter' },
      { id: 'WL2', link_id: LINK_OLD, worker_id: null, role: 'cutter' },
    ],
  });
  await withDb(db, async () => {
    const out = await linkFactoryAccount(ENV, { user: { id: U_INSTALL }, token: TOKEN });
    assert.equal(out.linked, true);
    const f = db.factory_workers[0];
    assert.deepEqual(
      [f.worker_id, f.plan_user_id, f.link_id, f.assigned_by],
      [W_INSTALL, HQ_OWNER, LINK, U_INSTALL]
    );
    assert.ok(db.production_worker_links[0].revoked_at, '링크를 끊는다');
    assert.deepEqual(
      db.production_worklogs.map((l) => l.worker_id),
      [W_INSTALL, null],
      '그 링크 기록만'
    );
    // 끊긴 뒤 링크를 열면 — 계정에 이어졌다고 알린다
    await assert.rejects(
      resolveWorker(ENV, TOKEN),
      (e) => e.statusCode === 401 && /작업자 계정에 이어졌습니다/.test(e.message)
    );
    // 한 번 더 — 이미 배정이 있다
    await assert.rejects(
      linkFactoryAccount(ENV, { user: { id: U_INSTALL }, token: TOKEN }),
      (e) => e.statusCode === 401
    );
  });
});

test('잇기 — 대기 · 정지 · 작업자 아님은 403 not_worker, 이미 공장 배정이면 409, 아무것도 쓰지 않는다', async () => {
  for (const [user, status, code] of [
    [{ id: U_PEND }, 403, 'not_worker'],
    [{ id: U_SUSP }, 403, 'not_worker'],
    [{ id: U_NONE }, 403, 'not_worker'],
    [{ id: U_CUT }, 409, null],
  ]) {
    const db = makeDb({
      production_worker_links: [await linkRow(LINK, TOKEN)],
      factory_workers: [
        {
          id: F_CUT,
          worker_id: W_CUT,
          plan_user_id: HQ_MANAGER,
          link_id: null,
          assigned_at: later(-1),
          ended_at: null,
        },
      ],
    });
    await withDb(db, async (calls) => {
      await assert.rejects(
        linkFactoryAccount(ENV, { user, token: TOKEN }),
        (e) => e.statusCode === status && (code === null || e.code === code),
        user.id
      );
      assert.equal(writes(calls).length, 0, user.id);
      assert.equal(db.production_worker_links[0].revoked_at, null);
    });
  }
});

test('잇기 — 끊긴 링크(잇지 않음)는 예전 문구, 링크 하나는 한 번만 (다른 계정이 같은 링크 → 401)', async () => {
  const db = makeDb({
    production_worker_links: [await linkRow(LINK_OLD, TOKEN_OLD, { revoked_at: later(-2) })],
  });
  await withDb(db, async () => {
    await assert.rejects(
      resolveWorker(ENV, TOKEN_OLD),
      (e) => e.statusCode === 401 && /끊긴 링크입니다/.test(e.message)
    );
  });
  const db2 = makeDb({ production_worker_links: [await linkRow(LINK, TOKEN)] });
  await withDb(db2, async () => {
    await linkFactoryAccount(ENV, { user: { id: U_CUT }, token: TOKEN });
    await assert.rejects(
      linkFactoryAccount(ENV, { user: { id: U_INSTALL }, token: TOKEN }),
      (e) => e.statusCode === 401
    );
    assert.equal(db2.factory_workers.length, 1);
  });
});

// ── 본사 ─────────────────────────────────────────────────────────

test('본사 — 대표 · 실장 · 관리자만, 그 밖은 403 not_factory_admin', async () => {
  for (const who of [HQ_STAFF, P_OWNER, U_CUT]) {
    await withDb(makeDb(), async (calls) => {
      clearHqCompanyCache();
      clearAdminCache();
      const user = { id: who };
      for (const p of [
        listFactoryWorkers(ENV, { user }),
        assignFactoryWorker(ENV, { user, body: { worker_id: W_CUT } }),
        endFactoryWorker(ENV, { user, params: { id: F_CUT } }),
      ]) {
        await assert.rejects(p, (e) => e.statusCode === 403 && e.code === 'not_factory_admin', who);
      }
      assert.equal(writes(calls).length, 0, who);
    });
  }
});

test('본사 목록 — 내 계획 배정 · 배정할 수 있는 작업자(승인 · 공장 종류 · 열린 배정 없음), 휴대폰 없음', async () => {
  const db = makeDb({
    workers: [
      ...makeDb().workers,
      {
        id: 'd0000000-0000-4000-8000-000000000006',
        user_id: 'u6',
        display_name: '정엣지',
        phone: PHONE,
        kinds: ['edge'],
        status: 'approved',
      },
    ],
    factory_workers: [
      {
        id: F_CUT,
        worker_id: W_CUT,
        plan_user_id: HQ_OWNER,
        link_id: LINK,
        assigned_at: later(-1),
        ended_at: null,
      },
      {
        id: 'f-mgr',
        worker_id: 'd0000000-0000-4000-8000-000000000006',
        plan_user_id: HQ_MANAGER,
        link_id: null,
        assigned_at: later(-1),
        ended_at: null,
      },
    ],
  });
  await withDb(db, async () => {
    const out = await listFactoryWorkers(ENV, { user: { id: HQ_OWNER } });
    assert.deepEqual(
      out.assigned.map((a) => [a.id, a.worker.display_name, a.from_link, a.roles]),
      [[F_CUT, '김재단', true, ['cutter', 'asm']]]
    );
    assert.deepEqual(out.candidates, [], '설치만 · 대기 · 정지 · 다른 계획에 배정된 사람은 없다');
    assert.ok(!JSON.stringify(out).includes(PHONE));
    const mgr = await listFactoryWorkers(ENV, { user: { id: HQ_MANAGER } });
    assert.deepEqual(
      mgr.assigned.map((a) => a.worker.display_name),
      ['정엣지']
    );
  });
});

test('본사 배정 — 승인 작업자만(409) · 공장 종류가 있어야(422) · 열린 배정이 있으면 409 · 끝내기는 내 계획만(404)', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const user = { id: HQ_MANAGER };
    await assert.rejects(
      assignFactoryWorker(ENV, { user, body: { worker_id: W_PEND } }),
      (e) => e.statusCode === 409
    );
    await assert.rejects(
      assignFactoryWorker(ENV, { user, body: { worker_id: W_INSTALL } }),
      (e) => e.statusCode === 422
    );
    await assert.rejects(
      assignFactoryWorker(ENV, { user, body: { worker_id: 'nope' } }),
      (e) => e.statusCode === 422
    );
    assert.equal(db.factory_workers.length, 0);
    const a = await assignFactoryWorker(ENV, { user, body: { worker_id: W_CUT } });
    assert.deepEqual(
      [a.worker.display_name, a.roles, a.from_link],
      ['김재단', ['cutter', 'asm'], false]
    );
    assert.deepEqual(
      [db.factory_workers[0].plan_user_id, db.factory_workers[0].assigned_by],
      [HQ_MANAGER, HQ_MANAGER]
    );
    await assert.rejects(
      assignFactoryWorker(ENV, { user: { id: HQ_OWNER }, body: { worker_id: W_CUT } }),
      (e) => e.statusCode === 409
    );
    await assert.rejects(
      endFactoryWorker(ENV, { user: { id: HQ_OWNER }, params: { id: a.id } }),
      (e) => e.statusCode === 404
    );
    const end = await endFactoryWorker(ENV, { user, params: { id: a.id } });
    assert.ok(end.ended_at);
    assert.equal(db.factory_workers[0].ended_by, HQ_MANAGER);
    // 끝난 뒤 다시 배정할 수 있다
    await assignFactoryWorker(ENV, { user: { id: HQ_OWNER }, body: { worker_id: W_CUT } });
    assert.equal(db.factory_workers.length, 2);
  });
});

// ── 라우트 ───────────────────────────────────────────────────────

test('라우트 — 로그인 없이는 401, 잇기는 X-Worker-Token 을 읽어 201 · 캐시에 남기지 않는다', async () => {
  const db = makeDb({ production_worker_links: [await linkRow(LINK, TOKEN)] });
  await withDb(db, async () => {
    for (const [method, path] of [
      ['GET', '/work/factory'],
      ['POST', '/work/factory/worklogs'],
      ['POST', `/work/factory/assignments/${PA_MINE}/done`],
      ['POST', '/work/factory/link'],
      ['GET', '/production/factory-workers'],
      ['POST', '/production/factory-workers'],
      ['POST', `/production/factory-workers/${F_CUT}/end`],
    ]) {
      const res = await worker.fetch(new Request(`https://w.test${path}`, { method }), ENV, {});
      assert.equal(res.status, 401, path);
    }
    const res = await worker.fetch(
      new Request('https://w.test/work/factory/link', {
        method: 'POST',
        headers: { Authorization: `Bearer ${U_INSTALL}`, 'X-Worker-Token': TOKEN },
      }),
      ENV,
      {}
    );
    assert.equal(res.status, 201);
    assert.equal((await res.json()).data.linked, true);
    assert.match(res.headers.get('Cache-Control') || '', /no-store/);
    assert.equal(db.factory_workers[0].worker_id, W_INSTALL);
  });
});
