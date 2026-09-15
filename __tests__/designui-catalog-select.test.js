/**
 * C2 상세설계 도어 마감 셀렉트 — 카탈로그 코드 하나(specs.doorMaterialUpper/Lower) + 옛 키 파생 + 플래너 디테일 양방향.
 *
 *   셀렉트 → updateDoorMaterial(uid, 'upper'|'lower'|'item', code)
 *     specs.doorMaterial* = code · doorColor* = color_name · doorFinish* = gloss→유광/그 밖→무광
 *     item.detail.sections[group].door = {code} (item 이면 item.door) → DADAM_DETAIL_SET
 *   플래너 → PLANNER_DETAIL_CHANGE (YR-SM-01) → _mirrorPlannerDetailToSpecs 가 doorMaterial* 까지 채운다
 *
 * ui-step1.js / config-constants.js 는 전역 스크립트라 designui-detail-sync.test.js 처럼
 * 소스에서 블록을 잘라 new Function 으로 실제 코드를 평가한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const UI = read('js/detaildesign/ui-step1.js');
const WS = read('js/detaildesign/ui-workspace.js');
const CONFIG = read('js/detaildesign/config-constants.js');
const DATA = read('js/detaildesign/data-constants.js');

const PF = require('../js/planner/planner-finish.js');
require('../js/detaildesign/bom-finish-color.js');   // window.DadamBomFinishColor

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  const e = src.indexOf(endMarker, s + 1);
  if (s < 0 || e < 0) throw new Error(`마커를 찾지 못했습니다: ${startMarker}`);
  return src.slice(s, e);
}

// 예림 LUX 시드 모양 + 옛 7색 중 둘 (vendor 없음) — 카탈로그 스텁
const YERIM_ROWS = [
  { category: 'door_material', slot: ['door', 'drawer_front'], applicable_to: ['sink', 'wardrobe', 'fridge'], vendor: 'yerim', series: 'Supreme', finish: 'Supreme PET Matt',
    code: 'YR-SM-01', vendor_code: 'SM-01', tone: 'matte', color_name: '매트 화이트', color_hex: '#fbfbfb', sort: 1030, sort_order: 1030 },
  { category: 'door_material', slot: ['door', 'drawer_front'], applicable_to: ['sink', 'wardrobe', 'fridge'], vendor: 'yerim', series: 'Supreme', finish: 'Supreme PET Glossy',
    code: 'YR-U1802', vendor_code: 'U1802', tone: 'gloss', color_name: '글로시 다크그레이', color_hex: '#5b5758', sort: 1060, sort_order: 1060 },
  { category: 'door_material', slot: ['door', 'drawer_front'], applicable_to: ['sink', 'wardrobe', 'fridge'], vendor: 'yerim', series: 'Prime', finish: 'Prime MFB',
    code: 'YR-KM-01', vendor_code: 'KM-01', tone: 'single', color_name: '스노우 화이트', color_hex: '#f7f7f7', sort: 1100, sort_order: 1100 },
  { category: 'door', slot: ['door'], applicable_to: ['sink', 'wardrobe', 'fridge'], code: 'WHT', color_name: '화이트', color_hex: '#f5f5f5', sort_order: 1 },
  { category: 'door', slot: ['door'], applicable_to: ['sink', 'wardrobe'], code: 'OAK', color_name: '오크', color_hex: '#c4a35a', sort_order: 5 },
];
// v2 SQL 의 PET 계열 행 (vendor 없음, code 있음)
const PET_ROW = { category: 'door_material', slot: ['door', 'drawer_front'], code: 'PET-OAK-M', tone: 'matte', color_name: 'PET 매트 · 오크', color_hex: '#d1b089', sort_order: 9000 };

function fakeSupabase(rows) {
  const q = { select: () => q, eq: () => q, order: async () => ({ data: rows, error: null }) };
  return { client: { from: () => q } };
}

/** config-constants.js 를 평가해 카탈로그를 얻는다. rows 를 주면 그 행으로 load() */
async function loadConfig(selectedItems, rows) {
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'window', 'document', 'selectedItems', 'SupabaseUtils', 'CATEGORIES', 'DEFAULT_SPECS', 'updateUI',
    CONFIG + '\nreturn { FurnitureOptionCatalog };'
  );
  const C = factory(window, document, selectedItems, rows ? fakeSupabase(rows) : undefined, [], {}, () => {}).FurnitureOptionCatalog;
  if (rows) await C.load();
  return C;
}

/** ui-step1.js 의 D1+C2 블록을 평가한다. pushUndo / renderWorkspaceContent 는 ui-workspace.js 전역이라 스파이로 넣는다 */
function loadSync(state) {
  const block = sliceBetween(UI, '// D1: 플래너 디테일(마감) 모델 왕복', 'function _loadPlannerEmbed');
  const src = `
    let hasUnsavedChanges = false;
    ${block}
    return {
      dirty: () => hasUnsavedChanges, reset: () => { hasUnsavedChanges = false; },
      updateDoorMaterial, _setPlannerDetailDoor, _plannerFrameOfItem, _plannerDetailMaterialOf, _plannerDetailEmpty,
      _plannerDetailCodeToSpec, _mirrorPlannerDetailToSpecs, _plannerDetailStable,
    };`;
  // eslint-disable-next-line no-new-func
  const factory = new Function('window', 'document', 'location', 'selectedItems', 'updateSaveStatus', 'setTimeout', 'pushUndo', 'renderWorkspaceContent', src);
  return factory(window, document, window.location, state.selectedItems, state.updateSaveStatus || (() => {}), state.setTimeout || setTimeout,
    state.pushUndo, state.renderWorkspaceContent);
}

function makeItem(over = {}) {
  return {
    uniqueId: 42, categoryId: 'sink', name: '싱크대', w: 3000, h: 2310, d: 650,
    specs: { doorColorUpper: '화이트', doorFinishUpper: '무광', doorColorLower: '화이트', doorFinishLower: '무광', doorMaterialUpper: null, doorMaterialLower: null, topColor: '스노우' },
    modules: [],
    ...over,
  };
}

/** 품목 오버레이 안의 플래너 iframe (ui-step1 _loadPlannerEmbed 와 같은 모양) + postMessage 스파이 */
function mountFrame(itemParam) {
  const overlay = document.createElement('div');
  overlay.id = '__planner-overlay-' + itemParam;
  const iframe = document.createElement('iframe');
  iframe.dataset.planner = 'true';
  iframe.src = '/mockup-shell?preset=sink&itemId=' + itemParam + '&design=local&item=' + itemParam;
  overlay.appendChild(iframe);
  document.body.appendChild(overlay);
  const sent = [];
  iframe.contentWindow.postMessage = (msg, origin) => sent.push({ msg, origin });
  return { iframe, sent };
}

function post(iframe, data, origin = window.location.origin) {
  window.dispatchEvent(new window.MessageEvent('message', { data, origin, source: iframe.contentWindow }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete window.plannerFinishResolve;
  delete window.plannerFinishEmpty;
  delete window.plannerFinishSet;
  delete window.selectedItems;
});

describe('셀렉트 마크업 — 예림 그룹 먼저, 기타(호환) 마지막, 옛 설계는 한글 색으로 미리 고른다', () => {
  test('optgroup 순서와 코드 값', async () => {
    const C = await loadConfig([], YERIM_ROWS);
    const html = C.buildDoorMaterialFieldHtml(42, 'upper', { doorMaterialUpper: 'YR-U1802' }, 'sink', 'font-size:10px;');
    const labels = [...html.matchAll(/<optgroup label="([^"]+)">/g)].map((m) => m[1]);
    expect(labels).toEqual(['예림 Supreme · PET Matt', '예림 Supreme · PET Glossy', '예림 Prime · MFB', '기타(호환)']);
    expect(html).toContain('<option value="YR-U1802" selected data-hex="#5b5758" data-tone="gloss">글로시 다크그레이 (U1802)</option>');
    expect(html).toContain('<option value="WHT" data-hex="#f5f5f5">화이트</option>');
    expect(html).toContain(`onchange="updateDoorMaterial(42, 'upper', this.value)"`);
    expect(html).toContain('background:#5b5758');           // 견본은 고른 색
  });

  test('doorMaterial* 이 없는 옛 품목은 doorColor* 로 기타(호환) 옵션을 고른다', async () => {
    const C = await loadConfig([], YERIM_ROWS);
    const item = makeItem({ specs: { doorColorUpper: '오크', doorFinishUpper: '유광', doorColorLower: '화이트', doorFinishLower: '무광' } });
    expect(C.buildDoorMaterialFieldHtml(42, 'upper', item.specs, 'sink')).toContain('<option value="OAK" selected');
    expect(C.buildDoorMaterialFieldHtml(42, 'lower', item.specs, 'sink')).toContain('<option value="WHT" selected');
    // 새 키가 있으면 그것이 우선
    item.specs.doorMaterialUpper = 'YR-SM-01';
    const html = C.buildDoorMaterialFieldHtml(42, 'upper', item.specs, 'sink');
    expect(html).toContain('<option value="YR-SM-01" selected');
    expect(html).not.toContain('<option value="OAK" selected');
    // 아는 색이 없으면 안내 option
    expect(C.buildDoorMaterialFieldHtml(42, 'upper', { doorColorUpper: '핑크' }, 'sink')).toContain('— 선택 —');
  });
});

describe('셀렉트 변경 — updateDoorMaterial: 코드 + 파생 옛 키 + item.detail + DADAM_DETAIL_SET', () => {
  async function armed(over = {}) {
    const item = makeItem(over.item);
    const items = [makeItem({ uniqueId: 7 }), item];
    await loadConfig(items, YERIM_ROWS);
    const undo = [], rendered = [], statuses = [];
    const S = loadSync({ selectedItems: items, updateSaveStatus: (a, b) => statuses.push([a, b]), pushUndo: (it) => undo.push(JSON.parse(JSON.stringify(it.specs))), renderWorkspaceContent: (it) => rendered.push(it.uniqueId) });
    const { iframe, sent } = mountFrame('42');
    return { S, item, items, iframe, sent, undo, rendered, statuses };
  }

  test('상부: YR-SM-01 → doorMaterialUpper + 매트 화이트 · 무광, sections.upper.door, 플래너에 전송, 수정됨', async () => {
    const { S, item, items, sent, undo, rendered, statuses } = await armed();
    expect(S.updateDoorMaterial(42, 'upper', 'YR-SM-01')).toBe(true);
    expect(item.specs).toMatchObject({ doorMaterialUpper: 'YR-SM-01', doorColorUpper: '매트 화이트', doorFinishUpper: '무광' });
    expect(item.specs).toMatchObject({ doorMaterialLower: null, doorColorLower: '화이트', doorFinishLower: '무광', topColor: '스노우' });   // 하부·다른 사양은 그대로
    expect(item.detail).toEqual({ version: 1, item: {}, sections: { upper: { door: { code: 'YR-SM-01' } }, lower: {} }, modules: {}, parts: {} });
    expect(sent).toEqual([{ msg: { type: 'DADAM_DETAIL_SET', detail: item.detail }, origin: window.location.origin }]);
    expect(undo).toHaveLength(1);
    expect(undo[0].doorMaterialUpper).toBeNull();          // 되돌리기 스냅샷은 바꾸기 전
    expect(rendered).toEqual([42]);
    expect(S.dirty()).toBe(true);
    expect(statuses).toEqual([['saving', '수정됨']]);
    expect(items[0].specs.doorMaterialUpper).toBeNull();   // 다른 품목은 건드리지 않는다
  });

  test('하부: 유광 행은 doorFinishLower=유광, 단톤(single) 행은 무광', async () => {
    const { S, item } = await armed();
    S.updateDoorMaterial(42, 'lower', 'yr-u1802');          // 소문자도 카탈로그 code 로 정규화
    expect(item.specs).toMatchObject({ doorMaterialLower: 'YR-U1802', doorColorLower: '글로시 다크그레이', doorFinishLower: '유광' });
    expect(item.specs.doorMaterialUpper).toBeNull();
    expect(item.detail.sections.lower.door).toEqual({ code: 'YR-U1802' });
    S.updateDoorMaterial(42, 'lower', 'YR-KM-01');
    expect(item.specs).toMatchObject({ doorMaterialLower: 'YR-KM-01', doorColorLower: '스노우 화이트', doorFinishLower: '무광' });
  });

  test('기타(호환) 코드도 같은 길 — WHT → 화이트 · 무광 · detail 에 WHT', async () => {
    const { S, item } = await armed({ item: { specs: { doorColorUpper: '오크', doorFinishUpper: '유광' } } });
    S.updateDoorMaterial(42, 'upper', 'WHT');
    expect(item.specs).toMatchObject({ doorMaterialUpper: 'WHT', doorColorUpper: '화이트', doorFinishUpper: '무광' });
    expect(item.detail.sections.upper.door).toEqual({ code: 'WHT' });
  });

  test("'item' (붙박이장): 상·하 키를 같이 채우고 item.door 에 적으며 섹션 door 재정의는 지운다", async () => {
    const detail = PF.plannerFinishEmpty();
    PF.plannerFinishSet(detail, 'section', 'door', 'YR-KM-01', { section: 'upper' });
    PF.plannerFinishSet(detail, 'section', 'top', 'TOP-SNW', { section: 'lower' });
    const { S, item, sent } = await armed({ item: { categoryId: 'wardrobe', detail } });
    window.plannerFinishEmpty = PF.plannerFinishEmpty;
    window.plannerFinishSet = PF.plannerFinishSet;
    S.updateDoorMaterial(42, 'item', 'YR-SM-01');
    expect(item.specs).toMatchObject({ doorMaterialUpper: 'YR-SM-01', doorColorUpper: '매트 화이트', doorFinishUpper: '무광', doorMaterialLower: 'YR-SM-01', doorColorLower: '매트 화이트', doorFinishLower: '무광' });
    expect(item.detail.item.door).toEqual({ code: 'YR-SM-01' });
    expect(item.detail.sections.upper.door).toBeUndefined();
    expect(item.detail.sections.lower.top).toEqual({ code: 'TOP-SNW' });   // 다른 슬롯 재정의는 그대로
    expect(sent).toHaveLength(1);
    expect(PF.plannerFinishResolve(item.detail, 'door', null, 'lower')).toEqual({ code: 'YR-SM-01', level: 'item' });
  });

  test('모르는 코드는 아무것도 바꾸지 않고, 같은 값을 다시 고르면 다시 보내지 않는다', async () => {
    const { S, item, sent, undo } = await armed();
    expect(S.updateDoorMaterial(42, 'upper', 'NOPE-1')).toBe(false);
    expect(S.updateDoorMaterial(42, 'upper', '')).toBe(false);
    expect(S.updateDoorMaterial(999, 'upper', 'YR-SM-01')).toBe(false);
    expect(item.detail).toBeUndefined();
    expect(sent).toHaveLength(0);
    expect(S.dirty()).toBe(false);

    S.updateDoorMaterial(42, 'upper', 'YR-SM-01');
    S.reset();
    expect(S.updateDoorMaterial(42, 'upper', 'YR-SM-01')).toBe(false);
    expect(sent).toHaveLength(1);
    expect(undo).toHaveLength(1);
    expect(S.dirty()).toBe(false);
  });

  test('플래너 iframe 이 없어도(품목 카드만 열림) 사양·detail 은 적힌다', async () => {
    const items = [makeItem()];
    await loadConfig(items, YERIM_ROWS);
    const S = loadSync({ selectedItems: items });
    expect(S._plannerFrameOfItem(42)).toBeNull();
    expect(S.updateDoorMaterial(42, 'lower', 'YR-SM-01')).toBe(true);
    expect(items[0].specs.doorMaterialLower).toBe('YR-SM-01');
    expect(items[0].detail.sections.lower.door).toEqual({ code: 'YR-SM-01' });
  });

  test('planner-finish.js 가 있으면 그 모델 함수로 만든다 (같은 모양)', async () => {
    const { S, item } = await armed();
    window.plannerFinishEmpty = PF.plannerFinishEmpty;
    window.plannerFinishSet = PF.plannerFinishSet;
    expect(S._plannerDetailEmpty()).toEqual(PF.plannerFinishEmpty());
    S.updateDoorMaterial(42, 'upper', 'YR-SM-01');
    expect(PF.plannerFinishNormalize(item.detail)).toEqual(item.detail);
    expect(PF.plannerFinishResolve(item.detail, 'door', null, 'upper')).toEqual({ code: 'YR-SM-01', level: 'section' });
  });

  test('보낸 모델의 메아리(PLANNER_DETAIL_CHANGE)는 수정됨으로 다시 표시하지 않는다', async () => {
    const { S, item, iframe, sent } = await armed();
    window.plannerFinishResolve = PF.plannerFinishResolve;
    S.updateDoorMaterial(42, 'upper', 'YR-SM-01');
    S.reset();
    post(iframe, { type: 'PLANNER_DETAIL_CHANGE', detail: JSON.parse(JSON.stringify(sent[0].msg.detail)) });
    expect(S.dirty()).toBe(false);
    expect(item.specs.doorMaterialUpper).toBe('YR-SM-01');
  });
});

describe('플래너 → 부모 — PLANNER_DETAIL_CHANGE 에 YR 코드가 오면 doorMaterial* 까지 미러', () => {
  test('YR-SM-01(상부 섹션) · YR-U1802(품목) → 새 키 + 파생 옛 키', async () => {
    const item = makeItem();
    await loadConfig([item], YERIM_ROWS);
    window.plannerFinishResolve = PF.plannerFinishResolve;
    const S = loadSync({ selectedItems: [item] });
    const { iframe } = mountFrame('42');
    const detail = PF.plannerFinishEmpty();
    PF.plannerFinishSet(detail, 'item', 'door', 'YR-U1802');
    PF.plannerFinishSet(detail, 'section', 'door', 'YR-SM-01', { section: 'upper' });

    post(iframe, { type: 'PLANNER_DETAIL_CHANGE', detail });

    expect(item.detail).toEqual(detail);
    expect(item.specs).toMatchObject({
      doorMaterialUpper: 'YR-SM-01', doorColorUpper: '매트 화이트', doorFinishUpper: '무광',
      doorMaterialLower: 'YR-U1802', doorColorLower: '글로시 다크그레이', doorFinishLower: '유광',
    });
    expect(S.dirty()).toBe(true);
  });

  test('_plannerDetailCodeToSpec — YR 코드는 카탈로그 행에서, PET-OAK-M 은 기존 해석 그대로, 모르면 null', async () => {
    await loadConfig([], YERIM_ROWS);
    const S = loadSync({ selectedItems: [] });
    expect(S._plannerDetailCodeToSpec('YR-SM-01')).toEqual({ color: '매트 화이트', finish: '무광' });
    expect(S._plannerDetailCodeToSpec('YR-KM-01')).toEqual({ color: '스노우 화이트', finish: '무광' });   // 단톤 → 무광
    expect(S._plannerDetailCodeToSpec('PET-OAK-M')).toEqual({ color: '오크', finish: '무광' });
    expect(S._plannerDetailCodeToSpec('WHT')).toEqual({ color: '화이트', finish: '무광' });
    expect(S._plannerDetailCodeToSpec('XXX-YYY-M')).toEqual({ color: null, finish: null });
    expect(S._plannerDetailMaterialOf('yr-sm-01')).toBe('YR-SM-01');
    expect(S._plannerDetailMaterialOf('PET-OAK-M')).toBeNull();     // 이 카탈로그엔 없다
    expect(S._plannerDetailMaterialOf('')).toBeNull();
  });

  test('카탈로그가 모르는 코드(PET-OAK-M, v2 행 없음)는 doorMaterial* 을 null 로 — 옛 방식으로 돌아간다', async () => {
    const item = makeItem({ specs: { doorColorUpper: '화이트', doorFinishUpper: '무광', doorMaterialLower: 'YR-SM-01', doorColorLower: '매트 화이트', doorFinishLower: '무광' } });
    await loadConfig([item], YERIM_ROWS);
    window.plannerFinishResolve = PF.plannerFinishResolve;
    const S = loadSync({ selectedItems: [item] });
    const d = PF.plannerFinishEmpty();
    PF.plannerFinishSet(d, 'item', 'door', 'PET-OAK-M');
    // 상부 doorMaterialUpper 는 null → null 이라 바뀐 키에 들지 않는다
    expect(S._mirrorPlannerDetailToSpecs(item, d)).toEqual(['doorColorUpper', 'doorMaterialLower', 'doorColorLower']);
    expect(item.specs).toMatchObject({ doorMaterialLower: null, doorColorLower: '오크', doorFinishLower: '무광', doorColorUpper: '오크' });
    expect(item.specs.doorMaterialUpper).toBeFalsy();   // 원래 없던 키는 만들지 않는다 (undefined 도 옛 방식)
  });

  test('v2 행이 있으면 PET-OAK-M 도 doorMaterial* 에 그대로 실린다 (기타(호환) 그룹에서 골라진다)', async () => {
    const item = makeItem();
    const C = await loadConfig([item], [...YERIM_ROWS, PET_ROW]);
    window.plannerFinishResolve = PF.plannerFinishResolve;
    const S = loadSync({ selectedItems: [item] });
    const d = PF.plannerFinishEmpty();
    PF.plannerFinishSet(d, 'section', 'door', 'PET-OAK-M', { section: 'lower' });
    S._mirrorPlannerDetailToSpecs(item, d);
    expect(item.specs).toMatchObject({ doorMaterialLower: 'PET-OAK-M', doorColorLower: '오크', doorFinishLower: '무광' });
    expect(C.buildDoorMaterialFieldHtml(42, 'lower', item.specs, 'sink')).toMatch(/<optgroup label="기타\(호환\)">.*<option value="PET-OAK-M" selected/);
  });

  test('내장 폴백 카탈로그(Supabase 없음)에서도 옛 코드 흐름은 D1 그대로', async () => {
    const item = makeItem();
    await loadConfig([item]);
    window.plannerFinishResolve = PF.plannerFinishResolve;
    const S = loadSync({ selectedItems: [item] });
    const d = PF.plannerFinishEmpty();
    PF.plannerFinishSet(d, 'item', 'door', 'PNT-WHT-G');
    expect(S._mirrorPlannerDetailToSpecs(item, d)).toEqual(['doorFinishUpper', 'doorFinishLower']);
    expect(item.specs).toMatchObject({ doorMaterialUpper: null, doorColorUpper: '화이트', doorFinishUpper: '유광' });
  });
});

describe('소스 규약', () => {
  test('싱크 팝업(ui-step1)·싱크/붙박이장(ui-workspace) 도어 셀렉트가 카탈로그 한 칸으로 바뀌었다', () => {
    expect(UI).toContain("FurnitureOptionCatalog.buildDoorMaterialFieldHtml(item.uniqueId, 'upper', item.specs, 'sink'");
    expect(UI).toContain("FurnitureOptionCatalog.buildDoorMaterialFieldHtml(item.uniqueId, 'lower', item.specs, 'sink'");
    expect(WS).toContain("FurnitureOptionCatalog.buildDoorMaterialFieldHtml(uid, 'upper', item.specs, 'sink'");
    expect(WS).toContain("FurnitureOptionCatalog.buildDoorMaterialFieldHtml(uid, 'lower', item.specs, 'sink'");
    expect(WS).toContain("FurnitureOptionCatalog.buildDoorMaterialFieldHtml(item.uniqueId, 'item', item.specs, 'wardrobe'");
    // 옛 두 셀렉트(마감 + 색)는 남아 있지 않다
    expect(UI).not.toMatch(/buildOptionsHtml\('door_(finish|color)'/);
    expect(WS).not.toMatch(/buildOptionsHtml\('door_(finish|color)'/);
  });

  test('사양 기본값에 doorMaterialUpper/Lower: null 이 있고 옛 키는 그대로다', () => {
    expect(DATA).toMatch(/doorMaterialUpper:\s*null/);
    expect(DATA).toMatch(/doorMaterialLower:\s*null/);
    expect(DATA).toMatch(/doorColorUpper:\s*'화이트'/);
    expect(DATA).toMatch(/doorFinishLower:\s*'무광'/);
  });

  test('updateDoorMaterial 은 전역이다 (인라인 onchange)', () => {
    expect(UI).toContain('window.updateDoorMaterial = updateDoorMaterial');
  });
});
