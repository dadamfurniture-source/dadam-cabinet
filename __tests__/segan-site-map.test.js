/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「프로젝트 관리 › 설치 · A/S」 의 현장 지도 + 표 (segan/site-map.js + segan/me.html #siteInstall · #siteAs)
 *
 *   누가    설치 = 업무 달력을 보는 구성원(다담 공장 · Manager · Expert · Agent), A/S = A/S함을 보는 구성원(다담 공장 · Expert · Agent)
 *           볼 수 없는 사람은 묻지도 않고 칸이 없다. 못 읽으면 칸째 감춘다
 *   데이터  workflow-api GET /company/sites?kind=install|as (본인 토큰) → { can_manage, today, ready, range, items }
 *   지도    카카오맵 — 키가 없으면 「준비 중」 한 줄, 표는 그대로. 좌표 없는 주소는 브라우저에서 찾아 PUT /company/sites/geo
 *   고치기  can_manage(대표 · 실장) 일 때만 — 설치 PATCH /schedules/:id (바뀐 것만), A/S PUT /company/as-requests/:id/visit
 *   이름 · 주소는 모두 지어낸 것이다
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
const S1 = '55555555-5555-4555-8555-555555555551';
const S2 = '55555555-5555-4555-8555-555555555552';
const S3 = '55555555-5555-4555-8555-555555555553';
const S9 = '55555555-5555-4555-8555-555555555559';
const D1 = '66666666-6666-4666-8666-666666666661';
const D2 = '66666666-6666-4666-8666-666666666662';
const D3 = '66666666-6666-4666-8666-666666666663';
const A1 = '77777777-7777-4777-8777-777777777771';
const A2 = '77777777-7777-4777-8777-777777777772';
const A3 = '77777777-7777-4777-8777-777777777773';
const NOW = Date.parse('2026-11-10T03:00:00Z'); // 한국 시간 2026-11-10 (화) 12:00
const ADDR1 = '시험도 시험시 시험로 1';
const ADDR2 = '가람도 가람시 가람로 2';

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

const site = (extra = {}) => ({
  design: null,
  project_id: null,
  project_title: '',
  order_no: null,
  address: '',
  address_detail: '',
  sido: '',
  gugun: '',
  lat: null,
  lng: null,
  needs_geo: false,
  ...extra,
});
// 설치 1 = 오늘 · 좌표 있음 · 팀 있음, 2 = 이번 주 납품 · 좌표 없음(주소만) · 팀 없음, 3 = 끝남 · 주소 없음
const INSTALL = [
  site({
    key: 'schedule:' + S1,
    schedule_id: S1,
    type: 'installation',
    label: '설치',
    day: '2026-11-10',
    time: '10:00',
    at: '2026-11-10T01:00:00Z',
    status: 'scheduled',
    assignee_name: '설치 1팀',
    design: { id: D1, name: '싱크대 A' },
    project_id: P1,
    project_title: '시험 주방',
    order_no: 'DD-1',
    address: ADDR1,
    address_detail: '101동 1호',
    sido: '시험도',
    gugun: '시험시',
    lat: 36.1,
    lng: 128.1,
  }),
  site({
    key: 'schedule:' + S2,
    schedule_id: S2,
    type: 'delivery',
    label: '납품',
    day: '2026-11-12',
    time: '14:00',
    at: '2026-11-12T05:00:00Z',
    status: 'confirmed',
    assignee_name: null,
    design: { id: D2, name: '붙박이장 B' },
    project_title: '가람 붙박이장',
    order_no: 'DD-2',
    address: ADDR2,
    address_detail: '2층',
    needs_geo: true,
  }),
  site({
    key: 'schedule:' + S3,
    schedule_id: S3,
    type: 'installation',
    label: '설치',
    day: '2026-11-20',
    time: '09:00',
    at: '2026-11-20T00:00:00Z',
    status: 'completed',
    assignee_name: '설치 2팀',
    design: { id: D3, name: '신발장 C' },
    project_title: '',
    order_no: 'DD-3',
  }),
  { key: 'schedule:x', schedule_id: '', day: '2026-11-10' }, // 일정 번호가 없다 — 뺀다
  { key: 'schedule:y', schedule_id: 'y', day: '11-10' }, // 날이 아니다 — 뺀다
];
// A/S 1 = 접수 · 방문 미정, 2 = 받음 · 방문 잡힘(담당 있음), 3 = 끝
const AS = [
  site({
    key: 'as:' + A1,
    as_id: A1,
    state: 'requested',
    label: '접수',
    day: '2026-11-09',
    at: '2026-11-09T02:00:00Z',
    body: '문짝이 처졌습니다',
    visit: null,
    design: { id: D1, name: '싱크대 A' },
    project_title: '시험 주방',
    order_no: 'DD-1',
    address: ADDR1,
    sido: '시험도',
    gugun: '시험시',
    lat: 36.1,
    lng: 128.1,
  }),
  site({
    key: 'as:' + A2,
    as_id: A2,
    state: 'received',
    label: '받음',
    day: '2026-11-05',
    at: '2026-11-05T02:00:00Z',
    body: '서랍이 뻑뻑합니다',
    visit: {
      schedule_id: S9,
      day: '2026-11-13',
      time: '15:00',
      at: '2026-11-13T06:00:00Z',
      assignee_name: '김기사',
      status: 'scheduled',
    },
    design: { id: D2, name: '붙박이장 B' },
    project_title: '가람 붙박이장',
    order_no: 'DD-2',
    address: ADDR2,
    needs_geo: true,
  }),
  site({
    key: 'as:' + A3,
    as_id: A3,
    state: 'done',
    label: '끝',
    day: '2026-10-20',
    body: '경첩 교체',
    visit: null,
    design: { id: D3, name: '신발장 C' },
    order_no: 'DD-3',
  }),
  { key: 'as:z', as_id: 'z', state: 'unknown' }, // 모르는 상태 — 뺀다
];
const sites = (kind, extra = {}) => ({
  company: { id: CO, name: '다담 협력 주방' },
  can_manage: true,
  kind,
  range: kind === 'install' ? { from: '2026-11-03', to: '2027-01-09' } : null,
  today: '2026-11-10',
  ready: true,
  truncated: false,
  items: kind === 'install' ? INSTALL : AS,
  ...extra,
});
const PROJECTS = {
  company: { id: CO, name: '다담 협력 주방', kind: 'partner', plan: 'expert' },
  can_manage: true,
  items: [],
};

/**
 * 가짜 카카오맵 — found = { 주소: { x, y, address } } (없는 주소는 못 찾음).
 * 그린 것은 kakao._overlays (지도에 올라간 것만 map 이 있다), 찾은 주소는 kakao._asked
 */
function fakeKakao(found = {}) {
  const k = { _overlays: [], _asked: [], _maps: [] };
  k.maps = {
    load: (cb) => cb(),
    LatLng: function (lat, lng) {
      this.lat = lat;
      this.lng = lng;
    },
    LatLngBounds: function () {
      this.points = [];
      this.extend = (p) => this.points.push(p);
    },
    Map: function (el, options) {
      this.el = el;
      this.options = options;
      this.setBounds = jest.fn();
      this.setCenter = jest.fn();
      this.setLevel = jest.fn();
      this.relayout = jest.fn();
      k._maps.push(this);
    },
    CustomOverlay: function (options) {
      this.options = options;
      this.map = null;
      this.setMap = (m) => {
        this.map = m;
      };
      k._overlays.push(this);
    },
    services: {
      Status: { OK: 'OK' },
      Geocoder: function () {
        this.addressSearch = (addr, cb) => {
          k._asked.push(addr);
          if (found[addr]) cb([found[addr]], 'OK');
          else cb([], 'ZERO_RESULT');
        };
      },
    },
  };
  return k;
}
const FOUND2 = {
  [ADDR2]: {
    x: '127.5',
    y: '35.9',
    address: { region_1depth_name: '가람도', region_2depth_name: '가람시' },
  },
};

/**
 * me.html 을 올린다 (#p-install).
 * opts.install(url) · opts.as(url) → GET /company/sites?kind= 응답, opts.geo(body) → PUT /company/sites/geo,
 * opts.patch(body, url) → PATCH /schedules/:id, opts.visit(body, url) → PUT /company/as-requests/:id/visit,
 * opts.kakao → window.kakao (없으면 SDK 없음), opts.key → DADAM_CONFIG.kakaoJsKey
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: partnerMe(),
    hash: '#p-install',
    install: () => ok(sites('install')),
    as: () => ok(sites('as')),
    geo: (body) => ok({ saved: body.items.length, skipped: 0 }),
    patch: () => ok({ id: S1 }),
    visit: () => ok({ id: A1, visit: { schedule_id: S9 } }),
    kakao: null,
    key: '',
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
    'SeganPartnerProjects',
    'SeganCalendar',
    'SeganSiteMap',
    'SeganAs',
    'SeganRegions',
    'TossPayments',
    'kakao',
  ])
    delete window[k];
  if (opts.kakao) window.kakao = opts.kakao;
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
    paymentsApi: { url: PAY },
    accountApi: { url: ACC },
  };
  if (opts.key) window.DADAM_CONFIG.kakaoJsKey = opts.key;
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
    const method = init.method || 'GET';
    calls.fetch.push({ url, method, auth: (init.headers || {}).Authorization, body });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/company/sites/geo') return reply(await opts.geo(body));
    if (url.startsWith(WORK + '/company/sites'))
      return reply(await (url.includes('kind=as') ? opts.as(url) : opts.install(url)));
    if (url.startsWith(WORK + '/company/as-requests/') && url.endsWith('/visit'))
      return reply(await opts.visit(body, url));
    if (url.startsWith(WORK + '/company/schedules'))
      return reply(
        ok({
          company: { id: CO, name: '다담 협력 주방' },
          can_manage: true,
          range: { from: '2026-11-01', to: '2026-12-12' },
          today: '2026-11-10',
          truncated: false,
          items: [],
        })
      );
    if (url === WORK + '/company/projects') return reply(ok(PROJECTS));
    if (url.startsWith(WORK + '/schedules/')) return reply(await opts.patch(body, url));
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
    'segan/calendar.js',
    'segan/site-map.js',
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

/** 지도 스크립트만 올린다 — 순수 함수 시험 */
function lib() {
  delete window.SeganSiteMap;
  (0, eval)(read('segan/site-map.js'));
  return window.SeganSiteMap;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
/** 화면에 보이는가 — 모듈이 감춘 칸(hidden) · 마이페이지가 끈 칸(me-off) 은 아니다 */
const seen = (id) => !!$(id) && !$(id).hidden && !$(id).classList.contains('me-off');
const click = async (id, sel) => {
  $(id).querySelector(sel).click();
  await flush();
};
// 표의 줄 — '번호 | 칸 | 칸 …'
const rows = (id) =>
  [...$(id).querySelectorAll('.sm-row')].map((tr) => [...tr.children].map(text).join(' | '));
const tabs = (id) =>
  [...$(id).querySelectorAll('[data-act="tab"]')].map(
    (b) => text(b) + (b.getAttribute('aria-pressed') === 'true' ? ' ←' : '')
  );
const options = (id, name) =>
  [...$(id).querySelectorAll(`select[data-filter="${name}"] option`)].map((o) => o.textContent);
const choose = async (id, name, value) => {
  const el = $(id).querySelector(`select[data-filter="${name}"]`);
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
};
const detail = (id) => {
  const el = $(id).querySelector('.sm-detail');
  if (!el) return null;
  const out = { title: text(el.querySelector('.sm-detail-title')) };
  for (const d of el.querySelectorAll('.sm-dl > div'))
    out[text(d.querySelector('dt'))] = text(d.querySelector('dd'));
  return out;
};
const setValue = (id, name, v) => {
  $(id).querySelector(`form [name="${name}"]`).value = v;
};
const submit = async (id) => {
  $(id)
    .querySelector('form[data-form]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
};
const formErr = (id) => {
  const el = $(id).querySelector('form [data-err]');
  return el && !el.hidden ? el.textContent : '';
};
const mapMsg = (id) => {
  const el = $(id).querySelector('[data-sm="mapmsg"]');
  return el.hidden ? '' : el.textContent;
};
const mapNote = (id) => {
  const el = $(id).querySelector('[data-sm="mapnote"]');
  return el.hidden ? '' : el.textContent;
};
/** 지도에 올라가 있는 핀 단추 (그 칸의 지도만) */
const pins = (kakao, id) => {
  const canvas = $(id).querySelector('[data-sm="canvas"]');
  return kakao._overlays.filter((o) => o.map && o.map.el === canvas).map((o) => o.options.content);
};
const siteCalls = (calls, kind) =>
  calls.fetch.filter((f) => f.url === WORK + '/company/sites?kind=' + kind);
const writes = (calls) => calls.fetch.filter((f) => f.method !== 'GET');

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
  for (const s of [...document.head.querySelectorAll('script[src*="dapi.kakao.com"]')]) s.remove();
  delete window.kakao;
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸(#partner) 안, 설치 지도는 프로젝트 위 · A/S 지도는 A/S함 위, 처음엔 감춘다 · 달력 다음에 읽는다 · 서비스 워커가 담는다', () => {
    const html = read('segan/me.html');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const install = doc.getElementById('siteInstall');
    const as = doc.getElementById('siteAs');
    for (const el of [install, as]) {
      expect(el).not.toBeNull();
      expect(el.hasAttribute('hidden')).toBe(true);
      expect(el.closest('section').id).toBe('partner');
      expect(el.classList.contains('sm')).toBe(true);
    }
    expect(install.nextElementSibling.id).toBe('partnerProjects');
    expect(as.nextElementSibling.id).toBe('as');
    const srcs = [...doc.querySelectorAll('script[src]')].map((s) =>
      s.getAttribute('src').replace(/\?.*$/, '')
    );
    // 없으면(-1) 차례 비교가 거짓으로 통과하지 않게 자리부터 본다
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['calendar.js', 'site-map.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('site-map.js')).toBeGreaterThan(at('calendar.js'));
    expect(at('site-map.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'site-map.js')");
  });

  test('키 자리 — 지도 키는 공용 설정 파일 한 곳에만 (화면 코드는 빈 칸). 지도 회사 주소로는 SDK 만 부른다', () => {
    const src = read('segan/site-map.js');
    expect(src).toMatch(/var KAKAO_JS_KEY = '';/);
    // 설정 파일의 키는 화면이 받는 모양(영문 · 숫자 16~64자)이어야 지도가 켜진다
    const cfg = read('js/config.js').match(/kakaoJsKey: '([^']*)'/);
    expect(cfg).not.toBeNull();
    expect(cfg[1]).toMatch(/^[0-9a-zA-Z]{16,64}$/);
    expect(read('segan/me.html')).toMatch(/<script src="\.\.\/js\/config\.js\?v=\d+"><\/script>/);
    expect(src.match(/https?:\/\/[^'"\s]+/g).filter((u) => !u.includes('dapi.kakao.com'))).toEqual(
      []
    );
    // 현장 주소를 브라우저 저장소에 두지 않는다
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });
});

describe('순수 함수', () => {
  test('누가 보나 — 설치 = Manager · Expert · Agent · 다담 공장, A/S = Expert · Agent · 다담 공장', () => {
    const M = lib();
    const me = (plan, role = 'owner') => ({ company: { plan, role } });
    expect(M.canSee(me('manager'))).toBe(true);
    expect(M.canSee(me('expert', 'staff'))).toBe(true);
    expect(M.canSee(me('free'))).toBe(false);
    expect(M.canSee(me('agent', 'guest'))).toBe(false);
    expect(M.canSee({ hq_member: true })).toBe(true);
    expect(M.canSee(null)).toBe(false);
    expect(M.canSeeAs(me('manager'))).toBe(false);
    expect(M.canSeeAs(me('expert'))).toBe(true);
    expect(M.canSeeAs(me('agent', 'manager'))).toBe(true);
    expect(M.canSeeAs({ hq_member: true })).toBe(true);
  });

  test('본문 읽기 — 모양이 맞는 줄만, 나라 밖 좌표는 없는 것으로, ready 는 false 일 때만 꺼진다', () => {
    const M = lib();
    const d = M.dataOf({ success: true, data: sites('install') }, 'install');
    expect(d.items.map((x) => x.schedule_id)).toEqual([S1, S2, S3]);
    expect(d).toMatchObject({ manage: true, today: '2026-11-10', ready: true, truncated: false });
    expect(d.range).toEqual({ from: '2026-11-03', to: '2027-01-09' });
    expect(M.dataOf({ success: true, data: sites('as') }, 'as').items.map((x) => x.as_id)).toEqual([
      A1,
      A2,
      A3,
    ]);
    expect(M.dataOf({ success: true, data: sites('as') }, 'install')).toBeNull(); // 다른 화면의 본문
    expect(M.dataOf({ success: false, data: sites('install') }, 'install')).toBeNull();
    expect(M.dataOf({ success: true, data: { ready: true } }, 'install')).toBeNull();
    const out = M.dataOf(
      {
        success: true,
        data: sites('install', {
          ready: false,
          can_manage: 'yes',
          items: [{ ...INSTALL[0], lat: 10, lng: 128 }],
        }),
      },
      'install'
    );
    expect(out.ready).toBe(false);
    expect(out.manage).toBe(false);
    expect(out.items[0].lat).toBeNull();
    expect(out.items[0].lng).toBeNull();
  });

  test('색 · 거르기 — 설치: 끝남 · 진행 중 · 팀 미정, A/S: 끝 · 방문일 미정 · 담당 미정 (취소된 방문은 미정)', () => {
    const M = lib();
    const ins = M.dataOf({ success: true, data: sites('install') }, 'install').items;
    expect(ins.map((x) => M.pinTone('install', x))).toEqual(['info', 'bad', 'ok']);
    expect(M.pinTone('install', { ...ins[0], status: 'in_progress' })).toBe('warn');
    expect(M.tabsOf('install', ins, '2026-11-10').map((t) => t.label + ' ' + t.n)).toEqual([
      '전체 3',
      '오늘 1',
      '이번 주 2',
      '팀 미정 1',
    ]);
    expect(M.weekOf('2026-11-10')).toEqual({ from: '2026-11-08', to: '2026-11-14' });
    const as = M.dataOf({ success: true, data: sites('as') }, 'as').items;
    expect(as.map((x) => M.pinTone('as', x))).toEqual(['warn', 'info', 'ok']);
    const cancelled = { ...as[1], visit: { ...as[1].visit, status: 'cancelled' } };
    expect(M.visitOf(cancelled)).toBeNull();
    expect(M.pinTone('as', cancelled)).toBe('warn');
    expect(M.pinTone('as', { ...as[1], visit: { ...as[1].visit, assignee_name: '' } })).toBe('bad');
    expect(M.tabsOf('as', as, '2026-11-10').map((t) => t.label + ' ' + t.n)).toEqual([
      '전체 3',
      '처리 중 2',
      '끝남 1',
      '담당 미정 1',
    ]);
    expect(M.teamsOf('install', ins)).toEqual(['설치 1팀', '설치 2팀']);
    expect(M.teamsOf('as', as)).toEqual(['김기사']);
    expect(
      M.filterItems('install', ins, { tab: 'week', team: '설치 1팀' }, '2026-11-10', {}).map(
        (x) => x.schedule_id
      )
    ).toEqual([S1]);
  });

  test('지역 · 좌표 — 서버 값 먼저, 다음은 이 화면에서 찾은 것, 없으면 주소의 앞 두 마디를 보여 주기만', () => {
    const M = lib();
    const ins = M.dataOf({ success: true, data: sites('install') }, 'install').items;
    expect(M.regionOf(ins[0], {})).toEqual({ area: '시험도', text: '시험도 시험시' });
    expect(M.regionOf(ins[1], {})).toEqual({ area: '가람도', text: '가람도 가람시' });
    expect(M.regionOf(ins[2], {})).toEqual({ area: '', text: '' });
    const memo = { [D2 + '|' + ADDR2]: { lat: 35.9, lng: 127.5, sido: '새도', gugun: '새시' } };
    expect(M.regionOf(ins[1], memo).text).toBe('새도 새시');
    expect(M.coordOf(ins[0], {})).toEqual({ lat: 36.1, lng: 128.1 });
    expect(M.coordOf(ins[1], {})).toBeNull();
    expect(M.coordOf(ins[1], memo)).toEqual({ lat: 35.9, lng: 127.5 });
    expect(M.regionsOf(ins, {})).toEqual(['가람도', '시험도']);
  });

  test('주소 찾기 대상 — 좌표가 필요한 줄만, 같은 설계 · 주소는 한 번, 찾아 본 것은 다시 안 찾는다, 상세 주소는 안 보낸다', () => {
    const M = lib();
    const ins = M.dataOf({ success: true, data: sites('install') }, 'install').items;
    const as = M.dataOf({ success: true, data: sites('as') }, 'as').items;
    const all = ins.concat(as);
    expect(M.geoTargets(all, {}, 20)).toEqual([{ design_id: D2, address: ADDR2 }]);
    expect(M.geoTargets(all, { [D2 + '|' + ADDR2]: null }, 20)).toEqual([]);
    expect(M.geoTargets(all, {}, 0)).toEqual([]);
  });

  test('설치 고치기 — 바뀐 것만 담는다 · 팀을 비우면 null · 틀린 날짜 · 시각 · 긴 이름은 칸 이름과 글', () => {
    const M = lib();
    const it = M.dataOf({ success: true, data: sites('install') }, 'install').items[0];
    const same = { date: '2026-11-10', time: '10:00', team: '설치 1팀', status: 'scheduled' };
    expect(M.patchOf(it, same)).toEqual({ patch: {} });
    expect(M.patchOf(it, { ...same, date: '2026-11-11' })).toEqual({
      patch: { scheduled_at: '2026-11-11T10:00:00+09:00' },
    });
    expect(M.patchOf(it, { ...same, team: ' ', status: 'in_progress' })).toEqual({
      patch: { assignee_name: null, status: 'in_progress' },
    });
    expect(M.patchOf(it, { ...same, status: 'cancelled' })).toEqual({ patch: {} }); // 취소는 달력에서
    expect(M.patchOf(it, { ...same, date: '' })).toEqual({
      error: 'date',
      message: M.TEXT.needDate,
    });
    expect(M.patchOf(it, { ...same, time: '25:00' }).error).toBe('time');
    expect(M.patchOf(it, { ...same, team: '가'.repeat(51) }).error).toBe('team');
  });

  test('A/S 방문 잡기 — 방문 때 · 담당을 담는다, 지금 방문과 같으면 same', () => {
    const M = lib();
    const as = M.dataOf({ success: true, data: sites('as') }, 'as').items;
    expect(M.visitBodyOf(as[0], { date: '2026-11-14', time: '10:00', team: '' })).toEqual({
      body: { visit_at: '2026-11-14T10:00:00+09:00', assignee_name: null },
      same: false,
    });
    expect(M.visitBodyOf(as[1], { date: '2026-11-13', time: '15:00', team: '김기사' }).same).toBe(
      true
    );
    expect(M.visitBodyOf(as[1], { date: '2026-11-13', time: '15:00', team: '박기사' }).same).toBe(
      false
    );
    expect(M.visitBodyOf(as[0], { date: 'x', time: '10:00', team: '' }).error).toBe('date');
  });

  test('핀 묶기 — 같은 자리는 핀 하나, 번호 · 색은 고른 줄 · 누를 때마다 다음 줄', () => {
    const M = lib();
    const row = (n, key, lat, lng, tone) => ({
      n,
      item: { key },
      coord: lat == null ? null : { lat, lng },
      tone,
    });
    const list = [
      row(1, 'a', 36.1, 128.1, 'info'),
      row(2, 'b', 36.1, 128.1, 'bad'),
      row(3, 'c', null, null, 'ok'),
      row(4, 'd', 35.9, 127.5, 'ok'),
    ];
    expect(M.groupPins(list, '')).toEqual([
      { lat: 36.1, lng: 128.1, keys: ['a', 'b'], n: 1, tone: 'info', on: false },
      { lat: 35.9, lng: 127.5, keys: ['d'], n: 4, tone: 'ok', on: false },
    ]);
    expect(M.groupPins(list, 'b')[0]).toMatchObject({ n: 2, tone: 'bad', on: true });
    expect(M.nextKey(['a', 'b'], '')).toBe('a');
    expect(M.nextKey(['a', 'b'], 'a')).toBe('b');
    expect(M.nextKey(['a', 'b'], 'b')).toBe('a');
  });
});

describe('설치 화면 (#p-install)', () => {
  test('지도 칸 + 표가 설치 단계 프로젝트 위에 보인다 — 본인 토큰으로 한 번 읽는다 · A/S 칸은 이 화면에 없다', async () => {
    const calls = await load();
    expect(seen('siteInstall')).toBe(true);
    expect(seen('siteAs')).toBe(false);
    expect(siteCalls(calls, 'install')).toHaveLength(1);
    expect(siteCalls(calls, 'install')[0].auth).toBe('Bearer tok-1');
    expect(text($('siteInstallTitle'))).toBe('설치 현장');
    expect($('siteInstall').getAttribute('aria-labelledby')).toBe('siteInstallTitle');
    expect(text($('siteInstall').querySelector('.sm-range'))).toBe(
      '11월 3일 (화) ~ 1월 9일 (토) 납품 · 설치 일정'
    );
    expect(tabs('siteInstall')).toEqual(['전체 3 ←', '오늘 1', '이번 주 2', '팀 미정 1']);
    expect(rows('siteInstall')).toEqual([
      '1 | 11/10 (화) | 10:00 | 시험 주방싱크대 A · DD-1 | 시험도 시험시 | 설치 1팀 | 설치 · 예정',
      '2 | 11/12 (목) | 14:00 | 가람 붙박이장붙박이장 B · DD-2 | 가람도 가람시 | 미정 | 납품 · 확정',
      '3 | 11/20 (금) | 09:00 | 신발장 CDD-3 | — | 설치 2팀 | 설치 · 끝남',
    ]);
    expect(
      [...$('siteInstall').querySelectorAll('.sm-num')].map((b) =>
        b.className.replace('sm-num ', '')
      )
    ).toEqual(['sm-num--info', 'sm-num--bad', 'sm-num--ok']);
    expect([...$('siteInstall').querySelectorAll('.sm-legend li')].map(text)).toEqual([
      '예정 · 확정',
      '진행 중',
      '팀 미정',
      '끝남',
    ]);
    expect(writes(calls)).toEqual([]);
  });

  test('걸러 보기 — 단추 · 설치팀 · 지역, 맞는 줄이 없으면 그 글', async () => {
    await load();
    await click('siteInstall', '[data-tab="week"]');
    expect(tabs('siteInstall')[2]).toBe('이번 주 2 ←');
    expect(rows('siteInstall').map((r) => r.split(' | ')[1])).toEqual(['11/10 (화)', '11/12 (목)']);
    await click('siteInstall', '[data-tab="unset"]');
    expect(rows('siteInstall')).toHaveLength(1);
    expect(rows('siteInstall')[0]).toContain('가람 붙박이장');
    await click('siteInstall', '[data-tab="all"]');
    expect(options('siteInstall', 'team')).toEqual(['전체', '설치 1팀', '설치 2팀']);
    expect(options('siteInstall', 'region')).toEqual(['전체', '가람도', '시험도']);
    await choose('siteInstall', 'team', '설치 2팀');
    expect(rows('siteInstall').map((r) => r.split(' | ')[1])).toEqual(['11/20 (금)']);
    await choose('siteInstall', 'region', '시험도');
    expect(rows('siteInstall')).toEqual([]);
    expect(text($('siteInstall').querySelector('.me-empty'))).toBe(
      '이 조건에 맞는 일정이 없습니다.'
    );
    // 고른 값은 다시 그려도 남는다
    expect($('siteInstall').querySelector('select[data-filter="team"]').value).toBe('설치 2팀');
  });

  test('줄을 누르면 현장 정보 — 상세 주소까지, 연락처 · 금액 칸은 없다 · 닫기', async () => {
    await load();
    await click('siteInstall', '.sm-row[data-key="schedule:' + S1 + '"] td');
    expect(detail('siteInstall')).toEqual({
      title: '1시험 주방',
      일정: '11월 10일 (화) 10:00',
      종류: '설치',
      설치팀: '설치 1팀',
      상태: '예정',
      프로젝트: '시험 주방',
      설계: '싱크대 A',
      '수주 번호': 'DD-1',
      '현장 주소': ADDR1 + ' 101동 1호',
    });
    expect($('siteInstall').querySelector('.sm-row--on').getAttribute('data-key')).toBe(
      'schedule:' + S1
    );
    expect(
      $('siteInstall').querySelector('.sm-num[aria-pressed="true"]').getAttribute('aria-label')
    ).toBe('1번 시험 주방');
    await click('siteInstall', '.sm-row[data-key="schedule:' + S3 + '"] .sm-num');
    expect(detail('siteInstall')).toMatchObject({
      title: '3신발장 C',
      '현장 주소': '현장 주소가 없습니다.',
    });
    await click('siteInstall', '[data-act="unpick"]');
    expect(detail('siteInstall')).toBeNull();
  });

  test('고치기 — 날짜 · 설치팀 · 상태 중 바뀐 것만 PATCH /schedules/:id, 다시 읽고 「저장했습니다.」 · 업무 달력도 다시 읽는다', async () => {
    let n = 0;
    const calls = await load({
      install: () => {
        n += 1;
        if (n === 1) return ok(sites('install'));
        const moved = INSTALL.map((x, i) =>
          i === 0 ? { ...x, day: '2026-11-11', assignee_name: '설치 3팀', status: 'confirmed' } : x
        );
        return ok(sites('install', { items: moved }));
      },
    });
    const calBefore = calls.fetch.filter((f) =>
      f.url.startsWith(WORK + '/company/schedules')
    ).length;
    await click('siteInstall', '.sm-row[data-key="schedule:' + S1 + '"] td');
    await click('siteInstall', '[data-act="edit"]');
    const form = $('siteInstall').querySelector('form[data-form="edit"]');
    expect(form.elements.date.value).toBe('2026-11-10');
    expect(form.elements.time.value).toBe('10:00');
    expect(form.elements.team.value).toBe('설치 1팀');
    expect([...form.elements.status.options].map((o) => o.textContent)).toEqual([
      '예정',
      '확정',
      '진행 중',
      '끝남',
    ]);
    setValue('siteInstall', 'date', '2026-11-11');
    setValue('siteInstall', 'team', '설치 3팀');
    setValue('siteInstall', 'status', 'confirmed');
    await submit('siteInstall');
    expect(writes(calls)).toEqual([
      {
        url: WORK + '/schedules/' + S1,
        method: 'PATCH',
        auth: 'Bearer tok-1',
        body: {
          scheduled_at: '2026-11-11T10:00:00+09:00',
          assignee_name: '설치 3팀',
          status: 'confirmed',
        },
      },
    ]);
    expect(siteCalls(calls, 'install')).toHaveLength(2);
    expect($('siteInstall').querySelector('form')).toBeNull();
    expect(text($('siteInstall').querySelector('.me-pt-msg'))).toBe('저장했습니다.');
    expect(detail('siteInstall')).toMatchObject({
      일정: '11월 11일 (수) 10:00',
      설치팀: '설치 3팀',
      상태: '확정',
    });
    expect(
      calls.fetch.filter((f) => f.url.startsWith(WORK + '/company/schedules')).length
    ).toBeGreaterThan(calBefore);
  });

  test('바뀐 것이 없으면 부르지 않고 닫는다 · 날짜가 비면 그 칸 글 · 서버가 막으면 그 글을 두고 적던 값도 둔다', async () => {
    const calls = await load({
      patch: () => fail(409, 'stale', '다른 사람이 먼저 고쳤습니다. 다시 읽어 주세요.'),
    });
    await click('siteInstall', '.sm-row[data-key="schedule:' + S1 + '"] td');
    await click('siteInstall', '[data-act="edit"]');
    await submit('siteInstall');
    expect(writes(calls)).toEqual([]);
    expect($('siteInstall').querySelector('form')).toBeNull();
    await click('siteInstall', '[data-act="edit"]');
    setValue('siteInstall', 'date', '');
    await submit('siteInstall');
    expect(formErr('siteInstall')).toBe('날짜를 골라 주세요.');
    expect(writes(calls)).toEqual([]);
    setValue('siteInstall', 'date', '2026-11-12');
    setValue('siteInstall', 'team', '설치 9팀');
    await submit('siteInstall');
    expect(writes(calls)).toHaveLength(1);
    expect(formErr('siteInstall')).toBe('다른 사람이 먼저 고쳤습니다. 다시 읽어 주세요.');
    expect($('siteInstall').querySelector('form [name="team"]').value).toBe('설치 9팀');
    expect(siteCalls(calls, 'install')).toHaveLength(1);
    await click('siteInstall', '[data-act="close"]');
    expect($('siteInstall').querySelector('form')).toBeNull();
    expect(detail('siteInstall').설치팀).toBe('설치 1팀');
  });

  test('저장은 됐는데 다시 읽지 못하면 그렇게 말한다', async () => {
    let n = 0;
    await load({
      install: () => {
        n += 1;
        return n === 1 ? ok(sites('install')) : fail(500, 'server', 'x');
      },
    });
    await click('siteInstall', '.sm-row[data-key="schedule:' + S1 + '"] td');
    await click('siteInstall', '[data-act="edit"]');
    setValue('siteInstall', 'team', '설치 3팀');
    await submit('siteInstall');
    expect(text($('siteInstall').querySelector('.me-pt-msg'))).toBe(
      '저장했습니다. 목록을 다시 읽지 못했습니다.'
    );
    expect(text($('siteInstall').querySelector('.mk-error'))).toContain(
      '목록을 다시 읽지 못했습니다.'
    );
    expect($('siteInstall').querySelector('[data-act="retry"]')).not.toBeNull();
  });

  test('직원(can_manage 아님)은 보기만 — 「고치기」가 없다', async () => {
    await load({
      partner: partnerMe({ role: 'staff' }),
      install: () => ok(sites('install', { can_manage: false })),
    });
    await click('siteInstall', '.sm-row[data-key="schedule:' + S1 + '"] td');
    expect(detail('siteInstall').title).toBe('1시험 주방');
    expect($('siteInstall').querySelector('[data-act="edit"]')).toBeNull();
    expect($('siteInstall').querySelector('[data-act="unpick"]')).not.toBeNull();
  });

  test('일정이 없으면 지도 없이 그 글만 · 못 읽으면(403 · 끊김) 칸째 감춘다 · 무료 업체는 묻지도 않는다', async () => {
    await load({ install: () => ok(sites('install', { items: [] })) });
    expect(seen('siteInstall')).toBe(true);
    expect($('siteInstall').querySelector('[data-sm="mapwrap"]').hidden).toBe(true);
    expect(text($('siteInstall').querySelector('.me-empty'))).toBe(
      '납품 · 설치 일정이 없습니다. 일정은 프로젝트 관리의 업무 달력에서 넣습니다.'
    );
    document.body.innerHTML = '';
    jest.restoreAllMocks();
    await load({ install: () => fail(403, 'forbidden', 'x') });
    expect($('siteInstall').hidden).toBe(true);
    document.body.innerHTML = '';
    jest.restoreAllMocks();
    await load({ install: () => new Error('offline') });
    expect($('siteInstall').hidden).toBe(true);
    document.body.innerHTML = '';
    jest.restoreAllMocks();
    const calls = await load({ partner: partnerMe({ plan: 'free' }) });
    expect($('siteInstall').hidden).toBe(true);
    expect(calls.fetch.filter((f) => f.url.includes('/company/sites'))).toEqual([]);
  });
});

describe('지도 (카카오맵)', () => {
  test('키가 없으면 「지도는 준비 중」 한 줄 — 표는 그대로, 주소도 찾지 않는다', async () => {
    const calls = await load();
    expect(mapMsg('siteInstall')).toBe('지도는 준비 중입니다. 아래 표는 그대로 쓸 수 있습니다.');
    const wrap = $('siteInstall').querySelector('[data-sm="mapwrap"]');
    expect(wrap.hidden).toBe(false);
    expect(wrap.classList.contains('sm-mapwrap--off')).toBe(true);
    expect($('siteInstall').querySelector('[data-sm="canvas"]').hidden).toBe(true);
    expect(mapNote('siteInstall')).toBe('');
    expect(rows('siteInstall')).toHaveLength(3);
    expect(document.head.querySelector('script[src*="dapi.kakao.com"]')).toBeNull();
    expect(calls.fetch.filter((f) => f.url.includes('/sites/geo'))).toEqual([]);
  });

  test('키가 있으면 SDK 를 한 번 부른다 (주소 찾기 라이브러리 · autoload 끔) — 못 불러오면 그 글', async () => {
    await load({ key: 'abcdef0123456789abcdef0123456789' });
    const tags = [...document.head.querySelectorAll('script[src*="dapi.kakao.com"]')];
    expect(tags).toHaveLength(1);
    expect(tags[0].getAttribute('src')).toBe(
      'https://dapi.kakao.com/v2/maps/sdk.js?appkey=abcdef0123456789abcdef0123456789&libraries=services&autoload=false'
    );
    expect(mapMsg('siteInstall')).toBe('지도를 불러오는 중입니다.');
    tags[0].onerror();
    await flush();
    expect(mapMsg('siteInstall')).toBe(
      '지도를 불러오지 못했습니다. 아래 표는 그대로 쓸 수 있습니다.'
    );
    expect(rows('siteInstall')).toHaveLength(3);
  });

  test('모양이 틀린 키는 키가 없는 것으로 본다 (주소에 넣지 않는다)', async () => {
    await load({ key: 'bad key&x=1' });
    expect(document.head.querySelector('script[src*="dapi.kakao.com"]')).toBeNull();
    expect(mapMsg('siteInstall')).toBe('지도는 준비 중입니다. 아래 표는 그대로 쓸 수 있습니다.');
  });

  test('핀 — 좌표 있는 줄마다 번호 핀, 좌표 없는 주소는 찾아서 핀을 더하고 서버에 적는다 (주소 한 줄만 · 상세 주소는 안 보낸다)', async () => {
    const kakao = fakeKakao(FOUND2);
    const calls = await load({ kakao });
    expect(mapMsg('siteInstall')).toBe('');
    expect(kakao._asked).toEqual([ADDR2]);
    const geo = calls.fetch.filter((f) => f.url === WORK + '/company/sites/geo');
    expect(geo).toHaveLength(1);
    expect(geo[0].method).toBe('PUT');
    expect(geo[0].auth).toBe('Bearer tok-1');
    expect(geo[0].body).toEqual({
      items: [
        { design_id: D2, address: ADDR2, lat: 35.9, lng: 127.5, sido: '가람도', gugun: '가람시' },
      ],
    });
    expect(JSON.stringify(geo[0].body)).not.toContain('2층');
    const list = pins(kakao, 'siteInstall');
    expect(list.map((b) => b.textContent + ' ' + b.className)).toEqual([
      '1 sm-pin sm-pin--info',
      '2 sm-pin sm-pin--bad',
    ]);
    // 주소가 없는 3번은 표에만
    expect(mapNote('siteInstall')).toBe(
      '주소가 없거나 지도에서 찾지 못한 현장 1곳은 표에만 있습니다.'
    );
    expect(rows('siteInstall')[1]).toContain('가람도 가람시');
    // 브라우저 저장소에 주소를 두지 않는다
    expect(
      JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
    ).not.toContain('가람로');
  });

  test('핀을 누르면 그 줄을 고른다 — 핀이 커지고(고름) 표 줄 · 현장 정보가 따라온다', async () => {
    const kakao = fakeKakao(FOUND2);
    await load({ kakao });
    pins(kakao, 'siteInstall')[1].click();
    await flush();
    expect(detail('siteInstall').title).toBe('2가람 붙박이장');
    expect($('siteInstall').querySelector('.sm-row--on').getAttribute('data-key')).toBe(
      'schedule:' + S2
    );
    const list = pins(kakao, 'siteInstall');
    expect(list.map((b) => b.className)).toEqual([
      'sm-pin sm-pin--info',
      'sm-pin sm-pin--bad sm-pin--on',
    ]);
    expect(list[1].getAttribute('aria-pressed')).toBe('true');
    // 걸러서 줄이 빠지면 핀도 빠진다
    await click('siteInstall', '[data-tab="today"]');
    expect(pins(kakao, 'siteInstall').map((b) => b.textContent)).toEqual(['1']);
  });

  test('지도에서 못 찾은 주소 — 표에만 두고 현장 정보에 그렇게 적는다, 서버에는 적지 않는다', async () => {
    const kakao = fakeKakao({});
    const calls = await load({ kakao });
    expect(kakao._asked).toEqual([ADDR2]);
    expect(calls.fetch.filter((f) => f.url.includes('/sites/geo'))).toEqual([]);
    expect(pins(kakao, 'siteInstall').map((b) => b.textContent)).toEqual(['1']);
    expect(mapNote('siteInstall')).toBe(
      '주소가 없거나 지도에서 찾지 못한 현장 2곳은 표에만 있습니다.'
    );
    await click('siteInstall', '.sm-row[data-key="schedule:' + S2 + '"] td');
    expect(detail('siteInstall')['현장 주소']).toBe(
      ADDR2 + ' 2층 — 지도에서 이 주소를 찾지 못했습니다.'
    );
  });

  test('나라 밖 좌표가 돌아오면 못 찾은 것으로 본다', async () => {
    const kakao = fakeKakao({ [ADDR2]: { x: '139.7', y: '35.6', address: {} } });
    const calls = await load({ kakao });
    expect(calls.fetch.filter((f) => f.url.includes('/sites/geo'))).toEqual([]);
    expect(pins(kakao, 'siteInstall')).toHaveLength(1);
  });

  test('DB 가 아직 준비 전(ready: false)이면 찾은 좌표를 화면에만 쓰고 서버에 적지 않는다', async () => {
    const kakao = fakeKakao(FOUND2);
    const calls = await load({
      kakao,
      install: () => ok(sites('install', { ready: false })),
      as: () => ok(sites('as', { ready: false })),
    });
    expect(kakao._asked).toEqual([ADDR2]);
    expect(pins(kakao, 'siteInstall')).toHaveLength(2);
    expect(calls.fetch.filter((f) => f.url.includes('/sites/geo'))).toEqual([]);
  });
});

describe('A/S 화면 (#p-as)', () => {
  test('A/S 현장 지도 + 표가 A/S함 위에 보인다 — 설치 칸은 이 화면에 없다', async () => {
    const calls = await load({ hash: '#p-as' });
    expect(seen('siteAs')).toBe(true);
    expect(seen('siteInstall')).toBe(false);
    expect(siteCalls(calls, 'as')).toHaveLength(1);
    expect(text($('siteAsTitle'))).toBe('A/S 현장');
    expect($('siteAs').querySelector('.sm-range')).toBeNull();
    expect(tabs('siteAs')).toEqual(['전체 3 ←', '처리 중 2', '끝남 1', '담당 미정 1']);
    expect(rows('siteAs')).toEqual([
      '1 | 11/9 (월) | 미정 | 시험 주방싱크대 A · DD-1 | 시험도 시험시 | 문짝이 처졌습니다 | 미정 | 접수',
      '2 | 11/5 (목) | 11/13 (금) 15:00 | 가람 붙박이장붙박이장 B · DD-2 | 가람도 가람시 | 서랍이 뻑뻑합니다 | 김기사 | 받음',
      '3 | 10/20 (화) | 미정 | 신발장 CDD-3 | — | 경첩 교체 | 미정 | 끝',
    ]);
    expect(
      [...$('siteAs').querySelectorAll('.sm-num')].map((b) => b.className.replace('sm-num ', ''))
    ).toEqual(['sm-num--warn', 'sm-num--info', 'sm-num--ok']);
    expect(options('siteAs', 'team')).toEqual(['전체', '김기사']);
  });

  test('방문일 잡기 — PUT /company/as-requests/:id/visit { visit_at, assignee_name }, 다시 읽고 「저장했습니다.」', async () => {
    let n = 0;
    const calls = await load({
      hash: '#p-as',
      as: () => {
        n += 1;
        if (n === 1) return ok(sites('as'));
        const set = AS.map((x, i) =>
          i === 0
            ? {
                ...x,
                state: 'received',
                label: '받음',
                visit: {
                  schedule_id: S9,
                  day: '2026-11-14',
                  time: '10:00',
                  assignee_name: '박기사',
                  status: 'scheduled',
                },
              }
            : x
        );
        return ok(sites('as', { items: set }));
      },
    });
    await click('siteAs', '.sm-row[data-key="as:' + A1 + '"] td');
    expect(detail('siteAs')).toMatchObject({
      title: '1시험 주방',
      접수일: '11월 9일 (월)',
      증상: '문짝이 처졌습니다',
      방문일: '미정',
      담당: '미정',
      상태: '접수',
    });
    expect(text($('siteAs').querySelector('[data-act="edit"]'))).toBe('방문일 잡기');
    await click('siteAs', '[data-act="edit"]');
    const form = $('siteAs').querySelector('form[data-form="visit"]');
    expect(form.elements.date.value).toBe('');
    expect(form.elements.time.value).toBe('10:00');
    expect(form.elements.status).toBeUndefined();
    await submit('siteAs');
    expect(formErr('siteAs')).toBe('날짜를 골라 주세요.');
    setValue('siteAs', 'date', '2026-11-14');
    setValue('siteAs', 'team', '박기사');
    await submit('siteAs');
    expect(writes(calls)).toEqual([
      {
        url: WORK + '/company/as-requests/' + A1 + '/visit',
        method: 'PUT',
        auth: 'Bearer tok-1',
        body: { visit_at: '2026-11-14T10:00:00+09:00', assignee_name: '박기사' },
      },
    ]);
    expect(siteCalls(calls, 'as')).toHaveLength(2);
    expect(text($('siteAs').querySelector('.me-pt-msg'))).toBe('저장했습니다.');
    expect(detail('siteAs')).toMatchObject({
      방문일: '11월 14일 (토) 10:00',
      담당: '박기사',
      상태: '받음',
    });
    expect(text($('siteAs').querySelector('[data-act="edit"]'))).toBe('방문일 고치기');
  });

  test('잡힌 방문은 「방문일 고치기」 — 같은 값이면 부르지 않는다 · 끝난 접수는 고칠 수 없다 · 직원은 보기만', async () => {
    const calls = await load({ hash: '#p-as' });
    await click('siteAs', '.sm-row[data-key="as:' + A2 + '"] td');
    expect(text($('siteAs').querySelector('[data-act="edit"]'))).toBe('방문일 고치기');
    await click('siteAs', '[data-act="edit"]');
    const form = $('siteAs').querySelector('form[data-form="visit"]');
    expect(form.elements.date.value).toBe('2026-11-13');
    expect(form.elements.time.value).toBe('15:00');
    expect(form.elements.team.value).toBe('김기사');
    await submit('siteAs');
    expect(writes(calls)).toEqual([]);
    expect($('siteAs').querySelector('form')).toBeNull();
    await click('siteAs', '.sm-row[data-key="as:' + A3 + '"] td');
    expect(detail('siteAs').상태).toBe('끝');
    expect($('siteAs').querySelector('[data-act="edit"]')).toBeNull();
    document.body.innerHTML = '';
    jest.restoreAllMocks();
    await load({
      hash: '#p-as',
      partner: partnerMe({ role: 'staff' }),
      as: () => ok(sites('as', { can_manage: false })),
    });
    await click('siteAs', '.sm-row[data-key="as:' + A1 + '"] td');
    expect($('siteAs').querySelector('[data-act="edit"]')).toBeNull();
  });

  test('서버가 막으면(끝난 접수 409) 그 글을 입력 칸에 둔다', async () => {
    await load({
      hash: '#p-as',
      visit: () => fail(409, 'closed', '끝난 접수에는 방문 일정을 잡을 수 없습니다.'),
    });
    await click('siteAs', '.sm-row[data-key="as:' + A1 + '"] td');
    await click('siteAs', '[data-act="edit"]');
    setValue('siteAs', 'date', '2026-11-14');
    await submit('siteAs');
    expect(formErr('siteAs')).toBe('끝난 접수에는 방문 일정을 잡을 수 없습니다.');
    expect($('siteAs').querySelector('form [name="date"]').value).toBe('2026-11-14');
  });

  test('DB 가 아직 준비 전(ready: false)이면 표는 보이고 「방문일 넣기는 준비 중」 — 단추가 없다', async () => {
    await load({ hash: '#p-as', as: () => ok(sites('as', { ready: false })) });
    expect(rows('siteAs')).toHaveLength(3);
    await click('siteAs', '.sm-row[data-key="as:' + A1 + '"] td');
    expect(text($('siteAs').querySelector('.sm-detail .mk-note'))).toBe(
      '방문일 넣기는 준비 중입니다.'
    );
    expect($('siteAs').querySelector('[data-act="edit"]')).toBeNull();
  });

  test('두 화면의 같은 주소는 한 번만 찾는다 — A/S 지도에도 핀이 선다', async () => {
    const kakao = fakeKakao(FOUND2);
    const calls = await load({ hash: '#p-as', kakao });
    expect(kakao._asked).toEqual([ADDR2]);
    expect(calls.fetch.filter((f) => f.url === WORK + '/company/sites/geo')).toHaveLength(1);
    expect(pins(kakao, 'siteAs').map((b) => b.textContent + ' ' + b.className)).toEqual([
      '1 sm-pin sm-pin--warn',
      '2 sm-pin sm-pin--info',
    ]);
  });

  test('Manager 업체 — A/S 는 묻지 않고 칸도 없다 (A/S 화면은 준비 중), 설치 지도는 본다', async () => {
    const calls = await load({ hash: '#p-as', partner: partnerMe({ plan: 'manager' }) });
    expect(siteCalls(calls, 'as')).toEqual([]);
    expect($('siteAs').hidden).toBe(true);
    expect(siteCalls(calls, 'install')).toHaveLength(1);
    expect($('siteInstall').hidden).toBe(false);
  });
});

describe('다른 칸과 잇기', () => {
  test('업무 달력이 일정을 고친 뒤 SeganSiteMap.reload() — 읽어 둔 화면만 다시 읽는다', async () => {
    const calls = await load();
    expect(siteCalls(calls, 'install')).toHaveLength(1);
    expect(siteCalls(calls, 'as')).toHaveLength(1);
    await window.SeganSiteMap.reload();
    expect(siteCalls(calls, 'install')).toHaveLength(2);
    expect(siteCalls(calls, 'as')).toHaveLength(2);
    expect(read('segan/calendar.js')).toMatch(/sites\.reload\(\)/);
  });

  test('업무 달력의 reload() — 읽어 둔 기간을 버리고 다시 읽는다', async () => {
    const calls = await load();
    const count = () =>
      calls.fetch.filter((f) => f.url.startsWith(WORK + '/company/schedules')).length;
    const before = count();
    expect(before).toBeGreaterThan(0);
    await window.SeganCalendar.reload();
    expect(count()).toBe(before + 1);
  });
});
