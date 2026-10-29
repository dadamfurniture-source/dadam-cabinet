/**
 * ERP 수주 상세 — 상태 바꾸기 · 상태 기록 · 대표 승인 (workers/workflow-api/src/order-events.js).
 *
 * erp.html 스크립트를 jsdom 에 그대로 올리고 workflow-api 는 가짜 fetch 로 대신한다.
 *   - 지금 상태에서 바꿀 수 있는 상태(워커가 준 moves)만 고른다
 *   - 사유가 필요하면 페이지 안 입력칸으로 받는다 (window.prompt 아님)
 *   - 대표가 아니면 [대표 승인 요청] — 수주는 그대로이고 승인 기다림 표시가 뜬다
 *   - 상태 기록 목록 · 대표에게는 승인 기다림 목록과 [승인] · [반려]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'erp.html'), 'utf8').replace(/\r\n/g, '\n');
const SCRIPT = HTML.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n      (function'));
const WORKER_EVENTS = fs.readFileSync(path.join(ROOT, 'workers/workflow-api/src/order-events.js'), 'utf8');
const API = 'https://api.test';

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 20; i++) await flush();
}

const LABEL = { confirmed: '접수', in_production: '생산 중', delivered: '배송', completed: '완료', cancelled: '취소' };
/** 워커 규칙과 같은 moves (화면은 받은 것만 그린다) */
const MOVES = {
  in_production: [
    { to: 'delivered', approval: false, reason_required: false },
    { to: 'completed', approval: false, reason_required: false },
    { to: 'cancelled', approval: false, reason_required: true },
    { to: 'confirmed', approval: false, reason_required: true },
  ],
  completed: [{ to: 'delivered', approval: true, reason_required: true, kind: 'revert' }],
};

function order(status) {
  return { id: 'O1', order_no: 'SO-1', customer_name: '김고객', status, contract_amount: 1000000, received_amount: 0 };
}

/**
 * 가짜 워커. owner: 대표로 부르는가 (moves.request · 승인 기다림 목록).
 * events: 처음 기록, requests: 대표에게 보일 승인 기다림
 */
function fakeApi({ status = 'in_production', owner = false, events = [], requests = [] } = {}) {
  const calls = [];
  const st = { status, events: events.slice(), requests: requests.slice() };
  const ok = (data, code = 200) => ({ ok: true, status: code, json: async () => ({ success: true, data }) });
  const err = (code, message) => ({ ok: false, status: code, json: async () => ({ success: false, message }) });
  const moves = () =>
    (MOVES[st.status] || []).map((m) => ({ kind: 'status', ...m, label: LABEL[m.to], request: m.approval && !owner }));
  const fetchFn = jest.fn(async (url, init = {}) => {
    const u = String(url).replace(API, '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, u, body });
    if (method === 'GET' && u === '/orders') return ok({ items: [order(st.status)] });
    if (method === 'GET' && u === '/order-requests?state=pending') return ok({ items: owner ? st.requests : [] });
    if (method === 'GET' && u === '/counterparties') return err(403, '관리자만');
    if (method === 'GET' && u === '/orders/O1') {
      return ok({
        order: order(st.status),
        costs: [],
        margin: { contract_amount: 1000000, received_amount: 0, outstanding: 1000000, cost_total: 0, margin: 1000000, margin_rate: 100, quoted_total: null },
        reworks: [],
        feedback: { exists: false, answered: false },
        payments: [],
      });
    }
    if (method === 'GET' && u === '/orders/O1/events') {
      return ok({
        status: st.status,
        can_decide: owner,
        pending: st.events.find((e) => e.state === 'pending') || null,
        moves: moves(),
        items: st.events.slice(),
      });
    }
    if (method === 'PATCH' && u === '/orders/O1') {
      if (!body.status) return ok({ ...order(st.status), ...body });
      const rule = (MOVES[st.status] || []).find((m) => m.to === body.status);
      if (rule && rule.approval && !owner) {
        const ev = { id: 'E2', kind: rule.kind, from_status: st.status, to_status: body.status, reason: body.reason, state: 'pending', created_at: '2026-10-29T01:00:00Z' };
        st.events.unshift(ev);
        return ok(ev, 202);
      }
      st.events.unshift({ id: 'E3', kind: 'status', from_status: st.status, to_status: body.status, reason: body.reason || null, state: 'done', created_at: '2026-10-29T02:00:00Z' });
      st.status = body.status;
      return ok(order(st.status));
    }
    if (method === 'POST' && /^\/order-events\/[^/]+\/decide$/.test(u)) {
      st.requests = st.requests.filter((r) => !u.includes(r.id));
      return ok({ event: { id: 'E9', state: body.decision }, order: null });
    }
    return err(404, 'nope');
  });
  return { fetchFn, calls, st };
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
const patches = (api) => api.calls.filter((c) => c.method === 'PATCH' && c.u === '/orders/O1');

async function openOrder(api) {
  boot(api);
  await settle();
  $('[data-open="O1"]').click();
  await settle();
}

function pick(value) {
  const sel = $('#selStatus');
  sel.value = value;
  sel.dispatchEvent(new Event('change'));
}

beforeEach(() => {
  jest.restoreAllMocks();
  window.prompt = jest.fn(() => {
    throw new Error('window.prompt 를 쓰면 안 된다');
  });
});

describe('상태 바꾸기', () => {
  test('지금 상태에서 바꿀 수 있는 것만 고른다 — 지금 상태 · 못 가는 상태는 없다', async () => {
    const api = fakeApi({ status: 'in_production' });
    await openOrder(api);
    expect(text('#curStatus')).toBe('생산 중');
    const options = [...$('#selStatus').options].map((o) => [o.value, o.textContent]);
    expect(options).toEqual([['', '고르기'], ['delivered', '배송'], ['completed', '완료'], ['cancelled', '취소'], ['confirmed', '접수']]);
    expect($('#btnStatus').disabled).toBe(true);
    expect($('#inpStatusReason').hidden).toBe(true);
  });

  test('사유가 필요하면 페이지 안 입력칸 — 비우면 보내지 않고, 적으면 status · reason 을 보낸다', async () => {
    const api = fakeApi({ status: 'in_production' });
    await openOrder(api);
    pick('cancelled');
    expect($('#inpStatusReason').hidden).toBe(false);
    expect($('#btnStatus').disabled).toBe(false);
    expect(text('#statusHint')).toMatch(/사유를 적어야/);
    $('#inpStatusReason').value = '   ';
    $('#btnStatus').click();
    await settle();
    expect(patches(api)).toHaveLength(0);
    expect(text('#alert')).toBe('사유를 적어 주세요.');

    $('#inpStatusReason').value = '  고객 변심 ';
    $('#btnStatus').click();
    await settle();
    expect(patches(api).map((c) => c.body)).toEqual([{ status: 'cancelled', reason: '고객 변심' }]);
    expect(window.prompt).not.toHaveBeenCalled();
    expect(text('#alert')).toBe('상태를 취소(으)로 바꿨습니다.');
    expect(text('#curStatus')).toBe('취소');
  });

  test('사유가 필요 없는 바꾸기는 입력칸을 숨기고 status 만 보낸다', async () => {
    const api = fakeApi({ status: 'in_production' });
    await openOrder(api);
    pick('cancelled');
    $('#inpStatusReason').value = '적다 말았음';
    pick('delivered');
    expect($('#inpStatusReason').hidden).toBe(true);
    $('#btnStatus').click();
    await settle();
    expect(patches(api).map((c) => c.body)).toEqual([{ status: 'delivered' }]);
  });

  test('대표가 아니면 [대표 승인 요청] — 보낸 뒤 수주는 그대로, 승인 기다림이 뜬다', async () => {
    const api = fakeApi({ status: 'completed', owner: false });
    await openOrder(api);
    expect([...$('#selStatus').options].map((o) => o.textContent)).toEqual(['고르기', '배송 — 대표 승인 요청']);
    pick('delivered');
    expect($('#btnStatus').textContent).toBe('대표 승인 요청');
    expect(text('#statusHint')).toMatch(/대표가 승인하면 바뀝니다/);
    expect($('#inpStatusReason').hidden).toBe(false);
    $('#inpStatusReason').value = '하자 보수';
    $('#btnStatus').click();
    await settle();
    expect(patches(api).map((c) => c.body)).toEqual([{ status: 'delivered', reason: '하자 보수' }]);
    expect(text('#alert')).toMatch(/대표 승인 요청을 보냈습니다/);
    expect(text('#curStatus')).toBe('완료');
    expect($('#pendingBadge').hidden).toBe(false);
    expect(text('#statusHint')).toMatch(/대표 승인을 기다리는 요청: 완료 → 배송 \(완료 되돌리기\) · 하자 보수/);
    // 목록에도 표시
    expect(text('#orderRows')).toMatch(/완료 승인 기다림/);
  });

  test('대표는 같은 바꾸기를 바로 한다 — 버튼은 [상태 바꾸기]', async () => {
    const api = fakeApi({ status: 'completed', owner: true });
    await openOrder(api);
    expect([...$('#selStatus').options].map((o) => o.textContent)).toEqual(['고르기', '배송']);
    pick('delivered');
    expect($('#btnStatus').textContent).toBe('상태 바꾸기');
  });

  test('바꿀 수 있는 상태를 못 불러오면 고를 수 없게 하고 알린다', async () => {
    const api = fakeApi({ status: 'in_production' });
    const inner = api.fetchFn;
    api.fetchFn = jest.fn(async (url, init) =>
      String(url).endsWith('/events') ? { ok: false, status: 500, json: async () => ({ success: false, message: 'DB 오류' }) } : inner(url, init));
    await openOrder(api);
    expect($('#selStatus').disabled).toBe(true);
    expect($('#btnStatus').disabled).toBe(true);
    expect(text('#statusHint')).toMatch(/불러오지 못했습니다/);
    expect(text('#eventRows')).toMatch(/상태 기록을 불러오지 못했습니다/);
  });

  test('[저장] 은 상태를 싣지 않는다 — 상태는 [상태 바꾸기] 로만', async () => {
    const api = fakeApi({ status: 'in_production' });
    await openOrder(api);
    $('#inpReceived').value = '300000';
    $('#btnSaveOrder').click();
    await settle();
    expect(patches(api).map((c) => c.body)).toEqual([{ received_amount: 300000 }]);
  });

  test('window.prompt 를 쓰지 않는다 · 사유 칸은 500자까지', () => {
    expect(SCRIPT).not.toMatch(/window\.prompt|[^.\w]prompt\(/);
    expect(BODY).toMatch(/id="inpStatusReason" type="text" maxlength="500"/);
  });
});

describe('상태 기록', () => {
  test('최근 것부터 — 바꾼 것 · 사유 · 처리(바로 · 승인 기다림 · 대표 승인 · 반려)', async () => {
    const api = fakeApi({
      status: 'delivered',
      events: [
        { id: 'E4', kind: 'revert', from_status: 'completed', to_status: 'delivered', reason: '하자 <b>보수</b>', state: 'approved', created_at: '2026-10-28T01:00:00Z', decided_at: '2026-10-28T03:30:00Z' },
        { id: 'E3', kind: 'status', from_status: 'delivered', to_status: 'completed', reason: null, state: 'done', created_at: '2026-10-27T01:00:00Z' },
        { id: 'E1', kind: 'revive', from_status: 'cancelled', to_status: 'confirmed', reason: '다시', state: 'rejected', created_at: '2026-10-20T01:00:00Z', decided_at: '2026-10-21T01:00:00Z' },
      ],
    });
    await openOrder(api);
    const rows = [...document.querySelectorAll('#eventRows tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
    expect(rows).toEqual([
      ['2026-10-28 10:00', '완료 → 배송 (완료 되돌리기)', '하자 <b>보수</b>', '대표 승인 2026-10-28 12:30'],
      ['2026-10-27 10:00', '배송 → 완료', '-', '바로 바뀜'],
      ['2026-10-20 10:00', '취소 → 접수 (되살리기)', '다시', '반려 2026-10-21 10:00'],
    ]);
    expect(document.querySelector('#eventRows b')).toBeNull();
  });

  test('기록이 없으면 그렇다고 쓴다', async () => {
    const api = fakeApi({ status: 'in_production' });
    await openOrder(api);
    expect(text('#eventRows')).toBe('상태가 바뀐 기록이 아직 없습니다.');
    expect($('#pendingBadge').hidden).toBe(true);
  });
});

describe('대표 승인 기다림', () => {
  const REQ = { id: 'E7', order_id: 'O1', order_no: 'SO-1', customer_name: '김고객', kind: 'revert', from_status: 'completed', to_status: 'delivered', reason: '하자', state: 'pending', created_at: '2026-10-29T00:00:00Z' };

  test('대표에게만 목록이 보이고 [승인] · [반려] 가 결정을 보낸다', async () => {
    const api = fakeApi({ status: 'completed', owner: true, requests: [REQ, { ...REQ, id: 'E8', order_no: 'SO-2', customer_name: '이고객' }] });
    boot(api);
    await settle();
    expect($('#requestsCard').hidden).toBe(false);
    const rows = [...document.querySelectorAll('#requestRows tr')].map((tr) => [...tr.children].slice(0, 5).map((td) => td.textContent.trim()));
    expect(rows[0]).toEqual(['SO-1', '김고객', '완료 → 배송 (완료 되돌리기)', '하자', '2026-10-29 09:00']);
    expect(text('#orderRows')).toMatch(/승인 기다림/);

    $('[data-approve="E7"]').click();
    await settle();
    const decide = api.calls.filter((c) => c.method === 'POST' && /decide$/.test(c.u));
    expect(decide.map((c) => [c.u, c.body])).toEqual([['/order-events/E7/decide', { decision: 'approved' }]]);
    expect(text('#alert')).toMatch(/승인했습니다/);
    expect(document.querySelectorAll('#requestRows tr')).toHaveLength(1);

    $('[data-reject="E8"]').click();
    await settle();
    expect(api.calls.filter((c) => /decide$/.test(c.u)).pop().body).toEqual({ decision: 'rejected' });
    expect(text('#alert')).toMatch(/반려했습니다/);
    expect($('#requestsCard').hidden).toBe(true);
  });

  test('[열기] 로 그 수주 상세를 연다', async () => {
    const api = fakeApi({ status: 'completed', owner: true, requests: [REQ] });
    boot(api);
    await settle();
    $('[data-open-req="O1"]').click();
    await settle();
    expect($('#detailCard').hidden).toBe(false);
    expect(text('#curStatus')).toBe('완료');
  });

  test('대표가 아니면 목록이 비어 카드를 숨긴다', async () => {
    const api = fakeApi({ status: 'completed', owner: false, requests: [REQ] });
    boot(api);
    await settle();
    expect($('#requestsCard').hidden).toBe(true);
    expect(api.calls.some((c) => c.u === '/order-requests?state=pending')).toBe(true);
  });
});

test('상태 이름 = 워커 ORDER_STATUS_LABELS (접수 · 생산 중 · 배송 · 완료 · 취소)', () => {
  const erp = Function(`return ${HTML.match(/var STATUS_LABELS = (\{[\s\S]*?\});/)[1]}`)();
  const worker = Function(`return ${WORKER_EVENTS.match(/ORDER_STATUS_LABELS = Object\.freeze\((\{[\s\S]*?\})\);/)[1]}`)();
  expect(erp).toEqual(worker);
  expect(erp).toEqual(LABEL);
});
