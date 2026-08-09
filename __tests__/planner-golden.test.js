/**
 * P0: 브리지 계약 골든 — 이후 모든 리팩터 단계의 통과 기준.
 *
 * 불변식 1: `buildPlannerPayload()` 출력이 골든 3종에 대해 바이트 동일해야 한다.
 * 엔진을 `js/planner/` 로 옮기든, DOM 진실을 JS 진실로 바꾸든, 런(Run)을 도입하든
 * **이 스냅샷이 흔들리면 그 단계는 무효**다. 의도적 변경은 별도 커밋으로 골든을 갱신한다.
 *
 * 소스 문자열을 자르지 않고 실제로 페이지를 부팅해 함수를 호출한다 —
 * 기존 방식(`indexOf('function X')`)은 함수가 이동하면 빈 문자열을 검사하며 거짓 통과한다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor, canonical } = require('../test-utils/planner-golden');

/** 배치 픽스처를 구조 페이지에 올리고 브리지 payload 를 받는다 */
function payloadFor(fixture, opts = {}) {
  const seed = seedFor(fixture, opts);
  const search = seed._search;
  delete seed._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: seed });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  p.g('loadModules')();
  return { p, payload: p.g('buildPlannerPayload')('PLANNER_STATE') };
}

describe('골든 — 직선 싱크대', () => {
  test('배치가 구조 단계로 손실 없이 넘어간다', () => {
    const { payload } = payloadFor(FIXTURES.straight);
    // 가전(sink/hood)도 함께 넘어가야 부모가 개수대·후드장을 판정할 수 있다
    expect(payload.modules.map((m) => m.section).sort())
      .toEqual(['hood', 'lower', 'lower', 'lower', 'sink', 'upper', 'upper']);
  });

  test('전체 높이가 그대로 실린다 (몸통 변환은 부모가 한다)', () => {
    const { payload } = payloadFor(FIXTURES.straight);
    const lower = payload.modules.filter((m) => m.section === 'lower');
    const upper = payload.modules.filter((m) => m.section === 'upper');
    expect(lower.every((m) => m.H === 870)).toBe(true);
    expect(upper.every((m) => m.H === 780)).toBe(true);
  });

  test('payload 스냅샷', () => {
    const { payload } = payloadFor(FIXTURES.straight);
    expect(canonical(payload)).toMatchSnapshot();
  });
});

describe('골든 — ㄱ자 (회전 0·90 혼재)', () => {
  test('회전이 보존된다', () => {
    const { payload } = payloadFor(FIXTURES.lShape);
    const rotations = [...new Set(payload.modules.map((m) => m.rotation))].sort((a, b) => a - b);
    expect(rotations).toEqual([0, 90]);
  });

  test('키큰장이 별도 section 으로 살아 있다', () => {
    const { payload } = payloadFor(FIXTURES.lShape);
    expect(payload.modules.some((m) => m.section === 'tall')).toBe(true);
  });

  test('payload 스냅샷', () => {
    const { payload } = payloadFor(FIXTURES.lShape);
    expect(canonical(payload)).toMatchSnapshot();
  });
});

describe('골든 — 135° 사선 (P9 목표)', () => {
  test('현재 구조가 사선을 어떻게 다루는지 고정해둔다', () => {
    const { payload } = payloadFor(FIXTURES.oblique);
    // 지금은 회전각이 그대로 실린다. P7 에서 런(Run)으로 대체되면 이 스냅샷이 바뀐다 —
    // 그때가 "의도적 변경"이므로 골든 갱신을 별도 커밋으로 낸다.
    expect(canonical(payload)).toMatchSnapshot();
  });

  test('세트 그룹핑이 사선에서 파편화된다 (P7 이 풀어야 할 문제)', () => {
    const { p } = payloadFor(FIXTURES.oblique);
    const sets = p.g('buildSets')();
    // buildSets 는 회전각을 키로 쓴다 → 0° 와 135° 가 서로 다른 세트가 된다.
    // 실제로는 이어진 하나의 런인데 정면도·자동계산이 쪼개진다.
    const rotationKeys = sets.map((s) => s.modules.map((m) => m.rotation).join(','));
    expect(sets.length).toBeGreaterThan(1);
    expect(rotationKeys.join(' | ')).toMatch(/135/);
  });
});

describe('자동계산이 골든에서 안정적이다', () => {
  test('같은 입력이면 같은 structures 를 낸다', () => {
    const a = payloadFor(FIXTURES.straight);
    a.p.g('buildSets')().forEach((s) => a.p.g('autoCalcForSet')(s));
    const first = canonical(a.p.g('buildPlannerPayload')('PLANNER_STATE').structures);

    const b = payloadFor(FIXTURES.straight);
    b.p.g('buildSets')().forEach((s) => b.p.g('autoCalcForSet')(s));
    const second = canonical(b.p.g('buildPlannerPayload')('PLANNER_STATE').structures);

    expect(second).toBe(first);
  });
});
