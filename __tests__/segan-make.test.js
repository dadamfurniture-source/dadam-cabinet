/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, File, Event, Storage, setTimeout, URL */
/**
 * SEGAN 만들기 — 진행 단계 6칸 · ① 사진 · ② 품목 · 로그인 전 임시 보관 (segan/make.html + segan/make.js).
 * ③ 참고 사진은 segan-make-refs.test.js, 결과(4 생성 · 5 견적서)는 segan-make-result*.test.js.
 *
 *   - 품목 · 스타일 · 도어 색 · 냉장고 선택지가 ai-design.html 과 같다 (새 선택지를 만들지 않는다).
 *     스타일 · 도어 색 · 치수 칸은 2026-11-21 뺐다 — 목록은 상담 정리 · 옛 결과 이름에 쓴다
 *   - ② 요청 · AI 상담: 적은 글 → /api/chat(app · 줄인 방 사진) → 「정리하기」 /api/chat/brief → 고칠 수 있는 참고 내용
 *   - 사진 찍기(카메라) · 앨범 → 미리보기(칸 안에 원본 전체 · 채워 보기) · 다시 선택, 다음 단계
 *   - 크레딧 안내 (credit_costs · 남은 횟수 = my_credit_wallet 잔액) 와 시공사례 안내 문장
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
    // 크레딧 통장 — my_credit_wallet (업체 구성원이면 업체 통장, 아니면 내 통장)
    rpc: async (name) => {
      calls.rpc.push(name);
      if (opts.walletError) return { data: null, error: { message: 'x' } };
      if (opts.wallet !== undefined) return { data: opts.wallet, error: null };
      const row = {
        scope: 'personal',
        company_id: null,
        plan: opts.tier || 'standard',
        balance: opts.balance,
        monthly: 100,
        period_end: null,
        usable: true,
      };
      return { data: opts.balance == null ? [] : [row], error: null };
    },
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

/** segan/make.html 을 올리고 make.js 를 돌린다 */
async function load(options = {}) {
  const opts = { session: null, draft: null, ...options };
  const doc = new DOMParser().parseFromString(read('segan/make.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  window.history.replaceState(null, '', '/segan/' + (opts.hash || ''));
  sessionStorage.clear();
  if (opts.draft) sessionStorage.setItem(KEY, JSON.stringify(opts.draft));
  delete window.SeganMake;
  window.scrollTo = () => {}; // jsdom 에 없다 (콘솔 오류만 낸다)
  window.DADAM_CONFIG = { supabase: { url: 'https://example.supabase.co', anonKey: 'anon' } };
  const calls = { from: [], writes: [], fetch: [], rpc: [] };
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

describe('진행 단계 6칸 — 1 사진 · 2 품목 · 3 참고 사진 · 4 생성 · 5 견적서 · 6 상담 신청', () => {
  const marks = () =>
    [...document.querySelectorAll('.mk-steps [data-mark]')].map((b) => ({
      mark: b.getAttribute('data-mark'),
      text: b.textContent.trim(),
      done: b.classList.contains('mk-stepnav--done'),
      current: b.getAttribute('aria-current') === 'step',
      disabled: b.disabled,
    }));

  test('여섯 칸 글 · 차례, 화면 단계는 넷 (#photo · #kind · #refs · #result)', async () => {
    const { M } = await load();
    expect(marks().map((m) => m.text)).toEqual([
      '1 사진',
      '2 품목',
      '3 참고 사진',
      '4 생성',
      '5 견적서',
      '6 상담 신청',
    ]);
    expect(M.STEPS).toEqual(['photo', 'kind', 'refs', 'result']);
    expect(M.MARKS).toEqual(['photo', 'kind', 'refs', 'make', 'quote', 'consult']);
    expect(
      [...document.querySelectorAll('.mk-steps [data-goto]')].map((b) =>
        b.getAttribute('data-goto')
      )
    ).toEqual(['photo', 'kind', 'refs', 'result', 'result', 'consult']);
    expect([...document.querySelectorAll('[data-step]')].map((s) => s.dataset.step)).toEqual(
      M.STEPS
    );
    const css = read('segan/make.css');
    expect(css).toMatch(/\.mk-steps\s*\{[^}]*grid-template-columns:\s*repeat\(6,/);
  });

  test('사진 → 품목 → 참고 사진 — 지금 칸까지 켜지고, 지나온 칸만 누를 수 있다', async () => {
    await load();
    let m = marks();
    expect(m.filter((x) => x.current).map((x) => x.mark)).toEqual(['photo']);
    expect(m.filter((x) => x.done).map((x) => x.mark)).toEqual(['photo']);
    expect(m.every((x) => x.disabled)).toBe(true);
    await choose('mkAlbumInput');
    $('mkNext').click();
    expect(window.location.hash).toBe('#kind');
    $('mkNext').click();
    expect(window.location.hash).toBe('#refs');
    expect(visible($('mkRefsTitle'))).toBe(true);
    m = marks();
    expect(m.filter((x) => x.current).map((x) => x.mark)).toEqual(['refs']);
    expect(m.filter((x) => x.done).map((x) => x.mark)).toEqual(['photo', 'kind', 'refs']);
    expect(m.filter((x) => !x.disabled).map((x) => x.mark)).toEqual(['photo', 'kind']);
    // 2 품목을 누르면 되돌아간다
    document.querySelector('[data-mark="kind"]').click();
    expect(window.location.hash).toBe('#kind');
    expect(visible($('mkKindTitle'))).toBe(true);
  });

  test('누르는 칸은 44px 이상, 좁은 폭에서 글이 낱말 중간에서 끊기지 않는다', () => {
    const css = read('segan/make.css');
    const m = css.match(/\n\.mk-stepnav\s*\{([^}]*)\}/)[1];
    expect(m).toMatch(/min-height:\s*44px/);
    expect(m).toMatch(/word-break:\s*keep-all/);
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

  test('칸 안에 원본 전체 (전체 보기 기본) · 채워 보기는 보기만 바꾼다 — 칸 모양 · 담는 사진은 그대로', async () => {
    await load();
    expect($('mkFitRow').hidden).toBe(true); // 사진이 없으면 감춘다
    await choose('mkAlbumInput');
    expect(visible($('mkFitRow'))).toBe(true);
    expect(pressed('mkFit')).toEqual(['전체 보기']);
    expect($('mkDrop').classList.contains('mk-drop--fill')).toBe(false);
    // 칸을 사진 비율로 바꾸지 않는다 — 칸(4:3) 안에 contain 으로 전체를 보인다
    expect($('mkDrop').getAttribute('style') || '').not.toMatch(/aspect-ratio/);
    expect(MAKE).not.toMatch(/aspectRatio/);
    expect(read('segan/make.css')).toMatch(/\n\.mk-drop\s*\{[^}]*aspect-ratio:\s*4 \/ 3/);
    const before = sessionStorage.getItem(KEY);
    document.querySelector('[data-fit="cover"]').click();
    expect(pressed('mkFit')).toEqual(['채워 보기']);
    expect($('mkDrop').classList.contains('mk-drop--fill')).toBe(true);
    expect(sessionStorage.getItem(KEY)).toBe(before); // 사진을 자르지 않는다
    document.querySelector('[data-fit="contain"]').click();
    expect($('mkDrop').classList.contains('mk-drop--fill')).toBe(false);
    const css = read('segan/make.css');
    expect(css).toMatch(/\.mk-photo\s*\{[^}]*position:\s*absolute;[^}]*object-fit:\s*contain/);
    expect(css).toMatch(/\.mk-drop--fill \.mk-photo\s*\{[^}]*object-fit:\s*cover/);
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

describe('② 품목', () => {
  async function toKind(opts) {
    const r = await load(opts);
    await choose('mkAlbumInput');
    $('mkNext').click();
    return r;
  }

  test('다음 → 품목 단계 (#kind), 진행 단계 2, 1 은 눌러 되돌아갈 수 있다', async () => {
    await toKind();
    expect(window.location.hash).toBe('#kind');
    expect(visible($('mkKindTitle'))).toBe(true);
    expect(visible($('mkPhotoTitle'))).toBe(false);
    expect(document.querySelector('[aria-current="step"]').getAttribute('data-goto')).toBe('kind');
    expect(document.querySelector('[data-goto="photo"]').disabled).toBe(false);
    expect(document.querySelector('[data-goto="refs"]').disabled).toBe(true);
    expect(document.querySelector('[data-goto="result"]').disabled).toBe(true);
    expect(document.querySelector('[data-goto="consult"]').disabled).toBe(true);
    document.querySelector('[data-goto="photo"]').click();
    expect(visible($('mkPhotoTitle'))).toBe(true);
    expect(visible($('mkPhoto'))).toBe(true); // 사진은 그대로
  });

  test('품목 단계의 아래 버튼은 「다음 · 참고 사진 고르기」 — 생성 버튼 · 크레딧 줄은 ③ 에', async () => {
    await toKind();
    expect(visible($('mkNext'))).toBe(true);
    expect($('mkNext').textContent).toBe('다음 · 참고 사진 고르기');
    expect($('mkRun').hidden).toBe(true);
    expect($('mkCost').hidden).toBe(true);
    expect($('mkPost').hidden).toBe(true);
    $('mkNext').click();
    expect(window.location.hash).toBe('#refs');
    expect($('mkNext').hidden).toBe(true);
    expect(visible($('mkRun'))).toBe(true);
  });

  test('가구 10종 · 기본 싱크대, 하나씩만 눌림 — 스타일 · 도어 색 · 치수 · 설비 칸은 없다', async () => {
    await toKind();
    expect($('mkKinds').querySelectorAll('button')).toHaveLength(10);
    expect(pressed('mkKinds')).toEqual(['싱크대']);
    document.querySelector('[data-kind="wardrobe"]').click();
    expect(pressed('mkKinds')).toEqual(['붙박이장']);
    ['mkStyles', 'mkDoors', 'mkMore', 'mkWallW', 'mkWater', 'mkExhaust', 'mkPlumbing'].forEach(
      (id) => expect($(id)).toBeNull()
    );
    expect($('mkAdvTitle').textContent).toContain('요청 · AI 상담');
    $('mkPrompt').value = '월넛 도어';
    $('mkPrompt').dispatchEvent(new Event('input'));
    expect(draft().choices).toMatchObject({ kind: 'wardrobe', prompt: '월넛 도어' });
    expect(draft().choices).not.toHaveProperty('style');
  });

  test('냉장고 칸은 냉장고장만', async () => {
    await toKind();
    expect($('mkFridge').hidden).toBe(true);
    document.querySelector('[data-kind="fridge"]').click();
    expect($('mkFridge').hidden).toBe(false);
    document.querySelector('[data-kind="island"]').click();
    expect($('mkFridge').hidden).toBe(true);
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

  test('뒤로 가기(popstate) — 사진 단계로', async () => {
    await toKind();
    window.history.replaceState(null, '', '/segan/');
    window.dispatchEvent(new window.PopStateEvent('popstate'));
    expect(visible($('mkPhotoTitle'))).toBe(true);
  });
});

describe('시트 · 옆 패널 기록 칸 (segan/shell.js SeganShell.sheet) — 단계를 바꾸지 않는다', () => {
  /** 가구 단계까지 간 뒤 셸을 올린다 (셸 popstate 처리기는 make.js 다음에 붙지만 capture 라 먼저 받는다) */
  async function kindWithShell() {
    const r = await load();
    await choose('mkAlbumInput');
    $('mkNext').click();
    delete window.SeganShell;
    (0, eval)(read('segan/shell.js'));
    await window.SeganShell.ready;
    return r;
  }
  async function until(fn) {
    for (let i = 0; i < 100; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('기다린 상태가 오지 않았다');
  }

  test('시트 표시 칸의 popstate 는 무시한다 — 주소에 # 이 없어도 사진 단계로 되돌리지 않는다', async () => {
    await kindWithShell();
    window.history.replaceState(null, '', '/segan/');
    window.dispatchEvent(new window.PopStateEvent('popstate', { state: { sgSheet: 1 } }));
    expect(visible($('mkKindTitle'))).toBe(true);
    expect(visible($('mkPhotoTitle'))).toBe(false);
    // 페이지 칸이면 예전처럼 사진 단계로
    window.dispatchEvent(new window.PopStateEvent('popstate', { state: null }));
    expect(visible($('mkPhotoTitle'))).toBe(true);
  });

  test('시트를 열고 뒤로 가기 — 시트만 닫히고 만들기는 그대로 (단계 · 주소 · 기록 칸을 건드리지 않는다)', async () => {
    await kindWithShell();
    const replace = jest.spyOn(window.history, 'replaceState');
    const h = window.SeganShell.sheet.open({ title: '고른 사진', body: 'x' });
    expect(window.location.hash).toBe('#kind');
    window.history.back();
    await until(() => !h.isOpen());
    await flush();
    expect(window.location.hash).toBe('#kind');
    expect(visible($('mkKindTitle'))).toBe(true);
    expect(replace).not.toHaveBeenCalled(); // setStep 이 돌았다면 replaceState({ mk }) 를 불렀다
    expect(window.history.state).toEqual({ mk: 'kind' });
  });
});

describe('크레딧 안내 — 생성 버튼 위 (③ 참고 사진 단계)', () => {
  async function kindWith(opts) {
    const r = await load(opts);
    await choose('mkAlbumInput');
    $('mkNext').click();
    $('mkNext').click();
    expect(window.location.hash).toBe('#refs');
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

  test('로그인 — 남은 횟수 = 통장 잔액(my_credit_wallet) ÷ 단가', async () => {
    const { calls } = await kindWith({ session: SESSION, balance: 1000 });
    expect(calls.rpc).toEqual(['my_credit_wallet']);
    expect($('mkCost').textContent).toBe('20 크레딧 차감 · 남은 50회');
    // 옛 계산(user_credits · 등급 지급량)은 쓰지 않는다 — 기간 · 업체 통장은 DB 가 고른다
    expect(calls.from).not.toEqual(expect.arrayContaining(['user_credits']));
    expect(calls.from).not.toEqual(expect.arrayContaining(['credit_plans']));
  });

  test('협력업체 구성원 — 업체 통장 잔액으로 센다', async () => {
    await kindWith({
      session: SESSION,
      wallet: [
        {
          scope: 'company',
          company_id: '11111111-1111-4111-8111-111111111111',
          plan: 'agent',
          balance: 2400,
          monthly: 3000,
          period_end: '2026-11-20T00:00:00Z',
          usable: true,
        },
      ],
    });
    expect($('mkCost').textContent).toBe('20 크레딧 차감 · 남은 120회');
  });

  test.each([
    ['통장을 못 읽음', { walletError: true }],
    ['빈 응답', { wallet: [] }],
  ])('%s — 남은 횟수는 적지 않는다', async (_name, extra) => {
    await kindWith({ session: SESSION, ...extra });
    expect($('mkCost').textContent).toBe('20 크레딧 차감');
  });

  test('사진 단계에서는 크레딧 줄 · 시공사례 문장을 감춘다', async () => {
    await load({ session: SESSION, balance: 1000 });
    expect($('mkCost').hidden).toBe(true);
    expect($('mkPost').hidden).toBe(true);
  });
});

describe('로그인 문 — 크레딧을 쓰는 버튼에서만', () => {
  test('로그인 전 생성 → 이 기기에만 담고 login.html?redirect=segan/make.html, 아무것도 올리지 않는다', async () => {
    const { M, calls } = await load();
    await choose('mkAlbumInput');
    $('mkNext').click();
    document.querySelector('[data-kind="fridge"]').click();
    $('mkPrompt').value = '월넛 도어';
    $('mkPrompt').dispatchEvent(new Event('input'));
    $('mkNext').click();
    $('mkRun').click();
    await flush();
    expect(M.go).toHaveBeenCalledTimes(1);
    const href = M.go.mock.calls[0][0];
    expect(href).toBe('../login.html?redirect=segan%2Fmake.html');
    const url = new URL(href, 'https://dadamfurniture.com/segan/make.html');
    expect(url.pathname).toBe('/login.html');
    expect(AuthRedirect.fromSearch(url.search)).toBe('segan/make.html');
    expect(draft()).toMatchObject({
      v: 1,
      step: 'refs',
      photo: { base64: 'QUJD', name: 'kitchen.jpg' },
      choices: { kind: 'fridge', prompt: '월넛 도어' },
      refs: [],
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
        step: 'refs',
        photo: PHOTO,
        choices: {
          kind: 'fridge',
          prompt: '오크 도어',
          brief: '오크 도어, 천장까지',
          fBrand: 'lg',
          fPos: 'right',
        },
      },
    });
    const start = jest.spyOn(M, 'start');
    await flush();
    expect(visible($('mkRefsTitle'))).toBe(true);
    expect(window.location.hash).toBe('#refs');
    expect($('mkPhoto').getAttribute('src')).toBe('data:image/jpeg;base64,QUJD');
    expect(pressed('mkKinds')).toEqual(['냉장고장']);
    expect(pressed('mkFBrands')).toEqual(['LG']);
    expect(pressed('mkFPos')).toEqual(['우측']);
    expect($('mkPrompt').value).toBe('오크 도어');
    expect($('mkBrief').value).toBe('오크 도어, 천장까지');
    expect($('mkBriefBox').hidden).toBe(false);
    expect($('mkRun').disabled).toBe(false);
    expect($('mkCost').textContent).toBe('20 크레딧 차감 · 남은 50회');
    expect(start).not.toHaveBeenCalled();
    expect(calls.fetch).toEqual([]);
    expect(M.go).not.toHaveBeenCalled();
  });

  test('예전에 담은 것(가구 단계 · 참고 사진 칸 없음)도 그대로 되살린다', async () => {
    const { M } = await load({
      draft: { v: 1, step: 'kind', photo: PHOTO, choices: { kind: 'wardrobe' } },
    });
    expect(visible($('mkKindTitle'))).toBe(true);
    expect(pressed('mkKinds')).toEqual(['붙박이장']);
    expect(M.state.refs).toEqual([]);
  });

  test('로그인한 채 생성 → 로그인으로 보내지 않고 생성 단계(start)로 간다', async () => {
    const { M } = await load({
      session: SESSION,
      draft: { v: 1, step: 'refs', photo: PHOTO, choices: {} },
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
        choices: {
          kind: 'evil',
          door: 'red',
          style: 'x',
          wallW: '12ab',
          fModel: '<script>',
          prompt: 7,
          brief: '',
          briefDoor: 'oak woodgrain',
          chat: [
            { role: 'system', text: 'x' },
            { role: 'me', text: '  ' },
            'nope',
            { role: 'ai', text: '안녕' },
          ],
        },
      },
    });
    expect(visible($('mkPhotoTitle'))).toBe(true); // 사진이 없으니 1단계
    const c = draft().choices;
    expect(c).toMatchObject({
      kind: 'sink',
      fModel: '',
      prompt: '',
      brief: '',
      briefDoor: '', // 참고 내용 없이 고른 색은 버린다
      chat: [], // 고객 말이 없는 기록은 버린다
    });
    ['door', 'style', 'wallW'].forEach((k) => expect(c).not.toHaveProperty(k));
  });

  test('사진이 너무 커서 못 담으면 — 안내하고 고른 값만 담은 채 로그인으로', async () => {
    const { M } = await load();
    await choose('mkAlbumInput');
    $('mkNext').click();
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

  test('Supabase 라이브러리가 없어도 사진 · 품목은 고를 수 있다 (생성은 로그인으로)', async () => {
    const { M } = await load({ noSupabase: true });
    await choose('mkAlbumInput');
    $('mkNext').click();
    expect(visible($('mkKindTitle'))).toBe(true);
    $('mkNext').click();
    expect(visible($('mkRefsTitle'))).toBe(true);
    expect($('mkCost').hidden).toBe(true); // 단가를 모르면 줄을 감춘다
    $('mkRun').click();
    await flush();
    expect(M.go).toHaveBeenCalledTimes(1);
  });
});

describe('페이지 · 서비스 워커', () => {
  test('index.html 이 config · supabase · shell · make 를 싣는다', () => {
    const html = read('segan/make.html');
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

describe('② 요청 · AI 상담 — /api/chat (app · 줄인 방 사진) → 「정리하기」 /api/chat/brief', () => {
  const BASE = 'https://dadam-generate-api.dadamfurniture.workers.dev';
  const SMALL = { base64: 'U01BTEw=', mimeType: 'image/jpeg' };

  /** 로그인 · 사진이 있는 품목 단계 — 상담 서버는 가짜 fetch (replies 를 차례로 준다) */
  async function chatLoad(replies, opts = {}) {
    const r = await load({
      session: SESSION,
      balance: 1000,
      draft: { v: 1, step: 'kind', photo: PHOTO, choices: opts.choices || { kind: 'sink' } },
    });
    await flush();
    r.M.shrinkPhoto = jest.fn(async () => SMALL);
    const sent = [];
    window.fetch = jest.fn(async (url, init = {}) => {
      if (!String(url).startsWith(BASE + '/api/chat')) throw new Error('unexpected ' + url);
      sent.push({ url, body: JSON.parse(init.body), headers: init.headers });
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return { ok: next.ok !== false, status: next.status || 200, json: async () => next };
    });
    return { ...r, sent };
  }
  const OPENER =
    '싱크대 구성에서 원하시는 게 있으면 편하게, 되도록 구체적으로 적어 주세요. 이야기 들으면서 하나씩 같이 정해 볼게요.';
  const log = () =>
    [...$('mkChatLog').querySelectorAll('.mk-chat-msg')].map((p) => [
      p.className.replace('mk-chat-msg mk-chat-msg--', ''),
      p.textContent,
    ]);

  test('로그인 전 — 글 칸만, 상담 단추 대신 로그인 안내. 누르면 이 기기에 담고 로그인으로, 아무것도 보내지 않는다', async () => {
    const { M, calls } = await load({ draft: { v: 1, step: 'kind', photo: PHOTO, choices: {} } });
    await flush();
    expect(visible($('mkPrompt'))).toBe(true);
    expect($('mkChatLog').hidden).toBe(true);
    expect($('mkChatRow').hidden).toBe(true);
    expect(visible($('mkChatLogin'))).toBe(true);
    $('mkPrompt').value = '화이트 도어';
    $('mkPrompt').dispatchEvent(new Event('input'));
    $('mkChatLogin').click();
    expect(M.go).toHaveBeenCalledWith('../login.html?redirect=segan%2Fmake.html');
    expect(draft()).toMatchObject({
      step: 'kind',
      choices: { prompt: '화이트 도어' },
      photo: { base64: 'QUJD' },
    });
    expect(calls.fetch).toEqual([]);
  });

  test('로그인하면 단추 없이 AI 첫 질문 · 답 칸이 바로 — 첫 답에 그 질문이 같이 간다 → 이어 묻기 → 정리하기 → 참고 내용 · 고른 색', async () => {
    const { M, sent } = await chatLoad([
      { success: true, reply: '좋아요. 상판은 어떤 느낌이 좋을까요?' },
      { success: true, reply: '알겠습니다. 「정리하기」를 눌러 주세요.' },
      {
        success: true,
        brief: '월넛 도어, 화이트 상판',
        door_color: 'walnut woodgrain',
        design_style: 'classic',
      },
    ]);
    expect($('mkChatStart')).toBeNull();
    expect($('mkChatLogin').hidden).toBe(true);
    expect($('mkPromptBox').hidden).toBe(true);
    expect(log()).toEqual([['ai', OPENER]]);
    expect(visible($('mkChatRow'))).toBe(true);
    expect($('mkBriefMake').hidden).toBe(true);
    expect(sent).toEqual([]); // 첫 질문은 화면 글 — 서버를 기다리지 않는다
    $('mkChatInput').value = '월넛 도어';
    $('mkChatSend').click();
    await M.chatting;
    expect(sent[0].url).toBe(BASE + '/api/chat');
    expect(sent[0].headers.Authorization).toBe('Bearer tok-1');
    expect(sent[0].body).toEqual({
      category: 'sink',
      app: true,
      messages: [
        { role: 'ai', text: OPENER },
        { role: 'me', text: '월넛 도어' },
      ],
      room_image: SMALL.base64,
      image_type: 'image/jpeg',
    });
    expect(M.shrinkPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ base64: 'QUJD' }),
      M.CHAT_EDGE
    );
    expect(M.CHAT_EDGE).toBe(512);
    expect(log()).toEqual([
      ['ai', OPENER],
      ['me', '월넛 도어'],
      ['ai', '좋아요. 상판은 어떤 느낌이 좋을까요?'],
    ]);
    expect(visible($('mkChatRow'))).toBe(true);
    expect(visible($('mkBriefMake'))).toBe(true);

    $('mkChatInput').value = '화이트 상판';
    $('mkChatSend').click();
    await M.chatting;
    expect(sent[1].body.messages.map((m) => m.text)).toEqual([
      OPENER,
      '월넛 도어',
      '좋아요. 상판은 어떤 느낌이 좋을까요?',
      '화이트 상판',
    ]);
    expect(M.shrinkPhoto).toHaveBeenCalledTimes(1); // 같은 사진은 한 번만 줄인다
    expect(draft().choices.chat).toHaveLength(5);

    $('mkBriefMake').click();
    await M.chatting;
    expect(sent[2].url).toBe(BASE + '/api/chat/brief');
    expect(sent[2].body.messages).toHaveLength(5);
    expect(visible($('mkBriefBox'))).toBe(true);
    expect($('mkBrief').value).toBe('월넛 도어, 화이트 상판');
    expect($('mkBriefMake').textContent).toBe('다시 정리하기');
    expect(draft().choices).toMatchObject({
      brief: '월넛 도어, 화이트 상판',
      briefDoor: 'walnut woodgrain',
      briefStyle: 'classic',
    });
    expect(M.buildBody([])).toMatchObject({
      customer_request: '월넛 도어, 화이트 상판',
      door_color: 'walnut woodgrain',
      design_style: 'classic',
    });

    // 고객이 고치면 정리가 고른 색 · 스타일은 버린다
    $('mkBrief').value = '오크 도어, 화이트 상판';
    $('mkBrief').dispatchEvent(new Event('input'));
    const body = M.buildBody([]);
    expect(body.customer_request).toBe('오크 도어, 화이트 상판');
    expect(body.door_color).toBeUndefined();
    expect(body.design_style).toBeUndefined();
  });

  // 11-23 대표님 「상담내역은 마이페이지에 정리본 자동저장 · 상담내용 초기화 버튼 · 다시 시도하면 초기화」
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const BRIEF_OK = { success: true, brief: '정수기 · 월넛 도어', saved: true };

  test('정리하기 — 상담 열쇠(uuid)를 같이 보내 마이페이지에 적고, 다시 정리해도 같은 열쇠 · 저장 안내', async () => {
    const { M, sent } = await chatLoad([{ success: true, reply: '네, 확인했어요.' }, BRIEF_OK, BRIEF_OK]);
    $('mkChatInput').value = '정수기 들어가요';
    $('mkChatSend').click();
    await M.chatting;
    expect(sent[0].body.note_key).toBeUndefined(); // 대화 한 마디에는 열쇠가 없다
    expect($('mkBriefSaved').hidden).toBe(true);
    $('mkBriefMake').click();
    await M.chatting;
    const key = sent[1].body.note_key;
    expect(key).toMatch(UUID);
    expect(draft().choices.noteKey).toBe(key);
    expect(visible($('mkBriefSaved'))).toBe(true);
    expect($('mkBriefSaved').querySelector('a').getAttribute('href')).toBe('me.html#consult-notes');
    $('mkBriefMake').click();
    await M.chatting;
    expect(sent[2].body.note_key).toBe(key);
  });

  test('저장하지 못했으면(saved 없음) 저장 안내를 띄우지 않는다', async () => {
    const { M } = await chatLoad([{ success: true, reply: '네.' }, { success: true, brief: '화이트 도어' }]);
    $('mkChatInput').value = '화이트';
    $('mkChatSend').click();
    await M.chatting;
    $('mkBriefMake').click();
    await M.chatting;
    expect(visible($('mkBriefBox'))).toBe(true);
    expect($('mkBriefSaved').hidden).toBe(true);
  });

  test('「상담 내용 초기화」 — 상담 · 참고 내용 · 열쇠를 비우고 첫 말로, 다음 정리는 새 열쇠', async () => {
    const { M, sent } = await chatLoad([
      { success: true, reply: '네, 확인했어요.' },
      BRIEF_OK,
      { success: true, reply: '네.' },
      BRIEF_OK,
    ]);
    expect($('mkChatReset').hidden).toBe(true); // 말하기 전에는 없다
    $('mkChatInput').value = '정수기';
    $('mkChatSend').click();
    await M.chatting;
    expect(visible($('mkChatReset'))).toBe(true);
    $('mkBriefMake').click();
    await M.chatting;
    const first = sent[1].body.note_key;
    $('mkChatReset').click();
    expect(log()).toEqual([['ai', OPENER]]);
    expect($('mkBriefBox').hidden).toBe(true);
    expect($('mkBriefSaved').hidden).toBe(true);
    expect($('mkBriefMake').hidden).toBe(true);
    expect($('mkChatReset').hidden).toBe(true);
    expect($('mkBrief').value).toBe('');
    expect(draft().choices).toMatchObject({ chat: [], brief: '', prompt: '', noteKey: '', briefDoor: '' });
    expect(M.buildBody([]).customer_request).toBeUndefined();
    $('mkChatInput').value = '식기세척기';
    $('mkChatSend').click();
    await M.chatting;
    expect(sent[2].body.messages).toEqual([
      { role: 'ai', text: OPENER },
      { role: 'me', text: '식기세척기' },
    ]);
    $('mkBriefMake').click();
    await M.chatting;
    expect(sent[3].body.note_key).toMatch(UUID);
    expect(sent[3].body.note_key).not.toBe(first);
  });

  test('사진 다시 선택 — 지난 상담 · 참고 내용을 비운다 (품목은 남는다)', async () => {
    const { M } = await chatLoad([{ success: true, reply: '네.' }, BRIEF_OK], { choices: { kind: 'wardrobe' } });
    $('mkChatInput').value = '드레스워시';
    $('mkChatSend').click();
    await M.chatting;
    $('mkBriefMake').click();
    await M.chatting;
    expect(draft().choices.brief).toBe('정수기 · 월넛 도어');
    $('mkClear').click();
    expect(draft().choices).toMatchObject({ kind: 'wardrobe', chat: [], brief: '', noteKey: '' });
    expect(draft().step).toBe('photo');
  });

  test('정리 전 생성 — 적은 글과 고객 답을 잇는다 (같은 글은 한 번)', async () => {
    const { M } = await chatLoad([], {
      choices: {
        kind: 'sink',
        prompt: '밝게',
        chat: [
          { role: 'ai', text: '도어 색은요?' },
          { role: 'me', text: '밝게' },
          { role: 'ai', text: '상판은요?' },
          { role: 'me', text: '화이트 상판' },
        ],
      },
    });
    expect(M.buildBody([]).customer_request).toBe('밝게 / 화이트 상판');
  });

  test('로그인 전에 적은 글 — 로그인하면 첫 답 칸에 들어가 있다 (보내지는 않는다)', async () => {
    const { sent } = await chatLoad([], { choices: { kind: 'sink', prompt: '오크 도어' } });
    expect($('mkChatInput').value).toBe('오크 도어');
    expect(log()).toEqual([['ai', OPENER]]);
    expect(sent).toEqual([]);
  });

  test('답을 못 받으면 — 보낸 말을 입력 칸으로 되돌리고 안내, 정리를 못 하면 참고 내용은 그대로', async () => {
    const { M } = await chatLoad([new Error('net'), { ok: false, status: 500, success: false }], {
      choices: {
        kind: 'sink',
        prompt: '밝게',
        chat: [
          { role: 'me', text: '밝게' },
          { role: 'ai', text: '도어 색은요?' },
        ],
      },
    });
    $('mkChatInput').value = '화이트';
    $('mkChatSend').click();
    await M.chatting;
    expect(log()).toHaveLength(2);
    expect($('mkChatInput').value).toBe('화이트');
    expect($('mkChatError').textContent).toBe('답을 받지 못했습니다. 잠시 뒤 다시 보내 주세요.');
    $('mkBriefMake').click();
    await M.chatting;
    expect($('mkChatError').textContent).toBe('정리하지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
    expect($('mkBriefBox').hidden).toBe(true);
    expect(draft().choices.brief).toBe('');
  });

  test('사진을 못 줄이면 글만 보낸다', async () => {
    const { M, sent } = await chatLoad([{ success: true, reply: '네' }], {
      choices: { kind: 'sink', prompt: '밝게' },
    });
    M.shrinkPhoto = jest.fn(async () => {
      throw new Error('canvas');
    });
    $('mkChatSend').click();
    await M.chatting;
    expect(sent[0].body).not.toHaveProperty('room_image');
    expect(log()).toHaveLength(3);
  });

  test('고객 말 12마디가 차면 — 입력 줄을 닫고 「정리하기」로 안내', async () => {
    const chat = [];
    for (let i = 0; i < 12; i++)
      chat.push({ role: 'me', text: 'm' + i }, { role: 'ai', text: 'a' + i });
    const { M } = await chatLoad([], { choices: { kind: 'sink', chat } });
    expect(M.CHAT_TURNS).toBe(12);
    expect($('mkChatRow').hidden).toBe(true);
    expect(visible($('mkChatNote'))).toBe(true);
    expect(visible($('mkBriefMake'))).toBe(true);
  });

  test('AI 답은 글자로만 그린다 (HTML 을 넣지 않는다)', async () => {
    const { M } = await chatLoad([{ success: true, reply: '<img src=x onerror=alert(1)>' }], {
      choices: { kind: 'sink', prompt: '<b>굵게</b>' },
    });
    $('mkChatSend').click();
    await M.chatting;
    expect($('mkChatLog').querySelector('img, b')).toBeNull();
    expect(log()[1][1]).toBe('<b>굵게</b>');
    expect(log()[2][1]).toBe('<img src=x onerror=alert(1)>');
  });
});
