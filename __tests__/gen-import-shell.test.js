/**
 * gen-to-planner 끝에서 끝: 변환기 출력이 실제 플래너 두 페이지를 통과하는가.
 *
 *   변환기(gen-import.js) → 스코프 키 seed → mockup-shell 자동 복원(fromStructure) → serializeLayout 라운드트립
 *                                       → mockup-structure 부팅 → 1회 토큰으로 전체 자동계산 → 모듈 생성
 *
 * 실제 HTML 을 jsdom 에서 부팅한다 (test-utils/planner-harness.js). 스코프는 iframe 이 쓰는
 * `local:<uniqueId>` 그대로다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');
const { PLANNER_SECTIONS } = require('../js/planner/planner-sections');
const G = require('../js/detaildesign/gen-import');

const UID = '1757550000000.123';
const SCOPE = `local:${UID}`;
const SEARCH = `?design=local&item=${UID}`;

function layoutFor(category) {
  if (category === 'wardrobe') {
    return {
      category,
      wall: { W: 3600, H: 2310 },
      segments: [{ kind: 'wardrobe', x: 0, w: 3600, doors: 7, drawers: 0 }],
      uppers: [],
      appliances: { sink: null, cooktop: null, hood: null, dishwasher: null, refrigerator: null },
    };
  }
  return {
    category: 'sink',
    wall: { W: 3000, H: 2400 },
    segments: [
      { kind: 'lower', x: 0, w: 2250, doors: 4, drawers: 1 },
      { kind: 'tall', x: 2250, w: 750, doors: 1, drawers: 0 },
    ],
    uppers: [{ kind: 'upper', x: 0, w: 2250, doors: 4 }],
    appliances: {
      sink: { x: 550, w: 700 },
      cooktop: { centerPct: 65 },
      hood: { x: 1800, w: 300 },
      dishwasher: null,
      refrigerator: null,
    },
  };
}

function seeded(category) {
  const storage = new Map();
  const session = new Map();
  const ls = {
    setItem: (k, v) => storage.set(k, String(v)),
    getItem: (k) => storage.get(k) ?? null,
  };
  const ss = {
    setItem: (k, v) => session.set(k, String(v)),
    getItem: (k) => session.get(k) ?? null,
  };
  const seed = G.genLayoutToPlanner(
    layoutFor(category),
    null,
    category,
    PLANNER_SECTIONS,
    '2026-09-11T00:00:00.000Z'
  );
  G.genImportSeedScope(SCOPE, seed, ls, ss);
  return { seed, storage: Object.fromEntries(storage), session: Object.fromEntries(session) };
}

function boot(file, opts) {
  const p = bootPlanner(file, Object.assign({ search: SEARCH }, opts));
  if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

describe('배치 단계', () => {
  test('seed 한 배치를 자동 복원하고 그대로 다시 저장한다', () => {
    const { seed, storage, session } = seeded('sink');
    const p = boot('mockup-shell.html', { storage, session });
    const out = p.g('serializeLayout')();
    expect(out.modules.map((m) => m.section).sort()).toEqual(
      seed.layout.modules.map((m) => m.section).sort()
    );
    out.modules.forEach((m, i) => {
      const s = seed.layout.modules.find((x) => x.section === m.section && x.x === m.x);
      expect(s).toBeTruthy();
      expect(m).toMatchObject({ w: s.w, h: s.h, moduleH: s.moduleH, rotation: 0 });
    });
    expect(out.person).toEqual(seed.layout.person);
  });

  test('붙박이장도 버려지지 않는다', () => {
    const { storage, session } = seeded('wardrobe');
    const p = boot('mockup-shell.html', { storage, session });
    expect(p.g('serializeLayout')().modules).toEqual([
      expect.objectContaining({ section: 'wardrobe', w: 3600 }),
    ]);
  });
});

describe('구조 단계', () => {
  test('1회 토큰으로 전체 자동계산이 돌아 모듈이 생기고, 가전은 자리에 남는다', () => {
    const { storage, session } = seeded('sink');
    const p = boot('mockup-structure.html', { storage, session });
    const payload = p.g('buildPlannerPayload')('PLANNER_STATE');
    const lower = payload.modules.filter((m) => m.section === 'lower');
    const upper = payload.modules.filter((m) => m.section === 'upper');
    expect(lower.length).toBeGreaterThan(1);
    expect(upper.length).toBeGreaterThan(0);
    expect(lower.reduce((s, m) => s + m.W, 0)).toBe(2250);
    expect(payload.modules.some((m) => m.section === 'sink')).toBe(true);
    expect(payload.modules.some((m) => m.section === 'hood')).toBe(true);
    expect(payload.modules.some((m) => m.section === 'tall')).toBe(true);
    expect(p.session.getItem(`${G.GEN_IMPORT_AUTOCALC_BASE}::${SCOPE}`)).toBeNull();
    expect(p.storage.getItem(`dadam_struct_modules_v1::${SCOPE}`)).toBeTruthy();
  });

  test('붙박이장은 좌대 60 + 상몰딩 20 으로 서고 폭 합이 벽 폭이다', () => {
    const { storage, session } = seeded('wardrobe');
    const p = boot('mockup-structure.html', { storage, session });
    const payload = p.g('buildPlannerPayload')('PLANNER_STATE');
    const ws = payload.modules.filter((m) => m.section === 'wardrobe');
    expect(ws.reduce((s, m) => s + m.W, 0)).toBe(3600);
    const parts = p.g('heightPartsOf')(ws[0], payload.structures[ws[0].id] || {});
    expect(parts.map((x) => [x.key, x.value])).toEqual([
      ['pedestalH', 60],
      ['moldingH', 20],
    ]);
  });

  test('두 번째 진입에는 다시 돌지 않는다', () => {
    const { storage, session } = seeded('sink');
    const first = boot('mockup-structure.html', { storage, session });
    const before = first.g('buildPlannerPayload')('PLANNER_STATE').modules.length;
    // 첫 진입이 남긴 저장소로 다시 부팅 — 토큰은 이미 소비됐다
    const again = boot('mockup-structure.html', { storage: first.storage._dump(), session: {} });
    expect(again.g('buildPlannerPayload')('PLANNER_STATE').modules.length).toBe(before);
  });
});
