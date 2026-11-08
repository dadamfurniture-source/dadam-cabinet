/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, jest, sessionStorage */
/**
 * SEGAN 「내 연출컷」 탭 (segan/renders.html + segan/renders.js) — 목록만.
 *
 * my-designs.html 과 같은 데이터 · 호출인지 확인한다 (my-designs.html 은 고치지 않는다):
 *   generations 목록(같은 칸 · internal_only 거르기 · 최신순 200) · js/storage-urls.js 서명 · 5초 다시 읽기
 *   collection_posts(ai_render) 표시
 * 하나를 누르면 만들기 ③ 결과 화면(./?g=<id>#result)으로 간다 — 결과 화면은 그것 하나다
 * (컷 · 견적 · 상담 신청 · 공유 · 내리기 · 학습 동의 · 다시 생성 · 삭제는 segan-make-result-manage.test.js).
 * 옛 주소 renders.html?g=<id> 는 목록을 그리기 전에 그 결과 주소로 넘긴다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const API = 'https://gen.example.workers.dev/api/generate';
const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'c@example.com' } };
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';
const pub = (id, i) =>
  `https://example.supabase.co/storage/v1/object/public/generations/user-1/${id}/v${i}.png`;

function gens() {
  const now = Date.now();
  return [
    {
      id: ID1,
      status: 'rendering',
      progress: 40,
      step_label: '가구 배치 중',
      category: 'sink',
      title: null,
      quote: null,
      images: [{ url: pub(ID1, 0), label: '싱크대 · 기본안' }],
      created_at: new Date(now - 60000).toISOString(),
    },
    {
      id: ID2,
      status: 'done',
      progress: 100,
      category: 'wardrobe',
      title: null,
      images: [0, 1, 2, 3].map((i) => ({
        url: pub(ID2, i),
        label: i ? `붙박이장 · 추천 ${i}` : '붙박이장 · 기본안',
      })),
      share_expires_at: null,
      share_revoked_at: null,
      created_at: new Date(now - 3600000).toISOString(),
    },
    {
      id: ID3,
      status: 'failed',
      error: '사진에서 벽을 찾지 못했습니다',
      category: 'fridge',
      title: null,
      quote: null,
      images: [],
      created_at: new Date(now - 7200000).toISOString(),
    },
  ];
}

async function load(options = {}) {
  const opts = {
    session: SESSION,
    url: '/segan/renders.html',
    rows: gens(),
    posts: [{ id: 'post-1', generation_id: ID2, storage_path: 'ai/post-1.jpg' }],
    ...options,
  };
  const doc = new DOMParser().parseFromString(read('segan/renders.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  window.history.replaceState(null, '', opts.url);
  for (const k of ['SeganShell', 'SeganMake', 'SeganRenders', 'DadamStorageUrls']) delete window[k];
  window.scrollTo = () => {};
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    generateApi: { url: API },
  };
  const calls = { gen: [], posts: [], signed: [], fetch: [] };
  const client = {
    auth: { getSession: async () => ({ data: { session: opts.session } }) },
    // 크레딧 통장 — my_credit_wallet (segan/make.js loadWallet)
    rpc: async (name) =>
      name === 'my_credit_wallet'
        ? { data: [{ scope: 'personal', balance: 1000, monthly: 100, usable: true }], error: null }
        : { data: null, error: { message: 'x' } },
    storage: {
      from: (bucket) => ({
        createSignedUrls: async (paths) => {
          calls.signed.push({ bucket, paths });
          return {
            data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}?t=1` })),
            error: null,
          };
        },
      }),
    },
    from: (table) => {
      const q = { table, filters: [] };
      const chain = {
        select: (cols) => {
          q.cols = cols;
          return chain;
        },
        eq: (c, v) => {
          q.filters.push(['eq', c, v]);
          return chain;
        },
        or: (expr) => {
          q.or = expr;
          return chain;
        },
        order: (c, o) => {
          q.order = [c, o];
          return chain;
        },
        limit: (n) => {
          q.limit = n;
          return chain;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve) => {
          if (table === 'generations') {
            calls.gen.push(q);
            return resolve({ data: JSON.parse(JSON.stringify(opts.rows)), error: null });
          }
          if (table === 'collection_posts') {
            calls.posts.push(q);
            return resolve({ data: opts.posts, error: null });
          }
          return resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };
  window.supabase = { createClient: () => client };
  // 목록은 생성 API 를 부르지 않는다 (결과 화면이 부른다)
  window.fetch = jest.fn(async (url, init = {}) => {
    calls.fetch.push({ url, method: init.method || 'GET' });
    throw new Error('예상하지 못한 요청: ' + url);
  });
  for (const f of ['js/storage-urls.js', 'segan/shell.js', 'segan/make.js', 'segan/renders.js'])
    (0, eval)(read(f));
  await window.SeganRenders.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const visible = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) if (n.hidden) return false;
  return true;
};
const card = (id) => document.querySelector(`[data-id="${id}"]`).closest('.rd-card');

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('목록 — my-designs.html 과 같은 읽기', () => {
  test('로그인 없으면 안내만 (아무것도 읽지 않는다)', async () => {
    const calls = await load({ session: null });
    expect(visible(document.querySelector('[data-auth-view="signed-out"]'))).toBe(true);
    expect(calls.gen).toEqual([]);
  });

  test('같은 거르기 · 순서 · 수, 이미지는 서명 URL (버킷 generations)', async () => {
    const calls = await load();
    const q = calls.gen[0];
    expect(q.filters).toEqual([['eq', 'user_id', 'user-1']]);
    expect(q.or).toBe('options->>internal_only.is.null,options->>internal_only.neq.true');
    expect(q.order).toEqual(['created_at', { ascending: false }]);
    expect(q.limit).toBe(200);
    // 읽는 칸은 my-designs.html 이 읽는 칸 안에 있다 (권한이 있는 칸만)
    const site = read('my-designs.html')
      .match(/\.from\('generations'\)\s*\.select\(\s*'([^']+)'/)[1]
      .split(',');
    for (const c of q.cols.split(',')) expect([c, site.includes(c)]).toEqual([c, true]);
    expect(calls.signed[0].bucket).toBe('generations');
    expect(card(ID2).querySelector('.rd-thumb').getAttribute('style')).toContain(
      'https://signed.example/user-1/'
    );
    expect($('rdState').textContent).toBe('3건');
  });

  test('진행 중 · 실패(환불 안내) · 시공사례 표시', async () => {
    await load();
    expect(card(ID1).querySelector('.rd-badge').textContent).toBe('가구 배치 중 · 40%');
    expect(card(ID3).querySelector('.rd-badge').textContent).toBe('실패');
    expect(card(ID3).textContent).toContain('만들지 못한 연출컷의 크레딧은 돌려드립니다.');
    expect(card(ID2).querySelector('.rd-badge')).toBeNull();
    expect(card(ID2).textContent).toContain('붙박이장 연출컷');
    expect(card(ID2).textContent).toContain('시공사례');
  });

  test('공유 중이면 「공유 중」 표시', async () => {
    const rows = gens();
    rows[1].share_expires_at = new Date(Date.now() + 5 * 86400000).toISOString();
    await load({ rows });
    expect(card(ID2).textContent).toContain('공유 중');
    expect(card(ID1).textContent).not.toContain('공유 중');
  });

  test('진행 중이 있으면 5초마다 다시 읽는다', async () => {
    jest.useFakeTimers();
    const calls = await load();
    expect(calls.gen).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(calls.gen).toHaveLength(2);
  });

  test('없으면 만들기로 가는 안내', async () => {
    await load({ rows: [], posts: [] });
    expect(visible($('rdEmpty'))).toBe(true);
    expect($('rdEmpty').querySelector('a').getAttribute('href')).toBe('./');
  });
});

describe('하나 열기 = 만들기 ③ 결과 화면 (결과 화면은 하나)', () => {
  test('카드는 ./?g=<id>#result 로 가는 링크 — 진행 중 · 실패한 것도 같은 화면', async () => {
    await load();
    for (const id of [ID1, ID2, ID3]) {
      const a = card(id).querySelector('a.rd-thumb');
      expect(a.getAttribute('href')).toBe(`./?g=${id}#result`);
    }
    expect(card(ID2).querySelector('a.rd-thumb').getAttribute('aria-label')).toBe(
      '붙박이장 연출컷 열기'
    );
    expect(window.SeganRenders.resultHref(ID2)).toBe(`./?g=${ID2}#result`);
    // ./ 는 segan/index.html (만들기) — 상담 신청의 「결과로 돌아가기」와 같은 주소 모양
    expect(new URL(`./?g=${ID2}#result`, 'https://x.example/segan/renders.html').pathname).toBe(
      '/segan/'
    );
    expect(read('segan/consult.js')).toContain("'./?g=' + encodeURIComponent(C.id) + '#result'");
  });

  test('목록 화면에는 하나 열기 화면이 없다 (#rdDetail · 관리 칸 · 화면 안 확인 줄 없음)', async () => {
    await load();
    for (const id of [
      'rdDetail',
      'rdBack',
      'rdShots',
      'rdQuote',
      'rdShare',
      'rdPost',
      'rdUnpostAsk',
      'rdConsent',
      'rdManage',
      'rdDeleteAsk',
      'rdMsg',
    ])
      expect([id, $(id)]).toEqual([id, null]);
    const js = read('segan/renders.js');
    for (const word of ['renderDetail', 'showDetail', 'popstate', 'unpost', 'consent_training'])
      expect([word, js.includes(word)]).toEqual([word, false]);
    expect(read('segan/make.css')).not.toMatch(
      /\.rd-(detail|shot|box|link|acts|confirm|title|sub)\b/
    );
  });
});

describe('결과 화면에서 지우고 왔을 때 — 「삭제했습니다」 한 번 (role="status")', () => {
  const KEY = 'segan.renders.notice';
  afterEach(() => sessionStorage.removeItem(KEY));

  test('make.js 가 남긴 코드를 읽어 알리고 바로 지운다 — 다시 열면 없다', async () => {
    sessionStorage.setItem(KEY, 'deleted');
    await load();
    const note = $('rdNotice');
    expect(note.getAttribute('role')).toBe('status');
    expect(visible(note)).toBe(true);
    expect(note.textContent).toBe('삭제했습니다');
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(window.SeganRenders.NOTICE_KEY).toBe(KEY);
    // 목록 수 · 불러오는 중 줄(rdState)과는 다른 칸이라 덮이지 않는다
    expect($('rdState').textContent).toBe('3건');
    expect(note.textContent).toBe('삭제했습니다');
    await load();
    expect($('rdNotice').textContent).toBe('');
  });

  test('알림 칸은 처음부터 문서에 있고 비어 있다 (글을 나중에 넣어야 화면 읽기가 읽는다) · 모르는 코드는 보이지 않는다', async () => {
    const html = read('segan/renders.html');
    expect(html).toMatch(/<p class="rd-notice" id="rdNotice" role="status"><\/p>/);
    sessionStorage.setItem(KEY, '<b>아무 글</b>');
    await load();
    expect($('rdNotice').textContent).toBe('');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});

describe('옛 주소 renders.html?g=<id> — 결과 화면으로 넘긴다', () => {
  /** renders.js 를 가짜 location 으로 돌린다 (jsdom 은 다른 문서로 옮기지 못한다) */
  function runWith(search) {
    const loc = {
      pathname: '/segan/renders.html',
      search,
      hash: '',
      replace: jest.fn(),
      assign: jest.fn(),
    };
    delete window.SeganRenders;
    (0, eval)(`(function (location) {
${read('segan/renders.js')}
})`)(loc);
    return loc;
  }

  test('올바른 id 면 목록을 그리기 전에 ./?g=<id>#result 로 바꿔 넘긴다 (기록 칸을 바꾼다)', async () => {
    await load({ rows: [], posts: [] }); // 페이지 · 셸만 올려 둔다
    const loc = runWith(`?g=${ID2}`);
    expect(loc.replace).toHaveBeenCalledTimes(1);
    expect(loc.replace).toHaveBeenCalledWith(`./?g=${ID2}#result`);
    expect(loc.assign).not.toHaveBeenCalled();
    expect(window.SeganRenders).toBeUndefined(); // 목록을 시작하지 않는다
  });

  test('id 모양이 아니거나 없으면 목록 그대로', async () => {
    await load({ rows: [], posts: [] });
    for (const search of ['', '?g=../../x', '?g=', '?id=1']) {
      const loc = runWith(search);
      expect([search, loc.replace.mock.calls.length]).toEqual([search, 0]);
      expect(window.SeganRenders).toBeDefined();
    }
  });

  test('renders.html 은 그대로 남긴다 (서비스 워커가 미리 담는 셸 페이지)', () => {
    expect(read('segan/sw.js')).toContain("SCOPE + 'renders.html'");
    expect(read('segan/renders.html')).toMatch(/<script src="renders\.js\?v=\d+" defer><\/script>/);
  });
});
