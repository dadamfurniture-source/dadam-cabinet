/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event, KeyboardEvent */
/**
 * SEGAN 「구매 · 재고 › 작업 자재」 (segan/stock-needs.js + segan/me.html #stockNeeds)
 *
 *   누가    다담 공장 구성원 · Expert · Agent 협력업체 구성원. 출고 · 자투리 후보 등록은 누구나,
 *           짝 정하기는 서버가 can_manage 라고 한 사람만. 본사 · Manager 는 묻지도 않는다
 *   데이터  workflow-api GET /stock/needs · PUT /stock/links · POST /stock/needs/:id/issue · GET /stock/needs/:id/offcuts
 *           + GET /stock/items(짝표를 열 때) · POST /stock/offcuts(후보 등록)
 *   화면    수주별(탭 · 자재 표 · 출고 · 남는 조각) · 짝표
 *   못 읽으면(DB 0063 적용 전 포함) 칸도 메뉴 줄도 없다
 *   수주 · 자재 이름은 모두 지어낸 것이다
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
const NOW = Date.parse('2026-11-12T03:00:00Z');

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
  delete window.SeganStockNeeds;
  (0, eval)(read('segan/stock-needs.js'));
  return window.SeganStockNeeds;
};

const PB = { id: 's-11', name: 'PB 18T', spec: '', unit: '장', qty: 10 };
const HINGE = { id: 's-1', name: '경첩 105도', spec: '35 컵', unit: '개', qty: 40 };
const ln = (key, label, need, unit, state, item = null) => ({
  key,
  kind: key[0] === 'B' ? 'board' : 'hardware',
  label,
  need,
  unit,
  state,
  item,
});
const DATA = () => ({
  can_manage: true,
  counts: {},
  orders: [
    {
      id: 'o-1',
      order_no: 'W-2611-014',
      name: '예시 싱크대',
      status: 'in_production',
      due: '2026-11-16T01:00:00Z',
      issued: false,
      has_doc: true,
      has_plan: true,
      state: 'unlinked',
      lines: [
        ln('B|PB|18', 'PB 18T', 6, '장', 'ok', PB),
        ln('B|MDF|18', 'MDF 18T', 1, '장', 'unlinked'),
        ln('H|경첩|A', '경첩 · A', 24, '개', 'ok', HINGE),
        ln('H|경첩|B', '경첩 · B', 4, '개', 'ok', HINGE),
        ln('H|기타|실리콘', '기타 · 실리콘', 2, '개', 'ignored'),
      ],
    },
    {
      id: 'o-2',
      order_no: 'W-2611-015',
      name: '예시 붙박이장',
      status: 'confirmed',
      due: null,
      issued: false,
      has_doc: true,
      has_plan: false,
      state: 'short',
      lines: [ln('H|경첩|A', '경첩 · A', 30, '개', 'short', HINGE)],
    },
    {
      id: 'o-3',
      order_no: 'W-2611-016',
      name: '',
      status: 'confirmed',
      due: null,
      issued: false,
      has_doc: false,
      has_plan: false,
      state: 'nodoc',
      lines: [],
    },
    {
      id: 'o-4',
      order_no: 'W-2611-010',
      name: '예시 신발장',
      status: 'in_production',
      due: null,
      issued: true,
      has_doc: true,
      has_plan: true,
      state: 'issued',
      lines: [ln('B|PB|18', 'PB 18T', 2, '장', 'ok', PB)],
    },
  ],
  materials: [
    {
      key: 'B|MDF|18',
      kind: 'board',
      label: 'MDF 18T',
      unit: '장',
      need: 1,
      orders: 1,
      ignored: false,
      item: null,
    },
    {
      key: 'B|PB|18',
      kind: 'board',
      label: 'PB 18T',
      unit: '장',
      need: 6,
      orders: 2,
      ignored: false,
      item: { id: 's-11', name: 'PB 18T', spec: '', unit: '장' },
    },
    {
      key: 'H|기타|실리콘',
      kind: 'hardware',
      label: '기타 · 실리콘',
      unit: '개',
      need: 2,
      orders: 1,
      ignored: true,
      item: null,
    },
  ],
});
const STOCK = () => ({
  can_manage: true,
  items: [
    { id: 's-11', kind: 'board', name: 'PB 18T', spec: '', unit: '장', active: true },
    { id: 's-14', kind: 'board', name: 'MDF', spec: '18T', unit: '장', active: true },
    { id: 's-1', kind: 'hardware', name: '경첩 105도', spec: '35 컵', unit: '개', active: true },
    { id: 's-9', kind: 'board', name: '숨긴 판재', spec: '', unit: '장', active: false },
  ],
});
const CANDS = () => [
  { material: 'PB', thickness_mm: 18, width_mm: 1220, height_mm: 640, sheet_no: 3 },
  { material: 'PB', thickness_mm: 15, width_mm: 800, height_mm: 420, sheet_no: 7 },
];

async function load(options = {}) {
  const opts = { session: SESSION, partner: HQ, manage: true, gate: null, ...options };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/me.html' + (opts.hash || '#stock-needs'));
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
    'SeganStockOffcuts',
    'SeganStockNeeds',
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
  const calls = { fetch: [], refreshed: [], reads: 0 };
  window.SeganStock = { refresh: () => calls.refreshed.push('stock') };
  window.SeganStockOffcuts = { refresh: () => calls.refreshed.push('offcuts') };
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
    if (url === WORK + '/stock/needs') {
      calls.reads += 1;
      return reply(
        opts.needs ? opts.needs(calls.reads) : ok({ ...DATA(), can_manage: opts.manage })
      );
    }
    if (url === WORK + '/stock/items') return reply(opts.stock ? opts.stock() : ok(STOCK()));
    if (url === WORK + '/stock/links')
      return reply(opts.link ? opts.link(body) : ok({ key: body.key }));
    if (url === WORK + '/stock/offcuts')
      return reply(opts.offcut ? opts.offcut(body) : ok({ id: 'c-1', code: 'S-0001' }, 201));
    if (url.startsWith(WORK + '/stock/needs/')) {
      const [id, act] = url.slice((WORK + '/stock/needs/').length).split('/');
      if (act === 'offcuts')
        return reply(opts.cands ? opts.cands(id) : ok({ order_no: 'W', items: CANDS() }));
      if (opts.gate) await opts.gate;
      return reply(
        opts.issue ? opts.issue(id, body) : ok({ order_id: id, lines: body.lines.length }, 201)
      );
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
    'segan/stock-needs.js',
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
const box = () => $('stockNeeds');
const row = (id) => box().querySelector(`li[data-sn2-row="${id}"]`);
const act = (name, extra = '') => box().querySelector(`[data-act="${name}"]${extra}`);
const err = () => text(box().querySelector('[data-sn2="err"]:not([hidden])'));
const msg = () =>
  text(box().querySelector('[data-sn2="msg"]') || box().querySelector('[data-sn2="topmsg"]'));
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
  delete window.SeganStock;
  delete window.SeganStockOffcuts;
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸 안, 발주 다음 · 메뉴도 발주 다음 · 처음엔 감춘다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('stockNeeds');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('partner');
    expect(el.previousElementSibling.id).toBe('stockOrders');
    expect(el.nextElementSibling.id).toBe('orders');
    const li = doc.querySelector('#meSubStock li[data-me-item="stock-needs"]');
    expect(li.previousElementSibling.getAttribute('data-me-item')).toBe('stock-orders');
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((x) => x === name);
    expect(at('stock-needs.js')).toBeGreaterThanOrEqual(0);
    expect(at('stock-needs.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'stock-needs.js')");
  });

  test('기기에 남기지 않는다 · 확인 창을 띄우지 않는다 · 금액 · 고객을 다루지 않는다', () => {
    const code = read('segan/stock-needs.js')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
    expect(code).not.toMatch(/window\.open|DELETE|<form\b/);
    expect(code).not.toMatch(/customer|amount|price/);
  });
});

describe('순수 함수', () => {
  test('orderOf · lineOf — 번호 · 아는 상태가 있어야 한다. 납기는 한국 날짜', () => {
    const S = mod();
    const o = S.orderOf(DATA().orders[0]);
    expect([o.no, o.name, o.due, o.state, o.hasDoc, o.hasPlan, o.lines.length]).toEqual([
      'W-2611-014',
      '예시 싱크대',
      '11.16',
      'unlinked',
      true,
      true,
      5,
    ]);
    expect(S.orderOf({ ...DATA().orders[0], state: 'lost' })).toBeNull();
    expect(S.orderOf({ ...DATA().orders[0], order_no: ' ' })).toBeNull();
    expect(S.lineOf({ key: 'B|PB|18', state: 'gone', need: 1 })).toBeNull();
    expect(S.lineOf({ key: 'B|PB|18', state: 'ok', need: 'x' })).toBeNull();
    expect(S.dataOf({ orders: [], materials: 'x' })).toBeNull();
  });

  test('issueRows — 짝지은 자재만, 같은 품목은 더한다. issueBody — 0 인 줄은 빼고, 모두 0 이면 막는다', () => {
    const S = mod();
    const rows = S.issueRows(S.orderOf(DATA().orders[0]));
    expect(rows).toEqual([
      { itemId: 's-11', label: 'PB 18T', unit: '장', need: 6, have: 10 },
      { itemId: 's-1', label: '경첩 105도 · 35 컵', unit: '개', need: 28, have: 40 },
    ]);
    expect(S.issueBody(rows, {})).toEqual({
      body: {
        lines: [
          { item_id: 's-11', qty: 6 },
          { item_id: 's-1', qty: 28 },
        ],
      },
    });
    expect(S.issueBody(rows, { 's-11': '0', 's-1': '20' })).toEqual({
      body: { lines: [{ item_id: 's-1', qty: 20 }] },
    });
    expect(S.issueBody(rows, { 's-11': '', 's-1': '0' })).toEqual({
      error: S.TEXT.needOne,
      focus: 's-11',
    });
    expect(S.issueBody(rows, { 's-1': '-1' })).toEqual({ error: S.TEXT.needQty, focus: 's-1' });
    expect(S.issueBody(rows, { 's-1': 'x' })).toEqual({ error: S.TEXT.needQty, focus: 's-1' });
  });
});

describe('수주별', () => {
  test('한 번 읽어 그린다 — 탭에 수, 줄에 번호 · 설계 이름 · 납기 · 상태', async () => {
    const calls = await load();
    expect(asked(calls)).toEqual(['GET /stock/needs']);
    expect(seen('stockNeeds')).toBe(true);
    expect($('meTitle').textContent).toBe('작업 자재');
    expect(tabs()).toEqual([
      '전체 4',
      '없음 1',
      '짝 없음 1',
      '입고 예정 0',
      '재고 있음 0',
      '출고함 1',
    ]);
    expect([...box().querySelectorAll('li[data-sn2-row] .ad-pick')].map(text)).toEqual([
      'W-2611-014 · 예시 싱크대제작 중 · 납기 11.16짝 없음',
      'W-2611-015 · 예시 붙박이장계약 확정 · 납기 없음없음',
      'W-2611-016계약 확정 · 납기 없음작업지시서 없음',
      'W-2611-010 · 예시 신발장제작 중 · 납기 없음출고함',
    ]);
    expect(menu('stock-needs').hidden).toBe(false);
    await press(act('tab', '[data-tab="short"]'));
    expect(box().querySelectorAll('li[data-sn2-row]')).toHaveLength(1);
  });

  test('줄을 누르면 자재 표 — 필요한 양 · 재고 품목(남은 수량) · 상태. 단추는 상태에 맞게', async () => {
    await load();
    await openRow('o-1');
    expect(
      [...row('o-1').querySelectorAll('tr[data-sn2-line]')].map((tr) => [...tr.children].map(text))
    ).toEqual([
      ['PB 18T', '6장', 'PB 18T (10장)', '재고 있음'],
      ['MDF 18T', '1장', '—', '짝 없음'],
      ['경첩 · A', '24개', '경첩 105도 · 35 컵 (40개)', '재고 있음'],
      ['경첩 · B', '4개', '경첩 105도 · 35 컵 (40개)', '재고 있음'],
      ['기타 · 실리콘', '2개', '—', '다루지 않음'],
    ]);
    expect([...row('o-1').querySelectorAll('.so-acts > *')].map(text)).toEqual([
      '이 작업 자재 출고',
      '남는 조각 보기',
      '짝표로',
    ]);
    await openRow('o-2');
    expect(text(row('o-2').querySelector('.mk-note'))).toBe(
      '재단 배치가 없어 판재 장수는 나오지 않습니다. 철물만 보입니다.'
    );
    expect([...row('o-2').querySelectorAll('.so-acts > *')].map(text)).toEqual([
      '이 작업 자재 출고',
      '발주 적기로',
    ]);
    expect(row('o-2').querySelector('.so-acts a').getAttribute('href')).toBe('#stock-orders');
    await openRow('o-3');
    expect(text(row('o-3').querySelector('.mk-note'))).toContain('아직 작업지시서가 없습니다');
    expect(row('o-3').querySelector('.so-acts')).toBeNull();
    await openRow('o-4');
    expect([...row('o-4').querySelectorAll('.so-acts > *')].map(text)).toEqual(['남는 조각 보기']);
    expect(text(row('o-4').querySelector('tr[data-sn2-line] td:last-child'))).toBe('출고함');
  });

  test('출고 — 필요한 양이 채워져 나오고, 고친 수량을 보낸다. 재고 화면들에 다시 읽으라고 알린다', async () => {
    const calls = await load();
    await openRow('o-1');
    await press(act('issue'));
    const q = (id) => box().querySelector(`[data-q="${id}"]`);
    expect([q('s-11').value, q('s-1').value]).toEqual(['6', '28']);
    q('s-1').value = '26';
    await press(act('save-issue'));
    expect(last(calls, 'POST')).toMatchObject({
      url: WORK + '/stock/needs/o-1/issue',
      auth: 'Bearer tok-1',
      body: {
        lines: [
          { item_id: 's-11', qty: 6 },
          { item_id: 's-1', qty: 26 },
        ],
      },
    });
    expect(asked(calls).pop()).toBe('GET /stock/needs');
    expect(msg()).toBe('출고했습니다. 재고에서 뺐습니다.');
    expect(calls.refreshed).toEqual(['stock', 'offcuts']);
  });

  test('출고 — 서버가 막으면(모자람 · 이미 출고) 서버 글을 적고 적던 수량은 남는다 · Enter 로도 · 한 번만 보낸다', async () => {
    await load({ issue: () => fail(422, 'x', '재고가 모자란 품목이 있습니다') });
    await openRow('o-1');
    await press(act('issue'));
    box().querySelector('[data-q="s-1"]').value = '999';
    box()
      .querySelector('[data-q="s-1"]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(err()).toBe('재고가 모자란 품목이 있습니다');
    expect(box().querySelector('[data-q="s-1"]').value).toBe('999');

    let open;
    const gate = new Promise((r) => (open = r));
    const calls = await load({ gate });
    await openRow('o-1');
    await press(act('issue'));
    act('save-issue').click();
    await flush();
    expect(box().getAttribute('aria-busy')).toBe('true');
    act('save-issue').click();
    open();
    await flush();
    expect(calls.fetch.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  test('짝지은 자재가 없으면 출고할 것이 없다고 알린다', async () => {
    await load({
      needs: () =>
        ok({
          ...DATA(),
          orders: [
            { ...DATA().orders[0], lines: [ln('B|MDF|18', 'MDF 18T', 1, '장', 'unlinked')] },
          ],
        }),
    });
    await openRow('o-1');
    await press(act('issue'));
    expect(text(row('o-1'))).toContain('짝지은 자재가 없어 출고할 것이 없습니다');
    expect(act('save-issue')).toBeNull();
  });

  test('남는 조각 — 후보를 읽어 보여 주고, 「등록」을 누른 것만 자투리에 넣는다 (메모에 수주 번호)', async () => {
    const calls = await load();
    await openRow('o-1');
    await press(act('offcuts'));
    expect(asked(calls).pop()).toBe('GET /stock/needs/o-1/offcuts');
    expect(
      [...box().querySelectorAll('[data-sn2="cands"] .po-line')].map((li) =>
        text(li.querySelector('.sn2-name'))
      )
    ).toEqual(['1,220 × 640 mmPB · 18T · 원판 3', '800 × 420 mmPB · 15T · 원판 7']);
    await press(act('register', '[data-i="1"]'));
    expect(last(calls, 'POST')).toMatchObject({
      url: WORK + '/stock/offcuts',
      body: {
        material: 'PB',
        thickness_mm: 15,
        width_mm: 800,
        height_mm: 420,
        memo: 'W-2611-014 재단에서 남음',
      },
    });
    expect(box().querySelectorAll('[data-act="register"]')).toHaveLength(1);
    expect(text(box().querySelectorAll('[data-sn2="cands"] .po-line')[1])).toContain('등록함');
    expect(calls.refreshed).toEqual(['stock', 'offcuts']);
    await load({ cands: () => ok({ items: [] }) });
    await openRow('o-1');
    await press(act('offcuts'));
    expect(text(box().querySelector('[data-sn2="cands"]'))).toContain('남는 조각이 없습니다');
  });
});

describe('짝표', () => {
  test('열 때 품목을 읽는다. 자재마다 같은 종류의 쓰는 품목만 고른다. 짝 없는 자재 수가 단추에 보인다', async () => {
    const calls = await load();
    expect(text(act('view', '[data-view="links"]'))).toBe('짝표 짝 없음 1');
    await press(act('view', '[data-view="links"]'));
    expect(asked(calls).pop()).toBe('GET /stock/items');
    expect(
      [...box().querySelectorAll('tr[data-sn2-mat]')].map((tr) => [
        text(tr.children[0]),
        text(tr.children[1]),
        tr.querySelector('select').value,
      ])
    ).toEqual([
      ['MDF 18T 짝 없음판재', '1장 · 1건', ''],
      ['PB 18T판재', '6장 · 2건', 's-11'],
      ['기타 · 실리콘철물', '2개 · 1건', '-'],
    ]);
    expect(
      [...box().querySelector('[data-link="B|MDF|18"]').options].map((o) => o.textContent)
    ).toEqual(['짝 없음', '재고에서 다루지 않음', 'PB 18T (장)', 'MDF · 18T (장)']);
    expect(
      [...box().querySelector('[data-link="H|기타|실리콘"]').options].map((o) => o.textContent)
    ).toEqual(['짝 없음', '재고에서 다루지 않음', '경첩 105도 · 35 컵 (개)']);
  });

  test('고르면 바로 보낸다 — 품목 · 다루지 않음 · 짝 풀기. 다시 읽는다', async () => {
    const calls = await load();
    await press(act('view', '[data-view="links"]'));
    const pick = async (key, value) => {
      const el = box().querySelector(`[data-link="${key}"]`);
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    };
    await pick('B|MDF|18', 's-14');
    expect(last(calls, 'PUT')).toMatchObject({
      url: WORK + '/stock/links',
      body: { key: 'B|MDF|18', label: 'MDF 18T', item_id: 's-14' },
    });
    expect(asked(calls).pop()).toBe('GET /stock/needs');
    expect(msg()).toBe('짝을 정했습니다.');
    await pick('B|MDF|18', '-');
    expect(last(calls, 'PUT').body).toEqual({ key: 'B|MDF|18', label: 'MDF 18T', ignored: true });
    await pick('B|PB|18', '');
    expect(last(calls, 'PUT').body).toEqual({ key: 'B|PB|18', label: 'PB 18T' });
    expect(msg()).toBe('짝을 풀었습니다.');
  });

  test('직원(can_manage 아님) — 짝은 글자로만 보이고 품목을 읽지도 않는다. 출고 단추는 있다', async () => {
    const calls = await load({ partner: partnerOf('expert', 'staff'), manage: false });
    await press(act('view', '[data-view="links"]'));
    expect(asked(calls)).toEqual(['GET /stock/needs']);
    expect(box().querySelector('select')).toBeNull();
    expect(
      [...box().querySelectorAll('tr[data-sn2-mat]')].map((tr) => text(tr.children[2]))
    ).toEqual(['짝 없음', 'PB 18T', '재고에서 다루지 않음']);
    expect(text(box())).toContain('짝은 대표 · 실장이 정합니다.');
    await press(act('view', '[data-view="orders"]'));
    await openRow('o-1');
    expect(act('issue')).not.toBeNull();
  });
});

describe('구매 · 재고 대시보드 — 진행 중 작업 자재', () => {
  const dash = () => $('meStockNeedsNumbers');
  const cells = () =>
    [...dash().querySelectorAll('[data-snd]')].map(
      (d) => d.getAttribute('data-snd') + ' ' + text(d)
    );

  test('me.html — 대시보드 안, 재고 한눈에 다음 · 처음엔 감춘다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('meStockNeedsNumbers');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('meDash');
    expect(el.previousElementSibling.id).toBe('meStockNumbers');
    expect(el.getAttribute('aria-labelledby')).toBe('meStockNeedsNumbersTitle');
  });

  test('구매 · 재고 대시보드에서만 — 상태별 수주 수. 살필 칸은 굵은 선, 더 읽지 않는다', async () => {
    const calls = await load({ hash: '#dash-stock' });
    expect(asked(calls)).toEqual(['GET /stock/needs']);
    expect(seen('meStockNeedsNumbers')).toBe(true);
    expect(text($('meStockNeedsNumbersTitle'))).toBe('진행 중 작업 자재');
    expect(cells()).toEqual([
      'short 없음1건',
      'unlinked 짝 없음1건',
      'expected 입고 예정0건',
      'ok 재고 있음0건',
      'issued 출고함1건',
      'nodoc 작업지시서 없음1건',
    ]);
    expect([...dash().querySelectorAll('.sn-warn')].map((d) => d.getAttribute('data-snd'))).toEqual(
      ['short', 'unlinked']
    );
    expect(dash().textContent).not.toMatch(/원|고객/);
  });

  test('칸을 누르면 그 상태 탭으로 작업 자재 화면이 열린다', async () => {
    await load({ hash: '#dash-stock' });
    await press(dash().querySelector('[data-snd="short"] a'));
    expect(window.location.hash).toBe('#stock-needs');
    expect(seen('stockNeeds')).toBe(true);
    expect(seen('meStockNeedsNumbers')).toBe(false);
    expect(act('tab', '[aria-pressed="true"]').getAttribute('data-tab')).toBe('short');
    expect(box().querySelectorAll('li[data-sn2-row]')).toHaveLength(1);
  });

  test('다른 화면에서는 안 보인다 · 수주가 없으면 그 말을 · 못 읽으면 칸이 없다', async () => {
    await load();
    expect(seen('meStockNeedsNumbers')).toBe(false);
    await load({
      hash: '#dash-stock',
      needs: () => ok({ can_manage: true, orders: [], materials: [] }),
    });
    expect(seen('meStockNeedsNumbers')).toBe(true);
    expect(text(dash().querySelector('.me-empty'))).toBe('진행 중인 수주가 없습니다.');
    await load({ hash: '#dash-stock', needs: () => fail(409, 'db_pending', 'x') });
    expect(seen('meStockNeedsNumbers')).toBe(false);
    expect(dash().innerHTML).toBe('');
  });
});

describe('안 보이는 때', () => {
  test('못 읽으면(DB 0063 적용 전 · 오류 · 끊김) — 칸도 메뉴 줄도 없다. 본사 · Manager 는 묻지 않는다', async () => {
    for (const needs of [
      () => fail(409, 'db_pending', 'x'),
      () => fail(500, 'x', 'x'),
      () => new Error('offline'),
      () => ok({ orders: null }),
    ]) {
      await load({ partner: partnerOf('agent', 'owner'), needs });
      expect(seen('stockNeeds')).toBe(false);
      expect(box().innerHTML).toBe('');
      expect(menu('stock-needs').hidden).toBe(true);
    }
    for (const partner of [PLATFORM, partnerOf('manager', 'owner')]) {
      const calls = await load({ partner });
      expect(asked(calls)).toEqual([]);
    }
  });
});
