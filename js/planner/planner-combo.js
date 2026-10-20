// ============================================================
// 조합 캐비닛 — planner-combo.js (구조 페이지)
//
// ArchiWood "조합 캐비닛"(여러 장을 묶어 다시 쓰기). 2026-10-20 사장님 결정(카드): **복사·붙여넣기**,
// 이름 붙여 저장은 만들지 않는다 (결정 14 와 같은 방향).
//
//   📋 복사      모듈을 골랐으면 그 모듈 하나, 배치를 골랐으면 그 배치의 모듈 전부를 복사한다.
//                모듈에 붙은 좌·우 마감재(hostId)도 같이 간다. 구조 설정(도어·서랍·선반·비율·따내기)은
//                structures[id] 를 통째로 깊은 복사한다.
//   📌 붙여넣기  지금 고른 배치의 **첫 빈 자리**에 같은 순서·간격으로 놓는다. 폭이 모자라면 놓지 않는다.
//
// 복사하지 않는 것 — 다른 자리와 묶여 있어 옮기면 뜻이 없어진다:
//   멍장(m.blind, 코너 짝 배치에 묶임) · 냉장고 칸(m.fridgeNiche) · 가전 자리 표시(분배기·후드) ·
//   배치에 직접 놓은 마감재(hostId 없는 isFinishing — 배치 공간의 끝 마감이다).
//
// 클립보드는 sessionStorage 한 칸이다 (같은 탭이면 다른 품목의 플래너에도 붙는다). 막혀 있으면 메모리만 쓴다.
// 숫자 규칙을 새로 두지 않는다 — 깊이 상한은 구조 페이지의 addModuleToArea 와 같은 식(ctx.roomD)을 받는다.
//
// HTML 인라인은 버튼 두 개만 건다. 계산은 순수 함수 (DOM 없음) — __tests__/planner-combo.test.js.
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_COMBO_ / plannerCombo 접두.
// ============================================================

const PLANNER_COMBO_STORE_KEY = 'dadam.planner.combo.v1';

/** 복사 때 버리는 모듈 필드 — 자리·소속은 붙일 배치가 새로 정한다. */
const PLANNER_COMBO_DROP_KEYS = [
  'id',
  'areaId',
  'x',
  'y',
  'rotation',
  'hostId',
  '_srcIndex',
  'isDerived',
];

function plannerComboClone(o) {
  return JSON.parse(JSON.stringify(o));
}

/**
 * 이 모듈을 조합에 넣을 수 있는가.
 * @param {object} m
 * @param {(section:string)=>boolean} [isMarker] 가전 자리 표시 섹션인가
 */
function plannerComboCopyable(m, isMarker) {
  if (!m) return false;
  if (m.blind || m.fridgeNiche) return false;
  if (isMarker && isMarker(m.section)) return false;
  if (m.isFinishing && !m.hostId) return false;
  return true;
}

/**
 * 조합을 만든다. 순수 계산.
 *
 * @param {object[]} picked      복사할 본 모듈들 (마감재 제외 — 붙은 마감재는 allModules 에서 찾는다)
 * @param {object[]} allModules  페이지의 모듈 전부 (hostId 로 붙은 마감재 찾기)
 * @param {object}   structures  id → 구조
 * @param {object}   [opt]
 * @param {(section:string)=>boolean} [opt.isMarker]
 * @param {number}   [opt.originX] 기준 x (기본: 고른 것 중 가장 왼쪽)
 * @returns {{ok:boolean, reason?:string, combo?:object}}
 */
function plannerComboCopy(picked, allModules, structures, opt) {
  const o = opt || {};
  const body = (picked || []).filter((m) => !m.isFinishing && plannerComboCopyable(m, o.isMarker));
  if (!body.length) return { ok: false, reason: 'empty' };
  const bodyIds = new Set(body.map((m) => m.id));
  const fins = (allModules || []).filter(
    (m) => m && m.isFinishing && m.hostId && bodyIds.has(m.hostId)
  );
  const all = body.concat(fins);
  const minX = Number.isFinite(o.originX)
    ? o.originX
    : Math.min(...all.map((m) => Number(m.x) || 0));
  const maxR = Math.max(...all.map((m) => (Number(m.x) || 0) + (Number(m.W) || 0)));
  const indexOf = new Map(body.map((m, i) => [m.id, i]));
  const items = all.map((m) => {
    const fields = plannerComboClone(m);
    PLANNER_COMBO_DROP_KEYS.forEach((k) => delete fields[k]);
    fields.finishings = [];
    const s = structures && structures[m.id];
    return {
      relX: (Number(m.x) || 0) - minX,
      host: m.isFinishing ? indexOf.get(m.hostId) : null,
      fields,
      structure: s ? plannerComboClone(s) : null,
    };
  });
  return {
    ok: true,
    combo: {
      v: 1,
      span: maxR - minX,
      count: body.length,
      sections: Array.from(new Set(body.map((m) => m.section))),
      items,
    },
  };
}

/**
 * 붙여넣을 모듈·구조를 만든다. 순수 계산 — 호출 쪽이 modules·structures 에 넣는다.
 *
 * @param {object} combo
 * @param {object} area        {id, x, y, W, H, D, rotation}
 * @param {object} ctx
 * @param {{x:number,w:number}[]} ctx.freeSlots  배치의 빈 구간 (왼쪽→오른쪽)
 * @param {string[]} ctx.sections                이 배치에 넣을 수 있는 섹션
 * @param {(section:string)=>string} ctx.nextId  새 id (부를 때마다 달라야 한다)
 * @param {number} [ctx.roomD]                   몸통 깊이 상한 (배치 깊이 − 물끊기 − 도어 자리)
 * @returns {{ok:boolean, reason?:string, need?:number, room?:number, modules?:object[], structures?:object}}
 */
function plannerComboPaste(combo, area, ctx) {
  if (!combo || !Array.isArray(combo.items) || !combo.items.length) {
    return { ok: false, reason: 'empty' };
  }
  if (!area) return { ok: false, reason: 'no-area' };
  const c = ctx || {};
  const allowed = c.sections || [];
  const bad = combo.items.find(
    (it) => !it.fields.isFinishing && allowed.indexOf(it.fields.section) < 0
  );
  if (bad) return { ok: false, reason: 'section', section: bad.fields.section };
  const tooTall = combo.items.find(
    (it) => !it.fields.isFinishing && area.H && (Number(it.fields.H) || 0) > area.H + 0.5
  );
  if (tooTall) return { ok: false, reason: 'height', need: tooTall.fields.H, room: area.H };
  const need = Number(combo.span) || 0;
  const slot = (c.freeSlots || []).find((s) => s.w + 0.5 >= need);
  if (!slot) {
    const room = Math.max(0, ...(c.freeSlots || []).map((s) => s.w));
    return { ok: false, reason: 'width', need, room };
  }
  const out = [];
  const outStructures = {};
  const bodyIds = [];
  combo.items.forEach((it) => {
    const f = plannerComboClone(it.fields);
    const id = c.nextId(f.section);
    const m = Object.assign(f, {
      id,
      areaId: area.id,
      x: slot.x + it.relX,
      y: area.y || 0,
      rotation: area.rotation || 0,
      finishings: [],
    });
    if (!m.isFinishing && Number.isFinite(c.roomD) && c.roomD > 0) m.D = Math.min(m.D, c.roomD);
    if (it.host === null || it.host === undefined) bodyIds.push(id);
    out.push({ m, host: it.host });
    if (it.structure) outStructures[id] = plannerComboClone(it.structure);
  });
  out.forEach((e) => {
    if (e.host !== null && e.host !== undefined) e.m.hostId = bodyIds[e.host];
  });
  return { ok: true, modules: out.map((e) => e.m), structures: outStructures, x: slot.x };
}

/** 클립보드 — sessionStorage 가 막혀 있으면 메모리에만 둔다. */
let plannerComboMemory = null;
function plannerComboSave(combo, store) {
  plannerComboMemory = combo;
  try {
    const st = store || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    if (st) st.setItem(PLANNER_COMBO_STORE_KEY, JSON.stringify(combo));
  } catch (e) {
    /* 저장소가 막혀 있다 — 메모리 클립보드로 충분하다 */
  }
}
function plannerComboLoad(store) {
  try {
    const st = store || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    const raw = st ? st.getItem(PLANNER_COMBO_STORE_KEY) : null;
    if (raw) {
      const c = JSON.parse(raw);
      if (c && c.v === 1 && Array.isArray(c.items)) return c;
    }
  } catch (e) {
    /* 깨진 값이면 메모리 것을 쓴다 */
  }
  return plannerComboMemory;
}

if (typeof window !== 'undefined') {
  window.PlannerCombo = {
    copy: plannerComboCopy,
    paste: plannerComboPaste,
    save: plannerComboSave,
    load: plannerComboLoad,
    copyable: plannerComboCopyable,
  };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_COMBO_STORE_KEY,
    plannerComboCopy,
    plannerComboPaste,
    plannerComboSave,
    plannerComboLoad,
    plannerComboCopyable,
  };
}
