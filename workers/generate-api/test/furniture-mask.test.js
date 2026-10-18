/**
 * 기본안에서 가구 윤곽 찾기 (2026-10-19) — 프롬프트·응답 풀기.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFurnitureMaskPrompt, convexHull, parseFurnitureMask } from '../src/furniture-mask.js';

const size = { width: 1000, height: 800 };

test('프롬프트: 픽셀 [x, y], 싱크대는 상부장·하부장을 따로, 붙박이장은 한 덩어리', () => {
  const k = buildFurnitureMaskPrompt('kitchen', size);
  assert.match(k, /1000 x 800 pixels/);
  assert.match(k, /wall-cabinet run and the base-cabinet run/);
  const w = buildFurnitureMaskPrompt('wardrobe', size);
  assert.match(w, /built-in wardrobe/);
  assert.doesNotMatch(w, /worktop and plinth included/);
});

test('볼록 껍질: 순서가 엉켜도 둘레 순서, 안쪽 점은 빠진다', () => {
  const h = convexHull([{ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
  assert.equal(h.length, 4);
  assert.ok(!h.some((p) => p.x === 0.5));
});

test('풀기: 픽셀 → 0~1, 작은 조각은 버리고, 사진을 거의 덮으면 전부 버린다', () => {
  const r = parseFurnitureMask({ blocks: [
    { name: 'upper', outline: [[100, 80], [900, 80], [900, 300], [100, 300]] },
    { name: 'dot', outline: [[5, 5], [10, 5], [10, 10]] },
    { name: 'bad', outline: [[1, 2]] },
  ] }, size);
  assert.equal(r.length, 1);
  assert.ok(r[0].some((p) => Math.abs(p.x - 0.9) < 1e-9 && Math.abs(p.y - 0.375) < 1e-9));
  assert.equal(parseFurnitureMask({ blocks: [{ name: 'all', outline: [[0, 0], [1000, 0], [1000, 800], [0, 800]] }] }, size), null);
  assert.equal(parseFurnitureMask({ blocks: [] }, size), null);
  assert.equal(parseFurnitureMask('not json', size), null);
  // 문자열 응답도 푼다
  assert.equal(parseFurnitureMask(JSON.stringify({ blocks: [{ name: 'a', outline: [[0, 0], [500, 0], [500, 400]] }] }), size).length, 1);
});
