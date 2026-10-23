/**
 * CAD 베타 PR17 — 판재 도면 (src/templates/part-drawing.js).
 *   입력은 동결 명세 bom_payload.assembly — 골든 픽스처(합성)에서 bom-assembly.js 가 만든 진짜 명세.
 *   완료 기준: 명세 없는 옛 스냅샷은 지금 페이지 그대로(work-order-golden.test.js) · 도면마다 rev 와 content_hash ·
 *   묶음 HTML 골든 (명세 있는 재단 묶음, fixtures/work-order-cut-assembly.golden.html).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as fx from './fixtures/work-order-v2.js';
import { renderWorkOrder } from '../src/templates/work-order.js';
import {
  partDrawingGroups, outlineSegments, featureLabel, featuresOf, partDrawingsSheet, specParts,
} from '../src/templates/part-drawing.js';

globalThis.dlog = globalThis.dlog || (() => {});
const require = createRequire(import.meta.url);
const { specOf } = require('../../../test-utils/assembly-fixtures.js');

const lf = (s) => s.split('\r\n').join('\n');
const notDoor = (r) => r.slot !== 'door';

/** 명세 있는 스냅샷 — 자재 행 · 명세 모두 sink15 (합성) */
function asmSnapshot(name = 'sink15') {
  const { materials, spec } = specOf(name);
  return fx.snapshot({ bom_payload: { materials, assembly: spec }, cut_plan_payload: null });
}

test('outlineSegments — 위 앞 모서리를 따낸 판은 경계 6 변, 둘레 = 사각형 둘레', () => {
  const segs = outlineSegments(550, 708, [{ u0: 510, u1: 550, v0: 638, v1: 708 }]);
  const len = segs.reduce((s, [a, b, c, d]) => s + Math.abs(c - a) + Math.abs(d - b), 0);
  assert.equal(len, 2 * (550 + 708));
  // 따낸 자리 안쪽 꼭짓점 (510, 638) 을 지나는 두 변이 있다
  assert.ok(segs.some(([a, b, c, d]) => a === 510 && c === 510 && Math.min(b, d) === 638));
  assert.ok(segs.some(([a, b, c, d]) => b === 638 && d === 638 && Math.max(a, c) === 550));
  // 따내기 없으면 네 변
  assert.equal(outlineSegments(100, 50, []).length, 4);
});

test('featureLabel — 크기 · 가까운 끝에서의 자리 · 홈은 깊이 미정(D5)', () => {
  const g = { w: 550, h: 708, u: '+z', v: '+y' };
  assert.equal(featureLabel({ type: 'notch', u0: 510, u1: 550, v0: 638, v1: 708 }, g), '따내기 40 × 70 (앞 끝 · 위 끝)');
  assert.equal(featureLabel({ type: 'notch', u0: 510, u1: 550, v0: 300, v1: 390 }, g), '따내기 40 × 90 (앞 끝 · 아래에서 300)');
  const groove = featureLabel({ type: 'groove', u0: 15, u1: 18, v0: 0, v1: 708, face: 'inner', depth: null }, { w: 295, h: 708, u: '+z', v: '+y' });
  assert.equal(groove, '홈 폭 3 (뒤에서 15 · 아래 끝) · 안쪽 면 · 깊이 미정 (D5)');
});

test('sink15 — 따내기 · 홈 판재만 같은 도면끼리 (도어 행은 뺀다)', () => {
  const { materials, spec } = specOf('sink15');
  const groups = partDrawingGroups(spec, materials, { include: notDoor });
  assert.equal(groups.length, 3);
  const all = specParts(spec).filter(({ p }) => featuresOf(p).length);
  assert.equal(groups.reduce((s, g) => s + g.pieces.length, 0), all.length, '특징 있는 판재는 전부 어느 도면엔가 든다');
  groups.forEach((g) => {
    assert.equal(g.part, '측판');
    assert.equal(new Set(g.pieces.map((x) => x.id)).size, g.pieces.length);
  });
  assert.deepEqual(groups.map((g) => g.features.map((f) => f.type).join('+')).sort(), ['groove', 'notch', 'notch+notch']);
});

test('명세 없음 · 다른 스키마 · 그릴 판재 없음 → 쪽이 없다', () => {
  const { materials, spec } = specOf('sink15');
  assert.equal(partDrawingsSheet({ assembly: null, materials }), '');
  assert.equal(partDrawingsSheet({ assembly: { ...spec, schema: 'x' }, materials }), '');
  assert.equal(partDrawingsSheet({ assembly: spec, materials, include: () => false }), '');
});

test('재단 묶음 — 판재 도면 쪽이 재단 쪽 뒤에, 도면마다 rev · content_hash · 규칙 버전', () => {
  const snap = asmSnapshot();
  const html = renderWorkOrder(fx.doc(), snap, { toolbar: false, pack: 'cut' });
  const at = html.indexOf('③-2 판재 도면');
  assert.ok(at > html.indexOf('③ 재단·엣지 지시서'), '재단 쪽 다음');
  const cards = html.split('class="part-drawing-card"').length - 1;
  assert.equal(cards, 3);
  assert.equal(html.split('<svg class="part-drawing"').length - 1, 3);
  const stamp = `rev 3 · ${snap.content_hash.slice(0, 12)} · 규칙 ${snap.bom_payload.assembly.rulesVersion}`;
  assert.equal(html.split(stamp).length - 1, cards + 1, '쪽 머리 + 도면마다');
  // 전체 묶음에도 같은 쪽
  assert.ok(renderWorkOrder(fx.doc(), snap, { toolbar: false, pack: 'all' }).includes('③-2 판재 도면'));
  // 조립 · 도어 · 외주 재단 묶음에는 없다
  ['assembly', 'door', 'cut-vendor', 'labels'].forEach((pack) => {
    assert.ok(!renderWorkOrder(fx.doc(), snap, { toolbar: false, pack }).includes('③-2 판재 도면'), pack);
  });
});

test('도장은 발행 때 굳힌 render_payload.cad 를 먼저 쓴다', () => {
  const snap = asmSnapshot();
  const doc = fx.doc();
  doc.render_payload = { ...doc.render_payload, cad: { snapshot_rev: 7, content_hash: 'feedfacecafe0000', rules_version: 'x' } };
  const html = renderWorkOrder(doc, snap, { toolbar: false, pack: 'cut' });
  assert.ok(html.includes('rev 7 · feedfacecafe'));
});

test('명세 있는 재단 묶음 HTML = 골든 (합성 sink15)', () => {
  const url = new URL('./fixtures/work-order-cut-assembly.golden.html', import.meta.url);
  const html = renderWorkOrder(fx.doc(), asmSnapshot(), { toolbar: false, pack: 'cut' });
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(url)) { writeFileSync(url, html, 'utf8'); return; }
  assert.equal(lf(html), lf(readFileSync(url, 'utf8')));
});

test('골든 9종 — 모든 명세에서 도면이 깨지지 않는다 (NaN · undefined 없음)', () => {
  ['sink15', 'sink18', 'sinkCorner', 'shoerack', 'vanity', 'storage', 'warehouse', 'wardrobe', 'fridge'].forEach((name) => {
    const { materials, spec } = specOf(name);
    const html = partDrawingsSheet({ assembly: spec, materials, include: notDoor, rev: 1, contentHash: 'h' });
    assert.ok(html.length > 0, name);
    assert.ok(!/NaN|undefined/.test(html), name);
  });
});
