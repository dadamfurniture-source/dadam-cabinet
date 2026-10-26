/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeAll, process, __dirname, console */
/**
 * C1a → CAD 베타 PR15: 도면(3D) ↔ BOM 원장 시험 (docs/02-design/features/scene-bom-ledger.md).
 *
 * "도면에 나타난 모든 자재를 정확히" 의 보증은 **3D 가 그린 부재 목록과 BOM 이 센 부재 목록이 같은 목록**이라는 것이다.
 * 두 단계로 맞춘다 (test-utils/ledger-diff.js):
 *
 *   1. id 대조 — 플래너가 조립 명세로 그린 판재(PR12·13, userData.partId)를 BOM 행 낱장 id(`${partId}#k`)와 맞춘다.
 *      명세 상자와 ±0.5mm 안이어야 하고, 모르는 id · 겹친 id · 행 일부만 그림은 **곧장 실패**한다 (허용 없음).
 *   2. 치수 대조 — 남은 것(예전 그리기 판재 ↔ id 로 안 맞춘 BOM 행)을 (모듈, 종류) 치수 다중집합으로.
 *      그 전에 정한 그림 차이(2026-10-26 상판 — BOM 한 장 ↔ 3D 배치 공간마다 조각)는 합이 맞을 때만 뺀다 (splitDeclaredTop).
 *   정한 그림 차이 둘째 — 현장 자름 (2026-10-26): 800 보다 짧은 상몰딩 · 걸레받이 · 목찬넬 조각은 BOM 800 발주 · 명세와 3D 는 붙는 길이.
 *      1단계 id 대조가 그 판재만 재단 치수 차이를 허용하고 declaredSiteCuts 로 센다 (ledger-diff.js diffById). 아래 '현장 자름' 시험이 잠근다.
 *      차이 개수는 래칫(test-utils/ledger-baseline.json)이 지킨다 — (픽스처, 종류, 차이) 마다 **늘면 실패**.
 *      줄면 통과하고 기준을 낮추라고 알린다:  UPDATE_LEDGER_BASELINE=1 npx jest __tests__/scene-bom-ledger.test.js
 *      (PowerShell: $env:UPDATE_LEDGER_BASELINE=1; npx jest __tests__/scene-bom-ledger.test.js). 늘어난 기준은 쓰지 않는다.
 *
 * 픽스처 (합성): 골든 3벌(planner-golden.js straight · lShape · oblique) + ㄱ자 코너(멍장) +
 *   PR15 에 더한 셋 — 다칸(한 모듈 2칸, D1 전까지 예전 그리기) · 서랍장(도어 + 서랍 2단, 명세 그리기) · 붙박이장(통 셋, PR14b 부터 명세).
 * 부팅은 상세설계 부모 창처럼 변환·추출기를 올린다 (bootPlanner3D assembly: true — 브라우저와 같은 길).
 */
const fs = require('fs');
const path = require('path');
const { FIXTURES } = require('../test-utils/planner-golden');
const { bootPlanner3D, collectSceneParts, collectSceneIdPieces } = require('../test-utils/scene-parts');
const { collectBomParts, LEDGER_SPECS } = require('../test-utils/bom-parts');
const {
  diffLedger, diffById, splitDeclaredTop, sortEntries, formatTable, countBy, ratchetCounts, compareRatchet, KNOWN_FAMILIES, TOLERANCE_MM, ID_AABB_TOLERANCE_MM,
} = require('../test-utils/ledger-diff');

const BASELINE_PATH = path.join(__dirname, '..', 'test-utils', 'ledger-baseline.json');

/** ㄱ자 하부 — planner-corner-blind.test.js `lShapeLayout(false)` 와 같다 (가로 3600 · 세로 1970, 깊이 650). */
const LOWER_D = 650;
const cornerL = {
  version: 1,
  savedAt: '2026-08-31T00:00:00.000Z',
  person: null,
  modules: [
    { section: 'lower', x: 0, y: 0, w: 3600, h: LOWER_D, moduleH: 870, rotation: 0, finishings: [] },
    { section: 'lower', x: LOWER_D / 2 - 1970 / 2, y: 1970 / 2 - LOWER_D / 2, w: 1970, h: LOWER_D, moduleH: 870, rotation: 90, finishings: [] },
  ],
};

/** 붙박이장 — 통 하나에 몸통이 여럿 (planner-export-cad.test.js WARDROBE_LAYOUT 와 같다) */
const wardrobeLayout = {
  version: 1,
  savedAt: '2026-01-01T00:00:00.000Z',
  person: null,
  modules: [{ section: 'wardrobe', x: 0, y: 0, w: 2400, h: 620, moduleH: 2310, rotation: 0, finishings: [] }],
};

/** 부팅 뒤 구조를 바꾸는 픽스처 — 바꾼 뒤 renderAll3D 를 다시 부른다 */
const restructure = (id, patch) => (p) => {
  Object.assign(p.g('getStructure')(id), patch);
  p.g('renderAll3D')({ fit: false });
};

const LEDGER_FIXTURES = {
  straight: { layout: FIXTURES.straight },
  lShape: { layout: FIXTURES.lShape },
  oblique: { layout: FIXTURES.oblique },
  cornerL: { layout: cornerL },
  // PR15: 다칸 — 1000 하부장을 2칸(도어 · 도어)으로. BOM 은 칸마다 통, 3D 는 칸막이 (결정 D1 전까지 예전 그리기)
  multiCell: {
    layout: FIXTURES.straight,
    prepare: restructure('lower-2', { verticalCount: 2, areaWidths: [500, 500], areaTypes: ['door', 'door'],
      areaDirections: ['left', 'right'], areaIs2D: [false, false] }),
  },
  // PR15: 서랍장 — 1000 하부장을 도어 + 서랍 2단 (목찬넬 레이아웃). 2026-10-25 두 몸통 — 몸통·처짐방지목·앞판·서랍 박스 모두 명세
  drawer: {
    layout: FIXTURES.straight,
    prepare: restructure('lower-2', { horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerHeight: 200, drawerCount: 2 }),
  },
  // PR15: 붙박이장 — 통 셋 (PR14b 부터 통째로 명세). 붙박이장 품목 스펙(빈 값 = 규칙 기본값)
  wardrobe: { layout: wardrobeLayout, ledger: { category: 'wardrobe', specsExact: {} } },
};

/** 픽스처 하나 — 부팅 → 자동계산 → (구조 바꾸기) → 3D 순회 → 명세 · BOM → id 대조 → 남은 것 치수 대조 */
function ledgerOf(name) {
  const def = LEDGER_FIXTURES[name];
  const ledger = def.ledger || {};
  const p = bootPlanner3D(def.layout, { design: 'ledger', item: name, assembly: true, ledger });
  if (def.prepare) def.prepare(p);
  const asm = p.g('plannerCadSpec')();
  const full = collectBomParts(p, ledger);
  const pieces = collectSceneIdPieces(p);
  const byId = diffById(name, pieces, asm.spec, full.materials);
  const sceneAll = collectSceneParts(p);
  const bom = collectBomParts(p, Object.assign({}, ledger, { excludeRows: byId.matchedRows }));
  // 정한 그림 차이 — 2026-10-26 사장님 확정 "ㄱ자 한 장으로 보내면 업체에서 알아서 나눔": 상판은 BOM 한 장(발주 정본) ↔ 3D 배치 공간마다 조각.
  //   합(두께 · 깊이 · 길이 합)이 맞을 때만 치수 대조 전에 뺀다 (ledger-diff.js splitDeclaredTop). 아래 '정한 그림 차이' 시험이 어느 픽스처인지 잠근다
  const top = splitDeclaredTop(sceneAll.filter((r) => !r.partIds.length), bom.parts);
  return {
    name, planner: p, spec: asm.spec, pieces, byId, sceneAll, scene: top.scene, declaredTop: top.declared,
    bom: top.bom, bomAll: full.parts, materials: full.materials, warnings: full.warnings,
  };
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { counts: {} };
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

const ledgers = {};
let discrepancies = [];

beforeAll(() => {
  Object.keys(LEDGER_FIXTURES).forEach((name) => { ledgers[name] = ledgerOf(name); });
  discrepancies = sortEntries(
    Object.values(ledgers).flatMap((L) => diffLedger(L.name, L.scene, L.bom)),
  );
});

describe('두 목록이 실제로 만들어진다', () => {
  test.each(Object.keys(LEDGER_FIXTURES))('%s — 3D 부재와 BOM 행이 모두 있고 모듈 id 가 붙어 있다', (name) => {
    const L = ledgers[name];
    expect(L.sceneAll.length).toBeGreaterThan(0);
    expect(L.bomAll.length).toBeGreaterThan(0);
    L.sceneAll.forEach((r) => expect(r.moduleId).not.toBe('?'));
    // 3D 는 부팅된 플래너 모듈 id, BOM 은 플래너 id 로 되돌린 것 — 같은 이름 공간이어야 대조가 된다
    const plannerIds = new Set((L.planner.g('modules') || []).map((m) => String(m.id)).concat(['ep']));
    L.sceneAll.forEach((r) => expect(plannerIds.has(r.moduleId)).toBe(true));
    L.bomAll.forEach((r) => expect(plannerIds.has(r.moduleId)).toBe(true));
  });

  test('모든 family 가 알려진 이름이다 — 새 부재 종류가 생기면 여기서 멈춘다', () => {
    const seen = new Set();
    Object.values(ledgers).forEach((L) => {
      L.sceneAll.forEach((r) => seen.add(r.family));
      L.bomAll.forEach((r) => seen.add(r.family));
    });
    const unknown = [...seen].filter((f) => KNOWN_FAMILIES.indexOf(f) < 0);
    expect(unknown).toEqual([]);
  });

  test('3D 행은 명세 판재(partIds 가 수량만큼) 이거나 예전 그리기(partIds 없음) 둘 중 하나다', () => {
    Object.values(ledgers).forEach((L) => L.sceneAll.forEach((r) => {
      expect([0, r.qty]).toContain(r.partIds.length);
    }));
  });
});

describe(`1단계 — id 대조 (명세 판재 ↔ BOM 낱장, AABB ±${ID_AABB_TOLERANCE_MM}mm)`, () => {
  test.each(Object.keys(LEDGER_FIXTURES))('%s — 모르는 id · 겹친 id · 일부만 그림 · 자리 어긋남이 없다', (name) => {
    const { issues } = ledgers[name].byId;
    if (issues.length) throw new Error(`id 대조 실패 ${issues.length}건\n` + issues.map((x) => `  ${x.kind}  ${x.partId}  ${x.note}`).join('\n'));
    expect(issues).toEqual([]);
  });

  test('명세로 그리는 픽스처는 id 로 맞춘 판재가 있다 (붙박이장 통은 PR14b 부터)', () => {
    Object.keys(LEDGER_FIXTURES).forEach((name) => {
      expect(ledgers[name].byId.matched).toBeGreaterThan(20);
    });
  });

  test('표준 하부장 도어는 id 로 맞는다 — 대조 장치가 실제로 짝을 짓는다', () => {
    const L = ledgers.straight;
    const doorRows = L.materials.filter((m) => /^0-planner-lower-\d+-0-door#/.test(m.partId));
    expect(doorRows.length).toBeGreaterThan(0);
    doorRows.forEach((m) => expect(L.byId.matchedRows.has(m.partId)).toBe(true));
    // 그래서 치수 대조에는 도어가 남지 않는다
    expect(discrepancies.filter((d) => d.fixture === 'straight' && d.family === 'door')).toEqual([]);
  });

  test('서랍장 — 두 몸통(도어 모듈 · 서랍 모듈) · 서랍 전면 · 서랍 박스 · 처짐방지목이 id 로 맞는다 (2026-10-25 D2)', () => {
    const L = ledgers.drawer;
    const mk = '0-planner-lower-2-0';
    const of = (re) => L.materials.filter((m) => m.partId.indexOf(mk + '-') === 0 && re.test(m.partId.slice(mk.length + 1)));
    [/^drawer#/, /^drawerbox:/, /^channel:mid-/, /^door#/, /^body:side/, /^body:brace/].forEach((re) => {
      const rows = of(re);
      expect(rows.length).toBeGreaterThan(0);
      rows.forEach((m) => expect(L.byId.matchedRows.has(m.partId)).toBe(true));
    });
    expect(of(/^body:side/)).toHaveLength(2);   // 몸통 둘 — 측판 행 둘
    // 서랍 전면마다 id 가 다르다
    const fronts = L.pieces.filter((pc) => /-drawer#/.test(pc.partId));
    expect(fronts).toHaveLength(2);
    expect(new Set(fronts.map((pc) => pc.partId)).size).toBe(2);
  });
});

describe('정한 그림 차이 — 치수 대조 전에 합으로 맞춰 뺀다 (ledger-diff.js splitDeclaredTop)', () => {
  test('상판: BOM 한 장(발주 정본) = 3D 배치 공간마다 조각의 합 — 2026-10-26 사장님 확정 "ㄱ자 한 장으로 보내면 업체에서 알아서 나눔"', () => {
    const got = Object.keys(LEDGER_FIXTURES).filter((n) => ledgers[n].declaredTop)
      .map((n) => [n, ledgers[n].declaredTop.bom, ledgers[n].declaredTop.pieces.map((pc) => pc.len).sort((a, b) => b - a)]);
    expect(got).toEqual([
      ['lShape', { a: 4200, b: 650, t: 12 }, [1800, 1500, 900]],   // ㄱ자 — 본 벽 1800 + 900, 옆 벽 1500
      ['oblique', { a: 3000, b: 650, t: 12 }, [1800, 1200]],       // 사선 — 두 벽
    ]);
    // cornerL 은 빼지 않는다 — 3D 가 배치 공간 전폭(3600 · 1970)을 코너에서 겹쳐 그려 합 5570 ≠ BOM 4866(모듈 폭 합). 치수 대조가 차이로 센다
    expect(ledgers.cornerL.declaredTop).toBeNull();
    expect(discrepancies.filter((d) => d.fixture === 'cornerL' && d.family === 'top').map((d) => d.kind).sort()).toEqual(['only3d', 'only3d', 'onlyBom']);
    // 뺀 픽스처에는 상판 차이가 남지 않는다
    expect(discrepancies.filter((d) => ['lShape', 'oblique'].includes(d.fixture) && d.family === 'top')).toEqual([]);
  });
});

describe('정한 그림 차이 — 현장 자름 (2026-10-26 사장님 "800 보다 짧으면 그 길이 그대로 내는게 아니라 최소 800이상의 길이가 되어야한다는 거지")', () => {
  // 래칫 밖 픽스처 (차이 개수 기준에 넣지 않는다): ㄱ자 하부 1800 + 옆 벽 600, 상부 600 하나 —
  //   상몰딩 · 옆 벽 걸레받이 · 목찬넬이 800 보다 짧은 자리라 BOM 은 800 으로 내고 3D 는 붙는 길이 600 을 그린다
  const shortPlaces = {
    version: 1, savedAt: '2026-01-01T00:00:00.000Z', person: { cx: 1500, cy: 1500 },
    modules: [
      { section: 'lower', x: 0, y: 0, w: 1800, h: 650, moduleH: 870, rotation: 0, finishings: [] },
      { section: 'lower', x: 1800, y: 650, w: 600, h: 650, moduleH: 870, rotation: 90, finishings: [] },
      { section: 'upper', x: 0, y: 0, w: 600, h: 320, moduleH: 780, rotation: 0, finishings: [] },
    ],
  };

  test('원장 픽스처에는 현장 자름이 없다 — 재단 치수 차이를 허용한 판재 0', () => {
    Object.keys(LEDGER_FIXTURES).forEach((name) => expect([name, ledgers[name].byId.declaredSiteCuts]).toEqual([name, []]));
  });

  test('짧은 자리 — BOM 800 · 명세와 3D 600, id 대조가 정한 차이로 세고 치수 대조에는 차이가 남지 않는다', () => {
    const p = bootPlanner3D(shortPlaces, { design: 'ledger', item: 'shortPlaces', assembly: true });
    const asm = p.g('plannerCadSpec')();
    const full = collectBomParts(p);
    const pieces = collectSceneIdPieces(p);
    const byId = diffById('shortPlaces', pieces, asm.spec, full.materials);
    expect(byId.issues).toEqual([]);
    expect(byId.declaredSiteCuts.map((d) => [d.partId, d.part, d.order, d.len]).sort()).toEqual([
      ['0-ep-molding-0#0', '상몰딩', 800, 600],
      ['0-ep-kick-1#0', '걸레받이', 800, 600],
      ['0-ep-channel:front-1#0', '목찬넬(전면)', 800, 600],
      ['0-ep-channel:back-1#0', '목찬넬(지면)', 800, 600],
    ].sort());
    // BOM 행은 800 · 비고 "현장에서 자름", 3D 판재는 붙는 길이 600
    const ep = full.materials.filter((m) => /^0-ep-(molding|kick|channel)/.test(m.partId));
    expect(ep.filter((m) => /현장에서 자름/.test(m.note)).map((m) => [m.partId, Math.max(m.w, m.h)])).toEqual([
      ['0-ep-molding-0', 800], ['0-ep-kick-1', 800], ['0-ep-channel:front-1', 800], ['0-ep-channel:back-1', 800]]);
    byId.declaredSiteCuts.forEach((d) => {
      const pc = pieces.find((x) => x.partId === d.partId);
      expect(Math.round(Math.max(...[0, 1, 2].map((i) => pc.max[i] - pc.min[i])))).toBe(600);
    });
    const scene = collectSceneParts(p).filter((r) => !r.partIds.length);
    const bom = collectBomParts(p, { excludeRows: byId.matchedRows });
    const top = splitDeclaredTop(scene, bom.parts);
    expect(diffLedger('shortPlaces', top.scene, top.bom)).toEqual([]);
  });
});

describe('2단계 — 치수 대조 (예전 그리기 ↔ 남은 BOM 행) · 래칫', () => {
  test('(픽스처, 종류, 차이) 마다 개수가 기준(ledger-baseline.json)보다 늘지 않는다', () => {
    const now = ratchetCounts(discrepancies);
    const prev = readBaseline();
    const { up, down } = compareRatchet(prev.counts, now);
    if (process.env.UPDATE_LEDGER_BASELINE === '1') {
      // 처음 만들 때(기준 파일이 없을 때)만 그대로 쓴다. 그 뒤로는 올려 쓰지 않는다
      if (up.length && fs.existsSync(BASELINE_PATH)) throw new Error('기준을 올려 쓰지 않는다 — 늘어난 차이를 먼저 고치세요\n' + up.map((x) => `  ${x.key}  ${x.was} → ${x.now}`).join('\n'));
      const doc = {
        _doc: [
          '도면↔BOM 원장 래칫 — 2단계 치수 대조(예전 그리기 ↔ id 로 안 맞춘 BOM 행)의 차이 개수. __tests__/scene-bom-ledger.test.js 가 지킨다.',
          '열쇠 = fixture|family|kind. kind: only3d(3D 에만) · onlyBom(BOM 에만) · dims(치수/수량, ±1mm) · thickness(두께만 다름).',
          '늘면 실패, 줄면 통과 — 줄었으면 UPDATE_LEDGER_BASELINE=1 npx jest __tests__/scene-bom-ledger.test.js 로 낮춘다 (올려 쓰지 않는다).',
          '원인별 설명은 docs/02-design/features/scene-bom-ledger.md §3.',
          '정한 그림 차이(2026-10-26 사장님 확정 — 상판은 BOM 한 장 ↔ 3D 배치 공간마다 조각, 합이 맞을 때)는 치수 대조 전에 뺀다 (ledger-diff.js splitDeclaredTop).',
        ],
        toleranceMm: TOLERANCE_MM,
        idAabbToleranceMm: ID_AABB_TOLERANCE_MM,
        specs: LEDGER_SPECS,
        total: discrepancies.length,
        counts: now,
      };
      fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
      console.log(`원장 기준 갱신: ${discrepancies.length}건`);
      return;
    }
    if (up.length) {
      const keys = new Set(up.map((x) => x.key));
      const rows = discrepancies.filter((d) => keys.has(`${d.fixture}|${d.family}|${d.kind}`));
      throw new Error(`도면↔BOM 원장 — 기준보다 늘어난 차이 ${up.length}묶음\n` +
        up.map((x) => `  ${x.key}  ${x.was} → ${x.now}`).join('\n') + '\n\n' + formatTable(rows));
    }
    if (down.length) {
      console.log(`원장 차이가 줄었다 ${down.length}묶음 — 기준을 낮추세요 (UPDATE_LEDGER_BASELINE=1)\n` +
        down.map((x) => `  ${x.key}  ${x.was} → ${x.now}`).join('\n'));
    }
    expect(up).toEqual([]);
  });

  test('기준의 합계 = 개수 합 · 스펙이 시험 스펙과 같다', () => {
    const prev = readBaseline();
    expect(Object.values(prev.counts).reduce((a, b) => a + b, 0)).toBe(prev.total);
    expect(prev.specs).toEqual(LEDGER_SPECS);
  });

  test('요약 — 픽스처 · 종류별 개수', () => {
    const byFixture = countBy(discrepancies, 'fixture');
    const byKind = countBy(discrepancies, 'kind');
    const ids = Object.values(ledgers).reduce((s, L) => s + L.byId.matched, 0);
    console.log(
      `도면↔BOM 원장 — id 로 맞춘 판재 ${ids}장 · 치수 대조 차이 ${discrepancies.length}건\n` +
      `픽스처별: ${byFixture.map(([k, n]) => `${k} ${n}`).join(' · ')}\n` +
      `종류별: ${byKind.map(([k, n]) => `${k} ${n}`).join(' · ')}\n` +
      `정한 그림 차이로 뺀 상판 (2026-10-26): ${Object.values(ledgers).filter((L) => L.declaredTop).map((L) => L.name).join(' · ') || '없음'}`,
    );
    expect(ids).toBeGreaterThan(0);
  });
});
