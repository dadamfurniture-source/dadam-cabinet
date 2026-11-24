/**
 * Cloudflare 웹 분석 표지 — 공개 화면에만 (처리방침 10항)
 *
 * 처리방침: 「공개 화면(홈, 연출컷 만들기, 시공사례, 상담 신청, 소개, 구독, 매거진)의 방문 수는
 * Cloudflare 웹 분석으로 봅니다 … 로그인한 뒤 쓰는 화면에는 붙이지 않습니다.」
 * Cloudflare 자동 붙이기는 꺼 두었다(JS Snippet 방식) — 표지는 우리가 고른 쪽에만 있다.
 * 공개 화면 목록의 정본은 sitemap.xml 이다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BEACON = 'static.cloudflareinsights.com/beacon.min.js';
const SKIP = new Set(['node_modules', '.git', 'coverage', 'dist', '.wrangler']);

function htmlFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(ent.name) || ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...htmlFiles(p));
    else if (ent.name.endsWith('.html')) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
  }
  return out;
}

const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const PUBLIC = [...sitemap.matchAll(/<loc>https:\/\/dadamfurniture\.com\/([^<]*)<\/loc>/g)].map(
  (m) => {
    const p = m[1];
    return p.endsWith('/') ? p + 'index.html' : p + '.html';
  }
);

describe('Cloudflare 웹 분석 — 공개 화면에만', () => {
  test('공개 화면 = 사이트맵 13쪽', () => {
    expect(PUBLIC).toHaveLength(13);
    expect(PUBLIC).toContain('segan/index.html');
    expect(PUBLIC).toContain('segan/consult.html');
  });

  test.each(PUBLIC)('%s 에 표지가 한 번 — 정해진 토큰', (file) => {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    expect(html.split(BEACON)).toHaveLength(2);
    expect(html).toContain(`data-cf-beacon='{"token": "441a47f8277b4e9e87d5eeac2b017997"}'`);
    // head 안에
    expect(html.indexOf(BEACON)).toBeLessThan(html.indexOf('</head>'));
  });

  test('그 밖의 화면(로그인 · 마이페이지 · 설정 · 관리 등)에는 표지가 없다', () => {
    const others = htmlFiles(ROOT).filter((f) => !PUBLIC.includes(f));
    expect(others).toEqual(
      expect.arrayContaining(['login.html', 'segan/me.html', 'segan/settings.html'])
    );
    const leaked = others.filter((f) =>
      fs.readFileSync(path.join(ROOT, f), 'utf8').includes('cloudflareinsights')
    );
    expect(leaked).toEqual([]);
  });
});
