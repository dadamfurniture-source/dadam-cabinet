// ═══ Parse Furniture + Build Open Body ═══
// Input: from Validate & Fix (closedImage already validated/corrected)
// Builds Gemini Open Door request body
const input = $input.first().json;

const closedImage = input.closedImage;
const debugInfo = (input.debugInfo || '') + (input.validationPassed ? 'validation:passed; ' : 'validation:not_passed; ');

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
    temperature: 0.1
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
