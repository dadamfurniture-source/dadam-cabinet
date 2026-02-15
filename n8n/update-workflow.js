const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'Dadam Interior v8 (Claude Analysis).json');
const outputFile = path.join(__dirname, 'Dadam Interior v8 (Claude Analysis) - updated.json');
const rulesFile = path.join(__dirname, 'image-gen-rules.json');

const workflow = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

// ─── Load externalized rules ───
const rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
const RULES_JSON = JSON.stringify(rules);
console.log(`📜 Loaded image-gen-rules.json v${rules._version}`);

// Helper: find node by name
function findNode(name) {
  return workflow.nodes.find(n => n.name === name);
}

// ============================================================
// 0. Parse Input - extract all fields including mask_image
// ============================================================
const parseInput = findNode('Parse Input');
if (parseInput) {
  const origCode = parseInput.parameters.jsCode;
  parseInput.parameters.jsCode = origCode.replace(
    /\/\/ 클라이언트 프롬프트[\s\S]*$/,
    `// 클라이언트 프롬프트 (상세 옵션 기반)
  const clientPrompt = body.prompt || '';
  const negativePrompt = body.negative_prompt || '';
  const cabinetSpecs = body.cabinet_specs || {};
  const referenceImages = body.reference_images || {};
  const materialDescriptions = body.material_descriptions || {};
  const modules = body.modules || {};
  const layoutImage = body.layout_image || '';
  const layoutData = body.layout_data || {};
  const maskImage = body.mask_image || '';
  const manualPositions = body.manual_positions || null;
  const hasManualPositions = body.has_manual_positions || false;

  return {
    category, style, roomImage, imageType, triggers,
    materialCodes, colorKeywords,
    hasMaterialRequest: materialCodes.length > 0 || colorKeywords.length > 0,
    clientPrompt, negativePrompt, cabinetSpecs,
    referenceImages, materialDescriptions, modules,
    layoutImage, layoutData, maskImage,
    manualPositions, hasManualPositions
  };`
  );
  console.log('✅ Parse Input updated (+maskImage)');
} else {
  console.log('❌ Parse Input not found');
}

// ============================================================
// 1. Build Claude Request - passthrough all fields
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
  modules: input.modules || {},
  layoutImage: input.layoutImage || '',
  layoutData: input.layoutData || {},
  maskImage: input.maskImage || ''
};`;
  console.log('✅ Build Claude Request updated (+maskImage passthrough)');
} else {
  console.log('❌ Build Claude Request not found');
}

// ============================================================
// 2. Parse Claude Result - passthrough all fields
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
  analysisResult.confidence = 'high';
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
  modules: input.modules || {},
  layoutImage: input.layoutImage || '',
  layoutData: input.layoutData || {},
  maskImage: input.maskImage || ''
}];`;
  console.log('✅ Parse Claude Result updated (+maskImage passthrough)');
} else {
  console.log('❌ Parse Claude Result not found');
}

// ============================================================
// 3. Build Cleanup Prompt - rules from JSON + maskImage passthrough
// ============================================================
const buildCleanupPrompt = findNode('Build Cleanup Prompt');
if (buildCleanupPrompt) {
  // Embed cleanup rules from external JSON
  const cleanupRules = rules.cleanup;
  const preserveList = cleanupRules.preserve.map((r, i) => `${i + 1}. ${r}`).join('\n');
  const removeList = cleanupRules.remove.map(r => `- ${r}`).join('\n');
  const wireList = cleanupRules.wire_removal.map(r => `- ${r}`).join('\n');
  const repairList = cleanupRules.unfinished_repair.map(r => `- ${r}`).join('\n');
  const exhaustList = cleanupRules.exhaust_area_finishing.map(r => `- ${r}`).join('\n');
  const improveList = cleanupRules.improvement.map((r, i) => `${i + 1}. ${r}`).join('\n');
  const plumbingList = cleanupRules.plumbing_visibility.map(r => `- ${r}`).join('\n');

  buildCleanupPrompt.parameters.jsCode = `// ═══════════════════════════════════════════════════════════════
// Build Background Cleanup Prompt v3 - Rules from image-gen-rules.json
// ═══════════════════════════════════════════════════════════════
const input = $input.first().json;
const analysis = input.analysisResult;

const debrisList = analysis.construction_debris?.length > 0
  ? analysis.construction_debris.join(', ')
  : '공사 잔해, 공구, 임시 물건';

const cleanupPrompt = \`[TASK: BACKGROUND CLEANUP - STRUCTURE PRESERVATION]

★★★ ABSOLUTE RULES ★★★

[MUST PRESERVE - 절대 변경 금지]
${preserveList}

[MUST REMOVE - 제거 대상]
\${debrisList}
${removeList}

★★★ WIRE REMOVAL ★★★
${wireList}

★★★ UNFINISHED AREA REPAIR ★★★
${repairList}

★★★ EXHAUST DUCT AREA FINISHING ★★★
${exhaustList}

[MUST IMPROVE - 마감 처리]
${improveList}

[KEEP VISIBLE - 유지할 설비]
- Water supply at \${analysis.water_supply_percent}% from left → clean pipe cap only
- Exhaust duct at \${analysis.exhaust_duct_percent}% from left → smooth surrounding finish
\${analysis.gas_pipe_percent ? '- Gas pipe at ' + analysis.gas_pipe_percent + '% from left → clean gas valve only' : ''}

[OUTPUT]
- Cleanly finished empty space
- No exposed wires
- No unfinished areas
- Ready for furniture installation\`;

const geminiCleanupBody = {
  contents: [{
    parts: [
      { text: cleanupPrompt },
      { inline_data: { mime_type: input.imageType || 'image/jpeg', data: input.roomImage }}
    ]
  }],
  generationConfig: { responseModalities: ['image', 'text'], temperature: ${cleanupRules.generation_config.temperature} }
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
  modules: input.modules || {},
  layoutImage: input.layoutImage || '',
  layoutData: input.layoutData || {},
  maskImage: input.maskImage || ''
};`;
  console.log('✅ Build Cleanup Prompt updated (rules from JSON + maskImage)');
} else {
  console.log('❌ Build Cleanup Prompt not found');
}

// ============================================================
// 4. Parse BG + Build Furniture - Rules from JSON + mask inpainting
// ============================================================
const parseBGBuildFurniture = findNode('Parse BG + Build Furniture');
if (parseBGBuildFurniture) {
  // Embed rendering rules from external JSON
  const renderRules = rules.rendering;
  const legendText = Object.entries(renderRules.blueprint_legend)
    .map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`)
    .join('\n');
  const rulesText = renderRules.rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
  const qualityText = renderRules.photorealistic_quality.map(r => `- ${r}`).join('\n');
  const prohibitedText = renderRules.prohibited.map(r => `❌ ${r}`).join('\n');

  // Inpainting rules
  const inpaintRules = rules.inpainting;
  const inpaintRulesText = inpaintRules.rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
  const inpaintTextureText = inpaintRules.texture_application.map(r => `- ${r}`).join('\n');
  const inpaintProhibitedText = inpaintRules.prohibited.map(r => `❌ ${r}`).join('\n');

  // Fallback rules
  const fallbackRulesText = rules.fallback.rules.map(r => `- ${r}`).join('\n');

  // Material maps for fallback
  const colorMapJSON = JSON.stringify(rules.material_color_map);
  const finishMapJSON = JSON.stringify(rules.material_finish_map);

  parseBGBuildFurniture.parameters.jsCode = `// ═══════════════════════════════════════════════════════════════
// Parse BG + Build Furniture v3 - Rules from image-gen-rules.json + Mask Inpainting
// ═══════════════════════════════════════════════════════════════
const input = $('Build Cleanup Prompt').first().json;
const response = $input.first().json;
const analysis = input.analysisResult;

const clientPrompt = input.clientPrompt || '';
const negativePrompt = input.negativePrompt || '';
const cabinetSpecs = input.cabinetSpecs || {};
const referenceImages = input.referenceImages || {};
const materialDescriptions = input.materialDescriptions || {};
const modules = input.modules || {};
const layoutImage = input.layoutImage || '';
const layoutData = input.layoutData || {};
const maskImage = input.maskImage || '';

// ─── Parse cleaned background from Gemini Stage 1 ───
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

// ─── Build material description lines ───
let materialLines = [];
const md = materialDescriptions || {};
if (md.upper_door_color) materialLines.push('Upper cabinet doors: ' + md.upper_door_color + (md.upper_door_finish ? ', ' + md.upper_door_finish : ''));
if (md.lower_door_color) materialLines.push('Lower cabinet doors: ' + md.lower_door_color + (md.lower_door_finish ? ', ' + md.lower_door_finish : ''));
if (md.countertop) materialLines.push('Countertop: ' + md.countertop);
if (md.handle) materialLines.push('Handles: ' + md.handle);
if (md.hood) materialLines.push('Range hood: ' + md.hood);
if (md.cooktop) materialLines.push('Cooktop: ' + md.cooktop);
if (md.sink) materialLines.push('Sink: ' + md.sink);
if (md.faucet) materialLines.push('Faucet: ' + md.faucet);

// Fallback if no materialDescriptions
if (materialLines.length === 0 && cabinetSpecs) {
  const colorMap = ${colorMapJSON};
  const finishMap = ${finishMapJSON};
  const t = (m, k) => m[k] || k || '';
  if (cabinetSpecs.door_color_upper) materialLines.push('Upper doors: ' + t(colorMap, cabinetSpecs.door_color_upper) + ' ' + t(finishMap, cabinetSpecs.door_finish_upper));
  if (cabinetSpecs.door_color_lower) materialLines.push('Lower doors: ' + t(colorMap, cabinetSpecs.door_color_lower) + ' ' + t(finishMap, cabinetSpecs.door_finish_lower));
  if (cabinetSpecs.countertop_color) materialLines.push('Countertop: ' + t(colorMap, cabinetSpecs.countertop_color));
}

const waterPercent = analysis.water_supply_percent;
const exhaustPercent = analysis.exhaust_duct_percent;

// ─── Build numeric module data text ───
let moduleDataText = '';
if (layoutData && layoutData.totalW_mm) {
  const lines = [];
  lines.push('Total wall: ' + layoutData.totalW_mm + 'mm W x ' + layoutData.totalH_mm + 'mm H');
  if (layoutData.upper?.modules?.length) {
    lines.push('Upper cabinets (' + layoutData.upper.modules.length + ' modules):');
    layoutData.upper.modules.forEach((m, i) => {
      const wMM = Math.round(m.w * layoutData.totalW_mm);
      lines.push('  U' + (i+1) + ': ' + wMM + 'mm wide, ' + m.doorCount + (m.type === 'drawer' ? ' drawer(s)' : ' door(s)') + (m.name ? ' [' + m.name + ']' : ''));
    });
  }
  if (layoutData.lower?.modules?.length) {
    lines.push('Lower cabinets (' + layoutData.lower.modules.length + ' modules):');
    layoutData.lower.modules.forEach((m, i) => {
      const wMM = Math.round(m.w * layoutData.totalW_mm);
      let suffix = '';
      if (m.hasSink) suffix += ' (SINK)';
      if (m.hasCooktop) suffix += ' (COOKTOP)';
      lines.push('  L' + (i+1) + ': ' + wMM + 'mm wide, ' + m.doorCount + (m.type === 'drawer' ? ' drawer(s)' : ' door(s)') + suffix + (m.name ? ' [' + m.name + ']' : ''));
    });
  }
  moduleDataText = lines.join('\\n');
}

// ═══════════════════════════════════════════════════════════════
// ─── RENDERING MODE SELECTION ───
// Mode A: Blueprint + Background → Full rendering (기존)
// Mode B: Blueprint + Background + Mask → Inpainting (신규)
// ═══════════════════════════════════════════════════════════════

let furniturePrompt;
const useInpainting = !!(maskImage && layoutImage);

if (useInpainting) {
  // ★ MODE B: 마스크 기반 인페인팅 (구조 유지 + 텍스처만 AI 보정)
  furniturePrompt = \`[TASK: MASK-BASED INPAINTING - TEXTURE ENHANCEMENT ONLY]

You are given:
1. COMPOSITE IMAGE - furniture layout already composited on cleaned room (first image)
2. INPAINTING MASK - white areas = furniture surfaces to enhance, black areas = DO NOT TOUCH (second image)
3. REFERENCE MATERIALS - texture/color samples (optional, following images)

★★★ INPAINTING RULES ★★★

${inpaintRulesText}

[MASK MEANING]
- WHITE areas (furniture surfaces): ${inpaintRules.mask_explanation.white_areas}
- BLACK areas (background): ${inpaintRules.mask_explanation.black_areas}

[TEXTURE APPLICATION - Apply to white areas only]
${inpaintTextureText}

[MATERIALS TO APPLY]
\${materialLines.join('\\n')}

\${moduleDataText ? '[MODULE DIMENSIONS]\\n' + moduleDataText : ''}

[PHOTOREALISTIC QUALITY]
${qualityText}

[PROHIBITED]
${inpaintProhibitedText}\`;

} else if (layoutImage) {
  // ★ MODE A: 블루프린트 기반 전체 렌더링 (기존 방식)
  furniturePrompt = \`[TASK: PHOTOREALISTIC RENDERING FROM LAYOUT BLUEPRINT]

You are given 3 images:
1. CLEANED ROOM BACKGROUND - the empty room (first image)
2. LAYOUT BLUEPRINT - precise cabinet layout with exact positions, proportions, and colors (second image)
3. REFERENCE MATERIALS - texture/color samples (optional, following images)

★★★ CRITICAL INSTRUCTIONS ★★★

Your job is to render photorealistic built-in kitchen furniture that EXACTLY matches the LAYOUT BLUEPRINT.

[WHAT THE BLUEPRINT SHOWS - FOLLOW EXACTLY]
${legendText}

[RENDERING RULES]
${rulesText}

[MATERIALS & TEXTURES TO APPLY]
\${materialLines.join('\\n')}

[PLUMBING REFERENCE POINTS]
- Sink area aligned with water supply at \${waterPercent}% from left
- Cooktop area aligned with exhaust duct at \${exhaustPercent}% from left

\${moduleDataText ? '[EXACT MODULE DIMENSIONS]\\n' + moduleDataText : ''}

[PHOTOREALISTIC QUALITY]
${qualityText}

[PROHIBITED]
${prohibitedText}\`;

} else {
  // ★ FALLBACK: 블루프린트 없이 텍스트 기반 (하위 호환)
  furniturePrompt = \`[TASK: FURNITURE PLACEMENT - CLAUDE ANALYZED POSITIONS]

★★★ PRESERVE BACKGROUND ★★★
This image is a cleaned background. Do NOT modify the background. Only add furniture.

[Placement Reference Points]
- Sink at \${waterPercent}% from left (water supply position)
- Cooktop at \${exhaustPercent}% from left (exhaust duct position)
- Upper cabinet flush with ceiling

[Materials]
\${materialLines.length > 0 ? materialLines.join('\\n') : 'Modern minimal white matte finish'}

\${moduleDataText ? '[MODULE DIMENSIONS]\\n' + moduleDataText : ''}

[RULES]
${fallbackRulesText}\`;
}

// Add client prompt
if (clientPrompt) {
  furniturePrompt += '\\n\\n[ADDITIONAL REQUIREMENTS]\\n' + clientPrompt;
}

// Add negative prompt
if (negativePrompt) {
  furniturePrompt += '\\n\\n[MUST AVOID]\\n' + negativePrompt;
}

// ─── Build Gemini parts[] ───
const geminiParts = [];

// 1. Text prompt
geminiParts.push({ text: furniturePrompt });

if (useInpainting) {
  // ★ MODE B: 인페인팅 - 합성 이미지 + 마스크
  // 합성 이미지 (텍스처 렌더링된 레이아웃) = layoutImage
  geminiParts.push({ text: '[COMPOSITE IMAGE - Furniture already positioned. Enhance textures in white mask areas only.]' });
  geminiParts.push({ inline_data: { mime_type: 'image/png', data: layoutImage } });

  // 마스크 이미지 (가구=흰색, 배경=검정)
  geminiParts.push({ text: '[INPAINTING MASK - White = modify (furniture surfaces), Black = preserve (background)]' });
  geminiParts.push({ inline_data: { mime_type: 'image/png', data: maskImage } });

} else {
  // ★ MODE A: 기존 방식 - 배경 + 블루프린트
  geminiParts.push({ inline_data: { mime_type: 'image/png', data: cleanedBackground } });

  if (layoutImage) {
    geminiParts.push({ text: '[LAYOUT BLUEPRINT - Follow this exact layout. Every rectangle position and proportion is computed from precise mm measurements.]' });
    geminiParts.push({ inline_data: { mime_type: 'image/png', data: layoutImage } });
  }
}

// Reference material images (최대 3개)
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
    } catch (e) { /* skip */ }
  }
}

for (const img of fetchedRefImages) {
  geminiParts.push({ text: '[REFERENCE MATERIAL: ' + img.description + ' - Match this color/texture]' });
  geminiParts.push({ inline_data: { mime_type: 'image/jpeg', data: img.base64 } });
}

const genTemp = useInpainting ? ${inpaintRules.generation_config.temperature} : ${renderRules.generation_config.temperature};

const geminiFurnitureBody = {
  contents: [{ parts: geminiParts }],
  generationConfig: { responseModalities: ['image', 'text'], temperature: genTemp }
};

return [{
  cleanedBackground,
  hasCleanedBackground: !!cleanedBackground,
  geminiFurnitureBody: JSON.stringify(geminiFurnitureBody),
  category: input.category,
  style: input.style,
  analysisResult: analysis,
  hasLayoutBlueprint: !!layoutImage,
  hasMaskImage: !!maskImage,
  renderingMode: useInpainting ? 'inpainting' : (layoutImage ? 'blueprint' : 'fallback'),
  referenceImageCount: fetchedRefImages.length
}];`;
  console.log('✅ Parse BG + Build Furniture updated (rules from JSON + mask inpainting)');
} else {
  console.log('❌ Parse BG + Build Furniture not found');
}

// Save the updated workflow
fs.writeFileSync(outputFile, JSON.stringify(workflow, null, 2), 'utf8');
console.log('\n✅ Updated file saved to:', outputFile);
console.log(`📜 Rules version: ${rules._version}`);
console.log('🎨 Rendering modes: blueprint | inpainting | fallback');
