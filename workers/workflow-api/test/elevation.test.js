/**
 * 치수 정면도 (docs/01-plan/work-order-stage.plan.md §4.4) — 동결된 설계로 서버가 그린다.
 * 표준 3종(싱크 일자 3m · 붙박이장 3600 · 냉장고장) + 옛 설계·어긋난 설계의 검증 경고.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elevationModel, elevationSvg, bandsOf, lineOf, moduleDrawingSvg } from '../src/templates/elevation.js';
import { renderWorkOrder } from '../src/templates/work-order.js';
import * as ef from './fixtures/elevation.js';
import * as fx from './fixtures/work-order-v2.js';

const sum = (arr) => arr.reduce((s, v) => s + v, 0);
const errors = (model) => model.notes.filter((x) => x.level === 'error');

test('표준 3종 — 바닥 줄 폭(틈 포함)이 품목 폭과 맞고 검증 경고가 없다', () => {
  for (const item of [ef.sink3000(), ef.wardrobe3600(), ef.fridge()]) {
    const m = elevationModel(item);
    assert.equal(m.positioned, true, item.labelName);
    assert.deepEqual(errors(m), [], item.labelName);
    assert.equal(m.W, item.w);
    const floor = m.placed.filter((e) => e.line === 'floor');
    const end = Math.max(...floor.map((e) => e.x + e.w));
    assert.equal(end, item.w, `${item.labelName} 바닥 줄 끝 = 품목 폭`);
  }
  const sink = elevationModel(ef.sink3000());
  assert.equal(sum(sink.placed.filter((e) => e.line === 'floor').map((e) => e.w)), 3000, '싱크 하부 폭 사슬 합');
  assert.equal(sum(sink.placed.filter((e) => e.line === 'upper').map((e) => e.w)), 3000, '싱크 상부 폭 사슬 합');
  assert.equal(sum(elevationModel(ef.wardrobe3600()).placed.map((e) => e.w)), 3600);
});

test('세로 — 하부는 바닥에서 다리·몸통·상판, 상부는 천장에 매달려 몸통·몰딩, 붙박이장은 좌대·몸통·몰딩', () => {
  const sink = elevationModel(ef.sink3000());
  const l = sink.placed.find((e) => e.m.id === 'planner-l2');
  assert.deepEqual(l.bands.map((b) => [b.part, b.h]), [['leg', 150], ['body', 688], ['top', 12]]);
  assert.equal(l.y0, 0);
  assert.equal(l.total, 850);
  const u = sink.placed.find((e) => e.m.id === 'planner-u2');
  assert.deepEqual(u.bands.map((b) => [b.part, b.h]), [['body', 720], ['molding', 60]]);
  assert.equal(u.y0, 2300 - 780);
  assert.equal(sink.H, 2300);

  const wr = elevationModel(ef.wardrobe3600()).placed[0];
  assert.deepEqual(wr.bands.map((b) => [b.part, b.h]), [['pedestal', 60], ['body', 2230], ['molding', 20]]);
  assert.equal(wr.total, 2310);
  assert.equal(lineOf({ pos: 'wardrobe' }), 'floor');
  assert.equal(lineOf({ pos: 'upper' }), 'upper');

  // 높이 구성이 없는 옛 모듈은 몸통 한 띠 (totalH, 없으면 h)
  assert.deepEqual(bandsOf({ pos: 'lower', h: 870 }).bands, [{ part: 'body', h: 870 }]);
  assert.equal(bandsOf({ pos: 'lower', h: 688, totalH: 850 }).total, 850);
});

test('싱크 정면도 SVG — 번호 1..8, 폭 사슬, 전체 폭·높이, 띠 치수, 사이', () => {
  const svg = elevationSvg(ef.sink3000());
  assert.ok(svg.startsWith('<svg class="elevation" viewBox="0 0 '));
  for (let i = 1; i <= 8; i++) assert.ok(svg.includes(`font-weight="700" text-anchor="middle">${i}</text>`), `번호 ${i}`);
  assert.equal(svg.split('>600</text>').length - 1, 4, '600 폭 상·하 2개씩');
  assert.equal(svg.split('>1,000</text>').length - 1, 2);
  for (const s of ['W 3,000', 'H 2,300', '다리 150', '몸통 688', '상판 12', '사이 670', '상부 몸통 720', '몰딩 60', '개수대', '후드장', '서랍 3단', '천장']) {
    assert.ok(svg.includes(s), s);
  }
  assert.ok(!svg.includes('#c00'), '경고 없음');
});

test('냉장고장 — 냉장고 자리는 틈으로, 키큰장 옆 상부장은 세로 치수를 다음 열로', () => {
  const svg = elevationSvg(ef.fridge());
  assert.ok(svg.includes('font-style="italic">(950)</text>'), '바닥 줄의 냉장고 자리');
  assert.ok(svg.includes('아래 1,900'), '상부장 아래 끝까지 (2300 − 400)');
  assert.ok(svg.includes('좌대 60'));
  assert.ok(svg.includes('몸통 2,180'));
  assert.ok(svg.includes('냉장고상부장'));
});

test('옛 설계(위치·높이 구성 없음) — 순서대로 붙이고 안내, 폭 합이 다르면 빨간 경고', () => {
  const item = fx.design().items[0]; // 하부 1000 · 상부 800, 품목 폭 2400
  const m = elevationModel(item);
  assert.equal(m.positioned, false);
  assert.ok(m.notes.some((x) => x.level === 'info' && x.text.startsWith('배치 위치 정보가 없어')));
  assert.deepEqual(errors(m).map((x) => x.text), ['하부 모듈 폭 합 1,000 ≠ 품목 폭 2,400 (Δ -1,400)']);
  const svg = elevationSvg(item);
  assert.ok(svg.includes('fill="#c00"'));
  assert.ok(svg.includes('⚠ 하부 모듈 폭 합 1,000 ≠ 품목 폭 2,400'));
});

test('어긋난 설계 — 폭 초과 · 상부가 하부를 파고듦 · 위치 겹침(코너)', () => {
  const over = ef.sink3000();
  over.modules[7] = { ...over.modules[7], w: 1200 };
  assert.deepEqual(errors(elevationModel(over)).map((x) => x.text), ['하부 모듈 끝 3,200 이 품목 폭 3,000 을 넘습니다 (Δ 200)']);

  const low = ef.sink3000();
  low.modules[0] = { ...low.modules[0], totalH: 1600, h: 1540 };
  assert.ok(errors(elevationModel(low)).some((x) => x.text === '상부 1 아래 끝(700)이 하부 5 위 끝(850)보다 낮습니다'));

  const corner = ef.sink3000();
  corner.modules[6] = { ...corner.modules[6], _x: 0 }; // 다른 벽 — 배치 좌표가 겹친다
  const m = elevationModel(corner);
  assert.equal(m.positioned, false);
  assert.ok(m.notes.some((x) => x.text.startsWith('배치 위치가 겹쳐')));
  assert.deepEqual(errors(m), [], '순서대로 붙이면 합은 3000 그대로');
});

test('모듈이 없거나 치수가 0 이면 그리지 않는다 · 이름은 이스케이프', () => {
  assert.equal(elevationSvg({ w: 1000, h: 2300, modules: [] }), '');
  assert.equal(elevationSvg({ w: 1000, modules: [{ pos: 'lower', w: 0, h: 700 }] }), '');
  const bad = ef.sink3000();
  bad.modules[4] = { ...bad.modules[4], name: '<script>x</script>' };
  const svg = elevationSvg(bad);
  assert.ok(!svg.includes('<script>'));
});

test('모듈 치수도 — 같은 품목은 같은 축척(viewBox), 키 작은 장은 바닥에 선다', () => {
  const frame = { w: 1000 + 580, h: 720 };
  const a = moduleDrawingSvg({ w: 600, h: 688, d: 580 }, frame);
  const b = moduleDrawingSvg({ w: 1000, h: 720, d: 320 }, frame);
  const vb = (s) => s.match(/viewBox="([^"]+)"/)[1];
  assert.equal(vb(a), vb(b));
  assert.ok(a.includes('W 600') && a.includes('D 580') && a.includes('>688</text>'));
  assert.equal(moduleDrawingSvg({ w: 0, h: 100 }), '');
});

test('작업지시서 — 표지·재단·조립 꾸러미에 정면도, ⑪ 은 전체·조립에만, 번호가 명세·체크와 같다', () => {
  const snap = fx.snapshot({ design_payload: { items: [ef.sink3000()] } });
  const all = renderWorkOrder(fx.doc(), snap, { toolbar: false });
  assert.ok(all.includes('<div class="section-title">정면도</div>'));
  assert.ok(all.includes('<svg class="elevation"'));
  assert.ok(all.includes('싱크대 · 정면도 (mm)'));
  assert.ok(all.includes('⑪ 모듈 치수도'));
  assert.equal(all.split('<svg class="module-drawing"').length - 1, 8);
  assert.ok(all.includes('<td class="num"><b>6</b></td><td>하부</td><td>개수대</td>'), '모듈 명세 번호');
  assert.ok(all.includes('<b>6</b> 하부 개수대'), '조립 체크 번호');

  const cut = renderWorkOrder(fx.doc(), snap, { toolbar: false, pack: 'cut' });
  assert.ok(cut.includes('<svg class="elevation"'));
  assert.ok(!cut.includes('⑪ 모듈 치수도'));
  const asm = renderWorkOrder(fx.doc(), snap, { toolbar: false, pack: 'assembly' });
  assert.ok(asm.includes('<svg class="elevation"') && asm.includes('⑪ 모듈 치수도'));
  const door = renderWorkOrder(fx.doc(), snap, { toolbar: false, pack: 'door' });
  assert.ok(!door.includes('<svg class="elevation"'), '외주처 종이에는 정면도 없음');
  const labels = renderWorkOrder(fx.doc(), snap, { toolbar: false, pack: 'labels' });
  assert.ok(!labels.includes('<svg class="elevation"'));

  const old = renderWorkOrder(fx.doc(), fx.snapshot(), { toolbar: false });
  assert.ok(old.includes('배치 위치 정보가 없어 순서대로 붙여 그렸습니다'));
});
