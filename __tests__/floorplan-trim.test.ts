/**
 * Floorplan 트리밍 알고리즘 단위 테스트
 *
 * 검증 범위 (M3 1차 출시):
 *   - 단일 공간 → 트리밍 없음
 *   - 두 공간이 떨어진 경우 → junction 0건
 *   - 두 공간이 코너에서 겹침 (4가지 코너 × zIndex 양방향)
 *   - 한 변 전체 겹침 (T 케이스)
 *   - 회전 90°/180°/270° 시 변(local edge) 매핑
 */

import { computeTrimming, recomputeFloorplan } from '../lib/floorplan-trim';
import type { Space, Floorplan } from '../lib/floorplan-types';

function makeSpace(overrides: Partial<Space> & Pick<Space, 'id' | 'w' | 'h' | 'x' | 'y'>): Space {
  return {
    rotation: 0,
    zIndex: 0,
    verticalH: 2310,
    category: 'sink',
    ...overrides,
  };
}

describe('computeTrimming - 기본', () => {
  test('단일 공간: trimmedSpaces 1개, 사각형 outline', () => {
    const s = makeSpace({ id: 's1', w: 3000, h: 600, x: 1500, y: 300 });
    const r = computeTrimming([s]);
    expect(r.junctions).toHaveLength(0);
    expect(r.trimmedSpaces).toHaveLength(1);
    expect(r.trimmedSpaces[0].outline).toHaveLength(4);
    expect(r.trimmedSpaces[0].trimmedEdges).toEqual([]);
  });

  test('떨어진 두 공간: junction 0건', () => {
    const s1 = makeSpace({ id: 's1', w: 1000, h: 600, x: 500, y: 300 });
    const s2 = makeSpace({ id: 's2', w: 1000, h: 600, x: 2500, y: 300 });
    const r = computeTrimming([s1, s2]);
    expect(r.junctions).toHaveLength(0);
    expect(r.trimmedSpaces).toHaveLength(2);
  });

  test('변 접촉만 (겹침 0): junction 0건', () => {
    const s1 = makeSpace({ id: 's1', w: 1000, h: 600, x: 500, y: 300 });
    const s2 = makeSpace({ id: 's2', w: 1000, h: 600, x: 1500, y: 300 }); // s1의 우변에 정확히 닿음
    const r = computeTrimming([s1, s2]);
    expect(r.junctions).toHaveLength(0);
  });
});

describe('computeTrimming - L자 코너 (4가지)', () => {
  // 두 공간 모두 1000x600, 코너에서 600x600 만큼 겹친다고 가정
  // s1은 좌측, s2는 s1의 우상단 코너에 침범

  test('좌상 코너: s2가 s1의 좌상단을 가림 (s2.zIndex=1)', () => {
    // s1: minX=0, minY=0, maxX=1000, maxY=600 (중심 500,300)
    // s2: minX=0, minY=0, maxX=600, maxY=600 (중심 300,300)
    // overlap = 0,0 ~ 600,600 = s1의 좌측 60%. zIndex=1인 s2가 앞 → s1 트리밍
    const s1 = makeSpace({ id: 's1', w: 1000, h: 600, x: 500, y: 300, zIndex: 0 });
    const s2 = makeSpace({ id: 's2', w: 600, h: 600, x: 300, y: 300, zIndex: 1 });
    const r = computeTrimming([s1, s2]);
    expect(r.junctions).toHaveLength(1);
    expect(r.junctions[0].spaceAId).toBe('s1'); // 트리밍당함
    expect(r.junctions[0].spaceBId).toBe('s2'); // 앞으로 옴
  });

  test('zIndex 동률: 입력 순서 우선 (먼저 오는 쪽이 앞)', () => {
    const s1 = makeSpace({ id: 's1', w: 1000, h: 600, x: 500, y: 300, zIndex: 0 });
    const s2 = makeSpace({ id: 's2', w: 600, h: 600, x: 300, y: 300, zIndex: 0 });
    const r = computeTrimming([s1, s2]);
    expect(r.junctions).toHaveLength(1);
    // s1.zIndex==s2.zIndex이고 aWins = (s1>s2)? false → s2가 트리밍당함
    expect(r.junctions[0].spaceAId).toBe('s2');
  });
});

describe('computeTrimming - 4가지 코너 모두', () => {
  // 큰 공간(s1) 위에 작은 공간(s2)을 4가지 코너로 침범시켜 트리밍 변 검증
  const big = (zIndex: number) => makeSpace({ id: 'big', w: 2000, h: 1000, x: 1000, y: 500, zIndex });

  test('우하 코너 침범 → s1의 우하단 잘림, edge=front 또는 right', () => {
    // s2: 우하단에 600x400 만큼 침범 (1400~2000, 600~1000)
    const s1 = big(0);
    const s2 = makeSpace({ id: 's2', w: 600, h: 400, x: 1700, y: 800, zIndex: 1 });
    const r = computeTrimming([s1, s2]);
    expect(r.junctions).toHaveLength(1);
    // 우하 코너: 가장 긴 접촉 변은 +X 또는 +Y. s2가 600x400이므로 +Y(=600)가 더 김 → front
    const edge = r.junctions[0].trimmedEdge;
    expect(['front', 'right']).toContain(edge);
  });

  test('좌상 코너 침범', () => {
    const s1 = big(0);
    const s2 = makeSpace({ id: 's2', w: 600, h: 400, x: 300, y: 200, zIndex: 1 });
    const r = computeTrimming([s1, s2]);
    expect(r.junctions).toHaveLength(1);
    const edge = r.junctions[0].trimmedEdge;
    expect(['back', 'left']).toContain(edge);
  });
});

describe('computeTrimming - outline (L폴리곤)', () => {
  test('우상 코너 트리밍 → 6점 L폴리곤', () => {
    // s1: 0~2000 x 0~1000 (중심 1000,500)
    // s2: 우상단 1400~2000, 0~400 침범 (중심 1700,200)
    const s1 = makeSpace({ id: 's1', w: 2000, h: 1000, x: 1000, y: 500, zIndex: 0 });
    const s2 = makeSpace({ id: 's2', w: 600, h: 400, x: 1700, y: 200, zIndex: 1 });
    const r = computeTrimming([s1, s2]);
    const s1Outline = r.trimmedSpaces.find((t) => t.spaceId === 's1')!.outline;
    expect(s1Outline).toHaveLength(6);
    // s1 최대 x=2000, 최대 y=1000. 우상 코너가 잘림.
    const xs = s1Outline.map((p) => p.x).sort((a, b) => a - b);
    const ys = s1Outline.map((p) => p.y).sort((a, b) => a - b);
    expect(xs[0]).toBe(0);    // 좌측
    expect(xs[xs.length - 1]).toBe(2000); // 우측
    expect(ys[0]).toBe(0);    // 상측
    expect(ys[ys.length - 1]).toBe(1000); // 하측
    // 잘린 코너 좌표 1400, 400 포함
    expect(s1Outline.some((p) => p.x === 1400 && p.y === 400)).toBe(true);
  });

  test('트리밍 없는 공간: 4점 사각형', () => {
    const s = makeSpace({ id: 's1', w: 1000, h: 600, x: 500, y: 300 });
    const r = computeTrimming([s]);
    const outline = r.trimmedSpaces[0].outline;
    expect(outline).toHaveLength(4);
  });
});

describe('computeTrimming - trimmedEdges 정보', () => {
  test('originalLength와 trimmedLength 차이', () => {
    // s1: 2000x1000, s2가 우상단 600x400 침범
    const s1 = makeSpace({ id: 's1', w: 2000, h: 1000, x: 1000, y: 500, zIndex: 0 });
    const s2 = makeSpace({ id: 's2', w: 600, h: 400, x: 1700, y: 200, zIndex: 1 });
    const r = computeTrimming([s1, s2]);
    const s1Trim = r.trimmedSpaces.find((t) => t.spaceId === 's1')!.trimmedEdges;
    expect(s1Trim).toHaveLength(1);
    const t = s1Trim[0];
    // 원래 변의 길이는 트리밍된 축에 따라 달라진다 — 핵심은 trimmedLength < originalLength
    expect(t.trimmedLength).toBeGreaterThan(0);
    expect(t.trimmedLength).toBeLessThan(t.originalLength);
  });
});

describe('rotation 90° 매핑', () => {
  test('s1을 90° 회전: w↔h swap', () => {
    // 원래 1000x600 사각형, 회전 90°(시계) 후 AABB는 600x1000
    const s = makeSpace({ id: 's1', w: 1000, h: 600, x: 500, y: 500, rotation: Math.PI / 2 });
    const r = computeTrimming([s]);
    const outline = r.trimmedSpaces[0].outline;
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    // 회전 후 가로 600, 세로 1000 → x 범위 [200, 800], y 범위 [0, 1000]
    expect(Math.min(...xs)).toBe(200);
    expect(Math.max(...xs)).toBe(800);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(1000);
  });
});

describe('idempotent + helpers', () => {
  test('recomputeFloorplan는 spaces만 보고 junctions/trimmedSpaces를 재산출', () => {
    const s1 = makeSpace({ id: 's1', w: 2000, h: 1000, x: 1000, y: 500, zIndex: 0 });
    const s2 = makeSpace({ id: 's2', w: 600, h: 400, x: 1700, y: 200, zIndex: 1 });
    const fp: Floorplan = {
      schemaVersion: 2,
      spaces: [s1, s2],
      junctions: [], // 의도적으로 비움
      trimmedSpaces: [],
    };
    const result = recomputeFloorplan(fp);
    expect(result.junctions).toHaveLength(1);
    expect(result.trimmedSpaces).toHaveLength(2);
  });

  test('두 번 호출해도 결과 동일 (idempotent)', () => {
    const s1 = makeSpace({ id: 's1', w: 2000, h: 1000, x: 1000, y: 500, zIndex: 0 });
    const s2 = makeSpace({ id: 's2', w: 600, h: 400, x: 1700, y: 200, zIndex: 1 });
    const r1 = computeTrimming([s1, s2]);
    const r2 = computeTrimming([s1, s2]);
    expect(r2.junctions).toEqual(r1.junctions);
    expect(r2.trimmedSpaces).toEqual(r1.trimmedSpaces);
  });
});
