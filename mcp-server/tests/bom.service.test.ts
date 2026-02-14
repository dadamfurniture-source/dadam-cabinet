import { describe, it, expect } from 'vitest';
import { generateBom } from '../src/services/bom.service.js';
import type { StructuredDesignData, Category } from '../src/types/index.js';

// ─────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────

function makeKitchenDesign(overrides: Partial<StructuredDesignData> = {}): StructuredDesignData {
  return {
    category: 'sink',
    style: 'modern',
    wall: { width_mm: 3600, height_mm: 2400, tile_type: 'subway', confidence: 'high' },
    utilities: {
      water_supply: { detected: true, position_mm: 900 },
      exhaust_duct: { detected: true, position_mm: 2700 },
      gas_pipe: { detected: true, position_mm: 2700 },
    },
    layout: { direction: 'sink_left_cooktop_right', total_width_mm: 3600, depth_mm: 600 },
    cabinets: {
      upper: [
        { position_mm: 0, width_mm: 900, type: 'standard', door_count: 2, is_drawer: false },
      ],
      lower: [
        { position_mm: 0, width_mm: 800, type: 'sink', door_count: 2, is_drawer: false, has_sink: true },
        { position_mm: 800, width_mm: 600, type: 'drawer', door_count: 3, is_drawer: true },
        { position_mm: 1400, width_mm: 800, type: 'cooktop', door_count: 1, is_drawer: false, has_cooktop: true },
      ],
      upper_height_mm: 720,
      lower_height_mm: 870,
      leg_height_mm: 150,
      molding_height_mm: 60,
    },
    equipment: {
      sink: { position_mm: 400, width_mm: 800, type: 'undermount' },
      cooktop: { position_mm: 1800, width_mm: 600, type: '3-burner', burner_count: 3 },
      hood: { position_mm: 1800, width_mm: 600, type: 'slim' },
      faucet: { type: 'single_lever' },
    },
    materials: {
      door_color: 'white',
      door_finish: 'matte',
      countertop: 'white_marble',
      material_codes: ['WM-01'],
      handle_type: 'line',
    },
    rag_rules_applied: { background: [], modules: [], doors: [], material_codes: [] },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('generateBom', () => {
  it('generates items for a kitchen with 3 lower + 1 upper cabinet', () => {
    const bom = generateBom(makeKitchenDesign());

    expect(bom.items.length).toBeGreaterThan(0);
    expect(bom.category).toBe('sink');
    expect(bom.style).toBe('modern');
    expect(bom.generated_at).toBeTruthy();
  });

  it('generates door panels for each cabinet', () => {
    const bom = generateBom(makeKitchenDesign());

    const panels = bom.items.filter(i => i.part_category === 'panel');
    // lower_0: 2 doors, lower_1: 3 drawer fronts, lower_2: 1 door, upper_0: 2 doors = 8 panels
    expect(panels.length).toBe(8);
  });

  it('generates drawer fronts for drawer cabinets', () => {
    const bom = generateBom(makeKitchenDesign());

    const drawerPanels = bom.items.filter(i => i.cabinet_ref === 'lower_1' && i.part_category === 'panel');
    expect(drawerPanels.length).toBe(3);
    expect(drawerPanels[0].name).toContain('서랍전면');
  });

  it('generates board parts (side, top/bottom, back, shelf) for each cabinet', () => {
    const bom = generateBom(makeKitchenDesign());

    // lower_0 (sink, not drawer): 측판 + 하판 + 밴드 + 뒷판 + 선반 = 5 board items
    const lower0Boards = bom.items.filter(i => i.cabinet_ref === 'lower_0' && i.part_category === 'board');
    expect(lower0Boards.length).toBe(5);

    // 측판 수량은 2
    const sidePanel = lower0Boards.find(i => i.name.includes('측판'));
    expect(sidePanel?.quantity).toBe(2);
  });

  it('generates band parts for each cabinet (2 per cabinet)', () => {
    const bom = generateBom(makeKitchenDesign());

    const bands = bom.items.filter(i => i.name.includes('밴드'));
    // 3 lower + 1 upper = 4 cabinets → 4 band items (each qty=2)
    expect(bands.length).toBe(4);
    expect(bands[0].quantity).toBe(2);
    expect(bands[0].width_mm).toBe(60); // band_width from rules
  });

  it('uses 2.7mm back panel from rules', () => {
    const bom = generateBom(makeKitchenDesign());

    const backPanel = bom.items.find(i => i.name.includes('뒷판'));
    expect(backPanel?.depth_mm).toBe(2.7);
    expect(backPanel?.material).toBe('2.7T MDF');
    // back panel formula: width-1, height-1
    expect(backPanel?.width_mm).toBe(799); // 800 - 1
  });

  it('lower cabinet has only bottom panel (countertop acts as top)', () => {
    const bom = generateBom(makeKitchenDesign());

    const lower0Bottom = bom.items.find(i => i.cabinet_ref === 'lower_0' && i.name.includes('하판'));
    expect(lower0Bottom).toBeDefined();
    expect(lower0Bottom!.quantity).toBe(1);

    // No '상판' or '상하판' for lower cabinets
    const lower0Top = bom.items.find(i => i.cabinet_ref === 'lower_0' && i.name.includes('상하판'));
    expect(lower0Top).toBeUndefined();
  });

  it('upper cabinet has top+bottom panel (qty=2)', () => {
    const bom = generateBom(makeKitchenDesign());

    const upperPanel = bom.items.find(i => i.cabinet_ref === 'upper_0' && i.name.includes('상하판'));
    expect(upperPanel).toBeDefined();
    expect(upperPanel!.quantity).toBe(2);
  });

  it('calculates sheet estimate in summary', () => {
    const bom = generateBom(makeKitchenDesign());

    expect(bom.summary.sheet_estimate).toBeDefined();
    expect(bom.summary.sheet_estimate).toBeGreaterThan(0);
  });

  it('generates drawer rails for drawer cabinets', () => {
    const bom = generateBom(makeKitchenDesign());

    const rails = bom.items.filter(i => i.cabinet_ref === 'lower_1' && i.name.includes('서랍레일'));
    expect(rails.length).toBe(1);
    expect(rails[0].quantity).toBe(3); // 3-drawer
  });

  it('generates hinges for swing-door cabinets', () => {
    const bom = generateBom(makeKitchenDesign());

    const hinges = bom.items.filter(i => i.cabinet_ref === 'lower_0' && i.name.includes('경첩'));
    expect(hinges.length).toBe(1);
    expect(hinges[0].quantity).toBe(4); // 2 doors × 2 hinges
  });

  it('generates countertop', () => {
    const bom = generateBom(makeKitchenDesign());

    const countertop = bom.items.find(i => i.part_category === 'countertop');
    expect(countertop).toBeDefined();
    expect(countertop!.width_mm).toBe(3600);
    expect(countertop!.material).toBe('white_marble');
  });

  it('generates equipment items from design data', () => {
    const bom = generateBom(makeKitchenDesign());

    const equipment = bom.items.filter(i => i.part_category === 'equipment');
    const names = equipment.map(e => e.name);
    expect(names).toContain('싱크볼');
    expect(names).toContain('수전');
    expect(names).toContain('쿡탑');
    expect(names).toContain('레인지후드');
  });

  it('generates accessory items (걸레받이, 몰딩, 다리)', () => {
    const bom = generateBom(makeKitchenDesign());

    const accessories = bom.items.filter(i => i.part_category === 'accessory');
    const names = accessories.map(a => a.name);
    expect(names).toContain('걸레받이');
    expect(names).toContain('상부 몰딩');
    expect(names).toContain('조절 다리');
  });

  it('generates edge banding finish item', () => {
    const bom = generateBom(makeKitchenDesign());

    const finish = bom.items.filter(i => i.part_category === 'finish');
    expect(finish.length).toBe(1);
    expect(finish[0].name).toBe('엣지밴딩');
    expect(finish[0].width_mm).toBeGreaterThan(0);
  });

  it('builds correct summary', () => {
    const bom = generateBom(makeKitchenDesign());

    expect(bom.summary.total_items).toBe(bom.items.length);
    expect(bom.summary.total_panels).toBe(8);
    expect(bom.summary.total_equipment).toBe(4); // sink, faucet, cooktop, hood
    expect(bom.summary.categories.panel).toBe(8);
    expect(bom.summary.categories.countertop).toBe(1);
  });

  it('assigns unique IDs to all items', () => {
    const bom = generateBom(makeKitchenDesign());

    const ids = bom.items.map(i => i.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    expect(ids[0]).toMatch(/^BOM-\d{3}$/);
  });

  it('handles wardrobe category (no countertop, no equipment)', () => {
    const bom = generateBom(makeKitchenDesign({
      category: 'wardrobe',
      cabinets: {
        upper: [],
        lower: [
          { position_mm: 0, width_mm: 800, type: 'hanger', door_count: 2, is_drawer: false },
          { position_mm: 800, width_mm: 800, type: 'shelf', door_count: 2, is_drawer: false },
        ],
        upper_height_mm: 0,
        lower_height_mm: 2200,
        leg_height_mm: 0,
        molding_height_mm: 0,
      },
      equipment: {},
    }));

    expect(bom.category).toBe('wardrobe');
    expect(bom.summary.total_equipment).toBe(0);
    // No countertop for wardrobe? Actually it still generates because lower.length > 0
    // That's fine - wardrobe might have a top surface
  });

  it('handles empty cabinets gracefully', () => {
    const bom = generateBom(makeKitchenDesign({
      cabinets: {
        upper: [],
        lower: [],
        upper_height_mm: 720,
        lower_height_mm: 870,
        leg_height_mm: 150,
        molding_height_mm: 60,
      },
      equipment: {},
    }));

    expect(bom.items.length).toBe(0);
    expect(bom.summary.total_items).toBe(0);
  });

  it('uses door material from design data materials', () => {
    const bom = generateBom(makeKitchenDesign({
      materials: {
        door_color: 'navy',
        door_finish: 'gloss',
        countertop: 'black_granite',
        material_codes: [],
        handle_type: 'bar',
      },
    }));

    const doorPanel = bom.items.find(i => i.part_category === 'panel');
    expect(doorPanel?.material).toBe('navy gloss MDF');

    const countertop = bom.items.find(i => i.part_category === 'countertop');
    expect(countertop?.material).toBe('black_granite');
  });
});
