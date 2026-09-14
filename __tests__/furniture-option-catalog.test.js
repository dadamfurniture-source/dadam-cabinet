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
  // eslint-disable-next-line no-new-func
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
