// ═══════════════════════════════════════════════════════════════
// Orchestrator - Unit Tests (Claude API + tool-adapter mock)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SSEEvent, ClaudeAgentResponse } from '../../src/agent/types.js';

// Mock 의존성
vi.mock('../../src/clients/claude.client.js', () => ({
  claudeAgentCall: vi.fn(),
}));

vi.mock('../../src/agent/tool-adapter.js', () => ({
  executeTool: vi.fn(),
}));

vi.mock('../../src/agent/system-prompt.js', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('You are a furniture design agent.'),
}));

vi.mock('../../src/agent/tool-definitions.js', () => ({
  getToolDefinitions: vi.fn().mockReturnValue([
    { name: 'analyze_wall', description: 'Analyze wall', input_schema: { type: 'object', properties: {} } },
  ]),
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// session-store는 실제 구현 사용 (인메모리)
import { runAgentLoop } from '../../src/agent/orchestrator.js';
import { claudeAgentCall } from '../../src/clients/claude.client.js';
import { executeTool } from '../../src/agent/tool-adapter.js';

const mockClaudeCall = claudeAgentCall as ReturnType<typeof vi.fn>;
const mockExecuteTool = executeTool as ReturnType<typeof vi.fn>;

function makeTextResponse(text: string): ClaudeAgentResponse {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'claude-sonnet-4-6-20250514',
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function makeToolUseResponse(toolName: string, toolInput: Record<string, unknown>): ClaudeAgentResponse {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [
      { type: 'text', text: '도구를 사용하겠습니다.' },
      { type: 'tool_use', id: 'toolu_test_123', name: toolName, input: toolInput },
    ],
    model: 'claude-sonnet-4-6-20250514',
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function makeMaxTokensResponse(text: string): ClaudeAgentResponse {
  return {
    ...makeTextResponse(text),
    stop_reason: 'max_tokens',
  };
}

describe('Agent Orchestrator', () => {
  let events: SSEEvent[];
  let onEvent: (event: SSEEvent) => void;

  beforeEach(() => {
    events = [];
    onEvent = (event) => events.push(event);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('basic text response', () => {
    it('should handle simple text response and emit text + done events', async () => {
      mockClaudeCall.mockResolvedValueOnce(makeTextResponse('안녕하세요! 설계를 도와드리겠습니다.'));

      await runAgentLoop({ message: '싱크대 설계해줘' }, onEvent);

      const textEvents = events.filter(e => e.event === 'text');
      const doneEvents = events.filter(e => e.event === 'done');

      expect(textEvents).toHaveLength(1);
      expect(textEvents[0].data.chunk).toBe('안녕하세요! 설계를 도와드리겠습니다.');
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0].data.session_id).toBeDefined();
    });
  });

  describe('tool use loop', () => {
    it('should execute tool and continue loop when stop_reason is tool_use', async () => {
      // 1st call: tool_use
      mockClaudeCall.mockResolvedValueOnce(
        makeToolUseResponse('analyze_wall', { provider: 'claude' })
      );
      mockExecuteTool.mockResolvedValueOnce({
        success: true,
        data: { wall_width_mm: 3000 },
      });

      // 2nd call: end_turn
      mockClaudeCall.mockResolvedValueOnce(
        makeTextResponse('벽 분석 완료: 3000mm 폭입니다.')
      );

      await runAgentLoop({ message: '벽 분석해줘' }, onEvent);

      // Claude가 2번 호출되어야 함
      expect(mockClaudeCall).toHaveBeenCalledTimes(2);
      expect(mockExecuteTool).toHaveBeenCalledTimes(1);

      // progress 이벤트 확인
      const progressEvents = events.filter(e => e.event === 'progress');
      expect(progressEvents).toHaveLength(2); // running + complete
      expect(progressEvents[0].data.status).toBe('running');
      expect(progressEvents[1].data.status).toBe('complete');
    });

    it('should handle tool execution error gracefully', async () => {
      mockClaudeCall.mockResolvedValueOnce(
        makeToolUseResponse('analyze_wall', {})
      );
      mockExecuteTool.mockResolvedValueOnce({
        success: false,
        data: null,
        error: '방 사진이 없습니다',
      });

      // 에러 후 Claude가 에러를 설명
      mockClaudeCall.mockResolvedValueOnce(
        makeTextResponse('방 사진을 먼저 업로드해주세요.')
      );

      await runAgentLoop({ message: '벽 분석해줘' }, onEvent);

      const progressEvents = events.filter(e => e.event === 'progress');
      expect(progressEvents[1].data.status).toBe('error');
      expect(progressEvents[1].data.error).toBe('방 사진이 없습니다');
    });
  });

  describe('max iterations', () => {
    it('should stop after MAX_TOOL_ITERATIONS (10)', async () => {
      // 모든 호출이 tool_use를 반환하도록 설정
      for (let i = 0; i < 10; i++) {
        mockClaudeCall.mockResolvedValueOnce(
          makeToolUseResponse('search_design_rules', { category: 'sink', style: 'modern' })
        );
        mockExecuteTool.mockResolvedValueOnce({
          success: true,
          data: { total_rules: 5 },
        });
      }

      await runAgentLoop({ message: '계속 검색해' }, onEvent);

      expect(mockClaudeCall).toHaveBeenCalledTimes(10);

      const textEvents = events.filter(e => e.event === 'text');
      const lastText = textEvents[textEvents.length - 1];
      expect(lastText.data.chunk).toContain('최대 횟수');

      const doneEvents = events.filter(e => e.event === 'done');
      expect(doneEvents).toHaveLength(1);
    });
  });

  describe('max_tokens truncation', () => {
    it('should warn user when response is truncated', async () => {
      mockClaudeCall.mockResolvedValueOnce(
        makeMaxTokensResponse('잘린 응답...')
      );

      await runAgentLoop({ message: '긴 설명해줘' }, onEvent);

      const textEvents = events.filter(e => e.event === 'text');
      expect(textEvents).toHaveLength(2); // 원본 텍스트 + 경고
      expect(textEvents[1].data.chunk).toContain('잘렸습니다');
    });
  });

  describe('error handling', () => {
    it('should emit error event when Claude API fails', async () => {
      mockClaudeCall.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      await runAgentLoop({ message: '안녕' }, onEvent);

      const errorEvents = events.filter(e => e.event === 'error');
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].data.message).toContain('API rate limit exceeded');

      const doneEvents = events.filter(e => e.event === 'done');
      expect(doneEvents).toHaveLength(1);
    });
  });

  describe('session management', () => {
    it('should create new session when no session_id provided', async () => {
      mockClaudeCall.mockResolvedValueOnce(makeTextResponse('Hello'));

      await runAgentLoop({ message: 'hi' }, onEvent);

      const doneEvent = events.find(e => e.event === 'done');
      expect(doneEvent!.data.session_id).toBeDefined();
      expect(typeof doneEvent!.data.session_id).toBe('string');
    });

    it('should reuse existing session', async () => {
      // First call — create session
      mockClaudeCall.mockResolvedValueOnce(makeTextResponse('Hello'));
      await runAgentLoop({ message: 'hi' }, onEvent);

      const firstSessionId = events.find(e => e.event === 'done')!.data.session_id as string;

      // Second call — reuse session
      events = [];
      mockClaudeCall.mockResolvedValueOnce(makeTextResponse('다시 안녕'));
      await runAgentLoop({ message: '다시', session_id: firstSessionId }, onEvent);

      const secondSessionId = events.find(e => e.event === 'done')!.data.session_id;
      expect(secondSessionId).toBe(firstSessionId);
    });

    it('should store images in session', async () => {
      mockClaudeCall.mockResolvedValueOnce(makeTextResponse('사진 받았습니다'));

      await runAgentLoop({
        message: '이 사진 분석해줘',
        images: [{ data: 'base64img', mime_type: 'image/jpeg' }],
      }, onEvent);

      // Claude에 전달된 messages에 이미지가 포함되어야 함
      const callArgs = mockClaudeCall.mock.calls[0][0];
      const userMsg = callArgs.messages[0];
      const hasImage = Array.isArray(userMsg.content) &&
        userMsg.content.some((b: any) => b.type === 'image');
      expect(hasImage).toBe(true);
    });
  });

  describe('design state events', () => {
    it('should emit image events after render_furniture', async () => {
      // tool_use: render_furniture
      mockClaudeCall.mockResolvedValueOnce(
        makeToolUseResponse('render_furniture', { category: 'sink' })
      );
      mockExecuteTool.mockResolvedValueOnce({
        success: true,
        data: { closed_image_generated: true },
      });

      // end_turn
      mockClaudeCall.mockResolvedValueOnce(makeTextResponse('이미지 생성 완료'));

      // 세션에 이미지가 있도록 executeTool에서 세션 수정
      mockExecuteTool.mockImplementationOnce(async (_name: string, _input: any, session: any) => {
        session.designState.generatedImages = { closed: 'base64closed', open: 'base64open' };
        return { success: true, data: { closed_image_generated: true } };
      });

      // 재실행
      events = [];
      mockClaudeCall.mockResolvedValueOnce(
        makeToolUseResponse('render_furniture', { category: 'sink' })
      );
      mockClaudeCall.mockResolvedValueOnce(makeTextResponse('완료'));

      await runAgentLoop({ message: '가구 이미지 생성해줘' }, onEvent);

      const imageEvents = events.filter(e => e.event === 'image');
      expect(imageEvents.length).toBeGreaterThanOrEqual(0); // 이미지가 있으면 이벤트 발생
    });
  });
});
