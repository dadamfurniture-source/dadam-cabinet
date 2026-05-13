// ═══════════════════════════════════════════════════════════════
// Closed Door Prompt Builder (Single Source of Truth)
// 기존: http-server.ts 783~996줄
//
// 카테고리 독립 적용:
// - sink 전용 명세(싱크볼/수전/쿡탑/후드, 배관 위치 안내, sink-specific
//   금지·체크리스트)는 `isSink` 게이팅으로만 출력된다.
// - 다른 카테고리(wardrobe/fridge/vanity/shoe/storage)는 공통 골격
//   (SECTION 1·4·5·6 + 핸드리스 + STRICTLY FORBIDDEN)만 받는다.
// - 카테고리별 디테일(옷장 행거바, 냉장고장 갭 등)은 후속 PR에서
//   `CATEGORY_LABELS` 옆에 슬롯을 늘려 채운다.
// ═══════════════════════════════════════════════════════════════

import type { WallAnalysis, CabinetSpecs, ModulesData } from '../../types/index.js';
import type { ClassifiedRules } from '../../mappers/rule-classifier.js';
import { buildMaterialColorSection } from '../sections/material-color.section.js';

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

const CATEGORY_LABELS: Record<string, { ko: string; en: string }> = {
  sink: { ko: '싱크대', en: 'KITCHEN' },
  wardrobe: { ko: '옷장', en: 'WARDROBE' },
  fridge: { ko: '냉장고장', en: 'FRIDGE CABINET' },
  vanity: { ko: '화장대', en: 'VANITY' },
  shoe: { ko: '신발장', en: 'SHOE CABINET' },
  storage: { ko: '수납장', en: 'STORAGE CABINET' },
};

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
  const isSink = category === 'sink';
  const label = CATEGORY_LABELS[category] || { ko: category, en: category.toUpperCase() };

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
  const handleType = specs.handle_type || 'handleless (J-pull recessed top edge)';

  const sinkType = specs.sink_type || '';
  const hoodType = specs.hood_type || '';
  const cooktopType = specs.cooktop_type || '';

  // sink 전용: 배관 위치 안내 (sink 외 카테고리는 배관 컨텍스트 무의미)
  const utilityPlacementPrompt = isSink ? buildSinkUtilityPlacementSection(wallData) : '';

  // sink 전용 섹션들
  const sinkCriticalBlock = isSink
    ? `★★★ CRITICAL REQUIREMENT - 절대 누락 금지 ★★★
싱크대(SINK CABINET)에는 반드시 다음이 포함되어야 합니다:
1. 싱크볼 (SINK BOWL) - 스테인리스 또는 화강석 싱크볼
2. 수전 (FAUCET) - 싱크볼 중앙 뒤쪽에 설치된 수도꼭지
이 두 가지가 없으면 싱크대가 아닙니다. 절대 누락하지 마세요!
`
    : '';

  const sinkSection3 = isSink
    ? `
═══════════════════════════════════════════════════════════════
[SECTION 3: 필수 설비]
═══════════════════════════════════════════════════════════════
【싱크볼 & 수전】
┌─────────────────────────────────────────────────────────────┐
│ 1. 싱크볼 (SINK BOWL)                                        │
│    - 하부장 상판에 매립된 스테인리스/화강석 싱크볼            │
│    - 크기: 가로 600-800mm 정도의 사각형 또는 원형 싱크        │
│                                                              │
│ 2. 수전 (FAUCET/TAP)                                         │
│    - 싱크볼 뒤쪽 중앙에 설치된 수도꼭지                      │
│    - 스테인리스 또는 크롬 마감의 현대적 디자인               │
│    - 단일 레버 또는 투핸들 타입                              │
└─────────────────────────────────────────────────────────────┘
※ 싱크볼 아래(개수대 하부): 배관과 수도 분배기만 (잡동사니 금지)

【쿡탑 & 레인지후드】
- 인덕션 또는 가스레인지: 적절한 위치에 반드시 배치
- 쿡탑 위에 레인지후드 배치
`
    : '';

  const sinkFinishLines = isSink
    ? `${sinkType ? `- Sink: ${sinkType}` : '- Sink: 스테인리스 싱크볼'}
${hoodType ? `- Hood: ${hoodType}` : '- Hood: 슬림형 레인지후드'}
${cooktopType ? `- Cooktop: ${cooktopType}` : '- Cooktop: 3구 인덕션'}`
    : '';

  const sinkForbiddenLine = isSink
    ? '❌ NO 싱크볼/쿡탑/후드 누락 → 반드시 SECTION 3 항목 모두 포함\n'
    : '';

  const sinkOutputBlock = isSink
    ? `
✓ MUST INCLUDE (없으면 실패):
  • 싱크볼 (SINK BOWL) - 하부장에 매립된 싱크
  • 수전 (FAUCET) - 싱크볼 뒤쪽 중앙의 수도꼭지
  • 쿡탑 (COOKTOP) - 인덕션 또는 가스레인지
  • 레인지후드 (RANGE HOOD) - 쿡탑 위

Under sink: clean pipes and water distributor only.`
    : '';

  return `[MOST IMPORTANT - READ FIRST]
This is a PHOTO generation task, NOT a technical drawing.
DO NOT ADD ANY TEXT, NUMBERS, DIMENSIONS, OR LABELS TO THE IMAGE.
The output must be a CLEAN photograph with NO annotations whatsoever.

${sinkCriticalBlock}[TASK: KOREAN BUILT-IN ${label.en} (${label.ko}) - PHOTOREALISTIC PHOTO]

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
${utilityPlacementPrompt}${sinkSection3}
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

[HANDLE - 핸드리스(매립형) 필수]
- All doors are handleless. Lower cabinet doors open by reaching behind the door (J-pull recessed handle on the top edge of each door).
- Upper cabinet doors: J-pull recessed handle on the bottom edge.
- Instead of visible hardware, use the J-pull recessed groove for grip.

═══════════════════════════════════════════════════════════════
[SECTION 5: 사용자 선택 테마/컬러 적용]
═══════════════════════════════════════════════════════════════
[STYLE: ${style}]
${styleKeywords ? styleKeywords : `Modern Korean minimalist ${label.en.toLowerCase()} with clean seamless door panels.`}
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
${sinkFinishLines}

═══════════════════════════════════════════════════════════════
[STRICTLY FORBIDDEN]
═══════════════════════════════════════════════════════════════
❌ NO chrome bar handles, NO push-to-open buttons, NO visible knobs → use J-pull recessed handles instead
${sinkForbiddenLine}❌ NO dimension labels, measurements, text, numbers, or characters → clean photograph only
❌ NO arrows, lines, technical markings, watermarks, or logos

═══════════════════════════════════════════════════════════════
[OUTPUT]
═══════════════════════════════════════════════════════════════
Clean photorealistic interior photograph of Korean ${label.en.toLowerCase()} (${label.ko}).
Magazine quality, professional lighting.
All unfinished areas naturally completed.
${sinkOutputBlock}
All cabinet doors CLOSED with user-selected color.`;
}

function buildSinkUtilityPlacementSection(wallData: WallAnalysis): string {
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

  // 아무것도 감지되지 않은 경우: AI가 적절한 위치 결정
  return `
═══════════════════════════════════════════════════════════════
[SECTION 2: 설비 배치 - AI 자동 결정]
═══════════════════════════════════════════════════════════════
배관 위치가 명확히 감지되지 않았습니다.
이미지를 분석하여 다음 원칙에 따라 적절한 위치에 설비를 배치하세요:

싱크볼 & 수전:
→ 물이 튀어도 되는 작업 공간 근처
→ 창문이 있다면 창문 앞 (자연광 활용)
→ 일반적으로 주방의 한쪽 끝에 배치

레인지후드 & 쿡탑:
→ 환기가 용이한 위치 (외벽 근처 선호)
→ 싱크대와 적절한 거리 유지 (작업 동선 고려)
→ 상부장이 없거나 후드 설치 가능한 공간

전체 레이아웃:
→ 한국 주방의 일반적인 동선: 냉장고 → 싱크대 → 조리대 → 쿡탑
→ 자연스럽고 기능적인 배치 우선`;
}
