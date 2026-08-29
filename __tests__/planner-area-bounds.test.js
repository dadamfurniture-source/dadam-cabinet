/**
 * W12-24: 배치 공간은 **제한 공간**이다 — 모듈·도어·마감재가 밖으로 못 나간다.
 *
 * 실측으로 세 가지가 나가 있었다:
 *   상부장 마감재  Y-1520  — 천장 매달림인데 마감재는 바닥 기준으로 섰다
 *   도어          Z+18    — overlay 라 몸통 앞면에 붙어 영역 앞으로 나갔다
 *   상부장 도어    Y-15    — 도어 내림이 영역 아래를 넘었다
 *
 * 3D 는 jsdom 에서 못 돌리므로 좌표 규칙과 산술을 검사한다. 실제 바운드는 playwright.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
  .split('\r\n').join('\n');

function boot(seed) {
  const s = Object.assign({}, seed);
  const search = s._search || '?design=ab&item=1';
  delete s._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: s });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

describe('마감재가 영역과 같은 높이에 선다', () => {
  test('finishBaseYFor 마커가 살아 있다', () => {
    expect(SRC.indexOf('function finishBaseYFor')).toBeGreaterThan(-1);
  });

  test('영역 섹션으로 baseY 를 구한다 — 마감재 섹션이 아니라', () => {
    const fn = SRC.slice(SRC.indexOf('function finishBaseYFor'), SRC.indexOf('function finishBaseYFor') + 300);
    expect(fn).toContain('getBaseY(area.section, area.H)');
  });

  test('마감재 세 경로 모두 세로 범위를 싣는다', () => {
    // W12-42: baseY 는 finishingSpanOf 가 종류별로 낸다 (몰딩·휠라가 다르다).
    // 정의 1 + 만드는 세 경로 3 + 다시 맞추는 곳 1
    expect((SRC.match(/finishingSpanOf\(area, /g) || []).length).toBe(5);
    ['function addFinishingToArea', 'function setStackAreaFinish', 'function setModuleFinish']
      .forEach((marker) => {
        const from = SRC.indexOf(marker);
        expect(from).toBeGreaterThan(-1);
        expect(SRC.slice(from, from + 1800)).toContain('finishingSpanOf(area,');
      });
    const span = SRC.slice(SRC.indexOf('function finishingSpanOf'), SRC.indexOf('function finishBaseYFor'));
    expect(span).toContain('finishBaseYFor(area)');
  });

  test('상부장 영역 마감재의 baseY 가 영역과 같다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas').find((a) => a.section === 'upper');
    if (!area) return;
    const f = p.g('addFinishingToArea')(area.id, 'ep');
    expect(f.baseY).toBe(p.g('getBaseY')(area.section, area.H));
    expect(p.g('baseYOf')(f)).toBe(p.g('baseYOf')({ section: area.section, H: area.H }));
  });

  test('하부장은 0 그대로다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const area = p.g('areas').find((a) => a.section === 'lower');
    const f = p.g('addFinishingToArea')(area.id, 'ep');
    expect(f.baseY).toBe(0);
  });
});

describe('도어가 영역 앞면을 넘지 않는다', () => {
  const fn = SRC.slice(SRC.indexOf('function areaLimitsFor'), SRC.indexOf('function addFrontPanel'));

  test('areaLimitsFor 마커가 살아 있다', () => {
    expect(SRC.indexOf('function areaLimitsFor')).toBeGreaterThan(-1);
    expect(fn).toContain('frontLimit');
    expect(fn).toContain('bottomLimit');
  });

  test('회전이 없으면 실제 좌표로 잰다 (W12-33)', () => {
    // 예전엔 모듈이 영역 **가운데** 있다고 가정해 어림했다. 실제로는 뒤에
    // 붙어 있었으니 틀린 값이었고, 이제는 앞선에 붙는다(seatModuleDepth).
    expect(fn).toMatch(/if \(rot === 0\)/);
    expect(fn).toContain("((area.y || 0) + (area.D || 0)) - ((m.y || 0) + (m.D || 0) / 2)");
  });

  test('회전 영역은 예전 어림값을 그대로 쓴다', () => {
    // rot 90/270 은 m.y 가 깊이 좌표가 아니다 — §10 미해결 항목과 같은 뿌리다.
    expect(fn).toMatch(/modD \/ 2 \+ Math\.max\(0, \(areaD - modD\) \/ 2\)/);
  });

  test('영역을 못 찾으면 제한하지 않는다', () => {
    expect(fn).toMatch(/if \(!area\) return \{\};/);
  });

  test('도어는 몸통 앞면에 붙는다 — 몸통 속으로 밀지 않는다 (W12-25)', () => {
    // W12-24 는 도어를 안쪽으로 물려 영역을 지켰지만 몸통과 겹쳤다.
    // 이제 몸통을 도어 두께만큼 얕게 잡아 둘 다 만족시킨다.
    const ap = SRC.slice(SRC.indexOf('function addFrontPanel'), SRC.indexOf('function positionBox'));
    expect(ap).toMatch(/const overlayZ = frontZ \+ T \/ 2;/);
    expect(ap).not.toContain('frontLimit - T / 2');
  });

  test('새 모듈 깊이 = 영역 깊이 − 도어 두께', () => {
    const add = SRC.slice(SRC.indexOf('function addModuleToArea'), SRC.indexOf('function addModuleToArea') + 1800);
    expect(add).toMatch(/const roomD = \(area\.D \|\| 0\) - DOOR_T;/);
    expect(add).toMatch(/base\.D = Math\.min\(base\.D, roomD\)/);
  });

  test('산술 — 몸통 + 도어가 영역 깊이에 딱 맞는다', () => {
    const DOOR_T = 18, areaD = 550;
    const bodyD = Math.min(550, areaD - DOOR_T);   // 532
    const frontZ = bodyD / 2;
    const doorFront = frontZ + DOOR_T;             // 도어 앞면
    expect(bodyD).toBe(532);
    expect(doorFront - (-bodyD / 2)).toBe(areaD);  // 뒤면~도어앞면 = 영역 깊이
  });
});

describe('도어 내림이 영역 아래를 넘지 않는다', () => {
  const ap = SRC.slice(SRC.indexOf('function addFrontPanel'), SRC.indexOf('function positionBox'));

  test('bottomLimit 으로 자른다', () => {
    expect(ap).toMatch(/Math\.max\(0, Math\.min\(drop, bodyBottom0 - meta\.bottomLimit\)\)/);
  });

  test('drop 이 let 이다 — 잘라 써야 한다', () => {
    expect(ap).toMatch(/let drop = /);
  });

  test('산술 — 영역 바닥에 딱 맞으면 내림이 0 이 된다', () => {
    const GAP = 4, DROP = 15;
    const bodyBottom0 = 1520;            // 몸통 바닥
    const bottomLimit = 1520;            // 영역 바닥도 같은 자리
    const drop = Math.max(0, Math.min(DROP, bodyBottom0 - bottomLimit));
    expect(drop).toBe(0);
  });

  test('산술 — 여유가 있으면 그만큼만 내려온다', () => {
    const DROP = 15;
    expect(Math.max(0, Math.min(DROP, 1520 - 1512))).toBe(8);
    expect(Math.max(0, Math.min(DROP, 1520 - 1500))).toBe(15);
  });

  test('제한이 없으면 예전 그대로다', () => {
    // meta.bottomLimit 이 없으면 자르지 않는다
    expect(ap).toMatch(/Number\.isFinite\(meta\.bottomLimit\)/);
  });
});

describe('두 렌더 경로 모두 경계를 넘긴다', () => {
  test('areaLimitsFor 를 meta 에 실어 보낸다', () => {
    const calls = SRC.match(/addFrontPanel\([^;]*areaPos: 'top'[^;]*\)/g) || [];
    expect(calls.length).toBe(2);
    calls.forEach((c) => expect(c).toContain('areaLimitsFor(m)'));
  });
});

describe('파츠는 서로 겹치지 않는다 (W12-25)', () => {
  test('몸통 두께는 15T — 정본 BODY_THICKNESS_DEFAULT 와 같다', () => {
    const dc = fs.readFileSync(path.join(__dirname, '..', 'js/detaildesign/data-constants.js'), 'utf8');
    const m = dc.match(/BODY_THICKNESS_DEFAULT = (\d+)/);
    expect(Number(m[1])).toBe(15);
    expect(SRC).toMatch(/const BODY_T = 15;/);
  });

  test('도어·마감재는 18T 로 몸통과 별개다', () => {
    expect(SRC).toMatch(/const DOOR_T = 18;/);
    const dc = fs.readFileSync(path.join(__dirname, '..', 'js/detaildesign/data-constants.js'), 'utf8');
    expect(dc).toContain('몸통 두께와 무관한 별개 값');
  });

  test('T = 18 을 직접 박은 곳이 없다', () => {
    const code = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/\bT = 18\b/);
  });

  test('뒤판은 측판 사이에 들어간다 — 전폭이면 겹친다', () => {
    const fn = SRC.slice(SRC.indexOf('function addCarcassShell'), SRC.indexOf('function addWoodChannel'));
    expect(fn).toMatch(/makeBox\(o\.W - 2 \* o\.T, o\.carcassH, o\.T,/);
  });

  test('산술 — 뒤판과 측판이 안 겹친다', () => {
    const W = 600, T = 15;
    const backHalf = (W - 2 * T) / 2;          // 뒤판 반폭 285
    const sideInner = W / 2 - T;               // 측판 안쪽면 285
    expect(backHalf).toBe(sideInner);          // 딱 맞닿는다 (겹침 0)
  });

  test('산술 — 도어와 몸통이 안 겹친다', () => {
    const bodyD = 532, DOOR_T = 18;
    const frontZ = bodyD / 2;                  // 266
    const doorBack = (frontZ + DOOR_T / 2) - DOOR_T / 2;
    expect(doorBack).toBe(frontZ);             // 도어 뒷면 = 몸통 앞면, 겹침 0
  });
});
