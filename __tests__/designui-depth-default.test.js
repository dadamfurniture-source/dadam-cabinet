/**
 * 2026-10-24 사장님 D3: 품목 깊이가 빠졌을 때 플래너로 넘기는 기본은 650 — BOM 상판(extractors.js)과 같다.
 *   예전엔 플래너 600 · BOM 650 이라 옛 설계에서 3D 와 발주 깊이가 달랐다.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'detaildesign', 'ui-step1.js'), 'utf8');
const bom = fs.readFileSync(path.join(__dirname, '..', 'js', 'detaildesign', 'extractors.js'), 'utf8');

describe('품목 깊이 기본값 (D3)', () => {
  test('BOM 상판 깊이 기본은 650', () => {
    expect(bom).toMatch(/const topD = parseFloat\(item\.d\) \|\| 650;/);
  });

  test('플래너 payload depth 두 곳 · ㄱ자 주선/보조선 깊이가 650 으로 떨어진다 (600 이 남지 않는다)', () => {
    expect(src.match(/depth: parseFloat\(item\.d\) \|\| 650,/g)).toHaveLength(2);
    expect(src).not.toMatch(/depth: parseFloat\(item\.d\) \|\| 600/);
    expect(src).toMatch(/const primeD = parseFloat\(itemD\) \|\| 650;/);
    expect(src).toMatch(/const secD = parseFloat\(specs\.lowerSecondaryD\) \|\| parseFloat\(itemD\) \|\| 650;/);
  });
});
