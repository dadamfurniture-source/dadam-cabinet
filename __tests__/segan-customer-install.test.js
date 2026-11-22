/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Element, Event, File */
/**
 * segan/customer-install.js — 고객 초대 링크로 들어오기 · 내 프로젝트의 설치 날 확인 (2026-11-23 대표님 뒤 공정 3차, 워커 DB 0082).
 *   1) me.html 자리 · 서비스 워커 · 글자 수 = 워커
 *   2) 초대 링크 — 주소에서 토큰을 바로 지우고 이 탭 저장소에만, 로그인 전에는 업체 이름 · 「로그인하면 잇습니다」,
 *      로그인 뒤 「내 계정과 잇기」 → accept · 다시 열기, 쓸 수 없는 링크(410)는 「새 링크를 받아 주세요」
 *   3) 설치 날 — 확인 전 「이 날 좋아요」 · 「바꿔 주세요」(같은 단추로 칸), 확인함 · 요청함 글, 끝난 · 취소 · 보류 줄에는 없다
 * 시험 데이터는 모두 가짜다.
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
const ORD = '55555555-5555-4555-8555-555555555551';
const ORD2 = '55555555-5555-4555-8555-555555555552';
const A1 = '66666666-6666-4666-8666-666666666661';
const A2 = '66666666-6666-4666-8666-666666666662';
const PHOTO_PATH = `${CO}/${ORD}/77777777-7777-4777-8777-777777777777.png`;

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const company = (extra = {}) => ({
  id: CO,
  name: '다담 협력 주방',
  plan: 'agent',
  next_plan: null,
  status: 'active',
  sido: '대구광역시',
  gugun: '북구',
  role: 'staff',
  created_at: '2026-10-01T00:00:00Z',
  ...extra,
});
const partnerMe = (extra = {}) =>
  ok({ company: company(extra), application: null, members: [], invites: [] });

const project = (extra = {}) => ({
  id: 'p-1',
  title: '싱크대',
  status: 'active',
  company_name: '다담 공장',
  created_at: '2026-10-01T00:00:00Z',
  stage: 'installed',
  order: {
    id: ORD,
    order_no: 'SO-20261101-AB12',
    status: 'completed',
    contract_amount: 1000000,
    ordered_at: '2026-10-05T00:00:00Z',
    completed_at: '2026-10-30T00:00:00Z',
  },
  payments: [],
  install_at: null,
  ...extra,
});

const mine = (items) => ok({ ready: true, items });
const myItem = (extra = {}) => ({
  id: A1,
  factory: '다담 공장',
  order_no: 'SO-20261101-AB12',
  body: '문이 안 닫혀요',
  state: 'requested',
  label: '접수',
  created_at: '2026-11-06T01:00:00Z', // 한국 시간 10:00
  received_at: null,
  done_at: null,
  can_cancel: true,
  ...extra,
});
const boxItem = (extra = {}) => ({
  id: A1,
  order_no: 'SO-20261101-AB12',
  body: '서랍이 걸려요\n둘째 칸',
  photo_urls: [
    'https://example.supabase.co/storage/v1/object/sign/as-request-photos/a.jpg?token=t',
    'javascript:alert(1)',
  ],
  state: 'requested',
  label: '접수',
  route: 'assignee',
  mine: true,
  can_handle: true,
  created_at: '2026-11-06T01:00:00Z',
  received_at: null,
  done_at: null,
  ...extra,
});

/**
 * me.html 을 올린다.
 *   opts.projects() · mine() · box() → GET 응답, opts.upload(raw) · send(body) · cancel(url) · act(url) → POST 응답
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    url: '/segan/me.html',
    partner: fail(404, 'not_found', 'x'),
    projects: () => ok([project()]),
    mine: () => mine([]),
    box: () => ok({ ready: true, items: [] }),
    upload: () => ok({ photo_path: PHOTO_PATH }, 201),
    send: () =>
      ok(
        { id: A1, state: 'requested', route: 'assignee', created_at: '2026-11-06T01:00:00Z' },
        201
      ),
    cancel: () => ok({ id: A1, state: 'cancelled', cancelled_at: '2026-11-06T02:00:00Z' }),
    act: (url) => ok({ id: A1, state: url.endsWith('/receive') ? 'received' : 'done' }),
    peek: () => ok({ company_name: '가나 팩토리', expires_at: '2026-12-07T00:00:00Z' }),
    accept: () => ok({ project_id: 'p-1', company_name: '가나 팩토리' }),
    sched: () => ok({}),
    workflowUrl: WORK,
    ...options,
  };
  window.history.replaceState(null, '', opts.url);
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  if (!opts.keepStorage) sessionStorage.clear();
  for (const k of [
    'AdminAccess',
    'DetailDesignAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganMake',
    'SeganMe',
    'SeganPartner',
    'SeganPartnerProjects',
    'SeganAs',
    'SeganInstall',
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
    const method = init.method || 'GET';
    const headers = init.headers || {};
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.fetch.push({
      url,
      method,
      auth: headers.Authorization,
      type: headers['Content-Type'],
      body,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/customer-invites/peek') return reply(await opts.peek(body, headers));
    if (url === WORK + '/customer-invites/accept') return reply(await opts.accept(body, headers));
    if (/\/me\/schedules\/[^/]+\/(confirm|change)$/.test(url))
      return reply(await opts.sched(url, body));
    if (url === WORK + '/me/projects') return reply(await opts.projects());
    if (url === WORK + '/me/as-requests') return reply(await opts.mine());
    if (/\/me\/orders\/[^/]+\/as-requests\/photo$/.test(url))
      return reply(await opts.upload(body, url));
    if (/\/me\/orders\/[^/]+\/as-requests$/.test(url)) return reply(await opts.send(body, url));
    if (/\/me\/as-requests\/[^/]+\/cancel$/.test(url)) return reply(await opts.cancel(url));
    if (url === WORK + '/company/as-requests') return reply(await opts.box());
    if (/\/company\/as-requests\/[^/]+\/(receive|done)$/.test(url))
      return reply(await opts.act(url, body));
    if (url === WORK + '/company/projects') return reply(fail(404, 'not_found', 'x'));
    if (url === PAY + '/subscription') return reply(ok({ plan: 'free', status: 'active' }));
    if (url === PAY + '/plans') return reply(ok({ client_key: 'k', plans: [] }));
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
    'segan/as-requests.js',
    'segan/customer-install.js',
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

const S1 = '88888888-8888-4888-8888-888888888881';
const P_ID = '99999999-9999-4999-8999-999999999991';
const TOKEN = 't'.repeat(32);
const withInstall = (install, extra = {}) =>
  project({
    id: P_ID,
    stage: 'contract',
    order: null,
    install_at: install && install.scheduled_at,
    install,
    ...extra,
  });
const inst = (extra = {}) => ({
  id: S1,
  scheduled_at: '2026-11-28T00:00:00.000Z',
  status: 'scheduled',
  confirmed_at: null,
  change_requested_at: null,
  ...extra,
});
const slotOf = () => $('meProjects').querySelector('[data-install]');
const card = () => $('meCustomerInvite');

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
  sessionStorage.clear();
});

describe('자리 · 이름', () => {
  test('me.html — as-requests.js 다음 · me.js 앞, 서비스 워커가 담는다, 글자 수 = 워커', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const srcs = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    const at = (name) => srcs.findIndex((s) => s.startsWith(name + '?v='));
    expect(at('customer-install.js')).toBeGreaterThan(at('as-requests.js'));
    expect(at('customer-install.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'customer-install.js')");
    const src = read('segan/customer-install.js');
    expect(src).toContain('var NOTE_MAX = 200;');
    expect(read('workers/workflow-api/src/my-schedules.js')).toContain(
      'export const CHANGE_NOTE_MAX = 200;'
    );
    // 링크 모양 = 워커가 만드는 링크
    expect(read('workers/workflow-api/src/customer-invites.js')).toContain(
      '/segan/me.html#customer-invite='
    );
  });
});

describe('고객 초대 링크', () => {
  test('로그인 뒤 — 토큰을 주소에서 바로 지우고, 업체 이름 카드 → 「내 계정과 잇기」 → accept 후 다시 연다', async () => {
    const reload = jest.fn();
    const calls = await load({ url: '/segan/me.html#customer-invite=' + TOKEN });
    await flush();
    expect(window.location.hash).toBe('');
    expect(sessionStorage.getItem('segan.customerInvite')).toBe(TOKEN);
    const peek = calls.fetch.filter((c) => c.url === WORK + '/customer-invites/peek');
    expect(peek.map((c) => [c.method, c.body.token, c.auth])).toEqual([['POST', TOKEN, undefined]]);
    expect(card().textContent).toContain('가나 팩토리');
    const btn = card().querySelector('[data-ci-act="accept"]');
    expect(btn.textContent).toBe('내 계정과 잇기');
    const realLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        hash: '',
        pathname: '/segan/me.html',
        search: '',
        replace: jest.fn(),
        reload,
      },
      configurable: true,
    });
    try {
      btn.click();
      await flush();
    } finally {
      Object.defineProperty(window, 'location', { value: realLocation, configurable: true });
    }
    const acc = calls.fetch.filter((c) => c.url === WORK + '/customer-invites/accept');
    expect(acc.map((c) => [c.body.token, c.auth])).toEqual([[TOKEN, 'Bearer tok-1']]);
    expect(sessionStorage.getItem('segan.customerInvite')).toBeNull();
    expect(sessionStorage.getItem('segan.customerInviteDone')).toBe('1');
    expect(reload).toHaveBeenCalled();
  });

  test('로그인 전 — 로그인 칸 위에 「로그인하면 잇습니다」, 잇기 단추는 없다 · 쓸 수 없는 링크는 「새 링크를 받아 주세요」', async () => {
    await load({ session: null, url: '/segan/me.html#customer-invite=' + TOKEN });
    await flush();
    const host = document.querySelector('[data-auth-view="signed-out"]');
    expect(host.querySelector('#meCustomerInvite')).not.toBeNull();
    expect(card().textContent).toContain('로그인하면 이어서 잇습니다');
    expect(card().querySelector('[data-ci-act]')).toBeNull();
    document.body.innerHTML = '';
    sessionStorage.clear();
    await load({
      url: '/segan/me.html#customer-invite=' + TOKEN,
      peek: () => fail(410, 'gone', '만료된 초대 링크입니다 — 업체에 새 링크를 받아 주세요'),
    });
    await flush();
    expect(card().querySelector('[data-ci="gone"]')).not.toBeNull();
    expect(sessionStorage.getItem('segan.customerInvite')).toBeNull();
  });
});

describe('설치 날', () => {
  test('확인 전 — 「이 날 좋아요」 · 「바꿔 주세요」, 좋아요는 confirm 을 보내고 「확인했습니다」', async () => {
    let sent = [];
    await load({
      projects: () => ok([withInstall(inst())]),
      sched: (url) => {
        sent.push(url);
        return ok({
          id: S1,
          scheduled_at: '2026-11-28T00:00:00.000Z',
          customer_confirmed_at: '2026-11-23T01:00:00Z',
          customer_change_requested_at: null,
          customer_change_note: null,
        });
      },
    });
    expect(slotOf().querySelector('.ci-line').textContent).toBe('설치 날 11.28 (토) 09:00');
    expect([...slotOf().querySelectorAll('[data-ci-act]')].map((b) => b.textContent)).toEqual([
      '이 날 좋아요',
      '바꿔 주세요',
    ]);
    slotOf().querySelector('[data-ci-act="ok"]').click();
    await flush();
    expect(sent).toEqual([WORK + '/me/schedules/' + S1 + '/confirm']);
    expect(slotOf().querySelector('[data-ci="confirmed"]').textContent).toBe('확인했습니다');
    expect([...slotOf().querySelectorAll('[data-ci-act]')].map((b) => b.textContent)).toEqual([
      '바꿔 주세요',
    ]);
  });

  test('바꿔 주세요 — 같은 단추로 칸을 펼치고 접는다, 바라는 것(200자)을 보내면 「바꿔 달라고 했습니다」', async () => {
    let body = null;
    await load({
      projects: () => ok([withInstall(inst({ confirmed_at: '2026-11-20T00:00:00Z' }))]),
      sched: (url, b) => {
        body = [url, b];
        return ok({
          id: S1,
          customer_confirmed_at: null,
          customer_change_requested_at: '2026-11-23T01:00:00Z',
          customer_change_note: '오후로',
        });
      },
    });
    const ch = () => slotOf().querySelector('[data-ci-act="change"]');
    ch().click();
    await flush();
    expect(ch().getAttribute('aria-expanded')).toBe('true');
    ch().click();
    await flush();
    expect(slotOf().querySelector('form')).toBeNull();
    ch().click();
    await flush();
    const f = slotOf().querySelector('form[data-ci-form="change"]');
    f.querySelector('textarea').value = '가'.repeat(201);
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(body).toBeNull();
    expect(slotOf().querySelector('.mk-error').textContent).toBe(
      '바라는 것은 200자까지 적을 수 있습니다.'
    );
    slotOf().querySelector('textarea').value = ' 오후로 ';
    slotOf()
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(body).toEqual([WORK + '/me/schedules/' + S1 + '/change', { note: '오후로' }]);
    expect(slotOf().querySelector('[data-ci="asked"]').textContent).toContain(
      '바꿔 달라고 했습니다'
    );
    expect([...slotOf().querySelectorAll('[data-ci-act]')].map((b) => b.textContent)).toEqual([
      '이 날 좋아요',
      '바꿔 주세요',
    ]);
  });

  test('칸이 없는 줄 — 설치 일정 없음 · 끝난 · 취소한 일정 · 보류 프로젝트 · 옛 서버(install 없음)', async () => {
    await load({
      projects: () =>
        ok([
          withInstall(null, { id: 'p-a' }),
          withInstall(inst({ status: 'completed' }), { id: 'p-b' }),
          withInstall(inst({ status: 'cancelled' }), { id: 'p-c' }),
          withInstall(inst(), { id: 'p-d', status: 'on_hold' }),
          project({ id: 'p-e', install_at: '2026-11-28T00:00:00Z' }),
        ]),
    });
    expect($('meProjects').querySelectorAll('[data-install]')).toHaveLength(0);
  });

  test('서버가 막으면 그 글을 칸에 (일정은 그대로)', async () => {
    await load({
      projects: () => ok([withInstall(inst())]),
      sched: () => fail(409, 'not_open', '취소했거나 끝난 일정입니다'),
    });
    slotOf().querySelector('[data-ci-act="ok"]').click();
    await flush();
    expect(slotOf().querySelector('.mk-error').textContent).toBe('취소했거나 끝난 일정입니다');
    expect(slotOf().querySelector('[data-ci="confirmed"]')).toBeNull();
  });
});
