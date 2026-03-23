#!/usr/bin/env node
/**
 * Deploy v10: v5 파이프라인 전면 개편
 *
 * 변경 사항:
 * 1. RAG 노드 제거 (Supabase RAG Search)
 * 2. 4스테이지 파이프라인: Cleanup → Furniture → Correction → Open
 * 3. v9 프롬프트 시스템 이식: distributeModules, colorMap, Blueprint, 6개 카테고리
 * 4. Format Response: 3장 출력 (background/closed/open)
 *
 * Usage:
 *   node scripts/deploy-v5-rebuild.mjs --dry-run   # Preview only
 *   node scripts/deploy-v5-rebuild.mjs             # Live deploy
 */
import { config } from 'dotenv';
import { writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../../n8n/.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const N8N_API_KEY = process.env.N8N_API_KEY;
const N8N_BASE_URL = process.env.N8N_BASE_URL || 'https://dadam.app.n8n.cloud/api/v1';
const V5_ID = 'KUuawjm7m3nS0qHH';
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) {
  console.error('ERROR: GEMINI_API_KEY not found in .env');
  process.exit(1);
}

if (!N8N_API_KEY) {
  console.error('ERROR: N8N_API_KEY not found');
  process.exit(1);
}

// ─── Load v10 node code files ───
function loadNodeCode(filename) {
  let code = readFileSync(resolve(__dirname, 'v10-nodes', filename), 'utf-8');
  // Replace API key placeholders with actual keys from .env
  code = code.replace(/%%GEMINI_API_KEY%%/g, GEMINI_KEY);
  return code;
}

const BUILD_ALL_PROMPTS_CODE = loadNodeCode('build-all-prompts.js');
const GEMINI_FURNITURE_CODE = loadNodeCode('gemini-furniture.js');
const VALIDATE_FIX_CODE = loadNodeCode('validate-fix.js');
const PARSE_FURNITURE_CODE = loadNodeCode('parse-furniture.js');
const FORMAT_RESPONSE_BOTH_CODE = loadNodeCode('format-response-both.js');
const FORMAT_RESPONSE_CLOSED_CODE = loadNodeCode('format-response-closed.js');

// ─── Updated Parse Input (simplified, no RAG triggers) ───
const PARSE_INPUT_CODE = `const body = $input.first().json.body || $input.first().json;
const category = body.category || 'sink';
const style = body.design_style || body.style || 'modern';
const roomImage = body.room_image || '';
const imageType = body.image_type || 'image/jpeg';

return {
  category, style, roomImage, imageType,
  prompt: body.prompt || '',
  negative_prompt: body.negative_prompt || '',
  cabinet_specs: body.cabinet_specs || {},
  layout_data: body.layout_data || null,
  modules: body.modules || null,
  material_descriptions: body.material_descriptions || [],
  styleMoodPrompt: body.style_mood_prompt || '',
  styleDoorColor: body.style_door_color || '',
  styleDoorHex: body.style_door_hex || '',
  styleDoorFinish: body.style_door_finish || '',
  styleCountertopPrompt: body.style_countertop_prompt || '',
  styleHandlePrompt: body.style_handle_prompt || '',
  styleAccentPrompt: body.style_accent_prompt || ''
};`;

// ─── Updated Wall Analysis (v11: enhanced pipe/duct detection with Korean visual cues) ───
const WALL_ANALYSIS_CODE = `const input = $('Parse Input').first().json;

const wallAnalysisPrompt = \`[TASK: 한국 주방 벽면 구조 및 설비 분석]

이 한국 주방 공사 현장 사진에서 벽 치수와 모든 배관/설비 위치를 정확히 감지하세요.

═══════════════════════════════════════════════════════════
[STEP 1: 기준점(0mm) 설정]
═══════════════════════════════════════════════════════════
기준점 설정 우선순위:
1순위: 벽이 틔어져 있는 끝선 (개방된 공간 쪽) = 0mm
2순위: 양쪽 다 막혀 있다면 → 배기구에서 먼 쪽 = 0mm
※ 기준점에서 반대 방향으로 mm 측정

═══════════════════════════════════════════════════════════
[STEP 2: 타일을 자(Ruler)로 활용한 치수 측정]
═══════════════════════════════════════════════════════════
타일 종류별 크기 (가로×세로):
- Standard Wall (한국 표준): 300×600mm ★ 가장 일반적
- Subway Large: 100×300mm
- Porcelain Large: 600×1200mm
타일 없는 경우 참조:
- 표준 문 너비: 900mm / 높이: 2100mm
- 콘센트 높이: 바닥에서 약 300mm
- 한국 아파트 천장 높이: 2300-2400mm

═══════════════════════════════════════════════════════════
[STEP 3: 배관 및 설비 감지 — 핵심 단계]
═══════════════════════════════════════════════════════════

★★★ 각 설비마다 "detected"와 "confidence" 반드시 판단!
★★★ 시각적으로 명확히 보이면 "high", 흐릿하면 "medium", 추측이면 "low"

──── 급수 배관 (WATER SUPPLY) → 싱크볼 위치 결정 ────
시각적 특징 (하나 이상 보이면 감지):
• 빨간색 + 파란색 PEX 배관 (온수/냉수) — 벽에서 돌출
• 흰색/베이지색 분배기(매니폴드) 박스 + 조절 밸브
• 벽 하단부 보호캡으로 막힌 배관 마감
• 위치: 벽 하단, 바닥에서 200-500mm
• 보통 벽면 좌측 30-40% 지점에 위치

──── 배기 덕트 (EXHAUST DUCT) → 레인지후드 + 쿡탑 위치 결정 ────
시각적 특징 (하나 이상 보이면 감지):
• 은색/알루미늄 유연 덕트 파이프 (주름진 원통형)
• 벽 상단의 원형 또는 사각형 구멍 (지름 100-150mm)
• 금속 플랜지, 캡, 또는 환기 그릴
• 위치: 벽 상단부, 바닥에서 1800-2200mm
• 보통 벽면 우측 60-80% 지점에 위치

──── 가스 배관 (GAS PIPE) → 쿡탑 위치 백업 지표 ────
시각적 특징:
• 노란색으로 도색된 금속 파이프
• 가스 밸브/콕 (돌려서 잠그는 형태)
• 위치: 벽 중하단부, 배기 덕트와 수평 300mm 이내
• 보통 배기 덕트 바로 아래쪽에 위치

──── 전기 콘센트 (ELECTRICAL OUTLETS) ────
• 흰색 플라스틱 콘센트 / 고전압용 콘센트 (오븐, 식기세척기)

═══════════════════════════════════════════════════════════
[OUTPUT — JSON ONLY, NO OTHER TEXT]
═══════════════════════════════════════════════════════════
{
  "origin_point": "left_open_edge",
  "origin_reason": "좌측이 개방되어 있어 기준점으로 설정",
  "tile_detected": true,
  "tile_type": "standard_wall",
  "tile_size_mm": { "width": 300, "height": 600 },
  "tile_count": { "horizontal": 10, "vertical": 4 },
  "wall_dimensions_mm": { "width": 3000, "height": 2400 },
  "utility_positions_mm": {
    "water_supply_from_left": 800,
    "water_supply_from_floor": 350,
    "water_supply_confidence": "high",
    "water_supply_description": "빨간/파란 PEX 배관 2개, 분배기 박스 있음",
    "exhaust_duct_from_left": 2200,
    "exhaust_duct_from_floor": 2000,
    "exhaust_duct_confidence": "high",
    "exhaust_duct_description": "알루미늄 덕트, 원형 구멍 150mm",
    "gas_pipe_from_left": 2100,
    "gas_pipe_from_floor": 500,
    "gas_pipe_confidence": "medium",
    "gas_pipe_description": "노란색 가스관, 밸브 있음",
    "electrical_outlets": [300, 1500, 2700]
  },
  "confidence": "high",
  "notes": ""
}\`;

const geminiAnalysisBody = {
  contents: [{
    parts: [
      { inline_data: { mime_type: input.imageType || "image/jpeg", data: input.roomImage }},
      { text: wallAnalysisPrompt }
    ]
  }],
  generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
};

return [{
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  cabinetSpecs: input.cabinet_specs,
  materialDescriptions: input.material_descriptions,
  prompt: input.prompt,
  negative_prompt: input.negative_prompt,
  layoutData: input.layout_data,
  modules: input.modules,
  styleMoodPrompt: input.styleMoodPrompt,
  styleDoorColor: input.styleDoorColor,
  styleDoorHex: input.styleDoorHex,
  styleDoorFinish: input.styleDoorFinish,
  styleCountertopPrompt: input.styleCountertopPrompt,
  styleHandlePrompt: input.styleHandlePrompt,
  styleAccentPrompt: input.styleAccentPrompt,
  kitchen_layout: input.kitchen_layout,
  geminiAnalysisBody: JSON.stringify(geminiAnalysisBody)
}];`;

// ─── Updated Parse Wall Data (v11: confidence-smart fallback + description) ───
const PARSE_WALL_DATA_CODE = `const input = $('Wall Analysis').first().json;
const response = $input.first().json;

let wallData = {
  tile_detected: false, tile_type: "unknown",
  tile_size_mm: { width: 300, height: 600 },
  tile_count: { horizontal: 0, vertical: 0 },
  wall_width_mm: 3000, wall_height_mm: 2400,
  origin_point: "left_edge", origin_reason: "",
  water_supply_position: null, water_supply_confidence: "low",
  water_supply_description: "",
  exhaust_duct_position: null, exhaust_duct_confidence: "low",
  exhaust_duct_description: "",
  gas_pipe_position: null, gas_pipe_confidence: "low",
  gas_pipe_description: "",
  electrical_outlets: [], confidence: "low",
  notes: ""
};

try {
  const candidates = response.candidates || [];
  if (candidates.length > 0) {
    const parts = candidates[0].content?.parts || [];
    for (const part of parts) {
      if (part.text) {
        const jsonMatch = part.text.match(/\\{[\\s\\S]*\\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const u = parsed.utility_positions_mm || {};
          wallData = {
            tile_detected: parsed.tile_detected || false,
            tile_type: parsed.tile_type || "unknown",
            tile_size_mm: parsed.tile_size_mm || { width: 300, height: 600 },
            tile_count: parsed.tile_count || { horizontal: 0, vertical: 0 },
            wall_width_mm: parsed.wall_dimensions_mm?.width || 3000,
            wall_height_mm: parsed.wall_dimensions_mm?.height || 2400,
            origin_point: parsed.origin_point || "left_edge",
            origin_reason: parsed.origin_reason || "",
            water_supply_position: u.water_supply_from_left || null,
            water_supply_confidence: u.water_supply_confidence || "low",
            water_supply_description: u.water_supply_description || "",
            exhaust_duct_position: u.exhaust_duct_from_left || null,
            exhaust_duct_confidence: u.exhaust_duct_confidence || "low",
            exhaust_duct_description: u.exhaust_duct_description || "",
            gas_pipe_position: u.gas_pipe_from_left || null,
            gas_pipe_confidence: u.gas_pipe_confidence || "low",
            gas_pipe_description: u.gas_pipe_description || "",
            electrical_outlets: u.electrical_outlets || [],
            confidence: parsed.confidence || "low",
            notes: parsed.notes || ""
          };
        }
      }
    }
  }
} catch (e) {}

// Smart fallback: use high-confidence sources first
const ww = wallData.wall_width_mm;

// Sink: water_supply → default 30%
const sinkMm = wallData.water_supply_position || Math.round(ww * 0.3);

// Hood: exhaust_duct (high/medium) → gas_pipe (high/medium) → default 70%
let hoodMm;
if (wallData.exhaust_duct_position && wallData.exhaust_duct_confidence !== "low") {
  hoodMm = wallData.exhaust_duct_position;
} else if (wallData.gas_pipe_position && wallData.gas_pipe_confidence !== "low") {
  hoodMm = wallData.gas_pipe_position;
} else if (wallData.exhaust_duct_position) {
  hoodMm = wallData.exhaust_duct_position;
} else if (wallData.gas_pipe_position) {
  hoodMm = wallData.gas_pipe_position;
} else {
  hoodMm = Math.round(ww * 0.7);
}

const furniturePlacement = {
  sink_center_mm: sinkMm,
  hood_center_mm: hoodMm,
  upper_cabinet_bottom_mm: wallData.wall_height_mm - 720,
  lower_cabinet_height_mm: 870,
  countertop_height_mm: 870
};

return [{
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  cabinetSpecs: input.cabinetSpecs,
  materialDescriptions: input.materialDescriptions,
  prompt: input.prompt,
  negative_prompt: input.negative_prompt,
  layoutData: input.layoutData,
  modules: input.modules,
  styleMoodPrompt: input.styleMoodPrompt,
  styleDoorColor: input.styleDoorColor,
  styleDoorHex: input.styleDoorHex,
  styleDoorFinish: input.styleDoorFinish,
  styleCountertopPrompt: input.styleCountertopPrompt,
  styleHandlePrompt: input.styleHandlePrompt,
  styleAccentPrompt: input.styleAccentPrompt,
  kitchen_layout: input.kitchen_layout,
  wallData,
  furniturePlacement,
  analysisSuccess: wallData.confidence !== "low"
}];`;

// ═══════════════════════════════════════════════════════════════
async function n8nFetch(path, opts = {}) {
  const url = `${N8N_BASE_URL}${path}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetch(url, {
        ...opts,
        headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json', ...opts.headers },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      if (attempt === 3) throw e;
      console.log(`   Retry ${attempt}/3: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  v10 Deploy: Full Pipeline Rebuild');
  console.log('  RAG 제거 + 4스테이지 + v9 프롬프트 이식');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE DEPLOY'}\n`);

  // 0. Fetch current workflow
  console.log('0. Fetching v5 workflow...');
  const res = await n8nFetch(`/workflows/${V5_ID}`);
  let wf = await res.json();
  console.log(`   "${wf.name}" (${wf.nodes.length} nodes)\n`);

  // 1. Backup
  const backupPath = resolve(__dirname, '../tmp/pre-v10-rebuild-backup.json');
  writeFileSync(backupPath, JSON.stringify(wf, null, 2));
  console.log(`1. Backup: ${backupPath}\n`);

  // ─── Step 2: Remove RAG node ───
  console.log('2. Removing Supabase RAG Search node...');
  const ragIdx = wf.nodes.findIndex(n => n.name === 'Supabase RAG Search');
  if (ragIdx >= 0) {
    wf.nodes.splice(ragIdx, 1);
    console.log('   ✓ Removed from nodes array');
  } else {
    console.log('   - Not found (already removed?)');
  }
  delete wf.connections['Supabase RAG Search'];
  console.log('   ✓ Removed from connections\n');

  // ─── Step 3: Update Parse Input → Wall Analysis connection ───
  console.log('3. Rewiring Parse Input → Wall Analysis...');
  wf.connections['Parse Input'] = {
    main: [[{ node: 'Wall Analysis', type: 'main', index: 0 }]]
  };
  console.log('   ✓ Parse Input → Wall Analysis (direct)\n');

  // ─── Step 4: Update existing code nodes ───
  console.log('4. Updating code nodes...');

  const findNode = (name) => wf.nodes.find(n => n.name === name);

  // Parse Input
  const parseInputNode = findNode('Parse Input');
  if (parseInputNode) {
    parseInputNode.parameters.jsCode = PARSE_INPUT_CODE;
    console.log(`   ✓ Parse Input: ${PARSE_INPUT_CODE.length} chars`);
  }

  // Wall Analysis
  const wallAnalysisNode = findNode('Wall Analysis');
  if (wallAnalysisNode) {
    wallAnalysisNode.parameters.jsCode = WALL_ANALYSIS_CODE;
    console.log(`   ✓ Wall Analysis: ${WALL_ANALYSIS_CODE.length} chars`);
  }

  // Parse Wall Data
  const parseWallNode = findNode('Parse Wall Data');
  if (parseWallNode) {
    parseWallNode.parameters.jsCode = PARSE_WALL_DATA_CODE;
    console.log(`   ✓ Parse Wall Data: ${PARSE_WALL_DATA_CODE.length} chars`);
  }

  // Build Prompts → Build All Prompts (rename + replace code)
  // Check both old and new name for re-deploy support
  const buildPromptsNode = findNode('Build Prompts') || findNode('Build All Prompts');
  if (buildPromptsNode) {
    buildPromptsNode.name = 'Build All Prompts';
    buildPromptsNode.parameters.jsCode = BUILD_ALL_PROMPTS_CODE;
    console.log(`   ✓ Build All Prompts: ${BUILD_ALL_PROMPTS_CODE.length} chars`);
  }

  // Convert "Gemini Closed Door" / "Gemini Furniture" from httpRequest → Code node
  const closedDoorNode = findNode('Gemini Closed Door') || findNode('Gemini Furniture');
  if (closedDoorNode) {
    closedDoorNode.name = 'Gemini Furniture';
    closedDoorNode.type = 'n8n-nodes-base.code';
    closedDoorNode.typeVersion = 2;
    closedDoorNode.parameters = {
      jsCode: GEMINI_FURNITURE_CODE,
      mode: 'runOnceForAllItems'
    };
    console.log(`   ✓ Gemini Furniture: httpRequest → Code node (${GEMINI_FURNITURE_CODE.length} chars)`);
  }

  // Insert or update "Validate & Fix" Code node (between Gemini Furniture and Parse Furniture)
  let validateFixNode = findNode('Validate & Fix');
  if (!validateFixNode) {
    const furnitureNode = findNode('Gemini Furniture');
    const vfPosition = furnitureNode
      ? [furnitureNode.position[0] + 200, furnitureNode.position[1]]
      : [1600, 300];
    validateFixNode = {
      parameters: { jsCode: VALIDATE_FIX_CODE, mode: 'runOnceForAllItems' },
      id: randomUUID(),
      name: 'Validate & Fix',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: vfPosition,
    };
    wf.nodes.push(validateFixNode);
    console.log(`   ✓ Validate & Fix: NEW node inserted (${VALIDATE_FIX_CODE.length} chars)`);

    // Shift downstream nodes 200px right to make room
    const shiftAfter = ['Parse Furniture + Build Open', 'Parse Closed + Prep Open',
      'Has Closed Image?', 'Gemini Open Door', 'Format Response (Both)',
      'Format Response (Closed Only)', 'Respond (Both Images)', 'Respond (Closed Only)'];
    for (const n of wf.nodes) {
      if (shiftAfter.includes(n.name)) {
        n.position = [n.position[0] + 200, n.position[1]];
      }
    }
  } else {
    validateFixNode.parameters.jsCode = VALIDATE_FIX_CODE;
    validateFixNode.parameters.mode = 'runOnceForAllItems';
    console.log(`   ✓ Validate & Fix: updated (${VALIDATE_FIX_CODE.length} chars)`);
  }

  // Update "Parse Closed + Prep Open" → "Parse Furniture + Build Open"
  const parseClosedNode = findNode('Parse Closed + Prep Open') || findNode('Parse Furniture + Build Open');
  if (parseClosedNode) {
    parseClosedNode.name = 'Parse Furniture + Build Open';
    parseClosedNode.parameters.jsCode = PARSE_FURNITURE_CODE;
    console.log(`   ✓ Parse Furniture + Build Open: ${PARSE_FURNITURE_CODE.length} chars`);
  }

  // Format Response (Both)
  const fmtBothNode = findNode('Format Response (Both)');
  if (fmtBothNode) {
    fmtBothNode.parameters.jsCode = FORMAT_RESPONSE_BOTH_CODE;
    console.log(`   ✓ Format Response (Both): ${FORMAT_RESPONSE_BOTH_CODE.length} chars`);
  }

  // Format Response (Closed Only)
  const fmtClosedNode = findNode('Format Response (Closed Only)');
  if (fmtClosedNode) {
    fmtClosedNode.parameters.jsCode = FORMAT_RESPONSE_CLOSED_CODE;
    console.log(`   ✓ Format Response (Closed Only): ${FORMAT_RESPONSE_CLOSED_CODE.length} chars`);
  }

  console.log('');

  // ─── Step 5: Remove unnecessary nodes ───
  console.log('5. Removing unnecessary nodes...');

  // Remove Cleanup-related nodes (no longer needed)
  const removedNames = [];
  wf.nodes = wf.nodes.filter(n => {
    if (['Gemini Cleanup', 'Parse Cleanup + Build Furniture', 'Build Furniture Body'].includes(n.name)) {
      removedNames.push(n.name);
      return false;
    }
    return true;
  });
  if (removedNames.length > 0) console.log('   ✓ Removed:', removedNames.join(', '));
  else console.log('   (no nodes to remove)');
  console.log('   Build All Prompts now creates geminiFurnitureBody directly\n');

  // ─── Step 6: Rewire ALL connections ───
  console.log('6. Rewiring connections...');

  // Build the complete v10 connection map
  wf.connections = {
    'Webhook': {
      main: [[{ node: 'Parse Input', type: 'main', index: 0 }]]
    },
    'Parse Input': {
      main: [[{ node: 'Wall Analysis', type: 'main', index: 0 }]]
    },
    'Wall Analysis': {
      main: [[{ node: 'Gemini Wall Vision', type: 'main', index: 0 }]]
    },
    'Gemini Wall Vision': {
      main: [[{ node: 'Parse Wall Data', type: 'main', index: 0 }]]
    },
    'Parse Wall Data': {
      main: [[{ node: 'Build All Prompts', type: 'main', index: 0 }]]
    },
    'Build All Prompts': {
      main: [[{ node: 'Gemini Furniture', type: 'main', index: 0 }]]
    },
    'Gemini Furniture': {
      main: [[{ node: 'Validate & Fix', type: 'main', index: 0 }]]
    },
    'Validate & Fix': {
      main: [[{ node: 'Parse Furniture + Build Open', type: 'main', index: 0 }]]
    },
    'Parse Furniture + Build Open': {
      main: [[{ node: 'Has Closed Image?', type: 'main', index: 0 }]]
    },
    'Has Closed Image?': {
      main: [
        [{ node: 'Gemini Open Door', type: 'main', index: 0 }],
        [{ node: 'Format Response (Closed Only)', type: 'main', index: 0 }]
      ]
    },
    'Gemini Open Door': {
      main: [[{ node: 'Format Response (Both)', type: 'main', index: 0 }]]
    },
    'Format Response (Both)': {
      main: [[{ node: 'Respond (Both Images)', type: 'main', index: 0 }]]
    },
    'Format Response (Closed Only)': {
      main: [[{ node: 'Respond (Closed Only)', type: 'main', index: 0 }]]
    }
  };

  console.log('   ✓ v10 connection map set (15 connections)\n');

  // ─── Step 7: Update Gemini Open Door body reference ───
  console.log('7. Updating Gemini node body references...');
  // Gemini Furniture is now a Code node (no body expression needed)
  console.log('   ✓ Gemini Furniture: Code node (API call inline)');

  const openDoorNode = findNode('Gemini Open Door');
  if (openDoorNode) {
    openDoorNode.parameters.body = '={{ $json.geminiOpenBody }}';
    console.log('   ✓ Gemini Open Door: body → geminiOpenBody');
  }

  // ─── Step 7b: Sanitize ALL Gemini API keys across entire workflow ───
  console.log('7b. Sanitizing Gemini API keys...');
  let wfStr = JSON.stringify(wf);
  // Replace any AIzaSy* key pattern in the entire workflow
  const oldKeyCount = (wfStr.match(/AIzaSy[A-Za-z0-9_-]{30,}/g) || []).length;
  wfStr = wfStr.replace(/AIzaSy[A-Za-z0-9_-]{30,}/g, GEMINI_KEY);
  wf = JSON.parse(wfStr);
  console.log('   ✓ Replaced ' + oldKeyCount + ' API key occurrences');
  console.log('');

  // ═══ VALIDATION ═══
  console.log('── Validation ──');
  const nodeNames = wf.nodes.map(n => n.name);
  const checks = {
    'No RAG node': !nodeNames.includes('Supabase RAG Search'),
    'No Gemini Cleanup': !nodeNames.includes('Gemini Cleanup'),
    'No Build Furniture Body': !nodeNames.includes('Build Furniture Body'),
    'Has Build All Prompts': nodeNames.includes('Build All Prompts'),
    'Has Gemini Furniture': nodeNames.includes('Gemini Furniture'),
    'Has Parse Furniture': nodeNames.includes('Parse Furniture + Build Open'),
    'Has distributeModules': BUILD_ALL_PROMPTS_CODE.includes('distributeModules'),
    'Has colorMap': BUILD_ALL_PROMPTS_CODE.includes('colorMap'),
    'Has Blueprint mode': BUILD_ALL_PROMPTS_CODE.includes('BLUEPRINT'),
    'Has 6 categories': BUILD_ALL_PROMPTS_CODE.includes('shoe_cabinet') && BUILD_ALL_PROMPTS_CODE.includes('vanity'),
    'Has Korean open prompt': BUILD_ALL_PROMPTS_CODE.includes('ABSOLUTELY FORBIDDEN'),
    'Has Validate & Fix node': nodeNames.includes('Validate & Fix'),
    'Validate has loop': VALIDATE_FIX_CODE.includes('MAX_RETRIES'),
    'Validate has text-only': VALIDATE_FIX_CODE.includes('gemini-2.5-flash:'),
    'Parse has no correction': !PARSE_FURNITURE_CODE.includes('correctionPrompt'),
    'Has duct removal': BUILD_ALL_PROMPTS_CODE.includes('REMOVE all exposed duct'),
    'Has supply→sink anchor': BUILD_ALL_PROMPTS_CODE.includes('Water supply) at') && BUILD_ALL_PROMPTS_CODE.includes('(Sink)'),
    'Has duct→cooktop anchor': BUILD_ALL_PROMPTS_CODE.includes('Exhaust duct) at') && BUILD_ALL_PROMPTS_CODE.includes('(Cooktop)'),
    'Validate has duct check': VALIDATE_FIX_CODE.includes('DUCT_REMOVAL'),
    'Gemini Furniture is Code': wf.nodes.find(n => n.name === 'Gemini Furniture')?.type === 'n8n-nodes-base.code',
    'Format has 3 images': FORMAT_RESPONSE_BOTH_CODE.includes('background'),
    'No manual_positions': !BUILD_ALL_PROMPTS_CODE.includes('manualPositions'),
    'Has position anchors': BUILD_ALL_PROMPTS_CODE.includes('Sink at') && BUILD_ALL_PROMPTS_CODE.includes('cooktop at'),
    'Has PRESERVE background': BUILD_ALL_PROMPTS_CODE.includes('PRESERVE background EXACTLY'),
    'Has gas pipe fallback': PARSE_WALL_DATA_CODE.includes('gas_pipe'),
    'Wall analysis has origin': WALL_ANALYSIS_CODE.includes('origin_point'),
    'Wall analysis has confidence': WALL_ANALYSIS_CODE.includes('confidence'),
    'Wall analysis Korean cues': WALL_ANALYSIS_CODE.includes('PEX') && WALL_ANALYSIS_CODE.includes('알루미늄'),
    'Wall analysis description': WALL_ANALYSIS_CODE.includes('description'),
    'Parse has smart fallback': PARSE_WALL_DATA_CODE.includes('exhaust_duct_confidence'),
    'No old API key': !JSON.stringify(wf).includes('AIzaSyAa26blkL3jkmkMoHFseCNvo5SyR6ZIpNo'),
    'API key from env': GEMINI_FURNITURE_CODE.includes(GEMINI_KEY),
  };

  let allPassed = true;
  for (const [check, passed] of Object.entries(checks)) {
    console.log(`   ${passed ? '✓' : '✗'} ${check}: ${passed}`);
    if (!passed) allPassed = false;
  }

  console.log(`\n   Node count: ${wf.nodes.length} (target: 15)`);
  console.log(`   Nodes: ${nodeNames.join(' → ')}`);

  if (!allPassed) {
    console.error('\n✗ Validation failed! Aborting.');
    process.exit(1);
  }

  // ═══ DEPLOY or DRY RUN ═══
  if (DRY_RUN) {
    const previewPath = resolve(__dirname, '../tmp/v10-rebuild-preview.json');
    writeFileSync(previewPath, JSON.stringify(wf, null, 2));
    console.log(`\nDry run saved: ${previewPath}`);
    console.log(`Deploy with: node scripts/deploy-v5-rebuild.mjs`);
    return;
  }

  console.log('\n── Deploying ──');

  // A. Deactivate
  console.log('A. Deactivating...');
  try {
    await n8nFetch(`/workflows/${V5_ID}/deactivate`, { method: 'POST' });
  } catch (e) {
    // Try PATCH fallback
    await n8nFetch(`/workflows/${V5_ID}`, { method: 'PATCH', body: JSON.stringify({ active: false }) });
  }

  // B. Update
  console.log('B. Updating...');
  const payload = { nodes: wf.nodes, connections: wf.connections, name: wf.name, settings: wf.settings };
  const updateRes = await n8nFetch(`/workflows/${V5_ID}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  console.log(`   Update: ${updateRes.status} ${updateRes.statusText}`);

  if (updateRes.status !== 200) {
    const errorBody = await updateRes.text();
    console.error('   Error body:', errorBody.substring(0, 500));
    process.exit(1);
  }

  // C. Activate
  console.log('C. Activating...');
  try {
    await n8nFetch(`/workflows/${V5_ID}/activate`, { method: 'POST' });
  } catch (e) {
    await n8nFetch(`/workflows/${V5_ID}`, { method: 'PATCH', body: JSON.stringify({ active: true }) });
  }

  // D. Verify
  console.log('D. Verifying...');
  const verifyRes = await n8nFetch(`/workflows/${V5_ID}`);
  const verified = await verifyRes.json();
  const vNodeNames = verified.nodes.map(n => n.name);

  console.log(`   Active: ${verified.active}`);
  console.log(`   Nodes: ${verified.nodes.length}`);
  console.log(`   Has Build All Prompts: ${vNodeNames.includes('Build All Prompts')}`);
  console.log(`   No Cleanup/Body nodes: ${!vNodeNames.includes('Gemini Cleanup') && !vNodeNames.includes('Build Furniture Body')}`);
  console.log(`   Has distributeModules: ${verified.nodes.find(n => n.name === 'Build All Prompts')?.parameters?.jsCode?.includes('distributeModules')}`);
  console.log(`   No RAG: ${!vNodeNames.includes('Supabase RAG Search')}`);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('V10 PIPELINE REBUILD COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Rollback: restore from tmp/pre-v10-rebuild-backup.json');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
