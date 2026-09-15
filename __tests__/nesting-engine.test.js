/**
 * B4 네스팅 엔진 — js/detaildesign/nesting-engine.js `NestingEngine.plan`.
 *
 * 골든(test-utils/bom-golden/*.golden.json)의 materials 를 넣어 다음을 고정한다:
 *   - 결정성: 같은 입력(순서를 섞어도) → 같은 JSON
 *   - 수량 보존: 원판 대상 부재(양변 > 70)의 partId#k 가 정확히 한 번씩 놓인다 (미배치 포함)
 *   - 기하: 같은 시트에서 겹치지 않고, 트림 안쪽에 있고, 커프만큼 떨어져 있다
 *   - 옵션: 결 부재·회전 금지 자재는 rot=false, 자재별 원판 크기·트림·커프가 적용된다
 *   - 요약: sheetsByMaterial·sheetCount·totalYield 가 sheets 와 맞는다
 * 배치의 "좋고 나쁨"(장수·수율)은 여기서 보지 않는다 — 알고리즘이 바뀌면 값이 바뀌는 것이 정상이다.
 */
const fs = require('fs');
const path = require('path');
const NestingEngine = require('../js/detaildesign/nesting-engine.js');

const ROOT = path.join(__dirname, '..');
const golden = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'test-utils/bom-golden', `${name}.golden.json`), 'utf8')).materials;
const SINK = golden('sink15');

/** 원판 위 발자국 — rot 이면 h×w */
const foot = (p) => (p.rot ? { w: p.h, h: p.w } : { w: p.w, h: p.h });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 시트별 기하 검사 — 겹침 없음 · 트림 안쪽 · 커프 간격 */
function checkGeometry(plan) {
  const kerf = plan.kerf;
  plan.sheets.forEach((s) => {
    const rects = s.parts.map((p) => ({ id: p.partId, x: p.x, y: p.y, ...foot(p) }));
    const t = s.trim;
    rects.forEach((r) => {
      expect(r.x).toBeGreaterThanOrEqual(t);
      expect(r.y).toBeGreaterThanOrEqual(t);
      expect(r.x + r.w).toBeLessThanOrEqual(s.size.w - t);
      expect(r.y + r.h).toBeLessThanOrEqual(s.size.h - t);
    });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        expect(overlaps(a, b)).toBe(false);
        // 커프: 같은 스트립에서 나란한 조각은 x 또는 y 로 kerf 이상 떨어진다
        const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
        const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
        expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(kerf);
      }
    }
  });
}

/** 원판 대상 행(양변 > 70)의 partId#k 전개 */
function expectedInstances(materials) {
  const ids = [];
  materials.forEach((m, i) => {
    if (!(m.w > 70 && m.h > 70) || !(m.qty > 0)) return;
    const base = m.partId != null && m.partId !== '' ? String(m.partId) : `row-${i}`;
    for (let k = 0; k < Math.round(m.qty); k++) ids.push(`${base}#${k}`);
  });
  return ids.sort();
}

function placedInstances(plan) {
  const ids = [];
  plan.sheets.forEach((s) => s.parts.forEach((p) => ids.push(p.partId)));
  plan.unallocated.forEach((u) => u.partIds.forEach((id) => ids.push(id)));
  return ids.sort();
}

describe('NestingEngine.plan — 골든 자재 (sink15)', () => {
  const plan = NestingEngine.plan(SINK);

  test('출력 모양 — version 1, 기본 원판·커프·트림, sheets/offcuts/summary', () => {
    expect(plan.version).toBe(1);
    expect(plan.sheetSize).toEqual({ w: 1220, h: 2440 });
    expect(plan.kerf).toBe(4);
    expect(plan.trim).toBe(10);
    expect(plan.sheets.length).toBeGreaterThan(0);
    expect(Array.isArray(plan.offcuts)).toBe(true);
    plan.sheets.forEach((s, i) => {
      expect(s.no).toBe(i + 1);
      expect(typeof s.material).toBe('string');
      expect(s.size.w).toBeGreaterThan(0);
      expect(s.layout).toEqual(expect.objectContaining({ no: expect.any(Number), stack: expect.any(Number), dir: expect.stringMatching(/^[HV]$/) }));
      s.parts.forEach((p) => {
        expect(p).toEqual(expect.objectContaining({ partId: expect.any(String), w: expect.any(Number), h: expect.any(Number), x: expect.any(Number), y: expect.any(Number), rot: expect.any(Boolean), grain: expect.any(String) }));
      });
      expect(s.yield).toBeCloseTo(s.usedArea / (s.size.w * s.size.h), 3);
    });
  });

  test('결정성 — 같은 입력을 두 번, 순서를 뒤집어도 같은 JSON', () => {
    const a = JSON.stringify(NestingEngine.plan(SINK));
    const b = JSON.stringify(NestingEngine.plan(SINK));
    const c = JSON.stringify(NestingEngine.plan([...SINK].reverse()));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  test('수량 보존 — 원판 대상 partId#k 가 정확히 한 번씩 (배치 + 미배치)', () => {
    expect(placedInstances(plan)).toEqual(expectedInstances(SINK));
    // 미배치는 원판보다 큰 것뿐 (걸레받이 3500 · 상판 4130)
    plan.unallocated.forEach((u) => expect(Math.max(u.w, u.h)).toBeGreaterThan(1220 - 20));
    expect(plan.summary.partsPlaced + plan.summary.unallocatedCount).toBe(plan.summary.partsTotal);
  });

  test('소부품(≤70) 은 원판에 놓지 않고 smallParts 로 낸다', () => {
    const smallRows = SINK.filter((m) => m.w <= 70 || m.h <= 70);
    expect(plan.smallParts.length).toBe(smallRows.length);
    const placedIds = new Set(plan.sheets.flatMap((s) => s.parts.map((p) => NestingEngine.basePartId(p.partId))));
    smallRows.forEach((m) => expect(placedIds.has(m.partId)).toBe(false));
  });

  test('겹침 없음 · 트림 안쪽 · 커프 간격', () => {
    checkGeometry(plan);
  });

  test('요약 — sheetsByMaterial 합 = sheetCount = sheets.length, totalYield 는 면적 가중', () => {
    const sum = Object.values(plan.summary.sheetsByMaterial).reduce((s, n) => s + n, 0);
    expect(sum).toBe(plan.sheets.length);
    expect(plan.summary.sheetCount).toBe(plan.sheets.length);
    const used = plan.sheets.reduce((s, x) => s + x.usedArea, 0);
    const area = plan.sheets.reduce((s, x) => s + x.size.w * x.size.h, 0);
    expect(plan.summary.totalYield).toBeCloseTo(used / area, 3);
    // 그룹 집계와 시트가 맞는다
    plan.groups.forEach((g) => {
      const n = plan.sheets.filter((s) => s.material === g.material && s.thickness === g.thickness && s.partClass === g.partClass).length;
      expect(g.sheetCount).toBe(n);
    });
  });

  test('겹침 재단 — 같은 layout.no 시트는 배치가 같고 partId 만 다르다', () => {
    const byLayout = new Map();
    plan.sheets.forEach((s) => {
      const k = `${s.material}|${s.thickness}|${s.partClass}|${s.layout.no}`;
      if (!byLayout.has(k)) byLayout.set(k, []);
      byLayout.get(k).push(s);
    });
    let stacked = 0;
    byLayout.forEach((list) => {
      expect(list.length).toBe(list[0].layout.stack);
      if (list.length < 2) return;
      stacked += 1;
      const geom = (s) => s.parts.map((p) => [p.x, p.y, p.w, p.h, p.rot].join(',')).join(';');
      list.forEach((s) => expect(geom(s)).toBe(geom(list[0])));
      const ids = new Set(list.flatMap((s) => s.parts.map((p) => p.partId)));
      expect(ids.size).toBe(list.reduce((n, s) => n + s.parts.length, 0));
    });
    expect(stacked).toBeGreaterThan(0);
  });

  test('offcuts 는 시트 안쪽이고 어떤 조각과도 겹치지 않으며 free ≥ 60', () => {
    const bySheet = new Map(plan.sheets.map((s) => [s.no, s]));
    plan.offcuts.forEach((o) => {
      const s = bySheet.get(o.sheetNo);
      expect(s).toBeDefined();
      expect(o.free).toBeGreaterThanOrEqual(60);
      expect(o.x + o.w).toBeLessThanOrEqual(s.size.w - s.trim + 1e-6);
      expect(o.y + o.h).toBeLessThanOrEqual(s.size.h - s.trim + 1e-6);
      s.parts.forEach((p) => expect(overlaps(o, { x: p.x, y: p.y, ...foot(p) })).toBe(false));
    });
  });
});

describe('NestingEngine.plan — 다른 골든에서도 보존·기하가 지켜진다', () => {
  test.each(['sink18', 'sinkCorner', 'wardrobe', 'fridge'])('%s', (name) => {
    const mats = golden(name);
    const plan = NestingEngine.plan(mats);
    expect(placedInstances(plan)).toEqual(expectedInstances(mats));
    checkGeometry(plan);
    expect(JSON.stringify(NestingEngine.plan([...mats].reverse()))).toBe(JSON.stringify(plan));
  });
});

describe('NestingEngine.plan — 옵션', () => {
  const rows = [
    { partId: 'a', part: '측판', material: 'PB', thickness: 15, w: 500, h: 700, qty: 3 },
    { partId: 'b', part: '도어', material: '무늬목', thickness: 18, w: 400, h: 900, qty: 2 },
    { partId: 'c', part: '선반', material: 'PB', thickness: 15, w: 500, h: 300, qty: 2, grain: 'v' },
  ];

  test('결 부재(grain)·회전 금지 자재(무늬목)는 rot=false, 나머지는 회전할 수 있다', () => {
    const plan = NestingEngine.plan(rows);
    plan.sheets.forEach((s) => s.parts.forEach((p) => {
      const base = NestingEngine.basePartId(p.partId);
      if (base === 'b' || base === 'c') {
        expect(p.rot).toBe(false);
        expect(p.grain).not.toBe('none');
      }
    }));
    expect(NestingEngine.rotatableOf({ material: '무늬목' })).toBe(false);
    expect(NestingEngine.rotatableOf({ material: 'PET(우드)' })).toBe(false);
    expect(NestingEngine.rotatableOf({ material: 'PET' })).toBe(true);
    expect(NestingEngine.rotatableOf({ material: 'PB', grain: 'none' })).toBe(true);
    expect(NestingEngine.rotatableOf({ material: 'PB', grain: 'h' })).toBe(false);
    expect(NestingEngine.rotatableOf({ material: 'PB', rotatable: false })).toBe(false);
  });

  test('회전을 다 막으면 어떤 조각도 rot 가 없고, 발자국은 BOM 치수 그대로다', () => {
    const plan = NestingEngine.plan(rows, { noRotateMaterials: [/./] });
    const parts = plan.sheets.flatMap((s) => s.parts);
    expect(parts.length).toBe(7);
    parts.forEach((p) => expect(p.rot).toBe(false));
    const a = parts.find((p) => p.partId === 'a#0');
    expect([a.w, a.h]).toEqual([500, 700]);
  });

  test('자재별 원판 크기(sheetSizes) — 그룹마다 size 가 다르고 그 안에 들어간다', () => {
    const plan = NestingEngine.plan(rows, { sheetSizes: { 무늬목_18: { w: 1000, h: 2000 }, PB: { w: 1250, h: 2500 } } });
    const wood = plan.sheets.filter((s) => s.material === '무늬목');
    const pb = plan.sheets.filter((s) => s.material === 'PB');
    expect(wood.length).toBeGreaterThan(0);
    expect(pb.length).toBeGreaterThan(0);
    wood.forEach((s) => expect(s.size).toEqual({ w: 1000, h: 2000 }));
    pb.forEach((s) => expect(s.size).toEqual({ w: 1250, h: 2500 }));
    checkGeometry(plan);
  });

  test('트림 — 0 이면 조각이 모서리(0,0)에 붙고, 30 이면 30 안쪽부터', () => {
    const p0 = NestingEngine.plan(rows, { trim: 0 });
    const p30 = NestingEngine.plan(rows, { trim: 30 });
    expect(p0.trim).toBe(0);
    expect(Math.min(...p0.sheets.flatMap((s) => s.parts.map((p) => Math.min(p.x, p.y))))).toBe(0);
    expect(Math.min(...p30.sheets.flatMap((s) => s.parts.map((p) => Math.min(p.x, p.y))))).toBe(30);
    checkGeometry(p30);
  });

  test('커프 — 나란한 조각 사이 간격이 정확히 kerf 다', () => {
    const one = [{ partId: 'x', part: '선반', material: 'PB', thickness: 15, w: 300, h: 200, qty: 6 }];
    [4, 6].forEach((kerf) => {
      const plan = NestingEngine.plan(one, { kerf, trim: 0 });
      expect(plan.kerf).toBe(kerf);
      const s = plan.sheets[0];
      const strip1 = s.parts.filter((p) => p.strip === 1).sort((a, b) => (s.layout.dir === 'H' ? a.x - b.x : a.y - b.y));
      expect(strip1.length).toBeGreaterThan(1);
      for (let i = 1; i < strip1.length; i++) {
        const prev = strip1[i - 1], cur = strip1[i];
        const gap = s.layout.dir === 'H' ? cur.x - (prev.x + foot(prev).w) : cur.y - (prev.y + foot(prev).h);
        expect(gap).toBe(kerf);
      }
    });
  });

  test('원판보다 큰 부재는 unallocated 에 partIds·parts 와 함께 남는다', () => {
    const plan = NestingEngine.plan([{ partId: 'big', part: '상판', material: '인조대리석', thickness: 12, w: 4000, h: 600, qty: 1 }]);
    expect(plan.sheets).toEqual([]);
    expect(plan.unallocated).toEqual([expect.objectContaining({ partIds: ['big#0'], parts: ['상판'], qty: 1 })]);
    expect(plan.summary.sheetsByMaterial).toEqual({ '인조대리석_12': 0 });
  });

  test('partId 가 없는 행은 row-<index> 로, 잘못된 행(치수 0·qty 0)은 건너뛴다', () => {
    const plan = NestingEngine.plan([
      { part: '선반', material: 'PB', thickness: 15, w: 500, h: 300, qty: 1 },
      { part: '선반', material: 'PB', thickness: 15, w: 0, h: 300, qty: 1 },
      { part: '선반', material: 'PB', thickness: 15, w: 500, h: 300, qty: 0 },
      null,
    ]);
    expect(plan.sheets.flatMap((s) => s.parts.map((p) => p.partId))).toEqual(['row-0#0']);
  });

  test('partClassOf — 본체/도어/뒷판 (ai-design-report.js getPartType 과 같은 규칙)', () => {
    expect(NestingEngine.partClassOf('도어')).toBe('도어');
    expect(NestingEngine.partClassOf('서랍도어')).toBe('도어');
    expect(NestingEngine.partClassOf('뒷판')).toBe('뒷판');
    expect(NestingEngine.partClassOf('서랍밑판')).toBe('뒷판');
    expect(NestingEngine.partClassOf('상몰딩')).toBe('도어');
    expect(NestingEngine.partClassOf('걸레받이')).toBe('도어');
    expect(NestingEngine.partClassOf('측판')).toBe('본체');
    expect(NestingEngine.partClassOf('')).toBe('본체');
  });
});

describe('detaildesign.html — nesting-engine.js 를 ai-design-report.js·workflow-client.js 앞에 싣는다', () => {
  const html = fs.readFileSync(path.join(ROOT, 'detaildesign.html'), 'utf8');
  const srcs = [];
  const re = /<script([^>]*\ssrc\s*=\s*["']([^"']+)["'][^>]*)>/g;
  let m;
  while ((m = re.exec(html))) srcs.push(m[2]);
  const bare = srcs.map((s) => s.split('?')[0]);

  test('순서: data-constants → nesting-engine → ai-design-report → workflow-client, ?v= 붙어 있다', () => {
    const i0 = bare.indexOf('js/detaildesign/data-constants.js');
    const i1 = bare.indexOf('js/detaildesign/nesting-engine.js');
    const i2 = bare.indexOf('js/detaildesign/ai-design-report.js');
    const i3 = bare.indexOf('js/detaildesign/workflow-client.js');
    expect(i0).toBeGreaterThan(-1);
    expect(i1).toBeGreaterThan(i0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(srcs[i1]).toMatch(/\?v=\d+\.\d+/);
  });

  test('ai-design-report.js 는 옛 calcCuttingPlan 을 더 이상 정의하지 않는다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ai-design-report.js'), 'utf8');
    expect(src).not.toMatch(/function calcCuttingPlan\(/);
    expect(src).not.toMatch(/function designLayoutH\(/);
    expect(src).toMatch(/NestingEngine\.plan\(/);
  });

  test('workflow-client.js 는 스냅샷 POST 에 cutPlan 을 싣는다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/detaildesign/workflow-client.js'), 'utf8');
    expect(src).toMatch(/NestingEngine\.plan\(materials\)/);
    expect(src).toMatch(/body\.cutPlan = cutPlan/);
  });
});
