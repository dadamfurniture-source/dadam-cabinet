// ═══════════════════════════════════════════════════════════════
// Session Store - 인메모리 Agent 세션 관리 (TTL 30분)
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger.js';
import type { AgentSession, ClaudeAgentMessage, DesignState } from './types.js';

const log = createLogger('session-store');

const SESSION_TTL_MS = 30 * 60 * 1000; // 30분
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5분마다 정리

const sessions = new Map<string, AgentSession>();

// 주기적 만료 세션 정리
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, session] of sessions) {
    if (now - session.lastActiveAt > SESSION_TTL_MS) {
      sessions.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    log.info({ cleaned, remaining: sessions.size }, 'Expired sessions cleaned');
  }
}, CLEANUP_INTERVAL_MS);

// Node.js 프로세스 종료 시 타이머 정리
cleanupTimer.unref();

export function createSession(): AgentSession {
  const session: AgentSession = {
    id: randomUUID(),
    messages: [],
    designState: {},
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  sessions.set(session.id, session);
  log.info({ sessionId: session.id }, 'Session created');
  return session;
}

export function getSession(id: string): AgentSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;

  // TTL 체크
  if (Date.now() - session.lastActiveAt > SESSION_TTL_MS) {
    sessions.delete(id);
    log.info({ sessionId: id }, 'Session expired');
    return undefined;
  }

  session.lastActiveAt = Date.now();
  return session;
}

export function getOrCreateSession(id?: string): AgentSession {
  if (id) {
    const existing = getSession(id);
    if (existing) return existing;
  }
  return createSession();
}

export function addMessage(sessionId: string, message: ClaudeAgentMessage): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.messages.push(message);
  session.lastActiveAt = Date.now();
}

export function updateDesignState(sessionId: string, partial: Partial<DesignState>): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.designState = { ...session.designState, ...partial };
  session.lastActiveAt = Date.now();
}

export function setRoomImage(sessionId: string, image: string, imageType: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.roomImage = image;
  session.imageType = imageType;
  session.lastActiveAt = Date.now();
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}

export function getSessionCount(): number {
  return sessions.size;
}
