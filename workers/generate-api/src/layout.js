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
 *   4. 플래너 모드 (2026-10-19) PLANNER_READ_SCHEMA · buildPlannerReadPrompt() · normalizePlannerRead()
 *      — 사진 + 정면 입면 + 도면 목록을 주고 모듈(L1·U1…)마다 센다. 같은 layout 모양으로 낸다.
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

// ─── 4. 플래너 모드 역판독 (2026-10-19) ───
// 플래너 모드는 도면(design_spec)이 정본이고 모듈마다 번호(L1·U1·T1·W1)가 있다 — 설치 프롬프트(prompts.js plannerRows)와
// 번호 입면(render-elevation_labeled)이 같은 규칙이다. 그래서 결과 사진만 보여 주고 "벽 전체 도어 수" 를 묻지 않는다:
// 사진 + 정면 입면(번호 있는 것이 있으면 그것) + 도면 목록(줄·번호·폭·도어/서랍 수)을 주고, 모듈마다 사진에 보이는
// 도어·서랍 수를 세게 한다. 실측 16장 중 3장에서 하부 5짝을 4짝·6짝으로 읽은 것(사람이 세면 5짝)을 막으려는 것이다.
// 결과는 normalizeLayout 과 같은 모양(segments·uppers·appliances·doorCounts …)으로 만들어 verify.js 가 그대로 받는다.
// 덤으로 units(모듈별 판독)·extraUnits(도면 밖 유닛)·shape(배치 모양)를 더 싣는다.
// 일반 연출컷·/layout 라우트는 위 1~3 을 그대로 쓴다.

export const PLANNER_READ_VERSION = 1;
/**
 * 모듈 한 칸이 사진에서 무엇으로 보였나. missing = 그 자리에 유닛이 없다.
 * 2026-10-19: hood = 장 없이 후드만 걸린 틈 (후드 칸 H1 … — prompts.js isHoodCell).
 */
export const PLANNER_READ_SEEN = ['cabinet', 'refrigerator', 'dishwasher', 'open', 'hood', 'missing'];
export const PLANNER_READ_SHAPES = ['straight', 'corner', 'u', 'unclear'];
const PLANNER_READ_ROWS = ['base', 'wall', 'tall', 'wardrobe'];
/** design_spec 구간 → 판독 줄 이름·번호 머리. prompts.js PLANNER_ROWS 와 같은 머리 글자. */
const PLANNER_READ_SECTION = {
  lower: { row: 'base', prefix: 'L', title: 'BASE ROW' },
  upper: { row: 'wall', prefix: 'U', title: 'WALL ROW' },
  tall: { row: 'tall', prefix: 'T', title: 'TALL ROW' },
};
const PLANNER_READ_WARDROBE = { row: 'wardrobe', prefix: 'W', title: 'WARDROBE ROW' };
const PLANNER_READ_SUBJECT = {
  sink: 'kitchen',
  island: 'kitchen',
  fridge: 'refrigerator surround',
  storage: 'storage wall',
  wardrobe: 'wardrobe',
  // 2026-10-19: 역판독 품목(LAYOUT_CATEGORIES) 밖 — 플래너 판독은 도면 목록으로 세므로 품목을 가리지 않는다.
  //   이름은 prompts.js CATEGORIES[key].spec 첫머리와 같다.
  vanity: 'dressing table',
  shoe: 'shoe cabinet',
  office: 'home office wall',
  study: 'study wall',
  bedroom: 'bedroom built-in wall',
};
/**
 * 플래너 판독을 돌리는 품목 (2026-10-19) — prompts.js CATEGORIES 의 모든 키.
 *   옛 판독(LAYOUT_CATEGORIES)은 품목별 세그먼트 종류가 있어야 하지만, 플래너 판독은 도면 목록(L1·U1…)을 센다.
 *   붙박이장만 한 줄(W)로 잇고, 나머지는 구간(하부·상부·키큰장)대로 줄을 만든다.
 */
export const PLANNER_READ_CATEGORIES = Object.keys(PLANNER_READ_SUBJECT);
/** 모르는 품목은 storage 로 (prompts.js resolveCategory 와 같은 폴백). */
function plannerReadCategory(key) {
  return PLANNER_READ_CATEGORIES.includes(key) ? key : 'storage';
}
const PLANNER_READ_ATTACH = {
  sink: 'sink on the countertop',
  cooktop: 'cooktop on the countertop',
  hood: 'hood under it',
  dishwasher: 'integrated dishwasher',
  fridge: 'refrigerator',
};
/** 가전이 걸리는 구간 — prompts.js PLANNER_APPLIANCE_ROWS 와 같다. */
const PLANNER_READ_APPLIANCE_ROWS = {
  sink: ['lower'],
  cooktop: ['lower'],
  dishwasher: ['lower'],
  hood: ['upper'],
  fridge: ['tall', 'lower'],
  refrigerator: ['tall', 'lower'],
};

const READ_COUNT = { type: 'integer' };
export const PLANNER_READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows', 'extra_units', 'layout_shape', 'confidence', 'notes'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['row', 'units'],
        properties: {
          row: { type: 'string', enum: PLANNER_READ_ROWS },
          units: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'seen', 'doors', 'drawers'],
              properties: {
                id: { type: 'string' },
                seen: { type: 'string', enum: PLANNER_READ_SEEN },
                doors: READ_COUNT,
                drawers: READ_COUNT,
              },
            },
          },
        },
      },
    },
    extra_units: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['row', 'where', 'doors', 'drawers'],
        properties: {
          row: { type: 'string', enum: PLANNER_READ_ROWS.concat(['other']) },
          where: { type: 'string' },
          doors: READ_COUNT,
          drawers: READ_COUNT,
        },
      },
    },
    layout_shape: { type: 'string', enum: PLANNER_READ_SHAPES },
    confidence: { type: 'number' },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

/** 모듈 한 칸의 유효 도어·서랍 수 — prompts.js plannerCounts 와 같은 규칙 (생성 모델이 받은 수). */
function plannerReadCounts(m) {
  if (m.kind === 'open' || m.kind === 'appliance') return { doors: 0, drawers: 0 };
  // 2026-10-19: 쌓인 단(tiers) 한 통 — 단의 합 (가전 자리 단은 0). prompts.js plannerCounts 와 같다.
  if (Array.isArray(m.tiers) && m.tiers.length) {
    return m.tiers.reduce((acc, t) => {
      const c = t && typeof t === 'object' ? plannerReadCounts(t) : { doors: 0, drawers: 0 };
      return { doors: acc.doors + c.doors, drawers: acc.drawers + c.drawers };
    }, { doors: 0, drawers: 0 });
  }
  if (m.kind === 'drawer') return { doors: m.doorCount || 0, drawers: m.drawerCount || 1 };
  return { doors: m.doorCount || 1, drawers: m.drawerCount || 0 };
}

/** 가전 모듈 라벨 → 사진에서 보일 것. verify.js applianceKindOfModule 과 같은 규칙. */
function plannerReadApplianceSeen(m) {
  const label = String((m && m.label) || '').toLowerCase();
  if (/냉장|fridge|refrig/.test(label)) return 'refrigerator';
  if (/식기|dish/.test(label)) return 'dishwasher';
  // 2026-10-19: 후드 칸 — 장 없이 후드가 걸린 틈
  if (/후드|hood/.test(label)) return 'hood';
  return 'open';
}

/** 2026-10-19: 꺾인 벽 목록 (design_spec.walls[] — prompts.js plannerWalls 와 같은 거르기). */
function plannerReadWalls(s) {
  return s && Array.isArray(s.walls)
    ? s.walls.filter((w) => w && w.sections && typeof w.sections === 'object' && (w.side === 'left' || w.side === 'right'))
    : [];
}

/** 2026-10-19: 후드 칸인가 — prompts.js isHoodCell 과 같은 규칙 (가전 칸 · 쌓인 단 없음 · 라벨 후드/hood). */
function plannerReadIsHoodCell(m) {
  return !!m && m.kind === 'appliance' && !(Array.isArray(m.tiers) && m.tiers.length) && /후드|hood/.test(String(m.label || '').toLowerCase());
}

/**
 * design_spec → 판독 계획: 줄마다 번호 매긴 모듈과 도면이 요구한 것.
 * 번호는 prompts.js plannerRows 와 같다 — 줄 안 왼쪽부터 1, 붙박이장은 구간을 왼쪽 끝 순서로 이어 한 줄(W).
 * @returns {{rows:{row:string, section:string, title:string, prefix:string, units:object[]}[],
 *            runMm:number|null, shape:'straight'|'corner'|'u'|null}}
 */
export function plannerReadPlan(spec, category) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const sections = s.sections && typeof s.sections === 'object' ? s.sections : {};
  const keys = ['lower', 'upper', 'tall'].filter(
    (k) => sections[k] && Array.isArray(sections[k].modules) && sections[k].modules.length
  );
  const placed = (key, sec) => {
    let x = Number(sec.fromLeftMm) || 0;
    return sec.modules.map((m) => {
      const start = x;
      x += Number(m.widthMm) || 0;
      return { m, section: key, startMm: start, endMm: x };
    });
  };
  let rows;
  if (category === 'wardrobe') {
    const ordered = keys
      .slice()
      .sort((a, b) => (sections[a].fromLeftMm || 0) - (sections[b].fromLeftMm || 0));
    rows = ordered.length
      ? [
          Object.assign({ section: 'wardrobe' }, PLANNER_READ_WARDROBE, {
            items: ordered.flatMap((k) => placed(k, sections[k])),
          }),
        ]
      : [];
  } else {
    rows = keys.map((k) =>
      Object.assign({ section: k }, PLANNER_READ_SECTION[k], { items: placed(k, sections[k]) })
    );
    // 2026-10-19: 꺾인 벽 (design_spec.walls[], ㄱ자·ㄷ자) — 주벽 줄 뒤에, 자리는 모서리에서 잰 fromCornerMm (prompts.js plannerRows 와 같다)
    plannerReadWalls(s).forEach((w) => {
      ['lower', 'upper', 'tall']
        .filter((k) => w.sections[k] && Array.isArray(w.sections[k].modules) && w.sections[k].modules.length)
        .forEach((k) => {
          const sec = w.sections[k];
          rows.push(
            Object.assign({ section: k, wall: w.side }, PLANNER_READ_SECTION[k], {
              title: `${PLANNER_READ_SECTION[k].title} — ${w.side.toUpperCase()} WALL, the return (from the corner outward)`,
              items: placed(k, Object.assign({}, sec, { fromLeftMm: sec.fromCornerMm })),
            })
          );
        });
    });
  }
  let runMm = Number(s.wallRunMm) > 0 ? Number(s.wallRunMm) : null;
  if (!runMm) {
    const ends = rows.flatMap((r) => r.items.map((it) => it.endMm));
    runMm = ends.length && Math.max(...ends) > 0 ? Math.max(...ends) : null;
  }
  // 2026-10-19: 번호 — 후드 칸은 줄 머리 대신 H1·H2 (줄 순서대로 이어서). prompts.js plannerRows 와 같다.
  //   꺾인 벽의 줄은 같은 머리 글자로 주벽에 이어서 센다 (L1–L4 → L5 …).
  let hoods = 0;
  const counters = {};
  const out = rows.map((r) => {
    return Object.assign({
    row: r.row,
    section: r.section,
    title: r.title,
    prefix: r.prefix,
    units: r.items.map((it) => {
      const c = plannerReadCounts(it.m);
      const seen = it.m.kind === 'appliance' ? plannerReadApplianceSeen(it.m) : it.m.kind === 'open' ? 'open' : 'cabinet';
      const unit = {
        id: plannerReadIsHoodCell(it.m) ? `H${++hoods}` : `${r.prefix}${(counters[r.prefix] = (counters[r.prefix] || 0) + 1)}`,
        section: it.section,
        widthMm: Number(it.m.widthMm) || null,
        startMm: it.startMm,
        endMm: it.endMm,
        seen,
        doors: c.doors,
        drawers: c.drawers,
        attached: [],
      };
      // 2026-10-19: 쌓인 단 한 통 — 목록 줄이 통으로 말하게 (tiers 가 없으면 키도 없다)
      if (Array.isArray(it.m.tiers) && it.m.tiers.length) {
        const tiers = it.m.tiers.filter((t) => t && typeof t === 'object');
        if (tiers[0] && tiers[0].kind === 'appliance') {
          const above = tiers.slice(1).reduce((n, t) => n + plannerReadCounts(t).doors + plannerReadCounts(t).drawers, 0);
          if (above) unit.above = above;
        } else if (tiers.length > 1) {
          unit.stack = tiers.length;
        }
      }
      return unit;
    }),
    }, r.wall ? { wall: r.wall } : {});
  });
  // 가전 → 그 자리에 걸린 모듈 (중심이 모듈 [start,end) 안)
  // 2026-10-19: 최상위 appliances[] 는 주벽 줄, 꺾인 벽의 appliances[](fromCornerMm)는 그 벽 줄에만
  const attach = (a, wall, pos) => {
    const kind = a && String(a.kind || '').toLowerCase();
    const where = PLANNER_READ_APPLIANCE_ROWS[kind];
    if (!where || a[pos] === undefined) return;
    const center = Number(a[pos]) + (Number(a.widthMm) || 0) / 2;
    for (const sec of where) {
      for (const row of out) {
        if ((row.wall || null) !== wall) continue;
        const hit = row.units.find(
          (u) => u.section === sec && u.endMm > u.startMm && center >= u.startMm && center < u.endMm
        );
        if (hit) {
          const k = kind === 'refrigerator' ? 'fridge' : kind;
          if (!hit.attached.includes(k)) hit.attached.push(k);
          return;
        }
      }
    }
  };
  (Array.isArray(s.appliances) ? s.appliances : []).forEach((a) => attach(a, null, 'fromLeftMm'));
  if (category !== 'wardrobe') {
    plannerReadWalls(s).forEach((w) => (Array.isArray(w.appliances) ? w.appliances : []).forEach((a) => attach(a, w.side, 'fromCornerMm')));
  }
  // 2026-10-19: 후드 칸 밑 쿡탑 — 도면에 cooktop 이 없을 때 생성 프롬프트가 후드 칸 아래 하부장에 둔다 (prompts.js plannerImpliedCooktops)
  if (!(Array.isArray(s.appliances) && s.appliances.some((a) => a && String(a.kind || '').toLowerCase() === 'cooktop'))) {
    const used = new Set();
    out.forEach((r) =>
      r.units
        .filter((u) => u.seen === 'hood')
        .forEach((h) => {
          const bases = out.filter((x) => x.section === 'lower' && (x.wall || null) === (r.wall || null)).flatMap((x) => x.units);
          const center = (h.startMm + h.endMm) / 2;
          const b = bases.find((u) => u.endMm > u.startMm && center >= u.startMm && center < u.endMm);
          if (!b || (b.seen !== 'cabinet' && b.seen !== 'open') || used.has(b) || b.attached.includes('sink') || b.attached.includes('cooktop')) return;
          used.add(b);
          b.attached.push('cooktop');
        })
    );
  }
  const l = s.layout && typeof s.layout === 'object' ? s.layout : null;
  let shape = l && ['straight', 'corner', 'u'].includes(l.shape) ? l.shape : null;
  if (!shape) {
    const notes = String(s.notes || '');
    if (/ㄷ자|U-shaped/i.test(notes)) shape = 'u';
    else if (/ㄱ자|L-shaped/i.test(notes)) shape = 'corner';
  }
  return { rows: out, runMm, shape };
}

/** 도면 목록 한 줄 — "L1   800 mm  2 doors, sink on the countertop" */
function plannerReadLine(u) {
  const bits = [];
  if (u.seen === 'refrigerator' && u.above) {
    // 2026-10-19: 냉장고장 — 냉장고 자리 + 위 장. 비어 있어도 냉장고 자리다 (생성 프롬프트가 비워 두게 했다).
    bits.push(
      `refrigerator opening (a refrigerator or an empty space for one — report it as refrigerator either way; ` +
        `the cabinet with ${u.above === 1 ? '1 front' : `${u.above} fronts`} above it belongs to ${u.id}, not an extra unit)`
    );
  } else if (u.seen === 'refrigerator') bits.push('refrigerator opening (fridge front, no cabinet doors)');
  else if (u.seen === 'dishwasher') bits.push('integrated dishwasher (one panel, not a door)');
  // 2026-10-19: 후드 칸 — 장이 아니라 후드가 걸린 틈
  else if (u.seen === 'hood') bits.push('range hood in a gap between the wall units, no cabinet (seen = hood when only a hood hangs there; cabinet when a cabinet was built in the gap)');
  else if (u.seen === 'open') bits.push('open, no doors');
  else {
    if (u.doors) bits.push(u.doors === 1 ? '1 door' : `${u.doors} doors`);
    if (u.drawers) bits.push(u.drawers === 1 ? '1 drawer' : `${u.drawers} drawers`);
    if (!bits.length) bits.push('no fronts');
    // 2026-10-19: 쌓인 단 한 통 — 세로로 쌓인 앞판을 한 유닛으로 센다
    if (u.stack) bits[bits.length - 1] += ` (one column of ${u.stack} stacked sections)`;
  }
  u.attached
    .filter(
      (k) =>
        !(k === 'fridge' && u.seen === 'refrigerator') &&
        !(k === 'dishwasher' && u.seen === 'dishwasher') &&
        !(k === 'hood' && u.seen === 'hood')
    )
    .forEach((k) => bits.push(PLANNER_READ_ATTACH[k]));
  const size = u.widthMm ? `${String(u.widthMm).padStart(4)} mm` : '';
  return `${u.id.padEnd(3)} ${size}`.trimEnd().padEnd(11) + '  ' + bits.join(', ');
}

/**
 * 플래너 모드 역판독 프롬프트. 이미지 순서는 [결과 사진, 정면 입면?].
 * @param {object} c
 * @param {string} c.category
 * @param {object} c.designSpec
 * @param {'labeled'|'plain'|null} [c.elevation]  IMAGE 2 가 번호 입면 · 번호 없는 입면 · 없음
 */
export function buildPlannerReadPrompt(c) {
  const category = plannerReadCategory(c.category);
  const plan = plannerReadPlan(c.designSpec, category);
  const el = c.elevation === 'labeled' || c.elevation === 'plain' ? c.elevation : null;
  const images = [
    `IMAGE 1 — RESULT PHOTO: an AI-generated photo of a built-in ${PLANNER_READ_SUBJECT[category]} installed in a real room. This is the image you count.`,
  ];
  if (el === 'labeled') {
    images.push(
      'IMAGE 2 — FRONT ELEVATION of the plan the photo was generated from, seen straight on, with each unit labelled by its ID (L1, U1 …) and dimension lines. Use it only to tell which unit is which.'
    );
  } else if (el === 'plain') {
    images.push(
      'IMAGE 2 — FRONT ELEVATION of the plan the photo was generated from, seen straight on. It has no labels: the IDs below run left to right inside each row. Use it only to tell which unit is which.'
    );
  }
  // 2026-10-19: 꺾인 벽 입면 (ㄱ자·ㄷ자) — 함께 보일 때만. 주벽 입면 뒤 번호로.
  const wallSides = plannerReadWalls(c.designSpec).map((w) => w.side);
  const rets = (Array.isArray(c.returnElevations) ? c.returnElevations : []).filter((r) => r && wallSides.includes(r.side));
  rets.forEach((r, i) => {
    images.push(
      `IMAGE ${images.length + 1} — FRONT ELEVATION of the ${r.side.toUpperCase()} wall return of the same plan, seen straight on${r.labeled ? ', with its unit IDs' : ''}. Use it only to tell which unit is which.`
    );
  });
  // 2026-10-19: 후드 칸이 있을 때만 seen 에 hood 를 말한다 — 없으면 예전 문장 그대로
  const hasHood = plan.rows.some((r) => r.units.some((u) => u.seen === 'hood'));
  const list = [];
  plan.rows.forEach((r) => {
    list.push(`  ${r.title} (row "${r.row}"):`);
    r.units.forEach((u) => list.push(`    ${plannerReadLine(u)}`));
  });
  const shape = wallSides.length
    // 2026-10-19: 꺾인 벽이 있으면 실제 방향으로 (목록이 벽마다 따로 있다)
    ? `PLAN LAYOUT: one ${wallSides.length >= 2 ? 'U' : 'L'}-shaped run — the back wall run plus a return on the ${wallSides.map((s) => s.toUpperCase()).join(' and ')} wall${wallSides.length > 1 ? 's' : ''}, listed as its own rows above (IDs continue from the back wall). No wall units on a return unless it is listed.`
    : plan.shape === 'straight'
      ? 'PLAN LAYOUT: one straight run on one wall.'
      : plan.shape === 'corner'
        ? 'PLAN LAYOUT: one L-shaped run on two walls (the elevation shows it unfolded flat).'
        : plan.shape === 'u'
          ? 'PLAN LAYOUT: one U-shaped run on three walls (the elevation shows it unfolded flat).'
          : null;
  return `You are checking a generated photo against the cabinet plan it was generated from.
${images.join('\n')}

PLAN — every unit, left to right within each row (widths in mm; the door and drawer counts are what the plan asks for):
${list.join('\n') || '  (no units listed)'}
${shape ? shape + '\n' : ''}
TASK: find every plan unit in IMAGE 1 and count what IMAGE 1 actually shows. The photo may differ from the plan — report the photo, never copy the plan's numbers.
1. Match the units by their order from the left, their relative widths and landmarks (sink, cooktop, hood, refrigerator, tall columns). The photo is in perspective: units nearer the camera look wider. If the run turns a corner in IMAGE 1, keep following it in the same order.
2. rows: for every plan row and every unit ID above give seen, doors and drawers. seen = cabinet (a unit with door or drawer fronts), refrigerator, dishwasher, open (open shelving or an empty opening)${hasHood ? ', hood (a range hood hanging in the gap with no cabinet)' : ''} or missing (no unit there). doors = hinged door fronts on that unit; drawers = drawer fronts on that unit. Count fronts one unit at a time by the vertical and horizontal gaps between them — two fronts side by side are 2 doors even when they share one handle line. Refrigerator doors and dishwasher panels are not doors.
3. extra_units: every built-in unit in IMAGE 1 that is none of the plan units — for example a cabinet above the refrigerator, cabinets on a side wall, a drawer stack added at an end. Give row (base, wall, tall, wardrobe or other), where (a few words), doors and drawers. Freestanding appliances, the hood, loose furniture and things outside the built-in run are not units.
4. layout_shape: straight when all built-in units stand on one wall; corner when they turn one corner onto a second wall; u when they cover three walls; unclear when you cannot tell.
5. confidence: 0 to 1 for your counts. notes: at most 5 short sentences about anything ambiguous.`;
}

/**
 * 플래너 판독 JSON → generations.layout (normalizeLayout 과 같은 모양 + units·extraUnits·shape).
 * 판독이 빠뜨린 모듈은 seen:'unread' 로 남기고 세그먼트에서 뺀다 — 도면 값으로 메우지 않는다.
 * mm 는 도면 값이다 (사진에서 재지 않는다).
 * @param {object} raw  Claude JSON (PLANNER_READ_SCHEMA). 깨진 입력에도 던지지 않는다.
 * @param {object} ctx  {category, designSpec, wallAnalysis?, slot?, model?, now?, elevation?}
 */
export function normalizePlannerRead(raw, ctx) {
  const category = plannerReadCategory(ctx.category);
  const plan = plannerReadPlan(ctx.designSpec, category);
  const wa = ctx.wallAnalysis || {};
  const W = wallW(wa.wallW);
  const H = wallH(wa.wallH);
  const run = plan.runMm || W;
  const r = raw && typeof raw === 'object' ? raw : {};
  const notes = [];

  // 판독 → id 별 (대소문자·공백 무시, 먼저 나온 것)
  const got = new Map();
  list(r.rows).forEach((row) => {
    list(row && row.units).forEach((u) => {
      const id = String((u && u.id) || '')
        .trim()
        .toUpperCase();
      if (!id || got.has(id)) return;
      got.set(id, {
        seen: PLANNER_READ_SEEN.includes(u.seen) ? u.seen : 'cabinet',
        doors: count(u.doors),
        drawers: count(u.drawers),
      });
    });
  });
  const known = new Set();
  const units = [];
  plan.rows.forEach((row) => {
    row.units.forEach((p) => {
      known.add(p.id);
      const g = got.get(p.id);
      if (!g) notes.push(`${p.id} was not reported`);
      units.push({
        id: p.id,
        row: row.row,
        section: p.section,
        widthMm: p.widthMm,
        startMm: p.startMm,
        endMm: p.endMm,
        expected: { seen: p.seen, doors: p.doors, drawers: p.drawers },
        seen: g ? g.seen : 'unread',
        doors: g ? (g.seen === 'cabinet' || g.seen === 'open' ? g.doors : 0) : 0,
        drawers: g ? (g.seen === 'cabinet' || g.seen === 'open' ? g.drawers : 0) : 0,
        // 2026-10-19: 꺾인 벽 유닛만 — 자리(startMm·endMm)는 모서리에서 잰 값이다
        ...(row.wall ? { wall: row.wall } : {}),
      });
    });
  });
  got.forEach((_, id) => {
    if (!known.has(id)) notes.push(`unknown unit id "${id.slice(0, 12)}" ignored`);
  });

  const pctOf = (mm) => clampPct(round2((mm / run) * 100));
  const mmBox = (u) => {
    const x = Math.max(0, Math.min(W, Math.round(u.startMm)));
    return { x, w: Math.max(0, Math.min(W, Math.round(u.endMm)) - x) };
  };
  const present = (u) => u.seen !== 'missing' && u.seen !== 'unread';

  // 바닥 세그먼트 — 하부·키큰장 구간을 왼쪽 끝 순서로 (verify.js expectedFromSpec 과 같은 순서)
  let segments;
  if (category === 'wardrobe') {
    const ws = units.filter(present);
    segments = ws.length
      ? [
          {
            kind: 'wardrobe',
            startPct: 0,
            endPct: 100,
            doors: ws.reduce((n, u) => n + u.doors, 0),
            drawers: ws.reduce((n, u) => n + u.drawers, 0),
            x: 0,
            w: W,
          },
        ]
      : [];
  } else {
    const secs = plan.rows
      .filter((row) => row.section === 'lower' || row.section === 'tall')
      // 2026-10-19: 꺾인 벽 줄은 주벽 뒤 (verify.js expectedFromSpec 과 같은 순서). 벽 안에서는 시작 자리 순.
      .sort((a, b) => (a.wall ? 1 : 0) - (b.wall ? 1 : 0) || (a.units[0] ? a.units[0].startMm : 0) - (b.units[0] ? b.units[0].startMm : 0));
    segments = secs.flatMap((row) =>
      units
        .filter((u) => u.row === row.row && (u.wall || null) === (row.wall || null) && present(u))
        .map((u) =>
          Object.assign(
            {
              kind:
                u.seen === 'cabinet' ? (u.section === 'tall' ? 'tall' : 'lower') : u.seen,
              startPct: pctOf(u.startMm),
              endPct: pctOf(u.endMm),
              doors: u.doors,
              drawers: u.drawers,
              id: u.id,
            },
            mmBox(u)
          )
        )
    );
  }
  // 2026-10-19: 후드로 보인 후드 칸은 상부장이 아니다 (gen-import 가 상부 영역으로 만들지 않게). 장으로 보였으면 그대로 센다.
  const uppers = units
    .filter((u) => u.row === 'wall' && present(u) && u.seen !== 'hood')
    .map((u) =>
      Object.assign(
        {
          kind: u.seen === 'open' ? 'open' : 'upper',
          startPct: pctOf(u.startMm),
          endPct: pctOf(u.endMm),
          doors: u.doors,
          id: u.id,
        },
        mmBox(u)
      )
    );

  // 가전 — 냉장고·식세기는 그것으로 보인 모듈 자리, 싱크·쿡탑·후드는 도면 자리 (조사·도면이 사실)
  const appliances = { sink: null, cooktop: null, hood: null, dishwasher: null, refrigerator: null };
  const at = (startMm, endMm, source) => {
    const b = mmBox({ startMm, endMm });
    return { centerPct: Math.round(clampPct(((startMm + endMm) / 2 / run) * 100) * 10) / 10, x: b.x, w: b.w, source };
  };
  ['refrigerator', 'dishwasher'].forEach((k) => {
    const u = units.find((x) => x.seen === k);
    if (u) appliances[k] = at(u.startMm, u.endMm, 'unit');
  });
  (Array.isArray(ctx.designSpec && ctx.designSpec.appliances) ? ctx.designSpec.appliances : []).forEach((a) => {
    const k = a && String(a.kind || '').toLowerCase();
    if (!['sink', 'cooktop', 'hood'].includes(k) || appliances[k] || a.fromLeftMm === undefined) return;
    const x0 = Number(a.fromLeftMm) || 0;
    appliances[k] = at(x0, x0 + (Number(a.widthMm) || 0), 'spec');
  });

  const extraUnits = list(r.extra_units)
    .filter((e) => e && typeof e === 'object')
    .slice(0, 10)
    .map((e) => ({
      row: PLANNER_READ_ROWS.concat(['other']).includes(e.row) ? e.row : 'other',
      where: String(e.where || '').trim().slice(0, 80),
      doors: count(e.doors),
      drawers: count(e.drawers),
    }));
  const shape = PLANNER_READ_SHAPES.includes(r.layout_shape) ? r.layout_shape : 'unclear';

  const doorCounts = { lower: 0, upper: 0, tall: 0, fridge: 0, wardrobe: 0 };
  let drawerCount = 0;
  segments.forEach((s) => {
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
  const conf = round2(unit(r.confidence, 0.5));

  return {
    version: LAYOUT_VERSION,
    reader: 'planner',
    readerVersion: PLANNER_READ_VERSION,
    category,
    sourceSlot: ctx.slot || 'base',
    elevation: ctx.elevation === 'labeled' || ctx.elevation === 'plain' ? ctx.elevation : null,
    model: ctx.model || null,
    created_at: ctx.now || new Date().toISOString(),
    wall: { W, H },
    segments,
    uppers,
    appliances,
    doorCounts,
    drawerCount,
    units,
    extraUnits,
    shape,
    planShape: plan.shape,
    confidence: { overall: conf, segments: conf, uppers: conf, appliances: conf },
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
