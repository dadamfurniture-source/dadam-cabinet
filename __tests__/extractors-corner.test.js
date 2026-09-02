/**
 * W10-4: extractors.js 멍장(코너장) BOM 산출 테스트
 * 설계 문서: docs/02-design/features/corner-autocalc.design.md §6
 * 규칙 원본: docs/design-rules/corner.md §3
 */
global.dlog = () => {};

const { MaterialExtractor } = require('../js/detaildesign/extractors.js');
const { seedCornerModules, seedUpperCornerModules } = require('../js/detaildesign/corner-engine.js');

function makeLItem() {
  const item = {
    categoryId: 'sink',
    w: 3000, h: 2310, d: 650,
    modules: [
      { id: 1, name: '개수대', type: 'sink', pos: 'lower', w: 1000, doorCount: 2 },
    ],
    specs: {
      lowerLayoutShape: 'L',
      lowerSecondaryW: '1970', lowerSecondaryD: '650',
      upperLayoutShape: 'L',
      upperSecondaryW: '1800', upperSecondaryD: '295',
      lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12,
      secondaryStartSide: 'left',
      topSizes: [{ w: '', d: '650' }, { w: '', d: '650' }],
      finishLeftType: 'None', finishRightType: 'None',
      finishCorner1Type: 'Molding', finishCorner1Width: 60,
    },
  };
  // W10-1/2 시드 — 하부 멍장 1110(멍715+도어395), 상부 멍장 840(멍395+도어445)
  // W12-54: 멍에 경첩 목대 15T 가 들어가면서 값이 각각 10 씩 커졌다.
  seedCornerModules(item);
  seedUpperCornerModules(item);
  return item;
}

function extractMaterials(item) {
  return new MaterialExtractor().extract({ items: [item] }).materials;
}

describe('W10-4: 멍장 BOM — 도어는 doorW 기준 (§6)', () => {
  const materials = extractMaterials(makeLItem());
  const blindLowerParts = materials.filter((m) => m.module === '하부장-LT망장');
  const blindUpperParts = materials.filter((m) => m.module === '상부장-LT망장');

  test('하부 멍장 도어 = doorW(395) − 4 = 391 — 카카스 W(1110) 기준이면 오발주', () => {
    const door = blindLowerParts.find((m) => m.part === '도어');
    expect(door).toBeDefined();
    expect(door.w).toBe(391); // 1100 − 4 = 1096이 나오면 회귀
    expect(door.qty).toBe(1);
    expect(door.h).toBe(708 - 30); // 몸통H(870−12−150) − 30
  });

  test('하부 멍 가림판 = 2.7T MDF, 멍 폭(715) − 목대 15 = 700 (§3.5)', () => {
    const cover = blindLowerParts.find((m) => m.part === '멍가림판');
    expect(cover).toBeDefined();
    expect(cover.material).toBe('MDF');
    expect(cover.thickness).toBe(2.7);
    // W12-61: 멍판은 목대 앞에서 끝난다. 마감재 60 은 안 뺀다 — 그 위를 덮기 때문이다.
    expect(cover.w).toBe(700);
    expect(cover.h).toBe(708);
    expect(cover.qty).toBe(1);
  });

  test('하부 멍장 카카스(측판/지판/뒷판)는 표준 산식 재사용 (W=1110 기준)', () => {
    const side = blindLowerParts.find((m) => m.part === '측판');
    const bottom = blindLowerParts.find((m) => m.part === '지판');
    expect(side.qty).toBe(2);
    expect(bottom.w).toBe(1110 - 30); // W − T×2
  });

  test('상부 멍장 도어 = doorW(445) − 4 = 441, H = 720 + overlap 15', () => {
    const door = blindUpperParts.find((m) => m.part === '도어');
    expect(door.w).toBe(441); // 830 − 4 = 826이 나오면 회귀
    expect(door.h).toBe(735);
  });

  test('상부 멍 가림판 = 멍 폭(395) − 목대 15 = 380 × 720', () => {
    const cover = blindUpperParts.find((m) => m.part === '멍가림판');
    expect(cover.w).toBe(380);
    expect(cover.h).toBe(720);
    expect(cover.thickness).toBe(2.7);
  });
});

describe('W10-4: secondary 수납 모듈 BOM 누락 해소 (§6)', () => {
  const materials = extractMaterials(makeLItem());

  test('하부 secondary 수납장(395×2)이 표준 산식으로 산출된다', () => {
    const secParts = materials.filter((m) => m.module === '하부장-수납장');
    expect(secParts.filter((m) => m.part === '측판').length).toBeGreaterThanOrEqual(2);
    const door = secParts.find((m) => m.part === '도어');
    expect(door.w).toBe(391); // floor(400/1) − 4 — 멍장 도어와 같은 폭 (라인 균등)
  });

  test('상부 secondary 수납장(445×2)이 산출된다', () => {
    const secParts = materials.filter((m) => m.module === '상부장-수납장');
    const door = secParts.find((m) => m.part === '도어');
    expect(door.w).toBe(441); // floor(450/1) − 4
  });
});

describe('W10-4: 코너 마감 (기존 finish 체계, §6)', () => {
  test('ㄱ자 + Molding 60 → 몰딩(코너1) 60 × (2310−150)', () => {
    const materials = extractMaterials(makeLItem());
    const molding = materials.find((m) => m.part === '몰딩(코너1)');
    expect(molding).toBeDefined();
    expect(molding.w).toBe(60);
    expect(molding.h).toBe(2160);
    expect(molding.qty).toBe(1);
  });

  test('휠라 선택 시 휠라(코너1)로 산출', () => {
    const item = makeLItem();
    item.specs.finishCorner1Type = 'Filler';
    const materials = extractMaterials(item);
    expect(materials.find((m) => m.part === '휠라(코너1)')).toBeDefined();
    expect(materials.find((m) => m.part === '몰딩(코너1)')).toBeUndefined();
  });

  test('ㅡ자(I)는 코너 마감 산출 없음 (회귀 방지)', () => {
    const item = makeLItem();
    item.specs.lowerLayoutShape = 'I';
    item.specs.upperLayoutShape = 'I';
    item.modules = item.modules.filter((m) => !m.line && !m.orientation);
    const materials = extractMaterials(item);
    expect(materials.find((m) => m.part === '몰딩(코너1)')).toBeUndefined();
    expect(materials.find((m) => m.part === '멍가림판')).toBeUndefined();
  });

  test('ㄷ자(U) + 코너2 → 몰딩(코너2)도 산출', () => {
    const item = makeLItem();
    item.specs.lowerLayoutShape = 'U';
    item.specs.finishCorner2Type = 'Molding';
    item.specs.finishCorner2Width = 60;
    const materials = extractMaterials(item);
    expect(materials.find((m) => m.part === '몰딩(코너1)')).toBeDefined();
    expect(materials.find((m) => m.part === '몰딩(코너2)')).toBeDefined();
  });
});

/**
 * W12-53: ㄷ자는 한 단에 멍장이 둘이다.
 *
 * 예전엔 id 를 `=== 'corner-blind-lower'` 로 정확히 비교해서, 두 번째 멍장이
 * 그 가지에 안 걸렸다. 그러면 도어가 **카카스 폭**으로 나가고 멍가림판이 빠진다.
 * 화면에는 아무 표시도 없고 자재표만 틀리는 종류의 결함이다.
 *
 * 플래너(구조 단계)가 ㄷ자에서 실제로 내는 모양을 그대로 쓴다 —
 * 카카스 1133 = 멍 700 + 도어 433.
 */
function makeUItem() {
  // 플래너가 ㄷ자 2800 에서 실제로 내는 값 (W12-54 공식):
  //   멍 715 = 650 − 10 + 60 + 15,  도어 423,  카카스 1138
  const blind = (id) => ({
    id, name: 'LT망장', type: 'storage', pos: 'lower',
    w: 1138, h: 708, d: 650,
    doorCount: 1, doorW: 423, blindZoneW: 715,
  });
  return {
    categoryId: 'sink',
    w: 3600, h: 2310, d: 650,
    modules: [
      blind('corner-blind-lower'),
      { id: 'plain', name: '하부장', type: 'storage', pos: 'lower', w: 424, h: 708, d: 650, doorCount: 1 },
      blind('corner-blind-lower-2'),
    ],
    specs: { lowerH: 870, sinkLegHeight: 150, topThickness: 12 },
  };
}

describe('W12-53: 멍장이 둘일 때도 둘 다 알아본다 (ㄷ자)', () => {
  const materials = extractMaterials(makeUItem());
  const blindParts = materials.filter((m) => /LT망장/.test(m.module));
  const doors = blindParts.filter((m) => m.part === '도어');
  const covers = blindParts.filter((m) => m.part === '멍가림판');

  test('도어 둘 다 doorW 기준이다 — 카카스 폭(1134)으로 나가면 오발주', () => {
    expect(doors.length).toBe(2);
    doors.forEach((d) => expect(d.w).toBe(423 - 4));
  });

  test('멍가림판이 둘 다 나온다 — 하나만 나오면 2.7T 한 장이 누락된다', () => {
    expect(covers.length).toBe(2);
    covers.forEach((c) => {
      expect(c.material).toBe('MDF');
      expect(c.thickness).toBe(2.7);
      expect(c.w).toBe(700);   // W12-61: 멍 715 − 목대 15
    });
  });

  test('멍장 아닌 모듈은 그대로다 (접두어 매칭이 번지지 않는다)', () => {
    const plain = materials.filter((m) => m.module === '하부장-하부장' && m.part === '도어');
    expect(plain.length).toBe(1);
    expect(plain[0].w).toBe(424 - 4);        // 카카스 폭 기준 — 일반 모듈은 이게 맞다
    expect(plain[0].note).toBe('');          // 멍장 주석이 안 붙는다
  });

  test('이름이 비슷한 id 를 멍장으로 오인하지 않는다', () => {
    const item = makeUItem();
    item.modules = [
      { id: 'corner-blind-upper', name: '상부장', type: 'storage', pos: 'lower', w: 600, h: 708, d: 650, doorCount: 1 },
    ];
    // pos 는 lower 인데 id 는 upper 용이다 — 하부 가지가 집어삼키면 안 된다
    const door = extractMaterials(item).filter((m) => m.part === '도어')[0];
    expect(door.note).toBe('');
    expect(door.w).toBe(600 - 4);
  });
});

describe('W12-54: 경첩 목대 — 멍 폭에 든 15T 가 자재표에도 나온다', () => {
  const materials = extractMaterials(makeLItem());
  const lower = materials.filter((m) => m.module === '하부장-LT망장');
  const upper = materials.filter((m) => m.module === '상부장-LT망장');

  test('하부 멍장에 경첩목대가 1개 나온다 — 15T PB · 70 × 몸통H', () => {
    const b = lower.find((m) => m.part === '경첩목대');
    expect(b).toBeDefined();
    expect(b.material).toBe('PB');
    expect(b.thickness).toBe(15);
    expect(b.w).toBe(70);
    expect(b.qty).toBe(1);
    // 세로는 멍가림판과 같은 몸통 높이다
    expect(b.h).toBe(lower.find((m) => m.part === '멍가림판').h);
  });

  test('상부 멍장에도 나온다', () => {
    const b = upper.find((m) => m.part === '경첩목대');
    expect(b).toBeDefined();
    expect(b.thickness).toBe(15);
    expect(b.w).toBe(70);
  });

  test('멍장이 아닌 모듈에는 안 나온다', () => {
    const others = materials.filter((m) => !/LT망장/.test(m.module) && m.part === '경첩목대');
    expect(others).toEqual([]);
  });

  test('멍장이 둘이면 목대도 둘이다 (ㄷ자)', () => {
    const b = extractMaterials(makeUItem()).filter((m) => m.part === '경첩목대');
    expect(b).toHaveLength(2);
  });
});
