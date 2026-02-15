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
  const layoutImage = body.layout_image || '';
  const layoutData = body.layout_data || {};

  return {
    category, style, roomImage, imageType, triggers,
    materialCodes, colorKeywords,
    hasMaterialRequest: materialCodes.length > 0 || colorKeywords.length > 0,
    clientPrompt, negativePrompt, cabinetSpecs,
    referenceImages, materialDescriptions, modules,
    layoutImage, layoutData
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
  modules: input.modules || {},
  layoutImage: input.layoutImage || '',
  layoutData: input.layoutData || {}
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
  modules: input.modules || {},
  layoutImage: input.layoutImage || '',
  layoutData: input.layoutData || {}
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
  modules: input.modules || {},
  layoutImage: input.layoutImage || '',
  layoutData: input.layoutData || {}
};`;
  console.log('✅ Build Cleanup Prompt updated');
} else {
  console.log('❌ Build Cleanup Prompt not found');
}

// ============================================================
// 4. Parse BG + Build Furniture - Layout Blueprint + Photorealistic Enhancement
// ============================================================
const parseBGBuildFurniture = findNode('Parse BG + Build Furniture');
if (parseBGBuildFurniture) {
  parseBGBuildFurniture.parameters.jsCode = `// ═══════════════════════════════════════════════════════════════
// Parse Background + Build Furniture (수치 기반 레이아웃 블루프린트 방식)
// 레이아웃 결정: 프론트엔드 Canvas (100% 코드 계산)
// Gemini 역할: 포토리얼리스틱 텍스처/조명 보정만 담당
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
const layoutImage = input.layoutImage || '';
const layoutData = input.layoutData || {};

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
  const colorMap = {
    '화이트': 'pure white', '그레이': 'gray', '블랙': 'matte black',
    '오크': 'natural oak wood', '월넛': 'dark walnut wood',
    '스노우': 'snow white', '마블화이트': 'white marble',
    '그레이마블': 'gray marble', '차콜': 'charcoal',
    '베이지': 'beige', '네이비': 'navy blue'
  };
  const finishMap = { '무광': 'matte', '유광': 'glossy', '엠보': 'embossed' };
  const t = (m, k) => m[k] || k || '';
  if (cabinetSpecs.door_color_upper) materialLines.push('Upper doors: ' + t(colorMap, cabinetSpecs.door_color_upper) + ' ' + t(finishMap, cabinetSpecs.door_finish_upper));
  if (cabinetSpecs.door_color_lower) materialLines.push('Lower doors: ' + t(colorMap, cabinetSpecs.door_color_lower) + ' ' + t(finishMap, cabinetSpecs.door_finish_lower));
  if (cabinetSpecs.countertop_color) materialLines.push('Countertop: ' + t(colorMap, cabinetSpecs.countertop_color));
}

const waterPercent = analysis.water_supply_percent;
const exhaustPercent = analysis.exhaust_duct_percent;

// ═══════════════════════════════════════════════════════════════
// ─── LAYOUT BLUEPRINT MODE (수치 기반 레이아웃) ───
// ═══════════════════════════════════════════════════════════════

let furniturePrompt;

if (layoutImage) {
  // ★ 블루프린트 모드: Canvas에서 생성된 정확한 레이아웃을 참조하여 포토리얼리스틱 렌더링
  furniturePrompt = \`[TASK: PHOTOREALISTIC RENDERING FROM LAYOUT BLUEPRINT]

You are given 3 images:
1. CLEANED ROOM BACKGROUND - the empty room (first image)
2. LAYOUT BLUEPRINT - precise cabinet layout with exact positions, proportions, and colors (second image)
3. REFERENCE MATERIALS - texture/color samples (optional, following images)

★★★ CRITICAL INSTRUCTIONS ★★★

Your job is to render photorealistic built-in kitchen furniture that EXACTLY matches the LAYOUT BLUEPRINT.

[WHAT THE BLUEPRINT SHOWS - FOLLOW EXACTLY]
- Each colored rectangle = one cabinet module at its exact position and size
- The PROPORTIONS between modules are mathematically computed from real mm measurements
- Horizontal lines inside a module = drawers
- Vertical lines inside a module = door divisions
- Dark strip at bottom = toe kick
- Thin strip between upper and lower = countertop
- Stainless steel rectangle on countertop = sink bowl position
- Black rectangle on countertop = cooktop position
- Dark gray strip at top = crown molding

[RENDERING RULES]
1. PRESERVE the cleaned background EXACTLY - do NOT modify walls, floor, or ceiling
2. Place furniture ONLY where the blueprint shows colored rectangles
3. Match the EXACT proportions and positions from the blueprint
4. Each module's WIDTH RATIO must match the blueprint precisely
5. Upper cabinets must be flush with ceiling (as shown in blueprint)

[MATERIALS & TEXTURES TO APPLY]
\${materialLines.join('\\n')}

[PLUMBING REFERENCE POINTS]
- Sink area aligned with water supply at \${waterPercent}% from left
- Cooktop area aligned with exhaust duct at \${exhaustPercent}% from left

[PHOTOREALISTIC QUALITY]
- Add realistic shadows, reflections, and ambient lighting
- Apply proper material textures (wood grain, stone pattern, stainless steel)
- Show realistic edge profiles and panel gaps
- Natural lighting from windows/ceiling as visible in the background
- Subtle shadow under upper cabinets onto backsplash

[PROHIBITED]
❌ Do NOT change positions or proportions from the blueprint
❌ Do NOT modify the background/wall/floor
❌ No text, labels, or dimension markings
❌ NO exposed hood duct or ventilation pipe
❌ NO visible exhaust pipe or silver/metallic duct tube\`;

} else {
  // ★ 폴백: 블루프린트 없이 기존 텍스트 기반 프롬프트 (하위 호환)
  furniturePrompt = \`[TASK: FURNITURE PLACEMENT - CLAUDE ANALYZED POSITIONS]

★★★ PRESERVE BACKGROUND ★★★
This image is a cleaned background. Do NOT modify the background. Only add furniture.

[Placement Reference Points]
- Sink at \${waterPercent}% from left (water supply position)
- Cooktop at \${exhaustPercent}% from left (exhaust duct position)
- Upper cabinet flush with ceiling

[Materials]
\${materialLines.length > 0 ? materialLines.join('\\n') : 'Modern minimal white matte finish'}

[PROHIBITED]
❌ Do NOT modify background
❌ NO exposed duct or pipe
❌ No text/labels\`;
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

// 1. Text prompt (항상 첫 번째)
geminiParts.push({ text: furniturePrompt });

// 2. Cleaned background image (첫 번째 이미지)
geminiParts.push({ inline_data: { mime_type: 'image/png', data: cleanedBackground } });

// 3. Layout blueprint image (두 번째 이미지 - 수치 기반 레이아웃)
if (layoutImage) {
  geminiParts.push({ text: '[LAYOUT BLUEPRINT - Follow this exact layout. Every rectangle position and proportion is computed from precise mm measurements.]' });
  geminiParts.push({ inline_data: { mime_type: 'image/png', data: layoutImage } });
}

// 4. Reference material images (최대 3개, 우선순위)
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

const geminiFurnitureBody = {
  contents: [{ parts: geminiParts }],
  generationConfig: { responseModalities: ['image', 'text'], temperature: 0.3 }
};

return [{
  cleanedBackground,
  hasCleanedBackground: !!cleanedBackground,
  geminiFurnitureBody: JSON.stringify(geminiFurnitureBody),
  category: input.category,
  style: input.style,
  analysisResult: analysis,
  hasLayoutBlueprint: !!layoutImage,
  referenceImageCount: fetchedRefImages.length
}];`;
  console.log('✅ Parse BG + Build Furniture updated');
} else {
  console.log('❌ Parse BG + Build Furniture not found');
}

// Save the updated workflow
fs.writeFileSync(outputFile, JSON.stringify(workflow, null, 2), 'utf8');
console.log('\n✅ Updated file saved to:', outputFile);
