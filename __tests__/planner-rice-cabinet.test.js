/**
 * 밥솥장 — 플래너에서 고른 것이 BOM 까지 가는가 (2026-10-20).
 *
 * 규칙 자체는 bom-rice-cabinet-rules.test.js 가 본다. 여기서는 배선을 본다:
 *   플래너 구조(structures[id].moduleKind = 'rice', rice.door)
 *     → 밑 모듈 판정(riceBelowOf — 같은 배치 안에서만, areaIdOfModule)
 *     → ui-step1 브리지(_convertPlannerModules)
 *     → MaterialExtractor.extractRiceCabinets (18T MDF 상자 + 도어)
 *     → HardwareExtractor (여닫이 경첩 · 리프트 가변철물)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
const STRUCT = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
const OC = require('../js/detaildesign/bom-open-cabinet-rules.js');
const RC = require('../js/detaildesign/bom-rice-cabinet-rules.js');

function sliceBalanced(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(startIdx, i + 1);
  }
  throw new Error('중괄호 짝을 찾지 못했습니다');
}

function sliceBetween(src, a, b) {
  const s = src.indexOf(a);
  const e = src.indexOf(b, s + 1);
  if (s < 0 || e < 0) throw new Error(`마커를 찾지 못했습니다: ${a}`);
  return src.slice(s, e);
}

function fnSrc(name) {
  return sliceBalanced(STRUCT, STRUCT.indexOf(`function ${name}(`));
}

describe('플래너 — 밥솥장 배선', () => {
  test('규칙 파일을 오픈장 다음에 싣고, 타입·도어 고르는 곳과 정면도·3D 경로가 있다', () => {
    const oc = STRUCT.indexOf('bom-open-cabinet-rules.js');
    const rc = STRUCT.indexOf('bom-rice-cabinet-rules.js');
    expect(oc).toBeGreaterThan(0);
    expect(rc).toBeGreaterThan(oc);
    expect(STRUCT).toMatch(/function renderRiceCabinetFront/);
    expect(STRUCT).toMatch(/function buildRiceCabinetMesh/);
    expect(STRUCT).toMatch(/id="selRiceDoor"/);
    expect(fnSrc('renderKindSection')).toMatch(/RR\.RULES\.KIND/);
  });

  test('payload 는 밥솥장일 때만 riceBelow 를 싣는다 — 다른 모듈은 예전과 같다', () => {
    const b = fnSrc('buildPlannerPayload');
    expect(b).toMatch(/if \(isRiceCabinet\(structures\[m\.id\]\)\) out\.riceBelow = riceBelowOf\(m\)/);
  });
});

describe('플래너 — 밥솥장 밑 모듈 판정 (riceBelowOf)', () => {
  // 배치 A(평면 y 0)와 배치 B(평면 y 2000)가 같은 x 에 있다. 멤버십은 정본 areaIdOfModule —
  //   areaId 가 없는 옛 모듈은 자리로 배치를 찾는다 (여기서는 평면 y 로 흉내 낸다).
  function make(modules, structures) {
    const src = `
      const isFinishingSection = (k) => ['ep','molding','filler','gap'].indexOf(k) >= 0;
      const getBaseY = () => 0;
      const areaIdOfModule = (m) => (m ? (m.areaId || (Number(m.y) < 1000 ? 'A' : 'B')) : null);
      const openCabinetRules = () => OC;
      const riceCabinetRules = () => RC;
      ${fnSrc('baseYOf')}
      ${fnSrc('isOpenCabinet')}
      ${fnSrc('isRiceCabinet')}
      ${fnSrc('isBoxKind')}
      ${fnSrc('riceBelowOf')}
      return riceBelowOf;
    `;
    // eslint-disable-next-line no-new-func
    return new Function('modules', 'structures', 'OC', 'RC', src)(modules, structures, OC, RC);
  }
  const rice = { id: 'rice', section: 'tall', areaId: 'A', x: 0, y: 0, W: 450, H: 500, baseY: 900 };
  const drawerS = { horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer' };

  test('바닥에 선 밥솥장은 밑이 비어 있다', () => {
    const f = make([], {});
    expect(f(Object.assign({}, rice, { baseY: 0 }))).toBe('none');
  });

  test('같은 배치의 areaId 없는 서랍 모듈을 찾는다', () => {
    const below = { id: 'low', section: 'tall', x: 0, y: 0, W: 450, H: 900, baseY: 0 };   // areaId 없음
    expect(make([rice, below], { low: drawerS })(rice)).toBe('drawer');
  });

  test('다른 배치의 서랍은 세지 않는다 — 같은 배치 밑이 도어면 other', () => {
    const doorBelow = { id: 'door', section: 'tall', areaId: 'A', x: 0, y: 0, W: 450, H: 900, baseY: 0 };
    const otherArea = { id: 'b-low', section: 'tall', x: 0, y: 2000, W: 450, H: 900, baseY: 0 };  // 배치 B
    const f = make([rice, doorBelow, otherArea], { door: { horizontalLayout: 'doorOnly' }, 'b-low': drawerS });
    expect(f(rice)).toBe('other');
    // 배치 A 밑이 비면 배치 B 서랍이 있어도 none
    expect(make([rice, otherArea], { 'b-low': drawerS })(rice)).toBe('none');
  });

  test('밑 모듈이 오픈장·밥솥장이면 서랍으로 치지 않는다', () => {
    const below = { id: 'low', section: 'tall', areaId: 'A', x: 0, y: 0, W: 450, H: 900, baseY: 0 };
    const f = make([rice, below], { low: Object.assign({ moduleKind: 'open' }, drawerS) });
    expect(f(rice)).toBe('other');
  });
});

/** 브리지를 실제 소스 그대로 평가한다 (planner-open-cabinet.test.js 와 같은 하네스). */
function setup(warns = []) {
  const item = {
    uniqueId: 7,
    categoryId: 'storage',
    labelName: '수납장 #1',
    name: '수납장',
    w: 1050, h: 450, d: 570,
    specs: {
      upperH: 720, lowerH: 870, moldingH: 0, sinkLegHeight: 0,
      upperDoorOverlap: 15, topSizes: [{ w: '1050', d: '570' }],
      layoutShape: 'I', lowerLayoutShape: 'I',
      finishLeftType: 'None', finishRightType: 'None',
    },
    modules: [],
  };
  const listeners = [];
  const win = {
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    confirm: () => true,
    DadamOpenCabinetRules: OC,
    DadamRiceCabinetRules: RC,
  };
  const src = `
    ${sliceBetween(UI, 'const NATIVE_ONLY_CATEGORIES', 'function _setStep2Mode')}
    ${sliceBalanced(UI, UI.indexOf('function _currentStep2Item'))}
    ${sliceBetween(UI, 'const PLANNER_CABINET_SECTIONS', 'function _appendV2Payload')}
    ${sliceBalanced(UI, UI.indexOf("window.addEventListener('message', function (e) {"))});
  `;
  // eslint-disable-next-line no-new-func
  new Function(
    'window', 'selectedItems', 'currentItemId', 'dlog', 'updateUI', 'proceedToBOM',
    'incrementCategory', 'CATEGORIES', 'alert', 'console', 'showToast', 'document', src
  )(
    win, [item], 7, () => {}, () => {}, () => {}, () => {}, [{ id: 'storage' }],
    () => {}, { error() {}, warn: (...a) => warns.push(a.join(' ')), debug() {} }, () => {},
    { querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {} }) }
  );
  return { item, dispatch: (data) => listeners.forEach((fn) => fn({ data })) };
}

/** 밥솥장(기본 외경 W450 × H500) 하나 + 일반 하부장 하나. */
function plannerMessage(door, riceBelow) {
  return {
    type: 'PLANNER_DONE',
    source: 'mockup-structure',
    modules: [
      { id: 'lower-rice', section: 'lower', W: 450, H: 500, D: 570, x: 0, y: 0, rotation: 0, riceBelow },
      { id: 'lower-normal', section: 'lower', W: 600, H: 500, D: 570, x: 450, y: 0, rotation: 0 },
    ],
    structures: {
      // 칸·서랍 값이 남아 있어도 무시된다 (타입을 되돌릴 수 있게 지우지 않는다)
      'lower-rice': {
        moduleKind: 'rice', rice: door ? { door } : undefined, horizontalLayout: 'doorOnly',
        areaTypes: ['door'], areaWidths: [450], areaIs2D: [false], shelves: [200],
      },
      'lower-normal': {
        horizontalLayout: 'doorOnly',
        areaTypes: ['door'], areaWidths: [600], areaIs2D: [false], shelves: [],
      },
    },
  };
}

function extract(item) {
  global.dlog = () => {};
  const { MaterialExtractor, HardwareExtractor } = require(path.join(ROOT, 'js/detaildesign/extractors.js'));
  return {
    materials: new MaterialExtractor().extract({ items: [item] }).materials,
    hardware: new HardwareExtractor().extract({ items: [item] }).hardware,
  };
}

describe('브리지 — 밥솥장 모듈 하나가 도어 종류를 달고 간다', () => {
  test('오픈(기본)이면 도어 0 · doorType 없음, 여닫이면 도어 1 · doorType swing', () => {
    const a = setup();
    a.dispatch(plannerMessage(null, 'drawer'));
    const r0 = a.item.modules.filter((m) => m.moduleKind === 'rice');
    expect(r0).toHaveLength(1);
    expect(r0[0]).toMatchObject({ name: '밥솥장', doorCount: 0, doorType: null, isDrawer: false, w: 450, d: 570 });

    const b = setup();
    b.dispatch(plannerMessage('swing', 'drawer'));
    const r1 = b.item.modules.find((m) => m.moduleKind === 'rice');
    expect(r1).toMatchObject({ doorCount: 1, doorType: 'swing' });
    expect(b.item.modules.filter((m) => m.moduleKind !== 'rice')).toHaveLength(1);
  });
});

describe('BOM — 밥솥장', () => {
  test('오픈이면 오픈장 세 줄(18T MDF)만, 천지판 비고에 슬라이딩 선반 [확인 필요]', () => {
    const { item, dispatch } = setup();
    dispatch(plannerMessage(null, 'drawer'));
    const mod = item.modules.find((m) => m.moduleKind === 'rice');
    const expected = OC.partsOf({ W: mod.w, H: mod.h, D: mod.d });
    const { materials, hardware } = extract(item);
    const rows = materials.filter((r) => String(r.module).includes('밥솥장'));
    expect(rows.map((r) => r.part)).toEqual(['측판', '천지판', '뒷판']);
    rows.forEach((r, i) => {
      expect(r.material).toBe('MDF');
      expect([Number(r.w), Number(r.h), Number(r.qty)]).toEqual([expected[i].w, expected[i].h, expected[i].qty]);
    });
    expect(rows[1].note).toMatch(/슬라이딩 선반 \[확인 필요\]/);
    expect(hardware.some((h) => String(h.note || h.module || '').includes('밥솥장'))).toBe(false);
  });

  test('여닫이면 도어 (W−4)×(H−4) 한 장과 그 높이로 센 경첩, 카테고리 추출기는 두 벌 내지 않는다', () => {
    const { item, dispatch } = setup();
    dispatch(plannerMessage('swing', 'drawer'));
    const mod = item.modules.find((m) => m.moduleKind === 'rice');
    const { materials, hardware } = extract(item);
    const rows = materials.filter((r) => String(r.module).includes('밥솥장'));
    expect(rows.map((r) => r.part)).toEqual(['측판', '천지판', '뒷판', '도어']);
    const door = rows[3];
    expect([Number(door.w), Number(door.h), Number(door.qty)]).toEqual([mod.w - 4, mod.h - 4, 1]);
    expect(door.note).toMatch(/여닫이/);

    const hinge = hardware.filter((h) => h.category === '경첩' && h.module === '밥솥장');
    expect(hinge).toHaveLength(1);
    expect(hinge[0].qty).toBe(2);                        // 도어 H ≤ 900 → 2구
    expect(hinge[0].boring).toEqual([110, mod.h - 4 - 110]);

    const without = new (require(path.join(ROOT, 'js/detaildesign/extractors.js')).MaterialExtractor)()
      .extract({ items: [Object.assign({}, item, { modules: item.modules.filter((m) => m.moduleKind !== 'rice') })] });
    expect(materials.length - without.materials.length).toBe(4);
  });

  test('리프트면 경첩 대신 가변철물 1 SET, 포켓은 도어 비고에 철물 [확인 필요]', () => {
    const a = setup();
    a.dispatch(plannerMessage('liftup', 'drawer'));
    const ha = extract(a.item).hardware.filter((h) => h.module === '밥솥장');
    expect(ha.map((h) => h.category)).toEqual(['리프트업']);
    expect(ha[0].qty).toBe(1);

    const b = setup();
    b.dispatch(plannerMessage('pocket', 'drawer'));
    const door = extract(b.item).materials.find((r) => String(r.module).includes('밥솥장') && r.part === '도어');
    expect(door.note).toMatch(/포켓 도어 \[확인 필요\] 철물/);
  });

  test('밑에 서랍이 없으면 브리지가 경고를 남기고, 서랍이면 남기지 않는다', () => {
    const w1 = [];
    setup(w1).dispatch(plannerMessage(null, 'none'));
    expect(w1.join('\n')).toMatch(/lower-rice: 밥솥장 밑에 서랍이 없습니다/);
    const w2 = [];
    setup(w2).dispatch(plannerMessage(null, 'drawer'));
    expect(w2.join('\n')).not.toMatch(/밥솥장/);
  });
});

describe('플래너 — 실제 부팅에서 밥솥장을 고른다', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { bootPlanner } = require('../test-utils/planner-harness');

  test('타입을 밥솥장으로 바꾸면 도어 고르는 칸과 밑 서랍 경고가 뜨고, 여닫이를 고르면 정면도에 도어가 그려진다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=rice1&item=1', storage: {} });
    const area = p.g('areas').find((a) => a.section === 'lower') || p.g('areas')[0];
    const m = p.g('addModuleToArea')(area.id);
    p.g('setActiveModule')(m.id);
    p.g('renderRightPanel')();
    const sel = p.document.getElementById('selModuleKind');
    sel.value = 'rice';
    sel.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    const door = p.document.getElementById('selRiceDoor');
    expect(door).not.toBeNull();
    expect(door.value).toBe('none');
    // 하부 라인 모듈은 바닥에 선다 — 밑에 서랍이 없다
    expect(p.document.getElementById('riceWarn').textContent).toMatch(/밑에 서랍이 없습니다/);
    door.value = 'swing';
    door.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    p.g('applyModuleDraft')();
    const s = p.g('getStructure')(m.id);
    expect(s.moduleKind).toBe('rice');
    expect(s.rice).toEqual({ door: 'swing' });
    expect(p.document.querySelector(`[data-rice-door="swing"]`)).not.toBeNull();
    expect(p.document.querySelector('[data-rice-shelf]')).not.toBeNull();
    // 칸·서랍·손잡이 섹션은 닫힌다 (오픈장과 같다)
    ['split', 'areas', 'handle'].forEach((k) => {
      const sec = p.document.querySelector(`#modulePanel .section[data-mp="${k}"]`);
      if (sec) expect(sec.classList.contains('off')).toBe(true);
    });
    expect(p.errors).toEqual([]);
  });
});
