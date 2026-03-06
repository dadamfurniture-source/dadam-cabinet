// ═══ Correction + Build Open Body ═══
// Input: from Gemini Furniture Code node (already has closedImage extracted)
// Stage 3: Inline Gemini Correction (category-specific validation)
// Then builds Gemini Open Door request body
const input = $input.first().json;
const category = (input.category || '').toLowerCase();

let closedImage = input.closedImage;
let debugInfo = input.debugInfo || '';

// ─── Stage 3: Category-specific Gemini Correction ───
if (closedImage) {
  const isKitchen = ['sink', 'l_shaped_sink', 'island', 'island_kitchen', 'kitchen'].includes(category);

  let correctionPrompt = 'Apply these MANDATORY corrections to this furniture image if needed. ' +
    'If the image already satisfies all rules, output it unchanged.\n\n' +
    '[MANDATORY CORRECTIONS]\n' +
    '1. PROPORTIONS: No stretching, squashing, or distortion compared to original photo.\n' +
    '2. ALIGNMENT: All cabinet edges must be straight and properly aligned.\n' +
    '3. CLOSED DOORS: Every cabinet must have closed doors. No open shelves.\n';

  if (isKitchen) {
    correctionPrompt +=
      '4. SINK: Stainless steel sink bowl MUST be visible on the countertop.\n' +
      '5. FAUCET: Clear, detailed faucet \u2014 tall arched spout, single lever, chrome or matte black.\n' +
      '6. COOKTOP: Built-in cooktop MUST be visible on the countertop near the range hood area.\n' +
      '7. RANGE HOOD: Fully concealed inside upper cabinet. NO exposed duct pipe or silver/metallic pipe.\n' +
      '8. DRAWER CABINET: Cabinet below cooktop must be a drawer unit (2-3 stacked drawers).\n' +
      '9. TILES: All backsplash tiles fully grouted with clean edges.\n' +
      '10. UPPER CABINETS: Must be flush with ceiling \u2014 NO gap at top.\n';
  } else if (category === 'wardrobe') {
    correctionPrompt +=
      '4. DOOR UNIFORMITY: All doors must be same width ratio and aligned.\n' +
      '5. HANDLES: All handles must be at same height and consistently styled.\n' +
      '6. FLOOR-TO-CEILING: No gap at top or bottom of wardrobe.\n';
  } else if (category === 'vanity') {
    correctionPrompt +=
      '4. SINK BASIN: Must be clearly visible and properly integrated.\n' +
      '5. FAUCET: Clear, detailed faucet fixture.\n' +
      '6. MIRROR: Mirror cabinet above must be properly proportioned.\n';
  } else {
    correctionPrompt +=
      '4. DOOR ALIGNMENT: All doors must be uniform and properly aligned.\n' +
      '5. HANDLES: Consistent handle style and positioning.\n';
  }

  correctionPrompt += '\n[OUTPUT] Apply minimal corrections. Keep materials, colors, layout unchanged from input.';

  try {
    const geminiRes = await this.helpers.request({
      method: 'POST',
      uri: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=%%GEMINI_API_KEY%%',
      body: {
        contents: [{ parts: [
          { text: correctionPrompt },
          { inlineData: { mimeType: 'image/png', data: closedImage } }
        ]}],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
      },
      json: true,
      timeout: 120000,
    });
    const parts = geminiRes?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (imgPart?.inlineData?.data) {
      closedImage = imgPart.inlineData.data;
      debugInfo += 'correction:applied; ';
    }
  } catch(e) { debugInfo += 'correction:failed(' + e.message.substring(0,50) + '); '; }
}

// Build Gemini Open Door body
const geminiOpenBody = {
  contents: [{
    parts: [
      { inlineData: { mimeType: 'image/png', data: closedImage } },
      { text: input.openPrompt }
    ]
  }],
  generationConfig: {
    responseModalities: ['TEXT', 'IMAGE'],
    temperature: 0.3
  }
};

return [{
  closedImage,
  hasClosedImage: !!closedImage,
  debugInfo,
  cleanedBackground: input.cleanedBackground,
  category: input.category,
  style: input.style,
  wallData: input.wallData,
  furniturePlacement: input.furniturePlacement,
  hasBlueprint: input.hasBlueprint || false,
  renderingMode: input.renderingMode || 'fallback',
  geminiOpenBody: JSON.stringify(geminiOpenBody)
}];
