/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * B0: 냉장고장 BOM 골든 동결 (docs/01-plan/detail-bom-deepening.plan.md §5 B0).
 *
 * 냉장고(제외) · 키큰장 · 홈카페장(전체 MDF 18T) · 상부장 · 하부장 · EL장 — `extractFridge` 의
 * 가지 전부를 한 픽스처로 동결한다. 냉장고장은 좌대·마감재·EP 를 아직 안 낸다(계획 §1.3) —
 * 그 부재가 골든에 **없는 것**도 지금 상태의 일부다. 갱신 방법은 test-utils/bom-golden/golden.js.
 */
const { FIXTURES, designOf } = require('../test-utils/bom-golden/fixtures');
const {
  snapshotOf, expectGolden, MATERIAL_ROW_KEYS, HARDWARE_ROW_KEYS,
} = require('../test-utils/bom-golden/golden');

describe('BOM 골든 — 냉장고장 (fridge)', () => {
  const snap = snapshotOf(designOf(FIXTURES.fridge));
  const parts = (mod) => snap.materials.filter((m) => m.module === mod).map((m) => m.part);

  test('자재·철물·요약·내보내기 첫 줄이 골든과 같다', () => {
    expectGolden('fridge', snap);
  });

  test('행 형태: 자재 11필드 · 철물 8필드 (I4 — 필드는 추가만)', () => {
    expect(snap.materials.length).toBeGreaterThan(0);
    snap.materials.forEach((m) => expect(Object.keys(m)).toEqual(MATERIAL_ROW_KEYS));
    // 철물은 부분집합 — 손잡이 행의 note 가 `item.category`(없는 필드) 라 JSON 에서 빠진다. 이 어긋남도 지금 상태다.
    snap.hardware.forEach((h) => expect(HARDWARE_ROW_KEYS.filter((k) => k in h)).toEqual(Object.keys(h)));
  });

  test('픽스처가 의도한 가지를 실제로 건다', () => {
    // 냉장고 자체는 부재가 없다
    expect(snap.materials.some((m) => /LG|냉장고$/.test(m.module))).toBe(false);
    expect(parts('키큰장')).toEqual(['측판', '천판', '지판', '뒷판', '선반', '도어']);
    expect(snap.materials.find((m) => m.module === '키큰장' && m.part === '선반').qty).toBe(3);
    // 홈카페장: 전체 MDF 18T, 뒷판도 18T, 측판 D+20
    const cafe = snap.materials.filter((m) => m.module === '홈카페장');
    expect(cafe.map((m) => m.part)).toEqual(['측판', '천판', '지판', '뒷판', '선반', '도어']);
    cafe.forEach((m) => { expect(m.material).toBe('MDF'); expect(m.thickness).toBe(18); });
    expect(cafe.find((m) => m.part === '측판').w).toBe(700 + 20);
    expect(parts('냉장고상부장')).toEqual(['측판', '천판', '지판', '뒷판', '도어']);
    expect(parts('냉장고하부장')).toEqual(['측판', '천판', '지판', '뒷판', '도어']);
    expect(parts('EL장')).toEqual(['측판', '천판', '지판', '뒷판']);
    // 좌대·EP·마감재는 아직 없다 (계획 B2 항목)
    expect(snap.materials.some((m) => m.module === 'EP' || /좌대/.test(m.part))).toBe(false);
  });

  test('철물: 경첩·손잡이만 — 레일(isDrawer 없음)·다리발(싱크 전용)·브라켓(pos 없음)은 안 나온다', () => {
    expect(Object.keys(snap.hardwareSummary).sort()).toEqual(['경첩', '손잡이']);
    // 키큰장 도어 2290 > 1600 → 4구
    const tall = snap.hardware.find((h) => h.category === '경첩' && /키큰장/.test(h.note));
    expect(tall.spec).toBe('4구');
  });
});
