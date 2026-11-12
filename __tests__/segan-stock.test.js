/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event, KeyboardEvent */
/**
 * SEGAN 「구매 · 재고 › 기본 자재 · 철물」 (segan/stock.js + segan/me.html #stockBoard · #stockHardware)
 *
 *   누가    다담 공장 구성원 · Expert · Agent 협력업체 구성원. 다담 본사 · Manager 업체 · 업체 없는 사람은 묻지도 않는다
 *   데이터  workflow-api GET|POST /stock/items · PATCH /stock/items/:id · POST /stock/items/:id/moves · GET /stock/moves
 *   화면    탭(전체 · 부족 · 입고 예정 · 숨김) · 품목 줄 · 그 자리 상세(입고 · 출고 · 실사 조정 · 고치기 · 숨기기 · 최근 기록)
 *   권한    입고 · 출고는 구성원 누구나, 더하기 · 고치기 · 숨기기 · 실사 조정은 서버가 can_manage 라고 한 사람만
 *   못 읽으면(DB 적용 전 포함) 칸째 감추고 메뉴는 「준비 중」 안내로 남는다
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
const NOBODY = ok({ company: null, application: null, members: [], invites: [] });
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
  delete window.SeganStock;
  (0, eval)(read('segan/stock.js'));
  return window.SeganStock;
};

const SUP = { id: 'cp-7', name: '예시 마루철물' };
const SUP2 = { id: 'cp-8', name: '예시 한빛철물' };
const it = (id, kind, name, patch = {}) => ({
  id,
  kind,
  name,
  spec: '',
  unit: kind === 'board' ? '장' : '개',
  qty: 0,
  safety_qty: 0,
  short: false,
  supplier: null,
  expected_qty: null,
  expected_on: null,
  memo: null,
  active: true,
  updated_at: '2026-11-08T02:00:00Z',
  ...patch,
});
const ITEMS = () => [
  it('s-1', 'hardware', '경첩 110° 연결형', {
    spec: '35 컵',
    qty: 40,
    safety_qty: 120,
    supplier: SUP,
    expected_qty: 200,
    expected_on: '2026-11-15',
  }),
  it('s-2', 'hardware', '서랍 레일 언더 450', {
    spec: '450',
    unit: '쌍',
    qty: 18,
    safety_qty: 20,
    supplier: SUP,
  }),
  it('s-3', 'hardware', '손잡이 바 160', {
    qty: 64,
    safety_qty: 40,
    supplier: SUP2,
    memo: '블랙만',
  }),
  it('s-4', 'hardware', '옛 푸시 래치', { qty: 12, active: false }),
  it('s-11', 'board', 'PB 화이트', { spec: '18T', qty: 126, safety_qty: 60 }),
];
const MOVES = () => [
  {
    id: 'm-2',
    item_id: 's-1',
    kind: 'out',
    qty: 160,
    qty_after: 40,
    ref: 'W-2611-005',
    note: null,
    by: '예시 직원',
    created_at: '2026-11-08T07:00:00Z',
  },
  {
    id: 'm-1',
    item_id: 's-1',
    kind: 'in',
    qty: 200,
    qty_after: 200,
    ref: null,
    note: '예시 마루철물',
    by: null,
    created_at: '2026-11-05T02:20:00Z',
  },
];

/**
 * 마이페이지를 띄운다 (기본 = 다담 공장 구성원 · 대표, 철물 화면)
 * opts.manage = 서버가 대표 · 실장이라고 답하나 · opts.list(n) · opts.move(id, body) · opts.post(body) · opts.patch(id, body) · opts.moves(id)
 */
async function load(options = {}) {
  const store = { items: options.items || ITEMS(), moves: MOVES(), lists: 0 };
  const opts = {
    session: SESSION,
    partner: HQ,
    hash: '#stock-hardware',
    manage: true,
    isAdmin: false,
    gate: null,
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
    'SeganStock',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: opts.noWork ? '' : WORK },
    paymentsApi: { url: PAY },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [], store };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async (name) =>
        name === 'is_admin' ? { data: opts.isAdmin, error: null } : { data: [], error: null },
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
  const shortOf = (i) => ({ ...i, short: i.active && i.qty < i.safety_qty });
  const listReply = () => {
    store.lists += 1;
    if (opts.list) return opts.list(store.lists);
    return ok({
      company: { id: CO, name: 'x' },
      can_manage: opts.manage,
      suppliers: opts.manage ? [SUP, SUP2] : [],
      items: store.items.filter((i) => opts.manage || i.active).map(shortOf),
    });
  };
  const moveReply = (id, body) => {
    if (opts.move) return opts.move(id, body);
    const row = store.items.find((r) => r.id === id);
    const after = row.qty + (body.kind === 'out' ? -body.qty : body.qty);
    row.qty = after;
    if (body.kind === 'in' && row.expected_qty) {
      row.expected_qty = row.expected_qty - body.qty > 0 ? row.expected_qty - body.qty : null;
      if (!row.expected_qty) row.expected_on = null;
    }
    const mv = {
      id: 'm-new-' + store.moves.length,
      item_id: id,
      kind: body.kind,
      qty: body.qty,
      qty_after: after,
      ref: body.ref || null,
      note: body.note || null,
      by: '예시 대표',
      created_at: '2026-11-12T03:00:00Z',
    };
    store.moves.unshift(mv);
    return ok(
      {
        move: mv,
        item: { id, qty: after, expected_qty: row.expected_qty, expected_on: row.expected_on },
      },
      201
    );
  };
  const postReply = (body) => {
    if (opts.post) return opts.post(body);
    const row = it('s-new-' + store.items.length, body.kind, body.name, {
      spec: body.spec || '',
      unit: body.unit,
      qty: body.qty || 0,
      safety_qty: body.safety_qty || 0,
      memo: body.memo,
    });
    store.items.push(row);
    return ok(shortOf(row), 201);
  };
  const patchReply = (id, body) => {
    if (opts.patch) return opts.patch(id, body);
    const row = store.items.find((r) => r.id === id);
    const { supplier_id, ...rest } = body;
    Object.assign(row, rest);
    if (supplier_id !== undefined)
      row.supplier = [SUP, SUP2].find((s) => s.id === supplier_id) || null;
    return ok(shortOf(row));
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
    if (url === WORK + '/stock/items') {
      if (method === 'GET') return reply(await listReply());
      if (opts.gate) await opts.gate;
      return reply(await postReply(body));
    }
    if (url.startsWith(WORK + '/stock/moves')) {
      const id = new URL(url).searchParams.get('item');
      if (opts.moves) return reply(await opts.moves(id));
      return reply(ok({ items: store.moves.filter((m) => m.item_id === id) }));
    }
    if (url.startsWith(WORK + '/stock/items/')) {
      if (opts.gate) await opts.gate;
      const rest = url.slice((WORK + '/stock/items/').length).split('/');
      const id = decodeURIComponent(rest[0]);
      return reply(rest[1] === 'moves' ? await moveReply(id, body) : await patchReply(id, body));
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
    'segan/stock.js',
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
const hw = () => $('stockHardware');
const bd = () => $('stockBoard');
const rows = (b = hw()) => [...b.querySelectorAll('li[data-st-row]')];
const names = (b = hw()) => rows(b).map((li) => text(li.querySelector('.me-c-main b')));
const row = (id, b = hw()) => b.querySelector(`li[data-st-row="${id}"]`);
const act = (name, extra = '', b = hw()) => b.querySelector(`[data-act="${name}"]${extra}`);
const field = (key, b = hw()) => b.querySelector(`[data-f="${key}"]`);
const err = (b = hw()) => b.querySelector('[data-st="err"]');
const msg = (b = hw()) =>
  text(b.querySelector('[data-st="msg"]') || b.querySelector('[data-st="topmsg"]'));
const tabs = (b = hw()) => [...b.querySelectorAll('[data-act="tab"]')].map(text);
const menu = (key) => document.querySelector(`#meHub li[data-me-item="${key}"]`);
const press = async (el) => {
  el.click();
  await flush();
};
const openRow = (id, b = hw()) => press(act('open', `[data-id="${id}"]`, b));
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/stock'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));
const last = (calls, method) =>
  calls.fetch.filter((c) => c.url.startsWith(WORK + '/stock') && c.method === method).pop();

afterEach(() => {
  jest.restoreAllMocks();
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸(#partner) 안, 거래처 다음 두 칸 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const b = doc.getElementById('stockBoard');
    const h = doc.getElementById('stockHardware');
    for (const el of [b, h]) {
      expect(el.hasAttribute('hidden')).toBe(true);
      expect(el.closest('section').id).toBe('partner');
      expect(el.classList.contains('od')).toBe(true);
      expect(el.classList.contains('st')).toBe(true);
    }
    expect(b.previousElementSibling.id).toBe('counterparties');
    expect(b.nextElementSibling).toBe(h);
    expect(h.nextElementSibling.id).toBe('orders');
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((s) => s === name);
    expect(at('stock.js')).toBeGreaterThanOrEqual(0);
    expect(at('stock.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'stock.js')");
  });

  test('품목 이름을 기기에 남기지 않는다 — 저장소 · 알림을 쓰지 않고, 확인 창도 띄우지 않는다', () => {
    const code = read('segan/stock.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
    expect(code).not.toMatch(/<form\b/);
    expect(code).not.toMatch(/DELETE/);
  });

  test('폰 — 긴 품목 이름은 줄을 바꾼다 · 부족은 색만으로 알리지 않는다 · 그림자 없음', () => {
    const css = read('segan/shell.css');
    const name = /\.st-item \.me-c-main b,\s*\.st-item \.me-c-main small\s*\{[^}]*\}/.exec(css);
    expect(name).not.toBeNull();
    expect(name[0]).toMatch(/white-space:\s*normal/);
    // 이 화면 규칙(.st-*)을 모두 모아 본다 — 못 찾으면 빈 글로 거짓 통과하지 않게 개수부터 센다
    const rules = css.match(/(^|\n)\s*\.st[-\s][^{]*\{[^}]*\}/g) || [];
    expect(rules.length).toBeGreaterThanOrEqual(15);
    expect(rules.join('\n')).not.toMatch(/box-shadow|border-radius/);
    expect(mod().TEXT.stShort).toBe('부족');
  });
});

describe('순수 함수', () => {
  test('canSee — 다담 공장 구성원 · Expert · Agent 업체 구성원(역할 무관). 본사 · Manager · 업체 없음은 아니다', () => {
    const S = mod();
    expect(S.canSee({ hq_member: true })).toBe(true);
    expect(S.canSee({ company: { plan: 'expert', role: 'staff' } })).toBe(true);
    expect(S.canSee({ company: { plan: 'agent', role: 'owner' } })).toBe(true);
    for (const me of [
      null,
      [],
      {},
      { platform_member: true },
      { platform_member: true, hq_member: true },
      { company: { plan: 'manager', role: 'owner' } },
      { company: null },
    ])
      expect(S.canSee(me)).toBe(false);
  });

  test('rowOf — 모르는 종류 · 이름 없는 줄은 버린다. 입고 예정은 수량 · 날이 다 있을 때만', () => {
    const S = mod();
    expect(S.rowOf({ id: 'a', kind: 'door', name: '가' })).toBeNull();
    expect(S.rowOf({ id: 'a', kind: 'board', name: '  ' })).toBeNull();
    expect(S.rowOf({ kind: 'board', name: '가' })).toBeNull();
    const r = S.rowOf({
      id: 'a',
      kind: 'hardware',
      name: ' 경첩 ',
      qty: '40',
      safety_qty: 120,
      expected_qty: 50,
      expected_on: '2026-11-15',
      supplier: { id: 's', name: '곳' },
    });
    expect(r).toEqual({
      id: 'a',
      kind: 'hardware',
      name: '경첩',
      spec: '',
      unit: '개',
      qty: 40,
      safety: 120,
      short: true,
      supplier: { id: 's', name: '곳' },
      expectedQty: 50,
      expectedOn: '2026-11-15',
      memo: '',
      active: true,
    });
    expect(S.rowOf({ id: 'a', kind: 'board', name: '가', expected_qty: 5 }).expectedQty).toBeNull();
    expect(
      S.rowOf({ id: 'a', kind: 'board', name: '가', qty: 0, safety_qty: 5, active: false }).short
    ).toBe(false);
    expect(S.rowOf({ id: 'a', kind: 'board', name: '가' }).unit).toBe('장');
    expect(S.listOf({ items: 'x' })).toBeNull();
    expect(S.listOf({ items: [null, { id: 'a', kind: 'board', name: '가' }] })).toHaveLength(1);
  });

  test('inTab · statusOf — 숨긴 품목은 숨김 탭에만. 부족과 입고 예정은 같이 보인다', () => {
    const S = mod();
    const short = S.rowOf({
      id: 'a',
      kind: 'board',
      name: '가',
      qty: 1,
      safety_qty: 5,
      expected_qty: 3,
      expected_on: '2026-11-15',
    });
    const fine = S.rowOf({ id: 'b', kind: 'board', name: '나', qty: 9, safety_qty: 5 });
    const off = S.rowOf({
      id: 'c',
      kind: 'board',
      name: '다',
      qty: 0,
      safety_qty: 5,
      active: false,
    });
    expect(['all', 'short', 'expected', 'hidden'].map((t) => S.inTab(short, t))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(['all', 'short', 'expected', 'hidden'].map((t) => S.inTab(fine, t))).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(['all', 'short', 'expected', 'hidden'].map((t) => S.inTab(off, t))).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(S.statusOf(short)).toEqual([{ text: '부족', warn: true }, { text: '입고 예정 11.15' }]);
    expect(S.statusOf(fine)).toEqual([{ text: '재고 있음' }]);
    expect(S.statusOf(off)).toEqual([{ text: '숨김' }]);
  });

  test('글 — 수량 · 날 · 때(한국 시간) · 기록 한 줄', () => {
    const S = mod();
    expect(S.qtyText(1234.5)).toBe('1,234.5');
    expect(S.qtyText('x')).toBe('0');
    expect(S.dayText('2026-11-05')).toBe('11.05');
    expect(S.dayText('11/05')).toBe('');
    expect(S.whenText('2026-11-05T02:20:00Z')).toBe('11.05 11:20');
    expect(S.whenText('2026-11-05T16:00:00Z')).toBe('11.06 01:00');
    expect(S.whenText('x')).toBe('');
    expect(S.moveText({ kind: 'in', qty: 200, ref: '', note: '예시 철물' }, '개')).toBe(
      '입고 200개 — 예시 철물'
    );
    expect(S.moveText({ kind: 'out', qty: 160, ref: 'W-1', note: '급함' }, '개')).toBe(
      '출고 160개 — W-1 · 급함'
    );
    expect(S.moveText({ kind: 'adjust', qty: -5, ref: '', note: '' }, '장')).toBe('실사 조정 −5장');
    expect(S.moveText({ kind: 'adjust', qty: 3, ref: '', note: '' }, '장')).toBe('실사 조정 +3장');
  });

  test('moveBody — 입고 · 출고는 양수. 실사 조정은 세어 본 수량과 지금 수량의 차이를 보낸다', () => {
    const S = mod();
    const item = { qty: 40 };
    expect(S.moveBody('in', { qty: '60', note: ' 메모 ', ref: 'W-1' }, item)).toEqual({
      body: { kind: 'in', qty: 60, note: '메모' },
    });
    expect(S.moveBody('out', { qty: '10', ref: ' W-1 ' }, item)).toEqual({
      body: { kind: 'out', qty: 10, ref: 'W-1' },
    });
    expect(S.moveBody('adjust', { qty: '35' }, item)).toEqual({
      body: { kind: 'adjust', qty: -5 },
    });
    expect(S.moveBody('adjust', { qty: '42.5' }, item)).toEqual({
      body: { kind: 'adjust', qty: 2.5 },
    });
    expect(S.moveBody('adjust', { qty: '0' }, item)).toEqual({
      body: { kind: 'adjust', qty: -40 },
    });
    expect(S.moveBody('adjust', { qty: '40' }, item).error).toBe(S.TEXT.same);
    for (const bad of ['', 'x', '0', '-3'])
      expect(S.moveBody('out', { qty: bad }, item).error).toBe(S.TEXT.needQty);
    expect(S.moveBody('adjust', { qty: '-1' }, item).error).toBe(S.TEXT.needQty);
  });

  test('itemBody — 더할 때만 종류 · 처음 수량, 고칠 때만 입고 예정 (수량 · 날을 같이, 둘 다 비우면 지운다)', () => {
    const S = mod();
    expect(
      S.itemBody(
        'hardware',
        { name: ' 경첩 ', unit: '개', safety: '120', supplier: 'cp-7', first: '40', memo: '' },
        false
      )
    ).toEqual({
      body: {
        kind: 'hardware',
        name: '경첩',
        spec: '',
        unit: '개',
        safety_qty: 120,
        supplier_id: 'cp-7',
        memo: null,
        qty: 40,
      },
    });
    expect(S.itemBody('board', { name: 'PB', unit: '장' }, false).body).toEqual({
      kind: 'board',
      name: 'PB',
      spec: '',
      unit: '장',
      safety_qty: 0,
      supplier_id: null,
      memo: null,
    });
    expect(
      S.itemBody(
        'board',
        { name: 'PB', unit: '장', expectedQty: '30', expectedOn: '2026-11-20' },
        true
      ).body
    ).toEqual({
      name: 'PB',
      spec: '',
      unit: '장',
      safety_qty: 0,
      supplier_id: null,
      memo: null,
      expected_qty: 30,
      expected_on: '2026-11-20',
    });
    expect(S.itemBody('board', { name: 'PB', unit: '장' }, true).body.expected_qty).toBeNull();
    expect(S.itemBody('board', { name: '', unit: '장' }, false)).toEqual({
      error: S.TEXT.needName,
      focus: 'name',
    });
    expect(S.itemBody('board', { name: 'PB', unit: ' ' }, false)).toEqual({
      error: S.TEXT.needUnit,
      focus: 'unit',
    });
    expect(S.itemBody('board', { name: 'PB', unit: '장', safety: 'x' }, false).focus).toBe(
      'safety'
    );
    expect(S.itemBody('board', { name: 'PB', unit: '장', first: '-1' }, false).focus).toBe('first');
    expect(S.itemBody('board', { name: 'PB', unit: '장', expectedQty: '30' }, true).error).toBe(
      S.TEXT.needExpected
    );
    expect(
      S.itemBody('board', { name: 'PB', unit: '장', expectedOn: '2026-11-20' }, true).error
    ).toBe(S.TEXT.needExpected);
  });
});

describe('화면', () => {
  test('다담 공장 대표 — 한 번 읽어 철물 화면을 그린다. 탭에 수, 줄에 수량 · 안전 재고 · 상태', async () => {
    const calls = await load();
    expect(asked(calls)).toEqual(['GET /stock/items']);
    expect(calls.fetch.find((c) => c.url === WORK + '/stock/items')).toMatchObject({
      auth: 'Bearer tok-1',
      cache: 'no-store',
    });
    expect(seen('stockHardware')).toBe(true);
    expect(seen('stockBoard')).toBe(false);
    expect($('meTitle').textContent).toBe('철물');
    expect($('partner').getAttribute('aria-labelledby')).toBe('stockHardwareTitle');
    expect(tabs()).toEqual(['전체 3', '부족 2', '입고 예정 1', '숨김 1']);
    expect(names()).toEqual(['경첩 110° 연결형', '서랍 레일 언더 450', '손잡이 바 160']);
    expect(text(row('s-1'))).toBe(
      '경첩 110° 연결형35 컵 · 예시 마루철물40개안전 재고 120부족입고 예정 11.15'
    );
    expect(text(row('s-3').querySelector('.st-status'))).toBe('재고 있음');
    expect(row('s-1').querySelector('.st-warn').textContent).toBe('부족');
    expect(act('add').textContent).toBe('철물 더하기');
    expect($('mePaneNote').hidden).toBe(true);
    expect(menu('stock-hardware').hidden).toBe(false);
    expect(menu('stock-hardware').querySelector('a').classList.contains('me-row-soon')).toBe(false);
    expect(menu('stock-scrap').querySelector('a').classList.contains('me-row-soon')).toBe(true);
  });

  test('기본 자재 화면 — 판재만, 같은 틀', async () => {
    await load({ hash: '#stock-board' });
    expect(seen('stockBoard')).toBe(true);
    expect(seen('stockHardware')).toBe(false);
    expect($('meTitle').textContent).toBe('기본 자재');
    expect(names(bd())).toEqual(['PB 화이트']);
    expect(act('add', '', bd()).textContent).toBe('기본 자재 더하기');
    expect(tabs(bd())).toEqual(['전체 1', '부족 0', '입고 예정 0']);
  });

  test('탭 · 공급처로 거른다', async () => {
    await load();
    await press(act('tab', '[data-tab="short"]'));
    expect(names()).toEqual(['경첩 110° 연결형', '서랍 레일 언더 450']);
    await press(act('tab', '[data-tab="expected"]'));
    expect(names()).toEqual(['경첩 110° 연결형']);
    await press(act('tab', '[data-tab="hidden"]'));
    expect(names()).toEqual(['옛 푸시 래치']);
    await press(act('tab', '[data-tab="all"]'));
    const by = hw().querySelector('[data-st="supplier"]');
    expect([...by.options].map((o) => o.textContent)).toEqual([
      '공급처 모두',
      '예시 마루철물',
      '예시 한빛철물',
    ]);
    by.value = 'cp-8';
    by.dispatchEvent(new Event('change', { bubbles: true }));
    expect(names()).toEqual(['손잡이 바 160']);
  });

  test('줄을 누르면 — 그 자리에 상세와 최근 기록 (그 품목 것만 묻는다). 다시 누르면 닫는다', async () => {
    const calls = await load();
    await openRow('s-1');
    expect(act('open', '[data-id="s-1"]').getAttribute('aria-expanded')).toBe('true');
    expect(asked(calls).pop()).toBe('GET /stock/moves?item=s-1');
    expect(text(row('s-1').querySelector('.me-facts'))).toBe(
      '남은 수량40개안전 재고120개입고 예정200개 · 11.15공급처예시 마루철물'
    );
    expect([...row('s-1').querySelectorAll('.st-history li')].map(text)).toEqual([
      '11.08 16:00출고 160개 — W-2611-005예시 직원',
      '11.05 11:20입고 200개 — 예시 마루철물',
    ]);
    await openRow('s-1');
    expect(row('s-1').querySelector('[data-st="detail"]')).toBeNull();
  });

  test('기록을 못 읽으면 그 자리에 적는다 · 없으면 없다고', async () => {
    await load({ moves: () => fail(500, 'x', 'x') });
    await openRow('s-1');
    expect(text(row('s-1').querySelector('[data-st="history"]'))).toContain(
      '기록을 읽지 못했습니다.'
    );
    await openRow('s-2');
    await load({ moves: () => ok({ items: [] }) });
    await openRow('s-2');
    expect(text(row('s-2').querySelector('[data-st="history"]'))).toContain(
      '아직 기록이 없습니다.'
    );
  });

  test('이름 · 메모는 글자 그대로 그린다', async () => {
    await load({
      items: [
        it('s-x', 'hardware', '<img src=x onerror=1>', { memo: '<b>굵게</b>', spec: '"따옴표"' }),
      ],
    });
    expect(hw().querySelector('img')).toBeNull();
    expect(names()).toEqual(['<img src=x onerror=1>']);
    await openRow('s-x');
    expect(row('s-x').querySelector('.me-facts b')).toBeNull();
  });
});

describe('입고 · 출고 · 실사 조정', () => {
  test('입고 — 수량 · 메모를 보내고 다시 읽는다. 입고 예정이 줄고 기록이 붙는다', async () => {
    const calls = await load();
    await openRow('s-1');
    field('qty').value = '60';
    field('note').value = '예시 마루철물';
    await press(act('save-move'));
    expect(last(calls, 'POST')).toMatchObject({
      url: WORK + '/stock/items/s-1/moves',
      body: { kind: 'in', qty: 60, note: '예시 마루철물' },
      auth: 'Bearer tok-1',
    });
    expect(asked(calls).slice(-3)).toEqual([
      'POST /stock/items/s-1/moves',
      'GET /stock/items',
      'GET /stock/moves?item=s-1',
    ]);
    expect(text(row('s-1').querySelector('.st-qty'))).toBe('100개안전 재고 120');
    expect(text(row('s-1').querySelector('.me-facts'))).toContain('입고 예정140개 · 11.15');
    expect(msg()).toBe('적었습니다.');
    expect(field('qty').value).toBe('');
    expect(text(row('s-1').querySelector('.st-history li'))).toContain('입고 60개');
  });

  test('출고 — 어디에 썼는지 칸이 생기고 같이 보낸다. Enter 로도 적는다', async () => {
    const calls = await load();
    await openRow('s-1');
    expect(field('ref')).toBeNull();
    await press(act('move-kind', '[data-kind="out"]'));
    field('qty').value = '10';
    field('ref').value = 'W-2611-012';
    field('ref').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(last(calls, 'POST').body).toEqual({ kind: 'out', qty: 10, ref: 'W-2611-012' });
    expect(text(row('s-1').querySelector('.st-qty'))).toBe('30개안전 재고 120');
  });

  test('실사 조정 — 세어 본 수량을 적으면 차이를 보낸다. 같으면 보내지 않는다', async () => {
    const calls = await load();
    await openRow('s-1');
    await press(act('move-kind', '[data-kind="adjust"]'));
    expect(text(field('qty').closest('label'))).toBe('세어 본 수량 (개)');
    field('qty').value = '40';
    await press(act('save-move'));
    expect(text(err())).toBe('지금 수량과 같습니다.');
    expect(last(calls, 'POST')).toBeUndefined();
    field('qty').value = '35';
    await press(act('save-move'));
    expect(last(calls, 'POST').body).toEqual({ kind: 'adjust', qty: -5 });
  });

  test('수량이 틀리면 보내지 않고 그 자리에 적는다 · 서버가 막으면 서버 글을 적고 적던 것은 남는다', async () => {
    const calls = await load({ move: () => fail(422, 'x', '남은 수량보다 많이 뺄 수 없습니다') });
    await openRow('s-1');
    await press(act('save-move'));
    expect(text(err())).toBe('수량을 숫자로 적어 주세요.');
    expect(last(calls, 'POST')).toBeUndefined();
    await press(act('move-kind', '[data-kind="out"]'));
    field('qty').value = '999';
    field('ref').value = 'W-1';
    await press(act('save-move'));
    expect(text(err())).toBe('남은 수량보다 많이 뺄 수 없습니다');
    expect(field('qty').value).toBe('999');
    expect(field('ref').value).toBe('W-1');
    expect(text(row('s-1').querySelector('.st-qty'))).toBe('40개안전 재고 120');
  });

  test('끊기면 기본 글 · 보내는 동안 단추를 잠그고 다시 눌러도 한 번만 보낸다', async () => {
    let open;
    const gate = new Promise((r) => (open = r));
    const calls = await load({ gate });
    await openRow('s-1');
    field('qty').value = '5';
    act('save-move').click();
    await flush();
    expect(hw().getAttribute('aria-busy')).toBe('true');
    expect(act('save-move').disabled).toBe(true);
    act('save-move').click();
    open();
    await flush();
    expect(calls.fetch.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(hw().hasAttribute('aria-busy')).toBe(false);

    await load({ move: () => new Error('offline') });
    await openRow('s-1');
    field('qty').value = '5';
    await press(act('save-move'));
    expect(text(err())).toBe('처리하지 못했습니다. 잠시 뒤 다시 해 주세요.');
  });
});

describe('더하기 · 고치기 · 숨기기 (대표 · 실장)', () => {
  test('더하기 — 종류 · 이름 · 단위 · 안전 재고 · 공급처 · 처음 수량을 보낸다. 단위는 종류에 맞게 채워 둔다', async () => {
    const calls = await load();
    await press(act('add'));
    expect(field('unit').value).toBe('개');
    expect([...field('supplier').options].map((o) => o.textContent)).toEqual([
      '고르지 않음',
      '예시 마루철물',
      '예시 한빛철물',
    ]);
    expect(field('expectedQty')).toBeNull();
    await press(act('save-item'));
    expect(text(err())).toBe('품목 이름을 적어 주세요.');
    field('name').value = '댐퍼 경첩 165°';
    field('safety').value = '50';
    field('first').value = '80';
    field('supplier').value = 'cp-8';
    await press(act('save-item'));
    expect(last(calls, 'POST')).toMatchObject({
      url: WORK + '/stock/items',
      body: {
        kind: 'hardware',
        name: '댐퍼 경첩 165°',
        spec: '',
        unit: '개',
        safety_qty: 50,
        supplier_id: 'cp-8',
        memo: null,
        qty: 80,
      },
    });
    expect(names()).toContain('댐퍼 경첩 165°');
    expect(msg()).toBe('더했습니다.');
    expect(field('name')).toBeNull();
  });

  test('더하기를 서버가 막으면(같은 이름) 서버 글을 적고 적던 것은 남는다 · 「그만두기」는 보내지 않는다', async () => {
    const calls = await load({
      post: () => fail(409, 'duplicate', '같은 이름 · 규격의 품목이 이미 있습니다'),
    });
    await press(act('add'));
    field('name').value = '경첩 110° 연결형';
    await press(act('save-item'));
    expect(text(err())).toBe('같은 이름 · 규격의 품목이 이미 있습니다');
    expect(field('name').value).toBe('경첩 110° 연결형');
    await press(act('stop'));
    expect(field('name')).toBeNull();
    expect(calls.fetch.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  test('고치기 — 지금 값을 채우고, 안전 재고 · 입고 예정을 보낸다 (남은 수량은 보내지 않는다)', async () => {
    const calls = await load();
    await openRow('s-1');
    await press(act('edit'));
    expect([
      field('name').value,
      field('spec').value,
      field('safety').value,
      field('supplier').value,
      field('expectedQty').value,
      field('expectedOn').value,
    ]).toEqual(['경첩 110° 연결형', '35 컵', '120', 'cp-7', '200', '2026-11-15']);
    field('safety').value = '150';
    field('expectedQty').value = '';
    await press(act('save-item'));
    expect(text(err())).toBe('입고 예정은 수량과 받을 날을 같이 적어 주세요.');
    field('expectedOn').value = '';
    await press(act('save-item'));
    const sent = last(calls, 'PATCH');
    expect(sent.url).toBe(WORK + '/stock/items/s-1');
    expect(sent.body).toEqual({
      name: '경첩 110° 연결형',
      spec: '35 컵',
      unit: '개',
      safety_qty: 150,
      supplier_id: 'cp-7',
      memo: null,
      expected_qty: null,
      expected_on: null,
    });
    expect(text(row('s-1').querySelector('.st-status'))).toBe('부족');
    expect(msg()).toBe('고쳤습니다.');
  });

  test('숨기기 — active: false 만 보낸다. 숨김 탭으로 가고, 「다시 쓰기」로 되돌린다 (적는 칸은 없다)', async () => {
    const calls = await load();
    await openRow('s-3');
    await press(act('toggle'));
    expect(last(calls, 'PATCH')).toMatchObject({
      url: WORK + '/stock/items/s-3',
      body: { active: false },
    });
    expect(names()).not.toContain('손잡이 바 160');
    expect(msg()).toBe('숨겼습니다. 기록은 그대로 남습니다.');
    expect(tabs()).toContain('숨김 2');
    await press(act('tab', '[data-tab="hidden"]'));
    await openRow('s-3');
    expect(field('qty')).toBeNull();
    expect(act('toggle').textContent).toBe('다시 쓰기');
    await press(act('toggle'));
    expect(last(calls, 'PATCH').body).toEqual({ active: true });
    expect(msg()).toBe('다시 씁니다.');
  });
});

describe('직원 (서버가 can_manage 가 아니라고 한 사람)', () => {
  test('협력업체 Expert 직원 — 보고 입고 · 출고만 적는다. 더하기 · 고치기 · 숨기기 · 실사 조정 · 숨김 탭이 없다', async () => {
    const calls = await load({ partner: partnerOf('expert', 'staff'), manage: false });
    expect(seen('stockHardware')).toBe(true);
    expect(act('add')).toBeNull();
    expect(tabs()).toEqual(['전체 3', '부족 2', '입고 예정 1']);
    await openRow('s-1');
    expect([...hw().querySelectorAll('[data-act="move-kind"]')].map(text)).toEqual([
      '입고',
      '출고',
    ]);
    expect(act('edit')).toBeNull();
    expect(act('toggle')).toBeNull();
    field('qty').value = '3';
    await press(act('save-move'));
    expect(last(calls, 'POST').body).toEqual({ kind: 'in', qty: 3 });
  });

  test('품목이 하나도 없으면 — 직원에게는 대표 · 실장이 더한다고 알린다', async () => {
    await load({ partner: partnerOf('agent', 'staff'), manage: false, items: [] });
    expect(text(hw().querySelector('.me-empty'))).toBe(
      '아직 품목이 없습니다. 대표 · 실장이 품목을 더하면 여기에 보입니다.'
    );
  });
});

describe('안 보이는 때 — 메뉴는 「준비 중」으로 남는다', () => {
  test('다담 본사 구성원 · Manager 업체 · 업체 없는 사람 — 묻지 않는다', async () => {
    for (const partner of [PLATFORM, partnerOf('manager', 'owner'), NOBODY]) {
      const calls = await load({ partner });
      expect(asked(calls)).toEqual([]);
      expect(seen('stockHardware')).toBe(false);
    }
  });

  test('DB 적용 전(409 db_pending) · 권한 없음 · 오류 · 끊김 · 이상한 답 — 칸을 감추고 「준비 중」 안내와 흐린 메뉴 줄', async () => {
    for (const list of [
      () => fail(409, 'db_pending', 'DB 0059 적용 전입니다'),
      () => fail(403, 'not_member', 'x'),
      () => fail(500, 'x', 'x'),
      () => new Error('offline'),
      () => ok({ items: 'x' }),
    ]) {
      const calls = await load({ partner: partnerOf('expert', 'owner'), list });
      expect(asked(calls)).toEqual(['GET /stock/items']);
      expect(seen('stockHardware')).toBe(false);
      expect(hw().innerHTML).toBe('');
      expect($('mePaneNote').hidden).toBe(false);
      expect($('mePaneNote').textContent).toContain('재고 관리는 준비 중입니다.');
      expect(menu('stock-hardware').hidden).toBe(false);
      expect(menu('stock-hardware').querySelector('a').classList.contains('me-row-soon')).toBe(
        true
      );
    }
  });

  test('워커 주소가 없으면 묻지 않는다', async () => {
    const calls = await load({ noWork: true });
    expect(asked(calls)).toEqual([]);
    expect(seen('stockHardware')).toBe(false);
  });
});
