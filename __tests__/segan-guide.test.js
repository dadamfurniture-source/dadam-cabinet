/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, global */
/**
 * SEGAN 비서 — 앱 모든 화면 (segan/guide.js + shell.css · shell.js)
 *
 *   어디에   셸 화면마다 shell.js 바로 뒤에 싣는다 (결제 돌아옴 · 초대 받기 · 오프라인 · 옛 주소는 뺀다).
 *            위 막대 「비서」 버튼(폰 · 태블릿) · 본문 아래 가운데 입력 줄(PC 1024px~) — 어느 것을 보일지는 shell.css 의 폭.
 *            폰은 아래 시트(kind sheet, 90dvh), PC 는 옆 패널(kind panel, 420px — 1024px 부터). 주소(#)는 그대로.
 *            만들기 · 상담 신청의 아래 버튼 줄(.mk-bar) · 업무 비서 입력(.as-form)이 있는 동안 PC 입력 줄은 감춘다.
 *   로그인 전 AI 를 부르지 않는다 — 자주 묻는 것 다섯 + 로그인(돌아올 곳 = 지금 화면)
 *   로그인 뒤 GET /assistant/guide 「오늘 n번 남음」 · POST /assistant/guide/turns NDJSON(start · text · done | refused | error)
 *            429 guide_limit · 403 guide_off · 429 rate_limited · 끊김. 대화는 이 탭(sessionStorage)에 두고 지난 차례를 보낸다.
 *            답은 글 그대로 — 정해 둔 앱 주소만 링크. Agent(업무 비서 자격)는 「업무 비서 열기」 → assistant.html
 */
const fs = require('fs');
const path = require('path');
const util = require('util');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const AuthRedirect = require('../js/auth-redirect.js');

const AS = 'https://dadam-assistant-api.dadamfurniture.workers.dev';
const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'customer@example.com' } };
const STORE = 'segan.guide.chat';
const STATUS = {
  on: true,
  used: 2,
  limit: 20,
  remaining: 18,
  day: '2026-11-08',
  reset_at: '2026-11-08T15:00:00Z',
};
const FULL = { company_id: 'c1', role: 'owner', money: true, level: 'full', can_chat: true };
/** 비서를 싣지 않는 셸 화면 — 결제창이 돌아오는 곳 · 직원 초대 받기 · 회계 한눈에 옛 주소(바로 넘긴다) */
const NO_GUIDE = ['pay.html', 'join.html', 'ledger-board.html'];

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message, data) => ({
  ok: false,
  status,
  body: { success: false, code, message, ...(data ? { data } : {}) },
});
/** NDJSON 조각들 → getReader 가 있는 본문 (문자열 · Uint8Array 둘 다) */
const chunked = (chunks) => ({
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
});
const lines = (...evs) => chunked([evs.map((e) => JSON.stringify(e)).join('\n') + '\n']);
/** 시험이 조각을 하나씩 넣는 본문 — 들어오는 중의 화면을 본다 */
function liveStream() {
  const queue = [];
  const waiters = [];
  const give = (v) => (waiters.length ? waiters.shift()(v) : queue.push(v));
  return {
    reply: {
      ok: true,
      status: 200,
      stream: {
        getReader: () => ({
          read: () =>
            queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r)),
          cancel() {},
        }),
      },
    },
    push: (ev) => give({ done: false, value: JSON.stringify(ev) + '\n' }),
    end: () => give({ done: true }),
  };
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what = '기다린 상태') {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await tick();
  }
  throw new Error(what + '가 오지 않았다');
}

/**
 * segan 화면을 올린다 — shell.js · guide.js 를 실제로 돌리고 Supabase · fetch · matchMedia 만 가짜로 둔다.
 * opts: session · wide(1024px~) · status(GET /assistant/guide 응답, Error 면 끊김) · turn(본문 → 응답)
 *       me(GET /assistant/me data — 없으면 403) · keepStorage · path(주소 — 기본 /segan/<page>)
 */
async function load(page = 'collection.html', options = {}) {
  const opts = {
    session: null,
    wide: false,
    status: ok(STATUS),
    turn: () => lines({ type: 'start', ...STATUS, used: 3, remaining: 17 }, { type: 'done' }),
    me: null,
    keepStorage: false,
    path: '/segan/' + page,
    ...options,
  };
  window.history.replaceState(null, '', opts.path);
  const doc = new DOMParser().parseFromString(read(`segan/${page}`), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  if (!opts.keepStorage) sessionStorage.clear();
  for (const k of ['AdminAccess', 'DadamMyPageWork', 'SeganShell', 'SeganGuide']) delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: 'https://work.example.workers.dev' },
  };
  window.matchMedia = jest.fn((q) => ({
    matches: q === '(min-width: 1024px)' ? opts.wide : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
  const calls = { fetch: [], clients: 0, signOut: 0 };
  window.supabase = {
    createClient: () => {
      calls.clients++;
      return {
        auth: {
          getSession: async () => ({ data: { session: opts.session } }),
          signOut: async () => {
            calls.signOut++;
          },
        },
        rpc: async () => ({ data: null, error: { message: 'x' } }),
      };
    },
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    const headers = init.headers || {};
    const call = {
      url: String(url),
      method: init.method || 'GET',
      auth: headers.Authorization,
      type: headers['Content-Type'] || null,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    };
    calls.fetch.push(call);
    let v;
    if (call.url === AS + '/assistant/guide') v = opts.status;
    else if (call.url === AS + '/assistant/guide/turns') v = opts.turn(call.body);
    else if (call.url === AS + '/assistant/me')
      v = opts.me ? ok(opts.me) : fail(403, 'not_member', 'x');
    else v = fail(404, 'not_found', 'x');
    v = await v;
    if (v instanceof Error) throw v;
    return {
      ok: v.ok,
      status: v.status,
      json: async () => v.body,
      text: async () => v.text || '',
      body: v.stream || null,
    };
  });
  (0, eval)(read('segan/shell.js'));
  (0, eval)(read('segan/guide.js'));
  await window.SeganShell.ready;
  window.SeganGuide.go = jest.fn();
  return calls;
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const scriptsOf = (html) =>
  [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('script[src]')].map(
    (s) => s.getAttribute('src').split('?')[0]
  );
const bubbles = () =>
  $$('.sg-ai-log > li').map((li) => [
    li.classList.contains('sg-ai-msg--ai') ? 'ai' : 'user',
    li.querySelector('.sg-ai-text') ? li.querySelector('.sg-ai-text').textContent : '',
  ]);
const notes = () => $$('.sg-ai-log .sg-ai-note').map((n) => n.textContent);
const guideCalls = (calls, p) => calls.fetch.filter((c) => c.url === AS + p);
const stored = () => JSON.parse(sessionStorage.getItem(STORE) || 'null');

/** 비서를 열고(위 막대 버튼) 그릴 때까지 기다린다 */
async function openGuide() {
  $('.sg-header .sg-ai-btn').click();
  await window.SeganGuide.ready();
  await until(() => $('.sg-ai--chat, .sg-ai--faq'), '비서 칸');
}
async function ask(text) {
  $('.sg-ai-input').value = text;
  $('.sg-ai-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(
    () =>
      !$('.sg-ai-log').getAttribute('aria-busy') ||
      $('.sg-ai-log').getAttribute('aria-busy') === 'false'
  );
  await until(() => !$('.sg-ai-send').disabled || $('.sg-ai-block:not([hidden])'), '보내기 끝');
}

describe('어디에 — 셸 화면마다, 폭에 따라 위 막대 버튼 · PC 입력 줄', () => {
  const SHELL_PAGES = fs
    .readdirSync(path.join(ROOT, 'segan'))
    .filter((n) => n.endsWith('.html') && read(`segan/${n}`).includes('data-segan-shell="header"'));

  test.each(SHELL_PAGES)(
    '%s — shell.js 바로 뒤에 guide.js (결제 돌아옴 · 초대 받기 · 옛 주소는 싣지 않는다), 로그인을 볼 설정 · Supabase',
    (page) => {
      const html = read(`segan/${page}`);
      const src = scriptsOf(html);
      if (NO_GUIDE.includes(page)) {
        expect(src).not.toContain('guide.js');
        return;
      }
      expect(src.indexOf('guide.js')).toBe(src.indexOf('shell.js') + 1);
      expect(html).toMatch(/<script src="guide\.js\?v=\d+" defer><\/script>/);
      expect(src.indexOf('../js/config.js')).toBeGreaterThanOrEqual(0);
      expect(src.indexOf('../js/config.js')).toBeLessThan(src.indexOf('guide.js'));
      const sb = src.findIndex((s) => s.startsWith('https://cdn.jsdelivr.net/npm/@supabase/'));
      expect(sb).toBeGreaterThanOrEqual(0);
      expect(sb).toBeLessThan(src.indexOf('guide.js'));
    }
  );

  test('오프라인 화면에는 없다 · 서비스 워커가 guide.js 를 담는다', () => {
    expect(scriptsOf(read('segan/offline.html'))).not.toContain('guide.js');
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'guide.js')");
  });

  test('위 막대 「비서」 버튼 · 본문 뒤 입력 줄 「SEGAN 비서에게 물어보기」 — 로그인 전에도 그리고, 그리는 것만으로는 묻지 않는다', async () => {
    const calls = await load('collection.html');
    const btn = $('.sg-header .sg-ai-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('비서');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    const bar = $('form.sg-ai-bar');
    expect(bar.previousElementSibling).toBe($('main#main'));
    expect(bar.getAttribute('aria-label')).toBe('SEGAN 비서');
    const input = bar.querySelector('input');
    expect(input.getAttribute('placeholder')).toBe('SEGAN 비서에게 물어보기');
    expect($(`label[for="${input.id}"]`).textContent).toBe('SEGAN 비서에게 물어보기');
    expect(bar.querySelector('button[type="submit"]').textContent).toBe('묻기');
    expect(document.body.classList.contains('sg-ai-on')).toBe(true);
    expect(calls.fetch).toEqual([]);
    expect(calls.clients).toBe(0); // 열 때까지 로그인도 보지 않는다
    expect($$('.sg-ai-btn')).toHaveLength(1);
    (0, eval)(read('segan/guide.js')); // 두 번 실려도 하나씩
    expect($$('.sg-ai-btn')).toHaveLength(1);
    expect($$('.sg-ai-bar')).toHaveLength(1);
  });

  test('스타일 — 폰 · 태블릿은 위 막대 버튼(44px), PC(1024px~)는 아래 가운데 고정 입력 줄 · 옆 패널 420px, 폰 시트 90dvh, 인쇄에서 뺀다', () => {
    const css = read('segan/shell.css').replace(/\r\n/g, '\n');
    const rule = (src, sel) => {
      const m = src.match(
        new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
      );
      expect([sel, !!m]).toEqual([sel, true]);
      return m[1];
    };
    expect(rule(css, '.sg-ai-btn')).toMatch(/min-height:\s*44px/);
    expect(rule(css, '.sg-ai-btn')).toMatch(/margin-left:\s*auto/); // 위 막대 오른쪽
    expect(rule(css, '.sg-ai-bar')).toMatch(/display:\s*none/); // 폰 · 태블릿에는 없다
    const pc = css.split('@media (min-width: 1024px)')[1].split('\n@media')[0];
    expect(rule(pc, '.sg-ai-btn')).toMatch(/display:\s*none/);
    const bar = rule(pc, '.sg-ai-bar');
    for (const want of [/position:\s*fixed/, /left:\s*50%/, /bottom:\s*20px/, /display:\s*flex/])
      expect(bar).toMatch(want);
    expect(bar).not.toMatch(/border-radius|box-shadow/);
    expect(rule(pc, '.sg-sheet-wrap--panel.sg-ai-wrap .sg-sheet')).toMatch(/width:\s*420px/);
    // 아래 버튼 줄(만들기 · 상담 신청) · 업무 비서 입력이 있는 동안 PC 입력 줄을 감춘다
    expect(pc).toMatch(
      /body:has\(\.mk-bar:not\(\[hidden\]\)\) \.sg-ai-bar,\s*body:has\(\.as-form\) \.sg-ai-bar\s*\{\s*display:\s*none;/
    );
    expect(pc).toMatch(/body\.sg-locked \.sg-ai-bar\s*\{\s*display:\s*none;/); // 패널이 열린 동안
    expect(pc).toMatch(/body\.sg-ai-on \.sg-footer-in\s*\{\s*padding-bottom:\s*104px;/);
    const phone = css.split('@media (max-width: 1023.98px)')[1].split('\n@media')[0];
    expect(rule(phone, '.sg-ai-wrap .sg-sheet')).toMatch(/height:\s*90dvh/);
    const print = css.split('@media print')[1];
    expect(print).toMatch(/\.sg-ai-btn,\s*\.sg-ai-bar\s*\{\s*display:\s*none !important;/);
    // 회계 알림 한 줄은 PC 입력 줄 위로 · 만들기 · 상담 신청 · 업무 비서에는 감추는 칸이 있다
    expect(read('segan/ledger.css')).toMatch(/body\.sg-ai-on \.lg-state\s*\{\s*bottom:\s*92px;/);
    expect(read('segan/index.html')).toContain('class="mk-bar"');
    expect(read('segan/consult.html')).toContain('class="mk-bar');
    expect(read('segan/assistant.html')).toContain('class="as-form"');
    // 라운드 · 섀도 없음
    const mine = css.split('/* ── SEGAN 비서 (segan/guide.js) ──')[1].split('/* 시공사례')[0];
    expect(mine).not.toMatch(/border-radius:\s*[1-9]|box-shadow/);
  });

  test('폰 · 태블릿(~1023px) — 「비서」 가 아래 시트를 연다. 주소 · # 는 그대로, 뒤로 가기가 닫는다', async () => {
    await load('collection.html', { path: '/segan/collection.html#x' });
    await openGuide();
    const wrap = $('.sg-sheet-wrap');
    expect(wrap.classList.contains('sg-sheet-wrap--sheet')).toBe(true);
    expect(wrap.classList.contains('sg-ai-wrap')).toBe(true);
    expect($('.sg-sheet-title').textContent).toBe('SEGAN 비서');
    expect(window.location.pathname + window.location.hash).toBe('/segan/collection.html#x');
    expect(window.SeganShell.sheet.isSheetState(window.history.state)).toBe(true);
    window.history.back();
    await until(() => !$('.sg-sheet-wrap'), '닫힌 시트');
    expect(window.location.hash).toBe('#x');
  });

  test('PC(1024px~) — 옆 패널 하나 (다른 패널을 열면 바뀐다), 입력 칸에 초점', async () => {
    const calls = await load('collection.html', { wide: true, session: SESSION });
    $('.sg-ai-bar button[type="submit"]').click();
    await window.SeganGuide.ready();
    await until(() => $('.sg-ai--chat'));
    expect($('.sg-sheet-wrap').classList.contains('sg-sheet-wrap--panel')).toBe(true);
    expect(document.activeElement).toBe($('.sg-ai-input'));
    expect(guideCalls(calls, '/assistant/guide/turns')).toHaveLength(0); // 빈 줄은 묻지 않는다
    window.SeganShell.sheet.open({ title: '다른 것', body: 'x', kind: 'panel' });
    expect($$('.sg-sheet-wrap')).toHaveLength(1);
    expect($('.sg-ai')).toBeNull();
  });
});

describe('로그인 전 — AI 를 부르지 않는다, 자주 묻는 것 + 로그인', () => {
  test('다섯 질문 · 정해 둔 답 · 앱 주소만 링크 · 「로그인하면 무엇이든 물어볼 수 있습니다」 + 로그인(돌아올 곳 = 지금 화면)', async () => {
    const calls = await load('consult.html');
    await openGuide();
    expect($$('.sg-ai-q summary').map((s) => s.textContent)).toEqual([
      '연출컷이 뭔가요',
      '크레딧은 어떻게 쓰나요',
      '상담은 어떻게 신청하나요',
      '구독 등급과 가격',
      '플래너는 어디서 쓰나요',
    ]);
    expect($$('.sg-ai-q').every((d) => d.tagName === 'DETAILS' && !d.open)).toBe(true);
    const answer = (i) => $$('.sg-ai-q .sg-ai-a')[i];
    expect(answer(0).textContent).toContain('AI 연출컷(./)');
    expect(answer(1).textContent).toContain('20 크레딧');
    expect(answer(3).textContent).toContain('Manager — 월 99,000원');
    expect([...answer(2).querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'consult.html',
      'me.html',
    ]);
    for (const a of $$('.sg-ai-q a'))
      expect(window.SeganGuide.LINK_PATHS).toContain(a.getAttribute('href'));
    expect($('.sg-ai-login-note').textContent).toBe('로그인하면 무엇이든 물어볼 수 있습니다');
    const login = $('.sg-ai-login a');
    expect(login.getAttribute('href')).toBe('../login.html?redirect=segan%2Fconsult.html');
    const target = new URLSearchParams(login.getAttribute('href').split('?')[1]).get('redirect');
    expect(AuthRedirect.sanitize(target)).toBe('segan/consult.html');
    expect($('.sg-ai-input')).toBeNull();
    expect(calls.fetch).toEqual([]); // AI 도 질문 수도 묻지 않는다

    login.click(); // 패널을 닫고(기록 칸을 되돌린 뒤) 로그인으로
    await until(() => window.SeganGuide.go.mock.calls.length > 0, '화면 옮김');
    expect(window.SeganGuide.go).toHaveBeenCalledWith(
      '../login.html?redirect=segan%2Fconsult.html'
    );
    expect($('.sg-sheet-wrap')).toBeNull();
  });

  test('주소가 /segan/ 이면 돌아올 곳은 segan/index.html · 설정이 없으면(Supabase 못 받음) 로그인 전과 같다', async () => {
    await load('index.html', { path: '/segan/' });
    expect(window.SeganGuide.loginHref()).toBe('../login.html?redirect=segan%2Findex.html');
    delete window.supabase;
    await openGuide();
    expect($('.sg-ai--faq')).not.toBeNull();
  });

  test('PC 입력 줄에 적고 묻기 — 로그인 전이면 묻지 않고 자주 묻는 것을 연다', async () => {
    const calls = await load('collection.html', { wide: true });
    $('.sg-ai-bar input').value = '크레딧?';
    $('.sg-ai-bar button[type="submit"]').click();
    await window.SeganGuide.ready();
    await until(() => $('.sg-ai--faq'));
    expect($('.sg-sheet-wrap').classList.contains('sg-sheet-wrap--panel')).toBe(true);
    expect(calls.fetch).toEqual([]);
  });
});

describe('로그인 뒤 — 안내 대화', () => {
  test('오늘 남은 질문 수 — GET /assistant/guide (본인 토큰), 「오늘 n번 남음」 · 안내 글', async () => {
    const calls = await load('collection.html', { session: SESSION });
    await openGuide();
    await until(() => !$('.sg-ai-count').hidden);
    expect($('.sg-ai-count').textContent).toBe('오늘 18번 남음');
    expect($('.sg-ai-count').getAttribute('role')).toBe('status');
    const [st] = guideCalls(calls, '/assistant/guide');
    expect([st.method, st.auth]).toEqual(['GET', 'Bearer tok-1']);
    expect($('.sg-ai-hello').hidden).toBe(false);
    expect($('.sg-ai-send').disabled).toBe(false);
    expect($('.sg-ai-block').hidden).toBe(true);
    expect($('label.sg-ai-field .sg-ai-sr').textContent).toBe('물어볼 글');
    expect($('.sg-ai-input').getAttribute('maxlength')).toBe('1000');
    expect($('.sg-ai-log').getAttribute('aria-live')).toBe('polite');
    expect($('.sg-ai-end').getAttribute('role')).toBe('alert');
    expect($('.sg-ai-warn').textContent).toBe('AI가 만든 내용은 틀릴 수 있습니다.');
  });

  test('하루 한도를 다 썼으면 — 다시 물을 수 있는 때(한국 시간)와 함께 보내기를 막는다 · 쉬는 중이면 그 글', async () => {
    await load('collection.html', {
      session: SESSION,
      status: ok({ ...STATUS, used: 20, remaining: 0 }),
    });
    await openGuide();
    await until(() => !$('.sg-ai-block').hidden);
    expect($('.sg-ai-count').textContent).toBe('오늘 0번 남음');
    expect($('.sg-ai-block').textContent).toBe(
      '오늘 질문 20개를 모두 썼습니다. 11월 9일 0시(한국 시간)부터 다시 물을 수 있습니다.'
    );
    expect($('.sg-ai-send').disabled).toBe(true);

    await load('collection.html', {
      session: SESSION,
      status: ok({ ...STATUS, on: false, limit: 0, remaining: 0 }),
    });
    await openGuide();
    await until(() => !$('.sg-ai-block').hidden);
    expect($('.sg-ai-count').textContent).toBe('안내 모드 쉬는 중');
    expect($('.sg-ai-block').textContent).toBe(
      '지금은 안내 모드를 쉬고 있습니다. 잠시 뒤 다시 시도해 주세요.'
    );
    expect($('.sg-ai-send').disabled).toBe(true);

    // 질문 수를 못 읽으면 막지 않는다 (서버가 센다)
    await load('collection.html', { session: SESSION, status: new TypeError('Failed to fetch') });
    await openGuide();
    await tick(20);
    expect($('.sg-ai-count').hidden).toBe(true);
    expect($('.sg-ai-send').disabled).toBe(false);
  });

  test('답이 조각으로 들어온다 — 들어오는 동안 aria-busy · 「답을 만드는 중…」, NDJSON 한 줄이 나뉘어도 잇고, 끝나면 이 탭에 둔다', async () => {
    const live = liveStream();
    let body = null;
    const calls = await load('collection.html', {
      session: SESSION,
      turn: (b) => {
        body = b;
        return live.reply;
      },
    });
    await openGuide();
    $('.sg-ai-input').value = '  크레딧은 어디서 봐요?  ';
    $('.sg-ai-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => $('.sg-ai-msg--wait'), '기다림 말풍선');
    expect(bubbles()).toEqual([
      ['user', '크레딧은 어디서 봐요?'],
      ['ai', '답을 만드는 중…'],
    ]);
    expect($('.sg-ai-log').getAttribute('aria-busy')).toBe('true');
    expect($('.sg-ai-send').disabled).toBe(true);
    expect($('.sg-ai-input').value).toBe('');
    expect(body).toEqual({ text: '크레딧은 어디서 봐요?', history: [] });
    const [post] = guideCalls(calls, '/assistant/guide/turns');
    expect([post.method, post.auth, post.type]).toEqual([
      'POST',
      'Bearer tok-1',
      'application/json',
    ]);
    // 앞서 보낸 질문은 기록에 「보내는 중」 — 다른 화면으로 옮기면 실패로 보인다
    expect(stored().msgs).toEqual([
      { role: 'user', text: '크레딧은 어디서 봐요?', state: 'pending' },
    ]);

    live.push({ type: 'start', used: 3, limit: 20, remaining: 17, reset_at: STATUS.reset_at });
    live.push({ type: 'text', text: '남은 크레딧은 ' });
    await until(() => bubbles()[1][1] === '남은 크레딧은 ');
    expect($('.sg-ai-count').textContent).toBe('오늘 17번 남음');
    live.push({ type: 'text', text: '마이페이지(me.html)에서 봅니다.' });
    live.push({ type: 'done', stop_reason: 'end_turn' });
    live.end();
    await until(() => $('.sg-ai-log').getAttribute('aria-busy') === 'false');
    expect(bubbles()).toEqual([
      ['user', '크레딧은 어디서 봐요?'],
      ['ai', '남은 크레딧은 마이페이지(me.html)에서 봅니다.'],
    ]);
    expect($$('.sg-ai-log a').map((a) => a.getAttribute('href'))).toEqual(['me.html']);
    expect($('.sg-ai-msg--ai .sg-ai-tag').textContent).toBe('AI가 만든 내용');
    expect($('.sg-ai-send').disabled).toBe(false);
    expect(stored()).toEqual({
      uid: 'user-1',
      msgs: [
        { role: 'user', text: '크레딧은 어디서 봐요?', state: 'ok' },
        { role: 'assistant', text: '남은 크레딧은 마이페이지(me.html)에서 봅니다.', state: 'ok' },
      ],
    });
  });

  test('NDJSON — 바이트 조각(Uint8Array, 한글이 둘로 잘려도) · 한 줄이 둘로 나뉘어도 · 마지막 줄바꿈이 없어도 읽는다', async () => {
    const enc = new util.TextEncoder();
    global.TextDecoder = util.TextDecoder;
    const src = [
      { type: 'start', used: 3, limit: 20, remaining: 17 },
      { type: 'text', text: '한글 조각' },
      { type: 'text', text: ' 이어짐' },
      { type: 'done' },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n'); // 마지막 줄바꿈 없음
    const all = enc.encode(src);
    const han = enc.encode(src.slice(0, src.indexOf('한'))).length;
    const cut = [7, han + 1, han + 2, all.length - 3]; // 「한」(3바이트) 가운데 · 줄 가운데에서 자른다
    const parts = [];
    let at = 0;
    for (const c of [...cut, all.length]) {
      parts.push(all.slice(at, c));
      at = c;
    }
    await load('collection.html', { session: SESSION, turn: () => chunked(parts) });
    await openGuide();
    await ask('하나');
    delete global.TextDecoder;
    expect(bubbles()).toEqual([
      ['user', '하나'],
      ['ai', '한글 조각 이어짐'],
    ]);
  });

  test('대화는 이 탭에 남는다 — 다른 화면에서 열어도 이어지고, 다음 질문에 끝까지 받은 지난 차례(마지막 6줄)만 보낸다', async () => {
    const pairs = [];
    for (let i = 1; i <= 4; i++)
      pairs.push(
        { role: 'user', text: '질문' + i, state: 'ok' },
        { role: 'assistant', text: '답' + i, state: 'ok' }
      );
    sessionStorage.setItem(
      STORE,
      JSON.stringify({
        uid: 'user-1',
        msgs: [
          ...pairs,
          { role: 'user', text: '거절된 질문', state: 'fail' },
          { role: 'assistant', text: '', state: 'fail', note: '이 내용에는 답할 수 없습니다.' },
          { role: 'user', text: '옮기기 전 질문', state: 'pending' },
        ],
      })
    );
    let body = null;
    await load('blog.html', {
      session: SESSION,
      keepStorage: true,
      turn: (b) => {
        body = b;
        return lines({ type: 'start', ...STATUS }, { type: 'text', text: '네' }, { type: 'done' });
      },
    });
    await openGuide();
    expect(bubbles()).toHaveLength(11);
    expect(bubbles().at(-1)).toEqual(['user', '옮기기 전 질문']);
    expect(notes()).toEqual([
      '이 내용에는 답할 수 없습니다.',
      '답을 받기 전에 화면을 옮겼습니다. 다시 물어봐 주세요.',
    ]);
    expect($('.sg-ai-hello').hidden).toBe(true);
    const first = $('.sg-ai-log > li');
    expect(first.querySelector('.sg-ai-sr').textContent).toBe('내 질문'); // 읽어 줄 때 누구 말인지
    await ask('다음 질문');
    // 지난 말풍선은 그대로 두고 새 것만 붙인다 (읽어 주는 칸이 지난 대화를 되풀이하지 않게)
    expect($('.sg-ai-log > li')).toBe(first);
    expect(bubbles()).toHaveLength(13);
    expect(body.text).toBe('다음 질문');
    expect(body.history).toEqual([
      { role: 'user', text: '질문2' },
      { role: 'assistant', text: '답2' },
      { role: 'user', text: '질문3' },
      { role: 'assistant', text: '답3' },
      { role: 'user', text: '질문4' },
      { role: 'assistant', text: '답4' },
    ]);
    expect(body.history).toHaveLength(window.SeganGuide.HISTORY_MAX);
    expect(stored().msgs.slice(-2)).toEqual([
      { role: 'user', text: '다음 질문', state: 'ok' },
      { role: 'assistant', text: '네', state: 'ok' },
    ]);

    // 「새 대화」 — 이 탭의 기록을 비운다
    $('.sg-ai-fresh').click();
    expect(bubbles()).toEqual([]);
    expect(stored().msgs).toEqual([]);
    expect($('.sg-ai-fresh').hidden).toBe(true);
  });

  test('다른 사람으로 로그인한 탭 — 앞사람 대화를 보이지 않고 지운다 · 로그아웃은 기록을 지운다 (shell.js)', async () => {
    sessionStorage.setItem(
      STORE,
      JSON.stringify({
        uid: 'someone-else',
        msgs: [{ role: 'user', text: '남의 질문', state: 'ok' }],
      })
    );
    await load('collection.html', { session: SESSION, keepStorage: true });
    await openGuide();
    expect(bubbles()).toEqual([]);
    expect(sessionStorage.getItem(STORE)).toBeNull();

    sessionStorage.setItem(STORE, JSON.stringify({ uid: 'user-1', msgs: [] }));
    const calls = await load('me.html', { session: SESSION, keepStorage: true });
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    $('#sgLogout').click(); // 뒤이은 location.reload() 는 jsdom 에 없다
    await until(() => calls.signOut === 1);
    await tick();
    quiet.mockRestore();
    expect(sessionStorage.getItem(STORE)).toBeNull();
  });

  test('보내기 전 막힘 — 429 guide_limit · 403 guide_off 는 보내기를 막고, 분 한도 · 끊김은 이유 한 줄 — 모두 글을 입력 칸에 되돌린다', async () => {
    const reset = '2026-11-09T15:00:00Z';
    await load('collection.html', {
      session: SESSION,
      turn: () =>
        fail(429, 'guide_limit', '오늘 안내 질문 20개를 모두 썼습니다.', {
          used: 20,
          limit: 20,
          reset_at: reset,
        }),
    });
    await openGuide();
    await until(() => !$('.sg-ai-count').hidden);
    await ask('한도 넘는 질문');
    expect(bubbles()).toEqual([]);
    expect($('.sg-ai-input').value).toBe('한도 넘는 질문');
    expect($('.sg-ai-count').textContent).toBe('오늘 0번 남음');
    expect($('.sg-ai-block').textContent).toBe(
      '오늘 질문 20개를 모두 썼습니다. 11월 10일 0시(한국 시간)부터 다시 물을 수 있습니다.'
    );
    expect($('.sg-ai-send').disabled).toBe(true);
    expect(stored().msgs).toEqual([]);

    await load('collection.html', {
      session: SESSION,
      turn: () =>
        fail(403, 'guide_off', '지금은 안내 모드를 쉬고 있습니다. 잠시 뒤 다시 시도해 주세요.'),
    });
    await openGuide();
    await until(() => !$('.sg-ai-count').hidden);
    await ask('쉬는 중 질문');
    expect($('.sg-ai-input').value).toBe('쉬는 중 질문');
    expect($('.sg-ai-count').textContent).toBe('안내 모드 쉬는 중');
    expect($('.sg-ai-block').textContent).toBe(
      '지금은 안내 모드를 쉬고 있습니다. 잠시 뒤 다시 시도해 주세요.'
    );
    expect($('.sg-ai-send').disabled).toBe(true);

    for (const [reply, msg] of [
      [
        fail(429, 'rate_limited', '요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요'),
        '요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요',
      ],
      [new TypeError('Failed to fetch'), '연결이 끊겨 보내지 못했습니다. 다시 보내 주세요.'],
      [fail(500, '', '서버 오류'), '답을 만들지 못했습니다. 잠시 뒤 다시 물어봐 주세요.'],
      [
        fail(401, 'unauthorized', '로그인이 필요합니다'),
        '로그인이 풀렸습니다. 다시 로그인해 주세요. 로그인',
      ],
    ]) {
      await load('collection.html', { session: SESSION, turn: () => reply });
      await openGuide();
      await ask('질문');
      expect([msg, $('.sg-ai-end').textContent]).toEqual([msg, msg]);
      expect($('.sg-ai-end').hidden).toBe(false);
      expect(bubbles()).toEqual([]);
      expect($('.sg-ai-input').value).toBe('질문');
      expect($('.sg-ai-send').disabled).toBe(false);
    }
    expect($('.sg-ai-end a').getAttribute('href')).toBe(
      '../login.html?redirect=segan%2Fcollection.html'
    );

    // 빈 글은 보내지 않는다
    await load('collection.html', { session: SESSION });
    await openGuide();
    const before = window.fetch.mock.calls.length;
    await ask('   ');
    expect($('.sg-ai-end').textContent).toBe('물어볼 글을 적어 주세요.');
    expect(window.fetch.mock.calls.slice(before).map((c) => c[0])).not.toContain(
      AS + '/assistant/guide/turns'
    );
  });

  test('답 중 오류 — error 는 이유(+ 돌려줬으면 「빼지 않았습니다」 · 남은 수 +1), refused · 끝 없이 끊김도 알리고 다음 기록에서 뺀다', async () => {
    const replies = [
      lines(
        { type: 'start', used: 3, limit: 20, remaining: 17 },
        {
          type: 'error',
          code: 'empty',
          message: '답이 비었습니다. 다시 물어봐 주세요.',
          given_back: true,
        }
      ),
      lines({ type: 'start', used: 3, limit: 20, remaining: 17 }, { type: 'refused' }),
      lines(
        { type: 'start', used: 4, limit: 20, remaining: 16 },
        { type: 'text', text: '반쯤 받은 답' }
      ),
    ];
    const bodies = [];
    await load('collection.html', {
      session: SESSION,
      turn: (b) => {
        bodies.push(b);
        return (
          replies.shift() ||
          lines({ type: 'start', ...STATUS }, { type: 'text', text: '끝' }, { type: 'done' })
        );
      },
    });
    await openGuide();
    await ask('첫째');
    expect(notes()).toEqual([
      '답이 비었습니다. 다시 물어봐 주세요. 오늘 질문 수에서 빼지 않았습니다.',
    ]);
    expect($('.sg-ai-count').textContent).toBe('오늘 18번 남음');
    await ask('둘째');
    expect(notes().at(-1)).toBe('이 내용에는 답할 수 없습니다.');
    await ask('셋째');
    expect(bubbles().at(-1)).toEqual(['ai', '반쯤 받은 답']);
    expect(notes().at(-1)).toBe('답을 끝까지 받지 못했습니다. 다시 물어봐 주세요.');
    await ask('넷째');
    expect(bodies.map((b) => b.history)).toEqual([[], [], [], []]);
    expect(stored().msgs.map((m) => m.state)).toEqual([
      'fail',
      'fail',
      'fail',
      'fail',
      'fail',
      'fail',
      'ok',
      'ok',
    ]);
  });

  test('비서 답은 글 그대로 — HTML 을 읽지 않고, 정해 둔 앱 주소(정확히 그 글자)만 링크로 바꾼다', async () => {
    await load('collection.html');
    const { linkify } = window.SeganGuide;
    const raw =
      '<img src=x onerror="alert(1)"> <script>alert(2)</script> <a href="javascript:alert(3)">x</a>\n' +
      '상담 신청(consult.html)에서, 첫 화면(./) · 구독 plans.html. 마이페이지 me.html\n' +
      '바깥 https://evil.example/plans.html · ../login.html · home.html · ./plans.html · me.htmlx · pay.html';
    const box = linkify(document.createElement('div'), raw);
    expect(box.textContent).toBe(raw); // 글은 한 글자도 바뀌지 않는다
    expect(box.querySelectorAll('img, script, b')).toHaveLength(0);
    expect(
      [...box.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent])
    ).toEqual([
      ['consult.html', 'consult.html'],
      ['./', './'],
      ['plans.html', 'plans.html'],
      ['me.html', 'me.html'],
    ]);
    expect([...box.childNodes].every((n) => n.nodeType === 3 || n.tagName === 'A')).toBe(true);
    for (const p of window.SeganGuide.LINK_PATHS) {
      const one = linkify(document.createElement('p'), `(${p})`);
      expect([p, one.querySelector('a') && one.querySelector('a').getAttribute('href')]).toEqual([
        p,
        p,
      ]);
    }

    // 실제 답에서도 — 굵게 · 링크 표시는 글자로
    await load('collection.html', {
      session: SESSION,
      turn: () =>
        lines(
          { type: 'start', ...STATUS },
          { type: 'text', text: '<b>굵게</b> [구독](https://evil.example) billing.html' },
          { type: 'done' }
        ),
    });
    await openGuide();
    await ask('질문');
    const ai = $('.sg-ai-msg--ai .sg-ai-text');
    expect(ai.querySelector('b')).toBeNull();
    expect(ai.textContent).toBe('<b>굵게</b> [구독](https://evil.example) billing.html');
    expect([...ai.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'billing.html',
    ]);
    // 답 안 링크 — 패널을 닫은 뒤 그 화면으로
    ai.querySelector('a').click();
    await until(() => window.SeganGuide.go.mock.calls.length > 0);
    expect(window.SeganGuide.go).toHaveBeenCalledWith('billing.html');
    expect($('.sg-sheet-wrap')).toBeNull();
  });

  test('Agent(업무 비서 자격 — /assistant/me level full) — 「업무 비서 열기」 → assistant.html, 아니면 없다', async () => {
    const calls = await load('collection.html', { session: SESSION, me: FULL });
    await openGuide();
    await until(() => !$('.sg-ai-biz').hidden);
    expect($('.sg-ai-biz').textContent).toBe('업무 비서 열기');
    expect($('.sg-ai-biz').getAttribute('href')).toBe('assistant.html');
    expect(guideCalls(calls, '/assistant/me').map((c) => c.auth)).toEqual(['Bearer tok-1']);
    $('.sg-ai-biz').click();
    await until(() => window.SeganGuide.go.mock.calls.length > 0);
    expect(window.SeganGuide.go).toHaveBeenCalledWith('assistant.html');

    await load('collection.html', {
      session: SESSION,
      me: { ...FULL, level: 'none', can_chat: false },
    });
    await openGuide();
    await tick(20);
    expect($('.sg-ai-biz').hidden).toBe(true);

    await load('collection.html', { session: SESSION }); // 403 not_member
    await openGuide();
    await tick(20);
    expect($('.sg-ai-biz').hidden).toBe(true);

    await load('assistant.html', { session: SESSION, me: FULL }); // 업무 비서 화면에서는 그 링크가 없다
    await openGuide();
    await tick(20);
    expect($('.sg-ai-biz').hidden).toBe(true);
  });

  test('PC — 입력 줄에 적고 묻기는 옆 패널을 열고 그 글을 바로 묻는다, Enter 로 보내고 한글 조합 중 Enter 는 보내지 않는다', async () => {
    const bodies = [];
    await load('collection.html', {
      session: SESSION,
      wide: true,
      turn: (b) => {
        bodies.push(b);
        return lines({ type: 'start', ...STATUS }, { type: 'text', text: '답' }, { type: 'done' });
      },
    });
    $('.sg-ai-bar input').value = '플래너는 어디서 써요?';
    $('.sg-ai-bar button[type="submit"]').click();
    expect($('.sg-ai-bar input').value).toBe('');
    await window.SeganGuide.ready();
    await until(() => bubbles().length === 2 && bubbles()[1][1] === '답');
    expect($('.sg-sheet-wrap').classList.contains('sg-sheet-wrap--panel')).toBe(true);
    expect(bodies.map((b) => b.text)).toEqual(['플래너는 어디서 써요?']);

    const key = (extra) =>
      $('.sg-ai-input').dispatchEvent(
        new window.KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
          ...extra,
        })
      );
    $('.sg-ai-input').value = '조합 중';
    key({ isComposing: true });
    key({ shiftKey: true });
    await tick(20);
    expect(bodies).toHaveLength(1);
    key({});
    await until(() => bodies.length === 2);
    expect(bodies[1]).toEqual({
      text: '조합 중',
      history: [
        { role: 'user', text: '플래너는 어디서 써요?' },
        { role: 'assistant', text: '답' },
      ],
    });
  });

  test('패널을 닫아도 답은 끝까지 받아 둔다 — 다시 열면 이어서 보인다', async () => {
    const live = liveStream();
    await load('collection.html', { session: SESSION, turn: () => live.reply });
    await openGuide();
    $('.sg-ai-input').value = '닫고 기다리기';
    $('.sg-ai-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => $('.sg-ai-msg--wait'));
    $('.sg-sheet-x').click();
    await until(() => !$('.sg-sheet-wrap'));
    live.push({ type: 'start', ...STATUS });
    live.push({ type: 'text', text: '닫힌 동안 받은 답' });
    live.push({ type: 'done' });
    live.end();
    await until(() => stored().msgs.length === 2 && stored().msgs[1].state === 'ok');
    await tick(30); // 닫는 기록 칸(뒤로 가기)이 돌아온 뒤
    await openGuide();
    expect(bubbles()).toEqual([
      ['user', '닫고 기다리기'],
      ['ai', '닫힌 동안 받은 답'],
    ]);
  });
});
