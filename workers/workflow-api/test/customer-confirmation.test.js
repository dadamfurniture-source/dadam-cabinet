/**
 * 고객 확인서 외관 도면 — 사장님 결정 D6 (2026-10-19): 확인서에 외관 정면도·아이소를 넣는다, 3D 는 나중.
 * 고객 화면이므로 내부 구조(뒷판·처짐방지목·따내기·밴드·partId·보링)와 공장용 검증 경고는 보이지 않는다.
 *
 * 골든: test/fixtures/customer-confirmation.golden.html — 의도적으로 바꾸면
 *   UPDATE_GOLDEN=1 node --test test/customer-confirmation.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderCustomerConfirmation } from '../src/templates/customer-confirmation.js';
import { renderWorkOrder } from '../src/templates/work-order.js';
import * as ef from './fixtures/elevation.js';

const GOLDEN = fileURLToPath(new URL('./fixtures/customer-confirmation.golden.html', import.meta.url));

function confirmation(items) {
  const snapshot = {
    rev: 3,
    item_count: items.length,
    design_payload: { items },
    bom_payload: { materials: [], hardware: [] },
    quote_payload: {
      items: [{ name: '싱크대', quantity: '3,000mm', unit_price: 160000, total: 480000 }],
      subtotal: 480000,
      vat: 48000,
      total: 528000,
      skipped: [],
    },
  };
  const doc = {
    id: 'd1',
    doc_no: 'DD-20261019-T3T3-CC-r1',
    doc_type: 'customer_confirmation',
    rev: 1,
    title: '합성 주방',
    customer_name_masked: '가*나',
    created_at: '2026-10-19T01:00:00.000Z',
    expires_at: '2026-11-02T01:00:00.000Z',
    render_payload: { quote: snapshot.quote_payload },
    decision: null,
  };
  return { doc, snapshot };
}

const svgCount = (html, cls) => (html.match(new RegExp(`<svg class="${cls}`, 'g')) || []).length;

test('확인서에 일자 품목은 정면도, 코너 품목은 아이소가 들어간다', () => {
  const { doc, snapshot } = confirmation([ef.sink3000(), ef.wardrobe3600(), ef.lShape()]);
  const html = renderCustomerConfirmation(doc, snapshot);
  assert.ok(html.includes('외관 도면'));
  assert.equal(svgCount(html, 'elevation"'), 2, '정면도 2장 (싱크 일자 · 붙박이장)');
  assert.equal(svgCount(html, 'elevation iso'), 1, '아이소 1장 (ㄱ자)');
  assert.ok(html.includes('W 3,000') && html.includes('W 3,600'), '전체 폭 치수');
  assert.ok(html.indexOf('외관 도면') < html.indexOf('공급가액'), '도면은 견적 앞에');
});

test('확인서 도면에 내부 구조·검증 경고가 없다', () => {
  const bad = ef.sink3000();
  bad.w = 2800; // 모듈 끝 3000 > 품목 폭 → 작업지시서는 빨간 경고
  const { doc, snapshot } = confirmation([bad, ef.lShape()]);
  const html = renderCustomerConfirmation(doc, snapshot);
  for (const word of ['뒷판', '처짐방지', '따내기', '밴드', 'partId', 'planner-', '보링', '사쿠리', '⚠']) {
    assert.ok(!html.includes(word), `고객 확인서에 "${word}" 가 있으면 안 된다`);
  }
  const wo = renderWorkOrder({ ...doc, doc_type: 'work_order' }, snapshot);
  assert.ok(wo.includes('⚠'), '작업지시서는 같은 설계에서 경고를 그대로 보인다');
});

test('모듈이 없는 설계는 외관 도면 절을 싣지 않는다', () => {
  const { doc, snapshot } = confirmation([{ categoryId: 'sink', labelName: '싱크대', w: 3000, h: 870, d: 600 }]);
  const html = renderCustomerConfirmation(doc, snapshot);
  assert.ok(!html.includes('외관 도면'));
  assert.equal(svgCount(html, 'elevation'), 0);
});

test('확인서 HTML 골든 (싱크 일자 · 붙박이장 · ㄱ자)', () => {
  const { doc, snapshot } = confirmation([ef.sink3000(), ef.wardrobe3600(), ef.lShape()]);
  const html = renderCustomerConfirmation(doc, snapshot);
  if (process.env.UPDATE_GOLDEN === '1') writeFileSync(GOLDEN, html);
  assert.equal(html, readFileSync(GOLDEN, 'utf8'));
});
