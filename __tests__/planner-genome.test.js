/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 설계 유전체 코어 — js/planner/planner-genome.js (자동완성 연구, 2026-10-25).
 *
 * 1. 변이 호출: 라이브러리 choice → (엔진 서랍 규칙으로 펼친) 플래너 구조 → 대립유전자 가 choice 에서 바로 낸 것과 같다
 * 2. 유전체: 배치 공간별 x 순서 · 마감재 제외 · 개수대 앵커 · 키큰장 단 묶음 · 전역 설정
 * 3. 미러(Z₂): σ∘σ = 항등, 경첩 상대값은 미러에 변하지 않는다
 * 4. LD: 손으로 계산한 값, D = 2×2 소행렬식
 * 5. 반환: 전방 계산(sum · max · count · k-best)이 사건 경로 전수 탐색과 같다
 * 6. 임퓨테이션: 사후확률 합 1, 본인 가중 λ, 관측 자리 보존, allow 거르기
 */
const G = require('../js/planner/planner-genome.js');
const DrawerRules = require('../js/detaildesign/bom-drawer-rules.js');

// 라이브러리 lib/library.js structureOf 와 같은 펼침 (서랍 등급은 엔진 gradesFromRatio 가 낸다)
function cell(W, dir, is2D) {
  return { moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaDirections: [dir], areaWidths: [W], areaIs2D: [!!is2D] };
}
function drawerOf(d) {
  const r = DrawerRules.gradesFromRatio(d.ratio, { topDrawer: true });
  return {
    horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerCount: r.drawerCount,
    drawer: { rail: d.rail === 'ball' ? 'ball' : 'under', sakuri: !!d.sakuri, boxT: d.boxT === 18 ? 18 : 0, grades: r.grades, doorGrade: r.doorGrade, topDrawer: true },
  };
}
function structureOf(W, c) {
  const hinge = c.hinge === 'right' || c.hinge === 'up' ? c.hinge : 'left';
  const s = Object.assign(cell(W, hinge, c.doors === 2), { moduleKind: c.kind === 'open' ? 'open' : 'normal' });
  if (c.drawer) Object.assign(s, drawerOf(c.drawer));
  return s;
}
function tallTiers(W, t) {
  const tiers = { lower: t.lower || 'door', middle: t.middle || 'door', upper: t.upper || 'door' };
  const swing = t.hinge === 'right' ? 'right' : 'left';
  return ['lower', 'middle', 'upper'].map((k) => {
    const kind = tiers[k];
    if (kind === 'flap') return cell(W, 'up', false);
    if (kind === 'door') return cell(W, swing, false);
    if (kind === 'drawer') return Object.assign(cell(W, 'left', false), drawerOf({ ratio: '2:2', rail: 'under', sakuri: true }), { shelves: [] });
    if (kind === 'open') return Object.assign(cell(W, 'left', false), { moduleKind: 'open', shelves: [] });
    return Object.assign(cell(W, t.riceDoor === 'swing' ? swing : 'left', false), { moduleKind: 'rice', rice: { door: t.riceDoor }, shelves: [] });
  });
}

describe('변이 호출 — choice 와 구조가 같은 대립유전자', () => {
  const plain = [
    [450, { doors: 1, hinge: 'left' }, 'D1/L'],
    [450, { doors: 1, hinge: 'right' }, 'D1/R'],
    [450, { doors: 1, hinge: 'up' }, 'D1/U'],
    [900, { doors: 2 }, 'D2'],
    [450, { kind: 'open' }, 'OPEN'],
    [600, { drawer: { ratio: '2:1:1', rail: 'ball', sakuri: true, boxT: 18 } }, 'DR:2:1:1|ball|18|sk'],
    [600, { drawer: { ratio: '2:2', sakuri: true } }, 'DR:2:2|under|0|sk'],
    [600, { drawer: { ratio: '1:1:2', sakuri: true } }, 'DR:1:1:2|under|0|sk'],
  ];
  test.each(plain)('W%s %j → %s', (W, choice, sig) => {
    expect(G.plannerGenomeChoiceAllele(choice).sig).toBe(sig);
    expect(G.plannerGenomeAlleleOf({ W }, structureOf(W, choice)).sig).toBe(sig);
  });

  const tall = [
    [{ hinge: 'left' }, 'T:DDD/L'],
    [{ hinge: 'right', lower: 'drawer', middle: 'rice', upper: 'door', riceDoor: 'swing' }, 'T:SRD-SW/R'],
    [{ lower: 'drawer', middle: 'rice', upper: 'flap', riceDoor: 'liftup' }, 'T:SRF-LF'],
    [{ lower: 'drawer', middle: 'open', upper: 'open' }, 'T:SOO'],
    [{ hinge: 'left', lower: 'drawer', middle: 'rice', upper: 'open', riceDoor: 'none' }, 'T:SRO'],
  ];
  test.each(tall)('키큰장 %j → %s', (t, sig) => {
    expect(G.plannerGenomeChoiceAllele({ tall: t }).sig).toBe(sig);
    expect(G.plannerGenomeTallAlleleOf(tallTiers(600, t)).sig).toBe(sig);
  });

  test('라이브러리 색인 — section|W|sig → id', () => {
    const idx = G.plannerGenomeLibraryIndex([{ id: 'LB-D1-450-L', section: 'lower', W: 450, choice: { doors: 1, hinge: 'left' } }]);
    expect(idx.get('lower|450|D1/L')).toBe('LB-D1-450-L');
  });

  test('도어 위 + 서랍 아래는 위 도어 비율과 경첩을 갖는다', () => {
    const s = Object.assign(cell(600, 'right', false), { horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerCount: 2, drawer: { grades: ['small', 'auto'], doorGrade: 'large', topDrawer: false } });
    expect(G.plannerGenomeAlleleOf({ W: 600 }, s).sig).toBe('DD:2:1:2|under|0|nosk/R');
  });
});

describe('유전체 — 설계 한 건', () => {
  const design = {
    user: 'u1', id: 'd1',
    modules: [
      { id: 'lower-2', areaId: 'area-lower-0', section: 'lower', x: 1350, W: 600 },
      { id: 'lower-0', areaId: 'area-lower-0', section: 'lower', x: 0, W: 450 },
      { id: 'lower-1', areaId: 'area-lower-0', section: 'lower', x: 450, W: 900 },
      { id: 'ep-0', areaId: 'area-lower-0', section: 'ep', x: 1950, W: 20, isFinishing: true },
      { id: 'sink-0', areaId: 'area-sink-0', section: 'sink', x: 500, W: 700 },
      { id: 'tall-0', areaId: 'area-tall-0', section: 'tall', x: 3000, W: 600, baseY: 0, part: '하부장' },
      { id: 'tall-2', areaId: 'area-tall-0', section: 'tall', x: 3000, W: 600, baseY: 1400, part: '상부장' },
      { id: 'tall-1', areaId: 'area-tall-0', section: 'tall', x: 3000, W: 600, baseY: 900, part: '중간장' },
    ],
    structures: {
      'lower-0': Object.assign(cell(450, 'left'), { handleType: 'wood-channel', legH: 150 }),
      'lower-1': Object.assign(cell(900, 'left', true), { handleType: 'wood-channel', legH: 150 }),
      'lower-2': Object.assign(structureOf(600, { drawer: { ratio: '2:1:1', rail: 'ball', sakuri: true } }), { handleType: 'push', legH: 150 }),
    },
  };
  const tt = tallTiers(600, { hinge: 'right', lower: 'drawer', middle: 'rice', upper: 'door', riceDoor: 'swing' });
  design.structures['tall-0'] = tt[0];
  design.structures['tall-1'] = tt[1];
  design.structures['tall-2'] = tt[2];
  const g = G.plannerGenomeOf(design);

  test('배치 공간별 라인 — 가전 자리·마감재는 좌위가 아니다', () => {
    expect(g.lines.map((l) => l.key)).toEqual(['area-lower-0', 'area-tall-0']);
    const lower = g.lines[0];
    expect(lower.loci.map((l) => l.allele.sig)).toEqual(['D1/L', 'D2', 'DR:2:1:1|ball|0|sk']);
    expect(lower.loci.map((l) => l.ids[0])).toEqual(['lower-0', 'lower-1', 'lower-2']);
  });

  test('개수대 앵커와 개수대 기준 위치', () => {
    const lower = g.lines[0];
    // 개수대 자리 표시 x 500~1200 은 가운데 모듈(450~1350)과만 겹친다
    expect(lower.loci.map((l) => l.anchors)).toEqual([[], ['sink'], []]);
    expect(lower.loci.map((l) => l.fromSink)).toEqual([-1, 0, 1]);
  });

  test('개수대 자리 표시는 하부 라인에만, 후드 자리 표시는 상부 라인에만 앵커다', () => {
    const g2 = G.plannerGenomeOf({
      modules: [
        { id: 'lower-0', areaId: 'area-lower-0', section: 'lower', x: 0, W: 900 },
        { id: 'upper-0', areaId: 'area-upper-0', section: 'upper', x: 0, W: 900 },
        { id: 'sink-0', areaId: 'area-sink-0', section: 'sink', x: 100, W: 700 },
        { id: 'hood-0', areaId: 'area-hood-0', section: 'hood', x: 0, W: 900 },
      ],
      structures: { 'lower-0': cell(900, 'left', true), 'upper-0': cell(900, 'left', true) },
    });
    const by = Object.fromEntries(g2.lines.map((l) => [l.section, l.loci[0].anchors]));
    expect(by).toEqual({ lower: ['sink'], upper: ['hood'] });
  });

  test('키큰장 단 셋 = 좌위 하나, 아래 단부터', () => {
    const tall = g.lines[1];
    expect(tall.loci).toHaveLength(1);
    expect(tall.loci[0].ids).toEqual(['tall-0', 'tall-1', 'tall-2']);
    expect(tall.loci[0].allele.sig).toBe('T:SRD-SW/R');
  });

  test('전역 설정 = 가장 흔한 값', () => {
    expect(g.globals).toEqual({ handleType: 'wood-channel', legH: 150 });
  });
});

describe('미러 — Z₂ 군 작용', () => {
  const locus = (sig, hinge, x, fromSink) => ({ x, W: 450, allele: { type: sig.split('/')[0], hinge, sig }, anchors: [], fixed: false, fromSink });
  const line = { key: 'a', section: 'lower', loci: [locus('D1/L', 'left', 0, -1), locus('D2', null, 450, 0), locus('D1/R', 'right', 1350, 1), locus('OPEN', null, 1800, 2)] };
  line.loci.forEach((l, i) => { l.i = i; l.n = 4; });

  test('σ∘σ = 항등', () => {
    const back = G.plannerGenomeMirrorLine(G.plannerGenomeMirrorLine(line));
    expect(back.loci.map((l) => l.allele.sig)).toEqual(line.loci.map((l) => l.allele.sig));
    expect(back.loci.map((l) => l.fromSink)).toEqual(line.loci.map((l) => l.fromSink));
  });

  test('미러는 순서를 뒤집고 경첩을 바꾼다', () => {
    expect(G.plannerGenomeMirrorLine(line).loci.map((l) => l.allele.sig)).toEqual(['OPEN', 'D1/L', 'D2', 'D1/R']);
  });

  test('궤도 대표는 라인과 미러 중 하나로 정해진다', () => {
    const a = G.plannerGenomeCanonicalLine(line).line.loci.map((l) => l.allele.sig).join(' ');
    const b = G.plannerGenomeCanonicalLine(G.plannerGenomeMirrorLine(line)).line.loci.map((l) => l.allele.sig).join(' ');
    expect(a).toBe(b);
  });

  test('경첩 상대값(벽 쪽 · 개수대 쪽)은 미러에 변하지 않는다', () => {
    const mir = G.plannerGenomeMirrorLine(line);
    line.loci.forEach((l, i) => {
      expect(G.plannerGenomeHingeRel(mir.loci[3 - i])).toEqual(G.plannerGenomeHingeRel(l));
    });
    expect(G.plannerGenomeHingeRel(line.loci[0])).toEqual({ wall: 'wall', sink: 'away' });
  });
});

describe('LD — D 는 2×2 소행렬식', () => {
  test('손으로 계산한 값 (40·10·10·40)', () => {
    const r = G.plannerGenomeLD(40, 10, 10, 40);
    expect(r.D).toBeCloseTo(0.15, 12);           // 0.4·0.4 − 0.1·0.1
    expect(r.D).toBeCloseTo(0.4 - 0.5 * 0.5, 12); // p11 − pA·pB
    expect(r.Dprime).toBeCloseTo(0.6, 12);
    expect(r.r2).toBeCloseTo(0.36, 12);
  });
  test('독립이면 0', () => {
    expect(G.plannerGenomeLD(25, 25, 25, 25).D).toBe(0);
  });
});

describe('Balding–Nichols 축소', () => {
  const own = new Map([['DR', 3]]);
  const all = new Map([['DR', 10], ['D1/L', 90]]);
  test('합 1', () => {
    const p = G.plannerGenomeShrink(own, all, 0.2);
    expect([...p.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
  test('F 가 크면 본인, 작으면 전체를 따른다', () => {
    expect(G.plannerGenomeShrink(own, all, 0.999).get('DR')).toBeGreaterThan(0.99);
    expect(G.plannerGenomeShrink(own, all, 0.001).get('DR')).toBeCloseTo(0.1, 2);
  });
});

// ── 반환: 작은 모형에서 사건 경로를 전부 센다 ──
function tinyModel() {
  const L = (sig, W, anchors) => ({ W, anchors: anchors || [], allele: { sig, type: sig, hinge: null } });
  const query = { section: 'lower', loci: [L('D1/L', 450, ['sink']), { W: 600, anchors: [], allele: null }, { W: 450, anchors: [], allele: null }] };
  const panel = [
    { own: true, line: { section: 'lower', loci: [L('D1/L', 450, ['sink']), L('DR', 600), L('OPEN', 450)] } },
    { own: false, line: { section: 'lower', loci: [L('D2', 900), L('D1/R', 450)] } },
  ];
  return G.plannerGenomeModel(query, panel, { delta: 0.1 });
}
function bruteEventPaths(model) {
  const S = model.states.length, n = model.n;
  const out = [];
  const walk = (i, s, score) => {
    if (i === n - 1) { out.push(score); return; }
    for (let t = 0; t < S; t++) {
      model.logTParts(i + 1, s, t).forEach((p) => walk(i + 1, t, score + p + model.logE(i + 1, t)));
    }
  };
  for (let s = 0; s < S; s++) walk(0, s, model.logInit(s) + model.logE(0, s));
  return out.filter((v) => v > -Infinity);
}

describe('반환 — 전방 계산 = 전수 탐색', () => {
  const model = tinyModel();
  const paths = bruteEventPaths(model);

  test('sum: 전체 우도', () => {
    const z = paths.reduce((a, v) => (a === -Infinity ? v : Math.max(a, v) + Math.log(Math.exp(a - Math.max(a, v)) + Math.exp(v - Math.max(a, v)))), -Infinity);
    expect(G.plannerGenomeForward(model, G.PLANNER_GENOME_SEMIRING.sum).total).toBeCloseTo(z, 9);
  });
  test('max(열대): 최적 경로 점수', () => {
    expect(G.plannerGenomeForward(model, G.PLANNER_GENOME_SEMIRING.max).total).toBeCloseTo(Math.max(...paths), 9);
  });
  test('count: 경로 수', () => {
    expect(G.plannerGenomeForward(model, G.PLANNER_GENOME_SEMIRING.count).total).toBe(paths.length);
  });
  test('k-best: 상위 5개 점수, k=1 은 max 와 같다', () => {
    const top = paths.slice().sort((a, b) => b - a).slice(0, 5);
    const kb = G.plannerGenomeForward(model, G.plannerGenomeKBest(5)).total;
    expect(kb.map((c) => c.s)).toEqual(top.map((v) => expect.closeTo(v, 9)));
    expect(kb[0].path).toHaveLength(model.n);
    expect(G.plannerGenomeForward(model, G.plannerGenomeKBest(1)).total[0].s).toBeCloseTo(Math.max(...paths), 9);
  });
  test('후방 계산과 전방 계산의 우도가 같다', () => {
    const fw = G.plannerGenomeForward(model, G.PLANNER_GENOME_SEMIRING.sum);
    const beta = G.plannerGenomeBackward(model);
    let z = -Infinity;
    model.states.forEach((_, s) => {
      const v = model.logInit(s) + model.logE(0, s) + beta[0][s];
      const m = Math.max(z, v);
      z = z === -Infinity ? v : m + Math.log(Math.exp(z - m) + Math.exp(v - m));
    });
    expect(z).toBeCloseTo(fw.total, 9);
  });
});

describe('임퓨테이션', () => {
  const L = (sig, W, anchors) => ({ W, anchors: anchors || [], fixed: false, allele: { sig, type: sig.split('/')[0], hinge: null } });
  const ownLine = { section: 'lower', loci: [L('D1/L', 450, ['sink']), L('DR:2:1:1|ball|0|sk', 600), L('OPEN', 450)] };
  const otherLine = { section: 'lower', loci: [L('D1/L', 450, ['sink']), L('D1/R', 600), L('D1/L', 450)] };
  const query = { section: 'lower', loci: [L('D1/L', 450, ['sink']), { W: 600, anchors: [], allele: null }, { W: 450, anchors: [], allele: null }] };

  test('사후확률 분포는 합 1, 관측 자리는 그대로', () => {
    const r = G.plannerGenomeImpute(query, [{ own: true, line: ownLine }, { own: false, line: otherLine }]);
    r.loci.filter((l) => !l.observed).forEach((l) => {
      expect(l.dist.reduce((a, d) => a + d.p, 0)).toBeCloseTo(1, 9);
    });
    expect(r.loci[0]).toMatchObject({ observed: 'D1/L', suggest: false });
    r.completions.forEach((c) => expect(c.sigs[0]).toBe('D1/L'));
  });

  test('본인 가중 λ 가 크면 본인 패턴을, 작으면 다른 사용자 패턴을 제안한다', () => {
    const panel = [{ own: true, line: ownLine }, { own: false, line: otherLine }, { own: false, line: otherLine }];
    expect(G.plannerGenomeImpute(query, panel, { lambda: 0.9 }).loci[1].best).toBe('DR:2:1:1|ball|0|sk');
    expect(G.plannerGenomeImpute(query, panel, { lambda: 0.1 }).loci[1].best).toBe('D1/R');
  });

  test('상위 완성은 서로 다른 대립유전자 열이고 최고안이 사후 최빈과 맞는다', () => {
    const r = G.plannerGenomeImpute(query, [{ own: true, line: ownLine }, { own: false, line: otherLine }], { lambda: 0.9, k: 3 });
    const keys = r.completions.map((c) => c.sigs.join(' '));
    expect(new Set(keys).size).toBe(keys.length);
    expect(r.completions[0].sigs.slice(1)).toEqual([r.loci[1].best, r.loci[2].best]);
  });

  test('allow 가 막은 값은 제안하지 않는다 (엔진 금지 조합은 부르는 쪽이 넘긴다)', () => {
    const r = G.plannerGenomeImpute(query, [{ own: true, line: ownLine }], { allow: (q, sig) => sig !== 'OPEN' });
    expect(r.loci[2].dist.map((d) => d.sig)).not.toContain('OPEN');
    r.completions.forEach((c) => expect(c.sigs[2]).not.toBe('OPEN'));
  });

  test('패널이 비면 제안이 없다', () => {
    const r = G.plannerGenomeImpute(query, []);
    expect(r.loci.every((l) => !l.suggest)).toBe(true);
  });

  test('섹션이 다른 참조는 쓰지 않는다', () => {
    const upper = { section: 'upper', loci: [L('D2', 600)] };
    expect(G.plannerGenomeModel(query, [{ line: upper }]).states).toHaveLength(0);
  });
});

describe('속성 완성 · 전역 기본값', () => {
  test('머리가 같은 대립유전자만, 축소된 분포', () => {
    const own = new Map([['DR:2:1:1|ball|0|sk', 4], ['D1/L', 9]]);
    const all = new Map([['DR:2:2|under|0|sk', 50], ['DR:2:1:1|ball|0|sk', 5], ['D1/L', 100]]);
    const r = G.plannerGenomeSuggestAttrs('DR', own, all, 0.5);
    expect(r.map((x) => x.sig)).toEqual(['DR:2:1:1|ball|0|sk', 'DR:2:2|under|0|sk']);
    expect(r.reduce((a, x) => a + x.p, 0)).toBeCloseTo(1, 12);
  });
  test('전역 기본값 — 본인 값이 많으면 본인 쪽', () => {
    const g = (handleType, w) => ({ weight: w || 1, globals: { handleType } });
    const own = [g('push'), g('push'), g('push')];
    const all = own.concat([g('wood-channel'), g('wood-channel'), g('wood-channel'), g('wood-channel')]);
    expect(G.plannerGenomeSuggestGlobals(own, all, 0.5).handleType.best).toBe('push');
  });
});
