// ═══════════════════════════════════════════════════════════════
// SketchUp Builder Service — CabinetPartV2[] → BuildCommand[]
//
// 순수 함수만 모음. 외부 통신 없음, 단위 테스트 가능.
// Bridge 서비스가 BuildCommand[] 를 mhyrr JSON-RPC 메시지로 직렬화한다.
//
// W4-4: 입력은 V2 (Z-up corner mm degrees) 만. V1 shim (migrateV1ToV2,
// partToCommand) 은 제거됨. planner-vite 가 W4-3 에서 V2 직송 전환.
//
// 변환 책임:
// 1) mm → inch (SketchUp 내부 단위) — partV2ToCommand 가 유일
// 2) ColorKey + MaterialTone → 머티리얼 이름
// 3) isDoor flag → 별도 컴포넌트로 분리 (디자이너가 도어만 선택·변경 가능)
// 4) (W4-5 예정) rotationZDeg → transform_component, material → set_material
// ═══════════════════════════════════════════════════════════════

import type { CabinetCategory, CabinetPartV2, MaterialTone } from '../types/planner.types.js';
import {
  mmToInch,
  sketchupComponentName,
  sketchupMaterialName,
  MHYRR_TOOLS,
  RUBY_COMMANDS,
  type MhyrrToolName,
  type RubyCommandKey,
} from '../constants/sketchup.js';

// ───────────────────────────────────────────────────────────────
// 출력 형태
// ───────────────────────────────────────────────────────────────

/**
 * mhyrr/sketchup-mcp 가 받는 JSON-RPC tools/call payload 의
 * params 부분 (arguments 까지 포함). Bridge 가 jsonrpc/method/id 를
 * 감싸서 전송한다.
 */
export interface BuildCommand {
  tool: MhyrrToolName;
  arguments: Record<string, unknown>;
}

export interface BuildPlan {
  category: CabinetCategory;
  materialTone: MaterialTone;
  commands: BuildCommand[];
  componentCount: number;
}

export interface BuildOptions {
  category: CabinetCategory;
  materialTone: MaterialTone;
  /** true 면 빌드 전에 active_entities 초기화 명령을 prepend. */
  clearExisting?: boolean;
  /**
   * true (기본값) 면 빌드 명령들을 SketchUp start_operation/commit_operation
   * 블록으로 감싼다. 디자이너가 Ctrl+Z 한 번으로 빌드 전체를 롤백 가능하며,
   * 도중 실패 시 bridge 가 abort_operation 으로 깔끔히 되돌릴 수 있다.
   */
  transactional?: boolean;
  /**
   * 원점 정렬 정책:
   *   - 'min-corner' (기본): 가구의 좌하단 모서리를 SketchUp 원점 (0,0,0) 에 맞춤.
   *     모든 create_component 의 position 에서 bounding box 의 (x_min, y_min, z_min) 을 뺀다.
   *     디자이너 관례 — 가구가 SketchUp 의 +x/+y/+z 1사분면 안에 통째로 배치됨.
   *   - 'none': planner 좌표 그대로 사용. 가구 가로 중심이 SketchUp x=0 에 위치
   *     (planner CabinetPart 의 x=0 관례). 가구가 빨간 축 양쪽으로 걸침.
   */
  originAlign?: 'min-corner' | 'none';
}

/**
 * eval_ruby 호출 — allowlist 에 정의된 명령만 허용.
 * 외부 LLM agent 가 도구를 호출할 수 있으므로 임의 Ruby 코드 실행 금지.
 * 자유 입력이 필요한 경우 별도 RPC 도구로 분리하고 인증을 거치도록 한다.
 */
export function evalRubySafe(key: RubyCommandKey): BuildCommand {
  return {
    tool: MHYRR_TOOLS.EVAL_RUBY,
    arguments: { code: RUBY_COMMANDS[key] },
  };
}

// ───────────────────────────────────────────────────────────────
// 핵심 변환
// ───────────────────────────────────────────────────────────────

/**
 * CabinetPartV2 1개 → create_component 명령 1개.
 *
 * V2 는 이미 SketchUp 네이티브 좌표 (Z-up corner mm).
 * 변환은 mm→inch 뿐.
 *
 * width/depth/height 가 0 인 part 는 건너뛴다.
 */
export function partToCommand(part: CabinetPartV2, category: CabinetCategory, tone: MaterialTone): BuildCommand | null {
  if (part.width <= 0 || part.depth <= 0 || part.height <= 0) {
    return null;
  }

  const materialName = sketchupMaterialName(tone, part.colorKey);
  const componentName = sketchupComponentName(category, part.id);

  return {
    tool: MHYRR_TOOLS.CREATE_COMPONENT,
    arguments: {
      type: 'cube',
      position: [mmToInch(part.x), mmToInch(part.y), mmToInch(part.z)],
      dimensions: [mmToInch(part.width), mmToInch(part.depth), mmToInch(part.height)],
      // name / material / meta — mhyrr v0.1.0 는 무시하지만 정보 보존
      name: componentName,
      material: materialName,
      meta: {
        category,
        partId: part.id,
        partLabel: part.label,
        isDoor: !!part.isDoor,
        parentModuleId: part.parentModuleId ?? null,
        doorIndex: part.doorIndex ?? null,
        openDirection: part.openDirection ?? null,
        moduleType: part.moduleType ?? null,
        rotationZDeg: part.rotationZDeg ?? null, // W4-5 에서 transform_component 로 적용 예정
      },
    },
  };
}

/**
 * CabinetPartV2[] → BuildPlan.
 *
 * 순서 보장:
 * 1) transactional=true (기본) 이면 START_OP 를 맨 앞에 prepend, COMMIT_OP 를 맨 뒤에 append.
 *    clearExisting 의 clear 명령은 트랜잭션 내부 (START_OP 다음) 에 위치 — clear 도
 *    같은 undo 그룹에 묶여야 디자이너가 Ctrl+Z 한 번으로 이전 상태로 복귀 가능.
 * 2) clearExisting 이 true 면 active_entities clear 명령을 트랜잭션 시작 직후 둔다.
 * 3) wireframe / essential=false 인 보조 파트는 제외 (시공 산출물에 불필요).
 * 4) 본체 → 도어 순으로 정렬 (도어가 본체보다 z 축에서 살짝 앞으로 나오는 게 자연스러움).
 */
export function buildPlanFromParts(
  parts: CabinetPartV2[],
  opts: BuildOptions,
): BuildPlan {
  const commands: BuildCommand[] = [];
  const transactional = opts.transactional ?? true;

  if (transactional) {
    commands.push(evalRubySafe('START_OP'));
  }

  if (opts.clearExisting) {
    commands.push(evalRubySafe('CLEAR_ENTITIES'));
  }

  // 보조 파트 (wireframe, essential=false) 제외.
  const buildParts = parts.filter(
    (p) => !p.wireframe && p.essential !== false,
  );

  // 본체 → 도어 순서.
  const bodyParts = buildParts.filter((p) => !p.isDoor);
  const doorParts = buildParts.filter((p) => p.isDoor);

  for (const part of [...bodyParts, ...doorParts]) {
    const cmd = partToCommand(part, opts.category, opts.materialTone);
    if (cmd) commands.push(cmd);
  }

  // 원점 정렬: 가구의 좌하단 모서리를 SketchUp 원점 (0,0,0) 에 맞춤.
  // create_component 들의 position 중 (x_min, y_min, z_min) 을 모든 position 에서 뺀다.
  // START/COMMIT/CLEAR (eval_ruby) 명령은 position 없으므로 영향 받지 않는다.
  const originAlign = opts.originAlign ?? 'min-corner';
  if (originAlign === 'min-corner') {
    const positions = commands
      .filter((c) => c.tool === MHYRR_TOOLS.CREATE_COMPONENT)
      .map((c) => c.arguments.position as number[]);
    if (positions.length > 0) {
      const minX = Math.min(...positions.map((p) => p[0]));
      const minY = Math.min(...positions.map((p) => p[1]));
      const minZ = Math.min(...positions.map((p) => p[2]));
      for (const cmd of commands) {
        if (cmd.tool !== MHYRR_TOOLS.CREATE_COMPONENT) continue;
        const pos = cmd.arguments.position as number[];
        pos[0] -= minX;
        pos[1] -= minY;
        pos[2] -= minZ;
      }
    }
  }

  if (transactional) {
    commands.push(evalRubySafe('COMMIT_OP'));
  }

  return {
    category: opts.category,
    materialTone: opts.materialTone,
    commands,
    componentCount: commands.filter((c) => c.tool === MHYRR_TOOLS.CREATE_COMPONENT).length,
  };
}
