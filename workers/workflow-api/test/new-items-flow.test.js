/**
 * 2026-10-20 새 품목(밥솥장·홈카페장·EL장·아일랜드·도어교체·냉장고장) BOM → 견적·작업지시서 흐름.
 *
 * 플래너에서 뽑은 실제 행 모양(partId·비고)을 줄여 담았다.
 *   1. 스냅샷은 철물을 bom_payload 가 아니라 hardware_payload 에 둔다 — 견적·생산 작업량이 철물을 읽어야 한다 (사장님 카드 10/20 14:11 「넣기」).
 *   2. 재단 지시서(사내·외주)에 부재 비고(따내기 · [확인 필요])가 나와야 재단 기사가 본다.
 *   3. 밥솥장·홈카페장 MDF 18T 몸통은 재단 외주, 조립 사내 (사장님 10/20 14:13 "재단 외주, 조립 사내").
 *   4. 도어교체 견적에는 '기존 철거' 줄이 없다 (사장님 카드 10/20 「철거 빼기」).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshot } from '../src/snapshots.js';
import { workloadFromSnapshot, bomWithHardware } from '../src/production/workload.js';
import { renderWorkOrder, labelGroups } from '../src/templates/work-order.js';
import { isOutsourcedCutRow } from '../src/work-order-data.js';
import { calculateSheetQuote } from '../src/quote-sheet.js';
import * as fx from './fixtures/work-order-v2.js';
import { HQ, companyRoute } from './fixtures/company.js';

// 플래너 BOM 그대로의 행 (아일랜드 측판 · EL장 측판 · 밥솥장 MDF 18T 상자)
const ISLAND_NOTE = '목찬넬 따내기 상단 70×40 · [확인 필요] 아일랜드 몸통 깊이';
const EL_NOTE = 'sakuri(15→3mm) · 도어 여닫이 · [확인 필요] EL장 몸통·도어 치수';
const RICE_NOTE = '슬라이딩 선반 [확인 필요] 선반 판 치수 · 레일 규격';
function materials() {
  return [
    {
      partId: '0-planner-lower-0-0-body:side-0',
      slot: 'body',
      itemLabel: '아일랜드',
      module: '하부장-하부장',
      part: '측판',
      material: 'PB',
      thickness: 15,
      w: 550,
      h: 708,
      qty: 2,
      edge: '3면',
      edges: { L: true, R: false, T: true, B: true },
      edgeLen: 1966,
      note: ISLAND_NOTE,
    },
    {
      partId: '0-planner-lower-0-0-door#0-0',
      slot: 'door',
      itemLabel: '아일랜드',
      module: '하부장-하부장',
      part: '도어',
      material: 'MDF',
      thickness: 18,
      w: 476,
      h: 678,
      qty: 2,
      edge: '4면',
      note: '',
    },
    {
      partId: '0-planner-tall-0-el-body:side-0',
      slot: 'body',
      itemLabel: '싱크대',
      module: 'EL장',
      part: '측판',
      material: 'PB',
      thickness: 15,
      w: 620,
      h: 801,
      qty: 2,
      edge: '3면',
      edges: { L: true, R: false, T: true, B: true },
      edgeLen: 2222,
      note: EL_NOTE,
    },
    {
      partId: '0-planner-tall-1-rice-body:side-0',
      slot: 'body',
      itemLabel: '싱크대',
      module: '밥솥장',
      part: '측판',
      material: 'MDF',
      thickness: 18,
      w: 620,
      h: 801,
      qty: 2,
      edge: '3면',
      note: '',
    },
    {
      partId: '0-planner-tall-1-rice-part:천지판-0',
      slot: 'body',
      itemLabel: '싱크대',
      module: '밥솥장',
      part: '천지판',
      material: 'MDF',
      thickness: 18,
      w: 564,
      h: 600,
      qty: 2,
      edge: '2면(가로)',
      note: RICE_NOTE,
    },
  ];
}
function hardware() {
  return [
    {
      category: '경첩',
      item: 'H052W-5 105도 저압 경첩',
      qty: 4,
      unit: 'EA',
      note: '하부장 (보링: 110, 568)',
      itemLabel: '아일랜드',
    },
    { category: '레일', item: '언더레일', qty: 2, unit: 'SET', note: '', itemLabel: '아일랜드' },
    {
      category: '다리발',
      item: '조절 다리발',
      qty: 20,
      unit: 'EA',
      note: '하부장',
      itemLabel: '아일랜드',
    },
    {
      category: '브라켓',
      item: '선반 브라켓 (핀타입)',
      qty: 12,
      unit: 'EA',
      note: '선반 3개 × 4',
      itemLabel: '아일랜드',
    },
  ];
}

// ── 1. 철물이 견적·작업량에 들어가는가 ─────────────────────────────

function withFakeSupabase(fn) {
  const original = globalThis.fetch;
  const posts = [];
  const json = (rows, status = 200) => ({
    ok: true,
    status,
    headers: { get: () => 'application/json' },
    json: async () => rows,
    text: async () => JSON.stringify(rows),
  });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    if (method === 'POST' && /\/design_snapshots$/.test(u.split('?')[0])) {
      const body = JSON.parse(init.body);
      posts.push(body);
      return json([{ id: 'S1', created_at: '2026-10-20T00:00:00Z', ...body }], 201);
    }
    if (companyRoute(u)) return companyRoute(u);
    if (/\/designs\?/.test(u)) return json([{ id: 'D1', user_id: 'U1', title: '테스트 설계', company_id: HQ }]);
    if (/\/pricing_rule_sets\?/.test(u))
      return json([{ id: 'RS1', name: 'seed', is_active: true }]);
    if (/\/pricing_rules\?/.test(u)) return json([]);
    if (/\/design_snapshots\?/.test(u)) return json([]);
    if (/\/production_settings\?/.test(u)) return json([]);
    throw new Error('unexpected fetch ' + method + ' ' + u);
  };
  return Promise.resolve(fn(posts)).finally(() => {
    globalThis.fetch = original;
  });
}

test('스냅샷 견적 — hardware 로 따로 온 경첩·레일·다리발·브라켓이 몸통 줄 원가에 든다', async () => {
  await withFakeSupabase(async (posts) => {
    const body = {
      design: { items: [{ categoryId: 'island', w: 2400, modules: [{ pos: 'lower', w: 960 }] }] },
      bom: { materials: materials() },
      hardware: { hardware: hardware() }, // workflow-client.js 가 보내는 모양 그대로
    };
    await createSnapshot(
      { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' },
      { designId: 'D1', user: { id: 'U1' }, body }
    );
    const q = posts[0].quote_payload;
    assert.equal(q.cost.quantities.hinge, 4);
    assert.equal(q.cost.quantities.rail, 2);
    assert.equal(q.cost.quantities.leg, 20);
    assert.equal(q.cost.quantities.shelfPin, 12);
    assert.ok(q.cost.body.hardware > 0, '철물 원가가 0 이면 안 된다');
    assert.deepEqual(posts[0].hardware_payload, { hardware: hardware() }, '저장 모양은 그대로');
    assert.equal(
      posts[0].bom_payload.hardware,
      undefined,
      'bom_payload 에 철물을 섞어 저장하지 않는다'
    );
  });
});

test('생산 작업량 — 스냅샷의 hardware_payload 에서 서랍(레일)·다리발을 센다', () => {
  const snap = {
    bom_payload: { materials: materials() },
    hardware_payload: { hardware: hardware() },
    cut_plan_payload: null,
  };
  const w = workloadFromSnapshot(snap);
  assert.equal(w.counts.drawers, 2);
  assert.equal(w.counts.legs, 20);
});

test('bomWithHardware — bom 에 이미 hardware 가 있으면 그대로, 없으면 payload 에서', () => {
  const own = { materials: [], hardware: [{ category: '레일', qty: 1 }] };
  assert.equal(bomWithHardware(own, { hardware: hardware() }), own);
  assert.equal(bomWithHardware({ materials: [] }, { hardware: hardware() }).hardware.length, 4);
  assert.deepEqual(bomWithHardware({ materials: [] }, null).hardware, []);
  assert.deepEqual(bomWithHardware(null, undefined), { hardware: [] });
});

// ── 2. 재단 지시서에 비고가 나오는가 ──────────────────────────────

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

test('재단·엣지 지시서(배치 없음) — 따내기·[확인 필요] 비고가 사내·외주 종이 모두에 나온다', () => {
  const snap = fx.snapshot({
    bom_payload: { materials: materials() },
    hardware_payload: { hardware: hardware() },
    cut_plan_payload: null,
  });
  const doc = fx.doc({ render_payload: { ...fx.doc().render_payload, cut_plan: null } });
  for (const pack of ['cut', 'cut-vendor']) {
    const html = renderWorkOrder(doc, snap, { toolbar: false, pack });
    for (const note of [ISLAND_NOTE, EL_NOTE, RICE_NOTE])
      assert.ok(html.includes(esc(note)), `${pack}: ${note}`);
  }
});

test('재단·엣지 지시서(배치 있음) — 시트별 부재 표에 비고 칸', () => {
  const mats = fx
    .materials()
    .map((m) => (m.partId === '0-l1-body:side-0' ? { ...m, note: ISLAND_NOTE } : m));
  const snap = fx.snapshot({ bom_payload: { materials: mats } });
  const html = renderWorkOrder(fx.doc(), snap, { toolbar: false, pack: 'cut' });
  assert.ok(html.includes(esc(ISLAND_NOTE)));
  assert.ok(html.includes('<th>비고</th>') || html.includes('>비고<'));
});

// ── 3. MDF 18T 몸통 재단 외주 ─────────────────────────────────────

test('isOutsourcedCutRow — 밥솥장·홈카페장의 MDF 15T 이상 몸통만 (도어·PB·다른 모듈의 MDF 18T 는 아니다)', () => {
  const rice = materials().find((m) => m.module === '밥솥장' && m.part === '측판');
  assert.equal(isOutsourcedCutRow(rice), true);
  assert.equal(isOutsourcedCutRow({ ...rice, module: '홈카페장', part: '선반' }), true);
  assert.equal(isOutsourcedCutRow({ ...rice, part: '도어' }), false, '도어는 도어재 발주서');
  assert.equal(isOutsourcedCutRow({ ...rice, material: 'PB', thickness: 15 }), false);
  assert.equal(
    isOutsourcedCutRow({ ...rice, module: 'EP', part: '휠라(좌)' }),
    false,
    '휠라는 그대로'
  );
  assert.equal(
    isOutsourcedCutRow({ ...rice, module: '하부장-하부장', part: '뒷판', thickness: 3 }),
    false
  );
  assert.equal(isOutsourcedCutRow(null), false);
});

test('isOutsourcedCutRow — 오픈장 MDF 18T 상자도 재단 외주 (사장님 카드 10/20 14:47 「재단 외주」)', () => {
  // 플래너 BOM 그대로 (sink + 키큰장 첫 단 = 오픈장)
  const rows = [
    {
      partId: '0-planner-tall-0-open-body:side-0',
      module: '오픈장',
      part: '측판',
      material: 'MDF',
      thickness: 18,
      w: 620,
      h: 801,
      qty: 2,
    },
    {
      partId: '0-planner-tall-0-open-part:천지판-0',
      module: '오픈장',
      part: '천지판',
      material: 'MDF',
      thickness: 18,
      w: 564,
      h: 600,
      qty: 2,
    },
    {
      partId: '0-planner-tall-0-open-back-0',
      module: '오픈장',
      part: '뒷판',
      material: 'MDF',
      thickness: 18,
      w: 564,
      h: 801,
      qty: 1,
    },
  ];
  for (const r of rows) assert.equal(isOutsourcedCutRow(r), true, r.part);
  assert.equal(
    isOutsourcedCutRow({ ...rows[0], module: '오픈장 #2' }),
    true,
    '같은 품목에 오픈장이 여럿'
  );
  assert.equal(labelGroups(rows).outsourced.length, 5);
});

test('재단 지시서 — 밥솥장 MDF 18T 몸통은 사내 재단 목록에서 빠지고 「MDF 18T 재단 외주」 목록에 나온다', () => {
  const snap = fx.snapshot({
    bom_payload: { materials: materials() },
    hardware_payload: { hardware: hardware() },
    cut_plan_payload: null,
  });
  const doc = fx.doc({ render_payload: { ...fx.doc().render_payload, cut_plan: null } });
  const html = renderWorkOrder(doc, snap, { toolbar: false, pack: 'cut' });
  const at = html.indexOf('MDF 18T 재단 외주');
  assert.ok(at > 0, '외주 목록 제목');
  assert.ok(html.includes('입고 후 사내 조립'));
  assert.ok(html.indexOf('0-planner-tall-1-rice-body:side-0') > at, '밥솥장 측판은 외주 목록에만');
  assert.ok(html.indexOf('0-planner-tall-0-el-body:side-0') < at, 'EL장 PB 측판은 사내 목록');
  // 조립은 사내 — 조립 지시서에는 그대로 남는다
  const asm = renderWorkOrder(doc, snap, { toolbar: false, pack: 'assembly' });
  assert.ok(asm.includes('밥솥장'));
});

test('재단 지시서(배치 있음) — 외주 조각만 든 원판은 사내 원판 수에서 빠진다', () => {
  const mats = materials();
  const plan = {
    version: 1,
    sheetSize: { w: 1220, h: 2440 },
    kerf: 4,
    trim: 10,
    sheets: [
      {
        no: 1,
        material: 'PB',
        thickness: 15,
        partClass: '본체',
        size: { w: 1220, h: 2440 },
        parts: [
          {
            partId: '0-planner-lower-0-0-body:side-0#0',
            part: '측판',
            w: 550,
            h: 708,
            x: 10,
            y: 10,
          },
          {
            partId: '0-planner-lower-0-0-body:side-0#1',
            part: '측판',
            w: 550,
            h: 708,
            x: 570,
            y: 10,
          },
          {
            partId: '0-planner-tall-0-el-body:side-0#0',
            part: '측판',
            w: 620,
            h: 801,
            x: 10,
            y: 730,
          },
          {
            partId: '0-planner-tall-0-el-body:side-0#1',
            part: '측판',
            w: 620,
            h: 801,
            x: 10,
            y: 1540,
          },
        ],
      },
      {
        no: 2,
        material: 'MDF',
        thickness: 18,
        partClass: '본체',
        size: { w: 1220, h: 2440 },
        parts: [
          {
            partId: '0-planner-tall-1-rice-body:side-0#0',
            part: '측판',
            w: 620,
            h: 801,
            x: 10,
            y: 10,
          },
          {
            partId: '0-planner-tall-1-rice-body:side-0#1',
            part: '측판',
            w: 620,
            h: 801,
            x: 10,
            y: 820,
          },
          {
            partId: '0-planner-tall-1-rice-part:천지판-0#0',
            part: '천지판',
            w: 564,
            h: 600,
            x: 640,
            y: 10,
          },
          {
            partId: '0-planner-tall-1-rice-part:천지판-0#1',
            part: '천지판',
            w: 564,
            h: 600,
            x: 640,
            y: 620,
          },
        ],
      },
      {
        no: 3,
        material: 'MDF',
        thickness: 18,
        partClass: '도어',
        size: { w: 1220, h: 2440 },
        parts: [
          { partId: '0-planner-lower-0-0-door#0-0#0', part: '도어', w: 476, h: 678, x: 10, y: 10 },
          { partId: '0-planner-lower-0-0-door#0-0#1', part: '도어', w: 476, h: 678, x: 500, y: 10 },
        ],
      },
    ],
    offcuts: [],
    smallParts: [],
    unallocated: [],
    summary: { sheetsByMaterial: { PB_15: 1, MDF_18: 2 }, sheetCount: 3 },
  };
  const snap = fx.snapshot({ bom_payload: { materials: mats }, cut_plan_payload: plan });
  const doc = fx.doc({ render_payload: { ...fx.doc().render_payload, cut_plan: plan } });
  const html = renderWorkOrder(doc, snap, { toolbar: false, pack: 'cut' });
  assert.ok(html.includes('사내 원판 1장'), '시트 #2(밥솥장만)는 사내에서 자르지 않는다');
  assert.ok(!html.includes('<b>시트 #2</b>'));
  assert.ok(!html.includes('배치에 없는 부재'), '외주 행을 "배치에 없음" 으로 다시 띄우지 않는다');
  assert.ok(html.includes('MDF 18T 재단 외주'));
});

test('라벨 — 사내 재단 → MDF 18T 재단 외주 → 도어재 순서', () => {
  const g = labelGroups(materials());
  assert.equal(g.outsourced.length, 4, '밥솥장 측판 2 + 천지판 2');
  assert.ok(g.outsourced.every((u) => u.row.module === '밥솥장'));
  assert.ok(g.inHouse.every((u) => u.row.module !== '밥솥장'));
  assert.equal(g.door.length, 2);
});

// ── 4. 도어교체 철거 줄 ────────────────────────────────────────────

test('도어교체 견적 — 기존 철거 줄 없음, 시공 줄은 그대로. 다른 품목은 철거 그대로', () => {
  const doorOnly = {
    materials: [{ part: '도어', material: 'MDF', thickness: 18, w: 596, h: 735, qty: 1 }],
    hardware: [],
  };
  const mods = [
    { pos: 'upper', w: 600, h: 735 },
    { pos: 'lower', w: 600, h: 720 },
  ];
  const q = calculateSheetQuote({
    design: { items: [{ categoryId: 'door', labelName: '도어교체', modules: mods }] },
    bom: doorOnly,
    cutPlan: null,
  });
  assert.ok(!q.items.some((i) => /철거/.test(i.name)), q.items.map((i) => i.name).join(', '));
  assert.ok(q.items.some((i) => /^시공/.test(i.name)));
  const sink = calculateSheetQuote({
    design: { items: [{ categoryId: 'sink', labelName: '싱크대', modules: mods }] },
    bom: doorOnly,
    cutPlan: null,
  });
  assert.ok(sink.items.some((i) => /철거/.test(i.name)));
});
