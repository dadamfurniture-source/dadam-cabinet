/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「내 정보 › 팩토리」 안의 프로젝트 (segan/partner-projects.js + segan/me.html #partnerProjects)
 *
 *   누가    다담 공장 구성원 · Manager · Expert · Agent 협력업체 구성원 (account-api GET /partner/me)
 *           업체 없음 · /partner/me 를 못 읽음 → 묻지도 않고 칸이 없다. 서버 403 → 칸째 감춘다
 *   데이터  workflow-api GET /company/projects (본인 토큰) → { company, can_manage, items }
 *   만들기  can_manage 일 때 「새 고객 · 프로젝트」 → POST /company/projects
 *           { title, customer: { name, phone } } | { title, customer_id }, 보내기 전 서버와 같은 검사
 *   담당자  assignee_ready 일 때 줄마다 「담당 이름 (역할)」 · 대표 · 실장은 「담당자」 → PUT /company/projects/:id/assignee
 *   실측    visit_ready 일 때(DB 0079) 단계 띠 여덟 칸 · 「실측 일정 잡기」 → 실측 칸 → PUT · PATCH /company/projects/:id/visit
 *           (2026-11-21 대표님 「실측 일정을 잡아야 하고 설계 전에 이루어져야 함」 — 차례는 서버의 다음 할 일이 정한다)
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
const P1 = '22222222-2222-4222-8222-222222222221';
const P2 = '22222222-2222-4222-8222-222222222222';
const C1 = '33333333-3333-4333-8333-333333333331';
const C2 = '33333333-3333-4333-8333-333333333332';
const M1 = '44444444-4444-4444-8444-444444444441';
const M2 = '44444444-4444-4444-8444-444444444442';

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const company = (extra = {}) => ({
  id: CO,
  name: '다담 협력 주방',
  plan: 'expert',
  next_plan: null,
  status: 'active',
  sido: '대구광역시',
  gugun: '북구',
  role: 'owner',
  created_at: '2026-10-01T00:00:00Z',
  ...extra,
});
const partnerMe = (extra = {}) =>
  ok({ company: company(extra), application: null, members: [], invites: [] });

const projects = (extra = {}) => ({
  company: { id: CO, name: '다담 협력 주방', kind: 'partner', plan: 'expert' },
  can_manage: true,
  items: [
    {
      id: P2,
      title: '붙박이장',
      status: 'closed',
      created_at: '2026-10-20T16:00:00Z', // 한국 시간 10-21
      closed_at: '2026-10-25T00:00:00Z',
      customer: { id: C1, name: '김고객', phone: '010-1111-2222' },
      design_count: 2,
    },
    {
      id: P1,
      title: '싱크대',
      status: 'active',
      created_at: '2026-10-10T00:00:00Z',
      closed_at: null,
      customer: { id: C1, name: '김고객', phone: '010-1111-2222' },
      design_count: 0,
    },
    { id: 'not-a-uuid', title: '빼는 줄', status: 'active', customer: null, design_count: 0 },
  ],
  ...extra,
});

/**
 * me.html 을 올린다. opts.list() → GET /company/projects 응답, opts.create(body) → POST 응답 (Error 면 끊김)
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: partnerMe(),
    list: () => ok(projects()),
    create: () => ok({ project_id: P1, customer_id: C2 }, 201),
    assign: (body) => ok({ project_id: P1, assignee_id: body.assignee_id, assigned_at: '2026-11-06T00:00:00Z' }),
    workflowUrl: WORK,
    ...options,
  };
  window.history.replaceState(null, '', '/segan/me.html');
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
    'SeganPartner',
    'SeganPartnerProjects',
    'SeganProjectSheet',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: opts.workflowUrl },
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
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.fetch.push({
      url,
      method: init.method || 'GET',
      auth: (init.headers || {}).Authorization,
      body,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/company/projects')
      return reply(await ((init.method || 'GET') === 'POST' ? opts.create(body) : opts.list()));
    if (url.startsWith(WORK + '/company/projects/') && url.endsWith('/assignee'))
      return reply(await opts.assign(body, url));
    if (url.startsWith(WORK + '/company/projects/') && url.endsWith('/status') && opts.status)
      return reply(await opts.status(body, url));
    if (url.startsWith(WORK + '/company/projects/') && url.endsWith('/visit') && opts.visit)
      return reply(await opts.visit(body, url, init.method));
    if (url.startsWith(WORK + '/company/projects/') && opts.one) return reply(await opts.one(url));
    if (url === PAY + '/subscription') return reply(ok({ plan: 'free', status: 'active' }));
    if (url === PAY + '/plans') return reply(ok({ client_key: 'k', plans: [] }));
    if (url === WORK + '/me/projects') return reply(fail(404, 'not_found', 'x'));
    return reply(ok({ ready: true, worker: null })); // /work/me
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
const box = () => $('partnerProjects');
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const projectCalls = (calls) => calls.fetch.filter((f) => f.url === WORK + '/company/projects');
// 줄마다 [이름, 고객 · 날 · 설계 수, 전화, 상태] 칸 글자 (없는 칸은 빠진다)
const rows = () =>
  [...box().querySelectorAll('[data-project]')].map((li) =>
    [...li.querySelectorAll('b, small, .me-pr-status')].map((el) => el.textContent).join(' | ')
  );
const setValue = (sel, v) => {
  const el = box().querySelector(sel);
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const pick = (value) => {
  const el = box().querySelector(`input[name="mode"][value="${value}"]`);
  el.checked = true;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const submit = async () => {
  box()
    .querySelector('form[data-form="project"]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
};

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸(#partner) 안, 제작 의뢰 아래 · 상담 설정 위, 처음엔 감춘다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('partnerProjects');
    expect(el).not.toBeNull();
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('partner');
    const ids = [...el.parentElement.children].map((x) => x.id);
    const pos = (id) => ids.indexOf(id);
    expect(pos('partnerProjects')).toBeGreaterThan(pos('production-requests'));
    expect(pos('partnerProjects')).toBeLessThan(pos('partnerConsultSettings'));
    expect(pos('partnerProjects')).toBeLessThan(pos('meBooks'));
    const srcs = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    const at = (name) => srcs.findIndex((s) => s.startsWith(name + '?v='));
    expect(at('partner-projects.js')).toBeGreaterThan(at('partner.js'));
    expect(at('partner-projects.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'partner-projects.js')");
  });

  test('상태 이름 = segan/me.js PROJECT_STATUS, 한도 = 워커 company-projects.js', async () => {
    await load();
    const P = window.SeganPartnerProjects;
    expect(read('segan/me.js')).toContain(
      "var PROJECT_STATUS = { on_hold: '보류', closed: '끝남', cancelled: '취소', handed_over: '넘김' };"
    );
    expect(P.PROJECT_STATUS).toEqual({ on_hold: '보류', closed: '끝남', cancelled: '취소', handed_over: '넘김' });
    const worker = read('workers/workflow-api/src/company-projects.js');
    expect(worker).toContain(`PROJECT_TITLE_MAX = ${P.TITLE_MAX};`);
    expect(worker).toContain(`CUSTOMER_NAME_MAX = ${P.NAME_MAX};`);
    expect(worker).toContain(`PHONE_RE = ${String(P.PHONE_RE)};`);
  });
});

describe('누가 보나', () => {
  test('판정 — 다담 공장 구성원 · Manager · Expert · Agent 구성원만', async () => {
    await load();
    const { canSee } = window.SeganPartnerProjects;
    expect(canSee({ hq_member: true, company: null })).toBe(true);
    expect(canSee({ company: company() })).toBe(true);
    expect(canSee({ company: company({ plan: 'agent', role: 'staff' }) })).toBe(true);
    expect(canSee({ company: company({ plan: 'manager' }) })).toBe(true); // 등급 Manager (2026-11-08)
    expect(canSee({ company: company({ plan: 'manager', role: 'manager' }) })).toBe(true); // 실장
    expect(canSee({ company: company({ plan: 'standard' }) })).toBe(false);
    // 워커 프로젝트 등급과 같다
    expect(read('workers/workflow-api/src/company-projects.js')).toContain(
      "export const PROJECT_PLANS = Object.freeze(['manager', 'expert', 'agent']);"
    );
    expect(canSee({ company: company({ role: 'guest' }) })).toBe(false);
    expect(canSee({ company: null })).toBe(false);
    expect(canSee({ hq_member: 'yes' })).toBe(false);
    expect(canSee(null)).toBe(false);
  });

  test('업체 없음 · /partner/me 못 읽음 → 묻지 않고 칸이 없다', async () => {
    for (const partner of [ok({ company: null, application: null }), fail(500, 'x', 'x')]) {
      const calls = await load({ partner });
      await flush();
      expect(projectCalls(calls)).toHaveLength(0);
      expect(box().hidden).toBe(true);
    }
  });

  test('서버 403 · 끊김 · 모양이 틀림 → 칸째 감춘다', async () => {
    for (const list of [
      () => fail(403, 'not_project_company', 'x'),
      () => new Error('offline'),
      () => ok({ items: 'x' }),
    ]) {
      const calls = await load({ list });
      await flush();
      expect(projectCalls(calls)).toHaveLength(1);
      expect(box().hidden).toBe(true);
      expect(box().innerHTML).toBe('');
    }
  });

  test('다담 공장 구성원 — 업체 내용 없이 업체 칸을 연다', async () => {
    await load({ partner: ok({ hq_member: true, company: null }) });
    await flush();
    expect(box().hidden).toBe(false);
    expect($('partner').hidden).toBe(false);
  });
});

describe('프로젝트 관리 — 단계로 거른 보기 (segan/me.js 가 setView)', () => {
  const P3 = '22222222-2222-4222-8222-222222222223';
  const staged = () =>
    ok(
      projects({
        assignee_ready: true,
        members: [],
        items: [
          { ...projects().items[0], stage: 'installed', order: { id: P2, order_no: 'A-1', status: 'completed' } },
          { ...projects().items[1], stage: 'design', order: null },
          {
            id: P3,
            title: '신발장',
            status: 'active',
            created_at: '2026-10-05T00:00:00Z',
            customer: { id: C2, name: '이고객', phone: null },
            design_count: 1,
            stage: 'order',
            order: { id: P3, order_no: 'A-2', status: 'in_production' },
          },
        ],
      })
    );
  const openScreen = async (hash) => {
    window.history.replaceState(null, '', '/segan/me.html#' + hash);
    window.SeganMe.apply();
    await flush();
  };
  const titles = () => [...box().querySelectorAll('[data-project] b')].map((b) => b.textContent);

  test('단계 — 연출컷 · 설계 = 설계, 수주는 상태로 계약 · 제작 · 설치 (segan/me.js menuStage 와 같다)', async () => {
    await load();
    const { menuStage } = window.SeganPartnerProjects;
    expect(
      [
        ['consult'],
        ['render'],
        ['design'],
        ['quote'],
        ['order', 'confirmed'],
        ['order', 'in_production'],
        ['order', 'delivered'],
        ['order', 'completed'],
        ['installed', 'completed'],
        [undefined],
      ].map(([a, b]) => menuStage(a, b))
    ).toEqual(['consult', 'design', 'design', 'quote', 'contract', 'make', 'install', 'install', 'install', 'consult']);
    for (const [a, b] of [['order', 'in_production'], ['render'], ['installed']])
      expect(window.SeganMe.menuStage(a, b)).toBe(menuStage(a, b));
  });

  test('설계 · 제작 · 설치 화면 — 그 단계 줄만, 머리글 「… 단계 프로젝트」, 새 고객 단추는 상담에서만 (PC 안내 글은 없다 — 다음 할 일이 줄마다 있다)', async () => {
    await load({ list: staged });
    await flush();
    await openScreen('p-design');
    expect(box().querySelector('.me-pt-sub').textContent).toBe('설계 단계 프로젝트');
    expect(titles()).toEqual(['싱크대']);
    expect(box().querySelector('[data-act="open"]')).toBeNull();
    expect(box().textContent).not.toContain('PC 화면');
    await openScreen('p-make');
    expect(titles()).toEqual(['신발장']);
    expect(box().textContent).not.toContain('PC 화면');
    await openScreen('p-install');
    expect(titles()).toEqual(['붙박이장']);
    await openScreen('p-quote');
    expect(titles()).toEqual([]);
    expect(box().querySelector('.me-empty').textContent).toBe('이 단계의 프로젝트가 없습니다.');
    await openScreen('p-consult');
    expect(box().querySelector('.me-pt-sub').textContent).toBe('상담 단계 프로젝트');
    expect(box().querySelector('[data-act="open"]')).not.toBeNull();
    // 단계 보기에서는 줄에 단계를 다시 적지 않는다
    await openScreen('p-design');
    expect(rows()[0]).toBe('싱크대 | 김고객 · 2026.10.10 · 설계 0개 | 010-1111-2222 | 담당자 없음');
  });

  // ── 단계 띠 · 다음 할 일 (2026-11-21 대표님 「프로젝트 한 길」 — 서버가 준 step · next 를 그린다) ──
  const P4 = '22222222-2222-4222-8222-222222222224';
  const P5 = '22222222-2222-4222-8222-222222222225';
  const DOC = '33333333-3333-4333-8333-333333333331';
  const ORD = '44444444-4444-4444-8444-444444444441';
  const item = (id, title, extra) => ({
    id,
    title,
    status: 'active',
    created_at: '2026-11-01T00:00:00Z',
    customer: { id: C1, name: '김고객', phone: null },
    design_count: 0,
    stage: 'consult',
    order: null,
    ...extra,
  });
  const next = (key, label, go, extra = {}) => ({ key, label, go, wait: false, since: null, allowed: true, ...extra });
  const flowed = (items) => () => ok(projects({ items }));
  const rowOf = (id) => box().querySelector(`[data-project="${id}"]`);
  const stripOf = (id) =>
    [...rowOf(id).querySelectorAll('.pj-strip li')].map(
      (li) => (li.classList.contains('is-now') ? '●' : li.classList.contains('is-done') ? '✓' : '○') + li.textContent
    );

  test('단계 띠 — 지난 단계 · 지금 단계 · 남은 단계 일곱 칸. 서버가 값을 안 주면(옛 서버) · 끝난 프로젝트는 띠가 없다', async () => {
    await load({
      list: flowed([
        item(P1, '싱크대', { step: 'quote', next: null }),
        item(P3, '신발장'), // step 없음
        item(P4, '화장대', { step: 'make', status: 'closed' }),
      ]),
    });
    await flush();
    await openScreen('partner-projects');
    expect(stripOf(P1)).toEqual(['✓상담', '✓설계', '●견적', '○계약', '○생산', '○설치', '○A/S']);
    expect(rowOf(P1).querySelector('.is-now').getAttribute('aria-current')).toBe('step');
    expect(rowOf(P3).querySelector('.pj-strip')).toBeNull();
    expect(rowOf(P4).querySelector('.pj-strip')).toBeNull();
  });

  test('단계로 거르기 — 서버의 지금 단계(step)가 먼저다: 받은 제작 의뢰는 제작, 완료는 어느 단계 화면에도 없다', async () => {
    await load({
      list: flowed([
        item(P1, '의뢰 받은 주방', { stage: 'consult', step: 'make', next: null }),
        item(P3, '끝난 신발장', { stage: 'order', order: { id: ORD, order_no: 'A-9', status: 'completed' }, step: 'done', next: null }),
      ]),
    });
    await flush();
    await openScreen('p-make');
    expect(titles()).toEqual(['의뢰 받은 주방']);
    await openScreen('p-install');
    expect(titles()).toEqual([]);
    await openScreen('p-consult');
    expect(titles()).toEqual([]);
    await openScreen('partner-projects');
    expect(titles()).toEqual(['의뢰 받은 주방', '끝난 신발장']);
    expect(rows()[1]).toContain('완료');
  });

  test('다음 할 일 — 플래너 링크(프로젝트 · 초안) · 화면 링크 · 기다림 글 · 못 하는 일 글', async () => {
    const now = Date.now();
    const ago = (days) => new Date(now - days * 86400000 - 3600000).toISOString();
    await load({
      list: flowed([
        item(P1, '설계 전', { step: 'consult', next: next('design_start', '설계 시작', `planner?project=${P1}`, { since: ago(2) }) }),
        item(P3, '초안 있음', { step: 'design', next: next('design', '설계 이어서', 'planner?draft=design-abc-1') }),
        item(P4, '답 기다림', {
          step: 'quote',
          next: next('customer', '고객 답 기다림', 'p-quote', { wait: true, allowed: false, since: ago(4), views: 2 }),
        }),
        item(P5, '제작 의뢰', { step: 'contract', next: next('request', '제작 의뢰 보내기', 'p-make', { allowed: false }) }),
        item(P2, '의뢰 보내기', { step: 'contract', next: next('request', '제작 의뢰 보내기', 'p-make') }),
      ]),
    });
    await flush();
    await openScreen('partner-projects');
    const a1 = rowOf(P1).querySelector('a[data-next="design_start"]');
    expect([a1.textContent, a1.getAttribute('href'), a1.hasAttribute('data-desktop-tab')]).toEqual([
      '설계 시작',
      `planner/?project=${P1}`,
      true,
    ]);
    expect(rowOf(P1).querySelector('.pj-since').textContent).toBe('2일째');
    expect(rowOf(P3).querySelector('a[data-next="design"]').getAttribute('href')).toBe('planner/?draft=design-abc-1');
    expect(rowOf(P3).querySelector('.pj-since')).toBeNull();
    // 남을 기다리는 중 — 단추 없이 글로
    expect(rowOf(P4).querySelector('.pj-wait').textContent).toBe('고객 답 기다림 · 4일째 · 2번 열어 봄');
    expect(rowOf(P4).querySelector('[data-next="customer"]').tagName).toBe('P');
    expect(rowOf(P4).querySelector('a.mk-btn--solid, button.mk-btn--solid')).toBeNull();
    // 내 직책으로 못 하는 일 — 무엇이 남았는지만
    expect(rowOf(P5).querySelector('.pj-wait').textContent).toBe('제작 의뢰 보내기 — 대표 · 실장이 합니다');
    expect(rowOf(P5).querySelector('a.mk-btn--solid')).toBeNull();
    // 앱 화면으로 가는 일
    expect(rowOf(P2).querySelector('a[data-next="request"]').getAttribute('href')).toBe('#p-make');
    // 이상한 주소는 링크로 만들지 않는다
    expect(window.SeganPartnerProjects.state.data.items.length).toBe(5);
  });

  test('다음 할 일 — 수주 창 열기 · 계약 만들기 (만든 뒤 목록을 다시 읽고 알린다, 취소된 계약이면 그 글)', async () => {
    const open = jest.fn(async () => true);
    let made = { ok: true, order: { id: ORD, status: 'confirmed' }, reused: false, dead: false };
    const createFromDocument = jest.fn(async () => made);
    const calls = await load({
      list: flowed([
        item(P1, '계약금', { step: 'contract', next: next('deposit', '계약금 입금 적기', `order:${ORD}`) }),
        item(P3, '승인됨', {
          step: 'quote',
          next: next('order', '계약 만들기', 'p-quote', { act: { kind: 'order', document_id: DOC } }),
        }),
      ]),
    });
    await flush();
    window.SeganOrders = { open, createFromDocument };
    const onChange = jest.fn();
    window.SeganPartnerProjects.onChange = onChange;
    await openScreen('partner-projects');
    rowOf(P1).querySelector('[data-act="next-sheet"]').click();
    await flush();
    expect(open).toHaveBeenCalledWith(ORD);
    const before = projectCalls(calls).length;
    const btn = rowOf(P3).querySelector('[data-act="next-order"]');
    expect(btn.textContent).toBe('계약 만들기');
    btn.click();
    await flush();
    expect(createFromDocument).toHaveBeenCalledWith(DOC);
    expect(projectCalls(calls).length).toBe(before + 1); // 목록을 다시 읽었다
    expect(box().querySelector('.me-pt-msg').textContent).toBe('계약을 만들었습니다.');
    expect(onChange).toHaveBeenCalled();
    expect(open).toHaveBeenLastCalledWith(ORD);
    // 그 견적의 계약이 취소돼 있었다 — 알리고 창은 열지 않는다
    open.mockClear();
    made = { ok: true, order: { id: ORD, status: 'cancelled' }, reused: true, dead: true };
    rowOf(P3).querySelector('[data-act="next-order"]').click();
    await flush();
    expect(box().querySelector('.me-pt-msg').textContent).toContain('취소됐습니다');
    expect(open).not.toHaveBeenCalled();
    // 못 만들면 서버 글
    made = { ok: false, error: '고객이 승인한 확인서만 수주로 전환할 수 있습니다' };
    rowOf(P3).querySelector('[data-act="next-order"]').click();
    await flush();
    expect(box().querySelector('.me-pt-msg').textContent).toBe('고객이 승인한 확인서만 수주로 전환할 수 있습니다');
    delete window.SeganOrders;
  });

  test('줄에 「진행 보기」 단추는 없다 — 한 건 창이 있어도 (2026-11-21 대표님)', async () => {
    await load({ list: flowed([item(P1, '설계 전', { step: 'consult', next: next('design_start', '설계 시작', `planner?project=${P1}`) })]) });
    await flush();
    await openScreen('partner-projects');
    window.SeganProjectSheet = { canOpen: () => true, open: jest.fn() };
    await window.SeganPartnerProjects.reload();
    expect(rowOf(P1).querySelector('[data-act="sheet"]')).toBeNull();
    expect(rowOf(P1).textContent).not.toContain('진행 보기');
  });

  test('readProject — GET /company/projects/:id 를 읽어 { ok, status, data } 로 (번호가 이상하면 묻지 않는다)', async () => {
    const calls = await load({
      one: (url) => (url.endsWith(P1) ? ok({ project: { id: P1 }, history: [] }) : fail(404, 'not_found', '프로젝트를 찾을 수 없습니다')),
    });
    await flush();
    const PP = window.SeganPartnerProjects;
    expect(await PP.readProject(P1)).toEqual({ ok: true, status: 200, data: { project: { id: P1 }, history: [] } });
    const last = calls.fetch[calls.fetch.length - 1];
    expect([last.url, last.method, last.auth]).toEqual([WORK + '/company/projects/' + P1, 'GET', 'Bearer tok-1']);
    expect(await PP.readProject(P3)).toEqual({ ok: false, status: 404, data: null });
    const before = calls.fetch.length;
    expect(await PP.readProject('../x')).toEqual({ ok: false, status: 0, data: null });
    expect(await PP.readProject(null)).toEqual({ ok: false, status: 0, data: null });
    expect(calls.fetch.length).toBe(before);
  });

  // ── 보류 · 그만둠 (2026-11-21 대표님 뒤 공정 1차 — 「계약금을 받으면 보류 및 그만둠 기능은 작동하지 않아야함」) ──
  const held = (extra) => ({ hold_ready: true, ...extra });
  const act = (id, sel) => rowOf(id).querySelector(sel);
  const statusBtn = (id) => act(id, '[data-act="status"]:not([data-next])');

  test('「보류 · 그만둠」 단추 — 서버가 쓸 수 있다고 할 때만(hold_ready), 대표 · 실장 · 담당자에게, 계약금을 받은 줄에는 없다', async () => {
    const items = [
      item(P1, '설계 전', { step: 'consult', next: next('design_start', '설계 시작', 'planner?project=' + P1) }),
      item(P3, '계약금 받음', { step: 'make', next: next('deliver', '배송으로 넘기기', 'order:' + ORD), deposit_paid: true }),
      item(P4, '보류한 것', { status: 'on_hold', step: 'quote', next: null, hold_until: '2026-12-05', status_note: '이사 날짜 미정', deposit_paid: true }),
      item(P5, '그만둔 것', { status: 'cancelled', step: 'done', next: null, status_note: '고객 포기' }),
    ];
    // 서버가 아직 못 쓴다고 하면(DB 0078 전 · 옛 서버) 단추가 없다
    await load({ list: () => ok(projects({ items })) });
    await flush();
    await openScreen('partner-projects');
    expect(box().querySelector('[data-act="status"]')).toBeNull();
    // 쓸 수 있다
    await load({ list: () => ok(projects(held({ items }))) });
    await flush();
    await openScreen('partner-projects');
    expect(statusBtn(P1).textContent).toBe('보류 · 그만둠');
    expect(statusBtn(P1).getAttribute('aria-expanded')).toBe('false');
    expect(statusBtn(P3)).toBeNull(); // 계약금을 받았다
    expect(statusBtn(P5).textContent).toBe('되살리기'); // 대표 · 실장
    // 보류한 줄은 아래 묶음에 접혀 있다 — 펼치면 다시 볼 날 · 메모 · 단계 띠 · 「다시 진행 · 그만둠」(계약금을 받았어도)
    expect(rowOf(P4)).toBeNull();
    const fold = box().querySelector('[data-act="held"]');
    expect([fold.textContent, fold.getAttribute('aria-expanded')]).toEqual(['보류 1', 'false']);
    fold.click();
    expect(box().querySelector('[data-act="held"]').getAttribute('aria-expanded')).toBe('true');
    expect(rowOf(P4).querySelector('.pj-hold').textContent).toBe('다시 볼 날 2026.12.05 · 「이사 날짜 미정」');
    expect(rowOf(P4).querySelector('.me-pr-status').textContent).toBe('보류');
    expect(rowOf(P4).querySelector('.pj-strip .is-now').textContent).toBe('견적');
    expect(statusBtn(P4).textContent).toBe('다시 진행 · 그만둠');
    box().querySelector('[data-act="held"]').click();
    expect(rowOf(P4)).toBeNull();
    // 그만둔 줄 — 메모가 보인다
    expect(rowOf(P5).querySelector('.pj-hold').textContent).toBe('「고객 포기」');
    // 직원 — 내가 담당인 줄에만
    const staff = partnerMe();
    staff.body.data.company.role = 'staff';
    const mine = items.map((p) => ({ ...p }));
    mine[0].assignee = { user_id: 'user-1', name: '나', role: 'staff' };
    await load({ partner: staff, list: () => ok(projects(held({ can_manage: false, assignee_ready: true, items: mine }))) });
    await flush();
    await openScreen('partner-projects');
    expect(statusBtn(P1)).not.toBeNull();
    expect(statusBtn(P5)).toBeNull(); // 되살리기는 대표 · 실장만
  });

  test('보류하기 — 단추로 펼치면 서버가 준 할 수 있는 일대로, 다시 볼 날 · 메모를 적어 보내고 목록을 다시 읽는다 (같은 단추로 접는다)', async () => {
    let items = [item(P1, '설계 전', { step: 'consult', next: next('design_start', '설계 시작', 'planner?project=' + P1) })];
    const sent = [];
    const calls = await load({
      list: () => ok(projects(held({ items }))),
      one: () => ok({ project: items[0], actions: { hold: true, cancel: true, resume: false, blocked: null } }),
      status: (body) => {
        sent.push(body);
        items = [{ ...items[0], status: 'on_hold', next: null, hold_until: body.hold_until, status_note: body.note }];
        return ok({ project_id: P1, status: 'on_hold', hold_until: body.hold_until, status_note: body.note, status_at: 'x' });
      },
    });
    await flush();
    const onChange = jest.fn();
    window.SeganPartnerProjects.onChange = onChange;
    await openScreen('partner-projects');
    statusBtn(P1).click();
    // 읽는 동안
    expect(rowOf(P1).querySelector('.pj-status').textContent).toBe('불러오는 중…');
    expect(statusBtn(P1).getAttribute('aria-expanded')).toBe('true');
    await flush();
    const panel = () => rowOf(P1).querySelector('.pj-status');
    expect([...panel().querySelectorAll('[data-act="status-form"]')].map((b) => [b.textContent, b.getAttribute('data-kind')])).toEqual([
      ['보류', 'hold'],
      ['그만둠', 'cancel'],
    ]);
    expect(panel().querySelector('form')).toBeNull();
    // 「닫기」 단추는 두지 않는다 — 같은 단추로 접는다
    expect(panel().textContent).not.toContain('닫기');
    panel().querySelector('[data-kind="hold"]').click();
    const form = panel().querySelector('form[data-form="status"]');
    expect(form.getAttribute('data-kind')).toBe('hold');
    expect(form.querySelector('[name="hold_until"]').getAttribute('type')).toBe('date');
    form.querySelector('[name="hold_until"]').value = '2026-12-05';
    form.querySelector('[name="note"]').value = '  이사 날짜 미정 ';
    const before = projectCalls(calls).length;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(sent).toEqual([{ expect_status: 'active', status: 'on_hold', hold_until: '2026-12-05', note: '이사 날짜 미정' }]);
    const patch = calls.fetch.find((c) => c.method === 'PATCH');
    expect([patch.url, patch.auth]).toEqual([WORK + '/company/projects/' + P1 + '/status', 'Bearer tok-1']);
    expect(projectCalls(calls).length).toBe(before + 1); // 목록을 다시 읽었다
    expect(box().querySelector('.me-pt-msg').textContent).toBe('보류했습니다.');
    expect(onChange).toHaveBeenCalled();
    // 보류한 줄은 묶음으로 갔고, 묶음이 펼쳐져 있다
    expect(box().querySelector('[data-act="held"]').getAttribute('aria-expanded')).toBe('true');
    expect(rowOf(P1).querySelector('.me-pr-status').textContent).toBe('보류');
    expect(rowOf(P1).querySelector('.pj-status')).toBeNull();
  });

  test('계약금을 받은 프로젝트 — 서버가 못 한다고 하면 단추 없이 까닭만. 서버가 거절하면 그 글을 그 자리에, 적던 값은 남는다', async () => {
    const items = [item(P1, '접수', { step: 'contract', next: next('deposit', '계약금 입금 적기', 'order:' + ORD) })];
    let actions = { hold: false, cancel: false, resume: false, blocked: 'deposit' };
    const calls = await load({
      list: () => ok(projects(held({ items }))),
      one: () => ok({ project: items[0], actions }),
      status: () => fail(409, 'deposit_paid', '계약금을 받은 프로젝트는 보류하거나 그만둘 수 없습니다'),
    });
    await flush();
    await openScreen('partner-projects');
    statusBtn(P1).click();
    await flush();
    const panel = () => rowOf(P1).querySelector('.pj-status');
    expect(panel().querySelector('[data-act="status-form"]')).toBeNull();
    expect(panel().querySelector('[data-pj="blocked"]').textContent).toBe('계약금을 받은 프로젝트는 보류 · 그만둠을 할 수 없습니다.');
    // 접는다
    statusBtn(P1).click();
    expect(rowOf(P1).querySelector('.pj-status')).toBeNull();
    // 살아 있는 계약(계약금 전) — 보류는 되고 그만둠은 까닭만
    actions = { hold: true, cancel: false, resume: false, blocked: 'order' };
    statusBtn(P1).click();
    await flush();
    expect([...panel().querySelectorAll('[data-act="status-form"]')].map((b) => b.textContent)).toEqual(['보류']);
    expect(panel().querySelector('[data-pj="blocked"]').textContent).toBe('그만두려면 계약(수주)을 먼저 취소해 주세요.');
    // 그 사이 계약금이 들어와 서버가 거절했다
    panel().querySelector('[data-kind="hold"]').click();
    panel().querySelector('[name="note"]').value = '적던 메모';
    panel().querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(panel().querySelector('.mk-error').textContent).toBe('계약금을 받은 프로젝트는 보류하거나 그만둘 수 없습니다');
    expect(panel().querySelector('[name="note"]').value).toBe('적던 메모');
    expect(calls.fetch.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    // 못 읽으면 알린다
    statusBtn(P1).click();
    await load({ list: () => ok(projects(held({ items }))), one: () => fail(500, 'x', 'x') });
    await flush();
    await openScreen('partner-projects');
    statusBtn(P1).click();
    await flush();
    expect(panel().querySelector('.mk-error').textContent).toBe('불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
  });

  test('보류를 다시 볼 날 — 줄에 「보류 — 다시 볼 날입니다」 단추(그 줄의 칸을 연다), 다시 진행은 바로 보낸다. 줄에 창 단추는 없다', async () => {
    let items = [
      item(P4, '보류한 것', {
        status: 'on_hold',
        step: 'quote',
        hold_until: '2026-11-01',
        next: next('hold_due', '보류 — 다시 볼 날입니다', 'sheet', { since: '2026-11-01' }),
      }),
    ];
    const sent = [];
    await load({
      list: () => ok(projects(held({ items }))),
      one: () => ok({ project: items[0], actions: { hold: false, cancel: true, resume: true, blocked: null } }),
      status: (body) => {
        sent.push(body);
        items = [{ ...items[0], status: 'active', hold_until: null, next: next('customer', '고객 답 기다림', 'p-quote', { wait: true }) }];
        return ok({ project_id: P4, status: 'active', hold_until: null, status_note: null, status_at: 'x' });
      },
    });
    await flush();
    await openScreen('partner-projects');
    // 다른 칸(새로 생긴 일 표)에서 연다 — 묶음을 펼치고 그 줄의 칸을 연다
    expect(await window.SeganPartnerProjects.openStatus(P4)).toBe(true);
    await flush();
    const due = act(P4, '[data-act="status"][data-next="hold_due"]');
    expect(due.textContent).toBe('보류 — 다시 볼 날입니다');
    expect(rowOf(P4).querySelector('[data-act="sheet"]')).toBeNull();
    const panel = rowOf(P4).querySelector('.pj-status');
    expect([...panel.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['다시 진행', '그만둠']);
    panel.querySelector('[data-act="status-resume"]').click();
    await flush();
    expect(sent).toEqual([{ expect_status: 'on_hold', status: 'active' }]);
    expect(box().querySelector('.me-pt-msg').textContent).toBe('다시 진행합니다.');
    expect(box().querySelector('[data-act="held"]')).toBeNull(); // 보류가 없다
    expect(rowOf(P4).querySelector('.me-pr-status')).toBeNull();
  });

  // ── 실측 (2026-11-21 대표님 뒤 공정 2차 — 서버 visit_ready · PUT/PATCH /company/projects/:id/visit, DB 0079) ──
  const MEMBERS = [
    { user_id: M1, name: '박실장', role: 'manager' },
    { user_id: M2, name: '최직원', role: 'staff' },
  ];
  const visitOf = (extra) => ({
    id: 'v1',
    status: 'scheduled',
    scheduled_at: '2026-11-25T05:00:00.000Z', // 한국 11.25 (수) 14:00
    assignee_id: null,
    assignee_name: null,
    note: null,
    done_at: null,
    ...extra,
  });
  const visitBtn = (id) => rowOf(id).querySelector('[data-act="visit"]');
  const visitForm = (id) => rowOf(id).querySelector('form[data-form="visit"]');

  test('실측 단계 — 서버가 쓸 수 있다고 할 때만(visit_ready) 띠가 여덟 칸. 실측 일정 잡기 → 실측 예정(날짜) → 실측 완료 처리 → 설계 시작', async () => {
    // 옛 서버 · DB 0079 전 — 일곱 칸, 실측 단추 없음
    await load({
      list: flowed([item(P1, '설계 전', { step: 'consult', next: next('design_start', '설계 시작', 'planner?project=' + P1) })]),
    });
    await flush();
    await openScreen('partner-projects');
    expect(stripOf(P1)).toEqual(['●상담', '○설계', '○견적', '○계약', '○생산', '○설치', '○A/S']);
    expect(visitBtn(P1)).toBeNull();

    const items = [
      item(P1, '실측 전', { step: 'consult', next: next('measure_plan', '실측 일정 잡기', 'visit'), visit: null }),
      item(P3, '실측 예정', {
        step: 'measure',
        next: next('measure_wait', '실측 예정', 'visit', { wait: true, allowed: false, at: '2026-11-25T05:00:00.000Z' }),
        visit: visitOf({ assignee_id: M1, assignee_name: '박실장', note: '현관 1층' }),
      }),
      item(P4, '실측 날', {
        step: 'measure',
        next: next('measure_done', '실측 완료 처리', 'visit', { act: { kind: 'visit_done' }, at: '2026-11-20T01:00:00.000Z' }),
        visit: visitOf({ id: 'v2', scheduled_at: '2026-11-20T01:00:00.000Z', assignee_name: '외부 기사' }),
      }),
      item(P5, '실측 끝', {
        step: 'measure',
        next: next('design_start', '설계 시작', 'planner?project=' + P5),
        visit: visitOf({ id: 'v3', status: 'done', scheduled_at: '2026-11-18T01:00:00.000Z', done_at: '2026-11-19T02:00:00.000Z' }),
      }),
    ];
    await load({ list: () => ok(projects({ visit_ready: true, members: MEMBERS, items })) });
    await flush();
    await openScreen('partner-projects');
    expect(stripOf(P1)).toEqual(['●상담', '○실측', '○설계', '○견적', '○계약', '○생산', '○설치', '○A/S']);
    expect(stripOf(P3).slice(0, 3)).toEqual(['✓상담', '●실측', '○설계']);
    // 실측 전 — 다음 할 일 단추가 곧 실측 칸을 여는 단추다 (「실측 일정」 단추를 따로 두지 않는다)
    expect(
      [...rowOf(P1).querySelectorAll('[data-act="visit"]')].map((b) => [b.textContent, b.getAttribute('data-next'), b.getAttribute('aria-expanded')])
    ).toEqual([['실측 일정 잡기', 'measure_plan', 'false']]);
    expect(rowOf(P1).querySelector('[data-pj="visit"]')).toBeNull();
    // 실측 예정 — 기다림 글에 날짜(한국 시각), 줄에 실측 한 줄, 「실측 일정」 단추
    expect(rowOf(P3).querySelector('.pj-wait').textContent).toBe('실측 11.25 (수) 14:00 예정');
    expect(rowOf(P3).querySelector('[data-pj="visit"]').textContent).toBe('실측 11.25 (수) 14:00 · 박실장 · 「현관 1층」');
    expect(visitBtn(P3).textContent).toBe('실측 일정');
    // 실측 날 — 「실측 완료 처리」는 그 자리에서 누른다
    const fin = rowOf(P4).querySelector('[data-act="next-visit-done"]');
    expect([fin.textContent, fin.getAttribute('data-for')]).toEqual(['실측 완료 처리', P4]);
    expect(rowOf(P4).querySelector('[data-pj="visit"]').textContent).toBe('실측 11.20 (금) 10:00 · 외부 기사');
    // 실측 끝 — 그제야 설계 시작, 줄에는 끝낸 날
    expect(rowOf(P5).querySelector('a[data-next="design_start"]').textContent).toBe('설계 시작');
    expect(rowOf(P5).querySelector('[data-pj="visit"]').textContent).toBe('실측 끝 11.19');
    // 실측 화면(#p-measure) — 실측 단계 줄만
    await openScreen('p-measure');
    expect(titles()).toEqual(['실측 예정', '실측 날', '실측 끝']);
    expect($('partnerProjectsTitle').textContent).toBe('실측 단계 프로젝트');
  });

  test('실측 일정 잡기 — 단추로 펼친 칸에 날짜 · 시각 · 갈 사람 · 메모, 한국 시각으로 보내고 목록을 다시 읽는다. 잡힌 뒤에는 고치기 · 완료 처리 · 취소 (같은 단추로 접는다)', async () => {
    let items = [
      item(P1, '실측 전', {
        step: 'consult',
        next: next('measure_plan', '실측 일정 잡기', 'visit'),
        visit: null,
        assignee: { user_id: M1, name: '박실장', role: 'manager' },
      }),
    ];
    const sent = [];
    const calls = await load({
      list: () => ok(projects({ visit_ready: true, assignee_ready: true, members: MEMBERS, items })),
      visit: (body, url, method) => {
        sent.push([method, body]);
        if (method === 'PUT')
          items = [
            {
              ...items[0],
              step: 'measure',
              next: next('measure_wait', '실측 예정', 'visit', { wait: true, allowed: false, at: '2026-11-25T05:00:00.000Z' }),
              visit: visitOf({ assignee_id: body.assignee_id, assignee_name: '최직원', note: body.note }),
            },
          ];
        else
          items = [
            {
              ...items[0],
              next: next('design_start', '설계 시작', 'planner?project=' + P1),
              visit: { ...items[0].visit, status: 'done', done_at: '2026-11-25T06:00:00.000Z' },
            },
          ];
        return ok({ project_id: P1, visit: items[0].visit });
      },
    });
    await flush();
    const onChange = jest.fn();
    window.SeganPartnerProjects.onChange = onChange;
    await openScreen('partner-projects');
    visitBtn(P1).click();
    expect(visitBtn(P1).getAttribute('aria-expanded')).toBe('true');
    expect([...visitForm(P1).querySelectorAll('input, select')].map((el) => [el.name, el.type])).toEqual([
      ['day', 'date'],
      ['time', 'time'],
      ['assignee_id', 'select-one'],
      ['assignee_name', 'text'],
      ['note', 'text'],
    ]);
    // 갈 사람 — 그 프로젝트의 담당자가 골라져 있다. 「닫기」 단추는 없고, 완료 처리 · 취소는 잡힌 실측이 있을 때만
    expect(visitForm(P1).querySelector('select').value).toBe(M1);
    expect([...visitForm(P1).querySelectorAll('option')].map((o) => o.textContent)).toEqual(['정하지 않음', '박실장 (실장)', '최직원 (직원)']);
    expect(rowOf(P1).querySelector('.pj-visit').textContent).not.toContain('닫기');
    expect(visitForm(P1).querySelector('[data-act="visit-done"]')).toBeNull();
    expect(visitForm(P1).querySelector('[type="submit"]').textContent).toBe('실측 일정 잡기');
    // 날짜 없이 내면 그 자리에 알리고 보내지 않는다 — 적던 값은 남는다
    visitForm(P1).querySelector('[name="note"]').value = ' 현관 1층 ';
    visitForm(P1).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(rowOf(P1).querySelector('.pj-visit .mk-error').textContent).toBe('실측 날짜와 시각을 적어 주세요.');
    expect(sent).toEqual([]);
    expect(visitForm(P1).querySelector('[name="note"]').value).toBe('현관 1층');
    // 구성원을 고르면 이름 글은 보내지 않는다
    visitForm(P1).querySelector('[name="day"]').value = '2026-11-25';
    visitForm(P1).querySelector('[name="time"]').value = '14:00';
    visitForm(P1).querySelector('select').value = M2;
    visitForm(P1).querySelector('[name="assignee_name"]').value = '쓰지 않는 글';
    const before = projectCalls(calls).length;
    visitForm(P1).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(sent).toEqual([['PUT', { scheduled_at: '2026-11-25T14:00:00+09:00', assignee_id: M2, assignee_name: null, note: '현관 1층' }]]);
    const put = calls.fetch.find((c) => c.method === 'PUT' && c.url.endsWith('/visit'));
    expect([put.url, put.auth]).toEqual([WORK + '/company/projects/' + P1 + '/visit', 'Bearer tok-1']);
    expect(projectCalls(calls).length).toBe(before + 1); // 목록을 다시 읽었다
    expect(box().querySelector('.me-pt-msg').textContent).toBe('실측 일정을 잡았습니다.');
    expect(onChange).toHaveBeenCalled();
    expect(rowOf(P1).querySelector('.pj-visit')).toBeNull(); // 칸은 접혔다
    expect(rowOf(P1).querySelector('.pj-wait').textContent).toBe('실측 11.25 (수) 14:00 예정');

    // 잡힌 뒤 — 「실측 일정」 단추로 다시 펼치면 그 값으로 열리고 완료 처리 · 취소 단추가 있다
    expect(visitBtn(P1).textContent).toBe('실측 일정');
    visitBtn(P1).click();
    expect([
      visitForm(P1).querySelector('[name="day"]').value,
      visitForm(P1).querySelector('[name="time"]').value,
      visitForm(P1).querySelector('select').value,
      visitForm(P1).querySelector('[name="note"]').value,
      visitForm(P1).querySelector('[type="submit"]').textContent,
    ]).toEqual(['2026-11-25', '14:00', M2, '현관 1층', '일정 고치기']);
    expect([...visitForm(P1).querySelectorAll('button[data-act]')].map((b) => b.textContent)).toEqual(['실측 완료 처리', '실측 취소']);
    visitBtn(P1).click(); // 같은 단추로 접는다
    expect(rowOf(P1).querySelector('.pj-visit')).toBeNull();
    visitBtn(P1).click();
    visitForm(P1).querySelector('[data-act="visit-done"]').click();
    await flush();
    expect(sent[1]).toEqual(['PATCH', { status: 'done' }]);
    expect(box().querySelector('.me-pt-msg').textContent).toBe('실측을 끝냈습니다. 이제 설계를 시작할 수 있습니다.');
    expect(rowOf(P1).querySelector('a[data-next="design_start"]').textContent).toBe('설계 시작');
  });

  test('실측 — 줄의 「실측 완료 처리」는 바로 보낸다 · 서버가 거절하면 그 글을 알린다 · 대표 · 실장 · 담당자가 아니면 단추 없이 글만', async () => {
    const items = [
      item(P1, '실측 날', {
        step: 'measure',
        next: next('measure_done', '실측 완료 처리', 'visit', { act: { kind: 'visit_done' }, at: '2026-11-20T01:00:00.000Z' }),
        visit: visitOf({ scheduled_at: '2026-11-20T01:00:00.000Z' }),
      }),
      item(P3, '실측 전', { step: 'consult', next: next('measure_plan', '실측 일정 잡기', 'visit'), visit: null }),
    ];
    const sent = [];
    await load({
      list: () => ok(projects({ visit_ready: true, members: MEMBERS, items })),
      visit: (body, url, method) => {
        sent.push([method, url.slice(WORK.length), body]);
        return fail(409, 'stale', '그 사이 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요');
      },
    });
    await flush();
    await openScreen('partner-projects');
    rowOf(P1).querySelector('[data-act="next-visit-done"]').click();
    await flush();
    expect(sent).toEqual([['PATCH', '/company/projects/' + P1 + '/visit', { status: 'done' }]]);
    expect(box().querySelector('.me-pt-msg').textContent).toBe('그 사이 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요');
    // 펼친 칸에서 거절되면 그 칸에 — 적던 값은 남는다
    visitBtn(P3).click();
    visitForm(P3).querySelector('[name="day"]').value = '2026-12-01';
    visitForm(P3).querySelector('[name="time"]').value = '09:30';
    visitForm(P3).querySelector('[name="assignee_name"]').value = '외부 기사';
    visitForm(P3).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(sent[1]).toEqual([
      'PUT',
      '/company/projects/' + P3 + '/visit',
      { scheduled_at: '2026-12-01T09:30:00+09:00', assignee_id: null, assignee_name: '외부 기사', note: null },
    ]);
    expect(rowOf(P3).querySelector('.pj-visit .mk-error').textContent).toBe('그 사이 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요');
    expect(visitForm(P3).querySelector('[name="assignee_name"]').value).toBe('외부 기사');

    // 직원 — 내가 담당자인 줄에만 실측 칸이 있다. 서버가 못 한다고 한 줄(allowed false)은 글만
    const staffItems = [
      item(P1, '남의 것', { step: 'consult', next: next('measure_plan', '실측 일정 잡기', 'visit', { allowed: false }), visit: null }),
      item(P3, '내 담당 · 잡힘', {
        step: 'measure',
        next: next('measure_wait', '실측 예정', 'visit', { wait: true, allowed: false, at: '2026-11-25T05:00:00.000Z' }),
        visit: visitOf(),
        assignee: { user_id: 'user-1', name: '나', role: 'staff' },
      }),
      item(P4, '남의 것 · 잡힘', {
        step: 'measure',
        next: next('measure_wait', '실측 예정', 'visit', { wait: true, allowed: false, at: '2026-11-25T05:00:00.000Z' }),
        visit: visitOf({ id: 'v2' }),
      }),
    ];
    await load({
      partner: partnerMe({ role: 'staff' }),
      list: () => ok(projects({ can_manage: false, visit_ready: true, assignee_ready: true, members: MEMBERS, items: staffItems })),
    });
    await flush();
    await openScreen('partner-projects');
    expect(rowOf(P1).querySelector('.pj-wait').textContent).toBe('실측 일정 잡기 — 대표 · 실장 · 담당자가 합니다');
    expect(visitBtn(P1)).toBeNull();
    expect(visitBtn(P3).textContent).toBe('실측 일정');
    expect(visitBtn(P4)).toBeNull();
    const PP = window.SeganPartnerProjects;
    expect([PP.canVisit(staffItems[0]), PP.canVisit(staffItems[1]), PP.canVisit(staffItems[2])]).toEqual([false, true, false]);
    // 한국 시각 — 날짜 경계
    expect(PP.kstParts('2026-11-21T15:30:00Z')).toEqual({ day: '2026-11-22', time: '00:30', text: '11.22 (일) 00:30' });
    expect([PP.kstParts('x'), PP.kstParts(null)]).toEqual([null, null]);
  });

  test('작업 분배 — 진행 중 프로젝트 모두 (끝난 것 빼고), 머리글 「작업 분배」, 새 고객 단추 없음 · 옛 주소 #partner-projects 는 모두', async () => {
    await load({ list: staged });
    await flush();
    await openScreen('assign');
    expect(box().querySelector('.me-pt-sub').textContent).toBe('작업 분배');
    expect(titles()).toEqual(['싱크대', '신발장']);
    expect(box().querySelector('[data-act="open"]')).toBeNull();
    expect(window.SeganPartnerProjects.canAssign()).toBe(true);
    await openScreen('partner-projects');
    expect(box().querySelector('.me-pt-sub').textContent).toBe('프로젝트');
    expect(titles()).toEqual(['붙박이장', '싱크대', '신발장']);
  });

  // ── 고객 초대 (2026-11-23 대표님 뒤 공정 3차 — 서버 invite_ready · POST /company/projects/:id/customer-invite, DB 0082) ──
  test('고객 초대 — 서버가 쓸 수 있다고 할 때만(invite_ready), 앱과 이어지지 않은 고객의 진행 중 줄에. 이어졌으면 「고객 앱 연결」', async () => {
    const items = [
      item(P1, '안 이어짐', { customer: { id: C1, name: '김고객', phone: null, app: false } }),
      item(P3, '이어짐', { customer: { id: C2, name: '이고객', phone: null, app: true } }),
    ];
    // 옛 서버 · DB 0082 전 — 단추도 꼬리표도 없다
    await load({ list: () => ok(projects({ items })) });
    await flush();
    await openScreen('partner-projects');
    expect(box().querySelector('[data-act="invite"]')).toBeNull();
    expect(box().querySelector('[data-pj="app"]')).toBeNull();
    document.body.innerHTML = '';
    await load({ list: () => ok(projects({ invite_ready: true, items })) });
    await flush();
    await openScreen('partner-projects');
    const btn = rowOf(P1).querySelector('[data-act="invite"]');
    expect([btn.textContent, btn.getAttribute('aria-expanded')]).toEqual(['고객 초대', 'false']);
    expect(rowOf(P3).querySelector('[data-act="invite"]')).toBeNull();
    expect(rowOf(P3).querySelector('[data-pj="app"]').textContent).toBe('고객 앱 연결');
  });

  test('고객 초대 — 같은 단추로 펼치고 접는다, 링크 만들기 → 그 칸에만 링크 · 복사 · 다시 만들기, 접으면 링크도 지운다', async () => {
    const sent = [];
    const items = [item(P1, '싱크대', { customer: { id: C1, name: '김고객', phone: null, app: false } })];
    const URL1 = 'https://dadamfurniture.com/segan/me.html#customer-invite=' + 'a'.repeat(32);
    const calls = await load({
      list: () => ok(projects({ invite_ready: true, items })),
      one: (url) => {
        sent.push(url);
        return ok({ id: 'i1', url: URL1, expires_at: '2026-12-07T00:00:00Z' }, 201);
      },
    });
    await flush();
    await openScreen('partner-projects');
    const btn = () => rowOf(P1).querySelector('[data-act="invite"]');
    btn().click();
    await flush();
    const panel = () => rowOf(P1).querySelector('[data-pj="invite"]');
    expect(panel().textContent).toContain('14일');
    expect(btn().getAttribute('aria-expanded')).toBe('true');
    expect(panel().querySelector('[data-pj="invite-url"]')).toBeNull();
    panel().querySelector('[data-act="invite-make"]').click();
    await flush();
    expect(sent).toEqual([WORK + '/company/projects/' + P1 + '/customer-invite']);
    expect(calls.fetch.filter((f) => f.url.endsWith('/customer-invite')).map((f) => f.method)).toEqual(['POST']);
    expect(panel().querySelector('[data-pj="invite-url"]').value).toBe(URL1);
    expect(panel().querySelector('[data-act="invite-make"]').textContent).toBe('새 링크 만들기');
    // 복사 — 클립보드에 링크
    const writeText = jest.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    panel().querySelector('[data-act="invite-copy"]').click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(URL1);
    expect(panel().querySelector('[data-pj="invite-msg"]').textContent).toBe('링크를 복사했습니다. 문자 · 메신저로 고객에게 보내 주세요.');
    // 링크는 저장소 어디에도 남기지 않는다
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('customer-invite=');
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('customer-invite=');
    // 같은 단추로 접으면 링크도 화면에서 지운다
    btn().click();
    await flush();
    expect(panel()).toBeNull();
    btn().click();
    await flush();
    expect(panel().querySelector('[data-pj="invite-url"]')).toBeNull();
  });

  test('고객 초대 — 서버가 막으면 그 글을 칸에, 이미 이어진 고객이면 목록을 다시 읽어 단추를 뺀다', async () => {
    let linked = false;
    const items = () => [item(P1, '싱크대', { customer: { id: C1, name: '김고객', phone: null, app: linked } })];
    await load({
      list: () => ok(projects({ invite_ready: true, items: items() })),
      one: () => {
        linked = true;
        return fail(409, 'already_linked', '이 고객은 이미 앱 계정과 이어져 있습니다');
      },
    });
    await flush();
    await openScreen('partner-projects');
    rowOf(P1).querySelector('[data-act="invite"]').click();
    await flush();
    rowOf(P1).querySelector('[data-act="invite-make"]').click();
    await flush();
    expect(rowOf(P1).querySelector('[data-act="invite"]')).toBeNull();
    expect(rowOf(P1).querySelector('[data-pj="app"]').textContent).toBe('고객 앱 연결');
  });
});

describe('목록', () => {
  test('최신 순 그대로, 이름 · 상태(진행 중은 안 적음) · 고객 · 만든 날(한국 시간) · 설계 수 · 전화 링크', async () => {
    const calls = await load();
    await flush();
    expect(projectCalls(calls)[0].auth).toBe('Bearer tok-1');
    expect(box().hidden).toBe(false);
    expect(box().querySelector('.me-pt-sub').textContent).toBe('프로젝트');
    // 모두 보기(옛 주소 #partner-projects · 처음)면 줄마다 단계 — 단계를 안 주는 옛 서버면 상담
    expect(rows()).toEqual([
      '붙박이장 | 상담 · 김고객 · 2026.10.21 · 설계 2개 | 010-1111-2222 | 끝남',
      '싱크대 | 상담 · 김고객 · 2026.10.10 · 설계 0개 | 010-1111-2222',
    ]);
    expect(box().querySelector('a[href="tel:01011112222"]')).not.toBeNull();
  });

  test('비면 안내, 직원(can_manage 거짓)은 만들기 단추가 없다', async () => {
    await load({ list: () => ok(projects({ items: [], can_manage: false })) });
    await flush();
    expect(box().querySelector('.me-empty').textContent).toBe('아직 프로젝트가 없습니다.');
    expect(box().querySelector('[data-act="open"]')).toBeNull();
  });
});

describe('새 고객 · 프로젝트', () => {
  test('새 고객 — 이름 · 전화 · 프로젝트 이름을 보내고, 목록을 다시 읽어 알린다', async () => {
    let created = null;
    const calls = await load({
      create: (body) => {
        created = body;
        return ok({ project_id: P1, customer_id: C2 }, 201);
      },
    });
    await flush();
    box().querySelector('[data-act="open"]').click();
    setValue('input[name="title"]', '  거실장 ');
    setValue('input[name="name"]', ' 박고객 ');
    setValue('input[name="phone"]', '010-3333-4444');
    await submit();
    expect(created).toEqual({
      title: '거실장',
      customer: { name: '박고객', phone: '010-3333-4444' },
    });
    expect(projectCalls(calls).map((c) => c.method)).toEqual(['GET', 'POST', 'GET']);
    expect(box().querySelector('form[data-form="project"]')).toBeNull();
    expect(box().querySelector('.me-pt-msg').textContent).toBe('프로젝트를 만들었습니다.');
  });

  test('만들면 목록이 바뀌었다고 알린다(onChange — 마이페이지가 왼쪽 줄의 수를 다시 센다), 그리기만으로는 알리지 않는다', async () => {
    await load();
    await flush();
    const onChange = jest.fn();
    window.SeganPartnerProjects.onChange = onChange;
    window.SeganPartnerProjects.setView({ stage: 'consult' });
    expect(onChange).not.toHaveBeenCalled();
    window.SeganPartnerProjects.setView({ stage: '' });
    box().querySelector('[data-act="open"]').click();
    setValue('input[name="title"]', '거실장');
    setValue('input[name="name"]', '박고객');
    setValue('input[name="phone"]', '010-3333-4444');
    await submit();
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('reload — 칸을 감추지 않고 다시 읽는다 (상담 받기 뒤), 못 읽으면 지금 것을 둔다 · focusProject — 그 줄로 옮긴다', async () => {
    let n = 0;
    const calls = await load({
      list: () => {
        n += 1;
        if (n === 3) return fail(500, 'x', 'x');
        return ok(projects(n === 2 ? { items: projects().items.slice(1, 2) } : {}));
      },
    });
    await flush();
    const PP = window.SeganPartnerProjects;
    const onChange = jest.fn();
    PP.onChange = onChange;
    const before = rows().length;
    const hidden = [];
    const mo = new MutationObserver((list) => list.forEach(() => hidden.push(box().hidden)));
    mo.observe(box(), { attributes: true, attributeFilter: ['hidden'] });
    expect(await PP.reload()).toBe(true);
    await flush();
    mo.disconnect();
    expect(hidden.filter(Boolean)).toEqual([]); // 한 번도 감추지 않았다 (메뉴 줄이 깜박이지 않게)
    expect(rows()).toHaveLength(1);
    expect(rows().length).toBeLessThan(before);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(projectCalls(calls).map((c) => c.method)).toEqual(['GET', 'GET']);
    // 그 줄로 옮긴다 — 지금 화면이 아니면(메뉴만 보이는 폰) false, 프로젝트 목록 화면이면 true, 없는 줄이면 false
    expect(PP.focusProject(P1)).toBe(false);
    window.location.hash = '#partner-projects';
    await flush();
    expect(PP.focusProject(P1)).toBe(true);
    expect(document.activeElement).toBe(box().querySelector(`[data-project="${P1}"]`));
    expect(PP.focusProject('aaaaaaaa-0000-4000-8000-000000000000')).toBe(false);
    // 못 읽으면 지금 목록 그대로
    expect(await PP.reload()).toBe(false);
    expect(rows()).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('있는 고객 — 목록에 나온 고객을 한 번씩 고르게 하고 customer_id 로 보낸다', async () => {
    let created = null;
    await load({
      create: (body) => {
        created = body;
        return ok({ project_id: P1, customer_id: C1 }, 201);
      },
    });
    await flush();
    box().querySelector('[data-act="open"]').click();
    setValue('input[name="title"]', '두 번째');
    pick('existing');
    expect(box().querySelector('input[name="title"]').value).toBe('두 번째');
    const options = [...box().querySelectorAll('select[name="customer_id"] option')].map(
      (o) => o.value
    );
    expect(options).toEqual(['', C1]);
    await submit();
    expect(created).toBeNull();
    expect(box().querySelector('[data-err]').textContent).toBe('고객을 골라 주세요.');
    setValue('select[name="customer_id"]', C1);
    await submit();
    expect(created).toEqual({ title: '두 번째', customer_id: C1 });
  });

  test('보내기 전 검사 — 이름 · 프로젝트 이름 · 전화, 못 보내면 적은 값이 남는다', async () => {
    const calls = await load();
    await flush();
    box().querySelector('[data-act="open"]').click();
    await submit();
    expect(box().querySelector('[data-err]').textContent).toBe('프로젝트 이름을 적어 주세요.');
    setValue('input[name="title"]', '거실장');
    await submit();
    expect(box().querySelector('[data-err]').textContent).toBe('고객 이름을 적어 주세요.');
    expect(box().querySelector('input[name="title"]').value).toBe('거실장');
    setValue('input[name="name"]', '박고객');
    setValue('input[name="phone"]', '전화번호');
    await submit();
    expect(box().querySelector('[data-err]').textContent).toBe(
      '전화는 숫자와 - 로 8~20자로 적어 주세요.'
    );
    expect(projectCalls(calls).filter((c) => c.method === 'POST')).toHaveLength(0);
    const { bodyOf } = window.SeganPartnerProjects;
    expect(bodyOf({ title: 'x'.repeat(101), mode: 'new', name: '고객' }).error).toBe(
      '프로젝트 이름은 100자까지 적을 수 있습니다.'
    );
    expect(bodyOf({ title: 'x', mode: 'new', name: '가'.repeat(51) }).error).toBe(
      '고객 이름은 50자까지 적을 수 있습니다.'
    );
    expect(bodyOf({ title: 'x', mode: 'new', name: '고객', phone: '' }).body).toEqual({
      title: 'x',
      customer: { name: '고객', phone: null },
    });
  });

  test('서버가 못 만들면 서버 글을 그 자리에 · 칸은 열어 둔다', async () => {
    await load({ create: () => fail(403, 'not_manager', '팩토리 대표 · 실장만 할 수 있습니다') });
    await flush();
    box().querySelector('[data-act="open"]').click();
    setValue('input[name="title"]', '거실장');
    setValue('input[name="name"]', '박고객');
    await submit();
    expect(box().querySelector('[data-err]').textContent).toBe('팩토리 대표 · 실장만 할 수 있습니다');
    expect(box().querySelector('input[name="name"]').value).toBe('박고객');
    box().querySelector('[data-act="close"]').click();
    expect(box().querySelector('form[data-form="project"]')).toBeNull();
  });
});

describe('담당자 (DB 0042 · 2026-11-06 작업 분배)', () => {
  const members = [
    { user_id: M1, name: '나직원', role: 'staff' },
    { user_id: M2, name: '다실장', role: 'manager' },
  ];
  const withAssignee = (extra = {}) => {
    const d = projects({ assignee_ready: true, members, ...extra });
    d.items[1].assignee = { user_id: M1, name: '나직원', role: 'staff' };
    d.items[0].assignee = null;
    return d;
  };
  const owners = () => [...box().querySelectorAll('[data-assignee]')].map((el) => el.textContent);

  test('이름표 · 보낼 본문 (순수)', async () => {
    await load();
    const P = window.SeganPartnerProjects;
    expect(P.personLabel({ name: '나직원', role: 'staff' })).toBe('나직원 (직원)');
    expect(P.personLabel({ name: '', role: 'manager' })).toBe('실장');
    expect(P.personLabel({ name: null, role: null })).toBe('나간 구성원');
    expect(P.assignBodyOf('', members)).toEqual({ body: { assignee_id: null } });
    expect(P.assignBodyOf(M2, members)).toEqual({ body: { assignee_id: M2 } });
    expect(P.assignBodyOf(C1, members).error).toBeTruthy();
  });

  test('줄마다 「담당 이름 (역할)」 · 없으면 「담당자 없음」, 대표 · 실장은 「담당자」 단추, 직원은 없다', async () => {
    await load({ list: () => ok(withAssignee()) });
    expect(owners()).toEqual(['담당자 없음', '담당 나직원 (직원)']);
    expect(box().querySelectorAll('[data-act="assign"]').length).toBe(2);
    await load({ list: () => ok(withAssignee({ can_manage: false })) });
    expect(owners()).toEqual(['담당자 없음', '담당 나직원 (직원)']);
    expect(box().querySelector('[data-act="assign"]')).toBeNull();
  });

  test('서버가 담당자 칸을 못 받으면(assignee_ready 아님) 적지도 고르지도 않는다', async () => {
    await load({ list: () => ok(projects({ assignee_ready: false, members })) });
    expect(owners()).toEqual([]);
    expect(box().querySelector('[data-act="assign"]')).toBeNull();
  });

  test('고르기 — 지금 담당자가 골라진 채 열고, 다른 사람으로 저장하면 PUT · 목록 다시 읽기 · 알림, 비우기는 null', async () => {
    let list = withAssignee();
    const calls = await load({ list: () => ok(list) });
    box().querySelector('[data-act="assign"][data-for="' + P1 + '"]').click();
    await flush();
    const form = () => box().querySelector('form[data-form="assign"]');
    const sel = () => form().querySelector('[name="assignee_id"]');
    expect([...sel().options].map((o) => o.textContent)).toEqual(['담당자 없음', '나직원 (직원)', '다실장 (실장)']);
    expect(sel().value).toBe(M1);
    sel().value = M2;
    list = withAssignee();
    list.items[1].assignee = { user_id: M2, name: '다실장', role: 'manager' };
    form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    const put = calls.fetch.filter((c) => c.method === 'PUT');
    expect(put.map((c) => [c.url, c.body])).toEqual([[WORK + '/company/projects/' + P1 + '/assignee', { assignee_id: M2 }]]);
    expect(put[0].auth).toBe('Bearer tok-1');
    expect(box().textContent).toContain('담당자를 정했습니다.');
    expect(owners()).toEqual(['담당자 없음', '담당 다실장 (실장)']);
    expect(form()).toBeNull();

    box().querySelector('[data-act="assign"][data-for="' + P1 + '"]').click();
    await flush();
    sel().value = '';
    form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(calls.fetch.filter((c) => c.method === 'PUT').at(-1).body).toEqual({ assignee_id: null });
    expect(box().textContent).toContain('담당자를 비웠습니다.');
  });

  test('서버가 못 정하면 서버 글을 그 자리에 · 칸은 열어 둔다, 담당자 단추를 다시 누르면 접힘', async () => {
    await load({
      list: () => ok(withAssignee()),
      assign: () => fail(409, 'stale', '그 사이 담당자가 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요'),
    });
    box().querySelector('[data-act="assign"][data-for="' + P2 + '"]').click();
    await flush();
    box().querySelector('form[data-form="assign"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(box().querySelector('form[data-form="assign"] [data-err]').textContent).toBe('그 사이 담당자가 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요');
    // 닫기 단추는 없다 — 같은 「담당자」 단추를 다시 누르면 접힌다
    expect(box().querySelector('[data-act="assign-close"]')).toBeNull();
    const again = box().querySelector('[data-act="assign"][data-for="' + P2 + '"]');
    expect([again.className, again.getAttribute('aria-expanded')]).toEqual(['mk-btn mk-btn--solid', 'true']);
    again.click();
    await flush();
    expect(box().querySelector('form[data-form="assign"]')).toBeNull();
  });
});
