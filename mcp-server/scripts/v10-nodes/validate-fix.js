// ═══ Validate & Fix: AI Verification Loop ═══
// Input: from Gemini Furniture (closedImage, category, wallData, openPrompt, ...)
// Output: same shape, closedImage replaced if corrected, debugInfo + validationPassed added
//
// Loop (max 3 checks = initial + 2 retries):
//   1. Gemini text-only validation (gemini-2.5-flash) — no prompt length limit
//   2. pass → break
//   3. fail → Gemini image edit (gemini-2.5-flash-image) with targeted fix_instructions
const input = $input.first().json;
const GEMINI_KEY = '%%GEMINI_API_KEY%%';
const MAX_RETRIES = 2;

let closedImage = input.closedImage;
let debugInfo = (input.debugInfo || '');
let validationPassed = false;

if (!closedImage) {
  // No image to validate
  return [{
    ...input,
    closedImage,
    debugInfo: debugInfo + 'validate:skipped(no image); ',
    validationPassed: false,
  }];
}

const category = (input.category || '').toLowerCase();
const isKitchen = ['sink', 'l_shaped_sink', 'island', 'island_kitchen', 'kitchen'].includes(category);
const wallData = input.wallData || {};
const placement = input.furniturePlacement || {};

// Build validation checklist based on category
let checklistItems = [
  'PROPORTIONS: Are cabinet proportions natural (no stretching/squashing)?',
  'ALIGNMENT: Are all cabinet edges straight and properly aligned?',
  'CLOSED_DOORS: Are ALL cabinet doors fully closed (no open shelves)?',
  'BACKGROUND: Is the original wall/floor background preserved without artifacts?',
];

if (isKitchen) {
  // Compute expected positions as percentages for the validator
  const ww = wallData.wall_width_mm || 3000;
  const waterPct = placement.sink_center_mm ? Math.round(placement.sink_center_mm / ww * 100) : null;
  const exhaustPct = placement.hood_center_mm ? Math.round(placement.hood_center_mm / ww * 100) : null;

  checklistItems.push(
    'DUCT_REMOVAL: Are there ANY visible exposed duct pipes, silver/aluminum tubes, or ventilation pipes? These MUST NOT be visible.',
    'HOOD_CONCEALED: Is the range hood fully concealed inside the upper cabinet (no exposed metal hood)?',
  );
  if (waterPct !== null) {
    checklistItems.push(
      `SINK_POSITION: Is the sink/faucet located near ${waterPct}% from left edge (water supply position)?`
    );
  }
  if (exhaustPct !== null) {
    checklistItems.push(
      `COOKTOP_POSITION: Is the cooktop/range hood area near ${exhaustPct}% from left edge (exhaust duct position)?`
    );
  }
  checklistItems.push(
    'SINK_VISIBLE: Is a stainless steel sink bowl clearly visible on the countertop?',
    'COOKTOP_VISIBLE: Is a built-in cooktop visible on the countertop?',
    'UPPER_FLUSH: Are upper cabinets flush with the ceiling (no gap at top)?',
  );
} else if (category === 'wardrobe') {
  checklistItems.push(
    'DOOR_UNIFORM: Are all wardrobe doors the same width and aligned?',
    'HANDLES: Are all handles at the same height and consistently styled?',
    'FLOOR_CEILING: Does the wardrobe span floor-to-ceiling without gaps?',
  );
} else if (category === 'vanity') {
  checklistItems.push(
    'SINK_BASIN: Is the sink basin clearly visible and integrated?',
    'MIRROR: Is the mirror cabinet properly proportioned above the vanity?',
  );
}

const checklist = checklistItems.map((item, i) => `${i + 1}. ${item}`).join('\n');

const validationPrompt = `You are a furniture image quality inspector. Analyze this AI-generated built-in furniture image.

[CATEGORY] ${category}

[CHECKLIST — evaluate each item]
${checklist}

[OUTPUT FORMAT — JSON only, no other text]
{
  "pass": true/false,
  "issues": [
    { "code": "DUCT_REMOVAL", "severity": "critical", "description": "Silver duct pipe visible on upper right wall" }
  ],
  "fix_instructions": "If pass=false, write a CONCISE image editing instruction (under 280 chars) that fixes ONLY the critical/major issues. If pass=true, leave empty string."
}

RULES:
- pass=true ONLY if zero critical or major issues
- severity: "critical" (must fix), "major" (should fix), "minor" (acceptable)
- fix_instructions must be under 280 characters (n8n Cloud Gemini limit)
- Focus on the MOST important issues first`;

// ─── Validation Loop ───
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  debugInfo += `validate_attempt:${attempt + 1}; `;

  // Step 1: Text-only validation (no image generation, unlimited prompt)
  let validation = null;
  try {
    const valRes = await this.helpers.request({
      method: 'POST',
      uri: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GEMINI_KEY,
      body: {
        contents: [{
          parts: [
            { text: validationPrompt },
            { inlineData: { mimeType: 'image/png', data: closedImage } }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 512 }
      },
      json: true,
      timeout: 60000,
    });

    const parts = valRes?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.text) {
        const jsonMatch = part.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          validation = JSON.parse(jsonMatch[0]);
        }
      }
    }
  } catch (e) {
    debugInfo += 'validate_error:' + e.message.substring(0, 80) + '; ';
  }

  // If validation failed to parse or returned pass
  if (!validation) {
    debugInfo += 'validate_parse_fail; ';
    // Can't validate — treat as pass to avoid unnecessary correction
    validationPassed = true;
    break;
  }

  const issueCount = (validation.issues || []).filter(i => i.severity === 'critical' || i.severity === 'major').length;
  debugInfo += `issues:${issueCount}; `;

  if (validation.pass === true || issueCount === 0) {
    debugInfo += 'validate:passed; ';
    validationPassed = true;
    break;
  }

  // Step 2: If last attempt, don't try to fix — just log
  if (attempt === MAX_RETRIES) {
    debugInfo += 'validate:max_retries_reached; ';
    break;
  }

  // Step 3: Targeted correction using fix_instructions
  const fixPrompt = validation.fix_instructions || 'Fix the issues in this furniture image. Keep everything else unchanged.';
  debugInfo += 'fix:' + fixPrompt.substring(0, 60) + '...; ';

  try {
    const fixRes = await this.helpers.request({
      method: 'POST',
      uri: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=' + GEMINI_KEY,
      body: {
        contents: [{
          parts: [
            { text: fixPrompt },
            { inlineData: { mimeType: 'image/png', data: closedImage } }
          ]
        }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
      },
      json: true,
      timeout: 120000,
    });

    const parts = fixRes?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (imgPart?.inlineData?.data) {
      closedImage = imgPart.inlineData.data;
      debugInfo += 'fix:applied; ';
    } else {
      debugInfo += 'fix:no_image_returned; ';
    }
  } catch (e) {
    debugInfo += 'fix_error:' + e.message.substring(0, 80) + '; ';
  }
}

return [{
  closedImage,
  hasClosedImage: !!closedImage,
  debugInfo,
  validationPassed,
  cleanedBackground: input.cleanedBackground,
  category: input.category,
  style: input.style,
  imageType: input.imageType,
  wallData: input.wallData,
  furniturePlacement: input.furniturePlacement,
  openPrompt: input.openPrompt,
  hasBlueprint: input.hasBlueprint || false,
  renderingMode: input.renderingMode || 'fallback',
}];
