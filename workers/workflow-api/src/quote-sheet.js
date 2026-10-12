/**
 * 장당 견적 — BOM 수량 × 실제 원가 × (1 + 마진율).
 *
 * 2026-10-13 대표 결정: 상세설계 후 고객에게 보이는 견적은 m당 단가가 아니라
 * BOM 추출에서 나온 원판 장수로 계산하고, 실제 들어가는 비용에 마진 20% 를 더한다.
 *
 * 원가 = 자재(원판·엣지·철물) + 도어 외주 + 인건비(사람별 작업 초 × 초당 비용) + 간접비(공장 작업 시간 비례) + 시공 외주
 * 고객 줄:
 *   몸통 제작 (PB 15T)       n장 × 장당 단가   ← 몸통 원판·엣지·철물·재단·엣지·조립·포장·간접비
 *   뒷판 (MDF 2.7T)          n장 × 장당 단가   ← 뒷판 원판·재단·간접비
 *   도어 (MDF 18T 외주 마감)  n장 × 장당 단가   ← 도어 외주·도어 검수·달기·간접비
 *   시공 (설치 길이 기준)     n m × m당 단가    ← 시공 외주 (싱크 하부+상부, 키큰·붙박이 1m = 2m)
 * 상판·설비(싱크볼·수전·후드)·철거도 매입·시공 원가 × (1 + 마진율) 로 낸다 —
 * 원가·제작·설치·기타 비용을 다 넣은 최종 지출비용에 마진 20% (2026-10-13 대표).
 * 공장 기타 비용(차량·소모품·폐기물·광고·카드 수수료)은 간접비(공장 작업 시간당)로 캐비닛 원가에 들어 있다.
 *
 * 원가 내역(cost)은 대표용이다. 고객 문서(확인서)는 items·합계만 그린다.
 *
 * 가격은 두 벌을 같은 원가 줄에서 낸다 (2026-10-13 대표):
 *   고객 금액   = 최종 지출비용 × (1 + marginRate, 기본 0.2)          → items · subtotal · vat · total
 *   거래처 금액 = 최종 지출비용 × (1 + partnerMarginRate, 기본 0.1)  → partner.{items, subtotal, vat, total}
 * 간접비는 매출 전체에서 충당하므로 기본은 품목 원가에 넣지 않는다 (overheadPerHour 0).
 */

import { countWork, workloadFromCounts } from './production/workload.js';
import { buildQuoteInputs } from './adapters.js';
import { DEFAULT_STANDARDS, DEFAULT_CREW, DEFAULT_COSTS, DEFAULT_QUOTE } from './production/standards.js';

const SHEET_AREA_M2 = 1.22 * 2.44;
const FALLBACK_YIELD = 0.75;
/** 키큰장·붙박이장처럼 이 높이 이상인 통은 시공 길이를 2배로 센다 (1m = 2m) */
const TALL_MM = 1500;

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
const r100 = (x) => Math.round(x / 100) * 100;

/** 도어 외주 원장 장수 — 재단 배치의 MDF 15T 이상, 없으면 면적 ÷ 원판 ÷ 수율. */
export function doorSheets(bom, cutPlan) {
  const by = cutPlan && cutPlan.summary && cutPlan.summary.sheetsByMaterial;
  if (by && typeof by === 'object') {
    let n = 0;
    for (const [key, v] of Object.entries(by)) {
      const [mat, t] = String(key).split('_');
      if (String(mat).toUpperCase() === 'MDF' && num(t) >= 15) n += num(v);
    }
    return n;
  }
  const area = ((bom && bom.materials) || [])
    .filter((m) => String(m.material || '').toUpperCase() === 'MDF' && num(m.thickness) >= 15)
    .reduce((s, m) => s + (num(m.w) * num(m.h) * num(m.qty)) / 1e6, 0);
  return area > 0 ? Math.ceil(area / (SHEET_AREA_M2 * FALLBACK_YIELD)) : 0;
}

/** 올림 (step 단위). 부동소수 오차로 1.0000001 이 1.1 이 되지 않게 살짝 깎는다. */
const ceilTo = (x, step) => (x > 0 ? Math.ceil(x / step - 1e-9) * step : 0);

/**
 * 면적 기준 원판 장수 (자투리 재사용 · 도어 반 장 청구, 2026-10-13 대표).
 *   PB·뒷판 = 면적 ÷ (원판 × pbYield), 0.1장 올림 · 도어 = 면적 ÷ (원판 × doorYield), 0.5장 올림
 */
export function areaSheets(bom, Q) {
  const mats = (bom && bom.materials) || [];
  const area = (pred) => mats.filter(pred).reduce((t, m) => t + (num(m.w) * num(m.h) * num(m.qty)) / 1e6, 0);
  const mat = (m) => String(m.material || '').toUpperCase();
  const pbA = area((m) => mat(m).startsWith('PB'));
  const backA = area((m) => mat(m) === 'MDF' && num(m.thickness) > 0 && num(m.thickness) < 5);
  const doorA = area((m) => mat(m) === 'MDF' && num(m.thickness) >= 15);
  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    pb: r1(ceilTo(pbA / (SHEET_AREA_M2 * Q.pbYield), 0.1)),
    back: r1(ceilTo(backA / (SHEET_AREA_M2 * Q.pbYield), 0.1)),
    door: ceilTo(doorA / (SHEET_AREA_M2 * Q.doorYield), 0.5),
    areaM2: { pb: Math.round(pbA * 100) / 100, back: Math.round(backA * 100) / 100, door: Math.round(doorA * 100) / 100 },
  };
}

/** 몸통 엣지 길이 (m) — PB 행의 edgeLen × 수량. */
export function edgeMeters(bom) {
  return ((bom && bom.materials) || [])
    .filter((m) => String(m.material || '').toUpperCase().startsWith('PB'))
    .reduce((s, m) => s + num(m.edgeLen) * num(m.qty), 0) / 1000;
}

/** 철물 수량 — HardwareExtractor 분류 그대로. */
export function hardwareCounts(bom) {
  const hw = (bom && bom.hardware) || [];
  const q = (cat) => hw.filter((h) => h && h.category === cat).reduce((s, h) => s + num(h.qty), 0);
  return { hinge: q('경첩'), rail: q('레일'), leg: q('다리발'), shelfPin: q('브라켓'), rod: q('옷봉') };
}

/**
 * 시공 길이 (m) — 통마다 폭 × (높이 1500 이상이면 2, 아니면 1).
 * 싱크대 3m 상·하부 = 6m, 키큰장·붙박이장 1m = 2m (대표 확정 규칙).
 * 냉장고 자리(type fridge)는 가구가 아니라 빼고, 높이가 없으면 붙박이장만 2배로 본다.
 */
export function installMeters(design) {
  let m = 0;
  for (const item of (design && design.items) || []) {
    const cat = item.categoryId || item.category || '';
    for (const mod of item.modules || []) {
      if (!mod || mod.type === 'fridge') continue;
      const w = num(mod.w);
      if (w <= 0) continue;
      const h = num(mod.h);
      const tall = h > 0 ? h >= TALL_MM : cat === 'wardrobe';
      m += (w / 1000) * (tall ? 2 : 1);
    }
  }
  return Math.round(m * 100) / 100;
}

/**
 * 상판·설비·철거 원가 줄 — 설계 품목마다 (adapters.buildQuoteInputs 의 분석을 그대로 쓴다).
 * 철거는 단가표 견적과 같이 상·하부 길이 합으로 견적당 한 줄.
 */
export function extraCostLines(design, Q) {
  const lines = [];
  let demolitionMm = 0;
  for (const input of buildQuoteInputs(design)) {
    const a = input.analysis;
    const label = input.label;
    demolitionMm += a.lower_cabinets.reduce((s, c) => s + c.width_mm, 0) + a.upper_cabinets.reduce((s, c) => s + c.width_mm, 0);
    const ct = num(a.countertop_length_mm) / 1000;
    if (ct > 0) lines.push({ name: `${label} 상판 (인조대리석)`, qty: Math.round(ct * 100) / 100, unit: 'm', cost: ct * Q.countertopPerMeter, key: 'countertop' });
    if (a.has_sink) {
      lines.push({ name: `${label} 싱크볼`, qty: 1, unit: '개', cost: Q.sinkBowl, key: 'sinkBowl' });
      lines.push({ name: `${label} 수전`, qty: 1, unit: '개', cost: Q.faucet, key: 'faucet' });
    }
    if (a.has_hood) lines.push({ name: `${label} 후드`, qty: 1, unit: '개', cost: Q.hood, key: 'hood' });
  }
  const dm = demolitionMm / 1000;
  if (dm > 0 && Q.demolitionPerMeter > 0) lines.push({ name: '기존 철거', qty: Math.round(dm * 100) / 100, unit: 'm', cost: dm * Q.demolitionPerMeter, key: 'demolition' });
  return lines;
}

/**
 * @param {Object} input
 * @param {Object} input.design   스냅샷 design_payload
 * @param {Object} input.bom      스냅샷 bom_payload ({materials, hardware})
 * @param {Object|null} input.cutPlan  재단 배치 (없으면 면적으로 원판 추정)
 * @param {Object} [input.settings]  production settings ({standards, crew, costs, quote})
 * @param {Array}  [input.extraItems]  금액이 이미 정해진 줄 (마진을 다시 붙이지 않는다). 기본은 없음
 * @param {Object} [input.range]  {min,max} 배수 — 확인서의 "최종 금액 범위" 문구
 */
export function calculateSheetQuote({ design, bom, cutPlan, settings = {}, extraItems = [], range = null }) {
  const S = { ...DEFAULT_STANDARDS, ...(settings.standards || {}) };
  const crew = { ...DEFAULT_CREW, ...(settings.crew || {}) };
  const costs = { ...DEFAULT_COSTS, ...(settings.costs || {}) };
  const Q = { ...DEFAULT_QUOTE, ...(settings.quote || {}) };

  const c = countWork(bom, cutPlan);
  let doors = doorSheets(bom, cutPlan);
  let areaInfo = null;
  if (Q.sheetBasis !== 'nested') {
    // 면적 기준 — 재료비와 재단·엣지 시간 모두 이 장수로 (자투리를 다음 현장에 쓰므로)
    areaInfo = areaSheets(bom, Q);
    c.sheetsPB = areaInfo.pb;
    c.sheetsBack = areaInfo.back;
    c.sheetSource = 'area';
    doors = areaInfo.door;
  }
  const w = workloadFromCounts(c, S);
  const edgeM = edgeMeters(bom);
  const hw = hardwareCounts(bom);
  const installM = installMeters(design);

  // 초당 비용
  const secPerDay = crew.hoursPerDay * 3600 * crew.util;
  const rateCut = Q.cutterMonthly / (Q.workDays * secPerDay);
  const rateAsm = costs.assemblerDay / secPerDay;
  const ratePart = costs.partTimeHourly / (3600 * crew.util);
  const ohSec = Q.overheadPerHour / 3600;

  // 공정 초를 줄별로 나눈다
  const backCutSec = c.sheetsBack * S.cutPerSheet;
  const bodyCutSec = Math.max(0, w.cutter - backCutSec);
  const doorHangSec = c.doors * S.asmPerDoor;
  const bodyAsmSec = w.asmMain + c.boxes * S.packPerBox;

  const hardwareCost = hw.hinge * Q.hinge + hw.rail * Q.rail + hw.leg * Q.leg + hw.shelfPin * Q.shelfPin + hw.rod * Q.rod + c.boxes * Q.fastenerPerBox;
  const body = {
    material: c.sheetsPB * Q.pbSheet,
    edge: edgeM * (Q.edgeRoll / Q.edgeRollMeters),
    hardware: hardwareCost,
    labor: bodyCutSec * rateCut + w.edge * ratePart + bodyAsmSec * rateAsm,
    overhead: (bodyCutSec + w.edge + bodyAsmSec) * ohSec,
  };
  const back = {
    material: c.sheetsBack * Q.backSheet,
    labor: backCutSec * rateCut,
    overhead: backCutSec * ohSec,
  };
  const door = {
    outsourcing: doors * Q.doorSheet,
    labor: doorHangSec * rateAsm,
    overhead: doorHangSec * ohSec,
  };
  const install = { outsourcing: installM * Q.installPerMeter };
  const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

  // 원가 줄 — 이름·수량·단위·원가. 가격은 마진율을 바꿔 두 벌로 낸다.
  const costLines = [];
  const add = (name, qty, unit, cost, key) => { if (qty > 0 && cost > 0) costLines.push({ name, qty, unit, cost, key }); };
  add('몸통 제작 (PB 15T · 재단·엣지·조립·철물 포함)', c.sheetsPB, '장', sum(body), 'body');
  add('뒷판 (MDF 2.7T)', c.sheetsBack, '장', sum(back), 'back');
  add('도어 (MDF 18T · 마감·달기 포함)', doors, '장', sum(door), 'door');
  add('시공 (설치 길이 기준)', installM, 'm', sum(install), 'install');
  // 몸통 장수가 0 인데 몸통 원가가 있으면(PB 없이 철물만 등) 일식으로 남긴다 — 금액을 조용히 버리지 않는다
  if (!(c.sheetsPB > 0) && sum(body) > 0) add('몸통 부자재·작업 (일식)', 1, '식', sum(body), 'body');
  // 상판·설비·철거
  const extraCost = {};
  for (const x of extraCostLines(design, Q)) {
    if (x.qty > 0 && x.cost > 0) { add(x.name, x.qty, x.unit, x.cost, x.key); extraCost[x.key] = (extraCost[x.key] || 0) + x.cost; }
  }

  const priceWith = (rate) => {
    const lines = costLines.map((l) => {
      const unitPrice = r100((l.cost * (1 + rate)) / l.qty);
      return { name: l.name, quantity: `${Math.round(l.qty * 100) / 100}${l.unit}`, unit_price: unitPrice, total: Math.round(unitPrice * l.qty) };
    });
    const all = lines.concat(extraItems);
    const sub = all.reduce((t, i) => t + i.total, 0);
    const v = Math.round(sub * 0.1);
    return { items: all, priced: lines.reduce((t, i) => t + i.total, 0), subtotal: sub, vat: v, total: sub + v };
  };
  const customer = priceWith(Q.marginRate);
  const partner = priceWith(Q.partnerMarginRate);
  const items = customer.items;
  const { subtotal, vat, total } = customer;
  const cabinetCost = sum(body) + sum(back) + sum(door) + sum(install);
  const costTotal = cabinetCost + sum(extraCost);
  const pricedTotal = customer.priced;

  return {
    method: 'sheet',
    items,
    subtotal,
    vat,
    total,
    range: range && range.min && range.max ? { min: Math.round(total * range.min), max: Math.round(total * range.max) } : null,
    skipped: [],
    margin_rate: Q.marginRate,
    // 거래처(인테리어 업체) 금액 — 같은 원가 줄에 거래처 마진율
    partner: {
      items: partner.items,
      subtotal: partner.subtotal,
      vat: partner.vat,
      total: partner.total,
      margin_rate: Q.partnerMarginRate,
    },
    // ── 대표용 원가 내역 (고객 문서에는 그리지 않는다) ──
    cost: {
      // 최종 지출비용 = 캐비닛(자재·제작·간접비·시공) + 상판·설비·철거. 고객 공급가(정해진 줄 제외) = 이 × (1 + 마진)
      total: Math.round(costTotal),
      cabinet: Math.round(cabinetCost),
      extras: roundAll(extraCost),
      priced_total: pricedTotal,
      margin_amount: Math.round(pricedTotal - costTotal),
      partner_margin_amount: Math.round(partner.priced - costTotal),
      body: roundAll(body),
      back: roundAll(back),
      door: roundAll(door),
      install: roundAll(install),
      quantities: { sheetsPB: c.sheetsPB, sheetsBack: c.sheetsBack, doorSheets: doors, edgeMeters: Math.round(edgeM * 10) / 10, installMeters: installM, boxes: c.boxes, drawers: c.drawers, doors: c.doors, ...hw },
      seconds: { cutter: Math.round(w.cutter), edge: Math.round(w.edge), asm: Math.round(w.asm) },
      sheet_source: c.sheetSource,
      area_m2: areaInfo ? areaInfo.areaM2 : null,
    },
  };
}

function roundAll(o) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
}

/** 단가표 견적에서 캐비닛과 무관한 줄(상판·설비·철거)만 고른다. 캐비닛·도어 업차지는 장당 견적이 대신한다. */
export function nonCabinetItems(pricebookQuote) {
  return ((pricebookQuote && pricebookQuote.items) || []).filter((i) => !/캐비닛|도어 마감 업그레이드/.test(String(i.name)));
}
