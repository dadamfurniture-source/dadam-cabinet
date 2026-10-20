/**
 * 로그인 뒤 돌아갈 주소 — login.html · signup.html 이 같이 쓴다 (docs/01-plan/worker-portal-contract.md §5).
 *
 * `login.html?redirect=…` 의 값은 누구나 링크로 만들 수 있다. 그대로 `location.href` 에 넣으면
 * `javascript:` 실행이나 `//남의사이트` 로 보내는 피싱 링크가 된다(열린 리다이렉트).
 * 그래서 같은 사이트의 `*.html` 상대 경로(+ `?…` · `#…`)만 받고, 나머지는 모두 index.html 로 보낸다.
 *
 * 순수 함수만 둔다 (브라우저 전역 `DadamAuthRedirect`, Node(Jest) 는 module.exports).
 *
 *   DadamAuthRedirect.sanitize('worker.html#invite=x')  → 'worker.html#invite=x'
 *   DadamAuthRedirect.sanitize('//evil.example/a.html') → 'index.html'
 *   DadamAuthRedirect.fromSearch(location.search)       → ?redirect= 값을 걸러서
 *   DadamAuthRedirect.oauthRedirectTo(location.origin, target)
 *   DadamAuthRedirect.emailRedirectTo(location.origin, target)  → 인증 메일 링크가 돌아올 주소 (같은 규칙)
 *   DadamAuthRedirect.isKakaoInApp(navigator.userAgent)
 *   DadamAuthRedirect.kakaoOpenExternalUrl(location.href)
 *   DadamAuthRedirect.inAppBrowser(navigator.userAgent)          → { id, label } | null
 *   DadamAuthRedirect.externalOpenUrl(location.href, navigator.userAgent) → 문자열 | null
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamAuthRedirect = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_TARGET = 'index.html';

  /*
   * 경로: 선택적인 맨 앞 '/' 하나 + 폴더 이름들 + 파일이름.html
   *   - 각 이름은 영문·숫자·'_'·'-' 로 시작한다 → '//', '.', '..' 로 시작할 수 없다
   *   - ':' · '\' · '%' · 공백 · 제어문자는 경로에 들어갈 수 없다
   *     (javascript:, https://, 역슬래시 우회, %2F%2F 같은 인코딩 우회, 탭·줄바꿈 제거 우회를 한꺼번에 막는다)
   * 뒤쪽 ?query · #hash: URL 에 쓰는 보통 글자만 (공백·따옴표·꺾쇠·역슬래시 없음).
   *   경로가 이미 같은 사이트로 고정됐으므로 여기 들어간 글자는 사이트를 바꾸지 못한다.
   */
  const SAFE_TARGET =
    /^\/?(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.html(?:[?#][A-Za-z0-9\-._~!$&'()*+,;=:@/?%#]*)?$/;

  /** 돌아갈 주소 검사 — 통과 못 하면 index.html */
  function sanitize(raw) {
    if (typeof raw !== 'string' || !SAFE_TARGET.test(raw)) return DEFAULT_TARGET;
    return raw;
  }

  /** location.search 에서 ?redirect= 를 꺼내 검사한다 (URLSearchParams 가 한 번 디코드한다) */
  function fromSearch(search) {
    let raw = null;
    try {
      raw = new URLSearchParams(search || '').get('redirect');
    } catch (e) {
      raw = null;
    }
    return sanitize(raw);
  }

  /**
   * OAuth(구글·카카오) 뒤 돌아올 주소.
   * 돌아갈 곳이 기본(index.html)이면 예전 그대로 /index.html.
   * 아니면 login.html?redirect=… 로 돌아와 login.html 이 세션을 확인한 뒤 원래 페이지로 보낸다.
   *   - 목적지로 바로 보내지 않는 이유: Supabase 는 돌아오는 주소 뒤에 '#access_token=…' 을 붙인다.
   *     목적지에 이미 '#invite=…' 같은 해시가 있으면 둘이 엉겨 토큰을 못 읽는다.
   *     login.html?redirect= 안에서는 '#' 이 %23 으로 인코딩돼 해시가 하나만 남는다.
   *   - 목적지 페이지마다 Supabase 클라이언트가 있어야 하는 부담도 없앤다.
   */
  function oauthRedirectTo(origin, target) {
    const t = sanitize(target);
    if (t === DEFAULT_TARGET) return origin + '/' + DEFAULT_TARGET;
    return origin + '/login.html?redirect=' + encodeURIComponent(t);
  }

  /** login.html ↔ signup.html 를 오갈 때도 돌아갈 곳을 들고 간다 */
  function withRedirect(page, target) {
    const t = sanitize(target);
    if (t === DEFAULT_TARGET) return page;
    return page + '?redirect=' + encodeURIComponent(t);
  }

  /** 카카오톡 인앱 브라우저 — 구글이 이 안에서는 로그인을 막는다 (disallowed_useragent) */
  function isKakaoInApp(userAgent) {
    return /KAKAOTALK/i.test(String(userAgent || ''));
  }

  /** 카카오톡 인앱에서 지금 주소를 기본 브라우저(크롬·사파리)로 여는 주소 */
  function kakaoOpenExternalUrl(href) {
    return 'kakaotalk://web/openExternal?url=' + encodeURIComponent(String(href || ''));
  }

  /**
   * 이메일 가입 인증 메일(그리고 다시 보내기)의 링크가 돌아올 주소 — oauthRedirectTo 와 같은 규칙.
   * Supabase 는 인증 링크를 눌렀을 때도 돌아오는 주소 뒤에 '#access_token=…' 을 붙이므로
   * 같은 이유로 login.html?redirect=… 를 거친다 (돌아갈 곳이 기본이면 /index.html).
   */
  function emailRedirectTo(origin, target) {
    return oauthRedirectTo(origin, target);
  }

  /*
   * 인앱 브라우저 — 앱 속 웹뷰에서는 구글이 로그인을 막는다 (disallowed_useragent).
   * 위에서부터 먼저 맞는 것. 화면에 쓰는 이름(label)은 이 표에서만 나온다 — UA 글자는 누구나 꾸밀 수 있으므로
   * 화면에 넣지 않는다.
   */
  const IN_APP_BROWSERS = [
    { id: 'kakaotalk', label: '카카오톡', re: /KAKAOTALK/i },
    { id: 'naver', label: '네이버', re: /NAVER\(inapp/i },
    { id: 'instagram', label: '인스타그램', re: /\bInstagram\b/i },
    { id: 'facebook', label: '페이스북', re: /\bFB(?:AN|AV|_IAB)\// },
    { id: 'line', label: '라인', re: /\bLine\//i },
    { id: 'daum', label: '다음', re: /\bDaumApps\b/i },
    { id: 'band', label: '밴드', re: /\bBAND\//i },
  ];

  /** UA 로 인앱 브라우저를 알아본다 → { id, label } | null */
  function inAppBrowser(userAgent) {
    if (typeof userAgent !== 'string' || !userAgent) return null;
    for (const app of IN_APP_BROWSERS) {
      if (app.re.test(userAgent)) return { id: app.id, label: app.label };
    }
    return null;
  }

  /** 주소의 ?query 끝에 한 쌍을 붙인다 (해시는 뒤에 그대로, 이미 있으면 그대로) */
  function addQueryParam(href, pair) {
    const i = href.indexOf('#');
    const base = i < 0 ? href : href.slice(0, i);
    const hash = i < 0 ? '' : href.slice(i);
    const q = base.indexOf('?');
    const pairs = q < 0 ? [] : base.slice(q + 1).split('&');
    if (pairs.indexOf(pair) >= 0) return href;
    const sep = q < 0 ? '?' : /[?&]$/.test(base) ? '' : '&';
    return base + sep + pair + hash;
  }

  /**
   * 인앱 브라우저에서 지금 주소를 외부 브라우저로 여는 주소. 열 길이 없으면 null.
   *   - 카카오톡: kakaotalk://web/openExternal?url=…  (안드로이드·iOS)
   *   - 라인: 주소에 openExternalBrowser=1             (안드로이드·iOS)
   *   - 안드로이드의 그 밖 앱: intent://…#Intent;scheme=https;package=com.android.chrome;end (크롬으로)
   *     지금 주소의 해시는 떼어 낸다 — intent 의 '#Intent;' 와 겹치지 않게.
   *     돌아갈 곳은 ?redirect= 안에 %23 으로 들어 있어 잃지 않는다.
   *   - iOS 의 그 밖 앱 · 보통 브라우저: null → 화면이 "오른쪽 위 메뉴에서 '다른 브라우저로 열기'" + 주소 복사
   */
  function externalOpenUrl(href, userAgent) {
    const app = inAppBrowser(userAgent);
    if (!app) return null;
    const url = typeof href === 'string' ? href : '';
    const m = /^(https?):\/\/([^#]+)/i.exec(url);
    if (!m) return null;
    if (app.id === 'kakaotalk') return kakaoOpenExternalUrl(url);
    if (app.id === 'line') return addQueryParam(url, 'openExternalBrowser=1');
    if (/Android/i.test(userAgent)) {
      const scheme = m[1].toLowerCase();
      return `intent://${m[2]}#Intent;scheme=${scheme};package=com.android.chrome;end`;
    }
    return null;
  }

  return Object.freeze({
    DEFAULT_TARGET,
    sanitize,
    fromSearch,
    oauthRedirectTo,
    emailRedirectTo,
    withRedirect,
    isKakaoInApp,
    kakaoOpenExternalUrl,
    inAppBrowser,
    externalOpenUrl,
  });
});
