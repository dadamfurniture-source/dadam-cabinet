import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import {
  sendBatch,
  sendCommand,
  pingSketchup,
} from '../src/services/sketchup-mcp-bridge.service.js';
import {
  MHYRR_TOOLS,
  RUBY_COMMANDS,
} from '../src/constants/sketchup.js';
import type { BuildCommand } from '../src/services/sketchup-builder.service.js';

// ─────────────────────────────────────────────────────────────────
// 모의 mhyrr TCP 서버
// ─────────────────────────────────────────────────────────────────

interface MockOptions {
  /**
   * 명령별 응답 시나리오. tool 이름으로 매칭하고,
   * 동일 도구가 반복 호출되면 큐 순서대로 소비한다.
   */
  responsesByTool: Record<string, Array<{ ok: boolean; message?: string }>>;
}

interface MockServer {
  server: Server;
  port: number;
  receivedTools: string[];
  receivedCodes: string[];
  connectionCount: number;
  close: () => Promise<void>;
}

async function startMockServer(opts: MockOptions): Promise<MockServer> {
  const receivedTools: string[] = [];
  const receivedCodes: string[] = [];
  const sockets = new Set<Socket>();
  let connectionCount = 0;

  // 시나리오 큐 복제 (mutation 안전)
  const queues: Record<string, Array<{ ok: boolean; message?: string }>> = {};
  for (const [tool, scenarios] of Object.entries(opts.responsesByTool)) {
    queues[tool] = [...scenarios];
  }

  const server = createServer((sock) => {
    connectionCount++;
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
          if (typeof req.params.arguments?.code === 'string') {
            receivedCodes.push(req.params.arguments.code);
          }

          const scenario = queues[req.params.name]?.shift() ?? { ok: true };
          const response = scenario.ok
            ? { jsonrpc: '2.0', id: req.id, result: { ok: true } }
            : {
                jsonrpc: '2.0',
                id: req.id,
                error: { code: -32000, message: scenario.message ?? 'mock failure' },
              };
          sock.write(JSON.stringify(response) + '\n');
        } catch {
          // 무시 — 잘못된 JSON 은 응답 없이 종료
        }
      }
    });

    sock.on('error', () => {
      // 클라이언트가 먼저 끊는 경우 무시
    });
    sock.on('close', () => {
      sockets.delete(sock);
    });
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else resolve(0);
    });
  });

  return {
    server,
    port,
    receivedTools,
    receivedCodes,
    get connectionCount() {
      return connectionCount;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

// ─────────────────────────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────────────────────────

let mock: MockServer | undefined;
afterEach(async () => {
  if (mock) {
    await mock.close();
    mock = undefined;
  }
});

function createCmd(name: string): BuildCommand {
  return {
    tool: MHYRR_TOOLS.CREATE_COMPONENT,
    arguments: {
      name,
      position: [0, 0, 0],
      dimensions: [1, 1, 1],
      material: 'dadam_cream_body',
    },
  };
}

describe('sendCommand — 단발 호출', () => {
  it('성공 응답을 ok=true 로 변환', async () => {
    mock = await startMockServer({ responsesByTool: { create_component: [{ ok: true }] } });
    const r = await sendCommand(createCmd('p1'), { host: '127.0.0.1', port: mock.port });
    expect(r.ok).toBe(true);
    expect(mock.receivedTools).toEqual(['create_component']);
  });

  it('에러 응답을 ok=false 로 변환', async () => {
    mock = await startMockServer({
      responsesByTool: { create_component: [{ ok: false, message: 'boom' }] },
    });
    const r = await sendCommand(createCmd('p1'), { host: '127.0.0.1', port: mock.port });
    expect(r.ok).toBe(false);
    expect(r.error?.message).toBe('boom');
  });
});

describe('sendBatch — 단일 연결 재사용 (W2)', () => {
  it('N 개 명령을 한 TCP 연결로 순차 처리', async () => {
    mock = await startMockServer({
      responsesByTool: {
        create_component: [{ ok: true }, { ok: true }, { ok: true }],
      },
    });

    const result = await sendBatch(
      [createCmd('a'), createCmd('b'), createCmd('c')],
      { host: '127.0.0.1', port: mock.port, autoAbortOnFailure: false },
    );

    expect(result.totalSent).toBe(3);
    expect(result.successCount).toBe(3);
    expect(result.failures).toEqual([]);
    expect(mock.connectionCount).toBe(1); // 핵심: W2 — 단일 연결
    expect(mock.receivedTools).toEqual(['create_component', 'create_component', 'create_component']);
  });

  it('빈 배열 → no-op, 연결도 안 만듦', async () => {
    mock = await startMockServer({ responsesByTool: {} });
    const result = await sendBatch([], { host: '127.0.0.1', port: mock.port });
    expect(result.totalSent).toBe(0);
    expect(result.successCount).toBe(0);
    expect(mock.connectionCount).toBe(0);
  });
});

describe('sendBatch — 자동 ABORT (W2)', () => {
  it('실패 시 abort_operation 을 동일 연결로 전송 후 중단', async () => {
    mock = await startMockServer({
      responsesByTool: {
        create_component: [{ ok: true }, { ok: false, message: 'duplicate name' }],
        eval_ruby: [{ ok: true }],
      },
    });

    const result = await sendBatch(
      [createCmd('a'), createCmd('b'), createCmd('c')],
      {
        host: '127.0.0.1',
        port: mock.port,
        autoAbortOnFailure: true,
        stopOnFirstFailure: true,
      },
    );

    expect(result.aborted).toBe(true);
    expect(result.successCount).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].error.message).toBe('duplicate name');
    // 두번째 명령에서 실패하면 세번째는 보내지 않고 ABORT 만 보낸다
    expect(mock.receivedTools).toEqual(['create_component', 'create_component', 'eval_ruby']);
    expect(mock.receivedCodes).toEqual([RUBY_COMMANDS.ABORT_OP]);
    expect(mock.connectionCount).toBe(1); // ABORT 도 같은 연결
  });

  it('autoAbortOnFailure=false 면 ABORT 전송 안 함', async () => {
    mock = await startMockServer({
      responsesByTool: {
        create_component: [{ ok: false, message: 'err' }],
      },
    });

    const result = await sendBatch([createCmd('a')], {
      host: '127.0.0.1',
      port: mock.port,
      autoAbortOnFailure: false,
    });

    expect(result.aborted).toBe(false);
    expect(mock.receivedTools).toEqual(['create_component']);
  });

  it('stopOnFirstFailure=false 면 ABORT 후에도 나머지 명령 안 보냄', async () => {
    // ABORT 가 보내지지만 stopOnFirstFailure=true 가 기본이므로
    // false 로 명시할 때만 이후 명령 전송. ABORT 와 동시에는 부조리하므로
    // false 의 경우 ABORT 자체를 안 보내는 시나리오로 함께 검증.
    mock = await startMockServer({
      responsesByTool: {
        create_component: [
          { ok: true },
          { ok: false, message: 'err' },
          { ok: true },
        ],
      },
    });

    const result = await sendBatch(
      [createCmd('a'), createCmd('b'), createCmd('c')],
      {
        host: '127.0.0.1',
        port: mock.port,
        autoAbortOnFailure: false,
        stopOnFirstFailure: false,
      },
    );

    expect(result.totalSent).toBe(3);
    expect(result.successCount).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(mock.receivedTools).toEqual(['create_component', 'create_component', 'create_component']);
  });
});

describe('sendBatch — 연결 실패 처리', () => {
  it('연결 자체가 실패하면 totalSent=0 + failures[0].index=-1', async () => {
    // 임의 미사용 포트 (서버 미기동)
    const result = await sendBatch([createCmd('a')], {
      host: '127.0.0.1',
      port: 1, // root 권한 없이는 못 띄우는 포트 — 거의 확실히 연결 실패
      timeoutMs: 200,
    });

    expect(result.totalSent).toBe(0);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0].index).toBe(-1);
  });
});

describe('pingSketchup', () => {
  it('get_scene_info 호출로 가용성 확인', async () => {
    mock = await startMockServer({
      responsesByTool: { get_scene_info: [{ ok: true }] },
    });

    const r = await pingSketchup({ host: '127.0.0.1', port: mock.port, timeoutMs: 500 });
    expect(r.ok).toBe(true);
    expect(mock.receivedTools).toEqual(['get_scene_info']);
  });
});
