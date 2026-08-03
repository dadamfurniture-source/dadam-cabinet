import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSnapshotInput,
  deriveCounts,
  crossCheckSummary,
} from '../src/snapshots.js';
import { ValidationError, ConflictError } from '../src/supabase.js';

function goodBody() {
  return {
    design: {
      items: [
        {
          categoryId: 'sink',
          w: 3200,
          modules: [
            { pos: 'lower', type: 'sink', w: 900 },
            { pos: 'upper', type: 'storage', w: 600 },
          ],
        },
      ],
    },
    bom: {
      materials: [
        { part: '측판', material: 'PB', thickness: 15, w: 550, h: 870, qty: 2 },
        { part: '선반', material: 'PB', thickness: 15, w: 566, h: 516, qty: 3 },
      ],
      summary: { PB_15: { material: 'PB', thickness: 15, totalArea: 1.7, panelCount: 5 } },
    },
  };
}

test('정상 payload 통과', () => {
  const out = validateSnapshotInput(goodBody());
  assert.equal(out.design.items.length, 1);
  assert.equal(out.bom.materials.length, 2);
  assert.deepEqual(out.hardware, {});
});

test('본문이 없으면 422', () => {
  assert.throws(() => validateSnapshotInput(null), ValidationError);
});

test('items 가 비면 422 — 빈 설계 동결 차단', () => {
  const b = goodBody();
  b.design.items = [];
  assert.throws(() => validateSnapshotInput(b), ValidationError);
});

test('materials 가 비면 422 — 미지원 카테고리 안내', () => {
  const b = goodBody();
  b.bom.materials = [];
  assert.throws(
    () => validateSnapshotInput(b),
    (e) => e instanceof ValidationError && /싱크대·붙박이장·냉장고장/.test(e.message),
  );
});

test('치수가 0 이하인 자재는 422', () => {
  const b = goodBody();
  b.bom.materials[0].w = 0;
  assert.throws(() => validateSnapshotInput(b), ValidationError);
});

test('문자열 치수도 허용한다 (UI 가 문자열을 넣는 경우가 흔함)', () => {
  const b = goodBody();
  b.bom.materials[0].w = '550';
  b.bom.materials[0].qty = '2';
  assert.doesNotThrow(() => validateSnapshotInput(b));
});

test('material 이 비면 422', () => {
  const b = goodBody();
  b.bom.materials[1].material = '';
  assert.throws(() => validateSnapshotInput(b), ValidationError);
});

test('deriveCounts 는 qty 합으로 panel_count 를 낸다', () => {
  const b = goodBody();
  const d = deriveCounts(b.design, b.bom);
  assert.deepEqual(d, { itemCount: 1, moduleCount: 2, panelCount: 5 });
});

test('summary 와 materials 가 일치하면 통과', () => {
  const b = goodBody();
  assert.doesNotThrow(() => crossCheckSummary(b.bom, deriveCounts(b.design, b.bom)));
});

test('summary 와 materials 가 어긋나면 409', () => {
  const b = goodBody();
  b.bom.summary.PB_15.panelCount = 4; // 실제는 5
  assert.throws(
    () => crossCheckSummary(b.bom, deriveCounts(b.design, b.bom)),
    (e) => e instanceof ConflictError && e.details.materials_panel_count === 5,
  );
});

test('summary 가 없으면 대조를 생략한다', () => {
  const b = goodBody();
  delete b.bom.summary;
  assert.doesNotThrow(() => crossCheckSummary(b.bom, deriveCounts(b.design, b.bom)));
});
