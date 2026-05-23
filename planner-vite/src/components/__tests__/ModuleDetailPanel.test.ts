// ═══════════════════════════════════════════════════════════════
// ModuleDetailPanel.test.ts — W6-5 디테일 패널 헬퍼 단위 테스트
//
// 카탈로그 상수 무결성 + detailCompleteness 계산 검증.
// 비주얼 검증은 디자이너 PC + W6-6 후 Playwright.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  detailCompleteness,
  DOOR_FINISH_OPTIONS,
  DOOR_COLOR_OPTIONS,
  SECTION_DEFAULT_HEIGHT,
} from '../ModuleDetailPanel';
import type { ModuleEntryV2 } from '../../lib/planner';

const baseMod = (overrides: Partial<ModuleEntryV2> = {}): ModuleEntryV2 => ({
  id: 'm1',
  segmentId: 'prime',
  section: 'lower',
  kind: 'door',
  width: 600,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────
// 1. detailCompleteness
// ─────────────────────────────────────────────────────────────

describe('detailCompleteness', () => {
  it('도어 모듈 + 모든 옵션 채움 = 100%', () => {
    const m = baseMod({
      kind: 'door',
      width: 600,
      doorCount: 2,
      doorFinish: 'pet-matte',
      doorColor: 'oak',
    });
    expect(detailCompleteness(m)).toBe(100);
  });

  it('서랍 모듈 + 모든 옵션 채움 = 100%', () => {
    const m = baseMod({
      kind: 'drawer',
      width: 600,
      drawerCount: 3,
      doorFinish: 'paint-matte',
      doorColor: 'walnut',
    });
    expect(detailCompleteness(m)).toBe(100);
  });

  it('오픈 모듈 + finish/color 만 = 100% (도어/서랍 카운트 불필요)', () => {
    const m = baseMod({
      kind: 'open',
      width: 600,
      doorFinish: 'veneer',
      doorColor: 'oak',
    });
    expect(detailCompleteness(m)).toBe(100);
  });

  it('도어 모듈 + finish/color 없음 = 60% (4 of 5 filled, kind+width+doorCount=3, total=5 → 60)', () => {
    const m = baseMod({
      kind: 'door',
      width: 600,
      doorCount: 1,
    });
    expect(detailCompleteness(m)).toBe(60);
  });

  it('기본 모듈 (kind/width 만) = 40%', () => {
    const m = baseMod({ kind: 'door', width: 600 });
    expect(detailCompleteness(m)).toBe(40);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. 카탈로그 상수 무결성
// ─────────────────────────────────────────────────────────────

describe('카탈로그 상수', () => {
  it('DOOR_FINISH_OPTIONS 모두 value+label 보유', () => {
    expect(DOOR_FINISH_OPTIONS.length).toBeGreaterThanOrEqual(5);
    for (const opt of DOOR_FINISH_OPTIONS) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
    }
  });

  it('DOOR_COLOR_OPTIONS 중복 value 없음', () => {
    const values = DOOR_COLOR_OPTIONS.map((o) => o.value);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('SECTION_DEFAULT_HEIGHT 3개 section 모두 정의', () => {
    expect(SECTION_DEFAULT_HEIGHT.lower).toBeGreaterThan(0);
    expect(SECTION_DEFAULT_HEIGHT.upper).toBeGreaterThan(0);
    expect(SECTION_DEFAULT_HEIGHT.tall).toBeGreaterThan(0);
    // tall > lower > upper 순으로 일반적
    expect(SECTION_DEFAULT_HEIGHT.tall).toBeGreaterThan(SECTION_DEFAULT_HEIGHT.lower);
  });
});
