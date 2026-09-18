/**
 * 오픈장 규칙 — 2026-09-19 사장님이 준 예시를 그대로 고정한다.
 *
 *   W500 × H450 × D570 →
 *     측판 450×570 2장 · 천지판 464×550 2장 · 뒷판 450×464 1장   (사장님 표기: 세로×가로 섞임)
 *   이 파일은 저장소 관례대로 **가로×세로**로 확인한다 — 같은 판이다.
 */

const R = require('../js/detaildesign/bom-open-cabinet-rules.js');

/** 부재 한 줄을 "가로×세로×수량" 으로 — 실패 메시지가 치수를 바로 보여주게 */
const sig = (p) => `${p.w}×${p.h}×${p.qty}`;
const by = (parts, name) => parts.find((p) => p.part === name);

describe('오픈장 — 사장님 예시 (W500 H450 D570)', () => {
  const parts = R.partsOf({ W: 500, H: 450, D: 570 });

  test('부재는 측판·천지판·뒷판 세 줄이다 (도어·선반 없음)', () => {
    expect(parts.map((p) => p.part)).toEqual(['측판', '천지판', '뒷판']);
  });

  test('측판 = 깊이 × 높이, 2장', () => {
    expect(sig(by(parts, '측판'))).toBe('570×450×2');
  });

  test('천지판 = (W−36) × (D−20), 2장', () => {
    expect(sig(by(parts, '천지판'))).toBe('464×550×2');
  });

  test('뒷판 = (W−36) × H, 1장 — 2.7T 가림판이 아니라 18T 통판', () => {
    expect(sig(by(parts, '뒷판'))).toBe('464×450×1');
    expect(by(parts, '뒷판').t).toBe(18);
  });

  test('몸통 전체가 18T MDF 다 (PB 가 한 장도 없다)', () => {
    parts.forEach((p) => {
      expect(p.material).toBe('MDF');
      expect(p.t).toBe(18);
    });
  });
});

describe('오픈장 — 규칙 자체', () => {
  test('두께 18 · 뒷판 자리 20 — 천지판이 깊이에서 물러난 만큼이 뒷판(18) + 여유(2)', () => {
    expect(R.RULES.T).toBe(18);
    expect(R.RULES.BACK_GAP).toBe(20);
    const g = R.innerOf({ W: 500, H: 450, D: 570 });
    expect(g.innerD + g.backT).toBe(568);   // 570 − 2 (여유)
  });

  test('isOpenCabinet 은 moduleKind 하나만 본다 — 플래너 구조와 BOM 모듈이 같은 값을 쓴다', () => {
    expect(R.isOpenCabinet({ moduleKind: 'open' })).toBe(true);
    expect(R.isOpenCabinet({ moduleKind: 'normal' })).toBe(false);
    expect(R.isOpenCabinet({})).toBe(false);
    expect(R.isOpenCabinet(null)).toBe(false);
  });

  test('치수가 없으면 부재도 없다 (빈 모듈이 BOM 을 깨뜨리지 않는다)', () => {
    expect(R.partsOf({ W: 0, H: 0, D: 0 })).toEqual([]);
    expect(R.partsOf(null)).toEqual([]);
    expect(R.warningsOf({}).length).toBe(1);
  });

  test('폭이 측판 두 장보다 좁으면 경고한다 — 조용히 음수 판을 내지 않는다', () => {
    expect(R.partsOf({ W: 30, H: 450, D: 570 })).toEqual([]);
    expect(R.warningsOf({ W: 30, H: 450, D: 570 }).join()).toMatch(/좁아/);
  });

  test('깊이가 뒷판 자리보다 얕으면 경고한다', () => {
    expect(R.warningsOf({ W: 500, H: 450, D: 15 }).join()).toMatch(/얕아/);
  });
});
