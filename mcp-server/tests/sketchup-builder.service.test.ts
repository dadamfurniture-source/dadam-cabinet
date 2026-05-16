// ═══════════════════════════════════════════════════════════════
// sketchup-builder.service 단위 테스트
//
// W4-4: V1 (Y-up center) 시절의 좌표 변환 검증 케이스 제거.
// 현재는 V2 (Z-up corner mm degrees) 만 받음 — mm→inch 외 좌표 변환 없음.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  buildPlanFromParts,
  evalRubySafe,
  partToCommand,
  partToRotationCommand,
  partToMaterialCommand,
} from '../src/services/sketchup-builder.service.js';
import {
  mmToInch,
  sketchupComponentName,
  sketchupMaterialName,
  MHYRR_TOOLS,
  RUBY_COMMANDS,
} from '../src/constants/sketchup.js';
import type { CabinetPartV2 } from '../src/types/planner.types.js';

// ─────────────────────────────────────────────────────────────────
// 픽스처 (V2: Z-up corner mm degrees)
//   x = corner x (+x extent=width 가로)
//   y = corner y (+y extent=depth 깊이)
//   z = corner z (+z extent=height 수직)
// ─────────────────────────────────────────────────────────────────

function makeBody(id: string, overrides: Partial<CabinetPartV2> = {}): CabinetPartV2 {
  return {
    id,
    label: `body ${id}`,
    x: 0,
    y: 0,
    z: 0,
    width: 600,   // +x
    depth: 600,   // +y
    height: 720,  // +z
    colorKey: 'body',
    ...overrides,
  };
}

function makeDoor(id: string, parentModuleId: string, overrides: Partial<CabinetPartV2> = {}): CabinetPartV2 {
  return {
    id,
    label: `door ${id}`,
    x: 0,
    y: 600 - 18, // 본체 정면 측 (+y 방향) 에서 18mm 두께 도어
    z: 0,
    width: 600,
    depth: 18,
    height: 720,
    colorKey: 'accent',
    isDoor: true,
    parentModuleId,
    doorIndex: 0,
    openDirection: 'left',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// 단위 변환
// ─────────────────────────────────────────────────────────────────

describe('mmToInch', () => {
  it('변환 정밀도 보정 (25.4mm = 1 inch)', () => {
    expect(mmToInch(25.4)).toBeCloseTo(1, 5);
    expect(mmToInch(600)).toBeCloseTo(23.6220472, 5);
    expect(mmToInch(0)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// partToCommand (V2 only)
// ─────────────────────────────────────────────────────────────────

describe('partToCommand', () => {
  it('CabinetPartV2 한 개 → create_component 한 개', () => {
    const part = makeBody('body-1', { x: 0, y: 0, z: 0 });
    const cmd = partToCommand(part, 'sink', 'cream');

    expect(cmd).not.toBeNull();
    expect(cmd!.tool).toBe(MHYRR_TOOLS.CREATE_COMPONENT);
    expect(cmd!.arguments.name).toBe(sketchupComponentName('sink', 'body-1'));
    expect(cmd!.arguments.material).toBe(sketchupMaterialName('cream', 'body'));
    expect(cmd!.arguments.type).toBe('cube');
  });

  it('mm → inch 변환만 (V2 는 이미 SketchUp 네이티브 좌표)', () => {
    const part = makeBody('p', {
      x: 100, y: 200, z: 300,
      width: 800, depth: 600, height: 720,
    });
    const cmd = partToCommand(part, 'sink', 'cream')!;
    const pos = cmd.arguments.position as number[];
    const dim = cmd.arguments.dimensions as number[];

    // V2 corner 그대로 mm→inch
    expect(pos[0]).toBeCloseTo(mmToInch(100), 5);
    expect(pos[1]).toBeCloseTo(mmToInch(200), 5);
    expect(pos[2]).toBeCloseTo(mmToInch(300), 5);
    expect(dim[0]).toBeCloseTo(mmToInch(800), 5);
    expect(dim[1]).toBeCloseTo(mmToInch(600), 5);
    expect(dim[2]).toBeCloseTo(mmToInch(720), 5);
  });

  it('원점 (0,0,0) corner: position = (0,0,0)', () => {
    const part = makeBody('p', { x: 0, y: 0, z: 0, width: 600, depth: 600, height: 720 });
    const cmd = partToCommand(part, 'sink', 'cream')!;
    const pos = cmd.arguments.position as number[];
    expect(pos[0]).toBeCloseTo(0, 5);
    expect(pos[1]).toBeCloseTo(0, 5);
    expect(pos[2]).toBeCloseTo(0, 5);
  });

  it('width/depth/height 중 하나라도 0 이면 null', () => {
    expect(partToCommand(makeBody('p', { width: 0 }), 'sink', 'cream')).toBeNull();
    expect(partToCommand(makeBody('p', { depth: 0 }), 'sink', 'cream')).toBeNull();
    expect(partToCommand(makeBody('p', { height: 0 }), 'sink', 'cream')).toBeNull();
  });

  it('meta 에 isDoor / parentModuleId / doorIndex / openDirection 전달', () => {
    const door = makeDoor('door-1', 'mod-3', { doorIndex: 1, openDirection: 'right' });
    const cmd = partToCommand(door, 'wardrobe', 'walnut')!;
    const meta = cmd.arguments.meta as Record<string, unknown>;

    expect(meta.isDoor).toBe(true);
    expect(meta.parentModuleId).toBe('mod-3');
    expect(meta.doorIndex).toBe(1);
    expect(meta.openDirection).toBe('right');
    expect(meta.category).toBe('wardrobe');
  });

  it('meta 에 rotationZDeg 보존 (W4-5 transform_component 용)', () => {
    const part = makeBody('b1', { rotationZDeg: -90 });
    const cmd = partToCommand(part, 'sink', 'cream')!;
    const meta = cmd.arguments.meta as Record<string, unknown>;
    expect(meta.rotationZDeg).toBe(-90);
  });

  it('material 이름은 카테고리 무관, MaterialTone 만 반영', () => {
    const part = makeBody('p');
    expect(partToCommand(part, 'sink', 'oak')!.arguments.material).toBe('dadam_oak_body');
    expect(partToCommand(part, 'fridge', 'oak')!.arguments.material).toBe('dadam_oak_body');
  });
});

// ─────────────────────────────────────────────────────────────────
// buildPlanFromParts
// ─────────────────────────────────────────────────────────────────

describe('buildPlanFromParts', () => {
  it('빈 입력 + transactional=false → 빈 commands', () => {
    const plan = buildPlanFromParts([], {
      category: 'sink',
      materialTone: 'cream',
      transactional: false,
    });
    expect(plan.componentCount).toBe(0);
    expect(plan.commands).toEqual([]);
  });

  it('빈 입력 (기본 transactional=true) → START_OP/COMMIT_OP 만 남음', () => {
    const plan = buildPlanFromParts([], { category: 'sink', materialTone: 'cream' });
    expect(plan.componentCount).toBe(0);
    expect(plan.commands).toHaveLength(2);
    expect(plan.commands[0].arguments.code).toBe(RUBY_COMMANDS.START_OP);
    expect(plan.commands[1].arguments.code).toBe(RUBY_COMMANDS.COMMIT_OP);
  });

  it('본체 → 도어 순서로 정렬', () => {
    const parts = [
      makeDoor('d1', 'm1'),       // 도어 (앞)
      makeBody('b1'),             // 본체
      makeDoor('d2', 'm1'),       // 도어
      makeBody('b2'),             // 본체
    ];
    const plan = buildPlanFromParts(parts, {
      category: 'sink',
      materialTone: 'cream',
      transactional: false,
    });

    expect(plan.componentCount).toBe(4);
    const names = plan.commands.map((c) => c.arguments.name as string);
    expect(names.indexOf('dadam.sink.b1')).toBeLessThan(names.indexOf('dadam.sink.d1'));
    expect(names.indexOf('dadam.sink.b2')).toBeLessThan(names.indexOf('dadam.sink.d1'));
  });

  it('wireframe / essential=false 파트는 제외', () => {
    const parts = [
      makeBody('b1'),
      makeBody('b2', { wireframe: true }),
      makeBody('b3', { essential: false }),
      makeBody('b4'),
    ];
    const plan = buildPlanFromParts(parts, {
      category: 'storage',
      materialTone: 'graphite',
      transactional: false,
    });
    expect(plan.componentCount).toBe(2);
  });

  it('clearExisting=true + transactional=false → 맨 앞에 eval_ruby clear', () => {
    const plan = buildPlanFromParts([makeBody('b1')], {
      category: 'sink',
      materialTone: 'cream',
      clearExisting: true,
      transactional: false,
    });

    expect(plan.commands[0].tool).toBe(MHYRR_TOOLS.EVAL_RUBY);
    expect((plan.commands[0].arguments.code as string)).toContain('active_entities.clear!');
    expect(plan.componentCount).toBe(1);
  });

  it('카테고리가 컴포넌트 이름에 반영됨', () => {
    const plan = buildPlanFromParts([makeBody('b1')], {
      category: 'fridge',
      materialTone: 'walnut',
      transactional: false,
    });
    expect(plan.commands[0].arguments.name).toBe('dadam.fridge.b1');
  });
});

// ─────────────────────────────────────────────────────────────────
// 트랜잭션 래핑 (W2)
// ─────────────────────────────────────────────────────────────────

describe('buildPlanFromParts — transactional 래핑', () => {
  it('기본값: transactional=true → START_OP 가 맨 앞, COMMIT_OP 가 맨 뒤', () => {
    const plan = buildPlanFromParts(
      [makeBody('b1'), makeBody('b2')],
      { category: 'sink', materialTone: 'cream' },
    );

    expect(plan.commands).toHaveLength(4); // START + 2 create + COMMIT
    expect(plan.commands[0].tool).toBe(MHYRR_TOOLS.EVAL_RUBY);
    expect(plan.commands[0].arguments.code).toBe(RUBY_COMMANDS.START_OP);
    expect(plan.commands[plan.commands.length - 1].tool).toBe(MHYRR_TOOLS.EVAL_RUBY);
    expect(plan.commands[plan.commands.length - 1].arguments.code).toBe(RUBY_COMMANDS.COMMIT_OP);
    expect(plan.componentCount).toBe(2);
  });

  it('transactional=false → START/COMMIT 미포함', () => {
    const plan = buildPlanFromParts([makeBody('b1')], {
      category: 'sink',
      materialTone: 'cream',
      transactional: false,
    });
    const codes = plan.commands
      .filter((c) => c.tool === MHYRR_TOOLS.EVAL_RUBY)
      .map((c) => c.arguments.code as string);
    expect(codes).not.toContain(RUBY_COMMANDS.START_OP);
    expect(codes).not.toContain(RUBY_COMMANDS.COMMIT_OP);
  });

  it('clearExisting + transactional 동시 사용: [START, CLEAR, create…, COMMIT] 순서', () => {
    const plan = buildPlanFromParts([makeBody('b1')], {
      category: 'sink',
      materialTone: 'cream',
      clearExisting: true,
      transactional: true,
    });

    expect(plan.commands).toHaveLength(4);
    expect(plan.commands[0].arguments.code).toBe(RUBY_COMMANDS.START_OP);
    expect(plan.commands[1].arguments.code).toBe(RUBY_COMMANDS.CLEAR_ENTITIES);
    expect(plan.commands[2].tool).toBe(MHYRR_TOOLS.CREATE_COMPONENT);
    expect(plan.commands[3].arguments.code).toBe(RUBY_COMMANDS.COMMIT_OP);
  });
});

// ─────────────────────────────────────────────────────────────────
// 원점 정렬 (min-corner default)
// ─────────────────────────────────────────────────────────────────

describe('buildPlanFromParts — 원점 정렬 (min-corner)', () => {
  it('기본 origin=min-corner: 가구의 좌하단이 SketchUp 원점 (0,0,0) 에 정렬', () => {
    // V2 corner (-400, 0, 0) 짜리 박스 → align 후 (0, 0, 0)
    const plan = buildPlanFromParts(
      [makeBody('b1', { x: -400, y: 0, z: 0, width: 800, depth: 600, height: 720 })],
      { category: 'sink', materialTone: 'cream', transactional: false },
    );

    const createCmd = plan.commands.find((c) => c.tool === MHYRR_TOOLS.CREATE_COMPONENT)!;
    const pos = createCmd.arguments.position as number[];
    expect(pos[0]).toBeCloseTo(0, 5);
    expect(pos[1]).toBeCloseTo(0, 5);
    expect(pos[2]).toBeCloseTo(0, 5);
  });

  it('가구 전체가 +x/+y/+z 영역에 위치 (음수 좌표 없음)', () => {
    // 좌측 본체 corner x=-800, 우측 본체 corner x=0. 가구 가로 1600.
    const parts = [
      makeBody('b-left', { x: -800, y: 0, z: 0, width: 800, depth: 600, height: 720 }),
      makeBody('b-right', { x: 0, y: 0, z: 0, width: 800, depth: 600, height: 720 }),
    ];
    const plan = buildPlanFromParts(parts, {
      category: 'sink',
      materialTone: 'cream',
      transactional: false,
    });

    const positions = plan.commands
      .filter((c) => c.tool === MHYRR_TOOLS.CREATE_COMPONENT)
      .map((c) => c.arguments.position as number[]);
    for (const p of positions) {
      expect(p[0]).toBeGreaterThanOrEqual(0);
      expect(p[1]).toBeGreaterThanOrEqual(0);
      expect(p[2]).toBeGreaterThanOrEqual(0);
    }
  });

  it('originAlign=none: 원래 corner 좌표 유지 (음수 가능)', () => {
    const plan = buildPlanFromParts(
      [makeBody('b1', { x: -400, y: 0, z: 0, width: 800, depth: 600, height: 720 })],
      {
        category: 'sink',
        materialTone: 'cream',
        transactional: false,
        originAlign: 'none',
      },
    );

    const createCmd = plan.commands.find((c) => c.tool === MHYRR_TOOLS.CREATE_COMPONENT)!;
    const pos = createCmd.arguments.position as number[];
    expect(pos[0]).toBeCloseTo(mmToInch(-400), 5);
    expect(pos[1]).toBeCloseTo(mmToInch(0), 5);
    expect(pos[2]).toBeCloseTo(mmToInch(0), 5);
  });
});

// ─────────────────────────────────────────────────────────────────
// 보안 가드 (W1.1 hotfix)
// ─────────────────────────────────────────────────────────────────

describe('evalRubySafe — eval_ruby RCE 가드', () => {
  it('allowlist 의 CLEAR_ENTITIES 만 정해진 Ruby 코드로 매핑', () => {
    const cmd = evalRubySafe('CLEAR_ENTITIES');
    expect(cmd.tool).toBe(MHYRR_TOOLS.EVAL_RUBY);
    expect(cmd.arguments.code).toBe(RUBY_COMMANDS.CLEAR_ENTITIES);
    expect(cmd.arguments.code).toContain('active_entities.clear!');
  });

  it('트랜잭션 명령 START_OP/COMMIT_OP/ABORT_OP 모두 정해진 코드만 반환', () => {
    expect(evalRubySafe('START_OP').arguments.code).toBe(RUBY_COMMANDS.START_OP);
    expect(evalRubySafe('COMMIT_OP').arguments.code).toBe(RUBY_COMMANDS.COMMIT_OP);
    expect(evalRubySafe('ABORT_OP').arguments.code).toBe(RUBY_COMMANDS.ABORT_OP);
  });

  it('TypeScript 컴파일 단에서 allowlist 외 key 차단 — 런타임 typeof 확인', () => {
    const keys: Array<keyof typeof RUBY_COMMANDS> = ['CLEAR_ENTITIES', 'START_OP', 'COMMIT_OP', 'ABORT_OP', 'ENSURE_MATERIALS'];
    for (const k of keys) {
      expect(typeof RUBY_COMMANDS[k]).toBe('string');
      expect(RUBY_COMMANDS[k].length).toBeGreaterThan(0);
    }
  });

  it('ENSURE_MATERIALS 는 동적 입력 없는 고정 Ruby 코드 (palette/materials 만 사용)', () => {
    const code = RUBY_COMMANDS.ENSURE_MATERIALS;
    expect(code).toContain('cream');
    expect(code).toContain('oak');
    expect(code).toContain('walnut');
    expect(code).toContain('graphite');
    expect(code).toContain('body');
    expect(code).toContain('accent');
    expect(code).toContain('Sketchup.active_model.materials');
    // 외부 입력 보간 (#{...}) 없음 — 고정 string 만
    expect(code).not.toMatch(/\#\{[^}]*\}/);
  });
});

// ─────────────────────────────────────────────────────────────────
// W4-5: transform_component (회전) + set_material 명령
// ─────────────────────────────────────────────────────────────────

describe('partToRotationCommand — transform_component (회전)', () => {
  it('rotationZDeg undefined 이면 null', () => {
    const part = makeBody('b1');
    expect(partToRotationCommand(part, 'sink')).toBeNull();
  });

  it('rotationZDeg=0 이면 null (회전 불요)', () => {
    const part = makeBody('b1', { rotationZDeg: 0 });
    expect(partToRotationCommand(part, 'sink')).toBeNull();
  });

  it('rotationZDeg=90: transform_component + axis=[0,0,1] + angle_deg + origin=corner', () => {
    const part = makeBody('sec-1', {
      x: 100, y: 200, z: 300,
      rotationZDeg: 90,
    });
    const cmd = partToRotationCommand(part, 'sink')!;
    expect(cmd.tool).toBe(MHYRR_TOOLS.TRANSFORM_COMPONENT);
    expect(cmd.arguments.name).toBe(sketchupComponentName('sink', 'sec-1'));
    const rotation = cmd.arguments.rotation as any;
    expect(rotation.axis).toEqual([0, 0, 1]);
    expect(rotation.angle_deg).toBe(90);
    expect(rotation.origin[0]).toBeCloseTo(mmToInch(100), 5);
    expect(rotation.origin[1]).toBeCloseTo(mmToInch(200), 5);
    expect(rotation.origin[2]).toBeCloseTo(mmToInch(300), 5);
  });

  it('rotationZDeg=-90: 부호 보존', () => {
    const part = makeBody('sec-1', { rotationZDeg: -90 });
    const cmd = partToRotationCommand(part, 'sink')!;
    const rotation = cmd.arguments.rotation as any;
    expect(rotation.angle_deg).toBe(-90);
  });

  it('width/depth/height 중 하나라도 0 이면 null (create_component 와 정합)', () => {
    expect(partToRotationCommand(makeBody('p', { width: 0, rotationZDeg: 90 }), 'sink')).toBeNull();
  });
});

describe('partToMaterialCommand — set_material', () => {
  it('정상 → set_material + name + material', () => {
    const part = makeBody('b1');
    const cmd = partToMaterialCommand(part, 'sink', 'cream')!;
    expect(cmd.tool).toBe(MHYRR_TOOLS.SET_MATERIAL);
    expect(cmd.arguments.name).toBe('dadam.sink.b1');
    expect(cmd.arguments.material).toBe('dadam_cream_body');
  });

  it('도어는 accent colorKey → dadam_{tone}_accent', () => {
    const door = makeDoor('d1', 'm1');
    const cmd = partToMaterialCommand(door, 'wardrobe', 'walnut')!;
    expect(cmd.arguments.material).toBe('dadam_walnut_accent');
  });

  it('width=0 이면 null', () => {
    expect(partToMaterialCommand(makeBody('p', { width: 0 }), 'sink', 'cream')).toBeNull();
  });
});

describe('buildPlanFromParts — applyRotation / applyMaterial 옵션', () => {
  it('기본값 (applyRotation=false): 회전 파트가 있어도 transform_component 명령 없음 (회귀 격리)', () => {
    const part = makeBody('sec-1', { rotationZDeg: 90 });
    const plan = buildPlanFromParts([part], {
      category: 'sink',
      materialTone: 'cream',
      transactional: false,
    });
    const tools = plan.commands.map((c) => c.tool);
    expect(tools).not.toContain(MHYRR_TOOLS.TRANSFORM_COMPONENT);
  });

  it('applyRotation=true: rotationZDeg ≠ 0 파트마다 transform_component 추가', () => {
    const parts = [
      makeBody('b1'),                                  // 회전 없음
      makeBody('sec-1', { rotationZDeg: 90 }),
      makeBody('sec-2', { rotationZDeg: -90 }),
    ];
    const plan = buildPlanFromParts(parts, {
      category: 'sink',
      materialTone: 'cream',
      transactional: false,
      applyRotation: true,
    });
    const transformCmds = plan.commands.filter((c) => c.tool === MHYRR_TOOLS.TRANSFORM_COMPONENT);
    expect(transformCmds).toHaveLength(2);
    // create_component 직후에 transform_component 가 오는지 (순서)
    const createIdx = plan.commands.findIndex(
      (c) => c.tool === MHYRR_TOOLS.CREATE_COMPONENT && c.arguments.name === 'dadam.sink.sec-1',
    );
    expect(plan.commands[createIdx + 1].tool).toBe(MHYRR_TOOLS.TRANSFORM_COMPONENT);
  });

  it('기본값 (applyMaterial=false): set_material 명령 없음 + ENSURE_MATERIALS 도 없음', () => {
    const plan = buildPlanFromParts([makeBody('b1')], {
      category: 'sink',
      materialTone: 'cream',
      transactional: false,
    });
    const tools = plan.commands.map((c) => c.tool);
    expect(tools).not.toContain(MHYRR_TOOLS.SET_MATERIAL);
    const evalCodes = plan.commands
      .filter((c) => c.tool === MHYRR_TOOLS.EVAL_RUBY)
      .map((c) => c.arguments.code as string);
    expect(evalCodes).not.toContain(RUBY_COMMANDS.ENSURE_MATERIALS);
  });

  it('applyMaterial=true: ENSURE_MATERIALS 사전 등록 + 각 파트마다 set_material 추가', () => {
    const parts = [makeBody('b1'), makeDoor('d1', 'm1')];
    const plan = buildPlanFromParts(parts, {
      category: 'sink',
      materialTone: 'cream',
      transactional: true,
      applyMaterial: true,
    });

    // ENSURE_MATERIALS 가 START_OP 직후
    const evalCodes = plan.commands
      .filter((c) => c.tool === MHYRR_TOOLS.EVAL_RUBY)
      .map((c) => c.arguments.code as string);
    expect(evalCodes[0]).toBe(RUBY_COMMANDS.START_OP);
    expect(evalCodes[1]).toBe(RUBY_COMMANDS.ENSURE_MATERIALS);

    // set_material 명령 — 본체 1개 + 도어 1개
    const setMatCmds = plan.commands.filter((c) => c.tool === MHYRR_TOOLS.SET_MATERIAL);
    expect(setMatCmds).toHaveLength(2);
    expect(setMatCmds[0].arguments.material).toBe('dadam_cream_body');
    expect(setMatCmds[1].arguments.material).toBe('dadam_cream_accent');
  });

  it('applyRotation + applyMaterial 동시: 명령 순서 [create, transform?, set_material] × N', () => {
    const part = makeBody('sec-1', { rotationZDeg: 90 });
    const plan = buildPlanFromParts([part], {
      category: 'sink',
      materialTone: 'cream',
      transactional: false,
      applyRotation: true,
      applyMaterial: true,
    });

    const ofTool = plan.commands.map((c) => c.tool);
    const createIdx = ofTool.indexOf(MHYRR_TOOLS.CREATE_COMPONENT);
    expect(ofTool[createIdx + 1]).toBe(MHYRR_TOOLS.TRANSFORM_COMPONENT);
    expect(ofTool[createIdx + 2]).toBe(MHYRR_TOOLS.SET_MATERIAL);
  });

  it('originAlign=min-corner 가 transform_component.rotation.origin 도 동일 offset 적용', () => {
    // 박스 corner (-400, 0, 0). align 후 corner (0, 0, 0). rotation.origin 도 동일.
    const part = makeBody('sec-1', {
      x: -400, y: 0, z: 0, width: 800, depth: 600, height: 720,
      rotationZDeg: 90,
    });
    const plan = buildPlanFromParts([part], {
      category: 'sink',
      materialTone: 'cream',
      transactional: false,
      applyRotation: true,
      originAlign: 'min-corner',
    });

    const transformCmd = plan.commands.find((c) => c.tool === MHYRR_TOOLS.TRANSFORM_COMPONENT)!;
    const rotation = transformCmd.arguments.rotation as any;
    expect(rotation.origin[0]).toBeCloseTo(0, 5);
    expect(rotation.origin[1]).toBeCloseTo(0, 5);
    expect(rotation.origin[2]).toBeCloseTo(0, 5);
  });
});

// ─────────────────────────────────────────────────────────────────
// partId validator (W1.1 hotfix M4)
// ─────────────────────────────────────────────────────────────────

describe('sketchupComponentName — partId 이스케이프', () => {
  it('안전한 partId 는 그대로 통과', () => {
    expect(sketchupComponentName('sink', 'body_01')).toBe('dadam.sink.body_01');
    expect(sketchupComponentName('sink', 'door-2')).toBe('dadam.sink.door-2');
    expect(sketchupComponentName('sink', 'AbC123')).toBe('dadam.sink.AbC123');
  });

  it('점 / 슬래시 / 공백 / 한글은 _ 로 치환 (outliner 분리자 깨짐 방지)', () => {
    expect(sketchupComponentName('sink', 'body.01')).toBe('dadam.sink.body_01');
    expect(sketchupComponentName('sink', 'a/b')).toBe('dadam.sink.a_b');
    expect(sketchupComponentName('sink', 'foo bar')).toBe('dadam.sink.foo_bar');
    expect(sketchupComponentName('sink', '도어1')).toBe('dadam.sink.__1');
  });

  it('빌더 통합: 위험한 partId 가 들어와도 안전한 컴포넌트 이름 생성', () => {
    const dangerous: CabinetPartV2 = makeBody('foo.bar/baz qux');
    const cmd = partToCommand(dangerous, 'sink', 'cream')!;
    expect(cmd.arguments.name).toBe('dadam.sink.foo_bar_baz_qux');
  });
});

// ─────────────────────────────────────────────────────────────────
// 경계 케이스
// ─────────────────────────────────────────────────────────────────

describe('경계 케이스', () => {
  it('음수 좌표 (벽 안쪽으로 매립된 파트) 도 mm→inch 그대로 통과 (originAlign=none)', () => {
    const part = makeBody('p', { x: -350, y: -310, z: -260 });
    const cmd = partToCommand(part, 'sink', 'cream')!;
    const pos = cmd.arguments.position as number[];
    expect(pos[0]).toBeCloseTo(mmToInch(-350), 5);
    expect(pos[1]).toBeCloseTo(mmToInch(-310), 5);
    expect(pos[2]).toBeCloseTo(mmToInch(-260), 5);
  });

  it('초대형 가구 (10m 폭) 도 처리 — inch 변환 정밀도', () => {
    const part = makeBody('p', { width: 10000, depth: 600, height: 2400 });
    const cmd = partToCommand(part, 'wardrobe', 'oak')!;
    const dim = cmd.arguments.dimensions as number[];
    expect(dim[0]).toBeCloseTo(mmToInch(10000), 4);
    expect(dim[2]).toBeCloseTo(mmToInch(2400), 4);
  });

  it('width=0 fallback — null 반환', () => {
    expect(partToCommand(makeBody('p', { width: 0, depth: 100, height: 100 }), 'sink', 'cream')).toBeNull();
  });

  it('clearExisting + transactional=false 사용 시 eval_ruby 가 allowlist 의 정확한 문자열만 사용', () => {
    const plan = buildPlanFromParts([], {
      category: 'sink',
      materialTone: 'cream',
      clearExisting: true,
      transactional: false,
    });
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0].tool).toBe(MHYRR_TOOLS.EVAL_RUBY);
    expect(plan.commands[0].arguments.code).toBe(RUBY_COMMANDS.CLEAR_ENTITIES);
  });
});
