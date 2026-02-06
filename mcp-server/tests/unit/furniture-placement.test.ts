// ═══════════════════════════════════════════════════════════════
// Furniture Placement Service - Unit Tests
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  calculateFurniturePlacement,
  getDefaultWallData,
} from '../../src/services/furniture-placement.service.js';
import type { WallAnalysis } from '../../src/types/index.js';

describe('calculateFurniturePlacement', () => {
  it('should use water pipe position for sink when detected', () => {
    const wallData: WallAnalysis = {
      ...getDefaultWallData(),
      wall_width_mm: 3600,
      wall_height_mm: 2400,
      water_pipe_x: 900,
    };

    const result = calculateFurniturePlacement(wallData);

    expect(result.sink_center_mm).toBe(900);
    expect(result.sink_position).toBe('center_at_900mm');
  });

  it('should use exhaust duct position for cooktop when detected', () => {
    const wallData: WallAnalysis = {
      ...getDefaultWallData(),
      wall_width_mm: 3600,
      exhaust_duct_x: 2700,
    };

    const result = calculateFurniturePlacement(wallData);

    expect(result.cooktop_center_mm).toBe(2700);
    expect(result.cooktop_position).toBe('center_at_2700mm');
  });

  it('should default sink to 30% of wall width when no water pipe detected', () => {
    const wallData: WallAnalysis = {
      ...getDefaultWallData(),
      wall_width_mm: 4000,
      water_pipe_x: undefined,
    };

    const result = calculateFurniturePlacement(wallData);

    expect(result.sink_center_mm).toBe(1200); // 4000 * 0.3
  });

  it('should default cooktop to 70% of wall width when no exhaust duct detected', () => {
    const wallData: WallAnalysis = {
      ...getDefaultWallData(),
      wall_width_mm: 4000,
      exhaust_duct_x: undefined,
    };

    const result = calculateFurniturePlacement(wallData);

    expect(result.cooktop_center_mm).toBe(2800); // 4000 * 0.7
  });

  it('should determine layout direction based on sink/cooktop positions', () => {
    const wallData: WallAnalysis = {
      ...getDefaultWallData(),
      water_pipe_x: 800,
      exhaust_duct_x: 2500,
    };

    const result = calculateFurniturePlacement(wallData);

    expect(result.layout_direction).toBe('sink_left_cooktop_right');
  });

  it('should determine reverse layout when sink is right of cooktop', () => {
    const wallData: WallAnalysis = {
      ...getDefaultWallData(),
      water_pipe_x: 2500,
      exhaust_duct_x: 800,
    };

    const result = calculateFurniturePlacement(wallData);

    expect(result.layout_direction).toBe('sink_right_cooktop_left');
  });

  it('should calculate upper cabinet bottom position', () => {
    const wallData: WallAnalysis = {
      ...getDefaultWallData(),
      wall_height_mm: 2400,
    };

    const result = calculateFurniturePlacement(wallData);

    expect(result.upper_cabinet_bottom_mm).toBe(1680); // 2400 - 720
    expect(result.lower_cabinet_height_mm).toBe(870);
    expect(result.countertop_height_mm).toBe(870);
  });

  it('should handle default wall dimensions (3000mm)', () => {
    const wallData = getDefaultWallData();

    const result = calculateFurniturePlacement(wallData);

    expect(result.sink_center_mm).toBe(900);   // 3000 * 0.3
    expect(result.cooktop_center_mm).toBe(2100); // 3000 * 0.7
    expect(result.layout_direction).toBe('sink_left_cooktop_right');
  });

  it('should set range hood above cooktop', () => {
    const wallData: WallAnalysis = {
      ...getDefaultWallData(),
      exhaust_duct_x: 2000,
    };

    const result = calculateFurniturePlacement(wallData);

    expect(result.range_hood_position).toBe('above_cooktop_at_2000mm');
  });
});

describe('getDefaultWallData', () => {
  it('should return proper defaults', () => {
    const defaults = getDefaultWallData();

    expect(defaults.wall_width_mm).toBe(3000);
    expect(defaults.wall_height_mm).toBe(2400);
    expect(defaults.tile_detected).toBe(false);
    expect(defaults.confidence).toBe('low');
    expect(defaults.water_pipe_x).toBeUndefined();
    expect(defaults.exhaust_duct_x).toBeUndefined();
    expect(defaults.gas_pipe_x).toBeUndefined();
  });
});
