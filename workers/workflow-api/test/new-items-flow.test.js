/**
 * 2026-10-20 새 품목(밥솥장·홈카페장·EL장·아일랜드·도어교체·냉장고장) BOM → 견적·작업지시서 흐름.
 *
 * 플래너에서 뽑은 실제 행 모양(partId·비고)을 줄여 담았다.
 *   1. 스냅샷은 철물을 bom_payload 가 아니라 hardware_payload 에 둔다 — 견적·생산 작업량이 철물을 읽어야 한다 (사장님 카드 10/20 14:11 「넣기」).
 *   2. 재단 지시서(사내·외주)에 부재 비고(따내기 · [확인 필요])가 나와야 재단 기사가 본다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshot } from '../src/snapshots.js';
import { workloadFromSnapshot, bomWithHardware } from '../src/production/workload.js';
import { renderWorkOrder } from '../src/templates/work-order.js';
import * as fx from './fixtures/work-order-v2.js';

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
    if (/\/designs\?/.test(u)) return json([{ id: 'D1', user_id: 'U1', title: '테스트 설계' }]);
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
