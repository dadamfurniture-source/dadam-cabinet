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
 *
 * 재단 방식 (2026-11-17 사장님 — opts.strategy · opts.colorOf):
 *   - 옵션이 없으면 결과가 그대로다 (고정 입력 지문 · 새 칸 없음)
 *   - 방식마다 보존 · 기하 · 결정성, 자르는 횟수 = cutCount, 표준은 모든 원판이 긴 변 먼저
 *   - 묶음마다: 부재 최적화 원판 ≤ 표준 · 최소 재단 원판 ≤ 표준 + 1 · 최소 재단 횟수 ≤ 표준
 *   - 색이 다른 판은 한 원판에 섞이지 않고, summary.sheetsByMaterial 키는 `자재_두께` 그대로다
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
    if (NestingEngine.isOutsourcedTop(m)) return; // 석재 상판은 skipped (2026-11-05)
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
    // 석재 상판은 배치하지 않고 skipped — 원판 대상 + skipped = 전부
    expect(plan.skipped.map((s) => s.partId)).toEqual(SINK.filter((m) => NestingEngine.isOutsourcedTop(m)).map((m) => m.partId));
    // 미배치는 원판보다 큰 것뿐 (걸레받이 3500)
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
    const plan = NestingEngine.plan([{ partId: 'big', part: '상판', material: 'MDF', thickness: 18, w: 4000, h: 600, qty: 1 }]);
    expect(plan.sheets).toEqual([]);
    expect(plan.unallocated).toEqual([expect.objectContaining({ partIds: ['big#0'], parts: ['상판'], qty: 1 })]);
    expect(plan.summary.sheetsByMaterial).toEqual({ 'MDF_18': 0 });
  });

  test('석재 상판(인조대리석 · 엔지니어드 스톤 · 세라믹)은 배치하지 않고 skipped 로 — 상판 업체 발주 (2026-11-05)', () => {
    const plan = NestingEngine.plan([
      { partId: 'top-a', slot: 'top', part: '상판', material: '인조대리석', thickness: 12, w: 1000, h: 650, qty: 1 },
      { partId: 'top-b', part: '상판', material: '세라믹', thickness: 12, w: 1050, h: 650, qty: 1 },
      { partId: 'top-c', slot: 'top', part: '상판', material: '엔지니어드 스톤', thickness: 20, w: 4000, h: 650, qty: 1 },
      { partId: 'top-m', slot: 'top', part: '상판', material: 'MDF', thickness: 18, w: 1000, h: 600, qty: 1 },
    ]);
    expect(plan.skipped.map((s) => [s.partId, s.reason])).toEqual([['top-a', 'outsourced-top'], ['top-b', 'outsourced-top'], ['top-c', 'outsourced-top']]);
    expect(plan.summary.skippedCount).toBe(3);
    expect(plan.unallocated).toEqual([]);
    expect(plan.sheets.flatMap((s) => s.parts.map((p) => p.partId))).toEqual(['top-m#0']);
    expect(NestingEngine.isOutsourcedTop({ part: '측판', material: '인조대리석' })).toBe(false);
  });

  test('5T 이상 뒷판은 같은 두께 몸통 판과 한 원장 — 얇은 뒷판 · 서랍밑판은 그대로 따로 (2026-11-05)', () => {
    const plan = NestingEngine.plan([
      { partId: 'side', part: '측판', material: 'MDF', thickness: 18, w: 550, h: 500, qty: 2 },
      { partId: 'back18', part: '뒷판', material: 'MDF', thickness: 18, w: 414, h: 200, qty: 1 },
      { partId: 'back3', part: '뒷판', material: 'MDF', thickness: 3, w: 970, h: 705, qty: 1 },
    ]);
    const classes = plan.sheets.map((s) => [s.material, s.thickness, s.partClass, s.parts.map((p) => p.partId).sort().join(',')]);
    expect(classes).toEqual([
      ['MDF', 3, '뒷판', 'back3#0'],
      ['MDF', 18, '본체', 'back18#0,side#0,side#1'],
    ]);
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
    // 두께 — 5T 이상 뒷판은 몸통 (오픈 상자 · 밥솥장 18T 뒷판), 두께를 모르면 이름만
    expect(NestingEngine.partClassOf('뒷판', 3)).toBe('뒷판');
    expect(NestingEngine.partClassOf('서랍밑판', 3)).toBe('뒷판');
    expect(NestingEngine.partClassOf('뒷판', 18)).toBe('본체');
    expect(NestingEngine.partClassOf('뒷판', 15)).toBe('본체');
    expect(NestingEngine.partClassOf('도어', 18)).toBe('도어');
  });
});

// ── 재단 방식 (2026-11-17 사장님 「재단은 총 3가지 중 선택」) ─────────────────────

const ALL_GOLDENS = ['sink15', 'sink18', 'sinkCorner', 'wardrobe', 'fridge', 'shoerack', 'storage', 'vanity', 'warehouse'];
const STRATEGY_IDS = NestingEngine.STRATEGIES.map((s) => s.id);
const sha = (o) => require('crypto').createHash('sha256').update(JSON.stringify(o)).digest('hex');
/** 겹침 묶음 열쇠 — 자재 · 두께 · 구분 · 배치 번호 */
const layoutKey = (s) => `${s.material}|${s.thickness}|${s.partClass}|${s.layout.no}`;

/** 고정 입력 — 골든(BOM 규칙이 바뀌면 같이 바뀐다)과 따로 둔다 */
const FIXTURE = [
  { partId: 's1', part: '측판', material: 'PB', thickness: 15, w: 560, h: 720, qty: 8 },
  { partId: 's2', part: '지판', material: 'PB', thickness: 15, w: 870, h: 560, qty: 4 },
  { partId: 's3', part: '선반', material: 'PB', thickness: 15, w: 866, h: 520, qty: 6 },
  { partId: 's4', part: '밴드', material: 'PB', thickness: 15, w: 870, h: 80, qty: 8 },
  { partId: 's5', part: '보강목', material: 'PB', thickness: 15, w: 870, h: 60, qty: 4 },
  { partId: 's6', part: '칸막이', material: 'PB', thickness: 15, w: 450, h: 690, qty: 3 },
  { partId: 'd1', part: '도어', material: 'MDF', thickness: 18, w: 446, h: 716, qty: 6 },
  { partId: 'd2', part: '서랍도어', material: 'MDF', thickness: 18, w: 596, h: 236, qty: 3 },
  { partId: 'd3', part: '걸레받이', material: 'MDF', thickness: 18, w: 2390, h: 150, qty: 1 },
  { partId: 'b1', part: '뒷판', material: 'MDF', thickness: 3, w: 880, h: 705, qty: 4 },
  { partId: 'b2', part: '서랍밑판', material: 'MDF', thickness: 3, w: 540, h: 480, qty: 3 },
  { partId: 't1', slot: 'top', part: '상판', material: '인조대리석', thickness: 12, w: 2700, h: 600, qty: 1 },
];
const NEW_SHEET_KEYS = ['cuts', 'color'];
const NEW_GROUP_KEYS = ['color', 'cutCount', 'layoutCount', 'standard', 'searched'];
const OLD_SUMMARY_KEYS = ['sheetsByMaterial', 'sheetCount', 'totalYield', 'partsTotal', 'partsPlaced', 'smallCount', 'unallocatedCount', 'skippedCount'];

describe('재단 방식 — 옵션이 없으면 지금 결과 그대로', () => {
  test('고정 입력의 기본 호출 지문 — 재단 방식을 더하기 전 엔진과 같다', () => {
    // 2026-11-17 재단 방식을 더하기 전 엔진(origin/main 43b7bfa)으로 낸 값. 기본 알고리즘을 일부러 바꿀 때만 고친다
    expect(sha(NestingEngine.plan(FIXTURE))).toBe('1e7d649d525572d09574e29e3752787c9325df068fddc74df1db983435ea62b1');
  });

  test.each(ALL_GOLDENS)('%s — 새 칸(strategy · cuts · color · sheetsByColor …)이 붙지 않는다', (name) => {
    const plan = NestingEngine.plan(golden(name));
    expect(plan).not.toHaveProperty('strategy');
    expect(Object.keys(plan.summary)).toEqual(OLD_SUMMARY_KEYS);
    plan.sheets.forEach((s) => NEW_SHEET_KEYS.forEach((k) => expect(s).not.toHaveProperty(k)));
    plan.groups.forEach((g) => NEW_GROUP_KEYS.forEach((k) => expect(g).not.toHaveProperty(k)));
    // strategy 를 비워 넘겨도 기본 호출과 같다
    expect(JSON.stringify(NestingEngine.plan(golden(name), { strategy: undefined, colorOf: null }))).toBe(JSON.stringify(plan));
  });

  test('STRATEGIES — 표준 · 부재 최적화 · 최소 재단, 모르는 방식은 오류', () => {
    expect(NestingEngine.STRATEGIES.map((s) => [s.id, s.label])).toEqual([['standard', '표준'], ['material', '부재 최적화'], ['cuts', '최소 재단']]);
    expect(() => NestingEngine.plan(FIXTURE, { strategy: 'fastest' })).toThrow(RangeError);
  });
});

describe.each(STRATEGY_IDS)('재단 방식 %s — 보존 · 기하 · 결정성 · 자르는 횟수', (strategy) => {
  test.each(ALL_GOLDENS)('%s', (name) => {
    const mats = golden(name);
    const plan = NestingEngine.plan(mats, { strategy });
    expect(plan.version).toBe(1);
    expect(plan.strategy).toBe(strategy);
    expect(plan.summary.strategy).toBe(strategy);
    expect(placedInstances(plan)).toEqual(expectedInstances(mats));
    checkGeometry(plan);
    // 놓을 수 있는 것은 다 놓는다 — 못 놓은 것은 지금 방식과 같이 원판보다 큰 것뿐
    expect(plan.summary.unallocatedCount).toBe(NestingEngine.plan(mats).summary.unallocatedCount);
    // 결정성 — 두 번, 순서를 뒤집어도
    const json = JSON.stringify(plan);
    expect(JSON.stringify(NestingEngine.plan(mats, { strategy }))).toBe(json);
    expect(JSON.stringify(NestingEngine.plan([...mats].reverse(), { strategy }))).toBe(json);

    // 겹침 — 같은 배치 번호의 원판은 배치가 같고 장수가 stack 과 같다
    const byLayout = new Map();
    plan.sheets.forEach((s) => {
      expect(s.cuts).toBe(NestingEngine.cutCount(s));
      if (!byLayout.has(layoutKey(s))) byLayout.set(layoutKey(s), []);
      byLayout.get(layoutKey(s)).push(s);
    });
    const geom = (s) => s.parts.map((p) => [p.x, p.y, p.w, p.h, p.rot].join(',')).join(';');
    let cuts = 0;
    byLayout.forEach((list) => {
      expect(list.length).toBe(list[0].layout.stack);
      expect(list.length).toBeLessThanOrEqual(NestingEngine.DEFAULTS.MAX_STACK);
      list.forEach((s) => { expect(geom(s)).toBe(geom(list[0])); expect(s.cuts).toBe(list[0].cuts); });
      cuts += list[0].cuts;   // 겹친 원판은 한 번에 자른다
    });
    expect(plan.summary.cutCount).toBe(cuts);
    expect(plan.summary.layoutCount).toBe(byLayout.size);
    expect(plan.groups.reduce((n, g) => n + g.cutCount, 0)).toBe(cuts);
    plan.groups.forEach((g) => {
      expect(g.searched).toBeGreaterThan(1);
      expect(g.searched).toBeLessThanOrEqual(199);   // 지금 방식 1 + 후보 198
    });

    // 요약 · 잔재는 예전 규칙 그대로
    expect(Object.values(plan.summary.sheetsByMaterial).reduce((s, n) => s + n, 0)).toBe(plan.sheets.length);
    const bySheet = new Map(plan.sheets.map((s) => [s.no, s]));
    plan.offcuts.forEach((o) => {
      const s = bySheet.get(o.sheetNo);
      expect(o.free).toBeGreaterThanOrEqual(60);
      expect(o.x + o.w).toBeLessThanOrEqual(s.size.w - s.trim + 1e-6);
      expect(o.y + o.h).toBeLessThanOrEqual(s.size.h - s.trim + 1e-6);
      s.parts.forEach((p) => expect(overlaps(o, { x: p.x, y: p.y, ...foot(p) })).toBe(false));
    });
  });
});

describe('재단 방식 — 표준은 첫 톱질이 긴 변(2440)과 나란하다', () => {
  test.each(ALL_GOLDENS)('%s — 모든 원판이 세로 띠(V)이고, 띠마다 조각이 그 띠 폭 안에 있다', (name) => {
    const plan = NestingEngine.plan(golden(name), { strategy: 'standard' });
    plan.sheets.forEach((s) => {
      expect(s.size.h).toBeGreaterThanOrEqual(s.size.w);
      expect(s.layout.dir).toBe('V');
      // 띠는 x 로 나뉜다 — 띠 사이는 톱날만큼 떨어지고 원판 높이 전체를 지난다
      const strips = [...s.strips].sort((a, b) => a.offset - b.offset);
      strips.forEach((st, i) => {
        if (i > 0) expect(st.offset).toBeGreaterThanOrEqual(strips[i - 1].offset + strips[i - 1].size + plan.kerf);
        s.parts.filter((p) => p.strip === st.no).forEach((p) => {
          expect(p.x).toBe(st.offset);
          expect(p.x + foot(p).w).toBeLessThanOrEqual(st.offset + st.size);
          // 띠 폭보다 좁은 조각은 「한 번 더 켜는」 조각뿐이다
          if (foot(p).w < st.size) expect(p.fromRemainder).toBe(true);
        });
      });
    });
  });

  test('가로가 더 긴 원판이면 표준은 가로 띠(H)다 — 긴 변 먼저', () => {
    const plan = NestingEngine.plan(FIXTURE, { strategy: 'standard', sheetSize: { w: 2440, h: 1220 } });
    expect(plan.sheets.length).toBeGreaterThan(0);
    plan.sheets.forEach((s) => expect(s.layout.dir).toBe('H'));
    checkGeometry(plan);
  });
});

describe('재단 방식 — 묶음마다 지켜지는 것 · compare', () => {
  test.each(ALL_GOLDENS)('%s', (name) => {
    const mats = golden(name);
    const cmp = NestingEngine.compare(mats);
    // compare 는 plan 세 번과 같다
    STRATEGY_IDS.forEach((id) => expect(cmp.plans[id]).toEqual(NestingEngine.plan(mats, { strategy: id })));
    expect(cmp.rows.map((r) => [r.strategy, r.sheetCount, r.cutCount])).toEqual(STRATEGY_IDS.map((id) => [id, cmp.plans[id].summary.sheetCount, cmp.plans[id].summary.cutCount]));
    const groupOf = (id) => new Map(cmp.plans[id].groups.map((g) => [g.key, g]));
    const std = groupOf('standard'), mat = groupOf('material'), cut = groupOf('cuts');
    expect([...mat.keys()]).toEqual([...std.keys()]);
    expect([...cut.keys()]).toEqual([...std.keys()]);
    std.forEach((g, key) => {
      // 어느 방식으로 놓아도 그 묶음의 「표준」 칸은 표준으로 놓은 결과다
      [g, mat.get(key), cut.get(key)].forEach((x) => expect(x.standard).toEqual({ sheetCount: g.sheetCount, cutCount: g.cutCount }));
      expect(mat.get(key).sheetCount).toBeLessThanOrEqual(g.sheetCount);        // 부재 최적화 — 원판이 표준보다 늘지 않는다
      expect(cut.get(key).sheetCount).toBeLessThanOrEqual(g.sheetCount + 1);    // 최소 재단 — 표준보다 한 장까지
      expect(cut.get(key).cutCount).toBeLessThanOrEqual(g.cutCount);            // 최소 재단 — 횟수가 표준보다 늘지 않는다
    });
    // 부재 최적화는 지금 방식보다 원판이 늘지 않는다 (지금 배치가 후보에 들어 있다)
    const now = new Map(NestingEngine.plan(mats).groups.map((g) => [g.key, g]));
    mat.forEach((g, key) => expect(g.sheetCount).toBeLessThanOrEqual(now.get(key).sheetCount));
  });

  test('후보 수를 하나로 줄여도(searchBudget 1) 보존 · 기하 · 묶음 약속이 지켜진다', () => {
    const mats = golden('sink15');
    const cmp = NestingEngine.compare(mats, { searchBudget: 1 });
    STRATEGY_IDS.forEach((id) => {
      const plan = cmp.plans[id];
      expect(placedInstances(plan)).toEqual(expectedInstances(mats));
      checkGeometry(plan);
      plan.groups.forEach((g) => expect(g.searched).toBe(2));   // 지금 방식 + 후보 하나
    });
    cmp.plans.standard.sheets.forEach((s) => expect(s.layout.dir).toBe('V'));
    const std = new Map(cmp.plans.standard.groups.map((g) => [g.key, g]));
    cmp.plans.material.groups.forEach((g) => expect(g.sheetCount).toBeLessThanOrEqual(std.get(g.key).sheetCount));
    cmp.plans.cuts.groups.forEach((g) => {
      expect(g.sheetCount).toBeLessThanOrEqual(std.get(g.key).sheetCount + 1);
      expect(g.cutCount).toBeLessThanOrEqual(std.get(g.key).cutCount);
    });
  });

  test('cutCount — 띠 수 + 띠마다 (조각 − 1) + 더 좁은 폭을 한 번 더 켜는 수', () => {
    const sheet = {
      layout: { dir: 'V' },
      strips: [{ no: 1 }, { no: 2 }],
      parts: [
        { strip: 1, w: 600, h: 1000, rot: false }, { strip: 1, w: 600, h: 1000, rot: false },
        { strip: 1, w: 450, h: 300, rot: false, fromRemainder: true },
        { strip: 1, w: 300, h: 450, rot: true, fromRemainder: true },   // 돌린 조각 — 원판 위 폭은 450
        { strip: 2, w: 500, h: 800, rot: false },
      ],
    };
    // 띠 2 + (4 − 1) + 좁은 폭 한 가지(450) + (1 − 1) = 6
    expect(NestingEngine.cutCount(sheet)).toBe(6);
    // 가로 띠면 좁은 쪽은 원판 위 높이다 — 두 조각 모두 300 (돌린 조각의 발자국은 450 × 300) 이라 한 가지
    expect(NestingEngine.cutCount({ ...sheet, layout: { dir: 'H' } })).toBe(6);
    // 좁은 높이가 두 가지면 두 번 더 켠다
    const two = { layout: { dir: 'H' }, strips: [{ no: 1 }], parts: [
      { strip: 1, w: 800, h: 600, rot: false },
      { strip: 1, w: 300, h: 450, rot: false, fromRemainder: true },
      { strip: 1, w: 300, h: 200, rot: false, fromRemainder: true },
    ] };
    expect(NestingEngine.cutCount(two)).toBe(1 + 2 + 2);
    expect(NestingEngine.cutCount(null)).toBe(0);
    // 조각 하나짜리 원판 — 띠 하나
    const one = NestingEngine.plan([{ partId: 'x', part: '측판', material: 'PB', thickness: 15, w: 1000, h: 2000, qty: 1 }], { strategy: 'standard' });
    expect(one.summary.cutCount).toBe(1);
    // 재단 방식 없이 낸 원판에도 쓸 수 있다
    NestingEngine.plan(FIXTURE).sheets.forEach((s) => expect(NestingEngine.cutCount(s)).toBeGreaterThan(0));
  });
});

describe('재단 방식 — 옵션 · 결 · 큰 부재 · 석재 상판은 방식마다 그대로', () => {
  const rows = [
    { partId: 'a', part: '측판', material: 'PB', thickness: 15, w: 500, h: 700, qty: 3 },
    { partId: 'b', part: '도어', material: '무늬목', thickness: 18, w: 400, h: 900, qty: 2 },
    { partId: 'c', part: '선반', material: 'PB', thickness: 15, w: 500, h: 300, qty: 2, grain: 'v' },
  ];

  test.each(STRATEGY_IDS)('%s', (strategy) => {
    // 결 부재 · 회전 금지 자재는 돌리지 않는다
    NestingEngine.plan(rows, { strategy }).sheets.forEach((s) => s.parts.forEach((p) => {
      if (['b', 'c'].includes(NestingEngine.basePartId(p.partId))) expect(p.rot).toBe(false);
    }));
    const fixed = NestingEngine.plan(rows, { strategy, noRotateMaterials: [/./] });
    expect(fixed.sheets.flatMap((s) => s.parts).length).toBe(7);
    fixed.sheets.forEach((s) => s.parts.forEach((p) => expect(p.rot).toBe(false)));
    // 원판 크기 · 여백 · 톱날
    const sized = NestingEngine.plan(rows, { strategy, sheetSizes: { 무늬목_18: { w: 1000, h: 2000 }, PB: { w: 1250, h: 2500 } }, trim: 30, kerf: 6 });
    sized.sheets.forEach((s) => expect(s.size).toEqual(s.material === 'PB' ? { w: 1250, h: 2500 } : { w: 1000, h: 2000 }));
    expect(Math.min(...sized.sheets.flatMap((s) => s.parts.map((p) => Math.min(p.x, p.y))))).toBe(30);
    checkGeometry(sized);
    // 원판보다 큰 부재는 못 놓음, 석재 상판은 재단에서 뺀다
    const big = NestingEngine.plan([
      { partId: 'big', part: '상판', material: 'MDF', thickness: 18, w: 4000, h: 600, qty: 1 },
      { partId: 'top', slot: 'top', part: '상판', material: '인조대리석', thickness: 12, w: 1000, h: 650, qty: 1 },
    ], { strategy });
    expect(big.sheets).toEqual([]);
    expect(big.unallocated).toEqual([expect.objectContaining({ partIds: ['big#0'], qty: 1 })]);
    expect(big.skipped.map((s) => s.partId)).toEqual(['top']);
    expect(big.summary.cutCount).toBe(0);
  });
});

describe('재단 방식 — 색 (colorOf)', () => {
  // 몸통 PB 는 두 색, 뒷판은 한 색, 도어는 색 없음
  const colored = FIXTURE.map((m, i) => ({ ...m, color: m.material === 'PB' ? (i % 2 ? '오크' : '화이트') : m.thickness === 3 ? '화이트' : undefined }));
  const colorOf = (m) => m.color;
  const wantColor = new Map(colored.map((m) => [m.partId, m.color || '']));

  test.each([null, ...STRATEGY_IDS])('방식 %s — 색이 다른 판은 한 원판에 섞이지 않는다', (strategy) => {
    const plan = NestingEngine.plan(colored, { strategy, colorOf });
    expect(placedInstances(plan)).toEqual(expectedInstances(colored));
    checkGeometry(plan);
    plan.sheets.forEach((s) => s.parts.forEach((p) => expect(wantColor.get(NestingEngine.basePartId(p.partId))).toBe(s.color)));
    plan.smallParts.forEach((p) => expect(p.color).toBe(wantColor.get(p.partId)));
    // 묶음 — 자재 · 두께 · 구분 · 색. 색이 없는 줄은 색 있는 줄과 다른 묶음이다
    expect(plan.groups.map((g) => g.key)).toEqual(['MDF|3|뒷판|화이트', 'MDF|18|도어|', 'PB|15|본체|오크', 'PB|15|본체|화이트']);
    plan.groups.forEach((g) => expect(g.key.endsWith(`|${g.color}`)).toBe(true));
    // 색별 장수 — 합이 전체 원판 수와 같고, 묶음 장수와 맞는다
    expect(plan.summary.sheetsByColor.map((c) => [c.material, c.thickness, c.color])).toEqual([['MDF', 3, '화이트'], ['MDF', 18, ''], ['PB', 15, '오크'], ['PB', 15, '화이트']]);
    expect(plan.summary.sheetsByColor.reduce((n, c) => n + c.sheetCount, 0)).toBe(plan.summary.sheetCount);
    plan.summary.sheetsByColor.forEach((c) => {
      const n = plan.groups.filter((g) => g.material === c.material && g.thickness === c.thickness && g.color === c.color).reduce((s, g) => s + g.sheetCount, 0);
      expect(c.sheetCount).toBe(n);
    });
    // 자재별 장수 키는 색이 있어도 `자재_두께` — 재고 · 견적이 이 키로 읽는다
    expect(Object.keys(plan.summary.sheetsByMaterial).sort()).toEqual(['MDF_18', 'MDF_3', 'PB_15']);
    expect(plan.summary.sheetsByMaterial.PB_15).toBe(plan.sheets.filter((s) => s.material === 'PB').length);
    // 배치 번호는 색 묶음 사이에 이어진다 — 자재 · 두께 · 구분 · 번호로 겹침을 묶어도 색이 섞이지 않는다
    const colorByLayout = new Map();
    plan.sheets.forEach((s) => {
      if (colorByLayout.has(layoutKey(s))) expect(colorByLayout.get(layoutKey(s))).toBe(s.color);
      colorByLayout.set(layoutKey(s), s.color);
    });
    // 결정성
    expect(JSON.stringify(NestingEngine.plan([...colored].reverse(), { strategy, colorOf }))).toBe(JSON.stringify(plan));
    // 색만 줬을 때는 재단 방식 칸이 붙지 않는다
    if (!strategy) {
      expect(plan).not.toHaveProperty('strategy');
      plan.sheets.forEach((s) => expect(s).not.toHaveProperty('cuts'));
    }
  });

  test('색이 모두 같으면 색 없이 놓은 것과 배치가 같다', () => {
    const a = NestingEngine.plan(FIXTURE);
    const b = NestingEngine.plan(FIXTURE, { colorOf: () => 'X' });
    const geom = (p) => p.sheets.map((s) => [s.no, s.material, s.thickness, s.partClass, s.layout.no, s.layout.stack, s.parts.map((x) => [x.partId, x.x, x.y, x.rot].join(',')).join(';')].join('|'));
    expect(geom(b)).toEqual(geom(a));
    b.sheets.forEach((s) => expect(s.color).toBe('X'));
    expect(b.summary.sheetsByMaterial).toEqual(a.summary.sheetsByMaterial);
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
    expect(srcs[i1]).toMatch(/\?v=\d+/);
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
