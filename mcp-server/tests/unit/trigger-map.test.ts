// ═══════════════════════════════════════════════════════════════
// Trigger Map - Unit Tests
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  getTriggers,
  extractColorKeywords,
  TRIGGER_MAP,
} from '../../src/prompts/constants/trigger-map.js';

describe('TRIGGER_MAP', () => {
  it('should have sink triggers', () => {
    expect(TRIGGER_MAP.sink).toContain('상부장');
    expect(TRIGGER_MAP.sink).toContain('하부장');
  });

  it('should have wardrobe triggers', () => {
    expect(TRIGGER_MAP.wardrobe).toContain('붙박이장');
  });

  it('should have fridge triggers', () => {
    expect(TRIGGER_MAP.fridge).toContain('냉장고장');
  });
});

describe('extractColorKeywords', () => {
  it('should extract Korean color keywords', () => {
    const result = extractColorKeywords('화이트 무광 오크');

    expect(result).toContain('화이트');
    expect(result).toContain('무광');
    expect(result).toContain('오크');
  });

  it('should extract English color keywords', () => {
    const result = extractColorKeywords('white oak finish');

    expect(result).toContain('white');
    expect(result).toContain('oak');
  });

  it('should be case insensitive', () => {
    const result = extractColorKeywords('WHITE Gray');

    expect(result).toContain('white');
    expect(result).toContain('gray');
  });

  it('should return empty array for no matches', () => {
    const result = extractColorKeywords('modern minimalist');

    expect(result).toHaveLength(0);
  });
});

describe('getTriggers', () => {
  it('should return base triggers for category', () => {
    const triggers = getTriggers('sink', 'modern');

    expect(triggers).toContain('상부장');
    expect(triggers).toContain('하부장');
  });

  it('should append color keywords from style', () => {
    const triggers = getTriggers('sink', '화이트 무광');

    expect(triggers).toContain('화이트');
    expect(triggers).toContain('무광');
  });

  it('should limit color keywords to 5', () => {
    const triggers = getTriggers('sink', '화이트 그레이 블랙 오크 월넛 무광 유광 white gray oak');

    // Base triggers + max 5 color keywords
    const colorCount = triggers.filter(t => !TRIGGER_MAP.sink.includes(t)).length;
    expect(colorCount).toBeLessThanOrEqual(5);
  });

  it('should fall back to sink triggers for unknown category', () => {
    const triggers = getTriggers('unknown', 'modern');

    expect(triggers).toContain('상부장');
  });
});
