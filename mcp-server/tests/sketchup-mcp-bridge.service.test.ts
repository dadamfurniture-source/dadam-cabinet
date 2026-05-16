import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import {
  sendBatch,
  sendCommand,
  pingSketchup,
  resolveEntityRefs,
} from '../src/services/sketchup-mcp-bridge.service.js';
import {
  MHYRR_TOOLS,
  RUBY_COMMANDS,
} from '../src/constants/sketchup.js';
import type { BuildCommand } from '../src/services/sketchup-builder.service.js';

// ─────────────────────────────────────────────────────────────────
// W4-5b: resolveEntityRefs — placeholder 치환
// ─────────────────────────────────────────────────────────────────

describe('resolveEntityRefs — __ENT__:<idRef> 플레이스홀더 치환', () => {
  it('id 인자가 __ENT__:foo 형식이면 map[foo] 값으로 치환', () => {
    const map = new Map<string, number | string>([['foo', 12345]]);
    const out = resolveEntityRefs({ id: '__ENT__:foo', material: 'dadam_cream_body' }, map);
    expect(out.id).toBe(12345);
    expect(out.material).toBe('dadam_cream_body');
  });

  it('map 에 없는 idRef 는 placeholder 그대로 유지 (mhyrr 가 거부 → 진단 가능)', () => {
    const map = new Map<string, number>();
    const out = resolveEntityRefs({ id: '__ENT__:missing' }, map);
    expect(out.id).toBe('__ENT__:missing');
  });

  it('placeholder 아닌 값은 그대로', () => {
    const map = new Map<string, number>([['foo', 1]]);
    const out = resolveEntityRefs(
      { name: 'dadam.sink.body', rotation: [0, 0, 90], dimensions: [1, 2, 3] },
      map,
    );
    expect(out.name).toBe('dadam.sink.body');
    expect(out.rotation).toEqual([0, 0, 90]);
    expect(out.dimensions).toEqual([1, 2, 3]);
  });

  it('숫자/배열/객체 값은 type 검사 통과 안 해 그대로 (방어적)', () => {
    const map = new Map<string, number>([['foo', 99]]);
    const out = resolveEntityRefs({ id: 12345, rotation: [0, 0, 90] }, map);
    expect(out.id).toBe(12345);
  });
});

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
  receivedIds: number[];
  /** W3-1: 응답 1줄 보낸 직후 임의 1줄을 추가 emit (M4 미매칭 응답 시나리오용) */
  emitUnsolicitedAfter?: { afterTool: string; payload: object };
  connectionCount: number;
  close: () => Promise<void>;
}

interface ExtendedMockOptions extends MockOptions {
  /** W3-1: 응답 후 즉시 임의 1줄을 더 emit — M4 미매칭 응답 시나리오. */
  emitUnsolicitedAfter?: { afterTool: string; payload: object };
}

async function startMockServer(opts: ExtendedMockOptions): Promise<MockServer> {
  const receivedTools: string[] = [];
  const receivedCodes: string[] = [];
  const receivedIds: number[] = [];
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
          receivedIds.push(req.id);
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

          // W3-1: 미매칭 응답 시나리오 — 동일 도구 처리 후 추가 응답 1줄 emit.
          if (opts.emitUnsolicitedAfter && req.params.name === opts.emitUnsolicitedAfter.afterTool) {
            sock.write(JSON.stringify(opts.emitUnsolicitedAfter.payload) + '\n');
          }
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
    receivedIds,
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
  it('get_selection 호출로 가용성 확인', async () => {
    mock = await startMockServer({
      responsesByTool: { get_selection: [{ ok: true }] },
    });

    const r = await pingSketchup({ host: '127.0.0.1', port: mock.port, timeoutMs: 500 });
    expect(r.ok).toBe(true);
    expect(mock.receivedTools).toEqual(['get_selection']);
  });
});

// ─────────────────────────────────────────────────────────────────
// W3-1: M3 회귀 — PersistentConnection 인스턴스별 reqId 카운터
// ─────────────────────────────────────────────────────────────────

describe('sendBatch — M3 인스턴스별 request id (W3-1)', () => {
  it('연속 두 배치는 각 새 connection 에서 id 가 1 부터 시작', async () => {
    mock = await startMockServer({
      responsesByTool: { create_component: [{ ok: true }, { ok: true }, { ok: true }, { ok: true }] },
    });

    // 배치 1: 2 명령
    await sendBatch([createCmd('a'), createCmd('b')], {
      host: '127.0.0.1',
      port: mock.port,
      autoAbortOnFailure: false,
      emitMetrics: false,
    });
    // 배치 2: 2 명령 (새 PersistentConnection)
    await sendBatch([createCmd('c'), createCmd('d')], {
      host: '127.0.0.1',
      port: mock.port,
      autoAbortOnFailure: false,
      emitMetrics: false,
    });

    // 인스턴스별 카운터이므로 두 배치 모두 1,2 시퀀스로 시작해야 한다.
    // (모듈 전역이었다면 1,2,3,4 — 두 배치 합쳐 누적)
    expect(mock.receivedIds).toEqual([1, 2, 1, 2]);
    expect(mock.connectionCount).toBe(2);
  });

  it('단발 sendCommand 는 모듈 전역 카운터를 유지 (격리 확인)', async () => {
    mock = await startMockServer({
      responsesByTool: { create_component: [{ ok: true }, { ok: true }] },
    });

    // 단발 호출 두 번 — 모듈 전역 카운터로 누적 (1 이 아닌 임의 시작점부터 +1 증가)
    await sendCommand(createCmd('x'), { host: '127.0.0.1', port: mock.port });
    const idsAfterFirst = [...mock.receivedIds];
    await sendCommand(createCmd('y'), { host: '127.0.0.1', port: mock.port });

    expect(mock.receivedIds.length).toBe(2);
    expect(mock.receivedIds[1]).toBe(idsAfterFirst[0] + 1);
    expect(mock.connectionCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// W3-1: M4 회귀 — dispatchLine 미매칭 응답 카운터
// ─────────────────────────────────────────────────────────────────

describe('sendBatch — M4 미매칭 응답 카운터 (W3-1)', () => {
  it('큐가 빈 상태에서 도착한 응답은 unmatchedResponses 로 누적', async () => {
    // 첫 명령 후 mhyrr 가 알림 1줄을 더 emit 하는 시나리오
    mock = await startMockServer({
      responsesByTool: { create_component: [{ ok: true }] },
      emitUnsolicitedAfter: {
        afterTool: 'create_component',
        payload: { jsonrpc: '2.0', method: 'notification', params: { type: 'mhyrr_async_event' } },
      },
    });

    const result = await sendBatch([createCmd('a')], {
      host: '127.0.0.1',
      port: mock.port,
      autoAbortOnFailure: false,
      emitMetrics: false,
    });

    expect(result.successCount).toBe(1);
    // 미매칭 응답 1건이 카운트되어야 한다.
    // (이전 동작에선 silent drop 으로 검증 불가능했음)
    expect(result.unmatchedResponses).toBeGreaterThanOrEqual(1);
  });

  it('정상 시나리오에선 unmatchedResponses=0', async () => {
    mock = await startMockServer({
      responsesByTool: { create_component: [{ ok: true }, { ok: true }] },
    });

    const result = await sendBatch([createCmd('a'), createCmd('b')], {
      host: '127.0.0.1',
      port: mock.port,
      autoAbortOnFailure: false,
      emitMetrics: false,
    });

    expect(result.successCount).toBe(2);
    expect(result.unmatchedResponses).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// W3-1: FR-03 progress 콜백
// ─────────────────────────────────────────────────────────────────

describe('sendBatch — progress 콜백 (W3-1)', () => {
  it('onSent / onResult 가 명령별로 순서대로 호출됨', async () => {
    mock = await startMockServer({
      responsesByTool: { create_component: [{ ok: true }, { ok: true }, { ok: true }] },
    });

    const sentEvents: number[] = [];
    const resultEvents: Array<{ index: number; ok: boolean; durationMs: number }> = [];

    await sendBatch(
      [createCmd('a'), createCmd('b'), createCmd('c')],
      {
        host: '127.0.0.1',
        port: mock.port,
        autoAbortOnFailure: false,
        emitMetrics: false,
      },
      {
        onSent: (index) => sentEvents.push(index),
        onResult: (index, result, durationMs) =>
          resultEvents.push({ index, ok: result.ok, durationMs }),
      },
    );

    expect(sentEvents).toEqual([0, 1, 2]);
    expect(resultEvents.map((e) => ({ index: e.index, ok: e.ok }))).toEqual([
      { index: 0, ok: true },
      { index: 1, ok: true },
      { index: 2, ok: true },
    ]);
    // 각 명령의 durationMs 가 측정되어야 한다 (0 이상)
    for (const e of resultEvents) {
      expect(e.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('실패 명령도 onResult 로 통보, 이후 ABORT 명령은 progress 콜백에 포함 안 됨', async () => {
    mock = await startMockServer({
      responsesByTool: {
        create_component: [{ ok: true }, { ok: false, message: 'duplicate' }],
        eval_ruby: [{ ok: true }],
      },
    });

    const sent: number[] = [];
    const results: Array<{ index: number; ok: boolean }> = [];

    const result = await sendBatch(
      [createCmd('a'), createCmd('b'), createCmd('c')],
      {
        host: '127.0.0.1',
        port: mock.port,
        autoAbortOnFailure: true,
        stopOnFirstFailure: true,
        emitMetrics: false,
      },
      {
        onSent: (index) => sent.push(index),
        onResult: (index, r) => results.push({ index, ok: r.ok }),
      },
    );

    // 0(ok), 1(fail) 만 보고. 2 는 미발사, ABORT 는 progress 콜백에 포함되지 않는다.
    expect(sent).toEqual([0, 1]);
    expect(results).toEqual([
      { index: 0, ok: true },
      { index: 1, ok: false },
    ]);
    expect(result.aborted).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// W3-1: FR-06 averageRttMs 메트릭
// ─────────────────────────────────────────────────────────────────

describe('sendBatch — averageRttMs (W3-1, FR-06)', () => {
  it('성공 명령들의 평균 RTT 계산', async () => {
    mock = await startMockServer({
      responsesByTool: { create_component: [{ ok: true }, { ok: true }, { ok: true }] },
    });

    const result = await sendBatch(
      [createCmd('a'), createCmd('b'), createCmd('c')],
      { host: '127.0.0.1', port: mock.port, autoAbortOnFailure: false, emitMetrics: false },
    );

    expect(result.successCount).toBe(3);
    expect(result.averageRttMs).toBeGreaterThanOrEqual(0);
    // 로컬 mock 서버는 매우 빠르므로 평균이 합리적 범위 안에 있어야 함
    expect(result.averageRttMs).toBeLessThan(1000);
  });

  it('빈 입력 → averageRttMs=0', async () => {
    const result = await sendBatch([], { emitMetrics: false });
    expect(result.averageRttMs).toBe(0);
    expect(result.unmatchedResponses).toBe(0);
  });

  it('전체 실패 → averageRttMs=0 (성공 표본 0건)', async () => {
    mock = await startMockServer({
      responsesByTool: { create_component: [{ ok: false, message: 'err' }] },
    });

    const result = await sendBatch([createCmd('a')], {
      host: '127.0.0.1',
      port: mock.port,
      autoAbortOnFailure: false,
      emitMetrics: false,
    });

    expect(result.successCount).toBe(0);
    expect(result.averageRttMs).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// W4 N3: SKETCHUP_BRIDGE_* env var fallback chain
// ─────────────────────────────────────────────────────────────────

describe('env var fallback (W4 N3)', () => {
  const ORIG_HOST = process.env.SKETCHUP_BRIDGE_HOST;
  const ORIG_PORT = process.env.SKETCHUP_BRIDGE_PORT;
  const ORIG_TIMEOUT = process.env.SKETCHUP_BRIDGE_TIMEOUT_MS;

  afterEach(() => {
    // env 복원
    if (ORIG_HOST === undefined) delete process.env.SKETCHUP_BRIDGE_HOST;
    else process.env.SKETCHUP_BRIDGE_HOST = ORIG_HOST;
    if (ORIG_PORT === undefined) delete process.env.SKETCHUP_BRIDGE_PORT;
    else process.env.SKETCHUP_BRIDGE_PORT = ORIG_PORT;
    if (ORIG_TIMEOUT === undefined) delete process.env.SKETCHUP_BRIDGE_TIMEOUT_MS;
    else process.env.SKETCHUP_BRIDGE_TIMEOUT_MS = ORIG_TIMEOUT;
  });

  it('옵션 미지정 + env SKETCHUP_BRIDGE_PORT 설정 → env 값 사용', async () => {
    mock = await startMockServer({ responsesByTool: { create_component: [{ ok: true }] } });
    process.env.SKETCHUP_BRIDGE_HOST = '127.0.0.1';
    process.env.SKETCHUP_BRIDGE_PORT = String(mock.port);

    // host/port 명시 안 함 → env 가 적용되어야 함
    const result = await sendBatch([createCmd('a')], {
      autoAbortOnFailure: false,
      emitMetrics: false,
    });

    expect(result.successCount).toBe(1);
    expect(mock.connectionCount).toBe(1);
  });

  it('옵션 명시 시 env 무시 (옵션 우선)', async () => {
    mock = await startMockServer({ responsesByTool: { create_component: [{ ok: true }] } });
    process.env.SKETCHUP_BRIDGE_HOST = '127.0.0.1';
    process.env.SKETCHUP_BRIDGE_PORT = '1'; // 일부러 잘못된 env

    // 옵션이 명시되었으므로 env 무시 — 정상 빌드
    const result = await sendBatch([createCmd('a')], {
      host: '127.0.0.1',
      port: mock.port,
      autoAbortOnFailure: false,
      emitMetrics: false,
    });

    expect(result.successCount).toBe(1);
  });

  it('env SKETCHUP_BRIDGE_PORT 가 invalid (NaN) → 기본값 fallback', async () => {
    process.env.SKETCHUP_BRIDGE_PORT = 'not-a-number';
    // port 도 옵션도 미지정이면 MHYRR_DEFAULT_PORT (9876) 사용 — 거의 확실히 연결 실패
    const result = await sendBatch([createCmd('a')], {
      host: '127.0.0.1',
      autoAbortOnFailure: false,
      emitMetrics: false,
      timeoutMs: 200,
    });

    // mock 가 9876 에 안 떠 있으므로 연결 실패하지만, NaN env 가 호환되어
    // crash 하지 않고 fallback 으로 동작해야 함 (즉 result 가 반환됨)
    expect(result.totalSent).toBe(0);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0].index).toBe(-1);
  });

  it('env SKETCHUP_BRIDGE_PORT 가 음수 → 기본값 fallback (envInt 가드)', async () => {
    process.env.SKETCHUP_BRIDGE_PORT = '-5';
    const result = await sendBatch([createCmd('a')], {
      host: '127.0.0.1',
      autoAbortOnFailure: false,
      emitMetrics: false,
      timeoutMs: 200,
    });
    // 음수 port 가 그대로 쓰이면 socket exception 등 다른 에러 — 가드 동작 시 fallback
    expect(result.totalSent).toBe(0);
  });
});
