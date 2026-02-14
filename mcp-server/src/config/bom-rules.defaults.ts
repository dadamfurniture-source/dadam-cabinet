// ═══════════════════════════════════════════════════════════════
// BOM Rules - 타입 정의 + 기본값 (Rules.txt 기반)
// JSON 파일 없을 때 폴백으로 사용
// ═══════════════════════════════════════════════════════════════

export interface MaterialSpec {
  thickness: number;
  type?: string;
  label?: string;
}

export interface BomRules {
  materials: {
    sheet_size: { width: number; height: number };
    body: MaterialSpec;
    door: MaterialSpec;
    back_panel: MaterialSpec;
    edge_band: { thickness: number };
    countertop: { thickness: number };
  };
  cabinet_defaults: {
    width: number;
    height: number;
    depth: number;
  };
  construction: {
    side_panel_qty: number;
    bottom_panel_qty: number;
    band_qty: number;
    band_width: number;
    back_panel_qty: number;
    back_panel_clearance: number;
    door_gap: number;
    shelf_depth_reduction: number;
  };
  upper_cabinet: {
    depth_ratio: number;
    top_panel: boolean;
  };
  hardware: {
    hinges_per_door: number;
    hinge_type: string;
    slide_type: string;
  };
  molding_clearance: {
    width_min: number;
    width_max: number;
    height_min: number;
    height_max: number;
    depth: number;
  };
  wardrobe: {
    unit_width_min: number;
    unit_width_max: number;
    allow_half_units: boolean;
    shelf_per_section: number;
  };
}

export const DEFAULT_BOM_RULES: BomRules = {
  materials: {
    sheet_size: { width: 1220, height: 2440 },
    body: { thickness: 18, type: 'PB', label: '18T PB' },
    door: { thickness: 18, type: 'MDF', label: '18T MDF' },
    back_panel: { thickness: 2.7, type: 'MDF', label: '2.7T MDF' },
    edge_band: { thickness: 1 },
    countertop: { thickness: 30 },
  },
  cabinet_defaults: {
    width: 600,
    height: 800,
    depth: 550,
  },
  construction: {
    side_panel_qty: 2,
    bottom_panel_qty: 1,
    band_qty: 2,
    band_width: 60,
    back_panel_qty: 1,
    back_panel_clearance: 1,
    door_gap: 4,
    shelf_depth_reduction: 20,
  },
  upper_cabinet: {
    depth_ratio: 0.55,
    top_panel: true,
  },
  hardware: {
    hinges_per_door: 2,
    hinge_type: 'soft-close',
    slide_type: 'soft-close',
  },
  molding_clearance: {
    width_min: 45,
    width_max: 120,
    height_min: 10,
    height_max: 60,
    depth: 20,
  },
  wardrobe: {
    unit_width_min: 750,
    unit_width_max: 1050,
    allow_half_units: true,
    shelf_per_section: 1,
  },
};
