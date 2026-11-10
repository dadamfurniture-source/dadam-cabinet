/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「인사 › 작업자」 다담 공장 (segan/production-workers.js + segan/me.html #productionWorkers)
 *
 *   누가    다담 공장 구성원 가운데 공장 배정을 읽을 수 있는 사람 (GET /partner/me 의 hq_member +
 *           GET /production/factory-workers 가 열리는 대표 · 실장 · 관리자). 아닌 사람은 묻지도 않는다
 *   데이터  workflow-api GET /production/factory-workers · /production/worker-links · /production/calibration ·
 *           /production/worklogs?from=, POST /production/factory-workers(배정) · …/:id/end(배정 끝) ·
 *           /production/worker-links/:id/revoke(끊기) · /production/calibration/apply(보정 적용)
 *   화면    공장 배정 · 작업자 링크 · 실측 기록 · 표준시간 보정 — 부분마다 따로 그린다
 *   못 읽으면 공장 배정 → 칸째 감춘다 (메뉴 줄도). 링크 · 보정 · 기록만 못 읽으면 그 부분만
 *   확인    「배정 끝」 · 「끊기」는 창을 띄우지 않고 그 부분 아래에 묻는다
 *   이름은 모두 지어낸 것이다
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
const NOW = Date.parse('2026-11-10T03:00:00Z'); // 한국 시간 2026-11-10 (화) 12:00

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const HQ = ok({ company: null, application: null, members: [], invites: [], hq_member: true });
const PARTNER = ok({
  company: {
    id: CO,
    name: '다담 협력 주방',
    plan: 'agent',
    next_plan: null,
    status: 'active',
    sido: '대구광역시',
    gugun: '북구',
    role: 'owner',
    created_at: '2026-10-01T00:00:00Z',
  },
  application: null,
  members: [],
  invites: [],
});

// 공장 배정 — 둘 배정(하나는 링크에서 이은 정지 작업자 · 공정 없음), 고를 수 있는 작업자 둘
const factory = () => ({
  assigned: [
    {
      id: 'fw-1',
      assigned_at: '2026-11-01T01:00:00Z', // 한국 시간 11/01
      from_link: false,
      worker: { display_name: '김재단', status: 'approved' },
      roles: ['cutter', 'edge'],
    },
    {
      id: 'fw-2',
      assigned_at: '2026-11-03T16:00:00Z', // 한국 시간 11/04 01:00
      from_link: true,
      worker: { display_name: '이조립', status: 'suspended' },
      roles: [],
    },
    { id: '번호 아님', worker: { display_name: '빠질 줄' }, roles: ['asm'] }, // 번호 모양이 아닌 줄 — 뺀다
  ],
  candidates: [
    { id: 'w-3', display_name: '박엣지', kinds: ['edge', 'assembly'] },
    { id: 'w-4', display_name: '최도움', kinds: [] },
    { id: '번호 아님', display_name: '빠질 사람', kinds: ['cutting'] },
  ],
});
// 작업자 링크 — 사용 중 · 만료 · 끊음 · 계정에 이음
const links = () => ({
  items: [
    {
      id: 'ln-1',
      label: '한재단',
      expires_at: '2026-12-01T00:00:00Z',
      revoked_at: null,
      last_used_at: '2026-11-09T02:30:00Z', // 한국 시간 11/09 11:30
      linked: false,
    },
    {
      id: 'ln-2',
      label: '오엣지',
      expires_at: '2026-11-01T00:00:00Z',
      revoked_at: null,
      last_used_at: null,
      linked: false,
    },
    {
      id: 'ln-3',
      label: '',
      expires_at: '2026-12-01T00:00:00Z',
      revoked_at: '2026-11-05T00:00:00Z',
      last_used_at: null,
      linked: false,
    },
    {
      id: 'ln-4',
      label: '정조립',
      expires_at: '2026-12-01T00:00:00Z',
      revoked_at: null,
      last_used_at: '2026-11-08T23:05:00Z', // 한국 시간 11/09 08:05
      linked: true,
    },
  ],
});
// 실측 보정 — 재단은 제안 있음, 엣지는 기록 부족, 조립은 기록 없음. 모르는 공정은 뺀다
const calib = () => ({
  from: '2026-10-11',
  days: 30,
  result: [
    {
      role: 'cutter',
      label: '재단 (원판 1장)',
      records: 12,
      units: 40,
      current: 300,
      measured: 342,
      suggested: 340,
      diffPct: 14,
      enough: true,
      minUnits: 10,
    },
    {
      role: 'edge',
      label: '엣지 (부재 1면)',
      records: 3,
      units: 6,
      current: 60,
      measured: 55,
      suggested: null,
      diffPct: -8,
      enough: false,
      minUnits: 10,
    },
    {
      role: 'asm',
      label: '조립 (통·서랍 1개)',
      records: 0,
      units: 0,
      current: 1800,
      measured: null,
      suggested: null,
      diffPct: null,
      enough: false,
      minUnits: 10,
    },
    { role: 'paint', label: '도장', records: 1, units: 1, current: 10, suggested: 20 },
  ],
});
const logs = () => ({
  items: [
    {
      work_date: '2026-11-09',
      worker_label: '김재단',
      role: 'cutter',
      order_label: 'DD-1 가람 주방',
      units: 4,
      minutes: 25,
    },
    {
      work_date: '2026-11-08',
      worker_label: '',
      role: 'asm',
      order_label: '',
      units: 2,
      minutes: 70,
    },
  ],
});

/**
 * 마이페이지를 띄운다 (기본 = 다담 공장 대표, 인사 › 작업자 화면)
 * opts.factory() → GET /production/factory-workers, opts.assignPost(body) → POST 같은 주소,
 * opts.end(id) → POST …/factory-workers/:id/end, opts.links() → GET /production/worker-links,
 * opts.revoke(id) → POST …/worker-links/:id/revoke, opts.calib() → GET /production/calibration,
 * opts.apply(body) → POST /production/calibration/apply, opts.logs(url) → GET /production/worklogs?from=
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: HQ,
    hash: '#workers-hq',
    factory: () => ok(factory()),
    assignPost: () => ok({ id: 'fw-3' }, 201),
    end: (id) => ok({ id, ended: true }),
    links: () => ok(links()),
    revoke: (id) => ok({ id, revoked: true }),
    calib: () => ok(calib()),
    apply: () => ok({ applied: ['cutter'] }),
    logs: () => ok(logs()),
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
    'SeganOrders',
    'SeganProductionPlan',
    'SeganProductionWorkers',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
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
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const method = init.method || 'GET';
    calls.fetch.push({
      url,
      method,
      auth: (init.headers || {}).Authorization,
      type: (init.headers || {})['Content-Type'],
      cache: init.cache,
      body,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    const fw = WORK + '/production/factory-workers';
    if (url === fw)
      return reply(await (method === 'POST' ? opts.assignPost(body) : opts.factory()));
    if (url.startsWith(fw + '/') && url.endsWith('/end'))
      return reply(await opts.end(url.slice(fw.length + 1, -4)));
    const wl = WORK + '/production/worker-links';
    if (url === wl) return reply(await opts.links());
    if (url.startsWith(wl + '/') && url.endsWith('/revoke'))
      return reply(await opts.revoke(url.slice(wl.length + 1, -7)));
    if (url === WORK + '/production/calibration') return reply(await opts.calib());
    if (url === WORK + '/production/calibration/apply') return reply(await opts.apply(body));
    if (url.startsWith(WORK + '/production/worklogs?')) return reply(await opts.logs(url));
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
    'segan/partner-projects.js',
    'segan/orders.js',
    'segan/production-workers.js',
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

/** 작업자 스크립트만 올린다 — 순수 함수 시험 */
function lib() {
  delete window.SeganProductionWorkers;
  (0, eval)(read('segan/production-workers.js'));
  return window.SeganProductionWorkers;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
/** 화면에 보이는가 — 모듈이 감춘 칸(hidden) · 마이페이지가 끈 칸(me-off) 은 아니다 */
const seen = (id) => !!$(id) && !$(id).hidden && !$(id).classList.contains('me-off');
const part = (name) => $('productionWorkers').querySelector(`[data-pw-part="${name}"]`);
/** 그려진 부분 이름 (감춘 부분은 뺀다) */
const parts = () =>
  [...$('productionWorkers').querySelectorAll('[data-pw-part]')]
    .filter((el) => !el.hidden)
    .map((el) => el.getAttribute('data-pw-part'));
// 표 — 접어 둔 「최근 기록 보기」 안의 표는 따로 본다 (logHeads · logRows)
const table = (name) => part(name).querySelector(':scope > .od-tablewrap > .od-table');
const heads = (name) => [...table(name).querySelectorAll('thead th')].map(text);
// 표의 줄 — '칸 | 칸 …' (빈 끝 칸은 '… |' 로 끝난다 · 확인을 묻는 줄은 끝에 ←)
const rows = (name) =>
  [...table(name).querySelectorAll('tbody tr')].map(
    (tr) =>
      [...tr.children].map(text).join(' | ').trimEnd() +
      (tr.classList.contains('od-row--on') ? ' ←' : '')
  );
const more = () => part('calib').querySelector('details.pw-more');
const logHeads = () => [...more().querySelectorAll('thead th')].map(text);
const logRows = () =>
  [...more().querySelectorAll('tbody tr')].map((tr) => [...tr.children].map(text).join(' | '));
const askBox = (name) => part(name).querySelector('[data-pw="ask"]');
const btn = (name, act, id) =>
  part(name).querySelector(`[data-act="${act}"]` + (id ? `[data-id="${id}"]` : ''));
const msg = () => text($('productionWorkers').querySelector('[data-pw="msg"]'));
const menuRow = () => document.querySelector('[data-me-item="workers-hq"]');
const press = async (el) => {
  el.click();
  await flush();
};
const go = async (hash) => {
  window.location.hash = hash;
  window.dispatchEvent(new Event('hashchange'));
  await flush();
};
const sent = (calls, method) =>
  calls.fetch.filter((c) => c.method === method && c.url.startsWith(WORK + '/production/'));
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/production/'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));

afterEach(() => {
  jest.restoreAllMocks();
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸(#partner) 안, 생산 계획 다음 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const box = doc.getElementById('productionWorkers');
    expect(box).not.toBeNull();
    expect(box.hasAttribute('hidden')).toBe(true);
    expect(box.closest('section').id).toBe('partner');
    expect(box.classList.contains('od')).toBe(true);
    expect(box.classList.contains('pw')).toBe(true);
    expect(box.previousElementSibling.id).toBe('productionPlan');
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    // 없으면(-1) 차례 비교가 거짓으로 통과하지 않게 자리부터 본다
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['production-workers.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('production-workers.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'production-workers.js')");
  });

  test('메뉴 — 인사 › 「작업자」 줄은 앱 화면(#workers-hq)으로 간다 · 처음엔 감춘다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const li = doc.querySelector('[data-me-item="workers-hq"]');
    expect(li).not.toBeNull();
    expect(li.hasAttribute('hidden')).toBe(true);
    const a = li.querySelector('a');
    expect(a.getAttribute('href')).toBe('#workers-hq');
    expect(a.getAttribute('data-me-go')).toBe('workers-hq');
    expect(a.hasAttribute('data-desktop-tab')).toBe(false);
  });

  test('이름을 기기에 남기지 않는다 — 저장소 · 알림을 쓰지 않고, 확인 창도 띄우지 않는다', () => {
    // 머리말의 설명 글은 빼고 본다 — 코드가 쓰는지만
    const code = read('segan/production-workers.js')
      .split('\n')
      .filter(
        (line) =>
          !line.trim().startsWith('//') &&
          !line.trim().startsWith('*') &&
          !line.includes('고객 정보  ')
      )
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
  });

  test('폰 — 표 머리의 가린 글이 감싸개 밖으로 새지 않는다 (화면이 옆으로 밀리지 않게)', () => {
    // .pw-sr 은 position: absolute — 감싸개가 기준이 아니면 넓은 표 오른쪽 끝에서 화면 폭을 넓힌다
    const css = read('segan/shell.css').replace(/\r\n/g, '\n');
    expect(css).toMatch(/\.pw \.od-tablewrap \{\n {2}position: relative;\n\}/);
    expect(css).toMatch(/\.pw-sr \{\n {2}position: absolute;\n {2}top: 0;\n {2}left: 0;/);
  });

  test('폰 — 「배정 끝」 · 「끊기」 칸은 표를 밀지 않아도 오른쪽에 붙어 보인다', async () => {
    await load();
    ['factory', 'links'].forEach((name) => {
      const p = part(name);
      expect(p.querySelector('thead th:last-child').className).toBe('pw-act');
      p.querySelectorAll('tbody tr').forEach((tr) => {
        expect(tr.lastElementChild.className).toBe('pw-act');
      });
      p.querySelectorAll('button[data-act="end"], button[data-act="revoke"]').forEach((b) => {
        expect(b.parentElement.className).toBe('pw-act');
      });
    });
    // 보정 · 최근 기록 표에는 하기 칸이 없다
    expect(part('calib').querySelector('.pw-act')).toBeNull();
    const css = read('segan/shell.css').replace(/\r\n/g, '\n');
    expect(css).toMatch(/\.pw \.od-table \.pw-act \{\n {2}position: sticky;\n {2}right: 0;/);
    // 붙은 칸 바탕은 불투명 — 고른 줄은 줄 바탕을 따른다
    expect(css).toMatch(
      /\.pw \.od-table \.od-row--on \.pw-act \{\n {2}background: var\(--v5-well\);\n\}/
    );
  });

  test('이름 — 공정 · 작업자 종류 · 링크 상태는 PC 화면(production.html)과 같다', () => {
    const P = lib();
    expect(P.ROLE).toEqual({ cutter: '재단', edge: '엣지', asm: '조립' });
    expect(P.KIND).toEqual({
      install: '설치',
      as: 'A/S',
      assembly: '조립',
      cutting: '재단',
      edge: '엣지',
    });
    expect(P.LINK_STATE).toEqual({
      linked: '계정에 이음',
      revoked: '끊음',
      expired: '만료',
      live: '사용 중',
    });
    const pc = read('production.html');
    for (const word of ['계정에 이음', '끊음', '만료', '사용 중', '배정 끝', '보정 모두 적용'])
      expect(pc).toContain(word);
  });
});

describe('순수 함수', () => {
  test('canSee — 다담 공장 구성원만', () => {
    const P = lib();
    expect(P.canSee({ hq_member: true })).toBe(true);
    expect(P.canSee({ hq_member: 'true' })).toBe(false);
    expect(P.canSee({ platform_member: true })).toBe(false);
    expect(P.canSee({ company: { plan: 'agent' } })).toBe(false);
    expect(P.canSee(null)).toBe(false);
    expect(P.canSee([])).toBe(false);
  });

  test('linkState — 계정에 이음 → 끊음 → 만료 → 사용 중 차례', () => {
    const P = lib();
    const later = '2026-12-01T00:00:00Z';
    const before = '2026-11-01T00:00:00Z';
    expect(P.linkState({ linked: true, revoked_at: before, expires_at: before }, NOW)).toBe(
      'linked'
    );
    expect(P.linkState({ revoked_at: before, expires_at: before }, NOW)).toBe('revoked');
    expect(P.linkState({ expires_at: before }, NOW)).toBe('expired');
    expect(P.linkState({ expires_at: later }, NOW)).toBe('live');
    // 만료 날짜를 못 읽으면 사용 중으로 둔다 (PC 화면과 같다)
    expect(P.linkState({ expires_at: '' }, NOW)).toBe('live');
    expect(P.linkState(null, NOW)).toBe('live');
  });

  test('canApply — 제안이 있고 지금 표준과 다를 때만', () => {
    const P = lib();
    expect(P.canApply({ suggested: 340, current: 300 })).toBe(true);
    expect(P.canApply({ suggested: 300, current: 300 })).toBe(false);
    expect(P.canApply({ suggested: null, current: 300 })).toBe(false);
    expect(P.canApply({ current: 300 })).toBe(false);
    expect(P.canApply(null)).toBe(false);
  });

  test('글자 꼴 — 초 → 분 · 날짜 · 한국 날짜 · 한국 시각', () => {
    const P = lib();
    expect(P.mins(90)).toBe('1.5분');
    expect(P.mins(340)).toBe('5.7분');
    expect(P.mins(0)).toBe('0.0분');
    expect(P.mins(null)).toBe('-');
    expect(P.mins('x')).toBe('-');
    expect(P.day('2026-11-12')).toBe('11/12(목)');
    expect(P.day('2026-11-08T10:00:00Z')).toBe('11/8(일)');
    expect(P.day('')).toBe('-');
    expect(P.day('어제')).toBe('-');
    // 한국 시간으로 날이 넘어가는 때
    expect(P.dateKst('2026-11-03T16:00:00Z')).toBe('2026-11-04');
    expect(P.dateKst('2026-11-03T14:59:00Z')).toBe('2026-11-03');
    expect(P.dateKst(null)).toBe('-');
    expect(P.stamp('2026-11-09T02:30:00Z')).toBe('11/09 11:30');
    expect(P.stamp('2026-11-09T15:05:00Z')).toBe('11/10 00:05');
    expect(P.stamp('')).toBe('-');
  });
});

describe('화면', () => {
  test('다담 공장 대표 — #workers-hq 에서 칸이 보이고, 제목이 화면 이름이 된다 · 처음에는 읽기만', async () => {
    const calls = await load();
    expect(seen('productionWorkers')).toBe(true);
    expect($('partner').hidden).toBe(false);
    expect(text($('productionWorkersTitle'))).toBe('작업자');
    expect($('partner').getAttribute('aria-labelledby')).toBe('productionWorkersTitle');
    expect(parts()).toEqual(['factory', 'links', 'calib']);
    expect(asked(calls).sort()).toEqual([
      'GET /production/calibration',
      'GET /production/factory-workers',
      'GET /production/worker-links',
      'GET /production/worklogs?from=2026-10-11',
    ]);
    for (const c of calls.fetch.filter((x) => x.url.startsWith(WORK + '/production/'))) {
      expect(c.auth).toBe('Bearer tok-1');
      expect(c.cache).toBe('no-store');
    }
    expect(msg()).toBe('');
    // 메뉴의 「작업자」 줄도 보인다
    expect(menuRow().hidden).toBe(false);
  });

  test('다른 화면으로 가면 칸을 끄고, 돌아오면 다시 켠다 (다시 읽지 않는다)', async () => {
    const calls = await load();
    const before = asked(calls).length;
    await go('#account');
    expect(seen('productionWorkers')).toBe(false);
    await go('#workers-hq');
    expect(seen('productionWorkers')).toBe(true);
    expect(asked(calls).length).toBe(before);
  });

  test('공장 배정 — 고르기 · 「배정하기」 · 배정된 작업자 표 (정지 · 공정 없음 · 링크에서 이음)', async () => {
    await load();
    const el = part('factory');
    expect(text(el.querySelector('h4'))).toBe('공장 배정');
    const sel = el.querySelector('select[name="worker"]');
    expect(sel.getAttribute('aria-label')).toBe('배정할 작업자');
    expect(sel.disabled).toBe(false);
    expect([...sel.options].map((o) => [o.value, text(o)])).toEqual([
      ['w-3', '박엣지 (엣지 · 조립)'],
      ['w-4', '최도움'],
    ]);
    expect(text(btn('factory', 'assign'))).toBe('배정하기');
    expect(btn('factory', 'assign').disabled).toBe(false);
    expect(heads('factory')).toEqual(['작업자', '공정', '배정', '하기']);
    expect(rows('factory')).toEqual([
      '김재단 | 재단 · 엣지 | 2026-11-01 | 배정 끝',
      '이조립 (정지) | 공정 없음 | 2026-11-04 · 링크에서 이음 | 배정 끝',
    ]);
    expect(askBox('factory')).toBeNull();
  });

  test('공장 배정 — 배정할 사람이 없으면 고르기 · 단추를 잠그고, 배정이 없으면 빈 안내', async () => {
    await load({ factory: () => ok({ assigned: [], candidates: [] }) });
    const el = part('factory');
    const sel = el.querySelector('select[name="worker"]');
    expect(sel.disabled).toBe(true);
    expect(text(sel)).toBe('배정할 수 있는 작업자가 없습니다');
    expect(btn('factory', 'assign').disabled).toBe(true);
    expect(el.querySelector('.od-table')).toBeNull();
    expect(text(el.querySelector('.me-empty'))).toBe('아직 없습니다.');
  });

  test('작업자 링크 — 이름 옆에 상태 · 「끊기」는 사용 중인 링크에만', async () => {
    await load();
    expect(text(part('links').querySelector('h4'))).toBe('작업자 링크');
    expect(heads('links')).toEqual(['작업자', '상태', '만료', '마지막 사용', '하기']);
    expect(rows('links')).toEqual([
      '한재단 | 사용 중 | 2026-12-01 | 11/09 11:30 | 끊기',
      '오엣지 | 만료 | 2026-11-01 | - |',
      '- | 끊음 | 2026-12-01 | - |',
      '정조립 | 계정에 이음 | 2026-12-01 | 11/09 08:05 |',
    ]);
    expect(part('links').querySelectorAll('[data-act="revoke"]').length).toBe(1);
    // 새 링크를 만드는 단추는 없다
    expect(text(part('links'))).toContain('새 링크는 만들지 않습니다');
  });

  test('실측 보정 — 공정 옆에 할 일 (적용 단추 · 부족 · 기록 없음), 값은 분', async () => {
    await load();
    expect(text(part('calib').querySelector('h4'))).toBe('실측 기록 · 표준시간 보정 (최근 30일)');
    expect(heads('calib')).toEqual(['공정', '보정', '기록', '수량', '현재 표준', '실측', '차이']);
    expect(rows('calib')).toEqual([
      '재단 (원판 1장) | 5.7분으로 적용 | 12 | 40 | 5.0분 | 5.7분 | +14%',
      '엣지 (부재 1면) | 기록 6/10단위 (부족) | 3 | 6 | 1.0분 | 0.9분 | -8%',
      '조립 (통·서랍 1개) | 기록 없음 | 0 | 0 | 30.0분 | - | -',
    ]);
    expect(part('calib').querySelectorAll('[data-act="apply"]').length).toBe(1);
    expect(part('calib').querySelector('[data-act="apply"]').getAttribute('data-role')).toBe(
      'cutter'
    );
    expect(text(btn('calib', 'apply-all'))).toBe('보정 모두 적용');
    expect(btn('calib', 'apply-all').disabled).toBe(false);
  });

  test('실측 보정 — 이미 반영됐거나 제안이 없으면 「보정 모두 적용」을 잠근다', async () => {
    const c = calib();
    c.result[0].suggested = 300; // 지금 표준과 같다
    await load({ calib: () => ok(c) });
    expect(rows('calib')[0]).toBe('재단 (원판 1장) | 반영됨 | 12 | 40 | 5.0분 | 5.7분 | +14%');
    expect(part('calib').querySelector('[data-act="apply"]')).toBeNull();
    expect(btn('calib', 'apply-all').disabled).toBe(true);
  });

  test('최근 기록 보기 — 접어 두고, 펼치면 날짜 · 작업자 · 공정 · 주문 · 수량 · 분', async () => {
    await load();
    expect(more().open).toBe(false);
    expect(text(more().querySelector('summary'))).toBe('최근 기록 보기');
    expect(logHeads()).toEqual(['날짜', '작업자', '공정', '주문', '수량', '분']);
    expect(logRows()).toEqual([
      '11/9(월) | 김재단 | 재단 | DD-1 가람 주방 | 4 | 25',
      '11/8(일) | - | 조립 | - | 2 | 70',
    ]);
  });

  test('최근 기록 — 100줄까지만 그린다 · 없으면 빈 안내', async () => {
    const many = {
      items: Array.from({ length: 130 }, (_, i) => ({
        work_date: '2026-11-09',
        worker_label: '김재단',
        role: 'cutter',
        order_label: 'DD-' + (i + 1),
        units: 1,
        minutes: 5,
      })),
    };
    await load({ logs: () => ok(many) });
    expect(logRows().length).toBe(100);
    await load({ logs: () => ok({ items: [] }) });
    expect(more().querySelector('.od-table')).toBeNull();
    expect(text(more().querySelector('.me-empty'))).toBe('아직 없습니다.');
  });

  test('표준시간 · 인력 설정은 아직 PC 화면 — 링크 하나', async () => {
    await load();
    const a = part('calib').querySelector('a[data-desktop-tab]');
    expect(a.getAttribute('href')).toBe('../production.html');
    expect(a.className).toBe('od-pc');
    expect(text(a)).toBe('표준시간 · 인력 설정 →');
    expect(text(part('calib'))).toContain('표준시간 · 인력 설정은 아직 PC 생산 현황판에서 합니다.');
  });

  test('이름 속 꺾쇠는 글자로만 그린다', async () => {
    const f = factory();
    f.assigned[0].worker.display_name = '<b>굵게</b>';
    f.candidates[0].display_name = '<i>기울게</i>';
    await load({ factory: () => ok(f) });
    expect(part('factory').querySelector('td b')).toBeNull();
    expect(part('factory').querySelector('option i')).toBeNull();
    expect(rows('factory')[0]).toContain('<b>굵게</b>');
  });
});

describe('공장 배정 — 배정하기 · 배정 끝', () => {
  test('「배정하기」 — 고른 작업자를 보내고, 다시 읽어 그린다', async () => {
    let n = 0;
    const calls = await load({
      factory: () => {
        const f = factory();
        if (n++ > 0) {
          f.assigned.push({
            id: 'fw-3',
            assigned_at: '2026-11-10T03:00:00Z',
            worker: { display_name: '최도움', status: 'approved' },
            roles: ['asm'],
          });
          f.candidates = [f.candidates[0]];
        }
        return ok(f);
      },
    });
    part('factory').querySelector('select[name="worker"]').value = 'w-4';
    await press(btn('factory', 'assign'));
    const posts = sent(calls, 'POST');
    expect(posts.length).toBe(1);
    expect(posts[0].url).toBe(WORK + '/production/factory-workers');
    expect(posts[0].body).toEqual({ worker_id: 'w-4' });
    expect(posts[0].type).toBe('application/json');
    expect(posts[0].auth).toBe('Bearer tok-1');
    expect(msg()).toBe('공장에 배정했습니다.');
    expect(rows('factory')[2]).toBe('최도움 | 조립 | 2026-11-10 | 배정 끝');
    expect(part('factory').querySelectorAll('option').length).toBe(1);
    expect($('productionWorkers').hasAttribute('aria-busy')).toBe(false);
  });

  test('「배정하기」 — 서버가 막으면 서버 글을 그대로, 표는 그대로', async () => {
    const calls = await load({
      assignPost: () => fail(409, 'conflict', '승인된 작업자만 공장에 배정할 수 있습니다'),
    });
    await press(btn('factory', 'assign'));
    expect(msg()).toBe('승인된 작업자만 공장에 배정할 수 있습니다');
    expect(rows('factory').length).toBe(2);
    // 다시 읽지 않는다
    expect(asked(calls).filter((x) => x === 'GET /production/factory-workers').length).toBe(1);
  });

  test('「배정하기」 — 끊기면 일반 안내', async () => {
    await load({ assignPost: () => new Error('offline') });
    await press(btn('factory', 'assign'));
    expect(msg()).toBe('처리하지 못했습니다. 잠시 뒤 다시 해 주세요.');
  });

  test('「배정 끝」 — 창을 띄우지 않고 표 아래에 묻는다 · 「취소」하면 아무것도 보내지 않는다', async () => {
    const calls = await load();
    await press(btn('factory', 'end', 'fw-1'));
    const box = askBox('factory');
    expect(box).not.toBeNull();
    expect(box.getAttribute('role')).toBe('group');
    expect(text(box.querySelector('p'))).toBe(
      '김재단 — 이 작업자의 공장 배정을 끝낼까요? 작업자 화면의 「공장」 탭이 사라집니다.'
    );
    expect([...box.querySelectorAll('button')].map(text)).toEqual(['배정 끝내기', '취소']);
    expect(rows('factory')[0]).toBe('김재단 | 재단 · 엣지 | 2026-11-01 | 배정 끝 ←');
    expect(document.activeElement).toBe(box.querySelector('[data-act="yes"]'));
    expect(sent(calls, 'POST').length).toBe(0);
    await press(box.querySelector('[data-act="no"]'));
    expect(askBox('factory')).toBeNull();
    expect(rows('factory')[0]).toBe('김재단 | 재단 · 엣지 | 2026-11-01 | 배정 끝');
    expect(sent(calls, 'POST').length).toBe(0);
  });

  test('「배정 끝내기」 — 그 배정을 끝내고 다시 읽는다', async () => {
    let n = 0;
    const ended = [];
    const calls = await load({
      factory: () => {
        const f = factory();
        if (n++ > 0) f.assigned = [f.assigned[0]];
        return ok(f);
      },
      end: (id) => {
        ended.push(id);
        return ok({ id, ended: true });
      },
    });
    await press(btn('factory', 'end', 'fw-2'));
    await press(askBox('factory').querySelector('[data-act="yes"]'));
    expect(ended).toEqual(['fw-2']);
    const posts = sent(calls, 'POST');
    expect(posts.length).toBe(1);
    expect(posts[0].url).toBe(WORK + '/production/factory-workers/fw-2/end');
    expect(posts[0].body).toBeUndefined();
    expect(posts[0].type).toBeUndefined();
    expect(msg()).toBe('공장 배정을 끝냈습니다.');
    expect(rows('factory')).toEqual(['김재단 | 재단 · 엣지 | 2026-11-01 | 배정 끝']);
    expect(askBox('factory')).toBeNull();
  });

  test('「배정 끝내기」 — 서버가 막으면 서버 글, 물음은 닫는다', async () => {
    await load({ end: () => fail(404, 'not_found', '배정을 찾을 수 없습니다') });
    await press(btn('factory', 'end', 'fw-1'));
    await press(askBox('factory').querySelector('[data-act="yes"]'));
    expect(msg()).toBe('배정을 찾을 수 없습니다');
    expect(askBox('factory')).toBeNull();
    expect(rows('factory').length).toBe(2);
  });

  test('물음은 한 번에 하나 — 링크 「끊기」를 누르면 배정 물음이 닫힌다', async () => {
    await load();
    await press(btn('factory', 'end', 'fw-1'));
    await press(btn('links', 'revoke', 'ln-1'));
    expect(askBox('factory')).toBeNull();
    expect(askBox('links')).not.toBeNull();
    expect(rows('factory')[0].endsWith('←')).toBe(false);
    expect(rows('links')[0].endsWith('←')).toBe(true);
  });
});

describe('작업자 링크 — 끊기', () => {
  test('「끊기」 — 표 아래에 묻고, 「링크 끊기」를 누르면 끊고 다시 읽는다', async () => {
    let n = 0;
    const calls = await load({
      links: () => {
        const l = links();
        if (n++ > 0) l.items[0].revoked_at = '2026-11-10T03:00:00Z';
        return ok(l);
      },
    });
    await press(btn('links', 'revoke', 'ln-1'));
    const box = askBox('links');
    expect(text(box.querySelector('p'))).toBe(
      '한재단 — 이 링크를 끊을까요? 작업자는 더 이상 열 수 없습니다.'
    );
    expect([...box.querySelectorAll('button')].map(text)).toEqual(['링크 끊기', '취소']);
    expect(sent(calls, 'POST').length).toBe(0);
    await press(box.querySelector('[data-act="yes"]'));
    const posts = sent(calls, 'POST');
    expect(posts.length).toBe(1);
    expect(posts[0].url).toBe(WORK + '/production/worker-links/ln-1/revoke');
    expect(posts[0].body).toBeUndefined();
    expect(msg()).toBe('링크를 끊었습니다.');
    expect(rows('links')[0]).toBe('한재단 | 끊음 | 2026-12-01 | 11/09 11:30 |');
    expect(part('links').querySelector('[data-act="revoke"]')).toBeNull();
  });

  test('「끊기」 — 서버가 막으면 서버 글', async () => {
    await load({ revoke: () => fail(404, 'not_found', '작업자 링크를 찾을 수 없습니다') });
    await press(btn('links', 'revoke', 'ln-1'));
    await press(askBox('links').querySelector('[data-act="yes"]'));
    expect(msg()).toBe('작업자 링크를 찾을 수 없습니다');
    expect(askBox('links')).toBeNull();
  });
});

describe('실측 보정 — 적용', () => {
  test('공정 하나 「…으로 적용」 — 그 공정만 보내고, 보정 · 기록을 다시 읽는다', async () => {
    let n = 0;
    const calls = await load({
      calib: () => {
        const c = calib();
        if (n++ > 0) c.result[0].current = 340;
        return ok(c);
      },
    });
    more().open = true; // 펼쳐 둔 기록은 다시 그려도 펼친 채로
    await press(part('calib').querySelector('[data-act="apply"]'));
    const posts = sent(calls, 'POST');
    expect(posts.length).toBe(1);
    expect(posts[0].url).toBe(WORK + '/production/calibration/apply');
    expect(posts[0].body).toEqual({ roles: ['cutter'] });
    expect(msg()).toBe(
      '표준시간을 실측값으로 바꿨습니다. 생산 계획에서 「지금 다시 계산」을 누르면 추천에 반영됩니다.'
    );
    expect(rows('calib')[0]).toBe('재단 (원판 1장) | 반영됨 | 12 | 40 | 5.7분 | 5.7분 | +14%');
    expect(btn('calib', 'apply-all').disabled).toBe(true);
    expect(more().open).toBe(true);
    expect(asked(calls).filter((x) => x === 'GET /production/calibration').length).toBe(2);
    expect(asked(calls).filter((x) => x.startsWith('GET /production/worklogs')).length).toBe(2);
  });

  test('「보정 모두 적용」 — 공정을 정하지 않고 보낸다 (서버가 제안 있는 공정 전부)', async () => {
    const calls = await load();
    await press(btn('calib', 'apply-all'));
    const posts = sent(calls, 'POST');
    expect(posts.length).toBe(1);
    expect(posts[0].body).toEqual({ roles: null });
  });

  test('적용 — 서버가 막으면 서버 글, 표는 그대로', async () => {
    await load({
      apply: () => fail(400, 'validation', '적용할 보정값이 없습니다 (기록이 부족합니다)'),
    });
    await press(btn('calib', 'apply-all'));
    expect(msg()).toBe('적용할 보정값이 없습니다 (기록이 부족합니다)');
    expect(rows('calib')[0]).toContain('5.7분으로 적용');
  });

  test('처리하는 동안에는 단추를 한 번만 받는다', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const calls = await load({
      apply: async () => {
        await gate;
        return ok({ applied: ['cutter'] });
      },
    });
    btn('calib', 'apply-all').click();
    await flush();
    expect(msg()).toBe('처리하는 중입니다.');
    expect($('productionWorkers').getAttribute('aria-busy')).toBe('true');
    btn('calib', 'apply-all').click();
    btn('factory', 'assign').click();
    btn('factory', 'end', 'fw-1').click();
    await flush();
    expect(sent(calls, 'POST').length).toBe(1);
    expect(askBox('factory')).toBeNull();
    release();
    await flush();
    expect($('productionWorkers').hasAttribute('aria-busy')).toBe(false);
  });
});

describe('누가 보나 · 못 읽을 때', () => {
  test('협력업체 — 묻지도 않는다 · 칸도 메뉴 줄도 없다', async () => {
    const calls = await load({ partner: PARTNER });
    expect(asked(calls)).toEqual([]);
    expect(seen('productionWorkers')).toBe(false);
    expect($('productionWorkers').innerHTML).toBe('');
    expect(menuRow().hidden).toBe(true);
  });

  test('공장 직원 — 공장 배정이 403 이면 칸째 감추고 메뉴 줄도 감춘다 (나머지는 묻지 않는다)', async () => {
    const calls = await load({ factory: () => fail(403, 'forbidden', '권한이 없습니다') });
    expect(asked(calls)).toEqual(['GET /production/factory-workers']);
    expect(seen('productionWorkers')).toBe(false);
    expect($('productionWorkers').innerHTML).toBe('');
    expect(menuRow().hidden).toBe(true);
  });

  test('공장 배정을 읽다 끊기거나 모양이 다르면 칸째 감춘다', async () => {
    await load({ factory: () => new Error('offline') });
    expect(seen('productionWorkers')).toBe(false);
    await load({ factory: () => ok([]) });
    expect(seen('productionWorkers')).toBe(false);
    expect(menuRow().hidden).toBe(true);
  });

  test('작업자 링크만 못 읽으면 그 부분만 뺀다', async () => {
    await load({ links: () => fail(500, 'server', 'x') });
    expect(seen('productionWorkers')).toBe(true);
    expect(parts()).toEqual(['factory', 'calib']);
  });

  test('실측 보정만 못 읽으면 그 부분만 뺀다 (기록도 묻지 않는다)', async () => {
    const calls = await load({ calib: () => fail(500, 'server', 'x') });
    expect(parts()).toEqual(['factory', 'links']);
    expect(asked(calls).some((x) => x.startsWith('GET /production/worklogs'))).toBe(false);
  });

  test('최근 기록만 못 읽으면 「최근 기록 보기」만 뺀다', async () => {
    await load({ logs: () => fail(500, 'server', 'x') });
    expect(parts()).toEqual(['factory', 'links', 'calib']);
    expect(more()).toBeNull();
    expect(rows('calib').length).toBe(3);
  });

  test('로그인하지 않았으면 묻지 않는다', async () => {
    const calls = await load({ session: null });
    expect(asked(calls)).toEqual([]);
    expect(seen('productionWorkers')).toBe(false);
  });
});

describe('이름 · 주문', () => {
  test('localStorage · sessionStorage 에 작업자 이름 · 주문 이름을 남기지 않는다', async () => {
    await load();
    more().open = true;
    await press(btn('factory', 'end', 'fw-1'));
    await press(askBox('factory').querySelector('[data-act="no"]'));
    const kept = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    for (const name of ['김재단', '이조립', '박엣지', '한재단', '가람 주방'])
      expect(kept).not.toContain(name);
  });
});
