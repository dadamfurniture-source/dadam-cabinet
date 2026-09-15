/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module, __dirname */
/**
 * C1a: BOM 부재 목록 — 같은 플래너 상태를 **실제 경로**로 BOM 까지 흘려 정규화한다.
 * (docs/01-plan/detail-bom-deepening.plan.md §4.5 · §5 C1a) 3D 쪽 절반은 `scene-parts.js`.
 *
 * 경로 (브라우저와 같다):
 *   플래너 `buildPlannerPayload('PLANNER_DONE')`
 *     → ui-step1.js `_convertPlannerModules(payload, specs)`  (셀 = 제작 모듈, 멍장 = corner-blind-*)
 *     → `MaterialExtractor.extract({ items:[item] })`         (B1: 모든 행에 partId · slot)
 *
 * ui-step1.js 는 전역 스크립트라 planner-to-bom.test.js 와 같은 방식으로 변환 블록만 잘라 평가한다.
 *
 * 정규화 행:
 *   { moduleId, bomModuleId, cell, part, partKey, family, slot, material, thickness, w, h, a, b, t, qty }
 *     moduleId     **플래너 모듈 id** (lower-0 …). BOM 셀 모듈 `planner-lower-0-2` 는 lower-0 의 셀 2 로 접는다.
 *                  멍장 `corner-blind-lower[-k]` 는 payload 순서의 k 번째 멍장 플래너 모듈로 되돌린다.
 *                  품목 단위 행(상몰딩·걸레받이·좌우 마감)은 'ep'.
 *     partKey      B1 partId 의 가운데 조각. id 에 '-' 가 있어 쪼개 읽지 않고, **아는 모듈 id 로 접두어를 벗긴다**.
 *     family       partKey 에서 `#k` 를 뗀 종류 이름 (door · shelf · body:side …) — 3D 쪽과 같은 이름.
 *     a ≥ b · t    판 두 변(큰 순)과 두께 — 3D 와 순서 없는 쌍으로 비교하기 위해.
 *   같은 (moduleId, family, a, b, t) 는 qty 로 합친다.
 */
const fs = require('fs');
const path = require('path');
const { loadExtractors } = require('./bom-golden/golden');

const ROOT = path.join(__dirname, '..');

let converter = null;
/** ui-step1.js 의 플래너→상세설계 변환 블록 (planner-to-bom.test.js 와 같은 절단). */
function loadConverter() {
  if (converter) return converter;
  const SRC = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
  const start = SRC.indexOf('const PLANNER_CABINET_SECTIONS');
  const end = SRC.indexOf('function _applyPlannerResult');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('변환 함수 블록을 찾지 못했습니다 — ui-step1.js 구조가 바뀌었는지 확인하세요.');
  }
  converter = new Function(`${SRC.slice(start, end)}; return { _convertPlannerModules, PLANNER_CABINET_SECTIONS };`)();
  return converter;
}

/**
 * 상세설계 품목 스펙 — data-constants.js DEFAULT_SPECS 의 싱크대 부분 그대로 (플래너는 이 값으로 태어난 품목에 붙는다).
 * 좌·우 마감 Filler 60 도 기본값이다: 도면에 마감재를 안 그려도 BOM 은 스펙에서 낸다 — 그 어긋남도 원장이 드러내야 한다.
 */
const LEDGER_SPECS = {
  layoutShape: 'I',
  doorColorUpper: '화이트', doorFinishUpper: '무광',
  doorColorLower: '화이트', doorFinishLower: '무광',
  topThickness: 12,
  bodyThickness: 15,
  lowerTotalH: 870, upperTotalH: 780,
  upperH: 720, lowerH: 870,
  moldingH: 60,
  sinkLegHeight: 150,
  handle: '찬넬 (목찬넬)',
  finishLeftType: 'Filler', finishLeftWidth: 60,
  finishRightType: 'Filler', finishRightWidth: 60,
  finishCorner1Type: 'Filler', finishCorner1Width: 60,
  finishCorner2Type: 'Filler', finishCorner2Width: 60,
  upperDoorOverlap: 15,
};

/**
 * BOM 모듈 id → 플래너 모듈 id 표.
 * `_convertPlannerModules` 는 출처 id 를 남기지 않으므로 그 규칙을 여기서 되짚는다
 * (셀: `planner-${id}-${i}`, 멍장: pos 별 순번 `corner-blind-${pos}[-${seq+1}]`).
 */
function bomModuleMapOf(payload) {
  const { PLANNER_CABINET_SECTIONS } = loadConverter();
  const map = { ep: { moduleId: 'ep', cell: null } };
  const blindSeq = { lower: 0, upper: 0 };
  (payload.modules || []).forEach((m) => {
    if (PLANNER_CABINET_SECTIONS.indexOf(m.section) < 0) return;
    const pos = m.section === 'upper' ? 'upper' : 'lower';
    if (m.blind) {
      const seq = blindSeq[pos]++;
      const id = seq === 0 ? `corner-blind-${pos}` : `corner-blind-${pos}-${seq + 1}`;
      map[id] = { moduleId: String(m.id), cell: null, blind: true };
      return;
    }
    const widths = payload.structures && payload.structures[m.id] && payload.structures[m.id].areaWidths;
    const n = Array.isArray(widths) && widths.length ? widths.length : 1;
    for (let i = 0; i < n; i++) map[`planner-${m.id}-${i}`] = { moduleId: String(m.id), cell: i };
  });
  return map;
}

/** partId `${itemIdx}-${moduleId}-${partKey}-${n}` 을 아는 모듈 id 로 벗겨 partKey 를 얻는다. */
function partKeyOfPartId(partId, itemIdx, knownIds) {
  const s = String(partId || '');
  const head = `${itemIdx}-`;
  if (s.indexOf(head) !== 0) return null;
  const rest = s.slice(head.length);
  let best = null;
  knownIds.forEach((id) => {
    if (rest.indexOf(id + '-') === 0 && (!best || id.length > best.length)) best = id;
  });
  if (!best) return null;
  const tail = rest.slice(best.length + 1);
  return { moduleId: best, partKey: tail.replace(/-\d+$/, '') };
}

function familyOfBomKey(partKey) {
  return partKey ? String(partKey).split('#')[0] : null;
}

/**
 * 부팅된 플래너 상태를 BOM 까지 흘려 정규화 부재 목록을 낸다.
 * @param {object} p       scene-parts.js bootPlanner3D 가 돌려준 하네스
 * @param {{ specs?: object, category?: string }} [opts]
 */
function collectBomParts(p, opts = {}) {
  const payload = p.g('buildPlannerPayload')('PLANNER_DONE');
  const specs = Object.assign({}, LEDGER_SPECS, opts.specs || {});
  const { modules, warnings } = loadConverter()._convertPlannerModules(payload, specs);
  const areas = (p.g('areas') || []).filter((a) => !a.isFinishing);
  const item = {
    categoryId: opts.category || 'sink',
    w: Math.round(areas.reduce((s, a) => Math.max(s, (a.x || 0) + (a.W || 0)), 0)),
    h: 2310,
    d: Math.round(areas.reduce((s, a) => Math.max(s, a.D || 0), 0)) || 650,
    specs,
    modules,
  };
  const { MaterialExtractor } = loadExtractors();
  const out = new MaterialExtractor().extract({ appVersion: 'ledger', items: [item] });

  const idMap = bomModuleMapOf(payload);
  const knownIds = Object.keys(idMap).concat(modules.map((m) => String(m.id)));
  const merged = new Map();
  const order = [];
  out.materials.forEach((row) => {
    const pk = partKeyOfPartId(row.partId, 0, knownIds);
    if (!pk) throw new Error(`partId 를 해석하지 못했습니다: ${row.partId} (${row.module} · ${row.part})`);
    const src = idMap[pk.moduleId] || { moduleId: pk.moduleId, cell: null };
    const family = familyOfBomKey(pk.partKey);
    const w = Math.round(row.w), h = Math.round(row.h);
    const a = Math.max(w, h), b = Math.min(w, h), t = row.thickness;
    const key = `${src.moduleId}|${family}|${a}|${b}|${t}`;
    if (merged.has(key)) {
      const r = merged.get(key);
      r.qty += row.qty;
      if (r.parts.indexOf(row.part) < 0) r.parts.push(row.part);
      return;
    }
    const r = {
      moduleId: src.moduleId,
      bomModuleId: pk.moduleId,
      cell: src.cell,
      part: row.part,
      parts: [row.part],
      partKey: pk.partKey,
      family,
      slot: row.slot,
      material: row.material,
      thickness: t,
      w, h, a, b, t,
      qty: row.qty,
    };
    merged.set(key, r);
    order.push(r);
  });
  return { parts: order, materials: out.materials, modules, warnings, payload, item };
}

module.exports = {
  LEDGER_SPECS,
  loadConverter,
  bomModuleMapOf,
  partKeyOfPartId,
  familyOfBomKey,
  collectBomParts,
};
