// ═══════════════════════════════════════════════════════════════
// SVG Renderer Service - DrawingData → SVG 문자열 변환
// 각 뷰(정면/단면/평면/제작/설치)를 개별 SVG로 렌더링
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import type {
  DrawingData,
  FrontView,
  SideView,
  PlanView,
  ManufacturingLayout,
  InstallationLayout,
  Rect,
  DimensionLine,
  HardwarePoint,
  PanelRect,
  UtilityMark,
  EquipmentZone,
  PanelDetail,
  Line,
} from '../types/index.js';

const log = createLogger('svg-renderer');

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const PADDING = 120;         // SVG 여백 (치수선 공간)
const SCALE = 0.5;           // mm → SVG px 기본 스케일
const FONT_SIZE = 11;
const DIM_FONT_SIZE = 9;
const ARROW_SIZE = 6;

// 색상 팔레트
const COLORS = {
  cabinet: '#E0E0E0',
  cabinet_stroke: '#333',
  door: '#F5F5F5',
  door_stroke: '#666',
  drawer: '#EFEFEF',
  countertop: '#B0BEC5',
  molding: '#8D6E63',
  baseboard: '#9E9E9E',
  hinge: '#FF5722',
  handle: '#2196F3',
  rail: '#4CAF50',
  panel_pb: '#D7CCC8',
  panel_mdf: '#BCAAA4',
  shelf: '#EFEBE9',
  dimension: '#E53935',
  dim_text: '#B71C1C',
  wall: '#FAFAFA',
  wall_stroke: '#424242',
  tile_grid: '#E0E0E0',
  water: '#2196F3',
  exhaust: '#78909C',
  gas: '#FF9800',
  outlet: '#FFC107',
  equipment: '#CE93D8',
  equipment_stroke: '#7B1FA2',
  clearance: '#A5D6A7',
  edge_band: '#F44336',
  upper_dash: '#90CAF9',
  title: '#212121',
};

// ─────────────────────────────────────────────────────────────────
// Output Type
// ─────────────────────────────────────────────────────────────────

export interface SvgOutput {
  front_view: string;
  side_view: string;
  plan_view: string;
  manufacturing: string;
  installation: string;
}

export interface SvgRenderOptions {
  scale?: number;
  views?: ('front' | 'side' | 'plan' | 'manufacturing' | 'installation')[];
}

// ─────────────────────────────────────────────────────────────────
// Main Entry
// ─────────────────────────────────────────────────────────────────

export function renderDrawingToSvg(
  drawing: DrawingData,
  options?: SvgRenderOptions,
): SvgOutput {
  const scale = options?.scale ?? SCALE;
  const views = options?.views ?? ['front', 'side', 'plan', 'manufacturing', 'installation'];

  const result: SvgOutput = {
    front_view: views.includes('front') ? renderFrontView(drawing.common.front_view, scale) : '',
    side_view: views.includes('side') ? renderSideView(drawing.common.side_view, scale) : '',
    plan_view: views.includes('plan') ? renderPlanView(drawing.common.plan_view, scale) : '',
    manufacturing: views.includes('manufacturing') ? renderManufacturing(drawing.manufacturing, scale) : '',
    installation: views.includes('installation') ? renderInstallation(drawing.installation, scale) : '',
  };

  log.info({
    category: drawing.metadata.category,
    renderedViews: views.length,
  }, 'SVG rendered');

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Front View SVG
// ─────────────────────────────────────────────────────────────────

function renderFrontView(view: FrontView, scale: number): string {
  const allRects = [
    ...view.cabinets,
    ...view.doors,
    ...(view.countertop ? [view.countertop] : []),
    ...(view.molding ? [view.molding] : []),
    ...(view.baseboard ? [view.baseboard] : []),
  ];
  const bounds = computeBounds(allRects, view.dimensions);
  const { width, height, offsetX, offsetY } = svgDimensions(bounds, scale);

  const parts: string[] = [];

  // 걸레받이
  if (view.baseboard) {
    parts.push(svgRect(view.baseboard, scale, offsetX, offsetY, height, COLORS.baseboard, COLORS.cabinet_stroke, 1));
  }

  // 캐비닛 외곽
  for (const cab of view.cabinets) {
    parts.push(svgRect(cab, scale, offsetX, offsetY, height, COLORS.cabinet, COLORS.cabinet_stroke, 1.5));
  }

  // 도어/서랍
  for (const door of view.doors) {
    const fill = door.is_drawer ? COLORS.drawer : COLORS.door;
    parts.push(svgRect(door, scale, offsetX, offsetY, height, fill, COLORS.door_stroke, 1));
  }

  // 카운터탑
  if (view.countertop) {
    parts.push(svgRect(view.countertop, scale, offsetX, offsetY, height, COLORS.countertop, COLORS.cabinet_stroke, 1.5));
  }

  // 몰딩
  if (view.molding) {
    parts.push(svgRect(view.molding, scale, offsetX, offsetY, height, COLORS.molding, COLORS.cabinet_stroke, 1));
  }

  // 하드웨어
  for (const hw of view.hardware) {
    parts.push(svgHardware(hw, scale, offsetX, offsetY, height));
  }

  // 치수선
  for (const dim of view.dimensions) {
    parts.push(svgDimension(dim, scale, offsetX, offsetY, height));
  }

  return wrapSvg(width, height, '정면도 (Front View)', parts);
}

// ─────────────────────────────────────────────────────────────────
// Side View SVG
// ─────────────────────────────────────────────────────────────────

function renderSideView(view: SideView, scale: number): string {
  const allRects = [view.outer, ...view.panels, ...(view.countertop ? [view.countertop] : [])];
  const bounds = computeBounds(allRects, view.dimensions);
  const { width, height, offsetX, offsetY } = svgDimensions(bounds, scale);

  const parts: string[] = [];

  // 외곽
  parts.push(svgRect(view.outer, scale, offsetX, offsetY, height, 'none', COLORS.cabinet_stroke, 1.5));

  // 패널
  for (const panel of view.panels) {
    const fill = panel.material === 'MDF' ? COLORS.panel_mdf : COLORS.panel_pb;
    parts.push(svgRect(panel, scale, offsetX, offsetY, height, fill, COLORS.cabinet_stroke, 1));
    // 패널 라벨
    const cx = (panel.x + panel.width / 2) * scale + offsetX;
    const cy = height - (panel.y + panel.height / 2) * scale + offsetY;
    // 패널이 충분히 크면 내부에, 작으면 옆에 라벨 표시
    if (panel.width * scale > 30 && panel.height * scale > 15) {
      parts.push(`<text x="${r(cx)}" y="${r(cy)}" font-size="${DIM_FONT_SIZE}" fill="${COLORS.title}" text-anchor="middle" dominant-baseline="middle">${escXml(panel.name)}</text>`);
    } else {
      // 얇은 패널: 오른쪽에 라벨 표시
      const lx = (panel.x + panel.width) * scale + offsetX + 4;
      const ly = height - (panel.y + panel.height / 2) * scale + offsetY;
      parts.push(`<text x="${r(lx)}" y="${r(ly)}" font-size="${DIM_FONT_SIZE - 1}" fill="${COLORS.title}" dominant-baseline="middle" opacity="0.7">${escXml(panel.name)}</text>`);
    }
  }

  // 카운터탑
  if (view.countertop) {
    parts.push(svgRect(view.countertop, scale, offsetX, offsetY, height, COLORS.countertop, COLORS.cabinet_stroke, 1.5));
  }

  // 치수선
  for (const dim of view.dimensions) {
    parts.push(svgDimension(dim, scale, offsetX, offsetY, height));
  }

  return wrapSvg(width, height, '단면도 (Side View)', parts);
}

// ─────────────────────────────────────────────────────────────────
// Plan View SVG
// ─────────────────────────────────────────────────────────────────

function renderPlanView(view: PlanView, scale: number): string {
  const allRects = [
    ...view.lower_cabinets,
    ...view.upper_cabinets,
    ...(view.countertop ? [view.countertop] : []),
  ];
  const bounds = computeBounds(allRects, view.dimensions);
  const { width, height, offsetX, offsetY } = svgDimensions(bounds, scale);

  const parts: string[] = [];

  // 카운터탑 (배경)
  if (view.countertop) {
    parts.push(svgRectNoFlip(view.countertop, scale, offsetX, offsetY, COLORS.countertop, COLORS.cabinet_stroke, 1, 0.3));
  }

  // 하부장
  for (const cab of view.lower_cabinets) {
    parts.push(svgRectNoFlip(cab, scale, offsetX, offsetY, COLORS.cabinet, COLORS.cabinet_stroke, 1.5));
  }

  // 상부장 (점선)
  for (const cab of view.upper_cabinets) {
    parts.push(svgRectNoFlip(cab, scale, offsetX, offsetY, COLORS.upper_dash, COLORS.door_stroke, 1, 0.4, '6,3'));
  }

  // 치수선 (plan view는 Y flip 불필요)
  for (const dim of view.dimensions) {
    parts.push(svgDimensionNoFlip(dim, scale, offsetX, offsetY));
  }

  return wrapSvg(width, height, '평면도 (Plan View)', parts);
}

// ─────────────────────────────────────────────────────────────────
// Manufacturing SVG
// ─────────────────────────────────────────────────────────────────

function renderManufacturing(layout: ManufacturingLayout, scale: number): string {
  if (layout.panel_details.length === 0) {
    return wrapSvg(200, 60, '제작 도면 (Manufacturing)', ['<text x="100" y="40" font-size="12" text-anchor="middle" fill="#999">부품 없음</text>']);
  }

  // 부품을 그리드로 배치
  const colWidth = 300;
  const rowHeight = 250;
  const cols = 3;
  const parts: string[] = [];

  for (let i = 0; i < layout.panel_details.length; i++) {
    const panel = layout.panel_details[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const gx = col * colWidth * scale + PADDING;
    const gy = row * rowHeight * scale + PADDING + 30;

    parts.push(renderPanelDetail(panel, scale, gx, gy));
  }

  const totalRows = Math.ceil(layout.panel_details.length / cols);
  const svgW = cols * colWidth * scale + PADDING * 2;
  const svgH = totalRows * rowHeight * scale + PADDING * 2 + 30;

  return wrapSvg(svgW, svgH, '제작 도면 (Manufacturing)', parts);
}

function renderPanelDetail(panel: PanelDetail, scale: number, gx: number, gy: number): string {
  // 패널을 축소해서 셀 안에 맞추기
  const maxW = 200 * scale;
  const maxH = 150 * scale;
  const panelScale = Math.min(maxW / Math.max(panel.rect.width, 1), maxH / Math.max(panel.rect.height, 1), scale);

  const w = panel.rect.width * panelScale;
  const h = panel.rect.height * panelScale;

  const parts: string[] = [];

  // 라벨
  parts.push(`<text x="${r(gx + w / 2)}" y="${r(gy - 5)}" font-size="${DIM_FONT_SIZE}" fill="${COLORS.title}" text-anchor="middle">${escXml(panel.name)} [${panel.bom_id}]</text>`);

  // 패널 사각형
  parts.push(`<rect x="${r(gx)}" y="${r(gy)}" width="${r(w)}" height="${r(h)}" fill="${COLORS.panel_pb}" stroke="${COLORS.cabinet_stroke}" stroke-width="1"/>`);

  // 너비 치수
  parts.push(`<text x="${r(gx + w / 2)}" y="${r(gy + h + 15)}" font-size="${DIM_FONT_SIZE}" fill="${COLORS.dim_text}" text-anchor="middle">${panel.rect.width}mm</text>`);

  // 높이 치수
  parts.push(`<text x="${r(gx - 5)}" y="${r(gy + h / 2)}" font-size="${DIM_FONT_SIZE}" fill="${COLORS.dim_text}" text-anchor="end" dominant-baseline="middle">${panel.rect.height}mm</text>`);

  // 재질
  parts.push(`<text x="${r(gx + w / 2)}" y="${r(gy + h / 2)}" font-size="${DIM_FONT_SIZE - 1}" fill="${COLORS.title}" text-anchor="middle" dominant-baseline="middle" opacity="0.6">${escXml(panel.material)}</text>`);

  return parts.join('\n');
}

// ─────────────────────────────────────────────────────────────────
// Installation SVG
// ─────────────────────────────────────────────────────────────────

function renderInstallation(layout: InstallationLayout, scale: number): string {
  if (layout.wall.width === 0) {
    return wrapSvg(200, 60, '설치 도면 (Installation)', ['<text x="100" y="40" font-size="12" text-anchor="middle" fill="#999">벽 정보 없음</text>']);
  }

  const bounds = computeBounds([layout.wall, ...layout.equipment, ...layout.clearance_zones], []);
  const wallH = layout.wall.height;
  const { width, height, offsetX, offsetY } = svgDimensions(bounds, scale);

  const parts: string[] = [];

  // 벽면 배경
  parts.push(svgRect(layout.wall, scale, offsetX, offsetY, height, COLORS.wall, COLORS.wall_stroke, 2));

  // 타일 그리드
  if (layout.tile_grid) {
    const tg = layout.tile_grid;
    for (let c = 0; c <= tg.cols; c++) {
      const x = (tg.origin.x + c * tg.tile_w) * scale + offsetX;
      const y1 = offsetY;
      const y2 = height - offsetY;
      parts.push(`<line x1="${r(x)}" y1="${r(y1)}" x2="${r(x)}" y2="${r(y2)}" stroke="${COLORS.tile_grid}" stroke-width="0.5"/>`);
    }
    for (let rw = 0; rw <= tg.rows; rw++) {
      const y = height - (tg.origin.y + rw * tg.tile_h) * scale + offsetY;
      const x1 = offsetX;
      const x2 = layout.wall.width * scale + offsetX;
      parts.push(`<line x1="${r(x1)}" y1="${r(y)}" x2="${r(x2)}" y2="${r(y)}" stroke="${COLORS.tile_grid}" stroke-width="0.5"/>`);
    }
  }

  // 여유 공간 (점선)
  for (const zone of layout.clearance_zones) {
    parts.push(svgRect(zone, scale, offsetX, offsetY, height, COLORS.clearance, '#66BB6A', 1, 0.2, '4,4'));
  }

  // 설비 구역
  for (const eq of layout.equipment) {
    parts.push(svgRect(eq, scale, offsetX, offsetY, height, COLORS.equipment, COLORS.equipment_stroke, 1.5, 0.5));
    const cx = (eq.x + eq.width / 2) * scale + offsetX;
    const cy = height - (eq.y + eq.height / 2) * scale + offsetY;
    parts.push(`<text x="${r(cx)}" y="${r(cy)}" font-size="${DIM_FONT_SIZE}" fill="${COLORS.equipment_stroke}" text-anchor="middle" dominant-baseline="middle" font-weight="bold">${escXml(eq.label)}</text>`);
  }

  // 배관 마커
  for (const util of layout.utilities) {
    parts.push(svgUtilityMark(util, scale, offsetX, offsetY, height));
  }

  // 벽 치수
  parts.push(svgDimension(
    { start: { x: 0, y: -50 }, end: { x: layout.wall.width, y: -50 }, value: layout.wall.width, unit: 'mm', label: '벽 너비' },
    scale, offsetX, offsetY, height,
  ));
  parts.push(svgDimension(
    { start: { x: layout.wall.width + 50, y: 0 }, end: { x: layout.wall.width + 50, y: wallH }, value: wallH, unit: 'mm', label: '벽 높이' },
    scale, offsetX, offsetY, height,
  ));

  return wrapSvg(width, height, '설치 도면 (Installation)', parts);
}

// ─────────────────────────────────────────────────────────────────
// SVG Primitives (Y-flipped: 건축 좌표 → SVG 좌표)
// ─────────────────────────────────────────────────────────────────

function svgRect(
  rect: Rect, scale: number, ox: number, oy: number, svgH: number,
  fill: string, stroke: string, strokeWidth: number,
  opacity?: number, dashArray?: string,
): string {
  const x = rect.x * scale + ox;
  const y = svgH - (rect.y + rect.height) * scale + oy;
  const w = rect.width * scale;
  const h = rect.height * scale;
  const attrs = [
    `x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}"`,
    `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"`,
  ];
  if (opacity !== undefined) attrs.push(`opacity="${opacity}"`);
  if (dashArray) attrs.push(`stroke-dasharray="${dashArray}"`);
  return `<rect ${attrs.join(' ')}/>`;
}

/** Plan view용: Y flip 없이 그대로 렌더링 */
function svgRectNoFlip(
  rect: Rect, scale: number, ox: number, oy: number,
  fill: string, stroke: string, strokeWidth: number,
  opacity?: number, dashArray?: string,
): string {
  const x = rect.x * scale + ox;
  const y = rect.y * scale + oy;
  const w = rect.width * scale;
  const h = rect.height * scale;
  const attrs = [
    `x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}"`,
    `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"`,
  ];
  if (opacity !== undefined) attrs.push(`opacity="${opacity}"`);
  if (dashArray) attrs.push(`stroke-dasharray="${dashArray}"`);
  return `<rect ${attrs.join(' ')}/>`;
}

function svgHardware(hw: HardwarePoint, scale: number, ox: number, oy: number, svgH: number): string {
  const x = hw.x * scale + ox;
  const y = svgH - hw.y * scale + oy;

  switch (hw.type) {
    case 'hinge':
      return `<circle cx="${r(x)}" cy="${r(y)}" r="3" fill="${COLORS.hinge}" stroke="#D84315" stroke-width="0.5"/>`;
    case 'handle':
      return `<line x1="${r(x - 8)}" y1="${r(y)}" x2="${r(x + 8)}" y2="${r(y)}" stroke="${COLORS.handle}" stroke-width="2.5" stroke-linecap="round"/>`;
    case 'rail':
      return `<line x1="${r(x - 10)}" y1="${r(y)}" x2="${r(x + 10)}" y2="${r(y)}" stroke="${COLORS.rail}" stroke-width="1.5" stroke-dasharray="2,2"/>`;
  }
}

function svgUtilityMark(mark: UtilityMark, scale: number, ox: number, oy: number, svgH: number): string {
  const x = mark.x * scale + ox;
  const y = svgH - mark.y * scale + oy;
  const color = COLORS[mark.type] || '#999';

  const parts: string[] = [];
  // 마커 원
  parts.push(`<circle cx="${r(x)}" cy="${r(y)}" r="8" fill="${color}" opacity="0.7" stroke="#fff" stroke-width="1.5"/>`);
  // 라벨
  parts.push(`<text x="${r(x)}" y="${r(y + 20)}" font-size="${DIM_FONT_SIZE}" fill="${color}" text-anchor="middle" font-weight="bold">${escXml(mark.label)}</text>`);
  // 타입 아이콘 (텍스트 이니셜)
  const icon = mark.type === 'water' ? 'W' : mark.type === 'exhaust' ? 'E' : mark.type === 'gas' ? 'G' : 'O';
  parts.push(`<text x="${r(x)}" y="${r(y)}" font-size="8" fill="white" text-anchor="middle" dominant-baseline="central" font-weight="bold">${icon}</text>`);

  return parts.join('\n');
}

// ─────────────────────────────────────────────────────────────────
// Dimension Lines (Y-flipped)
// ─────────────────────────────────────────────────────────────────

function svgDimension(dim: DimensionLine, scale: number, ox: number, oy: number, svgH: number): string {
  const x1 = dim.start.x * scale + ox;
  const y1 = svgH - dim.start.y * scale + oy;
  const x2 = dim.end.x * scale + ox;
  const y2 = svgH - dim.end.y * scale + oy;

  return svgDimLineRaw(x1, y1, x2, y2, dim.value, dim.unit, dim.label);
}

/** Plan view용 치수선 (Y flip 없음) */
function svgDimensionNoFlip(dim: DimensionLine, scale: number, ox: number, oy: number): string {
  const x1 = dim.start.x * scale + ox;
  const y1 = dim.start.y * scale + oy;
  const x2 = dim.end.x * scale + ox;
  const y2 = dim.end.y * scale + oy;

  return svgDimLineRaw(x1, y1, x2, y2, dim.value, dim.unit, dim.label);
}

function svgDimLineRaw(x1: number, y1: number, x2: number, y2: number, value: number, unit: string, label?: string): string {
  const parts: string[] = [];
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  // 선
  parts.push(`<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${COLORS.dimension}" stroke-width="0.8"/>`);

  // 양쪽 끝 화살표 (작은 수직/수평 선)
  const isHorizontal = Math.abs(y2 - y1) < Math.abs(x2 - x1);
  if (isHorizontal) {
    parts.push(`<line x1="${r(x1)}" y1="${r(y1 - ARROW_SIZE)}" x2="${r(x1)}" y2="${r(y1 + ARROW_SIZE)}" stroke="${COLORS.dimension}" stroke-width="0.8"/>`);
    parts.push(`<line x1="${r(x2)}" y1="${r(y2 - ARROW_SIZE)}" x2="${r(x2)}" y2="${r(y2 + ARROW_SIZE)}" stroke="${COLORS.dimension}" stroke-width="0.8"/>`);
  } else {
    parts.push(`<line x1="${r(x1 - ARROW_SIZE)}" y1="${r(y1)}" x2="${r(x1 + ARROW_SIZE)}" y2="${r(y1)}" stroke="${COLORS.dimension}" stroke-width="0.8"/>`);
    parts.push(`<line x1="${r(x2 - ARROW_SIZE)}" y1="${r(y2)}" x2="${r(x2 + ARROW_SIZE)}" y2="${r(y2)}" stroke="${COLORS.dimension}" stroke-width="0.8"/>`);
  }

  // 텍스트 (수치 + 라벨)
  const text = label ? `${value}${unit} (${label})` : `${value}${unit}`;
  const textY = isHorizontal ? my - 4 : my;
  const textX = isHorizontal ? mx : mx - 4;
  const anchor = isHorizontal ? 'middle' : 'end';

  parts.push(`<text x="${r(textX)}" y="${r(textY)}" font-size="${DIM_FONT_SIZE}" fill="${COLORS.dim_text}" text-anchor="${anchor}">${escXml(text)}</text>`);

  return parts.join('\n');
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

interface Bounds { minX: number; minY: number; maxX: number; maxY: number; }

function computeBounds(rects: Rect[], dims: DimensionLine[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  for (const dim of dims) {
    minX = Math.min(minX, dim.start.x, dim.end.x);
    minY = Math.min(minY, dim.start.y, dim.end.y);
    maxX = Math.max(maxX, dim.start.x, dim.end.x);
    maxY = Math.max(maxY, dim.start.y, dim.end.y);
  }

  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  }

  return { minX, minY, maxX, maxY };
}

function svgDimensions(bounds: Bounds, scale: number) {
  const dataW = (bounds.maxX - bounds.minX) * scale;
  const dataH = (bounds.maxY - bounds.minY) * scale;
  const width = dataW + PADDING * 2;
  const height = dataH + PADDING * 2;
  const offsetX = PADDING - bounds.minX * scale;
  const offsetY = PADDING - bounds.minY * scale;
  return { width, height, offsetX, offsetY };
}

function wrapSvg(width: number, height: number, title: string, parts: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r(width)}" height="${r(height)}" viewBox="0 0 ${r(width)} ${r(height)}">`,
    `<style>text { font-family: 'Pretendard', 'Noto Sans KR', sans-serif; }</style>`,
    `<rect width="100%" height="100%" fill="white"/>`,
    `<text x="${r(width / 2)}" y="20" font-size="${FONT_SIZE + 2}" fill="${COLORS.title}" text-anchor="middle" font-weight="bold">${escXml(title)}</text>`,
    ...parts,
    `</svg>`,
  ].join('\n');
}

/** 소수점 1자리 반올림 */
function r(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
