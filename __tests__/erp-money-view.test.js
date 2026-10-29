/**
 * ERP 수주 상세 — 보는 사람에 따라 (workers/workflow-api/src/orders.js orderForViewer).
 *
 *   업체 staff: 워커가 계약금 · 수금액 · margin · costs · payments 를 싣지 않는다
 *     → 상세가 열리고(예전엔 detail.margin 에서 멈췄다) 금액 칸 · 수금 · 원가 · 재작업 적기는 숨는다
 *   협력업체 수주: 워커가 구분(price_tier) · 거래처(partner_id) 칸을 싣지 않는다 → 고칠 곳이 숨는다
 *   본사 수주 · 대표 · 실장: 예전 그대로
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'erp.html'), 'utf8').replace(/\r\n/g, '\n');
const SCRIPT = HTML.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n      (function'));
const API = 'https://api.test';

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 20; i++) await flush();
}

const EVENTS = { status: 'in_production', can_decide: false, pending: null, moves: [], items: [] };

/**
 * 가짜 워커. money: 대표 · 실장 응답(금액 · 원가 · 수금 포함), partner: 협력업체 수주(구분 · 거래처 칸 없음)
 */
function fakeApi({ money, partner }) {
  const calls = [];
  const base = { id: 'O1', order_no: 'SO-1', customer_name: '김고객', status: 'in_production', note: null };
  const order = {
    ...base,
    ...(money ? { contract_amount: 1100000, received_amount: 300000 } : {}),
    ...(partner ? {} : { price_tier: 'partner', partner_id: null }),
  };
  const ok = (data, code = 200) => ({ ok: true, status: code, json: async () => ({ success: true, data }) });
  const err = (code, message) => ({ ok: false, status: code, json: async () => ({ success: false, message }) });
  const fetchFn = jest.fn(async (url, init = {}) => {
    const u = String(url).replace(API, '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, u, body });
    if (method === 'GET' && u === '/orders') return ok({ items: [order] });
    if (method === 'GET' && u === '/order-requests?state=pending') return ok({ items: [] });
    if (method === 'GET' && u === '/counterparties') {
      return money ? ok({ items: [{ id: 'cp1', kind: 'partner', name: '한빛' }, { id: 'cp2', kind: 'supplier', name: '상일' }] }) : err(403, '대표 · 실장 · 관리자만');
    }
    if (method === 'GET' && u === '/orders/O1') {
      const reworks = [{ id: 'R1', kind: 'as', cause: 'install', occurred_on: '2026-10-20', minutes: 30, ...(money ? { cost: 20000 } : {}) }];
      const feedback = { exists: false, answered: false };
      if (!money) return ok({ order, reworks, feedback });
      return ok({
        order,
        costs: [{ id: 'C1', category: 'material', amount: 400000, spent_on: '2026-10-10' }],
        margin: { contract_amount: 1100000, received_amount: 300000, outstanding: 800000, cost_total: 400000, margin: 700000, margin_rate: 63.6, quoted_total: null },
        reworks,
        feedback,
        payments: [],
      });
    }
    if (method === 'GET' && u === '/orders/O1/events') return ok(EVENTS);
    if (method === 'PATCH' && u === '/orders/O1') return ok({ ...order, ...body });
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
const text = (sel) => $(sel).textContent.replace(/\s+/g, ' ').trim();

async function openOrder(api) {
  boot(api);
  await settle();
  $('[data-open="O1"]').click();
  await settle();
}

describe('업체 staff — 수주 목록 · 상태만', () => {
  test('상세가 열리고(멈추지 않는다) 금액 칸 · 수금 · 원가는 숨는다', async () => {
    const api = fakeApi({ money: false, partner: true });
    await openOrder(api);
    expect(text('#alert')).toBe('');
    expect($('#alert').hidden).toBe(true);
    expect($('#detailCard').hidden).toBe(false);
    expect(text('#detailTitle')).toBe('SO-1 · 김고객');
    expect(text('#curStatus')).toBe('생산 중');
    for (const id of ['moneyKpi', 'lblReceived', 'moneyPay', 'moneyCost']) expect($('#' + id).hidden).toBe(true);
    // 협력업체 수주라 구분 · 거래처도 없어 저장 줄이 통째로 숨는다
    expect($('#orderEditRow').hidden).toBe(true);
    // 재작업 목록은 보되(비용 없음) 적기 · 지우기는 없다 — 워커가 staff 에 403
    expect($('#reworkForm').hidden).toBe(false);
    expect($('#reworkInputs').hidden).toBe(true);
    expect(text('#reworkRows')).toMatch(/A\/S/);
    expect(document.querySelector('[data-del-reworks], [data-del-rework]')).toBeNull();
    // 목록의 금액 칸은 비어 있다
    const cells = [...document.querySelectorAll('#orderRows tr td')].map((td) => td.textContent.trim());
    expect(cells.slice(3, 7)).toEqual(['-', '-', '-', '-']);
  });

  test('본사 staff — 구분은 고칠 수 있고, 저장에 수금액을 싣지 않는다', async () => {
    const api = fakeApi({ money: false, partner: false });
    await openOrder(api);
    expect($('#orderEditRow').hidden).toBe(false);
    expect($('#lblReceived').hidden).toBe(true);
    expect($('#lblTier').hidden).toBe(false);
    $('#selTier').value = 'customer';
    $('#btnSaveOrder').click();
    await settle();
    const patch = api.calls.filter((c) => c.method === 'PATCH');
    expect(patch.map((c) => c.body)).toEqual([{ price_tier: 'customer' }]);
  });
});

describe('대표 · 실장', () => {
  test('본사 수주 — 예전 그대로 (금액 · 원가 · 수금 · 구분 · 거래처)', async () => {
    const api = fakeApi({ money: true, partner: false });
    await openOrder(api);
    for (const id of ['moneyKpi', 'lblReceived', 'moneyPay', 'moneyCost', 'orderEditRow', 'lblTier']) expect($('#' + id).hidden).toBe(false);
    expect(text('#kContract')).toBe('1,100,000원');
    expect(text('#kMargin')).toMatch(/700,000원/);
    expect(text('#costRows')).toMatch(/400,000원/);
    expect($('#reworkInputs').hidden).toBe(false);
    expect(document.querySelector('[data-del-rework="R1"]')).not.toBeNull();
    // 거래처 고르기는 구분이 거래처일 때
    expect($('#lblPartner').hidden).toBe(false);
  });

  test('협력업체 수주 — 구분 · 거래처 고칠 곳이 없고, 저장에 싣지 않는다', async () => {
    const api = fakeApi({ money: true, partner: true });
    await openOrder(api);
    expect($('#lblTier').hidden).toBe(true);
    expect($('#lblPartner').hidden).toBe(true);
    expect($('#moneyKpi').hidden).toBe(false);
    expect(text('#orderRows')).not.toMatch(/거래처/);
    $('#inpReceived').value = '500000';
    $('#btnSaveOrder').click();
    await settle();
    const patch = api.calls.filter((c) => c.method === 'PATCH');
    expect(patch.map((c) => c.body)).toEqual([{ received_amount: 500000 }]);
  });
});
