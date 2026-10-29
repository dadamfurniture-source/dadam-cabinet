/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Element, URL */
/**
 * SEGAN 「내 정보 › 업체」 안의 상담 · 상담 설정 · 내 평가 (segan/partner-consults.js + segan/me.html)
 *
 *   누가    Agent 협력업체 구성원 (account-api GET /partner/me 의 company). 목록은 구성원 모두,
 *           받기 · 못 받음 · 내 평가 · 상담 설정은 대표 · 실장. 정지된 업체는 읽기만.
 *           직원은 목록만 · Expert · 업체 없음 · 본사 구성원 · /partner/me 를 못 읽음 → 묻지도 않고 칸이 없다
 *   데이터  workflow-api GET /company/consults · POST …/accept · …/decline { reason } ·
 *           GET/PUT /company/service-settings · GET /company/my-score (본인 토큰, { success, data })
 *   못 읽음 403 · 404 · 오류 · 끊김 · 모양이 틀림 → 그 칸째 감춘다
 *   알림    /segan/me.html#partner-consults 로 오면 상담 칸으로 내려간다, # 만 바뀌면 다시 읽는다
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
const C1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const C2 = 'bbbbbbbb-2222-4222-8222-222222222222';
const C3 = 'cccccccc-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-10-30T03:00:00Z'); // 한국 시간 2026-10-30 12:00

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const noContent = () => ({ ok: true, status: 204, body: undefined });
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
  ok({ company: company(extra), application: null, members: [], invites: [] });

/** 기다리는 상담 (배정 30분 뒤 — 23시간 30분 남음) */
const waiting = (extra = {}) => ({
  id: C1,
  created_at: '2026-10-29T23:00:00Z',
  status: 'pending',
  name: '김고객',
  phone: '010-2222-3333',
  email: 'customer@example.com',
  sido: '대구광역시',
  gugun: '수성구',
  furniture_categories: ['sink', 'wardrobe'],
  door_finish: 'highgloss',
  demolition_needed: true,
  wanted_price_tier: 'mid',
  preferred_date: '2026-11-20',
  preferred_time: '15:00-18:00',
  description: '다음 달 입주라 급해요',
  request_detail_design: true,
  quote_total: 3128400,
  generation_image_url: 'https://example.supabase.co/storage/v1/sign/g1.png?token=t',
  assignment: {
    id: 'dddddddd-4444-4444-8444-444444444444',
    state: 'assigned',
    assigned_at: '2026-10-30T02:30:00Z',
    expires_at: '2026-10-31T02:30:00Z',
  },
  ...extra,
});
/** 돌려보낸 상담 — 서버가 연락처를 지워 주지만, 섞여 와도 그리지 않는다 */
const returned = (extra = {}) =>
  waiting({
    id: C2,
    status: 'returned',
    name: '박돌림',
    phone: '010-9999-8888',
    furniture_categories: ['fridge'],
    generation_image_url: null,
    assignment: {
      id: 'eeeeeeee-5555-4555-8555-555555555555',
      state: 'declined',
      assigned_at: '2026-10-28T02:30:00Z',
      expires_at: '2026-10-29T02:30:00Z',
    },
    ...extra,
  });
const accepted = (extra = {}) =>
  waiting({
    id: C3,
    status: 'confirmed',
    furniture_categories: ['shoerack'],
    generation_image_url: null,
    assignment: {
      id: 'ffffffff-6666-4666-8666-666666666666',
      state: 'accepted',
      assigned_at: '2026-10-27T02:30:00Z',
      expires_at: '2026-10-28T02:30:00Z',
    },
    ...extra,
  });
const SETTINGS = {
  regions: [
    { sido: '대구광역시', gugun: '북구' },
    { sido: '대구광역시', gugun: '수성구' },
  ],
  items: { sink: 'do', wardrobe: 'outsource', fridge: 'no' },
  monthly_limit: 12,
  next_available_date: '2026-11-15',
};
const SCORE = { grade: 'A', satisfaction: 4.62, response_rate: 0.9 };

/**
 * me.html 을 올린다. opts.list → GET /company/consults 응답 (목록이면 차례로, 마지막을 되풀이 · Error 면 끊김)
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    url: '/segan/me.html',
    partner: partnerMe(),
    list: ok({ items: [waiting(), returned(), accepted()] }),
    score: ok(SCORE),
    settings: ok(SETTINGS),
    put: (body) => ok(body),
    accept: () => ok({ customer_id: 'cu-1', project_id: 'pr-1' }),
    decline: () => noContent(),
    workflowUrl: WORK,
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
    'SeganPartnerConsults',
    'SeganBooks',
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
  let listCalls = 0;
  window.fetch = jest.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.fetch.push({ url, method, auth: (init.headers || {}).Authorization, body });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return {
        ok: r.ok,
        status: r.status,
        json: async () => {
          if (r.body === undefined) throw new SyntaxError('Unexpected end of JSON input');
          return r.body;
        },
      };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/company/consults' && method === 'GET') {
      const list = Array.isArray(opts.list) ? opts.list : [opts.list];
      return reply(list[Math.min(listCalls++, list.length - 1)]);
    }
    if (url === WORK + '/company/my-score') return reply(opts.score);
    if (url === WORK + '/company/service-settings' && method === 'GET') return reply(opts.settings);
    if (url === WORK + '/company/service-settings' && method === 'PUT')
      return reply(await opts.put(body));
    const m = /^\/company\/consults\/([^/]+)\/(accept|decline)$/.exec(url.slice(WORK.length));
    if (m && method === 'POST')
      return reply(await (m[2] === 'accept' ? opts.accept(m[1]) : opts.decline(m[1], body)));
    if (url.startsWith(WORK + '/books/')) return reply(fail(404, 'not_found', 'x'));
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
    'segan/partner-consults.js',
    'segan/books.js',
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
const box = () => $('partner-consults');
const setBox = () => $('partnerConsultSettings');
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const workCalls = (calls, p) =>
  calls.fetch.filter((f) => f.url.startsWith(WORK + '/company/' + (p || '')));
const item = (id) => box().querySelector(`[data-consult="${id}"]`);
const facts = (el) =>
  Object.fromEntries(
    [...el.querySelectorAll('.me-facts > div')].map((d) => [
      d.querySelector('dt').textContent,
      d.querySelector('dd').textContent,
    ])
  );
const btnIn = (el, label) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent === label);
const press = async (el, label) => {
  const b = btnIn(el, label);
  expect([label, !!b]).toEqual([label, true]);
  b.click();
  await flush();
};
const form = () => setBox().querySelector('form[data-form="settings"]');
const checkedItems = () =>
  Object.fromEntries(
    Object.keys(window.SeganPartnerConsults.ITEMS).map((k) => {
      const on = form().querySelector(`input[name="item-${k}"]:checked`);
      return [k, on ? on.value : null];
    })
  );
const chips = () =>
  [...setBox().querySelectorAll('.me-cs-regions li span')].map((s) => s.textContent);
const submitSettings = async () => {
  form().dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  await flush();
};
const pickRegion = (sido, gugun) => {
  const s = form().querySelector('select[name="sido"]');
  s.value = sido;
  s.dispatchEvent(new window.Event('change', { bubbles: true }));
  form().querySelector('select[name="gugun"]').value = gugun;
};

afterEach(() => jest.restoreAllMocks());

describe('자리 · 이름', () => {
  test('me.html — 업체 칸(#partner) 안, 업체 내용 뒤 · 회계 앞에 상담 · 상담 설정, 처음엔 감춘다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const ids = [...doc.getElementById('partner').children].map((el) => el.id).filter(Boolean);
    expect(ids).toEqual([
      'mePartnerTitle',
      'mePartner',
      'partner-consults',
      'partnerConsultSettings',
      'meBooks',
    ]);
    for (const id of ['partner-consults', 'partnerConsultSettings'])
      expect(doc.getElementById(id).hasAttribute('hidden')).toBe(true);
    // 업체 칸 스크립트 뒤 · me.js 앞에 싣는다, 서비스 워커가 미리 담는다
    const srcs = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    const at = (name) => srcs.findIndex((s) => s.startsWith(name + '?v='));
    expect(at('partner-consults.js')).toBeGreaterThan(at('partner.js'));
    expect(at('partner-consults.js')).toBeGreaterThan(at('regions.js'));
    expect(at('partner-consults.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'partner-consults.js')");
  });

  test('품목 = 서버 consult-notify.js FURNITURE_LABELS = consultation.html 가구 종류, 연락 시간 = TIME_LABELS', async () => {
    await load();
    const notify = read('workers/workflow-api/src/consult-notify.js');
    const obj = (name) =>
      Function(
        `return ${notify.match(new RegExp(`${name} = Object\\.freeze\\((\\{[\\s\\S]*?\\})\\);`))[1]}`
      )();
    const C = window.SeganPartnerConsults;
    expect(C.ITEMS).toEqual(obj('FURNITURE_LABELS'));
    expect(C.TIME_LABELS).toEqual(obj('TIME_LABELS'));
    const site = [
      ...read('consultation.html').matchAll(/name="furnitureCategory" value="([^"]+)"/g),
    ].map((m) => m[1]);
    expect(Object.keys(C.ITEMS)).toEqual(site);
    // 도어 마감 · 가격대 — consultations CHECK 값
    expect(Object.keys(C.DOOR_FINISH)).toEqual([
      'pet',
      'highgloss',
      'paint',
      'veneer',
      'ceramic',
      'unknown',
    ]);
    expect(Object.keys(C.PRICE_TIER)).toEqual(['basic', 'mid', 'high', 'unknown']);
    expect(C.ITEM_MODES.map((m) => m[0])).toEqual(['do', 'outsource', 'no']);
  });
});

describe('누가 보나', () => {
  test('대표 — 본인 토큰으로 상담 · 내 평가 · 상담 설정을 읽고, 업체 칸 안에 보인다', async () => {
    const calls = await load();
    expect(workCalls(calls).map((f) => [f.method, f.url, f.auth])).toEqual([
      ['GET', WORK + '/company/consults', 'Bearer tok-1'],
      ['GET', WORK + '/company/my-score', 'Bearer tok-1'],
      ['GET', WORK + '/company/service-settings', 'Bearer tok-1'],
    ]);
    expect($('partner').hidden).toBe(false);
    expect(box().hidden).toBe(false);
    expect(box().querySelector('h3').textContent).toBe('상담');
    expect(setBox().hidden).toBe(false);
    expect(setBox().querySelector('h3').textContent).toBe('상담 설정');
    expect(btnIn(item(C1), '받기')).toBeTruthy();
    expect(btnIn(item(C1), '못 받음')).toBeTruthy();
    // 업체 칸 내용은 그대로
    expect($('mePartner').querySelector('[data-view="company"]')).not.toBeNull();
  });

  test('실장도 받기 · 못 받음 · 내 평가 · 상담 설정', async () => {
    const calls = await load({ partner: partnerMe({ role: 'manager' }) });
    expect(workCalls(calls)).toHaveLength(3);
    expect(btnIn(item(C1), '받기')).toBeTruthy();
    expect(box().querySelector('[data-score]')).not.toBeNull();
    expect(setBox().hidden).toBe(false);
  });

  test('직원 — 목록만 (단추 · 내 평가 · 상담 설정 없음, 묻지도 않는다)', async () => {
    const calls = await load({ partner: partnerMe({ role: 'staff' }) });
    expect(workCalls(calls).map((f) => f.url)).toEqual([WORK + '/company/consults']);
    expect(box().hidden).toBe(false);
    expect(box().querySelectorAll('button')).toHaveLength(0);
    expect(box().querySelector('[data-score]')).toBeNull();
    expect(box().querySelector('.mk-note').textContent).toContain(
      '받기 · 못 받음은 대표 · 실장이 합니다.'
    );
    expect(setBox().hidden).toBe(true);
    // 연락처는 직원도 본다 (같은 업체)
    expect(facts(item(C1))['전화']).toBe('010-2222-3333');
  });

  test('결제가 멈춘 업체 — 읽기만 (단추 없음 · 설정은 잠김, 저장 단추 없음)', async () => {
    const calls = await load({ partner: partnerMe({ status: 'suspended' }) });
    expect(workCalls(calls)).toHaveLength(3);
    expect(box().querySelectorAll('button')).toHaveLength(0);
    expect(box().querySelector('.mk-note').textContent).not.toContain('대표 · 실장이 합니다');
    expect(setBox().hidden).toBe(false);
    expect(form().querySelector('fieldset').disabled).toBe(true);
    expect(form().querySelector('button[type="submit"]')).toBeNull();
    expect(form().querySelector('select[name="sido"]')).toBeNull();
  });

  test.each([
    ['Expert 업체', { partner: partnerMe({ plan: 'expert' }) }],
    ['업체 없음', { partner: ok({ company: null, application: null, members: [], invites: [] }) }],
    [
      '본사 구성원',
      { partner: ok({ hq_member: true, company: company(), members: [], invites: [] }) },
    ],
    ['/partner/me 404', { partner: fail(404, 'not_found', 'x') }],
    ['/partner/me 끊김', { partner: new TypeError('Failed to fetch') }],
    ['모르는 역할', { partner: partnerMe({ role: 'admin' }) }],
    ['workflow-api 주소 없음', { workflowUrl: '' }],
  ])('%s — 묻지도 않고 칸이 없다', async (_name, extra) => {
    const calls = await load(extra);
    expect(workCalls(calls)).toEqual([]);
    expect(box().hidden).toBe(true);
    expect(box().textContent).toBe('');
    expect(setBox().hidden).toBe(true);
  });

  test('로그인 없으면 아무것도 읽지 않고, #partner-consults 로 왔으면 로그인 뒤 같은 곳으로', async () => {
    const calls = await load({ session: null, url: '/segan/me.html#partner-consults' });
    expect(calls.fetch).toEqual([]);
    expect(box().hidden).toBe(true);
    const href = document
      .querySelector('[data-auth-view="signed-out"] a.sg-btn')
      .getAttribute('href');
    expect(href).toBe(
      '../login.html?redirect=' + encodeURIComponent('segan/me.html#partner-consults')
    );
    const url = new URL(href, `${ORIGIN}/segan/me.html`);
    expect(AuthRedirect.fromSearch(url.search)).toBe('segan/me.html#partner-consults');
  });

  test('canSee · isManager · canAct — 순수 판정', async () => {
    await load();
    const { canSee, isManager, canAct } = window.SeganPartnerConsults;
    const me = (c) => ({ company: { plan: 'agent', status: 'active', ...c } });
    expect(canSee(me({ role: 'staff' }))).toBe(true);
    expect(isManager(me({ role: 'staff' }))).toBe(false);
    expect(isManager(me({ role: 'manager' }))).toBe(true);
    expect(canAct(me({ role: 'owner' }))).toBe(true);
    expect(canAct(me({ role: 'owner', status: 'suspended' }))).toBe(false);
    expect(canAct(me({ role: 'owner', status: 'closed' }))).toBe(false);
    expect(canSee(me({ role: 'owner', plan: 'expert' }))).toBe(false);
    expect(canSee({ hq_member: true, company: { plan: 'agent', role: 'owner' } })).toBe(false);
    expect(canSee(null)).toBe(false);
    expect(canSee([])).toBe(false);
  });
});

describe('상담 목록', () => {
  test('기다리는 상담 — 품목 · 지역 · 신청일 · 남은 시간 · 연출컷 · 내용 · 이름 · 전화', async () => {
    await load();
    const el = item(C1);
    expect(el.querySelector('.me-c-main b').textContent).toBe('싱크대 · 붙박이장');
    expect(el.querySelector('.me-c-main small').textContent).toBe('대구광역시 수성구 · 2026.10.30');
    expect(el.querySelector('.me-badge').textContent).toBe('새 상담');
    expect(el.querySelector('.me-cs-left').textContent).toBe('남은 시간 23시간 30분');
    expect(el.querySelector('img.me-cs-shot').getAttribute('src')).toBe(
      waiting().generation_image_url
    );
    expect(facts(el)).toEqual({
      '희망 시기': '2026.11.20',
      '연락 시간': '오후 (15:00~18:00)',
      '도어 마감': '하이그로시',
      철거: '필요',
      가격대: '중급',
      '예상 견적': '3,128,400원',
      '상세 설계': '요청',
      '요청 사항': '다음 달 입주라 급해요',
      이름: '김고객',
      전화: '010-2222-3333',
    });
    expect(el.querySelector('.me-facts a').getAttribute('href')).toBe('tel:01022223333');
    // 이메일은 그리지 않는다
    expect(el.textContent).not.toContain('customer@example.com');
    expect(el.classList.contains('me-cs-item--off')).toBe(false);
  });

  test('돌려보낸 상담 — 흐리게, 연락처(이름 · 전화)를 그리지 않고 단추 · 남은 시간도 없다', async () => {
    await load();
    const el = item(C2);
    expect(el.classList.contains('me-cs-item--off')).toBe(true);
    expect(el.querySelector('.me-badge').textContent).toBe('못 받음');
    expect(el.textContent).not.toContain('박돌림');
    expect(el.textContent).not.toContain('010-9999-8888');
    expect(el.querySelector('a[href^="tel:"]')).toBeNull();
    expect(el.querySelector('.me-cs-left')).toBeNull();
    expect(el.querySelectorAll('button')).toHaveLength(0);
    expect(facts(el)['도어 마감']).toBe('하이그로시');
  });

  test.each([
    ['declined', '못 받음'],
    ['expired', '시간 넘김'],
  ])('배정 기록 %s → 흐리게 「%s」', async (state, label) => {
    await load({
      list: ok({
        items: [returned({ status: 'pending', assignment: { state, expires_at: null } })],
      }),
    });
    expect(item(C2).classList.contains('me-cs-item--off')).toBe(true);
    expect(item(C2).querySelector('.me-badge').textContent).toBe(label);
  });

  test('받은 상담 — 「받음」, 단추 · 남은 시간 없음, 연락처는 보인다', async () => {
    await load();
    const el = item(C3);
    expect(el.querySelector('.me-badge').textContent).toBe('받음');
    expect(el.querySelectorAll('button')).toHaveLength(0);
    expect(el.querySelector('.me-cs-left')).toBeNull();
    expect(facts(el)['이름']).toBe('김고객');
    expect(el.querySelector('.me-c-main b').textContent).toBe('신발장');
  });

  test('값이 없는 칸은 빼고, 품목이 없으면 「품목 미정」 · 철거 아니요는 「필요 없음」', async () => {
    await load({
      list: ok({
        items: [
          waiting({
            furniture_categories: [],
            door_finish: null,
            demolition_needed: false,
            wanted_price_tier: 'bogus',
            preferred_date: null,
            preferred_time: null,
            description: '  ',
            request_detail_design: false,
            quote_total: null,
            generation_image_url: 'http://insecure.example/x.png',
          }),
        ],
      }),
    });
    const el = item(C1);
    expect(el.querySelector('.me-c-main b').textContent).toBe('품목 미정');
    expect(facts(el)).toEqual({ 철거: '필요 없음', 이름: '김고객', 전화: '010-2222-3333' });
    expect(el.querySelector('img')).toBeNull();
  });

  test('응답 시간이 지났으면 그 글로', async () => {
    await load({
      list: ok({
        items: [waiting({ assignment: { state: 'assigned', expires_at: '2026-10-30T02:59:00Z' } })],
      }),
    });
    expect(item(C1).querySelector('.me-cs-left').textContent).toBe('응답 시간이 지났습니다');
  });

  test('배정된 상담이 없으면 한 줄', async () => {
    await load({ list: ok({ items: [] }) });
    expect(box().hidden).toBe(false);
    expect(box().querySelector('.me-empty').textContent).toBe('아직 배정된 상담이 없습니다.');
  });

  test('API 글은 글자로만 넣는다 · id 가 uuid 가 아닌 줄은 뺀다', async () => {
    const bad = '<img src=x onerror=alert(1)>';
    await load({
      list: ok({
        items: [
          waiting({ description: bad, name: bad, sido: bad }),
          waiting({ id: 'not-a-uuid" onclick="x' }),
        ],
      }),
    });
    expect(box().querySelectorAll('[data-consult]')).toHaveLength(1);
    expect(box().querySelector('[onerror]')).toBeNull();
    expect(box().querySelector('[onclick]')).toBeNull();
    expect(box().querySelectorAll('img')).toHaveLength(1); // 연출컷 하나뿐
    expect(box().textContent).toContain(bad);
  });
});

describe('받기 · 못 받음', () => {
  test('받기 — POST …/accept (본인 토큰) → 「받았습니다 · 고객 · 프로젝트를 만들었습니다」, 목록을 다시 읽는다', async () => {
    const calls = await load({
      list: [
        ok({ items: [waiting()] }),
        ok({ items: [waiting({ status: 'confirmed', assignment: { state: 'accepted' } })] }),
      ],
    });
    await press(item(C1), '받기');
    const posts = workCalls(calls).filter((f) => f.method === 'POST');
    expect(posts).toEqual([
      {
        url: `${WORK}/company/consults/${C1}/accept`,
        method: 'POST',
        auth: 'Bearer tok-1',
        body: undefined,
      },
    ]);
    expect(workCalls(calls, 'consults').filter((f) => f.method === 'GET')).toHaveLength(2);
    expect(item(C1).querySelector('.me-pt-msg').textContent).toBe(
      '받았습니다 · 고객 · 프로젝트를 만들었습니다.'
    );
    expect(item(C1).querySelector('.me-badge').textContent).toBe('받음');
    expect(item(C1).querySelectorAll('button')).toHaveLength(0);
  });

  test('받기 실패(이미 답함 409) — 서버 글을 그 상담에 보이고 목록을 다시 읽는다', async () => {
    const calls = await load({
      accept: () => fail(409, 'not_open', '이미 답한 상담입니다.'),
      list: [
        ok({ items: [waiting()] }),
        ok({ items: [waiting({ assignment: { state: 'expired' } })] }),
      ],
    });
    await press(item(C1), '받기');
    expect(item(C1).querySelector('.mk-error').textContent).toBe('이미 답한 상담입니다.');
    expect(item(C1).querySelector('.me-badge').textContent).toBe('시간 넘김');
    expect(workCalls(calls, 'consults').filter((f) => f.method === 'GET')).toHaveLength(2);
  });

  test('받기 끊김 — 안내 한 줄 (글이 없으면 기본 글)', async () => {
    await load({ accept: () => new TypeError('Failed to fetch') });
    await press(item(C1), '받기');
    expect(item(C1).querySelector('.mk-error').textContent).toBe(
      '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    );
    expect(btnIn(item(C1), '받기')).toBeTruthy();
  });

  test('누르는 동안 단추를 잠근다 (두 번 보내지 않는다)', async () => {
    let release;
    const calls = await load({
      accept: () =>
        new Promise((r) => {
          release = () => r(ok({ customer_id: 'c', project_id: 'p' }));
        }),
    });
    btnIn(item(C1), '받기').click();
    await flush();
    expect(btnIn(item(C1), '받기').disabled).toBe(true);
    expect(btnIn(item(C1), '못 받음').disabled).toBe(true);
    btnIn(item(C1), '받기').click();
    await flush();
    expect(workCalls(calls).filter((f) => f.method === 'POST')).toHaveLength(1);
    release();
    await flush();
  });

  test('못 받음 — 그 자리에서 까닭 칸, 비우면 보내지 않고, 적으면 POST …/decline { reason } → 204', async () => {
    const calls = await load({
      list: [ok({ items: [waiting()] }), ok({ items: [returned({ id: C1 })] })],
    });
    await press(item(C1), '못 받음');
    const area = item(C1).querySelector('textarea[name="reason"]');
    expect(area).not.toBeNull();
    expect(area.getAttribute('maxlength')).toBe('500');
    expect(btnIn(item(C1), '받기')).toBeUndefined();
    await press(item(C1), '못 받음 보내기');
    expect(workCalls(calls).filter((f) => f.method === 'POST')).toEqual([]);
    expect(item(C1).querySelector('[data-err]').textContent).toBe('못 받는 까닭을 적어 주세요.');
    item(C1).querySelector('textarea').value = '  이번 달 일정이 꽉 찼습니다. ';
    await press(item(C1), '못 받음 보내기');
    expect(workCalls(calls).filter((f) => f.method === 'POST')).toEqual([
      {
        url: `${WORK}/company/consults/${C1}/decline`,
        method: 'POST',
        auth: 'Bearer tok-1',
        body: { reason: '이번 달 일정이 꽉 찼습니다.' },
      },
    ]);
    expect(item(C1).querySelector('.me-pt-msg').textContent).toBe('못 받음으로 돌려보냈습니다.');
    expect(item(C1).classList.contains('me-cs-item--off')).toBe(true);
    expect(item(C1).textContent).not.toContain('010-2222-3333');
  });

  test('못 받음 그만두기 — 원래 단추로', async () => {
    await load();
    await press(item(C1), '못 받음');
    await press(item(C1), '그만두기');
    expect(item(C1).querySelector('textarea')).toBeNull();
    expect(btnIn(item(C1), '받기')).toBeTruthy();
  });

  test('못 받음 보내기 서버 오류(500) — 까닭 칸을 두고 안내 (다시 보낼 수 있다)', async () => {
    const calls = await load({ decline: () => fail(500, 'error', '잠시 후 다시 시도해 주세요.') });
    await press(item(C1), '못 받음');
    item(C1).querySelector('textarea').value = '일정';
    await press(item(C1), '못 받음 보내기');
    expect(item(C1).querySelector('textarea').value).toBe('일정');
    expect(item(C1).querySelector('[data-err]').textContent).toBe('잠시 후 다시 시도해 주세요.');
    expect(workCalls(calls, 'consults').filter((f) => f.method === 'GET')).toHaveLength(1);
  });
});

describe('못 읽으면 — 칸째 감춘다', () => {
  test.each([
    ['403', () => fail(403, 'forbidden', 'x')],
    ['404 (아직 배포 전)', () => fail(404, 'not_found', 'x')],
    ['500', () => fail(500, 'error', 'x')],
    ['끊김', () => new TypeError('Failed to fetch')],
    ['본문이 JSON 아님', () => ({ ok: true, status: 200, body: undefined })],
    [
      'success 아님',
      () => ({ ok: true, status: 200, body: { success: false, data: { items: [] } } }),
    ],
    ['items 가 목록 아님', () => ok({ items: {} })],
    ['data 가 목록', () => ok([])],
  ])('목록 %s → 상담 칸이 없다 (설정 · 업체 칸은 그대로)', async (_name, list) => {
    await load({ list: list() });
    expect(box().hidden).toBe(true);
    expect(box().textContent).toBe('');
    expect(setBox().hidden).toBe(false);
    expect($('mePartner').querySelector('[data-view="company"]')).not.toBeNull();
  });

  test.each([
    ['403', fail(403, 'forbidden', 'x')],
    ['404', fail(404, 'not_found', 'x')],
    ['끊김', new TypeError('Failed to fetch')],
    ['data 가 목록', ok([])],
  ])('상담 설정 %s → 설정 칸이 없다 (목록은 그대로)', async (_name, settings) => {
    await load({ settings });
    expect(setBox().hidden).toBe(true);
    expect(setBox().textContent).toBe('');
    expect(box().hidden).toBe(false);
  });

  test.each([
    ['404', fail(404, 'not_found', 'x')],
    ['끊김', new TypeError('Failed to fetch')],
    ['data 없음', { ok: true, status: 200, body: { success: true } }],
  ])('내 평가 %s → 그 줄만 뺀다', async (_name, score) => {
    await load({ score });
    expect(box().hidden).toBe(false);
    expect(box().querySelector('[data-score]')).toBeNull();
  });
});

describe('내 평가', () => {
  test('등급 · 고객 만족 · 응답률 한 줄', async () => {
    await load();
    expect(box().querySelector('[data-score]').textContent).toBe(
      '내 평가 · 등급 A · 고객 만족 4.6 / 5 · 응답률 90%'
    );
  });

  test('값이 없으면 「-」 (모르는 등급 · 범위 밖 값도)', async () => {
    await load({ score: ok({ grade: 'Z', satisfaction: null, response_rate: 3 }) });
    expect(box().querySelector('[data-score]').textContent).toBe(
      '내 평가 · 등급 - · 고객 만족 - · 응답률 -'
    );
  });
});

describe('상담 설정', () => {
  test('읽은 값 — 지역 · 품목(없는 품목은 안 함) · 한 달 한도 · 다음 가능 날짜 · 안내 한 줄', async () => {
    await load();
    expect(setBox().querySelector('.me-pt-warn').textContent).toBe(
      '설정을 마쳐야 상담을 배정받을 수 있어요.'
    );
    expect(chips()).toEqual(['대구광역시 북구', '대구광역시 수성구']);
    expect(checkedItems()).toEqual({
      sink: 'do',
      island: 'no',
      wardrobe: 'outsource',
      fridge: 'no',
      shoerack: 'no',
      vanity: 'no',
      storage: 'no',
      other: 'no',
    });
    expect(
      [...form().querySelectorAll('.me-cs-itemrow')].map((r) => [
        r.querySelector('.me-cs-itemname').textContent,
        [...r.querySelectorAll('.cs-choice')].map((c) => c.textContent),
      ])[0]
    ).toEqual(['싱크대', ['함', '외주', '안 함']]);
    expect(form().querySelector('input[name="monthly_limit"]').value).toBe('12');
    expect(form().querySelector('input[name="next_available_date"]').value).toBe('2026-11-15');
  });

  test('처음(data null) — 빈 설정, 지역이 없으면 업체 주소 안내', async () => {
    await load({ settings: ok(null) });
    expect(setBox().hidden).toBe(false);
    expect(chips()).toEqual([]);
    expect(setBox().querySelector('.me-empty').textContent).toBe(
      '비워 두면 업체 주소의 시/군/구 상담만 받습니다.'
    );
    expect(Object.values(checkedItems()).every((v) => v === 'no')).toBe(true);
    expect(form().querySelector('input[name="monthly_limit"]').value).toBe('');
  });

  test('지역 더하기 · 빼기 — 같은 곳은 한 번만, 「모두」는 그 시/도 시/군/구 전부, 고친 다른 칸은 남는다', async () => {
    await load();
    form().querySelector('input[name="monthly_limit"]').value = '30';
    form().querySelector('input[name="item-island"][value="do"]').checked = true;
    pickRegion('대구광역시', '북구');
    await press(form(), '지역 더하기');
    expect(chips()).toEqual(['대구광역시 북구', '대구광역시 수성구']);
    pickRegion('경기도', '수원시');
    await press(form(), '지역 더하기');
    expect(chips()).toEqual(['대구광역시 북구', '대구광역시 수성구', '경기도 수원시']);
    // 다시 그려도 고친 값은 그대로
    expect(form().querySelector('input[name="monthly_limit"]').value).toBe('30');
    expect(checkedItems().island).toBe('do');
    // 빼기
    setBox().querySelector('button[aria-label="대구광역시 수성구 빼기"]').click();
    await flush();
    expect(chips()).toEqual(['대구광역시 북구', '경기도 수원시']);
    // 모두
    const ulsan = window.SeganRegions['울산광역시'];
    pickRegion('울산광역시', '*');
    expect(form().querySelector('select[name="gugun"] option[value="*"]').textContent).toBe(
      `모두 (${ulsan.length}곳)`
    );
    await press(form(), '지역 더하기');
    expect(chips()).toEqual(
      ['대구광역시 북구', '경기도 수원시'].concat(ulsan.map((g) => '울산광역시 ' + g))
    );
  });

  test('지역을 고르지 않고 더하기 — 안내만', async () => {
    await load();
    await press(form(), '지역 더하기');
    expect(form().querySelector('[data-err]').textContent).toBe('시/도와 시/군/구를 골라 주세요.');
    expect(chips()).toHaveLength(2);
  });

  test('저장 — PUT /company/service-settings 에 고른 값 그대로, 「저장했습니다」', async () => {
    const calls = await load();
    form().querySelector('input[name="item-vanity"][value="outsource"]').checked = true;
    form().querySelector('input[name="monthly_limit"]').value = '20';
    form().querySelector('input[name="next_available_date"]').value = '2026-12-01';
    pickRegion('서울특별시', '강남구');
    await press(form(), '지역 더하기');
    await submitSettings();
    const puts = workCalls(calls, 'service-settings').filter((f) => f.method === 'PUT');
    expect(puts).toEqual([
      {
        url: WORK + '/company/service-settings',
        method: 'PUT',
        auth: 'Bearer tok-1',
        body: {
          regions: [
            { sido: '대구광역시', gugun: '북구' },
            { sido: '대구광역시', gugun: '수성구' },
            { sido: '서울특별시', gugun: '강남구' },
          ],
          items: {
            sink: 'do',
            island: 'no',
            wardrobe: 'outsource',
            fridge: 'no',
            shoerack: 'no',
            vanity: 'outsource',
            storage: 'no',
            other: 'no',
          },
          monthly_limit: 20,
          next_available_date: '2026-12-01',
        },
      },
    ]);
    expect(setBox().querySelector('.me-pt-msg').textContent).toBe('상담 설정을 저장했습니다.');
    expect(chips()).toHaveLength(3);
  });

  test('한도 · 날짜를 비우면 null 로 보낸다', async () => {
    const calls = await load();
    form().querySelector('input[name="monthly_limit"]').value = '';
    form().querySelector('input[name="next_available_date"]').value = '';
    await submitSettings();
    const put = workCalls(calls, 'service-settings').find((f) => f.method === 'PUT');
    expect(put.body.monthly_limit).toBeNull();
    expect(put.body.next_available_date).toBeNull();
  });

  test.each([
    ['-1', '한 달 한도는 0~1000 사이 숫자로 적어 주세요.'],
    ['1001', '한 달 한도는 0~1000 사이 숫자로 적어 주세요.'],
    ['2.5', '한 달 한도는 0~1000 사이 숫자로 적어 주세요.'],
  ])('한도 %s → 보내지 않고 안내', async (v, msg) => {
    const calls = await load();
    const el = form().querySelector('input[name="monthly_limit"]');
    // type=number 칸은 숫자가 아닌 글을 비워 버린다 — 글 칸으로 바꿔 그대로 넣는다
    el.type = 'text';
    el.value = v;
    await submitSettings();
    expect(workCalls(calls, 'service-settings').filter((f) => f.method === 'PUT')).toEqual([]);
    expect(form().querySelector('[data-err]').textContent).toBe(msg);
    expect(form().querySelector('[aria-invalid]').name).toBe('monthly_limit');
  });

  test('저장 실패(422) — 서버 글을 보이고 그 칸에 표시', async () => {
    await load({
      put: () => ({
        ok: false,
        status: 422,
        body: {
          success: false,
          code: 'invalid',
          message: '지역을 다시 확인해 주세요.',
          field: 'sido',
        },
      }),
    });
    await submitSettings();
    expect(form().querySelector('[data-err]').textContent).toBe('지역을 다시 확인해 주세요.');
    expect(setBox().querySelector('.me-pt-msg')).toBeNull();
  });

  test('settingsBody · settingsOf — 순수 함수', async () => {
    await load();
    const { settingsBody, settingsOf } = window.SeganPartnerConsults;
    expect(
      settingsBody({
        regions: [
          { sido: '경기도', gugun: '수원시' },
          { sido: '', gugun: 'x' },
        ],
        items: { sink: 'do', island: 'bogus' },
        monthly_limit: '0',
        next_available_date: '2026-02-30',
      })
    ).toEqual({ field: 'next_available_date', error: '다음 가능 날짜를 다시 골라 주세요.' });
    const r = settingsBody({ regions: [], items: {}, monthly_limit: '0', next_available_date: '' });
    expect(r.body.monthly_limit).toBe(0);
    expect(r.body.regions).toEqual([]);
    expect(Object.values(r.body.items).every((v) => v === 'no')).toBe(true);
    const many = Array.from({ length: 301 }, (_, i) => ({ sido: '경기도', gugun: 'g' + i + '시' }));
    expect(settingsBody({ regions: many }).error).toBe('지역은 300곳까지 둘 수 있습니다.');
    expect(
      settingsOf({
        regions: [{ sido: '경기도', gugun: '수원시' }, { sido: '경기도', gugun: '수원시' }, 'x'],
        items: { sink: 'outsource', bogus: 'do' },
        monthly_limit: 3.5,
        next_available_date: '2026/11/01',
      })
    ).toEqual({
      regions: [{ sido: '경기도', gugun: '수원시' }],
      items: {
        sink: 'outsource',
        island: 'no',
        wardrobe: 'no',
        fridge: 'no',
        shoerack: 'no',
        vanity: 'no',
        storage: 'no',
        other: 'no',
      },
      monthly_limit: null,
      next_available_date: null,
    });
  });
});

describe('새 상담 알림 — #partner-consults', () => {
  test('me.html#partner-consults 로 오면 상담 칸으로 내려간다', async () => {
    await load({ url: '/segan/me.html#partner-consults' });
    expect(box().hidden).toBe(false);
    const ctx = Element.prototype.scrollIntoView.mock.contexts;
    expect(ctx).toContain(box());
  });

  test('# 가 없으면 상담 칸으로 내려가지 않는다', async () => {
    await load();
    expect(Element.prototype.scrollIntoView.mock.contexts).not.toContain(box());
  });

  test('앱이 열린 채 # 만 바뀌면 — 목록을 다시 읽고 내려간다', async () => {
    const calls = await load({
      list: [ok({ items: [] }), ok({ items: [waiting()] })],
    });
    expect(box().querySelector('.me-empty')).not.toBeNull();
    window.history.replaceState(null, '', '/segan/me.html#partner-consults');
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    await flush();
    expect(workCalls(calls, 'consults').filter((f) => f.method === 'GET')).toHaveLength(2);
    expect(item(C1)).not.toBeNull();
    expect(Element.prototype.scrollIntoView.mock.contexts).toContain(box());
  });
});

describe('남은 시간 (순수 함수)', () => {
  test('leftText', async () => {
    await load();
    const { leftText } = window.SeganPartnerConsults;
    const at = Date.parse('2026-10-30T00:00:00Z');
    expect(leftText('2026-10-31T00:00:00Z', at)).toBe('남은 시간 24시간');
    expect(leftText('2026-10-30T01:01:00Z', at)).toBe('남은 시간 1시간 1분');
    expect(leftText('2026-10-30T00:00:30Z', at)).toBe('남은 시간 1분');
    expect(leftText('2026-10-30T00:00:00Z', at)).toBe('응답 시간이 지났습니다');
    expect(leftText('bad', at)).toBe('');
  });

  test('scoreOf · listOf', async () => {
    await load();
    const { scoreOf, listOf } = window.SeganPartnerConsults;
    expect(scoreOf({ success: true, data: SCORE })).toEqual({
      grade: 'A',
      satisfaction: 4.62,
      response_rate: 0.9,
    });
    expect(scoreOf(SCORE)).toBeNull(); // 감싸지 않은 본문은 받지 않는다 ({ success, data })
    expect(listOf({ success: true, data: { items: [waiting(), null, { id: 'x' }] } })).toHaveLength(
      1
    );
    expect(listOf({ success: true, data: [] })).toBeNull();
  });
});
