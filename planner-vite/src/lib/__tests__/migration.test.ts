// ═══════════════════════════════════════════════════════════════
// migration.test.ts — W6-1 PlannerState V1 → V2 마이그레이션
//   - layoutShape (I/L/U) → segments[]
//   - lowerModules/upperModules (+ orientation) → modulesV2[] (+ section)
//   - preset.fullHeight=true → 기본 section='tall'
//   - blind-corner / corner-filler → segment edge 로 대체 (modules 에서 제거)
//   - 이미 V2 인 state idempotent
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  migrateLegacyToV2,
  isV2State,
  type PlannerState,
  type ModuleEntry,
} from '../planner';

// ─────────────────────────────────────────────────────────────
// 헬퍼: 기본 legacy state (sink, layoutShape='I', 빈 모듈)
// ─────────────────────────────────────────────────────────────

const baseLegacy = (overrides: Partial<PlannerState> = {}): PlannerState => ({
  presetId: 'sink',
  width: 3000,
  height: 2300,
  depth: 650,
  lowerCount: 0,
  upperCount: 0,
  lowerModules: [],
  upperModules: [],
  material: 'cream',
  moldingH: 60,
  toeKickH: 150,
  finishLeftW: 60,
  finishRightW: 60,
  layoutShape: 'I',
  distributorStart: null,
  distributorEnd: null,
  ventStart: null,
  ...overrides,
});

const mod = (id: string, overrides: Partial<ModuleEntry> = {}): ModuleEntry => ({
  id,
  kind: 'door',
  width: 600,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────
// 1. layoutShape='I' — 단일 segment prime
// ─────────────────────────────────────────────────────────────

describe('migrateLegacyToV2 — layoutShape', () => {
  it("I = 단일 'prime' segment, width/depth 동일", () => {
    const legacy = baseLegacy({ width: 3000, depth: 650 });
    const v2 = migrateLegacyToV2(legacy);

    expect(isV2State(v2)).toBe(true);
    expect(v2.segments).toHaveLength(1);
    expect(v2.segments![0]).toMatchObject({
      id: 'prime',
      x: 0,
      y: 0,
      width: 3000,
      depth: 650,
      rotationDeg: 0,
    });
  });

  it("L (left) = prime + secondary at x=-secondaryD", () => {
    const legacy = baseLegacy({
      layoutShape: 'L',
      secondaryStartSide: 'left',
      secondaryW: 1200,
      secondaryD: 600,
    });
    const v2 = migrateLegacyToV2(legacy);

    expect(v2.segments).toHaveLength(2);
    expect(v2.segments![1]).toMatchObject({
      id: 'secondary',
      x: -600,           // -secondaryD
      y: 0,
      width: 600,        // secondaryD
      depth: 1200,       // secondaryW
      rotationDeg: 0,
    });
  });

  it("L (right) = prime + secondary at x=state.width", () => {
    const legacy = baseLegacy({
      width: 3000,
      layoutShape: 'L',
      secondaryStartSide: 'right',
      secondaryW: 1500,
      secondaryD: 650,
    });
    const v2 = migrateLegacyToV2(legacy);

    expect(v2.segments).toHaveLength(2);
    expect(v2.segments![1]).toMatchObject({
      id: 'secondary',
      x: 3000,           // s.width
      y: 0,
      width: 650,        // secondaryD
      depth: 1500,       // secondaryW
    });
  });

  it("U (tertiaryStartFrom='prime') = prime + secondary + tertiary at prime 반대편", () => {
    const legacy = baseLegacy({
      width: 3000,
      layoutShape: 'U',
      secondaryStartSide: 'left',
      secondaryW: 1200,
      secondaryD: 600,
      tertiaryW: 1000,
      tertiaryD: 600,
      tertiaryStartFrom: 'prime',
    });
    const v2 = migrateLegacyToV2(legacy);

    expect(v2.segments).toHaveLength(3);
    expect(v2.segments![2]).toMatchObject({
      id: 'tertiary',
      x: 3000,           // secondaryStartSide='left' → 반대편 = s.width
      y: 0,
      width: 600,
      depth: 1000,
    });
  });

  it("U (tertiaryStartFrom='secondary') = tertiary 가 secondary 끝에서 연장", () => {
    const legacy = baseLegacy({
      width: 3000,
      layoutShape: 'U',
      secondaryStartSide: 'right',
      secondaryW: 1500,
      secondaryD: 650,
      tertiaryW: 1200,
      tertiaryD: 650,
      tertiaryStartFrom: 'secondary',
    });
    const v2 = migrateLegacyToV2(legacy);

    expect(v2.segments).toHaveLength(3);
    const tertiary = v2.segments![2];
    // secondary.x=3000, secondary.depth=1500 → tertiary 는 (3000, 1500) 에서 시작
    expect(tertiary.id).toBe('tertiary');
    expect(tertiary.x).toBe(3000);
    expect(tertiary.y).toBe(1500);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. preset.fullHeight=true → 기본 section='tall'
// ─────────────────────────────────────────────────────────────

describe('migrateLegacyToV2 — section 매핑', () => {
  it("preset.fullHeight=false (sink) → lowerModules → section='lower'", () => {
    const legacy = baseLegacy({
      lowerModules: [mod('m1'), mod('m2')],
      upperModules: [mod('m3'), mod('m4')],
    });
    const v2 = migrateLegacyToV2(legacy);

    expect(v2.modulesV2).toHaveLength(4);
    expect(v2.modulesV2!.filter((m) => m.section === 'lower')).toHaveLength(2);
    expect(v2.modulesV2!.filter((m) => m.section === 'upper')).toHaveLength(2);
  });

  it("preset.fullHeight=true (wardrobe) → lowerModules → section='tall'", () => {
    const legacy = baseLegacy({
      presetId: 'wardrobe',
      lowerModules: [mod('m1'), mod('m2'), mod('m3')],
    });
    const v2 = migrateLegacyToV2(legacy);

    expect(v2.modulesV2).toHaveLength(3);
    expect(v2.modulesV2!.every((m) => m.section === 'tall')).toBe(true);
    expect(v2.modulesV2!.every((m) => m.segmentId === 'prime')).toBe(true);
  });

  it("orientation='secondary' → segmentId='secondary'", () => {
    const legacy = baseLegacy({
      layoutShape: 'L',
      secondaryStartSide: 'right',
      secondaryW: 1200,
      secondaryD: 650,
      lowerModules: [
        mod('m1'),                                  // prime
        mod('m2', { orientation: 'secondary' }),    // secondary
      ],
    });
    const v2 = migrateLegacyToV2(legacy);

    const primeMod = v2.modulesV2!.find((m) => m.id === 'm1');
    const secondaryMod = v2.modulesV2!.find((m) => m.id === 'm2');
    expect(primeMod?.segmentId).toBe('prime');
    expect(secondaryMod?.segmentId).toBe('secondary');
  });
});

// ─────────────────────────────────────────────────────────────
// 3. blind-corner / corner-filler 제거
// ─────────────────────────────────────────────────────────────

describe('migrateLegacyToV2 — 코너 필러 제거', () => {
  it("moduleType='blind-corner' / 'corner-filler' 는 modulesV2 에서 제외", () => {
    const legacy = baseLegacy({
      lowerModules: [
        mod('m1'),
        mod('blind1', { moduleType: 'blind-corner' }),
        mod('m2'),
        mod('corner1', { moduleType: 'corner-filler' }),
      ],
    });
    const v2 = migrateLegacyToV2(legacy);

    expect(v2.modulesV2).toHaveLength(2);
    expect(v2.modulesV2!.map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Idempotent — 이미 V2 면 그대로
// ─────────────────────────────────────────────────────────────

describe('migrateLegacyToV2 — idempotent', () => {
  it('이미 V2 인 state 를 다시 통과시켜도 동일', () => {
    const legacy = baseLegacy({
      lowerModules: [mod('m1'), mod('m2')],
    });
    const v2 = migrateLegacyToV2(legacy);
    const v2Again = migrateLegacyToV2(v2);

    expect(v2Again).toBe(v2);        // 동일 reference 반환 (수정 없음)
    expect(isV2State(v2Again)).toBe(true);
  });

  it('isV2State 는 schemaVersion + segments + modulesV2 모두 필요', () => {
    const legacy = baseLegacy();
    expect(isV2State(legacy)).toBe(false);                          // schemaVersion 없음
    expect(isV2State({ ...legacy, schemaVersion: 2 })).toBe(false); // segments/modulesV2 없음
    expect(
      isV2State({
        ...legacy,
        schemaVersion: 2,
        segments: [],
        modulesV2: [],
      })
    ).toBe(true);
  });
});
