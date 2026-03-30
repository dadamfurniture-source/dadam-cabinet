// ═══════════════════════════════════════════════════════════════
// Session Store - Unit Tests
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// session-store는 모듈 레벨 상태(Map)를 가지므로 각 테스트에서 격리
// dynamic import로 처리
let sessionStore: typeof import('../../src/agent/session-store.js');

beforeEach(async () => {
  vi.resetModules();
  sessionStore = await import('../../src/agent/session-store.js');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Session Store', () => {
  describe('createSession', () => {
    it('should create a new session with UUID and empty state', () => {
      const session = sessionStore.createSession();

      expect(session.id).toBeDefined();
      expect(session.id.length).toBe(36); // UUID format
      expect(session.messages).toEqual([]);
      expect(session.designState).toEqual({});
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.lastActiveAt).toBeGreaterThan(0);
    });

    it('should increment session count', () => {
      expect(sessionStore.getSessionCount()).toBe(0);
      sessionStore.createSession();
      expect(sessionStore.getSessionCount()).toBe(1);
      sessionStore.createSession();
      expect(sessionStore.getSessionCount()).toBe(2);
    });
  });

  describe('getSession', () => {
    it('should return existing session and update lastActiveAt', () => {
      const created = sessionStore.createSession();

      const retrieved = sessionStore.getSession(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.lastActiveAt).toBeGreaterThanOrEqual(created.lastActiveAt);
    });

    it('should return undefined for non-existent session', () => {
      const result = sessionStore.getSession('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should return undefined for expired session', () => {
      vi.useFakeTimers();

      const session = sessionStore.createSession();
      const sessionId = session.id;

      // 30분 + 1ms 경과
      vi.advanceTimersByTime(30 * 60 * 1000 + 1);

      const result = sessionStore.getSession(sessionId);
      expect(result).toBeUndefined();

      vi.useRealTimers();
    });
  });

  describe('getOrCreateSession', () => {
    it('should return existing session when valid id provided', () => {
      const original = sessionStore.createSession();
      const result = sessionStore.getOrCreateSession(original.id);
      expect(result.id).toBe(original.id);
    });

    it('should create new session when no id provided', () => {
      const result = sessionStore.getOrCreateSession();
      expect(result.id).toBeDefined();
      expect(sessionStore.getSessionCount()).toBe(1);
    });

    it('should create new session when invalid id provided', () => {
      const result = sessionStore.getOrCreateSession('invalid-id');
      expect(result.id).not.toBe('invalid-id');
      expect(sessionStore.getSessionCount()).toBe(1);
    });
  });

  describe('addMessage', () => {
    it('should add message to session and update lastActiveAt', () => {
      const session = sessionStore.createSession();
      const message = { role: 'user' as const, content: 'hello' };

      sessionStore.addMessage(session.id, message);

      const updated = sessionStore.getSession(session.id);
      expect(updated!.messages).toHaveLength(1);
      expect(updated!.messages[0]).toEqual(message);
    });

    it('should do nothing for non-existent session', () => {
      // should not throw
      sessionStore.addMessage('non-existent', { role: 'user', content: 'hello' });
    });
  });

  describe('updateDesignState', () => {
    it('should merge partial state into designState', () => {
      const session = sessionStore.createSession();

      sessionStore.updateDesignState(session.id, { category: 'sink' as any });
      let updated = sessionStore.getSession(session.id);
      expect(updated!.designState.category).toBe('sink');

      sessionStore.updateDesignState(session.id, { style: 'modern' });
      updated = sessionStore.getSession(session.id);
      expect(updated!.designState.category).toBe('sink');
      expect(updated!.designState.style).toBe('modern');
    });

    it('should do nothing for non-existent session', () => {
      sessionStore.updateDesignState('non-existent', { category: 'sink' as any });
      // should not throw
    });
  });

  describe('setRoomImage', () => {
    it('should set room image on session', () => {
      const session = sessionStore.createSession();

      sessionStore.setRoomImage(session.id, 'base64data', 'image/jpeg');

      const updated = sessionStore.getSession(session.id);
      expect(updated!.roomImage).toBe('base64data');
      expect(updated!.imageType).toBe('image/jpeg');
    });
  });

  describe('deleteSession', () => {
    it('should remove session', () => {
      const session = sessionStore.createSession();
      expect(sessionStore.getSessionCount()).toBe(1);

      sessionStore.deleteSession(session.id);
      expect(sessionStore.getSessionCount()).toBe(0);
      expect(sessionStore.getSession(session.id)).toBeUndefined();
    });
  });
});
