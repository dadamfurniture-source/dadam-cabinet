/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, jest, setTimeout */
/**
 * SEGAN 「시공사례」 탭 (segan/collection.html + segan/collection.js).
 *
 *   - 사이트 collection.html 과 같은 읽기: collection_posts 최신순 · 24줄 키셋 · region 없는 DB 면 다시 묻기
 *     · DB 사례 뒤에 같은 STATIC
 *   - source 'ai_render' 는 「AI 연출컷」, 다운로드 단추 · 링크 없음, 관리자 「내리기」 없음
 *   - 누르면 앱 안에서 크게 (닫기 · 이전 · 다음 · Esc)
 *   - 자재 — 같은 화면 안의 둘째 칸 (탭 막대는 넷 그대로), 글 · 사진 = 사이트 material.html, #material 로 연다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function rows(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    image_url: `https://example.supabase.co/storage/v1/object/public/collection/p${i}.jpg`,
    region: i % 5 === 0 ? '' : `지역 ${i}`,
    source: i % 4 === 1 ? 'ai_render' : 'upload',
    created_at: new Date(Date.UTC(2026, 9, 27, 12) - i * 60000).toISOString(),
  }));
}

/** opts.db: DB 줄(최신순), opts.noRegion: region 칸이 없는 DB, opts.noSupabase */
async function load(options = {}) {
  const opts = { db: rows(30), noRegion: false, noSupabase: false, hash: '', ...options };
  const doc = new DOMParser().parseFromString(read('segan/collection.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  window.history.replaceState(null, '', '/segan/collection.html' + opts.hash);
  for (const k of ['SeganShell', 'SeganCollection']) delete window[k];
  window.DADAM_CONFIG = { supabase: { url: 'https://example.supabase.co', anonKey: 'anon' } };
  const calls = { selects: [], orders: [], limits: [], lts: [], auth: 0, writes: 0 };
  window.supabase = opts.noSupabase
    ? undefined
    : {
        createClient: () => ({
          auth: {
            getSession: async () => {
              calls.auth++;
              return { data: { session: null } };
            },
          },
          from: (table) => {
            expect(table).toBe('collection_posts');
            const q = { cols: '', cursor: null };
            const chain = {
              select: (cols) => {
                q.cols = cols;
                calls.selects.push(cols);
                return chain;
              },
              order: (col, o) => {
                calls.orders.push([col, o]);
                return chain;
              },
              limit: (n) => {
                q.limit = n;
                calls.limits.push(n);
                return chain;
              },
              lt: (col, v) => {
                calls.lts.push([col, v]);
                q.cursor = v;
                return chain;
              },
              delete: () => {
                calls.writes++;
                return chain;
              },
              then: (resolve) => {
                if (opts.noRegion && /region/.test(q.cols))
                  return resolve({
                    data: null,
                    error: { message: 'column region does not exist' },
                  });
                const list = opts.db
                  .filter((r) => !q.cursor || r.created_at < q.cursor)
                  .slice(0, q.limit);
                return resolve({
                  data: list.map((r) =>
                    /region/.test(q.cols)
                      ? r
                      : { id: r.id, image_url: r.image_url, created_at: r.created_at }
                  ),
                  error: null,
                });
              },
            };
            return chain;
          },
        }),
      };
  delete window.IntersectionObserver;
  (0, eval)(read('segan/shell.js'));
  (0, eval)(read('segan/collection.js'));
  await window.SeganCollection.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const tiles = () => [...document.querySelectorAll('#clTiles .cl-tile')];
const caps = () => tiles().map((t) => t.querySelector('figcaption').textContent);
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => jest.restoreAllMocks());

describe('읽기 — 사이트 collection.html 과 같은 방식', () => {
  test('정적 사례 = collection.html 의 STATIC (segan/ 에서 보므로 ../)', async () => {
    await load();
    const site = read('collection.html').match(/var STATIC = (\[[\s\S]*?\]);/)[1];
    const expected = Function(`return ${site}`)().map((s) => ({
      ...s,
      image_url: '../' + s.image_url,
    }));
    expect(window.SeganCollection.STATIC).toEqual(expected);
  });

  test('최신순 · 24줄 · 처음 9장, 로그인 없이 (세션을 묻지 않는다)', async () => {
    const calls = await load();
    expect(calls.selects[0]).toBe('id, image_url, region, source, created_at');
    expect(calls.orders[0]).toEqual(['created_at', { ascending: false }]);
    expect(calls.limits[0]).toBe(24);
    expect(calls.lts).toEqual([]);
    expect(calls.auth).toBe(0);
    expect(tiles()).toHaveLength(9);
    expect(tiles()[0].querySelector('.cl-img').getAttribute('style')).toContain('p0.jpg');
    expect($('clState').textContent).toBe('9 / 24+'); // 정적 사례는 DB 를 다 받은 뒤에 붙는다
    expect($('clMore').hidden).toBe(false);
  });

  test('AI 연출컷 표시 — source ai_render 는 「AI 연출컷」(지역 없이), 나머지는 「다담가구 · 지역」', async () => {
    await load();
    expect(caps()[0]).toBe('다담가구'); // p0 은 지역이 비었다 — 구분선도 없다
    expect(tiles()[0].querySelector('.cl-dot')).toBeNull();
    expect(caps()[1]).toBe('AI 연출컷'); // p1 은 ai_render
    expect(tiles()[1].querySelector('button').getAttribute('aria-label')).toBe(
      'AI 연출컷 크게 보기'
    );
    expect(caps()[2]).toBe('다담가구지역 2');
  });

  test('더 보기 — 6장씩, 24줄을 다 쓰면 다음 키셋(lt created_at), 끝에는 STATIC, 되풀이 없음', async () => {
    const calls = await load();
    for (let i = 0; i < 10; i++) {
      if ($('clMore').hidden) break;
      $('clMore').click();
      await flush();
    }
    expect(calls.lts).toEqual([['created_at', rows(30)[23].created_at]]);
    expect(tiles()).toHaveLength(45); // DB 30 + STATIC 15
    expect(tiles()[29].querySelector('.cl-img').getAttribute('style')).toContain('p29.jpg');
    expect(tiles()[30].querySelector('.cl-img').getAttribute('style')).toContain(
      '../app/portfolio/kitchen-n1-1.jpg'
    );
    expect($('clState').textContent).toBe('마지막 사례입니다');
    expect($('clMore').hidden).toBe(true);
    const ids = tiles().map((t) => t.querySelector('.cl-img').getAttribute('style'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('region 칸이 없는 DB — region 없이 다시 묻는다 (사이트와 같다)', async () => {
    const calls = await load({ noRegion: true });
    expect(calls.selects.slice(0, 2)).toEqual([
      'id, image_url, region, source, created_at',
      'id, image_url, created_at',
    ]);
    expect(caps()[0]).toBe('다담가구');
    expect(tiles()).toHaveLength(9);
  });

  test('라이브러리가 없으면 정적 사례만', async () => {
    await load({ noSupabase: true });
    expect(tiles()).toHaveLength(9);
    expect(window.SeganCollection.state.posts).toHaveLength(15);
  });
});

describe('다운로드 없음 · 관리자 내리기 없음', () => {
  test('이미지는 배경으로만 — img · a · download · 내리기가 없다', async () => {
    const calls = await load();
    $('clMore').click();
    await flush();
    const main = $('main');
    expect(main.querySelectorAll('img')).toHaveLength(0);
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    expect($('clTiles').querySelectorAll('a')).toHaveLength(0);
    expect($('clView').querySelectorAll('a, img')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/내리기|다운로드/);
    expect(document.querySelectorAll('[data-take-down]')).toHaveLength(0);
    expect(calls.writes).toBe(0);
  });
});

describe('크게 보기 — 앱 안에서', () => {
  test('누르면 겹창(dialog) · 설명 · 닫기에 초점, Esc 로 닫으면 누른 곳으로 초점이 돌아온다', async () => {
    await load();
    const btn = tiles()[2].querySelector('button');
    btn.focus();
    btn.click();
    const view = $('clView');
    expect(view.hidden).toBe(false);
    expect(view.getAttribute('role')).toBe('dialog');
    expect(view.getAttribute('aria-modal')).toBe('true');
    expect($('clViewCap').textContent).toBe('다담가구 · 지역 2');
    expect($('clViewImg').style.backgroundImage).toContain('p2.jpg');
    expect(document.activeElement).toBe($('clClose'));
    expect(document.body.classList.contains('cl-locked')).toBe(true);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(view.hidden).toBe(true);
    expect(document.activeElement).toBe(btn);
    expect(document.body.classList.contains('cl-locked')).toBe(false);
  });

  test('이전 · 다음 (처음 · 끝에서는 막힘), 바깥을 누르면 닫힘', async () => {
    await load();
    tiles()[0].querySelector('button').click();
    expect($('clPrev').disabled).toBe(true);
    $('clNext').click();
    expect($('clViewCap').textContent).toBe('AI 연출컷');
    $('clPrev').click();
    expect($('clViewImg').style.backgroundImage).toContain('p0.jpg');
    tiles()[8].querySelector('button').click();
    expect($('clNext').disabled).toBe(true);
    $('clView').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect($('clView').hidden).toBe(true);
  });
});

describe('자재 — 시공사례 화면 안의 둘째 칸 (사이트 material.html)', () => {
  const SITE = new DOMParser().parseFromString(read('material.html'), 'text/html');
  const norm = (t) => String(t).replace(/\s+/g, ' ').trim();
  const panel = () => $('clMaterial');
  const tab = (id) => $(id);
  const urlsOf = (root) =>
    [...root.querySelectorAll('[style*="background-image"]')].map(
      (el) => el.getAttribute('style').match(/url\('([^']+)'\)/)[1]
    );

  test('처음엔 시공사례 칸 — 고르는 칸 둘, 자재는 감춤', async () => {
    await load();
    expect(
      [...document.querySelectorAll('.cl-seg [role="tab"]')].map((b) => b.textContent.trim())
    ).toEqual(['시공사례', '자재']);
    expect(tab('clTabCases').getAttribute('aria-selected')).toBe('true');
    expect(tab('clTabMaterial').getAttribute('aria-selected')).toBe('false');
    expect($('clCases').hidden).toBe(false);
    expect(panel().hidden).toBe(true);
    expect(tab('clTabMaterial').getAttribute('aria-controls')).toBe('clMaterial');
    expect(panel().getAttribute('role')).toBe('tabpanel');
  });

  test('자재를 누르면 자재만 보이고 주소에 #material, 시공사례를 누르면 뗀다', async () => {
    await load();
    tab('clTabMaterial').click();
    expect(panel().hidden).toBe(false);
    expect($('clCases').hidden).toBe(true);
    expect(tab('clTabMaterial').getAttribute('aria-selected')).toBe('true');
    expect(window.location.hash).toBe('#material');
    tab('clTabCases').click();
    expect(panel().hidden).toBe(true);
    expect($('clCases').hidden).toBe(false);
    expect(window.location.hash).toBe('');
    // 화살표로 옆 칸
    tab('clTabCases').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(panel().hidden).toBe(false);
    expect(document.activeElement).toBe(tab('clTabMaterial'));
  });

  test('collection.html#material 로 오면 자재로 연다, 주소의 # 이 바뀌면 따라간다', async () => {
    await load({ hash: '#material' });
    expect(panel().hidden).toBe(false);
    expect($('clCases').hidden).toBe(true);
    window.history.replaceState(null, '', '/segan/collection.html');
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    expect($('clCases').hidden).toBe(false);
    // 시공사례는 그대로 읽는다
    expect(tiles()).toHaveLength(9);
  });

  test('아래 탭은 넷 그대로 — 자재 탭을 따로 만들지 않는다', async () => {
    await load();
    const keys = [...document.querySelectorAll('nav.sg-tabbar a:not([hidden])')].map((a) =>
      a.getAttribute('data-tab-link')
    );
    expect(keys).toEqual(['make', 'collection', 'renders', 'me']);
    expect(
      document.querySelector('nav.sg-tabbar [aria-current="page"]').getAttribute('data-tab-link')
    ).toBe('collection');
  });

  test('글 = material.html (제목 · 설명 · 시험 결과 · 성적서 · 재고 · 레하우 · 특장점 · 테마)', async () => {
    await load();
    const text = norm(panel().textContent);
    const selectors = [
      '.material-hero .subtitle',
      '.material-hero h1',
      '.material-hero p',
      '.section-header .tag',
      '.section-header h2',
      '.section-header p',
      '.board-highlight-text .badge-mr',
      '.board-highlight-text h3',
      '.board-highlight-text p',
      '.improvement-note',
      '.test-chart h4',
      '.bar-value',
      '.test-certs h4',
      '.test-cert-card span',
      '.eco-table-wrap + h3',
      '.inventory-card h4',
      '.inventory-card p',
      '.rehau-text .partner',
      '.rehau-text h3',
      '.rehau-text p',
      '.feature-card h4',
      '.feature-card p',
      '.theme-intro .year',
      '.theme-intro h2',
      '.theme-intro p',
      '.theme-number',
      '.theme-text h3',
      '.theme-text p',
    ];
    let count = 0;
    for (const sel of selectors) {
      const els = [...SITE.querySelectorAll(sel)];
      expect([sel, els.length > 0]).toEqual([sel, true]);
      for (const el of els) {
        const t = norm(el.textContent);
        count++;
        expect([sel, text.includes(t)]).toEqual([sel, true]);
      }
    }
    expect(count).toBeGreaterThan(50);
  });

  test('표 = material.html (친환경 등급 · 보드 사양, 칸마다 같은 글 · 같은 ✔)', async () => {
    await load();
    const cells = (table) =>
      [...table.querySelectorAll('tr')].map((tr) =>
        [...tr.children].map((c) => norm(c.textContent))
      );
    const site = [...SITE.querySelectorAll('table')].map(cells);
    const app = [...panel().querySelectorAll('table')].map(cells);
    expect(app).toEqual(site);
    expect(site).toHaveLength(2);
    // 칸 합치기(rowspan)도 같다
    const spans = (root) =>
      [...root.querySelectorAll('[rowspan]')].map((c) => c.getAttribute('rowspan'));
    expect(spans(panel())).toEqual(spans(SITE));
    // 좁은 화면에서는 표만 옆으로 민다
    for (const t of panel().querySelectorAll('table'))
      expect(t.parentElement.className).toBe('mt-table-wrap');
  });

  test('테마 키워드 · 색 이름 · 색 = material.html', async () => {
    await load();
    const texts = (root, sel) => [...root.querySelectorAll(sel)].map((el) => norm(el.textContent));
    expect(texts(panel(), '.mt-keys span')).toEqual(texts(SITE, '.theme-keywords span'));
    expect(texts(panel(), '.mt-chips li')).toEqual(texts(SITE, '.color-chip .name'));
    const colors = (root, sel) =>
      [...root.querySelectorAll(sel)].map(
        (el) => el.getAttribute('style').match(/#[0-9a-f]{6}/i)[0]
      );
    expect(colors(panel(), '.mt-swatch')).toEqual(colors(SITE, '.color-chip .swatch'));
  });

  test('사진 = material.html 의 사진 (같은 파일 · 같은 설명), 저장소에 없는 한 장만 뺐다', async () => {
    await load();
    const site = [...SITE.querySelectorAll('img')].map((img) => [
      img.getAttribute('src'),
      img.getAttribute('alt'),
    ]);
    const app = [...panel().querySelectorAll('.mt-img')].map((el) => [
      el.getAttribute('style').match(/url\('([^']+)'\)/)[1],
      el.getAttribute('aria-label'),
    ]);
    // segan/ 에서 보므로 ../
    const missing = site.filter(([src]) => !fs.existsSync(path.join(ROOT, src)));
    expect(missing.map((m) => m[0])).toEqual(['app/material/board-stat-area.jpg']);
    expect(app).toEqual(
      site
        .filter(([src]) => fs.existsSync(path.join(ROOT, src)))
        .map(([src, alt]) => ['../' + src, alt])
    );
    for (const u of urlsOf(panel()))
      expect([u, fs.existsSync(path.join(ROOT, 'segan', u))]).toEqual([u, true]);
    // 사진은 배경으로만 — img 를 쓰지 않는다 (시공사례와 같다), 설명은 role="img" + aria-label
    expect(panel().querySelectorAll('img, a')).toHaveLength(0);
    for (const el of panel().querySelectorAll('.mt-img'))
      expect(el.getAttribute('role')).toBe('img');
  });

  test('material.html 은 그대로 (사이트 페이지는 앱 주소를 모른다)', () => {
    expect(read('material.html')).not.toMatch(/segan/i);
  });
});

describe('페이지', () => {
  test('collection.html 이 config · supabase · shell · collection.js 를 싣고 검색에 열린다 (canonical)', () => {
    const html = read('segan/collection.html');
    expect(html).not.toMatch(/name="robots"/);
    expect(html).toContain('<link rel="canonical" href="https://dadamfurniture.com/segan/collection" />');
    expect(html).toMatch(/<script src="\.\.\/js\/config\.js\?v=\d+"><\/script>/);
    expect(html).toMatch(/<script src="collection\.js\?v=\d+" defer><\/script>/);
    expect(html).toMatch(/<body class="sg-app" data-tab="collection">/);
  });

  test('누르는 곳은 44px 이상 (크게 보기 단추)', () => {
    const css = read('segan/shell.css');
    const rule = css.match(/\n\.cl-view-btn \{([^}]*)\}/)[1];
    expect(rule).toMatch(/min-width: 44px/);
    expect(rule).toMatch(/min-height: 44px/);
  });
});
