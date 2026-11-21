/**
 * 기본안 벽 채움 검사 — 기록 전용 (2026-11-21, src/fill-check.js · 설계 docs/02-design/features/fill-check.md).
 *
 * 고정하는 것:
 *   1) 대상: AI 연출컷 품목 10개 모두, 플래너 모드는 빼고, 게이트(FILL_QC) 꺼지면 호출 없음
 *   2) 판정하는 변(FILL_WANT)은 연출컷 지시문(CATEGORIES[].spec)이 이미 말한 것뿐
 *   3) 점 → mm (정면 가정 비례) · 범위 밖은 unsure · 판정 true/false/null
 *   4) 실패해도 던지지 않는다: 깨진 JSON · 시간 초과 · 과부하 건너뛰기 · 재시도 1회
 *   5) job.js 호출 자리: 위치 검사 옆, 추천안 밖, 재실행은 다시 재지 않는다
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, FILL_SCHEMA, FILL_SIDES, FILL_WANT, buildFillPrompt } from '../src/prompts.js';
import {
  FILL_VERSION,
  fillOk,
  fillSkipped,
  fillTarget,
  measureFill,
  parseFill,
  runFillCheck,
  startFillCheck,
} from '../src/fill-check.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = (f) => fs.readFileSync(path.join(HERE, '..', 'src', f), 'utf8');

const IMG = { base64: 'AAAA', mimeType: 'image/jpeg' };
const WALL = { wallW: 3000, wallH: 2400 };
const input = (category, extra = {}) => ({
  category,
  base: IMG,
  room: IMG,
  wall: WALL,
  options: {},
  jobId: 'j1',
  ...extra,
});
const answer = (o = {}) =>
  JSON.stringify({
    furniture_box: [100, 100, 900, 900],
    wall_left_x: 100,
    wall_right_x: 900,
    ceiling_y: 100,
    floor_y: 900,
    left: 'touch',
    right: 'touch',
    top: 'touch',
    bottom: 'touch',
    note: 'fills the wall',
    ...o,
  });
const fake = (texts) => {
  const calls = [];
  const fn = async (env, args) => {
    calls.push(args);
    const t = texts[Math.min(calls.length - 1, texts.length - 1)];
    if (t instanceof Error) throw t;
    return { text: t };
  };
  fn.calls = calls;
  return fn;
};
const NO_OVERLOAD = () => 0;

// ─────────────────────────── 1. 대상 ───────────────────────────

test('대상: 연출컷 품목 10개 모두 · 플래너 모드 · 모르는 품목 · 빈 입력은 null', () => {
  for (const k of Object.keys(CATEGORIES)) assert.equal(fillTarget(input(k)), k, k);
  assert.equal(
    Object.keys(FILL_WANT).sort().join(),
    Object.keys(CATEGORIES).sort().join(),
    '품목 목록이 같다'
  );
  assert.equal(fillTarget(input('sink', { options: { mode: 'planner' } })), null);
  assert.equal(fillTarget(input('nope')), null);
  assert.equal(fillTarget(null), null);
});

test('게이트: FILL_QC 가 on 이 아니면 시작 · 건너뜀 기록 모두 null', () => {
  assert.equal(startFillCheck({}, input('wardrobe')), null);
  assert.equal(startFillCheck({ FILL_QC: 'off' }, input('wardrobe')), null);
  assert.equal(fillSkipped({}, input('wardrobe'), 'rerun'), null);
  assert.equal(
    startFillCheck({ FILL_QC: 'on' }, input('sink', { options: { mode: 'planner' } })),
    null
  );
});

// ─────────────────────────── 2. 판정하는 변 ───────────────────────────

test('FILL_WANT: 지시문이 말한 변만 — 화장대 · 신발장은 판정 없음', () => {
  assert.deepEqual(FILL_WANT, {
    sink: ['top'],
    island: ['top'],
    wardrobe: ['left', 'right', 'top', 'bottom'],
    storage: ['left', 'right', 'top', 'bottom'],
    fridge: ['left', 'right', 'top', 'bottom'],
    vanity: [],
    shoe: [],
    office: ['left', 'right'],
    study: ['left', 'right', 'top', 'bottom'],
    bedroom: ['top'],
  });
  // 근거 문장이 지시문에 있다
  const spec = (k) =>
    CATEGORIES[k].spec({
      wallW: 3000,
      wallH: 2400,
      waterPct: 48,
      exhaustPct: 70,
      doorColor: 'white',
    });
  assert.match(spec('wardrobe'), /full wall width[\s\S]*No gap to the ceiling or the side walls/);
  assert.match(spec('storage'), /Floor-to-ceiling[\s\S]*covering the wall/);
  assert.match(spec('fridge'), /covering the full wall width, built up to the ceiling/);
  assert.match(spec('study'), /floor-to-ceiling built-in bookcase covering the wall/);
  assert.match(spec('sink'), /Upper cabinets flush to the ceiling/);
  assert.match(spec('bedroom'), /up to the ceiling/);
  assert.match(spec('office'), /a desk spanning the wall/);
});

test('질의 · 스키마: 품목 이름이 들어가고 네 변 · 점 칸이 모두 required', () => {
  const p = buildFillPrompt('shoe');
  assert.match(p, /신발장 \(shoe\)/);
  assert.match(p, /Answer JSON only\.$/);
  for (const k of FILL_SIDES) assert.ok(FILL_SCHEMA.required.includes(k), k);
  for (const k of ['furniture_box', 'wall_left_x', 'wall_right_x', 'ceiling_y', 'floor_y'])
    assert.ok(FILL_SCHEMA.required.includes(k), k);
  assert.ok(!/handle/i.test(p), '판정 질의에 손잡이 이야기는 없다');
});

// ─────────────────────────── 3. 점 → mm · 판정 ───────────────────────────

test('measureFill: 틈 비율 × 벽 폭 · 높이, 10 mm 단위, 0 보다 작으면 0', () => {
  const m = measureFill(
    {
      furniture_box: [200, 150, 900, 860],
      wall_left_x: 100,
      wall_right_x: 900,
      ceiling_y: 100,
      floor_y: 900,
      left: 'gap',
      right: 'gap',
      top: 'gap',
      bottom: 'touch',
    },
    WALL
  );
  assert.equal(m.box, true);
  assert.deepEqual(m.sides.left, { s: 'gap', mm: 190 }); // 50/800 × 3000 = 187.5 → 190
  assert.deepEqual(m.sides.right, { s: 'gap', mm: 150 }); // 40/800 × 3000
  assert.deepEqual(m.sides.top, { s: 'gap', mm: 300 }); // 100/800 × 2400
  assert.deepEqual(m.sides.bottom, { s: 'touch', mm: 0 });
  const wide = measureFill({ ...JSON.parse(answer()), furniture_box: [50, 40, 960, 960] }, WALL);
  assert.equal(wide.sides.left.mm, 0, '앞면이 벽보다 넓게 보이면 0');
});

test('measureFill: 상자 없음 · 틀린 상자 → 네 변 unsure, 벽 점 범위 밖 → 그 변 unsure, 보이지 않음 → 상태만', () => {
  for (const box of [null, [1, 2, 3], [900, 100, 100, 900], [0, 0, 2000, 500], 'x']) {
    const m = measureFill({ ...JSON.parse(answer()), furniture_box: box }, WALL);
    assert.equal(m.box, false);
    for (const k of FILL_SIDES) assert.deepEqual(m.sides[k], { s: 'unsure' });
  }
  const m = measureFill({ ...JSON.parse(answer()), wall_left_x: 5000, wall_right_x: null }, WALL);
  assert.deepEqual(m.sides.left, { s: 'unsure' });
  assert.deepEqual(m.sides.right, { s: 'touch' }, '보이지 않는 벽 끝 — 모델 판정만, mm 없음');
  assert.deepEqual(measureFill({ ...JSON.parse(answer()), top: 'maybe' }, WALL).sides.top, {
    s: 'unsure',
    mm: 0,
  });
  assert.equal(
    measureFill(JSON.parse(answer()), {}).sides.left.mm,
    undefined,
    '벽 폭을 모르면 mm 없음'
  );
});

test('fillOk: gap 하나 → false, 모두 touch → true, unsure 섞임 · want 없음 → null', () => {
  const S = (l, r, t, b) => ({ left: { s: l }, right: { s: r }, top: { s: t }, bottom: { s: b } });
  assert.equal(fillOk(FILL_WANT.wardrobe, S('touch', 'touch', 'touch', 'touch')), true);
  assert.equal(fillOk(FILL_WANT.wardrobe, S('touch', 'gap', 'unsure', 'touch')), false);
  assert.equal(fillOk(FILL_WANT.wardrobe, S('touch', 'touch', 'unsure', 'touch')), null);
  assert.equal(fillOk(FILL_WANT.sink, S('gap', 'gap', 'touch', 'gap')), true, '싱크대는 위만 본다');
  assert.equal(fillOk(FILL_WANT.shoe, S('gap', 'gap', 'gap', 'gap')), null, '신발장은 판정 없음');
});

test('parseFill: 코드 울타리 · 깨진 JSON · 배열', () => {
  assert.deepEqual(parseFill('```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(parseFill('{broken'), null);
  assert.equal(parseFill('[1]'), null);
  assert.equal(parseFill(null), null);
});

// ─────────────────────────── 4. 한 번 재기 ───────────────────────────

test('runFillCheck: [방 사진, 기본안] 한 번 · 기록 형식', async () => {
  const call = fake([answer({ right: 'gap', wall_right_x: 950 })]);
  const rec = await runFillCheck({ FILL_QC: 'on' }, input('wardrobe', { provider: 'openai' }), {
    callGemini: call,
    overloadAt: NO_OVERLOAD,
  });
  assert.equal(call.calls.length, 1);
  const a = call.calls[0];
  assert.equal(a.images.length, 2);
  assert.equal(a.want, 'text');
  assert.equal(a.model, 'gemini-3.8-flash');
  assert.deepEqual(a.extraConfig.responseSchema, FILL_SCHEMA);
  assert.equal(rec.v, FILL_VERSION);
  assert.equal(rec.ok, false);
  assert.deepEqual(rec.want, FILL_WANT.wardrobe);
  assert.deepEqual(rec.sides.right, { s: 'gap', mm: 180 }); // 50/850 × 3000 = 176.5 → 180
  assert.equal(rec.calls, 1);
  assert.equal(rec.provider, 'openai');
  assert.equal(rec.note, 'fills the wall');
  assert.equal(rec.error, undefined);
});

test('runFillCheck: 깨진 답 · 가구 없음 · 이미지 없음은 코드만', async () => {
  const env = { FILL_QC: 'on' };
  const deps = (t) => ({ callGemini: fake([t]), overloadAt: NO_OVERLOAD });
  assert.equal((await runFillCheck(env, input('storage'), deps('nope'))).error, 'parse');
  const none = await runFillCheck(env, input('storage'), deps(answer({ furniture_box: null })));
  assert.equal(none.error, 'no_furniture');
  assert.equal(none.ok, null);
  assert.equal(
    (await runFillCheck(env, input('storage', { base: null }), deps(answer()))).error,
    'no_image'
  );
  assert.equal(
    (await runFillCheck(env, input('storage', { room: null }), deps(answer()))).error,
    'no_room'
  );
});

test('runFillCheck: 과부하 중이면 보내지 않는다 · 과부하는 5초 뒤 1회만 다시 · 4xx 는 다시 보내지 않는다', async () => {
  const env = { FILL_QC: 'on' };
  const skip = await runFillCheck(env, input('fridge'), {
    callGemini: fake([answer()]),
    overloadAt: () => Date.now() - 1000,
  });
  assert.equal(skip.error, 'skipped_overload');
  assert.equal(skip.calls, 0);

  const busy = Object.assign(new Error('busy'), { status: 429, retryable: true });
  const slept = [];
  const again = fake([busy, answer()]);
  const ok = await runFillCheck(env, input('fridge'), {
    callGemini: again,
    overloadAt: NO_OVERLOAD,
    sleep: async (ms) => slept.push(ms),
  });
  assert.equal(again.calls.length, 2);
  assert.deepEqual(slept, [5000]);
  assert.equal(ok.ok, true);

  const twice = fake([busy, busy]);
  const r = await runFillCheck(env, input('fridge'), {
    callGemini: twice,
    overloadAt: NO_OVERLOAD,
    sleep: async () => {},
  });
  assert.equal(twice.calls.length, 2);
  assert.equal(r.error, 'http_429');

  const bad = fake([Object.assign(new Error('bad'), { status: 400 })]);
  const r4 = await runFillCheck(env, input('fridge'), { callGemini: bad, overloadAt: NO_OVERLOAD });
  assert.equal(bad.calls.length, 1);
  assert.equal(r4.error, 'http_4xx');
});

test('startFillCheck: 기다리지 않고 시작 · attachTo 칸에 fill · 시간 초과는 기록으로 · 던지지 않음', async () => {
  const env = { FILL_QC: 'on' };
  const slot = {};
  const run = startFillCheck(env, input('study'), {
    callGemini: fake([answer()]),
    overloadAt: NO_OVERLOAD,
  });
  run.attachTo(slot);
  assert.equal(await run.wait(5000), true);
  assert.equal(slot.fill.ok, true);

  const hang = startFillCheck(env, input('study'), {
    callGemini: () => new Promise(() => {}),
    overloadAt: NO_OVERLOAD,
    timing: { total: 30, call: 30, hardExtra: 10 },
  });
  const late = {};
  hang.attachTo(late);
  assert.equal(await hang.wait(2000), true);
  assert.ok(['timeout', 'budget'].includes(late.fill.error), late.fill.error);

  const boom = startFillCheck(env, input('study'), {
    callGemini: () => {
      throw new Error('x');
    },
    overloadAt: NO_OVERLOAD,
  });
  assert.equal(await boom.wait(2000), true);
  assert.equal(boom.result.error, 'net');
});

test('fillSkipped: 재실행은 다시 재지 않고 코드만', () => {
  const r = fillSkipped({ FILL_QC: 'on' }, input('bedroom'), 'rerun');
  assert.deepEqual(r, {
    v: FILL_VERSION,
    ok: null,
    want: ['top'],
    sides: null,
    model: 'gemini-3.8-flash',
    calls: 0,
    ms: 0,
    error: 'rerun',
  });
});

// ─────────────────────────── 5. job.js 호출 자리 (정적) ───────────────────────────

test('job.js: 채움 검사는 위치 검사 옆에서 시작 · 추천안에는 없음 · 재실행은 건너뜀 기록 · 늦은 패치도 기다린다', () => {
  const src = SRC('job.js');
  assert.match(src, /^import \{ fillSkipped, startFillCheck \} from '\.\/fill-check\.js';$/m);
  const posAt = src.indexOf('pos = startPositionCheck(env, positionInput(qc');
  const fillAt = src.indexOf('fill = startFillCheck(env, positionInput(qc');
  const uploadAt = src.indexOf('`${prefix}/base.${extOf(base.mimeType)}`');
  const variantsAt = src.indexOf('═══ 4. 변형 3장 병렬');
  assert.ok(posAt > 0 && fillAt > posAt && uploadAt > fillAt);
  assert.equal(src.slice(variantsAt).indexOf('startFillCheck'), -1, '추천안에는 없다');
  assert.ok(src.indexOf('fill.attachTo(ck.images.base)') > uploadAt);
  assert.ok(
    src.includes(
      "fillSkipped(env, positionInput(ck.images.base.qc, ck.images.base.provider), 'rerun')"
    )
  );
  assert.ok(
    !src.includes('startFillCheck(env, positionInput(ck.images.base.qc'),
    '재실행은 다시 재지 않는다'
  );
  assert.ok(src.includes('if (posLate || fillLate) {'));
  assert.ok(
    src.indexOf('const fillLate = !!fill && !fill.done;') <
      src.indexOf('const posLate = !!pos && !pos.done;')
  );
});
