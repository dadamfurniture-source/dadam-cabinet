// ═══ Build Furniture Body (Cleanup Bypassed) ═══
// Cleanup stage removed — Gemini can't reliably clean construction debris
// Instead, the Furniture prompt handles cleanup + furniture in one step
const input = $input.first().json;

// Use original room image directly
const cleanedBackground = input.roomImage;

// Build Gemini Furniture body
const geminiFurnitureBody = {
  contents: [{
    parts: [
      { text: input.furniturePrompt },
      { inlineData: { mimeType: input.imageType || 'image/jpeg', data: cleanedBackground } }
    ]
  }],
  generationConfig: {
    responseModalities: ['IMAGE', 'TEXT'],
    temperature: 0.4
  }
};

// Only pass necessary fields to next node (reduce data size)
return [{
  category: input.category,
  style: input.style,
  imageType: input.imageType,
  cleanedBackground,
  wallData: input.wallData,
  furniturePlacement: input.furniturePlacement,
  openPrompt: input.openPrompt,
  hasBlueprint: input.hasBlueprint,
  hasModules: input.hasModules,
  renderingMode: input.renderingMode,
  hasCleanedBackground: true,
  geminiFurnitureBody: JSON.stringify(geminiFurnitureBody)
}];
