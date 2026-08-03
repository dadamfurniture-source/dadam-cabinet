/**
 * 견적 계산 — mcp-server/src/services/quote.service.ts:80 calculateQuote 포팅.
 *
 * 원본은 아이템 1개(이미지 1장 = 주방 1개) 기준이라, 다중 아이템으로 확장하면서
 * 다음 두 가지가 실수 나기 쉬운 지점이다:
 *
 *   1) 철거비는 아이템별로 계산해 더하면 반올림 오차가 누적된다.
 *      → 전체 길이를 먼저 합산한 뒤 1회 계산한다 (원본 :129-132 와 동일한 식).
 *   2) VAT 는 최종 subtotal 에 1회만 적용한다 (원본 :136).
 *
 * ★ 설치비(LABOR.installation, 200,000)는 계상하지 않는다.
 *   원본 calculateQuote 가 실제로 items 에 추가하지 않기 때문이다
 *   (전 소스에서 LABOR.installation 참조처 0곳). 계상하면 건당 20만 + VAT 가
 *   늘어나는 신규 규칙이 되므로 담당자 확정 전까지 현행 동작을 유지한다.
 *
 * ★ MODULE_TYPE_PRICES 도 같은 이유로 쓰지 않는다. 원본이 참조하지 않으며,
 *   cabinet 과 같은 물리 길이를 대상으로 해 동시 적용 시 이중 계상된다.
 */

import { collectDoorAreas } from './adapters.js';

export const VALID_GRADES = ['basic', 'mid', 'premium'];

function sumWidths(cabinets) {
  return cabinets.reduce((s, c) => s + Math.max(0, Number(c.width_mm) || 0), 0);
}

/**
 * @param {Array} inputs      buildQuoteInputs() 결과
 * @param {Object} pricebook  pricing.js 의 pricebook
 * @param {Object} bomPayload 도어 마감 업차지 계산용 (없으면 생략)
 * @param {string} grade      basic | mid | premium
 */
export function calculateQuote(inputs, pricebook, bomPayload, grade = 'basic') {
  const g = VALID_GRADES.includes(grade) ? grade : 'basic';

  const items = [];
  const skipped = [];
  let demolitionLenTotal = 0;

  for (const input of inputs) {
    const { analysis, priceKey, label } = input;
    const lowerTotalW = sumWidths(analysis.lower_cabinets);
    const upperTotalW = sumWidths(analysis.upper_cabinets);
    demolitionLenTotal += lowerTotalW + upperTotalW;

    if (!priceKey) {
      // 단가표에 없는 카테고리 — 조용히 0원 처리하지 않고 드러낸다
      skipped.push({ label, category: input.category, reason: '단가표에 없는 카테고리' });
      continue;
    }

    // 하부장 본체
    const lowerUnit = pricebook.cabinet(priceKey, 'lower');
    if (lowerTotalW > 0 && lowerUnit !== null) {
      items.push({
        name: `${label} 하부장 캐비닛`,
        quantity: `${lowerTotalW}mm`,
        unit_price: lowerUnit,
        total: Math.round((lowerUnit * lowerTotalW) / 1000),
      });
    }

    // 상부장 본체
    const upperUnit = pricebook.cabinet(priceKey, 'upper');
    if (upperTotalW > 0 && upperUnit !== null) {
      items.push({
        name: `${label} 상부장 캐비닛`,
        quantity: `${upperTotalW}mm`,
        unit_price: upperUnit,
        total: Math.round((upperUnit * upperTotalW) / 1000),
      });
    }

    // 상판
    const ctLen = Number(analysis.countertop_length_mm) || 0;
    const ctUnit = pricebook.countertop(g);
    if (ctLen > 0 && ctUnit !== null) {
      items.push({
        name: `${label} 상판 (인조대리석)`,
        quantity: `${ctLen}mm`,
        unit_price: ctUnit,
        total: Math.round((ctUnit * ctLen) / 1000),
      });
    }

    // 설비
    if (analysis.has_sink) {
      const faucet = pricebook.fixture('faucet', g);
      const bowl = pricebook.fixture('sink_bowl', g);
      if (faucet !== null) {
        items.push({ name: `${label} 수전`, quantity: '1개', unit_price: faucet, total: faucet });
      }
      if (bowl !== null) {
        items.push({ name: `${label} 싱크볼`, quantity: '1개', unit_price: bowl, total: bowl });
      }
    }
    if (analysis.has_hood) {
      const hood = pricebook.fixture('hood', g);
      if (hood !== null) {
        items.push({ name: `${label} 후드`, quantity: '1개', unit_price: hood, total: hood });
      }
    }
  }

  // 도어 마감 업차지 — baseline 이 없으면 계상하지 않는다 (이중 계상 방지)
  const doorUpcharge = calculateDoorUpcharge(pricebook, bomPayload);
  if (doorUpcharge) items.push(doorUpcharge);

  // 철거비 — 전체 길이 합산 후 1회
  const demolitionUnit = pricebook.labor('demolition');
  if (demolitionLenTotal > 0 && demolitionUnit !== null) {
    items.push({
      name: '기존 철거',
      quantity: `${demolitionLenTotal}mm`,
      unit_price: demolitionUnit,
      total: Math.round((demolitionUnit * demolitionLenTotal) / 1000),
    });
  }

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const vat = Math.round(subtotal * pricebook.vatRate());
  const total = subtotal + vat;

  const minMult = pricebook.rangeMin();
  const maxMult = pricebook.rangeMax();

  return {
    items,
    subtotal,
    vat,
    total,
    range:
      minMult !== null && maxMult !== null
        ? { min: Math.round(total * minMult), max: Math.round(total * maxMult) }
        : null,
    grade: g,
    skipped,
    pricing_version: pricebook.version,
    pricing_rule_set_id: pricebook.ruleSetId,
    // 도어 업차지를 왜 안 넣었는지 문서/화면에서 설명할 수 있게 남긴다
    door_upcharge_applied: Boolean(doorUpcharge),
  };
}

/**
 * 도어 마감 업차지 = Σ 면적 × max(0, 마감단가 − 기본도어단가)
 *
 * baseline 이 없으면 null 을 돌려준다. CABINET_PRICES 에 기본 도어가
 * 포함돼 있다고 보면, baseline 없이 마감 단가 전액을 더할 경우 도어값이
 * 이중 계상되기 때문이다.
 */
export function calculateDoorUpcharge(pricebook, bomPayload) {
  const baseline = pricebook.doorBaseline();
  if (baseline === null) return null;

  const areas = collectDoorAreas(bomPayload);
  if (areas.size === 0) return null;

  let total = 0;
  let totalArea = 0;
  for (const [code, area] of areas) {
    const price = pricebook.doorFinishPrice(code);
    if (price === null) continue;
    const diff = price - baseline;
    if (diff <= 0) continue;
    total += area * diff;
    totalArea += area;
  }

  if (total <= 0) return null;

  return {
    name: '도어 마감 업그레이드',
    quantity: `${totalArea.toFixed(2)}m²`,
    unit_price: null, // 마감별로 단가가 달라 단일 단가가 없다
    total: Math.round(total),
  };
}
