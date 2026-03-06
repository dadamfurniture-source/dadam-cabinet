// ═══ Format Response (Closed Only) — v10: fallback ═══
const input = $('Parse Furniture + Build Open').first().json;

return [{
  success: true,
  message: 'Image generation complete (closed only) | debug: ' + (input.debugInfo || 'none'),
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
    open: null
  }
}];
