/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout */
/**
 * SEGAN 「구독 관리」 화면 (segan/billing.html + segan/billing.js) — 사이트 billing.html 을 그대로 옮겼다.
 * 정본은 billing.html 이다:
 *   - 상태 이름 · 등급 이름 · 업체 상태 이름 · 결제 실패/해지 안내 글 = billing.html
 *   - 같은 호출: profiles · my_credit_wallet · credit_costs · payment_history, payments-api GET /subscription ·
 *     /plans(토스 client_key) · POST /subscription/retry · /subscription/card · /cancel
 *   - 같은 토스 카드 등록 (customerKey 'dadam-<사용자 id>'), 돌아오는 곳만 앱 화면:
 *       카드 바꾸기   /segan/billing.html?card=ok|fail
 *       업체 결제     성공 → 사이트 billing-success.html?plan=…(그대로) · 실패 → /segan/billing.html?pay=fail
 *                     partnerSignup = { plan, returnTo: '/segan/billing.html' } (billing-success.html 「돌아가기」)
 *   - 구독 해지는 한 번 더 묻는다 (billing.html confirm 과 같은 글)
 *   - 내 정보 탭을 켜고, 로그인 안내는 이 화면으로 돌아온다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SITE = read('billing.html');
const PAY = 'https://pay.example.workers.dev';
const ORIGIN = 'http://localhost';
const SESSION = { access_token: 'tok-1', user: { id: 'u1', email: 'owner@example.com' } };
const SUB = {
  plan: 'expert',
  status: 'active',
  amount_krw: 49000,
  current_period_start: '2026-10-27T00:00:00Z',
  current_period_end: '2026-11-26T00:00:00Z',
  next_charge_at: '2026-11-26T00:00:00Z',
};
const COMPANY = {
  id: 'c1',
  name: '다온 인테리어',
  plan: 'expert',
  next_plan: 'agent',
  status: 'active',
};
const day = (d) => (d ? new Date(d).toLocaleDateString('ko-KR') : '-');
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => {
  for (let i = 0; i < 6; i++) await tick();
};

/** billing.html 의 값 · 함수를 그대로 꺼낸다 (정본) */
const siteVar = (name) =>
  Function(`return ${SITE.match(new RegExp(`var ${name} = (\\{[\\s\\S]*?\\});`))[1]}`)();
const siteNotice = (() => {
  const dayFn = SITE.match(/function day\(d\) \{[\s\S]*?\n {8}\}/)[0];
  const noticeFn = SITE.match(/function notice\(sub, tier, company\) \{[\s\S]*?\n {8}\}/)[0];
  return Function(`${dayFn}\n${noticeFn}\nreturn notice;`)();
})();

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function load(options = {}) {
  const opts = {
    session: SESSION,
    search: '',
    sub: { success: true, data: SUB },
    profile: { tier: 'expert', tier_source: 'payment' },
    wallet: [{ scope: 'personal', balance: 1000 }],
    cost: 20,
    history: [],
    historyThrow: false,
    retry: json(200, {
      success: true,
      message: '결제했습니다.',
      data: { charge: { result: 'paid' } },
    }),
    card: json(200, { success: true, message: '카드를 바꿨습니다.' }),
    cancel: json(200, {
      success: true,
      data: { cancel_at: '2026-11-26T00:00:00Z', past_due: false },
    }),
    tossError: null,
    subAfterCancel: null, // POST /cancel 뒤 GET /subscription 이 줄 본문
    ...options,
  };
  const doc = new DOMParser().parseFromString(read('segan/billing.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  window.history.replaceState(null, '', '/segan/billing.html' + opts.search);
  if (!options.keepStorage) sessionStorage.clear();
  for (const k of ['AdminAccess', 'DadamMyPageWork', 'SeganShell', 'SeganBilling', 'TossPayments'])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://sb.example.co', anonKey: 'anon' },
    paymentsApi: { url: PAY },
  };
  const calls = { fetch: [], toss: [], tables: [], rpc: [], assign: [] };
  window.TossPayments = (key) => ({
    requestBillingAuth: async (method, params) => {
      calls.toss.push({ key, method, ...params });
      if (opts.tossError) throw opts.tossError;
    },
  });
  const results = {
    profiles: () => ({ data: opts.profile, error: null }),
    credit_costs: () => ({ data: opts.cost == null ? null : { credits: opts.cost }, error: null }),
    payment_history: () => {
      if (opts.historyThrow) throw new Error('x');
      return { data: opts.history, error: null };
    },
  };
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
        const out = () => (results[table] ? results[table]() : { data: null, error: null });
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: async () => out(),
          maybeSingle: async () => out(),
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
      body: init.body,
    });
    if (url === PAY + '/subscription')
      return json(
        200,
        opts.subAfterCancel && posts(calls, '/cancel').length ? opts.subAfterCancel : opts.sub
      );
    if (url === PAY + '/plans')
      return json(200, { success: true, data: { client_key: 'ck_test', plans: [] } });
    if (url === PAY + '/subscription/retry') return opts.retry;
    if (url === PAY + '/subscription/card') return opts.card;
    if (url === PAY + '/cancel') return opts.cancel;
    return json(404, { success: false });
  });
  const scripts = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
  for (const src of scripts) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of ['segan/shell.js', 'segan/billing.js']) (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganBilling.ready;
  await flush();
  return calls;
}

const $ = (id) => document.getElementById(id);
const rows = () =>
  [...$('blPlanRows').querySelectorAll('li')].map((li) => [
    li.firstChild.firstChild.textContent,
    li.querySelector('.me-val').textContent,
  ]);
const actions = () =>
  [...$('blActions').querySelectorAll('button, a')].map((b) => [
    b.textContent,
    b.tagName === 'A' ? b.getAttribute('href') : b.id,
  ]);
const status = () => ($('blStatus').hidden ? '' : $('blStatus').textContent);
const posts = (calls, p) => calls.fetch.filter((f) => f.url === PAY + p && f.method === 'POST');

afterEach(() => jest.restoreAllMocks());

describe('화면 — 내 정보 탭 안', () => {
  test('내 정보 탭 · noindex · 서비스 워커가 담는다 · 내 정보로 돌아가는 길', async () => {
    await load();
    expect(document.body.getAttribute('data-tab')).toBe('me');
    expect(
      document.querySelector('nav.sg-tabbar a[aria-current="page"]').getAttribute('data-tab-link')
    ).toBe('me');
    const sw = read('segan/sw.js');
    expect(sw).toContain("SCOPE + 'billing.html'");
    expect(sw).toContain("versioned(SCOPE + 'billing.js')");
    expect(document.querySelector('a.mk-back').getAttribute('href')).toBe('me.html');
    // 토스 결제창 v1 — billing.html 과 같은 주소
    const toss = SITE.match(/<script src="(https:\/\/js\.tosspayments\.com\/[^"]+)"/)[1];
    expect(read('segan/billing.html')).toContain(`<script src="${toss}" defer></script>`);
  });

  test('로그인 없으면 아무것도 묻지 않고, 로그인 안내는 이 화면으로 돌아온다', async () => {
    const calls = await load({ session: null });
    expect(document.querySelector('[data-auth-view="signed-out"]').hidden).toBe(false);
    const a = document.querySelector('[data-auth-view="signed-out"] a.sg-btn');
    expect(a.getAttribute('href')).toBe(
      '../login.html?redirect=' + encodeURIComponent('segan/billing.html')
    );
    expect(require('../js/auth-redirect.js').sanitize('segan/billing.html')).toBe(
      'segan/billing.html'
    );
    expect(calls.fetch.some((f) => f.url.startsWith(PAY))).toBe(false);
  });
});

describe('이름 · 안내 글 = billing.html', () => {
  test('구독 상태 · 등급 · 업체 상태 이름', async () => {
    await load();
    const B = window.SeganBilling;
    expect(B.STATUS_KO).toEqual(siteVar('STATUS_KO'));
    expect(B.PLAN_KO).toEqual(siteVar('PLAN_KO'));
    expect(B.COMPANY_STATUS_KO).toEqual(siteVar('COMPANY_STATUS_KO'));
  });

  test.each([
    ['결제 실패 · 개인', { ...SUB, status: 'past_due' }, 'expert', null],
    ['결제 실패 · 업체', { ...SUB, status: 'past_due' }, 'expert', COMPANY],
    [
      '계속 실패해 해지 · 개인 · 등급 내림',
      {
        ...SUB,
        status: 'cancelled',
        cancel_reason: 'payment_failed',
        cancel_at: '2026-10-30T00:00:00Z',
        ended_at: '2026-10-30T00:00:00Z',
      },
      'standard',
      null,
    ],
    [
      '계속 실패해 해지 · 정지된 업체',
      {
        ...SUB,
        status: 'cancelled',
        cancel_reason: 'payment_failed',
        cancel_at: '2026-10-30T00:00:00Z',
      },
      'expert',
      { ...COMPANY, status: 'suspended' },
    ],
    [
      '환불',
      { ...SUB, status: 'cancelled', cancel_reason: 'refunded', cancel_at: '2026-10-30T00:00:00Z' },
      'expert',
      null,
    ],
    ['이용 중', SUB, 'expert', null],
  ])('안내 — %s', async (_n, sub, tier, company) => {
    await load();
    expect(window.SeganBilling.notice(sub, tier, company)).toEqual(siteNotice(sub, tier, company));
  });
});

describe('내 구독 (업체 아님)', () => {
  test('이용 중 — 등급 · 크레딧(생성 N회) · 구독 상태 · 월 결제액 · 기간 · 다음 결제일, 등급 변경 · 해지', async () => {
    const calls = await load();
    expect(rows()).toEqual([
      ['현재 등급', 'EXPERT'],
      ['남은 크레딧', '1,000 (생성 50회)'],
      ['구독 상태', '이용 중'],
      ['월 결제액', '49,000원'],
      ['이번 기간', day(SUB.current_period_start) + ' ~ ' + day(SUB.current_period_end)],
      ['다음 결제일', day(SUB.next_charge_at)],
    ]);
    expect(actions()).toEqual([
      ['등급 변경', '../pricing.html'],
      ['구독 해지', 'blCancelBtn'],
    ]);
    expect(status()).toBe('');
    const sub = calls.fetch.find((f) => f.url === PAY + '/subscription');
    expect(sub).toMatchObject({ method: 'GET', auth: 'Bearer tok-1' });
    expect(calls.rpc).toContain('my_credit_wallet');
    expect(calls.tables).toEqual(
      expect.arrayContaining(['profiles', 'credit_costs', 'payment_history'])
    );
    expect(fs.existsSync(path.join(ROOT, 'segan', '../pricing.html'))).toBe(true);
  });

  test('구독 없음 — 등급 올리기, 본사 승인 등급이면 그 안내', async () => {
    await load({
      sub: { success: true, data: { plan: 'free', status: 'active' } },
      profile: { tier: 'expert', tier_source: 'manual' },
    });
    expect(rows()).toContainEqual(['구독', '없음']);
    expect(actions()).toEqual([['등급 올리기', '../pricing.html']]);
    expect(status()).toBe(
      '현재 등급은 본사 승인으로 부여된 등급입니다. 구독 결제와는 별개로 유지됩니다.'
    );
  });

  test('해지 후 종료 — 종료일 · 다시 구독하기', async () => {
    await load({
      sub: {
        success: true,
        data: {
          ...SUB,
          status: 'cancelled',
          cancel_reason: 'user_request',
          ended_at: '2026-11-26T00:00:00Z',
        },
      },
    });
    expect(rows()).toContainEqual(['구독 상태', '종료됨']);
    expect(rows()).toContainEqual(['종료일', day('2026-11-26T00:00:00Z')]);
    expect(actions()).toEqual([['다시 구독하기', '../pricing.html']]);
  });

  test('결제 내역 — 날짜 · 등급 · 실패/환불 표시 · 금액, 없으면 안내, 못 읽으면 안내', async () => {
    await load({
      history: [
        { created_at: '2026-10-27T00:00:00Z', plan: 'expert', amount_krw: 49000, status: 'paid' },
        { created_at: '2026-09-27T00:00:00Z', plan: 'expert', amount_krw: 49000, status: 'failed' },
        {
          created_at: '2026-08-27T00:00:00Z',
          plan: 'expert',
          amount_krw: 49000,
          status: 'refunded',
        },
      ],
    });
    const hist = [...$('blHistory').querySelectorAll('li')].map((li) => li.textContent);
    expect(hist).toEqual([
      day('2026-10-27T00:00:00Z') + ' · expert49,000원',
      day('2026-09-27T00:00:00Z') + ' · expert · 결제 실패49,000원',
      day('2026-08-27T00:00:00Z') + ' · expert · 환불49,000원',
    ]);
    await load({ history: [] });
    expect($('blHistory').textContent).toBe('결제 내역이 없습니다.');
    await load({ historyThrow: true });
    expect($('blHistory').textContent).toBe('결제 내역을 불러오지 못했습니다.');
  });

  test('글은 글자로만 넣는다', async () => {
    const bad = '<img src=x onerror=alert(1)>';
    await load({
      sub: { success: true, data: SUB, company: { ...COMPANY, name: bad } },
      history: [{ created_at: '2026-10-27T00:00:00Z', plan: bad, amount_krw: 1, status: 'paid' }],
    });
    expect(document.querySelector('main img')).toBeNull();
    expect($('blPlanRows').textContent).toContain(bad);
  });
});

describe('결제 실패 · 재시도 중', () => {
  const pastDue = { sub: { success: true, data: { ...SUB, status: 'past_due' } } };

  test('지금 다시 결제 · 카드 바꾸기 · 해지, 안내 = billing.html', async () => {
    await load(pastDue);
    expect(actions()).toEqual([
      ['지금 다시 결제', 'blRetryBtn'],
      ['카드 바꾸기', 'blCardBtn'],
      ['구독 해지', 'blCancelBtn'],
    ]);
    expect(rows()).toContainEqual(['다음 결제 시도', day(SUB.next_charge_at)]);
    expect(status()).toBe(siteNotice({ ...SUB, status: 'past_due' }, 'expert', null).text);
    expect($('blStatus').className).toBe('bl-status err');
  });

  test('지금 다시 결제 — POST /subscription/retry, 서버 글을 안내 위에 붙이고 다시 읽는다', async () => {
    const calls = await load({
      ...pastDue,
      retry: json(402, {
        success: false,
        message: '카드 한도가 부족합니다.',
        data: { charge: { result: 'declined' } },
      }),
    });
    const before = calls.fetch.filter((f) => f.url === PAY + '/subscription').length;
    $('blRetryBtn').click();
    await flush();
    expect(posts(calls, '/subscription/retry')).toEqual([
      { url: PAY + '/subscription/retry', method: 'POST', auth: 'Bearer tok-1', body: '{}' },
    ]);
    expect(calls.fetch.filter((f) => f.url === PAY + '/subscription').length).toBe(before + 1);
    expect(status().startsWith('카드 한도가 부족합니다.\n\n정기 결제에 실패했습니다.')).toBe(true);
    expect($('blStatus').className).toBe('bl-status err');
  });

  test('카드 바꾸기 — /plans 의 client_key 로 토스 카드 등록, 이 화면(?card=ok|fail)으로 돌아온다', async () => {
    const calls = await load(pastDue);
    $('blCardBtn').click();
    await flush();
    expect(calls.toss).toEqual([
      {
        key: 'ck_test',
        method: 'CARD',
        customerKey: 'dadam-u1',
        successUrl: ORIGIN + '/segan/billing.html?card=ok',
        failUrl: ORIGIN + '/segan/billing.html?card=fail',
      },
    ]);
    // billing.html 과 같은 customerKey 모양
    expect(SITE).toContain("customerKey: 'dadam-' + session.user.id");
  });

  test('카드 등록 창을 닫으면 소란 없이 다시 읽는다, 못 열면 안내', async () => {
    const calls = await load({ ...pastDue, tossError: { code: 'USER_CANCEL', message: '취소' } });
    $('blCardBtn').click();
    await flush();
    expect(calls.toss).toHaveLength(1);
    expect($('blStatus').className).toBe('bl-status err'); // 결제 실패 안내 그대로
    await load({ ...pastDue, tossError: new Error('창 오류') });
    $('blCardBtn').click();
    await flush();
    expect(status()).toBe('카드 등록 창을 열지 못했습니다. 창 오류');
    expect($('blCardBtn').disabled).toBe(false);
  });

  test('카드 등록에서 돌아오면(?card=ok) POST /subscription/card 뒤 그 결과, 주소는 지운다', async () => {
    const calls = await load({ ...pastDue, search: '?card=ok&authKey=ak_1&customerKey=dadam-u1' });
    expect(posts(calls, '/subscription/card')).toEqual([
      {
        url: PAY + '/subscription/card',
        method: 'POST',
        auth: 'Bearer tok-1',
        body: JSON.stringify({ auth_key: 'ak_1', customer_key: 'dadam-u1' }),
      },
    ]);
    expect(status().startsWith('카드를 바꿨습니다.\n\n')).toBe(true);
    expect(window.location.search).toBe('');
  });

  test('카드 등록 실패로 돌아오면(?card=fail) 안내, 고객이 닫았으면 아무 말 없이', async () => {
    const calls = await load({
      sub: { success: true, data: SUB },
      search: '?card=fail&code=REJECT_CARD&message=' + encodeURIComponent('카드 거절'),
    });
    expect(status()).toBe('카드를 바꾸지 못했습니다. 카드 거절');
    expect(posts(calls, '/subscription/card')).toEqual([]);
    expect(window.location.search).toBe('');
    await load({ sub: { success: true, data: SUB }, search: '?card=fail&code=USER_CANCEL' });
    expect(status()).toBe('');
  });
});

describe('구독 해지 — 한 번 더 묻는다', () => {
  test('이용 중 — 묻는 글 · 그만두기 · 해지 → POST /cancel { reason: user_request } → 이용 종료일 안내', async () => {
    const calls = await load();
    $('blCancelBtn').click();
    expect($('blAsk').hidden).toBe(false);
    expect($('blActions').hidden).toBe(true);
    expect($('blAskText').textContent).toBe(
      '구독을 해지할까요? 이미 결제한 기간까지는 그대로 이용하실 수 있습니다.'
    );
    $('blAskNo').click();
    expect($('blAsk').hidden).toBe(true);
    expect(posts(calls, '/cancel')).toEqual([]);
    $('blCancelBtn').click();
    $('blAskYes').click();
    await flush();
    expect(posts(calls, '/cancel')).toEqual([
      {
        url: PAY + '/cancel',
        method: 'POST',
        auth: 'Bearer tok-1',
        body: JSON.stringify({ reason: 'user_request' }),
      },
    ]);
    expect(status()).toBe(
      '해지되었습니다. ' + day('2026-11-26T00:00:00Z') + ' 까지 이용하실 수 있습니다.'
    );
    expect($('blAsk').hidden).toBe(true);
    // billing.html 과 같은 묻는 글 · 같은 본문
    expect(SITE).toContain('이미 결제한 기간까지는 그대로 이용하실 수 있습니다.');
    expect(SITE).toContain("body: JSON.stringify({ reason: 'user_request' })");
  });

  test('결제 실패 중 — 더 이상 결제를 시도하지 않는다', async () => {
    await load({
      sub: { success: true, data: { ...SUB, status: 'past_due' } },
      cancel: json(200, { success: true, data: { past_due: true } }),
      subAfterCancel: {
        success: true,
        data: {
          ...SUB,
          status: 'cancelled',
          cancel_reason: 'user_request',
          ended_at: '2026-11-07T00:00:00Z',
        },
      },
    });
    $('blCancelBtn').click();
    expect($('blAskText').textContent).toBe('구독을 해지할까요? 더 이상 결제를 시도하지 않습니다.');
    $('blAskYes').click();
    await flush();
    expect(status()).toBe('해지되었습니다. 더 이상 결제를 시도하지 않습니다.');
  });

  test('실패 — 서버 글, 다시 누를 수 있다', async () => {
    await load({ cancel: json(409, { success: false, message: '이미 해지되었습니다.' }) });
    $('blCancelBtn').click();
    $('blAskYes').click();
    await flush();
    expect(status()).toBe('이미 해지되었습니다.');
    expect($('blAskYes').disabled).toBe(false);
  });
});

describe('업체 구독', () => {
  test('대표 · 이용 중 — 업체 · 업체 등급 · 다음 결제일부터 · 업체 상태 · 업체 크레딧', async () => {
    await load({ sub: { success: true, data: SUB, company: COMPANY } });
    expect(rows().slice(0, 5)).toEqual([
      ['업체', '다온 인테리어'],
      ['업체 등급', 'Expert'],
      ['다음 결제일부터', 'Agent'],
      ['업체 상태', '이용 중'],
      ['업체 크레딧', '1,000 (생성 50회)'],
    ]);
    expect(actions()).toEqual([
      ['등급 변경', '../pricing.html'],
      ['구독 해지', 'blCancelBtn'],
    ]);
  });

  test.each(['staff', 'manager'])(
    '%s — 「업체 구독은 대표가 관리합니다.」, 단추 없음',
    async (role) => {
      await load({ sub: { success: true, data: null, company: COMPANY, role } });
      expect(status()).toBe('업체 구독은 대표가 관리합니다.');
      expect(actions()).toEqual([]);
      expect(rows().map((r) => r[0])).not.toContain('구독 상태');
    }
  );

  test('구독 없는 업체 — 결제하고 시작 → partnerSignup { plan, returnTo } · 토스 → 사이트 결제 완료 화면', async () => {
    const calls = await load({
      sub: {
        success: true,
        data: { plan: 'free', status: 'active' },
        company: { ...COMPANY, plan: 'agent', next_plan: null },
      },
    });
    expect(actions()).toEqual([['결제하고 시작', 'blPayBtn']]);
    $('blPayBtn').click();
    await flush();
    expect(JSON.parse(sessionStorage.getItem('partnerSignup'))).toEqual({
      plan: 'agent',
      returnTo: '/segan/billing.html',
    });
    expect(calls.toss).toEqual([
      {
        key: 'ck_test',
        method: 'CARD',
        customerKey: 'dadam-u1',
        successUrl: ORIGIN + '/billing-success.html?plan=agent',
        failUrl: ORIGIN + '/segan/billing.html?pay=fail',
      },
    ]);
    // billing-success.html 은 같은 사이트 '/…' 경로만 「돌아가기」로 받는다 (200자 이하 · '//' 아님)
    const bs = read('billing-success.html');
    expect(bs).toContain("var SIGNUP_KEY = 'partnerSignup';");
    expect(bs).toContain("v.charAt(0) !== '/' || v.charAt(1) === '/'");
  });

  test('정지된 업체 — 다시 결제, 해지 예약(아직 이용 중)이면 단추 없음', async () => {
    await load({
      sub: {
        success: true,
        data: {
          ...SUB,
          status: 'cancelled',
          cancel_reason: 'payment_failed',
          cancel_at: '2026-10-30T00:00:00Z',
          ended_at: '2026-10-30T00:00:00Z',
        },
        company: { ...COMPANY, status: 'suspended' },
      },
    });
    expect(actions()).toEqual([['다시 결제', 'blPayBtn']]);
    expect(rows()).toContainEqual(['업체 상태', '결제가 멈춰 읽기만 됩니다']);
    expect(status()).toContain('업체가 정지되어 읽기만 됩니다.');
    await load({
      sub: {
        success: true,
        data: {
          ...SUB,
          status: 'cancelled',
          cancel_reason: 'user_request',
          cancel_at: '2026-11-26T00:00:00Z',
        },
        company: COMPANY,
      },
    });
    expect(rows()).toContainEqual(['구독 상태', '해지 예약됨']);
    expect(actions()).toEqual([]);
  });

  test('업체 결제 카드 등록이 실패해 돌아오면(?pay=fail) 안내하고 partnerSignup 을 지운다', async () => {
    sessionStorage.setItem(
      'partnerSignup',
      JSON.stringify({ plan: 'expert', returnTo: '/segan/billing.html' })
    );
    await load({
      keepStorage: true,
      sub: { success: true, data: { plan: 'free', status: 'active' }, company: COMPANY },
      search: '?pay=fail&code=REJECT_CARD&message=' + encodeURIComponent('카드 거절'),
    });
    expect(status()).toBe('카드를 등록하지 못했습니다. 카드 거절');
    expect(sessionStorage.getItem('partnerSignup')).toBeNull();
    expect(window.location.search).toBe('');
  });
});
