/**
 * CD-6: 학습 데이터 수집 (프론트).
 *
 * 목표는 "자동 모듈 분배 품질" 학습이다. 학습 신호는
 * **자동계산이 낸 값과 사용자가 고친 값의 차이**인데, 지금까지 최종값만
 * 남아 그 신호가 존재하지 않았다. 뒤늦게 붙이면 그 이전 기간은 영영 비므로
 * 분석보다 수집을 먼저 넣는다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
const STRUCT = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
const CONFIRM = fs.readFileSync(path.join(ROOT, 'confirm.html'), 'utf8');

function load() {
  const start = UI.indexOf('const PLANNER_CABINET_SECTIONS');
  const end = UI.indexOf('function _applyPlannerResult');
  // eslint-disable-next-line no-new-func
  return new Function(`${UI.slice(start, end)}; return { _plannerEditDiff, _buildPlannerLearning };`)();
}
const { _plannerEditDiff, _buildPlannerLearning } = load();

/** 자동계산 직후 상태 (플래너가 심는 기준선) */
function baseline(over = {}) {
  return {
    W: 900, H: 870, verticalCount: 2,
    areaWidths: [450, 450], areaTypes: ['door', 'door'], areaIs2D: [false, false],
    shelves: [400], drawerHeight: 200, drawerCount: 1,
    horizontalLayout: 'doorOnly', bottomType: 'drawer',
    ...over,
  };
}

/** 기준선과 같은 현재 구조 */
function structure(over = {}) {
  const b = baseline();
  return {
    verticalCount: b.verticalCount, areaWidths: b.areaWidths.slice(),
    areaTypes: b.areaTypes.slice(), areaIs2D: b.areaIs2D.slice(),
    shelves: b.shelves.slice(), drawerHeight: b.drawerHeight, drawerCount: b.drawerCount,
    horizontalLayout: b.horizontalLayout, bottomType: b.bottomType,
    _autoCalc: baseline(),
    ...over,
  };
}

describe('자동계산 값 ↔ 최종값 차이', () => {
  test('손대지 않았으면 편집 없음', () => {
    const d = _plannerEditDiff({ W: 900, H: 870 }, structure());
    expect(d.edited).toEqual([]);
  });

  test('셀 폭을 고치면 areaWidths 가 잡힌다', () => {
    const d = _plannerEditDiff({ W: 900, H: 870 }, structure({ areaWidths: [500, 400] }));
    expect(d.edited).toContain('areaWidths');
    expect(d.auto.areaWidths).toEqual([450, 450]);
    expect(d.final.areaWidths).toEqual([500, 400]);
  });

  test('높이·서랍 단수 변경도 각각 잡힌다', () => {
    expect(_plannerEditDiff({ W: 900, H: 900 }, structure()).edited).toContain('H');
    expect(_plannerEditDiff({ W: 900, H: 870 }, structure({ drawerCount: 3 })).edited).toContain('drawerCount');
    expect(_plannerEditDiff({ W: 900, H: 870 }, structure({ shelves: [300, 600] })).edited).toContain('shelves');
  });

  test('여러 곳을 고치면 모두 잡힌다', () => {
    const d = _plannerEditDiff({ W: 850, H: 900 }, structure({ drawerCount: 2 }));
    expect(d.edited.sort()).toEqual(['H', 'W', 'drawerCount'].sort());
  });

  test('기준선이 없으면 null — "모름" 과 "안 고침" 을 구분한다', () => {
    // 둘을 섞으면 자동계산이 완벽했던 것처럼 보여 학습이 오염된다
    expect(_plannerEditDiff({ W: 900, H: 870 }, { areaWidths: [900] })).toBeNull();
    expect(_plannerEditDiff({ W: 900, H: 870 }, null)).toBeNull();
  });
});

describe('설계 단위 학습 기록', () => {
  function payload(over = {}) {
    return {
      modules: [
        { id: 'lower-0', section: 'lower', W: 900, H: 870, D: 550, x: 0, y: 0 },
        { id: 'upper-0', section: 'upper', W: 900, H: 780, D: 295, x: 0, y: 1000 },
        { id: 'sink-0', section: 'sink', W: 600, H: 100, D: 500, x: 0, y: 0 },
      ],
      structures: {
        // 사용자가 셀 폭을 고친 모듈
        'lower-0': structure({ areaWidths: [500, 400] }),
        // 자동계산 그대로인 모듈 (상부장은 전체높이 780 이므로 기준선도 780)
        'upper-0': structure({ _autoCalc: baseline({ H: 780 }) }),
      },
      ...over,
    };
  }

  test('캐비닛만 집계한다 (가전 제외)', () => {
    expect(_buildPlannerLearning(payload()).moduleCount).toBe(2);
  });

  test('고친 모듈 수와 어떤 필드를 고쳤는지 집계한다', () => {
    const L = _buildPlannerLearning(payload());
    expect(L.withBaseline).toBe(2);
    expect(L.editedCount).toBe(1);
    expect(L.editedFields).toEqual({ areaWidths: 1 });
  });

  test('모듈별로 자동값과 최종값을 둘 다 남긴다', () => {
    const mod = _buildPlannerLearning(payload()).modules.find((m) => m.id === 'lower-0');
    expect(mod.auto.areaWidths).toEqual([450, 450]);
    expect(mod.final.areaWidths).toEqual([500, 400]);
    expect(mod.edited).toContain('areaWidths');
  });

  test('기준선 없는 모듈은 hasBaseline:false 로 남긴다', () => {
    const p = payload({ structures: {} });
    const L = _buildPlannerLearning(p);
    expect(L.withBaseline).toBe(0);
    expect(L.modules.every((m) => m.hasBaseline === false)).toBe(true);
  });

  test('타임스탬프를 넣지 않는다 (스냅샷 해시 안정성)', () => {
    // 매번 달라지는 값이 섞이면 같은 설계인데도 rev 가 계속 늘어난다
    const json = JSON.stringify(_buildPlannerLearning(payload()));
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('배선', () => {
  test('플래너가 자동계산 직후 기준선을 심는다', () => {
    expect(STRUCT).toMatch(/function snapshotAutoCalc/);
    expect(STRUCT).toMatch(/s\._autoCalc = snapshotAutoCalc\(m, s\)/);
  });

  test('기준선에도 타임스탬프가 없다', () => {
    const fn = STRUCT.slice(STRUCT.indexOf('function snapshotAutoCalc'), STRUCT.indexOf('/** 구조 + 배치를 함께 저장'));
    expect(fn).not.toMatch(/Date\(|toISOString/);
  });

  test('고정 모듈은 기준선을 덮어쓰지 않는다', () => {
    // 자동계산을 건너뛴 모듈에 새 기준선을 심으면 "안 고친 것" 처럼 보인다
    const fn = STRUCT.slice(STRUCT.indexOf('let preserved = 0'), STRUCT.indexOf('if (preserved > 0)'));
    expect(fn.indexOf('preserved++; return;')).toBeLessThan(fn.indexOf('s._autoCalc ='));
  });

  test('결과를 품목에 _learning 으로 붙인다', () => {
    expect(UI).toMatch(/item\._learning = /);
    expect(UI).toMatch(/planner: _buildPlannerLearning\(payload\)/);
  });
});

describe('수정 요청 사유 코드', () => {
  test('고객 화면에 사유 체크박스가 있다', () => {
    expect(CONFIRM).toMatch(/id="reasonList"/);
    for (const c of ['dimension', 'layout', 'color', 'price', 'schedule', 'other']) {
      expect(CONFIRM).toMatch(new RegExp(`value="${c}"`));
    }
  });

  test('사유를 서버로 보낸다', () => {
    expect(CONFIRM).toMatch(/reasons: selectedReasons\(\)/);
    expect(CONFIRM).toMatch(/function selectedReasons/);
  });

  test('처음에는 감춰뒀다가 수정 요청을 누를 때 편다', () => {
    // 확인만 하려는 고객에게 반려 사유부터 들이밀지 않는다
    expect(CONFIRM).toMatch(/id="reasonBlock" hidden/);
    expect(CONFIRM).toMatch(/if \(revealReasons\(\)\)/);
  });

  test('자유 입력 메모는 그대로 남는다', () => {
    // 코드로 안 잡히는 사유가 반드시 나온다 — 메모를 없애면 안 된다
    expect(CONFIRM).toMatch(/id="decisionMemo"/);
    expect(CONFIRM).toMatch(/memo: el\('decisionMemo'\)\.value/);
  });
});
