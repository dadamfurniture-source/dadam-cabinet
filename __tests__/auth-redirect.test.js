/**
 * 로그인 리다이렉트 (Site Auth PR0, docs/01-plan/worker-portal-contract.md §5).
 *
 *   - js/auth-redirect.js   ?redirect= 검사기 — 같은 사이트 *.html (+ ?… · #…) 만, 나머지는 index.html
 *                           인앱 브라우저 판별(inAppBrowser) · 외부 브라우저로 여는 주소(externalOpenUrl)
 *                           인증 메일 복귀 주소(emailRedirectTo) — 작업자 포털 1주차 후속 명세 E
 *   - login.html            검사한 값으로 이동 · OAuth redirectTo 가 돌아갈 곳을 유지 · 카카오 버튼 · 인앱 안내
 *                           · 인증 메일 다시 보내기에 emailRedirectTo
 *   - signup.html           OAuth redirectTo 가 돌아갈 곳을 유지 · 로그인 링크가 돌아갈 곳을 들고 감 · 인앱 안내
 *                           · 이메일 가입 signUp 에 emailRedirectTo
 *
 * 페이지 스크립트는 jsdom 에 그대로 올리고 Supabase 는 가짜 클라이언트로 대신한다 (admin-work-reports.test.js 방식).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');

const AR = require('../js/auth-redirect.js');
const AR_SRC = read('js/auth-redirect.js');
// 가입·로그인 화면이 함께 싣는 동의 기록 (js/consent.js) — 시험은 __tests__/consent.test.js
const CONSENT_SRC = read('js/consent.js');

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

// ── 인앱 브라우저 (명세 E) ──────────────────────────────────────────────────
// UA 표본은 각 앱이 웹뷰에 붙이는 꼬리 모양만 흉내 낸 가짜 값이다.

const ANDROID_WV =
  'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36';
const IOS_WV =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

const UA = {
  kakaoAndroid: ANDROID_WV + ';KAKAOTALK 2410200',
  kakaoIos: IOS_WV + ' KAKAOTALK 10.9.0',
  naverAndroid: ANDROID_WV + ' NAVER(inapp; search; 2000; 12.10.1)',
  naverIos: IOS_WV + ' NAVER(inapp; search; 2000; 12.10.1; 15PRO)',
  instagramAndroid:
    ANDROID_WV +
    ' Instagram 350.0.0.42.84 Android (34/14; 480dpi; 1080x2340; samsung; SM-S921N; e1q; qcom; ko_KR; 640000000)',
  instagramIos:
    IOS_WV +
    ' Instagram 350.0.2.20.84 (iPhone15,2; iOS 17_6; ko_KR; ko; scale=3.00; 1179x2556; 640000000)',
  facebookAndroid: ANDROID_WV + ' [FB_IAB/FB4A;FBAV/480.0.0.48.109;]',
  facebookIos:
    IOS_WV +
    ' [FBAN/FBIOS;FBAV/480.0.0.38.107;FBBV/650000000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.6;FBSS/3;FBID/phone;FBLC/ko_KR;FBOP/5]',
  lineAndroid: ANDROID_WV + ' Line/14.16.1/IAB',
  lineIos: IOS_WV + ' Safari Line/14.16.0',
  daumAndroid: ANDROID_WV + ' DaumApps/8.9.2 DaumDevice/mobile',
  daumIos: IOS_WV + ' DaumApps/8.9.2 DaumDevice/mobile',
  bandAndroid: ANDROID_WV + ' BAND/15.1.0',
  bandIos: IOS_WV + ' BAND/15.1.0',
  // 보통 브라우저
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  chromeDesktop:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  safariIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  samsungInternet:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  // 네이버 웨일은 앱 속 웹뷰가 아니라 브라우저다
  whale:
    'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Whale/3.27.0.0 Mobile Safari/537.36',
};

describe('inAppBrowser — UA 로 앱을 알아본다 (이름은 고정 목록에서만)', () => {
  test.each([
    ['kakaoAndroid', 'kakaotalk', '카카오톡'],
    ['kakaoIos', 'kakaotalk', '카카오톡'],
    ['naverAndroid', 'naver', '네이버'],
    ['naverIos', 'naver', '네이버'],
    ['instagramAndroid', 'instagram', '인스타그램'],
    ['instagramIos', 'instagram', '인스타그램'],
    ['facebookAndroid', 'facebook', '페이스북'],
    ['facebookIos', 'facebook', '페이스북'],
    ['lineAndroid', 'line', '라인'],
    ['lineIos', 'line', '라인'],
    ['daumAndroid', 'daum', '다음'],
    ['daumIos', 'daum', '다음'],
    ['bandAndroid', 'band', '밴드'],
    ['bandIos', 'band', '밴드'],
  ])('%s → %s', (key, id, label) => {
    expect(AR.inAppBrowser(UA[key])).toEqual({ id, label });
  });

  test.each([
    ['chromeAndroid'],
    ['chromeDesktop'],
    ['chromeIos'],
    ['safariIos'],
    ['safariMac'],
    ['samsungInternet'],
    ['whale'],
  ])('%s → null (보통 브라우저)', (key) => {
    expect(AR.inAppBrowser(UA[key])).toBeNull();
  });

  test('빈 값 · 문자열 아님 → null', () => {
    expect(AR.inAppBrowser('')).toBeNull();
    expect(AR.inAppBrowser(undefined)).toBeNull();
    expect(AR.inAppBrowser(null)).toBeNull();
    expect(AR.inAppBrowser(123)).toBeNull();
  });

  test('돌려주는 것은 id · label 두 가지뿐 — UA 글자가 섞이지 않는다', () => {
    const app = AR.inAppBrowser(IOS_WV + ' Instagram <img src=x onerror=alert(1)>');
    expect(app).toEqual({ id: 'instagram', label: '인스타그램' });
  });

  test('기존 isKakaoInApp 은 그대로 (다른 화면이 쓸 수 있다)', () => {
    expect(AR.isKakaoInApp(UA.kakaoIos)).toBe(true);
    expect(AR.isKakaoInApp(UA.naverAndroid)).toBe(false);
  });
});

describe('externalOpenUrl — 외부 브라우저로 여는 주소', () => {
  const HREF = 'https://site.test/login.html?redirect=worker.html%23invite%3Dabc';

  test('카카오톡 (안드로이드·iOS) → kakaotalk://web/openExternal?url=…', () => {
    const want = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(HREF);
    expect(AR.externalOpenUrl(HREF, UA.kakaoAndroid)).toBe(want);
    expect(AR.externalOpenUrl(HREF, UA.kakaoIos)).toBe(want);
    expect(AR.externalOpenUrl(HREF, UA.kakaoIos)).toBe(AR.kakaoOpenExternalUrl(HREF));
  });

  test('라인 (안드로이드·iOS) → 주소에 openExternalBrowser=1', () => {
    expect(AR.externalOpenUrl(HREF, UA.lineAndroid)).toBe(HREF + '&openExternalBrowser=1');
    expect(AR.externalOpenUrl(HREF, UA.lineIos)).toBe(HREF + '&openExternalBrowser=1');
    expect(AR.externalOpenUrl('https://site.test/signup.html', UA.lineIos)).toBe(
      'https://site.test/signup.html?openExternalBrowser=1'
    );
  });

  test('라인: 해시는 뒤에 그대로, 이미 붙어 있으면 다시 붙이지 않는다', () => {
    expect(AR.externalOpenUrl('https://site.test/login.html#x', UA.lineIos)).toBe(
      'https://site.test/login.html?openExternalBrowser=1#x'
    );
    const already = 'https://site.test/login.html?openExternalBrowser=1';
    expect(AR.externalOpenUrl(already, UA.lineAndroid)).toBe(already);
  });

  test.each([
    ['naverAndroid'],
    ['instagramAndroid'],
    ['facebookAndroid'],
    ['daumAndroid'],
    ['bandAndroid'],
  ])('안드로이드의 그 밖 앱 (%s) → 크롬 intent://', (key) => {
    expect(AR.externalOpenUrl(HREF, UA[key])).toBe(
      'intent://site.test/login.html?redirect=worker.html%23invite%3Dabc#Intent;scheme=https;package=com.android.chrome;end'
    );
  });

  test('intent:// 는 지금 주소의 해시를 떼어 낸다 (#Intent; 와 겹치지 않게)', () => {
    expect(
      AR.externalOpenUrl(
        'https://site.test/login.html?redirect=mypage.html#error=x',
        UA.naverAndroid
      )
    ).toBe(
      'intent://site.test/login.html?redirect=mypage.html#Intent;scheme=https;package=com.android.chrome;end'
    );
  });

  test.each([['naverIos'], ['instagramIos'], ['facebookIos'], ['daumIos'], ['bandIos']])(
    'iOS 의 그 밖 앱 (%s) → null (메뉴 안내 + 주소 복사)',
    (key) => {
      expect(AR.externalOpenUrl(HREF, UA[key])).toBeNull();
    }
  );

  test.each([['chromeAndroid'], ['safariIos'], ['samsungInternet'], ['chromeDesktop']])(
    '보통 브라우저 (%s) → null',
    (key) => {
      expect(AR.externalOpenUrl(HREF, UA[key])).toBeNull();
    }
  );

  test('http(s) 가 아닌 주소는 만들지 않는다', () => {
    for (const ua of [UA.kakaoAndroid, UA.lineIos, UA.naverAndroid]) {
      expect(AR.externalOpenUrl('javascript:alert(1)', ua)).toBeNull();
      expect(AR.externalOpenUrl('', ua)).toBeNull();
      expect(AR.externalOpenUrl(undefined, ua)).toBeNull();
    }
  });
});

describe('emailRedirectTo — 인증 메일 링크가 돌아올 주소 (oauthRedirectTo 와 같은 규칙)', () => {
  const O = 'https://site.test';
  test('돌아갈 곳이 있으면 login.html?redirect=…, 기본이거나 나쁘면 /index.html', () => {
    expect(AR.emailRedirectTo(O, 'worker.html#invite=abc')).toBe(
      O + '/login.html?redirect=worker.html%23invite%3Dabc'
    );
    expect(AR.emailRedirectTo(O, 'index.html')).toBe(O + '/index.html');
    expect(AR.emailRedirectTo(O, '//evil.example/a.html')).toBe(O + '/index.html');
    for (const t of ['mypage.html', 'worker.html#job=1', null]) {
      expect(AR.emailRedirectTo(O, t)).toBe(AR.oauthRedirectTo(O, t));
    }
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

/**
 * 페이지를 jsdom 에 올린다. 돌려주는 calls 에 signInWithOAuth 인자가 쌓인다.
 * calls.signUp · calls.resend 에는 이메일 가입 · 인증 메일 다시 보내기 인자가 쌓인다.
 * calls.update 에는 from(표).update(값).eq(…).is(…) 가 { table, patch, filters } 로 쌓인다 (동의 옮기기).
 * auth 로 가짜 Supabase auth 함수를 바꿔 끼울 수 있다.
 */
function boot(page, { url, ua = CHROME_UA, session = null, auth = {} } = {}) {
  window.history.replaceState(null, '', url);
  Object.defineProperty(window.navigator, 'userAgent', { get: () => ua, configurable: true });
  document.body.innerHTML = page.body;
  window.localStorage.clear();
  const calls = [];
  calls.signUp = [];
  calls.resend = [];
  calls.update = [];
  window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'k' } };
  window.supabase = {
    createClient: () => ({
      from: (table) => ({
        update: (patch) => {
          const q = { table, patch, filters: [] };
          calls.update.push(q);
          const chain = {
            eq: (c, v) => (q.filters.push(['eq', c, v]), chain),
            is: (c, v) => (q.filters.push(['is', c, v]), chain),
            then: (ok, bad) => Promise.resolve({ error: null }).then(ok, bad),
          };
          return chain;
        },
      }),
      auth: {
        getSession: async () => ({ data: { session } }),
        signInWithOAuth: async (args) => {
          calls.push(args);
          return { data: {}, error: null };
        },
        signInWithPassword: async () => ({ data: {}, error: null }),
        signUp: async (args) => {
          calls.signUp.push(args);
          return { data: { user: { id: 'u-test' } }, error: null };
        },
        resend: async (args) => {
          calls.resend.push(args);
          return { data: {}, error: null };
        },
        ...auth,
      },
    }),
  };
  delete window.DadamAuthRedirect;
  delete window.DadamConsent;
  (0, eval)(AR_SRC);
  (0, eval)(CONSENT_SRC);
  (0, eval)(page.script);
  return calls;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** 클립보드 — jsdom 에는 없다. writeText 가 성공/실패하는 가짜를 끼운다 (null 이면 아예 없음) */
function setClipboard(writeText) {
  if (writeText === null) {
    delete window.navigator.clipboard;
    return;
  }
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  // signup.html 의 showError 가 부른다 — jsdom 에는 없다
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  jest.restoreAllMocks();
  setClipboard(null);
});

const NOTICE = (label) =>
  label + ' 앱 안에서는 구글 로그인이 막힙니다. 카카오로 로그인하거나 외부 브라우저로 열어 주세요.';

/** 안내 상자에서 지금 보이는 것만 */
function noticeState() {
  const $ = (id) => document.getElementById(id);
  return {
    shown: !$('inappNotice').hidden,
    text: $('inappText').textContent,
    openBtn: !$('openExternalBtn').hidden,
    manual: !$('inappManual').hidden,
  };
}

describe.each([
  ['login.html', () => LOGIN],
  ['signup.html', () => SIGNUP],
])('%s 인앱 안내 (명세 E)', (file, page) => {
  const url = '/' + file + '?redirect=mypage.html';

  test('보통 브라우저(크롬·사파리·삼성 인터넷)면 숨긴다', () => {
    for (const ua of [
      UA.chromeAndroid,
      UA.chromeDesktop,
      UA.safariIos,
      UA.samsungInternet,
      UA.whale,
    ]) {
      boot(page(), { url, ua });
      expect(document.getElementById('inappNotice').hidden).toBe(true);
    }
  });

  test.each([
    ['kakaoAndroid', '카카오톡'],
    ['kakaoIos', '카카오톡'],
    ['naverAndroid', '네이버'],
    ['instagramAndroid', '인스타그램'],
    ['facebookAndroid', '페이스북'],
    ['lineIos', '라인'],
    ['daumAndroid', '다음'],
    ['bandAndroid', '밴드'],
  ])('%s → "%s 앱 안에서는…" + [외부 브라우저로 열기]', (key, label) => {
    boot(page(), { url, ua: UA[key] });
    expect(noticeState()).toEqual({
      shown: true,
      text: NOTICE(label),
      openBtn: true,
      manual: false,
    });
    expect(document.getElementById('openExternalBtn').textContent).toContain(
      '외부 브라우저로 열기'
    );
    // 인앱이어도 카카오 로그인은 그대로 쓸 수 있다
    expect(document.querySelector('.btn-kakao').disabled).toBe(false);
  });

  test.each([
    ['naverIos', '네이버'],
    ['instagramIos', '인스타그램'],
    ['facebookIos', '페이스북'],
    ['daumIos', '다음'],
    ['bandIos', '밴드'],
  ])('%s → 메뉴 안내 + [주소 복사] (열기 버튼 없음)', (key, label) => {
    boot(page(), { url, ua: UA[key] });
    expect(noticeState()).toEqual({
      shown: true,
      text: NOTICE(label),
      openBtn: false,
      manual: true,
    });
    const manual = document.getElementById('inappManual');
    expect(manual.textContent).toContain("오른쪽 위 메뉴에서 '다른 브라우저로 열기'");
    expect(document.getElementById('copyUrlBtn').textContent).toContain('주소 복사');
    expect(document.getElementById('inappUrl').hidden).toBe(true);
  });

  test('UA 글자는 화면에 들어가지 않는다 (앱 이름은 고정 목록)', () => {
    boot(page(), { url, ua: IOS_WV + ' Instagram <img src=x onerror=alert(1)> evil-label' });
    const notice = document.getElementById('inappNotice');
    expect(notice.hidden).toBe(false);
    expect(notice.querySelector('img')).toBeNull();
    expect(notice.textContent).not.toContain('evil-label');
    expect(notice.textContent).not.toContain('onerror');
    expect(document.getElementById('inappText').textContent).toBe(NOTICE('인스타그램'));
  });

  test('주소 복사: 클립보드에 지금 주소를 넣고 알려 준다', async () => {
    const writeText = jest.fn(async () => {});
    setClipboard(writeText);
    boot(page(), { url, ua: UA.instagramIos });
    document.getElementById('copyUrlBtn').click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(window.location.href).toContain(file + '?redirect=mypage.html');
    const hint = document.getElementById('copyHint');
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain('주소를 복사했습니다');
    expect(document.getElementById('inappUrl').hidden).toBe(true);
  });

  test.each([
    ['클립보드가 없으면', null],
    ['복사가 거절되면', () => Promise.reject(new Error('NotAllowedError'))],
  ])('주소 복사: %s 주소를 보여 주고 글자를 골라 둔다', async (_name, writeText) => {
    setClipboard(writeText);
    boot(page(), { url, ua: UA.facebookIos });
    document.getElementById('copyUrlBtn').click();
    await flush();
    const input = document.getElementById('inappUrl');
    expect(input.hidden).toBe(false);
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(window.location.href);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    const hint = document.getElementById('copyHint');
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).not.toContain('복사했습니다');
  });
});

describe('auth-redirect.js ?v=', () => {
  test('login.html · signup.html 이 같은 판을 싣는다', () => {
    const v = (html) => html.match(/js\/auth-redirect\.js\?v=(\d+)/)[1];
    expect(v(LOGIN.html)).toBe(v(SIGNUP.html));
  });
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
    expect(notice.textContent).toContain('카카오톡 앱 안에서는 구글 로그인이 막힙니다');
    expect(document.getElementById('openExternalBtn').textContent).toContain(
      '외부 브라우저로 열기'
    );
    // 인앱이어도 카카오 로그인은 그대로 쓸 수 있다
    expect(document.querySelector('.btn-kakao').disabled).toBe(false);

    boot(LOGIN, { url: '/login.html', ua: CHROME_UA });
    expect(document.getElementById('inappNotice').hidden).toBe(true);
  });

  test('인증 메일 다시 보내기에 emailRedirectTo — login.html?redirect=<원래 목적지>', async () => {
    const calls = boot(LOGIN, {
      url: '/login.html?redirect=' + encodeURIComponent('worker.html#invite=abc'),
      auth: {
        signInWithPassword: async () => ({ data: {}, error: { message: 'Email not confirmed' } }),
      },
    });
    document.getElementById('email').value = 'worker@example.test';
    document.getElementById('password').value = 'pw-test-1234';
    document.getElementById('loginForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const rb = document.getElementById('resendBtn');
    expect(rb.hidden).toBe(false);
    rb.click();
    await flush();
    expect(calls.resend).toEqual([
      {
        type: 'signup',
        email: 'worker@example.test',
        options: {
          emailRedirectTo: 'http://localhost/login.html?redirect=worker.html%23invite%3Dabc',
        },
      },
    ]);
  });

  test('인증 메일 다시 보내기: 돌아갈 곳이 없으면 /index.html', async () => {
    const calls = boot(LOGIN, {
      url: '/login.html',
      auth: {
        signInWithPassword: async () => ({ data: {}, error: { message: 'Email not confirmed' } }),
      },
    });
    document.getElementById('email').value = 'worker@example.test';
    document.getElementById('password').value = 'pw-test-1234';
    document.getElementById('loginForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    document.getElementById('resendBtn').click();
    await flush();
    expect(calls.resend[0].options.emailRedirectTo).toBe('http://localhost/index.html');
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

  // 인증 메일 링크가 만료됐거나 이미 쓰였으면 GoTrue verify 가 돌아오는 주소 해시에
  // error=access_denied&error_code=otp_expired&error_description=… 를 붙인다 (리뷰 #970).
  const EMAIL_LINK_MSG =
    "이메일 인증 링크가 만료되었거나 이미 사용되었습니다. 이메일과 비밀번호로 로그인해 주세요. 아직 인증 전이면 '인증 메일 다시 보내기'로 새 링크를 받을 수 있습니다.";

  test.each([
    [
      '해시 (인증 링크 기본 흐름)',
      '/login.html?redirect=worker.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    ],
    [
      '쿼리',
      '/login.html?redirect=worker.html&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    ],
  ])('인증 메일 링크 만료(otp_expired, %s)는 소셜 로그인 실패와 다른 고정 문구', (_name, url) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    boot(LOGIN, { url });
    const err = document.getElementById('errorMsg');
    expect(err.classList.contains('show')).toBe(true);
    expect(err.textContent).toBe(EMAIL_LINK_MSG);
    expect(err.textContent).not.toContain('소셜 로그인');
    // 돌아온 글은 화면에 넣지 않고 콘솔에만
    expect(err.textContent).not.toContain('Email link');
    expect(warn.mock.calls.flat().join(' ')).toContain('Email link is invalid or has expired');
    // 돌아갈 곳은 그대로 — 다시 로그인하면 원래 목적지로 간다
    expect(window.getRedirectUrl()).toBe('worker.html');
  });

  test('otp_expired 문구도 돌아온 글을 화면에 넣지 않는다', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    boot(LOGIN, {
      url: '/login.html#error=access_denied&error_code=otp_expired&error_description=%3Cimg+src%3Dx+onerror%3Dalert(1)%3E+CALL+010-0000-0000',
    });
    const err = document.getElementById('errorMsg');
    expect(err.textContent).toBe(EMAIL_LINK_MSG);
    expect(err.querySelector('img')).toBeNull();
    expect(err.textContent).not.toContain('010');
  });

  test('otp_expired 가 아닌 error_code 는 지금처럼 소셜 로그인 실패 문구', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    boot(LOGIN, {
      url: '/login.html#error=server_error&error_code=bad_oauth_callback&error_description=OAuth+callback+failed',
    });
    const err = document.getElementById('errorMsg');
    expect(err.textContent).toBe(
      '소셜 로그인에 실패했습니다. 다시 시도하거나 다른 방법으로 로그인해주세요.'
    );
  });

  test('오류 없이 열면 오류 문구가 없다', () => {
    boot(LOGIN, { url: '/login.html?redirect=worker.html' });
    expect(document.getElementById('errorMsg').classList.contains('show')).toBe(false);
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

  /** 이메일 가입 폼을 채워 제출한다 (가짜 값) */
  async function submitEmailSignup() {
    document.getElementById('name').value = '테스트';
    document.getElementById('email').value = 'new@example.test';
    document.getElementById('password').value = 'abcd1234';
    document.getElementById('confirmPassword').value = 'abcd1234';
    document.getElementById('agreeTerms').checked = true;
    document.getElementById('agreeAge').checked = true;
    document.getElementById('signupForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
  }

  test('이메일 가입 signUp 에 emailRedirectTo — login.html?redirect=<원래 목적지>', async () => {
    const calls = boot(SIGNUP, {
      url: '/signup.html?redirect=' + encodeURIComponent('worker.html#invite=abc'),
    });
    await submitEmailSignup();
    expect(calls.signUp).toHaveLength(1);
    const args = calls.signUp[0];
    expect(args.email).toBe('new@example.test');
    expect(args.options.emailRedirectTo).toBe(
      'http://localhost/login.html?redirect=worker.html%23invite%3Dabc'
    );
    // 가입 메타데이터는 예전 그대로 실린다
    expect(args.options.data).toMatchObject({ name: '테스트', interest_tier: 'standard' });
    expect(document.getElementById('successMsg').textContent).toContain('이메일 인증 후 로그인');
  });

  test('이메일 가입: 돌아갈 곳이 없거나 나쁘면 /index.html (oauthRedirectTo 와 같은 규칙)', async () => {
    let calls = boot(SIGNUP, { url: '/signup.html' });
    await submitEmailSignup();
    expect(calls.signUp[0].options.emailRedirectTo).toBe('http://localhost/index.html');

    calls = boot(SIGNUP, {
      url: '/signup.html?redirect=' + encodeURIComponent('https://evil.example/a.html'),
    });
    await submitEmailSignup();
    expect(calls.signUp[0].options.emailRedirectTo).toBe('http://localhost/index.html');
  });
});

// ── 동의 (약관·처리방침·만 14세·마케팅) — database/consents.sql · js/consent.js ─────────────

describe('signup.html 동의', () => {
  /** 필수 칸을 채운다. 동의 칸은 각 시험이 정한다 */
  function fill({ terms = true, age = true, marketing = false } = {}) {
    document.getElementById('name').value = '테스트';
    document.getElementById('email').value = 'new@example.test';
    document.getElementById('password').value = 'abcd1234';
    document.getElementById('confirmPassword').value = 'abcd1234';
    document.getElementById('agreeTerms').checked = terms;
    document.getElementById('agreeAge').checked = age;
    document.getElementById('agreeMarketing').checked = marketing;
  }
  const submit = async () => {
    document.getElementById('signupForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
  };

  test('약관·처리방침 동의와 만 14세 이상 확인은 필수 칸, 마케팅은 선택', () => {
    boot(SIGNUP, { url: '/signup.html' });
    expect(document.getElementById('agreeTerms').required).toBe(true);
    expect(document.getElementById('agreeAge').required).toBe(true);
    expect(document.getElementById('agreeAge').closest('label').textContent).toContain(
      '만 14세 이상입니다'
    );
    expect(document.getElementById('agreeMarketing').required).toBe(false);
  });

  test('약관 링크는 terms.html · privacy.html 을 새 탭으로 연다 (적던 양식이 사라지지 않게)', () => {
    boot(SIGNUP, { url: '/signup.html' });
    const links = [...document.querySelectorAll('.terms-group a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['terms.html', 'privacy.html']);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });

  test('만 14세 이상을 확인하지 않으면 가입하지 않는다', async () => {
    const calls = boot(SIGNUP, { url: '/signup.html' });
    fill({ age: false });
    await submit();
    expect(calls.signUp).toHaveLength(0);
    expect(document.getElementById('errorMsg').textContent).toBe(
      '만 14세 이상만 가입할 수 있습니다.'
    );
  });

  test('약관에 동의하지 않으면 가입하지 않는다', async () => {
    const calls = boot(SIGNUP, { url: '/signup.html' });
    fill({ terms: false });
    await submit();
    expect(calls.signUp).toHaveLength(0);
  });

  test('가입 메타데이터에 동의 시각이 실린다 — 마케팅은 고른 때만', async () => {
    let calls = boot(SIGNUP, { url: '/signup.html' });
    fill({ marketing: true });
    await submit();
    let data = calls.signUp[0].options.data;
    expect(Date.parse(data.terms_agreed_at)).not.toBeNaN();
    expect(data.privacy_agreed_at).toBe(data.terms_agreed_at);
    expect(data.age_confirmed_at).toBe(data.terms_agreed_at);
    expect(data.marketing_agreed_at).toBe(data.terms_agreed_at);
    expect(data.marketing_agreed).toBe(true);

    calls = boot(SIGNUP, { url: '/signup.html' });
    fill({ marketing: false });
    await submit();
    data = calls.signUp[0].options.data;
    expect(data.marketing_agreed_at).toBeNull();
    expect(data.marketing_agreed).toBe(false);
    // 등급은 여전히 싣지 않는다 (DB 트리거가 무시하지만 보내지도 않는다)
    expect(data).not.toHaveProperty('tier');
  });
});

describe('login.html — 이메일 가입 동의를 첫 로그인 때 profiles 로 옮긴다', () => {
  const SIGNED = {
    terms_agreed_at: '2026-10-26T01:02:03.000Z',
    privacy_agreed_at: '2026-10-26T01:02:03.000Z',
    age_confirmed_at: '2026-10-26T01:02:03.000Z',
    marketing_agreed_at: null,
    marketing_agreed: false,
  };

  // 옮긴 뒤 location.href 로 넘어간다 — jsdom 은 페이지 이동이 없어 콘솔에 'Not implemented: navigation' 을 찍는다
  // (jsdom 가상 콘솔이라 console.error 를 가려도 나온다). 시험 결과와는 상관없다.

  test('비밀번호 로그인 → 본인 행에, 아직 옮기지 않은 경우(terms_agreed_at IS NULL)만', async () => {
    const user = { id: 'u-1', user_metadata: { name: '테스트', ...SIGNED } };
    const calls = boot(LOGIN, {
      url: '/login.html',
      auth: {
        signInWithPassword: async () => ({ data: { user, session: { user } }, error: null }),
      },
    });
    document.getElementById('email').value = 'a@example.test';
    document.getElementById('password').value = 'pw-test-1234';
    document.getElementById('loginForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls.update).toEqual([
      {
        table: 'profiles',
        patch: {
          terms_agreed_at: SIGNED.terms_agreed_at,
          privacy_agreed_at: SIGNED.privacy_agreed_at,
          age_confirmed_at: SIGNED.age_confirmed_at,
        },
        filters: [
          ['eq', 'id', 'u-1'],
          ['is', 'terms_agreed_at', null],
        ],
      },
    ]);
  });

  test('인증 메일 링크로 돌아와 세션이 있으면 옮긴 뒤 보낸다', async () => {
    const user = { id: 'u-2', user_metadata: SIGNED };
    const calls = boot(LOGIN, { url: '/login.html?redirect=mypage.html', session: { user } });
    await flush();
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].filters[0]).toEqual(['eq', 'id', 'u-2']);
  });

  test('가입 동의가 메타데이터에 없으면(카카오·Google, 예전 가입) 아무것도 쓰지 않는다', async () => {
    const user = {
      id: 'u-3',
      user_metadata: { full_name: '소셜', avatar_url: 'https://img.test/a.png' },
    };
    const calls = boot(LOGIN, { url: '/login.html?redirect=mypage.html', session: { user } });
    await flush();
    expect(calls.update).toHaveLength(0);
  });
});
