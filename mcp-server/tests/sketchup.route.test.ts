// W3-2: sketchup.route HTTP 통합 테스트 — supertest 미설치 환경이라
// node 내장 http + fetch 로 직접 호출. auth 미들웨어는 vi.mock 으로 통과 stub.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createServer as createTcp, type Server as TcpServer, type Socket } from 'node:net';
import { AddressInfo } from 'node:net';
import express from 'express';
import { resetRateLimit } from '../src/middleware/rate-limiter.js';

// ─────────────────────────────────────────────────────────────────
// auth.middleware mock — JWT 검증 우회
// ─────────────────────────────────────────────────────────────────

vi.mock('../src/middleware/auth.js', async () => {
  const { AuthenticationError } = await import('../src/utils/errors.js');
  return {
    requireAuth: (req: any, _res: any, next: any) => {
      const auth = req.headers?.authorization;
      if (!auth || !auth.startsWith('Bearer ')) {
        next(new AuthenticationError('Authentication required'));
        return;
      }
      req.user = { id: 'test-user', email: 't@example.com', role: 'authenticated' };
      next();
    },
    optionalAuth: (req: any, _res: any, next: any) => next(),
  };
});

// auth.middleware 를 mock 한 뒤에야 라우터를 import 해야 한다.
import sketchupRoute from '../src/routes/sketchup.route.js';
import { errorHandler } from '../src/middleware/error-handler.js';

// ─────────────────────────────────────────────────────────────────
// 모의 mhyrr TCP 서버 (W3-1 패턴 재사용)
// ─────────────────────────────────────────────────────────────────

interface TcpMockOptions {
  responsesByTool: Record<string, Array<{ ok: boolean; message?: string }>>;
}

interface TcpMock {
  port: number;
  receivedTools: string[];
  close: () => Promise<void>;
}

async function startTcpMock(opts: TcpMockOptions): Promise<TcpMock> {
  const receivedTools: string[] = [];
  const sockets = new Set<Socket>();
  const queues: Record<string, Array<{ ok: boolean; message?: string }>> = {};
  for (const [tool, scenarios] of Object.entries(opts.responsesByTool)) {
    queues[tool] = [...scenarios];
  }

  const server: TcpServer = createTcp((sock) => {
    sockets.add(sock);
    let buffer = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let idx: number;
      while ((idx = buffer.indexOf(0x0a)) !== -1) {
        const line = buffer.subarray(0, idx).toString('utf8');
        buffer = buffer.subarray(idx + 1);
        if (!line) continue;
        try {
          const req = JSON.parse(line) as {
            id: number;
            params: { name: string; arguments: Record<string, unknown> };
          };
          receivedTools.push(req.params.name);
          const scenario = queues[req.params.name]?.shift() ?? { ok: true };
          const response = scenario.ok
            ? { jsonrpc: '2.0', id: req.id, result: { ok: true } }
            : { jsonrpc: '2.0', id: req.id, error: { code: -32000, message: scenario.message ?? 'mock failure' } };
          sock.write(JSON.stringify(response) + '\n');
        } catch {}
      }
    });
    sock.on('error', () => {});
    sock.on('close', () => sockets.delete(sock));
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve(addr.port);
    });
  });

  return {
    port,
    receivedTools,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

// ─────────────────────────────────────────────────────────────────
// 테스트 Express 앱 — 라우터 + errorHandler 만 등록
// ─────────────────────────────────────────────────────────────────

let httpServer: Server;
let httpBase: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(sketchupRoute);
  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    httpServer = createServer(app);
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address() as AddressInfo;
      httpBase = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

beforeEach(() => {
  // 라우트별 rate limit 카운터를 격리해야 테스트 순서/누적 영향 없음
  resetRateLimit('sketchup');
});

// ─────────────────────────────────────────────────────────────────
// 픽스처
// ─────────────────────────────────────────────────────────────────

function makeBuildBody(overrides: Record<string, unknown> = {}) {
  return {
    parts: [
      {
        id: 'b1',
        label: 'body',
        x: 0, y: 0, z: 0,
        width: 600, height: 720, depth: 600,
        colorKey: 'body',
      },
    ],
    category: 'sink',
    materialTone: 'cream',
    transactional: false, // 테스트는 단순 시나리오 — start/commit 노이즈 없이
    clearExisting: false,
    ...overrides,
  };
}

const authHeaders = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };

// ─────────────────────────────────────────────────────────────────
// GET /api/sketchup/ping
// ─────────────────────────────────────────────────────────────────

describe('GET /api/sketchup/ping', () => {
  it('mhyrr 응답 시 200 + rttMs', async () => {
    const tcp = await startTcpMock({ responsesByTool: { get_scene_info: [{ ok: true }] } });
    try {
      const res = await fetch(`${httpBase}/api/sketchup/ping?host=127.0.0.1&port=${tcp.port}`, {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.port).toBe(tcp.port);
      expect(typeof json.rttMs).toBe('number');
    } finally {
      await tcp.close();
    }
  });

  it('mhyrr 다운 시 503', async () => {
    const res = await fetch(`${httpBase}/api/sketchup/ping?host=127.0.0.1&port=1&timeoutMs=200`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it('JWT 누락 → 401', async () => {
    const res = await fetch(`${httpBase}/api/sketchup/ping`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/sketchup/build — HAPPY
// ─────────────────────────────────────────────────────────────────

describe('POST /api/sketchup/build', () => {
  it('HAPPY: 1 컴포넌트 빌드 성공 → 200 + summary', async () => {
    const tcp = await startTcpMock({
      responsesByTool: {
        get_scene_info: [{ ok: true }], // ping
        create_component: [{ ok: true }],
      },
    });
    try {
      const res = await fetch(`${httpBase}/api/sketchup/build`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(makeBuildBody({ host: '127.0.0.1', port: tcp.port })),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.componentCount).toBe(1);
      expect(json.summary.successCount).toBe(1);
      expect(json.summary.failures).toEqual([]);
      expect(json.summary.aborted).toBe(false);
      expect(tcp.receivedTools).toEqual(['get_scene_info', 'create_component']);
    } finally {
      await tcp.close();
    }
  });

  it('AUTH: JWT 누락 → 401', async () => {
    const res = await fetch(`${httpBase}/api/sketchup/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBuildBody()),
    });
    expect(res.status).toBe(401);
  });

  it('INVALID: parts=[] → 400 VALIDATION_ERROR', async () => {
    const res = await fetch(`${httpBase}/api/sketchup/build`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(makeBuildBody({ parts: [] })),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  it('INVALID: category 가 enum 외 → 400', async () => {
    const res = await fetch(`${httpBase}/api/sketchup/build`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(makeBuildBody({ category: 'invalid_cat' })),
    });
    expect(res.status).toBe(400);
  });

  it('UNAVAILABLE: mhyrr 다운 → 503 SKETCHUP_UNAVAILABLE', async () => {
    // ping 만 fail — port 1 은 거의 확실히 연결 실패
    const res = await fetch(`${httpBase}/api/sketchup/build`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(makeBuildBody({ host: '127.0.0.1', port: 1, timeoutMs: 200 })),
    });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe('SKETCHUP_UNAVAILABLE');
  });

  it('BUILD_FAILED: ping 통과하지만 빌드 명령 실패 → 502', async () => {
    const tcp = await startTcpMock({
      responsesByTool: {
        get_scene_info: [{ ok: true }],
        create_component: [{ ok: false, message: 'duplicate name' }],
      },
    });
    try {
      const res = await fetch(`${httpBase}/api/sketchup/build`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(makeBuildBody({ host: '127.0.0.1', port: tcp.port })),
      });
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.code).toBe('SKETCHUP_BUILD_FAILED');
      expect(json.error).toContain('duplicate name');
    } finally {
      await tcp.close();
    }
  });

  it('ping=false 면 사전 ping 건너뛰고 바로 빌드', async () => {
    const tcp = await startTcpMock({
      responsesByTool: { create_component: [{ ok: true }] },
    });
    try {
      const res = await fetch(`${httpBase}/api/sketchup/build`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(makeBuildBody({ host: '127.0.0.1', port: tcp.port, ping: false })),
      });
      expect(res.status).toBe(200);
      expect(tcp.receivedTools).toEqual(['create_component']); // ping 호출 없음
    } finally {
      await tcp.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// Rate limit (다른 describe 의 카운트와 격리 — 마지막에 실행)
// ─────────────────────────────────────────────────────────────────

describe('POST /api/sketchup/build — rate limit', () => {
  it('5/min 초과 시 429 RATE_LIMIT', async () => {
    const tcp = await startTcpMock({
      responsesByTool: {
        get_scene_info: Array.from({ length: 10 }, () => ({ ok: true })),
        create_component: Array.from({ length: 10 }, () => ({ ok: true })),
      },
    });
    try {
      const body = JSON.stringify(makeBuildBody({ host: '127.0.0.1', port: tcp.port }));
      // 이전 테스트들이 이미 카운터를 일부 소모했을 수 있으므로 충분히 많이 호출
      let sawTooMany = false;
      let lastStatus = 0;
      for (let i = 0; i < 12; i++) {
        const res = await fetch(`${httpBase}/api/sketchup/build`, {
          method: 'POST',
          headers: authHeaders,
          body,
        });
        lastStatus = res.status;
        await res.json().catch(() => null);
        if (res.status === 429) {
          sawTooMany = true;
          break;
        }
      }
      expect(sawTooMany).toBe(true);
      expect(lastStatus).toBe(429);
    } finally {
      await tcp.close();
    }
  });
});
