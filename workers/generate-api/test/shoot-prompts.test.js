/**
 * 2026-11-20: 홍보용 「촬영 연출」 프롬프트 (src/shoot-prompts.js).
 *
 * 고정하는 것:
 *   1) 손잡이 문장이 연출컷(prompts.js HANDLES_LINE)과 글자 그대로 같다 — CLAUDE.md 매립형 규칙
 *   2) 한 장의 프롬프트에 그 색 조합의 두 색, 구조, 렌즈, 빛이 모두 들어가고 「문 닫힘 · 사람 · 글자 없음」이 있다
 *   3) 목록은 시드가 같으면 같고, 시드가 다르면 다르다
 *   4) 12장을 짜면 구조 · 촬영 · 빛 · 색이 고르게 나온다 (대표님 "다양한 구조로") — 주방이 절반
 *   5) 색 바꿈 프롬프트는 가구 색만 바꾸고 나머지는 그대로 두라고 한다
 *   6) 자재(상판 · 바닥 · 식탁)가 장마다 들어가고 고르게 돈다 (대표님 "식탁의 재질, 자재 종류도 다양하게")
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TWO_TONES } from '../src/prompts.js';
import {
  SHOOT_HANDLES_LINE,
  SHOOT_SUBJECTS,
  SHOOT_SHOTS,
  SHOOT_LIGHTS,
  SHOOT_SURFACES,
  SHOOT_FLOORS,
  SHOOT_TABLES,
  SHOOT_SOFT,
  planShoots,
  buildShootPrompt,
  buildShootRecolourPrompt,
} from '../src/shoot-prompts.js';

test('손잡이 문장은 연출컷과 같다', () => {
  const src = readFileSync(new URL('../src/prompts.js', import.meta.url), 'utf8');
  assert.ok(src.includes(`'${SHOOT_HANDLES_LINE}'`), 'prompts.js 의 HANDLES_LINE 과 달라졌다');
});

test('한 장의 프롬프트에 색 · 구조 · 렌즈 · 빛이 들어간다', () => {
  for (const s of planShoots({ count: 12, seed: 7 })) {
    const p = buildShootPrompt(s);
    assert.ok(p.includes(s.tone.upper) && p.includes(s.tone.lower), `${s.id}: 두 색`);
    assert.ok(p.includes(s.layout.scene), `${s.id}: 구조`);
    assert.ok(p.includes(s.shot.camera), `${s.id}: 렌즈`);
    assert.ok(p.includes(s.light.light), `${s.id}: 빛`);
    assert.ok(p.includes(SHOOT_HANDLES_LINE), `${s.id}: 손잡이`);
    assert.match(p, /All doors and drawers are closed/);
    assert.match(p, /No people, no pets, no text, no logos, no watermark/);
    assert.match(p, /must not look like a 3D render/);
    assert.doesNotMatch(p, /undefined|\[object/);
  }
});

test('시드가 같으면 같은 목록, 다르면 다른 목록', () => {
  const ids = (seed) =>
    planShoots({ count: 8, seed }).map((s) => `${s.id}/${s.shot.key}/${s.light.key}`);
  assert.deepEqual(ids(20261120), ids(20261120));
  assert.notDeepEqual(ids(20261120), ids(20261121));
});

test('12장이면 구조 · 촬영 · 빛 · 색이 고르게 나온다', () => {
  const plan = planShoots({ count: 12, seed: 20261120 });
  const uniq = (f) => new Set(plan.map(f)).size;
  assert.equal(plan.filter((s) => s.subject === 'kitchen').length, 6, '주방이 절반');
  // 품목마다: 찍는 장 수가 구조 수보다 많아지기 전에는 같은 구조가 되풀이되지 않는다
  for (const [key, subj] of Object.entries(SHOOT_SUBJECTS)) {
    const mine = plan.filter((s) => s.subject === key);
    const kinds = new Set(mine.map((s) => s.layout.key)).size;
    assert.equal(kinds, Math.min(mine.length, subj.layouts.length), `${key}: 구조가 고르게`);
  }
  assert.equal(
    uniq((s) => s.shot.key),
    SHOOT_SHOTS.length
  );
  assert.equal(
    uniq((s) => s.light.key),
    SHOOT_LIGHTS.length
  );
  assert.equal(
    uniq((s) => s.tone.key),
    TWO_TONES.length
  );
});

test('자재가 장마다 들어가고 고르게 돈다', () => {
  const plan = planShoots({ count: 12, seed: 20261120 });
  const dining = plan.filter((s) => s.subject !== 'wardrobe');
  const rooms = plan.filter((s) => s.subject === 'wardrobe');
  const kinds = (list, f) => new Set(list.map(f)).size;
  assert.equal(
    kinds(dining, (s) => s.surface.key),
    SHOOT_SURFACES.length,
    '상판 여섯 가지'
  );
  assert.equal(
    kinds(dining, (s) => s.table.key),
    SHOOT_TABLES.length,
    '식탁 여섯 가지'
  );
  assert.equal(
    kinds(plan, (s) => s.floor.key),
    SHOOT_FLOORS.length,
    '바닥 네 가지'
  );
  assert.equal(
    kinds(rooms, (s) => s.table.key),
    Math.min(rooms.length, SHOOT_SOFT.length)
  );
  assert.ok(
    rooms.every((s) => s.surface === null),
    '붙박이장에는 상판이 없다'
  );
  for (const s of plan) {
    const p = buildShootPrompt(s);
    assert.ok(p.includes(s.floor.text), `${s.id}: 바닥`);
    assert.ok(p.includes(s.table.text), `${s.id}: 식탁 · 곁가구`);
    if (s.surface) assert.ok(p.includes(s.surface.text), `${s.id}: 상판`);
    else assert.doesNotMatch(p, /SURFACES:/);
  }
});

test('품목을 좁히면 그 품목만 나온다', () => {
  const plan = planShoots({ count: 5, seed: 3, subjects: ['wardrobe'] });
  assert.ok(plan.every((s) => s.subject === 'wardrobe'));
});

test('색 바꿈은 가구 색만 바꾼다', () => {
  const [s] = planShoots({ count: 1, seed: 1 });
  const other = TWO_TONES.find((t) => t.key !== s.tone.key);
  const p = buildShootRecolourPrompt(s, other);
  assert.ok(p.includes(other.upper) && p.includes(other.lower));
  assert.match(p, /Recolour only the built-in furniture/);
  assert.match(p, /Keep everything else exactly as photographed/);
  assert.ok(p.includes(SHOOT_HANDLES_LINE));
});

test('색 조합마다 예림 도어 자재 — 이름 · 색값이 예림 목록과 같다', async () => {
  const { readFileSync } = await import('node:fs');
  const { SHOOT_YERIM, SHOOT_TONES, shootTone } = await import('../src/shoot-prompts.js');
  const yerim = JSON.parse(
    readFileSync(new URL('../../../database/seed/yerim-lux.json', import.meta.url), 'utf8')
  ).items;
  for (const t of TWO_TONES) {
    for (const word of [t.upper, t.lower]) {
      const m = SHOOT_YERIM[word];
      assert.ok(m, `${word}: 예림 자재가 없다`);
      const it = yerim.find((x) => x.vendor_code === m.code);
      assert.ok(it, `${m.code}: 예림 목록에 없다`);
      assert.equal(it.color_name, m.name);
      assert.equal(it.color_hex, m.hex);
      assert.equal(it.category, 'door_material');
    }
  }
  assert.equal(SHOOT_TONES.length, TWO_TONES.length);
  const cw = shootTone('cream-walnut');
  assert.equal(cw.tone, '매트 아이보리 · 카카오월넛');
  assert.equal(shootTone('크림 · 월넛'), cw);
  assert.deepEqual(cw.materials, ['SM-16', 'PW-23']);
  // 프롬프트에는 색값이 들어가고, 자재 이름 · 상표는 들어가지 않는다
  const p = buildShootPrompt(planShoots({ count: 1, seed: 3 })[0]);
  assert.match(p, /colour #[0-9a-f]{6}/);
  assert.doesNotMatch(p, /[가-힣]|yerim/i);
});
