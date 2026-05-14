// ═══════════════════════════════════════════════════════════════
// SketchUp Builder Service — CabinetPart[] → BuildCommand[]
//
// 순수 함수만 모음. 외부 통신 없음, 단위 테스트 가능.
// Bridge 서비스가 BuildCommand[] 를 mhyrr JSON-RPC 메시지로 직렬화한다.
//
// 변환 책임:
// 1) mm → inch (SketchUp 내부 단위)
// 2) planner Y-up → SketchUp Z-up
// 3) ColorKey + MaterialTone → 머티리얼 이름
// 4) isDoor flag → 별도 컴포넌트로 분리 (디자이너가 도어만 선택·변경 가능)
// ═══════════════════════════════════════════════════════════════

import type { CabinetCategory, CabinetPart, MaterialTone } from '../types/planner.types.js';
import {
  mmToInch,
  plannerToSketchup,
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
 * CabinetPart 1개 → create_component 명령 1개.
 *
 * SketchUp 의 create_component 는 일반적으로 다음 arguments 를 받는다 (mhyrr 명세 기반):
 *   - name: string
 *   - position: [x, y, z]   // inch
 *   - dimensions: [w, h, d] // inch
 *   - material: string (선택)
 *
 * width/height/depth 가 0 인 part 는 건너뛴다 (planner 에서 비활성 모듈).
 */
export function partToCommand(part: CabinetPart, category: CabinetCategory, tone: MaterialTone): BuildCommand | null {
  if (part.width <= 0 || part.height <= 0 || part.depth <= 0) {
    return null;
  }

  const skOrigin = plannerToSketchup({ x: part.x, y: part.y, z: part.z });
  // planner 의 width/height/depth 는 축 정렬 박스 치수.
  // 좌표 회전 후 width(x)=width, depth(y)=depth_in_planner, height(z)=height_in_planner.
  const skDimensions = plannerToSketchup({ x: part.width, y: part.height, z: part.depth });

  const materialName = sketchupMaterialName(tone, part.colorKey);
  const componentName = sketchupComponentName(category, part.id);

  return {
    tool: MHYRR_TOOLS.CREATE_COMPONENT,
    arguments: {
      name: componentName,
      position: [mmToInch(skOrigin.x), mmToInch(skOrigin.y), mmToInch(skOrigin.z)],
      dimensions: [mmToInch(skDimensions.x), mmToInch(skDimensions.y), mmToInch(skDimensions.z)],
      material: materialName,
      // 메타데이터 (mhyrr eval_ruby 로 attribute_dictionary 접근 시 사용)
      meta: {
        category,
        partId: part.id,
        partLabel: part.label,
        isDoor: !!part.isDoor,
        parentModuleId: part.parentModuleId ?? null,
        doorIndex: part.doorIndex ?? null,
        openDirection: part.openDirection ?? null,
        moduleType: part.moduleType ?? null,
      },
    },
  };
}

/**
 * CabinetPart[] → BuildPlan.
 *
 * 순서 보장:
 * 1) clearExisting 이 true 면 active_entities clear 명령을 맨 앞에 둔다.
 * 2) wireframe / essential=false 인 보조 파트는 제외 (시공 산출물에 불필요).
 * 3) 본체 → 도어 순으로 정렬 (도어가 본체보다 z 축에서 살짝 앞으로 나오는 게 자연스러움).
 */
export function buildPlanFromParts(parts: CabinetPart[], opts: BuildOptions): BuildPlan {
  const commands: BuildCommand[] = [];

  if (opts.clearExisting) {
    commands.push(evalRubySafe('CLEAR_ENTITIES'));
  }

  // 보조 파트 (wireframe, essential=false) 제외.
  const buildParts = parts.filter((p) => !p.wireframe && p.essential !== false);

  // 본체 → 도어 순서.
  const bodyParts = buildParts.filter((p) => !p.isDoor);
  const doorParts = buildParts.filter((p) => p.isDoor);

  for (const part of [...bodyParts, ...doorParts]) {
    const cmd = partToCommand(part, opts.category, opts.materialTone);
    if (cmd) commands.push(cmd);
  }

  return {
    category: opts.category,
    materialTone: opts.materialTone,
    commands,
    componentCount: commands.filter((c) => c.tool === MHYRR_TOOLS.CREATE_COMPONENT).length,
  };
}
