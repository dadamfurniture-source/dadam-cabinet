/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, global, describe, test, expect */
/**
 * 키큰장 단 조합 — 2026-10-24 사장님 (모듈 라이브러리 키큰장 조합: 밥솥 · 전자레인지 오픈 칸 · 플랩 …).
 *
 *   서랍 단   "싱크 서랍장 규칙 그대로" — 맨 아래 단(하부단 · 통짜)에만. 전면 · 박스 · 중간 목찬넬은 싱크 서랍장과 같은 함수,
 *             단 몸통이 전면 영역 (몸통 − 30 × 목찬넬, 좌대는 덮지 않는다). 중간 · 상부 단 서랍은 규칙이 없다 → 부재 · 레일 없이 [확인 필요].
 *   상자 단   오픈장 · 밥솥장 … 으로 바꾼 단도 그 단이 짊어진 좌대(바닥 단) · 상몰딩(맨 위 단)을 낸다 (sink.md §5.1).
 *             브리지가 키큰장 섹션의 상자 모듈을 `type:'tall'` + heightParts 로 보낸다 — 다리발 · 라인 폭에서 빠진다.
 *   플랩      맨 위 단 열림 '위' (doorOpen 'up') — 상부장 플랩과 같은 철물 (천판 경첩 + 가스쇼바 2, hardware.md §1 flap).
 */
global.dlog = global.dlog || (() => {});
const Asm = require('../js/detaildesign/bom-assembly.js');
const Check = require('../js/detaildesign/assembly-check.js');
const { MaterialExtractor, HardwareExtractor } = require('../js/detaildesign/extractors.js');

const SPECS = {
  layoutShape: 'I', topThickness: 12, bodyThickness: 15, lowerH: 870, upperH: 720, moldingH: 60, sinkLegHeight: 150,
  handle: '찬넬 (목찬넬)', finishLeftType: 'None', finishLeftWidth: 0, finishRightType: 'None', finishRightWidth: 0,
  upperDoorOverlap: 15, wardrobePedestal: 60,
};

/** 브리지가 보내는 키큰장 단 (합성 값 — 3D stackForArea 와 같은 모양: 하부 801+좌대 60 · 중간 · 상부 +상몰딩 60) */
const tier = (i, h, hp, o) => Object.assign({
  id: `planner-tall-${i}-0`, type: 'tall', name: '키큰장', pos: 'lower', w: 600, h,
  totalH: h + (hp.pedestalH || 0) + (hp.moldingH || 0), d: 620, heightParts: hp,
  doorCount: 1, shelfCount: 0, isDrawer: false, isEL: false, isOpen: false, hingeSide: 'left',
}, o);
const BOTTOM = { pedestalH: 60, moldingH: 0 }, MIDDLE = { pedestalH: 0, moldingH: 0 }, TOP = { pedestalH: 0, moldingH: 60 };
/** 서랍장 2:2 (위 칸도 서랍) — 브리지 drawerLayout 'all' 모양 */
const DRAWER = {
  isDrawer: true, doorCount: 0, drawerCount: 2, drawerLayout: 'all', hingeSide: undefined, shelfCount: 1,
  drawer: { rail: 'under', sakuri: true, boxT: 15, grades: ['large', 'large'], doorGrade: '', topDrawer: true },
};
const OPEN = (i) => ({ id: `planner-tall-${i}-open`, moduleKind: 'open', name: '오픈장', doorCount: 0, isOpen: true, hingeSide: undefined });
const LOWER = { id: 'planner-lower-0-0', type: 'storage', name: '하부장', pos: 'lower', w: 600, h: 708, d: 550, doorCount: 1, shelfCount: 0, hingeSide: 'left' };

function run(modules) {
  const design = { items: [{ categoryId: 'sink', w: 1200, h: 2310, d: 650, specs: Object.assign({}, SPECS), modules }] };
  const materials = new MaterialExtractor().extract(design).materials;
  const hardware = new HardwareExtractor().extract(design).hardware;
  const spec = Asm.of(design, { materials, hardware });
  return { materials, hardware, spec, check: Check.check(spec) };
}
const rowsOf = (r, id) => r.materials.filter((m) => m.moduleKey === `0-${id}`);
const cut = (rows) => rows.map((m) => `${m.part} ${m.w}×${m.h}×${m.qty}`);
const modOf = (r, id) => r.spec.items[0].modules.find((m) => m.moduleKey === `0-${id}`);
const errorsOf = (r) => r.check.issues.filter((i) => i.level === 'error');

describe('키큰장 맨 아래 단 서랍 — 싱크 서랍장 규칙 그대로 (단 몸통이 전면 영역)', () => {
  const r = run([tier(0, 801, BOTTOM, DRAWER), tier(1, 979, MIDDLE), tier(2, 400, TOP)]);
  const rows = rowsOf(r, 'planner-tall-0-0');

  test('자재: 서랍도어 2 (370 · 371) · 대 박스 2 · 중간 목찬넬 · 상단 목찬넬 · 좌대 — 도어 · 선반은 없다', () => {
    expect(cut(rows)).toEqual([
      '측판 620×801×2', '지판 570×620×1', '밴드 70×570×2', '뒷판 599×800×1',
      '서랍도어 596×370×1', '서랍도어 596×371×1',
      '서랍전후판 528×162×4', '서랍측판 490×180×4', '서랍밑판 548×489×2',
      '목찬넬(중간 전면) 72×600×1', '목찬넬(중간 지면) 40×600×1',
      '목찬넬(전면) 52×600×1', '목찬넬(지면) 40×600×1',
      '좌대 전후 600×60×2', '좌대 측 540×60×2', '좌대 걸레받이 60×600×1',
    ]);
    expect(rows.find((m) => m.part === '측판').note).toBe('목찬넬 따내기 상단 70×40 + 중간 90×40 ×1');
    // 전면 합 + 목찬넬 틈 30 × 2 = 단 몸통 (좌대를 덮지 않는다 — 단 도어 H − 30 과 같다)
    expect(370 + 371 + 30 * 2).toBe(801);
  });

  test('철물: 레일 = 박스 수, 경첩 없음 (서랍장 전면은 마이다)', () => {
    const mine = r.hardware.filter((h) => h.moduleKey === '0-planner-tall-0-0');
    expect(mine.map((h) => `${h.category} ${h.item} ${h.spec} ×${h.qty}`)).toEqual(['레일 댐핑 언더레일 500mm ×2']);
  });

  test('조립 명세: 단의 행이 모두 놓이고 박스 2 · 레일 4 자리 — 검사 오류 없음', () => {
    expect(r.spec.unplaced).toEqual([]);
    const m = modOf(r, 'planner-tall-0-0');
    expect(m.kind).toBe('tall');
    expect(m.drawerBoxes).toHaveLength(2);
    expect(m.hardware.filter((h) => h.kind === 'rail').every((h) => h.at && !h.pending)).toBe(true);
    expect(m.hardware.filter((h) => h.kind === 'rail')).toHaveLength(4);
    // 위 서랍 전면 윗변 = 몸통 − 상단 목찬넬 틈 30, 아래 서랍 밑단 = 몸통 바닥
    const fronts = m.parts.filter((p) => p.part === '서랍도어').map((p) => [p.box.min[1], p.box.max[1]]);
    expect(fronts).toEqual([[401, 771], [0, 371]]);
    expect(errorsOf(r)).toEqual([]);
  });
});

describe('냉장고장 품목의 플래너 키큰장 단 — 경첩도 단 규칙 (fridge.md: pos 있는 모듈은 싱크대 규칙)', () => {
  test('중간 단 도어 979 − 4 = 975 로 보링 (예전엔 옛 화면 표로 H + 20 = 999)', () => {
    const design = { items: [{ categoryId: 'fridge', w: 1900, h: 2310, d: 700, specs: Object.assign({}, SPECS), modules: [tier(1, 979, MIDDLE)] }] };
    const door = new MaterialExtractor().extract(design).materials.find((m) => m.part === '도어');
    const hinge = new HardwareExtractor().extract(design).hardware.find((h) => h.category === '경첩');
    expect(door.h).toBe(975);
    expect(hinge.boring[hinge.boring.length - 1]).toBe(975 - 110);
  });
});

describe('중간 · 상부 단 서랍은 규칙이 없다', () => {
  test('부재 · 레일을 내지 않고 측판 비고에 [확인 필요]', () => {
    const r = run([tier(0, 801, BOTTOM), tier(1, 979, MIDDLE, DRAWER), tier(2, 400, TOP)]);
    const rows = rowsOf(r, 'planner-tall-1-0');
    expect(rows.filter((m) => /서랍/.test(m.part))).toEqual([]);
    expect(rows.find((m) => m.part === '측판').note).toMatch(/\[확인 필요\] 키큰장 서랍은 맨 아래 단만/);
    expect(r.hardware.filter((h) => h.category === '레일')).toEqual([]);
    expect(modOf(r, 'planner-tall-1-0').drawerBoxes).toEqual([]);
  });
});

describe('상자 단 — 오픈장 · 밥솥장으로 바꾼 단도 그 단의 좌대 · 상몰딩을 낸다', () => {
  test('바닥 단 오픈장: 상자 + 좌대 상자 · 걸레받이, 다리발은 일반 하부장만 센다', () => {
    const r = run([tier(0, 801, BOTTOM, OPEN(0)), tier(1, 979, MIDDLE), tier(2, 400, TOP), LOWER]);
    expect(cut(rowsOf(r, 'planner-tall-0-open'))).toEqual([
      '측판 620×801×2', '천지판 564×600×2', '뒷판 564×801×1',
      '좌대 전후 600×60×2', '좌대 측 540×60×2', '좌대 걸레받이 60×600×1',
    ]);
    expect(r.hardware.filter((h) => h.category === '다리발').map((h) => h.qty)).toEqual([4]);   // 하부장 600 하나 = 4
    const m = modOf(r, 'planner-tall-0-open');
    expect(m.kind).toBe('open');
    expect(m.hardware.filter((h) => h.kind === 'leg')).toEqual([]);
    // 좌대 자리 = 몸통 단과 같다 (뒤 맞춤, 걸레받이는 상자 앞면에 붙어 선다)
    const ped = m.parts.filter((p) => p.tags.pedestal).map((p) => [p.part, p.box.min, p.box.max]);
    expect(ped).toEqual([
      ['좌대 전후', [-300, -60, 245], [300, 0, 260]], ['좌대 전후', [-300, -60, -310], [300, 0, -295]],
      ['좌대 측', [-300, -60, -295], [-285, 0, 245]], ['좌대 측', [285, -60, -295], [300, 0, 245]],
      ['좌대 걸레받이', [-300, -60, 260], [300, 0, 278]],
    ]);
    // 하부장 줄 라인 부재(상판 · 걸레받이 · 목찬넬)는 lines 없이 놓지 않는다 — 이 시험은 키큰장 단만 본다
    expect(r.spec.unplaced.filter((u) => /^0-planner-tall-/.test(u.moduleKey))).toEqual([]);
    expect(errorsOf(r)).toEqual([]);
  });

  test('맨 위 단 오픈장: 상몰딩이 그 상자 위 (앞면 = 도어 앞면)', () => {
    const r = run([tier(0, 801, BOTTOM), tier(1, 979, MIDDLE), tier(2, 400, TOP, OPEN(2))]);
    expect(cut(rowsOf(r, 'planner-tall-2-open'))).toEqual(['측판 620×400×2', '천지판 564×600×2', '뒷판 564×400×1', '상몰딩 60×600×1']);
    const molding = modOf(r, 'planner-tall-2-open').parts.find((p) => p.part === '상몰딩');
    expect([molding.box.min, molding.box.max]).toEqual([[-300, 400, 310], [300, 460, 328]]);
    expect(r.spec.unplaced).toEqual([]);
    expect(errorsOf(r)).toEqual([]);
  });

  test('가전 칸 단 (하부 서랍 · 가운데 밥솥장 여닫이 500 · 맨 위 플랩 879): 행이 모두 놓이고 검사 오류 없음', () => {
    const rice = { id: 'planner-tall-1-rice', moduleKind: 'rice', name: '밥솥장', doorCount: 1, doorType: 'swing', isOpen: false, hingeSide: 'left' };
    const flap = { doorOpen: 'up', hingeSide: undefined };
    const r = run([tier(0, 801, BOTTOM, DRAWER), tier(1, 500, MIDDLE, rice), tier(2, 879, TOP, flap)]);
    expect(cut(rowsOf(r, 'planner-tall-1-rice'))).toEqual(['측판 620×500×2', '천지판 564×600×2', '뒷판 564×500×1', '도어 596×496×1']);
    // 가운데 단이라 좌대 · 상몰딩이 없다
    expect(rowsOf(r, 'planner-tall-1-rice').filter((m) => /좌대|상몰딩/.test(m.part))).toEqual([]);
    // 플랩 — 상부장 플랩과 같은 철물: 천판 쪽 경첩(도어 폭 변 보링) + 가스쇼바 2 (도어 596×875 ≈ 7kg → 9kg)
    const flapHw = r.hardware.filter((h) => h.moduleKey === '0-planner-tall-2-0');
    expect(flapHw.map((h) => `${h.category} ${h.spec} ×${h.qty} ${h.boringSide || ''}`.trim())).toEqual(['경첩 2구 ×2 top', '가스쇼바 MJG250-90 ×2']);
    expect(modOf(r, 'planner-tall-2-0').hardware.filter((h) => h.kind === 'hinge').every((h) => h.edge === 'top' && h.at)).toBe(true);
    expect(modOf(r, 'planner-tall-1-rice').hardware.filter((h) => h.kind === 'hinge').every((h) => h.edge === 'left' && h.at)).toBe(true);
    expect(r.spec.unplaced).toEqual([]);
    expect(errorsOf(r)).toEqual([]);
  });
});
