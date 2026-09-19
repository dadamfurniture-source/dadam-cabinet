/**
 * 2026-09-19: 크기를 바꾸면 **이웃이 맞물려 움직인다.**
 *
 * 사장님 지시: "크기 변경된 모듈과 인접한 모듈은 실시간으로 겹치지 않게,
 * 스스로 배치 영역을 벗어나지 않게 줄어들거나 늘어나게" + "가로 높이 깊이 변경시
 * 기준을 좌측, 우측, 중앙으로 설정".
 *
 * 여기서 보는 것:
 *   1) 커진 만큼 그쪽 이웃이 내주고, 줄인 만큼 이웃이 채운다 — 한 줄은 늘 맞닿는다
 *   2) 두 칸 건너 이웃까지 밀려도 틈이 생기지 않는다
 *   3) 기준(좌·우·중앙)이 어느 쪽을 그대로 두는가
 *   4) 보존(isFixed)·마감재는 내주지 않는다 (벽이다)
 *   5) 아무도 배치 사각형 밖으로 나가지 않는다
 *   6) 물리가 설정보다 앞선다 — 바닥에 선 장은 바닥을, 매달린 장은 천장을 놓지 않는다
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

function boot() {
  const storage = Object.assign({}, seedFor(FIXTURES.straight, { modules: false }));
  const p = bootPlanner('mockup-structure.html', { search: '?design=t&item=1', storage });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

/** 폭 목록대로 모듈을 이어 붙인 배치 공간 하나 */
function rowOf(widths, areaW) {
  const p = boot();
  const area = { id: 'area-row', section: 'lower', W: areaW, H: 860, D: 700, x: 0, y: 0, rotation: 0 };
  p.g('areas').push(area);
  let x = 0;
  const ms = widths.map((w) => {
    const m = p.g('addModuleToArea')(area.id, { section: 'lower', W: w, x });
    x += w;
    return m;
  });
  return { p, area, ms };
}

const change = (el, v) => {
  el.value = v;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
};
const dimInput = (p, k) => p.document.querySelector(`#sizeBody input[data-dim="${k}"]`);
function setDim(p, m, k, v) {
  p.g('setActiveModule')(m.id);
  change(dimInput(p, k), String(v));
}
const seats = (p, area) => p.g('modules')
  .filter((m) => m.areaId === area.id)
  .slice().sort((a, b) => (a.x || 0) - (b.x || 0))
  .map((m) => [Math.round(m.x), Math.round(m.x + m.W)]);

/** 한 줄이 [L,R] 안에서 빈틈 없이 맞닿는가 */
function packed(list, L, R) {
  if (!list.length) return false;
  if (list[0][0] !== L || list[list.length - 1][1] !== R) return false;
  return list.every((s, i) => i === 0 || s[0] === list[i - 1][1]);
}

describe('폭 — 이웃이 맞물려 움직인다', () => {
  test('키우면 그쪽 이웃이 내준다 (기준 좌측)', () => {
    const { p, area, ms } = rowOf([900, 900, 600], 2400);
    setDim(p, ms[1], 'W', 1100);
    expect(Math.round(ms[1].W)).toBe(1100);
    expect(Math.round(ms[1].x)).toBe(900);          // 기준 쪽(왼쪽)은 그대로
    expect(Math.round(ms[2].W)).toBe(400);          // 600 − 200
    expect(packed(seats(p, area), 0, 2400)).toBe(true);
  });

  test('기준 쪽이 도어 최소폭에 닿으면 남은 만큼은 반대쪽이 낸다', () => {
    // 이웃은 도어 최소폭(350)까지만 내준다 — 그보다 좁은 조각은 도어를 못 단다.
    const { p, area, ms } = rowOf([900, 900, 600], 2400);
    setDim(p, ms[1], 'W', 1200);                    // 오른쪽은 250 까지만 낼 수 있다
    expect(Math.round(ms[1].W)).toBe(1200);
    expect(Math.round(ms[2].W)).toBe(350);
    expect(Math.round(ms[0].W)).toBe(850);          // 모자란 50 을 왼쪽이 냈다
    expect(Math.round(ms[1].x)).toBe(850);
    expect(packed(seats(p, area), 0, 2400)).toBe(true);
  });

  test('줄이면 그쪽 이웃이 채운다 — 빈 자리를 남기지 않는다', () => {
    const { p, area, ms } = rowOf([900, 900, 600], 2400);
    setDim(p, ms[1], 'W', 700);
    expect(Math.round(ms[1].W)).toBe(700);
    expect(Math.round(ms[2].W)).toBe(800);          // 200 을 채웠다
    expect(packed(seats(p, area), 0, 2400)).toBe(true);
  });

  test('두 칸 건너 이웃까지 밀려도 틈이 없다', () => {
    // 예전 인접 흡수는 먼 이웃만 안쪽으로 당겨, 가까운 이웃과의 사이에 틈이 생겼다.
    const { p, area, ms } = rowOf([900, 900, 600], 2400);
    setDim(p, ms[2], 'W', 2000);                    // 오른쪽 벽에 막혀 왼쪽으로 큰다
    const seat = seats(p, area);
    expect(packed(seat, 0, 2400)).toBe(true);
    expect(Math.round(ms[0].W)).toBe(350);          // 둘 다 도어 최소폭까지 내줬다
    expect(Math.round(ms[1].W)).toBe(350);
    expect(Math.round(ms[2].W)).toBe(1700);         // 600 + 550 + 550
  });

  test('배치 사각형 밖으로는 아무도 나가지 않는다', () => {
    const { p, area, ms } = rowOf([900, 900, 600], 2400);
    setDim(p, ms[0], 'W', 9000);
    expect(p.g('modules').filter((m) => m.areaId === area.id)
      .every((m) => m.x >= -0.5 && m.x + m.W <= 2400.5)).toBe(true);
    expect(packed(seats(p, area), 0, 2400)).toBe(true);
  });

  test('보존한 이웃은 내주지 않는다 — 반대쪽이 낸다', () => {
    const { p, area, ms } = rowOf([900, 900, 600], 2400);
    ms[2].isFixed = true;
    setDim(p, ms[1], 'W', 1200);
    expect(Math.round(ms[2].W)).toBe(600);          // 보존 모듈은 그대로
    expect(Math.round(ms[2].x)).toBe(1800);
    expect(Math.round(ms[0].W)).toBe(600);          // 왼쪽이 300 을 냈다
    expect(packed(seats(p, area), 0, 2400)).toBe(true);
  });

  test('아무도 못 내주면 거기서 멈춘다', () => {
    const { p, ms } = rowOf([900, 900, 600], 2400);
    ms[0].isFixed = true;
    ms[2].isFixed = true;
    setDim(p, ms[1], 'W', 1500);
    expect(Math.round(ms[1].W)).toBe(900);          // 바뀌지 않는다
  });
});

describe('기준 — 어느 쪽을 그대로 둘지', () => {
  test('우측 기준이면 오른쪽 끝이 제자리다', () => {
    const { p, area, ms } = rowOf([900, 900, 600], 2400);
    p.g('resizeAnchor').W = 'end';
    setDim(p, ms[1], 'W', 1200);
    expect(Math.round(ms[1].x + ms[1].W)).toBe(1800);   // 오른쪽 끝 그대로
    expect(Math.round(ms[0].W)).toBe(600);             // 왼쪽 이웃이 낸다
    expect(packed(seats(p, area), 0, 2400)).toBe(true);
  });

  test('중앙 기준이면 중심이 제자리다', () => {
    const { p, area, ms } = rowOf([900, 900, 600], 2400);
    p.g('resizeAnchor').W = 'center';
    const mid = ms[1].x + ms[1].W / 2;
    setDim(p, ms[1], 'W', 1200);
    expect(Math.round(ms[1].x + ms[1].W / 2)).toBe(Math.round(mid));
    expect(packed(seats(p, area), 0, 2400)).toBe(true);
  });

  test('설정은 브라우저에 남는다', () => {
    const p = boot();
    p.document.getElementById('settingsBtn').click();
    p.document.querySelector('#settingsMenu button[data-anchor="W"][data-val="center"]').click();
    expect(p.g('resizeAnchor').W).toBe('center');
    expect(JSON.parse(p.storage.getItem('dadam_planner_anchor_v1')).W).toBe('center');
    // 고른 것이 눌린 채로 보인다
    expect(p.document.querySelector('#settingsMenu button[data-anchor="W"].on')
      .getAttribute('data-val')).toBe('center');
  });

  test('설정에 가로·높이·깊이 세 줄이 있다', () => {
    const p = boot();
    p.document.getElementById('settingsBtn').click();
    const menu = p.document.getElementById('settingsMenu');
    ['W', 'H', 'D'].forEach((k) => {
      expect(menu.querySelectorAll(`button[data-anchor="${k}"]`)).toHaveLength(3);
    });
  });
});

describe('높이 — 위아래 단이 맞물린다', () => {
  /** 키큰장 영역을 자동계산해 세 단을 세운다 */
  function tallRow() {
    const p = boot();
    const area = { id: 'area-tall-row', section: 'tall', W: 600, H: 2300, D: 700, x: 0, y: 0, rotation: 0 };
    p.g('areas').push(area);
    p.g('autoCalcArea')(area.id);
    const tiers = p.g('modules').filter((m) => m.areaId === area.id)
      .slice().sort((a, b) => (a.baseY || 0) - (b.baseY || 0));
    return { p, area, tiers };
  }
  const vSeats = (p, area) => p.g('modules')
    .filter((m) => m.areaId === area.id)
    .slice().sort((a, b) => (a.baseY || 0) - (b.baseY || 0))
    .map((m) => [Math.round(m.baseY || 0), Math.round((m.baseY || 0) + m.H)]);

  test('아래 단을 키우면 위 단이 내준다 — 바닥은 그대로', () => {
    const { p, area, tiers } = tallRow();
    const was = tiers[0].H;
    setDim(p, tiers[0], 'H', was + 200);
    expect(Math.round(tiers[0].H)).toBe(was + 200);
    expect(Math.round(tiers[0].baseY || 0)).toBe(0);      // 바닥에 선 단은 바닥을 놓지 않는다
    expect(packed(vSeats(p, area), 0, 2300)).toBe(true);
  });

  test('위 기준이면 가운데 단의 윗면이 제자리다', () => {
    const { p, area, tiers } = tallRow();
    p.g('resizeAnchor').H = 'end';
    const top = (tiers[1].baseY || 0) + tiers[1].H;
    setDim(p, tiers[1], 'H', tiers[1].H + 150);
    expect(Math.round((tiers[1].baseY || 0) + tiers[1].H)).toBe(Math.round(top));
    expect(packed(vSeats(p, area), 0, 2300)).toBe(true);
  });

  test('상부장은 높이를 줄여도 천장에 붙어 있다', () => {
    const p = boot();
    const area = p.g('areas').find((a) => a.section === 'upper');
    const m = p.g('addModuleToArea')(area.id, { section: 'upper', W: 600, x: area.x || 0 });
    const ceiling = (area.baseY || 0) + area.H;
    setDim(p, m, 'H', m.H - 200);
    const base = p.g('baseYOf')(m);
    expect(Math.round(base + m.H)).toBe(Math.round(p.g('ceilingHeight')));
    expect(ceiling).toBeGreaterThan(0);
  });
});

describe('깊이 — 기준이 앉는 자리를 정한다', () => {
  test('앞선·벽쪽·중앙이 모듈을 다르게 앉힌다', () => {
    const { p, ms } = rowOf([900], 2400);
    const area = p.g('areas').find((a) => a.id === 'area-row');
    const R = require('../js/planner/planner-engine').MASTER_RULES;
    const back = area.D - R.CORNER_DRIP - R.DOOR_SEAT_D - ms[0].D;
    p.g('resizeAnchor').D = 'start'; p.g('persistPlannerState')();
    expect(Math.round(ms[0].y)).toBe(Math.round((area.y || 0) + back));
    p.g('resizeAnchor').D = 'end'; p.g('persistPlannerState')();
    expect(Math.round(ms[0].y)).toBe(Math.round(area.y || 0));
    p.g('resizeAnchor').D = 'center'; p.g('persistPlannerState')();
    expect(Math.round(ms[0].y)).toBe(Math.round((area.y || 0) + back / 2));
  });

  test('깊이는 물끊기·도어 자리를 뺀 만큼까지다', () => {
    const { p, ms } = rowOf([900], 2400);
    const area = p.g('areas').find((a) => a.id === 'area-row');
    const R = require('../js/planner/planner-engine').MASTER_RULES;
    setDim(p, ms[0], 'D', area.D);
    expect(Math.round(ms[0].D)).toBe(area.D - R.CORNER_DRIP - R.DOOR_SEAT_D);
  });
});
