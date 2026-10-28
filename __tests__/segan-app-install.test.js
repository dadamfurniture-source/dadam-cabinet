/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, process, Buffer */
/**
 * SEGAN 앱 설치 기본 (segan/) — 매니페스트 · 아이콘 · 숨김(noindex) · 서비스 워커 범위.
 *
 *   - 매니페스트 값과 아이콘 파일 (크기 · 마스커블 안전 영역 · 가운데 S)
 *   - segan 페이지는 모두 noindex · 매니페스트 · 아이콘을 갖고, 로컬 참조 파일이 다 있다
 *   - 서비스 워커는 segan/shell.js 가 /segan/ 범위로만 등록한다. 기존 사이트는 등록하지 않는다
 *   - 기존 사이트 어디에서도 segan/ 을 링크하지 않는다
 *   - 아이콘 · 워드마크 파일이 scripts/segan-icons.mjs 출력과 같다 (다시 만들면 같은 그림)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const SEGAN = path.join(ROOT, 'segan');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const MANIFEST = JSON.parse(read('segan/manifest.webmanifest'));
const SEGAN_PAGES = fs
  .readdirSync(SEGAN)
  .filter((n) => n.endsWith('.html'))
  .map((n) => `segan/${n}`);
const SITE_PAGES = ['.', 'admin'].flatMap((dir) =>
  fs
    .readdirSync(path.join(ROOT, dir))
    .filter((n) => n.endsWith('.html'))
    .map((n) => path.posix.join(dir === '.' ? '' : dir, n))
);
const SITE_SCRIPTS = (function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) return walk(rel);
    return e.name.endsWith('.js') ? [rel] : [];
  });
})('js');

/** PNG(8비트 RGB/RGBA, 인터레이스 없음) → { w, h, px(RGB) } */
function decodePng(buf) {
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const colorType = buf[25];
  expect(buf[24]).toBe(8);
  expect([2, 6]).toContain(colorType);
  const bpp = colorType === 6 ? 4 : 3;
  const idat = [];
  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off);
    if (buf.toString('ascii', off + 4, off + 8) === 'IDAT')
      idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const full = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const v = raw[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? full[y * stride + i - bpp] : 0;
      const b = y ? full[(y - 1) * stride + i] : 0;
      const c = y && i >= bpp ? full[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred =
        f === 0
          ? 0
          : f === 1
            ? a
            : f === 2
              ? b
              : f === 3
                ? (a + b) >> 1
                : pa <= pb && pa <= pc
                  ? a
                  : pb <= pc
                    ? b
                    : c;
      full[y * stride + i] = (v + pred) & 0xff;
    }
  }
  const px = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++)
    for (let ch = 0; ch < 3; ch++) px[i * 3 + ch] = full[i * bpp + ch];
  return { w, h, px };
}

const NAVY = [0x0b, 0x25, 0x45];
const PAPER = [0xf6, 0xf3, 0xee];
const at = ({ w, px }, x, y) => [...px.subarray((y * w + x) * 3, (y * w + x) * 3 + 3)];
/** 네이비에서 벗어난 픽셀(S 의 잉크)의 박스 */
function inkBox(img) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const p = at(img, x, y);
      if (Math.abs(p[0] - NAVY[0]) + Math.abs(p[1] - NAVY[1]) + Math.abs(p[2] - NAVY[2]) > 24) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
      }
    }
  return { x0, y0, x1, y1 };
}

/** 페이지의 로컬 참조 (src · href, 외부 주소 · 앵커 · 조립 값 제외) */
function localRefs(html) {
  const body = html.replace(/<!--[\s\S]*?-->/g, '');
  return [...body.matchAll(/\s(?:src|href)\s*=\s*"([^"]*)"/g)]
    .map((m) => m[1])
    .filter((u) => u && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u) && !/\$\{|\{\{|[`'+]/.test(u));
}
const resolveRef = (page, ref) => {
  const clean = decodeURI(ref.split(/[?#]/)[0]);
  if (clean.startsWith('/')) return path.join(ROOT, clean);
  const p = path.join(ROOT, path.dirname(page), clean);
  return clean === '' || clean.endsWith('/') ? path.join(p, 'index.html') : p;
};

describe('segan/manifest.webmanifest', () => {
  test('이름 · 언어 · 범위 · 표시 · 색', () => {
    expect(MANIFEST).toMatchObject({
      id: '/segan/',
      name: 'SEGAN',
      short_name: 'SEGAN',
      lang: 'ko',
      start_url: '/segan/',
      scope: '/segan/',
      display: 'standalone',
      background_color: '#F6F3EE',
      theme_color: '#F6F3EE',
    });
  });

  test('start_url 은 scope 안이고, 그 자리에 페이지가 있다', () => {
    expect(MANIFEST.start_url.startsWith(MANIFEST.scope)).toBe(true);
    expect(fs.existsSync(path.join(ROOT, MANIFEST.start_url, 'index.html'))).toBe(true);
  });

  test('아이콘: 192 · 512 · 512 마스커블 — 파일이 있고 PNG 실제 크기가 sizes 와 같다', () => {
    const list = MANIFEST.icons.map((i) => `${i.sizes} ${i.purpose}`);
    expect(list).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    for (const icon of MANIFEST.icons) {
      expect(icon.type).toBe('image/png');
      const file = path.join(SEGAN, icon.src);
      expect(fs.existsSync(file)).toBe(true);
      const img = decodePng(fs.readFileSync(file));
      expect(`${img.w}x${img.h}`).toBe(icon.sizes);
    }
  });
});

describe('segan/icons — 네이비 타일 가운데 S', () => {
  const ICONS = {
    'icon-192.png': { size: 192, ratio: 0.6 },
    'icon-512.png': { size: 512, ratio: 0.6 },
    'icon-maskable-512.png': { size: 512, ratio: 0.48 },
    'apple-touch-icon.png': { size: 180, ratio: 0.6 },
    'favicon-32.png': { size: 32, ratio: 0.6 },
    'favicon-16.png': { size: 16, ratio: 0.6 },
  };

  test.each(Object.entries(ICONS))(
    '%s — 크기 · 네 모서리 네이비 · S 높이 · 가운데',
    (file, { size, ratio }) => {
      const img = decodePng(fs.readFileSync(path.join(SEGAN, 'icons', file)));
      expect([img.w, img.h]).toEqual([size, size]);
      for (const [x, y] of [
        [0, 0],
        [size - 1, 0],
        [0, size - 1],
        [size - 1, size - 1],
      ])
        expect(at(img, x, y)).toEqual(NAVY);
      const b = inkBox(img);
      const tol = Math.max(1.5, size * 0.01);
      expect(Math.abs((b.y1 - b.y0) / size - ratio)).toBeLessThan(2 / size + 0.01);
      expect(Math.abs((b.x0 + b.x1) / 2 - size / 2)).toBeLessThanOrEqual(tol);
      expect(Math.abs((b.y0 + b.y1) / 2 - size / 2)).toBeLessThanOrEqual(tol);
    }
  );

  test('큰 아이콘의 S 는 종이색 #F6F3EE 로 칠해진다', () => {
    const img = decodePng(fs.readFileSync(path.join(SEGAN, 'icons/icon-512.png')));
    let solid = 0;
    for (let i = 0; i < img.w * img.h; i++) {
      const p = [...img.px.subarray(i * 3, i * 3 + 3)];
      if (p[0] === PAPER[0] && p[1] === PAPER[1] && p[2] === PAPER[2]) solid++;
    }
    expect(solid).toBeGreaterThan(1000);
  });

  test('마스커블: S 의 모든 잉크가 80% 안전 영역(가운데 원, 반지름 40%) 안', () => {
    const img = decodePng(fs.readFileSync(path.join(SEGAN, 'icons/icon-maskable-512.png')));
    const c = img.w / 2;
    let worst = 0;
    for (let y = 0; y < img.h; y++)
      for (let x = 0; x < img.w; x++) {
        const p = at(img, x, y);
        if (p[0] !== NAVY[0] || p[1] !== NAVY[1] || p[2] !== NAVY[2]) {
          worst = Math.max(worst, Math.hypot(x + 0.5 - c, y + 0.5 - c) / img.w);
        }
      }
    expect(worst).toBeGreaterThan(0.1);
    expect(worst).toBeLessThan(0.4);
  });

  test('아이콘 · 워드마크 파일이 scripts/segan-icons.mjs 출력과 같다', () => {
    const script = pathToFileURL(path.join(ROOT, 'scripts/segan-icons.mjs')).href;
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import * as s from ${JSON.stringify(script)};
         const png = {};
         for (const { file, size, ratio } of s.PNG_ICONS) png[file] = Buffer.from(s.renderIcon(size, ratio)).toString('base64');
         console.log(JSON.stringify({ icon: s.iconSvg(), wordmark: s.wordmarkSvg(), png }));`,
      ],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    const want = JSON.parse(out);
    const norm = (t) => t.split('\r\n').join('\n');
    expect(norm(read('segan/icons/icon.svg'))).toBe(want.icon);
    expect(norm(read('segan/icons/wordmark.svg'))).toBe(want.wordmark);
    expect(Object.keys(want.png).sort()).toEqual(Object.keys(ICONS).sort());
    for (const [file, b64] of Object.entries(want.png)) {
      const expected = Buffer.from(b64, 'base64');
      const { px } = decodePng(fs.readFileSync(path.join(SEGAN, 'icons', file)));
      expect(px.length).toBe(expected.length);
      let maxDiff = 0;
      for (let i = 0; i < px.length; i++)
        maxDiff = Math.max(maxDiff, Math.abs(px[i] - expected[i]));
      expect([file, maxDiff <= 1]).toEqual([file, true]); // 부동소수 반올림 차이(±1)만 허용
    }
  });
});

describe('segan 페이지 — 숨김 · 설치 정보', () => {
  test('페이지 목록 (index · offline)', () => {
    expect(SEGAN_PAGES).toEqual(expect.arrayContaining(['segan/index.html', 'segan/offline.html']));
  });

  test.each(SEGAN_PAGES)('%s — noindex,nofollow · 매니페스트 · theme-color · 아이콘', (page) => {
    const html = read(page);
    expect(html).toMatch(/<meta name="robots" content="noindex,nofollow" \/>/);
    expect(html).toMatch(/<link rel="manifest" href="(?:\/segan\/)?manifest\.webmanifest" \/>/);
    expect(html).toMatch(/<meta name="theme-color" content="#F6F3EE" \/>/);
    expect(html).toMatch(
      /<link rel="apple-touch-icon" href="[^"]*icons\/apple-touch-icon\.png\?v=\d+" \/>/
    );
    expect(html).toMatch(
      /<link rel="icon" href="[^"]*icons\/icon\.svg\?v=\d+" type="image\/svg\+xml" \/>/
    );
    expect(html).toMatch(/<html lang="ko">/);
  });

  test.each(SEGAN_PAGES)('%s — 로컬 참조 파일이 모두 있다 (img 포함)', (page) => {
    const refs = localRefs(read(page));
    expect(refs.length).toBeGreaterThan(3);
    const missing = refs.filter((r) => !fs.existsSync(resolveRef(page, r)));
    expect(missing).toEqual([]);
  });

  test('offline.html 은 어느 주소에서 보여도 되게 /segan/ 절대 경로만 쓴다', () => {
    const refs = localRefs(read('segan/offline.html'));
    expect(refs.every((r) => r.startsWith('/segan/'))).toBe(true);
    expect(read('segan/offline.html')).toContain('연결이 끊겼습니다');
  });

  test('index.html 이 공용 셸(shell.css · shell.js)을 싣는다', () => {
    const html = read('segan/index.html');
    expect(html).toMatch(/<link rel="stylesheet" href="shell\.css\?v=\d+" \/>/);
    expect(html).toMatch(/<script src="shell\.js\?v=\d+" defer><\/script>/);
  });
});

describe('서비스 워커 범위', () => {
  test('segan/shell.js — /segan/sw.js 를 /segan/ 범위로만 등록한다', () => {
    const js = read('segan/shell.js');
    const calls = [...js.matchAll(/serviceWorker\.register\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls).toEqual(["'/segan/sw.js', { scope: '/segan/' }"]);
  });

  test('기존 사이트(루트 · admin 페이지, js/) 는 서비스 워커를 등록하지 않는다', () => {
    const offenders = [...SITE_PAGES, ...SITE_SCRIPTS].filter((f) =>
      /serviceWorker\s*\.\s*register|navigator\.serviceWorker/.test(read(f))
    );
    expect(offenders).toEqual([]);
  });
});

// 하나뿐인 예외 — 협력업체 가입 입구. 요금제의 Expert · Agent 단추는 SEGAN 「내 정보 › 업체」로 간다.
const SEGAN_LINK_ALLOWED = { 'pricing.html': ["var PARTNER_HREF = 'segan/me.html#partner';"] };

describe('숨김 — 기존 사이트에서 segan 으로 가는 길이 없다', () => {
  test('루트 · admin 페이지와 js/ 가 segan/ 을 가리키지 않는다 (협력업체 가입 입구 하나만 예외)', () => {
    const offenders = [...SITE_PAGES, ...SITE_SCRIPTS].filter((f) => {
      let text = read(f);
      for (const ok of SEGAN_LINK_ALLOWED[f] || []) text = text.split(ok).join('');
      return /segan\//i.test(text);
    });
    expect(offenders).toEqual([]);
  });

  test('예외 입구는 정해 둔 그 한 줄로 한 번만 있다', () => {
    for (const [f, lines] of Object.entries(SEGAN_LINK_ALLOWED))
      for (const line of lines) expect(read(f).split(line).length - 1).toBe(1);
  });

  test('robots.txt · 사이트맵에 segan 이 없다', () => {
    const files = ['robots.txt', 'sitemap.xml'].filter((f) => fs.existsSync(path.join(ROOT, f)));
    for (const f of files) expect(read(f)).not.toMatch(/segan/i);
  });
});

describe('segan/shell.css — v5 토큰과 같은 값', () => {
  test('같은 이름의 토큰은 css/dadam-v5.css 와 값이 같다', () => {
    const tokens = (css) =>
      Object.fromEntries(
        [...css.matchAll(/(--v5-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
          m[1],
          m[2].trim().toLowerCase(),
        ])
      );
    const app = tokens(read('segan/shell.css'));
    const v5 = tokens(read('css/dadam-v5.css'));
    expect(Object.keys(app).length).toBeGreaterThan(5);
    for (const [name, value] of Object.entries(app))
      expect({ name, value }).toEqual({ name, value: v5[name] });
  });

  test('라운드 · 섀도 없음', () => {
    const css = read('segan/shell.css');
    expect(css).not.toMatch(/box-shadow\s*:/);
    const radii = [...css.matchAll(/border-radius\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(radii.filter((r) => r !== '0')).toEqual([]);
  });
});
