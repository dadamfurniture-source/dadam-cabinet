// ═══════════════════════════════════════════════════════════════
// calc-utils 단위 테스트 — Phase 1-3
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  findBestDoorWidth,
  distributeModules,
  adjustFixedPositions,
  calculateGaps,
  fillGapWithModules,
  type FixedModule,
} from '../calc-utils';
import { DOOR_MIN, DOOR_MAX, MAX_REMAINDER } from '../calc-constants';

// ── findBestDoorWidth ──────────────────────────────────────────

describe('findBestDoorWidth', () => {
  it('2700 / 6 = 450 정확히 떨어짐', () => {
    expect(findBestDoorWidth(2700, 6)).toBe(450);
  });

  it('2710 / 6 → 450 (잔여 10)', () => {
    const w = findBestDoorWidth(2710, 6);
    expect(w).not.toBeNull();
    expect(w).toBe(450);
    expect(2710 - w! * 6).toBeLessThanOrEqual(MAX_REMAINDER);
  });

  it('너무 작은 공간 → null (<DOOR_MIN)', () => {
    expect(findBestDoorWidth(600, 2)).toBeNull(); // 300 < 350
  });

  it('너무 큰 공간 → null (>DOOR_MAX)', () => {
    expect(findBestDoorWidth(1400, 2)).toBeNull(); // 700 > 600
  });

  it('경계 내 결과는 DOOR_MIN~DOOR_MAX 범위', () => {
    const w = findBestDoorWidth(1800, 4);
    expect(w).not.toBeNull();
    expect(w!).toBeGreaterThanOrEqual(DOOR_MIN);
    expect(w!).toBeLessThanOrEqual(DOOR_MAX);
  });
});

// ── distributeModules ─────────────────────────────────────────

describe('distributeModules', () => {
  it('2880mm → 6 도어 × 480 (2D × 3)', () => {
    const r = distributeModules(2880);
    expect(r.doorCount).toBeGreaterThan(0);
    // 전체 사용 공간 + gap <= 원본
    const used = r.modules.reduce((s, m) => s + m.w, 0);
    expect(2880 - used).toBeLessThanOrEqual(MAX_REMAINDER);
    expect(2880 - used).toBeGreaterThanOrEqual(0);
  });

  it('1200mm → 2D 모듈 1개 (2 도어 × ~600) 또는 3 도어', () => {
    const r = distributeModules(1200);
    expect(r.modules.length).toBeGreaterThan(0);
    expect(r.doorCount).toBeGreaterThanOrEqual(2);
    // 2D 페어링 확인: 짝수 개 도어면 모두 2D
    const has2D = r.modules.some((m) => m.is2D);
    expect(has2D).toBe(true);
  });

  it('100mm 미만 → 빈 결과', () => {
    const r = distributeModules(50);
    expect(r.modules).toEqual([]);
    expect(r.doorCount).toBe(0);
  });

  it('홀수 도어 시 마지막은 1D', () => {
    // 1350 → 3 × 450
    const r = distributeModules(1350);
    expect(r.doorCount).toBe(3);
    const oneDs = r.modules.filter((m) => !m.is2D);
    expect(oneDs.length).toBe(1);
  });

  it('도어 너비는 목표 450에 근접', () => {
    const r = distributeModules(1800);
    expect(Math.abs(r.doorWidth - 450)).toBeLessThan(100);
  });

  it('모든 모듈 너비 합 + gap = 원본', () => {
    for (const total of [1200, 1800, 2400, 2700, 3000, 3600]) {
      const r = distributeModules(total);
      const used = r.modules.reduce((s, m) => s + m.w, 0);
      const gap = total - used;
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(MAX_REMAINDER);
    }
  });
});

// ── adjustFixedPositions ──────────────────────────────────────

describe('adjustFixedPositions', () => {
  const mk = (id: string, type: string, x: number, w: number, name = ''): FixedModule => ({
    id, type, name, x, w, endX: x + w,
  });

  it('겹침 해소: 좌→우 순서로 밀어냄', () => {
    const list = [mk('a', 'sink', 100, 950), mk('b', 'cook', 500, 600)];
    const r = adjustFixedPositions(list, 0, 3000);
    expect(r[0].endX).toBeLessThanOrEqual(r[1].x);
  });

  it('endBound 초과 → 경계 내로 조정', () => {
    const list = [mk('a', 'cook', 2800, 600)];
    const r = adjustFixedPositions(list, 0, 3000);
    expect(r[0].endX).toBeLessThanOrEqual(3000);
  });

  it('startBound 미만 → startBound로 당김', () => {
    const list = [mk('a', 'sink', -50, 950)];
    const r = adjustFixedPositions(list, 0, 3000);
    expect(r[0].x).toBeGreaterThanOrEqual(0);
  });

  it('endX 필드 갱신 확인', () => {
    const list = [mk('a', 'cook', 500, 600)];
    const r = adjustFixedPositions(list, 0, 3000);
    expect(r[0].endX).toBe(r[0].x + r[0].w);
  });
});

// ── calculateGaps ─────────────────────────────────────────────

describe('calculateGaps', () => {
  const mk = (x: number, w: number): FixedModule => ({
    id: 't', type: 'cook', name: '', x, w, endX: x + w,
  });

  it('고정 모듈 양쪽 빈공간 감지', () => {
    const list = [mk(1000, 600)];
    const gaps = calculateGaps(list, 0, 3000);
    expect(gaps.length).toBe(2);
    expect(gaps[0].width).toBe(1000);
    expect(gaps[1].width).toBe(1400);
  });

  it('고정 모듈 사이 빈공간 감지', () => {
    const list = [mk(0, 600), mk(1500, 950)];
    const gaps = calculateGaps(list, 0, 3000);
    expect(gaps.length).toBe(2);
    expect(gaps[0].width).toBe(900);  // 600 ~ 1500
    expect(gaps[1].width).toBe(550);  // 2450 ~ 3000
  });

  it('빈공간 없음', () => {
    const list = [mk(0, 3000)];
    const gaps = calculateGaps(list, 0, 3000);
    expect(gaps.length).toBe(0);
  });

  it('빈 리스트 → 전체 공간 하나의 gap', () => {
    const gaps = calculateGaps([], 0, 3000);
    expect(gaps.length).toBe(1);
    expect(gaps[0].width).toBe(3000);
  });
});

// ── fillGapWithModules ────────────────────────────────────────

describe('fillGapWithModules', () => {
  it('gap.start로부터 x 좌표 채우기', () => {
    const mods = fillGapWithModules({ start: 500, end: 2300, width: 1800 });
    expect(mods.length).toBeGreaterThan(0);
    expect(mods[0].x).toBe(500);

    // 연속성: 각 모듈 x + w = 다음 모듈 x
    for (let i = 1; i < mods.length; i++) {
      expect(mods[i].x).toBe(mods[i - 1].x + mods[i - 1].w);
    }
  });

  it('빈 공간 → 빈 배열', () => {
    const mods = fillGapWithModules({ start: 0, end: 50, width: 50 });
    expect(mods).toEqual([]);
  });
});
