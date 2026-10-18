/**
 * 2026-10-19: 후드 칸 — 상부장 사이에 노출된 후드를 줄 안의 칸(H1)으로 말한다.
 * 계약: docs/02-design/features/design-spec-prompt.md "후드 칸".
 *
 * 실측 (2026-10-19 GPT): 하부 800·600·800, 상부 U1 800(x0) | 후드 600(x800) | U2 800(x1400).
 * 패널은 상부 modules 를 [800, 800] 으로만 보냈고, 워커는 줄을 왼쪽부터 이어 놓아 U2 를 x800 에 두었다 —
 * 후드(가운데 1100)가 U2 에 붙어 "slim concealed hood under it" 이 되었고, GPT 는 상부장을 빈칸 없이 이어 붙이고
 * 슬림 후드를 오른쪽 장 밑에 넣었다.
 *
 * 고정하는 것:
 *   1) 후드 칸 { kind:'appliance', label:'후드' } 은 줄 번호 대신 H1 — U1 | H1 | U2, 줄 안 위치·비율에 들어간다
 *   2) 후드 칸 구절: 장이 아니다 · 노출 후드(굴뚝·캐노피) · 덕트 커버 · IMAGE B 의 스테인리스 후드
 *   3) 쿡탑이 도면에 없으면 후드 칸 밑 하부장에 쿡탑 — DO NOT 에서 cooktop 을 빼고, 싱크가 걸린 장에는 두지 않는다
 *   4) CLOSED LIST · 자체 점검 — 후드 칸은 유닛이 아니다
 *   5) 검사 LAYOUT 요약 · 설치 FURNITURE — "range hood gap (no cabinet)"
 *   6) 역판독 — 판독 계획의 H1 은 seen 'hood', 후드 칸에 장을 지으면 hood 0 · ok 아님, 상부장 목록(uppers)에 후드는 없다
 *   7) 옛 모양(후드 칸 없음)은 그대로 — 내장형 후드는 그 장에 붙고 쿡탑을 지어내지 않는다
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDesignSpecBlock, buildPlannerPrompt, designSpecDigest, normalizeDesignSpec } from '../src/prompts.js';
import { compareLayoutToSpec } from '../src/verify.js';
import { buildPlannerReadPrompt, normalizePlannerRead, plannerReadPlan, PLANNER_READ_SEEN } from '../src/layout.js';

const two = (w) => ({ widthMm: w, kind: 'door', doorCount: 2, drawerCount: 0, label: '양문' });
const HOOD = { widthMm: 600, kind: 'appliance', doorCount: 0, drawerCount: 0, label: '후드' };

/** 시드 evalh1 — 패널이 후드 칸을 넣어 보내는 모양 */
function hoodRaw({ cooktop = false, hoodCell = true } = {}) {
  return {
    category: 'sink',
    wallRunMm: 2200,
    sections: {
      lower: { widthMm: 2200, heightMm: 870, depthMm: 650, fromLeftMm: 0, modules: [two(800), two(600), two(800)], fromFloorMm: 0 },
      upper: {
        widthMm: 2200, heightMm: 780, depthMm: 320, fromLeftMm: 0,
        modules: hoodCell ? [two(800), HOOD, two(800)] : [two(800), two(800)],
        fromFloorMm: 1520,
      },
    },
    appliances: [
      { kind: 'hood', fromLeftMm: 800, widthMm: 600 },
      { kind: 'sink', fromLeftMm: 1500, widthMm: 600 },
      ...(cooktop ? [{ kind: 'cooktop', fromLeftMm: 800, widthMm: 600 }] : []),
    ],
    finishes: {},
    layout: { shape: 'straight', walls: 1 },
    ceilingMm: 2300,
  };
}
const spec = (o) => normalizeDesignSpec(hoodRaw(o), 'sink');
const prompt = (o) =>
  buildPlannerPrompt({ category: 'sink', designSpec: spec(o), wallW: 3000, wallH: 2400, confidence: 'high', massing: true, labeledElevation: true });

test('후드 칸: U1 | H1 | U2 — 줄 번호를 받지 않고, 줄 안 위치·폭 비율에 든다', () => {
  const p = prompt();
  assert.match(p, /\n {4}U1 {3}800 mm {2}2-door cabinet\n {4}H1 {3}600 mm {2}range hood — not a cabinet/);
  assert.match(p, /\n {4}U2 {3}800 mm {2}2-door cabinet\n/);
  assert.doesNotMatch(p, /\bU3\b/);
  assert.match(p, /→ widths U1 : H1 : U2 = 1\.5 : 1 : 1\.5/);
  // 상부 줄은 기준 줄(하부)의 L1 왼쪽 끝 ~ L3 오른쪽 끝 (H1 이 빠지면 U2 가 L2 위로 당겨진다)
  assert.match(p, /U1–U2 start above the left end of L1 and end above the right end of L3/);
});

test('후드 칸 구절: 장이 아니다 · 노출 후드 · 덕트 커버 · IMAGE B 의 스테인리스 후드', () => {
  const p = prompt();
  const line = p.split('\n').find((l) => /^ {4}H1 /.test(l));
  assert.match(line, /free of any cabinet, door or shelf/);
  assert.match(line, /slim stainless-steel chimney \(or canopy\) hood/);
  assert.match(line, /duct cover rising to the ceiling/);
  assert.match(line, /IMAGE B shows it as the grey stainless hood/);
  // 옛 내장형 구절("slim concealed hood under it")은 어느 장에도 붙지 않는다
  assert.doesNotMatch(p, /slim concealed hood/);
});

test('쿡탑: 도면에 없으면 후드 칸 밑 하부장(L2)에 두고 DO NOT 에서 cooktop 을 뺀다', () => {
  const p = prompt();
  assert.match(p, /\n {4}L2 {3}600 mm {2}2-door cabinet, flush induction cooktop on the countertop, directly under the hood H1\n/);
  const doNot = p.split('\n').find((l) => l.startsWith('DO NOT:'));
  assert.match(doNot, /add a dishwasher, refrigerator or oven that is not listed/);
  assert.doesNotMatch(doNot, /cooktop|hood/);
  // 싱크가 걸린 L3 에는 쿡탑이 없다
  assert.doesNotMatch(p.split('\n').find((l) => /^ {4}L3 /.test(l)), /cooktop/);
});

test('쿡탑: 도면에 있으면 그 자리 그대로 — 지어내지 않는다', () => {
  const p = prompt({ cooktop: true });
  assert.match(p, /L2 {3}600 mm {2}2-door cabinet, flush induction cooktop on the countertop\n/);
  assert.doesNotMatch(p, /directly under the hood/);
});

test('쿡탑: 후드 칸 밑 하부장에 싱크가 걸렸으면 두지 않는다', () => {
  const raw = hoodRaw();
  raw.appliances = [{ kind: 'hood', fromLeftMm: 800, widthMm: 600 }, { kind: 'sink', fromLeftMm: 850, widthMm: 500 }];
  const p = buildPlannerPrompt({ category: 'sink', designSpec: normalizeDesignSpec(raw, 'sink'), wallW: 3000, wallH: 2400, confidence: 'high' });
  assert.doesNotMatch(p, /cooktop on the countertop/);
  assert.match(p.split('\n').find((l) => l.startsWith('DO NOT:')), /cooktop/);
});

test('CLOSED LIST · 자체 점검: 후드 칸은 유닛이 아니다', () => {
  const p = prompt();
  assert.match(p, /CLOSED LIST: L1–L3 and U1–U2 are the only built-in units in the result\. H1 is a range hood, not a cabinet\. Add nothing else/);
  assert.match(p, /wall row 2 units \+ range hood H1 with no cabinet in its gap, 4 doors;/);
  assert.match(p, /base row 3 units, 6 doors, 0 drawers;/);
});

test('검사 LAYOUT 요약 · 설치 FURNITURE: 후드 칸은 "range hood gap (no cabinet)"', () => {
  const s = spec();
  assert.match(designSpecDigest(s), /upper = 800 mm 2-door cabinet; 600 mm range hood gap \(no cabinet\); 800 mm 2-door cabinet/);
  assert.match(buildDesignSpecBlock(s), /600 mm range hood gap \(no cabinet\) \[후드\]/);
});

test('판독 계획: H1 은 seen hood · 도어 0, 쿡탑은 L2, 목록과 seen 설명에 hood', () => {
  const plan = plannerReadPlan(spec(), 'sink');
  const wall = plan.rows.find((r) => r.row === 'wall');
  assert.deepEqual(wall.units.map((u) => [u.id, u.seen, u.doors, u.startMm, u.endMm]), [
    ['U1', 'cabinet', 2, 0, 800],
    ['H1', 'hood', 0, 800, 1400],
    ['U2', 'cabinet', 2, 1400, 2200],
  ]);
  const base = plan.rows.find((r) => r.row === 'base');
  assert.deepEqual(base.units.map((u) => u.attached), [[], ['cooktop'], ['sink']]);
  assert.ok(PLANNER_READ_SEEN.includes('hood'));
  const p = buildPlannerReadPrompt({ category: 'sink', designSpec: spec(), elevation: 'labeled' });
  assert.match(p, /H1 {3}600 mm {2}range hood in a gap between the wall units, no cabinet/);
  assert.match(p, /open \(open shelving or an empty opening\), hood \(a range hood hanging in the gap with no cabinet\) or missing/);
  assert.doesNotMatch(p, /U3/);
});

/** 판독 JSON — H1 을 무엇으로 읽었나 */
function read(h1) {
  return {
    rows: [
      { row: 'base', units: [['L1', 2], ['L2', 2], ['L3', 2]].map(([id, d]) => ({ id, seen: 'cabinet', doors: d, drawers: 0 })) },
      {
        row: 'wall',
        units: [
          { id: 'U1', seen: 'cabinet', doors: 2, drawers: 0 },
          { id: 'H1', ...h1 },
          { id: 'U2', seen: 'cabinet', doors: 2, drawers: 0 },
        ],
      },
    ],
    extra_units: [],
    layout_shape: 'straight',
    confidence: 0.9,
    notes: [],
  };
}

test('대조: 후드 칸에 후드만 걸렸으면 ok — hood 1, 상부장 목록(uppers)에 후드가 없다', () => {
  const s = spec();
  const layout = normalizePlannerRead(read({ seen: 'hood', doors: 0, drawers: 0 }), { category: 'sink', designSpec: s });
  assert.deepEqual(layout.uppers.map((u) => u.id), ['U1', 'U2']);
  const v = compareLayoutToSpec(layout, s, 'sink');
  assert.equal(v.parts.hood, 1);
  assert.equal(v.ok, true);
  assert.equal(v.read.upperDoors, 4);
});

test('대조: 후드 칸에 장을 지었으면 hood 0 · ok 아님 · 상부장 도어 수도 어긋난다', () => {
  const s = spec();
  const layout = normalizePlannerRead(read({ seen: 'cabinet', doors: 2, drawers: 0 }), { category: 'sink', designSpec: s });
  assert.deepEqual(layout.uppers.map((u) => u.id), ['U1', 'H1', 'U2']);
  const v = compareLayoutToSpec(layout, s, 'sink');
  assert.equal(v.parts.hood, 0);
  assert.equal(v.ok, false);
  assert.ok(v.issues.includes('H1: expected hood, read cabinet'));
  assert.ok(v.issues.includes('uppers: expected 4 doors, read 6'));
});

test('대조: 후드가 안 보여도 장이 없으면 후드 칸은 지킨 것 (hood 1, 이슈만)', () => {
  const s = spec();
  const v = compareLayoutToSpec(
    normalizePlannerRead(read({ seen: 'open', doors: 0, drawers: 0 }), { category: 'sink', designSpec: s }),
    s,
    'sink'
  );
  assert.equal(v.parts.hood, 1);
  assert.equal(v.ok, true);
  assert.ok(v.issues.includes('H1: expected hood, read open'));
});

test('옛 모양: 후드 칸이 없으면 예전 그대로 — 후드는 가운데가 걸린 장에 붙고 쿡탑을 지어내지 않는다', () => {
  const p = prompt({ hoodCell: false });
  assert.doesNotMatch(p, /\bH1\b|range hood|directly under the hood/);
  assert.match(p, /U2 {3}800 mm {2}2-door cabinet, slim concealed hood under it/);
  assert.match(p.split('\n').find((l) => l.startsWith('DO NOT:')), /cooktop/);
  const plan = plannerReadPlan(spec({ hoodCell: false }), 'sink');
  assert.deepEqual(plan.rows.flatMap((r) => r.units.map((u) => u.id)), ['L1', 'L2', 'L3', 'U1', 'U2']);
  const rp = buildPlannerReadPrompt({ category: 'sink', designSpec: spec({ hoodCell: false }), elevation: 'labeled' });
  assert.doesNotMatch(rp, /hood \(a range hood/);
});
