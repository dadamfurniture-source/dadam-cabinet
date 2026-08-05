/**
 * W12-2: 플래너 품목 아이콘 계약 테스트.
 *
 * 품목 선택 페이지(Step1)를 없애고 그 역할을 플래너 좌측 툴바 아이콘으로 옮겼다.
 * 이 배선이 끊기면 **가구를 만들 수단이 아예 사라진다** — 앱이 조용히 못 쓰게 된다.
 * 그래서 양쪽(플래너 송신 / detaildesign 수신)을 모두 고정한다.
 *
 * mockup-shell.html 은 iframe 안에서 도는 별도 문서라 DOM 없이 실행할 수 없어
 * 소스 텍스트로 검사한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'mockup-shell.html'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'detaildesign.html'), 'utf8');
const CONSTANTS = fs.readFileSync(path.join(ROOT, 'js/detaildesign/data-constants.js'), 'utf8');

describe('플래너 — 품목 아이콘 (송신측)', () => {
  test('품목 툴바 컨테이너가 좌측 툴바 안에 있다', () => {
    expect(SHELL).toMatch(/id="catTools"/);
    expect(SHELL).toMatch(/id="leftTools"/);
    // 품목 그룹이 '배치' 그룹보다 먼저 와야 한다 (품목 → 그 안의 모듈 순서)
    expect(SHELL.indexOf('id="catTools"')).toBeLessThan(SHELL.indexOf('data-section="sink"'));
  });

  test('data-constants 의 카테고리 10종을 모두 노출한다', () => {
    const ids = [...CONSTANTS.matchAll(/\{ id: '([a-z]+)', name: '[^']+', defaultD/g)].map((m) => m[1]);
    expect(ids.length).toBe(10);
    for (const id of ids) {
      expect(SHELL).toMatch(new RegExp(`id: '${id}'`));
    }
  });

  test('클릭은 ADD_CATEGORY, 우클릭은 REMOVE_CATEGORY 를 부모로 보낸다', () => {
    expect(SHELL).toMatch(/post\('ADD_CATEGORY', cat\.id\)/);
    expect(SHELL).toMatch(/post\('REMOVE_CATEGORY', cat\.id\)/);
    // 우클릭이 도면 회전(우클릭)으로 번지면 안 된다
    expect(SHELL).toMatch(/contextmenu[\s\S]{0,200}preventDefault\(\)[\s\S]{0,120}stopPropagation\(\)/);
  });

  test('초기 개수를 받기 위해 PLANNER_READY 를 보내고 CATEGORY_COUNTS 를 듣는다', () => {
    expect(SHELL).toMatch(/postMessage\(\{ type: 'PLANNER_READY' \}/);
    expect(SHELL).toMatch(/e\.data\.type !== 'CATEGORY_COUNTS'/);
  });

  test('품목 아이콘은 배치 그룹 아이콘과 겹치지 않는다', () => {
    // 🚰 분배기 · 💨 후드 · 🧊 냉장고 · 🍽️ 식기세척기 는 '배치' 그룹 것이다.
    // 같은 이모지를 품목에 쓰면 계층이 다른 둘이 같아 보인다.
    const catBlock = SHELL.slice(SHELL.indexOf('const CATS = ['), SHELL.indexOf('const host = document.getElementById'));
    for (const placed of ['🚰', '💨', '🧊', '🍽️']) {
      expect(catBlock).not.toContain(placed);
    }
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
