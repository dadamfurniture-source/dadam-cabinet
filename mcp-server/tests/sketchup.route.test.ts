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
  /** W3-3 SSE 테스트용 — 응답 전 인위적 지연 (ms). 클라이언트 단절 검증에 사용. */
  delayMs?: number;
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
          if (opts.delayMs && opts.delayMs > 0) {
            setTimeout(() => sock.write(JSON.stringify(response) + '\n'), opts.delayMs);
          } else {
            sock.write(JSON.stringify(response) + '\n');
          }
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
    // W4-5c: 기본값 true 됐지만 라우트 단순 검증은 옵션 false 로 노이즈 제거
    applyRotation: false,
    applyMaterial: false,
    autoZoom: false,
    applyEntityNames: false,
    ...overrides,
  };
}

const authHeaders = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };

// ─────────────────────────────────────────────────────────────────
// GET /api/sketchup/ping
// ─────────────────────────────────────────────────────────────────

describe('GET /api/sketchup/ping', () => {
  it('mhyrr 응답 시 200 + rttMs', async () => {
    const tcp = await startTcpMock({ responsesByTool: { get_selection: [{ ok: true }] } });
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
        get_selection: [{ ok: true }], // ping
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
      expect(tcp.receivedTools).toEqual(['get_selection', 'create_component']);
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
        get_selection: [{ ok: true }],
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
        get_selection: Array.from({ length: 10 }, () => ({ ok: true })),
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

// ─────────────────────────────────────────────────────────────────
// W3-3: POST /api/sketchup/build/stream — SSE
// ─────────────────────────────────────────────────────────────────

interface SSEFrame {
  event: string;
  data: any;
}

/**
 * fetch 의 Response.body 를 읽어 SSE 프레임 배열로 파싱한다.
 * 스트림이 끝나거나 client 가 reader.cancel() 할 때까지 누적.
 */
async function readAllSSE(res: Response): Promise<SSEFrame[]> {
  const frames: SSEFrame[] = [];
  const decoder = new TextDecoder();
  const reader = res.body!.getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // 프레임 분리자: 빈 줄 (\n\n)
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const lines = block.split('\n');
      let event = '';
      let dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
      }
      if (event) {
        const dataStr = dataLines.join('\n');
        let data: any = dataStr;
        try { data = JSON.parse(dataStr); } catch {}
        frames.push({ event, data });
      }
    }
  }
  return frames;
}

describe('POST /api/sketchup/build/stream (SSE)', () => {
  it('HAPPY: 1 컴포넌트 빌드 → build_started → command_sent/ack → complete', async () => {
    const tcp = await startTcpMock({
      responsesByTool: {
        get_selection: [{ ok: true }],
        create_component: [{ ok: true }],
      },
    });
    try {
      const res = await fetch(`${httpBase}/api/sketchup/build/stream`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(makeBuildBody({ host: '127.0.0.1', port: tcp.port })),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const frames = await readAllSSE(res);
      const eventNames = frames.map((f) => f.event);
      expect(eventNames[0]).toBe('build_started');
      expect(eventNames).toContain('command_sent');
      expect(eventNames).toContain('command_ack');
      expect(eventNames[eventNames.length - 1]).toBe('complete');

      const complete = frames.find((f) => f.event === 'complete')!;
      expect(complete.data.successCount).toBe(1);
      expect(complete.data.aborted).toBe(false);
    } finally {
      await tcp.close();
    }
  });

  it('AUTH: JWT 누락 → 401 (SSE 시작 전)', async () => {
    const res = await fetch(`${httpBase}/api/sketchup/build/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBuildBody()),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type') || '').not.toContain('text/event-stream');
    // body drain
    await res.json().catch(() => null);
  });

  it('INVALID: parts=[] → 400 (SSE 시작 전)', async () => {
    const res = await fetch(`${httpBase}/api/sketchup/build/stream`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(makeBuildBody({ parts: [] })),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  it('UNAVAILABLE: mhyrr 다운 → SSE error 이벤트 (SKETCHUP_UNAVAILABLE)', async () => {
    const res = await fetch(`${httpBase}/api/sketchup/build/stream`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(makeBuildBody({ host: '127.0.0.1', port: 1, timeoutMs: 200 })),
    });
    expect(res.status).toBe(200); // SSE 시작은 OK
    const frames = await readAllSSE(res);
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe('error');
    expect(frames[0].data.code).toBe('SKETCHUP_UNAVAILABLE');
  });

  it('BUILD_FAILED (transactional): aborted 이벤트 + complete.aborted=true + ABORT_OP 전송', async () => {
    const tcp = await startTcpMock({
      responsesByTool: {
        get_selection: [{ ok: true }],
        create_component: [{ ok: true }, { ok: false, message: 'duplicate' }],
        eval_ruby: [{ ok: true }, { ok: true }, { ok: true }], // START, ABORT, ... (transactional)
      },
    });
    try {
      const res = await fetch(`${httpBase}/api/sketchup/build/stream`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(
          makeBuildBody({
            host: '127.0.0.1',
            port: tcp.port,
            transactional: true,
            parts: [
              { id: 'a', label: 'a', x: 0, y: 0, z: 0, width: 100, height: 100, depth: 100, colorKey: 'body' },
              { id: 'b', label: 'b', x: 0, y: 0, z: 0, width: 100, height: 100, depth: 100, colorKey: 'body' },
            ],
          }),
        ),
      });
      expect(res.status).toBe(200);
      const frames = await readAllSSE(res);
      const events = frames.map((f) => f.event);
      expect(events).toContain('aborted');
      const complete = frames.find((f) => f.event === 'complete')!;
      expect(complete.data.aborted).toBe(true);
      // mhyrr 측에 ABORT_OP 도달 확인
      expect(tcp.receivedTools).toContain('eval_ruby');
    } finally {
      await tcp.close();
    }
  });

  it('CLIENT_DISCONNECT: 클라이언트 abort → 서버가 ABORT_OP 전송 후 종료', async () => {
    // 응답을 천천히 보내서 abort 시점을 잡을 시간 확보
    const tcp = await startTcpMock({
      responsesByTool: {
        get_selection: [{ ok: true }],
        create_component: [{ ok: true }, { ok: true }, { ok: true }],
        eval_ruby: [{ ok: true }, { ok: true }, { ok: true }, { ok: true }], // START + ABORT 등
      },
      delayMs: 100,
    });
    try {
      const ac = new AbortController();
      const fetchPromise = fetch(`${httpBase}/api/sketchup/build/stream`, {
        method: 'POST',
        headers: authHeaders,
        signal: ac.signal,
        body: JSON.stringify(
          makeBuildBody({
            host: '127.0.0.1',
            port: tcp.port,
            transactional: true,
            parts: [
              { id: 'p1', label: 'p1', x: 0, y: 0, z: 0, width: 100, height: 100, depth: 100, colorKey: 'body' },
              { id: 'p2', label: 'p2', x: 0, y: 0, z: 0, width: 100, height: 100, depth: 100, colorKey: 'body' },
              { id: 'p3', label: 'p3', x: 0, y: 0, z: 0, width: 100, height: 100, depth: 100, colorKey: 'body' },
            ],
          }),
        ),
      });

      // 200ms 안에 abort — ping(100) + START_OP(100) 무렵
      await new Promise((r) => setTimeout(r, 250));
      ac.abort();

      await fetchPromise.catch(() => null);
      // 서버가 abort 처리 + ABORT_OP 발사를 완료할 시간
      await new Promise((r) => setTimeout(r, 500));

      // mhyrr 측에서 ABORT_OP (eval_ruby) 호출이 도달했어야 함
      const evalRubyCount = tcp.receivedTools.filter((t) => t === 'eval_ruby').length;
      // START_OP 1회 + ABORT_OP 1회 = 최소 2회
      expect(evalRubyCount).toBeGreaterThanOrEqual(2);
    } finally {
      await tcp.close();
    }
  });
});
