const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'Dadam Interior v8 (Claude Analysis).json');
const outputFile = path.join(__dirname, 'Dadam Interior v8 (Claude Analysis) - updated.json');

const workflow = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

// Helper: find node by name
function findNode(name) {
  return workflow.nodes.find(n => n.name === name);
}

// ============================================================
// 0. Parse Input - add reference_images, material_descriptions extraction
// ============================================================
const parseInput = findNode('Parse Input');
if (parseInput) {
  // Replace the entire return block to include all new fields
  const origCode = parseInput.parameters.jsCode;
  // Find the return statement and replace it completely
  parseInput.parameters.jsCode = origCode.replace(
    /\/\/ 클라이언트 프롬프트[\s\S]*$/,
    `// 클라이언트 프롬프트 (상세 옵션 기반)
  const clientPrompt = body.prompt || '';
  const negativePrompt = body.negative_prompt || '';
  const cabinetSpecs = body.cabinet_specs || {};
  const referenceImages = body.reference_images || {};
  const materialDescriptions = body.material_descriptions || {};
  const modules = body.modules || {};

  return {
    category, style, roomImage, imageType, triggers,
    materialCodes, colorKeywords,
    hasMaterialRequest: materialCodes.length > 0 || colorKeywords.length > 0,
    clientPrompt, negativePrompt, cabinetSpecs,
    referenceImages, materialDescriptions, modules
  };`
  );
  console.log('✅ Parse Input updated (added referenceImages, materialDescriptions, modules)');
} else {
  console.log('❌ Parse Input not found');
}

// ============================================================
// 1. Build Claude Request - add clientPrompt, negativePrompt, cabinetSpecs passthrough
// ============================================================
const buildClaudeRequest = findNode('Build Claude Request');
if (buildClaudeRequest) {
  buildClaudeRequest.parameters.jsCode = `// ═══════════════════════════════════════════════════════════════
// Build Claude Analysis Request
// Claude API를 사용한 정밀 배관 분석
// ═══════════════════════════════════════════════════════════════
const input = $input.first().json;

const analysisPrompt = \`당신은 한국 주방 시공 현장의 배관 위치를 분석하는 전문가입니다.

이 이미지를 분석하여 다음 설비의 위치를 정확하게 찾아주세요.

[분석 대상]
1. 급수 배관 (Water Supply Pipe)
   - 특징: 빨간색/파란색 배관, 흰색 분배기 박스, PVC 배관
   - 보통 위치: 벽면 하단, 바닥에서 200-400mm 높이

2. 배기 덕트 (Exhaust Duct)
   - 특징: 알루미늄 플렉시블 덕트 (은색), 원형 구멍, 환기구
   - 보통 위치: 천장 근처, 상부 벽면

3. 가스 배관 (Gas Pipe)
   - 특징: 노란색 배관, 가스 밸브, 가스 콕
   - 보통 위치: 벽면 하단, 바닥에서 300-500mm 높이

4. 전기 콘센트 (Electrical Outlets)
   - 특징: 흰색 플라스틱 박스, 콘센트 커버
   - 보통 위치: 카운터 높이 (바닥에서 1000-1200mm)

[위치 측정 방법]
- 이미지의 가로를 0%~100%로 봅니다
- 0% = 이미지 맨 왼쪽
- 100% = 이미지 맨 오른쪽
- 각 설비의 중심점이 몇 % 위치에 있는지 측정하세요

[출력 형식 - 반드시 JSON만 출력]
{
  "image_analysis": {
    "wall_structure": {
      "lower_tile": "타일 색상 및 높이",
      "upper_wall": "상부 벽면 마감",
      "estimated_width_mm": 3000,
      "estimated_height_mm": 2400
    },
    "water_supply": {
      "detected": true,
      "position_percent": 38,
      "position_description": "이미지 왼쪽에서 약 38% 지점",
      "visual_features": "흰색 배관 박스, PVC 연결부",
      "height_from_floor": "약 350mm",
      "confidence": "high"
    },
    "exhaust_duct": {
      "detected": true,
      "position_percent": 72,
      "position_description": "이미지 왼쪽에서 약 72% 지점",
      "visual_features": "알루미늄 플렉시블 덕트, 은색",
      "height_from_floor": "천장 근처",
      "confidence": "high"
    },
    "gas_pipe": {
      "detected": false,
      "position_percent": null,
      "visual_features": null,
      "confidence": "low"
    },
    "electrical_outlets": [
      {
        "position_percent": 45,
        "height": "카운터 높이"
      }
    ],
    "construction_debris": [
      "작업대",
      "공구",
      "시멘트 포대"
    ]
  },
  "furniture_placement_recommendation": {
    "sink_center_percent": 38,
    "cooktop_center_percent": 72,
    "layout_direction": "left_to_right"
  }
}

중요: JSON 형식만 출력하세요. 다른 설명은 불필요합니다.\`;

const claudeRequestBody = {
  model: 'claude-sonnet-4-20250514',
  max_tokens: 2048,
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: input.imageType || 'image/jpeg',
            data: input.roomImage
          }
        },
        {
          type: 'text',
          text: analysisPrompt
        }
      ]
    }
  ]
};

return {
  claudeRequestBody: JSON.stringify(claudeRequestBody),
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  manualPositions: input.manualPositions,
  hasManualPositions: input.hasManualPositions,
  clientPrompt: input.clientPrompt || '',
  negativePrompt: input.negativePrompt || '',
  cabinetSpecs: input.cabinetSpecs || {},
  referenceImages: input.referenceImages || {},
  materialDescriptions: input.materialDescriptions || {},
  modules: input.modules || {}
};`;
  console.log('✅ Build Claude Request updated');
} else {
  console.log('❌ Build Claude Request not found');
}

// ============================================================
// 2. Parse Claude Result - add clientPrompt, negativePrompt, cabinetSpecs passthrough
// ============================================================
const parseClaudeResult = findNode('Parse Claude Result');
if (parseClaudeResult) {
  parseClaudeResult.parameters.jsCode = `// ═══════════════════════════════════════════════════════════════
// Parse Claude Analysis Result v2 - Manual Position 우선 적용
// ═══════════════════════════════════════════════════════════════
const input = $('Build Claude Request').first().json;
const response = $input.first().json;

// 수동 위치가 있는지 확인
const manualPos = input.manualPositions;
const hasManual = input.hasManualPositions;

let analysisResult = {
  water_supply_percent: 30,
  exhaust_duct_percent: 70,
  gas_pipe_percent: null,
  confidence: 'low',
  wall_width_mm: 3000,
  wall_height_mm: 2400,
  source: 'default'
};

// 1. 먼저 Claude 분석 결과 파싱 시도
try {
  const content = response.content || [];
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      const jsonMatch = block.text.match(/\\{[\\s\\S]*\\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        analysisResult = {
          water_supply_percent: parsed.image_analysis?.water_supply?.position_percent || parsed.furniture_placement_recommendation?.sink_center_percent || 30,
          water_supply_features: parsed.image_analysis?.water_supply?.visual_features || '',
          water_supply_confidence: parsed.image_analysis?.water_supply?.confidence || 'low',

          exhaust_duct_percent: parsed.image_analysis?.exhaust_duct?.position_percent || parsed.furniture_placement_recommendation?.cooktop_center_percent || 70,
          exhaust_duct_features: parsed.image_analysis?.exhaust_duct?.visual_features || '',
          exhaust_duct_confidence: parsed.image_analysis?.exhaust_duct?.confidence || 'low',

          gas_pipe_percent: parsed.image_analysis?.gas_pipe?.detected ? parsed.image_analysis.gas_pipe.position_percent : null,

          wall_width_mm: parsed.image_analysis?.wall_structure?.estimated_width_mm || 3000,
          wall_height_mm: parsed.image_analysis?.wall_structure?.estimated_height_mm || 2400,

          construction_debris: parsed.image_analysis?.construction_debris || [],

          confidence: (parsed.image_analysis?.water_supply?.confidence === 'high' && parsed.image_analysis?.exhaust_duct?.confidence === 'high') ? 'high' : 'medium',
          source: 'claude'
        };
      }
    }
  }
} catch (e) {
  console.log('Parse error:', e.message);
}

// 2. 수동 위치가 있으면 덮어쓰기 (최우선 적용!)
if (hasManual) {
  if (manualPos.water_pipe) {
    analysisResult.water_supply_percent = manualPos.water_pipe.x;
    analysisResult.water_supply_features = '사용자 직접 표시';
    analysisResult.water_supply_confidence = 'manual';
  }
  if (manualPos.exhaust_duct) {
    analysisResult.exhaust_duct_percent = manualPos.exhaust_duct.x;
    analysisResult.exhaust_duct_features = '사용자 직접 표시';
    analysisResult.exhaust_duct_confidence = 'manual';
  }
  analysisResult.source = 'manual';
  analysisResult.confidence = 'high'; // 사용자 표시는 항상 신뢰도 high
}

return [{
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  analysisResult,
  analysisMethod: hasManual ? 'manual' : 'claude',
  clientPrompt: input.clientPrompt || '',
  negativePrompt: input.negativePrompt || '',
  cabinetSpecs: input.cabinetSpecs || {},
  referenceImages: input.referenceImages || {},
  materialDescriptions: input.materialDescriptions || {},
  modules: input.modules || {}
}];`;
  console.log('✅ Parse Claude Result updated');
} else {
  console.log('❌ Parse Claude Result not found');
}

// ============================================================
// 3. Build Cleanup Prompt - add clientPrompt, negativePrompt, cabinetSpecs passthrough
// ============================================================
const buildCleanupPrompt = findNode('Build Cleanup Prompt');
if (buildCleanupPrompt) {
  buildCleanupPrompt.parameters.jsCode = `// ═══════════════════════════════════════════════════════════════
// Build Background Cleanup Prompt v2
// 전선 제거 + 미마감 부분 보정 추가
// ═══════════════════════════════════════════════════════════════
const input = $input.first().json;
const analysis = input.analysisResult;

const debrisList = analysis.construction_debris?.length > 0
  ? analysis.construction_debris.join(', ')
  : '공사 잔해, 공구, 임시 물건';

const cleanupPrompt = \`[TASK: BACKGROUND CLEANUP - STRUCTURE PRESERVATION]

★★★ ABSOLUTE RULES ★★★

[MUST PRESERVE - 절대 변경 금지]
1. 벽면 위치와 각도
2. 바닥 위치와 레벨
3. 천장 높이와 위치
4. 창문/문 위치와 크기
5. 카메라 앵글과 시점
6. 조명 방향

[MUST REMOVE - 제거 대상]
\${debrisList}
- 사람
- 옷걸이와 옷
- 임시 작업대
- 공구와 장비
- 시멘트 포대
- 모든 공사 잔해

★★★ 전선 제거 - WIRE REMOVAL ★★★
- 노출된 전선 모두 제거
- 벽면에 드러난 배선 제거
- 천장의 노출 전선 제거
- 전선이 있던 자리는 주변 벽면/천장과 동일하게 보정

★★★ 미마감 부분 보정 - UNFINISHED AREA REPAIR ★★★
- 마감되지 않은 벽면: 주변의 비슷한 소재/색상으로 자연스럽게 보정
- 마감되지 않은 천장: 주변 천장과 동일한 색상(흰색)으로 보정
- 석고보드 노출 부분: 주변 마감재와 동일하게 처리
- 시멘트/콘크리트 노출: 주변 타일이나 페인트로 자연스럽게 연결
- 타일이 빠진 부분: 주변 타일 패턴과 동일하게 채우기

★★★ 배기덕트 주변 마감 - EXHAUST DUCT AREA FINISHING ★★★
- 덕트 주변 벽면: 매끄럽게 페인트 처리 (흰색 또는 주변 벽 색상)
- 덕트 주변 얼룩/먼지: 완전히 제거

[MUST IMPROVE - 마감 처리]
1. 벽면 하단: 기존 타일 패턴 유지하며 깨끗하게
2. 벽면 상단: 주변과 동일한 색상으로 매끄럽게
3. 바닥: 깨끗한 타일 또는 마감재
4. 천장: 깨끗한 흰색, 조명 유지

[KEEP VISIBLE - 유지할 설비 (깔끔하게 마감된 상태로)]
- 급수 배관 위치: \${analysis.water_supply_percent}% 지점
  → 깔끔한 벽면에 배관 연결부만 표시 (캡 씌운 상태)
- 배기 덕트 위치: \${analysis.exhaust_duct_percent}% 지점
  → 덕트 주변 벽면/천장은 매끄럽게 마감
\${analysis.gas_pipe_percent ? '- 가스 배관 위치: ' + analysis.gas_pipe_percent + '% 지점 (깔끔한 가스 밸브만 표시)' : ''}

[OUTPUT]
- 깨끗하게 마감된 빈 공간
- 전선 없음
- 미마감 부분 없음
- 가구 설치 준비 완료 상태\`;

const geminiCleanupBody = {
  contents: [{
    parts: [
      { text: cleanupPrompt },
      { inline_data: { mime_type: input.imageType || 'image/jpeg', data: input.roomImage }}
    ]
  }],
  generationConfig: { responseModalities: ['image', 'text'], temperature: 0.3 }
};

return {
  geminiCleanupBody: JSON.stringify(geminiCleanupBody),
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  analysisResult: analysis,
  clientPrompt: input.clientPrompt || '',
  negativePrompt: input.negativePrompt || '',
  cabinetSpecs: input.cabinetSpecs || {},
  referenceImages: input.referenceImages || {},
  materialDescriptions: input.materialDescriptions || {},
  modules: input.modules || {}
};`;
  console.log('✅ Build Cleanup Prompt updated');
} else {
  console.log('❌ Build Cleanup Prompt not found');
}

// ============================================================
// 4. Parse BG + Build Furniture - add color specs, hood duct prohibition, client prompt
// ============================================================
const parseBGBuildFurniture = findNode('Parse BG + Build Furniture');
if (parseBGBuildFurniture) {
  parseBGBuildFurniture.parameters.jsCode = `// ═══════════════════════════════════════════════════════════════
// Parse Background + Build Furniture Prompt (Claude 분석 결과 사용)
// + Client Design Options + Reference Images from Catalog
// ═══════════════════════════════════════════════════════════════
const input = $('Build Cleanup Prompt').first().json;
const response = $input.first().json;
const analysis = input.analysisResult;

// Client design data
const clientPrompt = input.clientPrompt || '';
const negativePrompt = input.negativePrompt || '';
const cabinetSpecs = input.cabinetSpecs || {};
const referenceImages = input.referenceImages || {};
const materialDescriptions = input.materialDescriptions || {};
const modules = input.modules || {};

let cleanedBackground = null;
try {
  const candidates = response.candidates || [];
  if (candidates.length > 0) {
    const parts = candidates[0].content?.parts || [];
    for (const part of parts) {
      if (part.inlineData || part.inline_data) {
        cleanedBackground = (part.inlineData || part.inline_data).data;
      }
    }
  }
} catch (e) { console.log('Parse error:', e.message); }

// Position description function
function describePosition(percent) {
  if (percent <= 20) return 'far left area';
  if (percent <= 40) return 'left area';
  if (percent <= 60) return 'center area';
  if (percent <= 80) return 'right area';
  return 'far right area';
}

const waterPercent = analysis.water_supply_percent;
const exhaustPercent = analysis.exhaust_duct_percent;
const waterDesc = describePosition(waterPercent);
const exhaustDesc = describePosition(exhaustPercent);

// ─── Use materialDescriptions from catalog (already translated) ───
let colorSpecLines = [];
if (materialDescriptions && Object.keys(materialDescriptions).length > 0) {
  const md = materialDescriptions;
  if (md.upper_door_color) colorSpecLines.push('Upper cabinets: ' + md.upper_door_color + (md.upper_door_finish ? ' ' + md.upper_door_finish : '') + ' doors.');
  if (md.lower_door_color) colorSpecLines.push('Lower cabinets: ' + md.lower_door_color + (md.lower_door_finish ? ' ' + md.lower_door_finish : '') + ' doors.');
  if (md.countertop) colorSpecLines.push('Countertop: ' + md.countertop + ' surface.');
  if (md.handle) colorSpecLines.push('Hardware: ' + md.handle + '.');
  if (md.hood) colorSpecLines.push('Range hood: ' + md.hood + '.');
  if (md.cooktop) colorSpecLines.push('Cooktop: ' + md.cooktop + '.');
  if (md.sink) colorSpecLines.push('Sink: ' + md.sink + '.');
  if (md.faucet) colorSpecLines.push('Faucet: ' + md.faucet + '.');
} else if (cabinetSpecs && Object.keys(cabinetSpecs).length > 0) {
  // Fallback: translate from cabinetSpecs using hardcoded maps
  const colorMapKo = {
    '화이트': 'pure white', '그레이': 'gray', '블랙': 'matte black',
    '아이보리': 'warm ivory', '오크': 'natural oak wood', '월넛': 'dark walnut wood',
    '스노우': 'snow white', '마블화이트': 'white marble', '그레이마블': 'gray marble',
    '차콜': 'charcoal', '베이지': 'beige', '네이비': 'navy blue'
  };
  const finishMapKo = { '무광': 'matte finish', '유광': 'glossy finish', '엠보': 'embossed texture' };
  const t = (m, k) => m[k] || k || '';

  const uc = t(colorMapKo, cabinetSpecs.door_color_upper);
  const uf = t(finishMapKo, cabinetSpecs.door_finish_upper);
  const lc = t(colorMapKo, cabinetSpecs.door_color_lower);
  const lf = t(finishMapKo, cabinetSpecs.door_finish_lower);
  const tc = t(colorMapKo, cabinetSpecs.countertop_color);

  if (uc) colorSpecLines.push('Upper cabinets: ' + uc + (uf ? ' ' + uf : '') + ' doors.');
  if (lc) colorSpecLines.push('Lower cabinets: ' + lc + (lf ? ' ' + lf : '') + ' doors.');
  if (tc) colorSpecLines.push('Countertop: ' + tc + ' surface.');
}

// ─── Build furniture prompt ───
let furniturePrompt = \`[TASK: FURNITURE PLACEMENT - CLAUDE ANALYZED POSITIONS]

★★★ PRESERVE BACKGROUND ★★★
This image is a cleaned background.
Do NOT modify the background. Only add furniture.

═══════════════════════════════════════════════════════════════
★★★ PRECISE PLACEMENT BASED ON CLAUDE AI ANALYSIS ★★★
═══════════════════════════════════════════════════════════════

[Analysis Confidence: \${analysis.confidence}]

[Reference Point 1: Water Supply → Sink Bowl Center]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Position: \${waterPercent}% from left (\${waterDesc})
Features: \${analysis.water_supply_features || 'pipe box'}
Confidence: \${analysis.water_supply_confidence || 'medium'}

→ Place SINK BOWL center at exactly \${waterPercent}% position
→ FAUCET behind sink bowl center
→ Sink cabinet centered on sink bowl

[Reference Point 2: Exhaust Duct → Cooktop Center]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Position: \${exhaustPercent}% from left (\${exhaustDesc})
Features: \${analysis.exhaust_duct_features || 'aluminum duct'}
Confidence: \${analysis.exhaust_duct_confidence || 'medium'}

→ Place COOKTOP center at exactly \${exhaustPercent}% position
→ RANGE HOOD directly above cooktop, same center line
→ Cooktop cabinet centered on cooktop

[Kitchen Components - Required]
✓ Sink Bowl - stainless steel, \${waterPercent}% position
✓ Faucet - behind sink bowl
✓ Cooktop - \${exhaustPercent}% position
✓ Range Hood - above cooktop
✓ Lower Cabinet - height 870mm
✓ Upper Cabinet - flush with ceiling (NO gap between ceiling and upper cabinet)
✓ Toe Kick - below lower cabinet\`;

// ─── Add precise dimension specs from cabinetSpecs ───
if (cabinetSpecs.total_width_mm) {
  let dimLines = [];
  dimLines.push('Total cabinet width: ' + cabinetSpecs.total_width_mm + 'mm');
  if (cabinetSpecs.total_height_mm) dimLines.push('Total height: ' + cabinetSpecs.total_height_mm + 'mm');
  if (cabinetSpecs.depth_mm) dimLines.push('Depth: ' + cabinetSpecs.depth_mm + 'mm');
  dimLines.push('Upper cabinet height: ' + (cabinetSpecs.upper_cabinet_height || 720) + 'mm');
  dimLines.push('Lower cabinet height: ' + (cabinetSpecs.lower_cabinet_height || 870) + 'mm');
  dimLines.push('Countertop thickness: ' + (cabinetSpecs.countertop_thickness || 20) + 'mm');
  dimLines.push('Toe kick height: ' + (cabinetSpecs.leg_height || 150) + 'mm');
  dimLines.push('Top molding height: ' + (cabinetSpecs.molding_height || 60) + 'mm');

  furniturePrompt += \`

═══════════════════════════════════════════════════════════════
★★★ PRECISE CABINET DIMENSIONS ★★★
═══════════════════════════════════════════════════════════════
\${dimLines.join('\\n')}

[Height breakdown from floor to ceiling]
Floor → Toe kick (\${cabinetSpecs.leg_height || 150}mm) → Lower cabinet (\${cabinetSpecs.lower_cabinet_height || 870}mm) → Countertop (\${cabinetSpecs.countertop_thickness || 20}mm) → Backsplash gap → Upper cabinet (\${cabinetSpecs.upper_cabinet_height || 720}mm) → Top molding (\${cabinetSpecs.molding_height || 60}mm) → Ceiling\`;
}

// ─── Add module layout info ───
const upperMods = modules.upper || [];
const lowerMods = modules.lower || [];
if (lowerMods.length > 0 || upperMods.length > 0) {
  let modLines = [];

  if (lowerMods.length > 0) {
    modLines.push('[Lower Modules - left to right] (' + lowerMods.length + ' modules)');
    for (const m of lowerMods) {
      let desc = '  ' + (m.position_from_left_mm || 0) + 'mm: ';
      desc += (m.name || 'Cabinet') + ' (W' + (m.width_mm || m.w || 0) + 'mm)';
      if (m.has_sink) desc += ' ← SINK HERE';
      if (m.has_cooktop) desc += ' ← COOKTOP HERE';
      if (m.is_drawer) desc += ' [drawer]';
      else desc += ' [' + (m.door_count || 1) + '-door]';
      modLines.push(desc);
    }
  }

  if (upperMods.length > 0) {
    modLines.push('[Upper Modules - left to right] (' + upperMods.length + ' modules)');
    for (const m of upperMods) {
      let desc = '  ' + (m.position_from_left_mm || 0) + 'mm: ';
      desc += (m.name || 'Cabinet') + ' (W' + (m.width_mm || m.w || 0) + 'mm)';
      if (m.is_drawer) desc += ' [drawer]';
      else desc += ' [' + (m.door_count || 1) + '-door]';
      modLines.push(desc);
    }
  }

  // Sink/Cooktop exact positions in mm
  if (cabinetSpecs.sink_position_mm !== undefined) {
    modLines.push('Sink center at: ' + cabinetSpecs.sink_position_mm + 'mm from left edge');
  }
  if (cabinetSpecs.cooktop_position_mm !== undefined) {
    modLines.push('Cooktop center at: ' + cabinetSpecs.cooktop_position_mm + 'mm from left edge');
  }

  // Finish (left/right filler/molding)
  if (cabinetSpecs.finish_left_type && cabinetSpecs.finish_left_type !== 'None') {
    modLines.push('Left finish: ' + cabinetSpecs.finish_left_type + ' ' + (cabinetSpecs.finish_left_width || 60) + 'mm');
  }
  if (cabinetSpecs.finish_right_type && cabinetSpecs.finish_right_type !== 'None') {
    modLines.push('Right finish: ' + cabinetSpecs.finish_right_type + ' ' + (cabinetSpecs.finish_right_width || 60) + 'mm');
  }

  furniturePrompt += \`

★★★ MODULE LAYOUT (exact widths & positions) ★★★
\${modLines.join('\\n')}

→ Maintain these WIDTH PROPORTIONS when rendering each cabinet door/drawer\`;
}

// Add client color/material specs
if (colorSpecLines.length > 0) {
  furniturePrompt += \`

★★★ CLIENT SPECIFIED COLORS & MATERIALS ★★★
\${colorSpecLines.join('\\n')}\`;
} else {
  furniturePrompt += \`

[Style: Modern Minimal]
- Colors: white, gray, wood tone
- Finish: matte
- Handle: hidden (push-open)\`;
}

// Add client prompt if provided
if (clientPrompt) {
  furniturePrompt += \`

★★★ ADDITIONAL CLIENT REQUIREMENTS ★★★
\${clientPrompt}\`;
}

furniturePrompt += \`

★★★ UPPER CABINET RULES ★★★
- Upper cabinet top MUST be flush with ceiling
- NO gap between ceiling and upper cabinet
- Upper cabinet height: from ceiling down to above counter

[Verification Checklist]
☑ Sink bowl center = \${waterPercent}% ?
☑ Faucet behind sink bowl?
☑ Cooktop center = \${exhaustPercent}% ?
☑ Range hood above cooktop?
☑ Upper cabinet flush with ceiling? (no gap)

[PROHIBITED]
❌ Do NOT modify background/wall/floor
❌ No text/labels/dimensions
❌ Do NOT omit sink bowl/faucet
❌ Do NOT misplace cooktop
❌ NO exposed hood duct or ventilation pipe
❌ NO external ductwork on wall or ceiling
❌ NO visible exhaust pipe or silver/metallic duct tube\`;

// Add negative prompt if provided
if (negativePrompt) {
  furniturePrompt += \`

[NEGATIVE PROMPT - MUST AVOID]
\${negativePrompt}\`;
}

// ─── Build Gemini parts with reference images ───
const geminiParts = [
  { text: furniturePrompt },
  { inline_data: { mime_type: 'image/png', data: cleanedBackground } }
];

// Fetch reference images and add to parts (max 3, prioritized)
const fetchPriority = ['doorColorUpper', 'topColor', 'handle'];
const fetchedRefImages = [];
for (const key of fetchPriority) {
  if (referenceImages[key]?.url && fetchedRefImages.length < 3) {
    try {
      const resp = await fetch(referenceImages[key].url);
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        const b64 = Buffer.from(buf).toString('base64');
        fetchedRefImages.push({ key, base64: b64, description: referenceImages[key].prompt_description });
      }
    } catch (e) { /* skip failed fetches */ }
  }
}

// Add reference images to Gemini parts
for (const img of fetchedRefImages) {
  geminiParts.push({ text: '[REFERENCE MATERIAL: ' + img.description + ' - Match this color/texture exactly]' });
  geminiParts.push({ inline_data: { mime_type: 'image/jpeg', data: img.base64 } });
}

const geminiFurnitureBody = {
  contents: [{ parts: geminiParts }],
  generationConfig: { responseModalities: ['image', 'text'], temperature: 0.4 }
};

return [{
  cleanedBackground,
  hasCleanedBackground: !!cleanedBackground,
  geminiFurnitureBody: JSON.stringify(geminiFurnitureBody),
  category: input.category,
  style: input.style,
  analysisResult: analysis,
  referenceImageCount: fetchedRefImages.length
}];`;
  console.log('✅ Parse BG + Build Furniture updated');
} else {
  console.log('❌ Parse BG + Build Furniture not found');
}

// Save the updated workflow
fs.writeFileSync(outputFile, JSON.stringify(workflow, null, 2), 'utf8');
console.log('\n✅ Updated file saved to:', outputFile);
