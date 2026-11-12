/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event, KeyboardEvent */
/**
 * SEGAN 「구매 · 재고 › 자투리 자재」 (segan/stock-offcuts.js + segan/me.html #stockOffcuts)
 *
 *   누가    다담 공장 구성원 · Expert · Agent 협력업체 구성원 (등록 · 바꾸기 모두 누구나). 본사 · Manager · 업체 없는 사람은 묻지도 않는다
 *   데이터  workflow-api GET|POST /stock/offcuts · PATCH /stock/offcuts/:id · GET /stock/offcuts/:id/events · POST /stock/offcuts/labels
 *   화면    탭(남은 것 · 쓸 수 있는 것 · 3달 넘음 · 끝난 것) · 줄 · 그 자리 상세(예약 · 씀 · 버림 · 자리 옮기기 · 라벨 인쇄 · 기록)
 *   라벨    QR 로 들어오면(?cut=번호) 그 조각을 연다. QR 그림은 정해진 꼴만 그린다
 *   조각 정보는 모두 지어낸 것이다
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
const NOW = Date.parse('2026-11-12T03:00:00Z');
const ago = (d) => new Date(NOW - d * 86400000).toISOString();

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

const mod = () => {
  delete window.SeganStockOffcuts;
  (0, eval)(read('segan/stock-offcuts.js'));
  return window.SeganStockOffcuts;
};

const QR =
  '<svg class="so-qr" viewBox="0 0 29 29" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="29" height="29" fill="#fff"/><path d="M4 4h7v1h-7zM4 5h1v1h-1z" fill="#000"/></svg>';
const cut = (seq, patch = {}) => ({
  id: 'c-' + seq,
  code: 'S-' + String(seq).padStart(4, '0'),
  material: 'PB 화이트',
  thickness_mm: 18,
  width_mm: 820,
  height_mm: 460,
  place: 'A-2',
  state: 'left',
  memo: null,
  created_at: ago(10),
  closed_at: null,
  ...patch,
});
const ITEMS = () => [
  cut(581, { memo: 'W-2610-031 재단에서 남음' }),
  cut(579, {
    material: 'PB 그레이',
    width_mm: 1240,
    height_mm: 380,
    place: 'A-3',
    state: 'reserved',
    created_at: ago(19),
  }),
  cut(574, { material: 'MDF', width_mm: 400, height_mm: 700, place: 'B-1', created_at: ago(30) }),
  cut(512, { width_mm: 380, height_mm: 300, place: 'C-4', created_at: ago(106) }),
  cut(498, { material: 'PB 그레이', state: 'used', created_at: ago(120), closed_at: ago(1) }),
];

async function load(options = {}) {
  const store = {
    items: options.items || ITEMS(),
    events: {
      'c-581': [
        { type: 'label', detail: null, by: null, created_at: '2026-11-02T01:41:00Z' },
        { type: 'added', detail: 'A-2', by: '예시 직원', created_at: '2026-11-02T01:40:00Z' },
      ],
    },
  };
  const opts = { session: SESSION, partner: HQ, search: '', gate: null, ...options };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/me.html' + opts.search + '#stock-scrap');
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
    'SeganStock',
    'SeganStockOffcuts',
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
  const calls = { fetch: [], store, printed: 0 };
  window.print = jest.fn(() => {
    calls.printed += 1;
  });
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
    if (url === WORK + '/stock/offcuts') {
      if (method === 'GET')
        return reply(opts.list ? opts.list() : ok({ can_manage: false, items: store.items }));
      if (opts.gate) await opts.gate;
      if (opts.post) return reply(opts.post(body));
      const row = cut(582, { ...body, id: 'c-582', created_at: new Date(NOW).toISOString() });
      store.items.unshift(row);
      return reply(ok(row, 201));
    }
    if (url === WORK + '/stock/offcuts/labels') {
      if (opts.labels) return reply(opts.labels(body));
      return reply(
        ok({ labels: body.ids.map((id) => ({ ...store.items.find((r) => r.id === id), qr: QR })) })
      );
    }
    if (url.startsWith(WORK + '/stock/offcuts/')) {
      const rest = url.slice((WORK + '/stock/offcuts/').length).split('/');
      const id = decodeURIComponent(rest[0]);
      if (rest[1] === 'events')
        return reply(opts.events ? opts.events(id) : ok({ items: store.events[id] || [] }));
      if (opts.gate) await opts.gate;
      if (opts.patch) return reply(opts.patch(id, body));
      const row = store.items.find((r) => r.id === id);
      Object.assign(row, body);
      return reply(ok(row));
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
    'segan/stock-offcuts.js',
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
const box = () => $('stockOffcuts');
const rows = () => [...box().querySelectorAll('li[data-so-row]')];
const codes = () => rows().map((li) => text(li.querySelector('.me-c-main b')));
const row = (id) => box().querySelector(`li[data-so-row="${id}"]`);
const act = (name, extra = '') => box().querySelector(`[data-act="${name}"]${extra}`);
const field = (key) => box().querySelector(`[data-f="${key}"]`);
const err = () => text(box().querySelector('[data-so="err"]:not([hidden])'));
const msg = () =>
  text(box().querySelector('[data-so="msg"]') || box().querySelector('[data-so="topmsg"]'));
const tabs = () => [...box().querySelectorAll('[data-act="tab"]')].map(text);
const menu = (key) => document.querySelector(`#meHub li[data-me-item="${key}"]`);
const press = async (el) => {
  el.click();
  await flush();
};
const openRow = (id) => press(act('open', `[data-id="${id}"]`));
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/stock'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));
const last = (calls, method) =>
  calls.fetch.filter((c) => c.url.startsWith(WORK + '/stock') && c.method === method).pop();

afterEach(() => {
  jest.restoreAllMocks();
  const p = $('stockLabels');
  if (p) p.remove();
  document.body.classList.remove('so-printing');
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸 안, 철물 다음 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('stockOffcuts');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('partner');
    expect(el.previousElementSibling.id).toBe('stockHardware');
    expect(el.nextElementSibling.id).toBe('stockMoves'); // 입출고 · 근무 일정 다음이 수주
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((s) => s === name);
    expect(at('stock-offcuts.js')).toBeGreaterThanOrEqual(0);
    expect(at('stock-offcuts.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'stock-offcuts.js')");
  });

  test('기기에 남기지 않는다 — 저장소 · 알림을 쓰지 않고, 확인 창도 띄우지 않는다 (되묻기는 그 자리에서)', () => {
    const code = read('segan/stock-offcuts.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
    expect(code).not.toMatch(/<form\b/);
    expect(code).not.toMatch(/DELETE/);
    expect(code).not.toMatch(/window\.open/);
  });

  test('인쇄 — 인쇄 칸은 화면에서 감추고, 인쇄할 때는 그것만 보인다', () => {
    const css = read('segan/shell.css');
    expect(css).toMatch(/\.so-print\s*\{\s*display:\s*none;\s*\}/);
    expect(css).toMatch(
      /@media only print\s*\{\s*body\.so-printing > \*:not\(\.so-print\)\s*\{\s*display:\s*none !important;/
    );
  });
});

describe('순수 함수', () => {
  test('rowOf — 번호 · 재질 · 크기가 없거나 모르는 상태면 버린다', () => {
    const S = mod();
    expect(S.rowOf(cut(1))).toEqual({
      id: 'c-1',
      code: 'S-0001',
      material: 'PB 화이트',
      thickness: 18,
      width: 820,
      height: 460,
      place: 'A-2',
      state: 'left',
      memo: '',
      at: ago(10),
    });
    for (const bad of [
      null,
      cut(1, { state: 'lost' }),
      cut(1, { width_mm: 0 }),
      cut(1, { material: ' ' }),
      cut(1, { code: '' }),
      cut(1, { thickness_mm: 'x' }),
    ])
      expect(S.rowOf(bad)).toBeNull();
    expect(S.listOf({ items: 'x' })).toBeNull();
    expect(S.listOf({ items: [cut(1), null] })).toHaveLength(1);
  });

  test('쓸 수 있는 것 — 남음이고 긴 변 600 · 짧은 변 400 이상 (방향은 따지지 않는다)', () => {
    const S = mod();
    const of = (w, h, state = 'left') =>
      S.isUsable(S.rowOf(cut(1, { width_mm: w, height_mm: h, state })));
    expect(of(600, 400)).toBe(true);
    expect(of(400, 600)).toBe(true);
    expect(of(599, 400)).toBe(false);
    expect(of(1240, 380)).toBe(false);
    expect(of(820, 460, 'reserved')).toBe(false);
  });

  test('3달 넘음 — 들어온 지 90일이 넘은 남음 · 예약. 탭 넷', () => {
    const S = mod();
    const old = S.rowOf(cut(1, { created_at: ago(91) }));
    const fresh = S.rowOf(cut(2, { created_at: ago(89) }));
    const used = S.rowOf(cut(3, { created_at: ago(200), state: 'used' }));
    expect([S.isOld(old, NOW), S.isOld(fresh, NOW), S.isOld(used, NOW)]).toEqual([
      true,
      false,
      false,
    ]);
    expect(['open', 'usable', 'old', 'closed'].map((t) => S.inTab(old, t, NOW))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(['open', 'usable', 'old', 'closed'].map((t) => S.inTab(used, t, NOW))).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(S.statusOf(old, NOW)).toEqual([{ text: '남음' }, { text: '3달 넘음', warn: true }]);
    expect(S.statusOf(used, NOW)).toEqual([{ text: '씀' }]);
  });

  test('addBody — 재질 · 두께 · 가로 · 세로. 가로 · 세로는 정수 mm, 한도 안', () => {
    const S = mod();
    expect(
      S.addBody({
        material: ' MDF ',
        thickness: '18',
        width: '600',
        height: '400',
        place: ' B-1 ',
        memo: '',
      })
    ).toEqual({
      body: {
        material: 'MDF',
        thickness_mm: 18,
        width_mm: 600,
        height_mm: 400,
        place: 'B-1',
        memo: null,
      },
    });
    expect(S.addBody({ thickness: '18', width: '600', height: '400' })).toEqual({
      error: S.TEXT.needMaterial,
      focus: 'material',
    });
    expect(S.addBody({ material: 'MDF', thickness: 'x', width: '600', height: '400' }).focus).toBe(
      'thickness'
    );
    expect(
      S.addBody({ material: 'MDF', thickness: '18', width: '600.5', height: '400' }).focus
    ).toBe('width');
    expect(
      S.addBody({ material: 'MDF', thickness: '18', width: '600', height: '3001' }).focus
    ).toBe('height');
  });

  test('cutFromUrl · codeOf — 주소의 번호만 읽는다', () => {
    const S = mod();
    expect(S.cutFromUrl('?cut=581')).toBe(581);
    expect(S.cutFromUrl('?role=x&cut=12&y=1')).toBe(12);
    for (const bad of ['', '?cut=', '?cut=abc', '?cut=1234567', '?cut=5x', '?shortcut=5'])
      expect(S.cutFromUrl(bad)).toBe(0);
    expect(S.codeOf(581)).toBe('S-0581');
    expect(S.codeOf(12345)).toBe('S-12345');
  });

  test('safeQr — 서버가 주는 꼴(사각형 + 경로 하나)만 받는다', () => {
    const S = mod();
    expect(S.safeQr(QR)).toBe(QR);
    for (const bad of [
      '',
      null,
      '<svg onload="x()"></svg>',
      QR.replace('<path', '<script>x</script><path'),
      QR.replace('fill="#000"/>', 'fill="#000" onclick="x"/>'),
      QR + '<img src=x>',
      QR.replace('M4 4', 'javascript:'),
      QR.replace('class="so-qr"', 'class="so-qr" style="x"'),
    ])
      expect(S.safeQr(bad)).toBe('');
  });
});

describe('화면', () => {
  test('한 번 읽어 그린다 — 탭에 수, 줄에 번호 · 재질 · 두께 · 자리 · 들어온 날 · 크기 · 상태', async () => {
    const calls = await load();
    expect(asked(calls)).toEqual(['GET /stock/offcuts']);
    expect(seen('stockOffcuts')).toBe(true);
    expect($('meTitle').textContent).toBe('자투리 자재');
    expect($('partner').getAttribute('aria-labelledby')).toBe('stockOffcutsTitle');
    expect(tabs()).toEqual(['남은 것 4', '쓸 수 있는 것 2', '3달 넘음 1', '끝난 것 1']);
    expect(codes()).toEqual(['S-0581', 'S-0579', 'S-0574', 'S-0512']);
    expect(text(row('c-581').querySelector('.ad-pick'))).toBe(
      'S-0581PB 화이트 · 18T · A-2 · 11.02820 × 460mm남음'
    );
    expect(text(row('c-512').querySelector('.st-status'))).toBe('남음3달 넘음');
    expect(menu('stock-scrap').querySelector('a').classList.contains('me-row-soon')).toBe(false);
    expect($('mePaneNote').hidden).toBe(true);
  });

  test('탭 · 재질 · 자리로 거른다. 끝난 조각에는 고르는 칸이 없다', async () => {
    await load();
    await press(act('tab', '[data-tab="usable"]'));
    expect(codes()).toEqual(['S-0581', 'S-0574']);
    await press(act('tab', '[data-tab="old"]'));
    expect(codes()).toEqual(['S-0512']);
    await press(act('tab', '[data-tab="closed"]'));
    expect(codes()).toEqual(['S-0498']);
    expect(row('c-498').querySelector('input[data-so="pick"]')).toBeNull();
    await press(act('tab', '[data-tab="open"]'));
    const by = box().querySelector('[data-so="filter"][data-key="material"]');
    expect([...by.options].map((o) => o.textContent)).toEqual([
      '모두',
      'MDF',
      'PB 그레이',
      'PB 화이트',
    ]);
    by.value = 'PB 화이트';
    by.dispatchEvent(new Event('change', { bubbles: true }));
    expect(codes()).toEqual(['S-0581', 'S-0512']);
  });

  test('줄을 누르면 — 그 자리에 상세 · 단추 · 기록', async () => {
    const calls = await load();
    await openRow('c-581');
    expect(asked(calls).pop()).toBe('GET /stock/offcuts/c-581/events');
    expect(text(row('c-581').querySelector('.me-facts'))).toBe(
      '재질PB 화이트 · 18T크기820 × 460 mm자리A-2메모W-2610-031 재단에서 남음'
    );
    expect([...row('c-581').querySelectorAll('.so-acts button')].map(text)).toEqual([
      '예약',
      '씀',
      '버림',
      '자리 옮기기',
      '라벨 인쇄',
    ]);
    expect([...row('c-581').querySelectorAll('.st-history li')].map(text)).toEqual([
      '11.02 10:41라벨 인쇄',
      '11.02 10:40등록 — A-2예시 직원',
    ]);
    await openRow('c-579');
    expect(text(row('c-579').querySelector('.so-acts button'))).toBe('예약 풀기');
  });

  test('글자 그대로 그린다', async () => {
    await load({
      items: [cut(1, { material: '<img src=x onerror=1>', memo: '<b>굵게</b>', place: '"A"' })],
    });
    expect(box().querySelector('img')).toBeNull();
    await openRow('c-1');
    expect(row('c-1').querySelector('.me-facts b')).toBeNull();
  });
});

describe('바꾸기', () => {
  test('예약 · 예약 풀기 — 바로 보낸다', async () => {
    const calls = await load();
    await openRow('c-581');
    await press(act('state'));
    expect(last(calls, 'PATCH')).toMatchObject({
      url: WORK + '/stock/offcuts/c-581',
      body: { state: 'reserved' },
      auth: 'Bearer tok-1',
    });
    expect(text(row('c-581').querySelector('.st-status'))).toBe('예약');
    expect(msg()).toBe('예약했습니다.');
    await press(act('state'));
    expect(last(calls, 'PATCH').body).toEqual({ state: 'left' });
  });

  test('씀 · 버림 — 그 자리에서 한 번 되묻고, 「그만두기」면 보내지 않는다', async () => {
    const calls = await load();
    await openRow('c-581');
    await press(act('ask', '[data-to="used"]'));
    expect(text(box().querySelector('.so-ask'))).toBe(
      '이 조각을 「씀」으로 닫습니다. 되돌릴 수 없습니다.'
    );
    expect(last(calls, 'PATCH')).toBeUndefined();
    await press(act('stop'));
    expect(box().querySelector('.so-ask')).toBeNull();
    await press(act('ask', '[data-to="discarded"]'));
    expect(text(act('confirm'))).toBe('버림으로 닫기');
    await press(act('confirm'));
    expect(last(calls, 'PATCH').body).toEqual({ state: 'discarded' });
    expect(codes()).not.toContain('S-0581');
    expect(msg()).toBe('「버림」으로 닫았습니다.');
    expect(tabs()).toContain('끝난 것 2');
  });

  test('자리 옮기기 — 자리만 보낸다 (Enter 로도)', async () => {
    const calls = await load();
    await openRow('c-581');
    await press(act('move'));
    expect(field('place').value).toBe('A-2');
    field('place').value = ' B-2 ';
    field('place').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(last(calls, 'PATCH').body).toEqual({ place: 'B-2' });
    expect(msg()).toBe('자리를 옮겼습니다.');
  });

  test('서버가 막으면 서버 글을 적는다 · 끊기면 기본 글 · 보내는 동안 잠근다', async () => {
    await load({ patch: () => fail(409, 'closed', '이미 쓰거나 버린 조각은 되돌릴 수 없습니다') });
    await openRow('c-581');
    await press(act('state'));
    expect(err()).toBe('이미 쓰거나 버린 조각은 되돌릴 수 없습니다');
    await load({ patch: () => new Error('offline') });
    await openRow('c-581');
    await press(act('state'));
    expect(err()).toBe('처리하지 못했습니다. 잠시 뒤 다시 해 주세요.');

    let open;
    const gate = new Promise((r) => (open = r));
    const calls = await load({ gate });
    await openRow('c-581');
    act('state').click();
    await flush();
    expect(box().getAttribute('aria-busy')).toBe('true');
    expect(act('state').disabled).toBe(true);
    act('state').click();
    open();
    await flush();
    expect(calls.fetch.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });
});

describe('등록 · 라벨', () => {
  test('등록 — 재질 · 두께 · 가로 · 세로 · 자리 · 메모를 보내고, 바로 라벨을 인쇄한다 (기본 켬)', async () => {
    const calls = await load();
    await press(act('add'));
    expect(box().querySelector('[data-so="printAfter"]').checked).toBe(true);
    await press(act('save-add'));
    expect(err()).toBe('재질을 적어 주세요.');
    field('material').value = 'PB 화이트';
    field('thickness').value = '18';
    field('width').value = '900';
    field('height').value = '410';
    field('place').value = 'A-1';
    await press(act('save-add'));
    expect(
      calls.fetch.find((c) => c.method === 'POST' && c.url === WORK + '/stock/offcuts').body
    ).toEqual({
      material: 'PB 화이트',
      thickness_mm: 18,
      width_mm: 900,
      height_mm: 410,
      place: 'A-1',
      memo: null,
    });
    expect(last(calls, 'POST')).toMatchObject({
      url: WORK + '/stock/offcuts/labels',
      body: { ids: ['c-582'] },
    });
    expect(calls.printed).toBe(1);
    expect(codes()[0]).toBe('S-0582');
    // 같은 재질 · 두께 · 자리를 이어서 넣기 쉽게 남긴다
    expect([
      field('material').value,
      field('thickness').value,
      field('place').value,
      field('width').value,
    ]).toEqual(['PB 화이트', '18', 'A-1', '']);
  });

  test('「등록한 뒤 라벨 인쇄」를 끄면 인쇄하지 않는다', async () => {
    const calls = await load();
    await press(act('add'));
    box().querySelector('[data-so="printAfter"]').checked = false;
    field('material').value = 'MDF';
    field('thickness').value = '18';
    field('width').value = '600';
    field('height').value = '400';
    await press(act('save-add'));
    expect(calls.printed).toBe(0);
    expect(asked(calls)).not.toContain('POST /stock/offcuts/labels');
    expect(msg()).toBe('등록했습니다. S-0582');
  });

  test('고른 조각 라벨 — 인쇄 칸에 QR · 번호 · 재질 · 크기 · 자리를 그리고 인쇄 창을 연다', async () => {
    const calls = await load();
    expect(act('labels')).toBeNull();
    for (const id of ['c-581', 'c-579']) {
      const cb = box().querySelector(`[data-so="pick"][data-id="${id}"]`);
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
    expect(text(act('labels'))).toBe('고른 조각 라벨 인쇄 (2)');
    await press(act('labels'));
    expect(last(calls, 'POST').body).toEqual({ ids: ['c-581', 'c-579'] });
    expect(calls.printed).toBe(1);
    const area = $('stockLabels');
    expect(area.parentNode).toBe(document.body);
    expect(area.classList.contains('so-print')).toBe(true);
    expect(
      [...area.querySelectorAll('.so-label')].map((l) => text(l.querySelector('.so-label-text')))
    ).toEqual(['S-0581PB 화이트 · 18T820 × 460 mmA-2', 'S-0579PB 그레이 · 18T1,240 × 380 mmA-3']);
    expect(area.querySelectorAll('svg.so-qr')).toHaveLength(2);
    expect(document.body.classList.contains('so-printing')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('so-printing')).toBe(false);
    expect(msg()).toBe('라벨을 인쇄 창으로 보냈습니다.');
    expect(act('labels')).toBeNull();
  });

  test('이상한 QR 그림은 그리지 않는다 — 인쇄하지 않고 그 자리에 적는다', async () => {
    const calls = await load({
      labels: (b) =>
        ok({
          labels: b.ids.map((id) => ({
            id,
            code: 'S-0581',
            material: 'x',
            qr: '<svg onload="x()"></svg>',
          })),
        }),
    });
    await openRow('c-581');
    await press(act('label'));
    expect(calls.printed).toBe(0);
    expect($('stockLabels')).toBeNull();
    expect(err()).toBe('라벨을 만들지 못했습니다.');
  });
});

describe('QR 로 들어왔을 때 (?cut=번호)', () => {
  test('그 조각을 연 채로 그린다 — 끝난 조각이면 끝난 것 탭으로', async () => {
    const calls = await load({ search: '?cut=579' });
    expect(act('open', '[data-id="c-579"]').getAttribute('aria-expanded')).toBe('true');
    expect(asked(calls)).toEqual(['GET /stock/offcuts', 'GET /stock/offcuts/c-579/events']);
    await load({ search: '?cut=498' });
    expect(act('tab', '[data-tab="closed"]').getAttribute('aria-pressed')).toBe('true');
    expect(act('open', '[data-id="c-498"]').getAttribute('aria-expanded')).toBe('true');
    expect(row('c-498').querySelector('.so-acts')).toBeNull();
  });

  test('없는 번호(남의 팩토리 라벨)면 그 말을 적는다', async () => {
    await load({ search: '?cut=9999' });
    expect(err()).toBe(
      'S-9999 조각을 찾을 수 없습니다. 다른 팩토리의 라벨이거나 번호가 잘못됐습니다.'
    );
    expect(box().querySelector('[aria-expanded="true"]')).toBeNull();
  });
});

describe('안 보이는 때 — 메뉴는 「준비 중」으로 남는다', () => {
  test('다담 본사 구성원 · Manager 업체 · 업체 없는 사람 — 묻지 않는다', async () => {
    for (const partner of [PLATFORM, partnerOf('manager', 'owner'), NOBODY]) {
      const calls = await load({ partner });
      expect(asked(calls)).toEqual([]);
      expect(seen('stockOffcuts')).toBe(false);
    }
  });

  test('협력업체 Expert 직원도 본다 · DB 적용 전 · 오류 · 끊김이면 칸을 감추고 「준비 중」', async () => {
    await load({ partner: partnerOf('expert', 'staff') });
    expect(seen('stockOffcuts')).toBe(true);
    for (const list of [
      () => fail(409, 'db_pending', 'x'),
      () => fail(500, 'x', 'x'),
      () => new Error('offline'),
      () => ok({ items: null }),
    ]) {
      await load({ partner: partnerOf('expert', 'staff'), list });
      expect(seen('stockOffcuts')).toBe(false);
      expect(box().innerHTML).toBe('');
      expect($('mePaneNote').textContent).toContain('재고 관리는 준비 중입니다.');
      expect(menu('stock-scrap').querySelector('a').classList.contains('me-row-soon')).toBe(true);
    }
  });
});
