/**
 * 상판 발주 요청서 — 동결 스냅샷 → 상판 한 장마다 요청 데이터 (순수).
 * docs/01-plan/work-reports-archive.plan.md §2.2 · §8.1 (사장님 결정 2026-10-18).
 *
 *   재질 · 두께   BOM 상판 행 (사양 topMaterial · topThickness — 인조대리석 12·50 / 엔지니어드 스톤 12·20 / 세라믹 12)
 *   치수         BOM 상판 행 그대로 (도면 치수로 바로 발주 — 실측 확정 칸 없음, Q12). 이음은 업체 판단
 *   타공         개수대 · 쿡탑 모듈 자리 → 상판 좌측 끝에서 중심. 크기는 사양에서 고른 가전 모델(appliance_models)의
 *                cutout_w/d/r_mm, 수전은 싱크볼 모델의 faucet_hole_mm (Q10). 모델이 없으면 [확인 필요]
 *   마감         뒷턱 · 앞턱(등뜨기) · 물끊기 · 옆면 — 품목 사양 'on'/'off' 가 생산 설정 기본값을 덮어쓴다 (Q9)
 *   한 장 탑뷰    품목마다 요청 한 장 — 하부장만 배치 그대로(위에서 본 모습) · 개수대 · 가스대 표시 · 전체 치수 (2026-11-05 사장님
 *                「끊김 위치는 표시할 필요 없어 · 재단은 업체에서 알아서」). 엔진이 끊긴 상판을 여러 행으로 내도(bomTopRunsOf) 한 장에 그리고,
 *                하부장 위 수납장이 선 칸만 「상판 없음」. 실제 상판 길이 합(topLength)은 수량 셈에.
 *   모델         싱크볼 · 수전 · 쿡탑 — 사양 sinkModelId · faucetModelId · cooktopModelId (appliance_models)
 *   뒷백 · 뒷선반  뒷백 = 뒷턱(백가드) · 뒷선반 = 벽 쪽 선반 따로 — 사양 topRearShelf · D · H (기본값 없음)
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

/** 옆면 — 사양이 없으면 몰딩 · 휠라 쪽은 벽, EP · 없음 쪽은 노출 (벽 아닌 쪽만 마감이 기본). 옆에 장(키큰장 · 하부장 위 수납장)이 붙으면 'cabinet' */
function sideOf(spec, finishType, cabinet = false) {
  if (spec === 'exposed' || spec === 'wall') return spec;
  if (cabinet) return 'cabinet';
  return finishType === 'Molding' || finishType === 'Filler' ? 'wall' : 'exposed';
}

const isOnTop = (m) => Boolean(m) && m.cabinetOnTop === true;

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
  // 품목 순번 = 엔진 partId 맨 앞 숫자. 간편 플래너 줄 부재는 `line|0-ep-top-0` (앞머리 line| 를 뗀다, 2026-11-05)
  const idxOf = (row, i) => {
    const idx = parseInt(String(row.partId || '').replace(/^line\|/, ''), 10);
    return Number.isInteger(idx) ? idx : i;
  };
  // 품목마다 한 장 (2026-11-05 사장님 「끊김 위치는 표시할 필요 없어 · 재단은 업체에서」) — 엔진이 끊긴 상판을 여러 행으로 내도 발주서는 한 장
  const byItem = new Map();
  rows.forEach((row, i) => {
    const k = idxOf(row, i);
    if (!byItem.has(k)) byItem.set(k, []);
    byItem.get(k).push(row);
  });
  return [...byItem.entries()].map(([idx, list], ri) => {
    const row = list[0];
    const item = items[idx] || items[ri] || {};
    const specs = item.specs || {};
    const modules = Array.isArray(item.modules) ? item.modules : [];
    const lower = modules.filter((m) => m && m.pos === 'lower' && m.type !== 'tall'); // 하부장만 — 키큰장은 상판이 안 지나간다
    const xsKnown = lower.length > 0 && lower.every((m) => num(m._x) !== null);
    const ordered = xsKnown ? [...lower].sort((a, b) => num(a._x) - num(b._x)) : lower;
    const thickness = num(row.thickness) || 12;
    const corner = isCornerItem(item);
    const topLength = Math.round(list.reduce((s2, r) => s2 + (num(r.w) || 0), 0));   // 실제 상판 길이 합 (BOM)

    // 탑뷰 하부장 배치 — 줄 왼쪽 끝(왼쪽 마감 포함)에서. 마감 폭은 플래너가 준 값(topFinishLeftW · RightW), 없으면 사양 좌 · 우 마감
    const leftFin = num(specs.topFinishLeftW) !== null ? num(specs.topFinishLeftW) : finW(specs.finishLeftType, specs.finishLeftWidth);
    const minX = xsKnown ? num(ordered[0]._x) : 0;
    let seq = 0;
    const planMods = ordered.map((m) => {
      const w = num(m.w) || 0;
      const x = leftFin + (xsKnown ? num(m._x) - minX : seq);
      seq += w;
      const kind = isOnTop(m) ? 'onTop' : isSinkModule(m) ? 'sink' : isCookModule(m) ? 'cook' : 'plain';
      return { x: Math.round(x), w: Math.round(w), kind, no: modules.indexOf(m) + 1, name: String(m.name || '').split(' — ')[0] };
    });
    const lineEnd = planMods.length ? Math.max(...planMods.map((m) => m.x + m.w)) : 0;
    const covered = planMods.filter((m) => m.kind !== 'onTop').reduce((s2, m) => s2 + m.w, 0);
    // 오른쪽 마감 — 플래너 값, 없으면 상판 길이 합에서 모듈 · 왼쪽 마감을 뺀 나머지 (예전 사양 · 엔진 상판 폭과 같은 셈)
    const rightFin = num(specs.topFinishRightW) !== null ? num(specs.topFinishRightW) : Math.max(0, topLength - covered - leftFin);
    const length = corner ? topLength : Math.round(lineEnd + rightFin);   // 전체 치수 — 상판 바깥 끝에서 끝
    // 그림 길이(칸 + 마감)와 BOM 상판 길이 합이 어긋나면 요청서에 [확인 필요] — 어느 쪽이 맞는지 지어내지 않는다
    const onTopW = planMods.filter((m) => m.kind === 'onTop').reduce((s2, m) => s2 + m.w, 0);
    const bomGap = corner || !planMods.length ? 0 : Math.round(length - onTopW - topLength);

    // 타공 — 줄 왼쪽 끝에서 모듈 중심. 코너 품목은 펼친 길이 기준
    const sinkModel = modelOf(models, specs.sinkModelId);
    const cookModel = modelOf(models, specs.cooktopModelId);
    const faucetModel = modelOf(models, specs.faucetModelId);
    const cutouts = [];
    planMods.forEach((m) => {
      if (m.kind === 'sink') cutouts.push({ kind: 'sink', label: '싱크볼', center: Math.round(m.x + m.w / 2), no: m.no, model: sinkModel });
      else if (m.kind === 'cook') cutouts.push({ kind: 'cooktop', label: '쿡탑', center: Math.round(m.x + m.w / 2), no: m.no, model: cookModel });
    });
    if (cutouts.some((c) => c.kind === 'sink')) {
      const dia = faucetModel && faucetModel.faucet ? faucetModel.faucet : sinkModel ? sinkModel.faucet : null;
      cutouts.push({ kind: 'faucet', label: '수전', center: null, at: '싱크볼 뒤 중앙', dia, model: faucetModel || null, sinkModel });
    }

    // 옆면 — 키큰장에 붙거나 줄 끝 모듈 위에 수납장이 서 있으면 「장 옆」
    const talls = modules.filter((m) => m && m.pos === 'lower' && m.type === 'tall' && num(m._x) !== null);
    const x0 = xsKnown ? minX : null;
    const x1 = xsKnown && ordered.length ? num(ordered[ordered.length - 1]._x) + (num(ordered[ordered.length - 1].w) || 0) : null;
    const tallAt = (x, left) => x !== null && talls.some((t) => Math.abs((left ? num(t._x) + (num(t.w) || 0) : num(t._x)) - x) <= 1);
    const cabinetLeft = tallAt(x0, true) || (planMods.length > 0 && planMods[0].kind === 'onTop');
    const cabinetRight = tallAt(x1, false) || (planMods.length > 0 && planMods[planMods.length - 1].kind === 'onTop');

    // 간편 플래너 코너 — 품목이 벽마다라(앱 품목 = 벽) 상판 줄 부재(line|)는 설계 전체 한 번. 하부장이 두 벽 이상이면 벽마다 모듈을 모으고
    //   그림은 플래너가 그려 보낸 탑뷰(plan 렌더)로 — 앱은 벽 사이 자리를 모른다 (2026-11-05)
    const plannerWalls = list.every((r) => /^line\|/.test(String(r.partId || ''))) ? items
      .map((it) => ({ it, lower: (Array.isArray(it.modules) ? it.modules : []).filter((m) => m && m.pos === 'lower' && m.type !== 'tall') }))
      .filter((x) => x.lower.length) : [];
    const multiWall = plannerWalls.length > 1;
    if (multiWall) {
      cutouts.length = 0;
      plannerWalls.forEach(({ it, lower }) => {
        const label = it.labelName || it.name || '';
        const mods = Array.isArray(it.modules) ? it.modules : [];
        lower.filter((m) => !isOnTop(m)).forEach((m) => {
          const no = mods.indexOf(m) + 1;
          if (isSinkModule(m)) cutouts.push({ kind: 'sink', label: '싱크볼', center: null, at: `${label} ${no}번 칸 가운데`, no, model: sinkModel });
          else if (isCookModule(m)) cutouts.push({ kind: 'cooktop', label: '쿡탑', center: null, at: `${label} ${no}번 칸 가운데`, no, model: cookModel });
        });
      });
      if (cutouts.some((c) => c.kind === 'sink')) {
        cutouts.push({ kind: 'faucet', label: '수전', center: null, at: '싱크볼 뒤 중앙', dia: faucetModel && faucetModel.faucet ? faucetModel.faucet : sinkModel ? sinkModel.faucet : null, model: faucetModel || null, sinkModel });
      }
    }
    const lipNa = thickness >= 50; // 50T 는 앞에서 이미 두껍다 — 앞턱(등뜨기) 해당 없음
    const rearOn = specs.topRearShelf === 'on' || specs.topRearShelf === true;
    const finishCode = row.finishCode || (/^TOP-/i.test(String(specs.topColor || '')) ? String(specs.topColor).toUpperCase() : null);
    return {
      index: idx,
      itemLabel: row.itemLabel || item.labelName || item.name || item.categoryId || `품목 ${ri + 1}`,
      material: row.material || '인조대리석',
      vendorKey: TOP_VENDOR_KEY[row.material] || 'topMarble',
      thickness,
      finishCode,
      length: multiWall ? topLength : length,
      topLength,
      bomGap: !multiWall && Math.abs(bomGap) > 1 ? bomGap : 0,
      depth: Math.round(num(row.h) || 0),
      shape: corner || multiWall ? 'corner' : 'straight',
      runs: corner ? runLengths(item) : [],
      plan: corner ? isoModel(item).boxes.filter((b) => !(b.m && (b.m.pos === 'upper' || b.m.type === 'tall'))).map((b) => ({
        x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, front: b.front, sink: isSinkModule(b.m), cook: isCookModule(b.m),
      })) : null,
      modules: corner || multiWall ? [] : planMods,
      ...(multiWall ? { walls: plannerWalls.map(({ it, lower }) => ({
        label: it.labelName || it.name || '',
        length: Math.round(lower.reduce((s2, m) => s2 + (num(m.w) || 0), 0)),
        mods: lower.map((m) => ({ no: (it.modules || []).indexOf(m) + 1, name: String(m.name || '').split(' — ')[0], w: Math.round(num(m.w) || 0), onTop: isOnTop(m) })),
      })) } : {}),
      finishW: { left: Math.round(leftFin), right: Math.round(rightFin) },
      cutouts,
      finishes: {
        // 뒷백 = 뒷턱(백가드) · 뒷선반 = 벽 쪽 선반 따로 (2026-11-05 사장님) — 뒷선반은 기본값 없이 적은 크기만
        backsplash: { on: toggle(specs.topBacksplash, def.backsplash), h: heightOr(specs.topBacksplashH, def.backsplashH) },
        rearShelf: { on: rearOn, d: rearOn ? num(specs.topRearShelfD) : null, h: rearOn ? num(specs.topRearShelfH) : null },
        frontLip: { na: lipNa, on: !lipNa && toggle(specs.topFrontLip, def.frontLip), h: heightOr(specs.topFrontLipH, def.frontLipH) },
        drip: { on: toggle(specs.topDrip, def.drip) },
        sideLeft: sideOf(specs.topSideLeft, specs.finishLeftType, cabinetLeft),
        sideRight: sideOf(specs.topSideRight, specs.finishRightType, cabinetRight),
      },
      modelIds: [specs.sinkModelId, specs.faucetModelId, specs.cooktopModelId].filter(Boolean),
    };
  });
}

/** 요청서에 필요한 가전 모델 id (인쇄 시점에 appliance_models 에서 읽는다) */
export function countertopModelIds(snapshot) {
  const items = (snapshot && snapshot.design_payload && Array.isArray(snapshot.design_payload.items)) ? snapshot.design_payload.items : [];
  return [...new Set(items.flatMap((it) => [it.specs && it.specs.sinkModelId, it.specs && it.specs.faucetModelId, it.specs && it.specs.cooktopModelId]).filter((v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)))];
}

/** 수량 한 줄 (외주 발주 · 보관함) */
export function countertopQty(reqs) {
  const list = reqs || [];
  if (!list.length) return { pieces: 0 };
  return {
    pieces: list.length,
    material: list[0].material,
    thickness: list[0].thickness,
    lengthMm: list.reduce((s, r) => s + (r.topLength || r.length), 0),
    cutouts: list.reduce((s, r) => s + r.cutouts.length, 0),
  };
}
