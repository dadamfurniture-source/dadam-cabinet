/**
 * 품목을 바꿔도 하던 단계가 유지된다 (2026-09-22).
 *
 * 증상: 배치·구조·디테일 어느 단계에서든 품목을 지정하면 **배치로 초기화**됐다.
 *
 * 원인: 부모(detaildesign)는 품목마다 플래너 iframe 을 따로 만드는데
 *   (`__planner-overlay-{uniqueId}`), 그 주소가 **늘 `/mockup-shell`(배치)** 이었다.
 *   되돌아오면 하던 단계가 살아 있었다 — 그 iframe 은 그대로였으니까. 즉 품목마다 단계가
 *   따로 논 게 아니라 **새로 여는 품목이 늘 배치로 열린** 것이다.
 *
 * 고친 방식: 품목을 바꾸기 **전에** 보고 있던 iframe 의 주소를 읽어 단계를 붙잡아 두고,
 *   다음 iframe 을 그 단계로 연다.
 *
 * ⚠ "플래너가 뜰 때 자기 단계를 알려 준다" 로 먼저 만들었다가 갈아엎었다 —
 *   **구조 ↔ 디테일은 페이지를 다시 열지 않는다** (planner-detail.js 가 history.replaceState 로
 *   `stage=detail` 만 붙였다 뗀다). 그래서 뜰 때만 듣는 방식은 그 전환을 영영 못 듣는다.
 *   주소를 직접 읽는 쪽이 옳다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
const DETAIL = fs.readFileSync(path.join(ROOT, 'js/planner/planner-detail.js'), 'utf8');

function sliceBalanced(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(startIdx, i + 1);
  }
  throw new Error('중괄호 짝을 찾지 못했습니다');
}

/** ui-step1 의 단계 읽기 함수를 그대로 떼어 평가한다 (전역 스크립트라 import 가 안 된다) */
function loadStageReader() {
  const src = sliceBalanced(UI, UI.indexOf('function _readPlannerStage'));
  // eslint-disable-next-line no-new-func
  return new Function('URLSearchParams', `${src}; return _readPlannerStage;`)(URLSearchParams);
}

const frameAt = (pathname, search) => ({ contentWindow: { location: { pathname, search } } });

describe('보고 있는 iframe 의 주소로 단계를 읽는다', () => {
  const read = loadStageReader();

  test('배치 — mockup-shell', () => {
    expect(read(frameAt('/mockup-shell', '?design=d1&item=1'))).toBe('layout');
  });

  test('구조 — mockup-structure, stage 없음', () => {
    expect(read(frameAt('/mockup-structure', '?design=d1&item=1'))).toBe('structure');
  });

  test('디테일 — mockup-structure + stage=detail', () => {
    expect(read(frameAt('/mockup-structure', '?design=d1&item=1&stage=detail'))).toBe('detail');
  });

  test('아직 안 떴거나 못 읽으면 null — 부르는 쪽이 마지막 값을 쓴다', () => {
    expect(read(null)).toBeNull();
    expect(read({})).toBeNull();
    expect(read({ contentWindow: {} })).toBeNull();
    const throws = { get contentWindow() { throw new Error('cross-origin'); } };
    expect(read(throws)).toBeNull();
  });
});

describe('이 방식이 맞는 이유 — 구조↔디테일은 페이지를 다시 열지 않는다', () => {
  test('planner-detail 은 replaceState 로 주소만 바꾼다 (load 가 일어나지 않는다)', () => {
    // 그래서 "뜰 때 알려 준다" 식으로는 이 전환을 못 듣는다. 주소는 늘 정확하다.
    expect(DETAIL).toContain('history.replaceState');
    expect(DETAIL).toMatch(/stage=detail/);
  });
});

describe('바꾸기 전에 붙잡고, 다음 품목을 그 단계로 연다', () => {
  test('품목을 바꾸기 **전에** 단계를 붙잡는다', () => {
    const fn = sliceBalanced(UI, UI.indexOf('function switchStep2Item'));
    const grab = fn.indexOf('_rememberVisiblePlannerStage()');
    const set = fn.indexOf('currentItemId = item.uniqueId');
    expect(grab).toBeGreaterThan(-1);
    expect(grab).toBeLessThan(set);   // 바꾼 뒤에 읽으면 새 품목(빈 화면)을 읽는다
  });

  test('품목을 넣고 뺄 때도 붙잡는다', () => {
    const fn = sliceBalanced(UI, UI.indexOf('function _syncStep2Mount'));
    expect(fn).toContain('_rememberVisiblePlannerStage()');
  });

  test('배치면 mockup-shell — stage 는 붙이지 않는다', () => {
    const fn = sliceBalanced(UI, UI.indexOf('function _plannerUrlForStage'));
    expect(fn).toContain("if (_plannerStage === 'layout')");
    expect(fn).toContain('PLANNER_BASE_URL');
  });

  test('구조·디테일이면 mockup-structure, 디테일만 stage=detail', () => {
    const fn = sliceBalanced(UI, UI.indexOf('function _plannerUrlForStage'));
    expect(fn).toContain('PLANNER_STRUCTURE_URL');
    expect(fn).toContain("q.set('stage', 'detail')");
    expect(fn).toContain("q.delete('stage')");
  });

  test('iframe 을 만들 때 그 주소를 쓴다 — 예전엔 늘 배치였다', () => {
    const embed = UI.slice(UI.indexOf('function _loadPlannerEmbed'));
    const body = embed.slice(0, embed.indexOf('container.appendChild(iframe)'));
    expect(body).toContain('iframe.src = _plannerUrlForStage(params)');
    expect(body).not.toMatch(/iframe\.src = PLANNER_BASE_URL \+ '\?' \+ params\.toString\(\)/);
  });

  test('스코프(design·item)는 그대로 넘어간다 — 잃으면 다른 품목의 배치를 연다', () => {
    const fn = sliceBalanced(UI, UI.indexOf('function _plannerUrlForStage'));
    expect(fn).toContain('new URLSearchParams(params)');
  });
});
