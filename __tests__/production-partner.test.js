/**
 * 생산 화면 — 협력업체는 설정만 (workers/workflow-api: 계획 · 제안 · Slack 은 본사 일, 협력업체 구성원은 403 not_hq).
 *
 *   GET /production/settings 의 hq 가 false 면 설정 카드만 남기고, 계획 · 제안 · 지시 · 작업자 링크 · 보정 · 월 손익을 부르지 않는다
 *   (예전엔 제안이 없으면 '지금 다시 계산' 을 저절로 불러 본사 Slack 으로 나갔다)
 *   본사(hq true) · 설정을 못 읽는 본사 직원은 예전처럼 전부 부른다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'production.html'), 'utf8').replace(/\r\n/g, '\n');
const SCRIPT = HTML.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n      (function'));
const API = 'https://api.test';

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 30; i++) await flush();
}

const SETTINGS = { standards: {}, crew: {}, costs: {}, leads: {}, quote: { marginRate: 0.2 }, vendors: {}, countertop: {} };
const PLAN = { days: [], jobs: [], suggestions: [], summary: {}, skipped: [] };

/** settings: 'hq' | 'partner' | 'forbidden' */
function fakeApi(settings) {
  const calls = [];
  const ok = (data, code = 200) => ({ ok: true, status: code, json: async () => ({ success: true, data }) });
  const err = (code, message) => ({ ok: false, status: code, json: async () => ({ success: false, message }) });
  const fetchFn = jest.fn(async (url, init = {}) => {
    const u = String(url).replace(API, '');
    const method = init.method || 'GET';
    calls.push({ method, u });
    if (u === '/production/settings' && method === 'GET') {
      if (settings === 'forbidden') return err(403, '원가 설정은 업체 대표 · 실장만 다룹니다');
      return ok({ settings: SETTINGS, saved: null, updated_at: null, missing: true, hq: settings === 'hq' });
    }
    if (u === '/production/settings' && method === 'POST') return ok({ settings: SETTINGS, saved: {} });
    if (u.startsWith('/production/proposals/latest')) return ok({ id: 'P1', status: 'pending', trigger: 'manual', created_at: '2026-10-29T00:00:00Z', plan: PLAN });
    if (u.startsWith('/production/proposals')) return ok({ items: [] });
    if (u.startsWith('/production/assignments')) return ok({ items: [] });
    if (u.startsWith('/production/worker-links')) return ok({ items: [] });
    if (u.startsWith('/production/calibration')) return ok({ from: '2026-10-01', result: [] });
    if (u.startsWith('/production/worklogs')) return ok({ items: [] });
    if (u.startsWith('/production/monthly')) return ok({ month: '2026-10', rows: [], totals: { orders: 0, revenue: 0, cost: 0, gross: 0, grossRate: null, overhead: 0, net: 0, unknownCost: 0, shortfall: 0 } });
    return err(404, 'nope');
  });
  return { fetchFn, calls };
}

function boot(api) {
  document.body.innerHTML = BODY;
  window.DADAM_CONFIG = { supabase: { url: 'https://sb', anonKey: 'k' }, workflowApi: { url: API } };
  window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'T' } } }) } }) };
  global.fetch = api.fetchFn;
  (0, eval)(SCRIPT);
}

const $ = (sel) => document.querySelector(sel);
const visibleCards = () => [...document.querySelectorAll('.card')].filter((c) => !c.hidden).map((c) => c.querySelector('h2').textContent.trim());

test('협력업체 — 설정 카드만, 계획 · 제안 · 지시 · 링크 · 보정 · 월 손익을 부르지 않는다', async () => {
  const api = fakeApi('partner');
  boot(api);
  await settle();
  expect(visibleCards()).toEqual(['표준시간 · 인력 설정']);
  expect($('#subPartner').hidden).toBe(false);
  expect(api.calls.map((c) => `${c.method} ${c.u}`)).toEqual(['GET /production/settings']);
  expect(document.querySelectorAll('#settingsForm input').length).toBeGreaterThan(0);
  // 저장은 된다 — 안내에 '다시 계산' 이 없다
  $('#btnSaveSettings').click();
  await settle();
  expect(api.calls.some((c) => c.method === 'POST' && c.u === '/production/settings')).toBe(true);
  expect(api.calls.some((c) => c.u.startsWith('/production/proposals'))).toBe(false);
  expect($('#alert').textContent).toBe('설정을 저장했습니다.');
});

test('본사 — 예전처럼 전부 부른다', async () => {
  const api = fakeApi('hq');
  boot(api);
  await settle();
  expect(visibleCards().length).toBe(9);
  expect($('#subPartner').hidden).toBe(true);
  for (const p of ['/production/proposals/latest', '/production/assignments', '/production/worker-links', '/production/calibration', '/production/monthly']) {
    expect(api.calls.some((c) => c.u.startsWith(p))).toBe(true);
  }
});

test('설정을 못 읽는 본사 직원 — 알리고 나머지는 예전처럼 부른다', async () => {
  const api = fakeApi('forbidden');
  boot(api);
  await settle();
  expect(visibleCards().length).toBe(9);
  expect(api.calls.some((c) => c.u.startsWith('/production/proposals/latest'))).toBe(true);
});
