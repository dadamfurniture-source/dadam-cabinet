// ═══════════════════════════════════════════════════════════════
// Furniture Placement Service - 가구 배치 좌표 계산 (순수 함수)
// 기존: http-server.ts 723~754줄
// ═══════════════════════════════════════════════════════════════

import type { WallAnalysis, FurniturePlacement } from '../types/index.js';

/**
 * 가구 배치 좌표 계산 (n8n Parse Wall Data 로직 반영)
 * - 배관 감지 시: 배관 위치 기준
 * - 배관 미감지 시: 벽 너비 기준 기본값 (싱크 30%, 쿡탑 70%)
 */
export function calculateFurniturePlacement(wallData: WallAnalysis): FurniturePlacement {
  const wallWidth = wallData.wall_width_mm || 3000;
  const wallHeight = wallData.wall_height_mm || 2400;

  // 싱크대 위치: 수도배관 기준 또는 벽 너비의 30%
  const sinkCenter = wallData.water_pipe_x
    ? wallData.water_pipe_x
    : Math.round(wallWidth * 0.3);

  // 쿡탑/후드 위치: 배기구 기준 또는 벽 너비의 70%
  const cooktopCenter = wallData.exhaust_duct_x
    ? wallData.exhaust_duct_x
    : Math.round(wallWidth * 0.7);

  // 레이아웃 방향 결정
  const layoutDirection = sinkCenter < cooktopCenter
    ? 'sink_left_cooktop_right'
    : 'sink_right_cooktop_left';

  return {
    sink_position: `center_at_${sinkCenter}mm`,
    sink_center_mm: sinkCenter,
    cooktop_position: `center_at_${cooktopCenter}mm`,
    cooktop_center_mm: cooktopCenter,
    range_hood_position: `above_cooktop_at_${cooktopCenter}mm`,
    layout_direction: layoutDirection,
    upper_cabinet_bottom_mm: wallHeight - 720,
    lower_cabinet_height_mm: 870,
    countertop_height_mm: 870,
  };
}

export function getDefaultWallData(): WallAnalysis {
  return {
    reference_wall: {
      origin_point: 'left_edge',
      origin_reason: '기본값: 왼쪽 끝선 기준',
    },
    tile_detected: false,
    tile_type: 'standard_wall',
    tile_size_mm: { width: 300, height: 600 },
    wall_width_mm: 3000,
    wall_height_mm: 2400,
    water_pipe_x: undefined,
    exhaust_duct_x: undefined,
    gas_pipe_x: undefined,
    confidence: 'low',
  };
}
