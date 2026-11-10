/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「프로젝트 관리 › 생산 › 생산 계획」 (segan/production-plan.js + segan/me.html #productionPlan)
 *
 *   누가    다담 공장 구성원만 (GET /partner/me 의 hq_member). 아닌 사람은 묻지도 않는다
 *   데이터  workflow-api GET /production/proposals/latest · /production/proposals?from= · /production/assignments?from= ·
 *           /production/monthly, POST /production/proposals(다시 계산) · /production/proposals/:id/decision(지시 · 무시)
 *   화면    추천 · 지난 제안 · 월 손익 요약 · 주문별 일정 · 날짜별 부하 · 지시 내역 — 부분마다 따로 그린다
 *   못 읽으면 칸째 감춘다 (제안이 아직 없으면 빈 안내, 지난 제안 · 지시 · 월 손익만 못 읽으면 그 부분만)
 *   처음 읽을 때는 다시 계산하지 않는다 (대표 Slack 을 보내므로 단추를 눌렀을 때만)
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
const NOW = Date.parse('2026-11-10T03:00:00Z'); // 한국 시간 2026-11-10 (화) 12:00

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const HQ = ok({ company: null, application: null, members: [], invites: [], hq_member: true });
const PARTNER = ok({
  company: {
    id: CO,
    name: '다담 협력 주방',
    plan: 'agent',
    next_plan: null,
    status: 'active',
    sido: '대구광역시',
    gugun: '북구',
    role: 'owner',
    created_at: '2026-10-01T00:00:00Z',
  },
  application: null,
  members: [],
  invites: [],
});

// 추천 넷 — 서버 차례는 0 출근 · 1 알바 연장 · 2 설치일 조정 · 3 조립 인원 추가. 화면은 조정 → 인원 → 연장 → 출근
const plan = () => ({
  triggerLabel: '새 수주 (DD-3)',
  summary: {
    jobs: 3,
    lateBefore: 2,
    lateAfter: 0,
    needsReschedule: 1,
    extraCost: 350000,
    asmCallDays: 4,
  },
  suggestions: [
    { type: 'asm_call', date: '2026-11-12', text: '11/12(목) 조립 기사 2명 출근', cost: 0 },
    {
      type: 'edge_overtime',
      date: '2026-11-12',
      text: '11/12(목) 엣지 알바 2시간 연장',
      cost: 50000,
    },
    { type: 'reschedule', date: '2026-11-20', text: 'DD-3 설치일을 11/21 이후로 조정', cost: 0 },
    { type: 'asm_extra', date: '2026-11-12', text: '11/12(목) 조립 인원 1명 추가', cost: 300000 },
  ],
  jobs: [
    {
      label: 'DD-1 가람 주방',
      due: '2026-11-17',
      dueSource: 'schedule',
      finish: '2026-11-14',
      doorOrderBy: '2026-11-11',
      doorArrival: '2026-11-13',
      work: { cutter: 5400, edge: 1800, asm: 28800 },
      late: false,
    },
    {
      label: 'DD-2 나래 붙박이장',
      outsourced: true,
      due: '2026-11-19',
      dueSource: 'default',
      finish: '2026-11-20',
      doorOrderBy: '2026-11-09',
      doorOrderLate: true,
      doorArrival: '2026-11-16',
      work: { cutter: 0, edge: 0, asm: 14400 },
      late: true,
    },
    {
      label: 'DD-3 다온 신발장',
      due: '2026-11-20',
      dueSource: 'schedule',
      finish: '2026-11-21',
      doorOrderBy: '2026-11-12',
      doorArrival: '2026-11-17',
      work: { cutter: 1800, edge: 1800, asm: 7200 },
      late: true,
      rescheduleTo: '2026-11-21',
    },
  ],
  days: [
    {
      date: '2026-11-11',
      cut: { load: 5400, cap: 28800 },
      edge: { load: 1800, cap: 14400 },
      asm: { load: 0, cap: 0 },
    },
    {
      date: '2026-11-12',
      cut: { load: 0, cap: 28800 },
      edge: { load: 18000, cap: 14400, overtimeHours: 2 },
      asm: { load: 28800, cap: 57600, people: 2, extra: 1 },
    },
    // 일이 없는 날 — 표에서 뺀다
    {
      date: '2026-11-13',
      cut: { load: 0, cap: 28800 },
      edge: { load: 0, cap: 14400 },
      asm: { load: 0, cap: 0 },
    },
  ],
  skipped: [{ label: 'DD-9', reason: '스냅샷 없음' }],
});
const proposal = (extra = {}) => ({
  id: 'prop-2',
  created_at: '2026-11-10T00:30:00Z', // 한국 시간 11/10 09:30
  trigger: 'order_created',
  status: 'pending',
  plan: plan(),
  ...extra,
});
// 지난 제안 — 손으로 다시 계산해 승인한 것. 주문 하나 · 추천 하나
const OLD = {
  id: 'prop-1',
  created_at: '2026-11-08T05:00:00Z', // 한국 시간 11/08 14:00
  trigger: 'manual',
  status: 'approved',
  plan: {
    triggerLabel: '',
    summary: { jobs: 1, lateBefore: 1, lateAfter: 1, extraCost: 0, asmCallDays: 1 },
    suggestions: [{ type: 'asm_call', date: '2026-11-09', text: '11/9(월) 조립 기사 1명 출근' }],
    jobs: [plan().jobs[0]],
    days: [plan().days[0]],
    skipped: [],
  },
};
const HISTORY = {
  items: [
    {
      id: 'prop-2',
      created_at: '2026-11-10T00:30:00Z',
      trigger: 'order_created',
      triggerLabel: '새 수주 (DD-3)',
      status: 'pending',
      summary: { lateBefore: 2, lateAfter: 0, extraCost: 350000 },
    },
    {
      id: 'prop-1',
      created_at: '2026-11-08T05:00:00Z',
      trigger: 'manual',
      triggerLabel: '',
      status: 'approved',
      summary: { lateBefore: 1, lateAfter: 1, extraCost: 0 },
    },
    { id: '번호 아님', status: 'pending' }, // 번호 모양이 아닌 줄 — 뺀다
  ],
};
const ASSIGNMENTS = {
  items: [
    { work_date: '2026-11-12', text: '조립 기사 2명 출근', cost: 0, status: 'instructed' },
    { work_date: '2026-11-13', text: '엣지 알바 2시간 연장', cost: 50000, status: 'done' },
  ],
};
// 이번 달 — 간접비를 못 덮은 달 (적자)
const MONTHLY = {
  month: '2026-11',
  totals: {
    orders: 2,
    revenue: 8000000,
    cost: 5000000,
    gross: 3000000,
    grossRate: 37.5,
    overhead: 4000000,
    net: -1000000,
    unknownCost: 1,
    shortfall: 1000000,
  },
  rows: [
    { label: 'DD-1 가람 주방', tier: 'customer', revenue: 5000000, cost: 3000000, gross: 2000000 },
    {
      label: 'DD-2 나래 붙박이장',
      tier: 'partner',
      revenue: 3000000,
      cost: 2000000,
      gross: 1000000,
    },
  ],
};
// 지난달 — 간접비를 덮은 달 (흑자), 수주 없음 표
const MONTHLY_OCT = {
  month: '2026-10',
  totals: {
    orders: 0,
    revenue: 6000000,
    cost: 1000000,
    gross: 5000000,
    grossRate: null,
    overhead: 4000000,
    net: 1000000,
    unknownCost: 0,
    shortfall: 0,
  },
  rows: [],
};

/**
 * 마이페이지를 띄운다 (기본 = 다담 공장 구성원, 생산 계획 화면)
 * opts.latest() → GET /production/proposals/latest, opts.one(id) → GET /production/proposals/:id,
 * opts.history(url) → GET /production/proposals?from=, opts.assignments(url) · opts.monthly(url),
 * opts.recompute() → POST /production/proposals, opts.decision(body, id) → POST …/:id/decision
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: HQ,
    hash: '#p-plan',
    latest: () => ok(proposal()),
    one: () => ok(OLD),
    history: () => ok(HISTORY),
    assignments: () => ok(ASSIGNMENTS),
    monthly: () => ok(MONTHLY),
    recompute: () => ok({ proposal: { id: 'prop-3', status: 'pending' }, plan: plan() }, 201),
    decision: () => ok({ status: 'approved', assignments: [{}, {}, {}], slack: { ok: true } }),
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
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const method = init.method || 'GET';
    calls.fetch.push({
      url,
      method,
      auth: (init.headers || {}).Authorization,
      type: (init.headers || {})['Content-Type'],
      body,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    const base = WORK + '/production/proposals';
    if (url === base + '/latest') return reply(await opts.latest());
    if (url === base && method === 'POST') return reply(await opts.recompute(body));
    if (url.startsWith(base + '?')) return reply(await opts.history(url));
    if (url.startsWith(base + '/')) {
      const rest = url.slice(base.length + 1);
      const id = rest.split('/')[0];
      if (rest.endsWith('/decision')) return reply(await opts.decision(body, id));
      return reply(await opts.one(id));
    }
    if (url.startsWith(WORK + '/production/assignments')) return reply(await opts.assignments(url));
    if (url.startsWith(WORK + '/production/monthly')) return reply(await opts.monthly(url));
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
    'segan/production-plan.js',
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

/** 생산 계획 스크립트만 올린다 — 순수 함수 시험 */
function lib() {
  delete window.SeganProductionPlan;
  (0, eval)(read('segan/production-plan.js'));
  return window.SeganProductionPlan;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
/** 화면에 보이는가 — 모듈이 감춘 칸(hidden) · 마이페이지가 끈 칸(me-off) 은 아니다 */
const seen = (id) => !!$(id) && !$(id).hidden && !$(id).classList.contains('me-off');
const part = (name) => $('productionPlan').querySelector(`[data-pp-part="${name}"]`);
/** 그려진 부분 이름 (감춘 부분은 뺀다) */
const parts = () =>
  [...$('productionPlan').querySelectorAll('[data-pp-part]')]
    .filter((el) => !el.hidden)
    .map((el) => el.getAttribute('data-pp-part'));
const heads = (name) => [...part(name).querySelectorAll('.od-table thead th')].map(text);
// 표의 줄 — '칸 | 칸 …' (지금 띄운 제안의 줄은 끝에 ←)
const rows = (name) =>
  [...part(name).querySelectorAll('.od-table tbody tr')].map(
    (tr) =>
      [...tr.children].map(text).join(' | ') + (tr.classList.contains('od-row--on') ? ' ←' : '')
  );
const kpi = (name) =>
  [...part(name).querySelectorAll('.od-kpi > div')].map(
    (d) => text(d.querySelector('dt')) + ' ' + text(d.querySelector('dd'))
  );
// 추천 줄 — [서버 번호, 종류, 글, 비용, 체크 상태]
const sugs = () =>
  [...part('rec').querySelectorAll('.pp-sug')].map((li) => {
    const box = li.querySelector('input[data-i]');
    return [
      Number(box.getAttribute('data-i')),
      text(li.querySelector('.pp-kind')),
      text(li.querySelector('.pp-text')),
      text(li.querySelector('.pp-cost')),
      box.disabled ? '잠김' : box.checked ? '고름' : '뺌',
    ];
  });
const btn = (act) => part('rec').querySelector(`[data-act="${act}"]`);
const msg = () => text($('productionPlan').querySelector('[data-pp="msg"]'));
const press = async (el) => {
  el.click();
  await flush();
};
const go = async (hash) => {
  window.location.hash = hash;
  window.dispatchEvent(new Event('hashchange'));
  await flush();
};
const sent = (calls, method) => calls.fetch.filter((c) => c.method === method);
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/production/'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));

afterEach(() => {
  jest.restoreAllMocks();
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸(#partner) 안, 제작 의뢰 다음 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const box = doc.getElementById('productionPlan');
    expect(box).not.toBeNull();
    expect(box.hasAttribute('hidden')).toBe(true);
    expect(box.closest('section').id).toBe('partner');
    expect(box.classList.contains('od')).toBe(true);
    expect(box.classList.contains('pp')).toBe(true);
    expect(box.previousElementSibling.id).toBe('production-requests');
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    // 없으면(-1) 차례 비교가 거짓으로 통과하지 않게 자리부터 본다
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['production-plan.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('production-plan.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'production-plan.js')");
  });

  test('고객 정보를 기기에 남기지 않는다 — 저장소 · 알림을 쓰지 않고, 확인 창도 띄우지 않는다', () => {
    // 머리말의 설명 글은 빼고 본다 — 코드가 쓰는지만
    const code = read('segan/production-plan.js')
      .split('\n')
      .filter(
        (line) =>
          !line.trim().startsWith('//') &&
          !line.trim().startsWith('*') &&
          !line.includes('고객 정보  ')
      )
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
  });

  test('막대 색 — 재단 · 엣지 · 조립은 업무 달력의 색(색각 검사를 통과한 값)을 쓴다', () => {
    const css = read('segan/shell.css');
    for (const [name, cal] of [
      ['--pp-cut', '--cal-sales'],
      ['--pp-edge', '--cal-make'],
      ['--pp-asm', '--cal-install'],
    ]) {
      const mine = new RegExp(name + ':\\s*(#[0-9a-f]{6})').exec(css);
      const theirs = new RegExp(cal + ':\\s*(#[0-9a-f]{6})').exec(css);
      expect(mine).not.toBeNull();
      expect(theirs).not.toBeNull();
      expect(mine[1]).toBe(theirs[1]);
    }
  });
});

describe('순수 함수', () => {
  test('canSee — 다담 공장 구성원만', () => {
    const P = lib();
    expect(P.canSee({ hq_member: true })).toBe(true);
    expect(P.canSee({ hq_member: 'true' })).toBe(false);
    expect(P.canSee({ platform_member: true })).toBe(false);
    expect(P.canSee({ company: { plan: 'agent' } })).toBe(false);
    expect(P.canSee(null)).toBe(false);
    expect(P.canSee([])).toBe(false);
  });

  test('proposalOf — 번호 모양이 아니면 null, 빠진 칸은 빈 것으로', () => {
    const P = lib();
    expect(P.proposalOf(null)).toBeNull();
    expect(P.proposalOf({ id: '../x' })).toBeNull();
    expect(P.proposalOf({ id: 7 })).toBeNull();
    expect(P.proposalOf({ id: 'a1', plan: { jobs: 'x', summary: [] } })).toEqual({
      id: 'a1',
      created_at: '',
      trigger: '',
      status: '',
      plan: { triggerLabel: '', summary: {}, suggestions: [], jobs: [], days: [], skipped: [] },
    });
    // 다시 계산의 응답 — 제안과 계획이 따로 온다
    const p = P.proposalOf({ id: 'a2', plan: { jobs: [1] } }, { jobs: [1, 2] });
    expect(p.plan.jobs).toEqual([1, 2]);
  });

  test('sortedIndexes — 설치일 조정 → 인원 추가 → 알바 연장 → 외주 → 도어 발주 → 출근, 같은 종류는 날짜순', () => {
    const P = lib();
    expect(P.sortedIndexes(plan().suggestions)).toEqual([2, 3, 1, 0]);
    expect(
      P.sortedIndexes([
        { type: 'asm_call', date: '2026-11-13' },
        { type: 'asm_call', date: '2026-11-12' },
        { type: 'door_order', date: '2026-11-20' },
        { type: 'top_order', date: '2026-11-30' }, // 차례에 없는 종류 — 맨 앞
        { type: 'asm_call', date: '2026-11-12' },
      ])
    ).toEqual([3, 2, 1, 4, 0]);
    expect(P.sortedIndexes(null)).toEqual([]);
  });

  test('글자 꼴 — 만원 · 시간 · 날짜 · 원 · 만든 때', () => {
    const P = lib();
    expect(P.man(350000)).toBe('35만원');
    expect(P.man(12345678)).toBe('1,235만원');
    expect(P.man(null)).toBe('0만원');
    expect(P.hrs(5400)).toBe('1.5h');
    expect(P.hrs(1800)).toBe('30분');
    expect(P.hrs(0)).toBe('0분');
    expect(P.day('2026-11-12')).toBe('11/12(목)');
    expect(P.day('')).toBe('-');
    expect(P.day('11월 12일')).toBe('-');
    expect(P.wonFull(1000000)).toBe('1,000,000원');
    expect(P.wonFull(null)).toBe('-');
    expect(P.stamp('2026-11-10T00:30:00Z')).toBe('11/10 09:30');
    expect(P.stamp('2026-11-10T16:05:00Z')).toBe('11/11 01:05'); // 한국 시간으로 날이 넘어간다
    expect(P.stamp('없음')).toBe('-');
    expect(P.todayKst(Date.parse('2026-11-10T15:30:00Z'))).toBe('2026-11-11');
    expect(P.addDays('2026-11-10', -30)).toBe('2026-10-11');
  });
});

describe('생산 계획 화면', () => {
  test('다담 공장 구성원 — #p-plan 에서 칸이 보이고, 제목이 화면 이름이 된다', async () => {
    const calls = await load();
    expect(seen('productionPlan')).toBe(true);
    expect($('partner').hidden).toBe(false);
    expect(text($('productionPlanTitle'))).toBe('생산 계획');
    expect($('partner').getAttribute('aria-labelledby')).toBe('productionPlanTitle');
    expect(parts()).toEqual(['rec', 'history', 'monthly', 'jobs', 'days', 'assign']);
    // 처음에는 읽기만 한다 — 다시 계산(POST)은 대표 Slack 을 보내므로 단추를 눌렀을 때만
    expect(asked(calls).sort()).toEqual([
      'GET /production/assignments?from=2026-11-10',
      'GET /production/monthly',
      'GET /production/proposals/latest',
      'GET /production/proposals?from=2026-10-11',
    ]);
    for (const c of calls.fetch.filter((x) => x.url.startsWith(WORK + '/production/')))
      expect(c.auth).toBe('Bearer tok-1');
  });

  test('구역 단추 — 「생산 계획」이 지금 화면으로 표시된다', async () => {
    await load();
    const nav = $('meParts');
    const on = nav.querySelector('a[data-me-part="p-plan"]');
    if (!nav.hidden) {
      expect(text(on)).toBe('생산 계획');
      expect(on.getAttribute('aria-current')).toBe('page');
    }
    // 다른 화면으로 가면 칸을 끈다
    await go('#account');
    expect(seen('productionPlan')).toBe(false);
    await go('#p-plan');
    expect(seen('productionPlan')).toBe(true);
  });

  test('추천 — 상태 · 계기 · 요약 다섯 칸 · 추천 목록(차례 · 모두 고른 채로) · 단추', async () => {
    await load();
    expect(text(part('rec').querySelector('.pp-meta'))).toBe(
      '승인 대기 새 수주 (DD-3) · 11/10 09:30'
    );
    expect(kpi('rec')).toEqual([
      '진행 중 주문 3건',
      '기본 인력으로 늦는 건 2건',
      '추천대로 하면 0건 (+설치일 조정 1)',
      '추가 비용 35만원',
      '조립 기사 출근 4일',
    ]);
    expect(sugs()).toEqual([
      [2, '설치일 조정', 'DD-3 설치일을 11/21 이후로 조정', '', '고름'],
      [3, '조립 인원 추가', '11/12(목) 조립 인원 1명 추가', '30만원', '고름'],
      [1, '알바 연장', '11/12(목) 엣지 알바 2시간 연장', '5만원', '고름'],
      [0, '조립 기사 출근', '11/12(목) 조립 기사 2명 출근', '', '고름'],
    ]);
    expect(
      [...part('rec').querySelectorAll('[data-act]')].map(
        (b) => text(b) + (b.disabled ? ' (잠김)' : '')
      )
    ).toEqual(['선택한 항목 지시하기', '무시', '지금 다시 계산']);
  });

  test('주문별 일정 — 외주 · 설치일 미정 · 도어 발주 늦음 · 설치일 조정은 글로도 적는다', async () => {
    await load();
    expect(heads('jobs')).toEqual([
      '주문',
      '상태',
      '마감 (설치 하루 전)',
      '공장 완료 예정',
      '도어 발주 마감',
      '도어 도착',
      '재단',
      '엣지',
      '조립',
    ]);
    expect(rows('jobs')).toEqual([
      'DD-1 가람 주방 | 제때 | 11/17(화) | 11/14(토) | 11/11(수) | 11/13(금) | 1.5h | 30분 | 8.0h',
      'DD-2 나래 붙박이장외주 | 늦음 | 11/19(목) (설치일 미정) | 11/20(금) | 11/9(월) (늦음) | 11/16(월) | 0분 | 0분 | 4.0h',
      'DD-3 다온 신발장 | 설치일 조정 필요 → 11/21(토) 이후 | 11/20(금) | 11/21(토) | 11/12(목) | 11/17(화) | 30분 | 30분 | 2.0h',
    ]);
    expect(text(part('jobs').querySelector('.mk-note'))).toBe(
      '계획에서 빠진 주문: DD-9 (스냅샷 없음)'
    );
  });

  test('날짜별 부하 — 일이 있는 날만, 막대마다 읽어 주는 이름 · 글 범례 · 시간 칸', async () => {
    await load();
    expect(heads('days')).toEqual([
      '날짜',
      '부하 / 가능 시간',
      '재단',
      '엣지',
      '조립',
      '조립 인원',
    ]);
    expect(rows('days')).toEqual([
      '11/11(수) |  | 1.5h | 30분 | 0분 | -',
      '11/12(목) |  | 0분 | 5.0h (+2h 연장) | 8.0h | 2명+1 추가',
    ]);
    const bars = [...part('days').querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('.pp-bar')].map(
        (b) => b.getAttribute('aria-label') + ' = ' + b.querySelector('i').style.width
      )
    );
    expect(bars).toEqual([
      ['재단 1.5h / 8.0h = 19%', '엣지 30분 / 4.0h = 13%', '조립 0분 / 0분 = 0%'],
      // 가능 시간을 넘으면 꽉 찬 막대 — 넘친 만큼은 시간 칸의 「연장」 글이 알린다
      ['재단 0분 / 8.0h = 0%', '엣지 5.0h / 4.0h = 100%', '조립 8.0h / 16.0h = 50%'],
    ]);
    for (const b of part('days').querySelectorAll('.pp-bar'))
      expect(b.getAttribute('role')).toBe('img');
    expect(text(part('days').querySelector('.pp-legend'))).toBe('재단 기사엣지 (알바)조립 기사');
  });

  test('지시 내역 · 지난 제안 — 지금 띄운 제안의 줄을 표시하고, 보관함 전체는 PC 화면으로', async () => {
    await load();
    expect(heads('assign')).toEqual(['날짜', '내용', '비용', '상태']);
    expect(rows('assign')).toEqual([
      '11/12(목) | 조립 기사 2명 출근 | - | 지시',
      '11/13(금) | 엣지 알바 2시간 연장 | 5만원 | 완료',
    ]);
    expect(heads('history')).toEqual(['만든 때', '계기', '상태', '지연 전→후', '추가 비용']);
    expect(rows('history')).toEqual([
      '11/10 09:30 | 새 수주 (DD-3) | 승인 대기 | 2→0 | 35만원 ←',
      '11/08 14:00 | 다시 계산 | 승인됨 | 1→1 | -',
    ]);
    const link = part('history').querySelector('a[data-desktop-tab]');
    expect(link.getAttribute('href')).toBe('../admin/work-reports.html');
    expect(text(link)).toBe('보관함 전체 →');
  });

  test('월 손익 요약 — 여섯 칸 · 적자는 글로도 · 모자란 금액 · 수주별 보기', async () => {
    await load();
    expect(part('monthly').querySelector('input[name="month"]').value).toBe('2026-11');
    expect(kpi('monthly')).toEqual([
      '수주 2건',
      '매출 (부가세 별도) 800만원',
      '지출비용 500만원',
      '남는 돈 (매출 − 지출) 300만원 (37.5%)',
      '간접비 400만원',
      '최종 손익 -100만원 (적자)',
    ]);
    const note = part('monthly').querySelector('.mk-note.od-late');
    expect(text(note)).toBe(
      '원가를 모르는 수주 1건(장당 견적 이전 스냅샷)은 지출·남는 돈에서 빠졌습니다. 간접비를 덮으려면 이번 달 남는 돈이 1,000,000원 더 필요합니다.'
    );
    expect(heads('monthly')).toEqual(['수주', '구분', '매출', '지출비용', '남는 돈']);
    expect(rows('monthly')).toEqual([
      'DD-1 가람 주방 | 고객 | 5,000,000원 | 3,000,000원 | 2,000,000원',
      'DD-2 나래 붙박이장 | 거래처 | 3,000,000원 | 2,000,000원 | 1,000,000원',
    ]);
  });

  test('서버 글은 글자로만 그린다 — 태그가 들어와도 화면을 바꾸지 못한다', async () => {
    const bad = proposal();
    bad.plan.suggestions[0].text = '<img src=x onerror=1>';
    bad.plan.jobs[0].label = '<b>굵게</b>';
    await load({ latest: () => ok(bad) });
    expect($('productionPlan').querySelector('img')).toBeNull();
    expect($('productionPlan').querySelector('td b')).toBeNull();
    expect(rows('jobs')[0].startsWith('<b>굵게</b> | ')).toBe(true);
  });
});

describe('누른 일', () => {
  test('지시하기 — 고른 추천의 서버 번호만 보내고, 저장한 건수 · Slack 결과를 알린다', async () => {
    let status = 'pending';
    const calls = await load({
      decision: () => {
        status = 'approved';
        return ok({ status: 'approved', assignments: [{}, {}, {}], slack: { ok: true } });
      },
      history: () => ok({ items: [{ ...HISTORY.items[0], status }, HISTORY.items[1]] }),
    });
    // 「알바 연장」(서버 번호 1)을 뺀다
    part('rec').querySelector('input[data-i="1"]').click();
    await press(btn('approve'));
    const posts = sent(calls, 'POST');
    expect(posts.length).toBe(1);
    expect(posts[0].url).toBe(WORK + '/production/proposals/prop-2/decision');
    expect(posts[0].type).toBe('application/json');
    expect(posts[0].body).toEqual({ decision: 'approve', selected: [2, 3, 0] });
    expect(msg()).toBe('지시 3건을 저장했습니다. 작업자 Slack 으로 보냈습니다.');
    // 처리한 제안 — 상태가 바뀌고 체크 · 단추가 잠긴다. 다시 계산은 남는다
    expect(text(part('rec').querySelector('.pp-status'))).toBe('승인됨');
    expect(sugs().map((s) => s[4])).toEqual(['잠김', '잠김', '잠김', '잠김']);
    expect(btn('approve').disabled).toBe(true);
    expect(btn('dismiss').disabled).toBe(true);
    expect(btn('recompute').disabled).toBe(false);
    expect(rows('history')[0]).toBe('11/10 09:30 | 새 수주 (DD-3) | 승인됨 | 2→0 | 35만원 ←');
    // 잠긴 단추를 눌러도 다시 보내지 않는다
    await press(btn('approve'));
    expect(sent(calls, 'POST').length).toBe(1);
  });

  test('지시하기 — 하나도 고르지 않으면 보내지 않고 알린다', async () => {
    const calls = await load();
    for (const box of part('rec').querySelectorAll('input[data-i]')) box.click();
    await press(btn('approve'));
    expect(sent(calls, 'POST')).toEqual([]);
    expect(msg()).toBe('지시할 항목을 하나 이상 고르세요.');
    expect(btn('approve').disabled).toBe(false);
  });

  test('지시하기 — Slack 을 못 보냈으면 그 사실을 같이 적는다', async () => {
    await load({
      decision: () =>
        ok({ status: 'approved', assignments: [{}], slack: { ok: false, error: '채널 없음' } }),
    });
    await press(btn('approve'));
    expect(msg()).toBe('지시 1건을 저장했습니다. (Slack 전송 실패: 채널 없음)');
  });

  test('지시하기 — 서버가 막으면 서버 글을 알리고 화면은 그대로 둔다', async () => {
    await load({ decision: () => fail(409, 'conflict', '이미 처리된 제안입니다 (approved)') });
    await press(btn('approve'));
    expect(msg()).toBe('이미 처리된 제안입니다 (approved)');
    expect(text(part('rec').querySelector('.pp-status'))).toBe('승인 대기');
    expect(btn('approve').disabled).toBe(false);
  });

  test('무시 — 고른 것과 상관없이 제안을 닫는다', async () => {
    const calls = await load({ decision: () => ok({ status: 'dismissed', assignments: [] }) });
    await press(btn('dismiss'));
    const posts = sent(calls, 'POST');
    expect(posts.length).toBe(1);
    expect(posts[0].body.decision).toBe('dismiss');
    expect(msg()).toBe('이 제안을 무시했습니다.');
    expect(text(part('rec').querySelector('.pp-status'))).toBe('무시함');
    expect(btn('approve').disabled).toBe(true);
  });

  test('지금 다시 계산 — 새 제안을 받아 위에 띄우고, 지난 제안 · 지시 내역을 다시 읽는다', async () => {
    const next = plan();
    next.suggestions = [next.suggestions[0]];
    next.summary.jobs = 4;
    const calls = await load({
      recompute: () =>
        ok({ proposal: { id: 'prop-3', status: 'pending', trigger: 'manual' }, plan: next }, 201),
    });
    const before = asked(calls).length;
    await press(btn('recompute'));
    const posts = sent(calls, 'POST');
    expect(posts.length).toBe(1);
    expect(posts[0].url).toBe(WORK + '/production/proposals');
    expect(posts[0].body).toBeUndefined();
    expect(msg()).toBe('다시 계산했습니다. 대표 Slack 으로도 보냈습니다.');
    expect(kpi('rec')[0]).toBe('진행 중 주문 4건');
    expect(sugs().map((s) => s[0])).toEqual([0]);
    expect(asked(calls).slice(before).sort()).toEqual([
      'GET /production/assignments?from=2026-11-10',
      'GET /production/proposals?from=2026-10-11',
      'POST /production/proposals',
    ]);
    // 새 제안이 가장 새 것 — 「최신 제안 보기」는 없다
    expect(btn('latest')).toBeNull();
  });

  test('지금 다시 계산 — 못 하면 서버 글을 알리고 지금 제안을 그대로 둔다', async () => {
    await load({ recompute: () => fail(403, 'not_manager', '대표 · 실장만 할 수 있습니다') });
    await press(btn('recompute'));
    expect(msg()).toBe('대표 · 실장만 할 수 있습니다');
    expect(kpi('rec')[0]).toBe('진행 중 주문 3건');
  });

  test('지난 제안 — 줄을 누르면 그 제안을 위에 띄우고, 「최신 제안 보기」로 돌아온다', async () => {
    const calls = await load();
    await press(part('history').querySelector('[data-act="proposal"][data-id="prop-1"]'));
    expect(asked(calls).pop()).toBe('GET /production/proposals/prop-1');
    expect(text(part('rec').querySelector('.pp-meta'))).toBe('승인됨 수동 계산 · 11/08 14:00');
    expect(sugs()).toEqual([[0, '조립 기사 출근', '11/9(월) 조립 기사 1명 출근', '', '잠김']]);
    expect(btn('approve').disabled).toBe(true);
    expect(rows('jobs').length).toBe(1);
    expect(rows('history').map((r) => r.endsWith('←'))).toEqual([false, true]);
    expect(part('history').querySelector('[data-id="prop-1"]').getAttribute('aria-current')).toBe(
      'true'
    );
    // 월 손익 · 지시 내역은 제안과 상관없다 — 그대로 둔다
    expect(rows('assign').length).toBe(2);
    await press(btn('latest'));
    expect(asked(calls).pop()).toBe('GET /production/proposals/latest');
    expect(text(part('rec').querySelector('.pp-status'))).toBe('승인 대기');
    expect(btn('latest')).toBeNull();
    expect(rows('jobs').length).toBe(3);
  });

  test('월 손익 — 달을 바꾸면 그 달을 다시 읽고, 고르던 추천 체크는 남는다', async () => {
    const calls = await load({
      monthly: (url) => ok(url.endsWith('?month=2026-10') ? MONTHLY_OCT : MONTHLY),
    });
    part('rec').querySelector('input[data-i="3"]').click(); // 「조립 인원 추가」를 뺀다
    const input = part('monthly').querySelector('input[name="month"]');
    input.value = '2026-10';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(asked(calls).pop()).toBe('GET /production/monthly?month=2026-10');
    expect(part('monthly').querySelector('input[name="month"]').value).toBe('2026-10');
    expect(kpi('monthly')).toEqual([
      '수주 0건',
      '매출 (부가세 별도) 600만원',
      '지출비용 100만원',
      '남는 돈 (매출 − 지출) 500만원',
      '간접비 400만원',
      '최종 손익 100만원 (흑자)',
    ]);
    expect(text(part('monthly').querySelector('.pp-more .me-empty'))).toBe(
      '이 달 수주가 없습니다.'
    );
    expect(part('monthly').querySelector('.mk-note.od-late')).toBeNull();
    expect(msg()).toBe('');
    expect(sugs().map((s) => s[4])).toEqual(['고름', '뺌', '고름', '고름']);
  });

  test('월 손익 — 달 모양이 아니면 묻지 않고, 못 읽으면 지금 표를 그대로 둔다', async () => {
    const calls = await load({
      monthly: (url) =>
        url.includes('?month=') ? fail(500, 'server', '월 손익을 읽지 못했습니다') : ok(MONTHLY),
    });
    const input = part('monthly').querySelector('input[name="month"]');
    const before = asked(calls).length;
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(asked(calls).length).toBe(before);
    input.value = '2026-09';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(msg()).toBe('월 손익을 읽지 못했습니다');
    expect(kpi('monthly')[0]).toBe('수주 2건');
  });
});

describe('누가 보나 · 못 읽으면', () => {
  test('협력업체 구성원 — 생산 계획을 묻지 않고 칸도 없다', async () => {
    const calls = await load({ partner: PARTNER });
    expect(asked(calls)).toEqual([]);
    expect(seen('productionPlan')).toBe(false);
    expect($('productionPlan').innerHTML).toBe('');
    expect(document.querySelector('a[data-me-part="p-plan"]')).toBeNull();
  });

  test('로그인하지 않았으면 묻지 않는다', async () => {
    const calls = await load({ session: null });
    expect(asked(calls)).toEqual([]);
    expect(seen('productionPlan')).toBe(false);
  });

  test('제안이 아직 없으면(404) — 빈 안내와 「지금 다시 계산」만. 저절로 계산하지 않는다', async () => {
    const calls = await load({
      latest: () => fail(404, 'not_found', '아직 생산 계획 제안이 없습니다'),
      history: () => ok({ items: [] }),
      assignments: () => ok({ items: [] }),
    });
    expect(seen('productionPlan')).toBe(true);
    expect(sent(calls, 'POST')).toEqual([]);
    expect(text(part('rec').querySelector('.me-empty'))).toBe('아직 생산 계획 제안이 없습니다.');
    expect([...part('rec').querySelectorAll('[data-act]')].map(text)).toEqual(['지금 다시 계산']);
    // 제안이 없으면 일정 · 부하 표도 없다
    expect(parts()).toEqual(['rec', 'history', 'monthly', 'assign']);
    expect(text(part('history').querySelector('.me-empty'))).toBe('최근 30일 제안이 없습니다.');
    expect(text(part('assign').querySelector('.me-empty'))).toBe('지시가 없습니다.');
    // 누르면 그때 계산해 띄운다
    await press(btn('recompute'));
    expect(sent(calls, 'POST').length).toBe(1);
    expect(parts()).toEqual(['rec', 'history', 'monthly', 'jobs', 'days', 'assign']);
    expect(kpi('rec')[0]).toBe('진행 중 주문 3건');
  });

  test('서버가 막거나(403) · 끊기거나 · 모양이 아니면 — 칸째 감춘다', async () => {
    for (const latest of [
      () => fail(403, 'not_hq', '다담 공장 구성원만 볼 수 있습니다'),
      () => fail(500, 'server', '오류'),
      () => new Error('끊김'),
      () => ok({ id: '번호 아님', plan: plan() }),
      // 서버가 아닌 곳의 404 (success 칸이 없다) — 빈 안내로 읽지 않는다
      () => ({ ok: false, status: 404, body: {} }),
    ]) {
      await load({ latest });
      expect(seen('productionPlan')).toBe(false);
      expect($('productionPlan').innerHTML).toBe('');
      jest.restoreAllMocks();
    }
  });

  test('월 손익을 못 받는 사람(403) — 그 부분만 뺀다', async () => {
    await load({ monthly: () => fail(403, 'not_money', '대표 · 실장만 볼 수 있습니다') });
    expect(parts()).toEqual(['rec', 'history', 'jobs', 'days', 'assign']);
    expect($('productionPlan').querySelector('input[name="month"]')).toBeNull();
  });

  test('지난 제안 · 지시 내역만 못 읽으면 — 그 부분만 뺀다', async () => {
    await load({ history: () => fail(500, 'server', 'x'), assignments: () => new Error('끊김') });
    expect(parts()).toEqual(['rec', 'monthly', 'jobs', 'days']);
  });

  test('추천 · 주문 · 일이 없는 제안 — 빈 안내를 적는다', async () => {
    const empty = proposal();
    empty.plan.suggestions = [];
    empty.plan.jobs = [];
    empty.plan.days = [];
    empty.plan.skipped = [];
    await load({ latest: () => ok(empty) });
    expect(text(part('rec').querySelector('.me-empty'))).toBe('추천할 것이 없습니다.');
    expect(text(part('jobs').querySelector('.me-empty'))).toBe('진행 중인 주문이 없습니다.');
    expect(text(part('days').querySelector('.me-empty'))).toBe('작업이 없습니다.');
    expect(part('days').querySelector('.pp-legend')).toBeNull();
  });
});

describe('고객 정보', () => {
  test('localStorage · sessionStorage 에 주문 이름을 남기지 않는다', async () => {
    await load();
    await press(part('history').querySelector('[data-act="proposal"][data-id="prop-1"]'));
    const kept = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(kept).not.toContain('가람 주방');
    expect(kept).not.toContain('나래 붙박이장');
    expect(kept).not.toContain('다온 신발장');
  });
});
