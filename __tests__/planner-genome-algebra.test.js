/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 설계 유전체 — 대수적 연관분석 도구 (tools/genome/algebra.js).
 *
 * 1. 2×2 소행렬식 = LD 의 D · 정확검정 = Fisher 정확검정 · Markov 이동이 fiber 를 잇는다 (구조적 영 포함) · MCMC ≈ 전수
 * 2. Möbius 반전: zeta∘mobius = 항등, 2차 계수 = 로그 오즈비
 * 3. FCA: Duquenne–Guigues 기저가 성립하고 · 완전하고 · 군더더기가 없다, 배경 함의는 다시 내지 않는다
 * 4. 생성함수 계수 = 전수 열거
 */
const A = require('../tools/genome/algebra.js');
const G = require('../js/planner/planner-genome.js');

describe('대수통계', () => {
  test('2×2 소행렬식 = LD 의 D', () => {
    const t = [[40, 10], [10, 40]];
    const p = t.map((r) => r.map((v) => v / 100));
    expect(A.minor2x2(p)).toBeCloseTo(G.plannerGenomeLD(40, 10, 10, 40).D, 12);
  });

  test('2×2 정확검정 = Fisher 정확검정 (양측, 확률 기준)', () => {
    // [[3,1],[1,3]]: 초기하 1·16·36·16·1 / 70 → p = 34/70
    expect(A.exactTest([[3, 1], [1, 3]]).p).toBeCloseTo(34 / 70, 12);
  });

  test('기본 이동이 2×3 fiber 를 잇는다', () => {
    const t = [[2, 1, 0], [0, 1, 2]];
    const { rows, cols } = A.margins(t);
    const fiber = A.enumerateFiber(rows, cols);
    expect(A.reachable(t, A.markovMoves(2, 3)).length).toBe(fiber.length);
  });

  test('구조적 영이 있으면 기본 이동만으로는 끊기고, 차수 3 고리를 더하면 이어진다', () => {
    // 대각 칸이 금지된 3×3 (예: 같은 단에 같은 종류를 둘 수 없음) — 준독립 모형
    const zeros = [[true, false, false], [false, true, false], [false, false, true]];
    const t = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];
    const { rows, cols } = A.margins(t);
    const fiber = A.enumerateFiber(rows, cols, zeros);
    expect(fiber.length).toBe(2);
    expect(A.reachable(t, A.markovMoves(3, 3, zeros, { degree3: false })).length).toBe(1);
    expect(A.reachable(t, A.markovMoves(3, 3, zeros)).length).toBe(2);
  });

  test('Markov 연쇄 p값 ≈ 전수 p값', () => {
    const t = [[6, 2, 1], [1, 3, 5]];
    const exact = A.exactTest(t).p;
    const mc = A.exactTest(t, { enumerateMax: 0, iters: 60000, seed: 11 }).p;
    expect(Math.abs(mc - exact)).toBeLessThan(0.03);
  });

  test('Benjamini–Hochberg', () => {
    const r = A.benjaminiHochberg([0.01, 0.04, 0.03, 0.5], 0.1);
    expect(r.reject).toEqual([true, true, true, false]);
    expect(r.adjusted[0]).toBeCloseTo(0.04, 12);
  });
});

describe('Möbius 반전', () => {
  test('zeta∘mobius = 항등', () => {
    const f = [0.3, -1.2, 2.5, 0.7, 1.1, -0.4, 0.9, 3.3];
    A.zeta(A.mobius(f)).forEach((v, i) => expect(v).toBeCloseTo(f[i], 12));
  });
  test('두 이진 선택의 2차 계수 = 로그 오즈비, 독립이면 0', () => {
    // 비트 0 = 선택 1, 비트 1 = 선택 2 : counts[00, 10, 01, 11]
    const u = A.interactions([30, 10, 10, 50], 0);
    expect(u[3]).toBeCloseTo(Math.log((50 * 30) / (10 * 10)), 12);
    expect(A.interactions([20, 20, 20, 20], 0)[3]).toBeCloseTo(0, 12);
  });
  test('세 선택이 2차로 설명되면 3차 계수는 0', () => {
    // log p = a·x1 + b·x2 + c·x3 + d·x1x2 (3차 없음)
    const f = [];
    for (let m = 0; m < 8; m++) {
      const x = [m & 1, (m >> 1) & 1, (m >> 2) & 1];
      f.push(0.2 * x[0] - 0.5 * x[1] + 0.9 * x[2] + 1.3 * x[0] * x[1]);
    }
    const u = A.mobius(f);
    expect(u[3]).toBeCloseTo(1.3, 12);
    expect(u[7]).toBeCloseTo(0, 12);
  });
});

describe('형식 개념 분석', () => {
  // Ganter–Wille 의 행성 맥락
  const planets = [
    ['small', 'near', 'nomoon'], ['small', 'near', 'nomoon'], ['small', 'near', 'moon'], ['small', 'near', 'moon'],
    ['large', 'far', 'moon'], ['large', 'far', 'moon'], ['medium', 'far', 'moon'], ['medium', 'far', 'moon'], ['small', 'far', 'moon'],
  ];
  const ctx = A.context(planets);
  const subsets = (n) => Array.from({ length: 1 << n }, (_, m) => [...Array(n).keys()].filter((i) => m & (1 << i)));

  const basisIdx = (basis) => basis.map((r) => [r.premise.map((a) => ctx.idx.get(a)), r.conclusion.map((a) => ctx.idx.get(a))]);
  const complete = (L) => subsets(ctx.M.length).every((X) => A.implicationClosure(L, X).join() === A.closure(ctx, X).join());

  test('기저의 함의는 모두 성립한다', () => {
    A.stemBase(ctx).forEach((r) => expect(A.holds(ctx, r.premise, r.conclusion)).toBe(true));
  });
  test('완전하다 — 모든 X 에서 기저 닫힘 = 개념 닫힘', () => {
    expect(complete(basisIdx(A.stemBase(ctx)))).toBe(true);
  });
  test('군더더기가 없다 — 하나라도 빼면 완전하지 않다', () => {
    const L = basisIdx(A.stemBase(ctx));
    L.forEach((_, k) => expect(complete(L.filter((__, i) => i !== k))).toBe(false));
  });
  test('배경 함의는 다시 내지 않고, 기저 ∪ 배경 은 완전하다', () => {
    const bg = [[['nomoon'], ['near']], [['large'], ['far']]];
    const basis = A.stemBase(ctx, bg);
    const bgIdx = bg.map(([a, b]) => [a.map((x) => ctx.idx.get(x)), b.map((x) => ctx.idx.get(x))]);
    expect(complete(basisIdx(basis).concat(bgIdx))).toBe(true);
    basis.forEach((r) => {
      const fromBg = A.implicationClosure(bgIdx, r.premise.map((a) => ctx.idx.get(a)));
      expect(r.conclusion.every((c) => fromBg.indexOf(ctx.idx.get(c)) >= 0)).toBe(false);
    });
  });
  test('맥락에 없는 속성이 전제인 배경 함의는 버린다 (빈 전제로 줄어 언제나 발동하면 안 된다)', () => {
    const bg = [[['rice-cabinet'], ['far']]];   // 행성 맥락에 'rice-cabinet' 은 없다
    expect(A.backgroundIn(ctx, bg)).toEqual([]);
    expect(A.stemBase(ctx, bg)).toEqual(A.stemBase(ctx));
  });
  test('Luxenburger 부분 규칙 — 신뢰도 = 외연 비', () => {
    const rules = A.luxenburgerBase(ctx, { minConf: 0.1, minSupport: 1 });
    expect(rules.length).toBeGreaterThan(0);
    rules.forEach((r) => {
      const a = A.extentOf(ctx, r.premise.map((x) => ctx.idx.get(x))).length;
      const b = A.extentOf(ctx, r.premise.concat(r.conclusion).map((x) => ctx.idx.get(x))).length;
      expect(r.confidence).toBeCloseTo(b / a, 12);
      expect(r.confidence).toBeLessThan(1);
    });
  });
  test('개념 내포 수 = 닫힌 부분집합 수', () => {
    const closed = subsets(ctx.M.length).filter((X) => A.closure(ctx, X).join() === X.join());
    expect(A.allIntents(ctx).length).toBe(closed.length);
  });
});

describe('생성함수 — 벽 길이 맞추기', () => {
  const brute = (widths, L) => {
    if (L === 0) return 1;
    return widths.reduce((a, w) => a + (w <= L ? brute(widths, L - w) : 0), 0);
  };
  test('모듈 수 자유 — 폭 합이 L 인 열의 수', () => {
    const items = [{ W: 450 }, { W: 600 }, { W: 900 }];
    expect(A.sequenceCoefficient(items, 2700, 150)).toBe(brute([3, 4, 6], 18));
  });
  test('자리 수 고정 — 확률 질량', () => {
    const slots = [[{ W: 450, p: 0.5 }, { W: 600, p: 0.5 }], [{ W: 900, p: 0.7 }, { W: 450, p: 0.3 }], [{ W: 600, p: 1 }]];
    // 450+900+600 = 1950 (0.5·0.7) · 600+450+600 = 1650 (0.5·0.3)
    expect(A.slotsCoefficient(slots, 1950, 150)).toBeCloseTo(0.35, 12);
    expect(A.slotsCoefficient(slots, 1650, 150)).toBeCloseTo(0.15, 12);
  });
});
