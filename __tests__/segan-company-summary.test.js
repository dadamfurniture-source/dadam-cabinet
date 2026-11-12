/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「프로젝트 관리」 대시보드의 우리 팩토리 숫자 (segan/company-summary.js + segan/me.html #meNumbers)
 *
 *   누가    프로젝트를 가지는 업체의 대표 · 실장 — 협력업체 Manager · Expert · Agent 의 owner · manager,
 *           다담 공장 구성원(직책은 서버가 가린다). 업체 직원은 묻지도 않는다
 *   데이터  workflow-api GET /company/summary[?month=] (마이페이지 5단계 — 견적 흐름 · 리드타임, 건수 · 비율 · 날수만)
 *   화면    달 고르기 · 견적 흐름 숫자 칸 · 걸린 시간 · 수정 요청 사유 · 리드타임 · 설치 납기 — 보기만 한다
 *   못 읽으면 칸째 감춘다. 달을 바꾸다 못 읽으면 있던 숫자는 그대로
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
const NOW = Date.parse('2026-11-11T03:00:00Z');

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
  delete window.SeganCompanySummary;
  (0, eval)(read('segan/company-summary.js'));
  return window.SeganCompanySummary;
};

const FUNNEL = (patch = {}) => ({
  leads: 9,
  issued: 7,
  viewed: 6,
  approved: 3,
  ordered: 2,
  rejected: 1,
  pending: 3,
  conversion: 42.9,
  viewRate: 85.7,
  orderRate: 66.7,
  avgRevisions: 1.4,
  medianHoursToView: 5.5,
  medianDaysToDecide: 3.2,
  reasons: {
    requests: 2,
    noReason: 1,
    codes: [{ code: 'price', label: '금액', count: 1, share: 50 }],
  },
  ...patch,
});
const NO_FUNNEL = () =>
  FUNNEL({
    leads: 0,
    issued: 0,
    viewed: 0,
    approved: 0,
    ordered: 0,
    rejected: 0,
    pending: 0,
    conversion: null,
    viewRate: null,
    orderRate: null,
    avgRevisions: null,
    medianHoursToView: null,
    medianDaysToDecide: null,
    reasons: { requests: 0, noReason: 0, codes: [] },
  });
const LEAD = (patch = {}) => ({
  window: { days: 180, start: '2026-05-16', end: '2026-11-11' },
  orders: 14,
  totalMedianDays: 26.5,
  stages: [
    { key: 'measure', label: '수주 → 실측', n: 14, medianDays: 3 },
    { key: 'start', label: '실측 → 제작 착수', n: 13, medianDays: 6.5 },
    { key: 'make', label: '제작', n: 13, medianDays: 9 },
    { key: 'install', label: '제작 완료 → 설치', n: 0, medianDays: null },
  ],
  slowest: { key: 'make', label: '제작', medianDays: 9 },
  install: { done: 14, onTime: 11, onTimeRate: 78.6, avgLateDays: 2.3, rescheduled: 4, overdue: 1 },
  ...patch,
});
const summary = (month, funnel = FUNNEL(), lead = LEAD()) =>
  ok({ company: { id: CO }, month, funnel, lead });

/**
 * 마이페이지를 띄운다 (기본 = Agent 업체 대표, 프로젝트 관리 대시보드)
 * opts.get(month, n) 로 답을 바꾼다 (month = 물은 달 '' = 이번 달, n = 몇 번째 읽기) · opts.gate = 둘째 읽기부터 붙잡을 약속
 */
async function load(options = {}) {
  const store = { reads: 0 };
  const opts = {
    session: SESSION,
    partner: partnerOf('agent', 'owner'),
    hash: '#dash-project',
    get: null,
    gate: null,
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
    'SeganCompanySummary',
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
    if (url.startsWith(WORK + '/company/summary')) {
      store.reads += 1;
      const n = store.reads;
      const month = url.includes('?month=') ? decodeURIComponent(url.split('?month=')[1]) : '';
      if (opts.gate && n > 1) await opts.gate;
      return reply(opts.get ? await opts.get(month, n) : summary(month || '2026-11'));
    }
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
    'segan/company-summary.js',
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
const q = (sel) => box().querySelector(sel);
const part = (name) => q(`[data-cs="${name}"]`);
const act = (name) => q(`[data-act="${name}"]`);
const kpis = (root) =>
  Object.fromEntries(
    [...root.querySelectorAll('dl > div')].map((d) => [
      text(d.querySelector('dt')),
      text(d.querySelector('dd')),
    ])
  );
const press = async (el) => {
  el.click();
  await flush();
};
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/company/summary'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 대시보드 칸(#meDash) 안, 숫자 칸 다음이 업무 달력 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('meNumbers');
    expect(el).not.toBeNull();
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('meDash');
    expect(el.previousElementSibling.id).toBe('meDashBody');
    expect(el.nextElementSibling.id).toBe('meCalendar');
    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('aria-labelledby')).toBe('meNumbersTitle');
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['company-summary.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('company-summary.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'company-summary.js')");
  });

  test('등급 · 직책은 서버와 같다. 서버에 그 주소가 있다', () => {
    const S = mod();
    expect(S.PLANS).toEqual(['manager', 'expert', 'agent']);
    expect(S.ROLES).toEqual(['owner', 'manager']);
    expect(read('workers/workflow-api/src/supabase.js')).toContain(
      "MONEY_ROLES = Object.freeze(['owner', 'manager'])"
    );
    expect(read('workers/workflow-api/src/worker.js')).toContain("path: '/company/summary'");
  });

  test('보기만 한다 — 서버에 쓰지 않고, 기기에 남기지 않고, 확인 창도 띄우지 않는다', () => {
    const code = read('segan/company-summary.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/method:/); // GET 만
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
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

  test('shiftMonth · monthLabel · dayLabel · countRate', () => {
    const S = mod();
    expect(S.shiftMonth('2026-11', -1)).toBe('2026-10');
    expect(S.shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(S.shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(S.shiftMonth('엉뚱', 1)).toBe('');
    expect(S.monthLabel('2026-03')).toBe('2026년 3월');
    expect(S.monthLabel('2026-13')).toBe('');
    expect(S.dayLabel('2026-05-16')).toBe('05.16');
    expect(S.dayLabel('x')).toBe('');
    expect(S.countRate(3, 42.9)).toBe('3건 (42.9%)');
    expect(S.countRate(0, null)).toBe('0건');
    expect(S.countRate(null, 10)).toBe('-');
  });

  test('viewOf — 달이 틀리거나 funnel 이 없으면 null. 숫자가 아닌 값은 0 또는 null, lead 가 없으면 null', () => {
    const S = mod();
    expect(S.viewOf(null)).toBeNull();
    expect(S.viewOf({ month: '2026-11' })).toBeNull();
    expect(S.viewOf({ month: '11월', funnel: FUNNEL() })).toBeNull();
    expect(S.viewOf({ month: '2026-11', funnel: [] })).toBeNull();
    const v = S.viewOf({
      month: '2026-11',
      funnel: { issued: '7', leads: null, conversion: 'x' },
      lead: null,
    });
    expect(v.funnel).toMatchObject({
      issued: 0,
      leads: null,
      conversion: null,
      reasons: [],
      noReason: 0,
    });
    expect(v.lead).toBeNull();
    const full = S.viewOf({ month: '2026-11', funnel: FUNNEL(), lead: LEAD() });
    expect(full.funnel.reasons).toEqual([{ label: '금액', count: 1 }]);
    expect(full.lead).toMatchObject({
      start: '2026-05-16',
      end: '2026-11-11',
      orders: 14,
      total: 26.5,
      overdue: 1,
    });
    expect(full.lead.slowest).toEqual({ label: '제작', days: 9 });
    expect(full.lead.stages[3]).toEqual({ label: '제작 완료 → 설치', n: 0, days: null });
  });
});

describe('화면', () => {
  test('대표 — 이번 달을 한 번 읽어 견적 흐름 · 리드타임 · 설치 납기를 그린다', async () => {
    const calls = await load();
    expect(asked(calls)).toEqual(['GET /company/summary']);
    const c = calls.fetch.find((x) => x.url.startsWith(WORK + '/company/summary'));
    expect(c.auth).toBe('Bearer tok-1');
    expect(c.cache).toBe('no-store');
    expect(seen('meNumbers')).toBe(true);
    expect(text($('meNumbersTitle'))).toBe('우리 팩토리 숫자');
    expect(text(part('month'))).toBe('2026년 11월');
    expect(act('next').disabled).toBe(true); // 이번 달 뒤로는 못 간다
    expect(act('prev').disabled).toBe(false);
    expect(kpis(part('funnel'))).toEqual({
      상담: '9건',
      '견적 보냄': '7건',
      '고객이 봄': '6건 (85.7%)',
      '고객 확인 완료': '3건 (42.9%)',
      수주: '2건 (66.7%)',
      '답 기다림': '3건',
      '수정 요청': '1건',
    });
    expect(text(part('times'))).toBe(
      '설계 한 건에 견적서 평균 1.4번 · 보내고 열어 보기까지 5.5시간 (중간값) · 보내고 결정까지 3.2일 (중간값)'
    );
    expect(text(part('reasons'))).toBe('수정 요청 사유 — 금액 1 · 사유 없음 1');
    expect(text(part('lead').querySelector('.mk-note'))).toBe(
      '2026.05.16 ~ 11.11에 설치를 끝낸 수주로 셉니다.'
    );
    expect(
      kpis(part('stages').parentElement.querySelector('[data-cs="stages"]').parentElement)
    ).toMatchObject({
      '수주 → 설치': '26.5일 · 14건',
      '수주 → 실측': '3일',
      '실측 → 제작 착수': '6.5일',
      제작: '9일',
      '제작 완료 → 설치': '-',
    });
    expect(text(part('slowest'))).toBe('가장 오래 걸리는 단계 — 제작 9일');
    const install = part('install');
    expect(
      Object.fromEntries(
        [...install.children].map((d) => [text(d.querySelector('dt')), text(d.querySelector('dd'))])
      )
    ).toEqual({
      '끝낸 설치': '14건',
      '처음 잡은 날 안에': '11건 (78.6%)',
      '늦으면 평균': '2.3일',
      '일정을 미룬 설치': '4건',
      '잡힌 날이 지난 설치': '1건',
    });
    expect(install.querySelector('[data-k="overdue"]').classList.contains('as-warn')).toBe(true);
  });

  test('보낸 견적서가 없는 달 — 안내 글. 지난 설치가 없으면 도드라지게 하지 않는다. 일정을 못 읽었으면 리드타임 묶음이 없다', async () => {
    await load({
      get: () =>
        summary('2026-11', NO_FUNNEL(), LEAD({ install: { ...LEAD().install, overdue: 0 } })),
    });
    expect(text(part('nofunnel'))).toBe('이 달에 처음 보낸 견적서가 없습니다.');
    expect(kpis(part('funnel'))).toEqual({ 상담: '0건' });
    expect(part('times')).toBeNull();
    expect(part('reasons')).toBeNull();
    expect(q('[data-k="overdue"]').classList.contains('as-warn')).toBe(false);
    await load({ get: () => summary('2026-11', FUNNEL({ leads: null }), null) });
    expect(part('lead')).toBeNull();
    expect(kpis(part('funnel'))['상담']).toBeUndefined(); // 상담을 못 읽었으면 그 칸을 뺀다
  });

  test('반년 동안 끝낸 설치가 없으면 — 그 말만, 설치 납기 칸은 0 과 -', async () => {
    const none = LEAD({
      orders: 0,
      totalMedianDays: null,
      slowest: null,
      install: {
        done: 0,
        onTime: 0,
        onTimeRate: null,
        avgLateDays: null,
        rescheduled: 0,
        overdue: 0,
      },
    });
    await load({ get: () => summary('2026-11', FUNNEL(), none) });
    expect(text(part('nolead'))).toBe('이 기간에 설치를 끝낸 수주가 없습니다.');
    expect(part('stages')).toBeNull();
    expect(part('slowest')).toBeNull();
    expect(text(q('[data-k="ontime"] dd'))).toBe('-');
    expect(text(q('[data-k="late"] dd'))).toBe('-');
  });

  test('프로젝트 관리 대시보드에서만 보인다', async () => {
    await load({ hash: '#p-quote' });
    expect(seen('meNumbers')).toBe(false);
    window.location.hash = '#dash-project';
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(seen('meNumbers')).toBe(true);
  });

  test('단계 이름은 서버 글을 글자 그대로 그린다', async () => {
    const lead = LEAD();
    lead.stages[0].label = '<img src=x onerror=1>';
    lead.slowest.label = '<script>x</script>';
    await load({ get: () => summary('2026-11', FUNNEL(), lead) });
    expect(q('img')).toBeNull();
    expect(q('script')).toBeNull();
    expect(text(part('slowest'))).toContain('<script>x</script>');
  });
});

describe('달 고르기', () => {
  test('「지난 달」 — 그 달을 읽어 숫자를 바꾼다. 「다음 달」은 이번 달까지만', async () => {
    const calls = await load({
      get: (month) =>
        summary(
          month || '2026-11',
          month === '2026-10' ? FUNNEL({ issued: 10, leads: 12 }) : FUNNEL()
        ),
    });
    await press(act('prev'));
    expect(asked(calls)).toEqual(['GET /company/summary', 'GET /company/summary?month=2026-10']);
    expect(text(part('month'))).toBe('2026년 10월');
    expect(kpis(part('funnel'))['견적 보냄']).toBe('10건');
    expect(act('next').disabled).toBe(false);
    await press(act('next'));
    expect(text(part('month'))).toBe('2026년 11월');
    expect(act('next').disabled).toBe(true);
    await press(act('next'));
    expect(asked(calls).length).toBe(3); // 이번 달 뒤로는 묻지 않는다
  });

  test('읽는 동안 — 단추를 잠그고 다시 눌러도 한 번만 읽는다. 있던 숫자는 그대로', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const calls = await load({ gate });
    await press(act('prev'));
    expect(box().getAttribute('aria-busy')).toBe('true');
    expect(text(part('status'))).toBe('불러오는 중…');
    expect(act('prev').disabled).toBe(true);
    expect(kpis(part('funnel'))['견적 보냄']).toBe('7건');
    await press(act('prev'));
    release();
    await flush();
    await flush();
    expect(asked(calls).length).toBe(2);
    expect(box().hasAttribute('aria-busy')).toBe(false);
    expect(text(part('month'))).toBe('2026년 10월');
  });

  test('달을 바꾸다 못 읽으면 — 있던 달 · 숫자는 그대로 두고 글만 남긴다', async () => {
    for (const second of [
      () => fail(500, 'x', ''),
      () => new Error('offline'),
      () => ok({ month: '2026-10' }),
    ]) {
      await load({ get: (month, n) => (n === 1 ? summary('2026-11') : second()) });
      await press(act('prev'));
      expect(text(part('err'))).toBe('불러오지 못했습니다.');
      expect(text(part('month'))).toBe('2026년 11월');
      expect(kpis(part('funnel'))['견적 보냄']).toBe('7건');
      expect(seen('meNumbers')).toBe(true);
    }
  }, 20000);
});

describe('안 보이는 때', () => {
  test('업체 직원 · 본사 구성원 · 업체 없는 사람 · 멈춘 업체 · 로그인하지 않은 사람 · 워커 주소 없음 — 묻지 않는다', async () => {
    for (const o of [
      { partner: partnerOf('agent', 'staff') },
      { partner: PLATFORM },
      { partner: NOBODY },
      { partner: partnerOf('agent', 'owner', 'suspended') },
      { session: null },
      { work: '' },
    ]) {
      const calls = await load(o);
      expect(asked(calls)).toEqual([]);
      expect(seen('meNumbers')).toBe(false);
      expect(box().innerHTML).toBe('');
    }
  }, 30000);

  test('처음에 못 읽으면(다담 공장 직원 403 · 오류 · 끊김 · 이상한 답) — 칸째 감춘다', async () => {
    for (const [partner, get] of [
      [HQ, () => fail(403, 'not_manager', '팩토리 대표 · 실장만 할 수 있습니다')],
      [undefined, () => fail(404, 'not_found', 'Not found')],
      [undefined, () => new Error('offline')],
      [undefined, () => ok({ month: '2026-11' })],
      [undefined, () => ok(null)],
    ]) {
      const calls = await load(partner ? { partner, get } : { get });
      expect(asked(calls)).toEqual(['GET /company/summary']);
      expect(seen('meNumbers')).toBe(false);
      expect(box().hidden).toBe(true);
      expect(box().innerHTML).toBe('');
    }
  }, 30000);

  test('다담 공장 구성원 · Manager 업체 대표 — 보인다', async () => {
    for (const partner of [HQ, partnerOf('manager', 'manager')]) {
      const calls = await load({ partner });
      expect(asked(calls)).toEqual(['GET /company/summary']);
      expect(seen('meNumbers')).toBe(true);
    }
  }, 20000);
});
