/**
 * canonical JSON / content_hash 단위 테스트.
 *
 * 여기서 지키려는 계약: "설계 내용이 같으면 해시가 같아야 한다".
 * 이게 깨지면 같은 설계인데 rev 가 무한히 늘어나고 재발행 배지가 상시 켜진다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, canonicalJson, snapshotHash, sha256Hex } from '../src/util/hash.js';

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

test('sha256Hex 는 알려진 값과 일치한다', async () => {
  // 표준 테스트 벡터
  assert.equal(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});
