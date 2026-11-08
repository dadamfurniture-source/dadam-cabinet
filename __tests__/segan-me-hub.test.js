/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Element */
/**
 * SEGAN 마이페이지 메뉴 · 하위 화면 (segan/me.js + segan/me.html) — 페이지가 싣는 실제 모듈을 모두 올린다
 * (업체 칸 · 상담 · 회계 · 프로젝트 · A/S · 결제 · 셸 · 만들기 · 마이페이지, 알림 push.js 만 뺀다).
 *
 *   메뉴    쓸 수 있는 줄만 — 고객 · Manager · Expert · Agent 업체 구성원 · 다담 공장 · 관리자 · 작업자
 *           업체 구성원은 업체 · 본사 · 내 것 차례, 아니면 내 것 · 업체 · 본사. 맨 아래 로그아웃
 *   하위 화면 주소 #이름 — 알림 · 결제가 여는 #partner · #partner-consults · #as · ?failed=1 은 그 화면
 *           메뉴에서 누르면 기록을 넣고, 「‹ 마이페이지」 는 메뉴에서 왔으면 뒤로 · 바로 왔으면 메뉴로 바꾼다
 *   PC      1100px~ 두 칸 — # 가 없으면 업체 구성원은 업체 첫 칸, 아니면 상담 내역
 *   설계    PC 브라우저에서만 새 탭 (SeganShell.desktopTab — 규칙은 __tests__/segan-shell.test.js)
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
/** 보이는 묶음 — [묶음 이름, [줄 글 …]] (메뉴 차례대로) */
const hub = () =>
  [...$('meHub').querySelectorAll('.me-group:not([hidden])')].map((g) => [
    g.querySelector('h2').textContent,
    [...g.querySelectorAll('li:not([hidden]) .sg-row')].map((a) => a.textContent),
  ]);
const row = (label) =>
  [...$('meHub').querySelectorAll('li:not([hidden]) a.sg-row')].find(
    (a) => a.textContent === label
  );
/** 하위 화면에 보이는 칸 · 업체 칸 안의 부분 */
const onScreen = () =>
  [...$('mePane').querySelectorAll(':scope > section')]
    .filter((s) => !s.hidden && !s.classList.contains('me-off'))
    .map((s) => s.id);
const partnerParts = () =>
  [...$('partner').children]
    .filter((el) => !el.hidden && !el.classList.contains('me-off'))
    .map((el) => el.id);

const MINE = ['내 연출컷', '상담 내역', '크레딧 · 구독없음', '내 활동', '설정'];

afterEach(() => {
  jest.restoreAllMocks();
  delete window.matchMedia;
});

describe('메뉴 — 쓸 수 있는 줄만', () => {
  test('고객 — 내 정보(이름 · 이메일 · 등급 · 크레딧), 내 것 → 업체(팩토리로 시작하기), 맨 아래 로그아웃', async () => {
    await load();
    expect(screen()).toBe('');
    expect($('meName').textContent).toBe('김대표');
    expect($('sgAccountEmail').textContent).toBe('owner@example.com');
    expect($('meTier').textContent).toBe('Agent'); // segan/billing.js PLAN_KO 와 같은 이름
    expect($('meCredits').textContent).toBe('1,200 크레딧 · 생성 60회');
    expect(hub()).toEqual([
      ['내 것', MINE],
      ['업체', ['팩토리로 시작하기']],
    ]);
    expect(row('팩토리로 시작하기').getAttribute('href')).toBe('#partner');
    expect($('meWork').hidden).toBe(true);
    expect($('meHub').lastElementChild.contains($('sgLogout'))).toBe(true);
  });

  test('고객 — 내 프로젝트 · A/S 접수는 그 칸을 읽었을 때만 (상담 내역 다음)', async () => {
    await load({
      projects: ok([]),
      mineAs: ok({
        ready: true,
        items: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            factory: '다담 공장',
            order_no: 'SO-1',
            body: '문',
            state: 'requested',
            label: '접수',
            created_at: '2026-11-06T01:00:00Z',
            can_cancel: true,
          },
        ],
      }),
    });
    expect(hub()[0]).toEqual([
      '내 것',
      ['내 연출컷', '상담 내역', '내 프로젝트', 'A/S 접수', '크레딧 · 구독없음', '내 활동', '설정'],
    ]);
    expect(row('내 프로젝트').getAttribute('href')).toBe('#projects-mine');
    expect(row('A/S 접수').getAttribute('href')).toBe('#as-mine');
  });

  test('신청 중 — 「팩토리 신청」', async () => {
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
    expect(hub()[1]).toEqual(['업체', ['팩토리 신청']]);
  });

  test('Manager 업체 대표 — 업체가 먼저: 팩토리(업체 이름) · 프로젝트 · 설계 (상담 · A/S함은 Expert 부터)', async () => {
    await load({ partner: member({ plan: 'manager' }), planner: PLANNER });
    expect(hub()).toEqual([
      ['업체', ['팩토리다담 협력 주방', '프로젝트', '설계']],
      ['내 것', MINE],
    ]);
    expect(row('설계').getAttribute('href')).toBe('planner/');
  });

  test('Expert 업체 직원 — 팩토리 · 상담 · 프로젝트 · A/S함 (빈 A/S함도 보인다)', async () => {
    await load({ partner: member({ plan: 'expert', role: 'staff' }) });
    expect(hub()[0]).toEqual(['업체', ['팩토리다담 협력 주방', '상담', '프로젝트', 'A/S함']]);
    expect(row('상담').getAttribute('href')).toBe('#partner-consults');
    expect(row('프로젝트').getAttribute('href')).toBe('#partner-projects');
    expect(row('A/S함').getAttribute('href')).toBe('#as');
  });

  test('Agent 업체 대표 — 회계(장부 full) · 설계 · 비서까지', async () => {
    await load({
      partner: member(),
      ledger: ok({ money: true, level: 'full' }),
      planner: PLANNER,
      assistant: { level: 'full', can_chat: true },
    });
    expect(hub()[0]).toEqual([
      '업체',
      ['팩토리다담 협력 주방', '상담', '프로젝트', 'A/S함', '회계', '설계', '비서'],
    ]);
    expect(row('회계').getAttribute('href')).toBe('ledger.html');
    expect(row('비서').getAttribute('href')).toBe('assistant.html');
  });

  test('회계 — 장부를 보기만(read) 해도 「회계」, 사진만 올리면 「영수증 · 명세표 올리기」, 못 열면 없다', async () => {
    await load({ partner: member({ plan: 'expert' }), ledger: ok({ money: true, level: 'read' }) });
    expect(hub()[0][1]).toContain('회계');
    await load({
      partner: member({ plan: 'expert', role: 'staff' }),
      ledger: ok({ can_upload: true }),
    });
    expect(hub()[0][1]).toContain('영수증 · 명세표 올리기');
    expect(row('영수증 · 명세표 올리기').getAttribute('href')).toBe('ledger.html');
    await load({ partner: member({ plan: 'expert' }) });
    expect(hub()[0][1]).not.toContain('회계');
  });

  test('다담 공장 구성원 — 팩토리 줄 없이 상담 · 프로젝트 · A/S함 · 회계 · 설계', async () => {
    await load({ partner: HQ, ledger: ok({ money: true, level: 'full' }), planner: PLANNER });
    expect(hub()).toEqual([
      ['업체', ['상담', '프로젝트', 'A/S함', '회계', '설계']],
      ['내 것', MINE],
    ]);
  });

  test('관리자 — 본사: 관리 · 관리자 화면 (PC)', async () => {
    await load({ partner: HQ, isAdmin: true });
    expect(hub()).toEqual([
      ['업체', ['상담', '프로젝트', 'A/S함']],
      ['본사', ['관리', '관리자 화면 (PC)']],
      ['내 것', MINE],
    ]);
    expect(row('관리').getAttribute('href')).toBe('admin.html');
    expect(row('관리자 화면 (PC)').getAttribute('href')).toBe('../admin/index.html');
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
    expect($('meWorkBody').textContent).toContain(bad);
  });

  test('알림 칸이 열리면(segan/push.js) 「내 것」 에 알림 줄', async () => {
    await load();
    expect(row('알림')).toBeUndefined();
    $('mePush').hidden = false;
    await flush();
    expect(row('알림').getAttribute('href')).toBe('#notify');
  });
});

describe('하위 화면 — 주소 #이름', () => {
  test.each([
    ['#partner', 'partner', ['mePartnerTitle', 'mePartner'], '팩토리'],
    ['#partner-consults', 'partner-consults', ['partner-consults'], '상담'],
    ['#partner-projects', 'partner-projects', ['partnerProjects'], '프로젝트'],
    ['#as', 'as', ['as'], 'A/S함'],
  ])(
    '알림 · 결제가 여는 %s → 업체 칸의 그 부분만 (제목 · 「‹ 마이페이지」)',
    async (hash, name, parts, title) => {
      await load({ url: '/segan/me.html' + hash, partner: member({ plan: 'expert' }) });
      expect(screen()).toBe(name);
      expect(onScreen()).toEqual(['partner']);
      expect(partnerParts()).toEqual(parts);
      expect($('meTitle').textContent).toBe(title);
      expect($('meBack').hidden).toBe(false);
      expect($('mePaneNote').hidden).toBe(true);
      expect(
        row(name === 'partner' ? '팩토리다담 협력 주방' : title).getAttribute('aria-current')
      ).toBe('page');
      expect(document.title).toBe(title + ' · 마이페이지 · SEGAN');
    }
  );

  test.each([
    ['#consults', 'meConsultSection', '상담 내역'],
    ['#projects-mine', 'meProjectSection', '내 프로젝트'],
  ])('%s → 그 칸 하나', async (hash, id, title) => {
    await load({ url: '/segan/me.html' + hash, projects: ok([]) });
    expect(onScreen()).toEqual([id]);
    expect($('meTitle').textContent).toBe(title);
  });

  test('카드 등록이 끝나지 않고 돌아오면(?failed=1) 팩토리 화면에 안내', async () => {
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
    expect(window.location.hash).toBe('#partner-consults');
    expect(window.history.length).toBe(before + 1);
    expect(screen()).toBe('partner-consults');
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
    expect(screen()).toBe('partner-consults');
  });

  test('알림 · 새로 고침으로 바로 왔으면 「‹ 마이페이지」 가 이 기록을 메뉴로 바꾼다 (뒤로 가면 앱 밖)', async () => {
    await load({ url: '/segan/me.html#as', partner: member({ plan: 'expert' }) });
    const before = window.history.length;
    $('meBack').click();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/segan/me.html');
    expect(window.history.length).toBe(before);
    expect(screen()).toBe('');
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
    for (const name of ['partner', 'partner-consults', 'as', 'consults', 'notify']) {
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

describe('PC 1100px~ — 왼쪽 메뉴 + 오른쪽 하위 화면', () => {
  test('# 없이 — 업체 구성원은 팩토리, 고객은 상담 내역 (제목은 마이페이지 그대로)', async () => {
    await load({ wide: true, partner: member({ plan: 'expert' }) });
    expect(screen()).toBe('partner');
    expect(window.location.hash).toBe('');
    expect(partnerParts()).toEqual(['mePartnerTitle', 'mePartner']);
    expect(row('팩토리다담 협력 주방').getAttribute('aria-current')).toBe('page');
    expect($('meTitle').textContent).toBe('마이페이지');
    expect($('meBack').hidden).toBe(true);
    await load({ wide: true });
    expect(screen()).toBe('consults');
    expect(onScreen()).toEqual(['meConsultSection']);
    expect(row('상담 내역').getAttribute('aria-current')).toBe('page');
  });

  test('다담 공장 구성원은 업체 묶음의 첫 칸(상담)', async () => {
    await load({ wide: true, partner: HQ });
    expect(screen()).toBe('partner-consults');
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

describe('설계 — PC 브라우저에서만 새 탭', () => {
  test('PC 브라우저면 target _blank · rel noopener, 폰 · 태블릿이면 같은 창', async () => {
    await load({ wide: true, partner: member(), planner: PLANNER });
    const a = row('설계');
    expect([a.getAttribute('target'), a.getAttribute('rel')]).toEqual(['_blank', 'noopener']);
    await load({ partner: member(), planner: PLANNER });
    expect(row('설계').getAttribute('target')).toBeNull();
    // 설치한 앱 (PC 라도 같은 창)
    window.matchMedia = media({ ...PC, '(display-mode: standalone)': true });
    document.addEventListener('click', (e) => e.preventDefault(), { once: true }); // jsdom 은 이동하지 않는다
    row('설계').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(row('설계').getAttribute('target')).toBeNull();
  });

  test('다른 줄(비서 · 관리 · 회계)은 늘 같은 창', async () => {
    await load({
      wide: true,
      partner: member(),
      isAdmin: true,
      assistant: { level: 'full' },
      ledger: ok({ money: true, level: 'full' }),
    });
    for (const label of ['비서', '관리', '관리자 화면 (PC)', '회계'])
      expect([label, row(label).getAttribute('target')]).toEqual([label, null]);
  });
});
