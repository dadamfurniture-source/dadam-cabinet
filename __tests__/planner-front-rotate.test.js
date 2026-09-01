/**
 * W12-56: 정면도는 시점을 돌려서 본다 — 라인을 펼치지 않는다.
 *
 * 멍장 라인의 정면이 거울처럼 뒤집혀 있었다. 원인은 하나였다 —
 * `areaFrontRect` 가 모듈의 회전축을 **제 중심**으로 잡았다. 모듈은 속한 영역
 * 중심으로 돌아야 한다(W12-36). 축이 틀리니 회전 라인의 모듈이 제 로컬 x 를
 * 그대로 화면 X 로 흘려, 순서가 뒤집히고 영역 상자 밖으로 나갔다.
 *
 * 축을 바로잡으면 투상이 제대로 선다:
 *
 *   정면 시점  회전 라인은 **모로** 선다 — 모듈이 서로 뒤에 겹친다 (맞는 그림이다)
 *   시점 90/270  그 라인이 정면으로 온다 — 순서가 바로 선다
 *
 * 그래서 라인을 한 줄로 펼칠 필요가 없다. 시점 회전(◀ ▶)이 이미 있고,
 * 그것이 각 라인을 정면으로 보는 방법이다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');

const D = 700;
const LEG = 1970;

/** ㄱ자 — 가로 3600(회전 0) + 세로 1970(회전 90) */
function boot() {
  const layout = {
    version: 1, savedAt: '2026-09-01T00:00:00.000Z', person: null,
    modules: [
      { section: 'lower', x: 0, y: 0, w: 3600, h: D, moduleH: 870, rotation: 0, finishings: [] },
      { section: 'lower', x: D / 2 - LEG / 2, y: LEG / 2 - D / 2,
        w: LEG, h: D, moduleH: 870, rotation: 90, finishings: [] },
    ],
  };
  const p = bootPlanner('mockup-structure.html', {
    search: '?design=d1&item=1',
    storage: { 'dadam_layout_v1::d1:1': JSON.stringify(layout) },
  });
  if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
  p.g('autoCalcAllAreas')();
  return p;
}

const areaOf = (p, rot) => (p.g('areas') || []).find((a) => (a.rotation || 0) === rot);
const modsOf = (p, a) => (p.g('modules') || []).filter((m) => m.areaId === a.id && !m.isFinishing);
const rectOf = (p, o) => p.g('areaFrontRect')(o);

describe('회전 라인은 정면 시점에서 모로 선다', () => {
  test('영역이 제 깊이만큼만 폭을 차지한다', () => {
    const p = boot();
    const rot90 = areaOf(p, 90);
    expect(rectOf(p, rot90).w).toBe(rot90.D);      // 1970 이 아니라 700
    expect(p.g('faceAt')(rot90)).toBe(90);         // 옆면
  });

  test('그 라인의 모듈도 같은 자리에 선다 — 서로 뒤에 겹친다', () => {
    const p = boot();
    const rot90 = areaOf(p, 90);
    const rs = modsOf(p, rot90).map((m) => rectOf(p, m));
    expect(rs.length).toBeGreaterThan(1);
    // 전부 같은 X 구간 (앞뒤로 겹쳐 선다)
    rs.forEach((r) => expect(Math.round(r.x)).toBe(Math.round(rs[0].x)));
  });

  test('모듈이 영역 상자 안에 들어온다 — 예전엔 밖으로 나갔다', () => {
    const p = boot();
    (p.g('areas') || []).filter((a) => !a.isFinishing).forEach((a) => {
      const A = rectOf(p, a);
      modsOf(p, a).forEach((m) => {
        const R = rectOf(p, m);
        expect(R.x).toBeGreaterThanOrEqual(A.x - 1);
        expect(R.x + R.w).toBeLessThanOrEqual(A.x + A.w + 1);
      });
    });
  });

  test('정면을 보는 라인은 제 길이를 그대로 쓴다', () => {
    const p = boot();
    const rot0 = areaOf(p, 0);
    expect(rectOf(p, rot0).w).toBe(rot0.W);        // 3600
    expect(p.g('faceAt')(rot0)).toBe(0);           // 정면 — 도어가 보인다
  });
});

describe('시점을 돌리면 그 라인이 정면으로 온다', () => {
  /**
   * 시점을 바꾼다. `p.g('viewRotation')` 은 내보낼 때 찍힌 **값의 사본**이라
   * 돌려도 그대로다 — 몇 번 돌릴지 세어서 부른다.
   */
  function at(p, rot) {
    const steps = (((rot - 0) % 360 + 360) % 360) / 90;
    for (let i = 0; i < steps; i++) p.g('rotateView')(90);
    return p;
  }

  test('좌측 시점에서 회전 라인이 제 길이를 되찾는다 — 다만 뒷면이다', () => {
    const p = at(boot(), 270);
    const rot90 = areaOf(p, 90);
    expect(rectOf(p, rot90).w).toBe(rot90.W);      // 1970 — 모로 선 700 이 아니다
    // 폭을 되찾는 시점이 곧 도어가 보이는 시점은 아니다. rot 90 라인은 여기서
    // **뒷면**(face 180)을 보인다 — 예전 술어(isEdgeOn)가 이걸 "정면" 으로
    // 뭉개고 있었다 (W12-56 에서 드러나 W12-60 에서 술어를 뺐다).
    expect(p.g('faceAt')(rot90)).toBe(180);
    // 이번엔 가로 라인이 모로 선다 — (0 − 270) mod 360 = 90
    expect(p.g('faceAt')(areaOf(p, 0))).toBe(90);
  });

  test('도어가 보이는 시점은 그 라인의 회전값과 같다', () => {
    const p = at(boot(), 90);                      // rot 90 라인의 정면
    const rot90 = areaOf(p, 90);
    expect(p.g('faceAt')(rot90)).toBe(0);
    expect(rectOf(p, rot90).w).toBe(rot90.W);
    // 가로 라인(rot 0)의 정면은 시점 0 이다
    expect(p.g('faceAt')(areaOf(p, 0))).toBe(270);
  });

  test('멍장이 코너 쪽에 온다 — 거울상이 아니다', () => {
    const p = at(boot(), 270);
    const rot90 = areaOf(p, 90);
    const ms = modsOf(p, rot90).map((m) => ({ blind: !!m.blind, r: rectOf(p, m) }))
      .sort((a, b) => a.r.x - b.r.x);
    // 왼쪽부터 [수납][멍장] — 멍장이 코너(오른쪽 끝) 쪽이다
    expect(ms[0].blind).toBe(false);
    expect(ms[ms.length - 1].blind).toBe(true);
  });

  test('멍장 오른쪽에 코너 벽 여유 50 이 남는다', () => {
    const p = at(boot(), 270);
    const rot90 = areaOf(p, 90);
    const A = rectOf(p, rot90);
    const blind = modsOf(p, rot90).find((m) => m.blind);
    const R = rectOf(p, blind);
    expect(Math.round(A.x + A.w - (R.x + R.w))).toBe(50);
  });

  test('한 바퀴 돌면 제자리로 온다', () => {
    const p = boot();
    const before = rectOf(p, areaOf(p, 90));
    for (let i = 0; i < 4; i++) p.g('rotateView')(90);
    const after = rectOf(p, areaOf(p, 90));
    expect(after).toEqual(before);
  });
});

describe('모로 보이는 라인은 그렇다고 알린다', () => {
  test('영역 라벨이 시점을 돌리라고 적는다', () => {
    const p = boot();
    p.g('setActiveArea')(areaOf(p, 90).id);   // 영역 보기여야 영역을 그린다
    p.g('renderFrontView')();
    const labels = [...p.document.querySelectorAll('#contentG text')].map((t) => t.textContent);
    expect(labels.some((t) => /모로 보임/.test(t))).toBe(true);
    // 정면을 보는 라인에는 안 붙는다
    expect(labels.filter((t) => /모로 보임/.test(t)).length).toBe(1);
  });

  test('모로 보이는 영역 사각형에 표시가 붙는다', () => {
    const p = boot();
    p.g('setActiveArea')(areaOf(p, 90).id);
    p.g('renderFrontView')();
    expect(p.document.querySelectorAll('#contentG [data-area-id].edge-on').length).toBe(1);
  });
});

describe('시점 회전 버튼을 영역 보기에서도 쓸 수 있다', () => {
  test('영역을 고르면 회전 버튼이 보인다', () => {
    const p = boot();
    p.g('setActiveArea')(areaOf(p, 90).id);
    expect(p.document.getElementById('viewRotateBar').style.display).toBe('flex');
  });

  test('규칙이 한 곳이다', () => {
    // 예전엔 setViewMode 안에만 있어서, 영역을 고른 채로는 돌릴 수가 없었다.
    expect(SRC).toContain('function syncViewRotateBar');
    const fn = SRC.slice(SRC.indexOf('function setActiveArea'), SRC.indexOf('function setActiveArea') + 1200);
    expect(fn).toContain('syncViewRotateBar()');
  });
});

describe('소스 규약', () => {
  test('모듈은 영역 중심으로 돈다 (W12-36)', () => {
    const fn = SRC.slice(SRC.indexOf('function areaFrontRect'), SRC.indexOf('function renderAreas'));
    expect(fn).toContain('modulePlaneBox(a)');
    expect(fn).toContain('areas.indexOf(a) >= 0 ? planeBoxOf(a)');
  });
});

describe('뒷면과 옆면을 가른다', () => {
  test('뒷면은 정면이 아니다 — 예전엔 옆면만 걸러 뒷면을 정면으로 봤다', () => {
    const p = boot();
    const rot90 = areaOf(p, 90);
    // 시점 270 에서 rot90 라인은 face 180 = 뒷면이다
    for (let i = 0; i < 3; i++) p.g('rotateView')(90);
    // 180 은 옆면(90·270)도 정면(0)도 아니다 — 예전엔 옆면만 걸러 정면으로 취급했다
    expect(p.g('faceAt')(rot90)).toBe(180);
  });

  test('뒷면 라벨은 "뒷면" 이라고 적는다', () => {
    const p = boot();
    const rot90 = areaOf(p, 90);
    p.g('setActiveArea')(rot90.id);
    for (let i = 0; i < 3; i++) p.g('rotateView')(90);
    p.g('renderFrontView')();
    const labels = [...p.document.querySelectorAll('#contentG text')].map((t) => t.textContent);
    expect(labels.some((t) => /뒷면/.test(t))).toBe(true);
    expect(labels.some((t) => /모로 보임/.test(t))).toBe(true);   // 반대편 라인은 옆면
  });

  test('정면일 때만 아무 표시가 없다', () => {
    const p = boot();
    const rot0 = areaOf(p, 0);
    p.g('setActiveArea')(rot0.id);
    p.g('renderFrontView')();
    expect(p.g('faceAt')(rot0)).toBe(0);
    const labels = [...p.document.querySelectorAll('#contentG text')].map((t) => t.textContent);
    const own = labels.find((t) => /3600/.test(t));
    expect(own).toBeDefined();
    expect(own).not.toMatch(/모로 보임|뒷면/);
  });
});

describe('멍은 어느 거울 배치에서도 코너 쪽에 온다', () => {
  /**
   * 세로 라인을 왼쪽/오른쪽 끝에 두면 배치 단계가 각각 rot 270 / rot 90 을 고른다
   * (mockup-shell 의 alignToPerson — 정면 변이 사람과 가까운 회전).
   * 두 경우 모두 멍(먹장 칸)이 코너 벽 여유 50 과 같은 쪽에 와야 한다.
   */
  function lShape(legX, rot) {
    const cx = legX + D / 2, cy = LEG / 2;
    return {
      version: 1, savedAt: '2026-09-01T00:00:00.000Z', person: { cx: 1500, cy: 1500 },
      modules: [
        { section: 'lower', x: 0, y: 0, w: 3600, h: D, moduleH: 870, rotation: 0, finishings: [] },
        { section: 'lower', x: cx - LEG / 2, y: cy - D / 2, w: LEG, h: D, moduleH: 870, rotation: rot, finishings: [] },
      ],
    };
  }
  function check(legX, rot) {
    const p = bootPlanner('mockup-structure.html', {
      search: '?design=d1&item=1',
      storage: { 'dadam_layout_v1::d1:1': JSON.stringify(lShape(legX, rot)) },
    });
    if (p.errors.length) throw new Error(p.errors.map((e) => e.message).join(' | '));
    p.g('autoCalcAllAreas')();
    const own = p.g('cornerPairs')()[0].owner;
    const blind = (p.g('modules') || []).find((m) => m.blind);
    for (let i = 0; i < ((((own.rotation || 0) % 360) + 360) % 360) / 90; i++) p.g('rotateView')(90);
    const A = rectOf(p, own), R = rectOf(p, blind);
    const cornerOnLeft = Math.round(R.x - A.x) === 50;
    // 셀 이름('blank'/'blind')에 기대지 않는다 — 가려진 칸은 "도어가 아닌 칸" 이다.
    //   이름은 바뀔 수 있지만(W12-58) 규칙은 그대로다.
    const types = p.g('structures')[blind.id].areaTypes;
    const blindOnLeft = types.findIndex((t) => t !== 'door') === 0;
    return { cornerOnLeft, blindOnLeft };
  }

  test('세로 라인이 왼쪽 (rot 270)', () => {
    const r = check(0, 270);
    expect(r.blindOnLeft).toBe(r.cornerOnLeft);
    expect(r.cornerOnLeft).toBe(false);      // 코너가 오른쪽
  });

  test('세로 라인이 오른쪽 (rot 90) — 거울', () => {
    const r = check(3600 - D, 90);
    expect(r.blindOnLeft).toBe(r.cornerOnLeft);
    expect(r.cornerOnLeft).toBe(true);       // 코너가 왼쪽
  });
});
