// 소부품 더하기 · 빼기 — 재단 배치의 재고 밴드 블록 (2026-11-19 사장님 「소부품 더하기, 빼기로 구분해서 더하기는 2.밴드도 원장에 놓기 : 재단에 포함 시키고,
//   빼기는 밴드 재고 운영, 60*2440의 밴드를 18개 기본 재고로 만들고 8개가 남으면 새로운 밴드재고 만들기로 요청.」)
//   — src/snapshots.js validateCutPlan (smallMode · bandStock) · src/util/hash.js cutDigestOf
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCutPlan } from '../src/snapshots.js';
import { cutDigestOf } from '../src/util/hash.js';
import { ValidationError } from '../src/supabase.js';
import * as fx from './fixtures/work-order-v2.js';

const BAND_ROW = { partId: 'band-1', slot: 'body', itemLabel: '싱크대', module: '하부장-개수대', part: '밴드', material: 'PB', thickness: 15, w: 60, h: 870, qty: 3, edge: '2면(장)' };
const bom = () => ({ materials: fx.materials().concat([BAND_ROW]) });
const BAND = {
  width: 60,
  length: 2440,
  material: 'PB',
  thickness: 15,
  kerf: 4,
  groups: [{
    material: 'PB', thickness: 15, color: '화이트', strips: 2,
    parts: [{ partId: 'band-1', part: '밴드', w: 60, h: 870, qty: 3 }],
    cuts: [
      { no: 1, used: 1744, pieces: [{ partId: 'band-1#0', part: '밴드', len: 870 }, { partId: 'band-1#1', part: '밴드', len: 870 }] },
      { no: 2, used: 870, pieces: [{ partId: 'band-1#2', part: '밴드', len: 870 }] },
    ],
  }],
};
const plan = (extra) => ({ ...fx.cutPlan(), strategy: 'standard', ...extra });

test('재고 밴드 — 받을 때 모양을 본다: 자재 행에 있는 부재 · 본 길이 안 · 원장 조각과 같이 수량을 넘지 않는다', () => {
  const ok = validateCutPlan(plan({ smallMode: 'stock', bandStock: BAND }), bom());
  assert.equal(ok.cutPlan.bandStock, BAND);
  assert.equal(validateCutPlan(plan({ smallMode: 'place' }), bom()).sheetCount, 2);
  const g = BAND.groups[0];
  const bad = [
    { bandStock: 'x' },
    { bandStock: { ...BAND, groups: 'x' } },
    { bandStock: { ...BAND, length: 0 } },
    { bandStock: { ...BAND, groups: [{ ...g, cuts: [{ no: 1, pieces: [] }] }] } },
    { bandStock: { ...BAND, groups: [{ ...g, cuts: [{ no: 1, pieces: [{ partId: 'nope#0', len: 870 }] }] }] } },
    { bandStock: { ...BAND, groups: [{ ...g, cuts: [{ no: 1, pieces: [{ partId: 'band-1#0', len: 0 }] }] }] } },
    // 본 길이를 넘음 — 870 × 3 + 톱날 둘 = 2618
    { bandStock: { ...BAND, groups: [{ ...g, cuts: [{ no: 1, pieces: [0, 1, 2].map((k) => ({ partId: `band-1#${k}`, len: 870 })) }] }] } },
    // 수량 3 인데 넷
    { bandStock: { ...BAND, groups: [{ ...g, cuts: [...g.cuts, { no: 3, pieces: [{ partId: 'band-1#3', len: 870 }] }] }] } },
    { bandStock: { ...BAND, groups: [{ ...g, color: 'x'.repeat(41) }] } },
    { smallMode: 'Stock!' },
  ];
  for (const extra of bad) assert.throws(() => validateCutPlan(plan(extra), bom()), ValidationError, JSON.stringify(extra).slice(0, 80));
});

test('판정 — 소부품 모드 · 재고 밴드가 있으면 다른 판, 없으면 예전과 같은 값', () => {
  const a = cutDigestOf(plan());
  const b = cutDigestOf(plan({ smallMode: 'stock', bandStock: BAND }));
  const c = cutDigestOf(plan({ smallMode: 'place' }));
  assert.equal('smallMode' in a, false);
  assert.equal('bandStock' in a, false);
  assert.deepEqual(b.bandStock, { width: 60, length: 2440, groups: [{ color: '화이트', cuts: [[{ partId: 'band-1#0', len: 870 }, { partId: 'band-1#1', len: 870 }], [{ partId: 'band-1#2', len: 870 }]] }] });
  assert.equal(c.smallMode, 'place');
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual({ ...b, smallMode: undefined, bandStock: undefined }, { ...a, smallMode: undefined, bandStock: undefined });
});
