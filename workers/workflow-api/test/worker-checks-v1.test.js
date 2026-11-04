/**
 * 작업자 필수 확인 v1 (2026-11-04 사장님 확정 — src/work/check-items.js v1, check-state.js, checks.js, DB 0035 · 0037).
 *
 *   엣지 항목은 재단 기사 목록 · 「사진 필수」는 사진을 붙여야 체크 (사진은 서버가 비공개 버킷에, 이 주문 · 문서 경로만)
 *   · 필수가 남으면 공장 「완료 기록」(주문 있는 기록) · 설치 「완료 보고」 409 checks_left, v0 문서 · 주문 없는 기록은 막지 않는다
 *   · [확인 필요] · 콘센트 조건 · 종이에 주문 확인 · 설치 확인 칸 · 본사는 사진 서명 주소.
 * 사람 · 주문은 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { frozenCheckList } from '../src/work/check-items.js';
import { assertChecksDone } from '../src/work/check-state.js';
import { getFactoryChecks, postFactoryCheck, postAssignmentCheck, postAssignmentPhoto, getAssignmentChecks, getOrderChecks, factoryPack, assignmentPack } from '../src/work/checks.js';
import { addFactoryWorklog } from '../src/work/factory.js';
import { addWorkerUpdate } from '../src/work/updates.js';
import { HQ, companyRoute } from './fixtures/company.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const HQ_OWNER = 'a0000000-0000-4000-8000-000000000001';
const U_CUT = 'b0000000-0000-4000-8000-000000000001';
const U_INSTALL = 'b0000000-0000-4000-8000-000000000002';
const W_CUT = 'd0000000-0000-4000-8000-000000000001';
const W_INSTALL = 'd0000000-0000-4000-8000-000000000002';
const O1 = 'e0000000-0000-4000-8000-000000000001';
const DOC_WO = 'c3000000-0000-4000-8000-000000000002';
const DOC_IO = 'c3000000-0000-4000-8000-000000000003';
const A_START = 'c4000000-0000-4000-8000-000000000001';
const MEMBERS = [{ user_id: HQ_OWNER, company_id: HQ, role: 'owner', status: 'active' }];
const cut = { id: U_CUT };
const inst = { id: U_INSTALL };

const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });

/** 아주 작은 PNG (머리 + IHDR 만 — sniffImage 가 형식 · 크기를 읽는다) */
function png(w = 4, h = 3) {
  const u8 = new Uint8Array(33);
  u8.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(u8.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return u8;
}
const photoRequest = (bytes) => new Request('https://w.example/x', { method: 'POST', body: bytes, headers: { 'Content-Type': 'image/png' } });

function makeDb({ version = 'v1', notes = '', outlet = false } = {}) {
  return {
    workers: [
      { id: W_CUT, user_id: U_CUT, display_name: '김재단', kinds: ['cutting', 'assembly'], status: 'approved' },
      { id: W_INSTALL, user_id: U_INSTALL, display_name: '이설치', kinds: ['install'], status: 'approved' },
    ],
    factory_workers: [{ id: randomUUID(), worker_id: W_CUT, plan_user_id: HQ_OWNER, ended_at: null }],
    orders: [{ id: O1, order_no: 'SO-1', customer_name: '홍길동', design_id: 'D1', company_id: HQ }],
    designs: [{ id: 'D1', user_id: HQ_OWNER, company_id: HQ }],
    design_documents: [
      { id: DOC_WO, design_id: 'D1', snapshot_id: 'S1', doc_type: 'work_order', rev: 1, doc_no: 'WO-1', status: 'issued', superseded_by: null, title: '시험', created_at: '2026-11-04T00:00:00Z',
        render_payload: { work_order_version: 2, check_list: frozenCheckList(version), cut_plan: { version: 1, sheets: [{ no: 1, material: 'PB', thickness: 15, partClass: '본체', size: { w: 1220, h: 2440 }, trim: 10, layout: { no: 1, stack: 1, index: 1, dir: 'H' }, strips: [], parts: [{ partId: 'p1#0', part: '측판', w: 550, h: 708, x: 10, y: 10, rot: false, strip: 1 }], yield: 0.1 }], offcuts: [], groups: [], smallParts: [], unallocated: [], summary: {} } } },
      { id: DOC_IO, design_id: 'D1', snapshot_id: 'S1', doc_type: 'installation_order', rev: 1, doc_no: 'IO-1', status: 'issued', superseded_by: null, title: '시험', created_at: '2026-11-04T00:00:00Z',
        render_payload: { check_list: frozenCheckList(version), site_info: {}, schedules: [] } },
    ],
    design_snapshots: [{
      id: 'S1', rev: 1, content_hash: 'h',
      design_payload: { items: [{ categoryId: 'sink', w: 900, h: 870, d: 600, modules: [{ pos: 'lower', name: '도어장', w: 900, h: 708, doorCount: 2 }] }] },
      bom_payload: { materials: [{ partId: 'p1', part: '측판', material: 'PB', thickness: 15, w: 550, h: 708, qty: 1, note: notes }], hardware: outlet ? [{ category: '전기', item: '콘센트 2구', qty: 1 }] : [] },
    }],
    work_jobs: [{ id: 'J1', kind: 'install', order_id: O1, design_id: 'D1', status: 'in_progress', slots: 1 }],
    work_assignments: [{ id: A_START, job_id: 'J1', worker_id: W_INSTALL, status: 'started' }],
    work_checks: [],
    production_worklogs: [],
    uploads: [],
  };
}

function matches(row, key, expr) {
  const v = row[key];
  if (expr === 'is.null') return v === null || v === undefined;
  const m = /^(eq|neq|in)\.([\s\S]*)$/.exec(expr);
  if (!m) throw new Error(`가짜 DB: 모르는 필터 ${key}=${expr}`);
  if (m[1] === 'eq') return String(v) === m[2];
  if (m[1] === 'neq') return String(v) !== m[2];
  return m[2].replace(/^\(|\)$/g, '').split(',').includes(String(v));
}

async function withDb(db, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const method = init.method || 'GET';
    calls.push({ url: u, method });
    if (u.includes('/storage/v1/object/sign/')) {
      const b = JSON.parse(init.body);
      return json(b.paths.map((p) => ({ path: p, signedURL: `/object/sign/work-check-photos/${p}?token=t` })));
    }
    if (u.includes('/storage/v1/object/')) {
      db.uploads.push(u.split('/storage/v1/object/')[1]);
      return json({ Key: 'k' });
    }
    const body = init.body ? JSON.parse(init.body) : null;
    const hit = companyRoute(u, { members: MEMBERS }) || (u.includes('/admin_roles?') ? json([]) : null);
    if (hit) return hit;
    const m = /\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/.exec(u);
    if (!m || !db[m[1]]) throw new Error(`unexpected fetch ${method} ${u}`);
    const [, table, qs = ''] = m;
    const q = new URLSearchParams(qs);
    const filters = [...q.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
    if (method === 'GET') {
      let rows = db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e)));
      const ord = q.get('order');
      if (ord) {
        const [col, dir] = ord.split('.');
        rows = rows.slice().sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      return json(rows.slice(0, Number(q.get('limit')) || rows.length));
    }
    if (method === 'POST') {
      const row = { id: randomUUID(), created_at: new Date(Date.now() + db[table].length).toISOString(), ...body };
      db[table].push(row);
      return json([row], 201);
    }
    throw new Error(`unexpected ${method} ${u}`);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}
const restWrites = (calls) => calls.filter((c) => c.method !== 'GET' && c.url.includes('/rest/v1/'));

/** 그 역할의 필수 항목을 모두 체크한다 (사진 필수면 사진 먼저) */
async function checkAllMust(db, user, getFn, postFn, photoFn, params) {
  const v = await getFn(ENV, { user, params });
  for (const r of v.roles) {
    for (const c of r.cells) {
      for (const x of c.items.filter((i) => i.must)) {
        const photo = x.photo === 'need' ? (await photoFn(ENV, { user, params, request: photoRequest(png()) })).photo_path : undefined;
        await postFn(ENV, { user, params, body: { document_id: v.document.id, role: r.role, scope_key: c.scope_key, item_key: x.key, checked: true, photo_path: photo } });
      }
    }
  }
}

beforeEach(() => { clearHqCompanyCache(); clearAdminCache(); });

test('v1 공장 — 재단 기사 목록에 엣지 항목 · 주문 시작 전 · 끝 칸, 조립은 키팅 · 경첩 · 간격 · 사진(권장 · 사진 필수)', async () => {
  await withDb(makeDb(), async () => {
    const v = await getFactoryChecks(ENV, { user: cut, params: { orderId: O1 } });
    assert.deepEqual([v.list_version, v.block], ['v1', 'must']);
    const cutRole = v.roles.find((r) => r.role === 'cut');
    assert.deepEqual(cutRole.cells.map((c) => c.scope_key), ['', 'sheet:1']);
    assert.ok(cutRole.cells[0].items.some((x) => x.key === 'edge-order-thickness'));
    const asm = v.roles.find((r) => r.role === 'assembly');
    const mod = asm.cells.find((c) => c.scope_key === 'module:0:0');
    assert.deepEqual(mod.items.map((x) => x.key), ['asm-module-kit', 'asm-module-cut', 'asm-module-edge', 'asm-module-build', 'asm-module-hinge', 'asm-module-door', 'asm-module-gap', 'asm-module-pack', 'asm-module-photo']);
    assert.ok(!asm.cells.some((c) => c.scope_key === ''), '[확인 필요]가 없으면 주문 확인 칸 없음');
    const html = await factoryPack(ENV, { user: cut, params: { orderId: O1 }, query: { pack: 'cut' } });
    assert.match(html, /주문 확인/);
    assert.match(html, /재단 ☐ 엣지 표시 ☐ 라벨 ☐ 결 ☐ 엣지 붙임 ☐/);
  });
  await withDb(makeDb({ notes: '[확인 필요] 레일 품번' }), async () => {
    const v = await getFactoryChecks(ENV, { user: cut, params: { orderId: O1 } });
    assert.deepEqual(v.roles.find((r) => r.role === 'assembly').cells.find((c) => c.scope_key === '').items.map((x) => x.key), ['asm-order-confirm']);
  });
});

test('사진 필수 — 사진 없이 체크하면 422, 서버가 비공개 버킷에 올린 이 주문 · 문서 경로만 붙는다, 작업자에게는 있음 · 없음만', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const p = { id: A_START };
    const base = { document_id: DOC_IO, role: 'install', scope_key: '', item_key: 'inst-order-photo', checked: true };
    await assert.rejects(() => postAssignmentCheck(ENV, { user: inst, params: p, body: base }), (e) => e.statusCode === 422 && e.details.code === 'photo_required');
    const { photo_path } = await postAssignmentPhoto(ENV, { user: inst, params: p, request: photoRequest(png()) });
    assert.match(photo_path, new RegExp(`^${HQ}/${O1}/${DOC_IO}/[0-9a-f-]{36}\\.png$`));
    assert.equal(db.uploads[0], `work-check-photos/${photo_path}`);
    await assert.rejects(() => postAssignmentCheck(ENV, { user: inst, params: p, body: { ...base, photo_path: `${HQ}/${O1}/${DOC_WO}/${randomUUID()}.png` } }), (e) => e.statusCode === 422, '다른 문서 경로');
    await assert.rejects(() => postAssignmentCheck(ENV, { user: inst, params: p, body: { ...base, item_key: 'inst-order-level', photo_path } }), (e) => e.statusCode === 422, '사진 없는 항목에 사진');
    await postAssignmentCheck(ENV, { user: inst, params: p, body: { ...base, photo_path } });
    assert.equal(db.work_checks[0].photo_path, photo_path);
    const v = await getAssignmentChecks(ENV, { user: inst, params: p });
    const item = v.roles[0].cells[0].items.find((x) => x.key === 'inst-order-photo');
    assert.deepEqual([item.checked, item.has_photo, 'photo_path' in item], [true, true, false]);
    await assert.rejects(() => postAssignmentPhoto(ENV, { user: inst, params: p, request: photoRequest(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) }), (e) => e.statusCode === 422 && e.details.code === 'bad_type');
  });
});

test('완료 막기 — 필수가 남으면 공장 완료 기록 · 설치 완료 보고 409 checks_left (쓰지 않음), 다 체크하면 된다', async () => {
  const db = makeDb();
  await withDb(db, async (calls) => {
    const before = restWrites(calls).length;
    await assert.rejects(() => addFactoryWorklog(ENV, { user: cut, body: { role: 'cutter', units: 1, minutes: 30, order_id: O1, order_label: 'SO-1' } }), (e) => e.statusCode === 409 && e.details.code === 'checks_left' && e.details.left > 0);
    await assert.rejects(() => addWorkerUpdate(ENV, { user: inst, params: { id: A_START }, body: { kind: 'result', body: '끝났습니다' } }), (e) => e.statusCode === 409 && e.details.code === 'checks_left');
    assert.equal(restWrites(calls).length, before, '막히면 아무것도 쓰지 않는다');
    // 주문 없는 「다른 작업 기록」은 막지 않는다
    await addFactoryWorklog(ENV, { user: cut, body: { role: 'cutter', units: 1, minutes: 10, order_label: '청소' } });
    // 재단 필수를 다 체크하면 재단 완료 기록이 된다 (조립 필수는 남아도 — 역할마다)
    const v = await getFactoryChecks(ENV, { user: cut, params: { orderId: O1 } });
    const cutRole = v.roles.find((r) => r.role === 'cut');
    for (const c of cutRole.cells) for (const x of c.items.filter((i) => i.must)) {
      await postFactoryCheck(ENV, { user: cut, params: { orderId: O1 }, body: { document_id: DOC_WO, role: 'cut', scope_key: c.scope_key, item_key: x.key, checked: true } });
    }
    await addFactoryWorklog(ENV, { user: cut, body: { role: 'cutter', units: 1, minutes: 30, order_id: O1, order_label: 'SO-1' } });
    await assert.rejects(() => addFactoryWorklog(ENV, { user: cut, body: { role: 'asm', units: 1, minutes: 30, order_id: O1 } }), (e) => e.details && e.details.code === 'checks_left');
    assert.equal(db.production_worklogs.length, 2);
  });
});

test('설치 — 사진 포함 필수를 다 체크하면 완료 막기를 지난다, 콘센트 조건 · 종이 설치 확인 칸 · 서명 칸', async () => {
  const db = makeDb({ outlet: true });
  await withDb(db, async () => {
    const p = { id: A_START };
    const v = await getAssignmentChecks(ENV, { user: inst, params: p });
    assert.ok(v.roles[0].cells[0].items.some((x) => x.key === 'inst-order-outlet'), '콘센트를 넣었으면 그 칸');
    await checkAllMust(db, inst, getAssignmentChecks, postAssignmentCheck, postAssignmentPhoto, p);
    await assertChecksDone(ENV, { orderId: O1, role: 'install' });
    const html = await assignmentPack(ENV, { user: inst, params: p });
    assert.match(html, /설치 확인/);
    assert.match(html, /완료 사진 \(정면\) <span class="muted">· 사진<\/span> ☐/);
    assert.match(html, /<td>설치 담당<\/td><td><\/td><td>검수<\/td><td><\/td><td>고객 확인<\/td><td><\/td>/);
  });
});

test('v0 문서는 막지 않는다 · 본사 보기는 사진 서명 주소', async () => {
  await withDb(makeDb({ version: 'v0' }), async () => {
    await addFactoryWorklog(ENV, { user: cut, body: { role: 'cutter', units: 1, minutes: 30, order_id: O1 } });
  });
  const db = makeDb();
  await withDb(db, async () => {
    const p = { id: A_START };
    const { photo_path } = await postAssignmentPhoto(ENV, { user: inst, params: p, request: photoRequest(png()) });
    await postAssignmentCheck(ENV, { user: inst, params: p, body: { document_id: DOC_IO, role: 'install', scope_key: '', item_key: 'inst-order-photo', checked: true, photo_path } });
    const v = await getOrderChecks(ENV, { user: { id: HQ_OWNER }, params: { orderId: O1 } });
    const item = v.roles.find((r) => r.role === 'install').cells[0].items.find((x) => x.key === 'inst-order-photo');
    assert.equal(item.photo_url, `${ENV.SUPABASE_URL}/storage/v1/object/sign/work-check-photos/${photo_path}?token=t`);
  });
});
