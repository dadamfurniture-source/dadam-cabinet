/**
 * 상판 발주 요청서 — 동결 스냅샷 → 상판 한 장마다 요청 데이터 (순수).
 * docs/01-plan/work-reports-archive.plan.md §2.2 · §8.1 (사장님 결정 2026-10-18).
 *
 *   재질 · 두께   BOM 상판 행 (사양 topMaterial · topThickness — 인조대리석 12·50 / 엔지니어드 스톤 12·20 / 세라믹 12)
 *   치수         BOM 상판 행 그대로 (도면 치수로 바로 발주 — 실측 확정 칸 없음, Q12). 이음은 업체 판단
 *   타공         개수대 · 쿡탑 모듈 자리 → 상판 좌측 끝에서 중심. 크기는 사양에서 고른 가전 모델(appliance_models)의
 *                cutout_w/d/r_mm, 수전은 싱크볼 모델의 faucet_hole_mm (Q10). 모델이 없으면 [확인 필요]
 *   마감         뒷턱 · 앞턱(등뜨기) · 물끊기 · 옆면 — 품목 사양 'on'/'off' 가 생산 설정 기본값을 덮어쓴다 (Q9)
 *   발주 마감     설치일 − 4 근무일 (Q11 · 근무일 기준)
 */

import { materialsOf } from './work-order-data.js';
import { isCornerItem, isoModel, runLengths } from './templates/isometric.js';
import { DEFAULT_COUNTERTOP } from './production/standards.js';

/** 재질 → 생산 설정 vendors 키 (재질마다 업체가 다르다, Q7) */
export const TOP_VENDOR_KEY = Object.freeze({
  '인조대리석': 'topMarble',
  '엔지니어드 스톤': 'topStone',
  '세라믹': 'topCeramic',
});

const num = (v) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : null;
};

export function isSinkModule(m) {
  return Boolean(m) && (m.type === 'sink' || m.hasSink === true || m.has_sink === true || /개수대|싱크/.test(String(m.name || '')));
}

export function isCookModule(m) {
  return Boolean(m) && (m.type === 'cook' || m.hasCooktop === true || m.has_cooktop === true || /가스대|쿡탑|인덕션/.test(String(m.name || '')));
}

const finW = (type, w) => (type && type !== 'None' ? num(w) || 0 : 0);

/** 'on' · 'off' 면 그것, 아니면 기본값 */
const toggle = (v, def) => (v === 'on' || v === true ? true : v === 'off' || v === false ? false : Boolean(def));
const heightOr = (v, def) => (num(v) > 0 ? num(v) : def);

/** 옆면 — 사양이 없으면 몰딩 · 휠라 쪽은 벽, EP · 없음 쪽은 노출 (벽 아닌 쪽만 마감이 기본) */
function sideOf(spec, finishType) {
  if (spec === 'exposed' || spec === 'wall') return spec;
  return finishType === 'Molding' || finishType === 'Filler' ? 'wall' : 'exposed';
}

/** day 보다 앞선 n 번째 근무일 (월~금 · 공휴일 제외). 설치 10/24(금) − 4 → 10/20(월). */
export function workdaysBefore(day, n, holidays = []) {
  if (!day) return null;
  const off = new Set((holidays || []).map((h) => String(h).slice(0, 10)));
  let t = Date.parse(`${String(day).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  let left = Math.max(1, Math.round(Number(n) || 1));
  while (left > 0) {
    t -= 86400000;
    const s = new Date(t).toISOString().slice(0, 10);
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6 && !off.has(s)) left -= 1;
  }
  return new Date(t).toISOString().slice(0, 10);
}

/** 모델 행 → 요청서 칸 (없으면 null) */
function modelOf(models, id) {
  if (!id || !models) return null;
  const m = models instanceof Map ? models.get(id) : models[id];
  if (!m) return null;
  return {
    id,
    name: [m.brand, m.model_name].filter(Boolean).join(' '),
    code: m.model_code || null,
    w: num(m.cutout_w_mm),
    d: num(m.cutout_d_mm),
    r: num(m.cutout_r_mm),
    faucet: num(m.faucet_hole_mm),
  };
}

/** 스냅샷에 상판 행이 있나 (생산 계획의 상판 발주 마감 대상) */
export function hasCountertop(bomPayload) {
  const rows = bomPayload && Array.isArray(bomPayload.materials) ? bomPayload.materials : [];
  return rows.some((m) => m && (m.slot === 'top' || m.part === '상판'));
}

/**
 * @param {Object} snapshot  동결 스냅샷 (design_payload · bom_payload)
 * @param {Object} opts      { countertop: 생산 설정 기본값, models: Map<id, appliance_models 행> }
 * @returns {Array} 상판 한 장마다 요청
 */
export function countertopRequests(snapshot, { countertop = DEFAULT_COUNTERTOP, models = null } = {}) {
  const def = { ...DEFAULT_COUNTERTOP, ...(countertop || {}) };
  const items = (snapshot && snapshot.design_payload && Array.isArray(snapshot.design_payload.items)) ? snapshot.design_payload.items : [];
  const rows = materialsOf(snapshot).filter((m) => m.slot === 'top' || m.part === '상판');
  return rows.map((row, i) => {
    const idx = parseInt(String(row.partId || ''), 10);
    const item = items[Number.isInteger(idx) ? idx : i] || items[i] || {};
    const specs = item.specs || {};
    const modules = Array.isArray(item.modules) ? item.modules : [];
    const lower = modules.filter((m) => m && m.pos === 'lower' && m.type !== 'tall'); // 키큰장은 상판이 안 지나간다
    const ordered = lower.every((m) => num(m._x) !== null) ? [...lower].sort((a, b) => num(a._x) - num(b._x)) : lower;
    const thickness = num(row.thickness) || 12;
    const corner = isCornerItem(item);

    // 타공 — 좌측 끝(왼쪽 마감 포함)에서 모듈 중심까지. 코너 품목은 펼친 길이 기준이라 평면도에도 표시한다.
    const sinkModel = modelOf(models, specs.sinkModelId);
    const cookModel = modelOf(models, specs.cooktopModelId);
    const cutouts = [];
    let x = finW(specs.finishLeftType, specs.finishLeftWidth);
    for (const m of ordered) {
      const w = num(m.w) || 0;
      if (isSinkModule(m)) cutouts.push({ kind: 'sink', label: '싱크볼', center: Math.round(x + w / 2), moduleId: m.id ?? null, model: sinkModel });
      else if (isCookModule(m)) cutouts.push({ kind: 'cooktop', label: '쿡탑', center: Math.round(x + w / 2), moduleId: m.id ?? null, model: cookModel });
      x += w;
    }
    if (cutouts.some((c) => c.kind === 'sink')) {
      cutouts.push({ kind: 'faucet', label: '수전', center: null, at: '싱크볼 뒤 중앙', dia: sinkModel ? sinkModel.faucet : null, model: sinkModel });
    }

    const lipNa = thickness >= 50; // 50T 는 앞에서 이미 두껍다 — 앞턱(등뜨기) 해당 없음
    return {
      index: Number.isInteger(idx) ? idx : i,
      itemLabel: row.itemLabel || item.name || item.categoryId || `품목 ${i + 1}`,
      material: row.material || '인조대리석',
      vendorKey: TOP_VENDOR_KEY[row.material] || 'topMarble',
      thickness,
      finishCode: row.finishCode || null,
      length: Math.round(num(row.w) || 0),
      depth: Math.round(num(row.h) || 0),
      shape: corner ? 'corner' : 'straight',
      runs: corner ? runLengths(item) : [],
      plan: corner ? isoModel(item).boxes.filter((b) => !(b.m && (b.m.pos === 'upper' || b.m.type === 'tall'))).map((b) => ({
        x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, front: b.front, sink: isSinkModule(b.m), cook: isCookModule(b.m),
      })) : null,
      cutouts,
      finishes: {
        backsplash: { on: toggle(specs.topBacksplash, def.backsplash), h: heightOr(specs.topBacksplashH, def.backsplashH) },
        frontLip: { na: lipNa, on: !lipNa && toggle(specs.topFrontLip, def.frontLip), h: heightOr(specs.topFrontLipH, def.frontLipH) },
        drip: { on: toggle(specs.topDrip, def.drip) },
        sideLeft: sideOf(specs.topSideLeft, specs.finishLeftType),
        sideRight: sideOf(specs.topSideRight, specs.finishRightType),
      },
      modelIds: [specs.sinkModelId, specs.cooktopModelId].filter(Boolean),
    };
  });
}

/** 요청서에 필요한 가전 모델 id (인쇄 시점에 appliance_models 에서 읽는다) */
export function countertopModelIds(snapshot) {
  const items = (snapshot && snapshot.design_payload && Array.isArray(snapshot.design_payload.items)) ? snapshot.design_payload.items : [];
  return [...new Set(items.flatMap((it) => [it.specs && it.specs.sinkModelId, it.specs && it.specs.cooktopModelId]).filter((v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)))];
}

/** 수량 한 줄 (외주 발주 · 보관함) */
export function countertopQty(reqs) {
  const list = reqs || [];
  if (!list.length) return { pieces: 0 };
  return {
    pieces: list.length,
    material: list[0].material,
    thickness: list[0].thickness,
    lengthMm: list.reduce((s, r) => s + r.length, 0),
    cutouts: list.reduce((s, r) => s + r.cutouts.length, 0),
  };
}
