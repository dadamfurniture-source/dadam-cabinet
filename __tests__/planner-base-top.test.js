/**
 * W12-38: 받침(다리발 · 좌대) 선택과 상판.
 *
 *  · **받침** — 몸통을 바닥에서 받치는 부재. 다리발이거나 좌대이고 한 모듈에
 *    하나만 선다. 예전엔 섹션이 정해 버려(하부장=다리발, 키큰장/냉장고장=좌대)
 *    사람이 고를 수 없었다.
 *  · **상판** — 배치 공간 단위 부재. 런 전체를 한 장이 덮는다. 모듈 폭에
 *    맞추면 모듈마다 이음매가 생기고 마감재 자리가 빈다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
  .split('\r\n').join('\n');

function boot(seed) {
  const st = Object.assign({}, seed);
  const search = st._search || '?design=bt&item=1';
  delete st._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: st });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

function withModule(section) {
  const seed = seedFor(FIXTURES.straight, { modules: false });
  const search = seed._search;
  const p = boot(seed);
  const area = p.g('areas')[0];
  const m = p.g('addModuleToArea')(area.id, { section: section || 'lower', W: 900, x: area.x || 0 });
  p.g('setActiveModule')(m.id);
  return { p, area, m, s: p.g('getStructure')(m.id), search };
}

const change = (el, v) => {
  el.value = v;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true }));
};
const partKeys = (p) =>
  [...p.document.querySelectorAll('#heightBody input[data-hpart]')].map((n) => n.getAttribute('data-hpart'));

describe('받침은 하나만 선다', () => {
  test('하부장 기본은 다리발', () => {
    const { p, m, s } = withModule();
    expect(p.g('baseKindOf')(m, s)).toBe('legH');
    expect(partKeys(p)).toEqual(['legH', 'topT']);
    expect(p.g('legHOf')(m, s)).toBeGreaterThan(0);
    expect(p.g('pedestalHOf')(m, s)).toBe(0);
  });

  test('키큰장 기본은 좌대', () => {
    const p = boot(seedFor(FIXTURES.lShape, { modules: false }));
    const area = p.g('areas').find((a) => a.section === 'tall') || p.g('areas')[0];
    area.section = 'tall';
    const m = p.g('addModuleToArea')(area.id, { section: 'tall', W: 600, x: area.x || 0 });
    const s = p.g('getStructure')(m.id);
    expect(p.g('baseKindOf')(m, s)).toBe('pedestalH');
    expect(p.g('pedestalHOf')(m, s)).toBeGreaterThan(0);
    expect(p.g('legHOf')(m, s)).toBe(0);
  });

  test('좌대로 바꾸면 다리발은 서지 않는다', () => {
    const { p, m, s } = withModule();
    change(p.document.getElementById('selBaseKind'), 'pedestalH');
    const after = p.g('getStructure')(m.id);
    expect(after.baseKind).toBe('pedestalH');
    expect(p.g('legHOf')(m, after)).toBe(0);
    expect(p.g('pedestalHOf')(m, after)).toBeGreaterThan(0);
    expect(partKeys(p)).toEqual(['pedestalH', 'topT']);
  });

  test('다시 다리발로 돌아온다', () => {
    const { p, m } = withModule();
    change(p.document.getElementById('selBaseKind'), 'pedestalH');
    change(p.document.getElementById('selBaseKind'), 'legH');
    expect(partKeys(p)).toEqual(['legH', 'topT']);
    expect(p.g('legHOf')(m, p.g('getStructure')(m.id))).toBeGreaterThan(0);
  });

  test('높이를 정할 수 있다', () => {
    const { p, m } = withModule();
    change(p.document.querySelector('#heightBody input[data-hpart="legH"]'), '120');
    expect(p.g('getStructure')(m.id).legH).toBe(120);
    change(p.document.getElementById('selBaseKind'), 'pedestalH');
    change(p.document.querySelector('#heightBody input[data-hpart="pedestalH"]'), '90');
    expect(p.g('getStructure')(m.id).pedestalH).toBe(90);
  });

  test('전체 높이는 그대로고 몸통이 흡수한다', () => {
    const { p, m, s } = withModule();
    const H = m.H;
    const before = p.g('bodyHeightOf')(m, s);
    change(p.document.querySelector('#heightBody input[data-hpart="legH"]'), '200');
    const after = p.g('getStructure')(m.id);
    expect(m.H).toBe(H);
    expect(p.g('bodyHeightOf')(m, after)).toBe(before - (200 - 150));
  });

  test('새로고침을 견딘다', () => {
    const { p, m, search } = withModule();
    change(p.document.getElementById('selBaseKind'), 'pedestalH');
    p.g('persistPlannerState')();
    const again = boot(Object.assign(p.storage._dump(), { _search: search }));
    expect(again.g('getStructure')(m.id).baseKind).toBe('pedestalH');
  });

  test('상부장은 받침이 없다 — 매달린다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    const keys = p.g('heightPartsOf')({ section: 'upper', H: 780 }, {}).map((x) => x.key);
    expect(keys).toEqual(['moldingH']);
  });
});

describe('상판은 배치 공간을 꽉 채운다', () => {
  const fn = SRC.slice(SRC.indexOf('function addTopPanel'), SRC.indexOf('function addPedestal'));

  test('폭·깊이를 영역에서 받는다', () => {
    expect(fn).toContain('W = area.W; D = area.D;');
  });

  test('런에 한 장만 그린다', () => {
    // 모듈마다 그리면 겹쳐 쌓인다.
    expect(fn).toContain("const first = modules.find((x) => x.areaId === area.id && !x.isFinishing);");
    expect(fn).toContain('if (first && first.id !== m.id) return;');
  });

  test('영역 중심에 놓는다 — 모듈 로컬 차이만큼 옮긴다', () => {
    expect(fn).toContain("dx = ((area.x || 0) + area.W / 2) - ((m.x || 0) + m.W / 2);");
    expect(fn).toContain("dz = ((area.y || 0) + area.D / 2) - ((m.y || 0) + m.D / 2);");
    expect(fn).toContain('panel.position.set(dx,');
  });

  test('영역을 못 찾으면 모듈 치수로 돌아간다', () => {
    expect(fn).toContain('let W = m.W, D = m.D, dx = 0, dz = 0;');
  });
});

describe('영역 패널이 모듈까지 적는다', () => {
  test('영역 상판을 고치면 그 영역 모듈이 따라온다', () => {
    // 영역에만 적어 두면 값이 정면도·3D·BOM 에 안 닿는다.
    const { p, area, m } = withModule();
    p.g('setActiveArea')(area.id);
    change(p.document.querySelector('#heightBody input[data-apart="topT"]'), '30');
    expect(p.g('areas').find((x) => x.id === area.id).topT).toBe(30);
    expect(p.g('getStructure')(m.id).topT).toBe(30);
  });

  test('영역 받침을 바꾸면 그 영역 모듈이 따라온다', () => {
    const { p, area, m } = withModule();
    p.g('setActiveArea')(area.id);
    change(p.document.getElementById('selAreaBaseKind'), 'pedestalH');
    expect(p.g('getStructure')(m.id).baseKind).toBe('pedestalH');
    expect(p.g('legHOf')(m, p.g('getStructure')(m.id))).toBe(0);
  });

  test('마감재 모듈은 건드리지 않는다', () => {
    const { p, area } = withModule();
    p.g('setAreaFinish')(area.id, 'left', 'ep');
    p.g('setActiveArea')(area.id);
    change(p.document.querySelector('#heightBody input[data-apart="topT"]'), '25');
    const fin = p.g('modules').find((x) => x.isFinishing);
    expect(p.g('getStructure')(fin.id).topT).toBeUndefined();
  });

  test('배치 저장에 상판·받침이 실린다', () => {
    const { p, area, search } = withModule();
    p.g('setActiveArea')(area.id);
    change(p.document.querySelector('#heightBody input[data-apart="topT"]'), '30');
    change(p.document.getElementById('selAreaBaseKind'), 'pedestalH');
    const again = boot(Object.assign(p.storage._dump(), { _search: search }));
    const back = again.g('areas').find((x) => x.id === area.id);
    expect(back.topT).toBe(30);
    expect(back.baseKind).toBe('pedestalH');
  });
});

describe('소스 규약', () => {
  test('받침 목록이 한 곳이다', () => {
    expect(SRC).toContain("const BASE_KINDS = [['legH', '다리발'], ['pedestalH', '좌대']];");
  });

  test('섹션 기본값은 예전 그대로다 — 안 고르면 안 바뀐다', () => {
    const fn = SRC.slice(SRC.indexOf('function defaultBaseKind'), SRC.indexOf('function baseKindOf'));
    expect(fn).toContain("(sec === 'tall' || sec === 'fridge') ? 'pedestalH' : 'legH'");
  });

  test('다리발은 받침 선택을 따른다', () => {
    const fn = SRC.slice(SRC.indexOf('function legHOf'), SRC.indexOf('function defaultHandleType'));
    expect(fn).toContain("if (baseKindOf(m, s) !== 'legH') return 0;");
  });
});

describe('천판은 몸통 상단에서 끝난다 (W12-40)', () => {
  // 상판이 그 위에 얹히므로 천판이 더 올라가면 둘이 겹친다.
  // 실측: 상판 Y[858,870] · 천판 Y[855,870] → 12mm 겹침.
  const fn = SRC.slice(SRC.indexOf('function addCarcassShell'), SRC.indexOf('function addWoodChannel'));

  test('천판 높이가 몸통 상단이다', () => {
    expect(fn).toContain('top.position.set(0, o.legH + o.carcassH - o.T / 2,');
    // 예전 식이 남아 있으면 안 된다 — 상판 두께만큼 떠오른다.
    expect(fn).not.toContain('o.H - o.moldingH - o.T / 2');
  });

  test('측판과 같은 상단을 쓴다', () => {
    // 측판은 cyMid = legH + carcassH/2 로 legH..legH+carcassH 를 채운다.
    expect(fn).toContain('const cyMid = o.legH + o.carcassH / 2;');
  });

  test('목찬넬 자리 계산과 같은 기준이다', () => {
    // addWoodChannel 은 처음부터 legH + carcassH 를 쓰고 있었다.
    const wc = SRC.slice(SRC.indexOf('function addWoodChannel'), SRC.indexOf('function addWoodChannel') + 900);
    expect(wc).toContain('const topY = o.legH + o.carcassH;');
  });

  test('몸통은 heightPartsOf 합을 뺀 값이다', () => {
    const cm = SRC.slice(SRC.indexOf('const carcassH = bodyHeightOf'), SRC.indexOf('const carcassH = bodyHeightOf') + 120);
    expect(cm).toContain('bodyHeightOf(m, s)');
  });
});

describe('걸레받이 (W12-41)', () => {
  // 치수는 BOM(extractors.js)이 정본이다 — MDF 18T · 폭 = 런 전폭 · 높이 = 다리발 − 5.
  // 앞선에서 40mm 물러선다 (발끝 자리).
  const fn = SRC.slice(SRC.indexOf('function addToeKick'), SRC.indexOf('function addPedestal'));

  test('상수가 BOM 과 같다', () => {
    expect(SRC).toContain('const KICK_T = 18;');
    expect(SRC).toContain('const KICK_SETBACK = 40;');
    expect(SRC).toContain('const KICK_FLOOR_GAP = 5;');
  });

  test('하부장에만 선다', () => {
    expect(fn).toContain("if (m.section !== 'lower') return;");
  });

  test('좌대를 고르면 서지 않는다 — 다리발이 없다', () => {
    expect(fn).toContain('const legPartH = legHOf(m, s);');
    expect(fn).toContain('if (legPartH <= KICK_FLOOR_GAP) return;');
  });

  test('런에 한 장 — 폭은 모듈 구간이다 (W12-43)', () => {
    // 영역 전폭으로 잡으면 바닥까지 내려오는 몰딩·휠라를 관통한다 (실측 18mm).
    // 상판은 마감재 **위**를 지나가므로 영역 전폭 그대로다.
    expect(fn).toContain("const hosts = modules.filter((x) => x.areaId === area.id && !x.isFinishing);");
    expect(fn).toContain('if (hosts.length && hosts[0].id !== m.id) return;');
    expect(fn).toContain('W = x1 - x0;');
    expect(fn).not.toContain('W = area.W;');
    // 상판은 그대로 영역 전폭
    const top = SRC.slice(SRC.indexOf('function addTopPanel'), SRC.indexOf('function frontLineLocal'));
    expect(top).toContain('W = area.W; D = area.D;');
  });

  test('높이는 다리발 − 5 이고 바닥에 안 닿는다', () => {
    expect(fn).toContain('const h = legPartH - KICK_FLOOR_GAP;');
    expect(fn).toContain('KICK_FLOOR_GAP + h / 2');
  });

  test('앞선에서 40 물러선 자리다', () => {
    const zf = SRC.slice(SRC.indexOf('function toeKickBackZ'), SRC.indexOf('function addToeKick'));
    expect(zf).toContain('frontLineLocal(m) - KICK_SETBACK - KICK_T;');
    expect(fn).toContain('toeKickBackZ(m, s) + KICK_T / 2');
  });

  test('앞선은 배치 공간 앞면이다 — 도어 앞면과 같은 평면', () => {
    const fl = SRC.slice(SRC.indexOf('function frontLineLocal'), SRC.indexOf('function toeKickBackZ'));
    expect(fl).toContain("((area.y || 0) + area.D) - ((m.y || 0) + m.D / 2)");
  });

  test('앞줄 다리발이 걸레받이 뒤로 물러난다', () => {
    // 안 물리면 15mm 겹친다 (실측). 실제로도 걸레받이가 이 다리에 클립으로 걸린다.
    const legs = SRC.slice(SRC.indexOf('function addLegs'), SRC.indexOf('function addLegs') + 1600);
    expect(legs).toContain('const kickBack = toeKickBackZ(m, s);');
    expect(legs).toContain('if (kickBack != null) zBack = Math.min(zBack, kickBack - LEG_SIZE/2);');
  });

  test('두 렌더 경로 모두에서 그린다', () => {
    expect((SRC.match(/addToeKick\(/g) || []).length).toBe(3);   // 정의 1 + 호출 2
  });
});
