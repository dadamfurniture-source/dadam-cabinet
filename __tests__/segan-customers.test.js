/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event, KeyboardEvent */
/**
 * SEGAN 「프로젝트 관리 › 영업 › 고객」 (segan/customers.js + segan/me.html #customers)
 *
 *   누가    프로젝트를 가지는 업체 구성원 — 다담 공장 구성원 · 협력업체 Manager · Expert · Agent.
 *           고치기는 서버가 can_manage 를 준 사람(대표 · 실장)만
 *   데이터  workflow-api GET /company/customers · PATCH /company/customers/:id (마이페이지 5단계)
 *   화면    찾기 · 몇 명 · 고객 줄(이름 · 전화 · 앱 고객 · 프로젝트) · 그 줄에서 고치는 칸 · 더 보기
 *   못 읽으면 칸째 감춘다 — 고객 화면에는 마이페이지가 「불러오지 못했습니다」를 적는다
 *   고객 이름 · 전화는 모두 지어낸 것이다
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
const NOW = Date.parse('2026-11-11T03:00:00Z');

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
const NOBODY = ok({ company: null, application: null, members: [], invites: [] });
const company = (plan, role = 'owner', status = 'active') => ({
  id: CO,
  name: '다담 협력 주방',
  plan,
  next_plan: null,
  status,
  sido: '대구광역시',
  gugun: '북구',
  role,
  created_at: '2026-10-01T00:00:00Z',
});
const partnerOf = (plan, role, status) =>
  ok({ company: company(plan, role, status), application: null, members: [], invites: [] });

const mod = () => {
  delete window.SeganCustomers;
  (0, eval)(read('segan/customers.js'));
  return window.SeganCustomers;
};

const cu = (id, name, phone, patch = {}) => ({
  id,
  name,
  phone,
  app_user: false,
  created_at: '2026-11-01T02:00:00Z',
  updated_at: '2026-11-01T02:00:00Z',
  projects: [],
  ...patch,
});
const ITEMS = () => [
  cu('cu-1', '예시 김고객', '010-0000-0001', {
    app_user: true,
    projects: [
      { id: 'p1', title: '예시 싱크대', status: 'active' },
      { id: 'p2', title: null, status: 'closed' },
    ],
  }),
  cu('cu-2', '예시 이고객', null),
  cu('cu-3', null, '053-000-0003', {
    projects: [{ id: 'p3', title: '예시 신발장', status: 'cancelled' }],
  }),
];
const many = (n) =>
  Array.from({ length: n }, (_, i) =>
    cu('m-' + i, '고객 ' + String(i).padStart(3, '0'), '010-1000-' + String(1000 + i))
  );

/**
 * 마이페이지를 띄운다 (기본 = Agent 업체 대표, 고객 화면)
 * opts.canManage · opts.items · opts.list() · opts.patch(id, body) · opts.gate(고치기 답을 붙잡아 둘 약속)
 */
async function load(options = {}) {
  const store = { items: options.items || ITEMS() };
  const opts = {
    session: SESSION,
    partner: partnerOf('agent', 'owner'),
    hash: '#p-customers',
    canManage: true,
    list: null,
    patch: null,
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
    'SeganPartnerProjects',
    'SeganOrders',
    'SeganQuotes',
    'SeganCustomers',
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
      type: (init.headers || {})['Content-Type'],
      cache: init.cache,
      body,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/company/customers')
      return reply(
        opts.list
          ? await opts.list()
          : ok({ company: { id: CO }, can_manage: opts.canManage, items: store.items })
      );
    if (url.startsWith(WORK + '/company/customers/')) {
      if (opts.gate) await opts.gate;
      const id = decodeURIComponent(url.slice((WORK + '/company/customers/').length));
      if (opts.patch) return reply(await opts.patch(id, body));
      return reply(
        ok({ id, name: body.name, phone: body.phone, updated_at: '2026-11-11T03:00:00Z' })
      );
    }
    if (url === WORK + '/company/projects')
      return reply(ok({ company: { id: CO }, can_manage: false, members: [], items: [] }));
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
    'segan/customers.js',
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
const box = () => $('customers');
const q = (sel) => box().querySelector(sel);
const qa = (sel) => [...box().querySelectorAll(sel)];
const part = (name) => q(`[data-cu="${name}"]`);
const rows = () => qa('li[data-cu-row]');
const row = (id) => q(`li[data-cu-row="${id}"]`);
const names = () => rows().map((li) => text(li.querySelector('b')));
const editBtn = (id) => q(`[data-act="edit"][data-id="${id}"]`);
const press = async (el) => {
  el.click();
  await flush();
};
const type = (id, value) => {
  $(id).value = value;
  $(id).dispatchEvent(new Event('input', { bubbles: true }));
};
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/company/customers'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));
const patches = (calls) => calls.fetch.filter((c) => c.method === 'PATCH');

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸(#partner) 안, 견적서 다음 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('customers');
    expect(el).not.toBeNull();
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('partner');
    expect(el.previousElementSibling.id).toBe('quotes');
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['customers.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('customers.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'customers.js')");
  });

  test('글자 수 · 전화 꼴 · 등급은 서버와 같다', () => {
    const C = mod();
    const server = read('workers/workflow-api/src/company-projects.js');
    expect(server).toContain('CUSTOMER_NAME_MAX = 50');
    expect(C.NAME_MAX).toBe(50);
    expect(server).toContain('PHONE_RE = /^[0-9][0-9-]{7,19}$/');
    expect(String(C.PHONE_RE)).toBe('/^[0-9][0-9-]{7,19}$/');
    expect(C.PLANS).toEqual(['manager', 'expert', 'agent']);
    const routes = read('workers/workflow-api/src/worker.js');
    expect(routes).toContain("path: '/company/customers'");
    expect(routes).toContain("path: '/company/customers/:id'");
    expect(read('workers/workflow-api/src/company-customers.js')).toContain(
      C.TEXT.badPhone.replace(/\.$/, '')
    );
  });

  test('고객 정보를 기기에 남기지 않는다 — 저장소 · 알림을 쓰지 않고, 확인 창도 띄우지 않고, 지우는 요청이 없다', () => {
    const code = read('segan/customers.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
    expect(code).not.toMatch(/'DELETE'|'POST'|'PUT'/);
    expect(code).not.toMatch(/<form\b/);
  });
});

describe('순수 함수', () => {
  test('canSee — 다담 공장 구성원 · active 협력업체 Manager · Expert · Agent 구성원', () => {
    const C = mod();
    const me = (r) => r.body.data;
    expect(C.canSee(me(HQ))).toBe(true);
    for (const plan of ['manager', 'expert', 'agent']) {
      for (const role of ['owner', 'manager', 'staff']) {
        expect(C.canSee(me(partnerOf(plan, role)))).toBe(true);
      }
    }
    expect(C.canSee(me(partnerOf('agent', 'owner', 'suspended')))).toBe(false);
    expect(C.canSee(me(partnerOf(null, 'owner')))).toBe(false);
    expect(C.canSee(me(PLATFORM))).toBe(false);
    expect(C.canSee(me(NOBODY))).toBe(false);
    expect(C.canSee(null)).toBe(false);
  });

  test('rowOf · listOf · projectsText', () => {
    const C = mod();
    expect(C.rowOf({ name: 'x' })).toBeNull();
    expect(C.listOf({ items: 'x' })).toBeNull();
    expect(C.listOf(null)).toBeNull();
    const [a, b, c] = C.listOf({ items: [...ITEMS(), null, {}] });
    expect(a).toEqual({
      id: 'cu-1',
      name: '예시 김고객',
      phone: '010-0000-0001',
      appUser: true,
      projects: [
        { title: '예시 싱크대', status: 'active' },
        { title: '', status: 'closed' },
      ],
    });
    expect(C.projectsText(a)).toBe('프로젝트 2건 — 예시 싱크대 · 이름 없는 프로젝트 (끝남)');
    expect(C.projectsText(b)).toBe('프로젝트 없음');
    expect(C.projectsText(c)).toBe('프로젝트 1건 — 예시 신발장 (취소)');
    expect(C.projectsText({ projects: [{ title: 'x', status: 'toString' }] })).toBe(
      '프로젝트 1건 — x'
    );
  });

  test('filtered — 이름(대소문자 없이) 또는 전화(숫자만 견준다, 두 자리부터)', () => {
    const C = mod();
    const list = C.listOf({ items: ITEMS() });
    const ids = (s) => C.filtered(list, s).map((r) => r.id);
    expect(ids('')).toEqual(['cu-1', 'cu-2', 'cu-3']);
    expect(ids('  이고객 ')).toEqual(['cu-2']);
    expect(ids('00000001')).toEqual(['cu-1']);
    expect(ids('010-0000-0001')).toEqual(['cu-1']);
    expect(ids('053')).toEqual(['cu-3']);
    expect(ids('예시 1')).toEqual([]); // 이름에 없고, 숫자 한 자리는 전화로 찾지 않는다
    expect(ids('없는사람')).toEqual([]);
  });

  test('telHref · bodyOf · countText', () => {
    const C = mod();
    expect(C.telHref('010-0000-0001')).toBe('tel:010-0000-0001');
    expect(C.telHref('전화없음')).toBe('');
    expect(C.telHref('javascript:alert(1)')).toBe('');
    expect(C.bodyOf({ name: ' 새이름 ', phone: ' 010-1234-5678 ' })).toEqual({
      body: { name: '새이름', phone: '010-1234-5678' },
    });
    expect(C.bodyOf({ name: '가', phone: '  ' })).toEqual({ body: { name: '가', phone: null } });
    expect(C.bodyOf({ name: ' ', phone: '' })).toEqual({
      error: '이름을 적어 주세요.',
      field: 'name',
    });
    expect(C.bodyOf({ name: '가', phone: '010' })).toEqual({
      error: '전화는 숫자와 - 로 8~20자입니다.',
      field: 'phone',
    });
    expect(C.bodyOf(null).field).toBe('name');
    expect(C.countText(3, 3)).toBe('3명');
    expect(C.countText(1, 3)).toBe('1명 / 전체 3명');
  });
});

describe('화면', () => {
  test('대표 — 한 번 읽어 고객 줄을 그린다. 줄마다 「고치기」', async () => {
    const calls = await load();
    expect(asked(calls)).toEqual(['GET /company/customers']);
    const c = calls.fetch.find((x) => x.url === WORK + '/company/customers');
    expect(c.auth).toBe('Bearer tok-1');
    expect(c.cache).toBe('no-store');
    expect(seen('customers')).toBe(true);
    expect(text($('customersTitle'))).toBe('고객');
    expect(text(part('count'))).toBe('3명');
    expect(names()).toEqual(['예시 김고객', '예시 이고객', '이름 없음']);
    const [a, b, c3] = rows();
    const tel = a.querySelector('small a');
    expect(tel.getAttribute('href')).toBe('tel:010-0000-0001');
    expect(text(tel)).toBe('010-0000-0001');
    expect(text(a.querySelector('.cu-badge'))).toBe('앱 고객');
    expect(text(a.querySelector('.cp-memo'))).toBe(
      '프로젝트 2건 — 예시 싱크대 · 이름 없는 프로젝트 (끝남)'
    );
    expect(text(b.querySelector('small'))).toBe('전화 없음');
    expect(b.querySelector('small a')).toBeNull();
    expect(b.querySelector('.cu-badge')).toBeNull();
    expect(text(c3.querySelector('.cp-memo'))).toBe('프로젝트 1건 — 예시 신발장 (취소)');
    expect(qa('[data-act="edit"]').length).toBe(3);
    expect(text(q('.mk-note'))).toContain('이미 보낸 견적서 · 수주에 적힌 이름은 그대로입니다');
  });

  test('직원(서버가 can_manage 를 주지 않음) — 보기만, 「고치기」가 없다', async () => {
    await load({ partner: partnerOf('agent', 'staff'), canManage: false });
    expect(seen('customers')).toBe(true);
    expect(rows().length).toBe(3);
    expect(qa('button').length).toBe(0);
    expect(text(q('.mk-note'))).toBe(
      '우리 팩토리의 고객입니다. 이름 · 전화는 대표 · 실장이 고칩니다.'
    );
  });

  test('찾기 — 서버에 묻지 않고 거른다. 찾는 칸은 다시 그리지 않는다', async () => {
    const calls = await load();
    const input = $('cuSearch');
    type('cuSearch', '이고객');
    expect($('cuSearch')).toBe(input);
    expect(names()).toEqual(['예시 이고객']);
    expect(text(part('count'))).toBe('1명 / 전체 3명');
    type('cuSearch', '053');
    expect(names()).toEqual(['이름 없음']);
    type('cuSearch', '없는사람');
    expect(rows().length).toBe(0);
    expect(text(part('empty'))).toBe('맞는 고객이 없습니다.');
    type('cuSearch', '');
    expect(rows().length).toBe(3);
    expect(asked(calls).length).toBe(1);
  });

  test('더 보기 — 한 번에 PAGE 명, 남은 수를 적고 이어 붙인다', async () => {
    const C0 = mod();
    const n = C0.PAGE + 7;
    await load({ items: many(n) });
    const C = window.SeganCustomers;
    expect(rows().length).toBe(C.PAGE);
    expect(text(q('[data-act="more"]'))).toBe('더 보기 (남은 7명)');
    await press(q('[data-act="more"]'));
    expect(rows().length).toBe(n);
    expect(q('[data-act="more"]')).toBeNull();
    expect(document.activeElement).toBe(rows()[C.PAGE]);
  });

  test('고객이 없으면 — 안내 글만 (찾는 칸 없음)', async () => {
    await load({ items: [] });
    expect(seen('customers')).toBe(true);
    expect(text(part('empty'))).toBe('고객이 없습니다. 프로젝트를 만들 때 고객을 함께 넣습니다.');
    expect($('cuSearch')).toBeNull();
  });

  test('이름 · 전화 · 프로젝트 이름은 글자 그대로 그린다. 이상한 전화는 링크로 만들지 않는다', async () => {
    const items = ITEMS();
    items[0].name = '<img src=x onerror=1>';
    items[0].phone = 'javascript:alert(1)';
    items[0].projects[0].title = '<script>x</script>';
    await load({ items });
    expect(q('img')).toBeNull();
    expect(q('script')).toBeNull();
    expect(text(rows()[0].querySelector('b'))).toBe('<img src=x onerror=1>');
    expect(rows()[0].querySelector('small a')).toBeNull();
    expect(text(rows()[0].querySelector('small'))).toBe('javascript:alert(1)');
    expect(text(rows()[0].querySelector('.cp-memo'))).toContain('<script>x</script>');
  });

  test('고객 화면에서만 보인다 — 다른 화면에서는 꺼진다', async () => {
    await load({ hash: '#p-quote' });
    expect(seen('customers')).toBe(false);
    window.location.hash = '#p-customers';
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(seen('customers')).toBe(true);
  });
});

describe('고치기', () => {
  test('「고치기」 — 그 줄에서 이름 · 전화 칸이 열린다 (서버에 묻지 않는다). 한 번에 한 줄', async () => {
    const calls = await load();
    await press(editBtn('cu-1'));
    expect(asked(calls).length).toBe(1);
    expect(qa('[data-cu="form"]').length).toBe(1);
    expect(row('cu-1').querySelector('[data-cu="form"]')).not.toBeNull();
    expect($('cuName').value).toBe('예시 김고객');
    expect($('cuPhone').value).toBe('010-0000-0001');
    expect($('cuName').getAttribute('maxlength')).toBe('50');
    expect(document.activeElement).toBe($('cuName'));
    expect(editBtn('cu-1')).toBeNull(); // 고치는 줄에는 「고치기」 단추가 없다
    for (const id of ['cuName', 'cuPhone']) {
      expect($(id).closest('label').querySelector('span')).not.toBeNull();
    }
    await press(editBtn('cu-2'));
    expect(qa('[data-cu="form"]').length).toBe(1);
    expect(row('cu-2').querySelector('[data-cu="form"]')).not.toBeNull();
    expect($('cuPhone').value).toBe('');
  });

  test('「저장」 — 이름 · 전화를 PATCH 로 보내고 그 줄을 바꾼다 (목록을 다시 읽지 않는다)', async () => {
    const calls = await load();
    await press(editBtn('cu-2'));
    type('cuName', '  이새이름 ');
    type('cuPhone', '010-9999-0000');
    await press(q('[data-act="save"]'));
    const p = patches(calls);
    expect(p.length).toBe(1);
    expect(p[0].url).toBe(WORK + '/company/customers/cu-2');
    expect(p[0].auth).toBe('Bearer tok-1');
    expect(p[0].type).toBe('application/json');
    expect(p[0].body).toEqual({ name: '이새이름', phone: '010-9999-0000' });
    expect(asked(calls)).toEqual(['GET /company/customers', 'PATCH /company/customers/cu-2']);
    expect(q('[data-cu="form"]')).toBeNull();
    expect(text(row('cu-2').querySelector('b'))).toBe('이새이름');
    expect(row('cu-2').querySelector('small a').getAttribute('href')).toBe('tel:010-9999-0000');
    expect(text(part('msg'))).toBe('고쳤습니다.');
    expect(part('msg').closest('li')).toBe(row('cu-2'));
    expect(document.activeElement).toBe(editBtn('cu-2'));
  });

  test('전화를 비우면 — null 을 보내 지운다. 글 칸에서 Enter 로도 저장한다', async () => {
    const calls = await load();
    await press(editBtn('cu-1'));
    type('cuPhone', '   ');
    $('cuPhone').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(patches(calls)[0].body).toEqual({ name: '예시 김고객', phone: null });
    expect(text(row('cu-1').querySelector('small'))).toBe('전화 없음');
  });

  test('틀린 칸 — 보내지 않고 그 자리에 적는다 (이름 없음 · 전화 꼴)', async () => {
    const calls = await load();
    await press(editBtn('cu-1'));
    type('cuName', '   ');
    await press(q('[data-act="save"]'));
    expect(text(part('err'))).toBe('이름을 적어 주세요.');
    expect(document.activeElement).toBe($('cuName'));
    type('cuName', '김고객');
    type('cuPhone', '010-12');
    await press(q('[data-act="save"]'));
    expect(text(part('err'))).toBe('전화는 숫자와 - 로 8~20자입니다.');
    expect(document.activeElement).toBe($('cuPhone'));
    expect($('cuName').value).toBe('김고객'); // 적던 것은 그대로
    expect(patches(calls).length).toBe(0);
  });

  test('서버가 막으면 — 서버 글을 적고 고치던 칸은 그대로 둔다', async () => {
    await load({ patch: () => fail(403, 'not_manager', '팩토리 대표 · 실장만 할 수 있습니다') });
    await press(editBtn('cu-1'));
    type('cuName', '바꾸는 중');
    await press(q('[data-act="save"]'));
    expect(text(part('err'))).toBe('팩토리 대표 · 실장만 할 수 있습니다');
    expect($('cuName').value).toBe('바꾸는 중');
    expect(text(row('cu-1').querySelector('b'))).toBe('예시 김고객'); // 줄은 그대로
    expect(part('msg')).toBeNull();
  });

  test('끊기거나 글 없는 오류 — 기본 글', async () => {
    await load({ patch: () => new Error('offline') });
    await press(editBtn('cu-1'));
    await press(q('[data-act="save"]'));
    expect(text(part('err'))).toBe('처리하지 못했습니다. 잠시 뒤 다시 해 주세요.');
  });

  test('「그만 고치기」 — 보내지 않고 칸을 닫는다', async () => {
    const calls = await load();
    await press(editBtn('cu-1'));
    type('cuName', '버릴 글');
    await press(q('[data-act="stop"]'));
    expect(q('[data-cu="form"]')).toBeNull();
    expect(text(row('cu-1').querySelector('b'))).toBe('예시 김고객');
    expect(patches(calls).length).toBe(0);
    expect(document.activeElement).toBe(editBtn('cu-1'));
  });

  test('보내는 동안 — 칸과 단추를 잠그고 다시 눌러도 한 번만 보낸다', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const calls = await load({ gate });
    await press(editBtn('cu-1'));
    await press(q('[data-act="save"]'));
    expect(box().getAttribute('aria-busy')).toBe('true');
    expect(qa('[data-cu="form"] input, button').every((el) => el.disabled)).toBe(true);
    await press(q('[data-act="save"]'));
    release();
    await flush();
    await flush();
    expect(patches(calls).length).toBe(1);
    expect(box().hasAttribute('aria-busy')).toBe(false);
    expect(text(part('msg'))).toBe('고쳤습니다.');
  });
});

describe('안 보이는 때', () => {
  test('본사 구성원 · 업체 없는 사람 · 멈춘 업체 · 로그인하지 않은 사람 · 워커 주소 없음 — 묻지 않는다', async () => {
    for (const o of [
      { partner: PLATFORM },
      { partner: NOBODY },
      { partner: partnerOf('agent', 'owner', 'suspended') },
      { session: null },
      { work: '' },
    ]) {
      const calls = await load(o);
      expect(asked(calls)).toEqual([]);
      expect(seen('customers')).toBe(false);
      expect(box().innerHTML).toBe('');
    }
  }, 30000);

  test('못 읽으면(403 · 오류 · 끊김 · 목록 없는 답) — 칸째 감추고, 고객 화면에는 「불러오지 못했습니다」', async () => {
    for (const list of [
      () => fail(403, 'not_project_company', '프로젝트를 쓸 수 있는 팩토리가 아닙니다'),
      () => fail(404, 'not_found', 'Not found'),
      () => new Error('offline'),
      () => ok({ items: 'x' }),
      () => ok(null),
    ]) {
      const calls = await load({ list });
      expect(asked(calls)).toEqual(['GET /company/customers']);
      expect(seen('customers')).toBe(false);
      expect(box().hidden).toBe(true);
      expect(box().innerHTML).toBe('');
      expect(document.body.textContent).toContain(
        '고객을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.'
      );
    }
  }, 30000);
});
