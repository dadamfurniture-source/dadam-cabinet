/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest */
/**
 * SEGAN 「내 정보」 탭 — 상담 내역 · 크레딧 · 구독 (segan/me.js), 기존 출처 그대로:
 *   상담 내역  consultations (본인 · 최신순), 상태 이름 = admin/consultations.html
 *   크레딧    user_credits → 없으면 등급 지급량 (js/site-shell.js 와 같은 규칙) + credit_costs
 *   구독      payments-api GET /subscription (billing.html 과 같은 호출), 상태 이름 = billing.html
 *   설정은 사이트 mypage.html, 구독 바꾸기는 billing.html 로 보낸다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'customer@example.com' } };
const PAY = 'https://pay.example.workers.dev';

async function load(options = {}) {
  const opts = {
    session: SESSION,
    consults: [
      {
        id: 'c2',
        title: 'AI 연출컷 상담 — 싱크대',
        status: 'confirmed',
        created_at: '2026-10-27T03:00:00Z',
      },
      {
        id: 'c1',
        title: '거실 붙박이장 문의',
        status: 'pending',
        created_at: '2026-10-20T03:00:00Z',
      },
    ],
    consultError: null,
    tier: 'expert',
    balance: 1000,
    monthly: 300,
    sub: {
      plan: 'expert',
      status: 'active',
      amount_krw: 29000,
      next_charge_at: '2026-11-20T00:00:00Z',
    },
    subFail: false,
    ...options,
  };
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
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: 'https://work.example.workers.dev' },
    paymentsApi: { url: PAY },
  };
  const calls = { tables: [], consultQuery: null, fetch: [] };
  const results = {
    consultations: () => ({
      data: opts.consultError ? null : opts.consults,
      error: opts.consultError,
    }),
    profiles: () => ({ data: { tier: opts.tier, detaildesign_approved: false }, error: null }),
    user_credits: () => ({
      data: opts.balance == null ? null : { balance: opts.balance },
      error: null,
    }),
    credit_plans: () => ({ data: { monthly_credits: opts.monthly }, error: null }),
    credit_costs: () => ({ data: { credits: 20 }, error: null }),
  };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async () => ({ data: false, error: null }),
      from: (table) => {
        calls.tables.push(table);
        const q = { filters: [] };
        const out = () => (results[table] ? results[table]() : { data: null, error: null });
        const chain = {
          select: (cols) => {
            q.cols = cols;
            return chain;
          },
          eq: (c, v) => {
            q.filters.push([c, v]);
            return chain;
          },
          order: (c, o) => {
            q.order = [c, o];
            return chain;
          },
          limit: (n) => {
            q.limit = n;
            if (table === 'consultations') calls.consultQuery = q;
            return chain;
          },
          maybeSingle: async () => out(),
          single: async () => out(),
          then: (resolve) => resolve(out()),
        };
        return chain;
      },
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    calls.fetch.push({ url, auth: (init.headers || {}).Authorization });
    if (url === PAY + '/subscription') {
      if (opts.subFail) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, json: async () => ({ success: true, data: opts.sub }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { ready: true, worker: null } }),
    };
  });
  const scripts = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
  for (const src of scripts) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of ['segan/shell.js', 'segan/make.js', 'segan/me.js']) (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganMe.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);

afterEach(() => jest.restoreAllMocks());

describe('상태 이름 — 사이트와 같다', () => {
  test('상담 상태 = admin/consultations.html STATUS_LABELS, 구독 상태 = billing.html STATUS_KO', async () => {
    await load();
    const admin = Function(
      `return ${read('admin/consultations.html').match(/const STATUS_LABELS = (\{[\s\S]*?\});/)[1]}`
    )();
    const billing = Function(
      `return ${read('billing.html').match(/var STATUS_KO = (\{[\s\S]*?\});/)[1]}`
    )();
    expect(window.SeganMe.CONSULT_STATUS).toEqual(admin);
    expect(window.SeganMe.SUB_STATUS).toEqual(billing);
  });
});

describe('상담 내역', () => {
  test('본인 것 · 최신순 · 제목 · 날짜 · 상태', async () => {
    const calls = await load();
    expect(calls.consultQuery.filters).toEqual([['user_id', 'user-1']]);
    expect(calls.consultQuery.order).toEqual(['created_at', { ascending: false }]);
    const rows = [...$('meConsults').querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual([
      'AI 연출컷 상담 — 싱크대2026.10.27확정',
      '거실 붙박이장 문의2026.10.20대기',
    ]);
    expect($('meConsultEmpty').hidden).toBe(true);
  });

  test('없으면 안내, 못 읽으면 그 안내', async () => {
    await load({ consults: [] });
    expect($('meConsultEmpty').hidden).toBe(false);
    expect($('meConsultEmpty').textContent).toBe('아직 상담 신청이 없습니다.');
    await load({ consultError: { message: 'x' } });
    expect($('meConsultEmpty').textContent).toBe('상담 내역을 불러오지 못했습니다.');
  });

  test('제목 · 상태는 글자로만 넣는다 (사이트 폼은 누구나 넣을 수 있다)', async () => {
    await load({
      consults: [
        {
          id: 'x',
          title: '<img src=x onerror=alert(1)>',
          status: '<b>',
          created_at: '2026-10-27T00:00:00Z',
        },
      ],
    });
    expect($('meConsults').querySelector('img')).toBeNull();
    expect($('meConsults').textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('크레딧 · 구독', () => {
  test('등급 · 남은 크레딧(생성 N회) · 구독 이용 중(다음 결제일)', async () => {
    const calls = await load();
    expect($('meTier').textContent).toBe('EXPERT');
    expect($('meCredits').textContent).toBe('1,000 크레딧 · 생성 50회');
    expect($('meSub').textContent).toBe('이용 중 · 다음 결제 2026.11.20');
    expect(calls.fetch.find((f) => f.url === PAY + '/subscription')).toEqual({
      url: PAY + '/subscription',
      auth: 'Bearer tok-1',
    });
  });

  test('잔액 행이 없으면 등급 지급량 (사이트 헤더와 같은 규칙)', async () => {
    const calls = await load({ balance: null, monthly: 300 });
    expect(calls.tables).toEqual(expect.arrayContaining(['user_credits', 'credit_plans']));
    expect($('meCredits').textContent).toBe('300 크레딧 · 생성 15회');
  });

  test.each([
    [{ plan: 'free', status: 'active' }, '없음'],
    [null, '없음'],
    [
      { plan: 'expert', status: 'cancelled', ended_at: '2026-10-01T00:00:00Z', amount_krw: 29000 },
      '종료됨 · 월 29,000원',
    ],
    [
      { plan: 'expert', status: 'past_due', amount_krw: 29000 },
      '결제 실패 · 재시도 중 · 월 29,000원',
    ],
  ])('구독 %j → %s', async (sub, text) => {
    await load({ sub });
    expect($('meSub').textContent).toBe(text);
  });

  test('구독을 못 읽으면 그렇게 적는다', async () => {
    await load({ subFail: true });
    expect($('meSub').textContent).toBe('불러오지 못했습니다');
  });

  test('구독 관리 → billing.html, 설정 → mypage.html (기존 페이지)', async () => {
    await load();
    const billing = [...document.querySelectorAll('a.sg-row')].find(
      (a) => a.textContent === '구독 관리'
    );
    const settings = [...document.querySelectorAll('a.sg-row')].find((a) =>
      /설정/.test(a.textContent)
    );
    expect(billing.getAttribute('href')).toBe('../billing.html');
    expect(settings.getAttribute('href')).toBe('../mypage.html');
    for (const href of ['../billing.html', '../mypage.html'])
      expect(fs.existsSync(path.join(ROOT, 'segan', href))).toBe(true);
  });
});

describe('로그인 · 나머지', () => {
  test('로그인 없으면 아무것도 읽지 않는다', async () => {
    const calls = await load({ session: null });
    expect(calls.consultQuery).toBeNull();
    expect(calls.fetch).toEqual([]);
  });

  test('로그아웃 · 역할 메뉴 · 사업자 정보는 그대로 있다', async () => {
    await load();
    expect($('sgLogout')).not.toBeNull();
    expect(document.getElementById('sgRoles')).not.toBeNull();
    expect(document.querySelector('.sg-biz')).not.toBeNull();
    expect(document.querySelectorAll('.sg-soon')).toHaveLength(0); // 「준비 중」 자리표시가 남지 않았다
  });
});
