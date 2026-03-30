import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/clients/gemini.client.js', () => ({
  geminiImageGeneration: vi.fn(),
  extractImageFromGeminiResponse: vi.fn(),
}));

vi.mock('../src/prompts/templates/closed-door.prompt.js', () => ({
  buildClosedDoorPrompt: vi.fn(() => 'closed prompt'),
}));

vi.mock('../src/prompts/templates/open-door.prompt.js', () => ({
  buildOpenDoorPrompt: vi.fn(() => 'open prompt'),
}));

vi.mock('../src/prompts/templates/design-to-image.prompt.js', () => ({
  buildDesignToImagePrompt: vi.fn(() => 'design prompt'),
}));

vi.mock('../src/prompts/templates/style-color.prompt.js', () => ({
  buildStyleColorPrompt: vi.fn(() => 'style prompt'),
}));

import {
  generateClosedAndOpenDoorImages,
  generateDesignImage,
} from '../src/services/image-generation.service.js';
import {
  geminiImageGeneration,
  extractImageFromGeminiResponse,
} from '../src/clients/gemini.client.js';

const mockGenerate = vi.mocked(geminiImageGeneration);
const mockExtract = vi.mocked(extractImageFromGeminiResponse);

const mockParams = {
  category: 'sink' as const,
  style: 'modern',
  wallData: {} as any,
  ragRules: { background: [], modules: [], doors: [], materials: [], materialKeywords: [] },
};

describe('generateClosedAndOpenDoorImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns both closed and open images on success', async () => {
    mockGenerate.mockResolvedValue({ candidates: [] } as any);
    mockExtract
      .mockReturnValueOnce('base64_closed')
      .mockReturnValueOnce('base64_open');

    const result = await generateClosedAndOpenDoorImages(
      mockParams, 'base64_room', 'image/jpeg',
    );

    expect(result.closedImage).toBe('base64_closed');
    expect(result.openImage).toBe('base64_open');
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('returns closed only when open generation fails', async () => {
    mockGenerate
      .mockResolvedValueOnce({ candidates: [] } as any)
      .mockRejectedValueOnce(new Error('Gemini error'));
    mockExtract.mockReturnValueOnce('base64_closed');

    const result = await generateClosedAndOpenDoorImages(
      mockParams, 'base64_room', 'image/jpeg',
    );

    expect(result.closedImage).toBe('base64_closed');
    expect(result.openImage).toBeNull();
  });

  it('throws when closed generation fails', async () => {
    mockGenerate.mockResolvedValue({ candidates: [] } as any);
    mockExtract.mockReturnValue(null as any);

    await expect(
      generateClosedAndOpenDoorImages(mockParams, 'base64_room', 'image/jpeg'),
    ).rejects.toThrow('Failed to generate closed door image');
  });
});

describe('generateDesignImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns image on success', async () => {
    mockGenerate.mockResolvedValue({ candidates: [] } as any);
    mockExtract.mockReturnValue('base64_design');

    const result = await generateDesignImage('sink', 'modern', {}, []);

    expect(result).toBe('base64_design');
  });

  it('throws when generation fails', async () => {
    mockGenerate.mockResolvedValue({ candidates: [] } as any);
    mockExtract.mockReturnValue(null as any);

    await expect(
      generateDesignImage('sink', 'modern', {}, []),
    ).rejects.toThrow('Failed to generate design image');
  });
});
