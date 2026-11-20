/**
 * 간편 플래너 지시서 미리보기 — POST /planner/preview (src/planner-preview.js)
 *   (2026-11-20 사장님 「앱으로 보내기 전에 작업지시서 바로 확인 할 수 있도록 도면까지」 · 「앱 지시서 그대로, 저장 없이」)
 *   · 보내기와 같은 검사 · 같은 보내는 사람 · 등급 규칙, 아무것도 쓰지 않는다 (POST · 버킷 없음)
 *   · 발행과 같은 칸(docPayloadOf)으로 인쇄 틀 그대로 — 그림은 본문 SVG 를 data: 주소로
 *   · 앱에 같은 플래너 설계가 있으면 현장 정보만 읽는다
 * 사람 · 설계는 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearHqCompanyCache, ForbiddenError, ValidationError } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { previewPlannerDoc, previewRendersOf, withBanner, PREVIEW_DOC_TYPES } from '../src/planner-preview.js';
import { docPayloadOf } from '../src/documents.js';
import { HQ, PARTNER, companyRoute } from './fixtures/company.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const P_OWNER = 'a0000000-0000-4000-8000-000000000011';
const S_OWNER = 'a0000000-0000-4000-8000-000000000021';
const STANDARD = 'f0000000-0000-4000-8000-0000000000cc';
const MEMBERS = [
  { user_id: OWNER, company_id: HQ, role: 'owner', status: 'active' },
  { user_id: P_OWNER, company_id: PARTNER, role: 'owner', status: 'active' },
  { user_id: S_OWNER, company_id: STANDARD, role: 'owner', status: 'active' },
];
const COMPANIES = {
  [HQ]: { id: HQ, kind: 'hq', name: '다담 공장', plan: null, status: 'active' },
  [PARTNER]: { id: PARTNER, kind: 'partner', name: '가나 팩토리', plan: 'expert', status: 'active' },
  [STANDARD]: { id: STANDARD, kind: 'partner', name: '다라 팩토리', plan: 'standard', status: 'active' },
};
const json = (rows, status = 200) => ({ ok: true, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });

/** 읽기만 흉내 — 쓰기(POST · PATCH · 버킷)가 오면 시험이 실패한다 */
function fakeSupabase({ existing = null, site = null } = {}) {
  const calls = { writes: [], reads: [] };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      calls.writes.push(method + ' ' + u);
      throw new Error('미리보기가 썼다: ' + method + ' ' + u);
    }
    calls.reads.push(u.split('?')[0].split('/').pop());
    if (/\/companies\?/.test(u) && /kind/.test(new URL(u).searchParams.get('select') || '')) {
      const row = COMPANIES[(new URL(u).searchParams.get('id') || '').replace(/^eq\./, '')];
      return json(row ? [row] : []);
    }
    if (companyRoute(u, { members: MEMBERS })) return companyRoute(u, { members: MEMBERS });
    if (/\/admin_roles\?/.test(u)) return json([]);
    if (/\/designs\?/.test(u)) {
      const q = new URL(u).searchParams;
      if (q.get('source')) return json(existing ? [existing] : []);
      return json(existing ? [{ company_id: HQ, ...existing }] : []);
    }
    if (/\/design_site_info\?/.test(u)) return json(site ? [site] : []);
    if (/\/design_schedules\?/.test(u)) return json([]);
    if (/\/company_settings\?/.test(u)) return json([]);
    return json([]);
  };
  calls.restore = () => { globalThis.fetch = original; };
  return calls;
}

const PLAIN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 400"><rect x="10" y="10" width="300" height="200" fill="none" stroke="#000"/><text x="20" y="30">A벽 2400</text></svg>';

function body(over) {
  return Object.assign({
    planner_design_id: 'proj-test-1',
    title: '시험 설계 (합성)',
    doc_type: 'work_order',
    pack: 'cut',
    design: { source: 'planner-lite', items: [{ uniqueId: 1, categoryId: 'sink', name: '싱크대', w: 2400, modules: [{ pos: 'lower', type: 'door', w: 900 }, { pos: 'upper', type: 'door', w: 900 }] }] },
    bom: { materials: [
      { partId: 'w1/floor/m1|0-lower-0-body:side-0', module: '#1 도어장', part: '측판', material: 'PB', thickness: 15, w: 550, h: 708, qty: 2 },
      { partId: 'w1/floor/m2|0-lower-0-body:side-0', module: '#2 도어장', part: '측판', material: 'PB', thickness: 15, w: 550, h: 708, qty: 2 },
    ] },
    hardware: {},
    renders: [
      { item: 1, kind: 'iso', svg: PLAIN_SVG, width: 900, height: 400 },
      { item: 1, kind: 'layout', svg: PLAIN_SVG, width: 900, height: 400 },
      { item: 1, kind: 'inside', svg: PLAIN_SVG, view: { w: 900, h: 400 }, boxes: [{ nos: [1], x: 10, y: 10, w: 300, h: 200 }] },
    ],
  }, over || {});
}

beforeEach(() => { clearHqCompanyCache(); clearAdminCache(); });

test('미리보기 — 작업지시서 꾸러미를 인쇄 틀 그대로, 아무것도 쓰지 않는다 · 맨 위에 「미리보기」 띠', async () => {
  const f = fakeSupabase();
  try {
    for (const pack of ['cut', 'assembly', 'labels', 'all']) {
      const r = await previewPlannerDoc(ENV, { user: { id: OWNER }, body: body({ pack }) });
      assert.equal(r.doc_type, 'work_order');
      assert.equal(r.pack, pack);
      assert.match(r.html, /^<!doctype html>/i);
      assert.ok(r.html.includes('미리보기 — 저장 · 발행되지 않은 지시서입니다'));
      if (pack !== 'assembly') assert.ok(r.html.includes('측판'), `${pack}: 부재가 나온다`);
      else assert.ok(r.html.includes('조립 지시서'), '조립 꾸러미');
    }
    assert.deepEqual(f.writes, [], '쓰지 않는다');
  } finally { f.restore(); }
});

test('미리보기 — 그림은 본문 SVG 를 data: 주소로 싣는다 (ISO · 배치 평면 · 속 구조)', async () => {
  const f = fakeSupabase();
  try {
    const r = await previewPlannerDoc(ENV, { user: { id: OWNER }, body: body({ doc_type: 'demolition_order', pack: undefined }) });
    assert.equal(r.pack, null);
    assert.match(r.html, /data:image\/svg\+xml;base64,/, '배치 평면 그림');
    const asm = await previewPlannerDoc(ENV, { user: { id: OWNER }, body: body({ pack: 'all' }) });
    assert.match(asm.html, /data:image\/svg\+xml;base64,/);
  } finally { f.restore(); }
  const { collect, urls } = previewRendersOf([
    { item: 7, kind: 'inside', bytes: new TextEncoder().encode(PLAIN_SVG), contentType: 'image/svg+xml', ext: 'svg', width: 900, height: 400, meta: { view: { w: 900, h: 400 }, boxes: [{ nos: [1], x: 1, y: 1, w: 2, h: 2 }] } },
  ]);
  const list = collect('inside', [{ uniqueId: 3 }, { uniqueId: 7 }]);
  assert.deepEqual(list.map((x) => [x.item_index, x.item_unique_id, !!x.path]), [[0, 3, false], [1, 7, true]]);
  assert.deepEqual(list[1].view, { w: 900, h: 400 });
  assert.match(urls.get(list[1].path), /^data:image\/svg\+xml;base64,/);
  assert.deepEqual(collect('iso', [{ uniqueId: 7 }]).map((x) => x.path), [null], '없는 종류는 빈 칸');
});

test('미리보기 — 문서 종류 넷(확인서 없음) · 모르는 꾸러미 · 보내기와 같은 검사는 422', async () => {
  assert.deepEqual([...PREVIEW_DOC_TYPES], ['work_order', 'installation_order', 'demolition_order', 'delivery_order']);
  const f = fakeSupabase();
  try {
    for (const t of PREVIEW_DOC_TYPES) {
      const r = await previewPlannerDoc(ENV, { user: { id: OWNER }, body: body({ doc_type: t }) });
      assert.ok(r.html.length > 1000, t);
    }
    await assert.rejects(() => previewPlannerDoc(ENV, { user: { id: OWNER }, body: body({ doc_type: 'customer_confirmation' }) }), ValidationError);
    await assert.rejects(() => previewPlannerDoc(ENV, { user: { id: OWNER }, body: body({ pack: 'nope' }) }), ValidationError);
    await assert.rejects(() => previewPlannerDoc(ENV, { user: { id: OWNER }, body: body({ title: ' ' }) }), ValidationError);
    const dup = body();
    dup.bom.materials[1].partId = dup.bom.materials[0].partId;
    await assert.rejects(() => previewPlannerDoc(ENV, { user: { id: OWNER }, body: dup }), ValidationError, '부재 ID 겹침');
    await assert.rejects(() => previewPlannerDoc(ENV, { user: { id: OWNER }, body: body({ renders: [{ item: 1, kind: 'iso', svg: '<svg><script>x</script></svg>' }] }) }), ValidationError, '막는 SVG');
    assert.deepEqual(f.writes, []);
  } finally { f.restore(); }
});

test('미리보기 — 보내는 사람 · 등급은 보내기 · 발행과 같다 (Standard 팩토리는 작업지시서 못 냄)', async () => {
  const f = fakeSupabase();
  try {
    const r = await previewPlannerDoc(ENV, { user: { id: P_OWNER }, body: body() });
    assert.equal(r.doc_type, 'work_order');
    await assert.rejects(() => previewPlannerDoc(ENV, { user: { id: S_OWNER }, body: body() }), ForbiddenError);
  } finally { f.restore(); }
});

test('미리보기 — 앱에 같은 설계가 있으면 현장 정보를 읽는다 (없으면 미입력)', async () => {
  let f = fakeSupabase({ existing: { id: 'D-1', user_id: OWNER, name: '시험' }, site: { design_id: 'D-1', address: '서울 합성구 1', updated_at: '2026-11-20T00:00:00Z' } });
  try {
    const r = await previewPlannerDoc(ENV, { user: { id: OWNER }, body: body({ doc_type: 'installation_order' }) });
    assert.equal(r.site, true);
    assert.ok(r.html.includes('서울 합성구 1'));
  } finally { f.restore(); }
  f = fakeSupabase();
  try {
    const r = await previewPlannerDoc(ENV, { user: { id: OWNER }, body: body({ doc_type: 'installation_order' }) });
    assert.equal(r.site, false);
  } finally { f.restore(); }
});

test('발행과 미리보기는 같은 칸 — docPayloadOf 가 문서 종류마다 같은 키를 낸다', async () => {
  const snapshot = { content_hash: 'h', design_payload: body().design, bom_payload: body().bom, cut_plan_payload: null };
  const collect = (kind, items) => items.map((it, i) => ({ item_index: i, item_unique_id: 1, path: kind === 'iso' ? 'p/iso' : null }));
  const site = { site_info: null, schedules: [] };
  const f = fakeSupabase();
  try {
    const keys = async (docType) => Object.keys(await docPayloadOf(ENV, { docType, snapshot, designId: null, collect, site, prevRev: false })).sort();
    assert.deepEqual(await keys('work_order'), ['check_list', 'cut_plan', 'drawing_version', 'iso_renders', 'label_order', 'labor', 'parts_digest', 'prev_rev', 'renders', 'sheet_layout', 'special_notes', 'swatches', 'work_order_version'].sort());
    assert.deepEqual(await keys('delivery_order'), ['check_list', 'drawing_version', 'iso_renders', 'schedules', 'site_info']);
    assert.deepEqual(await keys('demolition_order'), ['check_list', 'drawing_version', 'schedules', 'site_info']);
  } finally { f.restore(); }
});

test('띠 — body 바로 뒤에, body 가 없으면 맨 앞에', () => {
  assert.match(withBanner('<html><body class="x"><p>a</p></body></html>'), /<body class="x"><div[^>]*>미리보기/);
  assert.match(withBanner('<p>a</p>'), /^<div[^>]*>미리보기/);
});
