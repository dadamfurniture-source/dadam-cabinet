// ═══════════════════════════════════════════════════════════════
// SegmentEditor.test.ts — W6-3 SegmentEditor 헬퍼 단위 테스트
//
// 컴포넌트 렌더링 테스트는 RTL 미설치 환경이라 헬퍼 함수의 입출력만 검증.
// 비주얼/인터랙션은 Playwright + 디자이너 PC 수동 검증 (W6-6 이후).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { segmentBounds, snap, snapToAdjacent } from '../SegmentEditor';
import type { CabinetSegment } from '../../lib/planner';

const baseSeg = (overrides: Partial<CabinetSegment> = {}): CabinetSegment => ({
  id: 'seg-1',
  x: 0,
  y: 0,
  width: 1500,
  depth: 600,
  rotationDeg: 0,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────
// 1. snap
// ─────────────────────────────────────────────────────────────

describe('snap (50mm grid)', () => {
  it('123 → 100 (가까운 grid)', () => {
    expect(snap(123)).toBe(100);
  });

  it('175 → 200 (반올림 위)', () => {
    expect(snap(175)).toBe(200);
  });

  it('-37 → -50 (음수)', () => {
    expect(snap(-37)).toBe(-50);
  });

  it('custom grid=100 적용', () => {
    expect(snap(123, 100)).toBe(100);
    expect(snap(150, 100)).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. segmentBounds — 회전 반영 AABB
// ─────────────────────────────────────────────────────────────

describe('segmentBounds', () => {
  it('rotationDeg=0 일 때 AABB = (x, y, x+w, y+d)', () => {
    const b = segmentBounds(baseSeg({ x: 100, y: 50 }));
    expect(b.minX).toBe(100);
    expect(b.maxX).toBe(1600);
    expect(b.minY).toBe(50);
    expect(b.maxY).toBe(650);
  });

  it('rotationDeg=90 일 때 width/depth swap (코너 pivot)', () => {
    const b = segmentBounds(baseSeg({ x: 0, y: 0, width: 1500, depth: 600, rotationDeg: 90 }));
    // (0,0) 코너 pivot → +x 가 +y 로, +y 가 -x 로 회전
    // 결과: (0, 0)→(0,0), (1500,0)→(0,1500), (1500,600)→(-600,1500), (0,600)→(-600,0)
    expect(b.minX).toBeCloseTo(-600, 0);
    expect(b.maxX).toBeCloseTo(0, 0);
    expect(b.minY).toBeCloseTo(0, 0);
    expect(b.maxY).toBeCloseTo(1500, 0);
  });

  it('rotationDeg=180 일 때 모두 반대 방향', () => {
    const b = segmentBounds(baseSeg({ x: 100, y: 50, rotationDeg: 180 }));
    expect(b.maxX).toBeCloseTo(100, 0);
    expect(b.minX).toBeCloseTo(-1400, 0);
    expect(b.maxY).toBeCloseTo(50, 0);
    expect(b.minY).toBeCloseTo(-550, 0);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. snapToAdjacent — 인접 edge 10mm 이내 정렬
// ─────────────────────────────────────────────────────────────

describe('snapToAdjacent', () => {
  it('5mm 차이 → snap 발생 (정확히 일치)', () => {
    const prime = baseSeg({ id: 'prime', x: 0, y: 0, width: 3000, depth: 650 });
    // candidate 의 minX=3005 (prime maxX=3000 와 5mm 차이) → snap → 3000
    const candidate = baseSeg({ id: 'cand', x: 3005, y: 0, width: 1200, depth: 600 });
    const snapped = snapToAdjacent(candidate, [prime]);
    expect(snapped.x).toBe(3000);
  });

  it('20mm 차이 → snap 없음 (threshold 10mm 초과)', () => {
    const prime = baseSeg({ id: 'prime', x: 0, y: 0, width: 3000, depth: 650 });
    const candidate = baseSeg({ id: 'cand', x: 3020, y: 0, width: 1200, depth: 600 });
    const snapped = snapToAdjacent(candidate, [prime]);
    expect(snapped.x).toBe(3020);   // 변경 없음
  });

  it('Y-축 edge 도 snap', () => {
    const prime = baseSeg({ id: 'prime', x: 0, y: 0, width: 3000, depth: 650 });
    // candidate 의 minY=655 (prime maxY=650 와 5mm 차이) → snap → 650
    const candidate = baseSeg({ id: 'cand', x: 0, y: 655, width: 1200, depth: 600 });
    const snapped = snapToAdjacent(candidate, [prime]);
    expect(snapped.y).toBe(650);
  });

  it('인접 segment 없으면 변경 없음', () => {
    const candidate = baseSeg({ id: 'cand', x: 100, y: 200 });
    const snapped = snapToAdjacent(candidate, []);
    expect(snapped.x).toBe(100);
    expect(snapped.y).toBe(200);
  });
});
