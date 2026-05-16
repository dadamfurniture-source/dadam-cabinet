// ═══════════════════════════════════════════════════════════════
// coords.ts 단위 테스트 — W4-3 V1 ↔ V2 좌표 변환
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { migratePartV1ToV2, migratePartV2ToV1 } from '../coords';
import type { CabinetPart, CabinetPartV2 } from '../planner';

const baseV1: CabinetPart = {
  id: 'mod-1',
  label: 'test',
  x: 0,
  y: 450,
  z: 200,
  width: 600,
  height: 800,
  depth: 580,
  colorKey: 'body',
};

const baseV2: CabinetPartV2 = {
  id: 'mod-1',
  label: 'test',
  x: -300,    // 0 - 600/2
  y: -90,     // 200 - 580/2 (V1.z=200 → V2.y center, dim=580 → corner=-90)
  z: 50,      // 450 - 800/2 (V1.y=450 → V2.z center, dim=800 → corner=50)
  width: 600,
  depth: 580,
  height: 800,
  colorKey: 'body',
};

describe('migratePartV1ToV2', () => {
  it('center → corner + Y-up → Z-up swap', () => {
    const v2 = migratePartV1ToV2(baseV1);
    expect(v2.x).toBe(baseV2.x);
    expect(v2.y).toBe(baseV2.y);
    expect(v2.z).toBe(baseV2.z);
    expect(v2.width).toBe(600);
    expect(v2.depth).toBe(580);
    expect(v2.height).toBe(800);
  });

  it('rotationY radians → rotationZDeg degrees (부호 보존)', () => {
    const v2 = migratePartV1ToV2({ ...baseV1, rotationY: Math.PI / 2 });
    expect(v2.rotationZDeg).toBeCloseTo(90, 6);
    const v2neg = migratePartV1ToV2({ ...baseV1, rotationY: -Math.PI / 2 });
    expect(v2neg.rotationZDeg).toBeCloseTo(-90, 6);
  });

  it('rotationY 없으면 rotationZDeg 도 undefined', () => {
    const v2 = migratePartV1ToV2(baseV1);
    expect(v2.rotationZDeg).toBeUndefined();
  });

  it('moduleType/moduleKind/doorCount/drawerCount 보존', () => {
    const v1: CabinetPart = {
      ...baseV1,
      moduleType: 'sink',
      moduleKind: 'door',
      doorCount: 2,
      drawerCount: 0,
      wireframe: false,
      essential: true,
    };
    const v2 = migratePartV1ToV2(v1);
    expect(v2.moduleType).toBe('sink');
    expect(v2.moduleKind).toBe('door');
    expect(v2.doorCount).toBe(2);
    expect(v2.drawerCount).toBe(0);
    expect(v2.wireframe).toBe(false);
    expect(v2.essential).toBe(true);
  });
});

describe('migratePartV2ToV1', () => {
  it('corner → center + Z-up → Y-up swap', () => {
    const v1 = migratePartV2ToV1(baseV2);
    expect(v1.x).toBe(baseV1.x);
    expect(v1.y).toBe(baseV1.y);
    expect(v1.z).toBe(baseV1.z);
    expect(v1.width).toBe(600);
    expect(v1.height).toBe(800);
    expect(v1.depth).toBe(580);
  });

  it('rotationZDeg degrees → rotationY radians', () => {
    const v1 = migratePartV2ToV1({ ...baseV2, rotationZDeg: 90 });
    expect(v1.rotationY).toBeCloseTo(Math.PI / 2, 6);
    const v1neg = migratePartV2ToV1({ ...baseV2, rotationZDeg: -90 });
    expect(v1neg.rotationY).toBeCloseTo(-Math.PI / 2, 6);
  });
});

describe('V1 ↔ V2 round-trip 동일성', () => {
  const cases: CabinetPart[] = [
    baseV1,
    { ...baseV1, rotationY: Math.PI / 2 },
    { ...baseV1, rotationY: -Math.PI / 2 },
    { ...baseV1, x: -1234.5, y: 999.9, z: 0.1, width: 1, height: 1, depth: 1 },
    { ...baseV1, moduleType: 'cook', isDoor: true, parentModuleId: 'p1', doorIndex: 0, openDirection: 'left' },
  ];

  for (const v1 of cases) {
    it(`round-trip preserves V1 (${v1.id} rotationY=${v1.rotationY ?? 'none'})`, () => {
      const v2 = migratePartV1ToV2(v1);
      const back = migratePartV2ToV1(v2);
      expect(back.x).toBeCloseTo(v1.x, 6);
      expect(back.y).toBeCloseTo(v1.y, 6);
      expect(back.z).toBeCloseTo(v1.z, 6);
      expect(back.width).toBe(v1.width);
      expect(back.height).toBe(v1.height);
      expect(back.depth).toBe(v1.depth);
      if (v1.rotationY != null) {
        expect(back.rotationY).toBeCloseTo(v1.rotationY, 6);
      } else {
        expect(back.rotationY).toBeUndefined();
      }
    });
  }
});
