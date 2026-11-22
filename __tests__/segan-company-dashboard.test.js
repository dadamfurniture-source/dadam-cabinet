/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element */
/**
 * SEGAN 「프로젝트 관리」 대시보드의 진행 현황 (segan/company-dashboard.js · segan/charts.js + segan/me.html #meNumbers)
 * 2026-11-23 대표님 승인 「프로젝트 관리 새 틀」 — 「우리 팩토리 숫자」를 큰 숫자 넷 + 그래프 넷으로 바꿨다.
 *
 *   누가    프로젝트를 가지는 업체의 대표 · 실장 — 협력업체 Manager · Expert · Agent 의 owner · manager,
 *           다담 공장 구성원(직책은 서버가 가린다). 업체 직원은 묻지도 않는다
 *   데이터  workflow-api GET /company/dashboard (단계마다 쌓인 수 · 걸린 날 · 받을 돈 · 앞 8주 일정 — 금액 포함)
 *   화면    큰 숫자 넷 · 그래프 넷 · 아래 한 줄 — 보기만 한다. 못 읽으면 칸째 감춘다
 *   숫자는 모두 지어낸 것이다
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
const NOW = Date.parse('2026-11-23T03:00:00Z');

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
const company = (plan, role = 'owner', status = 'active') => ({
  id: CO,
  name: '다담 협력 주방',
  plan,
  next_plan: null,
  status,
  sido: '대구광역시',
  gugun: '북구',
  role,
  created_at: '2026-10-01T00:00:00Z',
});
const partnerOf = (plan, role, status) =>
  ok({ company: company(plan, role, status), application: null, members: [], invites: [] });

const mod = () => {
  delete window.SeganCompanyDashboard;
  (0, eval)(read('segan/company-dashboard.js'));
  return window.SeganCompanyDashboard;
};
const charts = () => {
  delete window.SeganCharts;
  (0, eval)(read('segan/charts.js'));
  return window.SeganCharts;
};

const step = (key, label, fresh, slow, stuck) => ({
  key,
  label,
  count: fresh + slow + stuck,
  fresh,
  slow,
  stuck,
});
const dur = (key, label, n, medianDays, prevDays, delta) => ({
  key,
  label,
  n,
  medianDays,
  prevDays,
  delta,
});
const WEEKS = [
  '2026-11-23',
  '2026-11-30',
  '2026-12-07',
  '2026-12-14',
  '2026-12-21',
  '2026-12-28',
  '2027-01-04',
  '2027-01-11',
];
const DATA = (patch = {}) => ({
  company: { id: CO, name: '다담 협력 주방', kind: 'partner', plan: 'agent' },
  today: '2026-11-23',
  thresholds: {
    consult: { slow: 2, stuck: 7 },
    measure: { slow: 2, stuck: 7 },
    design: { slow: 3, stuck: 7 },
    quote: { slow: 3, stuck: 7 },
    contract: { slow: 3, stuck: 7 },
  },
  active: { count: 23, stuck: 4, held: 2 },
  steps: [
    step('consult', '상담', 3, 1, 1),
    step('measure', '실측', 2, 1, 0),
    step('design', '설계', 2, 1, 1),
    step('quote', '견적', 1, 1, 2),
    step('contract', '계약', 1, 1, 0),
    step('make', '생산', 3, 0, 0),
    step('install', '설치', 2, 0, 0),
  ],
  days: {
    window: { days: 90, start: '2026-08-26', end: '2026-11-23' },
    steps: [
      dur('consult', '상담', 6, 2, 2, 0),
      dur('measure', '실측', 5, 4, null, null),
      dur('design', '설계', 5, 6, 7, -1),
      dur('quote', '견적', 4, 9, 6, 3),
      dur('contract', '계약', 3, 3, 3, 0),
      dur('make', '생산', 3, 12, 11.5, 0.5),
      dur('install', '설치', 0, null, 2, null),
    ],
    worst: { key: 'quote', label: '견적', delta: 3 },
  },
  money: {
    backlog: { amount: 84200000, count: 7 },
    overdue: {
      amount: 12600000,
      count: 4,
      orders: 3,
      oldestDays: 72,
      buckets: [
        { key: '1-30', label: '1 ~ 30일', amount: 7800000, count: 2 },
        { key: '31-60', label: '31 ~ 60일', amount: 3200000, count: 1 },
        { key: '61+', label: '61일 넘음', amount: 1600000, count: 1 },
      ],
    },
    upcoming: {
      amount: 29000000,
      weeks: [4200000, 0, 11500000, 3000000, 6800000, 0, 3500000, 0].map((amount, i) => ({
        start: WEEKS[i],
        amount,
        count: amount ? 1 : 0,
      })),
    },
    month: { month: '2026-11', count: 6, amount: 51300000, prevCount: 4, prevAmount: 30000000 },
  },
  load: {
    weeks: WEEKS.map((start, i) => ({
      start,
      make: [2, 1, 3, 2, 1, 1, 0, 0][i],
      install: [1, 2, 1, 3, 2, 1, 1, 0][i],
    })),
  },
  conversion: {
    months: [
      ['2026-06', 8, 3, 37.5],
      ['2026-07', 0, 0, null],
      ['2026-08', 9, 3, 33.3],
      ['2026-09', 7, 3, 42.9],
      ['2026-10', 9, 4, 44.4],
      ['2026-11', 8, 4, 50],
    ].map(([month, issued, ordered, rate]) => ({ month, issued, ordered, rate })),
  },
  install: { done: 14, onTime: 12, onTimeRate: 85.7, overdue: 1 },
  as: { installed: 28, requests: 2, rate: 7.1 },
  ...patch,
});

/** 마이페이지를 띄운다 (기본 = Agent 업체 대표, 프로젝트 관리 대시보드). opts.get() 으로 답을 바꾼다 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: partnerOf('agent', 'owner'),
    hash: '#dash-project',
    get: null,
    work: WORK,
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
    'SeganCompanyDashboard',
    'SeganCharts',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: opts.work },
    paymentsApi: { url: PAY },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [] };
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
    calls.fetch.push({
      url,
      method: init.method || 'GET',
      auth: (init.headers || {}).Authorization,
      cache: init.cache,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/company/dashboard') return reply(opts.get ? await opts.get() : ok(DATA()));
    if (url === WORK + '/company/projects')
      return reply(ok({ company: { id: CO }, can_manage: false, members: [], items: [] }));
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
    'segan/charts.js',
    'segan/company-dashboard.js',
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
const box = () => $('meNumbers');
const part = (name) => box().querySelector(`[data-cd="${name}"]`);
const say = (name) => text(part(name).querySelector('[data-cd="say"]'));
const rows = (root) =>
  [...root.querySelectorAll('.ch-row')].map((r) => [
    text(r.querySelector('.ch-label')),
    text(r.querySelector('.ch-value')),
  ]);
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/company/dashboard'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 대시보드 칸(#meDash) 안, 처음엔 감춘다 · 그래프 → 대시보드 → me.js 차례로 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('meNumbers');
    expect(el).not.toBeNull();
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('meDash');
    expect(el.previousElementSibling.id).toBe('meDashBody');
    expect(el.nextElementSibling.id).toBe('meStockNumbers');
    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('aria-labelledby')).toBe('meNumbersTitle');
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['charts.js', 'company-dashboard.js', 'motion.js', 'me.js'])
      expect(at(name)).toBeGreaterThanOrEqual(0);
    expect(at('charts.js')).toBeLessThan(at('company-dashboard.js'));
    expect(at('company-dashboard.js')).toBeLessThan(at('me.js'));
    // 옛 「우리 팩토리 숫자」는 걷어냈다
    expect(at('company-summary.js')).toBe(-1);
    expect(fs.existsSync(path.join(ROOT, 'segan/company-summary.js'))).toBe(false);
    const sw = read('segan/sw.js');
    expect(sw).toContain("versioned(SCOPE + 'charts.js')");
    expect(sw).toContain("versioned(SCOPE + 'company-dashboard.js')");
    expect(sw).not.toContain('company-summary.js');
  });

  test('등급 · 직책은 서버와 같다. 서버에 그 주소가 있다', () => {
    const S = mod();
    expect(S.PLANS).toEqual(['manager', 'expert', 'agent']);
    expect(S.ROLES).toEqual(['owner', 'manager']);
    expect(read('workers/workflow-api/src/supabase.js')).toContain(
      "MONEY_ROLES = Object.freeze(['owner', 'manager'])"
    );
    expect(read('workers/workflow-api/src/worker.js')).toContain("path: '/company/dashboard'");
  });

  test('보기만 한다 — 서버에 쓰지 않고, 기기에 남기지 않고, 확인 창도 띄우지 않는다', () => {
    for (const file of ['segan/company-dashboard.js', 'segan/charts.js']) {
      const code = read(file)
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .join('\n');
      expect(code).not.toMatch(/method:/); // GET 만
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
      expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
    }
  });
});

describe('순수 함수', () => {
  test('canSee — 다담 공장 구성원 · active 협력업체 Manager · Expert · Agent 의 대표 · 실장만 (직원은 아니다)', () => {
    const S = mod();
    const me = (r) => r.body.data;
    expect(S.canSee(me(HQ))).toBe(true);
    for (const plan of ['manager', 'expert', 'agent']) {
      expect(S.canSee(me(partnerOf(plan, 'owner')))).toBe(true);
      expect(S.canSee(me(partnerOf(plan, 'manager')))).toBe(true);
      expect(S.canSee(me(partnerOf(plan, 'staff')))).toBe(false);
    }
    expect(S.canSee(me(partnerOf('agent', 'owner', 'suspended')))).toBe(false);
    expect(S.canSee(me(partnerOf(null, 'owner')))).toBe(false);
    expect(S.canSee(me(PLATFORM))).toBe(false);
    expect(S.canSee(me(NOBODY))).toBe(false);
    expect(S.canSee(null)).toBe(false);
  });

  test('won · man · dayLabel', () => {
    const S = mod();
    expect(S.won(84200000)).toBe('8,420만 원');
    expect(S.won(12604999)).toBe('1,260만 원');
    expect(S.won(9000)).toBe('9,000원');
    expect(S.won(0)).toBe('0원');
    expect(S.won('x')).toBe('0원');
    expect(S.man(11500000)).toBe('1,150');
    expect(S.dayLabel('2026-12-07')).toBe('12.7');
    expect(S.dayLabel('x')).toBe('');
  });

  test('viewOf — 날짜나 단계 목록이 없으면 null. 숫자가 아닌 값은 0 또는 null, 못 읽은 칸은 null', () => {
    const S = mod();
    expect(S.viewOf(null)).toBeNull();
    expect(S.viewOf({ today: '2026-11-23' })).toBeNull();
    expect(S.viewOf({ today: '11월', steps: [] })).toBeNull();
    const v = S.viewOf({
      today: '2026-11-23',
      steps: [{ key: 'consult', label: '상담', count: '3', fresh: -1 }, { label: '이름만' }],
      money: { overdue: { amount: 'x', oldestDays: null } },
      load: null,
      install: null,
      as: null,
    });
    expect(v.steps).toEqual([
      { key: 'consult', label: '상담', count: 0, fresh: 0, slow: 0, stuck: 0, limit: null },
    ]);
    expect(v.active).toEqual({ count: 0, stuck: 0, held: 0 });
    expect(v.overdue).toMatchObject({ amount: 0, oldest: null, buckets: [] });
    expect([v.load, v.install, v.as, v.worst]).toEqual([null, null, null, null]);
    expect(v.conversion).toEqual([]);
    const full = S.viewOf(DATA());
    expect(full.steps[0].limit).toEqual([2, 7]);
    expect(full.steps[5].limit).toBeNull(); // 생산 — 날수 기준이 없다
    expect(full.worst).toEqual({ key: 'quote', label: '견적', delta: 3 });
    expect(full.load).toHaveLength(8);
  });

  test('한 줄 글 — 멈춘 것이 가장 많은 단계 · 가장 많이 늘어난 단계 · 일정이 가장 많은 주 · 느림 · 멈춤 기준', () => {
    const S = mod();
    const v = S.viewOf(DATA());
    expect(S.stepsSay(v)).toBe('견적에 4건, 그 가운데 2건이 멈춰 있습니다.');
    expect(S.daysSay(v)).toBe('견적 단계가 앞 석 달보다 3일 늘었습니다.');
    expect(S.loadSay(v.load)).toBe('12.14 주가 가장 많습니다 — 제작 착수 2건 · 설치 3건');
    expect(S.ruleSay(v)).toBe(
      '느림 · 멈춤 — 상담 · 실측 2일 · 7일, 설계 · 견적 · 계약 3일 · 7일, 생산 · 설치는 잡은 날이 지나면 멈춤'
    );
    const calm = S.viewOf(
      DATA({
        active: { count: 2, stuck: 0, held: 0 },
        steps: [step('consult', '상담', 2, 0, 0)],
        days: { steps: [dur('consult', '상담', 1, 2, 2, 0)], worst: null },
      })
    );
    expect(S.stepsSay(calm)).toBe('멈춘 프로젝트가 없습니다.');
    expect(S.daysSay(calm)).toBe('앞 석 달보다 늘어난 단계가 없습니다.');
    const none = S.viewOf(
      DATA({ active: { count: 0, stuck: 0, held: 0 }, steps: [], days: { steps: [], worst: null } })
    );
    expect(S.stepsSay(none)).toBe('진행 중인 프로젝트가 없습니다.');
    expect(S.daysSay(none)).toBe('지난 석 달에 끝낸 단계가 아직 없습니다.');
    expect(S.loadSay([{ start: '2026-11-23', make: 0, install: 0 }])).toBe(
      '앞 8주에 잡힌 제작 착수 · 설치 일정이 없습니다.'
    );
  });
});

describe('그래프 (segan/charts.js)', () => {
  test('share — 가장 큰 값에 견준 길이(%), 0 과 엉뚱한 값은 0', () => {
    const C = charts();
    expect(C.share(5, 5)).toBe(100);
    expect(C.share(1, 3)).toBe(33.3);
    expect(C.share(9, 3)).toBe(100);
    expect(C.share(0, 3)).toBe(0);
    expect(C.share(2, 0)).toBe(0);
    expect(C.share('x', 3)).toBe(0);
  });

  test('쌓은 막대 — 0 인 조각은 그리지 않고, 길이는 가장 긴 줄에 견준다. 갈 곳이 있으면 링크', () => {
    const C = charts();
    document.body.innerHTML = C.stackRows([
      {
        key: 'a',
        label: '상담',
        value: 4,
        text: '4건',
        go: 'p-consult',
        segs: [
          { cls: 'x-fresh', n: 3, label: '여유' },
          { cls: 'x-slow', n: 0, label: '느림' },
          { cls: 'x-stuck', n: 1, label: '멈춤' },
        ],
      },
      { key: 'b', label: '설치', value: 0, text: '0건', segs: [] },
      {
        key: 'c',
        label: '생산',
        value: 2,
        text: '2건',
        segs: [{ cls: 'x-fresh', n: 2, label: '여유' }],
      },
    ]);
    const [a, b, c] = [...document.querySelectorAll('.ch-row')];
    expect(a.tagName).toBe('A');
    expect(a.getAttribute('data-me-go')).toBe('p-consult');
    expect(a.getAttribute('href')).toBe('#p-consult');
    expect([...a.querySelectorAll('.ch-seg')].map((s) => [s.className, text(s), s.title])).toEqual([
      ['ch-seg x-fresh', '3', '여유 3'],
      ['ch-seg x-stuck', '1', '멈춤 1'],
    ]);
    expect(a.querySelector('.ch-stack').style.width).toBe('100%');
    expect(b.tagName).toBe('DIV');
    expect(b.querySelector('.ch-stack')).toBeNull(); // 0 이면 막대가 없다 — 수는 글로 남는다
    expect(text(b.querySelector('.ch-value'))).toBe('0건');
    expect(c.querySelector('.ch-stack').style.width).toBe('50%');
  });

  test('가로 막대 · 기둥 · 작은 선 · 범례', () => {
    const C = charts();
    document.body.innerHTML = C.barRows([
      { key: 'q', label: '견적', value: 9, text: '9일', note: '+3', cls: 'x-hot' },
      { key: 'i', label: '설치', value: 0, text: '-' },
    ]);
    const bars = [...document.querySelectorAll('.ch-row')];
    expect(bars[0].querySelector('.ch-bar').className).toBe('ch-bar x-hot');
    expect(text(bars[0].querySelector('.ch-value'))).toBe('9일 +3');
    expect(bars[1].querySelector('.ch-bar')).toBeNull();

    document.body.innerHTML = C.columns(
      [
        { label: '11.23', values: { make: 2, install: 1 } },
        { label: '11.30', values: { make: 0, install: 4 } },
      ],
      [
        { key: 'make', cls: 'x-make', label: '제작 착수' },
        { key: 'install', cls: 'x-install', label: '설치' },
      ]
    );
    const cols = [...document.querySelectorAll('.ch-col')];
    expect(cols).toHaveLength(2);
    expect(cols.map((c) => text(c.querySelector('small')))).toEqual(['11.23', '11.30']);
    const heights = [...document.querySelectorAll('.ch-colbar')].map((b) => [
      b.className,
      b.style.height,
    ]);
    expect(heights).toEqual([
      ['ch-colbar x-make', C.COL_H / 2 + 'px'],
      ['ch-colbar x-install', C.COL_H / 4 + 'px'],
      ['ch-colbar x-install', C.COL_H + 'px'],
    ]);
    // 0 인 기둥은 그리지 않고 수도 적지 않는다
    expect([...cols[1].querySelectorAll('em')].map(text)).toEqual(['', '4']);

    expect(C.spark([50], 'x')).toBe('');
    expect(C.spark([null, 40, null], 'x')).toBe('');
    document.body.innerHTML = C.spark([38, null, 33, 50], '6월 38% → 11월 50%');
    const svg = document.querySelector('svg.ch-spark');
    expect(svg.getAttribute('aria-label')).toBe('6월 38% → 11월 50%');
    expect(svg.querySelector('path').getAttribute('d').split('L')).toHaveLength(3); // 값이 있는 점 셋
    expect(svg.querySelector('circle')).not.toBeNull();

    document.body.innerHTML = C.legend([{ cls: 'x-make', label: '제작 착수' }, { label: '글만' }]);
    expect(text(document.querySelector('.ch-legend'))).toBe('제작 착수글만');
    expect(document.querySelectorAll('.ch-legend i')).toHaveLength(1);
  });

  test('animate — 움직임 모듈이 없어도 그대로 두고, 있으면 막대는 자라고 선은 그려진다', () => {
    const C = charts();
    document.body.innerHTML =
      C.barRows([{ key: 'q', label: '견적', value: 9, text: '9일' }]) + C.spark([1, 2, 3], 'x');
    delete window.SeganMotion;
    expect(() => C.animate(document.body)).not.toThrow();
    const grow = jest.fn();
    const draw = jest.fn();
    window.SeganMotion = { grow, draw };
    C.animate(document.body);
    expect(grow).toHaveBeenCalledWith(document.querySelector('.ch-bar'), 1, 'x', 0);
    expect(draw).toHaveBeenCalledWith(document.querySelector('[data-ch-draw]'));
    delete window.SeganMotion;
  });
});

describe('화면', () => {
  test('대표 — 한 번 읽어 큰 숫자 넷 · 그래프 넷 · 아래 한 줄을 그린다', async () => {
    const calls = await load();
    expect(asked(calls)).toEqual(['GET /company/dashboard']);
    const c = calls.fetch.find((x) => x.url === WORK + '/company/dashboard');
    expect(c.auth).toBe('Bearer tok-1');
    expect(c.cache).toBe('no-store');
    expect(seen('meNumbers')).toBe(true);
    expect(text($('meNumbersTitle'))).toBe('진행 현황');
    expect(text(part('note'))).toBe(
      '2026.11.23 기준 · 진행 중인 프로젝트만 셉니다. 대표 · 실장에게만 보입니다.'
    );

    const kpis = Object.fromEntries(
      [...part('kpis').children].map((d) => [
        d.getAttribute('data-k'),
        [...d.querySelectorAll('dt, dd')].map(text),
      ])
    );
    expect(kpis).toEqual({
      active: ['진행 중 프로젝트', '23건', '멈춘 것 4건 · 보류 2건'],
      backlog: ['수주 잔고', '8,420만 원', '7건 · 계약했고 설치 전'],
      overdue: ['받을 날이 지난 미수금', '1,260만 원', '3건 · 가장 오래 72일'],
      month: ['이번 달 계약', '6건 · 5,130만 원', '지난달 4건보다 2건 많음'],
    });
    // 멈춘 것 · 지난 미수금은 굵은 글로도 알린다
    const warned = [...part('kpis').querySelectorAll('.cd-warn')].map((d) =>
      d.parentElement.getAttribute('data-k')
    );
    expect(warned).toEqual(['active', 'overdue']);

    // ① 단계마다 쌓인 프로젝트 — 줄을 누르면 그 단계 화면
    expect(say('steps')).toBe('견적에 4건, 그 가운데 2건이 멈춰 있습니다.');
    expect(rows(part('steps'))).toEqual([
      ['상담', '5건'],
      ['실측', '3건'],
      ['설계', '4건'],
      ['견적', '4건'],
      ['계약', '2건'],
      ['생산', '3건'],
      ['설치', '2건'],
    ]);
    // 단계 줄은 링크다 — 누르면 아래 프로젝트 목록을 그 단계로 고른다 (주소는 그대로)
    expect(
      [...part('steps').querySelectorAll('a.ch-row')].map((a) => a.getAttribute('data-ch-key'))
    ).toEqual(['consult', 'measure', 'design', 'quote', 'contract', 'make', 'install']);
    const PP = window.SeganPartnerProjects;
    const before = window.location.hash;
    part('steps').querySelector('a.ch-row[data-ch-key="quote"]').click();
    expect(PP.state.view).toEqual({ stage: 'quote', pick: '' });
    expect(window.location.hash).toBe(before);
    expect(
      [...$('partnerProjects').querySelectorAll('.pj-chip[aria-pressed="true"]')].map((b) =>
        b.getAttribute('data-stage')
      )
    ).toEqual(['quote']);
    const quote = part('steps').querySelector('[data-ch-key="quote"]');
    expect([...quote.querySelectorAll('.ch-seg')].map((s) => s.title)).toEqual([
      '여유 1',
      '느림 1',
      '멈춤 2',
    ]);
    expect(text(part('rule'))).toContain('상담 · 실측 2일 · 7일');

    // ② 단계마다 걸린 날 — 가장 많이 늘어난 단계만 색을 달리한다
    expect(say('days')).toBe('견적 단계가 앞 석 달보다 3일 늘었습니다.');
    expect(rows(part('days'))).toEqual([
      ['상담', '2일'],
      ['실측', '4일'],
      ['설계', '6일 −1'],
      ['견적', '9일 +3'],
      ['계약', '3일'],
      ['생산', '12일 +0.5'],
      ['설치', '-'],
    ]);
    expect(
      [...part('days').querySelectorAll('.ch-bar.cd-hot')].map((b) =>
        b.closest('.ch-row').getAttribute('data-ch-key')
      )
    ).toEqual(['quote']);

    // ③ 받을 돈
    expect(say('money')).toBe('받을 날이 지난 돈 1,260만 원, 앞 8주에 받을 돈 2,900만 원');
    expect(rows(part('money'))).toEqual([
      ['1 ~ 30일', '780만 원'],
      ['31 ~ 60일', '320만 원'],
      ['61일 넘음', '160만 원'],
    ]);
    expect([...part('money').querySelectorAll('.ch-col')].map((c) => text(c))).toEqual([
      '42011.23',
      '11.30',
      '1,15012.7',
      '30012.14',
      '68012.21',
      '12.28',
      '3501.4',
      '1.11',
    ]);

    // ④ 앞 8주 제작 착수 · 설치
    expect(say('load')).toBe('12.14 주가 가장 많습니다 — 제작 착수 2건 · 설치 3건');
    expect(part('load').querySelectorAll('.ch-col')).toHaveLength(8);
    expect(text(part('load').querySelector('.ch-legend'))).toBe('제작 착수설치');

    // 아래 한 줄
    expect(text(part('conversion'))).toBe(
      '견적 → 계약 (여섯 달)50%6월 37.5% → 11월 50%이번 달 견적 8건 가운데 계약 4건'
    );
    expect(part('conversion').querySelector('svg.ch-spark')).not.toBeNull();
    expect(text(part('install'))).toBe(
      '설치 납기 지킴 (지난 반년)85.7%끝낸 설치 14건 가운데 12건이 처음 잡은 날 안에 · 잡힌 날이 지난 설치 1건'
    );
    expect(text(part('as'))).toBe('A/S 율 (지난 반년)7.1%끝낸 수주 28건 가운데 A/S 접수 2건');
  });

  test('프로젝트 관리 대시보드에서만 보인다 — 다른 화면에서는 꺼 둔다', async () => {
    await load({ hash: '#dash-today' });
    expect($('meNumbers').hidden).toBe(false); // 읽기는 했다
    expect(seen('meNumbers')).toBe(false);
  });

  test('못 읽은 칸은 빼고 그린다 — 일정 · 납기 · A/S 가 없을 때', async () => {
    await load({ get: () => ok(DATA({ load: null, install: null, as: null })) });
    expect(seen('meNumbers')).toBe(true);
    expect(part('load')).toBeNull();
    expect(part('install')).toBeNull();
    expect(part('as')).toBeNull();
    expect(part('conversion')).not.toBeNull();
    expect(part('steps')).not.toBeNull();
  });

  test('비어 있는 팩토리 — 0 과 「없음」으로 그린다', async () => {
    await load({
      get: () =>
        ok(
          DATA({
            active: { count: 0, stuck: 0, held: 0 },
            steps: DATA().steps.map((s) => step(s.key, s.label, 0, 0, 0)),
            days: {
              steps: DATA().days.steps.map((s) => dur(s.key, s.label, 0, null, null, null)),
              worst: null,
            },
            money: {
              backlog: { amount: 0, count: 0 },
              overdue: {
                amount: 0,
                count: 0,
                orders: 0,
                oldestDays: null,
                buckets: DATA().money.overdue.buckets.map((b) => ({ ...b, amount: 0, count: 0 })),
              },
              upcoming: {
                amount: 0,
                weeks: WEEKS.map((start) => ({ start, amount: 0, count: 0 })),
              },
              month: { month: '2026-11', count: 0, amount: 0, prevCount: 0, prevAmount: 0 },
            },
            load: { weeks: WEEKS.map((start) => ({ start, make: 0, install: 0 })) },
            conversion: {
              months: DATA().conversion.months.map((m) => ({
                ...m,
                issued: 0,
                ordered: 0,
                rate: null,
              })),
            },
            install: { done: 0, onTime: 0, onTimeRate: null, overdue: 0 },
            as: null,
          })
        ),
    });
    const sub = (k) => text(part('kpis').querySelector(`[data-k="${k}"] .cd-sub`));
    expect(sub('active')).toBe('멈춘 것 없음');
    expect(sub('overdue')).toBe('없음');
    expect(sub('month')).toBe('지난달과 같음 (0건)');
    expect(part('kpis').querySelectorAll('.cd-warn')).toHaveLength(0);
    expect(say('steps')).toBe('진행 중인 프로젝트가 없습니다.');
    expect(say('days')).toBe('지난 석 달에 끝낸 단계가 아직 없습니다.');
    expect(say('load')).toBe('앞 8주에 잡힌 제작 착수 · 설치 일정이 없습니다.');
    expect(box().querySelectorAll('.ch-bar, .ch-stack, .ch-colbar')).toHaveLength(0);
    expect(text(part('conversion'))).toContain('-');
    expect(part('conversion').querySelector('svg')).toBeNull();
  });
});

describe('누가', () => {
  test('업체 직원 · 본사 구성원 · 업체 없는 사람 — 묻지도 않고 칸을 감춘다', async () => {
    for (const partner of [
      partnerOf('agent', 'staff'),
      PLATFORM,
      NOBODY,
      partnerOf('agent', 'owner', 'suspended'),
    ]) {
      const calls = await load({ partner });
      expect(asked(calls)).toEqual([]);
      expect($('meNumbers').hidden).toBe(true);
      expect($('meNumbers').innerHTML).toBe('');
    }
  });

  test('실장 · 다담 공장 구성원은 읽는다. 서버가 막으면(다담 공장 직원 403) 칸을 감춘다', async () => {
    expect(asked(await load({ partner: partnerOf('expert', 'manager') }))).toEqual([
      'GET /company/dashboard',
    ]);
    expect(seen('meNumbers')).toBe(true);
    const calls = await load({ partner: HQ, get: () => fail(403, 'not_manager', 'x') });
    expect(asked(calls)).toEqual(['GET /company/dashboard']);
    expect($('meNumbers').hidden).toBe(true);
  });

  test('못 읽으면 — 끊김 · 이상한 답 모두 칸째 감춘다', async () => {
    for (const get of [
      () => new Error('offline'),
      () => fail(500, 'x', 'x'),
      () => ok({ today: '엉뚱', steps: [] }),
      () => ok(null),
    ]) {
      await load({ get });
      expect($('meNumbers').hidden).toBe(true);
      expect($('meNumbers').innerHTML).toBe('');
    }
  });

  test('서버 주소가 없으면 묻지 않는다', async () => {
    const calls = await load({ work: '' });
    expect(calls.fetch.some((c) => c.url.includes('/company/dashboard'))).toBe(false);
    expect($('meNumbers').hidden).toBe(true);
  });
});
