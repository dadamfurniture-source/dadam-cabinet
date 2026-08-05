/**
 * W12-1: 몸통 두께 파라미터화 계약 테스트.
 *
 * 배경 — 현장은 15T 를 90% 쓰고 18T 도 가끔 쓴다. 그런데 두께가
 * `new MaterialExtractor()` 안에 굳어 있어 18T 설계를 만들 방법이 없었고,
 * 그 결과 규칙 문서 두 개가 서로 "모순"처럼 보였다:
 *   - docs/design-rules/bom-protocol.md  천판 W-30   ← 15T 결과
 *   - docs/design-rules/ACTIVE_RULES.md  천판 W-36   ← 18T 결과
 * 둘 다 맞다. 파생값이므로 두께만 정하면 나머지는 따라온다.
 *
 * 이 테스트가 고정하는 계약:
 *   1) 몸통 부재 폭은 W-2T 로 두께에서 파생된다
 *   2) 도어(MDF 18T)는 몸통 두께를 따라가지 않는다 — 별개 자재다
 *   3) 미지정 설계는 15T 로 동작한다 (기존 저장 설계 회귀 방지)
 */
global.dlog = () => {};

const { MaterialExtractor } = require('../js/detaildesign/extractors.js');

/** 몸통 부재가 모두 나오는 최소 싱크대 1모듈 */
function sinkItem(specOverrides = {}) {
  return {
    categoryId: 'sink',
    w: 900, h: 2310, d: 650,
    modules: [
      { id: 1, name: '900/2도어', type: 'storage', pos: 'upper', w: 900, h: 720, d: 295, doorCount: 2 },
      { id: 2, name: '900/2도어', type: 'storage', pos: 'lower', w: 900, h: 708, d: 550, doorCount: 2 },
    ],
    specs: {
      lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12,
      finishLeftType: 'None', finishRightType: 'None',
      ...specOverrides,
    },
  };
}

function extract(item) {
  return new MaterialExtractor().extract({ items: [item] }).materials;
}

/** 특정 부재 1건 찾기 */
function find(materials, module, part) {
  return materials.find((m) => m.module.includes(module) && m.part === part);
}

describe('몸통 부재 폭은 두께에서 파생된다 (W-2T)', () => {
  test('15T — 천판/지판 폭이 W-30', () => {
    const mats = extract(sinkItem({ bodyThickness: 15 }));
    expect(find(mats, '상부장', '천판').w).toBe(900 - 30);
    expect(find(mats, '상부장', '지판').w).toBe(900 - 30);
    expect(find(mats, '하부장', '지판').w).toBe(900 - 30);
  });

  test('18T — 천판/지판 폭이 W-36 으로 따라온다', () => {
    const mats = extract(sinkItem({ bodyThickness: 18 }));
    expect(find(mats, '상부장', '천판').w).toBe(900 - 36);
    expect(find(mats, '상부장', '지판').w).toBe(900 - 36);
    expect(find(mats, '하부장', '지판').w).toBe(900 - 36);
  });

  test('두께 컬럼 자체도 함께 바뀐다', () => {
    expect(find(extract(sinkItem({ bodyThickness: 15 })), '상부장', '천판').thickness).toBe(15);
    expect(find(extract(sinkItem({ bodyThickness: 18 })), '상부장', '천판').thickness).toBe(18);
  });

  test('선반·밴드 등 나머지 몸통 부재도 동일하게 파생된다', () => {
    const mats = extract(sinkItem({ bodyThickness: 18 }));
    expect(find(mats, '상부장', '선반').w).toBe(900 - 36);
    expect(find(mats, '상부장', '밴드(보강목)').w).toBe(900 - 36);
    // 처짐방지목은 폭 70 고정, 높이가 H-2T
    expect(find(mats, '상부장', '밴드(처짐방지)').h).toBe(720 - 36);
  });
});

describe('도어는 몸통 두께를 따라가지 않는다', () => {
  test('18T 몸통이어도 도어는 MDF 18T 이고 폭 공식도 그대로', () => {
    const t15 = extract(sinkItem({ bodyThickness: 15 }));
    const t18 = extract(sinkItem({ bodyThickness: 18 }));
    const d15 = find(t15, '상부장', '도어');
    const d18 = find(t18, '상부장', '도어');

    expect(d15.material).toBe('MDF');
    expect(d18.material).toBe('MDF');
    // 도어 MDF 두께는 몸통과 무관한 별개 상수다
    expect(d15.thickness).toBe(18);
    expect(d18.thickness).toBe(18);
    // 도어 폭은 W/도어수 - 갭 이라 몸통 두께와 무관
    expect(d18.w).toBe(d15.w);
    expect(d18.h).toBe(d15.h);
  });

  test('뒷판 MDF 2.7T 도 몸통 두께와 무관', () => {
    const back = find(extract(sinkItem({ bodyThickness: 18 })), '상부장', '뒷판');
    expect(back.material).toBe('MDF');
    expect(back.thickness).toBe(2.7);
  });
});

describe('기존 저장 설계 회귀 방지', () => {
  test('bodyThickness 미지정이면 15T 로 동작한다', () => {
    const without = extract(sinkItem());
    const explicit15 = extract(sinkItem({ bodyThickness: 15 }));
    expect(without).toEqual(explicit15);
  });

  test('빈 문자열·0·쓰레기값도 15T 로 안전하게 떨어진다', () => {
    const base = extract(sinkItem({ bodyThickness: 15 }));
    for (const bad of ['', 0, null, undefined, 'abc', -5]) {
      expect(extract(sinkItem({ bodyThickness: bad }))).toEqual(base);
    }
  });
});

describe('원판 규격은 정본 상수에서 온다', () => {
  test('기본 원판이 1220x2440', () => {
    const ex = new MaterialExtractor();
    expect(ex.PANEL_W).toBe(1220);
    expect(ex.PANEL_H).toBe(2440);
  });

  test('생성자로 원판 규격을 덮어쓸 수 있다', () => {
    const ex = new MaterialExtractor({ sheetW: 1250, sheetH: 2500 });
    expect(ex.PANEL_W).toBe(1250);
    expect(ex.PANEL_H).toBe(2500);
  });
});
