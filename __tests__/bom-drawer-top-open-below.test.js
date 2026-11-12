/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 2026-11-05 사장님 새 모듈 확정 —
 *   D 위 서랍 + 아래 도어 (하부장): 「1단 · 한 몸통 · 경첩 여닫이 · 서랍과 도어 사이 목찬넬 있음」 · 「서랍 높이 기본값 180」
 *     → bom-drawer-rules layoutDrawerTop (전면 영역에서 서랍 180 · 도어 나머지), 브리지 drawerLayout 'drawerTop', 도어만 경첩.
 *   C 상부장 밑 오픈 칸: 「도어장 + 18T 오픈 상자」 · 「도어 안 내려옴」 · 높이 기본값 200 (라이브러리가 단 자리로 쌓는다)
 *     → 위 도어장 openBelow (도어 내림 0), 밑 오픈 상자 underUpper (상몰딩 자리 아님).
 */
const { loadConverter, LEDGER_SPECS } = require('../test-utils/bom-parts');
const { loadExtractors } = require('../test-utils/bom-golden/golden');
const Asm = require('../js/detaildesign/bom-assembly.js');
const DR = require('../js/detaildesign/bom-drawer-rules.js');

const D = 550,
  BACK = 70,
  AREA_D = 650;
const SPECS = Object.assign({}, LEDGER_SPECS, {
  handle: '찬넬 (목찬넬)',
  finishLeftType: 'None',
  finishLeftWidth: 0,
  finishRightType: 'None',
  finishRightWidth: 0,
});

/** 위 서랍 + 아래 도어 하부장 하나 (900 양문 · 450 외짝) — 플래너 · 모듈 라이브러리 구조 모양 */
function drawerTop(W, extra, category, handle) {
  const two = W >= 900;
  const modules = [{ id: 'l0', section: 'lower', W, H: 870, D, x: 0, y: BACK, areaH: 870 }];
  const structures = {
    l0: Object.assign(
      {
        moduleKind: 'normal',
        verticalCount: 1,
        horizontalLayout: 'doorTopDrawerBottom',
        bottomType: 'drawer',
        drawerCount: 1,
        areaTypes: ['door'],
        areaDirections: ['left'],
        areaWidths: [W],
        areaIs2D: [two],
        legH: 150,
        shelves: [],
        drawer: { rail: 'ball', sakuri: true, boxT: 0, drawerTop: true },
      },
      extra || {}
    ),
  };
  const specs = Object.assign({}, SPECS, handle ? { handle } : {});
  const conv = loadConverter()._convertPlannerModules({ modules, structures, hasStructures: true }, Object.assign({}, specs));
  const item = { categoryId: category || 'sink', w: W, h: 2310, d: AREA_D, specs: Object.assign({}, specs), modules: conv.modules };
  const { MaterialExtractor, HardwareExtractor } = loadExtractors();
  const materials = new MaterialExtractor().extract({ items: [item] }).materials;
  const hardware = new HardwareExtractor().extract({ items: [item] }).hardware;
  const mk = `0-${conv.modules[0].id}`;
  const rows = materials.filter((r) => r.moduleKey === mk);
  const spec = Asm.of({ items: [item] }, { materials, lines: [[{ key: 'area-lower-0', D: AREA_D, modules: [{ moduleKey: mk, x0: 0, back: BACK }] }]] });
  return { conv, item, materials, hardware, rows, spec, mk, part: (p) => rows.filter((r) => r.part === p) };
}

describe('위 서랍 + 아래 도어 — 규칙 (layoutDrawerTop)', () => {
  test('전면 영역 648 (870 − 상판 12 − 다리발 150 − 목찬넬 30 × 2) → 서랍 180 · 도어 468, 사이 중간 목찬넬, 한 몸통', () => {
    const L = DR.layoutDrawerTop({ areaH: 870, topT: 12, legH: 150, T: 15, rail: 'ball' });
    expect(L.front.area).toBe(648);
    expect(L.fronts.map((f) => [f.kind, f.h])).toEqual([['drawer', 180], ['door', 468]]);
    expect(L.channels.map((c) => c.kind)).toEqual(['top', 'mid']);
    expect([L.split, L.drawerTop]).toEqual([null, true]);
    expect(DR.DRAWER_RULES.TOP_DRAWER_FRONT_H).toBe(180);
  });

  test('서랍 높이를 주면 그 값 (기본값 180 — 사장님 「기본값」), 볼레일이면 소 박스가 든다 · 언더레일이면 레일 여유 부족', () => {
    expect(DR.layoutDrawerTop({ areaH: 870, topT: 12, legH: 150, T: 15, drawerH: 250 }).fronts.map((f) => f.h)).toEqual([250, 398]);
    const ball = DR.layoutDrawerTop({ areaH: 870, topT: 12, legH: 150, T: 15, rail: 'ball' });
    expect([ball.boxes[0].size, ball.boxes[0].fits]).toEqual(['small', true]);
    const under = DR.layoutDrawerTop({ areaH: 870, topT: 12, legH: 150, T: 15, rail: 'under' });
    expect(under.boxes[0].fits).toBe(false);
  });
});

describe('위 서랍 + 아래 도어 — 브리지 · BOM · 조립', () => {
  test('브리지 — 서랍 모듈 · drawerLayout drawerTop · 도어 2 (양문) / 1 (외짝, 경첩 방향)', () => {
    expect([drawerTop(900).conv.modules[0].isDrawer, drawerTop(900).conv.modules[0].drawerLayout, drawerTop(900).conv.modules[0].doorCount]).toEqual([true, 'drawerTop', 2]);
    const one = drawerTop(450).conv.modules[0];
    expect([one.doorCount, one.hingeSide]).toEqual([1, 'left']);
  });

  test('900 — 서랍도어 896 × 180 · 도어 446 × 468 × 2 · 중간 목찬넬 ㄴ자 · 몸통 하나 · 처짐방지목은 아래 도어 칸에만 (지판 위 ~ 중간 따내기 밑 413)', () => {
    const r = drawerTop(900);
    expect(r.part('서랍도어').map((x) => [x.w, x.h, x.qty])).toEqual([[896, 180, 1]]);
    expect(r.part('도어').map((x) => [x.w, x.h, x.qty])).toEqual([[446, 468, 2]]);
    expect(r.part('목찬넬(중간 전면)').map((x) => [x.w, x.h, x.qty])).toEqual([[72, 900, 1]]);
    expect(r.part('측판').length).toBe(1);
    // 708 − 지판 15 − (중간 목찬넬 190 + 따내기 90) = 413 (2026-11-05 사장님 「아래 도어 칸에만」)
    expect(r.part('밴드(처짐방지)').map((x) => [x.w, x.h, x.qty])).toEqual([[70, 413, 1]]);
    expect(r.rows.some((x) => /\[확인 필요\]|레일 여유 부족/.test(x.note || ''))).toBe(false);
  });

  test('450 — 처짐방지목 문턱 밑이라 [확인 필요] 없음 · 도어 446 × 468 한 장', () => {
    const r = drawerTop(450);
    expect(r.part('도어').map((x) => [x.w, x.h, x.qty])).toEqual([[446, 468, 1]]);
    expect(r.rows.some((x) => /\[확인 필요\]/.test(x.note || ''))).toBe(false);
  });

  test('경첩 — 아래 도어만 (도어 높이 468 → 2구 × 도어 수), 서랍 전면은 마이다', () => {
    const r = drawerTop(900);
    const h = r.hardware.filter((x) => x.category === '경첩');
    expect(h.map((x) => [x.spec, x.qty])).toEqual([['2구', 4]]);
    expect(Math.max(...h[0].boring)).toBeLessThan(468);
  });

  test('수납장 · 화장대 품목(단순 상자)도 같은 전면 · 경첩 · 선반 없음', () => {
    for (const c of ['storage', 'vanity']) {
      const r = drawerTop(900, null, c);
      expect([c, r.part('서랍도어').map((x) => x.h), r.part('도어').map((x) => [x.h, x.qty]), r.part('선반')]).toEqual([c, [180], [[468, 2]], []]);
      expect(r.hardware.filter((x) => x.category === '경첩').map((x) => [x.spec, x.qty])).toEqual([['2구', 4]]);
    }
  });

  test('조립 명세 — 서랍 전면 · 도어 · 박스가 다 자리에 놓인다 (도어는 서랍 밑)', () => {
    const r = drawerTop(900);
    const un = (r.spec.items[0].unplaced || []).filter((u) => u.moduleKey === r.mk && u.reason !== 'shelf-height-unknown');
    expect(un).toEqual([]);
    const m = r.spec.items[0].modules.find((x) => x.moduleKey === r.mk);
    const door = m.parts.filter((p) => p.part === '도어');
    const front = m.parts.find((p) => p.part === '서랍도어');
    expect(door.length).toBe(2);
    expect(Math.max(...door.map((p) => p.box.max[1]))).toBeLessThan(front.box.min[1]);
    // 처짐방지목 — 지판 위에 서고, 윗끝이 위 서랍 박스 밑 (박스와 겹치지 않는다)
    const brace = m.parts.find((p) => p.part === '밴드(처짐방지)');
    const boxes = m.parts.filter((p) => /서랍(전후판|측판)/.test(p.part));
    expect(brace).toBeTruthy();
    expect(brace.box.max[1]).toBeLessThanOrEqual(Math.min(...boxes.map((p) => p.box.min[1])));
  });

  test('찬넬(알루미늄) 손잡이면 처짐방지목은 위 서랍 존 밑까지 (따내기가 없다)', () => {
    const r = drawerTop(900, null, null, '찬넬 (알루미늄)');
    const zoneBottom = DR.layoutDrawerTop({ areaH: 870, topT: 12, legH: 150, T: 15, rail: 'ball' }).fronts[0].zone.bottom;
    expect(r.part('밴드(처짐방지)').map((x) => x.h)).toEqual([708 - 15 - zoneBottom]);
  });
});

describe('상부장 밑 오픈 칸 — 도어장 + 18T 오픈 상자', () => {
  /** 위 도어장 900 (openBelow, 몸통 520 + 상몰딩 60) · 밑 오픈 상자 900 (underUpper, 200, 상몰딩 0) — 라이브러리가 단 자리로 쌓는 모양 */
  function upperOpen() {
    const cell = (extra) =>
      Object.assign({ moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaDirections: ['left'], areaWidths: [900], areaIs2D: [true], shelves: [{}, {}] }, extra);
    const modules = [
      { id: 'u0', section: 'upper', W: 900, H: 200, D: 295, x: 0, y: 0, areaH: 200 },
      { id: 'u1', section: 'upper', W: 900, H: 580, D: 295, x: 0, y: 0, areaH: 580 },
    ];
    const structures = {
      u0: cell({ moduleKind: 'open', areaTypes: ['open'], areaIs2D: [false], shelves: [], moldingH: 0, underUpper: true }),
      u1: cell({ moldingH: 60, openBelow: true }),
    };
    const conv = loadConverter()._convertPlannerModules({ modules, structures, hasStructures: true }, Object.assign({}, SPECS));
    const item = { categoryId: 'sink', w: 900, h: 2310, d: AREA_D, specs: Object.assign({}, SPECS), modules: conv.modules };
    const { MaterialExtractor, HardwareExtractor } = loadExtractors();
    return { conv, materials: new MaterialExtractor().extract({ items: [item] }).materials, hardware: new HardwareExtractor().extract({ items: [item] }).hardware };
  }

  test('브리지 — 위 도어장 openBelow · 밑 오픈 상자 underUpper (pos upper)', () => {
    const { conv } = upperOpen();
    const box = conv.modules.find((m) => m.moduleKind === 'open');
    const door = conv.modules.find((m) => m.moduleKind !== 'open');
    expect([box.pos, box.underUpper, door.pos, door.openBelow]).toEqual(['upper', true, 'upper', true]);
  });

  test('도어 = 몸통 그대로 (내림 0 — 「안 내려옴」), 경첩 보링도 그 도어 안', () => {
    const { conv, materials, hardware } = upperOpen();
    const door = conv.modules.find((m) => m.moduleKind !== 'open');
    expect(materials.filter((r) => r.part === '도어').map((r) => r.h)).toEqual([door.h]);
    const h = hardware.find((x) => x.category === '경첩');
    expect(Math.max(...h.boring)).toBeLessThan(door.h);
  });

  test('상몰딩은 위 도어장 위 한 장 — 밑 오픈 상자는 상몰딩 자리에 서지 않는다', () => {
    const { materials } = upperOpen();
    expect(materials.filter((r) => r.part === '상몰딩').map((r) => [r.w, r.h, r.qty])).toEqual([[60, 900, 1]]);
  });
});
