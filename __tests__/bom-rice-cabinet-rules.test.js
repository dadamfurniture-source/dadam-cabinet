/**
 * 밥솥장 규칙 (사장님 확정, 메모리 결정 8): 오픈장 + 슬라이딩 선반 · 도어 여닫이·포켓·리프트 ·
 * 최소 내경 W305×H400 · 기본 외경 W450×H500 · 밑에 무조건 서랍.
 */
const R = require('../js/detaildesign/bom-rice-cabinet-rules.js');
const OC = require('../js/detaildesign/bom-open-cabinet-rules.js');

describe('밥솥장 규칙 숫자', () => {
  test('최소 내경 305×400 · 기본 외경 450×500 · 도어 넷(오픈 기본)', () => {
    expect(R.RULES.KIND).toBe('rice');
    expect(R.RULES.MIN_INNER).toEqual({ W: 305, H: 400 });
    expect(R.RULES.DEFAULT_OUTER).toEqual({ W: 450, H: 500 });
    expect(R.RULES.DOOR_TYPES.map((d) => d.id)).toEqual(['none', 'swing', 'pocket', 'liftup']);
    expect(R.RULES.DOOR_DEFAULT).toBe('none');
  });

  test('isRiceCabinet 은 moduleKind 하나만 본다 — 오픈장과 섞이지 않는다', () => {
    expect(R.isRiceCabinet({ moduleKind: 'rice' })).toBe(true);
    expect(R.isRiceCabinet({ moduleKind: 'open' })).toBe(false);
    expect(OC.isOpenCabinet({ moduleKind: 'rice' })).toBe(false);
    expect(R.isRiceCabinet(null)).toBe(false);
  });

  test('도어 종류 — 구조 블록·문자열 모두 읽고, 모르는 값은 오픈, 옛 표기 lift 는 리프트', () => {
    expect(R.doorTypeOf({ rice: { door: 'swing' } })).toBe('swing');
    expect(R.doorTypeOf('pocket')).toBe('pocket');
    expect(R.doorTypeOf('lift')).toBe('liftup');
    expect(R.doorTypeOf('sliding')).toBe('none');
    expect(R.doorTypeOf({})).toBe('none');
  });
});

describe('밥솥장 부재 — 상자는 오픈장 규칙 그대로', () => {
  const dims = { W: 450, H: 500, D: 570 };

  test('측판·천지판·뒷판 치수가 오픈장 partsOf 와 같고, 천지판 비고에 슬라이딩 선반 [확인 필요]', () => {
    const parts = R.partsOf(dims);
    const open = OC.partsOf(dims);
    expect(parts.map((p) => [p.part, p.material, p.t, p.w, p.h, p.qty]))
      .toEqual(open.map((p) => [p.part, p.material, p.t, p.w, p.h, p.qty]));
    expect(parts.find((p) => p.part === '천지판').note).toMatch(/슬라이딩 선반 \[확인 필요\]/);
    // 기본 외경 450×500 의 내경은 최소 내경을 넘는다
    const g = R.innerOf(dims);
    expect([g.innerW, g.innerH]).toEqual([414, 464]);
  });

  test('도어 — 오픈은 없음, 나머지는 (W−4)×(H−4) 한 장, 포켓은 철물 [확인 필요]', () => {
    expect(R.doorOf(dims, 'none')).toBeNull();
    expect(R.doorOf(dims, 'swing')).toMatchObject({ type: 'swing', w: 446, h: 496, qty: 1, note: '' });
    expect(R.doorOf(dims, 'liftup')).toMatchObject({ type: 'liftup', w: 446, h: 496 });
    expect(R.doorOf(dims, 'pocket').note).toMatch(/\[확인 필요\]/);
  });
});

describe('밥솥장 경고', () => {
  test('기본 외경 + 밑 서랍이면 경고 없음', () => {
    expect(R.warningsOf({ W: 450, H: 500, D: 570 }, { below: 'drawer' })).toEqual([]);
  });

  test('내경이 최소보다 작으면 폭·높이를 따로 알린다', () => {
    // 내경 = 외경 − 36 → 340 은 304(<305), 435 는 399(<400). 한 mm 차이에서 갈린다.
    const w = R.warningsOf({ W: 340, H: 435, D: 570 }, { below: 'drawer' });
    expect(w).toHaveLength(2);
    expect(w[0]).toMatch(/폭 304 .* 305/);
    expect(w[1]).toMatch(/높이 399 .* 400/);
    expect(R.warningsOf({ W: 341, H: 436, D: 570 }, { below: 'drawer' })).toEqual([]);
  });

  test('밑에 서랍이 없거나 다른 모듈이면 경고 — 모르면(ctx 없음) 검사하지 않는다', () => {
    const d = { W: 450, H: 500, D: 570 };
    expect(R.warningsOf(d, { below: 'none' })[0]).toMatch(/밑에 서랍이 없습니다/);
    expect(R.warningsOf(d, { below: 'other' })[0]).toMatch(/서랍이 아닙니다/);
    expect(R.warningsOf(d)).toEqual([]);
  });

  test('치수 없음은 오픈장 경고를 밥솥장 이름으로', () => {
    expect(R.warningsOf({ W: 0, H: 0, D: 0 })[0]).toMatch(/^밥솥장 치수/);
  });
});
