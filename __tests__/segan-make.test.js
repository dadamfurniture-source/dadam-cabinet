/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, File, Event, Storage, setTimeout, URL */
/**
 * SEGAN 만들기 — ① 사진 · ② 가구 · 로그인 전 임시 보관 (segan/index.html + segan/make.js).
 *
 *   - 품목 · 스타일 · 도어 색 · 냉장고 선택지가 ai-design.html 과 같다 (새 선택지를 만들지 않는다)
 *   - 사진 찍기(카메라) · 앨범 → 미리보기 · 다시 선택, 다음 단계
 *   - 크레딧 안내 (credit_costs · 남은 횟수) 와 시공사례 안내 문장
 *   - 로그인 전 생성 → sessionStorage 에만 담고 login.html?redirect= 로. 돌아오면 같은 단계로 되살리고
 *     저절로 생성하지 않는다. 로그인 전에는 아무것도 올리지 않는다 (fetch 없음)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const AuthRedirect = require('../js/auth-redirect.js');
const AI = read('ai-design.html');
const MAKE = read('segan/make.js');
const KEY = 'segan.make.draft.v1';
const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'customer@example.com' } };
const PHOTO = {
  base64: 'QUJD',
  mime: 'image/jpeg',
  name: 'kitchen.jpg',
  width: 1200,
  height: 900,
  focal35: 26,
};
const FRIDGE_ROWS = [
  {
    brand: '삼성',
    model_name: '비스포크 4도어',
    model_code: 'RF85C9',
    subtype: 'french_4door',
    width_mm: 912,
    height_mm: 1853,
    depth_mm: 930,
  },
  {
    brand: '삼성',
    model_name: '김치플러스',
    model_code: 'RQ58C9',
    subtype: 'kimchi_stand',
    width_mm: 695,
    height_mm: 1853,
    depth_mm: 790,
  },
  {
    brand: 'LG',
    model_name: '디오스 4도어',
    model_code: 'M874GBB',
    subtype: 'french_4door',
    width_mm: 912,
    height_mm: 1860,
    depth_mm: 925,
  },
];

function fakeClient(opts, calls) {
  const tables = {
    credit_costs: { data: { credits: 20 }, error: null },
    user_credits: { data: opts.balance == null ? null : { balance: opts.balance }, error: null },
    profiles: { data: { tier: opts.tier || 'standard' }, error: null },
    credit_plans: {
      data: { monthly_credits: opts.monthly == null ? 100 : opts.monthly },
      error: null,
    },
    appliance_models: { data: FRIDGE_ROWS, error: null },
  };
  return {
    auth: { getSession: async () => ({ data: { session: opts.session || null } }) },
    from: (table) => {
      calls.from.push(table);
      const result = tables[table] || { data: null, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => Promise.resolve(result),
        maybeSingle: async () => result,
        single: async () => result,
        insert: () => {
          calls.writes.push(table);
          return chain;
        },
        update: () => {
          calls.writes.push(table);
          return chain;
        },
      };
      return chain;
    },
  };
}

/** segan/index.html 을 올리고 make.js 를 돌린다 */
async function load(options = {}) {
  const opts = { session: null, draft: null, ...options };
  const doc = new DOMParser().parseFromString(read('segan/index.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  window.history.replaceState(null, '', '/segan/' + (opts.hash || ''));
  sessionStorage.clear();
  if (opts.draft) sessionStorage.setItem(KEY, JSON.stringify(opts.draft));
  delete window.SeganMake;
  window.scrollTo = () => {}; // jsdom 에 없다 (콘솔 오류만 낸다)
  window.DADAM_CONFIG = { supabase: { url: 'https://example.supabase.co', anonKey: 'anon' } };
  const calls = { from: [], writes: [], fetch: [] };
  window.supabase = opts.noSupabase ? undefined : { createClient: () => fakeClient(opts, calls) };
  window.fetch = jest.fn(async (url) => {
    calls.fetch.push(url);
    throw new Error('로그인 전 단계에서는 네트워크로 아무것도 보내지 않는다');
  });
  (0, eval)(MAKE);
  const M = window.SeganMake;
  M.go = jest.fn();
  M.readImage = jest.fn(async (file) => ({ ...PHOTO, name: file.name }));
  await M.ready;
  return { M, calls };
}

const $ = (id) => document.getElementById(id);
const visible = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) if (n.hidden) return false;
  return true;
};
const draft = () => JSON.parse(sessionStorage.getItem(KEY) || 'null');
const pressed = (id) =>
  [...$(id).querySelectorAll('[aria-pressed="true"]')].map((b) => b.textContent);
const flush = () => new Promise((r) => setTimeout(r, 0));

async function choose(inputId, name = 'kitchen.jpg', type = 'image/jpeg') {
  const input = $(inputId);
  const file = new File(['x'], name, { type });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  await flush();
  return file;
}

afterEach(() => jest.restoreAllMocks());

describe('선택지 — ai-design.html 과 같다', () => {
  const options = (id) => {
    const m = AI.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`));
    return [...m[1].matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((x) => ({
      value: x[1],
      label: x[2],
    }));
  };

  test('가구 10종 (key · 라벨 · 순서)', async () => {
    const { M } = await load();
    const ai = [
      ...AI.match(/var KINDS = \[([\s\S]*?)\];/)[1].matchAll(/key: '(\w+)',\s*label: '([^']+)'/g),
    ].map((m) => ({
      key: m[1],
      label: m[2],
    }));
    expect(ai).toHaveLength(10);
    expect(M.KINDS).toEqual(ai);
  });

  test.each([
    ['style', 'STYLES'],
    ['doorColor', 'DOORS'],
    ['fBrand', 'FRIDGE_BRANDS'],
    ['fPos', 'FRIDGE_POS'],
  ])('#%s 선택지 = SeganMake.%s', async (id, key) => {
    const { M } = await load();
    expect(M[key]).toEqual(options(id));
  });
});

describe('① 사진', () => {
  test('처음 — 사진 단계만, 다음 버튼은 막힘, 진행 단계 1', async () => {
    await load();
    expect(visible($('mkPhotoTitle'))).toBe(true);
    expect(visible($('mkKindTitle'))).toBe(false);
    expect($('mkNext').disabled).toBe(true);
    expect($('mkRun').hidden).toBe(true);
    expect(document.querySelector('[aria-current="step"]').getAttribute('data-goto')).toBe('photo');
    expect($('mkPhotoTitle').textContent).toBe('공간 사진을 올려주세요');
  });

  test('사진 찍기는 카메라(capture), 앨범은 JPG · PNG', async () => {
    await load();
    expect($('mkCameraInput').getAttribute('accept')).toBe('image/*');
    expect($('mkCameraInput').getAttribute('capture')).toBe('environment');
    expect($('mkAlbumInput').getAttribute('accept')).toBe('image/jpeg,image/png');
    for (const id of ['mkCamera', 'mkAlbum']) expect($(id).tagName).toBe('BUTTON');
  });

  test('앨범에서 고르면 미리보기 · 파일 이름 · 다음 버튼, 이 기기에만 담는다', async () => {
    const { M, calls } = await load();
    await choose('mkAlbumInput');
    expect(M.readImage).toHaveBeenCalledWith(expect.any(File), false);
    expect($('mkPhoto').getAttribute('src')).toBe('data:image/jpeg;base64,QUJD');
    expect(visible($('mkPhoto'))).toBe(true);
    expect($('mkFile').textContent).toBe('kitchen.jpg · 준비됨');
    expect($('mkNext').disabled).toBe(false);
    expect(draft().photo).toMatchObject({
      base64: 'QUJD',
      mime: 'image/jpeg',
      name: 'kitchen.jpg',
    });
    expect(calls.fetch).toEqual([]);
  });

  test('사진 찍기 입력은 카메라 표시로 읽는다', async () => {
    const { M } = await load();
    await choose('mkCameraInput', 'IMG_0001.heic', 'image/heic');
    expect(M.readImage).toHaveBeenCalledWith(expect.any(File), true);
  });

  test('못 읽는 파일 — 안내만, 다음 버튼은 그대로 막힘', async () => {
    const { M } = await load();
    M.readImage.mockRejectedValueOnce(new Error('JPG · PNG 만 올릴 수 있습니다'));
    await choose('mkAlbumInput', 'a.gif', 'image/gif');
    expect(visible($('mkPhotoError'))).toBe(true);
    expect($('mkPhotoError').textContent).toBe('JPG · PNG 만 올릴 수 있습니다');
    expect($('mkNext').disabled).toBe(true);
    expect(draft() && draft().photo).toBeFalsy();
  });

  test('다시 선택 — 사진을 버리고 담아 둔 사진도 지운다 (고른 값은 남는다)', async () => {
    await load();
    await choose('mkAlbumInput');
    $('mkNext').click();
    document.querySelector('[data-kind="wardrobe"]').click();
    document.querySelector('[data-goto="photo"]').click();
    $('mkClear').click();
    expect(visible($('mkEmpty'))).toBe(true);
    expect($('mkNext').disabled).toBe(true);
    expect(draft().photo).toBeNull();
    expect(draft().choices.kind).toBe('wardrobe');
  });
});

describe('② 가구', () => {
  async function toKind(opts) {
    const r = await load(opts);
    await choose('mkAlbumInput');
    $('mkNext').click();
    return r;
  }

  test('다음 → 가구 단계 (#kind), 진행 단계 2, 1 은 눌러 되돌아갈 수 있다', async () => {
    await toKind();
    expect(window.location.hash).toBe('#kind');
    expect(visible($('mkKindTitle'))).toBe(true);
    expect(visible($('mkPhotoTitle'))).toBe(false);
    expect(document.querySelector('[aria-current="step"]').getAttribute('data-goto')).toBe('kind');
    expect(document.querySelector('[data-goto="photo"]').disabled).toBe(false);
    expect(document.querySelector('[data-goto="result"]').disabled).toBe(true);
    document.querySelector('[data-goto="photo"]').click();
    expect(visible($('mkPhotoTitle'))).toBe(true);
    expect(visible($('mkPhoto'))).toBe(true); // 사진은 그대로
  });

  test('가구 10종 · 기본 싱크대 · 스타일 5 · 도어 색 7, 하나씩만 눌림', async () => {
    await toKind();
    expect($('mkKinds').querySelectorAll('button')).toHaveLength(10);
    expect(pressed('mkKinds')).toEqual(['싱크대']);
    expect($('mkStyles').querySelectorAll('button')).toHaveLength(5);
    expect($('mkDoors').querySelectorAll('button')).toHaveLength(7);
    document.querySelector('[data-style="classic"]').click();
    document.querySelector('[data-door="oak woodgrain"]').click();
    expect(pressed('mkStyles')).toEqual(['클래식']);
    expect(pressed('mkDoors')).toEqual(['오크']);
    expect(draft().choices).toMatchObject({
      kind: 'sink',
      style: 'classic',
      door: 'oak woodgrain',
    });
  });

  test('급수 · 배기는 싱크대 · 아일랜드만, 냉장고 칸은 냉장고장만', async () => {
    await toKind();
    expect($('mkPlumbing').hidden).toBe(false);
    expect($('mkFridge').hidden).toBe(true);
    document.querySelector('[data-kind="wardrobe"]').click();
    expect($('mkPlumbing').hidden).toBe(true);
    document.querySelector('[data-kind="island"]').click();
    expect($('mkPlumbing').hidden).toBe(false);
    document.querySelector('[data-kind="fridge"]').click();
    expect($('mkPlumbing').hidden).toBe(true);
    expect($('mkFridge').hidden).toBe(false);
  });

  test('냉장고 모델 — appliance_models 를 브랜드별로 채우고 고른 값을 담는다', async () => {
    const { calls } = await toKind();
    document.querySelector('[data-kind="fridge"]').click();
    await flush();
    expect(calls.from).toContain('appliance_models');
    const codes = () => [...$('mkFModel').options].map((o) => o.value);
    expect(codes()).toEqual(['', 'RF85C9']);
    document.querySelector('[data-fbrand="lg"]').click();
    expect(codes()).toEqual(['', 'M874GBB']);
    $('mkFModel').value = 'M874GBB';
    $('mkFModel').dispatchEvent(new Event('change'));
    expect(draft().choices).toMatchObject({ kind: 'fridge', fBrand: 'lg', fModel: 'M874GBB' });
  });

  test('치수 — 숫자만 담는다', async () => {
    await toKind();
    $('mkWallW').value = '3200';
    $('mkWallW').dispatchEvent(new Event('input'));
    expect(draft().choices.wallW).toBe('3200');
  });

  test('뒤로 가기(popstate) — 사진 단계로', async () => {
    await toKind();
    window.history.replaceState(null, '', '/segan/');
    window.dispatchEvent(new window.PopStateEvent('popstate'));
    expect(visible($('mkPhotoTitle'))).toBe(true);
  });
});

describe('크레딧 안내 — 생성 버튼 위', () => {
  async function kindWith(opts) {
    const r = await load(opts);
    await choose('mkAlbumInput');
    $('mkNext').click();
    return r;
  }

  test('로그인 전 — 단가(credit_costs) + 로그인 안내 + 시공사례 문장', async () => {
    const { calls } = await kindWith({});
    expect(calls.from).toContain('credit_costs');
    expect($('mkCost').textContent).toBe('20 크레딧 차감 · 로그인하면 생성할 수 있습니다');
    expect(visible($('mkPost'))).toBe(true);
    expect($('mkPost').textContent).toBe('완성되면 대표 연출컷 1장이 시공사례에 올라갑니다');
    expect(visible($('mkRun'))).toBe(true);
    expect($('mkRun').textContent).toBe('연출컷 생성');
  });

  test('로그인 — 남은 횟수 = 잔액 ÷ 단가 (user_credits)', async () => {
    await kindWith({ session: SESSION, balance: 1000 });
    expect($('mkCost').textContent).toBe('20 크레딧 차감 · 남은 50회');
  });

  test('로그인 · 잔액 행 없음 — 등급 지급량 (js/site-shell.js 와 같은 규칙)', async () => {
    const { calls } = await kindWith({
      session: SESSION,
      balance: null,
      tier: 'expert',
      monthly: 300,
    });
    expect(calls.from).toEqual(
      expect.arrayContaining(['user_credits', 'profiles', 'credit_plans'])
    );
    expect($('mkCost').textContent).toBe('20 크레딧 차감 · 남은 15회');
  });

  test('사진 단계에서는 크레딧 줄 · 시공사례 문장을 감춘다', async () => {
    await load({ session: SESSION, balance: 1000 });
    expect($('mkCost').hidden).toBe(true);
    expect($('mkPost').hidden).toBe(true);
  });
});

describe('로그인 문 — 크레딧을 쓰는 버튼에서만', () => {
  test('로그인 전 생성 → 이 기기에만 담고 login.html?redirect=segan/index.html, 아무것도 올리지 않는다', async () => {
    const { M, calls } = await load();
    await choose('mkAlbumInput');
    $('mkNext').click();
    document.querySelector('[data-kind="fridge"]').click();
    document.querySelector('[data-door="walnut woodgrain"]').click();
    $('mkRun').click();
    await flush();
    expect(M.go).toHaveBeenCalledTimes(1);
    const href = M.go.mock.calls[0][0];
    expect(href).toBe('../login.html?redirect=segan%2Findex.html');
    const url = new URL(href, 'https://dadamfurniture.com/segan/index.html');
    expect(url.pathname).toBe('/login.html');
    expect(AuthRedirect.fromSearch(url.search)).toBe('segan/index.html');
    expect(draft()).toMatchObject({
      v: 1,
      step: 'kind',
      photo: { base64: 'QUJD', name: 'kitchen.jpg' },
      choices: { kind: 'fridge', door: 'walnut woodgrain' },
    });
    expect(calls.fetch).toEqual([]);
    expect(calls.writes).toEqual([]);
  });

  test('로그인하고 돌아오면 같은 단계 · 사진 · 선택으로 되살린다 — 저절로 생성하지 않는다', async () => {
    const { M, calls } = await load({
      session: SESSION,
      balance: 1000,
      draft: {
        v: 1,
        step: 'kind',
        photo: PHOTO,
        choices: {
          kind: 'fridge',
          style: 'classic',
          door: 'oak woodgrain',
          wallW: '3200',
          fBrand: 'lg',
          fPos: 'right',
        },
      },
    });
    const start = jest.spyOn(M, 'start');
    await flush();
    expect(visible($('mkKindTitle'))).toBe(true);
    expect($('mkPhoto').getAttribute('src')).toBe('data:image/jpeg;base64,QUJD');
    expect(pressed('mkKinds')).toEqual(['냉장고장']);
    expect(pressed('mkStyles')).toEqual(['클래식']);
    expect(pressed('mkDoors')).toEqual(['오크']);
    expect(pressed('mkFBrands')).toEqual(['LG']);
    expect(pressed('mkFPos')).toEqual(['우측']);
    expect($('mkWallW').value).toBe('3200');
    expect($('mkRun').disabled).toBe(false);
    expect($('mkCost').textContent).toBe('20 크레딧 차감 · 남은 50회');
    expect(start).not.toHaveBeenCalled();
    expect(calls.fetch).toEqual([]);
    expect(M.go).not.toHaveBeenCalled();
  });

  test('로그인한 채 생성 → 로그인으로 보내지 않고 생성 단계(start)로 간다', async () => {
    const { M } = await load({
      session: SESSION,
      draft: { v: 1, step: 'kind', photo: PHOTO, choices: {} },
    });
    const start = jest.spyOn(M, 'start').mockResolvedValue(undefined);
    $('mkRun').click();
    await flush();
    expect(M.go).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
  });

  test('담아 둔 값이 이상하면 기본값으로 (모르는 품목 · 색 · 숫자 아님 · 사진 형식)', async () => {
    await load({
      draft: {
        v: 1,
        step: 'kind',
        photo: { ...PHOTO, mime: 'text/html' },
        choices: { kind: 'evil', door: 'red', style: 'x', wallW: '12ab', fModel: '<script>' },
      },
    });
    expect(visible($('mkPhotoTitle'))).toBe(true); // 사진이 없으니 1단계
    expect(draft().choices).toMatchObject({
      kind: 'sink',
      door: 'white',
      style: 'modern-minimal',
      wallW: '',
      fModel: '',
    });
  });

  test('사진이 너무 커서 못 담으면 — 안내하고 고른 값만 담은 채 로그인으로', async () => {
    const { M } = await load();
    await choose('mkAlbumInput');
    $('mkNext').click();
    const real = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) {
      if (String(v).includes('QUJD')) throw new Error('QuotaExceededError');
      return real.call(this, k, v);
    });
    $('mkRun').click();
    await flush();
    expect($('mkNotice').textContent).toContain('로그인한 뒤 사진을 다시 골라 주세요');
    expect(draft().photo).toBeNull();
    expect(M.go).toHaveBeenCalledTimes(1);
  });

  test('Supabase 라이브러리가 없어도 사진 · 가구는 고를 수 있다 (생성은 로그인으로)', async () => {
    const { M } = await load({ noSupabase: true });
    await choose('mkAlbumInput');
    $('mkNext').click();
    expect(visible($('mkKindTitle'))).toBe(true);
    expect($('mkCost').hidden).toBe(true); // 단가를 모르면 줄을 감춘다
    $('mkRun').click();
    await flush();
    expect(M.go).toHaveBeenCalledTimes(1);
  });
});

describe('페이지 · 서비스 워커', () => {
  test('index.html 이 config · supabase · shell · make 를 싣는다', () => {
    const html = read('segan/index.html');
    expect(html).toMatch(/<script src="\.\.\/js\/config\.js\?v=\d+"><\/script>/);
    expect(html).toContain(
      '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45"></script>'
    );
    expect(html).toMatch(/<script src="make\.js\?v=\d+" defer><\/script>/);
    expect(html).toMatch(/<link rel="stylesheet" href="make\.css\?v=\d+" \/>/);
  });

  test('누르는 곳은 44px 이상 (버튼 · 칩 · 진행 단계 · 입력)', () => {
    const css = read('segan/make.css');
    for (const sel of ['.mk-btn', '.mk-chip', '.mk-stepnav']) {
      const m = css.match(new RegExp(`\\n${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
      expect([sel, Number((m[1].match(/min-height:\s*(\d+)px/) || [])[1]) >= 44]).toEqual([
        sel,
        true,
      ]);
    }
    expect(css).toMatch(/\.mk-input input,\s*\.mk-input select\s*\{[^}]*min-height:\s*48px/);
  });
});
