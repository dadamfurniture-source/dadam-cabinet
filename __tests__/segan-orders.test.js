/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「프로젝트 관리 › 영업 › 계약 · 수금」 의 수주 · 수금 (segan/orders.js + segan/me.html #orders · #ordersCollect)
 *
 *   누가    다담 공장 구성원 · Manager · Expert · Agent 협력업체 구성원. 볼 수 없는 사람은 묻지도 않는다
 *   금액    서버가 대표 · 실장에게만 싣는다 — 직원 줄에는 금액 칸이 없고 수금 표는 「대표 · 실장만」
 *   데이터  workflow-api GET /orders · /order-requests · /company/schedules(받을 날) · /orders/:id(+ /events)
 *   상세    SeganShell.sheet — 상태 바꾸기 · 수금 일정(넣기 · 받음 · 되돌리기 · 삭제) · 상태 기록
 *   못 읽으면 칸째 감춘다 (승인 요청 · 받을 날만 못 읽으면 그 부분만)
 *   이름 · 금액은 모두 지어낸 것이다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'owner@example.com' } };
const PAY = 'https://pay.example.workers.dev';
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const CO = '11111111-1111-4111-8111-111111111111';
const O1 = '33333333-3333-4333-8333-333333333331';
const O2 = '33333333-3333-4333-8333-333333333332';
const O3 = '33333333-3333-4333-8333-333333333333';
const P1 = '44444444-4444-4444-8444-444444444441';
const P2 = '44444444-4444-4444-8444-444444444442';
const E1 = '88888888-8888-4888-8888-888888888881';
const C1 = '55555555-5555-4555-8555-555555555551';
const C2 = '55555555-5555-4555-8555-555555555552';
const R1 = '66666666-6666-4666-8666-666666666661';
const S1 = '77777777-7777-4777-8777-777777777771';
const S2 = '77777777-7777-4777-8777-777777777772';
const NOW = Date.parse('2026-11-10T03:00:00Z'); // 한국 시간 2026-11-10 (화) 12:00

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const company = (extra = {}) => ({
  id: CO,
  name: '다담 협력 주방',
  plan: 'expert',
  next_plan: null,
  status: 'active',
  sido: '대구광역시',
  gugun: '북구',
  role: 'owner',
  created_at: '2026-10-01T00:00:00Z',
  ...extra,
});
const partnerMe = (extra = {}) =>
  ok({ company: company(extra), application: null, members: [], invites: [] });
const HQ = ok({ company: null, application: null, members: [], invites: [], hq_member: true });

// 수주 1 = 접수 · 미수금 400만, 2 = 생산 중 · 다 받음 · 거래처, 3 = 취소
const ORDERS = [
  {
    id: O1,
    order_no: 'DD-1',
    customer_name: '가람 고객',
    status: 'confirmed',
    ordered_at: '2026-11-02T01:00:00Z',
    contract_amount: 5000000,
    received_amount: 1000000,
  },
  {
    id: O2,
    order_no: 'DD-2',
    customer_name: '나래 주방',
    status: 'in_production',
    ordered_at: '2026-10-20T01:00:00Z',
    price_tier: 'partner',
    contract_amount: 3000000,
    received_amount: 3000000,
  },
  {
    id: O3,
    order_no: 'DD-3',
    customer_name: '',
    status: 'cancelled',
    ordered_at: '2026-10-11T01:00:00Z',
    contract_amount: 2000000,
    received_amount: 0,
  },
  { id: 'x', order_no: 'DD-9' }, // 번호 모양이 아닌 줄 — 뺀다
];
/** 직원이 받는 줄 — 금액 칸이 없다 */
const STAFF_ORDERS = ORDERS.map((o) => {
  const { contract_amount, received_amount, ...rest } = o; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
});
const REQUEST = {
  id: E1,
  order_id: O2,
  order_no: 'DD-2',
  customer_name: '나래 주방',
  from_status: 'completed',
  to_status: 'in_production',
  kind: 'revert',
  reason: '재시공',
  created_at: '2026-11-09T02:30:00Z',
};
const SCHEDULES = {
  company: { id: CO, name: '다담 협력 주방' },
  can_manage: true,
  today: '2026-11-10',
  truncated: false,
  items: [
    {
      source: 'payment',
      type: 'payment_balance',
      day: '2026-11-20',
      order_no: 'DD-1',
      amount: 2000000,
    },
    {
      source: 'payment',
      type: 'payment_interim',
      day: '2026-11-05',
      order_no: 'DD-1',
      amount: 2000000,
    },
    {
      source: 'payment',
      type: 'payment_deposit',
      day: '2026-11-12',
      order_no: 'DD-8',
      amount: 500000,
    },
    { source: 'schedule', type: 'installation', day: '2026-11-11', order_no: 'DD-1' }, // 수금이 아니다
    { source: 'payment', type: 'payment_other', day: '없음', amount: 1 }, // 날짜가 아니다
  ],
};
const detail1 = (extra = {}) => ({
  order: {
    id: O1,
    order_no: 'DD-1',
    customer_name: '가람 고객',
    status: 'confirmed',
    ordered_at: '2026-11-02T01:00:00Z',
    contract_amount: 5000000,
  },
  costs: [],
  margin: {
    contract_amount: 5000000,
    received_amount: 1000000,
    outstanding: 4000000,
    cost_total: 2500000,
    margin: 2500000,
    margin_rate: 50,
    quoted_total: 5200000,
  },
  payments: [
    { id: P1, stage: 'deposit', amount: 1000000, due_on: '2026-11-02', paid_on: '2026-11-02' },
    { id: P2, stage: 'interim', amount: 2000000, due_on: '2026-11-05', paid_on: null },
  ],
  reworks: [],
  feedback: null,
  ...extra,
});
const events1 = (extra = {}) => ({
  status: 'confirmed',
  can_decide: true,
  pending: null,
  moves: [
    {
      to: 'in_production',
      label: '생산 중',
      kind: 'normal',
      reason_required: false,
      request: false,
    },
    { to: 'cancelled', label: '취소', kind: 'normal', reason_required: true, request: false },
    { to: 'completed', label: '완료', kind: 'normal', reason_required: false, request: true },
    { to: 'nowhere', label: '모름' }, // 모르는 상태 — 뺀다
  ],
  items: [
    {
      created_at: '2026-11-02T01:00:00Z',
      from_status: 'in_production',
      to_status: 'confirmed',
      kind: 'revive',
      reason: '고객 요청',
      state: 'approved',
      decided_at: '2026-11-03T00:00:00Z',
    },
  ],
  ...extra,
});
const PROJECTS = {
  company: { id: CO, name: '다담 협력 주방', kind: 'partner', plan: 'expert' },
  can_manage: true,
  items: [],
};

/**
 * me.html 을 올린다 (#p-contract).
 * opts.orders() → GET /orders, opts.requests() → GET /order-requests, opts.schedules(url) → GET /company/schedules,
 * opts.detail(id) · opts.events(id) → GET /orders/:id(/events), opts.move(body, id) → PATCH /orders/:id,
 * opts.pay(method, body, url) → /orders/:id/payments…, opts.decide(body, url) → POST /order-events/:id/decide
 * opts.info(body, id) → PATCH /orders/:id (status 없는 것), opts.costs · opts.reworks(method, body, url) → /orders/:id/costs… · /reworks…,
 * opts.reports(method, body, url) → /orders/:id/reports, opts.photo(init, url) → POST …/reports/photo,
 * opts.feedbackLink(url) → POST /orders/:id/feedback-link, opts.counterparties() → GET /counterparties
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: partnerMe(),
    hash: '#p-contract',
    orders: () => ok({ items: ORDERS }),
    requests: () => ok({ items: [] }),
    schedules: () => ok(SCHEDULES),
    detail: () => ok(detail1()),
    events: () => ok(events1()),
    move: () => ok({ id: O1, status: 'in_production', state: 'done' }),
    pay: () => ok({ id: P2 }),
    decide: () => ok({ id: E1, state: 'approved' }),
    info: () => ok({ id: O1 }),
    costs: () => ok({ id: C1 }),
    reworks: () => ok({ id: R1 }),
    reports: () => ok({ ready: true, can_report: false, items: [] }),
    photo: () => ok({ photo_path: 'reports/1.jpg' }),
    feedbackLink: () => ok({ url: 'https://dadam.example/f/abc' }),
    counterparties: () => ok({ items: [] }),
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/me.html' + opts.hash);
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  localStorage.clear();
  for (const k of [
    'AdminAccess',
    'DetailDesignAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganMake',
    'SeganMe',
    'SeganPartner',
    'SeganPartnerProjects',
    'SeganOrders',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
    paymentsApi: { url: PAY },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async () => ({ data: [], error: null }),
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve) => resolve({ data: [], error: null }),
        };
        return chain;
      },
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    // 사진은 글이 아니라 파일째 보낸다 — 풀지 않고 raw 로 남긴다
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const method = init.method || 'GET';
    calls.fetch.push({
      url,
      method,
      auth: (init.headers || {}).Authorization,
      type: (init.headers || {})['Content-Type'],
      body,
      raw: typeof init.body === 'string' ? undefined : init.body,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/orders') return reply(await opts.orders());
    if (url.startsWith(WORK + '/order-requests')) return reply(await opts.requests(url));
    if (url.startsWith(WORK + '/order-events/')) return reply(await opts.decide(body, url));
    if (url.startsWith(WORK + '/orders/')) {
      const rest = url.slice((WORK + '/orders/').length);
      const id = rest.split('/')[0];
      if (rest.includes('/payments')) return reply(await opts.pay(method, body, url));
      if (rest.endsWith('/events')) return reply(await opts.events(id));
      if (rest.endsWith('/reports/photo')) return reply(await opts.photo(init, url));
      if (rest.endsWith('/reports')) return reply(await opts.reports(method, body, url));
      if (rest.includes('/costs')) return reply(await opts.costs(method, body, url));
      if (rest.includes('/reworks')) return reply(await opts.reworks(method, body, url));
      if (rest.endsWith('/feedback-link')) return reply(await opts.feedbackLink(url));
      if (method === 'GET') return reply(await opts.detail(id));
      // 같은 주소의 PATCH — status 가 있으면 상태 바꾸기, 없으면 수주 정보 저장
      return reply(await (body && 'status' in body ? opts.move(body, id) : opts.info(body, id)));
    }
    if (url === WORK + '/counterparties') return reply(await opts.counterparties());
    if (url.startsWith(WORK + '/company/schedules')) return reply(await opts.schedules(url));
    if (url === WORK + '/company/projects') return reply(ok(PROJECTS));
    if (url === PAY + '/subscription') return reply(ok({ plan: 'free', status: 'active' }));
    if (url === PAY + '/plans') return reply(ok({ client_key: 'k', plans: [] }));
    if (url === WORK + '/work/me') return reply(ok({ ready: true, worker: null }));
    return reply(fail(404, 'not_found', 'x'));
  });
  Element.prototype.scrollIntoView = jest.fn();
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of [
    'segan/regions.js',
    'segan/partner.js',
    'segan/partner-projects.js',
    'segan/orders.js',
    'segan/shell.js',
    'segan/make.js',
    'segan/me.js',
  ])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganMe.ready;
  await flush();
  return calls;
}

/** 수주 스크립트만 올린다 — 순수 함수 시험 */
function lib() {
  delete window.SeganOrders;
  (0, eval)(read('segan/orders.js'));
  return window.SeganOrders;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
/** 화면에 보이는가 — 모듈이 감춘 칸(hidden) · 마이페이지가 끈 칸(me-off) 은 아니다 */
const seen = (id) => !!$(id) && !$(id).hidden && !$(id).classList.contains('me-off');
const heads = (id) => [...$(id).querySelectorAll('.od-table thead th')].map(text);
// 표의 줄 — '칸 | 칸 …' (지금 열린 줄은 끝에 ←)
const rows = (id) =>
  [...$(id).querySelectorAll('.od-row')].map(
    (tr) =>
      [...tr.children].map(text).join(' | ') + (tr.classList.contains('od-row--on') ? ' ←' : '')
  );
const kpi = (root) =>
  [...root.querySelectorAll('.od-kpi > div')].map(
    (d) => text(d.querySelector('dt')) + ' ' + text(d.querySelector('dd'))
  );
const msg = (id) => text($(id).querySelector('[data-od="msg"]'));
const go = async (hash) => {
  window.location.hash = hash;
  window.dispatchEvent(new Event('hashchange'));
  await flush();
};
const sheet = () => document.querySelector('.sg-sheet-wrap');
const sheetTitle = () => text(sheet().querySelector('.sg-sheet-title'));
const part = (name) => sheet().querySelector(`[data-od-part="${name}"]`);
const lines = (el) => [...el.querySelectorAll('.me-pt-row')].map(text);
const note = () => text(sheet().querySelector('[data-od="note"]'));
const err = () => {
  const e = sheet().querySelector('[data-od="err"]');
  return e.hidden ? '' : text(e);
};
/** 수주 줄을 눌러 상세를 연다 */
const open = async (id, box = 'orders') => {
  $(box).querySelector(`.od-open[data-id="${id}"]`).click();
  await flush();
};
const pick = async (value) => {
  const sel = part('status').querySelector('select[name="to"]');
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
};
const submit = async (form) => {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
};
const sent = (calls, method) => calls.fetch.filter((c) => c.method === method);

afterEach(() => {
  jest.restoreAllMocks();
  document.querySelectorAll('.sg-sheet-wrap').forEach((el) => el.remove());
  document.body.classList.remove('sg-locked');
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸(#partner) 안, 수주는 프로젝트 위, 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const orders = doc.getElementById('orders');
    const collect = doc.getElementById('ordersCollect');
    for (const el of [orders, collect]) {
      expect(el).not.toBeNull();
      expect(el.hasAttribute('hidden')).toBe(true);
      expect(el.closest('section').id).toBe('partner');
      expect(el.classList.contains('od')).toBe(true);
    }
    // 수주 표 다음은 견적서 목록(segan/quotes.js), 그다음이 수금
    expect(orders.nextElementSibling.id).toBe('quotes');
    expect(orders.nextElementSibling.nextElementSibling.id).toBe('ordersCollect');
    // 계약 화면은 칸 차례대로 — 수주가 그 단계 프로젝트보다 먼저다
    expect(orders.compareDocumentPosition(doc.getElementById('partnerProjects')) & 4).toBe(4);
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    // 없으면(-1) 차례 비교가 거짓으로 통과하지 않게 자리부터 본다
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['orders.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('orders.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'orders.js')");
  });

  test('고객 정보를 기기에 남기지 않는다 — 저장소 · 알림을 쓰지 않는다', () => {
    // 머리말의 설명 글은 빼고 본다 — 코드가 쓰는지만
    const code = read('segan/orders.js')
      .split('\n')
      .filter(
        (line) =>
          !line.trim().startsWith('//') &&
          !line.trim().startsWith('*') &&
          !line.includes('고객 정보  ')
      )
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
  });
});

describe('순수 함수', () => {
  test('canSee — 다담 공장 구성원 · Manager 이상 협력업체 구성원만', () => {
    const L = lib();
    expect(L.canSee({ hq_member: true })).toBe(true);
    for (const plan of ['manager', 'expert', 'agent'])
      for (const role of ['owner', 'manager', 'staff'])
        expect(L.canSee({ company: { plan, role } })).toBe(true);
    expect(L.canSee({ company: { plan: 'free', role: 'owner' } })).toBe(false);
    expect(L.canSee({ company: { plan: 'expert', role: 'guest' } })).toBe(false);
    expect(L.canSee({ company: null })).toBe(false);
    expect(L.canSee(null)).toBe(false);
    expect(L.canSee([])).toBe(false);
  });

  test('orderOf — 금액 칸은 서버가 실은 줄만, 번호 모양이 아니면 뺀다', () => {
    const L = lib();
    expect(L.orderOf(ORDERS[1])).toEqual({
      id: O2,
      order_no: 'DD-2',
      customer_name: '나래 주방',
      status: 'in_production',
      ordered_at: '2026-10-20T01:00:00Z',
      partner: true,
      money: true,
      contract: 3000000,
      received: 3000000,
    });
    const staff = L.orderOf(STAFF_ORDERS[0]);
    expect(staff.money).toBe(false);
    expect(staff.contract).toBeNull();
    expect(staff.received).toBeNull();
    expect(L.orderOf({ id: 'x' })).toBeNull();
    expect(L.orderOf(null)).toBeNull();
  });

  test('moneyViewer · collectRows · totalsOf — 금액을 보는 사람, 취소는 수금 표에서 뺀다', () => {
    const L = lib();
    const all = ORDERS.map(L.orderOf).filter(Boolean);
    const staff = STAFF_ORDERS.map(L.orderOf).filter(Boolean);
    expect(L.moneyViewer({ company: { role: 'staff' } }, all)).toBe(true); // 줄에 금액이 실렸다
    expect(L.moneyViewer({ company: { role: 'staff' } }, staff)).toBe(false);
    expect(L.moneyViewer({ company: { role: 'manager' } }, [])).toBe(true);
    expect(L.moneyViewer({ hq_member: true }, [])).toBe(false);
    expect(L.collectRows(all).map((o) => o.order_no)).toEqual(['DD-1', 'DD-2']);
    expect(L.collectRows(staff)).toEqual([]);
    expect(L.totalsOf(L.collectRows(all))).toEqual({
      contract: 8000000,
      received: 4000000,
      outstanding: 4000000,
    });
  });

  test('dueRange · duesOf — 지난 60일 ~ 앞으로 30일, 수금 일정만 날짜 차례로, 지난 날은 밀림', () => {
    const L = lib();
    expect(L.dueRange('2026-11-10')).toEqual({ from: '2026-09-11', to: '2026-12-10' });
    expect(L.duesOf({ data: SCHEDULES }, '2026-11-10')).toEqual([
      { day: '2026-11-05', stage: '중도금', order_no: 'DD-1', amount: 2000000, late: true },
      { day: '2026-11-12', stage: '계약금', order_no: 'DD-8', amount: 500000, late: false },
      { day: '2026-11-20', stage: '잔금', order_no: 'DD-1', amount: 2000000, late: false },
    ]);
    expect(L.duesOf({ data: { items: 'x' } }, '2026-11-10')).toBeNull();
    expect(L.duesOf(null, '2026-11-10')).toBeNull();
  });

  test('paySummary — 일정 합 · 받은 돈 · 남은 돈, 계약금액과 다르면 그 말', () => {
    const L = lib();
    const pays = detail1().payments;
    expect(L.paySummary(pays, 5000000)).toBe(
      '일정 합 3,000,000원 · 받은 돈 1,000,000원 · 남은 돈 2,000,000원 — 계약금액 5,000,000원 과 다릅니다'
    );
    expect(L.paySummary(pays, 3000000)).toBe(
      '일정 합 3,000,000원 · 받은 돈 1,000,000원 · 남은 돈 2,000,000원'
    );
  });

  test('onlineText · moveText · krw · whenKst — erp 화면과 같은 이름', () => {
    const L = lib();
    expect(L.onlineText(null)).toBeNull();
    expect(L.onlineText({ status: 'unknown' })).toBeNull();
    expect(L.onlineText({ status: 'paid', method: 'card' })).toEqual({
      text: '온라인 결제 · 카드',
      warn: '',
    });
    expect(
      L.onlineText({
        status: 'waiting_deposit',
        method: 'virtual_account',
        virtual_account: { due_at: '2026-11-12T14:59:00Z' },
      })
    ).toEqual({ text: '가상계좌 입금 대기 (기한 2026.11.12)', warn: '' });
    expect(
      L.onlineText({
        status: 'check_needed',
        amount_received: 900000,
        status_note: '금액이 다릅니다',
      })
    ).toEqual({ text: '확인 필요 · 들어온 돈 900,000원', warn: '금액이 다릅니다' });
    expect(
      L.moveText({ from_status: 'completed', to_status: 'in_production', kind: 'revert' })
    ).toBe('완료 → 생산 중 (완료 되돌리기)');
    expect(L.moveText({ from_status: 'confirmed', to_status: 'cancelled' })).toBe('접수 → 취소');
    expect(L.krw(1234567)).toBe('1,234,567원');
    expect(L.krw(0)).toBe('0원');
    expect(L.krw(null)).toBe('-');
    expect(L.whenKst('2026-11-09T02:30:00Z')).toBe('2026.11.09 11:30');
    expect(L.whenKst('')).toBe('-');
    expect(L.todayKst(NOW)).toBe('2026-11-10');
  });
});

describe('계약 화면 — 수주 표', () => {
  test('대표 — 번호 · 고객 · 상태 · 수주일 · 계약금액 · 미수금, 계약 단계 프로젝트와 함께', async () => {
    const calls = await load();
    expect(seen('orders')).toBe(true);
    expect(seen('partnerProjects')).toBe(true);
    expect(seen('ordersCollect')).toBe(false);
    expect(text($('ordersTitle'))).toBe('수주');
    expect(heads('orders')).toEqual(['수주번호', '고객', '상태', '수주일', '계약금액', '미수금']);
    expect(rows('orders')).toEqual([
      'DD-1 | 가람 고객 | 접수 | 2026.11.02 | 5,000,000원 | 4,000,000원',
      'DD-2 | 나래 주방 거래처 | 생산 중 | 2026.10.20 | 3,000,000원 | 0원',
      'DD-3 | - | 취소 | 2026.10.11 | 2,000,000원 | 2,000,000원',
    ]);
    // 다 받은 줄의 미수금은 옅게
    expect($('orders').querySelectorAll('.od-row')[1].lastElementChild.className).toBe(
      'od-num od-dim'
    );
    expect($('orders').querySelector('.od-req')).toBeNull();
    // 원가 · 재작업 · 완료 보고도 여기서 적는다 — PC 화면으로 보내는 링크는 없다
    expect(text($('orders').querySelector('.mk-note'))).toBe(
      '수주를 누르면 상태 · 수금 일정 · 원가 · 재작업 · 완료 보고를 적습니다.'
    );
    expect($('orders').querySelector('a.od-pc')).toBeNull();
    // 본인 토큰으로 묻는다 · 받을 날은 지난 60일 ~ 앞으로 30일
    const asked = calls.fetch.find((c) => c.url === WORK + '/orders');
    expect(asked.auth).toBe('Bearer tok-1');
    expect(
      calls.fetch.some((c) => c.url === WORK + '/company/schedules?from=2026-09-11&to=2026-12-10')
    ).toBe(true);
  });

  test('직원 — 금액 칸이 없다 · 받을 날을 묻지 않는다', async () => {
    const calls = await load({
      partner: partnerMe({ role: 'staff' }),
      orders: () => ok({ items: STAFF_ORDERS }),
    });
    expect(heads('orders')).toEqual(['수주번호', '고객', '상태', '수주일']);
    expect(rows('orders')[0]).toBe('DD-1 | 가람 고객 | 접수 | 2026.11.02');
    expect(calls.fetch.some((c) => c.url.startsWith(WORK + '/company/schedules'))).toBe(false);
    await go('#p-collect');
    expect(seen('ordersCollect')).toBe(true);
    expect(text($('ordersCollect'))).toBe('수금수금은 대표 · 실장만 봅니다.');
  });

  test('수주가 없으면 — erp 화면과 같은 빈 글', async () => {
    await load({ orders: () => ok({ items: [] }) });
    expect(seen('orders')).toBe(true);
    expect($('orders').querySelector('.od-table')).toBeNull();
    expect(text($('orders').querySelector('.me-empty'))).toContain('수주가 없습니다.');
    await go('#p-collect');
    expect(text($('ordersCollect').querySelector('.me-empty'))).toBe(
      '받을 돈을 볼 수주가 없습니다.'
    );
  });

  test('대표 승인 기다림 — 승인하면 POST decide, 목록을 다시 읽고 알린다', async () => {
    let waiting = [REQUEST];
    const decide = jest.fn(() => {
      waiting = [];
      return ok({ id: E1, state: 'approved' });
    });
    const calls = await load({ requests: () => ok({ items: waiting }), decide });
    const card = $('orders').querySelector('.od-req');
    expect(text(card.querySelector('.od-h'))).toBe('대표 승인 기다림');
    expect(lines(card)).toEqual([
      'DD-2 · 나래 주방완료 → 생산 중 (완료 되돌리기) · 재시공 · 2026.11.09 11:30승인반려열기',
    ]);
    // 기다리는 수주는 표에도 표시
    expect(rows('orders')[1]).toContain('생산 중 승인 기다림');
    card.querySelector('[data-act="approve"]').click();
    await flush();
    expect(decide).toHaveBeenCalledWith(
      { decision: 'approved' },
      WORK + '/order-events/' + E1 + '/decide'
    );
    expect(sent(calls, 'POST')).toHaveLength(1);
    expect($('orders').querySelector('.od-req')).toBeNull();
    expect(msg('orders')).toBe('승인했습니다. 수주 상태가 바뀌었습니다.');
  });

  test('반려 — POST decide rejected · 서버가 막으면 그 글을 보인다', async () => {
    const decide = jest
      .fn()
      .mockReturnValueOnce(fail(409, 'conflict', '이미 처리한 요청입니다.'))
      .mockReturnValue(ok({ id: E1, state: 'rejected' }));
    await load({ requests: () => ok({ items: [REQUEST] }), decide });
    $('orders').querySelector('[data-act="reject"]').click();
    await flush();
    expect(decide.mock.calls[0][0]).toEqual({ decision: 'rejected' });
    expect(msg('orders')).toBe('이미 처리한 요청입니다.');
    $('orders').querySelector('[data-act="reject"]').click();
    await flush();
    expect(msg('orders')).toBe('반려했습니다. 수주는 그대로입니다.');
  });
});

describe('수금 화면 — 수금 표', () => {
  test('합 · 받을 날 · 수주마다 (취소한 수주는 뺀다)', async () => {
    await load({ hash: '#p-collect' });
    expect(seen('ordersCollect')).toBe(true);
    expect(seen('orders')).toBe(false);
    expect(text($('ordersCollectTitle'))).toBe('수금');
    expect($('mePaneNote').hidden || $('mePaneNote').textContent === '').toBe(true);
    expect(kpi($('ordersCollect'))).toEqual([
      '계약금액 8,000,000원',
      '받은 돈 4,000,000원',
      '미수금 4,000,000원',
    ]);
    const dues = $('ordersCollect').querySelector('.od-dues');
    expect(lines(dues)).toEqual([
      '2026.11.05 (밀림)중도금 2,000,000원DD-1',
      '2026.11.12계약금 500,000원DD-8',
      '2026.11.20잔금 2,000,000원DD-1',
    ]);
    // 밀린 날은 색만이 아니라 글자로도
    expect(dues.querySelector('.od-late').textContent).toBe('2026.11.05 (밀림)');
    // 아는 수주의 일정만 누를 수 있다
    expect(
      [...dues.querySelectorAll('button.od-open')].map((b) => b.getAttribute('data-id'))
    ).toEqual([O1, O1]);
    expect(heads('ordersCollect')).toEqual([
      '수주번호',
      '고객',
      '상태',
      '계약금액',
      '받은 돈',
      '미수금',
    ]);
    expect(rows('ordersCollect')).toEqual([
      'DD-1 | 가람 고객 | 접수 | 5,000,000원 | 1,000,000원 | 4,000,000원',
      'DD-2 | 나래 주방 | 생산 중 | 3,000,000원 | 3,000,000원 | 0원',
    ]);
  });

  test('받을 날을 못 읽으면 그 부분만 뺀다 · 일정이 없으면 빈 글', async () => {
    await load({ hash: '#p-collect', schedules: () => fail(500, 'x', 'x') });
    expect(seen('ordersCollect')).toBe(true);
    expect($('ordersCollect').querySelector('.od-dues')).toBeNull();
    expect(text($('ordersCollect'))).not.toContain('받을 날');
    expect(rows('ordersCollect')).toHaveLength(2);

    await load({ hash: '#p-collect', schedules: () => ok({ ...SCHEDULES, items: [] }) });
    expect(text($('ordersCollect'))).toContain('이 기간에 받을 일정이 없습니다.');
  });

  test('받을 날 줄을 누르면 그 수주의 상세가 열린다', async () => {
    await load({ hash: '#p-collect' });
    $('ordersCollect').querySelector('.od-dues button.od-open').click();
    await flush();
    expect(sheetTitle()).toBe('DD-1 · 가람 고객');
    expect(rows('ordersCollect')[0]).toMatch(/←$/);
  });
});

describe('누가 보나 · 못 읽으면', () => {
  test('수주를 못 읽으면 칸째 감춘다 — 수금 화면은 「불러오지 못했습니다」', async () => {
    await load({ orders: () => fail(403, 'forbidden', 'x') });
    expect(seen('orders')).toBe(false);
    expect($('orders').innerHTML).toBe('');
    await go('#p-collect');
    expect(seen('ordersCollect')).toBe(false);
    expect($('mePaneNote').textContent).toContain('수금을 불러오지 못했습니다.');
  });

  test('모양이 틀린 답 · 끊김도 감춘다', async () => {
    await load({ orders: () => ok({ items: 'x' }) });
    expect(seen('orders')).toBe(false);
    await load({ orders: () => new Error('offline') });
    expect(seen('orders')).toBe(false);
  });

  test('승인 요청만 못 읽으면 표는 그대로', async () => {
    await load({ requests: () => fail(500, 'x', 'x') });
    expect(rows('orders')).toHaveLength(3);
    expect($('orders').querySelector('.od-req')).toBeNull();
  });

  test('프로젝트를 가지지 않는 업체(무료) · 업체가 없는 사람은 묻지 않는다', async () => {
    let calls = await load({ partner: partnerMe({ plan: 'free' }) });
    expect(calls.fetch.some((c) => c.url === WORK + '/orders')).toBe(false);
    expect($('orders').hidden).toBe(true);
    calls = await load({
      partner: ok({ company: null, application: null, members: [], invites: [] }),
    });
    expect(calls.fetch.some((c) => c.url === WORK + '/orders')).toBe(false);
    expect($('orders').hidden).toBe(true);
  });

  test('다담 공장 구성원 — 수주 표가 보이고 업체 칸이 열린다', async () => {
    await load({ partner: HQ });
    expect($('partner').hidden).toBe(false);
    expect(seen('orders')).toBe(true);
    expect(rows('orders')).toHaveLength(3);
    // 수주가 하나도 없으면 금액을 보는 사람인지 알 수 없다 — 「대표 · 실장만」 이라 하지 않는다
    await load({ partner: HQ, hash: '#p-collect', orders: () => ok({ items: [] }) });
    expect(text($('ordersCollect').querySelector('.me-empty'))).toBe(
      '받을 돈을 볼 수주가 없습니다.'
    );
  });
});

describe('상세 시트', () => {
  test('줄을 누르면 — 요약 · 상태 · 수금 일정 · 상태 기록, 닫으면 줄 표시가 풀린다', async () => {
    const calls = await load();
    await open(O1);
    expect(sheetTitle()).toBe('DD-1 · 가람 고객');
    expect(sheet().querySelector('.od-detail')).not.toBeNull();
    expect(rows('orders')[0]).toMatch(/←$/);
    expect(calls.fetch.some((c) => c.url === WORK + '/orders/' + O1)).toBe(true);
    expect(calls.fetch.some((c) => c.url === WORK + '/orders/' + O1 + '/events')).toBe(true);
    expect(kpi(part('summary'))).toEqual([
      '수주일 2026.11.02',
      '계약금액 5,000,000원',
      '수금 1,000,000원',
      '미수금 4,000,000원',
      '실적 원가 2,500,000원',
      '마진 2,500,000원 (50%)',
      '견적 총액(참고) 5,200,000원',
    ]);
    expect(text(part('status').querySelector('.od-now'))).toBe('지금 접수');
    expect([...part('status').querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      '고르기',
      '생산 중',
      '취소',
      '완료 — 대표 승인 요청',
    ]);
    expect(lines(part('pay'))).toEqual([
      '계약금 1,000,000원받기로 한 날 2026.11.02 · 받은 날 2026.11.02되돌리기삭제',
      '중도금 2,000,000원받기로 한 날 2026.11.05 (밀림) · 받은 날 -받음삭제',
    ]);
    expect(text(part('pay').querySelector('ul + .mk-note'))).toBe(
      '일정 합 3,000,000원 · 받은 돈 1,000,000원 · 남은 돈 2,000,000원 — 계약금액 5,000,000원 과 다릅니다'
    );
    expect(lines(part('events'))).toEqual([
      '생산 중 → 접수 (되살리기)2026.11.02 10:00 · 고객 요청대표 승인 2026.11.03 09:00',
    ]);
    // 같은 줄을 다시 눌러도 다시 묻지 않는다
    const before = calls.fetch.length;
    await open(O1);
    expect(calls.fetch.length).toBe(before);
    sheet().querySelector('.sg-sheet-x').click();
    await flush();
    expect(window.SeganOrders.state.open).toBeNull();
    expect(rows('orders')[0]).not.toMatch(/←$/);
  });

  test('직원 — 금액 · 수금 일정이 없다', async () => {
    await load({
      partner: partnerMe({ role: 'staff' }),
      orders: () => ok({ items: STAFF_ORDERS }),
      detail: () =>
        ok({
          order: {
            id: O1,
            order_no: 'DD-1',
            customer_name: '가람 고객',
            status: 'confirmed',
            ordered_at: '2026-11-02T01:00:00Z',
          },
          costs: [],
          reworks: [],
          feedback: null,
        }),
    });
    await open(O1);
    expect(kpi(part('summary'))).toEqual(['수주일 2026.11.02']);
    expect(part('pay').hidden).toBe(true);
    expect(part('pay').innerHTML).toBe('');
    expect(part('status').hidden).toBe(false);
  });

  test('못 읽으면 그 자리에 알린다 · 상태 기록만 못 읽으면 상태를 못 바꾼다', async () => {
    await load({ detail: () => fail(500, 'x', 'x') });
    await open(O1);
    expect(text(sheet().querySelector('[data-od="body"]'))).toBe(
      '수주를 불러오지 못했습니다. 닫았다가 다시 열어 주세요.'
    );

    await load({ events: () => fail(500, 'x', 'x') });
    await open(O1);
    expect(text(part('status'))).toContain('바꿀 수 있는 상태를 불러오지 못했습니다.');
    expect(part('status').querySelector('select').disabled).toBe(true);
    expect(part('status').querySelector('button[type="submit"]').disabled).toBe(true);
    expect(text(part('events'))).toContain('상태 기록을 불러오지 못했습니다.');
    expect(lines(part('pay'))).toHaveLength(2);
  });

  test('수금 일정 칸이 없는 서버 — 「준비되지 않았습니다」', async () => {
    await load({ detail: () => ok(detail1({ payments: null })) });
    await open(O1);
    expect(text(part('pay'))).toBe('수금 일정수금 일정 칸이 아직 준비되지 않았습니다.');
  });

  test('승인을 기다리는 수주 — 상태를 바꿀 수 없다', async () => {
    await load({
      events: () =>
        ok(
          events1({
            pending: { from_status: 'confirmed', to_status: 'completed', reason: '급한 건' },
          })
        ),
    });
    await open(O1);
    expect(text(part('status'))).toContain(
      '대표 승인을 기다리는 요청: 접수 → 완료 · 급한 건 — 승인 · 반려 전에는 상태를 바꿀 수 없습니다.'
    );
    expect([...part('status').querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      '승인 기다림',
    ]);
    expect(part('status').querySelector('button[type="submit"]').disabled).toBe(true);
  });
});

describe('상세 — 상태 바꾸기', () => {
  test('고르지 않으면 보내지 않는다 · 바꾸면 PATCH, 목록과 상세를 다시 읽는다', async () => {
    let status = 'confirmed';
    const move = jest.fn((body) => {
      status = body.status;
      return ok({ id: O1, status, state: 'done' });
    });
    const calls = await load({
      move,
      orders: () => ok({ items: ORDERS.map((o) => (o.id === O1 ? { ...o, status } : o)) }),
      events: () => ok(events1({ status })),
    });
    await open(O1);
    await submit(part('status').querySelector('form'));
    expect(err()).toBe('바꿀 상태를 골라 주세요.');
    expect(sent(calls, 'PATCH')).toHaveLength(0);
    await pick('in_production');
    expect(part('status').querySelector('input[name="reason"]')).toBeNull();
    expect(text(part('status').querySelector('button[type="submit"]'))).toBe('상태 바꾸기');
    await submit(part('status').querySelector('form'));
    expect(move).toHaveBeenCalledWith({ status: 'in_production' }, O1);
    expect(note()).toBe('상태를 생산 중(으)로 바꿨습니다.');
    expect(err()).toBe('');
    expect(text(part('status').querySelector('.od-now'))).toBe('지금 생산 중');
    expect(rows('orders')[0]).toBe(
      'DD-1 | 가람 고객 | 생산 중 | 2026.11.02 | 5,000,000원 | 4,000,000원 ←'
    );
  });

  test('사유가 필요한 상태 — 사유 칸이 생기고, 비면 보내지 않는다', async () => {
    const move = jest.fn(() => ok({ id: O1, status: 'cancelled', state: 'done' }));
    await load({ move });
    await open(O1);
    await pick('cancelled');
    const form = () => part('status').querySelector('form');
    expect(form().querySelector('input[name="reason"]')).not.toBeNull();
    expect(text(form())).toContain('사유를 적어야 바꿀 수 있습니다.');
    await submit(form());
    expect(err()).toBe('사유를 적어 주세요.');
    expect(move).not.toHaveBeenCalled();
    form().querySelector('input[name="reason"]').value = '  고객 변심  ';
    await submit(form());
    expect(move).toHaveBeenCalledWith({ status: 'cancelled', reason: '고객 변심' }, O1);
    expect(note()).toBe('상태를 취소(으)로 바꿨습니다.');
  });

  test('대표 승인이 필요한 상태 — 「대표 승인 요청」, 서버가 pending 이면 요청을 보냈다고 알린다', async () => {
    const move = jest.fn(() => ok({ id: O1, status: 'confirmed', state: 'pending' }));
    await load({ move });
    await open(O1);
    await pick('completed');
    expect(text(part('status').querySelector('button[type="submit"]'))).toBe('대표 승인 요청');
    expect(text(part('status'))).toContain('대표가 승인하면 바뀝니다.');
    await submit(part('status').querySelector('form'));
    expect(move).toHaveBeenCalledWith({ status: 'completed' }, O1);
    expect(note()).toBe('대표 승인 요청을 보냈습니다. 승인되면 완료(으)로 바뀝니다.');
  });

  test('서버가 막으면 그 글을 그 자리에', async () => {
    await load({ move: () => fail(409, 'conflict', '수금이 남아 완료할 수 없습니다.') });
    await open(O1);
    await pick('in_production');
    await submit(part('status').querySelector('form'));
    expect(err()).toBe('수금이 남아 완료할 수 없습니다.');
    expect(note()).toBe('');
  });
});

describe('상세 — 수금 일정', () => {
  test('넣기 — 금액 · 날이 없으면 보내지 않는다, 넣으면 POST', async () => {
    const pay = jest.fn(() => ok({ id: P2 }));
    await load({ pay });
    await open(O1);
    const form = () => part('pay').querySelector('form');
    await submit(form());
    expect(err()).toBe('금액을 넣어 주세요.');
    form().elements.amount.value = '2000000';
    await submit(form());
    expect(err()).toBe('받기로 한 날을 넣어 주세요.');
    expect(pay).not.toHaveBeenCalled();
    form().elements.stage.value = 'balance';
    form().elements.due_on.value = '2026-11-20';
    await submit(form());
    expect(pay).toHaveBeenCalledWith(
      'POST',
      { stage: 'balance', amount: 2000000, due_on: '2026-11-20' },
      WORK + '/orders/' + O1 + '/payments'
    );
    expect(note()).toBe('수금 일정을 넣었습니다.');
    expect(err()).toBe('');
  });

  test('받음 = 오늘 날짜로 PATCH · 되돌리기 = null', async () => {
    const pay = jest.fn(() => ok({ id: P2 }));
    await load({ pay });
    await open(O1);
    part('pay').querySelector(`[data-act="pay"][data-id="${P2}"]`).click();
    await flush();
    expect(pay).toHaveBeenLastCalledWith(
      'PATCH',
      { paid_on: '2026-11-10' },
      WORK + '/orders/' + O1 + '/payments/' + P2
    );
    expect(note()).toBe('받은 것으로 적었습니다.');
    part('pay').querySelector(`[data-act="unpay"][data-id="${P1}"]`).click();
    await flush();
    expect(pay).toHaveBeenLastCalledWith(
      'PATCH',
      { paid_on: null },
      WORK + '/orders/' + O1 + '/payments/' + P1
    );
    expect(note()).toBe('받음을 되돌렸습니다.');
  });

  test('삭제 — 한 번 더 묻는다 (그만 · 삭제)', async () => {
    const pay = jest.fn(() => ok({ deleted: true }));
    await load({ pay });
    await open(O1);
    const row = () => part('pay').querySelectorAll('.me-pt-row')[1];
    row().querySelector('[data-act="del"]').click();
    await flush();
    expect(text(row().querySelector('.rd-acts'))).toBe('이 일정을 지울까요?삭제그만');
    expect(pay).not.toHaveBeenCalled();
    row().querySelector('[data-act="del-no"]').click();
    await flush();
    expect(text(row().querySelector('.rd-acts'))).toBe('받음삭제');
    row().querySelector('[data-act="del"]').click();
    await flush();
    row().querySelector('[data-act="del-yes"]').click();
    await flush();
    expect(pay).toHaveBeenCalledWith(
      'DELETE',
      undefined,
      WORK + '/orders/' + O1 + '/payments/' + P2
    );
    expect(note()).toBe('수금 일정을 지웠습니다.');
  });

  test('온라인 결제 줄 — 확인 필요는 글자로도 알린다', async () => {
    await load({
      detail: () =>
        ok(
          detail1({
            payments: [
              {
                id: P1,
                stage: 'deposit',
                amount: 1000000,
                due_on: '2026-11-12',
                paid_on: null,
                online: {
                  status: 'check_needed',
                  amount_received: 900000,
                  status_note: '금액이 다릅니다',
                },
              },
            ],
          })
        ),
    });
    await open(O1);
    expect(lines(part('pay'))[0]).toContain('확인 필요 · 들어온 돈 900,000원 — 금액이 다릅니다');
    expect(part('pay').querySelector('.od-late').textContent).toBe('— 금액이 다릅니다');
  });
});

// 거래처 목록 — 거래처(partner) 하나 · 공급처(supplier) 하나 · 쓰지 않는 것 하나
const CPS = [
  { id: S1, name: '한결 인테리어', kind: 'partner', active: true },
  { id: S2, name: '새봄 목재', kind: 'supplier', active: true },
  { id: '77777777-7777-4777-8777-777777777773', name: '옛 거래처', kind: 'partner', active: false },
];
const COSTS = [
  {
    id: C1,
    category: 'material',
    amount: 1200000,
    vat_amount: 120000,
    description: 'PB 18T',
    vendor_name: '새봄 목재',
    evidence_type: 'tax_invoice',
    spent_on: '2026-11-05',
    due_on: null,
  },
  {
    id: C2,
    category: 'outsourcing',
    amount: 300000,
    vat_amount: null,
    description: '',
    vendor_name: '',
    evidence_type: null,
    spent_on: null,
    due_on: '2026-11-15',
  },
];
const REWORK = {
  id: R1,
  kind: 'as',
  cause: 'install',
  occurred_on: '2026-11-08',
  minutes: 90,
  cost: 50000,
  parts: '상부장 도어 1장',
  memo: '경첩 다시',
};
/** 수주 목록을 읽은 횟수 — 상세만 다시 읽는 일에는 늘지 않는다 */
const listReads = (calls) => calls.fetch.filter((c) => c.url === WORK + '/orders').length;
const form = (name) => part(name).querySelector('form');
const options = (sel) => [...sel.options].map((o) => o.textContent);
const change = async (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
};
const press = async (el) => {
  el.click();
  await flush();
};

describe('상세 — 수주 정보', () => {
  test('수금 일정이 있고 구분이 안 실려 오면 칸이 없다 · 구분만 실려 오면 구분만', async () => {
    await load();
    await open(O1);
    expect(part('info').hidden).toBe(true);
    expect(part('info').innerHTML).toBe('');

    const d = detail1();
    d.order.price_tier = 'customer';
    d.order.partner_id = null;
    await load({ detail: () => ok(d) });
    await open(O1);
    expect(text(part('info').querySelector('h3'))).toBe('수주 정보');
    expect(form('info').elements.received).toBeUndefined();
    expect(options(form('info').elements.tier)).toEqual(['고객', '거래처']);
    expect(text(form('info').querySelector('.mk-note'))).toBe(
      '수금액은 수금 일정의 받은 합입니다. 일정에서 받음을 눌러 주세요.'
    );
  });

  test('저장 — 수금액 · 구분 · 거래처를 PATCH, 목록과 상세를 다시 읽는다', async () => {
    const d = detail1({ payments: [] });
    Object.assign(d.order, { price_tier: null, partner_id: null, received_amount: 300000 });
    const info = jest.fn((body) => {
      Object.assign(d.order, body);
      return ok({ id: O1 });
    });
    const calls = await load({
      info,
      detail: () => ok(d),
      counterparties: () => ok({ items: CPS }),
    });
    await open(O1);
    expect(form('info').elements.received.value).toBe('300000');
    expect(options(form('info').elements.tier)).toEqual([
      '모름 (계약금으로 짐작)',
      '고객',
      '거래처',
    ]);
    // 거래처 고르기는 구분이 거래처일 때만 — 공급처 · 쓰지 않는 거래처는 없다
    const box = () => form('info').querySelector('[data-od="partner"]');
    expect(box().hidden).toBe(true);
    await change(form('info').elements.tier, 'partner');
    expect(box().hidden).toBe(false);
    expect(options(form('info').elements.partner)).toEqual(['고르지 않음', '한결 인테리어']);
    form('info').elements.received.value = '500000';
    form('info').elements.partner.value = S1;
    const before = listReads(calls);
    await submit(form('info'));
    expect(info).toHaveBeenCalledWith(
      { received_amount: 500000, price_tier: 'partner', partner_id: S1 },
      O1
    );
    expect(note()).toBe('수주 정보를 저장했습니다.');
    expect(listReads(calls)).toBe(before + 1);
    expect(form('info').elements.partner.value).toBe(S1);
    expect(box().hidden).toBe(false);
  });

  test('거래처 → 고객으로 바꾸면 거래처를 비운다 · 목록에 없는 거래처도 그대로 보인다', async () => {
    const d = detail1();
    Object.assign(d.order, { price_tier: 'partner', partner_id: 'gone-1' });
    const info = jest.fn(() => ok({ id: O1 }));
    await load({ info, detail: () => ok(d), counterparties: () => ok({ items: CPS }) });
    await open(O1);
    expect(options(form('info').elements.partner)).toEqual([
      '고르지 않음',
      '지금 거래처 (목록에 없음)',
      '한결 인테리어',
    ]);
    expect(form('info').elements.partner.value).toBe('gone-1');
    await change(form('info').elements.tier, 'customer');
    expect(form('info').querySelector('[data-od="partner"]').hidden).toBe(true);
    await submit(form('info'));
    expect(info).toHaveBeenCalledWith({ price_tier: 'customer', partner_id: null }, O1);
  });

  test('서버가 막으면 그 글을 그 자리에', async () => {
    const d = detail1({ payments: [] });
    await load({
      detail: () => ok(d),
      info: () => fail(403, 'forbidden', '대표만 고칠 수 있습니다.'),
    });
    await open(O1);
    await submit(form('info'));
    expect(err()).toBe('대표만 고칠 수 있습니다.');
    expect(note()).toBe('');
  });
});

describe('상세 — 실적 원가', () => {
  test('줄 — 분류 · 공급가 · 부가세 · 증빙 · 낸 날, 없으면 없다고', async () => {
    await load();
    await open(O1);
    expect(text(part('cost').querySelector('h3'))).toBe('실적 원가');
    expect(text(part('cost').querySelector('[data-od-list]'))).toBe('입력된 원가가 없습니다.');
    expect(text(part('cost').querySelector('summary'))).toBe('원가 넣기');
    expect(part('cost').querySelector('details').open).toBe(false);

    await load({ detail: () => ok(detail1({ costs: COSTS })) });
    await open(O1);
    expect(lines(part('cost'))).toEqual([
      '자재 1,200,000원PB 18T · 새봄 목재 · 부가세 120,000원 · 세금계산서 · 낸 날 2026.11.05삭제',
      '외주 300,000원부가세 미기재 · 낼 날 2026.11.15냈음삭제',
    ]);
  });

  test('넣기 — 공급가 · 부가세를 살피고 POST, 칸을 비우고 상세만 다시 읽는다', async () => {
    const list = [];
    const costs = jest.fn((method, body) => {
      list.push({ id: C1, ...body });
      return ok({ id: C1 });
    });
    const calls = await load({ costs, detail: () => ok(detail1({ costs: list })) });
    await open(O1);
    part('cost').querySelector('details').open = true;
    const f = () => form('cost');
    expect(f().elements.supplier).toBeUndefined();
    await submit(f());
    expect(err()).toBe('공급가를 입력해 주세요.');
    f().elements.amount.value = '500000';
    f().elements.vat.value = '-1';
    await submit(f());
    expect(err()).toBe('부가세는 0 이상으로 입력해 주세요.');
    expect(costs).not.toHaveBeenCalled();
    f().elements.vat.value = '';
    f().elements.category.value = 'hardware';
    f().elements.vendor.value = '  다온 철물  ';
    f().elements.description.value = '경첩';
    f().elements.evidence.value = 'card';
    f().elements.spent_on.value = '2026-11-09';
    const before = listReads(calls);
    await submit(f());
    expect(costs).toHaveBeenCalledWith(
      'POST',
      {
        category: 'hardware',
        description: '경첩',
        vendor_name: '다온 철물',
        counterparty_id: null,
        due_on: null,
        amount: 500000,
        vat_amount: null,
        evidence_type: 'card',
        spent_on: '2026-11-09',
      },
      WORK + '/orders/' + O1 + '/costs'
    );
    expect(note()).toBe('원가를 추가했습니다.');
    expect(err()).toBe('');
    expect(lines(part('cost'))).toEqual([
      '부자재 500,000원경첩 · 다온 철물 · 부가세 미기재 · 카드 · 낸 날 2026.11.09삭제',
    ]);
    // 넣은 뒤 — 칸은 비고, 펼친 채로 남는다. 목록(수주 표)은 다시 읽지 않는다
    expect(f().elements.amount.value).toBe('');
    expect(f().elements.description.value).toBe('');
    expect(part('cost').querySelector('details').open).toBe(true);
    expect(listReads(calls)).toBe(before);
  });

  test('공급처를 고르면 거래처 적는 칸을 감추고 공급처 번호를 보낸다', async () => {
    const costs = jest.fn(() => ok({ id: C1 }));
    await load({ costs, counterparties: () => ok({ items: CPS }) });
    await open(O1);
    const f = () => form('cost');
    const vendor = () => f().querySelector('[data-od="vendor"]');
    expect(options(f().elements.supplier)).toEqual(['직접 적기', '새봄 목재']);
    f().elements.vendor.value = '손으로 적은 곳';
    await change(f().elements.supplier, S2);
    expect(vendor().hidden).toBe(true);
    f().elements.amount.value = '80000';
    f().elements.vat.value = '8000';
    f().elements.due_on.value = '2026-11-30';
    await submit(f());
    expect(costs.mock.calls[0][1]).toEqual({
      category: 'material',
      description: '',
      vendor_name: '',
      counterparty_id: S2,
      due_on: '2026-11-30',
      amount: 80000,
      vat_amount: 8000,
      evidence_type: null,
      spent_on: null,
    });
    expect(vendor().hidden).toBe(false);
    expect(f().elements.supplier.value).toBe('');
  });

  test('냈음 = 오늘 날짜로 PATCH · 삭제는 한 번 더 묻는다 — 적던 칸은 그대로 남는다', async () => {
    const costs = jest.fn(() => ok({ id: C2 }));
    const calls = await load({ costs, detail: () => ok(detail1({ costs: COSTS })) });
    await open(O1);
    part('cost').querySelector('details').open = true;
    form('cost').elements.description.value = '적던 글';
    const before = listReads(calls);
    await press(part('cost').querySelector(`[data-act="cost-paid"][data-id="${C2}"]`));
    expect(costs).toHaveBeenLastCalledWith(
      'PATCH',
      { spent_on: '2026-11-10' },
      WORK + '/orders/' + O1 + '/costs/' + C2
    );
    expect(note()).toBe('낸 것으로 적었습니다.');
    const row = () => part('cost').querySelectorAll('.me-pt-row')[0];
    await press(row().querySelector('[data-act="del"]'));
    expect(text(row().querySelector('.rd-acts'))).toBe('이 원가를 지울까요?삭제그만');
    await press(row().querySelector('[data-act="del-no"]'));
    expect(text(row().querySelector('.rd-acts'))).toBe('삭제');
    await press(row().querySelector('[data-act="del"]'));
    await press(row().querySelector('[data-act="del-yes"]'));
    expect(costs).toHaveBeenLastCalledWith(
      'DELETE',
      undefined,
      WORK + '/orders/' + O1 + '/costs/' + C1
    );
    expect(note()).toBe('원가를 지웠습니다.');
    expect(form('cost').elements.description.value).toBe('적던 글');
    expect(part('cost').querySelector('details').open).toBe(true);
    expect(listReads(calls)).toBe(before);
  });

  test('서버가 막으면 그 글을 그 자리에 — 적은 것은 지우지 않는다', async () => {
    await load({ costs: () => fail(400, 'bad_request', '낸 날이 수주일보다 앞섭니다.') });
    await open(O1);
    form('cost').elements.amount.value = '1000';
    await submit(form('cost'));
    expect(err()).toBe('낸 날이 수주일보다 앞섭니다.');
    expect(form('cost').elements.amount.value).toBe('1000');
  });
});

describe('상세 — 재작업 · A/S', () => {
  test('줄 · 적기 · 지우기', async () => {
    const list = [REWORK];
    const reworks = jest.fn((method, body) => {
      if (method === 'POST') list.push({ id: 'r-2', ...body });
      else list.shift();
      return ok({ id: R1 });
    });
    const calls = await load({ reworks, detail: () => ok(detail1({ reworks: list })) });
    await open(O1);
    expect(text(part('rework').querySelector('h3'))).toBe('재작업 · A/S');
    expect(lines(part('rework'))).toEqual([
      'A/S (설치 뒤) · 설치2026.11.08 · 90분 · 비용 50,000원 · 상부장 도어 1장 · 경첩 다시삭제',
    ]);
    expect(text(part('rework').querySelector('summary'))).toBe('재작업 · A/S 적기');
    const f = () => form('rework');
    f().elements.cause.value = 'cutting';
    f().elements.minutes.value = '120';
    const before = listReads(calls);
    await submit(f());
    expect(reworks).toHaveBeenCalledWith(
      'POST',
      {
        kind: 'rework',
        cause: 'cutting',
        occurred_on: null,
        minutes: 120,
        cost: null,
        parts: '',
        memo: '',
      },
      WORK + '/orders/' + O1 + '/reworks'
    );
    expect(note()).toBe('재작업 · A/S 를 기록했습니다.');
    expect(lines(part('rework'))[1]).toBe('재작업 (공장) · 재단120분삭제');
    expect(f().elements.minutes.value).toBe('');

    const row = () => part('rework').querySelectorAll('.me-pt-row')[0];
    await press(row().querySelector('[data-act="del"]'));
    expect(text(row().querySelector('.rd-acts'))).toBe('이 기록을 지울까요?삭제그만');
    await press(row().querySelector('[data-act="del-yes"]'));
    expect(reworks).toHaveBeenLastCalledWith(
      'DELETE',
      undefined,
      WORK + '/orders/' + O1 + '/reworks/' + R1
    );
    expect(note()).toBe('기록을 지웠습니다.');
    expect(lines(part('rework'))).toEqual(['재작업 (공장) · 재단120분삭제']);
    expect(listReads(calls)).toBe(before);
  });

  test('기록 칸이 없는 서버 — 「준비되지 않았습니다」 · 적은 것이 없으면 없다고', async () => {
    await load({ detail: () => ok(detail1({ reworks: null })) });
    await open(O1);
    expect(text(part('rework'))).toBe(
      '재작업 · A/S재작업 · A/S 기록 칸이 아직 준비되지 않았습니다.'
    );
    expect(form('rework')).toBeNull();

    await load();
    await open(O1);
    expect(text(part('rework').querySelector('[data-od-list]'))).toBe(
      '적은 재작업 · A/S 가 없습니다.'
    );
  });

  test('직원 — 재작업 줄만 본다 (적기 · 지우기 없음), 원가 · 수주 정보 · 거래처 목록은 없다', async () => {
    const calls = await load({
      partner: partnerMe({ role: 'staff' }),
      orders: () => ok({ items: STAFF_ORDERS }),
      detail: () =>
        ok({
          order: {
            id: O1,
            order_no: 'DD-1',
            customer_name: '가람 고객',
            status: 'confirmed',
            ordered_at: '2026-11-02T01:00:00Z',
          },
          costs: [],
          reworks: [REWORK],
          feedback: null,
        }),
    });
    await open(O1);
    expect(lines(part('rework'))).toEqual([
      'A/S (설치 뒤) · 설치2026.11.08 · 90분 · 비용 50,000원 · 상부장 도어 1장 · 경첩 다시',
    ]);
    expect(form('rework')).toBeNull();
    expect(part('cost').hidden).toBe(true);
    expect(part('info').hidden).toBe(true);
    expect(part('report').hidden).toBe(false);
    expect(calls.fetch.some((c) => c.url === WORK + '/counterparties')).toBe(false);
  });
});

describe('상세 — 설치 · A/S 완료 보고', () => {
  const photoFile = (name, type) => new File(['x'], name, { type });
  const attach = (files) =>
    Object.defineProperty(form('report').elements.photos, 'files', {
      value: files,
      configurable: true,
    });

  test('목록 — 언제 · 메모 · 사진 링크(https 만), 남길 수 없는 사람에게는 넣는 칸이 없다', async () => {
    const calls = await load({
      reports: () =>
        ok({
          ready: true,
          can_report: false,
          items: [
            {
              created_at: '2026-11-09T05:30:00Z',
              label: '설치 완료',
              kind: 'install_done',
              note: '문 조정 끝',
              photo_urls: [
                'https://img.example/a.jpg',
                'http://img.example/b.jpg',
                'https://img.example/c.jpg',
              ],
            },
          ],
        }),
    });
    await open(O1);
    expect(calls.fetch.some((c) => c.url === WORK + '/orders/' + O1 + '/reports')).toBe(true);
    expect(text(part('report').querySelector('h3'))).toBe('설치 · A/S 완료 보고');
    expect(lines(part('report'))).toEqual(['설치 완료2026.11.09 14:30 · 문 조정 끝사진 1사진 2']);
    const photos = [...part('report').querySelectorAll('.me-pt-row a')];
    expect(photos.map((a) => a.getAttribute('href'))).toEqual([
      'https://img.example/a.jpg',
      'https://img.example/c.jpg',
    ]);
    expect(photos.every((a) => a.target === '_blank' && a.rel === 'noopener')).toBe(true);
    expect(form('report')).toBeNull();
    // 작업 지시로 올라온 보고는 PC 화면에서
    const link = part('report').querySelector('a[data-desktop-tab]');
    expect(text(link)).toBe('작업 지시 보고 ↗');
    expect(link.getAttribute('href')).toBe('../admin/work-reports.html?order=' + O1);
  });

  test('없으면 없다고 · 칸이 없는 서버 · 못 읽었을 때', async () => {
    await load();
    await open(O1);
    expect(text(part('report').querySelector('[data-od-list]'))).toBe('아직 보고가 없습니다.');

    await load({ reports: () => ok({ ready: false, can_report: false, items: [] }) });
    await open(O1);
    expect(text(part('report'))).toContain('완료 보고 칸이 아직 준비되지 않았습니다.');
    expect(form('report')).toBeNull();

    await load({ reports: () => fail(500, 'x', 'x') });
    await open(O1);
    expect(text(part('report'))).toContain('완료 보고를 불러오지 못했습니다.');
    // 보고를 못 읽어도 나머지는 그대로
    expect(lines(part('pay'))).toHaveLength(2);
  });

  test('남기기 — 사진을 한 장씩 올린 다음 보고를 보낸다', async () => {
    let n = 0;
    const photo = jest.fn(() => ok({ photo_path: 'reports/' + ++n + '.jpg' }));
    const items = [];
    const reports = jest.fn((method, body) => {
      if (method !== 'POST') return ok({ ready: true, can_report: true, items });
      items.push({ created_at: '2026-11-10T03:00:00Z', kind: body.kind, note: body.note });
      return ok({ id: 'rep-1' }, 201);
    });
    const calls = await load({ photo, reports });
    await open(O1);
    expect(text(part('report').querySelector('summary'))).toBe('완료 보고 남기기');
    expect(text(form('report').querySelector('.mk-note'))).toBe(
      '설치 · A/S 를 마치면 사진과 함께 남깁니다. 본사에는 기록으로 갑니다 (검수 없음).'
    );
    const a = photoFile('a.jpg', 'image/jpeg');
    const b = photoFile('b.png', 'image/png');
    attach([a, b]);
    form('report').elements.kind.value = 'as_done';
    form('report').elements.note.value = '  실리콘 다시  ';
    const before = listReads(calls);
    await submit(form('report'));
    const ups = calls.fetch.filter((c) => c.url.endsWith('/reports/photo'));
    expect(ups.map((c) => [c.method, c.type, c.raw])).toEqual([
      ['POST', 'image/jpeg', a],
      ['POST', 'image/png', b],
    ]);
    expect(ups.every((c) => c.auth === 'Bearer tok-1')).toBe(true);
    expect(reports).toHaveBeenCalledWith(
      'POST',
      { kind: 'as_done', note: '실리콘 다시', photo_paths: ['reports/1.jpg', 'reports/2.jpg'] },
      WORK + '/orders/' + O1 + '/reports'
    );
    expect(note()).toBe('A/S 완료 보고를 남겼습니다.');
    expect(lines(part('report'))).toEqual(['A/S 완료2026.11.10 12:00 · 실리콘 다시']);
    expect(form('report').elements.note.value).toBe('');
    expect(form('report').querySelector('button[type="submit"]').disabled).toBe(false);
    expect(form('report').querySelector('[data-od="report-msg"]').hidden).toBe(true);
    expect(listReads(calls)).toBe(before);

    // 사진 · 메모 없이도 남긴다
    attach([]);
    await submit(form('report'));
    expect(reports).toHaveBeenCalledWith(
      'POST',
      { kind: 'install_done', note: null, photo_paths: [] },
      WORK + '/orders/' + O1 + '/reports'
    );
    expect(note()).toBe('설치 완료 보고를 남겼습니다.');
  });

  test('사진이 10장을 넘으면 보내지 않는다 · 사진을 못 올리면 보고도 보내지 않는다', async () => {
    const posted = (reports) => reports.mock.calls.filter((c) => c[0] === 'POST');
    const reportsOk = () =>
      jest.fn((method) =>
        method === 'POST' ? ok({ id: 'rep-1' }) : ok({ ready: true, can_report: true, items: [] })
      );
    let reports = reportsOk();
    const photo = jest.fn(() => ok({ photo_path: 'reports/1.jpg' }));
    await load({ reports, photo });
    await open(O1);
    attach(Array.from({ length: 11 }, (_, i) => photoFile(i + '.jpg', 'image/jpeg')));
    await submit(form('report'));
    expect(err()).toBe('사진은 10장까지입니다.');
    expect(photo).not.toHaveBeenCalled();
    expect(posted(reports)).toHaveLength(0);

    reports = reportsOk();
    await load({ reports, photo: () => fail(413, 'too_large', '사진이 너무 큽니다.') });
    await open(O1);
    attach([photoFile('a.jpg', 'image/jpeg')]);
    form('report').elements.note.value = '적던 메모';
    await submit(form('report'));
    expect(err()).toBe('사진이 너무 큽니다.');
    expect(posted(reports)).toHaveLength(0);
    expect(form('report').elements.note.value).toBe('적던 메모');
    expect(form('report').querySelector('button[type="submit"]').disabled).toBe(false);

    reports = reportsOk();
    await load({ reports, photo: () => fail(500, 'x') });
    await open(O1);
    attach([photoFile('a.jpg', 'image/jpeg')]);
    await submit(form('report'));
    expect(err()).toBe('사진을 올리지 못했습니다 (500)');
    expect(posted(reports)).toHaveLength(0);
  });
});

describe('상세 — 설치 후 한 문항', () => {
  const fb = (feedback) => ({ detail: () => ok(detail1({ feedback })) });
  const lead = () => text(part('feedback').querySelector('.mk-note, .me-empty'));
  const button = () => part('feedback').querySelector('[data-act="feedback-link"]');

  test('칸이 없는 서버 · 아직 안 보냄 · 답 기다림 · 기간 지남 · 받은 답', async () => {
    await load();
    await open(O1);
    expect(text(part('feedback'))).toBe(
      '설치 후 한 문항설치 후 문항 칸이 아직 준비되지 않았습니다.'
    );
    expect(button()).toBeNull();

    await load(fb({ exists: false }));
    await open(O1);
    expect(lead()).toBe(
      '아직 보내지 않았습니다. 설치가 끝나면 링크를 만들어 고객에게 문자로 보내 주세요.'
    );
    expect(text(button())).toBe('링크 만들기');

    await load(
      fb({ exists: true, answered: false, expired: false, expires_at: '2026-11-20T14:59:00Z' })
    );
    await open(O1);
    expect(lead()).toBe(
      '링크를 보냈고 답을 기다리는 중입니다 (2026.11.20 까지). 새로 만들면 예전 링크는 더 열리지 않습니다.'
    );
    expect(text(button())).toBe('새 링크 만들기');

    await load(
      fb({ exists: true, answered: false, expired: true, expires_at: '2026-11-01T14:59:00Z' })
    );
    await open(O1);
    expect(lead()).toBe('보낸 링크의 기간이 지났습니다. 새 링크를 만들어 다시 보내 주세요.');
    expect(text(button())).toBe('새 링크 만들기');

    await load(
      fb({
        exists: true,
        answered: true,
        score: 9,
        comment: '깔끔해요',
        answered_at: '2026-11-09T02:00:00Z',
      })
    );
    await open(O1);
    expect(lead()).toBe('받은 답: 9점 · "깔끔해요" (2026.11.09)');
    expect(button()).toBeNull();
  });

  test('링크 만들기 — 만든 그때만 보이고, 어디에도 남기지 않는다 · 복사', async () => {
    const feedbackLink = jest.fn(() => ok({ url: 'https://dadam.example/f/abc' }));
    const calls = await load({ feedbackLink, ...fb({ exists: false }) });
    await open(O1);
    const url = () => part('feedback').querySelector('[data-od="feedback-url"]');
    expect(url()).toBeNull();
    const before = listReads(calls);
    await press(button());
    expect(feedbackLink).toHaveBeenCalledWith(WORK + '/orders/' + O1 + '/feedback-link');
    const post = sent(calls, 'POST').pop();
    expect([post.body, post.type]).toEqual([undefined, undefined]);
    expect(url().value).toBe('https://dadam.example/f/abc');
    expect(url().readOnly).toBe(true);
    expect(note()).toBe('링크를 만들었습니다. 복사해서 고객에게 문자로 보내 주세요.');
    expect(listReads(calls)).toBe(before);
    const kept = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(kept).not.toContain('dadam.example');

    // 복사가 막힌 곳 — 글을 골라 준다
    await press(part('feedback').querySelector('[data-act="feedback-copy"]'));
    expect(note()).toBe('링크를 골랐습니다. 길게 눌러(PC 는 Ctrl+C) 복사해 주세요.');
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    try {
      await press(part('feedback').querySelector('[data-act="feedback-copy"]'));
      expect(writeText).toHaveBeenCalledWith('https://dadam.example/f/abc');
      expect(note()).toBe('링크를 복사했습니다.');
    } finally {
      delete window.navigator.clipboard;
    }
  });

  test('서버가 막으면 그 글을 그 자리에', async () => {
    await load({
      feedbackLink: () => fail(409, 'conflict', '설치가 끝난 수주만 보낼 수 있습니다.'),
      ...fb({ exists: false }),
    });
    await open(O1);
    await press(button());
    expect(err()).toBe('설치가 끝난 수주만 보낼 수 있습니다.');
    expect(part('feedback').querySelector('[data-od="feedback-url"]')).toBeNull();
  });
});

describe('고객 정보', () => {
  test('localStorage · sessionStorage 에 고객 이름을 남기지 않는다', async () => {
    await load({ requests: () => ok({ items: [REQUEST] }) });
    await open(O1);
    const kept = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(kept).not.toContain('가람 고객');
    expect(kept).not.toContain('나래 주방');
  });
});
