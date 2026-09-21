/**
 * 플래너 오버레이는 한 번에 하나만 보인다 (2026-09-22).
 *
 * 증상: 품목이나 단계를 넘어갈 때마다 화면이 깜빡였다.
 *
 * 원인: 품목마다 오버레이가 하나씩 생기는데(`__planner-overlay-{uniqueId}`),
 *   base.css 의 `body.step2-fullscreen [id^="__planner-overlay-"] { display:block !important }`
 *   가 **전부** 켰다. 코드의 `style.display='none'` 은 !important 에 막혀 먹히지 않았고,
 *   결국 이전 품목의 플래너가 DOM 순서대로 위에 남았다 — 깜빡이거나 남의 배치가 보였다.
 *   Step 3(BOM)으로 가도 품목별 오버레이는 감춰지지 않아 보고서를 덮을 수 있었다.
 *
 * 고친 방식: 보일 오버레이에만 활성 표시(.planner-overlay-active)를 붙이고, CSS 가
 *   나머지를 감춘다. **표시를 붙이는 곳은 _showOnlyPlannerOverlay 하나뿐이다.**
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'css/detaildesign/base.css'), 'utf8');

function sliceBalanced(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(startIdx, i + 1);
  }
  throw new Error('중괄호 짝을 찾지 못했습니다');
}

describe('CSS — 활성 표시가 붙은 하나만 보인다', () => {
  test('표시가 없는 오버레이는 감춘다', () => {
    expect(CSS).toMatch(/\[id\^="__planner-overlay-"\]:not\(\.planner-overlay-active\)\s*\{\s*display:\s*none\s*!important/);
  });

  test('풀화면 강제 규칙은 **활성인 것에만** 걸린다 (예전엔 전부에 걸렸다)', () => {
    const rule = CSS.match(/body\.step2-fullscreen \[id\^="__planner-overlay-"\][^{]*\{[^}]*display:\s*block\s*!important[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule[0]).toContain('.planner-overlay-active');
  });
});

describe('JS — 보이는 오버레이를 정하는 곳은 하나다', () => {
  const fn = sliceBalanced(UI, UI.indexOf('function _showOnlyPlannerOverlay('));

  test('_showOnlyPlannerOverlay 가 모든 오버레이를 훑어 하나만 켠다', () => {
    expect(fn).toContain("querySelectorAll('[id^=\"__planner-overlay-\"]')");
    expect(fn).toContain('classList.toggle(PLANNER_OVERLAY_ACTIVE');
  });

  test('null 을 주면 전부 감춘다 — Step 3 가 그렇게 쓴다', () => {
    expect(fn).toMatch(/!!overlayId/);
    const step3 = sliceBalanced(UI, UI.indexOf('function goToStep3'));
    expect(step3).toContain('_showOnlyPlannerOverlay(null)');
  });

  test('자리를 잡는 두 길(재배치·생성)이 모두 그 함수를 지난다', () => {
    const pos = sliceBalanced(UI, UI.indexOf('function _positionPlannerOverlay'));
    const create = sliceBalanced(UI, UI.indexOf('function _createPlannerOverlay'));
    expect(pos).toContain('_showOnlyPlannerOverlay(overlayId)');
    expect(create).toContain('_showOnlyPlannerOverlay(overlayId)');
  });

  test('부트스트랩 오버레이도 같은 길을 지난다', () => {
    const boot = sliceBalanced(UI, UI.indexOf('function _ensureBootstrapPlanner'));
    expect(boot).toContain('_showOnlyPlannerOverlay(overlay.id)');
  });

  test('Step 2 로 돌아오면 지금 품목 것만 켠다', () => {
    const back = sliceBalanced(UI, UI.indexOf('function backToStep2'));
    expect(back).toContain('_showOnlyPlannerOverlayFor(_currentStep2Item())');
  });

  test('3D 가 아닌 뷰로 바꾸면 끈다 — style.display 는 !important 에 막혔다', () => {
    const sw = sliceBalanced(UI, UI.indexOf('function switchViewMode'));
    expect(sw).toContain('_showOnlyPlannerOverlay(null)');
    expect(sw).not.toMatch(/overlay\.style\.display\s*=\s*'none'/);
  });
});

describe('JS — 품목 전환에 빈 구간을 두지 않는다', () => {
  const impl = sliceBalanced(UI, UI.indexOf('function _renderWorkspaceContentImpl'));

  test('리빌드 중에 오버레이를 감추지 않는다 (body 직속 fixed 라 영향받지 않는다)', () => {
    expect(impl).not.toMatch(/plannerOverlay\.style\.display\s*=\s*'none'/);
  });

  test('자리잡기를 **즉시 한 번** 시도하고, 안 될 때만 미룬다', () => {
    // 예전엔 무조건 setTimeout(…, 50) 이라 그 사이가 곧 깜빡임이었다
    expect(impl).toContain('if (!tryInit3D(0)) setTimeout(() => tryInit3D(5), 50);');
    expect(impl).not.toMatch(/^\s*setTimeout\(\(\) => tryInit3D\(5\), 50\);\s*$/m);
  });
});
