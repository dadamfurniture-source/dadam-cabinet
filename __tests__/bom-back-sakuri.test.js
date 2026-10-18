/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 뒷판 크기는 측판 사쿠리가 정한다 (2026-10-19 사장님 — 모든 모듈 공통, extractors.js bomBackPanelSize).
 *   사쿠리 있음  측판 홈에 끼움       (W − 20) × (H − 1)   비고 '사쿠리 홈 끼움'
 *   사쿠리 없음  측판 뒤끝에 덮어 붙임 (W − 1)  × (H − 1)   비고 '측판 뒤 덮음'
 * 예전 하부장은 (W − 2T) × (H − T) — 측판 사이에 끼우는 크기라 900 하부장에서 폭 29 · 높이 14 가 모자랐다.
 */
const { FIXTURES, designOf } = require('../test-utils/bom-golden/fixtures');
const { loadExtractors } = require('../test-utils/bom-golden/golden');

function rowsOf(fixture) {
  const { MaterialExtractor } = loadExtractors();
  return new MaterialExtractor().extract(designOf(fixture)).materials;
}

describe('뒷판 — 측판 사쿠리 여부로 크기가 정해진다', () => {
  const rows = rowsOf(FIXTURES.sink15);
  const sideOf = (module) => rows.find((r) => r.module === module && r.part === '측판');
  const backOf = (module) => rows.find((r) => r.module === module && r.part === '뒷판');

  test('하부장(사쿠리 없음) 900 × 708 → 뒷판 899 × 707, 측판 뒤 덮음', () => {
    const side = sideOf('하부장-하부장(2D)');
    expect(side.note || '').not.toMatch(/sakuri/);
    expect(backOf('하부장-하부장(2D)')).toMatchObject({ material: 'MDF', thickness: 3, w: 899, h: 707, qty: 1, note: '측판 뒤 덮음' });
  });

  test('모든 하부장 모듈: 뒷판 = (W − 1) × (H − 1) — 측판 높이에서 1, 모듈 폭에서 1', () => {
    const lowers = [...new Set(rows.filter((r) => r.module.startsWith('하부장-') && r.part === '뒷판').map((r) => r.module))];
    expect(lowers.length).toBeGreaterThan(2);
    for (const mod of lowers) {
      const side = sideOf(mod);
      const back = backOf(mod);
      expect(back.h).toBe(side.h - 1);
      expect(back.note).toBe('측판 뒤 덮음');
    }
  });

  test('상부장(사쿠리 있음) → 뒷판 (W − 20) × (H − 1), 사쿠리 홈 끼움', () => {
    const uppers = [...new Set(rows.filter((r) => r.module.startsWith('상부장-') && r.part === '뒷판').map((r) => r.module))];
    expect(uppers.length).toBeGreaterThan(0);
    for (const mod of uppers) {
      expect(sideOf(mod).note).toMatch(/sakuri/);
      const back = backOf(mod);
      expect(back.h).toBe(sideOf(mod).h - 1);
      expect(back.note).toBe('사쿠리 홈 끼움');
    }
  });

  test('뒷판 행은 사쿠리 비고가 있는 측판과 짝이 맞는다 — 모든 픽스처', () => {
    for (const name of Object.keys(FIXTURES)) {
      const all = rowsOf(FIXTURES[name]);
      for (const back of all.filter((r) => r.part === '뒷판' && r.thickness === 3)) {
        const side = all.find((r) => r.module === back.module && r.part === '측판');
        if (!side) continue; // EL장 등 측판이 다른 행 이름인 모듈
        const sakuri = /sakuri/.test(side.note || '');
        expect([name, back.module, back.note]).toEqual([name, back.module, sakuri ? '사쿠리 홈 끼움' : '측판 뒤 덮음']);
        expect(back.h).toBe(side.h - 1);
      }
    }
  });
});
