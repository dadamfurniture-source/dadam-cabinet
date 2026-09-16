/**
 * 플래너 → 상세설계 브리지 경고 배너 (pbw, 2026-09-16).
 *
 * _convertPlannerModules 의 경고(자동계산 전 통짜 · 멍 구간 미인식 · 350mm 미만 제외 …)는
 * console.warn 과 잠깐 뜨는 토스트로만 나가 사용자가 못 봤다. ui-step1.js 의 pbw 블록이
 * 이를 화면에 남는 배너(#plannerBridgeWarnings)와 BOM 버튼·3번 점 배지로 보여 준다.
 *
 * ui-step1.js 는 전역 스크립트라 import 할 수 없으므로 planner-to-bom.test.js 처럼
 * 소스에서 블록을 잘라 new Function 으로 실제 코드를 평가한다.
 *   - 변환기: `const PLANNER_CABINET_SECTIONS` ~ `function _applyPlannerResult`
 *   - 배너:   `const PBW_ID = ` ~ `function _appendV2Payload(payload)` (블록 머리말 주석에도 같은 이름이 있어 코드 줄만 잡는다)
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../js/detaildesign/ui-step1.js'), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const s = SRC.indexOf(startMarker);
  const e = SRC.indexOf(endMarker, s + 1);
  if (s < 0 || e < 0) throw new Error(`블록을 찾지 못했습니다: ${startMarker} — ui-step1.js 구조가 바뀌었는지 확인하세요.`);
  return SRC.slice(s, e);
}

function loadConverter() {
  const block = sliceBetween('const PLANNER_CABINET_SECTIONS', 'function _applyPlannerResult');
  // eslint-disable-next-line no-new-func
  return new Function(`${block}; return { _convertPlannerModules };`)();
}

/** 배너 블록은 document / sessionStorage 만 쓴다 — 그대로 평가한다 */
function loadBanner() {
  const block = sliceBetween("const PBW_ID = '", 'function _appendV2Payload(payload)');
  // eslint-disable-next-line no-new-func
  return new Function(
    `${block}; return { PBW_ID, _showBridgeWarnings, _pbwSync, _pbwSyncPlacement, _pbwSeverity, _pbwScopeKey, _pbwSignature };`
  )();
}

const convert = loadConverter()._convertPlannerModules;

/** 자동계산을 안 돌린 하부장 하나 — '자동계산 전 … 통짜' 경고 1건 */
const NO_AUTOCALC = {
  modules: [{ id: 'lower-0', section: 'lower', W: 1200, H: 870, D: 650, x: 0, y: 0 }],
  structures: {},
  hasStructures: false,
};

/** 자동계산은 했지만 350mm 미만 잔여(blank) 칸이 남은 하부장 — 안내 1건 */
const WITH_BLANK = {
  modules: [{ id: 'lower-0', section: 'lower', W: 800, H: 870, D: 650, x: 0, y: 0 }],
  structures: {
    'lower-0': { areaTypes: ['door', 'blank'], areaWidths: [600, 200], areaIs2D: [false, false], shelves: [] },
  },
  hasStructures: true,
};

const SCOPE = { design: 'd-1', item: '101' };

/** detaildesign.html 에서 배너가 기대는 최소 골격 (툴바·BOM 버튼·스테퍼 점·Step 2/3 컨테이너) */
function mountDom() {
  document.head.innerHTML = '';
  document.body.innerHTML = `
    <div class="stepper-indicator">
      <div id="step-dot-2" class="step-dot active">2</div>
      <div id="step-dot-3" class="step-dot">3</div>
    </div>
    <div id="step2-content" style="display:block">
      <div class="design-workspace" id="designWorkspace"></div>
    </div>
    <div id="step3-content">
      <div class="s3-head">BOM 산출 결과</div>
      <div id="step3-report-area"></div>
    </div>
    <div id="step2Toolbar">
      <span class="s2-title" id="s2Title">설계</span>
      <button type="button" class="primary" onclick="">📋 BOM 산출 →</button>
    </div>
  `;
  document.body.className = 'step2-fullscreen';
}

const banner = () => document.getElementById('plannerBridgeWarnings');
const lines = () => Array.from(document.querySelectorAll('#plannerBridgeWarnings .pbw-item'));
const badgeOn = (sel) => document.querySelector(`${sel} .pbw-badge`);

let api;
beforeEach(() => {
  sessionStorage.clear();
  mountDom();
  api = loadBanner();
});

describe('배너 표시', () => {
  test('자동계산 전 하부장 payload → 실제 변환 경고가 N줄로 뜬다', () => {
    const { warnings } = convert(NO_AUTOCALC);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes('lower-0: 자동계산 전이라 1200mm 통짜로 잡혔습니다'))).toBe(true);

    api._showBridgeWarnings(warnings, SCOPE);

    const el = banner();
    expect(el).not.toBeNull();
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.querySelector('.pbw-title').textContent).toBe(`플래너 → 상세설계 확인 사항 (${warnings.length})`);
    expect(lines()).toHaveLength(warnings.length);
    expect(lines()[0].querySelector('.pbw-text').textContent).toBe(warnings[0]);
  });

  test('컨테이너는 JS 가 만들고 #step2Toolbar 바로 다음 형제로 붙는다 (detaildesign.html 은 손대지 않는다)', () => {
    api._showBridgeWarnings(convert(NO_AUTOCALC).warnings, SCOPE);
    const el = banner();
    const toolbar = document.getElementById('step2Toolbar');
    expect(el.parentNode).toBe(toolbar.parentNode);
    expect(el.previousSibling).toBe(toolbar);
    expect(el.id).toBe(api.PBW_ID);
  });

  test('스타일은 한 번만 주입되고 전부 .pbw- 접두다', () => {
    api._showBridgeWarnings(['a: 자동계산 전이라 통짜'], SCOPE);
    api._showBridgeWarnings(['a: 자동계산 전이라 통짜', 'b: 자동계산 전이라 통짜'], SCOPE);
    const styles = document.querySelectorAll('style#pbw-style');
    expect(styles).toHaveLength(1);
    const css = styles[0].textContent;
    const classes = css.match(/\.[a-zA-Z][\w-]*/g).filter((c) => !/^\.(step2-fullscreen|step2-native|step-dot)$/.test(c));
    expect(classes.length).toBeGreaterThan(0);
    classes.forEach((c) => expect(c.startsWith('.pbw-')).toBe(true));
    expect(css).toContain('#plannerBridgeWarnings');
  });

  test('다시 확인 힌트 — 경고가 있으면 ⚡ 전체 자동계산 안내', () => {
    api._showBridgeWarnings(convert(NO_AUTOCALC).warnings, SCOPE);
    const hint = banner().querySelector('.pbw-hint').textContent;
    expect(hint).toContain('다시 확인');
    expect(hint).toContain('구조 단계에서 ⚡ 전체 자동계산 후 다시 넘기기');
  });

  test('다시 확인 힌트 — 안내만 있으면 그대로 산출해도 된다고 알린다', () => {
    api._showBridgeWarnings(convert(WITH_BLANK).warnings, SCOPE);
    const hint = banner().querySelector('.pbw-hint').textContent;
    expect(hint).toContain('다시 확인');
    expect(hint).not.toContain('⚡ 전체 자동계산');
    expect(hint).toContain('그대로 산출해도');
  });

  test('경고 문구는 HTML 로 해석되지 않는다', () => {
    api._showBridgeWarnings(['x-0: <b>통짜</b> & 자동계산 전'], SCOPE);
    expect(banner().querySelector('.pbw-text').textContent).toBe('x-0: <b>통짜</b> & 자동계산 전');
    expect(banner().querySelector('.pbw-text b')).toBeNull();
  });
});

describe('심각도', () => {
  test.each([
    ['lower-0: 자동계산 전이라 1200mm 통짜로 잡혔습니다', 'warn'],
    ['lower-1: 멍 구간을 멍장으로 인식하지 못했습니다 — 자동계산을 다시 실행하세요', 'warn'],
    ['lower-2: 멍장 폭 900mm 이 멍 300 + 도어 500 = 800mm 과 다릅니다 — 자동계산을 다시 실행하세요', 'warn'],
    ['lower-3: 셀 폭 합 1000mm 이 모듈 폭 1200mm 과 다릅니다 — 자동계산을 다시 실행하세요', 'warn'],
    ['350mm 미만 잔여 1칸은 캐비닛에서 제외했습니다 (휠라/마감 처리)', 'info'],
    ["도면에 마감재 2개가 있지만 좌·우 마감이 '없음' 으로 설정돼 자재에 반영되지 않습니다 — 스펙에서 몰딩/휠라/EP 를 지정하세요", 'info'],
  ])('%s → %s', (text, sev) => {
    expect(api._pbwSeverity(text)).toBe(sev);
  });

  test('줄마다 심각도 클래스·아이콘·라벨 (경고 ⚠️ / 안내 ℹ️)', () => {
    const warnings = [
      'lower-0: 자동계산 전이라 1200mm 통짜로 잡혔습니다',
      'lower-1: 멍 구간을 멍장으로 인식하지 못했습니다 — 자동계산을 다시 실행하세요',
      '350mm 미만 잔여 2칸은 캐비닛에서 제외했습니다 (휠라/마감 처리)',
    ];
    api._showBridgeWarnings(warnings, SCOPE);
    const li = lines();
    expect(li).toHaveLength(3);
    expect(li[0].classList.contains('pbw-warn')).toBe(true);
    expect(li[1].classList.contains('pbw-warn')).toBe(true);
    expect(li[2].classList.contains('pbw-info')).toBe(true);
    expect(li[0].querySelector('.pbw-sev').textContent).toBe('경고');
    expect(li[2].querySelector('.pbw-sev').textContent).toBe('안내');
    expect(li[0].querySelector('.pbw-icon').textContent).toBe('⚠️');
    expect(li[2].querySelector('.pbw-icon').textContent).toBe('ℹ️');
  });

  test('실제 변환 경고도 같은 규칙 — 자동계산 전 = 경고, 350mm 미만 = 안내', () => {
    api._showBridgeWarnings(convert(NO_AUTOCALC).warnings, SCOPE);
    expect(lines().every((li) => li.classList.contains('pbw-warn'))).toBe(true);
    api._showBridgeWarnings(convert(WITH_BLANK).warnings, SCOPE);
    expect(lines().every((li) => li.classList.contains('pbw-info'))).toBe(true);
  });
});

describe('닫기 (✕) — 설계+품목 단위로 sessionStorage 에 기억', () => {
  test('닫으면 배너가 사라지고 같은 묶음은 다시 그려도 뜨지 않는다', () => {
    const warnings = convert(NO_AUTOCALC).warnings;
    api._showBridgeWarnings(warnings, SCOPE);
    expect(banner()).not.toBeNull();

    banner().querySelector('.pbw-close').click();
    expect(banner()).toBeNull();

    const key = 'pbw:dismissed:' + api._pbwScopeKey(SCOPE);
    expect(sessionStorage.getItem(key)).toBe(api._pbwSignature(warnings));

    // 같은 묶음이 다시 들어와도(재산출 등) 닫힌 채다
    api._showBridgeWarnings(warnings.slice().reverse(), SCOPE);
    expect(banner()).toBeNull();
  });

  test('닫기 기억은 설계+품목별이다 — 다른 품목은 같은 문구라도 뜬다', () => {
    const warnings = convert(NO_AUTOCALC).warnings;
    api._showBridgeWarnings(warnings, SCOPE);
    banner().querySelector('.pbw-close').click();
    expect(banner()).toBeNull();

    api._showBridgeWarnings(warnings, { design: 'd-1', item: '202' });
    expect(banner()).not.toBeNull();
    expect(banner().dataset.scope).toBe('d-1:202');
  });

  test('경고 묶음이 바뀌면 다시 뜬다', () => {
    const first = convert(NO_AUTOCALC).warnings;
    api._showBridgeWarnings(first, SCOPE);
    banner().querySelector('.pbw-close').click();
    expect(banner()).toBeNull();

    const second = first.concat(['350mm 미만 잔여 1칸은 캐비닛에서 제외했습니다 (휠라/마감 처리)']);
    api._showBridgeWarnings(second, SCOPE);
    expect(banner()).not.toBeNull();
    expect(lines()).toHaveLength(second.length);
    expect(banner().querySelector('.pbw-title').textContent).toContain(`(${second.length})`);
  });

  test('sessionStorage 가 막혀 있어도 닫기는 이 화면에서 동작한다', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      api._showBridgeWarnings(convert(NO_AUTOCALC).warnings, SCOPE);
      expect(() => banner().querySelector('.pbw-close').click()).not.toThrow();
      // 기억은 못 하니 다음 렌더에 다시 뜬다 — 예외만 없으면 된다
      expect(banner()).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('0건 · 품목 전환', () => {
  test('경고가 없으면 배너도 배지도 없다', () => {
    const { warnings } = convert({
      modules: [{ id: 'lower-0', section: 'lower', W: 1200, H: 870, D: 650, x: 0, y: 0 }],
      structures: {
        'lower-0': { areaTypes: ['door', 'door'], areaWidths: [600, 600], areaIs2D: [false, false], shelves: [] },
      },
      hasStructures: true,
    });
    expect(warnings).toEqual([]);
    api._showBridgeWarnings(warnings, SCOPE);
    expect(banner()).toBeNull();
    expect(badgeOn('#step2Toolbar button.primary')).toBeNull();
    expect(badgeOn('#step-dot-3')).toBeNull();
  });

  test('경고가 있다가 0건이 되면 배너와 배지가 치워진다', () => {
    api._showBridgeWarnings(convert(NO_AUTOCALC).warnings, SCOPE);
    expect(banner()).not.toBeNull();
    api._showBridgeWarnings([], SCOPE);
    expect(banner()).toBeNull();
    expect(badgeOn('#step2Toolbar button.primary')).toBeNull();
  });

  test('품목을 바꾸면 그 품목의 묶음으로 바뀐다 (없으면 치운다)', () => {
    const a = { design: 'd-1', item: '101' };
    const b = { design: 'd-1', item: '202' };
    api._showBridgeWarnings(convert(NO_AUTOCALC).warnings, a);
    api._showBridgeWarnings(convert(WITH_BLANK).warnings, b);
    expect(banner().dataset.scope).toBe('d-1:202');

    api._pbwSync(a);
    expect(banner().dataset.scope).toBe('d-1:101');
    expect(lines().every((li) => li.classList.contains('pbw-warn'))).toBe(true);

    api._pbwSync({ design: 'd-1', item: '303' });
    expect(banner()).toBeNull();
  });
});

describe('배지 — BOM 산출 버튼 · 스테퍼 3번 점', () => {
  test('건수를 미러하고 툴팁에 문구를 담는다', () => {
    const warnings = [
      'lower-0: 자동계산 전이라 1200mm 통짜로 잡혔습니다',
      '350mm 미만 잔여 1칸은 캐비닛에서 제외했습니다 (휠라/마감 처리)',
    ];
    api._showBridgeWarnings(warnings, SCOPE);
    const onBtn = badgeOn('#step2Toolbar button.primary');
    const onDot = badgeOn('#step-dot-3');
    expect(onBtn.textContent).toBe('2');
    expect(onDot.textContent).toBe('2');
    expect(onBtn.title).toContain('확인 사항 2건');
    expect(onBtn.title).toContain(warnings[0]);
    expect(document.getElementById('step-dot-3').classList.contains('pbw-badge-host')).toBe(true);
  });

  test('배지는 한 개만 유지되고 건수가 갱신된다 · 닫으면 같이 사라진다', () => {
    api._showBridgeWarnings(['a: 자동계산 전이라 통짜'], SCOPE);
    api._showBridgeWarnings(['a: 자동계산 전이라 통짜', 'b: 자동계산 전이라 통짜', 'c: 자동계산 전이라 통짜'], SCOPE);
    expect(document.querySelectorAll('#step2Toolbar .pbw-badge')).toHaveLength(1);
    expect(badgeOn('#step2Toolbar button.primary').textContent).toBe('3');

    banner().querySelector('.pbw-close').click();
    expect(badgeOn('#step2Toolbar button.primary')).toBeNull();
    expect(badgeOn('#step-dot-3')).toBeNull();
  });
});

describe('단계에 따른 자리', () => {
  test('Step 3 가 보이면 보고서(#step3-report-area) 바로 위로 옮기고, Step 2 로 돌아오면 툴바 아래로 돌아온다', () => {
    api._showBridgeWarnings(convert(NO_AUTOCALC).warnings, SCOPE);
    const el = banner();
    const step3 = document.getElementById('step3-content');
    const report = document.getElementById('step3-report-area');

    // proceedToBOM → goToStep3 가 하는 일
    document.getElementById('step2-content').style.display = 'none';
    step3.style.display = 'block';
    document.body.className = '';
    api._pbwSyncPlacement();
    expect(el.parentNode).toBe(step3);
    expect(el.nextSibling).toBe(report);
    expect(el.classList.contains('pbw-in-step3')).toBe(true);
    expect(el.querySelector('.pbw-back')).not.toBeNull();

    // backToStep2
    step3.style.display = 'none';
    document.getElementById('step2-content').style.display = 'block';
    document.body.className = 'step2-fullscreen';
    api._pbwSyncPlacement();
    const toolbar = document.getElementById('step2Toolbar');
    expect(el.previousSibling).toBe(toolbar);
    expect(el.classList.contains('pbw-in-step3')).toBe(false);
  });

  test('Step 3 에서 새로 그려도 보고서 위에 놓인다', () => {
    document.getElementById('step2-content').style.display = 'none';
    document.getElementById('step3-content').style.display = 'block';
    document.body.className = '';
    api._showBridgeWarnings(convert(NO_AUTOCALC).warnings, SCOPE);
    expect(banner().nextSibling).toBe(document.getElementById('step3-report-area'));
  });
});

describe('배선 — _applyPlannerResult · 단계 이동 · 품목 전환', () => {
  test('console.warn 은 그대로 두고 그 다음에 배너를 부른다', () => {
    const apply = sliceBetween('function _applyPlannerResult', 'function _showPlannerSummary');
    const warnIdx = apply.indexOf("console.warn('[Planner→BOM] 경고:'");
    const bannerIdx = apply.indexOf('_showBridgeWarnings(warnings, _plannerScopeParams(item))');
    expect(warnIdx).toBeGreaterThan(-1);
    expect(bannerIdx).toBeGreaterThan(warnIdx);
  });

  test('goToStep2 · goToStep3 · backToStep2 가 자리를 다시 맞추고 switchStep2Item 이 품목별로 다시 그린다', () => {
    expect(sliceBetween('function goToStep2()', 'function goToStep3()')).toContain('_pbwSyncPlacement()');
    expect(sliceBetween('function goToStep3()', 'function backToStep2()')).toContain('_pbwSyncPlacement()');
    expect(sliceBetween('function backToStep2()', 'function proceedToBOM()')).toContain('_pbwSyncPlacement()');
    expect(sliceBetween('function switchStep2Item(', 'let _overlayRAF')).toContain('_pbwSync(_plannerScopeParams(item))');
  });
});
