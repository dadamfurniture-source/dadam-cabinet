/**
 * Step 2 탈출 경로 회귀 테스트.
 *
 * 배경: step2-fullscreen 이 .design-workspace 의 모든 자식을 숨기는데(base.css)
 * BOM 산출 버튼이 그 안의 .ws-header 에 있었다. 게다가 planner overlay 가
 * z-index:100 으로 화면을 덮고 "입력 수정하기" 도 숨겨져,
 * Step 2 에 들어가면 Step 3 로도 Step 1 로도 갈 수 없었다.
 *
 * 이 테스트가 지키는 계약:
 *   1) #step2Toolbar 가 body 직속이어야 한다 (숨김 선택자에 걸리지 않게)
 *   2) 툴바의 onclick 함수가 ui-step1.js 에 실제로 존재해야 한다
 *   3) 툴바가 overlay 보다 위에 떠야 한다
 *   4) planner 의 "다음"(PLANNER_DONE) 을 부모가 받아 BOM 으로 넘겨야 한다
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'detaildesign.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css/detaildesign/base.css'), 'utf8');
const uiStep1 = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
const structure = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');

describe('Step 2 툴바 — 화면에서 빠져나갈 수 있어야 한다', () => {
  test('#step2Toolbar 가 존재한다', () => {
    expect(html).toMatch(/id="step2Toolbar"/);
  });

  test('#step2Toolbar 는 body 직속이다 (step2-content 안이면 숨겨진다)', () => {
    document.documentElement.innerHTML = html;
    const toolbar = document.getElementById('step2Toolbar');
    expect(toolbar).not.toBeNull();
    expect(toolbar.parentElement.tagName).toBe('BODY');
  });

  test('숨김 선택자가 툴바를 삼키지 않는다', () => {
    // base.css 의 step2-fullscreen 숨김 규칙 목록
    const hideBlock = css.match(/body\.step2-fullscreen nav[\s\S]*?display:\s*none\s*!important;\s*\}/);
    expect(hideBlock).not.toBeNull();
    expect(hideBlock[0]).not.toMatch(/step2Toolbar/);

    // .design-workspace > * 전체 숨김도 툴바와 무관해야 한다 (툴바가 body 직속이므로)
    expect(css).toMatch(/body\.step2-fullscreen \.design-workspace > \*\s*\{\s*display:\s*none/);
  });

  test('툴바가 planner overlay(z-index:100) 보다 위에 있다', () => {
    const overlayZ = css.match(/\[id\^="__planner-overlay-"\][\s\S]*?z-index:\s*(\d+)/);
    const toolbarZ = css.match(/#step2Toolbar[\s\S]*?z-index:\s*(\d+)/);
    expect(overlayZ).not.toBeNull();
    expect(toolbarZ).not.toBeNull();
    expect(Number(toolbarZ[1])).toBeGreaterThan(Number(overlayZ[1]));
  });

  test('툴바 onclick 함수가 ui-step1.js 에 정의돼 있다', () => {
    document.documentElement.innerHTML = html;
    const toolbar = document.getElementById('step2Toolbar');
    const handlers = [...toolbar.querySelectorAll('[onclick]')].map((b) =>
      b.getAttribute('onclick').replace(/\(.*$/, '').trim()
    );

    expect(handlers.length).toBeGreaterThanOrEqual(2);
    for (const fn of handlers) {
      expect(uiStep1).toMatch(new RegExp(`function\\s+${fn}\\s*\\(`));
    }
  });

  test('BOM 산출 · 입력 수정 버튼이 있다', () => {
    document.documentElement.innerHTML = html;
    const toolbar = document.getElementById('step2Toolbar');
    const onclicks = [...toolbar.querySelectorAll('[onclick]')].map((b) => b.getAttribute('onclick'));
    expect(onclicks.some((o) => o.includes('proceedToBOM'))).toBe(true);
    expect(onclicks.some((o) => o.includes('backToStep1'))).toBe(true);
  });

  test('구 워크스페이스로 되돌아가는 토글은 두지 않는다', () => {
    // W9-2(#308) "기존 layout 완전 숨김", W9-6(#312) "Step 2 mockup HTML 전면 교체",
    // W9-7(#313) "designWorkspace 내부 UI 완전 숨김" 으로 확정된 방향.
    // Step 2 의 정식 UI 는 planner(mockup-shell) iframe 하나뿐이다.
    expect(html).not.toMatch(/toggleStep2View/);
    expect(uiStep1).not.toMatch(/function\s+toggleStep2View/);
  });
});

describe('planner 가 없는 카테고리는 네이티브 모드여야 한다', () => {
  test('붙박이장·냉장고장이 NATIVE_ONLY_CATEGORIES 에 있다', () => {
    // 이 둘은 _renderWorkspaceContentImpl 에서 early return 하여
    // planner overlay 를 만들지 않는다 → fullscreen 이면 백지가 된다
    const m = uiStep1.match(/NATIVE_ONLY_CATEGORIES\s*=\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/wardrobe/);
    expect(m[1]).toMatch(/fridge/);
  });

  test('early return 하는 카테고리와 목록이 일치한다', () => {
    // renderWardrobeWorkspace / renderFridgeWorkspace 직후 return 하는 분기
    const earlyReturns = [...uiStep1.matchAll(/item\.categoryId === '(\w+)'\)\s*\{\s*render\w+Workspace\(item\)/g)].map(
      (x) => x[1]
    );
    expect(earlyReturns.sort()).toEqual(['fridge', 'wardrobe']);
  });
});

describe('planner "다음" 이 BOM 으로 이어져야 한다', () => {
  test('mockup-structure 가 alert 대신 PLANNER_DONE 을 보낸다', () => {
    expect(structure).toMatch(/postMessage\(\s*\{\s*type:\s*'PLANNER_DONE'/);
    expect(structure).not.toMatch(/디테일 단계는 다음 PR/);
  });

  test('부모가 PLANNER_DONE 을 받아 proceedToBOM 을 호출한다', () => {
    expect(uiStep1).toMatch(/type === 'PLANNER_DONE'/);
    const idx = uiStep1.indexOf("type === 'PLANNER_DONE'");
    // 핸들러 안에서 proceedToBOM 을 부르는지 (뒤 300자 내)
    expect(uiStep1.slice(idx, idx + 300)).toMatch(/proceedToBOM\(\)/);
  });

  test('iframe 이 아닌 단독 접속에서는 안내만 한다 (crash 금지)', () => {
    expect(structure).toMatch(/window\.parent && window\.parent !== window/);
  });
});
