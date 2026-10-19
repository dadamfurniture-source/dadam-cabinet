/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, describe, test, expect */
/**
 * CAD 베타 PR3 — 몸통 조립 규칙 한 표 (js/detaildesign/assembly-rules.js).
 *
 * 숫자는 BOM 이 이미 쓰던 값이다 (골든 9종이 그대로인 것으로 증명). 여기서는
 *   1) 표가 얼어 있고 값이 확정 사실과 같은지,
 *   2) extractors.js 가 같은 숫자를 다시 적지 않고 표를 읽는지,
 *   3) detaildesign.html 이 표를 extractors.js 보다 먼저 싣는지
 * 를 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const R = require('../js/detaildesign/assembly-rules.js');

/** 주석을 뺀 소스 — 설명 글의 숫자는 세지 않는다. */
function codeOf(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

describe('assembly-rules 표', () => {
  test('판 문자열과 얼린 표', () => {
    expect(R.RULES_VERSION).toMatch(/^asm-\d{4}\.\d{2}\.\d+$/);
    expect(Object.isFrozen(R.CARCASS)).toBe(true);
  });

  test('확정 사실과 같은 값 (뒷판 3T · 사쿠리 15→3 · 천지판 D−18 · 상부 선반 D−34 · 붙박이장 선반 D−88)', () => {
    expect(R.CARCASS).toMatchObject({
      BACK_PANEL_T: 3,
      SAKURI_FROM_BACK: 15,
      SAKURI_W: 3,
      SAKURI_PANEL_D_MINUS: 18,
      SAKURI_SHELF_D_MINUS: 34,
      WARDROBE_SHELF_D_MINUS: 88,
      BAND_W: 70,
      BRACE_W: 70,
      BRACE_W_MIN_UPPER: 700,
      BRACE_W_MIN_LOWER: 800,
    });
    // 사쿠리 홈 폭 = 뒷판 두께, 천지판은 홈 앞까지
    expect(R.CARCASS.SAKURI_W).toBe(R.CARCASS.BACK_PANEL_T);
    expect(R.CARCASS.SAKURI_PANEL_D_MINUS).toBe(R.CARCASS.SAKURI_FROM_BACK + R.CARCASS.SAKURI_W);
  });

  test('뒷판 크기 — 사쿠리 (W−20)×(H−1), 덮음 (W−1)×(H−1)', () => {
    expect(R.backPanelSize(900, 708, true)).toEqual({ w: 880, h: 707 });
    expect(R.backPanelSize(900, 708, false)).toEqual({ w: 899, h: 707 });
  });

  test('처짐방지목 — 상부 700 · 하부 800 이상만 1장', () => {
    expect(R.braceQtyOf(699, 'upper')).toBe(0);
    expect(R.braceQtyOf(700, 'upper')).toBe(1);
    expect(R.braceQtyOf(799, 'lower')).toBe(0);
    expect(R.braceQtyOf(800, 'lower')).toBe(1);
    expect(R.braceQtyOf(800, 'tall')).toBe(1);
  });
});

describe('extractors.js 는 표를 읽는다 — 같은 숫자를 두 군데 적지 않는다', () => {
  const code = codeOf('js/detaildesign/extractors.js');

  test('표를 싣는다', () => {
    expect(code).toMatch(/DadamAssemblyRules/);
    expect(code).toMatch(/require\('\.\/assembly-rules\.js'\)/);
  });

  test('옮긴 상수를 다시 선언하지 않는다', () => {
    ['BOM_BRACE_W_MIN_UPPER', 'BOM_BRACE_W_MIN_LOWER', 'BOM_BACK_SAKURI_W_MINUS', 'BOM_BACK_FLAT_W_MINUS', 'BOM_BACK_H_MINUS']
      .forEach((name) => expect(code).not.toMatch(new RegExp(`const ${name}\\b`)));
    expect(code).not.toMatch(/const BOM_BACK_PANEL_T = \d/);
    expect(code).not.toMatch(/function bomBackPanelSize\b/);
    expect(code).not.toMatch(/function bomBraceQtyOf\b/);
    expect(code).not.toMatch(/defaultUpperD = \d/);
    expect(code).not.toMatch(/defaultLowerD = \d/);
  });

  test('몸통 행에 숫자 리터럴이 남지 않는다 (천지판 D−18 · 선반 D−34/−88 · 밴드 70 · 처짐방지 70)', () => {
    expect(code).not.toMatch(/\b(modD|D) - (18|34)\b/);
    expect(code).not.toMatch(/'밴드(\(보강목\)|\(처짐방지\))?', 'PB', T, 70,/);
    expect(code).not.toMatch(/'밴드(\(보강목\))?', 'PB', T, W - T \* 2, 70,/);
    expect(code).not.toMatch(/H - T \* 2 - 70\b/);
  });
});

test('detaildesign.html 이 assembly-rules.js 를 extractors.js 보다 먼저 싣는다', () => {
  const html = fs.readFileSync(path.join(ROOT, 'detaildesign.html'), 'utf8');
  const a = html.indexOf('js/detaildesign/assembly-rules.js?v=');
  const e = html.indexOf('js/detaildesign/extractors.js?v=');
  expect(a).toBeGreaterThan(0);
  expect(e).toBeGreaterThan(a);
});
