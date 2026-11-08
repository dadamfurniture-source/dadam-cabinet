/**
 * 공유 열람 페이지 (design-share.html) — 그림 받기.
 *
 * 링크를 받은 사람은 로그인 없이 연다. 토큰은 #t= 로 와서 X-Share-Token 헤더로만 나간다.
 * 그림 주소가 생성 API 의 /api/share/image/<n> 이면 같은 토큰을 헤더로 실어 받아 blob 주소로 그린다
 * (<img src> 는 헤더를 싣지 못한다). 그 밖 주소에는 토큰을 보내지 않고 <img src> 그대로 둔다.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'design-share.html'), 'utf8');
const SCRIPT = HTML.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
const BODY = HTML.slice(
  HTML.indexOf('<body class="v5-page">') + '<body class="v5-page">'.length,
  HTML.indexOf('<script src="js/site-shell.js"')
);
const API = 'https://dadam-generate-api.dadamfurniture.workers.dev';
const settle = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

function boot({ images, hash = '#t=TOKEN123', imageStatus = 200 } = {}) {
  document.body.innerHTML = BODY;
  window.location.hash = hash;
  const calls = [];
  let blobs = 0;
  URL.createObjectURL = jest.fn(() => `blob:shot-${++blobs}`);
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url, headers: init.headers || {} });
    if (url === API + '/api/share') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          generation: {
            category: 'sink',
            title: null,
            images,
            quote: null,
            created_at: '2026-11-01T00:00:00Z',
            expires_at: null,
          },
        }),
      };
    }
    return { ok: imageStatus === 200, status: imageStatus, blob: async () => ({ size: 3 }) };
  });
  (0, eval)(SCRIPT);
  return calls;
}
const imgs = () => [...document.querySelectorAll('#shots img')];

test('API 그림 주소는 토큰을 헤더로 실어 받아 blob 주소로 그린다 — 토큰은 주소에 없다', async () => {
  const calls = boot({
    images: [
      { slot: 'base', label: '기본안', url: API + '/api/share/image/0' },
      { slot: 'v2', label: '추천', url: API + '/api/share/image/1' },
    ],
  });
  await settle();
  expect(calls.map((c) => c.url)).toEqual([
    API + '/api/share',
    API + '/api/share/image/0',
    API + '/api/share/image/1',
  ]);
  for (const c of calls) {
    expect(c.headers['X-Share-Token']).toBe('TOKEN123');
    expect(c.url).not.toMatch(/TOKEN123/);
  }
  expect(imgs().map((i) => i.getAttribute('src'))).toEqual(['blob:shot-1', 'blob:shot-2']);
  expect(imgs().map((i) => i.alt)).toEqual(['기본안', '추천']);
  expect(document.getElementById('doc').hidden).toBe(false);
});

test('그 밖 주소에는 토큰을 보내지 않고 <img src> 그대로', async () => {
  const signed =
    'https://example.supabase.co/storage/v1/object/sign/generations/a/b/base.png?token=x';
  const calls = boot({ images: [{ slot: 'base', label: '기본안', url: signed }] });
  await settle();
  expect(calls.map((c) => c.url)).toEqual([API + '/api/share']);
  expect(imgs().map((i) => i.getAttribute('src'))).toEqual([signed]);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test('주소가 없는 칸은 그리지 않는다 · 그림을 못 받으면 그 칸만 비운다', async () => {
  boot({
    images: [
      { slot: 'base', label: '기본안', url: API + '/api/share/image/0' },
      { slot: 'v3', label: '빈 칸', url: null },
    ],
    imageStatus: 410,
  });
  await settle();
  expect(imgs()).toHaveLength(1);
  expect(imgs()[0].hasAttribute('src')).toBe(false);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(document.getElementById('doc').hidden).toBe(false);
});
