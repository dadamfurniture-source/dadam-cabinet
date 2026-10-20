/**
 * 2026-10-20 사장님 결정: 플래너 역판독 대조(verify.js compareLayoutToSpec)에서 도면 밖 장(덤 유닛, extra_units)이
 * 어느 줄에든 보이면 ok=false → 잡 마무리에서 internal_only.
 *
 * 그 전에는 상부 줄 덤만 관문(#897)이고 바닥·tall·other 덤은 이슈만이었다 (PR #844 가 거짓 경보를 이유로 뺐다 —
 * 사장님이 그 위험을 알고 넣기로 결정). 실측 1cf4c7be(ㄱ자)는 문 1짝을 더 그렸고 역판독이 extraUnits 로 읽고도 ok 로 통과했다.
 * 줄 끝 % 관문은 넣지 않는다 (사장님: 아니오).
 *
 * 고정하는 것:
 *   1) 바닥(base)·tall·wardrobe·other 덤 → ok=false · 점수(parts·score·max)는 예전 그대로 · 사유가 화면 앞 3개 안에
 *   2) 바닥 덤 → 잡 마무리에서 internal_only
 *   3) 도면에 있는 냉장고장 위 박스·후드 칸은 덤이 아니다 — 판독 프롬프트가 그렇게 말하고, 그대로 읽은 답은 ok
 *   4) 정답 → ok · 비 플래너(옛 판독) 대조는 그대로
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesignSpec } from '../src/prompts.js';
import { compareLayoutToSpec } from '../src/verify.js';
import { buildPlannerReadPrompt, normalizeLayout, normalizePlannerRead } from '../src/layout.js';
import { internalOnlyPatch } from '../src/job.js';

const one = (w) => ({ widthMm: w, kind: 'door', doorCount: 1, drawerCount: 0, label: '도어' });
const two = (w) => ({ widthMm: w, kind: 'door', doorCount: 2, drawerCount: 0, label: '양문' });
const u = (id, doors, seen = 'cabinet', drawers = 0) => ({ id, seen, doors, drawers });

/** 일자 — 하부 L1 800(2)·L2 400(1)·L3 1000(2), 상부 U1 960(2)·U2 960(2)·U3 480(1) */
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
const UPPER = [u('U1', 2), u('U2', 2), u('U3', 1)];
const read = ({ base = BASE, upper = UPPER, extra = [] } = {}) => ({
  rows: [{ row: 'base', units: base }, { row: 'wall', units: upper }],
  extra_units: extra,
  layout_shape: 'straight',
  confidence: 0.9,
  notes: [],
});
const verify = (raw, spec = STRAIGHT, category = 'sink') =>
  compareLayoutToSpec(normalizePlannerRead(raw, { category, designSpec: spec, elevation: 'labeled' }), spec, category);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('정답 (덤 없음) → ok', () => {
  const v = verify(read());
  assert.equal(v.ok, true);
  assert.deepEqual(v.issues, []);
  assert.deepEqual(v.read.extraUnits, []);
});

test('바닥 줄 덤(끝에 붙인 서랍장) → ok=false · 점수는 예전 그대로 · 사유가 화면 앞 3개 안에', () => {
  const v = verify(read({ extra: [{ row: 'base', where: 'drawer stack at the right end', doors: 0, drawers: 3 }] }));
  assert.equal(v.ok, false);
  // 덤은 총수에 섞지 않는다 — 점수는 정답과 같다
  const good = verify(read());
  assert.deepEqual(v.parts, good.parts);
  assert.equal(v.score, good.score);
  assert.equal(v.max, good.max);
  assert.ok(v.issues.slice(0, 3).includes('extra: base unit not in plan (drawer stack at the right end), 0 doors + 3 drawers'));
});

test('tall·wardrobe·other 줄 덤도 ok=false', () => {
  for (const x of [
    { row: 'tall', where: 'pantry at the left', doors: 2, drawers: 0 },
    { row: 'wardrobe', where: 'narrow unit at the end', doors: 1, drawers: 0 },
    { row: 'other', where: 'shelf', doors: 0, drawers: 0 },
  ]) {
    const v = verify(read({ extra: [x] }));
    assert.equal(v.ok, false, x.row);
    assert.ok(v.issues.slice(0, 3).includes(`extra: ${x.row} unit not in plan (${x.where}), ${x.doors} doors + ${x.drawers} drawers`), x.row);
  }
});

test('덤 사유는 모듈 이슈보다 앞 — 모듈 이슈가 여럿이어도 화면 앞 3개 안에 남는다', () => {
  const v = verify(
    read({
      base: [u('L1', 1), u('L2', 2), u('L3', 1)],
      extra: [{ row: 'base', where: 'one more door at the left end', doors: 1, drawers: 0 }],
    })
  );
  assert.equal(v.ok, false);
  const extra = 'extra: base unit not in plan (one more door at the left end), 1 doors + 0 drawers';
  assert.ok(v.issues.slice(0, 3).includes(extra), JSON.stringify(v.issues));
  assert.ok(v.issues.indexOf(extra) < v.issues.findIndex((s) => /^L\d:/.test(s)));
});

test('바닥 줄 덤 → 잡 마무리에서 internal_only (손님에게 나가지 않는다)', async () => {
  const v = verify(read({ extra: [{ row: 'base', where: 'drawer stack at the right end', doors: 0, drawers: 3 }] }));
  globalThis.fetch = async () => new Response(JSON.stringify([{ options: { mode: 'planner' } }]), { headers: { 'Content-Type': 'application/json' } });
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
  const patch = await internalOnlyPatch(env, { id: 'job-1', options: { mode: 'planner' } }, { verify: v });
  assert.equal(patch.options.internal_only, true);
  assert.deepEqual(await internalOnlyPatch(env, { id: 'job-1', options: { mode: 'planner' } }, { verify: verify(read()) }), {});
});

// ─── 도면에 있는 것은 덤이 아니다 ───

/** 냉장고장 — 하부 L1(서랍 3)·L2(2), 상부 U1(2)·U2(2), 키큰장 T1 3단 한 통 + T2 냉장고 자리 위 2도어 박스 (planner-tiers.test.js 사이트 도면) */
function fridgeSpec() {
  return normalizeDesignSpec(
    {
      category: 'fridge',
      wallRunMm: 3120,
      sections: {
        lower: {
          widthMm: 1800, heightMm: 870, depthMm: 650, fromLeftMm: 0,
          modules: [{ widthMm: 900, kind: 'drawer', doorCount: 0, drawerCount: 3, label: '서랍 3단' }, two(900)],
        },
        upper: { widthMm: 1800, heightMm: 780, depthMm: 320, fromLeftMm: 0, modules: [two(900), two(900)] },
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
    },
    'fridge'
  );
}

test('냉장고장 위 박스는 덤이 아니다 — 판독 프롬프트가 T2 의 것이라 말하고, 그대로 읽은 답은 ok', () => {
  const s = fridgeSpec();
  const p = buildPlannerReadPrompt({ category: 'fridge', designSpec: s, elevation: 'labeled' });
  assert.ok(p.includes('the cabinet with 2 fronts above it belongs to T2, not an extra unit'));
  // 일반 문장 — 도면 유닛의 것은 덤이 아니다 (2026-10-20, 덤이 모든 줄에서 관문이 되면서)
  assert.match(p, /\n3\. extra_units: [^\n]*belong to a listed plan unit are not extra — count them on that unit\.\n/);
  const raw = {
    rows: [
      { row: 'base', units: [u('L1', 0, 'cabinet', 3), u('L2', 2)] },
      { row: 'wall', units: [u('U1', 2), u('U2', 2)] },
      { row: 'tall', units: [u('T1', 3), u('T2', 2, 'refrigerator')] },
    ],
    extra_units: [],
    layout_shape: 'straight',
    confidence: 0.8,
  };
  const v = verify(raw, s, 'fridge');
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  // 위 박스를 덤으로 잘못 읽으면 막힌다 — 사장님이 알고 받아들인 거짓 경보 위험 (PR #844)
  const misread = verify({ ...raw, extra_units: [{ row: 'wall', where: 'above the refrigerator', doors: 2, drawers: 0 }] }, s, 'fridge');
  assert.equal(misread.ok, false);
});

test('후드 칸은 덤이 아니다 — 후드만 걸린 H1 을 그대로 읽은 답은 ok', () => {
  const s = {
    ...STRAIGHT,
    sections: {
      ...STRAIGHT.sections,
      upper: { fromLeftMm: 0, modules: [two(900), { widthMm: 600, kind: 'appliance', label: '후드' }, two(900)] },
    },
  };
  const p = buildPlannerReadPrompt({ category: 'sink', designSpec: s, elevation: 'labeled' });
  assert.ok(p.includes('the hood, loose furniture and things outside the built-in run are not units'));
  const v = verify(read({ upper: [u('U1', 2), u('H1', 0, 'hood'), u('U2', 2)] }), s);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.deepEqual(v.read.extraUnits, []);
});

test('비 플래너(옛 판독) 대조는 그대로 — extraUnits 가 없고 reader 키도 없다', () => {
  const WA = { wallW: 2400, wallH: 2400, waterPct: 50, exhaustPct: 30 };
  const old = normalizeLayout(
    {
      segments: [{ kind: 'lower', start_pct: 0, end_pct: 92, doors: 5, drawers: 0 }],
      uppers_status: 'clear',
      uppers: [
        { kind: 'upper', start_pct: 0, end_pct: 40, doors: 2 },
        { kind: 'upper', start_pct: 40, end_pct: 80, doors: 2 },
        { kind: 'upper', start_pct: 80, end_pct: 100, doors: 1 },
      ],
      appliances: {},
      confidence: { segments: 0.9, uppers: 0.9, appliances: 0.9 },
    },
    { category: 'sink', wallAnalysis: WA, now: 'T' }
  );
  const v = compareLayoutToSpec(old, STRAIGHT, 'sink');
  assert.equal('reader' in v, false);
  assert.equal('extraUnits' in v.read, false);
  assert.equal(v.ok, true);
});
