// ═══════════════════════════════════════════════════════════════
// BOM Service - StructuredDesignData → Bill of Materials
// 캐비닛 설계 데이터 + 제작 규칙(bom-rules.json) → 부품 목록
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { getBomRules } from '../config/bom-rules.loader.js';
import type { BomRules } from '../config/bom-rules.defaults.js';
import type {
  StructuredDesignData,
  CabinetUnit,
  BomItem,
  BomResult,
  BomSummary,
  BomPartCategory,
} from '../types/index.js';

const log = createLogger('bom');

export function generateBom(designData: StructuredDesignData): BomResult {
  const rules = getBomRules();
  const items: BomItem[] = [];
  let idCounter = 1;

  const nextId = () => `BOM-${String(idCounter++).padStart(3, '0')}`;

  const doorMaterial = `${designData.materials.door_color} ${designData.materials.door_finish} ${rules.materials.door.type}`;
  const bodyMaterial = rules.materials.body.label || `${rules.materials.body.thickness}T ${rules.materials.body.type}`;
  const backMaterial = rules.materials.back_panel.label || `${rules.materials.back_panel.thickness}T ${rules.materials.back_panel.type}`;

  // ─── 하부장 캐비닛 ───
  for (let i = 0; i < designData.cabinets.lower.length; i++) {
    const cab = designData.cabinets.lower[i];
    const ref = `lower_${i}`;
    const cabHeight = designData.cabinets.lower_height_mm - designData.cabinets.leg_height_mm;
    const cabDepth = designData.layout.depth_mm;

    items.push(...buildCabinetParts(nextId, rules, cab, ref, cabHeight, cabDepth, doorMaterial, bodyMaterial, backMaterial, 'lower'));
  }

  // ─── 상부장 캐비닛 ───
  for (let i = 0; i < designData.cabinets.upper.length; i++) {
    const cab = designData.cabinets.upper[i];
    const ref = `upper_${i}`;
    const cabHeight = designData.cabinets.upper_height_mm;
    const cabDepth = Math.round(designData.layout.depth_mm * rules.upper_cabinet.depth_ratio);

    items.push(...buildCabinetParts(nextId, rules, cab, ref, cabHeight, cabDepth, doorMaterial, bodyMaterial, backMaterial, 'upper'));
  }

  // ─── 카운터탑 ───
  if (designData.cabinets.lower.length > 0) {
    items.push({
      id: nextId(),
      part_category: 'countertop',
      name: '카운터탑',
      material: designData.materials.countertop,
      width_mm: designData.layout.total_width_mm,
      height_mm: rules.materials.countertop.thickness,
      depth_mm: designData.layout.depth_mm,
      quantity: 1,
      unit: 'ea',
    });
  }

  // ─── 설비 ───
  items.push(...buildEquipmentItems(nextId, designData));

  // ─── 부자재 ───
  items.push(...buildAccessoryItems(nextId, designData));

  // ─── 마감재 (엣지밴딩) ───
  items.push(...buildFinishItems(nextId, rules, designData, doorMaterial));

  const summary = buildSummary(items, rules);

  const result: BomResult = {
    category: designData.category,
    style: designData.style,
    items,
    summary,
    generated_at: new Date().toISOString(),
  };

  log.info({
    category: designData.category,
    totalItems: items.length,
    totalPanels: summary.total_panels,
    sheetEstimate: summary.sheet_estimate,
  }, 'BOM generated');

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Internal: 캐비닛 부품 생성 (Rules.txt 규칙 기반)
// ─────────────────────────────────────────────────────────────────

function buildCabinetParts(
  nextId: () => string,
  rules: BomRules,
  cab: CabinetUnit,
  ref: string,
  cabHeight: number,
  cabDepth: number,
  doorMaterial: string,
  bodyMaterial: string,
  backMaterial: string,
  position: 'upper' | 'lower',
): BomItem[] {
  const items: BomItem[] = [];
  const label = position === 'upper' ? '상부장' : '하부장';
  const idx = ref.split('_')[1];
  const bodyT = rules.materials.body.thickness;
  const doorT = rules.materials.door.thickness;
  const backT = rules.materials.back_panel.thickness;
  const gap = rules.construction.door_gap;
  const clearance = rules.construction.back_panel_clearance;

  // ── 1. 도어 패널 (18T MDF) ──
  if (cab.is_drawer) {
    const drawerHeight = Math.round(cabHeight / cab.door_count);
    for (let d = 0; d < cab.door_count; d++) {
      items.push({
        id: nextId(),
        part_category: 'panel',
        name: `${label}${idx} 서랍전면${d + 1}`,
        material: doorMaterial,
        width_mm: cab.width_mm - gap,
        height_mm: drawerHeight - gap,
        depth_mm: doorT,
        quantity: 1,
        unit: 'ea',
        cabinet_ref: ref,
      });
    }
  } else {
    const doorWidth = Math.round((cab.width_mm - gap) / Math.max(1, cab.door_count));
    for (let d = 0; d < cab.door_count; d++) {
      items.push({
        id: nextId(),
        part_category: 'panel',
        name: `${label}${idx} 도어${cab.door_count > 1 ? d + 1 : ''}`,
        material: doorMaterial,
        width_mm: doorWidth,
        height_mm: cabHeight - gap,
        depth_mm: doorT,
        quantity: 1,
        unit: 'ea',
        cabinet_ref: ref,
      });
    }
  }

  // ── 2. 측판: Width=깊이, Height=높이 (본체 PB) ──
  items.push({
    id: nextId(),
    part_category: 'board',
    name: `${label}${idx} 측판`,
    material: bodyMaterial,
    width_mm: cabDepth,
    height_mm: cabHeight,
    depth_mm: bodyT,
    quantity: rules.construction.side_panel_qty,
    unit: 'ea',
    cabinet_ref: ref,
  });

  // ── 3. 하판: Width=너비-(본체두께×2), Height=깊이 ──
  const innerWidth = cab.width_mm - (bodyT * 2);
  if (position === 'lower') {
    // 하부장: 하판만 1장 (카운터탑이 상판 역할)
    items.push({
      id: nextId(),
      part_category: 'board',
      name: `${label}${idx} 하판`,
      material: bodyMaterial,
      width_mm: innerWidth,
      height_mm: cabDepth,
      depth_mm: bodyT,
      quantity: rules.construction.bottom_panel_qty,
      unit: 'ea',
      cabinet_ref: ref,
    });
  } else {
    // 상부장: 상판 + 하판
    const topQty = rules.upper_cabinet.top_panel ? 2 : 1;
    items.push({
      id: nextId(),
      part_category: 'board',
      name: `${label}${idx} ${topQty === 2 ? '상하판' : '하판'}`,
      material: bodyMaterial,
      width_mm: innerWidth,
      height_mm: cabDepth,
      depth_mm: bodyT,
      quantity: topQty,
      unit: 'ea',
      cabinet_ref: ref,
    });
  }

  // ── 4. 밴드: Width=60, Height=너비-(본체두께×2) ──
  items.push({
    id: nextId(),
    part_category: 'board',
    name: `${label}${idx} 밴드`,
    material: bodyMaterial,
    width_mm: rules.construction.band_width,
    height_mm: innerWidth,
    depth_mm: bodyT,
    quantity: rules.construction.band_qty,
    unit: 'ea',
    cabinet_ref: ref,
  });

  // ── 5. 뒷판: Width=너비-1, Height=높이-1 (2.7T MDF) ──
  items.push({
    id: nextId(),
    part_category: 'board',
    name: `${label}${idx} 뒷판`,
    material: backMaterial,
    width_mm: cab.width_mm - clearance,
    height_mm: cabHeight - clearance,
    depth_mm: backT,
    quantity: rules.construction.back_panel_qty,
    unit: 'ea',
    cabinet_ref: ref,
  });

  // ── 6. 선반 (서랍/냉장고 제외) ──
  if (!cab.is_drawer && cab.type !== 'fridge') {
    items.push({
      id: nextId(),
      part_category: 'board',
      name: `${label}${idx} 선반`,
      material: bodyMaterial,
      width_mm: innerWidth,
      height_mm: cabDepth - rules.construction.shelf_depth_reduction,
      depth_mm: bodyT,
      quantity: 1,
      unit: 'ea',
      cabinet_ref: ref,
    });
  }

  // ── 7. 하드웨어 ──
  if (cab.is_drawer) {
    items.push({
      id: nextId(),
      part_category: 'hardware',
      name: `${label}${idx} 서랍레일`,
      material: rules.hardware.slide_type,
      width_mm: cabDepth,
      height_mm: 0,
      depth_mm: 0,
      quantity: cab.door_count,
      unit: 'set',
      cabinet_ref: ref,
    });
  } else if (cab.door_count > 0) {
    items.push({
      id: nextId(),
      part_category: 'hardware',
      name: `${label}${idx} 경첩`,
      material: rules.hardware.hinge_type,
      width_mm: 0,
      height_mm: 0,
      depth_mm: 0,
      quantity: cab.door_count * rules.hardware.hinges_per_door,
      unit: 'ea',
      cabinet_ref: ref,
    });
  }

  // ── 8. 핸들 ──
  if (cab.door_count > 0) {
    items.push({
      id: nextId(),
      part_category: 'hardware',
      name: `${label}${idx} 핸들`,
      material: 'handle',
      width_mm: 0,
      height_mm: 0,
      depth_mm: 0,
      quantity: cab.door_count,
      unit: 'ea',
      cabinet_ref: ref,
    });
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────
// Internal: 설비 아이템
// ─────────────────────────────────────────────────────────────────

function buildEquipmentItems(
  nextId: () => string,
  data: StructuredDesignData,
): BomItem[] {
  const items: BomItem[] = [];

  if (data.equipment.sink) {
    items.push({
      id: nextId(),
      part_category: 'equipment',
      name: '싱크볼',
      material: data.equipment.sink.type,
      width_mm: data.equipment.sink.width_mm,
      height_mm: 200,
      depth_mm: 450,
      quantity: 1,
      unit: 'ea',
    });
  }

  if (data.equipment.faucet) {
    items.push({
      id: nextId(),
      part_category: 'equipment',
      name: '수전',
      material: data.equipment.faucet.type,
      width_mm: 0,
      height_mm: 0,
      depth_mm: 0,
      quantity: 1,
      unit: 'ea',
    });
  }

  if (data.equipment.cooktop) {
    items.push({
      id: nextId(),
      part_category: 'equipment',
      name: '쿡탑',
      material: data.equipment.cooktop.type,
      width_mm: data.equipment.cooktop.width_mm,
      height_mm: 60,
      depth_mm: 520,
      quantity: 1,
      unit: 'ea',
    });
  }

  if (data.equipment.hood) {
    items.push({
      id: nextId(),
      part_category: 'equipment',
      name: '레인지후드',
      material: data.equipment.hood.type,
      width_mm: data.equipment.hood.width_mm,
      height_mm: 300,
      depth_mm: 350,
      quantity: 1,
      unit: 'ea',
    });
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────
// Internal: 부자재 (몰딩, 다리, 필러)
// ─────────────────────────────────────────────────────────────────

function buildAccessoryItems(
  nextId: () => string,
  data: StructuredDesignData,
): BomItem[] {
  const items: BomItem[] = [];
  const totalWidth = data.layout.total_width_mm;

  if (data.cabinets.leg_height_mm > 0 && data.cabinets.lower.length > 0) {
    items.push({
      id: nextId(),
      part_category: 'accessory',
      name: '걸레받이',
      material: 'PVC',
      width_mm: totalWidth,
      height_mm: data.cabinets.leg_height_mm,
      depth_mm: 0,
      quantity: 1,
      unit: 'ea',
    });
  }

  if (data.cabinets.molding_height_mm > 0 && data.cabinets.upper.length > 0) {
    items.push({
      id: nextId(),
      part_category: 'accessory',
      name: '상부 몰딩',
      material: 'crown molding',
      width_mm: totalWidth,
      height_mm: data.cabinets.molding_height_mm,
      depth_mm: 0,
      quantity: 1,
      unit: 'ea',
    });
  }

  if (data.cabinets.lower.length > 0) {
    const legCount = (data.cabinets.lower.length + 1) * 2;
    items.push({
      id: nextId(),
      part_category: 'accessory',
      name: '조절 다리',
      material: 'plastic adjustable',
      width_mm: 0,
      height_mm: data.cabinets.leg_height_mm,
      depth_mm: 0,
      quantity: legCount,
      unit: 'ea',
    });
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────
// Internal: 마감재 (엣지밴딩)
// ─────────────────────────────────────────────────────────────────

function buildFinishItems(
  nextId: () => string,
  rules: BomRules,
  data: StructuredDesignData,
  doorMaterial: string,
): BomItem[] {
  const items: BomItem[] = [];

  let totalEdgeLength = 0;
  for (const cab of [...data.cabinets.lower, ...data.cabinets.upper]) {
    const perimeter = (cab.width_mm + 720) * 2;
    totalEdgeLength += perimeter * cab.door_count;
  }

  if (totalEdgeLength > 0) {
    items.push({
      id: nextId(),
      part_category: 'finish',
      name: '엣지밴딩',
      material: doorMaterial,
      width_mm: totalEdgeLength,
      height_mm: rules.materials.edge_band.thickness,
      depth_mm: 0,
      quantity: 1,
      unit: 'mm',
    });
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────
// Internal: 요약 + 원판 사용량 계산
// ─────────────────────────────────────────────────────────────────

function buildSummary(items: BomItem[], rules: BomRules): BomSummary {
  const categories: Record<BomPartCategory, number> = {
    panel: 0,
    board: 0,
    hardware: 0,
    countertop: 0,
    equipment: 0,
    accessory: 0,
    finish: 0,
  };

  for (const item of items) {
    categories[item.part_category] += item.quantity;
  }

  // 원판(1220×2440) 사용량 추정
  const sheetArea = rules.materials.sheet_size.width * rules.materials.sheet_size.height;
  let totalPanelArea = 0;

  for (const item of items) {
    if (item.part_category === 'panel' || item.part_category === 'board') {
      totalPanelArea += item.width_mm * item.height_mm * item.quantity;
    }
  }

  // 로스율 15% 적용
  const sheetEstimate = Math.ceil((totalPanelArea * 1.15) / sheetArea);

  return {
    total_items: items.length,
    total_panels: categories.panel,
    total_hardware: categories.hardware + categories.accessory,
    total_equipment: categories.equipment,
    categories,
    sheet_estimate: sheetEstimate,
  };
}
