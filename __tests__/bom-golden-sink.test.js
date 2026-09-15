/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * B0: 싱크대 BOM 골든 동결 (docs/01-plan/detail-bom-deepening.plan.md §5 B0).
 *
 * 표준 부재표(bom-protocol.md §3-1)·철물(§4)·요약·CSV/CNC 는 지금까지 시험이 0 이었다.
 * 이 시험은 `MaterialExtractor`·`HardwareExtractor` 의 **현재 출력**을 골든에 묶어,
 * 이후 리팩터(B1 부재 식별자, B2 누락 자재 …)가 무엇을 바꿨는지 diff 로 보이게 한다.
 *
 * 값이 옳은지는 여기서 판단하지 않는다 — 그건 규칙 시험(bom-body-thickness, extractors-*)의 몫.
 * 갱신: UPDATE_GOLDEN=1 npx jest __tests__/bom-golden-*.test.js  (test-utils/bom-golden/golden.js)
 */
const { FIXTURES, designOf } = require('../test-utils/bom-golden/fixtures');
const {
  loadExtractors, snapshotOf, expectGolden, MATERIAL_ROW_KEYS, HARDWARE_ROW_KEYS,
} = require('../test-utils/bom-golden/golden');

describe('BOM 골든 — 싱크대 15T (sink15)', () => {
  const snap = snapshotOf(designOf(FIXTURES.sink15));

  test('자재·철물·요약·내보내기 첫 줄이 골든과 같다', () => {
    expectGolden('sink15', snap);
  });

  test('행 형태: 자재 11필드 · 철물 8필드 (I4 — 필드는 추가만)', () => {
    expect(snap.materials.length).toBeGreaterThan(0);
    snap.materials.forEach((m) => expect(Object.keys(m)).toEqual(MATERIAL_ROW_KEYS));
    // 철물은 부분집합 — 손잡이 행의 note 가 `item.category`(없는 필드) 라 JSON 에서 빠진다. 이 어긋남도 지금 상태다.
    snap.hardware.forEach((h) => expect(HARDWARE_ROW_KEYS.filter((k) => k in h)).toEqual(Object.keys(h)));
  });

  test('픽스처가 의도한 가지를 실제로 건다 (골든이 빈 가지를 동결하지 않도록)', () => {
    const parts = (mod) => snap.materials.filter((m) => m.module === mod).map((m) => m.part);
    // 상부: 후드는 몸통 없음, 1D(600) 는 처짐방지 1, 2D(900) 는 2
    expect(snap.materials.some((m) => /후드/.test(m.module))).toBe(false);
    expect(snap.materials.find((m) => m.module === '상부장-상부장(1D)' && m.part === '밴드(처짐방지)').qty).toBe(1);
    expect(snap.materials.find((m) => m.module === '상부장-상부장(2D)' && m.part === '밴드(처짐방지)').qty).toBe(2);
    // 하부: 개수대·EL·오픈은 선반 없음, 2D 는 있음
    expect(parts('하부장-개수대')).not.toContain('선반');
    expect(parts('하부장-EL장')).not.toContain('선반');
    expect(parts('하부장-오픈장')).not.toContain('선반');
    expect(parts('하부장-오픈장')).not.toContain('도어');
    expect(parts('하부장-하부장(2D)')).toContain('선반');
    // 서랍장 800×2 (도어 1 + 서랍 2단): 서랍 부재 + 하단보강(전후판 728>600) + 서랍도어 + 도어
    //   + 중간 목찬넬(전면판 72·지면판 40) — 2026-09-15 서랍장 규칙 (bom-drawer-rules.js). 옛 '목찬넬 120×W' 는 없다.
    expect(parts('하부장-서랍장')).toEqual(expect.arrayContaining([
      '서랍전후판', '서랍측판', '서랍밑판', '서랍 하단보강', '서랍도어', '도어', '목찬넬(중간 전면)', '목찬넬(중간 지면)',
    ]));
    expect(parts('하부장-서랍장')).not.toContain('목찬넬');
    // 가스대는 몸통 없음
    expect(snap.materials.some((m) => /가스대/.test(m.module))).toBe(false);
    // EP: 상몰딩(상부 2700 > 2000 → 2면(장)), 걸레받이, 목찬넬 전면·지면, 좌측 휠라, 우측 없음
    expect(parts('EP')).toEqual(['상몰딩', '걸레받이', '목찬넬(전면)', '목찬넬(지면)', '휠라(좌)']);
    expect(snap.materials.find((m) => m.part === '상몰딩').edge).toBe('2면(장)');
    // 철물 분류 다섯 가지가 다 나온다
    expect(Object.keys(snap.hardwareSummary).sort()).toEqual(['경첩', '다리발', '레일', '브라켓', '손잡이'].sort());
  });

  test('내보내기 머리글은 bom-protocol.md §7 과 같다', () => {
    expect(snap.csvHead[0]).toBe('모듈,부품,자재,두께,가로,세로,수량,엣지,비고');
    expect(snap.cncHead[0]).toBe('품목,자재,두께,가로,세로,수량,엣지L,엣지R,엣지T,엣지B');
    expect(snap.hardwareCsvHead[0]).toBe('분류,품목,제조사,스펙,수량,단위,비고');
  });

  test('요약 키는 자재_두께 이고 원판 수는 1220×2440 기준 올림이다', () => {
    const { MaterialExtractor } = loadExtractors();
    const me = new MaterialExtractor();
    expect(me.PANEL_W).toBe(1220);
    expect(me.PANEL_H).toBe(2440);
    Object.entries(snap.summary).forEach(([key, s]) => {
      expect(key).toBe(`${s.material}_${s.thickness}`);
      expect(s.panelCount).toBe(Math.ceil(s.totalArea / (1220 * 2440)));
    });
  });
});

describe('BOM 골든 — 싱크대 18T (sink18)', () => {
  const snap15 = snapshotOf(designOf(FIXTURES.sink15));
  const snap18 = snapshotOf(designOf(FIXTURES.sink18));

  test('자재·철물·요약·내보내기 첫 줄이 골든과 같다', () => {
    expectGolden('sink18', snap18);
  });

  test('15T 와 행 수·부재 이름이 같고 몸통 파생 치수만 다르다 (W12-1)', () => {
    expect(snap18.materials.map((m) => `${m.module}/${m.part}`))
      .toEqual(snap15.materials.map((m) => `${m.module}/${m.part}`));
    // 도어(MDF 18T)는 몸통 두께를 안 따라간다
    const doors = (s) => s.materials.filter((m) => m.part === '도어' || m.part === '서랍도어').map((m) => [m.w, m.h, m.qty]);
    expect(doors(snap18)).toEqual(doors(snap15));
    // 천판은 W−2T: 15T → W−30, 18T → W−36
    const top15 = snap15.materials.find((m) => m.module === '상부장-상부장(1D)' && m.part === '천판');
    const top18 = snap18.materials.find((m) => m.module === '상부장-상부장(1D)' && m.part === '천판');
    expect(top15.w).toBe(600 - 30);
    expect(top18.w).toBe(600 - 36);
    // 철물은 두께와 무관
    expect(snap18.hardware).toEqual(snap15.hardware);
  });
});

describe('BOM 골든 — ㄱ자 멍장 (sinkCorner)', () => {
  const snap = snapshotOf(designOf(FIXTURES.sinkCorner));
  const parts = (mod) => snap.materials.filter((m) => m.module === mod).map((m) => m.part);

  test('자재·철물·요약·내보내기 첫 줄이 골든과 같다', () => {
    expectGolden('sinkCorner', snap);
  });

  test('멍장 정면 부재가 상·하 둘 다 나오고, 마감재는 라인 마감(휠라/몰딩)을 따른다', () => {
    expect(parts('하부장-LT망장')).toEqual(expect.arrayContaining([
      '도어', '멍가림판', '경첩목대(앞다리)', '경첩목대(옆다리)', '휠라(멍판)',
    ]));
    expect(parts('상부장-LT망장')).toEqual(expect.arrayContaining(['도어', '멍가림판', '몰딩(멍판)']));
    expect(parts('EP')).toContain('몰딩(코너1)');
    // 멍장 도어는 doorW 기준(카카스 W 면 오발주), 선반은 ㄱ자 목대 75 만큼 짧다
    expect(snap.materials.find((m) => m.module === '하부장-LT망장' && m.part === '도어').w).toBe(411 - 4);
    expect(snap.materials.find((m) => m.module === '하부장-LT망장' && m.part === '선반').h).toBe(650 - 15 - 75);
    // 마감재 재단 폭은 blindFinishW 가 없으니 폴백 상수다 — 값 자체는 골든이 잠그고,
    // 정본(data-constants.js:89 = 150)과의 동기는 extractors-blind-finish.test.js 가 본다.
  });
});

describe('DrawingVisualizer 원판 규격', () => {
  test('1220×2440 (data-constants SHEET_W/H 와 같은 값), 커프 4', () => {
    const { DrawingVisualizer } = loadExtractors();
    const dv = new DrawingVisualizer();
    expect(dv.PANEL_W).toBe(1220);
    expect(dv.PANEL_H).toBe(2440);
    expect(dv.KERF).toBe(4);
  });
});
