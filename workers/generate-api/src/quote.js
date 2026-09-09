/**
 * 견적 — 품목별 단가 표 하나로 전 품목을 계산한다.
 * 단가는 이전 카테고리별 견적 함수의 값을 그대로 옮겼다 (mcp-server quote.service 표준값).
 *   per: 300 → 300mm(1자) 단위 올림, 없으면 벽 폭 1000mm 당
 *   share: 벽 폭 중 이 품목이 차지하는 비율 (상부장은 후드 존 제외 70%)
 */

const RATES = {
  sink: {
    lines: [
      { name: '하부장 캐비닛', price: 160000 },
      { name: '상부장 캐비닛', price: 140000, share: 0.7 },
      { name: '상판 (인조대리석)', price: 150000 },
    ],
    fixed: [
      { name: '수전', price: 40000 },
      { name: '싱크볼', price: 80000 },
      { name: '후드', price: 65000 },
    ],
  },
  wardrobe: { lines: [{ name: '붙박이장 캐비닛', price: 140000, per: 300 }] },
  storage: { lines: [{ name: '수납장 캐비닛', price: 160000 }] },
  fridge: {
    lines: [
      { name: '팬트리 하부장', price: 180000 },
      { name: '상단 브릿지 캐비닛', price: 140000 },
    ],
  },
  vanity: { lines: [{ name: '파우더룸 캐비닛', price: 250000 }] },
  shoe: { lines: [{ name: '신발장 캐비닛', price: 400000 }] },
  office: { lines: [{ name: '사무실 붙박이', price: 220000 }] },
};
RATES.island = RATES.sink; // 아일랜드 단가는 별도 표준값이 없어 싱크대 표를 쓴다

const INSTALL = 200000;
const DEMOLITION_PER_1000 = 30000;

export function buildQuote(category, wallW) {
  const rate = RATES[category] || RATES.storage;
  const mm = Math.max(0, Number(wallW) || 0);
  const items = [];
  for (const l of rate.lines) {
    const span = Math.round(mm * (l.share || 1));
    if (l.per === 300) {
      const units = Math.ceil(span / 300);
      items.push({
        name: l.name,
        quantity: `${span}mm (${units}자)`,
        unit_price: l.price,
        total: units * l.price,
      });
    } else {
      items.push({
        name: l.name,
        quantity: `${span}mm`,
        unit_price: l.price,
        total: Math.round((l.price * span) / 1000),
      });
    }
  }
  for (const f of rate.fixed || []) {
    items.push({ name: f.name, quantity: '1개', unit_price: f.price, total: f.price });
  }
  items.push({ name: '시공비', quantity: '1식', unit_price: INSTALL, total: INSTALL });
  items.push({
    name: '기존 철거',
    quantity: `${mm}mm`,
    unit_price: DEMOLITION_PER_1000,
    total: Math.round((DEMOLITION_PER_1000 * mm) / 1000),
  });
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const vat = Math.round(subtotal * 0.1);
  const total = subtotal + vat;
  return {
    items,
    subtotal,
    vat,
    total,
    range: { min: Math.round(total * 0.95), max: Math.round(total * 1.3) },
    grade: 'basic',
  };
}
