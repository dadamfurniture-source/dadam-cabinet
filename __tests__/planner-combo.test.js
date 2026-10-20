/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 조합 캐비닛 — 복사·붙여넣기 (2026-10-20 사장님 결정 카드: 복사·붙여넣기, 이름 저장 없음).
 *
 * 계산은 js/planner/planner-combo.js, 배선은 mockup-structure.html copyComboFrom / pasteComboInto.
 * 구조 설정(structures[id])이 통째로 따라가고, 멍장·냉장고 칸·가전 자리·배치 마감재는 빠진다.
 * 멤버십은 areaIdOfModule — 시험은 areaId 없는 옛 모듈로 갈린다.
 */
const fs = require('fs');
const path = require('path');
const C = require('../js/planner/planner-combo.js');

const STRUCT = fs.readFileSync(path.join(__dirname, '../mockup-structure.html'), 'utf8');

function sliceBalanced(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(startIdx, i + 1);
  }
  throw new Error('중괄호 짝을 찾지 못했습니다');
}
const fnSrc = (name) => sliceBalanced(STRUCT, STRUCT.indexOf(`function ${name}(`));

const AREA_A = {
  id: 'area-lower-0',
  section: 'lower',
  x: 0,
  y: 0,
  W: 2400,
  H: 870,
  D: 650,
  rotation: 0,
};
const AREA_B = {
  id: 'area-lower-1',
  section: 'lower',
  x: 3000,
  y: 900,
  W: 2400,
  H: 870,
  D: 650,
  rotation: 0,
};

function lineA() {
  return [
    {
      id: 'lower-0',
      areaId: 'area-lower-0',
      section: 'lower',
      W: 600,
      H: 870,
      D: 550,
      x: 60,
      y: 0,
      rotation: 0,
      finishings: [],
    },
    {
      id: 'lower-1',
      areaId: 'area-lower-0',
      section: 'lower',
      W: 900,
      H: 870,
      D: 550,
      x: 660,
      y: 0,
      rotation: 0,
      finishings: [],
    },
    {
      id: 'ep-0',
      areaId: 'area-lower-0',
      section: 'ep',
      W: 18,
      H: 870,
      D: 650,
      x: 1560,
      y: 0,
      isFinishing: true,
      hostId: 'lower-1',
      hostSide: 'right',
      finishings: [],
    },
    // 배치 끝 마감재 (hostId 없음) — 복사하지 않는다
    {
      id: 'filler-0',
      areaId: 'area-lower-0',
      section: 'filler',
      W: 60,
      H: 870,
      D: 650,
      x: 0,
      y: 0,
      isFinishing: true,
      finishings: [],
    },
    // 멍장 — 코너 짝에 묶여 있어 복사하지 않는다
    {
      id: 'lower-9',
      areaId: 'area-lower-0',
      section: 'lower',
      W: 700,
      H: 870,
      D: 550,
      x: 1700,
      y: 0,
      blind: { zoneW: 600 },
      isDerived: true,
      finishings: [],
    },
  ];
}
const STRUCTS = {
  'lower-0': { verticalCount: 1, areaTypes: ['drawer'], drawerRatio: '2:1:1' },
  'lower-1': { verticalCount: 2, areaTypes: ['door', 'door'], areaDirections: ['left', 'right'] },
};

describe('planner-combo — 복사', () => {
  test('본 모듈 + 붙은 마감재, 왼쪽 기준 상대 자리, 구조는 깊은 복사', () => {
    const mods = lineA();
    const r = C.plannerComboCopy(
      mods.filter((m) => m.areaId === 'area-lower-0'),
      mods,
      STRUCTS
    );
    expect(r.ok).toBe(true);
    const c = r.combo;
    expect(c.count).toBe(2);
    expect(c.items.map((it) => it.fields.section)).toEqual(['lower', 'lower', 'ep']);
    expect(c.items.map((it) => it.relX)).toEqual([0, 600, 1500]);
    expect(c.span).toBe(1518);
    expect(c.items[2].host).toBe(1);
    expect(c.items[0].structure).toEqual(STRUCTS['lower-0']);
    expect(c.items[0].structure).not.toBe(STRUCTS['lower-0']);
    c.items.forEach((it) => {
      ['id', 'areaId', 'x', 'y', 'hostId', 'isDerived'].forEach((k) =>
        expect(it.fields[k]).toBeUndefined()
      );
    });
  });

  test('가전 자리·냉장고 칸·멍장만 있으면 빈 조합', () => {
    const marker = { id: 'sink-0', section: 'sink', W: 800, x: 0 };
    const niche = { id: 'fridge-1', section: 'fridge', W: 700, x: 0, fridgeNiche: { i: 0 } };
    const r = C.plannerComboCopy(
      [marker, niche, lineA()[4]],
      [],
      {},
      { isMarker: (s) => s === 'sink' }
    );
    expect(r).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('planner-combo — 붙여넣기', () => {
  const combo = C.plannerComboCopy(lineA().slice(0, 3), lineA(), STRUCTS).combo;
  let n = 0;
  const ctx = (slots) => ({
    freeSlots: slots,
    sections: ['lower', 'sink', 'dishwasher'],
    nextId: (s) => `${s}-p${n++}`,
    roomD: 620,
  });

  test('첫 맞는 빈 자리에 같은 간격으로, 새 id·배치·마감재 주인 다시 잇기', () => {
    n = 0;
    const r = C.plannerComboPaste(
      combo,
      AREA_B,
      ctx([
        { x: 3000, w: 900 },
        { x: 4000, w: 1400 },
        { x: 3900, w: 1600 },
      ])
    );
    expect(r.ok).toBe(true);
    expect(r.x).toBe(3900);
    expect(r.modules.map((m) => [m.id, m.x, m.areaId])).toEqual([
      ['lower-p0', 3900, 'area-lower-1'],
      ['lower-p1', 4500, 'area-lower-1'],
      ['ep-p2', 5400, 'area-lower-1'],
    ]);
    expect(r.modules[2].hostId).toBe('lower-p1');
    expect(r.modules.every((m) => m.y === 900)).toBe(true);
    expect(r.structures['lower-p0']).toEqual(STRUCTS['lower-0']);
    expect(r.structures['ep-p2']).toBeUndefined();
  });

  test('폭이 모자라면 놓지 않는다 — 가장 넓은 빈 자리를 알려 준다', () => {
    const r = C.plannerComboPaste(
      combo,
      AREA_B,
      ctx([
        { x: 3000, w: 900 },
        { x: 4000, w: 1400 },
      ])
    );
    expect(r).toEqual({ ok: false, reason: 'width', need: 1518, room: 1400 });
  });

  test('넣을 수 없는 섹션·높이 초과는 막는다', () => {
    expect(
      C.plannerComboPaste(
        combo,
        AREA_B,
        Object.assign(ctx([{ x: 3000, w: 2400 }]), { sections: ['upper'] })
      ).reason
    ).toBe('section');
    const low = Object.assign({}, AREA_B, { H: 450 });
    expect(C.plannerComboPaste(combo, low, ctx([{ x: 3000, w: 2400 }]))).toEqual({
      ok: false,
      reason: 'height',
      need: 870,
      room: 450,
    });
  });

  test('몸통 깊이는 배치 깊이 상한(roomD)을 넘지 않는다', () => {
    const r = C.plannerComboPaste(
      combo,
      AREA_B,
      Object.assign(ctx([{ x: 3000, w: 2400 }]), { roomD: 500 })
    );
    expect(r.modules.filter((m) => !m.isFinishing).map((m) => m.D)).toEqual([500, 500]);
    expect(r.modules[2].D).toBe(650);
  });
});

describe('planner-combo — 클립보드', () => {
  test('sessionStorage 에 담고 되읽는다, 막히면 메모리', () => {
    const box = {};
    const store = {
      setItem: (k, v) => {
        box[k] = v;
      },
      getItem: (k) => box[k] || null,
    };
    const combo = { v: 1, span: 600, count: 1, items: [{ relX: 0, fields: { section: 'lower' } }] };
    C.plannerComboSave(combo, store);
    expect(JSON.parse(box[C.PLANNER_COMBO_STORE_KEY])).toEqual(combo);
    expect(C.plannerComboLoad(store)).toEqual(combo);
    const broken = {
      setItem: () => {
        throw new Error('blocked');
      },
      getItem: () => {
        throw new Error('blocked');
      },
    };
    C.plannerComboSave(Object.assign({}, combo, { span: 700 }), broken);
    expect(C.plannerComboLoad(broken).span).toBe(700);
  });
});

describe('mockup-structure 배선 — copyComboFrom / pasteComboInto', () => {
  function harness(mods, activeId) {
    const env = {
      modules: mods,
      structures: JSON.parse(JSON.stringify(STRUCTS)),
      activeId,
      comboClip: null,
      saved: 0,
      seated: [],
    };
    const areas = [AREA_A, AREA_B];
    // 정본 멤버십 흉내 — areaId 가 없으면 x 범위로 찾는다 (옛 설계)
    const areaIdOfModule = (m) =>
      m.areaId || (areas.find((a) => m.x >= a.x && m.x < a.x + a.W) || {}).id || null;
    const body = `${fnSrc('copyComboFrom')}\n${fnSrc('pasteComboInto')}\nreturn { copyComboFrom, pasteComboInto };`;
    const make = new Function(
      'env',
      'PlannerCombo',
      'areaIdOfModule',
      'moduleById',
      'isMarkerSection',
      'freeSlotsOf',
      'sectionsFor',
      'seatModuleDepth',
      'persistPlannerState',
      'MASTER_RULES',
      `with (env) { ${body} }`
    );
    const pc = {
      copy: C.plannerComboCopy,
      paste: C.plannerComboPaste,
      save: () => {},
      load: () => env.comboClip,
    };
    const fns = make(
      env,
      pc,
      areaIdOfModule,
      (id) => env.modules.find((m) => m.id === id) || null,
      (s) => s === 'sink' || s === 'hood',
      (area) => (area.id === AREA_B.id ? [{ x: AREA_B.x, w: AREA_B.W }] : []),
      () => ['lower', 'sink', 'dishwasher'],
      (m) => env.seated.push(m.id),
      () => {
        env.saved++;
      },
      { CORNER_DRIP: 10, DOOR_SEAT_D: 20 }
    );
    return { env, fns };
  }

  test('배치를 고르면 그 배치 전부 (areaId 없는 옛 모듈 포함), 붙이면 구조째 들어가고 저장된다', () => {
    const mods = lineA().map((m) =>
      m.id === 'lower-0' ? Object.assign({}, m, { areaId: undefined }) : m
    );
    const { env, fns } = harness(mods, null);
    const c = fns.copyComboFrom(AREA_A);
    expect(c.ok).toBe(true);
    expect(c.combo.count).toBe(2); // lower-0 은 areaId 가 없어도 areaIdOfModule 로 들어온다
    const before = env.modules.length;
    const p = fns.pasteComboInto(AREA_B);
    expect(p.ok).toBe(true);
    const added = env.modules.slice(before);
    expect(added.map((m) => m.id)).toEqual(['lower-2', 'lower-3', 'ep-1']);
    expect(added.every((m) => m.areaId === AREA_B.id)).toBe(true);
    expect(env.structures['lower-2']).toEqual(STRUCTS['lower-0']);
    expect(env.structures['lower-3']).toEqual(STRUCTS['lower-1']);
    expect(added[2].hostId).toBe('lower-3');
    expect(env.seated).toEqual(['lower-2', 'lower-3', 'ep-1']);
    expect(env.saved).toBe(1);
  });

  test('모듈을 골랐으면 그 모듈만 (붙은 마감재째)', () => {
    const { fns } = harness(lineA(), 'lower-1');
    const c = fns.copyComboFrom(AREA_A);
    expect(c.combo.count).toBe(1);
    expect(c.combo.items.map((it) => it.fields.section)).toEqual(['lower', 'ep']);
  });

  test('영역 도구에 복사·붙여넣기 버튼이 있고 클립보드 선언이 처음 그리기 전에 있다', () => {
    const tools = fnSrc('renderAreaTools');
    expect(tools).toMatch(/class="at-copy"/);
    expect(tools).toMatch(/class="at-paste"/);
    expect(STRUCT.indexOf('let comboClip')).toBeLessThan(
      STRUCT.indexOf('function renderAreaTools(')
    );
    expect(STRUCT).toMatch(/<script src="js\/planner\/planner-combo\.js\?v=/);
  });
});
