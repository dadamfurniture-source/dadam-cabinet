/**
 * canonical JSON / content_hash 단위 테스트.
 *
 * 여기서 지키려는 계약: "설계 내용이 같으면 해시가 같아야 한다".
 * 이게 깨지면 같은 설계인데 rev 가 무한히 늘어나고 재발행 배지가 상시 켜진다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, canonicalJson, snapshotHash, sha256Hex, cutDigestOf } from '../src/util/hash.js';

/** exportDesign() 이 돌려주는 것과 같은 모양의 최소 payload. */
function makeDesign(overrides = {}) {
  return {
    appVersion: '33.0',
    exportDate: '2026-08-03T01:00:00.000Z',
    items: [
      {
        uniqueId: 1779698319747.4321,
        categoryId: 'sink',
        name: '싱크대',
        w: 3200,
        h: 2400,
        d: 600,
        specs: { doorColorLower: 'oak', lowerH: 870 },
        modules: [
          { id: 1779698319747.1, pos: 'lower', type: 'sink', w: 900, _x: 0 },
          { id: 1779698319748.2, pos: 'lower', type: 'storage', w: 600, _x: 900 },
        ],
      },
    ],
    ...overrides,
  };
}

function makeBom() {
  return {
    materials: [
      { module: '하부장1', part: '측판', material: 'PB', thickness: 15, w: 550, h: 870, qty: 2, edge: '4면' },
    ],
    summary: { PB_15: { material: 'PB', thickness: 15, totalArea: 0.95, panelCount: 2 } },
    extractDate: '2026-08-03T01:00:00.000Z',
  };
}

test('exportDate 가 달라도 해시는 같다', async () => {
  const a = await snapshotHash(makeDesign({ exportDate: '2026-08-03T01:00:00.000Z' }), makeBom());
  const b = await snapshotHash(makeDesign({ exportDate: '2026-08-03T23:59:59.000Z' }), makeBom());
  assert.equal(a, b, 'exportDate 는 호출마다 바뀌므로 해시에 영향을 주면 안 된다');
});

test('extractDate 가 달라도 해시는 같다', async () => {
  const bom1 = makeBom();
  const bom2 = { ...makeBom(), extractDate: '2027-01-01T00:00:00.000Z' };
  const a = await snapshotHash(makeDesign(), bom1);
  const b = await snapshotHash(makeDesign(), bom2);
  assert.equal(a, b);
});

test('uniqueId 가 floor 되어도 해시는 같다', async () => {
  const before = makeDesign();
  const after = makeDesign();
  // persistence-init.js:1105 의 Math.floor 저장 후 재열기를 재현
  after.items[0].uniqueId = Math.floor(before.items[0].uniqueId);

  const a = await snapshotHash(before, makeBom());
  const b = await snapshotHash(after, makeBom());
  assert.equal(a, b, '저장/재열기가 해시를 바꾸면 rev 가 무한 증가한다');
});

test('모듈 id 재발급과 _x 변화는 해시에 영향이 없다', async () => {
  const before = makeDesign();
  const after = makeDesign();
  after.items[0].modules[0].id = 9999999999999.9;
  after.items[0].modules[1].id = 8888888888888.8;
  after.items[0].modules[0]._x = 12345;

  const a = await snapshotHash(before, makeBom());
  const b = await snapshotHash(after, makeBom());
  assert.equal(a, b);
});

test('자동계산 undo 버퍼는 해시에 영향이 없다', async () => {
  const before = makeDesign();
  const after = makeDesign();
  after.items[0].prevLowerModules = [{ id: 1, pos: 'lower', type: 'storage', w: 1200 }];

  const a = await snapshotHash(before, makeBom());
  const b = await snapshotHash(after, makeBom());
  assert.equal(a, b);
});

test('appVersion 범프는 해시에 영향이 없다', async () => {
  const a = await snapshotHash(makeDesign({ appVersion: '33.0' }), makeBom());
  const b = await snapshotHash(makeDesign({ appVersion: '34.1' }), makeBom());
  assert.equal(a, b, '버전 범프가 고객 문서를 무효화해서는 안 된다');
});

test('실제 치수가 바뀌면 해시가 달라진다', async () => {
  const before = makeDesign();
  const after = makeDesign();
  after.items[0].modules[0].w = 901;

  const a = await snapshotHash(before, makeBom());
  const b = await snapshotHash(after, makeBom());
  assert.notEqual(a, b, '설계가 실제로 바뀌면 새 리비전이어야 한다');
});

test('BOM 이 바뀌면 설계가 같아도 해시가 달라진다', async () => {
  const bom2 = makeBom();
  bom2.materials[0].thickness = 18;

  const a = await snapshotHash(makeDesign(), makeBom());
  const b = await snapshotHash(makeDesign(), bom2);
  assert.notEqual(a, b, 'BOM 산출 규칙이 바뀌면 새 리비전이어야 한다');
});

test('키 순서가 달라도 해시는 같다', async () => {
  const a = canonicalJson({ b: 1, a: 2, c: { z: 1, y: 2 } });
  const b = canonicalJson({ a: 2, c: { y: 2, z: 1 }, b: 1 });
  assert.equal(a, b);
});

test('배열 순서는 의미가 있으므로 보존된다', async () => {
  const a = canonicalJson({ items: [1, 2] });
  const b = canonicalJson({ items: [2, 1] });
  assert.notEqual(a, b, '모듈 배치 순서는 설계의 일부다');
});

test('부동소수 미세 오차는 흡수된다', () => {
  const a = canonicalJson({ w: 0.1 + 0.2 }); // 0.30000000000000004
  const b = canonicalJson({ w: 0.3 });
  assert.equal(a, b);
});

test('NaN / Infinity / -0 정규화', () => {
  assert.equal(canonicalize(NaN), null);
  assert.equal(canonicalize(Infinity), null);
  assert.equal(canonicalize(-0), 0);
});

// ── 재단 방식을 고른 배치 (간편 플래너) ─────────────────────────────

/** 엔진 cutPlan 모양의 최소 배치 — strategy 가 있으면 재단 방식을 고른 것 */
function makeCut(overrides = {}) {
  return {
    version: 1,
    strategy: 'standard',
    sheets: [
      {
        no: 1, material: 'PB', thickness: 15, partClass: '본체', color: '화이트', size: { w: 1220, h: 2440 }, cuts: 3, yield: 0.39,
        layout: { no: 1, stack: 1, index: 1, dir: 'V', rotated: false },
        parts: [
          { partId: 'a#0', part: '측판', w: 550, h: 870, x: 10, y: 10, rot: false, grain: 'none', strip: 1 },
          { partId: 'a#1', part: '측판', w: 550, h: 870, x: 10, y: 884, rot: false, grain: 'none', strip: 1 },
        ],
      },
    ],
    groups: [{ key: 'PB|15|본체|화이트', cutCount: 3, standard: { sheetCount: 1, cutCount: 3 }, searched: 199 }],
    summary: { sheetsByMaterial: { PB_15: 1 }, sheetCount: 1, cutCount: 3, totalYield: 0.39 },
    ...overrides,
  };
}

test('재단 방식이 없는 배치는 해시에 들지 않는다 — 예전과 같은 값', async () => {
  // 2026-11-17 cutDigest 인자를 더하기 전 hash.js(main 04e1eba)로 낸 값. 예전 설계의 rev 판정이 바뀌지 않아야 한다
  const legacy = 'b11556b9719655c4e2e0df22f1c4b845f4b7c87ed066ed2228e820a2b38339bb';
  assert.equal(await snapshotHash(makeDesign(), makeBom()), legacy);
  assert.equal(await snapshotHash(makeDesign(), makeBom(), null), legacy);
  const noStrategy = makeCut({ strategy: undefined });
  assert.equal(cutDigestOf(noStrategy), null);
  assert.equal(cutDigestOf(null), null);
  assert.equal(cutDigestOf({ strategy: '' }), null);
  assert.equal(await snapshotHash(makeDesign(), makeBom(), cutDigestOf(noStrategy)), legacy);
});

test('재단 방식을 고른 배치는 해시에 든다 — 방식 · 배치가 바뀌면 달라진다', async () => {
  const h = (cut) => snapshotHash(makeDesign(), makeBom(), cutDigestOf(cut));
  const base = await h(makeCut());
  assert.notEqual(base, await snapshotHash(makeDesign(), makeBom()));
  assert.equal(await h(makeCut()), base, '같은 방식 · 같은 배치면 같다');
  assert.notEqual(await h(makeCut({ strategy: 'cuts' })), base, '방식이 바뀌면');
  const moved = makeCut();
  moved.sheets[0].parts[1].y = 900;
  assert.notEqual(await h(moved), base, '조각 자리가 바뀌면');
  const turned = makeCut();
  turned.sheets[0].parts[0].rot = true;
  assert.notEqual(await h(turned), base, '눕히면');
  const recolored = makeCut();
  recolored.sheets[0].color = '오크';
  assert.notEqual(await h(recolored), base, '원판 색이 바뀌면');
});

test('배치에서 파생되는 셈값 · 그림용 값은 해시에 들지 않는다', async () => {
  const h = (cut) => snapshotHash(makeDesign(), makeBom(), cutDigestOf(cut));
  const base = await h(makeCut());
  const meta = makeCut({ offcuts: [{ sheetNo: 1, kind: 'sheet', x: 564, y: 10, w: 646, h: 2420, free: 646 }] });
  meta.sheets[0].cuts = 9;
  meta.sheets[0].yield = 0.1;
  meta.sheets[0].layout = { no: 7, stack: 1, index: 1, dir: 'H', rotated: true };
  meta.sheets[0].parts[0].part = '다른 이름';
  meta.sheets[0].parts[0].strip = 4;
  meta.groups[0].searched = 13;
  meta.summary.cutCount = 99;
  assert.equal(await h(meta), base);
  // 요약은 재단 결과를 정하는 값만 담는다
  assert.deepEqual(cutDigestOf(makeCut()), {
    strategy: 'standard',
    sheets: [{
      no: 1, material: 'PB', thickness: 15, color: '화이트', size: { w: 1220, h: 2440 },
      parts: [{ partId: 'a#0', x: 10, y: 10, w: 550, h: 870, rot: false }, { partId: 'a#1', x: 10, y: 884, w: 550, h: 870, rot: false }],
    }],
  });
});

test('sha256Hex 는 알려진 값과 일치한다', async () => {
  // 표준 테스트 벡터
  assert.equal(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});
