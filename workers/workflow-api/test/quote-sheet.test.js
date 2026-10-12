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
import { calculateSheetQuote, installMeters, doorSheets, edgeMeters, hardwareCounts, nonCabinetItems } from '../src/quote-sheet.js';

const require = createRequire(import.meta.url);
const { FIXTURES, designOf } = require('../../../test-utils/bom-golden/fixtures.js');
const golden = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../test-utils/bom-golden/${name}.golden.json`, import.meta.url)), 'utf8'));

const SINK = golden('sink15');
const SINK_BOM = { materials: SINK.materials, hardware: SINK.hardware };
const SINK_CUT = { summary: { sheetsByMaterial: { PB_15: 6, 'MDF_2.7': 3, MDF_18: 2 } } };

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

test('견적 줄: 단가 × 수량 = 금액, 캐비닛 금액 ≈ 원가 × 1.2, 합계 = 공급가 + 부가세 10%', () => {
  const q = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT });
  assert.equal(q.method, 'sheet');
  assert.equal(q.margin_rate, 0.2);
  const names = q.items.map((i) => i.name);
  assert.ok(names[0].startsWith('몸통 제작'));
  assert.deepEqual(q.items.map((i) => i.quantity), ['6장', '3장', '2장', '7.6m']);
  for (const i of q.items) assert.equal(i.total, Math.round(i.unit_price * parseFloat(i.quantity)));
  // 단가를 100원 단위로 반올림해서 생기는 차이만 허용
  assert.ok(Math.abs(q.cost.cabinet_price - q.cost.total * 1.2) <= 100 * 7.6 + 300, `${q.cost.cabinet_price} vs ${q.cost.total * 1.2}`);
  assert.equal(q.subtotal, q.items.reduce((s, i) => s + i.total, 0));
  assert.equal(q.vat, Math.round(q.subtotal * 0.1));
  assert.equal(q.total, q.subtotal + q.vat);
  // 시공 단가 = 4만 × 1.2
  assert.equal(q.items[3].unit_price, 48000);
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
  const cheapDoor = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT, settings: { quote: { doorSheet: 87000 } } });
  assert.equal(cheapDoor.cost.door.outsourcing, 174000);
});

test('상판·설비·철거는 단가표 줄을 그대로 붙이고, 캐비닛·도어 업차지 줄은 장당 견적이 대신한다', () => {
  const legacy = { items: [
    { name: '싱크대 하부장 캐비닛', total: 1 },
    { name: '싱크대 상판 (인조대리석)', quantity: '4100mm', unit_price: 150000, total: 615000 },
    { name: '싱크대 수전', quantity: '1개', unit_price: 40000, total: 40000 },
    { name: '도어 마감 업그레이드', total: 5 },
    { name: '기존 철거', quantity: '7600mm', unit_price: 30000, total: 228000 },
  ] };
  const extra = nonCabinetItems(legacy);
  assert.deepEqual(extra.map((i) => i.name), ['싱크대 상판 (인조대리석)', '싱크대 수전', '기존 철거']);
  const q = calculateSheetQuote({ design: designOf(FIXTURES.sink15), bom: SINK_BOM, cutPlan: SINK_CUT, extraItems: extra, range: { min: 0.95, max: 1.3 } });
  assert.deepEqual(q.items.slice(-3).map((i) => i.total), [615000, 40000, 228000]);
  assert.equal(q.cost.cabinet_price, q.items.slice(0, 4).reduce((s, i) => s + i.total, 0));
  assert.equal(q.range.min, Math.round(q.total * 0.95));
});

test('붙박이장 골든도 계산된다 (재단 배치 없이 면적으로 원판 추정)', () => {
  const w = golden('wardrobe');
  const q = calculateSheetQuote({ design: designOf(FIXTURES.wardrobe), bom: { materials: w.materials, hardware: w.hardware }, cutPlan: null });
  assert.equal(q.cost.sheet_source, 'area');
  assert.ok(q.cost.quantities.sheetsPB >= 8);
  assert.ok(q.items.find((i) => i.name.startsWith('시공')).quantity === '5.4m');
  assert.ok(q.total > 0);
});
