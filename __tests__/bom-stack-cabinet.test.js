/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 하부장 위 수납장 · 콘센트 · 알루미늄 프레임 유리 도어 — 2026-11-03 사장님 결정.
 *
 *   「밑에 2개의 하부장 위에 1개의 수납장을 올리려고」 → 질문 답:
 *     쌓는 방식   「몸통 위에 바로」 — 아래 하부장은 밴드 2 대신 천판 (키큰장 단 · 하부 밥솥장 짜임), 그 칸 위 상판 없음
 *     위 수납장   상부장 짜임의 따로 짠 상자 (pos upper — 높이 · 깊이는 간편 플래너 · 모듈 라이브러리가 준다)
 *     도어 아래 끝 「아랫장이 목찬넬이면 5내림, 아니면 몸통과 같게」 — 구조 s.stackBox, 내림은 BOM 이 품목 손잡이로 (5 · 0)
 *   「하부장 … 전자제품 … 콘센트 … BOM」 → 「콘센트 자재 + 뒤판 타공」 · 「모듈마다 1개 (2구)」 · 타공 「50*80」 · 높이는 모듈 칸에서
 *   유리 도어 → 「알루미늄 프레임 + 유리」 — 사서 단다 (도어 판 행 대신 같은 치수의 구매품 행, 경첩은 엔진 규칙 그대로)
 */
const { loadConverter, LEDGER_SPECS } = require('../test-utils/bom-parts');
const { loadExtractors } = require('../test-utils/bom-golden/golden');
const Asm = require('../js/detaildesign/bom-assembly.js');
const { BOM_OUTLET, BOM_GLASS_DOOR } = require('../js/detaildesign/extractors.js');

const D = 550,
  BACK = 70,
  AREA_D = 650;
const door2 = (W, extra) =>
  Object.assign(
    {
      moduleKind: 'normal',
      verticalCount: 1,
      horizontalLayout: 'doorOnly',
      areaTypes: ['door'],
      areaDirections: ['left'],
      areaWidths: [W],
      areaIs2D: [true],
      legH: 150,
      shelves: [],
    },
    extra || {}
  );
const upper2 = (W, extra) =>
  Object.assign(
    {
      moduleKind: 'normal',
      verticalCount: 1,
      horizontalLayout: 'doorOnly',
      areaTypes: ['door'],
      areaDirections: ['left'],
      areaWidths: [W],
      areaIs2D: [true],
      shelves: [{}, {}],
    },
    extra || {}
  );

/**
 * 하부 줄: 2도어 600 · 2도어 600 (둘 위에 수납장) · 2도어 600 (상판).
 *   위 수납장 1200 — 몸통 윗면 858 ~ 상몰딩 밑 2240 = 1382 (+ 상몰딩 60 = 플래너 H 1442).
 * @param {object} [o]  handle · glass · outlet (하부장 l2 에)
 */
function line(o) {
  const opt = o || {};
  const SPECS = Object.assign({}, LEDGER_SPECS, {
    handle: opt.handle || '찬넬 (목찬넬)',
    finishLeftType: 'None',
    finishLeftWidth: 0,
    finishRightType: 'None',
    finishRightWidth: 0,
  });
  const modules = [
    {
      id: 'l0',
      section: 'lower',
      W: 600,
      H: 870,
      D,
      x: 0,
      y: BACK,
      areaH: 870,
      cabinetOnTop: true,
    },
    {
      id: 'l1',
      section: 'lower',
      W: 600,
      H: 870,
      D,
      x: 600,
      y: BACK,
      areaH: 870,
      cabinetOnTop: true,
    },
    { id: 'l2', section: 'lower', W: 600, H: 870, D, x: 1200, y: BACK, areaH: 870 },
    { id: 's1', section: 'upper', W: 1200, H: 1382 + 60, D, x: 0, y: BACK, areaH: 1442 },
  ];
  const structures = {
    l0: door2(600),
    l1: door2(600),
    l2: door2(600, opt.outlet !== undefined ? { outlet: opt.outlet } : {}),
    s1: upper2(
      1200,
      Object.assign({ moldingH: 60, stackBox: true }, opt.glass ? { glassDoor: 'alu' } : {})
    ),
  };
  const conv = loadConverter()._convertPlannerModules(
    { modules, structures, hasStructures: true },
    Object.assign({}, SPECS)
  );
  const item = {
    categoryId: 'sink',
    w: 1800,
    h: 2310,
    d: AREA_D,
    specs: Object.assign({}, SPECS),
    modules: conv.modules,
  };
  const { MaterialExtractor, HardwareExtractor } = loadExtractors();
  const materials = new MaterialExtractor().extract({ items: [item] }).materials;
  const hardware = new HardwareExtractor().extract({ items: [item] }).hardware;
  const key = (id) => conv.modules.find((m) => String(m.id).indexOf(`planner-${id}-`) === 0).id;
  const rowsOf = (id) => materials.filter((r) => r.moduleKey === `0-${key(id)}`);
  const spec = Asm.of(
    { items: [item] },
    {
      materials,
      lines: [
        [
          {
            key: 'area-lower-0',
            D: AREA_D,
            modules: ['l0', 'l1', 'l2'].map((id, i) => ({
              moduleKey: `0-${key(id)}`,
              x0: i * 600,
              back: BACK,
            })),
          },
          {
            key: 'area-upper-0',
            D: AREA_D,
            modules: [{ moduleKey: `0-${key('s1')}`, x0: 0, back: BACK }],
          },
        ],
      ],
    }
  );
  return { conv, item, materials, hardware, spec, key, rowsOf };
}
const parts = (rows) => rows.map((r) => `${r.part}${r.qty > 1 ? `×${r.qty}` : ''}`).sort();

describe('브리지 — 하부장 위 수납장', () => {
  test('아래 하부장 cabinetOnTop · 위 수납장 pos upper · stackBox · 몸통 1382', () => {
    const { conv, key } = line();
    const m = (id) => conv.modules.find((x) => x.id === key(id));
    expect([m('l0').cabinetOnTop, m('l1').cabinetOnTop, m('l2').cabinetOnTop]).toEqual([
      true,
      true,
      undefined,
    ]);
    expect([m('s1').pos, m('s1').h, m('s1').stackBox]).toEqual(['upper', 1382, true]);
  });
});

describe('BOM — 하부장 위 수납장', () => {
  test('위에 수납장이 올라간 하부장은 밴드 2 대신 천판, 옆 하부장은 밴드 그대로', () => {
    const { rowsOf } = line();
    expect(rowsOf('l0').some((r) => r.part === '천판')).toBe(true);
    expect(rowsOf('l0').some((r) => r.part === '밴드')).toBe(false);
    expect(rowsOf('l2').find((r) => r.part === '밴드').qty).toBe(2);
    expect(rowsOf('l2').some((r) => r.part === '천판')).toBe(false);
  });

  test('상판 = 수납장이 올라가지 않은 하부장 폭만 (600)', () => {
    const { materials } = line();
    const top = materials.filter((r) => r.part === '상판');
    expect(top.map((r) => r.w)).toEqual([600]);
  });

  test('위 수납장 — 상부장 짜임 (천판 · 지판 · 뒷판), 도어 = 몸통 + 5 (목찬넬) · 몸통 그대로 (목찬넬 아님)', () => {
    const a = line();
    expect(
      parts(a.rowsOf('s1').filter((r) => ['측판', '천판', '지판', '뒷판'].includes(r.part)))
    ).toEqual(['뒷판', '지판', '천판', '측판×2']);
    expect(a.rowsOf('s1').find((r) => r.part === '도어').h).toBe(1382 + 5);
    const b = line({ handle: '푸쉬' });
    expect(b.rowsOf('s1').find((r) => r.part === '도어').h).toBe(1382);
  });

  test('경첩 도어 높이도 몸통 + 모듈 내림 (자재 도어 행과 같다)', () => {
    const { hardware, rowsOf } = line();
    const doorH = rowsOf('s1').find((r) => r.part === '도어').h;
    const hinge = hardware.find((h) => h.category === '경첩' && /상부장/.test(h.module || h.note));
    expect(hinge).toBeTruthy();
    expect(Math.max(...hinge.boring)).toBeLessThan(doorH);
  });

  test('조립 명세 — 아래 하부장 천판 · 위 수납장 도어(내림 5 · 0)가 자리에 놓인다', () => {
    for (const o of [{}, { handle: '푸쉬' }]) {
      const { spec, key } = line(o);
      // 선반 높이는 부르는 쪽(플래너 opts.shelfY)이 넘긴다 — 이 시험은 넘기지 않는다
      const un = (spec.items[0].unplaced || []).filter(
        (u) =>
          [`0-${key('l0')}`, `0-${key('s1')}`].includes(u.moduleKey) &&
          u.reason !== 'shelf-height-unknown'
      );
      expect(un).toEqual([]);
      const s1 = spec.items[0].modules.find((m) => m.moduleKey === `0-${key('s1')}`);
      const door = s1.parts.find((p) => p.part === '도어');
      expect(door).toBeTruthy();
      // 도어 윗변 = 몸통 상단 1382, 밑단 = 몸통 바닥 − 내림 (5 · 0)
      expect([door.box.min[1] + 0, door.box.max[1]]).toEqual([0 - (o.handle ? 0 : 5), 1382]);
      const l0 = spec.items[0].modules.find((m) => m.moduleKey === `0-${key('l0')}`);
      expect(l0.parts.some((p) => p.part === '천판')).toBe(true);
    }
  });
});

describe('BOM — 콘센트 (모듈마다 2구 하나, 뒤판 타공 50×80)', () => {
  test('높이를 적으면 부자재 콘센트 1 · 뒷판 비고 「바닥에서 400」', () => {
    const { hardware, rowsOf, key } = line({ outlet: { h: 400 } });
    const o = hardware.filter((h) => h.item === BOM_OUTLET.ITEM);
    expect(o.length).toBe(1);
    expect([o[0].qty, o[0].unit, o[0].category, o[0].moduleKey]).toEqual([
      1,
      'EA',
      '전기',
      `0-${key('l2')}`,
    ]);
    expect(rowsOf('l2').find((r) => r.part === '뒷판').note).toMatch(
      /콘센트 타공 50×80 — 바닥에서 400/
    );
  });

  test('높이가 없으면 「위치 현장 확인」, 전자제품이 없는 모듈은 콘센트 없음', () => {
    const a = line({ outlet: { h: null } });
    expect(a.rowsOf('l2').find((r) => r.part === '뒷판').note).toMatch(/위치 현장 확인/);
    const b = line();
    expect(b.hardware.filter((h) => h.item === BOM_OUTLET.ITEM)).toEqual([]);
    expect(b.rowsOf('l2').find((r) => r.part === '뒷판').note).not.toMatch(/콘센트/);
  });
});

describe('BOM — 알루미늄 프레임 유리 도어', () => {
  test('도어 판 행 → 구매품 행 (같은 치수 · 칠 없음), 경첩은 그대로 + [확인 필요] 품번', () => {
    const plain = line();
    const glass = line({ glass: true });
    const d0 = plain.rowsOf('s1').find((r) => r.part === '도어');
    const d1 = glass.rowsOf('s1').find((r) => r.part === '도어');
    expect([d1.w, d1.h, d1.qty]).toEqual([d0.w, d0.h, d0.qty]);
    expect([d1.material, d1.finishCode, d1.slot, d1.glassDoor]).toEqual([
      BOM_GLASS_DOOR.MATERIAL,
      '',
      'back',
      true,
    ]);
    expect(d1.note).toMatch(/구매품/);
    // 하부장 도어는 그대로 MDF
    expect(glass.rowsOf('l2').find((r) => r.part === '도어').material).not.toBe(
      BOM_GLASS_DOOR.MATERIAL
    );
    const hinge = glass.hardware.find(
      (h) => h.category === '경첩' && h.moduleKey === `0-${glass.key('s1')}`
    );
    expect(hinge.note).toMatch(/알루미늄 프레임 도어 경첩 품번/);
  });
});
