// ═══════════════════════════════════════════════════════════════
// Design Data Service - 구조화된 설계 데이터 추출 (순수 로직)
// 벽면 분석 + RAG 규칙 + 사용자 입력 → StructuredDesignData JSON
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { calculateFurniturePlacement } from './furniture-placement.service.js';
import type { ClassifiedRules } from '../mappers/rule-classifier.js';
import type {
  Category,
  WallAnalysis,
  CabinetSpecs,
  ModulesData,
  ModuleInfo,
  CabinetUnit,
  StructuredDesignData,
} from '../types/index.js';

const log = createLogger('design-data');

export interface ExtractDesignDataInput {
  category: Category;
  style: string;
  wallData: WallAnalysis;
  classified: ClassifiedRules;
  cabinetSpecs?: CabinetSpecs;
  modules?: ModulesData;
}

export function extractDesignData(input: ExtractDesignDataInput): StructuredDesignData {
  const { category, style, wallData, classified, cabinetSpecs, modules } = input;

  const placement = wallData.furniture_placement ?? calculateFurniturePlacement(wallData);
  const wallWidth = wallData.wall_width_mm || 3000;
  const wallHeight = wallData.wall_height_mm || 2400;
  const depth = cabinetSpecs?.depth_mm ?? 600;

  // 유틸리티 위치 매핑
  const utilities = mapUtilities(wallData, wallWidth);

  // 레이아웃
  const layout = {
    direction: placement.layout_direction || 'sink_left_cooktop_right',
    total_width_mm: cabinetSpecs?.total_width_mm ?? wallWidth,
    depth_mm: depth,
  };

  // 캐비닛 높이 기본값
  const upperHeight = cabinetSpecs?.upper_cabinet_height ?? 720;
  const lowerHeight = cabinetSpecs?.lower_cabinet_height ?? 870;
  const legHeight = cabinetSpecs?.leg_height ?? 150;
  const moldingHeight = cabinetSpecs?.molding_height ?? 60;

  // 캐비닛 유닛 생성
  const { upper, lower } = buildCabinetUnits(
    category, layout.total_width_mm, placement, modules, cabinetSpecs
  );

  // 설비 매핑
  const equipment = mapEquipment(category, placement, cabinetSpecs);

  // 자재 매핑
  const materials = mapMaterials(classified, cabinetSpecs);

  // RAG 규칙 적용 내역
  const ragRulesApplied = {
    background: classified.background,
    modules: classified.modules,
    doors: classified.doors,
    material_codes: classified.materials.map(m => m.content),
  };

  const result: StructuredDesignData = {
    category,
    style,
    wall: {
      width_mm: wallWidth,
      height_mm: wallHeight,
      tile_type: wallData.tile_type || 'unknown',
      confidence: wallData.confidence,
    },
    utilities,
    layout,
    cabinets: {
      upper,
      lower,
      upper_height_mm: upperHeight,
      lower_height_mm: lowerHeight,
      leg_height_mm: legHeight,
      molding_height_mm: moldingHeight,
    },
    equipment,
    materials,
    rag_rules_applied: ragRulesApplied,
  };

  log.info({
    category,
    upperCount: upper.length,
    lowerCount: lower.length,
  }, 'Design data extracted');

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────

function mapUtilities(wallData: WallAnalysis, wallWidth: number) {
  const up = wallData.utility_positions;

  const waterDetected = !!(wallData.water_pipe_x ?? up?.water_supply?.detected);
  const waterPos = wallData.water_pipe_x
    ?? up?.water_supply?.from_origin_mm
    ?? Math.round(wallWidth * 0.3);

  const exhaustDetected = !!(wallData.exhaust_duct_x ?? up?.exhaust_duct?.detected);
  const exhaustPos = wallData.exhaust_duct_x
    ?? up?.exhaust_duct?.from_origin_mm
    ?? Math.round(wallWidth * 0.7);

  const gasDetected = !!(wallData.gas_pipe_x ?? up?.gas_pipe?.detected ?? up?.gas_line?.detected);
  const gasPos = wallData.gas_pipe_x
    ?? up?.gas_pipe?.from_origin_mm
    ?? up?.gas_line?.from_origin_mm
    ?? Math.round(wallWidth * 0.7);

  return {
    water_supply: { detected: waterDetected, position_mm: waterPos },
    exhaust_duct: { detected: exhaustDetected, position_mm: exhaustPos },
    gas_pipe: { detected: gasDetected, position_mm: gasPos },
  };
}

function mapEquipment(
  category: Category,
  placement: { sink_center_mm?: number; cooktop_center_mm?: number },
  specs?: CabinetSpecs,
) {
  const equipment: StructuredDesignData['equipment'] = {};

  if (category === 'sink') {
    const sinkCenter = specs?.sink_position_mm ?? placement.sink_center_mm ?? 0;
    equipment.sink = {
      position_mm: sinkCenter,
      width_mm: 800,
      type: specs?.sink_type ?? 'undermount',
    };

    const cooktopCenter = specs?.cooktop_position_mm ?? placement.cooktop_center_mm ?? 0;
    equipment.cooktop = {
      position_mm: cooktopCenter,
      width_mm: 600,
      type: specs?.cooktop_type ?? '3-burner',
      burner_count: 3,
    };

    equipment.hood = {
      position_mm: cooktopCenter,
      width_mm: 600,
      type: specs?.hood_type ?? 'slim',
    };

    equipment.faucet = {
      type: specs?.faucet_type ?? 'single_lever',
    };
  } else if (category === 'vanity') {
    equipment.sink = {
      position_mm: placement.sink_center_mm ?? Math.round((specs?.total_width_mm ?? 1200) / 2),
      width_mm: 500,
      type: specs?.sink_type ?? 'vessel',
    };

    equipment.faucet = {
      type: specs?.faucet_type ?? 'single_lever',
    };
  }

  return equipment;
}

function mapMaterials(classified: ClassifiedRules, specs?: CabinetSpecs) {
  const materialCodes = classified.materials.map(m => {
    const code = m.triggers?.[0] || m.content.slice(0, 20);
    return code;
  });

  return {
    door_color: specs?.door_color_upper ?? specs?.door_color_lower ?? 'white',
    door_finish: specs?.door_finish_upper ?? specs?.door_finish_lower ?? 'matte',
    countertop: specs?.countertop_color ?? 'white_marble',
    material_codes: materialCodes,
    handle_type: specs?.handle_type ?? 'line',
  };
}

function buildCabinetUnits(
  category: Category,
  totalWidth: number,
  placement: { sink_center_mm?: number; cooktop_center_mm?: number },
  modules?: ModulesData,
  specs?: CabinetSpecs,
): { upper: CabinetUnit[]; lower: CabinetUnit[] } {
  // 사용자가 모듈 데이터를 제공한 경우 그것을 사용
  if (modules?.lower?.length || modules?.upper?.length) {
    return buildFromUserModules(modules, totalWidth);
  }

  // 카테고리별 기본 캐비닛 생성
  switch (category) {
    case 'sink':
      return buildKitchenCabinets(totalWidth, placement, specs);
    case 'wardrobe':
      return buildWardrobeCabinets(totalWidth);
    case 'fridge':
      return buildFridgeCabinets(totalWidth);
    default:
      return buildGenericCabinets(totalWidth);
  }
}

function buildFromUserModules(
  modules: ModulesData,
  totalWidth: number,
): { upper: CabinetUnit[]; lower: CabinetUnit[] } {
  const toUnit = (m: ModuleInfo, pos: number): CabinetUnit => ({
    position_mm: pos,
    width_mm: m.width_mm ?? m.w ?? 600,
    type: m.has_sink ? 'sink' : m.has_cooktop ? 'cooktop' : (m.is_drawer ?? m.isDrawer) ? 'drawer' : 'standard',
    door_count: m.door_count ?? m.doorCount ?? 1,
    is_drawer: m.is_drawer ?? m.isDrawer ?? false,
    has_sink: m.has_sink,
    has_cooktop: m.has_cooktop,
  });

  const buildLine = (list?: ModuleInfo[]): CabinetUnit[] => {
    if (!list?.length) return [];
    let pos = 0;
    return list.map(m => {
      const unit = toUnit(m, pos);
      pos += unit.width_mm;
      return unit;
    });
  };

  return {
    upper: buildLine(modules.upper),
    lower: buildLine(modules.lower),
  };
}

function buildKitchenCabinets(
  totalWidth: number,
  placement: { sink_center_mm?: number; cooktop_center_mm?: number },
  specs?: CabinetSpecs,
): { upper: CabinetUnit[]; lower: CabinetUnit[] } {
  const sinkCenter = specs?.sink_position_mm ?? placement.sink_center_mm ?? Math.round(totalWidth * 0.3);
  const cooktopCenter = specs?.cooktop_position_mm ?? placement.cooktop_center_mm ?? Math.round(totalWidth * 0.7);

  // 하부장: 싱크(800) + 서랍(600) + 일반(가변) + 쿡탑(800)
  const sinkWidth = 800;
  const drawerWidth = 600;
  const cooktopWidth = 800;
  const sinkStart = Math.max(0, sinkCenter - sinkWidth / 2);
  const cooktopStart = Math.max(0, cooktopCenter - cooktopWidth / 2);

  const lower: CabinetUnit[] = [];

  // 싱크가 왼쪽인 경우 (기본)
  if (sinkCenter <= cooktopCenter) {
    lower.push({ position_mm: sinkStart, width_mm: sinkWidth, type: 'sink', door_count: 2, is_drawer: false, has_sink: true });
    const afterSink = sinkStart + sinkWidth;
    const gapBeforeCooktop = cooktopStart - afterSink;
    if (gapBeforeCooktop >= drawerWidth) {
      lower.push({ position_mm: afterSink, width_mm: drawerWidth, type: 'drawer', door_count: 3, is_drawer: true });
      const remaining = cooktopStart - afterSink - drawerWidth;
      if (remaining >= 400) {
        lower.push({ position_mm: afterSink + drawerWidth, width_mm: remaining, type: 'standard', door_count: 1, is_drawer: false });
      }
    } else if (gapBeforeCooktop >= 400) {
      lower.push({ position_mm: afterSink, width_mm: gapBeforeCooktop, type: 'standard', door_count: 1, is_drawer: false });
    }
    lower.push({ position_mm: cooktopStart, width_mm: cooktopWidth, type: 'cooktop', door_count: 1, is_drawer: false, has_cooktop: true });
  } else {
    // 싱크가 오른쪽인 경우
    lower.push({ position_mm: cooktopStart, width_mm: cooktopWidth, type: 'cooktop', door_count: 1, is_drawer: false, has_cooktop: true });
    const afterCooktop = cooktopStart + cooktopWidth;
    const gapBeforeSink = sinkStart - afterCooktop;
    if (gapBeforeSink >= drawerWidth) {
      lower.push({ position_mm: afterCooktop, width_mm: drawerWidth, type: 'drawer', door_count: 3, is_drawer: true });
      const remaining = sinkStart - afterCooktop - drawerWidth;
      if (remaining >= 400) {
        lower.push({ position_mm: afterCooktop + drawerWidth, width_mm: remaining, type: 'standard', door_count: 1, is_drawer: false });
      }
    } else if (gapBeforeSink >= 400) {
      lower.push({ position_mm: afterCooktop, width_mm: gapBeforeSink, type: 'standard', door_count: 1, is_drawer: false });
    }
    lower.push({ position_mm: sinkStart, width_mm: sinkWidth, type: 'sink', door_count: 2, is_drawer: false, has_sink: true });
  }

  // 상부장: 쿡탑 위(후드영역) 제외하고 균등 분배
  const upper = buildUpperCabinets(totalWidth, cooktopCenter, 600);

  return { upper, lower };
}

function buildUpperCabinets(totalWidth: number, hoodCenter: number, hoodWidth: number): CabinetUnit[] {
  const upper: CabinetUnit[] = [];
  const hoodStart = Math.max(0, hoodCenter - hoodWidth / 2);
  const hoodEnd = hoodStart + hoodWidth;

  // 후드 왼쪽 영역
  if (hoodStart >= 600) {
    const count = Math.floor(hoodStart / 600);
    const unitWidth = Math.round(hoodStart / count);
    for (let i = 0; i < count; i++) {
      upper.push({ position_mm: i * unitWidth, width_mm: unitWidth, type: 'standard', door_count: 1, is_drawer: false });
    }
  } else if (hoodStart >= 400) {
    upper.push({ position_mm: 0, width_mm: hoodStart, type: 'standard', door_count: 1, is_drawer: false });
  }

  // 후드 오른쪽 영역
  const rightSpace = totalWidth - hoodEnd;
  if (rightSpace >= 600) {
    const count = Math.floor(rightSpace / 600);
    const unitWidth = Math.round(rightSpace / count);
    for (let i = 0; i < count; i++) {
      upper.push({ position_mm: hoodEnd + i * unitWidth, width_mm: unitWidth, type: 'standard', door_count: 1, is_drawer: false });
    }
  } else if (rightSpace >= 400) {
    upper.push({ position_mm: hoodEnd, width_mm: rightSpace, type: 'standard', door_count: 1, is_drawer: false });
  }

  return upper;
}

function buildWardrobeCabinets(totalWidth: number): { upper: CabinetUnit[]; lower: CabinetUnit[] } {
  // 붙박이장: 행거장 + 서랍장 + 선반장
  const unitCount = Math.max(2, Math.round(totalWidth / 800));
  const unitWidth = Math.round(totalWidth / unitCount);
  const lower: CabinetUnit[] = [];

  for (let i = 0; i < unitCount; i++) {
    const isFirst = i === 0;
    const isLast = i === unitCount - 1;
    lower.push({
      position_mm: i * unitWidth,
      width_mm: unitWidth,
      type: isFirst ? 'hanger' : isLast ? 'shelf' : 'drawer',
      door_count: 2,
      is_drawer: !isFirst && !isLast,
    });
  }

  return { upper: [], lower };
}

function buildFridgeCabinets(totalWidth: number): { upper: CabinetUnit[]; lower: CabinetUnit[] } {
  // 냉장고장: 냉장고장(900) + EL장(600) + 선반
  const lower: CabinetUnit[] = [];
  let pos = 0;

  // 냉장고 공간
  const fridgeWidth = Math.min(900, totalWidth);
  lower.push({ position_mm: pos, width_mm: fridgeWidth, type: 'fridge', door_count: 0, is_drawer: false });
  pos += fridgeWidth;

  // EL장
  if (totalWidth - pos >= 600) {
    lower.push({ position_mm: pos, width_mm: 600, type: 'appliance', door_count: 1, is_drawer: false });
    pos += 600;
  }

  // 나머지 선반
  const remaining = totalWidth - pos;
  if (remaining >= 400) {
    lower.push({ position_mm: pos, width_mm: remaining, type: 'shelf', door_count: 1, is_drawer: false });
  }

  return { upper: [], lower };
}

function buildGenericCabinets(totalWidth: number): { upper: CabinetUnit[]; lower: CabinetUnit[] } {
  const unitCount = Math.max(2, Math.round(totalWidth / 600));
  const unitWidth = Math.round(totalWidth / unitCount);
  const lower: CabinetUnit[] = [];

  for (let i = 0; i < unitCount; i++) {
    lower.push({
      position_mm: i * unitWidth,
      width_mm: unitWidth,
      type: 'standard',
      door_count: 1,
      is_drawer: false,
    });
  }

  return { upper: [], lower };
}
