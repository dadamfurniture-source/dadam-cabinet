/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, window */
/**
 * SEGAN 「구매 · 재고 › 기본 자재」 맨 위 밴드 재고 칸 (segan/stock-bands.js — 2026-11-20 소부품 「빼기」)
 *   빼기 팩토리만 보인다 · 색마다 남은 본 · 만들기 요청 줄(「만들었음」 · 대표 · 실장만 「요청 취소」) · 대표 · 실장만 「밴드 품목 만들기」.
 *   색 이름은 지어낸 것이다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// eslint-disable-next-line no-new-func
new Function(read('segan/stock-bands.js'))();
const B = window.SeganStockBands;

const DATA = (over = {}) => ({
  can_manage: true,
  mode: 'stock',
  band: { width: 60, length: 2440, material: 'PB', thickness: 15, base: 18, reorder: 8 },
  items: [
    { id: 'i1', color: '화이트', spec: 'PB 15T · 화이트', unit: '본', qty: 8, short: true, request: { id: 'r1', code: 'BM-0001', qty: 18 } },
    { id: 'i2', color: '', spec: 'PB 15T · 색 없음', unit: '본', qty: 30, short: false, request: null },
  ],
  ...over,
});
const BOARDS = [{ id: 'b1', name: 'PB 15T 원장', spec: '화이트', unit: '장', qty: 5 }];
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('밴드 재고 칸', () => {
  test('보이는 때 — 빼기 팩토리 · 밴드 품목이 있거나 · 대표 · 실장 (설계마다 빼기, 2026-11-20). 더하기 팩토리의 품목 없는 직원 · 못 읽음이면 빈 글', () => {
    expect(B.html(DATA({ mode: 'place', can_manage: false, items: [] }), BOARDS, {})).toBe('');
    expect(B.html(DATA({ mode: 'place', can_manage: true, items: [] }), BOARDS, {})).toMatch(/data-sb-items/);
    expect(B.html(DATA({ mode: 'place', can_manage: false }), BOARDS, {})).toMatch(/BM-0001/);
    expect(B.html(null, BOARDS, {})).toBe('');
  });

  test('머리 · 색마다 남은 본 · 만들 때 표시 · 만들기 요청 줄 (원장 고르기 · 만들었음 · 요청 취소)', () => {
    const h = B.html(DATA(), BOARDS, {});
    const t = strip(h);
    expect(t).toMatch(/밴드 재고 PB 15T · 60 × 2440 · 18본씩 · 8본 남으면/);
    expect(t).toMatch(/화이트 PB 15T · 화이트 8본 만들 때 만들기 요청 BM-0001 · 18본/);
    expect(t).toMatch(/색 없음 PB 15T · 색 없음 30본/);
    expect(h).toMatch(/data-sb-sheet="r1"[^>]*><option value="">원장 없이 \(밴드만 입고\)<\/option><option value="b1">PB 15T 원장 · 화이트 \(5장\)<\/option>/);
    expect(h).toMatch(/data-sb-made="r1"/);
    expect(h).toMatch(/data-sb-cancel="r1"/);
    expect(h).toMatch(/data-sb-items/);
  });

  test('구성원 — 취소 · 품목 만들기 단추가 없다, 처리 중이면 단추가 꺼진다', () => {
    const h = B.html(DATA({ can_manage: false }), BOARDS, {});
    expect(h).not.toMatch(/data-sb-cancel/);
    expect(h).not.toMatch(/data-sb-items/);
    expect(B.html(DATA(), BOARDS, { busy: true })).toMatch(/data-sb-made="r1" disabled/);
  });

  test('stock.js 가 기본 자재 화면에 자리를 주고 mount 를 부른다 · me.html 이 싣는다', () => {
    const stock = read('segan/stock.js');
    expect(stock).toMatch(/kind === 'board' \? '<div data-st-bands hidden><\/div>' : ''/);
    expect(stock).toMatch(/window\.SeganStockBands\.mount\(bandSlot, \{ base: J\.base, token: token \}\)/);
    expect(read('segan/me.html')).toMatch(/<script src="stock-bands\.js\?v=\d+" defer><\/script>/);
  });
});
