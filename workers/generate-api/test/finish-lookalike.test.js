/**
 * 색 추천안에서 기본안 문짝 색과 같은 계열 빼기 (2026-10-20).
 * 흰 문짝 붙박이장(벽 3000·3200)에서 색 추천안이 '무광 화이트'로 뽑혀 기본안과 거의 같은 그림이 됐다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOOR_COLOR_LOOKALIKES, FINISHES, finishLookalikes, pickFinishes } from '../src/prompts.js';

test('문짝 색 목록(ai-design.html #doorColor)과 짝이 맞고, 가리키는 키는 모두 FINISHES 에 있다', () => {
  const html = readFileSync(fileURLToPath(new URL('../../../ai-design.html', import.meta.url)), 'utf8');
  const select = html.match(/<select id="doorColor">([\s\S]*?)<\/select>/)[1];
  const values = [...select.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(values.length >= 5);
  const keys = FINISHES.map((f) => f.key);
  for (const v of Object.keys(DOOR_COLOR_LOOKALIKES)) assert.ok(values.includes(v), `${v} 는 화면에 있는 색이다`);
  for (const list of Object.values(DOOR_COLOR_LOOKALIKES)) for (const k of list) assert.ok(keys.includes(k), k);
  // 같은 계열 추천 색이 없는 문짝 색(라이트 그레이)은 빼는 것이 없다
  assert.deepEqual(finishLookalikes('light grey'), []);
  assert.deepEqual(finishLookalikes(' White '), ['matte-white']);
  assert.deepEqual(finishLookalikes(undefined), []);
});

test('빼고 뽑기: 어떤 시드에서도 뺀 색이 나오지 않고, 빼는 것이 없으면 예전과 같다', () => {
  for (let seed = 1; seed < 400; seed++) {
    for (const door of Object.keys(DOOR_COLOR_LOOKALIKES)) {
      const ex = finishLookalikes(door);
      const got = pickFinishes(3, seed, ex).map((f) => f.key);
      assert.equal(got.length, 3);
      assert.ok(!got.some((k) => ex.includes(k)), `${door} ${seed} ${got}`);
    }
    assert.deepEqual(pickFinishes(3, seed, []), pickFinishes(3, seed));
  }
  // 어제 흰 문짝에서 무광 화이트가 나온 벽 폭 (시드 = 벽 폭 + 품목 길이 × 7919)
  for (const w of [3000, 3200, 3600]) {
    const seed = w + 'wardrobe'.length * 7919;
    assert.equal(pickFinishes(1, seed)[0].key, 'matte-white', '고치기 전에는 무광 화이트');
    assert.notEqual(pickFinishes(1, seed, finishLookalikes('white'))[0].key, 'matte-white');
  }
});
