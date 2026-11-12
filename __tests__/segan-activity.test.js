/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Blob */
/**
 * SEGAN 「내 활동」 화면 (segan/activity.html + segan/activity.js) — 사이트 mypage.html 의 세 칸을 그대로:
 *   - 저장한 추천 팩토리  saved_partners 읽기 · 지우기, 관리자에게는 감춘다
 *   - 시공 완료 · 평가    내 설계 → 끝난 수주(orders.status completed) → design_feedback insert
 *   - 내 시공사례         collection_posts (source ai_render 제외) 읽기 · 올리기(collection 버킷) ·
 *                         학습 동의 켜고 끄기(consent_training) · 내리기(줄 먼저, 파일 다음)
 *   글 · 값 · 쿼리는 mypage.html 과 견준다. 통계 · 등급 토글 · 최근 설계는 옮기지 않는다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const MYPAGE = read('mypage.html');
const MYDOC = new DOMParser().parseFromString(MYPAGE, 'text/html');
const USER = { id: 'u1', email: 'customer@example.com' };
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => {
  for (let i = 0; i < 8; i++) await tick();
};

const PARTNERS = [
  {
    id: 's1',
    created_at: '2026-10-20T00:00:00Z',
    partners: {
      id: 'p1',
      company_name: '다온 인테리어',
      is_verified: true,
      partner_type: 'interior',
      sido: '서울특별시',
      gugun: '강남구',
      specialty_categories: ['sink', 'wardrobe', 'unknown'],
      phone: '010-1111-2222',
    },
  },
  {
    id: 's2',
    created_at: '2026-10-10T00:00:00Z',
    partners: {
      id: 'p2',
      company_name: '대구 공장',
      is_verified: false,
      partner_type: 'factory',
      sido: '대구광역시',
      gugun: '북구',
      specialty_categories: [],
      phone: null,
    },
  },
];
const CASES = [
  {
    id: 'c1',
    image_url: 'https://example.supabase.co/storage/v1/object/public/collection/u1/a.jpg',
    storage_path: 'u1/a.jpg',
    region: '서울 강남구',
    created_at: '2026-10-20T00:00:00Z',
    consent_training: true,
    design_id: 'd1',
  },
  {
    id: 'c2',
    image_url: 'https://example.supabase.co/storage/v1/object/public/collection/u1/b.jpg',
    storage_path: 'u1/b.jpg',
    region: '',
    created_at: '2026-10-10T00:00:00Z',
    consent_training: null,
    design_id: null,
  },
];

async function load(options = {}) {
  const opts = {
    session: { access_token: 'tok-1', user: USER },
    isAdmin: false,
    partners: PARTNERS,
    designs: [
      { id: 'd1', name: '거실 붙박이장', updated_at: '2026-10-01T00:00:00Z' },
      { id: 'd2', name: '주방', updated_at: '2026-10-05T00:00:00Z' },
    ],
    orders: [
      {
        design_id: 'd1',
        order_no: 'SO-1',
        completed_at: '2026-10-15T00:00:00Z',
        status: 'completed',
      },
    ],
    feedback: [],
    posts: CASES,
    postsByDesign: [{ id: 'c1', region: '서울 강남구', created_at: '2026-10-20T00:00:00Z' }],
    insertError: {},
    updateError: null,
    deleteError: null,
    uploadError: null,
    designsError: null,
    ...options,
  };
  // 화면이 줄을 고친다 (학습 동의) — 시험마다 새 사본을 준다
  opts.posts = JSON.parse(JSON.stringify(opts.posts));
  const doc = new DOMParser().parseFromString(read('segan/activity.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  window.history.replaceState(null, '', '/segan/activity.html' + (opts.hash || ''));
  sessionStorage.clear();
  for (const k of ['AdminAccess', 'DadamMyPageWork', 'SeganShell', 'SeganRegions', 'SeganActivity'])
    delete window[k];
  window.DADAM_CONFIG = { supabase: { url: 'https://example.supabase.co', anonKey: 'anon' } };
  // jsdom 의 crypto 에는 randomUUID 가 없다 — 브라우저처럼 쓰도록 Node 의 것을 단다 (사진 경로 'p/<UUID>')
  if (typeof window.crypto.randomUUID !== 'function') window.crypto.randomUUID = () => require('crypto').randomUUID();
  const calls = { q: [], inserts: [], updates: [], deletes: [], uploads: [], removes: [], rpc: [] };
  const resultOf = (q) => {
    const t = q.table;
    if (q.op === 'insert') return { data: null, error: opts.insertError[t] || null };
    if (q.op === 'update') return { data: null, error: opts.updateError };
    if (q.op === 'delete') return { data: null, error: opts.deleteError };
    if (t === 'saved_partners') return { data: opts.partners, error: null };
    if (t === 'designs') {
      if (opts.designsError) return { data: null, error: opts.designsError };
      if (q.cols === 'id') return { data: opts.designs.map((d) => ({ id: d.id })), error: null };
      return { data: opts.designs, error: null };
    }
    if (t === 'orders') return { data: opts.orders, error: null };
    if (t === 'design_feedback') return { data: opts.feedback, error: null };
    if (t === 'collection_posts') {
      if (q.filters.some((f) => f[0] === 'eq' && f[1] === 'design_id'))
        return { data: opts.postsByDesign, error: null };
      return { data: opts.posts, error: null };
    }
    return { data: null, error: null };
  };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async (name) => {
        calls.rpc.push(name);
        return { data: name === 'is_admin' ? opts.isAdmin : null, error: null };
      },
      storage: {
        from: (bucket) => ({
          upload: async (p, blob, o) => {
            calls.uploads.push({ bucket, path: p, type: blob.type, opts: o });
            return { data: null, error: opts.uploadError };
          },
          getPublicUrl: (p) => ({ data: { publicUrl: `https://cdn.example/${bucket}/${p}` } }),
          remove: async (paths) => {
            calls.removes.push({ bucket, paths });
            return { error: null };
          },
        }),
      },
      from: (table) => {
        const q = { table, op: 'select', cols: '', filters: [] };
        calls.q.push(q);
        const chain = {
          select: (cols) => {
            q.cols = cols;
            return chain;
          },
          insert: (row) => {
            q.op = 'insert';
            calls.inserts.push({ table, row });
            return chain;
          },
          update: (row) => {
            q.op = 'update';
            calls.updates.push({ table, row, q });
            return chain;
          },
          delete: () => {
            q.op = 'delete';
            calls.deletes.push({ table, q });
            return chain;
          },
          eq: (c, v) => {
            q.filters.push(['eq', c, v]);
            return chain;
          },
          neq: (c, v) => {
            q.filters.push(['neq', c, v]);
            return chain;
          },
          in: (c, v) => {
            q.filters.push(['in', c, v]);
            return chain;
          },
          order: (c, o) => {
            q.filters.push(['order', c, o]);
            return chain;
          },
          limit: (n) => {
            q.filters.push(['limit', n]);
            return chain;
          },
          then: (resolve, reject) => {
            try {
              resolve(resultOf(q));
            } catch (e) {
              reject(e);
            }
          },
        };
        return chain;
      },
    }),
  };
  window.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  window.URL.createObjectURL = () => 'blob:preview';
  window.URL.revokeObjectURL = () => {};
  const scripts = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
  for (const src of scripts) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of ['segan/shell.js', 'segan/regions.js', 'segan/activity.js']) (0, eval)(read(f));
  // jsdom 에는 그림 읽기가 없다 — 줄이기는 받은 파일 그대로 돌려준다
  window.SeganActivity.shrinkImage = async (file) => file;
  await window.SeganShell.ready;
  await window.SeganActivity.ready;
  await flush();
  return calls;
}

const $ = (id) => document.getElementById(id);
const norm = (t) => String(t).replace(/\s+/g, ' ').trim();
const opts = (sel) => [...sel.options].map((o) => [o.value, norm(o.textContent)]);
const queriesOf = (calls, table) => calls.q.filter((q) => q.table === table);

afterEach(() => jest.restoreAllMocks());

describe('화면 — 내 정보 탭 안', () => {
  test('내 정보 탭 · noindex · 서비스 워커 · 내 정보에서 들어온다', async () => {
    await load();
    expect(document.body.getAttribute('data-tab')).toBe('me');
    expect(read('segan/activity.html')).toContain(
      '<meta name="robots" content="noindex,nofollow" />'
    );
    const sw = read('segan/sw.js');
    expect(sw).toContain("SCOPE + 'activity.html'");
    expect(sw).toContain("versioned(SCOPE + 'activity.js')");
    const me = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    expect(
      [...me.querySelectorAll('a.sg-row')].some((a) => a.getAttribute('href') === 'activity.html')
    ).toBe(true);
    // 아래 탭은 다섯 그대로 — 마이페이지 안 화면이라 「마이」가 켜진다
    const keys = [...document.querySelectorAll('nav.sg-tabbar a:not([hidden])')].map((a) =>
      a.getAttribute('data-tab-link')
    );
    expect(keys).toEqual(['make', 'collection', 'blog', 'about', 'me']);
    expect(
      document.querySelector('nav.sg-tabbar [aria-current="page"]').getAttribute('data-tab-link')
    ).toBe('me');
  });

  test('로그인 없으면 아무것도 읽지 않고, 로그인 안내는 이 화면으로 돌아온다', async () => {
    const calls = await load({ session: null });
    const a = document.querySelector('[data-auth-view="signed-out"] a.sg-btn');
    expect(a.getAttribute('href')).toBe(
      '../login.html?redirect=' + encodeURIComponent('segan/activity.html')
    );
    expect(calls.q).toEqual([]);
  });

  test('옮기지 않는 칸 — 통계 · 등급 토글 · 최근 설계가 없다', async () => {
    await load();
    for (const id of [
      'statDesigns',
      'statConsults',
      'tierToggle',
      'designList',
      'recentDesignsSection',
    ])
      expect(document.getElementById(id)).toBeNull();
    expect($('main').textContent).not.toMatch(/최근 설계|저장된 설계|Expert/);
  });
});

describe('저장한 추천 팩토리 — saved_partners (mypage.html 「내 추천 업체」)', () => {
  test('본인 것 · 최신순 · mypage.html 과 같은 칸, 회사 · 종류 · 지역 · 전문 품목 · 전화 · 상담 신청', async () => {
    const calls = await load();
    const q = queriesOf(calls, 'saved_partners')[0];
    const site = MYPAGE.match(
      /from\('saved_partners'\)\s*\.select\(\s*'(id, created_at, partners\([^']+)'/
    )[1];
    expect(q.cols).toBe(site);
    expect(q.filters).toEqual([
      ['eq', 'user_id', 'u1'],
      ['order', 'created_at', { ascending: false }],
    ]);
    const rows = [...$('acPartners').querySelectorAll('li')];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('b').textContent).toBe('다온 인테리어');
    expect(rows[0].querySelector('.me-badge').textContent).toBe('확인됨');
    expect(norm(rows[0].querySelector('.me-pt-info').textContent)).toBe(
      '인테리어 · 서울특별시 강남구'
    );
    expect([...rows[0].querySelectorAll('.ac-chips span')].map((s) => s.textContent)).toEqual([
      '싱크대',
      '붙박이장',
    ]);
    const links = [...rows[0].querySelectorAll('a')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['전화', 'tel:010-1111-2222'.replace(/-/g, '')],
      ['상담 신청', 'consult.html'],
    ]);
    // 확인 안 됨 · 공장 · 품목 없음 · 전화 없음
    expect(rows[1].querySelector('.me-badge')).toBeNull();
    expect(norm(rows[1].querySelector('.me-pt-info').textContent)).toBe(
      '제조공장 · 대구광역시 북구'
    );
    expect(rows[1].querySelector('.ac-chips')).toBeNull();
    expect(rows[1].querySelector('a[href^="tel:"]')).toBeNull();
    expect($('acPartnerEmpty').hidden).toBe(true);
  });

  test('전문 품목 이름 = mypage.html categoryLabels', async () => {
    await load();
    const site = Function(`return ${MYPAGE.match(/const categoryLabels = (\{[\s\S]*?\});/)[1]}`)();
    expect(window.SeganActivity.PARTNER_CATEGORY).toEqual(site);
  });

  test('지우기 — 한 번 더 묻고, saved_partners delete (id) 뒤 다시 읽는다, 그만두기면 그대로', async () => {
    const calls = await load();
    const li = () => $('acPartners').querySelector('[data-saved="s1"]');
    li().querySelector('[data-act="ask-partner"]').click();
    expect(li().querySelector('[data-ask]').hidden).toBe(false);
    expect(li().querySelector('[data-ask]').textContent).toContain(
      '이 팩토리를 저장 목록에서 지울까요?'
    );
    li().querySelector('[data-act="no"]').click();
    expect(li().querySelector('[data-ask]').hidden).toBe(true);
    expect(calls.deletes).toEqual([]);
    li().querySelector('[data-act="ask-partner"]').click();
    li().querySelector('[data-act="del-partner"]').click();
    await flush();
    expect(calls.deletes.map((d) => [d.table, d.q.filters])).toEqual([
      ['saved_partners', [['eq', 'id', 's1']]],
    ]);
    expect(MYPAGE).toContain("from('saved_partners').delete().eq('id', savedId)");
    expect(queriesOf(calls, 'saved_partners').filter((q) => q.op === 'select')).toHaveLength(2);
  });

  test('없으면 안내, 관리자에게는 칸째 감춘다 (mypage.html user-only)', async () => {
    await load({ partners: [] });
    expect($('acPartnerEmpty').hidden).toBe(false);
    expect($('acPartnerEmpty').textContent).toBe('저장한 추천 팩토리가 없습니다.');
    const calls = await load({ isAdmin: true });
    expect($('partners').hidden).toBe(true);
    expect(queriesOf(calls, 'saved_partners')).toEqual([]);
    expect(MYDOC.getElementById('savedPartnersSection').classList.contains('user-only')).toBe(true);
  });

  test('글은 글자로만 넣는다', async () => {
    const bad = '<img src=x onerror=alert(1)>';
    await load({
      partners: [{ id: 's9', partners: { ...PARTNERS[0].partners, company_name: bad, sido: bad } }],
    });
    expect($('acPartners').querySelector('img')).toBeNull();
    expect($('acPartners').textContent).toContain(bad);
  });
});

describe('시공 완료 · 평가 — design_feedback (mypage.html 「시공 완료」)', () => {
  test('내 설계 → 그 설계의 끝난 수주만 (끝난 날 최신순 50) · 이름 · 날짜 · 수주 번호 · 평가함', async () => {
    const calls = await load({
      feedback: [{ design_id: 'd1', created_at: '2026-10-16T00:00:00Z' }],
    });
    const [mine] = queriesOf(calls, 'designs');
    expect(mine.cols).toBe('id');
    expect(mine.filters).toEqual([['eq', 'user_id', 'u1']]);
    const order = queriesOf(calls, 'orders').find(
      (q) => q.cols === 'design_id, order_no, completed_at'
    );
    expect(order.filters).toEqual([
      ['in', 'design_id', ['d1', 'd2']],
      ['eq', 'status', 'completed'],
      ['order', 'completed_at', { ascending: false }],
      ['limit', 50],
    ]);
    expect($('feedback').hidden).toBe(false);
    const li = $('acProjects').querySelector('li');
    expect(li.querySelector('b').textContent).toBe('거실 붙박이장');
    expect(li.querySelector('small').textContent).toBe(
      new Date('2026-10-15T00:00:00Z').toLocaleDateString('ko-KR') + ' 시공 완료 · SO-1'
    );
    expect(li.querySelector('.me-badge').textContent).toBe('평가함');
    expect(li.querySelector('button').textContent).toBe('평가 추가');
  });

  test('끝난 수주가 없거나 못 읽으면 칸째 감춘다', async () => {
    await load({ orders: [] });
    expect($('feedback').hidden).toBe(true);
    await load({ designsError: { message: 'x' } });
    expect($('feedback').hidden).toBe(true);
  });

  test('평가 칸 = mypage.html (종류 값 · 이름, 점수 1~5 기본 3)', async () => {
    await load();
    expect(opts($('acFbType'))).toEqual(opts(MYDOC.getElementById('fbType')));
    for (const [app, site] of [
      ['acFbAccuracy', 'fbAccuracy'],
      ['acFbUsability', 'fbUsability'],
    ])
      for (const at of ['type', 'min', 'max', 'step', 'value'])
        expect([app, at, $(app).getAttribute(at)]).toEqual([
          app,
          at,
          MYDOC.getElementById(site).getAttribute(at),
        ]);
  });

  test('평가하기 — 그 설계의 사진을 고를 수 있고, design_feedback 한 줄 (본인 · 점수 · 고친 사유 · 사진)', async () => {
    const calls = await load();
    $('acProjects').querySelector('button[data-rate]').click();
    await flush();
    expect($('acFbForm').hidden).toBe(false);
    expect($('acFbTitleText').textContent).toBe('거실 붙박이장 평가');
    expect($('acFbPostGroup').hidden).toBe(false);
    expect(opts($('acFbPost'))).toEqual([
      ['', '특정하지 않음'],
      ['c1', '서울 강남구 · ' + new Date('2026-10-20T00:00:00Z').toLocaleDateString('ko-KR')],
    ]);
    $('acFbType').value = 'praise';
    $('acFbAccuracy').value = '5';
    $('acFbAccuracy').dispatchEvent(new window.Event('input'));
    expect($('acFbAccuracyVal').textContent).toBe('5');
    $('acFbUsability').value = '4';
    $('acFbModified').checked = true;
    $('acFbModified').dispatchEvent(new window.Event('change'));
    expect($('acFbReasonGroup').hidden).toBe(false);
    $('acFbReason').value = ' 상부장 폭을 20mm 줄임 ';
    $('acFbText').value = '좋아요';
    $('acFbPost').value = 'c1';
    $('acFbForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    expect(calls.inserts.filter((i) => i.table === 'design_feedback')).toEqual([
      {
        table: 'design_feedback',
        row: {
          design_id: 'd1',
          user_id: 'u1',
          feedback_type: 'praise',
          accuracy_score: 5,
          usability_score: 4,
          was_modified: true,
          modification_reason: '상부장 폭을 20mm 줄임',
          feedback_text: '좋아요',
          post_id: 'c1',
        },
      },
    ]);
    expect($('acFbForm').hidden).toBe(true);
    // mypage.html 이 보내는 칸과 같다
    const site = MYPAGE.match(
      /const row = \{\s*design_id: feedbackTarget\.design_id,([\s\S]*?)\};/
    )[1];
    const keys = ['design_id'].concat([...site.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]));
    expect(Object.keys(calls.inserts.find((i) => i.table === 'design_feedback').row)).toEqual(keys);
  });

  test('고쳤다고 하지 않으면 사유를 보내지 않고, 빈 말씀 · 사진은 null, 실패하면 그 글', async () => {
    const calls = await load({
      postsByDesign: [],
      insertError: { design_feedback: { message: 'denied' } },
    });
    $('acProjects').querySelector('button[data-rate]').click();
    await flush();
    expect($('acFbPostGroup').hidden).toBe(true);
    $('acFbReason').value = '안 보냄';
    $('acFbForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    const { row } = calls.inserts.find((i) => i.table === 'design_feedback');
    expect(row).toMatchObject({
      feedback_type: 'completion',
      accuracy_score: 3,
      usability_score: 3,
      was_modified: false,
      modification_reason: null,
      feedback_text: null,
      post_id: null,
    });
    expect($('acFbStatus').textContent).toBe('저장하지 못했습니다: denied');
    expect($('acFbForm').hidden).toBe(false);
  });
});

describe('내 시공사례 — collection_posts (mypage.html 「내 시공사례」)', () => {
  test('본인 것 · 연출컷(ai_render) 빼고 · 최신순, 지역 · 설계 연결 · 학습 동의 (true 일 때만 켜짐)', async () => {
    const calls = await load();
    const q = queriesOf(calls, 'collection_posts').find((x) =>
      x.filters.some((f) => f[0] === 'neq')
    );
    const site = MYPAGE.match(/from\('collection_posts'\)\s*\.select\('(id, image_url[^']*)'\)/)[1];
    expect(q.cols).toBe(site);
    expect(q.filters).toEqual([
      ['eq', 'user_id', 'u1'],
      ['neq', 'source', 'ai_render'],
      ['order', 'created_at', { ascending: false }],
    ]);
    const cards = [...$('acCases').querySelectorAll('li')];
    expect(cards.map((c) => c.querySelector('.ac-meta').textContent)).toEqual([
      '서울 강남구 · 설계 연결됨',
      '지역 미입력',
    ]);
    const consent = cards.map((c) => c.querySelector('[data-act="consent"]'));
    expect(consent.map((b) => [b.getAttribute('aria-pressed'), b.textContent])).toEqual([
      ['true', 'AI 학습 허용'],
      ['false', 'AI 학습 안 함'],
    ]);
    expect(cards[0].querySelector('img').getAttribute('src')).toBe(CASES[0].image_url);
  });

  test('학습 동의 켜고 끄기 — consent_training update, 실패하면 되돌린다', async () => {
    const calls = await load();
    const btn = () => $('acCases').querySelectorAll('[data-act="consent"]')[1];
    btn().click();
    await flush();
    expect(calls.updates.map((u) => [u.table, u.row, u.q.filters])).toEqual([
      ['collection_posts', { consent_training: true }, [['eq', 'id', 'c2']]],
    ]);
    expect(btn().getAttribute('aria-pressed')).toBe('true');
    expect(MYPAGE).toMatch(/\.update\(\{ consent_training: next \}\)/);
    await load({ updateError: { message: 'x' } });
    btn().click();
    await flush();
    expect(btn().getAttribute('aria-pressed')).toBe('false');
    expect(btn().textContent).toBe('AI 학습 안 함');
  });

  test('내리기 — 한 번 더 묻고, 줄을 먼저 지운 뒤 collection 버킷 파일을 지운다', async () => {
    const calls = await load();
    const li = () => $('acCases').querySelector('[data-case="0"]');
    li().querySelector('[data-act="ask-case"]').click();
    expect(li().querySelector('[data-ask]').textContent).toContain(
      '이 사진을 시공사례에서 내릴까요?'
    );
    li().querySelector('[data-act="del-case"]').click();
    await flush();
    expect(calls.deletes.map((d) => [d.table, d.q.filters])).toEqual([
      ['collection_posts', [['eq', 'id', 'c1']]],
    ]);
    expect(calls.removes).toEqual([{ bucket: 'collection', paths: ['u1/a.jpg'] }]);
    // 지우기 실패면 파일은 그대로
    const c2 = await load({ deleteError: { message: 'x' } });
    $('acCases').querySelector('[data-case="0"] [data-act="ask-case"]').click();
    $('acCases').querySelector('[data-case="0"] [data-act="del-case"]').click();
    await flush();
    expect(c2.removes).toEqual([]);
    expect($('acCaseError').hidden).toBe(false);
  });

  test('올리기 칸 = mypage.html (구분 값 · 이름, 지역 목록, 학습 동의 기본 해제)', async () => {
    await load();
    $('acCaseOpen').click();
    await flush();
    expect(opts($('acCaseCategory'))).toEqual(opts(MYDOC.getElementById('caseCategory')));
    const gugunData = Function(
      `return ${MYPAGE.match(/const gugunData = (\{[\s\S]*?\n {6}\});/)[1]}`
    )();
    expect([...$('acCaseSido').options].map((o) => o.value)).toEqual([
      '',
      ...Object.keys(gugunData),
    ]);
    expect(opts($('acCaseGugun'))).toEqual([['', '시/도를 먼저 선택하세요']]);
    $('acCaseSido').value = '경기도';
    $('acCaseSido').dispatchEvent(new window.Event('change'));
    expect([...$('acCaseGugun').options].map((o) => o.value)).toEqual(['', ...gugunData['경기도']]);
    expect($('acCaseConsent').checked).toBe(false);
    expect(read('segan/activity.html').match(/<input[^>]*id="acCaseConsent"[^>]*>/)[0]).not.toMatch(
      /\bchecked\b/
    );
    expect($('acCaseFile').getAttribute('accept')).toBe(
      MYDOC.getElementById('caseFile').getAttribute('accept')
    );
    // 시/도 줄임 = mypage.html SIDO_SHORT, 크기 · 긴 변 = mypage.html
    const short = Function(`return ${MYPAGE.match(/const SIDO_SHORT = (\{[\s\S]*?\});/)[1]}`)();
    expect(window.SeganActivity.SIDO_SHORT).toEqual(short);
    expect(MYPAGE).toContain('const CASE_MAX_BYTES = 20 * 1024 * 1024;');
    expect(window.SeganActivity.CASE_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(MYPAGE).toContain('const CASE_MAX_EDGE = 1600;');
    expect(window.SeganActivity.CASE_MAX_EDGE).toBe(1600);
  });

  test('올리기 설계 목록 — 내 설계 최근 50, 시공 완료를 위로 · 표시', async () => {
    const calls = await load();
    $('acCaseOpen').click();
    await flush();
    expect(opts($('acCaseDesign'))).toEqual([
      ['', '연결 안 함'],
      ['d1', '✓ 시공 완료 · 거실 붙박이장'],
      ['d2', '주방'],
    ]);
    const q = queriesOf(calls, 'designs').find((x) => x.cols === 'id, name, updated_at');
    expect(q.filters).toEqual([
      ['eq', 'user_id', 'u1'],
      ['order', 'updated_at', { ascending: false }],
      ['limit', 50],
    ]);
  });

  const pickFile = (file) => {
    Object.defineProperty($('acCaseFile'), 'files', { value: [file], configurable: true });
    $('acCaseFile').dispatchEvent(new window.Event('change'));
  };

  test('올리기 — collection 버킷 p/<UUID>(회원 id 없음) 에 올리고 공개 주소로 collection_posts 한 줄 (mypage.html 과 같은 칸)', async () => {
    const calls = await load();
    $('acCaseOpen').click();
    await flush();
    pickFile(new Blob(['x'], { type: 'image/png' }));
    expect($('acCasePreview').hidden).toBe(false);
    $('acCaseSido').value = '서울특별시';
    $('acCaseSido').dispatchEvent(new window.Event('change'));
    $('acCaseGugun').value = '강남구';
    $('acCaseCategory').value = 'builtin';
    $('acCaseDesign').value = 'd1';
    $('acCaseConsent').checked = true;
    $('acCaseForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    expect(calls.uploads).toHaveLength(1);
    const up = calls.uploads[0];
    expect(up.bucket).toBe('collection');
    // 주소에 회원 id 가 없다 — 'p/<소문자 UUID>.png' (DB 0052 collection_insert_photo)
    expect(up.path).toMatch(/^p\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/);
    expect(up.path).not.toContain('u1');
    expect(up.opts).toEqual({ cacheControl: '3600', upsert: false, contentType: 'image/png' });
    const ins = calls.inserts.find((i) => i.table === 'collection_posts');
    expect(ins.row).toEqual({
      user_id: 'u1',
      image_url: 'https://cdn.example/collection/' + up.path,
      storage_path: up.path,
      region: '서울 강남구',
      category: 'builtin',
      consent_training: true,
      design_id: 'd1',
    });
    // mypage.html 이 넣는 칸과 같다
    const site = MYPAGE.match(/from\('collection_posts'\)\.insert\(\{([\s\S]*?)\}\);/)[1];
    expect(Object.keys(ins.row)).toEqual([...site.matchAll(/^\s+(\w+)[,:]/gm)].map((m) => m[1]));
    expect($('acCaseForm').hidden).toBe(true);
  });

  test('올리기 — 사진 없음 · 20MB 넘음 · 업로드 실패 · 줄 실패(올린 파일을 지운다), 동의 안 하면 false', async () => {
    let calls = await load();
    $('acCaseOpen').click();
    $('acCaseForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    expect($('acCaseStatus').textContent).toBe('사진을 선택해주세요.');
    pickFile({ size: 20 * 1024 * 1024 + 1, type: 'image/jpeg' });
    expect($('acCaseStatus').textContent).toBe('20MB 이하 사진만 올릴 수 있습니다.');

    calls = await load({ uploadError: { message: 'quota' } });
    $('acCaseOpen').click();
    pickFile(new Blob(['x'], { type: 'image/jpeg' }));
    $('acCaseForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    expect($('acCaseStatus').textContent).toBe('사진 업로드 실패: quota');
    expect(calls.inserts).toEqual([]);

    calls = await load({ insertError: { collection_posts: { message: 'rls' } } });
    $('acCaseOpen').click();
    pickFile(new Blob(['x'], { type: 'image/jpeg' }));
    $('acCaseForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    expect($('acCaseStatus').textContent).toBe('저장 실패: rls');
    expect(calls.inserts[0].row).toMatchObject({
      consent_training: false,
      design_id: null,
      region: '',
    });
    expect(calls.removes).toEqual([{ bucket: 'collection', paths: [calls.uploads[0].path] }]);
    expect(calls.uploads[0].path).toMatch(/\.jpg$/);
  });
});
