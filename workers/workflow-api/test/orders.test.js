/**
 * CD-5: 수주 · 실적 원가 · 마진.
 *
 * 업무 루프의 마지막 칸이다. 고객이 확인서를 승인해도 그 다음이 없었다 —
 * 승인 이후는 시스템 밖이었고, 견적은 있는데 실적 원가를 받을 곳이 없어
 * "견적이 맞았는가" 를 물을 수조차 없었다.
 *
 * 계약의 근거는 **고객이 승인한 확인서 하나뿐**이다. 이 계약이 느슨해지면
 * 승인 안 된 견적이 수주가 되고 매출이 허구가 된다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMargin, ORDER_STATUSES, COST_CATEGORIES } from '../src/orders.js';

const ORDER = { contract_amount: 10000000, received_amount: 4000000 };

test('원가를 분류별로 합산하고 마진을 낸다', () => {
  const m = summarizeMargin(ORDER, [
    { category: 'material', amount: 3000000 },
    { category: 'material', amount: 1000000 },
    { category: 'labor', amount: 2000000 },
  ]);
  assert.equal(m.cost_total, 6000000);
  assert.deepEqual(m.cost_by_category, { material: 4000000, labor: 2000000 });
  assert.equal(m.margin, 4000000);
  assert.equal(m.margin_rate, 40);
});

test('미수금을 낸다', () => {
  const m = summarizeMargin(ORDER, []);
  assert.equal(m.outstanding, 6000000);
});

test('원가가 계약금액을 넘으면 마진이 음수다 (숨기지 않는다)', () => {
  const m = summarizeMargin(ORDER, [{ category: 'outsourcing', amount: 12000000 }]);
  assert.equal(m.margin, -2000000);
  assert.equal(m.margin_rate, -20);
});

test('계약금액이 0 이면 마진율은 null — 0% 로 속이지 않는다', () => {
  const m = summarizeMargin({ contract_amount: 0, received_amount: 0 }, [{ category: 'other', amount: 5 }]);
  assert.equal(m.margin_rate, null);
  assert.equal(m.margin, -5);
});

test('원가가 없어도 안전하다', () => {
  for (const costs of [[], null, undefined]) {
    const m = summarizeMargin(ORDER, costs);
    assert.equal(m.cost_total, 0);
    assert.equal(m.margin, 10000000);
  }
});

test('견적 총액은 참고값으로만 싣는다', () => {
  // 견적은 VAT 포함 판매가고 원가는 매입가다. 직접 빼면 안 된다.
  const m = summarizeMargin(ORDER, [], { total: 9500000, items: [{}, {}, {}] });
  assert.equal(m.quoted_total, 9500000);
  assert.equal(m.quoted_items, 3);
  // 마진은 어디까지나 계약금액 기준
  assert.equal(m.margin, 10000000);
});

test('견적이 없으면 null', () => {
  const m = summarizeMargin(ORDER, [], null);
  assert.equal(m.quoted_total, null);
  assert.equal(m.quoted_items, 0);
});

test('금액이 쓰레기값이어도 합계가 깨지지 않는다', () => {
  const m = summarizeMargin(ORDER, [
    { category: 'material', amount: '3000000' },
    { category: 'labor', amount: null },
    { category: 'other', amount: undefined },
  ]);
  assert.equal(m.cost_total, 3000000);
});

test('수주 상태가 실무 흐름을 덮는다', () => {
  assert.deepEqual(ORDER_STATUSES, ['confirmed', 'in_production', 'delivered', 'completed', 'cancelled']);
});

test('원가 분류가 견적과 같은 축으로 나뉜다', () => {
  // 축이 다르면 견적 대비 실적 대조가 의미를 잃는다
  for (const c of ['material', 'hardware', 'labor', 'outsourcing', 'logistics', 'other']) {
    assert.ok(COST_CATEGORIES.includes(c), `${c} 분류가 있어야 한다`);
  }
  assert.equal(new Set(COST_CATEGORIES).size, COST_CATEGORIES.length);
});

test('분류 라벨이 모든 분류를 덮는다 (화면이 코드를 노출하지 않게)', () => {
  const m = summarizeMargin(ORDER, []);
  for (const c of COST_CATEGORIES) {
    assert.ok(m.cost_labels[c], `${c} 라벨이 있어야 한다`);
  }
});
