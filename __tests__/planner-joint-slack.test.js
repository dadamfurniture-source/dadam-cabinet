/**
 * W12-73: 조립 여유 — 모듈 하나당 1mm.
 *
 *   모듈을 서로 결합하면 실제 길이가 조금씩 늘어난다. 그래서 모듈 수만큼은
 *   짧게 잘라도 자리가 채워진다. 그 여유 안이면 **잔여를 나눠 붙이지 않는다** —
 *   붙이면 어느 도어 하나가 커져 라인의 도어가 어긋난다.
 *
 *   예전 동작 두 가지가 도어를 어긋냈다.
 *     ① 잔여를 **모듈** 단위로 나눔 → 양문 모듈(도어 2장)의 도어가 더 작아진다
 *     ② 나머지를 마지막 모듈에 몰아넣음 → 도어 하나만 커진다
 */
const engine = require('../js/planner/planner-engine.js');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');
const R = engine.MASTER_RULES;

function boot(fx) {
  const s = Object.assign({}, seedFor(fx)); const search = s._search; delete s._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: s });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

describe('여유는 모듈 수만큼이다', () => {
  test('모듈 하나당 1mm', () => {
    expect(R.JOINT_SLACK_PER_MODULE).toBe(1);
    expect(engine.jointSlack(4)).toBe(4);
    expect(engine.jointSlack(1)).toBe(1);
    expect(engine.jointSlack(0)).toBe(0);
  });
});

describe('잔여는 도어 단위로 나눈다 — 모듈 단위가 아니다', () => {
  test('여유 안이면 아무 데도 안 붙인다', () => {
    // 모듈 3개(양문·양문·단문) → 여유 3mm. 잔여 2 는 그대로 둔다.
    expect(engine.spreadGapEqually(2, [2, 2, 1]))
      .toEqual({ add: [0, 0, 0], slack: 2, perDoor: 0 });
  });

  test('여유를 넘으면 **도어마다** 같은 값을 더한다', () => {
    // 도어 3장에 7 → 도어당 2 씩 (양문 +4, 단문 +2), 남은 1 은 여유(2) 안이라 둔다.
    expect(engine.spreadGapEqually(7, [2, 1]))
      .toEqual({ add: [4, 2], slack: 1, perDoor: 2 });
  });

  test('여유를 넘는 나머지만 마지막이 흡수한다', () => {
    // 도어 5장에 4 → 도어당 0, 남은 4 > 여유 3(모듈 3개) → 1 만 마지막이 먹는다.
    const r = engine.spreadGapEqually(4, [2, 2, 1]);
    expect(r.add).toEqual([0, 0, 1]);
    expect(r.slack).toBe(3);
  });

  test('예전처럼 모듈 단위로 나누지 않는다 — 그러면 양문 도어가 작아진다', () => {
    // 잔여 6, 모듈 3개. 예전: 모듈마다 +2 → 양문 도어 +1, 단문 도어 +2 (어긋남).
    // 지금: 도어 5장에 도어당 +1 → 양문 +2, 단문 +1. 모든 도어가 +1 로 같다.
    const r = engine.spreadGapEqually(6, [2, 2, 1]);
    expect(r.perDoor).toBe(1);
    expect(r.add).toEqual([2, 2, 1]);
    expect(r.slack).toBe(1);
  });

  test('잔여가 0 이면 아무 일도 없다', () => {
    expect(engine.spreadGapEqually(0, [2, 1])).toEqual({ add: [0, 0], slack: 0, perDoor: 0 });
  });
});

describe('멍장 라인 — 도어가 라인 전체에서 같다 (§3.4)', () => {
  test('여유 안의 잔여는 마지막 모듈에도 안 붙는다', () => {
    const d = engine.distributeByDoorW(1235, 411);
    expect(d.modules.map((m) => m.w)).toEqual([822, 411]);
    d.modules.forEach((m) => expect(m.w % 411).toBe(0));
    expect(d.slack).toBe(2);
  });

  test('여유를 넘으면 그 초과분만 마지막이 먹는다', () => {
    const d = engine.distributeByDoorW(830, 400);   // 모듈 1개 → 여유 1
    expect(d.slack).toBe(1);
    expect(d.modules[0].w).toBe(800 + 29);
  });
});

describe('실제 배치에서 도어가 어긋나지 않는다', () => {
  test('직선 라인의 모든 모듈이 도어 폭의 배수다', () => {
    const p = boot(FIXTURES.straight);
    p.g('autoCalcAllAreas')();
    p.g('areas').filter((a) => !a.isFinishing).forEach((a) => {
      const mods = p.g('modules').filter((m) => m.areaId === a.id && !m.isFinishing && !m.blind);
      if (mods.length < 2) return;
      // 모듈 폭은 도어 폭 또는 그 2배 — 두 값뿐이어야 한다.
      const ws = [...new Set(mods.map((m) => Math.round(m.W)))].sort((x, y) => x - y);
      expect(ws.length).toBeLessThanOrEqual(2);
      if (ws.length === 2) expect(ws[1]).toBe(ws[0] * 2);
    });
  });

  test('ㄱ자에서도 원장이 여유 안에 든다 — 경고가 뜨지 않는다', () => {
    const p = boot(FIXTURES.lShape);
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.map(String).join(' '));
    try { p.g('autoCalcAllAreas')(); } finally { console.warn = orig; }
    expect(warns.filter((w) => /원장 불일치/.test(w))).toEqual([]);
  });
});

describe('끝 기준선은 여유가 밀지 않는다', () => {
  test('꼬리는 벽에서 거꾸로 잰다 — §3.4 의 벽 여유 50 은 고정값이다', () => {
    const fs = require('fs');
    const path = require('path');
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8');
    expect(SRC).toContain('const tailAnchor =');
    const at = SRC.indexOf('function placeTail');
    expect(SRC.slice(at, at + 700)).toContain('edges.tailAnchor');
  });
});
