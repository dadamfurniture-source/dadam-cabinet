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
      // 실제 자재에서 나오는 면적이어야 한다. 예전엔 1.7 이라는 자리표시자였고,
      // 그 비현실적 픽스처가 단위 불일치 버그를 가리고 있었다.
      //   550*870*2 + 566*516*3 = 1,833,168 mm²  → 원판(1220×2440) 1장
      summary: { PB_15: { material: 'PB', thickness: 15, totalArea: 1833168, panelCount: 1 } },
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
  b.bom.summary.PB_15.totalArea = 1; // 자재에서 나오는 면적과 전혀 다르다
  assert.throws(
    () => crossCheckSummary(b.bom, deriveCounts(b.design, b.bom)),
    (e) => e instanceof ConflictError && e.details.materials_total_area > 0,
  );
});

// ── 실주행에서 잡힌 회귀 ────────────────────────────────────
// panelCount(원판 장수)와 Σqty(부재 개수)를 비교하던 탓에 **실제 설계가
// 하나도 동결되지 않았다**. 아래 값은 프로덕션 실주행에서 나온 실측치다.
test('실제 설계 비율(장수 8 ≪ 부재 82)에서도 통과한다', () => {
  const materials = [];
  for (let i = 0; i < 45; i++) {
    materials.push({ module: 'M' + i, part: '측판', material: 'PB', thickness: 15, w: 550, h: 708, qty: 2 });
  }
  const totalArea = materials.reduce((s, m) => s + m.w * m.h * m.qty, 0);
  const bom = {
    materials,
    // 클라이언트(extractors.js)는 면적을 원판(1220×2440)으로 나눠 장수를 낸다
    summary: { PB_15: { material: 'PB', thickness: 15, totalArea, panelCount: Math.ceil(totalArea / (1220 * 2440)) } },
  };
  const design = { items: [{ modules: materials.map(() => ({})) }] };
  const derived = deriveCounts(design, bom);

  assert.equal(derived.panelCount, 90, '부재 개수는 qty 합이다');
  assert.ok(bom.summary.PB_15.panelCount < 20, '원판 장수는 부재 개수보다 훨씬 작다');
  // 단위가 다른 둘을 비교하면 여기서 터졌었다
  assert.doesNotThrow(() => crossCheckSummary(bom, derived));
});

test('면적이 맞으면 원판 장수가 뭐든 통과한다 (원판 규격은 서버가 모른다)', () => {
  const b = goodBody();
  const area = b.bom.materials.reduce((s, m) => s + Number(m.w) * Number(m.h) * Number(m.qty), 0);
  b.bom.summary = { PB_15: { totalArea: area, panelCount: 999 } };
  assert.doesNotThrow(() => crossCheckSummary(b.bom, deriveCounts(b.design, b.bom)));
});

test('면적을 안 싣는 클라이언트는 대조를 생략한다', () => {
  const b = goodBody();
  b.bom.summary = { PB_15: { panelCount: 3 } }; // totalArea 없음
  assert.doesNotThrow(() => crossCheckSummary(b.bom, deriveCounts(b.design, b.bom)));
});

test('summary 가 없으면 대조를 생략한다', () => {
  const b = goodBody();
  delete b.bom.summary;
  assert.doesNotThrow(() => crossCheckSummary(b.bom, deriveCounts(b.design, b.bom)));
});
