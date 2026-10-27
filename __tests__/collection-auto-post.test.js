/**
 * 시공사례 자동 게시 — 화면 · SQL (2026-10-27).
 *
 * 워커(workers/generate-api/src/collection-post.js)가 AI 스튜디오 연출컷의 대표 한 장을 collection_posts 에 올린다
 * (source 'ai_render', generation_id). 고정하는 것:
 *   1) 품목 짝 — 워커의 generations.category → collection_posts.category 가 ai-design.html KINDS 의 collection 과 같다
 *   2) collection.html — 자동 게시 타일은 「AI 연출컷」 으로 적고 배경 이미지로만 그린다(img·다운로드 없음).
 *      관리자에게만 「내리기」, 누르면 행을 먼저 지우고 파일을 지운다
 *   3) my-designs.html 「시공사례에서 내리기」(올라간 연출컷에만) · mypage.html 내 시공사례에서 제외 · ai-design.html 안내
 *   4) database/collection-auto-post.sql — 열·제약·관리자 삭제 정책, 다시 돌려도 같다
 */

const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

function loadEsm(rel, names, deps = {}) {
  const src = read(rel)
    .replace(/^import [\s\S]*?;\n/gm, '')
    .replace(/^export /gm, '');
  const keys = Object.keys(deps);
  return new Function(...keys, src + `\nreturn { ${names.join(', ')} };`)(...keys.map((k) => deps[k]));
}

describe('품목 짝', () => {
  test('워커 COLLECTION_CATEGORY 는 ai-design.html KINDS 의 collection 짝과 같다', () => {
    const { COLLECTION_CATEGORY } = loadEsm('workers/generate-api/src/collection-post.js', ['COLLECTION_CATEGORY']);
    const html = read('ai-design.html');
    const kinds = {};
    const re = /key: '([a-z]+)',[^}]*?collection: \['([a-z]+)'\]/g;
    let m;
    while ((m = re.exec(html))) kinds[m[1]] = m[2];
    expect(Object.keys(kinds)).toHaveLength(10);
    expect({ ...COLLECTION_CATEGORY }).toEqual(kinds);
  });
});

// ─── collection.html — jsdom 에서 실제로 돌린다 ───

function collectionScript() {
  const html = read('collection.html');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
  expect(scripts).toHaveLength(1);
  return { html, script: scripts[0] };
}

/** supabase-js 흉내 — collection_posts 목록·삭제, collection 버킷 삭제를 기록한다 */
function fakeSupabase(rows, { deleteOk = true } = {}) {
  const calls = [];
  function builder(table) {
    const st = { table, op: 'select', filters: [] };
    const b = {
      select(cols) {
        if (st.op === 'delete') st.returning = cols;
        else st.cols = cols;
        return b;
      },
      order() {
        return b;
      },
      limit() {
        return b;
      },
      lt(c, v) {
        st.filters.push(['lt', c, v]);
        return b;
      },
      eq(c, v) {
        st.filters.push(['eq', c, v]);
        return b;
      },
      delete() {
        st.op = 'delete';
        return b;
      },
      then(resolve) {
        calls.push(st);
        if (st.op === 'delete') return resolve({ data: deleteOk ? [{ id: st.filters[0][2] }] : [], error: null });
        const page = st.filters.some((f) => f[0] === 'lt') ? [] : rows;
        return resolve({ data: page, error: null });
      },
    };
    return b;
  }
  return {
    calls,
    from: builder,
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            calls.push({ op: 'remove', bucket, paths });
            return { data: [], error: null };
          },
        };
      },
    },
  };
}

const ROWS = [
  { id: 'p-ai', image_url: 'https://x/storage/v1/object/public/collection/u1/gen-g1.png', region: '', source: 'ai_render', storage_path: 'u1/gen-g1.png', created_at: '2026-10-27T01:00:00Z' },
  { id: 'p-up', image_url: 'https://x/storage/v1/object/public/collection/u2/1.jpg', region: '서울 성수', source: 'upload', storage_path: 'u2/1.jpg', created_at: '2026-10-27T00:00:00Z' },
];

async function bootCollection({ admin, deleteOk = true }) {
  const { html, script } = collectionScript();
  document.body.innerHTML = html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '');
  const sb = fakeSupabase(ROWS, { deleteOk });
  window.DADAM_CONFIG = { supabase: { url: 'https://x', anonKey: 'anon' } };
  window.supabase = { createClient: () => sb };
  window.AdminAccess = { isAdmin: async () => admin };
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
  };
  window.confirm = () => true;
  new Function(script)();
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  return sb;
}

describe('collection.html', () => {
  afterEach(() => {
    delete window.AdminAccess;
    delete window.supabase;
    document.body.innerHTML = '';
  });

  test('자동 게시 타일은 「AI 연출컷」, 직접 올린 사진은 예전처럼 다담가구 · 지역 — 이미지는 배경으로만', async () => {
    const sb = await bootCollection({ admin: false });
    expect(sb.calls[0].cols).toBe('id, image_url, region, source, storage_path, created_at');
    const figs = document.querySelectorAll('#tiles figure');
    const ai = figs[0];
    expect(ai.querySelector('.v5-tile-brand').textContent).toBe('AI 연출컷');
    expect(ai.querySelector('.v5-tile-img').getAttribute('aria-label')).toBe('AI 연출컷');
    expect(ai.querySelector('.v5-tile-region')).toBeNull();
    const up = figs[1];
    expect(up.querySelector('.v5-tile-brand').textContent).toBe('다담가구');
    expect(up.querySelector('.v5-tile-region').textContent).toBe('서울 성수');
    // 내려받을 길을 만들지 않는다 — img · a[download] 없음, 배경 이미지만
    expect(document.querySelectorAll('#tiles img, #tiles a').length).toBe(0);
    expect(ai.querySelector('.v5-tile-img').getAttribute('style')).toContain('background-image:url(');
    // 관리자가 아니면 「내리기」 없음
    expect(document.querySelectorAll('[data-take-down]').length).toBe(0);
  });

  test('관리자: DB 게시물마다 「내리기」 (정적 사례에는 없다) — 행을 먼저, 그다음 collection 버킷 파일', async () => {
    const sb = await bootCollection({ admin: true });
    const btns = document.querySelectorAll('[data-take-down]');
    expect([...btns].map((b) => b.getAttribute('data-take-down'))).toEqual(['p-ai', 'p-up']);
    btns[0].click();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    const ops = sb.calls.filter((c) => c.op === 'delete' || c.op === 'remove');
    expect(ops[0]).toMatchObject({ table: 'collection_posts', op: 'delete', filters: [['eq', 'id', 'p-ai']], returning: 'id' });
    expect(ops[1]).toEqual({ op: 'remove', bucket: 'collection', paths: ['u1/gen-g1.png'] });
    expect(document.querySelector('[data-post="p-ai"]')).toBeNull();
    expect(document.querySelector('[data-post="p-up"]')).not.toBeNull();
  });

  test('관리자: 행이 지워지지 않았으면(권한 없음) 파일을 지우지 않고 타일도 남긴다', async () => {
    const sb = await bootCollection({ admin: true, deleteOk: false });
    document.querySelector('[data-take-down="p-ai"]').click();
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(sb.calls.filter((c) => c.op === 'remove')).toHaveLength(0);
    expect(document.querySelector('[data-post="p-ai"]')).not.toBeNull();
    expect(document.getElementById('tileState').textContent).toMatch(/내리지 못했습니다/);
  });
});

describe('my-designs.html · mypage.html · ai-design.html', () => {
  test('my-designs: 올라간 연출컷에만 「시공사례에서 내리기」 — 행을 먼저 지우고 collection 파일을 지운다', () => {
    const html = read('my-designs.html');
    const load = html.slice(html.indexOf('async function loadPosts()'), html.indexOf('async function signImages('));
    expect(load).toMatch(/\.from\('collection_posts'\)\s*\.select\('id, generation_id, storage_path'\)\s*\.eq\('user_id', user\.id\)\s*\.eq\('source', 'ai_render'\)/);
    expect(html).toMatch(/postsByGen\[r\.id\] \? '<button type="button" class="v5-link" data-act="unpost">시공사례에서 내리기<\/button>' : ''/);
    const fn = html.slice(html.indexOf('async function unpost('), html.indexOf('async function remove('));
    const del = fn.indexOf(".from('collection_posts').delete().eq('id', post.id).select('id')");
    const rm = fn.indexOf(".storage.from('collection').remove([post.storage_path])");
    expect(del).toBeGreaterThan(-1);
    expect(rm).toBeGreaterThan(del);
    // 다시 올리는 길은 없다
    expect(html).not.toMatch(/collection_posts'\)\s*\.insert/);
    expect(html).toMatch(/else if \(act === 'unpost'\) unpost\(r, b\);/);
  });

  test('mypage: 내 시공사례(직접 올린 사진)에서 자동 게시는 뺀다 — 학습 동의 버튼이 붙지 않게', () => {
    const html = read('mypage.html');
    const fn = html.slice(html.indexOf('async function loadMyCases()'), html.indexOf('async function deleteCase('));
    expect(fn).toMatch(/\.eq\('user_id', currentUser\.id\)[\s\S]*?\.neq\('source', 'ai_render'\)/);
  });

  test('ai-design: 생성 버튼 아래 안내 · 시공사례(설치 참고) 탭에서 자동 게시는 뺀다', () => {
    const html = read('ai-design.html');
    const run = html.slice(html.indexOf('<div class="v5-run">'), html.indexOf('<section class="v5-results"'));
    expect(run).toContain('완성되면 대표 연출컷 1장이 시공사례에 올라갑니다');
    const from = html.indexOf('async function loadGallery()');
    expect(from).toBeGreaterThan(-1);
    const gallery = html.slice(from, html.indexOf('.limit(300)', from));
    expect(gallery).toMatch(
      /\.from\('collection_posts'\)\s*\.select\('image_url, region, category, created_at'\)\s*\.neq\('source', 'ai_render'\)\s*\.order\('created_at', \{ ascending: false \}\)/
    );
    // 탭에 자동 게시가 오지 않으니 「AI 연출컷」 캡션 분기도 없다 (collection.html 의 표시는 그대로)
    expect(html).not.toMatch(/r\.source === 'ai_render'/);
    expect(read('collection.html')).toContain("(ai ? 'AI 연출컷' : '다담가구')");
  });
});

describe('database/collection-auto-post.sql', () => {
  const sql = read('database/collection-auto-post.sql')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  test('source · generation_id 열과 제약 — 다시 돌려도 같다', () => {
    expect(sql).toContain("ALTER TABLE public.collection_posts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload';");
    expect(sql).toMatch(/ADD CONSTRAINT collection_posts_source_check CHECK \(source IN \('upload', 'ai_render'\)\)/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS generation_id UUID REFERENCES public\.generations\(id\) ON DELETE CASCADE;/);
    // on_conflict=generation_id 가 쓰는 제약 — 부분 인덱스가 아니다
    expect(sql).toMatch(/ADD CONSTRAINT collection_posts_generation_id_key UNIQUE \(generation_id\)/);
    // 제약은 이미 있으면 건너뛴다
    expect((sql.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/g) || []).length).toBe(2);
  });

  test('관리자 삭제 — 행과 collection 버킷 파일', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "collection_posts_delete_admin" ON public.collection_posts;');
    expect(sql).toMatch(/CREATE POLICY "collection_posts_delete_admin" ON public\.collection_posts\s+FOR DELETE TO authenticated\s+USING \(public\.is_admin\(\)\);/);
    expect(sql).toContain('DROP POLICY IF EXISTS "collection_delete_admin" ON storage.objects;');
    expect(sql).toMatch(/CREATE POLICY "collection_delete_admin" ON storage\.objects\s+FOR DELETE TO authenticated\s+USING \(bucket_id = 'collection' AND public\.is_admin\(\)\);/);
    // 읽기·본인 삭제·버킷 공개 설정은 건드리지 않는다
    expect(sql).not.toMatch(/storage\.buckets/);
    expect(sql).not.toMatch(/FOR SELECT/);
    expect(sql).not.toMatch(/"collection_posts_delete"/);
    expect(sql).not.toMatch(/"collection_delete_own"/);
  });

  test('회원 쓰기 — 본인 행 · 직접 올린 사진(source upload, generation_id 없음)만 넣고 고친다', () => {
    const ins = sql.indexOf('CREATE POLICY "collection_posts_insert"');
    const upd = sql.indexOf('CREATE POLICY "collection_posts_update"');
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS "collection_posts_insert" ON public\.collection_posts;\s+CREATE POLICY "collection_posts_insert" ON public\.collection_posts\s+FOR INSERT\s+WITH CHECK \(auth\.uid\(\) = user_id AND source = 'upload' AND generation_id IS NULL\);/
    );
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS "collection_posts_update" ON public\.collection_posts;\s+CREATE POLICY "collection_posts_update" ON public\.collection_posts\s+FOR UPDATE\s+USING \(auth\.uid\(\) = user_id\)\s+WITH CHECK \(auth\.uid\(\) = user_id AND source = 'upload' AND generation_id IS NULL\);/
    );
    // 정책이 읽는 열은 같은 파일에서 먼저 만든다
    expect(sql.indexOf('ADD COLUMN IF NOT EXISTS source')).toBeLessThan(ins);
    expect(sql.indexOf('ADD COLUMN IF NOT EXISTS generation_id')).toBeLessThan(ins);
    expect(upd).toBeGreaterThan(ins);
    // 트랜잭션 안
    expect(sql.indexOf('BEGIN;')).toBeLessThan(ins);
    expect(sql.indexOf('COMMIT;')).toBeGreaterThan(upd);
  });

  test('회원 화면이 하는 쓰기는 새 정책을 그대로 지난다', () => {
    const my = read('mypage.html');
    // 시공사례 올리기 — source · generation_id 를 보내지 않는다 (기본값 'upload' · NULL)
    const insert = my.slice(my.indexOf(".from('collection_posts').insert({"), my.indexOf('if (dbErr)'));
    expect(insert).toContain('user_id: currentUser.id');
    expect(insert).not.toMatch(/source|generation_id/);
    // 학습 동의 — consent_training 만 고친다 (자동 게시 행은 목록에 없다)
    expect(my).toMatch(/\.from\('collection_posts'\)\s*\.update\(\{ consent_training: next \}\)\s*\.eq\('id', r\.id\)/);
    // 내 연출컷의 내리기는 삭제다 — 본인 삭제 정책(collection_posts_delete)은 이 파일이 건드리지 않는다
    const md = read('my-designs.html');
    expect(md).toContain(".from('collection_posts').delete().eq('id', post.id)");
    expect(md).not.toMatch(/collection_posts'\)\s*\.(update|insert|upsert)/);
  });
});
