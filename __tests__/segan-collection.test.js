/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, jest, setTimeout */
/**
 * SEGAN 「시공사례」 탭 (segan/collection.html + segan/collection.js + segan/collection-view.js).
 *
 *   - 사진을 인스타그램처럼 정사각 칸으로 — 폰 3칸 · PC(1024px~) 4칸, 칸 사이 2~3px
 *   - collection_posts 공개 칸만 최신순 · 24줄 키셋, 업체 이름은 RPC collection_post_companies,
 *     로그인했으면 이 쪽의 내 좋아요 (collection_likes post_id). DB 사례 뒤에 같은 STATIC
 *   - 누르면 사진 보기 시트(SeganShell.sheet) — 장소 · 색상 · 업체 · 좋아요(♡ aria-pressed) · 이 스타일로 연출컷
 *   - 업체: 업체 이름 → (없고) AI 연출컷이면 「AI 연출컷」 → 아니면 줄 없음. 자체 시공 사진은 「다담가구」
 *   - 좋아요: 로그인 — insert { user_id, post_id } · delete eq post_id, 로그인 전 — 가운데 작은 창으로 로그인
 *   - 다운로드 단추 · 링크 없음, 관리자 「내리기」 없음. 자재 칸은 뺐다 (/material → /segan/blog)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION = { access_token: 'tok', user: { id: ME } };
const CO_P = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COLS = 'id,image_url,place_label,door_color,company_id,like_count,source,created_at';
const uid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

/**
 * DB 줄 (최신순) — 0: 직접 올린 사진 · 장소 · 업체 있음, 1: AI 연출컷 · 업체 없음, 2: 직접 올린 사진 · 업체 없음,
 * 3: AI 연출컷 · 업체 있음, 그 뒤는 차례대로
 */
function rows(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: uid(i),
    image_url: `https://example.supabase.co/storage/v1/object/public/collection/p${i}.jpg`,
    place_label: i === 1 ? '싱크대' : i % 5 === 2 ? '' : `인천 연수구 · 주방 ${i}`,
    door_color: i === 1 ? '오크' : i === 0 ? '화이트' : '',
    company_id: i === 0 || i === 3 ? CO_P : null,
    like_count: i === 0 ? 4 : 0,
    source: i % 4 === 1 || i === 3 ? 'ai_render' : 'upload',
    created_at: new Date(Date.UTC(2026, 10, 7, 12) - i * 60000).toISOString(),
  }));
}

/** opts.db: DB 줄 · session · liked: 내가 좋아한 id · companies: id → 업체 · noSupabase · postsFail · insertError · deleteError */
async function load(options = {}) {
  const opts = {
    db: rows(30),
    session: null,
    liked: [],
    companies: {
      [uid(0)]: { company_name: '다담 협력 주방', company_kind: 'partner' },
      [uid(3)]: { company_name: '다담 공장', company_kind: 'hq' },
    },
    noSupabase: false,
    postsFail: false,
    insertError: null,
    deleteError: null,
    ...options,
  };
  const doc = new DOMParser().parseFromString(read('segan/collection.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  window.history.replaceState(null, '', '/segan/collection.html');
  for (const k of ['SeganShell', 'SeganCollection', 'SeganPostView']) delete window[k];
  window.DADAM_CONFIG = { supabase: { url: 'https://example.supabase.co', anonKey: 'anon' } };
  const liked = new Set(opts.liked);
  const calls = { queries: [], rpc: [], auth: 0 };
  const answer = (q) => {
    if (q.table === 'collection_posts') {
      if (q.op !== 'select') return { data: null, error: { message: 'no writes' } };
      if (opts.postsFail) return { data: null, error: { message: 'permission denied' } };
      const lt = q.filters.find((f) => f[0] === 'lt');
      const list = opts.db.filter((r) => !lt || r.created_at < lt[2]).slice(0, q.limit);
      return { data: list, error: null };
    }
    if (q.table === 'collection_likes') {
      if (q.op === 'select') {
        const ids = q.filters.find((f) => f[0] === 'in')[2];
        return {
          data: ids.filter((id) => liked.has(id)).map((post_id) => ({ post_id })),
          error: null,
        };
      }
      if (q.op === 'insert') {
        if (opts.insertError) return { data: null, error: opts.insertError };
        liked.add(q.row.post_id);
        return { data: null, error: null };
      }
      if (q.op === 'delete') {
        if (opts.deleteError) return { data: null, error: opts.deleteError };
        liked.delete(q.filters.find((f) => f[0] === 'eq')[2]);
        return { data: null, error: null };
      }
    }
    return { data: null, error: { message: 'x' } };
  };
  window.supabase = opts.noSupabase
    ? undefined
    : {
        createClient: () => ({
          auth: {
            getSession: async () => {
              calls.auth++;
              return { data: { session: opts.session } };
            },
          },
          rpc: async (name, args) => {
            calls.rpc.push([name, args]);
            if (name !== 'collection_post_companies')
              return { data: null, error: { message: 'x' } };
            return {
              data: args.p_post_ids
                .filter((id) => opts.companies[id])
                .map((id) => ({ post_id: id, ...opts.companies[id] })),
              error: null,
            };
          },
          from: (table) => {
            const q = { table, op: 'select', cols: '', filters: [], row: null };
            calls.queries.push(q);
            const chain = {
              select: (cols) => {
                q.cols = cols;
                return chain;
              },
              order: (col, o) => {
                q.order = [col, o];
                return chain;
              },
              limit: (n) => {
                q.limit = n;
                return chain;
              },
              lt: (col, v) => {
                q.filters.push(['lt', col, v]);
                return chain;
              },
              in: (col, v) => {
                q.filters.push(['in', col, v]);
                return chain;
              },
              eq: (col, v) => {
                q.filters.push(['eq', col, v]);
                return chain;
              },
              insert: (row) => {
                q.op = 'insert';
                q.row = row;
                return chain;
              },
              update: (row) => {
                q.op = 'update';
                q.row = row;
                return chain;
              },
              delete: () => {
                q.op = 'delete';
                return chain;
              },
              then: (resolve, reject) => Promise.resolve(answer(q)).then(resolve, reject),
            };
            return chain;
          },
        }),
      };
  delete window.IntersectionObserver;
  (0, eval)(read('segan/shell.js'));
  (0, eval)(read('segan/collection-view.js'));
  (0, eval)(read('segan/collection.js'));
  await window.SeganCollection.ready;
  calls.liked = liked;
  return calls;
}

const $ = (id) => document.getElementById(id);
const tiles = () => [...document.querySelectorAll('#clTiles .cl-tile')];
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const of = (calls, table, op = 'select') =>
  calls.queries.filter((q) => q.table === table && q.op === op);
const sheet = () => document.querySelector('.sg-sheet-wrap--sheet .sg-sheet');
const dialog = () => document.querySelector('.sg-sheet-wrap--dialog .sg-sheet');
/** 사진 보기의 [이름, 값] 줄 */
const facts = () =>
  [...sheet().querySelectorAll('.pv-facts > div')].map((d) => [
    d.querySelector('dt').textContent,
    d.querySelector('dd').textContent,
  ]);
const likeBtn = () => sheet().querySelector('.pv-like');
const openTile = async (i) => {
  tiles()[i].click();
  await flush();
};
const moreAll = async () => {
  for (let i = 0; i < 10; i++) {
    if ($('clMore').hidden) break;
    $('clMore').click();
    await flush();
  }
};

afterEach(async () => {
  // 열린 시트 · 창을 닫는다 (다음 시험의 기록 칸이 섞이지 않게)
  while (window.SeganShell && window.SeganShell.sheet.current()) {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
  }
  jest.restoreAllMocks();
});

describe('읽기 — 공개 칸만 · 최신순 24줄 키셋 · DB 뒤에 STATIC', () => {
  test('정적 사례 = 사이트 collection.html 의 STATIC (segan/ 에서 보므로 ../)', async () => {
    await load();
    const site = read('collection.html').match(/var STATIC = (\[[\s\S]*?\]);/)[1];
    const expected = Function(`return ${site}`)().map((s) => ({
      ...s,
      image_url: '../' + s.image_url,
    }));
    expect(window.SeganCollection.STATIC).toEqual(expected);
  });

  test('공개 칸만 읽는다 — user_id · storage_path · design_id · region · 학습 동의는 묻지 않는다', async () => {
    const calls = await load();
    const q = of(calls, 'collection_posts')[0];
    expect(q.cols).toBe(COLS);
    expect(window.SeganCollection.COLS).toBe(COLS);
    expect(q.cols).not.toMatch(/user_id|storage_path|design_id|generation_id|region|consent|\*/);
    expect(q.order).toEqual(['created_at', { ascending: false }]);
    expect(q.limit).toBe(24);
    expect(q.filters).toEqual([]);
    expect(tiles()).toHaveLength(24);
    expect(tiles()[0].querySelector('img').getAttribute('src')).toContain('p0.jpg');
    expect($('clMore').hidden).toBe(false);
  });

  test('업체 이름 — 업체가 있는 게시물 id 만 쪽마다 한 번 (collection_post_companies)', async () => {
    const calls = await load();
    expect(calls.rpc).toEqual([['collection_post_companies', { p_post_ids: [uid(0), uid(3)] }]]);
    $('clMore').click();
    await flush();
    expect(calls.rpc).toHaveLength(1); // 다음 쪽(24~29)에는 업체가 없다 — 묻지 않는다
  });

  test('로그인 전 — 내 좋아요를 묻지 않는다 (세션은 이 기기에서만 본다)', async () => {
    const calls = await load();
    expect(calls.auth).toBe(1);
    expect(of(calls, 'collection_likes')).toEqual([]);
  });

  test('로그인 — 이 쪽 게시물 중 내가 좋아한 것을 한 번에 (select post_id · in post_id)', async () => {
    const calls = await load({ session: SESSION, liked: [uid(2)] });
    const q = of(calls, 'collection_likes');
    expect(q).toHaveLength(1);
    expect(q[0].cols).toBe('post_id');
    expect(q[0].filters).toEqual([['in', 'post_id', rows(24).map((r) => r.id)]]);
    expect(window.SeganCollection.state.liked).toEqual({ [uid(2)]: true });
  });

  test('더 보기 — 24장씩, 다음 키셋(lt created_at), 끝에는 STATIC, 되풀이 없음', async () => {
    const calls = await load();
    await moreAll();
    const q = of(calls, 'collection_posts');
    expect(q.map((x) => x.filters)).toEqual([[], [['lt', 'created_at', rows(30)[23].created_at]]]);
    expect(tiles()).toHaveLength(45); // DB 30 + STATIC 15
    expect(tiles()[29].querySelector('img').getAttribute('src')).toContain('p29.jpg');
    // 자체 시공 사진 타일은 가벼운 사본 (app/portfolio/display/)
    expect(tiles()[30].querySelector('img').getAttribute('src')).toBe(
      '../app/portfolio/display/kitchen-n1-1.jpg'
    );
    expect($('clState').textContent).toBe('마지막 사례입니다');
    expect($('clMore').hidden).toBe(true);
    const srcs = tiles().map((t) => t.querySelector('img').getAttribute('src'));
    expect(new Set(srcs).size).toBe(srcs.length);
    for (const s of srcs.slice(30))
      expect([s, fs.existsSync(path.join(ROOT, 'segan', s))]).toEqual([s, true]);
  });

  test('못 읽으면(권한 · 오류) · 라이브러리가 없으면 정적 사례만', async () => {
    await load({ postsFail: true });
    expect(tiles()).toHaveLength(15);
    await load({ noSupabase: true });
    expect(tiles()).toHaveLength(15);
    expect(window.SeganCollection.state.posts).toHaveLength(15);
  });
});

describe('칸 — 폰 3칸 · PC 4칸 · 이미지는 늦게 받기', () => {
  const css = read('segan/shell.css');
  /** 맨 위 규칙 · @media 머리글 아래 블록 안의 규칙 */
  const rule = (sel, media) => {
    const e = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let m = null;
    if (!media) m = css.match(new RegExp(`\\n${e} \\{([^}]*)\\}`));
    else
      for (const b of css.split(media).slice(1)) {
        m = b.slice(0, b.indexOf('\n}\n')).match(new RegExp(`\\n  ${e} \\{([^}]*)\\}`));
        if (m) break;
      }
    expect([sel, media, !!m]).toEqual([sel, media, true]);
    return m[1];
  };

  test('폰 3칸 · 칸 사이 2px · 화면 끝까지(안전 영역 안), 768px~ 3px, 1024px~ 4칸', () => {
    const base = rule('.cl-grid');
    expect(base).toMatch(/grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(base).toMatch(/gap:\s*2px/);
    expect(base).toMatch(
      /env\(safe-area-inset-left\) - max\(var\(--sg-px\), env\(safe-area-inset-left\)\)/
    );
    expect(rule('.cl-grid', '@media (min-width: 768px)')).toMatch(/gap:\s*3px/);
    expect(rule('.cl-grid', '@media (min-width: 1024px)')).toMatch(
      /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/
    );
    // 타일은 정사각 · 꽉 채움, 라운드 · 섀도 없음
    expect(rule('.cl-tile')).toMatch(/aspect-ratio:\s*1 \/ 1/);
    expect(rule('.cl-tile img')).toMatch(/object-fit:\s*cover/);
    expect(css).not.toMatch(/box-shadow\s*:/);
  });

  test('타일 = 단추 + img (loading lazy · width · height · decoding async), 이름은 단추에', async () => {
    await load();
    const t = tiles()[0];
    expect(t.tagName).toBe('BUTTON');
    expect(t.getAttribute('type')).toBe('button');
    expect(t.getAttribute('aria-label')).toBe(
      '시공사례 · 인천 연수구 · 주방 0 · 다담 협력 주방 크게 보기'
    );
    const img = t.querySelector('img');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('width')).toBe('400');
    expect(img.getAttribute('height')).toBe('400');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('draggable')).toBe('false');
  });

  test('AI 연출컷 타일 — 귀퉁이 「AI」 · 이름 「AI 연출컷」 (실제 시공 사진으로 오해하지 않게)', async () => {
    await load();
    expect(tiles()[1].classList.contains('cl-tile--ai')).toBe(true);
    expect(tiles()[1].querySelector('.cl-mark').textContent).toBe('AI');
    expect(tiles()[1].getAttribute('aria-label')).toBe('AI 연출컷 · 싱크대 크게 보기');
    expect(tiles()[0].querySelector('.cl-mark')).toBeNull();
  });
});

describe('사진 보기 — 시트 (장소 · 색상 · 업체 · 좋아요 · 이 스타일로 연출컷)', () => {
  test('누르면 시트 — 큰 사진 · 장소 · 색상 · 업체 · 좋아요 수, 주소는 그대로', async () => {
    await load();
    await openTile(0);
    expect(document.querySelector('.sg-sheet-wrap--sheet')).not.toBeNull();
    const box = sheet();
    expect(box.getAttribute('role')).toBe('dialog');
    expect(box.querySelector('.sg-sheet-title').textContent).toBe('시공사례');
    const img = box.querySelector('.pv-photo img');
    expect(img.getAttribute('src')).toContain('p0.jpg');
    expect(img.getAttribute('alt')).toBe('시공사례 · 인천 연수구 · 주방 0 · 다담 협력 주방');
    expect(img.getAttribute('width')).toBeTruthy();
    expect(box.querySelector('.pv-photo').getAttribute('style')).toMatch(/aspect-ratio:/);
    expect(facts()).toEqual([
      ['장소', '인천 연수구 · 주방 0'],
      ['색상', '화이트'],
      ['업체', '다담 협력 주방'],
    ]);
    expect(likeBtn().getAttribute('aria-pressed')).toBe('false');
    expect(likeBtn().querySelector('.pv-count').textContent).toBe('4');
    expect(window.location.pathname + window.location.hash).toBe('/segan/collection.html');
  });

  test('뒤로 가기 · 닫기가 시트를 닫는다 (# 없음)', async () => {
    await load();
    await openTile(0);
    window.dispatchEvent(new window.PopStateEvent('popstate', { state: null }));
    expect(sheet()).toBeNull();
    await openTile(2);
    sheet().querySelector('.sg-sheet-x').click();
    await flush();
    expect(sheet()).toBeNull();
    expect(window.location.hash).toBe('');
  });

  test('업체 글 — 업체 이름 · 업체 없는 AI 연출컷은 「AI 연출컷」 · 업체 없는 직접 올린 사진은 줄 없음 (다담가구를 붙이지 않는다)', async () => {
    await load();
    await openTile(1); // AI 연출컷 · 업체 없음
    expect(sheet().querySelector('.sg-sheet-title').textContent).toBe('AI 연출컷');
    expect(facts()).toEqual([
      ['장소', '싱크대'],
      ['색상', '오크'],
      ['업체', 'AI 연출컷'],
    ]);
    await openTile(3); // AI 연출컷 · 업체 있음 — 업체 이름, 제목은 AI 연출컷
    expect(sheet().querySelector('.sg-sheet-title').textContent).toBe('AI 연출컷');
    // 본사 업체(DB 이름 「다담 공장」)는 고객에게 「다담가구」
    expect(facts()).toContainEqual(['업체', '다담가구']);
    await openTile(2); // 직접 올린 사진 · 업체 없음 · 장소 없음 · 색상 없음 — 줄이 없다
    expect(sheet().querySelector('.pv-facts')).toBeNull();
    expect(sheet().textContent).not.toMatch(/다담가구/);
  });

  test('자체 시공 사진 — 업체 「다담가구」 · 장소 = 지역 · 큰 사진은 원본, 좋아요 없음', async () => {
    await load();
    await moreAll();
    await openTile(30);
    expect(facts()).toEqual([
      ['장소', '서울 논현'],
      ['업체', '다담가구'],
    ]);
    expect(sheet().querySelector('.pv-photo img').getAttribute('src')).toBe(
      '../app/portfolio/kitchen-n1-1.jpg'
    );
    expect(likeBtn()).toBeNull();
  });

  test('「이 스타일로 연출컷」 — 직접 올린 사진 make.html?ref=<id> · 자체 시공 make.html?ref=<파일 이름> · AI 연출컷은 없음', async () => {
    await load();
    const make = () => sheet().querySelector('a.pv-make');
    await openTile(0);
    expect(make().getAttribute('href')).toBe('make.html?ref=' + uid(0));
    expect(make().textContent).toBe('이 스타일로 연출컷');
    await openTile(1);
    expect(make()).toBeNull();
    await openTile(3);
    expect(make()).toBeNull();
    await moreAll();
    await openTile(44);
    expect(make().getAttribute('href')).toBe('make.html?ref=funiture-n4-1');
    // 만들기가 받는 모양 (segan/make.js takeLinkRefs · STATIC_STEM_RE · UUID_RE)
    const V = window.SeganPostView;
    expect(V.refHref({ id: 'not-a-uuid', source: 'upload' })).toBe('');
    expect(V.refHref({ id: '', stem: '', source: 'upload' })).toBe('');
  });

  test('PC 1100px~ 에서는 같은 시트가 오른쪽 옆 패널 (셸 CSS) — 사진 여백도 맞춘다', () => {
    const css = read('segan/shell.css');
    const wide = css
      .split('@media (min-width: 1100px)')
      .slice(1)
      .find((b) => b.includes('.sg-sheet-wrap--panel .sg-sheet')); // PC 옆 패널 칸 (폰 시트 손잡이 칸과 헷갈리지 않게)
    expect(wide).toMatch(/\.sg-sheet-wrap \.pv-photo\s*\{\s*margin:\s*-20px -24px 0;/);
  });
});

describe('좋아요 — 로그인한 사람만, 본인 줄', () => {
  test('누르면 insert { user_id, post_id } · ♡ 눌림 · 수 +1, 다시 누르면 delete eq post_id · 되돌림', async () => {
    const calls = await load({ session: SESSION });
    await openTile(0);
    likeBtn().click();
    await flush();
    expect(of(calls, 'collection_likes', 'insert').map((q) => q.row)).toEqual([
      { user_id: ME, post_id: uid(0) },
    ]);
    expect(likeBtn().getAttribute('aria-pressed')).toBe('true');
    expect(likeBtn().querySelector('.pv-count').textContent).toBe('5');
    expect(window.SeganCollection.state.liked[uid(0)]).toBe(true);
    likeBtn().click();
    await flush();
    const del = of(calls, 'collection_likes', 'delete');
    expect(del.map((q) => q.filters)).toEqual([[['eq', 'post_id', uid(0)]]]);
    expect(likeBtn().getAttribute('aria-pressed')).toBe('false');
    expect(likeBtn().querySelector('.pv-count').textContent).toBe('4');
    expect(window.SeganCollection.state.liked[uid(0)]).toBeUndefined();
    // 게시물 표에는 쓰지 않는다 (좋아요 수는 DB 트리거가 센다)
    expect(
      calls.queries.filter((q) => q.table === 'collection_posts' && q.op !== 'select')
    ).toEqual([]);
  });

  test('내가 좋아한 사진은 눌린 ♡ 로 열린다', async () => {
    await load({ session: SESSION, liked: [uid(2)] });
    await openTile(2);
    expect(likeBtn().getAttribute('aria-pressed')).toBe('true');
  });

  test('못 넣으면 되돌리고 알린다 · 이미 있는 줄(23505)은 좋아한 것으로 본다', async () => {
    await load({ session: SESSION, insertError: { code: '42501', message: 'denied' } });
    await openTile(0);
    likeBtn().click();
    await flush();
    expect(likeBtn().getAttribute('aria-pressed')).toBe('false');
    expect(likeBtn().querySelector('.pv-count').textContent).toBe('4');
    const err = sheet().querySelector('.pv-error');
    expect(err.hidden).toBe(false);
    expect(err.getAttribute('role')).toBe('alert');

    await load({ session: SESSION, insertError: { code: '23505', message: 'duplicate' } });
    await openTile(0);
    likeBtn().click();
    await flush();
    expect(likeBtn().getAttribute('aria-pressed')).toBe('true');
    expect(sheet().querySelector('.pv-error').hidden).toBe(true);
  });

  test('로그인 전 — 가운데 작은 창 「로그인하면 좋아요를 저장할 수 있습니다」 · 로그인 뒤 시공사례로', async () => {
    const calls = await load();
    await openTile(0);
    likeBtn().click();
    await flush();
    const d = dialog();
    expect(d).not.toBeNull();
    expect(d.textContent).toContain('로그인하면 좋아요를 저장할 수 있습니다');
    expect(d.querySelector('a.sg-btn').getAttribute('href')).toBe(
      '../login.html?redirect=segan%2Fcollection.html'
    );
    expect(likeBtn().getAttribute('aria-pressed')).toBe('false');
    expect(of(calls, 'collection_likes', 'insert')).toEqual([]);
    // 창 위에서 Esc — 창만 닫히고 사진 보기는 남는다
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(dialog()).toBeNull();
    expect(sheet()).not.toBeNull();
  });

  test('♡ 단추 — 누르는 곳 44px 이상, 눌림은 채운 하트', () => {
    const css = read('segan/shell.css');
    const block = css.match(/\n\.pv-like \{([^}]*)\}/)[1];
    expect(block).toMatch(/min-width: 44px/);
    expect(block).toMatch(/min-height: 44px/);
    expect(css).toMatch(/\.pv-like\[aria-pressed='true'\] \.pv-heart \{\s*fill: currentColor;/);
  });
});

describe('다운로드 없음 · 관리자 내리기 없음', () => {
  test('a · download · 내리기가 없다, 오른쪽 단추 메뉴 · 끌기를 막는다', async () => {
    const calls = await load();
    $('clMore').click();
    await flush();
    await openTile(0);
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    expect($('clTiles').querySelectorAll('a')).toHaveLength(0);
    expect([...sheet().querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'make.html?ref=' + uid(0),
    ]);
    expect(document.body.textContent).not.toMatch(/내리기|다운로드/);
    expect(document.querySelectorAll('[data-take-down]')).toHaveLength(0);
    for (const img of [tiles()[0].querySelector('img'), sheet().querySelector('.pv-photo img')]) {
      for (const type of ['contextmenu', 'dragstart']) {
        const e = new window.MouseEvent(type, { bubbles: true, cancelable: true });
        img.dispatchEvent(e);
        expect([type, e.defaultPrevented]).toEqual([type, true]);
      }
    }
    expect(calls.queries.filter((q) => q.op !== 'select')).toEqual([]);
  });
});

describe('페이지', () => {
  test('collection.html 이 config · supabase · shell · collection-view · collection.js 를 싣고 검색에 열린다', () => {
    const html = read('segan/collection.html');
    expect(html).not.toMatch(/name="robots"/);
    expect(html).toContain(
      '<link rel="canonical" href="https://dadamfurniture.com/segan/collection" />'
    );
    expect(html).toMatch(/<script src="\.\.\/js\/config\.js\?v=\d+"><\/script>/);
    const view = html.search(/<script src="collection-view\.js\?v=\d+" defer><\/script>/);
    const page = html.search(/<script src="collection\.js\?v=\d+" defer><\/script>/);
    expect(view).toBeGreaterThan(0);
    expect(page).toBeGreaterThan(view);
    expect(html).toMatch(/<body class="sg-app" data-tab="collection">/);
  });

  test('자재 칸은 뺐다 — 고르는 칸 · 자재 글 없음, /material 은 매거진으로 (material.html 파일은 그대로)', async () => {
    await load();
    expect($('clMaterial')).toBeNull();
    expect(document.querySelector('.cl-seg, [role="tablist"]')).toBeNull();
    expect(document.querySelector('main').textContent).not.toMatch(/예림보드|자재/);
    const redirects = read('_redirects');
    expect(redirects).toMatch(/\n\/material\s+\/segan\/blog\s+301/);
    expect(redirects).toMatch(/\n\/material\.html\s+\/segan\/blog\s+301/);
    expect(redirects).not.toMatch(/#material/);
    expect(fs.existsSync(path.join(ROOT, 'material.html'))).toBe(true);
    expect(read('material.html')).not.toMatch(/segan/i); // 사이트 페이지는 앱 주소를 모른다
    expect(read('js/site-shell.js')).not.toMatch(/collection#material/);
  });

  test('아래 탭은 다섯 그대로', async () => {
    await load();
    const keys = [...document.querySelectorAll('nav.sg-tabbar a:not([hidden])')].map((a) =>
      a.getAttribute('data-tab-link')
    );
    expect(keys).toEqual(['home', 'make', 'collection', 'blog', 'me']);
    expect(
      document.querySelector('nav.sg-tabbar [aria-current="page"]').getAttribute('data-tab-link')
    ).toBe('collection');
  });

  test('서비스 워커가 collection-view.js 를 미리 담는다', () => {
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'collection-view.js')");
  });
});
