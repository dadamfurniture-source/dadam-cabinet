import { describe, it, expect } from 'vitest';
import { generateDrawingData } from '../src/services/drawing.service.js';
import type { StructuredDesignData } from '../src/types/index.js';

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
        { position_mm: 900, width_mm: 900, type: 'standard', door_count: 2, is_drawer: false },
        { position_mm: 1800, width_mm: 900, type: 'standard', door_count: 2, is_drawer: false },
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

describe('generateDrawingData', () => {
  // 1. 주방 3캐비닛 기본 도면 생성
  it('generates drawing data for a kitchen with 3 lower + 3 upper cabinets', () => {
    const drawing = generateDrawingData(makeKitchenDesign());

    expect(drawing.common.front_view).toBeDefined();
    expect(drawing.common.side_view).toBeDefined();
    expect(drawing.common.plan_view).toBeDefined();
    expect(drawing.manufacturing).toBeDefined();
    expect(drawing.installation).toBeDefined();
    expect(drawing.metadata.category).toBe('sink');
    expect(drawing.metadata.style).toBe('modern');
    expect(drawing.metadata.generated_at).toBeTruthy();

    // 6 cabinets total in front view
    expect(drawing.common.front_view.cabinets.length).toBe(6);
  });

  // 2. 도어 좌표 정확성 (너비, 갭 반영)
  it('calculates door coordinates correctly with gap', () => {
    const drawing = generateDrawingData(makeKitchenDesign());
    const frontView = drawing.common.front_view;

    // lower_0: 2-door, width=800, doorGap=4
    // doorWidth = Math.round((800 - 4) / 2) = 398
    const lower0Doors = frontView.doors.filter(d => d.ref === 'lower_0' && !d.is_drawer);
    expect(lower0Doors.length).toBe(2);

    const door0 = lower0Doors[0];
    const door1 = lower0Doors[1];

    // door0 starts at x=0+2 (gap/2)
    expect(door0.x).toBe(2);
    // doorWidth = round((800-4)/2) = 398
    expect(door0.width).toBe(398);
    // door1 starts at x = 0 + 398 + 2
    expect(door1.x).toBe(400);
    expect(door1.width).toBe(398);

    // height = 720 (lower body height) - 4 (gap) = 716
    const legH = 150;
    const lowerBodyH = 870 - legH; // 720
    expect(door0.height).toBe(lowerBodyH - 4);
  });

  // 3. 서랍 캐비닛 높이 분할
  it('splits drawer cabinet height evenly', () => {
    const drawing = generateDrawingData(makeKitchenDesign());
    const frontView = drawing.common.front_view;

    // lower_1: 3 drawers, bodyH = 720
    const drawers = frontView.doors.filter(d => d.ref === 'lower_1' && d.is_drawer);
    expect(drawers.length).toBe(3);

    const drawerHeight = Math.round(720 / 3); // 240
    expect(drawers[0].height).toBe(drawerHeight - 4); // 236
    expect(drawers[1].height).toBe(drawerHeight - 4);
    expect(drawers[2].height).toBe(drawerHeight - 4);

    // Y positions: legH=150, each drawer 240px apart
    expect(drawers[0].y).toBe(150 + 2); // cabY + gap/2
    expect(drawers[1].y).toBe(150 + 240 + 2);
    expect(drawers[2].y).toBe(150 + 480 + 2);
  });

  // 4. 경첩/핸들 위치
  it('places hinges at 100mm from top/bottom and handles at center', () => {
    const drawing = generateDrawingData(makeKitchenDesign());
    const hw = drawing.common.front_view.hardware;

    // lower_0 (2 swing doors) should have hinges
    const lower0Hinges = hw.filter(h => h.ref === 'lower_0' && h.type === 'hinge');
    // 2 doors × 2 hinges each = 4
    expect(lower0Hinges.length).toBe(4);

    const legH = 150;
    // First hinge at cabY + 100 = 150 + 100 = 250
    expect(lower0Hinges[0].y).toBe(legH + 100);
    // Second hinge at cabY + bodyH - 100 = 150 + 720 - 100 = 770
    expect(lower0Hinges[1].y).toBe(legH + 720 - 100);

    // Handles for lower_0
    const lower0Handles = hw.filter(h => h.ref === 'lower_0' && h.type === 'handle');
    expect(lower0Handles.length).toBe(2); // one per door
    // Handle Y at cabY + height/2 = 150 + 360 = 510
    expect(lower0Handles[0].y).toBe(legH + 720 / 2);
  });

  // 5. 단면도 패널 두께 반영 (18T 측판, 2.7T 뒷판)
  it('reflects panel thicknesses in side view (18T side, 2.7T back)', () => {
    const drawing = generateDrawingData(makeKitchenDesign());
    const sideView = drawing.common.side_view;

    const sidePanel = sideView.panels.find(p => p.name === '좌측판');
    expect(sidePanel?.thickness).toBe(18);
    expect(sidePanel?.width).toBe(18);

    const backPanel = sideView.panels.find(p => p.name === '뒷판');
    expect(backPanel?.thickness).toBe(2.7);
    expect(backPanel?.width).toBe(2.7);

    // back panel position: depth - 2.7
    expect(backPanel?.x).toBe(600 - 2.7);

    // Dimension lines should report thicknesses
    const sideDim = sideView.dimensions.find(d => d.label === '측판 두께');
    expect(sideDim?.value).toBe(18);
    const backDim = sideView.dimensions.find(d => d.label === '뒷판 두께');
    expect(backDim?.value).toBe(2.7);
  });

  // 6. 평면도 상부/하부 깊이 차이
  it('shows different depths for upper and lower cabinets in plan view', () => {
    const drawing = generateDrawingData(makeKitchenDesign());
    const planView = drawing.common.plan_view;

    // Lower cabinets: full depth (600mm)
    expect(planView.lower_cabinets.length).toBe(3);
    expect(planView.lower_cabinets[0].height).toBe(600);

    // Upper cabinets: 55% depth = 330mm
    expect(planView.upper_cabinets.length).toBe(3);
    expect(planView.upper_cabinets[0].height).toBe(Math.round(600 * 0.55));
  });

  // 7. 제작 서브레이아웃 BOM 매핑
  it('maps manufacturing panel details to BOM items', () => {
    const drawing = generateDrawingData(makeKitchenDesign());
    const mfg = drawing.manufacturing;

    expect(mfg.panel_details.length).toBeGreaterThan(0);
    expect(mfg.bom_references.length).toBeGreaterThan(0);

    // All panel details should have valid BOM IDs
    for (const detail of mfg.panel_details) {
      expect(detail.bom_id).toMatch(/^BOM-\d{3}$/);
      expect(detail.rect.width).toBeGreaterThan(0);
      expect(detail.rect.height).toBeGreaterThan(0);
      expect(detail.dimensions.length).toBe(2); // width + height
    }

    // Edge banding marks should exist for door panels (4 edges each)
    expect(mfg.edge_banding_marks.length).toBeGreaterThan(0);
    // Should be multiple of 4 (4 edges per panel)
    const panelCount = mfg.panel_details.filter(p => p.name.includes('도어') || p.name.includes('서랍전면')).length;
    expect(mfg.edge_banding_marks.length).toBe(panelCount * 4);
  });

  // 8. 설치 서브레이아웃 배관 위치
  it('places utility marks from design data in installation layout', () => {
    const drawing = generateDrawingData(makeKitchenDesign());
    const inst = drawing.installation;

    expect(inst.wall.width).toBe(3600);
    expect(inst.wall.height).toBe(2400);

    // 3 utilities detected
    expect(inst.utilities.length).toBe(3);

    const water = inst.utilities.find(u => u.type === 'water');
    expect(water?.x).toBe(900);
    expect(water?.label).toBe('급수');

    const exhaust = inst.utilities.find(u => u.type === 'exhaust');
    expect(exhaust?.x).toBe(2700);

    const gas = inst.utilities.find(u => u.type === 'gas');
    expect(gas?.x).toBe(2700);

    // Equipment zones
    expect(inst.equipment.length).toBeGreaterThan(0);
    const sinkZone = inst.equipment.find(e => e.type === 'sink');
    expect(sinkZone).toBeDefined();
    expect(sinkZone!.label).toBe('싱크볼');

    // Tile grid
    expect(inst.tile_grid).toBeDefined();
    expect(inst.tile_grid!.cols).toBeGreaterThan(0);
    expect(inst.tile_grid!.rows).toBeGreaterThan(0);
  });

  // 9. 붙박이장 (카운터탑 없음, 설비 없음)
  it('handles wardrobe category (no countertop in front view, no equipment in installation)', () => {
    const drawing = generateDrawingData(makeKitchenDesign({
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
      utilities: {
        water_supply: { detected: false, position_mm: 0 },
        exhaust_duct: { detected: false, position_mm: 0 },
        gas_pipe: { detected: false, position_mm: 0 },
      },
    }));

    expect(drawing.metadata.category).toBe('wardrobe');

    // No upper cabinets
    const upperCabs = drawing.common.front_view.cabinets.filter(c => c.ref.startsWith('upper'));
    expect(upperCabs.length).toBe(0);

    // No molding (molding_height_mm = 0)
    expect(drawing.common.front_view.molding).toBeUndefined();

    // No baseboard (leg_height_mm = 0)
    expect(drawing.common.front_view.baseboard).toBeUndefined();

    // Lower cabinets at y=0 (no leg height)
    const lowerCabs = drawing.common.front_view.cabinets.filter(c => c.ref.startsWith('lower'));
    expect(lowerCabs[0].y).toBe(0);
    expect(lowerCabs[0].height).toBe(2200);

    // No utilities
    expect(drawing.installation.utilities.length).toBe(0);

    // No equipment
    expect(drawing.installation.equipment.length).toBe(0);
  });

  // 10. 빈 캐비닛 처리
  it('handles empty cabinets gracefully', () => {
    const drawing = generateDrawingData(makeKitchenDesign({
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

    expect(drawing.common.front_view.cabinets.length).toBe(0);
    expect(drawing.common.front_view.doors.length).toBe(0);
    expect(drawing.common.front_view.hardware.length).toBe(0);
    expect(drawing.common.front_view.countertop).toBeUndefined();
    expect(drawing.common.front_view.molding).toBeUndefined();
    expect(drawing.common.front_view.baseboard).toBeUndefined();

    expect(drawing.common.plan_view.lower_cabinets.length).toBe(0);
    expect(drawing.common.plan_view.upper_cabinets.length).toBe(0);

    expect(drawing.manufacturing.panel_details.length).toBe(0);
    expect(drawing.manufacturing.edge_banding_marks.length).toBe(0);
  });
});
