// ═══════════════════════════════════════════════════════════════
// Chat Service - AI 채팅 응답 생성
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { geminiChat, extractTextFromGeminiResponse } from '../clients/gemini.client.js';
import { buildChatSystemPrompt } from '../prompts/templates/chat-system.prompt.js';
import { AppError, ValidationError } from '../utils/errors.js';

const log = createLogger('chat');

export async function generateChatResponse(
  message: string,
  context: Record<string, unknown>
): Promise<string> {
  if (!message || message.trim().length === 0) {
    throw new ValidationError('메시지가 비어있습니다', 'message');
  }
  if (message.length > 10_000) {
    throw new ValidationError('메시지는 10,000자 이하여야 합니다', 'message');
  }

  const systemPrompt = buildChatSystemPrompt(context);

  log.info({ messagePreview: message.substring(0, 50) }, 'Generating chat response');

  const response = await geminiChat(message, systemPrompt);
  const aiResponse = extractTextFromGeminiResponse(response);

  if (!aiResponse) {
    throw new AppError('Failed to generate chat response', 500, 'CHAT_GENERATION_FAILED');
  }

  log.info('Chat response generated');
  return aiResponse;
}
