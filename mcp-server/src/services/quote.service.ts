/**
 * 견적 계산 서비스 — pricing_data.py 포팅
 * 이미지 분석 결과(모듈 스펙)로 견적 산출
 */

// ─── 단가표 (14건 고객 견적 + 제품 시트 기반) ───
const CABINET_PRICES: Record<string, Record<string, number>> = {
  sink:           { lower: 160000, upper: 140000 },
  island:         { lower: 180000, upper: 140000 },
  wardrobe:       { lower: 100000 },  // per 자(303mm)
  shoe_cabinet:   { lower: 400000 },
  vanity:         { lower: 250000 },
  storage:        { lower: 160000 },
  fridge_cabinet: { lower: 180000, upper: 140000 },
};

const COUNTERTOP_PRICES: Record<string, number> = {
  basic: 150000,    // per 1000mm
  mid: 190000,
  premium: 230000,
};

const FIXTURE_PRICES: Record<string, Record<string, number>> = {
  faucet:    { basic: 40000,  mid: 110000, premium: 150000 },
  sink_bowl: { basic: 80000,  mid: 385000, premium: 450000 },
  hood:      { basic: 65000,  mid: 80000,  premium: 230000 },
};

const LABOR = {
  installation: 200000,
  demolition_small: 300000,
  demolition_large: 500000,
};

const VAT_RATE = 0.10;

// ─── 모듈 스펙 인터페이스 ───
export interface ModuleSpec {
  width_mm: number;
  type: string; // storage, sink, cooktop, hood
  position: 'upper' | 'lower';
}

export interface ImageAnalysisResult {
  upper_cabinets: Array<{ width_mm: number; type: string }>;
  lower_cabinets: Array<{ width_mm: number; type: string }>;
  countertop_length_mm: number;
  wall_width_mm: number;
  has_sink: boolean;
  has_cooktop: boolean;
  has_hood: boolean;
  door_count: number;
  drawer_count: number;
}

export interface QuoteResult {
  items: Array<{ name: string; quantity: string; unit_price: number; total: number }>;
  subtotal: number;
  vat: number;
  total: number;
  grade: string;
}

// ─── 견적 계산 ───
export function calculateQuote(
  analysis: ImageAnalysisResult,
  category: string = 'sink',
  grade: string = 'basic',
): QuoteResult {
  const items: QuoteResult['items'] = [];
  const prices = CABINET_PRICES[category] || CABINET_PRICES.sink;

  // 하부장 캐비닛
  const lowerTotalW = analysis.lower_cabinets.reduce((s, m) => s + m.width_mm, 0);
  if (lowerTotalW > 0 && prices.lower) {
    const cost = Math.round(prices.lower * lowerTotalW / 1000);
    items.push({ name: '하부장 캐비닛', quantity: `${lowerTotalW}mm`, unit_price: prices.lower, total: cost });
  }

  // 상부장 캐비닛
  const upperTotalW = analysis.upper_cabinets.reduce((s, m) => s + m.width_mm, 0);
  if (upperTotalW > 0 && prices.upper) {
    const cost = Math.round(prices.upper * upperTotalW / 1000);
    items.push({ name: '상부장 캐비닛', quantity: `${upperTotalW}mm`, unit_price: prices.upper, total: cost });
  }

  // 상판
  const ctLen = analysis.countertop_length_mm || lowerTotalW;
  if (ctLen > 0) {
    const ctPrice = COUNTERTOP_PRICES[grade] || COUNTERTOP_PRICES.basic;
    const cost = Math.round(ctPrice * ctLen / 1000);
    items.push({ name: '상판 (인조대리석)', quantity: `${ctLen}mm`, unit_price: ctPrice, total: cost });
  }

  // 설비
  const fGrade = grade as keyof typeof FIXTURE_PRICES.faucet;
  if (analysis.has_sink) {
    const faucetCost = FIXTURE_PRICES.faucet[fGrade] || FIXTURE_PRICES.faucet.basic;
    const bowlCost = FIXTURE_PRICES.sink_bowl[fGrade] || FIXTURE_PRICES.sink_bowl.basic;
    items.push({ name: '수전', quantity: '1개', unit_price: faucetCost, total: faucetCost });
    items.push({ name: '싱크볼', quantity: '1개', unit_price: bowlCost, total: bowlCost });
  }

  if (analysis.has_hood) {
    const hoodCost = FIXTURE_PRICES.hood[fGrade] || FIXTURE_PRICES.hood.basic;
    items.push({ name: '후드', quantity: '1개', unit_price: hoodCost, total: hoodCost });
  }

  // 설치비
  items.push({ name: '배송 + 설치', quantity: '1식', unit_price: LABOR.installation, total: LABOR.installation });

  // 합산
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const vat = Math.round(subtotal * VAT_RATE);
  const total = subtotal + vat;

  return { items, subtotal, vat, total, grade };
}
