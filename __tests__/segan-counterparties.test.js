/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event, KeyboardEvent */
/**
 * SEGAN 「구매 · 재고 › 거래처 · 공급처」 (segan/counterparties.js + segan/me.html #counterparties)
 *
 *   누가    다담 공장 구성원(GET /partner/me 의 hq_member) · Expert · Agent 협력업체의 대표 · 실장.
 *           다담 본사 구성원 · Manager 업체 · 그 밖의 구성원 · 업체 없는 사람은 묻지도 않는다
 *   데이터  workflow-api GET|POST /counterparties · PATCH /counterparties/:id
 *   화면    넣는 칸(종류 · 이름 · 갈래 · 연락처 · 메모) · 거래처 줄 · 공급처 줄 · 「고치기」 · 「숨기기」/「다시 쓰기」
 *   못 읽으면 칸째 감춘다 (메뉴 줄도). 이 화면을 못 쓰는 관리자에게는 PC 화면 줄 하나가 남는다
 *   업체 이름 · 연락처 · 메모는 모두 지어낸 것이다
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
const NOW = Date.parse('2026-11-11T03:00:00Z'); // 한국 시간 2026-11-11 (수) 12:00

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const HQ = ok({ company: null, application: null, members: [], invites: [], hq_member: true });
const NOBODY = ok({ company: null, application: null, members: [], invites: [] });
const company = (plan, role = 'staff') => ({
  id: CO,
  name: '다담 협력 주방',
  plan,
  next_plan: null,
  status: 'active',
  sido: '대구광역시',
  gugun: '북구',
  role,
  created_at: '2026-10-01T00:00:00Z',
});
const partnerOf = (plan, role) =>
  ok({ company: company(plan, role), application: null, members: [], invites: [] });

const mod = () => {
  delete window.SeganCounterparties;
  (0, eval)(read('segan/counterparties.js'));
  return window.SeganCounterparties;
};

/** 거래처 · 공급처 한 줄 (서버 counterparties 표와 같은 꼴) */
const cp = (id, kind, name, patch = {}) => ({
  id,
  kind,
  name,
  category: null,
  phone: null,
  memo: null,
  active: true,
  created_at: '2026-11-01T02:00:00Z',
  ...patch,
});
const ITEMS = () => [
  cp('cp-1', 'partner', '예시 가온인테리어', { phone: '010-0000-0001', memo: '월말에 모아 정산' }),
  cp('cp-2', 'partner', '예시 나무디자인', { active: false }),
  cp('cp-3', 'supplier', '예시 가람도어', { category: 'door', phone: '053-000-0002' }),
  cp('cp-4', 'supplier', '예시 다온상판'),
];
const byName = (items) => [...items].sort((a, b) => a.name.localeCompare(b.name, 'ko'));

/**
 * 마이페이지를 띄운다 (기본 = 다담 공장 구성원, 거래처 · 공급처 화면)
 * opts.items = 서버에 있는 줄 · opts.list(n) · opts.post(body) · opts.patch(id, body) 로 답을 바꾼다 (n = 몇 번째 읽기인가)
 * opts.gate = 바꾸기 답을 붙잡아 둘 약속 · opts.isAdmin = 사이트 관리자
 */
async function load(options = {}) {
  const store = { items: options.items || ITEMS(), lists: 0 };
  const opts = {
    session: SESSION,
    partner: HQ,
    hash: '#counterparties',
    isAdmin: false,
    list: null,
    post: null,
    patch: null,
    gate: null,
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
    'SeganProductionSettings',
    'SeganOutsourceOrders',
    'SeganCounterparties',
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
  const listReply = () => {
    store.lists += 1;
    if (opts.list) return opts.list(store.lists);
    return ok({ items: byName(store.items) });
  };
  const postReply = (body) => {
    if (opts.post) return opts.post(body);
    const row = cp('cp-new-' + (store.items.length + 1), body.kind, body.name, {
      category: body.category || null,
      phone: body.phone || null,
      memo: body.memo || null,
    });
    store.items.push(row);
    return ok(row, 201);
  };
  const patchReply = (id, body) => {
    if (opts.patch) return opts.patch(id, body);
    const row = store.items.find((r) => r.id === id);
    if (!row) return fail(404, 'not_found', '찾을 수 없습니다');
    Object.assign(row, body);
    return ok(row);
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
    if (url === WORK + '/counterparties') {
      if (method === 'GET') return reply(await listReply());
      if (opts.gate) await opts.gate;
      return reply(await postReply(body));
    }
    if (url.startsWith(WORK + '/counterparties/')) {
      if (opts.gate) await opts.gate;
      const id = decodeURIComponent(url.slice((WORK + '/counterparties/').length));
      return reply(await patchReply(id, body));
    }
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
    'segan/orders.js',
    'segan/counterparties.js',
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
const box = () => $('counterparties');
const sec = (kind) => box().querySelector(`section[data-cp-kind="${kind}"]`);
const rows = (kind) => [...sec(kind).querySelectorAll('li[data-cp-row]')];
const names = (kind) => rows(kind).map((li) => text(li.querySelector('b')));
const row = (id) => box().querySelector(`li[data-cp-row="${id}"]`);
const act = (name, extra = '') => box().querySelector(`[data-act="${name}"]${extra}`);
const of = (id) => `[data-id="${id}"]`;
const field = (key) => box().querySelector(`[data-f="${key}"]`);
const msg = () => text(box().querySelector('[data-cp="msg"]'));
const err = () => box().querySelector('[data-cp="err"]');
const formTitle = () => text($('counterpartiesFormTitle'));
const catWrap = () => box().querySelector('[data-cp="category"]');
/** 마이페이지 메뉴 줄 — 켜졌는가 */
const menu = (key) => document.querySelector(`#meHub li[data-me-item="${key}"]`);
const press = async (el) => {
  el.click();
  await flush();
};
const type = (key, value) => {
  field(key).value = value;
};
const pick = (key, value) => {
  const el = field(key);
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const go = async (hash) => {
  window.location.hash = hash;
  window.dispatchEvent(new Event('hashchange'));
  await flush();
};
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/counterparties'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));
const last = (calls, method) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/counterparties') && c.method === method)
    .pop();

afterEach(() => {
  jest.restoreAllMocks();
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸(#partner) 안, 작업자 다음 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('counterparties');
    expect(el).not.toBeNull();
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('partner');
    expect(el.classList.contains('od')).toBe(true);
    expect(el.classList.contains('cp')).toBe(true);
    expect(el.previousElementSibling.id).toBe('productionWorkers');
    expect(el.nextElementSibling.id).toBe('orders');
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    // 없으면(-1) 차례 비교가 거짓으로 통과하지 않게 자리부터 본다
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['counterparties.js', 'orders.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('counterparties.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'counterparties.js')");
  });

  test('메뉴 — 구매 · 재고 아래 앱 화면 줄, 바로 다음에 관리자 PC 화면 줄 (둘 다 처음엔 감춘다)', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const li = doc.querySelector('li[data-me-item="counterparties"]');
    expect(li).not.toBeNull();
    expect(li.closest('ul').id).toBe('meSubStock');
    expect(li.hasAttribute('hidden')).toBe(true);
    const a = li.querySelector('a');
    expect(a.getAttribute('href')).toBe('#counterparties');
    expect(a.getAttribute('data-me-go')).toBe('counterparties');
    expect(text(a)).toBe('거래처 · 공급처');
    const pc = li.nextElementSibling;
    expect(pc.getAttribute('data-me-item')).toBe('hq-counterparties');
    expect(pc.hasAttribute('hidden')).toBe(true);
    // 관리자 줄 판정은 me.js rowOn 이 한다 — data-need 로는 앱 화면이 있는지 모른다
    expect(pc.hasAttribute('data-need')).toBe(false);
    expect(pc.querySelector('a').getAttribute('href')).toBe('../admin/counterparties.html');
    expect(pc.querySelector('a').hasAttribute('data-desktop-tab')).toBe(true);
  });

  test('종류 · 갈래 이름과 알림 글은 서버 · PC 화면(admin/counterparties.html)과 같다', () => {
    const C = mod();
    const pc = read('admin/counterparties.html');
    const server = read('workers/workflow-api/src/counterparties.js');
    expect(C.KINDS).toEqual(['partner', 'supplier']);
    expect(C.KIND_NAME).toEqual({ partner: '거래처', supplier: '공급처' });
    expect(C.CATEGORY_NAME).toEqual({
      door: '도어',
      cut_edge: '재단 · 엣지',
      countertop: '상판',
      board: '원판',
      hardware: '철물',
      install: '시공',
      other: '기타',
    });
    for (const [key, name] of Object.entries(C.CATEGORY_NAME)) {
      expect(server).toContain(`${key}: '${name}'`);
      expect(pc).toContain(name);
    }
    for (const key of ['needName', 'added', 'saved', 'shown', 'hid', 'empty', 'stop', 'show']) {
      expect(C.TEXT[key].length).toBeGreaterThan(2);
      expect(pc).toContain(C.TEXT[key]);
    }
    expect(pc).toContain('거래처 (인테리어 업체)');
    expect(pc).toContain('공급처 (사는 곳)');
  });

  test('업체 이름 · 연락처를 기기에 남기지 않는다 — 저장소 · 알림을 쓰지 않고, 확인 창도 띄우지 않는다', () => {
    // 머리말의 설명 글은 빼고 본다 — 코드가 쓰는지만
    const code = read('segan/counterparties.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
    expect(code).not.toMatch(/counterparties\.html['"]/); // PC 화면으로 보내지 않는다
    expect(code).not.toMatch(/<form\b/); // 폼 제출로 화면이 넘어가지 않는다
  });

  test('폰 — 긴 업체 이름은 줄을 바꾼다 · 메모는 한 줄을 다 쓴다 · 그림자 없음', () => {
    const css = read('segan/shell.css');
    const name = /\.cp-row \.me-c-main b,\s*\.cp-row \.me-c-main small\s*\{[^}]*\}/.exec(css);
    expect(name).not.toBeNull();
    expect(name[0]).toMatch(/white-space:\s*normal/);
    expect(name[0]).toMatch(/overflow-wrap:\s*anywhere/);
    const wide = /\.cp-wide\s*\{[^}]*\}/.exec(css);
    expect(wide).not.toBeNull();
    expect(wide[0]).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    // 이 화면 규칙(.cp-*)을 모두 모아 본다 — 못 찾으면 빈 글로 거짓 통과하지 않게 개수부터 센다
    const rules = css.match(/(^|\n)\.cp-[^{]*\{[^}]*\}/g) || [];
    expect(rules.length).toBeGreaterThanOrEqual(10);
    expect(rules.join('\n')).not.toMatch(/box-shadow|border-radius/);
  });
});

describe('순수 함수', () => {
  test('canSee — 다담 공장 구성원 · Expert · Agent 업체의 대표 · 실장만', () => {
    const C = mod();
    expect(C.canSee({ hq_member: true })).toBe(true);
    expect(C.canSee({ company: { plan: 'expert', role: 'owner' } })).toBe(true);
    expect(C.canSee({ company: { plan: 'expert', role: 'manager' } })).toBe(true);
    expect(C.canSee({ company: { plan: 'agent', role: 'owner' } })).toBe(true);
    expect(C.canSee({ company: { plan: 'agent', role: 'manager' } })).toBe(true);
    // 그 밖의 구성원 — 서버가 403 을 준다. 묻지 않는다
    expect(C.canSee({ company: { plan: 'agent', role: 'staff' } })).toBe(false);
    expect(C.canSee({ company: { plan: 'expert', role: 'designer' } })).toBe(false);
    expect(C.canSee({ company: { plan: 'agent' } })).toBe(false);
    expect(C.canSee({ company: { plan: 'manager', role: 'owner' } })).toBe(false);
    expect(C.canSee({ company: { role: 'owner' } })).toBe(false);
    expect(C.canSee({ platform_member: true })).toBe(false);
    expect(C.canSee({ platform_member: true, hq_member: true })).toBe(false);
    expect(C.canSee({ platform_member: true, company: { plan: 'agent', role: 'owner' } })).toBe(
      false
    );
    expect(C.canSee({ company: null })).toBe(false);
    expect(C.canSee({ hq_member: 'true' })).toBe(false);
    for (const v of [null, undefined, '', 0, [], 'x']) expect(C.canSee(v)).toBe(false);
  });

  test('rowOf · listOf — 모르는 종류 · 이름 없는 줄은 버린다. 갈래는 공급처만', () => {
    const C = mod();
    expect(
      C.rowOf(cp('a', 'supplier', ' 예시 가람도어 ', { category: 'door', phone: ' 1 ' }))
    ).toEqual({
      id: 'a',
      kind: 'supplier',
      name: '예시 가람도어',
      category: 'door',
      phone: '1',
      memo: '',
      active: true,
    });
    expect(
      C.rowOf(cp(7, 'partner', '예시 나무디자인', { category: 'door', active: false }))
    ).toEqual({
      id: '7',
      kind: 'partner',
      name: '예시 나무디자인',
      category: '', // 거래처에는 갈래가 없다
      phone: '',
      memo: '',
      active: false,
    });
    expect(C.rowOf(cp('a', 'supplier', '예시', { category: 'zzz' })).category).toBe('');
    expect(C.rowOf(cp('a', 'supplier', '예시', { active: null })).active).toBe(true);
    expect(C.rowOf(cp('', 'partner', '예시'))).toBeNull();
    expect(C.rowOf(cp('a', 'partner', '   '))).toBeNull();
    expect(C.rowOf(cp('a', 'friend', '예시'))).toBeNull();
    for (const v of [null, undefined, 'x', [], 3]) expect(C.rowOf(v)).toBeNull();

    expect(C.listOf({ items: [] })).toEqual([]);
    expect(
      C.listOf({ items: [cp('a', 'partner', '예시'), null, 'x', cp('b', 'x', '예시')] }).map(
        (r) => r.id
      )
    ).toEqual(['a']);
    // 표가 아직 없으면 서버가 items: null 을 준다 — 칸을 감춘다
    for (const v of [{ items: null }, { items: 'x' }, {}, null, undefined, []])
      expect(C.listOf(v)).toBeNull();
  });

  test('subOf — 갈래(공급처) · 연락처 · 숨김', () => {
    const C = mod();
    const r = (patch) => ({ kind: 'supplier', category: '', phone: '', active: true, ...patch });
    expect(C.subOf(r({ category: 'cut_edge', phone: '053-000-0002' }))).toBe(
      '재단 · 엣지 · 053-000-0002'
    );
    expect(C.subOf(r({ category: 'door', active: false }))).toBe('도어 · 숨김');
    expect(C.subOf(r({ kind: 'partner', category: 'door', phone: '010-0000-0001' }))).toBe(
      '010-0000-0001'
    );
    expect(C.subOf(r({}))).toBe('');
  });

  test('bodyOf — 넣을 때만 종류를 보낸다. 갈래는 공급처만 (안 고르면 null)', () => {
    const C = mod();
    expect(
      C.bodyOf({
        id: '',
        kind: 'partner',
        name: ' 예시 ',
        category: 'door',
        phone: ' 1 ',
        memo: '',
      })
    ).toEqual({ kind: 'partner', name: '예시', phone: '1', memo: '' });
    expect(
      C.bodyOf({ id: '', kind: 'supplier', name: '예시', category: 'board', phone: '', memo: 'm' })
    ).toEqual({ kind: 'supplier', name: '예시', category: 'board', phone: '', memo: 'm' });
    expect(C.bodyOf({ id: '', kind: 'supplier', name: '예시', category: '' }).category).toBeNull();
    expect(
      C.bodyOf({ id: '', kind: 'supplier', name: '예시', category: 'zzz' }).category
    ).toBeNull();
    // 고칠 때 — 종류는 서버가 버린다. 보내지 않는다
    expect(
      C.bodyOf({ id: 'a', kind: 'supplier', name: '예시', category: 'door', phone: '', memo: '' })
    ).toEqual({ name: '예시', category: 'door', phone: '', memo: '' });
    expect(C.bodyOf({ id: 'a', kind: 'partner', name: '예시' })).toEqual({
      name: '예시',
      phone: '',
      memo: '',
    });
    expect(C.bodyOf({ kind: 'zzz', name: 3 })).toEqual({
      kind: 'partner',
      name: '',
      phone: '',
      memo: '',
    });
    expect(C.bodyOf(null)).toEqual({ kind: 'partner', name: '', phone: '', memo: '' });
  });
});

describe('화면', () => {
  test('다담 공장 — 한 번 읽어 넣는 칸 · 거래처 줄 · 공급처 줄을 그린다', async () => {
    const calls = await load();
    expect(asked(calls)).toEqual(['GET /counterparties']);
    const get = last(calls, 'GET');
    expect(get.auth).toBe('Bearer tok-1');
    expect(get.cache).toBe('no-store');
    expect(get.type).toBeUndefined();
    expect(seen('counterparties')).toBe(true);
    expect($('partner').hidden).toBe(false);
    expect(text($('counterpartiesTitle'))).toBe('거래처 · 공급처');
    expect(text(box().querySelector('.mk-note'))).toContain('공급처는 우리가 사는 곳입니다');
    expect(formTitle()).toBe('새로 넣기');
    expect(text(act('save'))).toBe('넣기');
    expect(act('stop')).toBeNull();
    expect(err().hidden).toBe(true);
    expect(msg()).toBe('');

    expect(text(sec('partner').querySelector('h4'))).toBe('거래처 2곳');
    expect(text(sec('supplier').querySelector('h4'))).toBe('공급처 2곳');
    expect(names('partner')).toEqual(['예시 가온인테리어', '예시 나무디자인']);
    expect(names('supplier')).toEqual(['예시 가람도어', '예시 다온상판']);
    expect(text(row('cp-1').querySelector('small'))).toBe('010-0000-0001');
    expect(text(row('cp-1').querySelector('.cp-memo'))).toBe('월말에 모아 정산');
    expect(text(row('cp-3').querySelector('small'))).toBe('도어 · 053-000-0002');
    expect(row('cp-3').querySelector('.cp-memo')).toBeNull();
    expect(row('cp-4').querySelector('small')).toBeNull();
    // 숨긴 줄 — 흐리게 남고 글로도 적는다
    expect(row('cp-2').classList.contains('me-cs-item--off')).toBe(true);
    expect(text(row('cp-2').querySelector('small'))).toBe('숨김');
    expect(text(act('toggle', of('cp-2')))).toBe('다시 쓰기');
    expect(row('cp-1').classList.contains('me-cs-item--off')).toBe(false);
    expect(text(act('toggle', of('cp-1')))).toBe('숨기기');
    expect(text(act('edit', of('cp-1')))).toBe('고치기');
    for (const b of box().querySelectorAll('button')) expect(b.getAttribute('type')).toBe('button');
  });

  test('넣는 칸 — 이름표가 붙은 칸 다섯. 갈래는 공급처를 골랐을 때만 보인다', async () => {
    await load();
    for (const [id, label] of [
      ['cpKind', '종류'],
      ['cpName', '이름'],
      ['cpCategory', '갈래 (선택)'],
      ['cpPhone', '연락처 (선택)'],
      ['cpMemo', '메모 (선택)'],
    ]) {
      const wrap = box().querySelector(`label[for="${id}"]`);
      expect(wrap).not.toBeNull();
      expect(text(wrap.querySelector('span'))).toBe(label);
      expect(wrap.contains($(id))).toBe(true);
    }
    expect([...field('kind').options].map((o) => [o.value, o.textContent])).toEqual([
      ['partner', '거래처 (인테리어 업체)'],
      ['supplier', '공급처 (사는 곳)'],
    ]);
    expect([...field('category').options].map((o) => o.textContent)).toEqual([
      '고르지 않음',
      '도어',
      '재단 · 엣지',
      '상판',
      '원판',
      '철물',
      '시공',
      '기타',
    ]);
    expect(field('name').getAttribute('maxlength')).toBe('100');
    expect(field('phone').getAttribute('maxlength')).toBe('40');
    expect(field('phone').getAttribute('inputmode')).toBe('tel');
    expect(field('memo').getAttribute('maxlength')).toBe('1000');
    expect(field('kind').value).toBe('partner');
    expect(catWrap().hidden).toBe(true);
    // 종류를 바꿔도 다시 그리지 않는다 — 적던 글이 남는다
    type('name', '예시 새 업체');
    const nameEl = field('name');
    pick('kind', 'supplier');
    expect(catWrap().hidden).toBe(false);
    expect(field('name')).toBe(nameEl);
    expect(field('name').value).toBe('예시 새 업체');
    pick('kind', 'partner');
    expect(catWrap().hidden).toBe(true);
  });

  test('협력업체 Expert · Agent 의 대표 · 실장 — 화면과 메뉴 줄이 나온다', async () => {
    for (const partner of [
      partnerOf('expert', 'owner'),
      partnerOf('expert', 'manager'),
      partnerOf('agent', 'owner'),
      partnerOf('agent', 'manager'),
    ]) {
      const calls = await load({ partner });
      expect(asked(calls)).toEqual(['GET /counterparties']);
      expect(seen('counterparties')).toBe(true);
      expect(menu('counterparties').hidden).toBe(false);
      expect(menu('hq-counterparties').hidden).toBe(true);
    }
  });

  test('아무것도 없으면 — 종류마다 0곳과 안내 글', async () => {
    await load({ items: [] });
    expect(seen('counterparties')).toBe(true);
    for (const kind of ['partner', 'supplier']) {
      expect(text(sec(kind).querySelector('.cp-count'))).toBe('0곳');
      expect(sec(kind).querySelector('ul')).toBeNull();
      expect(text(sec(kind).querySelector('.me-empty'))).toBe('아직 없습니다. 위에서 넣어 주세요.');
    }
  });

  test('이상한 줄은 버리고, 이름 · 메모는 글자 그대로 그린다', async () => {
    await load({
      items: [
        cp('cp-9', 'partner', '예시 <b>굵게</b> & 업체', { memo: '<img src=x onerror=1>' }),
        cp('cp-8', 'unknown', '예시 모르는 종류'),
        cp('cp-7', 'supplier', ''),
      ],
    });
    expect(names('partner')).toEqual(['예시 <b>굵게</b> & 업체']);
    expect(row('cp-9').querySelector('b b')).toBeNull();
    expect(row('cp-9').querySelector('img')).toBeNull();
    expect(text(row('cp-9').querySelector('.cp-memo'))).toBe('<img src=x onerror=1>');
    expect(rows('supplier').length).toBe(0);
  });

  test('거래처 · 공급처 화면에서만 보인다 — 메뉴 줄을 눌러 들어온다', async () => {
    await load({ hash: '' });
    expect(seen('counterparties')).toBe(false);
    expect(menu('counterparties').hidden).toBe(false);
    await go('#counterparties');
    expect(seen('counterparties')).toBe(true);
    await go('#settings');
    expect(seen('counterparties')).toBe(false);
  });
});

describe('넣기', () => {
  test('거래처 — 종류 · 이름 · 연락처 · 메모를 보내고, 다시 읽어 줄에 넣는다', async () => {
    const calls = await load();
    type('name', '  예시 라온리빙  ');
    type('phone', '010-0000-0009');
    type('memo', '소개로 온 곳');
    await press(act('save'));
    expect(asked(calls)).toEqual([
      'GET /counterparties',
      'POST /counterparties',
      'GET /counterparties',
    ]);
    const post = last(calls, 'POST');
    expect(post.body).toEqual({
      kind: 'partner',
      name: '예시 라온리빙',
      phone: '010-0000-0009',
      memo: '소개로 온 곳',
    });
    expect(post.auth).toBe('Bearer tok-1');
    expect(post.type).toBe('application/json');
    expect(msg()).toBe('넣었습니다.');
    expect(err().hidden).toBe(true);
    expect(names('partner')).toEqual(['예시 가온인테리어', '예시 나무디자인', '예시 라온리빙']);
    expect(text(sec('partner').querySelector('.cp-count'))).toBe('3곳');
    // 넣는 칸은 비운다 — 이어서 넣기
    expect(field('name').value).toBe('');
    expect(field('phone').value).toBe('');
    expect(field('memo').value).toBe('');
    expect(formTitle()).toBe('새로 넣기');
    expect(document.activeElement).toBe(act('save'));
    expect(box().hasAttribute('aria-busy')).toBe(false);
  });

  test('공급처 — 갈래를 함께 보낸다 (안 고르면 null). 넣은 뒤에도 종류는 공급처로 남는다', async () => {
    const calls = await load();
    pick('kind', 'supplier');
    type('name', '예시 마루철물');
    field('category').value = 'hardware';
    await press(act('save'));
    expect(last(calls, 'POST').body).toEqual({
      kind: 'supplier',
      name: '예시 마루철물',
      category: 'hardware',
      phone: '',
      memo: '',
    });
    expect(names('supplier')).toEqual(['예시 가람도어', '예시 다온상판', '예시 마루철물']);
    expect(text(row('cp-new-5').querySelector('small'))).toBe('철물');
    expect(field('kind').value).toBe('supplier');
    expect(catWrap().hidden).toBe(false);
    expect(field('category').value).toBe('');

    type('name', '예시 바다원판');
    await press(act('save'));
    expect(last(calls, 'POST').body).toEqual({
      kind: 'supplier',
      name: '예시 바다원판',
      category: null,
      phone: '',
      memo: '',
    });
  });

  test('이름이 비면 — 보내지 않고 그 자리에 적는다', async () => {
    const calls = await load();
    type('name', '   ');
    type('memo', '적던 메모');
    await press(act('save'));
    expect(asked(calls)).toEqual(['GET /counterparties']);
    expect(err().hidden).toBe(false);
    expect(err().getAttribute('role')).toBe('alert');
    expect(text(err())).toBe('이름을 적어 주세요.');
    expect(field('memo').value).toBe('적던 메모');
    expect(document.activeElement).toBe(field('name'));
  });

  test('글 칸에서 Enter — 넣는다', async () => {
    const calls = await load();
    type('name', '예시 사랑방');
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    field('name').dispatchEvent(e);
    await flush();
    expect(e.defaultPrevented).toBe(true);
    expect(last(calls, 'POST').body.name).toBe('예시 사랑방');
    // 다른 글쇠 · 고르는 칸의 Enter 는 넣지 않는다
    const n = asked(calls).length;
    type('name', '예시 아침');
    field('name').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    field('kind').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(asked(calls).length).toBe(n);
  });

  test('서버가 막으면 — 서버 글을 적고 적던 것은 그대로 둔다', async () => {
    const calls = await load({ post: () => fail(400, 'bad_request', '같은 이름이 이미 있습니다') });
    pick('kind', 'supplier');
    type('name', '예시 가람도어');
    field('category').value = 'door';
    type('phone', '053-000-0002');
    await press(act('save'));
    expect(asked(calls)).toEqual(['GET /counterparties', 'POST /counterparties']);
    expect(err().hidden).toBe(false);
    expect(text(err())).toBe('같은 이름이 이미 있습니다');
    expect(msg()).toBe('');
    expect(field('kind').value).toBe('supplier');
    expect(field('name').value).toBe('예시 가람도어');
    expect(field('category').value).toBe('door');
    expect(field('phone').value).toBe('053-000-0002');
    expect(catWrap().hidden).toBe(false);
    expect(rows('supplier').length).toBe(2);
    expect(act('save').disabled).toBe(false);
    expect(document.activeElement).toBe(field('name'));
  });

  test('끊기거나 글 없는 오류 — 기본 글', async () => {
    for (const post of [() => new Error('끊김'), () => ({ ok: false, status: 500, body: {} })]) {
      await load({ post });
      type('name', '예시 자작나무');
      await press(act('save'));
      expect(text(err())).toBe('처리하지 못했습니다. 잠시 뒤 다시 해 주세요.');
      expect(field('name').value).toBe('예시 자작나무');
    }
  });

  test('넣은 뒤 목록을 못 읽으면 — 서버가 돌려준 줄을 이름 차례로 끼운다', async () => {
    await load({ list: (n) => (n === 1 ? ok({ items: byName(ITEMS()) }) : fail(500, 'x', '')) });
    type('name', '예시 나래홈');
    await press(act('save'));
    expect(seen('counterparties')).toBe(true);
    expect(msg()).toBe('넣었습니다.');
    expect(names('partner')).toEqual(['예시 가온인테리어', '예시 나래홈', '예시 나무디자인']);
  });

  test('바뀌면 수주 상세가 들고 있는 고르는 목록을 비운다 — 다음에 다시 읽는다', async () => {
    await load();
    window.SeganOrders.state.cp = [{ id: 'cp-1', name: '예시 가온인테리어', kind: 'partner' }];
    type('name', '예시 차오름');
    await press(act('save'));
    expect(window.SeganOrders.state.cp).toBeUndefined();
    // 막혔을 때는 건드리지 않는다
    await load({ post: () => fail(400, 'bad_request', '같은 이름이 이미 있습니다') });
    window.SeganOrders.state.cp = [];
    type('name', '예시 차오름');
    await press(act('save'));
    expect(window.SeganOrders.state.cp).toEqual([]);
  });

  test('보내는 동안 — 칸과 단추를 잠그고 다시 눌러도 한 번만 보낸다', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const calls = await load({ gate });
    type('name', '예시 카페인');
    act('save').click();
    await flush();
    expect(box().getAttribute('aria-busy')).toBe('true');
    for (const el of box().querySelectorAll('button, input, select'))
      expect(el.disabled).toBe(true);
    expect(field('name').value).toBe('예시 카페인');
    act('save').click();
    act('toggle', of('cp-1')).click();
    field('name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(asked(calls)).toEqual(['GET /counterparties', 'POST /counterparties']);
    release();
    await flush();
    expect(box().hasAttribute('aria-busy')).toBe(false);
    expect(act('save').disabled).toBe(false);
    expect(msg()).toBe('넣었습니다.');
  });
});

describe('고치기', () => {
  test('「고치기」 — 넣는 칸에 그 줄을 채우고 종류를 잠근다 (서버에 묻지 않는다)', async () => {
    const calls = await load();
    await press(act('edit', of('cp-3')));
    expect(asked(calls)).toEqual(['GET /counterparties']);
    expect(formTitle()).toBe('고치기 — 예시 가람도어');
    expect(field('kind').value).toBe('supplier');
    expect(field('kind').disabled).toBe(true);
    expect(field('kind').getAttribute('aria-describedby')).toBe('cpKindNote');
    expect(text($('cpKindNote'))).toBe('종류는 넣은 뒤에 바꿀 수 없습니다.');
    expect(field('name').value).toBe('예시 가람도어');
    expect(field('category').value).toBe('door');
    expect(catWrap().hidden).toBe(false);
    expect(field('phone').value).toBe('053-000-0002');
    expect(field('memo').value).toBe('');
    expect(text(act('save'))).toBe('저장');
    expect(text(act('stop'))).toBe('그만 고치기');
    expect(row('cp-3').classList.contains('cp-item--on')).toBe(true);
    expect(row('cp-4').classList.contains('cp-item--on')).toBe(false);
    expect(document.activeElement).toBe(field('name'));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  test('「저장」 — 종류 없이 고친 칸을 보내고, 넣는 칸을 처음으로 돌린다', async () => {
    const calls = await load();
    await press(act('edit', of('cp-3')));
    type('name', '예시 가람도어 본점');
    field('category').value = 'cut_edge';
    type('memo', '화요일 배송');
    await press(act('save'));
    expect(asked(calls)).toEqual([
      'GET /counterparties',
      'PATCH /counterparties/cp-3',
      'GET /counterparties',
    ]);
    expect(last(calls, 'PATCH').body).toEqual({
      name: '예시 가람도어 본점',
      category: 'cut_edge',
      phone: '053-000-0002',
      memo: '화요일 배송',
    });
    expect(last(calls, 'PATCH').type).toBe('application/json');
    expect(msg()).toBe('고쳤습니다.');
    expect(formTitle()).toBe('새로 넣기');
    expect(field('kind').disabled).toBe(false);
    expect(field('kind').value).toBe('partner');
    expect(act('stop')).toBeNull();
    expect(names('supplier')).toEqual(['예시 가람도어 본점', '예시 다온상판']);
    expect(text(row('cp-3').querySelector('small'))).toBe('재단 · 엣지 · 053-000-0002');
    expect(text(row('cp-3').querySelector('.cp-memo'))).toBe('화요일 배송');
    expect(row('cp-3').classList.contains('cp-item--on')).toBe(false);
  });

  test('거래처를 고칠 때 — 갈래를 보내지 않는다. 고치는 제목은 처음 이름 그대로', async () => {
    const calls = await load();
    await press(act('edit', of('cp-1')));
    expect(catWrap().hidden).toBe(true);
    type('name', '');
    await press(act('save'));
    // 이름을 지우면 보내지 않는다 — 제목은 고치던 줄의 이름
    expect(asked(calls)).toEqual(['GET /counterparties']);
    expect(text(err())).toBe('이름을 적어 주세요.');
    expect(formTitle()).toBe('고치기 — 예시 가온인테리어');
    type('name', '예시 가온인테리어');
    type('phone', '');
    await press(act('save'));
    expect(last(calls, 'PATCH').body).toEqual({
      name: '예시 가온인테리어',
      phone: '',
      memo: '월말에 모아 정산',
    });
  });

  test('「그만 고치기」 — 보내지 않고 넣는 칸을 비운다', async () => {
    const calls = await load();
    await press(act('edit', of('cp-1')));
    type('name', '예시 바꾸다 만 이름');
    await press(act('stop'));
    expect(asked(calls)).toEqual(['GET /counterparties']);
    expect(formTitle()).toBe('새로 넣기');
    expect(field('name').value).toBe('');
    expect(field('memo').value).toBe('');
    expect(field('kind').disabled).toBe(false);
    expect(row('cp-1').classList.contains('cp-item--on')).toBe(false);
    expect(names('partner')).toEqual(['예시 가온인테리어', '예시 나무디자인']);
  });

  test('서버가 막으면 — 서버 글을 적고 고치던 것은 그대로 둔다', async () => {
    await load({ patch: () => fail(400, 'bad_request', '같은 이름이 이미 있습니다') });
    await press(act('edit', of('cp-4')));
    type('name', '예시 가람도어');
    await press(act('save'));
    expect(text(err())).toBe('같은 이름이 이미 있습니다');
    expect(msg()).toBe('');
    expect(formTitle()).toBe('고치기 — 예시 다온상판');
    expect(field('name').value).toBe('예시 가람도어');
    expect(field('kind').disabled).toBe(true);
    expect(names('supplier')).toEqual(['예시 가람도어', '예시 다온상판']);
  });
});

describe('숨기기 · 다시 쓰기', () => {
  test('「숨기기」 — active: false 만 보낸다. 줄은 흐리게 남는다 (되묻지 않는다)', async () => {
    const calls = await load();
    await press(act('toggle', of('cp-1')));
    expect(asked(calls)).toEqual([
      'GET /counterparties',
      'PATCH /counterparties/cp-1',
      'GET /counterparties',
    ]);
    expect(last(calls, 'PATCH').body).toEqual({ active: false });
    expect(msg()).toBe('숨겼습니다. 이미 붙인 수주 · 원가는 그대로입니다.');
    expect(row('cp-1').classList.contains('me-cs-item--off')).toBe(true);
    expect(text(row('cp-1').querySelector('small'))).toBe('010-0000-0001 · 숨김');
    expect(text(act('toggle', of('cp-1')))).toBe('다시 쓰기');
    expect(text(sec('partner').querySelector('.cp-count'))).toBe('2곳');
    expect(document.activeElement).toBe(act('toggle', of('cp-1')));
  });

  test('「다시 쓰기」 — active: true 를 보낸다', async () => {
    const calls = await load();
    await press(act('toggle', of('cp-2')));
    expect(last(calls, 'PATCH').url).toBe(WORK + '/counterparties/cp-2');
    expect(last(calls, 'PATCH').body).toEqual({ active: true });
    expect(msg()).toBe('다시 씁니다.');
    expect(row('cp-2').classList.contains('me-cs-item--off')).toBe(false);
    expect(row('cp-2').querySelector('small')).toBeNull();
    expect(text(act('toggle', of('cp-2')))).toBe('숨기기');
  });

  test('넣는 칸에 적던 글은 남는다', async () => {
    await load();
    pick('kind', 'supplier');
    type('name', '예시 적던 이름');
    field('category').value = 'board';
    type('memo', '적던 메모');
    await press(act('toggle', of('cp-4')));
    expect(msg()).toBe('숨겼습니다. 이미 붙인 수주 · 원가는 그대로입니다.');
    expect(field('kind').value).toBe('supplier');
    expect(field('name').value).toBe('예시 적던 이름');
    expect(field('category').value).toBe('board');
    expect(field('memo').value).toBe('적던 메모');
    expect(catWrap().hidden).toBe(false);
  });

  test('서버가 막거나 끊기면 — 글을 적고 줄은 그대로', async () => {
    for (const [patch, want] of [
      [() => fail(404, 'not_found', '찾을 수 없습니다'), '찾을 수 없습니다'],
      [() => new Error('끊김'), '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.'],
    ]) {
      const calls = await load({ patch });
      await press(act('toggle', of('cp-1')));
      expect(asked(calls)).toEqual(['GET /counterparties', 'PATCH /counterparties/cp-1']);
      expect(text(err())).toBe(want);
      expect(msg()).toBe('');
      expect(row('cp-1').classList.contains('me-cs-item--off')).toBe(false);
      expect(text(act('toggle', of('cp-1')))).toBe('숨기기');
    }
  });

  test('수주 상세의 고르는 목록도 비운다 — 숨긴 곳은 고르는 칸에서 빠져야 한다', async () => {
    await load();
    window.SeganOrders.state.cp = [{ id: 'cp-1', name: '예시 가온인테리어', kind: 'partner' }];
    await press(act('toggle', of('cp-1')));
    expect(window.SeganOrders.state.cp).toBeUndefined();
  });
});

describe('관리자 PC 화면 줄', () => {
  test('앱 화면을 쓰는 관리자 — 앱 화면 줄만 (PC 줄은 감춘다)', async () => {
    await load({ isAdmin: true });
    expect(seen('counterparties')).toBe(true);
    expect(menu('counterparties').hidden).toBe(false);
    expect(menu('hq-counterparties').hidden).toBe(true);
  });

  test('앱 화면을 못 쓰는 관리자(업체 없음 · 못 읽음) — PC 화면 줄이 남는다', async () => {
    const none = await load({ isAdmin: true, partner: NOBODY });
    expect(asked(none)).toEqual([]);
    expect(menu('counterparties').hidden).toBe(true);
    expect(menu('hq-counterparties').hidden).toBe(false);

    await load({ isAdmin: true, list: () => fail(500, 'x', '') });
    expect(seen('counterparties')).toBe(false);
    expect(menu('counterparties').hidden).toBe(true);
    expect(menu('hq-counterparties').hidden).toBe(false);
  });

  test('관리자가 아니면 — 못 읽을 때 두 줄 다 없다', async () => {
    await load({ list: () => fail(403, 'forbidden', '볼 수 없습니다') });
    expect(menu('counterparties').hidden).toBe(true);
    expect(menu('hq-counterparties').hidden).toBe(true);
  });
});

describe('안 보이는 때', () => {
  test('다담 본사 구성원 · Manager 업체 · 대표 · 실장이 아닌 구성원 — 묻지 않는다', async () => {
    for (const partner of [
      ok({ company: null, application: null, members: [], invites: [], platform_member: true }),
      partnerOf('manager', 'owner'),
      partnerOf('expert', 'staff'),
      partnerOf('agent', 'staff'),
    ]) {
      const calls = await load({ partner });
      expect(asked(calls)).toEqual([]);
      expect(seen('counterparties')).toBe(false);
      expect(menu('counterparties').hidden).toBe(true);
      expect(menu('hq-counterparties').hidden).toBe(true);
    }
  });

  test('업체가 없는 사람 · 로그인하지 않은 사람 — 묻지 않는다', async () => {
    const none = await load({ partner: NOBODY });
    expect(asked(none)).toEqual([]);
    expect(seen('counterparties')).toBe(false);
    const out = await load({ session: null });
    expect(asked(out)).toEqual([]);
    expect(seen('counterparties')).toBe(false);
  });

  test('목록을 못 읽으면(403 · 오류 · 끊김 · 표 없음 · 목록 없는 답) — 칸째 감추고 메뉴 줄도 없다', async () => {
    for (const list of [
      () => fail(403, 'forbidden', '거래처 · 공급처는 팩토리 대표 · 실장 · 관리자만 다룹니다'),
      () => ({ ok: false, status: 500, body: {} }),
      () => new Error('끊김'),
      () => ok({ items: null }),
      () => ok({}),
      () => ok({ items: 'x' }),
      () => ok(null),
    ]) {
      const calls = await load({ list });
      expect(asked(calls)).toEqual(['GET /counterparties']);
      expect(seen('counterparties')).toBe(false);
      expect(box().hidden).toBe(true);
      expect(box().innerHTML).toBe('');
      expect(menu('counterparties').hidden).toBe(true);
    }
  }, 20000); // 여섯 번 화면을 새로 띄운다 — 바쁜 기계에서 기본 5초를 넘긴다

  test('워커 주소가 없으면 묻지 않는다', async () => {
    const C = mod();
    document.body.innerHTML =
      '<section id="partner" hidden><div id="counterparties"></div></section>';
    window.DADAM_CONFIG = {};
    window.fetch = jest.fn();
    await C.load(null, SESSION, { hq_member: true });
    expect(window.fetch).not.toHaveBeenCalled();
    expect($('counterparties').hidden).toBe(true);
    expect($('partner').hidden).toBe(true);
  });
});
