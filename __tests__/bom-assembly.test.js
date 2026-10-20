/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, global, describe, test, expect */
/**
 * CAD 베타 PR6 — 조립 명세 `dadam.assembly/1` 몸통 (js/detaildesign/bom-assembly.js).
 *
 * 불변식 (계획 §4-2):
 *   · 행↔부재 — 자리를 받은 행은 부재 수 = qty, 재단 치수 = BOM 행. 못 받은 행은 unplaced 에 이유와 함께
 *   · 결정적 — 같은 입력이면 JSON 이 같다
 *   · frame 은 부호 있는 축 순열
 *   · 모듈 안에서 판재가 파고들지 않는다 (사쿠리 홈 속 뒷판만 예외 — 홈 깊이 D5 미정이라 측판에서 빼지 않았다)
 */
global.dlog = global.dlog || (() => {});
const Asm = require('../js/detaildesign/bom-assembly.js');
const Rules = require('../js/detaildesign/assembly-rules.js');
const { MaterialExtractor } = require('../js/detaildesign/extractors.js');
const engine = require('../js/planner/planner-engine.js');
const { FIXTURES } = require('../test-utils/bom-golden/fixtures.js');
const { findOverlaps, IDENTITY } = require('../test-utils/box-overlap.js');

const NAMES = ['sink15', 'sink18', 'sinkCorner', 'shoerack', 'vanity', 'storage', 'warehouse', 'wardrobe', 'fridge'];

/**
 * 플래너 기본 선반 높이 (중심, 몸통 바닥에서) — 상부장은 planner-engine shelvesEvenInner,
 * 그 밖은 mockup-structure shelvesForCount 의 step = H/(n+1). 플래너 내보내기는 구조의 s.shelves 를 그대로 넘긴다.
 */
function shelfYOf(materials) {
  const out = {};
  const byMk = {};
  materials.forEach((r) => { (byMk[r.moduleKey] = byMk[r.moduleKey] || []).push(r); });
  Object.keys(byMk).forEach((mk) => {
    const rows = byMk[mk];
    const side = rows.find((r) => r.part === '측판');
    const n = rows.filter((r) => r.part === '선반').reduce((s, r) => s + r.qty, 0);
    if (!side || !n) return;
    const H = side.h, T = side.thickness;
    out[mk] = /sakuri/.test(side.note || '')
      ? engine.shelvesEvenInner(H, n, T)
      : Array.from({ length: n }, (_, i) => Math.round((H / (n + 1)) * (i + 1)));
  });
  return out;
}

function specOf(name) {
  const design = { items: [FIXTURES[name]] };
  const materials = new MaterialExtractor().extract(design).materials;
  return { design, materials, spec: Asm.of(design, { materials, shelfY: shelfYOf(materials) }) };
}

const allParts = (spec) => spec.items.flatMap((it) => it.modules.flatMap((m) => m.parts.map((p) => Object.assign({ moduleKey: m.moduleKey }, p))));

describe.each(NAMES)('%s', (name) => {
  const { design, materials, spec } = specOf(name);

  test('머리 — schema · rulesVersion', () => {
    expect(spec.schema).toBe('dadam.assembly/1');
    expect(spec.rulesVersion).toBe(Rules.RULES_VERSION);
    expect(spec.units).toBe('mm');
  });

  test('행↔부재 — 놓은 행은 부재 수 = qty · 재단 치수 = BOM, 못 놓은 행은 unplaced', () => {
    const parts = allParts(spec);
    const placed = new Map();
    parts.forEach((p) => placed.set(p.rowPartId, (placed.get(p.rowPartId) || []).concat([p])));
    const un = new Map(spec.unplaced.map((u) => [u.rowPartId, u]));
    materials.forEach((r) => {
      const ps = placed.get(r.partId);
      if (ps) {
        expect(un.has(r.partId)).toBe(false);
        expect(ps).toHaveLength(r.qty);
        ps.forEach((p, k) => {
          expect(p.id).toBe(`${r.partId}#${k}`);
          expect(p.cut).toEqual({ w: r.w, h: r.h });
          expect(p.t).toBe(r.thickness);
        });
      } else {
        expect(un.get(r.partId)).toMatchObject({ qty: r.qty });
        expect(typeof un.get(r.partId).reason).toBe('string');
      }
    });
    expect(placed.size + un.size).toBe(materials.length);
  });

  test('결정적', () => {
    const again = Asm.of(design, { materials, shelfY: shelfYOf(materials) });
    expect(JSON.stringify(again)).toBe(JSON.stringify(spec));
  });

  test('frame 은 부호 있는 축 순열, box 는 cut 과 같은 부피', () => {
    allParts(spec).forEach((p) => {
      const axes = [p.frame.u, p.frame.v, p.frame.n];
      axes.forEach((a) => expect(a).toMatch(/^[+-][xyz]$/));
      expect(new Set(axes.map((a) => a[1])).size).toBe(3);
      const d = [0, 1, 2].map((i) => p.box.max[i] - p.box.min[i]);
      expect(d[0] * d[1] * d[2]).toBeCloseTo(p.cut.w * p.cut.h * p.t, 6);
    });
  });

  test('모듈 안 판재가 서로 파고들지 않는다 (사쿠리 홈 속 뒷판만 예외)', () => {
    spec.items.forEach((it) => it.modules.forEach((m) => {
      const pieces = m.parts.map((p) => ({ id: p.id, part: p, solids: Asm.solidsOf(p).map((s) => Object.assign({ m: IDENTITY }, s)) }));
      findOverlaps(pieces).forEach(({ a, b, depth }) => {
        const pair = [a.part.part, b.part.part].sort().join('+');
        // 알려진 겹침 (사장님 확인 대기 — D10·D12): 상부장 선반 D−34 는 상수라 18T 몸통에서는
        //   홈 앞 18 + 선반 (D−34) + 처짐방지목 18 = D + 2 — 선반이 처짐방지목에 2mm 파고든다. 15T 면 1mm 남는다.
        if (m.sakuri && m.box.T === 18 && pair === '밴드(처짐방지)+선반') {
          expect(depth).toBeCloseTo(2, 6);
          return;
        }
        // 사쿠리 뒷판은 측판 홈에 한쪽 (안쪽 폭 W−2T 와 뒷판 W−20 의 차) 만큼 든다 — 홈 자리(뒤끝 15~18) 안이어야 한다
        expect(m.sakuri && pair === '뒷판+측판').toBe(true);
        const back = a.part.part === '뒷판' ? a.part : b.part;
        expect(back.box.min[2]).toBeCloseTo(-m.box.D / 2 + Rules.CARCASS.SAKURI_FROM_BACK, 6);
        expect(back.box.max[2]).toBeCloseTo(-m.box.D / 2 + Rules.CARCASS.SAKURI_FROM_BACK + Rules.CARCASS.SAKURI_W, 6);
      });
    }));
  });
});

describe('sink15 자리 (확정 사실)', () => {
  const { spec } = specOf('sink15');
  const mod = (id) => spec.items[0].modules.find((m) => m.moduleId === id);
  const part = (m, name, k = 0) => m.parts.filter((p) => p.part === name)[k];

  test('싱크 라인 몸통 모듈이 명세에 들어온다 (가스대·후드는 몸통이 없다)', () => {
    expect(spec.items[0].modules.map((m) => m.moduleId).sort()).toEqual(['l1', 'l2', 'l3', 'l4', 'l5', 'u1', 'u2', 'u4']);
  });

  test('하부장 — 뒷판은 측판 뒤끝 밖에 덮고, 처짐방지목은 앞선 맞춤 가운데, 선반은 그 뒤', () => {
    const m = mod('l3');
    expect(m.box).toEqual({ W: 900, H: 708, D: 550, T: 15 });
    expect(m.sakuri).toBe(false);
    const back = part(m, '뒷판');
    expect(back.box.max[2]).toBe(-275);
    expect(back.box.min[2]).toBe(-278);
    const brace = part(m, '밴드(처짐방지)');
    expect(brace.box.max[2]).toBe(275);
    expect(brace.box.min[0]).toBe(-35);
    expect(brace.box.max[0]).toBe(35);
    expect(brace.box.min[1]).toBe(15);
    expect(brace.box.max[1]).toBe(15 + 608);
    const shelf = part(m, '선반');
    expect(shelf.box.min[2]).toBe(-275);
    expect(shelf.box.max[2]).toBe(brace.box.min[2]);   // 처짐방지목 바로 뒤
    const left = part(m, '측판', 0), right = part(m, '측판', 1);
    expect(left.box.min[0]).toBe(-450);
    expect(right.box.max[0]).toBe(450);
    // 목찬넬 위 따내기 70 × 40 — 앞 위 모서리
    expect(left.features).toContainEqual(expect.objectContaining({ type: 'notch', src: 'channel-top', u0: 510, u1: 550, v0: 638, v1: 708 }));
  });

  test('상부장 — 천지판 D−18 앞선 맞춤, 뒷판은 홈 속, 측판에 사쿠리 홈', () => {
    const m = mod('u1');
    expect(m.sakuri).toBe(true);
    const top = part(m, '천판'), bottom = part(m, '지판');
    expect(top.box.max[2]).toBe(147.5);
    expect(top.box.min[2]).toBe(-147.5 + 18);
    expect(top.box.max[1]).toBe(720);
    expect(bottom.box.min[1]).toBe(0);
    const back = part(m, '뒷판');
    expect(back.box.min[2]).toBe(-147.5 + 15);
    expect(back.box.max[2]).toBe(-147.5 + 18);
    expect(part(m, '측판').features).toContainEqual(expect.objectContaining({ type: 'groove', u0: 15, u1: 18, depth: null }));
    // 선반 2장 — 아래→위
    const s0 = part(m, '선반', 0), s1 = part(m, '선반', 1);
    expect(s0.id.endsWith('#0')).toBe(true);
    expect(s0.box.min[1]).toBeLessThan(s1.box.min[1]);
  });

  test('미정은 unplaced 에 이유와 함께 — 밴드 자리 · 서랍장 처짐방지목(D2)', () => {
    const reasons = (id) => spec.unplaced.filter((u) => u.rowPartId.indexOf(`0-${id}-`) === 0);
    expect(reasons('l3').filter((u) => u.part === '밴드').map((u) => u.reason)).toEqual(['band-position-pending']);
    expect(reasons('u1').filter((u) => u.part === '밴드(보강목)')).toEqual([]);
    expect(reasons('l2').find((u) => u.part === '밴드(처짐방지)').reason).toBe('pending-owner D2');
    // 중간 따내기는 서랍 레이아웃이 자리를 정한다 (아래 l2 시험) — 더는 pending 이 아니다
    expect(mod('l2').pending).not.toContain('channel-mid-notch');
  });

  // 2026-10-20 사장님: 상부장 보강목 2장 (W − 2T) × 60 — 사쿠리 홈 뒤 장의 맨 뒤, 위 1장은 천판 바로 아래 · 아래 1장은 지판 바로 위
  test('상부장 보강목 — 장의 맨 뒤(홈 뒤), 지판 바로 위 · 천판 바로 아래', () => {
    const m = mod('u1');
    const { W, H, D, T } = m.box;
    const [lo, hi] = m.parts.filter((p) => p.part === '밴드(보강목)');
    expect(lo.id.endsWith('#0')).toBe(true);
    expect(hi.id.endsWith('#1')).toBe(true);
    [lo, hi].forEach((p) => {
      expect(p.box.min[0]).toBe(-W / 2 + T);
      expect(p.box.max[0]).toBe(W / 2 - T);
      expect(p.box.min[2]).toBe(-D / 2);
      expect(p.box.max[2]).toBe(-D / 2 + T);
      expect(p.box.max[2]).toBeLessThanOrEqual(-D / 2 + Rules.CARCASS.SAKURI_FROM_BACK);   // 홈 뒤
    });
    expect(lo.box.min[1]).toBe(T);
    expect(lo.box.max[1]).toBe(T + 60);
    expect(hi.box.max[1]).toBe(H - T);
    expect(hi.box.min[1]).toBe(H - T - 60);
  });

  test('선반 높이를 안 주면 선반은 놓지 않는다 (지어내지 않는다)', () => {
    const design = { items: [FIXTURES.sink15] };
    const bare = Asm.of(design);
    expect(allParts(bare).some((p) => p.part === '선반')).toBe(false);
    expect(bare.unplaced.filter((u) => u.part === '선반').every((u) => u.reason === 'shelf-height-unknown')).toBe(true);
  });

  test('도어 — 측판 앞선에 붙어 밖으로, 좌우 갭 2 · 양문 가운데 4 (플래너 addFrontPanel)', () => {
    const doors = (id) => mod(id).parts.filter((p) => p.part === '도어').map((p) => p.box);
    const D = (id) => mod(id).box.D;
    // 상부장 양문 900 — 윗변 = 몸통 상단, 내림 15
    expect(doors('u1')).toEqual([
      { min: [-448, -15, D('u1') / 2], max: [-2, 720, D('u1') / 2 + 18] },
      { min: [2, -15, D('u1') / 2], max: [448, 720, D('u1') / 2 + 18] },
    ]);
    // 하부장 양문 900 — 밑단 = 몸통 바닥, 윗변 = 장H − 30 (목찬넬 손 넣는 틈)
    expect(doors('l3')).toEqual([
      { min: [-448, 0, 275], max: [-2, 678, 293] },
      { min: [2, 0, 275], max: [448, 678, 293] },
    ]);
    // 외문 400
    expect(doors('l4')).toEqual([{ min: [-198, 0, 275], max: [198, 678, 293] }]);
  });

  test('서랍장 l2 — 도어·서랍 전면·중간 목찬넬·측판 중간 따내기가 서랍 레이아웃 자리에', () => {
    const m = mod('l2');
    const box = (name, k = 0) => part(m, name, k).box;
    // 전면 (위→아래): 도어 434..678 (상단 슬롯 30) · 서랍 230..430 (갭 4) · 서랍 0..200 (중간 슬롯 30)
    expect(box('도어')).toEqual({ min: [-398, 434, 275], max: [398, 678, 293] });
    expect(box('서랍도어', 0)).toEqual({ min: [-398, 230, 275], max: [398, 430, 293] });
    expect(box('서랍도어', 1)).toEqual({ min: [-398, 0, 275], max: [398, 200, 293] });
    // 중간 목찬넬 ㄴ자 — 따낸 자리(90×40) 바닥 160 에 지면판, 그 위 안쪽 끝에 전면판 72 (앞 22 가 손 자리)
    expect(box('목찬넬(중간 지면)')).toEqual({ min: [-400, 160, 235], max: [400, 178, 275] });
    expect(box('목찬넬(중간 전면)')).toEqual({ min: [-400, 178, 235], max: [400, 250, 253] });
    expect(part(m, '측판').features.filter((f) => f.type === 'notch').map((f) => [f.src, f.v0, f.v1])).toEqual([['channel-top', 638, 708], ['channel-mid', 160, 250]]);
    expect(m.pending).toEqual([]);
  });

  // 2026-10-20 사장님 "박스 아래 덮음": 우라는 측판·앞뒷판 밑면에 덮어, 하단보강은 우라 아래 폭 가운데에 앞뒤로 눕힘
  test('서랍 박스 — 측판 양 끝, 앞뒷판 사이, 우라 밑면 덮음, 하단보강 그 아래 가운데', () => {
    const m = mod('l2');
    const of = (name, k) => m.parts.filter((p) => p.part === name && p.tags.box === k).map((p) => p.box);
    // 위 서랍 (중 박스 120): 존 바닥 + 언더레일 30 → 박스 바닥 280, 앞면 = 몸통 앞선 275, 측판 길이 490
    expect(of('서랍측판', 0)).toEqual([
      { min: [-379, 280, -215], max: [-364, 400, 275] },
      { min: [364, 280, -215], max: [379, 400, 275] },
    ]);
    expect(of('서랍전후판', 0)).toEqual([
      { min: [-364, 280, 260], max: [364, 400, 275] },
      { min: [-364, 280, -215], max: [364, 400, -200] },
    ]);
    expect(of('서랍밑판', 0)).toEqual([{ min: [-378.5, 277, -214.5], max: [378.5, 280, 274.5] }]);
    expect(of('서랍 하단보강', 0)).toEqual([{ min: [-30, 262, -215], max: [30, 277, 275] }]);
    // 아래 서랍 (소 박스 60)
    expect(of('서랍측판', 1)[0]).toEqual({ min: [-379, 45, -215], max: [-364, 105, 275] });
    expect(spec.unplaced.filter((u) => u.moduleKey === '0-l2' && /^서랍/.test(u.part))).toEqual([]);
  });

  test('사쿠리 서랍 — 우라가 바닥에서 15 위 측판 홈에, 앞뒷판(측판 − 18)은 그 위에', () => {
    const fx = JSON.parse(JSON.stringify(FIXTURES.sink15));
    fx.modules.find((x) => x.id === 'l2').drawer = { sakuri: true };
    const design = { items: [fx] };
    const s = Asm.of(design);
    const m = s.items[0].modules.find((x) => x.moduleId === 'l2');
    const of = (name) => m.parts.filter((p) => p.part === name && p.tags.box === 0);
    const side = of('서랍측판')[0], fb = of('서랍전후판')[0], bottom = of('서랍밑판')[0];
    const y0 = side.box.min[1];
    expect(side.features).toEqual([{ type: 'groove', face: 'inner', u0: 0, u1: side.cut.w, v0: 15, v1: 18, depth: null, src: 'drawer-sakuri' }]);
    expect([bottom.box.min[1] - y0, bottom.box.max[1] - y0]).toEqual([15, 18]);
    expect(bottom.tags.mount).toBe('groove');
    expect(fb.box.min[1] - y0).toBe(18);
    expect(fb.box.max[1]).toBe(side.box.max[1]);
    // 우라는 앞뒷판 + 20 — 양쪽 측판 홈에 10 씩
    expect(side.box.max[0] - bottom.box.min[0]).toBe(10);
    expect(of('서랍 하단보강')[0].box.max[1]).toBe(bottom.box.min[1]);
    const r = require('../js/detaildesign/assembly-check.js').check(s);
    expect(r.issues.filter((x) => x.level === 'error' && x.moduleKey === '0-l2')).toEqual([]);
  });

  test('서랍장 레이아웃을 못 구하면 서랍장 전면은 놓지 않는다 (추출기 없이 지어내지 않는다)', () => {
    const design = { items: [FIXTURES.sink15] };
    const materials = new MaterialExtractor().extract(design).materials;
    const s = Asm.of(design, { materials, MaterialExtractor: function () { return { drawerLayoutOf: () => null }; } });
    const un = s.unplaced.filter((u) => u.moduleKey === '0-l2').map((u) => [u.part, u.reason]);
    expect(un).toEqual(expect.arrayContaining([['도어', 'door-layout-unknown'], ['서랍도어', 'drawer-layout-unknown'], ['목찬넬(중간 전면)', 'drawer-layout-unknown']]));
  });

  test('도어 장수·폭이 플래너 칸 규칙과 다르면 놓지 않는다 (door-layout-unknown)', () => {
    const design = { items: [FIXTURES.sink15] };
    const materials = new MaterialExtractor().extract(design).materials.map((r) => (r.moduleKey === '0-l3' && r.part === '도어' ? Object.assign({}, r, { w: r.w - 1 }) : r));
    const s = Asm.of(design, { materials });
    expect(s.unplaced.find((u) => u.moduleKey === '0-l3' && u.part === '도어')).toMatchObject({ reason: 'door-layout-unknown', qty: 2 });
  });
});

test('sink18 — 몸통 18T 가 자리에도 들어간다', () => {
  const { spec } = specOf('sink18');
  const m = spec.items[0].modules.find((x) => x.moduleId === 'l3');
  expect(m.box.T).toBe(18);
  const right = m.parts.filter((p) => p.part === '측판')[1];
  expect(right.box.min[0]).toBe(m.box.W / 2 - 18);
});

// 2026-10-20 사장님 ("15T 고정"): 보강목은 몸통이 18T 여도 15T 판 — 18T 몸통에서도 홈 뒤 같은 자리
test('sink18 — 보강목은 15T 판, 18T 몸통에서도 홈 뒤 · 지판 위 · 천판 아래', () => {
  const { spec } = specOf('sink18');
  expect(spec.unplaced.filter((u) => u.part === '밴드(보강목)')).toEqual([]);
  const m = spec.items[0].modules.find((x) => x.moduleId === 'u1');
  const { W, H, D, T } = m.box;
  expect(T).toBe(18);
  const [lo, hi] = m.parts.filter((p) => p.part === '밴드(보강목)');
  [lo, hi].forEach((p) => {
    expect(p.t).toBe(15);
    expect(p.cut.w).toBe(W - 2 * T);
    expect(p.box.min[2]).toBe(-D / 2);
    expect(p.box.max[2]).toBe(-D / 2 + 15);
  });
  expect(lo.box.min[1]).toBe(T);
  expect(hi.box.max[1]).toBe(H - T);
});

test('solidsOf — 관통 따내기를 뺀 부피', () => {
  const p = {
    cut: { w: 550, h: 708 }, t: 15,
    frame: { o: [-450, 0, -275], u: '+z', v: '+y', n: '+x' },
    features: [{ type: 'notch', u0: 510, u1: 550, v0: 638, v1: 708 }],
  };
  const vol = Asm.solidsOf(p).reduce((s, b) => s + (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]), 0);
  expect(vol).toBeCloseTo((550 * 708 - 40 * 70) * 15, 6);
});
