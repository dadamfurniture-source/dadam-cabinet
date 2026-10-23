/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 모듈 라이브러리 게이트 8·9 (docs/01-plan/module-library.plan.md §3) — **실제 플래너에 넣어 본다.**
 *
 *   8 드리프트  라이브러리가 덮는 구조 키가 플래너 defaultStructure() 키 안에 있다 (+ drawerCount — 서랍 단수 입력이 쓰는 키).
 *               플래너가 구조 키를 바꾸면 여기서 깨진다.
 *   9 왕복      실제 플래너(jsdom)에 addModuleToArea 로 넣고 구조를 덮은 결과의 BOM·조립 명세가
 *               순수 경로(test-utils/module-library/pipeline.js — Node 명령줄·CAD 덤프가 쓰는 길)와 **같다.**
 *               같으므로 플래너에서 이 모듈을 넣으면 보고서·STEP/GLB 와 같은 것이 만들어진다.
 */
const Lib = require('../js/module-library/module-library.js');
const pipeline = require('../test-utils/module-library/pipeline');
const { runEntryInPlanner } = require('../test-utils/module-library/harness');

// 시험 견본 — 모듈이 하나도 없어도 하네스 경로를 본다
const { SAMPLES } = require('../test-utils/module-library/samples');

/** 서랍 단수 입력(inpDrawerRatio · inpDrawerCount)이 쓰는 키 — defaultStructure 에는 없고 화면이 더한다. */
const EXTRA_KEYS = ['drawerCount'];

const CASES = SAMPLES.map((e) => [`견본 ${e.id}`, e]).concat(Lib.ENTRIES.map((e) => [e.id, e]));

describe('게이트 8 · 9 — 실제 플래너에 넣기', () => {
  test.each(CASES)('%s', (_, e) => {
    const h = runEntryInPlanner(e);
    // 8 — 드리프트
    const allowed = new Set(h.defaultKeys.concat(EXTRA_KEYS));
    expect(Object.keys(Lib.structureOf(e)).filter((k) => !allowed.has(k))).toEqual([]);
    // 플래너가 정한 높이·깊이가 순수 경로의 배치 공간 모델과 같다
    const pure = pipeline.runEntry(e);
    const pm = pure.payload.modules[0];
    expect({ W: h.module.W, H: h.module.H, D: h.module.D, y: h.module.y })
      .toEqual({ W: pm.W, H: pm.H, D: pm.D, y: pm.y });
    expect(h.structure.shelves).toEqual(pure.payload.structures[pm.id].shelves);
    // 9 — 왕복: BOM · 철물 · 조립 명세가 같다
    expect(h.conv.warnings).toEqual(pure.conv.warnings);
    expect(h.materials).toEqual(pure.materials);
    expect(h.hardware).toEqual(pure.hardware);
    expect(h.spec).toEqual(pure.spec);
  });
});
