/**
 * W10-1: corner-engine.js 단위 테스트
 * 규칙 원본: docs/design-rules/corner.md §3 (2026-07-17 확정)
 */
const {
  deriveCorner,
  seedCornerModules,
  removeCornerModules,
  seedUpperCornerModules,
  removeUpperCornerModules,
  migrateCornerModules,
  distributeBlindLine,
  assertCornerLedger,
  recalcBlindLine,
  cornerAdjOffset,
} = require('../js/detaildesign/corner-engine.js');

describe('deriveCorner — corner.md §3 확정 예시', () => {
  // 예시: secondary 1970 = EP20 + 800장(400×2) + 멍장(도어400+멍700) + 여유50
  const base = { lineW: 1970, adjTopD: 650, blindLineTopD: 650 };

  test('멍 = 650 − 10 + 60 = 700', () => {
    expect(deriveCorner(base).blindZoneW).toBe(700);
  });

  test('도어 가용폭 1200 → 도어 3개 × 400 (최소 350 만족 최대 수)', () => {
    const d = deriveCorner(base);
    expect(d.doorAvail).toBe(1200);
    expect(d.nDoors).toBe(3);
    expect(d.doorW).toBe(400);
    expect(d.remainder).toBe(0);
  });

  test('멍장 W = 멍 700 + 도어 400 = 1100', () => {
    expect(deriveCorner(base).blindW).toBe(1100);
  });

  test('원장 불변식: EP + 수납도어들 + 멍장W + 여유50 === 라인W', () => {
    const d = deriveCorner(base);
    const storageDoors = (d.nDoors - 1) * d.doorW + d.remainder;
    expect(20 + storageDoors + d.blindW + 50).toBe(1970);
  });

  test('인접(prime) 시작 offset = 650 − 10 + 60 = 700 (§3.7)', () => {
    expect(deriveCorner(base).adjStartOffset).toBe(700);
  });
});

describe('deriveCorner — 파생 규칙', () => {
  test('몰딩 변경 시 멍/도어 연동 재계산 (몰딩 100 → 멍 740)', () => {
    const d = deriveCorner({ lineW: 1970, adjTopD: 650, blindLineTopD: 650, molding: 100 });
    expect(d.blindZoneW).toBe(740); // 650−10+100
    expect(d.doorAvail).toBe(1160);
    expect(d.nDoors).toBe(3);
    expect(d.doorW).toBe(386);
    expect(d.remainder).toBe(2); // 1160 − 386×3, 마지막 수납이 흡수
  });

  test('인접 상판이 얕으면 멍이 줄고 도어가 커진다 (550 → 멍 600)', () => {
    const d = deriveCorner({ lineW: 1970, adjTopD: 550, blindLineTopD: 550 });
    expect(d.blindZoneW).toBe(600);
    expect(d.doorAvail).toBe(1300);
    expect(d.nDoors).toBe(3);
  });

  test('상부장: 멍 = 320 + 몰딩 = 380, 물끊기 없음 (§3.6)', () => {
    const d = deriveCorner({ lineW: 1800, adjTopD: 295, isUpper: true });
    expect(d.blindZoneW).toBe(380);
    expect(d.adjStartOffset).toBe(380);
  });

  test('도어 가용폭 < 350 → 도어 1개 + 경고 (§4.4 엣지)', () => {
    // lineW 1000: 1000−20−50−700 = 230 < 350
    const d = deriveCorner({ lineW: 1000, adjTopD: 650, blindLineTopD: 650 });
    expect(d.nDoors).toBe(1);
    expect(d.doorW).toBe(230);
    expect(d.warnings.length).toBeGreaterThan(0);
  });
});

describe('seedCornerModules — 영속화 + 멱등성', () => {
  function makeItem() {
    return {
      d: 650,
      modules: [
        { id: 1, name: '개수대', type: 'sink', pos: 'lower', w: 1000 },
        { id: 2, name: '수납장', type: 'storage', pos: 'lower', w: 800 },
      ],
      specs: {
        lowerLayoutShape: 'L',
        lowerSecondaryW: '1970',
        lowerSecondaryD: '650',
        secondaryStartSide: 'left',
        lowerH: 870, sinkLegHeight: 150, topThickness: 12,
        topSizes: [{ w: '', d: '650' }],
      },
    };
  }

  test('멍장 + 수납 시드가 item.modules에 영속화된다', () => {
    const item = makeItem();
    seedCornerModules(item);
    const blind = item.modules.find((m) => m.id === 'corner-blind-lower');
    expect(blind).toBeDefined();
    expect(blind.w).toBe(1100);
    expect(blind.blindZoneW).toBe(700);
    expect(blind.doorW).toBe(400);
    expect(blind.isDerived).toBe(true);
    expect(blind.isFixed).toBe(true);
    expect(blind.isDrawer).toBe(false); // 구규칙 isDrawer 폐기 (§3.5)
    const seeds = item.modules.filter((m) => String(m.id).startsWith('corner-sec-lower-'));
    expect(seeds).toHaveLength(2); // nDoors 3 − 멍장 도어 1
    expect(seeds.every((s) => s.w === 400)).toBe(true);
    expect(seeds.every((s) => s.line === 'secondary')).toBe(true);
  });

  test('멱등: 두 번 호출해도 모듈이 늘지 않는다', () => {
    const item = makeItem();
    seedCornerModules(item);
    const count = item.modules.length;
    seedCornerModules(item);
    expect(item.modules.length).toBe(count);
  });

  test('specs 변경 후 재호출 시 멍장 치수만 재계산, 사용자 수납은 보존', () => {
    const item = makeItem();
    seedCornerModules(item);
    item.modules.find((m) => m.id === 'corner-sec-lower-0').w = 500; // 사용자 수정 가정
    item.specs.topSizes[0].d = '550'; // 인접 상판 550으로 변경
    seedCornerModules(item);
    const blind = item.modules.find((m) => m.id === 'corner-blind-lower');
    expect(blind.blindZoneW).toBe(600); // 550−10+60
    expect(item.modules.find((m) => m.id === 'corner-sec-lower-0').w).toBe(500); // 보존
  });

  test('구식 멍장(w=secondaryD)은 파생 모듈로 승격된다', () => {
    const item = makeItem();
    item.modules.unshift({
      id: 12345, name: 'LT망장', type: 'storage', pos: 'lower',
      w: 650, isDrawer: true, isFixed: true, orientation: 'secondary',
    });
    seedCornerModules(item);
    const blinds = item.modules.filter((m) => m.name === 'LT망장');
    expect(blinds).toHaveLength(1); // 중복 생성 없음
    expect(blinds[0].id).toBe('corner-blind-lower');
    expect(blinds[0].w).toBe(1100); // 공식값으로 재계산
  });
});

describe('W10-2: seedUpperCornerModules — 상부장 멍장', () => {
  function makeUpperItem(overrides) {
    return Object.assign({
      d: 650,
      modules: [
        { id: 10, name: '상부수납', type: 'storage', pos: 'upper', w: 900 },
        { id: 1, name: '개수대', type: 'sink', pos: 'lower', w: 1000 },
      ],
      specs: {
        lowerLayoutShape: 'L',
        upperLayoutShape: 'L',
        upperSecondaryW: '1800',
        upperSecondaryD: '295',
        upperH: 720,
        secondaryStartSide: 'left',
        topSizes: [{ w: '', d: '650' }],
      },
    }, overrides || {});
  }

  test('상부 멍장: 멍 380(320+60) + 도어 450 = 830 (원장 1800)', () => {
    // 1800 − EP20 − 여유50 − 멍380 = 도어 가용 1350 → 3도어 × 450
    const item = makeUpperItem();
    seedUpperCornerModules(item);
    const blind = item.modules.find((m) => m.id === 'corner-blind-upper');
    expect(blind).toBeDefined();
    expect(blind.blindZoneW).toBe(380);
    expect(blind.doorW).toBe(450);
    expect(blind.w).toBe(830);
    expect(blind.pos).toBe('upper');
    expect(blind.h).toBe(720);
    expect(blind.d).toBe(295);
    const seeds = item.modules.filter((m) => String(m.id).startsWith('corner-sec-upper-'));
    expect(seeds).toHaveLength(2);
    expect(seeds.every((s) => s.w === 450 && s.pos === 'upper')).toBe(true);
  });

  test('상부 원장 불변식: EP + 수납도어 + 멍장W + 여유 === 1800', () => {
    const item = makeUpperItem();
    const d = seedUpperCornerModules(item);
    const storageDoors = (d.nDoors - 1) * d.doorW + d.remainder;
    expect(20 + storageDoors + d.blindW + 50).toBe(1800);
  });

  test('secondaryUpperEnabled=false면 생성하지 않는다', () => {
    const item = makeUpperItem();
    item.specs.secondaryUpperEnabled = false;
    const result = seedUpperCornerModules(item);
    expect(result).toBeNull();
    expect(item.modules.find((m) => m.id === 'corner-blind-upper')).toBeUndefined();
  });

  test('멱등: 반복 호출에도 모듈 증가 없음', () => {
    const item = makeUpperItem();
    seedUpperCornerModules(item);
    const count = item.modules.length;
    seedUpperCornerModules(item);
    expect(item.modules.length).toBe(count);
  });

  test('removeUpperCornerModules: 상부 secondary만 제거, 하부는 보존', () => {
    const item = makeUpperItem();
    seedCornerModules(item);
    seedUpperCornerModules(item);
    removeUpperCornerModules(item);
    expect(item.modules.find((m) => m.id === 'corner-blind-upper')).toBeUndefined();
    expect(item.modules.find((m) => m.id === 'corner-blind-lower')).toBeDefined();
  });

  test('마이그레이션: 분리 모드 상부만 L → 상부 멍장만 생성', () => {
    const item = makeUpperItem({
      specs: {
        dimensionMode: 'split',
        lowerLayoutShape: 'I',
        upperLayoutShape: 'L',
        upperSecondaryW: '1800', upperSecondaryD: '295', upperH: 720,
        secondaryStartSide: 'left',
        topSizes: [{ w: '', d: '650' }],
      },
    });
    migrateCornerModules(item);
    expect(item.modules.find((m) => m.id === 'corner-blind-upper')).toBeDefined();
    expect(item.modules.find((m) => m.id === 'corner-blind-lower')).toBeUndefined();
  });
});

describe('removeCornerModules / migrateCornerModules', () => {
  test('ㅡ자 복귀 시 secondary 모듈 전체 제거', () => {
    const item = {
      d: 650,
      modules: [
        { id: 'corner-blind-lower', name: 'LT망장', pos: 'lower', line: 'secondary', orientation: 'secondary' },
        { id: 'corner-sec-lower-0', pos: 'lower', line: 'secondary', orientation: 'secondary' },
        { id: 1, name: '개수대', type: 'sink', pos: 'lower', w: 1000 },
      ],
      specs: {},
    };
    removeCornerModules(item);
    expect(item.modules).toHaveLength(1);
    expect(item.modules[0].name).toBe('개수대');
  });

  test('마이그레이션: L인데 secondary 미영속화 설계 → 시드 생성 + line 부여 (멱등)', () => {
    const item = {
      d: 650,
      modules: [{ id: 1, name: '개수대', type: 'sink', pos: 'lower', w: 1000 }],
      specs: { lowerLayoutShape: 'L', lowerSecondaryW: '1970', lowerSecondaryD: '650', topSizes: [{ w: '', d: '650' }] },
    };
    migrateCornerModules(item);
    expect(item.modules.find((m) => m.id === 'corner-blind-lower')).toBeDefined();
    const count = item.modules.length;
    migrateCornerModules(item); // 재로드 시뮬레이션
    expect(item.modules.length).toBe(count);
  });

  test('마이그레이션: I 설계는 변경 없음', () => {
    const item = { d: 650, modules: [{ id: 1, pos: 'lower', w: 600 }], specs: { lowerLayoutShape: 'I' } };
    migrateCornerModules(item);
    expect(item.modules).toHaveLength(1);
  });
});

describe('W10-3: distributeBlindLine — 도어 우선 분배 (§4.2)', () => {
  // 확정 예시 1970: doorAvail 1200, nDoors 3, doorW 400 → 수납 예산 800
  const derived1970 = deriveCorner({ lineW: 1970, adjTopD: 650, blindLineTopD: 650 });

  test('수납 2모듈(1도어씩) → 각 400, 예산 800 소진', () => {
    const mods = [
      { id: 'a', doorCount: 1, w: 999 },
      { id: 'b', doorCount: 1, w: 1 },
    ];
    const budget = distributeBlindLine(mods, derived1970);
    expect(budget).toBe(800);
    expect(mods[0].w).toBe(400);
    expect(mods[1].w).toBe(400);
  });

  test('2도어장: W = 도어 수 × doorW = 800', () => {
    const mods = [{ id: 'a', doorCount: 2, w: 0 }];
    distributeBlindLine(mods, derived1970);
    expect(mods[0].w).toBe(800);
  });

  test('반올림 잔여는 마지막 모듈이 흡수 (몰딩 100 → doorW 386, 잔여 2)', () => {
    const d = deriveCorner({ lineW: 1970, adjTopD: 650, blindLineTopD: 650, molding: 100 });
    expect(d.doorW).toBe(386);
    const mods = [
      { id: 'a', doorCount: 1, w: 0 },
      { id: 'b', doorCount: 1, w: 0 },
    ];
    const budget = distributeBlindLine(mods, d); // 예산 = 1160 − 386 = 774
    expect(budget).toBe(774);
    expect(mods[0].w).toBe(386);
    expect(mods[1].w).toBe(388); // 386 + 잔여 2
    expect(mods[0].w + mods[1].w).toBe(budget);
  });

  test('doorCount 없는 모듈은 1도어로 간주', () => {
    const mods = [{ id: 'a', w: 0 }, { id: 'b', w: 0 }];
    distributeBlindLine(mods, derived1970);
    expect(mods[0].w).toBe(400);
    expect(mods[1].w).toBe(400);
  });
});

describe('W10-3: assertCornerLedger — 원장 불변식 (§4.3)', () => {
  function makeLedgerItem() {
    return {
      modules: [
        { id: 'corner-blind-lower', pos: 'lower', line: 'secondary', w: 1100 },
        { id: 's0', pos: 'lower', line: 'secondary', w: 400 },
        { id: 's1', pos: 'lower', line: 'secondary', w: 400 },
        { id: 1, pos: 'lower', w: 1000 }, // prime — 원장 무관
      ],
      specs: { lowerSecondaryW: '1970' },
    };
  }

  test('성립: EP20 + 800 + 1100 + 50 === 1970 → ok', () => {
    const r = assertCornerLedger(makeLedgerItem(), 'lower');
    expect(r.ok).toBe(true);
    expect(r.diff).toBe(0);
  });

  test('위반: 마지막 수납 모듈 보정 (프로덕션)', () => {
    const item = makeLedgerItem();
    item.modules.find((m) => m.id === 's1').w = 370; // 30mm 부족
    const r = assertCornerLedger(item, 'lower');
    expect(r.ok).toBe(false);
    expect(r.diff).toBe(30);
    expect(r.corrected).toBe(true);
    expect(item.modules.find((m) => m.id === 's1').w).toBe(400); // 보정 후 원장 성립
    expect(assertCornerLedger(item, 'lower').ok).toBe(true);
  });

  test('위반 + strict → throw (개발 모드)', () => {
    const item = makeLedgerItem();
    item.modules.find((m) => m.id === 's0').w = 300;
    expect(() => assertCornerLedger(item, 'lower', { strict: true })).toThrow(/원장 불변식/);
  });

  test('멍장 없는 item은 통과 (ㅡ자 회귀 없음)', () => {
    const item = { modules: [{ id: 1, pos: 'lower', w: 600 }], specs: {} };
    expect(assertCornerLedger(item, 'lower').ok).toBe(true);
  });
});

describe('W10-3: recalcBlindLine — 자동계산 라인 재계산', () => {
  function makeItem() {
    return {
      d: 650,
      modules: [{ id: 1, name: '개수대', type: 'sink', pos: 'lower', w: 1000 }],
      specs: {
        lowerLayoutShape: 'L',
        lowerSecondaryW: '1970',
        lowerSecondaryD: '650',
        secondaryStartSide: 'left',
        lowerH: 870, sinkLegHeight: 150, topThickness: 12,
        topSizes: [{ w: '', d: '650' }],
      },
    };
  }

  test('하부: 시드 → 분배 → 원장 성립 (strict에서도 통과)', () => {
    const item = makeItem();
    const r = recalcBlindLine(item, 'lower', { strict: true });
    expect(r.ledger.ok).toBe(true);
    const blind = item.modules.find((m) => m.id === 'corner-blind-lower');
    const secs = item.modules.filter((m) => String(m.id).startsWith('corner-sec-lower-'));
    const total = 20 + secs.reduce((s, m) => s + m.w, 0) + blind.w + 50;
    expect(total).toBe(1970);
  });

  test('사용자가 수납 폭을 흐트려도 자동계산이 도어 우선으로 재분배', () => {
    const item = makeItem();
    recalcBlindLine(item, 'lower');
    item.modules.find((m) => m.id === 'corner-sec-lower-0').w = 555; // 사용자 수정
    const r = recalcBlindLine(item, 'lower', { strict: true });
    expect(r.ledger.ok).toBe(true);
    expect(item.modules.find((m) => m.id === 'corner-sec-lower-0').w).toBe(400); // 재분배
  });

  test('상부: secondaryUpperEnabled=false → null (재계산 생략)', () => {
    const item = makeItem();
    item.specs.secondaryUpperEnabled = false;
    expect(recalcBlindLine(item, 'upper')).toBeNull();
  });

  test('상부: 1800 원장 성립 (멍 380 + 도어 450×3)', () => {
    const item = makeItem();
    item.specs.upperLayoutShape = 'L';
    item.specs.upperSecondaryW = '1800';
    item.specs.upperSecondaryD = '295';
    item.specs.upperH = 720;
    const r = recalcBlindLine(item, 'upper', { strict: true });
    expect(r.ledger.ok).toBe(true);
    expect(r.derived.blindZoneW).toBe(380);
    expect(r.derived.doorW).toBe(450);
  });
});

describe('W10-3: cornerAdjOffset — 인접(prime) 라인 예산 offset (§3.7)', () => {
  const specs = {
    lowerLayoutShape: 'L',
    lowerSecondaryW: '1970', lowerSecondaryD: '650',
    upperSecondaryW: '1800', upperSecondaryD: '295',
    topSizes: [{ w: '', d: '650' }, { w: '', d: '650' }],
  };

  test('하부: 650 − 10 + 60 = 700', () => {
    expect(cornerAdjOffset({ d: 650, modules: [], specs }, 'lower')).toBe(700);
  });

  test('상부: 320 + 60 = 380 (물끊기 없음)', () => {
    expect(cornerAdjOffset({ d: 650, modules: [], specs }, 'upper')).toBe(380);
  });

  test('몰딩 100 → 하부 offset 740 연동', () => {
    const s = Object.assign({}, specs, { finishCorner1Width: '100' });
    expect(cornerAdjOffset({ d: 650, modules: [], specs: s }, 'lower')).toBe(740);
  });
});
