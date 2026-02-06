// ═══════════════════════════════════════════════════════════════
// Style-Color Prompt Builder (Single Source of Truth)
// 기존: http-server.ts 421~500줄
// ═══════════════════════════════════════════════════════════════

import type { CabinetSpecs } from './closed-door.prompt.js';

export function buildStyleColorPrompt(
  style: string,
  styleKeywords: string,
  styleAtmosphere: string,
  colorPrompt: string,
  cabinetSpecs?: CabinetSpecs
): string {
  const specs = cabinetSpecs || {};

  let specsSection = '';
  if (Object.keys(specs).length > 0) {
    specsSection = `
[CABINET SPECIFICATIONS]
${specs.total_width_mm ? `- Total width: ${specs.total_width_mm}mm` : ''}
${specs.total_height_mm ? `- Total height: ${specs.total_height_mm}mm` : ''}
${specs.countertop_color ? `- Countertop: ${specs.countertop_color}` : ''}
${specs.handle_type ? `- Handle: ${specs.handle_type}` : ''}`;
  }

  return `[MOST IMPORTANT - READ FIRST]
This is a PHOTO generation task, NOT a technical drawing.
DO NOT ADD ANY TEXT, NUMBERS, DIMENSIONS, OR LABELS TO THE IMAGE.
The output must be a CLEAN photograph with NO annotations whatsoever.

[TASK: KOREAN APARTMENT KITCHEN - PHOTOREALISTIC PHOTOGRAPH]
Generate a photorealistic interior photograph of a modern Korean apartment kitchen.

[INTERIOR STYLE: ${style.toUpperCase().replace('-', ' ')}]
Style keywords: ${styleKeywords}
Atmosphere: ${styleAtmosphere}

[DOOR COLOR & FINISH]
Cabinet door color: ${colorPrompt}
- Apply this color consistently to all cabinet doors (upper and lower)
- Matte or satin finish preferred
- Seamless flat panel doors with concealed hinges

[KITCHEN LAYOUT]
- Korean I-shaped or L-shaped kitchen layout
- Upper cabinets: wall-mounted, reaching near ceiling
- Lower cabinets: base cabinets with countertop
- Integrated sink and cooktop area
- Clean countertop surface (engineered stone or similar)

[ROOM SETTING]
- Modern Korean apartment (typical 30-40 pyeong apartment)
- Ceiling height: approximately 2.3-2.4m
- Natural lighting from window (if visible)
- Light-colored walls (white or light gray)
- Light wood or tile flooring

[APPLIANCES & FIXTURES]
- Built-in or under-counter refrigerator space
- Recessed or slim range hood
- Modern single-lever faucet
- Undermount or integrated sink
${specsSection}

[CAMERA ANGLE]
- Eye-level perspective, slightly angled
- Show full kitchen from one end
- Professional interior photography composition

[STRICTLY FORBIDDEN - WILL REJECT IF VIOLATED]
- NO dimension labels, measurements, or rulers
- NO text, numbers, letters, or characters anywhere
- NO arrows, lines, or technical markings
- NO watermarks, logos, or brand names
- NO people, pets, or moving objects
- NO food items or cooking utensils on counters
- NO annotations of any kind

[OUTPUT REQUIREMENTS]
- Photorealistic quality (must look like a real photograph)
- Magazine-quality interior design photography
- Professional lighting with natural feel
- All cabinet doors CLOSED
- Clean, uncluttered countertops
- High resolution, sharp details`;
}
