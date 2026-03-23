#!/usr/bin/env node
/**
 * merge-parse-input.mjs
 * Merges "Parse Input" into "Build Claude Request" and updates connections.
 *
 * Changes:
 * 1. Build Claude Request absorbs Parse Input logic (reads from Webhook directly)
 * 2. Remove Parse Input node
 * 3. Webhook → Build Claude Request (direct connection)
 * 4. Remove "Parse Input" from connections
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(__dirname, '../../n8n/v8-claude-analysis-vars.json');

const wf = JSON.parse(readFileSync(inputPath, 'utf-8'));

// ════════════════════════════════════════════════════════════════
// 1. Merge Parse Input logic into Build Claude Request
// ════════════════════════════════════════════════════════════════
const buildNode = wf.nodes.find(n => n.name === 'Build Claude Request');
if (!buildNode) throw new Error('Node "Build Claude Request" not found');

buildNode.parameters.jsCode = `// ═══════════════════════════════════════════════════════════════
// Parse Input + Build Claude Analysis Request v3
// ═══════════════════════════════════════════════════════════════
const body = $input.first().json.body || $input.first().json;

// ── Parse Input ──────────────────────────────────────────────
const category = body.category || 'sink';
const style = body.design_style || body.style || 'modern';
const roomImage = body.room_image || '';
const imageType = body.image_type || 'image/jpeg';

// Normalize manual positions to 0-1000 grid
function normalizePosition(pos) {
  if (!pos) return null;
  const scale = (pos.x <= 100 && (!pos.y || pos.y <= 100)) ? 10 : 1;
  return {
    x: Math.round((pos.x || 0) * scale),
    y: pos.y != null ? Math.round(pos.y * scale) : null
  };
}

const rawManualPositions = body.manual_positions || null;
let manualPositions = null;
if (rawManualPositions) {
  manualPositions = {};
  if (rawManualPositions.water_pipe) {
    manualPositions.water_pipe = normalizePosition(rawManualPositions.water_pipe);
  }
  if (rawManualPositions.exhaust_duct) {
    manualPositions.exhaust_duct = normalizePosition(rawManualPositions.exhaust_duct);
  }
}

const clientPrompt = body.prompt || '';
const negativePrompt = body.negative_prompt || '';
const cabinetSpecs = body.cabinet_specs || {};

// Blueprint data from LayoutRenderer v2
const layoutImage = body.layout_image || '';
const layoutData = body.layout_data || null;
const maskImage = body.mask_image || '';
const modules = body.modules || null;
const referenceImages = body.reference_images || [];
const materialDescriptions = body.material_descriptions || [];

const hasManualPositions = !!(manualPositions && (manualPositions.water_pipe || manualPositions.exhaust_duct));
const hasBlueprint = !!(layoutImage && layoutImage.length > 100);
const hasMask = !!(maskImage && maskImage.length > 100);
const hasModules = !!(modules && ((modules.upper && modules.upper.length > 0) || (modules.lower && modules.lower.length > 0)));

// ── Build Claude Request ─────────────────────────────────────
const analysisPrompt = \`You are an expert at analyzing plumbing and utility positions on Korean kitchen construction site walls.

Analyze this image and locate the following utilities precisely using a VIRTUAL 2D COORDINATE SYSTEM.

## Coordinate System
- Use a normalized 0-1000 grid for both X and Y axes.
- X axis: 0 = left edge of wall, 1000 = right edge of wall.
- Y axis: 0 = top edge of wall (ceiling), 1000 = bottom edge of wall (floor).
- Provide center point (x, y) and bounding_box (x, y, w, h) for each detected utility.

## Detection Targets

1. **Water Supply Pipe**
   - Features: Red/blue PVC pipes, white distribution box, pipe caps, copper or plastic connectors
   - Typical location: Lower wall, 200-400mm from floor (Y: 750-950 in grid)

2. **Exhaust Duct**
   - Features: Silver/aluminum flexible duct, round wall hole, ventilation grille
   - Typical location: Near ceiling, upper wall (Y: 30-200 in grid)

3. **Gas Pipe**
   - Features: Yellow pipe, gas valve, gas cock
   - Typical location: Lower wall, 300-500mm from floor

4. **Electrical Outlets**
   - Features: White plastic box, outlet cover
   - Typical location: Counter height (1000-1200mm from floor)

## Output Format - ONLY output valid JSON, no other text.

{
  "wall_boundaries": {
    "width_mm": <estimated wall width in mm>,
    "height_mm": <estimated wall height in mm>,
    "mm_per_unit_x": <width_mm / 1000>,
    "mm_per_unit_y": <height_mm / 1000>,
    "wall_structure": {
      "lower_tile": "<tile color and approximate height>",
      "upper_wall": "<upper wall finish description>"
    }
  },
  "utilities": {
    "water_supply": {
      "detected": true,
      "center": { "x": 310, "y": 880 },
      "center_mm": { "x_mm": 992, "y_mm": 2112 },
      "bounding_box": { "x": 280, "y": 850, "w": 60, "h": 80 },
      "visual_features": "white PVC distribution box with pipe connections",
      "confidence": "high"
    },
    "exhaust_duct": {
      "detected": true,
      "center": { "x": 720, "y": 85 },
      "center_mm": { "x_mm": 2304, "y_mm": 204 },
      "bounding_box": { "x": 690, "y": 50, "w": 60, "h": 70 },
      "visual_features": "silver aluminum flexible duct with round wall hole",
      "confidence": "high"
    },
    "gas_pipe": {
      "detected": false,
      "center": null,
      "center_mm": null,
      "visual_features": null,
      "confidence": "low"
    },
    "electrical_outlets": [
      {
        "center": { "x": 450, "y": 550 },
        "height_description": "counter height"
      }
    ]
  },
  "construction_debris": ["workbench", "tools", "cement bags"],
  "furniture_placement_recommendation": {
    "sink_center_x": 310,
    "cooktop_center_x": 720,
    "layout_direction": "left_to_right"
  }
}

IMPORTANT: Output ONLY valid JSON. No explanations or commentary.\`;

const claudeRequestBody = {
  model: 'claude-opus-4-6',
  max_tokens: 3072,
  temperature: 0.1,
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: imageType,
            data: roomImage
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
  category,
  style,
  roomImage,
  imageType,
  manualPositions,
  hasManualPositions,
  clientPrompt,
  negativePrompt,
  cabinetSpecs,
  layoutImage,
  layoutData,
  maskImage,
  modules,
  referenceImages,
  materialDescriptions,
  hasBlueprint,
  hasMask,
  hasModules
};`;

// Move Build Claude Request to Parse Input's position
const parseNode = wf.nodes.find(n => n.name === 'Parse Input');
if (parseNode) {
  buildNode.position = [...parseNode.position];
}

console.log('[1] Merged Parse Input into Build Claude Request ✓');

// ════════════════════════════════════════════════════════════════
// 2. Remove Parse Input node
// ════════════════════════════════════════════════════════════════
wf.nodes = wf.nodes.filter(n => n.name !== 'Parse Input');
console.log('[2] Removed Parse Input node ✓');

// ════════════════════════════════════════════════════════════════
// 3. Update connections
// ════════════════════════════════════════════════════════════════
// Webhook → Build Claude Request (was Webhook → Parse Input)
wf.connections['Webhook'] = {
  main: [[{ node: 'Build Claude Request', type: 'main', index: 0 }]]
};

// Remove Parse Input connection entry
delete wf.connections['Parse Input'];

console.log('[3] Updated connections: Webhook → Build Claude Request ✓');

// ════════════════════════════════════════════════════════════════
// 4. Also sync workflows/ copy
// ════════════════════════════════════════════════════════════════
const outputPath = inputPath;
const workflowsPath = resolve(__dirname, '../../workflows/v8-claude-analysis.json');

writeFileSync(outputPath, JSON.stringify(wf, null, 2), 'utf-8');
writeFileSync(workflowsPath, JSON.stringify(wf, null, 2), 'utf-8');
console.log('\n✅ Written to:', outputPath);
console.log('✅ Synced to:', workflowsPath);
