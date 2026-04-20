/**
 * 파우더룸(화장대) 전용 프롬프트
 *
 * 대상 category: 'vanity'
 *
 * Step 2 (닫힌 도어): vanityOpts.type 에 따라 스탠딩형 또는 의자형 붙박이 화장대 설치
 *   - standing: 상판 높이 900mm, 플로어~카운터 전체 서랍 뱅크, 원형 거울
 *   - chair:   상판 높이 740mm, 상판 밑 슬림 서랍 2개만, 무릎 공간 전체 오픈, 원형 거울
 * Step 3 (열린 도어): 서랍·캐비닛 열어 내부 수납 보여주기
 *
 * 주의:
 *   - 욕실 워시베이슨(세면대) 이 아님을 반복 강조 (모델이 실수 많음)
 *   - 거울은 반드시 원형 (사각/타원/조약돌 금지)
 *   - 벽 전체 도장/바닥재 변경 금지 (BACKGROUND 보존)
 *
 * 이 파일만 수정해도 다른 카테고리에 영향 없음.
 */

export const VANITY_CATEGORIES = ['vanity'];

function buildStandingVanityPrompt() {
  return `Built-in standing-type dressing table (스탠딩형 붙박이 화장대) — NOT a bathroom vanity, NOT a washbasin. NO water, NO faucet, NO sink, NO plumbing.

[FORM — MUST MATCH THIS EXACT LAYOUT]
- Built between flush full-height side panels inside a recessed niche or flat wall
- COUNTER HEIGHT = 900mm from floor (standing use)
- FLOOR-TO-COUNTER FULL DRAWER BANK (0~900mm): the ENTIRE vertical space from floor up to the countertop is filled with flat-panel drawers stacked vertically — NO open knee space, NO lower cabinet with hinged doors, NO plinth gap
- 4 to 5 horizontal handleless drawers of equal or slightly graduated height (~180~225mm each), full cabinet width, push-to-open or hidden J-profile grip on the top edge of each drawer
- COUNTERTOP slab at ~900mm height, ~12~20mm thick, clean square edge, matte white / cream / solid surface
- BACK PANEL (flush matte) rising from the countertop to the ceiling (~900~2300mm)
- Cabinet width ~800~1200mm, depth ~450~500mm
- Optional tall flat-panel side cabinet adjacent for extra storage (handleless)

[MIRROR — ROUND SHAPE FIXED]
- ONE perfectly ROUND / CIRCULAR mirror (원형거울) wall-mounted on the back wall, centered above the countertop
- Round shape only — STRICTLY NOT rectangular, NOT square, NOT oval, NOT irregular, NOT pebble-shape
- Mirror diameter ~500~600mm, thin frameless or micro-bezel
- Soft indirect lighting behind or around the mirror is optional, subtle only

[FINISH]
- All drawer fronts, side panels, and back wall panels: matte flat-panel, warm off-white or light cream, completely handleless
- Countertop neatly styled: perfume bottles, skincare set, small makeup tray, one jewelry dish — minimal

[FORBIDDEN]
- NO washbasin, NO sink, NO faucet, NO water, NO plumbing, NO toilet, NO bathroom tiles
- NO open knee space under the counter (floor-to-counter MUST be full drawer bank)
- NO hinged doors in the 0~900mm section (drawers only)
- NO rectangular or oval mirrors (round only)
- NO visible handles or knobs

[BACKGROUND — STRICTLY PRESERVE]
- Keep the ORIGINAL room background pixel-identical: wall color/wallpaper/joints, floor material/pattern/board direction, ceiling, columns, beams, niches, windows, doors, baseboards, switches, outlets, lighting, camera angle
- The vanity installs in front of / inside the existing structure — do NOT repaint walls, do NOT change flooring, do NOT remove or alter columns, beams, or any architectural element`;
}

function buildChairVanityPrompt() {
  return `Built-in DESK-STYLE chair-type dressing table (책상형 의자형 붙박이 화장대) — NOT a bathroom vanity, NOT a washbasin. NO water, NO faucet, NO sink, NO plumbing.

[FORM — MUST MATCH THIS EXACT LAYOUT]
- Built between flush full-height side panels (~1400mm total width, ~650mm total depth, floor-to-ceiling)
- COUNTERTOP slab at ~740mm height, ~12mm thick, full ~650mm depth (wall to front edge), matte white solid surface, clean square edge
- TWO slim handleless drawers directly under the countertop (610~740mm), spanning the full width, ~300mm deep (hanging under the rear half of the counter). These drawers are the ONLY storage below the counter
- COMPLETELY OPEN KNEE SPACE below the drawers and below the front half of the counter, all the way from 0~610mm height across the FULL ~650mm depth — NO lower cabinet, NO doors, NO panels, NO toe-kick plinth, just empty negative space for a chair to slide under like a real desk
- BACK PANEL (flush matte) rising from the countertop to the ceiling (~740~2300mm), a clean empty wall except for the mirror
- Top crown moulding (~2240~2300mm)

[MIRROR — ROUND SHAPE FIXED]
- ONE perfectly ROUND / CIRCULAR mirror (원형거울) wall-mounted on the back wall, CENTERED horizontally above the countertop
- Round shape only — STRICTLY NOT rectangular, NOT square, NOT oval, NOT irregular
- Mirror diameter ~500~600mm, thin frameless or micro-bezel
- Optional subtle indirect light behind the round mirror

[SEATING]
- Matching upholstered dressing stool or small chair tucked UNDER the countertop (the entire under-counter space is open, so the chair slides fully in like a real desk)

[FINISH]
- All panels, doors, and drawer fronts: matte flat-panel, completely handleless, warm off-white or light cream
- Countertop neatly styled: perfume bottle, skincare bottles, a small makeup tray, one jewelry dish — minimal

[FORBIDDEN]
- NO washbasin, NO sink, NO faucet, NO plumbing, NO toilet, NO bathroom tiles
- NO lower cabinet of ANY depth under the counter — under-counter space MUST be entirely open (only 2 slim drawers hanging under the counter are allowed)
- NO hinged doors below the counter (drawers only, and only hanging under the counter slab)
- NO toe-kick plinth at the floor
- NO side shelving column, NO tower, NO extra storage structure next to the mirror — only the clean back panel with the round mirror
- NO rectangular or oval mirrors (round only)
- NO visible handles or knobs on any door or drawer

[BACKGROUND — STRICTLY PRESERVE]
- Keep the ORIGINAL room background pixel-identical: wall color/wallpaper/joints, floor material/pattern/board direction, ceiling, columns, beams, niches, windows, doors, baseboards, switches, outlets, lighting, camera angle
- The vanity installs in front of / inside the existing structure — do NOT repaint walls, do NOT change flooring, do NOT remove or alter columns, beams, or any architectural element`;
}

export function buildVanityClosedPrompt({ wallData, themeData, styleName, vanityOpts }) {
  const type = vanityOpts?.type === 'chair' ? 'chair' : 'standing';
  const doorColor = themeData.style_door_color || 'warm off-white';
  const basePrompt = type === 'chair' ? buildChairVanityPrompt() : buildStandingVanityPrompt();
  return `Edit photo: install a ${doorColor} tone ${styleName} built-in vanity on this wall (~${wallData.wallW}mm wide × ${wallData.wallH}mm tall).

${basePrompt}

Photorealistic. All closed (drawers closed, doors closed). No text/labels.`;
}

export function buildVanityAltSpec({ vanityOpts }) {
  const type = vanityOpts?.type === 'chair' ? 'chair' : 'standing';
  const interiorHint = type === 'chair'
    ? 'the 2 slim under-counter drawers open showing makeup, skincare bottles, small accessories'
    : 'the stacked floor-to-counter drawers open showing folded cosmetics, makeup tools, jewelry';
  return {
    inputKey: 'closed',
    prompt: `Using this closed dressing-table image, generate the SAME vanity with drawers OPEN (~80° pulled out).
RULES:
- SAME camera angle, lighting, background, furniture position, mirror, countertop styling
- Open the drawers and show ${interiorHint}
- Do NOT add or change any structure, panel, or finish
- Do NOT convert this into a bathroom vanity — still NO sink, NO faucet, NO water
- Photorealistic quality`,
    metadata: { alt_style: { name: '내부 구조 (열린문)', type } },
  };
}

export const __internals = { buildStandingVanityPrompt, buildChairVanityPrompt };
