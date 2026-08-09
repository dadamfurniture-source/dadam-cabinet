/**
 * CD-6: 학습 데이터 수집의 서버측 계약.
 *
 * 두 가지를 지킨다.
 *  1) 학습 메타데이터(_learning/_autoCalc)가 payload 에는 저장되지만
 *     content_hash 는 흔들지 않는다. 흔들면 같은 설계인데 rev 가 계속 늘고
 *     "설계 변경됨 · 재발행 필요" 배지가 상시 켜진다.
 *  2) 수정 요청 사유가 집계 가능한 코드로 남는다. 자유 텍스트만으론
 *     "어떤 설계가 왜 반려되는가" 를 셀 수 없어 승인률 학습의 라벨이 못 된다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, snapshotHash } from '../src/util/hash.js';
import { DECISION_REASON_CODES } from '../src/documents.js';

function design(extra = {}) {
  return {
    appVersion: '35.0',
    exportDate: '2026-08-09T01:00:00.000Z',
    items: [
      {
        uniqueId: 1779698319747.4321,
        categoryId: 'sink',
        w: 3000,
        specs: { bodyThickness: 15 },
        modules: [{ id: 'planner-lower-0-0', pos: 'lower', w: 900, h: 708, d: 550, doorCount: 2 }],
        ...extra,
      },
    ],
  };
}

const BOM = { materials: [{ module: 'A', part: '측판', material: 'PB', thickness: 15, w: 550, h: 708, qty: 2 }] };

test('학습 데이터는 content_hash 를 바꾸지 않는다', async () => {
  const plain = await snapshotHash(design(), BOM);
  const withLearning = await snapshotHash(
    design({
      _learning: {
        planner: {
          moduleCount: 2,
          editedCount: 1,
          editedFields: { areaWidths: 1 },
          modules: [{ id: 'lower-0', edited: ['areaWidths'], auto: { W: 900 }, final: { W: 850 } }],
        },
      },
    }),
    BOM
  );
  assert.equal(withLearning, plain, '학습 메타데이터가 해시에 섞이면 rev 가 무한 증가한다');
});

test('학습 내용이 달라져도 해시는 같다', async () => {
  const a = await snapshotHash(design({ _learning: { planner: { editedCount: 0 } } }), BOM);
  const b = await snapshotHash(design({ _learning: { planner: { editedCount: 7 } } }), BOM);
  assert.equal(a, b);
});

test('설계가 실제로 달라지면 해시는 달라진다 (제외가 과하지 않다)', async () => {
  const a = await snapshotHash(design({ _learning: { x: 1 } }), BOM);
  const b = await snapshotHash(design({ _learning: { x: 1 }, w: 3200 }), BOM);
  assert.notEqual(a, b);
});

test('_autoCalc 도 해시에서 빠진다', async () => {
  const withBaseline = design();
  withBaseline.items[0].modules[0]._autoCalc = { W: 900, areaWidths: [450, 450] };
  assert.equal(await snapshotHash(withBaseline, BOM), await snapshotHash(design(), BOM));
});

test('canonicalize 가 중첩 깊은 곳의 학습 키도 제거한다', () => {
  const out = canonicalize({ items: [{ modules: [{ w: 1, _autoCalc: { W: 9 } }], _learning: { a: 1 } }] });
  assert.deepEqual(out, { items: [{ modules: [{ w: 1 }] }] });
});

test('사유 코드 목록이 집계 가능한 형태다', () => {
  assert.ok(Array.isArray(DECISION_REASON_CODES));
  // 치수·배치·색상·금액·일정은 반려 사유의 실질 축이다. 기타는 잔여를 받는다.
  for (const c of ['dimension', 'layout', 'color', 'price', 'schedule', 'other']) {
    assert.ok(DECISION_REASON_CODES.includes(c), `${c} 코드가 있어야 한다`);
  }
  // 자유 텍스트로 흘러가지 않도록 코드는 고정 집합이어야 한다
  assert.equal(new Set(DECISION_REASON_CODES).size, DECISION_REASON_CODES.length);
});
