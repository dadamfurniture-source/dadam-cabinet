/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 제작 의뢰 (segan/production-requests.js · segan/factory-requests.js + segan/me.html)
 *
 *   Manager  내 정보 › 업체 › 제작 의뢰 (#production-requests) — Manager 등급(company.plan) 업체 구성원만
 *            GET /production-requests · GET /production-requests/:id · POST /production-requests ·
 *            POST …/:id/choose { company_id } · POST …/:id/cancel
 *            「제작 의뢰」 = 시트(설계 · 프로젝트 · 현장 지역 = 팩토리 주소 · 희망 날짜 · 메모, 사진은 보내지 않는다)
 *            추천 카드 = 이름 · 다담 공장/팩토리 · 지역 · 예상 가격대 · 제작 기간(본사가 적은 것만 — DB 0055) · 하는 품목 ·
 *            본사 소개, 품목 · 지역이 다르면 확인 한 줄(막지 않는다)
 *            고르기 · 거두기 = 가운데 창. 팩토리가 못 받은 사유는 그리지 않는다
 *   팩토리   내 정보 › 업체 › 제작 의뢰함 (#factory-requests) — 다담 공장 · Expert · Agent 구성원
 *            GET /factory/production-requests · POST …/:id/accept · POST …/:id/decline { reason? }
 *            답 기한 · 남은 시간, 못 받음 사유는 적지 않아도 되고 본사만 본다
 *   못 읽으면 403 · 404 · 오류 · ready false → 칸째 감춘다
 * 사람 · 업체 · 설계는 모두 지어낸 시험 값이다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'me@example.com' } };
const PAY = 'https://pay.example.workers.dev';
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const CO = '11111111-1111-4111-8111-111111111111';
const R1 = '22222222-2222-4222-8222-222222222221';
const R2 = '22222222-2222-4222-8222-222222222222';
const F1 = '33333333-3333-4333-8333-333333333331';
const F2 = '33333333-3333-4333-8333-333333333332';
const F3 = '33333333-3333-4333-8333-333333333333';
const F9 = '33333333-3333-4333-8333-333333333339';
const P1 = '44444444-4444-4444-8444-444444444441';
const P2 = '44444444-4444-4444-8444-444444444442';
const NOW = Date.parse('2026-11-09T03:00:00Z'); // 한국 시간 12:00

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const company = (extra = {}) => ({
  id: CO,
  name: '가나 인테리어',
  plan: 'manager',
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
const HQ = ok({ company: null, application: null, members: [], invites: [], hq_member: true });

/** Manager 목록 한 줄 (워커 manager.js listMyRequests) */
const req = (id, extra = {}) => ({
  id,
  status: 'recommended',
  label: '추천 도착',
  created_at: '2026-11-08T01:00:00Z', // 한국 시간 11-08 10:00
  status_at: '2026-11-08T05:00:00Z',
  item: 'sink',
  item_label: '싱크대',
  draft: { id: 'd-kitchen-01', name: '김고객 주방', rev: 3, current_rev: 3, walls: 2, modules: 9 },
  design_id: null,
  project: { id: P1, title: '김고객 주방 리모델링' },
  note: '상판은 세라믹으로 생각합니다',
  sido: '대구광역시',
  gugun: '북구',
  region: '대구광역시 북구',
  wanted_done_date: '2026-12-20',
  round: 2,
  recommendation_count: 3,
  factory: null,
  can_cancel: true,
  can_choose: true,
  ...extra,
});
const rec = (company_id, name, extra = {}) => ({
  company_id,
  name,
  kind: 'partner',
  factory_label: '팩토리',
  region: '대구광역시 북구',
  items: ['싱크대', '붙박이장'],
  note: null,
  rank: 1,
  chosen: false,
  offer: null,
  ...extra,
});
/** Manager 의뢰 하나 (워커 manager.js getMyRequest) */
const detail = (id, extra = {}) => ({
  ...req(id),
  hq_note: '세 곳 모두 대구 근처입니다.',
  recommendations: [
    rec(F1, '가나 공방', {
      note: '세라믹 상판 경험이 많습니다',
      rank: 1,
      price_min: 12000000,
      price_max: 15000000,
      lead_days: 20,
    }),
    rec(F2, '다라 가구', {
      region: '경상북도 경산시',
      items: ['붙박이장'],
      rank: 2,
      price_min: null,
      price_max: 15000000,
      lead_days: null,
    }),
    // 예상 가격대 · 제작 기간 칸이 없는 응답 (0055 전 서버) — 그 줄 없이 그린다
    rec(F3, '다담 공장', {
      kind: 'hq',
      factory_label: '다담 공장',
      region: '',
      items: [],
      rank: 3,
    }),
  ],
  offers: [
    {
      round: 1,
      company_id: F9,
      name: '마바 목공',
      state: 'declined',
      chosen_at: '2026-11-08T02:00:00Z',
      expires_at: '2026-11-09T02:00:00Z',
      responded_at: '2026-11-08T03:00:00Z',
      reason: '이번 달 일정이 꽉 찼습니다', // 서버는 Manager 에게 싣지 않는다 — 실려 와도 그리지 않는다
    },
  ],
  ...extra,
});
const chosenDetail = (id) =>
  detail(id, {
    status: 'chosen',
    label: '팩토리 답 기다림',
    can_choose: false,
    factory: { company_id: F2, name: '다라 가구' },
    recommendations: [
      rec(F1, '가나 공방', { rank: 1 }),
      rec(F2, '다라 가구', {
        rank: 2,
        chosen: true,
        offer: {
          state: 'open',
          chosen_at: '2026-11-09T01:00:00Z',
          expires_at: '2026-11-10T01:00:00Z', // 한국 시간 11-10 10:00 — 22시간 남음
          responded_at: null,
        },
      }),
    ],
  });
const drafts = () =>
  ok({
    items: [
      { id: 'd-kitchen-01', name: '김고객 주방', item: 'sink', walls: 2, modules: 9, rev: 3 },
      {
        id: 'd-closet-02',
        name: '박고객 드레스룸',
        item: 'wardrobe',
        walls: 3,
        modules: 12,
        rev: 1,
      },
    ],
    count: 2,
  });
const companyProjects = () =>
  ok({
    company: { id: CO },
    can_manage: true,
    items: [
      {
        id: P1,
        title: '김고객 주방 리모델링',
        status: 'active',
        customer: { id: 'c1', name: '김고객' },
      },
      { id: P2, title: '끝난 현장', status: 'closed', customer: null },
    ],
  });

/** 팩토리 쪽 한 줄 (워커 factory.js listFactoryRequests) */
const offer = (id, extra = {}) => ({
  id,
  state: 'open',
  manager: { name: '가나 인테리어', region: '대구광역시 수성구' },
  item: 'sink',
  item_label: '싱크대',
  region: '대구광역시 북구',
  wanted_done_date: '2026-12-20',
  note: '상판은 세라믹으로 생각합니다',
  design: { name: '김고객 주방', walls: 2, modules: 9 },
  chosen_at: '2026-11-09T01:00:00Z',
  expires_at: '2026-11-10T01:00:00Z',
  responded_at: null,
  project_id: null,
  draft_id: null,
  can_act: true,
  ...extra,
});

/**
 * me.html 을 올린다. 응답: partner · list() · detail(id) · create(body) · choose(body, id) · cancel(id) ·
 * drafts() · projects() · factory() · accept(id) · decline(body, id)
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    url: '/segan/me.html#production-requests',
    partner: partnerMe(),
    list: () => ok({ ready: true, can_act: true, can_create: true, items: [req(R1)] }),
    detail: (id) => ok(detail(id)),
    create: () => ok(req(R2, { status: 'submitted', label: '접수' }), 201),
    choose: () => ok({ id: R1, status: 'chosen' }),
    cancel: () => ok({ id: R1, status: 'cancelled' }),
    drafts,
    projects: companyProjects,
    factory: () => ok({ ready: true, can_act: true, items: [] }),
    accept: (id) => ok({ request_id: id, customer_id: 'c9', project_id: P2, draft_id: `pr-${id}` }),
    decline: (body, id) => ok({ request_id: id, status: 'declined' }),
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', opts.url);
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
    'SeganProduction',
    'SeganFactoryRequests',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
  delete window.matchMedia;
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
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
    const method = init.method || 'GET';
    const headers = init.headers || {};
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.fetch.push({ url, method, auth: headers.Authorization, body });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    const tail = url.startsWith(WORK) ? url.slice(WORK.length) : '';
    let m;
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (tail === '/production-requests')
      return reply(method === 'POST' ? await opts.create(body) : await opts.list());
    if ((m = /^\/production-requests\/([^/]+)\/choose$/.exec(tail)))
      return reply(await opts.choose(body, m[1]));
    if ((m = /^\/production-requests\/([^/]+)\/cancel$/.exec(tail)))
      return reply(await opts.cancel(m[1]));
    if ((m = /^\/production-requests\/([^/]+)$/.exec(tail))) return reply(await opts.detail(m[1]));
    if (tail === '/factory/production-requests') return reply(await opts.factory());
    if ((m = /^\/factory\/production-requests\/([^/]+)\/accept$/.exec(tail)))
      return reply(await opts.accept(m[1]));
    if ((m = /^\/factory\/production-requests\/([^/]+)\/decline$/.exec(tail)))
      return reply(await opts.decline(body, m[1]));
    if (tail === '/planner/drafts') return reply(await opts.drafts());
    if (tail === '/company/projects') return reply(await opts.projects());
    if (url === PAY + '/subscription') return reply(ok({ plan: 'free', status: 'active' }));
    if (url === PAY + '/plans') return reply(ok({ client_key: 'k', plans: [] }));
    if (tail === '/work/me') return reply(ok({ ready: true, worker: null }));
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
    'segan/production-requests.js',
    'segan/factory-requests.js',
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
async function until(fn) {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('기다린 상태가 오지 않았다');
}
const box = () => $('production-requests');
const fbox = () => $('factory-requests');
const visible = (el) => !!el && !el.hidden && !el.classList.contains('me-off');
const menu = (key) => document.querySelector(`#meHub [data-me-item="${key}"]`);
const sheetEl = () => document.querySelector('.sg-sheet-wrap--sheet');
const dialog = () => document.querySelector('.sg-sheet-wrap--dialog');
const button = (root, label) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label);
const click = async (el) => {
  el.dispatchEvent(new Event('click', { bubbles: true }));
  await flush();
};
const posts = (calls, re) => calls.fetch.filter((f) => f.method === 'POST' && re.test(f.url));
const gets = (calls, pathName) =>
  calls.fetch.filter((f) => f.method === 'GET' && f.url === WORK + pathName);

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름 — 워커와 같은 값', () => {
  test('me.html — 제작 의뢰함은 프로젝트 관리 › 상담, 제작 의뢰는 › 제작 (둘 다 프로젝트 칸 앞), 칸은 업체 칸 안에 감춰 둔다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const keys = [...doc.querySelectorAll('#meSubProject > li[data-me-item]')].map((li) =>
      li.getAttribute('data-me-item')
    );
    expect(keys).toEqual([
      'p-consult',
      'p-design',
      'p-quote',
      'p-contract',
      'p-make',
      'p-install',
      'p-as',
    ]);
    const parts = [...doc.getElementById('partner').children].map((el) => el.id);
    const partAt = (id) => parts.findIndex((x) => x === id);
    for (const id of ['production-requests', 'factory-requests']) {
      const el = doc.getElementById(id);
      expect(el.hasAttribute('hidden')).toBe(true);
      expect(el.closest('section').id).toBe('partner');
      expect(partAt(id)).toBeLessThan(partAt('partnerProjects'));
    }
    const srcs = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    const at = (name) => srcs.findIndex((s) => s.startsWith(name + '?v='));
    for (const f of ['production-requests.js', 'factory-requests.js']) {
      expect(at(f)).toBeGreaterThan(at('partner-projects.js'));
      expect(at(f)).toBeLessThan(at('me.js'));
      expect(read('segan/sw.js')).toContain(`versioned(SCOPE + '${f}')`);
    }
  });

  test('한도 · 상태 이름 · 등급 · 24시간 · 알림 주소 = 워커 production-requests · distribution · push', async () => {
    await load();
    const P = window.SeganProduction;
    const F = window.SeganFactoryRequests;
    const common = read('workers/workflow-api/src/production-requests/common.js');
    const rules = read('workers/workflow-api/src/distribution/rules.js');
    const push = read('workers/workflow-api/src/push/messages.js');
    expect(common).toContain(`export const NOTE_MAX = ${P.NOTE_MAX};`);
    expect(common).toContain(`export const REASON_MAX = ${F.REASON_MAX};`);
    const list = (a) => '[' + a.map((x) => `'${x}'`).join(', ') + ']';
    expect(common).toContain(`REQUEST_PLANS = Object.freeze(${list(P.PLANS)});`);
    expect(rules).toContain(`export const ASSIGNMENT_TTL_HOURS = ${P.OFFER_TTL_HOURS};`);
    expect(F.OFFER_TTL_HOURS).toBe(P.OFFER_TTL_HOURS);
    expect(rules).toContain(`POOL_PLANS = Object.freeze(${list(F.POOL_PLANS)});`);
    for (const [k, v] of Object.entries(P.STATUS_LABEL))
      expect(common).toContain(`  ${k}: '${v}',`);
    expect(Object.keys(P.STATUS_LABEL)).toEqual([
      'submitted',
      'recommending',
      'recommended',
      'chosen',
      'accepted',
      'declined',
      'expired',
      'cancelled',
    ]);
    expect(push).toContain(`PRODUCTION_REQUESTS_URL = '/segan/me.html${P.HASH}';`);
    expect(push).toContain(`FACTORY_REQUESTS_URL = '/segan/me.html${F.HASH}';`);
    expect(read('workers/workflow-api/src/planner-drafts.js')).toContain(
      'export const DRAFT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{3,80}$/;'
    );
    // 품목 이름 = 워커 consult-notify.js FURNITURE_LABELS
    const notify = read('workers/workflow-api/src/consult-notify.js');
    for (const [k, v] of Object.entries(P.ITEMS)) expect(notify).toContain(`  ${k}: '${v}',`);
  });
});

describe('누가 보나 — 등급(company.plan)으로, 직책(role)과 견주지 않는다', () => {
  test('Manager 등급 업체 대표 — 프로젝트 관리 › 제작에 「제작 의뢰」, 목록 · 「제작 의뢰」 단추, 제작 의뢰함은 없다', async () => {
    const calls = await load();
    expect(visible(menu('p-make'))).toBe(true);
    expect(menu('p-make').querySelector('a').getAttribute('aria-current')).toBe('page'); // 옛 주소 → 그 하위 줄
    expect(fbox().hidden).toBe(true);
    expect(visible(box())).toBe(true);
    expect($('meTitle').textContent).toBe('제작 의뢰');
    expect(box().querySelector('[data-act="new"]').textContent).toBe('제작 의뢰');
    expect(gets(calls, '/factory/production-requests')).toHaveLength(0);
    expect(calls.fetch.find((f) => f.url === WORK + '/production-requests').auth).toBe(
      'Bearer tok-1'
    );
  });

  test('Manager 등급 업체 직원 — 목록만 (서버 can_create · can_act false), 「대표 · 실장이 합니다」', async () => {
    await load({
      partner: partnerMe({ role: 'staff' }),
      list: () =>
        ok({
          ready: true,
          can_act: false,
          can_create: false,
          items: [req(R1, { can_cancel: false, can_choose: false })],
        }),
      detail: (id) => ok(detail(id, { can_cancel: false, can_choose: false })),
    });
    expect(visible(box())).toBe(true);
    expect(box().querySelector('[data-act="new"]')).toBeNull();
    expect(box().querySelector('.mk-note').textContent).toContain(
      '의뢰 · 고르기 · 거두기는 대표 · 실장이 합니다.'
    );
    await click(box().querySelector('[data-act="pick"]'));
    await until(() => box().querySelector('.me-prq-detail'));
    expect(box().querySelector('[data-act="choose"]')).toBeNull();
    expect(box().querySelector('[data-act="cancel"]')).toBeNull();
  });

  test('Expert 등급 업체의 실장(role manager) — 제작 의뢰는 묻지 않고, 제작 의뢰함만', async () => {
    const calls = await load({
      url: '/segan/me.html#factory-requests',
      partner: partnerMe({ plan: 'expert', role: 'manager' }),
    });
    expect(gets(calls, '/production-requests')).toHaveLength(0);
    expect(visible(menu('p-consult'))).toBe(true);
    expect(menu('p-consult').querySelector('a').getAttribute('aria-current')).toBe('page');
    expect(visible(fbox())).toBe(true);
    expect(fbox().textContent).toContain('아직 온 제작 의뢰가 없습니다.');
  });

  test('다담 공장 구성원 — 제작 의뢰함, 그린 뒤 업체 칸을 연다', async () => {
    await load({ url: '/segan/me.html#factory-requests', partner: HQ });
    expect($('partner').hidden).toBe(false);
    expect(visible(fbox())).toBe(true);
    expect(visible(menu('p-consult'))).toBe(true);
  });

  test('DB 0050 전(ready false) · 403 — 칸째 감춘다, 메뉴 줄도 없다', async () => {
    await load({ list: () => ok({ ready: false, can_act: true, can_create: true, items: [] }) });
    expect(box().hidden).toBe(true);
    expect($('mePaneNote').textContent).toBe('볼 수 있는 내용이 없습니다.');
    await load({ list: () => fail(403, 'not_member', 'x') });
    expect(box().hidden).toBe(true);
  });
});

describe('Manager — 목록 · 단계 · 추천 카드', () => {
  test('줄 — 품목 · 설계 이름 · 현장 지역 · 의뢰일 · 상태, 추천 도착이면 「추천 3곳 — 골라 주세요」', async () => {
    await load();
    const item = box().querySelector(`[data-request="${R1}"]`);
    expect(item.querySelector('.me-c-main b').textContent).toBe('싱크대 · 김고객 주방');
    expect(item.querySelector('.me-c-main small').textContent).toBe(
      '대구광역시 북구 · 의뢰 2026.11.08'
    );
    expect(item.querySelector('.me-badge').textContent).toBe('추천 도착');
    expect(item.textContent).toContain('추천 3곳 — 골라 주세요');
  });

  test('누르면 그 자리에 — 단계(지금 칸) · 의뢰 내용 · 본사 말 · 추천 카드 · 고른 기록, 못 받은 사유는 없다', async () => {
    const calls = await load();
    await click(box().querySelector(`[data-act="pick"][data-id="${R1}"]`));
    await until(() => box().querySelector('.me-prq-detail'));
    expect(gets(calls, `/production-requests/${R1}`).length).toBeGreaterThan(0);
    const d = box().querySelector('.me-prq-detail');
    const steps = [...d.querySelectorAll('.me-step')];
    expect(steps.map((s) => s.textContent)).toEqual([
      '접수',
      '본사 검토',
      '추천 도착',
      '팩토리 답 기다림',
      '받음',
    ]);
    expect(d.querySelector('[aria-current="step"]').textContent).toBe('추천 도착');
    expect(steps.filter((s) => s.classList.contains('me-step--done'))).toHaveLength(3);
    expect(d.textContent).toContain('김고객 주방 · 벽 2 · 모듈 9');
    expect(d.textContent).toContain('김고객 주방 리모델링');
    expect(d.textContent).toContain('2026.12.20 시공 완료');
    expect(d.textContent).toContain('세 곳 모두 대구 근처입니다.');
    const cards = [...d.querySelectorAll('.me-prq-rec')];
    expect(cards.map((c) => c.querySelector('.me-prq-rec-head').textContent)).toEqual([
      '가나 공방팩토리 · 대구광역시 북구',
      '다라 가구팩토리 · 경상북도 경산시',
      '다담 공장다담 공장',
    ]);
    expect(cards[0].textContent).toContain('싱크대 · 붙박이장');
    expect(cards[0].textContent).toContain('세라믹 상판 경험이 많습니다');
    // 품목 · 지역이 다르면 확인 한 줄 — 막지 않는다 (고르기 단추는 그대로)
    expect([...cards[1].querySelectorAll('[data-hint]')].map((h) => h.textContent)).toEqual([
      '품목 확인 — 하는 품목에 「싱크대」 없음',
      '지역 확인 — 현장 대구광역시 북구 · 팩토리 경상북도 경산시',
    ]);
    expect(cards[0].querySelectorAll('[data-hint]')).toHaveLength(0);
    expect(cards[2].querySelectorAll('[data-hint]')).toHaveLength(0); // 하는 품목 · 지역을 모르면 적지 않는다
    expect(cards.every((c) => c.querySelector('[data-act="choose"]'))).toBe(true);
    // 본사가 적은 예상 가격대 · 제작 기간 — 이름 줄 바로 아래 한 줄, 적은 값만, 칸이 없는 응답은 그 줄이 없다
    expect(
      cards.map((c) => {
        const el = c.querySelector('[data-estimate]');
        return el ? el.textContent : null;
      })
    ).toEqual(['가격대 1,200만~1,500만 원 · 제작 기간 약 20일', '가격대 1,500만 원까지', null]);
    expect(
      cards[0].querySelector('.me-prq-rec-head').nextElementSibling.hasAttribute('data-estimate')
    ).toBe(true);
    expect(cards[2].textContent).not.toMatch(/가격대|제작 기간/);
    // 고른 기록 — 차례 · 이름 · 답, 사유 없음 (본사만 본다)
    expect(d.querySelector('[data-offers]').textContent).toBe(
      '1차 마바 목공 · 못 받음 · 고름 2026.11.08 11:00 · 답 2026.11.08 12:00'
    );
    expect(document.body.textContent).not.toContain('이번 달 일정이 꽉 찼습니다');
  });

  test('예상 가격대 · 제작 기간 한 줄 (순수) — 적은 값만 · 한쪽만이면 그 끝만 · 만 원으로 떨어지면 「만 원」, 본사 화면과 같은 글', async () => {
    await load();
    const P = window.SeganProduction;
    const cases = [
      [
        { price_min: 12000000, price_max: 15000000, lead_days: 20 },
        '가격대 1,200만~1,500만 원 · 제작 기간 약 20일',
      ],
      [{ price_min: 12000000, price_max: null, lead_days: null }, '가격대 1,200만 원부터'],
      [{ price_max: 15000000 }, '가격대 1,500만 원까지'],
      [{ lead_days: 20 }, '제작 기간 약 20일'],
      [
        { price_min: 15000000, price_max: 15000000, lead_days: 1 },
        '가격대 1,500만 원 · 제작 기간 약 1일',
      ],
      [{ price_min: 0, price_max: 120000000 }, '가격대 0~12,000만 원'],
      [{ price_min: 0 }, '가격대 0원부터'],
      [{ price_min: 12345678, price_max: 13000000 }, '가격대 12,345,678~1,300만 원'],
      [{ price_max: 12345678 }, '가격대 12,345,678원까지'],
      [{}, ''],
      [{ price_min: null, price_max: null, lead_days: null }, ''],
      // 모양이 틀린 값은 적지 않은 것으로 (서버는 이런 값을 주지 않는다)
      [{ price_min: -1, price_max: '15000000', lead_days: 0 }, ''],
      [{ price_min: 1.5, lead_days: 2.5 }, ''],
    ];
    for (const [f, want] of cases) expect([f, P.estimateText(f)]).toEqual([f, want]);
    // 본사 「관리 › 제작 의뢰」(segan/admin-production.js) 줄에도 같은 글
    delete window.SeganAdminProduction;
    (0, eval)(read('segan/admin-production.js'));
    for (const [f, want] of cases)
      expect([f, window.SeganAdminProduction.estimateText(f)]).toEqual([f, want]);
  });

  test('못 받음 · 답 없음 — 본사 검토 칸으로, 사유 없이 「본사가 다시 추천합니다」, 지난 추천 카드는 감춘다', async () => {
    await load({
      list: () =>
        ok({
          ready: true,
          can_act: true,
          can_create: true,
          items: [req(R1, { status: 'declined', label: '팩토리가 못 받음', can_choose: false })],
        }),
      detail: (id) =>
        ok(detail(id, { status: 'declined', label: '팩토리가 못 받음', can_choose: false })),
    });
    await click(box().querySelector('[data-act="pick"]'));
    await until(() => box().querySelector('.me-prq-detail'));
    const d = box().querySelector('.me-prq-detail');
    expect(d.querySelector('[aria-current="step"]').textContent).toBe('본사 검토');
    expect(d.querySelector('[data-status-note]').textContent).toBe(
      '고른 팩토리가 받지 못했습니다. 본사가 다시 추천합니다.'
    );
    expect(d.querySelectorAll('.me-prq-rec')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('이번 달 일정이 꽉 찼습니다');
  });

  test('답 기다림 — 펼치지 않아도 줄 위에 답 기한 · 남은 시간 (목록 줄의 expires_at, 더 읽지 않는다), 고른 카드는 「고름 · 답 기다림」', async () => {
    const calls = await load({
      list: () =>
        ok({
          ready: true,
          can_act: true,
          can_create: true,
          items: [
            req(R1, {
              status: 'chosen',
              label: '팩토리 답 기다림',
              can_choose: false,
              factory: { company_id: F2, name: '다라 가구' },
              expires_at: '2026-11-10T01:00:00Z', // 한국 시간 11-10 10:00 — 22시간 남음
            }),
          ],
        }),
      detail: (id) => ok(chosenDetail(id)),
    });
    expect(gets(calls, `/production-requests/${R1}`)).toHaveLength(0); // 목록이 기한을 준다
    const item = box().querySelector(`[data-request="${R1}"]`);
    expect(item.textContent).toContain('「다라 가구」 답 기다림');
    expect(item.querySelector('[data-expires]').textContent).toBe(
      '답 기한 2026.11.10 10:00 · 남은 시간 22시간'
    );
    await click(item.querySelector('[data-act="pick"]'));
    await until(() => box().querySelector('.me-prq-detail [data-offer]'));
    expect(box().querySelector('.me-prq-detail [aria-current="step"]').textContent).toBe(
      '팩토리 답 기다림'
    );
    expect(box().querySelector('.me-prq-detail [data-offer]').textContent).toBe('고름 · 답 기다림');
    expect(box().querySelectorAll('[data-expires]')).toHaveLength(1); // 기한은 한 번만
  });
});

describe('Manager — 고르기 · 거두기 (가운데 창)', () => {
  test('「이 팩토리에 맡기기」 → 창으로 묻고 → POST choose { company_id } → 닫고 다시 읽는다', async () => {
    let state = 'recommended';
    const calls = await load({
      list: () =>
        ok({
          ready: true,
          can_act: true,
          can_create: true,
          items: [
            state === 'recommended'
              ? req(R1)
              : req(R1, {
                  status: 'chosen',
                  label: '팩토리 답 기다림',
                  can_choose: false,
                  factory: { company_id: F2, name: '다라 가구' },
                }),
          ],
        }),
      detail: (id) => ok(state === 'recommended' ? detail(id) : chosenDetail(id)),
      choose: () => {
        state = 'chosen';
        return ok({ id: R1, status: 'chosen' });
      },
    });
    await click(box().querySelector('[data-act="pick"]'));
    await until(() => box().querySelector('[data-act="choose"]'));
    const open = jest.spyOn(window.SeganShell.sheet, 'open');
    await click(box().querySelector(`[data-act="choose"][data-company="${F2}"]`));
    expect(open.mock.calls[0][0]).toMatchObject({ kind: 'dialog', title: '팩토리 고르기' });
    expect(dialog().textContent).toContain('「다라 가구」에 제작을 맡길까요?');
    expect(dialog().textContent).toContain('24시간 안에 받기 · 못 받음을 답합니다');
    // 그대로 두기 — 아무것도 보내지 않는다
    button(dialog(), '그대로 두기').click();
    await until(() => !dialog());
    expect(posts(calls, /\/choose$/)).toHaveLength(0);
    await click(box().querySelector(`[data-act="choose"][data-company="${F2}"]`));
    button(dialog(), '맡기기').click();
    await until(() => !dialog() && box().querySelector('[data-expires]'));
    expect(posts(calls, /\/choose$/).map((f) => [f.url, f.body])).toEqual([
      [WORK + `/production-requests/${R1}/choose`, { company_id: F2 }],
    ]);
    expect(box().textContent).toContain(
      '「다라 가구」에 맡겼습니다. 팩토리가 24시간 안에 답합니다.'
    );
    expect(box().querySelector('.me-badge').textContent).toBe('팩토리 답 기다림');
  });

  test('고르지 못하면(서버 422) 창 안에 서버 글, 창은 그대로', async () => {
    await load({
      choose: () => fail(422, 'not_eligible', '이 팩토리는 지금 의뢰를 받을 수 없습니다'),
    });
    await click(box().querySelector('[data-act="pick"]'));
    await until(() => box().querySelector('[data-act="choose"]'));
    await click(box().querySelector(`[data-act="choose"][data-company="${F1}"]`));
    button(dialog(), '맡기기').click();
    await until(() => !dialog().querySelector('[data-err]').hidden);
    expect(dialog().querySelector('[data-err]').textContent).toBe(
      '이 팩토리는 지금 의뢰를 받을 수 없습니다'
    );
    expect(button(dialog(), '맡기기').disabled).toBe(false);
  });

  test('「의뢰 거두기」 → 창 (답 기다림이면 팩토리 의뢰도 닫힌다는 글, 알렸다고 적지 않는다) → POST cancel', async () => {
    let gone = false;
    const calls = await load({
      list: () =>
        ok({
          ready: true,
          can_act: true,
          can_create: true,
          items: [
            gone
              ? req(R1, {
                  status: 'cancelled',
                  label: '거둠',
                  can_cancel: false,
                  can_choose: false,
                })
              : req(R1, { status: 'chosen', label: '팩토리 답 기다림', can_choose: false }),
          ],
        }),
      detail: (id) =>
        ok(
          gone
            ? detail(id, {
                status: 'cancelled',
                label: '거둠',
                can_cancel: false,
                can_choose: false,
              })
            : chosenDetail(id)
        ),
      cancel: () => {
        gone = true;
        return ok({ id: R1, status: 'cancelled' });
      },
    });
    await click(box().querySelector('[data-act="pick"]'));
    await until(() => box().querySelector('[data-act="cancel"]'));
    await click(box().querySelector('[data-act="cancel"]'));
    expect(dialog().querySelector('.sg-sheet-title').textContent).toBe('제작 의뢰 거두기');
    expect(dialog().textContent).toContain(
      '이 제작 의뢰를 거둘까요? 거둔 뒤 같은 설계로 다시 의뢰할 수 있습니다. 답을 기다리던 팩토리의 의뢰도 닫힙니다.'
    );
    expect(dialog().textContent).not.toMatch(/알림|알렸/);
    button(dialog(), '거두기').click();
    await until(() => !dialog() && box().querySelector('.me-cs-item--off'));
    expect(posts(calls, /\/cancel$/).map((f) => f.url)).toEqual([
      WORK + `/production-requests/${R1}/cancel`,
    ]);
    expect(box().textContent).toContain('제작 의뢰를 거뒀습니다.');
    expect(box().querySelector('[data-act="cancel"]')).toBeNull();
    expect(box().querySelector('.me-prq-detail [aria-current="step"]')).toBeNull(); // 거둠은 단계 칸이 없다
  });
});

describe('Manager — 「제작 의뢰」 시트', () => {
  const openSheet = async () => {
    await click(box().querySelector('[data-act="new"]'));
    await until(() => sheetEl());
    return sheetEl().querySelector('form[data-form="production"]');
  };
  const submit = async (form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  };

  test('설계 · 프로젝트를 읽어 시트로 — 현장 지역은 팩토리 주소, 열린 의뢰가 걸린 설계는 「의뢰 중」, 사진은 보내지 않는다', async () => {
    const calls = await load();
    const open = jest.spyOn(window.SeganShell.sheet, 'open');
    const form = await openSheet();
    expect(open.mock.calls[0][0]).toMatchObject({ kind: 'sheet', title: '제작 의뢰' });
    expect(gets(calls, '/planner/drafts')).toHaveLength(1);
    const opts = [...form.querySelectorAll('select[name="draft_id"] option')].map((o) => [
      o.value,
      o.textContent,
      o.disabled,
    ]);
    expect(opts).toEqual([
      ['', '설계 고르기', false],
      ['d-kitchen-01', '김고객 주방 · 싱크대 · 벽 2 · 모듈 9 (의뢰 중)', true],
      ['d-closet-02', '박고객 드레스룸 · 붙박이장 · 벽 3 · 모듈 12', false],
    ]);
    // 진행 중 프로젝트만
    expect(
      [...form.querySelectorAll('select[name="project_id"] option')].map((o) => o.value)
    ).toEqual(['', P1]);
    expect(form.querySelector('select[name="sido"]').value).toBe('대구광역시');
    expect(form.querySelector('select[name="gugun"]').value).toBe('북구');
    expect(form.querySelector('[data-region-note]').textContent).toBe(
      '팩토리 주소로 채웠습니다. 현장이 다르면 바꿔 주세요.'
    );
    expect(form.querySelector('[data-photo-note]').textContent).toBe(
      '고른 플래너 설계는 팩토리가 받을 때 사본으로 넘어갑니다. 현장 사진은 보내지 않습니다.'
    );
    expect(form.querySelector('textarea[name="note"]').getAttribute('maxlength')).toBe('1000');
  });

  test('설계를 고르지 않으면 보내지 않는다 → 고르면 POST — 지역 · 날짜 · 메모 · 프로젝트, 닫고 새 의뢰를 펼친다', async () => {
    let made = false;
    const calls = await load({
      list: () =>
        ok({
          ready: true,
          can_act: true,
          can_create: true,
          items: made
            ? [
                req(R2, {
                  status: 'submitted',
                  label: '접수',
                  round: 0,
                  recommendation_count: 0,
                  can_choose: false,
                }),
                req(R1),
              ]
            : [req(R1)],
        }),
      detail: (id) =>
        ok(
          id === R2
            ? detail(R2, {
                status: 'submitted',
                label: '접수',
                round: 0,
                recommendations: [],
                offers: [],
                hq_note: null,
                can_choose: false,
              })
            : detail(id)
        ),
      create: () => {
        made = true;
        return ok(req(R2, { status: 'submitted', label: '접수' }), 201);
      },
    });
    const form = await openSheet();
    await submit(form);
    expect(form.querySelector('[data-err]').textContent).toBe('의뢰할 설계를 골라 주세요.');
    expect(posts(calls, /\/production-requests$/)).toHaveLength(0);
    form.querySelector('select[name="draft_id"]').value = 'd-closet-02';
    form.querySelector('select[name="project_id"]').value = P1;
    form.querySelector('select[name="sido"]').value = '경상북도';
    form.querySelector('select[name="sido"]').dispatchEvent(new Event('change', { bubbles: true }));
    expect(form.querySelector('select[name="gugun"]').value).toBe('');
    form.querySelector('select[name="gugun"]').value = '경산시';
    form.querySelector('input[name="wanted_done_date"]').value = '2027-01-15';
    form.querySelector('textarea[name="note"]').value = '  드레스룸 거울 문  ';
    await submit(form);
    await until(() => !sheetEl() && box().querySelector('.me-prq-detail'));
    expect(posts(calls, /\/production-requests$/).map((f) => f.body)).toEqual([
      {
        draft_id: 'd-closet-02',
        project_id: P1,
        sido: '경상북도',
        gugun: '경산시',
        wanted_done_date: '2027-01-15',
        note: '드레스룸 거울 문',
      },
    ]);
    expect(box().textContent).toContain(
      '제작 의뢰를 보냈습니다. 본사가 검토해 팩토리를 추천합니다.'
    );
    expect(
      box().querySelector(`[data-act="pick"][data-id="${R2}"]`).getAttribute('aria-expanded')
    ).toBe('true');
    expect(box().querySelector('.me-prq-detail [aria-current="step"]').textContent).toBe('접수');
  });

  test('서버가 막으면(409 열린 의뢰) 시트 안에 서버 글 · 그 칸을 짚는다, 시트는 그대로', async () => {
    await load({
      create: () => fail(409, 'open_request', '이 설계로 이미 열린 제작 의뢰가 있습니다'),
    });
    const form = await openSheet();
    form.querySelector('select[name="draft_id"]').value = 'd-closet-02';
    await submit(form);
    await until(() => !form.querySelector('[data-err]').hidden);
    expect(form.querySelector('[data-err]').textContent).toBe(
      '이 설계로 이미 열린 제작 의뢰가 있습니다'
    );
    expect(form.querySelector('select[name="draft_id"]').getAttribute('aria-invalid')).toBe('true');
    expect(sheetEl()).not.toBeNull();
    expect(form.querySelector('button[type="submit"]').disabled).toBe(false);
  });

  test('저장한 설계가 없으면 안내만 (보내기 단추 없음), 설계를 못 읽으면 시트를 열지 않고 한 줄', async () => {
    await load({ drafts: () => ok({ items: [], count: 0 }) });
    let form = await openSheet();
    expect(form.textContent).toContain(
      '저장한 플래너 설계가 없습니다. 설계(플래너)에서 먼저 저장해 주세요.'
    );
    expect(form.querySelector('button[type="submit"]')).toBeNull();
    await load({ drafts: () => fail(403, 'not_member', 'x') });
    await click(box().querySelector('[data-act="new"]'));
    await until(() => box().textContent.includes('플래너 설계를 불러오지 못했습니다.'));
    expect(sheetEl()).toBeNull();
  });

  test('본문 검사 (순수) — 서버와 같은 규칙', async () => {
    await load();
    const P = window.SeganProduction;
    expect(P.bodyOf({ draft_id: '' })).toEqual({
      error: '의뢰할 설계를 골라 주세요.',
      field: 'draft_id',
    });
    expect(P.bodyOf({ draft_id: 'd-1' }).field).toBe('draft_id'); // 4자 미만
    expect(P.bodyOf({ draft_id: 'd-closet-02' }, { 'd-closet-02': true }).error).toBe(
      '이 설계로 이미 열린 제작 의뢰가 있습니다.'
    );
    expect(P.bodyOf({ draft_id: 'd-closet-02', gugun: '북구' }).field).toBe('sido');
    expect(P.bodyOf({ draft_id: 'd-closet-02', wanted_done_date: '2027/01/15' }).field).toBe(
      'wanted_done_date'
    );
    expect(P.bodyOf({ draft_id: 'd-closet-02', note: '가'.repeat(1001) }).field).toBe('note');
    expect(P.bodyOf({ draft_id: 'd-closet-02', note: '가'.repeat(1000) }).body.note).toHaveLength(
      1000
    );
    expect(P.bodyOf({ draft_id: 'd-closet-02', project_id: '', sido: '', note: ' ' })).toEqual({
      body: { draft_id: 'd-closet-02' },
    });
    expect(
      P.busyDrafts([
        req(R1),
        req(R2, { status: 'accepted', draft: { id: 'd-x-9' } }),
        req(R2, { status: 'cancelled', draft: { id: 'd-y-9' } }),
      ])
    ).toEqual({
      'd-kitchen-01': true,
    });
    expect(P.stepIndex('cancelled')).toBe(-1);
    expect(
      P.hintsOf({ item_label: '싱크대', sido: '대구광역시' }, { items: [], region: '' })
    ).toEqual([]);
  });
});

describe('팩토리 — 제작 의뢰함', () => {
  const factoryOf =
    (items, can_act = true) =>
    () =>
      ok({ ready: true, can_act, items });
  const loadF = (extra = {}) =>
    load({
      url: '/segan/me.html#factory-requests',
      partner: partnerMe({ plan: 'agent' }),
      ...extra,
    });

  test('답할 의뢰가 먼저 — 업체 · 품목 · 지역 · 고른 때 · 답 기한 · 남은 시간 · 의뢰 내용, 받기 · 못 받음', async () => {
    const O2 = '55555555-5555-4555-8555-555555555552';
    await loadF({
      factory: factoryOf([
        offer('55555555-5555-4555-8555-555555555551', {
          state: 'declined',
          note: null,
          design: null,
          can_act: false,
          responded_at: '2026-11-08T03:00:00Z',
        }),
        offer(O2),
      ]),
    });
    expect($('meTitle').textContent).toBe('제작 의뢰함');
    const rows = [...fbox().querySelectorAll('[data-offer]')];
    expect(rows.map((r) => r.getAttribute('data-offer'))).toEqual([
      O2,
      '55555555-5555-4555-8555-555555555551',
    ]);
    const first = rows[0];
    expect(first.querySelector('.me-c-main b').textContent).toBe('가나 인테리어 · 싱크대');
    expect(first.querySelector('.me-c-main small').textContent).toBe(
      '대구광역시 북구 · 고름 2026.11.09 10:00'
    );
    expect(first.querySelector('.me-badge').textContent).toBe('새 의뢰');
    expect(first.querySelector('[data-expires]').textContent).toBe(
      '답 기한 2026.11.10 10:00 · 남은 시간 22시간'
    );
    expect(first.textContent).toContain('김고객 주방 · 벽 2 · 모듈 9');
    expect(first.textContent).toContain('상판은 세라믹으로 생각합니다');
    expect([...first.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      '받기',
      '못 받음',
    ]);
    expect(fbox().querySelector('.me-prq-past').textContent).toBe('지난 의뢰');
    expect(rows[1].classList.contains('me-cs-item--off')).toBe(true);
    expect(rows[1].querySelectorAll('button')).toHaveLength(0);
  });

  test('직원 — 단추 없이 「받기 · 못 받음은 대표 · 실장이 합니다」', async () => {
    await loadF({
      partner: partnerMe({ plan: 'agent', role: 'staff' }),
      factory: factoryOf([offer(R1, { can_act: false })], false),
    });
    expect(fbox().querySelectorAll('button')).toHaveLength(0);
    expect(fbox().querySelector('.mk-note').textContent).toContain(
      '받기 · 못 받음은 대표 · 실장이 합니다.'
    );
  });

  test('기한이 지났는데 아직 답 기다림(cron 전) — 「시간 지남」, 단추 없음', async () => {
    await loadF({ factory: factoryOf([offer(R1, { expires_at: '2026-11-09T02:59:00Z' })]) });
    const row = fbox().querySelector('[data-offer]');
    expect(row.querySelector('.me-badge').textContent).toBe('시간 지남');
    expect(row.textContent).toContain('답할 시간(24시간)이 지났습니다. 본사가 다시 추천합니다.');
    expect(row.querySelectorAll('button')).toHaveLength(0);
  });

  test('받기 → POST accept → 「프로젝트와 플래너 설계 사본을 만들었습니다」, 프로젝트 칸도 다시 읽는다', async () => {
    let accepted = false;
    const calls = await loadF({
      factory: () =>
        factoryOf([
          accepted
            ? offer(R1, {
                state: 'accepted',
                can_act: false,
                project_id: P2,
                draft_id: `pr-${R1}`,
                responded_at: '2026-11-09T03:00:00Z',
              })
            : offer(R1),
        ])(),
      accept: (id) => {
        accepted = true;
        return ok({ request_id: id, customer_id: 'c9', project_id: P2, draft_id: `pr-${id}` });
      },
    });
    const before = gets(calls, '/company/projects').length;
    await click(button(fbox(), '받기'));
    await until(() =>
      fbox().textContent.includes('받았습니다. 프로젝트와 플래너 설계 사본을 만들었습니다.')
    );
    expect(posts(calls, /\/accept$/).map((f) => f.url)).toEqual([
      WORK + `/factory/production-requests/${R1}/accept`,
    ]);
    const row = fbox().querySelector('[data-offer]');
    expect(row.querySelector('.me-badge').textContent).toBe('받음');
    expect(row.querySelector('a[href="#partner-projects"]').textContent).toBe('프로젝트 보기');
    expect(row.querySelector('[data-act="copy"]')).toBeNull();
    await until(() => gets(calls, '/company/projects').length > before);
  });

  test('받은 의뢰에 설계 사본이 빠졌으면 「설계 사본 다시 만들기」 → 같은 받기를 다시 보낸다', async () => {
    const calls = await loadF({
      factory: factoryOf([
        offer(R1, { state: 'accepted', can_act: false, project_id: P2, draft_id: null }),
      ]),
    });
    const row = fbox().querySelector('[data-offer]');
    expect(row.textContent).toContain('설계 사본이 아직 없습니다.');
    await click(row.querySelector('[data-act="copy"]'));
    await until(() => posts(calls, /\/accept$/).length === 1);
    await until(() => fbox().textContent.includes('설계 사본을 만들었습니다.'));
  });

  test('못 받음 — 그 자리에 사유 칸(적지 않아도 됨 · 본사만 봄), 빈 칸은 사유 없이, 500자 넘으면 보내지 않는다', async () => {
    let gone = false;
    const sent = [];
    const calls = await loadF({
      factory: () =>
        factoryOf([
          gone
            ? offer(R1, { state: 'declined', can_act: false, note: null, design: null })
            : offer(R1),
        ])(),
      decline: (body, id) => {
        sent.push(body);
        gone = true;
        return ok({ request_id: id, status: 'declined' });
      },
    });
    await click(button(fbox(), '못 받음'));
    const form = fbox().querySelector('[data-form="decline"]');
    expect(form.querySelector('label span').textContent).toBe('못 받는 사유 (적지 않아도 됩니다)');
    expect(form.querySelector('[data-reason-note]').textContent).toBe(
      '사유는 다담 본사만 봅니다. 의뢰한 업체에는 보이지 않습니다.'
    );
    form.querySelector('textarea').value = '가'.repeat(501);
    await click(button(form, '못 받음 보내기'));
    expect(form.querySelector('[data-err]').textContent).toBe('사유는 500자까지 적을 수 있습니다.');
    expect(posts(calls, /\/decline$/)).toHaveLength(0);
    form.querySelector('textarea').value = '   ';
    await click(button(form, '못 받음 보내기'));
    await until(() => fbox().textContent.includes('못 받음으로 돌려보냈습니다.'));
    expect(sent).toEqual([{}]);
    expect(fbox().querySelector('.me-badge').textContent).toBe('못 받음');
  });

  test('못 받음 사유 — 적으면 { reason } 으로, 그사이 거둬졌으면(409) 그 줄에 서버 글', async () => {
    const sent = [];
    await loadF({
      factory: factoryOf([offer(R1)]),
      decline: (body) => {
        sent.push(body);
        return fail(409, 'not_open', '이미 답했거나 거둬진 의뢰입니다');
      },
    });
    await click(button(fbox(), '못 받음'));
    fbox().querySelector('[data-form="decline"] textarea').value = ' 이번 달 일정이 꽉 찼습니다 ';
    await click(button(fbox(), '못 받음 보내기'));
    await until(() => fbox().textContent.includes('이미 답했거나 거둬진 의뢰입니다'));
    expect(sent).toEqual([{ reason: '이번 달 일정이 꽉 찼습니다' }]);
    expect(fbox().querySelector('[data-form="decline"]')).toBeNull();
  });

  test('거둔 의뢰 — 「의뢰한 업체가 거둔 의뢰입니다」, 의뢰 내용 없이 흐리게', async () => {
    await loadF({
      factory: factoryOf([
        offer(R1, { state: 'cancelled', can_act: false, note: null, design: null }),
      ]),
    });
    const row = fbox().querySelector('[data-offer]');
    expect(row.querySelector('.me-badge').textContent).toBe('거둠');
    expect(row.textContent).toContain('의뢰한 업체가 거둔 의뢰입니다.');
    expect(row.classList.contains('me-cs-item--off')).toBe(true);
  });

  test('본문 검사 (순수)', async () => {
    await loadF();
    const F = window.SeganFactoryRequests;
    expect(F.declineBodyOf('')).toEqual({ body: {} });
    expect(F.declineBodyOf(' 사유 ')).toEqual({ body: { reason: '사유' } });
    expect(F.declineBodyOf('가'.repeat(501)).error).toBeTruthy();
    expect(F.isOpen(offer(R1), NOW)).toBe(true);
    expect(F.isOpen(offer(R1, { expires_at: '2026-11-09T03:00:00Z' }), NOW)).toBe(false);
    expect(F.leftText('2026-11-09T03:30:00Z', NOW)).toBe('남은 시간 30분');
    expect(F.leftText('2026-11-09T05:15:00Z', NOW)).toBe('남은 시간 2시간 15분');
    expect(F.listOf({ success: true, data: { ready: false, items: [] } })).toBeNull();
    expect(F.canSee({ company: company({ plan: 'manager', role: 'manager' }) })).toBe(false);
    expect(F.canSee({ company: company({ plan: 'expert', role: 'staff' }) })).toBe(true);
  });
});
