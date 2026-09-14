/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * B0: 붙박이장 BOM 골든 동결 (docs/01-plan/detail-bom-deepening.plan.md §5 B0).
 *
 * short(짧은옷) · long(긴옷, 외부서랍) · shelf(선반형, 내부서랍) 세 모듈형과
 * EP(상몰딩·좌측몰딩·덧대·좌대 걸레받이·목찬넬)·모듈별 좌대를 한 픽스처로 동결한다.
 * 값의 옳고 그름은 여기서 보지 않는다. 갱신 방법은 test-utils/bom-golden/golden.js.
 */
const { FIXTURES, designOf } = require('../test-utils/bom-golden/fixtures');
const {
  snapshotOf, expectGolden, MATERIAL_ROW_KEYS, HARDWARE_ROW_KEYS,
} = require('../test-utils/bom-golden/golden');

describe('BOM 골든 — 붙박이장 (wardrobe)', () => {
  const snap = snapshotOf(designOf(FIXTURES.wardrobe));
  const parts = (mod) => snap.materials.filter((m) => m.module === mod).map((m) => m.part);

  test('자재·철물·요약·내보내기 첫 줄이 골든과 같다', () => {
    expectGolden('wardrobe', snap);
  });

  test('행 형태: 자재 11필드 · 철물 8필드 (I4 — 필드는 추가만)', () => {
    expect(snap.materials.length).toBeGreaterThan(0);
    snap.materials.forEach((m) => expect(Object.keys(m)).toEqual(MATERIAL_ROW_KEYS));
    // 철물은 부분집합 — 손잡이 행의 note 가 `item.category`(없는 필드) 라 JSON 에서 빠진다. 이 어긋남도 지금 상태다.
    snap.hardware.forEach((h) => expect(HARDWARE_ROW_KEYS.filter((k) => k in h)).toEqual(Object.keys(h)));
  });

  test('픽스처가 의도한 가지를 실제로 건다', () => {
    // short: 상·하부장 분리, 하부 선반 1, 도어는 모듈 라벨에
    expect(parts('짧은옷(2단)-상부장')).toEqual(['측판', '천판', '지판', '뒷판']);
    expect(parts('짧은옷(2단)-하부장')).toEqual(['측판', '천판', '지판', '뒷판', '선반']);
    expect(snap.materials.find((m) => m.module === '짧은옷(2단)' && m.part === '도어').qty).toBe(2); // round(900/450)
    // long + 외부서랍 2: 서랍모듈 본체·서랍 부재·하단보강·서랍도어 2장
    expect(parts('긴옷-서랍모듈')).toEqual([
      '측판', '천판', '지판', '뒷판', '밴드', '서랍전후판', '서랍측판', '서랍밑판', '서랍 하단보강', '서랍도어',
    ]);
    expect(snap.materials.find((m) => m.module === '긴옷-서랍모듈' && m.part === '서랍도어').qty).toBe(2);
    // shelf + 내부서랍 1: 내부서랍 프레임이 모듈 라벨에 붙는다, 상·하 선반 2
    expect(parts('선반형')).toEqual(expect.arrayContaining([
      '서랍전후판', '서랍측판', '서랍밑판', '내부서랍 상판', '내부서랍 측판', '내부서랍 지판',
      '내부서랍 밴드', '내부서랍 좌우몰딩', '내부서랍 전면판', '도어',
    ]));
    expect(snap.materials.find((m) => m.module === '선반형-상부장' && m.part === '선반').qty).toBe(2);
    expect(snap.materials.find((m) => m.module === '선반형-하부장' && m.part === '선반').qty).toBe(2);
    // EP: 상몰딩(60) · 좌측몰딩 + 덧대 · 우측 없음 · 좌대 걸레받이 · 외부서랍 2 → 목찬넬 120
    expect(parts('EP')).toEqual(['상몰딩', '좌측몰딩', '좌측몰딩 덧대', '좌대 걸레받이', '목찬넬']);
    expect(snap.materials.find((m) => m.module === 'EP' && m.part === '목찬넬').w).toBe(120);
    // 좌대: 모듈마다, W≥700 이면 중간보강
    expect(parts('긴옷-좌대')).toEqual(['좌대 전후', '좌대 측', '좌대 중간보강']);
  });

  test('철물: 레일은 서랍 수, 손잡이(push)는 도어 수, 경첩은 doorCount 가 있는 모듈만', () => {
    const rails = snap.hardware.filter((h) => h.category === '레일');
    expect(rails.map((h) => [h.note, h.qty])).toEqual([['긴옷', 2], ['선반형', 1]]);
    expect(snap.hardware.find((h) => h.category === '손잡이').item).toBe('푸쉬');
    // short 모듈은 doorCount 를 안 갖고 있어(UI 기본) 경첩 계산에서 빠진다 — 자재는 round(W/450)=2 로 낸다.
    // 이 어긋남은 B2 에서 다룬다. 골든은 지금 상태를 그대로 적는다.
    expect(snap.hardware.filter((h) => h.category === '경첩').map((h) => h.note)).toEqual([
      expect.stringContaining('긴옷'), expect.stringContaining('선반형'),
    ]);
  });
});
