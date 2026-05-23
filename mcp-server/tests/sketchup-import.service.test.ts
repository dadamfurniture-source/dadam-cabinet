// ═══════════════════════════════════════════════════════════════
// sketchup-import.service 단위 테스트 — Si-1
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:net';
import { fetchSketchupEntities, parseEntities, reconstructPlannerData } from '../src/services/sketchup-import.service.js';
import type { SketchupEntityDump } from '../src/services/sketchup-import.service.js';
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

// ─────────────────────────────────────────────────────────────────
// Si-2: parseEntities (entities → CabinetPartV2[])
// ─────────────────────────────────────────────────────────────────

function makeEnt(name: string, opts: Partial<SketchupEntityDump> = {}): SketchupEntityDump {
  return {
    id: opts.id ?? 100,
    name,
    type: opts.type ?? 'group',
    bounds: opts.bounds ?? { min: [0, 0, 0], max: [600, 600, 720] },
    transformation: opts.transformation ?? [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
    material_name: opts.material_name ?? null,
  };
}

describe('parseEntities', () => {
  it('dadam.sink.body-1 outliner name → V2 part 정상 추출', () => {
    const ents = [makeEnt('dadam.sink.body-1', { bounds: { min: [-400, 0, 150], max: [400, 600, 870] } })];
    const result = parseEntities(ents);

    expect(result.parts).toHaveLength(1);
    expect(result.inferredCategory).toBe('sink');
    expect(result.unknownCount).toBe(0);

    const p = result.parts[0];
    expect(p.id).toBe('body-1');
    expect(p.x).toBe(-400);
    expect(p.y).toBe(0);
    expect(p.z).toBe(150);
    expect(p.width).toBe(800);
    expect(p.depth).toBe(600);
    expect(p.height).toBe(720);
  });

  it('dadam 마킹 없는 entity → unknown 으로 분류, parts 미포함', () => {
    const ents = [
      makeEnt('그룹0#1'),
      makeEnt('그룹1#1'),
      makeEnt('dadam.sink.body-1'),
    ];
    const result = parseEntities(ents);
    expect(result.parts).toHaveLength(1);
    expect(result.unknownCount).toBe(2);
    expect(result.parsed.filter((p) => p.partCategory === 'unknown')).toHaveLength(2);
  });

  it('카테고리 다수결 추정 — sink 12개 + storage 1개 → sink', () => {
    const ents = [
      ...Array.from({ length: 12 }, (_, i) => makeEnt(`dadam.sink.b${i}`)),
      makeEnt('dadam.storage.x1'),
    ];
    const result = parseEntities(ents);
    expect(result.inferredCategory).toBe('sink');
  });

  it('구조물 분류: toekick / molding-top / finish-* / countertop', () => {
    const ents = [
      makeEnt('dadam.sink.toekick'),
      makeEnt('dadam.sink.molding-top'),
      makeEnt('dadam.sink.finish-left-lower'),
      makeEnt('dadam.sink.finish-right-upper'),
      makeEnt('dadam.sink.countertop'),
    ];
    const result = parseEntities(ents);
    const structural = result.parsed.filter((p) => p.partCategory === 'structural');
    expect(structural).toHaveLength(5);
  });

  it('유틸리티 분류: utility-distributor / utility-vent', () => {
    const ents = [
      makeEnt('dadam.sink.utility-distributor'),
      makeEnt('dadam.sink.utility-vent'),
    ];
    const result = parseEntities(ents);
    const utility = result.parsed.filter((p) => p.partCategory === 'utility');
    expect(utility).toHaveLength(2);
  });

  it('colorKey 추정: toekick → trim, countertop → shadow, 일반 본체 → body', () => {
    const ents = [
      makeEnt('dadam.sink.toekick'),
      makeEnt('dadam.sink.countertop'),
      makeEnt('dadam.sink.body-1'),
    ];
    const result = parseEntities(ents);
    expect(result.parts[0].colorKey).toBe('trim');
    expect(result.parts[1].colorKey).toBe('shadow');
    expect(result.parts[2].colorKey).toBe('body');
  });

  it('material_name 명시 시 colorKey 추정 우선 (dadam_oak_accent → accent)', () => {
    const ents = [makeEnt('dadam.sink.body-1', { material_name: 'dadam_oak_accent' })];
    const result = parseEntities(ents);
    expect(result.parts[0].colorKey).toBe('accent');
  });

  it('rotationZDeg: identity matrix → undefined (회전 없음)', () => {
    const ents = [makeEnt('dadam.sink.body-1')];
    const result = parseEntities(ents);
    expect(result.parts[0].rotationZDeg).toBeUndefined();
  });

  it('rotationZDeg: 90° Z rotation matrix → 90', () => {
    // Z 90° 회전: m[0]=cos(90)=0, m[1]=sin(90)=1
    const ents = [makeEnt('dadam.sink.sec-1', {
      transformation: [0,1,0,0,  -1,0,0,0,  0,0,1,0,  0,0,0,1],
    })];
    const result = parseEntities(ents);
    expect(result.parts[0].rotationZDeg).toBeCloseTo(90, 1);
  });

  it('rotationZDeg: -90° Z rotation → -90', () => {
    const ents = [makeEnt('dadam.sink.sec-1', {
      transformation: [0,-1,0,0,  1,0,0,0,  0,0,1,0,  0,0,0,1],
    })];
    const result = parseEntities(ents);
    expect(result.parts[0].rotationZDeg).toBeCloseTo(-90, 1);
  });

  it('빈 entities → 빈 결과', () => {
    const result = parseEntities([]);
    expect(result.parts).toEqual([]);
    expect(result.parsed).toEqual([]);
    expect(result.inferredCategory).toBeNull();
    expect(result.unknownCount).toBe(0);
  });

  it('실제 last-build-request 시나리오: 19 entities → 18 parts (마지막 1개는 unknown)', () => {
    // 6 lower + 5 upper + 5 structural + 2 utility = 18 dadam + 1 unknown = 19 entities
    const ents = [
      ...Array.from({ length: 6 }, (_, i) => makeEnt(`dadam.sink.body-${i}`, { id: 100 + i, bounds: { min: [i * 700, 0, 150], max: [(i + 1) * 700, 600, 870] } })),
      ...Array.from({ length: 5 }, (_, i) => makeEnt(`dadam.sink.upper-${i}`, { id: 200 + i, bounds: { min: [i * 800, 0, 1530], max: [(i + 1) * 800, 295, 2250] } })),
      makeEnt('dadam.sink.toekick', { id: 300, bounds: { min: [0, 0, 0], max: [4080, 610, 150] } }),
      makeEnt('dadam.sink.molding-top', { id: 301, bounds: { min: [0, 0, 2250], max: [4200, 301, 2310] } }),
      makeEnt('dadam.sink.countertop', { id: 302, bounds: { min: [0, 0, 870], max: [4200, 650, 882] } }),
      makeEnt('dadam.sink.finish-left-lower', { id: 303, bounds: { min: [-60, 0, 0], max: [0, 650, 870] } }),
      makeEnt('dadam.sink.finish-right-lower', { id: 304, bounds: { min: [4080, 0, 0], max: [4140, 650, 870] } }),
      makeEnt('dadam.sink.utility-distributor', { id: 305, bounds: { min: [-600, -100, 150], max: [100, -60, 230] } }),
      makeEnt('dadam.sink.utility-vent', { id: 306, bounds: { min: [650, -100, 2180], max: [850, -60, 2260] } }),
      makeEnt('그룹0#1', { id: 999 }), // dadam 마킹 안 됨 (외부 또는 sink-hitl 잔여)
    ];
    const result = parseEntities(ents);

    expect(result.parts).toHaveLength(18);
    expect(result.inferredCategory).toBe('sink');
    expect(result.unknownCount).toBe(1);

    // 모듈 / 구조물 / 유틸 카운트
    const modules = result.parsed.filter((p) => p.partCategory === 'module');
    const structural = result.parsed.filter((p) => p.partCategory === 'structural');
    const utility = result.parsed.filter((p) => p.partCategory === 'utility');
    expect(modules).toHaveLength(11); // 6 lower + 5 upper
    expect(structural).toHaveLength(5); // toekick + molding + countertop + 2 finish
    expect(utility).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// Si-3: reconstructPlannerData (V2 parts → PlannerState 역추적)
// ─────────────────────────────────────────────────────────────────

describe('reconstructPlannerData', () => {
  function makeRealEnts() {
    return [
      // 하부장 본체 6개 (z=150~870)
      ...Array.from({ length: 6 }, (_, i) => makeEnt(`dadam.sink.body-${i}`, {
        id: 100 + i,
        bounds: { min: [i * 700, 0, 150], max: [(i + 1) * 700, 600, 870] },
      })),
      // 상부장 본체 5개 (z=1530~2250)
      ...Array.from({ length: 5 }, (_, i) => makeEnt(`dadam.sink.upper-${i}`, {
        id: 200 + i,
        bounds: { min: [i * 800, 0, 1530], max: [(i + 1) * 800, 295, 2250] },
      })),
      // 구조물
      makeEnt('dadam.sink.toekick', { id: 300, bounds: { min: [0, 0, 0], max: [4080, 610, 150] } }),
      makeEnt('dadam.sink.molding-top', { id: 301, bounds: { min: [0, 0, 2250], max: [4200, 301, 2310] } }),
      makeEnt('dadam.sink.countertop', { id: 302, bounds: { min: [0, 0, 870], max: [4200, 650, 882] }, material_name: 'dadam_cream_shadow' }),
      makeEnt('dadam.sink.finish-left-lower', { id: 303, bounds: { min: [-60, 0, 0], max: [0, 650, 870] } }),
      makeEnt('dadam.sink.finish-right-lower', { id: 304, bounds: { min: [4080, 0, 0], max: [4140, 650, 870] } }),
      makeEnt('dadam.sink.utility-distributor', { id: 305, bounds: { min: [-600, -100, 150], max: [100, -60, 230] } }),
      makeEnt('dadam.sink.utility-vent', { id: 306, bounds: { min: [650, -100, 2180], max: [850, -60, 2260] } }),
    ];
  }

  it('실 sink 가구 (I자) — 모든 측정값 정확', () => {
    const ents = makeRealEnts();
    const parsed = parseEntities(ents).parsed;
    const data = reconstructPlannerData(parsed)!;

    expect(data.category).toBe('sink');
    expect(data.layoutShape).toBe('I');
    expect(data.width).toBe(4200);
    expect(data.height).toBe(2310);
    expect(data.toeKickH).toBe(150);
    expect(data.moldingH).toBe(60);
    expect(data.finishLeftW).toBe(60);
    expect(data.finishRightW).toBe(60);
    expect(data.lowerCount).toBe(6);
    expect(data.upperCount).toBe(5);
    expect(data.material).toBe('cream');
    expect(data.confidence).toBeGreaterThan(0.7);
  });

  it('유틸리티 위치 측정', () => {
    const ents = makeRealEnts();
    const parsed = parseEntities(ents).parsed;
    const data = reconstructPlannerData(parsed)!;
    expect(data.distributorStart).toBe(-600);
    expect(data.distributorEnd).toBe(100);
    expect(data.ventStart).toBe(650);
  });

  it('material_name 명시 (cream 다수) → material=cream', () => {
    const ents = [
      makeEnt('dadam.sink.b1', { material_name: 'dadam_oak_body' }),
      makeEnt('dadam.sink.b2', { material_name: 'dadam_oak_body' }),
      makeEnt('dadam.sink.b3', { material_name: 'dadam_oak_body' }),
      makeEnt('dadam.sink.b4', { material_name: 'dadam_cream_body' }),
    ];
    const parsed = parseEntities(ents).parsed;
    const data = reconstructPlannerData(parsed)!;
    expect(data.material).toBe('oak'); // 다수결
  });

  it('material_name 모두 null → default cream', () => {
    const ents = [makeEnt('dadam.sink.b1')];
    const parsed = parseEntities(ents).parsed;
    const data = reconstructPlannerData(parsed)!;
    expect(data.material).toBe('cream');
  });

  it('dadam.* 마킹 0개 → null 반환 (외부 자료, Phase 3a/3b 대상)', () => {
    const ents = [makeEnt('그룹0#1'), makeEnt('그룹1#1')];
    const parsed = parseEntities(ents).parsed;
    const data = reconstructPlannerData(parsed);
    expect(data).toBeNull();
  });

  it('L자 가구 (y 위치 2개 클러스터) → layoutShape=L + warning', () => {
    const ents = [
      // 주선 (y=0)
      ...Array.from({ length: 3 }, (_, i) => makeEnt(`dadam.sink.b${i}`, {
        bounds: { min: [i * 600, 0, 150], max: [(i + 1) * 600, 600, 870] },
      })),
      // 차선 (y=1000 — 깊이축 다름)
      ...Array.from({ length: 2 }, (_, i) => makeEnt(`dadam.sink.sec-${i}`, {
        bounds: { min: [1800 + i * 600, 1000, 150], max: [2400 + i * 600, 1600, 870] },
      })),
    ];
    const parsed = parseEntities(ents).parsed;
    const data = reconstructPlannerData(parsed)!;
    expect(data.layoutShape).toBe('L');
    expect(data.warnings.some((w) => w.includes('L자'))).toBe(true);
  });

  it('toeKick/molding 부재 시 warning + confidence 감소', () => {
    const ents = [makeEnt('dadam.sink.b1')]; // sink 라 wardrobe/shoe/fridge 가 아님
    const parsed = parseEntities(ents).parsed;
    const data = reconstructPlannerData(parsed)!;
    expect(data.toeKickH).toBe(0);
    expect(data.moldingH).toBe(0);
    expect(data.warnings.some((w) => w.includes('걸레받이'))).toBe(true);
    expect(data.warnings.some((w) => w.includes('상몰딩'))).toBe(true);
    expect(data.confidence).toBeLessThan(1.0);
  });

  it('fullHeight preset (wardrobe) — 단일 z 모듈 → lower 만, upper 0', () => {
    const ents = [
      makeEnt('dadam.wardrobe.b0', { bounds: { min: [0, 0, 0], max: [800, 600, 2400] } }),
      makeEnt('dadam.wardrobe.b1', { bounds: { min: [800, 0, 0], max: [1600, 600, 2400] } }),
    ];
    const parsed = parseEntities(ents).parsed;
    const data = reconstructPlannerData(parsed)!;
    expect(data.category).toBe('wardrobe');
    expect(data.lowerCount + data.upperCount).toBe(2);
    // fullHeight 라 모두 lower 로 분류
    expect(data.upperCount).toBe(0);
  });
});

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
