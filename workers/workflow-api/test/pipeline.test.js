/**
 * 프로젝트 한 길 — 지금 단계 · 다음 할 일 판정 (src/pipeline.js).
 *
 * 고정하는 것 (2026-11-21 대표님 승인 계획의 판정표 줄마다 한 칸)
 *   1) stepOf — 끝남 · 수주 상태 · 받은 제작 의뢰 · 견적 · 설계(초안 · 연출컷 포함) · 상담
 *   2) nextStep — 상태마다 다음 할 일 · 가는 곳 · 기다림 · 누가 할 수 있나
 *   3) 막지 않는다 — 직책이 안 맞으면 allowed false 일 뿐, 다음 할 일은 그대로 알려 준다
 * 순수 함수라 DB 흉내가 없다. 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NEXT_LABEL, STEPS, STEP_LABEL, nextStep, stepOf } from '../src/pipeline.js';

const P = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const D = 'd-draft-1';
const O = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const Q = 'cccccccc-cccc-4ccc-8ccc-000000000001';
const ME = 'eeeeeeee-eeee-4eee-8eee-000000000001';
const NOW = Date.parse('2026-11-21T03:00:00Z');

const base = (extra = {}) => ({
  id: P,
  status: 'active',
  created_at: '2026-11-19T00:00:00Z',
  stage: 'consult',
  factory: true,
  born: false,
  draft: null,
  designs: 0,
  quote: null,
  order: null,
  dead_order: false,
  deposit: null,
  request: null,
  pending: null,
  as_open: 0,
  ...extra,
});
const draft = (extra = {}) => ({ id: D, created_by: ME, updated_at: '2026-11-20T01:00:00Z', ...extra });
const quote = (extra = {}) => ({
  id: Q,
  created_at: '2026-11-17T00:00:00Z',
  expires_at: '2026-12-01T00:00:00Z',
  first_viewed_at: null,
  view_count: 0,
  decision: null,
  decided_at: null,
  ...extra,
});
const order = (status, extra = {}) => ({
  id: O,
  status,
  ordered_at: '2026-11-18T00:00:00Z',
  delivered_at: null,
  completed_at: null,
  ...extra,
});
const owner = { role: 'owner', user_id: 'u-owner' };
const manager = { role: 'manager', user_id: 'u-manager' };
const staff = { role: 'staff', user_id: 'u-staff' };
const next = (f, v = owner) => nextStep(f, v, NOW);
/** [key, go, wait, allowed] 로 줄여 본다 */
const brief = (f, v) => {
  const n = next(f, v);
  return n ? [n.key, n.go, n.wait, n.allowed] : null;
};

test('이름 — 단계 일곱 · 다음 할 일 글이 모두 있다', () => {
  assert.deepEqual(STEPS, ['consult', 'design', 'quote', 'contract', 'make', 'install', 'done']);
  assert.deepEqual(
    STEPS.map((s) => STEP_LABEL[s]),
    ['상담', '설계', '견적', '계약', '생산', '설치', '끝']
  );
  for (const [k, v] of Object.entries(NEXT_LABEL)) assert.ok(typeof v === 'string' && v, k);
});

test('stepOf — 상담 → 설계(초안 · 앱 설계 · 연출컷) → 견적 → 계약 → 생산 → 설치 → 끝', () => {
  assert.equal(stepOf(base()), 'consult');
  assert.equal(stepOf(base({ draft: draft() })), 'design'); // 플래너에 저장만 해도 설계
  assert.equal(stepOf(base({ designs: 1, stage: 'design' })), 'design');
  assert.equal(stepOf(base({ stage: 'render' })), 'design'); // 연출컷만 있어도 지금처럼 설계
  assert.equal(stepOf(base({ designs: 1, quote: quote(), stage: 'quote' })), 'quote');
  assert.equal(stepOf(base({ stage: 'quote' })), 'quote'); // 견적 자료를 못 읽었어도 서버 단계로
  assert.equal(stepOf(base({ order: order('confirmed'), stage: 'order' })), 'contract');
  assert.equal(stepOf(base({ order: order('in_production'), stage: 'order' })), 'make');
  assert.equal(stepOf(base({ order: order('delivered'), stage: 'order' })), 'install');
  // 완료된 수주 = 끝 (예전 메뉴는 설치에 계속 쌓였다)
  assert.equal(stepOf(base({ order: order('completed'), stage: 'installed' })), 'done');
  assert.equal(stepOf(base({ stage: 'installed' })), 'done');
});

test('stepOf — 끝난 · 취소 · 넘긴 프로젝트는 끝, 팩토리가 받은 제작 의뢰 프로젝트는 생산', () => {
  for (const status of ['closed', 'cancelled', 'handed_over'])
    assert.equal(stepOf(base({ status, order: order('in_production') })), 'done');
  assert.equal(stepOf(base({ born: true })), 'make'); // 설계 · 수주가 없어도 상담이 아니다
  assert.equal(stepOf(base({ born: true, draft: draft(), designs: 1 })), 'make');
  // 영업 사원(Manager 업체) — 수주 접수 뒤 제작 의뢰를 냈으면 생산
  const sales = { factory: false, order: order('confirmed'), stage: 'order' };
  assert.equal(stepOf(base(sales)), 'contract');
  assert.equal(stepOf(base({ ...sales, request: { id: 'r', status: 'submitted' } })), 'make');
  // 팩토리는 의뢰 값이 있어도 수주 상태를 따른다
  assert.equal(stepOf(base({ order: order('confirmed'), request: { id: 'r', status: 'chosen' } })), 'contract');
  assert.equal(stepOf(null), 'consult');
});

test('설계 전 — 설계 시작(누구나, 플래너가 이 프로젝트로) → 초안 이어서(만든 사람 · 대표 · 실장) → 견적 내기(대표 · 실장)', () => {
  const start = next(base(), staff);
  assert.deepEqual(start, {
    key: 'design_start',
    label: '설계 시작',
    go: `planner?project=${P}`,
    wait: false,
    since: '2026-11-19T00:00:00Z',
    allowed: true,
  });
  // 초안만 있다 — 그 초안으로, 고치는 것은 만든 사람 · 대표 · 실장
  assert.deepEqual(brief(base({ draft: draft() }), manager), ['design', `planner?draft=${D}`, false, true]);
  assert.deepEqual(brief(base({ draft: draft() }), { role: 'staff', user_id: ME }), [
    'design',
    `planner?draft=${D}`,
    false,
    true,
  ]);
  assert.deepEqual(brief(base({ draft: draft() }), staff), ['design', `planner?draft=${D}`, false, false]);
  assert.equal(next(base({ draft: draft() })).since, '2026-11-20T01:00:00Z');
  // 앱으로 보낸 설계 — 견적(확인서)은 대표 · 실장이 플래너에서 낸다
  const sent = base({ draft: draft(), designs: 1, stage: 'design' });
  assert.deepEqual(brief(sent, owner), ['quote', `planner?draft=${D}`, false, true]);
  assert.deepEqual(brief(sent, staff), ['quote', `planner?draft=${D}`, false, false]);
  // 플래너 초안이 없는 설계(PC 상세설계) — 설계 화면으로
  assert.deepEqual(brief(base({ designs: 2, stage: 'design' })), ['quote', 'p-design', false, true]);
});

test('견적 — 답을 기다림(며칠째 · 본 횟수) · 기한 지남 · 승인 → 계약 만들기 · 반려 → 다시 견적', () => {
  const f = (q) => base({ draft: draft(), designs: 1, stage: 'quote', quote: quote(q) });
  assert.deepEqual(next(f({ view_count: 2, first_viewed_at: '2026-11-18T00:00:00Z' }), staff), {
    key: 'customer',
    label: '고객 답 기다림',
    go: 'p-quote',
    wait: true,
    since: '2026-11-17T00:00:00Z',
    allowed: false,
    views: 2,
  });
  assert.equal(next(f({})).views, 0);
  // 기한이 지났다 — 다시 낸다 (대표 · 실장)
  const expired = f({ expires_at: '2026-11-20T00:00:00Z' });
  assert.deepEqual(brief(expired, owner), ['requote_expired', `planner?draft=${D}`, false, true]);
  assert.deepEqual(brief(expired, staff), ['requote_expired', `planner?draft=${D}`, false, false]);
  // 승인 — 그 자리에서 계약(수주)을 만든다. 직원도 된다 (서버 orders.js createOrderFromDocument 가 구성원 누구나)
  const approved = f({ decision: 'approved', decided_at: '2026-11-21T01:00:00Z' });
  assert.deepEqual(next(approved, staff), {
    key: 'order',
    label: '계약 만들기',
    go: 'p-quote',
    wait: false,
    since: '2026-11-21T01:00:00Z',
    allowed: true,
    act: { kind: 'order', document_id: Q },
  });
  // 그 확인서의 수주가 취소됐다 — 문서 하나에 수주 하나라 다시 못 만든다
  assert.deepEqual(brief({ ...approved, dead_order: true }), ['order_dead', 'p-contract', true, false]);
  // 반려 — 설계를 고쳐 다시
  const rejected = f({ decision: 'rejected', decided_at: '2026-11-20T05:00:00Z' });
  assert.deepEqual(brief(rejected, manager), ['requote_rejected', `planner?draft=${D}`, false, true]);
  assert.deepEqual(brief(rejected, staff), ['requote_rejected', `planner?draft=${D}`, false, false]);
});

test('계약 — 계약금 입금 적기(대표 · 실장) → 팩토리는 생산 시작(누구나)', () => {
  const f = (extra) => base({ designs: 1, stage: 'order', order: order('confirmed'), ...extra });
  for (const deposit of [null, 'unpaid']) {
    assert.deepEqual(brief(f({ deposit }), owner), ['deposit', `order:${O}`, false, true]);
    assert.deepEqual(brief(f({ deposit }), staff), ['deposit', `order:${O}`, false, false]);
  }
  assert.equal(next(f({})).since, '2026-11-18T00:00:00Z');
  assert.deepEqual(brief(f({ deposit: 'paid' }), staff), ['produce', `order:${O}`, false, true]);
});

test('영업 사원(Manager 업체) — 계약금 뒤 제작 의뢰 → 본사 추천 기다림 → 팩토리 고르기 → 팩토리 답 기다림 → 생산 시작', () => {
  const f = (request, extra = {}) =>
    base({
      factory: false,
      designs: 1,
      stage: 'order',
      order: order('confirmed'),
      deposit: 'paid',
      request,
      ...extra,
    });
  const req = (status) => ({ id: 'r1', status, status_at: '2026-11-20T00:00:00Z' });
  assert.deepEqual(brief(f(null), owner), ['request', 'p-make', false, true]);
  assert.deepEqual(brief(f(null), staff), ['request', 'p-make', false, false]);
  for (const s of ['submitted', 'recommending', 'declined', 'expired'])
    assert.deepEqual(brief(f(req(s))), ['hq', 'p-make', true, false], s);
  assert.deepEqual(brief(f(req('recommended')), manager), ['choose', 'p-make', false, true]);
  assert.deepEqual(brief(f(req('recommended')), staff), ['choose', 'p-make', false, false]);
  assert.deepEqual(brief(f(req('chosen'))), ['factory', 'p-make', true, false]);
  assert.deepEqual(brief(f(req('accepted')), staff), ['produce', `order:${O}`, false, true]);
  assert.equal(next(f(req('chosen'))).since, '2026-11-20T00:00:00Z');
  // 추천이 왔으면 계약금보다 고르기가 먼저다 (답 기한이 있다)
  assert.deepEqual(brief(f(req('recommended'), { deposit: 'unpaid' })), ['choose', 'p-make', false, true]);
  // 그 밖에는 계약금이 먼저
  assert.deepEqual(brief(f(req('submitted'), { deposit: null })), ['deposit', `order:${O}`, false, true]);
  // 팩토리 업체는 의뢰 값을 보지 않는다
  assert.deepEqual(brief(f(req('recommended'), { factory: true })), ['produce', `order:${O}`, false, true]);
});

test('생산 · 설치 · 끝 — 배송으로 넘기기 → 설치 완료 처리 → (팩토리) 열린 A/S', () => {
  const f = (status, extra = {}) =>
    base({ designs: 1, stage: 'order', order: order(status, extra.order), ...extra, order: order(status, extra.order) });
  assert.deepEqual(brief(f('in_production'), staff), ['deliver', `order:${O}`, false, true]);
  const delivered = f('delivered', { order: { delivered_at: '2026-11-20T09:00:00Z' } });
  assert.deepEqual(brief(delivered, staff), ['complete', `order:${O}`, false, true]);
  assert.equal(next(delivered).since, '2026-11-20T09:00:00Z');
  // 완료 — 할 일 없음. 처리 중 A/S 가 있으면(팩토리) 그 접수로
  assert.equal(next(f('completed', { stage: 'installed' })), null);
  assert.deepEqual(brief(f('completed', { stage: 'installed', as_open: 2 })), ['as', 'p-as', false, true]);
  assert.equal(next(f('completed', { stage: 'installed', as_open: 2, factory: false })), null);
});

test('팩토리가 받은 제작 의뢰 프로젝트 — 받은 설계 열기(대표 · 실장) → 앱으로 보낸 뒤 생산 화면', () => {
  const born = base({ born: true, draft: draft({ id: 'pr-req-1', created_by: null }) });
  assert.deepEqual(brief(born, owner), ['factory_design', 'planner?draft=pr-req-1', false, true]);
  assert.deepEqual(brief(born, staff), ['factory_design', 'planner?draft=pr-req-1', false, false]);
  assert.deepEqual(brief({ ...born, designs: 1 }, staff), ['make', 'p-make', false, true]);
  // 초안을 못 읽었어도 프로젝트 번호로 플래너를 연다
  assert.deepEqual(brief(base({ born: true })), ['factory_design', `planner?project=${P}`, false, true]);
});

test('대표 승인이 걸려 있으면 그것부터 — 대표는 승인 · 반려, 그 밖은 기다림', () => {
  const f = base({
    designs: 1,
    stage: 'order',
    order: order('delivered'),
    pending: { order_id: O, kind: 'revert', created_at: '2026-11-21T00:00:00Z' },
  });
  assert.deepEqual(next(f, owner), {
    key: 'approve',
    label: '요청 승인 · 반려',
    go: `order:${O}`,
    wait: false,
    since: '2026-11-21T00:00:00Z',
    allowed: true,
  });
  for (const v of [manager, staff]) assert.deepEqual(brief(f, v), ['approval', `order:${O}`, true, false]);
});

test('끝난 · 취소 · 넘긴 프로젝트 — 다음 할 일 없음. 값이 없어도 던지지 않는다', () => {
  for (const status of ['closed', 'cancelled', 'handed_over'])
    assert.equal(next(base({ status, quote: quote({ decision: 'approved' }) })), null);
  assert.deepEqual(brief(null, null), ['design_start', 'p-design', false, true]);
  assert.deepEqual(brief({ id: P }, {}), ['design_start', `planner?project=${P}`, false, true]);
  // 직책을 모르는 사람(다담 공장 구성원이 역할 없이 올 때) — 대표 · 실장 일은 allowed false
  assert.deepEqual(brief(base({ designs: 1 }), { role: null }), ['quote', 'p-design', false, false]);
});
