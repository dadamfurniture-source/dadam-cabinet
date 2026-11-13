/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element */
/**
 * SEGAN 「인사 › 작업자」 팩토리의 작업자 연결 · 초대 (segan/company-workers.js — #companyWorkers)
 *
 *   2026-11-13 사장님 결정 「작업자 한 길」 — 팩토리(다담 공장 · Agent)마다 자기 작업자를 초대 링크로 모으고 승인한다.
 *   누가      다담 공장 · Agent 구성원이 보고, 서버가 can_manage 라고 한 사람(대표 · 실장)만 바꾼다. 새 초대 · 승인은 can_invite 일 때만
 *   서버      GET /company/workers · POST /company/workers/invites · POST …/invites/:id/revoke · PATCH /company/workers/:linkId
 *   못 읽으면(DB 0064 적용 전 포함) 칸을 감춘다 — 작업자 메뉴는 「준비 중」으로 남는다
 *   이름 · 전화는 모두 지어낸 것이다
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
const NOW = Date.parse('2026-11-13T03:00:00Z'); // 한국 시간 2026-11-13 (금) 12:00

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const HQ = ok({ company: null, application: null, members: [], invites: [], hq_member: true });
const PLATFORM = ok({
  company: null,
  application: null,
  members: [],
  invites: [],
  platform_member: true,
});
const partnerOf = (plan, role = 'staff') =>
  ok({
    company: {
      id: CO,
      name: '다담 협력 주방',
      plan,
      next_plan: null,
      status: 'active',
      sido: '대구광역시',
      gugun: '북구',
      role,
      created_at: '2026-10-01T00:00:00Z',
    },
    application: null,
    members: [],
    invites: [],
  });

const WORKERS = () => [
  {
    link_id: 'l-1',
    name: '예시 김설치',
    kinds: ['install'],
    region: '대구 북구',
    status: 'pending',
    account_status: 'pending',
    via: 'invite',
    since: '2026-11-12T02:00:00Z',
    decided_at: null,
    reason: null,
    active: 0,
    phone: '010-0000-0001',
  },
  {
    link_id: 'l-3',
    name: '예시 <b>이설치</b>',
    kinds: ['install', 'as'],
    region: null,
    status: 'approved',
    account_status: 'approved',
    via: 'migrated',
    since: '2026-10-01T02:00:00Z',
    decided_at: '2026-10-02T02:00:00Z',
    reason: null,
    active: 2,
    phone: '010-0000-0003',
  },
  {
    link_id: 'l-4',
    name: '예시 최설치',
    kinds: ['install'],
    region: '경북 경산시',
    status: 'approved',
    account_status: 'suspended',
    via: 'invite',
    since: '2026-09-01T02:00:00Z',
    decided_at: '2026-09-01T03:00:00Z',
    reason: null,
    active: 0,
    phone: null,
  },
  {
    link_id: 'l-5',
    name: '',
    kinds: ['as'],
    region: '대구 달서구',
    status: 'suspended',
    account_status: 'approved',
    via: 'invite',
    since: '2026-09-10T02:00:00Z',
    decided_at: '2026-11-08T02:00:00Z',
    reason: '연락이 닿지 않음',
    active: 0,
    phone: '010-0000-0005',
  },
  {
    link_id: 'l-6',
    name: '예시 한설치',
    kinds: ['install'],
    region: null,
    status: 'rejected',
    account_status: 'pending',
    via: 'invite',
    since: '2026-10-20T02:00:00Z',
    decided_at: '2026-10-21T02:00:00Z',
    reason: null,
    active: 0,
    phone: null,
  },
  { link_id: 'l-9', name: '모르는 상태', kinds: [], status: 'weird' },
];
const INVITES = () => [
  {
    id: 'i-1',
    kinds_preset: ['install'],
    display_name_preset: '예시 강설치',
    expires_at: '2026-11-18T03:00:00Z',
    created_at: '2026-11-11T03:00:00Z',
  },
  {
    id: 'i-2',
    kinds_preset: [],
    display_name_preset: null,
    expires_at: '2026-11-15T03:00:00Z',
    created_at: '2026-11-12T03:00:00Z',
  },
];

async function load(options = {}) {
  const store = { workers: WORKERS(), invites: INVITES() };
  const opts = {
    session: SESSION,
    partner: partnerOf('agent', 'owner'),
    hash: '#workers',
    manage: true,
    invite: true,
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
    'SeganProductionWorkers',
    'SeganCompanyWorkers',
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
  const calls = { fetch: [], store };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async (name) =>
        name === 'is_admin' ? { data: false, error: null } : { data: [], error: null },
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
      cache: init.cache,
      body,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/company/workers') {
      if (opts.workers) return reply(opts.workers());
      return reply(
        ok({
          company: { name: '다담 협력 주방' },
          can_manage: opts.manage,
          can_invite: opts.manage && opts.invite,
          workers: store.workers.map((w) => {
            const o = { ...w };
            if (!opts.manage) delete o.phone;
            return o;
          }),
          invites: opts.manage ? store.invites : [],
        })
      );
    }
    if (url === WORK + '/company/workers/invites' && method === 'POST') {
      if (opts.make) return reply(opts.make(body));
      store.invites.unshift({
        id: 'i-9',
        kinds_preset: body.kinds_preset,
        display_name_preset: body.display_name_preset || null,
        expires_at: body.expires_at,
        created_at: '2026-11-13T03:00:00Z',
      });
      return reply(
        ok(
          {
            id: 'i-9',
            url: 'https://dadamfurniture.com/segan/work.html#invite=TOKEN-ABCDEFGHIJKLMNOP',
            expires_at: body.expires_at,
          },
          201
        )
      );
    }
    const revoke = /\/company\/workers\/invites\/([^/]+)\/revoke$/.exec(url);
    if (revoke && method === 'POST') {
      store.invites = store.invites.filter((v) => v.id !== revoke[1]);
      return reply(ok({ id: revoke[1], revoked: true }));
    }
    const patch = /\/company\/workers\/([^/]+)$/.exec(url);
    if (patch && method === 'PATCH') {
      if (opts.patch) {
        const r = opts.patch(body, patch[1]);
        if (r) return reply(r);
      }
      const w = store.workers.find((x) => x.link_id === patch[1]);
      w.status = body.status;
      w.reason = body.reason || null;
      return reply(ok({ link_id: w.link_id, status: w.status, kinds: w.kinds }));
    }
    // 다담 공장 — 공장 배정 (segan/production-workers.js)
    if (url === WORK + '/production/factory-workers')
      return reply(opts.factory ? opts.factory() : fail(403, 'forbidden', 'x'));
    if (url === WORK + '/production/worker-links') return reply(ok({ items: [] }));
    if (url === WORK + '/company/projects')
      return reply(ok({ company: { id: CO }, can_manage: false, items: [] }));
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
    'segan/company-workers.js',
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

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const seen = (id) => !!$(id) && !$(id).hidden && !$(id).classList.contains('me-off');
const menu = (key) => document.querySelector(`#meHub li[data-me-item="${key}"]`);
const press = async (el) => {
  el.click();
  await flush();
};
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/company/workers'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));
const box = () => $('companyWorkers');
const group = (name) => box().querySelector(`[data-cw-group="${name}"]`);
const rows = (name) =>
  [...group(name).querySelectorAll('tbody tr')].map((tr) => [...tr.children].map(text).join(' | '));
const act = (name, id) => box().querySelector(`[data-act="${name}"][data-id="${id}"]`);
const msg = () => text(box().querySelector('[data-cw="msg"]'));
const err = () => box().querySelector('[data-cw="err"]');
const mod = () => {
  delete window.SeganCompanyWorkers;
  (0, eval)(read('segan/company-workers.js'));
  return window.SeganCompanyWorkers;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('자리 · 이름', () => {
  test('me.html — 칸은 업체 칸 안(공장 작업자 칸 바로 앞), 처음엔 감춘다 · 스크립트는 me.js 앞 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('companyWorkers');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('partner');
    expect(el.nextElementSibling.id).toBe('productionWorkers');
    expect(el.className).toBe('me-pt-group od pw cw');
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((x) => x === name);
    expect(at('company-workers.js')).toBeGreaterThanOrEqual(0);
    expect(at('company-workers.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'company-workers.js')");
    expect(
      doc.querySelector('#meSubPeople li[data-me-item="workers"] a').getAttribute('href')
    ).toBe('#workers');
  });

  test('기기에 남기지 않는다 — 이름 · 전화 · 초대 링크는 화면에만', () => {
    const code = read('segan/company-workers.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification|document\.cookie/);
    expect(code).not.toMatch(/location\.(hash|search|href)\s*=/);
  });

  test('순수 — 볼 수 있는 사람 · 날짜 · 종류 · 만료 · 줄 꼴', () => {
    const W = mod();
    expect(W.canSee({ hq_member: true })).toBe(true);
    expect(W.canSee({ company: { plan: 'agent' } })).toBe(true);
    expect(W.canSee({ company: { plan: 'expert' } })).toBe(false);
    expect(W.canSee({ platform_member: true, hq_member: true })).toBe(false);
    expect(W.canSee(null)).toBe(false);
    expect(W.dayKst('2026-11-13T15:30:00Z')).toBe('11/14(토)'); // 한국 시간으로 넘어간 날
    expect(W.dayKst('')).toBe('-');
    expect(W.kindsText(['install', 'as', 'nope'])).toBe('설치 · A/S');
    expect(W.kindsText([], '정하지 않음')).toBe('정하지 않음');
    expect(W.expiresIn(7, NOW)).toBe('2026-11-20T03:00:00.000Z');
    expect(W.DAYS).toEqual([3, 7, 30]);
    expect(W.workerOf({ link_id: 'l-1', status: 'weird' })).toBeNull();
    expect(W.workerOf({ link_id: '', status: 'approved' })).toBeNull();
    expect(
      W.workerOf({ link_id: 'l-1', status: 'approved', kinds: ['as', 'x'], active: '2', via: 'x' })
    ).toEqual({
      id: 'l-1',
      name: '',
      kinds: ['as'],
      region: '',
      status: 'approved',
      accountStatus: '',
      via: '',
      since: '',
      decidedAt: '',
      reason: '',
      active: 2,
      phone: '',
    });
    expect(W.inviteOf({ id: 'bad id' })).toBeNull();
    expect(W.STATUS).toEqual({
      pending: '승인 대기',
      approved: '연결됨',
      suspended: '정지',
      rejected: '반려',
      ended: '연결 끝',
    });
  });
});

describe('작업자 — 대표 · 실장', () => {
  test('Agent 대표 — 승인 대기 · 연결됨 · 정지 표와 단추, 반려 · 끝은 접어 둔다. 한 번만 읽는다', async () => {
    const calls = await load();
    expect(asked(calls)).toEqual(['GET /company/workers']);
    const first = calls.fetch.find((c) => c.url === WORK + '/company/workers');
    expect([first.auth, first.cache]).toEqual(['Bearer tok-1', 'no-store']);
    expect(seen('companyWorkers')).toBe(true);
    expect($('mePaneNote').hidden).toBe(true);
    expect(menu('workers').hidden).toBe(false);
    expect(menu('workers').querySelector('a').classList.contains('me-row-soon')).toBe(false);
    expect($('partner').getAttribute('aria-labelledby')).toBe('companyWorkersTitle');
    expect(text($('companyWorkersTitle'))).toBe('작업자 연결 · 초대');
    expect([...box().querySelectorAll('.cw-tabs button')].map(text)).toEqual([
      '작업자 · 승인 대기 1',
      '초대 2',
    ]);
    expect(rows('pending')).toEqual([
      '예시 김설치 | 설치 | 대구 북구 | 010-0000-0001 | 11/12(목) · 초대 링크 | 승인반려',
    ]);
    expect(rows('approved')).toEqual([
      '예시 <b>이설치</b> | 설치 · A/S | - | 010-0000-0003 | 2건 | 정지연결 끊기',
      '예시 최설치 (본사 정지) | 설치 | 경북 경산시 | - | - | 정지연결 끊기',
    ]);
    expect(rows('suspended')).toEqual([
      '이름 없음 | A/S | 대구 달서구 | 010-0000-0005 | 연락이 닿지 않음 | 다시 승인연결 끊기',
    ]);
    // 이름은 글자로만 — 태그가 되지 않는다
    expect(group('approved').querySelector('td b')).toBeNull();
    const closed = group('closed');
    expect(closed.tagName).toBe('DETAILS');
    expect(closed.open).toBe(false);
    expect(text(closed.querySelector('summary'))).toBe('반려 · 끝난 연결 1');
    expect(closed.querySelectorAll('[data-act]').length).toBe(0);
    expect(box().textContent).not.toContain('모르는 상태');
  });

  test('승인 — 바로 보내고 다시 읽는다. 서버가 막으면 서버 글', async () => {
    const calls = await load();
    await press(act('approve', 'l-1'));
    const sent = calls.fetch.find((c) => c.method === 'PATCH');
    expect([sent.url, sent.body]).toEqual([WORK + '/company/workers/l-1', { status: 'approved' }]);
    expect(asked(calls)).toEqual([
      'GET /company/workers',
      'PATCH /company/workers/l-1',
      'GET /company/workers',
    ]);
    expect(msg()).toBe('승인했습니다. 설치 · A/S 일정에서 배정할 수 있습니다.');
    expect(group('pending')).toBeNull();
    expect(rows('approved').length).toBe(3);

    const again = await load({
      patch: () => fail(409, 'account_suspended', '본사에서 정지한 작업자라 승인할 수 없습니다'),
    });
    await press(act('approve', 'l-5'));
    expect(text(err())).toBe('본사에서 정지한 작업자라 승인할 수 없습니다');
    expect(err().hidden).toBe(false);
    expect(msg()).toBe('');
    expect(asked(again).pop()).toBe('GET /company/workers'); // 실패해도 다시 읽는다
    expect(rows('suspended').length).toBe(1);
  });

  test('반려 · 정지 · 연결 끊기 — 표 아래에서 한 번 더 묻는다 (창 없음). 사유는 반려 · 정지에만', async () => {
    const calls = await load();
    await press(act('reject', 'l-1'));
    const ask = () => box().querySelector('[data-cw="ask"]');
    expect(text(ask().querySelector('p'))).toBe(
      '예시 김설치 — 이 작업자의 연결 신청을 반려할까요?'
    );
    expect(ask().closest('[data-cw-group]').getAttribute('data-cw-group')).toBe('pending');
    expect(calls.fetch.some((c) => c.method === 'PATCH')).toBe(false);
    await press(ask().querySelector('[data-act="no"]'));
    expect(ask()).toBeNull();

    await press(act('reject', 'l-1'));
    ask().querySelector('[data-cw="reason"]').value = ' 지역이 맞지 않음 ';
    await press(ask().querySelector('[data-act="yes"]'));
    expect(calls.fetch.filter((c) => c.method === 'PATCH').pop().body).toEqual({
      status: 'rejected',
      reason: '지역이 맞지 않음',
    });
    expect(msg()).toBe('반려했습니다.');
    expect(text(group('closed').querySelector('summary'))).toBe('반려 · 끝난 연결 2');

    await press(act('suspend', 'l-3'));
    expect(text(ask().querySelector('p'))).toContain(
      '새 배정을 받지 않습니다. 진행 중인 배정은 그대로 갑니다.'
    );
    await press(ask().querySelector('[data-act="yes"]'));
    expect(calls.fetch.filter((c) => c.method === 'PATCH').pop().body).toEqual({
      status: 'suspended',
    });
    expect(rows('suspended').length).toBe(2);

    await press(act('end', 'l-4'));
    expect(ask().querySelector('[data-cw="reason"]')).toBeNull();
    expect(text(ask().querySelector('p'))).toContain('다시 연결하려면 새 초대 링크가 필요합니다.');
    await press(ask().querySelector('[data-act="yes"]'));
    const last = calls.fetch.filter((c) => c.method === 'PATCH').pop();
    expect([last.url, last.body]).toEqual([WORK + '/company/workers/l-4', { status: 'ended' }]);
    expect(msg()).toBe('연결을 끊었습니다.');
  });
});

describe('초대', () => {
  const tab = (name) => box().querySelector(`[data-act="tab"][data-tab="${name}"]`);

  test('만료를 골라야 만든다 (미리 고른 값 없음) — 종류 · 이름 · 만료를 보내고 링크 상자가 뜬다', async () => {
    const calls = await load();
    await press(tab('invite'));
    expect(tab('invite').getAttribute('aria-pressed')).toBe('true');
    expect(box().querySelectorAll('[data-act="days"][aria-pressed="true"]').length).toBe(0);
    expect(box().querySelectorAll('[data-act="kind"][aria-pressed="true"]').length).toBe(0);
    expect([...box().querySelectorAll('[data-act="days"]')].map(text)).toEqual([
      '3일',
      '7일',
      '30일',
    ]);
    await press(box().querySelector('[data-act="make"]'));
    expect(text(err())).toBe('링크 만료를 골라 주세요.');
    expect(calls.fetch.some((c) => c.method === 'POST')).toBe(false);

    await press(box().querySelector('[data-kind="install"]'));
    const name = () => box().querySelector('[data-cw="name"]');
    name().value = ' 예시 새작업자 ';
    name().dispatchEvent(new window.Event('input', { bubbles: true }));
    await press(box().querySelector('[data-kind="as"]'));
    expect(name().value).toBe(' 예시 새작업자 '); // 다시 그려도 적던 이름이 남는다
    await press(box().querySelector('[data-days="7"]'));
    expect(err().hidden).toBe(true);
    await press(box().querySelector('[data-act="make"]'));
    const sent = calls.fetch.find((c) => c.method === 'POST');
    expect([sent.url, sent.body]).toEqual([
      WORK + '/company/workers/invites',
      {
        kinds_preset: ['install', 'as'],
        expires_at: '2026-11-20T03:00:00.000Z',
        display_name_preset: '예시 새작업자',
      },
    ]);
    expect($('companyWorkersLink').value).toBe(
      'https://dadamfurniture.com/segan/work.html#invite=TOKEN-ABCDEFGHIJKLMNOP'
    );
    expect($('companyWorkersLink').readOnly).toBe(true);
    expect(text(box().querySelector('[data-cw="made"] .mk-note'))).toBe(
      '11/20(금)까지 쓸 수 있습니다. 링크는 지금만 보이니 복사해서 카카오톡 · 문자로 보내 주세요.'
    );
    expect(msg()).toBe('초대 링크를 만들었습니다.');
    expect(name().value).toBe('');
    expect(rows('invites')).toEqual([
      '예시 새작업자 | 설치 · A/S | 11/13(금) | 11/20(금) | 초대 취소',
      '예시 강설치 | 설치 | 11/11(수) | 11/18(수) | 초대 취소',
      '정하지 않음 | 정하지 않음 | 11/12(목) | 11/15(일) | 초대 취소',
    ]);
  });

  test('링크 복사 — 되면 알리고, 안 되면 길게 눌러 복사하라고 한다', async () => {
    await load();
    await press(tab('invite'));
    await press(box().querySelector('[data-days="3"]'));
    await press(box().querySelector('[data-act="make"]'));
    const writeText = jest.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    await press(box().querySelector('[data-act="copy"]'));
    expect(writeText).toHaveBeenCalledWith(
      'https://dadamfurniture.com/segan/work.html#invite=TOKEN-ABCDEFGHIJKLMNOP'
    );
    expect(text(box().querySelector('[data-cw="copy"]'))).toBe(
      '복사했습니다. 메시지로 보내 주세요.'
    );
    Object.defineProperty(window.navigator, 'clipboard', { value: undefined, configurable: true });
    await press(box().querySelector('[data-act="copy"]'));
    expect(text(box().querySelector('[data-cw="copy"]'))).toBe(
      '복사하지 못했습니다. 링크를 길게 눌러 복사해 주세요.'
    );
  });

  test('초대 취소 — 한 번 더 묻고 보낸다. 방금 만든 초대를 취소하면 링크 상자도 지운다', async () => {
    const calls = await load();
    await press(tab('invite'));
    await press(box().querySelector('[data-days="30"]'));
    await press(box().querySelector('[data-act="make"]'));
    expect($('companyWorkersLink')).not.toBeNull();
    await press(act('revoke', 'i-1'));
    expect(text(box().querySelector('[data-cw="ask"] p'))).toBe(
      '예시 강설치 — 이 초대를 취소할까요? 보낸 링크를 더 이상 쓸 수 없습니다.'
    );
    await press(box().querySelector('[data-act="yes"]'));
    expect(asked(calls)).toContain('POST /company/workers/invites/i-1/revoke');
    expect(msg()).toBe('초대를 취소했습니다.');
    expect($('companyWorkersLink')).not.toBeNull(); // 다른 초대 — 링크 상자는 그대로
    await press(act('revoke', 'i-9'));
    await press(box().querySelector('[data-act="yes"]'));
    expect($('companyWorkersLink')).toBeNull();
    expect(rows('invites').length).toBe(1);
  });

  test('만들기 실패 — 서버 글을 보이고 적던 것은 그대로', async () => {
    await load({
      make: () =>
        fail(403, 'not_people_company', '작업자를 초대 · 승인할 수 있는 팩토리가 아닙니다'),
    });
    await press(tab('invite'));
    await press(box().querySelector('[data-kind="install"]'));
    await press(box().querySelector('[data-days="7"]'));
    await press(box().querySelector('[data-act="make"]'));
    expect(text(err())).toBe('작업자를 초대 · 승인할 수 있는 팩토리가 아닙니다');
    expect($('companyWorkersLink')).toBeNull();
    expect(box().querySelector('[data-kind="install"]').getAttribute('aria-pressed')).toBe('true');
    expect(box().querySelector('[data-days="7"]').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('누가 무엇을', () => {
  test('직원 — 보기만. 탭 · 단추 · 전화 칸이 없다', async () => {
    await load({ partner: partnerOf('agent', 'staff'), manage: false });
    expect(seen('companyWorkers')).toBe(true);
    expect(menu('workers').hidden).toBe(false);
    expect(box().querySelector('.cw-tabs')).toBeNull();
    expect(box().querySelectorAll('[data-act]').length).toBe(0);
    expect([...group('approved').querySelectorAll('th')].map(text)).toEqual([
      '작업자',
      '종류',
      '지역',
      '진행 중 배정',
    ]);
    expect(box().textContent).not.toContain('010-');
    expect(text(box().querySelector('.mk-note'))).toBe(
      '우리 팩토리와 연결된 작업자입니다. 초대 · 승인은 대표 · 실장이 합니다.'
    );
  });

  test('새 초대 · 승인을 못 하는 팩토리(can_invite 아님) — 승인 단추 · 초대 칸이 없고 반려 · 정지 · 끊기 · 초대 취소는 된다', async () => {
    await load({ invite: false });
    expect(act('approve', 'l-1')).toBeNull();
    expect(act('approve', 'l-5')).toBeNull();
    expect(act('reject', 'l-1')).not.toBeNull();
    expect(act('end', 'l-5')).not.toBeNull();
    await press(box().querySelector('[data-act="tab"][data-tab="invite"]'));
    expect(box().querySelector('[data-cw="form"]')).toBeNull();
    expect(box().textContent).toContain('지금 등급에서는 새 초대 · 승인을 할 수 없습니다.');
    expect(act('revoke', 'i-1')).not.toBeNull();
  });

  test('못 읽으면(DB 적용 전 · 오류) — 대표에게는 「준비 중」 안내와 흐린 줄, 직원에게는 줄이 없다. Expert · 본사는 묻지 않는다', async () => {
    for (const workers of [
      () => fail(409, 'db_pending', 'DB 0064 적용 전입니다'),
      () => fail(500, 'x', 'x'),
      () => new Error('offline'),
      () => ok({ workers: null }),
    ]) {
      await load({ workers });
      expect(seen('companyWorkers')).toBe(false);
      expect($('mePaneNote').textContent).toContain('작업자는 준비 중입니다.');
      expect(menu('workers').hidden).toBe(false);
      expect(menu('workers').querySelector('a').classList.contains('me-row-soon')).toBe(true);
    }
    await load({
      partner: partnerOf('agent', 'staff'),
      workers: () => fail(409, 'db_pending', 'x'),
    });
    expect(menu('workers').hidden).toBe(true);
    for (const partner of [PLATFORM, partnerOf('expert', 'owner'), partnerOf('manager', 'owner')]) {
      const calls = await load({ partner });
      expect(asked(calls)).toEqual([]);
      expect(menu('workers').hidden).toBe(true);
    }
  });

  test('다담 공장 — #workers-hq 에 연결 · 초대 칸과 공장 배정 칸이 같이. 읽힌 칸만 보인다', async () => {
    const factory = () => ok({ assigned: [], candidates: [] });
    await load({ partner: HQ, hash: '#workers-hq', factory });
    expect(menu('workers').hidden).toBe(true);
    expect(menu('workers-hq').hidden).toBe(false);
    expect(seen('companyWorkers')).toBe(true);
    expect(seen('productionWorkers')).toBe(true);
    expect($('partner').getAttribute('aria-labelledby')).toBe('companyWorkersTitle');

    // 공장 배정을 못 읽는 공장 직원 — 연결 칸만
    await load({ partner: HQ, hash: '#workers-hq', manage: false });
    expect(menu('workers-hq').hidden).toBe(false);
    expect(seen('companyWorkers')).toBe(true);
    expect(seen('productionWorkers')).toBe(false);

    // DB 적용 전 — 예전처럼 공장 배정 칸만
    await load({
      partner: HQ,
      hash: '#workers-hq',
      factory,
      workers: () => fail(409, 'db_pending', 'x'),
    });
    expect(menu('workers-hq').hidden).toBe(false);
    expect(seen('companyWorkers')).toBe(false);
    expect(seen('productionWorkers')).toBe(true);
    expect($('partner').getAttribute('aria-labelledby')).toBe('productionWorkersTitle');

    // 둘 다 못 읽으면 줄이 없다
    await load({ partner: HQ, hash: '#workers-hq', workers: () => fail(403, 'x', 'x') });
    expect(menu('workers-hq').hidden).toBe(true);
  });
});
