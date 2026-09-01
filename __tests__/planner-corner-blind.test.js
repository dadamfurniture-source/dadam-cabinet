/**
 * W12-49: ㄱ자 코너 → 멍장 자동 생성.
 *
 * 배치 단계는 라인을 선언하지 않는다. 사각형과 회전만 넘어오므로 코너를
 * **기하에서** 찾아야 한다. 이 테스트가 지키는 계약:
 *
 *   1) 순수 계산이 corner.md §3.4 의 확정 예시 두 개를 재현한다
 *   2) 레거시 `corner-engine.deriveCorner` 와 같은 값을 낸다 (두 경로가 갈라지면 잡는다)
 *   3) ㄱ자를 그리면 자동계산이 멍장을 만든다 — 트리밍 유무와 무관하게
 *   4) 원장이 맞는다 (Σ모듈 + 코너가 먹는 자리 === 배치 공간 폭)
 *   5) 코너가 없으면 **아무 일도 하지 않는다**
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const engine = require('../js/planner/planner-engine.js');
const { bootPlanner } = require('../test-utils/planner-harness');

// ─────────────────────────────────────────────────────────────
// 1. 순수 계산
// ─────────────────────────────────────────────────────────────
describe('deriveCornerArea — corner.md §3.4 확정 예시', () => {
  test('하부 1970 = EP 20 + 790 + 멍장 1110 + 여유 50', () => {
    const r = engine.deriveCornerArea({ ownerW: 1970, ownerD: 650, adjD: 650, epW: 20 });
    expect(r.ok).toBe(true);
    expect(r.blindZoneW).toBe(715);      // 650 − 10 + 60 + 목대 15
    expect(r.nDoors).toBe(3);
    expect(r.doorW).toBe(395);
    expect(r.blindW).toBe(1110);         // 멍 715 + 도어 395
    expect(r.restBudget).toBe(790);
    // offset 에는 목대가 안 붙는다 (W12-54)
    expect(r.adjStartOffset).toBe(700);
    expect(20 + r.restBudget + r.blindW + 50).toBe(1970);
  });

  test('상부 1800 = EP 20 + 890 + 멍장 840 + 여유 50', () => {
    const r = engine.deriveCornerArea({ ownerW: 1800, ownerD: 320, adjD: 320, epW: 20, isUpper: true });
    expect(r.blindZoneW).toBe(395);      // 320 + 60 + 목대 15, 물끊기 없음
    expect(r.doorW).toBe(445);
    expect(r.blindW).toBe(840);
    expect(20 + r.restBudget + r.blindW + 50).toBe(1800);
  });

  test('멍이 라인을 다 먹으면 만들지 않는다 (반쯤 세우지 않는다)', () => {
    const r = engine.deriveCornerArea({ ownerW: 700, ownerD: 650, adjD: 650, epW: 20 });
    expect(r.ok).toBe(false);
    // 최소 도어 한 장까지 들어가려면 얼마가 필요한지 말해 준다
    expect(r.minOwnerW).toBe(20 + 50 + 715 + 350);
  });

  test('도어 한 장도 최소폭 미달이면 경고를 남기고 진행한다', () => {
    const r = engine.deriveCornerArea({ ownerW: 1000, ownerD: 650, adjD: 650, epW: 20 });
    expect(r.ok).toBe(true);
    expect(r.nDoors).toBe(1);
    expect(r.doorW).toBe(215);           // 1000 − 20 − 50 − 715
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  test('몰딩을 바꾸면 멍과 도어가 함께 움직인다', () => {
    const a = engine.deriveCornerArea({ ownerW: 1970, ownerD: 650, adjD: 650, epW: 20 });
    const b = engine.deriveCornerArea({ ownerW: 1970, ownerD: 650, adjD: 650, epW: 20, molding: 100 });
    expect(b.blindZoneW).toBe(a.blindZoneW + 40);
    expect(b.blindW).not.toBe(a.blindW);
  });
});

describe('distributeByDoorW — 라인 전체가 같은 도어 폭 (§3.4)', () => {
  test('800 을 도어 400 으로 나누면 양문 한 짝', () => {
    const d = engine.distributeByDoorW(800, 400);
    expect(d.modules).toEqual([{ doors: 2, w: 800, is2D: true }]);
  });

  test('도어 3장이면 양문 + 단문', () => {
    const d = engine.distributeByDoorW(1200, 400);
    expect(d.modules.map((m) => m.doors)).toEqual([2, 1]);
  });

  test('잔여는 마지막이 흡수하고 gap 을 0 으로 돌려준다 (두 번 더해지지 않게)', () => {
    const d = engine.distributeByDoorW(830, 400);
    expect(d.gap).toBe(0);
    expect(d.remainder).toBe(30);
    expect(d.modules.reduce((s, m) => s + m.w, 0)).toBe(830);
  });

  test('도어 한 장도 안 들어가면 빈 결과', () => {
    expect(engine.distributeByDoorW(300, 400).modules).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. 레거시 대조 — 두 엔진이 갈라지면 여기서 잡힌다
// ─────────────────────────────────────────────────────────────
describe('레거시 corner-engine 과 같은 값을 낸다', () => {
  /** corner-engine.js 는 브라우저 클래식 스크립트라 vm 으로 평가한다 */
  const legacy = (() => {
    const src = fs.readFileSync(path.join(ROOT, 'js/detaildesign/corner-engine.js'), 'utf8');
    const ctx = { window: {}, console };
    vm.createContext(ctx);
    vm.runInContext(src + '\n;this.deriveCorner = deriveCorner;', ctx);
    return ctx.deriveCorner;
  })();

  const CASES = [
    { name: '하부 1970/650', lineW: 1970, adjTopD: 650, blindLineTopD: 650, isUpper: false },
    { name: '하부 2400/600', lineW: 2400, adjTopD: 600, blindLineTopD: 600, isUpper: false },
    { name: '하부 1500/700', lineW: 1500, adjTopD: 700, blindLineTopD: 700, isUpper: false },
    { name: '상부 1800/320', lineW: 1800, adjTopD: 320, blindLineTopD: 320, isUpper: true },
  ];

  test.each(CASES)('$name', (c) => {
    const old = legacy({
      lineW: c.lineW, adjTopD: c.adjTopD, blindLineTopD: c.blindLineTopD, isUpper: c.isUpper,
    });
    const now = engine.deriveCornerArea({
      ownerW: c.lineW, adjD: c.adjTopD, ownerD: c.blindLineTopD, isUpper: c.isUpper, epW: 20,
    });
    expect(now.blindZoneW).toBe(old.blindZoneW);
    expect(now.doorW).toBe(old.doorW);
    expect(now.nDoors).toBe(old.nDoors);
    expect(now.blindW).toBe(old.blindW);
    expect(now.adjStartOffset).toBe(old.adjStartOffset);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. 페이지 전체 — ㄱ자를 실제로 부팅해 자동계산한다
// ─────────────────────────────────────────────────────────────
const LOWER_D = 650;

/**
 * ㄱ자 배치. 가로 다리는 회전 0, 세로 다리는 회전 90 —
 * 배치 단계가 주벽면을 0 으로 두고 꺾여 나가는 쪽에 회전을 주는 규약 그대로다.
 *
 * @param {boolean} trimmed 세로 다리를 가로 다리에 맞춰 잘라 두었는가
 */
function lShapeLayout(trimmed) {
  const modules = [
    // 가로 다리 — 벽을 따라 X 로 뻗는다
    { section: 'lower', x: 0, y: 0, w: 3600, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
  ];
  // 세로 다리 — 회전 90. 저장되는 것은 회전 **전** 좌표다 (W12-36).
  // 트리밍하면 가로 다리 깊이만큼 짧아지고 그만큼 밀려난다.
  const legW = trimmed ? 1970 - LOWER_D : 1970;
  const cy = trimmed ? LOWER_D + legW / 2 : legW / 2;
  modules.push({
    section: 'lower',
    x: LOWER_D / 2 - legW / 2, y: cy - LOWER_D / 2,
    w: legW, h: LOWER_D, moduleH: 870, rotation: 90, finishings: [],
  });
  return { version: 1, savedAt: '2026-08-31T00:00:00.000Z', person: null, modules };
}

function boot(layout) {
  const key = 'dadam_layout_v1::d1:1';
  const p = bootPlanner('mockup-structure.html', {
    search: '?design=d1&item=1',
    storage: { [key]: JSON.stringify(layout) },
  });
  if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

/** 자동계산 후의 배치 공간별 모듈 목록 */
function summarize(p) {
  const areas = p.g('areas') || [];
  const modules = p.g('modules') || [];
  return areas.filter((a) => !a.isFinishing).map((a) => ({
    id: a.id,
    W: a.W,
    rotation: a.rotation || 0,
    mods: modules.filter((m) => m.areaId === a.id)
      .map((m) => ({ id: m.id, W: m.W, x: m.x, isFixed: !!m.isFixed, blind: m.blind || null })),
  }));
}

describe('ㄱ자를 그리면 자동계산이 멍장을 만든다', () => {
  test('코너 쌍을 하나 찾는다', () => {
    const p = boot(lShapeLayout(false));
    const pairs = p.g('cornerPairs')();
    expect(pairs.length).toBe(1);
    // 꺾여 나간(회전한) 다리가 멍장 주인이다
    expect(pairs[0].owner.rotation).toBe(90);
    expect(pairs[0].adj.rotation).toBe(0);
  });

  test('자동계산이 멍장 하나를 세운다', () => {
    const p = boot(lShapeLayout(false));
    p.g('autoCalcAllAreas')();
    const blind = (p.g('modules') || []).filter((m) => m.blind);
    expect(blind.length).toBe(1);
    expect(blind[0].isFixed).toBe(true);
    expect(blind[0].W).toBe(blind[0].blind.zoneW + blind[0].blind.doorW);
  });

  test('멍장 정면은 먹장 + 도어 두 칸이다 (도어 폭이 카카스 폭이 아니다)', () => {
    const p = boot(lShapeLayout(false));
    p.g('autoCalcAllAreas')();
    const blind = (p.g('modules') || []).find((m) => m.blind);
    const s = (p.g('structures') || {})[blind.id];
    expect(s.verticalCount).toBe(2);
    expect(s.areaTypes.slice().sort()).toEqual(['blank', 'door']);
    // 도어 칸은 doorW, 먹장 칸은 멍 — 합이 카카스 폭
    expect(s.areaWidths.reduce((a, b) => a + b, 0)).toBe(blind.W);
    expect(s.areaWidths).toContain(blind.blind.doorW);
    expect(blind.blind.doorW).toBeLessThan(blind.W);
  });

  test('원장이 맞는다 — 두 배치 공간 모두 ±1', () => {
    const p = boot(lShapeLayout(false));
    p.g('autoCalcAllAreas')();
    const pairs = p.g('cornerPairs')();
    const ledger = p.g('cornerLedger');
    [pairs[0].owner.id, pairs[0].adj.id].forEach((id) => {
      const L = ledger(id);
      expect(L).not.toBeNull();
      expect(Math.abs(L.diff)).toBeLessThanOrEqual(1);
    });
  });

  test('인접 다리는 코너에서 밀려 시작한다 (§3.7)', () => {
    const p = boot(lShapeLayout(false));
    p.g('autoCalcAllAreas')();
    const pairs = p.g('cornerPairs')();
    const off = p.g('adjCornerOffsetOf')(pairs[0].adj.id);
    expect(off.offset).toBe(LOWER_D - 10 + 60);   // 700
    const adjMods = (p.g('modules') || []).filter((m) => m.areaId === pairs[0].adj.id);
    const first = adjMods.slice().sort((a, b) => a.x - b.x)[0];
    const adjArea = pairs[0].adj;
    const startGap = first.x - (adjArea.x || 0);
    const endGap = ((adjArea.x || 0) + adjArea.W) - (first.x + adjMods.reduce((s, m) => s + m.W, 0));
    // 어느 쪽 끝이 코너든, 밀려난 거리가 한쪽에 통째로 남아 있어야 한다
    expect(Math.max(startGap, endGap)).toBeCloseTo(off.offset, 0);
  });

  test('멍장 라인의 도어 폭이 라인 전체에 하나로 묶인다 (§3.4)', () => {
    const p = boot(lShapeLayout(false));
    p.g('autoCalcAllAreas')();
    const pairs = p.g('cornerPairs')();
    const all = p.g('modules') || [];
    const blind = all.find((m) => m.blind);
    const doorW = blind.blind.doorW;
    const storage = all
      .filter((m) => m.areaId === pairs[0].owner.id && !m.blind && !m.isFinishing)
      .sort((a, b) => a.x - b.x);

    expect(storage.length).toBeGreaterThan(0);
    // 마지막을 뺀 모듈은 도어 폭의 **정확한 배수**다 — 폭이 아니라 도어 장수를 나눴다
    storage.slice(0, -1).forEach((m) => expect(m.W % doorW).toBe(0));
    // 잔여는 마지막 하나만 흡수한다 (도어 한 장보다 작다)
    expect(storage[storage.length - 1].W % doorW).toBeLessThan(doorW);
    // 합은 언제나 배치 공간 폭 — 멍장 + 수납 + 코너 벽 여유 50
    const sum = storage.reduce((s, m) => s + m.W, 0) + blind.W + 50;
    expect(sum).toBe(pairs[0].owner.W);
  });

  test('트리밍한 ㄱ자와 안 한 ㄱ자가 같은 멍장을 낸다', () => {
    const a = boot(lShapeLayout(false));
    a.g('autoCalcAllAreas')();
    const b = boot(lShapeLayout(true));
    b.g('autoCalcAllAreas')();
    const pick = (p) => {
      const m = (p.g('modules') || []).find((x) => x.blind);
      return m ? { zoneW: m.blind.zoneW, doorW: m.blind.doorW } : null;
    };
    expect(pick(a)).not.toBeNull();
    expect(pick(b)).not.toBeNull();
    expect(pick(b).zoneW).toBe(pick(a).zoneW);
  });

  test('두 번 돌려도 멍장이 하나다 (멱등)', () => {
    const p = boot(lShapeLayout(false));
    p.g('autoCalcAllAreas')();
    const first = summarize(p);
    p.g('autoCalcAllAreas')();
    expect((p.g('modules') || []).filter((m) => m.blind).length).toBe(1);
    expect(summarize(p)).toEqual(first);
  });
});

// ─────────────────────────────────────────────────────────────
// 4. ㄷ자 — 코너 둘, 가운데 다리가 양쪽 주인
// ─────────────────────────────────────────────────────────────

/**
 * ㄷ자. 가로(위) · 세로(왼쪽) · 가로(아래) — 세로만 회전 90.
 * 가운데(세로) 다리는 **양끝이 모두 코너**라 멍장을 둘 갖는다.
 */
function uShapeLayout(legW) {
  return {
    version: 1, savedAt: '2026-08-31T00:00:00.000Z', person: null,
    modules: [
      { section: 'lower', x: 0, y: 0, w: 3600, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
      { section: 'lower', x: LOWER_D / 2 - legW / 2, y: legW / 2 - LOWER_D / 2,
        w: legW, h: LOWER_D, moduleH: 870, rotation: 90, finishings: [] },
      { section: 'lower', x: 0, y: legW - LOWER_D, w: 3000, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
    ],
  };
}

describe('deriveCornerArea — 코너 둘', () => {
  test('양끝에서 멍과 벽 여유가 각각 빠진다', () => {
    const r = engine.deriveCornerArea({ ownerW: 2800, ownerD: 650, adjDs: [650, 650], epW: 0 });
    expect(r.ok).toBe(true);
    expect(r.corners).toBe(2);
    expect(r.blindZoneWs).toEqual([715, 715]);
    // 2800 − 여유 50×2 − 멍 715×2 = 1270 → 3장 → 423
    expect(r.doorW).toBe(423);
    expect(r.blindWs).toEqual([1138, 1138]);
    // 원장: 50 + 멍장 + 수납 + 멍장 + 50
    expect(50 + r.blindWs[0] + r.restBudget + r.blindWs[1] + 50).toBe(2800);
  });

  test('멍 둘이 라인을 다 먹으면 만들지 않는다', () => {
    const r = engine.deriveCornerArea({ ownerW: 1500, ownerD: 650, adjDs: [650, 650], epW: 0 });
    expect(r.ok).toBe(false);
    expect(r.minOwnerW).toBe(50 * 2 + 715 * 2 + 350 * 2);   // 2230
  });

  test('코너가 하나면 예전과 같은 값이다 (회귀)', () => {
    const one = engine.deriveCornerArea({ ownerW: 1970, ownerD: 650, adjD: 650, epW: 20 });
    const arr = engine.deriveCornerArea({ ownerW: 1970, ownerD: 650, adjDs: [650], epW: 20 });
    expect(arr.blindWs).toEqual([one.blindW]);
    expect(arr.doorW).toBe(one.doorW);
    expect(arr.restBudget).toBe(one.restBudget);
  });
});

describe('ㄷ자를 그리면 멍장이 둘 선다', () => {
  test('코너 쌍이 둘이고, 가운데 다리가 둘 다의 주인이다', () => {
    const p = boot(uShapeLayout(2800));
    const pairs = p.g('cornerPairs')();
    expect(pairs.length).toBe(2);
    const owners = pairs.map((c) => c.owner.id);
    expect(new Set(owners).size).toBe(1);              // 주인이 하나로 모인다
    expect(pairs.every((c) => c.owner.rotation === 90)).toBe(true);
  });

  test('멍장이 둘이고 양끝에 하나씩 앉는다', () => {
    const p = boot(uShapeLayout(2800));
    p.g('autoCalcAllAreas')();
    const blinds = (p.g('modules') || []).filter((m) => m.blind);
    expect(blinds.length).toBe(2);
    const owner = p.g('cornerPairs')()[0].owner;
    const xs = blinds.map((m) => m.x).sort((a, b) => a - b);
    // 하나는 시작에서 벽 여유 50 뒤, 하나는 끝에서 멍장 폭 + 50 앞
    expect(xs[0]).toBe(owner.x + 50);
    expect(xs[1] + blinds[1].W).toBe(owner.x + owner.W - 50);
  });

  test('두 멍장은 상대 공간이 다르고 도어 폭은 하나로 묶인다', () => {
    const p = boot(uShapeLayout(2800));
    p.g('autoCalcAllAreas')();
    const blinds = (p.g('modules') || []).filter((m) => m.blind);
    expect(new Set(blinds.map((m) => m.blind.adjAreaId)).size).toBe(2);
    expect(blinds[0].blind.doorW).toBe(blinds[1].blind.doorW);   // §3.4
  });

  test('원장이 셋 다 맞고 빠진 멍장이 없다', () => {
    const p = boot(uShapeLayout(2800));
    p.g('autoCalcAllAreas')();
    const ledgers = (p.g('areas') || []).filter((a) => !a.isFinishing)
      .map((a) => p.g('cornerLedger')(a.id)).filter(Boolean);
    expect(ledgers.length).toBe(3);
    ledgers.forEach((L) => {
      expect(Math.abs(L.diff)).toBeLessThanOrEqual(1);
      expect(L.missing).toBe(0);
    });
    // 가운데 다리는 코너 둘 · 멍장 둘 · 벽 여유 둘
    const mid = ledgers.find((L) => L.corners === 2);
    expect(mid).toBeTruthy();
    expect(mid.blinds).toBe(2);
    expect(mid.reserved).toBe(100);
  });

  test('바깥 두 다리는 각각 코너에서 밀려 시작한다', () => {
    const p = boot(uShapeLayout(2800));
    p.g('autoCalcAllAreas')();
    const pairs = p.g('cornerPairs')();
    pairs.forEach((c) => {
      const off = p.g('adjCornerOffsetOf')(c.adj.id);
      expect(off.offset).toBe(LOWER_D - 10 + 60);       // 700
    });
  });

  test('배치 공간끼리 겹치지 않는다', () => {
    const p = boot(uShapeLayout(2800));
    p.g('autoCalcAllAreas')();
    expect(p.g('crossAreaOverlaps')()).toEqual([]);
  });

  test('멍장 둘을 목록에서 가를 수 있다', () => {
    // 폭·높이·깊이가 같아 이름이 겹치면 어느 코너를 고쳤는지 알 수 없다.
    const p = boot(uShapeLayout(2800));
    p.g('autoCalcAllAreas')();
    const tag = p.g('moduleTag');
    const tags = (p.g('modules') || []).filter((m) => m.blind).map(tag);
    expect(new Set(tags).size).toBe(2);
    // 화면 순서(왼→오)와 번호가 같아야 한다
    const sorted = (p.g('modules') || []).filter((m) => m.blind)
      .sort((a, b) => a.x - b.x).map(tag);
    expect(sorted).toEqual(['멍장 1', '멍장 2']);
  });

  test('멍장이 하나면 번호를 붙이지 않는다', () => {
    const p = boot(lShapeLayout(false));
    p.g('autoCalcAllAreas')();
    const blind = (p.g('modules') || []).find((m) => m.blind);
    expect(p.g('moduleTag')(blind)).toBe('멍장');
  });

  test('두 번 돌려도 멍장이 둘이다 (멱등)', () => {
    const p = boot(uShapeLayout(2800));
    p.g('autoCalcAllAreas')();
    const first = summarize(p);
    p.g('autoCalcAllAreas')();
    expect((p.g('modules') || []).filter((m) => m.blind).length).toBe(2);
    expect(summarize(p)).toEqual(first);
  });

  test('가운데 다리가 좁으면 멍장을 세우지 않는다', () => {
    // 멍 700 이 둘이면 벽 여유까지 2200mm 가 필요하다. 1500 은 도어가 한 장도 안 남는다.
    const p = boot(uShapeLayout(1500));
    expect(p.g('cornerPairs')().length).toBe(2);
    p.g('autoCalcAllAreas')();
    expect((p.g('modules') || []).filter((m) => m.blind).length).toBe(0);
  });
});

describe('불변식이 헛돌지 않는다', () => {
  test('멍장이 하나 빠지면 원장이 잡는다 — 합만으로는 못 잡는다', () => {
    const p = boot(uShapeLayout(2800));
    p.g('autoCalcAllAreas')();
    const mods = p.g('modules');
    const victim = mods.findIndex((m) => m.blind);
    const gone = mods[victim];
    mods.splice(victim, 1);
    const L = p.g('cornerLedger')(gone.areaId);
    expect(L.missing).toBe(1);          // ← 이것이 ㄷ자에서 실제로 났던 결함이다
    expect(L.corners).toBe(2);
    expect(L.blinds).toBe(1);
  });

  test('인접 다리를 코너까지 당기면 평면 검사가 겹침을 잡는다', () => {
    // 코너 규칙이 없던 예전 상태를 손으로 만든다 — 멍장 자리로 파고든다.
    const p = boot(uShapeLayout(2800));
    p.g('autoCalcAllAreas')();
    expect(p.g('crossAreaOverlaps')()).toEqual([]);

    const area = p.g('areaById')('area-lower-0');
    let x = area.x;
    (p.g('modules') || []).filter((m) => m.areaId === area.id)
      .forEach((m) => { m.x = x; x += m.W; });

    const hits = p.g('crossAreaOverlaps')();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].ox).toBeGreaterThan(1);
    expect(hits[0].oy).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────
// 5. 상부장 코너 — 물끊기가 없고 멍이 320 + 몰딩이다 (§3.6)
// ─────────────────────────────────────────────────────────────
const UPPER_D = 320;

/**
 * 상부장 ㄱ자. `y` 를 주면 그 자리에 그린다 —
 * 하부장과 같은 자리에 겹쳐 그리는 것이 실제 주방이다 (상부장은 위에 매달린다).
 */
function upperLShapeLayout(y) {
  const legW = 1800;
  const y0 = y || 0;
  return [
    { section: 'upper', x: 0, y: y0, w: 3000, h: UPPER_D, moduleH: 800, rotation: 0, finishings: [] },
    { section: 'upper',
      x: UPPER_D / 2 - legW / 2, y: y0 + legW / 2 - UPPER_D / 2,
      w: legW, h: UPPER_D, moduleH: 800, rotation: 90, finishings: [] },
  ];
}

function layoutOf(modules) {
  return { version: 1, savedAt: '2026-08-31T00:00:00.000Z', person: null, modules };
}

describe('상부장 ㄱ자 — 멍이 320 + 몰딩이다', () => {
  test('상부장끼리도 코너를 이룬다', () => {
    const p = boot(layoutOf(upperLShapeLayout(2000)));
    const pairs = p.g('cornerPairs')();
    expect(pairs.length).toBe(1);
    expect(p.g('areaTier')(pairs[0].owner)).toBe('hung');
    expect(pairs[0].owner.rotation).toBe(90);
  });

  test('멍은 395 이다 — 물끊기를 빼지 않고 목대 15 를 더한다', () => {
    const p = boot(layoutOf(upperLShapeLayout(2000)));
    p.g('autoCalcAllAreas')();
    const blind = (p.g('modules') || []).find((m) => m.blind);
    expect(blind).toBeTruthy();
    // 320(몸통295+도어18→관례) + 마감재 60 + 목대 15. 하부의 −10 이 없다.
    expect(blind.blind.zoneW).toBe(UPPER_D + 60 + 15);
    expect(blind.W).toBe(blind.blind.zoneW + blind.blind.doorW);
  });

  test('인접 다리는 380 만큼 밀린다 — 목대는 안 붙는다 (W12-54)', () => {
    const p = boot(layoutOf(upperLShapeLayout(2000)));
    p.g('autoCalcAllAreas')();
    const pair = p.g('cornerPairs')()[0];
    // 하부라면 320 − 10 + 60 = 370 이었을 자리다
    expect(p.g('adjCornerOffsetOf')(pair.adj.id).offset).toBe(380);
  });

  test('원장이 맞고 빠진 멍장이 없다', () => {
    const p = boot(layoutOf(upperLShapeLayout(2000)));
    p.g('autoCalcAllAreas')();
    const ledgers = (p.g('areas') || []).filter((a) => !a.isFinishing)
      .map((a) => p.g('cornerLedger')(a.id)).filter(Boolean);
    expect(ledgers.length).toBe(2);
    ledgers.forEach((L) => {
      expect(Math.abs(L.diff)).toBeLessThanOrEqual(1);
      expect(L.missing).toBe(0);
    });
  });
});

describe('상부장과 하부장은 서로의 코너에 끼어들지 않는다', () => {
  /** 실제 주방 — 하부 ㄱ자 위에 상부 ㄱ자가 같은 자리로 얹힌다 */
  function bothTiers() {
    return layoutOf(lShapeLayout(false).modules.concat(upperLShapeLayout(0)));
  }

  test('코너가 단마다 하나씩, 둘이다', () => {
    const pairs = boot(bothTiers()).g('cornerPairs')();
    expect(pairs.length).toBe(2);
    const tiers = pairs.map((c) => boot(bothTiers()).g('areaTier')(c.owner));
    expect(new Set(pairs.map((c) => c.owner.section))).toEqual(new Set(['lower', 'upper']));
    expect(tiers.length).toBe(2);
  });

  test('멍이 단마다 다르다 — 하부 715 · 상부 395', () => {
    const p = boot(bothTiers());
    p.g('autoCalcAllAreas')();
    const zones = (p.g('modules') || []).filter((m) => m.blind)
      .map((m) => m.blind.zoneW).sort((a, b) => a - b);
    expect(zones).toEqual([UPPER_D + 60 + 15, LOWER_D - 10 + 60 + 15]);   // [395, 715]
  });

  test('상부장이 하부장 위에 얹혀도 겹침으로 세지 않는다', () => {
    // 단을 안 가르면 상·하부가 통째로 겹침이 된다 — 실제로 9건 나왔었다.
    const p = boot(bothTiers());
    p.g('autoCalcAllAreas')();
    expect(p.g('crossAreaOverlaps')()).toEqual([]);
  });

  test('같은 단끼리는 여전히 잡는다 (단 구분이 검사를 무디게 하지 않았다)', () => {
    const p = boot(bothTiers());
    p.g('autoCalcAllAreas')();
    // 하부 인접 다리를 코너까지 당긴다 — 같은 단이므로 잡혀야 한다
    const area = p.g('areaById')('area-lower-0');
    let x = area.x;
    (p.g('modules') || []).filter((m) => m.areaId === area.id)
      .forEach((m) => { m.x = x; x += m.W; });
    const hits = p.g('crossAreaOverlaps')();
    expect(hits.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 6. BOM 으로 나가는 길 — 멍장은 한 모듈이다
// ─────────────────────────────────────────────────────────────
describe('멍장 → BOM 변환', () => {
  /** ui-step1.js 는 전역 스크립트라 import 할 수 없다 — 순수 블록만 잘라 평가한다 */
  const convert = (() => {
    const src = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
    const block = src.slice(
      src.indexOf('const PLANNER_CABINET_SECTIONS'),
      src.indexOf('function _applyPlannerResult')
    );
    // eslint-disable-next-line no-new-func
    return new Function(`${block}; return _convertPlannerModules;`)();
  })();

  /** 실제 플래너를 돌려 나온 payload 를 그대로 쓴다 — 손으로 지어내지 않는다 */
  function payloadOf(layout) {
    const p = boot(layout);
    p.g('autoCalcAllAreas')();
    return p.g('buildPlannerPayload')('PLANNER_DONE');
  }

  test('payload 가 멍장의 파생값을 싣는다', () => {
    const pay = payloadOf(lShapeLayout(false));
    const blind = pay.modules.filter((m) => m.blind);
    expect(blind.length).toBe(1);
    expect(blind[0].blind.zoneW).toBe(715);
    expect(blind[0].blind.doorW).toBeGreaterThan(0);
  });

  test('멍장이 셀로 쪼개지지 않고 한 모듈로 나간다', () => {
    const pay = payloadOf(lShapeLayout(false));
    const src = pay.modules.find((m) => m.blind);
    const out = convert(pay, {}).modules;
    const made = out.filter((m) => m.name === 'LT망장');
    expect(made.length).toBe(1);
    // 카카스 폭 그대로 — 도어 폭(406)으로 줄어들면 700mm 를 덜 발주한다
    expect(made[0].w).toBe(src.W);
    expect(made[0].doorCount).toBe(1);
  });

  test('먹장 칸을 잔여로 버리지 않는다', () => {
    const out = convert(payloadOf(lShapeLayout(false)), {});
    // 예전엔 멍 700 이 '350mm 미만 잔여' 로 빠지면서 이 경고가 떴다
    expect(out.warnings.join(' ')).not.toMatch(/잔여/);
  });

  test('BOM 이 알아보는 id 와 이름으로 나간다 (extractors.js W10-4)', () => {
    const out = convert(payloadOf(lShapeLayout(false)), {}).modules;
    const blind = out.find((m) => m.name === 'LT망장');
    expect(blind.id).toBe('corner-blind-lower');
    expect(blind.pos).toBe('lower');
  });

  test('도어 폭과 멍 폭을 따로 싣는다 — 도어를 카카스 폭으로 발주하면 안 된다', () => {
    const pay = payloadOf(lShapeLayout(false));
    const src = pay.modules.find((m) => m.blind);
    const blind = convert(pay, {}).modules.find((m) => m.name === 'LT망장');
    expect(blind.doorW).toBe(src.blind.doorW);
    expect(blind.blindZoneW).toBe(715);
    expect(blind.doorW).toBeLessThan(blind.w);        // 도어 < 카카스
    expect(blind.doorW + blind.blindZoneW).toBe(blind.w);
  });

  test('상부장 멍장도 같은 길로 나간다', () => {
    const out = convert(payloadOf(layoutOf(upperLShapeLayout(2000))), {}).modules;
    const blind = out.find((m) => m.name === 'LT망장');
    expect(blind.id).toBe('corner-blind-upper');
    expect(blind.pos).toBe('upper');
    expect(blind.blindZoneW).toBe(UPPER_D + 60 + 15);      // 395
  });

  test('ㄷ자는 멍장 둘이 서로 다른 id 로 나간다', () => {
    const out = convert(payloadOf(uShapeLayout(2800)), {}).modules;
    const blinds = out.filter((m) => m.name === 'LT망장');
    expect(blinds.length).toBe(2);
    expect(new Set(blinds.map((m) => m.id)).size).toBe(2);
    // 첫째는 extractors.js 가 지금도 알아보는 id 다
    expect(blinds.map((m) => m.id)).toContain('corner-blind-lower');
  });

  test('코너가 없으면 LT망장이 나오지 않는다 (회귀)', () => {
    const straight = layoutOf([
      { section: 'lower', x: 0, y: 0, w: 2400, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
    ]);
    const out = convert(payloadOf(straight), {}).modules;
    expect(out.filter((m) => m.name === 'LT망장')).toEqual([]);
    expect(out.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 7. 한 벽면을 배치 공간 여러 개로 쪼갠 경우
// ─────────────────────────────────────────────────────────────

/**
 * **배치 공간 = 라인**이다 (2026-09-01 확정). 한 벽면에 배치 공간을 여러 개
 * 두면 그 벽면에 라인이 여러 개 있는 것이고, 도어 균등 분배(§3.4)는
 * **배치 공간 단위**로 돈다 — 벽면 단위가 아니다.
 *
 * 그래서 같은 벽면이라도 배치 공간이 다르면 도어 폭이 다를 수 있다.
 * 규칙대로다. 코너는 실제로 맞닿은 배치 공간 하나에만 걸린다.
 */
function splitWallLayout() {
  const legW = 1970;
  return layoutOf([
    // 위 벽면 — 배치 공간 둘로 쪼갠다
    { section: 'lower', x: 0, y: 0, w: 1600, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
    { section: 'lower', x: 1600, y: 0, w: 2000, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
    // 왼 벽면 — 코너를 이룬다
    { section: 'lower', x: LOWER_D / 2 - legW / 2, y: legW / 2 - LOWER_D / 2,
      w: legW, h: LOWER_D, moduleH: 870, rotation: 90, finishings: [] },
  ]);
}

describe('한 벽면에 배치 공간이 여러 개여도 된다', () => {
  test('코너는 실제로 맞닿은 배치 공간 하나에만 걸린다', () => {
    const p = boot(splitWallLayout());
    const pairs = p.g('cornerPairs')();
    expect(pairs.length).toBe(1);
    expect(pairs[0].owner.rotation).toBe(90);
    // 같은 벽면의 다른 배치 공간(코너에서 먼 쪽)은 코너가 아니다
    const far = p.g('areas').find((a) => (a.rotation || 0) === 0 && a.x > 0);
    expect(far).toBeTruthy();
    expect(pairs[0].adj.id).not.toBe(far.id);
  });

  test('같은 벽면이라도 코너에 안 닿은 배치 공간은 밀리지 않는다', () => {
    const p = boot(splitWallLayout());
    p.g('autoCalcAllAreas')();
    const pairs = p.g('cornerPairs')();
    const far = p.g('areas').find((a) => (a.rotation || 0) === 0 && a.id !== pairs[0].adj.id);
    expect(p.g('adjCornerOffsetOf')(far.id)).toBeNull();
    // 첫 모듈이 배치 공간 시작에 그대로 붙는다
    const first = (p.g('modules') || []).filter((m) => m.areaId === far.id)
      .sort((a, b) => a.x - b.x)[0];
    expect(first.x).toBe(far.x);
  });

  test('코너에 닿은 배치 공간만 밀린다', () => {
    const p = boot(splitWallLayout());
    p.g('autoCalcAllAreas')();
    const pairs = p.g('cornerPairs')();
    const near = pairs[0].adj;
    const off = p.g('adjCornerOffsetOf')(near.id);
    expect(off.offset).toBe(LOWER_D - 10 + 60);
    const first = (p.g('modules') || []).filter((m) => m.areaId === near.id)
      .sort((a, b) => a.x - b.x)[0];
    expect(first.x - near.x).toBe(off.offset);
  });

  test('배치 공간마다 원장이 따로 선다', () => {
    const p = boot(splitWallLayout());
    p.g('autoCalcAllAreas')();
    const live = (p.g('areas') || []).filter((a) => !a.isFinishing);
    live.forEach((a) => {
      const L = p.g('cornerLedger')(a.id);
      if (!L) return;                       // 코너와 무관한 배치 공간
      expect(Math.abs(L.diff)).toBeLessThanOrEqual(1);
      expect(L.missing).toBe(0);
    });
    // 셋 중 둘만 코너에 물린다
    expect(live.filter((a) => p.g('cornerLedger')(a.id)).length).toBe(2);
  });

  test('배치 공간끼리 겹치지 않는다', () => {
    const p = boot(splitWallLayout());
    p.g('autoCalcAllAreas')();
    expect(p.g('crossAreaOverlaps')()).toEqual([]);
  });

  test('멍장은 하나뿐이다 — 같은 벽면이 쪼개져도 늘지 않는다', () => {
    const p = boot(splitWallLayout());
    p.g('autoCalcAllAreas')();
    expect((p.g('modules') || []).filter((m) => m.blind).length).toBe(1);
  });
});

describe('코너가 없으면 아무 일도 하지 않는다', () => {
  const straight = {
    version: 1, savedAt: '2026-08-31T00:00:00.000Z', person: null,
    modules: [
      { section: 'lower', x: 0, y: 0, w: 2400, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
      { section: 'upper', x: 0, y: 1000, w: 2400, h: 320, moduleH: 800, rotation: 0, finishings: [] },
    ],
  };

  test('ㅡ자에서는 코너 쌍이 없다', () => {
    expect(boot(straight).g('cornerPairs')().length).toBe(0);
  });

  test('멍장이 생기지 않는다', () => {
    const p = boot(straight);
    p.g('autoCalcAllAreas')();
    expect((p.g('modules') || []).filter((m) => m.blind).length).toBe(0);
  });

  test('하부 다리와 상부 다리는 직각이어도 코너가 아니다', () => {
    // 단이 다르면 (바닥 ↔ 천장 매달림) 멍 공식이 다르다 — 쌍으로 묶지 않는다
    const mixed = {
      version: 1, savedAt: '2026-08-31T00:00:00.000Z', person: null,
      modules: [
        { section: 'lower', x: 0, y: 0, w: 2400, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
        { section: 'upper', x: 0, y: 0, w: 1800, h: 320, moduleH: 800, rotation: 90, finishings: [] },
      ],
    };
    expect(boot(mixed).g('cornerPairs')().length).toBe(0);
  });
});
