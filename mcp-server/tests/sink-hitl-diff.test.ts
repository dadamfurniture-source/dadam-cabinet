import { describe, it, expect } from 'vitest';
import { computeSinkDiff, tagHistogram } from '../src/services/sink-hitl-diff.service.js';
import type { SinkDesign, SinkEnv, SinkModule } from '../src/schemas/sink-hitl.schemas.js';

const baseEnv: SinkEnv = {
  width: 3000,
  height: 2400,
  depth: 600,
  finishLeftW: 0,
  finishRightW: 0,
  moldingH: 60,
  toeKickH: 100,
  distributorStart: null,
  distributorEnd: null,
  ventStart: 1800,
  ventEnd: 2400,
  measurementBase: 'left',
};

function mkModule(overrides: Partial<SinkModule> & { idx: number; width: number }): SinkModule {
  return {
    idx: overrides.idx,
    width: overrides.width,
    kind: overrides.kind ?? 'door',
    type: overrides.type ?? 'storage',
    ...(overrides.doorCount !== undefined ? { doorCount: overrides.doorCount } : {}),
    ...(overrides.drawerCount !== undefined ? { drawerCount: overrides.drawerCount } : {}),
  };
}

function mkDesign(lower: SinkModule[], upper: SinkModule[] = [], env: SinkEnv = baseEnv): SinkDesign {
  return {
    id: 'test',
    timestamp: '2026-01-01T00:00:00Z',
    version: 'v1',
    env,
    lower,
    upper,
    meta: { generated_by: 'random' },
  };
}

describe('computeSinkDiff', () => {
  it('returns empty diff for identical designs', () => {
    const d = mkDesign([
      mkModule({ idx: 0, width: 1000, type: 'sink' }),
      mkModule({ idx: 1, width: 600, type: 'cook', kind: 'drawer' }),
    ]);
    const ops = computeSinkDiff(d, d);
    expect(ops).toEqual([]);
  });

  it('detects width change with proper tag', () => {
    const g = mkDesign([mkModule({ idx: 0, width: 1000, type: 'sink' })]);
    const c = mkDesign([mkModule({ idx: 0, width: 950, type: 'sink' })]);
    const ops = computeSinkDiff(g, c);
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('replace');
    expect(ops[0].tag).toBe('lower-sink-width-fix');
    expect(ops[0].from).toBe(1000);
    expect(ops[0].to).toBe(950);
  });

  it('detects kind change (door → drawer)', () => {
    const g = mkDesign([mkModule({ idx: 0, width: 600, type: 'cook', kind: 'door' })]);
    const c = mkDesign([mkModule({ idx: 0, width: 600, type: 'cook', kind: 'drawer' })]);
    const ops = computeSinkDiff(g, c);
    const kindOps = ops.filter(o => o.path.endsWith('/kind'));
    expect(kindOps).toHaveLength(1);
    expect(kindOps[0].tag).toContain('cook-kind-fix-door-to-drawer');
  });

  it('detects module reorder (move)', () => {
    const g = mkDesign([
      mkModule({ idx: 0, width: 200, type: 'lt' }),
      mkModule({ idx: 1, width: 1000, type: 'sink' }),
    ]);
    const c = mkDesign([
      mkModule({ idx: 0, width: 1000, type: 'sink' }),
      mkModule({ idx: 1, width: 200, type: 'lt' }),
    ]);
    const ops = computeSinkDiff(g, c);
    const moves = ops.filter(o => o.op === 'move');
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.some(m => m.tag.includes('reorder'))).toBe(true);
  });

  it('detects env utility position fix', () => {
    const g = mkDesign([], [], { ...baseEnv, ventStart: 1800 });
    const c = mkDesign([], [], { ...baseEnv, ventStart: 2000 });
    const ops = computeSinkDiff(g, c);
    expect(ops.some(o => o.tag === 'env-ventStart-fix')).toBe(true);
  });

  it('detects module add/remove', () => {
    const g = mkDesign([mkModule({ idx: 0, width: 600, type: 'storage' })]);
    const c = mkDesign([
      mkModule({ idx: 0, width: 600, type: 'storage' }),
      mkModule({ idx: 1, width: 400, type: 'drawer', kind: 'drawer' }),
    ]);
    const ops = computeSinkDiff(g, c);
    expect(ops.some(o => o.op === 'add')).toBe(true);
  });

  it('tagHistogram aggregates tag counts', () => {
    const g = mkDesign([
      mkModule({ idx: 0, width: 1000, type: 'sink' }),
      mkModule({ idx: 1, width: 300, type: 'lt' }),
    ]);
    const c = mkDesign([
      mkModule({ idx: 0, width: 900, type: 'sink' }),
      mkModule({ idx: 1, width: 200, type: 'lt' }),
    ]);
    const ops = computeSinkDiff(g, c);
    const hist = tagHistogram(ops);
    expect(hist['lower-sink-width-fix']).toBe(1);
    expect(hist['lower-lt-width-fix']).toBe(1);
  });
});
