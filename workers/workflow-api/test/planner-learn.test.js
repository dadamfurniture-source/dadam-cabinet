/**
 * 간편 플래너 웹판 — 학습 묶음 · 저장 실패 기록 · 사진 제공 동의 (src/planner-learn.js — DB 0067)
 *
 *   묶음: 저장과 따로, 만든 사람 또는 대표 · 실장만, 저장된 rev 와 같을 때만, 같은 묶음은 다시 쓰지 않는다
 *   실패 기록: 글 없이 단계 · 코드 · 상태만, 기록이 안 돼도 던지지 않는다
 *   사진 제공: 다담 공장은 늘 제공, 협력업체는 대표만 켜고 끈다 (쌓기만 — 지금 값은 마지막 줄)
 *   점검용 시험 설계(probe-)는 목록 · 수 · 추천에 안 보이고 밖에서는 저장하지 못한다
 * 사람 · 설계는 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ConflictError, DbError, ForbiddenError, ValidationError, clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { listDrafts, recommendOf, saveDraft } from '../src/planner-drafts.js';
import {
  ISSUE_STAGES,
  LEARN_MAX_BYTES,
  LEARN_RECORD_MAX_BYTES,
  PHOTO_CONSENT_KIND,
  PHOTO_CONSENT_TERMS,
  REPORTS_PER_HOUR,
  bundleOf,
  bundleSha256,
  getPhotoConsent,
  issueCodeOf,
  noteIssue,
  putLearn,
  putPhotoConsent,
  reportIssue,
} from '../src/planner-learn.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const HQ = 'f0000000-0000-4000-8000-0000000000aa';
const P1 = 'f0000000-0000-4000-8000-0000000000b1';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const MANAGER = 'a0000000-0000-4000-8000-000000000002';
const STAFF = 'a0000000-0000-4000-8000-000000000003';
const STAFF2 = 'a0000000-0000-4000-8000-000000000004';
const HQ_STAFF = 'a0000000-0000-4000-8000-000000000005';
const NOBODY = 'a0000000-0000-4000-8000-000000000009';
const u = (id) => ({ id });

const json = (rows, status = 200) => ({
  ok: status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => rows,
  text: async () => JSON.stringify(rows),
});

function makeDb({ learn = true } = {}) {
  return {
    companies: [
      { id: HQ, kind: 'hq', name: '다담 공장', plan: null, status: 'active' },
      { id: P1, kind: 'partner', name: '가나 팩토리', plan: 'expert', status: 'active' },
    ],
    company_members: [
      { user_id: OWNER, company_id: P1, role: 'owner', status: 'active' },
      { user_id: MANAGER, company_id: P1, role: 'manager', status: 'active' },
      { user_id: STAFF, company_id: P1, role: 'staff', status: 'active' },
      { user_id: STAFF2, company_id: P1, role: 'staff', status: 'active' },
      { user_id: HQ_STAFF, company_id: HQ, role: 'staff', status: 'active' },
    ],
    admin_roles: [],
    planner_drafts: [],
    planner_draft_learn: learn ? [] : null,
    planner_save_issues: learn ? [] : null,
    company_consents: learn ? [] : null,
    writes: [],
  };
}

const KEYS = { planner_drafts: ['company_id', 'id'], planner_draft_learn: ['company_id', 'draft_id'] };

function matches(row, key, expr) {
  const v = row[key];
  if (expr === 'is.null') return v === null || v === undefined;
  const m = /^(eq|gte)\.([\s\S]*)$/.exec(expr);
  if (!m) throw new Error(`가짜 DB: 모르는 필터 ${key}=${expr}`);
  return m[1] === 'eq' ? String(v) === m[2] : String(v) >= m[2];
}

let clock = Date.now() - 60 * 1000;
const now = () => new Date((clock += 10)).toISOString();

async function withDb(db, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const s = String(url);
    const method = init.method || 'GET';
    const m = /\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/.exec(s);
    if (!m) throw new Error(`unexpected fetch ${method} ${s}`);
    const [, table, qs = ''] = m;
    if (db[table] === null) return json({ code: '42P01', message: `relation "public.${table}" does not exist` }, 404);
    if (!db[table]) throw new Error(`unexpected table ${table}`);
    const q = new URLSearchParams(qs);
    const filters = [...q.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
    const hit = () => db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e)));
    if (method === 'GET') {
      let rows = hit();
      const order = q.get('order');
      if (order) {
        const [col] = order.split('.');
        rows = rows.slice().sort((a, b) => (a[col] < b[col] ? 1 : -1));
      }
      return json(rows.slice(0, Number(q.get('limit')) || rows.length));
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const keys = KEYS[table];
      if (keys && db[table].some((r) => keys.every((k) => r[k] === body[k]))) return json({ code: '23505', message: 'duplicate key 23505' }, 409);
      const t = now();
      const row = { created_at: t, updated_at: t, discarded_at: null, ...body };
      db[table].push(row);
      db.writes.push({ table, method });
      return json([row], 201);
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(init.body);
      const rows = hit();
      rows.forEach((r) => Object.assign(r, patch, { updated_at: now() }));
      db.writes.push({ table, method, n: rows.length });
      return json(rows);
    }
    throw new Error(`unexpected ${method} ${s}`);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const project = (over = {}) => ({
  format: 'dadam.planner-lite/1',
  id: 'd-test-0001',
  name: '시험 주방',
  item: 'sink',
  walls: [{ lines: { floor: [{ libId: 'LB-D2-900' }], upper: [] } }],
  ...over,
});
const bundle = (over = {}) => ({
  record: { record_id: 'planner-lite:design:d-test-0001', item: 'sink', layout_shape: 'I', design: { walls: 1 }, ...over },
  samples: [],
});

async function rejects(p, status, code) {
  await assert.rejects(p, (e) => {
    assert.equal(e.statusCode, status, e.message);
    if (code) assert.equal(e.code, code);
    return true;
  });
}

test('묶음 지문 — 키 차례가 달라도 같은 묶음은 같은 지문', async () => {
  const a = await bundleSha256({ record: { a: 1, b: [1, 2] }, samples: [] });
  const b = await bundleSha256({ samples: [], record: { b: [1, 2], a: 1 } });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b);
  assert.notEqual(a, await bundleSha256({ record: { a: 2, b: [1, 2] }, samples: [] }));
});

test('묶음 모양 · 크기 — record 객체 · samples 객체 배열, 레코드 512KB · 묶음 1MB 까지', () => {
  assert.deepEqual(bundleOf({ bundle: { record: { a: 1 } } }), { record: { a: 1 }, samples: [] });
  assert.deepEqual(Object.keys(bundleOf({ bundle: { record: {}, samples: [{}], extra: 1 } })), ['record', 'samples']);
  for (const bad of [null, {}, { bundle: [] }, { bundle: { record: [] } }, { bundle: { record: {}, samples: {} } }, { bundle: { record: {}, samples: [1] } }]) {
    assert.throws(() => bundleOf(bad), ValidationError);
  }
  assert.throws(() => bundleOf({ bundle: { record: { big: 'x'.repeat(LEARN_RECORD_MAX_BYTES) } } }), (e) => e.statusCode === 413);
  const fat = Array.from({ length: 12 }, () => ({ attrs: 'y'.repeat(60 * 1024) }));
  assert.ok(JSON.stringify(fat).length < LEARN_MAX_BYTES);
  assert.equal(bundleOf({ bundle: { record: {}, samples: fat } }).samples.length, 12);
  assert.throws(() => bundleOf({ bundle: { record: { r: 'x'.repeat(400 * 1024) }, samples: fat } }), (e) => e.statusCode === 413);
});

test('묶음 받기 — 저장된 rev 와 같을 때 넣고, 같은 묶음은 다시 쓰지 않고, 바뀌면 고친다', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const saved = await saveDraft(ENV, { user: u(STAFF), body: { project: project() } });
    assert.equal(saved.rev, 1);
    const ctx = { user: u(STAFF), params: { id: 'd-test-0001' } };
    assert.deepEqual(await putLearn(ENV, { ...ctx, body: { rev: 1, bundle: bundle() } }), { saved: true, rev: 1 });
    assert.equal(db.planner_draft_learn.length, 1);
    const row = db.planner_draft_learn[0];
    assert.equal(row.company_id, P1);
    assert.equal(row.sent_by, STAFF);
    assert.match(row.bundle_sha256, /^[0-9a-f]{64}$/);
    const firstSha = row.bundle_sha256;
    // 같은 묶음 — 쓰지 않는다
    const before = db.writes.length;
    assert.deepEqual(await putLearn(ENV, { ...ctx, body: { rev: 1, bundle: bundle() } }), { saved: false, same: true, rev: 1 });
    assert.equal(db.writes.length, before);
    // 같은 rev 에 묶음이 바뀜 (사진이 붙음) — 고친다
    assert.deepEqual(await putLearn(ENV, { ...ctx, body: { rev: 1, bundle: bundle({ photos: { site: ['p1'] } }) } }), { saved: true, rev: 1 });
    assert.equal(db.planner_draft_learn.length, 1);
    assert.notEqual(db.planner_draft_learn[0].bundle_sha256, firstSha);
    assert.deepEqual(db.planner_draft_learn[0].bundle.record.photos, { site: ['p1'] });
  });
});

test('묶음 받기 — 설계가 그 뒤에 또 저장됐으면 옛 묶음은 버린다 (stale), 앞선 rev 는 거절', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await saveDraft(ENV, { user: u(STAFF), body: { project: project() } });
    await saveDraft(ENV, { user: u(STAFF), body: { project: project({ rev: 1, walls: [] }) } });
    const ctx = { user: u(STAFF), params: { id: 'd-test-0001' } };
    assert.deepEqual(await putLearn(ENV, { ...ctx, body: { rev: 1, bundle: bundle() } }), { saved: false, stale: true, rev: 2 });
    assert.equal(db.planner_draft_learn.length, 0);
    await rejects(putLearn(ENV, { ...ctx, body: { rev: 3, bundle: bundle() } }), 422);
    await rejects(putLearn(ENV, { ...ctx, body: { rev: 0, bundle: bundle() } }), 422);
    await rejects(putLearn(ENV, { ...ctx, body: { bundle: bundle() } }), 422);
  });
});

test('묶음 받기 — 만든 사람 또는 대표 · 실장만, 없는 설계 · 버린 설계는 404, 남은 못 보낸다', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await saveDraft(ENV, { user: u(STAFF), body: { project: project() } });
    const body = { rev: 1, bundle: bundle() };
    await rejects(putLearn(ENV, { user: u(STAFF2), params: { id: 'd-test-0001' }, body }), 403, 'not_draft_editor');
    await rejects(putLearn(ENV, { user: u(NOBODY), params: { id: 'd-test-0001' }, body }), 403, 'not_member');
    await rejects(putLearn(ENV, { user: u(HQ_STAFF), params: { id: 'd-test-0001' }, body }), 404); // 다른 업체 — 그 업체에는 없는 설계
    await rejects(putLearn(ENV, { user: u(STAFF), params: { id: 'd-none-0001' }, body }), 404);
    await rejects(putLearn(ENV, { user: u(STAFF), params: { id: '../x' }, body }), 422);
    assert.equal((await putLearn(ENV, { user: u(MANAGER), params: { id: 'd-test-0001' }, body })).saved, true);
    db.planner_drafts[0].discarded_at = now();
    await rejects(putLearn(ENV, { user: u(STAFF), params: { id: 'd-test-0001' }, body }), 404);
  });
});

test('0067 적용 전 — 묶음 · 화면 실패 · 동의는 409 db_pending, 설계 저장은 그대로 된다', async () => {
  const db = makeDb({ learn: false });
  await withDb(db, async () => {
    assert.equal((await saveDraft(ENV, { user: u(STAFF), body: { project: project() } })).rev, 1);
    await rejects(putLearn(ENV, { user: u(STAFF), params: { id: 'd-test-0001' }, body: { rev: 1, bundle: bundle() } }), 409, 'db_pending');
    await rejects(reportIssue(ENV, { user: u(STAFF), body: { stage: 'save', code: 'offline' } }), 409, 'db_pending');
    await rejects(getPhotoConsent(ENV, { user: u(OWNER) }), 409, 'db_pending');
    // 서버 쪽 실패 기록은 표가 없으면 조용히 넘어간다
    assert.equal(await noteIssue(ENV, u(STAFF), { stage: 'save', error: new ConflictError('x') }), false);
  });
});

test('실패 코드 — 오류에 코드가 있으면 그것, 없으면 종류로. 로그인 끝 · 표 없음은 적지 않는다', () => {
  const coded = Object.assign(new ConflictError('버린 설계'), { code: 'discarded' });
  assert.equal(issueCodeOf(coded), 'discarded');
  assert.equal(issueCodeOf(new ConflictError('x')), 'conflict');
  assert.equal(issueCodeOf(new ValidationError('x')), 'validation');
  assert.equal(issueCodeOf(new ForbiddenError('x', 'not_draft_editor')), 'not_draft_editor');
  assert.equal(issueCodeOf(new DbError('x')), 'db_error');
  assert.equal(issueCodeOf(new Error('x')), 'error');
  assert.equal(issueCodeOf(Object.assign(new ConflictError('x'), { code: 'db_pending' })), null);
  assert.equal(issueCodeOf(Object.assign(new Error('x'), { code: '설계 이름이 든 글' })), 'error');
  assert.equal(issueCodeOf(null), null);
});

test('서버가 본 실패 — 단계 · 코드 · 상태만 적는다 (오류 글은 적지 않는다), 던지지 않는다', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const e = Object.assign(new ConflictError('김○○ 주방 설계가 다른 곳에서 바뀌었습니다'), { code: 'conflict' });
    assert.equal(await noteIssue(ENV, u(STAFF), { stage: 'save', error: e, draftId: 'd-test-0001', rev: 3 }), true);
    assert.deepEqual(
      { ...db.planner_save_issues[0], created_at: null, updated_at: null, discarded_at: null },
      { company_id: P1, user_id: STAFF, draft_id: 'd-test-0001', source: 'server', stage: 'save', code: 'conflict', status: 409, rev: 3, created_at: null, updated_at: null, discarded_at: null }
    );
    assert.ok(!JSON.stringify(db.planner_save_issues).includes('김'));
    // 구성원이 아닌 사람 — 업체 칸을 비우고 남긴다, 이상한 설계 id 는 비운다
    assert.equal(await noteIssue(ENV, u(NOBODY), { stage: 'save', error: new ForbiddenError('x', 'not_member'), draftId: '../x' }), true);
    assert.equal(db.planner_save_issues[1].company_id, null);
    assert.equal(db.planner_save_issues[1].draft_id, null);
    assert.equal(db.planner_save_issues[1].status, 403);
    // 모르는 단계 · 사람 없음 · 오류 없음 — 적지 않는다
    assert.equal(await noteIssue(ENV, u(STAFF), { stage: 'upload', error: e }), false);
    assert.equal(await noteIssue(ENV, null, { stage: 'save', error: e }), false);
    assert.equal(await noteIssue(ENV, u(STAFF), { stage: 'save', error: null }), false);
    assert.equal(db.planner_save_issues.length, 2);
  });
});

test('화면이 본 실패 — 단계 · 코드를 보고 적는다, 한 시간에 정한 수까지만', async () => {
  assert.deepEqual([...ISSUE_STAGES], ['save', 'learn', 'photo', 'open']);
  const db = makeDb();
  await withDb(db, async () => {
    assert.deepEqual(await reportIssue(ENV, { user: u(STAFF), body: { stage: 'save', code: 'offline', draftId: 'd-test-0001', rev: 2, status: 0 } }), { ok: true });
    const row = db.planner_save_issues[0];
    assert.deepEqual([row.source, row.stage, row.code, row.status, row.rev, row.company_id], ['client', 'save', 'offline', null, 2, P1]);
    await rejects(reportIssue(ENV, { user: u(STAFF), body: { stage: 'upload', code: 'offline' } }), 422);
    await rejects(reportIssue(ENV, { user: u(STAFF), body: { stage: 'save', code: '저장 안 됨' } }), 422);
    await rejects(reportIssue(ENV, { user: u(STAFF), body: { stage: 'save' } }), 422);
    for (let i = 1; i < REPORTS_PER_HOUR; i += 1) await reportIssue(ENV, { user: u(STAFF), body: { stage: 'save', code: 'offline' } });
    assert.equal(db.planner_save_issues.length, REPORTS_PER_HOUR);
    assert.deepEqual(await reportIssue(ENV, { user: u(STAFF), body: { stage: 'save', code: 'offline' } }), { ok: true, dropped: true });
    assert.equal(db.planner_save_issues.length, REPORTS_PER_HOUR);
    // 다른 사람은 따로 센다
    assert.deepEqual(await reportIssue(ENV, { user: u(OWNER), body: { stage: 'open', code: 'offline' } }), { ok: true });
  });
});

test('사진 제공 — 다담 공장은 늘 제공, 협력업체는 대표만 켜고 끈다 (쌓기만, 지금 값은 마지막 줄)', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    assert.deepEqual(await getPhotoConsent(ENV, { user: u(HQ_STAFF) }), { granted: true, fixed: true, at: null, can_change: false, terms: PHOTO_CONSENT_TERMS });
    await rejects(putPhotoConsent(ENV, { user: u(HQ_STAFF), body: { granted: false } }), 422);
    const first = await getPhotoConsent(ENV, { user: u(OWNER) });
    assert.deepEqual([first.granted, first.fixed, first.at, first.can_change], [false, false, null, true]);
    assert.equal((await getPhotoConsent(ENV, { user: u(STAFF) })).can_change, false);
    // 대표가 아니면 못 바꾼다 (실장도)
    await rejects(putPhotoConsent(ENV, { user: u(MANAGER), body: { granted: true, terms_version: PHOTO_CONSENT_TERMS.version } }), 403, 'not_owner');
    await rejects(putPhotoConsent(ENV, { user: u(STAFF), body: { granted: true, terms_version: PHOTO_CONSENT_TERMS.version } }), 403, 'not_owner');
    // 켤 때는 본 글의 version 이 지금 것이어야 한다
    await rejects(putPhotoConsent(ENV, { user: u(OWNER), body: { granted: true, terms_version: '2020-01-01' } }), 409, 'terms_changed');
    await rejects(putPhotoConsent(ENV, { user: u(OWNER), body: { granted: 'yes' } }), 422);
    // 끈 채로 끄기 — 줄을 더하지 않는다
    assert.equal((await putPhotoConsent(ENV, { user: u(OWNER), body: { granted: false } })).granted, false);
    assert.equal(db.company_consents.length, 0);
    const on = await putPhotoConsent(ENV, { user: u(OWNER), body: { granted: true, terms_version: PHOTO_CONSENT_TERMS.version } });
    assert.equal(on.granted, true);
    assert.ok(on.at);
    assert.deepEqual(
      { ...db.company_consents[0], created_at: null, updated_at: null, discarded_at: null },
      { company_id: P1, kind: PHOTO_CONSENT_KIND, granted: true, terms_version: PHOTO_CONSENT_TERMS.version, actor: OWNER, created_at: null, updated_at: null, discarded_at: null }
    );
    // 켠 채로 켜기 — 그대로
    await putPhotoConsent(ENV, { user: u(OWNER), body: { granted: true, terms_version: PHOTO_CONSENT_TERMS.version } });
    assert.equal(db.company_consents.length, 1);
    assert.equal((await putPhotoConsent(ENV, { user: u(OWNER), body: { granted: false } })).granted, false);
    assert.equal(db.company_consents.length, 2);
    assert.equal((await getPhotoConsent(ENV, { user: u(STAFF) })).granted, false);
  });
});

test('동의 글 — 고객 정보를 제공하지 않는다 · 끄면 뺀다는 말이 들어 있다', () => {
  assert.match(PHOTO_CONSENT_TERMS.version, /^[0-9A-Za-z._-]{1,40}$/);
  for (const must of ['고객 이름 · 주소 · 연락처는 제공하지 않고', '촬영 위치 정보는 올릴 때 지워집니다', '언제든 끌 수 있고', '이미 제공한 사진도 학습 자료에서 뺍니다']) {
    assert.ok(PHOTO_CONSENT_TERMS.text.includes(must), must);
  }
});

test('점검용 시험 설계(probe-) — 밖에서는 저장 · 묶음을 못 보내고, 목록 · 수 · 추천에 안 보인다', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await rejects(saveDraft(ENV, { user: u(HQ_STAFF), body: { project: project({ id: 'probe-selfcheck' }) } }), 422);
    await rejects(putLearn(ENV, { user: u(HQ_STAFF), params: { id: 'probe-selfcheck' }, body: { rev: 1, bundle: bundle() } }), 422);
    const real = await saveDraft(ENV, { user: u(HQ_STAFF), body: { project: project() } });
    assert.equal(real.count, 1);
    const probe = await saveDraft(ENV, { user: u(HQ_STAFF), body: { project: project({ id: 'probe-selfcheck' }) } }, { internal: true });
    assert.equal(probe.rev, 1);
    assert.equal(probe.count, 1, '수에 시험 설계를 세지 않는다');
    assert.equal(db.planner_drafts.length, 2);
    const list = await listDrafts(ENV, { user: u(HQ_STAFF) });
    assert.deepEqual(list.items.map((d) => d.id), ['d-test-0001']);
    assert.equal(list.count, 1);
    const rec = await recommendOf(ENV, { user: u(HQ_STAFF), query: { item: 'sink' } });
    assert.equal(rec.designs, 1);
    assert.deepEqual(rec.used, [{ id: 'LB-D2-900', n: 1 }]);
    assert.equal((await putLearn(ENV, { user: u(HQ_STAFF), params: { id: 'probe-selfcheck' }, body: { rev: 1, bundle: bundle() } }, { internal: true })).saved, true);
  });
});

test('라우터 — 새 길 넷이 이어져 있고, 저장 · 묶음 실패는 적은 뒤 그대로 던진다', () => {
  const src = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  for (const line of [
    "{ method: 'POST',   path: '/planner/drafts/report',              auth: 'jwt', handler: workRoute(reportPlannerIssue, 201) },",
    "{ method: 'PUT',    path: '/planner/drafts/:id/learn',           auth: 'jwt', handler: handlePutPlannerLearn },",
    "{ method: 'GET',    path: '/planner/photo-consent',              auth: 'jwt', handler: workRoute(getPhotoConsent) },",
    "{ method: 'PUT',    path: '/planner/photo-consent',              auth: 'jwt', handler: workRoute(putPhotoConsent) },",
  ]) {
    assert.ok(src.includes(line), line);
  }
  assert.match(src, /await notePlannerIssue\(env, user, \{ stage: 'save', error: e, draftId: p && p\.id, rev: p && p\.rev \}\);\s+throw e;/);
  assert.match(src, /await notePlannerIssue\(env, user, \{ stage: 'learn', error: e, draftId: params && params\.id, rev: body && body\.rev \}\);\s+throw e;/);
});
