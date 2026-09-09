/**
 * 프롬프트 — 전 품목 공용 (2026-09 초기화판)
 *
 * 구조는 셋뿐이다.
 *   1. 분석   buildAnalysisPrompt()            사진 → 벽 치수 JSON (텍스트)
 *   2. 설치   buildInstallPrompt(ctx)          방 사진 → 가구 설치 (이미지, 문 닫힘)
 *   3. 변형   buildVariantPrompt(finish)       설치 결과 → 마감만 바꾼 추천안 (이미지)
 *
 * 품목 차이는 CATEGORIES[key].spec 한 문단이 전부다. 나머지 문장은 모든 품목이 같다.
 * 품목을 추가하려면 CATEGORIES 에 한 항목을 넣는다. 다른 파일은 손대지 않는다.
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
  return `Measure this room photo for built-in furniture on the main wall facing the camera.
Use known Korean apartment sizes for scale: door frame 900 x 2100 mm, outlet plate 70 x 120 mm, ceiling 2300-2400 mm.
Return JSON only, no prose:
{"wall_width_mm":number,"wall_height_mm":number,"water_supply_from_left_mm":number|null,"exhaust_from_left_mm":number|null,"confidence":"high"|"medium"|"low"}
water_supply = position of an existing sink or faucet along that wall, exhaust = position of an existing cooker hood; null when there is none.`;
}

/** 분석 JSON → 워커가 쓰는 벽 데이터. 값이 없거나 이상하면 기본값. */
export function parseAnalysis(text) {
  const out = { wallW: 3000, wallH: 2400, waterPct: 30, exhaustPct: 70, confidence: null };
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
  return out;
}

export function clampWall(w) {
  return Math.max(1000, Math.min(6000, Math.round(w)));
}

function pct(x, w) {
  return Math.max(5, Math.min(95, Math.round((x / w) * 100)));
}

// ─── 2. 설치 ───
/**
 * @param {object} c
 * @param {string} c.category      CATEGORIES 의 key
 * @param {number} c.wallW / c.wallH / c.waterPct / c.exhaustPct
 * @param {string} c.style         STYLES 의 key
 * @param {string} c.doorColor     예: 'white'
 * @param {string} c.doorFinish    예: 'matte'
 * @param {number} c.refCount      함께 첨부한 참고 이미지 수
 * @param {string} c.fridgeBrand / c.fridgePosition
 */
export function buildInstallPrompt(c) {
  const key = resolveCategory(c.category);
  const cat = CATEGORIES[key];
  const style = STYLES[c.style] || STYLES[DEFAULT_STYLE];
  const refs =
    c.refCount > 0
      ? `\nThe additional ${c.refCount === 1 ? 'image is a' : 'images are'} style reference: borrow finish, colour and mood only, never the layout or the room.`
      : '';
  return `Edit the first photo: install a built-in ${cat.label} (${key}) on the main wall.
Keep the room exactly as photographed: camera angle, walls, ceiling, floor, windows, lighting and everything outside the furniture. If furniture already exists on that wall, remove it and replace it cleanly with no demolition marks.
WALL: about ${c.wallW} x ${c.wallH} mm.
FURNITURE: ${cat.spec(c)}
FINISH: ${c.doorColor} ${c.doorFinish} flat-panel fronts, ${style} style, consistent on every panel.
HANDLES: none. Every door and drawer is a flat handleless front; lower doors open by reaching behind the door edge. No bar handles, knobs, chrome hardware or push-to-open buttons.${refs}
All doors and drawers closed. Photorealistic interior photograph with natural lighting and correct shadows. No text, labels or watermarks.`;
}

// ─── 3. 변형 (추천안) ───
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

export function buildVariantPrompt(finish) {
  return `Recolour the built-in furniture in this photo to a different finish:
- Door and drawer fronts: ${finish.body}
- Side panels, open shelves and accents: ${finish.accent}
Keep everything else identical: camera, room, furniture layout, every door and drawer line, countertop, lighting and shadows. Handleless fronts stay handleless. All doors stay closed.
Photorealistic. No text, labels or watermarks.`;
}
