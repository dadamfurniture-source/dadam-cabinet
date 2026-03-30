import { describe, it, expect } from 'vitest';
import {
  dilateEdges,
  computeSSIMApprox,
} from '../src/services/structural-verification.service.js';

describe('dilateEdges', () => {
  it('dilates a single center pixel with radius 1', () => {
    // 5x5 grid with one center pixel
    const w = 5, h = 5;
    const edges = new Uint8Array(w * h);
    edges[2 * w + 2] = 255; // center

    const dilated = dilateEdges(edges, w, h, 1);

    // Center should be active
    expect(dilated[2 * w + 2]).toBe(255);
    // Direct neighbors (4-connected + diagonals within r=1 circle)
    expect(dilated[1 * w + 2]).toBe(255); // top
    expect(dilated[3 * w + 2]).toBe(255); // bottom
    expect(dilated[2 * w + 1]).toBe(255); // left
    expect(dilated[2 * w + 3]).toBe(255); // right
    // Corners at distance sqrt(2) ≈ 1.41 > 1, so NOT dilated
    expect(dilated[1 * w + 1]).toBe(0);
    expect(dilated[1 * w + 3]).toBe(0);
  });

  it('returns original edges when radius is 0', () => {
    const w = 3, h = 3;
    const edges = new Uint8Array(w * h);
    edges[4] = 255; // center

    const dilated = dilateEdges(edges, w, h, 0);

    expect(dilated).toBe(edges); // same reference
  });

  it('handles empty edge map', () => {
    const w = 4, h = 4;
    const edges = new Uint8Array(w * h); // all zeros

    const dilated = dilateEdges(edges, w, h, 2);

    // All should still be 0
    expect(dilated.every(v => v === 0)).toBe(true);
  });

  it('does not go out of bounds', () => {
    const w = 3, h = 3;
    const edges = new Uint8Array(w * h);
    edges[0] = 255; // top-left corner

    // Should not throw
    const dilated = dilateEdges(edges, w, h, 5);
    expect(dilated[0]).toBe(255);
  });
});

describe('computeSSIMApprox', () => {
  it('returns 1.0 for identical edge maps', () => {
    const edges = new Uint8Array([0, 255, 255, 0, 255, 0, 0, 255]);
    const ssim = computeSSIMApprox(edges, edges);
    expect(ssim).toBeCloseTo(1.0, 2);
  });

  it('returns low score for opposite edge maps', () => {
    const a = new Uint8Array([0, 255, 255, 0, 255, 0, 0, 255]);
    const b = new Uint8Array([255, 0, 0, 255, 0, 255, 255, 0]);
    const ssim = computeSSIMApprox(a, b);
    expect(ssim).toBeLessThan(0.5);
  });

  it('returns 0 for empty arrays', () => {
    const empty = new Uint8Array(0);
    expect(computeSSIMApprox(empty, empty)).toBe(0);
  });

  it('handles all-zero edge maps', () => {
    const zeros = new Uint8Array(100);
    const ssim = computeSSIMApprox(zeros, zeros);
    // Both all-zero: denominator ≈ 0 → returns 1
    expect(ssim).toBe(1);
  });

  it('handles one all-zero vs one all-active', () => {
    const zeros = new Uint8Array(100);
    const active = new Uint8Array(100).fill(255);
    const ssim = computeSSIMApprox(zeros, active);
    expect(ssim).toBeLessThan(0.5);
  });
});
