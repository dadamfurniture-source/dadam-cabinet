/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 2026-10-20 플래너 점검 — 사용자처럼 품목 11종을 처음부터 BOM 까지 만들어 보다가 나온 버그 셋.
 *
 * 1) 품목 깊이가 배치에 안 들어갔다.
 *    품목 드롭다운은 iframe 에 `?preset=shoerack&d=350` 처럼 깊이를 넘기는데 배치 사각형은
 *    늘 섹션 기본값(하부 650·키큰 650)이었다. 그래서 신발장·수납장·창고장 측판이 620,
 *    TV장 측판이 550 으로 나왔다(TV장 결정은 400). 아일랜드도 싱크대 규칙의 자리 800 이 아니었다.
 *    고친 방식(2026-10-20 카드 "몸통 깊이"): 단순 품목은 품목 깊이 = 몸통 깊이,
 *    배치 자리 = 몸통 + 물끊기 + 도어 자리(구조 단계 seatModuleDepth 가 빼는 값과 같다).
 *    아일랜드는 sink.md 대로 자리 깊이 800 을 그대로 쓴다.
 *
 * 2) 오른쪽 패널의 '도어 / 손잡이'·'마감 / 조명'·'BOM 미리보기' 는 어디에도 연결되지 않은 목업이었다.
 *    "14 개 / 22 장 / 2,840,000원" 이 품목과 상관없이 늘 같은 값으로 떠 사용자를 속였다.
 *
 * 3) 개별 모듈 패널에서 값을 바꾸고 '적용' 없이 다른 모듈을 고르거나 빈 곳을 누르면
 *    바꾼 값이 말없이 사라졌다. 떠나기 전에 초안을 적용한다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const sections = require('../js/planner/planner-sections');
const engine = require('../js/planner/planner-engine');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'mockup-shell.html'), 'utf8');
const FRONT_RESERVE = engine.MASTER_RULES.CORNER_DRIP + engine.MASTER_RULES.DOOR_SEAT_D;

function bootShell(search) {
  return bootPlanner('mockup-shell.html', { search });
}

describe('품목 깊이 → 배치 깊이', () => {
  test('applyItemDepthToSections — 단순 품목은 몸통 깊이 + 앞 여유', () => {
    const cfg = sections.buildSectionConfig(undefined, undefined, 'tvcabinet');
    sections.applyItemDepthToSections(cfg, 'tvcabinet', '400', FRONT_RESERVE);
    expect(cfg.lower.h).toBe(400 + FRONT_RESERVE);
    expect(cfg.tall.h).toBe(400 + FRONT_RESERVE);
    expect(cfg.upper.h).toBe(sections.PLANNER_SECTIONS.upper.h); // 상부장은 그대로
  });

  test('아일랜드는 자리 깊이 그대로', () => {
    const cfg = sections.buildSectionConfig(undefined, undefined, 'island');
    sections.applyItemDepthToSections(cfg, 'island', 800, FRONT_RESERVE);
    expect(cfg.lower.h).toBe(800);
  });

  test('싱크대·붙박이장·값 없음은 건드리지 않는다', () => {
    const base = sections.buildSectionConfig(undefined, undefined, 'sink');
    const cfg = sections.buildSectionConfig(undefined, undefined, 'sink');
    sections.applyItemDepthToSections(cfg, 'sink', 600, FRONT_RESERVE);
    expect(cfg.lower.h).toBe(base.lower.h);
    const cfg2 = sections.buildSectionConfig(undefined, undefined, 'shoerack');
    sections.applyItemDepthToSections(cfg2, 'shoerack', null, FRONT_RESERVE);
    sections.applyItemDepthToSections(cfg2, 'shoerack', 'abc', FRONT_RESERVE);
    expect(cfg2.tall.h).toBe(base.tall.h);
  });

  test('배치 화면이 URL d 로 섹션 깊이를 잡는다 (신발장 350 → 자리 380)', () => {
    const p = bootShell('?design=t&item=1&preset=shoerack&w=1200&h=2300&d=350');
    expect(p.g('SECTION_CONFIG').tall.h).toBe(350 + FRONT_RESERVE);
  });

  test('배치 화면은 구조 단계와 같은 앞 여유 값을 쓴다 (planner-engine 을 싣는다)', () => {
    expect(SHELL).toMatch(/<script src="js\/planner\/planner-engine\.js\?v=[\d.]+"><\/script>/);
  });
});

describe('오른쪽 가짜 패널 제거', () => {
  test('고정 숫자 BOM 미리보기·도어/손잡이·마감/조명 칸이 없다', () => {
    const p = bootShell('?design=t&item=1');
    const text = p.document.body.textContent;
    expect(text).not.toContain('BOM 미리보기');
    expect(text).not.toContain('2,840,000');
    const titles = [...p.document.querySelectorAll('.section-title, h3, h4')].map((n) => n.textContent.trim());
    expect(titles.some((t) => /도어\s*\/\s*손잡이|마감\s*\/\s*조명/.test(t))).toBe(false);
  });
});

describe('적용 안 한 모듈 변경을 잃지 않는다', () => {
  function setField(p, selector, value) {
    const inp = p.document.querySelector(selector);
    inp.value = String(value);
    inp.dispatchEvent(new p.window.Event('change', { bubbles: true }));
  }
  function twoLowers() {
    const p = bootPlanner('mockup-structure.html', { search: '?design=t&item=1' });
    const area = p.g('areas').find((a) => a.section === 'lower');
    const a = p.g('addModuleToArea')(area.id);
    const b = p.g('addModuleToArea')(area.id);
    return { p, a, b };
  }

  test('다른 모듈을 고르면 바꾼 값이 적용된다', () => {
    const { p, a, b } = twoLowers();
    p.g('setActiveModule')(a.id);
    setField(p, '#inpVCount', 3);
    expect(p.g('getStructure')(a.id).verticalCount).not.toBe(3); // 아직 초안
    p.g('setActiveModule')(b.id);
    expect(p.g('getStructure')(a.id).verticalCount).toBe(3);
  });

  test('선택을 풀어도 바꾼 값이 적용된다', () => {
    const { p, a } = twoLowers();
    p.g('setActiveModule')(a.id);
    setField(p, '#inpVCount', 3);
    p.g('setActiveModule')(null);
    expect(p.g('getStructure')(a.id).verticalCount).toBe(3);
  });

  test('되돌리기는 여전히 버린다', () => {
    const { p, a, b } = twoLowers();
    p.g('setActiveModule')(a.id);
    const before = p.g('getStructure')(a.id).verticalCount;
    setField(p, '#inpVCount', 3);
    p.g('revertModuleDraft')();
    p.g('setActiveModule')(b.id);
    expect(p.g('getStructure')(a.id).verticalCount).toBe(before);
  });
});
