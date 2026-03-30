import { describe, it, expect } from 'vitest';
import { calculateQuote, ImageAnalysisResult } from '../src/services/quote.service.js';

function makeAnalysis(overrides: Partial<ImageAnalysisResult> = {}): ImageAnalysisResult {
  return {
    upper_cabinets: [{ width_mm: 900, type: 'standard' }],
    lower_cabinets: [
      { width_mm: 800, type: 'sink' },
      { width_mm: 600, type: 'drawer' },
      { width_mm: 800, type: 'cooktop' },
    ],
    countertop_length_mm: 2200,
    wall_width_mm: 3600,
    has_sink: true,
    has_cooktop: true,
    has_hood: true,
    door_count: 4,
    drawer_count: 3,
    ...overrides,
  };
}

describe('calculateQuote', () => {
  it('calculates a basic kitchen quote with all items', () => {
    const result = calculateQuote(makeAnalysis(), 'sink', 'basic');

    expect(result.grade).toBe('basic');
    expect(result.items.length).toBeGreaterThanOrEqual(5); // 하부+상부+상판+수전+싱크볼+후드+설치
    expect(result.subtotal).toBeGreaterThan(0);
    expect(result.vat).toBe(Math.round(result.subtotal * 0.10));
    expect(result.total).toBe(result.subtotal + result.vat);
    expect(result.range.min).toBeLessThan(result.total);
    expect(result.range.max).toBeGreaterThan(result.total);
  });

  it('calculates premium grade with higher prices', () => {
    const basic = calculateQuote(makeAnalysis(), 'sink', 'basic');
    const premium = calculateQuote(makeAnalysis(), 'sink', 'premium');

    expect(premium.total).toBeGreaterThan(basic.total);
  });

  it('calculates wardrobe quote (lower only)', () => {
    const analysis = makeAnalysis({
      upper_cabinets: [],
      has_sink: false,
      has_cooktop: false,
      has_hood: false,
    });

    const result = calculateQuote(analysis, 'wardrobe', 'basic');

    // 상부장 항목 없어야 함
    const upperItem = result.items.find(i => i.name === '상부장 캐비닛');
    expect(upperItem).toBeUndefined();
    expect(result.total).toBeGreaterThan(0);
  });

  it('throws ValidationError for invalid grade', () => {
    expect(() => calculateQuote(makeAnalysis(), 'sink', 'invalid'))
      .toThrow('유효하지 않은 등급');
  });

  it('handles empty cabinets gracefully', () => {
    const analysis = makeAnalysis({
      upper_cabinets: [],
      lower_cabinets: [],
      countertop_length_mm: 0,
      has_sink: false,
      has_cooktop: false,
      has_hood: false,
    });

    const result = calculateQuote(analysis, 'sink', 'basic');

    // 설치비만 포함
    expect(result.items.length).toBe(1);
    expect(result.items[0].name).toBe('배송 + 설치');
  });

  it('handles negative width by treating as 0', () => {
    const analysis = makeAnalysis({
      lower_cabinets: [{ width_mm: -500, type: 'sink' }],
    });

    const result = calculateQuote(analysis, 'sink', 'basic');

    // 음수 너비는 0으로 처리 → 하부장 비용 0
    const lowerItem = result.items.find(i => i.name === '하부장 캐비닛');
    expect(lowerItem).toBeUndefined();
  });

  it('falls back to sink prices for unknown category', () => {
    const result = calculateQuote(makeAnalysis(), 'unknown_category', 'basic');

    // CABINET_PRICES에 없으면 sink 단가 사용
    expect(result.total).toBeGreaterThan(0);
  });

  it('uses lowerTotalW as countertop length when not specified', () => {
    const analysis = makeAnalysis({ countertop_length_mm: 0 });
    const result = calculateQuote(analysis, 'sink', 'basic');

    // countertop_length_mm가 0이면 lowerTotalW로 fallback
    const ctItem = result.items.find(i => i.name.includes('상판'));
    expect(ctItem).toBeDefined();
    expect(ctItem!.total).toBeGreaterThan(0);
  });
});
