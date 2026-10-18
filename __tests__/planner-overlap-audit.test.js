/**
 * 겹침 감사 — 배치 공간 안에서도, 공간끼리도 겹치지 않는가.
 *
 * 2026-10-18: 모듈을 지운 자리에 새 모듈을 넣으면 뒤 모듈과 겹치던 일(#791)을 고친 뒤,
 * "다른 영역에서도 겹치는 데가 없는지" 전체를 훑어 본 것을 시험으로 굳힌다.
 *
 * 영역 종류(하부·상부·키큰·냉장고·붙박이·분배기·후드)와 배치 모양(직선·ㄱ자·사선·샘플)에
 * 대해 사람이 할 수 있는 일을 차례로 돌리고, 매 단계마다 세 가지를 본다.
 *
 *   ① 한 배치 공간 안에서 두 모듈이 겹치는가 (세로로 겹치는 것끼리만 — 단이 다르면 남이다)
 *   ② 모듈이 배치 사각형 밖으로 나갔는가 (가로·세로·깊이)
 *   ③ 배치 공간끼리 겹치는가 (crossAreaOverlaps — 평면에서 본다)
 *
 * 감사가 눈뜬장님이 되지 않게, 일부러 겹쳐 놓고 잡히는지부터 본다(자기 시험).
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

function boot(fx) {
  const storage = fx ? Object.assign({}, seedFor(FIXTURES[fx], { modules: false })) : {};
  const search = storage._search || '?design=t&item=1';
  delete storage._search;
  const p = bootPlanner('mockup-structure.html', { search, storage });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

const TOL = 1.5;

function violations(p, label) {
  const out = [];
  const areas = p.g('areas');
  const modules = p.g('modules');
  const areaIdOf = p.g('areaIdOfModule');
  const baseYOf = p.g('baseYOf');
  areas.forEach((a) => {
    if (a.isFinishing) return;
    const mine = modules.filter((m) => areaIdOf(m) === a.id);
    const L = Number(a.x) || 0, R = L + (Number(a.W) || 0);
    const aBase = p.g('getBaseY')(a.section, Number(a.H) || 0);
    const aTop = aBase + (Number(a.H) || 0);
    mine.forEach((m) => {
      const x0 = Number(m.x) || 0, x1 = x0 + (Number(m.W) || 0);
      if (x0 < L - TOL || x1 > R + TOL) {
        out.push(`${label} · ${a.id} · ${m.id} 가로 밖 [${Math.round(x0)},${Math.round(x1)}] ⊄ [${L},${R}]`);
      }
      const b0 = baseYOf(m), b1 = b0 + (Number(m.H) || 0);
      if (b0 < aBase - TOL || b1 > aTop + TOL) {
        out.push(`${label} · ${a.id} · ${m.id} 세로 밖 [${Math.round(b0)},${Math.round(b1)}] ⊄ [${aBase},${aTop}]`);
      }
      const y0 = Number(m.y) || 0, y1 = y0 + (Number(m.D) || 0);
      const ay0 = Number(a.y) || 0, ay1 = ay0 + (Number(a.D) || 0);
      if (y0 < ay0 - TOL || y1 > ay1 + TOL) {
        out.push(`${label} · ${a.id} · ${m.id} 깊이 밖 [${Math.round(y0)},${Math.round(y1)}] ⊄ [${ay0},${ay1}]`);
      }
    });
    for (let i = 0; i < mine.length; i++) {
      for (let j = i + 1; j < mine.length; j++) {
        const A = mine[i], B = mine[j];
        const ax0 = Number(A.x) || 0, ax1 = ax0 + (Number(A.W) || 0);
        const bx0 = Number(B.x) || 0, bx1 = bx0 + (Number(B.W) || 0);
        const ab0 = baseYOf(A), ab1 = ab0 + (Number(A.H) || 0);
        const bb0 = baseYOf(B), bb1 = bb0 + (Number(B.H) || 0);
        const ox = Math.min(ax1, bx1) - Math.max(ax0, bx0);
        const oy = Math.min(ab1, bb1) - Math.max(ab0, bb0);
        if (ox > TOL && oy > TOL) {
          out.push(`${label} · ${a.id} · ${A.id}[${Math.round(ax0)},${Math.round(ax1)}] × ${B.id}[${Math.round(bx0)},${Math.round(bx1)}] 겹침 ${Math.round(ox)}×${Math.round(oy)}`);
        }
      }
    }
  });
  p.g('crossAreaOverlaps')().forEach((h) => out.push(`${label} · 영역간 ${h.a} × ${h.b} ${h.ox}×${h.oy}`));
  return out;
}

function run(fx, opts) {
  const o = opts || {};
  const found = [];
  const p = boot(fx);
  if (o.wardrobe) {
    p.g('areas').push({ id: 'area-wd-x', section: 'wardrobe', W: 3600, H: 2310, D: 620, x: 6000, y: 0, rotation: 0 });
  }
  const areas = p.g('areas').filter((a) => !a.isFinishing).map((a) => a.id);
  let checks = 0;
  const say = (label) => { checks++; found.push(...violations(p, `${fx || 'sample'}/${label}`)); };
  const mine = (id) => p.g('modules').filter((m) => p.g('areaIdOfModule')(m) === id && !m.isFinishing)
    .slice().sort((a, b) => (a.x || 0) - (b.x || 0));

  say('열자마자');
  areas.forEach((id) => { p.g('autoCalcArea')(id); say(`자동계산 ${id}`); });

  // 마감재를 양 끝에 — 벽으로 서야 한다
  areas.forEach((id) => {
    ['ep', 'molding'].forEach((kind) => { try { p.g('addFinishingToArea')(id, kind); } catch (e) {} });
    say(`마감재 ${id}`);
  });

  // 모듈 추가를 자리가 없을 때까지
  areas.forEach((id) => {
    for (let n = 0; n < 6; n++) if (!p.g('addModuleToArea')(id, {})) break;
    say(`추가반복 ${id}`);
  });

  // 가운데를 여럿 지우고 다시 넣는다
  areas.forEach((id) => {
    const list = mine(id);
    if (list.length < 3) return;
    [1, list.length - 2].forEach((i) => {
      const cur = mine(id);
      if (cur[i]) { p.g('setActiveModule')(cur[i].id); p.g('removeActiveModule')(); }
    });
    say(`여럿삭제 ${id}`);
    for (let n = 0; n < 3; n++) if (!p.g('addModuleToArea')(id, {})) break;
    say(`삭제후추가 ${id}`);
  });

  // 일부를 보존으로 묶고 자동계산
  areas.forEach((id) => {
    mine(id).forEach((m, i) => { if (i % 2 === 0) m.isFixed = true; });
    p.g('autoCalcArea')(id);
    say(`보존+자동계산 ${id}`);
  });

  // 기준 3종 × 폭·높이·깊이를 끝까지
  ['start', 'center', 'end'].forEach((anchor) => {
    p.g('resizeAnchor').W = anchor;
    p.g('resizeAnchor').H = anchor;
    areas.forEach((id) => {
      mine(id).forEach((m, i) => {
        const s = p.g('getStructure')(m.id);
        const dim = (k, v) => { p.g('applyModuleDim')(m, s, k, v); p.g('persistPlannerState')(); };
        dim('W', 9000); say(`폭최대 ${anchor} ${id}#${i}`);
        dim('W', 360); say(`폭최소 ${anchor} ${id}#${i}`);
        dim('H', 9000); say(`높이최대 ${anchor} ${id}#${i}`);
        dim('H', 300); say(`높이최소 ${anchor} ${id}#${i}`);
        dim('D', 9000); say(`깊이최대 ${anchor} ${id}#${i}`);
      });
    });
  });
  p.g('resizeAnchor').W = 'start';
  p.g('resizeAnchor').H = 'start';

  ['start', 'center', 'end'].forEach((d) => {
    p.g('resizeAnchor').D = d;
    p.g('persistPlannerState')();
    say(`깊이기준 ${d}`);
  });
  p.g('resizeAnchor').D = 'start';

  p.g('autoCalcAllAreas')();
  say('전체자동계산');
  const all = p.g('modules');
  const stats = { areas: areas.length, modules: all.length,
    finishings: all.filter((m) => m.isFinishing).length, checks };
  return { found, p, stats };
}

describe('겹침 감사', () => {
  test('감사 자체가 겹침을 잡는가 (자기 시험)', () => {
    const p = boot('straight');
    const area = p.g('areas')[0];
    p.g('autoCalcArea')(area.id);
    const list = p.g('modules').filter((m) => p.g('areaIdOfModule')(m) === area.id)
      .slice().sort((a, b) => a.x - b.x);
    list[1].x = list[0].x;                       // 일부러 겹쳐 놓는다
    expect(violations(p, '자기시험')).not.toEqual([]);
  });

  ['straight', 'lShape', 'oblique'].forEach((fx) => {
    test(`${fx}`, () => {
      const { found, stats } = run(fx);
      expect(found).toEqual([]);
      expect(stats.checks).toBeGreaterThan(50);   // 감사가 실제로 돌았는가
      expect(stats.modules).toBeGreaterThan(5);
    });
  });

  test('샘플(배치 없음) + 붙박이장', () => {
    const { found, stats } = run(null, { wardrobe: true });
    expect(found).toEqual([]);
    expect(stats.checks).toBeGreaterThan(50);
    expect(stats.modules).toBeGreaterThan(5);
  });
});
