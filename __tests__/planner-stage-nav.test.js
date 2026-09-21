/**
 * 단계 이동 — 저장이 끝나는 대로 넘어간다 (2026-09-22).
 *
 * 증상: 단계를 넘어갈 때마다 한 박자 멈췄다 깜빡인다.
 *
 * 원인: 「구조 단계」는 `plannerAutosave('layout', 0)` 로 0ms 타이머를 걸고
 *   `setTimeout(…, 400)` 뒤에 페이지를 옮겼다. 그 400 은 **계정 저장이 요청을 띄울 시간**인데,
 *   저장이 20ms 에 끝나도 400 을 꽉 채워 기다렸다 — 그동안 화면이 멈춰 있다.
 *   반대로 「디테일」 버튼은 기다리지 않고 바로 옮겨, 0ms 타이머가 뜨기도 전에 페이지가 떠나
 *   **계정 저장이 아예 일어나지 않았다.**
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'mockup-shell.html'), 'utf8').split('\r\n').join('\n');
const STORE = require('../js/planner/planner-store.js');

function sliceBalanced(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(startIdx, i + 1);
  }
  throw new Error('중괄호 짝을 찾지 못했습니다');
}

describe('저장은 약속을 돌려준다 — 호출부가 끝나는 때를 안다', () => {
  test('plannerAutosaveNow 가 있다', () => {
    expect(typeof STORE.plannerAutosaveNow).toBe('function');
  });

  test('자동 저장이 꺼져 있으면 null — 올릴 것이 없다는 뜻이고 바로 넘어간다', () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=d1&item=100' });
    p.g('setPlannerAutosave')(false);
    expect(p.g('plannerAutosaveNow')('layout')).toBeNull();
    p.g('setPlannerAutosave')(true);
  });

  test('켜져 있으면 약속을 돌려준다 (실패해도 약속이다 — 이동을 막지 않는다)', async () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=d1&item=100' });
    p.g('setPlannerAutosave')(true);
    const r = p.g('plannerAutosaveNow')('layout');
    expect(r).not.toBeNull();
    expect(typeof r.then).toBe('function');
    await expect(r).resolves.toBeDefined();   // 스코프가 없어도 거절이 아니라 결과로 온다
  });

  test('예약돼 있던 자동 저장 타이머를 대신한다 — 두 번 올리지 않는다', () => {
    const fn = STORE.plannerAutosaveNow.toString();
    expect(fn).toContain('clearTimeout(_plannerAutosaveTimers[stage])');
  });
});

describe('단계 이동은 한 길을 쓴다', () => {
  const nav = sliceBalanced(SHELL, SHELL.indexOf('function goToStage'));

  test('저장이 끝나면 곧바로, 실패해도 넘어간다', () => {
    expect(nav).toContain("plannerAutosaveNow('layout')");
    expect(nav).toContain('p.then(go, go)');       // 성공·실패 둘 다 간다
  });

  test('상한이 있다 — 저장이 느려도 갇히지 않는다', () => {
    expect(nav).toContain('setTimeout(go, STAGE_NAV_MAX_WAIT)');
    expect(SHELL).toMatch(/STAGE_NAV_MAX_WAIT = \d+/);
  });

  test('한 번만 넘어간다 (약속과 상한이 겹쳐도)', () => {
    expect(nav).toContain('if (gone) return; gone = true;');
  });

  test('기다리는 동안 막을 덮는다', () => {
    expect(nav).toContain('showStageCurtain(label)');
    expect(SHELL).toContain('id="stageCurtain"');
  });

  test('막은 목적지의 첫 바탕색과 같다 — 페이지가 바뀌는 이음매가 묻힌다', () => {
    const structure = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
    const destBg = structure.match(/--bg:\s*(#[0-9a-fA-F]{6})/)[1].toLowerCase();
    const curtain = SHELL.match(/#stageCurtain\{[^}]*background:(#[0-9a-fA-F]{6})/)[1].toLowerCase();
    expect(curtain).toBe(destBg);
  });

  test('구조·디테일 두 버튼이 모두 이 길을 쓴다 — 예전엔 디테일만 기다리지 않았다', () => {
    const next = SHELL.slice(SHELL.indexOf("getElementById('nextStepBtn').onclick"));
    const nextBody = next.slice(0, next.indexOf('function searchWithStage'));
    const detail = sliceBalanced(SHELL, SHELL.indexOf("document.getElementById('detailStageBtn').onclick"));
    expect(nextBody).toContain('goToStage(');
    expect(detail).toContain('goToStage(');
    // 예전 길(무조건 400ms)은 남아 있지 않다
    expect(SHELL).not.toMatch(/setTimeout\(\(\) => \{ location\.href = 'mockup-structure'/);
  });
});

describe('겹침 검사는 그대로다 — 겹치면 넘어가지 않는다', () => {
  test('겹침이 있으면 goToStage 까지 가지 않는다', () => {
    const next = SHELL.slice(SHELL.indexOf("getElementById('nextStepBtn').onclick"));
    const body = next.slice(0, next.indexOf('function searchWithStage'));
    const guard = body.indexOf('return;   // W12-75');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf('goToStage('));   // 막는 것이 먼저다
  });
});
