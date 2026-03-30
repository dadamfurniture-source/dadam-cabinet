import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/clients/gemini.client.js', () => ({
  geminiVisionAnalysis: vi.fn(),
  geminiMultiImageAnalysis: vi.fn(),
  extractTextFromGeminiResponse: vi.fn(),
}));

vi.mock('../src/clients/claude.client.js', () => ({
  claudeVisionAnalysis: vi.fn(),
  claudeMultiImageAnalysis: vi.fn(),
  extractTextFromClaudeResponse: vi.fn(),
}));

vi.mock('../src/clients/supabase.client.js', () => ({
  getReferenceImagesByCategory: vi.fn(() => []),
  loadStorageImage: vi.fn(),
}));

vi.mock('../src/prompts/wall-analysis-fewshot.js', () => ({
  buildFewShotPrompt: vi.fn(() => 'fewshot prompt'),
  WALL_ANALYSIS_ZERO_SHOT_PROMPT: 'zero shot prompt',
}));

import { analyzeWall } from '../src/services/wall-analysis.service.js';
import {
  geminiVisionAnalysis,
  extractTextFromGeminiResponse,
} from '../src/clients/gemini.client.js';
import {
  claudeVisionAnalysis,
  extractTextFromClaudeResponse,
} from '../src/clients/claude.client.js';

const mockGeminiVision = vi.mocked(geminiVisionAnalysis);
const mockGeminiExtract = vi.mocked(extractTextFromGeminiResponse);
const mockClaudeVision = vi.mocked(claudeVisionAnalysis);
const mockClaudeExtract = vi.mocked(extractTextFromClaudeResponse);

const VALID_WALL_JSON = JSON.stringify({
  tile_detected: true,
  tile_type: 'subway_tile',
  tile_size_mm: { width: 300, height: 600 },
  wall_width_mm: 3600,
  wall_height_mm: 2400,
  utility_positions: {
    water_supply: { detected: true, from_origin_mm: 900 },
    exhaust_duct: { detected: true, from_origin_mm: 2700 },
    gas_pipe: { detected: false, from_origin_mm: 0 },
  },
  confidence: 'high',
});

describe('analyzeWall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no ANTHROPIC_API_KEY → gemini provider
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns parsed wall data on successful gemini analysis', async () => {
    mockGeminiVision.mockResolvedValue({} as any);
    mockGeminiExtract.mockReturnValue(VALID_WALL_JSON);

    const result = await analyzeWall({
      image: 'base64data',
      imageType: 'image/jpeg',
      useReferenceImages: false,
    });

    expect(result.wall_width_mm).toBe(3600);
    expect(result.wall_height_mm).toBe(2400);
    expect(result.tile_detected).toBe(true);
    expect(result.water_pipe_x).toBe(900);
    expect(result.exhaust_duct_x).toBe(2700);
    expect(result.confidence).toBe('high');
    expect(result.furniture_placement).toBeDefined();
  });

  it('returns defaults when analysis fails completely', async () => {
    mockGeminiVision.mockRejectedValue(new Error('API error'));

    const result = await analyzeWall({
      image: 'base64data',
      imageType: 'image/jpeg',
      useReferenceImages: false,
    });

    // Should use defaults, not throw
    expect(result.wall_width_mm).toBe(3000);
    expect(result.wall_height_mm).toBe(2400);
    expect(result.confidence).toBe('low');
    expect(result.furniture_placement).toBeDefined();
  });

  it('returns defaults when parsing returns null', async () => {
    mockGeminiVision.mockResolvedValue({} as any);
    mockGeminiExtract.mockReturnValue('invalid json {{{');

    const result = await analyzeWall({
      image: 'base64data',
      imageType: 'image/jpeg',
      useReferenceImages: false,
    });

    expect(result.wall_width_mm).toBe(3000);
    expect(result.confidence).toBe('low');
  });

  it('uses claude provider when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockClaudeVision.mockResolvedValue({} as any);
    mockClaudeExtract.mockReturnValue(VALID_WALL_JSON);

    const result = await analyzeWall({
      image: 'base64data',
      imageType: 'image/jpeg',
      useReferenceImages: false,
    });

    expect(result.wall_width_mm).toBe(3600);
    expect(mockClaudeVision).toHaveBeenCalledOnce();
    expect(mockGeminiVision).not.toHaveBeenCalled();

    delete process.env.ANTHROPIC_API_KEY;
  });

  it('calculates furniture placement from wall data', async () => {
    mockGeminiVision.mockResolvedValue({} as any);
    mockGeminiExtract.mockReturnValue(VALID_WALL_JSON);

    const result = await analyzeWall({
      image: 'base64data',
      imageType: 'image/jpeg',
      useReferenceImages: false,
    });

    expect(result.furniture_placement?.sink_center_mm).toBe(900);
    expect(result.furniture_placement?.cooktop_center_mm).toBe(2700);
  });

  it('applies defaults for missing fields in partial response', async () => {
    mockGeminiVision.mockResolvedValue({} as any);
    mockGeminiExtract.mockReturnValue(JSON.stringify({
      wall_width_mm: 4000,
      // missing: tile_detected, tile_type, tile_size_mm, etc.
    }));

    const result = await analyzeWall({
      image: 'base64data',
      imageType: 'image/jpeg',
      useReferenceImages: false,
    });

    expect(result.wall_width_mm).toBe(4000);
    expect(result.tile_detected).toBe(false); // default
    expect(result.tile_type).toBe('unknown'); // default
    expect(result.confidence).toBe('low'); // default
  });
});
