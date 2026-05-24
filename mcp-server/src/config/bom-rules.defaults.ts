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

// ═══════════════════════════════════════════════════════════════
// W7-4: 도어 자재 코드 → 단가 매트릭스
//
// W7-1 의 finishCode (PET-OAK-M, MFB-WHT, ...) 를 단가 (₩/m²) 로 변환.
// W7-3 extractors.js 의 finishCode 출력을 BOM Excel/CSV 단가 column 에 사용.
//
// 가격 모델: base finish price × color multiplier (Math.round)
//   - finish base: tone (matte/gloss/single) 별 분리
//   - color multiplier: 특수 색 (sage) +10%, 짙은 색 (walnut/graphite) +5%,
//     양산 색 (white/black) -5%, 기본 (cream/oak) 1.00
//
// 49 조합 ₩9,500 (MFB-WHT) ~ ₩41,800 (VNR-SAG) 범위.
// ═══════════════════════════════════════════════════════════════

/** finish 기본 단가 (₩/m²). key = finishCode prefix (toneSuffix 포함). */
export const FINISH_BASE_PRICE: Record<string, number> = {
  'PET-M': 24000,  // PET 매트
  'PET-G': 26000,  // PET 광택
  'MFB':   14000,  // MFB 멜라민 (single tone)
  'LPM':   16000,  // LPM 라미네이트 (single tone)
  'PNT-M': 32000,  // 도장 무광
  'PNT-G': 34000,  // 도장 유광
  'VNR':   38000,  // 무늬목 (single tone)
};

/** color 단가 multiplier. */
export const COLOR_PRICE_MULTIPLIER: Record<string, number> = {
  CRM: 1.00,  // 크림 (기본)
  OAK: 1.00,  // 오크 (기본)
  WNT: 1.05,  // 월넛 (짙은)
  GRP: 1.05,  // 그라파이트 (짙은)
  WHT: 0.95,  // 화이트 (양산)
  BLK: 0.95,  // 블랙 (양산)
  SAG: 1.10,  // 세이지 (특수)
};

/** 도어 자재 코드 → 단가 (₩/m²). null = 매핑 실패 또는 default MDF. */
export function getDoorFinishPrice(finishCode: string | null | undefined): number | null {
  if (!finishCode || finishCode === 'MDF-DEFAULT') return null;
  const parts = finishCode.split('-');
  if (parts.length < 2) return null;

  let baseKey: string;
  let colorCode: string;
  if (parts.length === 3) {
    // FINISH-COLOR-TONE (예: PET-OAK-M)
    baseKey = `${parts[0]}-${parts[2]}`;
    colorCode = parts[1];
  } else {
    // FINISH-COLOR (single tone, 예: MFB-WHT)
    baseKey = parts[0];
    colorCode = parts[1];
  }

  const base = FINISH_BASE_PRICE[baseKey];
  if (base == null) return null;
  const mult = COLOR_PRICE_MULTIPLIER[colorCode] ?? 1.00;
  return Math.round(base * mult);
}

/** 49 조합 전체 매트릭스 dict (디버깅/테스트). { finishCode: price } */
export function buildDoorPricingMatrix(): Record<string, number> {
  const finishes = ['pet-matte', 'pet-gloss', 'mfb', 'lpm', 'paint-matte', 'paint-gloss', 'veneer'];
  const colors = ['cream', 'oak', 'walnut', 'graphite', 'white', 'black', 'sage'];
  const finishCodeMap: Record<string, string> = {
    'pet-matte': 'PET', 'pet-gloss': 'PET', 'mfb': 'MFB', 'lpm': 'LPM',
    'paint-matte': 'PNT', 'paint-gloss': 'PNT', 'veneer': 'VNR',
  };
  const toneMap: Record<string, string> = {
    'pet-matte': 'M', 'pet-gloss': 'G', 'paint-matte': 'M', 'paint-gloss': 'G',
    'mfb': '', 'lpm': '', 'veneer': '',
  };
  const colorCodeMap: Record<string, string> = {
    cream: 'CRM', oak: 'OAK', walnut: 'WNT', graphite: 'GRP',
    white: 'WHT', black: 'BLK', sage: 'SAG',
  };

  const matrix: Record<string, number> = {};
  for (const f of finishes) {
    for (const c of colors) {
      const tone = toneMap[f];
      const code = tone
        ? `${finishCodeMap[f]}-${colorCodeMap[c]}-${tone}`
        : `${finishCodeMap[f]}-${colorCodeMap[c]}`;
      const price = getDoorFinishPrice(code);
      if (price != null) matrix[code] = price;
    }
  }
  return matrix;
}
