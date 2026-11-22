/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, DOMParser */
/**
 * SEGAN 홈 (segan/index.html · segan/home.css) · 옛 만들기 주소 넘기기 (segan/forward.js)
 *
 *   홈       첫 사진 한 장 + 세 걸음 + 연출 사례 줄 + 매거진 책장 + 소개 · 구독 줄. 읽기만 하는 화면
 *            매거진 책장은 매거진 화면(blog.html)과 같은 책 — 모습 magazine.css · 끌기 blog.js (segan-magazine.test.js)
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
  test('홈 탭 · 넘기기 스크립트는 머리에서 바로(defer 없이) · 화면 스크립트는 매거진 책장(blog.js)뿐', () => {
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
    expect(local).toEqual([
      'forward.js',
      '../js/config.js',
      'source.js', // 유입 경로 (2026-11-23)
      'motion.js',
      'shell.js',
      'guide.js',
      'blog.js', // 매거진 책장 — 끌기 · 책 → 글 화면 바꾸기
    ]);
    expect(HTML).toMatch(/<script src="blog\.js\?v=\d+" defer blocking="render"><\/script>/);
    expect(HTML).toMatch(/<link rel="stylesheet" href="home\.css\?v=\d+" \/>/);
    expect(HTML).toMatch(/<link rel="stylesheet" href="magazine\.css\?v=\d+" \/>/);
  });

  test('첫 사진 한 장 — 제목 하나 · 「방 사진 올리기」는 만들기로 · 남의 사진 크레딧 없음', () => {
    expect($$('h1')).toHaveLength(1);
    expect($$('h1')[0].textContent).toBe('공간을 읽고 가구를 짓습니다');
    const cta = $$('.hm-hero a');
    expect(cta.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['방 사진 올리기', 'make.html'],
    ]);
    expect($$('.hm-hero img')).toHaveLength(1);
    expect($$('.hm-hero img')[0].getAttribute('alt')).toBe('');
    // 첫 사진은 AI 연출 (app/portfolio/luxe-manifest.json) — 다른 업체 사진 · 크레딧을 쓰지 않는다
    expect($$('.hm-credit')).toHaveLength(0);
    expect($$('.hm-hero img')[0].getAttribute('src')).toBe(
      '../app/portfolio/display/luxe-hero.jpg'
    );
    expect(HTML).not.toMatch(/@BAUS|@DESIGN SHARE|@에스 디자인/);
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

  test('연출 사례 여섯 장 — AI 연출 사진(collection.js STATIC), 누르면 시공사례 탭 · 사진 위 표시 없이 아래 한 줄', () => {
    expect(doc.getElementById('hmWorksTitle').textContent).toBe('연출 사례');
    expect($$('.hm-note').map((p) => p.textContent)).toEqual(['AI 로 연출한 이미지입니다.']);
    const works = $$('.hm-works a.hm-work');
    expect(works).toHaveLength(6);
    expect(works.every((a) => a.getAttribute('href') === 'collection.html')).toBe(true);
    // collection.js STATIC 한 줄을 한 줄 모양으로 (prettier 가 여러 줄로 나눠도)
    const stat = read('segan/collection.js').replace(/\s+/g, ' ').replace(/, \}/g, ' }');
    for (const a of works) {
      const stem = a
        .querySelector('img')
        .getAttribute('src')
        .replace(/^.*\//, '')
        .replace(/\.jpg$/, '');
      expect(stem).toMatch(/^(luxe|mix)-\d\d$/);
      const [place, ...color] = a.querySelector('span').textContent.split(' · ');
      expect(stat).toContain(
        `{ image_url: '../app/portfolio/${stem}.jpg', place: '${place}', color: '${color.join(' · ')}' }`
      );
      expect(fs.existsSync(path.join(ROOT, 'app/portfolio/display', `${stem}.avif`))).toBe(true);
    }
    // 2026-11-20 대표님 「다양한 색상이 되도록」 — 여섯 장의 첫 색(도어 색)이 모두 다르다
    const first = works.map((a) => a.querySelector('span').textContent.split(' · ')[1]);
    expect(new Set(first).size).toBe(6);
  });

  test('매거진 책장 여섯 권 · 소개 · 구독 줄 — 있는 화면으로 간다 (폰 아래 탭에서 뺀 두 화면은 여기서)', () => {
    const posts = $$('.bk-shelf a.bk-book').map((a) => a.getAttribute('href'));
    expect(posts).toEqual([
      'blog-materials.html',
      'blog-edge-finish.html',
      'blog-hardware.html',
      'blog-kitchen-appliances.html',
      'blog-drawer-rails.html',
      'blog-hinges.html',
    ]);
    // 매거진 화면(blog.html)의 책장과 같은 책 · 같은 차례 · 같은 표지 (책을 더하면 두 곳에 같이)
    const blogDoc = new DOMParser().parseFromString(read('segan/blog.html'), 'text/html');
    const shelfOf = (d) =>
      [...d.querySelectorAll('ul.bk-shelf > li.bk-cell')].map((li) =>
        li.innerHTML.replace(/\s+/g, ' ').trim()
      );
    expect(shelfOf(doc)).toEqual(shelfOf(blogDoc));
    expect($$('.bk-case')).toHaveLength(1);
    expect($$('.bk-case > button.bk-nav').map((b) => b.hidden)).toEqual([true, true]);
    // 옛 글 줄 목록은 남지 않는다
    expect($$('.hm-posts, .hm-post')).toHaveLength(0);
    expect(CSS).not.toMatch(/\.hm-post/);
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
    // 누름 — 단추는 0.97배
    expect(CSS).toMatch(
      /\.hm-cta:active \{\s*transform: scale\(0\.97\);\s*transition-duration: 100ms;/
    );
    // 책장의 나무 · 조명 색은 home.css 로 넘어오지 않는다 (magazine.css 에만)
    expect(CSS).not.toMatch(/--bk-/);
  });

  test('서비스 워커가 홈 · 만들기 화면과 새 파일을 미리 담는다', () => {
    const sw = read('segan/sw.js');
    expect(sw).toContain("SCOPE + 'make.html'");
    expect(sw).toContain("versioned(SCOPE + 'home.css')");
    expect(sw).toContain("versioned(SCOPE + 'forward.js')");
  });
});

describe('같은 주방, 다른 색 — 견본 (2026-11-23 「사이트 새는 곳 막기」 묶음 6)', () => {
  const TONES = [
    '매트 라이트그레이 · 카카오월넛',
    '매트 미스트그린 · 매트 아이보리',
    '매트 블랙 · 세이오크',
    '아크 마멀레이드 · 매트 아이보리',
    '매트 화이트 · 매트 샌드그레이',
  ];

  test('세 걸음과 연출 사례 사이 — 같은 방 다섯 장 · 고르는 줄 다섯 · 첫 장이 골라져 있다 · 만들기로', () => {
    const sec = doc.getElementById('hmToneTitle').closest('section');
    expect(doc.getElementById('hmToneTitle').textContent).toBe('같은 주방, 다른 색');
    expect(sec.previousElementSibling.querySelector('ol.hm-steps')).not.toBeNull();
    expect(sec.nextElementSibling.querySelector('#hmWorksTitle')).not.toBeNull();
    const radios = [...sec.querySelectorAll('input[type="radio"][name="hmTone"]')];
    expect(radios.map((r) => r.id)).toEqual([
      'hmTone1',
      'hmTone2',
      'hmTone3',
      'hmTone4',
      'hmTone5',
    ]);
    expect(radios.map((r) => r.checked)).toEqual([true, false, false, false, false]);
    // 라디오 → 사진 · 고르는 줄은 형제 (~) 여야 한다
    for (const r of radios) expect(r.parentElement).toBe(sec.querySelector('.hm-tone'));
    expect(sec.querySelector('.hm-tone-shot').parentElement).toBe(sec.querySelector('.hm-tone'));
    expect(sec.querySelector('.hm-tone-picks').parentElement).toBe(sec.querySelector('.hm-tone'));
    const imgs = [...sec.querySelectorAll('.hm-tone-shot img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(
      TONES.map((_, n) => `../app/portfolio/display/tone-0${n + 1}.jpg`)
    );
    expect(imgs.map((i) => i.getAttribute('alt'))).toEqual(TONES);
    for (const n of [1, 2, 3, 4, 5])
      for (const ext of ['jpg', 'avif'])
        expect(fs.existsSync(path.join(ROOT, `app/portfolio/display/tone-0${n}.${ext}`))).toBe(
          true
        );
    expect(
      [...sec.querySelectorAll('.hm-tone-picks label')].map((l) => [
        l.getAttribute('for'),
        l.textContent.replace(/^\d/, ''),
      ])
    ).toEqual(TONES.map((t, n) => [`hmTone${n + 1}`, t]));
    expect(sec.querySelector('.hm-tone-note').textContent).toMatch(/^AI 로 연출한 이미지입니다\./);
    expect(sec.querySelector('a.hm-tone-cta').getAttribute('href')).toBe('make.html');
    expect(sec.querySelectorAll('script')).toHaveLength(0);
  });

  test('스타일 — 고른 사진만 보인다(opacity 만), 고른 줄 · 초점 표시, 동작 줄이기는 0.2초', () => {
    const shown = CSS.match(/(#hmTone1:checked[^{]*)\{\s*opacity: 1;\s*\}/);
    expect(shown).not.toBeNull();
    for (const n of [1, 2, 3, 4, 5])
      expect(shown[1]).toContain(`#hmTone${n}:checked ~ .hm-tone-shot .hm-tone-p${n} img`);
    expect(CSS).toMatch(
      /\.hm-tone-shot img \{[^}]*opacity: 0;[^}]*transition: opacity 0\.35s ease;/
    );
    for (const n of [1, 2, 3, 4, 5]) {
      expect(CSS).toContain(`#hmTone${n}:checked ~ .hm-tone-picks label[for='hmTone${n}']`);
      expect(CSS).toContain(`#hmTone${n}:focus-visible ~ .hm-tone-picks label[for='hmTone${n}']`);
    }
    expect(CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.hm-tone-shot img \{\s*transition-duration: 0\.2s;/
    );
  });
});
