/**
 * 2026-10-20 사장님 결정: 플래너 역판독 대조(verify.js compareLayoutToSpec)의 ok 관문에 상부장 도어 수를 넣는다.
 *
 * 그 전 관문은 순서·바닥 총수·가전·모양·후드 칸뿐이라, 상부장을 5짝 대신 6짝으로 지어도 uppers 0.8 감점·이슈만 남고
 * ok 였다 → internal_only 가 안 붙어 손님에게 나갔다. 실측에서 모델이 가장 자주 틀린 곳이 상부장 덤이었다.
 *
 * 고정하는 것:
 *   1) 상부 도어 총수 ≠ 도면 → ok=false (점수 parts.uppers·score·max 는 예전 그대로) → 잡 마무리에서 internal_only
 *   2) 도면 밖 상부 줄 덤 유닛(extra_units row 'wall') → ok=false. 바닥 줄 덤은 예전처럼 이슈만 (PR #844)
 *   3) 예외는 총수 보정 그대로: 꺾인 벽 상부장(비스듬히 — 보였으면 도면 값, 이슈만) · 가려진 모서리 장(셈에서 뺌) ·
 *      후드 칸(장이 아니라 0짝)
 *   4) 상부장 없는 도면 · 비 플래너(옛 판독) 대조는 그대로
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesignSpec } from '../src/prompts.js';
import { compareLayoutToSpec } from '../src/verify.js';
import { normalizeLayout, normalizePlannerRead } from '../src/layout.js';
import { internalOnlyPatch } from '../src/job.js';

const one = (w) => ({ widthMm: w, kind: 'door', doorCount: 1, drawerCount: 0, label: '도어' });
const two = (w) => ({ widthMm: w, kind: 'door', doorCount: 2, drawerCount: 0, label: '양문' });
const u = (id, doors, seen = 'cabinet') => ({ id, seen, doors, drawers: 0 });

/** 일자 — 하부 L1 800(2)·L2 400(1)·L3 1000(2), 상부 U1 960(2)·U2 960(2)·U3 480(1) = 상부 5짝 */
const STRAIGHT = {
  category: 'sink',
  wallRunMm: 2400,
  layout: { shape: 'straight' },
  sections: {
    lower: { fromLeftMm: 0, modules: [two(800), one(400), two(1000)] },
    upper: { fromLeftMm: 0, modules: [two(960), two(960), one(480)] },
  },
  appliances: [{ kind: 'sink', fromLeftMm: 1450, widthMm: 700 }],
};
const BASE = [u('L1', 2), u('L2', 1), u('L3', 2)];
const read = (upper, { base = BASE, extra = [], shape = 'straight' } = {}) => ({
  rows: [{ row: 'base', units: base }, ...(upper ? [{ row: 'wall', units: upper }] : [])],
  extra_units: extra,
  layout_shape: shape,
  confidence: 0.9,
  notes: [],
});
const verify = (raw, spec = STRAIGHT, ctx = {}) =>
  compareLayoutToSpec(normalizePlannerRead(raw, { category: 'sink', designSpec: spec, elevation: 'labeled', ...ctx }), spec, 'sink');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('정답 (상부 5짝) → ok, 상부장 만점', () => {
  const v = verify(read([u('U1', 2), u('U2', 2), u('U3', 1)]));
  assert.equal(v.ok, true);
  assert.equal(v.parts.uppers, 1);
  assert.equal(v.expected.upperDoors, 5);
  assert.equal(v.read.upperDoors, 5);
  assert.deepEqual(v.issues, []);
});

test('상부 6짝 (도면 5짝) → ok=false · 점수는 예전 그대로 (uppers 0.8) · 사유가 화면 앞 3개 안에', () => {
  const v = verify(read([u('U1', 2), u('U2', 2), u('U3', 2)]));
  assert.equal(v.ok, false);
  assert.equal(v.parts.uppers, 0.8);
  assert.equal(v.max, 4);
  assert.equal(v.score, 3.8);
  assert.ok(v.issues.slice(0, 3).includes('uppers: expected 5 doors, read 6'));
  // 4짝(모자람)도 같다
  assert.equal(verify(read([u('U1', 2), u('U2', 1), u('U3', 1)])).ok, false);
});

test('상부 6짝 → 잡 마무리에서 internal_only (손님에게 나가지 않는다)', async () => {
  const v = verify(read([u('U1', 2), u('U2', 2), u('U3', 2)]));
  globalThis.fetch = async () => new Response(JSON.stringify([{ options: { mode: 'planner' } }]), { headers: { 'Content-Type': 'application/json' } });
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
  const patch = await internalOnlyPatch(env, { id: 'job-1', options: { mode: 'planner' } }, { verify: v });
  assert.equal(patch.options.internal_only, true);
  // 정답이면 키가 없다
  const good = verify(read([u('U1', 2), u('U2', 2), u('U3', 1)]));
  assert.deepEqual(await internalOnlyPatch(env, { id: 'job-1', options: { mode: 'planner' } }, { verify: good }), {});
});

test('상부장을 하나도 못 읽으면(none read) → ok=false', () => {
  const v = verify(read(null));
  assert.equal(v.ok, false);
  assert.equal(v.parts.uppers, 0);
});

test('도면 밖 상부 줄 덤 유닛(냉장고 위 2짝) → ok=false, 상부장 도어 수에는 섞지 않는다, 사유가 모듈 이슈보다 앞', () => {
  const raw = read([u('U1', 2), u('U2', 2), u('U3', 1)], {
    base: [u('L1', 2), u('L2', 1), u('L3', 1)],
    extra: [{ row: 'wall', where: 'above the refrigerator', doors: 2, drawers: 0 }],
  });
  const v = verify(raw);
  assert.equal(v.ok, false);
  assert.equal(v.parts.uppers, 1, '상부 U1~U3 는 5짝 그대로');
  assert.equal(v.read.upperDoors, 5);
  const extra = 'extra: wall unit not in plan (above the refrigerator), 2 doors + 0 drawers';
  assert.ok(v.issues.slice(0, 3).includes(extra));
  assert.ok(v.issues.indexOf(extra) < v.issues.findIndex((s) => s.startsWith('L3:')));
});

test('바닥 줄·other 덤 유닛은 예전처럼 이슈만 — ok 그대로 (PR #844 거짓 경보 근거)', () => {
  const v = verify(
    read([u('U1', 2), u('U2', 2), u('U3', 1)], {
      extra: [
        { row: 'base', where: 'drawer stack at the right end', doors: 0, drawers: 3 },
        { row: 'tall', where: 'pantry at the left', doors: 2, drawers: 0 },
        { row: 'other', where: 'shelf', doors: 0, drawers: 0 },
      ],
    })
  );
  assert.equal(v.ok, true);
  assert.deepEqual(v.issues, [
    'extra: base unit not in plan (drawer stack at the right end), 0 doors + 3 drawers',
    'extra: tall unit not in plan (pantry at the left), 2 doors + 0 drawers',
    'extra: other unit not in plan (shelf), 0 doors + 0 drawers',
  ]);
});

/** ㄱ자 — 주벽 하부 L1 650(1)·L2 436(1)·L3 842(2)·L4 421(1), 상부 U1 960(2)·U2 960(2)·U3 480(1), 왼쪽 벽 하부 L5 936(2)·상부 U4 900(2) */
function cornerSpec(corner = 'main', { returnLower = true } = {}) {
  return normalizeDesignSpec(
    {
      category: 'sink',
      wallRunMm: 2400,
      sections: {
        lower: { widthMm: 2349, heightMm: 870, depthMm: 550, fromLeftMm: 50, modules: [one(650), one(436), two(842), one(421)], fromFloorMm: 0 },
        upper: { widthMm: 2400, heightMm: 780, depthMm: 290, fromLeftMm: 0, modules: [two(960), two(960), one(480)], fromFloorMm: 1520 },
      },
      appliances: [{ kind: 'sink', fromLeftMm: 1300, widthMm: 700 }],
      finishes: {},
      notes: 'ㄱ자 배치',
      layout: { shape: 'corner', walls: 2 },
      ceilingMm: 2300,
      walls: [
        {
          side: 'left',
          corner,
          runMm: 1574,
          cornerEdge: 'left',
          sections: {
            ...(returnLower ? { lower: { widthMm: 936, heightMm: 870, depthMm: 550, fromCornerMm: 638, fromFloorMm: 0, modules: [two(936)] } } : {}),
            upper: { widthMm: 900, heightMm: 780, depthMm: 290, fromCornerMm: 300, fromFloorMm: 1520, modules: [two(900)] },
          },
        },
      ],
    },
    'sink'
  );
}
const cornerRead = (mainUpper, retUpper, { retLower = [u('L5', 2)] } = {}) => ({
  rows: [
    { row: 'base', units: [u('L1', 1), u('L2', 1), u('L3', 2), u('L4', 1)] },
    { row: 'wall', units: mainUpper },
    ...(retLower ? [{ row: 'base', units: retLower }] : []),
    { row: 'wall', units: retUpper },
  ],
  extra_units: [],
  layout_shape: 'corner',
  confidence: 0.8,
  notes: [],
});
const MAIN_UP = [u('U1', 2), u('U2', 2), u('U3', 1)];

test('꺾인 벽 상부장(U4)은 비스듬히 보여 문 수 차이가 이슈로만 — 상부 관문에 걸리지 않는다', () => {
  const s = cornerSpec();
  const ids = normalizePlannerRead(cornerRead(MAIN_UP, [u('U4', 2)]), { category: 'sink', designSpec: s }).units.map((x) => x.id);
  assert.ok(ids.includes('U4'), '꺾인 벽 상부 줄이 U4 로 이어진다');
  const ok = verify(cornerRead(MAIN_UP, [u('U4', 2)]), s);
  assert.equal(ok.ok, true);
  assert.equal(ok.expected.upperDoors, 7);
  const angled = verify(cornerRead(MAIN_UP, [u('U4', 1)]), s);
  assert.equal(angled.ok, true);
  assert.equal(angled.parts.uppers, 1);
  assert.ok(angled.issues.includes('U4: expected 2 doors + 0 drawers, read 1 + 0 (seen at an angle on the left wall — not scored)'));
  // 꺾인 벽 상부장이 아예 없으면(missing) 예전처럼 판독 값 그대로 → 총수가 어긋나 관문에 걸린다
  const gone = verify(cornerRead(MAIN_UP, [u('U4', 0, 'missing')]), s);
  assert.equal(gone.ok, false);
  assert.ok(gone.issues.includes('uppers: expected 7 doors, read 5'));
  // 주벽(정면) 상부장 덤은 꺾인 벽 예외가 아니다
  assert.equal(verify(cornerRead([u('U1', 2), u('U2', 2), u('U3', 2)], [u('U4', 2)]), s).ok, false);
});

test('가려진 모서리 장이 상부장이면 셈에서 뺀다 — hidden·missing·보임 어느 쪽이든 관문에 걸리지 않는다', () => {
  // 꺾인 벽에 상부장만 있고 corner 'return' 이면 꺾인 벽 첫 장(U4)이 주벽 끝 장 뒤에 가려진다 (layout.js plannerReadPlan)
  const s = cornerSpec('return', { returnLower: false });
  const plan = normalizePlannerRead(cornerRead(MAIN_UP, [u('U4', 0, 'hidden')], { retLower: null }), { category: 'sink', designSpec: s });
  assert.ok(plan.units.find((x) => x.id === 'U4').hiddenBehind, 'U4 가 모서리 장');
  for (const seen of [u('U4', 0, 'hidden'), u('U4', 0, 'missing'), u('U4', 2), u('U4', 1)]) {
    const v = verify(cornerRead(MAIN_UP, [seen], { retLower: null }), s);
    assert.equal(v.expected.upperDoors, 5, seen.seen);
    assert.equal(v.read.upperDoors, 5, seen.seen);
    assert.equal(v.ok, true, `${seen.seen} ${seen.doors}`);
  }
});

test('후드 칸(H1)은 장이 아니라 0짝 — 후드만 걸렸으면 ok, 장을 지었으면 막힌다', () => {
  const s = {
    ...STRAIGHT,
    sections: {
      ...STRAIGHT.sections,
      upper: { fromLeftMm: 0, modules: [two(900), { widthMm: 600, kind: 'appliance', label: '후드' }, two(900)] },
    },
  };
  const ids = normalizePlannerRead(read([u('U1', 2), u('H1', 0, 'hood'), u('U2', 2)]), { category: 'sink', designSpec: s }).units.map((x) => x.id);
  assert.deepEqual(ids.filter((x) => /^[UH]/.test(x)), ['U1', 'H1', 'U2']);
  const hood = verify(read([u('U1', 2), u('H1', 0, 'hood'), u('U2', 2)]), s);
  assert.equal(hood.expected.upperDoors, 4);
  assert.equal(hood.ok, true);
  const built = verify(read([u('U1', 2), u('H1', 2), u('U2', 2)]), s);
  assert.equal(built.ok, false);
});

test('상부장 없는 도면 — 도어 수 관문 없음 (예전 그대로 ok). 그 도면에 상부장을 덤으로 지었으면 도면 밖 상부장이라 막힌다', () => {
  const { upper, ...lowerOnly } = STRAIGHT.sections;
  void upper;
  const s = { ...STRAIGHT, sections: lowerOnly };
  const v = verify(read(null), s);
  assert.equal(v.ok, true);
  assert.equal('uppers' in v.parts, false);
  assert.equal(v.expected.upperDoors, null);
  assert.deepEqual(v.issues, []);
  const extra = verify(read(null, { extra: [{ row: 'wall', where: 'above the sink', doors: 2, drawers: 0 }] }), s);
  assert.equal(extra.ok, false);
  assert.equal('uppers' in extra.parts, false, '점수 항목은 그대로');
});

test('비 플래너(옛 판독) 대조는 그대로 — 상부 6짝이어도 ok (uppers 이슈만)', () => {
  const WA = { wallW: 2400, wallH: 2400, waterPct: 50, exhaustPct: 30 };
  const old = normalizeLayout(
    {
      segments: [{ kind: 'lower', start_pct: 0, end_pct: 92, doors: 5, drawers: 0 }],
      uppers_status: 'clear',
      uppers: [
        { kind: 'upper', start_pct: 0, end_pct: 40, doors: 2 },
        { kind: 'upper', start_pct: 40, end_pct: 80, doors: 2 },
        { kind: 'upper', start_pct: 80, end_pct: 100, doors: 2 },
      ],
      appliances: {},
      confidence: { segments: 0.9, uppers: 0.9, appliances: 0.9 },
    },
    { category: 'sink', wallAnalysis: WA, now: 'T' }
  );
  const v = compareLayoutToSpec(old, STRAIGHT, 'sink');
  assert.equal('reader' in v, false);
  assert.equal(v.ok, true);
  assert.equal(v.parts.uppers, 0.8);
  assert.ok(v.issues.includes('uppers: expected 5 doors, read 6'));
});
