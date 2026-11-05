/**
 * 상판 발주 요청서 (work-reports-archive.plan.md §2.2 · §8.1, 사장님 결정 2026-10-18).
 *   재질·두께 = BOM 상판 행 · 타공 = 개수대·쿡탑 모듈 자리 + 가전 모델 · 마감 = 사양 > 생산 설정 기본값
 *   발주 마감 = 설치 − 4근무일 · 고객 이름·금액 없음
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HQ, companyRoute } from './fixtures/company.js';
import { countertopRequests, workdaysBefore, hasCountertop, countertopModelIds, countertopQty, isSinkModule, isCookModule } from '../src/countertop.js';
import { renderWorkOrder, normalizePack } from '../src/templates/work-order.js';
import { planSvg } from '../src/templates/countertop-order.js';
import { createOutsourceOrder, loadCountertopContext } from '../src/reports/outsource.js';
import { mergeSettings, sanitizeSettings, buildJobs } from '../src/production/service.js';
import { planProduction } from '../src/production/planner.js';
import { buildDailyBlocks, buildProposalBlocks } from '../src/production/notify.js';
import * as fx from './fixtures/work-order-v2.js';
import * as el from './fixtures/elevation.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const U1 = '11111111-1111-4111-8111-111111111111';
const D1 = '22222222-2222-4222-8222-222222222222';
const DOC = '33333333-3333-4333-8333-333333333333';
const O1 = '44444444-4444-4444-8444-444444444444';
const SINK_M = '66666666-6666-4666-8666-666666666666';
const COOK_M = '77777777-7777-4777-8777-777777777777';

const TOP_ROW = { partId: '0-ep-top-0', module: '상판', part: '상판', slot: 'top', material: '인조대리석', thickness: 12, w: 3000, h: 600, qty: 1, finishCode: 'TOP-SNW', itemLabel: '싱크대' };

/** 일자 싱크대: 좌측 EP 20 · [780 수납][900 개수대][600 쿡탑][700 수납] — 상판 3000 = EP 20 + 칸 2980 */
function sinkSnapshot({ specs = {}, top = {} } = {}) {
  const base = fx.snapshot({ id: 's1' });
  return {
    ...base,
    design_payload: {
      items: [{
        name: '싱크대', categoryId: 'sink',
        specs: { finishLeftType: 'EP', finishLeftWidth: 20, finishRightType: 'Molding', finishRightWidth: 60, ...specs },
        modules: [
          { id: 1, pos: 'lower', name: '수납', w: 780 },
          { id: 2, pos: 'lower', name: '개수대', w: 900 },
          { id: 3, pos: 'lower', type: 'cook', name: '가스대', w: 600 },
          { id: 4, pos: 'lower', name: '수납', w: 700 },
          { id: 5, pos: 'upper', name: '상부', w: 800 },
        ],
      }],
    },
    bom_payload: { ...base.bom_payload, materials: [...base.bom_payload.materials, { ...TOP_ROW, ...top }] },
  };
}

const MODELS = new Map([
  [SINK_M, { id: SINK_M, brand: '백조', model_name: 'SQ850', model_code: 'BJ-850', cutout_w_mm: 760, cutout_d_mm: 440, cutout_r_mm: 10, faucet_hole_mm: 35 }],
  [COOK_M, { id: COOK_M, brand: 'SK매직', model_name: '인덕션 3구', cutout_w_mm: 560, cutout_d_mm: 490 }],
]);

test('발주 마감 = 설치 − 4근무일 (주말 · 공휴일 건너뜀)', () => {
  assert.equal(workdaysBefore('2026-10-24', 4), '2026-10-20'); // 토 → 금·목·수·화
  assert.equal(workdaysBefore('2026-10-23', 4), '2026-10-19'); // 금 → 목·수·화·월
  assert.equal(workdaysBefore('2026-10-26', 4), '2026-10-20'); // 월 → 금·목·수·화
  assert.equal(workdaysBefore('2026-10-23', 4, ['2026-10-21']), '2026-10-16');
  assert.equal(workdaysBefore(null, 4), null);
});

test('모듈 판별 — 개수대 · 쿡탑 (플래너 변환 모듈은 type 이 storage, 이름으로)', () => {
  assert.ok(isSinkModule({ type: 'storage', name: '개수대' }));
  assert.ok(isSinkModule({ type: 'sink' }));
  assert.ok(isCookModule({ type: 'cook' }));
  assert.ok(isCookModule({ hasCooktop: true }));
  assert.ok(!isSinkModule({ name: '수납' }));
});

test('요청 — 재질 · 두께 · 치수는 BOM 상판 행, 타공 중심은 좌측 끝(마감 포함)부터', () => {
  const [r] = countertopRequests(sinkSnapshot());
  assert.equal(r.material, '인조대리석');
  assert.equal(r.thickness, 12);
  assert.deepEqual([r.length, r.depth], [3000, 600]);
  assert.equal(r.shape, 'straight');
  const centers = Object.fromEntries(r.cutouts.filter((c) => c.center !== null).map((c) => [c.kind, c.center]));
  assert.deepEqual(centers, { sink: 20 + 780 + 450, cooktop: 20 + 1680 + 300 });
  assert.equal(r.bomGap, 0, '칸 + 마감 = BOM 상판 길이');
  assert.deepEqual(r.modules.map((m) => [m.no, m.x, m.w, m.kind]), [[1, 20, 780, 'plain'], [2, 800, 900, 'sink'], [3, 1700, 600, 'cook'], [4, 2300, 700, 'plain']]);
  assert.deepEqual(r.finishW, { left: 20, right: 0 });
  assert.equal(r.cutouts.find((c) => c.kind === 'faucet').at, '싱크볼 뒤 중앙');
  assert.equal(r.cutouts.find((c) => c.kind === 'sink').model, null, '모델 미지정 → 요청서에 [확인 필요]');
});

test('한 장 탑뷰 — 상판이 하부장 위 수납장 칸에서 끊겨도 품목마다 한 장 · 그 칸만 상판 없음 · 끊김 표시 없음 (2026-11-05)', () => {
  // [키큰장 600][개수대 1000][서랍 600 ← 밥솥장][가스대 600][서랍 450] — 엔진이 상판 1,000 · 1,050 두 행을 낸다
  const base = fx.snapshot({ id: 's2' });
  const snap = {
    ...base,
    design_payload: { items: [{ name: '싱크대', categoryId: 'sink', specs: {}, modules: [
      { id: 't', pos: 'lower', type: 'tall', name: '키큰장', w: 600, _x: 0 },
      { id: 'a', pos: 'lower', type: 'sink', name: '개수대', w: 1000, _x: 600 },
      { id: 'b', pos: 'lower', type: 'drawer', name: '서랍 3단', w: 600, _x: 1600, cabinetOnTop: true },
      { id: 'c', pos: 'lower', type: 'cooktop', name: '가스대', w: 600, _x: 2200 },
      { id: 'd', pos: 'lower', type: 'drawer', name: '서랍', w: 450, _x: 2800 },
      { id: 's', pos: 'upper', stackBox: true, name: '밥솥장', w: 600, _x: 1600 },
    ] }] },
    bom_payload: { ...base.bom_payload, materials: [...base.bom_payload.materials,
      { ...TOP_ROW, partId: '0-ep-top-0', w: 1000, h: 650 }, { ...TOP_ROW, partId: '0-ep-top-1', w: 1050, h: 650 }] },
  };
  const all = countertopRequests(snap);
  assert.equal(all.length, 1, '엔진 상판 두 행 → 요청서 한 장');
  const [r] = all;
  assert.equal(r.piece, undefined, '끊김 표시 없음');
  assert.deepEqual([r.length, r.topLength, r.bomGap], [2650, 2050, 0], '전체 = 개수대 1000 + 상판 없음 600 + 가스대 600 + 서랍 450');
  assert.deepEqual(r.modules.map((m) => [m.no, m.x, m.w, m.kind]), [[2, 0, 1000, 'sink'], [3, 1000, 600, 'onTop'], [4, 1600, 600, 'cook'], [5, 2200, 450, 'plain']], '하부장만 · 배치 그대로 · 키큰장 빼고');
  assert.deepEqual(r.cutouts.filter((c) => c.center !== null).map((c) => [c.kind, c.center, c.no]), [['sink', 500, 2], ['cooktop', 1900, 4]]);
  assert.deepEqual([r.finishes.sideLeft, r.finishes.sideRight], ['cabinet', 'exposed'], '키큰장 쪽은 장 옆');
  const svg = planSvg(r);
  assert.ok(svg.includes('상판 없음') && svg.includes('개수대') && svg.includes('가스대'));
  assert.ok(svg.includes('전체 2,650') || svg.includes('전체 2650'));
  assert.ok(!svg.includes('키큰장'), '탑뷰에 키큰장 칸 없음');
  // 간편 플래너 부재 ID (line| 앞머리) 도 같은 품목으로 읽는다
  const planner = { ...snap, bom_payload: { ...snap.bom_payload, materials: snap.bom_payload.materials.map((m) => (m.part === '상판' ? { ...m, partId: `line|${m.partId}` } : m)) } };
  assert.deepEqual(countertopRequests(planner).map((x) => [x.length, x.cutouts.filter((c) => c.center !== null).map((c) => c.kind).join()]), [[2650, 'sink,cooktop']]);
  // 예전 동결본(상판 한 행)도 같은 그림
  const old = { ...snap, bom_payload: { ...snap.bom_payload, materials: [...base.bom_payload.materials, { ...TOP_ROW, w: 2050, h: 650 }] } };
  const [o] = countertopRequests(old);
  assert.deepEqual([o.length, o.cutouts.find((c) => c.kind === 'cooktop').center], [2650, 1900]);
  // BOM 길이와 그림이 어긋나면 [확인 필요]
  const off = { ...snap, bom_payload: { ...snap.bom_payload, materials: [...base.bom_payload.materials, { ...TOP_ROW, w: 2000, h: 650 }] } };
  assert.equal(countertopRequests(off)[0].bomGap, 50);
});

test('플래너 사양 — 마감 폭 · 상판 색 · 뒷선반(적은 크기만) · 수전 모델', () => {
  const FAU_M = '88888888-8888-4888-8888-888888888888';
  const models = new Map([...MODELS, [FAU_M, { id: FAU_M, category: 'faucet', brand: '대림', model_name: '원홀 수전', model_code: 'DL-1', faucet_hole_mm: 32 }]]);
  const snap = sinkSnapshot({ specs: { topFinishLeftW: 20, topFinishRightW: 0, topColor: 'top-gmb', topRearShelf: 'on', topRearShelfD: 150, topRearShelfH: 120, sinkModelId: SINK_M, faucetModelId: FAU_M }, top: { finishCode: null } });
  assert.deepEqual(countertopModelIds(snap), [SINK_M, FAU_M]);
  const [r] = countertopRequests(snap, { models });
  assert.equal(r.finishCode, 'TOP-GMB');
  assert.deepEqual(r.finishes.rearShelf, { on: true, d: 150, h: 120 });
  const fau = r.cutouts.find((c) => c.kind === 'faucet');
  assert.equal(fau.dia, 32, '수전 모델 지름이 싱크볼 모델보다 먼저');
  assert.equal(fau.model.name, '대림 원홀 수전');
  const [n] = countertopRequests(sinkSnapshot({ specs: { topRearShelf: 'on' } }));
  assert.deepEqual(n.finishes.rearShelf, { on: true, d: null, h: null }, '크기를 지어내지 않는다');
});

test('마감 기본값 — 뒷턱 50 · 앞턱 40 · 물끊기 · 옆면(몰딩 쪽 벽, EP 쪽 노출)', () => {
  const [r] = countertopRequests(sinkSnapshot());
  assert.deepEqual(r.finishes, {
    backsplash: { on: true, h: 50 }, rearShelf: { on: false, d: null, h: null }, frontLip: { na: false, on: true, h: 40 }, drip: { on: true }, sideLeft: 'exposed', sideRight: 'wall',
  });
});

test('품목 사양이 덮어쓴다 · 생산 설정 기본값을 바꾸면 그것 · 50T 는 앞턱 해당 없음', () => {
  const [a] = countertopRequests(sinkSnapshot({ specs: { topBacksplash: 'off', topFrontLipH: 30, topDrip: 'off', topSideRight: 'exposed' } }));
  assert.equal(a.finishes.backsplash.on, false);
  assert.equal(a.finishes.frontLip.h, 30);
  assert.equal(a.finishes.drip.on, false);
  assert.equal(a.finishes.sideRight, 'exposed');
  const [b] = countertopRequests(sinkSnapshot(), { countertop: { backsplashH: 70, frontLip: 0 } });
  assert.equal(b.finishes.backsplash.h, 70);
  assert.equal(b.finishes.frontLip.on, false);
  const [c] = countertopRequests(sinkSnapshot({ specs: { topFrontLip: 'on' }, top: { thickness: 50 } }));
  assert.deepEqual(c.finishes.frontLip, { na: true, on: false, h: 40 });
});

test('가전 모델 — 싱크볼 · 쿡탑 타공 크기, 수전은 싱크볼 모델 지름', () => {
  const snap = sinkSnapshot({ specs: { sinkModelId: SINK_M, cooktopModelId: COOK_M } });
  assert.deepEqual(countertopModelIds(snap), [SINK_M, COOK_M]);
  const [r] = countertopRequests(snap, { models: MODELS });
  const by = Object.fromEntries(r.cutouts.map((c) => [c.kind, c]));
  assert.deepEqual([by.sink.model.w, by.sink.model.d, by.sink.model.r], [760, 440, 10]);
  assert.equal(by.faucet.dia, 35);
  assert.equal(by.cooktop.model.name, 'SK매직 인덕션 3구');
});

test('코너 품목 — 평면은 하부 모듈 자리(_place), 줄 길이 · 개수대 표시', () => {
  const snap = { design_payload: { items: [el.lShape()] }, bom_payload: { materials: [TOP_ROW] } };
  const [r] = countertopRequests(snap);
  assert.equal(r.shape, 'corner');
  assert.equal(r.plan.length, 5, '상부 · 키큰장은 빼고 하부 5개');
  assert.equal(r.plan.filter((b) => b.sink).length, 1);
  assert.ok(r.runs.length >= 2);
  const svg = planSvg(r);
  assert.ok(svg.includes('코너 상판'));
  assert.ok(svg.includes('싱크'));
});

test('hasCountertop · 수량 한 줄', () => {
  assert.ok(hasCountertop(sinkSnapshot().bom_payload));
  assert.ok(!hasCountertop(fx.snapshot().bom_payload));
  assert.deepEqual(countertopQty(countertopRequests(sinkSnapshot())), { pieces: 1, material: '인조대리석', thickness: 12, lengthMm: 3000, cutouts: 3 });
});

test('?pack=top 종이 — 마감 · 업체 · 타공 · 마감 항목, 고객 이름 · 설계 제목 · 금액 없음', () => {
  assert.equal(normalizePack('TOP'), 'top');
  const doc = fx.doc({ id: DOC, design_id: D1, title: '김고객 댁 주방' });
  const snap = sinkSnapshot({ specs: { sinkModelId: SINK_M } });
  const html = renderWorkOrder(doc, snap, {
    toolbar: false, pack: 'top',
    top: { today: '2026-10-19', installDate: '2026-10-26', deadline: '2026-10-20', leadDays: 4, vendors: { topMarble: '한샘스톤' }, countertop: null, models: MODELS },
  });
  assert.ok(html.includes('상판 발주 요청서'));
  assert.ok(html.includes('업체 한샘스톤'));
  assert.ok(html.includes('10/20(화)'));
  assert.ok(html.includes('설치 10/26(월) − 4근무일'));
  assert.ok(html.includes('설치 당일 또는 다음 날'));
  assert.ok(html.includes('760 × 440 R10'));
  assert.ok(html.includes('구멍 지름 35'));
  assert.ok(html.includes('백조 SQ850') && html.includes('BJ-850'), '싱크볼 모델명 · 코드');
  assert.ok(html.includes('[확인 필요] 모델 미지정'), '쿡탑 모델은 안 골랐다');
  assert.ok(html.includes('있음 · 높이 50'));
  assert.ok(html.includes('뒷선반 (벽 쪽 선반)</th><td>없음'));
  assert.ok(html.includes('[확인 필요] 엘리베이터 미확인'));
  assert.ok(html.includes('탑뷰') && html.includes('전체 3,000'));
  assert.ok(!html.includes('끊긴 상판'));
  const site = (v) => renderWorkOrder(doc, snap, { toolbar: false, pack: 'top', top: { today: '2026-10-19', vendors: {}, models: MODELS, siteInfo: { has_elevator: v } } });
  assert.ok(site(true).includes('엘리베이터</dt><dd>있음'));
  assert.ok(site(false).includes('계단 · 사다리차 검토'));
  assert.ok(html.includes('좌 노출 — 마감 · 우 벽 — 마감 안 함'));
  assert.ok(!html.includes('김고객'));
  assert.ok(!/원\b|₩|금액/.test(html.replace(/원판|원장/g, '')));
});

test('?pack=top — 설치일 미정 · 업체 미지정 · 상판 없음', () => {
  const doc = fx.doc({ id: DOC, design_id: D1 });
  const html = renderWorkOrder(doc, sinkSnapshot(), { toolbar: false, pack: 'top', top: null });
  assert.ok(html.includes('[확인 필요] 설치일 미정'));
  assert.ok(html.includes('[확인 필요] 인조대리석 업체'));
  assert.ok(renderWorkOrder(doc, fx.snapshot(), { toolbar: false, pack: 'top' }).includes('상판 없음'));
  assert.ok(!renderWorkOrder(doc, fx.snapshot(), { toolbar: false, pack: 'all' }).includes('상판 발주 요청서'), '상판 없는 설계는 전체 묶음에도 안 붙는다');
});

test('설정 — 상판 기본값 · 마감 근무일 · 재질별 업체(비워 둘 수 있음)', () => {
  const s = mergeSettings(null);
  assert.deepEqual(s.countertop, { backsplash: 1, backsplashH: 50, frontLip: 1, frontLipH: 40, drip: 1 });
  assert.equal(s.leads.topLeadDays, 4);
  assert.deepEqual(sanitizeSettings({ countertop: { backsplashH: 60, drip: 0 }, vendors: { topStone: '스톤월드', topMarble: '' } }), { countertop: { backsplashH: 60, drip: 0 }, vendors: { topStone: '스톤월드', topMarble: '' } });
  assert.throws(() => sanitizeSettings({ countertop: { drip: 2 } }), /범위/);
  assert.throws(() => sanitizeSettings({ vendors: { door: '' } }), /1~40자/);
});

test('생산 계획 — 상판 있는 주문은 설치 − 4근무일 마감 추천, 발주된 주문은 빠진다', () => {
  const snap = { id: 's1', bom_payload: { materials: [{ part: '측판', qty: 2, partId: '0-l1-body:side-0', w: 560, h: 720 }, TOP_ROW] } };
  const orders = ['A', 'B'].map((no, i) => ({ id: i ? 'o2' : O1, order_no: no, customer_name: no === 'A' ? '가' : '나', status: 'in_production', snapshot_id: 's1', design_id: `d${i}`, ordered_at: '2026-10-19T00:00:00Z' }));
  const schedules = orders.map((o) => ({ design_id: o.design_id, type: 'installation', status: 'scheduled', scheduled_at: '2026-10-26T01:00:00Z' }));
  const s = mergeSettings(null);
  const { jobs } = buildJobs(orders, new Map([['s1', snap]]), schedules, s.standards, new Set(), new Set([O1]));
  assert.deepEqual(jobs.map((j) => [j.hasTop, j.topOrdered]), [[true, true], [true, false]]);
  const plan = planProduction({ today: '2026-10-19', jobs, crew: s.crew, costs: s.costs, leads: s.leads, holidays: [] });
  const top = plan.suggestions.filter((x) => x.type === 'top_order');
  assert.deepEqual(top.map((x) => [x.jobId, x.date]), [['o2', '2026-10-20']]);
  assert.match(top[0].text, /상판 발주 10\/20\(화\)까지 \(설치 4근무일 전\)/);
  const brief = JSON.stringify(buildDailyBlocks({ plan, assignments: [], today: '2026-10-19' }));
  assert.ok(brief.includes('상판 발주 마감'));
  assert.ok(brief.includes('나 (B): 상판 발주 내일까지'));
  assert.ok(!brief.includes('가 (A): 상판'));
  const prop = JSON.stringify(buildProposalBlocks({ plan, link: null }));
  assert.ok(prop.includes('상판 발주 마감: 나 (B) 10/20(화)'));
});

// ── 상판 발주 처리 · 인쇄 자료 ──
const json = (rows) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });
async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const method = init.method || 'GET';
    calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : null });
    const res = route(u, method);
    if (!res) throw new Error(`unexpected fetch ${method} ${u}`);
    return res;
  };
  try { return await fn(calls); } finally { globalThis.fetch = original; }
}
const routes = ({ settings = null, snap = sinkSnapshot() } = {}) => (u, m) => {
  if (u.includes('/design_documents?')) return json([fx.doc({ id: DOC, design_id: D1, snapshot_id: 's1' })]);
  if (companyRoute(u)) return companyRoute(u);
  if (u.includes('/designs?')) return json([{ id: D1, user_id: U1, company_id: HQ }]);
  if (u.includes('/design_snapshots?')) return json([snap]);
  if (u.includes('/company_settings?')) return json(settings ? [{ settings }] : []);
  if (u.includes('/orders?')) return json([{ id: O1 }]);
  if (u.includes('/design_schedules?')) return json([{ scheduled_at: '2026-10-26T01:00:00Z' }]);
  if (u.includes('/appliance_models?')) return json([...MODELS.values()]);
  if (u.includes('/design_site_info?')) return json([{ design_id: D1, has_elevator: false }]);
  if (u.includes('/work_reports?') && m === 'GET') return json([]);
  if (u.endsWith('/work_reports') && m === 'POST') return json([{ id: 'new' }]);
  return null;
};

test('[발주 처리] 상판 — countertop_order, 업체는 재질별 설정, 없으면 물어본다', async () => {
  await withFetch(routes({ settings: { vendors: { topMarble: '한샘스톤' } } }), async (calls) => {
    await createOutsourceOrder(ENV, { user: { id: U1 }, documentId: DOC, body: { pack: 'top' } });
    const post = calls.find((c) => c.method === 'POST').body;
    assert.equal(post.kind, 'countertop_order');
    assert.equal(post.metrics.vendor, '한샘스톤');
    assert.equal(post.metrics.qty, '인조대리석 12T · 1장 · 길이 3000 · 타공 3');
    assert.ok(post.title.startsWith('상판 발주 — 상판 · 한샘스톤'));
    assert.ok(calls.find((c) => c.method === 'GET' && c.url.includes('/work_reports?')).url.includes('kind=in.(outsource_order,countertop_order)'));
  });
  await withFetch(routes(), async () => {
    await assert.rejects(createOutsourceOrder(ENV, { user: { id: U1 }, documentId: DOC, body: { pack: 'top' } }), /인조대리석 업체를 적어 주세요/);
  });
  await withFetch(routes({ snap: { ...fx.snapshot({ id: 's1' }) } }), async () => {
    await assert.rejects(createOutsourceOrder(ENV, { user: { id: U1 }, documentId: DOC, body: { pack: 'top', vendor: 'x' } }), /상판이 없습니다/);
  });
});

test('인쇄 자료 — 설치일 → 마감, 재질별 업체, 고른 모델', async () => {
  const snap = sinkSnapshot({ specs: { sinkModelId: SINK_M } });
  await withFetch(routes({ settings: { vendors: { topMarble: '한샘스톤' }, holidays: ['2026-10-22'] } }), async (calls) => {
    const ctx = await loadCountertopContext(ENV, { doc: fx.doc({ id: DOC, design_id: D1 }), snapshot: snap });
    assert.equal(ctx.installDate, '2026-10-26');
    assert.equal(ctx.deadline, '2026-10-19', '공휴일 10/22 를 건너뛴다');
    assert.equal(ctx.vendors.topMarble, '한샘스톤');
    assert.ok(ctx.models.get(SINK_M));
    assert.deepEqual(ctx.siteInfo, { design_id: D1, has_elevator: false }, '현장 정보 — 엘리베이터');
    assert.ok(calls.some((c) => c.url.includes(`/appliance_models?id=in.(${SINK_M})`)));
  });
});
