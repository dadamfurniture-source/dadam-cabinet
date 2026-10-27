/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 자동계산 도어 수 — 목표 450 근접 우선 (2026-10-27 사장님 "2072 … 도어가 5개, 몸통 2통 반이 맞다").
 *   W12-73 은 조립 여유(모듈 수 × 1mm) 안 후보를 먼저 봐서 빈 폭 2064 · 2069 · 2074 … 가 도어 4장(516 …)이 됐다.
 *   이제 450 근접 → 잔여 작은 → 도어 적은. 잔여는 그대로 spreadGapEqually (여유 안이면 두고, 넘는 만큼만 마지막 모듈).
 */
const engine = require('../js/planner/planner-engine.js');

const final = (w) => {
  const d = engine.distributeModules(w);
  const s = engine.spreadGapEqually(d.gap, d.modules.map((m) => m.doors));
  return { doors: d.doorCount, doorW: d.doorWidth, ws: d.modules.map((m, i) => m.w + s.add[i]), slack: s.slack };
};

describe('distributeModules — 목표 450 근접 우선', () => {
  test('2064 → 도어 5장 412 (2통 반), 잔여 4 = 조립 여유 3 + 마지막 모듈 1', () => {
    expect(final(2064)).toEqual({ doors: 5, doorW: 412, ws: [824, 824, 413], slack: 3 });
  });

  test.each([[2069], [2072], [2074]])('%i → 도어 5장 (예전엔 2069 · 2074 가 도어 4장)', (w) => {
    expect(final(w).doors).toBe(5);
  });

  test('목표에 딱 맞는 폭은 그대로 — 1800 → 450 × 4 · 900 → 450 × 2', () => {
    expect(final(1800)).toEqual({ doors: 4, doorW: 450, ws: [900, 900], slack: 0 });
    expect(final(900)).toEqual({ doors: 2, doorW: 450, ws: [900], slack: 0 });
  });

  test('합은 빈 폭에서 조립 여유만큼만 모자란다 (모듈 수 × 1mm 이하)', () => {
    for (let w = 1000; w <= 4000; w += 7) {
      const f = final(w);
      const sum = f.ws.reduce((a, b) => a + b, 0);
      expect([w, w - sum <= f.ws.length && w - sum >= 0]).toEqual([w, true]);
    }
  });
});
