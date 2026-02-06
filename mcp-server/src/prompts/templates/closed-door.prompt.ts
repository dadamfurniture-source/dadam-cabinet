// ═══════════════════════════════════════════════════════════════
// Closed Door Prompt Builder (Single Source of Truth)
// 기존: http-server.ts 783~996줄
// ═══════════════════════════════════════════════════════════════

import type { WallAnalysis } from '../../types/index.js';
import type { ClassifiedRules } from '../../mappers/rule-classifier.js';
import { buildMaterialColorSection } from '../sections/material-color.section.js';

export interface CabinetSpecs {
  total_width_mm?: number;
  total_height_mm?: number;
  upper_cabinet_height?: number;
  lower_cabinet_height?: number;
  depth_mm?: number;
  leg_height?: number;
  molding_height?: number;
  door_color_upper?: string;
  door_color_lower?: string;
  door_finish_upper?: string;
  door_finish_lower?: string;
  countertop_color?: string;
  handle_type?: string;
  sink_type?: string;
  faucet_type?: string;
  hood_type?: string;
  cooktop_type?: string;
}

export interface ModulesData {
  upper?: Array<{ name?: string; type?: string; width?: number; w?: number; height?: number }>;
  lower?: Array<{ name?: string; type?: string; width?: number; w?: number; height?: number }>;
  upper_count?: number;
  lower_count?: number;
}

export interface ClosedDoorPromptParams {
  category: string;
  style: string;
  wallData: WallAnalysis;
  rules: ClassifiedRules;
  cabinetSpecs?: CabinetSpecs;
  modules?: ModulesData;
  styleKeywords?: string;
  styleAtmosphere?: string;
  colorPrompt?: string;
}

export function buildClosedDoorPrompt(params: ClosedDoorPromptParams): string {
  const {
    category,
    style,
    wallData,
    rules,
    cabinetSpecs,
    modules,
    styleKeywords,
    styleAtmosphere,
    colorPrompt,
  } = params;

  const specs = cabinetSpecs || {};

  // 모듈 개수 및 레이아웃
  const upperCount = modules?.upper_count || modules?.upper?.length || 0;
  const lowerCount = modules?.lower_count || modules?.lower?.length || 0;

  let upperLayout = '';
  let lowerLayout = '';

  if (modules?.upper && Array.isArray(modules.upper) && modules.upper.length > 0) {
    upperLayout = modules.upper.map((m) => {
      const w = m.width || m.w || 600;
      const name = m.name || m.type || 'cabinet';
      return `${name}(${w}mm)`;
    }).join(' → ');
  }

  if (modules?.lower && Array.isArray(modules.lower) && modules.lower.length > 0) {
    lowerLayout = modules.lower.map((m) => {
      const w = m.width || m.w || 600;
      const name = m.name || m.type || 'cabinet';
      return `${name}(${w}mm)`;
    }).join(' → ');
  }

  // 마감재 정보
  const doorColor = specs.door_color_upper || specs.door_color_lower || '화이트';
  const doorFinish = specs.door_finish_upper || specs.door_finish_lower || '무광';
  const countertop = specs.countertop_color || '스노우 화이트';
  const handleType = specs.handle_type || '푸시오픈';

  const sinkType = specs.sink_type || '';
  const hoodType = specs.hood_type || '';
  const cooktopType = specs.cooktop_type || '';

  // 배관 위치 프롬프트
  const utilityPlacementPrompt = buildUtilityPlacementSection(wallData);

  return `[MOST IMPORTANT - READ FIRST]
This is a PHOTO generation task, NOT a technical drawing.
DO NOT ADD ANY TEXT, NUMBERS, DIMENSIONS, OR LABELS TO THE IMAGE.
The output must be a CLEAN photograph with NO annotations whatsoever.

[TASK: KOREAN BUILT-IN KITCHEN (싱크대) - PHOTOREALISTIC PHOTO]

═══════════════════════════════════════════════════════════════
[SECTION 1: 공간 구조 유지 + 마감 보정]
═══════════════════════════════════════════════════════════════
PRESERVE (반드시 유지):
- 카메라 앵글과 시점
- 방의 전체적인 구조와 레이아웃
- 창문, 문, 천장의 위치
- 조명 조건

FINISH & CLEAN UP (미완성 부분 자연스럽게 마감):
- 노출된 전선 → 벽 안으로 숨기고 깔끔하게 마감
- 시멘트 벽, 미장 안 된 벽 → 깔끔한 벽지/페인트로 마감
- 찢어진 벽지, 곰팡이, 때 → 새 벽지로 깨끗하게 마감
- 공사 자재, 먼지, 잡동사니 → 제거하여 깔끔한 상태로
- 바닥 보호 비닐, 테이프 → 제거하고 완성된 바닥재로 마감
- 미완성 천장, 몰딩 → 자연스럽게 마감 처리
- 창틀, 문틀 미완성 부분 → 깔끔하게 마감
${utilityPlacementPrompt}

═══════════════════════════════════════════════════════════════
[SECTION 3: 필수 설비 - 반드시 배치] ★★★ 중요
═══════════════════════════════════════════════════════════════
다음 설비는 반드시 이미지에 포함되어야 합니다:

【싱크볼 & 수전】 - 필수
- 싱크볼: 적절한 위치에 반드시 배치
- 수전(Faucet): 싱크볼 정중앙 위에 배치
- 싱크볼 아래(개수대 하부): 배관과 수도 분배기만 보이도록
  → 잡동사니, 쓰레기통, 세제 등 제거 (깔끔한 배관만)

【쿡탑】 - 필수
- 인덕션 또는 가스레인지: 적절한 위치에 반드시 배치
- 쿡탑 위에 레인지후드 배치

═══════════════════════════════════════════════════════════════
[SECTION 4: 캐비닛 디자인]
═══════════════════════════════════════════════════════════════
Upper cabinets: ${upperCount} units
Lower cabinets: ${lowerCount} units
${upperLayout ? `Upper layout: ${upperLayout}` : ''}
${lowerLayout ? `Lower layout: ${lowerLayout}` : ''}

도어 타입 구분:
- 여닫이 도어 (Swing door): 힌지로 여는 일반 도어
- 서랍 도어 (Drawer): 앞으로 당기는 서랍

═══════════════════════════════════════════════════════════════
[SECTION 5: 사용자 선택 테마/컬러 적용] ★ 중요
═══════════════════════════════════════════════════════════════
[STYLE: ${style}]
${styleKeywords ? styleKeywords : 'Modern Korean minimalist kitchen with clean seamless door panels.'}
${styleAtmosphere ? `Atmosphere: ${styleAtmosphere}` : ''}

[DOOR COLOR - 사용자 선택]
- 도어 색상: ${doorColor}
- 마감: ${doorFinish}
${colorPrompt ? `- 색상 스타일: ${colorPrompt}` : ''}

※ 반드시 위 사용자 선택 컬러로 모든 캐비닛 도어를 렌더링할 것

${buildMaterialColorSection(rules.materials, rules.materialKeywords)}

═══════════════════════════════════════════════════════════════
[SECTION 6: 추가 마감재]
═══════════════════════════════════════════════════════════════
- Countertop: ${countertop}
- Handle: ${handleType}
${sinkType ? `- Sink: ${sinkType}` : '- Sink: 스테인리스 싱크볼'}
${hoodType ? `- Hood: ${hoodType}` : '- Hood: 슬림형 레인지후드'}
${cooktopType ? `- Cooktop: ${cooktopType}` : '- Cooktop: 3구 인덕션'}

═══════════════════════════════════════════════════════════════
[STRICTLY FORBIDDEN]
═══════════════════════════════════════════════════════════════
❌ NO dimension labels or measurements
❌ NO text, numbers, or characters
❌ NO arrows, lines, or technical markings
❌ NO watermarks or logos
❌ NO people or pets
❌ NO 싱크볼/쿡탑 누락 (반드시 포함!)

═══════════════════════════════════════════════════════════════
[OUTPUT]
═══════════════════════════════════════════════════════════════
Clean photorealistic interior photograph of Korean kitchen (싱크대).
Magazine quality, professional lighting.
All unfinished areas naturally completed.
Sink bowl with centered faucet - MUST INCLUDE.
Cooktop (induction/gas) with hood - MUST INCLUDE.
Under sink: clean pipes and water distributor only.
All cabinet doors CLOSED with user-selected color.`;
}

function buildUtilityPlacementSection(wallData: WallAnalysis): string {
  const waterPos = wallData.water_pipe_x;
  const exhaustPos = wallData.exhaust_duct_x;
  const gasPos = wallData.gas_pipe_x;

  if (waterPos || exhaustPos || gasPos) {
    let section = `
═══════════════════════════════════════════════════════════════
[SECTION 2: 배관 위치 기반 설비 배치]
═══════════════════════════════════════════════════════════════`;

    if (waterPos) {
      section += `
수도 배관 감지됨 (기준점에서 약 ${waterPos}mm):
→ 싱크볼 중심을 이 위치에 맞춰 설치
→ 수전(Faucet)을 싱크볼 위에 설치`;
    }

    if (exhaustPos) {
      section += `
후드 배기구멍 감지됨 (기준점에서 약 ${exhaustPos}mm):
→ 레인지후드를 이 위치 아래에 설치
→ 쿡탑/가스레인지를 후드 바로 아래에 설치`;
    }

    if (gasPos) {
      section += `
가스 배관 감지됨 (기준점에서 약 ${gasPos}mm):
→ 가스레인지/쿡탑을 이 위치 근처에 설치`;
    }

    return section;
  }

  // 아무것도 감지되지 않은 경우
  const placement = wallData.furniture_placement;
  const sinkPos = placement?.sink_center_mm || Math.round(wallData.wall_width_mm * 0.3);
  const cooktopPos = placement?.cooktop_center_mm || Math.round(wallData.wall_width_mm * 0.7);
  const layoutDir = placement?.layout_direction || 'sink_left_cooktop_right';

  return `
═══════════════════════════════════════════════════════════════
[SECTION 2: 설비 배치 - 계산된 기본 좌표]
═══════════════════════════════════════════════════════════════
배관 위치가 감지되지 않아 벽 너비 기준으로 배치 좌표를 계산했습니다.

싱크볼 배치 (기준점에서 ${sinkPos}mm):
→ 싱크볼 중심을 ${sinkPos}mm 위치에 설치
→ 수전(Faucet)을 싱크볼 정중앙 위에 설치
→ 싱크볼 아래: 배관과 수도 분배기만 (잡동사니 제거)

쿡탑 & 레인지후드 배치 (기준점에서 ${cooktopPos}mm):
→ 쿡탑(인덕션/가스레인지) 중심을 ${cooktopPos}mm 위치에 설치
→ 레인지후드를 쿡탑 바로 위에 설치

레이아웃: ${layoutDir === 'sink_left_cooktop_right' ? '싱크 왼쪽 ← → 쿡탑 오른쪽' : '쿡탑 왼쪽 ← → 싱크 오른쪽'}
동선: 냉장고 → 싱크대 → 조리대 → 쿡탑`;
}
