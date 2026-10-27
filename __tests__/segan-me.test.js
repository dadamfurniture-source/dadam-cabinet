/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest */
/**
 * SEGAN 「내 정보」 탭 — 내 프로젝트 · 상담 내역 · 크레딧 · 구독 (segan/me.js), 기존 출처 그대로:
 *   내 프로젝트 workflow-api GET /me/projects (본인 토큰). 못 읽으면(404 · 오류) 칸째 감춘다.
 *              수금 단계 이름 = erp.html PAY_STAGE_LABELS · 워커 payments.js PAYMENT_STAGE_LABEL
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
const WORK = 'https://work.example.workers.dev';

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
    // GET /me/projects 응답 — 기본은 아직 배포 전(404)
    projectsRes: { ok: false, status: 404, body: { success: false, error: 'Not found' } },
    projectsFail: false,
    workflowUrl: WORK,
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
    workflowApi: { url: opts.workflowUrl },
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
    if (url === WORK + '/me/projects') {
      if (opts.projectsFail) throw new TypeError('Failed to fetch');
      const r = opts.projectsRes;
      return { ok: r.ok, status: r.status, json: async () => r.body };
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

describe('내 프로젝트 — GET /me/projects', () => {
  const ok = (data) => ({ projectsRes: { ok: true, status: 200, body: { success: true, data } } });
  const project = (extra = {}) => ({
    id: 'p1',
    title: '거실 붙박이장',
    status: 'active',
    company_name: '다담가구',
    created_at: '2026-10-01T00:00:00Z',
    stage: 'design',
    order: null,
    payments: [],
    install_at: null,
    ...extra,
  });
  const section = () => $('meProjectSection');
  const rows = () => [...$('meProjects').querySelectorAll('li.me-project')];
  const steps = (li) =>
    [...li.querySelectorAll('.me-steps li')].map((s) => ({
      label: s.textContent,
      done: s.classList.contains('me-step--done'),
      now: s.getAttribute('aria-current') === 'step',
    }));
  const facts = (li) =>
    Object.fromEntries(
      [...li.querySelectorAll('.me-facts div')].map((d) => [
        d.querySelector('dt').textContent,
        d.querySelector('dd').textContent,
      ])
    );

  test('수금 단계 이름 = erp.html PAY_STAGE_LABELS = 워커 payments.js PAYMENT_STAGE_LABEL', async () => {
    await load();
    const erp = Function(
      `return ${read('erp.html').match(/var PAY_STAGE_LABELS = (\{[\s\S]*?\});/)[1]}`
    )();
    const worker = Function(
      `return ${
        read('workers/workflow-api/src/payments.js').match(
          /PAYMENT_STAGE_LABEL = Object\.freeze\((\{[\s\S]*?\})\);/
        )[1]
      }`
    )();
    expect(window.SeganMe.PAY_STAGE).toEqual(erp);
    expect(window.SeganMe.PAY_STAGE).toEqual(worker);
  });

  test('본인 토큰으로 workflow-api 에 묻고, 칸이 맨 위(상담 내역 앞)에 보인다', async () => {
    const calls = await load(ok([project()]));
    expect(calls.fetch.find((f) => f.url === WORK + '/me/projects')).toEqual({
      url: WORK + '/me/projects',
      auth: 'Bearer tok-1',
    });
    expect(section().hidden).toBe(false);
    expect($('meProjectTitle').textContent).toBe('내 프로젝트');
    const order = [...document.querySelectorAll('[data-auth-view="signed-in"] section h2')].map(
      (h) => h.textContent
    );
    expect(order.slice(0, 2)).toEqual(['내 프로젝트', '상담 내역']);
  });

  test('단계 6칸 — 상담 · 연출컷 · 설계 · 견적 · 수주 · 시공 완료, 지금 단계까지 채운다', async () => {
    await load(ok([project({ stage: 'design' })]));
    const [li] = rows();
    expect(li.querySelector('.me-c-main b').textContent).toBe('거실 붙박이장');
    expect(li.querySelector('.me-c-main small').textContent).toBe('다담가구');
    expect(steps(li)).toEqual([
      { label: '상담', done: true, now: false },
      { label: '연출컷', done: true, now: false },
      { label: '설계', done: true, now: true },
      { label: '견적', done: false, now: false },
      { label: '수주', done: false, now: false },
      { label: '시공 완료', done: false, now: false },
    ]);
    expect(window.SeganMe.PROJECT_STAGES.map((s) => s[0])).toEqual([
      'consult',
      'render',
      'design',
      'quote',
      'order',
      'installed',
    ]);
  });

  test.each([
    ['consult', 0],
    ['render', 1],
    ['quote', 3],
    ['order', 4],
    ['installed', 5],
  ])('stage %s → %i 번째 칸이 지금', async (stage, at) => {
    await load(ok([project({ stage })]));
    const s = steps(rows()[0]);
    expect(s.findIndex((x) => x.now)).toBe(at);
    expect(s.filter((x) => x.done)).toHaveLength(at + 1);
  });

  test('모르는 stage — 채우지 않는다 (짐작하지 않는다)', async () => {
    await load(ok([project({ stage: 'something' })]));
    const s = steps(rows()[0]);
    expect(s.some((x) => x.done || x.now)).toBe(false);
  });

  test.each([
    ['closed', '끝남'],
    ['cancelled', '취소'],
    ['handed_over', '넘김'],
  ])('상태 %s → %s 표시, active 는 표시하지 않는다', async (status, label) => {
    await load(ok([project({ status }), project({ id: 'p2', status: 'active' })]));
    const [ended, active] = rows();
    expect(ended.querySelector('.me-badge').textContent).toBe(label);
    expect(active.querySelector('.me-badge')).toBeNull();
  });

  test('계약 금액 · 다음 결제(안 낸 것 중 낼 날이 가장 이른 것) · 설치일', async () => {
    await load(
      ok([
        project({
          stage: 'order',
          order: {
            order_no: 'O-1',
            status: 'confirmed',
            contract_amount: 12000000,
            ordered_at: '2026-10-10T00:00:00Z',
            completed_at: null,
          },
          payments: [
            { stage: 'deposit', amount: 1200000, due_on: '2026-10-10', paid_on: '2026-10-10' },
            { stage: 'balance', amount: 5800000, due_on: '2026-12-20', paid_on: null },
            { stage: 'interim', amount: 5000000, due_on: '2026-11-20', paid_on: null },
          ],
          install_at: '2026-12-01T01:00:00Z',
        }),
      ])
    );
    expect(facts(rows()[0])).toEqual({
      '계약 금액': '12,000,000원',
      '다음 결제': '중도금 5,000,000원 · 2026.11.20',
      설치일: '2026.12.01',
    });
  });

  test('다음 결제 — 낼 날이 없는 것은 뒤, 모두 냈으면 줄이 없다', async () => {
    await load();
    const { nextPayment } = window.SeganMe;
    expect(
      nextPayment([
        { stage: 'other', amount: 100, due_on: null, paid_on: null },
        { stage: 'balance', amount: 200, due_on: '2026-12-01', paid_on: null },
      ]).stage
    ).toBe('balance');
    expect(nextPayment([{ stage: 'other', amount: 100, due_on: null, paid_on: null }]).stage).toBe(
      'other'
    );
    expect(
      nextPayment([{ stage: 'deposit', amount: 1, due_on: null, paid_on: '2026-10-01' }])
    ).toBe(null);
    expect(nextPayment(null)).toBe(null);

    await load(
      ok([
        project({
          order: { order_no: 'O-1', status: 'confirmed', contract_amount: 3000000 },
          payments: [
            { stage: 'deposit', amount: 300000, due_on: '2026-10-01', paid_on: '2026-10-01' },
          ],
        }),
      ])
    );
    expect(facts(rows()[0])).toEqual({ '계약 금액': '3,000,000원' });
  });

  test('수주 · 수금 · 설치일이 없으면 그 줄이 없다', async () => {
    await load(ok([project()]));
    expect(rows()[0].querySelector('.me-facts')).toBeNull();
  });

  test('빈 목록 — 칸은 보이고 안내 한 줄', async () => {
    await load(ok([]));
    expect(section().hidden).toBe(false);
    expect(rows()).toHaveLength(0);
    expect($('meProjectEmpty').hidden).toBe(false);
    expect($('meProjectEmpty').textContent).toBe('진행 중인 프로젝트가 없습니다.');
    await load(ok([project()]));
    expect($('meProjectEmpty').hidden).toBe(true);
  });

  test.each([
    ['404 (아직 배포 전)', {}],
    ['500', { projectsRes: { ok: false, status: 500, body: { success: false, error: 'x' } } }],
    [
      '404 · 본문이 JSON 아님',
      {
        projectsRes: {
          ok: false,
          status: 404,
          get body() {
            throw new SyntaxError('Unexpected token');
          },
        },
      },
    ],
    ['네트워크 실패', { projectsFail: true }],
    [
      'success 아님',
      { projectsRes: { ok: true, status: 200, body: { success: false, data: [] } } },
    ],
    ['data 가 목록 아님', ok({ projects: [] })],
    ['모양이 틀린 행', ok([null])],
    ['workflow-api 주소 없음', { workflowUrl: '' }],
  ])('못 읽으면 칸째 감춘다 — %s', async (_name, extra) => {
    const calls = await load(extra);
    expect(section().hidden).toBe(true);
    expect(rows()).toHaveLength(0);
    expect(section().textContent).not.toMatch(/원|설치일/);
    if (extra.workflowUrl === '')
      expect(calls.fetch.some((f) => /\/me\/projects$/.test(f.url))).toBe(false);
    // 다른 칸은 그대로 채워진다
    expect($('meSub').textContent).toBe('이용 중 · 다음 결제 2026.11.20');
  });

  test('API 글은 글자로만 넣는다 (제목 · 회사 · 상태 · 수금 단계)', async () => {
    const bad = '<img src=x onerror=alert(1)>';
    await load(
      ok([
        project({
          title: bad,
          company_name: bad,
          status: bad,
          stage: bad,
          order: { contract_amount: 1000 },
          payments: [{ stage: bad, amount: 500, due_on: '2026-11-01', paid_on: null }],
        }),
      ])
    );
    expect($('meProjects').querySelector('img')).toBeNull();
    const text = $('meProjects').textContent;
    expect(text.split(bad).length - 1).toBe(4); // 제목 · 회사 · 상태 배지 · 다음 결제
    expect($('meProjects').querySelector('[onerror]')).toBeNull();
    expect($('meProjects').querySelector('.me-badge').attributes).toHaveLength(1); // class 만
  });

  test('원가 · 마진 칸은 쓰지 않는다 (응답에 섞여 와도 그리지 않는다)', async () => {
    await load(
      ok([
        project({
          stage: 'order',
          cost_total: 7654321,
          margin: 3456789,
          order: {
            order_no: 'O-9',
            status: 'confirmed',
            contract_amount: 10000000,
            cost_amount: 6543210,
            material_cost: 2345678,
            margin_rate: 0.31,
            received_amount: 1000000,
          },
          payments: [
            {
              stage: 'interim',
              amount: 4000000,
              due_on: '2026-11-15',
              paid_on: null,
              memo: '원가 메모',
            },
          ],
        }),
      ])
    );
    const text = $('meProjects').textContent;
    for (const n of [
      '7,654,321',
      '3,456,789',
      '6,543,210',
      '2,345,678',
      '1,000,000',
      '0.31',
      '원가',
    ])
      expect(text).not.toContain(n);
    expect(facts(rows()[0])).toEqual({
      '계약 금액': '10,000,000원',
      '다음 결제': '중도금 4,000,000원 · 2026.11.15',
    });
    // 그리는 코드가 원가 · 마진 이름을 읽지 않는다
    const src = window.SeganMe.projectHtml.toString() + window.SeganMe.nextPayment.toString();
    expect(src).not.toMatch(/cost|margin|received|memo|원가/i);
  });
});

describe('로그인 · 나머지', () => {
  test('로그인 없으면 아무것도 읽지 않는다', async () => {
    const calls = await load({ session: null });
    expect(calls.consultQuery).toBeNull();
    expect(calls.fetch).toEqual([]);
    expect($('meProjectSection').hidden).toBe(true);
  });

  test('로그아웃 · 역할 메뉴 · 사업자 정보는 그대로 있다', async () => {
    await load();
    expect($('sgLogout')).not.toBeNull();
    expect(document.getElementById('sgRoles')).not.toBeNull();
    expect(document.querySelector('.sg-biz')).not.toBeNull();
    expect(document.querySelectorAll('.sg-soon')).toHaveLength(0); // 「준비 중」 자리표시가 남지 않았다
  });
});
