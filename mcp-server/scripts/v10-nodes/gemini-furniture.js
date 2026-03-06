// ═══ Gemini Furniture (Code Node) ═══
// Uses compressedPrompt (<500 chars) from Build All Prompts
// n8n Cloud + Gemini image gen requires short prompts (>~600 chars causes IMAGE_OTHER)
const input = $input.first().json;
const GEMINI_KEY = '%%GEMINI_API_KEY%%';

const imgData = input.cleanedBackground || '';
const imgType = input.imageType || 'image/jpeg';

// Use compressed prompt (under 500 chars) built by Build All Prompts
const prompt = input.compressedPrompt ||
  'Place furniture on this room photo. PRESERVE background. Modern style. Photorealistic. All doors closed.';

let closedImage = null;
let debugInfo = 'promptLen:' + prompt.length + '; imgLen:' + (imgData.length/1024|0) + 'KB; ';

const bodyObj = {
  contents: [{
    parts: [
      { text: prompt },
      { inlineData: { mimeType: imgType, data: imgData } }
    ]
  }],
  generationConfig: {
    responseModalities: ['IMAGE', 'TEXT'],
    temperature: 0.4
  }
};

try {
  const res = await this.helpers.request({
    method: 'POST',
    uri: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=' + GEMINI_KEY,
    body: bodyObj,
    json: true,
    timeout: 120000,
  });

  const c0 = res?.candidates?.[0];
  debugInfo += 'finishReason:' + (c0?.finishReason || 'none') + '; ';
  const parts = c0?.content?.parts || [];
  debugInfo += 'parts:' + parts.length + '; ';

  for (const part of parts) {
    if (part.inlineData?.data) {
      closedImage = part.inlineData.data;
      debugInfo += 'image:' + (closedImage.length / 1024 | 0) + 'KB; ';
    }
    if (part.text) debugInfo += 'text:' + part.text.substring(0, 60) + '; ';
  }

  if (!closedImage && res?.error) {
    debugInfo += 'apiErr:' + JSON.stringify(res.error).substring(0, 100) + '; ';
  }
} catch (e) {
  debugInfo += 'error:' + e.message.substring(0, 200) + '; ';
}

return [{
  closedImage,
  hasClosedImage: !!closedImage,
  debugInfo,
  cleanedBackground: input.cleanedBackground,
  category: input.category,
  style: input.style,
  imageType: input.imageType,
  wallData: input.wallData,
  furniturePlacement: input.furniturePlacement,
  openPrompt: input.openPrompt,
  hasBlueprint: input.hasBlueprint || false,
  renderingMode: input.renderingMode || 'fallback'
}];
