import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/config.js', () => ({
  getConfig: vi.fn(() => ({
    gemini: {
      apiKey: 'test-key',
      models: {
        text: 'gemini-test',
        imageGeneration: 'gemini-test-image',
        vision: 'gemini-test-vision',
      },
    },
  })),
}));

vi.mock('../src/clients/base-http.client.js', () => ({
  fetchWithRetry: vi.fn(),
}));

import { fetchWithRetry } from '../src/clients/base-http.client.js';
import type { GenerationInput } from '../src/services/direct-generation.service.js';

const mockFetch = vi.mocked(fetchWithRetry);

// 유효한 Gemini API 응답 생성 헬퍼
function geminiImageResponse(base64: string) {
  return {
    ok: true,
    json: () => Promise.resolve({
      candidates: [{
        content: {
          parts: [{ inlineData: { mimeType: 'image/png', data: base64 } }],
        },
      }],
    }),
  };
}

function geminiTextResponse(text: string) {
  return {
    ok: true,
    json: () => Promise.resolve({
      candidates: [{
        content: {
          parts: [{ text }],
        },
      }],
    }),
  };
}

const WALL_JSON = JSON.stringify({
  wall_width_mm: 3600,
  wall_height_mm: 2400,
  water_supply_position: 900,
  exhaust_duct_position: 2700,
});

describe('direct-generation service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates kitchen cabinet images end-to-end', async () => {
    // Call 1: wall analysis → text response
    // Call 2: closed door → image response
    // Call 3: open door → image response
    mockFetch
      .mockResolvedValueOnce(geminiTextResponse(WALL_JSON) as any)
      .mockResolvedValueOnce(geminiImageResponse('closed_base64') as any)
      .mockResolvedValueOnce(geminiImageResponse('open_base64') as any);

    // Dynamic import to ensure mocks are applied
    const { generateDirect } = await import('../src/services/direct-generation.service.js');

    const input: GenerationInput = {
      roomImage: 'room_base64',
      imageType: 'image/jpeg',
      category: 'sink',
      designStyle: 'modern-minimal',
    };

    const result = await generateDirect(input);

    expect(result.success).toBe(true);
    expect(result.closedImage).toBe('closed_base64');
    expect(result.openImage).toBe('open_base64');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('returns null open image when open door generation fails', async () => {
    mockFetch
      .mockResolvedValueOnce(geminiTextResponse(WALL_JSON) as any)
      .mockResolvedValueOnce(geminiImageResponse('closed_base64') as any)
      .mockRejectedValueOnce(new Error('Gemini timeout'));

    const { generateDirect } = await import('../src/services/direct-generation.service.js');

    const result = await generateDirect({
      roomImage: 'room_base64',
      imageType: 'image/jpeg',
      category: 'sink',
      designStyle: 'modern',
    });

    expect(result.success).toBe(true);
    expect(result.closedImage).toBe('closed_base64');
    expect(result.openImage).toBeNull();
  });

  it('handles wall analysis failure gracefully', async () => {
    // Wall analysis returns empty → uses defaults
    mockFetch
      .mockResolvedValueOnce(geminiTextResponse('invalid json') as any)
      .mockResolvedValueOnce(geminiImageResponse('closed_base64') as any)
      .mockResolvedValueOnce(geminiImageResponse('open_base64') as any);

    const { generateDirect } = await import('../src/services/direct-generation.service.js');

    const result = await generateDirect({
      roomImage: 'room_base64',
      imageType: 'image/jpeg',
      category: 'sink',
      designStyle: 'modern',
    });

    expect(result.success).toBe(true);
  });
});
