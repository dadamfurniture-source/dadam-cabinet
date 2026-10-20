/**
 * 수납장 내부 보기 (2026-10-20 사장님 "수납장·신발장·화장대 순서대로").
 * 선반 수는 정본 extractors.js bomSimpleDefaultShelfCount (= 플래너 calcDefaultShelves) 와 같아야 한다 —
 * 워커는 옮겨 적었으므로 높이 전부에서 대조한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  SIMPLE_SHELF_RULES,
  buildStorageInteriorPrompt,
  simpleShelfCount,
  tallShelfPlan,
} from '../src/prompts.js';

const require = createRequire(import.meta.url);
const X = require('../../../js/detaildesign/extractors.js');

test('선반 수 = 정본 bomSimpleDefaultShelfCount (일반·신발장, 100~3000)', () => {
  const R = X.BOM_SIMPLE_CATEGORY_RULES;
  for (let h = 100; h <= 3000; h += 1) {
    assert.equal(simpleShelfCount(h), X.bomSimpleDefaultShelfCount(h, 'tall', R.storage), `storage ${h}`);
    assert.equal(simpleShelfCount(h, SIMPLE_SHELF_RULES.space.shoe), X.bomSimpleDefaultShelfCount(h, 'tall', R.shoerack), `shoe ${h}`);
  }
});

test('칸 간격 상수가 정본과 같다', () => {
  const R = X.BOM_SIMPLE_CATEGORY_RULES;
  assert.deepEqual(SIMPLE_SHELF_RULES.space.shoe, { min: R.shoerack.shelfSpace.min, max: R.shoerack.shelfSpace.max });
  for (const k of ['storage', 'vanity']) {
    const sp = R[k].shelfSpace || { min: 300, max: 450 };
    assert.deepEqual(SIMPLE_SHELF_RULES.space.general, { min: sp.min, max: sp.max }, k);
  }
});

test('문서 예: 몸통 2190 → 일반 6 · 신발장 13 (simple-categories.md §6.0)', () => {
  assert.equal(simpleShelfCount(2190), 6);
  assert.equal(simpleShelfCount(2190, SIMPLE_SHELF_RULES.space.shoe), 13);
  assert.deepEqual(tallShelfPlan(2310), { bodyH: 2190, shelves: 6, gap: 313 });
  assert.equal(tallShelfPlan().bodyH, 2190);
});

test('내부 보기 지시문: 문 전부 열림, 정본 선반만, 서랍 없음, 손잡이 규칙', () => {
  const { prompt, label, plan } = buildStorageInteriorPrompt({ wallH: 2400, tag: '기본 구조' });
  const { shelves, gap } = tallShelfPlan(2400);
  assert.match(prompt, /Open every door/);
  assert.equal(shelves, 6);
  assert.ok(prompt.includes('with 6 fixed shelves'));
  assert.ok(prompt.includes(`about ${gap} mm apart`));
  assert.match(prompt, /No drawers/);
  assert.match(prompt, /Handleless doors stay handleless/);
  assert.doesNotMatch(prompt, /bar handle|push-to-open/i);
  assert.equal(label, '내부 보기 · 기본 구조');
  assert.equal(plan, `칸마다 선반 ${shelves}단 (간격 약 ${gap})`);
});
