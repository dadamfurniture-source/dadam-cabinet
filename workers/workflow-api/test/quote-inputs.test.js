/**
 * 견적 입력 어댑터 · 단가 규칙 세트.
 *
 * 어댑터(adapters.js)는 장당 견적의 상판 · 설비 · 철거 줄(quote-sheet.js extraCostLines)이 읽는다.
 * 단가 규칙 세트에서 장당 견적이 읽는 것은 범위 배수(range)뿐이다 — m당 단가 견적은 그만두었다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePricebook } from '../src/pricing.js';
import { buildQuoteInput } from '../src/adapters.js';

/** 하부 3000 / 상부 2000 / 상판 3000, 개수대·후드 있는 싱크대 1대. */
function sinkItem() {
  return {
    categoryId: 'sink',
    labelName: '싱크대',
    w: 3200,
    specs: { topSizes: [{ w: 3000, d: 650 }] },
    modules: [
      { pos: 'lower', type: 'sink', w: 1000, doorCount: 1 },
      { pos: 'lower', type: 'cook', w: 600 },
      { pos: 'lower', type: 'storage', w: 1400, isDrawer: true },
      { pos: 'upper', type: 'hood', w: 800 },
      { pos: 'upper', type: 'storage', w: 1200 },
    ],
  };
}

// ── 어댑터 ────────────────────────────────────────────────────────

test('쿡탑 모듈 type 은 cook 이다 (cooktop 아님)', () => {
  const input = buildQuoteInput(sinkItem(), 0);
  assert.equal(input.analysis.has_cooktop, true, "calc-engine.js:592 의 type 은 'cook'");
  assert.equal(input.analysis.has_sink, true);
  assert.equal(input.analysis.has_hood, true);
});

test('서랍은 별도 type 이 아니라 isDrawer 플래그로 센다', () => {
  const input = buildQuoteInput(sinkItem(), 0);
  assert.equal(input.analysis.drawer_count, 1);
});

test('상판 길이는 specs.topSizes 합을 우선하고 없으면 하부 길이로 폴백', () => {
  const withTop = buildQuoteInput(sinkItem(), 0);
  assert.equal(withTop.analysis.countertop_length_mm, 3000);

  const noTop = sinkItem();
  noTop.specs = {};
  assert.equal(buildQuoteInput(noTop, 0).analysis.countertop_length_mm, 3000); // 하부 합
});

test('문자열 치수도 숫자로 처리한다', () => {
  const item = sinkItem();
  item.modules[0].w = '1000';
  const input = buildQuoteInput(item, 0);
  assert.equal(input.analysis.lower_cabinets[0].width_mm, 1000);
});

// ── pricebook ─────────────────────────────────────────────────────

test('범위 배수 — 규칙이 있으면 그 값, 없으면 null', () => {
  const b = makePricebook({ id: 'rs-1', version: '2026.08' }, [
    { kind: 'range', key: 'min', grade: '*', amount: 0.95 },
    { kind: 'range', key: 'max', grade: '*', amount: 1.3 },
  ]);
  assert.equal(b.ruleSetId, 'rs-1');
  assert.equal(b.version, '2026.08');
  assert.equal(b.rangeMin(), 0.95);
  assert.equal(b.rangeMax(), 1.3);
  const none = makePricebook({ id: 'rs-2', version: 'x' }, []);
  assert.equal(none.rangeMin(), null);
  assert.equal(none.rangeMax(), null);
});
