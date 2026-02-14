import { describe, it, expect } from 'vitest';
import {
  calculateFurniturePlacement,
  getDefaultWallData,
} from '../src/services/furniture-placement.service.js';
import type { WallAnalysis } from '../src/types/index.js';

// ─────────────────────────────────────────────────────────────────
// Tests: calculateFurniturePlacement
// ─────────────────────────────────────────────────────────────────

describe('calculateFurniturePlacement', () => {
  it('places sink at water_pipe_x when detected', () => {
    const wallData: WallAnalysis = {
      tile_detected: true,
      tile_type: 'subway',
      tile_size_mm: { width: 300, height: 600 },
      wall_width_mm: 3600,
      wall_height_mm: 2400,
      water_pipe_x: 1200,
      exhaust_duct_x: 2800,
      confidence: 'high',
    };

    const result = calculateFurniturePlacement(wallData);

    expect(result.sink_center_mm).toBe(1200);
    expect(result.cooktop_center_mm).toBe(2800);
  });

  it('falls back to 30%/70% when pipes not detected', () => {
    const wallData: WallAnalysis = {
      tile_detected: true,
      tile_type: 'subway',
      tile_size_mm: { width: 300, height: 600 },
      wall_width_mm: 4000,
      wall_height_mm: 2400,
      confidence: 'medium',
    };

    const result = calculateFurniturePlacement(wallData);

    expect(result.sink_center_mm).toBe(1200); // 4000 * 0.3
    expect(result.cooktop_center_mm).toBe(2800); // 4000 * 0.7
  });

  it('determines layout_direction as sink_left when sink < cooktop', () => {
    const wallData: WallAnalysis = {
      tile_detected: true,
      tile_type: 'subway',
      tile_size_mm: { width: 300, height: 600 },
      wall_width_mm: 3000,
      wall_height_mm: 2400,
      water_pipe_x: 800,
      exhaust_duct_x: 2200,
      confidence: 'high',
    };

    const result = calculateFurniturePlacement(wallData);
    expect(result.layout_direction).toBe('sink_left_cooktop_right');
  });

  it('determines layout_direction as sink_right when sink > cooktop', () => {
    const wallData: WallAnalysis = {
      tile_detected: true,
      tile_type: 'subway',
      tile_size_mm: { width: 300, height: 600 },
      wall_width_mm: 3000,
      wall_height_mm: 2400,
      water_pipe_x: 2200,
      exhaust_duct_x: 800,
      confidence: 'high',
    };

    const result = calculateFurniturePlacement(wallData);
    expect(result.layout_direction).toBe('sink_right_cooktop_left');
  });

  it('calculates cabinet heights correctly', () => {
    const wallData: WallAnalysis = {
      tile_detected: true,
      tile_type: 'subway',
      tile_size_mm: { width: 300, height: 600 },
      wall_width_mm: 3000,
      wall_height_mm: 2600,
      confidence: 'high',
    };

    const result = calculateFurniturePlacement(wallData);

    expect(result.upper_cabinet_bottom_mm).toBe(2600 - 720);
    expect(result.lower_cabinet_height_mm).toBe(870);
    expect(result.countertop_height_mm).toBe(870);
  });

  it('uses default 3000x2400 when wall dimensions missing', () => {
    const wallData: WallAnalysis = {
      tile_detected: false,
      tile_type: 'unknown',
      tile_size_mm: { width: 0, height: 0 },
      wall_width_mm: 0,
      wall_height_mm: 0,
      confidence: 'low',
    };

    const result = calculateFurniturePlacement(wallData);

    // wall_width_mm is 0 which is falsy -> defaults to 3000
    expect(result.sink_center_mm).toBe(900); // 3000 * 0.3
    expect(result.cooktop_center_mm).toBe(2100); // 3000 * 0.7
  });
});

// ─────────────────────────────────────────────────────────────────
// Tests: getDefaultWallData
// ─────────────────────────────────────────────────────────────────

describe('getDefaultWallData', () => {
  it('returns standard default values', () => {
    const result = getDefaultWallData();

    expect(result.wall_width_mm).toBe(3000);
    expect(result.wall_height_mm).toBe(2400);
    expect(result.tile_detected).toBe(false);
    expect(result.confidence).toBe('low');
  });

  it('has no pipe positions detected', () => {
    const result = getDefaultWallData();

    expect(result.water_pipe_x).toBeUndefined();
    expect(result.exhaust_duct_x).toBeUndefined();
    expect(result.gas_pipe_x).toBeUndefined();
  });

  it('has reference_wall with left_edge origin', () => {
    const result = getDefaultWallData();

    expect(result.reference_wall?.origin_point).toBe('left_edge');
  });
});
