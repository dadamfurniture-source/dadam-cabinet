/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Element, Event, File */
/**
 * SEGAN A/S 접수 (segan/as-requests.js + segan/me.html #meAsSection · #as)
 *
 *   고객    시공 완료 · 수주 id 가 있는 내 프로젝트 줄 아래 「A/S 신청」 → 내용 · 사진(5장)
 *           POST /me/orders/:id/as-requests/photo (사진 본문) → POST /me/orders/:id/as-requests { body, photo_paths }
 *           「A/S 접수」 칸 — GET /me/as-requests, 아직 받지 않은 접수는 「거두기」(한 번 더 묻는다) → POST …/cancel
 *   팩토리  내 정보 › 팩토리 › A/S함 (#as) — GET /company/as-requests, 받기 · 끝은 can_handle 일 때만
 *           다담 공장 · Expert · Agent 구성원, 접수가 없으면 다담 공장 · Agent 만 빈 칸
 *   못 읽으면  403 · 404 · 오류 · ready false → 칸째 감춘다
 * 사람 · 주문은 모두 지어낸 시험 값이다.
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
const fail = (status, code, message) => ({ ok: false, status, body: { success: false, code, message } });
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
const partnerMe = (extra = {}) => ok({ company: company(extra), application: null, members: [], invites: [] });

const project = (extra = {}) => ({
  id: 'p-1',
  title: '싱크대',
  status: 'active',
  company_name: '다담 공장',
  created_at: '2026-10-01T00:00:00Z',
  stage: 'installed',
  order: { id: ORD, order_no: 'SO-20261101-AB12', status: 'completed', contract_amount: 1000000, ordered_at: '2026-10-05T00:00:00Z', completed_at: '2026-10-30T00:00:00Z' },
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
  photo_urls: ['https://example.supabase.co/storage/v1/object/sign/as-request-photos/a.jpg?token=t', 'javascript:alert(1)'],
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
    send: () => ok({ id: A1, state: 'requested', route: 'assignee', created_at: '2026-11-06T01:00:00Z' }, 201),
    cancel: () => ok({ id: A1, state: 'cancelled', cancelled_at: '2026-11-06T02:00:00Z' }),
    act: (url) => ok({ id: A1, state: url.endsWith('/receive') ? 'received' : 'done' }),
    workflowUrl: WORK,
    ...options,
  };
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
    'SeganAs',
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
    calls.fetch.push({ url, method, auth: headers.Authorization, type: headers['Content-Type'], body });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/me/projects') return reply(await opts.projects());
    if (url === WORK + '/me/as-requests') return reply(await opts.mine());
    if (/\/me\/orders\/[^/]+\/as-requests\/photo$/.test(url)) return reply(await opts.upload(body, url));
    if (/\/me\/orders\/[^/]+\/as-requests$/.test(url)) return reply(await opts.send(body, url));
    if (/\/me\/as-requests\/[^/]+\/cancel$/.test(url)) return reply(await opts.cancel(url));
    if (url === WORK + '/company/as-requests') return reply(await opts.box());
    if (/\/company\/as-requests\/[^/]+\/(receive|done)$/.test(url)) return reply(await opts.act(url, body));
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
const slot = () => $('meProjects').querySelector('[data-as-slot]');
const asCalls = (calls) => calls.fetch.filter((f) => f.url.includes('/as-requests'));
const click = async (root, sel) => {
  root.querySelector(sel).dispatchEvent(new Event('click', { bubbles: true }));
  await flush();
};
const submitForm = async () => {
  slot()
    .querySelector('form[data-as-form]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
};
const setFiles = (files) => {
  const input = slot().querySelector('input[name="photos"]');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
};

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 내 A/S 접수는 내 프로젝트 바로 아래, A/S함은 팩토리 칸의 프로젝트 아래 · 회계 위, 처음엔 감춘다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const mineSec = doc.getElementById('meAsSection');
    expect(mineSec.hasAttribute('hidden')).toBe(true);
    expect(mineSec.previousElementSibling.id).toBe('meProjectSection');
    const box = doc.getElementById('as');
    expect(box.hasAttribute('hidden')).toBe(true);
    expect(box.closest('section').id).toBe('partner');
    expect(box.previousElementSibling.id).toBe('partnerProjects');
    expect(box.nextElementSibling.id).toBe('meBooks');
    const srcs = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    const at = (name) => srcs.findIndex((s) => s.startsWith(name + '?v='));
    expect(at('as-requests.js')).toBeGreaterThan(at('partner-projects.js'));
    expect(at('as-requests.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'as-requests.js')");
  });

  test('한도 · 상태 이름 = 워커 as-requests.js, 알림 주소 = 워커 AS_URL, 사진 긴 변은 워커 한도 안', async () => {
    await load();
    const A = window.SeganAs;
    const worker = read('workers/workflow-api/src/as-requests.js');
    expect(worker).toContain(`export const BODY_MAX = ${A.BODY_MAX};`);
    expect(worker).toContain(`export const PHOTOS_MAX = ${A.PHOTOS_MAX};`);
    expect(worker).toContain(
      "AS_STATE_LABEL = Object.freeze({ requested: '접수', received: '받음', done: '끝', cancelled: '거둠' });"
    );
    expect(A.STATE_LABEL).toEqual({ requested: '접수', received: '받음', done: '끝', cancelled: '거둠' });
    expect(read('workers/workflow-api/src/push/messages.js')).toContain(
      "export const AS_URL = '/segan/me.html" + A.HASH + "';"
    );
    const checks = read('workers/workflow-api/src/ledger/checks.js');
    const edge = Number(/PHOTO_MAX_EDGE = (\d+)/.exec(checks)[1]);
    const pixels = Number(/PHOTO_MAX_PIXELS = (\d+)/.exec(checks)[1]);
    expect(A.PHOTO_EDGE).toBeLessThanOrEqual(edge);
    expect(A.PHOTO_EDGE * A.PHOTO_EDGE).toBeLessThanOrEqual(pixels);
  });
});

describe('고객 — A/S 신청', () => {
  test('시공 완료 · 수주 id 가 있는 줄에만 「A/S 신청」', async () => {
    await load({
      projects: () =>
        ok([
          project(),
          project({ id: 'p-2', stage: 'order', order: { ...project().order, id: ORD2 } }),
          project({ id: 'p-3', order: { ...project().order, id: 'not-a-uuid' } }),
          project({ id: 'p-4', order: null, stage: 'installed' }),
        ]),
    });
    const slots = [...$('meProjects').querySelectorAll('[data-as-slot]')];
    expect(slots.map((s) => s.getAttribute('data-as-slot'))).toEqual([ORD]);
    expect(slots[0].textContent).toBe('A/S 신청');
    const A = window.SeganAs;
    expect(A.orderIdOf(project())).toBe(ORD);
    expect(A.orderIdOf({ stage: 'installed', order: {} })).toBe('');
  });

  test('내용 없이 보내면 막고, 적어 보내면 본인 토큰으로 접수 → 안내 · 내 A/S 접수 칸', async () => {
    let after = false;
    const calls = await load({ mine: () => mine(after ? [myItem()] : []) });
    expect($('meAsSection').hidden).toBe(true);
    await click(slot(), '[data-as-act="open"]');
    expect(slot().querySelector('form[data-as-form]')).not.toBeNull();
    await submitForm();
    expect(slot().querySelector('[data-as-err]').textContent).toBe('A/S 내용을 적어 주세요.');
    expect(asCalls(calls).filter((f) => f.method === 'POST')).toEqual([]);
    slot().querySelector('textarea[name="body"]').value = '  문이 안 닫혀요  ';
    after = true;
    await submitForm();
    const sent = calls.fetch.find((f) => f.url === `${WORK}/me/orders/${ORD}/as-requests`);
    expect(sent).toMatchObject({ method: 'POST', auth: 'Bearer tok-1', type: 'application/json' });
    expect(sent.body).toEqual({ body: '문이 안 닫혀요', photo_paths: [] });
    expect(slot().querySelector('form')).toBeNull();
    expect(slot().querySelector('[role="status"]').textContent).toContain('A/S를 접수했습니다');
    expect($('meAsSection').hidden).toBe(false);
    const row = $('meAsList').querySelector('[data-as-id]');
    expect(row.querySelector('b').textContent).toBe('SO-20261101-AB12');
    expect(row.querySelector('small').textContent).toBe('다담 공장 · 2026.11.06 10:00');
    expect(row.querySelector('.me-badge').textContent).toBe('접수');
    expect(row.querySelector('.me-as-body').textContent).toBe('문이 안 닫혀요');
  });

  test('사진 — 한 장씩 사진 본문으로 올리고 받은 경로를 붙인다, JPEG · PNG 아닌 것 · 6장은 막는다', async () => {
    const calls = await load();
    await click(slot(), '[data-as-act="open"]');
    slot().querySelector('textarea[name="body"]').value = '서랍';
    setFiles([new File(['x'], 'a.heic', { type: 'image/heic' })]);
    await submitForm();
    expect(slot().querySelector('[data-as-err]').textContent).toBe('JPEG · PNG 사진만 보낼 수 있습니다.');
    setFiles(Array.from({ length: 6 }, (_, i) => new File(['x'], `p${i}.png`, { type: 'image/png' })));
    await submitForm();
    expect(slot().querySelector('[data-as-err]').textContent).toBe('사진은 5장까지 보낼 수 있습니다.');
    expect(asCalls(calls).filter((f) => f.method === 'POST')).toEqual([]);
    setFiles([new File(['x'], 'p.png', { type: 'image/png' })]);
    await submitForm();
    const up = calls.fetch.find((f) => f.url.endsWith('/as-requests/photo'));
    expect(up).toMatchObject({ url: `${WORK}/me/orders/${ORD}/as-requests/photo`, method: 'POST', auth: 'Bearer tok-1', type: 'image/png' });
    const sent = calls.fetch.find((f) => f.url === `${WORK}/me/orders/${ORD}/as-requests`);
    expect(sent.body).toEqual({ body: '서랍', photo_paths: [PHOTO_PATH] });
  });

  test('서버가 막으면 그 글을 칸 안에 — 적던 내용은 그대로', async () => {
    await load({ send: () => fail(404, 'not_found', '수주를 찾을 수 없습니다') });
    await click(slot(), '[data-as-act="open"]');
    slot().querySelector('textarea[name="body"]').value = '문';
    await submitForm();
    expect(slot().querySelector('[data-as-err]').textContent).toBe('수주를 찾을 수 없습니다');
    expect(slot().querySelector('textarea[name="body"]').value).toBe('문');
    expect(slot().querySelector('button[type="submit"]').disabled).toBe(false);
  });

  test('거두기 — 한 번 더 묻고, 「그대로」면 두고, 「거두기」면 거둔 뒤 다시 읽는다 · 받은 접수는 단추 없음', async () => {
    let gone = false;
    const calls = await load({
      mine: () => mine([myItem({ state: gone ? 'cancelled' : 'requested', label: gone ? '거둠' : '접수', can_cancel: !gone }), myItem({ id: A2, state: 'received', label: '받음', can_cancel: false })]),
    });
    const rows = () => [...$('meAsList').querySelectorAll('[data-as-id]')];
    expect(rows()[1].querySelector('button')).toBeNull();
    await click(rows()[0], '[data-as-act="cancel"]');
    expect(rows()[0].querySelector('.me-as-ask').textContent).toContain('이 접수를 거둘까요?');
    await click(rows()[0], '[data-as-act="cancel-no"]');
    expect(rows()[0].querySelector('.me-as-ask')).toBeNull();
    expect(calls.fetch.filter((f) => f.url.endsWith('/cancel'))).toEqual([]);
    await click(rows()[0], '[data-as-act="cancel"]');
    gone = true;
    await click(rows()[0], '[data-as-act="cancel-yes"]');
    expect(calls.fetch.filter((f) => f.url.endsWith('/cancel'))).toEqual([
      { url: `${WORK}/me/as-requests/${A1}/cancel`, method: 'POST', auth: 'Bearer tok-1', type: undefined, body: undefined },
    ]);
    expect(rows()[0].querySelector('.me-badge').textContent).toBe('거둠');
    expect(rows()[0].querySelector('button')).toBeNull();
  });

  test('못 읽으면 · DB 전(ready false) · 접수 없음 → 내 A/S 접수 칸을 감춘다', async () => {
    for (const r of [fail(500, 'x', 'x'), ok({ ready: false, items: [] }), mine([]), new Error('offline')]) {
      await load({ mine: () => r });
      expect($('meAsSection').hidden).toBe(true);
    }
  });
});

describe('팩토리 — A/S함', () => {
  test('다담 공장 구성원 — 팩토리 칸을 열고, 줄마다 주문번호 · 접수 때 · 내 담당 · 내용 · https 사진만 · 받기', async () => {
    let state = 'requested';
    const calls = await load({
      partner: ok({ hq_member: true, company: null }),
      box: () => ok({ ready: true, items: [boxItem({ state, label: state === 'requested' ? '접수' : '받음' })] }),
    });
    expect($('partner').hidden).toBe(false);
    const box = $('as');
    expect(box.hidden).toBe(false);
    expect(box.querySelector('h3').textContent).toBe('A/S함');
    const row = box.querySelector('[data-as-item]');
    expect(row.querySelector('b').textContent).toBe('SO-20261101-AB12');
    expect(row.querySelector('small').textContent).toBe('접수 2026.11.06 10:00 · 내 담당');
    expect(row.querySelector('.me-as-body').textContent).toBe('서랍이 걸려요\n둘째 칸');
    expect([...row.querySelectorAll('.me-as-photos img')].map((i) => i.getAttribute('src'))).toEqual([
      'https://example.supabase.co/storage/v1/object/sign/as-request-photos/a.jpg?token=t',
    ]);
    state = 'received';
    await click(row, '[data-as-act="receive"]');
    expect(calls.fetch.find((f) => f.url.endsWith('/receive'))).toMatchObject({ url: `${WORK}/company/as-requests/${A1}/receive`, method: 'POST', auth: 'Bearer tok-1' });
    expect(box.querySelector('[role="status"]').textContent).toBe('A/S를 받았습니다.');
    expect(box.querySelector('[data-as-act="done"]').textContent).toBe('A/S 끝');
  });

  test('받을 사람이 아니면(can_handle false) 단추 없음, 서버가 막으면 그 글', async () => {
    await load({
      partner: partnerMe(),
      box: () => ok({ ready: true, items: [boxItem({ mine: false, can_handle: false }), boxItem({ id: A2, state: 'received', label: '받음' })] }),
      act: () => fail(409, 'stale', '그 사이 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요'),
    });
    const rows = [...$('as').querySelectorAll('[data-as-item]')];
    expect(rows[0].querySelector('button')).toBeNull();
    expect(rows[0].querySelector('small').textContent).toBe('접수 2026.11.06 10:00');
    await click(rows[1], '[data-as-act="done"]');
    expect($('as').querySelector('[role="alert"]').textContent).toBe('그 사이 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요');
  });

  test('접수가 없으면 — Agent · 다담 공장은 빈 칸, Expert 는 감춘다', async () => {
    await load({ partner: partnerMe({ plan: 'agent' }) });
    expect($('as').hidden).toBe(false);
    expect($('as').querySelector('.me-empty').textContent).toBe('아직 A/S 접수가 없습니다.');
    await load({ partner: partnerMe({ plan: 'expert' }) });
    expect($('as').hidden).toBe(true);
  });

  test('못 읽으면 · DB 전 · 업체 아님 → 감춘다 (업체가 아니면 묻지도 않는다)', async () => {
    for (const r of [fail(403, 'not_member', 'x'), ok({ ready: false, items: [] }), new Error('offline')]) {
      await load({ partner: partnerMe(), box: () => r });
      expect($('as').hidden).toBe(true);
      expect($('as').textContent).toBe('');
    }
    const calls = await load();
    expect(calls.fetch.filter((f) => f.url === WORK + '/company/as-requests')).toEqual([]);
    expect($('as').hidden).toBe(true);
  });

  test('새 A/S 알림(me.html#as)으로 오면 A/S함으로 내려가고, 로그인 전이면 로그인 뒤 같은 곳으로', async () => {
    await load({ url: '/segan/me.html#as', partner: partnerMe(), box: () => ok({ ready: true, items: [boxItem()] }) });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(Element.prototype.scrollIntoView.mock.contexts || Element.prototype.scrollIntoView.mock.instances).toContain($('as'));
    const calls = await load({ session: null, url: '/segan/me.html#as' });
    expect(calls.fetch).toEqual([]);
    const href = document.querySelector('[data-auth-view="signed-out"] a.sg-btn').getAttribute('href');
    expect(href).toBe('../login.html?redirect=' + encodeURIComponent('segan/me.html#as'));
  });
});
