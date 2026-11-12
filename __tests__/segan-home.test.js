/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, DOMParser */
/**
 * SEGAN 홈 (segan/index.html · segan/home.css) · 옛 만들기 주소 넘기기 (segan/forward.js)
 *
 *   홈       첫 사진 한 장 + 세 걸음 + 시공사례 줄 + 매거진 줄 + 소개 · 구독 줄. 읽기만 하는 화면
 *   넘기기   만들기가 make.html 로 옮겨 갔다 — 옛 주소(?g · ?ref · ?refs · #kind · #refs · #result)는
 *            쿼리 · # 을 그대로 들고 make.html 로. 옛 로그인 돌아옴은 만들던 사진이 있을 때만
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const HTML = read('segan/index.html');
const CSS = read('segan/home.css').replace(/\r\n/g, '\n');
const doc = new DOMParser().parseFromString(HTML, 'text/html');
const $$ = (sel) => [...doc.querySelectorAll(sel)];
const ORIGIN = 'https://dadamfurniture.com';

/** forward.js 를 가짜 주소로 돌린다 → { api, replaced } */
function runForward(at = {}) {
  const replaced = [];
  const win = {};
  const loc = {
    search: at.search || '',
    hash: at.hash || '',
    origin: ORIGIN,
    replace: (url) => replaced.push(url),
  };
  const store = {
    getItem: () => {
      if (at.blocked) throw new Error('blocked');
      return at.draft === undefined ? null : at.draft;
    },
  };
  new Function('window', 'document', 'location', 'sessionStorage', read('segan/forward.js'))(
    win,
    { referrer: at.referrer || '' },
    loc,
    store
  );
  return { api: win.SeganForward, replaced };
}

const DRAFT = JSON.stringify({ v: 1, step: 'kind', photo: { name: 'a.jpg', data: 'x' } });
const NO_PHOTO = JSON.stringify({ v: 1, step: 'photo', photo: null });
const ID = '0b9f6c1e-1111-4222-8333-444455556666';

describe('forward.js — 옛 만들기 주소는 make.html 로', () => {
  test.each([
    [{ search: `?g=${ID}`, hash: '#result' }, `make.html?g=${ID}#result`],
    [{ search: `?g=${ID}` }, `make.html?g=${ID}`],
    [{ search: '?ref=kitchen-n1-1' }, 'make.html?ref=kitchen-n1-1'],
    [{ search: '?refs=a,b&utm=x' }, 'make.html?refs=a,b&utm=x'],
    [{ hash: '#kind' }, 'make.html#kind'],
    [{ hash: '#refs' }, 'make.html#refs'],
    [{ hash: '#result' }, 'make.html#result'],
    // 옛 로그인 돌아옴 — 로그인 화면에서 왔고 만들던 사진이 있다
    [{ referrer: `${ORIGIN}/login.html?redirect=segan%2Findex.html`, draft: DRAFT }, 'make.html'],
    [{ referrer: `${ORIGIN}/login`, draft: DRAFT }, 'make.html'],
  ])('%j → %s', (at, to) => {
    expect(runForward(at).replaced).toEqual([to]);
  });

  test.each([
    [{}],
    [{ search: '?utm_source=x' }],
    [{ hash: '#photo' }],
    [{ hash: '#main' }],
    [{ draft: DRAFT }], // 만들던 사진이 있어도 그냥 홈에 온 것이면 홈
    [{ referrer: `${ORIGIN}/segan/make`, draft: DRAFT }],
    [{ referrer: `${ORIGIN}/login.html`, draft: NO_PHOTO }],
    [{ referrer: `${ORIGIN}/login.html`, draft: '{not json' }],
    [{ referrer: `${ORIGIN}/login.html`, blocked: true }], // 저장소가 막힌 기기
    [{ referrer: `https://evil.example/login.html`, draft: DRAFT }],
    [{ referrer: `${ORIGIN}.evil.example/login.html`, draft: DRAFT }],
  ])('%j → 홈에 머문다', (at) => {
    expect(runForward(at).replaced).toEqual([]);
  });

  test('넘길 주소 셈은 SeganForward.target — 넘기지 않으면 빈 글', () => {
    const { api } = runForward();
    expect(api.MAKE).toBe('make.html');
    expect(api.target({ search: '?g=1', hash: '' })).toBe('make.html?g=1');
    expect(api.target({ search: '', hash: '' })).toBe('');
    expect(api.target()).toBe('');
  });

  test('주소 열쇠 · 단계 이름은 make.js 가 읽는 것과 같다', () => {
    const make = read('segan/make.js');
    expect(make).toContain("var STEPS = ['photo', 'kind', 'refs', 'result'];");
    expect(make).toContain("['ref', 'refs'].forEach(");
    expect(make).toContain("new URLSearchParams(location.search).get('g')");
    expect(make).toContain("var DRAFT_KEY = 'segan.make.draft.v1';");
    const fwd = read('segan/forward.js');
    expect(fwd).toContain("var KEYS = ['g', 'ref', 'refs'];");
    expect(fwd).toContain("var HASHES = ['kind', 'refs', 'result'];");
    expect(fwd).toContain("var DRAFT_KEY = 'segan.make.draft.v1';");
  });
});

describe('홈 화면 (segan/index.html)', () => {
  test('홈 탭 · 넘기기 스크립트는 머리에서 바로(defer 없이) · 화면 스크립트는 없다', () => {
    expect(doc.body.getAttribute('data-tab')).toBe('home');
    expect(HTML).toMatch(/<script src="forward\.js\?v=\d+"><\/script>/);
    // 스타일보다 먼저 — 넘길 주소면 그리기 전에 떠난다
    const fwd = doc.querySelector('script[src^="forward.js"]');
    const shell = doc.querySelector('link[rel="stylesheet"][href^="shell.css"]');
    expect(fwd.hasAttribute('defer') || fwd.hasAttribute('async')).toBe(false);
    expect(fwd.compareDocumentPosition(shell) & 4).toBe(4); // 4 = 뒤따른다 (DOCUMENT_POSITION_FOLLOWING)
    const local = $$('script[src]')
      .map((s) => s.getAttribute('src').replace(/\?v=\d+$/, ''))
      .filter((s) => !/^https:/.test(s));
    expect(local).toEqual(['forward.js', '../js/config.js', 'shell.js', 'guide.js']);
    expect(HTML).toMatch(/<link rel="stylesheet" href="home\.css\?v=\d+" \/>/);
  });

  test('첫 사진 한 장 — 제목 하나 · 「방 사진 올리기」는 만들기로 · 사진 표시를 글로 남긴다', () => {
    expect($$('h1')).toHaveLength(1);
    expect($$('h1')[0].textContent).toBe('공간을 읽고 가구를 짓습니다');
    const cta = $$('.hm-hero a');
    expect(cta.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['방 사진 올리기', 'make.html'],
    ]);
    expect($$('.hm-hero img')).toHaveLength(1);
    expect($$('.hm-hero img')[0].getAttribute('alt')).toBe('');
    expect($$('.hm-credit')[0].textContent).toMatch(/^사진 @/);
  });

  test('세 걸음은 차례가 있는 목록 — 만들기 진행 단계와 같은 순서', () => {
    const steps = $$('ol.hm-steps li').map((li) => [
      li.querySelector('i').textContent,
      li.querySelector('b').textContent,
    ]);
    expect(steps).toEqual([
      ['01', '사진 올리기'],
      ['02', 'AI 연출컷'],
      ['03', '상담 신청'],
    ]);
  });

  test('시공사례 여섯 장 — 자체 시공 사진(collection.js STATIC), 누르면 시공사례 탭', () => {
    const works = $$('.hm-works a.hm-work');
    expect(works).toHaveLength(6);
    expect(works.every((a) => a.getAttribute('href') === 'collection.html')).toBe(true);
    const stat = read('segan/collection.js');
    for (const a of works) {
      const stem = a
        .querySelector('img')
        .getAttribute('src')
        .replace(/^.*\//, '')
        .replace(/\.jpg$/, '');
      const region = a.querySelector('span').textContent.split(' · ')[0];
      expect(stat).toContain(`{ image_url: '../app/portfolio/${stem}.jpg', region: '${region}' }`);
      expect(fs.existsSync(path.join(ROOT, 'app/portfolio/display', `${stem}.avif`))).toBe(true);
    }
  });

  test('매거진 네 글 · 소개 · 구독 줄 — 있는 화면으로 간다 (폰 아래 탭에서 뺀 두 화면은 여기서)', () => {
    const posts = $$('.hm-posts a.hm-post').map((a) => a.getAttribute('href'));
    expect(posts).toEqual([
      'blog-materials.html',
      'blog-edge-finish.html',
      'blog-hardware.html',
      'blog-kitchen-appliances.html',
    ]);
    const blog = read('segan/blog.html');
    for (const a of $$('.hm-posts a.hm-post'))
      expect(blog).toContain(`>${a.querySelector('b').textContent}</b>`);
    expect($$('.sg-rows a.sg-row').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['AI 시스템 소개', 'about.html'],
      ['구독', 'plans.html'],
    ]);
    const heads = $$('.hm-head a').map((a) => a.getAttribute('href'));
    expect(heads).toEqual(['collection.html', 'blog.html']);
    for (const href of [...posts, ...heads, 'make.html', 'about.html', 'plans.html'])
      expect([href, fs.existsSync(path.join(ROOT, 'segan', href))]).toEqual([href, true]);
  });

  test('스타일 — 각진 모서리 · 그림자 없음 · 색은 토큰, 첫 사진은 위 막대 높이만큼 끌어올린다', () => {
    expect(CSS).not.toMatch(/box-shadow|border-radius|backdrop-filter/);
    const colors = CSS.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) || [];
    // 사진 위 어둡게 — 잉크색(45, 42, 38) 그대로, 그 밖의 색은 모두 토큰
    expect(colors.every((c) => /^rgba\(45, 42, 38, [\d.]+\)$/.test(c))).toBe(true);
    expect(CSS).toMatch(
      /\.hm-hero \{[^}]*margin-top: calc\(-1 \* \(var\(--sg-bar\) \+ env\(safe-area-inset-top\)\)\);/
    );
    const wide = CSS.split('@media (min-width: 1024px)')[1];
    expect(wide).toMatch(/\.hm-hero \{[^}]*margin-top: -88px;/); // shell.css 의 PC 위 메뉴 높이
    expect(read('segan/shell.css')).toMatch(/\.sg-header \{\s*min-height: 88px;/);
    // 누름 — 단추는 0.97배, 목록 줄은 바탕만
    expect(CSS).toMatch(
      /\.hm-cta:active \{\s*transform: scale\(0\.97\);\s*transition-duration: 100ms;/
    );
    expect(CSS).toMatch(/\.hm-post:active \{\s*background: var\(--v5-well\);/);
  });

  test('서비스 워커가 홈 · 만들기 화면과 새 파일을 미리 담는다', () => {
    const sw = read('segan/sw.js');
    expect(sw).toContain("SCOPE + 'make.html'");
    expect(sw).toContain("versioned(SCOPE + 'home.css')");
    expect(sw).toContain("versioned(SCOPE + 'forward.js')");
  });
});
