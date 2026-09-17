/**
 * R2: 도면 요약(design_spec) · 사진 준비 · 오류 문구 — js/planner/ai-photo.js 의 **순수 부분**.
 *
 * 계약 정본은 워커 문서다: docs/02-design/features/design-spec-prompt.md.
 * 그래서 이 시험은 우리가 지어낸 이름이 아니라 **그 문서의 표에서 필드 이름을 읽어** 대조한다.
 * 문서와 플래너가 갈라지면(= 워커가 조용히 400 을 내거나 필드를 버리면) 여기가 먼저 빨개진다.
 *
 * 도면은 골든 픽스처(test-utils/planner-golden.js)를 그대로 쓴다 — 브리지 계약이 보는 것과
 * 같은 배치를 보고 있다는 뜻이다. buildPlannerPayload 는 건드리지 않는다 (골든 바이트 불변).
 */
const fs = require('fs');
const path = require('path');
const {
  plannerAiPhotoBuildSpec,
  plannerAiPhotoModulesOf,
  plannerAiPhotoFinishOf,
  plannerAiPhotoCategoryOf,
  plannerAiPhotoBoxOf,
  plannerAiPhotoFitSize,
  plannerAiPhotoFileError,
  plannerAiPhotoReadImage,
  plannerAiPhotoErrorMessage,
  plannerAiPhotoScopeMessage,
  plannerAiPhotoStepLabel,
  plannerAiPhotoSpecSummary,
  PLANNER_AI_PHOTO_MAX_EDGE,
  PLANNER_AI_PHOTO_CREDIT,
  PLANNER_AI_PHOTO_STEP,
} = require('../js/planner/ai-photo');
const { plannerFinishResolve, plannerFinishNormalize } = require('../js/planner/planner-finish');
const { FIXTURES, modulesFromFixture } = require('../test-utils/planner-golden');

const DOC = path.join(__dirname, '..', 'docs', '02-design', 'features', 'design-spec-prompt.md');

// ────────────────────────────────────────────────────────────
// 계약 문서에서 필드 이름을 읽는다
// ────────────────────────────────────────────────────────────

/**
 * design-spec-prompt.md 의 "## 필드" 절에서 백틱으로 감싼 식별자를 전부 모은다.
 * 표의 첫 칸(필드 이름)뿐 아니라 규칙 칸의 `lower` · `upper` · `tall` 같은 값도 함께 들어온다 —
 * 우리가 보내는 이름이 그 안에 **있는지**를 보는 용도라 상위집합이어도 된다.
 */
function contractNames() {
  const md = fs.readFileSync(DOC, 'utf8').split('\r\n').join('\n');
  const from = md.indexOf('\n## 필드');
  const to = md.indexOf('\n## 검증');
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  const body = md.slice(from, to);
  const out = new Set();
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(body))) {
    String(m[1]).split(/[^A-Za-z0-9_]+/).forEach((tok) => {
      if (/^[A-Za-z][A-Za-z0-9_]*$/.test(tok)) out.add(tok);
    });
  }
  return out;
}

/** spec 안의 모든 객체 키를 모은다 (배열 인덱스는 뺀다). */
function keysOf(v, out = new Set()) {
  if (!v || typeof v !== 'object') return out;
  if (Array.isArray(v)) { v.forEach((x) => keysOf(x, out)); return out; }
  Object.keys(v).forEach((k) => { out.add(k); keysOf(v[k], out); });
  return out;
}

// ────────────────────────────────────────────────────────────
// 도면
// ────────────────────────────────────────────────────────────

/** 구조 — 칸 N 개, 타입 목록. 없으면 도어 하나. */
const struct = (o = {}) => Object.assign({
  verticalCount: 1,
  areaTypes: ['door'],
  areaWidths: [],
  areaIs2D: [],
  horizontalLayout: 'doorOnly',
  bottomType: 'drawer',
  drawerCount: 1,
}, o);

/** 골든 픽스처(직선 싱크대)를 구조 단계 모듈로. modulesFromFixture 와 같은 것을 본다. */
const straightModules = () => modulesFromFixture(FIXTURES.straight);

const STRAIGHT_STRUCTURES = {
  // 왼쪽 1200 은 도어 위 + 서랍 3단 (세로가 있는 모듈)
  'lower-0': struct({ horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerCount: 3 }),
  'lower-1': struct({ verticalCount: 2, areaTypes: ['door', 'door'], areaWidths: [400, 600] }),
  'lower-2': struct({ verticalCount: 2, areaTypes: ['drawer', 'open'] }),
  'upper-3': struct({ verticalCount: 2, areaTypes: ['door', 'door'], areaIs2D: [true, false] }),
  'upper-4': struct(),
};

const straightSpec = (extra = {}) => plannerAiPhotoBuildSpec(Object.assign({
  modules: straightModules(),
  structureOf: (id) => STRAIGHT_STRUCTURES[id] || null,
}, extra));

// ────────────────────────────────────────────────────────────

describe('계약 — 문서의 필드 이름만 보낸다', () => {
  test('보내는 키가 전부 design-spec-prompt.md 에 있다', () => {
    const names = contractNames();
    const spec = straightSpec();
    const unknown = [...keysOf(spec)].filter((k) => !names.has(k));
    expect(unknown).toEqual([]);
  });

  test('문서가 정한 최상위 이름 — 이름이 바뀌면 문서와 이 줄을 같이 고친다', () => {
    // design-spec-prompt.md "## 필드" 표: category · wallRunMm · sections · appliances · finishes · notes
    const spec = straightSpec();
    expect(Object.keys(spec).sort())
      .toEqual(['appliances', 'category', 'finishes', 'sections', 'wallRunMm'].sort());
    // sections 는 lower · upper · tall 세 칸뿐이다
    expect(Object.keys(spec.sections).every((k) => ['lower', 'upper', 'tall'].includes(k))).toBe(true);
    // 모듈 한 칸의 이름
    expect(Object.keys(spec.sections.lower.modules[0]).sort())
      .toEqual(['doorCount', 'drawerCount', 'kind', 'label', 'widthMm'].sort());
    // 가전 한 칸의 이름 — 내부 정렬용 값(_x)이 새지 않는다
    expect(Object.keys(spec.appliances[0]).sort()).toEqual(['fromLeftMm', 'kind', 'widthMm'].sort());
  });

  test('계약이 정한 kind 값만 쓴다', () => {
    const spec = straightSpec();
    const kinds = [];
    ['lower', 'upper', 'tall'].forEach((k) => {
      (spec.sections[k] ? spec.sections[k].modules : []).forEach((m) => kinds.push(m.kind));
    });
    kinds.forEach((k) => expect(['door', 'drawer', 'open', 'appliance']).toContain(k));
    spec.appliances.forEach((a) =>
      expect(['sink', 'hood', 'cooktop', 'fridge', 'dishwasher']).toContain(a.kind));
  });

  test('보낼 내용이 없으면 null — 빈 객체를 보내면 400 이다', () => {
    expect(plannerAiPhotoBuildSpec({ modules: [] })).toBeNull();
    expect(plannerAiPhotoBuildSpec(null)).toBeNull();
  });
});

describe('구간 묶기 (골든 픽스처 · 직선 싱크대)', () => {
  test('하부·상부로 갈리고, 분배기·후드는 구간이 아니다', () => {
    const spec = straightSpec();
    expect(Object.keys(spec.sections).sort()).toEqual(['lower', 'upper']);
    expect(spec.category).toBe('sink');
  });

  test('런 폭은 모든 모듈의 좌우 끝 사이다', () => {
    // lower 0~3600 · upper 0~3600 → 3600
    expect(straightSpec().wallRunMm).toBe(3600);
  });

  test('구간의 치수와 왼쪽 끝', () => {
    const s = straightSpec().sections;
    expect(s.lower).toMatchObject({ widthMm: 3600, heightMm: 870, depthMm: 650, fromLeftMm: 0 });
    expect(s.upper).toMatchObject({ widthMm: 3600, heightMm: 780, depthMm: 320, fromLeftMm: 0 });
  });

  test('fromLeftMm 는 왼쪽 끝이다 — 중심이 아니다', () => {
    const spec = plannerAiPhotoBuildSpec({
      modules: [
        { id: 'lower-0', section: 'lower', W: 1000, H: 870, D: 650, x: 0 },
        // 상부장은 600 지점부터 선다 → fromLeftMm 600, 중심(900)이 아니다
        { id: 'upper-1', section: 'upper', W: 600, H: 780, D: 350, x: 600 },
      ],
      structureOf: () => struct(),
    });
    expect(spec.sections.upper.fromLeftMm).toBe(600);
    expect(spec.sections.upper.widthMm).toBe(600);
  });

  test('모듈은 좌→우 순서다', () => {
    const spec = plannerAiPhotoBuildSpec({
      modules: [
        { id: 'c', section: 'lower', W: 300, H: 870, D: 650, x: 900 },
        { id: 'a', section: 'lower', W: 400, H: 870, D: 650, x: 0 },
        { id: 'b', section: 'lower', W: 500, H: 870, D: 650, x: 400 },
      ],
      structureOf: () => struct(),
    });
    expect(spec.sections.lower.modules.map((m) => m.widthMm)).toEqual([400, 500, 300]);
  });

  test('마감재(EP·몰딩)는 모듈이 아니지만 런 폭에는 든다', () => {
    const mods = straightModules().concat([
      { id: 'ep-9', section: 'ep', W: 20, H: 870, D: 650, x: -20 },
    ]);
    const spec = plannerAiPhotoBuildSpec({ modules: mods, structureOf: (id) => STRAIGHT_STRUCTURES[id] || null });
    expect(spec.wallRunMm).toBe(3620);
    expect(spec.sections.lower.fromLeftMm).toBe(20);        // 마감재가 런의 왼쪽 끝이다
    expect(spec.notes).toContain('EP');
    // 마감재가 모듈 목록에 끼어들지 않는다
    expect(spec.sections.lower.modules.some((m) => m.widthMm === 20)).toBe(false);
  });

  test('ㄱ자 — 90° 구간은 x 축에 눌러 펴고 그 사실을 노트에 적는다', () => {
    const spec = plannerAiPhotoBuildSpec({
      modules: modulesFromFixture(FIXTURES.lShape),
      structureOf: () => struct(),
    });
    // 자리(x)는 회전을 반영해 눌리지만(planeBoxOf 와 같은 규약: 90° 면 폭↔깊이),
    // 모듈 폭은 그 장의 실제 폭 그대로다 — 눌러 편 도면이라도 가구 양을 잃지 않는다.
    expect(spec.sections.lower.modules.map((m) => m.widthMm)).toEqual([1800, 900, 1500]);
    expect(spec.sections.lower.widthMm).toBe(4200);   // 모듈 폭 합 > x 범위(3775)
    expect(spec.wallRunMm).toBe(4200);
    expect(spec.notes).toContain('ㄱ자');
  });
});

describe('모듈 kind 매핑', () => {
  const one = (s, m = {}) => plannerAiPhotoModulesOf(Object.assign({ id: 'x', section: 'lower', W: 900 }, m), s);

  test('도어 · 양문 · 서랍 · 오픈', () => {
    expect(one(struct())[0]).toMatchObject({ kind: 'door', doorCount: 1, label: '도어' });
    expect(one(struct({ areaIs2D: [true] }))[0]).toMatchObject({ kind: 'door', doorCount: 2, label: '양문' });
    expect(one(struct({ areaTypes: ['drawer'] }))[0]).toMatchObject({ kind: 'drawer', drawerCount: 1, label: '서랍 1단' });
    expect(one(struct({ areaTypes: ['open'] }))[0]).toMatchObject({ kind: 'open', doorCount: 0, drawerCount: 0 });
  });

  test('모르는 칸 타입은 계약과 같게 door 로 떨어진다', () => {
    expect(one(struct({ areaTypes: ['blank'] }))[0]).toMatchObject({ kind: 'door', doorCount: 1, label: '먹장' });
    expect(one(struct({ areaTypes: ['made-up'] }))[0].kind).toBe('door');
  });

  test('칸이 여럿이면 칸마다 하나 — 폭은 areaWidths 가 있으면 그것', () => {
    const out = one(struct({ verticalCount: 3, areaTypes: ['door', 'drawer', 'open'], areaWidths: [300, 400, 200] }));
    expect(out.map((m) => [m.widthMm, m.kind])).toEqual([[300, 'door'], [400, 'drawer'], [200, 'open']]);
  });

  test('areaWidths 가 칸 수와 다르면 균등 분할', () => {
    const out = one(struct({ verticalCount: 3, areaTypes: ['door', 'door', 'door'], areaWidths: [300] }));
    expect(out.map((m) => m.widthMm)).toEqual([300, 300, 300]);
  });

  test('세로가 있는 모듈(도어 위 + 서랍 아래)은 쪼개지 않는다 — 계약에 세로 축이 없다', () => {
    const out = one(struct({
      verticalCount: 2, areaTypes: ['door', 'door'],
      horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerCount: 3,
    }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ widthMm: 900, kind: 'drawer', doorCount: 2, drawerCount: 3 });
    expect(out[0].label).toBe('도어 2 + 서랍 3단');
  });

  test('구조를 못 찾으면 도어 한 짝으로 본다', () => {
    expect(plannerAiPhotoModulesOf({ id: 'x', section: 'lower', W: 600 }, null))
      .toEqual([{ widthMm: 600, kind: 'door', doorCount: 1, label: '도어' }]);
  });
});

describe('붙박이장 · 냉장고장', () => {
  const WARDROBE = [
    { id: 'wardrobe-0', section: 'wardrobe', W: 720, H: 2310, D: 620, x: 0 },
    { id: 'wardrobe-1', section: 'wardrobe', W: 720, H: 2310, D: 620, x: 720 },
    { id: 'wardrobe-2', section: 'wardrobe', W: 720, H: 2310, D: 620, x: 1440 },
  ];

  test('붙박이장은 tall 구간이고 품목은 wardrobe 다', () => {
    const spec = plannerAiPhotoBuildSpec({ modules: WARDROBE, structureOf: () => struct() });
    expect(spec.category).toBe('wardrobe');
    expect(Object.keys(spec.sections)).toEqual(['tall']);
    expect(spec.sections.tall).toMatchObject({ widthMm: 2160, heightMm: 2310, depthMm: 620, fromLeftMm: 0 });
    expect(spec.sections.tall.modules).toHaveLength(3);
  });

  test('통의 바깥 서랍은 전면으로 센다 — 통 안 서랍(문 뒤)은 세지 않는다', () => {
    const spec = plannerAiPhotoBuildSpec({
      modules: WARDROBE,
      structureOf: () => struct(),
      // wardrobeLayoutFor 가 돌려주는 모양 {drawers, external}
      wardrobeFrontOf: (m) => (m.id === 'wardrobe-1'
        ? { drawers: 2, external: true }      // 문 아래 바깥 서랍 2단
        : { drawers: 3, external: false }),   // 통 안 서랍 — 보이지 않는다
    });
    const mods = spec.sections.tall.modules;
    expect(mods[0]).toMatchObject({ kind: 'door', drawerCount: 0 });
    expect(mods[1]).toMatchObject({ kind: 'drawer', doorCount: 1, drawerCount: 2, label: '도어 1 + 서랍 2단' });
    expect(mods[2]).toMatchObject({ kind: 'door', drawerCount: 0 });
  });

  test('냉장고장 — 냉장고 본체는 장이 아니라 구멍(appliance)이고 가전 목록에도 오른다', () => {
    const spec = plannerAiPhotoBuildSpec({
      modules: [
        { id: 'fridge-0', section: 'fridge', W: 900, H: 2300, D: 700, x: 0 },
        { id: 'refrigerator-1', section: 'refrigerator', W: 720, H: 1870, D: 700, x: 900 },
      ],
      structureOf: () => struct(),
    });
    expect(spec.category).toBe('fridge');
    const mods = spec.sections.tall.modules;
    expect(mods[1]).toMatchObject({ kind: 'appliance', widthMm: 720, label: '냉장고' });
    expect(spec.appliances).toEqual([{ kind: 'fridge', fromLeftMm: 900, widthMm: 720 }]);
  });

  test('플래너에 쿡탑 섹션이 없다 — 지어내지 않는다', () => {
    const spec = straightSpec();
    expect(spec.appliances.some((a) => a.kind === 'cooktop')).toBe(false);
  });
});

describe('가전 추출', () => {
  test('분배기 → sink · 후드 → hood, 왼쪽 끝 기준 좌→우', () => {
    expect(straightSpec().appliances).toEqual([
      { kind: 'sink', fromLeftMm: 1300, widthMm: 700 },
      { kind: 'hood', fromLeftMm: 2600, widthMm: 300 },
    ]);
  });

  test('가전의 fromLeftMm 도 왼쪽 끝이다', () => {
    const spec = plannerAiPhotoBuildSpec({
      modules: [
        { id: 'lower-0', section: 'lower', W: 3600, H: 870, D: 650, x: 0 },
        { id: 'sink-1', section: 'sink', W: 700, H: 500, D: 400, x: 900 },
      ],
      structureOf: () => struct(),
    });
    // 중심은 1250 이지만 계약이 원하는 값은 900 이다
    expect(spec.appliances[0].fromLeftMm).toBe(900);
  });

  test('가전 표시는 하부 구간의 모듈로 중복해서 들어가지 않는다', () => {
    expect(straightSpec().sections.lower.modules.some((m) => m.label === '싱크볼')).toBe(false);
  });
});

describe('마감 — nameEn 은 언제나 채운다', () => {
  const CATALOG = {
    byCode: {
      'YR-YPM-12': {
        code: 'YR-YPM-12', label: 'Supreme PET Matt · 매트 화이트', hex: '#f2f0ec', tone: 'matte',
        finish: 'Supreme PET Matt', finishLabel: 'PET Matt', colorLabel: '매트 화이트',
        vendor: 'yerim', vendorCode: 'YPM-12', grain: 'none',
      },
      'YR-YBM-03': {
        code: 'YR-YBM-03', label: 'Body MFC · 모시 웜베이지', hex: '#e2ddd0', tone: 'matte',
        finish: 'Body MFC', finishLabel: 'MFC', colorLabel: '모시 웜베이지',
        vendor: 'yerim', vendorCode: 'YBM-03', grain: 'none',
      },
      'TOP-SNW': {
        code: 'TOP-SNW', label: '상판 · 스노우 화이트', hex: '#eef0f1', tone: 'single',
        finish: '', finishLabel: '상판', colorLabel: '스노우 화이트', vendor: null, vendorCode: 'TOP-SNW',
        grain: 'none', category: 'countertop',
      },
    },
  };

  const detail = plannerFinishNormalize({
    item: { door: { code: 'YR-YPM-12' }, body: { code: 'YR-YBM-03' }, top: { code: 'TOP-SNW' } },
  });

  const withFinish = (d = detail, catalog = CATALOG) =>
    straightSpec({ detail: d, catalog, resolve: plannerFinishResolve }).finishes;

  test('도어 · 몸통 · 상판이 카탈로그 한 행에서 온다', () => {
    const f = withFinish();
    expect(Object.keys(f).sort()).toEqual(['body', 'door', 'top']);
    expect(f.door).toMatchObject({
      name: '예림 LUX Supreme PET Matt · 매트 화이트',
      nameEn: 'matte white PET laminate',
      colorHex: '#f2f0ec',
      tone: 'matte',
      vendorCode: 'YPM-12',
    });
  });

  test('`모시베이지` 를 영어로 옮긴다 — Gemini 에게 그 말은 색이 아니다', () => {
    expect(withFinish().body.nameEn).toBe('matte warm beige melamine board');
  });

  test("tone 'single' 은 계약에 없다 — 싣지 않는다", () => {
    expect(withFinish().top.tone).toBeUndefined();
    expect(withFinish().top.nameEn).toContain('white');
  });

  test('모르는 코드여도 nameEn 이 빈 칸으로 가지 않는다 (구 7×7 코드)', () => {
    const f = plannerAiPhotoFinishOf('PET-OAK-M', { byCode: {} });
    expect(f.nameEn).toBe('oak PET laminate');
    expect(f.name).toBe('PET-OAK-M');
    expect(f.colorHex).toBeUndefined();
  });

  test('아무 근거가 없어도 중립 문장으로 떨어진다 — 빈 nameEn 은 그 칸을 통째로 버리게 만든다', () => {
    const f = plannerAiPhotoFinishOf('ZZZ', null);
    expect(f.nameEn).toBe('neutral laminate panel');
    expect(f.nameEn.length).toBeGreaterThan(0);
  });

  test('이름이 없는 색은 hex 로 말한다', () => {
    const f = plannerAiPhotoFinishOf('YR-HW-1077', {
      byCode: { 'YR-HW-1077': { code: 'YR-HW-1077', label: 'Deco PVC · HW1077', hex: '#3a3d42', tone: 'matte', finish: 'Deco PVC', colorLabel: 'HW1077', vendorCode: 'HW1077', grain: 'none' } },
    });
    expect(f.nameEn).toBe('matte dark grey PVC foil panel');
  });

  test('나뭇결이면 tone 은 woodgrain', () => {
    const f = plannerAiPhotoFinishOf('YR-W-1', {
      byCode: { 'YR-W-1': { code: 'YR-W-1', label: 'Prime UV · 오크딥', hex: '#9a7248', tone: 'single', finish: 'Prime UV', colorLabel: '오크딥', vendorCode: 'W-1', grain: 'h' } },
    });
    expect(f.tone).toBe('woodgrain');
    expect(f.nameEn).toContain('oak');
  });

  test('모듈 단계 지정이 품목 단계를 이긴다 — 가장 많이 쓰인 코드가 대표다', () => {
    const d = plannerFinishNormalize({
      item: { door: { code: 'YR-YPM-12' } },
      modules: {
        'lower-0': { door: { code: 'YR-YBM-03' } },
        'lower-1': { door: { code: 'YR-YBM-03' } },
        'lower-2': { door: { code: 'YR-YBM-03' } },
      },
    });
    expect(withFinish(d).door.vendorCode).toBe('YBM-03');
  });

  test('마감 모델이 없으면 finishes 는 비고, 워커는 옛 door_color 로 돌아간다', () => {
    expect(straightSpec().finishes).toEqual({});
  });

  test('서랍 앞판(drawerFront)은 계약에 자리가 없어 보내지 않는다', () => {
    const d = plannerFinishNormalize({ item: { drawerFront: { code: 'YR-YPM-12' } } });
    expect(withFinish(d)).toEqual({});
  });
});

describe('품목 판정 — 플래너 URL 에는 품목 종류가 없다', () => {
  test.each([
    [[{ section: 'wardrobe' }, { section: 'lower' }], 'wardrobe'],
    [[{ section: 'fridge' }], 'fridge'],
    [[{ section: 'lower' }, { section: 'upper' }], 'sink'],
    [[{ section: 'tall' }], 'storage'],
    [[], 'storage'],
  ])('%j → %s', (mods, want) => {
    expect(plannerAiPhotoCategoryOf(mods)).toBe(want);
  });

  test('요약 한 줄이 크레딧 옆에 설 수 있는 모양이다', () => {
    expect(plannerAiPhotoSpecSummary(straightSpec())).toBe('싱크대 · 3600mm · 모듈 8 · 가전 2');
  });
});

describe('평면 좌우 범위', () => {
  test('회전 90/270 은 폭과 깊이를 맞바꾼다', () => {
    expect(plannerAiPhotoBoxOf({ W: 1500, D: 650, x: 2700, rotation: 90 }))
      .toEqual({ x: 3125, w: 650 });
    expect(plannerAiPhotoBoxOf({ W: 1200, D: 650, x: 0, rotation: 0 })).toEqual({ x: 0, w: 1200 });
    expect(plannerAiPhotoBoxOf({ W: 1200, D: 650, x: 0, rotation: 180 })).toEqual({ x: 0, w: 1200 });
  });
});

// ────────────────────────────────────────────────────────────
// 사진 준비
// ────────────────────────────────────────────────────────────

describe('사진 — 줄이기 · 형식 · 크기', () => {
  test('긴 변을 1600 으로 맞춘다', () => {
    expect(plannerAiPhotoFitSize(4000, 3000, PLANNER_AI_PHOTO_MAX_EDGE))
      .toEqual({ width: 1600, height: 1200, scale: 0.4 });
    expect(plannerAiPhotoFitSize(3000, 4000, PLANNER_AI_PHOTO_MAX_EDGE).height).toBe(1600);
  });

  test('작은 사진은 늘리지 않는다', () => {
    expect(plannerAiPhotoFitSize(800, 600, 1600)).toEqual({ width: 800, height: 600, scale: 1 });
  });

  test('0 이나 이상한 값이 와도 최소 1px 이다', () => {
    expect(plannerAiPhotoFitSize(0, 0, 1600)).toEqual({ width: 1, height: 1, scale: 1 });
    expect(plannerAiPhotoFitSize('x', 'y', 1600).width).toBe(1);
  });

  test('JPG · PNG 만 받는다', () => {
    expect(plannerAiPhotoFileError({ type: 'image/jpeg', size: 100 })).toBeNull();
    expect(plannerAiPhotoFileError({ type: 'image/png', size: 100 })).toBeNull();
    expect(plannerAiPhotoFileError({ type: 'image/webp', size: 100 })).toBe('JPG · PNG 만 올릴 수 있습니다');
    expect(plannerAiPhotoFileError({ type: 'application/pdf', size: 1 })).toMatch(/JPG/);
  });

  test('20MB 를 넘으면 막는다', () => {
    expect(plannerAiPhotoFileError({ type: 'image/jpeg', size: 20 * 1024 * 1024 })).toBeNull();
    expect(plannerAiPhotoFileError({ type: 'image/jpeg', size: 20 * 1024 * 1024 + 1 }))
      .toBe('20MB 이하만 올릴 수 있습니다');
  });

  test('없는 파일은 "사진을 먼저 올려 주세요"', () => {
    expect(plannerAiPhotoFileError(null)).toBe('사진을 먼저 올려 주세요');
  });

  test('readImage — 캔버스로 줄여 base64 JPEG 를 낸다', async () => {
    const drawn = [];
    const canvas = {
      width: 0, height: 0,
      getContext: () => ({ drawImage: (...a) => drawn.push(a.slice(1)) }),
      toDataURL: (mime, q) => `data:${mime};q=${q},QUJD`,
    };
    class FakeReader {
      readAsDataURL() { this.result = 'data:image/png;base64,xx'; setTimeout(() => this.onload(), 0); }
    }
    class FakeImage {
      constructor() { this.naturalWidth = 3200; this.naturalHeight = 2400; }
      set src(v) { this._src = v; setTimeout(() => this.onload(), 0); }
      get src() { return this._src; }
    }
    const out = await plannerAiPhotoReadImage(
      { type: 'image/jpeg', size: 1000, name: '방.jpg' },
      { canvas, FileReader: FakeReader, Image: FakeImage }
    );
    expect(out).toMatchObject({ base64: 'QUJD', mime: 'image/jpeg', name: '방.jpg', width: 1600, height: 1200 });
    expect(canvas.width).toBe(1600);
    expect(drawn[0]).toEqual([0, 0, 1600, 1200]);
  });

  test('readImage — 형식이 틀리면 한국어로 거절한다', async () => {
    await expect(plannerAiPhotoReadImage({ type: 'image/gif', size: 1 }))
      .rejects.toThrow('JPG · PNG 만 올릴 수 있습니다');
  });
});

// ────────────────────────────────────────────────────────────
// 오류 문구 · 진행 라벨
// ────────────────────────────────────────────────────────────

describe('오류 문구 — 문서에 적힌 실패마다 한 줄', () => {
  test('402 크레딧 부족 — 값(20)을 함께 말한다', () => {
    const m = plannerAiPhotoErrorMessage(402, { code: 'insufficient_credit', error: '이번 달 생성 횟수를 모두 사용했습니다.' });
    expect(m).toContain('크레딧이 부족');
    expect(m).toContain(String(PLANNER_AI_PHOTO_CREDIT));
  });

  test('409 동시 실행', () => {
    expect(plannerAiPhotoErrorMessage(409, { code: 'conflict' })).toContain('이미 생성 중인 작업');
  });

  test('400 bad_design_spec — 크레딧이 안 깎였다는 것을 말한다 (차감 전에 난다)', () => {
    const m = plannerAiPhotoErrorMessage(400, {
      code: 'bad_design_spec',
      error: 'design_spec.category (wardrobe) does not match category (sink)',
    });
    expect(m).toContain('도면 요약');
    expect(m).toContain('차감되지 않았습니다');
    expect(m).toContain('does not match');
  });

  test('401 로그인 풀림', () => {
    expect(plannerAiPhotoErrorMessage(401, null)).toContain('로그인');
  });

  test('404 · 500 · 알 수 없는 응답', () => {
    expect(plannerAiPhotoErrorMessage(404, {})).toContain('찾을 수 없습니다');
    expect(plannerAiPhotoErrorMessage(500, {})).toContain('생성 서버가 응답하지 않습니다');
    expect(plannerAiPhotoErrorMessage(418, { error: '주전자입니다' })).toBe('주전자입니다');
    expect(plannerAiPhotoErrorMessage(418, null)).toContain('생성에 실패했습니다');
  });

  test('스코프가 없을 때 — design=local 이면 설계를 먼저 저장하라고 한다', () => {
    expect(plannerAiPhotoScopeMessage('no-scope')).toContain('설계를 먼저 저장');
    expect(plannerAiPhotoScopeMessage('no-item')).toContain('품목을 먼저 추가');
    expect(plannerAiPhotoScopeMessage('no-session')).toContain('로그인');
    expect(plannerAiPhotoScopeMessage('no-sdk')).toContain('쓸 수 없습니다');
  });
});

describe('진행 라벨', () => {
  test('서버가 준 step_label 이 먼저다', () => {
    expect(plannerAiPhotoStepLabel({ status: 'rendering', step_label: '기본안을 그리는 중', progress: 30 }))
      .toBe('기본안을 그리는 중 · 30%');
  });

  test('없으면 옮겨 적은 표로 떨어진다 (정본은 워커 job.js STEP)', () => {
    expect(plannerAiPhotoStepLabel({ status: 'qc' })).toBe('품질을 확인하는 중 · 60%');
    expect(plannerAiPhotoStepLabel({ status: '누구세요' })).toBe('생성 중 · 0%');
  });

  test('표가 워커의 상태 이름과 같다 (generations.status CHECK 과 같은 목록)', () => {
    expect(Object.keys(PLANNER_AI_PHOTO_STEP).sort())
      .toEqual(['analyzing', 'done', 'failed', 'qc', 'queued', 'rendering', 'variants'].sort());
  });
});
