/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, File, Event, setTimeout, URL, Blob */
/**
 * SEGAN 만들기 — ③ 참고 사진 (segan/index.html + segan/make.js, 고르기 창은 segan/shell.js SeganShell.sheet).
 *
 *   - 「참고 사진 고르기」 → 시트 두 칸: 시공사례(collection_posts — AI 연출컷 빼고 · 품목으로 거름 + 자체 시공 사진) ·
 *     테마(theme_images — approved · is_active). 최대 5장(워커 MAX_REFS), 장수 · 고른 차례 번호
 *   - 고른 사진은 단계 화면에 작은 그림 + 「빼기」, 이 기기에는 id · 주소 · 이름만 담는다 (그림 자료 없음)
 *   - 뒤로 가기는 시트만 닫는다 (단계 · 주소 그대로)
 *   - ?ref=<시공사례 id> · ?refs=a,b 로 열면 미리 담고 주소에서 뗀다
 *   - 보낼 때 긴 변 1600 JPEG 로 줄인다 (readRef)
 * 요청 본문(reference_images 의 모양 · 역할)은 segan-make-result.test.js.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const KEY = 'segan.make.draft.v1';
const SUPA = 'https://example.supabase.co';
const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'customer@example.com' } };
const PHOTO = { base64: 'QUJD', mime: 'image/jpeg', name: 'kitchen.jpg', width: 1200, height: 900 };
const uid = (n) => `${String(n).repeat(8)}-1111-4111-8111-${String(n).repeat(12)}`.slice(0, 36);
const POST = (n, over = {}) => ({
  id: uid(n),
  image_url: `${SUPA}/storage/v1/object/public/collection/p${n}.jpg`,
  region: '서울 성수',
  category: 'kitchen',
  source: 'upload',
  ...over,
});
const THEME = (n, over = {}) => ({
  id: uid(n),
  theme: 'flower',
  thumb_path: `${uid(n)}/thumb.jpg`,
  note: n === 7 ? '봄 꽃 색' : null,
  ...over,
});
const POSTS = [
  POST(1),
  POST(2, { category: 'builtin', region: '' }),
  POST(3, { source: 'ai_render' }), // 서버가 걸러야 하지만 와도 뺀다
  { id: 'not-a-uuid', image_url: `${SUPA}/x.jpg`, source: 'upload', category: 'kitchen' },
];
const THEMES = [THEME(7), THEME(8, { theme: 'nature' }), THEME(9, { thumb_path: null })];

/** 고른 값마다 [표, 거름] 을 남기는 가짜 Supabase — 어떤 사슬도 끝에서 { data, error } 로 풀린다 */
function fakeClient(opts, calls) {
  const tables = {
    credit_costs: { data: { credits: 20 }, error: null },
    appliance_models: { data: [], error: null },
    collection_posts: opts.postsError
      ? { data: null, error: { message: 'down' } }
      : { data: opts.posts || POSTS, error: null },
    theme_images: { data: opts.themes || THEMES, error: null },
  };
  return {
    auth: { getSession: async () => ({ data: { session: opts.session || null } }) },
    rpc: async () => ({ data: [{ scope: 'personal', balance: 1000, usable: true }], error: null }),
    from(table) {
      const q = { table, ops: [] };
      calls.push(q);
      const done = () => {
        const r = tables[table] || { data: null, error: null };
        const inOp = q.ops.find((o) => o[0] === 'in' && o[1] === 'id');
        if (inOp && r.data)
          return { data: r.data.filter((x) => inOp[2].includes(x.id)), error: null };
        return r;
      };
      const chain = new Proxy(
        {
          maybeSingle: async () => done(),
          single: async () => done(),
          then: (ok, bad) => Promise.resolve(done()).then(ok, bad),
        },
        {
          get(t, k) {
            if (k in t) return t[k];
            return (...args) => {
              q.ops.push([k, ...args]);
              return chain;
            };
          },
        }
      );
      return chain;
    },
  };
}

/** index.html 을 올리고 공용 테마 이름(js/reference-images.js) · 셸 · make.js 를 차례로 돌린다 */
async function load(options = {}) {
  const opts = { session: null, draft: null, url: '/segan/', ...options };
  const doc = new DOMParser().parseFromString(read('segan/index.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  window.history.replaceState(null, '', opts.url);
  sessionStorage.clear();
  if (opts.draft) sessionStorage.setItem(KEY, JSON.stringify(opts.draft));
  for (const k of ['SeganShell', 'SeganMake', 'DadamRefImages']) delete window[k];
  window.scrollTo = () => {};
  window.DADAM_CONFIG = { supabase: { url: SUPA, anonKey: 'anon' } };
  const calls = [];
  window.supabase = { createClient: () => fakeClient(opts, calls) };
  window.fetch = jest.fn(async (url) => {
    throw new Error('예상하지 못한 요청: ' + url);
  });
  for (const f of ['js/reference-images.js', 'segan/shell.js', 'segan/make.js']) (0, eval)(read(f));
  const M = window.SeganMake;
  M.go = jest.fn();
  M.readImage = jest.fn(async (file) => ({ ...PHOTO, name: file.name }));
  await window.SeganShell.ready;
  await M.ready;
  return { M, calls };
}

const $ = (id) => document.getElementById(id);
const visible = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) if (n.hidden) return false;
  return true;
};
const flush = () => new Promise((r) => setTimeout(r, 0));
/** 기다린다 — 시간으로 센다 (시험을 한꺼번에 돌리면 타이머가 늦게 돈다) */
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!fn()) throw new Error('기다린 상태가 오지 않았다');
}
const draft = () => JSON.parse(sessionStorage.getItem(KEY) || 'null');
const sheet = () => document.querySelector('.sg-sheet-wrap--sheet');
const tiles = () => [...sheet().querySelectorAll('[data-ref]')];
const tileIds = () => tiles().map((t) => t.getAttribute('data-ref'));
const pressedIds = () =>
  tiles()
    .filter((t) => t.getAttribute('aria-pressed') === 'true')
    .map((t) => t.getAttribute('data-ref'));
const inSheet = (sel) => sheet().querySelector(sel);
const tab = (name) => inSheet(`[data-reftab="${name}"]`);
const statics = (n) => n.map((s) => 's:' + s);

async function choose(name = 'kitchen.jpg') {
  const input = $('mkAlbumInput');
  const file = new File(['x'], name, { type: 'image/jpeg' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  await flush();
}

/** 사진 → 품목 → ③ 참고 사진 */
async function toRefs(opts) {
  const r = await load(opts);
  await choose();
  $('mkNext').click();
  $('mkNext').click();
  expect(window.location.hash).toBe('#refs');
  return r;
}

async function openPicker(M) {
  $('mkRefPick').click();
  await M.picking;
  await flush();
}

/** 창이 닫히고, 셸이 부른 뒤로 가기(표시 칸 되돌리기)까지 돌아왔다 — 다음 시험에 popstate 가 새지 않게 */
const settled = () =>
  until(() => !sheet() && !window.SeganShell.sheet.isSheetState(window.history.state));

afterEach(async () => {
  // 열어 둔 창은 닫고 기록 칸이 돌아올 때까지 기다린다
  const open = sheet();
  if (open) {
    open.querySelector('.sg-sheet-x').click();
    await settled();
  }
  jest.restoreAllMocks();
});

describe('③ 참고 사진 단계', () => {
  test('고르지 않아도 된다 — 빈 안내 · 0 / 5 · 생성 버튼 · 크레딧 줄은 이 단계에', async () => {
    await toRefs();
    expect(visible($('mkRefsTitle'))).toBe(true);
    expect($('mkRefsTitle').textContent).toBe('참고할 사진을 골라주세요');
    expect($('mkRefCount').textContent).toBe('0 / 5');
    expect($('mkRefs').textContent).toBe('고른 사진이 없습니다');
    expect($('mkRefPick').textContent).toBe('참고 사진 고르기');
    expect(visible($('mkRun'))).toBe(true);
    expect($('mkRun').disabled).toBe(false);
    expect($('mkCost').textContent).toBe('20 크레딧 차감 · 로그인하면 생성할 수 있습니다');
    // 참고 사진을 쓰지 않는다는 옛 안내는 없다 · 어떻게 쓰는지 적는다
    const text = document.querySelector('[data-step="refs"]').textContent;
    expect(text).toMatch(/최대 5장/);
    expect(text).toMatch(/시공사례 사진은 도어 색 · 마감 · 분위기를 참고/);
    expect(text).toMatch(/테마 사진은 색감만 빌려 추천안 한 장/);
    expect(read('segan/make.js')).not.toMatch(/참고 이미지 · 상세 요청은 앱에서 뺐다/);
  });

  test('사진이 없으면 #refs 로 와도 사진 단계로', async () => {
    await load();
    window.history.replaceState(null, '', '/segan/#refs');
    window.dispatchEvent(new window.PopStateEvent('popstate', { state: null }));
    expect(visible($('mkPhotoTitle'))).toBe(true);
    expect(window.location.hash).toBe('');
  });
});

describe('고르기 창 — 시공사례 · 테마, 최대 5장', () => {
  test('시공사례 칸(기본) — collection_posts 최신순 · AI 연출컷 빼고 · 고른 품목(싱크대 → kitchen) + 자체 시공 사진', async () => {
    const { M, calls } = await toRefs();
    await openPicker(M);
    expect(sheet()).not.toBeNull();
    expect(sheet().querySelector('.sg-sheet-title').textContent).toBe('참고 사진 고르기');
    expect(tab('case').getAttribute('aria-selected')).toBe('true');
    expect(tab('theme').getAttribute('aria-selected')).toBe('false');
    const q = calls.find((c) => c.table === 'collection_posts');
    expect(q.ops).toEqual([
      ['select', 'id, image_url, region, category, source'],
      ['neq', 'source', 'ai_render'],
      ['order', 'created_at', { ascending: false }],
      ['limit', 300],
    ]);
    // 첫 12장 — DB 사례(kitchen) 하나 + 자체 시공 사진(kitchen) 11장. builtin · AI 연출컷 · id 이상한 줄은 없다
    expect(tileIds()).toEqual(
      ['c:' + uid(1)].concat(
        statics([
          'kitchen-n1-1',
          'kitchen-n1-2',
          'kitchen-n1-3',
          'kitchen-n1-4',
          'kitchen-n3-2',
          'kitchen-n3-3',
          'kitchen-n4-1',
          'kitchen-n6-1',
          'kitchen-n6-2',
          'kitchen-n6-3',
          'kitchen-n7-1',
        ])
      )
    );
    expect(inSheet('[data-pick-hint]').textContent).toBe('싱크대 사례 12 / 15');
    expect(tiles()[0].textContent).toBe('다담가구 · 서울 성수');
    // 자체 시공 사진은 가벼운 사본으로 그린다
    expect(tiles()[1].querySelector('.mk-pick-img').getAttribute('style')).toContain(
      '../app/portfolio/display/kitchen-n1-1.jpg'
    );
    // 더 보기 — 나머지
    inSheet('[data-pick-more]').click();
    expect(tiles()).toHaveLength(15);
    expect(inSheet('[data-pick-more]').hidden).toBe(true);
    expect(inSheet('[data-pick-hint]').textContent).toBe('싱크대 사례 15 / 15');
  });

  test('붙박이장 — builtin 사례만 (자체 시공 사진 하나 · DB 하나)', async () => {
    const { M } = await load();
    await choose();
    $('mkNext').click();
    document.querySelector('[data-kind="wardrobe"]').click();
    $('mkNext').click();
    await openPicker(M);
    expect(tileIds()).toEqual(['c:' + uid(2), 's:funiture-n4-1']);
    expect(tiles()[0].textContent).toBe('다담가구');
  });

  test('시공사례를 못 읽으면 자체 시공 사진만 — 창을 다시 열면 다시 읽는다', async () => {
    const { M, calls } = await toRefs({ postsError: true });
    await openPicker(M);
    expect(tileIds()[0]).toBe('s:kitchen-n1-1');
    sheet().querySelector('.sg-sheet-x').click();
    await settled();
    await openPicker(M);
    expect(calls.filter((c) => c.table === 'collection_posts')).toHaveLength(2);
  });

  test('테마 칸 — theme_images (approved · is_active) 썸네일 공개 주소 · 테마 이름(공용 파일)', async () => {
    const { M, calls } = await toRefs();
    await openPicker(M);
    tab('theme').click();
    await M.picking;
    await until(() => tiles().length && tileIds()[0].startsWith('t:'));
    expect(tab('theme').getAttribute('aria-selected')).toBe('true');
    const q = calls.find((c) => c.table === 'theme_images');
    expect(q.ops).toEqual([
      ['select', 'id, theme, thumb_path, note'],
      ['eq', 'status', 'approved'],
      ['eq', 'is_active', true],
      ['order', 'created_at', { ascending: false }],
      ['limit', 300],
    ]);
    expect(tileIds()).toEqual(['t:' + uid(7), 't:' + uid(8)]); // 썸네일 없는 줄은 뺀다
    expect(tiles().map((t) => t.textContent)).toEqual(['꽃', '자연']);
    expect(tiles()[0].querySelector('.mk-pick-img').getAttribute('style')).toContain(
      `${SUPA}/storage/v1/object/public/theme-images/${uid(7)}/thumb.jpg`
    );
    expect(inSheet('[data-pick-about]').textContent).toMatch(/색감만 빌려 추천안 한 장/);
  });

  test('최대 5장 — 장수 · 고른 차례 번호, 여섯째는 안내만, 누르면 빠진다 (그림판은 다시 그리지 않는다)', async () => {
    const { M } = await toRefs();
    await openPicker(M);
    const grid = inSheet('[data-pick-grid]');
    const first = tiles()[0];
    tiles()
      .slice(0, 5)
      .forEach((t) => t.click());
    expect(pressedIds()).toHaveLength(5);
    expect(inSheet('[data-pick-count]').textContent).toBe('5 / 5 선택');
    expect(tiles()[2].querySelector('.mk-pick-no').textContent).toBe('3');
    tiles()[5].click();
    expect(pressedIds()).toHaveLength(5);
    expect(tiles()[5].getAttribute('aria-pressed')).toBe('false');
    expect(visible(inSheet('[data-pick-msg]'))).toBe(true);
    expect(inSheet('[data-pick-msg]').textContent).toBe('최대 5장까지 고를 수 있습니다');
    // 하나 빼면 다시 고를 수 있다 — 번호가 당겨진다
    tiles()[0].click();
    expect(inSheet('[data-pick-msg]').hidden).toBe(true);
    expect(tiles()[1].querySelector('.mk-pick-no').textContent).toBe('1');
    tiles()[5].click();
    expect(pressedIds()).toHaveLength(5);
    expect(M.state.refs.map((r) => r.id).slice(-1)).toEqual([tileIds()[5]]);
    expect(inSheet('[data-pick-grid]')).toBe(grid);
    expect(tiles()[0]).toBe(first);
    // 시공사례 + 테마 섞어서도 5장까지
    tab('theme').click();
    await M.picking;
    await until(() => tileIds()[0] && tileIds()[0].startsWith('t:'));
    tiles()[0].click();
    expect(M.state.refs).toHaveLength(5);
    expect(inSheet('[data-pick-msg]').textContent).toBe('최대 5장까지 고를 수 있습니다');
  });

  test('완료 → 단계 화면에 작은 그림 · 「빼기」, 이 기기에는 id · 주소 · 이름만 (테마는 설명까지)', async () => {
    const { M } = await toRefs();
    await openPicker(M);
    tiles()[0].click();
    tab('theme').click();
    await M.picking;
    await until(() => tileIds()[0] && tileIds()[0].startsWith('t:'));
    tiles()[0].click();
    inSheet('[data-pick-done]').click();
    await settled();
    expect($('mkRefCount').textContent).toBe('2 / 5');
    const figs = [...$('mkRefs').querySelectorAll('.mk-ref')];
    expect(figs.map((f) => f.querySelector('figcaption').textContent)).toEqual([
      '시공사례 · 다담가구 · 서울 성수',
      '테마 · 꽃',
    ]);
    const x = [...$('mkRefs').querySelectorAll('[data-unref]')];
    expect(x.map((b) => b.textContent)).toEqual(['빼기', '빼기']);
    expect(x[1].getAttribute('aria-label')).toBe('테마 꽃 빼기');
    expect(draft().refs).toEqual([
      {
        id: 'c:' + uid(1),
        src: `${SUPA}/storage/v1/object/public/collection/p1.jpg`,
        label: '다담가구 · 서울 성수',
      },
      {
        id: 't:' + uid(7),
        src: `${SUPA}/storage/v1/object/public/theme-images/${uid(7)}/thumb.jpg`,
        label: '꽃',
        note: '봄 꽃 색',
      },
    ]);
    // 빼기
    x[0].click();
    expect($('mkRefCount').textContent).toBe('1 / 5');
    expect(draft().refs.map((r) => r.id)).toEqual(['t:' + uid(7)]);
    // 다시 열면 고른 것이 눌려 있다
    await openPicker(M);
    tab('theme').click();
    await until(() => tileIds()[0] && tileIds()[0].startsWith('t:'));
    expect(pressedIds()).toEqual(['t:' + uid(7)]);
  });

  test('뒤로 가기 — 시트만 닫히고 ③ 그대로 (단계 · 주소 · 고른 것)', async () => {
    const { M } = await toRefs();
    await openPicker(M);
    tiles()[0].click();
    window.history.back();
    await settled();
    await until(() => !window.SeganShell.sheet.isSheetState(window.history.state));
    await flush();
    expect(window.location.hash).toBe('#refs');
    expect(visible($('mkRefsTitle'))).toBe(true);
    expect(window.history.state).toEqual({ mk: 'refs' });
    expect($('mkRefCount').textContent).toBe('1 / 5');
  });
});

describe('?ref= · ?refs= — 시공사례에서 「이 스타일로 연출컷」', () => {
  test('?ref=<시공사례 id> — 미리 담고 주소에서 뗀다, 사진 단계에 안내', async () => {
    const { calls, M } = await load({ url: `/segan/?ref=${uid(1)}` });
    const q = calls.find((c) => c.table === 'collection_posts');
    expect(q.ops).toEqual([
      ['select', 'id, image_url, region, category, source'],
      ['in', 'id', [uid(1)]],
    ]);
    expect(M.state.refs).toEqual([
      {
        id: 'c:' + uid(1),
        src: `${SUPA}/storage/v1/object/public/collection/p1.jpg`,
        label: '다담가구 · 서울 성수',
      },
    ]);
    expect(window.location.search).toBe('');
    expect(visible($('mkRefNote'))).toBe(true);
    expect($('mkRefNote').textContent).toBe(
      '참고 사진 1장을 담아 두었습니다 · 3 참고 사진에서 바꿀 수 있습니다'
    );
    expect(draft().refs.map((r) => r.id)).toEqual(['c:' + uid(1)]);
    // ③ 에 와 있다
    await choose();
    $('mkNext').click();
    $('mkNext').click();
    expect($('mkRefCount').textContent).toBe('1 / 5');
  });

  test('?refs=a,b — 자체 시공 사진은 파일 이름, AI 연출컷 · 없는 글 · 모르는 이름은 건너뛴다, 다른 주소 칸은 남긴다', async () => {
    const { M } = await load({
      url: `/segan/?refs=kitchen-n1-1,${uid(3)},${uid(5)},nope,${uid(1)}&utm=x#kind`,
    });
    expect(M.state.refs.map((r) => r.id)).toEqual(['s:kitchen-n1-1', 'c:' + uid(1)]);
    expect(M.state.refs[0]).toEqual({
      id: 's:kitchen-n1-1',
      src: '../app/portfolio/kitchen-n1-1.jpg',
      label: '다담가구 · 서울 논현',
    });
    expect(window.location.search).toBe('?utm=x');
  });

  test('담아 둔 것에 더한다 — 같은 것은 하나, 5장까지', async () => {
    const have = ['kitchen-n1-1', 'kitchen-n1-2', 'kitchen-n1-3', 'kitchen-n1-4'].map((s) => ({
      id: 's:' + s,
      src: `../app/portfolio/${s}.jpg`,
      label: 'x',
    }));
    const { M } = await load({
      url: `/segan/?ref=kitchen-n1-1&ref=${uid(1)}&refs=kitchen-n7-1`,
      draft: { v: 1, step: 'photo', choices: {}, photo: null, refs: have },
    });
    expect(M.state.refs.map((r) => r.id)).toEqual([
      's:kitchen-n1-1',
      's:kitchen-n1-2',
      's:kitchen-n1-3',
      's:kitchen-n1-4',
      'c:' + uid(1),
    ]);
  });
});

describe('이 기기에 담기 — 로그인을 다녀와도 고른 참고 사진이 남는다', () => {
  test('로그인 전 생성 → id · 주소만 담고 로그인으로 → 돌아오면 ③ 에 그대로', async () => {
    const first = await toRefs();
    await openPicker(first.M);
    tiles()[0].click();
    tiles()[1].click();
    inSheet('[data-pick-done]').click();
    await settled();
    $('mkRun').click();
    await flush();
    expect(first.M.go).toHaveBeenCalledWith('../login.html?redirect=segan%2Findex.html');
    const saved = draft();
    expect(saved.step).toBe('refs');
    expect(saved.refs.map((r) => r.id)).toEqual(['c:' + uid(1), 's:kitchen-n1-1']);
    expect(Object.keys(saved.refs[0]).sort()).toEqual(['id', 'label', 'src']);
    expect(window.fetch).not.toHaveBeenCalled();

    const back = await load({ session: SESSION, draft: saved });
    expect(visible($('mkRefsTitle'))).toBe(true);
    expect(back.M.state.refs.map((r) => r.id)).toEqual(['c:' + uid(1), 's:kitchen-n1-1']);
    expect($('mkRefCount').textContent).toBe('2 / 5');
    expect($('mkRefs').querySelectorAll('.mk-ref')).toHaveLength(2);
    expect($('mkRefs').querySelectorAll('.mk-ref-img')[1].getAttribute('style')).toContain(
      'display/kitchen-n1-1.jpg'
    );
  });

  test('다시 선택(사진 버리기) — 참고 사진 · 고른 값은 남는다', async () => {
    const refs = [{ id: 's:kitchen-n1-1', src: '../app/portfolio/kitchen-n1-1.jpg', label: 'a' }];
    await load({ draft: { v: 1, step: 'refs', photo: PHOTO, choices: { kind: 'shoe' }, refs } });
    expect(visible($('mkRefsTitle'))).toBe(true);
    document.querySelector('[data-goto="photo"]').click();
    $('mkClear').click();
    expect(draft().photo).toBeNull();
    expect(draft().refs).toEqual(refs);
    expect(draft().choices.kind).toBe('shoe');
    expect(visible($('mkRefNote'))).toBe(true);
  });

  test('담아 둔 값이 이상하면 버린다 — 모르는 id · 위험한 주소 · 다섯 장 넘게 · 같은 id', async () => {
    const ok = (s) => ({ id: 's:' + s, src: `../app/portfolio/${s}.jpg`, label: s });
    const { M } = await load({
      draft: {
        v: 1,
        step: 'photo',
        choices: {},
        refs: [
          { id: 'x:1', src: '../app/portfolio/a.jpg', label: 'a' },
          { id: 'c:' + uid(1), src: 'javascript:alert(1)', label: 'b' },
          { id: 'c:' + uid(2), src: 'https://e.example/a.jpg") ; x(', label: 'c' },
          ok('kitchen-n1-1'),
          ok('kitchen-n1-1'),
          { ...ok('kitchen-n1-2'), note: '시공사례에는 설명을 담지 않는다' },
          ok('kitchen-n1-3'),
          ok('kitchen-n1-4'),
          ok('kitchen-n3-2'),
          ok('kitchen-n3-3'),
        ],
      },
    });
    expect(M.state.refs.map((r) => r.id)).toEqual([
      's:kitchen-n1-1',
      's:kitchen-n1-2',
      's:kitchen-n1-3',
      's:kitchen-n1-4',
      's:kitchen-n3-2',
    ]);
    expect(M.state.refs[1]).not.toHaveProperty('note');
  });
});

describe('보내기 전 줄이기 — 방 사진과 같은 긴 변 1600 JPEG', () => {
  test('fitEdge — 줄이기만 한다', async () => {
    const { M } = await load();
    expect(M.REF_EDGE).toBe(1600);
    expect(M.fitEdge(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 });
    expect(M.fitEdge(1200, 2400, 1600)).toEqual({ w: 800, h: 1600 });
    expect(M.fitEdge(320, 200, 1600)).toEqual({ w: 320, h: 200 });
  });

  test('readRef — 주소에서 받아 캔버스로 1600 JPEG (흰 바탕), base64 만 돌려준다', async () => {
    const { M } = await load();
    window.fetch = jest.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['x'], { type: 'image/png' }),
    }));
    const realURL = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = jest.fn(() => 'blob:fake');
    URL.revokeObjectURL = jest.fn();
    const RealImage = window.Image;
    window.Image = class {
      set src(v) {
        this.url = v;
        this.naturalWidth = 3200;
        this.naturalHeight = 1600;
        setTimeout(() => this.onload());
      }
    };
    const ctx = { fillRect: jest.fn(), drawImage: jest.fn(), fillStyle: '' };
    const canvas = {
      getContext: () => ctx,
      toDataURL: jest.fn(() => 'data:image/jpeg;base64,SMALL'),
    };
    const make = document.createElement.bind(document);
    jest
      .spyOn(document, 'createElement')
      .mockImplementation((tag) => (tag === 'canvas' ? canvas : make(tag)));
    try {
      const out = await M.readRef({
        id: 's:kitchen-n1-1',
        src: '../app/portfolio/kitchen-n1-1.jpg',
      });
      expect(out).toEqual({ base64: 'SMALL', mimeType: 'image/jpeg' });
      expect(window.fetch).toHaveBeenCalledWith('../app/portfolio/kitchen-n1-1.jpg', {
        cache: 'force-cache',
      });
      expect([canvas.width, canvas.height]).toEqual([1600, 800]);
      expect(ctx.fillStyle).toBe('#fff');
      expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
      expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.9);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
      // 받지 못하면 실패로 — 그 한 장만 빼고 만든다 (segan-make-result.test.js)
      window.fetch = jest.fn(async () => ({ ok: false, status: 404 }));
      await expect(M.readRef({ id: 's:x', src: '../app/portfolio/x.jpg' })).rejects.toThrow();
    } finally {
      URL.createObjectURL = realURL.create;
      URL.revokeObjectURL = realURL.revoke;
      window.Image = RealImage;
    }
  });
});

describe('정본과 같은 값', () => {
  test('최대 장수 = generate-api MAX_REFS, 역할 = 워커가 받는 둘(style · theme)', async () => {
    const { M } = await load();
    const worker = read('workers/generate-api/src/worker.js');
    expect(M.MAX_REFS).toBe(Number(worker.match(/const MAX_REFS = (\d+);/)[1]));
    expect(worker).toMatch(/r\.role === 'theme' \? 'theme' : 'style'/);
  });

  test('자체 시공 사진 = segan/collection.js STATIC (사진 · 지역 · 차례), 분류 = ai-design.html CASE_STATIC', async () => {
    const { M } = await load();
    const grab = (src, name) =>
      [
        ...src
          .match(new RegExp(`var ${name} = \\[([\\s\\S]*?)\\];`))[1]
          .matchAll(/image_url: '([^']+)', region: '([^']+)'(?:, category: '([^']+)')?/g),
      ].map((m) => ({ image_url: m[1], region: m[2], category: m[3] }));
    const app = grab(read('segan/collection.js'), 'STATIC');
    const ai = grab(read('ai-design.html'), 'CASE_STATIC');
    expect(app.length).toBe(15);
    expect(M.CASE_STATIC.map((r) => [r.image_url, r.region])).toEqual(
      app.map((r) => [r.image_url, r.region])
    );
    expect(M.CASE_STATIC.map((r) => [r.image_url.replace('../', ''), r.category])).toEqual(
      ai.map((r) => [r.image_url, r.category])
    );
    for (const r of M.CASE_STATIC) {
      const stem = r.image_url.replace(/^.*\//, '').replace(/\.jpg$/, '');
      expect(fs.existsSync(path.join(ROOT, 'app/portfolio/display', stem + '.jpg'))).toBe(true);
    }
  });

  test('품목 → 시공사례 분류 = ai-design.html KINDS[].collection', async () => {
    const { M } = await load();
    const block = read('ai-design.html').match(/var KINDS = \[([\s\S]*?)\];/)[1];
    const ai = {};
    for (const m of block.matchAll(/key: '(\w+)',[\s\S]*?collection: \[([^\]]*)\]/g))
      ai[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(Object.keys(ai)).toHaveLength(10);
    expect(M.CASE_KINDS).toEqual(ai);
  });

  test('index.html 이 공용 테마 파일(js/reference-images.js)을 싣는다', () => {
    expect(read('segan/index.html')).toMatch(
      /<script src="\.\.\/js\/reference-images\.js\?v=\d+"><\/script>/
    );
  });
});
