/**
 * 품목 줄 (src/pipeline-items.js) — 한 프로젝트에 품목 설계가 여럿일 때의 단계 · 다음 할 일.
 * 2026-11-23 대표님 「워크플로우를 현재 변경된 프로젝트 지정에 맞게 변경」 — 답: 단계 = 가장 늦은 품목 · 견적/계약은 품목마다.
 *
 * 고정하는 것
 *   1) 줄마다의 단계 · 다음 할 일은 pipeline.js stepOf · nextStep 그대로 (규칙을 새로 만들지 않는다)
 *   2) 프로젝트 단계 = 끝나지 않은 줄 가운데 가장 앞 단계. 모두 끝나야 끝
 *   3) 프로젝트의 다음 할 일 = 대표 승인 → 가장 늦은 줄 것(같은 단계면 가장 최근에 만진 줄) → 끝난 줄에 남은 일
 *   4) 줄 이름 — 플래너 이름의 끝 조각, 겹치면 번호
 * 순수 함수 — DB 를 읽지 않는다. 값은 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS_MAX, PLANNER_ITEM_LABEL, itemsOf, numberLabels, trackLabelOf } from '../src/pipeline-items.js';
import { nextStep, stepOf } from '../src/pipeline.js';

const NOW = Date.parse('2026-11-23T03:00:00Z');
const at = (d) => `2026-11-${String(d).padStart(2, '0')}T00:00:00.000Z`;
const OWNER = { role: 'owner', user_id: 'u-owner' };
const STAFF = { role: 'staff', user_id: 'u-staff' };
const BASE = { id: 'p-1', status: 'active', created_at: at(1), factory: true, visit_ready: true, visit: null, assignee_id: null, hold_until: null };
const draft = (id, extra = {}) => ({ id, created_by: 'u-owner', updated_at: at(10), ...extra });
const quote = (id, extra = {}) => ({ id, created_at: at(11), expires_at: '2099-01-01T00:00:00Z', first_viewed_at: null, view_count: 0, decision: null, decided_at: null, ...extra });
const order = (id, status, extra = {}) => ({ id, status, ordered_at: at(12), delivered_at: null, completed_at: null, ...extra });
const track = (key, label, extra = {}) => ({ key, label, touched: at(10), draft_id: null, design_id: null, ...extra });
const brief = (r) => [r.step, r.next && r.next.key, r.next && r.next.go, r.next && r.next.item];

test('줄마다의 판정은 pipeline.js 그대로 — 줄 하나를 그 값으로 stepOf · nextStep 에 넣은 것과 같다', () => {
  const t = track('draft:d-1', '싱크대', { draft_id: 'd-1', draft: draft('d-1'), design: true, design_id: 'D1', quote: quote('q-1', { decision: 'approved', decided_at: at(12) }) });
  const r = itemsOf(BASE, [t], OWNER, NOW);
  const facts = { ...BASE, stage: '', born: false, draft: t.draft, designs: 1, quote: t.quote, order: null, dead_order: false, deposit: null, balance: null, request: null, pending: null, as_open: 0 };
  assert.equal(r.items[0].step, stepOf(facts));
  assert.deepEqual(r.items[0].next, nextStep(facts, OWNER, NOW));
  assert.deepEqual(r.items[0], { key: 'draft:d-1', label: '싱크대', step: 'quote', step_label: '견적', next: r.items[0].next, draft_id: 'd-1', design_id: 'D1', order_id: null });
  // 줄이 하나면 다음 할 일에 품목 이름을 붙이지 않는다
  assert.equal('item' in r.next, false);
  assert.deepEqual(brief(r).slice(0, 2), ['quote', 'order']);
});

test('가장 늦은 품목 — 싱크대 생산 · 붙박이장 설계면 프로젝트는 설계, 다음 할 일은 붙박이장 것', () => {
  const sink = track('draft:d-s', '싱크대', { draft_id: 'd-s', draft: draft('d-s'), design: true, design_id: 'D-S', quote: quote('q-s', { decision: 'approved' }), order: order('o-s', 'in_production') });
  const ward = track('draft:d-w', '붙박이장 안방', { draft_id: 'd-w', draft: draft('d-w', { updated_at: at(20) }), touched: at(20) });
  const r = itemsOf(BASE, [sink, ward], OWNER, NOW);
  assert.deepEqual(brief(r), ['design', 'design', 'planner?draft=d-w', '붙박이장 안방']);
  assert.deepEqual(r.items.map((x) => [x.label, x.step, x.next.key, x.order_id]), [
    ['싱크대', 'make', 'deliver', 'o-s'],
    ['붙박이장 안방', 'design', 'design', null],
  ]);
  assert.equal(r.lead.key, 'draft:d-w');
  // 줄의 차례가 달라도 같다
  assert.deepEqual(brief(itemsOf(BASE, [ward, sink], OWNER, NOW)), brief(r));
});

test('단계가 뒤로 가지 않고 일찍 끝나지 않는다 — 수주 둘 · 하나가 끝남 · 모두 끝남', () => {
  const a = (status, extra) => track('draft:a', '싱크대', { draft: draft('a'), design: true, design_id: 'DA', order: order('o-a', status, extra), deposit: 'paid' });
  const b = (status, extra = {}) => track('draft:b', '붙박이장', { draft: draft('b'), design: true, design_id: 'DB', order: order('o-b', status), ...extra });
  // 생산 + 접수(계약금 전) → 계약 · 계약금 입금 적기(늦은 줄)
  assert.deepEqual(brief(itemsOf(BASE, [a('in_production'), b('confirmed')], OWNER, NOW)), ['contract', 'deposit', 'order:o-b', '붙박이장']);
  // 하나가 끝났다 → 남은 줄의 단계 · 할 일 (끝이 아니다)
  const half = itemsOf(BASE, [a('completed', { completed_at: at(20) }), b('in_production')], OWNER, NOW);
  assert.deepEqual(brief(half), ['make', 'deliver', 'order:o-b', '붙박이장']);
  assert.deepEqual(half.items.map((x) => x.step), ['done', 'make']);
  // 모두 끝났다 → 끝. 남은 잔금이 있으면 그 줄의 것
  const done = itemsOf(BASE, [a('completed', { completed_at: at(20) }), b('completed', { balance: 'unpaid' })], OWNER, NOW);
  assert.deepEqual(brief(done), ['done', 'balance', 'order:o-b', '붙박이장']);
  assert.deepEqual(brief(itemsOf(BASE, [a('completed'), b('completed')], OWNER, NOW)), ['done', null, null, null]);
});

test('같은 단계의 줄이 여럿이면 가장 최근에 만진 줄 · 늦은 줄에 할 일이 없으면 다음으로 늦은 줄', () => {
  const t1 = track('draft:1', '싱크대', { draft_id: '1', draft: draft('1'), touched: at(10) });
  const t2 = track('draft:2', '붙박이장', { draft_id: '2', draft: draft('2', { updated_at: at(22) }), touched: at(22) });
  const t3 = track('draft:3', '신발장', { draft_id: '3', draft: draft('3', { updated_at: at(15) }), touched: at(15) });
  assert.deepEqual(brief(itemsOf(BASE, [t1, t2, t3], OWNER, NOW)), ['design', 'design', 'planner?draft=2', '붙박이장']);
  // 직원이 보면 — 남이 만든 초안은 allowed 가 거짓일 뿐 같은 줄이다 (할 일을 숨기지 않는다)
  const staff = itemsOf(BASE, [t1, t2], STAFF, NOW);
  assert.deepEqual([staff.next.key, staff.next.allowed, staff.next.item], ['design', false, '붙박이장']);
  // 견적 답을 기다리는 줄(기다림)이 가장 늦어도 그 줄의 것 — 글로 적는 기다림도 다음 할 일이다
  const waiting = track('draft:q', '화장대', { draft: draft('q'), design: true, design_id: 'DQ', quote: quote('q-9') });
  const making = track('draft:m', '싱크대', { draft: draft('m'), design: true, design_id: 'DM', order: order('o-m', 'in_production') });
  const r = itemsOf(BASE, [making, waiting], OWNER, NOW);
  assert.deepEqual([r.step, r.next.key, r.next.wait, r.next.item], ['quote', 'customer', true, '화장대']);
});

test('대표 승인이 걸린 줄이 있으면 그것부터 · 보류 · 끝난 프로젝트는 프로젝트 값 그대로', () => {
  const late = track('draft:l', '붙박이장', { draft_id: 'l', draft: draft('l') });
  const asking = track('draft:a', '싱크대', { draft: draft('a'), design: true, design_id: 'DA', order: order('o-a', 'in_production'), pending: { order_id: 'o-a', kind: 'status', created_at: at(21) } });
  const r = itemsOf(BASE, [late, asking], OWNER, NOW);
  assert.deepEqual(brief(r), ['design', 'approve', 'order:o-a', '싱크대']);
  assert.deepEqual([itemsOf(BASE, [late, asking], STAFF, NOW).next.key], ['approval']);
  // 보류 — 단계는 멈춘 자리(늦은 줄), 다음 할 일 없음
  const held = itemsOf({ ...BASE, status: 'on_hold' }, [late, asking], OWNER, NOW);
  assert.deepEqual([held.step, held.next], ['design', null]);
  // 그만둔 프로젝트 — 끝, 할 일 없음
  const gone = itemsOf({ ...BASE, status: 'cancelled' }, [late, asking], OWNER, NOW);
  assert.deepEqual([gone.step, gone.next, gone.items.map((x) => x.step)], ['done', null, ['done', 'done']]);
});

test('줄이 없으면 값이 없다 · 싣는 줄 수에는 한도가 있다', () => {
  assert.deepEqual(itemsOf(BASE, [], OWNER, NOW), { step: null, next: null, items: [], lead: null });
  assert.deepEqual(itemsOf(BASE, null, OWNER, NOW).items, []);
  const many = Array.from({ length: ITEMS_MAX + 3 }, (_, i) => track(`draft:${i}`, `수납장 ${i + 1}`, { draft_id: String(i), draft: draft(String(i)) }));
  const r = itemsOf(BASE, many, OWNER, NOW);
  assert.equal(r.items.length, ITEMS_MAX);
  assert.equal(r.step, 'design');
});

test('줄 이름 — 플래너 이름의 끝 조각 · 품목 이름 · 설계 이름, 겹치면 번호', () => {
  assert.deepEqual(Object.keys(PLANNER_ITEM_LABEL), ['sink', 'island', 'shoerack', 'vanity', 'storage', 'wardrobe', 'fridge', 'fridge_reform']);
  assert.equal(trackLabelOf({ item: 'wardrobe', name: '예시 주방 · 붙박이장 안방' }), '붙박이장 안방');
  assert.equal(trackLabelOf({ item: 'wardrobe', name: '주방 · 거실 · 붙박이장 2' }), '붙박이장 2');
  assert.equal(trackLabelOf({ item: 'sink', name: '손으로 적은 옛 이름' }), '싱크대');
  assert.equal(trackLabelOf({ item: 'sink', name: '싱크대 · 11.23' }), '싱크대', '프로젝트 없이 붙은 이름(품목 · 날짜)의 끝 조각은 날짜다');
  // 품목을 모르는 설계 — 설계 이름의 끝 조각이 품목 이름으로 시작하면 그것, 아니면 설계 이름
  assert.equal(trackLabelOf({ designName: '예시 주방 · 신발장' }), '신발장');
  assert.equal(trackLabelOf({ designName: '주방 1안' }), '주방 1안');
  assert.equal(trackLabelOf({}), '설계');
  assert.equal(trackLabelOf(null), '설계');
  assert.deepEqual(numberLabels(['붙박이장', '싱크대', '붙박이장', '붙박이장']), ['붙박이장', '싱크대', '붙박이장 2', '붙박이장 3']);
});
