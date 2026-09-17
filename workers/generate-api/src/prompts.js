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
 * 예외 하나: 요청이 design_spec(플래너 도면 요약)을 주면 그 한 문단 대신 실제
 * 모듈·치수·자재로 FURNITURE·FINISH 를 쓴다 (normalizeDesignSpec / buildDesignSpecBlock).
 * design_spec 이 없으면 프롬프트는 예전과 한 글자도 다르지 않다 — test/install-prompt-snapshot.test.js
 * 가 옛 출력 전문을 붙들고 있다. 계약: docs/02-design/features/design-spec-prompt.md
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
      `Undermount sink about ${c.waterPct}% of the way from the left with a single-lever mixer faucet ` +
      `(matte black or brushed steel) mounted on the countertop behind it — the faucet is mandatory. ` +
      `Flush induction cooktop about ${c.exhaustPct}% from the left with a slim concealed hood above it. ` +
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

// ─── 1-a. 도면 요약 (design_spec) ───
/**
 * 플래너가 그린 설계를 그대로 설치 프롬프트에 싣기 위한 입력.
 * 계약 문서: docs/02-design/features/design-spec-prompt.md — 필드 이름을 바꾸면 같이 고친다.
 *
 * 없으면(null) 지금까지와 똑같이 CATEGORIES[key].spec 한 문단으로 그린다.
 * 있으면 FURNITURE 블록이 실제 모듈·치수·자재로 바뀐다.
 *
 * 검증은 방어적이다: 말이 안 되는 수치는 자르고(clamp), 배열은 길이를 막고,
 * 유한하지 않은 숫자(NaN·Infinity·문자열)와 품목 불일치만 400 으로 되돌린다.
 */
export const DESIGN_SPEC_VERSION = 1;

/** 왼→오 한 줄로 읽는 구간. 순서는 이 배열이 정한다. */
export const DESIGN_SECTIONS = ['lower', 'upper', 'tall'];
export const DESIGN_MODULE_KINDS = ['door', 'drawer', 'open', 'appliance'];
export const DESIGN_APPLIANCE_KINDS = ['sink', 'hood', 'cooktop', 'fridge', 'dishwasher'];
/** layout.js·플래너가 쓰는 다른 이름을 받아 준다. */
const DESIGN_APPLIANCE_ALIASES = { refrigerator: 'fridge', range: 'cooktop', hob: 'cooktop' };
export const DESIGN_FINISH_SLOTS = ['door', 'body', 'top'];
export const DESIGN_FINISH_TONES = ['matte', 'gloss', 'satin', 'woodgrain', 'texture'];

const DESIGN_MAX_MODULES = 40;
const DESIGN_MAX_APPLIANCES = 12;
const DESIGN_MAX_JSON = 20000;
/** [최소, 최대] mm. 벗어나면 자른다 — 플래너 버그 하나가 프롬프트를 망치지 않게. */
const DESIGN_RANGE = {
  wallRunMm: [300, 12000],
  widthMm: [100, 12000],
  heightMm: [100, 3600],
  depthMm: [50, 1200],
  fromLeftMm: [0, 12000],
  moduleWidthMm: [50, 4000],
  applianceWidthMm: [50, 4000],
  count: [0, 12],
};

/** design_spec 전용 400. code 를 따로 주어 플래너가 다른 400 과 구분한다. */
export class DesignSpecError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DesignSpecError';
    this.statusCode = 400;
    this.code = 'bad_design_spec';
  }
}

function designNum(v, field) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' && typeof v !== 'string')
    throw new DesignSpecError(`design_spec.${field} must be a number`);
  const n = Number(v);
  if (!Number.isFinite(n))
    throw new DesignSpecError(`design_spec.${field} must be a finite number`);
  return n;
}

function designMm(v, field, range) {
  const n = designNum(v, field);
  if (n === null) return null;
  return Math.round(Math.min(range[1], Math.max(range[0], n)));
}

function designText(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\r\n\t]+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

function designHex(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `#${h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h}`;
}

function normalizeDesignModule(raw, section) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const where = `sections.${section}.modules[]`;
  const out = { kind: DESIGN_MODULE_KINDS.includes(raw.kind) ? raw.kind : 'door' };
  const widthMm = designMm(raw.widthMm, `${where}.widthMm`, DESIGN_RANGE.moduleWidthMm);
  if (widthMm !== null) out.widthMm = widthMm;
  const doorCount = designMm(raw.doorCount, `${where}.doorCount`, DESIGN_RANGE.count);
  if (doorCount !== null) out.doorCount = doorCount;
  const drawerCount = designMm(raw.drawerCount, `${where}.drawerCount`, DESIGN_RANGE.count);
  if (drawerCount !== null) out.drawerCount = drawerCount;
  const label = designText(raw.label, 40);
  if (label) out.label = label;
  return out;
}

function normalizeDesignSection(raw, section) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const where = `sections.${section}`;
  const out = {};
  for (const f of ['widthMm', 'heightMm', 'depthMm', 'fromLeftMm']) {
    const v = designMm(raw[f], `${where}.${f}`, DESIGN_RANGE[f]);
    if (v !== null) out[f] = v;
  }
  const list = Array.isArray(raw.modules) ? raw.modules.slice(0, DESIGN_MAX_MODULES) : [];
  const modules = list.map((m) => normalizeDesignModule(m, section)).filter(Boolean);
  if (modules.length) out.modules = modules;
  return Object.keys(out).length ? out : null;
}

function normalizeDesignAppliance(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const key = typeof raw.kind === 'string' ? raw.kind.trim().toLowerCase() : '';
  const kind = DESIGN_APPLIANCE_ALIASES[key] || key;
  if (!DESIGN_APPLIANCE_KINDS.includes(kind)) return null; // 모르는 가전은 조용히 뺀다
  const out = { kind };
  const fromLeftMm = designMm(raw.fromLeftMm, 'appliances[].fromLeftMm', DESIGN_RANGE.fromLeftMm);
  if (fromLeftMm !== null) out.fromLeftMm = fromLeftMm;
  const widthMm = designMm(raw.widthMm, 'appliances[].widthMm', DESIGN_RANGE.applianceWidthMm);
  if (widthMm !== null) out.widthMm = widthMm;
  return out;
}

function normalizeDesignFinish(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  const name = designText(raw.name, 60);
  if (name) out.name = name;
  const nameEn = designText(raw.nameEn, 60);
  if (nameEn) out.nameEn = nameEn;
  const colorHex = designHex(raw.colorHex);
  if (colorHex) out.colorHex = colorHex;
  if (typeof raw.tone === 'string' && DESIGN_FINISH_TONES.includes(raw.tone.trim().toLowerCase()))
    out.tone = raw.tone.trim().toLowerCase();
  const vendorCode = designText(raw.vendorCode, 24);
  if (vendorCode) out.vendorCode = vendorCode;
  return Object.keys(out).length ? out : null;
}

/**
 * 요청 본문의 design_spec → generations.options.design_spec 에 넣을 모양.
 * @param {*} raw          요청이 준 값 (없으면 null·undefined)
 * @param {string} category  같은 요청의 품목 (resolveCategory 전·후 아무거나)
 * @returns {object|null}  없으면 null
 * @throws {DesignSpecError} 모양이 틀렸거나 품목이 어긋나면
 */
export function normalizeDesignSpec(raw, category) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw new DesignSpecError('design_spec must be an object');

  let size;
  try {
    size = JSON.stringify(raw).length;
  } catch {
    throw new DesignSpecError('design_spec is not serialisable');
  }
  if (size > DESIGN_MAX_JSON)
    throw new DesignSpecError(`design_spec is too large (${size} > ${DESIGN_MAX_JSON} chars)`);

  const want = resolveCategory(category);
  if (raw.category !== undefined && raw.category !== null && raw.category !== '') {
    if (typeof raw.category !== 'string' || !CATEGORIES[raw.category] || raw.category !== want) {
      throw new DesignSpecError(
        `design_spec.category (${String(raw.category).slice(0, 40)}) does not match category (${want})`
      );
    }
  }

  const out = { version: DESIGN_SPEC_VERSION, category: want };
  const wallRunMm = designMm(raw.wallRunMm, 'wallRunMm', DESIGN_RANGE.wallRunMm);
  if (wallRunMm !== null) out.wallRunMm = wallRunMm;

  const rawSections =
    raw.sections && typeof raw.sections === 'object' && !Array.isArray(raw.sections)
      ? raw.sections
      : {};
  const sections = {};
  for (const key of DESIGN_SECTIONS) {
    const sec = normalizeDesignSection(rawSections[key], key);
    if (sec) sections[key] = sec;
  }
  if (Object.keys(sections).length) out.sections = sections;

  const rawAppliances = Array.isArray(raw.appliances)
    ? raw.appliances.slice(0, DESIGN_MAX_APPLIANCES)
    : [];
  const appliances = rawAppliances.map(normalizeDesignAppliance).filter(Boolean);
  if (appliances.length) out.appliances = appliances;

  const rawFinishes =
    raw.finishes && typeof raw.finishes === 'object' && !Array.isArray(raw.finishes)
      ? raw.finishes
      : {};
  const finishes = {};
  for (const slot of DESIGN_FINISH_SLOTS) {
    const f = normalizeDesignFinish(rawFinishes[slot]);
    if (f) finishes[slot] = f;
  }
  if (Object.keys(finishes).length) out.finishes = finishes;

  const notes = designText(raw.notes, 300);
  if (notes) out.notes = notes;

  if (!out.sections && !out.appliances && !out.finishes && out.wallRunMm === undefined) {
    throw new DesignSpecError(
      'design_spec has nothing usable — need at least one of wallRunMm, sections, appliances, finishes'
    );
  }
  return out;
}

// ─── 1-b. 도면 요약 → 영어 문장 ───

const DESIGN_SECTION_LABEL = {
  lower: 'Lower (base) run',
  upper: 'Upper (wall) run',
  tall: 'Tall (full-height) run',
};

const DESIGN_APPLIANCE_PHRASE = {
  sink: 'an undermount sink with a single-lever mixer faucet (matte black or brushed steel) on the countertop behind it — the faucet is mandatory',
  cooktop: 'a flush induction cooktop',
  hood: 'a slim concealed hood',
  fridge: 'a built-in french-door refrigerator, its front flush with the doors',
  dishwasher: 'a fully integrated dishwasher behind a matching front',
};

/** @param {boolean} [withLabel] 플래너의 한국어 라벨을 붙일지 (QC 요약에는 안 붙인다) */
function designModulePhrase(m, withLabel = true) {
  const width = m.widthMm ? `${m.widthMm} mm ` : '';
  let what;
  if (m.kind === 'drawer') {
    const n = m.drawerCount || 0;
    what = n > 1 ? `${n}-drawer stack` : 'single drawer front';
  } else if (m.kind === 'open') {
    what = 'open shelving with no door';
  } else if (m.kind === 'appliance') {
    what = 'appliance opening';
  } else {
    const n = m.doorCount || 1;
    what = n > 1 ? `${n}-door cabinet` : 'single-door cabinet';
  }
  return `${width}${what}${withLabel && m.label ? ` [${m.label}]` : ''}`;
}

function designSectionLine(key, sec) {
  const dims = [];
  if (sec.widthMm) dims.push(`${sec.widthMm} mm wide`);
  if (sec.heightMm) dims.push(`${sec.heightMm} mm high`);
  if (sec.depthMm) dims.push(`${sec.depthMm} mm deep`);
  if (sec.fromLeftMm !== undefined)
    dims.push(`starting ${sec.fromLeftMm} mm from the left end of the run`);
  // map 을 그대로 넘기면 두 번째 인자로 index 가 들어가 첫 모듈의 라벨이 사라진다.
  const mods = (sec.modules || []).map((m) => designModulePhrase(m, true)).join('; ');
  return (
    `- ${DESIGN_SECTION_LABEL[key]}${dims.length ? ` — ${dims.join(', ')}` : ''}.` +
    (mods ? ` Left to right: ${mods}.` : '')
  );
}

function designAppliancePhrase(a) {
  const bits = [];
  if (a.fromLeftMm !== undefined)
    bits.push(`left edge ${a.fromLeftMm} mm from the left end of the run`);
  if (a.widthMm) bits.push(`${a.widthMm} mm wide`);
  return `${DESIGN_APPLIANCE_PHRASE[a.kind]}${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

/**
 * design_spec → FURNITURE 블록 본문. 구간도 가전도 없으면 null (그러면 범용 문단 그대로).
 * @returns {string|null}
 */
export function buildDesignSpecBlock(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const sections = spec.sections && typeof spec.sections === 'object' ? spec.sections : {};
  const lines = DESIGN_SECTIONS.filter((k) => sections[k]).map((k) =>
    designSectionLine(k, sections[k])
  );
  const appliances = (Array.isArray(spec.appliances) ? spec.appliances : []).filter(
    (a) => a && DESIGN_APPLIANCE_PHRASE[a.kind]
  );
  if (!lines.length && !appliances.length) return null;

  const head =
    `this is the customer's own planner drawing, not a generic layout — build exactly this.` +
    (spec.wallRunMm ? ` The whole run is ${spec.wallRunMm} mm wide.` : '');
  const applianceLine = appliances.length
    ? `\nAPPLIANCES: ${appliances.map(designAppliancePhrase).join('; ')}.`
    : '';
  const notes = spec.notes ? `\nPLANNER NOTES: ${spec.notes}` : '';
  // 사진이 진실이다 — 치수가 어긋나면 벽 분석이 이긴다. 순서와 개수만 지킨다.
  const authority =
    `\nThe module order and the door/drawer counts above are binding; the millimetres are guidance. ` +
    `If they disagree with the wall measured in the photo, the photo wins — scale the run to fit the real wall and keep the order and the counts.`;
  return `${head}\n${lines.join('\n')}${applianceLine}${authority}${notes}`;
}

/** QC 프롬프트에 싣는 한 줄 요약. 모델이 눈으로 셀 수 있는 것만 — 구간별 종류·개수·폭. */
export function designSpecDigest(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const sections = spec.sections && typeof spec.sections === 'object' ? spec.sections : {};
  const parts = [];
  for (const key of DESIGN_SECTIONS) {
    const mods = sections[key] && sections[key].modules;
    if (!mods || !mods.length) continue;
    parts.push(`${key} = ${mods.map((m) => designModulePhrase(m, false)).join('; ')}`);
  }
  return parts.length ? parts.join(' | ') : null;
}

/** design_spec.finishes 한 칸 → 영어 한 구절. 이름이 없으면 null. */
function designFinishPhrase(f) {
  if (!f) return null;
  const head = f.nameEn || f.name;
  if (!head) return null;
  const detail = [];
  if (f.nameEn && f.name) detail.push(f.name);
  if (f.vendorCode) detail.push(f.vendorCode);
  if (f.colorHex) detail.push(`colour ${f.colorHex}`);
  const tone = f.tone && !head.toLowerCase().includes(f.tone) ? `${f.tone} ` : '';
  return `${tone}${head}${detail.length ? ` (${detail.join(', ')})` : ''}`;
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
  faucet_missing:
    'Add a single-lever mixer faucet (matte black or brushed steel) on the countertop directly behind the sink basin.',
};

/**
 * 도면 요약(design_spec)이 있을 때만 검사하는 코드.
 * QC_FIXES 에 합치지 않는 이유: 요약이 없으면 검사 프롬프트에 LAYOUT 줄이 없어
 * 모델이 판정할 근거가 없다. 공통 코드 목록(QC_ISSUE_CODES)은 그대로 둔다.
 *
 * 가전 위치(mm)는 넣지 않았다 — 원근이 있는 사진에서 "싱크가 왼쪽에서 1050 mm"
 * 는 모델이 눈으로 셀 수 없다. 셀 수 있는 것은 전면의 개수와 좌→우 순서뿐이다.
 */
export const DESIGN_SPEC_QC_FIXES = {
  layout_mismatch:
    'Rebuild the run to match LAYOUT exactly: the same number of modules in the same left-to-right order, each with the same door and drawer counts. Widths may be scaled to the real wall; the order and the counts may not.',
};

/** 수전 검사가 뜻이 있는 품목 (싱크가 있는 것). */
export const KITCHEN_CATEGORIES = ['sink', 'island'];

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
 * @param {object} [c.designSpec]  normalizeDesignSpec() 의 결과. 있으면 FURNITURE·FINISH 가 도면 요약으로 바뀐다
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
  const fixes = (opts.fix || []).map((k) => QC_FIXES[k] || DESIGN_SPEC_QC_FIXES[k]).filter(Boolean);
  const fixBlock = fixes.length
    ? `\nFIX (the previous attempt failed these checks):\n- ${fixes.join('\n- ')}`
    : '';
  // 도면 요약이 있으면 품목 범용 문단 대신 실제 모듈·치수를, 자재는 실제 제품명을 쓴다.
  // 요약이 없거나 쓸 내용이 없으면 아래 두 줄은 예전과 한 글자도 다르지 않다.
  const spec = c.designSpec || null;
  const specBlock = buildDesignSpecBlock(spec);
  const furniture = `FURNITURE: ${specBlock || cat.spec(c)}`;
  const fin = (spec && spec.finishes) || null;
  const doorPhrase = designFinishPhrase(fin && fin.door) || `${c.doorColor} ${c.doorFinish}`;
  const bodyPhrase = designFinishPhrase(fin && fin.body);
  const topPhrase = designFinishPhrase(fin && fin.top);
  const finish =
    `FINISH: ${doorPhrase} flat-panel fronts, ${style} style, consistent on every panel.` +
    (bodyPhrase ? ` Carcass and visible side panels: ${bodyPhrase}.` : '') +
    (topPhrase ? ` Countertop and worktop surfaces: ${topPhrase}.` : '');
  return `Edit the first photo: install a built-in ${cat.label} (${key}) on the main wall.
Keep the room exactly as photographed: camera angle, walls, ceiling, floor, windows, lighting and everything outside the furniture.${existing}${room}
WALL: about ${c.wallW} x ${c.wallH} mm.
${furniture}
${finish}
HANDLES: none. Every door and drawer is a flat handleless front; lower doors open by reaching behind the door edge. No bar handles, knobs, chrome hardware or push-to-open buttons.${site}${tile}${refs}${fixBlock}
All doors and drawers closed. Photorealistic interior photograph with natural lighting and correct shadows. No text, labels or watermarks.`;
}

// ─── 3. 검사 ───
/** 모든 실행이 받는 공통 코드. */
export const QC_ISSUE_CODES = Object.keys(QC_FIXES);
/** parseQc 가 받아 주는 전체 = 공통 + 도면 요약 전용. */
export const ALL_QC_ISSUE_CODES = [...QC_ISSUE_CODES, ...Object.keys(DESIGN_SPEC_QC_FIXES)];

/** 설치 결과 한 장을 보고 규칙 위반을 JSON 으로 판정한다. 관대하게 — 명백할 때만 실패. */
export function buildQcPrompt(c) {
  const key = resolveCategory(c.category);
  // 도면 요약이 있을 때만 LAYOUT 줄과 layout_mismatch 코드를 붙인다 (근거 없는 판정을 막는다).
  const digest = designSpecDigest(c.designSpec);
  const layoutBlock = digest ? `\nLAYOUT the render must match, left to right — ${digest}` : '';
  const layoutCode = digest
    ? '\n- layout_mismatch: the fronts do not match LAYOUT — a different number of modules, a different left-to-right order, or doors where LAYOUT says a drawer stack (ignore width differences and any module hidden behind an appliance)'
    : '';
  return `You are checking an AI-rendered photo of a built-in ${CATEGORIES[key].label} (${key}) installed in a real room.${layoutBlock}
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
- tile_not_neutral: wall tiles around the furniture are dark, brown, black or strongly coloured (light neutral tiles are fine)${
    KITCHEN_CATEGORIES.includes(key)
      ? '\n- faucet_missing: there is a sink but no faucet/tap behind it'
      : ''
  }${layoutCode}
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
      ? j.issues.map(String).filter((k) => ALL_QC_ISSUE_CODES.includes(k))
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

// ─── 6. 투톤 추천안 (싱크가 있는 품목) — 상부장·하부장 색을 다르게 ───
/** 상·하부 조합. 옛 싱크대 프롬프트의 ALT_TWO_TONES 를 옮겼다. */
export const TWO_TONES = [
  {
    key: 'cream-walnut',
    upper: 'cream white matte',
    lower: 'walnut woodgrain',
    tone: '크림 · 월넛',
  },
  { key: 'black-oak', upper: 'matte black', lower: 'natural oak woodgrain', tone: '블랙 · 오크' },
  {
    key: 'sage-cream',
    upper: 'sage green matte',
    lower: 'cream white matte',
    tone: '세이지 · 크림',
  },
  {
    key: 'navy-beige',
    upper: 'navy blue matte',
    lower: 'warm beige matte',
    tone: '네이비 · 베이지',
  },
  {
    key: 'white-smoked',
    upper: 'warm white matte',
    lower: 'smoked oak woodgrain',
    tone: '화이트 · 스모크오크',
  },
  {
    key: 'terracotta-cream',
    upper: 'terracotta matte',
    lower: 'cream white matte',
    tone: '테라코타 · 크림',
  },
  {
    key: 'grey-walnut',
    upper: 'soft grey matte',
    lower: 'walnut woodgrain',
    tone: '그레이 · 월넛',
  },
  {
    key: 'white-greige',
    upper: 'pure white matte',
    lower: 'greige matte',
    tone: '화이트 · 그레이지',
  },
];

export function pickTwoTone(seed) {
  const s = ((seed >>> 0 || 1) * 1103515245 + 12345) >>> 0;
  return TWO_TONES[s % TWO_TONES.length];
}

export function buildTwoToneVariantPrompt(pair) {
  return `Recolour the kitchen furniture in this photo to a two-tone scheme:
- Upper (wall) cabinets: ${pair.upper}
- Lower (base) cabinets, drawers and any island: ${pair.lower}
Keep everything else identical: camera, room, furniture layout, every door and drawer line, countertop, sink, faucet, cooktop, hood, lighting and shadows. Handleless fronts stay handleless. All doors stay closed.
Photorealistic. No text, labels or watermarks.`;
}

export function buildVariantPrompt(finish) {
  return `Recolour the built-in furniture in this photo to a different finish:
- Door and drawer fronts: ${finish.body}
- Side panels, open shelves and accents: ${finish.accent}
Keep everything else identical: camera, room, furniture layout, every door and drawer line, countertop, lighting and shadows. Handleless fronts stay handleless. All doors stay closed.
Photorealistic. No text, labels or watermarks.`;
}
