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
const { MaterialExtractor, HardwareExtractor } = require('../js/detaildesign/extractors.js');
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

  // 2026-10-20 사장님 "뒤 눕힘, 두께는 몸통과 같게": 하부장 밴드 2장 (70 × W−2T, T) 은 천판 대신 상단 앞·뒤에 눕는다.
  //   앞 밴드는 목찬넬 ㄴ자 지면판 바로 아래 (따내기 70 아래, 처짐방지목 윗끝이 닿는다), 뒤 밴드는 윗면 = 몸통 상단, 뒤끝.
  test('하부장 밴드 — 앞은 목찬넬 지면판 아래, 뒤는 상단 뒤끝, 둘 다 눕혀서 측판 사이', () => {
    const m = mod('l3');
    const bands = m.parts.filter((p) => p.part === '밴드');
    expect(bands.map((p) => [p.box, p.t, p.tags.end])).toEqual([
      [{ min: [-435, 708 - 70 - 15, 275 - 70], max: [435, 708 - 70, 275] }, 15, 'front'],
      [{ min: [-435, 708 - 15, -275], max: [435, 708, -275 + 70] }, 15, 'back'],
    ]);
    expect(part(m, '밴드(처짐방지)').box.max[1]).toBe(bands[0].box.min[1]);   // 처짐방지목 윗끝 = 앞 밴드 아랫면
    expect(spec.unplaced.filter((u) => u.part === '밴드')).toEqual([]);
    // 목찬넬이 없는 하부장(화장대 — 찬넬, 18T) — 앞 밴드도 윗면 = 몸통 상단. 목찬넬 신발장 하부장은 싱크처럼 따내기 아래 (2026-10-22 싱크 규칙 통일)
    const va = specOf('vanity').spec.items[0].modules.find((x) => x.moduleId === 'l2');
    expect(va.parts.filter((p) => p.part === '밴드').map((p) => [p.box.min[1], p.box.max[1], p.box.min[2], p.box.max[2]]))
      .toEqual([[690, 708, 180, 250], [690, 708, -250, -180]]);
    const sh = specOf('shoerack').spec.items[0].modules.find((x) => x.moduleId === 'l1');
    expect(sh.parts.filter((p) => p.part === '밴드').map((p) => [p.box.min[1], p.box.max[1], p.box.min[2], p.box.max[2]]))
      .toEqual([[623, 638, 105, 175], [693, 708, -175, -105]]);
  });

  test('미정은 unplaced 에 이유와 함께 — 서랍장 처짐방지목(D2)', () => {
    const reasons = (id) => spec.unplaced.filter((u) => u.rowPartId.indexOf(`0-${id}-`) === 0);
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
    // 아래 서랍 (소 박스 75 — 2026-10-24 소 60 → 75)
    expect(of('서랍측판', 1)[0]).toEqual({ min: [-379, 45, -215], max: [-364, 120, 275] });
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

// 붙박이장 통 — 몸통이 여럿이다. 규칙 파일 layoutWardrobeModule: 외부 서랍 몸통이 맨 아래, 그 위 하부장 · 상부장 (cabinetsOf 0 = 하부장).
describe('wardrobe 자리 — 몸통 쌓기', () => {
  const WR = require('../js/detaildesign/bom-wardrobe-rules.js');
  const { spec } = specOf('wardrobe');
  const mod = (id) => spec.items[0].modules.find((m) => m.moduleId === id);
  const of = (m, rowPartId) => m.parts.filter((p) => p.rowPartId === `${m.moduleKey}-${rowPartId}`);

  test('통 모듈 셋이 명세에 들어온다 — 몸통은 아래→위 (2단 = 하부장·상부장, 외부 서랍 = 서랍모듈이 맨 아래)', () => {
    expect(spec.items[0].modules.map((m) => [m.moduleId, m.kind])).toEqual([['w1', 'wardrobe'], ['w2', 'wardrobe'], ['w3', 'wardrobe']]);
    expect(mod('w1').carcasses.map((c) => [c.group, c.y0, c.h, c.sakuri])).toEqual([['하부장', 0, 1140, false], ['상부장', 1140, 1140, true]]);
    expect(mod('w2').carcasses.map((c) => [c.group, c.y0, c.h, c.sakuri])).toEqual([['서랍모듈', 0, 700, true], ['통', 700, 1580, true]]);
    spec.items[0].modules.forEach((m) => expect(m.box).toEqual({ W: 900, H: 2280, D: 600, T: 15 }));
  });

  test('몸통마다 싱크와 같은 짜임 — 사쿠리 상부장은 홈·천지판 D−18, 하부장은 뒤에 덮음·측판 깊이', () => {
    const m = mod('w1');
    const [upL] = of(m, 'body:side-0');
    expect(upL.box).toEqual({ min: [-450, 1140, -300], max: [-435, 2280, 300] });
    expect(upL.features.map((f) => f.src)).toEqual(['sakuri']);
    expect(of(m, 'body:bottom-0')[0].box).toEqual({ min: [-435, 1140, -282], max: [435, 1155, 300] });
    expect(of(m, 'body:top-0')[0].box).toEqual({ min: [-435, 2265, -282], max: [435, 2280, 300] });
    expect(of(m, 'back-0')[0].box).toEqual({ min: [-440, 1140.5, -285], max: [440, 2279.5, -282] });
    expect(of(m, 'body:side-1')[0].features).toEqual([]);
    expect(of(m, 'body:top-1')[0].box).toEqual({ min: [-435, 1125, -300], max: [435, 1140, 300] });
    expect(of(m, 'back-1')[0].box).toEqual({ min: [-449.5, 0.5, -303], max: [449.5, 1139.5, -300] });
    expect(m.parts.filter((p) => p.part !== '선반' && p.part !== '도어' && !p.tags.pedestal).every((p) => p.tags.carcass === (p.box.min[1] >= 1140 ? 1 : 0))).toBe(true);
  });

  test('선반 높이 — 통 구조 블록이 없는 옛 설계는 wardrobe.md §6 (긴옷: 상단 315 아래, 그 밖: 균등)', () => {
    // w2 긴옷 통 (몸통 1580, y0 700) — 첫 선반 밑면 = 칸 상단 − 315
    const [s2] = of(mod('w2'), 'shelf#0-0');
    expect(s2.box.min[1]).toBe(700 + 1580 - 15 - WR.WARDROBE_RULES.LONG_FIRST_SHELF);
    // w3 하부장 선반 2 — (1140 − 30 − 2×15) / 3 간격
    expect(of(mod('w3'), 'shelf#1-0').map((p) => p.box.min[1])).toEqual([15 + 360, 15 + 360 + 15 + 360]);
    // 천지판 뒤끝에 맞춘다 — 사쿠리 몸통 D−88 선반은 앞이 70 남는다 (§6 전면 여유)
    expect(s2.box.min[2]).toBe(-282);
    expect(s2.box.max[2]).toBe(300 - 70);
  });

  test('통 구조 블록이 있으면 규칙 파일 배치의 선반 자리 — 몸통 높이가 다르면 놓지 않는다', () => {
    const item = JSON.parse(JSON.stringify(FIXTURES.wardrobe));
    const w2 = item.modules.find((m) => m.id === 'w2');
    w2.wardrobe = { preset: 'longDrawer', drawers: 2, externalDrawer: true };
    item.specs.wardrobeMoldingH = 60;
    const design = { items: [item] };
    const materials = new MaterialExtractor().extract(design).materials;
    const s = Asm.of(design, { materials });
    const m = s.items[0].modules.find((x) => x.moduleId === 'w2');
    const L = WR.layoutWardrobeModule({ W: 900, D: 600, T: 15, bodyH: 2400 - 60 - 60, preset: 'longDrawer', drawers: 2, externalDrawer: true });
    const shelves = m.parts.filter((p) => p.part === '선반');
    expect(shelves.map((p) => p.box.min[1])).toEqual(L.shelves.map((x) => x.y));
    expect(shelves.length).toBeGreaterThan(0);
    // 몸통 높이를 바꾸면 (BOM 몸통 ≠ 배치) 선반은 shelf-height-unknown
    w2.h = 2200;
    const s2 = Asm.of(design, { materials: new MaterialExtractor().extract(design).materials });
    expect(s2.unplaced.filter((u) => u.moduleKey === '0-w2' && u.part === '선반').map((u) => u.reason)).toEqual(['shelf-height-unknown']);
  });

  test('칸막이 — 규칙 파일 배치 자리 (반 분할: 세로 칸막이가 칸 사이, 지판 위~천판 아래, 천지판과 같은 깊이)', () => {
    const item = JSON.parse(JSON.stringify(FIXTURES.wardrobe));
    const w2 = item.modules.find((m) => m.id === 'w2');
    Object.assign(w2, { isExternalDrawer: false, drawerCount: 0, wardrobe: { preset: 'halfSplit', drawers: 0 } });
    item.specs.wardrobeMoldingH = 60;
    const design = { items: [item] };
    const s = Asm.of(design, { materials: new MaterialExtractor().extract(design).materials });
    const m = s.items[0].modules.find((x) => x.moduleId === 'w2');
    const L = WR.layoutWardrobeModule({ W: 900, D: 600, T: 15, bodyH: 2280, preset: 'halfSplit', drawers: 0 });
    const divs = m.parts.filter((p) => p.part === '세로칸막이');
    expect(divs).toHaveLength(L.dividers.length);
    expect(divs.length).toBeGreaterThan(0);
    const d = L.dividers[0];
    expect(divs[0].box).toEqual({ min: [-450 + 15 + d.x, 15, -282], max: [-450 + 15 + d.x + 15, 2280 - 15, 300] });
    expect(s.unplaced.filter((u) => /칸막이/.test(u.part))).toEqual([]);
  });

  test('외부 서랍 통은 못 놓은 행이 없다', () => {
    const reasons = (id) => [...new Set(spec.unplaced.filter((u) => u.moduleKey === `0-${id}`).map((u) => u.reason))].sort();
    expect(reasons('w2')).toEqual([]);
    expect(spec.unplaced.filter((u) => u.part === '도어')).toEqual([]);
    expect(spec.unplaced.filter((u) => /^좌대 (전후|측|중간보강)$/.test(u.part))).toEqual([]);
  });

  test('도어 — 좌대를 덮고 바닥에서 20 뜬다, 윗변 = 몸통 상단 (2026-10-20 카드 "바닥 20 띄움")', () => {
    const m = spec.items[0].modules.find((x) => x.moduleId === 'w1');
    const doors = m.parts.filter((p) => p.part === '도어');
    expect(doors.map((p) => p.box)).toEqual([
      { min: [-448, -40, 300], max: [-2, 2280, 318] },
      { min: [2, -40, 300], max: [448, 2280, 318] },
    ]);
    // 외부 서랍 통 — 도어 1580 은 서랍 몸통 상단(700)부터 몸통 상단까지 (2026-10-20 카드 "도어 1580")
    const w2 = spec.items[0].modules.find((x) => x.moduleId === 'w2');
    expect(w2.parts.filter((p) => p.part === '도어').map((p) => [p.box.min[1], p.box.max[1], p.cut.h])).toEqual([[700, 2280, 1580], [700, 2280, 1580]]);
    // 외부 서랍 2단 전면 340 — 바닥에서 20 (좌대 60 을 40 덮음), 서랍마다 위에 목찬넬 틈 30, 맨 위 틈이 서랍 몸통 상단 700 에서 끝남
    expect(w2.parts.filter((p) => p.part === '서랍도어').map((p) => p.box)).toEqual([
      { min: [-448, -40, 300], max: [448, 300, 318] },
      { min: [-448, 330, 300], max: [448, 670, 318] },
    ]);
  });

  // notches — 서랍모듈 측판 앞선 따내기 [src, v0, v1] (2026-10-20 카드 "싱크처럼 따냄"):
  //   상단 70×40 은 몸통 상단, 중간 90×40 은 윗선 = 위 전면 아랫단 + 20, 아래 전면 윗단 = 윗선 − 50
  test.each([
    [1, [[-40, 320]], [['channel-top', 280, 350]]],
    [2, [[-40, 300], [330, 670]], [['channel-top', 630, 700], ['channel-mid', 260, 350]]],
    // 3단: 상단 틈 + 아래 두 장 사이 틈 (assignChannels), 위 두 장 사이는 싱크 규칙 4 (카드 "4 띄움") — 342 × 3 딱 맞음
    [3, [[-40, 302], [332, 674], [678, 1020]], [['channel-top', 980, 1050], ['channel-mid', 262, 352]]],
  ])('외부 서랍 %i단 전면 — 바닥 20 위부터, 목찬넬 손잡이 규칙 그대로 · 측판 따내기는 싱크처럼', (n, spans, notches) => {
    const item = JSON.parse(JSON.stringify(FIXTURES.wardrobe));
    item.modules.find((x) => x.id === 'w2').drawerCount = n;
    const design = { items: [item] };
    const s = Asm.of(design, { materials: new MaterialExtractor().extract(design).materials });
    const w2 = s.items[0].modules.find((x) => x.moduleId === 'w2');
    expect(w2.parts.filter((p) => p.part === '서랍도어').map((p) => [p.box.min[1], p.box.max[1]])).toEqual(spans);
    const sides = w2.parts.filter((p) => p.part === '측판' && p.tags.carcass === 0);
    expect(sides).toHaveLength(2);
    sides.forEach((p) => {
      expect(p.features.filter((f) => f.type === 'notch').map((f) => [f.src, f.v0, f.v1])).toEqual(notches);
      p.features.filter((f) => f.type === 'notch').forEach((f) => expect([f.u0, f.u1]).toEqual([560, 600]));
    });
    expect(w2.pending).toEqual([]);
    // 서랍모듈 천판 없음 (카드 "천판 빼기") — 목찬넬 ㄴ자가 따낸 자리에: 지면판 40 이 따낸 바닥, 전면판이 그 위 안쪽 끝
    expect(w2.parts.filter((p) => p.part === '천판' && p.tags.carcass === 0)).toEqual([]);
    const ch = (part) => w2.parts.filter((p) => p.part === part).map((p) => p.box);
    const notchBox = (lo, faceH) => [{ min: [-450, lo, 260], max: [450, lo + 18, 300] }, { min: [-450, lo + 18, 260], max: [450, lo + 18 + faceH, 278] }];
    expect([...ch('목찬넬(지면)'), ...ch('목찬넬(전면)')]).toEqual(notchBox(notches[0][1], 52));
    const mids = notches.slice(1).map(([, lo]) => notchBox(lo, 72));
    expect(ch('목찬넬(중간 지면)')).toEqual(mids.map((m) => m[0]));
    expect(ch('목찬넬(중간 전면)')).toEqual(mids.map((m) => m[1]));
    expect(s.unplaced.filter((u) => /목찬넬/.test(u.part))).toEqual([]);
    expect(s.unplaced.filter((u) => u.part === '서랍도어' || u.part === '도어')).toEqual([]);
    expect(require('../js/detaildesign/assembly-check.js').check(s).issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  // 2026-10-20 사장님 카드 "싱크 규칙": 외부 서랍 박스는 싱크 서랍 박스 — 언더레일 500 (깊이 600 − 50 이하 최대), 측판 490,
  //   측판 밑단 = 서랍 자리 바닥 + 30, 가로 가운데 (외경 858), 앞끝 = 몸통 앞선. 자리 바닥: 지판 윗면 · 중간 따낸 윗선 · 전면 사이 틈 가운데
  test.each([
    [1, [45]],
    [2, [380, 45]],             // 위 서랍: 중간 따낸 윗선 350 + 30
    [3, [706, 382, 45]],        // 맨 위: 전면 사이 틈 가운데 676 + 30, 가운데: 중간 따낸 윗선 352 + 30
  ])('외부 서랍 %i단 박스 — 싱크 서랍 박스 자리', (n, y0s) => {
    const item = JSON.parse(JSON.stringify(FIXTURES.wardrobe));
    item.modules.find((x) => x.id === 'w2').drawerCount = n;
    const design = { items: [item] };
    const s = Asm.of(design, { materials: new MaterialExtractor().extract(design).materials });
    const w2 = s.items[0].modules.find((x) => x.moduleId === 'w2');
    const sides = w2.parts.filter((p) => p.part === '서랍측판');
    expect(sides.filter((p) => p.tags.side === 'left').map((p) => p.box)).toEqual(y0s.map((y) => ({ min: [-429, y, -190], max: [-414, y + 180, 300] })));
    expect(w2.parts.filter((p) => p.part === '서랍밑판').map((p) => [p.cut.w, p.cut.h, p.box.max[1]])).toEqual(y0s.map((y) => [857, 489, y]));
    expect(w2.parts.filter((p) => p.part === '서랍 하단보강')).toHaveLength(n);
    expect(s.unplaced.filter((u) => u.moduleKey === '0-w2' && /^서랍/.test(u.part))).toEqual([]);
    // 서랍모듈 밴드 2장 — 2026-10-20 사장님 "뒤 눕힘" (하부장과 같다): 앞은 상단 ㄴ자 지면판 바로 아래 (따내기 70 아래),
    //   뒤는 윗면 = 몸통 상단, 사쿠리 홈 앞 (천지판처럼 −282). 둘 다 눕혀서 측판 사이, 두께는 몸통 15.
    const top = n * 350;
    expect(w2.parts.filter((p) => p.part === '밴드').map((p) => [p.box, p.tags.end])).toEqual([
      [{ min: [-435, top - 70 - 15, 230], max: [435, top - 70, 300] }, 'front'],
      [{ min: [-435, top - 15, -282], max: [435, top, -212] }, 'back'],
    ]);
    expect(s.unplaced.filter((u) => u.moduleKey === '0-w2')).toEqual([]);
    expect(require('../js/detaildesign/assembly-check.js').check(s).issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  // 2026-10-20 사장님 카드 "도어 앞선−70": 내부 서랍장 — 도어 앞면 = 통 앞선 − 70, 모듈은 그 뒤 (앞선 − 85), 좌우몰딩·상판 앞선도 앞선 − 70.
  //   높이·가로는 규칙 파일 innerDrawerLayout: 통 지판 위, 모듈 W = 통 내경 − 120 가운데, 몰딩 60, 상판은 모듈 위.
  test.each([
    [1, [[17, 333]]],
    [2, [[17, 350], [380, 713]]],
    [3, [[17, 345], [375, 703], [703, 1031]]],
  ])('내부 서랍장 %i단 — 도어 앞면 = 앞선 − 70, 모듈은 그 뒤', (n, spans) => {
    const item = JSON.parse(JSON.stringify(FIXTURES.wardrobe));
    Object.assign(item.modules.find((x) => x.id === 'w2'), { isExternalDrawer: false, drawerCount: n, wardrobe: { preset: 'longDrawer', drawers: n } });
    const design = { items: [item] };
    const s = Asm.of(design, { materials: new MaterialExtractor().extract(design).materials });
    const w2 = s.items[0].modules.find((x) => x.moduleId === 'w2');
    const inner = (part) => w2.parts.filter((p) => p.tags.innerDrawer && p.part === part).map((p) => p.box);
    const H = n * 350;
    expect(w2.parts.filter((p) => p.part === '내부서랍 전면판').map((p) => [p.box.min[1], p.box.max[1], p.box.min[2], p.box.max[2], p.box.min[0]])).toEqual(spans.map(([a, b]) => [a, b, 215, 230, -373]));
    expect(inner('내부서랍 좌우몰딩')).toEqual([{ min: [-435, 15, 215], max: [-375, 15 + H, 230] }, { min: [375, 15, 215], max: [435, 15 + H, 230] }]);
    expect(inner('측판')).toEqual([{ min: [-375, 15, -275], max: [-360, 15 + H, 215] }, { min: [360, 15, -275], max: [375, 15 + H, 215] }]);
    expect(inner('상판')).toEqual([{ min: [-435, 15 + H, 230 - 512], max: [435, 30 + H, 230] }]);
    // 밴드 — 2026-10-20 사장님 "뒤 눕힘": 천판 대신 상단 앞·뒤에 눕는다 (70 이 앞뒤), 윗면 = 모듈 상단, 그 위 상판
    expect(inner('밴드').map((p) => [p.min[1], p.max[1], p.min[2], p.max[2]])).toEqual([[H, 15 + H, 215 - 70, 215], [H, 15 + H, -275, -205]]);
    // 박스 — 카드 "싱크 규칙 바닥+30": 측판 밑단 = 서랍 자리 바닥(맨 아래는 지판 윗면 30, 그 위는 도어 아랫단) + 30, 앞끝 = 모듈 앞선 215
    expect(w2.parts.filter((p) => p.part === '서랍측판' && p.tags.side === 'left').map((p) => p.box))
      .toEqual(spans.map(([a], i) => (i === 0 ? 30 : a) + 30).map((y) => ({ min: [-354, y, -225], max: [-339, y + 180, 215] })));
    expect(s.unplaced.filter((u) => u.moduleKey === '0-w2')).toEqual([]);
    expect(require('../js/detaildesign/assembly-check.js').check(s).issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  test('좌대 상자 — 몸통 아래, 뒤 맞춤 (앞 50 들어감), 측판은 전후판 사이, 중간보강은 폭 가운데 (2026-10-20 카드)', () => {
    const m = spec.items[0].modules.find((x) => x.moduleId === 'w1');
    const ped = m.parts.filter((p) => p.tags.pedestal);
    const box = (part, k) => ped.filter((p) => p.part === part)[k].box;
    expect(ped).toHaveLength(5);
    expect(box('좌대 전후', 0)).toEqual({ min: [-450, -60, 300 - 50 - 15], max: [450, 0, 300 - 50] });
    expect(box('좌대 전후', 1)).toEqual({ min: [-450, -60, -300], max: [450, 0, -285] });
    expect(box('좌대 측', 0)).toEqual({ min: [-450, -60, -285], max: [-435, 0, 235] });
    expect(box('좌대 측', 1)).toEqual({ min: [435, -60, -285], max: [450, 0, 235] });
    expect(box('좌대 중간보강', 0)).toEqual({ min: [-7.5, -60, -285], max: [7.5, 0, 235] });
    const issues = require('../js/detaildesign/assembly-check.js').check(spec).issues;
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

// 오픈장·밥솥장 — 18T MDF 상자 (bom-open-cabinet-rules.js). 자리는 플래너 buildOpenCabinetMesh 와 같다.
describe('오픈장·밥솥장 자리 — 18T 상자', () => {
  const item = JSON.parse(JSON.stringify(FIXTURES.sink15));
  item.modules.push({ id: 'oc1', moduleKind: 'open', pos: 'upper', w: 500, h: 450, d: 570 });
  item.modules.push({ id: 'rc1', moduleKind: 'rice', pos: 'lower', w: 600, h: 700, d: 550, doorType: 'swing' });
  const design = { items: [item] };
  const materials = new MaterialExtractor().extract(design).materials;
  const s = Asm.of(design, { materials });
  const mod = (id) => s.items[0].modules.find((m) => m.moduleId === id);
  const box = (m, part, k) => m.parts.filter((p) => p.part === part)[k].box;

  test('BOM 행이 제 모듈을 가리킨다 (0-none 이 아니다)', () => {
    expect(materials.filter((r) => /^(오픈장|밥솥장)$/.test(r.module)).map((r) => r.moduleKey).sort())
      .toEqual(['0-oc1', '0-oc1', '0-oc1', '0-rc1', '0-rc1', '0-rc1', '0-rc1']);
  });

  test('오픈장 — 측판 깊이 전체, 천지판 측판 사이 앞선 맞춤, 뒷판 측판 사이 뒤끝 맞춤 몸통 높이 전체', () => {
    const m = mod('oc1');
    expect(m.kind).toBe('open');
    expect(m.box).toEqual({ W: 500, H: 450, D: 570, T: 18 });
    expect(box(m, '측판', 0)).toEqual({ min: [-250, 0, -285], max: [-232, 450, 285] });
    expect(box(m, '측판', 1)).toEqual({ min: [232, 0, -285], max: [250, 450, 285] });
    expect(box(m, '천지판', 0)).toEqual({ min: [-232, 0, -265], max: [232, 18, 285] });
    expect(box(m, '천지판', 1)).toEqual({ min: [-232, 432, -265], max: [232, 450, 285] });
    expect(box(m, '뒷판', 0)).toEqual({ min: [-232, 0, -285], max: [232, 450, -267] });
  });

  test('밥솥장 — 같은 상자 + 도어 (W−4)×(H−4) 가 측판 앞선에 붙어 가운데', () => {
    const m = mod('rc1');
    expect(m.parts).toHaveLength(6);
    expect(box(m, '도어', 0)).toEqual({ min: [-298, 2, 275], max: [298, 698, 293] });
  });

  test('못 놓은 행 없음 · 조립 검사 오류 없음', () => {
    expect(s.unplaced.filter((u) => /oc1|rc1/.test(u.moduleKey))).toEqual([]);
    const issues = require('../js/detaildesign/assembly-check.js').check(s).issues;
    expect(issues.filter((i) => /oc1|rc1/.test(i.moduleKey))).toEqual([]);
  });
});

describe('라인 부재 runs[] — 상판 · 상몰딩 · 목찬넬 EP · 걸레받이 · 좌우 휠라 (opts.lines 로 벽마다 모듈 x 를 넘긴다)', () => {
  /** 픽스처 모듈을 pos 순서대로 한 벽에 붙여 세운다 (하부·상부 각각 x 0 부터) */
  const linesOf = (item) => {
    const mods = [];
    ['lower', 'upper'].forEach((pos) => {
      let x = 0;
      item.modules.filter((m) => m.pos === pos).forEach((m) => { mods.push({ moduleKey: `0-${m.id}`, x0: x }); x += Number(m.w) || 0; });
    });
    return [{ key: 'wall', D: item.d, modules: mods }];
  };
  const specWith = (name, lines) => {
    const design = { items: [FIXTURES[name]] };
    return Asm.of(design, { materials: new MaterialExtractor().extract(design).materials, lines });
  };
  const epOf = (s) => s.unplaced.filter((u) => /-ep$/.test(u.moduleKey)).map((u) => [u.part, u.reason]);
  const runOf = (s, part) => s.items[0].runs.find((r) => r.parts[0].part === part);

  test('lines 가 없으면 품목 단위 행은 전부 run-part 로 남는다 (전과 같다)', () => {
    const s = specWith('shoerack');
    expect(s.items[0].runs).toEqual([]);
    expect(epOf(s).every((e) => e[1] === 'run-part')).toBe(true);
  });

  test('신발장 (하부 900 · 500 서랍 · 400, 상부 900 · 600, 목찬넬 · 휠라 60 양쪽): 상몰딩은 상부 첫 모듈 위 띠, 목찬넬 EP 는 하부 따내기 자리', () => {
    const s = specWith('shoerack', { 0: linesOf(FIXTURES.shoerack) });
    const mold = runOf(s, '상몰딩');
    expect([mold.lineKey, mold.hostModuleKey]).toEqual(['wall', '0-u1']);
    // 상부장 900×720, 앞선 z 147.5 (D 295): 몸통 위 y 720…780 … 이 픽스처는 상부 H 705 — 띠 앞면 = 도어 앞면
    expect(mold.parts[0].box).toEqual({ min: [-450, 705, 147.5], max: [1050, 765, 165.5] });
    expect(mold.parts[0].tags).toEqual({ run: 'molding' });
    const face = runOf(s, '목찬넬(전면)'), base = runOf(s, '목찬넬(지면)');
    expect(face.hostModuleKey).toBe('0-l1');
    // 하부 708 · D 270 → 따내기 바닥 y 638, 앞선 z 135: 지면판 40 × 1800 바닥에, 전면판 52 그 위 안쪽 끝 (키큰장 단 ㄴ자와 같다)
    expect(base.parts[0].box).toEqual({ min: [-450, 638, 135], max: [1350, 656, 175] });
    expect(face.parts[0].box).toEqual({ min: [-450, 656, 135], max: [1350, 708, 153] });
    // 걸레받이 1800 × 145: 바닥(다리발 150 아래)에 붙여 → 밑단 y −150, 윗단 −5 (틈은 캐쳐로), 앞면 = 몸통 앞선 175 − 32 (2026-10-22 카드 "몸통 앞선에서 32 안쪽")
    const kick = runOf(s, '걸레받이');
    expect(kick.hostModuleKey).toBe('0-l1');
    expect(kick.parts[0].box).toEqual({ min: [-450, -150, 125], max: [1350, -5, 143] });
    expect(kick.parts[0].tags).toEqual({ run: 'kick' });
    // 좌우 휠라 60 × 2160: 하부 라인 양 끝 밖, 밑단 = 하부 몸통 바닥, 앞면 = 도어 앞면 175 + 18 (카드 "앞면 = 도어 앞면")
    expect(runOf(s, '휠라(좌)').parts[0].box).toEqual({ min: [-510, 0, 175], max: [-450, 2160, 193] });
    expect(runOf(s, '휠라(우)').parts[0].box).toEqual({ min: [1350, 0, 175], max: [1410, 2160, 193] });
    expect(runOf(s, '휠라(좌)').parts[0].tags).toEqual({ run: 'finish', side: 'left' });
    expect(epOf(s)).toEqual([]);
  });

  test('싱크 15T (하부 6 모듈 4100 + 좌 휠라 30, 후드가 상부 가운데): 상판은 하부 라인 위 한 장 (뒤 = 벽, 깊이 650), 상몰딩은 후드 때문에 못 놓는다', () => {
    const s = specWith('sink15', { 0: linesOf(FIXTURES.sink15) });
    const top = runOf(s, '상판');
    expect(top.hostModuleKey).toBe('0-l1');
    expect(top.parts[0].cut).toEqual({ w: 4130, h: 650 });
    expect(top.parts[0].box).toEqual({ min: [-530, 708, -275], max: [3600, 720, 375] });   // 호스트 l1 1000 가운데, 좌 휠라 30 만큼 왼쪽으로
    expect(top.parts[0].tags).toEqual({ run: 'top' });
    expect(runOf(s, '목찬넬(전면)').parts[0].box).toEqual({ min: [-500, 656, 235], max: [3000, 708, 253] });   // 쿡탑장 600 은 뺀 3500
    expect(epOf(s)).toContainEqual(['상몰딩', 'run-layout-unknown']);
    // 걸레받이 — BOM 벽 길이는 쿡탑장 600 을 뺀 3500 = 2440 + 1060 두 조각, 왼쪽부터 2440, 남는 1060 은 오른쪽 끝 (카드 "1"). 호스트 l1 1000 가운데 → 왼쪽 끝 x −500
    const kicks = s.items[0].runs.filter((r) => r.parts[0].part === '걸레받이').map((r) => [r.parts[0].cut.w, r.parts[0].box.min[0], r.parts[0].box.max[0]]);
    expect(kicks).toEqual([[2440, -500, 1940], [1060, 1940, 3000]]);
    expect(epOf(s).filter((e) => e[0] === '걸레받이')).toEqual([]);
    expect(runOf(s, '휠라(좌)').parts[0].box).toEqual({ min: [-530, 0, 275], max: [-500, 2160, 293] });   // 좌 휠라 30, 앞면 = 도어 앞면 275 + 18
  });

  test('2026-10-24 D3: 몸통이 벽에서 back 만큼 떠 있으면 상판 뒤 = 벽 (호스트 back), 앞선 = 도어 앞면 + 12 — 다른 라인 부재는 그대로', () => {
    // 플래너 배치 650 = 물끊기 10 + 도어 자리 20 + 몸통 550 + 뒤 여유 70 (seatModuleDepth)
    const ln = linesOf(FIXTURES.sink15)[0];
    const back = 650 - 10 - 20 - 550;
    const s = specWith('sink15', { 0: [Object.assign({}, ln, { modules: ln.modules.map((e) => Object.assign({ back }, e)) })] });
    const plain = specWith('sink15', { 0: linesOf(FIXTURES.sink15) });
    const top = runOf(s, '상판');
    expect(top.parts[0].cut).toEqual({ w: 4130, h: 650 });
    expect(top.parts[0].box).toEqual({ min: [-530, 708, -345], max: [3600, 720, 305] });
    const doorFront = Math.max(...s.items[0].modules.find((m) => m.moduleKey === top.hostModuleKey).parts.filter((p) => p.tags && (p.tags.doorIdx != null || p.tags.drawerIdx != null)).map((p) => p.box.max[2]));
    expect(top.parts[0].box.max[2] - doorFront).toBe(12);   // 물끊기 10 + 도어 자리 20 − 도어 18
    const others = (x) => x.items[0].runs.filter((r) => r.parts[0].part !== '상판').map((r) => r.parts[0].box);
    expect(others(s)).toEqual(others(plain));
    expect(epOf(s)).toEqual(epOf(plain));
  });

  test('하부 모듈이 두 벽에 걸치면 한 장 상판은 못 놓는다 (run-layout-unknown)', () => {
    const ln = linesOf(FIXTURES.sink15)[0];
    const lines = [{ key: 'a', D: 650, modules: ln.modules.slice(0, 3) }, { key: 'b', D: 650, modules: ln.modules.slice(3) }];
    const s = specWith('sink15', { 0: lines });
    expect(runOf(s, '상판')).toBeUndefined();
    expect(epOf(s)).toContainEqual(['상판', 'run-layout-unknown']);
  });
});

describe('옛 냉장고장 화면 모듈 (type, pos 없음) — 2026-10-22 사장님: 상부장 15T 사쿠리 + 보강목, 도어 H+20 아래로 20', () => {
  const { spec: s } = specOf('fridge');
  const modOf = (id) => s.items[0].modules.find((m) => m.moduleId === id);
  const box = (m, part, k) => m.parts.filter((p) => p.part === part)[k || 0].box;

  test('냉장고상부장(r4 700×400×700): 사쿠리 몸통 + 보강목 2장 홈 뒤 위·아래 + 도어 윗변 = 몸통 상단, 밑단 −20', () => {
    const m = modOf('r4');
    expect(m.sakuri).toBe(true);
    expect(box(m, '밴드(보강목)', 0)).toEqual({ min: [-335, 15, -350], max: [335, 75, -335] });
    expect(box(m, '밴드(보강목)', 1)).toEqual({ min: [-335, 325, -350], max: [335, 385, -335] });
    expect(box(m, '뒷판')).toEqual({ min: [-340, 0.5, -335], max: [340, 399.5, -332] });
    expect(box(m, '도어')).toEqual({ min: [-348, -20, 350], max: [348, 400, 368] });
  });

  test('키큰장(r2)·EL장(r6)은 사쿠리 몸통에 천판, 보강목 없음 — 키큰장 도어도 아래로 20, 선반은 높이 모름', () => {
    const tall = modOf('r2'), el = modOf('r6');
    expect(tall.parts.filter((p) => p.part !== '선반').map((p) => p.part)).toEqual(['측판', '측판', '천판', '지판', '뒷판', '도어']);
    expect(box(tall, '도어')).toEqual({ min: [-298, -20, 350], max: [298, 2290, 368] });
    expect(el.parts.map((p) => p.part)).toEqual(['측판', '측판', '천판', '지판', '뒷판']);
    expect(tall.parts.filter((p) => p.part === '선반')).toHaveLength(3);   // specOf 가 선반 높이를 넘긴다
  });

  test('냉장고하부장(r5 500×797): 뒤 덮음 뒷판 + 천판, 도어 H−30 밑단 = 몸통 바닥', () => {
    const m = modOf('r5');
    expect(m.sakuri).toBe(false);
    expect(box(m, '천판')).toEqual({ min: [-235, 782, -350], max: [235, 797, 350] });
    expect(m.parts.find((p) => p.part === '뒷판').tags).toEqual({ mount: 'behind-sides' });
    expect(box(m, '도어')).toEqual({ min: [-248, 0, 350], max: [248, 767, 368] });
  });

  test('홈카페장(r3 900×2290×700): 18T 상자 — 측판 D+20, 천지판 앞선 맞춤, 18T 뒷판 측판 사이 뒤끝, 도어 2장 아래로 20', () => {
    const m = modOf('r3');
    expect(m.kind).toBe('homecafe');
    expect(m.box).toEqual({ W: 900, H: 2290, D: 720, T: 18 });
    expect(box(m, '지판')).toEqual({ min: [-432, 0, -340], max: [432, 18, 360] });
    expect(box(m, '뒷판')).toEqual({ min: [-432, 0, -360], max: [432, 2290, -342] });
    expect(box(m, '도어', 0)).toEqual({ min: [-448, -20, 360], max: [-2, 2290, 378] });
    expect(box(m, '도어', 1)).toEqual({ min: [2, -20, 360], max: [448, 2290, 378] });
  });

  test('냉장고 자체(r1)는 모듈이 없고, 선반 말고 못 놓은 행 없음 · 조립 검사 오류 없음', () => {
    expect(modOf('r1')).toBeUndefined();
    expect(s.unplaced.filter((u) => u.part !== '선반')).toEqual([]);   // 홈카페장 선반은 높이 모름(shelf-height-unknown)
    const issues = require('../js/detaildesign/assembly-check.js').check(s).issues;
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('키큰장 단 자리 — 좌대 뒤 맞춤 · 걸레받이 · 목찬넬 ㄴ자 (2026-10-20 카드)', () => {
  const st = specOf('storage').spec;
  const wh = specOf('warehouse').spec;
  const modOf = (s, id) => s.items[0].modules.find((m) => m.moduleId === id);
  const box = (m, part, k) => m.parts.filter((p) => p.part === part)[k].box;
  const notches = (m, k) => m.parts.filter((p) => p.part === '측판')[k].features.filter((f) => f.type === 'notch');

  test('storage t1 — 측판 상단 70×40 따내기, 앞 밴드 따내기 아래 · 뒤 밴드 몸통 상단 뒤끝 (둘 다 눕힘 T)', () => {
    const m = modOf(st, 't1');
    expect(m.kind).toBe('tall');
    expect(m.box).toEqual({ W: 600, H: 2190, D: 400, T: 15 });
    expect(notches(m, 0)).toEqual([{ type: 'notch', u0: 360, u1: 400, v0: 2120, v1: 2190, src: 'channel-top' }]);
    expect(notches(m, 1)).toEqual(notches(m, 0));
    expect(box(m, '밴드', 0)).toEqual({ min: [-285, 2105, 130], max: [285, 2120, 200] });
    expect(box(m, '밴드', 1)).toEqual({ min: [-285, 2175, -200], max: [285, 2190, -130] });
  });

  test('storage t1 — 목찬넬 ㄴ자: 지면판 40 따내기 바닥에, 전면판 52 그 위 앞선 −40', () => {
    const m = modOf(st, 't1');
    expect(box(m, '목찬넬(지면)', 0)).toEqual({ min: [-300, 2120, 160], max: [300, 2138, 200] });
    expect(box(m, '목찬넬(전면)', 0)).toEqual({ min: [-300, 2138, 160], max: [300, 2190, 178] });
  });

  test('storage t1 — 좌대 뒤 맞춤: 상자 뒷면 = 몸통 뒷면, 앞 50 들어감, 걸레받이 MDF 18 그 앞, 32 남음', () => {
    const m = modOf(st, 't1');
    expect(box(m, '좌대 전후', 0)).toEqual({ min: [-300, -60, 135], max: [300, 0, 150] });
    expect(box(m, '좌대 전후', 1)).toEqual({ min: [-300, -60, -200], max: [300, 0, -185] });
    expect(box(m, '좌대 측', 0)).toEqual({ min: [-300, -60, -185], max: [-285, 0, 135] });
    expect(box(m, '좌대 측', 1)).toEqual({ min: [285, -60, -185], max: [300, 0, 135] });
    expect(box(m, '좌대 걸레받이', 0)).toEqual({ min: [-300, -60, 150], max: [300, 0, 168] });
    expect(m.parts.find((p) => p.part === '좌대 걸레받이').tags).toEqual({ pedestal: true, kick: true });
    expect(box(m, '도어', 0)).toEqual({ min: [-298, 0, 200], max: [-2, 2160, 218] });
  });

  test('warehouse planner-x-0 — 목찬넬 단: 따내기 · 밴드 · ㄴ자 · 좌대(중간보강 가운데) · 처짐방지목이 앞 밴드 아랫면까지', () => {
    const m = modOf(wh, 'planner-x-0');
    expect(m.box).toEqual({ W: 800, H: 750, D: 450, T: 15 });
    expect(notches(m, 0)).toEqual([{ type: 'notch', u0: 410, u1: 450, v0: 680, v1: 750, src: 'channel-top' }]);
    expect(box(m, '밴드', 0)).toEqual({ min: [-385, 665, 155], max: [385, 680, 225] });
    expect(box(m, '밴드', 1)).toEqual({ min: [-385, 735, -225], max: [385, 750, -155] });
    expect(box(m, '밴드(처짐방지)', 0)).toEqual({ min: [-35, 15, 210], max: [35, 665, 225] });
    expect(box(m, '목찬넬(지면)', 0)).toEqual({ min: [-400, 680, 185], max: [400, 698, 225] });
    expect(box(m, '목찬넬(전면)', 0)).toEqual({ min: [-400, 698, 185], max: [400, 750, 203] });
    expect(box(m, '좌대 전후', 0)).toEqual({ min: [-400, -60, 160], max: [400, 0, 175] });
    expect(box(m, '좌대 전후', 1)).toEqual({ min: [-400, -60, -225], max: [400, 0, -210] });
    expect(box(m, '좌대 측', 0)).toEqual({ min: [-400, -60, -210], max: [-385, 0, 160] });
    expect(box(m, '좌대 중간보강', 0)).toEqual({ min: [-7.5, -60, -210], max: [7.5, 0, 160] });
    expect(box(m, '좌대 걸레받이', 0)).toEqual({ min: [-400, -60, 175], max: [400, 0, 193] });
  });

  test('warehouse planner-x-1·x-2 — 목찬넬 없는 단: 따내기 없음, 밴드 둘 다 몸통 상단', () => {
    [['planner-x-1', 780], ['planner-x-2', 600]].forEach(([id, H]) => {
      const m = modOf(wh, id);
      expect(notches(m, 0)).toEqual([]);
      expect(m.parts.filter((p) => /목찬넬|좌대/.test(p.part))).toEqual([]);
      expect(box(m, '밴드', 0)).toEqual({ min: [-385, H - 15, 155], max: [385, H, 225] });
      expect(box(m, '밴드', 1)).toEqual({ min: [-385, H - 15, -225], max: [385, H, -155] });
    });
  });

  test('상몰딩 띠 — 몸통 위 y H…H+60, 앞면 = 도어 앞면(D/2+18), 뒷면 = 몸통 앞선 (2026-10-20 카드 "도어 앞면 맞춤")', () => {
    const t1 = modOf(st, 't1'), x2 = modOf(wh, 'planner-x-2');
    expect(box(t1, '상몰딩', 0)).toEqual({ min: [-300, 2190, 200], max: [300, 2250, 218] });
    expect(box(t1, '도어', 0).max[2]).toBe(218);
    expect(box(x2, '상몰딩', 0)).toEqual({ min: [-400, 600, 225], max: [400, 660, 243] });
    expect(t1.parts.find((p) => p.part === '상몰딩').tags).toEqual({ molding: true });
    expect(modOf(wh, 'planner-x-0').parts.filter((p) => p.part === '상몰딩')).toEqual([]);
  });

  test('못 놓은 행 없음 · 조립 검사 오류 없음', () => {
    expect(st.unplaced.filter((u) => u.moduleKey === '0-t1')).toEqual([]);
    expect(wh.unplaced.filter((u) => /planner-x/.test(u.moduleKey))).toEqual([]);
    const Check = require('../js/detaildesign/assembly-check.js');
    expect(Check.check(st).issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(Check.check(wh).issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('멍장 자리 — corner.md §3.5 (멍가림판 · 마감재 · 도어가 목대를 덮음)', () => {
  const { spec: s } = specOf('sinkCorner');
  const modOf = (id) => s.items[0].modules.find((m) => m.moduleId === id);
  const box = (m, part) => m.parts.find((p) => p.part === part).box;

  test('하부 멍장 1076 = 멍 665 + 도어 411, 벽이 왼쪽(secondaryStartSide 기본 left) — 멍가림판 650 앞선 밖, 마감재 150 그 위 도어 쪽 끝, 도어 422 갭 2 부터', () => {
    const m = modOf('corner-blind-lower');
    expect(m.box).toEqual({ W: 1076, H: 708, D: 650, T: 15 });
    expect(m.blind).toEqual({ zoneW: 665, doorW: 411, doorRight: true });
    expect(box(m, '멍가림판')).toEqual({ min: [-538, 0, 325], max: [112, 708, 327.7] });
    expect(box(m, '휠라(멍판)')).toEqual({ min: [-38, 0, 327.7], max: [112, 708, 345.7] });
    expect(box(m, '도어')).toEqual({ min: [114, 0, 325], max: [536, 678, 343] });
    expect(m.parts.find((p) => p.part === '도어').tags).toEqual({ doorIdx: 0, blind: 'door' });
    // 몸통은 하부장 짜임 그대로 — 밴드 두 장 눕힘, 처짐방지목 가운데
    expect(box(m, '밴드')).toEqual({ min: [-523, 693, 255], max: [523, 708, 325] });
    expect(box(m, '밴드(처짐방지)')).toEqual({ min: [-35, 15, 310], max: [35, 693, 325] });
  });

  test('상부 멍장 790 = 멍 345 + 도어 445 — 사쿠리 몸통, 멍가림판 330, 몰딩(멍판) 150, 도어 456 × H+15', () => {
    const m = modOf('corner-blind-upper');
    expect(m.box).toEqual({ W: 790, H: 720, D: 295, T: 15 });
    expect(box(m, '멍가림판')).toEqual({ min: [-395, 0, 147.5], max: [-65, 720, 150.2] });
    expect(box(m, '몰딩(멍판)')).toEqual({ min: [-215, 0, 150.2], max: [-65, 720, 168.2] });
    expect(box(m, '도어')).toEqual({ min: [-63, -15, 147.5], max: [393, 720, 165.5] });
    expect(box(m, '뒷판').tags).toBeUndefined();
    expect(m.parts.find((p) => p.part === '뒷판').tags).toEqual({ mount: 'groove' });
  });

  test('멍장이 라인 오른쪽 끝(secondaryStartSide right)이면 좌우가 뒤집힌다', () => {
    const item = JSON.parse(JSON.stringify(FIXTURES.sinkCorner));
    item.specs.secondaryStartSide = 'right';
    const design = { items: [item] };
    const r = Asm.of(design, { materials: new MaterialExtractor().extract(design).materials });
    const m = r.items[0].modules.find((x) => x.moduleId === 'corner-blind-lower');
    expect(m.blind.doorRight).toBe(false);
    expect(box(m, '멍가림판')).toEqual({ min: [-112, 0, 325], max: [538, 708, 327.7] });
    expect(box(m, '휠라(멍판)')).toEqual({ min: [-112, 0, 327.7], max: [38, 708, 345.7] });
    expect(box(m, '도어')).toEqual({ min: [-536, 0, 325], max: [-114, 678, 343] });
  });

  test('ㄱ자 경첩목대 — 지판 위·천판 아래(H−2T), 앞다리 멍판 뒤 60×15, 옆다리 도어 쪽 끝 깊이 60 (2026-10-22 사장님) · 못 놓은 행 없음 · 조립 검사 오류 없음', () => {
    expect(s.unplaced.filter((u) => /blind/.test(u.moduleKey)).map((u) => [u.part, u.reason])).toEqual([]);
    const lo = modOf('corner-blind-lower'), up = modOf('corner-blind-upper');
    // 하부 멍장 708 · 15T · 찬넬 손잡이(따내기 없음): y 15…693. 멍 끝(coverEnd) u 650 → x 112, 옆다리 112…127, 앞다리 67…127 멍판 바로 뒤
    expect(box(lo, '경첩목대(앞다리)')).toEqual({ min: [67, 15, 310], max: [127, 693, 325] });
    expect(box(lo, '경첩목대(옆다리)')).toEqual({ min: [112, 15, 250], max: [127, 693, 310] });
    expect(lo.parts.find((p) => p.part === '경첩목대(옆다리)').tags).toEqual({ blind: 'batten-side' });
    // 상부 멍장 720: y 15…705, 도어가 왼쪽이 아니라 오른쪽 — 멍 끝 x −65
    expect(box(up, '경첩목대(앞다리)')).toEqual({ min: [-110, 15, 132.5], max: [-50, 705, 147.5] });
    expect(box(up, '경첩목대(옆다리)')).toEqual({ min: [-65, 15, 72.5], max: [-50, 705, 132.5] });
    expect(modOf('corner-blind-lower').parts.find((p) => p.part === '선반').box.max[2]).toBe(235);   // 선반 D−T−75 는 뒤 맞춤 — 앞끝이 앞선에서 90 (목대 75 + T) 뒤
    const issues = require('../js/detaildesign/assembly-check.js').check(s).issues;
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  test('목찬넬 손잡이면 경첩목대는 따내기 70 아래 앞 밴드 밑까지 — 높이 H−2T−70 (사장님 "목찬넬일 경우 몸통 높이 −100")', () => {
    const item = JSON.parse(JSON.stringify(FIXTURES.sinkCorner));
    item.specs.handle = '목찬넬';
    const design = { items: [item] };
    const r = Asm.of(design, { materials: new MaterialExtractor().extract(design).materials });
    const m = r.items[0].modules.find((x) => x.moduleId === 'corner-blind-lower');
    expect(m.parts.find((p) => p.part === '밴드' && p.tags.end === 'front').box.min[1]).toBe(623);   // 708 − 70 − 15
    expect(box(m, '경첩목대(앞다리)')).toEqual({ min: [67, 15, 310], max: [127, 623, 325] });
    expect(box(m, '경첩목대(옆다리)')).toEqual({ min: [112, 15, 250], max: [127, 623, 310] });
    expect(r.unplaced.filter((u) => /blind/.test(u.moduleKey) && u.part !== '선반')).toEqual([]);
    expect(require('../js/detaildesign/assembly-check.js').check(r).issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('철물 hardware[] — 다리발 · 레일 · 경첩 컵 자리 (2026-10-23 4-1 A~D)', () => {
  const specOf = (name) => { const design = { items: [FIXTURES[name]] }; return Asm.of(design, { materials: new MaterialExtractor().extract(design).materials }); };
  const hwOf = (s, mk, kind) => s.items[0].modules.find((m) => m.moduleKey === mk).hardware.filter((h) => h.kind === kind);
  const specWith = (name, id, patch) => {
    const item = JSON.parse(JSON.stringify(FIXTURES[name]));
    Object.assign(item.modules.find((x) => x.id === id), patch);
    const design = { items: [item] };
    return Asm.of(design, { materials: new MaterialExtractor().extract(design).materials, hardware: new HardwareExtractor().extract(design).hardware });
  };

  test('신발장 하부 900 (6개): 4 코너 다리발 — 외곽에서 25 안쪽 42 각, 앞줄은 걸레받이(앞선 −50) 뒤, 밑면 = 바닥 −150. 가운데 2개는 앞·뒷줄 균등 분할 (4-1 B)', () => {
    const s = specOf('shoerack');
    const legs = hwOf(s, '0-l1', 'leg');
    expect(legs.map((h) => [h.tags.side, h.at])).toEqual([
      ['leftFront', [-404, -150, 104]], ['leftBack', [-404, -150, -129]], ['rightFront', [404, -150, 104]], ['rightBack', [404, -150, -129]],
      ['midFront', [0, -150, 104]], ['midBack', [0, -150, -129]]]);
    expect(legs.every((h) => h.size && h.size[0] === 42 && h.size[1] === 150 && !h.pending)).toBe(true);
    // 500 · 400 은 4개씩 — 전부 자리
    expect(hwOf(s, '0-l2', 'leg').map((h) => !!h.at)).toEqual([true, true, true, true]);
    expect(hwOf(s, '0-l3', 'leg')).toHaveLength(4);
    // 상부장엔 다리발 없음
    expect(hwOf(s, '0-u1', 'leg')).toEqual([]);
  });

  test('폭 1000 (8개): 줄마다 4개 — 코너 ±454 사이 3등분', () => {
    const legs = hwOf(specWith('shoerack', 'l1', { w: 1000 }), '0-l1', 'leg');
    expect(legs).toHaveLength(8);
    const front = legs.filter((h) => /Front$/.test(h.tags.side)).map((h) => h.at[0]).sort((a, b) => a - b);
    expect(front.map((x) => Math.round(x * 100) / 100)).toEqual([-454, -151.33, 151.33, 454]);
    expect(legs.filter((h) => h.tags.side === 'midBack').map((h) => h.tags.mid)).toEqual([1, 2]);
  });

  // 2026-10-24 사장님 (모듈 라이브러리 Q2 "BOM 먼저"): 하부 섹션 상자 모듈도 바닥 다리발로 선다
  test('하부 오픈장 상자 400 (하부 섹션, 다리발 150): 일반 하부장과 같은 4모서리 다리발 — 키큰장 단 상자는 그대로 보류', () => {
    const open = specWith('sink15', 'l4', { moduleKind: 'open', isOpen: true, doorCount: 0, heightParts: { legH: 150, topT: 12 } });
    const m = open.items[0].modules.find((x) => x.moduleKey === '0-l4');
    expect(m.kind).toBe('open');
    const legs = hwOf(open, '0-l4', 'leg');
    expect(legs.map((h) => h.tags.side)).toEqual(['leftFront', 'leftBack', 'rightFront', 'rightBack']);
    expect(legs.every((h) => !h.pending && h.at[1] === -150 && h.size[1] === 150)).toBe(true);
    // 자리 = 같은 폭·깊이 일반 하부장 (l5 400 · 도어 0) 과 같다
    expect(legs.map((h) => h.at)).toEqual(hwOf(open, '0-l5', 'leg').map((h) => h.at));
    // 키큰장 단으로 쓰인 상자(하부 섹션 다리발 없음 — 좌대 · 몰딩)는 자리 보류
    const tier = specWith('sink15', 'l4', { moduleKind: 'open', isOpen: true, doorCount: 0, heightParts: { pedestalH: 60, moldingH: 60 } });
    expect(hwOf(tier, '0-l4', 'leg').every((h) => h.pending === 'leg-tall-tier')).toBe(true);
  });

  // 2026-10-24: 싱크도 키큰장 단에는 다리발이 없다 — sink.md §5 "다리발 대신 좌대(60)" (예전엔 싱크만 옛 셈으로 단도 셌다)
  test('싱크 키큰장 3단 (하부 · 중간 · 상부 단): 다리발 행에 단이 없고 단마다 보류도 없다 · 일반 하부장은 그대로', () => {
    const item = JSON.parse(JSON.stringify(FIXTURES.sink15));
    const tier = (id, part, h, hp) => ({ id, type: 'tall', name: `키큰장 ${part}`, part, pos: 'lower', w: 600, h, d: 550, doorCount: 1, heightParts: hp });
    item.modules.push(tier('t0', '하부장', 801, { pedestalH: 60, moldingH: 0 }), tier('t1', '중간장', 979, { pedestalH: 0, moldingH: 0 }),
      tier('t2', '상부장', 400, { pedestalH: 0, moldingH: 60 }));
    const design = { items: [item] };
    const legsRow = new HardwareExtractor().extract(design).hardware.find((h) => h.category === '다리발');
    const plain = new HardwareExtractor().extract({ items: [FIXTURES.sink15] }).hardware.find((h) => h.category === '다리발');
    expect(legsRow.qty).toBe(plain.qty);                 // 키큰장 단 3개는 세지 않는다
    const s = Asm.of(design, { materials: new MaterialExtractor().extract(design).materials, hardware: new HardwareExtractor().extract(design).hardware });
    ['0-t0', '0-t1', '0-t2'].forEach((mk) => expect([mk, hwOf(s, mk, 'leg')]).toEqual([mk, []]));
    expect(hwOf(s, '0-l2', 'leg').every((h) => h.at && !h.pending)).toBe(true);
  });

  test('신발장 서랍장 500 (2단, 언더레일 300): 박스마다 왼·오 — 박스 측판 밑 30 여유에, 앞끝 = 박스 앞끝, 길이 300', () => {
    const s = specOf('shoerack');
    const m = s.items[0].modules.find((x) => x.moduleKey === '0-l2');
    expect(m.drawerBoxes).toHaveLength(2);
    const rails = hwOf(s, '0-l2', 'rail');
    expect(rails.map((h) => [h.tags.box, h.tags.side, h.at, h.len])).toEqual([
      [0, 'left', [-m.drawerBoxes[0].outerW / 2, m.drawerBoxes[0].y0 - 30, m.drawerBoxes[0].zf - 300], 300],
      [0, 'right', [m.drawerBoxes[0].outerW / 2, m.drawerBoxes[0].y0 - 30, m.drawerBoxes[0].zf - 300], 300],
      [1, 'left', [-m.drawerBoxes[1].outerW / 2, m.drawerBoxes[1].y0 - 30, m.drawerBoxes[1].zf - 300], 300],
      [1, 'right', [m.drawerBoxes[1].outerW / 2, m.drawerBoxes[1].y0 - 30, m.drawerBoxes[1].zf - 300], 300]]);
    expect(rails[0].at).toEqual([-229, 374, -125]);
  });

  test('경첩: 양문은 왼 도어 왼쪽·오른 도어 오른쪽 변. 컵마다 한 항목 — 컵 중심 = 변에서 21.5 (가장자리 4), 도어 상단에서 행 boring, 도어 뒷면, 깊이 12.5 (4-1 A)', () => {
    const s = specOf('shoerack');
    const m = s.items[0].modules.find((x) => x.moduleKey === '0-l1');
    const h = hwOf(s, '0-l1', 'hinge');
    const door = (k) => m.parts.find((p) => p.tags.doorIdx === k && /도어$/.test(p.part)).box;
    expect(h.map((x) => [x.doorIdx, x.edge, x.cupIdx, x.cup, x.cupD, x.backset, x.depth, x.pending])).toEqual([
      [0, 'left', 0, 110, 35, 21.5, 12.5, undefined], [0, 'left', 1, 568, 35, 21.5, 12.5, undefined],
      [1, 'right', 0, 110, 35, 21.5, 12.5, undefined], [1, 'right', 1, 568, 35, 21.5, 12.5, undefined]]);
    expect(h.map((x) => x.at)).toEqual([
      [door(0).min[0] + 21.5, door(0).max[1] - 110, door(0).min[2]], [door(0).min[0] + 21.5, door(0).max[1] - 568, door(0).min[2]],
      [door(1).max[0] - 21.5, door(1).max[1] - 110, door(1).min[2]], [door(1).max[0] - 21.5, door(1).max[1] - 568, door(1).min[2]]]);
    expect(h[0].at).toEqual([-426.5, 568, 175]);
    expect(h[0].partId).toBe(m.parts.find((p) => p.tags.doorIdx === 0).id);
    // 경첩 행 수량 = 컵 항목 수
    expect(h).toHaveLength(4);
  });

  test('외짝 도어: 설계에 hingeSide 가 없으면 방향 미정, left·right 면 그 변에 컵 (4-1 C)', () => {
    expect(hwOf(specOf('shoerack'), '0-u2', 'hinge')).toEqual([expect.objectContaining({ edge: null, at: null, qty: 2, pending: 'hinge-side-unknown', cups: [110, 610] })]);
    ['left', 'right'].forEach((side) => {
      const s = specWith('shoerack', 'u2', { hingeSide: side });
      const d = s.items[0].modules.find((x) => x.moduleKey === '0-u2').parts.find((p) => p.tags.doorIdx === 0 && /도어$/.test(p.part)).box;
      const h = hwOf(s, '0-u2', 'hinge');
      const x = side === 'left' ? d.min[0] + 21.5 : d.max[0] - 21.5;
      expect(h.map((e) => [e.edge, e.at, e.pending])).toEqual([[side, [x, d.max[1] - 110, d.min[2]], undefined], [side, [x, d.max[1] - 610, d.min[2]], undefined]]);
    });
    // 모르는 값은 방향 미정 그대로 (지어내지 않는다)
    expect(hwOf(specWith('shoerack', 'u2', { hingeSide: 'up' }), '0-u2', 'hinge')[0].pending).toBe('hinge-side-unknown');
  });

  test('멍장 도어 경첩은 목대 쪽 변 (도어가 멍 오른쪽이면 왼쪽 변)', () => {
    const s = specOf('sinkCorner');
    const m = s.items[0].modules.find((x) => x.moduleKey === '0-corner-blind-lower');
    expect(m.blind.doorRight).toBe(true);
    const h = hwOf(s, '0-corner-blind-lower', 'hinge');
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((e) => e.edge === 'left' && e.at && !e.pending)).toBe(true);
  });

  test('볼레일: 박스마다 왼·오, 측판 바깥면에 두께 14, 밑단 = 박스 측판 밑단, 앞끝 = 박스 앞끝 (4-1 D)', () => {
    const s = specWith('shoerack', 'l2', { drawer: { rail: 'ball' } });
    const m = s.items[0].modules.find((x) => x.moduleKey === '0-l2');
    expect(m.drawerBoxes.length).toBe(2);
    expect(m.drawerBoxes.every((b) => b.rail === 'ball')).toBe(true);
    const rails = hwOf(s, '0-l2', 'rail');
    expect(rails.map((h) => [h.tags.box, h.tags.side, h.at, h.len, h.thickness, h.pending])).toEqual(m.drawerBoxes.flatMap((b, bi) => [
      [bi, 'left', [-b.outerW / 2, b.y0, b.zf - b.railLength], b.railLength, 14, undefined],
      [bi, 'right', [b.outerW / 2, b.y0, b.zf - b.railLength], b.railLength, 14, undefined]]));
    // 밑단 = 박스 왼 측판 밑단
    const sides = m.parts.filter((p) => p.part === '서랍측판' && p.tags.side === 'left').map((p) => p.box.min[1]);
    expect(rails.filter((h) => h.tags.side === 'left').map((h) => h.at[1])).toEqual(sides);
  });

  test('붙박이장 외부 서랍 레일 — 서랍모듈 박스마다 왼·오, 박스 밑 30 (싱크 규칙); 구조 블록 없는 옛 설계(w3)는 박스가 없어 rail-box-unknown; 철물 행이 없으면 hardware[] 는 빈다', () => {
    const s = specOf('wardrobe');
    const w2 = s.items[0].modules.find((m) => m.moduleKey === '0-w2');
    expect(w2.drawerBoxes).toEqual([
      { x0: -429, y0: 380, zf: 300, z0: -190, outerW: 858, railLength: 500, rail: 'under' },
      { x0: -429, y0: 45, zf: 300, z0: -190, outerW: 858, railLength: 500, rail: 'under' },
    ]);
    expect(hwOf(s, '0-w2', 'rail').map((h) => [h.at, h.len, h.tags.box, h.tags.side])).toEqual([
      [[-429, 350, -200], 500, 0, 'left'], [[429, 350, -200], 500, 0, 'right'],
      [[-429, 15, -200], 500, 1, 'left'], [[429, 15, -200], 500, 1, 'right'],
    ]);
    expect(hwOf(s, '0-w3', 'rail')).toEqual([expect.objectContaining({ pending: 'rail-box-unknown', qty: 1 })]);
    const design = { items: [FIXTURES.shoerack] };
    const bare = Asm.of(design, { materials: new MaterialExtractor().extract(design).materials, hardware: [] });
    expect(bare.items[0].modules.every((m) => m.hardware.length === 0)).toBe(true);
  });

  test.each([1, 2, 3])('붙박이장 내부 서랍장 %i단 레일 — 모듈 박스마다 왼·오 (innerDrawer), 박스 밑 30, 길이 450', (n) => {
    const item = JSON.parse(JSON.stringify(FIXTURES.wardrobe));
    Object.assign(item.modules.find((x) => x.id === 'w2'), { isExternalDrawer: false, drawerCount: n, wardrobe: { preset: 'longDrawer', drawers: n } });
    const design = { items: [item] };
    const s = Asm.of(design, { materials: new MaterialExtractor().extract(design).materials, hardware: new HardwareExtractor().extract(design).hardware });
    const w2 = s.items[0].modules.find((m) => m.moduleKey === '0-w2');
    const boxes = w2.parts.filter((p) => p.part === '서랍측판' && p.tags.side === 'left').map((p) => p.box);
    expect(boxes).toHaveLength(n);
    expect(w2.drawerBoxes.map((b) => [b.innerDrawer, b.rail, b.railLength, b.outerW, b.x0, b.zf, b.z0])).toEqual(boxes.map(() => [true, 'under', 450, 708, -354, 215, -225]));
    expect(hwOf(s, '0-w2', 'rail').map((h) => [h.at, h.len, h.pending])).toEqual(boxes.flatMap((b, i) => [
      [[-354, b.min[1] - 30, -235], 450, undefined], [[354, b.min[1] - 30, -235], 450, undefined],
    ]));
  });

  test('다리발 상수는 플래너 MASTER_RULES 와 같다 (drift 금지)', () => {
    const MR = require('../js/planner/planner-engine.js').MASTER_RULES;
    expect([Asm.CARCASS ? Asm.CARCASS.LEG_SIZE : require('../js/detaildesign/assembly-rules.js').CARCASS.LEG_SIZE,
      require('../js/detaildesign/assembly-rules.js').CARCASS.LEG_INSET]).toEqual([MR.LEG_SIZE, MR.LEG_INSET]);
  });
});
