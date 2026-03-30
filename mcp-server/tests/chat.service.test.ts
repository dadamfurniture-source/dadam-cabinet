import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock gemini client before importing the service
vi.mock('../src/clients/gemini.client.js', () => ({
  geminiChat: vi.fn(),
  extractTextFromGeminiResponse: vi.fn(),
}));

vi.mock('../src/prompts/templates/chat-system.prompt.js', () => ({
  buildChatSystemPrompt: vi.fn(() => 'system prompt'),
}));

import { generateChatResponse } from '../src/services/chat.service.js';
import { geminiChat, extractTextFromGeminiResponse } from '../src/clients/gemini.client.js';

const mockGeminiChat = vi.mocked(geminiChat);
const mockExtractText = vi.mocked(extractTextFromGeminiResponse);

describe('generateChatResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns AI response on success', async () => {
    mockGeminiChat.mockResolvedValue({ candidates: [] } as any);
    mockExtractText.mockReturnValue('안녕하세요!');

    const result = await generateChatResponse('Hello', {});

    expect(result).toBe('안녕하세요!');
    expect(mockGeminiChat).toHaveBeenCalledOnce();
  });

  it('throws AppError when response is empty', async () => {
    mockGeminiChat.mockResolvedValue({ candidates: [] } as any);
    mockExtractText.mockReturnValue(null as any);

    await expect(generateChatResponse('Hello', {}))
      .rejects.toThrow('Failed to generate chat response');
  });

  it('throws ValidationError for empty message', async () => {
    await expect(generateChatResponse('', {}))
      .rejects.toThrow('메시지가 비어있습니다');
  });

  it('throws ValidationError for whitespace-only message', async () => {
    await expect(generateChatResponse('   ', {}))
      .rejects.toThrow('메시지가 비어있습니다');
  });

  it('throws ValidationError for message exceeding 10000 chars', async () => {
    const longMessage = 'a'.repeat(10_001);
    await expect(generateChatResponse(longMessage, {}))
      .rejects.toThrow('10,000자');
  });

  it('propagates external API errors', async () => {
    mockGeminiChat.mockRejectedValue(new Error('API timeout'));

    await expect(generateChatResponse('Hello', {}))
      .rejects.toThrow('API timeout');
  });
});
