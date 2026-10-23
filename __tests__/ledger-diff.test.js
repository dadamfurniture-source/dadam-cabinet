/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * CAD 베타 PR15 — 원장 대조 장치 자체 (test-utils/ledger-diff.js). 합성 데이터만.
 *   diffById      명세 판재 ↔ BOM 낱장 id, AABB ±0.5mm — 어긋나면 곧장 실패해야 한다
 *   ratchet       (픽스처, 종류, 차이) 개수가 늘면 잡고, 줄면 알린다
 */
const { diffById, ratchetCounts, compareRatchet, ID_AABB_TOLERANCE_MM } = require('../test-utils/ledger-diff');

const part = (id, min, max) => ({ id, box: { min, max } });
const spec = {
  items: [{
    modules: [{ parts: [part('m-a-0#0', [0, 0, 0], [10, 20, 15]), part('m-a-0#1', [10, 0, 0], [20, 20, 15]), part('m-b-0#0', [0, 0, 0], [5, 5, 5])] }],
    runs: [{ parts: [part('ep-top-0#0', [0, 0, 0], [100, 12, 600])] }],
  }],
};
const materials = [{ partId: 'm-a-0', qty: 2 }, { partId: 'm-b-0', qty: 1 }, { partId: 'ep-top-0', qty: 1 }];
const piece = (partId, min, max) => ({ partId, rowPartId: partId.replace(/#\d+$/, ''), moduleId: 'x', min, max });

describe('diffById', () => {
  test('다 맞으면 이슈 0, 낱장이 다 그려진 행만 matchedRows (라인 부재 runs 도 명세로 찾는다)', () => {
    const r = diffById('f', [
      piece('m-a-0#0', [0, 0, 0], [10, 20, 15]),
      piece('m-a-0#1', [10, 0, 0], [20, 20, 15]),
      piece('ep-top-0#0', [0, 0, 0], [100, 12, 600]),
    ], spec, materials);
    expect(r.issues).toEqual([]);
    expect([...r.matchedRows].sort()).toEqual(['ep-top-0', 'm-a-0']);
    expect(r.matched).toBe(3);
  });

  test(`AABB 가 ${ID_AABB_TOLERANCE_MM}mm 넘게 어긋나면 id-aabb (안이면 통과)`, () => {
    const ok = diffById('f', [piece('m-b-0#0', [0.4, 0, 0], [5.4, 5, 5])], spec, materials);
    expect(ok.issues).toEqual([]);
    const bad = diffById('f', [piece('m-b-0#0', [0.6, 0, 0], [5.6, 5, 5])], spec, materials);
    expect(bad.issues.map((x) => x.kind)).toEqual(['id-aabb']);
  });

  test('행 일부만 그리면 id-partial, 그 행은 matchedRows 에 없다 (치수 대조로 남는다)', () => {
    const r = diffById('f', [piece('m-a-0#0', [0, 0, 0], [10, 20, 15])], spec, materials);
    expect(r.issues.map((x) => x.kind)).toEqual(['id-partial']);
    expect(r.matchedRows.has('m-a-0')).toBe(false);
  });

  test('모르는 행 · 수량 밖 번호 · 겹친 id · 명세에 없는 판재 · 모양이 틀린 id', () => {
    const r = diffById('f', [
      piece('nope-0#0', [0, 0, 0], [1, 1, 1]),
      piece('m-b-0#1', [0, 0, 0], [5, 5, 5]),
      piece('m-b-0#0', [0, 0, 0], [5, 5, 5]),
      piece('m-b-0#0', [0, 0, 0], [5, 5, 5]),
      { partId: 'm-a-0-x', rowPartId: 'm-a-0', min: [0, 0, 0], max: [1, 1, 1] },
    ], spec, materials);
    expect(r.issues.map((x) => x.kind).sort()).toEqual(['id-duplicate', 'id-malformed', 'id-unknown', 'id-unknown']);
    const noSpec = diffById('f', [piece('m-b-0#0', [0, 0, 0], [5, 5, 5])], { items: [] }, materials);
    expect(noSpec.issues.map((x) => x.kind)).toEqual(['id-no-spec']);
  });
});

describe('래칫', () => {
  const e = (fixture, family, kind) => ({ fixture, family, kind });
  test('(픽스처|종류|차이) 마다 센다', () => {
    expect(ratchetCounts([e('a', 'top', 'only3d'), e('a', 'top', 'only3d'), e('b', 'kick', 'dims')]))
      .toEqual({ 'a|top|only3d': 2, 'b|kick|dims': 1 });
  });
  test('늘면 up (새 열쇠 포함), 줄면 down, 같으면 둘 다 빈다', () => {
    const base = { 'a|top|only3d': 2, 'b|kick|dims': 1 };
    expect(compareRatchet(base, base)).toEqual({ up: [], down: [] });
    const r = compareRatchet(base, { 'a|top|only3d': 3, 'c|door|dims': 1 });
    expect(r.up).toEqual([{ key: 'a|top|only3d', was: 2, now: 3 }, { key: 'c|door|dims', was: 0, now: 1 }]);
    expect(r.down).toEqual([{ key: 'b|kick|dims', was: 1, now: 0 }]);
  });
});
