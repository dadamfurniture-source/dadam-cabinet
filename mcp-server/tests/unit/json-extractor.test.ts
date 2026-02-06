// ═══════════════════════════════════════════════════════════════
// JSON Extractor - Unit Tests
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { extractJsonFromText } from '../../src/utils/json-extractor.js';

describe('extractJsonFromText', () => {
  it('should extract simple JSON', () => {
    const text = '{"key": "value", "num": 42}';
    const result = extractJsonFromText(text);

    expect(result).toEqual({ key: 'value', num: 42 });
  });

  it('should extract JSON from markdown code block', () => {
    const text = '```json\n{"wall_width_mm": 3000}\n```';
    const result = extractJsonFromText(text);

    expect(result).toEqual({ wall_width_mm: 3000 });
  });

  it('should extract JSON from code block without json tag', () => {
    const text = '```\n{"tile_detected": true}\n```';
    const result = extractJsonFromText(text);

    expect(result).toEqual({ tile_detected: true });
  });

  it('should extract JSON with surrounding text', () => {
    const text = 'Here is the result:\n{"confidence": "high"}\nEnd of analysis.';
    const result = extractJsonFromText(text);

    expect(result).toEqual({ confidence: 'high' });
  });

  it('should extract nested JSON', () => {
    const text = '{"outer": {"inner": {"deep": 123}}}';
    const result = extractJsonFromText(text);

    expect(result).toEqual({ outer: { inner: { deep: 123 } } });
  });

  it('should handle JSON with arrays', () => {
    const text = '{"items": [1, 2, 3], "nested": [{"a": 1}]}';
    const result = extractJsonFromText(text);

    expect(result).toEqual({ items: [1, 2, 3], nested: [{ a: 1 }] });
  });

  it('should handle escaped characters in strings', () => {
    const text = '{"message": "Hello \\"world\\"", "path": "C:\\\\test"}';
    const result = extractJsonFromText(text);

    expect(result).not.toBeNull();
    expect(result?.message).toBe('Hello "world"');
  });

  it('should handle JSON with braces in string values', () => {
    const text = '{"description": "Use {curly} braces in text"}';
    const result = extractJsonFromText(text);

    expect(result).toEqual({ description: 'Use {curly} braces in text' });
  });

  it('should return null for empty string', () => {
    expect(extractJsonFromText('')).toBeNull();
  });

  it('should return null for null/undefined', () => {
    expect(extractJsonFromText(null as any)).toBeNull();
    expect(extractJsonFromText(undefined as any)).toBeNull();
  });

  it('should return null for non-JSON text', () => {
    expect(extractJsonFromText('This is plain text without JSON')).toBeNull();
  });

  it('should return null for invalid JSON', () => {
    expect(extractJsonFromText('{invalid json}')).toBeNull();
  });

  it('should return null for JSON array (not object)', () => {
    expect(extractJsonFromText('[1, 2, 3]')).toBeNull();
  });

  it('should extract first object from text with multiple JSON objects', () => {
    const text = '{"first": 1} and {"second": 2}';
    const result = extractJsonFromText(text);

    // Should extract the outermost/first valid JSON
    expect(result).not.toBeNull();
  });

  it('should handle wall analysis response format', () => {
    const text = `Here is the analysis:
\`\`\`json
{
  "tile_detected": true,
  "tile_type": "standard_wall",
  "tile_size_mm": {"width": 300, "height": 600},
  "wall_dimensions_mm": {"width": 3600, "height": 2400},
  "utility_positions": {
    "water_supply": {"detected": true, "from_origin_mm": 800},
    "exhaust_duct": {"detected": true, "from_origin_mm": 2700}
  },
  "confidence": "high"
}
\`\`\``;

    const result = extractJsonFromText(text);

    expect(result).not.toBeNull();
    expect(result?.tile_detected).toBe(true);
    expect(result?.confidence).toBe('high');
  });
});
