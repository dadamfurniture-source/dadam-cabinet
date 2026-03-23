// ═══════════════════════════════════════════════════════════════
// Agent Orchestrator - Claude tool_use Agent 루프
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { claudeAgentCall } from '../clients/claude.client.js';
import { getOrCreateSession, addMessage, setRoomImage } from './session-store.js';
import { getToolDefinitions } from './tool-definitions.js';
import { executeTool } from './tool-adapter.js';
import { buildSystemPrompt } from './system-prompt.js';
import type {
  AgentSession,
  AgentChatRequest,
  SSEEvent,
  ClaudeAgentMessage,
  ClaudeAgentContentBlock,
  ClaudeToolUseBlock,
  ClaudeTextBlock,
} from './types.js';

const log = createLogger('orchestrator');

const MAX_TOOL_ITERATIONS = 10;

export type SSECallback = (event: SSEEvent) => void;

export async function runAgentLoop(
  request: AgentChatRequest,
  onEvent: SSECallback,
): Promise<void> {
  const session = getOrCreateSession(request.session_id);
  log.info({ sessionId: session.id, hasImages: !!(request.images?.length) }, 'Agent loop started');

  // 이미지가 있으면 세션에 저장 (첫 번째 이미지만 방 사진으로 사용)
  if (request.images?.length) {
    const img = request.images[0];
    setRoomImage(session.id, img.data, img.mime_type);
  }

  // 사용자 메시지 구성
  const userContent: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = [];

  if (request.images?.length) {
    for (const img of request.images) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mime_type, data: img.data },
      });
    }
  }
  userContent.push({ type: 'text', text: request.message });

  const userMessage: ClaudeAgentMessage = { role: 'user', content: userContent };
  addMessage(session.id, userMessage);

  // Agent 루프
  let iteration = 0;

  while (iteration < MAX_TOOL_ITERATIONS) {
    iteration++;

    const systemPrompt = buildSystemPrompt(session.designState);
    const tools = getToolDefinitions();

    // 이미지는 첫 번째 메시지에만 포함, 이후에는 제거하여 토큰 절감
    const messages = prepareMessages(session);

    try {
      const response = await claudeAgentCall({
        system: systemPrompt,
        messages,
        tools,
      });

      // 응답 처리
      const assistantMessage: ClaudeAgentMessage = {
        role: 'assistant',
        content: response.content as ClaudeAgentContentBlock[],
      };
      addMessage(session.id, assistantMessage);

      // 텍스트 블록 전송
      for (const block of response.content) {
        if (block.type === 'text') {
          onEvent({ event: 'text', data: { chunk: (block as ClaudeTextBlock).text } });
        }
      }

      // stop_reason에 따라 분기
      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        if (response.stop_reason === 'max_tokens') {
          log.warn({ sessionId: session.id, iteration }, 'Response truncated by max_tokens');
          onEvent({
            event: 'text',
            data: { chunk: '\n\n[응답이 길이 제한으로 잘렸습니다. 계속 진행하시려면 말씀해주세요.]' },
          });
        }

        // 대화 종료 — 이미지/데이터 이벤트 전송
        sendDesignStateEvents(session, onEvent);

        onEvent({
          event: 'done',
          data: {
            session_id: session.id,
            design_state: summarizeDesignState(session),
          },
        });
        return;
      }

      if (response.stop_reason === 'tool_use') {
        // 도구 호출 처리
        const toolUseBlocks = response.content.filter(
          (b): b is ClaudeToolUseBlock => b.type === 'tool_use'
        );

        const toolResults: Array<{
          type: 'tool_result';
          tool_use_id: string;
          content: string;
          is_error?: boolean;
        }> = [];

        for (const toolBlock of toolUseBlocks) {
          onEvent({
            event: 'progress',
            data: { tool: toolBlock.name, status: 'running' },
          });

          const startTime = Date.now();
          const result = await executeTool(
            toolBlock.name,
            toolBlock.input,
            session,
          );
          const durationMs = Date.now() - startTime;

          onEvent({
            event: 'progress',
            data: {
              tool: toolBlock.name,
              status: result.success ? 'complete' : 'error',
              duration_ms: durationMs,
              ...(result.error ? { error: result.error } : {}),
            },
          });

          // 도구 실행 후 이미지 이벤트 즉시 전송
          if (result.success && toolBlock.name === 'render_furniture') {
            sendImageEvents(session, onEvent);
          }
          if (result.success && toolBlock.name === 'render_svg') {
            sendSvgEvents(session, onEvent);
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: result.success
              ? JSON.stringify(result.data)
              : JSON.stringify({ error: result.error }),
            is_error: !result.success,
          });
        }

        // tool_result를 대화에 추가
        const toolResultMessage: ClaudeAgentMessage = {
          role: 'user',
          content: toolResults,
        };
        addMessage(session.id, toolResultMessage);

        // 루프 계속 (다음 Claude 호출)
        continue;
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ sessionId: session.id, iteration, error: message }, 'Agent loop error');
      onEvent({
        event: 'error',
        data: { message: `AI 처리 중 오류가 발생했습니다: ${message}` },
      });
      onEvent({
        event: 'done',
        data: { session_id: session.id, design_state: summarizeDesignState(session) },
      });
      return;
    }
  }

  // 최대 반복 초과
  log.warn({ sessionId: session.id }, 'Max iterations reached');
  onEvent({
    event: 'text',
    data: { chunk: '처리 단계가 최대 횟수에 도달했습니다. 추가 요청이 있으시면 말씀해주세요.' },
  });
  onEvent({
    event: 'done',
    data: { session_id: session.id, design_state: summarizeDesignState(session) },
  });
}

// ─────────────────────────────────────────────────────────────────
// 헬퍼 함수
// ─────────────────────────────────────────────────────────────────

function prepareMessages(session: AgentSession): ClaudeAgentMessage[] {
  // 이미지는 첫 번째 user 메시지에만 포함
  // 후속 메시지에서는 이미지 블록을 제거하여 토큰 절감
  const messages = [...session.messages];

  let firstImageSent = false;
  return messages.map((msg, idx) => {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const hasImage = msg.content.some(
        (b) => b.type === 'image'
      );
      if (hasImage) {
        if (firstImageSent) {
          // 두 번째 이후 이미지 메시지에서는 이미지 제거
          return {
            ...msg,
            content: msg.content.filter(
              (b) => b.type !== 'image'
            ),
          };
        }
        firstImageSent = true;
      }
    }
    return msg;
  });
}

function sendDesignStateEvents(session: AgentSession, onEvent: SSECallback): void {
  sendImageEvents(session, onEvent);

  if (session.designState.designData) {
    onEvent({
      event: 'design_data',
      data: { design_data: session.designState.designData as unknown as Record<string, unknown> },
    });
  }

  if (session.designState.bomResult) {
    onEvent({
      event: 'bom',
      data: { bom: session.designState.bomResult as unknown as Record<string, unknown> },
    });
  }

  sendSvgEvents(session, onEvent);
}

function sendImageEvents(session: AgentSession, onEvent: SSECallback): void {
  const images = session.designState.generatedImages;
  if (!images) return;

  if (images.closed) {
    onEvent({
      event: 'image',
      data: { base64: images.closed, mime_type: 'image/png', label: 'closed_door' },
    });
  }
  if (images.open) {
    onEvent({
      event: 'image',
      data: { base64: images.open, mime_type: 'image/png', label: 'open_door' },
    });
  }
}

function sendSvgEvents(session: AgentSession, onEvent: SSECallback): void {
  const svg = session.designState.svgOutput;
  if (!svg) return;

  onEvent({
    event: 'svg',
    data: { svg: svg as unknown as Record<string, unknown> },
  });
}

function summarizeDesignState(session: AgentSession): Record<string, unknown> {
  const ds = session.designState;
  return {
    category: ds.category,
    style: ds.style,
    has_wall_analysis: !!ds.wallAnalysis,
    has_rag_rules: !!ds.ragRules,
    has_images: !!ds.generatedImages,
    has_design_data: !!ds.designData,
    has_bom: !!ds.bomResult,
    has_drawing: !!ds.drawingData,
    has_svg: !!ds.svgOutput,
  };
}
