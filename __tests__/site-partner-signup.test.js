/**
 * 사이트 쪽 업체 가입 · 업체 구독 화면.
 *
 *   pricing.html          Expert · Agent 는 업체 구독 — 결제창을 열지 않는다. 업체 가입은 새 앱에서 열리므로
 *                         비활성 안내 「업체 가입은 새 앱에서 열립니다」 + 상담 신청 링크만 둔다 (새 앱 링크 없음).
 *   billing-success.html  sessionStorage partnerSignup({ plan, company? })을 읽어 /issue-billing-key 에 plan · company 를
 *                         함께 보내고, 요청이 끝나면 지운다. 결제 전에 막힌 409 · 403 · 422 는 code 별 한국어 안내.
 *   billing.html          업체 구독이면 업체 이름 · 등급 · 다음 결제일 등급. 카드 바꾸기 · 해지 · 다시 결제는 대표만,
 *                         실장 · 직원은 「업체 구독은 대표가 관리합니다」. 크레딧은 my_credit_wallet.
 *   js/site-shell.js      머리말 크레딧 = my_credit_wallet.
 * 페이지 스크립트를 jsdom 에 올리고 가짜 Supabase · 가짜 fetch · 가짜 토스로 돌린다.
 */
const fs = require('fs');
const path = require('path');

const read = (rel) =>
  fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .split('\r\n')
    .join('\n');

const PAY = 'https://pay.test';
const TOKEN = 'user-access-token';
const USER = { id: 'u1', email: 'owner@example.test', user_metadata: {} };
const SESSION = { access_token: TOKEN, user: USER };

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const $ = (id) => document.getElementById(id);

/** 어떤 메서드를 이어 불러도 자기를 돌려주고, await 하면 정해 둔 결과를 내는 가짜 쿼리 */
function query(result) {
  const q = {};
  for (const m of ['select', 'order', 'limit', 'eq', 'in', 'single', 'maybeSingle']) q[m] = () => q;
  q.then = (ok, ng) => Promise.resolve(result).then(ok, ng);
  return q;
}

/**
 * 가짜 Supabase. tables[table] = 결과, rpcs[name] = 결과. 읽은 표 · 부른 RPC 를 log 에 남긴다.
 */
function fakeSupabase({ tables = {}, rpcs = {}, session = SESSION } = {}) {
  const log = { tables: [], rpcs: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session } }), signOut: async () => ({}) },
      from: (t) => {
        log.tables.push(t);
        return query(tables[t] || { data: null, error: null });
      },
      rpc: async (name) => {
        log.rpcs.push(name);
        return rpcs[name] || { data: null, error: { message: 'no rpc' } };
      },
    }),
  };
  return log;
}

/** 페이지의 첫 인라인 스크립트와 그 앞의 body 를 올린다 */
function mountPage(rel) {
  const html = read(rel);
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
  const bodyStart = html.indexOf('>', html.indexOf('<body')) + 1;
  document.body.innerHTML = html.slice(bodyStart, html.indexOf('<script>\n'));
  return script;
}

function fakeFetch(route) {
  const calls = [];
  window.fetch = jest.fn(async (url, init = {}) => {
    const u = new URL(url);
    const c = {
      url,
      method: init.method || 'GET',
      path: u.pathname,
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(c);
    return route(c) || json(404, { success: false, message: 'Not found' });
  });
  return calls;
}

function fakeToss() {
  const toss = { keys: [], auths: [] };
  window.TossPayments = jest.fn((ck) => {
    toss.keys.push(ck);
    return {
      requestBillingAuth: async (method, opts) => {
        toss.auths.push({ method, ...opts });
      },
    };
  });
  return toss;
}

const PLANS = {
  success: true,
  data: {
    client_key: 'ck_test',
    plans: [
      { id: 'expert', name: 'Expert', price_krw: 49000 },
      { id: 'agent', name: 'Agent', price_krw: 99000 },
    ],
  },
};

beforeEach(() => {
  window.sessionStorage.clear();
  delete window.__pwned;
  window.history.replaceState(null, '', '/');
});

// ── pricing.html ─────────────────────────────────────────────

describe('pricing.html — Expert · Agent 는 안내 · 상담 신청만 (결제창 · 새 앱 링크 없음)', () => {
  function bootPricing(tier) {
    const script = mountPage('pricing.html');
    window.DADAM_CONFIG = {
      supabase: { url: 'https://sb.test', anonKey: 'k' },
      paymentsApi: { url: PAY },
    };
    fakeSupabase({
      tables: {
        profiles: { data: { tier }, error: null },
        credit_plans: {
          data: [
            { tier: 'standard', monthly_credits: 100 },
            { tier: 'expert', monthly_credits: 1000 },
            { tier: 'agent', monthly_credits: 3000 },
          ],
          error: null,
        },
        credit_costs: { data: { credits: 20 }, error: null },
      },
    });
    const calls = fakeFetch((c) => (c.path === '/plans' ? json(200, PLANS) : undefined));
    const toss = fakeToss();
    (0, eval)(script);
    return { calls, toss };
  }

  test('Expert · Agent — 비활성 안내 「업체 가입은 새 앱에서 열립니다」 + 상담 신청 링크, 가격 · 크레딧은 그대로', async () => {
    const { toss } = bootPricing('standard');
    await flush();
    for (const plan of ['expert', 'agent']) {
      const cta = document.querySelector(`#grid [data-plan="${plan}"]`);
      const btn = cta.querySelector('button');
      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('업체 가입은 새 앱에서 열립니다');
      const links = [...cta.querySelectorAll('a')];
      expect(links.map((a) => [a.getAttribute('href'), a.textContent])).toEqual([
        ['consultation.html', '상담 신청'],
      ]);
    }
    expect(toss.keys).toHaveLength(0);
    const grid = document.querySelector('#grid').textContent;
    expect(grid).toContain('49,000원');
    expect(grid).toContain('99,000원');
    expect(grid).toContain('월 1,000 크레딧 · 생성 50회');
    expect(grid).toContain('월 3,000 크레딧 · 생성 150회');
    // 새 앱으로 가는 링크는 어디에도 없다
    expect(document.querySelector('#grid a[href*="segan"]')).toBeNull();
  });

  test('바로 토스를 열지 않고 새 앱도 가리키지 않는다 — 결제창 SDK · requestBillingAuth · segan/ 이 페이지에 없다', () => {
    const html = read('pricing.html');
    expect(html).not.toContain('js.tosspayments.com');
    expect(html).not.toContain('requestBillingAuth');
    expect(html).not.toContain('billing-success.html');
    expect(html).not.toMatch(/segan\//i);
  });

  test('지금 등급 카드는 「현재 등급」, 다른 유료 등급만 안내', async () => {
    bootPricing('expert');
    await flush();
    const cards = [...document.querySelectorAll('#grid .pr-card')];
    const expertCard = cards.find((c) =>
      c.querySelector('.pr-name').textContent.startsWith('Expert')
    );
    expect(expertCard.querySelector('[data-plan]')).toBeNull();
    expect(expertCard.querySelector('button[disabled]').textContent).toBe('현재 등급');
    expect(document.querySelectorAll('#grid [data-plan]')).toHaveLength(1);
  });
});

// ── billing-success.html ─────────────────────────────────────

describe('billing-success.html — partnerSignup 을 함께 보낸다', () => {
  const SCRIPT = () => mountPage('billing-success.html');

  function bootSuccess({ search, signup, response = json(200, okBody()) }) {
    const script = SCRIPT();
    window.history.replaceState(null, '', '/billing-success.html' + search);
    if (signup !== undefined)
      window.sessionStorage.setItem('partnerSignup', JSON.stringify(signup));
    window.DADAM_CONFIG = {
      supabase: { url: 'https://sb.test', anonKey: 'k' },
      paymentsApi: { url: PAY },
    };
    fakeSupabase();
    const calls = fakeFetch((c) => (c.path === '/issue-billing-key' ? response : undefined));
    (0, eval)(script);
    return calls;
  }

  function okBody(extra) {
    return {
      success: true,
      message: 'expert 플랜 구독이 시작되었습니다.',
      data: {
        plan: 'expert',
        amount_krw: 49000,
        next_charge_at: '2026-11-27T00:00:00Z',
        receipt_url: null,
        ...extra,
      },
    };
  }

  const COMPANY = { name: '다온 인테리어', sido: '대구광역시', gugun: '북구' };

  test('Expert — plan · company 를 보내고, 끝나면 partnerSignup 을 지운다', async () => {
    const calls = bootSuccess({
      search: '?plan=expert&customerKey=dadam-u1&authKey=ak_1',
      signup: { plan: 'expert', company: COMPANY },
    });
    await flush();
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c.url).toBe(`${PAY}/issue-billing-key`);
    expect(c.method).toBe('POST');
    expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(c.body).toEqual({
      auth_key: 'ak_1',
      customer_key: 'dadam-u1',
      plan: 'expert',
      company: COMPANY,
    });
    expect(window.sessionStorage.getItem('partnerSignup')).toBeNull();
    expect($('title').textContent).toBe('구독이 시작되었습니다');
    expect($('detail').textContent).toContain('다온 인테리어');
    expect($('primary').hidden).toBe(false);
    expect($('primary').getAttribute('href')).toBe('ai-design.html');
  });

  test('Agent — company 없이 plan 만 (이름 · 지역은 승인된 신청 값을 서버가 쓴다)', async () => {
    const calls = bootSuccess({
      search: '?customerKey=dadam-u1&authKey=ak_2',
      signup: { plan: 'agent' },
      response: json(200, okBody({ plan: 'agent', amount_krw: 99000 })),
    });
    await flush();
    expect(calls[0].body).toEqual({ auth_key: 'ak_2', customer_key: 'dadam-u1', plan: 'agent' });
    expect(window.sessionStorage.getItem('partnerSignup')).toBeNull();
  });

  test('partnerSignup 이 없으면 주소의 plan 으로 (예전 길 그대로)', async () => {
    const calls = bootSuccess({ search: '?plan=expert&customerKey=dadam-u1&authKey=ak_3' });
    await flush();
    expect(calls[0].body).toEqual({ auth_key: 'ak_3', customer_key: 'dadam-u1', plan: 'expert' });
    expect($('primary').getAttribute('href')).toBe('ai-design.html');
  });

  test.each([
    [409, 'hq_member', '본사 구성원은 협력업체로 결제할 수 없습니다.'],
    [403, 'not_owner', '업체 결제는 대표만 할 수 있습니다.'],
    [409, 'already_subscribed', '이 업체는 이미 구독 중입니다.'],
    [409, 'plan_mismatch', '업체 등급과 다른 등급으로는 결제할 수 없습니다.'],
    [403, 'agent_not_approved', 'Agent 는 본사 승인을 받은 뒤에 결제할 수 있습니다.'],
    [422, 'invalid', '업체 이름과 지역(시·도, 시·군·구)을 확인해 주세요.'],
  ])(
    '%i %s — 한국어 안내 + 결제되지 않음 (고객센터 안내 없음), partnerSignup 지움',
    async (status, code, text) => {
      bootSuccess({
        search: '?customerKey=dadam-u1&authKey=ak_4',
        signup: { plan: 'expert', company: COMPANY },
        response: json(status, { success: false, code, message: 'server text' }),
      });
      await flush();
      expect($('title').textContent).toBe('결제를 마치지 못했습니다');
      expect($('msg').textContent).toContain(text);
      expect($('msg').textContent).toContain('결제는 되지 않았습니다.');
      expect($('msg').textContent).not.toContain('고객센터');
      expect($('msg').className).toBe('bs-msg err');
      expect(window.sessionStorage.getItem('partnerSignup')).toBeNull();
      expect($('secondary').hidden).toBe(false);
      expect($('secondary').getAttribute('href')).toBe('pricing.html');
    }
  );

  test('결제 뒤 저장 실패(500)는 서버 문장 + 고객센터 안내', async () => {
    bootSuccess({
      search: '?plan=expert&customerKey=dadam-u1&authKey=ak_5',
      response: json(500, {
        success: false,
        code: 'SUBSCRIPTION_SAVE_FAILED',
        message: '결제는 되었지만 구독 정보를 저장하지 못했습니다. 고객센터로 문의해 주세요.',
      }),
    });
    await flush();
    expect($('msg').textContent).toContain('구독 정보를 저장하지 못했습니다');
    expect($('msg').textContent).toContain(
      '결제가 이루어졌는데 이 화면이 보인다면 고객센터로 문의해 주세요.'
    );
    expect($('secondary').getAttribute('href')).toBe('pricing.html');
  });

  test('주소에서 온 등급 글자는 글자로만 그린다', async () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    bootSuccess({
      search: '?plan=' + encodeURIComponent(evil) + '&customerKey=dadam-u1&authKey=ak_6',
      response: json(200, { success: true, data: { amount_krw: 1 } }),
    });
    await flush();
    expect($('detail').querySelector('img')).toBeNull();
    expect($('detail').textContent).toContain(evil);
    expect(window.__pwned).toBeUndefined();
  });
});

// ── billing.html ─────────────────────────────────────────────

describe('billing.html — 업체 구독', () => {
  const COMPANY = {
    id: 'c1',
    name: '다온 인테리어',
    plan: 'expert',
    next_plan: 'agent',
    status: 'active',
  };
  const SUB = {
    plan: 'expert',
    status: 'active',
    amount_krw: 49000,
    current_period_start: '2026-10-27T00:00:00Z',
    current_period_end: '2026-11-26T00:00:00Z',
    next_charge_at: '2026-11-26T00:00:00Z',
  };

  function bootBilling(subscriptionBody, { search = '' } = {}) {
    const script = mountPage('billing.html');
    window.history.replaceState(null, '', '/billing.html' + search);
    window.DADAM_CONFIG = {
      supabase: { url: 'https://sb.test', anonKey: 'k' },
      paymentsApi: { url: PAY },
    };
    const log = fakeSupabase({
      tables: {
        profiles: { data: { tier: 'expert', tier_source: 'company' }, error: null },
        credit_costs: { data: { credits: 20 }, error: null },
        payment_history: { data: [], error: null },
      },
      rpcs: {
        my_credit_wallet: {
          data: [
            {
              scope: 'company',
              company_id: 'c1',
              plan: 'expert',
              balance: 1000,
              monthly: 1000,
              period_end: null,
              usable: true,
            },
          ],
          error: null,
        },
      },
    });
    const calls = fakeFetch((c) => {
      if (c.path === '/subscription') return json(200, subscriptionBody);
      if (c.path === '/plans') return json(200, PLANS);
      return undefined;
    });
    const toss = fakeToss();
    (0, eval)(script);
    return { calls, toss, log };
  }

  const rowsText = () => $('planRows').textContent;
  const actionIds = () =>
    [...$('actions').querySelectorAll('button, a')].map((b) => b.id || b.getAttribute('href'));

  test('대표 · 이용 중 — 업체 이름 · 업체 등급 · 다음 결제일부터 · 업체 크레딧(my_credit_wallet), 등급 변경 · 해지', async () => {
    const { log } = bootBilling({ success: true, data: SUB, company: COMPANY });
    await flush();
    const t = rowsText();
    for (const s of [
      '업체',
      '다온 인테리어',
      '업체 등급',
      'Expert',
      '다음 결제일부터',
      'Agent',
      '업체 상태',
      '이용 중',
      '업체 크레딧',
      '1,000 (생성 50회)',
    ])
      expect(t).toContain(s);
    expect(t).not.toContain('현재 등급');
    expect(actionIds()).toEqual(['pricing.html', 'cancelBtn']);
    expect(log.rpcs).toContain('my_credit_wallet');
    expect(log.tables).not.toContain('user_credits');
  });

  test('대표 · 결제 실패 — 지금 다시 결제 · 카드 바꾸기 · 해지, 마지막 실패면 업체가 정지된다고 알린다', async () => {
    bootBilling({
      success: true,
      data: { ...SUB, status: 'past_due' },
      company: COMPANY,
      role: 'owner',
    });
    await flush();
    expect(actionIds()).toEqual(['retryBtn', 'cardBtn', 'cancelBtn']);
    expect($('status').textContent).toContain('업체가 정지되어 연출컷을 만들 수 없습니다.');
    expect($('status').textContent).not.toContain('Standard');
  });

  test.each(['staff', 'manager'])(
    '%s — 「업체 구독은 대표가 관리합니다」, 단추 없음',
    async (role) => {
      bootBilling({ success: true, data: null, company: COMPANY, role });
      await flush();
      expect($('status').hidden).toBe(false);
      expect($('status').textContent).toBe('업체 구독은 대표가 관리합니다.');
      expect($('actions').innerHTML).toBe('');
      expect(rowsText()).toContain('다온 인테리어');
      expect(rowsText()).not.toContain('구독 상태');
    }
  );

  test('대표 · 구독 없음(관리자가 만든 업체) — 「결제하고 시작」 → 업체 등급으로 토스 카드 등록', async () => {
    const { toss } = bootBilling({
      success: true,
      data: { plan: 'free', status: 'active', provider: null },
      company: { ...COMPANY, plan: 'agent', next_plan: null },
    });
    await flush();
    expect(rowsText()).toContain('없음');
    const btn = $('payBtn');
    expect(btn.textContent).toBe('결제하고 시작');
    btn.click();
    await flush();
    expect(toss.keys).toEqual(['ck_test']);
    expect(toss.auths).toEqual([
      {
        method: 'CARD',
        customerKey: 'dadam-u1',
        successUrl: 'http://localhost/billing-success.html?plan=agent',
        failUrl: 'http://localhost/billing.html?pay=fail',
      },
    ]);
    expect(JSON.parse(window.sessionStorage.getItem('partnerSignup'))).toEqual({ plan: 'agent' });
  });

  test('정지된 업체 — 「다시 결제」, 해지 예약(업체 아직 이용 중)이면 단추 없음', async () => {
    bootBilling({
      success: true,
      data: {
        ...SUB,
        status: 'cancelled',
        cancel_reason: 'payment_failed',
        cancel_at: '2026-10-30T00:00:00Z',
        ended_at: '2026-10-30T00:00:00Z',
      },
      company: { ...COMPANY, status: 'suspended' },
    });
    await flush();
    expect(rowsText()).toContain('결제가 멈춰 읽기만 됩니다');
    expect($('payBtn').textContent).toBe('다시 결제');
    expect($('status').textContent).toContain('업체가 정지되어 읽기만 됩니다.');

    bootBilling({
      success: true,
      data: {
        ...SUB,
        status: 'cancelled',
        cancel_reason: 'user_request',
        cancel_at: '2026-11-26T00:00:00Z',
      },
      company: COMPANY,
    });
    await flush();
    expect(rowsText()).toContain('해지 예약됨');
    expect($('actions').innerHTML).toBe('');
  });

  test('카드 등록이 실패해 돌아오면(?pay=fail) 안내하고 partnerSignup 을 지운다', async () => {
    window.sessionStorage.setItem('partnerSignup', JSON.stringify({ plan: 'expert' }));
    bootBilling(
      { success: true, data: { plan: 'free', status: 'active', provider: null }, company: COMPANY },
      { search: '?pay=fail&code=REJECT_CARD&message=' + encodeURIComponent('카드 거절') }
    );
    await flush();
    expect($('status').textContent).toContain('카드를 등록하지 못했습니다. 카드 거절');
    expect(window.sessionStorage.getItem('partnerSignup')).toBeNull();
    expect(window.location.search).toBe('');
  });

  test('업체 아님 — 예전 그대로 (현재 등급 · 등급 올리기)', async () => {
    bootBilling({ success: true, data: { plan: 'free', status: 'active', provider: null } });
    await flush();
    expect(rowsText()).toContain('현재 등급');
    expect(rowsText()).toContain('남은 크레딧');
    expect(actionIds()).toEqual(['pricing.html']);
  });
});

// ── js/site-shell.js ─────────────────────────────────────────

describe('js/site-shell.js — 머리말 크레딧 = my_credit_wallet', () => {
  function bootShell(rpcs) {
    document.body.innerHTML = '<div data-site-shell="header" data-nav=""></div>';
    window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'k' } };
    delete window.AdminAccess;
    const log = fakeSupabase({
      tables: { credit_costs: { data: { credits: 20 }, error: null } },
      rpcs,
    });
    (0, eval)(read('js/site-shell.js'));
    return log;
  }

  test('지금 쓰는 통장의 잔액 · 생성 횟수', async () => {
    const log = bootShell({
      my_credit_wallet: {
        data: [
          {
            scope: 'company',
            company_id: 'c1',
            plan: 'agent',
            balance: 3000,
            monthly: 3000,
            period_end: null,
            usable: true,
          },
        ],
        error: null,
      },
    });
    await flush();
    expect($('shellCredit').hidden).toBe(false);
    expect($('shellCredit').textContent).toBe('3,000 크레딧 · 150회');
    expect(log.rpcs).toEqual(['my_credit_wallet']);
    expect(log.tables).not.toContain('user_credits');
    expect(log.tables).not.toContain('credit_plans');
  });

  test('통장을 못 읽으면 크레딧 자리를 숨긴 채 둔다', async () => {
    bootShell({});
    await flush();
    expect($('shellCredit').hidden).toBe(true);
    expect($('shellSep').hidden).toBe(true);
  });
});
