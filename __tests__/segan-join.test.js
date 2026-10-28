/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout */
/**
 * SEGAN 업체 직원 초대 받기 (segan/join.html#t=<토큰> + segan/join.js)
 *
 *   - 토큰은 이 탭(sessionStorage)에만 두고, 로그인이 없으면 login.html?redirect=segan/join.html#t=… 로 다녀온다
 *     (js/auth-redirect.js 가 받는 같은 사이트 주소 — 작업자 포털 초대와 같은 방법)
 *   - 로그인했으면 주소창에서 토큰을 지우고 POST /partner/invites/peek → 업체 이름 · 역할 · 기한
 *   - 「수락」 → POST /partner/invites/accept → 내 정보 업체 칸(me.html#partner)
 *   - 410 · 409(code 별) 는 한국어 안내
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const AuthRedirect = require('../js/auth-redirect.js');

const SESSION = { access_token: 'tok-9', user: { id: 'user-9', email: 'staff@example.com' } };
const ACC = 'https://acc.example.workers.dev';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
const KEY = 'segan.join.token';

const ok = (data) => ({ ok: true, status: 200, body: { success: true, data } });
const fail = (status, code, error) => ({
  ok: false,
  status,
  body: { success: false, code, error },
});
const PEEK = ok({
  company_name: '다담 협력 주방',
  role: 'manager',
  expires_at: '2026-11-04T15:30:00Z',
});

async function load(options = {}) {
  const opts = {
    session: SESSION,
    hash: '#t=' + TOKEN,
    stored: null,
    accountUrl: ACC,
    peek: PEEK,
    accept: ok({ company: { id: 'c1', name: '다담 협력 주방', plan: 'agent' }, role: 'manager' }),
    ...options,
  };
  window.history.replaceState(null, '', '/segan/join.html' + (opts.hash || ''));
  const doc = new DOMParser().parseFromString(read('segan/join.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  if (opts.stored) sessionStorage.setItem(KEY, opts.stored);
  delete window.SeganShell;
  delete window.SeganJoin;
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    accountApi: { url: opts.accountUrl },
  };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
    }),
  };
  const calls = [];
  window.fetch = jest.fn(async (url, init = {}) => {
    calls.push({
      url,
      method: init.method || 'GET',
      auth: (init.headers || {}).Authorization,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const r = url === ACC + '/partner/invites/peek' ? opts.peek : opts.accept;
    if (r instanceof Error) throw r;
    return { ok: r.ok, status: r.status, json: async () => r.body };
  });
  for (const f of ['segan/shell.js', 'segan/join.js']) (0, eval)(read(f));
  window.SeganJoin.go = jest.fn();
  await window.SeganShell.ready;
  await window.SeganJoin.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const view = () =>
  [...document.querySelectorAll('[data-jn-view]')]
    .filter((el) => !el.hidden)
    .map((el) => el.getAttribute('data-jn-view'));
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

afterEach(() => jest.restoreAllMocks());

describe('페이지', () => {
  test('내 정보 탭 · 공용 셸 · 앱 셸 파일(shell.css · make.css · join.js)', () => {
    const html = read('segan/join.html');
    expect(html).toMatch(/<body class="sg-app" data-tab="me">/);
    for (const slot of ['header', 'footer', 'tabbar'])
      expect(html).toContain(`data-segan-shell="${slot}"`);
    expect(html).toMatch(/<script src="join\.js\?v=\d+" defer><\/script>/);
    const sw = read('segan/sw.js');
    expect(sw).toContain("SCOPE + 'join.html'");
    expect(sw).toContain("versioned(SCOPE + 'join.js')");
  });
});

describe('토큰 · 로그인', () => {
  test.each([
    ['토큰 없음', ''],
    ['형식이 틀림', '#t=abc'],
    ['다른 이름', '#x=' + TOKEN],
  ])('%s — 올바르지 않은 링크 안내, 아무것도 묻지 않는다', async (_name, hash) => {
    const calls = await load({ hash });
    expect(view()).toEqual(['stop']);
    expect($('jnStopTitle').textContent).toBe('초대 링크가 올바르지 않습니다');
    expect(calls).toEqual([]);
  });

  test('로그인 없음 — 토큰을 이 탭에 두고, 로그인 뒤 이 링크로 돌아온다', async () => {
    const calls = await load({ session: null });
    expect(view()).toEqual(['signed-out']);
    expect(sessionStorage.getItem(KEY)).toBe(TOKEN);
    const href = $('jnLogin').getAttribute('href');
    expect(href).toBe('../login.html?redirect=' + encodeURIComponent('segan/join.html#t=' + TOKEN));
    const url = new URL(href, 'https://dadamfurniture.com/segan/join.html');
    expect(url.pathname).toBe('/login.html');
    expect(AuthRedirect.fromSearch(url.search)).toBe('segan/join.html#t=' + TOKEN);
    expect(calls).toEqual([]);
  });

  test('로그인했으면 주소창에서 토큰을 지우고 peek — 업체 이름 · 역할 · 기한(한국 날짜)', async () => {
    const calls = await load();
    expect(window.location.hash).toBe('');
    expect(calls).toEqual([
      {
        url: ACC + '/partner/invites/peek',
        method: 'POST',
        auth: 'Bearer tok-9',
        body: { token: TOKEN },
      },
    ]);
    expect(view()).toEqual(['invite']);
    expect($('jnTitle').textContent).toBe('다담 협력 주방에서 함께하자고 초대했습니다');
    expect($('jnCompany').textContent).toBe('다담 협력 주방');
    expect($('jnRole').textContent).toBe('실장');
    expect($('jnExpires').textContent).toBe('2026.11.05까지');
  });

  test('로그인을 다녀온 뒤(주소에 토큰이 없어도) 이 탭에 둔 토큰을 쓴다', async () => {
    const calls = await load({ hash: '', stored: TOKEN });
    expect(calls[0].body).toEqual({ token: TOKEN });
    expect(view()).toEqual(['invite']);
  });

  test('업체 이름은 글자로만 넣는다', async () => {
    const bad = '<img src=x onerror=alert(1)>';
    await load({ peek: ok({ company_name: bad, role: 'staff', expires_at: null }) });
    expect(document.querySelector('main img')).toBeNull();
    expect($('jnCompany').textContent).toBe(bad);
    expect($('jnRole').textContent).toBe('직원');
  });
});

describe('peek 실패', () => {
  test('410 — 쓸 수 없는 링크, 토큰을 지운다', async () => {
    await load({ peek: fail(410, 'invite_invalid', '만료된 초대입니다.') });
    expect(view()).toEqual(['stop']);
    expect($('jnStopTitle').textContent).toBe('쓸 수 없는 초대 링크입니다');
    expect($('jnStopText').textContent).toBe(
      '기한이 지났거나, 취소됐거나, 이미 쓴 링크입니다. 대표에게 새 링크를 받아 주세요.'
    );
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  test.each([
    ['404 (아직 배포 전)', fail(404, 'not_found', 'Not found')],
    ['500', fail(500, 'error', '서버 오류입니다.')],
    ['네트워크 실패', new TypeError('Failed to fetch')],
  ])('%s — 지금은 확인할 수 없다는 안내', async (_name, peek) => {
    await load({ peek });
    expect(view()).toEqual(['stop']);
    expect($('jnStopTitle').textContent).toBe('지금은 초대를 확인할 수 없습니다');
  });

  test('account-api 주소가 없으면 묻지 않는다', async () => {
    const calls = await load({ accountUrl: '' });
    expect(calls).toEqual([]);
    expect($('jnStopTitle').textContent).toBe('지금은 초대를 확인할 수 없습니다');
  });
});

describe('수락', () => {
  test('수락 → POST /partner/invites/accept { token } → 내 정보 업체 칸으로, 토큰을 지운다', async () => {
    const calls = await load();
    $('jnAccept').click();
    await flush();
    expect(calls[1]).toEqual({
      url: ACC + '/partner/invites/accept',
      method: 'POST',
      auth: 'Bearer tok-9',
      body: { token: TOKEN },
    });
    expect(window.SeganJoin.go).toHaveBeenCalledWith('me.html#partner');
    expect(fs.existsSync(path.join(ROOT, 'segan/me.html'))).toBe(true);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  test.each([
    [fail(410, 'invite_invalid', 'x'), '쓸 수 없는 초대 링크입니다'],
    [fail(409, 'company_inactive', 'x'), '지금은 이 업체에 들어갈 수 없습니다'],
    [fail(409, 'already_member', 'x'), '이미 업체에 속해 있습니다'],
    [fail(409, 'application_open', 'x'), '진행 중인 업체 신청이 있습니다'],
  ])('%j → %s', async (accept, title) => {
    await load({ accept });
    $('jnAccept').click();
    await flush();
    expect(view()).toEqual(['stop']);
    expect($('jnStopTitle').textContent).toBe(title);
    expect(window.SeganJoin.go).not.toHaveBeenCalled();
  });

  test('그 밖의 실패 — 서버 안내를 그 자리에, 다시 누를 수 있다', async () => {
    await load({ accept: fail(500, 'error', '잠시 후 다시 시도해 주세요.') });
    $('jnAccept').click();
    await flush();
    expect(view()).toEqual(['invite']);
    expect($('jnError').hidden).toBe(false);
    expect($('jnError').textContent).toBe('잠시 후 다시 시도해 주세요.');
    expect($('jnAccept').disabled).toBe(false);
  });

  test('두 번 눌러도 한 번만 보낸다', async () => {
    const calls = await load();
    $('jnAccept').click();
    $('jnAccept').click();
    await flush();
    expect(calls.filter((c) => c.url.endsWith('/accept'))).toHaveLength(1);
  });
});
