import { describe, it, expect } from 'vitest';
import { extractDesignData } from '../src/services/design-data.service.js';
import type { WallAnalysis, Category } from '../src/types/index.js';
import type { ClassifiedRules } from '../src/mappers/rule-classifier.js';

// ─────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────

function makeWallData(overrides: Partial<WallAnalysis> = {}): WallAnalysis {
  return {
    tile_detected: true,
    tile_type: 'subway_tile',
    tile_size_mm: { width: 300, height: 600 },
    wall_width_mm: 3600,
    wall_height_mm: 2400,
    water_pipe_x: 900,
    exhaust_duct_x: 2700,
    gas_pipe_x: 2700,
    confidence: 'high',
    ...overrides,
  };
}

function makeClassified(overrides: Partial<ClassifiedRules> = {}): ClassifiedRules {
  return {
    background: ['- Clean walls'],
    modules: ['- 상부장: 600mm standard'],
    doors: ['- 도어: 1-door hinged'],
    materials: [
      { id: 'm1', rule_type: 'material', content: 'White matte laminate', triggers: ['WM-01'] },
    ],
    materialKeywords: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// Tests: extractDesignData
// ─────────────────────────────────────────────────────────────────

describe('extractDesignData', () => {
  it('returns correct wall dimensions from wallData', () => {
    const result = extractDesignData({
      category: 'sink',
      style: 'modern',
      wallData: makeWallData(),
      classified: makeClassified(),
    });

    expect(result.wall.width_mm).toBe(3600);
    expect(result.wall.height_mm).toBe(2400);
    expect(result.wall.tile_type).toBe('subway_tile');
    expect(result.wall.confidence).toBe('high');
  });

  it('maps utility positions from wallData pipe values', () => {
    const result = extractDesignData({
      category: 'sink',
      style: 'modern',
      wallData: makeWallData({ water_pipe_x: 1000, exhaust_duct_x: 2500, gas_pipe_x: 2600 }),
      classified: makeClassified(),
    });

    expect(result.utilities.water_supply.detected).toBe(true);
    expect(result.utilities.water_supply.position_mm).toBe(1000);
    expect(result.utilities.exhaust_duct.detected).toBe(true);
    expect(result.utilities.exhaust_duct.position_mm).toBe(2500);
    expect(result.utilities.gas_pipe.detected).toBe(true);
    expect(result.utilities.gas_pipe.position_mm).toBe(2600);
  });

  it('falls back to percentage-based positions when pipes not detected', () => {
    const result = extractDesignData({
      category: 'sink',
      style: 'modern',
      wallData: makeWallData({
        water_pipe_x: undefined,
        exhaust_duct_x: undefined,
        gas_pipe_x: undefined,
      }),
      classified: makeClassified(),
    });

    expect(result.utilities.water_supply.detected).toBe(false);
    expect(result.utilities.water_supply.position_mm).toBe(Math.round(3600 * 0.3));
    expect(result.utilities.exhaust_duct.detected).toBe(false);
    expect(result.utilities.exhaust_duct.position_mm).toBe(Math.round(3600 * 0.7));
  });

  it('builds kitchen cabinets for sink category', () => {
    const result = extractDesignData({
      category: 'sink',
      style: 'modern',
      wallData: makeWallData(),
      classified: makeClassified(),
    });

    expect(result.cabinets.lower.length).toBeGreaterThan(0);
    expect(result.cabinets.upper.length).toBeGreaterThan(0);

    const sinkUnit = result.cabinets.lower.find(u => u.type === 'sink');
    expect(sinkUnit).toBeDefined();
    expect(sinkUnit!.has_sink).toBe(true);

    const cooktopUnit = result.cabinets.lower.find(u => u.type === 'cooktop');
    expect(cooktopUnit).toBeDefined();
    expect(cooktopUnit!.has_cooktop).toBe(true);
  });

  it('builds wardrobe cabinets for wardrobe category', () => {
    const result = extractDesignData({
      category: 'wardrobe',
      style: 'modern',
      wallData: makeWallData(),
      classified: makeClassified(),
    });

    expect(result.cabinets.lower.length).toBeGreaterThanOrEqual(2);
    expect(result.cabinets.lower[0].type).toBe('hanger');
    // wardrobe has no upper cabinets
    expect(result.cabinets.upper.length).toBe(0);
  });

  it('builds fridge cabinets for fridge category', () => {
    const result = extractDesignData({
      category: 'fridge',
      style: 'modern',
      wallData: makeWallData(),
      classified: makeClassified(),
    });

    const fridgeUnit = result.cabinets.lower.find(u => u.type === 'fridge');
    expect(fridgeUnit).toBeDefined();
    expect(result.cabinets.upper.length).toBe(0);
  });

  it('builds generic cabinets for other categories', () => {
    const categories: Category[] = ['vanity', 'shoe', 'storage'];
    for (const category of categories) {
      const result = extractDesignData({
        category,
        style: 'modern',
        wallData: makeWallData(),
        classified: makeClassified(),
      });

      expect(result.cabinets.lower.length).toBeGreaterThanOrEqual(2);
      expect(result.cabinets.lower[0].type).toBe('standard');
    }
  });

  it('uses user-provided modules when given', () => {
    const result = extractDesignData({
      category: 'sink',
      style: 'modern',
      wallData: makeWallData(),
      classified: makeClassified(),
      modules: {
        lower: [
          { width_mm: 800, has_sink: true, door_count: 2 },
          { width_mm: 600, is_drawer: true, door_count: 3 },
          { width_mm: 800, has_cooktop: true, door_count: 1 },
        ],
        upper: [
          { width_mm: 600, door_count: 1 },
          { width_mm: 600, door_count: 1 },
        ],
      },
    });

    expect(result.cabinets.lower.length).toBe(3);
    expect(result.cabinets.lower[0].type).toBe('sink');
    expect(result.cabinets.lower[1].type).toBe('drawer');
    expect(result.cabinets.lower[2].type).toBe('cooktop');
    expect(result.cabinets.upper.length).toBe(2);
  });

  it('maps equipment for sink category', () => {
    const result = extractDesignData({
      category: 'sink',
      style: 'modern',
      wallData: makeWallData(),
      classified: makeClassified(),
    });

    expect(result.equipment.sink).toBeDefined();
    expect(result.equipment.cooktop).toBeDefined();
    expect(result.equipment.hood).toBeDefined();
    expect(result.equipment.faucet).toBeDefined();
  });

  it('maps equipment for vanity category (sink + faucet only)', () => {
    const result = extractDesignData({
      category: 'vanity',
      style: 'modern',
      wallData: makeWallData(),
      classified: makeClassified(),
    });

    expect(result.equipment.sink).toBeDefined();
    expect(result.equipment.sink!.type).toBe('vessel');
    expect(result.equipment.faucet).toBeDefined();
    expect(result.equipment.cooktop).toBeUndefined();
    expect(result.equipment.hood).toBeUndefined();
  });

  it('does not include equipment for non-sink/vanity categories', () => {
    const result = extractDesignData({
      category: 'wardrobe',
      style: 'modern',
      wallData: makeWallData(),
      classified: makeClassified(),
    });

    expect(result.equipment.sink).toBeUndefined();
    expect(result.equipment.cooktop).toBeUndefined();
  });

  it('uses cabinetSpecs for materials when provided', () => {
    const result = extractDesignData({
      category: 'sink',
      style: 'modern',
      wallData: makeWallData(),
      classified: makeClassified(),
      cabinetSpecs: {
        door_color_upper: 'navy',
        door_finish_upper: 'gloss',
        countertop_color: 'black_granite',
        handle_type: 'bar',
      },
    });

    expect(result.materials.door_color).toBe('navy');
    expect(result.materials.door_finish).toBe('gloss');
    expect(result.materials.countertop).toBe('black_granite');
    expect(result.materials.handle_type).toBe('bar');
  });

  it('falls back to defaults when cabinetSpecs not provided', () => {
    const result = extractDesignData({
      category: 'sink',
      style: 'modern',
      wallData: makeWallData(),
      classified: makeClassified(),
    });

    expect(result.materials.door_color).toBe('white');
    expect(result.materials.door_finish).toBe('matte');
    expect(result.materials.countertop).toBe('white_marble');
    expect(result.materials.handle_type).toBe('line');
  });

  it('includes RAG rules in rag_rules_applied', () => {
    const result = extractDesignData({
      category: 'sink',
      style: 'modern',
      wallData: makeWallData(),
      classified: makeClassified(),
    });

    expect(result.rag_rules_applied.background).toEqual(['- Clean walls']);
    expect(result.rag_rules_applied.modules).toEqual(['- 상부장: 600mm standard']);
    expect(result.rag_rules_applied.doors).toEqual(['- 도어: 1-door hinged']);
    expect(result.rag_rules_applied.material_codes).toEqual(['White matte laminate']);
  });

  it('uses cabinetSpecs height values', () => {
    const result = extractDesignData({
      category: 'sink',
      style: 'modern',
      wallData: makeWallData(),
      classified: makeClassified(),
      cabinetSpecs: {
        upper_cabinet_height: 800,
        lower_cabinet_height: 900,
        leg_height: 120,
        molding_height: 50,
        depth_mm: 650,
      },
    });

    expect(result.cabinets.upper_height_mm).toBe(800);
    expect(result.cabinets.lower_height_mm).toBe(900);
    expect(result.cabinets.leg_height_mm).toBe(120);
    expect(result.cabinets.molding_height_mm).toBe(50);
    expect(result.layout.depth_mm).toBe(650);
  });

  it('preserves category and style in output', () => {
    const result = extractDesignData({
      category: 'vanity',
      style: 'classic',
      wallData: makeWallData(),
      classified: makeClassified(),
    });

    expect(result.category).toBe('vanity');
    expect(result.style).toBe('classic');
  });
});
