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
  /**
   * W4-5b: create_component 응답의 result.resourceId (mhyrr 가 반환하는 group.entityID)
   * 를 sendBatch 가 entityIdMap[idRef] 에 저장. 후속 transform_component / set_material
   * 명령이 arguments 안에서 `__ENT__:<idRef>` 문자열로 참조 → sendBatch 가 실 ID 치환.
   */
  idRef?: string;
}

/**
 * W4-5b: arguments 안의 `__ENT__:<partId>` 플레이스홀더 형식.
 * sendBatch (per-command) 가 응답에서 받은 resourceId 로 치환.
 */
export const ENT_REF_PREFIX = '__ENT__:';

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
  /**
   * W4-5: rotationZDeg ≠ 0 인 파트에 mhyrr transform_component 호출 추가.
   * 기본 false — 디자이너 PC E2E 검증 후 기본값 true 전환 예정 (W4-5b).
   * secondary 모듈이 SketchUp 에서 ±90° 회전된 상태로 배치됨.
   */
  applyRotation?: boolean;
  /**
   * W4-5: 각 파트에 mhyrr set_material 호출 추가.
   * 기본 false — 디자이너 PC E2E 검증 후 기본값 true 전환 예정.
   * true 면 빌드 시작 시 사전 등록 (ENSURE_MATERIALS) 도 자동 추가.
   */
  applyMaterial?: boolean;
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
        rotationZDeg: part.rotationZDeg ?? null,
      },
    },
    // W4-5b: 후속 transform_component / set_material 이 응답 resourceId 참조.
    idRef: part.id,
  };
}

/**
 * W4-5b: rotationZDeg ≠ 0 인 파트에 mhyrr transform_component 명령 생성.
 *
 * mhyrr v0.1.0 의 transform_component 실제 시그니처 (su_mcp/main.rb 검증):
 *   { id: number, rotation: [x_deg, y_deg, z_deg], position?: [x,y,z], scale?: [sx,sy,sz] }
 *   - rotation 은 Euler degrees 배열 — 각 축마다 entity.bounds.center 기준 순차 회전
 *   - pivot 은 mhyrr 가 entity.bounds.center 로 고정 (origin/axis 파라미터 없음)
 *
 * W4-5b 변경:
 *   - args.id 는 placeholder (sendBatch 가 응답 resourceId 로 치환)
 *   - rotation 은 Euler 배열 [0, 0, angleDeg] — Z축만 회전
 *   - origin 인자 제거 (mhyrr 가 center 자동 사용)
 *
 * pivot 의미 차이:
 *   - V2 plan 의도: rotation pivot = corner (AABB min)
 *   - mhyrr 실제: rotation pivot = bbox center
 *   - secondary 모듈의 base 가 정사각 (depth==width 인 경우) 이면 차이 없음.
 *   - 비정사각 박스는 회전 후 위치 차이 — W4-5c 에서 transform_component 의
 *     position+rotation 조합으로 corner-pivot 효과 구현 가능 (별 PR).
 *
 * @returns rotationZDeg 가 undefined 또는 0 이면 null (회전 명령 불요)
 */
export function partToRotationCommand(part: CabinetPartV2, _category: CabinetCategory): BuildCommand | null {
  if (part.rotationZDeg == null || part.rotationZDeg === 0) return null;
  if (part.width <= 0 || part.depth <= 0 || part.height <= 0) return null;

  return {
    tool: MHYRR_TOOLS.TRANSFORM_COMPONENT,
    arguments: {
      id: `${ENT_REF_PREFIX}${part.id}`,
      rotation: [0, 0, part.rotationZDeg],
    },
  };
}

/**
 * W4-5b: 각 파트에 mhyrr set_material 명령 생성.
 *
 * mhyrr v0.1.0 의 set_material 실제 시그니처 (su_mcp/main.rb 검증):
 *   { id: number, material: string }
 *   - id 로 entity 찾고 material 이름의 머티리얼 적용
 *   - material 이 model.materials 에 등록돼 있으면 그것 사용 (ENSURE_MATERIALS 가 사전 등록)
 *   - 없으면 mhyrr 가 자동 생성 — hex 색 (`#xxx`) 형식이면 색상 자동 파싱.
 *
 * W4-5b 변경:
 *   - args.id 는 placeholder (sendBatch 가 응답 resourceId 로 치환)
 *   - args.name 제거 (mhyrr 가 사용하지 않음)
 */
export function partToMaterialCommand(part: CabinetPartV2, _category: CabinetCategory, tone: MaterialTone): BuildCommand | null {
  if (part.width <= 0 || part.depth <= 0 || part.height <= 0) return null;
  const materialName = sketchupMaterialName(tone, part.colorKey);
  return {
    tool: MHYRR_TOOLS.SET_MATERIAL,
    arguments: {
      id: `${ENT_REF_PREFIX}${part.id}`,
      material: materialName,
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
  const applyRotation = opts.applyRotation ?? false;
  const applyMaterial = opts.applyMaterial ?? false;

  if (transactional) {
    commands.push(evalRubySafe('START_OP'));
  }

  // W4-5: 머티리얼 사전 등록 (16개 idempotent — 이미 있으면 색상만 갱신).
  // ENSURE_MATERIALS 명령은 트랜잭션 내부 + clear 이전에 위치 — clear 가
  // 머티리얼 정의 자체는 안 지움 (active_entities.clear! 는 entities 만).
  // 하지만 같은 undo 그룹에 묶기 위해 START_OP 직후.
  if (applyMaterial) {
    commands.push(evalRubySafe('ENSURE_MATERIALS'));
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
    // 1) create_component (cube)
    const createCmd = partToCommand(part, opts.category, opts.materialTone);
    if (!createCmd) continue;
    commands.push(createCmd);

    // 2) transform_component (회전, 옵션) — origin 은 part.corner = create_component.position
    if (applyRotation) {
      const rotCmd = partToRotationCommand(part, opts.category);
      if (rotCmd) commands.push(rotCmd);
    }

    // 3) set_material (옵션)
    if (applyMaterial) {
      const matCmd = partToMaterialCommand(part, opts.category, opts.materialTone);
      if (matCmd) commands.push(matCmd);
    }
  }

  // 원점 정렬: 가구의 좌하단 모서리를 SketchUp 원점 (0,0,0) 에 맞춤.
  // create_component 들의 position 중 (x_min, y_min, z_min) 을 모든 position 에서 뺀다.
  // W4-5b: mhyrr 의 transform_component 는 rotation.origin 인자 없음 — entity.bounds.center
  // 기준 자동 회전. originAlign 은 create_component.position 만 보정.
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
