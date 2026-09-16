/**
 * B5: 작업지시서 v2 — 발행 시 동결(render_payload)·섹션 렌더·rev 차이·보링 파싱·구 payload 호환.
 *
 * DB 는 PostgREST 경로별로 응답하는 가짜 fetch 로 대신한다 (cut-plan.test.js 와 같은 방식).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  partsDigest,
  diffParts,
  parseBoringNote,
  doorHeightFromBoring,
  moduleNameOf,
  doorRowsForHinge,
  distinctFinishCodes,
  normalizeHex,
  itemUniqueIdOf,
  workOrderTotals,
  collectRenders,
  collectSwatches,
  collectPrevRev,
  gatherWorkOrderPayload,
  isMissingRelation,
  WORK_ORDER_VERSION,
} from '../src/work-order-data.js';
import {
  renderWorkOrder,
  edgesFromLegacy,
  edgeSvg,
  sheetSvg,
  boringRows,
  labelUnits,
  groupByItemModule,
  LABELS_PER_SHEET,
} from '../src/templates/work-order.js';
import { issueDocument, resolvePrintAssets, renderDocument } from '../src/documents.js';
import { createSignedUrls } from '../src/storage.js';
import { DbError } from '../src/supabase.js';
import * as fx from './fixtures/work-order-v2.js';

const ENV = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SHARE_TOKEN_PEPPER: 'p',
  PUBLIC_BASE_URL: 'https://dadamfurniture.com',
};

const json = (rows, status = 200) => ({
  ok: true, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows),
});
const fail = (status, body) => ({
  ok: false, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
});

/** 가짜 fetch — 호출 기록을 남기고 route(url, init) 가 돌려주는 응답을 쓴다. */
async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const res = route(u, init, calls);
    if (!res) throw new Error(`unexpected fetch ${init.method || 'GET'} ${u}`);
    return res;
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

// ── 순수 헬퍼 ────────────────────────────────────────────────────

test('partsDigest — 식별·치수·수량·마감만 남기고 partId 없는 행은 row-N', () => {
  const d = partsDigest([
    { partId: 'a', part: '측판', w: '550', h: 720, qty: 2, thickness: 15, finishCode: 'X', material: 'PB', module: 'm', itemLabel: 'i', edges: {} },
    { part: '선반', w: 500, h: 300, qty: 1, thickness: 15, material: 'PB' },
  ]);
  assert.deepEqual(d[0], { partId: 'a', itemLabel: 'i', module: 'm', part: '측판', material: 'PB', thickness: 15, w: 550, h: 720, qty: 2, finishCode: 'X' });
  assert.equal(d[1].partId, 'row-1');
  assert.equal(d[1].finishCode, '');
});

test('diffParts — partId 기준 added/removed/changed, 바뀐 필드만 적는다', () => {
  const prev = partsDigest([
    { partId: 'p1', part: '측판', w: 550, h: 720, qty: 2, thickness: 15, material: 'PB' },
    { partId: 'p2', part: '도어', w: 496, h: 716, qty: 1, thickness: 18, material: 'PET', finishCode: 'A' },
    { partId: 'p3', part: '선반', w: 500, h: 300, qty: 1, thickness: 15, material: 'PB' },
  ]);
  const cur = partsDigest([
    { partId: 'p1', part: '측판', w: 550, h: 720, qty: 2, thickness: 15, material: 'PB' },
    { partId: 'p2', part: '도어', w: 496, h: 716, qty: 2, thickness: 18, material: 'PET', finishCode: 'B' },
    { partId: 'p4', part: '뒷판', w: 970, h: 705, qty: 1, thickness: 2.7, material: 'MDF' },
  ]);
  const d = diffParts(prev, cur);
  assert.deepEqual(d.added.map((r) => r.partId), ['p4']);
  assert.deepEqual(d.removed.map((r) => r.partId), ['p3']);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].partId, 'p2');
  assert.deepEqual(d.changed[0].changes, [
    { field: 'qty', from: 1, to: 2 },
    { field: 'finishCode', from: 'A', to: 'B' },
  ]);
});

test('diffParts — partId 없는 옛 행은 품목/모듈/부품#k 로 맞춰 순번이 밀려도 안 바뀐 걸로 본다', () => {
  const prev = partsDigest([
    { part: '측판', w: 550, h: 720, qty: 2, thickness: 15, material: 'PB', module: 'm', itemLabel: 'i' },
    { part: '도어', w: 496, h: 716, qty: 1, thickness: 18, material: 'PET', module: 'm', itemLabel: 'i' },
  ]);
  const cur = partsDigest([
    { part: '선반', w: 500, h: 300, qty: 1, thickness: 15, material: 'PB', module: 'm', itemLabel: 'i' }, // 앞에 끼어듦
    { part: '측판', w: 550, h: 720, qty: 2, thickness: 15, material: 'PB', module: 'm', itemLabel: 'i' },
    { part: '도어', w: 496, h: 716, qty: 1, thickness: 18, material: 'PET', module: 'm', itemLabel: 'i' },
  ]);
  const d = diffParts(prev, cur);
  assert.equal(d.changed.length, 0);
  assert.equal(d.removed.length, 0);
  assert.deepEqual(d.added.map((r) => r.part), ['선반']);
});

test('parseBoringNote — extractHinges 비고 형식, 구조화 boring 우선, 못 읽으면 null', () => {
  assert.deepEqual(parseBoringNote({ note: '개수대 (보링: 110, 358, 606)' }), { moduleName: '개수대', positions: [110, 358, 606] });
  assert.deepEqual(parseBoringNote({ note: 'hood (보링: 110,610)' }), { moduleName: 'hood', positions: [110, 610] });
  assert.deepEqual(parseBoringNote({ note: '무시됨', boring: [110, 500], module: '키큰장' }), { moduleName: '키큰장', positions: [110, 500] });
  assert.equal(parseBoringNote({ note: '450mm 레일' }), null);
  assert.equal(parseBoringNote({ note: '' }), null);
  assert.equal(parseBoringNote(null), null);
});

test('doorHeightFromBoring — [110, …, H−110] 이면 H, 아니면 null', () => {
  assert.equal(doorHeightFromBoring([110, 358, 606]), 716);
  assert.equal(doorHeightFromBoring([110, 610]), 720);
  assert.equal(doorHeightFromBoring([100, 600]), null);
  assert.equal(doorHeightFromBoring([110]), null);
});

test('moduleNameOf — 품목 접두·상/하부장 접두·(단) 접미를 뗀다', () => {
  assert.equal(moduleNameOf('#1 하부장-개수대'), '개수대');
  assert.equal(moduleNameOf('상부장-후드장'), '후드장');
  assert.equal(moduleNameOf('키큰장(상단)'), '키큰장');
  assert.equal(moduleNameOf(''), '');
});

test('doorRowsForHinge — 같은 품목·모듈의 도어 행만 (slot 또는 부품명)', () => {
  const rows = doorRowsForHinge(fx.materials(), fx.hardware()[0]);
  assert.deepEqual(rows.map((r) => r.row.partId), ['0-l1-door#0-0']);
  const other = doorRowsForHinge(fx.materials(), { ...fx.hardware()[0], itemLabel: '다른품목' });
  assert.equal(other.length, 0);
});

test('distinctFinishCodes · normalizeHex · itemUniqueIdOf', () => {
  assert.deepEqual(distinctFinishCodes(fx.materials()), ['PET-OAK-M', 'YR-YPA-02']);
  assert.equal(normalizeHex('#C9A877'), '#c9a877');
  assert.equal(normalizeHex('red'), null);
  assert.equal(normalizeHex('#fff'), null);
  assert.equal(normalizeHex('#c9a877; background:url(x)'), null);
  assert.equal(itemUniqueIdOf({ uniqueId: 1757900000123.45 }), 1757900000123);
  assert.equal(itemUniqueIdOf({ unique_id: '42' }), 42);
  assert.equal(itemUniqueIdOf({}), null);
});

test('workOrderTotals — 시트 수는 배치(없으면 snapshot.sheet_count), 라벨 수는 Σ qty', () => {
  assert.deepEqual(workOrderTotals(fx.snapshot(), fx.cutPlan()), { sheet_count: 2, label_count: 8 });
  assert.deepEqual(workOrderTotals(fx.snapshot({ sheet_count: 5 }), null), { sheet_count: 5, label_count: 8 });
  assert.deepEqual(workOrderTotals(fx.snapshotV1(), null), { sheet_count: null, label_count: 8 });
});

test('isMissingRelation — 표·컬럼 없음 코드만', () => {
  assert.equal(isMissingRelation(new DbError('Supabase 404: {"code":"PGRST205"}', 404)), true);
  assert.equal(isMissingRelation(new DbError('42703 column materials.series does not exist', 400)), true);
  assert.equal(isMissingRelation(new DbError('Supabase 500: boom', 500)), false);
  assert.equal(isMissingRelation(new Error('PGRST205')), false);
});

// ── 발행 시점 수집 (가짜 DB) ──────────────────────────────────────

test('collectRenders — 품목별 최신 정면만, 없는 품목은 path null', async () => {
  const items = [{ uniqueId: 1 }, { uniqueId: 2.9 }, { uniqueId: 3 }];
  await withFetch((u) => {
    if (/\/design_renders\?/.test(u)) {
      assert.match(u, /kind=eq\.front/);
      assert.match(u, /item_unique_id=in\.%281%2C2%2C3%29/);
      return json([
        { item_unique_id: 1, path: 'D1/1/front-new.png', width: 2048, height: 1024, created_at: '2026-09-16T02:00:00Z' },
        { item_unique_id: 1, path: 'D1/1/front-old.png', width: 1024, height: 512, created_at: '2026-09-15T02:00:00Z' },
        { item_unique_id: 2, path: 'D1/2/front.png', width: null, height: null, created_at: '2026-09-15T02:00:00Z' },
      ]);
    }
    return null;
  }, async () => {
    const out = await collectRenders(ENV, 'D1', items);
    assert.equal(out.length, 3);
    assert.equal(out[0].path, 'D1/1/front-new.png');
    assert.equal(out[0].width, 2048);
    assert.equal(out[1].item_unique_id, 2);
    assert.equal(out[1].path, 'D1/2/front.png');
    assert.equal(out[2].path, null);
  });
});

test('collectRenders — design_renders 표가 없으면 전부 null (발행은 계속된다)', async () => {
  await withFetch((u) => (/\/design_renders\?/.test(u) ? fail(404, { code: 'PGRST205', message: 'Could not find the table' }) : null), async () => {
    const out = await collectRenders(ENV, 'D1', [{ uniqueId: 1 }]);
    assert.deepEqual(out, [{ item_index: 0, item_unique_id: 1, path: null, width: null, height: null, created_at: null }]);
  });
});

test('collectRenders — uniqueId 없는 품목은 조회하지 않는다', async () => {
  await withFetch(() => null, async (calls) => {
    const out = await collectRenders(ENV, 'D1', [{ labelName: '싱크대' }]);
    assert.equal(out[0].item_unique_id, null);
    assert.equal(calls.length, 0);
  });
});

test('collectSwatches — 카탈로그에 있는 코드는 이름·hex, 없는 코드는 hex null·이름=코드', async () => {
  await withFetch((u) => {
    if (/\/materials\?/.test(u)) {
      assert.match(decodeURIComponent(u), /code=in\.\("PET-OAK-M","YR-YPA-02"\)/);
      assert.match(u, /select=code%2Ccolor_name%2Ccolor_hex%2Cvendor_code%2Cseries%2Cfinish%2Ctone/);
      return json([{ code: 'YR-YPA-02', color_name: '아크 퓨어코튼', color_hex: '#F6EFE7', vendor_code: 'YPA-02', series: 'Prestige Acryl', finish: 'ACR', tone: 'matte' }]);
    }
    return null;
  }, async () => {
    const out = await collectSwatches(ENV, fx.materials());
    assert.deepEqual(out, [
      { code: 'PET-OAK-M', known: false, color_name: 'PET-OAK-M', color_hex: null, vendor_code: null, series: null, finish: null, tone: null },
      { code: 'YR-YPA-02', known: true, color_name: '아크 퓨어코튼', color_hex: '#f6efe7', vendor_code: 'YPA-02', series: 'Prestige Acryl', finish: 'ACR', tone: 'matte' },
    ]);
  });
});

test('collectSwatches — series 컬럼이 없으면 그 컬럼만 빼고 다시 조회한다', async () => {
  let n = 0;
  await withFetch((u) => {
    if (/\/materials\?/.test(u)) {
      n++;
      if (/series/.test(u)) return fail(400, { code: '42703', message: 'column materials.series does not exist' });
      return json([{ code: 'PET-OAK-M', color_name: '오크', color_hex: '#c9a877', finish: 'PET', tone: 'matte' }]);
    }
    return null;
  }, async () => {
    const out = await collectSwatches(ENV, fx.materials());
    assert.equal(n, 2);
    assert.equal(out[0].known, true);
    assert.equal(out[0].series, null);
  });
});

test('collectSwatches — 마감 코드가 없으면 조회 없이 빈 배열', async () => {
  await withFetch(() => null, async (calls) => {
    assert.deepEqual(await collectSwatches(ENV, [{ part: '측판' }]), []);
    assert.equal(calls.length, 0);
  });
});

test('collectPrevRev — 직전 work_order 가 없으면 null', async () => {
  await withFetch((u) => (/\/design_documents\?/.test(u) ? json([]) : null), async () => {
    assert.equal(await collectPrevRev(ENV, 'D1', []), null);
  });
});

test('collectPrevRev — v2 문서면 parts_digest 로, v1 문서면 그 스냅샷 자재로 비교한다', async () => {
  const cur = partsDigest(fx.materials());
  // v2 이전 문서
  await withFetch((u) => {
    if (/\/design_documents\?/.test(u)) {
      assert.match(u, /doc_type=eq\.work_order/);
      assert.match(u, /order=rev\.desc/);
      return json([{ id: 'DOC1', rev: 1, doc_no: 'WO-r1', snapshot_id: 'S1', render_payload: { parts_digest: cur.slice(0, 4) } }]);
    }
    return null;
  }, async (calls) => {
    const out = await collectPrevRev(ENV, 'D1', cur);
    assert.equal(out.rev, 1);
    assert.equal(out.document_id, 'DOC1');
    assert.equal(out.snapshot_rev, null);
    assert.deepEqual(out.diff.added.map((r) => r.partId), ['0-l1-back-0']);
    assert.equal(calls.length, 1, '스냅샷을 다시 읽지 않는다');
  });
  // v1 이전 문서 → 스냅샷 자재
  await withFetch((u) => {
    if (/\/design_documents\?/.test(u)) return json([{ id: 'DOC0', rev: 1, doc_no: 'WO-r1', snapshot_id: 'S1', render_payload: { quote: {} } }]);
    if (/\/design_snapshots\?/.test(u)) {
      assert.match(u, /id=eq\.S1/);
      return json([{ rev: 1, bom_payload: { materials: fx.materials().slice(1) } }]);
    }
    return null;
  }, async () => {
    const out = await collectPrevRev(ENV, 'D1', cur);
    assert.equal(out.snapshot_rev, 1);
    assert.deepEqual(out.diff.added.map((r) => r.partId), ['0-l1-body:side-0']);
    assert.equal(out.diff.removed.length, 0);
  });
});

test('gatherWorkOrderPayload — v2 필드 전부 + cut_plan 은 스냅샷 값 그대로', async () => {
  await withFetch((u) => {
    if (/\/design_renders\?/.test(u)) return json([{ item_unique_id: 1757900000123, path: 'D1/1757900000123/front.png', width: 2048, height: 1536, created_at: '2026-09-16T01:00:00Z' }]);
    if (/\/materials\?/.test(u)) return json([]);
    if (/\/design_documents\?/.test(u)) return json([]);
    return null;
  }, async () => {
    const out = await gatherWorkOrderPayload(ENV, { designId: 'D1', snapshot: fx.snapshot() });
    assert.equal(out.work_order_version, WORK_ORDER_VERSION);
    assert.equal(out.renders[0].path, 'D1/1757900000123/front.png');
    assert.equal(out.swatches.length, 2);
    assert.deepEqual(out.cut_plan, fx.cutPlan());
    assert.equal(out.parts_digest.length, 5);
    assert.equal(out.prev_rev, null);
  });
  await withFetch((u) => (/\/(design_renders|materials|design_documents)\?/.test(u) ? json([]) : null), async () => {
    const out = await gatherWorkOrderPayload(ENV, { designId: 'D1', snapshot: fx.snapshotV1() });
    assert.equal(out.cut_plan, null);
    assert.equal(out.renders[0].path, null);
  });
});

// ── issueDocument 통합 ───────────────────────────────────────────

function issueRoute(snapshot, { prevDoc = null } = {}) {
  return (u, init) => {
    const method = init.method || 'GET';
    const path = u.split('?')[0];
    if (/\/designs\?/.test(u)) return json([{ id: 'D1', user_id: 'U1', title: '테스트 설계' }]);
    if (/\/design_snapshots\?id=eq\./.test(u)) return json([snapshot]);
    if (/\/design_snapshots\?/.test(u)) return json([]);
    if (method === 'POST' && /\/design_documents$/.test(path)) {
      return json([{ id: 'DOC-NEW', created_at: '2026-09-16T03:00:00Z', ...JSON.parse(init.body) }], 201);
    }
    if (method === 'PATCH' && /\/design_documents$/.test(path)) return json([]);
    if (/\/design_documents\?/.test(u)) {
      if (/select=rev(&|$)/.test(u)) return json(prevDoc ? [{ rev: prevDoc.rev }] : []);
      return json(prevDoc ? [prevDoc] : []);
    }
    if (/\/design_renders\?/.test(u)) return json([{ item_unique_id: 1757900000123, path: 'D1/1757900000123/front.png', width: 2048, height: 1536, created_at: '2026-09-16T01:00:00Z' }]);
    if (/\/materials\?/.test(u)) return json([{ code: 'PET-OAK-M', color_name: '오크 무광', color_hex: '#c9a877', vendor_code: null, series: null, finish: 'PET', tone: 'matte' }]);
    return null;
  };
}

test('issueDocument(work_order) — render_payload 에 v2 자료가 동결되고 totals 에 sheet_count·label_count 가 붙는다', async () => {
  const prevDoc = { id: 'DOC1', rev: 1, doc_no: 'WO-r1', snapshot_id: 'S1', render_payload: { parts_digest: partsDigest(fx.materials().slice(0, 4)) } };
  await withFetch(issueRoute(fx.snapshot(), { prevDoc }), async (calls) => {
    const out = await issueDocument(ENV, { user: { id: 'U1', email: 'hong@example.com' }, body: { doc_type: 'work_order', snapshot_id: 'S2' } });
    const post = calls.find((c) => c.method === 'POST' && /\/design_documents$/.test(c.url.split('?')[0]));
    const rp = post.body.render_payload;
    assert.equal(post.body.rev, 2);
    assert.equal(rp.work_order_version, 2);
    assert.equal(rp.renders[0].path, 'D1/1757900000123/front.png');
    assert.equal(rp.swatches.find((s) => s.code === 'PET-OAK-M').color_hex, '#c9a877');
    assert.equal(rp.swatches.find((s) => s.code === 'YR-YPA-02').known, false);
    assert.equal(rp.cut_plan.sheets.length, 2);
    assert.equal(rp.parts_digest.length, 5);
    assert.equal(rp.prev_rev.rev, 1);
    assert.deepEqual(rp.prev_rev.diff.added.map((r) => r.partId), ['0-l1-back-0']);
    assert.deepEqual(post.body.totals, { subtotal: 480000, vat: 48000, total: 528000, sheet_count: 2, label_count: 8 });
    assert.equal(out.document.id, 'DOC-NEW');
    assert.equal(out.share_token, null);
  });
});

test('issueDocument(customer_confirmation) — v2 자료를 모으지 않는다', async () => {
  await withFetch(issueRoute(fx.snapshot()), async (calls) => {
    await issueDocument(ENV, { user: { id: 'U1', email: 'x' }, body: { doc_type: 'customer_confirmation', snapshot_id: 'S2' } });
    const post = calls.find((c) => c.method === 'POST' && /\/design_documents$/.test(c.url.split('?')[0]));
    assert.equal(post.body.render_payload.work_order_version, undefined);
    assert.equal(post.body.render_payload.renders, undefined);
    assert.equal(post.body.totals.sheet_count, undefined);
    assert.ok(!calls.some((c) => /\/design_renders\?/.test(c.url)));
  });
});

// ── 서명 URL ─────────────────────────────────────────────────────

test('createSignedUrls — sign 엔드포인트에 경로 묶음을 보내고 절대 URL 로 돌려준다', async () => {
  await withFetch((u, init) => {
    if (u === 'https://x.supabase.co/storage/v1/object/sign/renders') {
      const body = JSON.parse(init.body);
      assert.equal(body.expiresIn, 3600);
      assert.deepEqual(body.paths, ['a/front.png', 'b/front.png']);
      assert.equal(init.headers.Authorization, 'Bearer service');
      return json([
        { error: null, path: 'a/front.png', signedURL: '/object/sign/renders/a/front.png?token=T1' },
        { error: 'Object not found', path: 'b/front.png', signedURL: null },
      ]);
    }
    return null;
  }, async () => {
    const m = await createSignedUrls(ENV, 'renders', ['a/front.png', 'b/front.png', 'a/front.png']);
    assert.equal(m.get('a/front.png'), 'https://x.supabase.co/storage/v1/object/sign/renders/a/front.png?token=T1');
    assert.equal(m.has('b/front.png'), false);
  });
  assert.equal((await createSignedUrls(ENV, 'renders', [])).size, 0);
});

test('resolvePrintAssets — 서명 실패해도 빈 Map (인쇄는 된다), 작업지시서가 아니면 조회 없음', async () => {
  await withFetch(() => fail(400, { message: 'Bucket not found' }), async () => {
    const out = await resolvePrintAssets(ENV, fx.doc());
    assert.equal(out.renderUrls.size, 0);
  });
  await withFetch(() => null, async (calls) => {
    const out = await resolvePrintAssets(ENV, { ...fx.doc(), doc_type: 'customer_confirmation' });
    assert.equal(out.renderUrls.size, 0);
    assert.equal(calls.length, 0);
    const v1 = await resolvePrintAssets(ENV, fx.docV1());
    assert.equal(v1.renderUrls.size, 0);
    assert.equal(calls.length, 0);
  });
});

// ── 템플릿 섹션 ───────────────────────────────────────────────────

const SIGNED = new Map([['D1/1757900000123/front-20260916010000.png', 'https://x.supabase.co/storage/v1/object/sign/renders/D1/f.png?token=T&x=1']]);

test('① 표지 — 정면 렌더 <img>(서명 URL 이스케이프) + 스와치 범례(칩 hex·이름·코드·시리즈)', () => {
  const html = renderWorkOrder(fx.doc(), fx.snapshot(), { renderUrls: SIGNED });
  assert.ok(html.includes('<img src="https://x.supabase.co/storage/v1/object/sign/renders/D1/f.png?token=T&amp;x=1"'));
  assert.ok(html.includes('2,048×1,536px'));
  assert.ok(html.includes('style="background:#c9a877"'));
  assert.ok(html.includes('오크 무광'));
  assert.ok(html.includes('Prestige Acryl · ACR · matte'));
  assert.ok(html.includes('YPA-02'));
  assert.ok(html.includes('재단 시트</dt><dd>2장'));
  assert.ok(html.includes('라벨 수</dt><dd>8'));
  assert.ok(!html.includes('528,000'), '금액 없음');
});

test('① 표지 — 렌더가 없으면 자리표시, 경로는 있는데 서명 URL 이 없으면 불러올 수 없음', () => {
  const none = renderWorkOrder(fx.doc({ render_payload: { ...fx.doc().render_payload, renders: [] } }), fx.snapshot());
  assert.ok(none.includes('정면 렌더 없음'));
  assert.ok(!none.includes('<img'));
  const unsigned = renderWorkOrder(fx.doc(), fx.snapshot(), { renderUrls: new Map() });
  assert.ok(unsigned.includes('렌더를 불러올 수 없음'));
});

test('② 키팅 — 품목 → 모듈 묶음, partId·마감 칩·엣지 도식·그 모듈의 경첩', () => {
  const groups = groupByItemModule(fx.materials());
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].modules.map((m) => m.module), ['하부장-개수대', '상부장-후드장']);

  const html = renderWorkOrder(fx.doc(), fx.snapshot());
  assert.ok(html.includes('② 모듈별 키팅 — 싱크대'));
  assert.ok(html.includes('<span class="mono">0-l1-body:side-0</span>'));
  assert.ok(html.includes('class="edge-svg"'));
  assert.ok(html.includes('PET 18T'));
  // 개수대 모듈 블록 안에 개수대 경첩이, 후드장 블록 안에 후드장 경첩이 있다
  const lower = html.indexOf('하부장-개수대 <span class="muted">');
  const upper = html.indexOf('상부장-후드장 <span class="muted">');
  const h1 = html.indexOf('개수대 (보링: 110, 358, 606)');
  const h2 = html.indexOf('후드장 (보링: 110, 368, 625)');
  assert.ok(lower < h1 && h1 < upper && upper < h2, `${lower} ${h1} ${upper} ${h2}`);
  assert.ok(html.includes('기타 철물'), '모듈을 못 찾은 레일·다리는 기타로');
});

test('엣지 도식 — 밴딩 변은 굵게, 옛 문자열 edge 는 §7-2 규칙으로 변을 정한다', () => {
  const svg = edgeSvg({ L: true, R: false, T: true, B: false });
  const widths = [...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => m[1]);
  assert.deepEqual(widths, ['2.6', '0.5', '2.6', '0.5']); // T, B, L, R 순
  assert.deepEqual(edgesFromLegacy('4면', 550, 720), { L: true, R: true, T: true, B: true });
  assert.deepEqual(edgesFromLegacy('3면', 550, 720), { L: true, R: false, T: true, B: true });
  assert.deepEqual(edgesFromLegacy('3면', 720, 550), { L: true, R: true, T: true, B: false });
  assert.deepEqual(edgesFromLegacy('2면(장)', 970, 70), { L: false, R: false, T: true, B: true });
  assert.deepEqual(edgesFromLegacy('2면(가로)', 70, 970), { L: false, R: false, T: true, B: true });
  assert.deepEqual(edgesFromLegacy('1면(전)', 970, 550), { L: false, R: false, T: true, B: false });
  assert.deepEqual(edgesFromLegacy('-', 1, 1), { L: false, R: false, T: false, B: false });
});

test('③ 시트별 재단표 — 시트 머리·SVG 축소판(트림 음영·조각·partId)·부재 표·잔재', () => {
  const html = renderWorkOrder(fx.doc(), fx.snapshot());
  assert.ok(html.includes('③ 시트별 재단표'));
  assert.ok(html.includes('<b>시트 #1</b> PB 15T · 본체'));
  assert.ok(html.includes('수율 44.5%'));
  assert.ok(html.includes('<svg viewBox="0 0 1220 2440"'));
  assert.ok(html.includes('<rect x="10" y="10" width="1200" height="2420"'), '트림 안쪽');
  assert.ok(html.includes('<rect x="564" y="10" width="550" height="720"'));
  assert.ok(html.includes('0-l1-body:bottom-0#0'));
  assert.ok(html.includes('스트립 잔여') || html.includes('원판 잔여'));
  assert.ok(html.includes('PB_15 1장'));
});

test('sheetSvg — 회전 조각은 발자국이 h×w 이고, 자리가 좁으면 글자를 넣지 않는다', () => {
  const svg = sheetSvg({ size: { w: 1220, h: 2440 }, trim: 10, parts: [
    { partId: 'a#0', part: '도어', w: 396, h: 716, x: 10, y: 10, rot: true },
    { partId: 'tiny-part-with-long-id#0', part: '밴드', w: 70, h: 60, x: 800, y: 10, rot: false },
  ] });
  assert.ok(svg.includes('<rect x="10" y="10" width="716" height="396"'));
  assert.ok(svg.includes('↻'));
  assert.ok(!svg.includes('tiny-part-with-long-id'));
  assert.equal(sheetSvg({ size: { w: 0, h: 0 } }), '');
});

test('③ 배치가 없으면 안내 + 자재 목록 폴백', () => {
  const doc = fx.doc({ render_payload: { ...fx.doc().render_payload, cut_plan: null } });
  const html = renderWorkOrder(doc, fx.snapshot());
  assert.ok(html.includes('재단 배치 없음 (스냅샷 재발행 필요)'));
  assert.ok(!html.includes('<b>시트 #1</b>'));
  assert.ok(html.includes('0-l1-body:side-0'), '폴백 자재 목록');
  assert.ok(html.includes('재단 시트</dt><dd>2장'), 'totals 의 sheet_count 는 그대로 표시');
});

test('④ 철물 — 분류별 묶음과 합계', () => {
  const html = renderWorkOrder(fx.doc(), fx.snapshot());
  assert.ok(html.includes('④ 철물·체결구 (4건)'));
  assert.ok(html.includes('경첩 <span class="muted">2건 · 12</span>'));
  assert.ok(html.includes('레일 <span class="muted">1건 · 1</span>'));
});

test('⑤ 보링 — 경첩 비고 → 도어 partId·도어 H·구 수·위치, 도어 행이 없으면 미확인', () => {
  const rows = boringRows(fx.materials(), fx.hardware());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].partId, '0-l1-door#0-0');
  assert.equal(rows[0].doorH, 716);
  assert.equal(rows[0].count, 3);
  assert.deepEqual(rows[0].positions, [110, 358, 606]);
  assert.equal(rows[0].qty, 2);
  assert.equal(rows[1].partId, '0-u1-door#0-0');

  const orphan = boringRows([], fx.hardware());
  assert.equal(orphan[0].partId, null);
  assert.equal(orphan[0].doorH, 716, '자재 행이 없어도 보링에서 H 를 되돌린다');

  const html = renderWorkOrder(fx.doc(), fx.snapshot());
  assert.ok(html.includes('⑤ 보링 좌표표'));
  assert.ok(html.includes('110, 358, 606'));
  const noHinge = renderWorkOrder(fx.doc(), fx.snapshot({ hardware_payload: { hardware: [] } }));
  assert.ok(noHinge.includes('경첩 보링 정보 없음'));
});

test('⑥ 조립 순서 체크 — 모듈마다 체크 5칸 + 완료일·서명', () => {
  const html = renderWorkOrder(fx.doc(), fx.snapshot());
  assert.ok(html.includes('⑥ 조립 순서 체크'));
  const rows = html.split('<td class="box">☐</td>').length - 1;
  assert.equal(rows, 2 * 5);
  assert.ok(html.includes('하부 개수대'));
  assert.ok(html.includes('<th>완료일</th><th>서명</th>'));
});

test('⑦ rev 차이 — 추가/삭제/변경 표, 첫 발행, v1 문서 안내', () => {
  const html = renderWorkOrder(fx.doc(), fx.snapshot());
  assert.ok(html.includes('비교 대상: DD-20260910-D1D1-WO-r1 (Rev. 1) → 이 문서 Rev. 2'));
  assert.ok(html.includes('추가 (1)'));
  assert.ok(html.includes('삭제 (1)'));
  assert.ok(html.includes('변경 (1)'));
  assert.ok(html.includes('마감: PET-WHITE-M → PET-OAK-M · 수량: 1 → 2'));

  const first = renderWorkOrder(fx.doc({ render_payload: { ...fx.doc().render_payload, prev_rev: null } }), fx.snapshot());
  assert.ok(first.includes('첫 발행'));

  const same = renderWorkOrder(fx.doc({ render_payload: { ...fx.doc().render_payload, prev_rev: { rev: 1, doc_no: 'X', diff: { added: [], removed: [], changed: [] } } } }), fx.snapshot());
  assert.ok(same.includes('부재 변경 없음'));

  const v1 = renderWorkOrder(fx.docV1(), fx.snapshotV1());
  assert.ok(v1.includes('v1 발행 문서 — 비교 자료 없음'));
});

test('⑧ 라벨 — 부재 낱개마다 QR + partId#k + 품목/모듈/부품 + 치수 + 마감, 24장씩 나눈다', () => {
  const units = labelUnits(fx.materials());
  assert.equal(units.length, 8);
  assert.deepEqual(units.slice(0, 3).map((u) => u.id), ['0-l1-body:side-0#0', '0-l1-body:side-0#1', '0-l1-body:bottom-0#0']);

  const html = renderWorkOrder(fx.doc(), fx.snapshot());
  assert.equal(html.split('<div class="label">').length - 1, 8);
  assert.equal(html.split('<svg class="qr"').length - 1, 8);
  assert.ok(html.includes('<div class="pid">0-l1-door#0-0#1</div>'));
  assert.ok(html.includes('<div class="dim">496 × 716 × 18</div>'));
  assert.ok(html.includes('1–8 / 8'));

  const many = fx.materials().map((m) => ({ ...m, qty: 6 })); // 30 장
  const big = renderWorkOrder(fx.doc(), fx.snapshot({ bom_payload: { materials: many } }));
  assert.equal(big.split('<div class="label-grid">').length - 1, Math.ceil(30 / LABELS_PER_SHEET));
  assert.ok(big.includes('25–30 / 30'));
});

test('구 문서(v1 payload + v1 스냅샷) 도 전 섹션이 렌더된다 — 렌더 없음·코드만 범례·row-N 라벨·문자열 엣지', () => {
  const html = renderWorkOrder(fx.docV1(), fx.snapshotV1());
  for (const s of ['정면 렌더 없음', '② 모듈별 키팅', '③ 시트별 재단표', '재단 배치 없음', '④ 철물·체결구', '⑤ 보링 좌표표', '⑥ 조립 순서 체크', '⑦ 이전 rev 와의 차이', '⑧ 부재 라벨']) {
    assert.ok(html.includes(s), s);
  }
  assert.ok(html.includes('<span class="chip none"></span><span class="mono">PET-OAK-M</span>'), '카탈로그 조회가 없던 문서는 코드만');
  assert.ok(html.includes('<div class="pid">row-0#0</div>'));
  assert.ok(html.includes('재단 시트</dt><dd>배치 없음'));
  assert.ok(html.includes('class="edge-svg"'), '옛 행도 문자열 edge 로 도식을 그린다');
  assert.ok(!html.includes('528,000'));
  // renderDocument 분기도 같은 결과
  assert.equal(renderDocument(fx.docV1(), fx.snapshotV1(), { toolbar: false }), renderWorkOrder(fx.docV1(), fx.snapshotV1(), { toolbar: false }));
});

test('v2 문서지만 스냅샷에 배치가 있고 payload 엔 없는 경우(옛 발행) — 스냅샷 값을 쓴다', () => {
  const rp = { ...fx.doc().render_payload };
  delete rp.cut_plan;
  const html = renderWorkOrder(fx.doc({ render_payload: rp }), fx.snapshot());
  assert.ok(html.includes('<b>시트 #1</b>'));
});

test('XSS — partId·모듈·비고·hex 가 이스케이프되거나 거부된다', () => {
  const mats = fx.materials();
  mats[0].partId = '<script>alert(1)</script>';
  mats[0].module = '<img src=x onerror=alert(2)>';
  const rp = { ...fx.doc().render_payload, swatches: [{ code: 'PET-OAK-M', color_name: '<b>x</b>', color_hex: '#fff" onload="alert(3)' }] };
  const html = renderWorkOrder(fx.doc({ render_payload: rp }), fx.snapshot({ bom_payload: { materials: mats } }));
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('onload='));
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('모든 섹션 표는 thead 를 써서 머리를 반복한다', () => {
  const html = renderWorkOrder(fx.doc(), fx.snapshot());
  const tables = html.split('<table').length - 1;
  const heads = html.split('<thead>').length - 1;
  assert.equal(tables, heads);
});
