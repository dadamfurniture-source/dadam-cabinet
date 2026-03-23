import json

with open('n8n/v8-claude-analysis-vars.json', 'r', encoding='utf-8') as f:
    wf = json.load(f)

nodes = wf['nodes']
connections = wf['connections']

webhook_node = next(n for n in nodes if n['name'] == 'Webhook')
build_claude_node = next(n for n in nodes if n['name'] == 'Build Claude Request')
wx, wy = webhook_node['position']

# ═══════════════════════════════════════════════════════════════
# 1. NEW NODE: Parse Input
# ═══════════════════════════════════════════════════════════════
parse_input_js = """const body = $input.first().json.body || $input.first().json;
const category = body.category || 'sink';
const style = body.design_style || body.style || 'modern';
const roomImage = body.room_image || '';
const imageType = body.image_type || 'image/jpeg';

const triggerMap = {
  sink: ['상부장', '하부장', '걸레받이', '도어규격', '몰딩', '배경보정', '벽면마감', '천장마감', '바닥마감'],
  wardrobe: ['붙박이장', '좌대', '상몰딩', '짧은옷', '긴옷', '서랍', '스마트바', '배경보정', '벽면마감'],
  fridge: ['냉장고장', '상부장', 'EL장', '홈카페', '배경보정', '벽면마감', '천장마감', '바닥마감']
};

function detectMaterialCodes(t) {
  if (!t) return [];
  const pats = [/YPG-\\d+/gi,/YPA-\\d+/gi,/YPW-\\d+/gi,/SM-\\d+/gi,/SG-\\d+/gi,/CP-\\d+/gi,/PW-\\d+/gi,/LC-\\d+/gi,/PL-\\d+/gi,/PM-\\d+/gi,/PE-\\d+/gi,/AM-\\d+/gi,/LP-\\d+/gi,/HS\\d+/gi,/HC\\d+/gi,/HP\\d+/gi,/HW\\d+/gi,/MFB-\\d+/gi,/LS-\\d+/gi];
  const codes = [];
  for (const p of pats) { const m = t.match(p); if (m) codes.push(...m.map(x => x.toUpperCase())); }
  return [...new Set(codes)];
}

function detectColorKeywords(t) {
  if (!t) return [];
  const kws = ['화이트','그레이','블랙','아이보리','베이지','브라운','오크','월넛','무광','유광','펄','마블','우드','모던','미니멀','white','grey','black','oak','walnut','matte','glossy','modern'];
  const lo = t.toLowerCase();
  return [...new Set(kws.filter(k => t.includes(k) || lo.includes(k.toLowerCase())))];
}

const materialCodes = detectMaterialCodes(style);
const colorKeywords = detectColorKeywords(style);
let triggers = [...(triggerMap[category] || triggerMap.sink)];
if (materialCodes.length > 0) triggers.push(...materialCodes);
if (colorKeywords.length > 0) triggers.push(...colorKeywords.slice(0, 5));

return {
  category, style, roomImage, imageType, triggers, materialCodes, colorKeywords,
  manual_positions: body.manual_positions || null,
  prompt: body.prompt || '',
  negative_prompt: body.negative_prompt || '',
  cabinet_specs: body.cabinet_specs || {},
  layout_image: body.layout_image || '',
  layout_data: body.layout_data || null,
  mask_image: body.mask_image || '',
  modules: body.modules || null,
  reference_images: body.reference_images || [],
  material_descriptions: body.material_descriptions || []
};"""

parse_input_node = {
    "parameters": {"jsCode": parse_input_js},
    "id": "a1b2c3d4-parse-input-v8",
    "name": "Parse Input",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [wx + 200, wy]
}

# ═══════════════════════════════════════════════════════════════
# 2. NEW NODE: Supabase RAG Search
# ═══════════════════════════════════════════════════════════════
rag_node = {
    "parameters": {
        "method": "POST",
        "url": "https://vvqrvgcgnlfpiqqndsve.supabase.co/rest/v1/rpc/quick_trigger_search",
        "sendHeaders": True,
        "headerParameters": {
            "parameters": [
                {"name": "apikey", "value": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2cXJ2Z2NnbmxmcGlxcW5kc3ZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY0MzQ4ODEsImV4cCI6MjA2MjAxMDg4MX0.kmJTdn6bhcrKZN-yd8xQzMhPnKcvpSaKz_e30uxFpFE"},
                {"name": "Content-Type", "value": "application/json"}
            ]
        },
        "sendBody": True,
        "bodyParameters": {
            "parameters": [
                {"name": "query_triggers", "value": "={{ $('Parse Input').first().json.triggers }}"},
                {"name": "filter_category", "value": "={{ $('Parse Input').first().json.category }}"},
                {"name": "limit_count", "value": "25"}
            ]
        },
        "options": {}
    },
    "id": "e5f6g7h8-rag-search-v8",
    "name": "Supabase RAG Search",
    "type": "n8n-nodes-base.httpRequest",
    "typeVersion": 4.2,
    "position": [wx + 400, wy]
}

# ═══════════════════════════════════════════════════════════════
# 3. MODIFY: Build Claude Request - read from Parse Input + pass RAG
# ═══════════════════════════════════════════════════════════════
build_claude_js = """const input = $('Parse Input').first().json;
const ragResults = $input.first().json || [];

const category = input.category;
const style = input.style;
const roomImage = input.roomImage;
const imageType = input.imageType;

function normalizePosition(pos) {
  if (!pos) return null;
  const scale = (pos.x <= 100 && (!pos.y || pos.y <= 100)) ? 10 : 1;
  return { x: Math.round((pos.x || 0) * scale), y: pos.y != null ? Math.round(pos.y * scale) : null };
}

const rawManualPositions = input.manual_positions || null;
let manualPositions = null;
if (rawManualPositions) {
  manualPositions = {};
  if (rawManualPositions.water_pipe) manualPositions.water_pipe = normalizePosition(rawManualPositions.water_pipe);
  if (rawManualPositions.exhaust_duct) manualPositions.exhaust_duct = normalizePosition(rawManualPositions.exhaust_duct);
}
const hasManualPositions = !!(manualPositions && (manualPositions.water_pipe || manualPositions.exhaust_duct));

const layoutImage = input.layout_image || '';
const layoutData = input.layout_data || null;
const maskImage = input.mask_image || '';
const modules = input.modules || null;
const referenceImages = input.reference_images || [];
const materialDescriptions = input.material_descriptions || [];
const hasBlueprint = !!(layoutImage && layoutImage.length > 100);
const hasMask = !!(maskImage && maskImage.length > 100);
const hasModules = !!(modules && ((modules.upper && modules.upper.length > 0) || (modules.lower && modules.lower.length > 0)));

const analysisPrompt = `You are an expert at analyzing plumbing and utility positions on Korean kitchen construction site walls.
Analyze this image and locate utilities using a 0-1000 grid (X: left=0, right=1000; Y: top=0, bottom=1000).

Detect: 1) Water Supply Pipe (red/blue pipes, lower wall Y:750-950) 2) Exhaust Duct (silver duct, upper wall Y:30-200) 3) Gas Pipe (yellow, lower wall) 4) Electrical Outlets

Output ONLY valid JSON:
{"wall_boundaries":{"width_mm":3000,"height_mm":2400,"mm_per_unit_x":3.0,"mm_per_unit_y":2.4,"wall_structure":{"lower_tile":"","upper_wall":""}},"utilities":{"water_supply":{"detected":true,"center":{"x":310,"y":880},"center_mm":{"x_mm":992,"y_mm":2112},"bounding_box":{"x":280,"y":850,"w":60,"h":80},"visual_features":"","confidence":"high"},"exhaust_duct":{"detected":true,"center":{"x":720,"y":85},"center_mm":{"x_mm":2304,"y_mm":204},"bounding_box":{"x":690,"y":50,"w":60,"h":70},"visual_features":"","confidence":"high"},"gas_pipe":{"detected":false,"center":null,"center_mm":null,"visual_features":null,"confidence":"low"},"electrical_outlets":[]},"construction_debris":[],"furniture_placement_recommendation":{"sink_center_x":310,"cooktop_center_x":720,"layout_direction":"left_to_right"}}`;

const claudeRequestBody = {
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 3072,
  temperature: 0.1,
  messages: [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: imageType, data: roomImage } },
      { type: 'text', text: analysisPrompt }
    ]
  }]
};

return {
  claudeRequestBody: JSON.stringify(claudeRequestBody),
  category, style, roomImage, imageType,
  manualPositions, hasManualPositions,
  clientPrompt: input.prompt || '',
  negativePrompt: input.negative_prompt || '',
  cabinetSpecs: input.cabinet_specs || {},
  layoutImage, layoutData, maskImage, modules,
  referenceImages, materialDescriptions,
  hasBlueprint, hasMask, hasModules,
  ragResults: Array.isArray(ragResults) ? ragResults : []
};"""

build_claude_node['parameters']['jsCode'] = build_claude_js

# ═══════════════════════════════════════════════════════════════
# 4. MODIFY: Parse Claude Result - pass RAG through
# ═══════════════════════════════════════════════════════════════
pcr = next(n for n in nodes if n['name'] == 'Parse Claude Result')
js = pcr['parameters']['jsCode']
js = js.replace(
    "hasModules: input.hasModules\n}];",
    "hasModules: input.hasModules,\n  ragResults: input.ragResults || []\n}];"
)
pcr['parameters']['jsCode'] = js

# ═══════════════════════════════════════════════════════════════
# 5. MODIFY: Build Cleanup Prompt - add RAG background rules + pass RAG
# ═══════════════════════════════════════════════════════════════
bcp = next(n for n in nodes if n['name'] == 'Build Cleanup Prompt')
js = bcp['parameters']['jsCode']

rag_classify = """
// RAG data classification
const ragResults = input.ragResults || [];
const ragBg = [], ragModules = [], ragDoors = [], ragMaterials = [];
if (Array.isArray(ragResults)) {
  ragResults.forEach(rule => {
    const rt = rule.rule_type || rule.chunk_type || '';
    if (rt === 'background') ragBg.push('- ' + rule.content);
    else if (rt === 'module') ragModules.push('- ' + (rule.triggers ? rule.triggers[0] : '') + ': ' + rule.content);
    else if (rt === 'door') ragDoors.push('- ' + (rule.triggers ? rule.triggers[0] : '') + ': ' + rule.content);
    else if (rt === 'material') ragMaterials.push(rule);
  });
}
"""

js = js.replace(
    "const input = $input.first().json;\nconst analysis = input.analysisResult;",
    "const input = $input.first().json;\nconst analysis = input.analysisResult;\n" + rag_classify
)

# Add RAG bg rules into cleanup prompt
js = js.replace(
    "\\n\\n\\u2605\\u2605\\u2605 WALL FINISHING",
    "\\n\\n\\u2605\\u2605\\u2605 RAG BACKGROUND RULES \\u2605\\u2605\\u2605\\n' +\n(ragBg.length > 0 ? ragBg.join('\\\\n') + '\\n' : '') + '\\n\\u2605\\u2605\\u2605 WALL FINISHING"
)

# Pass RAG forward
js = js.replace(
    "hasModules: input.hasModules\n};",
    "hasModules: input.hasModules,\n  ragResults, ragBg, ragModules, ragDoors, ragMaterials\n};"
)

bcp['parameters']['jsCode'] = js

# ═══════════════════════════════════════════════════════════════
# 6. MODIFY: Parse BG + Build Furniture - use RAG in furniture prompt
# ═══════════════════════════════════════════════════════════════
pbf = next(n for n in nodes if n['name'] == 'Parse BG + Build Furniture')
js = pbf['parameters']['jsCode']

rag_furniture = """
// RAG data for furniture prompt
const ragModules = input.ragModules || [];
const ragDoors = input.ragDoors || [];
const ragMaterials = input.ragMaterials || [];

let ragModuleSection = '';
if (ragModules.length > 0) ragModuleSection = '\\n[MODULE RULES - Supabase RAG]\\n' + ragModules.join('\\n') + '\\n';

let ragDoorSection = '';
if (ragDoors.length > 0) ragDoorSection = '\\n[DOOR RULES - Supabase RAG]\\n' + ragDoors.join('\\n') + '\\n';

let ragMaterialSection = '';
if (ragMaterials.length > 0) {
  ragMaterialSection = '\\n[MATERIAL SPECS - Supabase RAG]\\n';
  ragMaterials.forEach(m => { ragMaterialSection += '[' + (m.triggers ? m.triggers[0] : '') + '] ' + m.content + '\\n'; });
}
"""

js = js.replace(
    "const hasBlueprint = input.hasBlueprint;",
    "const hasBlueprint = input.hasBlueprint;\n" + rag_furniture
)

# Insert RAG sections before [PROHIBITED] in blueprint mode
js = js.replace(
    "    '[PROHIBITED]\\\\n' +\n    '- Do NOT change positions",
    "    ragModuleSection + ragDoorSection + ragMaterialSection +\n    '[PROHIBITED]\\\\n' +\n    '- Do NOT change positions",
    1
)

# Insert RAG sections before [PROHIBITED] in fallback mode
js = js.replace(
    "    '\\\\n[PROHIBITED]\\\\n' +\n    '- Do NOT modify background/walls/floor",
    "    ragModuleSection + ragDoorSection + ragMaterialSection +\n    '\\\\n[PROHIBITED]\\\\n' +\n    '- Do NOT modify background/walls/floor"
)

pbf['parameters']['jsCode'] = js

# ═══════════════════════════════════════════════════════════════
# 7. Add new nodes & update connections
# ═══════════════════════════════════════════════════════════════
nodes.insert(1, parse_input_node)
nodes.insert(2, rag_node)

connections['Webhook'] = {"main": [[{"node": "Parse Input", "type": "main", "index": 0}]]}
connections['Parse Input'] = {"main": [[{"node": "Supabase RAG Search", "type": "main", "index": 0}]]}
connections['Supabase RAG Search'] = {"main": [[{"node": "Build Claude Request", "type": "main", "index": 0}]]}

# Adjust positions
build_claude_node['position'] = [wx + 600, wy]
shift_names = [
    'Claude Pipe Analysis', 'Parse Claude Result', 'Build Cleanup Prompt',
    'Gemini Background Cleanup', 'Parse BG + Build Furniture', 'Has Cleaned BG?',
    'Gemini Furniture', 'Parse Furniture + Prep Open', 'Has Closed Image?',
    'Gemini Open Door', 'Format Response (All)', 'Format Response (Closed)',
    'Format Response (Error)', 'Respond (All)', 'Respond (Closed)', 'Respond (Error)'
]
for n in nodes:
    if n['name'] in shift_names:
        n['position'][0] += 400

with open('n8n/v8-claude-analysis-vars.json', 'w', encoding='utf-8') as f:
    json.dump(wf, f, indent=2, ensure_ascii=False)

print(f"Done! Total nodes: {len(nodes)}")
print("Added: Parse Input, Supabase RAG Search")
print("Modified: Build Claude Request, Parse Claude Result, Build Cleanup Prompt, Parse BG + Build Furniture")
