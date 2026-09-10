/**
 * @jest-environment node
 *
 * 연출컷 → 구성 분석 계약 (workers/generate-api/src/layout.js, gen-to-planner).
 *
 * 고정하는 것:
 *   1) mm 는 Claude 가 아니라 조사값·정본이 정한다 — 가전 폭은 planner-sections 와 같고,
 *      싱크·후드 위치는 wall_analysis 의 waterPct/exhaustPct 다 (이미지 값이 멀면 확신도만 낮춘다)
 *   2) 세그먼트는 좌→우 연속이고 mm 합이 벽 폭이다
 *   3) 품목에 없는 kind 는 버리고 note 를 남긴다, 아무것도 못 읽으면 기본 구성
 *   4) 붙박이장은 벽 전체 하나, 냉장고장은 니치가 반드시 하나
 *   5) 스키마는 모든 object 가 additionalProperties:false (구조화 출력 요건)
 *   6) 워커 라우트·공개 컬럼에 layout 이 있다
 *
 * ESM 을 jest(CJS) 에서 읽기 위해 export 를 떼고 평가한다 (generate-prompts.test.js 와 같은 방식).
 */

const fs = require('fs');
const path = require('path');
const { PLANNER_SECTIONS } = require('../js/planner/planner-sections');

function loadEsm(rel, names) {
  const src = fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^export /gm, '');
  return new Function(src + `\nreturn { ${names.join(', ')} };`)();
}

const L = loadEsm('workers/generate-api/src/layout.js', [
  'LAYOUT_VERSION',
  'LAYOUT_CATEGORIES',
  'LAYOUT_KITCHEN',
  'APPLIANCE_W',
  'FLOOR_KINDS',
  'LAYOUT_SCHEMA',
  'APPLIANCE_TOLERANCE_PCT',
  'buildLayoutPrompt',
  'normalizeLayout',
]);

const WA = { wallW: 3000, wallH: 2400, waterPct: 30, exhaustPct: 70 };
const CONF = { segments: 0.9, uppers: 0.8, appliances: 0.7 };
const seg = (kind, s, e, doors = 1, drawers = 0) => ({
  kind,
  start_pct: s,
  end_pct: e,
  doors,
  drawers,
});
const rawSink = () => ({
  segments: [seg('lower', 0, 55, 3, 1), seg('dishwasher', 55, 75, 1), seg('tall', 75, 100, 1)],
  uppers: [
    { kind: 'upper', start_pct: 0, end_pct: 60, doors: 3 },
    { kind: 'hood', start_pct: 60, end_pct: 75, doors: 0 },
  ],
  uppers_status: 'clear',
  appliances: {
    sink: { center_pct: 28 },
    cooktop: { center_pct: 68 },
    hood: { center_pct: 68 },
    dishwasher: { center_pct: 65 },
    refrigerator: null,
  },
  confidence: CONF,
  notes: ['hood is slim'],
});

describe('정본 대조', () => {
  test('가전 폭은 planner-sections 와 같다', () => {
    Object.keys(L.APPLIANCE_W).forEach((k) => expect(L.APPLIANCE_W[k]).toBe(PLANNER_SECTIONS[k].w));
  });

  test('품목별 kind 는 플래너 섹션이거나 open 이다', () => {
    Object.values(L.FLOOR_KINDS)
      .flat()
      .forEach((k) => {
        if (k !== 'open') expect(PLANNER_SECTIONS[k]).toBeTruthy();
      });
  });

  test('스키마의 모든 object 는 additionalProperties:false + required 다', () => {
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'object') {
        expect(node.additionalProperties).toBe(false);
        expect(Object.keys(node.properties).sort()).toEqual([...node.required].sort());
      }
      Object.values(node).forEach((v) => (Array.isArray(v) ? v.forEach(walk) : walk(v)));
    };
    walk(L.LAYOUT_SCHEMA);
  });
});

describe('프롬프트', () => {
  test('사실 블록에 벽 치수·급수·배기가 들어가고 mm 추정을 금지한다', () => {
    const p = L.buildLayoutPrompt({ category: 'sink', wallAnalysis: WA });
    expect(p).toMatch(/3000 mm wide and 2400 mm high/);
    expect(p).toMatch(/sink\) is at 30 %/);
    expect(p).toMatch(/exhaust .* at 70 %/);
    expect(p).toMatch(/Do not estimate millimetres/);
    expect(p).toMatch(/lower, dishwasher, refrigerator, tall, fridge, open/);
  });

  test('붙박이장·냉장고장은 각자 어휘와 사실을 쓴다', () => {
    const w = L.buildLayoutPrompt({ category: 'wardrobe', wallAnalysis: WA });
    expect(w).not.toMatch(/water supply/);
    expect(w).toMatch(/wardrobe, open/);
    const f = L.buildLayoutPrompt({
      category: 'fridge',
      wallAnalysis: WA,
      options: { fridge_options: { position: 'right' } },
    });
    expect(f).toMatch(/refrigerator sits on the right side/);
  });

  test('아일랜드는 벽면만 읽는다', () => {
    expect(L.buildLayoutPrompt({ category: 'island', wallAnalysis: WA })).toMatch(
      /Ignore the freestanding island/
    );
  });
});

describe('정규화 — 싱크대', () => {
  const out = L.normalizeLayout(rawSink(), {
    category: 'sink',
    wallAnalysis: WA,
    model: 'm',
    now: 't',
  });

  test('세그먼트는 연속이고 mm 합이 벽 폭이다', () => {
    expect(out.segments.map((s) => s.kind)).toEqual(['lower', 'dishwasher', 'tall']);
    expect(out.segments[0].x).toBe(0);
    for (let i = 1; i < out.segments.length; i++) {
      expect(out.segments[i].x).toBe(out.segments[i - 1].x + out.segments[i - 1].w);
    }
    expect(out.segments.reduce((s, x) => s + x.w, 0)).toBe(3000);
    expect(out.segments.every((s) => s.x % 10 === 0)).toBe(true);
  });

  test('싱크·후드는 조사값(waterPct/exhaustPct)에 놓이고 폭은 정본이다', () => {
    expect(out.appliances.sink).toMatchObject({
      centerPct: 30,
      w: 700,
      x: 900 - 350,
      source: 'waterPct',
    });
    expect(out.appliances.hood).toMatchObject({
      centerPct: 70,
      w: 300,
      x: 2100 - 150,
      source: 'exhaustPct',
    });
    expect(out.appliances.cooktop.centerPct).toBe(70);
    expect(out.appliances.dishwasher).toMatchObject({ w: 600, source: 'image' });
  });

  test('이미지 값이 허용 범위 안이면 확신도를 건드리지 않는다', () => {
    expect(out.confidence.appliances).toBe(0.7);
    expect(out.notes.some((n) => /surveyed value used/.test(n))).toBe(false);
  });

  test('상부장은 upper 구간만 남고 hood 는 상부 틈이 아니다', () => {
    expect(out.uppers.length).toBe(1);
    expect(out.uppers[0]).toMatchObject({ kind: 'upper', x: 0, w: 1800, doors: 3 });
  });

  test('도어·서랍 수와 모델 노트가 실린다', () => {
    expect(out.doorCounts).toMatchObject({ lower: 3, upper: 3, tall: 1 });
    expect(out.drawerCount).toBe(1);
    expect(out.notes).toContain('model: hood is slim');
    expect(out).toMatchObject({
      version: L.LAYOUT_VERSION,
      category: 'sink',
      sourceSlot: 'base',
      model: 'm',
      created_at: 't',
      wall: { W: 3000, H: 2400 },
    });
    expect(out.raw).toEqual(rawSink());
  });
});

describe('정규화 — 규칙', () => {
  test('이미지의 싱크 위치가 조사값과 멀면 조사값을 쓰고 확신도를 낮춘다', () => {
    const r = rawSink();
    r.appliances.sink = { center_pct: 30 + L.APPLIANCE_TOLERANCE_PCT + 5 };
    const out = L.normalizeLayout(r, { category: 'sink', wallAnalysis: WA });
    expect(out.appliances.sink.centerPct).toBe(30);
    expect(out.confidence.appliances).toBeLessThanOrEqual(0.5);
    expect(out.notes.some((n) => /sink read at 50 %/.test(n))).toBe(true);
  });

  test('품목에 없는 kind 는 버리고 note 를 남긴다', () => {
    const r = rawSink();
    r.segments.push(seg('wardrobe', 90, 100));
    const out = L.normalizeLayout(r, { category: 'sink', wallAnalysis: WA });
    expect(out.segments.some((s) => s.kind === 'wardrobe')).toBe(false);
    expect(out.notes.some((n) => /"wardrobe" is not valid for sink/.test(n))).toBe(true);
  });

  test('아무것도 못 읽으면 기본 구성 + 낮은 확신도, 던지지 않는다', () => {
    const out = L.normalizeLayout(null, { category: 'sink', wallAnalysis: WA });
    expect(out.segments).toEqual([expect.objectContaining({ kind: 'lower', x: 0, w: 3000 })]);
    expect(out.uppers).toEqual([expect.objectContaining({ kind: 'upper', x: 0, w: 3000 })]);
    expect(out.appliances.sink).toBeTruthy();
    expect(out.confidence.segments).toBeLessThanOrEqual(0.2);
    expect(out.confidence.overall).toBeLessThanOrEqual(0.2);
  });

  test('상부장이 불명확하면 하부 런 전체를 덮는다', () => {
    const r = rawSink();
    r.uppers_status = 'unclear';
    const out = L.normalizeLayout(r, { category: 'sink', wallAnalysis: WA });
    // 하부 런 = lower + dishwasher (0~75 %) → 2250 (10 단위 스냅)
    expect(out.uppers[0]).toMatchObject({ x: 0, w: 2250 });
    expect(out.confidence.uppers).toBeLessThanOrEqual(0.4);
  });

  test("상부장이 'none' 이면 비운다", () => {
    const r = rawSink();
    r.uppers_status = 'none';
    expect(L.normalizeLayout(r, { category: 'sink', wallAnalysis: WA }).uppers).toEqual([]);
  });

  test('좁은 조각은 이웃에 흡수되고 %·확신도는 클램프된다', () => {
    const r = rawSink();
    r.segments = [seg('lower', -10, 50, 2), seg('open', 50, 51), seg('tall', 51, 130, 1)];
    r.confidence = { segments: 7, uppers: -1, appliances: 0.5 };
    const out = L.normalizeLayout(r, { category: 'sink', wallAnalysis: WA });
    expect(out.segments.map((s) => s.kind)).toEqual(['lower', 'tall']);
    expect(out.confidence.segments).toBe(1);
    expect(out.confidence.uppers).toBeLessThanOrEqual(0.4);
  });

  test('벽 폭이 없으면 분석 단계와 같은 기본값(3000×2400)을 쓴다', () => {
    const out = L.normalizeLayout(rawSink(), { category: 'sink' });
    expect(out.wall).toEqual({ W: 3000, H: 2400 });
  });
});

describe('정규화 — 붙박이장·냉장고장·수납장', () => {
  test('붙박이장은 벽 전체 하나, 가전·상부 없음, 도어 수는 합친다', () => {
    const r = {
      segments: [seg('wardrobe', 0, 50, 4), seg('open', 50, 55), seg('wardrobe', 55, 100, 3)],
      uppers: [{ kind: 'upper', start_pct: 0, end_pct: 100, doors: 2 }],
      uppers_status: 'clear',
      appliances: {
        sink: { center_pct: 20 },
        cooktop: null,
        hood: null,
        dishwasher: null,
        refrigerator: null,
      },
      confidence: CONF,
      notes: [],
    };
    const out = L.normalizeLayout(r, {
      category: 'wardrobe',
      wallAnalysis: { wallW: 3600, wallH: 2400 },
    });
    expect(out.segments).toEqual([
      expect.objectContaining({ kind: 'wardrobe', x: 0, w: 3600, doors: 7 }),
    ]);
    expect(out.uppers).toEqual([]);
    expect(Object.values(out.appliances).every((a) => a === null)).toBe(true);
    expect(out.doorCounts.wardrobe).toBe(7);
  });

  test('냉장고장: 니치가 없으면 조사된 쪽에 끼우고, 냉장고는 니치 가운데', () => {
    const r = {
      segments: [seg('tall', 0, 100, 3)],
      uppers: [],
      uppers_status: 'unclear',
      appliances: { sink: null, cooktop: null, hood: null, dishwasher: null, refrigerator: null },
      confidence: CONF,
      notes: [],
    };
    const out = L.normalizeLayout(r, {
      category: 'fridge',
      wallAnalysis: { wallW: 2400, wallH: 2400 },
      options: { fridge_options: { position: 'right' } },
    });
    const f = out.segments[out.segments.length - 1];
    expect(f.kind).toBe('fridge');
    expect(f.w).toBe(720);
    expect(out.segments[0].kind).toBe('tall');
    expect(out.appliances.refrigerator).toMatchObject({ w: 720, x: 2400 - 720, source: 'segment' });
    // 브릿지 상부장은 니치 위
    expect(out.uppers[0]).toMatchObject({ x: f.x, w: f.w });
    expect(out.notes.some((n) => /no refrigerator niche/.test(n))).toBe(true);
  });

  test('수납장: 키큰장만, 상부 기본 없음, 주방 가전 없음', () => {
    const r = {
      segments: [seg('tall', 0, 50, 2), seg('tall', 50, 100, 2)],
      uppers: [],
      uppers_status: 'unclear',
      appliances: {
        sink: { center_pct: 50 },
        cooktop: null,
        hood: null,
        dishwasher: null,
        refrigerator: null,
      },
      confidence: CONF,
      notes: [],
    };
    const out = L.normalizeLayout(r, { category: 'storage', wallAnalysis: WA });
    expect(out.segments.every((s) => s.kind === 'tall')).toBe(true);
    expect(out.uppers).toEqual([]);
    expect(out.appliances.sink).toBeNull();
    expect(out.doorCounts.tall).toBe(4);
  });
});

describe('워커 라우트', () => {
  const W = fs.readFileSync(path.join(__dirname, '../workers/generate-api/src/worker.js'), 'utf8');

  test('POST /api/generate/:id/layout 이 있고 공개 컬럼에 layout 이 있다', () => {
    expect(W).toMatch(/\\\/share\|\\\/layout/);
    expect(W).toMatch(/async function createLayout\(/);
    expect(W).toMatch(/const PUBLIC_COLUMNS =\s*'[^']*,layout[,']/);
  });

  test('완료된 결과·지원 품목만, 있으면 캐시, force=1 이면 재분석', () => {
    const fn = W.slice(
      W.indexOf('async function createLayout('),
      W.indexOf('async function getGeneration(')
    );
    expect(fn).toMatch(/status !== 'done'/);
    expect(fn).toMatch(/LAYOUT_CATEGORIES\.includes/);
    expect(fn).toMatch(/cached: true/);
    expect(fn).toMatch(/get\('force'\) !== '1'/);
    expect(fn).toMatch(/image_too_large/);
  });

  test('스키마 파일에 layout 컬럼과 SELECT 권한이 있다', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../database/generations-layout.sql'), 'utf8');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS layout JSONB/);
    expect(sql).toMatch(/GRANT SELECT \(layout\)/);
    const schema = fs.readFileSync(
      path.join(__dirname, '../database/generations-schema.sql'),
      'utf8'
    );
    expect(schema).toMatch(/layout JSONB/);
  });
});
