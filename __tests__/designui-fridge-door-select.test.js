/**
 * C2 후속 — 냉장고장(ui-fridge-el.js) 도어 마감 셀렉트도 카탈로그 코드 하나로.
 *
 *   냉장고장은 도어 묶음이 하나라 붙박이장처럼 'item' 으로 그린다:
 *     FurnitureOptionCatalog.buildDoorMaterialFieldHtml(item.uniqueId, 'item', item.specs, 'fridge')
 *   바꾸면 updateDoorMaterial(uid, 'item', code) (ui-step1.js 전역) 이
 *     specs.doorMaterialUpper/Lower = code · doorColor* · doorFinish* 파생 · item.detail.item.door = {code}
 *   를 적는다 — BOM 의 legacyDoorEntryFor 는 섹션별 키(Upper/Lower)를 읽으므로 둘 다 채워져야 한다.
 *
 * ui-fridge-el.js / ui-step1.js / config-constants.js / data-constants.js 는 전역 스크립트라
 * designui-catalog-select.test.js 처럼 소스에서 블록을 잘라 new Function 으로 실제 코드를 평가한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const UI = read('js/detaildesign/ui-step1.js');
const FRIDGE = read('js/detaildesign/ui-fridge-el.js');
const CONFIG = read('js/detaildesign/config-constants.js');
const DATA = read('js/detaildesign/data-constants.js');

require('../js/detaildesign/bom-finish-color.js');   // window.DadamBomFinishColor (config-constants 가 참조)

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  const e = src.indexOf(endMarker, s + 1);
  if (s < 0 || e < 0) throw new Error(`마커를 찾지 못했습니다: ${startMarker}`);
  return src.slice(s, e);
}

// 예림 시드 모양 + 옛 색 행 — OAK 는 applicable_to 에 fridge 가 없어 냉장고장 셀렉트에 나오면 안 된다
const ROWS = [
  { category: 'door_material', slot: ['door', 'drawer_front'], applicable_to: ['sink', 'wardrobe', 'fridge'], vendor: 'yerim', series: 'Supreme', finish: 'Supreme PET Matt',
    code: 'YR-SM-01', vendor_code: 'SM-01', tone: 'matte', color_name: '매트 화이트', color_hex: '#fbfbfb', sort: 1030, sort_order: 1030 },
  { category: 'door_material', slot: ['door', 'drawer_front'], applicable_to: ['sink', 'wardrobe', 'fridge'], vendor: 'yerim', series: 'Supreme', finish: 'Supreme PET Glossy',
    code: 'YR-U1802', vendor_code: 'U1802', tone: 'gloss', color_name: '글로시 다크그레이', color_hex: '#5b5758', sort: 1060, sort_order: 1060 },
  { category: 'door', slot: ['door'], applicable_to: ['sink', 'wardrobe', 'fridge'], code: 'WHT', color_name: '화이트', color_hex: '#f5f5f5', sort_order: 1 },
  { category: 'door', slot: ['door'], applicable_to: ['sink', 'wardrobe'], code: 'OAK', color_name: '오크', color_hex: '#c4a35a', sort_order: 5 },
];

function fakeSupabase(rows) {
  const q = { select: () => q, eq: () => q, order: async () => ({ data: rows, error: null }) };
  return { client: { from: () => q } };
}

/** config-constants.js 를 평가해 카탈로그를 얻는다 (window.FurnitureOptionCatalog 에도 실린다) */
async function loadConfig(selectedItems, rows) {
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'window', 'document', 'selectedItems', 'SupabaseUtils', 'CATEGORIES', 'DEFAULT_SPECS', 'updateUI',
    CONFIG + '\nreturn { FurnitureOptionCatalog };'
  );
  const C = factory(window, document, selectedItems, fakeSupabase(rows), [], {}, () => {}).FurnitureOptionCatalog;
  await C.load();
  return C;
}

/** ui-fridge-el.js 의 renderFridgeWorkspace 만 잘라 data-constants 전체와 함께 평가한다 (최상위 goToStep2 호출은 밖에 둔다) */
function loadFridgeRenderer(catalog, selectedItems) {
  const block = sliceBetween(FRIDGE, 'function renderFridgeWorkspace', 'function changeFridgeBrand');
  // eslint-disable-next-line no-new-func
  const factory = new Function('window', 'document', 'FurnitureOptionCatalog', 'selectedItems', `${DATA}\n${block}\nreturn { renderFridgeWorkspace };`);
  return factory(window, document, catalog, selectedItems).renderFridgeWorkspace;
}

/** ui-step1.js 의 D1+C2 블록 — updateDoorMaterial */
function loadSync(state) {
  const block = sliceBetween(UI, '// D1: 플래너 디테일(마감) 모델 왕복', 'function _loadPlannerEmbed');
  const src = `
    let hasUnsavedChanges = false;
    ${block}
    return { dirty: () => hasUnsavedChanges, updateDoorMaterial };`;
  // eslint-disable-next-line no-new-func
  const factory = new Function('window', 'document', 'location', 'selectedItems', 'updateSaveStatus', 'setTimeout', 'pushUndo', 'renderWorkspaceContent', src);
  return factory(window, document, window.location, state.selectedItems, state.updateSaveStatus || (() => {}), setTimeout,
    state.pushUndo, state.renderWorkspaceContent);
}

function makeFridgeItem(over = {}) {
  return {
    uniqueId: 42, categoryId: 'fridge', name: '냉장고장', labelName: '냉장고장', w: 2400, h: 2310, d: 700,
    specs: {
      doorColorUpper: '화이트', doorFinishUpper: '무광', doorColorLower: '화이트', doorFinishLower: '무광',
      doorMaterialUpper: null, doorMaterialLower: null,
      fridgeBrand: 'LG', fridgePedestal: 60, fridgeModuleD: 550, finishLeftType: 'None', finishRightType: 'None',
    },
    modules: [],
    ...over,
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="designWorkspace"></div>';
  delete window.plannerFinishResolve;
  delete window.plannerFinishEmpty;
  delete window.plannerFinishSet;
  delete window.selectedItems;
});

describe('냉장고장 워크스페이스 — 도어 마감 한 칸 (item 단위)', () => {
  test('스펙 패널에 카탈로그 셀렉트가 그려지고, onchange 는 updateDoorMaterial(uid, "item")', async () => {
    const item = makeFridgeItem();
    const C = await loadConfig([item], ROWS);
    const render = loadFridgeRenderer(C, [item]);
    render(item);
    const ws = document.getElementById('designWorkspace');
    const sel = ws.querySelector('.door-material-select');
    expect(sel).not.toBeNull();
    expect(sel.dataset.group).toBe('item');
    expect(sel.getAttribute('onchange')).toBe("updateDoorMaterial(42, 'item', this.value)");
    // 색 견본 + 도어 마감 라벨
    expect(ws.querySelector('.door-material-field .door-swatch')).not.toBeNull();
    expect(ws.innerHTML).toContain('<div class="spec-group-title">도어 마감</div>');
    // 셀렉트는 하나뿐 — 상/하 두 칸이나 옛 마감·색 셀렉트 쌍이 아니다
    expect(ws.querySelectorAll('.door-material-select')).toHaveLength(1);
  });

  test("furnitureType 'fridge' 로 거른다 — applicable_to 에 fridge 가 없는 OAK 는 안 나온다, 옛 품목은 WHT-M 을 미리 고른다", async () => {
    const item = makeFridgeItem();
    const C = await loadConfig([item], ROWS);
    loadFridgeRenderer(C, [item])(item);
    const sel = document.querySelector('.door-material-select');
    const values = [...sel.querySelectorAll('option')].map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(['YR-SM-01', 'YR-U1802', 'WHT-M', 'WHT-G']));
    expect(values.some((v) => v.startsWith('OAK'))).toBe(false);
    // doorMaterial* 없음 + 화이트·무광 → 기타(호환) WHT-M
    expect(sel.value).toBe('WHT-M');
  });

  test('doorMaterialUpper 가 있으면 그 코드를 미리 고른다', async () => {
    const item = makeFridgeItem({ specs: { ...makeFridgeItem().specs, doorMaterialUpper: 'YR-U1802', doorMaterialLower: 'YR-U1802' } });
    const C = await loadConfig([item], ROWS);
    loadFridgeRenderer(C, [item])(item);
    const sel = document.querySelector('.door-material-select');
    expect(sel.value).toBe('YR-U1802');
    expect(document.querySelector('.door-swatch').getAttribute('style')).toContain('background:#5b5758');
  });
});

describe('셀렉트 변경 — updateDoorMaterial(uid, "item") 이 냉장고장 사양을 상·하 같이 적는다', () => {
  async function armed(over = {}) {
    const item = makeFridgeItem(over);
    const items = [item];
    await loadConfig(items, ROWS);
    const undo = [], rendered = [];
    const S = loadSync({ selectedItems: items, pushUndo: (it) => undo.push(JSON.parse(JSON.stringify(it.specs))), renderWorkspaceContent: (it) => rendered.push(it.uniqueId) });
    return { S, item, undo, rendered };
  }

  test('YR-SM-01 → doorMaterialUpper/Lower + 매트 화이트 · 무광 둘 다, detail.item.door, 재렌더, 수정됨', async () => {
    const { S, item, undo, rendered } = await armed();
    expect(S.updateDoorMaterial(42, 'item', 'YR-SM-01')).toBe(true);
    expect(item.specs).toMatchObject({
      doorMaterialUpper: 'YR-SM-01', doorColorUpper: '매트 화이트', doorFinishUpper: '무광',
      doorMaterialLower: 'YR-SM-01', doorColorLower: '매트 화이트', doorFinishLower: '무광',
    });
    // 냉장고장 사양은 그대로
    expect(item.specs).toMatchObject({ fridgeBrand: 'LG', fridgePedestal: 60 });
    expect(item.detail).toEqual({ version: 1, item: { door: { code: 'YR-SM-01' } }, sections: { upper: {}, lower: {} }, modules: {}, parts: {} });
    expect(undo).toHaveLength(1);
    expect(undo[0].doorMaterialUpper).toBeNull();
    expect(rendered).toEqual([42]);   // 냉장고장은 플래너 iframe 이 없다 — 워크스페이스만 다시 그린다
    expect(S.dirty()).toBe(true);
  });

  test('유광 행 → doorFinish* 둘 다 유광; 합성 코드 WHT-G 도 같은 길; 같은 코드 다시 고르면 아무것도 안 한다', async () => {
    const { S, item, undo } = await armed();
    S.updateDoorMaterial(42, 'item', 'YR-U1802');
    expect(item.specs).toMatchObject({ doorFinishUpper: '유광', doorFinishLower: '유광', doorColorUpper: '글로시 다크그레이', doorColorLower: '글로시 다크그레이' });
    S.updateDoorMaterial(42, 'item', 'WHT-G');
    expect(item.specs).toMatchObject({ doorMaterialUpper: 'WHT-G', doorMaterialLower: 'WHT-G', doorColorUpper: '화이트', doorFinishUpper: '유광', doorColorLower: '화이트', doorFinishLower: '유광' });
    expect(item.detail.item.door).toEqual({ code: 'WHT-G' });
    expect(undo).toHaveLength(2);
    expect(S.updateDoorMaterial(42, 'item', 'WHT-G')).toBe(false);
    expect(undo).toHaveLength(2);
  });

  test('모르는 코드는 아무것도 바꾸지 않는다', async () => {
    const { S, item, undo } = await armed();
    expect(S.updateDoorMaterial(42, 'item', 'NOPE-X')).toBe(false);
    expect(item.specs.doorMaterialUpper).toBeNull();
    expect(item.detail).toBeUndefined();
    expect(undo).toHaveLength(0);
  });
});

describe('소스 규약', () => {
  test("냉장고장 스펙 패널이 buildDoorMaterialFieldHtml(item.uniqueId, 'item', item.specs, 'fridge') 를 쓴다", () => {
    expect(FRIDGE).toContain("FurnitureOptionCatalog.buildDoorMaterialFieldHtml(item.uniqueId, 'item', item.specs, 'fridge'");
    // 옛 마감·색 셀렉트 쌍은 없다
    expect(FRIDGE).not.toMatch(/buildOptionsHtml\('door_(finish|color)'/);
    expect(FRIDGE).not.toMatch(/doorColorUpper|doorFinishUpper|doorColorLower|doorFinishLower/);
  });
});
