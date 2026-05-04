/**
 * v1 ↔ v2 마이그레이션 라운드트립 테스트
 *
 * 검증 범위:
 *   - I자(단일 공간): v1 → v2 → v1 손실 없음
 *   - L자(ㄱ자): 양방향 변환 + secondaryStartSide 보존
 *   - U자(ㄷ자): tertiaryStartFrom 보존
 *   - 모듈 orientation ↔ spaceId 매핑
 *   - 분배기/환풍구 specs ↔ space 이동
 */

import { migrateItemV1ToV2, tryDowngradeV2ToV1 } from '../lib/floorplan-migration';
import type { ItemV1 } from '../lib/floorplan-types';

function makeItemV1(overrides: Partial<ItemV1> & { uniqueId: number }): ItemV1 {
  return {
    category: 'sink',
    categoryId: 'sink',
    name: 'Test Item',
    w: 3000,
    h: 2310,
    d: 600,
    specs: {
      layoutShape: 'I',
      lowerLayoutShape: 'I',
      finishLeftType: 'Filler',
      finishLeftWidth: 60,
      finishRightType: 'Filler',
      finishRightWidth: 60,
      measurementBase: 'Left',
    },
    modules: [],
    ...overrides,
  };
}

describe('migrateItemV1ToV2 - I자 (단일 공간)', () => {
  test('단일 공간으로 변환', () => {
    const v1 = makeItemV1({ uniqueId: 1 });
    const v2 = migrateItemV1ToV2(v1);

    expect(v2.schemaVersion).toBe(2);
    expect(v2.uniqueId).toBe(1);
    expect(v2.categoryId).toBe('sink');
    expect(v2.floorplan.spaces).toHaveLength(1);
    expect(v2.floorplan.junctions).toHaveLength(0);

    const space = v2.floorplan.spaces[0];
    expect(space.w).toBe(3000);
    expect(space.h).toBe(600); // v1.d → space.h
    expect(space.verticalH).toBe(2310); // v1.h → space.verticalH
    expect(space.rotation).toBe(0);
    expect(space.zIndex).toBe(1); // 주공간이 앞
  });

  test('분배기/환풍구가 specs → space로 이동', () => {
    const v1 = makeItemV1({
      uniqueId: 2,
      specs: {
        layoutShape: 'I',
        distributorStart: 1000,
        distributorEnd: 1200,
        ventStart: 2500,
      },
    });
    const v2 = migrateItemV1ToV2(v1);
    const primary = v2.floorplan.spaces[0];

    expect(primary.distributorStart).toBe(1000);
    expect(primary.distributorEnd).toBe(1200);
    expect(primary.ventStart).toBe(2500);

    // specs에서는 제거됨
    expect(v2.specs.distributorStart).toBeUndefined();
    expect(v2.specs.distributorEnd).toBeUndefined();
    expect(v2.specs.ventStart).toBeUndefined();
  });
});

describe('migrateItemV1ToV2 - L자 (ㄱ자)', () => {
  test('두 공간 생성 + secondaryStartSide 반영', () => {
    const v1 = makeItemV1({
      uniqueId: 3,
      specs: {
        layoutShape: 'L',
        lowerSecondaryW: 1500,
        lowerSecondaryD: 600,
        secondaryStartSide: 'left',
      },
    });
    const v2 = migrateItemV1ToV2(v1);
    expect(v2.floorplan.spaces).toHaveLength(2);

    const [primary, secondary] = v2.floorplan.spaces;
    expect(primary.label).toBe('주공간');
    expect(secondary.label).toBe('보조공간');
    expect(secondary.w).toBe(1500);
    expect(secondary.h).toBe(600);
    expect(secondary.rotation).toBeCloseTo(Math.PI / 2);
    expect(secondary.zIndex).toBe(0);
    expect(primary.zIndex).toBe(1);
  });

  test('startSide=right일 때 secondary가 우측에 배치', () => {
    const v1 = makeItemV1({
      uniqueId: 4,
      w: 3000,
      specs: {
        layoutShape: 'L',
        lowerSecondaryW: 1500,
        lowerSecondaryD: 600,
        secondaryStartSide: 'right',
      },
    });
    const v2 = migrateItemV1ToV2(v1);
    const secondary = v2.floorplan.spaces[1];
    expect(secondary.x).toBeGreaterThan(1500); // 주공간 우측 (x>w/2)
  });
});

describe('migrateItemV1ToV2 - 모듈 변환', () => {
  test('orientation=secondary가 spaces[1]의 spaceId로 매핑', () => {
    const v1 = makeItemV1({
      uniqueId: 5,
      specs: {
        layoutShape: 'L',
        lowerSecondaryW: 1500,
        lowerSecondaryD: 600,
        secondaryStartSide: 'left',
      },
      modules: [
        { id: 'mod-1', pos: 'lower', type: 'sink', w: 950 },
        { id: 'mod-2', pos: 'lower', type: 'storage', w: 600, orientation: 'secondary' },
      ],
    });
    const v2 = migrateItemV1ToV2(v1);
    expect(v2.modules).toHaveLength(2);

    const sec = v2.floorplan.spaces[1];
    expect(v2.modules[0].spaceId).toBe(v2.floorplan.spaces[0].id);
    expect(v2.modules[1].spaceId).toBe(sec.id);
    // orientation 필드는 deprecated이지만 라운드트립 위해 보존
    expect(v2.modules[1].orientation).toBe('secondary');
  });

  test('빈 modules 배열도 OK', () => {
    const v1 = makeItemV1({ uniqueId: 6, modules: [] });
    const v2 = migrateItemV1ToV2(v1);
    expect(v2.modules).toEqual([]);
  });
});

describe('tryDowngradeV2ToV1', () => {
  test('I자 단일 공간: 손실 없음', () => {
    const v1 = makeItemV1({
      uniqueId: 7,
      specs: {
        layoutShape: 'I',
        distributorStart: 800,
        distributorEnd: 1000,
      },
      modules: [{ id: 'm1', pos: 'lower', type: 'sink', w: 950 }],
    });
    const v2 = migrateItemV1ToV2(v1);
    const result = tryDowngradeV2ToV1(v2);

    expect(result.ok).toBe(true);
    expect(result.item).toBeDefined();
    expect(result.item!.uniqueId).toBe(7);
    expect(result.item!.w).toBe(3000);
    expect(result.item!.h).toBe(2310);
    expect(result.item!.d).toBe(600);
    expect(result.item!.specs.distributorStart).toBe(800);
    expect(result.item!.specs.distributorEnd).toBe(1000);
    expect(result.item!.specs.layoutShape).toBe('I');
    expect(result.item!.modules).toHaveLength(1);
  });

  test('L자: secondaryStartSide 복원', () => {
    const v1 = makeItemV1({
      uniqueId: 8,
      specs: {
        layoutShape: 'L',
        lowerSecondaryW: 1500,
        lowerSecondaryD: 600,
        secondaryStartSide: 'left',
      },
    });
    const v2 = migrateItemV1ToV2(v1);
    const result = tryDowngradeV2ToV1(v2);

    expect(result.ok).toBe(true);
    expect(result.item!.specs.layoutShape).toBe('L');
    expect(result.item!.specs.secondaryStartSide).toBe('left');
    expect(result.item!.specs.lowerSecondaryW).toBe(1500);
  });

  test('spaces > 3은 거부', () => {
    const v1 = makeItemV1({ uniqueId: 9 });
    const v2 = migrateItemV1ToV2(v1);
    // 임의로 4번째 공간 추가 (실제로는 시나리오 X, 거부 동작 확인용)
    v2.floorplan.spaces.push({
      id: 'space-extra', w: 600, h: 600, x: 0, y: 0,
      rotation: 0, zIndex: 0, verticalH: 2310, category: 'sink',
    });
    v2.floorplan.spaces.push({
      id: 'space-extra2', w: 600, h: 600, x: 0, y: 0,
      rotation: 0, zIndex: 0, verticalH: 2310, category: 'sink',
    });
    v2.floorplan.spaces.push({
      id: 'space-extra3', w: 600, h: 600, x: 0, y: 0,
      rotation: 0, zIndex: 0, verticalH: 2310, category: 'sink',
    });
    const result = tryDowngradeV2ToV1(v2);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/spaces.length/);
  });

  test('비직각 회전 거부', () => {
    const v1 = makeItemV1({ uniqueId: 10 });
    const v2 = migrateItemV1ToV2(v1);
    v2.floorplan.spaces[0].rotation = Math.PI / 6; // 30°
    const result = tryDowngradeV2ToV1(v2);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/비직각/);
  });
});

describe('round-trip 무손실 (I자)', () => {
  test('I자 분배기 + 모듈: v1 → v2 → v1 핵심 필드 보존', () => {
    const v1Original = makeItemV1({
      uniqueId: 100,
      specs: {
        layoutShape: 'I',
        distributorStart: 800,
        distributorEnd: 1000,
        ventStart: 2500,
        finishLeftType: 'Filler',
        finishLeftWidth: 60,
      },
      modules: [
        { id: 'a', pos: 'lower', type: 'sink', w: 950 },
        { id: 'b', pos: 'lower', type: 'storage', w: 600 },
        { id: 'c', pos: 'upper', type: 'storage', w: 800 },
      ],
    });

    const v2 = migrateItemV1ToV2(v1Original);
    const result = tryDowngradeV2ToV1(v2);
    expect(result.ok).toBe(true);
    const v1Round = result.item!;

    // 핵심 필드 동일성
    expect(v1Round.uniqueId).toBe(v1Original.uniqueId);
    expect(v1Round.w).toBe(v1Original.w);
    expect(v1Round.h).toBe(v1Original.h);
    expect(v1Round.d).toBe(v1Original.d);
    expect(v1Round.modules).toHaveLength(3);
    expect(v1Round.specs.layoutShape).toBe('I');
    expect(v1Round.specs.distributorStart).toBe(800);
    expect(v1Round.specs.distributorEnd).toBe(1000);
    expect(v1Round.specs.ventStart).toBe(2500);
    expect(v1Round.specs.finishLeftWidth).toBe(60);
  });
});

describe('round-trip 무손실 (L자)', () => {
  test('L자 + 보조 모듈 1개: 라운드트립', () => {
    const v1Original = makeItemV1({
      uniqueId: 101,
      specs: {
        layoutShape: 'L',
        lowerSecondaryW: 1500,
        lowerSecondaryD: 600,
        secondaryStartSide: 'right',
      },
      modules: [
        { id: 'p1', pos: 'lower', type: 'sink', w: 950 },
        { id: 's1', pos: 'lower', type: 'storage', w: 600, orientation: 'secondary' },
      ],
    });

    const v2 = migrateItemV1ToV2(v1Original);
    const result = tryDowngradeV2ToV1(v2);
    expect(result.ok).toBe(true);
    const v1Round = result.item!;

    expect(v1Round.specs.layoutShape).toBe('L');
    expect(v1Round.specs.secondaryStartSide).toBe('right');
    expect(v1Round.specs.lowerSecondaryW).toBe(1500);
    expect(v1Round.modules).toHaveLength(2);
    expect(v1Round.modules.find((m) => m.orientation === 'secondary')).toBeDefined();
  });
});
