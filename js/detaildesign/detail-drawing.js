// ============================================================
// 2026-09-13: 디테일 단계 도면 저장 / 불러오기 — detail-drawing.js
//
// 배치(mockup-shell)·구조(mockup-structure)와 같은 공통 메뉴(js/planner/planner-drawing-menu.js)를
// 디테일 단계(BOM 화면) 우측 상단에 꽂는다. 이 단계만 저장하고 이 단계 저장본만 불러온다.
//
//   저장   — 품목마다 { specs, modules } 를 planner_snapshots(stage 'detail') 에 이름 붙여 남긴다.
//            설계가 아직 저장되지 않았으면 saveDesign() 으로 설계를 먼저 저장한다 (같은 페이지라 부탁할 필요가 없다).
//   불러오기 — 같은 설계면 그 품목(unique_id)에, 다른 설계 것이면 지금 보는 품목에 되쓴다.
//            저장하지는 않는다 — 마음에 안 들면 저장하지 않고 되돌릴 수 있어야 한다. '수정됨' 으로 표시한다.
//
// ⚠ 클래식 스크립트 — 최상위 이름은 detailDrawing 접두. ui-step1.js·persistence-init.js 의 전역
//   (selectedItems, currentDesignId, saveDesign, _currentStep2Item, updateUI …)을 런타임에 쓴다.
// ============================================================

/** 디테일 스냅샷 한 벌을 품목에 되쓴다 (DADAM_RESTORE_DETAIL 과 같은 규칙 — 저장은 하지 않는다). */
function applyDetailSnapshotToItem(item, specs, modules) {
  if (!item) return false;
  if (specs) item.specs = specs;
  if (Array.isArray(modules)) item.modules = modules;
  if (typeof updateUI === 'function') updateUI();
  try {
    hasUnsavedChanges = true;
    if (typeof updateSaveStatus === 'function') updateSaveStatus('saving', '복원됨 — 저장 필요');
  } catch (e) { /* 저장 상태 표시는 없어도 복원 자체는 끝났다 */ }
  return true;
}

function detailDrawingCurrentItem() {
  if (typeof _currentStep2Item === 'function') return _currentStep2Item();
  return (typeof selectedItems !== 'undefined' && selectedItems[0]) || null;
}

function detailDrawingIds() {
  const it = detailDrawingCurrentItem();
  return {
    designId: (typeof currentDesignId !== 'undefined' && currentDesignId) ? currentDesignId : null,
    itemId: it ? Math.floor(it.uniqueId) : null,
  };
}

function detailDrawingToast(text) {
  if (typeof showToast === 'function') showToast(text);
  else if (typeof alert === 'function') alert(text);
}

async function detailDrawingSave(name) {
  if (typeof currentDesignId === 'undefined' || !currentDesignId) {
    if (typeof saveDesign !== 'function') return { ok: false, reason: 'no-scope' };
    await saveDesign();   // 이름을 묻는다. 취소하면 currentDesignId 가 그대로 비어 있다
    if (!currentDesignId) return { ok: false, reason: 'no-scope', message: '설계 저장을 취소했습니다' };
  }
  const items = (typeof selectedItems !== 'undefined' ? selectedItems : []).filter((it) => Number.isFinite(Math.floor(it.uniqueId)));
  if (!items.length) return { ok: false, reason: 'empty', message: '저장할 품목이 없습니다' };
  let last = null;
  for (const it of items) {
    last = await PlannerStore.save('detail', {
      name,
      ids: { designId: currentDesignId, itemId: Math.floor(it.uniqueId) },
      payload: { specs: it.specs || {}, modules: it.modules || [] },
    });
    if (!last.ok) return last;
  }
  return last;
}

async function detailDrawingPick(id) {
  const r = await PlannerStore.loadAny(id, 'detail');   // 디테일 저장본만. detail 은 되쓸 localStorage 키가 없다 — payload 만 받는다
  if (!r.ok) throw new Error(r.message || r.reason);
  const row = r.row || {};
  const sameDesign = typeof currentDesignId !== 'undefined' && currentDesignId && row.design_id === currentDesignId;
  const items = typeof selectedItems !== 'undefined' ? selectedItems : [];
  const target = (sameDesign && items.find((it) => Math.floor(it.uniqueId) === Number(row.item_unique_id)))
    || detailDrawingCurrentItem();
  if (!target) throw new Error('되쓸 품목이 없습니다');
  applyDetailSnapshotToItem(target, row.payload && row.payload.specs, row.payload && row.payload.modules);
  if (typeof proceedToBOM === 'function') { try { proceedToBOM(); } catch (e) {} }   // 표를 다시 산출한다
  detailDrawingToast(`📥 "${target.name || target.labelName || '품목'}" 의 디테일을 되돌렸습니다 — 확인 후 저장하세요`);
}

function initDetailDrawingMenu() {
  if (typeof mountPlannerDrawingMenu !== 'function') return null;
  const btn = document.getElementById('detailLoadBtn');
  const menu = document.getElementById('detailLoadMenu');
  if (!btn || !menu) return null;
  return mountPlannerDrawingMenu({
    stage: 'detail',
    btn,
    menu,
    saveBtn: document.getElementById('detailSaveBtn'),
    toast: detailDrawingToast,
    ids: detailDrawingIds,
    pick: detailDrawingPick,
    save: detailDrawingSave,
  });
}

if (typeof window !== 'undefined') {
  window.applyDetailSnapshotToItem = applyDetailSnapshotToItem;
  window.initDetailDrawingMenu = initDetailDrawingMenu;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDetailDrawingMenu);
    else initDetailDrawingMenu();
  }
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { applyDetailSnapshotToItem, detailDrawingIds, detailDrawingSave, detailDrawingPick, initDetailDrawingMenu };
}
