/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, navigator, DOMParser, sessionStorage, jest, setTimeout, Element */
/**
 * SEGAN 「내 정보」 업체 칸 (segan/partner.js + segan/me.html #partner)
 *
 *   데이터  account-api GET /partner/me · payments-api GET /plans (금액) · credit_plans (월 크레딧)
 *           · RPC my_credit_wallet (업체 통장) — 금액 · 크레딧을 적어 두지 않는다
 *   감춤    /partner/me 를 못 읽으면(404 · 오류 · 주소 없음) · 본사 구성원이면 칸째 감춘다
 *   화면    a 업체로 시작하기(Expert · Agent) / b 신청 접수 · 미팅 / c 승인 / d 보류 / e 업체 있음
 *   결제    billing.html(결제 관리)과 같은 토스 requestBillingAuth → billing-success.html?plan=…,
 *           떠나기 전 sessionStorage partnerSignup = { plan, company?, returnTo: '/segan/me.html#partner' }
 *   주소    me.html#partner 로 오면 업체 칸으로 내려간다, ?failed=1 이면 안내
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const AuthRedirect = require('../js/auth-redirect.js');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'owner@example.com' } };
const PAY = 'https://pay.example.workers.dev';
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const ORIGIN = 'http://localhost';
const CO = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const INV1 = '44444444-4444-4444-8444-444444444444';
const INV2 = '55555555-5555-4555-8555-555555555555';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';

const PLANS = {
  success: true,
  data: {
    client_key: 'test_ck_1',
    plans: [
      { id: 'expert', name: 'Expert', price_krw: 99000, order_name: 'x' },
      { id: 'agent', name: 'Agent', price_krw: 199000, order_name: 'y' },
    ],
  },
};
const CREDIT_PLANS = [
  { tier: 'standard', monthly_credits: 100 },
  { tier: 'expert', monthly_credits: 1000 },
  { tier: 'agent', monthly_credits: 3000 },
];

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, error, extra = {}) => ({
  ok: false,
  status,
  body: { success: false, code, error, ...extra },
});
const meData = (extra = {}) => ({
  company: null,
  application: null,
  members: [],
  invites: [],
  ...extra,
});
const app = (extra = {}) => ({
  id: '66666666-6666-4666-8666-666666666666',
  kind: 'new',
  status: 'applied',
  company_name: '다담 협력 주방',
  sido: '대구광역시',
  gugun: '북구',
  meeting_at: null,
  decided_at: null,
  used_at: null,
  created_at: '2026-10-20T03:00:00Z',
  ...extra,
});
const company = (extra = {}) => ({
  id: CO,
  name: '다담 협력 주방',
  plan: 'agent',
  next_plan: null,
  status: 'active',
  sido: '대구광역시',
  gugun: '북구',
  role: 'owner',
  created_at: '2026-10-01T00:00:00Z',
  ...extra,
});
const MEMBERS = [
  {
    user_id: 'user-1',
    name: '김대표',
    email: 'owner@example.com',
    role: 'owner',
    status: 'active',
    joined_at: '2026-10-01T00:00:00Z',
  },
  {
    user_id: U2,
    name: '이실장',
    email: 'manager@example.com',
    role: 'manager',
    status: 'active',
    joined_at: '2026-10-05T00:00:00Z',
  },
  {
    user_id: U3,
    name: '박직원',
    email: 'staff@example.com',
    role: 'staff',
    status: 'removed',
    joined_at: '2026-10-06T00:00:00Z',
  },
];
const INVITES = [
  {
    id: INV1,
    role: 'staff',
    created_at: '2026-10-27T00:00:00Z',
    expires_at: '2099-11-04T15:30:00Z',
    accepted_at: null,
    revoked_at: null,
  },
  // 쓴 것 · 취소한 것 · 만료된 것은 보이지 않는다
  {
    id: INV2,
    role: 'manager',
    created_at: '2026-10-01T00:00:00Z',
    expires_at: '2099-10-08T00:00:00Z',
    accepted_at: '2026-10-02T00:00:00Z',
    revoked_at: null,
  },
  {
    id: '77777777-7777-4777-8777-777777777777',
    role: 'manager',
    created_at: '2026-10-01T00:00:00Z',
    expires_at: '2099-10-08T00:00:00Z',
    accepted_at: null,
    revoked_at: '2026-10-03T00:00:00Z',
  },
  {
    id: '88888888-8888-4888-8888-888888888888',
    role: 'staff',
    created_at: '2020-10-01T00:00:00Z',
    expires_at: '2020-10-08T00:00:00Z',
    accepted_at: null,
    revoked_at: null,
  },
];
const companyWallet = (extra = {}) => [
  {
    scope: 'company',
    company_id: CO,
    plan: 'agent',
    balance: 2400,
    monthly: 3000,
    period_end: '2026-11-20T00:00:00Z',
    usable: true,
    ...extra,
  },
];

/**
 * me.html 을 올린다. opts.partner: GET /partner/me 응답 (목록이면 차례로, 마지막을 되풀이)
 * opts.posts: { 'POST 경로': 응답 }
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    url: '/segan/me.html',
    accountUrl: ACC,
    partner: fail(404, 'not_found', 'Not found'),
    plans: { ok: true, status: 200, body: PLANS },
    credits: CREDIT_PLANS,
    wallet: [
      {
        scope: 'personal',
        company_id: null,
        plan: 'standard',
        balance: 100,
        monthly: 100,
        period_end: null,
        usable: true,
      },
    ],
    posts: {},
    toss: undefined, // requestBillingAuth: 함수면 그 결과, Error 면 던짐 (기본: 끝나지 않는 약속 — 페이지를 떠난 셈)
    noToss: false,
    signup: undefined,
    ...options,
  };
  window.history.replaceState(null, '', opts.url);
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  if (opts.signup !== undefined) sessionStorage.setItem('partnerSignup', opts.signup);
  for (const k of [
    'AdminAccess',
    'DetailDesignAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganMake',
    'SeganMe',
    'SeganPartner',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
    paymentsApi: { url: PAY },
    accountApi: { url: opts.accountUrl },
  };
  const calls = { fetch: [], rpc: [], tables: [], toss: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async (name) => {
        calls.rpc.push(name);
        if (name === 'my_credit_wallet') return { data: opts.wallet, error: null };
        return { data: false, error: null };
      },
      from: (table) => {
        calls.tables.push(table);
        const out = () => {
          if (table === 'credit_plans') return { data: opts.credits, error: null };
          if (table === 'credit_costs') return { data: { credits: 20 }, error: null };
          if (table === 'profiles') return { data: { tier: 'agent' }, error: null };
          if (table === 'consultations') return { data: [], error: null };
          return { data: null, error: null };
        };
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => out(),
          then: (resolve) => resolve(out()),
        };
        return chain;
      },
    }),
  };
  let meCalls = 0;
  window.fetch = jest.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.fetch.push({
      url,
      method,
      auth: (init.headers || {}).Authorization,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === PAY + '/subscription')
      return reply(ok({ plan: 'agent', status: 'active', next_charge_at: '2026-11-20T00:00:00Z' }));
    if (url === PAY + '/plans') return reply(opts.plans);
    if (url === WORK + '/me/projects') return reply(fail(404, 'not_found', 'x'));
    if (url === ACC + '/partner/me' && method === 'GET') {
      const list = Array.isArray(opts.partner) ? opts.partner : [opts.partner];
      return reply(list[Math.min(meCalls++, list.length - 1)]);
    }
    if (url.startsWith(ACC + '/') && method === 'POST') {
      const p = url.slice(ACC.length);
      return reply(opts.posts[p] || ok({}));
    }
    return reply(ok({ ready: true, worker: null })); // /work/me
  });
  if (!opts.noToss) {
    window.TossPayments = jest.fn((key) => ({
      requestBillingAuth: jest.fn((method, params) => {
        calls.toss.push({ key, method, params, signup: sessionStorage.getItem('partnerSignup') });
        if (opts.toss instanceof Error) throw opts.toss;
        if (typeof opts.toss === 'function') return opts.toss();
        return new Promise(() => {});
      }),
    }));
  }
  Element.prototype.scrollIntoView = jest.fn();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: jest.fn(async () => {}) },
  });
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of [
    'segan/regions.js',
    'segan/partner.js',
    'segan/shell.js',
    'segan/make.js',
    'segan/me.js',
  ])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganMe.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const section = () => $('partner');
const root = () => $('mePartner');
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const buttons = () =>
  [...root().querySelectorAll('button, a.mk-btn, a.sg-row')].map((b) => b.textContent);
const press = async (label) => {
  const b = [...root().querySelectorAll('button')].find((x) => x.textContent === label);
  expect([label, !!b]).toEqual([label, true]);
  b.click();
  await flush();
};
const facts = (scope = root()) =>
  Object.fromEntries(
    [...scope.querySelectorAll('.me-facts div')].map((d) => [
      d.querySelector('dt').textContent,
      d.querySelector('dd').textContent,
    ])
  );
const steps = (scope = root()) =>
  [...scope.querySelectorAll('.me-steps li')].map((s) => ({
    label: s.textContent,
    done: s.classList.contains('me-step--done'),
    now: s.getAttribute('aria-current') === 'step',
  }));
const posts = (calls) => calls.fetch.filter((f) => f.method === 'POST');
const meGets = (calls) => calls.fetch.filter((f) => f.url === ACC + '/partner/me');
const formOf = (kind) => root().querySelector(`[data-form="${kind}"]`);
const fill = (form, values) => {
  for (const [name, v] of Object.entries(values)) {
    const el = form.querySelector(`[name="${name}"]`);
    el.value = v;
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
};
const submit = async (form) => {
  form.querySelector('button[type="submit"]').click();
  await flush();
};
const formError = (form) => form.querySelector('[data-err]');

afterEach(() => jest.restoreAllMocks());

describe('칸 자리 · 감춤', () => {
  test('me.html — 내 프로젝트 바로 아래 id="partner" 칸, 처음엔 감춰 둔다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const sec = doc.getElementById('partner');
    expect(sec).not.toBeNull();
    expect(sec.hasAttribute('hidden')).toBe(true);
    expect(sec.previousElementSibling.id).toBe('meProjectSection');
    expect(sec.querySelector('h2').textContent).toBe('업체');
    // 토스 결제창 · 지역 목록 · 업체 칸 스크립트를 싣는다 (billing.html 과 같은 토스 주소)
    const srcs = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    const toss = read('billing.html').match(
      /<script src="(https:\/\/js\.tosspayments\.com[^"]+)"/
    )[1];
    expect(srcs).toContain(toss);
    expect(srcs.some((s) => /^regions\.js\?v=/.test(s))).toBe(true);
    expect(srcs.some((s) => /^partner\.js\?v=/.test(s))).toBe(true);
  });

  test.each([
    ['404 (아직 배포 전)', {}],
    ['500', { partner: fail(500, 'error', '오류') }],
    ['네트워크 실패', { partner: new TypeError('Failed to fetch') }],
    ['success 아님', { partner: { ok: true, status: 200, body: { success: false } } }],
    ['data 없음', { partner: { ok: true, status: 200, body: { success: true } } }],
    ['data 가 목록', { partner: ok([]) }],
    ['본사 구성원', { partner: ok(meData({ hq_member: true })) }],
  ])('못 읽으면 · 본사 구성원이면 칸째 감춘다 — %s', async (_name, extra) => {
    await load(extra);
    expect(section().hidden).toBe(true);
    expect(root().textContent).toBe('');
    // 다른 칸은 그대로 채워진다
    expect($('meSub').textContent).toBe('이용 중 · 다음 결제 2026.11.20');
  });

  test('account-api 주소가 없으면 묻지도 않는다', async () => {
    const calls = await load({ accountUrl: '' });
    expect(section().hidden).toBe(true);
    expect(calls.fetch.some((f) => /\/partner\//.test(f.url))).toBe(false);
  });

  test('본사 구성원이면 금액 · 크레딧도 읽지 않는다', async () => {
    const calls = await load({ partner: ok(meData({ hq_member: true })) });
    expect(calls.fetch.some((f) => f.url === PAY + '/plans')).toBe(false);
  });

  test('로그인 없으면 아무것도 읽지 않고, #partner 로 왔으면 로그인 뒤 같은 곳으로', async () => {
    const calls = await load({ session: null, url: '/segan/me.html#partner' });
    expect(calls.fetch).toEqual([]);
    expect(section().hidden).toBe(true);
    const href = document
      .querySelector('[data-auth-view="signed-out"] a.sg-btn')
      .getAttribute('href');
    expect(href).toBe('../login.html?redirect=' + encodeURIComponent('segan/me.html#partner'));
    const url = new URL(href, `${ORIGIN}/segan/me.html`);
    expect(AuthRedirect.fromSearch(url.search)).toBe('segan/me.html#partner');

    await load({ session: null });
    expect(
      document.querySelector('[data-auth-view="signed-out"] a.sg-btn').getAttribute('href')
    ).toBe('../login.html?redirect=' + encodeURIComponent('segan/me.html'));
  });

  test('본인 토큰으로 GET /partner/me', async () => {
    const calls = await load({ partner: ok(meData()) });
    expect(meGets(calls)).toEqual([
      { url: ACC + '/partner/me', method: 'GET', auth: 'Bearer tok-1', body: undefined },
    ]);
    expect(section().hidden).toBe(false);
  });
});

describe('a. 업체로 시작하기 — 카드 둘', () => {
  test('Expert · Agent — 월 금액은 /plans, 월 크레딧은 credit_plans, 시작 방법', async () => {
    const calls = await load({ partner: ok(meData()) });
    const cards = [...root().querySelectorAll('.me-pt-card')].map((c) => ({
      plan: c.getAttribute('data-plan'),
      name: c.querySelector('.me-pt-name').textContent,
      info: c.querySelector('.me-pt-info').textContent,
      how: c.querySelector('.me-pt-how').textContent,
      btn: c.querySelector('button').textContent,
    }));
    expect(cards).toEqual([
      {
        plan: 'expert',
        name: 'Expert',
        info: '월 99,000원 · 크레딧 월 1,000',
        how: '결제하면 바로 시작',
        btn: '업체로 시작하기',
      },
      {
        plan: 'agent',
        name: 'Agent',
        info: '월 199,000원 · 크레딧 월 3,000',
        how: '신청 → 현장 미팅 → 본사 승인',
        btn: '신청하기',
      },
    ]);
    expect(calls.tables).toContain('credit_plans');
    expect(calls.fetch.find((f) => f.url === PAY + '/plans').auth).toBeUndefined(); // 공개 주소
  });

  test('금액 · 크레딧을 적어 두지 않는다 — 서버 값이 바뀌면 화면도 바뀐다', async () => {
    await load({
      partner: ok(meData()),
      plans: ok({
        client_key: 'k',
        plans: [
          { id: 'expert', price_krw: 123000 },
          { id: 'agent', price_krw: 456000 },
        ],
      }),
      credits: [
        { tier: 'expert', monthly_credits: 1500 },
        { tier: 'agent', monthly_credits: 4500 },
      ],
    });
    expect([...root().querySelectorAll('.me-pt-info')].map((x) => x.textContent)).toEqual([
      '월 123,000원 · 크레딧 월 1,500',
      '월 456,000원 · 크레딧 월 4,500',
    ]);
    const src = read('segan/partner.js');
    expect(src).not.toMatch(/99,?000|199,?000|[^\d]1,000[^\d]|3,000/);
  });

  test('금액을 못 읽으면 금액만 빠진다', async () => {
    await load({ partner: ok(meData()), plans: fail(500, 'x', 'x') });
    expect([...root().querySelectorAll('.me-pt-info')].map((x) => x.textContent)).toEqual([
      '크레딧 월 1,000',
      '크레딧 월 3,000',
    ]);
  });

  test('신청을 거둔 사람 · 쓴 승인 · 업그레이드 신청만 남은 사람도 시작 카드', async () => {
    for (const a of [
      app({ status: 'withdrawn' }),
      app({ status: 'approved', used_at: '2026-10-21T00:00:00Z' }),
      app({ kind: 'upgrade', status: 'approved', used_at: '2026-10-21T00:00:00Z' }),
    ]) {
      await load({ partner: ok(meData({ application: a })) });
      expect(root().querySelectorAll('.me-pt-card')).toHaveLength(2);
    }
  });
});

describe('Expert — 업체 이름 · 지역 → 토스 카드 등록', () => {
  const open = async (extra = {}) => {
    const calls = await load({ partner: ok(meData()), ...extra });
    await press('업체로 시작하기');
    return calls;
  };

  test('입력 칸 — 업체 이름 · 시·도(signup.html 과 같은 목록) · 시·군·구(시·도 고른 뒤)', async () => {
    await open();
    const form = formOf('expert');
    expect(form).not.toBeNull();
    const sido = form.querySelector('select[name="sido"]');
    const gugun = form.querySelector('select[name="gugun"]');
    expect([...sido.options].slice(1).map((o) => o.value)).toEqual(
      Object.keys(window.SeganRegions)
    );
    expect(gugun.disabled).toBe(true);
    fill(form, { sido: '대구광역시' });
    expect(gugun.disabled).toBe(false);
    expect([...gugun.options].slice(1).map((o) => o.value)).toEqual(
      window.SeganRegions['대구광역시']
    );
    // 다시 누르면 닫힌다
    await press('업체로 시작하기');
    expect(formOf('expert')).toBeNull();
  });

  test.each([
    [{}, '업체 이름을 적어 주세요.', 'name'],
    [{ name: '   ' }, '업체 이름을 적어 주세요.', 'name'],
    [{ name: '다담 협력' }, '시·도와 시·군·구를 골라 주세요.', 'sido'],
    [{ name: '다담 협력', sido: '대구광역시' }, '시·도와 시·군·구를 골라 주세요.', 'gugun'],
  ])('빠진 칸 %j → 안내, 결제창을 열지 않는다', async (values, msg, field) => {
    const calls = await open();
    const form = formOf('expert');
    fill(form, values);
    await submit(form);
    expect(formError(form).hidden).toBe(false);
    expect(formError(form).textContent).toBe(msg);
    expect(form.querySelector(`[name="${field}"]`).getAttribute('aria-invalid')).toBe('true');
    expect(calls.toss).toEqual([]);
    expect(sessionStorage.getItem('partnerSignup')).toBeNull();
  });

  test('다 적으면 partnerSignup 을 두고 billing.html 과 같은 토스 카드 등록', async () => {
    const calls = await open();
    const form = formOf('expert');
    fill(form, { name: '  다담 협력 주방 ', sido: '대구광역시', gugun: '북구' });
    await submit(form);
    expect(calls.toss).toHaveLength(1);
    const t = calls.toss[0];
    expect(t.key).toBe('test_ck_1');
    expect(t.method).toBe('CARD');
    expect(t.params).toEqual({
      customerKey: 'dadam-user-1',
      successUrl: `${ORIGIN}/billing-success.html?plan=expert`,
      failUrl: `${ORIGIN}/segan/me.html?failed=1`,
    });
    // 결제창을 열기 전에 이미 담겨 있다
    expect(JSON.parse(t.signup)).toEqual({
      plan: 'expert',
      company: { name: '다담 협력 주방', sido: '대구광역시', gugun: '북구' },
      returnTo: '/segan/me.html#partner', // billing-success.html 의 「돌아가기」
    });
    expect(JSON.parse(sessionStorage.getItem('partnerSignup'))).toEqual(JSON.parse(t.signup));
    // billing.html(결제 관리)의 customerKey · successUrl 모양과 같다
    const billing = read('billing.html');
    expect(billing).toContain("customerKey: 'dadam-' + session.user.id");
    expect(billing).toContain("'/billing-success.html?plan=' + encodeURIComponent(");
    // 서버에는 아무것도 보내지 않았다 (업체는 결제 뒤 결제 서버가 만든다)
    expect(posts(calls)).toEqual([]);
  });

  test('창을 닫으면(USER_CANCEL) 조용히 지운다, 못 열면 지우고 안내', async () => {
    await open({
      toss: () => Promise.reject(Object.assign(new Error('취소'), { code: 'USER_CANCEL' })),
    });
    let form = formOf('expert');
    fill(form, { name: '다담', sido: '대구광역시', gugun: '북구' });
    await submit(form);
    expect(sessionStorage.getItem('partnerSignup')).toBeNull();
    expect(formError(form).hidden).toBe(true);

    await open({
      toss: () => Promise.reject(Object.assign(new Error('잘못된 키'), { code: 'X' })),
    });
    form = formOf('expert');
    fill(form, { name: '다담', sido: '대구광역시', gugun: '북구' });
    await submit(form);
    expect(sessionStorage.getItem('partnerSignup')).toBeNull();
    expect(formError(form).textContent).toBe('결제창을 열지 못했습니다. 잘못된 키');

    await open({ toss: new Error('던짐') });
    form = formOf('expert');
    fill(form, { name: '다담', sido: '대구광역시', gugun: '북구' });
    await submit(form);
    expect(sessionStorage.getItem('partnerSignup')).toBeNull();
    expect(formError(form).textContent).toBe('결제창을 열지 못했습니다. 던짐');
  });

  test.each([
    ['client_key 없음', { plans: ok({ client_key: '', plans: [] }) }],
    ['토스 모듈 없음', { noToss: true }],
  ])('%s — 결제 모듈 안내, partnerSignup 을 두지 않는다', async (_name, extra) => {
    await open(extra);
    const form = formOf('expert');
    fill(form, { name: '다담', sido: '대구광역시', gugun: '북구' });
    await submit(form);
    expect(formError(form).textContent).toBe(
      '결제 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
    );
    expect(sessionStorage.getItem('partnerSignup')).toBeNull();
  });
});

describe('Agent 신청 — 칸 7개 → POST /partner/apply', () => {
  const VALID = {
    company_name: ' 다담 협력 주방 ',
    representative_name: '김대표',
    contact_phone: '010-1234-5678',
    sido: '대구광역시',
    gugun: '북구',
    business_number: '123-45-67890',
    intro: ' 주방 · 붙박이장 시공 ',
  };
  const open = async (extra = {}) => {
    const calls = await load({ partner: ok(meData()), ...extra });
    await press('신청하기');
    return calls;
  };

  test('칸 7개 (업체 이름 · 대표자 이름 · 연락처 · 시·도 · 시·군·구 · 사업자등록번호 · 하는 일 한 줄)', async () => {
    await open();
    const form = formOf('apply');
    expect([...form.querySelectorAll('input, select')].map((x) => x.name)).toEqual([
      'company_name',
      'representative_name',
      'contact_phone',
      'sido',
      'gugun',
      'business_number',
      'intro',
    ]);
    expect([...form.querySelectorAll('label > span')].map((s) => s.textContent)).toEqual([
      '업체 이름',
      '대표자 이름',
      '연락처',
      '시·도',
      '시·군·구',
      '사업자등록번호',
      '하는 일 한 줄',
    ]);
    // 길이 제한 = DB CHECK
    const max = (n) => form.querySelector(`[name="${n}"]`).getAttribute('maxlength');
    expect([max('company_name'), max('representative_name'), max('intro')]).toEqual([
      '100',
      '50',
      '200',
    ]);
  });

  test.each([
    [{ contact_phone: '010 1234 5678' }, 'contact_phone', '연락처는 숫자와 - 로 적어 주세요.'],
    [{ contact_phone: '1234' }, 'contact_phone', '연락처는 숫자와 - 로 적어 주세요.'],
    [{ business_number: '12-345-67890' }, 'business_number', '사업자등록번호 10자리를'],
    [{ representative_name: '' }, 'representative_name', '대표자 이름을 적어 주세요.'],
    [{ intro: '  ' }, 'intro', '하는 일 한 줄을 적어 주세요.'],
    [{ gugun: '' }, 'gugun', '시·도와 시·군·구를 골라 주세요.'],
  ])('형식이 틀리면 보내지 않는다 %j', async (bad, field, msg) => {
    const calls = await open();
    const form = formOf('apply');
    fill(form, { ...VALID, ...bad });
    await submit(form);
    expect(formError(form).textContent).toContain(msg);
    expect(form.querySelector(`[name="${field}"]`).getAttribute('aria-invalid')).toBe('true');
    expect(posts(calls)).toEqual([]);
  });

  test('보내기 — 앞뒤 공백을 자른 칸 7개 · 본인 토큰, 받으면 신청 접수 단계', async () => {
    const created = app({ company_name: '다담 협력 주방' });
    const calls = await open({
      posts: { '/partner/apply': ok({ application: created }, 201) },
    });
    const form = formOf('apply');
    fill(form, VALID);
    await submit(form);
    const p = posts(calls);
    expect(p).toHaveLength(1);
    expect(p[0].url).toBe(ACC + '/partner/apply');
    expect(p[0].auth).toBe('Bearer tok-1');
    expect(p[0].body).toEqual({
      company_name: '다담 협력 주방',
      representative_name: '김대표',
      contact_phone: '010-1234-5678',
      sido: '대구광역시',
      gugun: '북구',
      business_number: '123-45-67890',
      intro: '주방 · 붙박이장 시공',
    });
    expect(root().querySelector('[data-view="pending"]')).not.toBeNull();
    expect(root().querySelector('.me-pt-msg').textContent).toBe(
      '신청을 받았습니다. 본사가 연락드립니다.'
    );
    expect(root().querySelectorAll('.me-pt-card')).toHaveLength(0);
  });

  test('422 — 서버 안내를 그 칸에', async () => {
    await open({
      posts: {
        '/partner/apply': fail(422, 'invalid', '사업자등록번호 형식이 맞지 않습니다.', {
          field: 'business_number',
        }),
      },
    });
    const form = formOf('apply');
    fill(form, VALID);
    await submit(form);
    expect(formError(form).textContent).toBe('사업자등록번호 형식이 맞지 않습니다.');
    expect(form.querySelector('[name="business_number"]').getAttribute('aria-invalid')).toBe(
      'true'
    );
  });

  test('409 — 다시 읽고 위에 서버 안내', async () => {
    const calls = await open({
      partner: [ok(meData()), ok(meData({ application: app() }))],
      posts: { '/partner/apply': fail(409, 'application_open', '이미 진행 중인 신청이 있습니다.') },
    });
    const form = formOf('apply');
    fill(form, VALID);
    await submit(form);
    expect(meGets(calls)).toHaveLength(2);
    expect(root().querySelector('.me-pt-err').textContent).toBe('이미 진행 중인 신청이 있습니다.');
    expect(root().querySelector('[data-view="pending"]')).not.toBeNull();
  });
});

describe('b. 신청 접수 · 미팅 — 단계 3칸 · 신청 거두기', () => {
  test('신청 접수 — 첫 칸이 지금, 업체 이름 · 지역 · 신청일(한국 날짜)', async () => {
    await load({ partner: ok(meData({ application: app() })) });
    expect(steps()).toEqual([
      { label: '신청 접수', done: true, now: true },
      { label: '미팅 예정', done: false, now: false },
      { label: '승인', done: false, now: false },
    ]);
    expect(facts()).toEqual({
      '업체 이름': '다담 협력 주방',
      지역: '대구광역시 북구',
      신청일: '2026.10.20',
    });
    expect(buttons()).toEqual(['신청 거두기']);
  });

  test('미팅 — 둘째 칸이 지금, 날짜 · 시각은 한국 시간', async () => {
    await load({
      partner: ok(
        meData({ application: app({ status: 'meeting', meeting_at: '2026-11-05T05:00:00Z' }) })
      ),
    });
    expect(steps().map((s) => s.now)).toEqual([false, true, false]);
    expect(steps().map((s) => s.done)).toEqual([true, true, false]);
    expect(facts()['미팅']).toBe('2026.11.05 (목) 14:00');
    expect(window.SeganPartner.kstTime('2026-11-04T15:30:00Z')).toBe('2026.11.05 (목) 00:30');
  });

  test('신청 거두기 — 한 번 더 묻고, 그만두면 보내지 않는다', async () => {
    const calls = await load({
      partner: ok(meData({ application: app() })),
      posts: {
        '/partner/apply/withdraw': ok({ application: app({ status: 'withdrawn' }) }),
      },
    });
    await press('신청 거두기');
    expect(root().querySelector('.me-pt-ask').textContent).toContain('신청을 거둘까요?');
    await press('그만두기');
    expect(root().querySelector('.me-pt-ask')).toBeNull();
    expect(posts(calls)).toEqual([]);

    await press('신청 거두기');
    await press('신청 거두기'); // 확인 칸의 단추
    expect(posts(calls).map((p) => p.url)).toEqual([ACC + '/partner/apply/withdraw']);
    expect(root().querySelector('.me-pt-msg').textContent).toBe('신청을 거두었습니다.');
    expect(root().querySelectorAll('.me-pt-card')).toHaveLength(2); // 다시 신청할 수 있다
  });

  test('거둘 신청이 없으면(404) 다시 읽고 서버 안내', async () => {
    const calls = await load({
      partner: [ok(meData({ application: app() })), ok(meData())],
      posts: { '/partner/apply/withdraw': fail(404, 'not_found', '거둘 신청이 없습니다.') },
    });
    await press('신청 거두기');
    await press('신청 거두기');
    expect(meGets(calls)).toHaveLength(2);
    expect(root().querySelector('.me-pt-err').textContent).toBe('거둘 신청이 없습니다.');
  });
});

describe('c. 승인 — 결제하고 시작 (Agent)', () => {
  test('승인 안내 · Agent 금액 · 결제하고 시작 → partnerSignup { plan: agent } → 토스', async () => {
    const calls = await load({
      partner: ok(meData({ application: app({ status: 'approved' }) })),
    });
    expect(root().querySelector('.me-pt-title').textContent).toBe('승인되었습니다');
    expect(root().querySelector('.me-pt-info').textContent).toBe('월 199,000원 · 크레딧 월 3,000');
    await press('결제하고 시작');
    expect(calls.toss).toHaveLength(1);
    expect(JSON.parse(calls.toss[0].signup)).toEqual({
      plan: 'agent',
      returnTo: '/segan/me.html#partner',
    });
    expect(calls.toss[0].params).toEqual({
      customerKey: 'dadam-user-1',
      successUrl: `${ORIGIN}/billing-success.html?plan=agent`,
      failUrl: `${ORIGIN}/segan/me.html?failed=1`,
    });
  });

  test('결제 모듈이 없으면 안내', async () => {
    await load({
      partner: ok(meData({ application: app({ status: 'approved' }) })),
      noToss: true,
    });
    await press('결제하고 시작');
    expect(root().querySelector('[data-err]').textContent).toBe(
      '결제 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
    );
    expect(sessionStorage.getItem('partnerSignup')).toBeNull();
  });
});

describe('d. 보류 — 안내 · 상담 신청 · 다시 신청', () => {
  test('보류 안내 + 상담 신청(사이트 상담 신청서) + 시작 카드', async () => {
    await load({ partner: ok(meData({ application: app({ status: 'held' }) })) });
    const held = root().querySelector('[data-view="held"]');
    expect(held.querySelector('.me-pt-title').textContent).toBe('보류되었습니다');
    const link = held.querySelector('a');
    expect(link.textContent).toBe('상담 신청');
    expect(link.getAttribute('href')).toBe('../consultation.html');
    expect(fs.existsSync(path.join(ROOT, 'segan', '../consultation.html'))).toBe(true);
    expect(root().querySelectorAll('.me-pt-card')).toHaveLength(2);
  });
});

describe('e. 업체 있음', () => {
  const owner = (extra = {}, data = {}) =>
    ok(meData({ company: company(extra), members: MEMBERS, invites: INVITES, ...data }));

  test('대표 — 업체 이름 · 등급 · 상태 · 내 역할 · 크레딧(업체 통장)', async () => {
    await load({ partner: owner(), wallet: companyWallet() });
    const box = root().querySelector('[data-view="company"]');
    expect(facts(box)).toEqual({
      '업체 이름': '다담 협력 주방',
      등급: 'Agent',
      상태: '이용 중',
      '내 역할': '대표',
      크레딧: '2,400 크레딧 · 월 3,000',
    });
    expect(root().querySelector('.me-pt-warn')).toBeNull();
    const billing = [...root().querySelectorAll('a.sg-row')].find(
      (a) => a.textContent === '결제 관리'
    );
    expect(billing.getAttribute('href')).toBe('../billing.html');
  });

  test('다음 결제일부터 바뀌는 등급', async () => {
    await load({ partner: owner({ next_plan: 'expert' }) });
    expect(facts(root().querySelector('[data-view="company"]'))['등급']).toBe(
      'Agent · 다음 결제일부터 Expert'
    );
  });

  test('다른 통장(내 통장 · 다른 업체)이면 크레딧 줄을 적지 않는다', async () => {
    await load({ partner: owner() });
    expect(facts(root().querySelector('[data-view="company"]'))['크레딧']).toBeUndefined();
    await load({ partner: owner(), wallet: companyWallet({ company_id: U2 }) });
    expect(facts(root().querySelector('[data-view="company"]'))['크레딧']).toBeUndefined();
  });

  test('직원 — 이름 · 역할 · 상태, 내보내기는 활동 중인 다른 직원만', async () => {
    await load({ partner: owner() });
    const rows = [...root().querySelectorAll('[data-member]')].map((li) => ({
      name: li.querySelector('.me-c-main b').textContent,
      state: li.querySelector('.me-badge').textContent,
      remove: !!li.querySelector('button'),
    }));
    expect(rows).toEqual([
      { name: '김대표', state: '대표 · 활동 중', remove: false },
      { name: '이실장', state: '실장 · 활동 중', remove: true },
      { name: '박직원', state: '직원 · 내보냄', remove: false },
    ]);
  });

  test('내보내기 — 한 번 더 묻고 POST /partner/members/:id/remove, 다시 읽는다', async () => {
    const calls = await load({
      partner: [owner(), owner({}, { members: MEMBERS.map((m) => ({ ...m, status: 'removed' })) })],
    });
    await press('내보내기');
    expect(root().querySelector('.me-pt-ask').textContent).toContain('이실장을 내보낼까요?');
    expect(posts(calls)).toEqual([]);
    await press('내보내기');
    expect(posts(calls).map((p) => [p.url, p.auth])).toEqual([
      [`${ACC}/partner/members/${U2}/remove`, 'Bearer tok-1'],
    ]);
    expect(meGets(calls)).toHaveLength(2);
    expect(root().querySelector('.me-pt-msg').textContent).toBe('내보냈습니다.');
  });

  test('내보내지 못하면(409) 서버 안내', async () => {
    await load({
      partner: owner(),
      posts: {
        [`/partner/members/${U2}/remove`]: fail(
          409,
          'cannot_remove',
          '내보낼 수 없는 구성원입니다.'
        ),
      },
    });
    await press('내보내기');
    await press('내보내기');
    expect(root().querySelector('.me-pt-err').textContent).toBe('내보낼 수 없는 구성원입니다.');
  });

  test('직원 초대 — 쓸 수 있는 초대만 보이고, 취소는 한 번 더 묻는다', async () => {
    const calls = await load({ partner: owner() });
    const invites = [...root().querySelectorAll('[data-invite]')];
    expect(invites.map((li) => li.getAttribute('data-invite'))).toEqual([INV1]);
    expect(invites[0].querySelector('.me-c-main').textContent).toBe('직원 초대2099.11.05까지');
    await press('초대 취소');
    expect(root().querySelector('.me-pt-ask').textContent).toContain('초대 링크를 못 쓰게');
    await press('초대 취소');
    expect(posts(calls).map((p) => p.url)).toEqual([`${ACC}/partner/invites/${INV1}/revoke`]);
    expect(root().querySelector('.me-pt-msg').textContent).toBe('초대를 취소했습니다.');
  });

  test('직원 초대 — 실장/직원 고름 → 링크 만들기 → join.html#t= 링크 · 복사', async () => {
    const calls = await load({
      partner: owner(),
      posts: {
        '/partner/invites': ok(
          { id: INV2, role: 'manager', expires_at: '2026-11-04T15:30:00Z', token: TOKEN },
          201
        ),
      },
    });
    await press('직원 초대');
    const box = formOf('invite');
    expect([...box.querySelectorAll('input[name="inviteRole"]')].map((r) => r.value)).toEqual([
      'manager',
      'staff',
    ]);
    expect([...box.querySelectorAll('.cs-opt b')].map((b) => b.textContent)).toEqual([
      '실장',
      '직원',
    ]);
    await press('링크 만들기');
    expect(formError(formOf('invite')).textContent).toBe('실장 · 직원 중에서 골라 주세요.');
    expect(posts(calls)).toEqual([]);

    formOf('invite').querySelector('input[value="manager"]').checked = true;
    await press('링크 만들기');
    expect(posts(calls).map((p) => [p.url, p.body])).toEqual([
      [`${ACC}/partner/invites`, { role: 'manager' }],
    ]);
    const link = `${ORIGIN}/segan/join.html#t=${TOKEN}`;
    expect(window.SeganPartner.inviteLink(ORIGIN, TOKEN)).toBe(link);
    expect($('mePartnerLink').value).toBe(link);
    const made = root().querySelector('[data-view="invite-link"]');
    expect(made.querySelector('.me-pt-title').textContent).toBe('실장 초대 링크');
    expect(made.textContent).toContain('2026.11.05까지 쓸 수 있습니다');
    expect(meGets(calls)).toHaveLength(2); // 초대 목록을 다시 읽는다
    await press('링크 복사');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(link);
    expect(root().querySelector('[data-copy]').textContent).toBe(
      '복사했습니다. 메시지로 보내 주세요.'
    );
  });

  test('복사를 못 하면 길게 눌러 복사 안내', async () => {
    await load({
      partner: owner(),
      posts: {
        '/partner/invites': ok({ id: INV2, role: 'staff', expires_at: null, token: TOKEN }),
      },
    });
    navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));
    await press('직원 초대');
    formOf('invite').querySelector('input[value="staff"]').checked = true;
    await press('링크 만들기');
    await press('링크 복사');
    expect(root().querySelector('[data-copy]').textContent).toBe(
      '복사하지 못했습니다. 링크를 길게 눌러 복사해 주세요.'
    );
  });

  test('토큰이 없는 응답이면 링크를 만들지 않는다', async () => {
    await load({
      partner: owner(),
      posts: { '/partner/invites': ok({ id: INV2, role: 'staff', expires_at: null }) },
    });
    await press('직원 초대');
    formOf('invite').querySelector('input[value="staff"]').checked = true;
    await press('링크 만들기');
    expect($('mePartnerLink')).toBeNull();
    expect(formError(formOf('invite')).hidden).toBe(false);
  });

  test('등급 바꾸기 — Agent → 다음 결제일부터 Expert (Expert 금액 · 크레딧), 한 번 더 묻는다', async () => {
    const calls = await load({ partner: [owner(), owner({ next_plan: 'expert' })] });
    const group = [...root().querySelectorAll('.me-pt-group')].find(
      (g) => g.querySelector('.me-pt-sub').textContent === '등급 바꾸기'
    );
    expect(group.querySelector('.me-pt-info').textContent).toBe('월 99,000원 · 크레딧 월 1,000');
    await press('다음 결제일부터 Expert 로 내리기');
    expect(posts(calls)).toEqual([]);
    await press('Expert 로 내리기');
    expect(posts(calls).map((p) => [p.url, p.body])).toEqual([
      [`${ACC}/partner/plan`, { next_plan: 'expert' }],
    ]);
    expect(root().querySelector('.me-pt-msg').textContent).toBe(
      '다음 결제일부터 Expert 로 바뀝니다.'
    );
    expect(buttons()).toContain('예약 취소');
  });

  test.each([
    ['expert', 'agent'],
    ['agent', 'expert'],
  ])(
    '예약 취소 (지금 %s, 예약 %s) → POST /partner/plan { next_plan: null }',
    async (plan, next) => {
      const calls = await load({ partner: owner({ plan, next_plan: next }) });
      expect(root().textContent).toContain(
        `다음 결제일부터 ${next === 'agent' ? 'Agent' : 'Expert'} 로 바뀝니다.`
      );
      await press('예약 취소');
      await press('예약 취소');
      expect(posts(calls).map((p) => [p.url, p.body])).toEqual([
        [`${ACC}/partner/plan`, { next_plan: null }],
      ]);
      expect(root().querySelector('.me-pt-msg').textContent).toBe('예약을 취소했습니다.');
    }
  );

  test('Expert → Agent 신청 (kind upgrade) — 업체 이름 · 지역 칸 없이, 업체 값으로 보낸다', async () => {
    const calls = await load({
      partner: owner({ plan: 'expert' }),
      posts: {
        '/partner/apply': ok({ application: app({ kind: 'upgrade' }) }, 201),
      },
    });
    expect(root().querySelector('.me-pt-group:last-of-type .me-pt-info')).not.toBeNull();
    await press('Agent 신청');
    const form = formOf('apply');
    expect([...form.querySelectorAll('input, select')].map((x) => x.name)).toEqual([
      'representative_name',
      'contact_phone',
      'business_number',
      'intro',
    ]);
    fill(form, {
      representative_name: '김대표',
      contact_phone: '053-123-4567',
      business_number: '1234567890',
      intro: '주방 시공',
    });
    await submit(form);
    expect(posts(calls)[0].body).toEqual({
      company_name: '다담 협력 주방',
      representative_name: '김대표',
      contact_phone: '053-123-4567',
      sido: '대구광역시',
      gugun: '북구',
      business_number: '1234567890',
      intro: '주방 시공',
    });
    // 업체 칸 안에서 진행 단계를 보인다
    const pending = root().querySelector('[data-view="pending"]');
    expect(pending.querySelector('.me-pt-title').textContent).toBe('Agent 로 바꾸기 신청');
    expect(root().querySelector('[data-view="company"]')).not.toBeNull();
  });

  test('Expert 업체의 열린 Agent 신청 · 보류된 신청', async () => {
    await load({
      partner: owner(
        { plan: 'expert' },
        { application: app({ kind: 'upgrade', status: 'meeting' }) }
      ),
    });
    expect(steps().map((s) => s.now)).toEqual([false, true, false]);
    expect(buttons()).toContain('신청 거두기');
    expect(buttons()).not.toContain('Agent 신청');

    await load({
      partner: owner({ plan: 'expert' }, { application: app({ kind: 'upgrade', status: 'held' }) }),
    });
    expect(root().querySelector('[data-view="held"]')).not.toBeNull();
    expect(buttons()).toContain('Agent 신청');
  });

  test('실장 · 직원 — 업체 이름 · 내 역할 · 크레딧만 (직원 목록 · 초대 · 결제 관리 없음)', async () => {
    for (const role of ['manager', 'staff']) {
      await load({
        partner: ok(meData({ company: company({ role }) })),
        wallet: companyWallet(),
      });
      expect(facts()).toEqual({
        '업체 이름': '다담 협력 주방',
        '내 역할': role === 'manager' ? '실장' : '직원',
        크레딧: '2,400 크레딧 · 월 3,000',
      });
      expect(buttons()).toEqual([]);
      expect(root().querySelectorAll('.me-pt-group')).toHaveLength(0);
    }
  });

  test('결제 멈춤 — 읽기만: 대표에게 결제 관리, 초대 · 등급 · 내보내기 없음', async () => {
    await load({ partner: owner({ status: 'suspended' }) });
    expect(root().querySelector('.me-pt-warn').textContent).toBe('결제가 멈춰 있어 읽기만 됩니다.');
    expect(facts(root().querySelector('[data-view="company"]'))['상태']).toBe('결제 멈춤');
    expect(buttons()).toEqual(['결제 관리']);
    expect(root().querySelectorAll('[data-member]')).toHaveLength(3);

    await load({
      partner: ok(meData({ company: company({ role: 'staff', status: 'suspended' }) })),
    });
    expect(root().querySelector('.me-pt-warn').textContent).toBe('결제가 멈춰 있어 읽기만 됩니다.');
    expect(buttons()).toEqual([]);
  });

  test('해지 — 「해지된 업체입니다」', async () => {
    await load({ partner: owner({ status: 'closed' }) });
    expect(root().querySelector('.me-pt-warn').textContent).toBe('해지된 업체입니다.');
    expect(facts(root().querySelector('[data-view="company"]'))['상태']).toBe('해지됨');
  });

  test('서버 글은 글자로만 넣는다 (업체 이름 · 직원 이름 · 이메일)', async () => {
    const bad = '<img src=x onerror=alert(1)>';
    await load({
      partner: ok(
        meData({
          company: company({ name: bad }),
          members: [{ ...MEMBERS[1], name: bad, email: bad }],
          invites: [],
        })
      ),
    });
    expect(root().querySelector('img')).toBeNull();
    expect(root().querySelector('[onerror]')).toBeNull();
    expect(root().textContent).toContain(bad);
  });
});

describe('주소 — #partner · ?failed=1', () => {
  test('me.html#partner 로 오면 업체 칸으로 내려간다', async () => {
    await load({ partner: ok(meData()), url: '/segan/me.html#partner' });
    expect(section().hidden).toBe(false);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(Element.prototype.scrollIntoView.mock.contexts[0]).toBe(section());
  });

  test('#partner 가 없으면 내려가지 않는다', async () => {
    await load({ partner: ok(meData()) });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  test('카드 등록이 끝나지 않고 돌아오면(?failed=1) 안내 · partnerSignup 지움 · 주소 정리', async () => {
    await load({
      partner: ok(meData()),
      url: '/segan/me.html?failed=1&code=PAY_PROCESS_CANCELED',
      signup: JSON.stringify({ plan: 'expert', company: { name: 'x', sido: 'y', gugun: 'z' } }),
    });
    expect(root().querySelector('.me-pt-err').textContent).toBe(
      '결제가 완료되지 않았습니다. 다시 시도해 주세요.'
    );
    expect(sessionStorage.getItem('partnerSignup')).toBeNull();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#partner');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});

describe('판정 · 본문 (순수 함수)', () => {
  test('viewOf — 화면 고르기', async () => {
    await load();
    const { viewOf } = window.SeganPartner;
    expect(viewOf(null)).toBe('hidden');
    expect(viewOf(meData({ hq_member: true, company: null }))).toBe('hidden');
    expect(viewOf(meData())).toBe('start');
    expect(viewOf(meData({ company: company() }))).toBe('company');
    expect(viewOf(meData({ application: app() }))).toBe('pending');
    expect(viewOf(meData({ application: app({ status: 'meeting' }) }))).toBe('pending');
    expect(viewOf(meData({ application: app({ status: 'approved' }) }))).toBe('approved');
    expect(viewOf(meData({ application: app({ status: 'held' }) }))).toBe('held');
    expect(viewOf(meData({ application: app({ status: 'withdrawn' }) }))).toBe('start');
  });

  test('applyBody · expertCompany · openInvites', async () => {
    await load();
    const { applyBody, expertCompany, openInvites } = window.SeganPartner;
    expect(applyBody({}).field).toBe('company_name');
    expect(
      applyBody({
        company_name: 'a'.repeat(101),
        representative_name: 'b',
        contact_phone: '01012345678',
        sido: 's',
        gugun: 'g',
        business_number: '1234567890',
        intro: 'i',
      })
    ).toEqual({ field: 'company_name', error: '업체 이름은 100자까지 적을 수 있습니다.' });
    expect(expertCompany({ name: ' A ', sido: 'S', gugun: 'G' })).toEqual({
      company: { name: 'A', sido: 'S', gugun: 'G' },
    });
    expect(openInvites(INVITES, Date.parse('2026-10-28T00:00:00Z')).map((i) => i.id)).toEqual([
      INV1,
    ]);
    expect(openInvites(null)).toEqual([]);
  });

  test('partnerSignup 키 이름 — billing-success.html 이 읽는 이름', async () => {
    await load();
    expect(window.SeganPartner.SIGNUP_KEY).toBe('partnerSignup');
  });
});
