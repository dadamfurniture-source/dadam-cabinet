/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeEach, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest */
/**
 * SEGAN 만들기 — ③ 결과 (segan/make.js 생성 부분) · ④ 상담 신청 자리표시 (segan/consult.js).
 *
 * 생성 백엔드는 ai-design.html 이 쓰는 그대로다:
 *   POST {generateApi.url} → 202 { id }, 3초마다 GET {base}/api/generate/:id, 서명 URL 이미지, 견적은 잡 결과
 * 가짜 fetch 로 요청 모양 · 진행 · 결과 · 오류를 확인한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const AI = read('ai-design.html');
const MAKE = read('segan/make.js');
const KEY = 'segan.make.draft.v1';
const API = 'https://gen.example.workers.dev/api/generate';
const ID = '11111111-2222-4333-8444-555555555555';
const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'customer@example.com' } };
const PHOTO = {
  base64: 'QUJD',
  mime: 'image/jpeg',
  name: 'kitchen.jpg',
  width: 1200,
  height: 900,
  focal35: 26,
};
const QUOTE = {
  items: [
    { name: '하부장 캐비닛', quantity: '4개', unit_price: 320000, total: 1280000 },
    { name: '시공비', quantity: '1식', unit_price: 300000, total: 300000 },
  ],
  subtotal: 1580000,
  vat: 158000,
  total: 1738000,
};
const img = (i, sig = 'a') => ({
  url: `https://example.supabase.co/storage/v1/object/sign/generations/user-1/${ID}/v${i}.png?token=${sig}${i}`,
  path: `user-1/${ID}/v${i}.png`,
  label: i === 0 ? '싱크대 · 기본안' : `싱크대 · 추천 ${i}`,
});
const RUNNING = {
  id: ID,
  status: 'running',
  progress: 45,
  step_label: '가구 배치 중',
  images: [img(0)],
  quote: null,
};
const DONE = {
  id: ID,
  status: 'done',
  progress: 100,
  step_label: '완료',
  images: [0, 1, 2, 3].map((i) => img(i)),
  quote: QUOTE,
};

function res(status, body) {
  return { ok: status < 400, status, json: async () => body };
}

function fakeClient(opts) {
  const tables = {
    credit_costs: { data: { credits: 20 }, error: null },
    user_credits: { data: { balance: 1000 }, error: null },
    appliance_models: { data: [], error: null },
  };
  return {
    auth: { getSession: async () => ({ data: { session: opts.session } }) },
    from: (table) => {
      const result = tables[table] || { data: null, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => Promise.resolve(result),
        maybeSingle: async () => result,
      };
      return chain;
    },
  };
}

/**
 * opts.post: POST 응답 (기본 202), opts.gets: GET 응답을 차례로 (마지막 것을 되풀이)
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    draft: { v: 1, step: 'kind', photo: PHOTO, choices: {} },
    url: '/segan/',
    post: res(202, { success: true, id: ID, credit: { balance: 980 } }),
    gets: [RUNNING, DONE],
    ...options,
  };
  const doc = new DOMParser().parseFromString(read('segan/index.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  window.history.replaceState(null, '', opts.url);
  sessionStorage.clear();
  if (opts.draft) sessionStorage.setItem(KEY, JSON.stringify(opts.draft));
  delete window.SeganMake;
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    generateApi: { url: API },
  };
  window.supabase = { createClient: () => fakeClient(opts) };
  const calls = [];
  let g = 0;
  window.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    if (url === API && init.method === 'POST') return opts.post;
    if (url === `https://gen.example.workers.dev/api/generate/${ID}/share`) {
      return res(200, {
        success: true,
        share_url: 'https://dadamfurniture.com/design-share.html#t=abc',
      });
    }
    if (url === `https://gen.example.workers.dev/api/generate/${ID}`) {
      const body = opts.gets[Math.min(g++, opts.gets.length - 1)];
      return body && body.status >= 400 ? body : res(200, { success: true, generation: body });
    }
    throw new Error('예상하지 못한 요청: ' + url);
  });
  (0, eval)(MAKE);
  const M = window.SeganMake;
  M.go = jest.fn();
  await M.ready;
  return { M, calls };
}

const $ = (id) => document.getElementById(id);
const visible = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) if (n.hidden) return false;
  return true;
};
const tick = (ms = 0) => jest.advanceTimersByTimeAsync(ms);
const posts = (calls) => calls.filter((c) => c.method === 'POST' && c.url === API);
const gets = (calls) => calls.filter((c) => c.method === 'GET');

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('생성 요청 — ai-design.html 과 같은 모양', () => {
  test('싱크대: 본문 칸 · 값, 로그인 토큰, 참고 이미지 · 상세 요청은 보내지 않는다', async () => {
    const { calls } = await load({
      draft: {
        v: 1,
        step: 'kind',
        photo: PHOTO,
        choices: {
          kind: 'sink',
          style: 'classic',
          door: 'oak woodgrain',
          wallW: '3200',
          water: '800',
        },
      },
    });
    $('mkRun').click();
    await tick();
    const p = posts(calls);
    expect(p).toHaveLength(1);
    expect(p[0].headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok-1',
    });
    expect(JSON.parse(p[0].body)).toEqual({
      room_image: 'QUJD',
      image_type: 'image/jpeg',
      category: 'sink',
      design_style: 'classic',
      door_color: 'oak woodgrain',
      wall_width_override: '3200',
      room_focal35: 26,
      water_from_left_override: '800',
    });
  });

  test('냉장고장: fridge_options(브랜드 · 위치 · 고른 모델), 급수 · 배기는 보내지 않는다', async () => {
    const { calls } = await load({
      draft: {
        v: 1,
        step: 'kind',
        photo: PHOTO,
        choices: { kind: 'fridge', fBrand: 'lg', fPos: 'right', fModel: 'M874GBB', water: '800' },
      },
    });
    $('mkRun').click();
    await tick();
    const body = JSON.parse(posts(calls)[0].body);
    expect(body.category).toBe('fridge');
    expect(body.fridge_options).toEqual({ brand: 'lg', position: 'right', models: ['M874GBB'] });
    expect(body).not.toHaveProperty('water_from_left_override');
  });

  test('보내는 칸은 모두 ai-design.html 이 보내는 칸이다 (새 API 칸 없음)', async () => {
    const block = AI.match(/var body = \{([\s\S]*?)\n {10}\};/)[1];
    const aiKeys = new Set(
      [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]).concat(['fridge_options'])
    );
    const { M } = await load({
      draft: {
        v: 1,
        step: 'kind',
        photo: PHOTO,
        choices: { kind: 'fridge', wallW: '3000', fModel: 'A1' },
      },
    });
    const keys = Object.keys(M.buildBody());
    expect(keys.length).toBeGreaterThan(4);
    for (const k of keys) expect([k, aiKeys.has(k)]).toEqual([k, true]);
  });
});

describe('진행 → 결과', () => {
  test('202 → 담아 둔 사진을 지우고 ?g=<id>#result, 3초마다 읽어 진행 안내 · 진행률', async () => {
    const { calls } = await load();
    $('mkRun').click();
    await tick();
    const d = JSON.parse(sessionStorage.getItem(KEY));
    expect(d.photo).toBeNull();
    expect(window.location.search).toBe(`?g=${ID}`);
    expect(window.location.hash).toBe('#result');
    expect(visible($('mkResultTitle'))).toBe(true);
    expect(visible($('mkProgress'))).toBe(true);
    expect($('mkBar').hidden).toBe(true);

    await tick(3000);
    const g = gets(calls);
    expect(g).toHaveLength(1);
    expect(g[0].url).toBe(`https://gen.example.workers.dev/api/generate/${ID}`);
    expect(g[0].headers.Authorization).toBe('Bearer tok-1');
    expect($('mkProgressLabel').textContent).toBe('가구 배치 중 · 45%');
    expect($('mkProgressBar').style.width).toBe('45%');
    expect($('mkShots').querySelector('.mk-shot--main img').getAttribute('src')).toBe(img(0).url);
  });

  test('끝나면 연출컷 넷(크게 하나 + 작게 셋) · 예상 견적 · 「상담 신청」 하나', async () => {
    await load();
    $('mkRun').click();
    await tick();
    await tick(3000);
    await tick(3000);
    expect($('mkProgress').hidden).toBe(true);
    expect($('mkResState').textContent).toBe('4 / 4');
    expect($('mkShots').querySelector('.mk-shot--main img').getAttribute('src')).toBe(img(0).url);
    expect($('mkShots').querySelector('figcaption').textContent).toBe('싱크대 · 기본안');
    expect(
      [...$('mkShots').querySelectorAll('.mk-thumb img')].map((i) => i.getAttribute('src'))
    ).toEqual([img(1).url, img(2).url, img(3).url]);
    // 견적 — ai-design.html 과 같은 줄 · 합계
    expect(visible($('mkQuote'))).toBe(true);
    const rows = [...$('mkQuoteRows').querySelectorAll('.mk-qrow')].map((r) => r.textContent);
    expect(rows).toEqual(['하부장 캐비닛1,280,000원', '시공비300,000원']);
    expect($('mkQuoteTotal').textContent).toBe('1,738,000원');
    // 주 버튼은 「상담 신청」 하나 — ④ 단계로 연출컷 id 를 넘긴다
    const solid = [...document.querySelectorAll('[data-step="result"] .mk-btn--solid')].filter(
      visible
    );
    expect(solid.map((b) => b.textContent)).toEqual(['상담 신청']);
    expect($('mkConsult').getAttribute('href')).toBe(`consult.html?g=${ID}`);
    // 없앤 것: 파트너 추천 · 상세설계로 가져오기
    expect(document.body.textContent).not.toMatch(/파트너 추천 받기|상세설계로 가져오기/);
    expect(visible($('mkResFoot'))).toBe(true);
  });

  test('작은 컷을 누르면 크게 본다', async () => {
    await load({ gets: [DONE] });
    $('mkRun').click();
    await tick();
    await tick(3000);
    $('mkShots').querySelector('[data-shot="2"]').click();
    expect($('mkShots').querySelector('.mk-shot--main img').getAttribute('src')).toBe(img(2).url);
  });

  test('서명 URL 은 읽을 때마다 바뀌지만 같은 파일이면 처음 주소를 둔다 (이미지를 다시 받지 않게)', async () => {
    const again = { ...DONE, images: [0, 1, 2, 3].map((i) => img(i, 'b')) };
    await load({ gets: [RUNNING, RUNNING, again] });
    $('mkRun').click();
    await tick();
    await tick(3000);
    const first = $('mkShots').querySelector('.mk-shot--main img').getAttribute('src');
    await tick(3000);
    await tick(3000);
    expect($('mkShots').querySelector('.mk-shot--main img').getAttribute('src')).toBe(first);
  });

  test('잡이 실패하면 서버 문구 + 가구 단계로 돌아가는 버튼', async () => {
    await load({
      gets: [{ id: ID, status: 'failed', error: '사진에서 벽을 찾지 못했습니다', images: [] }],
    });
    $('mkRun').click();
    await tick();
    await tick(3000);
    expect(visible($('mkResError'))).toBe(true);
    expect($('mkResError').textContent).toBe('사진에서 벽을 찾지 못했습니다');
    $('mkRetry').click();
    expect(visible($('mkKindTitle'))).toBe(true);
    expect($('mkRun').disabled).toBe(false); // 화면의 사진은 남아 있어 다시 누를 수 있다
  });
});

describe('시작하지 못했을 때 — 가구 단계에서 안내, 사진은 남긴다', () => {
  test.each([
    [
      402,
      { success: false, error: 'insufficient' },
      '크레딧이 부족합니다. 구독을 올리면 더 만들 수 있습니다.',
    ],
    [409, { success: false }, '이미 생성 중인 작업이 있습니다. 끝난 뒤 다시 시도해 주세요.'],
    [500, { success: false, error: '서버 오류' }, '서버 오류'],
  ])('%i', async (status, body, message) => {
    const { calls } = await load({ post: res(status, body) });
    $('mkRun').click();
    await tick();
    expect(visible($('mkKindTitle'))).toBe(true);
    expect($('mkNotice').textContent).toBe(message);
    expect(JSON.parse(sessionStorage.getItem(KEY)).photo).not.toBeNull();
    expect(gets(calls)).toEqual([]);
  });
});

describe('두 번 차감하지 않는다 · 저절로 생성하지 않는다', () => {
  test('만드는 중에 다시 눌러도 POST 는 한 번', async () => {
    const { calls } = await load();
    $('mkRun').click();
    await tick();
    document.querySelector('[data-goto="kind"]').click();
    $('mkRun').click();
    await tick();
    expect(posts(calls)).toHaveLength(1);
    expect(visible($('mkResultTitle'))).toBe(true);
  });

  test('?g=<id> 로 열면 읽기만 한다 (POST 없음) — 로그인했을 때만', async () => {
    const { calls, M } = await load({ url: `/segan/?g=${ID}#result`, draft: null, gets: [DONE] });
    await M.opening;
    expect(posts(calls)).toEqual([]);
    expect(gets(calls)).toHaveLength(1);
    expect(visible($('mkResultTitle'))).toBe(true);
    expect($('mkResState').textContent).toBe('4 / 4');

    const out = await load({ session: null, url: `/segan/?g=${ID}`, draft: null });
    expect(out.calls).toEqual([]);
    expect(visible($('mkPhotoTitle'))).toBe(true);
  });

  test('id 모양이 아니면 무시한다', async () => {
    const { calls } = await load({ url: '/segan/?g=../../x', draft: null });
    expect(calls).toEqual([]);
  });
});

describe('결과 아래 — 다시 만들기 · 공유', () => {
  test('다른 사진으로 다시 만들기 → 사진 단계, 주소에서 ?g 를 뺀다', async () => {
    await load({ gets: [DONE] });
    $('mkRun').click();
    await tick();
    await tick(3000);
    $('mkAgain').click();
    expect(visible($('mkPhotoTitle'))).toBe(true);
    expect(visible($('mkEmpty'))).toBe(true);
    expect(window.location.search).toBe('');
  });

  test('공유 — ai-design.html 과 같은 share 경로, 공유 창이 없으면 복사', async () => {
    const { calls } = await load({ gets: [DONE] });
    const writeText = jest.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    $('mkRun').click();
    await tick();
    await tick(3000);
    $('mkShare').click();
    await tick();
    const share = calls.filter((c) => c.url.endsWith('/share'));
    expect(share).toHaveLength(1);
    expect(share[0].method).toBe('POST');
    expect(share[0].headers.Authorization).toBe('Bearer tok-1');
    expect(writeText).toHaveBeenCalledWith('https://dadamfurniture.com/design-share.html#t=abc');
    expect($('mkResMsg').textContent).toBe('공유 링크를 복사했습니다');
  });
});

describe('④ 상담 신청 자리표시 (segan/consult.html · consult.js)', () => {
  function loadConsult(url) {
    const doc = new DOMParser().parseFromString(read('segan/consult.html'), 'text/html');
    document.body.innerHTML = doc.body.innerHTML;
    for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
    window.history.replaceState(null, '', url);
    delete window.SeganShell;
    (0, eval)(read('segan/shell.js'));
    (0, eval)(read('segan/consult.js'));
  }

  test('연출컷 id 를 받아 두고, 결과로 돌아가는 길 · 대표 전화', () => {
    loadConsult(`/segan/consult.html?g=${ID}`);
    expect($('csGen').value).toBe(ID);
    expect($('csBack').getAttribute('href')).toBe(`./?g=${ID}#result`);
    expect($('csTel').getAttribute('href')).toBe('tel:01077386822');
    expect($('csTel').textContent).toContain('010-7738-6822');
    expect(document.body.dataset.tab).toBe('make');
    expect(document.querySelector('[aria-current="page"]').getAttribute('data-tab-link')).toBe(
      'make'
    );
  });

  test('id 가 아니면 받지 않는다', () => {
    loadConsult('/segan/consult.html?g=<script>');
    expect($('csGen').value).toBe('');
    expect($('csBack').getAttribute('href')).toBe('./');
  });
});
