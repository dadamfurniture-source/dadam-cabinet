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

  test('미정은 unplaced 에 이유와 함께 — 밴드 자리 · 서랍장 처짐방지목(D2) · 서랍장 중간 따내기', () => {
    const reasons = (id) => spec.unplaced.filter((u) => u.rowPartId.indexOf(`0-${id}-`) === 0);
    expect(reasons('l3').filter((u) => u.part === '밴드').map((u) => u.reason)).toEqual(['band-position-pending']);
    expect(reasons('u1').filter((u) => u.part === '밴드(보강목)').map((u) => u.reason)).toEqual(['band-position-pending']);
    expect(reasons('l2').find((u) => u.part === '밴드(처짐방지)').reason).toBe('pending-owner D2');
    expect(mod('l2').pending).toContain('channel-mid-notch');
  });

  test('선반 높이를 안 주면 선반은 놓지 않는다 (지어내지 않는다)', () => {
    const design = { items: [FIXTURES.sink15] };
    const bare = Asm.of(design);
    expect(allParts(bare).some((p) => p.part === '선반')).toBe(false);
    expect(bare.unplaced.filter((u) => u.part === '선반').every((u) => u.reason === 'shelf-height-unknown')).toBe(true);
  });
});

test('sink18 — 몸통 18T 가 자리에도 들어간다', () => {
  const { spec } = specOf('sink18');
  const m = spec.items[0].modules.find((x) => x.moduleId === 'l3');
  expect(m.box.T).toBe(18);
  const right = m.parts.filter((p) => p.part === '측판')[1];
  expect(right.box.min[0]).toBe(m.box.W / 2 - 18);
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
