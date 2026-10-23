/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 모듈 라이브러리 (docs/01-plan/module-library.plan.md) — 형식 · 구조 펼침 · 게이트 1~6 · 모듈별 BOM 골든.
 * 실제 플래너에 넣은 결과와 같은지(게이트 8·9)는 module-library-roundtrip.test.js.
 */
const Lib = require('../js/module-library/module-library.js');
const pipeline = require('../test-utils/module-library/pipeline');
const { expectModuleGolden, goldenIds } = require('../test-utils/module-library/golden');

/**
 * 시험 전용 견본 — 라이브러리 ENTRIES 가 아니다. 모듈이 하나도 없어도 사슬이 끝까지 도는지 본다.
 * 도어장 · 서랍장 · 상부장 하나씩 (계획 §6 시제품에서 통과한 구성).
 */
const { SAMPLES } = require('../test-utils/module-library/samples');

const sample = (patch) => Object.assign({}, SAMPLES[0], patch);

describe('기본 폭 — 사장님 결정 2026-10-23 (계획 §1)', () => {
  test('APPROVED_WIDTHS', () => {
    expect(Lib.APPROVED_WIDTHS).toEqual({
      door1: 450, door2: 900, drawer: 600, open: 450, tall: 600, el: 600, homecafe: 600, rice: 450,
    });
    expect(Object.isFrozen(Lib.APPROVED_WIDTHS)).toBe(true);
  });

  test('widthKeyOf — 서랍 · 오픈 · 2도어 · 1도어', () => {
    expect(Lib.widthKeyOf(SAMPLES[1])).toBe('drawer');
    expect(Lib.widthKeyOf(sample({ choice: { kind: 'open' } }))).toBe('open');
    expect(Lib.widthKeyOf(sample({ choice: { cell: 'open' } }))).toBe('open');
    expect(Lib.widthKeyOf(SAMPLES[2])).toBe('door2');
    expect(Lib.widthKeyOf(SAMPLES[0])).toBe('door1');
  });
});

describe('problemsOf — 선택값만, 승인된 폭만', () => {
  test.each(SAMPLES.map((e) => [e.id, e]))('견본 %s 은 문제없다', (_, e) => {
    expect(Lib.problemsOf(e)).toEqual([]);
  });

  test.each([
    ['승인 밖 폭', sample({ W: 500 }), /W 500/],
    ['모르는 선택값 (치수를 넣으려 함)', sample({ choice: { doors: 1, hinge: 'left', depth: 550 } }), /choice\.depth/],
    ['하부 플랩', sample({ choice: { doors: 1, hinge: 'up' } }), /플랩/],
    ['1도어 경첩 없음', sample({ choice: { doors: 1 } }), /hinge/],
    ['2도어에 경첩', sample({ W: 900, choice: { doors: 2, hinge: 'left' } }), /2도어/],
    ['상부 서랍장', sample({ section: 'upper', W: 600, choice: { drawer: { ratio: '2:2' } } }), /하부만/],
    ['서랍 비율에 mm', sample({ W: 600, choice: { drawer: { ratio: '2:150' } } }), /ratio/],
    ['서랍 6장', sample({ W: 600, choice: { drawer: { ratio: '2:2:2:2:2:2' } } }), /ratio/],
    ['레일 이름', sample({ W: 600, choice: { drawer: { ratio: '2:2', rail: 'side' } } }), /rail/],
    ['오픈장에 도어', sample({ choice: { kind: 'open', doors: 1, hinge: 'left' } }), /도어·경첩이 없다/],
    ['오픈장 상자 + 오픈 칸', sample({ choice: { kind: 'open', cell: 'open' } }), /하나만/],
    ['id 형식', sample({ id: 'lower-1' }), /id 형식/],
    ['status', sample({ status: 'draft' }), /status/],
  ])('%s → 거절', (_, e, re) => {
    expect(Lib.problemsOf(e).join(' · ')).toMatch(re);
  });

  test('오픈장 상자는 하부·상부 모두 받는다 (플래너 타입 선택에 섹션 제한 없음)', () => {
    expect(Lib.problemsOf(sample({ section: 'upper', choice: { kind: 'open' } }))).toEqual([]);
    expect(Lib.problemsOf(sample({ choice: { kind: 'open' } }))).toEqual([]);
  });

  test('needs-rule:<사유> 는 받는다', () => {
    expect(Lib.problemsOf(sample({ status: 'needs-rule:Q1' }))).toEqual([]);
  });
});

describe('structureOf — 플래너 화면이 같은 선택에서 쓰는 값', () => {
  test('1도어 우경첩 — 칸 하나, 열림 방향 우, 칸 폭 = W', () => {
    expect(Lib.structureOf(sample({ choice: { doors: 1, hinge: 'right' } }))).toEqual({
      moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorOnly',
      areaTypes: ['door'], areaDirections: ['right'], areaWidths: [450], areaIs2D: [false],
    });
  });

  test('2도어 — 양문 칸 (한 통에 도어 2, D1 아님)', () => {
    const s = Lib.structureOf(SAMPLES[2]);
    expect(s.areaIs2D).toEqual([true]);
    expect(s.verticalCount).toBe(1);
  });

  test('플랩 — 열림 방향 up', () => {
    expect(Lib.structureOf(sample({ section: 'upper', choice: { doors: 1, hinge: 'up' } })).areaDirections).toEqual(['up']);
  });

  test('서랍 2:1:1 — 칸 타입 서랍 → 상하 구성 + 전면 비율 입력 (mockup-structure 의 같은 동작)', () => {
    const s = Lib.structureOf(sample({ W: 600, choice: { drawer: { ratio: '2:1:1', rail: 'ball', sakuri: true } } }));
    expect(s.areaTypes).toEqual(['door']);
    expect(s.horizontalLayout).toBe('doorTopDrawerBottom');
    expect(s.bottomType).toBe('drawer');
    expect(s.drawerCount).toBe(2);
    expect(s.drawer).toEqual({ rail: 'ball', sakuri: true, boxT: 0, grades: ['small', 'small'], doorGrade: 'large' });
  });

  test('서랍 "N단" = 전면 장수 — 2:2 는 전면 2장 (위 칸 + 서랍 1)', () => {
    const s = Lib.structureOf(sample({ W: 600, choice: { drawer: { ratio: '2:2' } } }));
    expect(s.drawerCount + 1).toBe(2);
  });

  test('오픈장 · 오픈 칸', () => {
    expect(Lib.structureOf(sample({ choice: { kind: 'open' } })).moduleKind).toBe('open');
    expect(Lib.structureOf(sample({ section: 'upper', choice: { cell: 'open' } })).areaTypes).toEqual(['open']);
  });

  test('선반 · 다리발 · 손잡이 위치는 덮지 않는다 (addModuleToArea 몫)', () => {
    const s = Lib.structureOf(SAMPLES[0]);
    ['shelves', 'legH', 'handlePosition', 'handleType', 'topT'].forEach((k) => expect(s).not.toHaveProperty(k));
  });
});

describe('ENTRIES — 라이브러리 목록', () => {
  test('형식 문제 없음 · id 중복 없음 · 동결', () => {
    expect(Object.isFrozen(Lib.ENTRIES)).toBe(true);
    Lib.ENTRIES.forEach((e) => expect([e.id, Lib.problemsOf(e)]).toEqual([e.id, []]));
    const ids = Lib.ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('골든 파일 = verified 모듈 (남는 골든 없음)', () => {
    expect(goldenIds()).toEqual(Lib.list({ status: 'verified' }).map((e) => e.id).sort());
  });

  test('byId · list', () => {
    Lib.ENTRIES.forEach((e) => expect(Lib.byId(e.id)).toBe(e));
    expect(Lib.byId('nope')).toBeNull();
    expect(Lib.list({ section: 'lower' }).every((e) => e.section === 'lower')).toBe(true);
  });
});

describe('견본 — 사슬이 끝까지 돈다 (게이트 1~6)', () => {
  test.each(SAMPLES.map((e) => [e.id, e]))('%s', (_, e) => {
    const r = pipeline.runEntry(e);
    expect(r.gates.filter((g) => !g.ok)).toEqual([]);
    expect(r.spec.schema).toBe('dadam.assembly/1');
  });

  test('하부 몸통 550 · 상부 몸통 295 · 다리발 · 선반 (계획 §2)', () => {
    const lower = pipeline.runEntry(SAMPLES[0]);
    const upper = pipeline.runEntry(SAMPLES[2]);
    expect(lower.payload.modules[0].D).toBe(550);
    expect(upper.payload.modules[0].D).toBe(295);
    expect(lower.conv.modules[0].h).toBe(708);
    expect(upper.conv.modules[0].h).toBe(720);
  });
});

const VERIFIED = Lib.list({ status: 'verified' });
const NEEDS_RULE = Lib.ENTRIES.filter((e) => /^needs-rule:/.test(e.status));

describe('verified 모듈 — 게이트 1~6 · BOM 골든', () => {
  if (!VERIFIED.length) {
    test('아직 없음', () => expect(VERIFIED).toEqual([]));
    return;
  }
  test.each(VERIFIED.map((e) => [e.id, e]))('%s', (_, e) => {
    const r = pipeline.runEntry(e);
    expect(r.gates.filter((g) => !g.ok)).toEqual([]);
    expectModuleGolden(e.id, r.design);
  });
});

describe('needs-rule 모듈 — 실제로 게이트에 걸려 있다 (풀리면 verified 로 올린다)', () => {
  if (!NEEDS_RULE.length) {
    test('아직 없음', () => expect(NEEDS_RULE).toEqual([]));
    return;
  }
  test.each(NEEDS_RULE.map((e) => [e.id, e]))('%s', (_, e) => {
    expect(pipeline.runEntry(e).ok).toBe(false);
  });
});
