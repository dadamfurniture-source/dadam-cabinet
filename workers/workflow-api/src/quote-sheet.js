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
 * 상판·설비·철거는 지금 단가표(m당·개당)를 그대로 쓴다 — BOM 원판과 무관한 항목이다.
 *
 * 원가 내역(cost)은 대표용이다. 고객 문서(확인서)는 items·합계만 그린다.
 */

import { countWork, workloadFromCounts } from './production/workload.js';
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
 * @param {Object} input
 * @param {Object} input.design   스냅샷 design_payload
 * @param {Object} input.bom      스냅샷 bom_payload ({materials, hardware})
 * @param {Object|null} input.cutPlan  재단 배치 (없으면 면적으로 원판 추정)
 * @param {Object} [input.settings]  production settings ({standards, crew, costs, quote})
 * @param {Array}  [input.extraItems]  단가표에서 그대로 가져올 줄 (상판·설비·철거)
 * @param {Object} [input.range]  {min,max} 배수 — 확인서의 "최종 금액 범위" 문구
 */
export function calculateSheetQuote({ design, bom, cutPlan, settings = {}, extraItems = [], range = null }) {
  const S = { ...DEFAULT_STANDARDS, ...(settings.standards || {}) };
  const crew = { ...DEFAULT_CREW, ...(settings.crew || {}) };
  const costs = { ...DEFAULT_COSTS, ...(settings.costs || {}) };
  const Q = { ...DEFAULT_QUOTE, ...(settings.quote || {}) };
  const margin = 1 + Q.marginRate;

  const c = countWork(bom, cutPlan);
  const w = workloadFromCounts(c, S);
  const doors = doorSheets(bom, cutPlan);
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

  const items = [];
  const line = (name, qty, unit, cost) => {
    if (!(qty > 0) || !(cost > 0)) return null;
    const unitPrice = r100((cost * margin) / qty);
    const it = { name, quantity: `${Math.round(qty * 100) / 100}${unit}`, unit_price: unitPrice, total: Math.round(unitPrice * qty) };
    items.push(it);
    return it;
  };
  line('몸통 제작 (PB 15T · 재단·엣지·조립·철물 포함)', c.sheetsPB, '장', sum(body));
  line('뒷판 (MDF 2.7T)', c.sheetsBack, '장', sum(back));
  line('도어 (MDF 18T · 마감·달기 포함)', doors, '장', sum(door));
  line('시공 (설치 길이 기준)', installM, 'm', sum(install));
  // 몸통 장수가 0 인데 몸통 원가가 있으면(PB 없이 철물만 등) 일식으로 남긴다 — 금액을 조용히 버리지 않는다
  if (!(c.sheetsPB > 0) && sum(body) > 0) items.push({ name: '몸통 부자재·작업 (일식)', quantity: '1식', unit_price: r100(sum(body) * margin), total: r100(sum(body) * margin) });

  for (const x of extraItems) items.push(x);

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const vat = Math.round(subtotal * 0.1);
  const total = subtotal + vat;
  const costTotal = sum(body) + sum(back) + sum(door) + sum(install);
  const cabinetPrice = items.filter((i) => !extraItems.includes(i)).reduce((s, i) => s + i.total, 0);

  return {
    method: 'sheet',
    items,
    subtotal,
    vat,
    total,
    range: range && range.min && range.max ? { min: Math.round(total * range.min), max: Math.round(total * range.max) } : null,
    skipped: [],
    margin_rate: Q.marginRate,
    // ── 대표용 원가 내역 (고객 문서에는 그리지 않는다) ──
    cost: {
      total: Math.round(costTotal),
      cabinet_price: cabinetPrice,
      margin_amount: Math.round(cabinetPrice - costTotal),
      body: roundAll(body),
      back: roundAll(back),
      door: roundAll(door),
      install: roundAll(install),
      quantities: { sheetsPB: c.sheetsPB, sheetsBack: c.sheetsBack, doorSheets: doors, edgeMeters: Math.round(edgeM * 10) / 10, installMeters: installM, boxes: c.boxes, drawers: c.drawers, doors: c.doors, ...hw },
      seconds: { cutter: Math.round(w.cutter), edge: Math.round(w.edge), asm: Math.round(w.asm) },
      sheet_source: c.sheetSource,
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
