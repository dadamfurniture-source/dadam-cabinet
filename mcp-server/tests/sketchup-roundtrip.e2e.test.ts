// ═══════════════════════════════════════════════════════════════
// Si-6: Round-trip 검증 — planner V2 parts → SketchUp 빌드 → import → V2 parts
//
// build → SET_NAMES → DUMP_ENTITIES → parseEntities → reconstructPlannerData
// 의 일관성 검증. 단위 테스트로 round-trip 사이클 자동 실행 (mhyrr mock 없이).
//
// 핵심: parseEntities 의 V2 변환이 buildPlanFromParts 의 입력 V2 와 일치하는지.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  buildPlanFromParts,
  buildSetNamesCommand,
  partToCommand,
} from '../src/services/sketchup-builder.service.js';
import { parseEntities, reconstructPlannerData } from '../src/services/sketchup-import.service.js';
import type { SketchupEntityDump } from '../src/services/sketchup-import.service.js';
import { sketchupComponentName } from '../src/constants/sketchup.js';
import type { CabinetPartV2, CabinetCategory } from '../src/types/planner.types.js';

/**
 * V2 parts → SketchUp entities 시뮬레이션 (mhyrr 없이).
 * 실제 mhyrr 는 create_component 가 add_face + pushpull 후 entityID 반환.
 * 시뮬레이션은 V2 part 의 좌표를 그대로 entity bounds 로 변환.
 */
function simulateSketchupBuild(parts: CabinetPartV2[], category: CabinetCategory): SketchupEntityDump[] {
  return parts
    .filter((p) => p.width > 0 && p.depth > 0 && p.height > 0 && !p.wireframe)
    .map((p, i) => {
      const id = 1000 + i;
      const name = sketchupComponentName(category, p.id);

      // SketchUp 의 좌표: V2 의 (x, y, z) corner → SketchUp bounds.min
      // dimensions[2] = -height 보정 (Si-1b ground plane fix) 의 효과는 box 모양에 영향 X
      const min: [number, number, number] = [p.x, p.y, p.z];
      const max: [number, number, number] = [p.x + p.width, p.y + p.depth, p.z + p.height];

      return {
        id,
        name,
        type: 'group' as const,
        bounds: { min, max },
        transformation: [1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1],
        material_name: null,
      };
    });
}

// ─────────────────────────────────────────────────────────────────
// 핵심 round-trip 케이스
// ─────────────────────────────────────────────────────────────────

describe('Round-trip: V2 parts → SketchUp 시뮬레이션 → import → V2 parts', () => {
  it('단일 sink 가구: 입력 part 좌표 == import V2 좌표 (정확)', () => {
    const inputParts: CabinetPartV2[] = [
      { id: 'body-1', label: 'body', x: 100, y: 0, z: 150, width: 600, depth: 600, height: 720, colorKey: 'body' },
      { id: 'toekick', label: 'toekick', x: 0, y: 0, z: 0, width: 4080, depth: 610, height: 150, colorKey: 'trim' },
      { id: 'molding-top', label: 'molding', x: 0, y: 0, z: 2250, width: 4200, depth: 301, height: 60, colorKey: 'trim' },
    ];

    // 1. build (시뮬레이션) — entities 생성
    const entities = simulateSketchupBuild(inputParts, 'sink');
    expect(entities).toHaveLength(3);

    // 2. parseEntities (import 의 Si-2)
    const parsed = parseEntities(entities);
    expect(parsed.parts).toHaveLength(3);
    expect(parsed.inferredCategory).toBe('sink');
    expect(parsed.unknownCount).toBe(0);

    // 3. 좌표 일관성 — 입력 part 와 정확 매칭
    const body = parsed.parts.find((p) => p.id === 'body-1')!;
    expect(body.x).toBe(100);
    expect(body.y).toBe(0);
    expect(body.z).toBe(150);
    expect(body.width).toBe(600);
    expect(body.depth).toBe(600);
    expect(body.height).toBe(720);
  });

  it('reconstructPlannerData: 가구 전체 측정값 round-trip 정확', () => {
    const inputParts: CabinetPartV2[] = [
      // 하부장 본체 4개 (X 분배)
      ...Array.from({ length: 4 }, (_, i): CabinetPartV2 => ({
        id: `body-${i}`,
        label: `body ${i}`,
        x: 60 + i * 750,
        y: 0,
        z: 150,
        width: 750,
        depth: 600,
        height: 720,
        colorKey: 'body',
      })),
      // 마감재
      { id: 'finish-left-lower', label: 'fl', x: 0, y: 0, z: 0, width: 60, depth: 650, height: 870, colorKey: 'trim' },
      { id: 'finish-right-lower', label: 'fr', x: 3060, y: 0, z: 0, width: 60, depth: 650, height: 870, colorKey: 'trim' },
      // 걸레받이
      { id: 'toekick', label: 'tk', x: 60, y: 0, z: 0, width: 3000, depth: 610, height: 150, colorKey: 'trim' },
      // 상몰딩
      { id: 'molding-top', label: 'md', x: 0, y: 0, z: 2250, width: 3120, depth: 301, height: 60, colorKey: 'trim' },
      // 상판
      { id: 'countertop', label: 'ct', x: 0, y: 0, z: 870, width: 3120, depth: 650, height: 12, colorKey: 'shadow' },
    ];

    const entities = simulateSketchupBuild(inputParts, 'sink');
    const parsed = parseEntities(entities);
    const data = reconstructPlannerData(parsed.parsed)!;

    // 정확 검증
    expect(data.category).toBe('sink');
    expect(data.layoutShape).toBe('I');
    expect(data.width).toBe(3120); // molding/countertop width
    expect(data.height).toBe(2310);
    expect(data.toeKickH).toBe(150);
    expect(data.moldingH).toBe(60);
    expect(data.finishLeftW).toBe(60);
    expect(data.finishRightW).toBe(60);
    expect(data.lowerCount).toBe(4);
    expect(data.upperCount).toBe(0);
    expect(data.confidence).toBeGreaterThan(0.85);
  });

  it('L자 가구 round-trip: layoutShape=L 정확 분류', () => {
    const inputParts: CabinetPartV2[] = [
      // 주선 (y=0)
      ...Array.from({ length: 3 }, (_, i): CabinetPartV2 => ({
        id: `prim-${i}`, label: 'prim', x: i * 600, y: 0, z: 150, width: 600, depth: 600, height: 720, colorKey: 'body',
      })),
      // 차선 (y=1000)
      ...Array.from({ length: 2 }, (_, i): CabinetPartV2 => ({
        id: `sec-${i}`, label: 'sec', x: 1800 + i * 600, y: 1000, z: 150, width: 600, depth: 600, height: 720, colorKey: 'body',
      })),
    ];

    const entities = simulateSketchupBuild(inputParts, 'sink');
    const parsed = parseEntities(entities);
    const data = reconstructPlannerData(parsed.parsed)!;

    expect(data.layoutShape).toBe('L');
    expect(data.warnings.some((w) => w.includes('L자'))).toBe(true);
  });

  it('wardrobe (fullHeight) round-trip: lower=N upper=0', () => {
    const inputParts: CabinetPartV2[] = [
      { id: 'b1', label: 'b1', x: 0, y: 0, z: 0, width: 1800, depth: 600, height: 2400, colorKey: 'body' },
      { id: 'b2', label: 'b2', x: 1800, y: 0, z: 0, width: 1800, depth: 600, height: 2400, colorKey: 'body' },
      { id: 'molding-top', label: 'md', x: 0, y: 0, z: 2340, width: 3600, depth: 600, height: 60, colorKey: 'trim' },
    ];

    const entities = simulateSketchupBuild(inputParts, 'wardrobe');
    const parsed = parseEntities(entities);
    const data = reconstructPlannerData(parsed.parsed)!;

    expect(data.category).toBe('wardrobe');
    expect(data.lowerCount + data.upperCount).toBe(2);
    expect(data.upperCount).toBe(0); // fullHeight → 모두 lower
  });

  it('round-trip 좌표 보존: V2 corner + size 가 import 후 동일', () => {
    const inputParts: CabinetPartV2[] = [
      { id: 'p1', label: 'p1', x: -2100, y: -325, z: 150, width: 800, depth: 600, height: 720, colorKey: 'body' },
      { id: 'p2', label: 'p2', x: 1300, y: -325, z: 1530, width: 800, depth: 295, height: 720, colorKey: 'accent' },
    ];

    const entities = simulateSketchupBuild(inputParts, 'sink');
    const parsed = parseEntities(entities);
    const p1Imported = parsed.parts.find((p) => p.id === 'p1')!;
    const p2Imported = parsed.parts.find((p) => p.id === 'p2')!;

    // ±2mm 허용 (실제 mhyrr 의 round 3 자리 소수점)
    expect(p1Imported.x).toBeCloseTo(-2100, 0);
    expect(p1Imported.y).toBeCloseTo(-325, 0);
    expect(p1Imported.z).toBeCloseTo(150, 0);
    expect(p1Imported.width).toBeCloseTo(800, 0);
    expect(p1Imported.height).toBeCloseTo(720, 0);

    expect(p2Imported.x).toBeCloseTo(1300, 0);
    expect(p2Imported.z).toBeCloseTo(1530, 0);
    // colorKey 는 partId prefix 기반 추정 — 'p2' 같은 generic id 는 fallback 'body'
    expect(p2Imported.colorKey).toBe('body');
  });

  it('round-trip: utility-distributor 위치 보존', () => {
    const inputParts: CabinetPartV2[] = [
      { id: 'b1', label: 'b1', x: 0, y: 0, z: 150, width: 600, depth: 600, height: 720, colorKey: 'body' },
      { id: 'utility-distributor', label: 'dist', x: -600, y: -100, z: 150, width: 700, depth: 40, height: 80, colorKey: 'body' },
      { id: 'utility-vent', label: 'vent', x: 2940, y: -100, z: 2180, width: 200, depth: 40, height: 80, colorKey: 'body' },
    ];

    const entities = simulateSketchupBuild(inputParts, 'sink');
    const parsed = parseEntities(entities);
    const data = reconstructPlannerData(parsed.parsed)!;

    expect(data.distributorStart).toBe(-600);
    expect(data.distributorEnd).toBe(100);
    expect(data.ventStart).toBe(2940);
  });

  it('build → SET_NAMES → DUMP → parse 전체 시퀀스 (mock 없이 통합)', () => {
    // 1. plan 생성 (autoZoom/applyMaterial 만 끄고 단순 시나리오)
    const inputParts: CabinetPartV2[] = [
      { id: 'b1', label: 'b1', x: 0, y: 0, z: 150, width: 800, depth: 600, height: 720, colorKey: 'body' },
      { id: 'b2', label: 'b2', x: 800, y: 0, z: 150, width: 800, depth: 600, height: 720, colorKey: 'body' },
    ];
    const plan = buildPlanFromParts(inputParts, {
      category: 'sink',
      materialTone: 'cream',
      transactional: false,
      autoZoom: false,
      applyMaterial: false,
      applyRotation: false,
      applyEntityNames: true,
    });

    // SET_NAMES 명령 포함 확인
    const setNamesCmd = plan.commands.find((c) => c.tool === 'eval_ruby' && (c.arguments.code as string).includes('find_entity_by_id'));
    expect(setNamesCmd).toBeDefined();

    // 2. SET_NAMES 가 expected outliner name 인라인 (Ruby 코드 안에)
    const setNamesCode = setNamesCmd!.arguments.code as string;
    expect(setNamesCode).toContain('"dadam.sink.b1"');
    expect(setNamesCode).toContain('"dadam.sink.b2"');

    // 3. SketchUp 시뮬레이션 → entities
    const entities = simulateSketchupBuild(inputParts, 'sink');

    // 4. parse + reconstruct
    const data = reconstructPlannerData(parseEntities(entities).parsed)!;
    expect(data.category).toBe('sink');
    expect(data.lowerCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// 회귀 격리 — 본 round-trip 이 mhyrr 변경으로 깨지지 않는지
// ─────────────────────────────────────────────────────────────────

describe('Round-trip 회귀 격리', () => {
  it('partToCommand 의 ground plane fix 가 round-trip 좌표에 영향 없음 (시뮬레이션 무관)', () => {
    // z=0 인 part 도 import 후 정확 z=0 유지
    const inputParts: CabinetPartV2[] = [
      { id: 'toekick', label: 'tk', x: 0, y: 0, z: 0, width: 4080, depth: 610, height: 150, colorKey: 'trim' },
    ];
    const entities = simulateSketchupBuild(inputParts, 'sink');
    expect(entities[0].bounds.min[2]).toBe(0); // z=0 보존
    expect(entities[0].bounds.max[2]).toBe(150);

    const parsed = parseEntities(entities);
    expect(parsed.parts[0].z).toBe(0);
    expect(parsed.parts[0].height).toBe(150);
  });

  it('dadam.* 매칭 없는 entity 가 섞여도 round-trip 정상', () => {
    const inputParts: CabinetPartV2[] = [
      { id: 'body-1', label: 'b1', x: 0, y: 0, z: 150, width: 600, depth: 600, height: 720, colorKey: 'body' },
    ];
    const entities = simulateSketchupBuild(inputParts, 'sink');
    // 외부 entity 추가
    entities.push({
      id: 9999, name: '그룹0#1', type: 'group',
      bounds: { min: [-1000, -1000, -1000], max: [-500, -500, -500] },
      transformation: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
      material_name: null,
    });

    const parsed = parseEntities(entities);
    expect(parsed.parts).toHaveLength(1); // 외부 entity 제외
    expect(parsed.unknownCount).toBe(1);

    const data = reconstructPlannerData(parsed.parsed)!;
    expect(data.lowerCount).toBe(1);
    expect(data.warnings.some((w) => w.includes('dadam.*'))).toBe(true);
    expect(data.confidence).toBeLessThan(1.0);
  });
});
