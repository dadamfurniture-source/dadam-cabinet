/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, jest, setTimeout */
/**
 * SEGAN 「내 연출컷」 탭 (segan/renders.html + segan/renders.js).
 *
 * my-designs.html 과 같은 데이터 · 호출인지 확인한다 (my-designs.html 은 고치지 않는다):
 *   generations 목록(같은 칸 · internal_only 거르기 · 최신순 200) · js/storage-urls.js 서명 · 5초 다시 읽기
 *   공유 POST/DELETE /api/generate/:id/share · collection_posts(ai_render) 내리기 = 행 삭제 → 파일 삭제
 *   하나 열기 → 컷 · 예상 견적 · 「상담 신청」(consult.html?g=<id>)
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
const QUOTE = { items: [{ name: '하부장 캐비닛', total: 1280000 }], total: 1738000 };
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
      options: { design_style: 'classic', door_color: 'oak woodgrain' },
      consent_training: false,
      title: null,
      quote: QUOTE,
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

function res(status, body) {
  return { ok: status < 400, status, json: async () => body };
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
  const calls = {
    gen: [],
    posts: [],
    deletes: [],
    removes: [],
    signed: [],
    fetch: [],
    updates: [],
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: opts.session } }) },
    storage: {
      from: (bucket) => ({
        createSignedUrls: async (paths) => {
          calls.signed.push({ bucket, paths });
          return {
            data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}?t=1` })),
            error: null,
          };
        },
        remove: async (paths) => {
          calls.removes.push({ bucket, paths });
          return { error: null };
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
        delete: () => {
          q.del = true;
          return chain;
        },
        update: (patch) => {
          q.update = patch;
          return chain;
        },
        maybeSingle: async () => {
          if (table === 'credit_costs') return { data: { credits: 20 }, error: null };
          if (table === 'user_credits') return { data: { balance: 1000 }, error: null };
          return { data: null, error: null };
        },
        then: (resolve) => {
          if (table === 'generations' && q.update) {
            calls.updates.push(q);
            return resolve({ data: null, error: opts.updateError || null });
          }
          if (table === 'generations') {
            calls.gen.push(q);
            return resolve({ data: JSON.parse(JSON.stringify(opts.rows)), error: null });
          }
          if (table === 'collection_posts' && q.del) {
            calls.deletes.push(q);
            return resolve({ data: [{ id: 'post-1' }], error: null });
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
  window.fetch = jest.fn(async (url, init = {}) => {
    calls.fetch.push({
      url,
      method: init.method || 'GET',
      auth: (init.headers || {}).Authorization,
      body: init.body,
    });
    // 다시 생성 (POST /api/generate) · 삭제 (DELETE /api/generate/:id) · 내려받기 (서명 URL)
    if (url === API && init.method === 'POST')
      return opts.regen || res(202, { success: true, id: 'new-gen-id' });
    if (url === `${API}/${ID2}` && init.method === 'DELETE')
      return opts.del || res(200, { success: true });
    if (url.startsWith('https://signed.example/')) {
      if (opts.dlFail) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, blob: async () => ({ type: 'image/png' }) };
    }
    if (
      url === `https://gen.example.workers.dev/api/generate/${ID2}/share` &&
      init.method === 'POST'
    ) {
      return res(200, {
        success: true,
        share_url: 'https://dadamfurniture.com/design-share.html#t=new',
        expires_at: '2026-11-03T00:00:00Z',
      });
    }
    if (
      url === `https://gen.example.workers.dev/api/generate/${ID2}/share` &&
      init.method === 'DELETE'
    )
      return res(200, { success: true });
    throw new Error('예상하지 못한 요청: ' + url);
  });
  for (const f of ['js/storage-urls.js', 'segan/shell.js', 'segan/make.js', 'segan/renders.js'])
    (0, eval)(read(f));
  window.SeganRenders.go = jest.fn();
  await window.SeganRenders.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const visible = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) if (n.hidden) return false;
  return true;
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const card = (id) => document.querySelector(`[data-open="${id}"]`).closest('.rd-card');

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

describe('하나 열기 — 컷 · 견적 · 상담 신청', () => {
  test('누르면 ?g=<id>, 컷 넷 · 예상 견적 · 「상담 신청」 → consult.html?g=<id>', async () => {
    await load();
    card(ID2).querySelector('.rd-thumb').click();
    expect(window.location.search).toBe(`?g=${ID2}`);
    expect(visible($('rdDetail'))).toBe(true);
    expect(visible($('rdList'))).toBe(false);
    expect($('rdTitle').textContent).toBe('붙박이장 연출컷');
    expect($('rdShots').querySelectorAll('img')).toHaveLength(4);
    expect($('rdQuoteTotal').textContent).toBe('1,738,000원');
    expect($('rdConsult').getAttribute('href')).toBe(`consult.html?g=${ID2}`);
    expect($('rdConsult').textContent).toBe('상담 신청');
    $('rdBack').click();
    expect(visible($('rdList'))).toBe(true);
  });

  test('주소에 ?g=<id> 가 있으면 바로 그 연출컷', async () => {
    await load({ url: `/segan/renders.html?g=${ID2}` });
    expect(visible($('rdDetail'))).toBe(true);
    expect($('rdTitle').textContent).toBe('붙박이장 연출컷');
  });

  test('실패한 연출컷 — 서버 문구 + 환불 안내, 견적 · 공유 없음', async () => {
    await load({ url: `/segan/renders.html?g=${ID3}` });
    expect($('rdError').textContent).toBe(
      '사진에서 벽을 찾지 못했습니다 · 만들지 못한 연출컷의 크레딧은 돌려드립니다.'
    );
    expect($('rdQuote').hidden).toBe(true);
    expect($('rdShare').hidden).toBe(true);
  });

  test('진행 중 — 단계 안내 · 진행률', async () => {
    await load({ url: `/segan/renders.html?g=${ID1}` });
    expect(visible($('rdProgress'))).toBe(true);
    expect($('rdProgress').textContent).toBe('가구 배치 중 · 40%');
  });
});

describe('공유 링크 — 같은 generate-api 경로', () => {
  test('만들기(POST) → 링크 · 복사, 중단(DELETE)', async () => {
    const calls = await load({ url: `/segan/renders.html?g=${ID2}` });
    const writeText = jest.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    expect($('rdShareMake').textContent).toBe('공유 링크 만들기');
    expect($('rdShareStop').hidden).toBe(true);
    $('rdShareMake').click();
    await flush();
    expect(calls.fetch[0]).toMatchObject({
      url: `${API}/${ID2}/share`,
      method: 'POST',
      auth: 'Bearer tok-1',
    });
    expect($('rdLink').value).toBe('https://dadamfurniture.com/design-share.html#t=new');
    expect(visible($('rdLinkRow'))).toBe(true);
    expect(visible($('rdShareStop'))).toBe(true);
    $('rdCopy').click();
    await flush();
    expect(writeText).toHaveBeenCalledWith('https://dadamfurniture.com/design-share.html#t=new');
    expect($('rdMsg').textContent).toBe('공유 링크를 복사했습니다');
    $('rdShareStop').click();
    await flush();
    expect(calls.fetch[1]).toMatchObject({
      url: `${API}/${ID2}/share`,
      method: 'DELETE',
      auth: 'Bearer tok-1',
    });
    expect($('rdShareStop').hidden).toBe(true);
    expect($('rdLinkRow').hidden).toBe(true);
    expect($('rdMsg').textContent).toContain('공유를 중단했습니다');
  });

  test('이미 공유 중이면 「공유 중 · 날짜 까지」 + 새 링크 · 중단', async () => {
    const rows = gens();
    rows[1].share_expires_at = new Date(Date.now() + 5 * 86400000).toISOString();
    await load({ rows, url: `/segan/renders.html?g=${ID2}` });
    expect($('rdShareState').textContent).toMatch(/^공유 중 · \d{4}\.\d{2}\.\d{2} 까지/);
    expect($('rdShareMake').textContent).toBe('새 링크 만들기');
    expect(visible($('rdShareStop'))).toBe(true);
    expect(card(ID2).textContent).toContain('공유 중');
  });
});

describe('시공사례에서 내리기 — my-designs.html 과 같은 순서', () => {
  test('묻고 → 행 삭제 → collection 버킷 파일 삭제, 다시 올리기는 없다', async () => {
    const calls = await load({ url: `/segan/renders.html?g=${ID2}` });
    expect(calls.posts[0].filters).toEqual([
      ['eq', 'user_id', 'user-1'],
      ['eq', 'source', 'ai_render'],
    ]);
    expect(visible($('rdPost'))).toBe(true);
    $('rdUnpost').click();
    expect(visible($('rdUnpostAsk'))).toBe(true);
    $('rdUnpostNo').click();
    expect(calls.deletes).toEqual([]);
    $('rdUnpost').click();
    $('rdUnpostYes').click();
    await flush();
    expect(calls.deletes[0].filters).toEqual([['eq', 'id', 'post-1']]);
    expect(calls.removes).toEqual([{ bucket: 'collection', paths: ['ai/post-1.jpg'] }]);
    expect($('rdPost').hidden).toBe(true);
    expect($('rdMsg').textContent).toBe('시공사례에서 내렸습니다');
    expect(document.body.textContent).not.toMatch(/다시 올리기|시공사례에 올리기/);
  });

  test('시공사례에 없는 연출컷에는 내리기가 없다', async () => {
    await load({ posts: [], url: `/segan/renders.html?g=${ID2}` });
    expect($('rdPost').hidden).toBe(true);
  });
});

describe('내려받기 — my-designs.html 과 같은 방식 (서명 확인 → blob 저장, 못 받으면 새 창)', () => {
  test('컷마다 내려받기 — 기본안은 dadam-<품목>.png, 추천안은 -2 · -3 …', async () => {
    const calls = await load({ url: `/segan/renders.html?g=${ID2}` });
    window.URL.createObjectURL = jest.fn(() => 'blob:x');
    window.URL.revokeObjectURL = jest.fn();
    const names = [];
    jest.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      names.push(this.download);
    });
    const buttons = [...$('rdShots').querySelectorAll('[data-dl]')];
    expect(buttons).toHaveLength(4);
    buttons[0].click();
    await flush();
    buttons[2].click();
    await flush();
    expect(names).toEqual(['dadam-wardrobe.png', 'dadam-wardrobe-3.png']);
    const dl = calls.fetch.filter((f) => f.url.startsWith('https://signed.example/'));
    expect(dl.map((f) => f.url)).toEqual([
      `https://signed.example/user-1/${ID2}/v0.png?t=1`,
      `https://signed.example/user-1/${ID2}/v2.png?t=1`,
    ]);
  });

  test('받지 못하면 새 창으로 연다 (my-designs.html 과 같다)', async () => {
    await load({ url: `/segan/renders.html?g=${ID2}`, dlFail: true });
    const open = jest.fn();
    window.open = open;
    $('rdShots').querySelector('[data-dl="1"]').click();
    await flush();
    expect(open).toHaveBeenCalledWith(`https://signed.example/user-1/${ID2}/v1.png?t=1`, '_blank');
  });
});

describe('AI 학습 동의 — consent_training (my-designs.html 과 같은 칸 · 같은 글)', () => {
  test('끔 → 켬: generations.update({ consent_training: true }).eq(id), 글 · aria-pressed', async () => {
    const calls = await load({ url: `/segan/renders.html?g=${ID2}` });
    expect($('rdConsent').textContent).toBe('AI 학습 안 함');
    expect($('rdConsent').getAttribute('aria-pressed')).toBe('false');
    expect($('rdConsentNote').textContent).toBe('학습에 쓰이지 않습니다. 누르면 켭니다.');
    $('rdConsent').click();
    await flush();
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].update).toEqual({ consent_training: true });
    expect(calls.updates[0].filters).toEqual([['eq', 'id', ID2]]);
    expect($('rdConsent').textContent).toBe('AI 학습 허용');
    expect($('rdConsentNote').textContent).toBe(
      '이 연출컷과 함께 올린 사진이 다담 AI 학습에 쓰입니다. 누르면 끕니다.'
    );
    expect($('rdMsg').textContent).toBe('학습에 사용하도록 켰습니다');
  });

  test('바꾸지 못하면 되돌리고 안내', async () => {
    await load({ url: `/segan/renders.html?g=${ID2}`, updateError: { message: 'denied' } });
    $('rdConsent').click();
    await flush();
    expect($('rdConsent').textContent).toBe('AI 학습 안 함');
    expect($('rdMsg').textContent).toBe('학습 동의를 바꾸지 못했습니다');
  });

  test('my-designs.html 과 같은 글', () => {
    const site = read('my-designs.html');
    const js = read('segan/renders.js');
    for (const s of [
      '이 연출컷과 함께 올린 사진이 다담 AI 학습에 쓰입니다. 누르면 끕니다.',
      '학습에 쓰이지 않습니다. 누르면 켭니다.',
      '학습에 사용하도록 켰습니다',
      '학습에서 뺐습니다',
      '학습 동의를 바꾸지 못했습니다',
    ]) {
      expect([s, site.includes(s), js.includes(s)]).toEqual([s, true, true]);
    }
  });
});

describe('다시 생성 — 크레딧이 다시 든다', () => {
  test('확인에 단가 · 남은 횟수 → POST { parent_id, 원본 스타일 · 도어 색 } → 만들기 ③ 결과로', async () => {
    const calls = await load({ url: `/segan/renders.html?g=${ID2}` });
    $('rdRegen').click();
    await flush();
    expect(visible($('rdRegenAsk'))).toBe(true);
    expect($('rdRegenText').textContent).toBe(
      '같은 사진 · 같은 설정으로 다시 만듭니다. 20 크레딧이 차감됩니다 · 남은 50회.'
    );
    expect(calls.fetch.filter((f) => f.method === 'POST')).toEqual([]); // 묻기 전에는 보내지 않는다
    $('rdRegenYes').click();
    await flush();
    const post = calls.fetch.find((f) => f.url === API && f.method === 'POST');
    expect(post.auth).toBe('Bearer tok-1');
    expect(JSON.parse(post.body)).toEqual({
      parent_id: ID2,
      design_style: 'classic',
      door_color: 'oak woodgrain',
    });
    expect(window.SeganRenders.go).toHaveBeenCalledWith('./?g=new-gen-id#result');
  });

  test('취소하면 보내지 않는다, 402 는 크레딧 부족 안내', async () => {
    const calls = await load({
      url: `/segan/renders.html?g=${ID2}`,
      regen: res(402, { success: false }),
    });
    $('rdRegen').click();
    await flush();
    $('rdRegenNo').click();
    expect($('rdRegenAsk').hidden).toBe(true);
    expect(calls.fetch.filter((f) => f.url === API)).toEqual([]);
    $('rdRegen').click();
    await flush();
    $('rdRegenYes').click();
    await flush();
    expect($('rdMsg').textContent).toBe('크레딧이 부족합니다. 구독을 올리면 더 만들 수 있습니다.');
    expect(window.SeganRenders.go).not.toHaveBeenCalled();
  });

  test('ai-design.html 의 다시 생성과 같은 칸만 보낸다', () => {
    const ai = read('ai-design.html').match(/await submit\(\{ (parent_id[^}]*) \}\);/)[1];
    expect([...ai.matchAll(/(\w+):/g)].map((m) => m[1])).toEqual([
      'parent_id',
      'design_style',
      'door_color',
    ]);
  });
});

describe('삭제 — DELETE /api/generate/:id (my-designs.html 과 같은 경로 · 같은 확인 글)', () => {
  test('묻고 → DELETE → 목록에서 빠지고 목록으로', async () => {
    const calls = await load({ url: `/segan/renders.html?g=${ID2}` });
    $('rdDelete').click();
    expect(visible($('rdDeleteAsk'))).toBe(true);
    expect($('rdDeleteText').textContent).toBe(
      '이 연출컷을 삭제할까요? 이미지와 공유 링크, 시공사례에 올라간 사진이 함께 사라집니다.'
    );
    $('rdDeleteNo').click();
    expect(calls.fetch.filter((f) => f.method === 'DELETE')).toEqual([]);
    $('rdDelete').click();
    $('rdDeleteYes').click();
    await flush();
    expect(calls.fetch.find((f) => f.method === 'DELETE')).toMatchObject({
      url: `${API}/${ID2}`,
      auth: 'Bearer tok-1',
    });
    expect(visible($('rdList'))).toBe(true);
    expect(document.querySelector(`[data-open="${ID2}"]`)).toBeNull();
    expect($('rdState').textContent).toBe('삭제했습니다');
  });

  test('my-designs.html 의 확인 글과 같은 내용', () => {
    expect(read('my-designs.html')).toContain(
      "confirm('이 연출컷을 삭제할까요?\\n이미지와 공유 링크, 시공사례에 올라간 사진이 함께 사라집니다.')"
    );
  });

  test('삭제 실패 — 서버 문구', async () => {
    await load({
      url: `/segan/renders.html?g=${ID2}`,
      del: res(403, { success: false, error: '본인 것만 지울 수 있습니다' }),
    });
    $('rdDelete').click();
    $('rdDeleteYes').click();
    await flush();
    expect($('rdMsg').textContent).toBe('본인 것만 지울 수 있습니다');
    expect(visible($('rdDetail'))).toBe(true);
  });

  test('진행 중에는 다시 생성 · 삭제를 막는다, 즐겨찾기는 없다', async () => {
    await load({ url: `/segan/renders.html?g=${ID1}` });
    expect($('rdRegen').disabled).toBe(true);
    expect($('rdDelete').disabled).toBe(true);
    expect(document.body.textContent).not.toMatch(/즐겨찾기|★|☆/);
  });
});
