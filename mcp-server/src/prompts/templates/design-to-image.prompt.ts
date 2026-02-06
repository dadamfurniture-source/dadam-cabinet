// ═══════════════════════════════════════════════════════════════
// Design-to-Image Prompt Builder (Single Source of Truth)
// 기존: http-server.ts 1072~1109줄
// ═══════════════════════════════════════════════════════════════

export function buildDesignToImagePrompt(
  category: string,
  style: string,
  specs: Record<string, unknown>,
  _items: unknown[]
): string {
  return `[MOST IMPORTANT - READ FIRST]
This is a PHOTO generation task, NOT a technical drawing.
DO NOT ADD ANY TEXT, NUMBERS, DIMENSIONS, OR LABELS TO THE IMAGE.
The output must be a CLEAN photograph with NO annotations whatsoever.

[TASK: PHOTOREALISTIC KOREAN ${category.toUpperCase()}]

Generate a photorealistic interior photograph of a modern Korean ${category}.

[STYLE: ${style}]
Modern Korean minimalist with flat panel doors and concealed hinges.

[ROOM SETTING]
Modern Korean apartment with white walls, light wood floor, natural lighting.

[STRICTLY FORBIDDEN - WILL REJECT IF VIOLATED]
❌ NO dimension labels or measurements
❌ NO text, numbers, or characters
❌ NO arrows, lines, or technical markings
❌ NO rulers, scales, or size indicators
❌ NO watermarks or logos
❌ NO annotations of any kind
❌ NO people or pets

[OUTPUT]
Clean photorealistic interior photograph.
Magazine quality, professional lighting.
All cabinet doors CLOSED.`;
}
