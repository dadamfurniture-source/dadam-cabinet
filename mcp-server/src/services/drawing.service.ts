// ═══════════════════════════════════════════════════════════════
// Drawing Service - StructuredDesignData → 2D Drawing Coordinates
// 공통 기반 도면 + 제작/설치 서브 레이아웃 좌표 생성
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { getBomRules } from '../config/bom-rules.loader.js';
import { generateBom } from './bom.service.js';
import type {
  StructuredDesignData,
  CabinetUnit,
  BomResult,
  DrawingData,
  FrontView,
  SideView,
  PlanView,
  ManufacturingLayout,
  InstallationLayout,
  Rect,
  Point,
  DimensionLine,
  CabinetRect,
  DoorRect,
  HardwarePoint,
  PanelRect,
  PanelDetail,
  Line,
  UtilityMark,
  EquipmentZone,
} from '../types/index.js';

const log = createLogger('drawing');

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const UPPER_LOWER_GAP = 600;    // 하부장~상부장 간격 (mm)
const HINGE_OFFSET = 100;       // 경첩: 도어 상/하단에서 100mm
const COUNTERTOP_THICKNESS = 30;
const UPPER_DEPTH_RATIO = 0.55; // 상부장 깊이 비율

// ─────────────────────────────────────────────────────────────────
// Main Entry
// ─────────────────────────────────────────────────────────────────

export interface DrawingOptions {
  include_views?: boolean;
  include_manufacturing?: boolean;
  include_installation?: boolean;
}

export function generateDrawingData(
  designData: StructuredDesignData,
  bomResult?: BomResult,
  options?: DrawingOptions,
): DrawingData {
  const rules = getBomRules();
  const doorGap = rules.construction.door_gap;
  const bodyT = rules.materials.body.thickness;
  const backT = rules.materials.back_panel.thickness;
  const countertopT = rules.materials.countertop.thickness;

  const bom = bomResult ?? generateBom(designData);

  const opts: Required<DrawingOptions> = {
    include_views: options?.include_views ?? true,
    include_manufacturing: options?.include_manufacturing ?? true,
    include_installation: options?.include_installation ?? true,
  };

  const frontView = buildFrontView(designData, doorGap, countertopT);
  const sideView = buildSideView(designData, bodyT, backT, countertopT);
  const planView = buildPlanView(designData, countertopT);
  const manufacturing = opts.include_manufacturing
    ? buildManufacturingLayout(designData, bom, doorGap, bodyT)
    : { panel_details: [], edge_banding_marks: [], bom_references: [] };
  const installation = opts.include_installation
    ? buildInstallationLayout(designData, countertopT)
    : { wall: { x: 0, y: 0, width: 0, height: 0 }, utilities: [], equipment: [], clearance_zones: [] };

  const result: DrawingData = {
    common: { front_view: frontView, side_view: sideView, plan_view: planView },
    manufacturing,
    installation,
    metadata: {
      category: designData.category,
      style: designData.style,
      generated_at: new Date().toISOString(),
    },
  };

  log.info({
    category: designData.category,
    cabinets: designData.cabinets.lower.length + designData.cabinets.upper.length,
    doors: frontView.doors.length,
    panels: manufacturing.panel_details.length,
  }, 'Drawing data generated');

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Front View - 정면도
// ─────────────────────────────────────────────────────────────────

function buildFrontView(
  data: StructuredDesignData,
  doorGap: number,
  countertopT: number,
): FrontView {
  const cabinets: CabinetRect[] = [];
  const doors: DoorRect[] = [];
  const hardware: HardwarePoint[] = [];
  const dimensions: DimensionLine[] = [];

  const legH = data.cabinets.leg_height_mm;
  const lowerH = data.cabinets.lower_height_mm;
  const upperH = data.cabinets.upper_height_mm;
  const lowerBodyH = lowerH - legH;
  const countertopY = lowerH;
  const upperStartY = lowerH + UPPER_LOWER_GAP;

  // 하부장 캐비닛
  for (let i = 0; i < data.cabinets.lower.length; i++) {
    const cab = data.cabinets.lower[i];
    const ref = `lower_${i}`;

    cabinets.push({
      x: cab.position_mm,
      y: legH,
      width: cab.width_mm,
      height: lowerBodyH,
      ref,
      type: cab.type,
    });

    buildDoorRects(doors, hardware, cab, ref, cab.position_mm, legH, lowerBodyH, doorGap);
  }

  // 상부장 캐비닛
  for (let i = 0; i < data.cabinets.upper.length; i++) {
    const cab = data.cabinets.upper[i];
    const ref = `upper_${i}`;

    cabinets.push({
      x: cab.position_mm,
      y: upperStartY,
      width: cab.width_mm,
      height: upperH,
      ref,
      type: cab.type,
    });

    buildDoorRects(doors, hardware, cab, ref, cab.position_mm, upperStartY, upperH, doorGap);
  }

  // 카운터탑
  let countertop: Rect | undefined;
  if (data.cabinets.lower.length > 0) {
    countertop = {
      x: 0,
      y: countertopY,
      width: data.layout.total_width_mm,
      height: countertopT,
    };
  }

  // 몰딩
  let molding: Rect | undefined;
  if (data.cabinets.molding_height_mm > 0 && data.cabinets.upper.length > 0) {
    molding = {
      x: 0,
      y: upperStartY + upperH,
      width: data.layout.total_width_mm,
      height: data.cabinets.molding_height_mm,
    };
  }

  // 걸레받이
  let baseboard: Rect | undefined;
  if (legH > 0 && data.cabinets.lower.length > 0) {
    baseboard = {
      x: 0,
      y: 0,
      width: data.layout.total_width_mm,
      height: legH,
    };
  }

  // 치수선
  // 전체 너비
  dimensions.push({
    start: { x: 0, y: -50 },
    end: { x: data.layout.total_width_mm, y: -50 },
    value: data.layout.total_width_mm,
    unit: 'mm',
    label: '전체 너비',
  });

  // 각 캐비닛 너비
  for (const cab of data.cabinets.lower) {
    dimensions.push({
      start: { x: cab.position_mm, y: legH - 30 },
      end: { x: cab.position_mm + cab.width_mm, y: legH - 30 },
      value: cab.width_mm,
      unit: 'mm',
    });
  }

  // 높이 치수
  if (data.cabinets.lower.length > 0) {
    const rightEdge = data.layout.total_width_mm + 50;
    dimensions.push({
      start: { x: rightEdge, y: 0 },
      end: { x: rightEdge, y: lowerH },
      value: lowerH,
      unit: 'mm',
      label: '하부장 높이',
    });
  }

  if (data.cabinets.upper.length > 0) {
    const rightEdge = data.layout.total_width_mm + 50;
    dimensions.push({
      start: { x: rightEdge, y: upperStartY },
      end: { x: rightEdge, y: upperStartY + upperH },
      value: upperH,
      unit: 'mm',
      label: '상부장 높이',
    });
  }

  return { cabinets, doors, hardware, countertop, molding, baseboard, dimensions };
}

function buildDoorRects(
  doors: DoorRect[],
  hardware: HardwarePoint[],
  cab: CabinetUnit,
  ref: string,
  cabX: number,
  cabY: number,
  cabHeight: number,
  doorGap: number,
): void {
  if (cab.door_count <= 0) return;

  if (cab.is_drawer) {
    // 서랍: 수평 분할
    const drawerHeight = Math.round(cabHeight / cab.door_count);
    for (let d = 0; d < cab.door_count; d++) {
      const doorY = cabY + d * drawerHeight;
      doors.push({
        x: cabX + doorGap / 2,
        y: doorY + doorGap / 2,
        width: cab.width_mm - doorGap,
        height: drawerHeight - doorGap,
        ref,
        door_index: d,
        is_drawer: true,
      });

      // 핸들: 서랍 중앙
      hardware.push({
        x: cabX + cab.width_mm / 2,
        y: doorY + drawerHeight / 2,
        type: 'handle',
        ref,
      });

      // 서랍레일
      hardware.push({
        x: cabX + cab.width_mm / 2,
        y: doorY + drawerHeight / 2,
        type: 'rail',
        ref,
      });
    }
  } else {
    // 일반 도어: 수직 분할
    const doorWidth = Math.round((cab.width_mm - doorGap) / Math.max(1, cab.door_count));
    for (let d = 0; d < cab.door_count; d++) {
      const doorX = cabX + d * doorWidth + doorGap / 2;
      doors.push({
        x: doorX,
        y: cabY + doorGap / 2,
        width: doorWidth,
        height: cabHeight - doorGap,
        ref,
        door_index: d,
        is_drawer: false,
      });

      // 경첩: 도어 상/하단에서 100mm
      hardware.push({
        x: doorX,
        y: cabY + HINGE_OFFSET,
        type: 'hinge',
        ref,
      });
      hardware.push({
        x: doorX,
        y: cabY + cabHeight - HINGE_OFFSET,
        type: 'hinge',
        ref,
      });

      // 핸들: 도어 높이 중앙
      hardware.push({
        x: doorX + doorWidth / 2,
        y: cabY + cabHeight / 2,
        type: 'handle',
        ref,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Side View - 단면도 (대표 하부장 1개 기준)
// ─────────────────────────────────────────────────────────────────

function buildSideView(
  data: StructuredDesignData,
  bodyT: number,
  backT: number,
  countertopT: number,
): SideView {
  const depth = data.layout.depth_mm;
  const legH = data.cabinets.leg_height_mm;
  const lowerH = data.cabinets.lower_height_mm;
  const lowerBodyH = lowerH - legH;
  const panels: PanelRect[] = [];
  const dimensions: DimensionLine[] = [];

  const outer: Rect = { x: 0, y: legH, width: depth, height: lowerBodyH };

  // 좌측 측판
  panels.push({
    x: 0, y: legH,
    width: bodyT, height: lowerBodyH,
    name: '좌측판', thickness: bodyT, material: 'PB',
  });

  // 우측 측판
  panels.push({
    x: depth - bodyT, y: legH,
    width: bodyT, height: lowerBodyH,
    name: '우측판', thickness: bodyT, material: 'PB',
  });

  // 하판
  panels.push({
    x: bodyT, y: legH,
    width: depth - bodyT * 2, height: bodyT,
    name: '하판', thickness: bodyT, material: 'PB',
  });

  // 뒷판
  panels.push({
    x: depth - backT, y: legH,
    width: backT, height: lowerBodyH,
    name: '뒷판', thickness: backT, material: 'MDF',
  });

  // 선반 (중간 높이)
  const shelfY = legH + Math.round(lowerBodyH / 2);
  panels.push({
    x: bodyT, y: shelfY,
    width: depth - bodyT * 2 - 20, height: bodyT,
    name: '선반', thickness: bodyT, material: 'PB',
  });

  // 카운터탑
  let countertop: Rect | undefined;
  if (data.cabinets.lower.length > 0) {
    countertop = { x: 0, y: lowerH, width: depth, height: countertopT };
  }

  // 치수선
  dimensions.push({
    start: { x: 0, y: legH - 30 },
    end: { x: depth, y: legH - 30 },
    value: depth,
    unit: 'mm',
    label: '깊이',
  });

  dimensions.push({
    start: { x: -30, y: legH },
    end: { x: -30, y: lowerH },
    value: lowerBodyH,
    unit: 'mm',
    label: '본체 높이',
  });

  // 측판 두께 치수
  dimensions.push({
    start: { x: 0, y: legH + lowerBodyH + 20 },
    end: { x: bodyT, y: legH + lowerBodyH + 20 },
    value: bodyT,
    unit: 'mm',
    label: '측판 두께',
  });

  // 뒷판 두께 치수
  dimensions.push({
    start: { x: depth - backT, y: legH + lowerBodyH + 20 },
    end: { x: depth, y: legH + lowerBodyH + 20 },
    value: backT,
    unit: 'mm',
    label: '뒷판 두께',
  });

  return { outer, panels, countertop, dimensions };
}

// ─────────────────────────────────────────────────────────────────
// Plan View - 평면도
// ─────────────────────────────────────────────────────────────────

function buildPlanView(
  data: StructuredDesignData,
  countertopT: number,
): PlanView {
  const depth = data.layout.depth_mm;
  const upperDepth = Math.round(depth * UPPER_DEPTH_RATIO);
  const lower_cabinets: Rect[] = [];
  const upper_cabinets: Rect[] = [];
  const dimensions: DimensionLine[] = [];

  // 하부장 평면
  for (const cab of data.cabinets.lower) {
    lower_cabinets.push({
      x: cab.position_mm,
      y: 0,
      width: cab.width_mm,
      height: depth,
    });
  }

  // 상부장 평면
  for (const cab of data.cabinets.upper) {
    upper_cabinets.push({
      x: cab.position_mm,
      y: 0,
      width: cab.width_mm,
      height: upperDepth,
    });
  }

  // 카운터탑 평면
  let countertop: Rect | undefined;
  if (data.cabinets.lower.length > 0) {
    countertop = {
      x: 0,
      y: 0,
      width: data.layout.total_width_mm,
      height: depth,
    };
  }

  // 치수선
  dimensions.push({
    start: { x: 0, y: -30 },
    end: { x: data.layout.total_width_mm, y: -30 },
    value: data.layout.total_width_mm,
    unit: 'mm',
    label: '전체 너비',
  });

  if (data.cabinets.lower.length > 0) {
    dimensions.push({
      start: { x: -30, y: 0 },
      end: { x: -30, y: depth },
      value: depth,
      unit: 'mm',
      label: '하부장 깊이',
    });
  }

  if (data.cabinets.upper.length > 0) {
    dimensions.push({
      start: { x: data.layout.total_width_mm + 30, y: 0 },
      end: { x: data.layout.total_width_mm + 30, y: upperDepth },
      value: upperDepth,
      unit: 'mm',
      label: '상부장 깊이',
    });
  }

  return { lower_cabinets, upper_cabinets, countertop, dimensions };
}

// ─────────────────────────────────────────────────────────────────
// Manufacturing Layout - 제작 도면 서브 레이아웃
// ─────────────────────────────────────────────────────────────────

function buildManufacturingLayout(
  data: StructuredDesignData,
  bom: BomResult,
  doorGap: number,
  bodyT: number,
): ManufacturingLayout {
  const panel_details: PanelDetail[] = [];
  const edge_banding_marks: Line[] = [];
  const bom_references: { rect_ref: string; bom_id: string }[] = [];

  // BOM의 panel + board 아이템을 개별 도면으로
  for (const item of bom.items) {
    if (item.part_category !== 'panel' && item.part_category !== 'board') continue;

    const detail: PanelDetail = {
      bom_id: item.id,
      name: item.name,
      material: item.material,
      rect: { x: 0, y: 0, width: item.width_mm, height: item.height_mm },
      dimensions: [
        {
          start: { x: 0, y: -20 },
          end: { x: item.width_mm, y: -20 },
          value: item.width_mm,
          unit: 'mm',
          label: '너비',
        },
        {
          start: { x: -20, y: 0 },
          end: { x: -20, y: item.height_mm },
          value: item.height_mm,
          unit: 'mm',
          label: '높이',
        },
      ],
    };

    panel_details.push(detail);

    // BOM 참조 매핑
    if (item.cabinet_ref) {
      bom_references.push({ rect_ref: item.cabinet_ref, bom_id: item.id });
    }

    // 엣지밴딩 마크 (도어 패널만 - 4면)
    if (item.part_category === 'panel') {
      const w = item.width_mm;
      const h = item.height_mm;
      // 상변
      edge_banding_marks.push({ x1: 0, y1: h, x2: w, y2: h });
      // 하변
      edge_banding_marks.push({ x1: 0, y1: 0, x2: w, y2: 0 });
      // 좌변
      edge_banding_marks.push({ x1: 0, y1: 0, x2: 0, y2: h });
      // 우변
      edge_banding_marks.push({ x1: w, y1: 0, x2: w, y2: h });
    }
  }

  return { panel_details, edge_banding_marks, bom_references };
}

// ─────────────────────────────────────────────────────────────────
// Installation Layout - 설치 도면 서브 레이아웃
// ─────────────────────────────────────────────────────────────────

function buildInstallationLayout(
  data: StructuredDesignData,
  countertopT: number,
): InstallationLayout {
  const wallW = data.wall.width_mm;
  const wallH = data.wall.height_mm;

  const wall: Rect = { x: 0, y: 0, width: wallW, height: wallH };

  // 타일 그리드
  let tile_grid: InstallationLayout['tile_grid'];
  if (data.wall.tile_type && data.wall.tile_type !== 'unknown') {
    // 기본 타일 크기 추정 (정보 없으면 기본값)
    const tileW = 300;
    const tileH = 600;
    tile_grid = {
      origin: { x: 0, y: 0 },
      tile_w: tileW,
      tile_h: tileH,
      cols: Math.ceil(wallW / tileW),
      rows: Math.ceil(wallH / tileH),
    };
  }

  // 배관 위치 마커
  const utilities: UtilityMark[] = [];

  if (data.utilities.water_supply.detected) {
    utilities.push({
      x: data.utilities.water_supply.position_mm,
      y: 500,  // 바닥에서 500mm (일반적 급수 높이)
      type: 'water',
      label: '급수',
    });
  }

  if (data.utilities.exhaust_duct.detected) {
    utilities.push({
      x: data.utilities.exhaust_duct.position_mm,
      y: wallH - 200,  // 천장 근처
      type: 'exhaust',
      label: '배기구',
    });
  }

  if (data.utilities.gas_pipe.detected) {
    utilities.push({
      x: data.utilities.gas_pipe.position_mm,
      y: 400,  // 바닥에서 400mm
      type: 'gas',
      label: '가스',
    });
  }

  // 설비 설치 구역
  const equipment: EquipmentZone[] = [];
  const lowerH = data.cabinets.lower_height_mm;
  const legH = data.cabinets.leg_height_mm;

  if (data.equipment.sink) {
    const sink = data.equipment.sink;
    equipment.push({
      x: sink.position_mm - sink.width_mm / 2,
      y: lowerH - 200,
      width: sink.width_mm,
      height: 200,
      type: 'sink',
      label: '싱크볼',
    });
  }

  if (data.equipment.cooktop) {
    const cooktop = data.equipment.cooktop;
    equipment.push({
      x: cooktop.position_mm - cooktop.width_mm / 2,
      y: lowerH,
      width: cooktop.width_mm,
      height: 60,
      type: 'cooktop',
      label: '쿡탑',
    });
  }

  if (data.equipment.hood) {
    const hood = data.equipment.hood;
    const upperStartY = lowerH + UPPER_LOWER_GAP;
    equipment.push({
      x: hood.position_mm - hood.width_mm / 2,
      y: upperStartY - 300,
      width: hood.width_mm,
      height: 300,
      type: 'hood',
      label: '레인지후드',
    });
  }

  // 여유 공간 (도어 열림 반경)
  const clearance_zones: Rect[] = [];
  const doorOpenDepth = data.layout.depth_mm;
  if (data.cabinets.lower.length > 0) {
    clearance_zones.push({
      x: 0,
      y: legH,
      width: data.layout.total_width_mm,
      height: doorOpenDepth,
    });
  }

  return { wall, tile_grid, utilities, equipment, clearance_zones };
}
