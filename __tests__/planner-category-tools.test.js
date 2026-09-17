/**
 * 플래너 품목 선택 계약 테스트.
 *
 * 품목 선택 페이지(Step1)를 없애고 그 역할을 플래너로 옮겼다.
 * 이 배선이 끊기면 **가구를 만들 수단이 아예 사라진다** — 앱이 조용히 못 쓰게 된다.
 * 그래서 양쪽(플래너 송신 / detaildesign 수신)을 모두 고정한다.
 *
 * W12-2: 좌측 툴바 아이콘 10개
 * W12-3: 상단 '기본 정보' 그룹의 드롭다운(#catPicker)
 * 2026-09-18: 배치(mockup-shell) 뿐 아니라 구조·디테일(mockup-structure)에도 같은 드롭다운.
 *   만드는 코드는 js/planner/planner-category-picker.js ｛한 곳｝ 이다.
 *   — 위치가 바뀌어도 **배선과 10종 노출은 그대로**여야 한다는 것이 이 파일의 요지다.
 *
 * 두 mockup 문서는 iframe 안에서 도는 별도 문서라 통째로 실행할 수 없어 마크업만
 * 소스 텍스트로 검사하고, 동작은 공용 모듈을 jsdom 에 직접 붙여 확인한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'mockup-shell.html'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'detaildesign.html'), 'utf8');
const CONSTANTS = fs.readFileSync(path.join(ROOT, 'js/detaildesign/data-constants.js'), 'utf8');
const STRUCTURE = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
const PICKER_SRC = path.join(ROOT, 'js/planner/planner-category-picker.js');
const PICKER = fs.readFileSync(PICKER_SRC, 'utf8');
const { PLANNER_CATEGORY_LIST, plannerCategoryPickerMount } = require(PICKER_SRC);

/** 두 문서의 드롭다운 마크업 — 공용 모듈이 이 id 들을 찾는다. */
const PICKER_MARKUP =
  '<div class="cat-picker" id="catPicker">' +
  '<button type="button" class="cat-picker-btn" id="catPickerBtn" aria-expanded="false">' +
  '<span class="cp-total" id="catPickerTotal" hidden>0</span></button>' +
  '<div class="cat-menu" id="catMenu" hidden></div></div>';

describe('플래너 — 품목 선택 (송신측)', () => {
  test('품목 드롭다운이 상단 기본 정보 그룹 안에 있다', () => {
    expect(SHELL).toMatch(/id="catPicker"/);
    expect(SHELL).toMatch(/id="catPickerBtn"/);
    expect(SHELL).toMatch(/id="catMenu"/);
    // 좌측이 아니라 상단(.topbar > .info-group) 이어야 한다
    expect(SHELL).toMatch(/id="infoGroup"/);
    expect(SHELL.indexOf('id="infoGroup"')).toBeLessThan(SHELL.indexOf('id="leftTools"'));
    expect(SHELL.indexOf('id="catPicker"')).toBeGreaterThan(SHELL.indexOf('id="infoGroup"'));
  });

  test('좌측 툴바에 품목 아이콘이 남아 있지 않다 (W12-3 이동)', () => {
    // 옮기고 원본을 남기면 같은 기능이 두 군데서 돌아 개수가 어긋난다
    expect(SHELL).not.toMatch(/id="catTools"/);
    expect(SHELL).not.toMatch(/class="cat-tools"/);
    // 좌측 툴바 자체와 '배치' 그룹은 그대로 있어야 한다
    expect(SHELL).toMatch(/id="leftTools"/);
    expect(SHELL).toMatch(/data-section="sink"/);
  });

  test('드롭다운이 접히고 펼쳐진다', () => {
    expect(SHELL).toMatch(/aria-expanded/);
    expect(PICKER).toMatch(/function setOpen/);
    // 바깥 클릭 · Esc 로 닫힌다 — 열어둔 채 캔버스를 가리면 안 된다
    expect(PICKER).toMatch(/doc\.addEventListener\('click'[\s\S]{0,120}setOpen\(false\)/);
    expect(PICKER).toMatch(/e\.key === 'Escape'[\s\S]{0,80}setOpen\(false\)/);
  });

  test('data-constants 의 카테고리 10종을 모두 노출한다', () => {
    const ids = [...CONSTANTS.matchAll(/\{ id: '([a-z]+)', name: '[^']+', defaultD/g)].map((m) => m[1]);
    expect(ids.length).toBe(10);
    expect(PLANNER_CATEGORY_LIST.map((c) => c.id).sort()).toEqual(ids.slice().sort());
  });

  test('이름도 data-constants 와 같다 (두 곳이 갈라지면 화면과 BOM 이 다른 말을 한다)', () => {
    const byId = {};
    for (const m of CONSTANTS.matchAll(/\{ id: '([a-z]+)', name: '([^']+)', defaultD/g)) byId[m[1]] = m[2];
    for (const cat of PLANNER_CATEGORY_LIST) expect(cat.name).toBe(byId[cat.id]);
  });

  test('클릭은 ADD_CATEGORY, −버튼·우클릭은 REMOVE_CATEGORY 를 부모로 보낸다', () => {
    expect(PICKER).toMatch(/post\('ADD_CATEGORY', cat\.id\)/);
    expect(PICKER).toMatch(/post\('REMOVE_CATEGORY', cat\.id\)/);
    // 우클릭이 도면 회전(우클릭)으로 번지면 안 된다
    expect(PICKER).toMatch(/contextmenu[\s\S]{0,200}preventDefault\(\)[\s\S]{0,120}stopPropagation\(\)/);
    // 메뉴에서는 −버튼이 주 수단이다 (우클릭은 예전 습관 보존용)
    expect(PICKER).toMatch(/cat-menu-del/);
  });

  test('0개인 품목은 제거 버튼이 비활성이다', () => {
    // 없는 걸 지우려는 클릭이 부모로 새면 조용히 무시돼 사용자가 혼란스럽다
    expect(PICKER).toMatch(/del\.disabled = true/);
    expect(PICKER).toMatch(/del\.disabled = n === 0/);
  });

  test('초기 개수를 받기 위해 PLANNER_READY 를 보내고 CATEGORY_COUNTS 를 듣는다', () => {
    expect(PICKER).toMatch(/postMessage\(\{ type: 'PLANNER_READY' \}/);
    expect(PICKER).toMatch(/e\.data\.type !== 'CATEGORY_COUNTS'/);
  });

  test('품목 아이콘은 배치 그룹 아이콘과 겹치지 않는다', () => {
    // 🚰 분배기 · 💨 후드 · 🧊 냉장고 · 🍽️ 식기세척기 는 '배치' 그룹 것이다.
    // 같은 이모지를 품목에 쓰면 계층이 다른 둘이 같아 보인다.
    const icons = PLANNER_CATEGORY_LIST.map((c) => c.icon);
    for (const placed of ['🚰', '💨', '🧊', '🍽️']) {
      expect(icons).not.toContain(placed);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 2026-09-18: 세 단계 어디서나 품목을 넣고 뺄 수 있어야 한다.
//   개수의 정본은 부모(selectedItems)이고, 각 단계는 ADD/REMOVE 를 보내고
//   CATEGORY_COUNTS 를 받을 뿐이다 — 단계 사이 연동은 여기서 온다.
// ─────────────────────────────────────────────────────────────
describe('플래너 — 품목 드롭다운이 모든 단계에 있다', () => {
  test('구조·디테일 문서에도 같은 마크업이 있다', () => {
    for (const id of ['catPicker', 'catPickerBtn', 'catPickerTotal', 'catMenu']) {
      expect(STRUCTURE).toMatch(new RegExp(`id="${id}"`));
    }
    // 단계 알약과 같은 상단 바 안이어야 한다 — 3D 캔버스 안이면 디테일 모드에서 가려진다
    expect(STRUCTURE.indexOf('id="catPicker"')).toBeGreaterThan(STRUCTURE.indexOf('class="step-pill"'));
    expect(STRUCTURE.indexOf('id="catPicker"')).toBeLessThan(STRUCTURE.indexOf('id="curModuleName"'));
  });

  test('두 문서가 공용 모듈을 싣고 부른다', () => {
    for (const doc of [SHELL, STRUCTURE]) {
      expect(doc).toMatch(/<script src="js\/planner\/planner-category-picker\.js/);
      expect(doc).toMatch(/plannerCategoryPickerMount\(\)/);
    }
  });

  test('메뉴를 만드는 코드가 문서에 복사돼 있지 않다 (정본은 공용 모듈 하나)', () => {
    // 복사본이 남으면 10종 목록이나 배선이 한쪽만 바뀌어 개수가 어긋난다
    for (const doc of [SHELL, STRUCTURE]) {
      expect(doc).not.toMatch(/const CATS = \[/);
      expect(doc).not.toMatch(/post\('ADD_CATEGORY'/);
    }
  });

  test('좁은 창에서 우측 버튼을 밀어내지 않는다', () => {
    // 구조 상단 바는 이미 꽉 차 있다(1176px). 품목 버튼 90px 을 통째로 더하면
    // 1200px 창에서 우측 끝 '💾 도면 저장' 이 밖으로 밀려 사라진다 — 브라우저에서 확인했다.
    // 좁으면 '품목' 글자만 접고, 이름표가 버튼보다 먼저 줄어들게 한다.
    expect(STRUCTURE).toMatch(/<span class="cp-label">품목<\/span>/);
    expect(STRUCTURE).toMatch(/@media \(max-width: 1360px\)\{ \.cat-picker-btn \.cp-label\{display:none\} \}/);
    const nameCss = STRUCTURE.match(/\.module-name\{[^}]*\}/);
    expect(nameCss).not.toBeNull();
    expect(nameCss[0]).toContain('text-overflow:ellipsis');
    expect(nameCss[0]).toContain('min-width:0');
  });

  test('디테일 모드에서 드롭다운을 숨기지 않는다', () => {
    // body.detail-mode 는 구조 전용 버튼을 CSS 로 감춘다 (.pd-only 짝). 품목은 그 대상이 아니다.
    expect(STRUCTURE).not.toMatch(/detail-mode[^{]*\.cat-picker/);
    expect(STRUCTURE).not.toMatch(/class="cat-picker pd-only"/);
  });
});

describe('품목 드롭다운 — 동작 (jsdom)', () => {
  let sent;
  function mount({ standalone = false } = {}) {
    document.body.innerHTML = PICKER_MARKUP;
    sent = [];
    const win = { addEventListener: (t, fn) => window.addEventListener(t, fn) };
    win.parent = standalone ? win : { postMessage: (m) => sent.push(m) };
    return plannerCategoryPickerMount({ doc: document, win });
  }

  test('뜨자마자 PLANNER_READY 로 현재 개수를 묻는다', () => {
    expect(mount().ok).toBe(true);
    expect(sent).toEqual([{ type: 'PLANNER_READY' }]);
  });

  test('10종이 모두 행으로 나온다', () => {
    mount();
    expect(document.querySelectorAll('.cat-menu-row').length).toBe(10);
    for (const cat of PLANNER_CATEGORY_LIST) {
      const btn = document.getElementById(`catBtn-${cat.id}`);
      expect(btn).not.toBeNull();
      expect(btn.textContent).toContain(cat.name);
    }
  });

  test('클릭은 ADD_CATEGORY, −는 REMOVE_CATEGORY 를 부모로 보낸다', () => {
    mount();
    document.getElementById('catBtn-wardrobe').click();
    expect(sent[sent.length - 1]).toEqual({ type: 'ADD_CATEGORY', categoryId: 'wardrobe' });
    const del = document.getElementById('catDel-wardrobe');
    del.disabled = false;
    del.click();
    expect(sent[sent.length - 1]).toEqual({ type: 'REMOVE_CATEGORY', categoryId: 'wardrobe' });
  });

  test('부모가 보낸 개수가 배지·총합·제거 버튼에 반영된다', () => {
    const p = mount();
    p.apply({ sink: 2, wardrobe: 1 });
    expect(document.getElementById('catBadge-sink').textContent).toBe('2');
    expect(document.getElementById('catBadge-sink').hidden).toBe(false);
    expect(document.getElementById('catDel-sink').disabled).toBe(false);
    // 0 인 품목은 배지를 숨기고 제거를 막는다
    expect(document.getElementById('catBadge-storage').hidden).toBe(true);
    expect(document.getElementById('catDel-storage').disabled).toBe(true);
    expect(document.getElementById('catPickerTotal').textContent).toBe('3');
    expect(document.getElementById('catPickerTotal').hidden).toBe(false);
  });

  test('0개가 되면 총합 배지가 사라진다', () => {
    const p = mount();
    p.apply({ sink: 1 });
    p.apply({});
    expect(document.getElementById('catPickerTotal').hidden).toBe(true);
    expect(document.getElementById('catDel-sink').disabled).toBe(true);
  });

  test('두 번 붙여도 행이 늘지 않는다', () => {
    mount();
    const again = plannerCategoryPickerMount({
      doc: document,
      win: { parent: { postMessage: () => {} }, addEventListener: () => {} },
    });
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('already');
    expect(document.querySelectorAll('.cat-menu-row').length).toBe(10);
  });

  test('부모 없이 단독으로 열면 통째로 숨긴다 (품목을 만들 곳이 없다)', () => {
    const r = mount({ standalone: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('standalone');
    expect(document.getElementById('catPicker').style.display).toBe('none');
  });
});

describe('detaildesign — 품목 아이콘 (수신측)', () => {
  test('ADD_CATEGORY / REMOVE_CATEGORY 를 각각 증감 함수로 연결한다', () => {
    expect(UI).toMatch(/'ADD_CATEGORY'[\s\S]{0,200}incrementCategory\(catId\)/);
    expect(UI).toMatch(/'REMOVE_CATEGORY'[\s\S]{0,200}decrementCategory\(catId\)/);
  });

  test('품목 0개여도 플래너가 떠야 아이콘을 쓸 수 있다 (닭-달걀 방지)', () => {
    expect(UI).toMatch(/function _ensureBootstrapPlanner/);
    expect(UI).toMatch(/BOOTSTRAP_PLANNER_ID/);
    // 부트스트랩 iframe 도 배지 broadcast 대상이어야 한다
    const fn = UI.slice(UI.indexOf('function _ensureBootstrapPlanner'), UI.indexOf('function _removeBootstrapPlanner'));
    expect(fn).toMatch(/dataset\.planner/);
  });

  test('품목 수가 바뀌면 배지와 마운트 상태가 함께 갱신된다', () => {
    const fn = UI.slice(UI.indexOf('function updateUI()'), UI.indexOf('function updateItemValue'));
    expect(fn).toMatch(/normalizeItems\(\)/);
    expect(fn).toMatch(/_broadcastCategoryCounts\(\)/);
    expect(fn).toMatch(/_syncStep2Mount\(\)/);
  });

  test('labelName 정규화가 화면과 분리돼 살아 있다', () => {
    // BOM 자재표와 리포트 제목의 유일한 출처다. Step1 DOM 과 함께 사라지면 안 된다.
    const fn = UI.slice(UI.indexOf('function normalizeItems'), UI.indexOf('function updateUI()'));
    expect(fn).toMatch(/item\.labelName = /);
    expect(fn).not.toMatch(/document\.getElementById/);
  });
});

describe('품목 선택 페이지 제거', () => {
  test('Step1 DOM 이 남아 있지 않다', () => {
    for (const id of ['step1-content', 'categoryGrid', 'dynamicInputList', 'detailInputSection', 'btnNext', 'aiGuideText']) {
      expect(HTML).not.toMatch(new RegExp(`id="${id}"`));
    }
  });

  test('제거된 DOM 을 참조하는 코드가 남아 있지 않다', () => {
    // 남아 있으면 로드 즉시 TypeError 로 스크립트 전체가 멈춘다
    const live = [UI, fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-fridge-el.js'), 'utf8')].join('\n');
    const offenders = live
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .filter((l) => /getElementById\('(categoryGrid|dynamicInputList|detailInputSection|btnNext|aiGuideText)'\)/.test(l));
    expect(offenders).toEqual([]);
  });

  test('진입 시 곧바로 설계 화면으로 들어간다', () => {
    const fridge = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-fridge-el.js'), 'utf8');
    expect(fridge).toMatch(/goToStep2\(\)/);
  });
});
