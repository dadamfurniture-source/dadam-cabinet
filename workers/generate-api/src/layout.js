/**
 * 연출컷 → 구성 분석 (gen-to-planner, 2026-09-11)
 *
 * 완성된 기본안(base) 한 장을 Claude 비전에 보여 주고 **구성**만 읽는다:
 * 벽 런의 좌→우 세그먼트 순서, 가전 위치(벽 폭 대비 %), 상부장 커버 구간, 도어·서랍 수.
 *
 * mm 는 여기서 읽지 않는다. 렌더는 프롬프트로 그린 그림이라 원근·크롭이 있고,
 * 도어 수도 제조 분할 규칙과 자주 다르다. 그래서 소유권을 고정한다:
 *   - 벽 치수·급수·배기 위치  = wall_analysis (분석 단계가 사진에서 잰 값)
 *   - 가전 폭                 = js/planner/planner-sections.js PLANNER_SECTIONS (APPLIANCE_W 로 옮겨 적음)
 *   - 모듈 분할               = 플래너 엔진 distributeModules (구조 단계 자동계산)
 *   - 구성(순서·종류·%·개수)  = Claude
 * 렌더의 도어 수와 엔진 분할이 다르면 doorCounts/notes 로 알릴 뿐 강제하지 않는다.
 *
 * 세 부분이다.
 *   1. LAYOUT_SCHEMA        Claude 구조화 출력 스키마 (output_config.format)
 *   2. buildLayoutPrompt()  사실 블록 + 과제 + 어휘
 *   3. normalizeLayout()    Claude JSON → generations.layout (연속성·클램프·mm 스냅·가전 좌표)
 *
 * 이 파일은 import 가 없어야 한다 — __tests__/generate-layout.test.js 가 export 만 떼어 평가한다.
 * 결과 형식은 js/detaildesign/gen-import.js (genLayoutToPlanner) 가 읽는다. 바꾸면 같이 고친다.
 */

export const LAYOUT_VERSION = 1;

/** 플래너로 가져올 수 있는 품목. 화장대·신발장·사무실은 플래너 섹션이 없어 뺀다. */
export const LAYOUT_CATEGORIES = ['sink', 'island', 'fridge', 'storage', 'wardrobe'];

/** 싱크·후드가 사실(wall_analysis)로 존재하는 품목. */
export const LAYOUT_KITCHEN = ['sink', 'island'];

/**
 * 가전 폭 — js/planner/planner-sections.js PLANNER_SECTIONS 의 w 를 옮겨 적었다.
 * 워커는 브라우저 파일을 import 할 수 없다. 테스트가 두 값이 같은지 대조한다.
 */
export const APPLIANCE_W = { sink: 700, hood: 300, refrigerator: 720, dishwasher: 600 };

/** 품목별로 바닥에 서는 세그먼트 kind (좌→우 벽 런). 'open' = 가구 없음. */
export const FLOOR_KINDS = {
  sink: ['lower', 'dishwasher', 'refrigerator', 'tall', 'fridge', 'open'],
  island: ['lower', 'dishwasher', 'refrigerator', 'tall', 'fridge', 'open'],
  fridge: ['fridge', 'tall', 'lower', 'open'],
  storage: ['tall', 'lower', 'open'],
  wardrobe: ['wardrobe', 'open'],
};
const ALL_FLOOR_KINDS = [
  'lower',
  'dishwasher',
  'refrigerator',
  'tall',
  'fridge',
  'wardrobe',
  'open',
];
export const UPPER_KINDS = ['upper', 'hood', 'open'];
export const APPLIANCE_KINDS = ['sink', 'cooktop', 'hood', 'dishwasher', 'refrigerator'];

/** 이미지 위치가 조사값과 이보다 멀면 조사값을 쓰되 확신도를 낮춘다 (벽 폭 %). */
export const APPLIANCE_TOLERANCE_PCT = 15;
/** 이보다 좁은 세그먼트는 읽기 오차로 보고 이웃에 흡수한다 (벽 폭 %). */
const MIN_SEGMENT_PCT = 2;
const MAX_NOTES = 10;

// ─── 1. 스키마 ───
const PCT = { type: 'number' };
const COUNT = { type: 'integer' };
const POS = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['center_pct'],
      properties: { center_pct: PCT },
    },
  ],
};

export const LAYOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['segments', 'uppers', 'uppers_status', 'appliances', 'confidence', 'notes'],
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'start_pct', 'end_pct', 'doors', 'drawers'],
        properties: {
          kind: { type: 'string', enum: ALL_FLOOR_KINDS },
          start_pct: PCT,
          end_pct: PCT,
          doors: COUNT,
          drawers: COUNT,
        },
      },
    },
    uppers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'start_pct', 'end_pct', 'doors'],
        properties: {
          kind: { type: 'string', enum: UPPER_KINDS },
          start_pct: PCT,
          end_pct: PCT,
          doors: COUNT,
        },
      },
    },
    uppers_status: { type: 'string', enum: ['clear', 'unclear', 'none'] },
    appliances: {
      type: 'object',
      additionalProperties: false,
      required: APPLIANCE_KINDS,
      properties: { sink: POS, cooktop: POS, hood: POS, dishwasher: POS, refrigerator: POS },
    },
    confidence: {
      type: 'object',
      additionalProperties: false,
      required: ['segments', 'uppers', 'appliances'],
      properties: { segments: PCT, uppers: PCT, appliances: PCT },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

// ─── 2. 프롬프트 ───
const LABELS = {
  sink: 'straight kitchen run',
  island: 'kitchen wall run (the freestanding island is NOT part of this reading)',
  fridge: 'refrigerator surround with pantry columns',
  storage: 'floor-to-ceiling storage wall',
  wardrobe: 'floor-to-ceiling wardrobe',
};

/**
 * @param {object} c
 * @param {string} c.category        LAYOUT_CATEGORIES 의 하나
 * @param {object} [c.wallAnalysis]  generations.wall_analysis {wallW, wallH, waterPct, exhaustPct}
 * @param {object} [c.options]       generations.options {fridge_options:{position}}
 */
export function buildLayoutPrompt(c) {
  const category = LAYOUT_CATEGORIES.includes(c.category) ? c.category : 'storage';
  const wa = c.wallAnalysis || {};
  const W = wallW(wa.wallW);
  const H = wallH(wa.wallH);
  const facts = [
    `- The furniture stands on ONE wall that is ${W} mm wide and ${H} mm high. The wall's left edge is 0 % and its right edge is 100 %.`,
  ];
  if (LAYOUT_KITCHEN.includes(category)) {
    facts.push(
      `- The water supply (sink) is at ${pct(wa.waterPct, 30)} % from the left and the exhaust (cooktop with hood above) is at ${pct(wa.exhaustPct, 70)} %.`
    );
  }
  if (category === 'fridge') {
    facts.push(`- The refrigerator sits on the ${fridgePosition(c.options)} side of the wall.`);
  }
  if (category === 'island') {
    facts.push(
      '- Read only the units against the wall. Ignore the freestanding island in front of it.'
    );
  }
  return `You are reading an AI-rendered photo of a built-in ${LABELS[category]} (${category}) installed in a real room.
FACTS measured before rendering. Never contradict them:
${facts.join('\n')}

TASK: describe only the COMPOSITION of the furniture along that wall. Do not estimate millimetres — every position is a percentage of the WALL width (not of the image).
1. segments: floor-standing units from left to right, contiguous from 0 to 100. Allowed kinds: ${FLOOR_KINDS[category].join(', ')}. "open" means no furniture there (a gap or a free-standing appliance). For each give start_pct, end_pct, doors (hinged door fronts) and drawers (drawer fronts).
2. uppers: wall-hung units from left to right with start_pct and end_pct. Allowed kinds: upper, hood, open. uppers_status is "clear" when you can see their edges, "unclear" when wall-hung units exist but their edges are ambiguous, "none" when there are no wall-hung units.
3. appliances: the centre position (center_pct) of each visible appliance — sink, cooktop, hood, dishwasher, refrigerator. Use null when it is not visible.
4. confidence: 0 to 1 for segments, uppers and appliances. notes: at most 5 short sentences about anything ambiguous.`;
}

// ─── 3. 정규화 ───
/**
 * Claude JSON → generations.layout.
 * @param {object} raw  Claude 가 낸 JSON (LAYOUT_SCHEMA 형식). 깨진 입력에도 던지지 않는다.
 * @param {object} ctx
 * @param {string}  ctx.category
 * @param {object}  [ctx.wallAnalysis]
 * @param {object}  [ctx.options]
 * @param {object}  [ctx.sections]   가전 폭 덮어쓰기 (기본 APPLIANCE_W)
 * @param {string}  [ctx.slot]       분석한 이미지 슬롯 (기본 'base')
 * @param {string}  [ctx.model]
 * @param {string}  [ctx.now]        ISO 시각
 */
export function normalizeLayout(raw, ctx) {
  const category = LAYOUT_CATEGORIES.includes(ctx.category) ? ctx.category : 'storage';
  const wa = ctx.wallAnalysis || {};
  const W = wallW(wa.wallW);
  const H = wallH(wa.wallH);
  const aw = Object.assign({}, APPLIANCE_W, ctx.sections || {});
  const r = raw && typeof raw === 'object' ? raw : {};
  const notes = [];
  const conf = {
    segments: unit(r.confidence && r.confidence.segments, 0.5),
    uppers: unit(r.confidence && r.confidence.uppers, 0.5),
    appliances: unit(r.confidence && r.confidence.appliances, 0.5),
  };
  const kitchen = LAYOUT_KITCHEN.includes(category);

  // 3-1. 세그먼트 — 허용 kind 만, 정렬, 연속 강제, 좁은 조각 흡수
  const allowed = FLOOR_KINDS[category];
  let segs = list(r.segments)
    .map((s) => ({
      kind: String((s && s.kind) || ''),
      startPct: num(s && s.start_pct),
      endPct: num(s && s.end_pct),
      doors: count(s && s.doors),
      drawers: count(s && s.drawers),
    }))
    .filter((s) => {
      if (!allowed.includes(s.kind)) {
        if (s.kind) notes.push(`segment kind "${s.kind}" is not valid for ${category}; dropped`);
        return false;
      }
      return Number.isFinite(s.startPct) && Number.isFinite(s.endPct) && s.endPct > s.startPct;
    })
    .map((s) => Object.assign(s, { startPct: clampPct(s.startPct), endPct: clampPct(s.endPct) }))
    .sort((a, b) => a.startPct - b.startPct);

  if (category === 'wardrobe') {
    // 붙박이장은 벽 전체가 한 영역이다 — 도어 수만 합쳐 남긴다
    const doors = segs.reduce((s, x) => s + (x.kind === 'wardrobe' ? x.doors : 0), 0);
    segs = [{ kind: 'wardrobe', startPct: 0, endPct: 100, doors, drawers: 0 }];
  }
  if (!segs.length) {
    segs = defaultSegments(category, W, aw, ctx.options);
    notes.push('no usable segments were read from the image; default composition used');
    conf.segments = Math.min(conf.segments, 0.2);
  }
  segs = makeContiguous(segs);
  if (category === 'fridge' && !segs.some((s) => s.kind === 'fridge')) {
    segs = insertFridge(segs, W, aw, ctx.options);
    notes.push('no refrigerator niche was read; one was placed on the surveyed side');
    conf.segments = Math.min(conf.segments, 0.5);
  }
  segs = toMm(segs, W);

  // 3-2. 상부장 — 'upper' 구간만. 불명확하거나 비면 품목 기본으로 채운다
  let uppers = [];
  const status = ['clear', 'unclear', 'none'].includes(r.uppers_status)
    ? r.uppers_status
    : 'unclear';
  if (category !== 'wardrobe' && status !== 'none') {
    uppers = list(r.uppers)
      .filter((u) => u && u.kind === 'upper')
      .map((u) => ({
        kind: 'upper',
        startPct: clampPct(num(u.start_pct)),
        endPct: clampPct(num(u.end_pct)),
        doors: count(u.doors),
      }))
      .filter(
        (u) =>
          Number.isFinite(u.startPct) &&
          Number.isFinite(u.endPct) &&
          u.endPct - u.startPct >= MIN_SEGMENT_PCT
      )
      .sort((a, b) => a.startPct - b.startPct);
    uppers = mergeOverlaps(uppers);
    if (status === 'unclear' || !uppers.length) {
      const d = defaultUppers(category, segs);
      if (d.length) {
        uppers = d;
        notes.push(
          status === 'unclear'
            ? 'upper cabinet edges were unclear; default coverage used'
            : 'no upper cabinets were read; default coverage used'
        );
        conf.uppers = Math.min(conf.uppers, 0.4);
      }
    }
  }
  uppers = toMm(uppers, W, false);

  // 3-3. 가전 — 싱크·후드는 조사값이 사실, 나머지는 이미지 또는 세그먼트
  const ra = r.appliances && typeof r.appliances === 'object' ? r.appliances : {};
  const seen = (k) =>
    ra[k] && Number.isFinite(num(ra[k].center_pct)) ? clampPct(num(ra[k].center_pct)) : null;
  const appliances = {
    sink: null,
    cooktop: null,
    hood: null,
    dishwasher: null,
    refrigerator: null,
  };
  if (kitchen) {
    const water = pct(wa.waterPct, 30);
    const exhaust = pct(wa.exhaustPct, 70);
    appliances.sink = place('sink', water, W, aw, 'waterPct');
    appliances.cooktop = { centerPct: exhaust, source: 'exhaustPct' };
    appliances.hood = place('hood', exhaust, W, aw, 'exhaustPct');
    [
      ['sink', water, 'water supply'],
      ['cooktop', exhaust, 'exhaust'],
      ['hood', exhaust, 'exhaust'],
    ].forEach(([k, fact, label]) => {
      const img = seen(k);
      if (img !== null && Math.abs(img - fact) > APPLIANCE_TOLERANCE_PCT) {
        notes.push(
          `${k} read at ${img} % differs from the surveyed ${label} at ${fact} %; surveyed value used`
        );
        conf.appliances = Math.min(conf.appliances, 0.5);
      }
    });
    const dw = seen('dishwasher');
    const dwSeg = segs.find((s) => s.kind === 'dishwasher');
    if (dw !== null) appliances.dishwasher = place('dishwasher', dw, W, aw, 'image');
    else if (dwSeg) appliances.dishwasher = place('dishwasher', mid(dwSeg), W, aw, 'segment');
  }
  const fridgeSeg =
    segs.find((s) => s.kind === 'fridge') || segs.find((s) => s.kind === 'refrigerator');
  const rf = seen('refrigerator');
  if (fridgeSeg) appliances.refrigerator = place('refrigerator', mid(fridgeSeg), W, aw, 'segment');
  else if (rf !== null && category !== 'wardrobe')
    appliances.refrigerator = place('refrigerator', rf, W, aw, 'image');
  // 겹치는 가전은 조사값을 우선한다 (싱크·후드는 이미 사실이므로 그 외를 뺀다)
  ['dishwasher', 'refrigerator'].forEach((k) => {
    const a = appliances[k];
    if (!a) return;
    const hit = ['sink'].map((s) => appliances[s]).find((s) => s && overlaps(s, a));
    if (hit) {
      appliances[k] = null;
      notes.push(`${k} overlapped the sink position; dropped`);
    }
  });

  // 3-4. 개수·확신도
  const doorCounts = { lower: 0, upper: 0, tall: 0, fridge: 0, wardrobe: 0 };
  let drawerCount = 0;
  segs.forEach((s) => {
    if (s.kind in doorCounts) doorCounts[s.kind] += s.doors;
    drawerCount += s.drawers;
  });
  uppers.forEach((u) => {
    doorCounts.upper += u.doors;
  });
  list(r.notes)
    .filter((n) => typeof n === 'string' && n.trim())
    .slice(0, 5)
    .forEach((n) => notes.push('model: ' + n.trim().slice(0, 200)));
  const overall = Math.min(conf.segments, conf.uppers, conf.appliances);

  return {
    version: LAYOUT_VERSION,
    category,
    sourceSlot: ctx.slot || 'base',
    model: ctx.model || null,
    created_at: ctx.now || new Date().toISOString(),
    wall: { W, H },
    segments: segs,
    uppers,
    appliances,
    doorCounts,
    drawerCount,
    confidence: Object.assign({ overall: round2(overall) }, mapValues(conf, round2)),
    notes: notes.slice(0, MAX_NOTES),
    raw: r,
  };
}

// ─── 내부 ───
function wallW(v) {
  const n = Number(v);
  return n > 0 ? Math.max(1000, Math.min(6000, Math.round(n))) : 3000; // prompts.js clampWall 과 같은 범위
}
function wallH(v) {
  const n = Number(v);
  return n > 0 ? Math.max(2000, Math.min(3000, Math.round(n))) : 2400;
}
function pct(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.max(5, Math.min(95, Math.round(n))) : d;
}
function fridgePosition(options) {
  const fo = options && options.fridge_options;
  return fo && fo.position === 'right' ? 'right' : 'left';
}
function list(v) {
  return Array.isArray(v) ? v : [];
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function count(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function unit(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d;
}
function clampPct(v) {
  return Math.max(0, Math.min(100, v));
}
function round2(v) {
  return Math.round(v * 100) / 100;
}
function round10(v) {
  return Math.round(v / 10) * 10;
}
function mid(s) {
  return (s.startPct + s.endPct) / 2;
}
function mapValues(o, f) {
  const out = {};
  Object.keys(o).forEach((k) => {
    out[k] = f(o[k]);
  });
  return out;
}
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w;
}

/** 좌→우 연속으로 만든다: 첫 0, 끝 100, 사이 경계는 두 값의 중간. 좁은 조각은 앞 조각에 흡수. */
function makeContiguous(segs) {
  const out = [];
  segs.forEach((s) => {
    const prev = out[out.length - 1];
    const cur = Object.assign({}, s);
    if (!prev) cur.startPct = 0;
    else {
      const b = (prev.endPct + cur.startPct) / 2;
      prev.endPct = b;
      cur.startPct = b;
    }
    out.push(cur);
  });
  if (out.length) out[out.length - 1].endPct = 100;
  // 좁은 조각 흡수 — 앞 조각이 있으면 앞으로, 없으면 뒤로
  for (let i = out.length - 1; i >= 0 && out.length > 1; i--) {
    const s = out[i];
    if (s.endPct - s.startPct >= MIN_SEGMENT_PCT) continue;
    if (i > 0) {
      out[i - 1].endPct = s.endPct;
      out[i - 1].doors += s.doors;
      out[i - 1].drawers += s.drawers;
    } else {
      out[1].startPct = s.startPct;
    }
    out.splice(i, 1);
  }
  return out;
}

function mergeOverlaps(spans) {
  const out = [];
  spans.forEach((u) => {
    const prev = out[out.length - 1];
    if (prev && u.startPct <= prev.endPct) {
      prev.endPct = Math.max(prev.endPct, u.endPct);
      prev.doors += u.doors;
    } else out.push(Object.assign({}, u));
  });
  return out;
}

/** % → mm. 경계를 10 단위로 스냅하고, 연속 목록이면 마지막이 잔여를 흡수해 합이 W 가 된다. */
function toMm(segs, W, contiguous = true) {
  const out = segs.map((s) => Object.assign({}, s));
  out.forEach((s, i) => {
    const x0 = i === 0 && contiguous ? 0 : round10((s.startPct / 100) * W);
    const x1 = i === out.length - 1 && contiguous ? W : round10((s.endPct / 100) * W);
    s.x = Math.max(0, Math.min(W, x0));
    s.w = Math.max(0, Math.min(W, x1) - s.x);
  });
  if (contiguous) {
    for (let i = 1; i < out.length; i++) {
      out[i].x = out[i - 1].x + out[i - 1].w;
      const end = i === out.length - 1 ? W : round10((out[i].endPct / 100) * W);
      out[i].w = Math.max(0, end - out[i].x);
    }
  }
  return out;
}

function defaultSegments(category, W, aw, options) {
  const one = (kind) => [{ kind, startPct: 0, endPct: 100, doors: 0, drawers: 0 }];
  if (category === 'fridge') return insertFridge(one('tall'), W, aw, options);
  if (category === 'storage') return one('tall');
  if (category === 'wardrobe') return one('wardrobe');
  return one('lower');
}

/** 냉장고 니치를 조사된 쪽 끝에 끼운다. 폭은 냉장고 폭(가전 정본). */
function insertFridge(segs, W, aw, options) {
  const span = Math.min(60, (aw.refrigerator / W) * 100);
  const right = fridgePosition(options) === 'right';
  const fridge = right
    ? { kind: 'fridge', startPct: 100 - span, endPct: 100, doors: 0, drawers: 0 }
    : { kind: 'fridge', startPct: 0, endPct: span, doors: 0, drawers: 0 };
  const rest = segs
    .map((s) => {
      const c = Object.assign({}, s);
      if (right) c.endPct = Math.min(c.endPct, fridge.startPct);
      else c.startPct = Math.max(c.startPct, fridge.endPct);
      return c;
    })
    .filter((s) => s.endPct - s.startPct >= MIN_SEGMENT_PCT);
  return makeContiguous(right ? rest.concat([fridge]) : [fridge].concat(rest));
}

/** 상부장 기본 커버: 주방은 하부 런 전체, 냉장고장은 니치 위 브릿지, 수납장은 없음. */
function defaultUppers(category, segs) {
  if (category === 'fridge') {
    const f = segs.find((s) => s.kind === 'fridge');
    return f ? [{ kind: 'upper', startPct: f.startPct, endPct: f.endPct, doors: 0 }] : [];
  }
  if (!LAYOUT_KITCHEN.includes(category)) return [];
  const run = segs.filter((s) => s.kind === 'lower' || s.kind === 'dishwasher');
  if (!run.length) return [];
  return [
    { kind: 'upper', startPct: run[0].startPct, endPct: run[run.length - 1].endPct, doors: 0 },
  ];
}

/** 가전 하나를 중심 % 에 놓는다. 폭은 정본, x 는 벽 안으로 클램프. */
function place(kind, centerPct, W, aw, source) {
  const w = aw[kind];
  const x = Math.max(0, Math.min(W - w, Math.round((centerPct / 100) * W - w / 2)));
  return { centerPct: Math.round(centerPct * 10) / 10, x, w, source };
}
