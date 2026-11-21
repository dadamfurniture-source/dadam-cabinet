/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, jest, setTimeout */
/**
 * SEGAN 「시공사례」 탭 (segan/collection.html + segan/collection.js + segan/collection-view.js).
 *
 *   - 사진을 인스타그램처럼 정사각 칸으로 — 폰 3칸 · PC(1024px~) 4칸, 칸 사이 2~3px
 *   - collection_posts 공개 칸만 최신순 · 24줄 키셋, 업체 이름은 RPC collection_post_companies,
 *     로그인했으면 이 쪽의 내 좋아요 (collection_likes post_id). DB 사례 뒤에 같은 STATIC
 *   - 사진 아래 색상 영역(색상 하나씩 · ♡), 누르면 사진 보기 시트(SeganShell.sheet) — 장소 · 좋아요(♡ aria-pressed) ·
 *     색상 · 업체 정보 · 이 스타일로 연출컷. 그 안의 사진을 누르면 사진만 전체 화면 (예상 견적은 뺐다 — 2026-11-21)
 *   - 업체: 업체 이름 → (없고) AI 연출컷이면 「AI 연출컷」 → 아니면 줄 없음. 정적 사진(AI 연출)은 「AI 연출」
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
 * DB 줄 (최신순) — 모두 직접 올린 사진(탭은 AI 연출컷 source 'ai_render' 를 묻지 않는다, 2026-11-20).
 * 0: 장소 · 색상 · 업체 있음, 1: 장소 · 색상 · 업체 없음, 2: 장소 · 색상 · 업체 없음, 3: 본사 업체, 그 뒤는 차례대로
 */
function rows(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: uid(i),
    image_url: `https://example.supabase.co/storage/v1/object/public/collection/p${i}.jpg`,
    place_label: i === 1 ? '싱크대' : i % 5 === 2 ? '' : `인천 연수구 · 주방 ${i}`,
    door_color: i === 1 ? '오크' : i === 0 ? '화이트' : '',
    company_id: i === 0 || i === 3 ? CO_P : null,
    like_count: i === 0 ? 4 : 0,
    source: 'upload',
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
      const or = q.filters.find((f) => f[0] === 'or');
      const list = opts.db
        .filter((r) => !lt || r.created_at < lt[2])
        // 공개 탭 조건 — 직접 올린 사진 또는 본사가 고른 연출컷 (DB 0075)
        .filter((r) => !or || r.source === 'upload' || !!r.hq_picked_at)
        .slice(0, q.limit);
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
              or: (expr) => {
                q.filters.push(['or', expr]);
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
/** 가운데 작은 창 (로그인 권하기) — 사진 전체 화면도 같은 층을 쓰므로 그것은 뺀다 */
const dialog = () => document.querySelector('.sg-sheet-wrap--dialog:not(.pv-full-wrap) .sg-sheet');
/** 사진 전체 화면 */
const full = () => document.querySelector('.sg-sheet-wrap.pv-full-wrap .sg-sheet');
const cells = () => [...document.querySelectorAll('#clTiles .cl-cell')];
const hearts = () => [...document.querySelectorAll('#clTiles .cl-like')];
/** 사진 보기의 [이름, 값] 줄 */
const facts = () =>
  [...sheet().querySelectorAll('.pv-facts > div')].map((d) => [
    d.querySelector('dt').textContent,
    d.querySelector('dd').textContent,
  ]);
const likeBtn = () => sheet().querySelector('.pv-like');
/** 열린 창을 모두 닫는다 — 전체 화면이 열려 있는 동안에는 다른 사진을 누를 수 없다 (화면을 덮는다) */
const closeAll = async () => {
  while (window.SeganShell && window.SeganShell.sheet.current()) {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
  }
};
/** 사진을 누른다 → 사진 보기 시트 */
const openTile = async (i) => {
  await closeAll();
  tiles()[i].click();
  await flush();
};
/** 사진만 전체 화면까지 — 사진을 누르고(사진 보기) 그 안의 사진을 누른다 */
const openFull = async (i) => {
  await openTile(i);
  sheet().querySelector('.pv-photo').click();
  await flush();
};
/** 사진 보기의 장소 줄 · 색상 [이름, 색 값] */
const place = () => (sheet().querySelector('.pv-place') || { textContent: null }).textContent;
const chipOf = (li) => {
  const c = li.querySelector('.cl-chip');
  return c ? c.getAttribute('style').replace('background: ', '') : '';
};
const colors = () =>
  [...sheet().querySelectorAll('.pv-colors li')].map((li) => [
    li.querySelector('span:last-child').textContent,
    chipOf(li),
  ]);
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
  test('정적 사례 = AI 연출 사진 36장 (app/portfolio/luxe-manifest.json, 첫 사진 빼고 모두) — 장소 대신 품목, 색상 = 예림 자재 이름, 밝은 사진과 다양한 사진을 섞은 차례', async () => {
    await load();
    const manifest = JSON.parse(read('app/portfolio/luxe-manifest.json'));
    const byFile = Object.fromEntries(manifest.photos.map((p) => [p.file, p]));
    const stat = window.SeganCollection.STATIC;
    expect(stat).toHaveLength(36);
    expect(stat.map((s) => s.image_url.replace(/^.*\//, '')).sort()).toEqual(
      manifest.photos
        .map((p) => p.file)
        .filter((f) => f !== 'luxe-hero.jpg')
        .sort()
    );
    for (const s of stat) {
      const file = s.image_url.replace(/^.*\//, '');
      const p = byFile[file];
      expect(s).toEqual({
        image_url: '../app/portfolio/' + file,
        place: p.kind,
        color: p.materials.map((m) => m.name).join(' · '),
      });
      expect(fs.existsSync(path.join(ROOT, 'app/portfolio', file))).toBe(true);
      expect(fs.existsSync(path.join(ROOT, 'app/portfolio/display', file))).toBe(true);
    }
    // 밝은 사진(luxe)이 한쪽에 몰리지 않는다 — 앞 12장에 둘 다 있다
    const head = stat.slice(0, 12).map((s) => s.image_url);
    expect(head.some((u) => u.includes('/luxe-'))).toBe(true);
    expect(head.some((u) => u.includes('/mix-'))).toBe(true);
    // 품목이 번갈아 — 네 장마다 주방 · 붙박이장 · 수납장(화장대 · 서재 포함)이 모두 있다
    const kindOf = (s) => {
      const c = byFile[s.image_url.replace(/^.*\//, '')].category;
      return c === 'kitchen' || c === 'builtin' ? c : 'storage';
    };
    for (let i = 0; i + 4 <= stat.length; i += 4) {
      expect(new Set(stat.slice(i, i + 4).map(kindOf)).size).toBe(3);
    }
    // 품목이 고루 — 주방 · 붙박이장 · 수납장 · 화장대 · 서재
    expect(new Set(manifest.photos.map((p) => p.category))).toEqual(
      new Set(['kitchen', 'builtin', 'storage', 'interior', 'other'])
    );
  });

  test('공개 칸만 읽는다 — user_id · storage_path · design_id · region · 학습 동의는 묻지 않는다', async () => {
    const calls = await load();
    const q = of(calls, 'collection_posts')[0];
    expect(q.cols).toBe(COLS);
    expect(window.SeganCollection.COLS).toBe(COLS);
    expect(q.cols).not.toMatch(/user_id|storage_path|design_id|generation_id|region|consent|\*/);
    expect(q.order).toEqual(['created_at', { ascending: false }]);
    expect(q.limit).toBe(24);
    // 직접 올린 사진 + 본사가 고른 연출컷만 (2026-11-20 대표님, DB 0075)
    expect(q.filters).toEqual([['or', 'source.eq.upload,hq_picked_at.not.is.null']]);
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
    expect(q.map((x) => x.filters)).toEqual([
      [['or', 'source.eq.upload,hq_picked_at.not.is.null']],
      [
        ['or', 'source.eq.upload,hq_picked_at.not.is.null'],
        ['lt', 'created_at', rows(30)[23].created_at],
      ],
    ]);
    expect(tiles()).toHaveLength(66); // DB 30 + STATIC 36
    expect(tiles()[29].querySelector('img').getAttribute('src')).toContain('p29.jpg');
    // 정적 사진 타일은 가벼운 사본 (app/portfolio/display/)
    expect(tiles()[30].querySelector('img').getAttribute('src')).toBe(
      '../app/portfolio/display/mix-01.jpg'
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
    expect(tiles()).toHaveLength(24); // 정적 36장 가운데 첫 쪽
    await load({ noSupabase: true });
    expect(tiles()).toHaveLength(24);
    expect(window.SeganCollection.state.posts).toHaveLength(36);
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
    // 사진은 정사각 · 꽉 채움, 라운드 · 섀도 없음 (칸은 사진 + 그 아래 색상 영역이라 정사각이 아니다)
    expect(rule('.cl-tile')).toMatch(/aspect-ratio:\s*1 \/ 1/);
    expect(rule('.cl-cell')).not.toMatch(/aspect-ratio/);
    expect(rule('.cl-tile img')).toMatch(/object-fit:\s*cover/);
    expect(css).not.toMatch(/box-shadow\s*:/);
  });

  test('타일 = 단추 + img (loading lazy · width · height · decoding async), 이름은 단추에', async () => {
    await load();
    const t = tiles()[0];
    expect(t.tagName).toBe('BUTTON');
    expect(t.getAttribute('type')).toBe('button');
    expect(t.getAttribute('aria-label')).toBe(
      '시공사례 · 인천 연수구 · 주방 0 · 다담 협력 주방 정보 보기'
    );
    const img = t.querySelector('img');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('width')).toBe('400');
    expect(img.getAttribute('height')).toBe('400');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('draggable')).toBe('false');
  });

  test('연출컷은 본사가 고른 것만 — 고르지 않은 것은 빠지고, 고른 것은 「AI」 표 없이 업체 칸 「AI 연출」', async () => {
    const db = rows(6).map((r, i) =>
      i === 1
        ? { ...r, source: 'ai_render' } // 예전 자동 게시 — 본사가 고르지 않음
        : i === 2
          ? { ...r, source: 'ai_render', hq_picked_at: '2026-11-20T01:00:00Z', company_id: null }
          : r
    );
    const calls = await load({ db });
    expect(of(calls, 'collection_posts')[0].filters).toEqual([
      ['or', 'source.eq.upload,hq_picked_at.not.is.null'],
    ]);
    expect(tiles().some((t) => t.querySelector('img').getAttribute('src').includes('p1.jpg'))).toBe(
      false
    );
    expect(document.querySelector('.cl-mark')).toBeNull();
    // 고른 연출컷(차례 2 → 화면 1번째 칸)은 제목 「시공사례」, 업체 칸 「AI 연출」, 「이 스타일로 연출컷」 없음
    await openTile(1);
    expect(sheet().querySelector('.sg-sheet-title').textContent).toBe('시공사례');
    expect(facts()).toContainEqual(['업체', 'AI 연출']);
    expect(sheet().querySelector('a.pv-make')).toBeNull();
  });
});

describe('사진 아래 색상 영역 — 색상 하나씩 · ♡ (2026-11-21 대표님 「사진 위에 적지 말고 밑에 색상 정보 영역을 만들어서 개별로」)', () => {
  test('칸 = 사진 단추 + 그 아래 색상 영역. 색상은 하나씩 한 줄, DB 게시물이면 ♡ — 사진 위에는 아무것도 얹지 않는다', async () => {
    await load();
    await moreAll();
    const info = (i) => cells()[i].querySelector('.cl-info');
    const names = (i) => [...info(i).querySelectorAll('.cl-colors li')].map((li) => li.textContent);
    // 칸의 자식은 차례대로 사진 단추 · 색상 영역 — 영역은 사진 단추 안이 아니다
    expect([...cells()[0].children].map((c) => c.className)).toEqual(['cl-tile', 'cl-info']);
    expect(cells()[0].querySelector('button.cl-tile[data-open="0"]')).not.toBeNull();
    expect(document.querySelector('.cl-tile .cl-info, .cl-tile .cl-colors, .cl-cap')).toBeNull();
    // 0: 색상 「화이트」 + ♡ (DB 게시물은 색 값을 몰라 색 칸이 없다)
    expect(names(0)).toEqual(['화이트']);
    expect(info(0).querySelector('.cl-chip')).toBeNull();
    const heart = info(0).querySelector('button.cl-like');
    expect(heart.getAttribute('data-like')).toBe('0');
    expect(heart.getAttribute('type')).toBe('button');
    expect(heart.getAttribute('aria-label')).toBe('좋아요');
    expect(heart.getAttribute('aria-pressed')).toBe('false');
    expect(heart.querySelector('svg.pv-heart')).not.toBeNull();
    // 2: 색상 없음 — ♡ 만 (영역은 그대로 둔다)
    expect(info(2).querySelector('.cl-colors')).toBeNull();
    expect(info(2).querySelector('.cl-like')).not.toBeNull();
    // ♡ 는 사진 단추 안에 넣지 않는다 (단추 안 단추가 되지 않게)
    expect(document.querySelector('.cl-tile .cl-like')).toBeNull();
    // 정적 사진(AI 연출) — 색상을 하나씩 (「매트 딥그린 · 카카오월넛」 → 두 줄), 자재 색 값은 작은 색 칸으로
    const first = window.SeganCollection.STATIC[0];
    const hexOf = Object.fromEntries(
      JSON.parse(read('app/portfolio/luxe-manifest.json'))
        .photos.find((p) => first.image_url.endsWith('/' + p.file))
        .materials.map((m) => [m.name, m.hex])
    );
    expect(names(30)).toEqual(first.color.split(' · '));
    expect(names(30)).toHaveLength(2);
    expect([...info(30).querySelectorAll('.cl-chip')].map((c) => c.getAttribute('style'))).toEqual(
      names(30).map((n) => 'background: ' + hexOf[n])
    );
    expect(info(30).querySelector('.cl-chip').getAttribute('aria-hidden')).toBe('true');
    // DB 게시물이 아니라 좋아요를 저장할 곳이 없다
    expect(info(30).querySelector('.cl-like')).toBeNull();
    expect(hearts()).toHaveLength(30);
    // 색상도 없고 좋아요도 못 하는 사진 — 빈 영역만 (줄 높이가 맞는다)
    const bare = window.SeganPostView.tileHTML(
      window.SeganPostView.fromStatic({ image_url: '../app/portfolio/x.jpg', place: '주방' }),
      0
    );
    expect(bare).toContain('<div class="cl-info"></div>');
    // 색 칸은 아는 자재 이름에만 (MATERIAL_HEX) — 모르는 이름 · 표에 없는 글자는 이름만
    const V = window.SeganPostView;
    expect(V.colorsOf({ door_color: '매트 화이트 · 화이트 · toString ·  · 세이오크' })).toEqual([
      { name: '매트 화이트', hex: '#fbfbfb' },
      { name: '화이트', hex: '' },
      { name: 'toString', hex: '' },
      { name: '세이오크', hex: '#cea875' },
    ]);
  });

  test('자재 색 표 = 목록 파일의 자재 (app/portfolio/luxe-manifest.json materials) — 하나도 빠지지 않고 값이 같다', async () => {
    await load({ db: [] });
    const V = window.SeganPostView;
    const manifest = JSON.parse(read('app/portfolio/luxe-manifest.json'));
    const seen = {};
    for (const p of manifest.photos)
      for (const m of p.materials) {
        expect(m.hex).toMatch(/^#[0-9a-f]{6}$/); // 그대로 style 에 적는 값
        expect([m.name, V.colorsOf({ door_color: m.name })]).toEqual([
          m.name,
          [{ name: m.name, hex: m.hex }],
        ]);
        seen[m.name] = true;
      }
    // 표에 남는 이름도 없다 (지운 자재가 표에 남지 않게)
    const table = read('segan/collection-view.js').match(/var MATERIAL_HEX = \{([^}]*)\}/)[1];
    const keys = [...table.matchAll(/^\s*'?([^':\n]+?)'?: '#[0-9a-f]{6}',$/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual(Object.keys(seen).sort());
  });

  test('내가 좋아한 사진은 눌린 ♡ 로 그린다', async () => {
    await load({ session: SESSION, liked: [uid(2)] });
    expect(
      hearts()
        .map((h) => h.getAttribute('aria-pressed'))
        .slice(0, 4)
    ).toEqual(['false', 'false', 'true', 'false']);
  });

  test('♡ 를 누르면 사진은 열리지 않고 바로 저장 — insert { user_id, post_id }, 다시 누르면 delete', async () => {
    const calls = await load({ session: SESSION });
    hearts()[0].click();
    await flush();
    expect(full()).toBeNull();
    expect(sheet()).toBeNull();
    expect(of(calls, 'collection_likes', 'insert').map((q) => q.row)).toEqual([
      { user_id: ME, post_id: uid(0) },
    ]);
    expect(hearts()[0].getAttribute('aria-pressed')).toBe('true');
    expect(window.SeganCollection.state.liked[uid(0)]).toBe(true);
    // 사진 보기의 ♡ 도 같은 상태 · 수로 열린다
    await openTile(0);
    expect(likeBtn().getAttribute('aria-pressed')).toBe('true');
    expect(likeBtn().querySelector('.pv-count').textContent).toBe('5');
    // 시트에서 풀면 칸의 ♡ 도 풀린다
    likeBtn().click();
    await flush();
    expect(of(calls, 'collection_likes', 'delete').map((q) => q.filters)).toEqual([
      [['eq', 'post_id', uid(0)]],
    ]);
    expect(hearts()[0].getAttribute('aria-pressed')).toBe('false');
    await closeAll();
    hearts()[0].click();
    await flush();
    hearts()[0].click();
    await flush();
    expect(of(calls, 'collection_likes', 'insert')).toHaveLength(2);
    expect(of(calls, 'collection_likes', 'delete')).toHaveLength(2);
    expect(hearts()[0].getAttribute('aria-pressed')).toBe('false');
  });

  test('못 넣으면 ♡ 를 되돌리고 알린다 · 로그인 전이면 로그인을 권한다', async () => {
    await load({ session: SESSION, insertError: { code: '42501', message: 'denied' } });
    hearts()[0].click();
    await flush();
    expect(hearts()[0].getAttribute('aria-pressed')).toBe('false');
    expect($('clState').textContent).toBe(
      '좋아요를 저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.'
    );
    expect($('clState').getAttribute('role')).toBe('status');
    const calls = await load();
    hearts()[0].click();
    await flush();
    expect(dialog().textContent).toContain('로그인하면 좋아요를 저장할 수 있습니다');
    expect(hearts()[0].getAttribute('aria-pressed')).toBe('false');
    expect(of(calls, 'collection_likes', 'insert')).toEqual([]);
  });

  test('모습 — 색상 영역은 사진 밑(얹지 않는다) · 색상 한 줄에 하나 · ♡ 는 44px, 눌림은 채운 하트', () => {
    const css = read('segan/shell.css');
    const block = (sel) =>
      css.match(new RegExp(`\\n${sel.replace(/[.[\]='-]/g, '\\$&')} \\{([^}]*)\\}`))[1];
    expect(block('.cl-info')).not.toMatch(/position:\s*absolute/);
    expect(block('.cl-info')).not.toMatch(/gradient|pointer-events/);
    expect(block('.cl-info')).toMatch(/min-height:\s*44px;/);
    expect(css).not.toMatch(/\.cl-cap\b|\.cl-color \{/);
    expect(block('.cl-colors')).toMatch(/list-style:\s*none;/);
    expect(block('.cl-colors')).toMatch(/color:\s*var\(--v5-ink-62\);/); // 밝은 바탕 위의 글
    expect(block('.cl-chip')).toMatch(/border:\s*1px solid var\(--v5-line-25\);/); // 밝은 색도 보이게
    expect(block('.cl-like')).toMatch(/width:\s*44px;/);
    expect(block('.cl-like')).toMatch(/height:\s*44px;/);
    expect(block('.cl-like')).toMatch(/color:\s*var\(--v5-ink\);/);
    expect(block(".cl-like[aria-pressed='true'] .pv-heart")).toMatch(/fill:\s*currentColor;/);
  });
});

describe('사진 전체 화면 — 사진만. 사진 보기의 사진을 누르면 (2026-11-21 대표님 「사진을 클릭하면 바로 확대 사진이 나오지 말고」)', () => {
  test('칸의 사진을 누르면 사진 보기 — 전체 화면은 바로 열리지 않는다. 그 안의 사진을 눌러야 원본 사진 · 「닫기」뿐', async () => {
    await load();
    await openTile(0);
    expect(sheet()).not.toBeNull();
    expect(full()).toBeNull();
    const photo = sheet().querySelector('.pv-photo');
    expect(photo.tagName).toBe('BUTTON');
    expect(photo.getAttribute('type')).toBe('button');
    expect(photo.getAttribute('aria-label')).toBe('사진 크게 보기');
    photo.click();
    await flush();
    const box = full();
    expect(box).not.toBeNull();
    expect(sheet()).not.toBeNull(); // 사진 보기 위에 겹친다
    expect(box.getAttribute('role')).toBe('dialog');
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(box.querySelector('.sg-sheet-title').textContent).toBe('시공사례');
    const img = box.querySelector('img.pv-full-img');
    expect(img.getAttribute('src')).toContain('p0.jpg');
    expect(img.getAttribute('alt')).toBe('시공사례 · 인천 연수구 · 주방 0 · 다담 협력 주방');
    expect(img.getAttribute('draggable')).toBe('false');
    // 사진 말고는 「닫기」 하나 — 글 · 좋아요 · 연출컷은 여기에 없다
    expect([...box.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['닫기']);
    expect(box.querySelector('.pv-facts, .pv-like, .pv-make, .pv-full-info, a')).toBeNull();
    expect(window.location.pathname + window.location.hash).toBe('/segan/collection.html');
    expect(window.SeganCollection.state.sheet.isOpen()).toBe(true);
  });

  test('정적 사진(AI 연출) — 칸에서 받은 가벼운 사본을 먼저 보이고, 원본을 다 받으면 바꿔 끼운다 (빈 화면 없이)', async () => {
    await load({ db: [] });
    const made = [];
    jest.spyOn(window, 'Image').mockImplementation(function () {
      made.push(this);
    });
    await openFull(0);
    const img = full().querySelector('.pv-full-img');
    const original = window.SeganCollection.STATIC[0].image_url;
    expect(img.getAttribute('src')).toBe(original.replace('/portfolio/', '/portfolio/display/'));
    expect(made).toHaveLength(1);
    expect(made[0].src).toBe(original); // 원본을 뒤에서 받는다
    made[0].onload();
    expect(img.getAttribute('src')).toBe(original);
    expect(img.getAttribute('src')).not.toContain('/display/');
  });

  test('원본을 받는 사이에 닫으면 바꿔 끼우지 않는다 · 사본이 따로 없는 사진(DB 게시물)은 한 번만 받는다', async () => {
    await load({ db: [] });
    const made = [];
    jest.spyOn(window, 'Image').mockImplementation(function () {
      made.push(this);
    });
    await openFull(0);
    const img = full().querySelector('.pv-full-img');
    const before = img.getAttribute('src');
    await closeAll();
    made[0].onload();
    expect(img.getAttribute('src')).toBe(before);
    await load();
    made.length = 0;
    await openFull(0);
    expect(made).toHaveLength(0);
    expect(full().querySelector('.pv-full-img').getAttribute('src')).toContain('p0.jpg');
  });

  test('사진 칸은 화면 가득이라 — 그림 안을 누르면 단추를 감추고, 그림 바깥(위아래 어두운 자리)을 누르면 닫는다', async () => {
    await load();
    await openFull(0);
    const img = full().querySelector('.pv-full-img');
    // 화면 400 × 800 에 가로로 긴 그림(2:1) → 그림은 가운데 400 × 200 (y 300 ~ 500)
    img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 800 });
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 2000 });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 1000 });
    const at = (x, y) =>
      img.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y })
      );
    at(200, 400);
    expect(full().classList.contains('pv-full--bare')).toBe(true);
    at(200, 480);
    expect(full().classList.contains('pv-full--bare')).toBe(false);
    at(200, 100); // 그림 위쪽 어두운 자리
    await flush();
    expect(full()).toBeNull();
  });

  test('사진을 누르면 단추를 감췄다 보였다 (사진만 본다) · 사진 바깥을 누르면 닫는다', async () => {
    await load();
    await openFull(0);
    const img = full().querySelector('.pv-full-img');
    img.click();
    expect(full().classList.contains('pv-full--bare')).toBe(true);
    img.click();
    expect(full().classList.contains('pv-full--bare')).toBe(false);
    full().querySelector('.pv-full').click(); // 사진 바깥의 어두운 자리
    await flush();
    expect(full()).toBeNull();
    // 사진 보기로 돌아온다 — 그것까지 닫아야 끝
    expect(sheet()).not.toBeNull();
    expect(window.SeganCollection.state.sheet.isOpen()).toBe(true);
    await closeAll();
    expect(window.SeganCollection.state.sheet).toBeNull();
  });

  test('닫기 · Esc · 뒤로 가기가 전체 화면만 닫는다 — 사진 보기는 남는다', async () => {
    await load();
    await openFull(1);
    full().querySelector('.sg-sheet-x').click();
    await flush();
    expect(full()).toBeNull();
    await openFull(1);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(full()).toBeNull();
    await openFull(1);
    window.history.back();
    await new Promise((r) => setTimeout(r, 50));
    await flush();
    expect(full()).toBeNull();
    expect(sheet()).not.toBeNull();
    expect(window.location.pathname).toBe('/segan/collection.html');
  });

  test('모습 — 화면 가득 · 사진 보기(시트 70)보다 위(가운데 창 층 80 그대로), 사진은 잘리지 않게', () => {
    const css = read('segan/shell.css');
    const block = (sel) =>
      css.match(new RegExp(`\\n${sel.replace(/[.-]/g, '\\$&')} \\{([^}]*)\\}`))[1];
    const wrap = block('.sg-sheet-wrap.pv-full-wrap');
    expect(wrap).not.toMatch(/z-index/); // 층을 낮추지 않는다 — 사진 보기 위에 겹친다
    expect(block('.sg-sheet-wrap--dialog')).toMatch(/z-index:\s*80;/);
    expect(wrap).toMatch(/padding:\s*0;/);
    expect(wrap).toMatch(/background:\s*var\(--v5-dark\);/);
    const box = block('.sg-sheet-wrap.pv-full-wrap .sg-sheet');
    expect(box).toMatch(/max-width:\s*none;/);
    expect(box).toMatch(/height:\s*100%;/);
    const img = block('.pv-full-img');
    // 칸은 화면 가득, 그림은 그 안에 비율대로 (작은 사본을 먼저 보일 때도 같은 크기)
    expect(img).toMatch(/width:\s*100%;/);
    expect(img).toMatch(/height:\s*100%;/);
    expect(img).toMatch(/object-fit:\s*contain;/);
    expect(img).toMatch(/-webkit-touch-callout:\s*none;/); // 길게 눌러 저장 막기
    // 감추기는 opacity 만 움직인다. 「정보」 단추는 없다 (정보가 먼저 열린다)
    expect(block('.sg-sheet-wrap.pv-full-wrap .sg-sheet-head')).toMatch(
      /transition:\s*opacity 0\.2s ease;/
    );
    expect(css).toMatch(
      /\.pv-full--bare \.sg-sheet-head \{\s*visibility:\s*hidden;\s*opacity:\s*0;/
    );
    expect(css).not.toMatch(/pv-full-info/);
    expect(read('segan/collection-view.js')).not.toMatch(/pv-full-info/);
  });
});

describe('사진 보기 — 시트 (장소 · 좋아요 · 색상 · 업체 정보 · 이 스타일로 연출컷)', () => {
  test('누르면 시트 — 큰 사진 · 장소 · 좋아요 수 · 색상 · 업체 정보 차례로, 주소는 그대로', async () => {
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
    expect(place()).toBe('인천 연수구 · 주방 0');
    expect(colors()).toEqual([['화이트', '']]);
    expect(facts()).toEqual([['업체', '다담 협력 주방']]);
    // 칸 제목 — 색상 · 업체 정보. 예상 견적 칸은 없다 (2026-11-21 대표님 「견적은 일단 빼자」)
    expect([...box.querySelectorAll('.pv-h')].map((h) => h.textContent)).toEqual([
      '색상',
      '업체 정보',
    ]);
    expect(box.querySelector('.pv-quote, .pv-qrow, .pv-step-btn')).toBeNull();
    expect(box.textContent).not.toMatch(/견적|합계|부가세|가로 길이/);
    expect(likeBtn().getAttribute('aria-pressed')).toBe('false');
    expect(likeBtn().querySelector('.pv-count').textContent).toBe('4');
    // 장소와 좋아요는 한 줄
    expect(box.querySelector('.pv-bar .pv-place')).not.toBeNull();
    expect(box.querySelector('.pv-bar .pv-like')).not.toBeNull();
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

  test('업체 글 — 업체 이름 · 본사는 「다담가구」 · 업체 없는 직접 올린 사진은 업체 줄 없음', async () => {
    await load();
    await openTile(1); // 직접 올린 사진 · 장소 · 색상 · 업체 없음
    expect(sheet().querySelector('.sg-sheet-title').textContent).toBe('시공사례');
    expect(place()).toBe('싱크대');
    expect(colors()).toEqual([['오크', '']]);
    expect(sheet().querySelector('.pv-facts')).toBeNull(); // 업체를 모르면 업체 정보 칸이 없다
    expect(sheet().textContent).not.toMatch(/업체 정보/);
    await openTile(3); // 본사 업체(DB 이름 「다담 공장」)는 고객에게 「다담가구」
    expect(facts()).toEqual([['업체', '다담가구']]);
    await openTile(2); // 직접 올린 사진 · 업체 없음 · 장소 없음 · 색상 없음 — 그 칸들이 없다
    expect(sheet().querySelector('.pv-facts, .pv-place, .pv-colors')).toBeNull();
    expect(sheet().textContent).not.toMatch(/다담가구|색상|업체 정보/);
  });

  test('정적 사진(AI 연출) — 장소 = 품목 · 색상 = 자재 이름 · 업체 「AI 연출」(다담가구 · 지역 없음) · 큰 사진은 원본, 좋아요 없음', async () => {
    await load();
    await moreAll();
    await openTile(30);
    expect(place()).toBe('일자형 주방');
    // 색상은 하나씩 — 자재 색 값은 작은 색 칸으로
    expect(colors()).toEqual([
      ['매트 딥그린', '#2f4952'],
      ['카카오월넛', '#544135'],
    ]);
    expect(facts()).toEqual([['업체', 'AI 연출']]);
    expect(sheet().querySelector('.pv-photo img').getAttribute('src')).toBe(
      '../app/portfolio/mix-01.jpg'
    );
    expect(likeBtn()).toBeNull();
  });

  test('「이 스타일로 연출컷」 — 직접 올린 사진 make.html?ref=<id> · AI 연출 사진 make.html?ref=<파일 이름> · AI 연출컷은 없음', async () => {
    await load();
    const make = () => sheet().querySelector('a.pv-make');
    await openTile(0);
    expect(make().getAttribute('href')).toBe('make.html?ref=' + uid(0));
    expect(make().textContent).toBe('이 스타일로 연출컷');
    await openTile(1);
    expect(make().getAttribute('href')).toBe('make.html?ref=' + uid(1));
    await moreAll();
    await openTile(65);
    expect(make().getAttribute('href')).toBe('make.html?ref=mix-21');
    // AI 연출컷(다른 화면에서 여는 경우)은 단추가 없다
    expect(window.SeganPostView.refHref({ id: uid(9), source: 'ai_render' })).toBe('');
    // 만들기가 받는 모양 (segan/make.js takeLinkRefs · STATIC_STEM_RE · UUID_RE)
    const V = window.SeganPostView;
    expect(V.refHref({ id: 'not-a-uuid', source: 'upload' })).toBe('');
    expect(V.refHref({ id: '', stem: '', source: 'upload' })).toBe('');
  });

  test('모습 — 사진은 누르는 단추(크게 보기) · 칸 제목은 작은 글 · 색 칸은 목록보다 크게', () => {
    const css = read('segan/shell.css');
    const block = (sel) =>
      css.match(new RegExp(`\\n${sel.replace(/[.-]/g, '\\$&')} \\{([^}]*)\\}`))[1];
    expect(block('.pv-photo')).toMatch(/cursor:\s*zoom-in;/);
    expect(block('.pv-photo')).toMatch(/border:\s*0;/);
    expect(block('.pv-h')).toMatch(/font-size:\s*12px;/);
    expect(block('.pv-colors .cl-chip')).toMatch(/width:\s*16px;/);
    expect(block('.pv-bar')).toMatch(/justify-content:\s*space-between;/);
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

describe('AI 연출 사진 36장이 DB 게시물로 (DB 0076 — 2026-11-21 대표님 「하트 달아주고」)', () => {
  const SQL = read('database/migrations/0076_collection_seed_ai_photos.sql').replace(/\r\n/g, '\n');
  /** 0076 이 넣는 줄 — 차례 · 주소 · 구분 · 품목 · 색상 */
  const seeded = [
    ...SQL.matchAll(/^\s+\(\s*(\d+), '([^']+)', '([^']+)', '([^']+)', '([^']+)'\),?$/gm),
  ].map((m) => ({
    ord: Number(m[1]),
    image_url: m[2],
    category: m[3],
    place_label: m[4],
    door_color: m[5],
  }));
  /** 그 줄이 DB 에서 읽힌 모습 (최신순 = 차례 그대로) */
  const dbRows = () =>
    seeded.map((r, i) => ({
      id: uid(500 + i),
      image_url: r.image_url,
      place_label: r.place_label,
      door_color: r.door_color,
      company_id: null,
      like_count: i === 0 ? 2 : 0,
      source: 'ai_render',
      hq_picked_at: '2026-11-21T03:00:00Z',
      created_at: new Date(Date.UTC(2026, 10, 20) - r.ord * 60000).toISOString(),
    }));

  test('0076 = 앱의 STATIC 과 같은 36장 · 같은 차례 · 같은 품목 · 색상, 구분은 목록 파일대로', async () => {
    await load({ db: [] });
    const stat = window.SeganCollection.STATIC;
    const byFile = Object.fromEntries(
      JSON.parse(read('app/portfolio/luxe-manifest.json')).photos.map((p) => [p.file, p])
    );
    expect(seeded).toHaveLength(36);
    expect(seeded.map((r) => r.ord)).toEqual(stat.map((_, i) => i));
    seeded.forEach((r, i) => {
      const file = stat[i].image_url.replace(/^.*\//, '');
      expect(r).toEqual({
        ord: i,
        image_url: 'https://dadamfurniture.com/app/portfolio/' + file,
        category: byFile[file].category,
        place_label: stat[i].place,
        door_color: stat[i].color,
      });
      // 칸 제약 (DB 0049) — 색상 20자 · 장소 60자 안
      expect([...r.door_color].length).toBeLessThanOrEqual(20);
      expect([...r.place_label].length).toBeLessThanOrEqual(60);
      expect(['kitchen', 'builtin', 'storage', 'interior', 'other']).toContain(r.category);
    });
  });

  test('0076 — 본사가 고른 AI 연출컷으로 넣는다(탭에 보인다) · 학습 자료로는 쓰지 않는다 · 다시 돌려도 두 번 들어가지 않는다', () => {
    expect(SQL).toMatch(
      /INSERT INTO public\.collection_posts\s+\(image_url, category, place_label, door_color, source, hq_picked_at, consent_training, created_at, updated_at\)/
    );
    expect(SQL).toMatch(
      /SELECT v\.image_url, v\.category, v\.place_label, v\.door_color, 'ai_render', now\(\), false,/
    );
    expect(SQL).toMatch(/timestamptz '2026-11-20 00:00:00\+00' - make_interval\(mins => v\.ord\)/);
    expect(SQL).toMatch(
      /WHERE NOT EXISTS \(SELECT 1 FROM public\.collection_posts p WHERE p\.image_url = v\.image_url\)/
    );
    // 행만 넣는다 — 칸 · 정책 · 함수 · 다른 표는 건드리지 않는다
    const body = SQL.replace(/^--.*$/gm, '');
    expect(body).not.toMatch(/\b(ALTER|CREATE|DROP|GRANT|REVOKE|UPDATE|DELETE|TRUNCATE)\b/);
    expect(body.match(/\bINSERT\b/g)).toHaveLength(1);
    expect(body).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK)\b/);
  });

  test('DB 로 들어온 36장 — 칸마다 ♡, 가벼운 사본으로 그리고, STATIC 을 또 붙이지 않는다 (같은 사진 두 번 없음)', async () => {
    await load({ db: dbRows() });
    await moreAll();
    expect(tiles()).toHaveLength(36);
    expect(hearts()).toHaveLength(36);
    const srcs = tiles().map((t) => t.querySelector('img').getAttribute('src'));
    expect(new Set(srcs).size).toBe(36);
    // 앱에서 보이던 차례 그대로, 칸은 앱 안의 가벼운 사본 (사이트의 원본 주소를 그대로 받지 않는다)
    expect(srcs).toEqual(
      window.SeganCollection.STATIC.map((s) =>
        s.image_url.replace('/portfolio/', '/portfolio/display/')
      )
    );
    // 색상 영역 — 자재 색 칸도 그대로
    const first = cells()[0];
    expect([...first.querySelectorAll('.cl-colors li')].map((li) => li.textContent)).toEqual([
      '매트 딥그린',
      '카카오월넛',
    ]);
    expect(first.querySelectorAll('.cl-chip')).toHaveLength(2);
    expect($('clState').textContent).toBe('마지막 사례입니다');
  });

  test('DB 로 들어온 사진 — ♡ 가 저장되고, 사진 보기는 원본 · 업체 「AI 연출」 · 「이 스타일로 연출컷」은 파일 이름으로', async () => {
    const calls = await load({ db: dbRows(), session: SESSION });
    hearts()[0].click();
    await flush();
    expect(of(calls, 'collection_likes', 'insert').map((q) => q.row)).toEqual([
      { user_id: ME, post_id: uid(500) },
    ]);
    expect(hearts()[0].getAttribute('aria-pressed')).toBe('true');
    await openTile(0);
    expect(sheet().querySelector('.pv-photo img').getAttribute('src')).toBe(
      '../app/portfolio/mix-01.jpg'
    );
    expect(place()).toBe('일자형 주방');
    expect(facts()).toEqual([['업체', 'AI 연출']]);
    expect(likeBtn().getAttribute('aria-pressed')).toBe('true');
    expect(likeBtn().querySelector('.pv-count').textContent).toBe('3');
    expect(sheet().querySelector('a.pv-make').getAttribute('href')).toBe('make.html?ref=mix-01');
  });

  test('일부만 DB 에 있으면(누가 내림 · 적용 전) 없는 사진만 STATIC 에서 — 그 칸에는 ♡ 가 없다', async () => {
    await load({ db: dbRows().slice(0, 10) });
    await moreAll();
    expect(tiles()).toHaveLength(36);
    expect(hearts()).toHaveLength(10);
    const srcs = tiles().map((t) => t.querySelector('img').getAttribute('src'));
    expect(new Set(srcs).size).toBe(36);
    expect(cells()[10].querySelector('.cl-like')).toBeNull();
  });

  test('주소가 그 꼴일 때만 앱 안 사진으로 본다 — 다른 사이트 · 다른 폴더 · 다른 파일은 받은 주소 그대로', async () => {
    await load({ db: [] });
    const V = window.SeganPostView;
    const row = (image_url) => V.fromRow({ id: uid(1), image_url, source: 'ai_render' });
    expect(row('https://dadamfurniture.com/app/portfolio/luxe-01.jpg')).toMatchObject({
      image_url: '../app/portfolio/luxe-01.jpg',
      thumb: '../app/portfolio/display/luxe-01.jpg',
      stem: 'luxe-01',
    });
    for (const url of [
      'https://evil.example/app/portfolio/luxe-01.jpg',
      'https://dadamfurniture.com/app/portfolio/../../x.jpg',
      'https://dadamfurniture.com/app/portfolio/luxe-01.jpg?x=1',
      'https://dadamfurniture.com/app/other/luxe-01.jpg',
      'https://example.supabase.co/storage/v1/object/public/collection/ai/abc.jpg',
    ])
      expect(row(url)).toMatchObject({ image_url: url, thumb: url, stem: '' });
    // 그 사진이 아닌 AI 연출컷에는 「이 스타일로 연출컷」이 없다 (예전 그대로)
    expect(V.refHref(row('https://example.supabase.co/x.jpg'))).toBe('');
  });
});

describe('예상 견적은 없다 (2026-11-21 대표님 「견적은 일단 빼자」 — 넣었던 모습은 #1682)', () => {
  test('사진 보기 · 코드 · 스타일 어디에도 견적이 없다, 읽는 칸도 예전 그대로', async () => {
    await load();
    await moreAll();
    for (const i of [0, 1, 2, 30]) {
      await openTile(i);
      expect(sheet().querySelector('.pv-quote')).toBeNull();
      expect(sheet().textContent).not.toMatch(/견적|합계/);
    }
    const V = window.SeganPostView;
    expect([V.buildQuote, V.quoteKey, V.QUOTE_W]).toEqual([undefined, undefined, undefined]);
    expect(read('segan/collection-view.js')).not.toMatch(/QUOTE|buildQuote|pv-q|pv-step/);
    expect(read('segan/shell.css')).not.toMatch(/\.pv-quote|\.pv-q[a-z]|\.pv-step|\.pv-size/);
    expect(window.SeganCollection.COLS).not.toMatch(/category/);
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
