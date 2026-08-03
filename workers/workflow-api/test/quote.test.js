/**
 * 견적 골든 테스트.
 *
 * 기대값은 mcp-server/src/services/quote.service.ts:80-146 의 산식을 그대로
 * 손계산한 것이다. 이 파일이 깨지면 포팅이 원본과 어긋났다는 뜻이다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePricebook } from '../src/pricing.js';
import { buildQuoteInputs, buildQuoteInput, CATEGORY_TO_PRICE_KEY } from '../src/adapters.js';
import { calculateQuote } from '../src/quote.js';

/** database/workflow-pricing-seed.sql 과 같은 값. */
const SEED_RULES = [
  { kind: 'cabinet', key: 'sink.lower', grade: '*', amount: 160000 },
  { kind: 'cabinet', key: 'sink.upper', grade: '*', amount: 140000 },
  { kind: 'cabinet', key: 'wardrobe.lower', grade: '*', amount: 100000 },
  { kind: 'countertop', key: 'default', grade: 'basic', amount: 150000 },
  { kind: 'countertop', key: 'default', grade: 'premium', amount: 230000 },
  { kind: 'fixture', key: 'faucet', grade: 'basic', amount: 40000 },
  { kind: 'fixture', key: 'sink_bowl', grade: 'basic', amount: 80000 },
  { kind: 'fixture', key: 'hood', grade: 'basic', amount: 65000 },
  { kind: 'labor', key: 'installation', grade: '*', amount: 200000 },
  { kind: 'labor', key: 'demolition', grade: '*', amount: 30000 },
  { kind: 'door_finish_base', key: 'PET-M', grade: '*', amount: 24000 },
  { kind: 'door_finish_base', key: 'MFB', grade: '*', amount: 14000 },
  { kind: 'door_color_mult', key: 'OAK', grade: '*', amount: 1.0 },
  { kind: 'door_color_mult', key: 'SAG', grade: '*', amount: 1.1 },
  { kind: 'door_color_mult', key: 'WHT', grade: '*', amount: 0.95 },
  { kind: 'vat', key: 'rate', grade: '*', amount: 0.1 },
  { kind: 'range', key: 'min', grade: '*', amount: 0.95 },
  { kind: 'range', key: 'max', grade: '*', amount: 1.3 },
];

function book(extraRules = []) {
  return makePricebook({ id: 'rs-1', version: '2026.08' }, [...SEED_RULES, ...extraRules]);
}

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

test('골든: 싱크대 1대 basic — quote.service.ts 손계산과 원 단위 일치', () => {
  const q = calculateQuote(buildQuoteInputs({ items: [sinkItem()] }), book(), null, 'basic');

  const byName = Object.fromEntries(q.items.map((i) => [i.name, i.total]));
  assert.equal(byName['싱크대 하부장 캐비닛'], 480000); // 160000 * 3000/1000
  assert.equal(byName['싱크대 상부장 캐비닛'], 280000); // 140000 * 2000/1000
  assert.equal(byName['싱크대 상판 (인조대리석)'], 450000); // 150000 * 3000/1000
  assert.equal(byName['싱크대 수전'], 40000);
  assert.equal(byName['싱크대 싱크볼'], 80000);
  assert.equal(byName['싱크대 후드'], 65000);
  assert.equal(byName['기존 철거'], 150000); // 30000 * 5000/1000

  assert.equal(q.subtotal, 1545000);
  assert.equal(q.vat, 154500);
  assert.equal(q.total, 1699500);
  assert.deepEqual(q.range, { min: 1614525, max: 2209350 });
  assert.equal(q.grade, 'basic');
});

test('설치비는 계상하지 않는다 — 원본 calculateQuote 가 추가하지 않음', () => {
  const q = calculateQuote(buildQuoteInputs({ items: [sinkItem()] }), book(), null, 'basic');
  assert.ok(
    !q.items.some((i) => /설치/.test(i.name)),
    'LABOR.installation 은 원본에서 items 에 추가되지 않는다',
  );
});

test('아이템 2개여도 철거비는 1줄, 길이는 합산', () => {
  const q = calculateQuote(
    buildQuoteInputs({ items: [sinkItem(), sinkItem()] }),
    book(),
    null,
    'basic',
  );
  const demolition = q.items.filter((i) => i.name === '기존 철거');
  assert.equal(demolition.length, 1, '철거비가 아이템마다 중복되면 안 된다');
  assert.equal(demolition[0].total, 300000); // 30000 * 10000/1000
});

test('VAT 는 최종 subtotal 에 1회만', () => {
  const q = calculateQuote(
    buildQuoteInputs({ items: [sinkItem(), sinkItem()] }),
    book(),
    null,
    'basic',
  );
  assert.equal(q.vat, Math.round(q.subtotal * 0.1));
  assert.equal(q.total, q.subtotal + q.vat);
});

test('등급을 바꾸면 상판·설비 단가가 바뀐다', () => {
  const basic = calculateQuote(buildQuoteInputs({ items: [sinkItem()] }), book(), null, 'basic');
  const premium = calculateQuote(buildQuoteInputs({ items: [sinkItem()] }), book(), null, 'premium');
  const ctB = basic.items.find((i) => /상판/.test(i.name)).total;
  const ctP = premium.items.find((i) => /상판/.test(i.name)).total;
  assert.equal(ctB, 450000); // 150000 * 3
  assert.equal(ctP, 690000); // 230000 * 3
});

test('잘못된 등급은 basic 으로 떨어진다', () => {
  const q = calculateQuote(buildQuoteInputs({ items: [sinkItem()] }), book(), null, 'premuim');
  assert.equal(q.grade, 'basic');
});

test('단가표에 없는 카테고리는 조용히 0원 처리하지 않고 skipped 로 드러낸다', () => {
  const items = [{ categoryId: 'warehouse', labelName: '창고장', w: 1200, modules: [{ pos: 'lower', type: 'storage', w: 1200 }] }];
  const q = calculateQuote(buildQuoteInputs({ items }), book(), null, 'basic');
  assert.equal(q.skipped.length, 1);
  assert.equal(q.skipped[0].category, 'warehouse');
  // 철거비는 카테고리와 무관하게 길이 기준으로 잡힌다
  assert.equal(q.items.filter((i) => i.name === '기존 철거').length, 1);
});

test('상판이 없는 카테고리(붙박이장)는 상판을 계상하지 않는다', () => {
  const items = [
    { categoryId: 'wardrobe', labelName: '붙박이장', w: 3000, modules: [{ pos: 'lower', type: 'storage', w: 3000 }] },
  ];
  const q = calculateQuote(buildQuoteInputs({ items }), book(), null, 'basic');
  assert.ok(!q.items.some((i) => /상판/.test(i.name)));
  assert.equal(q.items.find((i) => /하부장/.test(i.name)).total, 300000); // 100000 * 3
});

// ── 도어 마감 업차지 ──────────────────────────────────────────────

const bomWithDoors = {
  materials: [
    // 1m² 짜리 PET 매트 오크 도어 (단가 24000)
    { part: '도어', material: 'PET', w: 1000, h: 1000, qty: 1, finishCode: 'PET-OAK-M' },
    // finishCode 없는 기본 도어 — 업차지 대상 아님
    { part: '도어', material: 'MDF', w: 1000, h: 1000, qty: 1, finishCode: '' },
  ],
};

test('door_baseline 이 없으면 업차지를 계상하지 않는다 (이중 계상 방지)', () => {
  const q = calculateQuote(buildQuoteInputs({ items: [sinkItem()] }), book(), bomWithDoors, 'basic');
  assert.equal(q.door_upcharge_applied, false);
  assert.ok(!q.items.some((i) => /도어 마감/.test(i.name)));
});

test('door_baseline 이 있으면 차액만 업차지로 계상한다', () => {
  const b = book([{ kind: 'door_baseline', key: 'default', grade: '*', amount: 12000 }]);
  const q = calculateQuote(buildQuoteInputs({ items: [sinkItem()] }), b, bomWithDoors, 'basic');

  assert.equal(q.door_upcharge_applied, true);
  const up = q.items.find((i) => /도어 마감/.test(i.name));
  // PET-OAK-M = 24000 * 1.00 = 24000, baseline 12000 → 차액 12000 × 1m²
  assert.equal(up.total, 12000);
  assert.equal(up.quantity, '1.00m²');
});

test('baseline 보다 싼 마감은 마이너스로 깎지 않는다', () => {
  const b = book([{ kind: 'door_baseline', key: 'default', grade: '*', amount: 20000 }]);
  const cheap = { materials: [{ part: '도어', w: 1000, h: 1000, qty: 1, finishCode: 'MFB-WHT' }] };
  // MFB-WHT = 14000 * 0.95 = 13300 < 20000 → 차액 없음
  const q = calculateQuote(buildQuoteInputs({ items: [sinkItem()] }), b, cheap, 'basic');
  assert.equal(q.door_upcharge_applied, false);
});

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

test('카테고리 매핑은 data-constants.js CATEGORIES 와 대응한다', () => {
  assert.equal(CATEGORY_TO_PRICE_KEY.fridge, 'fridge_cabinet');
  assert.equal(CATEGORY_TO_PRICE_KEY.shoerack, 'shoe_cabinet');
  assert.equal(CATEGORY_TO_PRICE_KEY.warehouse, undefined);
  assert.equal(CATEGORY_TO_PRICE_KEY.door, undefined);
  assert.equal(CATEGORY_TO_PRICE_KEY.custom, undefined);
});

test('문자열 치수도 숫자로 처리한다', () => {
  const item = sinkItem();
  item.modules[0].w = '1000';
  const input = buildQuoteInput(item, 0);
  assert.equal(input.analysis.lower_cabinets[0].width_mm, 1000);
});

// ── pricebook ─────────────────────────────────────────────────────

test('도어 단가 매트릭스 — bom-rules.defaults.ts 와 일치', () => {
  const b = book();
  assert.equal(b.doorFinishPrice('PET-OAK-M'), 24000); // 24000 * 1.00
  assert.equal(b.doorFinishPrice('MFB-WHT'), 13300); // 14000 * 0.95
  assert.equal(b.doorFinishPrice('MDF-DEFAULT'), null);
  assert.equal(b.doorFinishPrice(''), null);
  assert.equal(b.doorFinishPrice('UNKNOWN-XXX'), null);
});

test('grade 전용 값이 없으면 * 로 폴백한다', () => {
  const b = book();
  assert.equal(b.labor('demolition'), 30000); // grade '*'
  assert.equal(b.cabinet('sink', 'lower'), 160000);
  assert.equal(b.cabinet('sink', 'nonexistent'), null);
});
