/**
 * C0 마감 카탈로그 정본 — FurnitureOptionCatalog(config-constants.js) 조회 API 시험.
 *
 * config-constants.js 는 detaildesign.html 안에서만 도는 전역 스크립트라
 * planner-bridge-roundtrip.test.js 처럼 new Function 으로 감싸 평가한다.
 * Supabase 없이(SupabaseUtils undefined) 내장 폴백 데이터로 byCode / forSlot / codeFor 를 검사하고,
 * v2 SQL 이 적용된 DB 를 흉내낸 행으로 load() 가 code/slot/PBR 컬럼을 보존하는지 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/detaildesign/config-constants.js'), 'utf8');

function loadCatalog({ supabaseUtils } = {}) {
  const win = window; // jsdom
  const factory = new Function(
    'window', 'document', 'selectedItems', 'SupabaseUtils', 'CATEGORIES', 'DEFAULT_SPECS',
    SRC + '\nreturn { FurnitureOptionCatalog };'
  );
  return factory(win, document, [], supabaseUtils, [], {}).FurnitureOptionCatalog;
}

// v2 SQL 적용 후 materials 행 모양
const V2_ROWS = [
  { category: 'door', color_name: '화이트', color_name_en: 'white', color_hex: '#f5f5f5', finish: 'matte', texture_prompt: 'pure white', applicable_to: ['sink'], sort_order: 1,
    code: 'WHT', color_code: 'WHT', slot: ['door'] },
  { category: 'door_material', color_name: 'PET 매트 · 오크', color_name_en: 'pet-matte oak', color_hex: '#d1b089', finish: 'pet-matte', texture_prompt: 'oak, pet', applicable_to: ['sink', 'wardrobe'], sort_order: 2,
    code: 'PET-OAK-M', finish_code: 'PET', color_code: 'OAK', tone: 'matte', slot: ['door', 'drawer_front'],
    roughness: '0.75', metalness: '0', clearcoat: '0', tile_mm: 600, grain: 'v', price_key: 'PET-M', texture_url: 'https://x/oak.jpg' },
  { category: 'countertop', color_name: '스노우', color_name_en: 'snow white', color_hex: '#FAFAFA', texture_prompt: 'quartz', sort_order: 1,
    code: 'TOP-SNW', tone: 'gloss', slot: ['top'], thumbnail_url: 'https://x/snow-thumb.jpg' },
];

function fakeSupabase(rows) {
  const q = {
    select: () => q, eq: () => q,
    order: async () => ({ data: rows, error: null }),
  };
  return { client: { from: () => q } };
}

describe('FurnitureOptionCatalog — 내장 폴백', () => {
  let C;
  beforeEach(() => { C = loadCatalog(); });

  test('폴백만으로 loaded 이고 window 에 노출된다', () => {
    expect(C.loaded).toBe(true);
    expect(window.FurnitureOptionCatalog).toBe(C);
  });

  test('폴백 옵션에 code 가 실려 있다 (door_color 7 / door_finish 3 / countertop 4)', () => {
    expect(C.options.door_color.map(o => o.code)).toEqual(['WHT', 'GRY', 'BGE', 'WNT', 'OAK', 'NVY', 'BLK']);
    expect(C.options.door_finish.map(o => o.code)).toEqual(['TONE-M', 'TONE-G', 'TONE-E']);
    expect(C.options.countertop.map(o => o.code)).toEqual(['TOP-SNW', 'TOP-MWH', 'TOP-GMB', 'TOP-CHC']);
  });

  test('기존 API 는 그대로 (getOptions / getColorHex / buildOptionsHtml 이 name_ko 기준)', () => {
    expect(C.getOptions('door_color', 'fridge').map(o => o.name_ko)).toEqual(['화이트', '그레이', '베이지', '블랙']);
    expect(C.getColorHex('door_color', '화이트')).toBe('#f5f5f5');
    expect(C.buildOptionsHtml('door_finish', '유광')).toContain('<option value="유광" selected>유광</option>');
  });

  test('byCode — 대소문자 무시, 없으면 null', () => {
    expect(C.byCode('TOP-GMB').name_ko).toBe('그레이마블');
    expect(C.byCode('wht').name_ko).toBe('화이트');
    expect(C.byCode('PET-OAK-M')).toBeNull();
    expect(C.byCode('')).toBeNull();
    expect(C.byCode(null)).toBeNull();
  });

  test('forSlot — slot 컬럼이 없으면 카테고리 폴백 (door→door_color, top→countertop)', () => {
    expect(C.forSlot('door').map(o => o.code)).toEqual(['WHT', 'GRY', 'BGE', 'WNT', 'OAK', 'NVY', 'BLK']);
    expect(C.forSlot('top').map(o => o.code)).toEqual(['TOP-SNW', 'TOP-MWH', 'TOP-GMB', 'TOP-CHC']);
    expect(C.forSlot('door', 'countertop')).toEqual([]);
    expect(C.forSlot('kick')).toEqual([]);
    expect(C.forSlot('')).toEqual([]);
  });

  test('codeFor — 한글 사양값 → 코드', () => {
    expect(C.codeFor('door_color', '화이트')).toBe('WHT');
    expect(C.codeFor('door_color', '오크')).toBe('OAK');
    expect(C.codeFor('door_finish', '무광')).toBe('TONE-M');
    expect(C.codeFor('countertop', '스노우')).toBe('TOP-SNW');
    // 이미 코드면 그대로 (대문자화)
    expect(C.codeFor('door_color', 'blk')).toBe('BLK');
    // 폴백 표에는 있지만 옵션에는 없는 색 (bom-finish-color.js 7색)
    expect(C.codeFor('door_color', '세이지')).toBe('SAG');
    // 모르는 값은 짐작하지 않는다
    expect(C.codeFor('door_color', '핑크')).toBeNull();
    expect(C.codeFor('door_color', '')).toBeNull();
    expect(C.codeFor('handle', '스마트바')).toBeNull();
  });
});

describe('FurnitureOptionCatalog — v2 SQL 적용 DB 에서 load()', () => {
  let C;
  beforeEach(async () => {
    C = loadCatalog({ supabaseUtils: fakeSupabase(V2_ROWS) });
    await C.load();
  });

  test('code / slot / tone / PBR / tile_mm / grain / price_key 를 옵션에 보존한다', () => {
    const oak = C.byCode('PET-OAK-M');
    expect(oak).toMatchObject({
      name_ko: 'PET 매트 · 오크', code: 'PET-OAK-M', finish_code: 'PET', color_code: 'OAK', tone: 'matte',
      slot: ['door', 'drawer_front'], roughness: 0.75, metalness: 0, clearcoat: 0, tile_mm: 600, grain: 'v',
      price_key: 'PET-M', texture_url: 'https://x/oak.jpg',
    });
    // 기존 필드도 그대로
    expect(oak.color_hex).toBe('#d1b089');
    expect(oak.applicable_to).toEqual(['sink', 'wardrobe']);
    expect(oak.finish).toBe('pet-matte');
  });

  test('v2 컬럼이 없는 행은 null 로 (예외 없음)', () => {
    const wht = C.byCode('WHT');
    expect(wht).toMatchObject({ code: 'WHT', tone: null, roughness: null, grain: null, price_key: null });
    expect(wht.slot).toEqual(['door']);
  });

  test('door → door_color 매핑은 유지되고 door_material 은 새 버킷', () => {
    expect(C.options.door_color.map(o => o.name_ko)).toEqual(['화이트']);
    expect(C.options.door_material.map(o => o.code)).toEqual(['PET-OAK-M']);
    expect(C.options.door).toBeUndefined();
  });

  test('forSlot 은 slot 컬럼을 우선한다', () => {
    expect(C.forSlot('door').map(o => o.code)).toEqual(['WHT', 'PET-OAK-M']);
    expect(C.forSlot('drawer_front').map(o => o.code)).toEqual(['PET-OAK-M']);
    expect(C.forSlot('door', 'door_material').map(o => o.code)).toEqual(['PET-OAK-M']);
    expect(C.forSlot('top').map(o => o.code)).toEqual(['TOP-SNW']);
  });

  test('codeFor 는 로드된 행의 code 를 우선 쓴다', () => {
    expect(C.codeFor('door_color', '화이트')).toBe('WHT');
    expect(C.codeFor('countertop', '스노우')).toBe('TOP-SNW');
    expect(C.codeFor('door_material', 'PET 매트 · 오크')).toBe('PET-OAK-M');
  });

  test('texture_url 은 texture_url 컬럼 우선, 없으면 thumbnail_url', () => {
    expect(C.byCode('TOP-SNW').texture_url).toBe('https://x/snow-thumb.jpg');
  });
});

// C2: 예림 LUX 시드(materials-yerim-lux-seed.sql) 모양의 행 + 옛 7색 + PET 계열
const YERIM_ROWS = [
  { category: 'door_material', slot: ['door', 'drawer_front'], applicable_to: ['sink', 'wardrobe', 'fridge'], vendor: 'yerim', series: 'Supreme', finish: 'Supreme PET Matt',
    code: 'YR-SM-01', vendor_code: 'SM-01', tone: 'matte', color_name: '매트 화이트', color_hex: '#fbfbfb', sort: 1030, sort_order: 1030 },
  { category: 'door_material', slot: ['door', 'drawer_front'], applicable_to: ['sink', 'wardrobe', 'fridge'], vendor: 'yerim', series: 'Supreme', finish: 'Supreme PET Matt',
    code: 'YR-SM-02', vendor_code: 'SM-02', tone: 'matte', color_name: '매트 그레이', color_hex: '#a9a9a9', sort: 1031, sort_order: 1031 },
  { category: 'door_material', slot: ['door', 'drawer_front'], applicable_to: ['sink', 'wardrobe', 'fridge'], vendor: 'yerim', series: 'Supreme', finish: 'Supreme PET Glossy',
    code: 'YR-U1802', vendor_code: 'U1802', tone: 'gloss', color_name: '글로시 다크그레이', color_hex: '#5b5758', sort: 1060, sort_order: 1060 },
  { category: 'door_material', slot: ['door', 'drawer_front'], applicable_to: ['sink', 'wardrobe', 'fridge'], vendor: 'yerim', series: 'Prime', finish: 'Prime MFB',
    code: 'YR-KM-01', vendor_code: 'KM-01', tone: 'single', color_name: '스노우 화이트', color_hex: '#f7f7f7', sort: 1100, sort_order: 1100 },
  { category: 'body_material', slot: ['body'], applicable_to: ['sink', 'wardrobe', 'fridge'], vendor: 'yerim', series: 'Body', finish: 'Body MFC',
    code: 'YR-F200', vendor_code: 'F200', tone: 'single', color_name: '소프트 화이트 (방염)', color_hex: '#fdfeff', sort: 2000, sort_order: 2000 },
  // 옛 7색 중 둘 (vendor 없음) + v2 PET 계열 (vendor 없음, code 있음) + code 없는 옛 행
  { category: 'door', slot: ['door'], applicable_to: ['sink'], code: 'NVY', color_name: '네이비', color_hex: '#1a237e', sort_order: 6 },
  { category: 'door', slot: ['door'], applicable_to: ['sink', 'wardrobe', 'fridge'], code: 'WHT', color_name: '화이트', color_hex: '#f5f5f5', sort_order: 1 },
  { category: 'door_material', slot: ['door', 'drawer_front'], code: 'PET-OAK-M', tone: 'matte', color_name: 'PET 매트 · 오크', color_hex: '#d1b089', sort_order: 9000 },
  { category: 'door', slot: ['door'], color_name: '코드없음', color_hex: '#000000', sort_order: 9999 },
  { category: 'countertop', slot: ['top'], code: 'TOP-SNW', tone: 'gloss', color_name: '스노우', color_hex: '#FAFAFA', sort_order: 1 },
];

describe('FurnitureOptionCatalog — C2 optgroupsFor / 도어 코드 파생', () => {
  let C;
  beforeEach(async () => {
    C = loadCatalog({ supabaseUtils: fakeSupabase(YERIM_ROWS) });
    await C.load();
  });

  test('load() 가 vendor · series · vendor_code · sort 를 보존한다', () => {
    expect(C.byCode('YR-SM-01')).toMatchObject({ vendor: 'yerim', series: 'Supreme', vendor_code: 'SM-01', finish: 'Supreme PET Matt', tone: 'matte', sort: 1030 });
    expect(C.byCode('WHT')).toMatchObject({ vendor: null, series: null, vendor_code: null, sort: 1 });
    expect(C.options.body_material.map(o => o.code)).toEqual(['YR-F200']);
  });

  test('optgroupsFor(door) — 예림 시리즈·소재 그룹이 행 순서대로 먼저, 기타(호환)가 마지막', () => {
    const groups = C.optgroupsFor('door');
    expect(groups.map(g => g.label)).toEqual(['예림 Supreme · PET Matt', '예림 Supreme · PET Glossy', '예림 Prime · MFB', '기타(호환)']);
    expect(groups[0].options).toEqual([
      { code: 'YR-SM-01', label: '매트 화이트 (SM-01)', name: '매트 화이트', hex: '#fbfbfb', tone: 'matte', vendor: 'yerim' },
      { code: 'YR-SM-02', label: '매트 그레이 (SM-02)', name: '매트 그레이', hex: '#a9a9a9', tone: 'matte', vendor: 'yerim' },
    ]);
    // 기타(호환): 옛 색은 코드가 값, 라벨은 한글 이름. code 없는 행은 빠진다. 바디재(body 슬롯)는 안 섞인다
    const compat = groups[groups.length - 1];
    // 카테고리 버킷 순서가 아니라 sort_order 순 (WHT 1 · NVY 6 · PET-OAK-M 9000)
    expect(compat.options.map(o => [o.code, o.label])).toEqual([['WHT', '화이트'], ['NVY', '네이비'], ['PET-OAK-M', 'PET 매트 · 오크']]);
    expect(groups.flatMap(g => g.options).some(o => o.code === 'YR-F200')).toBe(false);
  });

  test('optgroupsFor — category · furnitureType 으로 거른다, 바디 슬롯은 Body 그룹', () => {
    expect(C.optgroupsFor('door', 'door_material').map(g => g.label)).toEqual(['예림 Supreme · PET Matt', '예림 Supreme · PET Glossy', '예림 Prime · MFB', '기타(호환)']);
    expect(C.optgroupsFor('door', 'door_material').at(-1).options.map(o => o.code)).toEqual(['PET-OAK-M']);
    // 네이비는 sink 전용 → wardrobe 에선 빠진다
    expect(C.optgroupsFor('door', null, 'wardrobe').at(-1).options.map(o => o.code)).toEqual(['WHT', 'PET-OAK-M']);
    expect(C.optgroupsFor('body').map(g => [g.label, g.options.map(o => o.code)])).toEqual([['예림 Body · MFC', ['YR-F200']]]);
    expect(C.optgroupsFor('kick')).toEqual([]);
  });

  test('내장 폴백만 있을 때는 기타(호환) 7색 한 그룹', () => {
    const F = loadCatalog();
    const groups = F.optgroupsFor('door');
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('기타(호환)');
    expect(groups[0].options.map(o => o.code)).toEqual(['WHT', 'GRY', 'BGE', 'WNT', 'OAK', 'NVY', 'BLK']);
    expect(groups[0].options[0]).toMatchObject({ label: '화이트', hex: '#f5f5f5', tone: null });
  });

  test('buildOptgroupsHtml — optgroup/option 마크업, 선택값, 없으면 안내 option', () => {
    const html = C.buildOptgroupsHtml('door', 'yr-sm-02');
    expect(html).toContain('<optgroup label="예림 Supreme · PET Matt">');
    expect(html).toContain('<option value="YR-SM-02" selected data-hex="#a9a9a9" data-tone="matte">매트 그레이 (SM-02)</option>');
    expect(html).toContain('<optgroup label="기타(호환)"><option value="WHT" data-hex="#f5f5f5">화이트</option><option value="NVY" data-hex="#1a237e">네이비</option>');
    expect(html).not.toContain('— 선택 —');
    expect(C.buildOptgroupsHtml('door', null)).toMatch(/^<option value="" selected disabled>— 선택 —<\/option><optgroup/);
    expect(C.buildOptgroupsHtml('door', 'ZZZ')).toContain('— 선택 —');
  });

  test('doorSpecForCode — color_name 과 톤(gloss→유광, 그 밖→무광). 모르는 코드는 null', () => {
    expect(C.doorSpecForCode('YR-SM-01')).toEqual({ code: 'YR-SM-01', color: '매트 화이트', finish: '무광', hex: '#fbfbfb', tone: 'matte' });
    expect(C.doorSpecForCode('yr-u1802')).toMatchObject({ code: 'YR-U1802', color: '글로시 다크그레이', finish: '유광' });
    expect(C.doorSpecForCode('YR-KM-01')).toMatchObject({ finish: '무광', tone: 'single' });   // 단톤 → 무광 기본
    expect(C.doorSpecForCode('WHT')).toMatchObject({ color: '화이트', finish: '무광', tone: null });
    expect(C.doorSpecForCode('NOPE')).toBeNull();
    expect(C.doorSpecForCode('')).toBeNull();
  });

  test('doorSelectCode — 새 키 우선, 없으면 옛 한글 색을 기타(호환) 코드로', () => {
    expect(C.doorSelectCode({ doorMaterialUpper: 'yr-sm-01', doorColorUpper: '화이트' }, 'upper')).toBe('YR-SM-01');
    expect(C.doorSelectCode({ doorMaterialUpper: null, doorColorUpper: '화이트' }, 'upper')).toBe('WHT');
    expect(C.doorSelectCode({ doorColorLower: '네이비' }, 'lower')).toBe('NVY');
    expect(C.doorSelectCode({ doorColorLower: '핑크' }, 'lower')).toBeNull();
    expect(C.doorSelectCode({}, 'upper')).toBeNull();
  });

  test('buildDoorMaterialFieldHtml — 견본 + updateDoorMaterial 셀렉트', () => {
    const html = C.buildDoorMaterialFieldHtml(42, 'upper', { doorMaterialUpper: 'YR-SM-02' }, 'sink', 'font-size:10px;');
    expect(html).toContain('background:#a9a9a9');
    expect(html).toContain(`onchange="updateDoorMaterial(42, 'upper', this.value)"`);
    expect(html).toContain('data-group="upper"');
    expect(html).toContain('font-size:10px;');
    expect(html).toContain('<option value="YR-SM-02" selected');
    // 옛 설계(코드 없음)는 한글 색으로 기타(호환) 을 미리 고른다
    const legacy = C.buildDoorMaterialFieldHtml(7, 'item', { doorColorUpper: '화이트' }, 'wardrobe');
    expect(legacy).toContain('<option value="WHT" selected');
    expect(legacy).toContain(`updateDoorMaterial(7, 'item', this.value)`);
    expect(legacy).not.toContain('value="NVY"');    // wardrobe 에는 네이비가 없다
    // 아무 것도 모르면 빈 견본 + 안내
    expect(C.buildDoorMaterialFieldHtml(1, 'lower', {}, 'sink')).toContain('— 선택 —');
  });
});

describe('FurnitureOptionCatalog — iframe 카탈로그 브리지', () => {
  test('window message 리스너가 한 번 설치된다', () => {
    const spy = jest.spyOn(window, 'addEventListener');
    const C = loadCatalog();
    const calls = spy.mock.calls.filter(([type]) => type === 'message');
    expect(calls).toHaveLength(1);
    C._installBridge(window);
    expect(spy.mock.calls.filter(([type]) => type === 'message')).toHaveLength(1);
    spy.mockRestore();
  });

  test('DADAM_CATALOG_REQUEST 에 event.source 로 DADAM_CATALOG 를 보낸다', () => {
    const C = loadCatalog();
    const source = { postMessage: jest.fn() };
    C._onMessage({ data: { type: 'DADAM_CATALOG_REQUEST' }, source, origin: 'https://dadam.example' });
    expect(source.postMessage).toHaveBeenCalledTimes(1);
    const [msg, origin] = source.postMessage.mock.calls[0];
    expect(origin).toBe('https://dadam.example');
    expect(msg.type).toBe('DADAM_CATALOG');
    expect(msg.loaded).toBe(true);
    expect(msg.options.door_color.map(o => o.code)).toContain('WHT');
  });

  test('origin 이 없거나 "null" 이면 "*" 로 답한다', () => {
    const C = loadCatalog();
    const source = { postMessage: jest.fn() };
    C._onMessage({ data: { type: 'DADAM_CATALOG_REQUEST' }, source, origin: 'null' });
    expect(source.postMessage.mock.calls[0][1]).toBe('*');
  });

  test('다른 메시지·source 없음·postMessage 없음은 무시한다', () => {
    const C = loadCatalog();
    const source = { postMessage: jest.fn() };
    C._onMessage({ data: { type: 'SOMETHING_ELSE' }, source });
    C._onMessage({ data: 'string', source });
    C._onMessage({ data: { type: 'DADAM_CATALOG_REQUEST' }, source: null });
    C._onMessage({ data: { type: 'DADAM_CATALOG_REQUEST' }, source: {} });
    C._onMessage(null);
    expect(source.postMessage).not.toHaveBeenCalled();
  });

  test('실제 window 이벤트로도 답한다', () => {
    const C = loadCatalog();
    const posted = [];
    const source = { postMessage: (m, o) => posted.push([m, o]) };
    const ev = new window.Event('message');
    ev.data = { type: 'DADAM_CATALOG_REQUEST' };
    ev.source = source;
    window.dispatchEvent(ev);
    // 이 파일의 앞선 loadCatalog() 들도 같은 jsdom window 에 리스너를 달았으므로 개수 대신 내용을 본다
    expect(posted.length).toBeGreaterThanOrEqual(1);
    for (const [m] of posted) expect(m.type).toBe('DADAM_CATALOG');
    expect(posted.some(([m]) => m.options === C.options)).toBe(true);
  });
});
