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
// 단일 BuildCommand 전송 외에도 sendBatch 로 명령 다발을 순차 전송한다.
// 각 명령은 별도 JSON-RPC 요청 (mhyrr 가 배치 미지원).
// ═══════════════════════════════════════════════════════════════

import { createConnection, type Socket } from 'node:net';
import {
  MHYRR_DEFAULT_HOST,
  MHYRR_DEFAULT_PORT,
  MHYRR_RECEIVE_TIMEOUT_MS,
  MHYRR_TOOLS,
} from '../constants/sketchup.js';
import type { BuildCommand } from './sketchup-builder.service.js';

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
// 단일 명령 전송
// ───────────────────────────────────────────────────────────────

let nextRequestId = 1;

/**
 * 단일 BuildCommand 를 SketchUp 확장에 전송하고 결과를 받는다.
 *
 * 새 연결을 매번 만들지 않고 호출자가 sendBatch 를 쓰도록 권장 —
 * 단발 호출 (테스트, 헬스체크) 시에만 사용.
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
      // mhyrr 응답은 newline-delimited JSON (server.py: response + '\n').
      // 두 응답이 한 청크에 합쳐 도착하거나 (W2 연결 재사용 시 발생 가능),
      // 응답이 청크 경계에 걸쳐 도착해도 안전하게 첫 완성된 JSON 라인을 파싱.
      const newlineIdx = buffer.indexOf(0x0a);
      if (newlineIdx === -1) {
        // 아직 newline 미수신 — 다음 청크 대기.
        // 하지만 mhyrr 가 newline 없이 끝낼 수도 있으므로 fallback 으로 전체 파싱 시도.
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
        // 응답이 끝나기 전에 닫혔다 — newline 없는 단일 JSON 으로 마지막 시도.
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
// 배치 전송 (순차)
// ───────────────────────────────────────────────────────────────

export interface BatchResult {
  totalSent: number;
  successCount: number;
  failures: Array<{ index: number; error: { message: string } }>;
  durationMs: number;
}

/**
 * BuildCommand[] 를 순차 전송. 한 명령 실패해도 다음 명령으로 진행하되,
 * 실패 정보는 모아서 반환.
 *
 * 추후 mhyrr 가 batch endpoint 를 제공하면 한 연결에서 묶어 보내도록 최적화 가능.
 */
export async function sendBatch(
  commands: BuildCommand[],
  options: BridgeOptions = {},
): Promise<BatchResult> {
  const start = Date.now();
  const failures: BatchResult['failures'] = [];
  let successCount = 0;

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd) continue;
    const result = await sendCommand(cmd, options);
    if (result.ok) {
      successCount++;
    } else {
      failures.push({
        index: i,
        error: result.error ?? { message: 'unknown error' },
      });
    }
  }

  return {
    totalSent: commands.length,
    successCount,
    failures,
    durationMs: Date.now() - start,
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
