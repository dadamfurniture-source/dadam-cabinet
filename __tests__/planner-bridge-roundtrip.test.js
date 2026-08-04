/**
 * 플래너 → BOM 왕복 통합 테스트.
 *
 * planner-to-bom.test.js 가 변환 함수만 본다면, 이 파일은 **배선**을 본다:
 *   mockup-structure 가 보내는 payload
 *     → ui-step1 의 message 리스너
 *     → _applyPlannerResult → selectedItems.modules 교체
 *     → 실제 MaterialExtractor 로 BOM 산출
 *
 * 세 파일이 서로 다른 필드명을 쓰기 시작하면 여기서 깨진다.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
const STRUCT = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');

/** 여는 중괄호부터 짝이 맞는 닫는 중괄호까지 잘라낸다. */
function sliceBalanced(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(startIdx, i + 1);
    }
  }
  throw new Error('중괄호 짝을 찾지 못했습니다');
}

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  const e = src.indexOf(endMarker, s + 1);
  if (s < 0 || e < 0) throw new Error(`마커를 찾지 못했습니다: ${startMarker}`);
  return src.slice(s, e);
}

/**
 * ui-step1.js 에서 브리지에 필요한 실제 코드만 뽑아 평가한다.
 * 전역 스크립트라 import 가 안 되므로 소스를 그대로 쓴다.
 */
function loadBridge(win, state) {
  const currentItemFn = sliceBalanced(UI, UI.indexOf('function _currentStep2Item'));
  const converterBlock = sliceBetween(UI, 'const PLANNER_CABINET_SECTIONS', 'function _appendV2Payload');
  const listenerIdx = UI.indexOf("window.addEventListener('message', function (e) {");
  const listenerBlock = sliceBalanced(UI, listenerIdx) + ');';

  const src = `
    ${currentItemFn}
    ${converterBlock}
    ${listenerBlock}
  `;

  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'window', 'selectedItems', 'currentItemId', 'dlog', 'updateUI', 'proceedToBOM',
    'incrementCategory', 'CATEGORIES', 'alert', 'console',
    src
  );
  factory(
    win,
    state.selectedItems,
    state.currentItemId,
    state.dlog,
    state.updateUI,
    state.proceedToBOM,
    state.incrementCategory,
    state.CATEGORIES,
    state.alert,
    state.console
  );
}

/** mockup-structure 가 실제로 보내는 payload 필드명을 소스에서 확인한다. */
function plannerPayloadFields() {
  const idx = STRUCT.indexOf("type: 'PLANNER_DONE'");
  const chunk = STRUCT.slice(idx - 200, idx + 700);
  return chunk;
}

function makeItem() {
  return {
    uniqueId: 42,
    categoryId: 'sink',
    labelName: '싱크대 #1',
    name: '싱크대',
    w: 2700,
    h: 2310,
    d: 650,
    specs: {
      upperH: 720, lowerH: 870, moldingH: 60, sinkLegHeight: 150,
      upperDoorOverlap: 15, topSizes: [{ w: '2700', d: '650' }],
      layoutShape: 'I', lowerLayoutShape: 'I',
      finishLeftType: 'None', finishRightType: 'None',
    },
    modules: [{ id: 'old-1', pos: 'lower', type: 'storage', name: '하부장', w: 600, h: 870, d: 650, doorCount: 1 }],
  };
}

/** mockup-structure 가 보내는 것과 같은 모양의 메시지. */
function plannerMessage() {
  return {
    type: 'PLANNER_DONE',
    source: 'mockup-structure',
    modules: [
      { id: 'lower-0', section: 'lower', W: 900, H: 870, D: 650, x: 0, y: 0, rotation: 0 },
      { id: 'lower-1', section: 'lower', W: 1200, H: 870, D: 650, x: 900, y: 0, rotation: 0 },
      { id: 'upper-0', section: 'upper', W: 800, H: 720, D: 320, x: 0, y: 1000, rotation: 0 },
      { id: 'sink-0', section: 'sink', W: 600, H: 100, D: 500, x: 100, y: 0, rotation: 0 },
      { id: 'hood-0', section: 'hood', W: 600, H: 300, D: 320, x: 100, y: 1000, rotation: 0 },
    ],
    structures: {
      'lower-0': { horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerHeight: 200,
                   areaTypes: ['door', 'door'], areaIs2D: [false, false], shelves: [] },
      'lower-1': { horizontalLayout: 'doorOnly', areaTypes: ['door'], areaIs2D: [true], shelves: [430] },
      'upper-0': { horizontalLayout: 'doorOnly', areaTypes: ['door'], areaIs2D: [false], shelves: [360] },
    },
  };
}

function setup() {
  const item = makeItem();
  const calls = { proceedToBOM: 0, updateUI: 0, alerts: [] };
  const listeners = [];
  const win = {
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
  };
  loadBridge(win, {
    selectedItems: [item],
    currentItemId: 42,
    dlog: () => {},
    updateUI: () => { calls.updateUI++; },
    proceedToBOM: () => { calls.proceedToBOM++; },
    incrementCategory: () => {},
    CATEGORIES: [{ id: 'sink' }],
    alert: (m) => { calls.alerts.push(m); },
    console: { error: () => {}, debug: () => {} },
  });
  const dispatch = (data) => listeners.forEach((fn) => fn({ data }));
  return { item, calls, dispatch };
}

// ── 계약: 세 파일이 같은 필드명을 쓴다 ──────────────────────────

describe('payload 필드명이 송신·수신 양쪽에서 일치한다', () => {
  test('mockup-structure 가 modules 와 structures 를 보낸다', () => {
    const chunk = plannerPayloadFields();
    expect(chunk).toMatch(/modules:/);
    expect(chunk).toMatch(/structures:/);
  });

  test('보내는 모듈 필드가 변환기가 읽는 것과 같다', () => {
    const chunk = plannerPayloadFields();
    // 변환기는 m.id / m.section / m.W / m.H / m.D / m.x 를 읽는다
    for (const f of ['id:', 'section:', 'W:', 'H:', 'D:', 'x:']) {
      expect(chunk).toContain(f);
    }
  });
});

// ── 배선 ──────────────────────────────────────────────────────

describe('PLANNER_DONE 배선', () => {
  test('메시지를 받으면 modules 가 교체되고 BOM 으로 진행한다', () => {
    const { item, calls, dispatch } = setup();
    expect(item.modules).toHaveLength(1); // 교체 전

    dispatch(plannerMessage());

    expect(item.modules).toHaveLength(3); // lower×2 + upper×1 (가전 제외)
    expect(calls.proceedToBOM).toBe(1);
    expect(calls.alerts).toHaveLength(0);
    expect(item.modules.some((m) => m.id === 'old-1')).toBe(false); // 기존 모듈 대체됨
  });

  test('개수대·후드장 라벨이 배선을 타고 반영된다', () => {
    const { item, dispatch } = setup();
    dispatch(plannerMessage());
    expect(item.modules.find((m) => m.name === '개수대')).toBeDefined();
    expect(item.modules.find((m) => m.name === '후드장')).toBeDefined();
    // type 은 전부 storage — 'hood' 면 extractors 가 상부장에서 걸러낸다
    expect(item.modules.every((m) => m.type === 'storage')).toBe(true);
  });

  test('자동계산 결과(도어·서랍·선반)가 모듈에 실린다', () => {
    const { item, dispatch } = setup();
    dispatch(plannerMessage());
    const sink = item.modules.find((m) => m.name === '개수대');
    expect(sink.doorCount).toBe(2);
    expect(sink.isDrawer).toBe(true);
    const twoDoor = item.modules.find((m) => m.w === 1200);
    expect(twoDoor.doorCount).toBe(2); // areaIs2D 양문
    expect(twoDoor.shelfCount).toBe(1);
  });

  test('캐비닛이 없으면 BOM 으로 넘어가지 않고 알린다', () => {
    const { item, calls, dispatch } = setup();
    dispatch({ type: 'PLANNER_DONE', modules: [{ id: 'sink-0', section: 'sink', W: 600, H: 100, D: 500, x: 0 }], structures: {} });
    expect(calls.proceedToBOM).toBe(0); // 진행 차단
    expect(calls.alerts).toHaveLength(1);
    expect(item.modules).toHaveLength(1); // 기존 유지 — 덮어쓰지 않음
  });

  test('다른 타입 메시지는 무시한다', () => {
    const { item, calls, dispatch } = setup();
    dispatch({ type: 'SOMETHING_ELSE' });
    expect(calls.proceedToBOM).toBe(0);
    expect(item.modules).toHaveLength(1);
  });
});

// ── BOM 까지 ──────────────────────────────────────────────────

describe('교체된 modules 로 실제 BOM 이 산출된다', () => {
  test('MaterialExtractor 가 도어·서랍을 모듈과 일치시켜 낸다', () => {
    const { item, dispatch } = setup();
    dispatch(plannerMessage());

    global.dlog = () => {};
    const { MaterialExtractor } = require(path.join(ROOT, 'js/detaildesign/extractors.js'));
    const result = new MaterialExtractor().extract({ items: [item] });

    expect(result.materials.length).toBeGreaterThan(0);

    const expectedDoors = item.modules.reduce((s, m) => s + (m.doorCount || 0), 0);
    const bomDoors = result.materials
      .filter((m) => m.part === '도어')
      .reduce((s, m) => s + (Number(m.qty) || 0), 0);
    expect(bomDoors).toBe(expectedDoors);

    const drawerModules = item.modules.filter((m) => m.isDrawer).length;
    const bomDrawerDoors = result.materials
      .filter((m) => m.part === '서랍도어')
      .reduce((s, m) => s + (Number(m.qty) || 0), 0);
    expect(bomDrawerDoors).toBe(drawerModules);
  });

  test('후드장 캐비닛도 몸통 부재가 산출된다 (BOM 에서 누락되지 않음)', () => {
    const { item, dispatch } = setup();
    dispatch(plannerMessage());

    global.dlog = () => {};
    const { MaterialExtractor } = require(path.join(ROOT, 'js/detaildesign/extractors.js'));
    const result = new MaterialExtractor().extract({ items: [item] });

    const hoodParts = result.materials.filter((m) => String(m.module).includes('후드장'));
    expect(hoodParts.length).toBeGreaterThan(0);
    // 몸통이 실제로 나와야 한다 — type:'hood' 였다면 통째로 빠졌다
    for (const part of ['측판', '천판', '지판', '뒷판']) {
      expect(hoodParts.some((m) => m.part === part)).toBe(true);
    }
  });
});
