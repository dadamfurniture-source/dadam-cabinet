// ═══════════════════════════════════════════════════════════════
// Chat Service - AI 채팅 응답 생성
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { geminiChat, extractTextFromGeminiResponse } from '../clients/gemini.client.js';
import { buildChatSystemPrompt } from '../prompts/templates/chat-system.prompt.js';
import { AppError } from '../utils/errors.js';

const log = createLogger('chat');

export async function generateChatResponse(
  message: string,
  context: Record<string, unknown>
): Promise<string> {
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
