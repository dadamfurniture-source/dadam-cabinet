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

    expect(handlers.length).toBeGreaterThanOrEqual(1);
    for (const fn of handlers) {
      expect(uiStep1).toMatch(new RegExp(`function\\s+${fn}\\s*\\(`));
    }
  });

  test('BOM 산출 버튼이 있다', () => {
    document.documentElement.innerHTML = html;
    const toolbar = document.getElementById('step2Toolbar');
    const onclicks = [...toolbar.querySelectorAll('[onclick]')].map((b) => b.getAttribute('onclick'));
    expect(onclicks.some((o) => o.includes('proceedToBOM'))).toBe(true);
  });

  test('W12-2: 품목 선택 페이지로 돌아가는 버튼은 없다', () => {
    // Step1(품목 선택 페이지)이 제거됐으므로 backToStep1 은 갈 곳이 없다.
    // 품목 추가/제거는 플래너 좌측 '품목' 아이콘이 담당한다.
    document.documentElement.innerHTML = html;
    expect(document.getElementById('step1-content')).toBeNull();
    expect(html).not.toMatch(/backToStep1/);
  });

  test('W12-2: 품목이 여러 개일 때 전환할 수단이 툴바에 있다 — 책갈피', () => {
    // 플래너 모드에서는 .bookmark-tabs 가 CSS 로 숨겨진다.
    // 아이콘으로 품목을 여러 개 만들 수 있으므로 전환 수단이 반드시 필요하다.
    // 2026-09-19: 드롭다운(구 #s2ItemSelect)에서 책갈피로 바꿨다 — 열어야 보이던 목록을 편다.
    document.documentElement.innerHTML = html;
    const tabs = document.querySelector('#step2Toolbar #s2ItemTabs');
    expect(tabs).not.toBeNull();
    expect(document.querySelector('#step2Toolbar select')).toBeNull();  // 드롭다운은 돌아오지 않는다
    expect(uiStep1).toMatch(/function\s+_renderStep2ItemTabs\s*\(/);
    expect(uiStep1).toMatch(/function\s+switchStep2Item\s*\(/);
  });

  test('책갈피는 툴바 바닥에 물리고, 고른 것만 밝다 (드롭다운 CSS 는 남지 않는다)', () => {
    // 툴바 높이 44px 을 늘리면 planner overlay 가 그만큼 어긋난다 — 탭은 음수 마진으로 들어간다.
    expect(css).toMatch(/#step2Toolbar \.s2-tabs \{[\s\S]*?margin: -8px 0;/);
    expect(css).toMatch(/#step2Toolbar \.s2-tabs\[hidden\] \{ display: none; \}/);
    expect(css).toMatch(/#step2Toolbar \.s2-tab\[aria-selected='true'\]/);
    expect(css).not.toMatch(/#step2Toolbar select/);
  });

  test('품목이 늘고 줄 때마다 책갈피를 다시 그린다 (updateUI 가 유일한 길목)', () => {
    // 마지막 품목을 지우면 _syncStep2Mount 는 곧바로 돌아가므로, 거기에만 걸면 책갈피가 남는다.
    const body = uiStep1.slice(uiStep1.indexOf('function updateUI('));
    expect(body.slice(0, body.indexOf('function updateItemValue'))).toMatch(/_renderStep2ItemTabs\(\)/);
  });

  test('BOM 버튼은 플래너 상태를 먼저 가져오는 쪽을 부른다', () => {
    // "다음" 을 누르지 않아도 BOM 으로 갈 수 있어야 한다.
    document.documentElement.innerHTML = html;
    const toolbar = document.getElementById('step2Toolbar');
    const bom = [...toolbar.querySelectorAll('[onclick]')].find((b) =>
      b.getAttribute('onclick').includes('proceedToBOM')
    );
    expect(bom.getAttribute('onclick')).toContain('proceedToBOMWithPlanner');
    expect(uiStep1).toMatch(/async function proceedToBOMWithPlanner\s*\(/);
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
  test('냉장고장만 NATIVE_ONLY_CATEGORIES 에 남았다', () => {
    // 2026-09-17: 붙박이장을 뺐다 — 플래너가 통 구조를 담고 자재표까지 이어진다
    //   (wardrobe.md §1.4). 냉장고장은 모듈 type 분기를 플래너가 못 만들어 남는다.
    const m = uiStep1.match(/NATIVE_ONLY_CATEGORIES\s*=\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/fridge/);
    expect(m[1]).not.toMatch(/wardrobe/);
  });

  test('early return 하는 카테고리와 목록이 일치한다', () => {
    // renderFridgeWorkspace 직후 return 하는 분기 — 목록과 한 벌이어야 한다.
    //   어긋나면 fullscreen 인데 오버레이가 없어 화면이 백지가 된다.
    const earlyReturns = [...uiStep1.matchAll(/item\.categoryId === '(\w+)'\)\s*\{\s*render\w+Workspace\(item\)/g)].map(
      (x) => x[1]
    );
    expect(earlyReturns.sort()).toEqual(['fridge']);
  });

  test('붙박이장은 플래너 화면을 탄다 — 전용 화면으로 빠지지 않는다', () => {
    expect(uiStep1).not.toMatch(/item\.categoryId === 'wardrobe'\)\s*\{\s*renderWardrobeWorkspace/);
  });
});

describe('planner "다음" 이 BOM 으로 이어져야 한다', () => {
  test('mockup-structure 가 alert 대신 PLANNER_DONE 을 보낸다', () => {
    expect(structure).toMatch(/sendPlannerState\('PLANNER_DONE'\)/);
    expect(structure).toMatch(/window\.parent\.postMessage\(buildPlannerPayload/);
    expect(structure).not.toMatch(/디테일 단계는 다음 PR/);
  });

  test('부모가 PLANNER_DONE 을 받아 결과 반영 후 proceedToBOM 을 호출한다', () => {
    expect(uiStep1).toMatch(/type === 'PLANNER_DONE'/);
    const idx = uiStep1.indexOf("type === 'PLANNER_DONE'");
    // 핸들러 블록 = 다음 'return;' 까지
    const block = uiStep1.slice(idx, idx + 800);
    expect(block).toMatch(/_applyPlannerResult\(/); // 플래너 결과를 modules 로 반영
    expect(block).toMatch(/proceedToBOM\(\)/); // 그 뒤 BOM 산출
    // 반영이 실패하면 BOM 으로 넘어가지 않아야 한다
    expect(block.indexOf('_applyPlannerResult(')).toBeLessThan(block.indexOf('proceedToBOM()'));
  });

  test('iframe 이 아닌 단독 접속에서는 안내만 한다 (crash 금지)', () => {
    // sendPlannerState 가 부모 없음을 false 로 돌려주고, 호출부가 alert 로 안내한다
    expect(structure).toMatch(/!window\.parent \|\| window\.parent === window/);
    expect(structure).toMatch(/BOM 산출은 상세설계 화면에서 진행합니다/);
  });
});
