/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Element */
/**
 * SEGAN 마이페이지 메뉴 · 하위 화면 (segan/me.js + segan/me.html) — 페이지가 싣는 실제 모듈을 모두 올린다
 * (업체 칸 · 상담 · 회계 · 프로젝트 · A/S · 결제 · 셸 · 만들기 · 마이페이지, 알림 push.js 만 뺀다).
 *
 *   메뉴    캔버스 용어 큰 메뉴(프로젝트 관리 · 플래너 · 재고 관리 · 회계 관리 · 인력 관리 / 본사 여섯 / 기본 정보)와
 *           그 아래 하위 줄, 쓸 수 있는 줄만 — 고객 · Manager · Expert · Agent · 다담 공장 · 다담 본사 · 관리자 · 작업자.
 *           폰 · 태블릿은 큰 메뉴를 누르면 펼치고(한 번에 하나), PC 는 늘 펼친다. 맨 아래 로그아웃
 *   하위 화면 주소 #이름 — 프로젝트 관리 #p-… · 인력 관리 #staff … · 알림 · 결제가 여는 옛 주소(#partner · #partner-consults ·
 *           #as · ?failed=1)도 그 화면. 메뉴에서 누르면 기록을 넣고, 「‹ 마이페이지」 는 메뉴에서 왔으면 뒤로 · 바로 왔으면 메뉴로
 *   PC      1100px~ 두 칸 — # 가 없으면 메뉴 차례대로 처음 보이는 하위 화면
 *   플래너  PC 브라우저에서만 새 탭 (SeganShell.desktopTab — 규칙은 __tests__/segan-shell.test.js)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'owner@example.com' } };
const PAY = 'https://pay.example.workers.dev';
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const ASSIST = 'https://assist.example.workers.dev';
const CO = '11111111-1111-4111-8111-111111111111';

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code = 'x') => ({
  ok: false,
  status,
  body: { success: false, code, error: 'x' },
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
const partnerMe = (extra = {}) =>
  ok({ company: null, application: null, members: [], invites: [], ...extra });
const member = (extra = {}) => partnerMe({ company: company(extra) });
const HQ = partnerMe({ hq_member: true });
const PLANNER = { company: { id: CO, name: 'x', kind: 'partner', plan: 'agent' }, role: 'owner' };
const WORKER = {
  ready: true,
  worker: { id: 'w1', status: 'approved', display_name: '김작업' },
  counts: { open: 4, mine: 2, revision: 1, newEvents: 3 },
  next_job: {
    id: '99999999-9999-4999-8999-999999999999',
    kind: 'install',
    title: '거실 붙박이장',
    region_label: '대구 북구',
    starts_at: '2026-11-10T00:00:00Z', // 한국 시간 11/10(화) 09:00
    my: { assignment_status: 'confirmed' },
  },
};

/** PC · 폰 — matchMedia 가짜 (PC = 마우스 · 1100px~) */
const media = (on) => (q) => ({
  matches: !!on[q],
  media: q,
  addEventListener() {},
  removeEventListener() {},
});
const PC = { '(pointer: fine)': true, '(min-width: 1100px)': true };

/**
 * me.html 을 올린다. 서버 응답: partner(/partner/me) · projects(/me/projects) · mineAs(/me/as-requests) ·
 * consults(/company/consults) · companyProjects(/company/projects) · box(/company/as-requests) · ledger(/ledger/me) ·
 * planner(/planner/access data — 없으면 403) · workMe(/work/me data) · assistant(/assistant/me data — 없으면 403) ·
 * isAdmin · wide(PC 두 칸)
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    url: '/segan/me.html',
    partner: partnerMe(),
    projects: fail(404, 'not_found'),
    mineAs: ok({ ready: true, items: [] }),
    consults: ok({ items: [] }),
    companyProjects: ok({ company: { id: CO }, can_manage: false, items: [] }),
    box: ok({ ready: true, items: [] }),
    ledger: fail(403),
    planner: null,
    workMe: { ready: true, worker: null },
    assistant: null,
    isAdmin: false,
    wide: false,
    profile: { tier: 'agent', name: '김대표' },
    ...options,
  };
  window.history.replaceState(null, '', opts.url);
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  document.title = '마이페이지 · SEGAN';
  sessionStorage.clear();
  for (const k of [
    'AdminAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganMake',
    'SeganMe',
    'SeganPartner',
    'SeganPartnerConsults',
    'SeganPartnerProjects',
    'SeganBooks',
    'SeganAs',
    'SeganPay',
    'SeganRegions',
    'SeganPush',
    'TossPayments',
  ])
    delete window[k];
  if (opts.wide) window.matchMedia = media(PC);
  else delete window.matchMedia;
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
    paymentsApi: { url: PAY },
    accountApi: { url: ACC },
    assistantApi: { url: ASSIST },
  };
  const calls = { fetch: [] };
  window.supabase = {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: opts.session } }),
        signOut: async () => {},
      },
      rpc: async (name) => {
        if (name === 'is_admin') return { data: opts.isAdmin, error: null };
        if (name === 'my_credit_wallet')
          return {
            data: [{ scope: 'personal', plan: 'agent', balance: 1200, usable: true }],
            error: null,
          };
        return { data: null, error: { message: 'x' } };
      },
      from: (table) => {
        const out = () => {
          if (table === 'profiles') return { data: opts.profile, error: null };
          if (table === 'credit_costs') return { data: { credits: 20 }, error: null };
          if (table === 'credit_plans') return { data: [], error: null };
          if (table === 'consultations') return { data: [], error: null };
          return { data: null, error: null };
        };
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => out(),
          single: async () => out(),
          then: (resolve) => resolve(out()),
        };
        return chain;
      },
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.fetch.push({ url, method });
    const reply = (r) => ({ ok: r.ok, status: r.status, json: async () => r.body });
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === PAY + '/subscription') return reply(ok({ plan: 'free', status: 'active' }));
    if (url === PAY + '/plans') return reply(ok({ client_key: 'k', plans: [] }));
    if (url === WORK + '/me/projects') return reply(opts.projects);
    if (url === WORK + '/me/as-requests') return reply(opts.mineAs);
    if (url === WORK + '/company/consults') return reply(opts.consults);
    if (url === WORK + '/company/my-score') return reply(fail(403));
    if (url === WORK + '/company/service-settings') return reply(fail(403));
    if (url === WORK + '/company/projects') return reply(opts.companyProjects);
    if (url === WORK + '/company/as-requests') return reply(opts.box);
    if (url.startsWith(WORK + '/books/summary')) return reply(fail(403));
    if (url === WORK + '/ledger/me') return reply(opts.ledger);
    if (url === WORK + '/planner/access') return reply(opts.planner ? ok(opts.planner) : fail(403));
    if (url === WORK + '/work/me') return reply(ok(opts.workMe));
    if (url === ASSIST + '/assistant/me')
      return reply(opts.assistant ? ok(opts.assistant) : fail(403));
    return reply(fail(404));
  });
  Element.prototype.scrollIntoView = jest.fn();
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of [
    'segan/regions.js',
    'segan/partner.js',
    'segan/partner-consults.js',
    'segan/books.js',
    'segan/partner-projects.js',
    'segan/as-requests.js',
    'segan/pay.js',
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
const screen = () => $('main').getAttribute('data-me-screen');
/** 보이는 메뉴 — [큰 메뉴, [하위 줄 글 …]] (묶음 · 메뉴 차례대로, 감춘 묶음 · 메뉴 · 줄은 빼고) */
const menus = () =>
  [...$('meHub').querySelectorAll('.me-group:not([hidden]) [data-menu]:not([hidden])')].map((m) => [
    m.querySelector('.me-main').firstChild.textContent.trim(),
    [...m.querySelectorAll('li[data-me-item]:not([hidden]) .sg-row')].map((a) => a.textContent),
  ]);
/** 보이는 묶음 머리글 (차례대로) */
const groups = () =>
  [...$('meHub').querySelectorAll('.me-group:not([hidden])')].map((g) => {
    const h = g.querySelector('h2');
    return h && !h.hidden ? h.textContent : '';
  });
/** 하위 줄 — 큰 메뉴(data-menu) 안의 그 글 (같은 글이 여러 메뉴에 있으면 menu 로 고른다) */
const row = (label, menu) =>
  [
    ...$('meHub').querySelectorAll(
      (menu ? `[data-menu="${menu}"] ` : '') + 'li[data-me-item]:not([hidden]) a.sg-row'
    ),
  ].find((a) => a.textContent === label);
/** 하위 화면에 보이는 칸 · 업체 칸 안의 부분 */
const onScreen = () =>
  [...$('mePane').querySelectorAll(':scope > section')]
    .filter((s) => !s.hidden && !s.classList.contains('me-off'))
    .map((s) => s.id);
const partnerParts = () =>
  [...$('partner').children]
    .filter((el) => !el.hidden && !el.classList.contains('me-off'))
    .map((el) => el.id);
const opened = () =>
  [...$('meHub').querySelectorAll('[data-menu].is-open')].map((m) => m.getAttribute('data-menu'));

const STAGES = ['상담', '설계', '견적', '계약', '제작', '설치', 'A/S'];
const BASIC = ['내 연출컷', '좋아요', '크레딧 · 구독없음', '내 활동', '설정'];
const basic = (factory) => [...BASIC.slice(0, 3), factory, ...BASIC.slice(3)];
const LEDGER = ['한눈에', '매출', '매입', '사진', '보고서', '설정'];
const STOCK = ['기본 자재', '자투리 자재', '철물'];
const HQ_CO = '77777777-7777-4777-8777-777777777777';
const PLATFORM = partnerMe({ platform_member: true });

afterEach(() => {
  jest.restoreAllMocks();
  delete window.matchMedia;
});

describe('메뉴 — 캔버스 용어 큰 메뉴 · 하위 줄, 쓸 수 있는 줄만', () => {
  test('고객 — 내 정보, 프로젝트 관리(상담) · 기본 정보(팩토리로 시작하기), 머리글 없이, 맨 아래 로그아웃', async () => {
    await load();
    expect(screen()).toBe('');
    expect($('meName').textContent).toBe('김대표');
    expect($('sgAccountEmail').textContent).toBe('owner@example.com');
    expect($('meTier').textContent).toBe('Agent'); // segan/billing.js PLAN_KO 와 같은 이름
    expect($('meCredits').textContent).toBe('1,200 크레딧 · 생성 60회');
    expect($('meCompany').hidden).toBe(true);
    expect(menus()).toEqual([
      ['프로젝트 관리', ['상담']],
      ['기본 정보', basic('팩토리로 시작하기')],
    ]);
    expect(groups()).toEqual(['', '']); // 고객은 「업무」 머리글 없이
    expect(row('상담').getAttribute('href')).toBe('#p-consult');
    expect(row('팩토리로 시작하기').getAttribute('href')).toBe('#partner');
    expect($('meWork').hidden).toBe(true);
    expect($('meHub').lastElementChild.contains($('sgLogout'))).toBe(true);
    // 상담 내역 · 내 프로젝트 · A/S 접수 줄은 없다 (프로젝트 관리로 옮겼다)
    for (const label of ['상담 내역', '내 프로젝트', 'A/S 접수'])
      expect(row(label)).toBeUndefined();
  });

  test('고객 — 내 프로젝트를 읽으면 프로젝트 관리 하위 줄 일곱 (상담 ~ A/S)', async () => {
    await load({ projects: ok([]) });
    expect(menus()[0]).toEqual(['프로젝트 관리', STAGES]);
    expect(STAGES.map((l) => row(l, 'project').getAttribute('href'))).toEqual([
      '#p-consult',
      '#p-design',
      '#p-quote',
      '#p-contract',
      '#p-make',
      '#p-install',
      '#p-as',
    ]);
  });

  test('신청 중 — 기본 정보 › 「팩토리 신청」', async () => {
    await load({
      partner: partnerMe({
        application: {
          id: '66666666-6666-4666-8666-666666666666',
          kind: 'new',
          status: 'applied',
          company_name: '새 팩토리',
          created_at: '2026-10-20T03:00:00Z',
        },
      }),
    });
    expect(menus()[1]).toEqual(['기본 정보', basic('팩토리 신청')]);
  });

  test('Manager 업체 대표 — 업무: 프로젝트 관리 · 플래너(BOM 없이), 재고 · 회계 · 인력 관리 없음, 내 정보에 업체 · 역할', async () => {
    await load({ partner: member({ plan: 'manager' }), planner: PLANNER });
    expect(groups()).toEqual(['업무', '']);
    expect(menus()).toEqual([
      ['프로젝트 관리', STAGES],
      ['플래너', ['새 설계', '설계 모음', '렌더링']],
      ['기본 정보', basic('내 팩토리다담 협력 주방')],
    ]);
    expect(row('새 설계').getAttribute('href')).toBe('planner/'); // SeganShell.ROLE_LINKS planner
    expect($('meCompany').textContent).toBe('다담 협력 주방 · 대표');
    expect($('meCompany').hidden).toBe(false);
  });

  test('Expert 업체 직원 — 프로젝트 관리 · 재고 관리(준비 중), 인력 관리 없음', async () => {
    await load({ partner: member({ plan: 'expert', role: 'staff' }) });
    expect(menus()).toEqual([
      ['프로젝트 관리', STAGES],
      ['재고 관리', STOCK],
      ['기본 정보', basic('내 팩토리다담 협력 주방')],
    ]);
    expect($('meHub').querySelector('[data-menu="stock"] .me-soon-tag').textContent).toBe(
      '준비 중'
    );
    expect(row('기본 자재').classList.contains('me-row-soon')).toBe(true);
    expect($('meCompany').textContent).toBe('다담 협력 주방 · 직원');
  });

  test('Agent 업체 대표 — 프로젝트 · 플래너 · 재고 · 회계 · 인력 관리 (비서 줄은 없다 — 모든 화면 비서)', async () => {
    await load({
      partner: member(),
      ledger: ok({ money: true, level: 'full' }),
      planner: PLANNER,
      assistant: { level: 'full', can_chat: true },
    });
    expect(menus()).toEqual([
      ['프로젝트 관리', STAGES],
      ['플래너', ['새 설계', '설계 모음', '렌더링', 'BOM', '발주서 · 작업지시서']],
      ['재고 관리', STOCK],
      ['회계 관리', LEDGER],
      ['인력 관리', ['직원', '일정', '작업자']],
      ['기본 정보', basic('내 팩토리다담 협력 주방')],
    ]);
    expect(LEDGER.map((l) => row(l, 'ledger').getAttribute('href'))).toEqual([
      'ledger.html#board',
      'ledger.html#sales',
      'ledger.html#buys',
      'ledger.html#photos',
      'ledger-report.html',
      'ledger.html#settings',
    ]);
    expect(row('직원').getAttribute('href')).toBe('#staff');
    expect(row('비서')).toBeUndefined();
  });

  test('인력 관리 › 작업 분배 — 담당자를 고를 수 있을 때 (대표 · 실장, 서버 assignee_ready)', async () => {
    await load({
      partner: member(),
      companyProjects: ok({
        company: { id: CO },
        can_manage: true,
        assignee_ready: true,
        members: [],
        items: [],
      }),
    });
    expect(menus().find((m) => m[0] === '인력 관리')).toEqual([
      '인력 관리',
      ['직원', '작업 분배', '일정', '작업자'],
    ]);
    // Agent 실장 — 직원 · 초대는 대표만 (업체 칸이 그리지 않는다)
    await load({
      partner: member({ role: 'manager' }),
      companyProjects: ok({
        company: { id: CO },
        can_manage: true,
        assignee_ready: true,
        members: [],
        items: [],
      }),
    });
    expect(menus().find((m) => m[0] === '인력 관리')[1]).toEqual(['작업 분배', '일정', '작업자']);
  });

  test('회계 관리 — 장부를 보기만(read) 해도 탭 여섯, 사진만 올리면 「영수증 올리기」, 못 열면 없다', async () => {
    await load({ partner: member({ plan: 'expert' }), ledger: ok({ money: true, level: 'read' }) });
    expect(menus().find((m) => m[0] === '회계 관리')).toEqual(['회계 관리', LEDGER]);
    await load({
      partner: member({ plan: 'expert', role: 'staff' }),
      ledger: ok({ can_upload: true }),
    });
    expect(menus().find((m) => m[0] === '회계 관리')).toEqual(['회계 관리', ['영수증 올리기']]);
    expect(row('영수증 올리기').getAttribute('href')).toBe('ledger.html');
    await load({ partner: member({ plan: 'expert' }) });
    expect(menus().map((m) => m[0])).not.toContain('회계 관리');
  });

  test('다담 공장 구성원 — 내 팩토리 줄 없이, 인력 관리 › 작업자는 PC 생산 계획', async () => {
    await load({ partner: HQ, ledger: ok({ money: true, level: 'full' }), planner: PLANNER });
    expect(menus()).toEqual([
      ['프로젝트 관리', STAGES],
      ['플래너', ['새 설계', '설계 모음', '렌더링', 'BOM', '발주서 · 작업지시서']],
      ['재고 관리', STOCK],
      ['회계 관리', LEDGER],
      ['인력 관리', ['일정', '작업자']],
      ['기본 정보', BASIC],
    ]);
    expect(row('작업자').getAttribute('href')).toBe('../production.html');
    expect($('meCompany').textContent).toBe('다담 공장');
  });

  test('관리자 — 본사 묶음: 경영 대시보드는 조각으로 메뉴마다 (회계관리 장부 줄은 본사 구성원만)', async () => {
    await load({ partner: HQ, isAdmin: true });
    expect(groups()).toEqual(['업무', '본사', '']);
    const hq = menus().slice(3, -1); // 업무 셋(프로젝트 · 재고 · 인력) 다음
    expect(hq).toEqual([
      ['종합 대시보드', ['오늘 현황', '이익 · 목표']],
      ['계정관리', ['회원', '고객 흐름', '관리자 계정', '활동 로그']],
      [
        '업체관리',
        [
          '상담 배정',
          '제작 의뢰 추천',
          '팩토리 신청',
          '팩토리 평가',
          '완료 보고',
          'A/S 현황',
          '거래처 · 공급처 성적',
        ],
      ],
      ['DB관리', ['시공사례', '참고 이미지', '학습 데이터셋', '가전 모델', '거래처 · 공급처']],
      ['회계관리', ['손익 분석', '현금 · 미수', '매출 예측']],
      ['인력관리', ['작업자 · 작업 배정', '작업 지시 보고', '공정 · 품질']],
    ]);
    expect(row('이익 · 목표').getAttribute('href')).toBe('../admin/management.html?part=profit');
    expect(row('공정 · 품질').getAttribute('href')).toBe('../admin/management.html?part=process');
    expect(document.querySelector('#meHub a[href="../admin/management.html"]')).toBeNull();
    expect(row('오늘 현황').getAttribute('href')).toBe('admin.html');
    expect(row('상담 배정').getAttribute('href')).toBe('admin.html#consults');
    expect(row('제작 의뢰 추천').getAttribute('href')).toBe('admin.html#production');
    expect(row('팩토리 평가').getAttribute('href')).toBe('../admin/partner-eval.html');
    expect(row('회원').getAttribute('href')).toBe('admin.html#members');
  });

  test('다담 본사 구성원 — 본사 묶음이 맨 위, 프로젝트 관리 없음, 회계관리 = 본사 장부만 (공장 장부는 등록 업체 › 회계)', async () => {
    await load({
      partner: PLATFORM,
      isAdmin: true,
      ledger: ok({
        money: true,
        level: 'full',
        ledgers: [
          { company_id: 'p', name: '다담 본사', kind: 'platform', own: true },
          { company_id: HQ_CO, name: '다담 공장', kind: 'hq', own: false },
        ],
      }),
    });
    expect(groups()).toEqual(['본사', '']);
    expect(menus().map((m) => m[0])).toEqual([
      '종합 대시보드',
      '계정관리',
      '업체관리',
      'DB관리',
      '회계관리',
      '인력관리',
      '기본 정보',
    ]);
    // 공장 장부를 열 수 있어도 「공장 장부 보기」 줄은 없다 — 업체관리 › 등록 업체 › 다담 공장 › 회계와 겹친다.
    // 장부 줄 다음에 경영 대시보드 조각 (관리자)
    expect(menus()[4]).toEqual([
      '회계관리',
      ['한눈에', '매출', '매입', '사진', '보고서', '손익 분석', '현금 · 미수', '매출 예측'],
    ]);
    expect(document.querySelector('#meHub a[href*="company=' + HQ_CO + '"]')).toBeNull();
    expect(row('한눈에', 'hq-ledger').getAttribute('href')).toBe('ledger.html#board');
    expect(menus()[6]).toEqual(['기본 정보', BASIC]);
    expect($('meCompany').textContent).toBe('다담 본사');
    // 관리자가 아니면 관리자 줄은 없다
    await load({ partner: PLATFORM, ledger: ok({ money: true, level: 'full', ledgers: [] }) });
    expect(menus()).toEqual([
      ['회계관리', ['한눈에', '매출', '매입', '사진', '보고서']],
      ['기본 정보', BASIC],
    ]);
  });

  test('작업자 — 맨 위 「오늘 작업」 카드 (건수 · 다음 작업, 누르면 작업 화면)', async () => {
    await load({ workMe: WORKER });
    const card = $('meWork');
    expect(card.hidden).toBe(false);
    expect(card.getAttribute('href')).toBe('work.html');
    expect($('meWorkTitle').textContent).toBe('오늘 작업');
    expect([...card.querySelectorAll('.me-work-line')].map((s) => s.textContent)).toEqual([
      '예정 · 진행 2건 · 보완요청 1건 · 새 소식 3건 · 모집중 4건',
      '다음 작업 11/10(화) 09:00 · 설치 · 대구 북구 · 거실 붙박이장 (확정)',
    ]);
    // 메뉴 묶음보다 앞
    expect(card.compareDocumentPosition($('meGroupMine')) & 4).toBeTruthy();
    // 승인 대기 · 정지
    await load({ workMe: { ready: true, worker: { id: 'w1', status: 'pending' } } });
    expect($('meWorkBody').textContent).toBe('승인 대기 — 회사가 확인하면 작업을 볼 수 있습니다');
    await load({ workMe: { ...WORKER, worker: { ...WORKER.worker, status: 'suspended' } } });
    expect($('meWorkBody').textContent).toContain(window.DadamMyPageWork.SUSPENDED_NOTE);
    expect($('meWorkBody').textContent).not.toContain('모집중');
  });

  test('글은 글자로만 — 팩토리 이름 · 다음 작업', async () => {
    const bad = '<img src=x onerror=alert(1)>';
    await load({
      partner: member({ name: bad }),
      workMe: { ...WORKER, next_job: { ...WORKER.next_job, title: bad } },
    });
    expect($('meHub').querySelector('img')).toBeNull();
    expect($('mePartnerVal').textContent).toBe(bad);
    expect($('meCompany').textContent).toBe(bad + ' · 대표');
    expect($('meWorkBody').textContent).toContain(bad);
  });

  test('알림 칸이 열리면(segan/push.js) 기본 정보에 알림 줄', async () => {
    await load();
    expect(row('알림')).toBeUndefined();
    $('mePush').hidden = false;
    await flush();
    expect(row('알림', 'basic').getAttribute('href')).toBe('#notify');
  });
});

describe('메뉴 — 폰 · 태블릿은 큰 메뉴를 누르면 펼친다 (한 번에 하나), PC 는 늘 펼친다', () => {
  test('처음엔 처음 보이는 큰 메뉴, 누르면 그것만 · 다시 누르면 접는다, 고른 것은 이 탭 동안 기억', async () => {
    await load({ partner: member(), ledger: ok({ money: true, level: 'full' }) });
    expect(opened()).toEqual(['project']);
    const toggle = (key) => $('meHub').querySelector(`[data-menu-toggle="${key}"]`);
    expect(toggle('project').getAttribute('aria-expanded')).toBe('true');
    expect(toggle('ledger').getAttribute('aria-expanded')).toBe('false');
    toggle('ledger').click();
    expect(opened()).toEqual(['ledger']);
    expect(toggle('ledger').getAttribute('aria-expanded')).toBe('true');
    expect(toggle('project').getAttribute('aria-expanded')).toBe('false');
    expect(sessionStorage.getItem('segan.me.open')).toBe('ledger');
    toggle('ledger').click();
    expect(opened()).toEqual([]);
    // 하위 화면(알림 · 새로 고침으로 바로 온 직원 화면)에서 돌아오면 그 화면이 든 큰 메뉴가 펼쳐져 있다
    await load({ url: '/segan/me.html#staff', partner: member() });
    $('meBack').click();
    expect(screen()).toBe('');
    expect(opened()).toEqual(['people']);
  });

  test('PC — 누르기는 아무것도 바꾸지 않고, 모든 큰 메뉴가 펼친 것으로 읽힌다', async () => {
    await load({ wide: true, partner: member() });
    const t = $('meHub').querySelector('[data-menu-toggle="basic"]');
    expect(t.getAttribute('aria-expanded')).toBe('true');
    const before = opened();
    t.click();
    expect(opened()).toEqual(before);
  });

  test('CSS — 하위 줄은 접어 두고 .is-open 만 펼친다, PC 는 늘 펼친다', () => {
    const css = read('segan/shell.css');
    expect(css).toMatch(/\.me-subs\s*\{[^}]*display:\s*none;/);
    expect(css).toMatch(/\.me-menu\.is-open > \.me-subs\s*\{\s*display:\s*block;/);
    const wide = css
      .split('@media (min-width: 1100px)')
      .slice(1)
      .find((b) => b.includes('.me-layout'));
    expect(wide).toMatch(/\.me-subs,\s*\.me-menu\.is-open > \.me-subs\s*\{[^}]*display:\s*block;/);
    // 직원 화면은 업체 칸 안 직원 · 초대만, 다른 화면에서는 직원 · 초대를 감춘다
    expect(css).toMatch(
      /#partner:not\(\[data-me-view='staff'\]\) \.me-pt-staff\s*\{\s*display:\s*none;/
    );
  });
});

describe('하위 화면 — 주소 #이름', () => {
  test.each([
    [
      '#partner',
      'partner',
      ['mePartnerTitle', 'mePartner'],
      '내 팩토리',
      '내 팩토리다담 협력 주방',
    ],
    ['#partner-consults', 'partner-consults', ['partner-consults'], '상담', '상담'],
    ['#partner-projects', 'partner-projects', ['partnerProjects'], '프로젝트', null],
    ['#as', 'as', ['as'], 'A/S함', 'A/S'],
    ['#p-consult', 'p-consult', ['partner-consults', 'partnerProjects'], '상담', '상담'],
    ['#p-design', 'p-design', ['partnerProjects'], '설계', '설계'],
    ['#p-as', 'p-as', ['as'], 'A/S', 'A/S'],
  ])(
    '%s → 업체 칸의 그 부분만 (제목 · 「‹ 마이페이지」 · 밝힌 하위 줄)',
    async (hash, name, parts, title, lit) => {
      await load({ url: '/segan/me.html' + hash, partner: member({ plan: 'expert' }) });
      expect(screen()).toBe(name);
      expect(onScreen()).toEqual(['partner']);
      expect(partnerParts()).toEqual(parts);
      expect($('meTitle').textContent).toBe(title);
      expect($('meBack').hidden).toBe(false);
      expect($('mePaneNote').hidden).toBe(true);
      const current = [...$('meHub').querySelectorAll('a[aria-current="page"]')].map(
        (a) => a.textContent
      );
      expect(current).toEqual(lit ? [lit] : []);
      expect(document.title).toBe(title + ' · 마이페이지 · SEGAN');
    }
  );

  test('설계 화면 — 업체 프로젝트를 그 단계로 거른다 (머리글 「설계 단계 프로젝트」)', async () => {
    await load({ url: '/segan/me.html#p-design', partner: member({ plan: 'expert' }) });
    expect($('partnerProjects').querySelector('.me-pt-sub').textContent).toBe('설계 단계 프로젝트');
  });

  test('준비 중 — 재고 관리 · 일정 · Manager 의 A/S: 칸 없이 안내 한 줄', async () => {
    await load({ url: '/segan/me.html#stock-board', partner: member({ plan: 'expert' }) });
    expect(onScreen()).toEqual([]);
    expect($('mePaneNote').hidden).toBe(false);
    expect($('mePaneNote').classList.contains('me-soon')).toBe(true);
    expect($('mePaneNote').textContent).toContain('재고 관리는 준비 중입니다.');
    expect($('meTitle').textContent).toBe('기본 자재');
    await load({ url: '/segan/me.html#p-as', partner: member({ plan: 'manager' }) });
    expect($('mePaneNote').textContent).toBe(window.SeganMe.TEXT.managerAs);
    await load({ url: '/segan/me.html#schedule', partner: member() });
    expect($('mePaneNote').textContent).toContain('일정은 준비 중입니다.');
  });

  test('인력 관리 › 직원 — 업체 칸 안 직원 · 초대만 (data-me-view staff), 내 팩토리 화면에는 직원 · 초대가 없다', async () => {
    await load({ url: '/segan/me.html#staff', partner: member() });
    expect(screen()).toBe('staff');
    expect(partnerParts()).toEqual(['mePartner']);
    expect($('partner').getAttribute('data-me-view')).toBe('staff');
    expect($('mePartner').querySelector('.me-pt-staff')).not.toBeNull();
    expect($('meTitle').textContent).toBe('직원');
    await load({ url: '/segan/me.html#partner', partner: member() });
    expect($('partner').getAttribute('data-me-view')).toBe('');
    // Manager — 직원 화면이 없다
    await load({ url: '/segan/me.html#staff', partner: member({ plan: 'manager' }) });
    expect($('mePaneNote').textContent).toBe('볼 수 있는 내용이 없습니다.');
  });

  test.each([
    ['#consults', 'meConsultSection', '상담 내역'],
    ['#projects-mine', 'meProjectSection', '내 프로젝트'],
    ['#p-consult', 'meConsultSection', '상담'],
    ['#p-design', 'meProjectSection', '설계'],
  ])('고객 %s → 그 칸 하나', async (hash, id, title) => {
    await load({ url: '/segan/me.html' + hash, projects: ok([]) });
    expect(onScreen()).toEqual([id]);
    expect($('meTitle').textContent).toBe(title);
  });

  test('고객 A/S — 접수가 없으면 설치 화면에서 신청한다는 안내', async () => {
    await load({ url: '/segan/me.html#p-as', projects: ok([]) });
    expect(onScreen()).toEqual([]);
    expect($('mePaneNote').textContent).toBe(window.SeganMe.TEXT.noAsMine);
  });

  test('카드 등록이 끝나지 않고 돌아오면(?failed=1) 내 팩토리 화면에 안내', async () => {
    await load({ url: '/segan/me.html?failed=1&code=PAY_PROCESS_CANCELED', partner: partnerMe() });
    expect(window.location.hash).toBe('#partner');
    expect(screen()).toBe('partner');
    expect($('mePartner').querySelector('.me-pt-err').textContent).toBe(
      '결제가 완료되지 않았습니다. 다시 시도해 주세요.'
    );
  });

  test('못 여는 화면으로 오면 — 「볼 수 있는 내용이 없습니다」 (고객의 #as · 공장 구성원의 #partner)', async () => {
    await load({ url: '/segan/me.html#as' });
    expect(screen()).toBe('as');
    expect(onScreen()).toEqual([]);
    expect($('mePaneNote').hidden).toBe(false);
    expect($('mePaneNote').textContent).toBe('볼 수 있는 내용이 없습니다.');
    await load({ url: '/segan/me.html#partner', partner: HQ });
    expect($('partner').hidden).toBe(false); // 공장 구성원 — 업체 칸은 상담 · 프로젝트 · A/S함으로 열렸다
    expect($('mePartner').children).toHaveLength(0);
    expect(onScreen()).toEqual([]);
    expect($('mePaneNote').textContent).toBe('볼 수 있는 내용이 없습니다.');
  });

  test('모르는 # 는 메뉴', async () => {
    await load({ url: '/segan/me.html#nothing' });
    expect(screen()).toBe('');
    expect($('meBack').hidden).toBe(true);
    expect($('meTitle').textContent).toBe('마이페이지');
  });

  test('메뉴에서 누르면 기록을 넣고, 「‹ 마이페이지」 는 뒤로 가기로 메뉴에 돌아온다', async () => {
    await load({ partner: member({ plan: 'expert' }) });
    const before = window.history.length;
    row('상담').click();
    expect(window.location.hash).toBe('#p-consult');
    expect(window.history.length).toBe(before + 1);
    expect(screen()).toBe('p-consult');
    expect($('meTitle').textContent).toBe('상담');
    $('meBack').click();
    await flush();
    expect(window.location.hash).toBe('');
    expect(screen()).toBe('');
    expect($('meTitle').textContent).toBe('마이페이지');
    expect($('meBack').hidden).toBe(true);
    // 앞으로 가기 — 다시 그 화면
    window.history.forward();
    await flush();
    expect(screen()).toBe('p-consult');
  });

  test('알림 · 새로 고침으로 바로 왔으면 「‹ 마이페이지」 가 이 기록을 메뉴로 바꾼다 (뒤로 가면 앱 밖)', async () => {
    await load({ url: '/segan/me.html#as', partner: member({ plan: 'expert' }) });
    const before = window.history.length;
    $('meBack').click();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/segan/me.html');
    expect(window.history.length).toBe(before);
    expect(screen()).toBe('');
    expect(opened()).toEqual(['project']); // A/S함이 든 프로젝트 관리를 펼쳐 둔다
  });

  test('앱이 열린 채 알림이 # 만 바꾸면 그 화면으로', async () => {
    await load({ partner: member({ plan: 'expert' }) });
    window.history.replaceState(null, '', '/segan/me.html#as');
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    await flush();
    expect(screen()).toBe('as');
    expect(partnerParts()).toEqual(['as']);
  });

  test('로그인 전 — 하위 화면 주소면 로그인 뒤 같은 화면으로', async () => {
    for (const name of [
      'partner',
      'partner-consults',
      'as',
      'consults',
      'notify',
      'p-consult',
      'staff',
    ]) {
      await load({ session: null, url: '/segan/me.html#' + name });
      expect(
        document.querySelector('[data-auth-view="signed-out"] a.sg-btn').getAttribute('href')
      ).toBe('../login.html?redirect=' + encodeURIComponent('segan/me.html#' + name));
    }
    await load({ session: null, url: '/segan/me.html#nothing' });
    expect(
      document.querySelector('[data-auth-view="signed-out"] a.sg-btn').getAttribute('href')
    ).toBe('../login.html?redirect=' + encodeURIComponent('segan/me.html'));
  });
});

describe('움직임 — 들어온 쪽으로 (segan/motion.js · CLAUDE.md 「SEGAN 모션 규칙」)', () => {
  afterEach(() => {
    delete window.SeganMotion;
  });

  test('폰 — 하위 화면은 오른쪽에서, 메뉴는 왼쪽에서 들어온다 · 펼친 하위 줄은 차례로 내려온다', async () => {
    await load({ partner: member({ plan: 'expert' }) });
    const enter = jest.fn();
    window.SeganMotion = { enter };
    row('상담').click();
    expect(enter).toHaveBeenCalledWith($('mePane'), {
      transform: 'translateX(28px)',
      opacity: 0.3,
    });
    enter.mockClear();
    $('meBack').click();
    await flush();
    expect(enter).toHaveBeenCalledWith($('meHub'), {
      transform: 'translateX(-28px)',
      opacity: 0.3,
    });
    enter.mockClear();
    $('meHub').querySelector('[data-menu-toggle="basic"]').click();
    const rows = [
      ...$('meHub').querySelectorAll('[data-menu="basic"] li[data-me-item]:not([hidden])'),
    ];
    expect(rows.length).toBeGreaterThan(1);
    expect(enter.mock.calls.map((c) => c[0])).toEqual(rows);
    expect(enter.mock.calls[1]).toEqual([
      rows[1],
      { transform: 'translateY(-6px)', opacity: 0.2 },
      28,
    ]);
    // 접을 때는 움직이지 않는다
    enter.mockClear();
    $('meHub').querySelector('[data-menu-toggle="basic"]').click();
    expect(enter).not.toHaveBeenCalled();
  });

  test('움직임 파일이 없으면 그대로 (화면만 바뀐다)', async () => {
    await load({ partner: member({ plan: 'expert' }) });
    row('상담').click();
    expect(screen()).toBe('p-consult');
  });
});

describe('PC 1100px~ — 왼쪽 메뉴 + 오른쪽 하위 화면', () => {
  test('# 없이 — 메뉴 차례대로 처음 보이는 하위 화면 (업체 · 고객 모두 프로젝트 관리 › 상담), 제목은 마이페이지 그대로', async () => {
    await load({ wide: true, partner: member({ plan: 'expert' }) });
    expect(screen()).toBe('p-consult');
    expect(window.location.hash).toBe('');
    expect(partnerParts()).toEqual(['partner-consults', 'partnerProjects']);
    expect(row('상담').getAttribute('aria-current')).toBe('page');
    expect($('meTitle').textContent).toBe('마이페이지');
    expect($('meBack').hidden).toBe(true);
    await load({ wide: true });
    expect(screen()).toBe('p-consult');
    expect(onScreen()).toEqual(['meConsultSection']);
  });

  test('다담 공장 구성원 · 다담 본사 구성원(관리자) — 첫 하위 화면', async () => {
    await load({ wide: true, partner: HQ });
    expect(screen()).toBe('p-consult');
    // 본사 — 본사 묶음의 줄은 모두 페이지라, 처음 화면은 기본 정보 › 좋아요
    await load({ wide: true, partner: PLATFORM, isAdmin: true });
    expect(screen()).toBe('likes');
  });

  test('# 가 있어도 제목은 마이페이지 (왼쪽 메뉴가 늘 보인다)', async () => {
    await load({ wide: true, url: '/segan/me.html#consults' });
    expect(screen()).toBe('consults');
    expect($('meTitle').textContent).toBe('마이페이지');
  });

  test('CSS — 1100px~ 두 칸 · 1100px 아래는 메뉴와 하위 화면을 나눠 보인다', () => {
    const css = read('segan/shell.css');
    const wide = css
      .split('@media (min-width: 1100px)')
      .slice(1)
      .find((b) => b.includes('.me-layout'));
    expect(wide).toMatch(/\.me-layout\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/);
    expect(wide).toMatch(/\.me-back\s*\{\s*display:\s*none;/);
    const narrow = css.split('@media (max-width: 1099.98px)')[1];
    expect(narrow).toMatch(/\.me-main\[data-me-screen=''\] \.me-pane\s*\{\s*display:\s*none;/);
    expect(narrow).toMatch(
      /\.me-main:not\(\[data-me-screen=''\]\) \.me-hub\s*\{\s*display:\s*none;/
    );
    expect(css).toMatch(/\.me-pane \.me-off\s*\{\s*display:\s*none;/);
  });
});

describe('플래너 · PC 관리자 화면 — PC 브라우저에서만 새 탭', () => {
  test('PC 브라우저면 target _blank · rel noopener, 폰 · 태블릿이면 같은 창', async () => {
    await load({ wide: true, partner: member(), planner: PLANNER });
    const a = row('새 설계');
    expect([a.getAttribute('target'), a.getAttribute('rel')]).toEqual(['_blank', 'noopener']);
    await load({ partner: member(), planner: PLANNER });
    expect(row('새 설계').getAttribute('target')).toBeNull();
    // 설치한 앱 (PC 라도 같은 창)
    window.matchMedia = media({ ...PC, '(display-mode: standalone)': true });
    document.addEventListener('click', (e) => e.preventDefault(), { once: true }); // jsdom 은 이동하지 않는다
    row('새 설계').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    expect(row('새 설계').getAttribute('target')).toBeNull();
  });

  test('앱 안 줄(회계 · 앱 관리)은 늘 같은 창, PC 관리자 화면은 PC 에서 새 탭', async () => {
    await load({
      wide: true,
      partner: member(),
      isAdmin: true,
      ledger: ok({ money: true, level: 'full' }),
    });
    for (const label of ['한눈에', '오늘 현황', '상담 배정'])
      expect([label, row(label).getAttribute('target')]).toEqual([label, null]);
    expect(row('관리자 계정').getAttribute('target')).toBe('_blank');
  });
});
