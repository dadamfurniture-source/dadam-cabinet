/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, process */
/**
 * 사이트 자산 버전은 하나다 — 로컬 자산의 ?v= 가 scripts/asset-version.json 과 다르면 실패.
 *
 * 사이트는 빌드 없이 GitHub Pages 가 저장소 파일을 그대로 싣고 Cloudflare 가 캐시한다.
 * ?v= 가 페이지·파일마다 따로 놀면 한 페이지만 옛 파일을 캐시에서 꺼내는 반쪽 배포가 생긴다.
 * 고치는 법: `npm run asset-version` (버전을 올리고 모두 다시 찍는다)
 *           `npm run asset-version -- --stamp` (값은 그대로 두고 다시 찍기만)
 *
 * 스캐너는 scripts/stamp-asset-version.mjs 를 부르지 않고 따로 둔다 — 스크립트가 틀려도 이 시험은 잡는다.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/stamp-asset-version.mjs');
const { version: VERSION } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts/asset-version.json'), 'utf8')
);

const PAGE_DIRS = ['.', 'admin'];
const pages = () =>
  PAGE_DIRS.flatMap((dir) =>
    fs
      .readdirSync(path.join(ROOT, dir))
      .filter((n) => n.endsWith('.html'))
      .map((n) => path.posix.join(dir === '.' ? '' : dir, n))
  ).sort();

const ASSET_EXT =
  /\.(?:m?js|css|png|jpe?g|webp|avif|gif|svg|ico|json|webmanifest|woff2?|ttf|otf)$/i;

/** 따옴표 안의 로컬 자산 URL 중 v 파라미터가 있는 것 → [{ url, v }] */
function versionedLocalRefs(text) {
  const out = [];
  for (const m of text.matchAll(/(["'])([^"'\s<>]*[?&]v=[^"'\s<>]*)\1/g)) {
    const url = m[2];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) continue; // 외부 주소 · data:
    if (/\$\{|\{\{|[`+]/.test(url)) continue; // 스크립트가 조립하는 값
    if (!ASSET_EXT.test(url.split(/[?#]/)[0])) continue; // 페이지 링크 · API 경로
    out.push({ url, v: url.match(/[?&]v=([^&#]*)/)[1] });
  }
  return out;
}

describe('사이트 자산 버전 (하나)', () => {
  test('버전 형식은 YYYYMMDDNN — 날짜가 맞고 숫자로 크기 비교가 된다', () => {
    expect(VERSION).toMatch(/^\d{10}$/);
    const [y, mo, d] = [VERSION.slice(0, 4), VERSION.slice(4, 6), VERSION.slice(6, 8)].map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d));
    expect(date.getUTCFullYear()).toBe(y);
    expect(date.getUTCMonth()).toBe(mo - 1);
    expect(date.getUTCDate()).toBe(d);
    expect(Number(VERSION.slice(8))).toBeGreaterThanOrEqual(1);
  });

  test('대상 페이지가 있다 (루트 · admin)', () => {
    const list = pages();
    expect(list).toContain('index.html');
    expect(list).toContain('detaildesign.html');
    expect(list.some((p) => p.startsWith('admin/'))).toBe(true);
  });

  test('모든 로컬 자산 ?v= 가 지금 버전과 같다', () => {
    const drift = [];
    let seen = 0;
    for (const page of pages()) {
      for (const r of versionedLocalRefs(fs.readFileSync(path.join(ROOT, page), 'utf8'))) {
        seen++;
        if (r.v !== VERSION) drift.push(`${page} → ${r.url}`);
      }
    }
    expect(seen).toBeGreaterThan(50); // 스캐너가 아무것도 못 찾는 사고를 막는다
    expect(drift).toEqual([]);
  });

  test('스캐너 — 외부 주소 · 조립하는 값 · 페이지 링크는 건너뛴다', () => {
    const html = [
      '<script src="js/a.js?v=1"></script>',
      '<link rel="stylesheet" href=\'../css/b.css?x=1&v=2\'>',
      '<script src="https://cdn.example.com/c.js?v=3"></script>',
      '<link href="//cdn.example.com/d.css?v=4">',
      'const u = `img/e.png?v=${stamp}`;',
      '<a href="login.html?v=5">',
      '<script src="/api/run?v=6"></script>',
    ].join('\n');
    expect(versionedLocalRefs(html)).toEqual([
      { url: 'js/a.js?v=1', v: '1' },
      { url: '../css/b.css?x=1&v=2', v: '2' },
    ]);
  });
});

describe('scripts/stamp-asset-version.mjs', () => {
  const run = (code) =>
    execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  const imp = `import * as s from ${JSON.stringify(pathToFileURL(SCRIPT).href)};`;

  test('--check 가 통과한다 (CI 에서도 스크립트가 돈다)', () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out).toContain(VERSION);
  });

  test('다음 버전 — 새 날이면 01, 같은 날이면 끝 두 자리 +1 (한국 날짜)', () => {
    const out = run(`${imp}
      const at = (iso) => new Date(iso);
      console.log(JSON.stringify([
        s.nextVersion('2026102701', at('2026-10-28T01:00:00+09:00')),
        s.nextVersion('2026102701', at('2026-10-27T23:00:00+09:00')),
        s.nextVersion('2026102709', at('2026-10-27T12:00:00+09:00')),
        s.nextVersion('2026102701', at('2026-10-27T16:00:00Z')),
      ]));`);
    expect(JSON.parse(out)).toEqual(['2026102801', '2026102702', '2026102710', '2026102801']);
  });

  test('stampText — v 값만 바꾸고 경로 · 다른 파라미터 · 외부 주소는 그대로', () => {
    const out = run(`${imp}
      const src = '<script src="js/a.js?v=36.0"></script><link href="../css/b.css?x=1&v=2#h"><script src="https://x.test/c.js?v=9"></script>';
      console.log(JSON.stringify(s.stampText(src, '2026102701')));`);
    const { text, refs } = JSON.parse(out);
    expect(text).toBe(
      '<script src="js/a.js?v=2026102701"></script><link href="../css/b.css?x=1&v=2026102701#h"><script src="https://x.test/c.js?v=9"></script>'
    );
    expect(refs.map((r) => r.from)).toEqual(['36.0', '2']);
  });

  test('헤더에 한 줄 올리는 법이 적혀 있고 npm 스크립트로 묶여 있다', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    expect(src).toContain('npm run asset-version');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['asset-version']).toBe('node scripts/stamp-asset-version.mjs');
  });
});
