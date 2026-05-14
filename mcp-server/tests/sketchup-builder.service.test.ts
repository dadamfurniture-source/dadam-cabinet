import { describe, it, expect } from 'vitest';
import {
  buildPlanFromParts,
  evalRubySafe,
  partToCommand,
} from '../src/services/sketchup-builder.service.js';
import {
  mmToInch,
  plannerToSketchup,
  sketchupComponentName,
  sketchupMaterialName,
  MHYRR_TOOLS,
  RUBY_COMMANDS,
} from '../src/constants/sketchup.js';
import type { CabinetPart } from '../src/types/planner.types.js';

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

  it('mm → inch 변환과 축 교환이 모두 적용됨', () => {
    const part = makeBody('p', {
      x: 100, y: 200, z: 300,
      width: 600, height: 720, depth: 550,
    });
    const cmd = partToCommand(part, 'sink', 'cream')!;
    const pos = cmd.arguments.position as number[];
    const dim = cmd.arguments.dimensions as number[];

    // planner(100,200,300) → SketchUp(100,300,200) → inch
    expect(pos[0]).toBeCloseTo(mmToInch(100), 5);
    expect(pos[1]).toBeCloseTo(mmToInch(300), 5);
    expect(pos[2]).toBeCloseTo(mmToInch(200), 5);

    // 치수도 동일 변환
    expect(dim[0]).toBeCloseTo(mmToInch(600), 5);
    expect(dim[1]).toBeCloseTo(mmToInch(550), 5);
    expect(dim[2]).toBeCloseTo(mmToInch(720), 5);
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
  it('빈 입력 → componentCount 0', () => {
    const plan = buildPlanFromParts([], { category: 'sink', materialTone: 'cream' });
    expect(plan.componentCount).toBe(0);
    expect(plan.commands).toEqual([]);
  });

  it('본체 → 도어 순서로 정렬', () => {
    const parts = [
      makeDoor('d1', 'm1'),       // 도어 (앞)
      makeBody('b1'),             // 본체
      makeDoor('d2', 'm1'),       // 도어
      makeBody('b2'),             // 본체
    ];
    const plan = buildPlanFromParts(parts, { category: 'sink', materialTone: 'cream' });

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
    const plan = buildPlanFromParts(parts, { category: 'storage', materialTone: 'graphite' });
    expect(plan.componentCount).toBe(2);
  });

  it('clearExisting=true 면 맨 앞에 eval_ruby clear 명령 prepend', () => {
    const plan = buildPlanFromParts([makeBody('b1')], {
      category: 'sink',
      materialTone: 'cream',
      clearExisting: true,
    });

    expect(plan.commands[0].tool).toBe(MHYRR_TOOLS.EVAL_RUBY);
    expect((plan.commands[0].arguments.code as string)).toContain('active_entities.clear!');
    expect(plan.componentCount).toBe(1); // clear 는 create_component 아니므로 카운트에서 제외
  });

  it('카테고리가 컴포넌트 이름에 반영됨', () => {
    const plan = buildPlanFromParts([makeBody('b1')], { category: 'fridge', materialTone: 'walnut' });
    expect(plan.commands[0].arguments.name).toBe('dadam.fridge.b1');
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
  it('음수 좌표 (벽 안쪽으로 매립된 파트) 도 그대로 전달', () => {
    const part = makeBody('p', { x: -50, y: 100, z: -10 });
    const cmd = partToCommand(part, 'sink', 'cream')!;
    const pos = cmd.arguments.position as number[];
    expect(pos[0]).toBeCloseTo(mmToInch(-50), 5);
    expect(pos[1]).toBeCloseTo(mmToInch(-10), 5); // planner z → SketchUp y
    expect(pos[2]).toBeCloseTo(mmToInch(100), 5);
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

  it('clearExisting 사용 시 eval_ruby 가 allowlist 의 정확한 문자열만 사용', () => {
    const plan = buildPlanFromParts([], {
      category: 'sink',
      materialTone: 'cream',
      clearExisting: true,
    });
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0].tool).toBe(MHYRR_TOOLS.EVAL_RUBY);
    expect(plan.commands[0].arguments.code).toBe(RUBY_COMMANDS.CLEAR_ENTITIES);
  });
});
