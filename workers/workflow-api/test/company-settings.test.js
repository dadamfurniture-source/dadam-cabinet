/**
 * 원가 설정은 업체 소유 — company_settings (database/migrations/0012).
 *
 *   견적: 설계가 속한 업체의 설정. 줄이 없는 협력업체는 코드 기본값 + settings_missing (본사 설정으로 대신하지 않는다)
 *         거래처 금액(본사 → 거래처)은 본사 견적에만. 동결 때 쓴 설정을 settings_used 로 박는다
 *   생산 계획 · 월 손익 · 경영 대시보드 · 작업자 보정: 본사 설정
 *   GET · POST /production/settings: 내 업체 설정 — 대표 · 실장만, 본사는 관리자도 (아니면 403 not_member · not_money)
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import { createSnapshot, previewQuote, pinnedSettingsOf } from '../src/snapshots.js';
import { mergeSettings, getMonthlySummary } from '../src/production/service.js';
import { businessSettings } from '../src/management/service.js';
import { createOutsourceOrder, loadCountertopContext } from '../src/reports/outsource.js';
import { issueDocument } from '../src/documents.js';
import { calculateSheetQuote } from '../src/quote-sheet.js';
import worker from '../src/worker.js';
import * as fx from './fixtures/work-order-v2.js';
import { HQ, PARTNER, companyRoute } from './fixtures/company.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };

const HQ_OWNER = 'u-hq-owner';
const HQ_MANAGER = 'u-hq-manager';
const HQ_STAFF = 'u-hq-staff';
const HQ_STAFF_ADMIN = 'u-hq-staff-admin';
const ADMIN = 'u-admin';
const P_OWNER = 'u-p-owner';
const P_MANAGER = 'u-p-manager';
const P_STAFF = 'u-p-staff';
const P_STAFF_ADMIN = 'u-p-staff-admin';
const P_REMOVED = 'u-p-removed';
const STRANGER = 'u-stranger';

const MEMBERS = [
  { user_id: HQ_OWNER, company_id: HQ, role: 'owner', status: 'active' },
  { user_id: HQ_MANAGER, company_id: HQ, role: 'manager', status: 'active' },
  { user_id: HQ_STAFF, company_id: HQ, role: 'staff', status: 'active' },
  { user_id: HQ_STAFF_ADMIN, company_id: HQ, role: 'staff', status: 'active' },
  { user_id: P_OWNER, company_id: PARTNER, role: 'owner', status: 'active' },
  { user_id: P_MANAGER, company_id: PARTNER, role: 'manager', status: 'active' },
  { user_id: P_STAFF, company_id: PARTNER, role: 'staff', status: 'active' },
  { user_id: P_STAFF_ADMIN, company_id: PARTNER, role: 'staff', status: 'active' },
  { user_id: P_REMOVED, company_id: PARTNER, role: 'owner', status: 'removed' },
];
const ADMINS = new Set([ADMIN, HQ_STAFF_ADMIN, P_STAFF_ADMIN]);

const DESIGNS = {
  'd-hq': { id: 'd-hq', user_id: 'u-creator', company_id: HQ, title: '본사 설계' },
  'd-p': { id: 'd-p', user_id: P_STAFF, company_id: PARTNER, title: '협력업체 설계' },
};

const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });
const eqParam = (u, key) => {
  const v = new URL(u).searchParams.get(key);
  return v ? v.replace(/^eq\./, '') : null;
};

/**
 * 가짜 PostgREST — 업체 · 구성원 · 관리자 · 업체 설정 + 부르는 쪽이 더하는 route.
 *   settings: { [company_id]: settings } — 없는 업체는 줄이 없다
 *   failSettings: company_settings 읽기가 500
 */
function db({ settings = {}, failSettings = false, extra = () => null } = {}) {
  return (u, method, body) => {
    const company = companyRoute(u, { members: MEMBERS });
    if (company) return company;
    if (u.includes('/admin_roles?')) return json(ADMINS.has(eqParam(u, 'user_id')) ? [{ role: 'admin' }] : []);
    if (u.includes('/company_settings')) {
      if (failSettings) return { ok: false, status: 500, headers: { get: () => 'text/plain' }, text: async () => 'boom', json: async () => ({}) };
      if (method === 'GET') {
        const id = eqParam(u, 'company_id');
        return json(settings[id] ? [{ settings: settings[id], updated_at: '2026-10-20T00:00:00Z' }] : []);
      }
      if (method === 'POST') return json([body], 201);
    }
    const more = extra(u, method, body);
    if (more) return more;
    if (method === 'GET' && u.includes('/designs?id=eq.')) {
      const d = DESIGNS[eqParam(u, 'id')];
      return json(d ? [d] : []);
    }
    return null;
  };
}

async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method, body });
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

/** worker.fetch — JWT 확인(/auth/v1/user)은 토큰 이름을 사용자 id 로 돌려준다 */
async function callWorker(path, token, route, { method = 'GET', body } = {}) {
  const auth = (u, m, b) => (u.startsWith(`${ENV.SUPABASE_URL}/auth/v1/user`) ? json({ id: token }) : route(u, m, b));
  return withFetch(auth, async (calls) => {
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(
      new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      ENV,
      { waitUntil() {} },
    );
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text), calls };
  });
}

const settingsReads = (calls) => calls.filter((c) => c.method === 'GET' && c.url.includes('/company_settings?'));
const settingsWrites = (calls) => calls.filter((c) => c.method === 'POST' && c.url.includes('/company_settings'));

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

// ── GET · POST /production/settings ─────────────────────────────

test('GET /production/settings — 본사 대표 · 실장은 본사 설정, missing 이 붙는다 (모양은 예전 그대로)', async () => {
  for (const who of [HQ_OWNER, HQ_MANAGER]) {
    const r = await callWorker('/production/settings', who, db({ settings: { [HQ]: { quote: { marginRate: 0.3 } } } }));
    assert.equal(r.status, 200, r.text);
    const d = r.body.data;
    assert.equal(d.settings.quote.marginRate, 0.3);
    assert.deepEqual(d.saved, { quote: { marginRate: 0.3 } });
    assert.equal(d.updated_at, '2026-10-20T00:00:00Z');
    assert.equal(d.missing, false);
    assert.deepEqual(settingsReads(r.calls).map((c) => eqParam(c.url, 'company_id')), [HQ]);
    assert.ok(!r.calls.some((c) => c.url.includes('/production_settings')), '개인 설정은 읽지 않는다');
  }
});

test('GET /production/settings — 협력업체 대표는 그 업체 설정, 줄이 없으면 기본값 + missing (본사 줄은 읽지 않는다)', async () => {
  const r = await callWorker('/production/settings', P_OWNER, db({ settings: { [HQ]: { quote: { marginRate: 0.3 } } } }));
  assert.equal(r.status, 200, r.text);
  const d = r.body.data;
  assert.equal(d.missing, true);
  assert.equal(d.saved, null);
  assert.deepEqual(d.settings, mergeSettings(null));
  assert.deepEqual(settingsReads(r.calls).map((c) => eqParam(c.url, 'company_id')), [PARTNER]);
});

test('GET /production/settings — 관리자는 본사 설정 (구성원이 아니어도, 본사 staff 여도)', async () => {
  for (const who of [ADMIN, HQ_STAFF_ADMIN]) {
    const r = await callWorker('/production/settings', who, db({ settings: { [HQ]: { quote: { marginRate: 0.3 } } } }));
    assert.equal(r.status, 200, `${who} ${r.text}`);
    assert.equal(r.body.data.settings.quote.marginRate, 0.3);
    assert.deepEqual(settingsReads(r.calls).map((c) => eqParam(c.url, 'company_id')), [HQ]);
  }
});

test('/production/settings — 대표 · 실장이 아닌 구성원은 403 not_money, 구성원이 아니면 403 not_member (읽지도 쓰지도 않는다)', async () => {
  const cases = [
    [HQ_STAFF, 'not_money'],
    [P_STAFF, 'not_money'],
    // 관리자여도 협력업체 구성원이면 그 업체 설정이다 — 관리자 몫은 본사 설정뿐
    [P_STAFF_ADMIN, 'not_money'],
    [STRANGER, 'not_member'],
    [P_REMOVED, 'not_member'],
  ];
  for (const [who, code] of cases) {
    for (const method of ['GET', 'POST']) {
      const r = await callWorker('/production/settings', who, db(), { method, body: method === 'POST' ? { quote: { marginRate: 0.5 } } : undefined });
      assert.equal(r.status, 403, `${who} ${method} ${r.text}`);
      assert.equal(r.body.code, code, `${who} ${method}`);
      assert.equal(settingsReads(r.calls).length, 0);
      assert.equal(settingsWrites(r.calls).length, 0);
    }
  }
});

test('POST /production/settings — 내 업체 줄에 upsert (업체 · 고친 사람), 응답은 { settings, saved }', async () => {
  const r = await callWorker('/production/settings', P_MANAGER, db(), { method: 'POST', body: { quote: { marginRate: 0.25 }, vendors: { door: '우드원' } } });
  assert.equal(r.status, 200, r.text);
  const [w] = settingsWrites(r.calls);
  assert.ok(w.url.includes('on_conflict=company_id'));
  assert.equal(w.body.company_id, PARTNER);
  assert.equal(w.body.updated_by, P_MANAGER);
  assert.deepEqual(w.body.settings, { quote: { marginRate: 0.25 }, vendors: { door: '우드원' } });
  assert.equal(r.body.data.settings.quote.marginRate, 0.25);
  assert.deepEqual(r.body.data.saved, w.body.settings);

  const hq = await callWorker('/production/settings', ADMIN, db(), { method: 'POST', body: { quote: { marginRate: 0.3 } } });
  assert.equal(hq.status, 200, hq.text);
  assert.equal(settingsWrites(hq.calls)[0].body.company_id, HQ);
});

test('POST /production/settings — 잘못된 값은 예전처럼 422, 쓰지 않는다', async () => {
  const r = await callWorker('/production/settings', HQ_OWNER, db(), { method: 'POST', body: { quote: { nope: 1 } } });
  assert.equal(r.status, 422, r.text);
  assert.equal(settingsWrites(r.calls).length, 0);
});

// ── 견적 (스냅샷 동결 · 미리보기) ─────────────────────────────────

function snapshotBody() {
  return {
    design: {
      items: [{
        categoryId: 'sink',
        labelName: '싱크대',
        w: 2400,
        specs: { topSizes: [{ w: 2400, d: 600 }] },
        modules: [{ pos: 'lower', type: 'sink', w: 900 }, { pos: 'lower', type: 'storage', w: 600 }, { pos: 'upper', type: 'storage', w: 600 }],
      }],
    },
    bom: {
      materials: [
        { partId: 'p1', part: '측판', material: 'PB', thickness: 15, w: 550, h: 870, qty: 4, edgeLen: 1000 },
        { partId: 'p2', part: '도어', material: 'MDF', thickness: 18, w: 450, h: 700, qty: 3 },
      ],
    },
  };
}

const RULES = [
  { kind: 'range', key: 'min', grade: '*', amount: 0.95 },
  { kind: 'range', key: 'max', grade: '*', amount: 1.3 },
];

/** 스냅샷 동결 · 미리보기에 필요한 표 — snapshots: 이미 있는 스냅샷 행 (id 로 찾는다) */
function quoteDb({ settings = {}, failSettings = false, snapshots = [] } = {}) {
  return db({
    settings,
    failSettings,
    extra: (u, method, body) => {
      if (u.includes('/pricing_rule_sets?')) return json([{ id: 'RS1', version: 'v1', is_active: true }]);
      if (u.includes('/pricing_rules?')) return json(RULES);
      if (method === 'POST' && u.endsWith('/design_snapshots')) return json([{ id: 'S-new', ...body }], 201);
      if (method === 'GET' && u.includes('/design_snapshots?')) {
        const id = eqParam(u, 'id');
        return json(id ? snapshots.filter((s) => s.id === id) : []);
      }
      return null;
    },
  });
}

const freeze = (designId, userId) => createSnapshot(ENV, { designId, user: { id: userId }, body: snapshotBody() });

test('동결 — 본사 설계는 본사 설정 · 마진, 거래처 금액 있음, 쓴 설정을 박는다, m당 견적(legacy)은 없다', async () => {
  const HQ_SETTINGS = { quote: { marginRate: 0.3 }, crew: { util: 0.8 } };
  await withFetch(quoteDb({ settings: { [HQ]: HQ_SETTINGS, [PARTNER]: { quote: { marginRate: 0.9 } } } }), async (calls) => {
    const { snapshot } = await freeze('d-hq', HQ_STAFF);
    const q = snapshot.quote_payload;
    assert.equal(q.method, 'sheet');
    assert.equal(q.margin_rate, 0.3);
    assert.equal(q.partner.margin_rate, 0.1);
    assert.ok(q.partner.total > 0);
    assert.equal(typeof q.cost.partner_margin_amount, 'number');
    assert.equal(q.settings_missing, false);
    const merged = mergeSettings(HQ_SETTINGS);
    assert.deepEqual(q.settings_used, { standards: merged.standards, crew: merged.crew, costs: merged.costs, quote: merged.quote });
    assert.ok(!('legacy' in q), 'm당 견적은 계산 · 저장하지 않는다');
    assert.equal(q.grade, 'basic');
    assert.equal(q.pricing_version, 'v1');
    assert.equal(q.pricing_rule_set_id, 'RS1');
    assert.ok(q.range && q.range.min < q.total && q.range.max > q.total);
    assert.deepEqual(settingsReads(calls).map((c) => eqParam(c.url, 'company_id')), [HQ]);
  });
});

test('동결 — 협력업체 설계는 그 업체 설정 · 마진, 거래처 금액 칸은 null', async () => {
  await withFetch(quoteDb({ settings: { [HQ]: { quote: { marginRate: 0.3 } }, [PARTNER]: { quote: { marginRate: 0.25 } } } }), async (calls) => {
    const { snapshot } = await freeze('d-p', P_STAFF);
    const q = snapshot.quote_payload;
    assert.equal(q.margin_rate, 0.25);
    assert.equal(q.partner, null);
    assert.equal(q.cost.partner_margin_amount, null);
    assert.equal(q.settings_missing, false);
    assert.equal(q.settings_used.quote.marginRate, 0.25);
    assert.deepEqual(settingsReads(calls).map((c) => eqParam(c.url, 'company_id')), [PARTNER]);
  });
});

test('동결 — 설정 줄이 없는 협력업체는 코드 기본값 + settings_missing, 본사 설정으로 대신하지 않는다', async () => {
  await withFetch(quoteDb({ settings: { [HQ]: { quote: { marginRate: 0.3 } } } }), async (calls) => {
    const { snapshot } = await freeze('d-p', P_OWNER);
    const q = snapshot.quote_payload;
    assert.equal(q.settings_missing, true);
    assert.equal(q.margin_rate, 0.2, '기본 마진 ×1.2');
    assert.equal(q.partner, null);
    const d = mergeSettings(null);
    assert.deepEqual(q.settings_used, { standards: d.standards, crew: d.crew, costs: d.costs, quote: d.quote });
    assert.ok(settingsReads(calls).every((c) => eqParam(c.url, 'company_id') === PARTNER), '본사 줄을 읽지 않는다');
  });
});

test('동결 — 설정을 못 읽어도 기본값으로 저장한다 (settings_missing 으로 남긴다)', async () => {
  await withFetch(quoteDb({ failSettings: true }), async () => {
    const { snapshot } = await freeze('d-hq', HQ_OWNER);
    assert.equal(snapshot.quote_payload.settings_missing, true);
    assert.equal(snapshot.quote_payload.margin_rate, 0.2);
    assert.ok(snapshot.quote_payload.partner, '본사 설계는 거래처 금액이 그대로');
  });
});

/** 이미 동결된 스냅샷 — quote: 그때 박힌 견적 */
function frozen(designId, quote) {
  const b = snapshotBody();
  return { id: 'S1', design_id: designId, rev: 1, pricing_rule_set_id: 'RS1', design_payload: b.design, bom_payload: b.bom, hardware_payload: {}, cut_plan_payload: null, quote_payload: quote };
}

test('미리보기 — 동결 때 박힌 설정으로 계산한다 (지금 설정을 읽지 않는다)', async () => {
  const pinnedFrom = mergeSettings({ quote: { marginRate: 0.35 } });
  const used = { standards: pinnedFrom.standards, crew: pinnedFrom.crew, costs: pinnedFrom.costs, quote: pinnedFrom.quote };
  const snap = frozen('d-hq', { method: 'sheet', settings_used: used, settings_missing: false });
  await withFetch(quoteDb({ settings: { [HQ]: { quote: { marginRate: 0.5 } } }, snapshots: [snap] }), async (calls) => {
    const out = await previewQuote(ENV, { snapshotId: 'S1', user: { id: HQ_OWNER } });
    assert.equal(out.settings_pinned, true);
    assert.equal(out.quote.margin_rate, 0.35);
    assert.deepEqual(out.quote.settings_used, used);
    assert.ok(out.quote.partner, '본사 설계');
    assert.equal(settingsReads(calls).length, 0);
  });
});

test('미리보기 — 설정이 박히기 전 스냅샷은 설계 업체의 지금 설정', async () => {
  await withFetch(quoteDb({ settings: { [HQ]: { quote: { marginRate: 0.5 } } }, snapshots: [frozen('d-hq', { method: 'sheet', total: 1 })] }), async (calls) => {
    const out = await previewQuote(ENV, { snapshotId: 'S1', user: { id: HQ_OWNER } });
    assert.equal(out.settings_pinned, false);
    assert.equal(out.quote.margin_rate, 0.5);
    assert.deepEqual(settingsReads(calls).map((c) => eqParam(c.url, 'company_id')), [HQ]);
  });
  await withFetch(quoteDb({ settings: { [HQ]: { quote: { marginRate: 0.5 } } }, snapshots: [frozen('d-p', { method: 'sheet', total: 1 })] }), async (calls) => {
    const out = await previewQuote(ENV, { snapshotId: 'S1', user: { id: P_MANAGER } });
    assert.equal(out.quote.settings_missing, true);
    assert.equal(out.quote.margin_rate, 0.2);
    assert.equal(out.quote.partner, null);
    assert.deepEqual(settingsReads(calls).map((c) => eqParam(c.url, 'company_id')), [PARTNER]);
  });
});

test('미리보기 — 원가 · 수금 권한이 없으면 원가 · 마진 · 동결 설정이 빠진다', async () => {
  await withFetch(quoteDb({ settings: { [HQ]: { quote: { marginRate: 0.5 } } }, snapshots: [frozen('d-hq', { method: 'sheet' })] }), async () => {
    const out = await previewQuote(ENV, { snapshotId: 'S1', user: { id: HQ_STAFF } });
    for (const k of ['cost', 'margin_rate', 'settings_used']) assert.ok(!(k in out.quote), `${k} 없음`);
    assert.ok(out.quote.total > 0);
  });
});

test('pinnedSettingsOf — settings_used 가 객체일 때만', () => {
  assert.equal(pinnedSettingsOf(null), null);
  assert.equal(pinnedSettingsOf({ total: 1 }), null);
  assert.equal(pinnedSettingsOf({ settings_used: [1] }), null);
  assert.deepEqual(pinnedSettingsOf({ settings_used: { quote: {} }, settings_missing: true }), { settings: { quote: {} }, missing: true });
});

test('장당 견적 — partnerPrice: false 면 거래처 금액 · 거래처 마진액이 null, 고객 금액은 같다', () => {
  const b = snapshotBody();
  const withPartner = calculateSheetQuote({ design: b.design, bom: b.bom, cutPlan: null });
  const without = calculateSheetQuote({ design: b.design, bom: b.bom, cutPlan: null, partnerPrice: false });
  assert.ok(withPartner.partner && withPartner.cost.partner_margin_amount !== null);
  assert.equal(without.partner, null);
  assert.equal(without.cost.partner_margin_amount, null);
  assert.equal(without.total, withPartner.total);
  assert.deepEqual(without.items, withPartner.items);
});

test('거래처용 확인서 — 본사 견적이 아닌 스냅샷(partner: null)이면 422', async () => {
  const snap = frozen('d-p', { method: 'sheet', total: 1100000, partner: null });
  const route = db({
    extra: (u) => {
      if (u.includes('/design_snapshots?')) return json([snap]);
      if (u.includes('/design_documents?')) return json([]);
      return null;
    },
  });
  await withFetch(route, async (calls) => {
    await assert.rejects(
      issueDocument(ENV, { user: { id: P_OWNER }, body: { doc_type: 'customer_confirmation', snapshot_id: 'S1', price_tier: 'partner' } }),
      (e) => e.statusCode === 422 && /본사 견적에만/.test(e.message),
    );
    assert.ok(!calls.some((c) => c.method === 'POST'));
  });
});

// ── 본사 설정을 읽는 곳 ──────────────────────────────────────────

test('생산 계획 — 누가 불러도 본사 설정으로 돌고, 응답에 설정을 싣지 않는다', async () => {
  const route = db({
    settings: { [HQ]: { quote: { marginRate: 0.3 } }, [PARTNER]: { quote: { marginRate: 0.9 } } },
    extra: (u) => (u.includes('/designs?select=id') ? json([]) : null),
  });
  for (const who of [P_OWNER, HQ_OWNER]) {
    const r = await callWorker('/production/plan?today=2026-10-20', who, route);
    assert.equal(r.status, 200, r.text);
    assert.ok(!('settings' in r.body.data), '계획 응답에 원가 설정 없음');
    assert.deepEqual(settingsReads(r.calls).map((c) => eqParam(c.url, 'company_id')), [HQ]);
  }
});

test('월 손익 — 월 고정비는 본사 설정', async () => {
  const route = db({
    settings: { [HQ]: { quote: { overheadMonthly: 5000000 } } },
    extra: (u) => (u.includes('/designs?select=id') ? json([]) : null),
  });
  await withFetch(route, async (calls) => {
    const s = await getMonthlySummary(ENV, { user: { id: HQ_OWNER }, month: '2026-10' });
    assert.equal(s.totals.overhead, 5000000);
    assert.deepEqual(settingsReads(calls).map((c) => eqParam(c.url, 'company_id')), [HQ]);
  });
});

test('경영 대시보드 설정 — 본사 줄(source hq), 없으면 기본값(source default)', async () => {
  await withFetch(db({ settings: { [HQ]: { quote: { overheadMonthly: 5000000 } } } }), async () => {
    const s = await businessSettings(ENV);
    assert.equal(s.quote.overheadMonthly, 5000000);
    assert.equal(s.source, 'hq');
  });
  clearHqCompanyCache();
  await withFetch(db(), async () => {
    const s = await businessSettings(ENV);
    assert.equal(s.quote.overheadMonthly, mergeSettings(null).quote.overheadMonthly);
    assert.equal(s.source, 'default');
  });
});

// ── 작업자 보정 ──────────────────────────────────────────────────

/** 재단 12장 · 60분 → 장당 300초 */
const LOGS = [{ id: 'l1', role: 'cutter', units: 12, minutes: 60, work_date: '2026-10-20' }];

function calibrationDb() {
  return db({
    settings: { [HQ]: { standards: { cutPerSheet: 200 }, quote: { marginRate: 0.3 } }, [PARTNER]: { standards: { cutPerSheet: 900 } } },
    extra: (u) => (u.includes('/production_worklogs?') ? json(LOGS) : null),
  });
}

test('보정 보기 — 본사 표준시간과 견준다', async () => {
  const r = await callWorker('/production/calibration', P_OWNER, calibrationDb());
  assert.equal(r.status, 200, r.text);
  const cutter = r.body.data.result.find((x) => x.role === 'cutter');
  assert.equal(cutter.current, 200);
  assert.equal(cutter.suggested, 300);
});

test('보정 적용 — 본사 설정에 표준시간만 덮어쓴다 (본사 대표 · 실장 · 관리자만)', async () => {
  for (const who of [HQ_OWNER, ADMIN]) {
    const r = await callWorker('/production/calibration/apply', who, calibrationDb(), { method: 'POST', body: { roles: ['cutter'] } });
    assert.equal(r.status, 200, `${who} ${r.text}`);
    const [w] = settingsWrites(r.calls);
    assert.equal(w.body.company_id, HQ);
    assert.deepEqual(w.body.settings, { standards: { cutPerSheet: 300 }, quote: { marginRate: 0.3 } });
    assert.equal(r.body.data.settings.standards.cutPerSheet, 300);
  }
  for (const [who, code] of [[P_OWNER, 'not_member'], [HQ_STAFF, 'not_money'], [STRANGER, 'not_member']]) {
    const r = await callWorker('/production/calibration/apply', who, calibrationDb(), { method: 'POST', body: { roles: ['cutter'] } });
    assert.equal(r.status, 403, `${who} ${r.text}`);
    assert.equal(r.body.code, code);
    assert.equal(settingsWrites(r.calls).length, 0);
  }
});

// ── 외주 발주 · 상판 요청서 — 설계 업체의 설정 ─────────────────────

const P_DOC = 'doc-p';
function outsourceDb(settings) {
  return db({
    settings,
    extra: (u, method) => {
      if (u.includes('/design_documents?')) return json([fx.doc({ id: P_DOC, design_id: 'd-p', snapshot_id: 's1' })]);
      if (u.includes('/designs?id=eq.d-p')) return json([DESIGNS['d-p']]);
      if (u.includes('/design_snapshots?')) return json([fx.snapshot({ id: 's1', design_id: 'd-p' })]);
      if (u.includes('/design_schedules?')) return json([]);
      if (u.includes('/orders?')) return json([{ id: 'o1' }]);
      if (u.includes('/work_reports?') && method === 'GET') return json([]);
      if (u.endsWith('/work_reports') && method === 'POST') return json([{ id: 'new' }], 201);
      return null;
    },
  });
}

test('[발주 처리] — 업체 이름 · 납기는 설계가 속한 업체의 설정', async () => {
  await withFetch(outsourceDb({ [HQ]: { vendors: { cutEdge: '본사재단' } }, [PARTNER]: { vendors: { cutEdge: '협력재단' } } }), async (calls) => {
    await createOutsourceOrder(ENV, { user: { id: P_STAFF }, documentId: P_DOC, body: { pack: 'cut-vendor' } });
    assert.equal(calls.find((c) => c.method === 'POST').body.metrics.vendor, '협력재단');
    assert.deepEqual(settingsReads(calls).map((c) => eqParam(c.url, 'company_id')), [PARTNER]);
  });
});

test('상판 요청서 인쇄 자료 — 설계 업체의 설정 (설계 주인 개인 설정이 아니다)', async () => {
  await withFetch(outsourceDb({ [PARTNER]: { vendors: { topMarble: '협력스톤' } } }), async (calls) => {
    const ctx = await loadCountertopContext(ENV, { doc: fx.doc({ id: P_DOC, design_id: 'd-p' }), snapshot: fx.snapshot({ id: 's1' }) });
    assert.equal(ctx.vendors.topMarble, '협력스톤');
    assert.ok(calls.find((c) => c.url.includes('/designs?')).url.includes('select=company_id'));
    assert.deepEqual(settingsReads(calls).map((c) => eqParam(c.url, 'company_id')), [PARTNER]);
  });
});
