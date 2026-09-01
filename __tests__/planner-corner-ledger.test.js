/**
 * W12-57: 원장은 **채울 수 없는 자투리**를 위반으로 보지 않는다.
 *
 * 사람이 고정 모듈을 키워 남은 자리가 좁아지면 자동계산이 못 채운다. 그건
 * 정상인데 콘솔이 빨개졌다 — 검사가 시끄러우면 진짜 불일치를 흘려보낸다.
 *
 * 기준이 라인마다 다르다. 멍장 라인은 도어 폭이 라인 전체에 묶여 있어(§3.4)
 * 모듈이 `doorW` 배수로만 들어간다. 일반 라인은 도어 최소폭 350 이 기준이다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');

const LOWER_D = 650;

/** ㄱ자 — 가로 3600(회전 0) + 세로 1970(회전 90) */
function lShapeLayout() {
  const legW = 1970;
  return {
    version: 1, savedAt: '2026-09-01T00:00:00.000Z', person: null,
    modules: [
      { section: 'lower', x: 0, y: 0, w: 3600, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
      { section: 'lower', x: LOWER_D / 2 - legW / 2, y: legW / 2 - LOWER_D / 2,
        w: legW, h: LOWER_D, moduleH: 870, rotation: 90, finishings: [] },
    ],
  };
}

function boot() {
  const p = bootPlanner('mockup-structure.html', {
    search: '?design=d1&item=1',
    storage: { 'dadam_layout_v1::d1:1': JSON.stringify(lShapeLayout()) },
  });
  if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

describe('원장은 채울 수 없는 자투리를 위반으로 보지 않는다', () => {
  /** 수납 하나를 고정하고 폭을 키워 남은 자리를 도어 최소폭 미만으로 만든다 */
  function squeeze(p, ownerId, W) {
    const st = (p.g('modules') || []).filter((m) => m.areaId === ownerId && !m.blind && !m.isFinishing)[0];
    st.isFixed = true;
    st.W = W;
    p.g('autoCalcArea')(ownerId);
    return p.g('cornerLedger')(ownerId);
  }

  test('자투리가 도어 폭보다 좁으면 unfillable 이다', () => {
    // 멍장 라인은 모듈이 doorW 배수로만 들어간다 (§3.4) — 기준이 350 이 아니라 doorW 다.
    const p = boot();
    p.g('autoCalcAllAreas')();
    const owner = p.g('cornerPairs')()[0].owner;
    const doorW = (p.g('modules') || []).find((m) => m.blind).blind.doorW;
    const L = squeeze(p, owner.id, 450);
    expect(L.diff).toBeGreaterThan(0);
    expect(L.diff).toBeLessThan(doorW);
    expect(L.diff).toBeGreaterThan(350);   // 350 만 봤다면 못 걸렀을 값이다
    expect(L.unfillable).toBe(true);
    expect(L.missing).toBe(0);             // 멍장은 그대로 서 있다
  });

  test('그 상태로 전체 자동계산을 돌려도 원장 경고가 안 뜬다', () => {
    const p = boot();
    p.g('autoCalcAllAreas')();
    const owner = p.g('cornerPairs')()[0].owner;
    squeeze(p, owner.id, 450);
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.map(String).join(' '));
    try { p.g('autoCalcAllAreas')(); } finally { console.warn = orig; }
    expect(warns.filter((w) => /원장 불일치/.test(w))).toEqual([]);
  });

  test('멍장이 빠지면 여전히 잡는다 — 완화가 검사를 죽이지 않았다', () => {
    const p = boot();
    p.g('autoCalcAllAreas')();
    const owner = p.g('cornerPairs')()[0].owner;
    const mods = p.g('modules');
    mods.splice(mods.findIndex((m) => m.blind), 1);
    const L = p.g('cornerLedger')(owner.id);
    expect(L.missing).toBe(1);
    expect(L.unfillable).toBe(false);   // 자투리로 눈감아 주지 않는다
  });

  test('정상 자동계산은 자투리가 없다', () => {
    const p = boot();
    p.g('autoCalcAllAreas')();
    (p.g('areas') || []).filter((a) => !a.isFinishing).forEach((a) => {
      const L = p.g('cornerLedger')(a.id);
      if (!L) return;
      expect(L.diff).toBe(0);
      expect(L.unfillable).toBe(false);
    });
  });
});
