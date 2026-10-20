/**
 * 로그인 리다이렉트 (Site Auth PR0, docs/01-plan/worker-portal-contract.md §5).
 *
 *   - js/auth-redirect.js   ?redirect= 검사기 — 같은 사이트 *.html (+ ?… · #…) 만, 나머지는 index.html
 *   - login.html            검사한 값으로 이동 · OAuth redirectTo 가 돌아갈 곳을 유지 · 카카오 버튼 · 카카오톡 인앱 안내
 *   - signup.html           OAuth redirectTo 가 돌아갈 곳을 유지 · 로그인 링크가 돌아갈 곳을 들고 감
 *
 * 페이지 스크립트는 jsdom 에 그대로 올리고 Supabase 는 가짜 클라이언트로 대신한다 (admin-work-reports.test.js 방식).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');

const AR = require('../js/auth-redirect.js');
const AR_SRC = read('js/auth-redirect.js');

describe('sanitize — 허용', () => {
  test.each([
    ['index.html'],
    ['mypage.html'],
    ['worker.html'],
    ['worker.html#invite=abcDEF_123-xyz'],
    ['worker.html#job=11111111-1111-4111-8111-111111111111'],
    ['worker.html?from=kakao#invite=abc'],
    ['ai-design.html'],
    ['my-designs.html?tab=1&page=2'],
    ['admin/users.html'],
    ['/mypage.html'],
    ['worker.html#invite=a%2Bb%3D'],
  ])('%s → 그대로', (raw) => {
    expect(AR.sanitize(raw)).toBe(raw);
  });
});

describe('sanitize — 차단 → index.html', () => {
  test.each([
    [null],
    [undefined],
    [123],
    [{}],
    [''],
    ['   '],
    ['javascript:alert(1)'],
    ['JaVaScRiPt:alert(1)'],
    ['javascript:alert(1)//.html'],
    ['javascript:alert(1);a.html'],
    ['data:text/html,<script>alert(1)</script>.html'],
    ['vbscript:msgbox(1).html'],
    ['//evil.example'],
    ['//evil.example/a.html'],
    ['///evil.example/a.html'],
    ['http://evil.example/a.html'],
    ['https://evil.example/a.html'],
    ['HTTPS://evil.example/a.html'],
    ['https:mypage.html'],
    ['\\\\evil.example\\a.html'],
    ['/\\evil.example/a.html'],
    ['\\/evil.example/a.html'],
    ['%2F%2Fevil.example/a.html'],
    ['/%2Fevil.example/a.html'],
    ['%2f%2fevil.example%2fa.html'],
    ['/\t/evil.example/a.html'],
    ['/\n/evil.example/a.html'],
    [' //evil.example/a.html'],
    ['mypage.html\n'],
    ['mypage.html '],
    ['../mypage.html'],
    ['./mypage.html'],
    ['.html'],
    ['mypage'],
    ['mypage.htm'],
    ['mypage.HTML'],
    ['mypage.html.evil.example'],
    ['evil.example'],
    ['mypage.html#"><script>alert(1)</script>'],
    ['mypage.html?x=<img src=x onerror=alert(1)>'],
    ['ｍypage.html'],
    ['／／evil.example/a.html'],
  ])('%p', (raw) => {
    expect(AR.sanitize(raw)).toBe('index.html');
  });
});

describe('fromSearch — URLSearchParams 로 한 번 디코드한 뒤 검사', () => {
  test('worker.html#invite=… 가 인코딩돼 와도 해시째 돌려준다', () => {
    expect(AR.fromSearch('?redirect=worker.html%23invite%3Dabc')).toBe('worker.html#invite=abc');
  });
  test('redirect 가 없으면 index.html', () => {
    expect(AR.fromSearch('')).toBe('index.html');
    expect(AR.fromSearch('?foo=bar')).toBe('index.html');
    expect(AR.fromSearch(undefined)).toBe('index.html');
  });
  test('인코딩 우회도 막는다', () => {
    expect(AR.fromSearch('?redirect=%2F%2Fevil.example%2Fa.html')).toBe('index.html');
    expect(AR.fromSearch('?redirect=%252F%252Fevil.example%252Fa.html')).toBe('index.html');
    expect(AR.fromSearch('?redirect=javascript%3Aalert(1)')).toBe('index.html');
    expect(AR.fromSearch('?redirect=https%3A%2F%2Fevil.example%2Fa.html')).toBe('index.html');
  });
});

describe('oauthRedirectTo — Supabase 가 돌아올 주소', () => {
  const O = 'https://site.test';
  test('기본(index.html)이면 예전 그대로 /index.html', () => {
    expect(AR.oauthRedirectTo(O, 'index.html')).toBe(O + '/index.html');
    expect(AR.oauthRedirectTo(O, null)).toBe(O + '/index.html');
  });
  test('돌아갈 곳이 있으면 login.html?redirect= 로 — 해시는 %23 으로 들어가 Supabase 의 #access_token 과 엉기지 않는다', () => {
    const url = AR.oauthRedirectTo(O, 'worker.html#invite=abc');
    expect(url).toBe(O + '/login.html?redirect=worker.html%23invite%3Dabc');
    expect(url.split('#')).toHaveLength(1);
    expect(AR.oauthRedirectTo(O, 'mypage.html')).toBe(O + '/login.html?redirect=mypage.html');
  });
  test('나쁜 값은 다시 검사해 /index.html', () => {
    expect(AR.oauthRedirectTo(O, '//evil.example/a.html')).toBe(O + '/index.html');
    expect(AR.oauthRedirectTo(O, 'javascript:alert(1)')).toBe(O + '/index.html');
  });
});

describe('withRedirect — 로그인 ↔ 회원가입 링크', () => {
  test('돌아갈 곳이 있으면 붙이고 없으면 그대로', () => {
    expect(AR.withRedirect('signup.html', 'worker.html#invite=abc')).toBe(
      'signup.html?redirect=worker.html%23invite%3Dabc'
    );
    expect(AR.withRedirect('signup.html', 'index.html')).toBe('signup.html');
    expect(AR.withRedirect('login.html', 'https://evil.example/a.html')).toBe('login.html');
  });
});

describe('카카오톡 인앱 브라우저', () => {
  const ANDROID_KAKAO =
    'Mozilla/5.0 (Linux; Android 14; SM-S921N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36;KAKAOTALK 2410200';
  const IOS_KAKAO =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.0';
  const CHROME =
    'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
  const SAFARI =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';

  test('UA 에 KAKAOTALK 이 있으면 인앱', () => {
    expect(AR.isKakaoInApp(ANDROID_KAKAO)).toBe(true);
    expect(AR.isKakaoInApp(IOS_KAKAO)).toBe(true);
  });
  test('보통 브라우저는 아님', () => {
    expect(AR.isKakaoInApp(CHROME)).toBe(false);
    expect(AR.isKakaoInApp(SAFARI)).toBe(false);
    expect(AR.isKakaoInApp('')).toBe(false);
    expect(AR.isKakaoInApp(undefined)).toBe(false);
  });
  test('외부 브라우저 열기 주소는 지금 주소를 통째로 인코딩한다', () => {
    expect(AR.kakaoOpenExternalUrl('https://site.test/login.html?redirect=worker.html')).toBe(
      'kakaotalk://web/openExternal?url=' +
        encodeURIComponent('https://site.test/login.html?redirect=worker.html')
    );
  });
});

// ── 페이지 ────────────────────────────────────────────────────────────────

function pageParts(file) {
  const html = read(file);
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script>\n'));
  return { html, script, body };
}

const LOGIN = pageParts('login.html');
const SIGNUP = pageParts('signup.html');

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const KAKAO_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-S921N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36;KAKAOTALK 2410200';

/** 페이지를 jsdom 에 올린다. 돌려주는 calls 에 signInWithOAuth 인자가 쌓인다. */
function boot(page, { url, ua = CHROME_UA, session = null } = {}) {
  window.history.replaceState(null, '', url);
  Object.defineProperty(window.navigator, 'userAgent', { get: () => ua, configurable: true });
  document.body.innerHTML = page.body;
  const calls = [];
  window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'k' } };
  window.supabase = {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session } }),
        signInWithOAuth: async (args) => {
          calls.push(args);
          return { data: {}, error: null };
        },
        signInWithPassword: async () => ({ data: {}, error: null }),
      },
    }),
  };
  delete window.DadamAuthRedirect;
  (0, eval)(AR_SRC);
  (0, eval)(page.script);
  return calls;
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('login.html', () => {
  test('검사기를 싣는다 (?v= 포함)', () => {
    expect(LOGIN.html).toMatch(/<script src="js\/auth-redirect\.js\?v=\d+"><\/script>/);
  });

  test('열린 리다이렉트: 나쁜 redirect 는 index.html 로', () => {
    for (const bad of [
      '//evil.example/a.html',
      'https://evil.example/a.html',
      'javascript:alert(1)',
    ]) {
      boot(LOGIN, { url: '/login.html?redirect=' + encodeURIComponent(bad) });
      expect(window.getRedirectUrl()).toBe('index.html');
    }
  });

  test('같은 사이트 *.html 은 해시까지 그대로', () => {
    boot(LOGIN, { url: '/login.html?redirect=' + encodeURIComponent('worker.html#invite=abc') });
    expect(window.getRedirectUrl()).toBe('worker.html#invite=abc');
  });

  test('구글·카카오 OAuth redirectTo 가 돌아갈 곳을 유지한다', async () => {
    const calls = boot(LOGIN, {
      url: '/login.html?redirect=' + encodeURIComponent('worker.html#invite=abc'),
    });
    await window.signInWithGoogle();
    await window.signInWithKakao();
    expect(calls.map((c) => c.provider)).toEqual(['google', 'kakao']);
    for (const c of calls) {
      expect(c.options.redirectTo).toBe(
        'http://localhost/login.html?redirect=worker.html%23invite%3Dabc'
      );
    }
  });

  test('redirect 가 없으면 OAuth 는 예전처럼 /index.html', async () => {
    const calls = boot(LOGIN, { url: '/login.html' });
    await window.signInWithKakao();
    expect(calls[0].options.redirectTo).toBe('http://localhost/index.html');
  });

  test('나쁜 redirect 는 OAuth 에도 실리지 않는다', async () => {
    const calls = boot(LOGIN, {
      url: '/login.html?redirect=' + encodeURIComponent('//evil.example/a.html'),
    });
    await window.signInWithGoogle();
    expect(calls[0].options.redirectTo).toBe('http://localhost/index.html');
  });

  test('카카오 버튼이 있고 구글보다 먼저 나온다', () => {
    boot(LOGIN, { url: '/login.html' });
    const buttons = [...document.querySelectorAll('.social-buttons .btn-social')];
    expect(buttons.map((b) => b.getAttribute('onclick'))).toEqual([
      'signInWithKakao()',
      'signInWithGoogle()',
    ]);
    expect(buttons[0].classList.contains('btn-kakao')).toBe(true);
  });

  test('회원가입 링크가 돌아갈 곳을 들고 간다', () => {
    boot(LOGIN, { url: '/login.html?redirect=' + encodeURIComponent('worker.html#invite=abc') });
    expect(document.getElementById('signupLink').getAttribute('href')).toBe(
      'signup.html?redirect=worker.html%23invite%3Dabc'
    );
    boot(LOGIN, { url: '/login.html' });
    expect(document.getElementById('signupLink').getAttribute('href')).toBe('signup.html');
  });

  test('카카오톡 인앱이면 안내가 보이고, 보통 브라우저면 숨긴다', () => {
    boot(LOGIN, { url: '/login.html?redirect=worker.html', ua: KAKAO_UA });
    const notice = document.getElementById('inappNotice');
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('카카오톡 안에서는 구글 로그인이 막힐 수 있습니다');
    expect(document.getElementById('openExternalBtn').textContent).toContain(
      '외부 브라우저로 열기'
    );
    // 인앱이어도 카카오 로그인은 그대로 쓸 수 있다
    expect(document.querySelector('.btn-kakao').disabled).toBe(false);

    boot(LOGIN, { url: '/login.html', ua: CHROME_UA });
    expect(document.getElementById('inappNotice').hidden).toBe(true);
  });

  test('「인증 메일 다시 보내기」는 hidden 이면 감춰진다 (.resend-link 의 display: block 이 hidden 을 이기지 않게)', () => {
    expect(LOGIN.html).toMatch(/\.resend-link\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
  });

  test('OAuth 실패로 돌아오면 고정 문구만 보인다 (돌아온 글은 화면에 넣지 않는다)', () => {
    boot(LOGIN, {
      url: '/login.html?redirect=worker.html#error=server_error&error_description=CALL+010-0000-0000',
    });
    const err = document.getElementById('errorMsg');
    expect(err.classList.contains('show')).toBe(true);
    expect(err.textContent).toContain('소셜 로그인에 실패했습니다');
    expect(err.textContent).not.toContain('010');
  });
});

describe('signup.html', () => {
  test('검사기를 싣는다 (?v= 포함)', () => {
    expect(SIGNUP.html).toMatch(/<script src="js\/auth-redirect\.js\?v=\d+"><\/script>/);
  });

  test('구글·카카오 OAuth redirectTo 가 돌아갈 곳을 유지한다', async () => {
    const calls = boot(SIGNUP, {
      url: '/signup.html?redirect=' + encodeURIComponent('worker.html#invite=abc'),
    });
    await window.signInWithGoogle();
    await window.signInWithKakao();
    expect(calls.map((c) => c.provider)).toEqual(['google', 'kakao']);
    for (const c of calls) {
      expect(c.options.redirectTo).toBe(
        'http://localhost/login.html?redirect=worker.html%23invite%3Dabc'
      );
    }
  });

  test('redirect 가 없거나 나쁘면 /index.html', async () => {
    let calls = boot(SIGNUP, { url: '/signup.html' });
    await window.signInWithKakao();
    expect(calls[0].options.redirectTo).toBe('http://localhost/index.html');
    calls = boot(SIGNUP, {
      url: '/signup.html?redirect=' + encodeURIComponent('https://evil.example/a.html'),
    });
    await window.signInWithGoogle();
    expect(calls[0].options.redirectTo).toBe('http://localhost/index.html');
  });

  test('로그인 링크가 돌아갈 곳을 들고 간다', () => {
    boot(SIGNUP, { url: '/signup.html?redirect=mypage.html' });
    expect(document.getElementById('loginLink').getAttribute('href')).toBe(
      'login.html?redirect=mypage.html'
    );
  });

  test('카카오톡 인앱이면 안내가 보인다', () => {
    boot(SIGNUP, { url: '/signup.html', ua: KAKAO_UA });
    expect(document.getElementById('inappNotice').hidden).toBe(false);
    boot(SIGNUP, { url: '/signup.html', ua: CHROME_UA });
    expect(document.getElementById('inappNotice').hidden).toBe(true);
  });
});
