// ═══════════════════════════════════════════════════════════════
// Closed Door Prompt Builder (Single Source of Truth)
// 기존: http-server.ts 783~996줄
//
// 카테고리 독립 적용:
// - 모든 카테고리(sink/wardrobe/fridge/vanity/shoe/storage)는 같은 골격으로
//   동작한다. 카테고리별 외관 명세는 CATEGORY_META 에 정의되어 있고,
//   본문에서 슬롯으로 보간된다.
// - sink 전용 흐름(배관 위치 안내, SECTION 6 sink/hood/cooktop 라인)은
//   여전히 isSink 게이팅으로 처리한다 — 다른 카테고리에는 배관 컨텍스트가
//   존재하지 않으므로 별도 흐름이 적절.
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

interface CategoryMeta {
  ko: string;
  en: string;
  // ★★★ 블록 — 각 카테고리에서 가장 흔한 실패 1개만 (다이어트 원칙)
  criticalRequirement: string;
  // SECTION 3 본문 — 도어 닫힘 상태에서 보여야 할 카테고리 외관 요소
  section3: string;
  // [STRICTLY FORBIDDEN]에 추가될 카테고리 누설 금지 라인
  forbiddenItem: string;
  // [OUTPUT] 체크리스트 (최대 4줄)
  outputChecklist: string;
}

// 카테고리 메타는 도메인 단서에서 수집:
// - 옷장: ui-workspace.js, calc-engine.js (짝수 도어/좌대 60mm/상몰딩 20mm)
// - 냉장고장: data-constants.js:39-41, ui-fridge-el.js:13-16
//   (모듈깊이 550mm/설치깊이 700mm/상단갭 10mm/유닛간 8-10mm/상몰딩 50mm)
// - 신발장/수납장: data-constants.js (깊이 350/400mm/좌대 60mm)
// - 화장대: 도메인 일반 (거울 상부 + 카운터/세면 하부)
const CATEGORY_META: Record<string, CategoryMeta> = {
  sink: {
    ko: '싱크대',
    en: 'KITCHEN',
    criticalRequirement: `싱크대(SINK CABINET)에는 반드시 다음이 포함되어야 합니다:
1. 싱크볼 (SINK BOWL) - 스테인리스 또는 화강석 싱크볼
2. 수전 (FAUCET) - 싱크볼 중앙 뒤쪽에 설치된 수도꼭지
이 두 가지가 없으면 싱크대가 아닙니다. 절대 누락하지 마세요!`,
    section3: `【싱크볼 & 수전】
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
- 쿡탑이 있는 모듈의 하부장은 모두 서랍(drawer)으로 구성 — 여닫이 도어 금지
  (조리 도구·냄비·팬 수납을 위해 슬라이드 서랍이 한국 주방 표준)

【하부장 J-pull 상단 갭 - 시각적 핵심】
- 카운터탑(상판)과 하부장 도어 상단 사이에 약 30mm 가로 틈이 있어야 함
- 이 30mm 갭이 J-pull 핸들의 시각 표현 — 손가락을 넣어 도어/서랍을 당김
- 갭은 균일하게 가로로 캐비닛 폭 전체에 뻗어 있어야 함
- 도어 표면 자체에는 손잡이/홈/노브 없음 (갭이 유일한 그립)`,
    forbiddenItem: '❌ NO 싱크볼/쿡탑/후드 누락, NO 쿡탑 아래 여닫이 도어, NO 카운터탑-도어 밀착 → 30mm J-pull 갭 유지',
    outputChecklist: `  • 싱크볼 (SINK BOWL) - 하부장에 매립된 싱크
  • 수전 (FAUCET) - 싱크볼 뒤쪽 중앙의 수도꼭지
  • 쿡탑 (COOKTOP) - 인덕션 또는 가스레인지
  • 레인지후드 (RANGE HOOD) - 쿡탑 위
  • 쿡탑 모듈 하부장은 모두 서랍 (drawer)
  • 카운터탑과 하부장 도어 사이 30mm J-pull 갭`,
  },

  wardrobe: {
    ko: '옷장',
    en: 'WARDROBE',
    criticalRequirement: `옷장(WARDROBE)은 다음 조건을 반드시 만족해야 합니다:
1. 짝수 개수의 매립형 도어 (예: 4/6/8 도어) — 홀수 도어 금지
2. 도어 비율은 세로로 길쭉한 직사각형 (행거 수납 공간 확보)
3. 도어는 모두 닫힌 상태 — 내부 행거바·서랍은 외부에서 보이지 않음`,
    section3: `【옷장 외관】
- 짝수 개수의 매립형 도어 (4/6/8 도어 등) — 홀수 도어 절대 금지
- 도어 비율: 세로로 길쭉한 직사각형 (옷걸이 수납을 위한 높은 비율)
- 좌대 (pedestal): 바닥에서 60mm 띄움, 도어 아래로 살짝 보임
- 상몰딩 (crown molding): 천장과 캐비닛 사이 20mm
- 모든 도어 색상·재질 통일 (사용자 선택 컬러)
- 내부 행거바·서랍·선반은 도어 닫힘 상태이므로 외부에서 보이지 않음`,
    forbiddenItem: '❌ NO 싱크볼/수전/쿡탑/후드/거울장/냉장고 → 옷장에는 매립형 도어 외관만',
    outputChecklist: `  • 짝수 개수의 도어 (홀수 금지)
  • 세로로 길쭉한 도어 비율
  • 좌대(60mm)·상몰딩(20mm) 명확
  • 매립형 J-pull 핸들`,
  },

  fridge: {
    ko: '냉장고장',
    en: 'FRIDGE CABINET',
    criticalRequirement: `냉장고장(FRIDGE CABINET)에는 반드시 다음이 포함되어야 합니다:
1. 중앙: 빌트인 양문 또는 4도어 냉장고 본체 (LG/삼성 Bespoke 또는 Infinite 스타일)
2. 측면: 키큰장 (tall side cabinets) — 한쪽 또는 양쪽
3. 상부: 냉장고 위 상부장`,
    section3: `【냉장고 본체】 - 중앙
- 빌트인 양문 또는 4도어 냉장고 (LG/삼성 Bespoke / Infinite 스타일 외관)
- 냉장고 도어 색상은 본체 색상과 매치 또는 캐비닛 컬러로 통일

【측면 키큰장 & 상부장】
- 측면 키큰장 (tall side cabinet): 냉장고 한쪽 또는 양옆에 배치
- 상부장: 냉장고 위쪽, 자동 계산된 높이 (최대 400mm)

【갭 명세 - 매우 중요】
- 냉장고와 상부장 사이: 10mm 갭 (균일하게)
- 유닛 간 틈새: 8-10mm
- 측면 여유 공간: 4-50mm
- 좌대: 60mm, 상몰딩: 50mm
- 모듈 깊이: 550mm (설치 깊이 700mm)`,
    forbiddenItem: '❌ NO 싱크볼/수전/쿡탑/후드/거울장/행거바 → 냉장고장에는 냉장고+측면 키큰장+상부장만',
    outputChecklist: `  • 중앙 빌트인 냉장고 본체
  • 측면 키큰장 (한쪽 또는 양쪽)
  • 냉장고 위 상부장
  • 10mm 상단 갭 + 8-10mm 유닛 간 틈새`,
  },

  vanity: {
    ko: '화장대',
    en: 'VANITY',
    criticalRequirement: `화장대(VANITY)에는 반드시 다음이 포함되어야 합니다:
1. 상부: 거울 (mirror) — 화장대의 가장 핵심 식별 요소
2. 하부: 카운터탑 (countertop) 또는 세면대
3. 수납: 매립형 도어/서랍`,
    section3: `【화장대 외관】
- 상부: 거울 캐비닛 (mirror cabinet) — 거울이 도어 표면이거나 도어 안에 위치
  → 거울은 화장대 폭과 동일하거나 약간 좁게
- 하부: 카운터탑 (사용자 선택 색상 또는 스노우 화이트)
- 조명: 거울 주변 또는 상단에 LED 라인 조명 (선택)
- 수납: 카운터탑 아래 매립형 도어 또는 서랍`,
    forbiddenItem: '❌ NO 싱크볼/쿡탑/후드/냉장고/행거바 → 화장대에는 거울+카운터탑+수납 도어만',
    outputChecklist: `  • 거울 (상부) — 가장 큰 식별 요소
  • 카운터탑 또는 세면대 (하부)
  • 매립형 수납 도어/서랍
  • 매립형 J-pull 핸들`,
  },

  shoe: {
    ko: '신발장',
    en: 'SHOE CABINET',
    criticalRequirement: `신발장(SHOE CABINET)은 다음 조건을 만족해야 합니다:
1. 매립형 도어로 마감된 신발 수납 캐비닛 외관
2. 옷장보다 얕은 깊이감 (350mm) — 외관에서 옅게 드러남
3. 도어는 모두 닫힌 상태 — 내부 신발은 외부에서 보이지 않음`,
    section3: `【신발장 외관】
- 매립형 도어로 마감된 신발 수납 캐비닛 (현관 분위기에 맞춤)
- 깊이 350mm (옷장 600mm보다 얕음 — 측면 시점에서 옅게 드러남)
- 도어 구성: 키 큰 도어 1~2단 또는 작은 모듈 다수
- 환기를 위한 슬릿이 도어에 있을 수 있음 (선택)
- 좌대 60mm — 바닥에서 살짝 띄움
- 내부 신발은 도어 닫힘 상태이므로 외부에서 보이지 않음`,
    forbiddenItem: '❌ NO 싱크볼/수전/쿡탑/후드/거울장/냉장고/행거바 → 신발장에는 도어형 수납만',
    outputChecklist: `  • 매립형 신발장 도어
  • 얕은 깊이 (350mm) 인상
  • 좌대(60mm) 명확
  • 도어 색상 통일`,
  },

  storage: {
    ko: '수납장',
    en: 'STORAGE CABINET',
    criticalRequirement: `수납장(STORAGE CABINET)은 다음 조건을 만족해야 합니다:
1. 깔끔한 매립형 도어로 마감된 일반 수납 캐비닛
2. 모든 도어 색상·재질 통일
3. 도어는 모두 닫힌 상태`,
    section3: `【수납장 외관】
- 깔끔한 매립형 도어 (도어 색상 통일)
- 깊이 400mm
- 좌대: 60mm, 몰딩/필러 마감: 60mm
- 모듈 분할은 SECTION 4에 명시된 대로
- 내부 수납물(책/박스/이불 등)은 도어 닫힘 상태이므로 외부에서 보이지 않음`,
    forbiddenItem: '❌ NO 싱크볼/수전/쿡탑/후드/거울장/냉장고/행거바 → 수납장에는 도어형 수납만',
    outputChecklist: `  • 깔끔한 매립형 도어
  • 좌대(60mm) + 몰딩/필러 마감
  • 도어 색상 통일
  • 매립형 J-pull 핸들`,
  },
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
  const meta = CATEGORY_META[category] || CATEGORY_META.storage;

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

  // sink 전용: SECTION 6 sink/hood/cooktop 마감재 라인
  const sinkFinishLines = isSink
    ? `${sinkType ? `- Sink: ${sinkType}` : '- Sink: 스테인리스 싱크볼'}
${hoodType ? `- Hood: ${hoodType}` : '- Hood: 슬림형 레인지후드'}
${cooktopType ? `- Cooktop: ${cooktopType}` : '- Cooktop: 3구 인덕션'}`
    : '';

  return `[MOST IMPORTANT - READ FIRST]
This is a PHOTO generation task, NOT a technical drawing.
DO NOT ADD ANY TEXT, NUMBERS, DIMENSIONS, OR LABELS TO THE IMAGE.
The output must be a CLEAN photograph with NO annotations whatsoever.

★★★ CRITICAL REQUIREMENT - 절대 누락 금지 ★★★
${meta.criticalRequirement}

[TASK: KOREAN BUILT-IN ${meta.en} (${meta.ko}) - PHOTOREALISTIC PHOTO]

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
[SECTION 3: 카테고리 외관 요소]
═══════════════════════════════════════════════════════════════
${meta.section3}

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
${styleKeywords ? styleKeywords : `Modern Korean minimalist ${meta.en.toLowerCase()} with clean seamless door panels.`}
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
${meta.forbiddenItem}
❌ NO dimension labels, measurements, text, numbers, or characters → clean photograph only
❌ NO arrows, lines, technical markings, watermarks, or logos

═══════════════════════════════════════════════════════════════
[OUTPUT]
═══════════════════════════════════════════════════════════════
Clean photorealistic interior photograph of Korean ${meta.en.toLowerCase()} (${meta.ko}).
Magazine quality, professional lighting.
All unfinished areas naturally completed.

✓ MUST INCLUDE (없으면 실패):
${meta.outputChecklist}

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
