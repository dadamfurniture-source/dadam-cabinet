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
  // W10-1/2 시드 — 하부 멍장 1100(멍700+도어400), 상부 멍장 830(멍380+도어450)
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

  test('하부 멍장 도어 = doorW(400) − 4 = 396 — 카카스 W(1100) 기준이면 오발주', () => {
    const door = blindLowerParts.find((m) => m.part === '도어');
    expect(door).toBeDefined();
    expect(door.w).toBe(396); // 1100 − 4 = 1096이 나오면 회귀
    expect(door.qty).toBe(1);
    expect(door.h).toBe(708 - 30); // 몸통H(870−12−150) − 30
  });

  test('하부 멍 가림판 = 2.7T MDF, blindZoneW(700) × 몸통H (§3.5 신규 부재)', () => {
    const cover = blindLowerParts.find((m) => m.part === '멍가림판');
    expect(cover).toBeDefined();
    expect(cover.material).toBe('MDF');
    expect(cover.thickness).toBe(2.7);
    expect(cover.w).toBe(700);
    expect(cover.h).toBe(708);
    expect(cover.qty).toBe(1);
  });

  test('하부 멍장 카카스(측판/지판/뒷판)는 표준 산식 재사용 (W=1100 기준)', () => {
    const side = blindLowerParts.find((m) => m.part === '측판');
    const bottom = blindLowerParts.find((m) => m.part === '지판');
    expect(side.qty).toBe(2);
    expect(bottom.w).toBe(1100 - 30); // W − T×2
  });

  test('상부 멍장 도어 = doorW(450) − 4 = 446, H = 720 + overlap 15', () => {
    const door = blindUpperParts.find((m) => m.part === '도어');
    expect(door.w).toBe(446); // 830 − 4 = 826이 나오면 회귀
    expect(door.h).toBe(735);
  });

  test('상부 멍 가림판 = blindZoneW(380) × 720', () => {
    const cover = blindUpperParts.find((m) => m.part === '멍가림판');
    expect(cover.w).toBe(380);
    expect(cover.h).toBe(720);
    expect(cover.thickness).toBe(2.7);
  });
});

describe('W10-4: secondary 수납 모듈 BOM 누락 해소 (§6)', () => {
  const materials = extractMaterials(makeLItem());

  test('하부 secondary 수납장(400×2)이 표준 산식으로 산출된다', () => {
    const secParts = materials.filter((m) => m.module === '하부장-수납장');
    expect(secParts.filter((m) => m.part === '측판').length).toBeGreaterThanOrEqual(2);
    const door = secParts.find((m) => m.part === '도어');
    expect(door.w).toBe(396); // floor(400/1) − 4 — 멍장 도어와 같은 폭 (라인 균등)
  });

  test('상부 secondary 수납장(450×2)이 산출된다', () => {
    const secParts = materials.filter((m) => m.module === '상부장-수납장');
    const door = secParts.find((m) => m.part === '도어');
    expect(door.w).toBe(446); // floor(450/1) − 4
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
