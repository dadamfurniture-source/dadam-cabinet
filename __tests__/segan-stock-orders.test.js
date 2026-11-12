/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event, KeyboardEvent */
/**
 * SEGAN 「구매 · 재고 › 발주」 (segan/stock-orders.js + segan/me.html #stockOrders)
 *
 *   누가    다담 공장 구성원 · Expert · Agent 협력업체 구성원. 발주 적기 · 취소는 서버가 can_manage 라고 한 사람만,
 *           입고 · 발주서 인쇄는 구성원 누구나. 본사 · Manager · 업체 없는 사람은 묻지도 않는다
 *   데이터  workflow-api GET|POST /stock/orders · POST /stock/orders/:id/receive · /cancel · GET /stock/items(발주 적기를 열 때)
 *   화면    탭(진행 중 · 끝난 것) · 줄 · 그 자리 상세(품목 표 · 입고 · 취소 · 발주서 인쇄) · 발주 적기
 *   못 읽으면(DB 0062 적용 전 포함) 칸도 메뉴 줄도 없다
 *   품목 · 공급처 이름은 모두 지어낸 것이다
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
const NOW = Date.parse('2026-11-12T03:00:00Z'); // 한국 시간 2026-11-12

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const HQ = ok({ company: null, application: null, members: [], invites: [], hq_member: true });
const PLATFORM = ok({
  company: null,
  application: null,
  members: [],
  invites: [],
  platform_member: true,
});
const partnerOf = (plan, role = 'staff') =>
  ok({
    company: {
      id: CO,
      name: '다담 협력 주방',
      plan,
      next_plan: null,
      status: 'active',
      sido: '대구광역시',
      gugun: '북구',
      role,
      created_at: '2026-10-01T00:00:00Z',
    },
    application: null,
    members: [],
    invites: [],
  });

const mod = () => {
  delete window.SeganStockOrders;
  (0, eval)(read('segan/stock-orders.js'));
  return window.SeganStockOrders;
};

const SUP = { id: 'cp-7', name: '예시 마루철물' };
const line = (id, item_id, name, qty, patch = {}) => ({
  id,
  item_id,
  name,
  spec: '',
  unit: '개',
  qty,
  received_qty: null,
  ...patch,
});
const order = (n, patch = {}) => ({
  id: 'po-' + n,
  code: 'PO-' + String(n).padStart(4, '0'),
  state: 'ordered',
  supplier: SUP,
  expected_on: '2026-11-15',
  note: null,
  by: '예시 대표',
  created_at: '2026-11-10T01:00:00Z',
  closed_at: null,
  lines: [line('l-' + n, 's-1', '경첩', 100)],
  ...patch,
});
const ORDERS = () => [
  order(12, {
    note: '오전 배송',
    lines: [
      line('l-1', 's-1', '경첩', 200, { spec: '35 컵' }),
      line('l-2', 's-2', '레일', 20, { unit: '쌍' }),
    ],
  }),
  order(11, { expected_on: '2026-11-11', supplier: null }),
  order(10, {
    state: 'received',
    closed_at: '2026-11-06T01:00:00Z',
    lines: [line('l-4', 's-5', '다리발', 100, { received_qty: 96 })],
  }),
];
const STOCK = () => ({
  can_manage: true,
  suppliers: [SUP],
  items: [
    {
      id: 's-1',
      kind: 'hardware',
      name: '경첩',
      spec: '35 컵',
      unit: '개',
      qty: 40,
      safety_qty: 120,
      expected_qty: 50,
      active: true,
    },
    {
      id: 's-2',
      kind: 'hardware',
      name: '레일',
      spec: '',
      unit: '쌍',
      qty: 30,
      safety_qty: 20,
      expected_qty: null,
      active: true,
    },
    {
      id: 's-11',
      kind: 'board',
      name: 'PB 화이트',
      spec: '18T',
      unit: '장',
      qty: 3,
      safety_qty: 20,
      expected_qty: null,
      active: true,
    },
    {
      id: 's-9',
      kind: 'hardware',
      name: '숨긴 것',
      spec: '',
      unit: '개',
      qty: 0,
      safety_qty: 9,
      expected_qty: null,
      active: false,
    },
  ],
});

async function load(options = {}) {
  const store = { orders: options.orders || ORDERS() };
  const opts = { session: SESSION, partner: HQ, manage: true, gate: null, ...options };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/me.html#stock-orders');
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
    'SeganStock',
    'SeganStockMoves',
    'SeganStockOrders',
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
  const calls = { fetch: [], store, printed: 0, refreshed: [] };
  window.print = jest.fn(() => {
    calls.printed += 1;
  });
  window.SeganStock = { refresh: () => calls.refreshed.push('stock') };
  window.SeganStockMoves = { refresh: () => calls.refreshed.push('moves') };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async (name) =>
        name === 'is_admin' ? { data: false, error: null } : { data: [], error: null },
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
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const method = init.method || 'GET';
    calls.fetch.push({
      url,
      method,
      auth: (init.headers || {}).Authorization,
      cache: init.cache,
      body,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/stock/items') return reply(opts.stock ? opts.stock() : ok(STOCK()));
    if (url === WORK + '/stock/orders') {
      if (method === 'GET')
        return reply(
          opts.list
            ? opts.list()
            : ok({
                can_manage: opts.manage,
                company: { name: '예시 가나 팩토리' },
                items: store.orders,
              })
        );
      if (opts.gate) await opts.gate;
      if (opts.post) return reply(opts.post(body));
      const row = order(13, {
        expected_on: body.expected_on,
        note: body.note,
        lines: body.lines.map((l, i) => line('l-n' + i, l.item_id, '새 품목', l.qty)),
      });
      store.orders.unshift(row);
      return reply(ok(row, 201));
    }
    if (url.startsWith(WORK + '/stock/orders/')) {
      if (opts.gate) await opts.gate;
      const [id, act] = url.slice((WORK + '/stock/orders/').length).split('/');
      if (opts.close) return reply(opts.close(id, act, body));
      const row = store.orders.find((o) => o.id === id);
      row.state = act === 'cancel' ? 'cancelled' : 'received';
      row.closed_at = '2026-11-12T03:00:00Z';
      return reply(ok(row));
    }
    if (url === WORK + '/company/projects')
      return reply(ok({ company: { id: CO }, can_manage: false, items: [] }));
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
    'segan/stock-orders.js',
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

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const seen = (id) => !!$(id) && !$(id).hidden && !$(id).classList.contains('me-off');
const box = () => $('stockOrders');
const rows = () => [...box().querySelectorAll('li[data-po-row]')];
const row = (id) => box().querySelector(`li[data-po-row="${id}"]`);
const act = (name, extra = '') => box().querySelector(`[data-act="${name}"]${extra}`);
const err = () => text(box().querySelector('[data-po="err"]:not([hidden])'));
const msg = () =>
  text(box().querySelector('[data-po="msg"]') || box().querySelector('[data-po="topmsg"]'));
const tabs = () => [...box().querySelectorAll('[data-act="tab"]')].map(text);
const menu = (key) => document.querySelector(`#meHub li[data-me-item="${key}"]`);
const press = async (el) => {
  el.click();
  await flush();
};
const openRow = (id) => press(act('open', `[data-id="${id}"]`));
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/stock'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));
const last = (calls, method) =>
  calls.fetch.filter((c) => c.url.startsWith(WORK + '/stock') && c.method === method).pop();

afterEach(() => {
  jest.restoreAllMocks();
  document.querySelectorAll('body > .so-print').forEach((el) => el.remove());
  document.body.classList.remove('so-printing');
  delete window.SeganStock;
  delete window.SeganStockMoves;
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸 안, 근무 일정 다음 · 메뉴는 입출고 다음 · 처음엔 감춘다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('stockOrders');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('partner');
    expect(el.previousElementSibling.id).toBe('workShifts');
    expect(el.nextElementSibling.id).toBe('stockNeeds'); // 작업 자재 다음이 수주 (segan/stock-needs.js)
    const li = doc.querySelector('#meSubStock li[data-me-item="stock-orders"]');
    expect(li.previousElementSibling.getAttribute('data-me-item')).toBe('stock-moves');
    expect(li.hasAttribute('hidden')).toBe(true);
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((x) => x === name);
    expect(at('stock-orders.js')).toBeGreaterThanOrEqual(0);
    expect(at('stock-orders.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'stock-orders.js')");
  });

  test('기기에 남기지 않는다 · 확인 창 · 새 창을 띄우지 않는다 · 금액을 다루지 않는다', () => {
    const code = read('segan/stock-orders.js')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
    expect(code).not.toMatch(/window\.open|DELETE|<form\b/);
    expect(code).not.toMatch(/unit_price|amount|price/);
  });
});

describe('순수 함수', () => {
  test('orderOf — 번호 · 아는 상태 · 줄이 있어야 한다', () => {
    const S = mod();
    expect(S.orderOf(ORDERS()[0])).toEqual({
      id: 'po-12',
      code: 'PO-0012',
      state: 'ordered',
      supplier: '예시 마루철물',
      expectedOn: '2026-11-15',
      note: '오전 배송',
      by: '예시 대표',
      day: '2026-11-10',
      lines: [
        { id: 'l-1', itemId: 's-1', name: '경첩', spec: '35 컵', unit: '개', qty: 200, got: null },
        { id: 'l-2', itemId: 's-2', name: '레일', spec: '', unit: '쌍', qty: 20, got: null },
      ],
    });
    for (const bad of [
      null,
      order(1, { state: 'lost' }),
      order(1, { code: '' }),
      order(1, { lines: [] }),
      order(1, { lines: [line('x', 's', '가', 0)] }),
    ])
      expect(S.orderOf(bad)).toBeNull();
    expect(S.listOf({ items: 'x' })).toBeNull();
  });

  test('inTab · isLate — 받을 날이 지난 진행 중 발주만 늦음', () => {
    const S = mod();
    const [a, b, c] = ORDERS().map(S.orderOf);
    expect([S.inTab(a, 'open'), S.inTab(c, 'open'), S.inTab(c, 'closed')]).toEqual([
      true,
      false,
      true,
    ]);
    expect([
      S.isLate(a, '2026-11-12'),
      S.isLate(b, '2026-11-12'),
      S.isLate(c, '2026-11-12'),
    ]).toEqual([false, true, false]);
    expect(S.isLate(a, '2026-11-15')).toBe(false);
  });

  test('stockOf — 쓰는 품목만. 모자란 수량 = 안전 재고 − 남은 수량 − 입고 예정', () => {
    const S = mod();
    expect(S.stockOf(STOCK()).map((s) => [s.id, s.kind, s.need])).toEqual([
      ['s-1', 'hardware', 30],
      ['s-2', 'hardware', 0],
      ['s-11', 'board', 17],
    ]);
    expect(S.stockOf({})).toBeNull();
  });

  test('orderBody — 받을 날 · 품목 한 줄 이상. 빈 줄은 버리고, 같은 품목 두 번 · 틀린 수량은 막는다', () => {
    const S = mod();
    const f = {
      supplier: 'cp-7',
      expectedOn: '2026-11-20',
      note: ' 월말 ',
      lines: [
        { item: 's-1', qty: '50' },
        { item: '', qty: '' },
      ],
    };
    expect(S.orderBody(f)).toEqual({
      body: {
        supplier_id: 'cp-7',
        expected_on: '2026-11-20',
        note: '월말',
        lines: [{ item_id: 's-1', qty: 50 }],
      },
    });
    expect(S.orderBody({ ...f, expectedOn: '' })).toEqual({
      error: S.TEXT.needDay,
      focus: 'expectedOn',
    });
    expect(S.orderBody({ ...f, lines: [{ item: '', qty: '' }] }).error).toBe(S.TEXT.needLine);
    expect(S.orderBody({ ...f, lines: [{ item: '', qty: '3' }] })).toEqual({
      error: S.TEXT.needLine,
      focus: 'item-0',
    });
    expect(S.orderBody({ ...f, lines: [{ item: 's-1', qty: '0' }] })).toEqual({
      error: S.TEXT.needQty,
      focus: 'qty-0',
    });
    expect(
      S.orderBody({
        ...f,
        lines: [
          { item: 's-1', qty: '1' },
          { item: 's-1', qty: '2' },
        ],
      })
    ).toEqual({ error: S.TEXT.dupLine, focus: 'item-1' });
  });

  test('receiveBody — 발주 수량과 다른 줄만 보낸다. 그대로면 빈 몸', () => {
    const S = mod();
    const o = S.orderOf(ORDERS()[0]);
    expect(S.receiveBody(o, {})).toEqual({ body: {} });
    expect(S.receiveBody(o, { 'l-1': '200', 'l-2': '15' })).toEqual({
      body: { qtys: { 'l-2': 15 } },
    });
    expect(S.receiveBody(o, { 'l-1': '0' })).toEqual({ body: { qtys: { 'l-1': 0 } } });
    expect(S.receiveBody(o, { 'l-2': '-1' })).toEqual({ error: S.TEXT.needQty, focus: 'l-2' });
  });
});

describe('화면', () => {
  test('한 번 읽어 그린다 — 탭에 수, 줄에 번호 · 공급처 · 품목 · 받을 날 · 상태. 받을 날이 지나면 표시', async () => {
    const calls = await load();
    expect(asked(calls)).toEqual(['GET /stock/orders']);
    expect(seen('stockOrders')).toBe(true);
    expect($('meTitle').textContent).toBe('발주');
    expect($('partner').getAttribute('aria-labelledby')).toBe('stockOrdersTitle');
    expect(tabs()).toEqual(['진행 중 2', '끝난 것 1']);
    expect(rows().map((li) => text(li.querySelector('.ad-pick')))).toEqual([
      'PO-0012 · 예시 마루철물경첩 외 1종 · 받을 날 11.15발주함',
      'PO-0011 · 공급처 없음경첩 · 받을 날 11.11발주함받을 날 지남',
    ]);
    expect(act('add')).not.toBeNull();
    expect(menu('stock-orders').hidden).toBe(false);
  });

  test('줄을 누르면 — 품목 표와 단추. 끝난 발주에는 들어온 수량이 보이고 인쇄만 남는다', async () => {
    await load();
    await openRow('po-12');
    expect(
      [...row('po-12').querySelectorAll('tbody tr')].map((tr) => [...tr.children].map(text))
    ).toEqual([
      ['경첩35 컵', '200개'],
      ['레일', '20쌍'],
    ]);
    expect(text(row('po-12').querySelector('.me-facts'))).toBe(
      '발주일11.10받을 날11.15적은 사람예시 대표메모오전 배송'
    );
    expect([...row('po-12').querySelectorAll('.so-acts button')].map(text)).toEqual([
      '입고',
      '발주서 인쇄',
      '발주 취소',
    ]);
    await press(act('tab', '[data-tab="closed"]'));
    await openRow('po-10');
    expect(
      [...row('po-10').querySelectorAll('tbody tr')].map((tr) => [...tr.children].map(text))
    ).toEqual([['다리발', '100개', '96개']]);
    expect([...row('po-10').querySelectorAll('.so-acts button')].map(text)).toEqual([
      '발주서 인쇄',
    ]);
  });

  test('글자 그대로 그린다', async () => {
    await load({
      orders: [
        order(1, {
          note: '<b>x</b>',
          supplier: { id: 's', name: '<img src=x>' },
          lines: [line('l', 's', '<i>가</i>', 1)],
        }),
      ],
    });
    await openRow('po-1');
    expect(box().querySelector('img, .me-facts b, th i')).toBeNull();
  });
});

describe('입고 · 취소', () => {
  test('입고 — 줄마다 발주 수량이 채워져 있고, 고친 줄만 보낸다. 재고 화면들에 다시 읽으라고 알린다', async () => {
    const calls = await load();
    await openRow('po-12');
    await press(act('receive'));
    const got = (id) => row('po-12').querySelector(`[data-got="${id}"]`);
    expect([got('l-1').value, got('l-2').value]).toEqual(['200', '20']);
    expect(got('l-2').getAttribute('aria-label')).toBe('레일 들어온 수량');
    got('l-2').value = '15';
    await press(act('save-receive'));
    expect(last(calls, 'POST')).toMatchObject({
      url: WORK + '/stock/orders/po-12/receive',
      body: { qtys: { 'l-2': 15 } },
      auth: 'Bearer tok-1',
    });
    expect(msg()).toBe('입고했습니다. 재고에 넣었습니다.');
    expect(tabs()).toEqual(['진행 중 1', '끝난 것 2']);
    expect(calls.refreshed).toEqual(['stock', 'moves']);
  });

  test('입고 — 그대로면 빈 몸 (Enter 로도) · 틀린 수량은 보내지 않는다', async () => {
    const calls = await load();
    await openRow('po-11');
    await press(act('receive'));
    const el = row('po-11').querySelector('[data-got]');
    el.value = 'x';
    await press(act('save-receive'));
    expect(err()).toBe('수량을 0 보다 큰 숫자로 적어 주세요.');
    expect(last(calls, 'POST')).toBeUndefined();
    row('po-11').querySelector('[data-got]').value = '100';
    row('po-11')
      .querySelector('[data-got]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(last(calls, 'POST').body).toEqual({});
  });

  test('취소 — 그 자리에서 한 번 되묻고, 「그만두기」면 보내지 않는다', async () => {
    const calls = await load();
    await openRow('po-12');
    await press(act('ask-cancel'));
    expect(text(box().querySelector('.so-ask'))).toBe('이 발주를 취소합니다. 되돌릴 수 없습니다.');
    await press(act('stop'));
    expect(last(calls, 'POST')).toBeUndefined();
    await press(act('ask-cancel'));
    await press(act('confirm-cancel'));
    expect(last(calls, 'POST').url).toBe(WORK + '/stock/orders/po-12/cancel');
    expect(msg()).toBe('발주를 취소했습니다.');
  });

  test('서버가 막으면 서버 글을 적는다 · 보내는 동안 잠그고 한 번만 보낸다', async () => {
    await load({ close: () => fail(409, 'closed', '이미 입고했거나 취소한 발주입니다') });
    await openRow('po-12');
    await press(act('receive'));
    await press(act('save-receive'));
    expect(err()).toBe('이미 입고했거나 취소한 발주입니다');

    let open;
    const gate = new Promise((r) => (open = r));
    const calls = await load({ gate });
    await openRow('po-12');
    await press(act('receive'));
    act('save-receive').click();
    await flush();
    expect(box().getAttribute('aria-busy')).toBe('true');
    act('save-receive').click();
    open();
    await flush();
    expect(calls.fetch.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

describe('발주 적기 (대표 · 실장)', () => {
  test('열 때 품목 · 공급처를 읽는다. 품목은 종류로 묶이고 숨긴 것은 없다', async () => {
    const calls = await load();
    await press(act('add'));
    expect(asked(calls).pop()).toBe('GET /stock/items');
    const sel = box().querySelector('[data-l="item"]');
    expect(
      [...sel.querySelectorAll('optgroup')].map((g) => [
        g.label,
        [...g.children].map((o) => o.textContent),
      ])
    ).toEqual([
      ['기본 자재', ['PB 화이트 · 18T (장)']],
      ['철물', ['경첩 · 35 컵 (개)', '레일 (쌍)']],
    ]);
    expect(
      [...box().querySelector('[data-f="supplier"]').options].map((o) => o.textContent)
    ).toEqual(['고르지 않음', '예시 마루철물']);
  });

  test('「부족한 품목 채우기」 — 모자란 만큼 줄을 넣는다. 「발주 넣기」로 보낸다', async () => {
    const calls = await load();
    await press(act('add'));
    await press(act('save-add'));
    expect(err()).toBe('받을 날을 골라 주세요.');
    box().querySelector('[data-f="expectedOn"]').value = '2026-11-25';
    await press(act('fill-short'));
    expect(
      [...box().querySelectorAll('.po-line')].map((li) => [
        li.querySelector('[data-l="item"]').value,
        li.querySelector('[data-l="qty"]').value,
      ])
    ).toEqual([
      ['s-1', '30'],
      ['s-11', '17'],
    ]);
    box().querySelector('[data-f="supplier"]').value = 'cp-7';
    box().querySelector('[data-f="note"]').value = '월말';
    await press(act('save-add'));
    expect(last(calls, 'POST')).toMatchObject({
      url: WORK + '/stock/orders',
      body: {
        supplier_id: 'cp-7',
        expected_on: '2026-11-25',
        note: '월말',
        lines: [
          { item_id: 's-1', qty: 30 },
          { item_id: 's-11', qty: 17 },
        ],
      },
    });
    expect(msg()).toBe('발주를 넣었습니다. PO-0013');
    expect(box().querySelector('[data-po="form"]')).toBeNull();
    expect(calls.refreshed).toEqual(['stock', 'moves']);
  });

  test('품목 더하기 · 빼기 — 적던 글은 남는다. 서버가 막으면 서버 글을 적고 칸은 그대로', async () => {
    const calls = await load({ post: () => fail(422, 'x', '품목을 다시 골라 주세요') });
    await press(act('add'));
    box().querySelector('[data-f="expectedOn"]').value = '2026-11-25';
    box().querySelector('[data-l="item"]').value = 's-2';
    box().querySelector('[data-l="qty"]').value = '7';
    await press(act('line-add'));
    expect(box().querySelectorAll('.po-line')).toHaveLength(2);
    expect(box().querySelector('[data-l="qty"]').value).toBe('7');
    await press(act('line-del', '[data-i="1"]'));
    expect(box().querySelectorAll('.po-line')).toHaveLength(1);
    await press(act('save-add'));
    expect(err()).toBe('품목을 다시 골라 주세요');
    expect(box().querySelector('[data-l="qty"]').value).toBe('7');
    expect(calls.refreshed).toEqual([]);
  });

  test('품목이 하나도 없으면 — 먼저 품목을 더하라고 알린다', async () => {
    await load({ stock: () => ok({ can_manage: true, suppliers: [], items: [] }) });
    await press(act('add'));
    expect(err()).toBe('발주할 품목이 없습니다. 먼저 기본 자재 · 철물에 품목을 더해 주세요.');
    expect(box().querySelector('[data-po="form"]')).toBeNull();
  });
});

describe('발주서 인쇄', () => {
  test('문서 안 인쇄 칸에 번호 · 날짜 · 받는 곳 · 보내는 곳 · 품목 표 · 메모를 그리고 인쇄 창을 연다. 금액은 없다', async () => {
    const calls = await load();
    await openRow('po-12');
    await press(act('print'));
    expect(calls.printed).toBe(1);
    const doc = $('stockOrderPrint');
    expect(doc.parentNode).toBe(document.body);
    expect(doc.className).toBe('so-print po-doc');
    expect([...doc.querySelectorAll('.po-doc-facts > div')].map(text)).toEqual([
      '번호PO-0012',
      '발주일2026-11-10',
      '받을 날2026-11-15',
      '받는 곳예시 마루철물',
      '보내는 곳예시 가나 팩토리',
    ]);
    expect([...doc.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map(text))).toEqual([
      ['1', '경첩', '35 컵', '200', '개'],
      ['2', '레일', '', '20', '쌍'],
    ]);
    expect(text(doc.querySelector('.po-doc-note'))).toBe('오전 배송');
    expect(text(doc)).not.toMatch(/원|금액|단가/);
    expect(document.body.classList.contains('so-printing')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('so-printing')).toBe(false);
    expect(read('segan/shell.css')).toMatch(
      /body\.so-printing \.so-print\.po-doc\s*\{\s*display:\s*block;/
    );
  });
});

describe('직원 · 안 보이는 때', () => {
  test('직원(can_manage 아님) — 입고 · 인쇄만. 발주 적기 · 취소 단추가 없다', async () => {
    await load({ partner: partnerOf('expert', 'staff'), manage: false });
    expect(seen('stockOrders')).toBe(true);
    expect(act('add')).toBeNull();
    await openRow('po-12');
    expect([...row('po-12').querySelectorAll('.so-acts button')].map(text)).toEqual([
      '입고',
      '발주서 인쇄',
    ]);
  });

  test('못 읽으면(DB 0062 적용 전 · 오류 · 끊김) — 칸도 메뉴 줄도 없다. 본사 · Manager 는 묻지 않는다', async () => {
    for (const list of [
      () => fail(409, 'db_pending', 'x'),
      () => fail(500, 'x', 'x'),
      () => new Error('offline'),
      () => ok({ items: null }),
    ]) {
      await load({ partner: partnerOf('agent', 'owner'), list });
      expect(seen('stockOrders')).toBe(false);
      expect(box().innerHTML).toBe('');
      expect(menu('stock-orders').hidden).toBe(true);
    }
    for (const partner of [PLATFORM, partnerOf('manager', 'owner')]) {
      const calls = await load({ partner });
      expect(asked(calls)).toEqual([]);
    }
  });
});
