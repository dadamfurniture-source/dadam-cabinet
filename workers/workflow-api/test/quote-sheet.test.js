/**
 * 장당 견적 — BOM 수량 × 실제 원가 × (1 + 마진 20%).
 *
 * 골든 BOM(test-utils/bom-golden) 을 그대로 넣어 수량이 BOM 에서 나오는지,
 * 줄 금액 = 단가 × 수량, 캐비닛 금액 ≈ 원가 × 1.2 인지 본다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { calculateSheetQuote, installMeters, doorSheets, edgeMeters, hardwareCounts, extraCostLines, areaSheets } from '../src/quote-sheet.js';
import { DEFAULT_QUOTE } from '../src/production/standards.js';
import { sanitizeSettings, mergeSettings, summarizeMonth } from '../src/production/service.js';
import { scenarioBase, financeOf, estimateByCategory } from '../src/management/summary.js';

const require = createRequire(import.meta.url);
const { FIXTURES, designOf } = require('../../../test-utils/bom-golden/fixtures.js');
const golden = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../test-utils/bom-golden/${name}.golden.json`, import.meta.url)), 'utf8'));

const SINK = golden('sink15');
const SINK_BOM = { materials: SINK.materials, hardware: SINK.hardware };
const SINK_CUT = { summary: { sheetsByMaterial: { PB_15: 6, 'MDF_2.7': 3, MDF_18: 2 } } };
/** 예전 방식 — 재단 배치의 정수 장수 */
const NESTED = { quote: { sheetBasis: 'nested' } };

test('시공 길이: 싱크대는 상·하부 폭 합, 붙박이장·키큰장(높이 1500 이상)은 2배, 냉장고 자리는 뺀다', () => {
  // 싱크대 골든: 상부 900+600+800(후드)+1200 = 3.5m, 하부 1000+800+900+400+400+600 = 4.1m
  assert.equal(installMeters(designOf(FIXTURES.sink15)), 7.6);
  // 붙박이장 골든: 900 × 3통, 높이 2280 → 2.7m × 2
  assert.equal(installMeters(designOf(FIXTURES.wardrobe)), 5.4);
  // 냉장고장: 냉장고 자리(700)는 빼고, 키큰·홈카페(2290)는 2배
  const fridge = installMeters(designOf(FIXTURES.fridge));
  assert.equal(fridge, 0.6 * 2 + 0.9 * 2 + 0.7 + 0.5 + 0.6);
});

test('수량은 BOM 에서: 도어 원장(재단 배치 MDF 18T, 없으면 면적), 엣지 m, 철물', () => {
  assert.equal(doorSheets(SINK_BOM, SINK_CUT), 2);
  assert.ok(doorSheets(SINK_BOM, null) >= 1);
  assert.ok(edgeMeters(SINK_BOM) > 50);
  const hw = hardwareCounts(SINK_BOM);
  assert.equal(hw.hinge, SINK.hardwareSummary['경첩']);
  assert.equal(hw.leg, SINK.hardwareSummary['다리발']);
});

test('견적 줄: 단가 × 수량 = 금액, 공급가 ≈ 최종 지출비용 × 1.2, 합계 = 공급가 + 부가세 10%', () => {
  const q = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT, settings: NESTED });
  assert.equal(q.method, 'sheet');
  assert.equal(q.margin_rate, 0.2);
  const names = q.items.map((i) => i.name);
  assert.ok(names[0].startsWith('몸통 제작'));
  // 몸통 · 뒷판 · 도어 · 서랍 박스(레일 2) · 시공
  assert.deepEqual(q.items.slice(0, 5).map((i) => i.quantity), ['6장', '3장', '2장', '2개', '7.6m']);
  for (const i of q.items) assert.equal(i.total, Math.round(i.unit_price * parseFloat(i.quantity)));
  // 최종 지출비용(캐비닛 + 상판·설비·철거) × 1.2 — 단가를 100원 단위로 반올림한 차이만 허용
  assert.equal(q.cost.total, q.cost.cabinet + q.cost.drawerBox + Object.values(q.cost.extras).reduce((s, v) => s + v, 0));
  assert.equal(q.cost.priced_total, q.subtotal);
  assert.ok(Math.abs(q.subtotal - q.cost.total * 1.2) <= 100 * 20, `${q.subtotal} vs ${q.cost.total * 1.2}`);
  assert.equal(q.subtotal, q.items.reduce((s, i) => s + i.total, 0));
  assert.equal(q.vat, Math.round(q.subtotal * 0.1));
  assert.equal(q.total, q.subtotal + q.vat);
  // 시공 단가 = 4만 × 1.2
  assert.equal(q.items[4].unit_price, 48000);
  // 도어 원가 = 외주 2장 × 10만 + 도어 검수·달기
  assert.ok(q.cost.door.outsourcing === 200000 && q.cost.door.labor > 0);
  // 원가 내역에 수량·초가 남는다 (대표용)
  assert.equal(q.cost.quantities.sheetsPB, 6);
  assert.ok(q.cost.seconds.asm > 0);
});

test('마진율·원가 기준은 설정으로 바꾼다', () => {
  const base = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT });
  const m30 = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT, settings: { quote: { marginRate: 0.3 } } });
  assert.ok(m30.subtotal > base.subtotal);
  assert.equal(m30.cost.total, base.cost.total); // 원가는 그대로, 마진만 바뀐다
  const cheapDoor = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT, settings: { quote: { doorSheet: 87000, sheetBasis: 'nested' } } });
  assert.equal(cheapDoor.cost.door.outsourcing, 174000);
});

test('상판·설비·철거도 원가 × 1.2 — 단가표 판매가를 그대로 붙이지 않는다', () => {
  const design = designOf(FIXTURES.sink15);
  const lines = extraCostLines(design, DEFAULT_QUOTE);
  const by = Object.fromEntries(lines.map((l) => [l.key, l]));
  // 싱크대 골든: 상판 = 하부 길이 4.1m, 개수대·후드 있음, 철거 = 상·하부 7.6m
  assert.equal(by.countertop.qty, 4.1);
  assert.equal(by.countertop.cost, 4.1 * 133333); // 고객가 m당 16만 ÷ 1.2 (2026-10-19 대표 확정)
  assert.equal(by.sinkBowl.cost, 55000);
  assert.equal(by.faucet.cost, 30000);
  assert.equal(by.hood.cost, 59000);
  assert.equal(by.demolition.qty, 7.6);
  const q = calculateSheetQuote({ design, bom: SINK_BOM, cutPlan: SINK_CUT, range: { min: 0.95, max: 1.3 } });
  const row = (re) => q.items.find((i) => re.test(i.name));
  assert.equal(row(/상판/).unit_price, 160000); // 133,333 × 1.2 → 100원 단위
  assert.equal(row(/싱크볼/).unit_price, 66000); // 5.5만 × 1.2
  assert.equal(row(/수전/).unit_price, 36000);
  assert.equal(row(/후드/).unit_price, 70800);
  assert.equal(row(/철거/).unit_price, 30000); // 고객가 m당 3만 (2026-10-19 대표 확정)
  assert.equal(q.range.min, Math.round(q.total * 0.95));
  // 원가를 바꾸면 그대로 따라온다
  const q2 = calculateSheetQuote({ design, bom: SINK_BOM, cutPlan: SINK_CUT, settings: { quote: { sinkBowl: 400000 } } });
  assert.equal(q2.items.find((i) => /싱크볼/.test(i.name)).unit_price, 480000);
  // 붙박이장엔 상판·설비가 없고, 철거 길이도 상·하부장만 센다 (단가표 견적과 같은 기준)
  assert.deepEqual(extraCostLines(designOf(FIXTURES.wardrobe), DEFAULT_QUOTE), []);
});

test('붙박이장 골든도 계산된다 (재단 배치 없이 면적으로 원판 추정)', () => {
  const w = golden('wardrobe');
  const q = calculateSheetQuote({ design: designOf(FIXTURES.wardrobe), bom: { materials: w.materials, hardware: w.hardware }, cutPlan: null });
  assert.equal(q.cost.sheet_source, 'area');
  assert.ok(q.cost.quantities.sheetsPB >= 8);
  assert.ok(q.items.find((i) => i.name.startsWith('시공')).quantity === '5.4m');
  assert.ok(q.total > 0);
});

test('거래처 금액 = 같은 원가 줄 × 1.08 (소비자 × 0.9), 고객 금액 = × 1.2 · 간접비는 기본으로 품목 원가에서 뺀다', () => {
  const q = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT });
  assert.equal(q.margin_rate, 0.2);
  assert.equal(q.partner.margin_rate, 0.08);
  assert.deepEqual(q.partner.items.map((i) => i.name), q.items.map((i) => i.name));
  assert.deepEqual(q.partner.items.map((i) => i.quantity), q.items.map((i) => i.quantity));
  assert.ok(Math.abs(q.partner.subtotal - q.cost.total * 1.08) <= 100 * 20, `${q.partner.subtotal} vs ${q.cost.total * 1.08}`);
  assert.ok(q.partner.total < q.total);
  assert.equal(q.partner.total, q.partner.subtotal + q.partner.vat);
  // 간접비 기본 0 — 몸통·뒷판·도어 원가에 간접비가 없다
  assert.equal(q.cost.body.overhead, 0);
  assert.equal(q.cost.door.overhead, 0);
  // 설정으로 간접비를 다시 넣으면 원가가 오른다
  const withOh = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT, settings: { quote: { overheadPerHour: 33000, partnerMarginRate: 0.15 } } });
  assert.ok(withOh.cost.total > q.cost.total);
  assert.equal(withOh.partner.margin_rate, 0.15);
});

test('원판 장수 기본은 면적 기준 — PB·뒷판 0.1장, 도어 0.5장 단위 올림 (자투리 재사용 · 도어 반 장 청구)', () => {
  const a = areaSheets(SINK_BOM, DEFAULT_QUOTE);
  const SA = 1.22 * 2.44;
  assert.ok(a.areaM2.pb > 0 && a.areaM2.door > 0);
  assert.ok(Math.abs(a.pb - Math.ceil((a.areaM2.pb / (SA * 0.8)) * 10 - 1e-6) / 10) < 0.11);
  assert.equal(a.door * 2, Math.round(a.door * 2)); // 0.5 단위
  assert.ok(a.door >= a.areaM2.door / SA / 0.8 - 1e-9);
  const q = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT });
  const nested = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT, settings: NESTED });
  assert.equal(q.cost.sheet_source, 'area');
  assert.equal(q.cost.quantities.sheetsPB, a.pb);
  assert.equal(q.cost.quantities.doorSheets, a.door);
  assert.ok(q.cost.total < nested.cost.total, '면적 기준이 정수 장수보다 가볍다');
  // 붙박이장: 정수 장수일 때보다 몸통 원판이 줄어든다
  const w = golden('wardrobe');
  const wq = calculateSheetQuote({ design: designOf(FIXTURES.wardrobe), bom: { materials: w.materials, hardware: w.hardware }, cutPlan: { summary: { sheetsByMaterial: { PB_15: 10, 'MDF_2.7': 4, MDF_18: 3 } } } });
  assert.ok(wq.cost.quantities.sheetsPB < 10, String(wq.cost.quantities.sheetsPB));
  // 수율을 설정으로 바꾸면 장수가 따라온다
  const lowYield = areaSheets(SINK_BOM, { ...DEFAULT_QUOTE, pbYield: 0.6 });
  assert.ok(lowYield.pb > a.pb);
});

test('고정비 회수: 몸통 PB 1장마다 32,800원을 원가에 더하고 마진도 같이 붙는다 (캐비닛 · 시공 m당 20만 원에 맞춘 값)', () => {
  assert.equal(DEFAULT_QUOTE.fixedPerPbSheet, 32800);
  const q = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT });
  const off = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT, settings: { quote: { fixedPerPbSheet: 0 } } });
  const pb = q.cost.quantities.sheetsPB;
  assert.equal(q.cost.body.fixed, Math.round(pb * 32800));
  assert.equal(q.cost.fixed_recovery, q.cost.body.fixed);
  assert.equal(off.cost.fixed_recovery, 0);
  // 몸통 줄 단가가 장당 32,800 × 1.2 = 39,360 오른다 (100원 단위 반올림 차이만)
  const body = (x) => x.items.find((i) => i.name.startsWith('몸통'));
  assert.ok(Math.abs(body(q).unit_price - body(off).unit_price - 32800 * 1.2) <= 100, `${body(q).unit_price} - ${body(off).unit_price}`);
  const pbody = (x) => x.partner.items.find((i) => i.name.startsWith('몸통'));
  assert.ok(Math.abs(pbody(q).unit_price - pbody(off).unit_price - 32800 * 1.08) <= 100);
});

// ── 기본값 — 캐비닛 · 시공 m당 20만 원, 업체 = 소비자 × 0.9, 서랍 박스 ──

const cabinetLines = (items) => items.filter((i) => /^(몸통|뒷판|도어|시공)/.test(i.name));

test('표준 싱크대(sink15) 기본 설정 — 몸통 소비자 123,900 · 업체 111,500, 캐비닛 · 시공 m당 약 20만 원(부가세 포함)', () => {
  const q = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT });
  const body = (items) => items.find((i) => i.name.startsWith('몸통'));
  assert.equal(body(q.items).unit_price, 123900);
  assert.equal(body(q.partner.items).unit_price, 111500);
  // 캐비닛(몸통 + 뒷판 + 도어 + 시공) 소비자 공급가 ÷ 시공 7.6m × 1.1
  const cabinet = cabinetLines(q.items).reduce((s, i) => s + i.total, 0);
  assert.equal(cabinet, 1381320);
  assert.equal(Math.round((cabinet * 1.1) / 7.6), 199928);
});

test('서랍 박스 — 레일 수만큼 한 줄 (도어 다음), 소비자 50,000 · 업체 45,000, 원가는 cost.drawerBox 로 합계에 든다', () => {
  assert.equal(DEFAULT_QUOTE.drawerBox, 41667);
  const q = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT });
  const names = q.items.map((i) => i.name);
  assert.equal(names.indexOf('서랍 박스'), names.findIndex((n) => n.startsWith('도어')) + 1);
  assert.deepEqual(q.items.find((i) => i.name === '서랍 박스'), { name: '서랍 박스', quantity: '2개', unit_price: 50000, total: 100000 });
  assert.deepEqual(q.partner.items.find((i) => i.name === '서랍 박스'), { name: '서랍 박스', quantity: '2개', unit_price: 45000, total: 90000 });
  assert.equal(q.cost.quantities.drawers, 2);
  assert.equal(q.cost.drawerBox, 2 * 41667);
  assert.equal(q.cost.priced_total, q.subtotal);
  // 서랍 자재 · 레일 · 조립 노무는 몸통 줄에 그대로 — 서랍 박스 값을 0 으로 두면 몸통 원가는 같고 서랍 박스 줄만 빠진다
  const off = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT, settings: { quote: { drawerBox: 0 } } });
  assert.ok(!off.items.some((i) => i.name === '서랍 박스'));
  assert.deepEqual(off.cost.body, q.cost.body);
  assert.equal(off.cost.drawerBox, 0);
  assert.equal(q.cost.total - off.cost.total, 2 * 41667);
});

test('서랍 박스 — 서랍(레일)이 없으면 줄이 없다', () => {
  const noRails = { materials: SINK_BOM.materials, hardware: SINK_BOM.hardware.filter((h) => h.category !== '레일') };
  const q = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: noRails, cutPlan: SINK_CUT });
  assert.equal(q.cost.quantities.drawers, 0);
  assert.ok(!q.items.some((i) => i.name === '서랍 박스'));
  assert.ok(!q.partner.items.some((i) => i.name === '서랍 박스'));
  assert.equal(q.cost.drawerBox, 0);
});

test('업체 금액 ≈ 소비자 금액 × 0.9 — 줄마다 100원 반올림 차이 안', () => {
  const w = golden('wardrobe');
  for (const [design, bom, cutPlan] of [
    [designOf(FIXTURES.sink15), SINK_BOM, SINK_CUT],
    [designOf(FIXTURES.wardrobe), { materials: w.materials, hardware: w.hardware }, null],
  ]) {
    const q = calculateSheetQuote({ design, bom, cutPlan });
    assert.ok(Math.abs(q.partner.subtotal - q.subtotal * 0.9) <= 100 * q.items.length, `${q.partner.subtotal} vs ${q.subtotal * 0.9}`);
    q.items.forEach((i, k) => assert.ok(Math.abs(q.partner.items[k].unit_price - i.unit_price * 0.9) <= 100, `${i.name} ${q.partner.items[k].unit_price} vs ${i.unit_price * 0.9}`));
  }
});

test('업체 금액을 내지 않는 견적(partnerPrice: false)에도 서랍 박스 줄은 소비자 금액으로 든다', () => {
  const q = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT, partnerPrice: false });
  assert.equal(q.partner, null);
  assert.equal(q.cost.partner_margin_amount, null);
  assert.equal(q.items.find((i) => i.name === '서랍 박스').unit_price, 50000);
  assert.equal(q.cost.drawerBox, 2 * 41667);
});

test('서랍 박스 원가는 설정으로 바꾼다 — 저장 검증이 받고, 기본값과 합친다', () => {
  assert.deepEqual(sanitizeSettings({ quote: { drawerBox: 50000 } }), { quote: { drawerBox: 50000 } });
  assert.throws(() => sanitizeSettings({ quote: { drawerBox: -1 } }), /범위/);
  assert.equal(mergeSettings(null).quote.drawerBox, 41667);
  assert.equal(mergeSettings({ quote: { drawerBox: 50000 } }).quote.drawerBox, 50000);
  const q = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT, settings: mergeSettings({ quote: { drawerBox: 50000 } }) });
  assert.equal(q.items.find((i) => i.name === '서랍 박스').unit_price, 60000);
});

test('월 손익 · 만약에 판 · 견적 대비 실적이 서랍 박스 원가를 지출로 본다', () => {
  const q = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT });
  const orders = [{ id: 'O1', order_no: 'SO-1', snapshot_id: 's1', status: 'confirmed', contract_amount: q.total, ordered_at: '2026-10-06T01:00:00Z' }];
  const snaps = new Map([['s1', { id: 's1', quote_payload: q }]]);
  // 월 손익의 지출 = 견적 원가 − 고정비 회수분 (서랍 박스 포함)
  const month = summarizeMonth(orders, snaps, { month: '2026-10', overheadMonthly: 0 });
  assert.equal(month.rows[0].cost, q.cost.total - q.cost.fixed_recovery);
  // 만약에 판의 갈래 합 = 변동원가 (반올림 몇 원만)
  const b = scenarioBase(orders, snaps, {}, '2026-10');
  const f = financeOf(orders, snaps, { month: '2026-10', overheadMonthly: 0 });
  const variable = b.material + b.hardware + b.door + b.outsourcing + b.labor + b.overheadAlloc;
  assert.ok(Math.abs(b.revenueCustomer + b.revenuePartner - variable - f.contribution) <= 10, `${b.revenueCustomer - variable} vs ${f.contribution}`);
  assert.equal(estimateByCategory(q).other, q.cost.drawerBox);
});
