/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout */
/**
 * SEGAN 업체 AI 비서 (segan/assistant.html + segan/assistant.js)
 *
 *   누가    GET /assistant/me — level full 은 대화, read 는 보기만, none · 403 은 이유 한 줄 (목록을 묻지 않는다)
 *   목록    GET /assistant/conversations — 제목 · 한국 시간, 「새 대화」는 POST 하고 바로 연다
 *   대화    GET /assistant/conversations/:id — 사람 · 비서 말풍선(「AI가 만든 내용」), 글은 textContent 로만
 *           running 이 있으면 그 차례를 after 부터 이어 받는다. 주소 #c=대화
 *   보내기  POST …/turns { text } + X-Idempotency-Key (끊기면 같은 키로 한 번 더)
 *           409 · 429 · 403 은 이유 한 줄 + 글을 입력 칸에 되돌린다
 *   사건    GET …/events?after=N (NDJSON) — text 를 잇고, tool 은 한 줄 상태, done 으로 끝
 *           blocked · refused · error 는 말풍선을 거두고 글을 되돌린다. 끝 사건 없이 닫히면 마지막 n 부터 다시 연다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'owner@example.com' } };
const WORK = 'https://work.example.workers.dev';
const AS = 'https://dadam-assistant-api.dadamfurniture.workers.dev';
const C1 = 'c0000000-0000-4000-8000-000000000001';
const C2 = 'c0000000-0000-4000-8000-000000000002';
const KEY_RE = /^[A-Za-z0-9_.:-]{1,200}$/;

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
/** 사건 줄 응답 — 사건 목록을 NDJSON 글로 */
const lines = (...evs) => ({
  ok: true,
  status: 200,
  text: evs.map((e) => JSON.stringify(e)).join('\n') + '\n',
});

const ME = {
  company_id: 'co1',
  role: 'owner',
  money: true,
  level: 'full',
  can_chat: true,
  max_turns: 30,
};
const CONVS = [
  {
    id: C1,
    title: '지난 대화',
    created_at: '2026-11-01T01:00:00Z',
    updated_at: '2026-11-02T03:04:00Z',
  },
];
const CONV = (id = C1, extra = {}) =>
  ok({
    conversation: { id, title: id === C1 ? '지난 대화' : null, created_at: 'x', updated_at: 'x' },
    messages:
      id === C1
        ? [
            { seq: 1, role: 'user', text: '미수금 알려 줘', created_at: 'x' },
            { seq: 2, role: 'assistant', text: '<b>두 건</b>입니다.\n둘째 줄', created_at: 'x' },
          ]
        : [],
    running: null,
    ...extra,
  });

async function load(options = {}) {
  const opts = {
    me: ok(ME),
    list: () => ok({ items: CONVS }),
    conv: (id) => CONV(id),
    create: () =>
      ok({ conversation: { id: C2, title: null, created_at: 'x', updated_at: 'x' } }, 201),
    turn: () => ok({ turn: 1, after: 0, reused: false }, 202),
    events: () =>
      lines(
        { n: 1, type: 'start', turn: 1 },
        { n: 2, type: 'text', turn: 1, text: '네' },
        { n: 3, type: 'done', turn: 1 }
      ),
    hash: '',
    notices: () => ok({ items: [], unseen: 0, available: true }),
    seen: (body) => ok({ seen: body.ids.length }),
    // 브리핑 — 기본은 못 받음(칸 숨김). 브리핑 시험이 갈아 끼운다
    brief: () => fail(404, '', 'x'),
    // 승인 카드 승인 · 거절 — 카드 시험이 갈아 끼운다
    decide: () => fail(404, '', 'x'),
    ...options,
  };
  window.history.replaceState(null, '', '/segan/assistant.html' + opts.hash);
  const doc = new DOMParser().parseFromString(read('segan/assistant.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of ['AdminAccess', 'DadamMyPageWork', 'SeganShell', 'SeganAssistant'])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
  };
  const calls = [];
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: SESSION } }) },
      rpc: async () => ({ data: [], error: null }),
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    const headers = init.headers || {};
    calls.push({
      url,
      method: init.method || 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      key: headers['X-Idempotency-Key'] || null,
      auth: headers.Authorization,
    });
    const reply = async (r) => {
      const v = await r;
      if (v instanceof Error) throw v;
      return {
        ok: v.ok,
        status: v.status,
        json: async () => v.body,
        text: async () => v.text || '',
        body: v.stream || null,
      };
    };
    if (url.startsWith(WORK)) {
      const wp = new URL(url).pathname;
      if (wp === '/ledger/notices') return reply(opts.notices());
      if (wp === '/ledger/notices/seen') return reply(opts.seen(JSON.parse(init.body)));
      if (wp === '/brief/today') return reply(opts.brief());
      return reply(ok({ ready: true, worker: null })); // /work/me
    }
    const u = new URL(url);
    const p = u.pathname;
    if (u.origin !== AS) throw new Error('unexpected ' + url);
    if (p === '/assistant/me') return reply(opts.me);
    if (p === '/assistant/conversations')
      return reply(init.method === 'POST' ? opts.create() : opts.list());
    let m = /^\/assistant\/conversations\/([^/]+)$/.exec(p);
    if (m) return reply(opts.conv(m[1]));
    m = /^\/assistant\/conversations\/([^/]+)\/turns$/.exec(p);
    if (m) return reply(opts.turn(JSON.parse(init.body), headers['X-Idempotency-Key'], m[1]));
    m = /^\/assistant\/actions\/([^/]+)\/(approve|reject)$/.exec(p);
    if (m) return reply(opts.decide(m[1], m[2]));
    m = /^\/assistant\/conversations\/([^/]+)\/events$/.exec(p);
    if (m) return reply(opts.events(Number(u.searchParams.get('after')), m[1]));
    throw new Error('unexpected ' + url);
  });
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  (0, eval)(read('segan/shell.js'));
  (0, eval)(read('segan/assistant.js'));
  window.SeganAssistant.timing.waitMs = 0;
  await window.SeganShell.ready;
  await window.SeganAssistant.ready;
  await flush();
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
};
const bubbles = () =>
  [...$('asMsgs').querySelectorAll('.as-msg')].map((li) => [
    li.classList.contains('as-msg--ai') ? 'ai' : 'user',
    li.querySelector('.as-text').textContent,
  ]);
const asCalls = (calls, re) => calls.filter((c) => c.url.startsWith(AS) && re.test(c.url));
const type = (text) => {
  $('asText').value = text;
};
const submit = async () => {
  $('asForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await flush();
};
const openFirst = async () => {
  $('asConvs').querySelector('[data-id]').click();
  await flush();
};
/** 손으로 푸는 약속 */
const later = () => {
  let resolve;
  const p = new Promise((r) => (resolve = r));
  return { p, resolve };
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('누가', () => {
  test('대화 자격(full) — 목록 · 새 대화 · 입력 칸 (막대에는 비서 탭이 없고 「마이」가 켜진다)', async () => {
    const calls = await load();
    expect($('asBody').hidden).toBe(false);
    expect($('asReadonly').hidden).toBe(true);
    expect($('asNew').hidden).toBe(false);
    expect($('asForm').hidden).toBe(false);
    expect($('asChat').hidden).toBe(true);
    const item = $('asConvs').querySelector('[data-id]');
    expect(item.getAttribute('data-id')).toBe(C1);
    expect(item.querySelector('b').textContent).toBe('지난 대화');
    expect(item.querySelector('small').textContent).toBe('11.02 12:04'); // 한국 시간
    expect(document.querySelector('[data-tab-link="assistant"]')).toBeNull();
    expect(
      document.querySelector('nav.sg-tabbar [aria-current="page"]').getAttribute('data-tab-link')
    ).toBe('me');
    const me = asCalls(calls, /\/assistant\/me$/);
    expect(me.length).toBeGreaterThanOrEqual(1);
    expect(me.every((c) => c.auth === 'Bearer tok-1')).toBe(true);
    expect($('asText').getAttribute('maxlength')).toBe('4000');
    expect(document.querySelector('.as-warn').textContent).toBe(
      'AI가 만든 내용은 틀릴 수 있습니다. 숫자는 장부 · 수주 화면에서 확인하세요'
    );
  });

  test('보기 자격(read) — 지난 대화만, 새 대화 · 입력 칸 없음', async () => {
    await load({ me: ok({ ...ME, level: 'read', can_chat: false }) });
    expect($('asBody').hidden).toBe(false);
    expect($('asReadonly').hidden).toBe(false);
    expect($('asNew').hidden).toBe(true);
    expect($('asForm').hidden).toBe(true);
    await openFirst();
    expect(bubbles()).toHaveLength(2);
  });

  test.each([
    ['구성원 아님', fail(403, 'not_member', 'x'), '비서는 팩토리 구성원만 씁니다.'],
    ['자격 없음 (403)', fail(403, 'not_entitled', 'x'), '비서를 쓸 수 없는 팩토리입니다.'],
    ['자격 none', ok({ ...ME, level: 'none', can_chat: false }), '비서를 쓸 수 없는 팩토리입니다.'],
    ['서버 오류', fail(500, '', 'x'), '비서를 불러오지 못했습니다.'],
  ])('%s — 이유 한 줄, 목록을 묻지 않는다', async (_name, me, msg) => {
    const calls = await load({ me });
    expect($('asState').textContent).toBe(msg);
    expect($('asBody').hidden).toBe(true);
    expect(asCalls(calls, /\/assistant\/conversations/)).toEqual([]);
    expect(document.querySelector('[data-tab-link="assistant"]')).toBeNull();
  });
});

describe('대화', () => {
  test('열기 — 사람 · 비서 말풍선, 비서 글은 「AI가 만든 내용」, 글은 HTML 로 바꾸지 않는다', async () => {
    await load();
    await openFirst();
    expect($('asChat').hidden).toBe(false);
    expect($('asListView').hidden).toBe(true);
    expect($('asConvTitle').textContent).toBe('지난 대화');
    expect(bubbles()).toEqual([
      ['user', '미수금 알려 줘'],
      ['ai', '<b>두 건</b>입니다.\n둘째 줄'],
    ]);
    expect($('asMsgs').querySelector('b')).toBeNull();
    const ai = $('asMsgs').querySelector('.as-msg--ai');
    expect(ai.querySelector('.as-tag').textContent).toBe('AI가 만든 내용');
    expect($('asMsgs').querySelector('.as-msg--user .as-tag')).toBeNull();
    expect(window.location.hash).toBe('#c=' + C1);

    $('asBack').click();
    await flush();
    expect($('asChat').hidden).toBe(true);
    expect($('asListView').hidden).toBe(false);
    expect(window.location.hash).toBe('');
  });

  test('주소 #c= 로 열면 그 대화를 연다, 없는 대화(404)는 목록 + 한 줄', async () => {
    await load({ hash: '#c=' + C1 });
    expect($('asChat').hidden).toBe(false);
    expect(bubbles()).toHaveLength(2);
    await load({ hash: '#c=' + C2, conv: () => fail(404, '', '대화가 없습니다') });
    expect($('asChat').hidden).toBe(true);
    expect($('asState').textContent).toBe('대화를 찾지 못했습니다.');
  });

  test('새 대화 — POST 하고 바로 연다 (빈 대화, 목록 맨 위)', async () => {
    const calls = await load();
    $('asNew').click();
    await flush();
    expect(asCalls(calls, /\/assistant\/conversations$/).map((c) => c.method)).toEqual([
      'GET',
      'POST',
    ]);
    expect($('asChat').hidden).toBe(false);
    expect($('asConvTitle').textContent).toBe('새 대화');
    expect(bubbles()).toEqual([]);
    expect(
      [...$('asConvs').querySelectorAll('[data-id]')].map((b) => b.getAttribute('data-id'))
    ).toEqual([C2, C1]);
    expect(window.location.hash).toBe('#c=' + C2);
  });
});

describe('보내기 · 사건', () => {
  test('보내기 — 키를 붙여 POST, tool 한 줄 → 글 조각을 잇고 done 으로 끝 (제목 · 목록 다시)', async () => {
    const gate = later();
    let n = 0;
    const calls = await load({
      events: async () => {
        n++;
        if (n === 1)
          return lines(
            { n: 1, type: 'start', turn: 1 },
            { n: 2, type: 'tool', turn: 1, label: '수주 목록 보는 중' }
          );
        await gate.p;
        return lines(
          { n: 3, type: 'text', turn: 1, text: '안녕' },
          { n: 4, type: 'text', turn: 1, text: '하세요' },
          { n: 5, type: 'done', turn: 1, stop_reason: 'end_turn' }
        );
      },
    });
    $('asNew').click();
    await flush();
    type('  오늘 할 일 정리해 줘  ');
    await submit();

    const post = asCalls(calls, /\/turns$/);
    expect(post).toHaveLength(1);
    expect(post[0].url).toBe(`${AS}/assistant/conversations/${C2}/turns`);
    expect(post[0].body).toEqual({ text: '오늘 할 일 정리해 줘' });
    expect(post[0].key).toMatch(KEY_RE);
    expect(post[0].auth).toBe('Bearer tok-1');
    expect($('asText').value).toBe('');

    // 차례가 도는 중 — 보내기 막힘, 상태 한 줄, 기다리는 말풍선
    expect($('asSend').disabled).toBe(true);
    expect($('asTool').hidden).toBe(false);
    expect($('asTool').textContent).toBe('수주 목록 보는 중');
    expect(bubbles()).toEqual([
      ['user', '오늘 할 일 정리해 줘'],
      ['ai', '답을 만드는 중…'],
    ]);

    gate.resolve();
    await flush();
    expect(bubbles()).toEqual([
      ['user', '오늘 할 일 정리해 줘'],
      ['ai', '안녕하세요'],
    ]);
    expect($('asMsgs').querySelector('.as-msg--wait')).toBeNull();
    expect($('asTool').hidden).toBe(true);
    expect($('asEnd').hidden).toBe(true);
    expect($('asSend').disabled).toBe(false);
    expect($('asConvTitle').textContent).toBe('오늘 할 일 정리해 줘');
    const ev = asCalls(calls, /\/events\?/).map((c) => new URL(c.url).searchParams.get('after'));
    expect(ev).toEqual(['0', '2']); // 끝 사건 없이 닫히면 받은 마지막 n 부터
    expect(
      asCalls(calls, /\/assistant\/conversations$/).filter((c) => c.method === 'GET')
    ).toHaveLength(2);
  });

  test('다시 열어도 같은 사건(n)을 두 번 쓰지 않는다 · 다른 차례 사건은 넘긴다 · 모르는 사건은 넘긴다', async () => {
    let n = 0;
    await load({
      hash: '#c=' + C1,
      turn: () => ok({ turn: 2, after: 10, reused: false }, 202),
      events: () => {
        n++;
        if (n === 1)
          return lines(
            { n: 9, type: 'text', turn: 1, text: '옛 차례' },
            { n: 11, type: 'start', turn: 2 },
            { n: 12, type: 'text', turn: 2, text: '반' }
          );
        return lines(
          { n: 12, type: 'text', turn: 2, text: '반' },
          { n: 13, type: 'whatever', turn: 2 },
          { n: 14, type: 'text', turn: 2, text: '쯤' },
          { n: 15, type: 'done', turn: 2 }
        );
      },
    });
    type('둘째');
    await submit();
    expect(bubbles().at(-1)).toEqual(['ai', '반쯤']);
  });

  test.each([
    [
      'blocked over_limit',
      { n: 2, type: 'blocked', turn: 1, reason: 'over_limit' },
      '이달 비서 한도를 다 썼습니다',
    ],
    [
      'blocked no_limit',
      { n: 2, type: 'blocked', turn: 1, reason: 'no_limit' },
      '이달 비서 한도가 정해지지 않았습니다',
    ],
    [
      'blocked conversation_full',
      { n: 2, type: 'blocked', turn: 1, reason: 'conversation_full' },
      '대화가 길어졌습니다. 새 대화를 시작해 주세요',
    ],
    ['blocked off', { n: 2, type: 'blocked', turn: 1, reason: 'off' }, '비서가 꺼져 있습니다'],
    [
      'blocked not_entitled',
      { n: 2, type: 'blocked', turn: 1, reason: 'not_entitled' },
      '비서를 쓸 수 없는 팩토리입니다',
    ],
    ['refused', { n: 2, type: 'refused', turn: 1 }, '이 내용에는 답할 수 없습니다'],
    [
      'error',
      {
        n: 2,
        type: 'error',
        turn: 1,
        code: 'claude',
        message: '답을 만들지 못했습니다. 잠시 뒤 다시 보내 주세요.',
      },
      '답을 만들지 못했습니다. 잠시 뒤 다시 보내 주세요.',
    ],
  ])('%s — 말풍선을 거두고 글을 되돌린다', async (_name, end, msg) => {
    await load({
      hash: '#c=' + C2,
      events: () =>
        lines({ n: 1, type: 'start', turn: 1 }, { n: 1.5, type: 'text', turn: 1, text: '반' }, end),
    });
    type('보낼 글');
    await submit();
    expect(bubbles()).toEqual([]);
    expect($('asText').value).toBe('보낼 글');
    expect($('asEnd').hidden).toBe(false);
    expect($('asEnd').textContent).toBe(msg);
    expect($('asSend').disabled).toBe(false);
  });

  test.each([
    ['409 busy', fail(409, 'busy', 'x'), '앞 답을 만드는 중입니다'],
    ['429', fail(429, 'rate_limited', 'x'), '잠시 뒤 다시 보내 주세요'],
    ['403 not_entitled', fail(403, 'not_entitled', 'x'), '비서를 쓸 수 없는 팩토리입니다'],
    ['422', fail(422, '', '글은 4000자까지 보냅니다'), '글은 4000자까지 보냅니다'],
  ])(
    '보내기 %s — 이유 한 줄, 말풍선 없이 글을 되돌린다, 사건 줄을 열지 않는다',
    async (_name, res, msg) => {
      const calls = await load({ hash: '#c=' + C2, turn: () => res });
      type('보낼 글');
      await submit();
      expect($('asEnd').textContent).toBe(msg);
      expect(bubbles()).toEqual([]);
      expect($('asText').value).toBe('보낼 글');
      expect(asCalls(calls, /\/events\?/)).toEqual([]);
      expect($('asSend').disabled).toBe(false);
    }
  );

  test('보내기가 끊기면 같은 키로 한 번 더 — 두 번 다 끊기면 한 줄', async () => {
    let n = 0;
    const calls = await load({
      hash: '#c=' + C2,
      turn: () => (++n === 1 ? new TypeError('Failed to fetch') : ok({ turn: 1, after: 0 }, 202)),
    });
    type('하나');
    await submit();
    const post = asCalls(calls, /\/turns$/);
    expect(post).toHaveLength(2);
    expect(post[0].key).toBe(post[1].key);
    expect(bubbles().map((b) => b[0])).toEqual(['user', 'ai']);

    const calls2 = await load({ hash: '#c=' + C2, turn: () => new TypeError('Failed to fetch') });
    type('둘');
    await submit();
    expect(asCalls(calls2, /\/turns$/)).toHaveLength(2);
    expect($('asEnd').textContent).toBe('연결이 끊겨 보내지 못했습니다. 다시 보내 주세요.');
    expect($('asText').value).toBe('둘');
  });

  test('빈 글은 보내지 않는다', async () => {
    const calls = await load({ hash: '#c=' + C2 });
    type('   ');
    await submit();
    expect($('asEnd').textContent).toBe('보낼 글을 적어 주세요.');
    expect(asCalls(calls, /\/turns$/)).toEqual([]);
  });

  test('새로 고침 — running 이면 그 차례를 after 부터 이어 받는다', async () => {
    const calls = await load({
      hash: '#c=' + C1,
      conv: (id) => CONV(id, { running: { turn: 3, after: 5 } }),
      events: (after) =>
        lines(
          { n: after + 1, type: 'text', turn: 3, text: '이어 받은 답' },
          { n: after + 2, type: 'done', turn: 3 }
        ),
    });
    expect(asCalls(calls, /\/events\?/).map((c) => c.url)).toEqual([
      `${AS}/assistant/conversations/${C1}/events?after=5`,
    ]);
    expect(bubbles().at(-1)).toEqual(['ai', '이어 받은 답']);
    expect($('asSend').disabled).toBe(false);
  });

  test('사건 줄 조각 — 한 줄이 둘로 나뉘어 와도 이어 읽는다 (getReader)', async () => {
    const chunks = [
      '{"n":1,"type":"start","turn":1}\n{"n":2,"type":"te',
      'xt","turn":1,"text":"조각"}\n',
      '{"n":3,"type":"done","turn":1}',
    ];
    await load({
      hash: '#c=' + C2,
      events: () => ({
        ok: true,
        status: 200,
        stream: {
          getReader() {
            let i = 0;
            return {
              read: async () =>
                i < chunks.length ? { done: false, value: chunks[i++] } : { done: true },
              cancel() {},
            };
          },
        },
      }),
    });
    type('하나');
    await submit();
    expect(bubbles().at(-1)).toEqual(['ai', '조각']);
  });

  test('사건 줄이 404 면 그만둔다 · 계속 끊기면 정해진 만큼만 다시 열고 그만둔다 (보낸 말풍선은 남긴다)', async () => {
    await load({ hash: '#c=' + C2, events: () => fail(404, '', 'x') });
    type('하나');
    await submit();
    expect($('asEnd').textContent).toBe('답을 받지 못했습니다. 대화를 다시 열어 주세요.');
    expect(bubbles()).toEqual([['user', '하나']]);

    const calls = await load({ hash: '#c=' + C2, events: () => new TypeError('Failed to fetch') });
    window.SeganAssistant.timing.retry = 2;
    type('둘');
    await submit();
    expect(asCalls(calls, /\/events\?/)).toHaveLength(3);
    expect($('asEnd').textContent).toBe('답을 받지 못했습니다. 대화를 다시 열어 주세요.');
    expect($('asSend').disabled).toBe(false);
  });

  test('대화를 떠나면 따라가기를 멈춘다 — 뒤에 오는 사건은 다른 대화에 쓰지 않는다', async () => {
    const gate = later();
    await load({
      hash: '#c=' + C2,
      events: async () => {
        await gate.p;
        return lines(
          { n: 1, type: 'text', turn: 1, text: '늦은 답' },
          { n: 2, type: 'done', turn: 1 }
        );
      },
    });
    type('하나');
    await submit();
    $('asBack').click();
    await flush();
    await openFirst();
    gate.resolve();
    await flush();
    expect(bubbles()).toEqual([
      ['user', '미수금 알려 줘'],
      ['ai', '<b>두 건</b>입니다.\n둘째 줄'],
    ]);
    expect($('asSend').disabled).toBe(false);
  });
});

describe('장부 알림', () => {
  const N = (n, over = {}) => ({
    id: `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    kind: 'large_amount',
    urgency: 'now',
    document_id: null,
    entry_id: null,
    cost_id: null,
    data: { supplier: '가나목재', total: 2480000, median: 860000, n: 6, ratio: 2.9 },
    created_at: '2026-11-03T05:00:00Z',
    seen_at: null,
    ...over,
  });
  const cards = () => [...$('asNoticeList').querySelectorAll('.as-ncard')];

  test('대표 — 서버 숫자로 카드(바로 알림 · 아침 묶음 · 본 것), 다섯 장 뒤는 「모두 보기」', async () => {
    const items = [
      N(1),
      N(2, {
        kind: 'price_change',
        urgency: 'digest',
        data: { supplier: '가나목재', item: 'PB 18T', old: 32000, new: 35000 },
      }),
      N(3, {
        kind: 'supplier_status',
        urgency: 'digest',
        data: { supplier: '다라철물', status: 'closed', closed_on: '2026-10-15' },
      }),
      N(4, {
        kind: 'evidence_risk',
        urgency: 'digest',
        data: { supplier: '마바', total: 54000, evidence_type: 'simple_receipt' },
      }),
      N(5, {
        kind: 'duplicate',
        data: { supplier: '사아', of: { created_at: '2026-11-01T00:10:00Z' } },
      }),
      N(6, {
        kind: 'new_supplier',
        urgency: 'digest',
        data: { supplier: '자차' },
        seen_at: '2026-11-03T06:00:00Z',
      }),
    ];
    const calls = await load({ notices: () => ok({ items, unseen: 5, available: true }) });
    expect(calls.filter((c) => c.url === WORK + '/ledger/notices?limit=30').length).toBe(1);
    expect($('asNotices').hidden).toBe(false);
    expect($('asNoticesTitle').textContent).toBe('장부 알림 5건 새로');
    expect(cards().map((c) => c.querySelector('.as-ncard-body').textContent)).toEqual([
      '가나목재 2,480,000원 — 최근 6번 중앙값 860,000원의 2.9배',
      '가나목재 PB 18T 단가 32,000원 → 35,000원 (+9%) · 읽은 값 기준',
      '다라철물 — 국세청 조회: 폐업 (2026-10-15)',
      '마바 54,000원 — 간이영수증 (3만원 넘음) · 가산세 2% 위험 참고',
      '사아 — 같은 날짜 · 금액 사진이 이미 있습니다 (11.01 09:10 사진)',
    ]);
    expect(cards()[0].className).toBe('as-ncard as-ncard--now');
    expect(cards()[1].className).toBe('as-ncard as-ncard--am');
    expect($('asNoticesMore').hidden).toBe(false);
    $('asNoticesMore').click();
    expect(cards().length).toBe(6);
    expect(cards()[5].classList.contains('as-ncard--seen')).toBe(true);
  });

  test('명세표 알림 둘 — 합계 다름 · 세금계산서 없음 (서버 숫자)', async () => {
    const items = [
      N(1, {
        kind: 'statement_mismatch',
        urgency: 'digest',
        data: {
          supplier: '마바상사',
          on_date: '2026-10-31',
          n: 2,
          basis: 'supply',
          statements: 880000,
          invoice: 1000000,
          diff: -120000,
        },
      }),
      N(2, {
        kind: 'invoice_missing',
        urgency: 'digest',
        data: { supplier: '다라철물', month: '2026-10', count: 4, supply: 412000, total: 453200 },
      }),
    ];
    await load({ notices: () => ok({ items, unseen: 2, available: true }) });
    expect(cards().map((c) => c.querySelector('.as-ncard-body').textContent)).toEqual([
      '마바상사 2026-10-31 — 명세표 2장 공급가 880,000원 · 세금계산서 1,000,000원',
      '다라철물 2026-10 명세표 4장 · 공급가 412,000원 — 다음 달 10일 발급 기한이 지났습니다',
    ]);
  });

  test('월 보고 — 서버 숫자 한 줄, 누르면 그 달 보고서로', async () => {
    const items = [
      N(1, {
        kind: 'month_report',
        urgency: 'digest',
        data: { month: '2026-10', rows: 42, income: 48200000, expense: 31050000, profit: 17150000 },
      }),
    ];
    await load({ notices: () => ok({ items, unseen: 1, available: true }) });
    expect(cards()[0].querySelector('b').textContent).toBe('지난달 회계 보고');
    expect(cards()[0].querySelector('.as-ncard-body').textContent).toBe(
      '2026-10 — 매출 48,200,000원 · 매입 31,050,000원 · 장부 손익 17,150,000원'
    );
    expect(cards()[0].querySelector('.as-ncard-go').textContent).toBe('보고서 보기 ›');
    const go = jest.fn();
    window.SeganAssistant.go = go;
    cards()[0].click();
    await flush();
    expect(go).toHaveBeenCalledWith('ledger-report.html?month=2026-10');
  });

  test('카드를 누르면 본 표시 뒤 장부로, 「모두 봤어요」는 안 본 것 한꺼번에', async () => {
    const items = [N(1), N(2, { urgency: 'digest' }), N(3, { seen_at: '2026-11-03T06:00:00Z' })];
    const calls = await load({ notices: () => ok({ items, unseen: 2, available: true }) });
    const go = jest.fn();
    window.SeganAssistant.go = go;
    cards()[0].click();
    await flush();
    const seen = calls.filter((c) => c.url === WORK + '/ledger/notices/seen');
    expect(seen.map((c) => c.body)).toEqual([{ ids: [items[0].id] }]);
    expect(seen[0].method).toBe('POST');
    expect(go).toHaveBeenCalledWith('ledger.html');
    expect(cards()[0].classList.contains('as-ncard--seen')).toBe(true);
    $('asNoticesSeen').click();
    await flush();
    expect(calls.filter((c) => c.url === WORK + '/ledger/notices/seen').map((c) => c.body)).toEqual(
      [{ ids: [items[0].id] }, { ids: [items[1].id] }]
    );
    expect($('asNoticesSeen').hidden).toBe(true);
    expect($('asNoticesTitle').textContent).toBe('장부 알림');
  });

  test('직원(돈 정보 없음)은 묻지 않고, 알림을 못 받으면(403) 칸을 숨긴다 — 대화는 그대로', async () => {
    const staff = await load({ me: ok({ ...ME, role: 'staff', money: false }) });
    expect(staff.some((c) => c.url.startsWith(WORK + '/ledger/'))).toBe(false);
    expect($('asNotices').hidden).toBe(true);
    await load({ notices: () => fail(403, 'not_money', '대표 · 실장만 봅니다') });
    expect($('asNotices').hidden).toBe(true);
    expect($('asConvs').querySelectorAll('[data-id]').length).toBe(1);
  });
});

describe('오늘 브리핑', () => {
  const BRIEF = (over = {}) => ({
    date: '2026-11-05',
    role: 'owner',
    money: true,
    count: 8,
    items: {
      consults: { count: 2, next_deadline: '2026-11-05T23:30:00.000Z' },
      receivables: {
        count: 2,
        total: 500000,
        late_count: 1,
        late_total: 300000,
        today_count: 1,
        today_total: 200000,
      },
      schedules: {
        count: 2,
        items: [
          {
            type: 'delivery',
            at: '2026-11-06T01:00:00Z',
            status: 'scheduled',
            order_no: 'SO-20261101-AAAA',
          },
          { type: 'installation', at: '2026-11-11T01:00:00Z', status: 'confirmed', order_no: null },
        ],
      },
      requests: { count: 1 },
      photos: { count: 0 },
      notices: { count: 1 },
    },
    stages: {
      projects: { consult: 1, render: 0, design: 2, quote: 1 },
      orders: { confirmed: 1, in_production: 1, delivered: 0 },
    },
    work: [
      {
        order_no: 'SO-20261101-AAAA',
        status: 'in_production',
        roles: {
          cut: { done: 1, total: 2, must_left: 0 },
          edge: null,
          assembly: { done: 0, total: 1, must_left: 1 },
          install: null,
        },
      },
    ],
    ...over,
  });
  const lines = () =>
    [...$('asBriefList').children].map((li) => [
      li.getAttribute('data-brief'),
      li.firstChild.textContent,
      li.firstChild.getAttribute('href'),
      li.querySelector('small') ? li.querySelector('small').textContent : '',
    ]);

  test('대표 — 수가 있는 볼 것만 한 줄씩(서버 수 그대로 · 바로 가기), 진행 단계 한 줄, 공장 · 설치 진행 표', async () => {
    const calls = await load({ brief: () => ok(BRIEF()) });
    expect(calls.filter((c) => c.url === WORK + '/brief/today').length).toBe(1);
    expect($('asBrief').hidden).toBe(false);
    expect($('asBriefTitle').textContent).toBe('오늘 브리핑 8건');
    expect(lines()).toEqual([
      [
        'consults',
        '응답 기다리는 상담 2건 ›',
        'me.html#partner-consults',
        '가장 이른 마감 11.06 08:30',
      ],
      [
        'receivables',
        '받을 수금 2건 · 500,000원 ›',
        'ledger.html#sales',
        '지남 1건 300,000원 · 오늘 1건 200,000원',
      ],
      [
        'schedules',
        '7일 안 납품 · 설치 2건',
        null,
        '11.06 10:00 납품 SO-20261101-AAAA · 11.11 10:00 설치',
      ],
      ['requests', '대표 결정 기다리는 수주 요청 1건 ›', 'me.html#partner', ''],
      ['notices', '새 장부 알림 1건 ›', '#asNotices', '지난 24시간'],
    ]);
    expect($('asBriefNone').hidden).toBe(true);
    expect($('asBriefStages').textContent).toBe(
      '상담 1 · 설계 2 · 견적 1 · 수주 확정 1 · 제작 중 1'
    );
    expect(
      [...$('asBriefWork').querySelectorAll('tr')].map((tr) =>
        [...tr.children].map((c) => c.textContent)
      )
    ).toEqual([['SO-20261101-AAAA · 제작 중', '1/2', '—', '0/1', '—']]);
    expect($('asBriefAsk').hidden).toBe(false);
  });

  test('직원 — 일정 · 현황만 (서버가 준 null 칸은 그리지 않는다), 대화할 수 없으면 묻기 단추 없음', async () => {
    const b = BRIEF({
      role: 'staff',
      money: false,
      count: 2,
      work: [],
      items: {
        consults: null,
        receivables: null,
        schedules: BRIEF().items.schedules,
        requests: null,
        photos: null,
        notices: null,
      },
    });
    await load({
      me: ok({ ...ME, role: 'staff', money: false, can_chat: false }),
      brief: () => ok(b),
    });
    expect(lines().map((l) => l[0])).toEqual(['schedules']);
    expect($('asBrief').textContent).not.toContain('원');
    expect($('asBriefWorkWrap').hidden).toBe(true);
    expect($('asBriefAsk').hidden).toBe(true);
  });

  test('볼 것이 없으면 한 줄, 못 받으면(403) 칸을 숨긴다 — 대화는 그대로', async () => {
    const empty = BRIEF({
      count: 0,
      items: { consults: { count: 0, next_deadline: null }, schedules: { count: 0, items: [] } },
      stages: { projects: { consult: 0 }, orders: { confirmed: 0 } },
      work: [],
    });
    await load({ brief: () => ok(empty) });
    expect($('asBrief').hidden).toBe(false);
    expect($('asBriefTitle').textContent).toBe('오늘 브리핑');
    expect($('asBriefNone').hidden).toBe(false);
    expect($('asBriefStages').hidden).toBe(true);
    await load({ brief: () => fail(403, 'not_entitled', '비서를 쓰는 업체만') });
    expect($('asBrief').hidden).toBe(true);
    expect($('asConvs').querySelectorAll('[data-id]').length).toBe(1);
  });

  test('비서에게 묻기 — 새 대화를 열고 정리를 묻는다', async () => {
    const calls = await load({ brief: () => ok(BRIEF()) });
    $('asBriefAsk').click();
    await flush();
    // 처음 목록 · 새 대화 (차례가 끝나면 목록을 다시 받는다)
    expect(
      asCalls(calls, /\/assistant\/conversations$/)
        .map((c) => c.method)
        .slice(0, 2)
    ).toEqual(['GET', 'POST']);
    const turn = calls.find((c) => /\/turns$/.test(c.url));
    expect(turn.body).toEqual({ text: '오늘 브리핑을 정리해 주세요.' });
    expect(window.location.hash).toBe('#c=' + C2);
  });

  test('묻기 — 새 대화를 못 열면 옛 대화에 보내지 않는다', async () => {
    // 대화 하나를 연 채로 — 새 대화를 못 열면 그 대화에 보내면 안 된다
    const calls = await load({
      hash: '#c=' + C1,
      brief: () => ok(BRIEF()),
      create: () => fail(500, '', 'x'),
    });
    expect($('asChat').hidden).toBe(false);
    $('asBriefAsk').click();
    await flush();
    expect(calls.some((c) => /\/turns$/.test(c.url))).toBe(false);
  });
});

describe('승인 카드', () => {
  const K1 = 'f0000000-0000-4000-8000-000000000001';
  const K2 = 'f0000000-0000-4000-8000-000000000002';
  const K3 = 'f0000000-0000-4000-8000-000000000003';
  const ACT = (id, over = {}) => ({
    id,
    kind: 'order_status',
    state: 'proposed',
    state_name: '승인 기다림',
    card: {
      title: '수주 상태 바꾸기',
      subject: 'SO-20261101-AAAA',
      fields: [
        { label: '수주', value: 'SO-20261101-AAAA' },
        { label: '바꿀 상태', value: '제작 중' },
      ],
    },
    created_at: '2026-11-05T01:00:03Z',
    expires_at: '2026-11-06T01:00:03Z',
    decided_at: null,
    finished_at: null,
    result: null,
    ...over,
  });
  const CONV_WITH = (actions) =>
    ok({
      conversation: { id: C1, title: '지난 대화', created_at: 'x', updated_at: 'x' },
      messages: [
        { seq: 1, role: 'user', text: '제작 중으로 바꿔 줘', created_at: '2026-11-05T01:00:05Z' },
        {
          seq: 2,
          role: 'assistant',
          text: '카드를 만들었습니다',
          created_at: '2026-11-05T01:00:05Z',
        },
        { seq: 5, role: 'user', text: '고마워', created_at: '2026-11-05T01:05:00Z' },
        { seq: 6, role: 'assistant', text: '네', created_at: '2026-11-05T01:05:00Z' },
      ],
      running: null,
      actions,
    });
  const order = () =>
    [...$('asMsgs').children].map((li) =>
      li.getAttribute('data-card')
        ? 'card:' + li.getAttribute('data-card').slice(-1)
        : li.querySelector('.as-text').textContent
    );
  const acts = (id) =>
    [
      ...$('asMsgs')
        .querySelector('[data-card="' + id + '"]')
        .querySelectorAll('[data-act]'),
    ].map((b) => b.textContent);

  test('다시 열면 카드를 그 차례 비서 말풍선 아래에 — 기다림은 승인 · 거절 · 기한, 완료는 상태와 결과만, 초안은 복사', async () => {
    await load({
      hash: '#c=' + C1,
      conv: () =>
        CONV_WITH([
          ACT(K1),
          ACT(K2, { state: 'done', state_name: '완료', result: { message: null, pending: false } }),
          ACT(K3, {
            kind: 'draft',
            state: 'draft',
            state_name: '초안',
            card: { title: '고객 연락 초안', subject: '실측', text: '내일 10시 방문드립니다.' },
            created_at: '2026-11-05T01:04:59Z',
          }),
        ]),
    });
    expect(order()).toEqual([
      '제작 중으로 바꿔 줘',
      '카드를 만들었습니다',
      'card:1',
      'card:2',
      '고마워',
      '네',
      'card:3',
    ]);
    const k1 = $('asMsgs').querySelector('[data-card="' + K1 + '"]');
    expect(k1.querySelector('.as-tag').textContent).toBe('승인 카드');
    expect(k1.querySelector('.as-card-title').textContent).toBe('수주 상태 바꾸기승인 기다림');
    expect([...k1.querySelectorAll('dd')].map((d) => d.textContent)).toEqual([
      'SO-20261101-AAAA',
      '제작 중',
    ]);
    expect(acts(K1)).toEqual(['승인', '거절']);
    expect(k1.querySelector('.as-card-acts small').textContent).toBe('11.06 10:00까지');
    expect(acts(K2)).toEqual([]);
    expect($('asMsgs').querySelector('[data-card="' + K2 + '"]').className).toBe(
      'as-card as-card--done'
    );
    expect(acts(K3)).toEqual(['복사']);
    expect($('asMsgs').querySelector('[data-card="' + K3 + '"] .as-card-draft').textContent).toBe(
      '내일 10시 방문드립니다.'
    );
  });

  test('차례 중 사건 card — 맨 아래에 붙는다', async () => {
    await load({
      events: () =>
        lines(
          { n: 1, type: 'start', turn: 1 },
          { n: 2, type: 'card', turn: 1, action: ACT(K1) },
          { n: 3, type: 'text', turn: 1, text: '카드를 만들었습니다' },
          { n: 4, type: 'done', turn: 1 }
        ),
    });
    $('asNew').click();
    await flush();
    type('제작 중으로');
    $('asSend').click();
    await flush();
    expect(order()).toEqual(['제작 중으로', '카드를 만들었습니다', 'card:1']);
    expect(acts(K1)).toEqual(['승인', '거절']);
  });

  test('승인 — POST approve, 받은 카드로 다시 그린다 (단추 없음 · 상태), 거절도 같다', async () => {
    const decided = [];
    const calls = await load({
      hash: '#c=' + C1,
      conv: () => CONV_WITH([ACT(K1), ACT(K2)]),
      decide: (id, act) => {
        decided.push([id, act]);
        return ok({
          action:
            act === 'approve'
              ? ACT(id, {
                  state: 'done',
                  state_name: '완료',
                  result: { message: null, pending: false },
                })
              : ACT(id, { state: 'rejected', state_name: '거절함' }),
        });
      },
    });
    $('asMsgs')
      .querySelector('[data-card="' + K1 + '"] [data-act="approve"]')
      .click();
    await flush();
    $('asMsgs')
      .querySelector('[data-card="' + K2 + '"] [data-act="reject"]')
      .click();
    await flush();
    expect(decided).toEqual([
      [K1, 'approve'],
      [K2, 'reject'],
    ]);
    expect(asCalls(calls, /\/assistant\/actions\//).map((c) => c.method)).toEqual(['POST', 'POST']);
    expect(acts(K1)).toEqual([]);
    expect($('asMsgs').querySelector('[data-card="' + K1 + '"] .as-card-state').textContent).toBe(
      '완료'
    );
    expect($('asMsgs').querySelector('[data-card="' + K2 + '"]').className).toBe(
      'as-card as-card--rejected'
    );
  });

  test('승인 — 기한 지남(409)이면 서버 문구와 함께 닫고, 끊기면 다시 누를 수 있게 둔다', async () => {
    let n = 0;
    await load({
      hash: '#c=' + C1,
      conv: () => CONV_WITH([ACT(K1), ACT(K2)]),
      decide: (id) => {
        n += 1;
        return id === K1
          ? fail(409, 'expired', '기한(24시간)이 지난 카드입니다')
          : new Error('offline');
      },
    });
    $('asMsgs')
      .querySelector('[data-card="' + K1 + '"] [data-act="approve"]')
      .click();
    await flush();
    const k1 = $('asMsgs').querySelector('[data-card="' + K1 + '"]');
    expect(k1.className).toBe('as-card as-card--expired');
    expect(k1.querySelector('.as-card-note').textContent).toBe('기한(24시간)이 지난 카드입니다');
    expect(acts(K1)).toEqual([]);
    $('asMsgs')
      .querySelector('[data-card="' + K2 + '"] [data-act="approve"]')
      .click();
    await flush();
    expect(acts(K2)).toEqual(['승인', '거절']);
    expect($('asMsgs').querySelector('[data-card="' + K2 + '"] .as-card-note').textContent).toBe(
      '처리하지 못했습니다. 잠시 뒤 다시 눌러 주세요.'
    );
    expect(n).toBe(2);
  });

  test('초안 복사 — 클립보드에 글 그대로, 못 쓰면 길게 눌러 복사 안내', async () => {
    const draft = ACT(K3, {
      kind: 'draft',
      state: 'draft',
      state_name: '초안',
      card: { title: '고객 연락 초안', text: '내일 10시 방문드립니다.' },
    });
    await load({ hash: '#c=' + C1, conv: () => CONV_WITH([draft]) });
    const written = [];
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (s) => written.push(s) },
    });
    $('asMsgs').querySelector('[data-act="copy"]').click();
    await flush();
    expect(written).toEqual(['내일 10시 방문드립니다.']);
    expect($('asMsgs').querySelector('[data-card="' + K3 + '"] .as-card-note').textContent).toBe(
      '복사했습니다'
    );
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => Promise.reject(new Error('no')) },
    });
    $('asMsgs').querySelector('[data-act="copy"]').click();
    await flush();
    expect($('asMsgs').querySelector('[data-card="' + K3 + '"] .as-card-note').textContent).toBe(
      '복사하지 못했습니다 — 글을 길게 눌러 복사해 주세요'
    );
  });
});

describe('순수', () => {
  test('stamp — 한국 시간 MM.DD HH:mm, 못 읽으면 빈 글', async () => {
    await load();
    const { stamp, takeLines } = window.SeganAssistant;
    expect(stamp('2026-11-02T15:30:00Z')).toBe('11.03 00:30');
    expect(stamp('x')).toBe('');
    expect(stamp(null)).toBe('');
    expect(takeLines('a\n\nb\nc')).toEqual({ lines: ['a', 'b'], rest: 'c' });
    expect(takeLines('')).toEqual({ lines: [], rest: '' });
  });

  test('sw.js 가 비서 화면을 담는다 · 화면은 innerHTML 을 쓰지 않는다', () => {
    const sw = read('segan/sw.js');
    expect(sw).toContain("SCOPE + 'assistant.html'");
    expect(sw).toContain("versioned(SCOPE + 'assistant.css')");
    expect(sw).toContain("versioned(SCOPE + 'assistant.js')");
    expect(read('segan/assistant.js')).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });
});
