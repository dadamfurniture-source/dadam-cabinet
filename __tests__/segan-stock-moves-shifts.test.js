/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element */
/**
 * SEGAN 「구매 · 재고 › 입출고」 · 구매 · 재고 대시보드 숫자 (segan/stock-moves.js — #stockMoves · #meStockNumbers) 와
 *       「인사 › 근무 일정」 (segan/work-shifts.js — #workShifts)
 *
 *   입출고 · 숫자  다담 공장 · Expert · Agent 구성원, 읽기만 (GET /stock/moves · GET /stock/summary)
 *   근무 일정      다담 공장 · Agent 구성원이 보고, 서버가 can_manage 라고 한 사람만 적는다 (GET|PUT /company/shifts)
 *                 쉬는 날(휴무 · 연차 · 반차 · 외근)만 적는 주간 표 — 빈 칸은 근무
 *   못 읽으면(DB 적용 전 포함) 칸을 감춘다 — 근무 일정 메뉴는 「준비 중」으로 남는다
 *   이름 · 품목은 모두 지어낸 것이다
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
const NOW = Date.parse('2026-11-12T03:00:00Z'); // 한국 시간 2026-11-12 (목) 12:00 → 그 주 = 11-09 ~ 11-15

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

const MOVES = () => [
  {
    id: 'm-3',
    item_id: 's-1',
    item_name: '경첩 110° 연결형',
    item_spec: '35 컵',
    unit: '개',
    kind: 'adjust',
    qty: -5,
    qty_after: 35,
    ref: null,
    note: '세어 보니 모자람',
    by: '예시 대표',
    created_at: '2026-11-10T01:00:00Z',
  },
  {
    id: 'm-2',
    item_id: 's-1',
    item_name: '경첩 110° 연결형',
    item_spec: '35 컵',
    unit: '개',
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
    item_id: 's-11',
    item_name: 'PB 화이트',
    item_spec: '',
    unit: '장',
    kind: 'in',
    qty: 30,
    qty_after: 126,
    ref: null,
    note: '예시 가람보드',
    by: null,
    created_at: '2026-11-05T02:20:00Z',
  },
];
const SUMMARY = () => ({
  short: { board: 1, hardware: 2 },
  expected: 3,
  offcuts: { left: 5, reserved: 1, old: 0 },
  boards: [
    { name: 'PB 화이트', spec: '18T', unit: '장', qty: 126 },
    { name: 'MDF', spec: '', unit: '장', qty: 63 },
    { name: 'PB 그레이', spec: '18T', unit: '장', qty: 0 },
  ],
});
const PEOPLE = () => [
  { kind: 'member', id: 'u-1', name: '예시 대표', role: 'owner' },
  { kind: 'member', id: 'u-3', name: '', role: 'staff' },
  { kind: 'worker', id: 'w-1', name: '재단 1', role: 'worker' },
];
const SHIFTS = () => [
  { person_kind: 'member', person_id: 'u-3', date: '2026-11-13', kind: 'leave', note: '가족 행사' },
  { person_kind: 'worker', person_id: 'w-1', date: '2026-11-12', kind: 'half', note: null },
  { person_kind: 'member', person_id: 'u-1', date: '2026-11-18', kind: 'off', note: null },
];

async function load(options = {}) {
  const store = { shifts: SHIFTS() };
  const opts = { session: SESSION, partner: HQ, hash: '#stock-moves', manage: true, ...options };
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
    'SeganStockOffcuts',
    'SeganStockMoves',
    'SeganWorkShifts',
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
  const calls = { fetch: [], store };
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
    if (url === WORK + '/stock/moves')
      return reply(opts.moves ? opts.moves() : ok({ items: MOVES() }));
    if (url === WORK + '/stock/summary')
      return reply(opts.summary ? opts.summary() : ok(SUMMARY()));
    if (url.startsWith(WORK + '/company/shifts')) {
      if (method === 'GET') {
        if (opts.shifts) return reply(opts.shifts(url));
        const q = new URL(url).searchParams;
        return reply(
          ok({
            can_manage: opts.manage,
            today: '2026-11-12',
            from: q.get('from'),
            to: q.get('to'),
            people: PEOPLE(),
            items: store.shifts.filter((s) => s.date >= q.get('from') && s.date <= q.get('to')),
          })
        );
      }
      if (opts.gate) await opts.gate;
      return reply(opts.put ? opts.put(body) : ok(body));
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
    'segan/stock-moves.js',
    'segan/work-shifts.js',
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
const menu = (key) => document.querySelector(`#meHub li[data-me-item="${key}"]`);
const press = async (el) => {
  el.click();
  await flush();
};
const asked = (calls, prefix) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + prefix))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));
const mod = (file, name) => {
  delete window[name];
  (0, eval)(read(file));
  return window[name];
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('자리 · 이름', () => {
  test('me.html — 두 칸은 업체 칸 안(자투리 다음), 숫자 칸은 대시보드 안. 처음엔 감춘다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const moves = doc.getElementById('stockMoves');
    const shifts = doc.getElementById('workShifts');
    const nums = doc.getElementById('meStockNumbers');
    for (const el of [moves, shifts, nums]) expect(el.hasAttribute('hidden')).toBe(true);
    expect(moves.previousElementSibling.id).toBe('stockOffcuts');
    expect(moves.nextElementSibling).toBe(shifts);
    expect(shifts.nextElementSibling.id).toBe('stockOrders'); // 발주 다음이 수주 (segan/stock-orders.js)
    expect(nums.closest('section').id).toBe('meDash');
    expect(nums.previousElementSibling.id).toBe('meCalendar');
    expect(
      doc
        .querySelector('#meSubStock li[data-me-item="stock-moves"]')
        .previousElementSibling.getAttribute('data-me-item')
    ).toBe('stock-hardware');
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    for (const name of ['stock-moves.js', 'work-shifts.js']) {
      expect(srcs.indexOf(name)).toBeGreaterThanOrEqual(0);
      expect(srcs.indexOf(name)).toBeLessThan(srcs.indexOf('me.js'));
      expect(read('segan/sw.js')).toContain(`versioned(SCOPE + '${name}')`);
    }
  });

  test('기기에 남기지 않는다 · 입출고 모듈은 읽기만 한다', () => {
    for (const file of ['segan/stock-moves.js', 'segan/work-shifts.js']) {
      const code = read(file)
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .join('\n');
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
      expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
      expect(code).not.toMatch(/DELETE/);
    }
    expect(read('segan/stock-moves.js')).not.toMatch(
      /method: '(POST|PUT|PATCH)'|'(POST|PUT|PATCH)'/
    );
  });
});

describe('입출고', () => {
  test('순수 — 수량은 입고 +, 출고 −, 실사 조정은 부호 그대로. 모르는 종류는 버린다', () => {
    const M = mod('segan/stock-moves.js', 'SeganStockMoves');
    expect(MOVES().map((m) => M.signed(M.moveOf(m)))).toEqual(['−5개', '−160개', '+30장']);
    expect(M.signed(M.moveOf({ ...MOVES()[0], qty: 3 }))).toBe('+3개');
    expect(M.moveOf({ ...MOVES()[0], kind: 'gift' })).toBeNull();
    expect(M.moveOf({ ...MOVES()[0], qty: 'x' })).toBeNull();
    expect(M.moveOf(MOVES()[2])).toMatchObject({
      item: 'PB 화이트',
      where: '예시 가람보드',
      by: '',
    });
    expect(M.movesOf({ items: 'x' })).toBeNull();
    expect(M.whenText('2026-11-08T07:00:00Z')).toBe('11.08 16:00');
  });

  test('화면 — 두 길을 한 번씩 읽어 표를 그린다. 종류로 거른다', async () => {
    const calls = await load();
    expect(asked(calls, '/stock')).toEqual(['GET /stock/moves', 'GET /stock/summary']);
    expect(calls.fetch.find((c) => c.url === WORK + '/stock/moves')).toMatchObject({
      auth: 'Bearer tok-1',
      cache: 'no-store',
    });
    expect(seen('stockMoves')).toBe(true);
    expect($('meTitle').textContent).toBe('입출고');
    const rows = () =>
      [...$('stockMoves').querySelectorAll('tr[data-sm-row]')].map((tr) =>
        [...tr.children].map(text)
      );
    expect(rows()).toEqual([
      [
        '11.10 10:00',
        '경첩 110° 연결형 · 35 컵',
        '실사 조정',
        '−5개',
        '35개',
        '세어 보니 모자람',
        '예시 대표',
      ],
      [
        '11.08 16:00',
        '경첩 110° 연결형 · 35 컵',
        '출고',
        '−160개',
        '40개',
        'W-2611-005',
        '예시 직원',
      ],
      ['11.05 11:20', 'PB 화이트', '입고', '+30장', '126장', '예시 가람보드', ''],
    ]);
    await press($('stockMoves').querySelector('[data-filter="in"]'));
    expect(rows()).toHaveLength(1);
    expect($('stockMoves').querySelector('[data-filter="in"]').getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(menu('stock-moves').hidden).toBe(false);
  });

  test('기록이 없으면 그 말을 · 글자 그대로 그린다', async () => {
    await load({ moves: () => ok({ items: [] }) });
    expect(text($('stockMoves').querySelector('.me-empty'))).toBe('아직 기록이 없습니다.');
    await load({
      moves: () => ok({ items: [{ ...MOVES()[0], item_name: '<img src=x>', note: '<b>x</b>' }] }),
    });
    expect($('stockMoves').querySelector('img, td b')).toBeNull();
  });

  test('못 읽으면(DB 적용 전 · 오류 · 끊김) — 칸도 메뉴 줄도 없다. 본사 · Manager 는 묻지 않는다', async () => {
    for (const moves of [
      () => fail(409, 'db_pending', 'x'),
      () => fail(500, 'x', 'x'),
      () => new Error('offline'),
      () => ok({ items: null }),
    ]) {
      await load({ partner: partnerOf('expert', 'owner'), moves });
      expect(seen('stockMoves')).toBe(false);
      expect(menu('stock-moves').hidden).toBe(true);
    }
    for (const partner of [PLATFORM, partnerOf('manager', 'owner')]) {
      const calls = await load({ partner });
      expect(asked(calls, '/stock')).toEqual([]);
    }
  });
});

describe('구매 · 재고 대시보드 숫자', () => {
  test('summaryOf — 꼴이 아니면 null, 수는 0 이상 정수로', () => {
    const M = mod('segan/stock-moves.js', 'SeganStockMoves');
    expect(M.summaryOf({})).toBeNull();
    expect(
      M.summaryOf({
        short: { board: '2', hardware: -1 },
        expected: 1.9,
        offcuts: {},
        boards: [
          { name: ' ', qty: 3 },
          { name: 'PB', spec: '18T', unit: '장', qty: '7' },
        ],
      })
    ).toEqual({
      shortBoard: 2,
      shortHardware: 0,
      expected: 1,
      left: 0,
      reserved: 0,
      old: 0,
      boards: [{ name: 'PB · 18T', unit: '장', qty: 7 }],
      value: null,
    });
  });

  test('구매 · 재고 대시보드에서만 — 칸 여섯과 판재 줄. 살필 칸은 굵은 선, 칸을 누르면 그 화면으로', async () => {
    await load({ hash: '#dash-stock' });
    expect(seen('meStockNumbers')).toBe(true);
    const b = $('meStockNumbers');
    expect([...b.querySelectorAll('.od-kpi > div')].map(text)).toEqual([
      '안전 재고 아래 — 판재1종',
      '안전 재고 아래 — 철물2종',
      '입고 예정3종',
      '자투리 남음5조각',
      '자투리 예약1조각',
      '3달 넘은 자투리0조각',
    ]);
    expect([...b.querySelectorAll('.sn-warn')].map((d) => d.getAttribute('data-sn'))).toEqual([
      'short-board',
      'short-hardware',
    ]);
    expect(
      [...b.querySelectorAll('.od-kpi a')].map((a) => [
        a.getAttribute('href'),
        a.getAttribute('data-me-go'),
      ])
    ).toEqual([
      ['#stock-board', 'stock-board'],
      ['#stock-hardware', 'stock-hardware'],
      ['#stock-scrap', 'stock-scrap'],
      ['#stock-scrap', 'stock-scrap'],
    ]);
    expect(
      [...b.querySelectorAll('.sn-bars li')].map((li) => [
        text(li.querySelector('.sn-name')),
        li.querySelector('i').style.width,
        text(li.querySelector('.sn-qty')),
      ])
    ).toEqual([
      ['PB 화이트 · 18T', '100%', '126장'],
      ['MDF', '50%', '63장'],
      ['PB 그레이 · 18T', '0%', '0장'],
    ]);
    await load({ hash: '#dash-project' });
    expect(seen('meStockNumbers')).toBe(false);
    await load({ hash: '#dash-stock', summary: () => fail(409, 'db_pending', 'x') });
    expect(seen('meStockNumbers')).toBe(false);
  });
});

describe('재고 금액 (대표 · 실장 답에만 온다)', () => {
  test('valueOf — 꼴이 아니면 null', () => {
    const M = mod('segan/stock-moves.js', 'SeganStockMoves');
    expect(M.valueOf(undefined)).toBeNull();
    expect(M.valueOf({ total: -1 })).toBeNull();
    expect(M.valueOf({ total: '2365000', board: 2331000, hardware: 34000, unpriced: 1 })).toEqual({
      total: 2365000,
      board: 2331000,
      hardware: 34000,
      unpriced: 1,
    });
  });

  test('서버가 value 를 주면 맨 위에 금액 칸, 안 주면 없다', async () => {
    await load({
      hash: '#dash-stock',
      summary: () =>
        ok({
          ...SUMMARY(),
          value: { total: 2365000, board: 2331000, hardware: 34000, unpriced: 1 },
        }),
    });
    const worth = $('meStockNumbers').querySelector('[data-sn="worth"]');
    expect([...worth.children].map(text)).toEqual([
      '재고 금액 (판재 · 철물)2,365,000원',
      '판재2,331,000원',
      '철물34,000원',
      '단가 없는 품목1종',
    ]);
    expect(worth.nextElementSibling.classList.contains('od-kpi')).toBe(true);
    await load({ hash: '#dash-stock' });
    expect($('meStockNumbers').querySelector('[data-sn="worth"]')).toBeNull();
  });
});

describe('근무 일정', () => {
  const S = () => mod('segan/work-shifts.js', 'SeganWorkShifts');
  const box = () => $('workShifts');
  const cell = (row, i) => box().querySelectorAll(`tr[data-ws-row="${row}"] td`)[i];
  const btn = (row, i) => cell(row, i).querySelector('button');
  const range = () => text(box().querySelector('[data-ws="range"]'));

  test('순수 — 주는 월요일부터. 사람 · 쉬는 날은 아는 꼴만', () => {
    const W = S();
    expect(W.mondayOf('2026-11-12')).toBe('2026-11-09');
    expect(W.mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(W.mondayOf('2026-11-16')).toBe('2026-11-16');
    expect(W.addDays('2026-12-29', 7)).toBe('2027-01-05');
    expect(W.weekOf('2026-11-09')).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);
    expect(W.personOf({ kind: 'guest', id: 'x' })).toBeNull();
    expect(W.personOf({ kind: 'worker', id: 'w', name: ' 재단 1 ', role: 'x' })).toEqual({
      kind: 'worker',
      id: 'w',
      name: '재단 1',
      role: 'worker',
    });
    expect(
      W.itemsOf([
        {
          person_kind: 'member',
          person_id: 'u',
          date: '2026-11-13',
          kind: 'leave',
          note: ' 메모 ',
        },
        { person_id: 'u', date: '2026-11-14', kind: 'work' },
        { person_id: 'u', date: 'x', kind: 'off' },
      ])
    ).toEqual({
      'member:u:2026-11-13': { kind: 'leave', note: '메모' },
    });
    expect(W.canSee({ hq_member: true })).toBe(true);
    expect(W.canSee({ company: { plan: 'agent', role: 'staff' } })).toBe(true);
    for (const me of [
      null,
      { platform_member: true },
      { company: { plan: 'expert', role: 'owner' } },
    ])
      expect(W.canSee(me)).toBe(false);
  });

  test('화면 — 이번 주(월 ~ 일)를 읽어 사람 × 날 표를 그린다. 쉬는 날은 글자로, 오늘은 표시', async () => {
    const calls = await load({ hash: '#schedule' });
    expect(asked(calls, '/company/shifts')).toEqual([
      'GET /company/shifts?from=2026-11-09&to=2026-11-15',
    ]);
    expect(seen('workShifts')).toBe(true);
    expect($('meTitle').textContent).toBe('근무 일정');
    expect(range()).toBe('11.09 ~ 11.15');
    expect([...box().querySelectorAll('tbody th')].map(text)).toEqual([
      '예시 대표대표',
      '이름 없음직원',
      '재단 1작업자',
    ]);
    expect(text(cell('member:u-3', 4))).toBe('연차');
    expect(btn('member:u-3', 4).getAttribute('aria-label')).toBe(
      '이름 없음 11.13 연차 — 가족 행사'
    );
    expect(btn('member:u-1', 0).getAttribute('aria-label')).toBe('예시 대표 11.09 근무');
    expect(text(cell('worker:w-1', 3))).toBe('반차');
    expect(cell('worker:w-1', 3).classList.contains('ws-today')).toBe(true);
    expect(text(box().querySelectorAll('thead th')[4])).toBe('목11.12 · 오늘');
    expect(text(box().querySelector('[data-ws="count"]'))).toBe('이 주 쉬는 날 2건');
    expect(box().querySelector('[data-act="today"]')).toBeNull();
    expect(menu('schedule').querySelector('a').classList.contains('me-row-soon')).toBe(false);
  });

  test('지난 주 · 다음 주 · 이번 주 — 그 주를 다시 읽는다', async () => {
    const calls = await load({ hash: '#schedule' });
    await press(box().querySelector('[data-act="next"]'));
    expect(asked(calls, '/company/shifts').pop()).toBe(
      'GET /company/shifts?from=2026-11-16&to=2026-11-22'
    );
    expect(range()).toBe('11.16 ~ 11.22');
    expect(text(cell('member:u-1', 2))).toBe('휴무');
    await press(box().querySelector('[data-act="today"]'));
    expect(range()).toBe('11.09 ~ 11.15');
    await press(box().querySelector('[data-act="prev"]'));
    expect(range()).toBe('11.02 ~ 11.08');
  });

  test('적기 — 칸을 누르면 아래에서 종류 · 메모를 고른다. 「근무」는 kind: null (지우기)', async () => {
    const calls = await load({ hash: '#schedule' });
    await press(btn('member:u-1', 1));
    expect(text(box().querySelector('.ws-editor h4'))).toBe('예시 대표 · 11.10 (화)');
    expect([...box().querySelectorAll('[data-act="set"]')].map(text)).toEqual([
      '근무',
      '휴무',
      '연차',
      '반차',
      '외근',
    ]);
    box().querySelector('[data-ws="note"]').value = ' 병원 ';
    await press(box().querySelector('[data-act="set"][data-to="half"]'));
    const sent = calls.fetch.filter((c) => c.method === 'PUT').pop();
    expect(sent).toMatchObject({
      url: WORK + '/company/shifts',
      auth: 'Bearer tok-1',
      body: {
        person_kind: 'member',
        person_id: 'u-1',
        date: '2026-11-10',
        kind: 'half',
        note: '병원',
      },
    });
    expect(text(cell('member:u-1', 1))).toBe('반차');
    expect(text(box().querySelector('[data-ws="msg"]'))).toBe('적었습니다.');
    expect(text(box().querySelector('[data-act="set"][data-to=""]'))).toBe('근무 (지우기)');
    await press(box().querySelector('[data-act="set"][data-to=""]'));
    expect(calls.fetch.filter((c) => c.method === 'PUT').pop().body).toEqual({
      person_kind: 'member',
      person_id: 'u-1',
      date: '2026-11-10',
      kind: null,
      note: null,
    });
    expect(text(cell('member:u-1', 1))).toBe('');
    expect(text(box().querySelector('[data-ws="msg"]'))).toBe('근무로 돌렸습니다.');
    await press(box().querySelector('[data-act="close"]'));
    expect(box().querySelector('.ws-editor')).toBeNull();
  });

  test('서버가 막으면 서버 글을 적고 칸은 그대로 · 보내는 동안 잠근다', async () => {
    await load({ hash: '#schedule', put: () => fail(422, 'x', '사람을 다시 골라 주세요') });
    await press(btn('member:u-1', 1));
    await press(box().querySelector('[data-act="set"][data-to="off"]'));
    expect(text(box().querySelector('[data-ws="err"]'))).toBe('사람을 다시 골라 주세요');
    expect(text(cell('member:u-1', 1))).toBe('');

    let open;
    const gate = new Promise((r) => (open = r));
    const calls = await load({ hash: '#schedule', gate });
    await press(btn('member:u-1', 1));
    box().querySelector('[data-act="set"][data-to="off"]').click();
    await flush();
    expect(box().getAttribute('aria-busy')).toBe('true');
    box().querySelector('[data-act="set"][data-to="leave"]').click();
    open();
    await flush();
    expect(calls.fetch.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  test('월 보기 — 여섯 주를 한 번에 읽어 날마다 쉬는 사람을 적는다. 달 넘기기 · 날을 누르면 그 주로', async () => {
    const calls = await load({ hash: '#schedule' });
    expect(
      [...box().querySelectorAll('[data-act="view"]')].map((b) => [
        text(b),
        b.getAttribute('aria-pressed'),
      ])
    ).toEqual([
      ['주', 'true'],
      ['월', 'false'],
    ]);
    await press(box().querySelector('[data-act="view"][data-view="month"]'));
    expect(asked(calls, '/company/shifts').pop()).toBe(
      'GET /company/shifts?from=2026-10-26&to=2026-12-06'
    );
    expect(range()).toBe('2026년 11월');
    expect(box().querySelectorAll('.ws-month tbody tr')).toHaveLength(6);
    const day = (d) => box().querySelector(`[data-act="day"][data-date="${d}"]`);
    expect(text(day('2026-11-13'))).toBe('13이름 없음 연차');
    expect(day('2026-11-13').getAttribute('aria-label')).toBe('11.13 이름 없음 연차 — 그 주 열기');
    expect(day('2026-11-12').closest('td').classList.contains('ws-today')).toBe(true);
    expect(day('2026-10-26').closest('td').classList.contains('ws-out')).toBe(true);
    expect(text(box().querySelector('[data-ws="count"]'))).toBe('이 달 쉬는 날 3건');
    expect(box().querySelector('[data-act="pick"]')).toBeNull();
    expect(box().querySelector('[data-act="today"]')).toBeNull();
    await press(box().querySelector('[data-act="next"]'));
    expect(range()).toBe('2026년 12월');
    expect(asked(calls, '/company/shifts').pop()).toBe(
      'GET /company/shifts?from=2026-11-30&to=2027-01-10'
    );
    await press(box().querySelector('[data-act="today"]'));
    expect(range()).toBe('2026년 11월');
    await press(day('2026-11-18'));
    expect(range()).toBe('11.16 ~ 11.22');
    expect(
      box().querySelector('[data-act="view"][data-view="week"]').getAttribute('aria-pressed')
    ).toBe('true');
    expect(text(cell('member:u-1', 2))).toBe('휴무');
    const W = S();
    expect(W.monthStart('2026-11-18')).toBe('2026-11-01');
    expect(W.addMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect(W.addMonths('2026-01-01', -1)).toBe('2025-12-01');
  });

  test('직원(can_manage 아님) — 보기만. 누르는 칸이 없고, Agent 직원에게도 메뉴 줄이 나온다', async () => {
    await load({ hash: '#schedule', partner: partnerOf('agent', 'staff'), manage: false });
    expect(seen('workShifts')).toBe(true);
    expect(box().querySelectorAll('button[data-act="pick"]')).toHaveLength(0);
    expect(text(cell('member:u-3', 4))).toContain('연차');
    expect(cell('member:u-3', 4).getAttribute('title')).toBe('가족 행사');
    expect(menu('schedule').hidden).toBe(false);
    expect(text(box().querySelector('.mk-note'))).toBe('쉬는 날만 적습니다. 빈 칸은 근무입니다.');
  });

  test('못 읽으면(DB 적용 전 · 오류) — 대표에게는 「준비 중」 안내와 흐린 줄, 직원에게는 줄이 없다. Expert · 본사는 묻지 않는다', async () => {
    for (const shifts of [
      () => fail(409, 'db_pending', 'x'),
      () => fail(500, 'x', 'x'),
      () => new Error('offline'),
      () => ok({ people: null }),
    ]) {
      await load({ hash: '#schedule', partner: partnerOf('agent', 'owner'), shifts });
      expect(seen('workShifts')).toBe(false);
      expect($('mePaneNote').textContent).toContain('근무 일정은 준비 중입니다.');
      expect(menu('schedule').hidden).toBe(false);
      expect(menu('schedule').querySelector('a').classList.contains('me-row-soon')).toBe(true);
    }
    await load({
      hash: '#schedule',
      partner: partnerOf('agent', 'staff'),
      shifts: () => fail(409, 'db_pending', 'x'),
    });
    expect(menu('schedule').hidden).toBe(true);
    for (const partner of [PLATFORM, partnerOf('expert', 'owner')]) {
      const calls = await load({ hash: '#schedule', partner });
      expect(asked(calls, '/company/shifts')).toEqual([]);
    }
  });
});
