// 소부품 「빼기」 — 재단 지시서의 「밴드 재고에서 꺼낼 것」 (2026-11-19 사장님 「빼기는 밴드 재고 운영, 60*2440의 밴드」)
//   — src/templates/work-order.js bandCutsOf · uncoveredInHouse · cutOrderOf · 재단 꾸러미 표. 시험 데이터는 합성.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWorkOrder, bandCutsOf, uncoveredInHouse, labelNumbers } from '../src/templates/work-order.js';
import * as fx from './fixtures/work-order-v2.js';

const strip = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const BAND_ROW = { partId: '0-l1-body:band#0-0', slot: 'body', itemLabel: '싱크대', module: '하부장-개수대', part: '밴드', material: 'PB', thickness: 15, w: 60, h: 970, qty: 3, edge: '2면(장)', edges: { T: true, B: true }, edgeT: 0.6 };
const BAND_STOCK = {
  width: 60, length: 2440, material: 'PB', thickness: 15, kerf: 4,
  groups: [{
    material: 'PB', thickness: 15, color: '화이트', strips: 2,
    parts: [{ partId: BAND_ROW.partId, part: '밴드', w: 60, h: 970, qty: 3 }],
    cuts: [
      { no: 1, used: 1944, pieces: [{ partId: `${BAND_ROW.partId}#0`, part: '밴드', len: 970 }, { partId: `${BAND_ROW.partId}#1`, part: '밴드', len: 970 }] },
      { no: 2, used: 970, pieces: [{ partId: `${BAND_ROW.partId}#2`, part: '밴드', len: 970 }] },
    ],
  }],
};
const planOf = (band) => ({ ...fx.cutPlan(), strategy: 'standard', ...(band ? { smallMode: 'stock', bandStock: band } : {}) });
const snapshotOf = (band) => fx.snapshot({ bom_payload: { materials: fx.materials().concat([BAND_ROW]) }, cut_plan_payload: planOf(band) });
const doc = () => fx.doc({ render_payload: { ...fx.doc().render_payload, label_order: 'cut', cut_plan: undefined } });

test('재고 밴드 조각 — 본 차례로 · 옛 배치는 빈 목록', () => {
  assert.deepEqual(bandCutsOf(planOf(BAND_STOCK)).map((c) => [c.color, c.no, c.used, c.pieces.length]), [['화이트', 1, 1944, 2], ['화이트', 2, 970, 1]]);
  assert.deepEqual(bandCutsOf(planOf(null)), []);
  assert.deepEqual(bandCutsOf(null), []);
});

test('재고 밴드 조각은 「배치에 없는 부재」가 아니다 · 라벨은 원장 조각 다음 차례', () => {
  const mats = fx.materials().concat([BAND_ROW]);
  assert.deepEqual(uncoveredInHouse(mats, planOf(BAND_STOCK)).filter((u) => u.row === BAND_ROW), []);
  assert.equal(uncoveredInHouse(mats, planOf(null)).filter((u) => u.row === BAND_ROW).length, 1, '재고 밴드가 없으면 배치에 없는 부재');
  const nos = labelNumbers(mats, planOf(BAND_STOCK));
  // 사내 원장 조각(본체) 다음 — 도어재(외주) 라벨은 사내 뒤에 따로 매긴다
  const sheetMax = Math.max(...planOf(null).sheets.filter((s) => s.partClass !== '도어').flatMap((s) => s.parts.map((p) => nos.get(p.partId) || 0)));
  const bandNos = [0, 1, 2].map((k) => nos.get(`${BAND_ROW.partId}#${k}`));
  assert.ok(bandNos.every((n) => n > sheetMax), JSON.stringify({ sheetMax, bandNos }));
  assert.deepEqual(bandNos, [bandNos[0], bandNos[0] + 1, bandNos[0] + 2]);
});

test('재단 꾸러미 — 「밴드 재고에서 꺼낼 것」 표 (색 · 본 · 자를 것 · 쓴 길이), 재고 밴드가 없으면 없다 · 외주처 종이에는 없다', () => {
  const text = strip(renderWorkOrder(doc(), snapshotOf(BAND_STOCK), { toolbar: false, pack: 'cut' }));
  assert.match(text, /밴드 재고에서 꺼낼 것 PB 15T · 60 × 2,?440 본 · 화이트 2본 — 원장에서 켜지 않는다/);
  assert.match(text, /화이트 1 \S+ 밴드 970 · \S+ 밴드 970 1,?944/);
  // 견본의 뒷판 한 줄은 원래 배치에 없다 — 밴드는 그 표에 없다
  assert.doesNotMatch(text.slice(text.indexOf('배치에 없는 부재')), /하부장-개수대 밴드/);
  assert.doesNotMatch(strip(renderWorkOrder(doc(), snapshotOf(null), { toolbar: false, pack: 'cut' })), /밴드 재고에서 꺼낼 것/);
  assert.doesNotMatch(strip(renderWorkOrder(doc(), snapshotOf(BAND_STOCK), { toolbar: false, pack: 'cut-vendor' })), /밴드 재고에서 꺼낼 것/);
});
