/**
 * 통합 테스트: 설계 파이프라인 전체 흐름
 * placement → design-data → bom → drawing → svg
 *
 * 모든 순수 계산 서비스를 실제로 실행 (mock 없음)
 */
import { describe, it, expect } from 'vitest';
import { calculateFurniturePlacement, getDefaultWallData } from '../../src/services/furniture-placement.service.js';
import { extractDesignData } from '../../src/services/design-data.service.js';
import { generateBom } from '../../src/services/bom.service.js';
import { generateDrawingData } from '../../src/services/drawing.service.js';
import { renderDrawingToSvg } from '../../src/services/svg-renderer.service.js';
import { makeWallData, makeClassified } from '../fixtures/design.fixture.js';

describe('Design Pipeline Integration', () => {
  it('processes a complete kitchen design from wall data to SVG', () => {
    // Step 1: 벽 분석 데이터 → 가구 배치
    const wallData = makeWallData({ water_pipe_x: 1000, exhaust_duct_x: 2800 });
    const placement = calculateFurniturePlacement(wallData);

    expect(placement.sink_center_mm).toBe(1000);
    expect(placement.cooktop_center_mm).toBe(2800);

    // Step 2: 설계 데이터 추출
    const designData = extractDesignData({
      category: 'sink',
      style: 'modern',
      wallData: { ...wallData, furniture_placement: placement },
      classified: makeClassified(),
    });

    expect(designData.category).toBe('sink');
    expect(designData.cabinets.lower.length).toBeGreaterThan(0);
    expect(designData.wall.width_mm).toBe(3600);

    // Step 3: BOM 생성
    const bom = generateBom(designData);

    expect(bom.items.length).toBeGreaterThan(0);
    expect(bom.summary.total_items).toBe(bom.items.length);
    expect(bom.category).toBe('sink');

    // Step 4: 도면 생성
    const drawing = generateDrawingData(designData, bom);

    expect(drawing.common.front_view.cabinets.length).toBeGreaterThan(0);
    expect(drawing.common.front_view.doors.length).toBeGreaterThan(0);
    expect(drawing.common.side_view.panels.length).toBeGreaterThan(0);
    expect(drawing.common.plan_view.lower_cabinets.length).toBeGreaterThan(0);
    expect(drawing.manufacturing.panel_details.length).toBeGreaterThan(0);
    expect(drawing.installation.wall.width).toBe(3600);

    // Step 5: SVG 렌더링
    const svg = renderDrawingToSvg(drawing);

    expect(svg.front_view).toContain('<svg');
    expect(svg.side_view).toContain('<svg');
    expect(svg.plan_view).toContain('<svg');
    expect(svg.manufacturing).toContain('<svg');
    expect(svg.installation).toContain('<svg');
  });

  it('processes wardrobe design end-to-end', () => {
    const wallData = makeWallData({ wall_width_mm: 2400, wall_height_mm: 2600 });
    const placement = calculateFurniturePlacement(wallData);

    const designData = extractDesignData({
      category: 'wardrobe',
      style: 'nordic',
      wallData: { ...wallData, furniture_placement: placement },
      classified: makeClassified(),
    });

    expect(designData.category).toBe('wardrobe');
    expect(designData.cabinets.lower.length).toBeGreaterThan(0);

    const bom = generateBom(designData);
    expect(bom.items.length).toBeGreaterThan(0);

    const drawing = generateDrawingData(designData, bom);
    expect(drawing.common.front_view.cabinets.length).toBeGreaterThan(0);

    const svg = renderDrawingToSvg(drawing);
    expect(svg.front_view).toContain('<svg');
  });

  it('processes fridge cabinet design end-to-end', () => {
    const wallData = makeWallData({ wall_width_mm: 2000 });

    const designData = extractDesignData({
      category: 'fridge',
      style: 'modern',
      wallData,
      classified: makeClassified(),
    });

    expect(designData.category).toBe('fridge');

    const bom = generateBom(designData);
    const drawing = generateDrawingData(designData, bom);
    const svg = renderDrawingToSvg(drawing);

    expect(svg.front_view).toContain('<svg');
  });

  it('handles default wall data gracefully', () => {
    const wallData = getDefaultWallData();
    const placement = calculateFurniturePlacement(wallData);

    const designData = extractDesignData({
      category: 'sink',
      style: 'modern',
      wallData: { ...wallData, furniture_placement: placement },
      classified: makeClassified(),
    });

    // 기본값: 3000mm 벽
    expect(designData.wall.width_mm).toBe(3000);
    expect(designData.cabinets.lower.length).toBeGreaterThan(0);

    const bom = generateBom(designData);
    expect(bom.items.length).toBeGreaterThan(0);

    const drawing = generateDrawingData(designData, bom);
    const svg = renderDrawingToSvg(drawing);
    expect(svg.front_view).toContain('<svg');
  });

  it('data contracts are consistent across services', () => {
    const wallData = makeWallData();

    const designData = extractDesignData({
      category: 'sink',
      style: 'modern',
      wallData,
      classified: makeClassified(),
    });

    // BOM 입력과 Drawing 입력은 같은 StructuredDesignData
    const bom = generateBom(designData);
    const drawing = generateDrawingData(designData, bom);

    // BOM 패널 항목과 제작도 패널이 모두 존재하는지
    const bomPanels = bom.items.filter(i => i.part_category === 'panel');
    expect(bomPanels.length).toBeGreaterThan(0);
    expect(drawing.manufacturing.panel_details.length).toBeGreaterThan(0);

    // BOM 참조가 제작도에 매핑되는지
    for (const ref of drawing.manufacturing.bom_references) {
      const bomItem = bom.items.find(i => i.id === ref.bom_id);
      expect(bomItem).toBeDefined();
    }
  });
});
