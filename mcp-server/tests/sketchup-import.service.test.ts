// ═══════════════════════════════════════════════════════════════
// sketchup-import.service 단위 테스트 — Si-1
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:net';
import { fetchSketchupEntities } from '../src/services/sketchup-import.service.js';
import { RUBY_COMMANDS } from '../src/constants/sketchup.js';

// ─────────────────────────────────────────────────────────────────
// mock mhyrr — eval_ruby DUMP_ENTITIES 응답 시뮬레이션
// ─────────────────────────────────────────────────────────────────

interface MockServer {
  server: Server;
  port: number;
  receivedCodes: string[];
  close(): Promise<void>;
}

async function startMockMhyrr(jsonResponse: string): Promise<MockServer> {
  const receivedCodes: string[] = [];
  const server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const idx = buffer.indexOf('\n');
      if (idx === -1) return;
      const line = buffer.slice(0, idx);
      try {
        const req = JSON.parse(line);
        const code = req.params?.arguments?.code ?? '';
        receivedCodes.push(code);
        const resp = {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'text', text: jsonResponse }],
            isError: false,
            success: true,
            resourceId: null,
          },
        };
        socket.write(JSON.stringify(resp) + '\n');
      } catch {
        socket.destroy();
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        server,
        port,
        receivedCodes,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

let activeServers: MockServer[] = [];

afterEach(async () => {
  for (const s of activeServers) await s.close();
  activeServers = [];
});

// ─────────────────────────────────────────────────────────────────
// 정상 케이스
// ─────────────────────────────────────────────────────────────────

describe('fetchSketchupEntities', () => {
  it('mhyrr 응답 정상 → entities + count 반환', async () => {
    const dump = JSON.stringify([
      {
        id: 12345,
        name: 'dadam.sink.body-1',
        type: 'group',
        bounds: { min: [0, 0, 150], max: [800, 600, 870] },
        transformation: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
        material_name: 'dadam_cream_body',
      },
      {
        id: 12346,
        name: 'dadam.sink.door-1',
        type: 'group',
        bounds: { min: [0, 582, 150], max: [800, 600, 870] },
        transformation: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
        material_name: 'dadam_cream_accent',
      },
    ]);
    const tcp = await startMockMhyrr(dump);
    activeServers.push(tcp);

    const result = await fetchSketchupEntities({ host: '127.0.0.1', port: tcp.port, timeoutMs: 3000 });

    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.entities).toHaveLength(2);
    expect(result.entities![0].name).toBe('dadam.sink.body-1');
    expect(result.entities![0].bounds.min).toEqual([0, 0, 150]);
    expect(result.entities![1].material_name).toBe('dadam_cream_accent');

    // mhyrr 가 받은 Ruby 코드가 DUMP_ENTITIES 와 일치
    expect(tcp.receivedCodes[0]).toBe(RUBY_COMMANDS.DUMP_ENTITIES);
  });

  it('빈 active_model — entities=[] count=0', async () => {
    const tcp = await startMockMhyrr('[]');
    activeServers.push(tcp);

    const result = await fetchSketchupEntities({ host: '127.0.0.1', port: tcp.port, timeoutMs: 3000 });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
    expect(result.entities).toEqual([]);
  });

  it('invalid JSON 응답 → ok=false', async () => {
    const tcp = await startMockMhyrr('not a json');
    activeServers.push(tcp);

    const result = await fetchSketchupEntities({ host: '127.0.0.1', port: tcp.port, timeoutMs: 3000 });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/parse|JSON/i);
  });

  it('mhyrr 응답이 배열이 아니면 ok=false', async () => {
    const tcp = await startMockMhyrr('{"oops":1}');
    activeServers.push(tcp);

    const result = await fetchSketchupEntities({ host: '127.0.0.1', port: tcp.port, timeoutMs: 3000 });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('not an array');
  });

  it('mhyrr unreachable → ok=false (port 1)', async () => {
    const result = await fetchSketchupEntities({ host: '127.0.0.1', port: 1, timeoutMs: 200 });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────
// DUMP_ENTITIES Ruby 코드 자체 검증
// ─────────────────────────────────────────────────────────────────

describe('RUBY_COMMANDS.DUMP_ENTITIES', () => {
  it('동적 입력 보간 없음 (고정 string, eval_ruby allowlist 안전)', () => {
    const code = RUBY_COMMANDS.DUMP_ENTITIES;
    expect(code).toContain('Sketchup.active_model');
    expect(code).toContain('to_json');
    // ${...} 또는 #{...} 가 없어야 (외부 입력 없음)
    expect(code).not.toMatch(/#\{[^}]*\}/);
    expect(code).not.toMatch(/\$\{[^}]*\}/);
  });

  it('주요 필드 (id, name, type, bounds, transformation, material_name) 포함', () => {
    const code = RUBY_COMMANDS.DUMP_ENTITIES;
    expect(code).toContain(':id');
    expect(code).toContain(':name');
    expect(code).toContain(':type');
    expect(code).toContain(':bounds');
    expect(code).toContain(':transformation');
    expect(code).toContain(':material_name');
  });

  it('mm 변환 (inch * 25.4) 포함', () => {
    const code = RUBY_COMMANDS.DUMP_ENTITIES;
    expect(code).toContain('25.4');
  });
});
