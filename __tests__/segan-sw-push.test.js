/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, URL, jest */
/**
 * segan/sw.js — 업무 알림 (web push). 가짜 서비스 워커 전역에 올려 실제 이벤트로 확인한다.
 *
 *   - push: 서버가 보낸 { title, body, url, tag } 를 그대로 띄운다 (글을 보태지 않는다), 아이콘은 segan/icons
 *   - notificationclick: 같은 출처 /segan/ 안 경로만 연다 (그 밖은 /segan/).
 *     열린 /segan/ 창이 있으면 그 창을 앞으로 · 그 주소로, 없으면 새 창
 *   - 캐시 · fetch 동작은 그대로 (segan-sw.test.js)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'segan/sw.js'), 'utf8');
const ORIGIN = 'https://dadamfurniture.com';

function boot({ windows = [] } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const net = jest.fn(async () => {
    throw new Error('push 는 네트워크를 쓰지 않는다');
  });
  const caches = {
    open: jest.fn(async () => {
      throw new Error('push 는 캐시를 쓰지 않는다');
    }),
    keys: jest.fn(async () => []),
    delete: jest.fn(async () => true),
  };
  const self = {
    location: new URL(`${ORIGIN}/segan/sw.js`),
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    skipWaiting: jest.fn(async () => {}),
    registration: {
      showNotification: jest.fn(async (title, options) => {
        shown.push({ title, options });
      }),
    },
    clients: {
      claim: jest.fn(async () => {}),
      matchAll: jest.fn(async () => windows),
      openWindow: jest.fn(async (url) => {
        opened.push(url);
        return null;
      }),
    },
  };
  new Function('self', 'caches', 'fetch', SW_SRC)(self, caches, net);

  const run = async (type, event) => {
    const waits = [];
    listeners[type]({ ...event, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    return waits.length;
  };
  /** push 이벤트 — data: 객체면 JSON, 문자열이면 그대로, null 이면 본문 없음 */
  const push = (data) =>
    run('push', {
      data:
        data == null
          ? null
          : {
              json: () => (typeof data === 'string' ? JSON.parse(data) : data),
              text: () => (typeof data === 'string' ? data : JSON.stringify(data)),
            },
    });
  const click = (data) => {
    const notification = { data, close: jest.fn() };
    return run('notificationclick', { notification }).then(() => notification);
  };
  return { self, net, caches, shown, opened, push, click, listeners };
}

/** 열린 창 — focus 는 자신을 돌려주고, navigate 는 주소를 바꾼다 (failNavigate 면 던진다) */
function win(url, { failNavigate = false } = {}) {
  const w = {
    url,
    focus: jest.fn(async () => w),
    navigate: jest.fn(async (to) => {
      if (failNavigate) throw new TypeError('not controlled');
      w.url = to;
      return w;
    }),
  };
  return w;
}

describe('push — 받은 글을 그대로 띄운다', () => {
  test('제목 · 본문 · tag · 누르면 열 곳, 아이콘 · 배지는 segan/icons', async () => {
    const sw = boot();
    const waited = await sw.push({
      title: '승인 요청',
      body: '수주 O-2026-0012 완료 되돌리기 승인을 기다립니다.',
      url: '/segan/me.html#partner',
      tag: 'order-event-1',
    });
    expect(waited).toBe(1); // waitUntil 안에서 띄운다
    expect(sw.shown).toEqual([
      {
        title: '승인 요청',
        options: {
          body: '수주 O-2026-0012 완료 되돌리기 승인을 기다립니다.',
          tag: 'order-event-1',
          icon: '/segan/icons/icon-192.png',
          badge: '/segan/icons/icon-192.png',
          data: { url: '/segan/me.html#partner' },
        },
      },
    ]);
    for (const p of [sw.shown[0].options.icon, sw.shown[0].options.badge])
      expect(fs.existsSync(path.join(ROOT, p))).toBe(true);
    // 셸 캐시 · 네트워크를 건드리지 않는다
    expect(sw.net).not.toHaveBeenCalled();
    expect(sw.caches.open).not.toHaveBeenCalled();
  });

  test('글을 보태지 않는다 — 받은 칸 밖의 값(고객 이름 등)은 알림에 들어가지 않는다', async () => {
    const sw = boot();
    await sw.push({
      title: '결제',
      body: '잔금이 들어왔습니다.',
      url: '/segan/',
      customer_name: '홍길동',
      phone: '010-1111-2222',
    });
    const { title, options } = sw.shown[0];
    expect(title).toBe('결제');
    expect(options.body).toBe('잔금이 들어왔습니다.');
    expect(JSON.stringify(sw.shown)).not.toMatch(/홍길동|010-1111-2222/);
  });

  test.each([
    ['본문 없음', null],
    ['JSON 아님', 'not json'],
    ['목록', '[1,2]'],
    ['글자가 아닌 칸', { title: { x: 1 }, body: 3, url: 5, tag: ['t'] }],
  ])('%s — 「SEGAN」 · 빈 본문 · /segan/ 로 띄운다 (push 마다 알림 하나)', async (_n, data) => {
    const sw = boot();
    await sw.push(data);
    expect(sw.shown).toEqual([
      {
        title: 'SEGAN',
        options: {
          body: '',
          icon: '/segan/icons/icon-192.png',
          badge: '/segan/icons/icon-192.png',
          data: { url: '/segan/' },
        },
      },
    ]);
  });

  test.each([
    ['/segan/renders.html?id=1', '/segan/renders.html?id=1'],
    [`${ORIGIN}/segan/me.html#partner`, '/segan/me.html#partner'],
    ['me.html', '/segan/me.html'],
    ['', '/segan/'],
    ['/segan', '/segan/'],
    ['/seganx/a.html', '/segan/'],
    ['/admin/index.html', '/segan/'],
    ['/erp.html', '/segan/'],
    ['/segan/../admin/index.html', '/segan/'],
    ['/segan/%2e%2e/admin/index.html', '/segan/'],
    ['https://evil.example/segan/me.html', '/segan/'],
    ['//evil.example/segan/me.html', '/segan/'],
    ['javascript:alert(1)', '/segan/'],
    ['http://dadamfurniture.com/segan/me.html', '/segan/'],
  ])('열 곳 %j → %s (같은 출처 /segan/ 안만)', async (url, want) => {
    const sw = boot();
    await sw.push({ title: 't', body: 'b', url });
    expect(sw.shown[0].options.data.url).toBe(want);
  });
});

describe('notificationclick — /segan/ 안만 연다', () => {
  test('열린 창이 없으면 새 창 (같은 출처 절대 주소), 알림은 닫는다', async () => {
    const sw = boot();
    const n = await sw.click({ url: '/segan/me.html#partner' });
    expect(n.close).toHaveBeenCalled();
    expect(sw.self.clients.matchAll).toHaveBeenCalledWith({
      type: 'window',
      includeUncontrolled: true,
    });
    expect(sw.opened).toEqual([`${ORIGIN}/segan/me.html#partner`]);
  });

  test('열린 /segan/ 창이 있으면 그 창을 앞으로 · 그 주소로 (새 창 없음)', async () => {
    const app = win(`${ORIGIN}/segan/renders.html`);
    const sw = boot({ windows: [app] });
    await sw.click({ url: '/segan/me.html' });
    expect(app.focus).toHaveBeenCalled();
    expect(app.navigate).toHaveBeenCalledWith(`${ORIGIN}/segan/me.html`);
    expect(sw.opened).toEqual([]);
  });

  test('이미 그 주소인 창이 있으면 그 창만 앞으로 (다시 불러오지 않는다)', async () => {
    const other = win(`${ORIGIN}/segan/`);
    const same = win(`${ORIGIN}/segan/me.html`);
    const sw = boot({ windows: [other, same] });
    await sw.click({ url: '/segan/me.html' });
    expect(same.focus).toHaveBeenCalled();
    expect(same.navigate).not.toHaveBeenCalled();
    expect(other.focus).not.toHaveBeenCalled();
    expect(sw.opened).toEqual([]);
  });

  test('사이트 창(/segan/ 밖) · 다른 출처 창은 쓰지 않는다', async () => {
    const site = win(`${ORIGIN}/erp.html`);
    const foreign = win('https://evil.example/segan/');
    const sw = boot({ windows: [site, foreign] });
    await sw.click({ url: '/segan/me.html' });
    expect(site.focus).not.toHaveBeenCalled();
    expect(foreign.focus).not.toHaveBeenCalled();
    expect(sw.opened).toEqual([`${ORIGIN}/segan/me.html`]);
  });

  test('그 창으로 못 가면(제어하지 않는 창) 새 창', async () => {
    const app = win(`${ORIGIN}/segan/`, { failNavigate: true });
    const sw = boot({ windows: [app] });
    await sw.click({ url: '/segan/me.html' });
    expect(sw.opened).toEqual([`${ORIGIN}/segan/me.html`]);
  });

  test.each([
    ['다른 출처', { url: 'https://evil.example/' }],
    ['사이트 페이지', { url: '/admin/index.html' }],
    ['data 없음', null],
    ['url 이 글자 아님', { url: { href: '/segan/me.html' } }],
  ])('%s — /segan/ 을 연다 (알림에 담긴 값을 다시 본다)', async (_n, data) => {
    const sw = boot();
    await sw.click(data);
    expect(sw.opened).toEqual([`${ORIGIN}/segan/`]);
  });
});
