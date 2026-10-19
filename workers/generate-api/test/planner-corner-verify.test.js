/**
 * 2026-10-19: ㄱ자 역판독 — 가려진 모서리 장 · 비스듬히 보이는 꺾인 벽 장 (layout.js plannerReadPlan · verify.js).
 *
 * 실측 (2026-10-19 GPT, 도면 = planner-walls.test.js cornerRaw 와 같다):
 *   주벽 하부 L1 650(1, 모서리 — 꺾인 L5 뒤에 가려짐)·L2 436(1)·L3 842(2)·L4 421(1), 상부 U1 960(2)·U2 960(2)·U3 480(1),
 *   왼쪽 벽 꺾임 L5 936(2, corner:'main').
 *   결과 두 장은 사람이 보면 도면대로인데, 판독이 정면 장과 같은 기준으로 세서 둘 다 3.71/4 · ok=false → internal_only:
 *     50c2de6f  counts 7 → 5, L3 2 → 1, L5 2 → 1
 *     5bd85527  counts 7 → 5, L5 2 → 0
 *
 * 고정하는 것:
 *   1) 판독 계획 — 모서리 장(corner 'main' 이면 주벽 모서리 끝 장, 'return' 이면 꺾인 벽 첫 장)에 hiddenBehind
 *      (prompts.js plannerCornerUnit 과 같은 장)
 *   2) 프롬프트 — 모서리 장은 "hidden 으로 답해도 된다", 꺾인 벽 줄은 "비스듬히 — 보이는 면의 틈을 세라", seen 에 hidden
 *   3) 대조 — 가려진 모서리 장은 문 수 대조에서 뺀다, 꺾인 벽 장은 보였으면(seen 일치) 문 수 차이를 이슈로만
 *   4) 위 두 장의 판독 응답을 본뜬 모의 답 → ok, 진짜 틀림(꺾인 벽에 장 없음) → ok 아님
 *   5) 일자·walls 없는 도면은 그대로
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesignSpec } from '../src/prompts.js';
import { compareLayoutToSpec } from '../src/verify.js';
import { PLANNER_READ_SCHEMA, PLANNER_READ_SEEN, buildPlannerReadPrompt, normalizePlannerRead, plannerReadPlan } from '../src/layout.js';

const one = (w, label = '도어') => ({ widthMm: w, kind: 'door', doorCount: 1, drawerCount: 0, label });
const two = (w) => ({ widthMm: w, kind: 'door', doorCount: 2, drawerCount: 0, label: '양문' });

function cornerRaw(corner = 'main') {
  return {
    category: 'sink',
    wallRunMm: 2400,
    sections: {
      lower: { widthMm: 2349, heightMm: 870, depthMm: 550, fromLeftMm: 50, modules: [one(650, '멍장'), one(436), two(842), one(421)], fromFloorMm: 0 },
      upper: { widthMm: 2400, heightMm: 780, depthMm: 290, fromLeftMm: 0, modules: [two(960), two(960), one(480)], fromFloorMm: 1520 },
    },
    appliances: [{ kind: 'sink', fromLeftMm: 1300, widthMm: 700 }],
    finishes: {},
    notes: 'ㄱ자 배치 — 왼쪽 벽으로 꺾인 하부 1개',
    layout: { shape: 'corner', walls: 2 },
    ceilingMm: 2300,
    walls: [
      {
        side: 'left', corner, runMm: 1574, cornerEdge: 'left',
        sections: { lower: { widthMm: 936, heightMm: 870, depthMm: 550, fromCornerMm: 638, fromFloorMm: 0, modules: [two(936)] } },
      },
    ],
  };
}
const spec = (corner) => normalizeDesignSpec(cornerRaw(corner), 'sink');
const u = (id, doors, seen = 'cabinet') => ({ id, seen, doors, drawers: 0 });
/** 판독 응답 — base [L1..L4], wall [U1..U3], 꺾인 base [L5] */
function read(base, upper, ret, shape = 'corner') {
  return {
    rows: [
      { row: 'base', units: base },
      { row: 'wall', units: upper },
      { row: 'base', units: ret },
    ],
    extra_units: [],
    layout_shape: shape,
    confidence: 0.8,
    notes: [],
  };
}
const UPPERS = [u('U1', 2), u('U2', 2), u('U3', 1)];
const verify = (raw, s = spec()) => {
  const l = normalizePlannerRead(raw, { category: 'sink', designSpec: s, elevation: 'labeled', returnElevations: [{ side: 'left', labeled: true }] });
  return { l, v: compareLayoutToSpec(l, s, 'sink') };
};

test('판독 계획: 모서리 장 — corner main 이면 주벽 모서리 끝 L1 이 L5 뒤에, return 이면 L5 가 L1 뒤에, open·walls 없음은 없다', () => {
  const main = plannerReadPlan(spec('main'), 'sink');
  const ids = (p) => p.rows.flatMap((r) => r.units.filter((x) => x.hiddenBehind).map((x) => `${x.id}<${x.hiddenBehind}`));
  assert.deepEqual(ids(main), ['L1<L5']);
  assert.deepEqual(ids(plannerReadPlan(spec('return'), 'sink')), ['L5<L1']);
  assert.deepEqual(ids(plannerReadPlan(spec('open'), 'sink')), []);
  const raw = cornerRaw();
  delete raw.walls;
  assert.deepEqual(ids(plannerReadPlan(normalizeDesignSpec(raw, 'sink'), 'sink')), []);
  // 오른쪽 벽으로 꺾이면 주벽 오른쪽 끝(L4)이 모서리 장
  const r = cornerRaw();
  r.walls[0].side = 'right';
  assert.deepEqual(ids(plannerReadPlan(normalizeDesignSpec(r, 'sink'), 'sink')), ['L4<L5']);
});

test('프롬프트·스키마: 모서리 장은 hidden 으로 답해도 되고, 꺾인 벽 줄은 비스듬히 보이는 면의 틈을 센다', () => {
  assert.ok(PLANNER_READ_SEEN.includes('hidden'));
  const enumOf = PLANNER_READ_SCHEMA.properties.rows.items.properties.units.items.properties.seen.enum;
  assert.ok(enumOf.includes('hidden'));
  const p = buildPlannerReadPrompt({ category: 'sink', designSpec: spec(), elevation: 'labeled', returnElevations: [{ side: 'left', labeled: true }] });
  assert.match(p, /\n {4}L1 {3}650 mm {2}1 door — corner unit: L5 stands in front of it, so its fronts may be hidden\. Report seen = hidden if you cannot see its fronts\n/);
  assert.match(p, /BASE ROW — LEFT WALL, the return \(from the corner outward\) \(row "base"\):\n {4}L5 {3}936 mm {2}2 doors\n {4}\(seen at an angle: count the door gaps on the visible face of each unit\)\n/);
  assert.match(p, /or missing \(no unit there\)\. hidden = a corner unit whose fronts are covered by the run in front of it — use it only for a unit marked as a corner unit\./);
  // corner return — L5 가 모서리 장, 비스듬 문장은 L5 다음 장이 없으므로 그래도 줄에 붙는다
  const q = buildPlannerReadPrompt({ category: 'sink', designSpec: spec('return'), elevation: 'labeled' });
  assert.match(q, /\n {4}L5 {3}936 mm {2}2 doors — corner unit: L1 stands in front of it, so its fronts may be hidden\./);
});

test('50c2de6f 모의 답 (판독 그대로: L1 1·L2 1·L3 1·L4 1·L5 1) → ok — L1 은 세지 않고 L5 는 이슈로만', () => {
  const { v } = verify(read([u('L1', 1), u('L2', 1), u('L3', 1), u('L4', 1)], UPPERS, [u('L5', 1)]));
  assert.equal(v.ok, true);
  assert.equal(v.expected.floorDoors, 6, 'L2 1 + L3 2 + L4 1 + L5 2 (L1 은 뺀다)');
  assert.equal(v.read.floorDoors, 5, 'L2 1 + L3 1 + L4 1 + L5 보였으니 2');
  assert.ok(Math.abs(v.parts.counts - 5 / 6) < 1e-9, '1 − 1/6 (L3 하나 틀림)');
  assert.ok(v.issues.includes('L3: expected 2 doors + 0 drawers, read 1 + 0'), 'L3 는 정면 장 — 그대로 이슈');
  assert.ok(v.issues.includes('L5: expected 2 doors + 0 drawers, read 1 + 0 (seen at an angle on the left wall — not scored)'));
  assert.equal(v.issues.some((s) => s.startsWith('L1:')), false);
});

test('5bd85527 모의 답 (판독 그대로: L1 1·L2 1·L3 2·L4 1·L5 0) → ok, 개수 만점', () => {
  const { v } = verify(read([u('L1', 1), u('L2', 1), u('L3', 2), u('L4', 1)], UPPERS, [u('L5', 0)]));
  assert.equal(v.ok, true);
  assert.equal(v.parts.counts, 1);
  assert.equal(v.score, 4);
  assert.ok(v.issues.includes('L5: expected 2 doors + 0 drawers, read 0 + 0 (seen at an angle on the left wall — not scored)'));
  assert.equal(v.issues.some((s) => s.startsWith('counts:')), false);
});

test('새 질문대로 답하면 (L1 hidden, L5 비스듬히 1) → ok 만점, L1 은 세그먼트에 없다', () => {
  const { l, v } = verify(read([u('L1', 0, 'hidden'), u('L2', 1), u('L3', 2), u('L4', 1)], UPPERS, [u('L5', 1)]));
  assert.equal(l.units[0].seen, 'hidden');
  assert.equal(l.units[0].hiddenBehind, 'L5');
  assert.deepEqual(l.segments.map((s) => s.id), ['L2', 'L3', 'L4', 'L5']);
  assert.equal(v.ok, true);
  assert.equal(v.score, 4);
  assert.deepEqual(v.issues, ['L5: expected 2 doors + 0 drawers, read 1 + 0 (seen at an angle on the left wall — not scored)']);
});

test('진짜 틀림: 꺾인 벽에 장이 없으면 ok 아님 — 판독이 모양을 corner 라 해도 개수에서 막힌다', () => {
  const straight = verify(read([u('L1', 1), u('L2', 1), u('L3', 2), u('L4', 1)], UPPERS, [u('L5', 0, 'missing')], 'straight')).v;
  assert.equal(straight.ok, false);
  assert.equal(straight.parts.shape, 0);
  assert.ok(straight.issues.includes('L5: missing'));
  const corner = verify(read([u('L1', 1), u('L2', 1), u('L3', 2), u('L4', 1)], UPPERS, [u('L5', 0, 'missing')])).v;
  assert.equal(corner.ok, false);
  assert.ok(corner.parts.counts < 0.75);
  // 정면 장을 틀린 것은 그대로 감점 (L3 2 → 0, L2 1 → 0)
  const front = verify(read([u('L1', 1), u('L2', 0), u('L3', 0), u('L4', 1)], UPPERS, [u('L5', 2)])).v;
  assert.equal(front.ok, false);
  // 모서리 아닌 장을 hidden 이라 하면 안 보인 것으로 센다
  const hid = verify(read([u('L1', 1), u('L2', 0, 'hidden'), u('L3', 2), u('L4', 1)], UPPERS, [u('L5', 2)])).v;
  assert.ok(hid.issues.includes('L2: expected cabinet, read hidden'));
  assert.ok(hid.parts.counts < 1);
});

test('상부 6짝 (U3 1 → 2): 상부장 점수는 지금처럼 깎이고 이슈가 남는다 — 상부는 꺾인 벽이 아니라 정면 장', () => {
  const { v } = verify(read([u('L1', 1), u('L2', 1), u('L3', 2), u('L4', 1)], [u('U1', 2), u('U2', 2), u('U3', 2)], [u('L5', 2)]));
  assert.equal(v.parts.uppers, 0.8);
  assert.ok(v.issues.includes('uppers: expected 5 doors, read 6'));
  assert.ok(v.issues.includes('U3: expected 1 doors + 0 drawers, read 2 + 0'));
});

test('corner return: 꺾인 벽 첫 장(L5)이 모서리 장 — hidden 이면 빼고, 주벽 L1 은 정면 장으로 센다', () => {
  const s = spec('return');
  const { v } = verify(read([u('L1', 1), u('L2', 1), u('L3', 2), u('L4', 1)], UPPERS, [u('L5', 0, 'hidden')]), s);
  assert.equal(v.ok, true);
  assert.equal(v.expected.floorDoors, 5);
  assert.equal(v.read.floorDoors, 5);
  const wrong = verify(read([u('L1', 0, 'missing'), u('L2', 1), u('L3', 2), u('L4', 1)], UPPERS, [u('L5', 0, 'hidden')]), s).v;
  assert.ok(wrong.issues.includes('L1: missing'));
  assert.ok(wrong.parts.counts < 1);
});

test('일자 도면은 그대로 — hiddenBehind 없음, 프롬프트에 hidden·angle 문장 없음', () => {
  const D1 = {
    category: 'sink', wallRunMm: 2200, layout: { shape: 'straight' },
    sections: { lower: { fromLeftMm: 0, modules: [two(800), one(400), two(1000)] }, upper: { fromLeftMm: 400, modules: [two(900), two(900)] } },
    appliances: [{ kind: 'sink', fromLeftMm: 1450, widthMm: 700 }],
  };
  const plan = plannerReadPlan(D1, 'sink');
  assert.equal(plan.rows.some((r) => r.units.some((x) => 'hiddenBehind' in x)), false);
  const p = buildPlannerReadPrompt({ category: 'sink', designSpec: D1, elevation: 'labeled' });
  assert.doesNotMatch(p, /hidden|at an angle/);
  const raw = {
    rows: [
      { row: 'base', units: [u('L1', 2), u('L2', 1), u('L3', 1)] },
      { row: 'wall', units: [u('U1', 2), u('U2', 2)] },
    ],
    extra_units: [], layout_shape: 'straight', confidence: 0.9, notes: [],
  };
  const v = compareLayoutToSpec(normalizePlannerRead(raw, { category: 'sink', designSpec: D1 }), D1, 'sink');
  assert.equal(v.parts.counts, 0.8);
  assert.deepEqual(v.issues, ['counts: expected 5 doors + 0 drawers, read 4 + 0', 'L3: expected 2 doors + 0 drawers, read 1 + 0']);
});
