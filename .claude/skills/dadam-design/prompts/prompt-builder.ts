// ═══════════════════════════════════════════════════════════════
// Prompt Builder - 다담AI 프롬프트 생성기
// ═══════════════════════════════════════════════════════════════

import { mapColor, mapFinish, mapHandle, getCategoryContents } from '../utils/color-map.js';

// ─────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────

export interface WallData {
  wall_width_mm: number;
  wall_height_mm: number;
  tile_type?: string;
  tile_size_mm?: { width: number; height: number };
  confidence?: string;
  utility_positions?: {
    water_supply?: UtilityPosition;
    exhaust_duct?: UtilityPosition;
    gas_line?: UtilityPosition;
  };
  furniture_placement?: {
    sink_position?: string;
    cooktop_position?: string;
    range_hood_position?: string;
    layout_direction?: string;
  };
}

export interface UtilityPosition {
  detected: boolean;
  from_left_mm: number;
  from_left_percent: number;
  height_mm?: number;
  description?: string;
}

export interface RagRules {
  background: string[];
  modules: string[];
  doors: string[];
  materials: MaterialRule[];
  materialKeywords: MaterialRule[];
}

export interface MaterialRule {
  id?: string;
  triggers?: string[];
  content: string;
  metadata?: { hex?: string };
}

export interface PromptParams {
  category: string;
  style: string;
  wallData: WallData;
  ragRules: RagRules;
}

// ─────────────────────────────────────────────────────────────────
// 스타일 섹션
// ─────────────────────────────────────────────────────────────────

const MODERN_MINIMAL_STYLE = `
[STYLE: Modern Minimal Korean Kitchen]
- Colors: White, Gray, Wood tones (Light Oak, Walnut)
- Surface: Matte or low-gloss finish
- Lines: Straight lines, clean design without clutter
- Handles: Hidden handles (Push-open, 45-degree cut, J-type handle, Smart bar)
- Hardware: Minimized, no exposed hardware
- Details: Flush doors (doors flush with frame)
- Countertop: Solid surface or engineered stone, neutral color`;

// ─────────────────────────────────────────────────────────────────
// 벽 측정 섹션 빌더
// ─────────────────────────────────────────────────────────────────

export function buildWallMeasurementSection(wallData: WallData): string {
  if (!wallData) {
    return `
[WALL MEASUREMENTS - DEFAULT]
- Wall Width: 3000mm (3.0m)
- Wall Height: 2400mm (2.4m)
- Using default measurements
`;
  }

  return `
[WALL MEASUREMENTS - FROM VISION ANALYSIS]
- Wall Width: ${wallData.wall_width_mm}mm
- Wall Height: ${wallData.wall_height_mm}mm
- Tile Type: ${wallData.tile_type || 'standard'} (${wallData.tile_size_mm?.width || 300}x${wallData.tile_size_mm?.height || 600}mm)
- Analysis Confidence: ${wallData.confidence || 'medium'}
`;
}

// ─────────────────────────────────────────────────────────────────
// 유틸리티 배치 섹션 빌더
// ─────────────────────────────────────────────────────────────────

export function buildUtilityPlacementSection(wallData: WallData): string {
  if (!wallData?.utility_positions) {
    return `
[FURNITURE PLACEMENT - DEFAULT]
- Sink: Center of lower cabinet area
- Cooktop: To the side of sink with adequate counter space between
- Range Hood: Directly above cooktop
`;
  }

  const utils = wallData.utility_positions;
  const placement = wallData.furniture_placement || {};

  let section = `
═══════════════════════════════════════════════════════════════
[CRITICAL - UTILITY-BASED FURNITURE PLACEMENT]
═══════════════════════════════════════════════════════════════

>> DETECTED UTILITIES FROM PHOTO:`;

  // Water Supply Detection
  if (utils.water_supply?.detected) {
    section += `

WATER MANIFOLD (급수 분배기):
- Position: ${utils.water_supply.from_left_mm}mm from left wall (${utils.water_supply.from_left_percent}%)
- Height: ${utils.water_supply.height_mm || 'floor level'}mm
- Description: ${utils.water_supply.description || 'Water supply pipes detected'}
→ SINK MUST BE PLACED HERE`;
  }

  // Exhaust Duct Detection
  if (utils.exhaust_duct?.detected) {
    section += `

EXHAUST DUCT (배기 덕트):
- Position: ${utils.exhaust_duct.from_left_mm}mm from left wall (${utils.exhaust_duct.from_left_percent}%)
- Height: ${utils.exhaust_duct.height_mm || 'upper wall'}mm
- Description: ${utils.exhaust_duct.description || 'Ventilation duct detected'}
→ COOKTOP + RANGE HOOD MUST BE PLACED HERE`;
  }

  // Gas Line Detection
  if (utils.gas_line?.detected) {
    section += `

GAS LINE (가스 배관):
- Position: ${utils.gas_line.from_left_mm}mm from left wall (${utils.gas_line.from_left_percent}%)
- Description: ${utils.gas_line.description || 'Gas pipe detected'}
→ GAS COOKTOP CONNECTION POINT`;
  }

  section += `

═══════════════════════════════════════════════════════════════
[MANDATORY PLACEMENT RULES - DO NOT IGNORE]
═══════════════════════════════════════════════════════════════

1. SINK PLACEMENT:
   - Center the sink basin EXACTLY at water supply position
   - Sink cabinet width: 800-900mm typical
   - Include sink faucet and basin in rendering
   - Position: ${placement.sink_position || 'at water_supply location'}

2. COOKTOP + RANGE HOOD PLACEMENT:
   - Center the cooktop EXACTLY at exhaust duct position
   - Range hood DIRECTLY above cooktop, aligned with exhaust duct
   - Cooktop width: 600-900mm typical
   - Range hood must connect to exhaust duct location
   - Position: ${placement.cooktop_position || 'at exhaust_duct location'}

3. LAYOUT DIRECTION:
   - ${placement.layout_direction || 'Determine based on utility positions'}
   - Maintain work triangle: Sink → Counter → Cooktop
   - Minimum 400mm counter space between sink and cooktop
`;

  return section;
}

// ─────────────────────────────────────────────────────────────────
// 자재 색상 섹션 빌더
// ─────────────────────────────────────────────────────────────────

export function buildMaterialColorSection(materials: MaterialRule[], materialKeywords: MaterialRule[]): string {
  if (materials.length === 0 && materialKeywords.length === 0) {
    return '';
  }

  let section = `
═══════════════════════════════════════════════════════════════
[MATERIAL COLOR SPECIFICATION]
═══════════════════════════════════════════════════════════════`;

  if (materials.length > 0) {
    section += `\n\n>> SPECIFIED MATERIALS:\n`;

    for (const mat of materials) {
      const code = mat.triggers?.[0] || mat.id || 'unknown';
      section += `\n[${code}]\n`;

      const colorMatch = mat.content.match(/Color:\s*([^\n]+)/);
      const renderMatch = mat.content.match(/Render:\s*([^\n]+)/);
      const finishMatch = mat.content.match(/Finish:\s*([^\n]+)/);

      if (colorMatch) section += `  Color: ${colorMatch[1].trim()}\n`;
      if (finishMatch) section += `  Finish: ${finishMatch[1].trim()}\n`;
      if (renderMatch) section += `  Render: ${renderMatch[1].trim()}\n`;

      if (mat.metadata?.hex) {
        section += `  HEX: ${mat.metadata.hex}\n`;
      }
    }
  }

  if (materialKeywords.length > 0) {
    section += `\n\n>> RECOMMENDED OPTIONS:\n`;
    for (const kw of materialKeywords) {
      const lines = kw.content.split('\n').slice(0, 10).join('\n');
      section += `${lines}\n`;
    }
  }

  section += `
═══════════════════════════════════════════════════════════════
[CRITICAL - COLOR RENDERING RULES]
- ALL cabinet doors MUST use the EXACT specified color
- Apply correct finish: matte / glossy / pearl
- Maintain CONSISTENT color across ALL doors
- Match HEX code precisely if provided
- Wood grain direction: VERTICAL for doors
═══════════════════════════════════════════════════════════════`;

  return section;
}

// ─────────────────────────────────────────────────────────────────
// 닫힌 도어 프롬프트 빌더
// ─────────────────────────────────────────────────────────────────

export function buildClosedDoorPrompt(params: PromptParams): string {
  const { category, wallData, ragRules } = params;

  const wallSection = buildWallMeasurementSection(wallData);
  const utilitySection = buildUtilityPlacementSection(wallData);
  const materialSection = buildMaterialColorSection(ragRules.materials, ragRules.materialKeywords);

  const backgroundRules = ragRules.background.length > 0
    ? ragRules.background.join('\n')
    : '- Clean, bright walls with smooth finished surface\n- Natural light coming into the space\n- Modern minimal interior design';

  const moduleRules = ragRules.modules.length > 0
    ? ragRules.modules.join('\n')
    : '- Follow standard Korean built-in furniture specifications';

  const doorRules = ragRules.doors.length > 0
    ? ragRules.doors.join('\n')
    : '- Full door coverage, no open shelving visible';

  return `[TASK: KOREAN BUILT-IN KITCHEN RENDERING - PHOTOREALISTIC]

Generate a photorealistic image of Korean-style built-in kitchen furniture based on the uploaded construction/renovation room photo.

${wallSection}

${utilitySection}

${MODERN_MINIMAL_STYLE}

${materialSection}

[BACKGROUND CORRECTION RULES]
${backgroundRules}
- REMOVE all visible construction elements (exposed concrete, insulation, wiring)
- RENDER walls as clean, finished surfaces
- COMPLETE ceiling with proper finish
- MAINTAIN floor material from original photo

[MODULE CONSTRUCTION RULES]
${moduleRules}
- Upper cabinets: 300-350mm depth, 700-900mm height
- Lower cabinets: 550-600mm depth, 850-900mm height including countertop
- Countertop: 20-40mm thickness, slight overhang

[DOOR SPECIFICATIONS]
${doorRules}
- ALL doors must be CLOSED
- Consistent door sizing and alignment
- Hidden hinges

[APPLIANCE RENDERING]
- SINK: Stainless steel undermount sink with modern faucet at WATER SUPPLY position
- COOKTOP: Built-in gas or induction cooktop at EXHAUST DUCT position
- RANGE HOOD: Modern slim range hood above cooktop, aligned with exhaust
- Optional: Built-in oven, dishwasher, refrigerator space

[CRITICAL REQUIREMENTS]
1. PHOTOREALISTIC quality - must look like a real photograph
2. EXACT camera angle from original photo - same perspective, same viewpoint
3. Furniture MUST fit within wall dimensions precisely
4. SINK at water supply location, COOKTOP at exhaust duct location - MANDATORY
5. ALL doors must be CLOSED (no open doors or drawers)
6. Background must show COMPLETED, FINISHED surfaces (no construction visible)
7. Natural lighting consistent with original photo
8. No people, pets, or moving objects

[OUTPUT]
- Single photorealistic image
- High resolution, professional interior design quality
- Magazine-worthy kitchen rendering
`;
}

// ─────────────────────────────────────────────────────────────────
// 열린 도어 프롬프트 빌더
// ─────────────────────────────────────────────────────────────────

export function buildOpenDoorPrompt(category: string): string {
  const contents = getCategoryContents(category);

  return `[TASK] 이 가구 이미지에서 모든 도어를 열린 상태로 변경하세요.

[CRITICAL - 절대 변경 금지]
- 도어 개수: 현재 이미지에 보이는 도어 개수 정확히 유지
- 도어 위치: 각 도어의 위치 그대로 유지
- 도어 크기/비율: 각 도어의 너비와 높이 비율 완전히 동일
- 도어 색상/재질: 변경 금지
- 가구 전체 크기와 형태: 변경 금지
- 카메라 앵글, 원근감, 시점: 완전히 동일
- 배경 (벽, 바닥, 천장, 조명): 동일

[변경할 것 - 도어 상태만]
- 각 여닫이 도어: 현재 위치에서 90도 바깥으로 회전하여 열림
- 각 서랍: 현재 위치에서 30-40% 당겨진 상태

[CRITICAL - 도어 구조 유지 규칙]
- 절대 도어를 추가하거나 제거하지 마세요
- 절대 도어를 합치거나 분할하지 마세요
- 닫힌 상태의 도어 분할선/경계선을 정확히 따르세요
- 각 도어는 독립적으로 열려야 합니다

[내부 수납물 - ${category}]
${contents}

[금지사항]
- 붙박이장에 식기류 금지 (옷만 표시)
- 싱크대에 의류 금지 (주방용품만 표시)

[출력 품질]
- 닫힌 이미지와 도어 구조 100% 일치
- 포토리얼리스틱 인테리어 사진 품질`;
}
