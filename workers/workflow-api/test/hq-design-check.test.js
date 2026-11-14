/**
 * 다담 본사 › 설계 · 학습 점검 (src/hq-design-check.js — DB 0067)
 *
 *   보는 사람: 다담 본사 대표 · 실장만 (아니면 403 not_platform)
 *   한눈에: 업체별 저장 · 가는 길의 수 · 지난 7일 실패 · 점검 기록 — 시험 설계(probe-)는 세지 않는다
 *   검토 줄: 설계 구성 · 장소는 시 · 군 · 구까지 · 사진은 그 묶음 자리의 서명 주소, 검토는 표본마다 한 줄 (제외 = reject)
 *   점검: 시험 설계 하나로 저장 → 읽기 → 묶음 → 수집 → 내보내기 막힘. 매일 07:00 한 번, 막힌 날만 알림
 * 사람 · 업체 · 설계 · 주소는 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { buildMessage, HQ_DESIGN_CHECK_URL, isValidMessage } from '../src/push/messages.js';
import {
  CHECK_KIND,
  DAILY_CHECK_UTC,
  INGEST_STALE_MIN,
  PROBE_DRAFT_ID,
  REVIEW_GRADES,
  REVIEW_REASONS,
  compositionOf,
  pcGroupKey,
  photoRefOf,
  designCheckSummary,
  groupOf,
  isDailyCheckTime,
  kstDate,
  listDesignReviews,
  regionOf,
  runCheckSteps,
  runDailyDesignCheck,
  runDesignCheck,
  webGroupKey,
  writeDesignReview,
} from '../src/hq-design-check.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const PLATFORM = 'f0000000-0000-4000-8000-0000000000c1';
const HQ = 'f0000000-0000-4000-8000-0000000000aa';
const P1 = 'f0000000-0000-4000-8000-0000000000b1';
const P2 = 'f0000000-0000-4000-8000-0000000000b2';
const BOSS = 'a0000000-0000-4000-8000-000000000001'; // 다담 본사 대표
const BOSS2 = 'a0000000-0000-4000-8000-000000000002'; // 다담 본사 실장
const HQ_STAFF = 'a0000000-0000-4000-8000-000000000003'; // 다담 본사 직원
const P1_OWNER = 'a0000000-0000-4000-8000-000000000004';
const APP_DESIGN = 'd0000000-0000-4000-8000-000000000001';
const u = (id) => ({ id });
const NOW = Date.parse('2026-11-14T03:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const GK1 = webGroupKey(P1, 'design-aaaa-0001');
const PCK = pcGroupKey('design-pc01-0001');
const PCK2 = pcGroupKey('design-pc02-0001');

const json = (rows, status = 200) => ({
  ok: status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => rows,
  text: async () => JSON.stringify(rows),
});

function makeDb(over = {}) {
  return {
    companies: [
      { id: PLATFORM, kind: 'platform', name: '다담 본사', plan: null, status: 'active' },
      { id: HQ, kind: 'hq', name: '다담 공장', plan: null, status: 'active' },
      { id: P1, kind: 'partner', name: '가나 팩토리', plan: 'expert', status: 'active' },
      { id: P2, kind: 'partner', name: '다라 팩토리', plan: 'agent', status: 'active' },
    ],
    company_members: [
      { user_id: BOSS, company_id: PLATFORM, role: 'owner', status: 'active' },
      { user_id: BOSS2, company_id: PLATFORM, role: 'manager', status: 'active' },
      { user_id: HQ_STAFF, company_id: PLATFORM, role: 'staff', status: 'active' },
      { user_id: P1_OWNER, company_id: P1, role: 'owner', status: 'active' },
    ],
    admin_roles: [],
    planner_drafts: [],
    planner_draft_learn: [],
    planner_save_issues: [],
    company_consents: [],
    dataset_samples: [],
    dataset_exportable: [],
    dataset_reviews: [],
    dataset_ingest_state: [{ src_table: 'planner_drafts', last_run: iso(NOW - 5 * 60000), last_count: 1, last_error: null }],
    system_checks: [],
    planner_completions: [],
    design_site_info: [],
    notification_outbox: [],
    signed: [],
    deletes: [],
    ...over,
  };
}

const KEYS = { planner_drafts: ['company_id', 'id'], planner_draft_learn: ['company_id', 'draft_id'] };

/** 칸 값 — attrs->>grade 같은 JSON 화살표도 (PostgREST 처럼 글자로) */
function valueOf(row, key) {
  const m = /^([a-z_]+)->>([a-z_]+)$/.exec(key);
  if (!m) return row[key];
  const o = row[m[1]];
  const v = o && typeof o === 'object' ? o[m[2]] : undefined;
  return v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v);
}

function matches(row, key, expr) {
  if (key === 'or') {
    return expr
      .replace(/^\(|\)$/g, '')
      .split(',')
      .some((part) => matches(row, part.slice(0, part.indexOf('.')), part.slice(part.indexOf('.') + 1)));
  }
  const v = valueOf(row, key);
  if (expr === 'is.null') return v === null || v === undefined;
  if (expr === 'not.is.null') return v !== null && v !== undefined;
  if (expr === 'is.true') return v === true;
  if (expr === 'is.false') return v === false;
  const m = /^(eq|gte|lt|in)\.([\s\S]*)$/.exec(expr);
  if (!m) throw new Error(`가짜 DB: 모르는 필터 ${key}=${expr}`);
  if (m[1] === 'eq') return String(v) === m[2];
  if (m[1] === 'gte') return String(v) >= m[2];
  if (m[1] === 'lt') return String(v) < m[2];
  return m[2].replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(v));
}

let seq = 0;
async function withDb(db, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const s = String(url);
    const method = init.method || 'GET';
    if (s.includes('/storage/v1/object/sign/')) {
      const { paths } = JSON.parse(init.body);
      const bucket = s.split('/storage/v1/object/sign/')[1];
      db.signed.push(...paths.map((p) => (bucket === 'planner-photos' ? p : `${bucket}:${p}`)));
      return json(paths.map((p) => ({ path: p, signedURL: `/object/sign/${bucket}/${p}?token=t` })));
    }
    const m = /\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/.exec(s);
    if (!m) throw new Error(`unexpected fetch ${method} ${s}`);
    const [, table, qs = ''] = m;
    if (db[table] === null) return json({ code: '42P01', message: `relation "public.${table}" does not exist` }, 404);
    if (!db[table]) throw new Error(`unexpected table ${table}`);
    const q = new URLSearchParams(qs);
    const filters = [...q.entries()].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
    const hit = () => db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e)));
    if (method === 'GET') {
      let rows = hit();
      const order = q.get('order');
      if (order) {
        const [col, dir] = order.split('.');
        rows = rows.slice().sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      const sel = q.get('select') || '';
      rows = rows.map((r) => ({ ...r, ...(sel.includes('grade:attrs->>grade') ? { grade: (r.attrs || {}).grade || null } : {}), ...(sel.includes('kind:attrs->>kind') ? { kind: (r.attrs || {}).kind || null } : {}) }));
      return json(rows.slice(0, Number(q.get('limit')) || rows.length));
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const list = Array.isArray(body) ? body : [body];
      if (db.failInsert && db.failInsert(table)) return json({ code: 'XX000', message: 'boom' }, 500);
      const keys = KEYS[table];
      if (keys && list.some((b) => db[table].some((r) => keys.every((k) => r[k] === b[k])))) return json({ code: '23505', message: 'duplicate key 23505' }, 409);
      if (table === 'system_checks' && list.some((b) => b.cause === 'daily' && db.system_checks.some((r) => r.cause === 'daily' && r.run_date === b.run_date))) return json({ code: '23505', message: 'duplicate key 23505' }, 409);
      const rows = list.map((b) => ({ id: crypto.randomUUID(), created_at: iso(NOW + (seq += 1)), updated_at: iso(NOW + seq), discarded_at: null, ...b }));
      db[table].push(...rows);
      return json(rows, 201);
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(init.body);
      const rows = hit();
      rows.forEach((r) => Object.assign(r, patch, { updated_at: iso(NOW + (seq += 1)) }));
      return json(rows);
    }
    if (method === 'DELETE') {
      db.deletes.push(`${table}?${decodeURIComponent(qs)}`);
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

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

async function rejects(p, status, code) {
  await assert.rejects(p, (e) => {
    assert.equal(e.statusCode, status, e.message);
    if (code) assert.equal(e.code, code);
    return true;
  });
}

const record = () => ({
  item: 'sink',
  design: {
    walls: [
      { name: '공간 A', length: 3000, lines: { floor: [{ libId: 'LB-D2-900' }, { libId: 'LB-SINK-1000', W: 1050 }, { libId: 'TL-A', tiers: ['TT-1'] }], upper: [{ libId: 'UB-D2-900-L' }], under: [] } },
    ],
  },
});
const designSample = (gk, over = {}) => ({
  sample_id: gk,
  group_key: gk,
  src_table: 'planner_drafts',
  image_url: null,
  needs_review: true,
  label_source: 'structured',
  space: 'kitchen',
  furniture: 'sink',
  layout_shape: 'I',
  design_id: null,
  attrs: { record: record(), web: { rev: 3, company_kind: 'partner' } },
  updated_at: iso(NOW - 60000),
  ...over,
});
const photoSample = (gk, file, over = {}) => {
  const g = groupOf(gk);
  return {
    sample_id: `${gk}:photo:${file.replace(/\.jpg$/, '')}`,
    group_key: gk,
    src_table: 'planner_drafts',
    image_url: `https://x.supabase.co/storage/v1/object/authenticated/planner-photos/${g.companyId}/${g.draftId}/${file}`,
    needs_review: true,
    phase: 'after',
    media: 'photo',
    attrs: { kind: 'complete' },
    ...over,
  };
};

const pcDesign = (gk, over = {}) => ({
  sample_id: gk,
  group_key: gk,
  src_table: 'planner_lite',
  image_url: null,
  needs_review: false,
  label_source: 'structured',
  space: 'kitchen',
  furniture: 'sink',
  layout_shape: 'L',
  design_id: null,
  attrs: { record: record() },
  updated_at: iso(NOW - 120000),
  ...over,
});
const pcPhoto = (gk, file, over = {}) => ({
  sample_id: `${gk}:photo:${file.replace(/\.jpg$/, '')}`,
  group_key: gk,
  src_table: 'planner_lite',
  image_url: `https://x.supabase.co/storage/v1/object/public/design-images/planner-lite/${groupOf(gk).designId}/${file}`,
  needs_review: false,
  phase: 'after',
  media: 'photo',
  attrs: { kind: 'complete' },
  ...over,
});

test('묶음 키 · 장소 · 날짜 · 시각 · 구성 요약', () => {
  assert.deepEqual(groupOf(GK1), { kind: 'web', companyId: P1, draftId: 'design-aaaa-0001' });
  assert.deepEqual(groupOf(PCK), { kind: 'pc', designId: 'design-pc01-0001' });
  assert.equal(groupOf('ohouse:123'), null);
  assert.equal(groupOf('planner-lite:design:../x'), null);
  assert.equal(groupOf(`planner-web:${P1}:../x`), null);
  // 주소는 시 · 군 · 구까지만
  assert.equal(regionOf('대구 북구 합성로 12 301호'), '대구 북구');
  assert.equal(regionOf('  경북   경산시  합성읍 1-2 '), '경북 경산시');
  assert.equal(regionOf('대구'), '');
  assert.equal(regionOf(null), '');
  assert.equal(kstDate(Date.parse('2026-11-13T22:00:00Z')), '2026-11-14');
  assert.deepEqual(DAILY_CHECK_UTC, { hour: 22, minute: 0 }, '07:00 KST');
  assert.equal(isDailyCheckTime(Date.parse('2026-11-13T22:00:30Z')), true);
  assert.equal(isDailyCheckTime(Date.parse('2026-11-13T22:01:00Z')), false);
  assert.deepEqual(compositionOf(record()), [
    { name: '공간 A', length: 3000, lines: { floor: [{ id: 'LB-D2-900', w: 900 }, { id: 'LB-SINK-1000', w: 1050 }, { id: 'TL-A', w: null }], upper: [{ id: 'UB-D2-900-L', w: 900 }] } },
  ]);
  assert.deepEqual(compositionOf(null), []);
});

test('누가 보나 — 다담 본사 대표 · 실장만 (직원 · 협력업체 대표는 403 not_platform)', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    for (const who of [HQ_STAFF, P1_OWNER]) {
      await rejects(designCheckSummary(ENV, { user: u(who) }), 403, 'not_platform');
      await rejects(listDesignReviews(ENV, { user: u(who), query: {} }), 403, 'not_platform');
      await rejects(writeDesignReview(ENV, { user: u(who), body: { company_id: P1, draft_id: 'design-aaaa-0001', grade: 'good' } }), 403, 'not_platform');
      await rejects(runDesignCheck(ENV, { user: u(who) }), 403, 'not_platform');
    }
    assert.ok(await designCheckSummary(ENV, { user: u(BOSS2) }));
    assert.equal(db.dataset_reviews.length + db.system_checks.length, 0);
  });
});

test('한눈에 — 업체별 저장 · 묶음 · 실패, 가는 길의 수, 사진 제공, 시험 설계는 세지 않는다', async () => {
  const db = makeDb({
    planner_drafts: [
      { company_id: P1, id: 'design-aaaa-0001', updated_at: iso(NOW - 3600e3), discarded_at: null },
      { company_id: P1, id: 'design-aaaa-0002', updated_at: iso(NOW - 60e3), discarded_at: null },
      { company_id: P1, id: 'design-gone-0001', updated_at: iso(NOW), discarded_at: iso(NOW) },
      { company_id: HQ, id: PROBE_DRAFT_ID, updated_at: iso(NOW), discarded_at: null },
    ],
    planner_draft_learn: [
      { company_id: P1, draft_id: 'design-aaaa-0001', pending: false, ingest_error: null },
      { company_id: P1, draft_id: 'design-aaaa-0002', pending: true, ingest_error: '설계 레코드가 없습니다' },
      { company_id: HQ, draft_id: PROBE_DRAFT_ID, pending: true, ingest_error: null },
    ],
    planner_save_issues: [
      { company_id: P1, stage: 'save', code: 'conflict', source: 'server', created_at: iso(NOW - 3600e3) },
      { company_id: P1, stage: 'save', code: 'conflict', source: 'server', created_at: iso(NOW - 7200e3) },
      { company_id: null, stage: 'save', code: 'offline', source: 'client', created_at: iso(NOW - 7200e3) },
      { company_id: P1, stage: 'save', code: 'conflict', source: 'server', created_at: iso(Date.now() - 9 * 86400e3) },
    ],
    company_consents: [
      { company_id: P1, kind: 'planner_photo_learning', granted: true, created_at: iso(NOW - 2) },
      { company_id: P1, kind: 'planner_photo_learning', granted: false, created_at: iso(NOW - 1) },
    ],
    dataset_samples: [
      designSample(GK1, { needs_review: false, label_source: 'human', design_id: APP_DESIGN, attrs: { grade: 'good' } }),
      designSample(webGroupKey(P1, 'design-aaaa-0002')),
      photoSample(GK1, 'photo-a1b2c3.jpg'),
    ],
    dataset_exportable: [designSample(GK1), pcDesign(PCK)],
    planner_completions: [{ group_key: PCK }],
    system_checks: [{ id: 'c1', kind: CHECK_KIND, cause: 'daily', run_date: '2026-11-14', ok: true, steps: [{ key: 'save', ok: true }], created_at: iso(NOW) }],
  });
  db.dataset_samples.push(pcDesign(PCK, { attrs: { record: record(), grade: 'good' } }), pcDesign(PCK2), pcPhoto(PCK, 'photo-pc0001.jpg'), pcPhoto(PCK, 'photo-pc0002.jpg'));
  // 실패 기록의 「지난 7일」은 지금 시각 기준이라, 시험 줄의 때를 지금 쪽으로 옮긴다
  db.planner_save_issues.slice(0, 3).forEach((r, i) => { r.created_at = iso(Date.now() - (i + 1) * 3600e3); });
  await withDb(db, async () => {
    const s = await designCheckSummary(ENV, { user: u(BOSS) });
    assert.deepEqual(s.companies.map((c) => [c.name, c.photos, c.drafts, c.bundles, c.pending, c.failed, c.issues]), [
      ['다담 공장', 'always', 0, 0, 0, 0, 0],
      ['가나 팩토리', 'off', 2, 2, 1, 1, 2],
    ]);
    assert.equal(s.companies[1].last_saved, iso(NOW - 60e3));
    assert.deepEqual(s.funnel, { drafts: 2, bundles: 2, pending: 1, failed: 1, samples: 2, waiting: 1, good: 1, normal: 0, exclude: 0, linked: 1, exportable: 1 });
    assert.deepEqual(s.issues, { days: 7, total: 3, by_code: [{ stage: 'save', code: 'conflict', n: 2 }, { stage: 'save', code: 'offline', n: 1 }] });
    assert.deepEqual(s.checks.map((c) => [c.cause, c.run_date, c.ok]), [['daily', '2026-11-14', true]]);
    assert.equal(s.ingest.last_count, 1);
    // PC 플래너 「앱 창고로 올리기」로 올라온 것 — 앱 플래너 수와 섞지 않고 따로
    assert.deepEqual(s.pc, { designs: 2, photos: 2, completed: 1, graded: 1, exportable: 1 });
  });
});

test('검토 줄 — 설계 구성 · 장소는 시 · 군 · 구까지 · 사진은 그 묶음 자리 것만 서명 주소로', async () => {
  const other = webGroupKey(P2, 'design-bbbb-0001');
  const db = makeDb({
    planner_drafts: [
      { company_id: P1, id: 'design-aaaa-0001', name: '합성 주방', item: 'sink', rev: 5, summary: { completed: true }, updated_at: iso(NOW), discarded_at: null },
    ],
    dataset_samples: [
      designSample(GK1, { design_id: APP_DESIGN }),
      photoSample(GK1, 'photo-a1b2c3.jpg'),
      // 남의 자리를 가리키는 주소 · 다른 버킷 — 서명하지 않는다
      photoSample(GK1, 'photo-evil01.jpg', { image_url: `https://x.supabase.co/storage/v1/object/authenticated/planner-photos/${P2}/design-bbbb-0001/photo-evil01.jpg` }),
      photoSample(GK1, 'photo-evil02.jpg', { image_url: 'https://x.supabase.co/storage/v1/object/authenticated/design-images/x/y.jpg' }),
      designSample(other, { needs_review: false, label_source: 'human', attrs: { record: record(), web: { rev: 2 }, grade: 'normal', grade_reasons: ['photo_blur', 'x'], reviewed_rev: 2 } }),
    ],
    design_site_info: [{ design_id: APP_DESIGN, address: '대구 북구 합성로 12 301호' }],
  });
  await withDb(db, async () => {
    const w = await listDesignReviews(ENV, { user: u(BOSS), query: {} });
    assert.equal(w.state, 'waiting');
    assert.equal(w.items.length, 1);
    const it = w.items[0];
    assert.deepEqual(
      [it.company, it.name, it.item, it.region, it.rev_now, it.rev_bundle, it.reviewed_rev, it.grade, it.linked, it.completed, it.modules, it.photo_count],
      ['가나 팩토리', '합성 주방', 'sink', '대구 북구', 5, 3, null, null, true, true, 4, 3]
    );
    assert.equal(it.photos.length, 1);
    assert.equal(it.photos[0].url, `https://x.supabase.co/storage/v1/object/sign/planner-photos/${P1}/design-aaaa-0001/photo-a1b2c3.jpg?token=t`);
    assert.deepEqual(db.signed, [`${P1}/design-aaaa-0001/photo-a1b2c3.jpg`]);
    assert.ok(!JSON.stringify(w).includes('합성로'), '주소의 뒤는 싣지 않는다');
    // 검토한 것 — 등급 · 까닭(아는 것만) · 본 rev, 설계가 없어졌으면 gone
    const d = await listDesignReviews(ENV, { user: u(BOSS), query: { state: 'done' } });
    assert.deepEqual(d.items.map((x) => [x.company, x.grade, x.reasons, x.reviewed_rev, x.gone, x.name]), [['다라 팩토리', 'normal', ['photo_blur'], 2, true, '']]);
  });
});

test('검토 줄 — PC 플래너로 올라온 설계도 같이: 다담 공장 · 시공 완료 확인 · 내보낼 수 있나 · 사진은 그 설계 자리 것만', async () => {
  const db = makeDb({
    planner_drafts: [{ company_id: P1, id: 'design-aaaa-0001', name: '합성 주방', item: 'sink', rev: 5, summary: {}, updated_at: iso(NOW), discarded_at: null }],
    dataset_samples: [
      designSample(GK1),
      pcDesign(PCK, { design_id: APP_DESIGN }),
      pcDesign(PCK2),
      pcPhoto(PCK, 'photo-pc0001.jpg'),
      // 다른 설계 자리를 가리키는 주소 — 서명하지 않는다
      pcPhoto(PCK, 'photo-evil01.jpg', { image_url: 'https://x.supabase.co/storage/v1/object/public/design-images/planner-lite/design-pc02-0001/photo-evil01.jpg' }),
      pcPhoto(PCK, 'photo-evil02.jpg', { image_url: 'https://x.supabase.co/storage/v1/object/public/design-images/someone/site_photo/1.jpg' }),
    ],
    planner_completions: [{ group_key: PCK }, { group_key: 'not-a-planner-key' }],
    dataset_exportable: [pcDesign(PCK)],
    design_site_info: [{ design_id: APP_DESIGN, address: '경북 경산시 합성읍 1-2' }],
  });
  await withDb(db, async () => {
    const w = await listDesignReviews(ENV, { user: u(BOSS), query: {} });
    assert.deepEqual(w.items.map((x) => [x.source, x.group_key, x.company, x.completed, x.exportable]), [
      ['web', GK1, '가나 팩토리', false, false],
      ['pc', PCK, '다담 공장', true, true],
      ['pc', PCK2, '다담 공장', false, false],
    ]);
    const pc = w.items[1];
    assert.deepEqual([pc.draft_id, pc.name, pc.item, pc.region, pc.rev_now, pc.gone, pc.modules, pc.photo_count], ['design-pc01-0001', '', 'sink', '경북 경산시', null, false, 4, 3]);
    assert.deepEqual(pc.photos.map((p) => p.url), ['https://x.supabase.co/storage/v1/object/sign/design-images/planner-lite/design-pc01-0001/photo-pc0001.jpg?token=t']);
    assert.deepEqual(db.signed, ['design-images:planner-lite/design-pc01-0001/photo-pc0001.jpg']);
    // 시공 완료 확인된 것만
    const c = await listDesignReviews(ENV, { user: u(BOSS), query: { only: 'completed' } });
    assert.deepEqual([c.only, c.items.map((x) => x.group_key)], ['completed', [PCK]]);
    // 등급을 매기면 「기다림」에서 빠지고 「검토함」으로 (PC 것은 묶음 키로 쓴다)
    const r = await writeDesignReview(ENV, { user: u(BOSS), body: { group_key: PCK, grade: 'normal', reasons: ['incomplete'] } });
    assert.deepEqual(r, { reviewed: 4, grade: 'normal', reasons: ['incomplete'], src_rev: null });
    assert.deepEqual(db.dataset_reviews.map((x) => x.verdict), ['confirm', 'confirm', 'confirm', 'confirm']);
    await rejects(writeDesignReview(ENV, { user: u(BOSS), body: { group_key: 'ohouse:1', grade: 'good' } }), 422);
    // (가짜 DB 는 지킴이가 없어 등급을 손으로 적는다 — 실DB 는 apply_dataset_review_grade 가 적는다)
    db.dataset_samples.find((x) => x.sample_id === PCK).attrs.grade = 'normal';
    const after = await listDesignReviews(ENV, { user: u(BOSS), query: {} });
    assert.deepEqual(after.items.map((x) => x.group_key), [GK1, PCK2]);
    const d = await listDesignReviews(ENV, { user: u(BOSS), query: { state: 'done' } });
    assert.deepEqual(d.items.map((x) => [x.group_key, x.grade]), [[PCK, 'normal']]);
  });
  // 시공 완료 확인이 하나도 없으면 빈 목록 (표본을 읽지 않는다)
  const none = makeDb({ dataset_samples: [pcDesign(PCK)] });
  await withDb(none, async () => assert.deepEqual(await listDesignReviews(ENV, { user: u(BOSS), query: { only: 'completed' } }), { state: 'waiting', only: 'completed', items: [] }));
});

test('검토 줄 — 검토한 뒤 설계가 바뀌어 다시 검토가 필요한 것은 등급이 있어도 「기다림」', async () => {
  const db = makeDb({
    planner_drafts: [{ company_id: P1, id: 'design-aaaa-0001', name: '합성 주방', item: 'sink', rev: 6, summary: { completed: true }, updated_at: iso(NOW), discarded_at: null }],
    dataset_samples: [designSample(GK1, { needs_review: true, label_source: 'human', attrs: { record: record(), web: { rev: 6 }, grade: 'good', reviewed_rev: 4 } })],
  });
  await withDb(db, async () => {
    const w = await listDesignReviews(ENV, { user: u(BOSS), query: {} });
    assert.deepEqual(w.items.map((x) => [x.grade, x.reviewed_rev, x.rev_now, x.completed]), [['good', 4, 6, true]]);
    assert.deepEqual((await listDesignReviews(ENV, { user: u(BOSS), query: { state: 'done' } })).items, []);
    assert.deepEqual((await listDesignReviews(ENV, { user: u(BOSS), query: { only: 'completed' } })).items.map((x) => x.group_key), [GK1]);
  });
});

test('사진 자리 — 그 묶음의 자리만 (남의 업체 · 다른 설계 · 다른 버킷 · 위로 올라가는 길은 null)', () => {
  const web = (url) => photoRefOf({ group_key: GK1, image_url: url });
  assert.deepEqual(web(`https://x/storage/v1/object/authenticated/planner-photos/${P1}/design-aaaa-0001/a.jpg`), { bucket: 'planner-photos', path: `${P1}/design-aaaa-0001/a.jpg` });
  assert.equal(web(`https://x/storage/v1/object/authenticated/planner-photos/${P2}/design-aaaa-0001/a.jpg`), null);
  assert.equal(web('https://x/storage/v1/object/public/design-images/planner-lite/design-aaaa-0001/a.jpg'), null);
  const pc = (url) => photoRefOf({ group_key: PCK, image_url: url });
  assert.deepEqual(pc('https://x/storage/v1/object/public/design-images/planner-lite/design-pc01-0001/a.jpg'), { bucket: 'design-images', path: 'planner-lite/design-pc01-0001/a.jpg' });
  assert.equal(pc('https://x/storage/v1/object/public/design-images/planner-lite/design-pc01-0001/../design-pc02-0001/a.jpg'), null);
  assert.equal(pc('https://x/storage/v1/object/public/design-images/customer-folder/a.jpg'), null);
  assert.equal(photoRefOf({ group_key: 'ohouse:1', image_url: 'https://x/a.jpg' }), null);
});

test('검토 쓰기 — 묶음의 표본마다 한 줄 (제외 = reject), 본 rev 를 같이, 값은 먼저 거른다', async () => {
  assert.deepEqual([...REVIEW_GRADES], ['good', 'normal', 'exclude']);
  assert.deepEqual([...REVIEW_REASONS], ['dimension', 'incomplete', 'photo_blur', 'test']);
  const db = makeDb({ dataset_samples: [designSample(GK1), photoSample(GK1, 'photo-a1b2c3.jpg')] });
  await withDb(db, async () => {
    const base = { company_id: P1, draft_id: 'design-aaaa-0001' };
    for (const bad of [
      { ...base, grade: 'great' },
      { ...base },
      { ...base, grade: 'normal', reasons: ['ugly'] },
      { ...base, grade: 'good', reasons: ['test'] },
      { company_id: 'x', draft_id: 'design-aaaa-0001', grade: 'good' },
      { company_id: P1, draft_id: '../x', grade: 'good' },
    ]) {
      await rejects(writeDesignReview(ENV, { user: u(BOSS), body: bad }), 422);
    }
    await rejects(writeDesignReview(ENV, { user: u(BOSS), body: { company_id: P2, draft_id: 'design-none-0001', grade: 'good' } }), 404);
    assert.equal(db.dataset_reviews.length, 0);
    const r = await writeDesignReview(ENV, { user: u(BOSS), body: { ...base, grade: 'exclude', reasons: ['test', 'test', 'dimension'] } });
    assert.deepEqual(r, { reviewed: 2, grade: 'exclude', reasons: ['test', 'dimension'], src_rev: 3 });
    assert.deepEqual(
      db.dataset_reviews.map((x) => [x.sample_id, x.reviewer, x.verdict, x.grade, x.reasons, x.src_rev]),
      [
        [GK1, BOSS, 'reject', 'exclude', ['test', 'dimension'], 3],
        [`${GK1}:photo:photo-a1b2c3`, BOSS, 'reject', 'exclude', ['test', 'dimension'], 3],
      ]
    );
    await writeDesignReview(ENV, { user: u(BOSS2), body: { ...base, grade: 'good' } });
    assert.deepEqual(db.dataset_reviews.slice(2).map((x) => [x.verdict, x.grade, x.reasons, x.reviewer]), [['confirm', 'good', [], BOSS2], ['confirm', 'good', [], BOSS2]]);
  });
});

test('점검 걸음 — 시험 설계 하나를 다담 공장에 고쳐 쓴다 (새로 쌓지 않는다), 다섯 걸음 모두 됨', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const r1 = await runCheckSteps(ENV, { userId: BOSS, nowMs: NOW });
    assert.deepEqual(r1.steps.map((s) => [s.key, s.ok]), [['save', true], ['read', true], ['learn', true], ['ingest', true], ['export_block', true]]);
    assert.equal(r1.ok, true);
    assert.deepEqual(db.planner_drafts.map((d) => [d.company_id, d.id, d.rev, d.created_by]), [[HQ, PROBE_DRAFT_ID, 1, BOSS]]);
    assert.deepEqual(db.planner_draft_learn.map((l) => [l.company_id, l.draft_id, l.rev]), [[HQ, PROBE_DRAFT_ID, 1]]);
    // 다시 — 같은 줄을 고친다 (사람 없이도 — 매일 점검)
    const r2 = await runCheckSteps(ENV, { userId: null, nowMs: NOW + 60000 });
    assert.equal(r2.ok, true);
    assert.equal(db.planner_drafts.length, 1);
    assert.equal(db.planner_drafts[0].rev, 2);
    assert.equal(db.planner_draft_learn.length, 1);
    assert.equal(db.planner_draft_learn[0].rev, 2);
    assert.match(r2.steps[3].note, /마지막 수집 6분 전/);
  });
});

test('점검 걸음 — 수집이 멈췄거나 · 묶음이 오래 기다리거나 · 시험 설계가 학습 자료에 있으면 그 걸음이 막힘', async () => {
  const stale = makeDb({ dataset_ingest_state: [{ src_table: 'planner_drafts', last_run: iso(NOW - (INGEST_STALE_MIN + 5) * 60000), last_error: null }] });
  await withDb(stale, async () => {
    const r = await runCheckSteps(ENV, { nowMs: NOW });
    assert.deepEqual(r.steps.map((s) => s.ok), [true, true, true, false, true]);
    assert.match(r.steps[3].note, /35분 전/);
    assert.equal(r.ok, false);
  });
  const never = makeDb({ dataset_ingest_state: [] });
  await withDb(never, async () => assert.match((await runCheckSteps(ENV, { nowMs: NOW })).steps[3].note, /한 번도 돌지 않았습니다/));
  const stuck = makeDb({ planner_draft_learn: [{ company_id: P1, draft_id: 'design-aaaa-0001', rev: 1, pending: true, updated_at: iso(NOW - 3600e3) }] });
  await withDb(stuck, async () => assert.match((await runCheckSteps(ENV, { nowMs: NOW })).steps[3].note, /기다리는 묶음 1개/));
  const leaked = makeDb({ dataset_samples: [designSample(webGroupKey(HQ, PROBE_DRAFT_ID))] });
  await withDb(leaked, async () => {
    const r = await runCheckSteps(ENV, { nowMs: NOW });
    assert.deepEqual([r.steps[4].ok, r.ok], [false, false]);
  });
});

test('점검 걸음 — 저장이 막히면 읽기 · 묶음은 건너뛰고 나머지는 본다 (던지지 않는다)', async () => {
  const db = makeDb();
  db.failInsert = (table) => table === 'planner_drafts';
  await withDb(db, async () => {
    const r = await runCheckSteps(ENV, { nowMs: NOW });
    assert.deepEqual(r.steps.map((s) => [s.key, s.ok]), [['save', false], ['read', false], ['learn', false], ['ingest', true], ['export_block', true]]);
    assert.equal(r.steps[1].note, '앞 걸음이 막혀 건너뜀');
    assert.equal(r.ok, false);
  });
});

test('지금 점검 — 기록 한 줄(manual · 누른 사람), 0067 적용 전이면 걸음을 밟지 않고 409 db_pending', async (t) => {
  // 시계를 시험 자료 시각(NOW)에 고정한다 — runDesignCheck 는 Date.now() 로 「마지막 수집이 몇 분 전」을 재는데 자료의 last_run 은 NOW 기준이라,
  //   고정하지 않으면 그 시각에서 INGEST_STALE_MIN 분이 지난 뒤부터 이 시험이 떨어진다 (2026-11-14 모든 PR 의 CI 를 막았다)
  const realNow = Date.now;
  Date.now = () => NOW;
  t.after(() => {
    Date.now = realNow;
  });
  const db = makeDb();
  await withDb(db, async () => {
    const r = await runDesignCheck(ENV, { user: u(BOSS) });
    assert.equal(r.ok, true);
    assert.equal(r.steps.length, 5);
    assert.deepEqual(db.system_checks.map((c) => [c.kind, c.cause, c.ok, c.run_by, c.steps.length]), [[CHECK_KIND, 'manual', true, BOSS, 5]]);
    assert.match(db.system_checks[0].run_date, /^\d{4}-\d{2}-\d{2}$/);
    await runDesignCheck(ENV, { user: u(BOSS2) });
    assert.equal(db.system_checks.length, 2, '사람이 누른 점검은 같은 날에도 쌓인다');
  });
  const before = makeDb({ system_checks: null });
  await withDb(before, async () => {
    await rejects(runDesignCheck(ENV, { user: u(BOSS) }), 409, 'db_pending');
    await rejects(designCheckSummary(ENV, { user: u(BOSS) }), 409, 'db_pending');
    assert.equal(before.planner_drafts.length, 0, '시험 설계를 쓰지 않는다');
  });
});

test('매일 점검 — 07:00 한 번, 되면 알림 없음 · 30일 지난 실패 기록 지우기, 같은 날 두 번째는 건너뛴다', async () => {
  const at = Date.parse('2026-11-13T22:00:10Z');
  const db = makeDb({
    dataset_ingest_state: [{ src_table: 'planner_drafts', last_run: iso(at - 60000), last_error: null }],
    planner_save_issues: [
      { company_id: P1, stage: 'save', code: 'conflict', created_at: iso(at - 31 * 86400e3) },
      { company_id: P1, stage: 'save', code: 'conflict', created_at: iso(at - 86400e3) },
    ],
  });
  await withDb(db, async () => {
    assert.deepEqual(await runDailyDesignCheck(ENV, { nowMs: at - 3600e3 }), { ran: false });
    assert.equal(db.system_checks.length, 0);
    assert.deepEqual(await runDailyDesignCheck(ENV, { nowMs: at }), { ran: true, ok: true });
    assert.deepEqual(db.system_checks.map((c) => [c.cause, c.run_date, c.ok, c.run_by]), [['daily', '2026-11-14', true, undefined]]);
    assert.equal(db.planner_save_issues.length, 1, '30일 지난 줄만 지운다');
    assert.match(db.deletes[0], /^planner_save_issues\?created_at=lt\./);
    assert.equal(db.notification_outbox.length, 0);
    assert.deepEqual(await runDailyDesignCheck(ENV, { nowMs: at + 20000 }), { ran: false, dup: true });
    assert.equal(db.system_checks.length, 1);
    assert.equal(db.planner_drafts[0].rev, 1, '두 번째는 시험 설계도 건드리지 않는다');
  });
});

test('매일 점검 — 막힌 날만 다담 본사 대표 · 실장에게 알림 (직원 · 협력업체는 아님), 0067 적용 전이면 조용히', async () => {
  const at = Date.parse('2026-11-13T22:00:00Z');
  const db = makeDb({ dataset_ingest_state: [] });
  await withDb(db, async () => {
    assert.deepEqual(await runDailyDesignCheck(ENV, { nowMs: at }), { ran: true, ok: false });
    assert.deepEqual(db.notification_outbox.map((n) => [n.user_id, n.company_id, n.kind, n.url]).sort(), [
      [BOSS, PLATFORM, 'system_check_failed', HQ_DESIGN_CHECK_URL],
      [BOSS2, PLATFORM, 'system_check_failed', HQ_DESIGN_CHECK_URL],
    ]);
    assert.equal(db.notification_outbox[0].body, '오늘 점검에서 막힌 곳이 1곳 있습니다. 본사 메뉴의 설계 · 학습 점검에서 확인해 주세요.');
    assert.equal(db.notification_outbox[0].ref_id, db.system_checks[0].id, '점검 기록 한 줄에 알림 한 번 (dedupe)');
  });
  const before = makeDb({ system_checks: null });
  await withDb(before, async () => {
    assert.deepEqual(await runDailyDesignCheck(ENV, { nowMs: at }), { ran: false, error: true });
    assert.equal(before.planner_drafts.length, 0);
  });
});

test('알림 글 — 막힌 걸음 수만 (무엇이 막혔는지는 화면에서), 0 이면 만들지 않는다', () => {
  const m = buildMessage('system_check_failed', { failed: 2 });
  assert.deepEqual(m, { title: '설계 저장 · 학습 점검', body: '오늘 점검에서 막힌 곳이 2곳 있습니다. 본사 메뉴의 설계 · 학습 점검에서 확인해 주세요.', url: '/segan/me.html#hq-design-check' });
  assert.ok(isValidMessage(m));
  assert.equal(buildMessage('system_check_failed', { failed: 0 }), null);
  assert.equal(buildMessage('system_check_failed', {}), null);
});

test('라우터 — 길 넷이 이어져 있고, 매일 점검은 그 시각에만 건다', () => {
  const src = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  for (const line of [
    "{ method: 'GET',    path: '/hq/design-check',                    auth: 'jwt', handler: workRoute(designCheckSummary) },",
    "{ method: 'GET',    path: '/hq/design-check/reviews',            auth: 'jwt', handler: workRoute(listDesignReviews) },",
    "{ method: 'POST',   path: '/hq/design-check/reviews',            auth: 'jwt', handler: workRoute(writeDesignReview, 201) },",
    "{ method: 'POST',   path: '/hq/design-check/run',                auth: 'jwt', handler: workRoute(runDesignCheck) },",
  ]) {
    assert.ok(src.includes(line), line);
  }
  assert.ok(src.includes('if (isDailyCheckTime(event.scheduledTime)) ctx.waitUntil(runDailyDesignCheck(env, { nowMs: event.scheduledTime }));'));
});
