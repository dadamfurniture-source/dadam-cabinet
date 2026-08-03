/**
 * exportDesign() 결과 → 견적 계산 입력 어댑터.
 *
 * quote.service.ts 의 ImageAnalysisResult 는 "이미지 1장 = 주방 1개" 가정이고,
 * detaildesign 의 exportDesign() 은 아이템 배열이다. 아이템마다 하나씩 만든다.
 *
 * ★ 필드값은 전부 실제 코드에서 확인한 것만 쓴다.
 *   - 카테고리 id: data-constants.js:4-15 CATEGORIES
 *   - 모듈 type  : calc-engine.js:519,591-594 / ui-fridge-el.js:553
 *     쿡탑의 type 은 'cooktop' 이 아니라 **'cook'** 이다 (calc-engine.js:592).
 *   - 서랍은 별도 type 이 아니라 isDrawer 플래그다 (calc-engine.js:593).
 */

/**
 * detaildesign 카테고리 id → quote.service.ts CABINET_PRICES 키.
 * 매핑이 없는 카테고리(warehouse/door/custom)는 단가가 정의돼 있지 않다.
 */
export const CATEGORY_TO_PRICE_KEY = {
  sink: 'sink',
  island: 'island',
  wardrobe: 'wardrobe',
  fridge: 'fridge_cabinet',
  shoerack: 'shoe_cabinet',
  vanity: 'vanity',
  storage: 'storage',
  // warehouse / door / custom : CABINET_PRICES 에 대응 항목 없음 → 견적 제외
};

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

/**
 * 아이템 1개 → { category, priceKey, analysis, label }
 * priceKey 가 null 이면 단가표에 없는 카테고리다.
 */
export function buildQuoteInput(item, index) {
  const category = item.categoryId || item.category || '';
  const priceKey = CATEGORY_TO_PRICE_KEY[category] || null;
  const modules = Array.isArray(item.modules) ? item.modules : [];

  const upper = modules.filter((m) => m && m.pos === 'upper');
  const lower = modules.filter((m) => m && m.pos === 'lower');
  const lowerTotalW = sumWidths(lower);

  return {
    index,
    category,
    priceKey,
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

/**
 * BOM 자재에서 도어 면적을 finishCode 별로 집계한다 (m²).
 * finishCode 가 비어 있는 행(기본 MDF)은 업차지 대상이 아니므로 제외한다.
 */
export function collectDoorAreas(bomPayload) {
  const materials = Array.isArray(bomPayload?.materials) ? bomPayload.materials : [];
  const byCode = new Map();

  for (const m of materials) {
    if (!m || !m.finishCode) continue;
    const w = num(m.w);
    const h = num(m.h);
    const qty = num(m.qty);
    if (w <= 0 || h <= 0 || qty <= 0) continue;
    const area = (w * h * qty) / 1e6; // mm² → m²
    byCode.set(m.finishCode, (byCode.get(m.finishCode) || 0) + area);
  }

  return byCode;
}
