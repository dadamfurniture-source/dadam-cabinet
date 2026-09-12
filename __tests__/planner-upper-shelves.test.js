/**
 * 2026-09-13: 상부장 기본 선반 2개 — 내경(몸통 H − 2T)에서 선반 두께를 뺀 높이를 3등분.
 *   H 720 · T 15 → 내경 690 · 칸 (690 − 30) / 3 = 220 → 선반 중심 243 · 478
 * 하부장 규칙(간격 300~450, H/(n+1))은 그대로다.
 * 정본: data-constants.js UPPER_SHELF_COUNT / BODY_THICKNESS_DEFAULT. 플래너 사본: MASTER_RULES.
 */
const fs = require('fs');
const path = require('path');
const engine = require('../js/planner/planner-engine');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const ROOT = path.join(__dirname, '..');

describe('shelvesEvenInner', () => {
  test('H 720 · 2장 → 243 · 478 (세 칸 220)', () => {
    expect(engine.shelvesEvenInner(720, 2, 15)).toEqual([243, 478]);
  });
  test('세 칸이 같다 — 바닥판 위, 두 선반 사이, 천판 아래', () => {
    const [a, b] = engine.shelvesEvenInner(720, 2, 15);
    const T = 15;
    const gap1 = (a - T / 2) - T;             // 지판 위 ~ 1번 선반 아래
    const gap2 = (b - T / 2) - (a + T / 2);   // 1번 위 ~ 2번 아래
    const gap3 = (720 - T) - (b + T / 2);     // 2번 위 ~ 천판 아래
    [gap1, gap2, gap3].forEach((g) => expect(Math.abs(g - 220)).toBeLessThanOrEqual(1));
  });
  test('선반 두께를 뺀다 — 안 빼면 칸이 230 이 된다', () => {
    expect(engine.shelvesEvenInner(720, 2, 15)).not.toEqual([245, 475]);
  });
  test('들어갈 자리가 없으면 비운다', () => {
    expect(engine.shelvesEvenInner(50, 2, 15)).toEqual([]);
    expect(engine.shelvesEvenInner(720, 0, 15)).toEqual([]);
  });
});

describe('calcDefaultShelves', () => {
  test('상부장은 기본 2개 (UPPER_SHELF_COUNT)', () => {
    expect(engine.MASTER_RULES.UPPER_SHELF_COUNT).toBe(2);
    expect(engine.calcDefaultShelves('upper', 720)).toEqual([243, 478]);
  });
  test('하부장은 예전 규칙 그대로 (간격 300~450)', () => {
    const sh = engine.calcDefaultShelves('lower', 708);
    expect(sh).toEqual([354]);
  });
  test('정본과 사본이 같다', () => {
    const dc = fs.readFileSync(path.join(ROOT, 'js/detaildesign/data-constants.js'), 'utf8');
    expect(dc).toMatch(/UPPER_SHELF_COUNT = 2\b/);
    expect(dc).toMatch(/BODY_THICKNESS_DEFAULT = 15\b/);
    expect(engine.MASTER_RULES.BODY_T).toBe(15);
  });
});

describe('구조 단계에서', () => {
  function boot() {
    const seed = seedFor(FIXTURES.straight, { modules: false });
    const search = seed._search; delete seed._search;
    const p = bootPlanner('mockup-structure.html', { search, storage: seed });
    if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
    return p;
  }
  test('상부장 영역에 모듈을 넣으면 선반 2개가 3등분 자리에 선다', () => {
    const p = boot();
    const up = p.g('areas').find((a) => a.section === 'upper');
    const m = p.g('addModuleToArea')(up.id);
    const s = p.g('getStructure')(m.id);
    expect(s.shelves).toHaveLength(2);
    expect(s.shelves).toEqual(engine.shelvesEvenInner(p.g('bodyHeightOf')(m, s), 2, 15));
  });
  test("상부장 '균등 재배치' 도 내경 규칙을 쓴다", () => {
    const p = boot();
    const up = p.g('areas').find((a) => a.section === 'upper');
    const m = p.g('addModuleToArea')(up.id);
    const s = p.g('getStructure')(m.id);
    const three = p.g('shelvesForCount')(m, s, 3);
    const H = p.g('bodyHeightOf')(m, s);
    expect(three).toEqual(engine.shelvesEvenInner(H, 3, 15));
  });
  test('상부 멍장 3D 에는 목대가 한 벌(2조각)뿐이다 — 소스 규약', () => {
    const src = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
    expect(src).not.toMatch(/CORNER_HINGE_BATTEN_UPPER_QTY/);
    const at = src.indexOf("if (types[i] === 'blind' || types[i + 1] === 'blind')");
    expect(src.slice(at, at + 400).match(/addBlindBatten\(/g)).toHaveLength(1);
  });
});
