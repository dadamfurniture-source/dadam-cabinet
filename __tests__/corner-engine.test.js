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
