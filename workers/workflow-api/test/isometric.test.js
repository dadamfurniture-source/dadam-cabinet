/**
 * 코너 품목 아이소메트릭 (사장님 결정 Q4, 계획 work-order-stage.plan.md §7).
 * 브리지 `_place` 로 평면 자리를 되살려 그린다. 일자 품목은 정면도 그대로.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCornerItem, bestTurn, isoModel, isoSvg, runLengths, visibleFrontMid } from '../src/templates/isometric.js';
import { renderWorkOrder } from '../src/templates/work-order.js';
import * as ef from './fixtures/elevation.js';
import * as fx from './fixtures/work-order-v2.js';

test('코너 판정 — 모든 모듈에 자리가 있고 앞면 방향이 둘 이상일 때만', () => {
  assert.equal(isCornerItem(ef.lShape()), true);
  assert.equal(isCornerItem(ef.sink3000()), false, '자리 없음');
  const straight = ef.lShape();
  straight.modules = straight.modules.filter((m) => m._place.front[1] === 1);
  assert.equal(isCornerItem(straight), false, '앞면 한 방향 = 일자');
  const partial = ef.lShape();
  delete partial.modules[3]._place;
  assert.equal(isCornerItem(partial), false, '자리 빠진 모듈이 있으면 정면도로');
});

test('보는 방향 — 앞면이 가장 많이 보이게 돌린다 (+y · −x 앞면 → 둘 다 보이게)', () => {
  assert.equal(bestTurn([[0, 1], [-1, 0]]), 3);
  assert.equal(bestTurn([[0, 1], [1, 0]]), 0);
  const { boxes } = isoModel(ef.lShape());
  assert.ok(boxes.every((b) => b.front[0] > 0 || b.front[1] > 0), '모든 앞면이 보이는 면(+x · +y)');
  const corner = boxes.find((b) => b.no === 5);
  assert.equal(Math.round(corner.alongX ? corner.x1 - corner.x0 : corner.y1 - corner.y0), 1000);
  assert.equal(boxes.find((b) => b.no === 1).z0, 1520, '상부장은 천장에 매달린 높이');
});

test('줄 길이 — 바닥 줄마다 (상부 제외), 번호 작은 줄부터', () => {
  assert.deepEqual(runLengths(ef.lShape()), [
    { first: 3, length: 2400, nos: [3, 4, 5] },
    { first: 6, length: 2000, nos: [6, 7, 8] },
  ]);
  assert.deepEqual(runLengths(ef.sink3000()), []);
});

test('번호 자리 — 코너 멍장은 옆벽 모듈에 가리지 않은 구간 가운데', () => {
  const { boxes } = isoModel(ef.lShape());
  const corner = boxes.find((b) => b.no === 5);
  const t = visibleFrontMid(corner, boxes);
  const [s0, s1] = corner.alongX ? [corner.x0, corner.x1] : [corner.y0, corner.y1];
  // 1000 중 600 은 옆벽 모듈(깊이 600) 뒤 — 보이는 400 의 가운데
  assert.ok(Math.abs(t - s0 - 200) < 1 || Math.abs(s1 - t - 200) < 1, `t=${t} s0=${s0} s1=${s1}`);
  const free = boxes.find((b) => b.no === 3);
  const [f0, f1] = free.alongX ? [free.x0, free.x1] : [free.y0, free.y1];
  assert.equal(visibleFrontMid(free, boxes), (f0 + f1) / 2, '막히지 않은 모듈은 가운데');
});

test('SVG — 상자 8개(면 3장씩) · 번호 1~8 · 폭 · 전체 높이', () => {
  const svg = isoSvg(ef.lShape());
  assert.ok(svg.startsWith('<svg class="elevation iso"'));
  assert.equal(svg.split('<polygon').length - 1, 8 * 3);
  for (let i = 1; i <= 8; i++) assert.ok(svg.includes(`font-weight="700" text-anchor="middle">${i}</text>`), `번호 ${i}`);
  for (const w of ['600', '800', '1,000']) assert.ok(svg.includes(`>${w}</text>`), w);
  assert.ok(svg.includes('H 2,300'));
  // 번호는 맨 위층 — 마지막 다각형 뒤에 모든 번호
  assert.ok(svg.lastIndexOf('<polygon') < svg.indexOf('font-weight="700"'));
  assert.equal(isoSvg(ef.sink3000()), '');
});

test('작업지시서 — 코너 품목은 아이소메트릭, 일자 품목은 정면도', () => {
  const snap = fx.snapshot({ design_payload: { items: [ef.lShape(), ef.sink3000()] } });
  const html = renderWorkOrder(fx.doc(), snap, { toolbar: false, pack: 'cut' });
  assert.ok(html.includes('<svg class="elevation iso"'));
  assert.ok(html.includes('ㄱ자 싱크대 · 아이소메트릭 (코너 · mm)'));
  assert.ok(html.includes('<b>3~5번 줄 2,400 · 6~8번 줄 2,000</b>'));
  assert.ok(html.includes('싱크대 · 정면도 (mm)'), '일자 품목은 그대로');
  assert.ok(!html.includes('배치 위치가 겹쳐'), '코너 품목에 옛 안내가 뜨지 않는다');
});
