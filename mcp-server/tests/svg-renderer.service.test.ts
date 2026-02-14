import { describe, it, expect } from 'vitest';
import { generateDrawingData } from '../src/services/drawing.service.js';
import { renderDrawingToSvg } from '../src/services/svg-renderer.service.js';
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

function getDrawing(overrides?: Partial<StructuredDesignData>) {
  return generateDrawingData(makeKitchenDesign(overrides));
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('renderDrawingToSvg', () => {
  it('returns all 5 SVG views by default', () => {
    const svg = renderDrawingToSvg(getDrawing());

    expect(svg.front_view).toContain('<svg');
    expect(svg.side_view).toContain('<svg');
    expect(svg.plan_view).toContain('<svg');
    expect(svg.manufacturing).toContain('<svg');
    expect(svg.installation).toContain('<svg');
  });

  it('renders valid SVG with xmlns attribute', () => {
    const svg = renderDrawingToSvg(getDrawing());

    for (const view of [svg.front_view, svg.side_view, svg.plan_view]) {
      expect(view).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(view).toContain('</svg>');
    }
  });

  it('renders only selected views when specified', () => {
    const svg = renderDrawingToSvg(getDrawing(), { views: ['front', 'side'] });

    expect(svg.front_view).toContain('<svg');
    expect(svg.side_view).toContain('<svg');
    expect(svg.plan_view).toBe('');
    expect(svg.manufacturing).toBe('');
    expect(svg.installation).toBe('');
  });

  it('front view contains cabinet rects', () => {
    const svg = renderDrawingToSvg(getDrawing());

    // Should contain <rect> elements for cabinets
    const rectCount = (svg.front_view.match(/<rect /g) || []).length;
    // At least: background + baseboard + 3 lower + 1 upper + doors + countertop + molding
    expect(rectCount).toBeGreaterThan(5);
  });

  it('front view contains hardware markers (hinges and handles)', () => {
    const svg = renderDrawingToSvg(getDrawing());

    // Hinges are rendered as circles
    expect(svg.front_view).toContain('<circle');
    // Handles are rendered as lines with blue color
    expect(svg.front_view).toContain('#2196F3'); // handle color
    expect(svg.front_view).toContain('#FF5722'); // hinge color
  });

  it('front view contains dimension lines with values', () => {
    const svg = renderDrawingToSvg(getDrawing());

    // Total width dimension
    expect(svg.front_view).toContain('3600mm');
    // Cabinet width dimension
    expect(svg.front_view).toContain('800mm');
    // Height dimensions
    expect(svg.front_view).toContain('870mm');
  });

  it('side view contains panel labels', () => {
    const svg = renderDrawingToSvg(getDrawing());

    // Panel names should appear as text
    expect(svg.side_view).toContain('좌측판');
    expect(svg.side_view).toContain('뒷판');
    expect(svg.side_view).toContain('선반');
  });

  it('plan view renders upper cabinets with dashed stroke', () => {
    const svg = renderDrawingToSvg(getDrawing());

    // Upper cabinets use dashed lines
    expect(svg.plan_view).toContain('stroke-dasharray="6,3"');
  });

  it('installation view contains utility markers', () => {
    const svg = renderDrawingToSvg(getDrawing());

    // Utility labels
    expect(svg.installation).toContain('급수');
    expect(svg.installation).toContain('배기구');
    expect(svg.installation).toContain('가스');
    // Equipment
    expect(svg.installation).toContain('싱크볼');
    expect(svg.installation).toContain('쿡탑');
  });

  it('manufacturing view contains BOM IDs and panel dimensions', () => {
    const svg = renderDrawingToSvg(getDrawing());

    // BOM IDs
    expect(svg.manufacturing).toContain('BOM-');
    // Should have dimension text
    expect(svg.manufacturing).toMatch(/\d+mm/);
  });

  it('respects custom scale', () => {
    const svg1 = renderDrawingToSvg(getDrawing(), { scale: 0.3 });
    const svg2 = renderDrawingToSvg(getDrawing(), { scale: 1.0 });

    // Larger scale = larger SVG dimensions
    const getWidth = (s: string) => {
      const m = s.match(/width="([\d.]+)"/);
      return m ? parseFloat(m[1]) : 0;
    };

    expect(getWidth(svg2.front_view)).toBeGreaterThan(getWidth(svg1.front_view));
  });

  it('handles empty cabinets gracefully', () => {
    const svg = renderDrawingToSvg(getDrawing({
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

    // Should still produce valid SVGs
    expect(svg.front_view).toContain('<svg');
    expect(svg.front_view).toContain('</svg>');
    expect(svg.manufacturing).toContain('부품 없음');
  });

  it('includes view titles in SVG', () => {
    const svg = renderDrawingToSvg(getDrawing());

    expect(svg.front_view).toContain('정면도 (Front View)');
    expect(svg.side_view).toContain('단면도 (Side View)');
    expect(svg.plan_view).toContain('평면도 (Plan View)');
    expect(svg.manufacturing).toContain('제작 도면 (Manufacturing)');
    expect(svg.installation).toContain('설치 도면 (Installation)');
  });

  it('escapes XML special characters in labels', () => {
    const svg = renderDrawingToSvg(getDrawing({
      materials: {
        door_color: 'white & cream',
        door_finish: 'matte <special>',
        countertop: 'marble',
        material_codes: [],
        handle_type: 'line',
      },
    }));

    // Should not have raw & or < in SVG (would be invalid XML)
    expect(svg.manufacturing).not.toContain('& ');
    expect(svg.manufacturing).not.toContain('<special>');
    if (svg.manufacturing.includes('cream')) {
      expect(svg.manufacturing).toContain('&amp;');
    }
  });
});
