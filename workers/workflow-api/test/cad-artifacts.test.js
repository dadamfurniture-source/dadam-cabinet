/**
 * CAD 베타 PR16b — 동결본 GLB 보관 (src/cad-artifacts.js).
 *   · 직렬화 규칙이 플래너(js/planner/planner-export.js plannerExportStableJson)와 같다 — 같은 명세면 같은 해시
 *   · GLB 루트 extras.assemblyHash 가 동결 명세 해시와 다르면 409, 종류(vis)가 다르면 422
 *   · 관리자만 · 외관 1MB 한도 · 같은 파일은 한 번만 · 고객용은 exterior/ 접두사
 * 명세는 골든 픽스처(합성)에서 bom-assembly.js 가 만든 진짜 명세.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import {
  stableJson, assemblyHashOf, glbJson, glbRootExtras, verifyCadGlb, cadPathOf,
  uploadCadArtifact, listCadArtifacts, getFrozenAssembly, customerExteriorUrl, CAD_MAX_BYTES,
} from '../src/cad-artifacts.js';
import { ConflictError, ForbiddenError, ValidationError, NotFoundError } from '../src/supabase.js';
import { clearAdminCache } from '../src/reports/admin.js';

globalThis.dlog = globalThis.dlog || (() => {});
const require = createRequire(import.meta.url);
const { specOf } = require('../../../test-utils/assembly-fixtures.js');
const { plannerExportStableJson } = require('../../../js/planner/planner-export.js');

/** 손으로 짓는 최소 GLB — 루트 extras 와 판재 노드 n 개 (planner-export.js plannerExportCadScene 모양) */
function makeGlb(extras, { parts = 2, pad = 0, anon = extras && extras.vis === 'exterior', leak = false } = {}) {
  // anon: 고객용 외관 (planner-export-cad/2) — 노드 module-N · part-N, extras 없음
  const nodes = [{ name: 'dadam-planner-cad', extras, children: [1] }, { name: anon ? 'module-1' : 'module·0-u1', children: [] }];
  for (let i = 0; i < parts; i++) {
    nodes[1].children.push(nodes.length);
    nodes.push(anon ? Object.assign({ name: `part-${i + 1}` }, leak ? { extras: { rowPartId: `r${i}` } } : {}) : { name: `p#${i}`, extras: { rowPartId: `r${i}` } });
  }
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes, extrasPad: 'x'.repeat(pad) };
  let txt = Buffer.from(JSON.stringify(json), 'utf8');
  const padLen = (4 - (txt.length % 4)) % 4;
  txt = Buffer.concat([txt, Buffer.alloc(padLen, 0x20)]);
  const out = Buffer.alloc(20 + txt.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(txt.length, 12); out.writeUInt32LE(0x4e4f534a, 16); txt.copy(out, 20);
  return new Uint8Array(out);
}

const spec = specOf('sink15').spec;
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const extrasFor = async (o = {}) => Object.assign({ schema: 'dadam.assembly/1', source: 'dadam.assembly', rulesVersion: spec.rulesVersion, generator: 'planner-export-cad/2', vis: 'all', assemblyHash: await assemblyHashOf(spec) }, o);

test('stableJson = 플래너 plannerExportStableJson (골든 명세 9종) · 해시 = SHA-256', async () => {
  ['sink15', 'sink18', 'sinkCorner', 'shoerack', 'vanity', 'storage', 'warehouse', 'wardrobe', 'fridge'].forEach((n) => {
    const s = specOf(n).spec;
    assert.equal(stableJson(s), plannerExportStableJson(s), n);
    // JSONB 왕복(키 순서가 바뀐다)에도 같다
    const shuffled = JSON.parse(JSON.stringify(s, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)));
    assert.equal(stableJson(shuffled), stableJson(s), n);
  });
  assert.equal(await assemblyHashOf(spec), sha(plannerExportStableJson(spec)));
});

test('glbJson · glbRootExtras — 머리 검사, 루트 extras', async () => {
  const ex = await extrasFor();
  const glb = makeGlb(ex);
  assert.deepEqual(glbRootExtras(glbJson(glb)), ex);
  assert.throws(() => glbJson(new Uint8Array(10)), ValidationError);
  const bad = glb.slice(); bad[0] = 0; assert.throws(() => glbJson(bad), ValidationError);
  const short = glb.slice(0, glb.length - 4); assert.throws(() => glbJson(short), ValidationError);
});

test('verifyCadGlb — 해시가 맞으면 통과 (판재 · 모듈 수), 다르면 409, 종류가 다르면 422', async () => {
  const ok = await verifyCadGlb(makeGlb(await extrasFor(), { parts: 3 }), spec, 'cad');
  assert.equal(ok.parts, 3);
  assert.equal(ok.modules, 1);
  await assert.rejects(verifyCadGlb(makeGlb(await extrasFor({ assemblyHash: 'f'.repeat(64) })), spec, 'cad'), ConflictError);
  // 명세가 한 글자라도 다르면 (동결 뒤 고친 설계) 409
  const changed = JSON.parse(JSON.stringify(spec)); changed.items[0].modules[0].parts[0].t += 1;
  await assert.rejects(verifyCadGlb(makeGlb(await extrasFor()), changed, 'cad'), ConflictError);
  await assert.rejects(verifyCadGlb(makeGlb(await extrasFor()), spec, 'exterior'), ValidationError);
  await assert.rejects(verifyCadGlb(makeGlb(await extrasFor({ vis: 'exterior' })), spec, 'cad'), ValidationError);
  assert.equal((await verifyCadGlb(makeGlb(await extrasFor({ vis: 'exterior' })), spec, 'exterior')).parts, 2);
  // 고객용 외관 — partId 가 남았거나(extras · 이름) 예전 만든 쪽(/1)이면 422
  await assert.rejects(verifyCadGlb(makeGlb(await extrasFor({ vis: 'exterior' }), { leak: true }), spec, 'exterior'), ValidationError);
  await assert.rejects(verifyCadGlb(makeGlb(await extrasFor({ vis: 'exterior' }), { anon: false }), spec, 'exterior'), ValidationError);
  await assert.rejects(verifyCadGlb(makeGlb(await extrasFor({ vis: 'exterior', generator: 'planner-export-cad/1' })), spec, 'exterior'), ValidationError);
  await assert.rejects(verifyCadGlb(makeGlb({ foo: 1 }), spec, 'cad'), ValidationError);
});

test('cadPathOf — 고객용은 exterior/ 접두사, 파일 이름에 sha256 앞 16자', () => {
  const sha256 = 'a'.repeat(64);
  assert.equal(cadPathOf({ designId: 'D', snapshotId: 'S', kind: 'cad', sha256 }), `D/S/cad-${'a'.repeat(16)}.glb`);
  assert.equal(cadPathOf({ designId: 'D', snapshotId: 'S', kind: 'exterior', sha256 }), `exterior/D/S/exterior-${'a'.repeat(16)}.glb`);
});

// ── Supabase 대역 (fetch) ─────────────────────────────────────────

const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const admin = { id: 'u-admin' };
const SNAP = { id: 'S1', design_id: 'D1', rev: 3, content_hash: 'c'.repeat(64), bom_payload: { materials: [], assembly: spec } };
let realFetch, calls, db;

function respond(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  realFetch = globalThis.fetch;
  clearAdminCache();
  calls = [];
  db = { admins: new Set([admin.id]), snap: SNAP, artifacts: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || 'GET';
    calls.push({ method, path: u.pathname, search: u.search, init });
    const q = Object.fromEntries(u.searchParams);
    if (u.pathname === '/rest/v1/admin_roles') return respond(db.admins.has(String(q.user_id).replace('eq.', '')) ? [{ role: 'admin' }] : []);
    if (u.pathname === '/rest/v1/design_snapshots') {
      const hit = db.snap && (q.id ? q.id === `eq.${db.snap.id}` : q.design_id === `eq.${db.snap.design_id}`);
      return respond(hit ? [db.snap] : []);
    }
    if (u.pathname === '/rest/v1/design_cad_artifacts') {
      if (db.noTable) return new Response('{"code":"42P01","message":"relation does not exist"}', { status: 404 });
      if (method === 'POST') { const row = Object.assign({ id: `A${db.artifacts.length + 1}`, created_at: 't' }, JSON.parse(init.body)); db.artifacts.push(row); return respond([row], 201); }
      const inList = (f, v) => !f || f.slice(4, -1).split(',').includes(v);
      const rows = db.artifacts.filter((r) => (!q.snapshot_id || q.snapshot_id === `eq.${r.snapshot_id}`) && (!q.kind || q.kind === `eq.${r.kind}`) && (!q.sha256 || q.sha256 === `eq.${r.sha256}`) && inList(q.generator_version, r.generator_version));
      return respond(rows);
    }
    if (u.pathname.startsWith('/storage/v1/object/sign/cad')) {
      const paths = JSON.parse(init.body).paths;
      return respond(paths.map((p) => ({ path: p, signedURL: `/object/sign/cad/${p}?token=t` })));
    }
    if (u.pathname.startsWith('/storage/v1/object/cad/')) return respond({ Key: u.pathname }, 200);
    throw new Error(`unexpected fetch ${method} ${u.pathname}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

test('올리기 — 관리자 · 해시 맞음 → 버킷 cad 에 올리고 행 · 서명 URL, 같은 파일은 다시 올려도 한 행', async () => {
  const glb = makeGlb(await extrasFor(), { parts: 4 });
  const r = await uploadCadArtifact(env, { snapshotId: 'S1', user: admin, kind: 'cad', bytes: glb });
  assert.equal(r.reused, false);
  assert.equal(r.artifact.kind, 'cad');
  assert.equal(r.artifact.parts, 4);
  assert.equal(r.artifact.assembly_hash, await assemblyHashOf(spec));
  assert.equal(r.artifact.content_hash, SNAP.content_hash);
  assert.equal(r.artifact.bytes, glb.byteLength);
  assert.match(r.artifact.path, /^D1\/S1\/cad-[0-9a-f]{16}\.glb$/);
  assert.match(r.artifact.url, /^https:\/\/sb\.test\/storage\/v1\/object\/sign\/cad\//);
  const up = calls.filter((c) => c.path.startsWith('/storage/v1/object/cad/'));
  assert.equal(up.length, 1);
  assert.equal(up[0].init.headers['Content-Type'], 'model/gltf-binary');
  const again = await uploadCadArtifact(env, { snapshotId: 'S1', user: admin, kind: 'cad', bytes: glb });
  assert.equal(again.reused, true);
  assert.equal(db.artifacts.length, 1);
  assert.equal(calls.filter((c) => c.path.startsWith('/storage/v1/object/cad/')).length, 1, '두 번째는 올리지 않는다');
  // 외관은 exterior/ 접두사
  const ex = await uploadCadArtifact(env, { snapshotId: 'S1', user: admin, kind: 'exterior', bytes: makeGlb(await extrasFor({ vis: 'exterior' })) });
  assert.match(ex.artifact.path, /^exterior\/D1\/S1\/exterior-/);
  const list = await listCadArtifacts(env, { snapshotId: 'S1', user: admin });
  assert.equal(list.length, 2);
  assert.ok(list.every((x) => x.url));
});

test('올리기 — 관리자가 아니면 403, 해시가 다르면 409 (아무것도 올리지 않는다), 외관 1MB 넘으면 422', async () => {
  await assert.rejects(uploadCadArtifact(env, { snapshotId: 'S1', user: { id: 'u-x' }, kind: 'cad', bytes: makeGlb(await extrasFor()) }), ForbiddenError);
  await assert.rejects(uploadCadArtifact(env, { snapshotId: 'S1', user: admin, kind: 'cad', bytes: makeGlb(await extrasFor({ assemblyHash: '0'.repeat(64) })) }), ConflictError);
  const big = makeGlb(await extrasFor({ vis: 'exterior' }), { pad: CAD_MAX_BYTES.exterior });
  await assert.rejects(uploadCadArtifact(env, { snapshotId: 'S1', user: admin, kind: 'exterior', bytes: big }), ValidationError);
  await assert.rejects(uploadCadArtifact(env, { snapshotId: 'S1', user: admin, kind: 'x', bytes: makeGlb(await extrasFor()) }), ValidationError);
  assert.equal(calls.filter((c) => c.path.startsWith('/storage/v1/object/cad/')).length, 0);
  assert.equal(db.artifacts.length, 0);
});

test('동결 명세 — 최신 스냅샷 명세와 해시 (관리자), 명세 없는 스냅샷은 409, 스냅샷 없으면 404', async () => {
  const r = await getFrozenAssembly(env, { designId: 'D1', user: admin });
  assert.equal(r.snapshot_id, 'S1');
  assert.equal(r.assembly_hash, sha(plannerExportStableJson(spec)));
  assert.deepEqual(r.assembly, spec);
  await assert.rejects(getFrozenAssembly(env, { designId: 'D1', user: { id: 'u-x' } }), ForbiddenError);
  db.snap = Object.assign({}, SNAP, { bom_payload: { materials: [] } });
  await assert.rejects(getFrozenAssembly(env, { designId: 'D1', user: admin }), ConflictError);
  db.snap = null;
  await assert.rejects(getFrozenAssembly(env, { designId: 'D1', user: admin }), NotFoundError);
});

test('고객 확인서 3D — 그 스냅샷 최신 고객용 외관 GLB 서명 URL, 없거나 표가 없으면 null', async () => {
  assert.equal(await customerExteriorUrl(env, 'S1'), null);
  await uploadCadArtifact(env, { snapshotId: 'S1', user: admin, kind: 'cad', bytes: makeGlb(await extrasFor()) });
  assert.equal(await customerExteriorUrl(env, 'S1'), null, '전체(cad) GLB 는 고객에게 주지 않는다');
  const ex = await uploadCadArtifact(env, { snapshotId: 'S1', user: admin, kind: 'exterior', bytes: makeGlb(await extrasFor({ vis: 'exterior' })) });
  const url = await customerExteriorUrl(env, 'S1');
  assert.equal(url, `https://sb.test/storage/v1/object/sign/cad/${ex.artifact.path}?token=t`);
  assert.match(url, /\/cad\/exterior\//);
  // 예전 만든 쪽(/1) 외관 행은 싣지 않는다 (partId 가 들어 있다)
  db.artifacts.forEach((r) => { r.generator_version = 'planner-export-cad/1'; });
  assert.equal(await customerExteriorUrl(env, 'S1'), null);
  db.noTable = true;
  assert.equal(await customerExteriorUrl(env, 'S1'), null);
});
