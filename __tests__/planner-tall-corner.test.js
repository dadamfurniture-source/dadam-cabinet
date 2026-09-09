/**
 * W12-65: 키큰장 코너 멍장 + 멍장 주인 토글.
 *
 * 계획: docs/02-design/features/tall-corner-blind.plan.html
 *   · 물끊기는 상판 있는 라인에만 — 키큰장(상판 없음)끼리는 650 + 60 + 15 = 725
 *   · 멍 구간은 2.7T 가림판이 아니라 **멍판 EP 18T 한 장** (멍 − 목대 15, 장 높이 전체)
 *   · 카카스는 단마다 셋(도어를 층으로), EP 는 하나 — BOM 은 첫 단에서만 낸다
 *   · 냉장고장은 계속 제외
 *   · 겹친 코너는 corner.md §3.2 대로 사람이 정한다 (blindOwner) — 트리밍되면 기하가 정한다
 */
const fs = require('fs');
const path = require('path');
const engine = require('../js/planner/planner-engine.js');
const { bootPlanner } = require('../test-utils/planner-harness');
const R = engine.MASTER_RULES;

const TD = 650, TH = 2300, LEG = 1970;
const L = (mods) => ({ version: 1, savedAt: '2026-09-09T00:00:00.000Z', person: null, modules: mods });
const tallH = (rot) => ({ section: 'tall', x: 0, y: 0, w: 3600, h: TD, moduleH: TH, rotation: rot, finishings: [] });
/** 겹친 세로 키큰장 (트리밍 전) */
const tallVOver = () => ({ section: 'tall', x: TD / 2 - LEG / 2, y: LEG / 2 - TD / 2, w: LEG, h: TD, moduleH: TH, rotation: 270, finishings: [] });
/** 잘라낸 세로 키큰장 — 코너 사각형을 가로에 넘긴다 */
const TLEG = LEG - TD;
const tallVTrim = () => ({ section: 'tall', x: TD / 2 - TLEG / 2, y: TD + TLEG / 2 - TD / 2, w: TLEG, h: TD, moduleH: TH, rotation: 270, finishings: [] });
const lowerH = (rot) => ({ section: 'lower', x: 0, y: 0, w: 3600, h: 700, moduleH: 870, rotation: rot, finishings: [] });
const fridgeH = () => ({ section: 'fridge', x: 0, y: 0, w: 3600, h: 700, moduleH: TH, rotation: 0, finishings: [] });

function boot(mods, extraStorage) {
  const p = bootPlanner('mockup-structure.html', {
    search: '?design=d1&item=1',
    storage: Object.assign({ 'dadam_layout_v1::d1:1': JSON.stringify(L(mods)) }, extraStorage || {}),
  });
  if (p.errors.length) throw new Error(p.errors.map((e) => e.message).join(' | '));
  return p;
}
const blinds = (p) => (p.g('modules') || []).filter((m) => m.blind);
const isHoriz = (a) => (((a.rotation || 0) % 180) + 180) % 180 === 0;

describe('엔진 — 물끊기는 상판 있는 라인에만', () => {
  test('키큰↔키큰: 650 + 60 + 15 = 725 · 인접 밀림 = 주인 깊이 650', () => {
    const d = engine.deriveCornerArea({ ownerW: LEG, ownerD: TD, adjDs: [TD], adjHasTops: [false] });
    expect(d.blindZoneW).toBe(725);
    expect(d.adjStartOffset).toBe(TD);
    expect(d.blindW).toBe(725 + d.doorW);
  });
  test('키큰↔하부: 멍은 인접(상판) 기준 765 · 밀림은 주인(키큰) 깊이 650', () => {
    const d = engine.deriveCornerArea({ ownerW: LEG, ownerD: TD, adjDs: [700], adjHasTops: [true] });
    expect(d.blindZoneW).toBe(765);
    expect(d.adjStartOffset).toBe(TD);
  });
  test('기본값은 하부장 그대로다 — 765 · 밀림 700', () => {
    const d = engine.deriveCornerArea({ ownerW: LEG, ownerD: 700, adjDs: [700] });
    expect(d.blindZoneW).toBe(765);
    expect(d.adjStartOffset).toBe(700);
  });
  test('상부장은 395 · 밀림 320', () => {
    const d = engine.deriveCornerArea({ ownerW: 1800, ownerD: 320, adjDs: [320], isUpper: true });
    expect(d.blindZoneW).toBe(395);
    expect(d.adjStartOffset).toBe(320);
  });
});

describe('키큰장끼리 코너 — 트리밍된 ㄱ자', () => {
  const mods = () => [tallH(180), tallVTrim()];

  test('코너로 잡힌다 — 스택이지만 키큰장은 대상이다', () => {
    const p = boot(mods());
    expect(p.g('cornerPairs')().length).toBe(1);
  });

  test('멍장이 단마다 하나씩 셋, 같은 x·W 로 선다', () => {
    const p = boot(mods()); p.g('autoCalcAllAreas')();
    const bs = blinds(p);
    expect(bs.length).toBe(3);
    const xs = new Set(bs.map((m) => Math.round(m.x)));
    const ws = new Set(bs.map((m) => Math.round(m.W)));
    expect(xs.size).toBe(1);
    expect(ws.size).toBe(1);
    expect(bs.map((m) => m.part).sort()).toEqual(['상부장', '중간장', '하부장'].sort());
    expect(bs.map((m) => m.blind.tier).sort()).toEqual([0, 1, 2]);
  });

  test('멍 725 · 카카스 = 멍 + 도어 · 멍판 EP = 멍 − 15, 높이 2300', () => {
    const p = boot(mods()); p.g('autoCalcAllAreas')();
    const m = blinds(p)[0];
    expect(m.blind.zoneW).toBe(725);
    expect(Math.round(m.W)).toBe(m.blind.zoneW + m.blind.doorW);
    expect(m.blind.ep).toEqual({ W: 725 - R.CORNER_HINGE_BATTEN_T, H: TH });
    expect(m.blind.finish).toBeNull();                      // 마감재 100 없음
  });

  test('정면 셀은 [멍][도어] 두 칸 — 마감재 칸이 없다', () => {
    const p = boot(mods()); p.g('autoCalcAllAreas')();
    blinds(p).forEach((m) => {
      const s = p.g('structures')[m.id];
      expect(s.verticalCount).toBe(2);
      expect(s.areaTypes.slice().sort()).toEqual(['blind', 'door']);
      expect(s.areaWidths.reduce((a, b) => a + b, 0)).toBe(Math.round(m.W));
    });
  });

  test('수납 단도 셋이고 멍장과 같은 자리에 겹치지 않는다', () => {
    const p = boot(mods()); p.g('autoCalcAllAreas')();
    const c = p.g('cornerPairs')()[0];
    const own = p.g('modules').filter((m) => m.areaId === c.owner.id && !m.isFinishing);
    const tiers = own.filter((m) => !m.blind);
    expect(tiers.length).toBe(3);
    const b = own.find((m) => m.blind);
    tiers.forEach((t) => {
      const sep = t.x + t.W <= b.x + 1 || b.x + b.W <= t.x + 1;
      expect(sep).toBe(true);
    });
  });

  test('원장이 단 하나 몫으로 맞는다 · 배치 공간끼리 안 겹친다', () => {
    const p = boot(mods()); p.g('autoCalcAllAreas')();
    (p.g('areas') || []).filter((a) => !a.isFinishing).forEach((a) => {
      const Lg = p.g('cornerLedger')(a.id);
      if (!Lg) return;
      expect(Math.abs(Lg.diff)).toBeLessThanOrEqual(1);
      expect(Lg.missing).toBe(0);
      expect(Lg.blinds).toBeLessThanOrEqual(1);   // 단 셋을 하나로 센다
    });
    expect(p.g('crossAreaOverlaps')()).toEqual([]);
  });

  test('트리밍된 인접 키큰장은 더 밀리지 않는다 — 요구 650 · 이미 650 → 0', () => {
    const p = boot(mods()); p.g('autoCalcAllAreas')();
    const c = p.g('cornerPairs')()[0];
    const off = p.g('adjCornerOffsetOf')(c.adj.id);
    expect(off.need).toBe(TD);
    expect(off.already).toBe(TD);
    expect(off.offset).toBe(0);
  });
});

describe('키큰장끼리 코너 — 겹친 ㄱ자', () => {
  test('멍장 셋 · 원장 0 · 겹침 0 · 밀림 650(주인 깊이)', () => {
    const p = boot([tallH(0), tallVOver()]); p.g('autoCalcAllAreas')();
    expect(blinds(p).length).toBe(3);
    const c = p.g('cornerPairs')()[0];
    expect(p.g('adjCornerOffsetOf')(c.adj.id).offset).toBe(TD);
    (p.g('areas') || []).filter((a) => !a.isFinishing).forEach((a) => {
      const Lg = p.g('cornerLedger')(a.id);
      if (Lg) { expect(Math.abs(Lg.diff)).toBeLessThanOrEqual(1); expect(Lg.missing).toBe(0); }
    });
    expect(p.g('crossAreaOverlaps')()).toEqual([]);
  });
});

describe('혼합 코너 — 키큰장 ↔ 하부장', () => {
  test('키큰장이 주인이면 멍 765(하부 기준) · EP 750 · 밀림 650', () => {
    // 하부(가로, 잘라냄) + 키큰(세로) — 세로가 코너 사각형을 갖게 배치한다
    const p = boot([
      { section: 'lower', x: 0, y: 0, w: 3600 - TD, h: 700, moduleH: 870, rotation: 180, finishings: [] },
      { section: 'tall', x: TD / 2 - LEG / 2, y: LEG / 2 - TD / 2, w: LEG, h: TD, moduleH: TH, rotation: 270, finishings: [] },
    ]);
    // 가로를 x=650 부터 시작하게 밀어 코너 사각형을 세로만 갖게 한다
    const a = p.g('areas').find((q) => q.section === 'lower'); a.x = TD;
    p.g('autoCalcAllAreas')();
    const c = p.g('cornerPairs')()[0];
    expect(c.owner.section).toBe('tall');
    const m = blinds(p)[0];
    expect(m.blind.zoneW).toBe(765);
    expect(m.blind.ep.W).toBe(750);
    expect(p.g('adjCornerOffsetOf')(c.adj.id).need).toBe(TD);
  });
});

describe('냉장고장은 계속 제외', () => {
  test('냉장고장 + 키큰장 ㄱ자는 코너가 아니다', () => {
    const p = boot([fridgeH(), tallVOver()]);
    expect(p.g('cornerPairs')()).toEqual([]);
    p.g('autoCalcAllAreas')();
    expect(blinds(p)).toEqual([]);
  });
});

describe('멍장 주인 토글 (corner.md §3.2)', () => {
  test('겹친 코너 — 기본은 회전 규칙이고 뒤집을 수 있다', () => {
    const p = boot([tallH(0), tallVOver()]); p.g('autoCalcAllAreas')();
    const c0 = p.g('cornerPairs')()[0];
    expect(c0.reason).toBe('rotation');
    const oldOwner = c0.owner.id, newOwner = c0.adj.id;
    expect(p.g('flipBlindOwner')(oldOwner, newOwner)).toBe(true);
    const c1 = p.g('cornerPairs')()[0];
    expect(c1.reason).toBe('choice');
    expect(c1.owner.id).toBe(newOwner);
    // 멍장이 새 주인으로 옮겨 갔고, 옛 주인엔 남지 않았다
    const bs = blinds(p);
    expect(bs.length).toBe(3);
    bs.forEach((m) => expect(m.areaId).toBe(newOwner));
    expect(p.g('crossAreaOverlaps')()).toEqual([]);
    (p.g('areas') || []).filter((a) => !a.isFinishing).forEach((a) => {
      const Lg = p.g('cornerLedger')(a.id);
      if (Lg) { expect(Math.abs(Lg.diff)).toBeLessThanOrEqual(1); expect(Lg.missing).toBe(0); }
    });
  });

  test('선택은 배치 단계에 되쓰여 다시 열어도 남는다', () => {
    const p = boot([tallH(0), tallVOver()]); p.g('autoCalcAllAreas')();
    const c0 = p.g('cornerPairs')()[0];
    p.g('flipBlindOwner')(c0.owner.id, c0.adj.id);
    const raw = JSON.parse(p.window.localStorage.getItem('dadam_layout_v1::d1:1'));
    const flags = raw.modules.map((m) => !!m.blindOwner);
    expect(flags.filter(Boolean).length).toBe(1);
    // 다시 부팅 — 저장된 layout 을 그대로 물린다
    const p2 = boot(raw.modules, {});
    const c2 = p2.g('cornerPairs')()[0];
    expect(c2.reason).toBe('choice');
    expect(c2.owner.id).toBe(c0.adj.id);
  });

  test('트리밍된 코너는 기하가 정한다 — 표시가 있어도 뒤집히지 않는다', () => {
    const p = boot([tallH(180), tallVTrim()]);
    const c0 = p.g('cornerPairs')()[0];
    expect(c0.reason).toBe('geometry');
    expect(isHoriz(c0.owner)).toBe(true);
    p.g('flipBlindOwner')(c0.owner.id, c0.adj.id);
    const c1 = p.g('cornerPairs')()[0];
    expect(c1.reason).toBe('geometry');
    expect(isHoriz(c1.owner)).toBe(true);
  });
});

describe('BOM 끝단 — 키큰장 멍장 부재', () => {
  global.dlog = global.dlog || (() => {});
  const SRC = fs.readFileSync(path.join(__dirname, '../js/detaildesign/ui-step1.js'), 'utf8');
  const block = SRC.slice(SRC.indexOf('const PLANNER_CABINET_SECTIONS'), SRC.indexOf('function _applyPlannerResult'));
  const conv = new Function(`${block}; return { _convertPlannerModules };`)(); // eslint-disable-line no-new-func
  const { MaterialExtractor } = require('../js/detaildesign/extractors.js');

  function bom() {
    const p = boot([tallH(180), tallVTrim()]); p.g('autoCalcAllAreas')();
    const payload = p.g('buildPlannerPayload')();
    const { modules, warnings } = conv._convertPlannerModules(payload, {});
    const item = { categoryId: 'sink', w: 3600, h: 2310, d: 650, modules,
      specs: { lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12, finishLeftType: 'None', finishRightType: 'None' } };
    const mats = new MaterialExtractor().extract({ items: [item] }).materials
      .filter((m) => m.module.indexOf('LT망장') >= 0);
    return { mats, warnings, modules };
  }

  test('멍판 EP 는 한 장 — 710 × 2300 · 18T', () => {
    const { mats } = bom();
    const ep = mats.filter((m) => m.part === '멍판 EP');
    expect(ep.length).toBe(1);
    expect(ep[0].thickness).toBe(18);
    expect(ep[0].w).toBe(725 - 15);
    expect(ep[0].h).toBe(TH);
  });
  test('멍가림판 2.7T 와 멍판 마감재 100 은 없다', () => {
    const { mats } = bom();
    expect(mats.filter((m) => m.part === '멍가림판')).toEqual([]);
    expect(mats.filter((m) => /멍판\)$/.test(m.part))).toEqual([]);
  });
  test('도어와 경첩목대는 단마다 — 셋씩', () => {
    const { mats } = bom();
    expect(mats.filter((m) => m.part === '도어').length).toBe(3);
    expect(mats.filter((m) => m.part === '경첩목대').length).toBe(3);
  });
  test('멍장 폭 정합성 경고가 없다', () => {
    const { warnings } = bom();
    expect(warnings.filter((w) => w.includes('멍장 폭'))).toEqual([]);
  });
});
