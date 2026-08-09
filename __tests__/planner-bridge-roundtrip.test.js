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
    'incrementCategory', 'CATEGORIES', 'alert', 'console', 'showToast', 'document',
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
    state.console,
    state.showToast,
    state.document
  );
}

/** mockup-structure 가 실제로 보내는 payload 필드명을 소스에서 확인한다. */
function plannerPayloadFields() {
  const idx = STRUCT.indexOf('function buildPlannerPayload');
  if (idx < 0) throw new Error('buildPlannerPayload 를 찾지 못했습니다 — mockup-structure 구조가 바뀌었는지 확인하세요.');
  return sliceBalanced(STRUCT, idx);
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
      // H 는 전체 높이 (상부 780 = 몸통 720 + 상몰딩 60)
      { id: 'upper-0', section: 'upper', W: 800, H: 780, D: 320, x: 0, y: 1000, rotation: 0 },
      { id: 'sink-0', section: 'sink', W: 600, H: 100, D: 500, x: 100, y: 0, rotation: 0 },
      { id: 'hood-0', section: 'hood', W: 600, H: 300, D: 320, x: 100, y: 1000, rotation: 0 },
    ],
    // 자동계산이 끝난 상태 — areaWidths 로 셀이 나뉘어 있다
    structures: {
      'lower-0': { horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerHeight: 200,
                   areaTypes: ['door', 'door'], areaWidths: [450, 450], areaIs2D: [false, false], shelves: [] },
      'lower-1': { horizontalLayout: 'doorOnly',
                   areaTypes: ['door'], areaWidths: [1200], areaIs2D: [true], shelves: [430] },
      'upper-0': { horizontalLayout: 'doorOnly',
                   areaTypes: ['door'], areaWidths: [800], areaIs2D: [false], shelves: [360] },
    },
  };
}

function setup(opts = {}) {
  const item = makeItem();
  const calls = { proceedToBOM: 0, updateUI: 0, alerts: [], confirms: [] };
  const listeners = [];
  const win = {
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
    confirm: (m) => { calls.confirms.push(m); return opts.confirmResult !== false; },
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
    console: { error: () => {}, warn: () => {}, debug: () => {} },
    showToast: () => {},
    document: { querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {} }) },
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
    expect(chunk).toMatch(/hasStructures:/); // 자동계산 여부 안내용
  });

  test('툴바 요청(REQUEST_PLANNER_STATE)에 응답하는 리스너가 있다', () => {
    expect(STRUCT).toMatch(/REQUEST_PLANNER_STATE/);
    expect(STRUCT).toMatch(/sendPlannerState\('PLANNER_STATE'\)/);
    expect(STRUCT).toMatch(/sendPlannerState\('PLANNER_DONE'\)/);
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
  test('메시지를 받으면 modules 가 셀 단위로 교체되고 BOM 으로 진행한다', () => {
    const { item, calls, dispatch } = setup();
    expect(item.modules).toHaveLength(1); // 교체 전

    dispatch(plannerMessage());

    // lower-0 이 2셀로 나뉘므로 사각형 3개 → 모듈 4개 (가전 제외)
    expect(item.modules).toHaveLength(4);
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

  test('자동계산 결과(도어·서랍·선반)가 셀별로 실린다', () => {
    const { item, dispatch } = setup();
    dispatch(plannerMessage());

    // lower-0 은 450 셀 2개로 나뉜다 — 각 셀 도어 1장, 서랍 1단
    const sinkCells = item.modules.filter((m) => m.name === '개수대');
    expect(sinkCells.length).toBeGreaterThan(0);
    expect(sinkCells[0].doorCount).toBe(1);
    expect(sinkCells[0].isDrawer).toBe(true);
    expect(sinkCells[0].w).toBe(450);

    // lower-1 은 1200 단일 셀 + areaIs2D → 양문 2장
    const twoDoor = item.modules.find((m) => m.w === 1200);
    expect(twoDoor.doorCount).toBe(2);
    expect(twoDoor.is2door).toBe(true);
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

  test('PLANNER_STATE 는 반영만 하고 BOM 으로 넘어가지 않는다', () => {
    // 툴바 "BOM 산출" 이 요청한 응답 — 대기 중인 쪽이 직접 이어서 처리한다
    const { item, calls, dispatch } = setup();
    dispatch({ ...plannerMessage(), type: 'PLANNER_STATE' });
    expect(item.modules.length).toBeGreaterThan(1); // 반영은 됨
    expect(calls.proceedToBOM).toBe(0); // 자동 진행은 안 함
  });
});

describe('자동계산 없이 진행할 때 안내', () => {
  test('hasStructures=false 면 확인을 묻고, 거절하면 반영하지 않는다', () => {
    const { item, calls, dispatch } = setup({ confirmResult: false });
    dispatch({ ...plannerMessage(), structures: {}, hasStructures: false });
    expect(calls.confirms).toHaveLength(1);
    expect(calls.confirms[0]).toMatch(/자동계산/);
    expect(item.modules).toHaveLength(1); // 원래 모듈 유지
    expect(calls.proceedToBOM).toBe(0);
  });

  test('확인하면 통짜로라도 진행한다', () => {
    const { item, calls, dispatch } = setup({ confirmResult: true });
    dispatch({ ...plannerMessage(), structures: {}, hasStructures: false });
    expect(item.modules.length).toBeGreaterThan(0);
    expect(calls.proceedToBOM).toBe(1);
  });

  test('자동계산을 돌렸으면 묻지 않는다', () => {
    const { calls, dispatch } = setup();
    dispatch(plannerMessage()); // hasStructures 미지정 = 기존 동작
    expect(calls.confirms).toHaveLength(0);
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

  test('상부장 doorCount — undefined 는 1, 0 은 0 (오픈 셀에 없는 도어가 생기면 안 됨)', () => {
    global.dlog = () => {};
    const { MaterialExtractor } = require(path.join(ROOT, 'js/detaildesign/extractors.js'));
    const specs = { upperH: 720, lowerH: 870, upperDoorOverlap: 15, topSizes: [{ w: '1200', d: '650' }] };
    const base = { uniqueId: 1, categoryId: 'sink', name: '싱크대', w: 1200, h: 2310, d: 650, specs };

    const doorsOf = (modules) =>
      new MaterialExtractor()
        .extract({ items: [{ ...base, modules }] })
        .materials.filter((m) => m.part === '도어')
        .reduce((s, m) => s + (Number(m.qty) || 0), 0);

    // 기존 저장 설계는 doorCount 를 넣지 않는다 → 폴백 1 이 유지돼야 한다
    expect(doorsOf([{ pos: 'upper', type: 'storage', name: '상부장', w: 600, h: 720, d: 320 }])).toBe(1);

    // 플래너 오픈 셀은 doorCount 0 을 명시한다 → 도어가 생기면 안 된다
    expect(
      doorsOf([{ pos: 'upper', type: 'storage', name: '후드장', w: 800, h: 720, d: 320, doorCount: 0, isOpen: true }])
    ).toBe(0);

    // 명시값은 그대로
    expect(doorsOf([{ pos: 'upper', type: 'storage', name: '상부장', w: 900, h: 720, d: 320, doorCount: 2 }])).toBe(2);
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
