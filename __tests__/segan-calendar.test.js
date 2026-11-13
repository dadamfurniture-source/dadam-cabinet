/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「프로젝트 관리」 대시보드의 업무 달력 (segan/calendar.js + segan/me.html #meCalendar)
 *
 *   누가    다담 공장 구성원 · Manager · Expert · Agent 협력업체 구성원 (account-api GET /partner/me)
 *           업체 없음 → 묻지도 않고 칸이 없다. 서버 403 → 칸째 감춘다. 프로젝트 관리 대시보드(#dash-project)에서만 보인다
 *   데이터  workflow-api GET /company/schedules?from=&to= (본인 토큰) → { can_manage, today, truncated, items }
 *   보기    월(여섯 주) · 주 · 목록, ‹ 오늘 ›, 종류 켜고 끄기, 날을 누르면 그날 일정
 *   넣기    can_manage 일 때 「일정 더하기」 → GET /company/designs → POST /designs/:id/schedules
 *   고치기  can_manage 일 때 일정 표의 줄 「고치기」 → PATCH /schedules/:id (바뀐 것만)
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
const P1 = '22222222-2222-4222-8222-222222222221';
const S1 = '55555555-5555-4555-8555-555555555551';
const S2 = '55555555-5555-4555-8555-555555555552';
const D1 = '66666666-6666-4666-8666-666666666661';
const D2 = '66666666-6666-4666-8666-666666666662';
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

const item = (extra) => ({
  at: null,
  time: null,
  title: '',
  status: '',
  location: null,
  design: null,
  order_no: null,
  amount: null,
  project: null,
  ...extra,
});
const ITEMS = [
  item({
    key: 'schedule:' + S1,
    source: 'schedule',
    id: S1,
    kind: 'install',
    type: 'installation',
    label: '설치',
    day: '2026-11-10',
    at: '2026-11-10T01:00:00Z',
    time: '10:00',
    title: '설치 1차',
    status: 'scheduled',
    location: '대구광역시 북구',
    design: { id: D1, name: '싱크대 A' },
    order_no: 'DD-1',
    project: { id: P1, title: '싱크대' },
    duration_min: 60,
    assignee_name: '설치 1팀',
  }),
  item({
    key: 'consult:c1',
    source: 'consult',
    id: 'c1',
    kind: 'sales',
    type: 'consult',
    label: '상담 희망일',
    day: '2026-11-10',
    time: '오후 2~4시',
    title: '싱크대 상담',
    status: 'assigned',
    location: '대구광역시 북구',
  }),
  item({
    key: 'payment:p1',
    source: 'payment',
    id: 'p1',
    kind: 'sales',
    type: 'payment_deposit',
    label: '계약금 받을 날',
    day: '2026-11-12',
    title: '싱크대',
    status: 'due',
    amount: 1500000,
    order_no: 'DD-1',
    project: { id: P1, title: '싱크대' },
  }),
  item({
    key: 'as:a1',
    source: 'as',
    id: 'a1',
    kind: 'as',
    type: 'as_request',
    label: 'A/S 접수',
    day: '2026-11-20',
    title: '문짝 처짐',
    status: 'requested',
    order_no: 'DD-0',
  }),
  item({
    key: 'schedule:' + S2,
    source: 'schedule',
    id: S2,
    kind: 'make',
    type: 'manufacturing_start',
    label: '제작 착수',
    day: '2026-12-03',
    at: '2026-12-03T00:00:00Z',
    time: '09:00',
    title: '제작 착수',
    status: 'cancelled',
    design: { id: D1, name: '싱크대 A' },
  }),
  { key: 'x:1', kind: 'purchase', day: '2026-11-10' }, // 모르는 종류 — 뺀다
  { key: 'x:2', kind: 'sales', day: '11-10' }, // 날이 아니다 — 뺀다
];
const sched = (extra = {}) => ({
  company: { id: CO, name: '다담 협력 주방' },
  can_manage: true,
  range: { from: '2026-11-01', to: '2026-12-12' },
  today: '2026-11-10',
  truncated: false,
  items: ITEMS,
  ...extra,
});
const DESIGNS = {
  items: [
    { id: D1, name: '싱크대 A', project_id: P1 },
    { id: D2, name: '', project_id: null },
    { id: 'not-a-uuid', name: '빼는 줄', project_id: null },
  ],
};
const PROJECTS = {
  company: { id: CO, name: '다담 협력 주방', kind: 'partner', plan: 'expert' },
  can_manage: true,
  items: [
    {
      id: P1,
      title: '싱크대',
      status: 'active',
      created_at: '2026-10-10T00:00:00Z',
      closed_at: null,
      customer: null,
      design_count: 1,
    },
  ],
};

/**
 * me.html 을 올린다 (#dash-project).
 * opts.sched(url) → GET /company/schedules 응답, opts.designs() → GET /company/designs,
 * opts.add(body, url) → POST /designs/:id/schedules, opts.patch(body, url) → PATCH /schedules/:id (Error 면 끊김)
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: partnerMe(),
    hash: '#dash-project',
    sched: () => ok(sched()),
    designs: () => ok(DESIGNS),
    add: () => ok({ batch_id: 'b1', schedules: [{ id: S2 }], slack: null }, 201),
    patch: () => ok({ id: S1 }),
    shifts: () => fail(404, 'not_found', 'x'),
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/me.html' + opts.hash);
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of [
    'AdminAccess',
    'DetailDesignAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganMake',
    'SeganMe',
    'SeganPartner',
    'SeganPartnerProjects',
    'SeganCalendar',
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
    const body = init.body ? JSON.parse(init.body) : undefined;
    const method = init.method || 'GET';
    calls.fetch.push({ url, method, auth: (init.headers || {}).Authorization, body });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url.startsWith(WORK + '/company/schedules')) return reply(await opts.sched(url));
    if (url.startsWith(WORK + '/company/shifts')) return reply(await opts.shifts(url));
    if (url === WORK + '/company/designs') return reply(await opts.designs());
    if (url === WORK + '/company/projects') return reply(ok(PROJECTS));
    if (url.startsWith(WORK + '/designs/') && url.endsWith('/schedules'))
      return reply(await opts.add(body, url));
    if (url.startsWith(WORK + '/schedules/')) return reply(await opts.patch(body, url));
    if (url === PAY + '/subscription') return reply(ok({ plan: 'free', status: 'active' }));
    if (url === PAY + '/plans') return reply(ok({ client_key: 'k', plans: [] }));
    if (url === WORK + '/me/projects') return reply(fail(404, 'not_found', 'x'));
    return reply(ok({ ready: true, worker: null })); // /work/me
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
    'segan/calendar.js',
    'segan/shell.js',
    'segan/make.js',
    'segan/me.js',
  ])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganMe.ready;
  return calls;
}

/** 달력 스크립트만 올린다 — 순수 함수 시험 */
function lib() {
  delete window.SeganCalendar;
  (0, eval)(read('segan/calendar.js'));
  return window.SeganCalendar;
}

const $ = (id) => document.getElementById(id);
const box = () => $('meCalendar');
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const schedCalls = (calls) =>
  calls.fetch.filter((f) => f.url.startsWith(WORK + '/company/schedules'));
const click = async (sel) => {
  box().querySelector(sel).click();
  await flush();
};
const cell = (day) => box().querySelector(`.cal-day[data-day="${day}"]`);
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
// 그날 일정 · 목록의 줄 — '시각 이름 | 종류 · … | 상태'
const rows = () =>
  [...box().querySelectorAll('.cal-item')].map((li) =>
    [...li.querySelectorAll('b, small, .me-badge')].map(text).join(' | ')
  );
const kinds = () =>
  [...box().querySelectorAll('.cal-kind')].map(
    (b) => text(b) + (b.getAttribute('aria-pressed') === 'true' ? '' : ' (끔)')
  );
const setValue = (name, v) => {
  box().querySelector(`form [name="${name}"]`).value = v;
};
const submit = async () => {
  box()
    .querySelector('form[data-form]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
};
const formErr = () => {
  const el = box().querySelector('form [data-err]');
  return el && !el.hidden ? el.textContent : '';
};

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 대시보드(#meDash) 안, 칸(#meDashBody) 아래, 처음엔 감춘다 · 프로젝트 칸 다음에 읽는다 · 서비스 워커가 담는다', () => {
    const html = read('segan/me.html');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const el = doc.getElementById('meCalendar');
    expect(el).not.toBeNull();
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('meDash');
    // 대시보드 칸 → 우리 팩토리 숫자(segan/company-summary.js) → 업무 달력
    expect(el.previousElementSibling.id).toBe('meNumbers');
    expect(el.previousElementSibling.previousElementSibling.id).toBe('meDashBody');
    expect(el.getAttribute('aria-label')).toBe('업무 달력');
    const at = (name) => html.indexOf('src="' + name);
    expect(at('calendar.js')).toBeGreaterThan(at('partner-projects.js'));
    expect(at('me.js')).toBeGreaterThan(at('calendar.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'calendar.js')");
  });

  test('종류 색 — 스타일에 다섯이 있다 (바꾸면 색각 검사를 다시 한다)', () => {
    const css = read('segan/shell.css');
    for (const line of [
      '--cal-sales: #2f6fb0;',
      '--cal-design: #8a7ff4;',
      '--cal-make: #c96a2b;',
      '--cal-install: #1f9a86;',
      '--cal-as: #9b3b3b;',
    ])
      expect(css).toContain(line);
    expect(css).toContain('.cal-sw--design {');
    expect(lib().KINDS).toEqual(['sales', 'design', 'make', 'install', 'as']); // 업무 흐름 차례
    expect(lib().KIND_LABEL.design).toBe('설계');
  });
});

describe('날짜 (순수 함수)', () => {
  test('한국 날짜 · 더하기 · 요일', () => {
    const L = lib();
    expect(L.kstToday(Date.parse('2026-11-09T14:59:59Z'))).toBe('2026-11-09');
    expect(L.kstToday(Date.parse('2026-11-09T15:00:00Z'))).toBe('2026-11-10');
    expect(L.addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(L.addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(L.weekdayOf('2026-11-10')).toBe(2); // 화
    expect(L.isDay('2026-11-10')).toBe(true);
    expect(L.isDay('2026-11-1')).toBe(false);
    expect(L.isDay(null)).toBe(false);
  });

  test('월 달력 여섯 주 · 주 · 물을 기간', () => {
    const L = lib();
    const nov = L.monthGrid('2026-11-10');
    expect(nov).toHaveLength(42);
    expect([nov[0], nov[41]]).toEqual(['2026-11-01', '2026-12-12']); // 11월 1일이 일요일
    const oct = L.monthGrid('2026-10-31');
    expect([oct[0], oct[41]]).toEqual(['2026-09-27', '2026-11-07']);
    expect(L.weekDays('2026-11-10')).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ]);
    expect(L.rangeOf('month', '2026-11-10')).toEqual({ from: '2026-11-01', to: '2026-12-12' });
    expect(L.rangeOf('list', '2026-11-10')).toEqual({ from: '2026-11-01', to: '2026-12-12' });
    expect(L.rangeOf('week', '2026-11-10')).toEqual({ from: '2026-11-08', to: '2026-11-14' });
  });

  test('‹ › — 월 · 목록은 앞뒤 달 1일, 주는 7일 · 머리글', () => {
    const L = lib();
    expect(L.moveCursor('month', '2026-12-15', 1)).toBe('2027-01-01');
    expect(L.moveCursor('month', '2026-01-31', -1)).toBe('2025-12-01');
    expect(L.moveCursor('list', '2026-03-31', 1)).toBe('2026-04-01');
    expect(L.moveCursor('week', '2026-11-10', 1)).toBe('2026-11-17');
    expect(L.moveCursor('week', '2026-11-03', -1)).toBe('2026-10-27');
    expect(L.titleOf('month', '2026-11-10')).toBe('2026년 11월');
    expect(L.titleOf('list', '2026-01-01')).toBe('2026년 1월');
    expect(L.titleOf('week', '2026-11-10')).toBe('2026년 11월 8일 ~ 11월 14일');
    expect(L.titleOf('week', '2026-12-30')).toBe('2026년 12월 27일 ~ 1월 2일');
    expect(L.scheduledAtOf('2026-11-12', '14:00')).toBe('2026-11-12T14:00:00+09:00');
  });
});

describe('판정 · 본문 (순수 함수)', () => {
  test('누가 보나 — 프로젝트 칸과 같다', () => {
    const L = lib();
    expect(L.canSee({ company: company() })).toBe(true);
    expect(L.canSee({ company: company({ plan: 'manager', role: 'staff' }) })).toBe(true);
    expect(L.canSee({ company: company({ plan: 'agent', role: 'manager' }) })).toBe(true);
    expect(L.canSee({ hq_member: true, company: null })).toBe(true);
    expect(L.canSee({ company: null })).toBe(false);
    expect(L.canSee({ company: company({ plan: 'free' }) })).toBe(false);
    expect(L.canSee({ company: company({ role: 'guest' }) })).toBe(false);
    expect(L.canSee(null)).toBe(false);
    expect(L.canSee([])).toBe(false);
  });

  test('응답 → 모양이 맞는 줄만 · 날마다 시각 차례 · 종류 수', () => {
    const L = lib();
    expect(L.dataOf(null)).toBeNull();
    expect(L.dataOf({ success: false, data: sched() })).toBeNull();
    expect(L.dataOf({ success: true, data: { items: 'x' } })).toBeNull();
    const d = L.dataOf({ success: true, data: sched() });
    expect(d.manage).toBe(true);
    expect(d.today).toBe('2026-11-10');
    expect(d.items.map((x) => x.key)).toEqual([
      'schedule:' + S1,
      'consult:c1',
      'payment:p1',
      'as:a1',
      'schedule:' + S2,
    ]);
    const all = { sales: true, design: true, make: true, install: true, as: true };
    const map = L.byDay(d.items, all);
    expect(map['2026-11-10'].map((x) => x.kind)).toEqual(['sales', 'install']); // 시각 없는 줄이 먼저
    // 시각 차례 — 종류가 달라도 이른 것이 위, 같은 시각이면 종류 차례
    const at = (kind, time) => ({ kind, time, day: '2026-11-11' });
    const mixed = [
      at('sales', '14:00'),
      at('as', '09:00'),
      at('install', '09:00'),
      at('make', null),
      at('design', null),
    ];
    expect(L.byDay(mixed, all)['2026-11-11'].map((x) => x.kind)).toEqual([
      'design',
      'make',
      'install',
      'as',
      'sales',
    ]);
    expect(Object.keys(L.byDay(d.items, { ...all, sales: false })).sort()).toEqual([
      '2026-11-10',
      '2026-11-20',
      '2026-12-03',
    ]);
    expect(L.countKinds(d.items, L.monthGrid('2026-11-10'))).toEqual({
      sales: 2,
      design: 0,
      make: 1,
      install: 1,
      as: 1,
    });
    expect(L.countKinds(d.items, L.weekDays('2026-11-10'))).toEqual({
      sales: 2,
      design: 0,
      make: 0,
      install: 1,
      as: 0,
    });
  });

  test('「열기」가 가는 화면 · 둘째 줄', () => {
    const L = lib();
    const by = Object.fromEntries(ITEMS.slice(0, 5).map((x) => [x.key, x]));
    expect(L.openOf(by['consult:c1'])).toBe('p-consult');
    expect(L.openOf(by['payment:p1'])).toBe('p-contract');
    expect(L.openOf(by['schedule:' + S1])).toBe('p-install');
    expect(L.openOf(by['schedule:' + S2])).toBe('p-make');
    expect(L.openOf(by['as:a1'])).toBe('p-as');
    expect(L.openOf({ source: 'schedule', kind: 'sales' })).toBe('p-consult'); // 실측
    expect(L.openOf(null)).toBe('');
    // 설계 마감 = 계약금 입금날 — 설계 화면으로, 상태는 받았는지
    const due = {
      key: 'design_due:o1',
      source: 'design_due',
      kind: 'design',
      type: 'design_due',
      label: '설계 마감',
      day: '2026-11-12',
      status: 'deposit_paid',
      design: { id: D1, name: '싱크대 A' },
      project: { id: P1, title: '싱크대' },
      order_no: 'DD-1',
      amount: null,
    };
    expect(L.openOf(due)).toBe('p-design');
    expect(L.statusOf(due)).toBe('계약금 입금');
    expect(L.statusOf({ ...due, status: 'deposit_due' })).toBe(''); // 「입금 예정」은 없다 — 입금된 뒤에만
    expect(L.statusOf({ ...due, status: 'x' })).toBe('');
    expect(L.detailOf(due)).toBe('싱크대 · 설계 싱크대 A · 수주 DD-1'); // 금액은 없다
    expect(L.detailOf(by['schedule:' + S1])).toBe(
      '설치 1차 · 싱크대 · 설계 싱크대 A · 대구광역시 북구 · 수주 DD-1 · 담당 설치 1팀'
    );
    expect(L.detailOf(by['payment:p1'])).toBe('싱크대 · 싱크대 · 수주 DD-1 · 1,500,000원');
    expect(L.detailOf(by['schedule:' + S2])).toBe('설계 싱크대 A'); // 이름이 종류 이름과 같으면 뺀다
  });

  test('설계 묶기 — 프로젝트마다, 프로젝트 없는 설계는 맨 뒤', () => {
    const L = lib();
    const designs = L.designsOf({ success: true, data: DESIGNS });
    expect(designs.map((d) => d.id)).toEqual([D1, D2]);
    expect(L.designsOf({ success: true, data: {} })).toBeNull();
    const groups = L.designGroups(designs, PROJECTS.items);
    expect(groups.map((g) => [g.title, g.designs.map((d) => d.id)])).toEqual([
      ['싱크대', [D1]],
      ['프로젝트 없는 설계', [D2]],
    ]);
  });

  test('넣기 · 고치기 본문 — 서버와 같은 검사, 고치기는 바뀐 것만', () => {
    const L = lib();
    const v = { design_id: D1, type: 'installation', date: '2026-11-12', time: '14:00', title: '' };
    expect(L.addBodyOf(v)).toEqual({
      designId: D1,
      body: { items: [{ type: 'installation', scheduled_at: '2026-11-12T14:00:00+09:00' }] },
    });
    expect(L.addBodyOf({ ...v, title: '  설치 1차 ' }).body.items[0].title).toBe('설치 1차');
    expect(L.addBodyOf({ ...v, design_id: '' })).toEqual({
      error: L.TEXT.pickDesign,
      field: 'design_id',
    });
    expect(L.addBodyOf({ ...v, type: 'party' }).field).toBe('type');
    expect(L.addBodyOf({ ...v, date: '' }).field).toBe('date');
    expect(L.addBodyOf({ ...v, time: '25:00' }).field).toBe('time');
    expect(L.addBodyOf({ ...v, title: 'ㄱ'.repeat(201) }).field).toBe('title');

    const x = { day: '2026-11-10', time: '10:00', status: 'scheduled' };
    const same = { date: '2026-11-10', time: '10:00', status: 'scheduled' };
    expect(L.editBodyOf(x, same)).toEqual({ body: null });
    expect(L.editBodyOf(x, { ...same, status: 'confirmed' })).toEqual({
      body: { status: 'confirmed' },
    });
    expect(L.editBodyOf(x, { ...same, time: '13:30' })).toEqual({
      body: { scheduled_at: '2026-11-10T13:30:00+09:00' },
    });
    expect(L.editBodyOf(x, { ...same, date: '2026-11-11', status: 'completed' })).toEqual({
      body: { scheduled_at: '2026-11-11T10:00:00+09:00', status: 'completed' },
    });
    expect(L.editBodyOf(x, { ...same, date: '' }).field).toBe('date');
    expect(L.editBodyOf(x, { ...same, status: 'zzz' }).field).toBe('status');
  });
});

describe('누가 보나', () => {
  test('업체 구성원 — 이번 달 여섯 주를 본인 토큰으로 묻고, 프로젝트 관리 대시보드에서 보인다', async () => {
    const calls = await load();
    const got = schedCalls(calls);
    expect(got).toHaveLength(1);
    expect(got[0].url).toBe(WORK + '/company/schedules?from=2026-11-01&to=2026-12-12');
    expect(got[0].auth).toBe('Bearer tok-1');
    expect(box().hidden).toBe(false);
    expect(box().classList.contains('me-off')).toBe(false);
    expect(box().querySelector('.cal-title').textContent).toBe('2026년 11월');
  });

  test('다른 화면에서는 감춘다 (me-off) — 대시보드로 돌아오면 다시 보인다', async () => {
    await load({ hash: '#p-install' });
    expect(box().hidden).toBe(false); // 읽기는 했다
    expect(box().classList.contains('me-off')).toBe(true);
    window.location.hash = '#dash-project';
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(box().classList.contains('me-off')).toBe(false);
  });

  test('업체 없는 회원(고객) — 묻지도 않는다', async () => {
    const calls = await load({
      partner: ok({ company: null, application: null, members: [], invites: [] }),
    });
    expect(schedCalls(calls)).toHaveLength(0);
    expect(box().hidden).toBe(true);
    expect(box().innerHTML).toBe('');
  });

  test('서버 403 · 끊김 · 모양이 틀림 → 칸째 감춘다', async () => {
    await load({ sched: () => fail(403, 'not_member', '업체 구성원이 아닙니다') });
    expect(box().hidden).toBe(true);
    await load({ sched: () => new Error('offline') });
    expect(box().hidden).toBe(true);
    await load({ sched: () => ok({ items: null }) });
    expect(box().hidden).toBe(true);
  });

  test('서버의 오늘이 다른 달이면 그 달을 다시 묻는다', async () => {
    const calls = await load({
      sched: (url) => ok(sched({ today: '2026-12-01', items: url.includes('11-29') ? [] : ITEMS })),
    });
    expect(schedCalls(calls).map((f) => f.url.split('?')[1])).toEqual([
      'from=2026-11-01&to=2026-12-12',
      'from=2026-11-29&to=2027-01-09',
    ]);
    expect(box().querySelector('.cal-title').textContent).toBe('2026년 12월');
    expect(cell('2026-12-01').getAttribute('aria-current')).toBe('date');
  });
});

describe('월 보기', () => {
  test('칸 42개 · 오늘 · 고른 날 · 다른 달 · 일정 수 읽어 주기', async () => {
    await load();
    expect(box().querySelectorAll('.cal-day')).toHaveLength(42);
    expect(box().querySelectorAll('.cal-wd')).toHaveLength(7);
    const today = cell('2026-11-10');
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(today.getAttribute('aria-pressed')).toBe('true');
    expect(today.getAttribute('aria-label')).toBe('11월 10일 화요일, 오늘, 일정 2건');
    expect(cell('2026-11-11').getAttribute('aria-label')).toBe('11월 11일 수요일, 일정 없음');
    expect(cell('2026-11-11').hasAttribute('aria-current')).toBe(false);
    expect(cell('2026-12-03').classList.contains('cal-day--out')).toBe(true);
    expect(cell('2026-11-30').classList.contains('cal-day--out')).toBe(false);
    // 네모 자리는 종류 차례로 다섯 — 없는 종류는 빈 자리
    expect([...today.querySelectorAll('.cal-dots i')].map((i) => i.className)).toEqual([
      'cal-sw cal-sw--sales',
      'cal-sw cal-sw--none',
      'cal-sw cal-sw--none',
      'cal-sw cal-sw--install',
      'cal-sw cal-sw--none',
    ]);
    expect([...today.querySelectorAll('.cal-chip')].map(text)).toEqual(['상담 희망일', '설치']);
  });

  test('설계 마감 — 계약금 입금날에 설계 색 네모 · 상태 · 「열기」는 설계 화면', async () => {
    const due = (id, day, status) =>
      item({
        key: 'design_due:' + id,
        source: 'design_due',
        id,
        kind: 'design',
        type: 'design_due',
        label: '설계 마감',
        day,
        status,
        design: { id: D1, name: '싱크대 A' },
        project: { id: P1, title: '싱크대' },
        order_no: 'DD-1',
      });
    await load({
      sched: () =>
        ok(
          sched({
            can_manage: false,
            items: [
              due('o1', '2026-11-10', 'deposit_paid'),
              due('o2', '2026-11-18', 'deposit_paid'),
            ],
          })
        ),
    });
    expect(kinds()).toEqual(['영업0', '설계2', '생산0', '설치0', 'A/S0']);
    expect([...cell('2026-11-10').querySelectorAll('.cal-dots i')].map((i) => i.className)[1]).toBe(
      'cal-sw cal-sw--design'
    );
    expect(rows()).toEqual(['설계 마감 | 설계 · 싱크대 · 설계 싱크대 A · 수주 DD-1 | 계약금 입금']);
    const go = box().querySelector('.cal-item .cal-link');
    expect(go.getAttribute('data-me-go')).toBe('p-design');
    expect(box().querySelector('[data-act="edit"]')).toBeNull(); // 일정 표의 줄이 아니다 — 고치기 없음
    await click('.cal-day[data-day="2026-11-18"]');
    expect(rows()).toEqual(['설계 마감 | 설계 · 싱크대 · 설계 싱크대 A · 수주 DD-1 | 계약금 입금']);
    await click('.cal-kind[data-kind="design"]');
    expect(rows()).toHaveLength(0);
  });

  test('한 칸에 셋까지 적고 나머지는 +N', async () => {
    const many = [1, 2, 3, 4, 5].map((n) =>
      item({
        key: 'schedule:m' + n,
        source: 'schedule',
        id: 'm' + n,
        kind: 'make',
        type: 'quality_check',
        label: '검수',
        day: '2026-11-17',
        time: '0' + n + ':00',
        status: 'scheduled',
      })
    );
    await load({ sched: () => ok(sched({ items: many })) });
    expect(cell('2026-11-17').querySelectorAll('.cal-chip')).toHaveLength(3);
    expect(cell('2026-11-17').querySelector('.cal-more').textContent).toBe('+2');
  });

  test('그날 일정 — 시각 차례 · 둘째 줄 · 상태 (상담 상태 · 받을 날은 상태를 적지 않는다)', async () => {
    await load();
    expect(box().querySelector('.cal-panel-title').textContent).toBe('11월 10일 (화) · 오늘');
    expect(rows()).toEqual([
      '오후 2~4시 상담 희망일 | 영업 · 싱크대 상담 · 대구광역시 북구',
      '10:00 설치 | 설치 · 설치 1차 · 싱크대 · 설계 싱크대 A · 대구광역시 북구 · 수주 DD-1 · 담당 설치 1팀 | 예정',
    ]);
    await click('.cal-day[data-day="2026-11-12"]');
    expect(cell('2026-11-12').getAttribute('aria-pressed')).toBe('true');
    expect(cell('2026-11-10').getAttribute('aria-pressed')).toBe('false');
    expect(box().querySelector('.cal-panel-title').textContent).toBe('11월 12일 (목)');
    expect(rows()).toEqual(['계약금 받을 날 | 영업 · 싱크대 · 싱크대 · 수주 DD-1 · 1,500,000원']);
    await click('.cal-day[data-day="2026-11-20"]');
    expect(rows()).toEqual(['A/S 접수 | A/S · 문짝 처짐 · 수주 DD-0 | 접수']);
    await click('.cal-day[data-day="2026-11-11"]');
    expect(box().querySelector('.cal-panel .me-empty').textContent).toBe('이날 일정이 없습니다.');
    // 취소한 일정 — 줄은 보이되 흐리게
    await click('.cal-day[data-day="2026-12-03"]');
    expect(box().querySelector('.cal-item').classList.contains('cal-item--off')).toBe(true);
    expect(rows()).toEqual(['09:00 제작 착수 | 생산 · 설계 싱크대 A | 취소']);
  });

  test('「열기」 = 그 일의 하위 화면 · 「고치기」 = 일정 표의 줄만', async () => {
    await load();
    const lis = [...box().querySelectorAll('.cal-item')];
    expect(lis[0].querySelector('a.cal-link').getAttribute('href')).toBe('#p-consult');
    expect(lis[0].querySelector('a.cal-link').getAttribute('data-me-go')).toBe('p-consult');
    expect(lis[0].querySelector('[data-act="edit"]')).toBeNull(); // 상담 희망일은 여기서 못 고친다
    expect(lis[1].querySelector('a.cal-link').getAttribute('href')).toBe('#p-install');
    expect(lis[1].querySelector('[data-act="edit"]').getAttribute('data-id')).toBe(S1);
  });

  test('종류 켜고 끄기 — 수는 그대로, 달력 · 그날 일정에서 빠진다', async () => {
    await load();
    expect(kinds()).toEqual(['영업2', '설계0', '생산1', '설치1', 'A/S1']);
    await click('.cal-kind[data-kind="sales"]');
    expect(kinds()).toEqual(['영업2 (끔)', '설계0', '생산1', '설치1', 'A/S1']);
    expect(rows()).toHaveLength(1);
    expect(cell('2026-11-10').getAttribute('aria-label')).toBe('11월 10일 화요일, 오늘, 일정 1건');
    expect(cell('2026-11-12').querySelectorAll('.cal-chip')).toHaveLength(0);
    await click('.cal-kind[data-kind="sales"]');
    expect(rows()).toHaveLength(2);
  });

  test('대표 · 실장이 아니면 「일정 더하기」 · 「고치기」가 없다', async () => {
    await load({ sched: () => ok(sched({ can_manage: false })) });
    expect(box().querySelector('[data-act="add"]')).toBeNull();
    expect(box().querySelector('[data-act="edit"]')).toBeNull();
    expect(rows()).toHaveLength(2);
  });

  test('일부만 왔으면 알린다', async () => {
    await load({ sched: () => ok(sched({ truncated: true })) });
    expect(box().querySelector('.cal-state').textContent).toBe(window.SeganCalendar.TEXT.truncated);
  });
});

describe('옮기기 · 보기 바꾸기', () => {
  test('› = 다음 달을 묻는다 · ‹ 로 돌아오면 읽어 둔 것을 쓴다 · 오늘', async () => {
    const calls = await load();
    await click('[data-act="next"]');
    expect(schedCalls(calls).map((f) => f.url.split('?')[1])).toEqual([
      'from=2026-11-01&to=2026-12-12',
      'from=2026-11-29&to=2027-01-09',
    ]);
    expect(box().querySelector('.cal-title').textContent).toBe('2026년 12월');
    expect(cell('2026-12-01').getAttribute('aria-pressed')).toBe('true');
    await click('[data-act="prev"]');
    expect(schedCalls(calls)).toHaveLength(2);
    expect(box().querySelector('.cal-title').textContent).toBe('2026년 11월');
    expect(cell('2026-11-01').getAttribute('aria-pressed')).toBe('true');
    await click('[data-act="today"]');
    expect(cell('2026-11-10').getAttribute('aria-pressed')).toBe('true');
    expect(schedCalls(calls)).toHaveLength(2);
  });

  test('옮기다 못 읽으면 그 자리에 글 + 「다시 읽기」 (칸은 그대로)', async () => {
    let n = 0;
    const calls = await load({
      sched: () => (++n === 2 ? fail(500, 'server_error', 'x') : ok(sched())),
    });
    await click('[data-act="next"]');
    expect(box().hidden).toBe(false);
    expect(box().querySelector('.cal-state').textContent).toContain('일정을 읽지 못했습니다.');
    await click('[data-act="retry"]');
    expect(schedCalls(calls)).toHaveLength(3);
    expect(box().querySelector('.cal-state')).toBeNull();
    expect(box().querySelector('.cal-title').textContent).toBe('2026년 12월');
  });

  test('주 — 그 주 7일을 묻고, 줄을 시각과 함께 모두 적는다', async () => {
    const calls = await load();
    await click('[data-act="view"][data-view="week"]');
    expect(schedCalls(calls)[1].url).toBe(
      WORK + '/company/schedules?from=2026-11-08&to=2026-11-14'
    );
    expect(box().querySelector('.cal-title').textContent).toBe('2026년 11월 8일 ~ 11월 14일');
    expect(box().querySelector('[data-view="week"]').getAttribute('aria-pressed')).toBe('true');
    expect(box().querySelectorAll('.cal-day')).toHaveLength(7);
    expect(box().querySelectorAll('.cal-wd')).toHaveLength(0);
    expect(text(cell('2026-11-10').querySelector('.cal-d'))).toBe('화 10');
    expect([...cell('2026-11-10').querySelectorAll('.cal-chip')].map(text)).toEqual([
      '상담 희망일',
      '10:00 설치',
    ]);
    await click('[data-act="next"]');
    expect(schedCalls(calls)[2].url).toBe(
      WORK + '/company/schedules?from=2026-11-15&to=2026-11-21'
    );
  });

  test('목록 — 월과 같은 응답으로, 그 달의 일정 있는 날만 차례로', async () => {
    const calls = await load();
    await click('[data-act="view"][data-view="list"]');
    expect(schedCalls(calls)).toHaveLength(1);
    expect(box().querySelector('.cal-grid')).toBeNull();
    expect([...box().querySelectorAll('.cal-panel-title')].map(text)).toEqual([
      '11월 10일 (화) · 오늘',
      '11월 12일 (목)',
      '11월 20일 (금)',
    ]);
    expect(rows()).toHaveLength(4);
    await click('.cal-kind[data-kind="sales"]');
    await click('.cal-kind[data-kind="install"]');
    await click('.cal-kind[data-kind="as"]');
    expect(box().querySelector('.me-empty').textContent).toBe('이 달 일정이 없습니다.');
  });
});

describe('쉬는 날 (근무 일정) — 색 없이 회색 글', () => {
  const SHIFTS = () => ({
    can_manage: true,
    today: '2026-11-10',
    people: [
      { kind: 'member', id: 'u-1', name: '김대표', role: 'owner' },
      { kind: 'member', id: 'u-2', name: '이직원', role: 'staff' },
      { kind: 'worker', id: 'u-1', name: '', role: 'worker' },
    ],
    items: [
      { person_kind: 'member', person_id: 'u-2', date: '2026-11-10', kind: 'half', note: '병원' },
      { person_kind: 'member', person_id: 'u-1', date: '2026-11-10', kind: 'leave', note: null },
      { person_kind: 'worker', person_id: 'u-1', date: '2026-11-18', kind: 'off', note: null },
      { person_kind: 'member', person_id: 'u-9', date: '2026-11-10', kind: 'off' }, // 모르는 사람 — 뺀다
      { person_kind: 'member', person_id: 'u-1', date: '2026-11-11', kind: 'sick' }, // 모르는 종류 — 뺀다
      { person_kind: 'member', person_id: 'u-1', date: '11-12', kind: 'off' }, // 날이 아니다 — 뺀다
    ],
  });
  const shiftCalls = (calls) =>
    calls.fetch.filter((f) => f.url.startsWith(WORK + '/company/shifts'));
  const offLines = () => [...box().querySelectorAll('.cal-offline')].map(text);
  const agent = () => partnerMe({ plan: 'agent' });

  test('순수 — canOff 는 다담 공장 · Agent 구성원만. offsOf 는 아는 사람 · 종류 · 날만, 이름 차례', () => {
    const L = lib();
    expect(L.canOff({ hq_member: true })).toBe(true);
    expect(L.canOff({ hq_member: true, platform_member: true })).toBe(false);
    expect(L.canOff({ company: { plan: 'agent', role: 'staff' } })).toBe(true);
    for (const plan of ['expert', 'manager', 'free'])
      expect(L.canOff({ company: { plan, role: 'owner' } })).toBe(false);
    expect(L.canOff(null)).toBe(false);
    expect(L.offsOf(ok(SHIFTS()).body)).toEqual({
      '2026-11-10': [
        { name: '김대표', kind: 'leave' },
        { name: '이직원', kind: 'half' },
      ],
      '2026-11-18': [{ name: '이름 없음', kind: 'off' }],
    });
    expect(L.offsOf(fail(409, 'db_pending', 'x').body)).toEqual({});
    expect(L.offsOf(ok({ people: null }).body)).toEqual({});
  });

  test('Agent — 같은 기간을 한 번 물어 날 칸에 「쉼 N」, 그날 일정 위에 누가 쉬는지. 종류 단추 · 색은 그대로', async () => {
    const calls = await load({ partner: agent(), shifts: () => ok(SHIFTS()) });
    expect(shiftCalls(calls).map((c) => c.url)).toEqual([
      WORK + '/company/shifts?from=2026-11-01&to=2026-12-12',
    ]);
    expect(shiftCalls(calls)[0].auth).toBe('Bearer ' + SESSION.access_token);
    expect(text(cell('2026-11-10').querySelector('.cal-off'))).toBe('쉼 2');
    expect(text(cell('2026-11-18').querySelector('.cal-off'))).toBe('쉼 1');
    expect(cell('2026-11-11').querySelector('.cal-off')).toBeNull();
    expect(cell('2026-11-10').getAttribute('aria-label')).toMatch(/, 쉬는 사람 2명$/);
    expect(offLines()).toEqual(['쉬는 사람 김대표 연차 · 이직원 반차']);
    expect(box().querySelectorAll('.cal-kind')).toHaveLength(5);
    expect(box().innerHTML).not.toContain('병원'); // 메모는 싣지 않는다
    // 일정 없는 날 — 쉬는 사람 줄과 「일정이 없습니다」가 같이
    await click('.cal-day[data-day="2026-11-18"]');
    expect(offLines()).toEqual(['쉬는 사람 이름 없음 휴무']);
    expect(box().querySelector('.cal-panel .me-empty').textContent).toBe('이날 일정이 없습니다.');
    // 종류를 모두 꺼도 쉬는 날은 남는다
    for (const k of ['sales', 'design', 'make', 'install', 'as'])
      await click(`.cal-kind[data-kind="${k}"]`);
    expect(text(cell('2026-11-10').querySelector('.cal-off'))).toBe('쉼 2');
  });

  test('목록 — 쉬는 사람만 있는 날도 나온다', async () => {
    await load({ partner: agent(), shifts: () => ok(SHIFTS()) });
    await click('[data-act="view"][data-view="list"]');
    expect([...box().querySelectorAll('.cal-panel-title')].map(text)).toEqual([
      '11월 10일 (화) · 오늘',
      '11월 12일 (목)',
      '11월 18일 (수)',
      '11월 20일 (금)',
    ]);
    expect(offLines()).toEqual(['쉬는 사람 김대표 연차 · 이직원 반차', '쉬는 사람 이름 없음 휴무']);
    expect(rows()).toHaveLength(4);
  });

  test('못 읽으면(DB 전 · 오류 · 끊김) 달력은 그대로, 쉬는 날 글만 없다 · Expert · Manager 는 묻지 않는다', async () => {
    for (const shifts of [
      () => fail(409, 'db_pending', 'x'),
      () => new Error('offline'),
      () => ok({}),
    ]) {
      await load({ partner: agent(), shifts });
      expect(box().hidden).toBe(false);
      expect(rows().length).toBeGreaterThan(0);
      expect(box().querySelector('.cal-off')).toBeNull();
      expect(offLines()).toEqual([]);
    }
    for (const plan of ['expert', 'manager']) {
      const calls = await load({ partner: partnerMe({ plan }), shifts: () => ok(SHIFTS()) });
      expect(shiftCalls(calls)).toHaveLength(0);
      expect(box().querySelector('.cal-off')).toBeNull();
    }
  });
});

describe('일정 더하기', () => {
  test('설계를 읽어 프로젝트로 묶는다 · 날은 고른 날 · 시각 09:00', async () => {
    const calls = await load();
    await click('.cal-day[data-day="2026-11-12"]');
    await click('[data-act="add"]');
    expect(calls.fetch.filter((f) => f.url === WORK + '/company/designs')).toHaveLength(1);
    const form = box().querySelector('form[data-form="add"]');
    expect([...form.querySelectorAll('optgroup')].map((g) => g.label)).toEqual([
      '싱크대',
      '프로젝트 없는 설계',
    ]);
    expect(
      [...form.querySelectorAll('optgroup option')].map((o) => [o.value, o.textContent])
    ).toEqual([
      [D1, '싱크대 A'],
      [D2, '이름 없는 설계'],
    ]);
    expect([...form.querySelectorAll('[name="type"] option')].map((o) => o.textContent)).toEqual([
      '실측',
      '자재 발주',
      '제작 착수',
      '제작 완료',
      '검수',
      '납품',
      '설치',
      'A/S 방문',
    ]);
    expect(form.querySelector('[name="date"]').value).toBe('2026-11-12');
    expect(form.querySelector('[name="time"]').value).toBe('09:00');
    await click('[data-act="close"]');
    expect(box().querySelector('form')).toBeNull();
    await click('[data-act="add"]'); // 다시 열면 설계를 또 묻지 않는다
    expect(calls.fetch.filter((f) => f.url === WORK + '/company/designs')).toHaveLength(1);
  });

  test('설계가 없으면 안내만 · 못 읽으면 글', async () => {
    await load({ designs: () => ok({ items: [] }) });
    await click('[data-act="add"]');
    expect(box().querySelector('form')).toBeNull();
    expect(box().querySelector('.cal-form .mk-note').textContent).toBe(
      window.SeganCalendar.TEXT.noDesign
    );
    await load({ designs: () => fail(500, 'server_error', 'x') });
    await click('[data-act="add"]');
    expect(box().querySelector('.cal-form .mk-note').textContent).toBe(
      window.SeganCalendar.TEXT.designErr
    );
  });

  test('보내기 전 검사 — 설계를 안 고르면 서버에 묻지 않는다 (적은 값은 그대로)', async () => {
    const calls = await load();
    await click('[data-act="add"]');
    setValue('title', '설치 1차');
    await submit();
    expect(formErr()).toBe('설계를 골라 주세요.');
    expect(box().querySelector('form [name="title"]').value).toBe('설치 1차');
    expect(calls.fetch.some((f) => f.method === 'POST')).toBe(false);
  });

  test('넣기 — POST /designs/:id/schedules, 그날로 가서 다시 읽는다', async () => {
    const added = item({
      key: 'schedule:' + S2,
      source: 'schedule',
      id: S2,
      kind: 'install',
      type: 'installation',
      label: '설치',
      day: '2026-12-15',
      time: '14:00',
      title: '설치 2차',
      status: 'scheduled',
    });
    let posted = false;
    const calls = await load({
      sched: () => ok(sched({ items: posted ? [added] : ITEMS })),
      add: () => {
        posted = true;
        return ok({ batch_id: 'b1', schedules: [{ id: S2 }], slack: null }, 201);
      },
    });
    await click('[data-act="add"]');
    setValue('design_id', D1);
    setValue('type', 'installation');
    setValue('date', '2026-12-15');
    setValue('time', '14:00');
    setValue('title', ' 설치 2차 ');
    await submit();
    const post = calls.fetch.find((f) => f.method === 'POST');
    expect(post.url).toBe(WORK + '/designs/' + D1 + '/schedules');
    expect(post.auth).toBe('Bearer tok-1');
    expect(post.body).toEqual({
      items: [
        { type: 'installation', scheduled_at: '2026-12-15T14:00:00+09:00', title: '설치 2차' },
      ],
    });
    expect(schedCalls(calls).map((f) => f.url.split('?')[1])).toEqual([
      'from=2026-11-01&to=2026-12-12',
      'from=2026-11-29&to=2027-01-09',
    ]);
    expect(box().querySelector('.cal-title').textContent).toBe('2026년 12월');
    expect(cell('2026-12-15').getAttribute('aria-pressed')).toBe('true');
    expect(box().querySelector('.me-pt-msg').textContent).toBe('일정을 넣었습니다.');
    expect(box().querySelector('form')).toBeNull();
    expect(rows()).toEqual(['14:00 설치 | 설치 · 설치 2차 | 예정']);
  });

  test('서버가 막으면 그 글을 그 자리에 (적은 값은 그대로)', async () => {
    await load({
      add: () => fail(403, 'not_manager', '일정은 팩토리 대표 · 실장만 넣고 고칠 수 있습니다'),
    });
    await click('[data-act="add"]');
    setValue('design_id', D1);
    setValue('title', '실측');
    await submit();
    expect(formErr()).toBe('일정은 팩토리 대표 · 실장만 넣고 고칠 수 있습니다');
    expect(box().querySelector('form [name="design_id"]').value).toBe(D1);
    expect(box().querySelector('form [name="title"]').value).toBe('실측');
    expect(box().querySelector('form button[type="submit"]').disabled).toBe(false);
  });

  test('끊기면 일반 글', async () => {
    await load({ add: () => new Error('offline') });
    await click('[data-act="add"]');
    setValue('design_id', D1);
    await submit();
    expect(formErr()).toBe(window.SeganCalendar.TEXT.generic);
  });
});

describe('고치기', () => {
  test('칸에 지금 값 · 바뀐 것이 없으면 서버에 묻지 않고 닫는다', async () => {
    const calls = await load();
    await click('[data-act="edit"]');
    const form = box().querySelector('form[data-form="edit"]');
    expect(form.closest('.cal-item').getAttribute('data-key')).toBe('schedule:' + S1);
    expect(form.querySelector('[name="date"]').value).toBe('2026-11-10');
    expect(form.querySelector('[name="time"]').value).toBe('10:00');
    expect(form.querySelector('[name="status"]').value).toBe('scheduled');
    expect([...form.querySelectorAll('[name="status"] option')].map((o) => o.textContent)).toEqual([
      '예정',
      '확정',
      '진행 중',
      '끝남',
      '취소',
    ]);
    await submit();
    expect(calls.fetch.some((f) => f.method === 'PATCH')).toBe(false);
    expect(box().querySelector('form')).toBeNull();
  });

  test('상태만 바꾸면 상태만 보낸다 · 다시 읽는다', async () => {
    const calls = await load();
    await click('[data-act="edit"]');
    setValue('status', 'confirmed');
    await submit();
    const patch = calls.fetch.find((f) => f.method === 'PATCH');
    expect(patch.url).toBe(WORK + '/schedules/' + S1);
    expect(patch.body).toEqual({ status: 'confirmed' });
    expect(schedCalls(calls)).toHaveLength(2);
    expect(box().querySelector('.me-pt-msg').textContent).toBe('일정을 고쳤습니다.');
    expect(box().querySelector('form')).toBeNull();
  });

  test('날 · 시각을 바꾸면 한국 시간으로 보내고 그날로 간다', async () => {
    const calls = await load();
    await click('[data-act="edit"]');
    setValue('date', '2026-11-13');
    setValue('time', '15:30');
    await submit();
    expect(calls.fetch.find((f) => f.method === 'PATCH').body).toEqual({
      scheduled_at: '2026-11-13T15:30:00+09:00',
    });
    expect(cell('2026-11-13').getAttribute('aria-pressed')).toBe('true');
  });

  test('서버가 막으면 그 글을 그 자리에', async () => {
    await load({
      patch: () => fail(403, 'not_manager', '일정은 팩토리 대표 · 실장만 넣고 고칠 수 있습니다'),
    });
    await click('[data-act="edit"]');
    setValue('status', 'completed');
    await submit();
    expect(formErr()).toBe('일정은 팩토리 대표 · 실장만 넣고 고칠 수 있습니다');
    expect(box().querySelector('form [name="status"]').value).toBe('completed');
  });

  test('다른 날을 누르면 고치기 칸을 닫는다', async () => {
    await load();
    await click('[data-act="edit"]');
    await click('.cal-day[data-day="2026-11-12"]');
    expect(box().querySelector('form')).toBeNull();
  });
});

// ── 2026-11-13 프로젝트의 작업 (철거 · 재단 · 엣지 · 조립) ──
describe('프로젝트의 작업', () => {
  const J1 = '99999999-9999-4999-8999-999999999991';
  const work = (extra = {}) =>
    item({
      key: 'work:' + J1,
      source: 'work',
      id: J1,
      kind: 'install',
      type: 'work_demolition',
      label: '철거',
      day: '2026-11-10',
      at: '2026-11-09T23:30:00Z',
      time: '08:30',
      title: null,
      status: 'confirmed',
      assignee_name: '시험기사 가',
      project: { id: P1, title: '싱크대' },
      ...extra,
    });
  const cutting = work({
    key: 'work:j2',
    id: 'j2',
    kind: 'make',
    type: 'work_cutting',
    label: '재단',
    time: '09:00',
    status: 'unassigned',
    assignee_name: null,
  });
  const withWork = (more = {}) => () => ok(sched({ items: [work(), cutting], ...more }));
  const workBtns = () => [...box().querySelectorAll('[data-act="work"]')];

  test('순수 — 상태 글 · 여는 프로젝트 · 「열기」(하위 화면)는 없다', () => {
    const M = lib();
    expect(M.WORK_STATE).toEqual({
      unassigned: '작업자 미정',
      offered: '수락 대기',
      confirmed: '연결됨',
      in_progress: '작업 중',
      review: '완료 보고',
      done: '끝남',
    });
    expect(M.statusOf(work())).toBe('연결됨');
    expect(M.statusOf(work({ status: 'weird' }))).toBe('');
    expect(M.openOf(work())).toBe('');
    expect(M.openOf(cutting)).toBe('');
    expect(M.workProjectOf(work())).toBe(P1);
    expect(M.workProjectOf(work({ project: null }))).toBe('');
    expect(M.workProjectOf(work({ project: { id: 'not-a-uuid', title: 'x' } }))).toBe('');
    expect(M.workProjectOf({ ...work(), source: 'schedule' })).toBe(''); // 일정 줄에는 없다
    expect(M.detailOf(work())).toBe('싱크대 · 담당 시험기사 가');
  });

  test('철거는 설치 색 · 재단은 생산 색 — 줄에 종류 · 프로젝트 · 담당 · 상태. 고치기 · 「열기」는 없다', async () => {
    await load({ sched: withWork() });
    expect(kinds()).toEqual(['영업0', '설계0', '생산1', '설치1', 'A/S0']);
    expect(rows()).toEqual([
      '08:30 철거 | 설치 · 싱크대 · 담당 시험기사 가 | 연결됨',
      '09:00 재단 | 생산 · 싱크대 | 작업자 미정',
    ]);
    expect(box().querySelector('[data-act="edit"]')).toBeNull();
    expect(box().querySelector('.cal-item a.cal-link')).toBeNull();
    // 종류 단추로 끄면 빠진다
    await click('.cal-kind[data-kind="make"]');
    expect(rows()).toEqual(['08:30 철거 | 설치 · 싱크대 · 담당 시험기사 가 | 연결됨']);
  });

  test('「작업 배정」 — 프로젝트 목록의 그 프로젝트 칸을 연다. 목록에 없으면 그 글', async () => {
    await load({ sched: withWork() });
    const open = jest.fn(() => true);
    window.SeganPartnerProjects.openWork = open;
    await click('.cal-day[data-day="2026-11-10"]');
    expect(workBtns().map(text)).toEqual(['작업 배정', '작업 배정']);
    workBtns()[0].click();
    await flush();
    expect(open).toHaveBeenCalledWith(P1);
    expect(box().querySelector('.me-pt-msg')).toBeNull();
    // 목록에 그 프로젝트가 없다 (끝났거나 보관)
    open.mockReturnValue(false);
    workBtns()[1].click();
    await flush();
    expect(text(box().querySelector('.me-pt-msg'))).toBe(
      '아래 프로젝트 목록에 이 프로젝트가 없습니다. 끝났거나 보관한 프로젝트일 수 있습니다.'
    );
    // 다시 열리면 글이 사라진다
    open.mockReturnValue(true);
    workBtns()[0].click();
    await flush();
    expect(box().querySelector('.me-pt-msg')).toBeNull();
  });

  test('직원은 「작업자 보기」 · 프로젝트를 모르는 줄에는 단추가 없다', async () => {
    await load({
      sched: () => ok(sched({ can_manage: false, items: [work(), work({ key: 'work:j3', id: 'j3', project: null })] })),
    });
    window.SeganPartnerProjects.openWork = jest.fn(() => true);
    await click('.cal-day[data-day="2026-11-10"]');
    expect(workBtns().map(text)).toEqual(['작업자 보기']);
  });
});
