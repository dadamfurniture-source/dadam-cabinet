/**
 * 역판독 자동 검증 (src/verify.js) — 계획서 §4.1 의 닫힌 고리.
 *
 * 고정하는 것:
 *   1) design_spec → 기대 구성: 바닥 종류 순서·도어/서랍 총수·상부장 도어·가전 순서와 중심 %
 *   2) normalizeLayout 결과 → 읽힌 구성 (같은 모양)
 *   3) 대조 점수 다섯 항목과 ok 판정 — 순서·개수가 구속, mm 는 재지 않는다
 *   4) 이 파일은 import 가 없다 (layout.js 와 같은 규칙)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  VERIFY_VERSION,
  collapseRuns,
  editDistance,
  expectedFromSpec,
  readFromLayout,
  compareLayoutToSpec,
} from '../src/verify.js';

/** 싱크대 도면 요약 — 왼쪽부터 서랍 3단 · 도어 2짝 · 식기세척기 · 도어 1짝, 상부장 2+2, 냉장고는 오른쪽 끝 */
const SPEC = {
  category: 'sink',
  wallRunMm: 3600,
  sections: {
    lower: {
      widthMm: 2900, heightMm: 870, depthMm: 650, fromLeftMm: 0,
      modules: [
        { widthMm: 600, kind: 'drawer', doorCount: 0, drawerCount: 3, label: '서랍' },
        { widthMm: 800, kind: 'door', doorCount: 2, drawerCount: 0, label: '도어' },
        { widthMm: 600, kind: 'appliance', doorCount: 0, drawerCount: 0, label: '식기세척기' },
        { widthMm: 900, kind: 'door', doorCount: 1, drawerCount: 0, label: '도어' },
      ],
    },
    upper: {
      widthMm: 2900, heightMm: 780, depthMm: 350, fromLeftMm: 0,
      modules: [
        { widthMm: 900, kind: 'door', doorCount: 2, drawerCount: 0 },
        { widthMm: 900, kind: 'door', doorCount: 2, drawerCount: 0 },
      ],
    },
    tall: {
      widthMm: 700, heightMm: 2300, depthMm: 650, fromLeftMm: 2900,
      modules: [{ widthMm: 700, kind: 'appliance', doorCount: 0, drawerCount: 0, label: '냉장고' }],
    },
  },
  appliances: [
    { kind: 'sink', fromLeftMm: 1300, widthMm: 700 },
    { kind: 'dishwasher', fromLeftMm: 1400, widthMm: 600 },
    { kind: 'fridge', fromLeftMm: 2900, widthMm: 700 },
  ],
  finishes: {},
};

/** 그 도면을 정확히 읽어 낸 layout (normalizeLayout 출력 모양) */
function goodLayout() {
  return {
    segments: [
      { kind: 'lower', startPct: 0, endPct: 39, doors: 2, drawers: 3 },      // 서랍장+도어장을 하나로 읽었다
      { kind: 'dishwasher', startPct: 39, endPct: 56, doors: 0, drawers: 0 },
      { kind: 'lower', startPct: 56, endPct: 81, doors: 1, drawers: 0 },
      { kind: 'refrigerator', startPct: 81, endPct: 100, doors: 0, drawers: 0 },
    ],
    uppers: [{ kind: 'upper', startPct: 0, endPct: 50, doors: 4 }],
    appliances: {
      sink: { centerPct: 46, source: 'waterPct' },
      cooktop: { centerPct: 70, source: 'exhaustPct' },
      hood: { centerPct: 70, source: 'exhaustPct' },
      dishwasher: { centerPct: 47, source: 'image' },
      refrigerator: { centerPct: 90, source: 'segment' },
    },
  };
}

test('import 가 없다 — 시험이 export 만 떼어 평가한다', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/verify.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.equal(VERIFY_VERSION, 1);
});

test('collapseRuns · editDistance', () => {
  assert.deepEqual(collapseRuns(['lower', 'lower', 'dishwasher', 'lower', 'lower']), ['lower', 'dishwasher', 'lower']);
  assert.equal(editDistance(['a', 'b', 'c'], ['a', 'b', 'c']), 0);
  assert.equal(editDistance(['a', 'b', 'c'], ['a', 'c']), 1);
  assert.equal(editDistance([], ['a', 'b']), 2);
});

test('design_spec → 기대 구성: 위치 순서로 바닥을 잇고, 가전은 라벨로 종류를 고른다', () => {
  const w = expectedFromSpec(SPEC, 'sink');
  assert.deepEqual(w.floorKinds, ['lower', 'lower', 'dishwasher', 'lower', 'refrigerator']);
  assert.equal(w.floorDoors, 3);
  assert.equal(w.floorDrawers, 3);
  assert.equal(w.upperDoors, 4);
  assert.deepEqual(w.appliances.map((a) => a.kind), ['sink', 'dishwasher', 'refrigerator']);
  // 중심 % = (fromLeft + w/2) / wallRun
  assert.equal(Math.round(w.appliances[1].centerPct), 47);
  assert.equal(Math.round(w.appliances[2].centerPct), 90);
});

test('붙박이장은 벽 전체가 한 세그먼트 — 도어 수만 합친다', () => {
  const w = expectedFromSpec(
    { category: 'wardrobe', wallRunMm: 3600, sections: { tall: { modules: [{ kind: 'door', doorCount: 2 }, { kind: 'door', doorCount: 2 }, { kind: 'door', doorCount: 1 }] } } },
    'wardrobe'
  );
  assert.deepEqual(w.floorKinds, ['wardrobe']);
  assert.equal(w.floorDoors, 5);
  assert.equal(w.upperDoors, null);
});

test('layout → 읽힌 구성', () => {
  const g = readFromLayout(goodLayout());
  assert.deepEqual(g.floorKinds, ['lower', 'dishwasher', 'lower', 'refrigerator']);
  assert.equal(g.floorDoors, 3);
  assert.equal(g.floorDrawers, 3);
  assert.equal(g.upperDoors, 4);
  assert.deepEqual(g.appliances.map((a) => a.kind), ['sink', 'dishwasher', 'cooktop', 'hood', 'refrigerator']);
});

test('정확히 읽혔으면 ok 이고 다섯 항목 모두 만점이다', () => {
  const v = compareLayoutToSpec(goodLayout(), SPEC, 'sink');
  assert.equal(v.ok, true);
  assert.equal(v.max, 5);
  assert.equal(v.score, 5);
  assert.deepEqual(v.issues, []);
  assert.equal(v.version, VERIFY_VERSION);
});

test('순서가 어긋나면 ok 가 아니다 — 식기세척기가 냉장고 뒤로 갔다', () => {
  const l = goodLayout();
  l.segments = [
    { kind: 'lower', startPct: 0, endPct: 60, doors: 3, drawers: 3 },
    { kind: 'refrigerator', startPct: 60, endPct: 80, doors: 0, drawers: 0 },
    { kind: 'dishwasher', startPct: 80, endPct: 100, doors: 0, drawers: 0 },
  ];
  l.appliances.dishwasher.centerPct = 90;
  l.appliances.refrigerator.centerPct = 70;
  const v = compareLayoutToSpec(l, SPEC, 'sink');
  assert.equal(v.ok, false);
  assert.ok(v.parts.order < 1);
  assert.ok(v.parts.appliances < 1);
  assert.ok(v.issues.some((s) => s.startsWith('order:')));
  assert.ok(v.issues.some((s) => s.startsWith('appliances:')));
  // 도어·서랍 총수는 맞았다
  assert.equal(v.parts.counts, 1);
});

test('개수가 조금 틀리면 점수만 깎이고, 많이 틀리면 ok 가 아니다', () => {
  const a = goodLayout(); a.segments[0].doors = 1;               // 도어 3 → 2 : 1/6 틀림
  const va = compareLayoutToSpec(a, SPEC, 'sink');
  assert.equal(va.ok, true);
  assert.ok(va.parts.counts > 0.8 && va.parts.counts < 1);
  const b = goodLayout(); b.segments[0].drawers = 0; b.segments[0].doors = 0;   // 3+2 빠짐
  const vb = compareLayoutToSpec(b, SPEC, 'sink');
  assert.equal(vb.ok, false);
  assert.ok(vb.parts.counts < 0.75);
});

test('가전 위치는 ±10%p 안이면 만점, 30%p 에서 0 — mm 는 재지 않는다', () => {
  const l = goodLayout(); l.appliances.dishwasher.centerPct = 47 + 20;   // 20%p 어긋남 → 0.5
  const v = compareLayoutToSpec(l, SPEC, 'sink');
  assert.ok(Math.abs(v.parts.positions - 0.75) < 0.01);               // (0.5 + 1) / 2 — 냉장고는 맞았다
  assert.ok(v.issues.some((s) => s.startsWith('position: dishwasher')));
  assert.equal(v.ok, true);                                             // 위치는 ok 판정에 안 들어간다
});

test('싱크·후드·쿡탑은 대조하지 않는다 — 조사값이 덮어쓰는 자리다', () => {
  const l = goodLayout(); l.appliances.sink.centerPct = 5; l.appliances.hood = null;
  const v = compareLayoutToSpec(l, SPEC, 'sink');
  assert.equal(v.ok, true);
  assert.equal(v.parts.appliances, 1);
});

test('빈 도면은 대조할 것이 없다 — ok 가 아니고 max 0', () => {
  const v = compareLayoutToSpec(goodLayout(), { category: 'sink', finishes: { door: { name: 'x' } } }, 'sink');
  assert.equal(v.ok, false);
  assert.equal(v.max, 0);
});

test('나쁜 입력에 던지지 않는다', () => {
  for (const bad of [null, undefined, 3, 'x', [], {}]) {
    assert.doesNotThrow(() => compareLayoutToSpec(bad, bad, 'sink'));
    assert.doesNotThrow(() => readFromLayout(bad));
    assert.doesNotThrow(() => expectedFromSpec(bad, 'sink'));
  }
});
