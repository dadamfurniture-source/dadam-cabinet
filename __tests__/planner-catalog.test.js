/**
 * D2: 마감 카탈로그 (js/planner/planner-catalog.js) — materials 행 → 팔레트 그룹.
 *
 *   · 예림 행은 series → finish 로 묶이고(Supreme · PET Matt), 상판은 '상판', 구 7×7 은 호환 그룹으로 맨 뒤·접힘
 *   · DB 를 못 읽거나 예림 행이 0 이면 로컬 정본(plannerFinishCatalog)으로 물러난다 (fallback:true)
 *   · sessionStorage 캐시 dadam_catalog_v1 — 1시간 안에는 DB 를 다시 읽지 않는다
 *   · 슬롯 필터·검색
 *
 * planner-finish.js 가 전역(plannerFinishCatalog·PLANNER_FINISH_SLOTS)을 올려야 한다 — 브라우저의 클래식 스크립트 순서와 같다.
 */
const { makeStorage } = require('../test-utils/planner-harness');

Object.assign(global, require('../js/planner/planner-finish'));
const C = require('../js/planner/planner-catalog');
const { PlannerCatalog } = C;

function row(over) {
  return Object.assign({
    code: 'YR-SM-01', vendor: 'yerim', vendor_code: 'SM-01', series: 'Supreme', finish: 'Supreme PET Matt', tone: 'matte',
    color_name: '매트 화이트', color_hex: '#F4F4F4', roughness: 0.75, metalness: 0, clearcoat: 0, grain: 'none',
    texture_url: null, tile_mm: null, slot: ['door', 'drawer_front'], category: 'door_material', sort: 2000,
  }, over);
}

const ROWS = [
  row({ code: 'YR-SM-02', vendor_code: 'SM-02', color_name: '매트 오크', color_hex: '#d1b089', grain: 'v', sort: 2001 }),
  row(),
  row({ code: 'YR-SG-01', vendor_code: 'SG-01', finish: 'Supreme PET Glossy', tone: 'gloss', color_name: '글로시 화이트', roughness: 0.25, clearcoat: 0.6, sort: 2100 }),
  row({ code: 'YR-YPA-01', vendor_code: 'YPA-01', series: 'Prestige', finish: 'Prestige Acryl', color_name: '아크 플랫화이트', color_hex: '#ffffff', sort: 1000 }),
  row({ code: 'YR-PM-01', vendor_code: 'PM-01', series: 'Prime', finish: 'Prime MFB', tone: 'single', color_name: '엠보 화이트', roughness: 0.6, sort: 4000 }),
  row({ code: 'YR-B-01', vendor_code: 'B-01', series: 'Body', finish: 'Body PVC', tone: null, color_name: '바디 화이트', slot: ['body'], category: 'body_material', sort: 5000 }),
  row({ code: 'YR-B-02', vendor_code: 'B-02', series: 'Body', finish: 'Body MFC', tone: 'single', color_name: '바디 오크', color_hex: '#c9a577', slot: null, category: 'body_material', sort: 5100 }),
  { code: 'TOP-SNW', vendor: null, series: null, finish: null, tone: 'gloss', color_name: '스노우', color_hex: '#FAFAFA',
    roughness: 0.25, metalness: 0, clearcoat: 0.6, grain: 'none', texture_url: null, tile_mm: null, slot: ['top'], category: 'countertop', sort: 1 },
  // 구 코드가 DB 에도 있다(C0 시드) — 로컬 정본과 같은 코드라 한 번만 나와야 한다
  { code: 'PET-OAK-M', vendor: null, series: null, finish: 'pet-matte', tone: 'matte', color_name: 'PET 매트 · 오크', color_hex: '#d1b089',
    roughness: 0.75, metalness: 0, clearcoat: 0, grain: 'none', texture_url: null, tile_mm: null, slot: ['door', 'drawer_front'], category: 'door_material', sort: 1 },
  // 깨진 행 — code 없음 / hex 없음
  row({ code: null }),
  row({ code: 'YR-BAD', color_hex: 'oops' }),
];

function client(rows, error) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      return { select(sel) { calls.push(sel); return { eq(k, v) { calls.push([k, v]); return { order: async () => ({ data: error ? null : rows, error: error || null }) }; } }; } };
    },
  };
}

describe('행 → 항목', () => {
  test('예림 행: 코드·hex(소문자)·톤·슬롯(drawer_front → drawerFront)·그룹 키·표시명', () => {
    const e = C.plannerCatalogEntryOf(row());
    expect(e).toMatchObject({
      code: 'YR-SM-01', hex: '#f4f4f4', tone: 'matte', roughness: 0.75, metalness: 0, clearcoat: 0, grain: 'none',
      slots: ['door', 'drawerFront'], group: 'yerim:supreme:pet-matt', series: 'Supreme', finish: 'Supreme PET Matt',
      finishLabel: 'PET Matt', colorLabel: '매트 화이트', label: 'PET Matt · 매트 화이트', vendor: 'yerim', vendorCode: 'SM-01',
      textureUrl: null, tileMm: null, category: 'door_material',
    });
  });
  test('tone null·single 은 single, slot 이 비면 category 로 (body_material → body), 상판은 countertop 그룹', () => {
    expect(C.plannerCatalogEntryOf(row({ tone: null })).tone).toBe('single');
    expect(C.plannerCatalogEntryOf(ROWS[6])).toMatchObject({ slots: ['body'], group: 'yerim:body:mfc', finishLabel: 'MFC' });
    expect(C.plannerCatalogEntryOf(ROWS[7])).toMatchObject({ group: 'countertop', slots: ['top'], finishLabel: '상판', label: '상판 · 스노우', hex: '#fafafa' });
  });
  test('코드나 hex 가 없으면 null', () => {
    expect(C.plannerCatalogEntryOf(row({ code: '' }))).toBeNull();
    expect(C.plannerCatalogEntryOf(row({ color_hex: 'oops' }))).toBeNull();
    expect(C.plannerCatalogEntryOf(null)).toBeNull();
  });
  test('vendor_code 가 없으면 YR- 를 뗀 코드', () => {
    expect(C.plannerCatalogEntryOf(row({ vendor_code: null })).vendorCode).toBe('SM-01');
  });
});

describe('build — 그룹', () => {
  const api = require('../js/detaildesign/bom-finish-color.js');   // IIFE 가 window 에 올린다
  const cat = C.plannerCatalogBuild(ROWS, window.DadamBomFinishColor);
  const local = plannerFinishCatalog(window.DadamBomFinishColor);

  test('예림 → 상판 → 호환 순, source db, 깨진 행은 빠지고 같은 코드는 한 번', () => {
    expect(api).toBeDefined();
    expect(cat.source).toBe('db');
    expect(cat.fallback).toBe(false);
    expect(cat.yerim).toBe(7);
    expect(cat.groups.map((g) => g.key)).toEqual([
      'yerim:prestige:acryl', 'yerim:supreme:pet-matt', 'yerim:supreme:pet-glossy', 'yerim:prime:mfb', 'yerim:body:pvc', 'yerim:body:mfc',
      'countertop', 'compat',
    ]);
    expect(cat.groups.map((g) => g.label)).toEqual([
      'Prestige · Acryl', 'Supreme · PET Matt', 'Supreme · PET Glossy', 'Prime · MFB', 'Body · PVC', 'Body · MFC', '상판', '구 7×7 (호환)',
    ]);
    // 항목 수 = 예림 7 + 상판 1 + 로컬 정본 전부 (DB 의 PET-OAK-M 은 중복이라 안 더한다)
    expect(cat.entries).toHaveLength(7 + 1 + local.entries.length);
    expect(cat.entries.filter((e) => e.code === 'PET-OAK-M')).toHaveLength(1);
    expect(cat.byCode['YR-SM-02'].grain).toBe('v');
    expect(cat.byCode['PET-OAK-M'].group).toBe('compat');
    expect(cat.finishes).toEqual(local.finishes);
  });
  test('그룹 안은 sort 순, 그룹의 slots 는 항목 슬롯의 합, 호환 그룹은 접혀 있고 슬롯 전부', () => {
    const sm = cat.groups.find((g) => g.key === 'yerim:supreme:pet-matt');
    expect(sm.codes).toEqual(['YR-SM-01', 'YR-SM-02']);
    expect(sm.count).toBe(2);
    expect(sm.slots).toEqual(['door', 'drawerFront']);
    expect(sm.collapsed).toBe(false);
    const compat = cat.groups[cat.groups.length - 1];
    expect(compat.compat).toBe(true);
    expect(compat.collapsed).toBe(true);
    expect(compat.slots).toEqual(PLANNER_FINISH_SLOTS);
    expect(compat.count).toBe(local.entries.length);
  });
  test('호환 항목은 D0 필드(code·label·hex·finish·finishLabel·tone·color·colorLabel)를 그대로 갖는다', () => {
    const d0 = local.entries.find((e) => e.code === 'PET-OAK-M');
    const now = cat.byCode['PET-OAK-M'];
    ['code', 'label', 'hex', 'finish', 'finishLabel', 'tone', 'color', 'colorLabel'].forEach((k) => expect(now[k]).toEqual(d0[k]));
    expect(plannerFinishHex(cat, 'PET-OAK-M')).toBe('#d1b089');
    expect(plannerFinishLookup(cat, 'YR-SG-01').label).toBe('PET Glossy · 글로시 화이트');
  });
  test('예림 행이 없으면 호환 그룹 하나뿐, 펼쳐져 있고 source local · fallback true', () => {
    const only = C.plannerCatalogBuild([ROWS[7], ROWS[8]], window.DadamBomFinishColor);
    expect(only.source).toBe('local');
    expect(only.fallback).toBe(true);
    expect(only.groups.map((g) => g.key)).toEqual(['countertop', 'compat']);
    expect(only.groups[1].collapsed).toBe(false);
    const none = C.plannerCatalogBuild([], null);
    expect(none.source).toBe('builtin');
    expect(none.groups.map((g) => g.key)).toEqual(['compat']);
    expect(none.entries).toHaveLength(PLANNER_FINISH_FALLBACK.finishes.length * PLANNER_FINISH_FALLBACK.colors.length);
  });
});

describe('슬롯 필터 · 검색', () => {
  const cat = C.plannerCatalogBuild(ROWS, window.DadamBomFinishColor);
  test('door → 도어재 + 호환, body → 바디재 + 호환, top → 상판 + 호환, handle → 호환뿐', () => {
    const keys = (slot) => C.plannerCatalogGroupsForSlot(cat, slot).map((g) => g.key);
    expect(keys('door')).toEqual(['yerim:prestige:acryl', 'yerim:supreme:pet-matt', 'yerim:supreme:pet-glossy', 'yerim:prime:mfb', 'compat']);
    expect(keys('drawerFront')).toEqual(keys('door'));
    expect(keys('body')).toEqual(['yerim:body:pvc', 'yerim:body:mfc', 'compat']);
    expect(keys('top')).toEqual(['countertop', 'compat']);
    expect(keys('handle')).toEqual(['compat']);
    expect(keys(null)).toHaveLength(cat.groups.length);
  });
  test('이름·코드·공급사 코드 부분 일치, 대소문자 무시', () => {
    expect(C.plannerCatalogSearch(cat, '오크').map((e) => e.code)).toEqual(expect.arrayContaining(['YR-SM-02', 'YR-B-02', 'PET-OAK-M']));
    expect(C.plannerCatalogSearch(cat, 'sg-01').map((e) => e.code)).toEqual(['YR-SG-01']);
    expect(C.plannerCatalogSearch(cat, 'top-').map((e) => e.code)).toEqual(['TOP-SNW']);
    expect(C.plannerCatalogSearch(cat, '')).toHaveLength(cat.entries.length);
    expect(C.plannerCatalogSearch(cat, '없는것')).toEqual([]);
  });
});

describe('load — DB · 캐시 · 폴백', () => {
  beforeEach(() => { PlannerCatalog.current = null; });

  test('DB 를 읽어 그룹을 만들고 캐시에 행을 남긴다 — active=true, sort 순', async () => {
    const st = makeStorage();
    const cl = client(ROWS);
    const cat = await PlannerCatalog.load({ client: cl, storage: st, now: 1000 });
    expect(cat.source).toBe('db');
    expect(cl.calls[0]).toBe('materials');
    expect(cl.calls[1]).toBe(C.PLANNER_CATALOG_SELECT);
    expect(cl.calls[2]).toEqual(['active', true]);
    const cached = JSON.parse(st.getItem('dadam_catalog_v1'));
    expect(cached.at).toBe(1000);
    expect(cached.rows).toHaveLength(ROWS.length);
    expect(PlannerCatalog.current).toBe(cat);
  });

  test('신선한 캐시가 있으면 DB 를 부르지 않고, 1시간이 지나면 다시 읽는다', async () => {
    const st = makeStorage();
    st.setItem('dadam_catalog_v1', JSON.stringify({ at: 1000, rows: ROWS }));
    const cl = client([]);
    const cat = await PlannerCatalog.load({ client: cl, storage: st, now: 1000 + 60 * 1000 });
    expect(cat.source).toBe('db');
    expect(cl.calls).toEqual([]);
    // 동기 경로도 같은 캐시를 본다
    expect(PlannerCatalog.sync({ storage: st, now: 2000 }).source).toBe('db');
    // 만료
    const later = await PlannerCatalog.load({ client: client(ROWS.slice(0, 3)), storage: st, now: 1000 + C.PLANNER_CATALOG_TTL_MS + 1 });
    expect(later.yerim).toBe(3);
    expect(JSON.parse(st.getItem('dadam_catalog_v1')).rows).toHaveLength(3);
    // force 는 캐시를 건너뛴다
    const forced = await PlannerCatalog.load({ client: client(ROWS), storage: st, now: 1000 + C.PLANNER_CATALOG_TTL_MS + 2, force: true });
    expect(forced.yerim).toBe(7);
  });

  test('DB 가 거절하면 낡은 캐시 → 그것도 없으면 로컬 정본 (fallback:true, 던지지 않는다)', async () => {
    const st = makeStorage();
    st.setItem('dadam_catalog_v1', JSON.stringify({ at: 0, rows: ROWS }));
    const stale = await PlannerCatalog.load({ client: client(null, { message: 'RLS' }), storage: st, now: C.PLANNER_CATALOG_TTL_MS * 5 });
    expect(stale.source).toBe('db');
    const none = await PlannerCatalog.load({ client: client(null, { message: 'RLS' }), storage: makeStorage() });
    expect(none.fallback).toBe(true);
    expect(none.source).toBe('local');
    expect(none.groups.map((g) => g.key)).toEqual(['compat']);
    // 클라이언트 자체가 없어도 (supabase-js 미탑재)
    const noClient = await PlannerCatalog.load({ client: null, storage: makeStorage() });
    expect(noClient.fallback).toBe(true);
    // from() 이 던져도
    const boom = await PlannerCatalog.load({ client: { from() { throw new Error('x'); } }, storage: makeStorage() });
    expect(boom.fallback).toBe(true);
  });

  test('예림 행이 0 인 DB 는 캐시하지 않는다 — 시드가 들어오면 바로 보이게', async () => {
    const st = makeStorage();
    const cat = await PlannerCatalog.load({ client: client([ROWS[7]]), storage: st });
    expect(cat.fallback).toBe(true);
    expect(st.getItem('dadam_catalog_v1')).toBeNull();
  });

  test('깨진 캐시는 무시한다', () => {
    const st = makeStorage({ dadam_catalog_v1: '{not json' });
    expect(PlannerCatalog.readCache({ storage: st })).toBeNull();
    st.setItem('dadam_catalog_v1', JSON.stringify({ rows: 'nope' }));
    expect(PlannerCatalog.readCache({ storage: st })).toBeNull();
    expect(PlannerCatalog.sync({ storage: st }).fallback).toBe(true);
  });

  test('클라이언트는 PlannerStore 의 것을 먼저 쓴다', () => {
    const fake = { from() {} };
    global.PlannerStore = { client: () => fake };
    try { expect(PlannerCatalog.client()).toBe(fake); } finally { delete global.PlannerStore; }
    expect(PlannerCatalog.client({ client: fake })).toBe(fake);
  });
});
