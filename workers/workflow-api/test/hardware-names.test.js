// 철물 이름 — 바뀐 품명 짝 · 주문 거래처 (2026-11-21, src/hardware-names.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHardwareItem, canonicalMatchKey, hardwareMatchKey, linksByCanonicalKey, hardwareShownOf, noMaker } from '../src/hardware-names.js';
import { moduleInfoRows } from '../src/templates/assembly-layout2.js';

test('바뀐 품명 — 예전 레일 · 경첩 이름은 지금 이름으로, 그 밖은 그대로', () => {
  assert.equal(canonicalHardwareItem('레일', '댐핑 언더레일'), '문주 댐핑 언더레일');
  assert.equal(canonicalHardwareItem('레일', '소프트클로즈 서랍레일'), '문주 댐핑 언더레일');
  assert.equal(canonicalHardwareItem('레일', '댐핑 볼레일'), '문주 댐핑 볼레일');
  assert.equal(canonicalHardwareItem('경첩', 'H052W-3 105도 저압 경첩'), '문주 H052W-3 105도 저압 경첩');
  assert.equal(canonicalHardwareItem('다리발', '조절 다리발'), '조절 다리발');
  assert.equal(canonicalHardwareItem('경첩', '댐핑 언더레일'), '댐핑 언더레일', '분류가 다르면 그대로');
  assert.equal(canonicalMatchKey('H|레일|문주 언더레일'), 'H|레일|문주 댐핑 언더레일');
  assert.equal(canonicalMatchKey('B|PB|15'), 'B|PB|15');
  assert.deepEqual(hardwareMatchKey(' 레일 ', ' 댐핑  언더레일 '), { key: 'H|레일|문주 댐핑 언더레일', label: '레일 · 문주 댐핑 언더레일' });
});

test('짝표 — 예전 키 줄도 지금 키로, 둘 다 있으면 지금 키 줄', () => {
  const m = linksByCanonicalKey([
    { match_key: 'H|레일|댐핑 언더레일', item_id: 'old' },
    { match_key: 'H|레일|문주 댐핑 언더레일', item_id: 'new' },
    { match_key: 'H|레일|문주 언더레일', item_id: 'old2' },
    { match_key: 'H|경첩|H052W-5 105도 저압 경첩', item_id: 'h' },
  ]);
  assert.equal(m.get('H|레일|문주 댐핑 언더레일').item_id, 'new');
  assert.equal(m.get('H|경첩|문주 H052W-5 105도 저압 경첩').item_id, 'h');
});

test('보이는 품명 — 회사를 모르는 철물만 주문 거래처를 앞에, 거래처가 없으면 품명만', () => {
  const sup = { 'H|다리발|조절 다리발': '모아가구철물', 'H|레일|문주 댐핑 언더레일': '무림상사' };
  assert.deepEqual(hardwareShownOf({ category: '다리발', item: '조절 다리발', manufacturer: '-' }, sup), { item: '모아가구철물 조절 다리발', maker: '모아가구철물' });
  assert.deepEqual(hardwareShownOf({ category: '레일', item: '문주 댐핑 언더레일', manufacturer: '문주' }, sup), { item: '문주 댐핑 언더레일', maker: '문주' }, '엔진 회사가 있으면 그대로');
  assert.deepEqual(hardwareShownOf({ category: '브라켓', item: '선반 브라켓 (핀타입)', manufacturer: '' }, sup), { item: '선반 브라켓 (핀타입)', maker: '' });
  assert.deepEqual(hardwareShownOf({ category: '다리발', item: '조절 다리발', manufacturer: '-' }, new Map([['H|다리발|조절 다리발', '가나']])).item, '가나 조절 다리발');
  assert.equal(noMaker({ manufacturer: '-' }), true);
  assert.equal(noMaker({ manufacturer: '문주' }), false);
});

test('조립 카드 — 철물 · 다리발 줄에 주문 거래처', () => {
  const mod = { parts: [], hardware: [{ kind: 'leg', category: '다리발', item: '조절 다리발', spec: '150mm', manufacturer: '-' }, { kind: 'leg', category: '다리발', item: '조절 다리발', spec: '150mm', manufacturer: '-' }] };
  const hw = [{ category: '브라켓', item: '선반 브라켓 (핀타입)', manufacturer: '-', spec: 'Φ5mm', qty: 8, unit: 'EA' }];
  const sup = { 'H|다리발|조절 다리발': '모아가구철물', 'H|브라켓|선반 브라켓 (핀타입)': '무림상사' };
  const info = Object.fromEntries(moduleInfoRows({ rows: [], hardware: hw, mod, colorName: (c) => c, suppliers: sup }));
  assert.equal(info['다리발 · 좌대'], '모아가구철물 조절 다리발 150mm × 2');
  assert.equal(info['철물'], '브라켓 무림상사 선반 브라켓 (핀타입) Φ5mm × 8개');
  const plain = Object.fromEntries(moduleInfoRows({ rows: [], hardware: hw, mod, colorName: (c) => c }));
  assert.equal(plain['다리발 · 좌대'], '다리발 150mm × 2', '거래처가 없으면 예전 그대로');
});
