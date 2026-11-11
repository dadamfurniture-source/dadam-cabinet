/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「플랫폼 › A/S 현황」 (segan/as-status.js + segan/me.html #asStatus)
 *
 *   누가    사이트 관리자(is_admin)만. 관리자가 아니면 묻지도 않는다
 *   데이터  workflow-api GET /admin/as-requests?days=7|30|90|180
 *   화면    기간 단추 넷 · 「다시 읽기」 · 숫자 다섯 · 팩토리마다 표 · 접수 줄 — 보기만 한다
 *   못 읽으면 칸째 감춘다 — 관리자에게는 PC 화면 줄 하나가 남는다
 *   팩토리 이름 · 주문번호는 모두 지어낸 것이다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'admin@example.com' } };
const PAY = 'https://pay.example.workers.dev';
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const NOW = Date.parse('2026-11-11T03:00:00Z'); // 한국 시간 2026-11-11 (수) 12:00

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const PLATFORM = ok({
  company: null,
  application: null,
  members: [],
  invites: [],
  platform_member: true,
});
const NOBODY = ok({ company: null, application: null, members: [], invites: [] });

const mod = () => {
  delete window.SeganAsStatus;
  (0, eval)(read('segan/as-status.js'));
  return window.SeganAsStatus;
};

const ITEMS = () => [
  {
    id: 'a-1',
    factory: '예시 가온 팩토리',
    order_no: 'EX-2611-014',
    state: 'requested',
    label: '접수',
    route: 'assignee',
    created_at: '2026-11-10T22:00:00Z', // 5시간 전
    received_at: null,
    done_at: null,
    alerted: false,
  },
  {
    id: 'a-2',
    factory: '예시 나래 주방가구',
    order_no: 'EX-2610-031',
    state: 'requested',
    label: '접수',
    route: 'owners',
    created_at: '2026-11-08T14:00:00Z', // 61시간 전 — 48시간 넘김
    received_at: null,
    done_at: null,
    alerted: true,
  },
  {
    id: 'a-3',
    factory: null,
    order_no: null,
    state: 'done',
    label: null,
    route: 'assignee',
    created_at: '2026-11-01T00:00:00Z',
    received_at: '2026-11-01T06:00:00Z',
    done_at: '2026-11-03T04:00:00Z',
    alerted: false,
  },
];
const STATS = () => ({
  total: 3,
  waiting: 2,
  late: 1,
  avg_receive_hours: 6,
  avg_done_hours: 52,
  factories: [
    {
      company_id: 'f1',
      name: '예시 가온 팩토리',
      count: 2,
      done: 1,
      orders_done: 6,
      as_rate: 33.3,
    },
    { company_id: 'f2', name: null, count: 1, done: 0, orders_done: 0, as_rate: null },
  ],
});
const feed = (days, items = ITEMS(), stats = STATS()) => ok({ ready: true, days, stats, items });

/**
 * 마이페이지를 띄운다 (기본 = 사이트 관리자인 본사 구성원, A/S 현황 화면)
 * opts.list(days, n) 로 답을 바꾼다 (n = 몇 번째 읽기인가) · opts.gate = 둘째 읽기부터 붙잡아 둘 약속
 */
async function load(options = {}) {
  const store = { lists: 0 };
  const opts = {
    session: SESSION,
    partner: PLATFORM,
    hash: '#as-status',
    isAdmin: true,
    list: null,
    gate: null,
    work: WORK,
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/me.html' + opts.hash);
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  localStorage.clear();
  for (const k of [
    'AdminAccess',
    'DetailDesignAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganMake',
    'SeganMe',
    'SeganPartner',
    'SeganPartnerEval',
    'SeganDoneReports',
    'SeganAsStatus',
    'SeganAs',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: opts.work },
    paymentsApi: { url: PAY },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [], store };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async (name) =>
        name === 'is_admin' ? { data: opts.isAdmin, error: null } : { data: [], error: null },
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
    calls.fetch.push({
      url,
      method,
      auth: (init.headers || {}).Authorization,
      cache: init.cache,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url.startsWith(WORK + '/admin/as-requests?days=')) {
      store.lists += 1;
      const n = store.lists;
      const days = Number(url.split('days=')[1]);
      if (opts.gate && n > 1) await opts.gate;
      return reply(opts.list ? await opts.list(days, n) : feed(days));
    }
    if (url === PAY + '/subscription') return reply(ok({ plan: 'free', status: 'active' }));
    if (url === PAY + '/plans') return reply(ok({ client_key: 'k', plans: [] }));
    if (url === WORK + '/work/me') return reply(ok({ ready: true, worker: null }));
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
    'segan/as-status.js',
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
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
/** 화면에 보이는가 — 모듈이 감춘 칸(hidden) · 마이페이지가 끈 칸(me-off) 은 아니다 */
const seen = (id) => !!$(id) && !$(id).hidden && !$(id).classList.contains('me-off');
const box = () => $('asStatusBody');
const q = (sel) => box().querySelector(sel);
const qa = (sel) => [...box().querySelectorAll(sel)];
const part = (name) => q(`[data-as="${name}"]`);
const dayBtn = (n) => q(`[data-act="days"][data-days="${n}"]`);
const rows = () => qa('li[data-as-row]');
const kpi = () =>
  Object.fromEntries(
    qa('[data-as="kpi"] > div').map((d) => [
      d.getAttribute('data-k'),
      [text(d.querySelector('dt')), text(d.querySelector('dd'))],
    ])
  );
const menu = (key) => document.querySelector(`#meHub li[data-me-item="${key}"]`);
const press = async (el) => {
  el.click();
  await flush();
};
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/admin/as-requests'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 완료 보고 다음의 제 칸 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('asStatus');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('SECTION');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.classList.contains('me-screen')).toBe(true);
    expect(el.previousElementSibling.id).toBe('doneReports');
    expect(el.getAttribute('aria-labelledby')).toBe('asStatusTitle');
    expect(text(doc.getElementById('asStatusTitle'))).toBe('A/S 현황');
    expect(doc.getElementById('asStatusBody').parentElement).toBe(el);
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['as-status.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('as-status.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'as-status.js')");
  });

  test('메뉴 — 플랫폼 아래 앱 화면 줄, 바로 다음에 관리자 PC 화면 줄 (둘 다 처음엔 감춘다)', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const li = doc.querySelector('li[data-me-item="as-status"]');
    expect(li).not.toBeNull();
    expect(li.closest('ul').id).toBe('meSubPlatform');
    expect(li.hasAttribute('hidden')).toBe(true);
    const a = li.querySelector('a');
    expect(a.getAttribute('href')).toBe('#as-status');
    expect(a.getAttribute('data-me-go')).toBe('as-status');
    expect(text(a)).toBe('A/S 현황');
    const pc = li.nextElementSibling;
    expect(pc.getAttribute('data-me-item')).toBe('hq-as');
    expect(pc.hasAttribute('hidden')).toBe(true);
    // 관리자 줄 판정은 me.js rowOn 이 한다 — data-need 로는 앱 화면이 있는지 모른다
    expect(pc.hasAttribute('data-need')).toBe(false);
    expect(pc.querySelector('a').getAttribute('href')).toBe('../admin/as-requests.html');
    expect(pc.querySelector('a').hasAttribute('data-desktop-tab')).toBe(true);
  });

  test('기간 · 48시간 · 간 곳 · 상태 이름 · 안내 글은 서버 · PC 화면(admin/as-requests.html)과 같다', () => {
    const A = mod();
    const pc = read('admin/as-requests.html');
    const server = read('workers/workflow-api/src/as-requests.js');
    expect(A.DAYS).toEqual([7, 30, 90, 180]);
    expect(A.DAYS_DEFAULT).toBe(30);
    for (const n of A.DAYS) expect(pc).toContain(`<option value="${n}"`);
    expect(pc).toContain('<option value="30" selected>');
    expect(server).toContain('FEED_DAYS = 30');
    expect(server).toContain('FEED_DAYS_MAX = 180');
    expect(A.ALERT_HOURS).toBe(48);
    expect(server).toContain('ALERT_HOURS = 48');
    expect(pc).toContain('ALERT_HOURS = 48');
    expect(A.ROUTE_LABEL).toEqual({
      assignee: '담당자',
      owners: '대표 · 실장',
      manager: 'MANAGER',
    });
    expect(pc).toContain("{ assignee: '담당자', owners: '대표 · 실장', manager: 'MANAGER' }");
    expect(A.STATE_LABEL).toEqual({
      requested: '접수',
      received: '받음',
      done: '끝',
      cancelled: '거둠',
    });
    expect(server).toContain(
      "{ requested: '접수', received: '받음', done: '끝', cancelled: '거둠' }"
    );
    for (const key of [
      'lead',
      'needSql',
      'reload',
      'fail',
      'loading',
      'total',
      'waiting',
      'avgReceive',
      'avgDone',
      'factories',
      'rateNote',
      'doneAs',
      'doneOrders',
      'rate',
      'noFactories',
      'list',
      'empty',
      'toReceive',
      'toDone',
      'alerted',
    ]) {
      expect(A.TEXT[key].length).toBeGreaterThan(1);
      expect(pc).toContain(A.TEXT[key]);
    }
    expect(A.TEXT.late).toBe('48시간 넘김');
  });

  test('보기만 한다 — 서버에 쓰지 않고, 기기에 남기지 않고, 확인 창도 띄우지 않는다', () => {
    const code = read('segan/as-status.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
    expect(code).not.toMatch(/method:/); // GET 만
    expect(code).not.toMatch(/as-requests\.html['"]/); // PC 화면으로 보내지 않는다
  });

  test('늦은 접수는 색만으로 알리지 않는다 · 그림자 · 둥근 모서리 없음', () => {
    const css = read('segan/shell.css');
    const warn = /\.as-kpi \.as-warn dd\s*\{[^}]*\}/.exec(css);
    expect(warn).not.toBeNull();
    expect(warn[0]).toMatch(/font-weight:\s*500/);
    const late = /\.as \.as-late\s*\{[^}]*\}/.exec(css);
    expect(late).not.toBeNull();
    expect(late[0]).toMatch(/font-weight:\s*500/);
    const rules = css.match(/(^|\n)\.as[-\s][^{]*\{[^}]*\}/g) || [];
    expect(rules.length).toBeGreaterThanOrEqual(7);
    expect(rules.join('\n')).not.toMatch(/box-shadow|border-radius/);
  });
});

describe('순수 함수', () => {
  test('when · span — 한국 시간, 하루가 넘으면 N일 M시간, 없거나 거꾸로면 빈 글', () => {
    const A = mod();
    expect(A.when('2026-11-10T22:00:00Z')).toBe('11.11 07:00');
    expect(A.when('엉뚱')).toBe('');
    expect(A.span('2026-11-01T00:00:00Z', '2026-11-01T06:00:00Z')).toBe('6시간');
    expect(A.span('2026-11-01T00:00:00Z', '2026-11-03T04:00:00Z')).toBe('2일 4시간');
    expect(A.span('2026-11-01T00:00:00Z', '2026-11-01T00:10:00Z')).toBe('0시간');
    expect(A.span('2026-11-01T00:00:00Z', null)).toBe('');
    expect(A.span('2026-11-02T00:00:00Z', '2026-11-01T00:00:00Z')).toBe('');
  });

  test('rowOf · isLate · stateText — 접수 상태로 48시간을 넘겨야 늦은 것', () => {
    const A = mod();
    expect(A.rowOf({ factory: 'x' })).toBeNull();
    const fresh = A.rowOf(ITEMS()[0]);
    const late = A.rowOf(ITEMS()[1]);
    const done = A.rowOf(ITEMS()[2]);
    expect(fresh.route).toBe('담당자');
    expect(late.route).toBe('대표 · 실장');
    expect(late.alerted).toBe(true);
    expect(done.label).toBe('끝'); // 서버 글이 없으면 아는 이름
    expect(done.factory).toBe('');
    expect(A.isLate(fresh, NOW)).toBe(false);
    expect(A.isLate(late, NOW)).toBe(true);
    expect(A.isLate(done, NOW)).toBe(false); // 끝난 것은 오래돼도 늦은 게 아니다
    expect(A.stateText(fresh, NOW)).toBe('접수');
    expect(A.stateText(late, NOW)).toBe('접수 · 48시간 넘김');
    expect(A.rowOf({ id: 1, state: 'toString', route: 'constructor' })).toMatchObject({
      label: 'toString',
      route: 'constructor',
    });
  });

  test('statsOf · feedOf · statusText — 숫자가 아니면 null, 목록이 배열이 아니면 null', () => {
    const A = mod();
    expect(A.statsOf(null)).toBeNull();
    const s = A.statsOf({
      total: 3,
      waiting: '2',
      late: 0,
      avg_receive_hours: null,
      factories: 'x',
    });
    expect(s).toEqual({
      total: 3,
      waiting: null,
      late: 0,
      avgReceive: null,
      avgDone: null,
      factories: [],
    });
    expect(A.feedOf({ items: 'x' }, 30)).toBeNull();
    const f = A.feedOf({ ready: true, days: 180, items: [{ id: 'a' }, {}] }, 30);
    expect(f.days).toBe(180);
    expect(f.items.length).toBe(1);
    expect(f.stats).toBeNull();
    expect(A.statusText(f)).toBe('1건 · 최근 180일');
    expect(A.feedOf({ items: [], days: 365 }, 90).days).toBe(90);
    expect(A.statusText(A.feedOf({ ready: false, items: [] }, 30))).toBe('');
  });
});

describe('화면', () => {
  test('관리자 — 최근 30일을 한 번 읽어 숫자 · 팩토리 표 · 접수 줄을 그린다', async () => {
    const calls = await load();
    expect(asked(calls)).toEqual(['GET /admin/as-requests?days=30']);
    const c = calls.fetch.find((x) => x.url.startsWith(WORK + '/admin/as-requests'));
    expect(c.auth).toBe('Bearer tok-1');
    expect(c.cache).toBe('no-store');
    expect(seen('asStatus')).toBe(true);
    expect(text(part('status'))).toBe('3건 · 최근 30일');
    expect([7, 30, 90, 180].map((n) => dayBtn(n).getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
    expect(kpi()).toEqual({
      total: ['A/S 접수', '3건'],
      waiting: ['아직 안 받음', '2건'],
      late: ['48시간 넘김', '1건'],
      'avg-receive': ['받기까지 평균', '6시간'],
      'avg-done': ['끝까지 평균', '52시간'],
    });
    expect(q('[data-k="late"]').classList.contains('as-warn')).toBe(true);
    // 팩토리마다 — 머리 다섯 칸 · 줄 머리는 팩토리 이름
    expect(qa('.as-table thead th').map(text)).toEqual([
      '팩토리',
      'A/S 접수',
      '끝낸 A/S',
      '끝낸 수주',
      'A/S 율',
    ]);
    expect(qa('.as-table thead th').every((th) => th.getAttribute('scope') === 'col')).toBe(true);
    expect(qa('.as-table tbody tr').map((tr) => [...tr.children].map(text))).toEqual([
      ['예시 가온 팩토리', '2', '1', '6', '33.3%'],
      ['-', '1', '0', '0', '-'],
    ]);
    expect(qa('.as-table tbody th').every((th) => th.getAttribute('scope') === 'row')).toBe(true);
    // 접수 줄
    const li = rows();
    expect(li.map((x) => text(x.querySelector('b')))).toEqual([
      '예시 가온 팩토리',
      '예시 나래 주방가구',
      '팩토리 모름',
    ]);
    expect(li.map((x) => text(x.querySelector('small')))).toEqual([
      '11.11 07:00 · 주문번호 EX-2611-014 · 간 곳 담당자',
      '11.08 23:00 · 주문번호 EX-2610-031 · 간 곳 대표 · 실장',
      '11.01 09:00 · 간 곳 담당자',
    ]);
    expect(li.map((x) => text(x.querySelector('.dr-kind')))).toEqual([
      '접수',
      '접수 · 48시간 넘김',
      '끝',
    ]);
    expect(li.map((x) => x.querySelector('.dr-kind').classList.contains('as-late'))).toEqual([
      false,
      true,
      false,
    ]);
    expect(li[0].querySelector('.dr-note')).toBeNull();
    expect(text(li[1].querySelector('.dr-note'))).toBe('알림 보냄');
    expect(text(li[2].querySelector('.dr-note'))).toBe('받기까지 6시간 · 끝까지 2일 4시간');
    expect(menu('as-status').hidden).toBe(false);
    expect(menu('hq-as').hidden).toBe(true);
  });

  test('늦은 접수가 없으면 — 그 칸을 도드라지게 하지 않는다. 평균이 없으면 -', async () => {
    const stats = { ...STATS(), late: 0, avg_receive_hours: null, avg_done_hours: null };
    await load({ list: (days) => feed(days, ITEMS().slice(0, 1), stats) });
    expect(q('[data-k="late"]').classList.contains('as-warn')).toBe(false);
    expect(kpi()['avg-receive'][1]).toBe('-');
    expect(kpi()['avg-done'][1]).toBe('-');
  });

  test('아무것도 없으면 — 0건과 안내 글 둘. 표가 아직 없으면 — 그 안내만', async () => {
    const none = {
      total: 0,
      waiting: 0,
      late: 0,
      avg_receive_hours: null,
      avg_done_hours: null,
      factories: [],
    };
    await load({ list: (days) => feed(days, [], none) });
    expect(seen('asStatus')).toBe(true);
    expect(text(part('status'))).toBe('0건 · 최근 30일');
    expect(text(part('factories').querySelector('.me-empty'))).toBe(
      '이 기간에 들어온 A/S 와 끝낸 수주가 없습니다.'
    );
    expect(text(part('empty'))).toBe('이 기간에 들어온 A/S 접수가 없습니다.');
    await load({ list: (days) => ok({ ready: false, days, items: [] }) });
    expect(seen('asStatus')).toBe(true);
    expect(text(part('needsql'))).toBe('A/S 접수 칸이 아직 없습니다 — DB 0045 적용 뒤에 보입니다.');
    expect(part('kpi')).toBeNull();
    expect(part('list')).toBeNull();
  });

  test('이름 · 주문번호는 글자 그대로 그린다', async () => {
    const items = ITEMS();
    items[0].factory = '<img src=x onerror=1>';
    items[0].order_no = '<b>x</b>';
    const stats = STATS();
    stats.factories[0].name = '<script>x</script>';
    await load({ list: (days) => feed(days, items, stats) });
    expect(q('img')).toBeNull();
    expect(q('script')).toBeNull();
    expect(text(rows()[0].querySelector('b'))).toBe('<img src=x onerror=1>');
    expect(text(rows()[0].querySelector('small'))).toContain('주문번호 <b>x</b>');
    expect(text(q('.as-table tbody th'))).toBe('<script>x</script>');
  });

  test('A/S 현황 화면에서만 보인다 — 메뉴 줄을 눌러 들어온다', async () => {
    await load({ hash: '' });
    expect(seen('asStatus')).toBe(false);
    await press(menu('as-status').querySelector('a'));
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(seen('asStatus')).toBe(true);
  });
});

describe('기간 · 다시 읽기', () => {
  test('기간 단추 — 그 기간을 다시 읽어 줄 · 건수 · 고른 단추를 바꾼다', async () => {
    const calls = await load({
      list: (days) => feed(days, days === 180 ? ITEMS() : ITEMS().slice(0, 1)),
    });
    expect(rows().length).toBe(1);
    await press(dayBtn(180));
    expect(asked(calls)).toEqual([
      'GET /admin/as-requests?days=30',
      'GET /admin/as-requests?days=180',
    ]);
    expect(rows().length).toBe(3);
    expect(text(part('status'))).toBe('3건 · 최근 180일');
    expect(dayBtn(180).getAttribute('aria-pressed')).toBe('true');
    expect(dayBtn(30).getAttribute('aria-pressed')).toBe('false');
  });

  test('이미 고른 기간은 다시 읽지 않는다. 「다시 읽기」는 지금 기간을 다시 읽는다', async () => {
    const calls = await load();
    await press(dayBtn(30));
    expect(asked(calls).length).toBe(1);
    await press(q('[data-act="reload"]'));
    expect(asked(calls)).toEqual([
      'GET /admin/as-requests?days=30',
      'GET /admin/as-requests?days=30',
    ]);
  });

  test('읽는 동안 — 단추를 잠그고 다시 눌러도 한 번만 읽는다', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const calls = await load({ gate });
    await press(dayBtn(90));
    expect(box().getAttribute('aria-busy')).toBe('true');
    expect(text(part('status'))).toBe('불러오는 중…');
    expect(qa('button').every((b) => b.disabled)).toBe(true);
    expect(rows().length).toBe(3); // 있던 줄은 그대로
    await press(dayBtn(7));
    await press(q('[data-act="reload"]'));
    release();
    await flush();
    await flush();
    expect(asked(calls).length).toBe(2);
    expect(box().hasAttribute('aria-busy')).toBe(false);
    expect(dayBtn(90).getAttribute('aria-pressed')).toBe('true');
  });

  test('다시 읽다가 못 읽으면 — 있던 것 · 고른 기간은 그대로 두고 글만 남긴다', async () => {
    await load({
      list: (days, n) => (n === 1 ? feed(days) : fail(400, 'invalid', 'days 는 1~180 입니다')),
    });
    await press(dayBtn(90));
    expect(text(part('err'))).toBe('days 는 1~180 입니다');
    expect(rows().length).toBe(3);
    expect(text(part('status'))).toBe('3건 · 최근 30일');
    expect(dayBtn(30).getAttribute('aria-pressed')).toBe('true');
    expect(seen('asStatus')).toBe(true);
  });

  test('끊기거나 이상한 답 — 기본 글', async () => {
    for (const second of [() => new Error('offline'), () => ok({ items: 'x' })]) {
      await load({ list: (days, n) => (n === 1 ? feed(days) : second()) });
      await press(q('[data-act="reload"]'));
      expect(text(part('err'))).toBe('불러오지 못했습니다.');
      expect(rows().length).toBe(3);
    }
  });
});

describe('관리자 PC 화면 줄', () => {
  test('처음에 못 읽은 관리자 — 앱 화면은 감추고 PC 화면 줄이 남는다', async () => {
    await load({ list: () => fail(404, 'not_found', 'Not found') });
    expect(seen('asStatus')).toBe(false);
    expect(menu('as-status').hidden).toBe(true);
    expect(menu('hq-as').hidden).toBe(false);
  });

  test('관리자가 아니면 — 두 줄 다 없다', async () => {
    await load({ isAdmin: false });
    expect(menu('as-status').hidden).toBe(true);
    expect(menu('hq-as').hidden).toBe(true);
  });
});

describe('안 보이는 때', () => {
  test('관리자가 아닌 사람 · 로그인하지 않은 사람 · 워커 주소가 없을 때 — 묻지 않는다', async () => {
    for (const o of [
      { isAdmin: false },
      { isAdmin: false, partner: NOBODY },
      { session: null },
      { work: '' },
    ]) {
      const calls = await load(o);
      expect(asked(calls)).toEqual([]);
      expect(seen('asStatus')).toBe(false);
      expect(box().innerHTML).toBe('');
    }
  }, 20000);

  test('처음에 못 읽으면(403 · 오류 · 끊김 · 목록 없는 답) — 칸째 감춘다', async () => {
    for (const list of [
      () => fail(403, 'forbidden', '관리자만 볼 수 있습니다'),
      () => ({ ok: false, status: 500, body: {} }),
      () => new Error('offline'),
      () => ok({ items: 'x' }),
      () => ok(null),
    ]) {
      const calls = await load({ list });
      expect(asked(calls)).toEqual(['GET /admin/as-requests?days=30']);
      expect(seen('asStatus')).toBe(false);
      expect($('asStatus').hidden).toBe(true);
      expect(box().innerHTML).toBe('');
      expect(menu('as-status').hidden).toBe(true);
    }
  }, 20000);
});
