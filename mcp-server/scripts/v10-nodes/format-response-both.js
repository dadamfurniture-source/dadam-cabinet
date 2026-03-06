// ═══ Format Response (Both) — v10: 3 images output ═══
const input = $('Parse Furniture + Build Open').first().json;
const response = $input.first().json;

let openImage = null;

try {
  const candidates = response.candidates || [];
  if (candidates.length > 0) {
    const parts = candidates[0].content?.parts || [];
    for (const part of parts) {
      if (part.inlineData || part.inline_data) {
        const inlineData = part.inlineData || part.inline_data;
        if (inlineData.data) openImage = inlineData.data;
      }
    }
  }
} catch (e) { /* Parse error */ }

return [{
  success: true,
  message: 'Image generation complete (all 3 states) | debug: ' + (input.debugInfo || 'none'),
  category: input.category,
  style: input.style,
  wall_analysis: input.wallData,
  furniture_placement: input.furniturePlacement,
  rendering_mode: input.renderingMode || 'fallback',
  has_blueprint: input.hasBlueprint || false,
  generated_image: {
    background: {
      base64: input.cleanedBackground,
      mime_type: 'image/png'
    },
    closed: {
      base64: input.closedImage,
      mime_type: 'image/png'
    },
    open: {
      base64: openImage,
      mime_type: 'image/png'
    }
  }
}];
