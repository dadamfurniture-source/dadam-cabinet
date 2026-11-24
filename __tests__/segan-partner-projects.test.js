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
/** 한 건 화면의 「관리」 칸 — segan/project-sheet.js 가 주는 자리를 흉내 낸다 (같은 프로젝트면 그 자리 그대로) */
const area = (id) => {
  let host = $('pjHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pjHost';
    document.body.appendChild(host);
  }
  const PP = window.SeganPartnerProjects;
  const d = PP.state.detail;
  if (!d || d.el !== host || d.id !== id) PP.mountDetail(host, id);
  return host;
};
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
  const titles = () => [...box().querySelectorAll('[data-project] .me-c-main > b')].map((b) => b.textContent);

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

  test('보기 고르기 — 전체 · 단계마다 · 담당자 없음(수와 함께). 누르면 그 줄만, 다시 누르면 전체. 새 고객 단추는 전체 · 상담에서만', async () => {
    await load({ list: staged });
    await flush();
    await openScreen('partner-projects');
    expect(box().querySelector('.me-pt-sub').textContent).toBe('프로젝트');
    // 단계의 수는 진행 중인 것만 (끝난 붙박이장은 전체에만 있다). 머문 날을 안 주는 서버면 「멈춘 것」이 없다
    expect(chips()).toEqual(['전체 3*', '상담 0', '설계 1', '견적 0', '계약 0', '생산 1', '설치 0', '담당자 없음 2']);
    expect(titles()).toEqual(['붙박이장', '싱크대', '신발장']);
    expect(box().querySelector('[data-act="open"]')).not.toBeNull();
    chip('[data-stage="design"]').click();
    expect(titles()).toEqual(['싱크대']);
    expect(chips().filter((c) => c.endsWith('*'))).toEqual(['설계 1*']);
    expect(box().querySelector('[data-act="open"]')).toBeNull();
    expect(box().querySelector('.me-pt-sub').textContent).toBe('프로젝트');
    chip('[data-stage="make"]').click();
    expect(titles()).toEqual(['신발장']);
    chip('[data-stage="quote"]').click();
    expect(titles()).toEqual([]);
    expect(box().querySelector('.me-empty').textContent).toBe('이 단계의 프로젝트가 없습니다.');
    chip('[data-stage="consult"]').click();
    expect(box().querySelector('[data-act="open"]')).not.toBeNull();
    chip('[data-pick="unassigned"]').click();
    expect(titles()).toEqual(['싱크대', '신발장']);
    expect(box().querySelector('[data-act="open"]')).toBeNull();
    // 켜진 것을 다시 누르면 전체로
    chip('[data-pick="unassigned"]').click();
    expect(chips()[0]).toBe('전체 3*');
    expect(titles()).toEqual(['붙박이장', '싱크대', '신발장']);
    // 줄 — 이름 · 고객 · 담당 (만든 날 · 설계 수 · 전화는 한 건 화면에)
    expect(rows()[1]).toBe('싱크대 | 김고객 · 담당자 없음');
    expect(box().textContent).not.toContain('PC 화면');
  });

  test('단계 화면 — 도구가 없는 단계(설계)는 그 단계로 고른 목록. 화면을 옮기면 보기를 다시 맞추고, 같은 화면에서 고른 것은 그대로 둔다', async () => {
    await load({ list: staged });
    await flush();
    await openScreen('p-design');
    expect(titles()).toEqual(['싱크대']);
    expect(chips().filter((c) => c.endsWith('*'))).toEqual(['설계 1*']);
    // 같은 화면에서 다른 보기를 골랐다 — 메뉴가 다시 맞춰도(apply) 그대로
    chip('[data-stage="make"]').click();
    window.SeganMe.apply();
    await flush();
    expect(titles()).toEqual(['신발장']);
    // 다른 화면으로 옮기면 그 화면의 보기로
    await openScreen('partner-projects');
    expect(chips()[0]).toBe('전체 3*');
    await openScreen('p-design');
    expect(titles()).toEqual(['싱크대']);
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
  // 줄의 작은 단계 띠 — 칸마다 지난(✓) · 지금(●) · 남은(○), 이름은 옆의 한 줄에 적는다
  const stripOf = (id) =>
    [...rowOf(id).querySelectorAll('.pj-mini li')].map((li) =>
      li.classList.contains('is-now') ? '●' : li.classList.contains('is-done') ? '✓' : '○'
    );
  const stepOf = (id) => rowOf(id).querySelector('[data-pj="step"]').textContent;
  /** 한 건 화면이 열리는 것을 흉내 낸다 — 열면 그 프로젝트의 「관리」 칸 자리를 준다 */
  const withPage = () => {
    window.SeganProjectSheet = { open: jest.fn((id) => (area(id), true)) };
    return window.SeganProjectSheet.open;
  };
  const see = async (view) => {
    window.SeganPartnerProjects.setView(view || {});
    await flush();
  };
  // 보기 고르기 — 「이름 수」, 켜진 것은 끝에 *
  const chips = () =>
    [...box().querySelectorAll('.pj-chip')].map(
      (b) => b.textContent.replace(/\s+/g, ' ').trim() + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')
    );
  const chip = (attr) => box().querySelector('.pj-chip' + attr);

  // ── 품목 줄 (2026-11-23 대표님 「워크플로우를 현재 변경된 프로젝트 지정에 맞게」 — 서버 items · next.item: workflow-api pipeline-items.js) ──
  const D_SINK = 'draft-sink-0001';
  const D_WARD = 'draft-ward-0001';
  const twoItems = () => [
    {
      key: 'draft:' + D_SINK,
      label: '싱크대',
      step: 'make',
      step_label: '생산',
      next: { key: 'deliver', label: '배송으로 넘기기', go: 'order:' + ORD, wait: false, since: null, allowed: true },
      draft_id: D_SINK,
      design_id: 'design-1',
      order_id: ORD,
    },
    {
      key: 'draft:' + D_WARD,
      label: '붙박이장 <안방>',
      step: 'design',
      step_label: '설계',
      next: { key: 'design', label: '설계 이어서', go: 'planner?draft=' + D_WARD, wait: false, since: null, allowed: true },
      draft_id: D_WARD,
      design_id: null,
      order_id: null,
    },
  ];

  test('품목 줄 — 품목이 둘 이상이면 줄에 품목별 단계 한 줄, 다음 할 일 앞에 그 품목 이름. 하나면 지금처럼', async () => {
    const items = twoItems();
    await load({
      list: flowed([
        item(P1, '예시 주방', {
          step: 'design',
          items,
          next: { ...items[1].next, item: items[1].label },
        }),
        item(P3, '품목 하나', { step: 'design', items: [items[1]], next: items[1].next }),
        item(P4, '옛 서버', { step: 'design', next: items[1].next }),
      ]),
    });
    await flush();
    await openScreen('partner-projects');
    // 글자 그대로 (품목 이름은 사람이 적은 글이다)
    const line = rowOf(P1).querySelector('[data-pj="items"]');
    expect(line.textContent).toBe('싱크대 생산 · 붙박이장 <안방> 설계');
    expect(line.querySelector('안방')).toBeNull();
    const btn = rowOf(P1).querySelector('[data-next="design"]');
    expect(btn.textContent).toBe('붙박이장 <안방> 설계 이어서');
    // 단계는 가장 늦은 품목 것 (서버가 준 step 그대로)
    expect(stepOf(P1)).toContain('설계');
    // 품목이 하나 · 옛 서버(items 없음) — 줄도 이름도 없다
    for (const id of [P3, P4]) {
      expect(rowOf(id).querySelector('[data-pj="items"]')).toBeNull();
      expect(rowOf(id).querySelector('[data-next="design"]').textContent).toBe('설계 이어서');
    }
  });

  test('품목 줄 — 기다림 · 내 직책으로 못 하는 일에도 품목 이름. 끝난 프로젝트에는 품목 줄이 없다', async () => {
    const items = twoItems();
    await load({
      list: flowed([
        item(P1, '답 기다림', {
          step: 'quote',
          items,
          next: { key: 'customer', label: '고객 답 기다림', go: 'p-quote', wait: true, since: null, allowed: false, item: '싱크대' },
        }),
        item(P3, '대표 몫', {
          step: 'contract',
          items,
          next: { key: 'deposit', label: '계약금 입금 적기', go: 'order:' + ORD, wait: false, since: null, allowed: false, item: '싱크대' },
        }),
        item(P4, '끝남', { step: 'done', status: 'closed', items }),
      ]),
    });
    await flush();
    await openScreen('partner-projects');
    expect(rowOf(P1).querySelector('.pj-wait').textContent).toBe('싱크대 고객 답 기다림');
    expect(rowOf(P3).querySelector('.pj-wait').textContent).toContain('싱크대 계약금 입금 적기 — ');
    expect(rowOf(P4).querySelector('[data-pj="items"]')).toBeNull();
  });

  test('품목마다의 다음 할 일 — 한 건 화면의 「품목」 칸이 쓰는 값 (itemFlowsOf · addItemUrl)', async () => {
    const items = twoItems();
    await load({ list: flowed([item(P1, '예시 주방', { step: 'design', items, next: { ...items[1].next, item: items[1].label } })]) });
    await flush();
    const PP = window.SeganPartnerProjects;
    const p = PP.state.data.items.find((x) => x.id === P1);
    const flows = PP.itemFlowsOf(p);
    expect(flows.map((x) => [x.key, x.label, x.step, x.stepLabel, x.draftId, x.designId, x.orderId])).toEqual([
      ['draft:' + D_SINK, '싱크대', 'make', '생산', D_SINK, 'design-1', ORD],
      ['draft:' + D_WARD, '붙박이장 <안방>', 'design', '설계', D_WARD, '', ''],
    ]);
    // 단추는 프로젝트 줄의 것과 같은 꼴 — 수주 창 · 플래너. 품목 이름은 단추에 다시 붙이지 않는다 (칸의 이름 옆에 선다)
    document.body.insertAdjacentHTML('beforeend', '<div id="itemProbe">' + flows.map((x) => x.act).join('') + '</div>');
    const probe = document.getElementById('itemProbe');
    const [deliver, design] = [...probe.children];
    expect([deliver.getAttribute('data-act'), deliver.getAttribute('data-id'), deliver.textContent]).toEqual(['next-sheet', ORD, '배송으로 넘기기']);
    expect(design.textContent).toBe('설계 이어서');
    // 플래너 주소 — 그 품목의 초안으로 / 프로젝트로 (앱의 플래너 링크가 있을 때만)
    const links = (window.SeganShell && window.SeganShell.ROLE_LINKS) || [];
    const base = (links.find((l) => l.key === 'planner') || {}).href || '';
    expect(flows[1].open).toBe(base ? base + '?draft=' + D_WARD : '');
    expect(PP.addItemUrl(p)).toBe(base ? base + '?project=' + P1 : '');
    expect(PP.addItemUrl({ id: 'x' })).toBe('');
    // 모양이 틀린 줄은 버린다 · 품목이 없으면 빈 목록
    expect(PP.itemFlowsOf({ id: P1, items: [null, { label: '', step: 'make' }, { label: '이름', step: 'nope' }] })).toEqual([]);
    expect(PP.itemFlowsOf({ id: P1 })).toEqual([]);
    // 끝난 품목은 「끝」 (단계 띠의 마지막 칸 이름 A/S 가 아니다)
    expect(PP.itemFlowsOf({ id: P1, status: 'active', items: [{ key: 'k', label: '싱크대', step: 'done', next: null }] })[0].stepLabel).toBe('끝');
  });

  test('작은 단계 띠 — 지난 단계 · 지금 단계 · 남은 단계 일곱 칸과 지금 단계 이름. 서버가 값을 안 주면(옛 서버) · 끝난 프로젝트는 띠가 없다', async () => {
    await load({
      list: flowed([
        item(P1, '싱크대', { step: 'quote', next: null }),
        item(P3, '신발장'), // step 없음
        item(P4, '화장대', { step: 'make', status: 'closed' }),
      ]),
    });
    await flush();
    await openScreen('partner-projects');
    expect(stripOf(P1)).toEqual(['✓', '✓', '●', '○', '○', '○', '○']);
    expect(stepOf(P1)).toBe('견적');
    expect(rowOf(P1).querySelector('.pj-mini').getAttribute('aria-label')).toBe('단계 7 가운데 3번째');
    expect(rowOf(P3).querySelector('.pj-mini')).toBeNull();
    expect(rowOf(P4).querySelector('.pj-mini')).toBeNull();
  });

  test('머문 날 — 서버가 준 stay 대로 「n일째」 · 「느림」 · 「멈춤」(생산 · 설치는 「잡은 날 지남」), 「멈춘 것」으로 고른다', async () => {
    await load({
      list: flowed([
        item(P1, '여유', { step: 'consult', next: null, stay: { days: 0, state: 'fresh' } }),
        item(P3, '느림', { step: 'design', next: null, stay: { days: 4, state: 'slow' } }),
        item(P4, '멈춤', { step: 'quote', next: null, stay: { days: 9, state: 'stuck' } }),
        item(P5, '생산 멈춤', { step: 'make', next: null, stay: { days: null, state: 'stuck' } }),
      ]),
    });
    await flush();
    await openScreen('partner-projects');
    expect([stepOf(P1), stepOf(P3), stepOf(P4), stepOf(P5)]).toEqual([
      '상담',
      '설계 · 4일째 · 느림',
      '견적 · 9일째 · 멈춤',
      '생산 · 잡은 날 지남 · 멈춤',
    ]);
    // 색만으로 알리지 않는다 — 글이 있다
    expect(rowOf(P4).querySelector('.pj-stuck').textContent).toBe('멈춤');
    expect(rowOf(P3).querySelector('.pj-slow').textContent).toBe('느림');
    expect(chips()).toContain('멈춘 것 2');
    chip('[data-pick="stuck"]').click();
    expect(chips().filter((c) => c.endsWith('*'))).toEqual(['멈춘 것 2*']);
    expect(titles()).toEqual(['멈춤', '생산 멈춤']);
    const PP = window.SeganPartnerProjects;
    expect(PP.isStuck({ status: 'on_hold', stay: { state: 'stuck' } })).toBe(false);
    expect(PP.isStuck({ status: 'active' })).toBe(false);
  });

  test('머문 날은 한 번만 적는다 — 서버가 날을 센 줄은 기다림 글 · 단추 옆의 「n일째」를 뺀다 (새로 생긴 일 · 한 건 화면의 글은 그대로)', async () => {
    const waited = '2026-11-01T00:00:00Z';
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-10T03:00:00Z'));
    const items = [
      item(P1, '센 줄', { step: 'quote', stay: { days: 9, state: 'stuck' }, next: next('customer', '고객 답 기다림', 'p-quote', { wait: true, since: waited, views: 2 }) }),
      item(P3, '안 센 줄', { step: 'quote', next: next('customer', '고객 답 기다림', 'p-quote', { wait: true, since: waited, views: 2 }) }),
      item(P4, '단추 줄', { step: 'contract', stay: { days: 4, state: 'slow' }, next: next('deposit', '계약금 입금 적기', 'order:' + ORD, { since: waited }) }),
    ];
    await load({ list: flowed(items) });
    await flush();
    await openScreen('partner-projects');
    expect(stepOf(P1)).toBe('견적 · 9일째 · 멈춤');
    expect(rowOf(P1).querySelector('.pj-wait').textContent).toBe('고객 답 기다림 · 2번 열어 봄');
    expect(rowOf(P3).querySelector('.pj-wait').textContent).toBe('고객 답 기다림 · 9일째 · 2번 열어 봄');
    expect(rowOf(P4).querySelector('.pj-since')).toBeNull();
    expect(window.SeganPartnerProjects.nextOf(items[0]).note).toContain('9일째');
  });

  test('단계로 거르기 — 서버의 지금 단계(step)가 먼저다: 받은 제작 의뢰는 생산, 완료는 어느 단계에도 없고 전체에만', async () => {
    await load({
      list: flowed([
        item(P1, '의뢰 받은 주방', { stage: 'consult', step: 'make', next: null }),
        item(P3, '끝난 신발장', { stage: 'order', order: { id: ORD, order_no: 'A-9', status: 'completed' }, step: 'done', next: null }),
      ]),
    });
    await flush();
    await openScreen('partner-projects');
    await see({ stage: 'make' });
    expect(titles()).toEqual(['의뢰 받은 주방']);
    await see({ stage: 'install' });
    expect(titles()).toEqual([]);
    await see({ stage: 'consult' });
    expect(titles()).toEqual([]);
    await see({});
    expect(titles()).toEqual(['의뢰 받은 주방', '끝난 신발장']);
    expect(stepOf(P3)).toBe('A/S');
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
  const act = (id, sel) => area(id).querySelector(sel);
  const statusBtn = (id) => act(id, '[data-act="status"]:not([data-next])');

  test('「보류 · 그만둠」 단추(한 건 화면의 관리 칸) — 서버가 쓸 수 있다고 할 때만(hold_ready), 대표 · 실장 · 담당자에게, 계약금을 받은 프로젝트에는 없다. 보류한 줄은 「보류」 보기에', async () => {
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
    expect(statusBtn(P1)).toBeNull();
    // 줄에는 어느 때에도 그 단추가 없다
    expect(box().querySelector('[data-act="status"]')).toBeNull();
    // 쓸 수 있다
    await load({ list: () => ok(projects(held({ items }))) });
    await flush();
    await openScreen('partner-projects');
    expect(box().querySelector('[data-act="status"]')).toBeNull();
    expect(statusBtn(P1).textContent).toBe('보류 · 그만둠');
    expect(statusBtn(P1).getAttribute('aria-expanded')).toBe('false');
    expect(statusBtn(P3)).toBeNull(); // 계약금을 받았다
    expect(statusBtn(P5).textContent).toBe('되살리기'); // 대표 · 실장
    // 보류한 줄은 전체에 없고 「보류」 보기에 있다 — 다시 볼 날 · 메모 · 지금 단계 · 「다시 진행 · 그만둠」(계약금을 받았어도)
    expect(rowOf(P4)).toBeNull();
    expect(chips()).toContain('보류 1');
    chip('[data-pick="held"]').click();
    expect(titles()).toEqual(['보류한 것']);
    expect(rowOf(P4).querySelector('.pj-hold').textContent).toBe('다시 볼 날 2026.12.05 · 「이사 날짜 미정」');
    expect(rowOf(P4).querySelector('.me-pr-status').textContent).toBe('보류');
    expect(stepOf(P4)).toBe('견적');
    expect(statusBtn(P4).textContent).toBe('다시 진행 · 그만둠');
    chip('[data-pick="held"]').click();
    expect(rowOf(P4)).toBeNull();
    // 그만둔 줄 — 메모가 보인다
    expect(rowOf(P5).querySelector('.pj-hold').textContent).toBe('「고객 포기」');
    // 직원 — 내가 담당인 프로젝트에만
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
    // 한 건 화면이 바뀐 것을 듣는다 (띠 · 단계 칸을 다시 읽으려고)
    const pageChanged = jest.fn();
    window.SeganPartnerProjects.mountDetail(area(P1), P1, { onChange: pageChanged });
    statusBtn(P1).click();
    // 읽는 동안
    expect(area(P1).querySelector('.pj-status').textContent).toBe('불러오는 중…');
    expect(statusBtn(P1).getAttribute('aria-expanded')).toBe('true');
    await flush();
    const panel = () => area(P1).querySelector('.pj-status');
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
    // 알림은 한 건 화면의 관리 칸에 — 목록에는 적지 않는다
    expect(area(P1).querySelector('.me-pt-msg').textContent).toBe('보류했습니다.');
    expect(box().querySelector('.me-pt-msg')).toBeNull();
    expect(onChange).toHaveBeenCalled();
    expect(pageChanged).toHaveBeenCalledTimes(1);
    // 보류한 줄은 전체에서 빠져 「보류」 보기로 갔고, 칸은 접혔다
    expect(rowOf(P1)).toBeNull();
    expect(chips()).toContain('보류 1');
    expect(area(P1).querySelector('.pj-status')).toBeNull();
    expect(statusBtn(P1).textContent).toBe('다시 진행 · 그만둠');
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
    const panel = () => area(P1).querySelector('.pj-status');
    expect(panel().querySelector('[data-act="status-form"]')).toBeNull();
    expect(panel().querySelector('[data-pj="blocked"]').textContent).toBe('계약금을 받은 프로젝트는 보류 · 그만둠을 할 수 없습니다.');
    // 접는다
    statusBtn(P1).click();
    expect(area(P1).querySelector('.pj-status')).toBeNull();
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
    await load({ list: () => ok(projects(held({ items }))), one: () => fail(500, 'x', 'x') });
    await flush();
    await openScreen('partner-projects');
    statusBtn(P1).click();
    await flush();
    expect(panel().querySelector('.mk-error').textContent).toBe('불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
  });

  test('보류를 다시 볼 날 — 줄의 「보류 — 다시 볼 날입니다」 단추는 한 건 화면을 열고 관리 칸을 펼친다, 다시 진행은 바로 보낸다', async () => {
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
    // 한 건 화면이 없으면 열 곳이 없다
    expect(await window.SeganPartnerProjects.openStatus(P4)).toBe(false);
    const opened = withPage();
    await window.SeganPartnerProjects.reload();
    await see({ pick: 'held' });
    const due = rowOf(P4).querySelector('[data-act="status"][data-next="hold_due"]');
    expect(due.textContent).toBe('보류 — 다시 볼 날입니다');
    expect(rowOf(P4).querySelector('[data-act="sheet"]')).toBeNull();
    due.click();
    await flush();
    expect(opened).toHaveBeenCalledWith(P4);
    const panel = area(P4).querySelector('.pj-status');
    expect([...panel.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['다시 진행', '그만둠']);
    panel.querySelector('[data-act="status-resume"]').click();
    await flush();
    expect(sent).toEqual([{ expect_status: 'on_hold', status: 'active' }]);
    expect(area(P4).querySelector('.me-pt-msg').textContent).toBe('다시 진행합니다.');
    expect(chips().some((c) => c.startsWith('보류 0'))).toBe(true); // 「보류」 보기에 있는 동안은 0 으로 남는다
    await see({});
    expect(chips().some((c) => c.startsWith('보류'))).toBe(false); // 보류가 없다
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
  const visitBtn = (id) => area(id).querySelector('[data-act="visit"]');
  const visitForm = (id) => area(id).querySelector('form[data-form="visit"]');
  // 목록 줄의 다음 할 일 단추 「실측 일정 잡기」 — 누르면 한 건 화면의 실측 칸이 열린다
  const nextVisit = (id) => rowOf(id).querySelector('[data-act="visit"]');

  test('실측 단계 — 서버가 쓸 수 있다고 할 때만(visit_ready) 띠가 여덟 칸. 실측 일정 잡기 → 실측 예정(날짜) → 실측 완료 처리 → 설계 시작', async () => {
    // 옛 서버 · DB 0079 전 — 일곱 칸, 실측 단추 없음
    await load({
      list: flowed([item(P1, '설계 전', { step: 'consult', next: next('design_start', '설계 시작', 'planner?project=' + P1) })]),
    });
    await flush();
    await openScreen('partner-projects');
    expect(stripOf(P1)).toEqual(['●', '○', '○', '○', '○', '○', '○']);
    expect(chips().some((c) => c.startsWith('실측'))).toBe(false);
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
    expect(stripOf(P1)).toEqual(['●', '○', '○', '○', '○', '○', '○', '○']);
    expect(stripOf(P3).slice(0, 3)).toEqual(['✓', '●', '○']);
    expect(stepOf(P3)).toBe('실측');
    expect(chips().slice(0, 3)).toEqual(['전체 4*', '상담 1', '실측 3']);
    // 실측 전 — 줄의 다음 할 일 단추가 실측 칸을 여는 단추다
    expect(
      [...rowOf(P1).querySelectorAll('[data-act="visit"]')].map((b) => [b.textContent, b.getAttribute('data-next'), b.getAttribute('aria-expanded')])
    ).toEqual([['실측 일정 잡기', 'measure_plan', 'false']]);
    expect(rowOf(P1).querySelector('[data-pj="visit"]')).toBeNull();
    expect(visitBtn(P1)).toBeNull(); // 관리 칸의 「실측 일정」은 잡힌 실측이 있을 때만
    // 실측 예정 — 기다림 글에 날짜(한국 시각), 줄에 실측 한 줄, 관리 칸에 「실측 일정」 단추
    expect(rowOf(P3).querySelector('.pj-wait').textContent).toBe('실측 11.25 (수) 14:00 예정');
    expect(rowOf(P3).querySelector('[data-pj="visit"]').textContent).toBe('실측 11.25 (수) 14:00 · 박실장 · 「현관 1층」');
    expect(rowOf(P3).querySelectorAll('[data-act="visit"]')).toHaveLength(0);
    expect(visitBtn(P3).textContent).toBe('실측 일정');
    // 실측 날 — 「실측 완료 처리」는 줄에서 바로 누른다
    const fin = rowOf(P4).querySelector('[data-act="next-visit-done"]');
    expect([fin.textContent, fin.getAttribute('data-for')]).toEqual(['실측 완료 처리', P4]);
    expect(rowOf(P4).querySelector('[data-pj="visit"]').textContent).toBe('실측 11.20 (금) 10:00 · 외부 기사');
    // 실측 끝 — 그제야 설계 시작, 줄에는 끝낸 날
    expect(rowOf(P5).querySelector('a[data-next="design_start"]').textContent).toBe('설계 시작');
    expect(rowOf(P5).querySelector('[data-pj="visit"]').textContent).toBe('실측 끝 11.19');
    // 실측 화면(#p-measure) — 실측으로 고른 목록
    await openScreen('p-measure');
    expect(titles()).toEqual(['실측 예정', '실측 날', '실측 끝']);
    expect($('partnerProjectsTitle').textContent).toBe('프로젝트');
    expect(chips().filter((c) => c.endsWith('*'))).toEqual(['실측 3*']);
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
    const opened = withPage();
    await window.SeganPartnerProjects.reload();
    nextVisit(P1).click();
    await flush();
    expect(opened).toHaveBeenCalledWith(P1);
    expect(nextVisit(P1).getAttribute('aria-expanded')).toBe('true');
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
    expect(area(P1).querySelector('.pj-visit').textContent).not.toContain('닫기');
    expect(visitForm(P1).querySelector('[data-act="visit-done"]')).toBeNull();
    expect(visitForm(P1).querySelector('[type="submit"]').textContent).toBe('실측 일정 잡기');
    // 날짜 없이 내면 그 자리에 알리고 보내지 않는다 — 적던 값은 남는다
    visitForm(P1).querySelector('[name="note"]').value = ' 현관 1층 ';
    visitForm(P1).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(area(P1).querySelector('.pj-visit .mk-error').textContent).toBe('실측 날짜와 시각을 적어 주세요.');
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
    expect(area(P1).querySelector('.me-pt-msg').textContent).toBe('실측 일정을 잡았습니다.');
    expect(onChange).toHaveBeenCalled();
    expect(area(P1).querySelector('.pj-visit')).toBeNull(); // 칸은 접혔다
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
    expect(area(P1).querySelector('.pj-visit')).toBeNull();
    visitBtn(P1).click();
    visitForm(P1).querySelector('[data-act="visit-done"]').click();
    await flush();
    expect(sent[1]).toEqual(['PATCH', { status: 'done' }]);
    expect(area(P1).querySelector('.me-pt-msg').textContent).toBe('실측을 끝냈습니다. 이제 설계를 시작할 수 있습니다.');
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
    withPage();
    nextVisit(P3).click();
    await flush();
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
    expect(area(P3).querySelector('.pj-visit .mk-error').textContent).toBe('그 사이 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요');
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

  test('작업 분배 화면은 뺐다 (2026-11-23 대표님) — 옛 주소 #assign 은 프로젝트 목록을 열고, 담당자는 「담당자 없음」으로 고른다', async () => {
    await load({ list: staged });
    await flush();
    await openScreen('assign');
    expect(box().querySelector('.me-pt-sub').textContent).toBe('프로젝트');
    expect(titles()).toEqual(['붙박이장', '싱크대', '신발장']);
    expect(window.SeganPartnerProjects.canAssign()).toBe(true);
    expect(chips()).toContain('담당자 없음 2');
    expect(document.querySelector('[data-me-item="assign"]')).toBeNull();
    await openScreen('partner-projects');
    expect(titles()).toEqual(['붙박이장', '싱크대', '신발장']);
  });

  // ── 고객 초대 (2026-11-23 대표님 뒤 공정 3차 — 서버 invite_ready · POST /company/projects/:id/customer-invite, DB 0082) ──
  // 2026-11-23 「프로젝트 관리 새 틀」 — 「고객 초대」 단추 · 칸도 줄이 아니라 한 건 화면의 「관리」 칸에 있다 (꼬리표 「고객 앱 연결」은 줄에)
  test('고객 초대 — 서버가 쓸 수 있다고 할 때만(invite_ready), 앱과 이어지지 않은 고객의 진행 중 프로젝트에. 이어졌으면 줄에 「고객 앱 연결」', async () => {
    const items = [
      item(P1, '안 이어짐', { customer: { id: C1, name: '김고객', phone: null, app: false } }),
      item(P3, '이어짐', { customer: { id: C2, name: '이고객', phone: null, app: true } }),
    ];
    // 옛 서버 · DB 0082 전 — 단추도 꼬리표도 없다
    await load({ list: () => ok(projects({ items })) });
    await flush();
    await openScreen('partner-projects');
    expect(area(P1).querySelector('[data-act="invite"]')).toBeNull();
    expect(box().querySelector('[data-pj="app"]')).toBeNull();
    document.body.innerHTML = '';
    await load({ list: () => ok(projects({ invite_ready: true, items })) });
    await flush();
    await openScreen('partner-projects');
    expect(box().querySelector('[data-act="invite"]')).toBeNull(); // 줄에는 없다
    const btn = area(P1).querySelector('[data-act="invite"]');
    expect([btn.textContent, btn.getAttribute('aria-expanded')]).toEqual(['고객 초대', 'false']);
    expect(area(P3).querySelector('[data-act="invite"]')).toBeNull();
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
    const btn = () => area(P1).querySelector('[data-act="invite"]');
    btn().click();
    await flush();
    const panel = () => area(P1).querySelector('[data-pj="invite"]');
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
    area(P1).querySelector('[data-act="invite"]').click();
    await flush();
    area(P1).querySelector('[data-act="invite-make"]').click();
    await flush();
    expect(area(P1).querySelector('[data-act="invite"]')).toBeNull();
    expect(rowOf(P1).querySelector('[data-pj="app"]').textContent).toBe('고객 앱 연결');
  });
});

describe('목록', () => {
  test('최신 순 그대로, 이름 · 고객 · 상태(진행 중은 안 적음). 만든 날 · 설계 수 · 전화는 줄에 적지 않는다 (한 건 화면에)', async () => {
    const calls = await load();
    await flush();
    expect(projectCalls(calls)[0].auth).toBe('Bearer tok-1');
    expect(box().hidden).toBe(false);
    expect(box().querySelector('.me-pt-sub').textContent).toBe('프로젝트');
    expect(rows()).toEqual(['붙박이장 | 김고객 | 끝남', '싱크대 | 김고객']);
    expect(box().querySelector('a[href^="tel:"]')).toBeNull();
    // 줄의 단추는 다음 할 일 하나뿐 — 담당자 · 작업 배정 · 보류 · 실측 일정 단추는 줄에 없다
    expect(box().querySelector('[data-act="assign"], [data-act="work"], [data-act="status"]:not([data-next])')).toBeNull();
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

  test('줄마다 「담당 이름 (역할)」 · 없으면 「담당자 없음」, 「담당자」 단추는 한 건 화면의 관리 칸에 (대표 · 실장만)', async () => {
    await load({ list: () => ok(withAssignee()) });
    expect(owners()).toEqual(['담당자 없음', '담당 나직원 (직원)']);
    expect(box().querySelector('[data-act="assign"]')).toBeNull();
    expect(area(P1).querySelector('[data-act="assign"]').textContent).toBe('담당자');
    expect(area(P2).querySelector('[data-act="assign"]')).not.toBeNull();
    await load({ list: () => ok(withAssignee({ can_manage: false })) });
    expect(owners()).toEqual(['담당자 없음', '담당 나직원 (직원)']);
    expect(area(P1).querySelector('[data-act="assign"]')).toBeNull();
  });

  test('서버가 담당자 칸을 못 받으면(assignee_ready 아님) 적지도 고르지도 않는다', async () => {
    await load({ list: () => ok(projects({ assignee_ready: false, members })) });
    expect(owners()).toEqual([]);
    expect(area(P1).querySelector('[data-act="assign"]')).toBeNull();
    expect(box().querySelector('.pj-chip[data-pick="unassigned"]')).toBeNull();
  });

  test('고르기 — 지금 담당자가 골라진 채 열고, 다른 사람으로 저장하면 PUT · 목록 다시 읽기 · 알림, 비우기는 null', async () => {
    let list = withAssignee();
    const calls = await load({ list: () => ok(list) });
    const pageChanged = jest.fn();
    window.SeganPartnerProjects.mountDetail(area(P1), P1, { onChange: pageChanged });
    area(P1).querySelector('[data-act="assign"]').click();
    await flush();
    const form = () => area(P1).querySelector('form[data-form="assign"]');
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
    expect(area(P1).textContent).toContain('담당자를 정했습니다.');
    expect(owners()).toEqual(['담당자 없음', '담당 다실장 (실장)']);
    expect(form()).toBeNull();
    expect(pageChanged).toHaveBeenCalledTimes(1); // 한 건 화면의 머리(담당)가 다시 읽힌다

    area(P1).querySelector('[data-act="assign"]').click();
    await flush();
    sel().value = '';
    form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(calls.fetch.filter((c) => c.method === 'PUT').at(-1).body).toEqual({ assignee_id: null });
    expect(area(P1).textContent).toContain('담당자를 비웠습니다.');
  });

  test('서버가 못 정하면 서버 글을 그 자리에 · 칸은 열어 둔다, 담당자 단추를 다시 누르면 접힘. 한 건 화면을 닫으면 펼친 칸도 접힌다', async () => {
    await load({
      list: () => ok(withAssignee()),
      assign: () => fail(409, 'stale', '그 사이 담당자가 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요'),
    });
    const host = area(P2);
    host.querySelector('[data-act="assign"]').click();
    await flush();
    host.querySelector('form[data-form="assign"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(host.querySelector('form[data-form="assign"] [data-err]').textContent).toBe('그 사이 담당자가 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요');
    // 닫기 단추는 없다 — 같은 「담당자」 단추를 다시 누르면 접힌다
    expect(host.querySelector('[data-act="assign-close"]')).toBeNull();
    const again = host.querySelector('[data-act="assign"]');
    expect([again.className, again.getAttribute('aria-expanded')]).toEqual(['mk-btn mk-btn--solid', 'true']);
    again.click();
    await flush();
    expect(host.querySelector('form[data-form="assign"]')).toBeNull();
    // 펼친 채 한 건 화면을 닫았다 — 다음에 열면 접혀 있다
    host.querySelector('[data-act="assign"]').click();
    const PP = window.SeganPartnerProjects;
    PP.unmountDetail(host);
    expect([PP.state.detail, PP.state.assignFor]).toEqual([null, '']);
    expect(area(P2).querySelector('form[data-form="assign"]')).toBeNull();
  });
});
