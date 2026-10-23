/**
 * PR10: 조립 명세 동결 검증 (validateAssembly).
 * 입력은 골든 픽스처(합성)에서 bom-assembly.js 가 만든 진짜 명세 — 조립 검사 시험·CAD 검산기와 같은 입력이다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createSnapshot,
  validateAssembly,
  validateSnapshotInput,
  ASSEMBLY_SCHEMA,
  MAX_ASSEMBLY_BYTES,
} from '../src/snapshots.js';
import { snapshotHash } from '../src/util/hash.js';
import { ValidationError } from '../src/supabase.js';

globalThis.dlog = globalThis.dlog || (() => {});
const require = createRequire(import.meta.url);
const { NAMES, specOf } = require('../../../test-utils/assembly-fixtures.js');

const clone = (x) => JSON.parse(JSON.stringify(x));
const firstPart = (spec) => spec.items.flatMap((it) => it.modules).find((m) => m.parts.length).parts[0];
const problemsOf = (fn) => {
  try { fn(); } catch (e) { assert.ok(e instanceof ValidationError, e && e.message); return e.details || e.message; }
  assert.fail('ValidationError 가 나야 한다');
};

test('스키마 상수 = bom-assembly.js', () => {
  assert.equal(ASSEMBLY_SCHEMA, require('../../../js/detaildesign/bom-assembly.js').SCHEMA);
});

for (const name of NAMES) {
  test(`${name}: 진짜 명세는 통과`, () => {
    const { materials, spec } = specOf(name);
    const out = validateAssembly(spec, { materials });
    assert.ok(out.partCount > 0);
    assert.equal(out.assembly, spec);
  });
}

test('명세 없음(옛 클라이언트) → null, 스냅샷 입력 검증도 그대로', () => {
  assert.equal(validateAssembly(undefined, { materials: [] }), null);
  assert.equal(validateAssembly(null, { materials: [] }), null);
  const { design, materials } = specOf('sink15');
  const out = validateSnapshotInput({ design, bom: { materials } });
  assert.equal(out.bom.assembly, undefined);
});

test('같은 설계 → 같은 content_hash (재동결이 같은 rev 를 쓴다), 명세가 다르면 해시도 다르다', async () => {
  const a = specOf('sink15');
  const b = specOf('sink15');
  const h1 = await snapshotHash(a.design, { materials: a.materials, assembly: a.spec });
  const h2 = await snapshotHash(b.design, { materials: b.materials, assembly: b.spec });
  assert.equal(h1, h2);
  const moved = clone(b.spec);
  firstPart(moved).frame.o[0] += 1;
  assert.notEqual(await snapshotHash(b.design, { materials: b.materials, assembly: moved }), h1);
});

test('머리가 틀리면 거절', () => {
  const { materials, spec } = specOf('fridge');
  const bom = { materials };
  problemsOf(() => validateAssembly([], bom));
  problemsOf(() => validateAssembly('x', bom));
  problemsOf(() => validateAssembly({ ...spec, schema: 'dadam.assembly/0' }, bom));
  problemsOf(() => validateAssembly({ ...spec, rulesVersion: '' }, bom));
  problemsOf(() => validateAssembly({ ...spec, items: null }, bom));
  problemsOf(() => validateAssembly({ ...spec, unplaced: undefined }, bom));
});

test('BOM 에 없는 rowPartId 는 거절', () => {
  const { materials, spec } = specOf('fridge');
  const bad = clone(spec);
  firstPart(bad).rowPartId = 'nope-0';
  const probs = problemsOf(() => validateAssembly(bad, { materials }));
  assert.ok(probs.some((s) => s.includes('nope-0')), probs.join('\n'));
});

test('행마다 판재 수 ≠ qty 면 거절 (빠짐 · 중복)', () => {
  const { materials, spec } = specOf('sink15');
  const dropped = clone(spec);
  const mod = dropped.items[0].modules.find((m) => m.parts.length > 1);
  const gone = mod.parts.shift();
  let probs = problemsOf(() => validateAssembly(dropped, { materials }));
  assert.ok(probs.some((s) => s.includes(gone.rowPartId) && s.includes('≠')), probs.join('\n'));

  const doubled = clone(spec);
  const m2 = doubled.items[0].modules.find((m) => m.parts.length);
  m2.parts.push(clone(m2.parts[0]));
  probs = problemsOf(() => validateAssembly(doubled, { materials }));
  assert.ok(probs.some((s) => s.includes('중복')), probs.join('\n'));
});

test('라인 부재(runs[].parts)도 센다', () => {
  const { materials, spec } = specOf('sink15');
  const bad = clone(spec);
  bad.items[0].runs = [{ key: 'x', parts: [{ id: 'ghost#0', rowPartId: 'ghost' }] }];
  const probs = problemsOf(() => validateAssembly(bad, { materials }));
  assert.ok(probs.some((s) => s.includes('ghost')), probs.join('\n'));
});

test('unplaced 의 rowPartId 도 BOM 에 있어야 한다', () => {
  const { materials, spec } = specOf('wardrobe');
  const bad = clone(spec);
  bad.unplaced.push({ rowPartId: 'ghost-1', reason: 'x', qty: 1 });
  const probs = problemsOf(() => validateAssembly(bad, { materials }));
  assert.ok(probs.some((s) => s.includes('ghost-1')), probs.join('\n'));
});

test('크기 상한을 넘으면 거절', () => {
  const { materials, spec } = specOf('fridge');
  const big = { ...spec, pad: 'x'.repeat(MAX_ASSEMBLY_BYTES) };
  const details = problemsOf(() => validateAssembly(big, { materials }));
  assert.ok(details.bytes > MAX_ASSEMBLY_BYTES);
});

test('아파트 한 채 규모(싱크 세트 8벌 ≈ 300KB)도 상한 안이고 검증이 빠르다', () => {
  const { materials, spec } = specOf('sink15');
  // 품목 8개 — 모듈 키 앞의 품목 번호를 바꿔 행·부재를 늘린다
  const rows = [], items = [], unplaced = [];
  for (let k = 0; k < 8; k++) {
    const re = (s) => String(s).replace(/^0-/, `${k}-`);
    materials.forEach((r) => rows.push({ ...r, partId: re(r.partId), moduleKey: re(r.moduleKey) }));
    const it = clone(spec.items[0]);
    it.itemIdx = k;
    it.modules.forEach((m) => m.parts.forEach((p) => { p.rowPartId = re(p.rowPartId); p.id = re(p.id); }));
    (it.runs || []).forEach((r) => r.parts.forEach((p) => { p.rowPartId = re(p.rowPartId); p.id = re(p.id); }));
    items.push(it);
    spec.unplaced.forEach((u) => unplaced.push({ ...u, rowPartId: re(u.rowPartId) }));
  }
  const apt = { ...spec, items, unplaced };
  const bytes = new TextEncoder().encode(JSON.stringify(apt)).length;
  assert.ok(bytes > 250 * 1024 && bytes < MAX_ASSEMBLY_BYTES, String(bytes));
  const t0 = performance.now();
  const out = validateAssembly(apt, { materials: rows });
  const ms = performance.now() - t0;
  assert.ok(out.partCount > 600);
  // Worker CPU 한도(무료 10ms · 유료 30s)보다 넉넉히 — 개정 #15 실측. CI 기계 편차를 두고 50ms
  assert.ok(ms < 50, `${ms.toFixed(1)}ms`);
  console.log(`  apartment-scale assembly: ${(bytes / 1024).toFixed(0)}KB, ${out.partCount} parts, ${ms.toFixed(1)}ms`);
});

// ── createSnapshot: 명세는 bom_payload 에 실리고, 같은 설계를 다시 동결하면 같은 rev ─────────
// PostgREST 가짜 — 넣은 행을 기억해 content_hash 조회에 돌려준다 (cut-plan.test.js 의 가짜와 같은 모양).
function withFakeSupabase(fn) {
  const original = globalThis.fetch;
  const rows = [];
  const json = (body, status = 200) => ({
    ok: true, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
  });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || 'GET';
    if (u.pathname.endsWith('/design_snapshots')) {
      if (method === 'POST') {
        const row = { id: `S${rows.length + 1}`, created_at: '2026-10-23T00:00:00Z', ...JSON.parse(init.body) };
        rows.push(row);
        return json([row], 201);
      }
      const hash = u.searchParams.get('content_hash');
      if (hash) return json(rows.filter((r) => `eq.${r.content_hash}` === hash).slice(0, 1));
      return json(rows.slice().sort((a, b) => b.rev - a.rev).slice(0, 1));
    }
    if (u.pathname.endsWith('/designs')) return json([{ id: 'D1', user_id: 'U1', title: '테스트 설계' }]);
    if (u.pathname.endsWith('/pricing_rule_sets')) return json([{ id: 'RS1', name: 'seed', is_active: true }]);
    if (u.pathname.endsWith('/pricing_rules')) return json([]);
    throw new Error('unexpected fetch ' + method + ' ' + u);
  };
  const error = console.error;
  console.error = () => {};   // 생산 설정 없음 로그
  return Promise.resolve(fn(rows)).finally(() => { globalThis.fetch = original; console.error = error; });
}

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const USER = { id: 'U1' };
const bodyOf = (name) => { const { design, materials, spec } = specOf(name); return { design, bom: { materials, assembly: spec } }; };

test('createSnapshot — 명세를 bom_payload.assembly 로 싣고, 같은 설계 재동결은 같은 rev', async () => {
  await withFakeSupabase(async (rows) => {
    const first = await createSnapshot(ENV, { designId: 'D1', user: USER, body: bodyOf('sink15') });
    assert.equal(first.reused, false);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rev, 1);
    assert.equal(rows[0].bom_payload.assembly.schema, ASSEMBLY_SCHEMA);
    const again = await createSnapshot(ENV, { designId: 'D1', user: USER, body: bodyOf('sink15') });
    assert.equal(again.reused, true);
    assert.equal(again.snapshot.rev, 1);
    assert.equal(rows.length, 1, '새 행이 생기면 안 된다');
  });
});

test('createSnapshot — 명세 없는 옛 클라이언트도 동결된다', async () => {
  await withFakeSupabase(async (rows) => {
    const { design, materials } = specOf('fridge');
    await createSnapshot(ENV, { designId: 'D1', user: USER, body: { design, bom: { materials } } });
    assert.equal(rows.length, 1);
    assert.ok(!('assembly' in rows[0].bom_payload));
  });
});

test('createSnapshot — 어긋난 명세는 INSERT 전에 422', async () => {
  await withFakeSupabase(async (rows) => {
    const body = bodyOf('fridge');
    firstPart(body.bom.assembly).rowPartId = 'nope-0';
    await assert.rejects(() => createSnapshot(ENV, { designId: 'D1', user: USER, body }), ValidationError);
    assert.equal(rows.length, 0, 'INSERT 가 나가면 안 된다');
  });
});
