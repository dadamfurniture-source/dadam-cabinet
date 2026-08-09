/**
 * CD-3a: 플래너 저장 스코프 + 구조 단계 편집 되쓰기.
 *
 * 두 결함 모두 **조용히** 틀린다 — 화면에는 아무 문제가 없어 보인다.
 *
 *  1) 저장 키가 전역 단일이라 품목이 2개 이상이면 배치를 서로 덮어썼다.
 *     품목 A 의 배치가 B 에도 보이고, 각각 BOM 을 뽑으면 **자재가 2배**로 발주된다.
 *  2) 구조 단계의 localStorage 쓰기가 saveStructures() 한 곳뿐이라
 *     눈금자로 고친 W/H 가 메모리에만 남았다. 새로고침하면 원복되고,
 *     H 는 배치 단계에 입력이 없어 복구할 방법이 아예 없었다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'mockup-shell.html'), 'utf8');
const STRUCT = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');

// P1: 스코프 정본이 js/planner/planner-scope.js 로 나가면서, 예전처럼 HTML 을
// 문자열로 잘라 평가하는 방식(loadScope)은 쓸 수 없게 됐다. 잘라내기는 코드가
// 움직이면 조용히 빈 문자열을 검사하게 되므로, 실제로 페이지를 띄워 확인한다.
const { bootPlanner } = require('../test-utils/planner-harness');

/** 페이지를 띄워 스코프 헬퍼를 그대로 꺼낸다 */
function loadScope(file, search, storage) {
  const p = bootPlanner(file, { search, storage });
  if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
  return {
    PLANNER_SCOPE: p.g('PLANNER_SCOPE'),
    scopedKey: p.g('scopedKey'),
    ORIGIN_KEY: p.g('ORIGIN_KEY') || p.g('ORIGIN_STORAGE_KEY'),
    storage: p.storage,
  };
}

describe('저장 스코프 — 품목별 격리', () => {
  test('품목이 다르면 저장 키가 다르다', () => {
    const a = loadScope('mockup-shell.html', '?design=d1&item=100');
    const b = loadScope('mockup-shell.html', '?design=d1&item=200');
    expect(a.scopedKey('dadam_layout_v1')).not.toBe(b.scopedKey('dadam_layout_v1'));
  });

  test('설계가 다르면 저장 키가 다르다', () => {
    const a = loadScope('mockup-shell.html', '?design=d1&item=100');
    const b = loadScope('mockup-shell.html', '?design=d2&item=100');
    expect(a.scopedKey('dadam_layout_v1')).not.toBe(b.scopedKey('dadam_layout_v1'));
  });

  test('같은 품목이면 같은 키 (배치·구조가 이어져야 한다)', () => {
    const a = loadScope('mockup-shell.html', '?design=d1&item=100');
    const b = loadScope('mockup-structure.html', '?design=d1&item=100');
    expect(a.scopedKey('dadam_layout_v1')).toBe(b.scopedKey('dadam_layout_v1'));
  });

  test('배치 단계와 구조 단계가 같은 스코프 규칙을 쓴다', () => {
    for (const s of ['?design=d1&item=1', '?item=9', '?design=x', '']) {
      expect(loadScope('mockup-shell.html', s).PLANNER_SCOPE)
        .toBe(loadScope('mockup-structure.html', s).PLANNER_SCOPE);
    }
  });

  test('파라미터가 없으면 예전 전역 키를 그대로 쓴다 (단독 열람 호환)', () => {
    const s = loadScope('mockup-shell.html', '');
    expect(s.PLANNER_SCOPE).toBe('');
    expect(s.scopedKey('dadam_layout_v1')).toBe('dadam_layout_v1');
  });

  test('구조 단계로 넘어갈 때 쿼리스트링을 잃지 않는다', () => {
    // 잃으면 구조 단계가 전역 키를 읽어 다른 품목의 배치를 연다
    expect(SHELL).toMatch(/location\.href = 'mockup-structure' \+ location\.search/);
  });

  test('원점 키도 스코프를 따른다', () => {
    const s = loadScope('mockup-structure.html', '?design=d1&item=100');
    expect(s.ORIGIN_KEY).toBe('dadam_origin_v1::d1:100');
    expect(STRUCT).not.toMatch(/getItem\('dadam_origin_v1'\)/);
  });

  test('기존 배치를 첫 스코프로 1회만 이관한다', () => {
    // 모든 스코프에 복사하면 중복 산출 문제(자재 2배)가 그대로 재현된다.
    const legacy = { dadam_layout_v1: '{"legacy":true}' };
    const first = loadScope('mockup-shell.html', '?design=d1&item=100', legacy);
    expect(first.storage.getItem('dadam_layout_v1::d1:100')).toBe('{"legacy":true}');
    expect(first.storage.getItem('dadam_scope_migrated_v1')).toBeTruthy();

    // 같은 저장소를 이어받은 다른 스코프로 다시 열어도 두 번째 복사는 없어야 한다
    const carried = first.storage._dump();
    const second = loadScope('mockup-shell.html', '?design=d1&item=200', carried);
    expect(second.storage.getItem('dadam_layout_v1::d1:200')).toBeNull();
  });
});

describe('부모가 스코프를 넘긴다', () => {
  test('품목 iframe URL 에 design·item 이 실린다', () => {
    expect(UI).toMatch(/_plannerScopeParams\(item\)/);
    expect(UI).toMatch(/function _plannerScopeParams/);
  });

  test('부트스트랩 플래너도 자기 스코프를 갖는다', () => {
    const fn = UI.slice(UI.indexOf('function _ensureBootstrapPlanner'), UI.indexOf('function _removeBootstrapPlanner'));
    expect(fn).toMatch(/_plannerScopeParams\(null\)/);
  });

  test('currentDesignId 를 TDZ 안전하게 읽는다', () => {
    // persistence-init.js 는 나중에 로드된다. ui-fridge-el.js 가 최상위에서
    // goToStep2 를 부르므로 그 시점에 참조하면 ReferenceError 가 난다.
    const fn = UI.slice(UI.indexOf('function _plannerScopeParams'), UI.indexOf('const BOOTSTRAP_PLANNER_ID'));
    expect(fn).toMatch(/try\s*\{/);
    expect(fn).toMatch(/catch/);
  });
});

describe('구조 단계 편집 되쓰기', () => {
  test('되쓰기 함수가 있고 배치 키에 쓴다', () => {
    expect(STRUCT).toMatch(/function saveLayoutFromModules/);
    const fn = STRUCT.slice(STRUCT.indexOf('function saveLayoutFromModules'), STRUCT.indexOf('/** 구조 + 배치를 함께 저장'));
    expect(fn).toMatch(/localStorage\.setItem\(LAYOUT_KEY/);
  });

  test('로드 매핑을 정확히 뒤집는다 (W→w, H→moduleH, D→h)', () => {
    const fn = STRUCT.slice(STRUCT.indexOf('function saveLayoutFromModules'), STRUCT.indexOf('/** 구조 + 배치를 함께 저장'));
    expect(fn).toMatch(/w: mod\.W/);
    expect(fn).toMatch(/moduleH: mod\.H/);
    expect(fn).toMatch(/h: mod\.D/);
  });

  test('마감재(ep/molding/filler)는 건드리지 않고 보존한다', () => {
    const fn = STRUCT.slice(STRUCT.indexOf('function saveLayoutFromModules'), STRUCT.indexOf('/** 구조 + 배치를 함께 저장'));
    expect(fn).toMatch(/FINISHING_SECTIONS/);
    expect(fn).toMatch(/next\.push\(entry\)/);
  });

  test('원본 인덱스를 남겨 어느 항목을 갱신할지 안다', () => {
    expect(STRUCT).toMatch(/_srcIndex: srcIndex/);
  });

  test('치수 편집 직후에 저장한다 (새로고침 견딤)', () => {
    const fn = STRUCT.slice(STRUCT.indexOf('function applyDimChange'), STRUCT.indexOf('function absorbAdjacentCell'));
    expect(fn).toMatch(/persistPlannerState\(\)/);
  });

  test('자동계산 후에도 저장한다 (W/x 재배치가 사라지면 안 된다)', () => {
    const fn = STRUCT.slice(STRUCT.indexOf('function autoCalcForSet'), STRUCT.length);
    expect(fn.slice(0, 3000)).toMatch(/persistPlannerState\(\)/);
  });

  test('저장·BOM 요청·다음 버튼이 모두 구조+배치를 함께 저장한다', () => {
    // 예전엔 saveStructures() 만 불러 배치 편집이 날아갔다
    const calls = (STRUCT.match(/persistPlannerState\(\);/g) || []).length;
    expect(calls).toBeGreaterThanOrEqual(5);
  });
});
