/**
 * 플래너 모드(mode:'planner') 설치 프롬프트 v3 · 검사 코드.
 * 정본 계획: docs/01-plan/planner-render-realize.plan.md §4.2 (프롬프트 초안) · §6.2 · §11.
 * 계약: docs/02-design/features/design-spec-prompt.md "플래너 모드".
 *
 * 고정하는 것 (2026-10-19 v3 — 모두 design_spec·분석 결과에서 계산된다):
 *   1) CLOSED LIST — 결과의 붙박이는 목록의 유닛뿐
 *   2) LAYOUT — layout 필드 → 없으면 notes 의 ㄱ자·ㄷ자 → 그래도 모르면 문단째 없음
 *   3) 둘째 줄부터 기준 줄(하부, 없으면 가장 긴 줄)의 모듈 경계로 시작·끝
 *   4) EMPTY ZONES — 줄이 덮지 않는 구간, 줄 사이, 천장 틈, 남는 벽
 *   5) 바닥 기준 높이 (fromFloorMm · ceilingMm) — 없으면 높이만
 *   6) BINDING — 줄 안 폭 비율·줄끼리 위치는 구속, 벽에 맞추는 것은 전체 배율만
 *   7) IMAGE B 의 번호·치수선은 주석
 *   8) EDIT ZONE / KEEP
 *   9) FINAL SELF-CHECK 가 맨 끝
 *   + 옛 설치·검사 프롬프트는 바이트 그대로 (fixture 스냅샷), 검사 코드·gap_to_ceiling 기준은 플래너 모드에서만
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALL_QC_ISSUE_CODES,
  CATEGORIES,
  PLANNER_ASPECTS,
  PLANNER_QC_FIXES,
  QC_ISSUE_CODES,
  buildDesignSpecBlock,
  buildInstallPrompt,
  buildPlannerPrompt,
  buildQcPrompt,
  normalizeDesignSpec,
  parseQc,
  resolvePlannerAspect,
} from '../src/prompts.js';

const baseline = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/install-prompt-baseline.json', import.meta.url)),
    'utf8'
  )
);

/**
 * D1 — 계획서 §4.2 · 첫 실측과 같은 도면. 하부 800·400·1000 (2·1·2도어, 싱크 1350/700), 상부 900·900 (2·2도어), 런 2200.
 * extra 는 최상위에 덮고, upper 는 상부 구간에 덮는다.
 */
function d1Raw(extra = {}, upper = {}) {
  return {
    category: 'sink',
    wallRunMm: 2200,
    sections: {
      lower: {
        widthMm: 2200, heightMm: 870, depthMm: 600, fromLeftMm: 0,
        modules: [
          { widthMm: 800, kind: 'door', doorCount: 2 },
          { widthMm: 400, kind: 'door', doorCount: 1 },
          { widthMm: 1000, kind: 'door', doorCount: 2 },
        ],
      },
      upper: {
        widthMm: 1800, heightMm: 780, depthMm: 350, fromLeftMm: 0,
        modules: [
          { widthMm: 900, kind: 'door', doorCount: 2 },
          { widthMm: 900, kind: 'door', doorCount: 2 },
        ],
        ...upper,
      },
    },
    appliances: [{ kind: 'sink', fromLeftMm: 1350, widthMm: 700 }],
    finishes: {
      door: { name: '예림 LUX 아크 플랫 화이트', nameEn: 'Arc Flat White', colorHex: '#f4f4f0', tone: 'matte' },
      body: { nameEn: 'Arc Flat White' },
      top: { nameEn: '12 mm Calacatta engineered stone' },
    },
    ...extra,
  };
}
const d1Spec = (extra, upper) => normalizeDesignSpec(d1Raw(extra, upper), 'sink');
/** 보고용 가정: layout straight, 상부 바닥에서 1450, 천장 2400 */
const d1Full = () => d1Spec({ layout: { shape: 'straight' }, ceilingMm: 2400 }, { fromFloorMm: 1450 });

/** D2 — 붙박이장 900×4, 각 2도어, 런 3600 */
function d2Spec(extra = {}) {
  return normalizeDesignSpec(
    {
      category: 'wardrobe',
      wallRunMm: 3600,
      sections: {
        tall: {
          widthMm: 3600, heightMm: 2310, fromLeftMm: 0,
          modules: [1, 2, 3, 4].map(() => ({ widthMm: 900, kind: 'door', doorCount: 2 })),
        },
      },
      ...extra,
    },
    'wardrobe'
  );
}

/** 키큰장 포함 — 하부 2700(서랍·식세기·오픈·도어+서랍) + 키큰장 냉장고 900, 상부 없음 */
function tallSpec(extra = {}) {
  return normalizeDesignSpec(
    {
      category: 'sink',
      wallRunMm: 3600,
      sections: {
        lower: {
          widthMm: 2700, heightMm: 870, fromLeftMm: 0,
          modules: [
            { widthMm: 900, kind: 'drawer', drawerCount: 3 },
            { widthMm: 600, kind: 'appliance', label: '식기세척기' },
            { widthMm: 600, kind: 'open' },
            { widthMm: 600, kind: 'drawer', doorCount: 1, drawerCount: 1 },
          ],
        },
        tall: {
          widthMm: 900, heightMm: 2300, fromLeftMm: 2700,
          modules: [{ widthMm: 900, kind: 'appliance', label: '냉장고' }],
        },
      },
      appliances: [
        { kind: 'dishwasher', fromLeftMm: 900, widthMm: 600 },
        { kind: 'fridge', fromLeftMm: 2700, widthMm: 900 },
        { kind: 'hood', fromLeftMm: 1500, widthMm: 600 },
      ],
      ...extra,
    },
    'sink'
  );
}

/** 분석이 성공한 방 (벽 3600, 기존 주방 있음) */
function d1Ctx(extra = {}) {
  return {
    category: 'sink',
    wallW: 3600,
    wallH: 2400,
    confidence: 'medium',
    existing: 'old wood kitchen cabinets',
    designSpec: d1Spec(),
    massing: true,
    aspect: '16:9',
    doorColor: 'white',
    doorFinish: 'matte',
    ...extra,
  };
}
const d2Ctx = (extra = {}) =>
  d1Ctx({ category: 'wardrobe', designSpec: d2Spec(), existing: null, ...extra });

// ─── 0. 세 장의 역할 · 7) IMAGE B 주석 ───

test('세 장에 이름과 역할, IMAGE A 는 EDIT ZONE 안만 고친다', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.match(p, /^You receive three images\.\n/);
  assert.ok(p.includes("IMAGE A — ROOM PHOTO: the customer's real room. Edit this photo only inside the EDIT ZONE below."));
  assert.ok(p.includes('IMAGE C — 3/4 VIEW of the same design: shows depth, side panels and the countertop edge.'));
  assert.ok(p.includes('IMAGE B and IMAGE C are design references. Do not paste them into the photo'));
  assert.ok(p.includes('TASK: install this built-in kitchen on the main wall of IMAGE A as a real, finished installation.'));
});

test('7) 번호 입면(labeledElevation)이면 IMAGE B 의 번호·치수선은 주석 — 그리지 말라', () => {
  const p = buildPlannerPrompt(d1Ctx({ labeledElevation: true }));
  assert.ok(
    p.includes(
      'IMAGE B — FRONT ELEVATION from our planner: the exact cabinet design to build, seen straight on. ' +
        'IMAGE B may carry ID labels (L1, U1 …) and dimension lines; they are annotations that match the list below — never draw any text, numbers or lines from them.\n'
    )
  );
});

// 2026-10-19: Gemini 는 번호 라벨을 도어 위에 글자로 그려 넣었다 — 번호 없는 입면을 보낼 때는 번호를 말하지 않는다
test('7) 번호 없는 입면(기본)이면 번호·치수선 문장이 없고, 그 문장 하나만 다르다', () => {
  const plain = buildPlannerPrompt(d1Ctx());
  const labeled = buildPlannerPrompt(d1Ctx({ labeledElevation: true }));
  assert.ok(plain.includes('IMAGE B — FRONT ELEVATION from our planner: the exact cabinet design to build, seen straight on.\n'));
  assert.doesNotMatch(plain, /ID labels|dimension lines|annotations/);
  assert.equal(
    plain,
    labeled.replace(
      ' IMAGE B may carry ID labels (L1, U1 …) and dimension lines; they are annotations that match the list below — never draw any text, numbers or lines from them.',
      ''
    )
  );
  assert.equal(buildPlannerPrompt(d1Ctx({ labeledElevation: false })), plain);
});

test('IMAGE C 가 없으면 C 문장이 하나도 없다', () => {
  const p = buildPlannerPrompt(d1Ctx({ massing: false }));
  assert.match(p, /^You receive two images\.\n/);
  assert.doesNotMatch(p, /IMAGE C/);
  assert.ok(p.includes('IMAGE B is a design reference. Do not paste it into the photo'));
  assert.ok(p.includes('paste IMAGE B into the photo;'));
});

// ─── FIXED GEOMETRY · 1) CLOSED LIST · 3) 기준 줄 · 6) 비율 ───

test('모듈마다 번호·폭·종류, 줄마다 폭 비율 — 런 대비 % 는 비율로 바뀌었다', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.ok(p.includes('FIXED GEOMETRY — left to right, exactly as IMAGE B shows:'));
  assert.ok(p.includes('  BASE ROW (870 mm high, 2200 mm long — 61 % of the wall, starts at the left corner):'));
  assert.match(p, /\n {4}L1 {3}800 mm {2}2-door cabinet\n/);
  assert.match(p, /\n {4}L2 {3}400 mm {2}single-door cabinet\n/);
  // 싱크는 그 자리 모듈(L3)에 붙는다 — 수전 필수
  assert.match(p, /\n {4}L3 {2}1000 mm {2}2-door cabinet, sink bowl with a single-lever mixer faucet .* the faucet is mandatory\n/);
  assert.ok(p.includes('    → widths L1 : L2 : L3 = 2 : 1 : 2.5'));
  assert.match(p, /\n {4}U1 {3}900 mm {2}2-door cabinet\n/);
  assert.ok(p.includes('    → widths U1 : U2 = 1 : 1'));
  assert.doesNotMatch(p, /% of the run/);
  assert.doesNotMatch(p, /COUNT CHECK/);
});

test('1) CLOSED LIST — 목록의 유닛뿐, 다른 장·서랍장·선반·판 없음', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.ok(
    p.includes(
      '\nCLOSED LIST: L1–L3 and U1–U2 are the only built-in units in the result. Add nothing else: no other cabinet, drawer unit, shelf or board anywhere in the room.'
    )
  );
  const w = buildPlannerPrompt(d2Ctx());
  assert.ok(w.includes('CLOSED LIST: W1–W4 are the only built-in units in the result.'));
  const t = buildPlannerPrompt(d1Ctx({ designSpec: tallSpec() }));
  assert.ok(t.includes('CLOSED LIST: L1–L4 and T1 are the only built-in units in the result.'));
});

test('3) 둘째 줄은 기준 줄(하부)의 모듈 경계로 시작·끝을 말한다', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.ok(
    p.includes(
      '  WALL ROW (780 mm high, 1800 mm long) — U1–U2 start above the left end of L1 and end above L3, 400 mm before the right end of the base row:'
    )
  );
  // 경계에 딱 맞으면 이음매로 — 상부가 L2 왼쪽에서 시작해 L3 오른쪽 끝에서 끝난다
  const q = buildPlannerPrompt(d1Ctx({ designSpec: d1Spec({}, { fromLeftMm: 800, widthMm: 1400, modules: [{ widthMm: 1400, kind: 'door', doorCount: 2 }] }) }));
  assert.ok(q.includes(' — U1 starts above the joint between L1 and L2 and ends above the right end of L3:'));
  // 키큰장은 "at" — 하부 오른쪽 끝에 붙어 하부 밖으로 900
  const t = buildPlannerPrompt(d1Ctx({ designSpec: tallSpec() }));
  assert.ok(t.includes('  TALL ROW (2300 mm high, 900 mm long) — T1 starts at the right end of L4 and ends 900 mm right of the base row:'));
});

test('3) 하부가 없으면 가장 긴 줄이 기준이다', () => {
  const spec = normalizeDesignSpec(
    {
      category: 'sink',
      sections: {
        upper: { widthMm: 2400, heightMm: 700, fromLeftMm: 0, modules: [800, 800, 800].map((w) => ({ widthMm: w, kind: 'door', doorCount: 2 })) },
        tall: { widthMm: 600, heightMm: 2200, fromLeftMm: 2400, modules: [{ widthMm: 600, kind: 'door', doorCount: 1 }] },
      },
    },
    'sink'
  );
  const p = buildPlannerPrompt(d1Ctx({ designSpec: spec }));
  assert.ok(p.includes('  WALL ROW (700 mm high, 2400 mm long — 67 % of the wall, starts at the left corner):'));
  assert.ok(p.includes(' — T1 starts at the right end of U3 and ends 600 mm right of the wall row:'));
  assert.ok(p.includes('BINDING: the order, the counts and the width ratios inside each row (within about ±10 %), and where each row starts and ends against the wall row.'));
});

test('6) BINDING — 줄 안 폭 비율·줄끼리 위치는 구속, 벽에 맞추는 것은 전체 배율만', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.ok(
    p.includes(
      '\nBINDING: the order, the counts and the width ratios inside each row (within about ±10 %), and where each row starts and ends against the base row. Only the overall scale may change to fit the real wall in IMAGE A.'
    )
  );
  // 옛 "mm·% 는 참고, 벽에 맞게 늘려라" 문장은 없다
  assert.doesNotMatch(p, /are guidance/);
  assert.doesNotMatch(p, /scale the widths to fit/);
  // 한 줄짜리(붙박이장)는 줄끼리 위치를 말하지 않는다
  const w = buildPlannerPrompt(d2Ctx());
  assert.ok(w.includes('BINDING: the order, the counts and the width ratios inside the row (within about ±10 %). Only the overall scale may change'));
  assert.ok(w.includes('    → widths W1 : W2 : W3 : W4 = 1 : 1 : 1 : 1'));
});

test('서랍·오픈·키큰장·가전 칸 — 종류 구절, 후드는 APPLIANCES 줄', () => {
  const p = buildPlannerPrompt(d1Ctx({ designSpec: tallSpec() }));
  assert.match(p, /L1 {3}900 mm {2}3-drawer stack\n/);
  assert.match(p, /L2 {3}600 mm {2}fully integrated dishwasher behind a matching front\n/);
  assert.match(p, /L3 {3}600 mm {2}open shelving, no door\n/);
  assert.match(p, /L4 {3}600 mm {2}single-door cabinet over 1 drawer\n/);
  assert.ok(p.includes('    → widths L1 : L2 : L3 : L4 = 1.5 : 1 : 1 : 1'));
  assert.match(p, /T1 {3}900 mm {2}opening with a built-in refrigerator, its front flush with the doors\n/);
  assert.ok(p.includes('  APPLIANCES: a slim concealed hood, centred at about 50 % of the run.'));
  // 도면에 있는 가전은 금지 목록에서 빠진다 — 없는 것만 이름으로
  assert.ok(p.includes('; add an oven or cooktop that is not listed;'));
});

test('냉장고 자리에 냉장고가 요약에 없으면 빈 자리로 둔다', () => {
  const spec = normalizeDesignSpec(
    {
      category: 'fridge',
      sections: { tall: { fromLeftMm: 0, modules: [{ widthMm: 900, kind: 'appliance', label: '냉장고' }, { widthMm: 600, kind: 'door', doorCount: 1 }] } },
    },
    'fridge'
  );
  const p = buildPlannerPrompt(d1Ctx({ category: 'fridge', designSpec: spec }));
  assert.ok(p.includes('TASK: install this built-in refrigerator surround'));
  assert.match(p, /T1 {3}900 mm {2}empty opening for a refrigerator — leave it empty\n/);
});

test('붙박이장(D2)은 한 줄 — W 번호, 벽을 다 채우면 남는 벽 구역이 없다', () => {
  const p = buildPlannerPrompt(d2Ctx());
  assert.ok(p.includes('TASK: install this built-in wardrobe on the main wall'));
  assert.ok(p.includes('  WARDROBE ROW (2310 mm high, 3600 mm long — 100 % of the wall, starts at the left corner):'));
  assert.match(p, /W1 {3}900 mm {2}2-door wardrobe unit\n/);
  assert.match(p, /W4 {3}900 mm {2}2-door wardrobe unit\n/);
  assert.doesNotMatch(p, /BASE ROW|TALL ROW|WALL ROW/);
  assert.ok(p.includes('IMAGE C — 3/4 VIEW of the same design: shows depth, side panels.'));
  assert.ok(p.includes('add any appliance, sink or hood;'));
  // 높이 기준도 없고 벽을 다 채운다 — 빈 구역 문단 자체가 없다
  assert.doesNotMatch(p, /EMPTY ZONES/);
  assert.ok(p.endsWith('FINAL SELF-CHECK before you answer: wardrobe row 4 units, 8 doors, 0 drawers; no other built-in unit anywhere.'));
});

// ─── 2) LAYOUT ───

test('2) layout straight — 정면 벽 한 줄, 옆벽에는 장 없음', () => {
  const p = buildPlannerPrompt(d1Ctx({ designSpec: d1Spec({ layout: { shape: 'straight' } }) }));
  assert.ok(
    p.includes(
      '\n\nLAYOUT: one straight run on the main wall only; the side walls get no cabinets, even if the old furniture turned the corner.\n\nFIXED GEOMETRY'
    )
  );
  const w = buildPlannerPrompt(d2Ctx({ designSpec: d2Spec({ layout: { shape: 'straight', walls: 3 } }) }));
  assert.ok(w.includes('LAYOUT: one straight run on the main wall only;'));
});

test('2) layout 이 없고 notes 도 모르면 LAYOUT 문단이 없다 (일자로 단정하지 않는다)', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.doesNotMatch(p, /LAYOUT:/);
  assert.doesNotMatch(p, /side walls/);
});

test('2) ㄱ자 — layout 필드 또는 플래너 notes 의 회전 문구로, 벽 % 와 남는 벽은 말하지 않는다', () => {
  const byField = buildPlannerPrompt(d1Ctx({ designSpec: d1Spec({ layout: { shape: 'corner', walls: 2 } }) }));
  const byNotes = buildPlannerPrompt(d1Ctx({ designSpec: d1Spec({ notes: 'ㄱ자 배치라 꺾인 구간을 한 벽으로 폈습니다' }) }));
  for (const p of [byField, byNotes]) {
    assert.ok(
      p.includes(
        "LAYOUT: one L-shaped run on 2 walls. IMAGE B shows it unfolded into one flat strip — fold it at the room's corners in IMAGE A. No cabinets on any other wall."
      )
    );
    assert.doesNotMatch(p, /% of the wall/);
    assert.doesNotMatch(p, /right of the run/);
    assert.ok(p.includes('EDIT ZONE: the 2 target walls only'));
  }
  const u = buildPlannerPrompt(d1Ctx({ designSpec: d1Spec({ layout: { shape: 'u' } }) }));
  assert.ok(u.includes('LAYOUT: one U-shaped run on 3 walls.'));
});

test('layout 정규화 — 모르는 모양은 버리고, walls 는 1–4 로 자른다, 옛 설치 프롬프트에는 안 나온다', () => {
  assert.deepEqual(d1Spec({ layout: { shape: 'CORNER', walls: 9 } }).layout, { shape: 'corner', walls: 4 });
  assert.equal(d1Spec({ layout: { shape: 'zigzag' } }).layout, undefined);
  assert.equal(d1Spec({ layout: 'straight' }).layout, undefined);
  assert.equal(d1Spec({ ceilingMm: 9999 }).ceilingMm, 4000);
  assert.equal(d1Spec({}, { fromFloorMm: 1450 }).sections.upper.fromFloorMm, 1450);
  assert.throws(() => d1Spec({ ceilingMm: 'abc' }), /ceilingMm/);
  // 설치 프롬프트(연출컷 경로)는 새 필드를 읽지 않는다
  assert.equal(buildDesignSpecBlock(d1Full()), buildDesignSpecBlock(d1Spec()));
});

// ─── 4) EMPTY ZONES · 5) 높이 ───

test('4) 빈 구역 — 상부가 덮지 않는 하부 위, 남는 벽 (높이 기준 없음)', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.ok(
    p.includes(
      '\n\nEMPTY ZONES — leave each as bare finished wall, with nothing built in:\n' +
        '  1. at wall-unit height above L3, between U2 and the right end of the run (400 mm) — no wall unit\n' +
        '  2. the main wall right of the run — the remaining 39 % of the wall (about 1400 mm), floor to ceiling\n\n'
    )
  );
  // 옛 REST OF THE WALL 문단은 EMPTY ZONES · EDIT ZONE 으로 합쳐졌다
  assert.doesNotMatch(p, /REST OF THE WALL/);
});

test('4) 상부가 없으면 하부 위 전체, 키큰장 옆까지만', () => {
  const p = buildPlannerPrompt(d1Ctx({ designSpec: tallSpec() }));
  assert.ok(p.includes('  1. at wall-unit height above L1–L4, between the left end of the run and T1 (2700 mm) — no wall unit\n'));
  // 런이 벽을 다 채운다(3600) — 남는 벽 없음
  assert.doesNotMatch(p, /right of the run/);
  const lowerOnly = d1Spec();
  delete lowerOnly.sections.upper;
  const q = buildPlannerPrompt(d1Ctx({ designSpec: lowerOnly }));
  assert.ok(q.includes('  1. at wall-unit height above L1–L3 across the whole run — no wall units\n'));
});

test('4) 분석이 실패하면 % 없이 "런보다 벽이 길면" 으로', () => {
  const p = buildPlannerPrompt(d1Ctx({ wallW: 3000, wallH: 2400, confidence: null, existing: null }));
  assert.doesNotMatch(p, /% of the wall/);
  assert.ok(p.includes('  BASE ROW (870 mm high, 2200 mm long, starts at the left corner):'));
  assert.ok(p.includes('  2. the main wall beyond the ends of the run, wherever the run is shorter than the wall'));
});

test('사용자가 벽 폭을 직접 넣었으면(confidence user) 분석 실패로 보지 않는다', () => {
  const p = buildPlannerPrompt(d1Ctx({ wallW: 3000, wallH: 2400, confidence: 'user', existing: null }));
  assert.ok(p.includes('the remaining 27 % of the wall (about 800 mm)'));
});

test('5) fromFloorMm·ceilingMm — 줄마다 바닥 기준 아랫면·윗면, 줄 사이·천장 틈이 빈 구역으로', () => {
  const p = buildPlannerPrompt(d1Ctx({ designSpec: d1Full() }));
  assert.ok(p.includes('  BASE ROW (2200 mm long — 61 % of the wall, starts at the left corner; bottom at 0 mm, top at 870 mm from the floor):'));
  assert.ok(p.includes('  WALL ROW (1800 mm long; bottom at 1450 mm, top at 2230 mm from the floor) — U1–U2 start above the left end of L1'));
  assert.ok(
    p.includes(
      '  1. at wall-unit height above L3, between U2 and the right end of the run (400 mm) — no wall unit\n' +
        '  2. between the top of the base row (870 mm) and the bottom of the wall row (1450 mm) — 580 mm of open wall\n' +
        '  3. between the top of the wall row (2230 mm) and the ceiling (2400 mm) — 170 mm, left open or closed exactly as IMAGE B shows\n' +
        '  4. the main wall right of the run — the remaining 39 % of the wall (about 1400 mm), floor to ceiling\n'
    )
  );
  assert.doesNotMatch(p, /780 mm high/);
});

test('5) fromFloorMm 만 있고 ceilingMm 가 없으면 천장 틈은 말하지 않는다', () => {
  const p = buildPlannerPrompt(d1Ctx({ designSpec: d1Spec({}, { fromFloorMm: 1450 }) }));
  assert.ok(p.includes('bottom at 1450 mm, top at 2230 mm from the floor'));
  assert.ok(p.includes('— 580 mm of open wall'));
  assert.doesNotMatch(p, /the ceiling \(/);
});

test('5) 높이 기준이 하나도 없으면 지금처럼 높이만', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.doesNotMatch(p, /from the floor/);
  assert.ok(p.includes('WALL ROW (780 mm high, 1800 mm long)'));
});

test('5) 천장까지 닿는 줄은 빈 구역이 아니라 "up to the ceiling"', () => {
  const p = buildPlannerPrompt(d2Ctx({ designSpec: d2Spec({ ceilingMm: 2310 }) }));
  assert.ok(p.includes('  WARDROBE ROW (3600 mm long — 100 % of the wall, starts at the left corner; bottom at 0 mm, top at 2310 mm from the floor — up to the ceiling):'));
  assert.doesNotMatch(p, /EMPTY ZONES/);
  const q = buildPlannerPrompt(d2Ctx({ designSpec: d2Spec({ ceilingMm: 2400 }) }));
  assert.ok(q.includes('  1. between the top of the wardrobe row (2310 mm) and the ceiling (2400 mm) — 90 mm, left open or closed exactly as IMAGE B shows'));
});

// ─── 8) EDIT ZONE / KEEP ───

test('8) EDIT ZONE 은 목표 벽의 붙박이만, KEEP 은 카메라·방·움직이는 물건', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.ok(
    p.includes(
      '\n\nEDIT ZONE: the target wall only — the new run plus the built-in cabinetry on the target wall that it replaces (old wood kitchen cabinets). ' +
        'Remove that cabinetry completely, with no demolition marks or ghost outlines.\n' +
        'KEEP everything outside the edit zone exactly as photographed: the camera position, lens and framing (do not widen the view or invent any part of the room); ' +
        'the other walls, ceiling, floor, windows and doors; the lighting; and every movable object — refrigerator, carts, chairs, lamps, plants and decorations — unless it stands where a new unit goes.\n\n'
    )
  );
  // 기존 가구 설명이 없으면 괄호도 없다
  const q = buildPlannerPrompt(d1Ctx({ existing: null }));
  assert.ok(q.includes('the built-in cabinetry on the target wall that it replaces. Remove'));
});

// ─── 마감·손잡이·금지·출력 · 9) FINAL SELF-CHECK ───

test('마감은 design_spec.finishes 로, 없으면 door_color/door_finish 로', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.ok(
    p.includes(
      'MATERIALS: fronts matte Arc Flat White (예림 LUX 아크 플랫 화이트, colour #f4f4f0), the same on every door and drawer; carcass and visible sides Arc Flat White; countertop 12 mm Calacatta engineered stone.'
    )
  );
  const spec = d1Spec();
  delete spec.finishes;
  const q = buildPlannerPrompt(d1Ctx({ designSpec: spec, doorColor: 'oak', doorFinish: 'satin' }));
  assert.ok(q.includes('MATERIALS: fronts oak satin, the same on every door and drawer.'));
});

test('손잡이 규칙은 지금 문장 그대로, SITE·WALL TILE 은 설치 프롬프트와 같은 문단', () => {
  const ctx = d1Ctx({
    site: 'construction',
    siteNotes: 'bare cement, debris',
    tile: { present: true, lightNeutral: false, description: 'dark brown glossy' },
  });
  const p = buildPlannerPrompt(ctx);
  assert.ok(
    p.includes(
      'HANDLES: none. Every door and drawer is a flat handleless front; lower doors open by reaching behind the door edge. No bar handles, knobs, chrome hardware or push-to-open buttons.'
    )
  );
  const install = buildInstallPrompt({ ...ctx, style: 'modern-minimal', refCount: 0, waterPct: 30, exhaustPct: 70 });
  const site = install.match(/\nSITE: [^\n]*/)[0];
  const tile = install.match(/\nWALL TILE: [^\n]*/)[0];
  assert.ok(p.includes(site), 'SITE 문단이 같다');
  assert.ok(p.includes(tile), 'WALL TILE 문단이 같다');
});

test('DO NOT — 닫힌 목록·편집 구역이 말한 것은 되풀이하지 않는다', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.ok(
    p.includes(
      'DO NOT: change how many doors or drawers any unit has; add a dishwasher, refrigerator, oven, cooktop or hood that is not listed; add handles or knobs; open any door or drawer; paste IMAGE B or IMAGE C into the photo; add text, labels or watermarks.'
    )
  );
  assert.doesNotMatch(p, /change the camera/);
});

test('9) FINAL SELF-CHECK 가 맨 끝 — 줄마다 유닛·도어·서랍, 빈 구역 수, 다른 붙박이 없음', () => {
  const p = buildPlannerPrompt(d1Ctx({ designSpec: d1Full() }));
  assert.match(
    p,
    /\n\nOUTPUT: one photorealistic photograph of the finished room, 16:9\.\n\nFINAL SELF-CHECK before you answer: base row 3 units, 5 doors, 0 drawers; wall row 2 units, 4 doors; 4 empty zones left empty; no other built-in unit anywhere\.$/
  );
  const t = buildPlannerPrompt(d1Ctx({ designSpec: tallSpec() }));
  assert.ok(
    t.endsWith(
      'FINAL SELF-CHECK before you answer: base row 3 units + 1 appliance opening, 1 door, 4 drawers; tall row 1 appliance opening, 0 doors, 0 drawers; 1 empty zone left empty; no other built-in unit anywhere.'
    )
  );
  assert.doesNotMatch(t, /0 units/);
});

test('OUTPUT 에 비율이 들어가고, 허용값 밖이면 16:9', () => {
  assert.match(buildPlannerPrompt(d1Ctx()), /\n\nOUTPUT: one photorealistic photograph of the finished room, 16:9\.\n\n/);
  assert.match(buildPlannerPrompt(d1Ctx({ aspect: '4:3' })), /finished room, 4:3\.\n/);
  assert.match(buildPlannerPrompt(d1Ctx({ aspect: '21:9' })), /finished room, 16:9\.\n/);
  assert.deepEqual(PLANNER_ASPECTS, ['16:9', '4:3', '3:4', '1:1', '9:16']);
  assert.equal(resolvePlannerAspect(undefined), '16:9');
  assert.equal(resolvePlannerAspect('9:16'), '9:16');
});

test('구간이 없는 요약도 터지지 않는다 — IMAGE B 를 그대로 따르라고만', () => {
  const spec = normalizeDesignSpec({ finishes: { door: { nameEn: 'walnut woodgrain' } } }, 'sink');
  const p = buildPlannerPrompt(d1Ctx({ designSpec: spec }));
  assert.ok(p.includes('FIXED GEOMETRY: build exactly the cabinets IMAGE B shows'));
  assert.ok(p.includes('CLOSED LIST: the units IMAGE B shows are the only built-in units in the result.'));
  assert.ok(p.includes('MATERIALS: fronts walnut woodgrain'));
  assert.ok(p.endsWith('FINAL SELF-CHECK before you answer: the same units, doors and drawers as IMAGE B; no other built-in unit anywhere.'));
});

test('같은 내용을 두 번 말하지 않는다 — 한 문장이 두 번 나오지 않고, 길이도 v2 보다 크게 늘지 않는다', () => {
  const p = buildPlannerPrompt(d1Ctx({ designSpec: d1Full() }));
  const sentences = p.split(/(?<=\.)\s+/).filter((s) => s.length > 30);
  assert.equal(new Set(sentences).size, sentences.length);
  assert.ok(p.length < 4200, `length ${p.length}`);
});

// ─── 옛 경로 불변 ───

test('옛 설치·검사 프롬프트는 fixture 와 바이트 그대로다 (플래너 코드가 새지 않는다)', () => {
  const BASE = {
    wallW: 3000, wallH: 2400, waterPct: 30, exhaustPct: 70, style: 'modern-minimal',
    doorColor: 'white', doorFinish: 'matte', refCount: 0, fridgeBrand: 'Samsung', fridgePosition: 'left',
  };
  for (const category of Object.keys(CATEGORIES)) {
    assert.equal(buildInstallPrompt({ ...BASE, category }), baseline.install[category], `install(${category})`);
    const qc = buildQcPrompt({ ...BASE, category });
    assert.equal(qc, baseline.qc[category], `qc(${category})`);
    assert.doesNotMatch(qc, /existing_left|pasted_reference/);
  }
});

// ─── 검사 코드 ───

test('플래너 모드 검사는 existing_left·pasted_reference 를 더하고, 공통·layout 코드는 그대로', () => {
  const p = buildQcPrompt({ ...d1Ctx(), planner: true });
  assert.match(p, /\n- existing_left: old furniture that is not part of the new design/);
  assert.match(p, /\n- pasted_reference: part of the image looks like a flat design render pasted onto the photo/);
  for (const code of QC_ISSUE_CODES) assert.ok(p.includes(`- ${code}:`), code);
  assert.ok(p.includes('- layout_mismatch:'));
  assert.doesNotMatch(p, /flat_mockup/);
  // planner 가 아니면 같은 ctx 에서도 안 나온다
  assert.doesNotMatch(buildQcPrompt(d1Ctx()), /existing_left|pasted_reference/);
});

test('플래너 모드 검사의 gap_to_ceiling 은 도면이 둔 천장 틈을 기준으로 받는다 (플래너 모드에서만)', () => {
  const GAP = '- gap_to_ceiling: a clear gap between the top of the tall/upper units and the ceiling';
  const p = buildQcPrompt({ ...d1Ctx({ designSpec: d1Full() }), planner: true });
  assert.ok(
    p.includes(
      `${GAP} — but the design itself leaves 170 mm above the wall row (top at 2230 mm, ceiling at 2400 mm), so a gap of about that size is intended; report it only when the gap is clearly larger\n`
    )
  );
  // 같은 도면이라도 플래너가 아니면 옛 줄 그대로
  assert.ok(buildQcPrompt(d1Ctx({ designSpec: d1Full() })).includes(`${GAP}\n`));
  // 높이 기준이 없거나 천장까지 닿으면 옛 줄 그대로
  assert.ok(buildQcPrompt({ ...d1Ctx(), planner: true }).includes(`${GAP}\n`));
  assert.ok(buildQcPrompt({ ...d2Ctx({ designSpec: d2Spec({ ceilingMm: 2310 }) }), planner: true }).includes(`${GAP}\n`));
});

test('parseQc 는 existing_left·pasted_reference 를 알아듣는다', () => {
  assert.deepEqual(parseQc('{"ok":false,"issues":["existing_left","pasted_reference","nope"],"note":"old hood left"}'), {
    ok: false,
    issues: ['existing_left', 'pasted_reference'],
    note: 'old hood left',
  });
  assert.ok(ALL_QC_ISSUE_CODES.includes('existing_left'));
  assert.ok(ALL_QC_ISSUE_CODES.includes('pasted_reference'));
  // 공통 코드 목록(QC_ISSUE_CODES)은 늘지 않는다 — 옛 검사 프롬프트가 그대로인 이유
  assert.ok(!QC_ISSUE_CODES.includes('existing_left'));
  assert.ok(PLANNER_QC_FIXES.existing_left.length > 40 && PLANNER_QC_FIXES.pasted_reference.length > 40);
});
