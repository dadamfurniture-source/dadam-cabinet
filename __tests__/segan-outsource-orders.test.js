/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「생산 › 외주 발주」 (segan/outsource-orders.js + segan/me.html #outsourceOrders)
 *
 *   누가    다담 공장 구성원(GET /partner/me 의 hq_member) · Expert · Agent 협력업체 구성원.
 *           다담 본사 구성원 · Manager 업체 · 업체 없는 사람은 묻지도 않는다
 *   데이터  workflow-api GET /reports?kind=outsource_order,countertop_order · GET /reports/:id · PATCH /reports/:id
 *   화면    상태로 거르기(발주 중 · 입고 · 취소 · 전체) · 줄을 누르면 상세 · 「입고 처리」 · 「발주 취소」는 되물은 뒤에만
 *   못 읽으면 칸째 감춘다 (구역 단추도). 바꾸지 못하면 서버 글을 그 줄에 남긴다
 *   업체 이름 · 문서 번호 · 수량은 모두 지어낸 것이다
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
const NOW = Date.parse('2026-11-11T03:00:00Z'); // 한국 시간 2026-11-11 (수) 12:00

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const HQ = ok({ company: null, application: null, members: [], invites: [], hq_member: true });
const company = (plan, role = 'staff') => ({
  id: CO,
  name: '다담 협력 주방',
  plan,
  next_plan: null,
  status: 'active',
  sido: '대구광역시',
  gugun: '북구',
  role,
  created_at: '2026-10-01T00:00:00Z',
});
const partnerOf = (plan, role) =>
  ok({ company: company(plan, role), application: null, members: [], invites: [] });

const mod = () => {
  delete window.SeganOutsourceOrders;
  (0, eval)(read('segan/outsource-orders.js'));
  return window.SeganOutsourceOrders;
};

/** 발주 한 건 (서버 reportFromOutsource 와 같은 꼴) — 예정일이 없으면 기간 끝은 발주일 */
const order = (id, patch = {}) => {
  const pack = patch.pack || 'door';
  const top = pack === 'top';
  const vendor = patch.vendor || '예시 가람도어';
  const no = patch.no || 'EX-WO-' + id;
  const ordered = patch.ordered || '2026-11-05';
  const expected = patch.expected === undefined ? '2026-11-13' : patch.expected;
  const qty = patch.qty === undefined ? '원장 6장 · 도어 18짝' : patch.qty;
  const row = {
    id,
    kind: top ? 'countertop_order' : 'outsource_order',
    title: `${top ? '상판 발주' : '외주 발주'} — ${top ? '상판' : pack === 'door' ? '도어재' : '재단·엣지'} · ${vendor} · ${no}`,
    period_start: ordered,
    period_end: expected || ordered,
    status: patch.status || 'ordered',
    metrics: { pack, vendor, expected: expected || null, qty },
    note: patch.note || '',
    pinned: false,
    archived_at: null,
    created_at: ordered + 'T02:00:00Z',
  };
  if (patch.receivedOn) row.metrics.received_on = patch.receivedOn;
  return row;
};
/** 한 건 읽기 답 — 목록 줄 + 본문 + 바꿀 수 있나 */
const full = (row, canEdit = true) => ({
  ...row,
  body: {
    document_id: 'doc-' + row.id,
    doc_no: row.title.split(' · ').pop(),
    rev: 1,
    title: '작업지시서',
    pack: row.metrics.pack,
    vendor: row.metrics.vendor,
    ordered_on: row.period_start,
    expected_on: row.metrics.expected,
    quantities: {},
  },
  can_edit: canEdit,
});

const ROWS = () => [
  order('014', { expected: '2026-11-10', note: '무광 화이트' }), // 예정일 지남
  order('015', {
    pack: 'cut-vendor',
    vendor: '예시 나래재단',
    qty: '원판 24장 · 엣지 310m · 부재 142장',
  }),
  order('012', { pack: 'top', vendor: '예시 다온상판', qty: '인조대리석 12T · 1장' }),
  order('016', { expected: null, ordered: '2026-11-10' }), // 예정일 없음
];

/**
 * 마이페이지를 띄운다 (기본 = 다담 공장 구성원, 외주 발주 화면)
 * opts.rows = 서버에 있는 발주 (상태로 걸러 준다) · opts.list(query) · opts.one(id) · opts.patch(id, body) 로 답을 바꾼다
 */
async function load(options = {}) {
  const store = { rows: options.rows || ROWS(), edit: options.edit || {} };
  const opts = {
    session: SESSION,
    partner: HQ,
    hash: '#p-outsource',
    projects: ok({ company: { id: CO }, can_manage: false, items: [] }), // 생산 › 제작 화면
    scope: 'all',
    pageSize: 30,
    list: null,
    one: null,
    patch: null,
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
    'SeganProductionPlan',
    'SeganProductionWorkers',
    'SeganProductionSettings',
    'SeganOutsourceOrders',
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
  const listReply = (query) => {
    if (opts.list) return opts.list(query);
    const status = query.get('status') || '';
    const page = Number(query.get('page') || 1);
    const all = store.rows.filter((r) => !status || r.status === status);
    return ok({
      items: all.slice((page - 1) * opts.pageSize, page * opts.pageSize),
      page,
      pageSize: opts.pageSize,
      hasMore: all.length > page * opts.pageSize,
      scope: opts.scope,
      role: 'viewer',
    });
  };
  const oneReply = (id) => {
    if (opts.one) return opts.one(id);
    const row = store.rows.find((r) => r.id === id);
    return row
      ? ok(full(row, store.edit[id] !== false))
      : fail(404, 'not_found', '보고를 찾을 수 없습니다');
  };
  const patchReply = (id, body) => {
    if (opts.patch) return opts.patch(id, body);
    const row = store.rows.find((r) => r.id === id);
    row.status = body.status;
    if (body.status === 'received') row.metrics.received_on = '2026-11-11';
    return ok(full(row));
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const method = init.method || 'GET';
    calls.fetch.push({
      url,
      method,
      auth: (init.headers || {}).Authorization,
      type: (init.headers || {})['Content-Type'],
      cache: init.cache,
      body,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url.startsWith(WORK + '/reports?'))
      return reply(await listReply(new URLSearchParams(url.slice(url.indexOf('?') + 1))));
    if (url.startsWith(WORK + '/reports/')) {
      const id = decodeURIComponent(url.slice((WORK + '/reports/').length));
      return reply(await (method === 'PATCH' ? patchReply(id, body) : oneReply(id)));
    }
    if (url === WORK + '/company/projects') return reply(opts.projects);
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
    'segan/outsource-orders.js',
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
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
/** 화면에 보이는가 — 모듈이 감춘 칸(hidden) · 마이페이지가 끈 칸(me-off) 은 아니다 */
const seen = (id) => !!$(id) && !$(id).hidden && !$(id).classList.contains('me-off');
const box = () => $('outsourceOrders');
const rows = () => [...box().querySelectorAll('li[data-order]')];
const rowIds = () => rows().map((li) => li.getAttribute('data-order'));
const row = (id) => box().querySelector(`li[data-order="${id}"]`);
const act = (name, extra = '') => box().querySelector(`[data-act="${name}"]${extra}`);
const filterBtn = (f) => act('filter', `[data-filter="${f}"]`);
const msg = () => text(box().querySelector('[data-oo="msg"]'));
const facts = (id) =>
  Object.fromEntries(
    [...row(id).querySelectorAll('dl.oo-facts > div')].map((d) => [
      text(d.querySelector('dt')),
      text(d.querySelector('dd')),
    ])
  );
const partIds = () =>
  [...$('meParts').querySelectorAll('a[data-me-part]')].map((a) => a.getAttribute('data-me-part'));
const press = async (el) => {
  el.click();
  await flush();
};
const open = (id) => press(act('open', `[data-id="${id}"]`));
const go = async (hash) => {
  window.location.hash = hash;
  window.dispatchEvent(new Event('hashchange'));
  await flush();
};
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/reports'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));
const LIST = '/reports?kind=outsource_order,countertop_order';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸(#partner) 안, 생산 계획 다음 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('outsourceOrders');
    expect(el).not.toBeNull();
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('partner');
    expect(el.classList.contains('od')).toBe(true);
    expect(el.classList.contains('oo')).toBe(true);
    expect(el.previousElementSibling.id).toBe('productionPlan');
    expect(el.nextElementSibling.id).toBe('productionSettings');
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    // 없으면(-1) 차례 비교가 거짓으로 통과하지 않게 자리부터 본다
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['outsource-orders.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('outsource-orders.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'outsource-orders.js')");
  });

  test('꾸러미 · 상태 이름은 PC 보고 화면(admin/work-reports.html)과 같다', () => {
    const O = mod();
    const pc = read('admin/work-reports.html');
    for (const name of Object.values(O.PACK_NAME)) expect(pc).toContain(name);
    expect(O.PACK_NAME).toEqual({ door: '도어재', 'cut-vendor': '재단·엣지', top: '상판' });
    expect(O.STATUS_NAME).toEqual({ ordered: '발주', received: '입고', cancelled: '취소' });
    expect(O.KINDS).toEqual(['outsource_order', 'countertop_order']);
    expect(O.FILTERS.map((f) => f[0])).toEqual(['ordered', 'received', 'cancelled', '']);
  });

  test('발주 내용을 기기에 남기지 않는다 — 저장소 · 알림을 쓰지 않고, 확인 창도 띄우지 않는다', () => {
    // 머리말의 설명 글은 빼고 본다 — 코드가 쓰는지만
    const code = read('segan/outsource-orders.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
    expect(code).not.toMatch(/work-reports\.html['"]/); // PC 화면으로 보내지 않는다
  });

  test('폰 — 긴 제목 · 문서 번호는 줄을 바꾼다 · 그림자 없음', () => {
    const css = read('segan/shell.css');
    const title = /\.oo-item \.me-c-main b\s*\{[^}]*\}/.exec(css);
    expect(title).not.toBeNull();
    expect(title[0]).toMatch(/white-space:\s*normal/);
    expect(title[0]).toMatch(/overflow-wrap:\s*anywhere/);
    // 이 화면 규칙(.oo-*)을 모두 모아 본다 — 못 찾으면 빈 글로 거짓 통과하지 않게 개수부터 센다
    const rules = css.match(/(^|\n)\.oo-[^{]*\{[^}]*\}/g) || [];
    expect(rules.length).toBeGreaterThanOrEqual(6);
    expect(rules.join('\n')).not.toMatch(/box-shadow|border-radius/);
  });
});

describe('순수 함수', () => {
  test('canSee — 다담 공장 구성원 · Expert · Agent 업체 구성원만 (본사 구성원 · Manager 업체 · 고객은 아니다)', () => {
    const O = mod();
    expect(O.canSee({ hq_member: true })).toBe(true);
    expect(O.canSee({ company: { plan: 'expert', role: 'staff' } })).toBe(true);
    expect(O.canSee({ company: { plan: 'agent', role: 'owner' } })).toBe(true);
    expect(O.canSee({ company: { plan: 'manager', role: 'owner' } })).toBe(false);
    expect(O.canSee({ company: { role: 'owner' } })).toBe(false);
    expect(O.canSee({ platform_member: true })).toBe(false);
    expect(O.canSee({ platform_member: true, company: { plan: 'agent' } })).toBe(false);
    expect(O.canSee({ company: null })).toBe(false);
    expect(O.canSee({ hq_member: 'true' })).toBe(false);
    for (const v of [null, undefined, '', 0, [], 'x']) expect(O.canSee(v)).toBe(false);
  });

  test('expectedOf — 숫자 칸 · 본문의 예정일만. 기간 끝은 쓰지 않는다 (예정일 없는 발주에는 발주일이 들어 있다)', () => {
    const O = mod();
    expect(O.expectedOf(order('1'))).toBe('2026-11-13');
    const none = order('2', { expected: null });
    expect(none.period_end).toBe('2026-11-05'); // 서버가 발주일을 넣는다
    expect(O.expectedOf(none)).toBe('');
    expect(O.expectedOf({ body: { expected_on: '2026-11-20T00:00:00Z' } })).toBe('2026-11-20');
    expect(O.expectedOf({ period_end: '2026-11-20' })).toBe('');
    for (const v of [null, undefined, 'x', [], { metrics: 'x' }]) expect(O.expectedOf(v)).toBe('');
  });

  test('isLate — 발주 중이고 예정일이 오늘(한국 날짜)보다 앞일 때만', () => {
    const O = mod();
    const today = '2026-11-11';
    expect(O.isLate(order('1', { expected: '2026-11-10' }), today)).toBe(true);
    expect(O.isLate(order('1', { expected: '2026-11-11' }), today)).toBe(false);
    expect(O.isLate(order('1', { expected: '2026-11-12' }), today)).toBe(false);
    expect(O.isLate(order('1', { expected: null }), today)).toBe(false);
    expect(O.isLate(order('1', { expected: '2026-11-01', status: 'received' }), today)).toBe(false);
    expect(O.isLate(order('1', { expected: '2026-11-01', status: 'cancelled' }), today)).toBe(
      false
    );
    expect(O.isLate(null, today)).toBe(false);
    // 오늘을 안 주면 한국 날짜로 — 15:00Z 부터 한국은 다음 날이다
    expect(O.kstDay('2026-11-10T14:59:00Z')).toBe('2026-11-10');
    expect(O.kstDay('2026-11-10T15:00:00Z')).toBe('2026-11-11');
    expect(O.kstDay('x')).toBe('');
  });

  test('글 — 날짜 · 꾸러미 · 줄 아래 글 · 목록 주소', () => {
    const O = mod();
    expect(O.dayLabel('2026-11-11')).toBe('11/11(수)');
    expect(O.dayLabel('')).toBe('-');
    expect(O.dayLabel('x')).toBe('-');
    expect(O.packOf(order('1', { pack: 'cut-vendor' }))).toBe('재단·엣지');
    expect(O.packOf({ kind: 'countertop_order' })).toBe('상판');
    expect(O.packOf({ kind: 'outsource_order', metrics: { pack: 'zz' } })).toBe('');
    // 제목이 있으면 수량만, 없으면 꾸러미 · 업체 · 수량
    expect(O.subText(order('1'))).toBe('원장 6장 · 도어 18짝');
    expect(O.subText({ ...order('1'), title: '' })).toBe(
      '도어재 · 예시 가람도어 · 원장 6장 · 도어 18짝'
    );
    expect(O.subText({ ...order('1', { qty: 18 }) })).toBe(''); // 글이 아닌 수량은 쓰지 않는다
    expect(O.daysText(order('1'))).toBe('발주 11/5(목) · 입고 예정 11/13(금)');
    expect(O.daysText(order('1', { expected: null }))).toBe('발주 11/5(목)');
    expect(O.daysText(order('1', { status: 'received', receivedOn: '2026-11-12' }))).toBe(
      '발주 11/5(목) · 입고 예정 11/13(금) · 입고 11/12(목)'
    );
    expect(O.listPath('ordered', 1)).toBe(LIST + '&status=ordered&page=1');
    expect(O.listPath('', 3)).toBe(LIST + '&page=3');
    expect(O.listPath('received', 0)).toBe(LIST + '&status=received&page=1');
  });

  test('canChange — 발주 중이고 서버가 바꿔도 된다고 한 외주 · 상판 발주만', () => {
    const O = mod();
    expect(O.canChange(full(order('1')))).toBe(true);
    expect(O.canChange(full(order('1', { pack: 'top' })))).toBe(true);
    expect(O.canChange(full(order('1'), false))).toBe(false);
    expect(O.canChange(order('1'))).toBe(false); // 목록 줄에는 can_edit 이 없다
    expect(O.canChange(full(order('1', { status: 'received' })))).toBe(false);
    expect(O.canChange(full(order('1', { status: 'cancelled' })))).toBe(false);
    expect(O.canChange({ ...full(order('1')), kind: 'work_report' })).toBe(false);
    expect(O.canChange({ ...full(order('1')), can_edit: 'true' })).toBe(false);
    expect(O.canChange(null)).toBe(false);
  });
});

describe('화면', () => {
  test('다담 공장 구성원 — 생산 › 외주 발주. 발주 중인 것부터 읽고, 여는 것만으로는 아무것도 바꾸지 않는다', async () => {
    const calls = await load();
    expect(asked(calls)).toEqual(['GET ' + LIST + '&status=ordered&page=1']);
    const c = calls.fetch.find((x) => x.url.startsWith(WORK + '/reports'));
    expect(c.auth).toBe('Bearer tok-1');
    expect(c.cache).toBe('no-store');
    expect(c.body).toBeUndefined();
    expect(seen('outsourceOrders')).toBe(true);
    expect($('partner').hidden).toBe(false);
    expect(text($('meTitle'))).toBe('외주 발주');
    expect($('partner').getAttribute('aria-labelledby')).toBe('outsourceOrdersTitle');
    expect(text($('outsourceOrdersTitle'))).toBe('외주 발주');
    expect(partIds()).toEqual(['p-make', 'p-outsource']);
    const part = document.querySelector('a[data-me-part="p-outsource"]');
    expect(text(part)).toBe('외주 발주');
    expect(part.getAttribute('aria-current')).toBe('page');
    expect(part.getAttribute('href')).toBe('#p-outsource');
    // 다른 생산 화면은 꺼져 있다
    expect(seen('partnerProjects')).toBe(false);
    const note = text(box().querySelector('p.mk-note'));
    expect(note).toContain('다담 공장의 외주 · 상판 발주 전체입니다.');
    expect(note).toContain('상세설계 4단계(작업지시서)');
    expect(filterBtn('ordered').getAttribute('aria-pressed')).toBe('true');
    expect(filterBtn('').getAttribute('aria-pressed')).toBe('false');
    expect(msg()).toBe('');
  });

  test('줄 — 제목 · 수량 · 발주일 · 입고 예정 · 상태. 예정일이 지난 발주만 「예정일 지남」', async () => {
    await load();
    expect(rowIds()).toEqual(['014', '015', '012', '016']);
    expect(text(row('014').querySelector('.me-c-main b'))).toBe(
      '외주 발주 — 도어재 · 예시 가람도어 · EX-WO-014'
    );
    expect([...row('014').querySelectorAll('.me-c-main small')].map(text)).toEqual([
      '원장 6장 · 도어 18짝',
      '발주 11/5(목) · 입고 예정 11/10(화)',
    ]);
    expect(text(row('014').querySelector('.oo-status'))).toBe('발주예정일 지남');
    expect(row('014').querySelector('.oo-late')).not.toBeNull();
    expect(text(row('012').querySelector('.me-c-main b'))).toBe(
      '상판 발주 — 상판 · 예시 다온상판 · EX-WO-012'
    );
    // 예정일을 안 적은 발주 — 기간 끝(발주일)을 예정일로 읽지 않는다
    expect([...row('016').querySelectorAll('.me-c-main small')].map(text)).toEqual([
      '원장 6장 · 도어 18짝',
      '발주 11/10(화)',
    ]);
    for (const id of ['015', '012', '016']) expect(row(id).querySelector('.oo-late')).toBeNull();
    expect(box().querySelectorAll('.ad-detail').length).toBe(0);
    expect(act('more')).toBeNull();
  });

  test('업체 대표 · 실장(서버 scope company) — 우리 팩토리 발주 전체라고 적는다. 모르는 scope 는 내 발주로 본다', async () => {
    await load({
      partner: partnerOf('agent', 'owner'),
      list: () => ok({ items: [order('031')], hasMore: false, scope: 'company' }),
    });
    expect(seen('outsourceOrders')).toBe(true);
    expect(text(box().querySelector('p.mk-note'))).toContain(
      '우리 팩토리의 외주 · 상판 발주 전체입니다. 남이 낸 발주는 보기만 합니다.'
    );
    expect(window.SeganOutsourceOrders.state.scope).toBe('company');
    await load({
      partner: partnerOf('agent', 'owner'),
      list: () => ok({ items: [order('031')], hasMore: false, scope: 'everyone' }),
    });
    expect(text(box().querySelector('p.mk-note'))).toContain(
      '내가 낸 외주 · 상판 발주만 보입니다.'
    );
  });

  test('협력업체(Expert · Agent) 구성원 — 내가 낸 발주만이라고 적는다. 외주 · 상판 발주가 아닌 줄은 버린다', async () => {
    for (const plan of ['expert', 'agent']) {
      const calls = await load({
        partner: partnerOf(plan, 'staff'),
        list: () =>
          ok({
            items: [order('021'), { ...order('022'), kind: 'work_report' }, null, { kind: 'x' }],
            hasMore: false,
            scope: 'mine',
          }),
      });
      expect(asked(calls)).toEqual(['GET ' + LIST + '&status=ordered&page=1']);
      expect(seen('outsourceOrders')).toBe(true);
      expect(text(box().querySelector('p.mk-note'))).toContain(
        '내가 낸 외주 · 상판 발주만 보입니다.'
      );
      expect(rowIds()).toEqual(['021']);
      expect(document.querySelector('a[data-me-part="p-outsource"]')).not.toBeNull();
    }
  });

  test('발주가 없어도 화면은 있다 — 빈 글 · 다른 상태를 골라 볼 수 있다', async () => {
    await load({ rows: [order('031', { status: 'received', receivedOn: '2026-11-09' })] });
    expect(seen('outsourceOrders')).toBe(true);
    expect(rows().length).toBe(0);
    expect(text(box().querySelector('.me-empty'))).toBe('들어오기를 기다리는 발주가 없습니다.');
    await press(filterBtn('received'));
    expect(rowIds()).toEqual(['031']);
    expect([...row('031').querySelectorAll('.me-c-main small')].map(text)[1]).toBe(
      '발주 11/5(목) · 입고 예정 11/13(금) · 입고 11/9(월)'
    );
    await press(filterBtn('cancelled'));
    expect(text(box().querySelector('.me-empty'))).toBe('취소한 발주가 없습니다.');
  });

  test('생산 화면 사이를 오간다 — 제작 ↔ 외주 발주', async () => {
    await load({ hash: '#p-make' });
    expect(seen('outsourceOrders')).toBe(false);
    expect(partIds()).toEqual(['p-make', 'p-outsource']);
    await go('#p-outsource');
    expect(seen('outsourceOrders')).toBe(true);
    expect(text($('meTitle'))).toBe('외주 발주');
    await go('#p-make');
    expect(seen('outsourceOrders')).toBe(false);
  });
});

describe('거르기 · 더 보기', () => {
  test('상태를 고르면 그 상태로 첫 쪽부터 다시 읽는다 — 전체는 status 없이', async () => {
    const calls = await load({
      rows: [
        ...ROWS(),
        order('007', { status: 'cancelled' }),
        order('009', { status: 'received' }),
      ],
    });
    await press(filterBtn('cancelled'));
    expect(asked(calls).slice(-1)).toEqual(['GET ' + LIST + '&status=cancelled&page=1']);
    expect(rowIds()).toEqual(['007']);
    expect(row('007').classList.contains('me-cs-item--off')).toBe(true);
    expect(filterBtn('cancelled').getAttribute('aria-pressed')).toBe('true');
    expect(filterBtn('ordered').getAttribute('aria-pressed')).toBe('false');
    await press(filterBtn(''));
    expect(asked(calls).slice(-1)).toEqual(['GET ' + LIST + '&page=1']);
    expect(rowIds().length).toBe(6);
    // 같은 상태를 다시 누르면 묻지 않는다
    const n = asked(calls).length;
    await press(filterBtn(''));
    expect(asked(calls).length).toBe(n);
  });

  test('상태를 바꾸면 열어 둔 줄은 닫힌다', async () => {
    await load();
    await open('014');
    expect(row('014').querySelector('.ad-detail')).not.toBeNull();
    await press(filterBtn(''));
    expect(box().querySelectorAll('.ad-detail').length).toBe(0);
  });

  test('더 보기 — 다음 쪽을 이어 붙인다. 못 읽으면 있던 줄은 그대로 두고 글만 남긴다', async () => {
    const calls = await load({ pageSize: 2 });
    expect(rowIds()).toEqual(['014', '015']);
    expect(text(act('more'))).toBe('더 보기');
    await press(act('more'));
    expect(asked(calls).slice(-1)).toEqual(['GET ' + LIST + '&status=ordered&page=2']);
    expect(rowIds()).toEqual(['014', '015', '012', '016']);
    expect(act('more')).toBeNull();

    let n = 0;
    await load({
      list: () => {
        n += 1;
        return n === 1
          ? ok({ items: [order('041')], hasMore: true, scope: 'all' })
          : fail(500, 'x', '');
      },
    });
    await press(act('more'));
    expect(rowIds()).toEqual(['041']);
    expect(msg()).toBe('발주 목록을 불러오지 못했습니다. 잠시 뒤 다시 해 주세요.');
    expect(act('more')).not.toBeNull();
  });
});

describe('상세', () => {
  test('줄을 누르면 한 건을 읽어 편다 — 상태 · 꾸러미 · 업체 · 수량 · 날짜 · 문서 번호 · 메모. 다시 누르면 닫는다', async () => {
    const calls = await load();
    await open('014');
    expect(asked(calls).slice(-1)).toEqual(['GET /reports/014']);
    expect(act('open', '[data-id="014"]').getAttribute('aria-expanded')).toBe('true');
    expect(facts('014')).toEqual({
      상태: '발주',
      꾸러미: '도어재',
      업체: '예시 가람도어',
      수량: '원장 6장 · 도어 18짝',
      발주일: '11/5(목)',
      '입고 예정': '11/10(화) — 예정일 지남',
      '문서 번호': 'EX-WO-014',
      메모: '무광 화이트',
    });
    expect(text(act('receive'))).toBe('입고 처리');
    expect(text(act('cancel'))).toBe('발주 취소');
    expect(row('014').querySelector('[data-err]').hidden).toBe(true);
    // 다른 줄을 열면 앞 줄은 닫힌다
    await open('016');
    expect(row('014').querySelector('.ad-detail')).toBeNull();
    expect(facts('016')).toEqual({
      상태: '발주',
      꾸러미: '도어재',
      업체: '예시 가람도어',
      수량: '원장 6장 · 도어 18짝',
      발주일: '11/10(화)',
      '문서 번호': 'EX-WO-016',
    });
    await open('016');
    expect(box().querySelectorAll('.ad-detail').length).toBe(0);
    expect(act('open', '[data-id="016"]').getAttribute('aria-expanded')).toBe('false');
  });

  test('남이 낸 발주(can_edit 아님) — 단추 없이 까닭만 적는다', async () => {
    await load({ edit: { '015': false } });
    await open('015');
    expect(act('receive')).toBeNull();
    expect(act('cancel')).toBeNull();
    expect(text(row('015').querySelector('.ad-detail > p.mk-note'))).toBe(
      '발주를 낸 사람과 관리자만 바꿀 수 있습니다.'
    );
  });

  test('입고 · 취소한 발주 — 단추도 까닭 글도 없다. 입고한 날을 보인다', async () => {
    await load({
      rows: [
        order('051', { status: 'received', receivedOn: '2026-11-09' }),
        order('052', { status: 'cancelled' }),
      ],
    });
    await press(filterBtn(''));
    await open('051');
    expect(facts('051')['상태']).toBe('입고');
    expect(facts('051')['입고한 날']).toBe('11/9(월)');
    expect(facts('051')['입고 예정']).toBe('11/13(금)');
    expect(row('051').querySelector('.rd-acts')).toBeNull();
    expect(row('051').querySelector('.ad-detail > p.mk-note')).toBeNull();
    await open('052');
    expect(facts('052')['상태']).toBe('취소');
    expect(row('052').querySelector('.rd-acts')).toBeNull();
  });

  test('한 건을 못 읽으면 · 외주 발주가 아닌 답이면 — 그 줄에 글만 남긴다', async () => {
    for (const one of [
      () => fail(404, 'not_found', '보고를 찾을 수 없습니다'),
      () => new Error('끊김'),
      () => ok({ ...full(order('014')), kind: 'work_report' }),
      () => ok(null),
    ]) {
      await load({ one });
      await open('014');
      expect(text(row('014'))).toContain('이 발주를 불러오지 못했습니다.');
      expect(row('014').querySelector('dl')).toBeNull();
      expect(act('receive')).toBeNull();
      expect(rowIds().length).toBe(4);
    }
  });
});

describe('입고 처리 · 발주 취소', () => {
  test('「입고 처리」 — 되물은 뒤에만 보낸다. 「그대로 두기」는 아무것도 보내지 않는다', async () => {
    const calls = await load();
    await open('014');
    await press(act('receive'));
    expect(calls.fetch.filter((c) => c.method === 'PATCH')).toEqual([]);
    expect(text(row('014').querySelector('.oo-ask p'))).toBe(
      '이 발주를 입고로 바꿀까요? 오늘이 입고한 날로 남습니다. 이 화면에서는 되돌릴 수 없습니다.'
    );
    expect(text(act('yes'))).toBe('입고 처리');
    expect(text(act('no'))).toBe('그대로 두기');
    expect(act('receive')).toBeNull();
    await press(act('no'));
    expect(row('014').querySelector('.oo-ask')).toBeNull();
    expect(act('receive')).not.toBeNull();
    expect(calls.fetch.filter((c) => c.method === 'PATCH')).toEqual([]);

    await press(act('receive'));
    await press(act('yes'));
    const sent = calls.fetch.filter((c) => c.method === 'PATCH');
    expect(sent.length).toBe(1);
    expect(sent[0].url).toBe(WORK + '/reports/014');
    expect(sent[0].body).toEqual({ status: 'received' });
    expect(sent[0].auth).toBe('Bearer tok-1');
    expect(sent[0].type).toBe('application/json');
    // 발주 중 목록을 다시 읽는다 — 입고한 줄은 빠진다
    expect(asked(calls).slice(-1)).toEqual(['GET ' + LIST + '&status=ordered&page=1']);
    expect(msg()).toBe('입고 처리했습니다.');
    expect(rowIds()).toEqual(['015', '012', '016']);
    expect(box().querySelectorAll('.ad-detail').length).toBe(0);
    expect(box().hasAttribute('aria-busy')).toBe(false);
    await press(filterBtn('received'));
    expect(rowIds()).toEqual(['014']);
    expect(msg()).toBe('');
  });

  test('「발주 취소」 — 되묻는 글이 다르고, 취소로 보낸다', async () => {
    const calls = await load();
    await open('012');
    await press(act('cancel'));
    expect(text(row('012').querySelector('.oo-ask p'))).toBe(
      '이 외주 발주를 취소로 바꿀까요? (기록은 남습니다) 이 화면에서는 되돌릴 수 없습니다.'
    );
    expect(text(act('yes'))).toBe('발주 취소');
    await press(act('yes'));
    const sent = calls.fetch.filter((c) => c.method === 'PATCH');
    expect(sent.map((c) => [c.url, c.body])).toEqual([
      [WORK + '/reports/012', { status: 'cancelled' }],
    ]);
    expect(msg()).toBe('발주를 취소로 바꿨습니다.');
    expect(rowIds()).toEqual(['014', '015', '016']);
  });

  test('전체 목록에서 바꾸면 — 줄은 남고 상태 · 입고한 날이 바뀌며 단추가 사라진다', async () => {
    await load();
    await press(filterBtn(''));
    await open('015');
    await press(act('receive'));
    await press(act('yes'));
    expect(rowIds()).toEqual(['014', '015', '012', '016']);
    expect(text(row('015').querySelector('.oo-status'))).toBe('입고');
    expect(facts('015')['상태']).toBe('입고');
    expect(facts('015')['입고한 날']).toBe('11/11(수)');
    expect(row('015').querySelector('.rd-acts')).toBeNull();
    expect(msg()).toBe('입고 처리했습니다.');
  });

  test('서버가 거절하면 — 그 줄에 서버 글을 남기고, 되묻는 칸은 그대로 둔다 (목록은 다시 읽지 않는다)', async () => {
    const calls = await load({
      patch: () => fail(403, 'forbidden', '관리자(admin 이상)만 바꿀 수 있습니다'),
    });
    await open('014');
    await press(act('receive'));
    const n = asked(calls).length;
    await press(act('yes'));
    expect(asked(calls).slice(n)).toEqual(['PATCH /reports/014']);
    const err = row('014').querySelector('[data-err]');
    expect(err.hidden).toBe(false);
    expect(err.getAttribute('role')).toBe('alert');
    expect(text(err)).toBe('관리자(admin 이상)만 바꿀 수 있습니다');
    expect(row('014').querySelector('.oo-ask')).not.toBeNull();
    expect(act('yes').disabled).toBe(false);
    expect(msg()).toBe('');
    expect(facts('014')['상태']).toBe('발주');
  });

  test('끊기거나 글 없는 오류 — 기본 글', async () => {
    for (const patch of [() => new Error('끊김'), () => ({ ok: false, status: 500, body: {} })]) {
      await load({ patch });
      await open('014');
      await press(act('cancel'));
      await press(act('yes'));
      expect(text(row('014').querySelector('[data-err]'))).toBe(
        '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.'
      );
      expect(rowIds().length).toBe(4);
    }
  });

  test('바꾼 뒤 목록을 못 읽으면 — 못 읽었다는 글을 보이고 화면은 남는다', async () => {
    let n = 0;
    await load({
      list: () => {
        n += 1;
        return n === 1 ? ok({ items: ROWS(), hasMore: false, scope: 'all' }) : fail(500, 'x', '');
      },
    });
    await open('014');
    await press(act('receive'));
    await press(act('yes'));
    expect(seen('outsourceOrders')).toBe(true);
    expect(rows().length).toBe(0);
    expect(text(box())).toContain('발주 목록을 불러오지 못했습니다. 잠시 뒤 다시 해 주세요.');
    expect(msg()).toBe('입고 처리했습니다.');
  });
});

describe('안 보이는 때', () => {
  test('다담 본사 구성원 · Manager 업체 — 묻지 않는다', async () => {
    for (const partner of [
      ok({ company: null, application: null, members: [], invites: [], platform_member: true }),
      partnerOf('manager', 'owner'),
    ]) {
      const calls = await load({ partner });
      expect(asked(calls)).toEqual([]);
      expect(seen('outsourceOrders')).toBe(false);
      expect(document.querySelector('a[data-me-part="p-outsource"]')).toBeNull();
    }
  });

  test('업체가 없는 사람 · 로그인하지 않은 사람 — 묻지 않는다', async () => {
    const none = await load({
      partner: ok({ company: null, application: null, members: [], invites: [] }),
    });
    expect(asked(none)).toEqual([]);
    expect(seen('outsourceOrders')).toBe(false);
    const out = await load({ session: null });
    expect(asked(out)).toEqual([]);
    expect(seen('outsourceOrders')).toBe(false);
  });

  test('목록을 못 읽으면(403 · 오류 · 끊김 · 목록 없는 답) — 칸째 감추고 구역 단추도 없다', async () => {
    for (const list of [
      () => fail(403, 'forbidden', '볼 수 없습니다'),
      () => ({ ok: false, status: 500, body: {} }),
      () => new Error('끊김'),
      () => ok({ hasMore: false }),
      () => ok({ items: 'x' }),
      () => ok(null),
    ]) {
      const calls = await load({ list });
      expect(asked(calls)).toEqual(['GET ' + LIST + '&status=ordered&page=1']);
      expect(seen('outsourceOrders')).toBe(false);
      expect(box().hidden).toBe(true);
      expect(box().innerHTML).toBe('');
      expect(document.querySelector('a[data-me-part="p-outsource"]')).toBeNull();
    }
  });

  test('워커 주소가 없으면 묻지 않는다', async () => {
    const O = mod();
    document.body.innerHTML =
      '<section id="partner" hidden><div id="outsourceOrders"></div></section>';
    window.DADAM_CONFIG = {};
    window.fetch = jest.fn();
    await O.load(null, SESSION, { hq_member: true });
    expect(window.fetch).not.toHaveBeenCalled();
    expect($('outsourceOrders').hidden).toBe(true);
    expect($('partner').hidden).toBe(true);
  });
});
