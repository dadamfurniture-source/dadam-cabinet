/**
 * CAD 베타 PR17b — 모듈 단면도 (src/templates/module-section.js).
 *   입력은 동결 명세 bom_payload.assembly — 골든 픽스처(합성)에서 bom-assembly.js 가 만든 진짜 명세.
 *   완료 기준: 명세 없는 옛 스냅샷은 지금 페이지 그대로(work-order-golden.test.js) · 도면마다 rev 와 content_hash ·
 *   묶음 HTML 골든 (명세 있는 조립 묶음, fixtures/work-order-assembly-spec.golden.html).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as fx from './fixtures/work-order-v2.js';
import { renderWorkOrder } from '../src/templates/work-order.js';
import { moduleSectionOf, moduleSectionGroups, moduleSectionsSheet } from '../src/templates/module-section.js';

globalThis.dlog = globalThis.dlog || (() => {});
const require = createRequire(import.meta.url);
const { specOf } = require('../../../test-utils/assembly-fixtures.js');

const lf = (s) => s.split('\r\n').join('\n');
const rowMap = (materials) => new Map(materials.map((m) => [String(m.partId), m]));
const modOf = (spec, key) => spec.items.flatMap((it) => it.modules).find((m) => m.moduleKey === key);

function asmSnapshot(name = 'sink15') {
  const { materials, spec } = specOf(name);
  return fx.snapshot({ bom_payload: { materials, assembly: spec }, cut_plan_payload: null });
}

test('상부장 — 가운데 면에 걸리는 판재: 지판 · 밴드 2 · 선반 2 · 처짐방지 · 천판 · 뒷판 (도어 · 측판은 빼고)', () => {
  const { materials, spec } = specOf('sink15');
  const s = moduleSectionOf(modOf(spec, '0-u1'), rowMap(materials));
  assert.deepEqual(s.cut.map((r) => r.part).sort(), ['뒷판', '밴드(보강목)', '밴드(보강목)', '밴드(처짐방지)', '선반', '선반', '지판', '천판'].sort());
  assert.ok(!s.cut.some((r) => r.part === '측판' || r.part === '도어'));
  assert.equal(s.fronts.length, 2, '도어 두 짝은 윤곽으로');
  // 몸통 뒤 · 앞 = 측판 z 끝, 뒷판은 뒤에서 15~18 (사쿠리 홈 자리)
  assert.equal(s.front - s.back, 295);
  const back = s.cut.find((r) => r.part === '뒷판');
  assert.deepEqual([back.z0 - s.back, back.z1 - s.back], [15, 18]);
  // 왼쪽 측판 배경 — 홈 하나가 뒤에서 15~18
  assert.equal(s.sides.length, 1);
  assert.deepEqual(s.sides[0].features.map((f) => [f.type, f.z0 - s.back, f.z1 - s.back]), [['groove', 15, 18]]);
});

test('서랍장 — 측판 목찬넬 따내기는 앞 끝 40, 위 끝 · 중간 (명세 frame 그대로 z · y 로)', () => {
  const { materials, spec } = specOf('sink15');
  const s = moduleSectionOf(modOf(spec, '0-l2'), rowMap(materials));
  const notches = s.sides[0].features.filter((f) => f.type === 'notch').map((f) => [s.front - f.z1, f.z1 - f.z0, f.y0, f.y1]);
  assert.deepEqual(notches.sort((a, b) => a[2] - b[2]), [[0, 40, 160, 250], [0, 40, 638, 708]]);
  assert.ok(s.cut.some((r) => r.part === '서랍밑판'));
  assert.ok(s.cut.some((r) => /목찬넬/.test(r.part)));
  assert.equal(s.fronts.length, 3, '도어 1 + 서랍 전면 2');
});

test('같은 단면은 한 장 — 모듈 수는 명세 모듈 수 이하, 이름은 BOM module', () => {
  const { materials, spec } = specOf('sink15');
  const groups = moduleSectionGroups(spec, materials);
  const n = groups.reduce((s, g) => s + g.modules.length, 0);
  assert.ok(n <= spec.items.reduce((s, it) => s + it.modules.length, 0));
  assert.ok(groups.length <= n);
  groups.forEach((g) => g.modules.forEach((m) => assert.ok(m.name && m.name !== m.moduleKey, m.moduleKey)));
});

test('명세 없음 · 다른 스키마 → 쪽이 없다', () => {
  const { materials, spec } = specOf('sink15');
  assert.equal(moduleSectionsSheet({ assembly: null, materials }), '');
  assert.equal(moduleSectionsSheet({ assembly: { ...spec, schema: 'x' }, materials }), '');
  assert.equal(moduleSectionsSheet({ assembly: { ...spec, items: [] }, materials }), '');
});

test('조립 묶음 — 단면도 쪽이 치수도 뒤에, 도면마다 rev · content_hash · 규칙 버전', () => {
  const snap = asmSnapshot();
  const html = renderWorkOrder(fx.doc(), snap, { toolbar: false, pack: 'assembly' });
  const at = html.indexOf('⑪-2 모듈 단면도');
  assert.ok(at > html.indexOf('⑪ 모듈 치수도'), '치수도 다음');
  const cards = html.split('class="module-section-card"').length - 1;
  assert.ok(cards > 0);
  assert.equal(html.split('<svg class="module-section"').length - 1, cards);
  const stamp = `rev 3 · ${snap.content_hash.slice(0, 12)} · 규칙 ${snap.bom_payload.assembly.rulesVersion}`;
  assert.equal(html.split(stamp).length - 1, cards + 1, '쪽 머리 + 도면마다');
  assert.ok(renderWorkOrder(fx.doc(), snap, { toolbar: false, pack: 'all' }).includes('⑪-2 모듈 단면도'));
  ['cut', 'door', 'cut-vendor', 'labels'].forEach((pack) => {
    assert.ok(!renderWorkOrder(fx.doc(), snap, { toolbar: false, pack }).includes('⑪-2 모듈 단면도'), pack);
  });
});

test('도장은 발행 때 굳힌 render_payload.cad 를 먼저 쓴다', () => {
  const doc = fx.doc();
  doc.render_payload = { ...doc.render_payload, cad: { snapshot_rev: 7, content_hash: 'feedfacecafe0000', rules_version: 'x' } };
  const html = renderWorkOrder(doc, asmSnapshot(), { toolbar: false, pack: 'assembly' });
  assert.ok(html.includes('rev 7 · feedfacecafe'));
});

test('명세 있는 조립 묶음 HTML = 골든 (합성 sink15)', () => {
  const url = new URL('./fixtures/work-order-assembly-spec.golden.html', import.meta.url);
  const html = renderWorkOrder(fx.doc(), asmSnapshot(), { toolbar: false, pack: 'assembly' });
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(url)) { writeFileSync(url, html, 'utf8'); return; }
  assert.equal(lf(html), lf(readFileSync(url, 'utf8')));
});

test('골든 9종 — 모든 명세에서 단면이 깨지지 않는다 (NaN · undefined · Infinity 없음)', () => {
  ['sink15', 'sink18', 'sinkCorner', 'shoerack', 'vanity', 'storage', 'warehouse', 'wardrobe', 'fridge'].forEach((name) => {
    const { materials, spec } = specOf(name);
    const html = moduleSectionsSheet({ assembly: spec, materials, rev: 1, contentHash: 'h' });
    assert.ok(html.length > 0, name);
    assert.ok(!/NaN|undefined|Infinity/.test(html), name);
  });
});
