/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * ai-design.html 첫 화면 (2026-10-27) — 휴대폰 첫 화면을 빠르게 그리는 장치들을 고정한다.
 *
 *   1) 마퀴 타일은 문서에 바로 적는다 (.mq-1~6 두 벌). 첫 타일(LCP)은 <head> 에서 미리 받는다(fetchpriority=high).
 *   2) 화면용 사진은 app/portfolio/display/ 사본(.avif + .jpg, 원본과 같은 크기, 훨씬 가볍다).
 *      생성 요청에는 원본 주소를 그대로 보낸다.
 *   3) <head> 의 스크립트는 config.js 말고 모두 defer, 웹폰트 CSS 는 렌더를 막지 않는다.
 *      supabase 를 쓰는 init() 은 DOMContentLoaded 뒤에, 화면만 그리는 initUi() 는 바로.
 *   4) 헤더 자리표시자에 헤더 높이를 미리 준다 (주입 때 아래가 밀리지 않게).
 *   5) 웹폰트는 이 페이지가 쓰는 굵기만 받는다 — CSS 에 새 굵기를 쓰면 여기서 알린다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const HTML = read('ai-design.html');
const HEAD = HTML.slice(0, HTML.indexOf('</head>'));
const STYLE = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
const BODY = HTML.slice(HTML.indexOf('<body'));

/** JPEG SOF 머리에서 [폭, 높이] */
function jpegSize(buf) {
  let p = 2;
  while (p < buf.length) {
    if (buf[p] !== 0xff) return null;
    const m = buf[p + 1];
    const len = buf.readUInt16BE(p + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return [buf.readUInt16BE(p + 7), buf.readUInt16BE(p + 5)];
    }
    p += 2 + len;
  }
  return null;
}

/** AVIF 'ispe' 상자에서 [폭, 높이] */
function avifSize(buf) {
  const i = buf.indexOf('ispe');
  return i < 0 ? null : [buf.readUInt32BE(i + 8), buf.readUInt32BE(i + 12)];
}

const CASE_STATIC = (() => {
  const seg = HTML.slice(
    HTML.indexOf('var CASE_STATIC = ['),
    HTML.indexOf('];', HTML.indexOf('var CASE_STATIC = [')) + 2
  );
  return new Function(seg + '\nreturn CASE_STATIC;')();
})();

describe('마퀴 — 문서에 바로 적은 타일, 첫 타일을 먼저 받는다', () => {
  const tiles = [...BODY.matchAll(/<div class="v5-marquee-tile ([^"]+)"><\/div>/g)].map(
    (m) => m[1]
  );
  const rule = (cls) => {
    const i = STYLE.indexOf('.' + cls + ' {');
    return i < 0 ? '' : STYLE.slice(i, STYLE.indexOf('\n      }', i));
  };

  test('타일 12장 = .mq-1~6 두 벌 (-50% 순환), 스크립트가 채우지 않는다', () => {
    expect(tiles).toEqual([
      'mq-1',
      'mq-2',
      'mq-3',
      'mq-4',
      'mq-5',
      'mq-6',
      'mq-1',
      'mq-2',
      'mq-3',
      'mq-4',
      'mq-5',
      'mq-6',
    ]);
    expect(HTML).not.toMatch(/\$\('marquee'\)\.innerHTML/);
  });

  test('각 타일 사진은 JPEG 사본(대체) + image-set(AVIF, JPEG) — 파일이 있다', () => {
    for (let n = 1; n <= 6; n++) {
      const r = rule('mq-' + n);
      const m = r.match(/background-image: url\((app\/portfolio\/display\/[a-z0-9-]+)\.jpg\);/);
      expect(m).not.toBeNull();
      const base = m[1];
      expect(r).toContain(`url(${base}.avif) type('image/avif')`);
      expect(r).toContain(`url(${base}.jpg) type('image/jpeg')`);
      expect(fs.existsSync(path.join(ROOT, base + '.jpg'))).toBe(true);
      expect(fs.existsSync(path.join(ROOT, base + '.avif'))).toBe(true);
    }
  });

  test('LCP 인 첫 타일(.mq-1)의 AVIF 를 <head> 에서 fetchpriority=high 로 미리 받는다', () => {
    const preload = HEAD.match(
      /<link\s+rel="preload"\s+as="image"\s+href="([^"]+)"\s+type="image\/avif"\s+fetchpriority="high"\s*\/>/
    );
    expect(preload).not.toBeNull();
    expect(rule('mq-1')).toContain(`url(${preload[1]}) type('image/avif')`);
    expect(tiles[0]).toBe('mq-1');
    // 프리로드는 스타일시트·스크립트보다 앞에 둔다
    expect(HEAD.indexOf(preload[0])).toBeLessThan(HEAD.indexOf('<link rel="stylesheet"'));
    expect(HEAD.indexOf(preload[0])).toBeLessThan(HEAD.indexOf('<script'));
  });

  test('타일 크기는 공용 CSS 가 고정한다 — 사진이 늦게 와도 띠 높이가 변하지 않는다', () => {
    const css = read('css/dadam-v5.css');
    expect(css).toMatch(/\.v5-marquee-tile \{\s*width: 320px;\s*height: 212px;/);
    expect(css).toMatch(/\.v5-marquee-tile \{\s*width: 240px;\s*height: 160px;/);
  });
});

describe('화면용 사본 — 가볍게 보여 주고 생성에는 원본', () => {
  test('CASE_STATIC 사진마다 사본 두 벌(.jpg · .avif) — 원본과 같은 크기, 원본의 30% 이하', () => {
    expect(CASE_STATIC.length).toBeGreaterThan(0);
    for (const r of CASE_STATIC) {
      const orig = path.join(ROOT, r.image_url);
      const base = path.join(
        ROOT,
        r.image_url.replace('app/portfolio/', 'app/portfolio/display/').replace(/\.jpg$/, '')
      );
      const o = fs.readFileSync(orig);
      const j = fs.readFileSync(base + '.jpg');
      const a = fs.readFileSync(base + '.avif');
      expect(`${r.image_url} jpg ${jpegSize(j)}`).toBe(`${r.image_url} jpg ${jpegSize(o)}`);
      expect(`${r.image_url} avif ${avifSize(a)}`).toBe(`${r.image_url} avif ${jpegSize(o)}`);
      expect(j.length).toBeLessThan(o.length * 0.3);
      expect(a.length).toBeLessThan(o.length * 0.3);
    }
  });

  test('원본은 그대로 남아 있다 (생성 요청 · 다른 페이지가 쓴다)', () => {
    for (const r of CASE_STATIC) expect(fs.existsSync(path.join(ROOT, r.image_url))).toBe(true);
  });

  const bgStyle = (() => {
    const seg = HTML.slice(
      HTML.indexOf('var DISPLAY_COPIES = '),
      HTML.indexOf('// ═', HTML.indexOf('function bgStyle(src)'))
    );
    return new Function('CASE_STATIC', seg + '\nreturn bgStyle;')(CASE_STATIC);
  })();

  test('bgStyle — 정적 사진은 사본(AVIF 우선, JPEG 대체), 그 밖의 주소는 예전 그대로', () => {
    const s = bgStyle('app/portfolio/kitchen-n1-1.jpg');
    expect(s).toBe(
      'background-image:url(app/portfolio/display/kitchen-n1-1.jpg);' +
        "background-image:image-set(url(app/portfolio/display/kitchen-n1-1.avif) type('image/avif'), " +
        "url(app/portfolio/display/kitchen-n1-1.jpg) type('image/jpeg'))"
    );
    const remote = 'https://x.supabase.co/storage/v1/object/public/theme-images/a/thumb.jpg';
    expect(bgStyle(remote)).toBe('background-image:url(' + remote + ')');
    expect(bgStyle('data:image/jpeg;base64,AAAA')).toBe(
      'background-image:url(data:image/jpeg;base64,AAAA)'
    );
    // CASE_STATIC 에 없는 로컬 사진은 사본이 없을 수 있다 — 원본 그대로
    expect(bgStyle('app/portfolio/kitchen-n2-1.jpg')).toBe(
      'background-image:url(app/portfolio/kitchen-n2-1.jpg)'
    );
  });

  test('그리드·선택 줄은 bgStyle 로 그리고, 생성 요청은 원본 src 를 받는다', () => {
    const pick = HTML.slice(
      HTML.indexOf('function pickHTML(r)'),
      HTML.indexOf('function renderDb()')
    );
    expect(pick).toContain('esc(bgStyle(r.src))');
    const picks = HTML.slice(
      HTML.indexOf('function renderPicks()'),
      HTML.indexOf('function setTab(t)')
    );
    expect(picks).toContain('esc(bgStyle(p.src))');
    expect(HTML).toContain('S.picks.push({ key: src.key, src: src.src,');
    expect(HTML).toContain('var r = await fetchAsBase64(p.src);');
  });
});

describe('렌더를 막지 않는다 — defer 스크립트 · 비동기 웹폰트 CSS', () => {
  const scripts = [...HEAD.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)];

  test('<head> 스크립트는 config.js 만 바로, 나머지는 defer', () => {
    expect(scripts.length).toBeGreaterThan(1);
    for (const [tag, src] of scripts) {
      if (src === 'js/config.js') expect(tag).not.toMatch(/\bdefer\b/);
      else expect(`${src} ${/\bdefer\b/.test(tag)}`).toBe(`${src} true`);
    }
    expect(HTML).toContain('<script src="js/site-shell.js" defer></script>');
  });

  test('Google Fonts CSS 는 preload + onload 로 붙인다 (noscript 대체만 stylesheet)', () => {
    const outsideNoscript = HEAD.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
    expect(outsideNoscript).not.toMatch(
      /rel="stylesheet"[^>]*fonts\.googleapis|fonts\.googleapis[^>]*rel="stylesheet"/
    );
    expect(outsideNoscript).toMatch(
      /rel="preload"\s+as="style"\s+href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]+"\s+onload="this\.rel = 'stylesheet'"/
    );
    expect(HEAD).toMatch(
      /<noscript>\s*<link\s+rel="stylesheet"\s+href="https:\/\/fonts\.googleapis\.com\/css2\?/
    );
  });

  test('supabase 를 쓰는 init() 은 DOMContentLoaded 뒤, 화면 initUi() 는 바로', () => {
    const tail = HTML.slice(HTML.lastIndexOf('initUi();'));
    expect(tail).toMatch(
      /^initUi\(\);\n\s+if \(document\.readyState === 'loading'\) document\.addEventListener\('DOMContentLoaded', init\);\n\s+else init\(\);/
    );
    const uiAt = HTML.indexOf('function initUi()');
    const ui = HTML.slice(uiAt, HTML.indexOf('\n        }', uiAt));
    expect(ui).toContain('bind();');
    expect(ui).not.toMatch(/\bsb\b|supabase/);
    // window.supabase 는 init() 안에서만 읽는다 (defer 로 늦게 도착한다)
    const init = HTML.slice(HTML.indexOf('async function init()'), HTML.lastIndexOf('initUi();'));
    const all = HTML.split('window.supabase').length - 1;
    expect(init.split('window.supabase').length - 1).toBe(all);
  });
});

describe('헤더 자리 — 셸이 끼워 넣을 때 아래가 밀리지 않는다', () => {
  test('자리표시자 높이 = 헤더 높이 (넓은 화면 --v5-header, 700px 이하 99px)', () => {
    expect(BODY).toContain('<div data-site-shell="header" data-nav="ai"></div>');
    expect(STYLE).toMatch(/\[data-site-shell='header'\] \{\s*height: var\(--v5-header\);/);
    expect(STYLE).toMatch(
      /@media \(max-width: 700px\) \{\s*\[data-site-shell='header'\] \{\s*height: 99px;/
    );
    // 넓은 화면 헤더는 고정 높이다 — 바뀌면 위 값도 함께 본다
    expect(read('css/dadam-v5.css')).toMatch(/\.v5-header \{[^}]*height: var\(--v5-header\);/);
  });
});

describe('웹폰트 — 쓰는 굵기만', () => {
  const fontUrl =
    (HEAD.match(/href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/) || [])[1] || '';

  test('Noto Sans KR 200~500 · Noto Serif KR 400 · Cormorant Garamond 300(기울임 포함)', () => {
    expect(fontUrl).toContain('family=Noto+Sans+KR:wght@200;300;400;500&');
    expect(fontUrl).toContain('family=Noto+Serif+KR:wght@400&');
    expect(fontUrl).toContain('family=Cormorant+Garamond:ital,wght@0,300;1,300&');
    expect(fontUrl).toContain('display=swap');
  });

  test('이 페이지의 CSS 굵기는 받는 굵기 안에 있다 — 새 굵기를 쓰면 위 주소에도 더한다', () => {
    const weights = new Set();
    for (const src of [HTML, read('css/dadam-v5.css')]) {
      for (const m of src.matchAll(/font-weight:\s*(\d+)/g)) weights.add(Number(m[1]));
      for (const m of src.matchAll(/font:\s*(\d{3})\s/g)) weights.add(Number(m[1]));
    }
    for (const w of weights)
      expect(`weight ${w} ${[200, 300, 400, 500].includes(w)}`).toBe(`weight ${w} true`);
    expect(HTML).not.toMatch(/font-weight:\s*(bold|bolder)/);
  });
});
