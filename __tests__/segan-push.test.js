/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, navigator, DOMParser, sessionStorage, jest, setTimeout, Element, Buffer */
/**
 * SEGAN 「내 정보 › 알림」 (segan/push.js + segan/me.html #mePush) — 업무 알림(web push) 구독 · 끄기
 *
 *   누가    GET /partner/me 로 — 협력업체 구성원(역할 무관) · 본사 구성원 · 업체 신청 중(applied · meeting · approved)
 *   서버    workflow-api GET /push/key (로그인 없이) · POST /push/subscriptions · DELETE /push/subscriptions (Bearer)
 *           키를 못 읽으면 칸째 감춘다
 *   화면    아이폰(홈 화면 앱 아님) → 홈 화면에 추가하는 법 / 못 받는 브라우저 / 막힌 권한 / 켜짐(끄기) / 꺼짐(알림 켜기)
 *           권한은 「알림 켜기」를 누를 때만 묻는다
 *   로그아웃 이 기기 구독을 서버에서 지우고 푼 뒤 signOut
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'owner@example.com' } };
const PAY = 'https://pay.example.workers.dev';
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const KEY_RAW = Buffer.from([4, ...Array.from({ length: 64 }, (_, i) => i + 1)]);
const KEY = KEY_RAW.toString('base64url');
const ENDPOINT = 'https://push.example.com/send/abc123';
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const UA_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const company = (extra = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: '다담 협력 주방',
  plan: 'agent',
  next_plan: null,
  status: 'active',
  sido: '대구광역시',
  gugun: '북구',
  role: 'owner',
  ...extra,
});
const partnerMe = (extra = {}) =>
  ok({ company: null, application: null, members: [], invites: [], ...extra });
const application = (status) => ({
  id: '66666666-6666-4666-8666-666666666666',
  kind: 'new',
  status,
  company_name: '새 업체',
  sido: '대구광역시',
  gugun: '북구',
  created_at: '2026-10-20T03:00:00Z',
  used_at: null,
});

const BROWSER_KEYS = ['serviceWorker', 'userAgent', 'platform', 'maxTouchPoints', 'standalone'];

/**
 * me.html 을 올린다.
 *   partner: GET /partner/me 응답 · keyRes: GET /push/key 응답
 *   push: false 면 web push 없는 브라우저 (PushManager · Notification 없음)
 *   permission · grant(requestPermission 답) · subscribed(처음부터 구독 있음) · subscribeError
 *   postRes · deleteRes · unsubscribeError · ua · standalone(navigator.standalone) · displayStandalone(matchMedia)
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: partnerMe({ company: company() }),
    keyRes: ok({ key: KEY }),
    push: true,
    serviceWorker: true,
    permission: 'default',
    grant: 'granted',
    subscribed: false,
    subscribeError: null,
    postRes: { ok: true, status: 201, body: { success: true, data: { id: 'sub-1' } } },
    deleteRes: { ok: true, status: 204, body: null },
    unsubscribeError: null,
    ua: UA_ANDROID,
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    standalone: undefined,
    displayStandalone: false,
    workflowUrl: WORK,
    books: null, // 회계(segan/books.js)도 올릴 때 GET /books/summary 응답
    ...options,
  };
  window.history.replaceState(null, '', '/segan/me.html');
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
    'SeganPush',
    'SeganBooks',
    'SeganRegions',
    'TossPayments',
    'Notification',
    'PushManager',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: opts.workflowUrl },
    paymentsApi: { url: PAY },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [], order: [], subscribe: [], permission: 0, signOut: 0 };

  // ── 브라우저 ──
  let current = null;
  const makeSub = () => {
    const sub = {
      endpoint: ENDPOINT,
      toJSON: () => ({
        endpoint: ENDPOINT,
        expirationTime: null,
        keys: { p256dh: 'P256DH-KEY', auth: 'AUTH-KEY' },
      }),
      unsubscribe: jest.fn(async () => {
        calls.order.push('unsubscribe');
        if (opts.unsubscribeError) throw opts.unsubscribeError;
        current = null;
        return true;
      }),
    };
    return sub;
  };
  if (opts.subscribed) current = makeSub();
  const reg = {
    pushManager: {
      getSubscription: jest.fn(async () => current),
      subscribe: jest.fn(async (o) => {
        calls.subscribe.push(o);
        if (opts.subscribeError) throw opts.subscribeError;
        current = makeSub();
        return current;
      }),
    },
  };
  const define = (k, v) => Object.defineProperty(navigator, k, { configurable: true, value: v });
  if (opts.serviceWorker)
    define('serviceWorker', {
      register: jest.fn(async () => reg),
      getRegistration: jest.fn(async () => reg),
      ready: Promise.resolve(reg),
    });
  define('userAgent', opts.ua);
  define('platform', opts.platform);
  define('maxTouchPoints', opts.maxTouchPoints);
  if (opts.standalone !== undefined) define('standalone', opts.standalone);
  window.matchMedia = jest.fn((q) => ({
    matches: q === '(display-mode: standalone)' && opts.displayStandalone,
  }));
  if (opts.push) {
    window.PushManager = function PushManager() {};
    window.Notification = {
      permission: opts.permission,
      requestPermission: jest.fn(async () => {
        calls.permission++;
        window.Notification.permission = opts.grant;
        return opts.grant;
      }),
    };
  }

  // ── 서버 ──
  window.supabase = {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: opts.session } }),
        signOut: async () => {
          calls.order.push('signOut');
          calls.signOut++;
        },
      },
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
    const f = {
      url,
      method,
      auth: (init.headers || {}).Authorization,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.fetch.push(f);
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return {
        ok: r.ok,
        status: r.status,
        json: async () => {
          if (r.body == null) throw new SyntaxError('Unexpected end of JSON input');
          return r.body;
        },
      };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/push/key') return reply(opts.keyRes);
    if (url.startsWith(WORK + '/books/summary')) return reply(opts.books);
    if (url === WORK + '/push/subscriptions') {
      calls.order.push(method);
      return reply(method === 'POST' ? opts.postRes : opts.deleteRes);
    }
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
    'segan/push.js',
    ...(opts.books ? ['segan/books.js'] : []),
    'segan/regions.js',
    'segan/partner.js',
    'segan/shell.js',
    'segan/make.js',
    'segan/me.js',
  ])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganMe.ready;
  return { calls, reg, sub: () => current };
}

const $ = (id) => document.getElementById(id);
const section = () => $('mePush');
const body = () => $('mePushBody');
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const buttons = () => [...body().querySelectorAll('button')].map((b) => b.textContent);
const press = async (label) => {
  const b = [...body().querySelectorAll('button')].find((x) => x.textContent === label);
  expect([label, !!b]).toEqual([label, true]);
  b.click();
  await flush();
};
const pushCalls = (calls) => calls.fetch.filter((f) => f.url.startsWith(WORK + '/push/'));
const view = () => body().querySelector('[data-view]').getAttribute('data-view');
const LEAD = '업무 알림(승인 요청 · 확인서 결정 · 결제 등)이 이 기기로 옵니다.';

afterEach(() => {
  jest.restoreAllMocks();
  for (const k of BROWSER_KEYS) delete navigator[k];
  delete window.Notification;
  delete window.PushManager;
});

describe('자리', () => {
  test('me.html — #mePush 「알림」 칸, 업무(역할 메뉴) 아래 · 계정 위, 처음엔 감춘다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const sec = doc.getElementById('mePush');
    expect(sec.hasAttribute('hidden')).toBe(true);
    expect(sec.querySelector('h2').textContent).toBe('알림');
    expect(sec.querySelector('#mePushBody')).not.toBeNull();
    expect(sec.previousElementSibling.getAttribute('data-segan-shell')).toBe('roles');
    expect(sec.nextElementSibling.querySelector('h2').textContent).toBe('계정');
    // push.js 를 셸 · me.js 보다 먼저 싣는다 (셸 로그아웃이 SeganPush.forget 을 부른다)
    const srcs = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    const at = (name) => srcs.findIndex((s) => s.startsWith(name + '?v='));
    expect(at('push.js')).toBeGreaterThan(-1);
    expect(at('push.js')).toBeLessThan(at('shell.js'));
    expect(at('push.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'push.js')");
  });
});

describe('누가 보나 — 협력업체 구성원 · 본사 구성원 · 업체 신청 중', () => {
  test.each([
    ['대표', partnerMe({ company: company() })],
    ['실장', partnerMe({ company: company({ role: 'manager' }) })],
    ['직원', partnerMe({ company: company({ role: 'staff' }) })],
    ['본사 구성원 (company 없음)', partnerMe({ hq_member: true })],
    ['신청 접수', partnerMe({ application: application('applied') })],
    ['미팅 예정', partnerMe({ application: application('meeting') })],
    ['승인 (결제 전)', partnerMe({ application: application('approved') })],
  ])('%s — 키를 읽고 칸이 보인다', async (_n, partner) => {
    const { calls } = await load({ partner });
    expect(pushCalls(calls)).toEqual([
      { url: WORK + '/push/key', method: 'GET', auth: undefined, body: undefined },
    ]);
    expect(section().hidden).toBe(false);
    expect(body().querySelector('.mk-note').textContent).toBe(LEAD);
  });

  test.each([
    ['업체 없음 · 신청 없음', partnerMe()],
    ['보류된 신청', partnerMe({ application: application('held') })],
    ['거둔 신청', partnerMe({ application: application('withdrawn') })],
    ['/partner/me 404', fail(404, 'not_found', 'x')],
    ['/partner/me 끊김', new TypeError('Failed to fetch')],
  ])('%s — 묻지도 않고 칸이 없다', async (_n, partner) => {
    const { calls } = await load({ partner });
    expect(pushCalls(calls)).toEqual([]);
    expect(section().hidden).toBe(true);
    expect(body().textContent).toBe('');
  });

  test('workflow-api 주소가 없으면 묻지 않는다', async () => {
    const { calls } = await load({ workflowUrl: '' });
    expect(pushCalls(calls)).toEqual([]);
    expect(section().hidden).toBe(true);
  });

  test('로그인 없으면 아무것도 읽지 않는다', async () => {
    const { calls } = await load({ session: null });
    expect(calls.fetch).toEqual([]);
    expect(section().hidden).toBe(true);
  });

  test.each([
    ['404 (서버 아직 없음)', fail(404, 'not_found', 'x')],
    ['500', fail(500, 'error', 'x')],
    ['끊김', new TypeError('Failed to fetch')],
    ['success 아님', { ok: true, status: 200, body: { success: false, data: { key: KEY } } }],
    ['감싸지 않은 본문', { ok: true, status: 200, body: { key: KEY } }],
    ['키 길이가 틀림', ok({ key: Buffer.from([4, 1, 2]).toString('base64url') })],
    ['키 글자가 틀림', ok({ key: KEY.slice(0, -2) + '!!' })],
  ])('키를 못 읽으면 칸째 감춘다 — %s', async (_n, keyRes) => {
    await load({ keyRes });
    expect(section().hidden).toBe(true);
    expect(body().textContent).toBe('');
    // 다른 칸은 그대로
    expect($('meSub').textContent).toBe('없음');
  });

  test('canUse — 순수 판정', async () => {
    await load();
    const { canUse } = window.SeganPush;
    expect(canUse({ company: { role: 'staff' } })).toBe(true);
    expect(canUse({ hq_member: true, company: null })).toBe(true);
    expect(canUse({ application: { status: 'approved' } })).toBe(true);
    expect(canUse({ application: { status: 'held' } })).toBe(false);
    expect(canUse({ company: null, application: null })).toBe(false);
    expect(canUse(null)).toBe(false);
    expect(canUse([])).toBe(false);
  });
});

describe('꺼짐 → 알림 켜기', () => {
  test('처음엔 「알림 켜기」 — 권한은 묻지 않는다', async () => {
    const { calls } = await load();
    expect(view()).toBe('off');
    expect(buttons()).toEqual(['알림 켜기']);
    expect(calls.permission).toBe(0);
  });

  test('누르면 그때 권한을 묻고 → 구독(VAPID 키) → POST /push/subscriptions (본인 토큰)', async () => {
    const { calls } = await load();
    await press('알림 켜기');
    expect(calls.permission).toBe(1);
    expect(calls.subscribe).toHaveLength(1);
    expect(calls.subscribe[0].userVisibleOnly).toBe(true);
    expect(Buffer.from(calls.subscribe[0].applicationServerKey)).toEqual(KEY_RAW);
    const post = pushCalls(calls).filter((f) => f.method === 'POST');
    expect(post).toEqual([
      {
        url: WORK + '/push/subscriptions',
        method: 'POST',
        auth: 'Bearer tok-1',
        body: {
          endpoint: ENDPOINT,
          keys: { p256dh: 'P256DH-KEY', auth: 'AUTH-KEY' },
          user_agent: UA_ANDROID,
        },
      },
    ]);
    expect(view()).toBe('on');
    expect(body().querySelector('.me-pt-title').textContent).toBe(
      '이 기기에서 알림을 받고 있습니다.'
    );
    expect(body().querySelector('.me-pt-msg').textContent).toBe('알림을 켰습니다.');
    expect(buttons()).toEqual(['끄기']);
  });

  test('권한을 이미 허락했으면 다시 묻는 창 없이 구독한다 (requestPermission 은 granted 로 바로 답한다)', async () => {
    const { calls } = await load({ permission: 'granted' });
    expect(view()).toBe('off');
    await press('알림 켜기');
    expect(view()).toBe('on');
    expect(calls.subscribe).toHaveLength(1);
  });

  test('권한을 막으면 — 설정에서 다시 켜는 법, 구독 · 서버 없음', async () => {
    const { calls } = await load({ grant: 'denied' });
    await press('알림 켜기');
    expect(view()).toBe('denied');
    expect(body().querySelector('.me-pt-warn').textContent).toBe(window.SeganPush.TEXT.denied);
    expect(buttons()).toEqual([]);
    expect(calls.subscribe).toEqual([]);
    expect(pushCalls(calls).filter((f) => f.method !== 'GET')).toEqual([]);
  });

  test('권한 창을 그냥 닫으면 — 한 줄 안내, 단추는 그대로', async () => {
    const { calls } = await load({ grant: 'default' });
    await press('알림 켜기');
    expect(view()).toBe('off');
    expect(body().querySelector('.mk-error').textContent).toBe('알림을 허용해야 켤 수 있습니다.');
    expect(buttons()).toEqual(['알림 켜기']);
    expect(calls.subscribe).toEqual([]);
  });

  test('서버가 403 no_company — 이 기기 구독을 풀고 「업체 구성원만…」', async () => {
    const { calls, sub } = await load({
      postRes: fail(403, 'no_company', '업체 구성원이 아닙니다'),
    });
    await press('알림 켜기');
    expect(calls.order).toEqual(['POST', 'unsubscribe']);
    expect(sub()).toBeNull();
    expect(view()).toBe('off');
    expect(body().querySelector('.mk-error').textContent).toBe(
      '업체 구성원만 알림을 받을 수 있습니다.'
    );
  });

  test.each([
    ['500', fail(500, 'error', 'x')],
    ['끊김', new TypeError('Failed to fetch')],
    ['403 다른 사유', fail(403, 'forbidden', 'x')],
  ])('서버에 적지 못하면(%s) 구독을 풀고 다시 시도 안내', async (_n, postRes) => {
    const { calls, sub } = await load({ postRes });
    await press('알림 켜기');
    expect(calls.order).toEqual(['POST', 'unsubscribe']);
    expect(sub()).toBeNull();
    expect(body().querySelector('.mk-error').textContent).toBe(
      '알림을 켜지 못했습니다. 잠시 후 다시 시도해 주세요.'
    );
    expect(buttons()).toEqual(['알림 켜기']);
  });

  test('구독이 실패하면 서버에 보내지 않는다', async () => {
    const { calls } = await load({ subscribeError: new Error('AbortError') });
    await press('알림 켜기');
    expect(pushCalls(calls).filter((f) => f.method === 'POST')).toEqual([]);
    expect(body().querySelector('.mk-error').textContent).toBe(
      '알림을 켜지 못했습니다. 잠시 후 다시 시도해 주세요.'
    );
  });

  test('누르는 동안 단추를 잠근다 — 두 번 눌러도 한 번만', async () => {
    const { calls } = await load();
    const b = body().querySelector('button');
    b.click();
    b.click();
    expect(body().querySelector('button').disabled).toBe(true);
    await flush();
    expect(calls.permission).toBe(1);
    expect(calls.subscribe).toHaveLength(1);
  });
});

describe('켜짐 → 끄기', () => {
  test('이 기기에 구독이 있으면 「이 기기에서 알림을 받고 있습니다」 + 끄기', async () => {
    const { calls } = await load({ subscribed: true, permission: 'granted' });
    expect(view()).toBe('on');
    expect(body().querySelector('.me-pt-title').textContent).toBe(
      '이 기기에서 알림을 받고 있습니다.'
    );
    expect(buttons()).toEqual(['끄기']);
    expect(calls.permission).toBe(0);
  });

  test('끄기 — 구독을 풀고 DELETE /push/subscriptions { endpoint } (본인 토큰)', async () => {
    const { calls, sub } = await load({ subscribed: true, permission: 'granted' });
    await press('끄기');
    expect(calls.order).toEqual(['POST', 'unsubscribe', 'DELETE']); // POST = 열 때 다시 적기
    expect(pushCalls(calls).filter((f) => f.method === 'DELETE')).toEqual([
      {
        url: WORK + '/push/subscriptions',
        method: 'DELETE',
        auth: 'Bearer tok-1',
        body: { endpoint: ENDPOINT },
      },
    ]);
    expect(sub()).toBeNull();
    expect(view()).toBe('off');
    expect(body().querySelector('.me-pt-msg').textContent).toBe('알림을 껐습니다.');
    expect(buttons()).toEqual(['알림 켜기']);
  });

  test('서버 DELETE 가 실패해도 이 기기는 꺼진다', async () => {
    const { sub } = await load({
      subscribed: true,
      permission: 'granted',
      deleteRes: new TypeError('Failed to fetch'),
    });
    await press('끄기');
    expect(sub()).toBeNull();
    expect(view()).toBe('off');
    expect(body().querySelector('.me-pt-msg').textContent).toBe('알림을 껐습니다.');
  });

  test('구독을 못 풀면 켜진 채로 안내 (서버에도 지우지 않는다)', async () => {
    const { calls } = await load({
      subscribed: true,
      permission: 'granted',
      unsubscribeError: new Error('x'),
    });
    await press('끄기');
    expect(calls.order).toEqual(['POST', 'unsubscribe']); // POST = 열 때 다시 적기
    expect(view()).toBe('on');
    expect(body().querySelector('.mk-error').textContent).toBe(
      '알림을 끄지 못했습니다. 잠시 후 다시 시도해 주세요.'
    );
  });
});

describe('열 때 다시 적기 — 이 기기에 구독이 있으면 POST 한 번 (서버가 endpoint 로 사람 · 업체를 다시 묶는다)', () => {
  const posts = (calls) => pushCalls(calls).filter((f) => f.method === 'POST');

  test('켜져 있으면 권한을 묻지 않고 같은 구독을 본인 토큰으로 한 번 보낸다 — 안내 글은 없다', async () => {
    const { calls, reg } = await load({ subscribed: true, permission: 'granted' });
    expect(posts(calls)).toEqual([
      {
        url: WORK + '/push/subscriptions',
        method: 'POST',
        auth: 'Bearer tok-1',
        body: {
          endpoint: ENDPOINT,
          keys: { p256dh: 'P256DH-KEY', auth: 'AUTH-KEY' },
          user_agent: UA_ANDROID,
        },
      },
    ]);
    expect(calls.permission).toBe(0);
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled();
    expect(view()).toBe('on');
    expect(body().querySelector('.me-pt-msg')).toBeNull();
    expect(body().querySelector('.mk-error')).toBeNull();
  });

  test('업체 신청 중에 켠 사람이 업체 구성원이 된 뒤 — 열면 다시 적힌다', async () => {
    const { calls } = await load({
      subscribed: true,
      permission: 'granted',
      partner: partnerMe({ company: company({ role: 'staff' }) }),
    });
    expect(posts(calls)).toHaveLength(1);
  });

  test.each([
    ['구독 없음', { subscribed: false }],
    ['권한이 막힘', { subscribed: true, permission: 'denied' }],
    ['아이폰 (홈 화면 앱 아님)', { subscribed: true, ua: UA_IPHONE, platform: 'iPhone' }],
    ['못 받는 브라우저', { subscribed: true, push: false }],
    ['칸을 보이지 않는 사람', { subscribed: true, partner: partnerMe() }],
    ['키를 못 읽음', { subscribed: true, keyRes: fail(404, 'not_found', 'x') }],
  ])('%s — 다시 적지 않는다', async (_n, extra) => {
    const { calls } = await load({ permission: 'granted', ...extra });
    expect(posts(calls)).toEqual([]);
  });

  test.each([
    ['500', fail(500, 'error', 'x')],
    ['끊김', new TypeError('Failed to fetch')],
    ['403 다른 사유', fail(403, 'forbidden', 'x')],
  ])('실패(%s)는 그냥 둔다 — 켜진 채, 안내 없음, 구독을 풀지 않는다', async (_n, postRes) => {
    const { calls, sub } = await load({ subscribed: true, permission: 'granted', postRes });
    expect(calls.order).toEqual(['POST']);
    expect(sub()).not.toBeNull();
    expect(view()).toBe('on');
    expect(buttons()).toEqual(['끄기']);
    expect(body().querySelector('.mk-error')).toBeNull();
    expect(section().hidden).toBe(false);
  });

  test('403 no_company — 켜기 때처럼 이 기기 구독을 풀고 「알림 켜기」로', async () => {
    const { calls, sub } = await load({
      subscribed: true,
      permission: 'granted',
      postRes: fail(403, 'no_company', '업체 구성원이 아닙니다'),
    });
    expect(calls.order).toEqual(['POST', 'unsubscribe']);
    expect(sub()).toBeNull();
    expect(view()).toBe('off');
    expect(buttons()).toEqual(['알림 켜기']);
    expect(pushCalls(calls).filter((f) => f.method === 'DELETE')).toEqual([]);
  });

  test('403 no_company 인데 구독을 못 풀면 켜진 채로 둔다', async () => {
    const { calls } = await load({
      subscribed: true,
      permission: 'granted',
      postRes: fail(403, 'no_company', 'x'),
      unsubscribeError: new Error('x'),
    });
    expect(calls.order).toEqual(['POST', 'unsubscribe']);
    expect(view()).toBe('on');
  });
});

describe('브라우저 · 권한', () => {
  test('web push 가 없는 브라우저 — 한 줄, 단추 없음', async () => {
    await load({ push: false });
    expect(view()).toBe('unsupported');
    expect(body().querySelector('.me-pt-warn').textContent).toBe(
      '이 브라우저에서는 알림을 받을 수 없습니다. 크롬 · 삼성 인터넷에서 열거나, 아이폰은 홈 화면에 추가한 SEGAN에서 열어 주세요.'
    );
    expect(buttons()).toEqual([]);
  });

  const UA_KAKAO_ANDROID = UA_ANDROID.replace('Mobile Safari/537.36', 'Mobile Safari/537.36 KAKAOTALK 10.8.0');
  const UA_KAKAO_IPHONE = UA_IPHONE + ' KAKAOTALK 10.8.0';
  const UA_NAVER_ANDROID = UA_ANDROID.replace('Pixel 8)', 'Pixel 8; wv)') + ' NAVER(inapp; search; 2000; 12.1.0)';
  const UA_WEBVIEW = UA_ANDROID.replace('Pixel 8)', 'Pixel 8; wv)');
  const steps = () => [...body().querySelectorAll('.me-push-steps li')].map((li) => li.textContent);

  test.each([
    ['카카오톡 (안드로이드)', UA_KAKAO_ANDROID, '카카오톡'],
    ['네이버 앱 (안드로이드, wv 보다 이름이 먼저)', UA_NAVER_ANDROID, '네이버'],
    ['이름 모르는 앱 안 WebView', UA_WEBVIEW, '앱'],
  ])('앱 안 브라우저 — %s: 다른 브라우저로 여는 법, 단추 없음', async (_n, ua, name) => {
    const { calls } = await load({ ua, platform: 'Linux armv8l', push: false });
    expect(view()).toBe('inapp');
    expect(body().querySelector('.me-pt-warn').textContent).toBe(
      name + ' 안에서 연 화면에서는 알림을 받을 수 없어요'
    );
    expect(steps()).toEqual([
      '오른쪽 위 메뉴(⋮)에서 「다른 브라우저로 열기」를 누릅니다.',
      '크롬(또는 삼성 인터넷)에서 로그인하고 여기서 알림을 켭니다.',
    ]);
    expect(buttons()).toEqual([]);
    expect(calls.permission).toBe(0);
  });

  test('앱 안 브라우저 — 카카오톡 (아이폰): Safari 로 연 뒤 홈 화면에 추가', async () => {
    await load({ ua: UA_KAKAO_IPHONE, platform: 'iPhone', push: false });
    expect(view()).toBe('inapp');
    expect(body().querySelector('.me-pt-warn').textContent).toBe(
      '카카오톡 안에서 연 화면에서는 알림을 받을 수 없어요'
    );
    expect(steps()).toEqual([
      '메뉴에서 「Safari로 열기」를 누릅니다.',
      'Safari 아래쪽 공유 단추를 누릅니다.',
      '「홈 화면에 추가」를 누릅니다.',
      '홈 화면의 SEGAN을 열고 여기서 알림을 켭니다.',
    ]);
    expect(buttons()).toEqual([]);
  });

  test.each([
    ['iOS 16.3 Safari', { standalone: false }],
    ['iOS 16.3 홈 화면 앱', { standalone: true }],
  ])('%s — iOS 16.4 이상이 필요하다고 안내', async (_n, extra) => {
    const ua = UA_IPHONE.replace('OS 18_0', 'OS 16_3');
    await load({ ua, platform: 'iPhone', push: false, ...extra });
    expect(view()).toBe('iosold');
    expect(body().querySelector('.me-pt-warn').textContent).toBe(
      '아이폰 알림은 iOS 16.4 이상에서 받을 수 있어요. 「설정 › 일반 › 소프트웨어 업데이트」에서 올린 뒤 다시 열어 주세요.'
    );
    expect(buttons()).toEqual([]);
  });

  test('iOS 16.4 홈 화면 앱은 켤 수 있다', async () => {
    await load({ ua: UA_IPHONE.replace('OS 18_0', 'OS 16_4'), platform: 'iPhone', standalone: true });
    expect(view()).toBe('off');
    expect(buttons()).toEqual(['알림 켜기']);
  });

  test('서비스 워커가 없는 브라우저도 같다', async () => {
    await load({ serviceWorker: false });
    expect(view()).toBe('unsupported');
  });

  test('권한을 막아 두었으면 — 설정에서 다시 켜는 법 한 줄', async () => {
    await load({ permission: 'denied' });
    expect(view()).toBe('denied');
    const warn = body().querySelectorAll('.me-pt-warn');
    expect(warn).toHaveLength(1);
    expect(warn[0].textContent).toBe(
      '알림이 막혀 있습니다. 브라우저(휴대폰) 설정에서 이 사이트의 알림을 허용해 주세요.'
    );
    expect(buttons()).toEqual([]);
  });

  test.each([
    ['아이폰 Safari', { ua: UA_IPHONE, platform: 'iPhone', push: false }],
    ['아이폰 Safari (push 칸이 보여도)', { ua: UA_IPHONE, platform: 'iPhone' }],
    [
      '아이패드 (데스크톱 모드)',
      { ua: UA_MAC, platform: 'MacIntel', maxTouchPoints: 5, push: false },
    ],
  ])('%s · 홈 화면 앱 아님 — 홈 화면에 추가하는 법', async (_n, extra) => {
    const { calls } = await load(extra);
    expect(view()).toBe('ios');
    expect(body().querySelector('.me-pt-warn').textContent).toBe(
      '아이폰은 홈 화면에 추가한 SEGAN에서만 알림을 받을 수 있어요'
    );
    expect([...body().querySelectorAll('.me-push-steps li')].map((li) => li.textContent)).toEqual([
      'Safari 아래쪽 공유 단추를 누릅니다.',
      '「홈 화면에 추가」를 누릅니다.',
      '홈 화면의 SEGAN을 열고 여기서 알림을 켭니다.',
    ]);
    expect(buttons()).toEqual([]);
    expect(calls.permission).toBe(0);
  });

  test.each([
    ['navigator.standalone', { standalone: true }],
    ['display-mode: standalone', { displayStandalone: true }],
  ])('아이폰 홈 화면 앱(%s) — 알림 켜기', async (_n, extra) => {
    await load({ ua: UA_IPHONE, platform: 'iPhone', ...extra });
    expect(view()).toBe('off');
    expect(buttons()).toEqual(['알림 켜기']);
  });

  test('맥 Safari (터치 없음)는 아이폰 안내가 아니다', async () => {
    await load({ ua: UA_MAC, platform: 'MacIntel', maxTouchPoints: 0 });
    expect(view()).toBe('off');
  });
});

describe('로그아웃 — 이 기기 구독을 지우고 나서 signOut', () => {
  // 뒤이은 location.reload() 는 jsdom 에 없다 (콘솔 오류만 낸다 — segan-shell.test.js 와 같다)
  test('구독이 있으면 DELETE → 구독 풀기 → signOut', async () => {
    const { calls, sub } = await load({ subscribed: true, permission: 'granted' });
    $('sgLogout').click();
    await flush();
    await flush();
    expect(calls.order).toEqual(['POST', 'DELETE', 'unsubscribe', 'signOut']); // POST = 열 때 다시 적기
    const del = pushCalls(calls).filter((f) => f.method === 'DELETE');
    expect(del).toEqual([
      {
        url: WORK + '/push/subscriptions',
        method: 'DELETE',
        auth: 'Bearer tok-1',
        body: { endpoint: ENDPOINT },
      },
    ]);
    expect(sub()).toBeNull();
  });

  test('구독이 없으면 서버에 묻지 않고 signOut', async () => {
    const { calls } = await load();
    $('sgLogout').click();
    await flush();
    await flush();
    expect(calls.order).toEqual(['signOut']);
  });

  test('서버가 끊겨도 로그아웃한다', async () => {
    const { calls } = await load({
      subscribed: true,
      permission: 'granted',
      deleteRes: new TypeError('Failed to fetch'),
    });
    $('sgLogout').click();
    await flush();
    await flush();
    expect(calls.signOut).toBe(1);
  });
});

describe('순수 함수', () => {
  test('keyBytes — base64url 65바이트만', async () => {
    await load();
    const { keyBytes } = window.SeganPush;
    expect(Buffer.from(keyBytes(KEY))).toEqual(KEY_RAW);
    expect(
      Buffer.from(keyBytes(KEY_RAW.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')))
    ).toEqual(KEY_RAW);
    expect(keyBytes('')).toBeNull();
    expect(keyBytes('abc')).toBeNull();
    expect(keyBytes(KEY + '+')).toBeNull();
    expect(keyBytes(null)).toBeNull();
  });

  test('subscriptionBody — endpoint · keys · user_agent 만', async () => {
    await load();
    const { subscriptionBody } = window.SeganPush;
    const sub = {
      toJSON: () => ({
        endpoint: ENDPOINT,
        expirationTime: 123,
        keys: { p256dh: 'p', auth: 'a', extra: 'x' },
      }),
    };
    expect(subscriptionBody(sub, 'UA')).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: 'p', auth: 'a' },
      user_agent: 'UA',
    });
    expect(subscriptionBody({ toJSON: () => ({ endpoint: ENDPOINT }) }, 'UA')).toBeNull();
    expect(subscriptionBody(null, 'UA')).toBeNull();
  });
});

describe('회계와 함께 — me.html 에서 두 칸이 같은 /partner/me 로 함께 돈다', () => {
  const summary = {
    company: { id: '11111111-1111-4111-8111-111111111111', name: '다담 협력 주방' },
    month: '2026-10',
    months: [],
    outstanding: { total: 0, count: 0 },
    status_counts: {},
    upcoming: [],
  };

  test('대표 — 회계 · 알림 둘 다 보이고, /partner/me 는 한 번만 묻는다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-29T03:00:00Z'));
    const { calls } = await load({ books: ok(summary) });
    expect(calls.fetch.filter((f) => f.url === ACC + '/partner/me')).toHaveLength(1);
    expect(calls.fetch.filter((f) => f.url.startsWith(WORK + '/books/summary'))).toHaveLength(1);
    expect(pushCalls(calls).map((f) => f.url)).toEqual([WORK + '/push/key']);
    expect($('meBooks').hidden).toBe(false);
    expect(section().hidden).toBe(false);
    expect(view()).toBe('off');
  });

  test('직원 — 회계는 없고 알림만', async () => {
    const { calls } = await load({
      books: ok(summary),
      partner: partnerMe({ company: company({ role: 'staff' }) }),
    });
    expect(calls.fetch.filter((f) => f.url.startsWith(WORK + '/books/'))).toEqual([]);
    expect($('meBooks').hidden).toBe(true);
    expect(section().hidden).toBe(false);
  });

  test('회계를 못 읽어도 알림은 그대로', async () => {
    await load({ books: fail(403, 'forbidden', 'x') });
    expect($('meBooks').hidden).toBe(true);
    expect(section().hidden).toBe(false);
    expect(buttons()).toEqual(['알림 켜기']);
  });
});
