/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeAll, afterAll, window */
/**
 * B1: 부재 식별자 · 마감 코드 · 엣지 길이 (docs/01-plan/detail-bom-deepening.plan.md §5 B1).
 *
 * `MaterialExtractor.add()` 가 내는 모든 자재 행에 **더해진** 필드를 본다 (불변조건 I4 — 기존 필드는 그대로):
 *   partId · slot · finishCode(디테일 모델 해석) · edges · edgeLen · edgeT · edgeCode, 요약 edgeBanding.
 * 값이 옳은지는 규칙 시험(bom-body-thickness, extractors-*)이, 바뀌었는지는 골든(bom-golden-*)이 본다.
 */
global.dlog = () => {};

const {
  MaterialExtractor, HardwareExtractor, DrawingVisualizer, BOM_PART_DEFS, bomPartDefOf,
} = require('../js/detaildesign/extractors.js');
const { FIXTURES } = require('../test-utils/bom-golden/fixtures');

const clone = (o) => JSON.parse(JSON.stringify(o));
/** 싱크(15T) + 붙박이 + 냉장고 + ㄱ자 멍장 — 네 품목 한 설계. 카테고리 중복(싱크 2)도 건다. */
function fullDesign() {
  return { items: [clone(FIXTURES.sink15), clone(FIXTURES.wardrobe), clone(FIXTURES.fridge), clone(FIXTURES.sinkCorner)] };
}
const extractRows = (design, me = new MaterialExtractor()) => me.extract(design).materials;
const rowsOf = (rows, module, part) => rows.filter((m) => m.module === module && m.part === part);
const oneRow = (rows, module, part) => {
  const r = rowsOf(rows, module, part);
  expect(r).toHaveLength(1);
  return r[0];
};

describe('partId — 모든 자재 행에, 설계 안에서 유일, 두 번 돌려도 같다', () => {
  const rows = extractRows(fullDesign());

  test('형식 `${itemIdx}-${moduleId}-${partKey}-${n}` 이고 빠진 행이 없다', () => {
    expect(rows.length).toBeGreaterThan(150);
    rows.forEach((m) => {
      expect(typeof m.partId).toBe('string');
      expect(m.partId).toMatch(/^\d+-.+-[a-z]+(:[a-z0-9-]+)?(#\d+)?-\d+$/);
    });
  });

  test('네 품목 200여 행이 전부 서로 다르다', () => {
    const ids = rows.map((m) => m.partId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('같은 설계를 두 번 추출해도 partId 열이 같다 (결정성)', () => {
    const again = extractRows(fullDesign()).map((m) => m.partId);
    expect(again).toEqual(rows.map((m) => m.partId));
    // 새 추출기 인스턴스로도 같다 — 카운터가 인스턴스에 남지 않는다
    expect(extractRows(fullDesign(), new MaterialExtractor()).map((m) => m.partId)).toEqual(again);
  });

  test('itemIdx 는 design.items 순번, moduleId 는 mod.id', () => {
    expect(oneRow(rows, '#1 상부장-상부장(1D)', '도어').partId).toBe('0-u2-door#0-0');
    expect(oneRow(rows, '긴옷-서랍모듈', '서랍도어').partId).toBe('1-w2-drawer#0-0');
    expect(oneRow(rows, '키큰장', '측판').partId).toBe('2-r2-body:side-0');
    expect(oneRow(rows, '#2 하부장-LT망장', '휠라(멍판)').partId).toBe('3-corner-blind-lower-blindfin#0-0');
  });

  test('품목 단위 마감재(EP) 행은 moduleId "ep", 모듈에 딸린 EP 목찬넬은 그 모듈 id', () => {
    expect(oneRow(rows, '#1 EP', '걸레받이').partId).toBe('0-ep-kick-0');
    expect(rowsOf(rows, 'EP', '목찬넬')[0].partId).toBe('1-w2-channel:front-0');
    expect(oneRow(rows, '긴옷-좌대', '좌대 전후').partId).toBe('1-w2-pedestal:fb-0');
  });

  test('같은 모듈 id 아래 상·하부장이 갈리면(붙박이 short/shelf) n 이 구분한다', () => {
    expect(oneRow(rows, '짧은옷(2단)-상부장', '측판').partId).toBe('1-w1-body:side-0');
    expect(oneRow(rows, '짧은옷(2단)-하부장', '측판').partId).toBe('1-w1-body:side-1');
  });

  test('mod.id 가 없으면 `${pos}-${idx}` 로 떨어진다 (옛 저장 설계)', () => {
    const item = clone(FIXTURES.sink15);
    item.modules.forEach((m) => { delete m.id; });
    const r = extractRows({ items: [item] });
    expect(oneRow(r, '상부장-상부장(1D)', '도어').partId).toBe('0-upper-1-door#0-0');
    expect(oneRow(r, '하부장-서랍장', '서랍도어').partId).toBe('0-lower-1-drawer#0-0');
  });
});

describe('slot — planner-finish 7 슬롯 + back', () => {
  const rows = extractRows(fullDesign());
  const slotOf = (module, part) => oneRow(rows, module, part).slot;

  test('추출기가 내는 부재 이름은 전부 표(BOM_PART_DEFS)에 있다 — 폴백 `part:` 키가 없다', () => {
    rows.forEach((m) => {
      expect(bomPartDefOf(m.part).fallback).toBeUndefined();
      expect(m.slot).toBeTruthy();
    });
    expect(bomPartDefOf('없는부재 이름')).toEqual({ key: 'part:없는부재_이름', slot: null, fallback: true });
  });

  test('표의 모든 슬롯은 planner-finish 슬롯 7 + back 안에 있다', () => {
    const allowed = ['door', 'drawerFront', 'body', 'top', 'handle', 'finishing', 'kick', 'back'];
    Object.values(BOM_PART_DEFS).forEach((d) => expect(allowed).toContain(d.slot));
  });

  test('전면 → door/drawerFront, 몸통 → body, 2.7T 판 → back, 목찬넬 → handle, EP → finishing, 바닥 → kick', () => {
    expect(slotOf('#1 하부장-서랍장', '도어')).toBe('door');
    expect(slotOf('#1 하부장-서랍장', '서랍도어')).toBe('drawerFront');
    expect(slotOf('#1 하부장-서랍장', '측판')).toBe('body');
    expect(slotOf('#1 하부장-서랍장', '뒷판')).toBe('back');
    expect(slotOf('#1 하부장-서랍장', '서랍밑판')).toBe('back');
    expect(slotOf('#1 하부장-서랍장', '목찬넬')).toBe('handle');
    expect(slotOf('#1 EP', '상몰딩')).toBe('finishing');
    expect(slotOf('#1 EP', '휠라(좌)')).toBe('finishing');
    expect(slotOf('#1 EP', '걸레받이')).toBe('kick');
    expect(slotOf('긴옷-좌대', '좌대 측')).toBe('kick');
    expect(slotOf('#2 하부장-LT망장', '멍가림판')).toBe('finishing');
    expect(slotOf('#2 하부장-LT망장', '경첩목대(앞다리)')).toBe('body');
    expect(slotOf('선반형', '내부서랍 전면판')).toBe('body'); // PB 내부 서랍 — 도어 뒤에 숨는다
  });
});

describe('CommonJS 이중 노출 — 세 클래스 모두', () => {
  test('MaterialExtractor 외에 HardwareExtractor·DrawingVisualizer 도 require 로 얻는다', () => {
    expect(typeof MaterialExtractor).toBe('function');
    expect(typeof HardwareExtractor).toBe('function');
    expect(typeof DrawingVisualizer).toBe('function');
    expect(new DrawingVisualizer().KERF).toBe(4);
  });
});

describe('toCNC — 3면 가지 (측판)', () => {
  const me = new MaterialExtractor();
  const row = (edge, w = 295, h = 720) => ({ part: '측판', material: 'PB', thickness: 15, w, h, qty: 2, edge });
  const cncOf = (edge, w, h) => me.toCNC([row(edge, w, h)]).split('\n')[1].split(',').slice(-4).map(Number);

  test("'3면' 은 L·T·B (앞 + 위·아래, 뒤 없음) — 예전엔 가지가 없어 0,0,0,0 이었다", () => {
    expect(cncOf('3면')).toEqual([1, 0, 1, 1]);
  });
  test('다른 가지는 그대로다 (4면 전부, 1면 L, - 없음)', () => {
    expect(cncOf('4면')).toEqual([1, 1, 1, 1]);
    expect(cncOf('1면(전)')).toEqual([1, 0, 0, 0]);
    expect(cncOf('-')).toEqual([0, 0, 0, 0]);
  });
});
