/**
 * exportDesign() 결과 → 견적 입력 어댑터 (장당 견적의 상판 · 설비 · 철거 줄, quote-sheet.js extraCostLines).
 *
 * detaildesign 의 exportDesign() 은 아이템 배열이다. 아이템마다 하나씩 만든다.
 *
 * ★ 필드값은 전부 실제 코드에서 확인한 것만 쓴다.
 *   - 카테고리 id: data-constants.js:4-15 CATEGORIES
 *   - 모듈 type  : calc-engine.js:519,591-594 / ui-fridge-el.js:553
 *     쿡탑의 type 은 'cooktop' 이 아니라 **'cook'** 이다 (calc-engine.js:592).
 *   - 서랍은 별도 type 이 아니라 isDrawer 플래그다 (calc-engine.js:593).
 */

/** 상판을 계상하는 카테고리 (주방 계열만). */
const COUNTERTOP_CATEGORIES = new Set(['sink', 'island']);

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function sumWidths(modules) {
  return modules.reduce((s, m) => s + Math.max(0, num(m.w)), 0);
}

/** specs.topSizes 는 [{w, d}] 배열이다 (data-constants.js:77). */
function countertopLength(item, lowerTotalW) {
  const sizes = Array.isArray(item.specs?.topSizes) ? item.specs.topSizes : [];
  const declared = sizes.reduce((s, t) => s + Math.max(0, num(t?.w)), 0);
  return declared > 0 ? declared : lowerTotalW;
}

/** 아이템 1개 → { category, analysis, label } */
export function buildQuoteInput(item, index) {
  const category = item.categoryId || item.category || '';
  const modules = Array.isArray(item.modules) ? item.modules : [];

  const upper = modules.filter((m) => m && m.pos === 'upper');
  const lower = modules.filter((m) => m && m.pos === 'lower');
  const lowerTotalW = sumWidths(lower);

  return {
    index,
    category,
    label: item.labelName || category || `품목 ${index + 1}`,
    analysis: {
      upper_cabinets: upper.map((m) => ({ width_mm: Math.max(0, num(m.w)), type: m.type || 'storage' })),
      lower_cabinets: lower.map((m) => ({ width_mm: Math.max(0, num(m.w)), type: m.type || 'storage' })),
      countertop_length_mm: COUNTERTOP_CATEGORIES.has(category)
        ? countertopLength(item, lowerTotalW)
        : 0,
      wall_width_mm: num(item.w),
      has_sink: modules.some((m) => m && m.type === 'sink'),
      // ★ 'cook' — calc-engine.js:592. 'cooktop' 으로 쓰면 영원히 false 다.
      has_cooktop: modules.some((m) => m && m.type === 'cook'),
      has_hood: modules.some((m) => m && m.type === 'hood'),
      door_count: modules.reduce((s, m) => s + (num(m?.doorCount) || 0), 0),
      drawer_count: modules.filter((m) => m && m.isDrawer === true).length,
    },
  };
}

export function buildQuoteInputs(designPayload) {
  const items = Array.isArray(designPayload?.items) ? designPayload.items : [];
  return items.map((item, i) => buildQuoteInput(item, i));
}
