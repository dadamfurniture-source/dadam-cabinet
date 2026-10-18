/**
 * 2026-10-19: 쌓인 단 (design_spec sections.*.modules[].tiers) — 키큰장 한 통 · 냉장고장(냉장고 자리 + 위 박스).
 * 계약: docs/02-design/features/design-spec-prompt.md "쌓인 단".
 *
 * 실제 사이트에서 본 실패 (2026-10-19): 키큰장 한 통(같은 x·폭에 세로로 쌓인 단 3개)이
 * "T1 600, T2 600, T3 600 left to right" 로 읽혔고, 냉장고장의 냉장고 자리(아래 빈 공간)는 프롬프트에 없었다.
 *
 * 고정하는 것:
 *   1) normalizeDesignSpec 이 tiers 를 받는다 (자르기·400·빈 배열은 키 없음)
 *   2) FIXED GEOMETRY — 통 하나에 번호 하나, 단 높이를 아래부터 · 냉장고 자리는 비우되 독립형 냉장고는 서 있어도 된다
 *   3) 자체 점검 — 통 기준 (유닛·가전 칸·도어 합)
 *   4) DO NOT — 냉장고 자리가 도면에 있으면 refrigerator 를 막지 않는다
 *   5) 검사 LAYOUT 요약 · 설치 프롬프트 FURNITURE 구절
 *   6) 역판독 기대값 — 통 하나 = 세그먼트 하나, 도어 합 · 냉장고장 품목의 냉장고 자리는 'fridge'
 *   7) 옛 모양(tiers 없음)은 그대로
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignSpecError,
  buildDesignSpecBlock,
  buildPlannerPrompt,
  buildQcPrompt,
  designSpecDigest,
  normalizeDesignSpec,
} from '../src/prompts.js';
import { expectedFromSpec } from '../src/verify.js';

/**
 * 사이트 도면 (2026-10-19): 하부 1800·상부 1800·싱크 900/700, 키큰장 x1800 w600 높이 2300(단 861·979·460),
 * 냉장고장 x2400 w720 → 양 끝 EP 20 을 뺀 680 통 — 냉장고 자리 1885(1870 + 위 간격 15) + 위 박스 415(2도어).
 */
function siteRaw(category = 'fridge') {
  return {
    category,
    wallRunMm: 3120,
    sections: {
      lower: {
        widthMm: 1800, heightMm: 870, depthMm: 650, fromLeftMm: 0,
        modules: [
          { widthMm: 900, kind: 'drawer', doorCount: 0, drawerCount: 3, label: '서랍 3단' },
          { widthMm: 900, kind: 'door', doorCount: 2, drawerCount: 0, label: '양문' },
        ],
      },
      upper: {
        widthMm: 1800, heightMm: 780, depthMm: 320, fromLeftMm: 0,
        modules: [
          { widthMm: 900, kind: 'door', doorCount: 2, drawerCount: 0, label: '양문' },
          { widthMm: 900, kind: 'door', doorCount: 2, drawerCount: 0, label: '양문' },
        ],
      },
      tall: {
        widthMm: 1300, heightMm: 2300, depthMm: 700, fromLeftMm: 1800,
        modules: [
          {
            widthMm: 600, kind: 'door', doorCount: 3, drawerCount: 0, label: '키큰장 3단',
            tiers: [
              { heightMm: 861, kind: 'door', doorCount: 1, drawerCount: 0, label: '하부장' },
              { heightMm: 979, kind: 'door', doorCount: 1, drawerCount: 0, label: '중간장' },
              { heightMm: 460, kind: 'door', doorCount: 1, drawerCount: 0, label: '상부장' },
            ],
          },
          {
            widthMm: 680, kind: 'appliance', doorCount: 2, drawerCount: 0, label: '냉장고장',
            tiers: [
              { heightMm: 1885, kind: 'appliance', doorCount: 0, drawerCount: 0, label: '냉장고' },
              { heightMm: 415, kind: 'door', doorCount: 2, drawerCount: 0, label: '상부장' },
            ],
          },
        ],
      },
    },
    appliances: [
      { kind: 'sink', fromLeftMm: 900, widthMm: 700 },
      { kind: 'fridge', fromLeftMm: 2420, widthMm: 680 },
    ],
  };
}
const siteSpec = (category = 'fridge') => normalizeDesignSpec(siteRaw(category), category);
const ctx = (extra = {}) => ({
  category: 'fridge',
  wallW: 3600,
  wallH: 2300,
  confidence: 'medium',
  designSpec: siteSpec(),
  aspect: '16:9',
  ...extra,
});

/** 같은 도면의 옛 모양 — 사이트가 실제로 보낸 것 (단 3개가 따로, 냉장고장은 2도어 장) */
function oldRaw() {
  const r = siteRaw();
  r.sections.tall.modules = [
    { widthMm: 600, kind: 'door', doorCount: 1, drawerCount: 0, label: '도어' },
    { widthMm: 600, kind: 'door', doorCount: 1, drawerCount: 0, label: '도어' },
    { widthMm: 600, kind: 'door', doorCount: 1, drawerCount: 0, label: '도어' },
    { widthMm: 680, kind: 'door', doorCount: 2, drawerCount: 0, label: '양문' },
  ];
  r.appliances = [{ kind: 'sink', fromLeftMm: 900, widthMm: 700 }];
  return r;
}

// ─── 1) 계약 ───

test('normalizeDesignSpec 이 tiers 를 아래부터 그대로 받는다', () => {
  const s = siteSpec();
  assert.deepEqual(s.sections.tall.modules[0].tiers, [
    { kind: 'door', heightMm: 861, doorCount: 1, drawerCount: 0, label: '하부장' },
    { kind: 'door', heightMm: 979, doorCount: 1, drawerCount: 0, label: '중간장' },
    { kind: 'door', heightMm: 460, doorCount: 1, drawerCount: 0, label: '상부장' },
  ]);
  assert.deepEqual(s.sections.tall.modules[1].tiers[0], {
    kind: 'appliance', heightMm: 1885, doorCount: 0, drawerCount: 0, label: '냉장고',
  });
});

test('tiers — 자르고(높이 50–3600, 개수 8, 수 0–12) · 모르는 kind 는 door · 객체가 아닌 단은 버림 · 빈 배열이면 키 없음', () => {
  const raw = {
    sections: {
      tall: {
        modules: [
          {
            widthMm: 600,
            tiers: [
              { heightMm: 9999, kind: 'oven', doorCount: 99 },
              'x', null, [1],
              { heightMm: 10 },
              ...Array.from({ length: 10 }, () => ({ heightMm: 300, kind: 'drawer', drawerCount: 2 })),
            ],
          },
          { widthMm: 600, tiers: [] },
          { widthMm: 600, tiers: 'nope' },
        ],
      },
    },
  };
  const m = normalizeDesignSpec(raw, 'storage').sections.tall.modules;
  assert.deepEqual(m[0].tiers[0], { kind: 'door', heightMm: 3600, doorCount: 12 });
  assert.deepEqual(m[0].tiers[1], { kind: 'door', heightMm: 50 });
  // 8개를 앞(아래)부터 자른 뒤 쓸 수 없는 단을 버린다 → 'x'·null·[1] 셋이 빠져 5개
  assert.equal(m[0].tiers.length, 5);
  assert.equal('tiers' in m[1], false);
  assert.equal('tiers' in m[2], false);
});

test('tiers 안의 숫자 자리에 숫자가 아니면 400 — 필드 이름이 메시지에', () => {
  assert.throws(
    () => normalizeDesignSpec({ sections: { tall: { modules: [{ tiers: [{ heightMm: 'abc' }] }] } } }, 'storage'),
    (e) => e instanceof DesignSpecError && /sections\.tall\.modules\[\]\.tiers\[\]\.heightMm/.test(e.message)
  );
});

// ─── 2) FIXED GEOMETRY ───

test('키큰장 한 통 = T1 하나 — 단 높이를 아래부터 말한다 (가로로 나란한 유닛이 아니다)', () => {
  const p = buildPlannerPrompt(ctx());
  assert.match(p, /\n {4}T1 {3}600 mm {2}tall column — 3 stacked doors \(bottom 861 mm, middle 979 mm, top 460 mm\)\n/);
  assert.ok(!/\bT3\b/.test(p), 'T3 가 없다 — 통은 둘');
});

test('냉장고장 = T2 하나 — 냉장고 자리(바닥~1885 비움, 독립형 냉장고는 서 있어도 된다) + 위 2도어 박스', () => {
  const p = buildPlannerPrompt(ctx());
  assert.ok(
    p.includes(
      '    T2   680 mm  refrigerator opening (keep it open from the floor up to 1885 mm, with no cabinet, shelf or panel inside; ' +
        'a free-standing refrigerator may stand there — keep the one IMAGE A shows, do not invent a built-in one) ' +
        'with a 2-door cabinet above (415 mm high)\n'
    )
  );
  // 줄 머리·닫힌 목록·비율은 통 기준
  assert.ok(p.includes('  TALL ROW (2300 mm high, 1300 mm long) — T1–T2 start at the right end of L2 and end 1280 mm right of the base row:'));
  assert.ok(p.includes('CLOSED LIST: L1–L2, U1–U2 and T1–T2 are the only built-in units in the result.'));
  assert.ok(p.includes('    → widths T1 : T2 = 1 : 1\n'));
});

test('단이 섞인 통 · 여러 단 박스 · 높이를 모르는 단', () => {
  const spec = normalizeDesignSpec(
    {
      sections: {
        tall: {
          fromLeftMm: 0,
          modules: [
            {
              widthMm: 900, kind: 'drawer', doorCount: 4, drawerCount: 3,
              tiers: [
                { heightMm: 700, kind: 'drawer', drawerCount: 3 },
                { heightMm: 1100, kind: 'door', doorCount: 2 },
                { heightMm: 500, kind: 'door', doorCount: 2 },
              ],
            },
            {
              widthMm: 700, kind: 'appliance', label: '냉장고장',
              tiers: [{ kind: 'appliance', label: '냉장고' }, { kind: 'door', doorCount: 1 }, { kind: 'open' }],
            },
            { widthMm: 600, kind: 'door', tiers: [{ kind: 'door' }, { kind: 'door' }] },
          ],
        },
      },
    },
    'storage'
  );
  const p = buildPlannerPrompt({ category: 'storage', designSpec: spec, wallW: 0, wallH: 0 });
  assert.ok(p.includes('T1   900 mm  tall column — 3 stacked sections, bottom to top: 3-drawer stack 700 mm, 2-door cabinet 1100 mm, 2-door cabinet 500 mm\n'));
  assert.ok(p.includes('T2   700 mm  refrigerator opening (keep it open from the floor, with no cabinet, shelf or panel inside; ' +
    'a free-standing refrigerator may stand there — keep the one IMAGE A shows, do not invent a built-in one) ' +
    'with 2 stacked sections, bottom to top: single-door cabinet, open shelving, no door above\n'));
  assert.ok(p.includes('T3   600 mm  tall column — 2 stacked doors\n'));
  assert.ok(p.includes('tall row 2 units + 1 appliance opening, 7 doors, 3 drawers'));
});

// ─── 3) 자체 점검 ───

test('자체 점검은 통 기준 — 키큰장 1 유닛(3도어) + 냉장고 자리 1(위 2도어)', () => {
  const p = buildPlannerPrompt(ctx());
  assert.ok(
    p.endsWith(
      'FINAL SELF-CHECK before you answer: base row 2 units, 2 doors, 3 drawers; wall row 2 units, 4 doors; ' +
        'tall row 1 unit + 1 appliance opening, 5 doors, 0 drawers; ' +
        p.match(/(\d+ empty zones? left empty; )?no other built-in unit anywhere\.$/)[0]
    )
  );
});

// ─── 4) DO NOT ───

test('냉장고 자리가 도면에 있으면 DO NOT 이 refrigerator 를 막지 않는다 (가전 목록이 없어도 단 라벨로)', () => {
  const p = buildPlannerPrompt(ctx());
  const doNot = p.match(/\nDO NOT: [^\n]*/)[0];
  assert.ok(!doNot.includes('refrigerator'), doNot);
  assert.ok(doNot.includes('oven'));

  const raw = siteRaw();
  raw.appliances = [];
  raw.sections.tall.modules[1].label = '위장';   // 모듈 라벨이 아니라 단 라벨로 안다
  const p2 = buildPlannerPrompt(ctx({ designSpec: normalizeDesignSpec(raw, 'fridge') }));
  assert.ok(!p2.match(/\nDO NOT: [^\n]*/)[0].includes('refrigerator'));
  assert.ok(p2.includes('T2   680 mm  refrigerator opening (keep it open from the floor up to 1885 mm'));
});

test('키큰장만 있으면(냉장고 자리 없음) DO NOT 은 예전처럼 refrigerator 를 막는다', () => {
  const raw = siteRaw('sink');
  raw.sections.tall.modules.pop();
  raw.appliances = raw.appliances.filter((a) => a.kind !== 'fridge');
  const p = buildPlannerPrompt(ctx({ category: 'sink', designSpec: normalizeDesignSpec(raw, 'sink') }));
  assert.ok(p.match(/\nDO NOT: [^\n]*/)[0].includes('refrigerator'));
});

// ─── 5) 검사 요약 · 설치 프롬프트 ───

test('검사 LAYOUT 요약과 설치 프롬프트 FURNITURE 도 통 하나로 말한다', () => {
  const s = siteSpec();
  assert.equal(
    designSpecDigest(s).split(' | ')[2],
    'tall = 600 mm column of 3 stacked doors; 680 mm refrigerator opening with a 2-door cabinet above'
  );
  assert.ok(buildQcPrompt({ category: 'fridge', designSpec: s, planner: true }).includes(
    'tall = 600 mm column of 3 stacked doors; 680 mm refrigerator opening with a 2-door cabinet above'
  ));
  assert.ok(buildDesignSpecBlock(s).includes(
    'Left to right: 600 mm column of 3 stacked doors [키큰장 3단]; 680 mm refrigerator opening with a 2-door cabinet above [냉장고장].'
  ));
});

// ─── 6) 역판독 기대값 ───

test('역판독 기대값 — 통 하나 = 세그먼트 하나, 도어는 단의 합, 냉장고장 품목의 냉장고 자리는 fridge', () => {
  const want = expectedFromSpec(siteSpec(), 'fridge');
  assert.deepEqual(want.floorKinds, ['lower', 'lower', 'tall', 'fridge']);
  assert.equal(want.floorDoors, 2 + 3);    // 하부 2 + 키큰장 3 (냉장고 위 박스는 가전 칸과 함께 세지 않는다)
  assert.equal(want.floorDrawers, 3);
  assert.equal(want.upperDoors, 4);
  assert.deepEqual(want.appliances.map((a) => a.kind), ['sink', 'refrigerator']);
  // 싱크대 품목이면 예전 가전 칸과 같은 이름
  assert.deepEqual(expectedFromSpec(siteSpec('sink'), 'sink').floorKinds, ['lower', 'lower', 'tall', 'refrigerator']);
});

// ─── 7) 옛 모양 ───

test('옛 모양(tiers 없음)은 예전 그대로 — 나란한 T1·T2·T3·T4, 기대값도 예전 값', () => {
  const s = normalizeDesignSpec(oldRaw(), 'fridge');
  s.sections.tall.modules.forEach((m) => assert.equal('tiers' in m, false));
  const p = buildPlannerPrompt(ctx({ designSpec: s }));
  assert.ok(p.includes('    T1   600 mm  single-door cabinet\n'));
  assert.ok(p.includes('    T4   680 mm  2-door cabinet\n'));
  assert.ok(p.includes('tall row 4 units, 5 doors, 0 drawers'));
  assert.ok(p.match(/\nDO NOT: [^\n]*/)[0].includes('refrigerator'));
  const want = expectedFromSpec(s, 'fridge');
  assert.deepEqual(want.floorKinds, ['lower', 'lower', 'tall', 'tall', 'tall', 'tall']);
  assert.equal(want.floorDoors, 2 + 5);
});
