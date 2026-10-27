/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeEach, __dirname, Request, Response, URL, jest */
/**
 * segan/sw.js — 가짜 서비스 워커 전역(self · caches · fetch)에 올려 실제 이벤트로 확인한다.
 *
 *   - 설치: 앱 셸만 미리 담는다 (모두 같은 출처 /segan/ 안, 파일이 저장소에 있다)
 *   - GET 이 아닌 요청 · 다른 출처 · /segan/ 밖 · Authorization 요청은 손대지 않는다
 *   - HTML 은 네트워크 먼저 → 끊기면 담아 둔 페이지 → 없으면 offline.html, 캐시 키에 쿼리 없음
 *   - ?v= 정적 파일은 캐시 먼저
 *   - 켜질 때 이전 segan 캐시만 지운다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'segan/sw.js'), 'utf8');
const { version: VERSION } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts/asset-version.json'), 'utf8')
);
const ORIGIN = 'https://dadamfurniture.com';
const CACHE = `segan-shell-${VERSION}`;

/** Map 기반 CacheStorage — 키는 URL 문자열 (쿼리 포함) */
function fakeCaches(fetchImpl) {
  const stores = new Map();
  const keyOf = (r) => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      match: async (r) => {
        const hit = m.get(keyOf(r));
        return hit ? hit.clone() : undefined;
      },
      put: async (r, res) => {
        m.set(keyOf(r), res);
      },
      addAll: async (reqs) => {
        for (const r of reqs) {
          const res = await fetchImpl(r);
          if (!res.ok) throw new TypeError(`addAll: ${r.url} ${res.status}`);
          m.set(keyOf(r), res);
        }
      },
    };
  };
  return {
    stores,
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
    },
  };
}

function htmlRes(body, init = {}) {
  const res = new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
    ...init,
  });
  Object.defineProperty(res, 'type', { value: init.type || 'basic' });
  return res;
}

/** sw.js 를 새 전역에 올린다 */
function boot({ network } = {}) {
  const listeners = {};
  const net = jest.fn(async (req) => {
    if (network) return network(req);
    return htmlRes(`net:${new URL(req.url).pathname}`);
  });
  const { stores, api } = fakeCaches(net);
  const self = {
    location: new URL(`${ORIGIN}/segan/sw.js`),
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    skipWaiting: jest.fn(async () => {}),
    clients: { claim: jest.fn(async () => {}) },
  };
  new Function('self', 'caches', 'fetch', SW_SRC)(self, api, net); // eslint-disable-line no-new-func

  const lifecycle = async (type) => {
    const waits = [];
    listeners[type]({ waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };
  /** fetch 이벤트를 보낸다 → { handled, response } */
  const dispatch = async (url, init = {}, mode) => {
    const request = new Request(new URL(url, ORIGIN).href, init);
    if (mode) Object.defineProperty(request, 'mode', { value: mode });
    let responded = null;
    const waits = [];
    listeners.fetch({
      request,
      respondWith: (p) => {
        responded = p;
      },
      waitUntil: (p) => waits.push(p),
    });
    const response = responded ? await responded : null;
    await Promise.all(waits);
    return { handled: !!responded, response };
  };
  return { self, net, stores, lifecycle, dispatch };
}

describe('설치 — 앱 셸만 담는다', () => {
  test(`캐시 이름 ${CACHE} · 담는 주소는 모두 같은 출처 /segan/ 안 · 파일이 저장소에 있다`, async () => {
    const sw = boot();
    await sw.lifecycle('install');
    expect(sw.self.skipWaiting).toHaveBeenCalled();
    expect([...sw.stores.keys()]).toEqual([CACHE]);
    const urls = [...sw.stores.get(CACHE).keys()];
    expect(urls.length).toBeGreaterThan(8);
    for (const u of urls) {
      const url = new URL(u);
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname.startsWith('/segan/')).toBe(true);
      const file = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
      expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
      if (url.searchParams.has('v')) expect(url.searchParams.get('v')).toBe(VERSION);
    }
    expect(urls).toEqual(
      expect.arrayContaining([
        `${ORIGIN}/segan/`,
        `${ORIGIN}/segan/offline.html`,
        `${ORIGIN}/segan/manifest.webmanifest`,
      ])
    );
    // 미리 담을 때 HTTP 캐시를 거치지 않는다
    expect(sw.net.mock.calls.every(([r]) => r.cache === 'reload')).toBe(true);
  });

  test('매니페스트 아이콘 · 페이지가 싣는 ?v= 자산이 모두 미리 담긴다', async () => {
    const sw = boot();
    await sw.lifecycle('install');
    const urls = new Set(sw.stores.get(CACHE).keys());
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'segan/manifest.webmanifest'), 'utf8')
    );
    for (const icon of manifest.icons)
      expect(urls).toContain(new URL(icon.src, `${ORIGIN}/segan/`).href);
    const index = fs.readFileSync(path.join(ROOT, 'segan/index.html'), 'utf8');
    for (const m of index.matchAll(/\s(?:src|href)="([^":]+\?v=[^"]+)"/g)) {
      expect(urls).toContain(new URL(m[1], `${ORIGIN}/segan/`).href);
    }
  });
});

describe('손대지 않는 요청 (respondWith 를 부르지 않는다 → 브라우저가 그대로 보낸다)', () => {
  test.each([
    ['POST', `${ORIGIN}/segan/`, { method: 'POST', body: 'x' }],
    ['PUT', `${ORIGIN}/segan/shell.css?v=${VERSION}`, { method: 'PUT', body: 'x' }],
    ['DELETE', `${ORIGIN}/segan/x.js`, { method: 'DELETE' }],
  ])('GET 이 아닌 요청 — %s', async (_m, url, init) => {
    const sw = boot();
    const { handled } = await sw.dispatch(url, init);
    expect(handled).toBe(false);
  });

  test.each([
    'https://abcd.supabase.co/rest/v1/designs?select=*',
    'https://abcd.supabase.co/storage/v1/object/sign/generations/u1/a.png?token=SIGNED',
    'https://generate-api.example.workers.dev/api/generate',
    'https://fonts.googleapis.com/css2?family=Noto+Sans+KR',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  ])('다른 출처 — %s', async (url) => {
    const sw = boot();
    const { handled } = await sw.dispatch(url);
    expect(handled).toBe(false);
    expect(sw.net).not.toHaveBeenCalled();
  });

  test.each([
    `${ORIGIN}/`,
    `${ORIGIN}/ai-design.html`,
    `${ORIGIN}/js/config.js?v=${VERSION}`,
    `${ORIGIN}/api/generate`,
    `${ORIGIN}/segan-other/x.js`,
  ])('같은 출처라도 /segan/ 밖 — %s', async (url) => {
    const sw = boot();
    const { handled } = await sw.dispatch(url);
    expect(handled).toBe(false);
  });

  test('Authorization 헤더가 붙은 요청 · 정적 파일이 아닌 것 · sw.js 자신', async () => {
    const sw = boot();
    expect(
      (
        await sw.dispatch(`${ORIGIN}/segan/shell.js?v=${VERSION}`, {
          headers: { Authorization: 'Bearer t' },
        })
      ).handled
    ).toBe(false);
    expect((await sw.dispatch(`${ORIGIN}/segan/data.json`)).handled).toBe(false);
    expect((await sw.dispatch(`${ORIGIN}/segan/sw.js`)).handled).toBe(false);
  });
});

describe('HTML — 네트워크 먼저, 끊기면 담아 둔 것, 없으면 오프라인 화면', () => {
  test('온라인: 네트워크 응답을 주고, 쿼리를 뺀 주소로 담는다 (로그인 복귀 코드가 키에 남지 않는다)', async () => {
    const sw = boot();
    const { handled, response } = await sw.dispatch(
      `${ORIGIN}/segan/?code=SECRET#x`,
      {},
      'navigate'
    );
    expect(handled).toBe(true);
    expect(await response.text()).toBe('net:/segan/');
    const keys = [...sw.stores.get(CACHE).keys()];
    expect(keys).toEqual([`${ORIGIN}/segan/`]);
    expect(keys.join()).not.toContain('SECRET');
  });

  test('오프라인: 담아 둔 페이지 → 없으면 offline.html', async () => {
    let online = true;
    const sw = boot({
      network: async (req) => {
        if (!online) throw new TypeError('Failed to fetch');
        return htmlRes(`net:${new URL(req.url).pathname}`);
      },
    });
    await sw.lifecycle('install');
    online = false;
    const cached = await sw.dispatch(`${ORIGIN}/segan/?from=home`, {}, 'navigate');
    expect(await cached.response.text()).toBe('net:/segan/');
    const unknown = await sw.dispatch(`${ORIGIN}/segan/somewhere.html`, {}, 'navigate');
    expect(await unknown.response.text()).toBe('net:/segan/offline.html');
  });

  test('담지 않는 응답: 200 이 아님 · 리다이렉트 · no-store · 다른 타입', async () => {
    const make = {
      '/segan/a.html': () => htmlRes('nf', { status: 404 }),
      '/segan/b.html': () => {
        const r = htmlRes('r');
        Object.defineProperty(r, 'redirected', { value: true });
        return r;
      },
      '/segan/c.html': () => htmlRes('ns', { headers: { 'Cache-Control': 'no-store' } }),
      '/segan/d.html': () => htmlRes('op', { type: 'opaque' }),
      '/segan/e.html': () => htmlRes('ok'),
    };
    const sw = boot({ network: async (req) => make[new URL(req.url).pathname]() });
    for (const p of Object.keys(make)) await sw.dispatch(`${ORIGIN}${p}`, {}, 'navigate');
    expect([...sw.stores.get(CACHE).keys()]).toEqual([`${ORIGIN}/segan/e.html`]);
  });
});

describe('정적 파일', () => {
  test('?v= 가 붙은 것은 캐시 먼저 — 담겨 있으면 네트워크에 가지 않는다', async () => {
    const sw = boot();
    await sw.lifecycle('install');
    sw.net.mockClear();
    const { handled, response } = await sw.dispatch(`${ORIGIN}/segan/shell.css?v=${VERSION}`);
    expect(handled).toBe(true);
    expect(await response.text()).toBe('net:/segan/shell.css');
    expect(sw.net).not.toHaveBeenCalled();
  });

  test('?v= 없는 것(매니페스트 아이콘)은 네트워크 먼저, 끊기면 캐시', async () => {
    let online = true;
    const sw = boot({
      network: async (req) => {
        if (!online) throw new TypeError('Failed to fetch');
        return htmlRes(`net:${new URL(req.url).pathname}`);
      },
    });
    await sw.lifecycle('install');
    sw.net.mockClear();
    expect((await sw.dispatch(`${ORIGIN}/segan/icons/icon-192.png`)).handled).toBe(true);
    expect(sw.net).toHaveBeenCalledTimes(1);
    online = false;
    const off = await sw.dispatch(`${ORIGIN}/segan/icons/icon-192.png`);
    expect(await off.response.text()).toBe('net:/segan/icons/icon-192.png');
  });
});

describe('켜질 때 — 이전 버전 segan 캐시만 지운다', () => {
  test('segan-shell-옛버전은 지우고, 지금 캐시 · 다른 이름의 캐시는 남긴다', async () => {
    const sw = boot();
    await sw.lifecycle('install');
    sw.stores.set('segan-shell-2020010101', new Map());
    sw.stores.set('someone-else', new Map());
    await sw.lifecycle('activate');
    expect([...sw.stores.keys()].sort()).toEqual([CACHE, 'someone-else'].sort());
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });
});
