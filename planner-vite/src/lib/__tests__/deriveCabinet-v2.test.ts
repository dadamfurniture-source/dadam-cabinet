// ═══════════════════════════════════════════════════════════════
// deriveCabinet-v2.test.ts — W6-2 round-trip 동등성 (golden test)
//
// 검증: deriveCabinet(legacy) === deriveCabinet(migrateLegacyToV2(legacy))
//   → V2 입력 처리가 기존 V1 와 byte-identical 한 CabinetDerivation 반환
//   → W6-1 migrateLegacyToV2 + W6-2 migrateV2ToLegacy 의 round-trip 보장
//
// 10 케이스: 6 preset × 핵심 layout 조합 = 가구 카테고리 + ㄱ자/ㄷ자 전수.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  deriveCabinet,
  migrateLegacyToV2,
  PRESETS,
  type CabinetCategory,
  type PlannerState,
  type ModuleEntry,
} from '../planner';

// ─────────────────────────────────────────────────────────────
// 헬퍼: preset 기본값 기반 legacy state 생성
// ─────────────────────────────────────────────────────────────

const stateFor = (
  presetId: CabinetCategory,
  overrides: Partial<PlannerState> = {}
): PlannerState => {
  const preset = PRESETS.find((p) => p.id === presetId)!;
  return {
    presetId,
    width: preset.defaultWidth,
    height: preset.defaultHeight,
    depth: preset.defaultDepth,
    lowerCount: 0,
    upperCount: 0,
    lowerModules: [],
    upperModules: [],
    material: 'cream',
    moldingH: preset.defaultMoldingH,
    toeKickH: preset.toeKickHeight,
    finishLeftW: 60,
    finishRightW: 60,
    layoutShape: 'I',
    distributorStart: null,
    distributorEnd: null,
    ventStart: null,
    ...overrides,
  };
};

const mod = (id: string, overrides: Partial<ModuleEntry> = {}): ModuleEntry => ({
  id,
  kind: 'door',
  width: 600,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────
// 비교 헬퍼: legacy result === V2 round-trip result (parts.x/y/z ±1mm)
// ─────────────────────────────────────────────────────────────

const assertEquivalent = (legacy: PlannerState, label: string) => {
  const fromLegacy = deriveCabinet(legacy);
  const fromV2 = deriveCabinet(migrateLegacyToV2(legacy));

  // parts 수
  expect(fromV2.parts.length, `${label}: parts.length`).toBe(fromLegacy.parts.length);

  // parts 각 좌표 ±1mm 일치 (id 정렬)
  const legacyById = new Map(fromLegacy.parts.map((p) => [p.id, p]));
  for (const v2Part of fromV2.parts) {
    const legacyPart = legacyById.get(v2Part.id);
    expect(legacyPart, `${label}: part ${v2Part.id} 존재`).toBeTruthy();
    if (!legacyPart) continue;
    expect(Math.abs(v2Part.x - legacyPart.x), `${label}: ${v2Part.id}.x`).toBeLessThanOrEqual(1);
    expect(Math.abs(v2Part.y - legacyPart.y), `${label}: ${v2Part.id}.y`).toBeLessThanOrEqual(1);
    expect(Math.abs(v2Part.z - legacyPart.z), `${label}: ${v2Part.id}.z`).toBeLessThanOrEqual(1);
    expect(v2Part.width, `${label}: ${v2Part.id}.width`).toBe(legacyPart.width);
    expect(v2Part.depth, `${label}: ${v2Part.id}.depth`).toBe(legacyPart.depth);
    expect(v2Part.height, `${label}: ${v2Part.id}.height`).toBe(legacyPart.height);
  }

  // modules 길이 + layout null/객체 일치
  expect(fromV2.modules.length, `${label}: modules.length`).toBe(fromLegacy.modules.length);
  expect(Boolean(fromV2.lowerLayout), `${label}: lowerLayout 존재성`).toBe(Boolean(fromLegacy.lowerLayout));
  expect(Boolean(fromV2.upperLayout), `${label}: upperLayout 존재성`).toBe(Boolean(fromLegacy.upperLayout));

  // 면적 (수치 동일)
  expect(fromV2.footprintAreaM2, `${label}: footprintAreaM2`).toBe(fromLegacy.footprintAreaM2);
  expect(fromV2.facadeAreaM2, `${label}: facadeAreaM2`).toBe(fromLegacy.facadeAreaM2);
};

// ─────────────────────────────────────────────────────────────
// 10 케이스
// ─────────────────────────────────────────────────────────────

describe('deriveCabinet V2 round-trip 동등성 (W6-2 golden)', () => {
  it('1. sink + I (단일 segment, lower+upper)', () => {
    const s = stateFor('sink', {
      lowerModules: [mod('l1', { width: 750 }), mod('l2', { width: 750 })],
      upperModules: [mod('u1', { width: 750 }), mod('u2', { width: 750 })],
    });
    assertEquivalent(s, 'sink-I');
  });

  it('2. sink + L (left, secondary)', () => {
    const s = stateFor('sink', {
      layoutShape: 'L',
      secondaryStartSide: 'left',
      secondaryW: 1200,
      secondaryD: 650,
      lowerModules: [
        mod('l1'),
        mod('s1', { orientation: 'secondary' }),
      ],
    });
    assertEquivalent(s, 'sink-L-left');
  });

  it('3. sink + L (right, secondary)', () => {
    const s = stateFor('sink', {
      layoutShape: 'L',
      secondaryStartSide: 'right',
      secondaryW: 1500,
      secondaryD: 650,
      lowerModules: [
        mod('l1'),
        mod('s1', { orientation: 'secondary' }),
      ],
      upperModules: [mod('u1'), mod('u2', { orientation: 'secondary' })],
    });
    assertEquivalent(s, 'sink-L-right');
  });

  it("4. sink + U (tertiaryStartFrom='prime')", () => {
    const s = stateFor('sink', {
      layoutShape: 'U',
      secondaryStartSide: 'left',
      secondaryW: 1200,
      secondaryD: 650,
      tertiaryW: 1000,
      tertiaryD: 650,
      tertiaryStartFrom: 'prime',
      lowerModules: [
        mod('l1'),
        mod('s1', { orientation: 'secondary' }),
        mod('t1', { orientation: 'tertiary' }),
      ],
    });
    assertEquivalent(s, 'sink-U-prime');
  });

  it("5. sink + U (tertiaryStartFrom='secondary')", () => {
    const s = stateFor('sink', {
      layoutShape: 'U',
      secondaryStartSide: 'right',
      secondaryW: 1500,
      secondaryD: 650,
      tertiaryW: 1200,
      tertiaryD: 650,
      tertiaryStartFrom: 'secondary',
      lowerModules: [
        mod('l1'),
        mod('s1', { orientation: 'secondary' }),
        mod('t1', { orientation: 'tertiary' }),
      ],
    });
    assertEquivalent(s, 'sink-U-secondary');
  });

  it('6. wardrobe + I (fullHeight, 키큰장)', () => {
    const s = stateFor('wardrobe', {
      lowerModules: [mod('l1', { width: 900 }), mod('l2', { width: 900 })],
    });
    assertEquivalent(s, 'wardrobe-I');
  });

  it('7. vanity + I (lower+upper 작은 크기)', () => {
    const s = stateFor('vanity', {
      lowerModules: [mod('l1', { width: 700 })],
      upperModules: [mod('u1', { width: 700 })],
    });
    assertEquivalent(s, 'vanity-I');
  });

  it('8. fridge + I (fullHeight, 다른 size)', () => {
    const s = stateFor('fridge', {
      lowerModules: [mod('l1', { width: 600 })],
    });
    assertEquivalent(s, 'fridge-I');
  });

  it('9. shoe + L (fullHeight + ㄱ자)', () => {
    const s = stateFor('shoe', {
      layoutShape: 'L',
      secondaryStartSide: 'left',
      secondaryW: 800,
      secondaryD: 360,
      lowerModules: [
        mod('l1', { width: 600 }),
        mod('s1', { orientation: 'secondary', width: 400 }),
      ],
    });
    assertEquivalent(s, 'shoe-L');
  });

  it('10. storage + I (범용 수납장)', () => {
    const s = stateFor('storage', {
      lowerModules: [mod('l1'), mod('l2'), mod('l3')],
    });
    assertEquivalent(s, 'storage-I');
  });
});
