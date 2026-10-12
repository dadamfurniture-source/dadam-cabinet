/**
 * 작업지시서 꾸러미 (docs/01-plan/work-order-stage.plan.md §4.3) — 같은 동결 문서를 사람별로 골라 찍는다.
 *   cut 재단·엣지 지시서 · assembly 조립 지시서 · door 도어재 발주서 · labels 라벨 · all 전체
 * 불변: 사내 재단 부재 + 도어재 부재 = 자재 행 전체, 어떤 꾸러미에도 금액 없음.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { partClassOf, isDoorClass, pieceBaseId, gatherWorkOrderPayload } from '../src/work-order-data.js';
import {
  renderWorkOrder,
  normalizePack,
  WORK_ORDER_PACKS,
  workCounts,
  drawnEdges,
  sheetSvg,
  edgeLenOf,
  edgeSidesText,
  edgeTotals,
  labelGroups,
  labelNumbers,
  labelUnits,
  uncoveredInHouse,
} from '../src/templates/work-order.js';
import { LABOR_STANDARDS, laborEstimate, fmtMinutes } from '../src/labor-standards.js';
import { renderDocument } from '../src/documents.js';
import { corsHeaders } from '../src/cors.js';
import * as fx from './fixtures/work-order-v2.js';

const require = createRequire(import.meta.url);
const NestingEngine = require('../../../js/detaildesign/nesting-engine.js');

const partIdOfRow = (m) => m.row.partId;
const PACKS = ['all', 'cut', 'cut-vendor', 'assembly', 'door', 'labels'];
const docWithLabor = (overrides = {}) =>
  fx.doc({ render_payload: { ...fx.doc().render_payload, labor: { ...LABOR_STANDARDS } }, ...overrides });
const render = (pack, doc = docWithLabor(), snap = fx.snapshot()) => renderWorkOrder(doc, snap, { toolbar: false, pack });

const IN_HOUSE_IDS = ['0-l1-body:side-0', '0-l1-body:bottom-0', '0-l1-back-0'];
const DOOR_IDS = ['0-l1-door#0-0', '0-u1-door#0-0'];

test('partClassOf — 재단 배치(nesting-engine)와 같은 규칙으로 사내/도어재를 가른다', () => {
  const names = ['도어', '서랍도어', '측판', '지판', '천판', '뒷판', '서랍밑판', '몰딩', '걸레받이', '목찬넬', '마감재', '멍판 마감', '밴드', '선반', '', undefined];
  for (const n of names) assert.equal(partClassOf(n), NestingEngine.partClassOf(n), String(n));
  assert.equal(isDoorClass({ part: '걸레받이' }), true);
  assert.equal(isDoorClass({ part: '측판' }), false);
});

test('pieceBaseId — partId 자체에 # 이 있어도 마지막 #k 만 뗀다', () => {
  assert.equal(pieceBaseId('0-l1-door#0-0#1'), '0-l1-door#0-0');
  assert.equal(pieceBaseId('0-l1-body:side-0#0'), '0-l1-body:side-0');
  assert.equal(pieceBaseId('row-3#2'), 'row-3');
  assert.equal(pieceBaseId(''), '');
});

test('normalizePack — 비면 all, 대소문자 무시, 모르는 값은 null', () => {
  assert.equal(normalizePack(null), 'all');
  assert.equal(normalizePack(''), 'all');
  assert.equal(normalizePack('CUT'), 'cut');
  assert.equal(normalizePack(' door '), 'door');
  assert.equal(normalizePack('edge'), null, '엣지는 재단 꾸러미에 합쳤다');
  assert.equal(normalizePack('CUT-VENDOR'), 'cut-vendor');
  assert.deepEqual(Object.keys(WORK_ORDER_PACKS), PACKS);
});

test('부재 보존 — 사내 + 도어재 = 전체, 겹침 0 (행·라벨·꾸러미 HTML 모두)', () => {
  const mats = fx.materials();
  const { inHouse, door } = labelGroups(mats);
  const all = labelUnits(mats).map((u) => u.id).sort();
  assert.deepEqual([...inHouse, ...door].map((u) => u.id).sort(), all);
  assert.equal(inHouse.filter((u) => door.some((d) => d.id === u.id)).length, 0);

  const cut = render('cut');
  const doorHtml = render('door');
  for (const id of IN_HOUSE_IDS) {
    assert.ok(cut.includes(id), `cut 에 ${id}`);
    assert.ok(!doorHtml.includes(id), `door 에 ${id} 없음`);
  }
  for (const id of DOOR_IDS) {
    assert.ok(doorHtml.includes(id), `door 에 ${id}`);
    assert.ok(!cut.includes(`>${id}`), `cut 에 ${id} 없음`);
  }
});

test('엣지 — 길이(edgeLen 우선, 없으면 변에서)·변 글자·두께×코드 합계', () => {
  const [side, bottom, door, , back] = fx.materials();
  assert.equal(edgeLenOf(side), 1820);
  assert.equal(edgeLenOf({ w: 550, h: 720, edge: '3면' }), 720 + 550 * 2, '옛 행은 문자열 edge 로');
  assert.equal(edgeSidesText(side), '720×1 · 550×2');
  assert.equal(edgeSidesText(bottom), '970×1');
  assert.equal(edgeSidesText(back), '없음');

  const totals = edgeTotals(fx.materials());
  assert.deepEqual(totals.map((g) => [g.edgeT, g.code, g.mm, g.parts]), [
    [1, 'PET-OAK-M', 2424 * 2, 2],
    [1, 'YR-YPA-02', 2262 * 2, 2],
    [0.6, '', 1820 * 2 + 970, 3],
  ]);
  assert.equal(door.edgeT, 1.0);
});

test('drawnEdges — 회전 조각은 부재 L→위, T→오른쪽, R→아래, B→왼쪽 (길이가 맞는 변끼리)', () => {
  assert.deepEqual(drawnEdges({ L: true, R: false, T: true, B: false }, false), { L: true, R: false, T: true, B: false });
  assert.deepEqual(drawnEdges({ L: true, R: false, T: true, B: false }, true), { T: true, R: true, B: false, L: false });
});

test('sheetSvg — 엣지 변 표시: 0.6 은 변마다 굵은 선 1개, 1.0 은 이중선 2개 · 라벨 번호', () => {
  const sheet = { size: { w: 1220, h: 2440 }, trim: 10, parts: [{ partId: 'a#0', part: '측판', w: 550, h: 720, x: 10, y: 10, rot: false }] };
  const thin = sheetSvg(sheet, { edgeOf: () => ({ edges: { L: true, R: false, T: true, B: true }, edgeT: 0.6 }), labelNoOf: () => 14 });
  assert.equal(thin.split('class="edge-mark"').length - 1, 3);
  assert.ok(thin.includes('font-weight="700" font-family="Consolas, monospace">14</text>'));
  const thick = sheetSvg(sheet, { edgeOf: () => ({ edges: { L: true, R: true, T: true, B: true }, edgeT: 1 }) });
  assert.equal(thick.split('class="edge-mark"').length - 1, 8);
  assert.equal(sheetSvg(sheet).split('class="edge-mark"').length - 1, 0, '옵션 없으면 v2 와 같다');
});

test('cut — 재단·엣지 지시서: 사내 시트만 · 체크 칸 · 엣지 표시 · 엣지 합계 · 예상 시간, 다른 섹션 없음', () => {
  const html = render('cut');
  assert.ok(html.includes('<h1>재단·엣지 지시서</h1>'));
  assert.ok(html.includes('<title>재단·엣지 지시서 DD-20260916-D1D1-WO-r2</title>'));
  assert.ok(html.includes('<b>시트 #1</b> PB 15T · 본체'));
  assert.ok(!html.includes('<b>시트 #2</b>'), '도어재 시트 없음');
  assert.ok(html.includes('<span class="checks">재단 ☐ 엣지 표시 ☐</span>'));
  // 시트 1: 측판 2장 × 3변 + 지판 1변
  assert.equal(html.split('class="edge-mark"').length - 1, 7);
  assert.ok(html.includes('0.6 · 720×1 · 550×2'));
  assert.ok(html.includes('엣지 합계'));
  assert.ok(html.includes('<td class="num">3</td><td class="num">4.6 m</td>'), '몸통 0.6: 1820×2 + 970 = 4.61 m, 3장');
  assert.ok(html.includes('사내 원판</dt><dd>1장 (본체 1)'));
  assert.ok(html.includes('재단 약 7분 · 엣지 약 15분 (알바)'));
  for (const s of ['② 모듈별 키팅', '⑥ 조립 순서 체크', '"section-title">⑩ 도어재 발주서', '⑧ 부재 라벨', '<h1>작 업 지 시 서</h1>']) {
    assert.ok(!html.includes(s), `cut 에 ${s} 없음`);
  }
  assert.ok(html.includes('은 외주 — ⑩ 도어재 발주서.'), '도어재는 안내 한 줄만');
});

test('cut — 배치에 없는 사내 부재는 빠뜨리지 않고 따로 싣는다', () => {
  // 픽스처 배치에는 뒷판(0-l1-back-0)이 없다
  const miss = uncoveredInHouse(fx.materials(), fx.cutPlan());
  assert.deepEqual(miss.map((m) => [partIdOfRow(m), m.missing]), [['0-l1-back-0', [0]]]);
  const html = render('cut');
  assert.ok(html.includes('배치에 없는 부재'));
  assert.ok(html.includes('<span class="mono">0-l1-back-0</span>'));

  const plan = fx.cutPlan();
  plan.sheets.push({ no: 3, material: 'MDF', thickness: 2.7, partClass: '뒷판', size: { w: 1220, h: 2440 }, trim: 10, parts: [{ partId: '0-l1-back-0#0', part: '뒷판', w: 970, h: 705, x: 10, y: 10, rot: false }], yield: 0.2 });
  assert.deepEqual(uncoveredInHouse(fx.materials(), plan), []);
  const doc = docWithLabor();
  doc.render_payload = { ...doc.render_payload, cut_plan: plan };
  const full = render('cut', doc);
  assert.ok(!full.includes('배치에 없는 부재'));
  assert.ok(full.includes('<b>시트 #3</b> MDF 2.7T · 뒷판'));
  assert.ok(full.includes('사내 원판</dt><dd>2장 (본체 1)'));
  assert.ok(full.includes('재단 약 14분 · 엣지 약 15분 (알바)'), '뒷판 원판은 재단 시간만 늘고 엣지 시간은 본체 원판만');
  // 소부품·미배치로 잡힌 것도 덮인 것으로 본다
  const p2 = fx.cutPlan();
  p2.smallParts = [{ partId: '0-l1-back-0', part: '뒷판', material: 'MDF', thickness: 2.7, partClass: '뒷판', w: 970, h: 60, qty: 1 }];
  assert.deepEqual(uncoveredInHouse(fx.materials(), p2), []);
  const p3 = fx.cutPlan();
  p3.unallocated = [{ partClass: '뒷판', partIds: ['0-l1-back-0#0'], parts: ['뒷판'], qty: 1 }];
  assert.deepEqual(uncoveredInHouse(fx.materials(), p3), []);
  assert.deepEqual(uncoveredInHouse(fx.materials(), null), [], '배치가 없으면 폴백 목록이 전부를 싣는다');
});

test('cut-vendor — 외주처용 재단·엣지: 부재·배치·엣지는 같고 고객 이름·설계 제목·특기사항·정면도·시간·사내 안내는 없다', () => {
  const doc = docWithLabor({ render_payload: { ...docWithLabor().render_payload, instructions: '고객 승인 전 발행 — 사유: 급함' } });
  const snap = fx.snapshot();
  const html = renderWorkOrder(doc, snap, { toolbar: false, pack: 'cut-vendor' });
  const inHouse = renderWorkOrder(doc, snap, { toolbar: false, pack: 'cut' });
  assert.ok(html.includes('<h1>재단·엣지 의뢰서</h1>'));
  assert.ok(html.includes('<title>재단·엣지 의뢰서 DD-20260916-D1D1-WO-r2</title>'));
  assert.ok(html.includes('DD-20260916-D1D1-WO-r2'), '문서번호는 있다 — 돌아온 부재를 맞춰 볼 근거');
  for (const s of ['홍길동', '홍*동', '김OO', '특기사항', '급함', '예상 시간', '알바', '<div class="section-title">정면도</div>', '<svg class="elevation"', '⑩ 도어재 발주서', '528,000', '₩']) {
    assert.ok(!html.includes(s), `cut-vendor 에 ${s} 없음`);
  }
  assert.ok(inHouse.includes('김OO') && inHouse.includes('특기사항'), '사내 판에는 있다');
  // 부재·배치·엣지는 사내 판과 같다
  assert.ok(html.includes('재단·엣지 목록'));
  assert.equal(html.split('class="edge-mark"').length - 1, inHouse.split('class="edge-mark"').length - 1);
  assert.ok(html.includes('<span class="checks">재단 ☐ 엣지 표시 ☐</span>'));
  assert.ok(html.includes('원판</dt><dd>1장 (본체 1)'));
  assert.ok(html.includes('<td class="num">3</td><td class="num">4.6 m</td>'));
  for (const id of IN_HOUSE_IDS) assert.ok(html.includes(id), id);
  for (const id of DOOR_IDS) assert.ok(!html.includes(`>${id}`), `도어재 ${id} 없음`);
});

test('cut — 재단 배치가 없으면 사내 자재 목록 + 엣지 합계', () => {
  const doc = docWithLabor();
  doc.render_payload = { ...doc.render_payload, cut_plan: null };
  const html = render('cut', doc, fx.snapshot({ cut_plan_payload: null }));
  assert.ok(html.includes('재단 배치 없음'));
  assert.ok(html.includes('0-l1-body:side-0'));
  assert.ok(!html.includes('0-l1-door#0-0'));
  assert.ok(html.includes('엣지 합계'));
  assert.ok(html.includes('사내 원판</dt><dd>배치 없음'));
});

test('door — 도어재 발주서: 고객 이름·설계 제목·금액 없음, 원장 수·도어 짝·발주 코드·경첩 컵', () => {
  const html = render('door');
  assert.ok(html.includes('⑩ 도어재 발주서'));
  assert.ok(html.includes('<title>도어재 발주서 DD-20260916-D1D1-WO-r2</title>'));
  for (const s of ['홍길동', '홍*동', '김OO', '528,000', '480,000', '₩', '<h1>']) assert.ok(!html.includes(s), `door 에 ${s} 없음`);
  assert.ok(html.includes('도어재 원장</dt><dd>1장'));
  assert.ok(html.includes('도어</dt><dd>4짝'));
  assert.ok(html.includes('발주 코드 <span class="mono">YPA-02</span>'));
  assert.ok(html.includes('3구 · 110, 358, 606'));
  assert.ok(html.includes('3구 · 110, 368, 625'));
  assert.ok(html.includes('496 × 716 × 18'));
  assert.ok(html.includes('1.0 · 716×2 · 496×2 · <span class="mono">PET-OAK-M</span>'), '엣지 두께는 1.0 으로 적는다');
  assert.ok(!html.includes('도어 행을 못 찾은 경첩'));

  const orphan = render('door', docWithLabor(), fx.snapshot({ hardware_payload: { hardware: [{ category: '경첩', qty: 2, note: '없는장 (보링: 110, 500)', itemLabel: '싱크대' }] } }));
  assert.ok(orphan.includes('도어 행을 못 찾은 경첩'));
  assert.ok(orphan.includes('없는장'));
});

test('assembly — 조립 지시서: 키팅·철물·조립 체크·차이, 재단표·라벨 없음, 조립 시간', () => {
  const html = render('assembly');
  assert.ok(html.includes('<h1>조립 지시서</h1>'));
  for (const s of ['모듈 명세', '② 모듈별 키팅', '④ 철물·체결구', '⑥ 조립 순서 체크', '⑦ 이전 rev 와의 차이']) assert.ok(html.includes(s), s);
  for (const s of ['③ 재단·엣지 지시서', '⑩ 도어재 발주서', '⑧ 부재 라벨']) assert.ok(!html.includes(s), `assembly 에 ${s} 없음`);
  assert.ok(html.includes('2통 · 서랍 0 · 도어 4짝'));
  // 2통×12 + 서랍 0 + 도어 4×1 + 2통×5 = 38분
  assert.ok(html.includes('조립 약 38분'));
});

test('labels — 라벨만, 사내 먼저 · 재단표와 같은 번호', () => {
  const html = render('labels');
  assert.ok(html.includes('<h1>부재 라벨</h1>'));
  assert.ok(html.includes('라벨</dt><dd>사내 4 · 도어재 4 (A4 2쪽)'));
  assert.equal(html.split('<div class="label">').length - 1, 8);
  assert.ok(!html.includes('③ 재단·엣지 지시서'));

  const nums = labelNumbers(fx.materials());
  assert.equal(nums.get('0-l1-body:side-0#0'), 1);
  assert.equal(nums.get('0-l1-back-0#0'), 4);
  assert.equal(nums.get('0-l1-door#0-0#0'), 5);
  const cut = render('cut');
  assert.ok(cut.includes('<td class="num">1</td><td><span class="mono">0-l1-body:side-0#0</span>'), '재단표의 라벨 칸');
});

test('all — 전체 문서는 표지 + 모든 섹션, 표지에 사내/도어재 시트와 예상 시간', () => {
  const html = render('all');
  for (const s of ['<h1>작 업 지 시 서</h1>', '② 모듈별 키팅', '③ 재단·엣지 지시서', '④ 철물·체결구', '⑥ 조립 순서 체크', '⑦ 이전 rev 와의 차이', '⑩ 도어재 발주서', '⑧ 부재 라벨']) {
    assert.ok(html.includes(s), s);
  }
  assert.ok(html.includes('(사내 1 · 도어재 1)'));
  assert.ok(html.includes('예상 시간</dt><dd>재단 약 7분 · 엣지 약 15분 · 조립 약 38분'));
  assert.equal(render(undefined), html, 'pack 생략 = all');
  assert.equal(renderDocument(docWithLabor(), fx.snapshot(), { toolbar: false, pack: 'cut' }), render('cut'), 'renderDocument 도 pack 을 넘긴다');
});

test('어떤 꾸러미에도 금액이 없다', () => {
  for (const pack of PACKS) {
    const html = render(pack);
    for (const s of ['528,000', '480,000', '48,000', '₩', '부가세', '합계 금액']) assert.ok(!html.includes(s), `${pack}: ${s}`);
  }
});

test('표준시간 — 동결값이 없는 옛 문서는 예상 시간을 싣지 않는다 · 계산 · 분 표기', () => {
  for (const pack of ['all', 'cut', 'assembly']) {
    assert.ok(!renderWorkOrder(fx.doc(), fx.snapshot(), { pack }).includes('예상 시간'), pack);
  }
  assert.equal(laborEstimate(null, {}), null);
  assert.deepEqual(laborEstimate(LABOR_STANDARDS, { cutSheets: 6, bodySheets: 6, cabinets: 9, drawers: 3, doors: 10 }), {
    cutMin: 42, edgeMin: 90, assemblyMin: (9 + 3) * 12 + 10 + 9 * 5,
  });
  assert.equal(fmtMinutes(199), '약 3시간 19분');
  assert.equal(fmtMinutes(120), '약 2시간');
  assert.equal(fmtMinutes(42), '약 42분');
  assert.equal(fmtMinutes(0), '-');
  assert.ok(Object.isFrozen(LABOR_STANDARDS));
});

test('workCounts — 배치가 없으면 시트 수는 null, 서랍은 drawerFront 행 수량', () => {
  const mats = [...fx.materials(), { partId: 'x', slot: 'drawerFront', part: '서랍도어', material: 'PET', thickness: 18, w: 500, h: 200, qty: 3 }];
  const ctxLike = { cutPlan: null, materials: mats, items: fx.design().items };
  const c = workCounts(ctxLike);
  assert.equal(c.inHouseSheets, null);
  assert.equal(c.bodySheets, null);
  assert.equal(c.drawers, 3);
  assert.equal(c.doors, 4);
  assert.equal(c.cabinets, 2);
  assert.equal(c.doorRows.length, 3, '서랍도어도 도어재');
});

test('발행 시 표준시간을 render_payload.labor 로 동결한다', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => [], text: async () => '[]' });
  try {
    const out = await gatherWorkOrderPayload({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' }, { designId: 'D1', snapshot: fx.snapshot() });
    assert.deepEqual(out.labor, { ...LABOR_STANDARDS });
    assert.ok(!Object.isFrozen(out.labor), '동결 상수의 복사본');
  } finally {
    globalThis.fetch = original;
  }
});

test('CORS — 현장 정보 저장(PUT)·비용 삭제(DELETE) 가 preflight 를 통과한다', () => {
  const req = { headers: { get: (k) => (k === 'Origin' ? 'https://dadamfurniture.com' : null) } };
  const h = corsHeaders(req, { ALLOWED_ORIGINS: 'https://dadamfurniture.com' });
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.ok(h['Access-Control-Allow-Methods'].split(', ').includes(m), m);
});
