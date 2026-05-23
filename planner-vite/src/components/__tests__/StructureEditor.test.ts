// ═══════════════════════════════════════════════════════════════
// StructureEditor.test.ts — W6-4 헬퍼 단위 테스트
//
// autoDistributeModules 와 groupBySection 의 핵심 로직 검증.
// RTL 미설치 → 컴포넌트 자체 인터랙션은 디자이너 PC 수동 검증.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { autoDistributeModules, groupBySection } from '../StructureEditor';
import type { ModuleEntryV2 } from '../../lib/planner';

const mod = (id: string, overrides: Partial<ModuleEntryV2> = {}): ModuleEntryV2 => ({
  id,
  segmentId: 'prime',
  section: 'lower',
  kind: 'door',
  width: 600,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────
// 1. autoDistributeModules
// ─────────────────────────────────────────────────────────────

describe('autoDistributeModules', () => {
  it('3000mm / 4 = 750mm × 4 모듈', () => {
    const mods = autoDistributeModules('prime', 'lower', 3000, 4);
    expect(mods).toHaveLength(4);
    expect(mods.every((m) => m.width === 750)).toBe(true);
    expect(mods.every((m) => m.segmentId === 'prime')).toBe(true);
    expect(mods.every((m) => m.section === 'lower')).toBe(true);
  });

  it('2400mm / 3 = 800mm × 3', () => {
    const mods = autoDistributeModules('prime', 'upper', 2400, 3);
    expect(mods).toHaveLength(3);
    expect(mods.every((m) => m.width === 800)).toBe(true);
  });

  it('너비 1300mm / 4 = 325 → snap 50 → 350', () => {
    const mods = autoDistributeModules('prime', 'lower', 1300, 4);
    expect(mods).toHaveLength(4);
    expect(mods.every((m) => m.width === 350)).toBe(true);
  });

  it('너비 1100mm / 4 = 275 → snap → 300 (min clamp 발동)', () => {
    const mods = autoDistributeModules('prime', 'lower', 1100, 4);
    expect(mods.every((m) => m.width === 300)).toBe(true);
  });

  it('count 0 → 최소 1개로 보정', () => {
    const mods = autoDistributeModules('prime', 'lower', 3000, 0);
    expect(mods).toHaveLength(1);
  });

  it('5000mm / 1 = 5000 → max clamp 1200', () => {
    const mods = autoDistributeModules('prime', 'lower', 5000, 1);
    expect(mods).toHaveLength(1);
    expect(mods[0].width).toBe(1200);
  });

  it('defaultKind=drawer 적용', () => {
    const mods = autoDistributeModules('prime', 'lower', 2400, 3, 'drawer');
    expect(mods.every((m) => m.kind === 'drawer')).toBe(true);
  });

  it('upper section 은 기본 door (sink-cook 같은 후드 처리 후속 cycle)', () => {
    const mods = autoDistributeModules('prime', 'upper', 2400, 3);
    expect(mods.every((m) => m.section === 'upper')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. groupBySection — segment 별 section 필터링
// ─────────────────────────────────────────────────────────────

describe('groupBySection', () => {
  const modules: ModuleEntryV2[] = [
    mod('p1', { segmentId: 'prime', section: 'lower' }),
    mod('p2', { segmentId: 'prime', section: 'lower' }),
    mod('p3', { segmentId: 'prime', section: 'upper' }),
    mod('s1', { segmentId: 'secondary', section: 'lower' }),
    mod('t1', { segmentId: 'prime', section: 'tall' }),
  ];

  it("prime segment 의 lower 만 추출 (2개)", () => {
    const grouped = groupBySection(modules, 'prime');
    expect(grouped.lower).toHaveLength(2);
    expect(grouped.lower.map((m) => m.id)).toEqual(['p1', 'p2']);
  });

  it("prime segment 의 upper 1개", () => {
    const grouped = groupBySection(modules, 'prime');
    expect(grouped.upper).toHaveLength(1);
    expect(grouped.upper[0].id).toBe('p3');
  });

  it("prime segment 의 tall 1개", () => {
    const grouped = groupBySection(modules, 'prime');
    expect(grouped.tall).toHaveLength(1);
    expect(grouped.tall[0].id).toBe('t1');
  });

  it("secondary segment 는 lower 만 (1개), upper/tall 빈 배열", () => {
    const grouped = groupBySection(modules, 'secondary');
    expect(grouped.lower).toHaveLength(1);
    expect(grouped.upper).toHaveLength(0);
    expect(grouped.tall).toHaveLength(0);
  });

  it("존재하지 않는 segmentId → 모든 section 빈 배열", () => {
    const grouped = groupBySection(modules, 'unknown');
    expect(grouped.lower).toHaveLength(0);
    expect(grouped.upper).toHaveLength(0);
    expect(grouped.tall).toHaveLength(0);
  });
});
