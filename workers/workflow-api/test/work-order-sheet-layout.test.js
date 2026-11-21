/**
 * 작업지시서 새 판 (sheet_layout 2 — src/templates/work-order-layout2.js) — 재단 · 엣지 지시서 · 도어재 발주서
 *   (2026-11-20 사장님 「재단: 도면은 필요없음 … 표를 삭제하고, 원장표시를 크게 해서 부재 안에 수치와 엣지 표시 … 엣지 표시가 다 연결 되지 않고, 끊겨서 …
 *    어떤 모듈인지도 표시, 재단선도 옅게 … 도어가 발주라면 발주에만 생성, 내수라면 재단지시서에 포함 … 도어에 보링이 있다면 보링도 표시」 ·
 *    「도어재 발주 : 재단지시서와 같은 형식」)
 *   옛 문서(sheet_layout 없음)는 예전 틀 그대로 — 골든 시험들이 그대로 지킨다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWorkOrder } from '../src/templates/work-order.js';
import { guillotineCuts, bigSheetSvg } from '../src/templates/work-order-layout2.js';
import { docPayloadOf, SHEET_LAYOUT } from '../src/documents.js';
import * as fx from './fixtures/work-order-v2.js';

const snapshotWith = (processing) => fx.snapshot({ design_payload: { ...fx.design(), source: 'planner-lite', ...(processing ? { processing } : {}) } });
const docV2 = (rp = {}) => fx.doc({ render_payload: { ...fx.doc().render_payload, label_order: 'cut', drawing_version: 1, sheet_layout: 2, ...rp } });
const sheetNos = (html) => [...html.matchAll(/원장 #(\d+)/g)].map((m) => Number(m[1]));

test('발행 칸 — 작업지시서 · 현장 지시서는 새 판(sheet_layout 2)을 고정한다', async () => {
  assert.equal(SHEET_LAYOUT, 2);
  const snapshot = fx.snapshot();
  const collect = (kind, items) => items.map((it, i) => ({ item_index: i, item_unique_id: i + 1, path: null }));
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => [], text: async () => '[]' });
  try {
    const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    const wo = await docPayloadOf(env, { docType: 'work_order', snapshot, designId: null, collect, site: { site_info: null, schedules: [] }, prevRev: false });
    assert.equal(wo.sheet_layout, 2);
    const dv = await docPayloadOf(env, { docType: 'delivery_order', snapshot, designId: null, collect, site: { site_info: null, schedules: [] }, prevRev: false });
    assert.equal(dv.sheet_layout, 2, '현장 지시서도 새 틀 (2026-11-20)');
  } finally { globalThis.fetch = original; }
});

test('재단 새 판 — 원장 내용 집계 · 원장마다 큰 그림, 부재 표 · 정면도 · 판재 도면 · 부재마다 엣지 쪽은 없다', () => {
  const html = renderWorkOrder(docV2(), snapshotWith(null), { toolbar: false, pack: 'cut' });
  assert.match(html, /<div class="section-title">원장 내용<\/div>/);
  assert.match(html, /<th>자재<\/th><th class="num">두께<\/th><th>구분<\/th><th>색상<\/th><th class="num">원장<\/th><th class="num">조각<\/th>/);
  assert.doesNotMatch(html, /엣지 \(두께 · 변 길이×개수\)/, '조각 표 없음');
  const body = html.slice(html.indexOf('<body>'));
  assert.doesNotMatch(body, /class="section-title">[^<]*(정면도|판재 도면|부재마다 붙일 변)/, '정면도 · 판재 도면 · 부재마다 엣지 쪽 없음');
  assert.doesNotMatch(body, /<svg class="elevation/);
  assert.ok(sheetNos(html).length > 0);
  // 옛 문서는 예전 그대로
  const old = renderWorkOrder(fx.doc(), snapshotWith(null), { toolbar: false, pack: 'cut' });
  assert.doesNotMatch(old, /원장 내용/);
});

test('도어재 — 외주면 발주서에만, 내수면 재단 지시서에 (발주서는 「발주 없음」)', () => {
  const plan = fx.cutPlan();
  const doorNos = plan.sheets.filter((s) => s.partClass === '도어').map((s) => s.no);
  assert.ok(doorNos.length > 0, '시험 배치에 도어 원장이 있다');
  const out = snapshotWith(null);
  const cutOut = renderWorkOrder(docV2(), out, { toolbar: false, pack: 'cut' });
  assert.ok(doorNos.every((n) => !sheetNos(cutOut).includes(n)), '외주 도어 원장은 재단 지시서에 없다');
  const doorOut = renderWorkOrder(docV2(), out, { toolbar: false, pack: 'door' });
  assert.deepEqual(sheetNos(doorOut), doorNos, '발주서에 도어 원장 그림');
  assert.match(doorOut, /원장 내용/);
  const inHouse = snapshotWith({ door: 'in' });
  assert.ok(doorNos.every((n) => sheetNos(renderWorkOrder(docV2(), inHouse, { toolbar: false, pack: 'cut' })).includes(n)), '내수면 재단 지시서에');
  assert.match(renderWorkOrder(docV2(), inHouse, { toolbar: false, pack: 'door' }), /도어재 발주 없음 — 내수가공/);
});

test('원장 그림 — 엣지는 외곽선 안쪽 · 모서리에서 끊김, 0.6 한 줄 · 1.0 두 줄, 모듈 번호 · 치수 · 라벨 번호, 경첩 컵', () => {
  const sheet = { no: 1, size: { w: 1220, h: 2440 }, trim: 10, parts: [{ partId: 'a#0', part: '측판', w: 550, h: 708, x: 10, y: 10, rot: false }, { partId: 'd#0', part: '도어', w: 446, h: 716, x: 564, y: 10, rot: false }] };
  const svg = bigSheetSvg(sheet, (p) => (p.partId === 'a#0'
    ? { no: 3, title: '#1 측판', w: 550, h: 708, edges: { T: true, L: true }, edgeT: 0.6 }
    : { no: 4, title: '#2 도어', w: 446, h: 716, edges: { T: true, B: true, L: true, R: true }, edgeT: 1, cups: { positions: [100, 600], side: null } }));
  const marks = [...svg.matchAll(/<line class="edge-mark" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));
  assert.equal(marks.length, 2 + 8, '측판 두 변 한 줄 · 도어 네 변 두 줄');
  // 측판 윗변 — 외곽선(y 10)보다 안쪽, 양 끝은 모서리에서 떨어진다
  const top = marks[0];
  // 외곽선(y 10)에서 34 안쪽, 길이 = 변의 70% 가운데 (2026-11-20 사장님 「더 안쪽으로 · 변의 70% 길이」)
  assert.deepEqual([top[1], top[0], top[2]], [10 + 34, 10 + 550 * 0.15, 10 + 550 * 0.85].map((v) => Math.round(v * 10) / 10), JSON.stringify(top));
  assert.match(svg, />#1 측판</);
  assert.match(svg, />550 × 708</);
  assert.match(svg, /font-weight="700">3</);
  assert.equal((svg.match(/class="cup"/g) || []).length, 2, '경첩 컵 둘');
  assert.match(svg, /class="cut-line"/, '재단선');
});

test('재단선 — 톱이 끝까지 지나가는 자리만 (조각을 가르지 않는다)', () => {
  const rects = [{ x: 10, y: 10, w: 500, h: 700 }, { x: 514, y: 10, w: 500, h: 300 }, { x: 514, y: 314, w: 500, h: 300 }];
  const cuts = guillotineCuts(rects, { x: 10, y: 10, w: 1200, h: 2420 });
  assert.ok(cuts.some((c) => c.x1 === c.x2 && c.x1 === 512), '세로 첫 톱 — 두 조각 사이 틈 가운데');
  assert.ok(cuts.some((c) => c.y1 === c.y2 && c.y1 === 312 && c.x1 === 512), '오른쪽 묶음 가로 톱');
  const crosses = (c, r) => (c.x1 === c.x2 ? c.x1 > r.x && c.x1 < r.x + r.w && Math.max(c.y1, c.y2) > r.y && Math.min(c.y1, c.y2) < r.y + r.h : c.y1 > r.y && c.y1 < r.y + r.h && Math.max(c.x1, c.x2) > r.x && Math.min(c.x1, c.x2) < r.x + r.w);
  assert.ok(cuts.every((c) => rects.every((r) => !crosses(c, r))));
  assert.deepEqual(guillotineCuts([{ x: 0, y: 0, w: 10, h: 10 }], { x: 0, y: 0, w: 100, h: 100 }), []);
});

// ── 조립 새 틀 (src/templates/assembly-layout2.js) ─────────────────
import { notchLinesOf, moduleInfoRows } from '../src/templates/assembly-layout2.js';
import { moduleCadSvg, solidsOfPart, unionEdges, CAD } from '../src/templates/cad-views.js';

const SPEC_MOD = {
  moduleKey: 'w/floor/m1|0-lower-0',
  box: { W: 900, H: 708, D: 550, T: 15 },
  parts: [
    { part: '측판', t: 15, frame: { o: [-450, 0, -275], u: '+z', v: '+y', n: '+x' }, cut: { w: 550, h: 708 }, box: { min: [-450, 0, -275], max: [-435, 708, 275] }, features: [{ type: 'notch', u0: 510, u1: 550, v0: 638, v1: 708, src: 'channel-top' }] },
    { part: '측판', t: 15, frame: { o: [435, 0, -275], u: '+z', v: '+y', n: '+x' }, cut: { w: 550, h: 708 }, box: { min: [435, 0, -275], max: [450, 708, 275] }, features: [{ type: 'notch', u0: 510, u1: 550, v0: 638, v1: 708, src: 'channel-top' }] },
    { part: '지판', cut: { w: 870, h: 550 }, box: { min: [-435, 0, -275], max: [435, 15, 275] } },
    { part: '도어', cut: { w: 446, h: 678 }, box: { min: [-448, 0, 275], max: [-2, 678, 293] } },
  ],
  hardware: [{ kind: 'leg', item: '조절 다리발', spec: '150mm', at: [-400, -150, 230], size: [42, 150, 42] }],
};

test('제작도 — 3면도 + 등각, 축척 1:S 는 종이 mm (svg 폭 mm = 그림 폭 ÷ S), 몸통 · 다리발 · 전면 연속 치수', () => {
  const svg = moduleCadSvg(SPEC_MOD);
  assert.match(svg, /^<svg class="mod-cad"/);
  for (const t of ['정면도', '우측면도', '평면도', '등각']) assert.match(svg, new RegExp(`>${t}<`));
  const S = Number(svg.match(/축척 1:(\d+)/)[1]);
  assert.ok(CAD.SCALES.includes(S));
  const [, , vw] = svg.match(/viewBox="([-\d.]+) [-\d.]+ ([\d.]+)/).slice(0, 3).map(Number);
  assert.equal(Number(svg.match(/width="([\d.]+)mm"/)[1]), Math.round((vw / S) * 10) / 10);
  assert.ok(vw / S <= CAD.PAGE_W_MM);
  // 치수 — 몸통 폭 900 · 높이 708 · 다리발 150 · 깊이 550 · 도어 앞 18 · 도어 높이 678
  for (const t of ['900', '708', '150', '550', '18', '678']) assert.match(svg, new RegExp(`>${t}</text>`));
  // 따내기 — 우측면도에 40 × 70
  assert.match(svg, />따내기 40×70</);
  assert.equal(moduleCadSvg({ parts: [] }), '');
});

test('제작도 — 따내기는 판에서 뺀 상자 (엔진 solidsOf 와 같은 셈) · 합집합 외곽만 선', () => {
  const side = { part: '측판', t: 15, cut: { w: 550, h: 708 }, frame: { o: [-450, 0, -275], u: '+z', v: '+y', n: '+x' }, features: [{ type: 'notch', u0: 510, u1: 550, v0: 638, v1: 708 }] };
  assert.deepEqual(solidsOfPart(side), [
    { min: [-450, 0, -275], max: [-435, 708, 235] },
    { min: [-450, 0, 235], max: [-435, 638, 275] },
  ]);
  // ㄱ자 두 칸 — 이음 선 없이 외곽 여섯 변
  const e = unionEdges([{ x0: 0, x1: 10, y0: 0, y1: 10 }, { x0: 10, x1: 14, y0: 0, y1: 7 }]);
  assert.equal(e.length, 6);
  assert.ok(!e.some((s) => s[0] === 10 && s[2] === 10 && Math.min(s[1], s[3]) === 0 && Math.max(s[1], s[3]) === 7), '이음 선 없음');
});

test('모듈 내용 — 색상 · 부재 · 목찬넬 따내기 · 다리발 · 철물 (같은 것끼리 더함) · 전기', () => {
  assert.deepEqual(notchLinesOf(SPEC_MOD), ['목찬넬 따내기 — 측판 위 앞 40 × 70'], '양쪽 측판 같은 자리는 한 줄');
  const rows = [
    { part: '측판', material: 'PB', thickness: 15, w: 550, h: 708, qty: 2, partClass: '본체', color: '화이트' },
    { part: '도어', material: 'MDF', thickness: 18, w: 446, h: 678, qty: 2, partClass: '도어', finishCode: 'PET-1' },
    { part: '뒷판', material: 'MDF', thickness: 3, w: 899, h: 707, qty: 1, partClass: '뒷판', color: '오크' },
  ];
  const hw = [{ category: '경첩', item: 'H052', spec: '2구', qty: 2 }, { category: '경첩', item: 'H052', spec: '2구', qty: 2 }, { category: '전기', item: '콘센트', spec: '2구', qty: 1 }];
  const info = Object.fromEntries(moduleInfoRows({ rows, hardware: hw, mod: SPEC_MOD, colorName: (c) => `이름 ${c}` }));
  assert.equal(info['색상'], '몸통 화이트 / 도어 이름 PET-1 / 우라 오크');
  assert.match(info['부재'], /측판 550×708 PB15T × 2/);
  assert.match(info['목찬넬 따내기'], /측판 위 앞 40 × 70/);
  assert.equal(info['다리발 · 좌대'], '다리발 150mm × 1');
  assert.equal(info['철물'], '경첩 H052 2구 × 4');
  assert.equal(info['전기 · 가전'], '콘센트 2구 × 1');
});

test('조립 새 틀 — 모듈 명세 표 · 치수도 · 조립 순서 체크 없음, 옛 문서는 그대로', () => {
  const html = renderWorkOrder(docV2(), snapshotWith(null), { toolbar: false, pack: 'assembly' });
  const body = html.slice(html.indexOf('<body>'));
  assert.doesNotMatch(body, /class="section-title">[^<]*(모듈 명세|모듈 치수도|조립 순서 체크|모듈 단면도)/);
  const old = renderWorkOrder(fx.doc(), snapshotWith(null), { toolbar: false, pack: 'assembly' });
  assert.match(old.slice(old.indexOf('<body>')), /조립 순서 체크/);
});

// ── 현장 지시서 새 틀 (시공 · 납품 · 철거) ─────────────────────────
import { renderInstallationOrder } from '../src/templates/installation-order.js';
import { renderSiteOrder } from '../src/templates/site-order.js';
import { elevationSvg } from '../src/templates/elevation.js';

test('현장 새 틀 — 시공 · 납품은 확인 칸 없음 · 철거는 배치 평면 없음 · 표 칸 너비 고정, 옛 문서는 그대로', () => {
  const snap = fx.snapshot({ design_payload: { ...fx.design(), source: 'planner-lite' } });
  const rp = (type, extra = {}) => ({ site_info: { address: '합성시 1' }, schedules: [], check_list: fx.doc().render_payload.check_list, drawing_version: 1, layout_renders: [{ item_index: 0, item_unique_id: 1, path: 'p/layout' }], ...extra });
  const docOf = (type, extra) => ({ ...fx.doc(), doc_type: type, render_payload: rp(type, extra) });
  const urls = new Map([['p/layout', 'data:image/svg+xml;base64,AA==']]);
  const inst2 = renderInstallationOrder(docOf('installation_order', { sheet_layout: 2 }), snap, { toolbar: false });
  const inst1 = renderInstallationOrder(docOf('installation_order'), snap, { toolbar: false });
  assert.doesNotMatch(inst2, /<h2>설치 확인<\/h2>/);
  assert.match(inst2, /table-layout: fixed/);
  assert.doesNotMatch(inst1, /table-layout: fixed/, '옛 문서 모양 그대로');
  const dlv2 = renderSiteOrder(docOf('delivery_order', { sheet_layout: 2, check_list: { version: 'v4', block: 'must', roles: { delivery: [{ key: 'dlv-order-count', label: '납품 수량 확인', scope: 'order', must: true, photo: 'none' }] } } }), snap, { toolbar: false });
  assert.doesNotMatch(dlv2, /납품 수량 확인 ☐/);
  const dem2 = renderSiteOrder(docOf('demolition_order', { sheet_layout: 2 }), snap, { toolbar: false, renderUrls: urls });
  const dem1 = renderSiteOrder(docOf('demolition_order'), snap, { toolbar: false, renderUrls: urls });
  assert.doesNotMatch(dem2, /<h2>배치 평면/);
  assert.match(dem1, /<h2>배치 평면/);
});

test('정면도 글자 배율 — 새 틀은 크게, 기본은 그대로', () => {
  const item = fx.design().items[0];
  const fsOf = (svg) => Math.max(...[...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1])));
  const a = elevationSvg(item);
  const b = elevationSvg(item, { textScale: 1.35 });
  assert.ok(fsOf(b) > fsOf(a) * 1.3);
  assert.equal(elevationSvg(item, { textScale: 1 }), a);
});

// ── 현장 재단 막대 (2026-11-21) ─────────────────────────────────
import { siteCutBlock } from '../src/templates/installation-order.js';
import { validateAssembly } from '../src/snapshots.js';

test('현장 재단표 — 막대마다 자를 길이 · 막대가 없으면 칸째 없다', () => {
  const bar = { part: '목찬넬 막대', material: 'MDF', thickness: 18, w: 100, h: 2440, qty: 2, siteBar: { kind: 'channel', barLen: 2440, layout: [[1800, 600], [1700]] } };
  const html = siteCutBlock({ bom_payload: { materials: [{ part: '측판', w: 550, h: 720, qty: 2 }, bar] } });
  assert.match(html, /현장 재단표/);
  assert.match(html, /<td>목찬넬 막대<\/td><td>18T × 100 × 2,440<\/td><td>2개<\/td><td>막대 1: 1,800 \+ 600<br>막대 2: 1,700<\/td>/);
  assert.equal(siteCutBlock({ bom_payload: { materials: [{ part: '측판', w: 550, h: 720, qty: 2 }] } }), '');
});

test('조립 명세 검사 — 막대로 바뀐 조각 행(bom.sitePieces)도 판 자리로 인정', () => {
  const assembly = { schema: 'dadam.assembly/1', rulesVersion: 'x', unplaced: [], items: [{ modules: [{ moduleKey: 'm', parts: [{ id: 'p1', rowPartId: 'm-chan-0' }] }], runs: [] }] };
  const materials = [{ partId: 'bar-channel-0', part: '목찬넬 막대', material: 'MDF', w: 100, h: 2440, qty: 1 }];
  assert.throws(() => validateAssembly(assembly, { materials }), /조립 명세가 BOM 과 맞지 않습니다/);
  assert.equal(validateAssembly(assembly, { materials, sitePieces: [{ partId: 'm-chan-0', part: '목찬넬(전면)', w: 52, h: 600, qty: 1 }] }).partCount, 1);
});
