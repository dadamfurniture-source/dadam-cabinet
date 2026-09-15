/**
 * D0: 디테일 마감 모델 (js/planner/planner-finish.js) — 순수 함수 시험.
 *
 *   · 해석 우선순위 부재 > 모듈 > 섹션 > 품목 > null (계획 §4.2)
 *   · entityKind → 슬롯, userData → 부재 키
 *   · normalize 왕복 (저장 → 읽기 → 같은 값), 깨진 값 버리기
 *   · setFinish / clearFinish 네 단계
 *   · 폴백 카탈로그의 코드가 정본(bom-finish-color.js buildFullMatrix)과 같다 (I6)
 */
const F = require('../js/planner/planner-finish');
const BOM = require('../js/detaildesign/bom-finish-color');

const CAT = F.plannerFinishCatalog(BOM);

describe('해석 — 부재 > 모듈 > 섹션 > 품목', () => {
  function full() {
    const d = F.plannerFinishEmpty();
    F.plannerFinishSet(d, 'item', 'door', 'PET-OAK-M');
    F.plannerFinishSet(d, 'section', 'door', 'PNT-WHT-M', { section: 'upper' });
    F.plannerFinishSet(d, 'module', 'door', 'VNR-WNT', { moduleId: 'upper-3' });
    F.plannerFinishSet(d, 'part', 'door', 'PET-BLK-G', { moduleId: 'upper-3', partKey: 'door#1' });
    return d;
  }

  test('부재 지정이 가장 세다', () => {
    expect(F.plannerFinishResolve(full(), 'door', 'upper-3', 'upper', 'door#1')).toEqual({ code: 'PET-BLK-G', level: 'part' });
  });
  test('부재 지정이 없으면 모듈', () => {
    expect(F.plannerFinishResolve(full(), 'door', 'upper-3', 'upper', 'door#0')).toEqual({ code: 'VNR-WNT', level: 'module' });
  });
  test('모듈 지정이 없으면 섹션 — 상부장·후드는 upper 묶음', () => {
    expect(F.plannerFinishResolve(full(), 'door', 'upper-4', 'upper', 'door#0')).toEqual({ code: 'PNT-WHT-M', level: 'section' });
    expect(F.plannerFinishResolve(full(), 'door', 'hood-0', 'hood', null)).toEqual({ code: 'PNT-WHT-M', level: 'section' });
  });
  test('섹션 지정이 없으면 품목 — 하부·키큰장은 lower 묶음', () => {
    expect(F.plannerFinishResolve(full(), 'door', 'lower-0', 'lower', 'door#0')).toEqual({ code: 'PET-OAK-M', level: 'item' });
    expect(F.plannerFinishResolve(full(), 'door', 'tall-1', 'tall', null)).toEqual({ code: 'PET-OAK-M', level: 'item' });
  });
  test('아무 지정도 없으면 null (구조 단계 색 그대로)', () => {
    expect(F.plannerFinishResolve(full(), 'body', 'lower-0', 'lower', 'body:left')).toBeNull();
    expect(F.plannerFinishResolve(F.plannerFinishEmpty(), 'door')).toBeNull();
    expect(F.plannerFinishResolve(null, 'door')).toBeNull();
  });
  test('부재 키는 슬롯과 무관하게 그 부재만 가리킨다 — 다른 부재 키에는 새지 않는다', () => {
    const d = full();
    expect(F.plannerFinishResolve(d, 'door', 'upper-3', 'upper', 'door#2').level).toBe('module');
  });
});

describe('entityKind → 슬롯', () => {
  test.each([
    ['door', 'door'], ['doorEdge', 'door'], ['blank', 'door'],
    ['carcass', 'body'], ['shelf', 'body'], ['brace', 'body'],
    ['top-panel', 'top'], ['handle', 'handle'],
    ['finishing', 'finishing'], ['blind', 'finishing'], ['blindfin', 'finishing'], ['molding', 'finishing'],
    ['toe-kick', 'kick'], ['pedestal', 'kick'],
    ['leg', null], ['area', null], ['module', null], ['pick', null], ['edge', null], ['reveal', null], ['carcass-line', null],
    [undefined, null], ['nope', null],
  ])('%s → %s', (kind, slot) => {
    expect(F.plannerFinishSlotOfKind(kind)).toBe(slot);
  });

  test('carcass 는 side/areaType 로 다시 가른다', () => {
    const front = (areaType) => ({ entityKind: 'carcass', side: 'front', areaType });
    expect(F.plannerFinishSlotOf(front('door'))).toBe('door');
    expect(F.plannerFinishSlotOf(front('drawer'))).toBe('drawerFront');
    expect(F.plannerFinishSlotOf(front('open'))).toBeNull();
    expect(F.plannerFinishSlotOf({ entityKind: 'carcass', side: 'finish' })).toBe('finishing');
    expect(F.plannerFinishSlotOf({ entityKind: 'carcass', side: 'channelFace' })).toBe('handle');
    expect(F.plannerFinishSlotOf({ entityKind: 'carcass', side: 'left' })).toBe('body');
    expect(F.plannerFinishSlotOf({ entityKind: 'carcass', side: 'divider', cellIdx: 1 })).toBe('body');
  });

  test('칠하기용 슬롯은 표시용 종류를 뺀다 — 도어 테두리는 골라지되 칠하지 않는다', () => {
    expect(F.plannerFinishSlotOf({ entityKind: 'doorEdge' })).toBe('door');
    expect(F.plannerFinishPaintSlotOf({ entityKind: 'doorEdge' })).toBeNull();
    expect(F.plannerFinishPaintSlotOf({ entityKind: 'reveal' })).toBeNull();
    expect(F.plannerFinishPaintSlotOf({ entityKind: 'carcass', side: 'front', areaType: 'door' })).toBe('door');
  });
});

describe('부재 키 — 다시 그려도 같은 부재는 같은 키', () => {
  test.each([
    [{ entityKind: 'carcass', side: 'front', areaType: 'door', areaIdx: 1 }, 'door#1'],
    [{ entityKind: 'carcass', side: 'front', areaType: 'door', areaIdx: 1, doorIdx: 0 }, 'door#1-0'],
    [{ entityKind: 'carcass', side: 'front', areaType: 'door', areaIdx: 1, doorIdx: 1 }, 'door#1-1'],
    [{ entityKind: 'carcass', side: 'front', areaType: 'drawer', areaIdx: 0, areaPos: 'top' }, 'drawer#0'],
    [{ entityKind: 'carcass', side: 'front', areaType: 'drawer', areaIdx: -1, areaPos: 'bottom', cellIdx: 2 }, 'drawer#b2'],
    [{ entityKind: 'carcass', side: 'front', areaType: 'open', areaIdx: 0 }, null],
    [{ entityKind: 'carcass', side: 'front', areaType: 'door' }, null],           // 순번이 없으면 부재로 못 부른다
    [{ entityKind: 'carcass', side: 'left' }, 'body:left'],
    [{ entityKind: 'carcass', side: 'divider', cellIdx: 1 }, 'body:divider#1'],
    [{ entityKind: 'carcass', side: 'batten', leg: 'side' }, 'body:batten-side'],
    [{ entityKind: 'carcass', side: 'finish' }, 'finish'],
    [{ entityKind: 'carcass', side: 'channelBase' }, 'channel:channelBase'],
    [{ entityKind: 'shelf', cellIdx: 0, shelfIdx: 2 }, 'shelf#0-2'],
    [{ entityKind: 'top-panel' }, 'top'],
    [{ entityKind: 'toe-kick' }, 'kick'],
    [{ entityKind: 'pedestal' }, 'pedestal'],
    [{ entityKind: 'molding' }, 'molding'],
    [{ entityKind: 'handle' }, 'handle'],
    [{ entityKind: 'leg', legIdx: 3 }, 'leg#3'],
    [{ entityKind: 'blind', areaIdx: 0 }, 'blind#0'],
    [{ entityKind: 'blindfin', areaIdx: 0 }, 'blindfin#0'],
    [{ entityKind: 'blank', areaIdx: 2 }, 'blank#2'],
    [{ entityKind: 'brace', areaIdx: 1 }, 'brace#1'],
    [{ entityKind: 'brace', braceIdx: 1 }, 'brace#1'],   // P2-6: 모듈 단위 처짐방지목 순번
    [{ entityKind: 'finishing', finishingIdx: 0 }, 'finishing#0'],
    [{ entityKind: 'doorEdge', axis: 'left' }, null],
    [{ entityKind: 'area', areaId: 'a1' }, null],
    [null, null],
  ])('%j → %s', (ud, key) => {
    expect(F.plannerFinishPartKeyOf(ud)).toBe(key);
  });
});

describe('normalize — 왕복과 정리', () => {
  test('빈 모델의 모양', () => {
    expect(F.plannerFinishEmpty()).toEqual({ version: 1, item: {}, sections: { upper: {}, lower: {} }, modules: {}, parts: {} });
    expect(F.plannerFinishEmpty()).not.toBe(F.plannerFinishEmpty());
  });

  test('JSON 으로 저장했다 읽어도 같다', () => {
    const d = F.plannerFinishEmpty();
    F.plannerFinishSet(d, 'item', 'body', 'MFB-WHT');
    F.plannerFinishSet(d, 'section', 'top', 'LPM-GRP', { section: 'lower' });
    F.plannerFinishSet(d, 'module', 'drawerFront', 'PET-SAG-M', { moduleId: 'lower-1' });
    F.plannerFinishSet(d, 'part', 'body', 'VNR-OAK', { moduleId: 'lower-1', partKey: 'shelf#0-0' });
    const back = F.plannerFinishNormalize(JSON.stringify(d));
    expect(back).toEqual(d);
    expect(back).not.toBe(d);
    expect(F.plannerFinishCount(back)).toBe(4);
  });

  test('모르는 슬롯·빈 코드·잘못된 값은 버린다', () => {
    const d = F.plannerFinishNormalize({
      version: 7,
      item: { door: { code: 'PET-OAK-M' }, sofa: { code: 'X' }, body: { code: '  ' }, top: 'LPM-GRP', handle: null },
      sections: { upper: { door: { code: 'A' } }, weird: { door: { code: 'B' } } },
      modules: { 'm1': { door: { code: 'C' } }, 'm2': { nope: { code: 'D' } }, '': { door: { code: 'E' } } },
      parts: { 'm1': { 'door#0': { code: 'F' }, 'door#1': {} }, 'm3': 'junk' },
    });
    expect(d.version).toBe(1);
    expect(d.item).toEqual({ door: { code: 'PET-OAK-M' }, top: { code: 'LPM-GRP' } });   // 문자열도 받는다
    expect(d.sections).toEqual({ upper: { door: { code: 'A' } }, lower: {} });
    expect(d.modules).toEqual({ m1: { door: { code: 'C' } } });
    expect(d.parts).toEqual({ m1: { 'door#0': { code: 'F' } } });
  });

  test('null · 깨진 문자열 · 숫자는 빈 모델', () => {
    expect(F.plannerFinishNormalize(null)).toEqual(F.plannerFinishEmpty());
    expect(F.plannerFinishNormalize('{not json')).toEqual(F.plannerFinishEmpty());
    expect(F.plannerFinishNormalize(42)).toEqual(F.plannerFinishEmpty());
  });
});

describe('setFinish / clearFinish', () => {
  test('네 단계 모두 제자리에서 적고 같은 객체를 돌려준다', () => {
    const d = F.plannerFinishEmpty();
    expect(F.plannerFinishSet(d, 'item', 'door', 'PET-OAK-M')).toBe(d);
    expect(F.plannerFinishSet(d, 'section', 'door', 'PET-OAK-M', { section: 'tall' })).toBe(d);   // tall → lower
    expect(F.plannerFinishSet(d, 'module', 'door', 'PET-OAK-M', { moduleId: 'm' })).toBe(d);
    expect(F.plannerFinishSet(d, 'part', 'door', 'PET-OAK-M', { moduleId: 'm', partKey: 'door#0' })).toBe(d);
    expect(d.sections.lower.door).toEqual({ code: 'PET-OAK-M' });
    expect(F.plannerFinishCount(d)).toBe(4);
  });

  test('인자가 모자라거나 슬롯이 틀리면 null 이고 아무것도 바뀌지 않는다', () => {
    const d = F.plannerFinishEmpty();
    expect(F.plannerFinishSet(d, 'section', 'door', 'X', {})).toBeNull();
    expect(F.plannerFinishSet(d, 'module', 'door', 'X', {})).toBeNull();
    expect(F.plannerFinishSet(d, 'part', 'door', 'X', { moduleId: 'm' })).toBeNull();
    expect(F.plannerFinishSet(d, 'item', 'sofa', 'X')).toBeNull();
    expect(F.plannerFinishSet(d, 'item', 'door', '')).toBeNull();
    expect(F.plannerFinishSet(d, 'nope', 'door', 'X')).toBeNull();
    expect(d).toEqual(F.plannerFinishEmpty());
  });

  test('지우면 빈 사전도 같이 걷어 저장본이 자라지 않는다', () => {
    const d = F.plannerFinishEmpty();
    F.plannerFinishSet(d, 'part', 'door', 'A', { moduleId: 'm', partKey: 'door#0' });
    F.plannerFinishSet(d, 'module', 'door', 'B', { moduleId: 'm' });
    F.plannerFinishSet(d, 'item', 'door', 'C');
    expect(F.plannerFinishClear(d, 'part', 'door', { moduleId: 'm', partKey: 'door#0' })).toBe(true);
    expect(d.parts).toEqual({});
    expect(F.plannerFinishClear(d, 'part', 'door', { moduleId: 'm', partKey: 'door#0' })).toBe(false);   // 두 번째는 없다
    expect(F.plannerFinishClear(d, 'module', 'door', { moduleId: 'm' })).toBe(true);
    expect(d.modules).toEqual({});
    expect(F.plannerFinishClear(d, 'item', 'door')).toBe(true);
    expect(F.plannerFinishClear(d, 'item', 'door')).toBe(false);
    expect(F.plannerFinishCount(d)).toBe(0);
  });
});

describe('카탈로그', () => {
  test('정본(bom-finish-color.js)의 마감×색 전부에 코드·hex·라벨이 붙는다', () => {
    expect(CAT.fallback).toBe(false);
    // 크기는 정본이 정한다 — C0(agent/catalog-unify) 가 색을 더하면 49 → 70 처럼 따라 바뀐다.
    expect(CAT.entries).toHaveLength(Object.keys(BOM.buildFullMatrix()).length);
    expect(CAT.entries.length).toBeGreaterThanOrEqual(49);
    const oak = F.plannerFinishLookup(CAT, 'PET-OAK-M');
    expect(oak).toMatchObject({ code: 'PET-OAK-M', hex: '#d1b089', label: 'PET 매트 · 오크', finish: 'pet-matte', color: 'oak', tone: 'matte' });
    expect(F.plannerFinishHex(CAT, 'MFB-WHT')).toBe('#ffffff');
    expect(F.plannerFinishHex(CAT, 'NOPE')).toBeNull();
    expect(F.plannerFinishHex(null, 'PET-OAK-M')).toBeNull();
  });

  test('폴백의 코드는 전부 정본 buildFullMatrix 에 있고(I6: 코드 이름 불변), 정본 전체는 CAT 와 같다', () => {
    const fb = F.plannerFinishCatalog(null);
    expect(fb.fallback).toBe(true);
    const real = Object.values(BOM.buildFullMatrix()).map((x) => x.code).sort();
    // 폴백은 최초 7×7 만 품는다. 정본이 색을 더해도(C0) 폴백 코드가 정본 밖으로 나가면 안 된다.
    const fbCodes = fb.entries.map((e) => e.code).sort();
    expect(fbCodes).toHaveLength(49);
    fbCodes.forEach((c) => expect(real).toContain(c));
    expect(CAT.entries.map((e) => e.code).sort()).toEqual(real);
    // hex·라벨도 같다
    fb.entries.forEach((e) => {
      const r = F.plannerFinishLookup(CAT, e.code);
      expect(r.hex).toBe(e.hex);
      expect(r.label).toBe(e.label);
    });
  });
});
