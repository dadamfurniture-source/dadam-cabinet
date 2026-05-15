// ═══════════════════════════════════════════════════════════════
// SketchUp MCP Bridge — mhyrr/sketchup-mcp 와 TCP 통신
//
// 프로토콜 (mhyrr src/sketchup_mcp/server.py 분석 결과):
//   - TCP, JSON-RPC 2.0
//   - Wire format: JSON.stringify(request) + '\n'  (newline-delimited)
//   - method: "tools/call"
//   - params: { name: <tool>, arguments: {...} }
//   - response: { jsonrpc, id, result?, error? }
//   - 기본 포트 9876, 디자이너 PC 의 SketchUp 확장이 listen
//
// W2 변경:
//   - sendBatch 가 단일 TCP 연결을 재사용하여 N 개 명령 순차 전송 (이전: 매 명령마다
//     새 연결 → mhyrr accept 오버헤드 + 부분 빌드 위험)
//   - 트랜잭션 실패 감지 시 자동 abort_operation 호출 (autoAbortOnFailure 옵션)
// ═══════════════════════════════════════════════════════════════

import { createConnection, type Socket } from 'node:net';
import {
  MHYRR_DEFAULT_HOST,
  MHYRR_DEFAULT_PORT,
  MHYRR_RECEIVE_TIMEOUT_MS,
  MHYRR_TOOLS,
} from '../constants/sketchup.js';
import { evalRubySafe, type BuildCommand } from './sketchup-builder.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('sketchup-bridge');

// ───────────────────────────────────────────────────────────────
// 타입
// ───────────────────────────────────────────────────────────────

export interface BridgeOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
}

export interface BridgeResult {
  ok: boolean;
  result?: unknown;
  error?: { code?: number; message: string };
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: 'tools/call';
  params: { name: string; arguments: Record<string, unknown> };
}

interface JsonRpcResponse {
  jsonrpc?: '2.0';
  id?: number;
  result?: unknown;
  error?: { code?: number; message: string };
}

// ───────────────────────────────────────────────────────────────
// 단일 명령 전송 (단발 호출용 — 매번 새 연결)
// ───────────────────────────────────────────────────────────────

let nextRequestId = 1;

/**
 * 단일 BuildCommand 를 SketchUp 확장에 전송하고 결과를 받는다.
 *
 * 단발 호출 (테스트, 헬스체크) 시에만 사용. 다중 명령은 sendBatch 를 통해
 * 한 연결을 재사용하라.
 */
export async function sendCommand(
  command: BuildCommand,
  options: BridgeOptions = {},
): Promise<BridgeResult> {
  const host = options.host ?? MHYRR_DEFAULT_HOST;
  const port = options.port ?? MHYRR_DEFAULT_PORT;
  const timeoutMs = options.timeoutMs ?? MHYRR_RECEIVE_TIMEOUT_MS;

  return new Promise<BridgeResult>((resolve) => {
    const sock: Socket = createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    let settled = false;

    const settle = (r: BridgeResult) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(r);
    };

    const timer = setTimeout(() => {
      settle({ ok: false, error: { message: `SketchUp bridge timeout after ${timeoutMs}ms` } });
    }, timeoutMs);

    sock.once('connect', () => {
      const req: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: nextRequestId++,
        method: 'tools/call',
        params: { name: command.tool, arguments: command.arguments },
      };
      sock.write(JSON.stringify(req) + '\n');
    });

    sock.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const newlineIdx = buffer.indexOf(0x0a);
      if (newlineIdx === -1) {
        try {
          const parsed = JSON.parse(buffer.toString('utf8')) as JsonRpcResponse;
          clearTimeout(timer);
          if (parsed.error) {
            settle({ ok: false, error: parsed.error });
          } else {
            settle({ ok: true, result: parsed.result });
          }
        } catch {
          // 아직 미완성 — 계속 대기.
        }
        return;
      }

      const firstLine = buffer.subarray(0, newlineIdx).toString('utf8');
      try {
        const parsed = JSON.parse(firstLine) as JsonRpcResponse;
        clearTimeout(timer);
        if (parsed.error) {
          settle({ ok: false, error: parsed.error });
        } else {
          settle({ ok: true, result: parsed.result });
        }
      } catch (e) {
        clearTimeout(timer);
        const msg = e instanceof Error ? e.message : String(e);
        settle({
          ok: false,
          error: { message: `Invalid JSON line from SketchUp bridge: ${msg}` },
        });
      }
    });

    sock.once('error', (err) => {
      clearTimeout(timer);
      settle({ ok: false, error: { message: `SketchUp bridge socket error: ${err.message}` } });
    });

    sock.once('close', () => {
      clearTimeout(timer);
      if (!settled) {
        const trimmed = buffer.toString('utf8').replace(/\n$/, '');
        try {
          const parsed = JSON.parse(trimmed) as JsonRpcResponse;
          if (parsed.error) {
            settle({ ok: false, error: parsed.error });
          } else {
            settle({ ok: true, result: parsed.result });
          }
        } catch {
          settle({
            ok: false,
            error: { message: 'SketchUp bridge: connection closed before JSON response' },
          });
        }
      }
    });
  });
}

// ───────────────────────────────────────────────────────────────
// 영구 연결 (W2) — 한 소켓에서 N 개 명령 순차 처리
// ───────────────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (r: BridgeResult) => void;
  // 단일 명령 타임아웃 — 응답이 안 오면 발동되어 connection 을 닫는다.
  timer: NodeJS.Timeout;
}

/**
 * 단일 TCP 연결을 캡슐화. 한 명령 = 한 응답 모델을 strict 하게 유지하기 위해
 * 큐 (head-of-line) 방식. mhyrr 가 명령 별로 ID 매칭을 보장하지 않으므로
 * 순차 처리가 안전하다.
 */
class PersistentConnection {
  private sock: Socket;
  private buffer = Buffer.alloc(0);
  private queue: PendingRequest[] = [];
  private closed = false;
  private connectPromise: Promise<void>;
  private timeoutMs: number;
  // M3 (W3): 인스턴스별 JSON-RPC request id 카운터.
  // W2 까지는 모듈 전역 nextRequestId 를 공유했으나, 두 진입점 (sendCommand, PersistentConnection)
  // 사이 id 공간을 격리하기 위해 클래스 필드로 분리. mhyrr 는 id 매칭하지 않으므로 호환.
  private nextRequestId = 1;
  // M4 (W3): dispatchLine 큐가 빌 때 발생하는 미매칭 응답 카운터 — destroy 시 메트릭에 포함.
  private unmatchedResponseCount = 0;

  constructor(host: string, port: number, timeoutMs: number) {
    this.timeoutMs = timeoutMs;
    this.sock = createConnection({ host, port });
    this.sock.on('data', (chunk) => this.onData(chunk));
    this.sock.once('error', (err) => this.onSocketError(err));
    this.sock.once('close', () => this.onClose());

    this.connectPromise = new Promise((resolve, reject) => {
      this.sock.once('connect', () => resolve());
      this.sock.once('error', (err) => reject(err));
    });
  }

  /** 연결 확립을 기다린다. createConnection 직후 즉시 send 호출되어도 안전. */
  async ready(): Promise<void> {
    await this.connectPromise;
  }

  /** 명령 전송 — head-of-line 순서로 응답을 분배한다. */
  async send(command: BuildCommand): Promise<BridgeResult> {
    if (this.closed) {
      return { ok: false, error: { message: 'SketchUp bridge: connection closed' } };
    }

    return new Promise<BridgeResult>((resolve) => {
      const timer = setTimeout(() => {
        // 타임아웃 — 큐에서 꺼내 실패 처리, 연결도 끊는다 (응답 분배 정합성).
        const idx = this.queue.findIndex((p) => p.timer === timer);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        resolve({ ok: false, error: { message: `SketchUp bridge timeout after ${this.timeoutMs}ms` } });
        this.destroy();
      }, this.timeoutMs);

      this.queue.push({ resolve, timer });

      const req: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: this.nextRequestId++,
        method: 'tools/call',
        params: { name: command.tool, arguments: command.arguments },
      };
      this.sock.write(JSON.stringify(req) + '\n');
    });
  }

  /** 미매칭 응답 카운터 (M4) — sendBatch 메트릭 로깅에서 읽는다. */
  getUnmatchedResponseCount(): number {
    return this.unmatchedResponseCount;
  }

  /** 연결을 명시적으로 닫는다. 큐에 남은 요청은 모두 실패 처리. */
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.queue) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: { message: 'SketchUp bridge: connection destroyed' } });
    }
    this.queue = [];
    this.sock.destroy();
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // newline 으로 분리된 모든 완성된 JSON 라인을 head-of-line 순서대로 처리.
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf(0x0a)) !== -1) {
      const line = this.buffer.subarray(0, newlineIdx).toString('utf8');
      this.buffer = this.buffer.subarray(newlineIdx + 1);
      if (line.length === 0) continue;
      this.dispatchLine(line);
    }
  }

  private dispatchLine(line: string): void {
    const pending = this.queue.shift();
    if (!pending) {
      // M4 (W3): 큐가 빈 상태에서 도착한 응답 — mhyrr 의 비동기 알림 또는 프로토콜 드리프트.
      // W2 까지는 silent drop 이었으나 진단 가시성을 위해 debug 로그 + 카운터 누적.
      // 응답 본문은 200자 truncate (PII / 폭주 방지).
      this.unmatchedResponseCount++;
      log.debug(
        { line: line.slice(0, 200), unmatched: this.unmatchedResponseCount },
        'unmatched bridge response — queue empty',
      );
      return;
    }
    clearTimeout(pending.timer);
    try {
      const parsed = JSON.parse(line) as JsonRpcResponse;
      if (parsed.error) {
        pending.resolve({ ok: false, error: parsed.error });
      } else {
        pending.resolve({ ok: true, result: parsed.result });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pending.resolve({
        ok: false,
        error: { message: `Invalid JSON line from SketchUp bridge: ${msg}` },
      });
    }
  }

  private onSocketError(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.queue) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: { message: `SketchUp bridge socket error: ${err.message}` } });
    }
    this.queue = [];
    this.sock.destroy();
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    // 마지막 응답이 newline 없이 끝났을 수도 있어 한 번 더 시도.
    const trimmed = this.buffer.toString('utf8').replace(/\n$/, '');
    if (trimmed.length > 0) {
      this.dispatchLine(trimmed);
      this.buffer = Buffer.alloc(0);
    }
    for (const p of this.queue) {
      clearTimeout(p.timer);
      p.resolve({
        ok: false,
        error: { message: 'SketchUp bridge: connection closed before response' },
      });
    }
    this.queue = [];
  }
}

// ───────────────────────────────────────────────────────────────
// 배치 전송 (W2 — 단일 연결 재사용 + 자동 ABORT)
// ───────────────────────────────────────────────────────────────

export interface BatchOptions extends BridgeOptions {
  /**
   * true (기본값) 면 명령 실패 시 트랜잭션을 abort_operation 으로 롤백한다.
   * buildPlanFromParts(transactional=true) 산출물과 짝을 이룸 — 빌더가
   * START_OP/COMMIT_OP 로 감싸지 않으면 ABORT 도 의미 없음.
   */
  autoAbortOnFailure?: boolean;
  /**
   * true 면 첫 실패에서 멈춘다 (이후 명령 미전송). false 면 모든 명령을
   * 끝까지 시도. 기본값 true — 트랜잭션 모드에서 부분 빌드 방지.
   */
  stopOnFirstFailure?: boolean;
  /**
   * FR-06 (W3): 배치 종료 시 구조화 메트릭 info 로그를 남길지. 기본값 true.
   * 라우트가 자체 로그를 남기는 경우 false 로 끈다.
   */
  emitMetrics?: boolean;
}

/**
 * FR-03 (W3): sendBatch 진행률 콜백. SSE 라우트가 명령별 이벤트를
 * 송신하기 위한 진입점. 미지정이면 W2 동작과 동일.
 */
export interface SendBatchProgress {
  onSent?: (index: number, command: BuildCommand) => void;
  onResult?: (index: number, result: BridgeResult, durationMs: number) => void;
}

export interface BatchResult {
  totalSent: number;
  successCount: number;
  failures: Array<{ index: number; error: { message: string } }>;
  durationMs: number;
  /** autoAbortOnFailure 트리거되어 abort_operation 까지 보냈는지. */
  aborted: boolean;
  /**
   * FR-06 (W3): 성공한 명령들의 평균 왕복시간 (ms). 성공이 0건이면 0.
   * ABORT_OP / 실패 명령은 평균에서 제외 — 정상 빌드 RTT 만 측정.
   */
  averageRttMs: number;
  /** M4 (W3): 배치 동안 PersistentConnection 에서 발생한 미매칭 응답 수. */
  unmatchedResponses: number;
}

/**
 * BuildCommand[] 를 단일 TCP 연결로 순차 전송.
 *
 * W2 개선:
 *   - 한 소켓 재사용 → mhyrr accept 오버헤드 제거 (수십 ms 절감 / 명령)
 *   - 실패 감지 시 즉시 abort_operation 호출하여 부분 빌드 방지
 *   - stopOnFirstFailure=true (기본) 로 트랜잭션 정합성 우선
 *
 * W3 개선:
 *   - FR-03: progress 콜백으로 명령별 onSent/onResult 이벤트 노출 (SSE 라우트용)
 *   - FR-06: averageRttMs / unmatchedResponses 메트릭 + emitMetrics info 로그
 */
export async function sendBatch(
  commands: BuildCommand[],
  options: BatchOptions = {},
  progress?: SendBatchProgress,
): Promise<BatchResult> {
  const host = options.host ?? MHYRR_DEFAULT_HOST;
  const port = options.port ?? MHYRR_DEFAULT_PORT;
  const timeoutMs = options.timeoutMs ?? MHYRR_RECEIVE_TIMEOUT_MS;
  const autoAbort = options.autoAbortOnFailure ?? true;
  const stopOnFirstFailure = options.stopOnFirstFailure ?? true;
  const emitMetrics = options.emitMetrics ?? true;

  const start = Date.now();
  const failures: BatchResult['failures'] = [];
  const rttSamples: number[] = []; // 성공 명령 RTT 만 수집 (ABORT/실패 제외)
  let successCount = 0;
  let aborted = false;
  let totalSent = 0;
  let unmatchedResponses = 0;

  const buildEmptyResult = (): BatchResult => ({
    totalSent: 0,
    successCount: 0,
    failures: [],
    durationMs: 0,
    aborted: false,
    averageRttMs: 0,
    unmatchedResponses: 0,
  });

  if (commands.length === 0) {
    return buildEmptyResult();
  }

  const conn = new PersistentConnection(host, port, timeoutMs);

  try {
    try {
      await conn.ready();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const failedResult: BatchResult = {
        totalSent: 0,
        successCount: 0,
        failures: [{ index: -1, error: { message: `SketchUp bridge connect failed: ${msg}` } }],
        durationMs: Date.now() - start,
        aborted: false,
        averageRttMs: 0,
        unmatchedResponses: 0,
      };
      if (emitMetrics) {
        log.warn(
          {
            event: 'sketchup_connect_failed',
            host,
            port,
            errorMessage: msg,
            durationMs: failedResult.durationMs,
          },
          'sketchup bridge connect failed',
        );
      }
      return failedResult;
    }

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      if (!cmd) continue;
      totalSent++;
      progress?.onSent?.(i, cmd);
      const commandStart = Date.now();
      const result = await conn.send(cmd);
      const commandDuration = Date.now() - commandStart;
      progress?.onResult?.(i, result, commandDuration);

      if (result.ok) {
        successCount++;
        rttSamples.push(commandDuration);
      } else {
        failures.push({
          index: i,
          error: result.error ?? { message: 'unknown error' },
        });

        if (autoAbort) {
          // ABORT 는 best-effort — 결과 무시. 같은 연결로 보낸다.
          // evalRubySafe 를 거쳐 RUBY_COMMANDS allowlist 게이트웨이 일관성 유지.
          await conn.send(evalRubySafe('ABORT_OP'));
          aborted = true;
        }

        if (stopOnFirstFailure) {
          break;
        }
      }
    }
  } finally {
    unmatchedResponses = conn.getUnmatchedResponseCount();
    conn.destroy();
  }

  const durationMs = Date.now() - start;
  const averageRttMs =
    rttSamples.length > 0
      ? Math.round(rttSamples.reduce((sum, v) => sum + v, 0) / rttSamples.length)
      : 0;

  if (emitMetrics) {
    log.info(
      {
        event: 'sketchup_batch_complete',
        totalSent,
        successCount,
        failureCount: failures.length,
        durationMs,
        averageRttMs,
        aborted,
        unmatchedResponses,
      },
      'sketchup batch complete',
    );
  }

  return {
    totalSent,
    successCount,
    failures,
    durationMs,
    aborted,
    averageRttMs,
    unmatchedResponses,
  };
}

// ───────────────────────────────────────────────────────────────
// 헬스체크
// ───────────────────────────────────────────────────────────────

/**
 * SketchUp 확장이 떠 있고 응답하는지 확인.
 * get_scene_info 를 호출하면 가벼운 응답이 돌아온다.
 */
export async function pingSketchup(options: BridgeOptions = {}): Promise<BridgeResult> {
  return sendCommand(
    { tool: MHYRR_TOOLS.GET_SCENE_INFO, arguments: {} },
    { ...options, timeoutMs: options.timeoutMs ?? 3000 },
  );
}
