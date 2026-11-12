/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout */
/**
 * SEGAN 마이페이지 「좋아요」 (segan/me.js #likes + segan/collection-view.js).
 *
 *   - 「내 것」 묶음의 둘째 줄 (내 연출컷 다음) → 하위 화면 #likes
 *   - RPC collection_my_likes(p_limit 30, p_before = 마지막 liked_at) — 화면을 처음 열 때 읽는다, 「더 보기」 로 다음 쪽
 *   - 타일 · 사진 보기 · ♡ 는 시공사례와 같다 — ♡ 를 풀고 닫으면 목록에서 뺀다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION = { access_token: 'tok-1', user: { id: ME, email: 'owner@example.com' } };
const uid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

/** 내 좋아요 줄 (좋아한 때 최신순) — 0: 업체 있는 직접 올린 사진, 1: 업체 없는 AI 연출컷, 나머지 차례대로 */
function liked(n) {
  return Array.from({ length: n }, (_, i) => ({
    post_id: uid(i),
    liked_at: new Date(Date.UTC(2026, 10, 7, 12) - i * 60000).toISOString(),
    image_url: `https://example.supabase.co/storage/v1/object/public/collection/l${i}.jpg`,
    category: 'kitchen',
    source: i === 1 ? 'ai_render' : 'upload',
    place_label: i === 1 ? '싱크대' : `대구 북구 · 주방 ${i}`,
    door_color: i === 1 ? '월넛' : null,
    like_count: 3,
    company_name: i === 0 ? '다담 협력 주방' : null,
    company_kind: i === 0 ? 'partner' : null,
    created_at: '2026-11-01T00:00:00Z',
  }));
}

async function load(options = {}) {
  const opts = { url: '/segan/me.html#likes', likes: liked(3), rpcFail: false, ...options };
  window.history.replaceState(null, '', opts.url);
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of ['SeganShell', 'SeganMe', 'SeganPostView', 'SeganMake', 'SeganPartner'])
    delete window[k];
  delete window.matchMedia;
  window.DADAM_CONFIG = { supabase: { url: 'https://example.supabase.co', anonKey: 'anon' } };
  const calls = { rpc: [], queries: [] };
  const fails = { left: opts.rpcFail ? 1 : 0 };
  window.supabase = {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: SESSION } }),
        signOut: async () => {},
      },
      rpc: async (name, args) => {
        calls.rpc.push([name, args]);
        if (name !== 'collection_my_likes') return { data: null, error: { message: 'x' } };
        if (fails.left > 0) {
          fails.left--;
          return { data: null, error: { message: 'timeout' } };
        }
        const list = opts.likes
          .filter((r) => !args.p_before || r.liked_at < args.p_before)
          .slice(0, args.p_limit);
        return { data: list, error: null };
      },
      from: (table) => {
        const q = { table, op: 'select', filters: [], row: null };
        calls.queries.push(q);
        const out = () => {
          if (table === 'profiles') return { data: { tier: 'standard', name: '' }, error: null };
          if (table === 'consultations') return { data: [], error: null };
          return { data: null, error: null };
        };
        const chain = {
          select: () => chain,
          order: () => chain,
          limit: () => chain,
          in: (c, v) => {
            q.filters.push(['in', c, v]);
            return chain;
          },
          eq: (c, v) => {
            q.filters.push(['eq', c, v]);
            return chain;
          },
          insert: (row) => {
            q.op = 'insert';
            q.row = row;
            return chain;
          },
          delete: () => {
            q.op = 'delete';
            return chain;
          },
          maybeSingle: async () => out(),
          then: (resolve, reject) => Promise.resolve(out()).then(resolve, reject),
        };
        return chain;
      },
    }),
  };
  window.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  for (const f of ['segan/collection-view.js', 'segan/shell.js', 'segan/me.js']) (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganMe.ready;
  await flush();
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const tiles = () => [...document.querySelectorAll('#meLikes .cl-tile')];
const likeCalls = (calls) => calls.rpc.filter((c) => c[0] === 'collection_my_likes');
const sheet = () => document.querySelector('.sg-sheet-wrap--sheet .sg-sheet');
const facts = () =>
  [...sheet().querySelectorAll('.pv-facts > div')].map((d) => [
    d.querySelector('dt').textContent,
    d.querySelector('dd').textContent,
  ]);

afterEach(async () => {
  while (window.SeganShell && window.SeganShell.sheet.current()) {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
  }
  jest.restoreAllMocks();
});

describe('메뉴 — 「내 것」 에 좋아요', () => {
  test('내 연출컷 다음 줄 · #likes, me.html 이 collection-view.js 를 싣는다', async () => {
    await load({ url: '/segan/me.html' });
    const rows = [...document.querySelectorAll('#meGroupMine li:not([hidden]) .sg-row')];
    expect(rows.slice(0, 2).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['내 연출컷', 'renders.html'],
      ['좋아요', '#likes'],
    ]);
    expect(read('segan/me.html')).toMatch(
      /<script src="collection-view\.js\?v=\d+" defer><\/script>/
    );
    expect(window.SeganMe.SCREENS.likes).toEqual({ title: '좋아요', section: 'meLikeSection' });
  });

  test('메뉴에서는 묻지 않는다 — 누르면 그 화면에서 처음 한 번 (p_limit 30)', async () => {
    const calls = await load({ url: '/segan/me.html' });
    expect(likeCalls(calls)).toEqual([]);
    [...document.querySelectorAll('#meHub a[data-me-go="likes"]')][0].click();
    await flush();
    expect($('main').getAttribute('data-me-screen')).toBe('likes');
    expect($('meTitle').textContent).toBe('좋아요');
    expect(likeCalls(calls)).toEqual([['collection_my_likes', { p_limit: 30 }]]);
    expect(tiles()).toHaveLength(3);
    // 다른 화면에 갔다 와도 다시 묻지 않는다
    window.history.back();
    await flush();
    [...document.querySelectorAll('#meHub a[data-me-go="likes"]')][0].click();
    await flush();
    expect(likeCalls(calls)).toHaveLength(1);
  });
});

describe('좋아요 화면 — 시공사례와 같은 칸 · 30장씩', () => {
  test('타일은 시공사례와 같다 (cl-grid · 단추 + lazy img · AI 표시)', async () => {
    await load();
    expect($('meLikes').classList.contains('cl-grid')).toBe(true);
    const img = tiles()[0].querySelector('img');
    expect(img.getAttribute('src')).toContain('l0.jpg');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['400', '400']);
    expect(tiles()[1].querySelector('.cl-mark').textContent).toBe('AI');
    expect($('meLikeMore').hidden).toBe(true); // 3장 — 한 쪽이 덜 찼다
    expect($('meLikeEmpty').hidden).toBe(true);
  });

  test('다음 쪽 — 마지막 liked_at 을 p_before 로, 덜 찬 쪽이면 끝', async () => {
    const all = liked(45);
    const calls = await load({ likes: all });
    expect(tiles()).toHaveLength(30);
    expect($('meLikeMore').hidden).toBe(false);
    expect($('meLikeMore').textContent).toBe('더 보기');
    $('meLikeMore').click();
    await flush();
    expect(likeCalls(calls)).toEqual([
      ['collection_my_likes', { p_limit: 30 }],
      ['collection_my_likes', { p_limit: 30, p_before: all[29].liked_at }],
    ]);
    expect(tiles()).toHaveLength(45);
    expect(tiles()[44].querySelector('img').getAttribute('src')).toContain('l44.jpg');
    expect($('meLikeMore').hidden).toBe(true);
  });

  test('딱 30장이면 한 번 더 묻고 빈 쪽에서 끝난다', async () => {
    const calls = await load({ likes: liked(30) });
    $('meLikeMore').click();
    await flush();
    expect(likeCalls(calls)).toHaveLength(2);
    expect(tiles()).toHaveLength(30);
    expect($('meLikeMore').hidden).toBe(true);
    expect($('meLikeEmpty').hidden).toBe(true);
  });

  test('없으면 안내 글', async () => {
    await load({ likes: [] });
    expect(tiles()).toHaveLength(0);
    expect($('meLikeEmpty').hidden).toBe(false);
    expect($('meLikeEmpty').textContent).toContain('아직 좋아요한 사진이 없습니다');
    expect($('meLikeMore').hidden).toBe(true);
  });

  test('못 읽으면 알리고 「다시 불러오기」', async () => {
    const calls = await load({ rpcFail: true });
    expect($('meLikeState').textContent).toBe('좋아요를 불러오지 못했습니다.');
    expect($('meLikeMore').hidden).toBe(false);
    expect($('meLikeMore').textContent).toBe('다시 불러오기');
    $('meLikeMore').click();
    await flush();
    expect(likeCalls(calls)).toHaveLength(2);
    expect(tiles()).toHaveLength(3);
    expect($('meLikeState').textContent).toBe('');
  });
});

describe('사진 보기 — 시공사례와 같은 시트', () => {
  test('누르면 장소 · 색상 · 업체, ♡ 눌림 · 수, 이 스타일로 연출컷', async () => {
    await load();
    tiles()[0].click();
    await flush();
    expect(sheet().querySelector('.sg-sheet-title').textContent).toBe('시공사례');
    expect(facts()).toEqual([
      ['장소', '대구 북구 · 주방 0'],
      ['업체', '다담 협력 주방'],
    ]);
    const like = sheet().querySelector('.pv-like');
    expect(like.getAttribute('aria-pressed')).toBe('true');
    expect(like.querySelector('.pv-count').textContent).toBe('3');
    expect(sheet().querySelector('a.pv-make').getAttribute('href')).toBe('make.html?ref=' + uid(0));
  });

  test('업체 없는 AI 연출컷 — 업체 「AI 연출컷」, 연출컷 단추 없음', async () => {
    await load();
    tiles()[1].click();
    await flush();
    expect(sheet().querySelector('.sg-sheet-title').textContent).toBe('AI 연출컷');
    expect(facts()).toEqual([
      ['장소', '싱크대'],
      ['색상', '월넛'],
      ['업체', 'AI 연출컷'],
    ]);
    expect(sheet().querySelector('a.pv-make')).toBeNull();
  });

  test('♡ 를 풀면 delete eq post_id, 닫으면 목록에서 뺀다 · 다시 누르고 닫으면 남는다', async () => {
    const calls = await load();
    tiles()[0].click();
    await flush();
    sheet().querySelector('.pv-like').click();
    await flush();
    const del = calls.queries.filter((q) => q.table === 'collection_likes' && q.op === 'delete');
    expect(del.map((q) => q.filters)).toEqual([[['eq', 'post_id', uid(0)]]]);
    expect(tiles()).toHaveLength(3); // 열려 있는 동안은 그대로
    sheet().querySelector('.sg-sheet-x').click();
    await flush();
    expect(tiles()).toHaveLength(2);
    expect(tiles()[0].querySelector('img').getAttribute('src')).toContain('l1.jpg');
    // 다음 타일 — 풀었다가 다시 누르고 닫으면 남는다 (insert { user_id, post_id })
    tiles()[0].click();
    await flush();
    sheet().querySelector('.pv-like').click();
    await flush();
    sheet().querySelector('.pv-like').click();
    await flush();
    const ins = calls.queries.filter((q) => q.table === 'collection_likes' && q.op === 'insert');
    expect(ins.map((q) => q.row)).toEqual([{ user_id: ME, post_id: uid(1) }]);
    sheet().querySelector('.sg-sheet-x').click();
    await flush();
    expect(tiles()).toHaveLength(2);
  });

  test('다 빼면 안내 글', async () => {
    await load({ likes: liked(1) });
    tiles()[0].click();
    await flush();
    sheet().querySelector('.pv-like').click();
    await flush();
    sheet().querySelector('.sg-sheet-x').click();
    await flush();
    expect(tiles()).toHaveLength(0);
    expect($('meLikeEmpty').hidden).toBe(false);
  });
});
