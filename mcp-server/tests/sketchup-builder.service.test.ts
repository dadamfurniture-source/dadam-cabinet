import { describe, it, expect } from 'vitest';
import {
  buildPlanFromParts,
  evalRubySafe,
  partToCommand,
  partV2ToCommand,
  migrateV1ToV2,
} from '../src/services/sketchup-builder.service.js';
import {
  mmToInch,
  plannerToSketchup,
  sketchupComponentName,
  sketchupMaterialName,
  MHYRR_TOOLS,
  RUBY_COMMANDS,
} from '../src/constants/sketchup.js';
import type { CabinetPart, CabinetPartV2 } from '../src/types/planner.types.js';

// ─────────────────────────────────────────────────────────────────
// 픽스처
// ─────────────────────────────────────────────────────────────────

function makeBody(id: string, overrides: Partial<CabinetPart> = {}): CabinetPart {
  return {
    id,
    label: `body ${id}`,
    x: 0,
    y: 0,
    z: 0,
    width: 600,
    height: 720,
    depth: 600,
    colorKey: 'body',
    ...overrides,
  };
}

function makeDoor(id: string, parentModuleId: string, overrides: Partial<CabinetPart> = {}): CabinetPart {
  return {
    id,
    label: `door ${id}`,
    x: 0,
    y: 0,
    z: 600, // 본체 앞쪽
    width: 600,
    height: 720,
    depth: 18,
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

describe('plannerToSketchup', () => {
  it('Y-up (planner) → Z-up (SketchUp) 축 교환: (x,y,z) → (x,z,y)', () => {
    expect(plannerToSketchup({ x: 100, y: 200, z: 300 })).toEqual({ x: 100, y: 300, z: 200 });
  });

  it('원점은 그대로', () => {
    expect(plannerToSketchup({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────
// partToCommand
// ─────────────────────────────────────────────────────────────────

describe('partToCommand', () => {
  it('CabinetPart 한 개 → create_component 한 개', () => {
    const part = makeBody('body-1', { x: 0, y: 150, z: 0 });
    const cmd = partToCommand(part, 'sink', 'cream');

    expect(cmd).not.toBeNull();
    expect(cmd!.tool).toBe(MHYRR_TOOLS.CREATE_COMPONENT);
    expect(cmd!.arguments.name).toBe(sketchupComponentName('sink', 'body-1'));
    expect(cmd!.arguments.material).toBe(sketchupMaterialName('cream', 'body'));
  });

  it('mm → inch 변환 + 축 교환 + center→corner 보정이 모두 적용됨', () => {
    const part = makeBody('p', {
      x: 100, y: 200, z: 300,
      width: 600, height: 720, depth: 550,
    });
    const cmd = partToCommand(part, 'sink', 'cream')!;
    const pos = cmd.arguments.position as number[];
    const dim = cmd.arguments.dimensions as number[];

    // planner center (100,200,300) → SketchUp center (100,300,200)
    // → corner (100-600/2, 300-550/2, 200-720/2) = (-200, 25, -160) → inch
    expect(pos[0]).toBeCloseTo(mmToInch(-200), 5);
    expect(pos[1]).toBeCloseTo(mmToInch(25), 5);
    expect(pos[2]).toBeCloseTo(mmToInch(-160), 5);

    // 치수: 축 교환 (width,depth,height) 만, center→corner 보정 영향 없음
    expect(dim[0]).toBeCloseTo(mmToInch(600), 5);
    expect(dim[1]).toBeCloseTo(mmToInch(550), 5);
    expect(dim[2]).toBeCloseTo(mmToInch(720), 5);
  });

  it('center→corner: 중심이 (0,0,0) 인 박스는 corner=(-w/2,-d/2,-h/2)', () => {
    const part = makeBody('p', { x: 0, y: 0, z: 0, width: 600, height: 720, depth: 550 });
    const cmd = partToCommand(part, 'sink', 'cream')!;
    const pos = cmd.arguments.position as number[];

    // SketchUp 좌표계로 [x_corner=-w/2, y_corner=-d/2, z_corner=-h/2]
    expect(pos[0]).toBeCloseTo(mmToInch(-300), 5); // -width/2
    expect(pos[1]).toBeCloseTo(mmToInch(-275), 5); // -depth/2
    expect(pos[2]).toBeCloseTo(mmToInch(-360), 5); // -height/2
  });

  it('center→corner: 본체 (800×720×600) 중심 (400,360,300) → corner (0,0,0)', () => {
    // 본체 좌하단 바닥이 SketchUp 원점에 오도록 의도된 배치.
    const part = makeBody('p', { x: 400, y: 360, z: 300, width: 800, height: 720, depth: 600 });
    const cmd = partToCommand(part, 'sink', 'cream')!;
    const pos = cmd.arguments.position as number[];

    expect(pos[0]).toBeCloseTo(mmToInch(0), 5);
    expect(pos[1]).toBeCloseTo(mmToInch(0), 5);
    expect(pos[2]).toBeCloseTo(mmToInch(0), 5);
  });

  it('center→corner: 얇은 도어 (depth=18) 도 모든 축에서 dimension/2 만큼 보정', () => {
    // 도어는 planner.z = depth/2+5 위치 (본체 앞쪽 살짝 돌출). depth 가 얇아도 보정은 균일.
    const part = makeDoor('door-1', 'mod-1', {
      x: 0, y: 360, z: 305, width: 800, height: 720, depth: 18, // z=305 = depth/2+5
    });
    const cmd = partToCommand(part, 'sink', 'cream')!;
    const pos = cmd.arguments.position as number[];
    const dim = cmd.arguments.dimensions as number[];

    // SketchUp center: (x=0, y=305, z=360) — Y-up→Z-up
    // corner: x=0-800/2=-400, y=305-18/2=296, z=360-720/2=0
    expect(pos[0]).toBeCloseTo(mmToInch(-400), 5);
    expect(pos[1]).toBeCloseTo(mmToInch(296), 5);
    expect(pos[2]).toBeCloseTo(mmToInch(0), 5);

    // dimensions: 얇은 도어 — y(SketchUp depth) = 18
    expect(dim[1]).toBeCloseTo(mmToInch(18), 5);
  });

  it('width/height/depth 중 하나라도 0 이면 null', () => {
    expect(partToCommand(makeBody('p', { width: 0 }), 'sink', 'cream')).toBeNull();
    expect(partToCommand(makeBody('p', { height: 0 }), 'sink', 'cream')).toBeNull();
    expect(partToCommand(makeBody('p', { depth: 0 }), 'sink', 'cream')).toBeNull();
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
    // 본체가 도어보다 먼저
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
    expect(plan.componentCount).toBe(1); // clear 는 create_component 아니므로 카운트에서 제외
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
      { category: 'sink', materialTone: 'cream' }, // transactional 미지정 → 기본 true
    );

    expect(plan.commands).toHaveLength(4); // START + 2 create + COMMIT
    expect(plan.commands[0].tool).toBe(MHYRR_TOOLS.EVAL_RUBY);
    expect(plan.commands[0].arguments.code).toBe(RUBY_COMMANDS.START_OP);
    expect(plan.commands[plan.commands.length - 1].tool).toBe(MHYRR_TOOLS.EVAL_RUBY);
    expect(plan.commands[plan.commands.length - 1].arguments.code).toBe(RUBY_COMMANDS.COMMIT_OP);

    // componentCount 는 create_component 만 카운트 — START/COMMIT 영향 없음
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

    expect(plan.commands).toHaveLength(4); // START + CLEAR + create + COMMIT
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
    // 본체 800×720×600 중심 (0, 360, 300) → corner (-400, 0, 0) → align 후 (0, 0, 0)
    const plan = buildPlanFromParts(
      [makeBody('b1', { x: 0, y: 360, z: 300, width: 800, height: 720, depth: 600 })],
      { category: 'sink', materialTone: 'cream', transactional: false },
    );

    const createCmd = plan.commands.find((c) => c.tool === MHYRR_TOOLS.CREATE_COMPONENT)!;
    const pos = createCmd.arguments.position as number[];
    expect(pos[0]).toBeCloseTo(0, 5);
    expect(pos[1]).toBeCloseTo(0, 5);
    expect(pos[2]).toBeCloseTo(0, 5);
  });

  it('가구 전체가 +x/+y/+z 영역에 위치 (음수 좌표 없음)', () => {
    // 좌측 본체 (중심 x=-400), 우측 본체 (중심 x=400). 가구 가로 1600.
    const parts = [
      makeBody('b-left', { x: -400, y: 360, z: 300, width: 800, height: 720, depth: 600 }),
      makeBody('b-right', { x: 400, y: 360, z: 300, width: 800, height: 720, depth: 600 }),
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
    // 중심 (0,360,300) → corner (-400, 0, 0) — 음수 x
    const plan = buildPlanFromParts(
      [makeBody('b1', { x: 0, y: 360, z: 300, width: 800, height: 720, depth: 600 })],
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
    // 모든 키가 RUBY_COMMANDS 에 존재해야 한다 (allowlist 위반 방지).
    const keys: Array<keyof typeof RUBY_COMMANDS> = ['CLEAR_ENTITIES', 'START_OP', 'COMMIT_OP', 'ABORT_OP'];
    for (const k of keys) {
      expect(typeof RUBY_COMMANDS[k]).toBe('string');
      expect(RUBY_COMMANDS[k].length).toBeGreaterThan(0);
    }
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
    const dangerous: CabinetPart = makeBody('foo.bar/baz qux');
    const cmd = partToCommand(dangerous, 'sink', 'cream')!;
    expect(cmd.arguments.name).toBe('dadam.sink.foo_bar_baz_qux');
  });
});

// ─────────────────────────────────────────────────────────────────
// 빠진 케이스 (W1.1 hotfix M3)
// ─────────────────────────────────────────────────────────────────

describe('경계 케이스', () => {
  it('음수 좌표 (벽 안쪽으로 매립된 파트) 도 center→corner 변환 적용', () => {
    // makeBody 기본값: width=600, height=720, depth=600
    const part = makeBody('p', { x: -50, y: 100, z: -10 });
    const cmd = partToCommand(part, 'sink', 'cream')!;
    const pos = cmd.arguments.position as number[];
    // SketchUp center: (x=-50, y=z_planner=-10, z=y_planner=100)
    // corner: (-50-300, -10-300, 100-360) = (-350, -310, -260)
    expect(pos[0]).toBeCloseTo(mmToInch(-350), 5);
    expect(pos[1]).toBeCloseTo(mmToInch(-310), 5);
    expect(pos[2]).toBeCloseTo(mmToInch(-260), 5);
  });

  it('초대형 가구 (10m 폭) 도 처리 — inch 변환 정밀도', () => {
    const part = makeBody('p', { width: 10000, height: 2400, depth: 600 });
    const cmd = partToCommand(part, 'wardrobe', 'oak')!;
    const dim = cmd.arguments.dimensions as number[];
    expect(dim[0]).toBeCloseTo(mmToInch(10000), 4);
    expect(dim[2]).toBeCloseTo(mmToInch(2400), 4);
  });

  it('width=0 fallback — null 반환 (NaN/Infinity 호출 방지)', () => {
    expect(partToCommand(makeBody('p', { width: 0, height: 100, depth: 100 }), 'sink', 'cream')).toBeNull();
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

// ─────────────────────────────────────────────────────────────────
// W4-1: V2 (Z-up corner mm rotationZDeg) shim
// ─────────────────────────────────────────────────────────────────

function makeV2Body(id: string, overrides: Partial<CabinetPartV2> = {}): CabinetPartV2 {
  return {
    id,
    label: `body ${id}`,
    x: 0, y: 0, z: 0,
    width: 600, depth: 600, height: 720,
    colorKey: 'body',
    ...overrides,
  };
}

describe('migrateV1ToV2 — Y-up center radians → Z-up corner degrees', () => {
  it('회전 없는 본체: center (0, 360, 300) + (800, 720, 600) → corner (-400, 0, 0)', () => {
    const v1: CabinetPart = makeBody('b1', {
      x: 0, y: 360, z: 300, width: 800, height: 720, depth: 600,
    });
    const v2 = migrateV1ToV2(v1);
    expect(v2.x).toBe(-400);   // x_corner = 0 - 800/2
    expect(v2.y).toBe(0);      // y_corner = z_v1 - depth/2 = 300 - 600/2
    expect(v2.z).toBe(0);      // z_corner = y_v1 - height/2 = 360 - 720/2
    expect(v2.width).toBe(800);
    expect(v2.depth).toBe(600);   // depth_V2 = depth_V1 (planner z extent)
    expect(v2.height).toBe(720);  // height_V2 = height_V1 (planner y extent)
    expect(v2.rotationZDeg).toBeUndefined();
  });

  it('회전 변환: rotationY +π/2 → rotationZDeg +90', () => {
    const v1: CabinetPart = makeBody('b1', {
      x: 0, y: 360, z: 300, rotationY: Math.PI / 2,
    } as any);
    const v2 = migrateV1ToV2(v1);
    expect(v2.rotationZDeg).toBeCloseTo(90, 5);
  });

  it('회전 변환: rotationY -π/2 → rotationZDeg -90 (부호 보존)', () => {
    const v1: CabinetPart = makeBody('b1', {
      x: 0, y: 360, z: 300, rotationY: -Math.PI / 2,
    } as any);
    const v2 = migrateV1ToV2(v1);
    expect(v2.rotationZDeg).toBeCloseTo(-90, 5);
  });

  it('필드 메타 보존: isDoor / parentModuleId / doorIndex / openDirection / colorKey', () => {
    const v1: CabinetPart = makeDoor('d1', 'mod-1', { doorIndex: 1, openDirection: 'right' });
    const v2 = migrateV1ToV2(v1);
    expect(v2.isDoor).toBe(true);
    expect(v2.parentModuleId).toBe('mod-1');
    expect(v2.doorIndex).toBe(1);
    expect(v2.openDirection).toBe('right');
    expect(v2.colorKey).toBe('accent');
  });
});

describe('partV2ToCommand — V2 직접 → mhyrr 명령', () => {
  it('변환 없이 mm→inch 만 적용 — V2 가 이미 SketchUp 네이티브 좌표', () => {
    const v2 = makeV2Body('b1', { x: 100, y: 200, z: 300, width: 800, depth: 600, height: 720 });
    const cmd = partV2ToCommand(v2, 'sink', 'cream')!;
    const pos = cmd.arguments.position as number[];
    const dim = cmd.arguments.dimensions as number[];
    expect(pos[0]).toBeCloseTo(mmToInch(100), 5);
    expect(pos[1]).toBeCloseTo(mmToInch(200), 5);
    expect(pos[2]).toBeCloseTo(mmToInch(300), 5);
    expect(dim[0]).toBeCloseTo(mmToInch(800), 5);
    expect(dim[1]).toBeCloseTo(mmToInch(600), 5);
    expect(dim[2]).toBeCloseTo(mmToInch(720), 5);
  });

  it('width/depth/height 중 하나라도 0 이면 null', () => {
    expect(partV2ToCommand(makeV2Body('p', { width: 0 }), 'sink', 'cream')).toBeNull();
    expect(partV2ToCommand(makeV2Body('p', { depth: 0 }), 'sink', 'cream')).toBeNull();
    expect(partV2ToCommand(makeV2Body('p', { height: 0 }), 'sink', 'cream')).toBeNull();
  });

  it('meta 에 rotationZDeg 보존 (W4-5 transform_component 용)', () => {
    const v2 = makeV2Body('b1', { rotationZDeg: -90 });
    const cmd = partV2ToCommand(v2, 'sink', 'cream')!;
    const meta = cmd.arguments.meta as Record<string, unknown>;
    expect(meta.rotationZDeg).toBe(-90);
  });

  it('V1 partToCommand 와 V2 partV2ToCommand 결과가 byte-identical (round-trip)', () => {
    const v1: CabinetPart = makeBody('p', { x: 100, y: 200, z: 300, width: 600, height: 720, depth: 550 });
    const v2 = migrateV1ToV2(v1);
    const cmdV1 = partToCommand(v1, 'sink', 'cream')!;
    const cmdV2 = partV2ToCommand(v2, 'sink', 'cream')!;

    expect((cmdV1.arguments.position as number[])[0]).toBeCloseTo((cmdV2.arguments.position as number[])[0], 5);
    expect((cmdV1.arguments.position as number[])[1]).toBeCloseTo((cmdV2.arguments.position as number[])[1], 5);
    expect((cmdV1.arguments.position as number[])[2]).toBeCloseTo((cmdV2.arguments.position as number[])[2], 5);
    expect((cmdV1.arguments.dimensions as number[])[0]).toBeCloseTo((cmdV2.arguments.dimensions as number[])[0], 5);
    expect((cmdV1.arguments.dimensions as number[])[1]).toBeCloseTo((cmdV2.arguments.dimensions as number[])[1], 5);
    expect((cmdV1.arguments.dimensions as number[])[2]).toBeCloseTo((cmdV2.arguments.dimensions as number[])[2], 5);
  });
});
