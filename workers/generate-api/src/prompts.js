/**
 * 프롬프트 — 전 품목 공용 (2026-09 v2)
 *
 * 구조는 넷이다.
 *   1. 분석   buildAnalysisPrompt()            사진 → 벽 치수 + 방 브리프 JSON (텍스트)
 *   2. 설치   buildInstallPrompt(ctx, {fix})   방 사진 → 가구 설치 (이미지, 문 닫힘)
 *   3. 검사   buildQcPrompt(ctx) / parseQc     설치 결과가 규칙을 지켰는지 (텍스트 JSON)
 *   4. 변형   buildVariantPrompt(finish)       설치 결과 → 마감만 바꾼 추천안 (이미지)
 *
 * 품목 차이는 CATEGORIES[key].spec 한 문단이 전부다. 나머지 문장은 모든 품목이 같다.
 * 품목을 추가하려면 CATEGORIES 에 한 항목을 넣는다. 다른 파일은 손대지 않는다.
 *
 * 이 파일은 import 가 없어야 한다 — __tests__/generate-prompts.test.js 가 export 만 떼어 평가한다.
 *
 * 손잡이 규칙(CLAUDE.md): 전 품목 매립형(handleless). 하부장 도어는 도어 뒤로 손을
 * 넣어 연다. 크롬 바 손잡이·push-to-open 금지.
 */

export const STYLES = {
  'modern-minimal': 'modern minimal',
  scandinavian: 'Scandinavian',
  industrial: 'industrial',
  classic: 'classic',
  luxury: 'luxury premium',
};

export const DEFAULT_STYLE = 'modern-minimal';

/** 화면(ai-design.html KINDS) 의 key 와 1:1 이다. 매치 안 되면 storage 로 간다. */
export const CATEGORIES = {
  sink: {
    label: '싱크대',
    spec: (c) =>
      `Straight kitchen run along the wall. Upper cabinets flush to the ceiling. ` +
      `Lower cabinets in 600 mm modules under one continuous stone countertop. ` +
      `Undermount sink about ${c.waterPct}% of the way from the left, flush induction cooktop ` +
      `about ${c.exhaustPct}% from the left with a slim concealed hood above it. ` +
      `A two-drawer stack under the cooktop, single full-height doors elsewhere. No visible appliances.`,
  },
  island: {
    label: '아일랜드',
    spec: (c) =>
      CATEGORIES.sink.spec(c) +
      ` In front of the run add a freestanding island in the same finish, with a matching countertop ` +
      `and a seating overhang on the room side.`,
  },
  wardrobe: {
    label: '붙박이장',
    spec: (c) =>
      `Floor-to-ceiling wardrobe covering the full wall width with ${wardrobeDoors(c.wallW)} equal ` +
      `full-height flat doors arranged in mirrored pairs. No gap to the ceiling or the side walls.`,
  },
  storage: {
    label: '수납장',
    spec: () =>
      `Floor-to-ceiling storage cabinet covering the wall, divided into equal sections of ` +
      `full-height flat doors.`,
  },
  fridge: {
    label: '냉장고장',
    spec: (c) =>
      `Refrigerator surround: a recess holding a ${c.fridgeBrand} french-door refrigerator on the ` +
      `${c.fridgePosition} side, tall pantry columns filling the rest of the width, and a bridge ` +
      `cabinet above the refrigerator up to the ceiling. The refrigerator front sits flush with the doors.`,
  },
  vanity: {
    label: '화장대',
    spec: () =>
      `Dressing table: a wall-mounted counter with a bank of drawers, a large frameless mirror above ` +
      `with soft integrated lighting, and a tall cabinet at one end.`,
  },
  shoe: {
    label: '신발장',
    spec: () =>
      `Entrance shoe cabinet: a tall unit and a floating lower unit with a lit gap beneath it, ` +
      `all in full-height flat doors.`,
  },
  office: {
    label: '사무실',
    spec: () =>
      `Home office wall: a desk spanning the wall with drawer units below, wall cabinets above, ` +
      `and one section of open shelves.`,
  },
};

/** 벽 폭에 따른 붙박이장 도어 수. 짝수만 — Gemini 는 좌우 대칭 쌍으로 그린다. */
export function wardrobeDoors(wallW) {
  if (wallW > 3200) return 8;
  if (wallW > 2600) return 6;
  return 4;
}

export function resolveCategory(key) {
  return CATEGORIES[key] ? key : 'storage';
}

// ─── 1. 분석 ───
export function buildAnalysisPrompt() {
  return `Measure and describe this room photo for built-in furniture on the main wall facing the camera.
Use known Korean apartment sizes for scale: door frame 900 x 2100 mm, outlet plate 70 x 120 mm, ceiling 2300-2400 mm.
Return JSON only, no prose:
{"wall_width_mm":number,"wall_height_mm":number,"water_supply_from_left_mm":number|null,"exhaust_from_left_mm":number|null,"confidence":"high"|"medium"|"low","room_brief":string,"existing_furniture":string|null,"site_condition":"finished"|"construction","site_notes":string|null,"wall_tile":{"present":boolean,"light_neutral":boolean,"description":string|null}}
water_supply = position of an existing sink or faucet along that wall, exhaust = position of an existing cooker hood; null when there is none.
room_brief = at most 60 words: floor material and colour, wall finish and colour, where the light comes from, camera height and angle, anything on the side walls that must stay.
existing_furniture = what is currently on the main wall and must be removed before installing (e.g. "dark glossy kitchen cabinets with stainless hood"), or null if the wall is empty.
site_condition = "construction" when the room is unfinished or mid-renovation: bare cement or plaster, exposed pipes or wiring, debris, tools, boxes, dust, protective film, missing flooring. Otherwise "finished". site_notes = what is unfinished, at most 25 words, or null.
wall_tile = tiles on the target wall (backsplash or wall cladding). light_neutral is true only for white, ivory, light grey or light beige tiles with low saturation; dark, brown, black, glossy-coloured or patterned tiles are false. description = colour and finish, at most 12 words.`;
}

/** 분석 JSON → 워커가 쓰는 벽 데이터 + 브리프. 값이 없거나 이상하면 기본값. */
export function parseAnalysis(text) {
  const out = {
    wallW: 3000,
    wallH: 2400,
    waterPct: 30,
    exhaustPct: 70,
    confidence: null,
    brief: null,
    existing: null,
    site: 'finished', // 'finished' | 'construction'
    siteNotes: null,
    tile: null, // {present, lightNeutral, description} | null
  };
  const m = text && text.match(/\{[\s\S]*\}/);
  if (!m) return out;
  let j;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return out;
  }
  const mm = (v) => (v > 0 && v < 100 ? Math.round(v * 1000) : Math.round(v)); // m → mm 보호
  if (j.wall_width_mm > 0) out.wallW = clampWall(mm(j.wall_width_mm));
  if (j.wall_height_mm > 0) out.wallH = Math.max(2000, Math.min(3000, mm(j.wall_height_mm)));
  if (j.water_supply_from_left_mm > 0)
    out.waterPct = pct(mm(j.water_supply_from_left_mm), out.wallW);
  if (j.exhaust_from_left_mm > 0) out.exhaustPct = pct(mm(j.exhaust_from_left_mm), out.wallW);
  out.confidence = j.confidence || null;
  if (typeof j.room_brief === 'string' && j.room_brief.trim())
    out.brief = j.room_brief.trim().slice(0, 500);
  if (typeof j.existing_furniture === 'string' && j.existing_furniture.trim())
    out.existing = j.existing_furniture.trim().slice(0, 200);
  if (j.site_condition === 'construction') out.site = 'construction';
  if (typeof j.site_notes === 'string' && j.site_notes.trim())
    out.siteNotes = j.site_notes.trim().slice(0, 160);
  if (j.wall_tile && typeof j.wall_tile === 'object') {
    out.tile = {
      present: j.wall_tile.present === true,
      lightNeutral: j.wall_tile.light_neutral === true,
      description:
        typeof j.wall_tile.description === 'string' && j.wall_tile.description.trim()
          ? j.wall_tile.description.trim().slice(0, 80)
          : null,
    };
  }
  return out;
}

export function clampWall(w) {
  return Math.max(1000, Math.min(6000, Math.round(w)));
}

function pct(x, w) {
  return Math.max(5, Math.min(95, Math.round((x / w) * 100)));
}

// ─── 2. 설치 ───
/** QC 가 낸 문제 코드 → 재시도 프롬프트에 붙일 FIX 문장. */
export const QC_FIXES = {
  handles:
    'Remove every handle, knob, pull and metal hardware from all fronts; every door and drawer is a flat, uninterrupted panel.',
  doors_open: 'Close every door and drawer; show no interior.',
  room_changed:
    'Restore the original room exactly: same camera angle, walls, ceiling, floor, windows and lighting as the first photo. Only the furniture on the main wall changes.',
  gap_to_ceiling: 'Upper cabinets and tall units reach the ceiling with no gap.',
  appliances_visible:
    'Hide free-standing appliances; only the integrated cooktop, sink and hood may show.',
  text: 'Remove all text, labels, logos and watermarks.',
  wrong_category: 'Render exactly the furniture type described in FURNITURE, nothing else.',
  low_detail:
    'Render at full photographic detail: crisp panel edges, real material grain, accurate reflections and soft contact shadows.',
  construction_leftover:
    'Finish the room completely: no debris, tools, boxes, dust, protective film or bare cement anywhere in the frame; hide every exposed pipe, valve and wire behind the furniture or inside the wall.',
  tile_not_neutral:
    'Replace every wall tile visible around the furniture with light neutral tiles: matte off-white or light grey, low saturation.',
};

/**
 * @param {object} c
 * @param {string} c.category      CATEGORIES 의 key
 * @param {number} c.wallW / c.wallH / c.waterPct / c.exhaustPct
 * @param {string} [c.brief]       분석 단계의 room_brief
 * @param {string} [c.existing]    철거할 기존 가구 설명
 * @param {string} c.style         STYLES 의 key
 * @param {string} c.doorColor     예: 'white'
 * @param {string} c.doorFinish    예: 'matte'
 * @param {number} c.refCount      함께 첨부한 참고 이미지 수
 * @param {string} c.fridgeBrand / c.fridgePosition
 * @param {{fix?: string[]}} [opts]  QC 재시도 시 문제 코드 목록
 */
export function buildInstallPrompt(c, opts = {}) {
  const key = resolveCategory(c.category);
  const cat = CATEGORIES[key];
  const style = STYLES[c.style] || STYLES[DEFAULT_STYLE];
  const room = c.brief ? `\nROOM: ${c.brief}` : '';
  const existing = c.existing
    ? `\nREMOVE FIRST: ${c.existing}. Replace it cleanly with no demolition marks, patched walls or ghost outlines.`
    : `\nIf furniture already exists on that wall, remove it and replace it cleanly with no demolition marks.`;
  const refs =
    c.refCount > 0
      ? `\nThe additional ${c.refCount === 1 ? 'image is a' : 'images are'} style reference: match the door colour, material grain direction, sheen and overall mood of the reference fronts. Never copy the reference layout, room or camera.`
      : '';
  // 공사 현장이면 완공된 방으로 그린다. 방 형태·창·카메라는 그대로.
  const site =
    c.site === 'construction'
      ? `\nSITE: the photo shows an unfinished construction site${c.siteNotes ? ` (${c.siteNotes})` : ''}. Render the room fully finished and clean: remove debris, tools, boxes, dust and protective film; finish bare walls and ceiling smoothly in a light neutral tone; complete the flooring to match what already exists; route every exposed pipe, valve and wire behind the new furniture or inside the wall so none stays visible. Keep the room geometry, window positions and camera unchanged.`
      : '';
  // 벽 타일: 밝은 무채색이면 그대로, 아니면 밝은 무채색 타일로 바꾼다.
  const tile =
    !c.tile || !c.tile.present
      ? ''
      : c.tile.lightNeutral
        ? `\nWALL TILE: keep the existing light tiles exactly as they are.`
        : `\nWALL TILE: the existing wall tiles${c.tile.description ? ` (${c.tile.description})` : ''} are not light neutral. Replace them with light neutral tiles — matte off-white or light grey large-format ceramic with subtle grout — only where tiles already are (the wall area between the furniture pieces).`;
  const fixes = (opts.fix || []).map((k) => QC_FIXES[k]).filter(Boolean);
  const fixBlock = fixes.length
    ? `\nFIX (the previous attempt failed these checks):\n- ${fixes.join('\n- ')}`
    : '';
  return `Edit the first photo: install a built-in ${cat.label} (${key}) on the main wall.
Keep the room exactly as photographed: camera angle, walls, ceiling, floor, windows, lighting and everything outside the furniture.${existing}${room}
WALL: about ${c.wallW} x ${c.wallH} mm.
FURNITURE: ${cat.spec(c)}
FINISH: ${c.doorColor} ${c.doorFinish} flat-panel fronts, ${style} style, consistent on every panel.
HANDLES: none. Every door and drawer is a flat handleless front; lower doors open by reaching behind the door edge. No bar handles, knobs, chrome hardware or push-to-open buttons.${site}${tile}${refs}${fixBlock}
All doors and drawers closed. Photorealistic interior photograph with natural lighting and correct shadows. No text, labels or watermarks.`;
}

// ─── 3. 검사 ───
export const QC_ISSUE_CODES = Object.keys(QC_FIXES);

/** 설치 결과 한 장을 보고 규칙 위반을 JSON 으로 판정한다. 관대하게 — 명백할 때만 실패. */
export function buildQcPrompt(c) {
  const key = resolveCategory(c.category);
  return `You are checking an AI-rendered photo of a built-in ${CATEGORIES[key].label} (${key}) installed in a real room.
Answer JSON only: {"ok":boolean,"issues":[string],"note":string}
Report an issue ONLY when it is clearly visible. Use these codes:
- handles: any visible handle, knob, pull or metal bar on a door or drawer
- doors_open: any door or drawer open or interior shown
- room_changed: the room itself looks re-rendered (different walls, floor, window, ceiling or camera angle)
- gap_to_ceiling: a clear gap between the top of the tall/upper units and the ceiling
- appliances_visible: free-standing appliances (microwave, kettle, standalone fridge) on show
- text: any text, label, logo or watermark
- wrong_category: the furniture is not a ${CATEGORIES[key].label}
- low_detail: blurry, smeared or obviously synthetic surfaces
- construction_leftover: debris, tools, boxes, protective film, exposed pipes or bare unfinished walls still visible
- tile_not_neutral: wall tiles around the furniture are dark, brown, black or strongly coloured (light neutral tiles are fine)
ok is true when issues is empty. note is one short sentence.`;
}

/** @returns {{ok:boolean, issues:string[], note:string|null}} */
export function parseQc(text) {
  const fallback = { ok: true, issues: [], note: null }; // 검사 실패는 통과로 — 검사 때문에 생성을 막지 않는다
  const m = text && text.match(/\{[\s\S]*\}/);
  if (!m) return fallback;
  try {
    const j = JSON.parse(m[0]);
    const issues = Array.isArray(j.issues)
      ? j.issues.map(String).filter((k) => QC_ISSUE_CODES.includes(k))
      : [];
    return { ok: issues.length === 0, issues, note: typeof j.note === 'string' ? j.note : null };
  } catch {
    return fallback;
  }
}

// ─── 4. 변형 (추천안) ───
/** 다담이 실제로 쓰는 마감 톤. 한 요청 안에서는 서로 다른 것만 뽑는다. */
export const FINISHES = [
  { key: 'warm-oak', body: 'warm oak woodgrain', accent: 'matte cream', tone: '웜 오크' },
  { key: 'matte-white', body: 'matte pure white', accent: 'light oak', tone: '무광 화이트' },
  { key: 'greige', body: 'matte greige', accent: 'brushed champagne', tone: '그레이지' },
  { key: 'deep-navy', body: 'deep navy matte', accent: 'warm oak', tone: '딥 네이비' },
  { key: 'clay', body: 'muted clay beige matte', accent: 'soft white', tone: '클레이 베이지' },
  {
    key: 'charcoal',
    body: 'charcoal grey matte',
    accent: 'pale ash woodgrain',
    tone: '차콜 그레이',
  },
  { key: 'sage', body: 'muted sage green matte', accent: 'natural oak', tone: '세이지 그린' },
  { key: 'walnut', body: 'walnut woodgrain', accent: 'matte off-white', tone: '월넛' },
];

/** 시드로 n개를 겹치지 않게 뽑는다. 같은 입력이면 같은 추천이 나와 로그로 되짚을 수 있다. */
export function pickFinishes(n, seed) {
  const pool = FINISHES.slice();
  const out = [];
  let s = seed >>> 0 || 1;
  for (let i = 0; i < n && pool.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    out.push(pool.splice(s % pool.length, 1)[0]);
  }
  return out;
}

// ─── 5. 테마 색감 (참고 이미지 중 '테마' 는 색감만 빌린다) ───
/**
 * 테마 이미지(식물·명품·회화 등 가구가 아닌 사진)에서 마감 2색을 뽑는다.
 * 결과는 FINISHES 항목과 같은 모양이라 buildVariantPrompt 에 그대로 들어간다.
 */
export function buildThemePalettePrompt() {
  return `These images are mood references (not furniture). Extract a cabinet colour scheme from them.
Answer JSON only: {"body":string,"accent":string,"tone":string}
body = one paint-like finish for door and drawer fronts, in English, e.g. "muted sage green matte", "deep terracotta matte", "warm sand beige matte". Prefer the dominant calm colour; never white or black.
accent = a second finish for side panels and open shelves that pairs with body, e.g. "natural oak woodgrain", "matte cream".
tone = the scheme's name in Korean, 2-6 characters, e.g. "세이지 그린", "테라코타".`;
}

/** @returns {{key:'theme', body:string, accent:string, tone:string}|null} */
export function parseThemePalette(text) {
  const m = text && text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const clean = (v, max) =>
      typeof v === 'string' && v.trim()
        ? v
            .trim()
            .replace(/[\r\n"]+/g, ' ')
            .slice(0, max)
        : null;
    const body = clean(j.body, 60);
    const accent = clean(j.accent, 60) || 'natural oak woodgrain';
    const tone = clean(j.tone, 12) || '테마 색감';
    return body ? { key: 'theme', body, accent, tone } : null;
  } catch {
    return null;
  }
}

export function buildVariantPrompt(finish) {
  return `Recolour the built-in furniture in this photo to a different finish:
- Door and drawer fronts: ${finish.body}
- Side panels, open shelves and accents: ${finish.accent}
Keep everything else identical: camera, room, furniture layout, every door and drawer line, countertop, lighting and shadows. Handleless fronts stay handleless. All doors stay closed.
Photorealistic. No text, labels or watermarks.`;
}
