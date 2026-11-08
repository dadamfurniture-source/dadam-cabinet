/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout */
/**
 * SEGAN 만들기 ③ 결과 — 결과 관리 (예전 내 연출컷 「하나 열기」에서 옮겨 온 것).
 *
 * 연출컷 결과 화면은 ./?g=<id>#result 하나다. 내 연출컷에 있던 것을 같은 호출 · 같은 글로 여기서 한다:
 *   이름 · 날짜 · 공유 링크(POST/DELETE /api/generate/:id/share) · 시공사례에서 내리기(collection_posts 행 → 파일)
 *   · AI 학습 동의(generations.consent_training) · 다시 생성(POST { parent_id, … }) · 삭제(DELETE /api/generate/:id)
 *   · 내려받기(받기 직전 서명 다시 확인) · 실패 · 멈춘 잡의 환불 안내
 * 막는 확인(삭제 · 시공사례에서 내리기)은 SeganShell.sheet 의 가운데 창(kind 'dialog')으로 묻는다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const BASE = 'https://gen.example.workers.dev';
const API = `${BASE}/api/generate`;
const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'c@example.com' } };
const ID = '22222222-2222-4222-8222-222222222222';
const QUOTE = { items: [{ name: '하부장 캐비닛', total: 1280000 }], total: 1738000 };
const img = (i) => ({
  url: `https://example.supabase.co/storage/v1/object/sign/generations/user-1/${ID}/v${i}.png?token=a${i}`,
  path: `user-1/${ID}/v${i}.png`,
  label: i ? `붙박이장 · 추천 ${i}` : '붙박이장 · 기본안',
});

function gen(over = {}) {
  return {
    id: ID,
    status: 'done',
    progress: 100,
    step_label: '완료',
    category: 'wardrobe',
    title: null,
    options: { design_style: 'classic', door_color: 'oak woodgrain' },
    quote: QUOTE,
    images: [0, 1, 2, 3].map(img),
    share_expires_at: null,
    share_revoked_at: null,
    created_at: new Date(Date.now() - 3600000).toISOString(),
    ...over,
  };
}

function res(status, body) {
  return { ok: status < 400, status, json: async () => body };
}

async function load(options = {}) {
  const opts = {
    session: SESSION,
    url: `/segan/?g=${ID}#result`,
    gets: [gen()],
    consent: false,
    posts: [{ id: 'post-1', generation_id: ID, storage_path: 'ai/post-1.jpg' }],
    ...options,
  };
  const doc = new DOMParser().parseFromString(read('segan/index.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  window.history.replaceState(null, '', opts.url);
  sessionStorage.clear();
  for (const k of ['SeganShell', 'SeganMake', 'DadamStorageUrls']) delete window[k];
  window.scrollTo = () => {};
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    generateApi: { url: API },
  };
  const calls = { fetch: [], reads: [], posts: [], deletes: [], removes: [], updates: [] };
  const client = {
    auth: { getSession: async () => ({ data: { session: opts.session } }) },
    rpc: async (name) =>
      name === 'my_credit_wallet'
        ? { data: [{ scope: 'personal', balance: 1000, monthly: 100, usable: true }], error: null }
        : { data: null, error: { message: 'x' } },
    storage: {
      from: (bucket) => ({
        createSignedUrls: async (paths) => ({
          data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}?t=1` })),
          error: null,
        }),
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
        in: () => chain,
        order: () => chain,
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
          if (table === 'generations') {
            calls.reads.push(q);
            if (opts.consentError) return { data: null, error: opts.consentError };
            return { data: { consent_training: opts.consent }, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve) => {
          if (table === 'generations' && q.update) {
            calls.updates.push(q);
            return resolve({ data: null, error: opts.updateError || null });
          }
          if (table === 'collection_posts' && q.del) {
            calls.deletes.push(q);
            return resolve(opts.unpost || { data: [{ id: 'post-1' }], error: null });
          }
          if (table === 'collection_posts') {
            calls.posts.push(q);
            return resolve({ data: opts.posts, error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return chain;
    },
  };
  window.supabase = { createClient: () => client };
  let g = 0;
  window.fetch = jest.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.fetch.push({ url, method, auth: (init.headers || {}).Authorization, body: init.body });
    if (url === `${API}/${ID}` && method === 'GET')
      return res(200, {
        success: true,
        generation: opts.gets[Math.min(g++, opts.gets.length - 1)],
      });
    if (url === API && method === 'POST')
      return opts.regen || res(202, { success: true, id: 'new-gen-id' });
    if (url === `${API}/${ID}` && method === 'DELETE')
      return opts.del || res(200, { success: true });
    if (url === `${API}/${ID}/share` && method === 'POST')
      return res(200, {
        success: true,
        share_url: 'https://dadamfurniture.com/design-share.html#t=new',
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
    if (url === `${API}/${ID}/share` && method === 'DELETE') return res(200, { success: true });
    if (url.startsWith('https://signed.example/')) {
      if (opts.dlFail) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, blob: async () => ({ type: 'image/png' }) };
    }
    throw new Error('예상하지 못한 요청: ' + url);
  });
  for (const f of ['js/storage-urls.js', 'segan/shell.js', 'segan/make.js']) (0, eval)(read(f));
  const M = window.SeganMake;
  M.go = jest.fn();
  await window.SeganShell.ready;
  await M.ready;
  if (!opts.noWait) await M.opening;
  return { M, calls };
}

const $ = (id) => document.getElementById(id);
const visible = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) if (n.hidden) return false;
  return true;
};
const flush = () => new Promise((r) => setTimeout(r, 0));
async function until(fn) {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('기다린 상태가 오지 않았다');
}
const dialog = () => document.querySelector('.sg-sheet-wrap--dialog');
/** 창을 닫으면 셸이 표시 칸을 뒤로 가기로 되돌린다 — 그 popstate 까지 기다린다 */
const settled = () =>
  until(() => !dialog() && !window.SeganShell.sheet.isSheetState(window.history.state));
const button = (root, label) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label);

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('목록에서 연 결과 — 내 연출컷 「하나 열기」에 있던 것이 모두 있다', () => {
  test('이름 · 날짜, 컷 넷, 예상 견적 · 「상담 신청」(consult.html?g=<id>), 공유 · 시공사례 · 학습 · 관리', async () => {
    const { calls } = await load();
    expect($('mkResInfo').textContent).toMatch(/^붙박이장 연출컷 · \d{4}\.\d{2}\.\d{2}$/);
    expect($('mkShots').querySelectorAll('img')).toHaveLength(4);
    expect($('mkQuoteTotal').textContent).toBe('1,738,000원');
    expect($('mkConsult').getAttribute('href')).toBe(`consult.html?g=${ID}`);
    for (const id of ['mkShareBox', 'mkPostBox', 'mkConsentBox', 'mkManage'])
      expect([id, visible($(id))]).toEqual([id, true]);
    expect($('mkRegen').disabled).toBe(false);
    expect($('mkDelete').disabled).toBe(false);
    // 생성 API 가 싣지 않는 칸 — 내 연출컷과 같은 표에서 본인 것만 읽는다
    expect(calls.reads[0].cols).toBe('consent_training');
    expect(calls.reads[0].filters).toEqual([
      ['eq', 'id', ID],
      ['eq', 'user_id', 'user-1'],
    ]);
    expect(calls.posts[0].filters).toEqual([
      ['eq', 'user_id', 'user-1'],
      ['eq', 'source', 'ai_render'],
      ['eq', 'generation_id', ID],
    ]);
    // 결과 화면에서 내 연출컷 목록으로
    expect($('mkResFoot').querySelector('a').getAttribute('href')).toBe('renders.html');
    expect(document.body.textContent).not.toMatch(/즐겨찾기|★|☆/);
  });

  test('시공사례에 없으면 내리기가 없다, 학습 동의를 못 읽으면 그 칸을 감춘다', async () => {
    await load({ posts: [], consentError: { message: 'denied' } });
    expect($('mkPostBox').hidden).toBe(true);
    expect($('mkConsentBox').hidden).toBe(true);
    expect(visible($('mkManage'))).toBe(true);
  });

  test('실패한 연출컷 — 서버 문구 + 환불 안내, 견적 · 공유 없음, 다시 생성 · 삭제는 있다', async () => {
    await load({
      gets: [
        gen({ status: 'failed', error: '사진에서 벽을 찾지 못했습니다', images: [], quote: null }),
      ],
    });
    expect($('mkResError').textContent).toBe('사진에서 벽을 찾지 못했습니다');
    expect(visible($('mkRefund'))).toBe(true);
    expect($('mkRefund').textContent).toBe(window.SeganMake.REFUND_NOTE);
    expect($('mkRefund').textContent).toBe('만들지 못한 연출컷의 크레딧은 돌려드립니다.');
    expect($('mkQuote').hidden).toBe(true);
    expect($('mkShareBox').hidden).toBe(true);
    expect(visible($('mkManage'))).toBe(true);
  });

  test('12분 넘게 진행 중인 잡은 실패로 본다 — 더 읽지 않고 환불 안내 (내 연출컷 목록과 같은 기준)', async () => {
    const { calls } = await load({
      gets: [
        gen({
          status: 'rendering',
          progress: 40,
          images: [],
          quote: null,
          created_at: new Date(Date.now() - 13 * 60000).toISOString(),
        }),
      ],
    });
    expect(visible($('mkResError'))).toBe(true);
    expect($('mkResError').textContent).toBe('연출컷을 만들지 못했습니다');
    expect(visible($('mkRefund'))).toBe(true);
    expect($('mkProgress').hidden).toBe(true);
    expect(calls.fetch.filter((f) => f.method === 'GET')).toHaveLength(1);
  });

  test('진행 중 — 다시 생성 · 삭제를 막는다 (my-designs.html 과 같다)', async () => {
    jest.useFakeTimers();
    await load({
      noWait: true,
      gets: [
        gen({
          status: 'rendering',
          progress: 40,
          images: [img(0)],
          quote: null,
          created_at: new Date().toISOString(),
        }),
      ],
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(visible($('mkProgress'))).toBe(true);
    expect(visible($('mkManage'))).toBe(true);
    expect($('mkRegen').disabled).toBe(true);
    expect($('mkDelete').disabled).toBe(true);
    expect($('mkRefund').hidden).toBe(true);
  });
});

describe('공유 링크 — 같은 generate-api 경로', () => {
  test('만들기(POST) → 링크 · 복사, 중단(DELETE)', async () => {
    const { calls } = await load();
    const writeText = jest.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    expect($('mkShareMake').textContent).toBe('공유 링크 만들기');
    expect($('mkShareStop').hidden).toBe(true);
    $('mkShareMake').click();
    await until(() => !$('mkLinkRow').hidden);
    expect(calls.fetch.find((f) => f.url.endsWith('/share'))).toMatchObject({
      url: `${API}/${ID}/share`,
      method: 'POST',
      auth: 'Bearer tok-1',
    });
    expect($('mkLink').value).toBe('https://dadamfurniture.com/design-share.html#t=new');
    expect($('mkShareState').textContent).toMatch(
      /로그인 없이 볼 수 있습니다 · \d{4}\.\d{2}\.\d{2} 까지$/
    );
    expect(visible($('mkShareStop'))).toBe(true);
    expect($('mkShareMake').textContent).toBe('새 링크 만들기');
    $('mkCopy').click();
    await flush();
    expect(writeText).toHaveBeenCalledWith('https://dadamfurniture.com/design-share.html#t=new');
    expect($('mkBoxMsg').textContent).toBe('공유 링크를 복사했습니다');
    $('mkShareStop').click();
    await until(() => $('mkShareStop').hidden);
    expect(calls.fetch.filter((f) => f.url.endsWith('/share')).map((f) => f.method)).toEqual([
      'POST',
      'DELETE',
    ]);
    expect($('mkLinkRow').hidden).toBe(true);
    expect($('mkBoxMsg').textContent).toContain('공유를 중단했습니다');
  });

  test('이미 공유 중이면 「공유 중 · 날짜 까지」 + 새 링크 · 중단', async () => {
    await load({
      gets: [gen({ share_expires_at: new Date(Date.now() + 5 * 86400000).toISOString() })],
    });
    expect($('mkShareState').textContent).toMatch(/^공유 중 · \d{4}\.\d{2}\.\d{2} 까지/);
    expect($('mkShareMake').textContent).toBe('새 링크 만들기');
    expect(visible($('mkShareStop'))).toBe(true);
  });

  test('위 「공유」로 만든 링크도 공유 링크 칸에 보인다 (예전 링크는 막힌다)', async () => {
    await load();
    const writeText = jest.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    $('mkShare').click();
    await until(() => !$('mkLinkRow').hidden);
    expect($('mkLink').value).toBe('https://dadamfurniture.com/design-share.html#t=new');
    expect(visible($('mkShareStop'))).toBe(true);
  });
});

describe('시공사례에서 내리기 — 가운데 창으로 묻고, my-designs.html 과 같은 순서', () => {
  test('가운데 창(kind dialog) → 취소는 그대로, 내리기 → 행 삭제 → collection 버킷 파일 삭제', async () => {
    const { calls } = await load();
    const open = jest.spyOn(window.SeganShell.sheet, 'open');
    $('mkUnpost').click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toMatchObject({ kind: 'dialog', title: '시공사례에서 내리기' });
    expect(dialog().textContent).toContain('내린 뒤에는 다시 올릴 수 없습니다. 내릴까요?');
    expect(document.activeElement).toBe(button(dialog(), '취소')); // 처음 초점은 취소
    button(dialog(), '취소').click();
    await settled();
    expect(calls.deletes).toEqual([]);
    expect(window.history.state).toEqual({ mk: 'result' });

    $('mkUnpost').click();
    button(dialog(), '내리기').click();
    await until(() => $('mkPostBox').hidden);
    expect(calls.deletes[0].filters).toEqual([['eq', 'id', 'post-1']]);
    expect(calls.removes).toEqual([{ bucket: 'collection', paths: ['ai/post-1.jpg'] }]);
    expect(dialog()).toBeNull();
    expect($('mkBoxMsg').textContent).toBe('시공사례에서 내렸습니다');
    expect(document.body.textContent).not.toMatch(/다시 올리기|시공사례에 올리기/);
    // 화면 안 확인 줄은 없다 — 창으로만 묻는다
    expect(document.getElementById('mkUnpostAsk')).toBeNull();
  });

  test('내리지 못하면 창을 닫고 안내, 칸은 그대로', async () => {
    const { calls } = await load({ unpost: { data: [], error: { message: 'denied' } } });
    $('mkUnpost').click();
    button(dialog(), '내리기').click();
    await until(() => !dialog() && $('mkBoxMsg').textContent);
    expect($('mkBoxMsg').textContent).toBe('시공사례에서 내리지 못했습니다 — denied');
    expect(calls.removes).toEqual([]);
    expect(visible($('mkPostBox'))).toBe(true);
  });
});

describe('내려받기 — 받기 직전 서명 확인 → blob 저장, 못 받으면 새 창', () => {
  test('크게 보는 컷 — 기본안은 segan-<품목>.png, 추천안은 -2 · -3 …', async () => {
    const { calls } = await load();
    window.URL.createObjectURL = jest.fn(() => 'blob:x');
    window.URL.revokeObjectURL = jest.fn();
    const names = [];
    jest.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      if (this.download) names.push(this.download);
    });
    $('mkDownload').click();
    await until(() => names.length === 1);
    $('mkShots').querySelector('[data-shot="2"]').click();
    $('mkDownload').click();
    await until(() => names.length === 2);
    expect(names).toEqual(['segan-wardrobe.png', 'segan-wardrobe-3.png']);
    const dl = calls.fetch.filter((f) => f.url.startsWith('https://signed.example/'));
    expect(dl.map((f) => f.url)).toEqual([
      `https://signed.example/user-1/${ID}/v0.png?t=1`,
      `https://signed.example/user-1/${ID}/v2.png?t=1`,
    ]);
  });

  test('받지 못하면 새 창으로 연다', async () => {
    await load({ dlFail: true });
    const open = jest.fn();
    window.open = open;
    $('mkDownload').click();
    await until(() => open.mock.calls.length);
    expect(open).toHaveBeenCalledWith(`https://signed.example/user-1/${ID}/v0.png?t=1`, '_blank');
  });

  test('index.html 이 서명 도우미(js/storage-urls.js)를 싣는다', () => {
    expect(read('segan/index.html')).toMatch(
      /<script src="\.\.\/js\/storage-urls\.js\?v=\d+"><\/script>/
    );
  });
});

describe('AI 학습 동의 — consent_training (my-designs.html 과 같은 칸 · 같은 글)', () => {
  test('끔 → 켬: generations.update({ consent_training: true }).eq(id), 글 · aria-pressed', async () => {
    const { calls } = await load();
    expect($('mkConsent').textContent).toBe('AI 학습 안 함');
    expect($('mkConsent').getAttribute('aria-pressed')).toBe('false');
    expect($('mkConsentNote').textContent).toBe('학습에 쓰이지 않습니다. 누르면 켭니다.');
    $('mkConsent').click();
    await until(() => calls.updates.length && $('mkBoxMsg').textContent);
    expect(calls.updates[0].update).toEqual({ consent_training: true });
    expect(calls.updates[0].filters).toEqual([['eq', 'id', ID]]);
    expect($('mkConsent').textContent).toBe('AI 학습 허용');
    expect($('mkConsentNote').textContent).toBe(
      '이 연출컷과 함께 올린 사진이 다담 AI 학습에 쓰입니다. 누르면 끕니다.'
    );
    expect($('mkBoxMsg').textContent).toBe('학습에 사용하도록 켰습니다');
  });

  test('바꾸지 못하면 되돌리고 안내', async () => {
    await load({ updateError: { message: 'denied' } });
    $('mkConsent').click();
    await until(() => $('mkBoxMsg').textContent);
    expect($('mkConsent').textContent).toBe('AI 학습 안 함');
    expect($('mkBoxMsg').textContent).toBe('학습 동의를 바꾸지 못했습니다');
  });

  test('my-designs.html 과 같은 글', () => {
    const site = read('my-designs.html');
    const js = read('segan/make.js');
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

describe('다시 생성 — 크레딧이 다시 든다 (화면 안에서 한 번 더 묻는다)', () => {
  test('확인에 단가 · 남은 횟수 → POST { parent_id, 원본 스타일 · 도어 색 } → 새 결과 주소', async () => {
    const { calls, M } = await load();
    $('mkRegen').click();
    await until(() => /남은/.test($('mkRegenText').textContent));
    expect(visible($('mkRegenAsk'))).toBe(true);
    expect($('mkRegenText').textContent).toBe(
      '같은 사진 · 같은 설정으로 다시 만듭니다. 20 크레딧이 차감됩니다 · 남은 50회.'
    );
    expect(calls.fetch.filter((f) => f.method === 'POST')).toEqual([]); // 묻기 전에는 보내지 않는다
    $('mkRegenYes').click();
    await until(() => M.go.mock.calls.length);
    const post = calls.fetch.find((f) => f.url === API && f.method === 'POST');
    expect(post.auth).toBe('Bearer tok-1');
    expect(JSON.parse(post.body)).toEqual({
      parent_id: ID,
      design_style: 'classic',
      door_color: 'oak woodgrain',
    });
    expect(M.go).toHaveBeenCalledWith('./?g=new-gen-id#result');
  });

  test('취소하면 보내지 않는다, 402 는 크레딧 부족 안내', async () => {
    const { calls, M } = await load({ regen: res(402, { success: false }) });
    $('mkRegen').click();
    await flush();
    $('mkRegenNo').click();
    expect($('mkRegenAsk').hidden).toBe(true);
    expect(calls.fetch.filter((f) => f.url === API)).toEqual([]);
    $('mkRegen').click();
    await flush();
    $('mkRegenYes').click();
    await until(() => $('mkBoxMsg').textContent);
    expect($('mkBoxMsg').textContent).toBe(
      '크레딧이 부족합니다. 구독을 올리면 더 만들 수 있습니다.'
    );
    expect($('mkRegenAsk').hidden).toBe(true);
    expect(M.go).not.toHaveBeenCalled();
  });

  test('402 company_inactive — 팩토리 구독이 멈췄다는 서버 안내', async () => {
    const { M } = await load({
      regen: res(402, {
        success: false,
        code: 'company_inactive',
        error: '팩토리 구독이 멈춰 있어 연출컷을 만들 수 없습니다. 결제를 확인해 주세요.',
      }),
    });
    $('mkRegen').click();
    await flush();
    $('mkRegenYes').click();
    await until(() => $('mkBoxMsg').textContent);
    expect($('mkBoxMsg').textContent).toBe(
      '팩토리 구독이 멈춰 있어 연출컷을 만들 수 없습니다. 결제를 확인해 주세요.'
    );
    expect(M.go).not.toHaveBeenCalled();
  });

  test('ai-design.html 의 다시 생성과 같은 칸만 보낸다', () => {
    // ai-design.html 은 다시 생성 때 원본 값을 읽어 여러 줄로 보낸다 — 줄바꿈과 값 식은 건너뛰고 칸 이름만 본다
    const ai = read('ai-design.html').match(/await submit\(\{\s*(parent_id[\s\S]*?)\}\);/)[1];
    expect([...ai.matchAll(/(\w+):/g)].map((m) => m[1])).toEqual([
      'parent_id',
      'design_style',
      'door_color',
    ]);
  });
});

describe('삭제 — 가운데 창으로 묻고 DELETE /api/generate/:id (my-designs.html 과 같은 경로 · 같은 글)', () => {
  test('가운데 창(kind dialog) → 취소는 그대로, 삭제 → DELETE → 창을 닫은 뒤 내 연출컷 목록으로 (기록 칸을 바꿔)', async () => {
    const { calls, M } = await load();
    const seen = [];
    M.go = jest.fn((url, replace) => {
      seen.push({
        url,
        replace,
        dialogOpen: !!dialog(),
        sheetEntry: window.SeganShell.sheet.isSheetState(window.history.state),
      });
    });
    const open = jest.spyOn(window.SeganShell.sheet, 'open');
    $('mkDelete').click();
    expect(open.mock.calls[0][0]).toMatchObject({ kind: 'dialog', title: '연출컷 삭제' });
    expect(dialog().querySelector('[role="dialog"]')).not.toBeNull();
    expect(dialog().textContent).toContain(
      '이 연출컷을 삭제할까요? 이미지와 공유 링크, 시공사례에 올라간 사진이 함께 사라집니다.'
    );
    expect(window.SeganShell.sheet.isSheetState(window.history.state)).toBe(true);
    button(dialog(), '취소').click();
    await settled();
    expect(calls.fetch.filter((f) => f.method === 'DELETE')).toEqual([]);

    $('mkDelete').click();
    button(dialog(), '삭제').click();
    await until(() => seen.length);
    expect(calls.fetch.find((f) => f.method === 'DELETE')).toMatchObject({
      url: `${API}/${ID}`,
      auth: 'Bearer tok-1',
    });
    expect(seen).toEqual([
      { url: 'renders.html', replace: true, dialogOpen: false, sheetEntry: false },
    ]);
    // 화면 안 확인 줄은 없다 — 창으로만 묻는다
    expect(document.getElementById('mkDeleteAsk')).toBeNull();
  });

  test('삭제 실패 — 창을 닫고 서버 문구, 결과 화면 그대로', async () => {
    const { M } = await load({
      del: res(403, { success: false, error: '본인 것만 지울 수 있습니다' }),
    });
    $('mkDelete').click();
    button(dialog(), '삭제').click();
    await until(() => !dialog() && $('mkBoxMsg').textContent);
    expect($('mkBoxMsg').textContent).toBe('본인 것만 지울 수 있습니다');
    expect(M.go).not.toHaveBeenCalled();
    expect(visible($('mkResultTitle'))).toBe(true);
  });

  test('my-designs.html 의 확인 글과 같은 내용', () => {
    expect(read('my-designs.html')).toContain(
      "confirm('이 연출컷을 삭제할까요?\\n이미지와 공유 링크, 시공사례에 올라간 사진이 함께 사라집니다.')"
    );
    expect(window.SeganMake.DELETE_ASK).toBe(
      '이 연출컷을 삭제할까요? 이미지와 공유 링크, 시공사례에 올라간 사진이 함께 사라집니다.'
    );
  });
});
