/**
 * 철물 · 부속 카탈로그 (src/part-catalog.js — DB 0071, 2026-11-18 사장님 「회사별로 구분」 · 「다담 공장만 따로 보게」)
 *
 *   누가: 다담 공장 구성원 · 본사 구성원만 (다른 팩토리 403), 올리기 · 사진 · 고치기는 대표 · 실장만, 매입가는 대표 · 실장에게만
 *   올리기: 공급 회사를 찾거나 만들고, 같은 상품 번호(없으면 같은 이름)는 고치고 없으면 넣는다 — 매입가 · 사진 · 확인한 사양은 그대로
 *   사진: 바이트로 형식을 보고 비공개 버킷에 올린다 · 읽을 때 서명 주소
 * 사람 · 회사 · 상품 · 값은 모두 지어낸 시험 값이다.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ForbiddenError, NotFoundError, TooLargeError, ValidationError, clearHqCompanyCache } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';
import {
  PART_IMPORT_BODY_MAX_BYTES, PART_IMPORT_MAX, PART_JSON_MAX, PART_PHOTOS_BUCKET, PART_PHOTO_MAX_BYTES, PART_PRICE_MAX, PART_SIZE_MAX, PART_TEXT_MAX,
  PART_LEDGER_UPDATE_MAX, addPartPhoto, catalogCompanyOf, cleanPartItem, importParts, importPartsFromLedger, kstDay, ledgerNameKey, ledgerSupplierOf, partCatalog, partLedgerSuppliers, patchPartItem,
} from '../src/part-catalog.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };
const HQ = 'f0000000-0000-4000-8000-0000000000aa';
const PLATFORM = 'f0000000-0000-4000-8000-0000000000ab';
const P1 = 'f0000000-0000-4000-8000-0000000000b1';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const STAFF = 'a0000000-0000-4000-8000-000000000003';
const HQ_PERSON = 'a0000000-0000-4000-8000-000000000005';
const PARTNER_OWNER = 'a0000000-0000-4000-8000-000000000004';
const NOBODY = 'a0000000-0000-4000-8000-000000000009';
const u = (id) => ({ id });
const json = (rows, status = 200) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });

function makeDb({ tables = true } = {}) {
  return {
    companies: [
      { id: HQ, kind: 'hq', name: '다담 공장', plan: null, status: 'active' },
      { id: PLATFORM, kind: 'platform', name: '다담 본사', plan: null, status: 'active' },
      { id: P1, kind: 'partner', name: '가나 팩토리', plan: 'agent', status: 'active' },
    ],
    company_members: [
      { user_id: OWNER, company_id: HQ, role: 'owner', status: 'active' },
      { user_id: STAFF, company_id: HQ, role: 'staff', status: 'active' },
      { user_id: HQ_PERSON, company_id: PLATFORM, role: 'owner', status: 'active' },
      { user_id: PARTNER_OWNER, company_id: P1, role: 'owner', status: 'active' },
    ],
    admin_roles: [],
    part_vendors: tables ? [] : null,
    part_items: tables ? [] : null,
    ledger_documents: [],
    ledger_extractions: [],
    objects: new Map(),
    signed: [],
    writes: [],
  };
}

function matches(row, key, expr) {
  const m = /^eq\.([\s\S]*)$/.exec(expr);
  if (!m) throw new Error(`가짜 DB: 모르는 필터 ${key}=${expr}`);
  return String(row[key]) === m[1];
}

/** 가짜 DB — 읽기(eq · limit · offset) · 넣기 · 고치기 + 저장소(올리기 · 서명 주소) */
async function withDb(db, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const s = String(url);
    const method = init.method || 'GET';
    const sign = /\/storage\/v1\/object\/sign\/([a-z-]+)$/.exec(s);
    if (sign) {
      const { paths } = JSON.parse(init.body);
      db.signed.push({ bucket: sign[1], n: paths.length });
      return json(paths.filter((p) => db.objects.has(`${sign[1]}/${p}`)).map((p) => ({ path: p, signedURL: `/object/sign/${sign[1]}/${p}?token=t` })));
    }
    const up = /\/storage\/v1\/object\/([a-z-]+)\/(.+)$/.exec(s);
    if (up && method === 'POST') {
      if (db.part_items === null) return json({ message: 'Bucket not found' }, 404);
      db.objects.set(`${up[1]}/${up[2]}`, { bytes: init.body.byteLength, mime: init.headers['Content-Type'], upsert: init.headers['x-upsert'] });
      return json({ Key: up[2] });
    }
    const m = /\/rest\/v1\/([a-z_]+)(?:\?(.*))?$/.exec(s);
    if (!m) throw new Error(`unexpected fetch ${method} ${s}`);
    const [, table, qs = ''] = m;
    if (db[table] === null) return json({ code: '42P01', message: `relation "public.${table}" does not exist` }, 404);
    if (!db[table]) throw new Error(`unexpected table ${table}`);
    const q = new URLSearchParams(qs);
    const filters = [...q.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k));
    if (method === 'GET') {
      const rows = db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e)));
      const offset = Number(q.get('offset')) || 0;
      return json(rows.slice(offset, offset + (Number(q.get('limit')) || rows.length)));
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const out = (Array.isArray(body) ? body : [body]).map((r) => {
        const base = table === 'part_items'
          ? { id: randomUUID(), vendor_item_no: '', category: '', sub_category: '', brand: '', ref_price: null, ref_price_on: null, buy_price: null, buy_price_on: null, options: [], addons: [], specs: {}, specs_checked: false, width_mm: null, depth_mm: null, height_mm: null, source_url: '', note: '', photo_path: null, active: true }
          : { id: randomUUID(), site_url: '', memo: '' };
        const row = { ...base, ...r };
        db[table].push(row);
        return row;
      });
      db.writes.push({ table, method, n: out.length });
      return json(out, 201);
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(init.body);
      const hit = db[table].filter((r) => filters.every(([k, e]) => matches(r, k, e)));
      hit.forEach((r) => Object.assign(r, patch));
      db.writes.push({ table, method, n: hit.length, patch });
      return json(hit, 200);
    }
    throw new Error(`unexpected ${method} ${s}`);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

beforeEach(() => {
  clearHqCompanyCache();
  clearAdminCache();
});

const VENDOR = { name: '가나 철물', site_url: 'https://parts.example.com' };
const ITEMS = [
  { vendor_item_no: '1001', category: '경첩', sub_category: '댐핑', brand: '다라', name: '댐핑 경첩 110도', ref_price: 3200, source_url: 'https://parts.example.com/p/1001',
    options: [{ g: '두께', l: '18T용', d: 0 }, { g: '두께', l: '15T용', d: 500, x: true }], addons: [{ l: '시험 캡', p: 300 }] },
  { vendor_item_no: '1002', category: '씽크볼', name: '시험 씽크볼 800', ref_price: 250000, specs: { 재질: 'SUS304' }, width_mm: 800, depth_mm: 480, height_mm: 220 },
  { category: '레일', name: '번호 없는 레일', ref_price: null },
];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 40, 0, 60, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const photoReq = (bytes, headers = {}) => new Request('https://w/parts/items/x/photo', { method: 'POST', body: bytes, headers });

test('누가 — 다담 공장 구성원 · 본사 구성원만, 다른 팩토리와 구성원이 아닌 사람은 못 본다', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    assert.equal((await catalogCompanyOf(ENV, u(OWNER))).company.id, HQ);
    assert.deepEqual((await catalogCompanyOf(ENV, u(STAFF))).canManage, false);
    // 본사 구성원은 다담 공장의 카탈로그를 본다
    assert.equal((await catalogCompanyOf(ENV, u(HQ_PERSON))).company.id, HQ);
    await assert.rejects(() => partCatalog(ENV, { user: u(PARTNER_OWNER) }), (e) => e instanceof ForbiddenError && e.code === 'not_catalog_company');
    await assert.rejects(() => partCatalog(ENV, { user: u(NOBODY) }), ForbiddenError);
    // 올리기 · 사진 · 고치기는 대표 · 실장만
    await assert.rejects(() => importParts(ENV, { user: u(STAFF), body: { vendor: VENDOR, items: ITEMS } }), (e) => e instanceof ForbiddenError && e.code === 'not_manager');
    await assert.rejects(() => patchPartItem(ENV, { user: u(STAFF), params: { id: randomUUID() }, body: { active: false } }), (e) => e.code === 'not_manager');
    await assert.rejects(() => addPartPhoto(ENV, { user: u(STAFF), params: { id: randomUUID() }, request: photoReq(JPEG) }), (e) => e.code === 'not_manager');
  });
  assert.equal(db.writes.length, 0);
});

test('올리기 — 공급 회사를 만들고 상품을 넣는다 · 참고가가 있으면 본 날도 · 다시 올리면 달라진 것만 고친다', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const r = await importParts(ENV, { user: u(OWNER), body: { vendor: VENDOR, seen_on: '2026-11-18', items: ITEMS } });
    assert.deepEqual([r.added, r.updated, r.same], [3, 0, 0]);
    assert.equal(r.vendor.name, '가나 철물');
    assert.equal(db.part_vendors.length, 1);
    assert.equal(db.part_vendors[0].company_id, HQ);
    assert.deepEqual(Object.keys(r.ids).sort(), ['1001', '1002', '번호 없는 레일']);
    const hinge = db.part_items.find((x) => x.vendor_item_no === '1001');
    assert.deepEqual([hinge.ref_price, hinge.ref_price_on, hinge.company_id, hinge.created_by], [3200, '2026-11-18', HQ, OWNER]);
    assert.deepEqual(hinge.options, [{ g: '두께', l: '18T용', d: 0, x: false }, { g: '두께', l: '15T용', d: 500, x: true }]);
    assert.deepEqual(hinge.addons, [{ l: '시험 캡', p: 300 }]);
    const sink = db.part_items.find((x) => x.vendor_item_no === '1002');
    assert.deepEqual([sink.width_mm, sink.depth_mm, sink.height_mm, sink.specs], [800, 480, 220, { 재질: 'SUS304' }]);
    // 참고가가 없으면 본 날도 없다
    const rail = db.part_items.find((x) => x.name === '번호 없는 레일');
    assert.deepEqual([rail.ref_price, rail.ref_price_on, rail.specs], [null, null, {}]);

    // 같은 것을 다시 — 쓰기 없음
    const before = db.writes.length;
    const again = await importParts(ENV, { user: u(OWNER), body: { vendor: { name: ' 가나  철물 ' }, seen_on: '2026-12-01', items: ITEMS } });
    assert.deepEqual([again.added, again.updated, again.same], [0, 0, 3]);
    assert.equal(db.writes.length, before);
    assert.equal(db.part_vendors.length, 1);
    assert.equal(hinge.ref_price_on, '2026-11-18');

    // 값이 달라지면 그 상품만 고치고 본 날을 옮긴다 — 매입가 · 사진 · 쓰는지는 그대로
    Object.assign(hinge, { buy_price: 2500, buy_price_on: '2026-11-10', photo_path: `${HQ}/${hinge.id}.jpg`, active: false });
    const changed = await importParts(ENV, { user: u(OWNER), body: { vendor: VENDOR, seen_on: '2026-12-01', items: [{ ...ITEMS[0], ref_price: 3500 }, ITEMS[1]] } });
    assert.deepEqual([changed.added, changed.updated, changed.same], [0, 1, 1]);
    assert.deepEqual([hinge.ref_price, hinge.ref_price_on, hinge.buy_price, hinge.buy_price_on, hinge.active], [3500, '2026-12-01', 2500, '2026-11-10', false]);
    assert.deepEqual(changed.ids['1001'], { id: hinge.id, has_photo: true });
  });
});

test('올리기 — 사람이 확인한 사양 · 치수는 다시 올려도 그대로', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await importParts(ENV, { user: u(OWNER), body: { vendor: VENDOR, seen_on: '2026-11-18', items: [ITEMS[1]] } });
    const sink = db.part_items[0];
    Object.assign(sink, { specs_checked: true, specs: { 재질: '확인함' }, width_mm: 790 });
    const r = await importParts(ENV, { user: u(OWNER), body: { vendor: VENDOR, seen_on: '2026-11-19', items: [{ ...ITEMS[1], specs: { 재질: '다시 읽음' }, width_mm: 800, note: '새 설명' }] } });
    assert.equal(r.updated, 1);
    assert.deepEqual([sink.specs, sink.width_mm, sink.note], [{ 재질: '확인함' }, 790, '새 설명']);
    // 확인 전이면 새 값으로 고친다
    sink.specs_checked = false;
    await importParts(ENV, { user: u(OWNER), body: { vendor: VENDOR, seen_on: '2026-11-19', items: [{ ...ITEMS[1], specs: { 재질: '다시 읽음' }, width_mm: 800, note: '새 설명' }] } });
    assert.deepEqual([sink.specs, sink.width_mm], [{ 재질: '다시 읽음' }, 800]);
    // 사양을 안 보내면 지금 값을 그대로 둔다
    await importParts(ENV, { user: u(OWNER), body: { vendor: VENDOR, seen_on: '2026-11-19', items: [{ vendor_item_no: '1002', category: '씽크볼', name: '시험 씽크볼 800', ref_price: 250000, note: '새 설명' }] } });
    assert.deepEqual([sink.specs, sink.width_mm], [{ 재질: '다시 읽음' }, 800]);
  });
});

test('올리기 검증 — 묶음 크기 · 겹친 상품 · 공급 회사 · 본 날 · 상품 값', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    const call = (body) => importParts(ENV, { user: u(OWNER), body });
    await assert.rejects(() => call(null), ValidationError);
    await assert.rejects(() => call({ vendor: { name: '' }, items: ITEMS }), ValidationError);
    await assert.rejects(() => call({ vendor: { name: 'x'.repeat(PART_TEXT_MAX.vendor + 1) }, items: ITEMS }), ValidationError);
    await assert.rejects(() => call({ vendor: { name: '가', site_url: 'http://x' }, items: ITEMS }), ValidationError);
    await assert.rejects(() => call({ vendor: VENDOR, seen_on: '2026-13-40', items: ITEMS }), ValidationError);
    await assert.rejects(() => call({ vendor: VENDOR, items: [] }), ValidationError);
    await assert.rejects(() => call({ vendor: VENDOR, items: Array.from({ length: PART_IMPORT_MAX + 1 }, (_, i) => ({ name: `상품 ${i}` })) }), ValidationError);
    await assert.rejects(() => call({ vendor: VENDOR, items: [ITEMS[0], { ...ITEMS[0], name: '다른 이름' }] }), /두 번/);
    await assert.rejects(() => call({ vendor: VENDOR, items: [{ name: '같은 이름' }, { name: ' 같은  이름 ' }] }), /두 번/);
  });
  assert.equal(db.writes.length, 0);
  assert.equal(PART_IMPORT_BODY_MAX_BYTES, 1024 * 1024);

  const bad = (raw, field) => assert.throws(() => cleanPartItem(raw, 4), (e) => e instanceof ValidationError && /^5번째 상품/.test(e.message), String(field || ''));
  bad('글');
  bad({ name: '' }, 'name');
  bad({ name: 'x'.repeat(PART_TEXT_MAX.name + 1) }, 'name');
  bad({ name: '가', brand: 'x'.repeat(PART_TEXT_MAX.brand + 1) }, 'brand');
  bad({ name: '가', source_url: 'javascript:alert(1)' }, 'source_url');
  bad({ name: '가', ref_price: -1 }, 'ref_price');
  bad({ name: '가', ref_price: PART_PRICE_MAX + 1 }, 'ref_price');
  bad({ name: '가', ref_price: 10.5 }, 'ref_price');
  bad({ name: '가', options: {} }, 'options');
  bad({ name: '가', options: [{ l: '' }] }, 'options');
  bad({ name: '가', options: Array.from({ length: 400 }, (_, i) => ({ g: '묶음', l: `${'옵션'.repeat(20)}${i}`, d: 0 })) }, 'options');
  bad({ name: '가', addons: [{ l: '캡', p: -1 }] }, 'addons');
  bad({ name: '가', specs: [] }, 'specs');
  bad({ name: '가', width_mm: 0 }, 'width_mm');
  bad({ name: '가', height_mm: PART_SIZE_MAX + 1 }, 'height_mm');
  // 값 다듬기 — 빈칸 줄이기 · 쉼표 든 값 · 빈 사양 줄 버리기
  const ok = cleanPartItem({ name: '  댐핑   경첩 ', ref_price: '3,200', specs: { ' 재질 ': ' SUS ', 빈칸: '  ' }, options: [{ l: ' 18T ', d: '1,000' }] }, 0);
  assert.deepEqual([ok.name, ok.ref_price, ok.specs, ok.options], ['댐핑 경첩', 3200, { 재질: 'SUS' }, [{ g: '', l: '18T', d: 1000, x: false }]]);
  assert.equal('width_mm' in ok, false);
  assert.ok(PART_JSON_MAX.options >= 20000);
});

test('읽기 — 공급 회사마다 상품 수 · 매입가는 대표 · 실장에게만 · 숨긴 상품은 대표 · 실장에게만 · 사진은 서명 주소', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await importParts(ENV, { user: u(OWNER), body: { vendor: VENDOR, seen_on: '2026-11-18', items: ITEMS } });
    await importParts(ENV, { user: u(OWNER), body: { vendor: { name: '마바 상사' }, seen_on: '2026-11-18', items: [{ name: '명세표 품목' }] } });
    const hinge = db.part_items.find((x) => x.vendor_item_no === '1001');
    const rail = db.part_items.find((x) => x.name === '번호 없는 레일');
    Object.assign(hinge, { buy_price: 2500, buy_price_on: '2026-11-10', photo_path: `${HQ}/${hinge.id}.jpg` });
    db.objects.set(`${PART_PHOTOS_BUCKET}/${HQ}/${hinge.id}.jpg`, {});
    rail.active = false;
    // 다른 팩토리의 줄은 섞이지 않는다
    db.part_items.push({ id: randomUUID(), company_id: P1, vendor_id: 'v-x', name: '남의 상품', active: true, options: [], addons: [], specs: {} });

    const boss = await partCatalog(ENV, { user: u(OWNER) });
    assert.equal(boss.can_manage, true);
    assert.deepEqual(boss.vendors.map((v) => [v.name, v.count]), [['가나 철물', 3], ['마바 상사', 1]]);
    assert.equal(boss.items.length, 4);
    const h1 = boss.items.find((x) => x.id === hinge.id);
    assert.deepEqual([h1.buy_price, h1.buy_price_on, h1.has_photo], [2500, '2026-11-10', true]);
    assert.match(h1.photo_url, /\/storage\/v1\/object\/sign\/part-photos\/.+token=t$/);
    assert.equal('photo_path' in h1, false);
    assert.equal(boss.items.find((x) => x.id === rail.id).active, false);

    const staff = await partCatalog(ENV, { user: u(STAFF) });
    assert.equal(staff.can_manage, false);
    assert.equal(staff.items.length, 3);
    assert.ok(staff.items.every((x) => x.buy_price === null && x.buy_price_on === null && x.active));
    assert.equal(staff.items.find((x) => x.id === hinge.id).ref_price, 3200);

    // 본사 구성원(대표) — 다담 공장 것을 대표처럼 본다
    const hq = await partCatalog(ENV, { user: u(HQ_PERSON) });
    assert.deepEqual([hq.company.id, hq.items.length], [HQ, 4]);
  });
});

test('사진 — 형식을 바이트로 보고 비공개 버킷에 올린다 · 자리를 적는다 · 남의 상품 · 큰 사진 · 다른 형식은 거절', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await importParts(ENV, { user: u(OWNER), body: { vendor: VENDOR, seen_on: '2026-11-18', items: [ITEMS[0]] } });
    const hinge = db.part_items[0];
    const r = await addPartPhoto(ENV, { user: u(OWNER), params: { id: hinge.id }, request: photoReq(JPEG) });
    assert.deepEqual(r, { id: hinge.id, has_photo: true });
    assert.equal(hinge.photo_path, `${HQ}/${hinge.id}.jpg`);
    assert.deepEqual(db.objects.get(`${PART_PHOTOS_BUCKET}/${HQ}/${hinge.id}.jpg`), { bytes: JPEG.byteLength, mime: 'image/jpeg', upsert: 'true' });
    // 같은 사진을 다시 — 자리는 그대로라 표를 다시 쓰지 않는다
    const before = db.writes.length;
    await addPartPhoto(ENV, { user: u(OWNER), params: { id: hinge.id }, request: photoReq(JPEG) });
    assert.equal(db.writes.length, before);

    await assert.rejects(() => addPartPhoto(ENV, { user: u(OWNER), params: { id: hinge.id }, request: photoReq(new TextEncoder().encode('<svg onload=alert(1)>')) }), (e) => e instanceof ValidationError);
    await assert.rejects(() => addPartPhoto(ENV, { user: u(OWNER), params: { id: hinge.id }, request: photoReq(new Uint8Array(0)) }), ValidationError);
    await assert.rejects(() => addPartPhoto(ENV, { user: u(OWNER), params: { id: hinge.id }, request: photoReq(JPEG, { 'Content-Length': String(PART_PHOTO_MAX_BYTES + 1) }) }), TooLargeError);
    await assert.rejects(() => addPartPhoto(ENV, { user: u(OWNER), params: { id: randomUUID() }, request: photoReq(JPEG) }), NotFoundError);
    await assert.rejects(() => addPartPhoto(ENV, { user: u(OWNER), params: { id: 'x' }, request: photoReq(JPEG) }), NotFoundError);
    // 다른 팩토리의 상품에는 못 올린다
    const other = { id: randomUUID(), company_id: P1, vendor_id: 'v-x', name: '남의 상품', photo_path: null };
    db.part_items.push(other);
    await assert.rejects(() => addPartPhoto(ENV, { user: u(OWNER), params: { id: other.id }, request: photoReq(JPEG) }), NotFoundError);
    assert.equal(other.photo_path, null);
  });
});

test('고치기 — 매입가를 적으면 오늘 날짜가 같이 · 비우면 날짜도 · 숨기기 · 고칠 값이 없으면 거절', async () => {
  const db = makeDb();
  await withDb(db, async () => {
    await importParts(ENV, { user: u(OWNER), body: { vendor: VENDOR, seen_on: '2026-11-18', items: [ITEMS[0]] } });
    const hinge = db.part_items[0];
    const call = (body, id = hinge.id) => patchPartItem(ENV, { user: u(OWNER), params: { id }, body });
    const r = await call({ buy_price: '2,500' });
    assert.deepEqual([r.item.buy_price, r.item.buy_price_on], [2500, kstDay()]);
    assert.deepEqual([hinge.buy_price, hinge.buy_price_on, hinge.ref_price], [2500, kstDay(), 3200]);
    const cleared = await call({ buy_price: null });
    assert.deepEqual([cleared.item.buy_price, hinge.buy_price, hinge.buy_price_on], [null, null, null]);
    const hidden = await call({ active: false });
    assert.equal(hidden.item.active, false);
    assert.equal(hinge.active, false);
    await assert.rejects(() => call({}), ValidationError);
    await assert.rejects(() => call({ name: '이름 바꾸기' }), ValidationError);
    await assert.rejects(() => call({ buy_price: -5 }), ValidationError);
    await assert.rejects(() => call({ buy_price: PART_PRICE_MAX + 1 }), ValidationError);
    await assert.rejects(() => call({ active: 'no' }), ValidationError);
    await assert.rejects(() => call({ active: false }, randomUUID()), NotFoundError);
  });
  assert.equal(kstDay(Date.parse('2026-11-18T15:30:00Z')), '2026-11-19');
});

test('DB 0071 적용 전 — 읽기 · 올리기 · 사진 · 고치기 모두 409 db_pending', async () => {
  const db = makeDb({ tables: false });
  await withDb(db, async () => {
    const pending = (e) => e.code === 'db_pending';
    await assert.rejects(() => partCatalog(ENV, { user: u(OWNER) }), pending);
    await assert.rejects(() => importParts(ENV, { user: u(OWNER), body: { vendor: VENDOR, items: ITEMS } }), pending);
    await assert.rejects(() => addPartPhoto(ENV, { user: u(OWNER), params: { id: randomUUID() }, request: photoReq(JPEG) }), pending);
    await assert.rejects(() => patchPartItem(ENV, { user: u(OWNER), params: { id: randomUUID() }, body: { active: false } }), pending);
  });
});

test('라우트 — 네 길이 등록돼 있고 올리기는 본문 크기를 먼저 본다', () => {
  const src = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  for (const line of [
    "path: '/parts/catalog',                      auth: 'jwt', handler: workRoute(partCatalog)",
    "path: '/parts/import',                       auth: 'jwt', handler: handleImportParts",
    "path: '/parts/items/:id/photo',              auth: 'jwt', handler: rawRoute(addPartPhoto, 201)",
    "path: '/parts/items/:id',                    auth: 'jwt', handler: workRoute(patchPartItem)",
    "path: '/parts/ledger-suppliers',             auth: 'jwt', handler: workRoute(partLedgerSuppliers)",
    "path: '/parts/from-ledger',                  auth: 'jwt', handler: workRoute(importPartsFromLedger, 201)",
  ]) assert.ok(src.includes(line), line);
  assert.match(src, /declared > PART_IMPORT_BODY_MAX_BYTES\) throw new TooLargeError/);
});

// ── 거래명세표(회계장부)에서 가져오기 ──

/** 장부 사진 한 장의 읽음 (지어낸 값) */
function addRead(db, { doc, company = HQ, attempt = 1, status = 'done', items = 'ok', supplier, biz, date, lines, finished = '2026-11-10T03:00:00Z', review = 'posted' }) {
  if (!db.ledger_documents.some((d) => d.id === doc)) db.ledger_documents.push({ id: doc, company_id: company, review_status: review });
  db.ledger_extractions.push({
    document_id: doc, company_id: company, attempt, status, finished_at: finished, checks: { items },
    result: { supplier_name: supplier, supplier_biz_no: biz || null, issue_date: date || null, items: lines },
  });
}
const line = (name, unit_price, quantity = 1) => ({ name, quantity, unit_price, amount: unit_price * quantity });

function ledgerDb() {
  const db = makeDb();
  addRead(db, { doc: 'd-1', supplier: '(주)마바상사', biz: '123-45-67890', date: '2026-10-05', lines: [line('댐핑 경첩', 2400, 100), line('3단 레일 450', 3100, 20)] });
  addRead(db, { doc: 'd-2', supplier: '마바 상사', date: '2026-11-03', lines: [line('댐핑  경첩', 2500, 50), line('피스 4x16', 12)] });
  // 다시 읽은 것이 있으면 마지막 읽음만 본다
  addRead(db, { doc: 'd-3', attempt: 1, supplier: '마바상사', date: '2026-11-12', lines: [line('3단 레일 450', 9999)] });
  addRead(db, { doc: 'd-3', attempt: 2, supplier: '마바상사', date: '2026-11-12', lines: [line('3단 레일 450', 3300)] });
  // 안 쓰는 것 — 품목 합이 안 맞음 · 반려한 사진 · 읽다 만 것 · 다른 팩토리 · 품목 없는 영수증
  addRead(db, { doc: 'd-4', items: 'mismatch', supplier: '마바상사', date: '2026-11-15', lines: [line('댐핑 경첩', 1)] });
  addRead(db, { doc: 'd-5', review: 'rejected', supplier: '마바상사', date: '2026-11-16', lines: [line('댐핑 경첩', 2)] });
  addRead(db, { doc: 'd-6', status: 'failed', supplier: '마바상사', date: '2026-11-17', lines: [line('댐핑 경첩', 3)] });
  addRead(db, { doc: 'd-7', company: P1, supplier: '마바상사', date: '2026-11-17', lines: [line('남의 품목', 4)] });
  addRead(db, { doc: 'd-8', supplier: '사아 식당', date: '2026-11-01', lines: [] });
  // 다른 파는 곳 — 날짜를 못 읽어 읽은 날(한국 날짜)로
  addRead(db, { doc: 'd-9', supplier: '자차 철물', date: null, finished: '2026-11-08T16:00:00Z', lines: [line('손잡이 A', 1800), { name: '값 없는 줄' }, line('너무 큰 값', 100000001)] });
  return db;
}

test('장부의 파는 곳 — 상호를 다듬어 묶는다 · 마지막 읽음 · 품목 합이 맞은 것만 · 반려 · 다른 팩토리는 뺀다', async () => {
  assert.equal(ledgerNameKey('(주) 마바-상사 ㈜'), '마바상사');
  assert.deepEqual(ledgerSupplierOf({ supplier_name: '주식회사 마바 상사', supplier_biz_no: '123-45-67890' }), { key: 'n:마바상사', name: '주식회사 마바 상사', biz_no: '1234567890' });
  assert.deepEqual(ledgerSupplierOf({ supplier_biz_no: '1234567890' }), { key: 'b:1234567890', name: '', biz_no: '1234567890' });
  assert.equal(ledgerSupplierOf({ supplier_name: ' ', supplier_biz_no: '12' }), null);
  assert.equal(ledgerSupplierOf(null), null);
  const db = ledgerDb();
  await withDb(db, async () => {
    const r = await partLedgerSuppliers(ENV, { user: u(OWNER) });
    assert.deepEqual(r.suppliers, [
      { key: 'n:마바상사', name: '(주)마바상사', biz_no: '1234567890', docs: 3, items: 3 },
      { key: 'n:자차철물', name: '자차 철물', biz_no: '', docs: 1, items: 1 },
    ]);
    // 대표 · 실장만, 다담 공장 · 본사만
    await assert.rejects(() => partLedgerSuppliers(ENV, { user: u(STAFF) }), (e) => e.code === 'not_manager');
    await assert.rejects(() => partLedgerSuppliers(ENV, { user: u(PARTNER_OWNER) }), (e) => e.code === 'not_catalog_company');
    await assert.rejects(() => importPartsFromLedger(ENV, { user: u(STAFF), body: { supplier_key: 'n:마바상사' } }), (e) => e.code === 'not_manager');
  });
  assert.equal(db.writes.length, 0);
});

test('거래명세표에서 가져오기 — 품목마다 가장 최근 단가가 매입가, 그 명세표 날짜가 본 날 · 다시 가져오면 그대로', async () => {
  const db = ledgerDb();
  await withDb(db, async () => {
    const r = await importPartsFromLedger(ENV, { user: u(OWNER), body: { supplier_key: 'n:마바상사', vendor_name: '마바 상사' } });
    assert.deepEqual([r.vendor.name, r.added, r.updated, r.same, r.left, r.docs], ['마바 상사', 3, 0, 0, 0, 3]);
    assert.equal(db.part_vendors[0].memo, '거래명세표에서 가져옴');
    const by = (name) => db.part_items.find((x) => x.name === name);
    assert.deepEqual([by('댐핑 경첩').buy_price, by('댐핑 경첩').buy_price_on], [2500, '2026-11-03']);
    assert.deepEqual([by('3단 레일 450').buy_price, by('3단 레일 450').buy_price_on], [3300, '2026-11-12']);
    assert.deepEqual([by('피스 4x16').buy_price, by('피스 4x16').ref_price, by('피스 4x16').vendor_item_no, by('피스 4x16').company_id], [12, null, '', HQ]);
    const before = db.writes.length;
    const again = await importPartsFromLedger(ENV, { user: u(OWNER), body: { supplier_key: 'n:마바상사', vendor_name: '마바 상사' } });
    assert.deepEqual([again.added, again.updated, again.same, again.left], [0, 0, 3, 0]);
    assert.equal(db.writes.length, before);
    assert.equal(db.part_vendors.length, 1);

    // 새 명세표가 오면 그 품목만 고친다 — 손으로 더 최근에 적은 값은 그대로
    by('피스 4x16').buy_price = 10;
    by('피스 4x16').buy_price_on = '2026-12-31';
    addRead(db, { doc: 'd-20', supplier: '마바상사', date: '2026-12-01', lines: [line('댐핑 경첩', 2600), line('피스 4x16', 15), line('새 품목', 700)] });
    const next = await importPartsFromLedger(ENV, { user: u(OWNER), body: { supplier_key: 'n:마바상사', vendor_name: '마바 상사' } });
    assert.deepEqual([next.added, next.updated, next.same], [1, 1, 2]);
    assert.deepEqual([by('댐핑 경첩').buy_price, by('댐핑 경첩').buy_price_on, by('피스 4x16').buy_price, by('새 품목').buy_price], [2600, '2026-12-01', 10, 700]);

    // 이름을 안 주면 장부의 상호로 — 날짜를 못 읽은 장은 읽은 날(한국 날짜) · 값 없는 줄 · 너무 큰 값은 뺀다
    const other = await importPartsFromLedger(ENV, { user: u(OWNER), body: { supplier_key: 'n:자차철물' } });
    assert.deepEqual([other.vendor.name, other.added], ['자차 철물', 1]);
    assert.deepEqual([by('손잡이 A').buy_price, by('손잡이 A').buy_price_on], [1800, '2026-11-09']);

    await assert.rejects(() => importPartsFromLedger(ENV, { user: u(OWNER), body: { supplier_key: 'n:없는곳' } }), NotFoundError);
    await assert.rejects(() => importPartsFromLedger(ENV, { user: u(OWNER), body: {} }), ValidationError);
    await assert.rejects(() => importPartsFromLedger(ENV, { user: u(OWNER), body: { supplier_key: 'x' } }), ValidationError);
    await assert.rejects(() => importPartsFromLedger(ENV, { user: u(OWNER), body: { supplier_key: 'n:마바상사', vendor_name: 'x'.repeat(PART_TEXT_MAX.vendor + 1) } }), ValidationError);
  });
});

test('거래명세표에서 가져오기 — 사이트에서 모은 상품(번호 있음)은 건드리지 않고, 한 번에 고치는 수를 넘으면 left 로 알린다', async () => {
  const db = makeDb();
  const names = Array.from({ length: PART_LEDGER_UPDATE_MAX + 5 }, (_, i) => `품목 ${String(i + 1).padStart(2, '0')}`);
  addRead(db, { doc: 'd-1', supplier: '가나 철물', date: '2026-10-01', lines: names.map((n) => line(n, 1000)) });
  await withDb(db, async () => {
    // 같은 이름이지만 번호가 있는 상품 (사이트에서 모은 것)
    await importParts(ENV, { user: u(OWNER), body: { vendor: VENDOR, seen_on: '2026-11-18', items: [{ vendor_item_no: '1001', name: '품목 01', ref_price: 5000 }] } });
    const site = db.part_items[0];
    const first = await importPartsFromLedger(ENV, { user: u(OWNER), body: { supplier_key: 'n:가나철물' } });
    assert.deepEqual([first.vendor.name, first.added, first.updated], ['가나 철물', names.length, 0]);
    assert.deepEqual([site.buy_price, site.ref_price], [null, 5000]);
    addRead(db, { doc: 'd-2', supplier: '가나 철물', date: '2026-11-01', lines: names.map((n) => line(n, 1100)) });
    const second = await importPartsFromLedger(ENV, { user: u(OWNER), body: { supplier_key: 'n:가나철물' } });
    assert.deepEqual([second.added, second.updated, second.left], [0, PART_LEDGER_UPDATE_MAX, 5]);
    const third = await importPartsFromLedger(ENV, { user: u(OWNER), body: { supplier_key: 'n:가나철물' } });
    assert.deepEqual([third.updated, third.same, third.left], [5, PART_LEDGER_UPDATE_MAX, 0]);
    assert.ok(db.part_items.filter((x) => !x.vendor_item_no).every((x) => x.buy_price === 1100 && x.buy_price_on === '2026-11-01'));
  });
});
