/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * SEGAN 앱 사진 (2026-11-20 대표님 「럭셔리하고 밝은 톤으로 교체」)
 *
 *   앱(segan/)의 사진은 AI 연출 사진(app/portfolio/luxe-*.jpg, luxe-manifest.json)만 쓴다.
 *   예전 사진(kitchen-n* · funiture-n*)은 다른 업체 사진이라(@BAUS KITCHEN 등) 앱 어디에도 다시 들어오지 않게 막는다.
 *   옛 사이트 페이지(ai-design.html 등)는 _redirects 로 앱에 넘어가 열리지 않으므로 여기서 보지 않는다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'segan');
const files = fs
  .readdirSync(APP)
  .filter((f) => /\.(html|js|css)$/.test(f))
  .map((f) => [f, fs.readFileSync(path.join(APP, f), 'utf8')]);

describe('SEGAN 앱 사진', () => {
  test('예전 사진 · 다른 업체 크레딧이 앱에 없다', () => {
    const hits = files
      .filter(([, s]) =>
        /portfolio\/(display\/)?(kitchen-n|funiture-n)|@BAUS|@DESIGN SHARE|@에스 디자인/.test(s)
      )
      .map(([f]) => f);
    expect(hits).toEqual([]);
  });

  test('앱이 쓰는 luxe 사진은 모두 manifest 에 있고 파일이 있다 (AI 연출 · 예림 자재 이름)', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'app/portfolio/luxe-manifest.json'), 'utf8')
    );
    const known = new Set(manifest.photos.map((p) => p.file.replace(/\.jpg$/, '')));
    const used = new Set();
    for (const [, s] of files) {
      for (const m of s.matchAll(/portfolio\/(?:display\/)?(luxe-[a-z0-9]+)\.(?:jpg|avif)/g))
        used.add(m[1]);
    }
    expect(used.size).toBe(16);
    for (const stem of used) {
      expect(known.has(stem)).toBe(true);
      expect(fs.existsSync(path.join(ROOT, 'app/portfolio/display', stem + '.jpg'))).toBe(true);
      expect(fs.existsSync(path.join(ROOT, 'app/portfolio/display', stem + '.avif'))).toBe(true);
    }
    expect(manifest.note).toMatch(/AI 로 연출한 이미지/);
    const yerim = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'database/seed/yerim-lux.json'), 'utf8')
    ).items;
    for (const p of manifest.photos) {
      for (const m of p.materials) {
        const it = yerim.find((x) => x.vendor_code === m.code);
        expect([m.code, it && it.color_name]).toEqual([m.code, m.name]);
      }
    }
  });
});
