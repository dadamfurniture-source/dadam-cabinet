/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 2026-10-20 사장님 카드 「신발장·창고장의 빠른 배치 "일자" 버튼은 무엇을 놓을까요?」 → 키큰장 한 줄.
 * 품목 폭 그대로 키큰장 한 줄을 놓고, 구조 단계가 폭을 나눠 모듈을 세운다.
 * 예전엔 하부장 + 상부장 한 줄이었다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const P = require('../js/planner/planner-presets');
const sections = require('../js/planner/planner-sections');
const engine = require('../js/planner/planner-engine');

const FRONT_RESERVE = engine.MASTER_RULES.CORNER_DRIP + engine.MASTER_RULES.DOOR_SEAT_D;

describe.each(['shoerack', 'warehouse'])('%s 일자 = 키큰장 한 줄', (cat) => {
  test('계획: 일자만, 키큰장', () => {
    expect(P.plannerPresetPlanOf(cat)).toEqual({ kinds: ['I'], sections: ['tall'] });
    const cfg = sections.buildSectionConfig(undefined, undefined, cat);
    expect(P.plannerPresetLayout('L', { config: cfg, categoryId: cat })).toBeNull();
  });

  test('배치 화면: 일자 → 품목 폭 키큰장 하나, 깊이 = 품목 깊이 + 앞 여유', () => {
    const p = bootPlanner('mockup-shell.html', { search: `?design=t&item=1&preset=${cat}&w=1800&d=350` });
    const shown = [...p.document.querySelectorAll('.preset-btn')].filter((b) => b.style.display !== 'none').map((b) => b.dataset.preset);
    expect(shown).toEqual(['I']);
    expect(p.g('applyPreset')('I')).toBe(true);
    const mods = p.g('serializeLayout')().modules;
    expect(mods.map((m) => [m.section, m.w, m.h, m.rotation])).toEqual([['tall', 1800, 350 + FRONT_RESERVE, 0]]);
  });

  test('장 버튼: 키큰장 첫 사각형도 품목 폭', () => {
    const p = bootPlanner('mockup-shell.html', { search: `?design=t&item=1&preset=${cat}&w=1800&d=350` });
    p.document.querySelector('.rect-btn[data-section="tall"]').click();
    const g = p.document.querySelector('g.content > g.sect-rect.tall');
    expect(+g.querySelector(':scope > rect').getAttribute('width')).toBe(1800);
  });
});
