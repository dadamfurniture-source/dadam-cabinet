// ═══════════════════════════════════════════════════════════════
// Agent Route - POST /api/agent/chat/stream (SSE)
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import { runAgentLoop } from '../agent/orchestrator.js';
import { optionalAuth } from '../middleware/auth.js';
import { agentRateLimit } from '../middleware/rate-limiter.js';
import type { AgentChatRequest, SSEEvent } from '../agent/types.js';

const log = createLogger('route:agent');
const router = Router();

router.post('/api/agent/chat/stream', optionalAuth, agentRateLimit, async (req: Request, res: Response, _next: NextFunction) => {
  const body = req.body as AgentChatRequest;

  if (!body.message || typeof body.message !== 'string') {
    res.status(400).json({ error: 'message 필드가 필요합니다.' });
    return;
  }

  // images 배열 유효성 검증
  if (body.images) {
    if (!Array.isArray(body.images) || body.images.some(
      (img) => !img || typeof img.data !== 'string' || typeof img.mime_type !== 'string'
    )) {
      res.status(400).json({ error: 'images는 { data: string, mime_type: string }[] 형식이어야 합니다.' });
      return;
    }
  }

  // SSE 헤더 설정
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // 안전한 SSE 쓰기 함수 — writableEnded로 상태 체크
  const sendSSE = (event: SSEEvent) => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    } catch {
      // 클라이언트 연결 끊김 무시
    }
  };

  try {
    log.info({
      sessionId: body.session_id,
      messageLength: body.message.length,
      imageCount: body.images?.length || 0,
    }, 'Agent chat stream started');

    await runAgentLoop(body, sendSSE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message }, 'Agent route error');
    sendSSE({ event: 'error', data: { message } });
    sendSSE({ event: 'done', data: { session_id: body.session_id } });
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
});

// 세션 상태 조회 (디버깅용)
router.get('/api/agent/sessions', (_req: Request, res: Response) => {
  import('../agent/session-store.js').then(({ getSessionCount }) => {
    res.json({ active_sessions: getSessionCount() });
  });
});

export default router;
