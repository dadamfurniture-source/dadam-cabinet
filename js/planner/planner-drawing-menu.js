// ============================================================
// 2026-09-13: 도면 저장 / 도면 불러오기 — 배치·구조·디테일 공통 메뉴 (planner-drawing-menu.js)
//
// 세 단계가 각자 다른 자리·다른 모양으로 갖고 있던 것을 하나로 모았다.
//   · 우측 상단에 [📥 도면 불러오기 ▾] [💾 도면 저장] 두 버튼
//   · 저장은 **그 단계**만 저장한다 (배치 단계에서는 배치, 구조 단계에서는 구조, 디테일은 디테일)
//   · 불러오기도 **그 단계**의 저장본만 보여 준다 — 범위는 '이 품목' / '내 모든 설계'
//   · 저장·목록·되쓰기의 정본은 planner-store.js. 이 파일은 메뉴 그리기와 흐름만 맡는다.
//
// 페이지가 넘기는 것 (mountPlannerDrawingMenu(opts)):
//   stage        'layout' | 'structure' | 'detail'
//   btn / menu   불러오기 버튼과 드롭다운 컨테이너 (요소)
//   saveBtn      저장 버튼 (요소, 없어도 된다)
//   toast(text)  알림
//   ids()        선택 — 스코프 {designId, itemId}. detaildesign 은 URL 에 스코프가 없어 넘긴다
//   localRow()   선택 — 계정과 무관한 첫 줄 (배치 단계의 "이 브라우저 마지막 저장")
//                → { label, meta, apply() } | null
//   pick(row, origin) 되쓴 뒤 화면을 어떻게 갱신할지 (async). 확인창은 여기서 띄운다
//   save(name)   그 단계 저장 (async → {ok, reason, message})
//   onNoScope(name) 선택 — 설계 미저장이면 부모에 설계 저장을 부탁하는 등 (true 를 돌려주면 안내만)
//
// ⚠ 클래식 스크립트 — 최상위 이름이 전역 렉시컬 스코프에 들어간다. 이름은 전부 plannerDrawing 접두.
// ============================================================

const PLANNER_DRAWING_MENU_CSS = `
.pdm-wrap{position:relative;display:flex;align-items:center;gap:6px}
.pdm-btn{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border:1px solid var(--brand-mid,#b8956c);background:#fff;color:var(--brand-deep,#6a4b2a);border-radius:6px;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.pdm-btn:hover{background:var(--brand-soft,#f3ead9)}
.pdm-btn .pdm-caret{font-size:9px;opacity:.7}
.pdm-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:400;width:360px;max-height:60vh;overflow-y:auto;background:#fff;border:1px solid var(--line,#e5e0d4);border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.12);padding:6px;font-size:11.5px;text-align:left;color:var(--text,#2b2620)}
.pdm-menu .pdm-stage{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:4px 8px 2px;font-weight:700;color:var(--brand-deep,#6a4b2a)}
.pdm-menu .pdm-stage button{border:1px solid var(--line,#e5e0d4);background:transparent;color:var(--brand-deep,#6a4b2a);padding:2px 8px;border-radius:4px;font-size:10.5px;cursor:pointer}
.pdm-menu .pdm-stage button:hover:not(:disabled){background:var(--brand-soft,#f3ead9)}
.pdm-menu .pdm-stage button:disabled{opacity:.4;cursor:not-allowed}
.pdm-menu .pdm-scope{display:flex;gap:4px;padding:2px 8px 6px}
.pdm-menu .pdm-scope button{border:1px solid var(--line,#e5e0d4);background:transparent;padding:2px 9px;border-radius:999px;font-size:10.5px;cursor:pointer;color:var(--text-dim,#7a7062)}
.pdm-menu .pdm-scope button.on{background:var(--brand-deep,#6a4b2a);border-color:var(--brand-deep,#6a4b2a);color:#fff}
.pdm-menu .pdm-scope button:disabled{opacity:.4;cursor:not-allowed}
.pdm-menu .pdm-row{display:block;width:100%;text-align:left;border:none;background:transparent;padding:6px 9px;border-radius:4px;cursor:pointer;font-size:11.5px;color:var(--text,#2b2620);font-family:inherit}
.pdm-menu .pdm-row:hover{background:var(--brand-soft,#f3ead9)}
.pdm-menu .pdm-row .pdm-meta{display:block;font-size:10.5px;color:var(--text-faint,#a89c84);margin-top:1px}
.pdm-menu .pdm-row .pdm-origin{color:var(--brand-deep,#6a4b2a)}
.pdm-menu .pdm-empty{padding:6px 9px 10px;font-size:11px;color:var(--text-faint,#a89c84)}
.pdm-menu .pdm-sep{height:1px;background:var(--line,#e5e0d4);margin:5px 2px}
.pdm-menu .pdm-note{padding:9px;font-size:11px;color:var(--text-dim,#7a7062);line-height:1.55}
`;

function plannerDrawingInjectCss() {
  if (typeof document === 'undefined' || document.getElementById('planner-drawing-menu-css')) return;
  const st = document.createElement('style');
  st.id = 'planner-drawing-menu-css';
  st.textContent = PLANNER_DRAWING_MENU_CSS;
  document.head.appendChild(st);
}

function plannerDrawingEsc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 저장소를 못 쓰는 이유를 사람 말로. 이유마다 할 일이 다르다. */
function plannerDrawingExcuse(reason) {
  if (reason === 'no-scope') {
    return '이 설계는 아직 저장되지 않았습니다. 도면 저장을 누르면 설계를 먼저 저장한 뒤 이어서 저장합니다. '
         + '불러오기는 "내 모든 설계" 에서 됩니다.';
  }
  if (reason === 'no-item') {
    return "품목이 아직 없습니다. 좌측 '품목' 아이콘으로 품목을 먼저 추가하면 그 품목의 도면으로 저장됩니다. "
         + '불러오기는 "내 모든 설계" 에서 됩니다.';
  }
  if (reason === 'no-session') return '로그인하면 계정에 저장하고 불러올 수 있습니다.';
  if (reason === 'no-sdk') return '이 화면에서는 계정 저장을 쓸 수 없습니다.';
  if (reason === 'stage-mismatch') return '다른 단계의 도면입니다. 배치·구조·디테일 도면은 저장한 단계에서만 불러올 수 있습니다.';
  return '';
}

/**
 * @param {object} o  위 주석 참고
 * @returns {{ render: Function, saveNamed: Function, close: Function }}
 */
function mountPlannerDrawingMenu(o) {
  plannerDrawingInjectCss();
  const stage = o.stage;
  const btn = o.btn, menu = o.menu;
  const toast = typeof o.toast === 'function' ? o.toast : function () {};
  const label = (typeof PLANNER_STAGE_LABEL !== 'undefined' && PLANNER_STAGE_LABEL[stage]) || stage;
  const esc = plannerDrawingEsc;
  let scope = 'item';

  function idsNow() {
    if (typeof o.ids === 'function') return o.ids() || {};
    return (typeof plannerScopeIds === 'function') ? plannerScopeIds() : {};
  }

  function rowHTML(r, ids) {
    const name = r.is_autosave ? '자동 저장' : (r.name || '이름 없음');
    const when = (typeof plannerSnapshotWhen === 'function') ? plannerSnapshotWhen(r.updated_at || r.created_at) : '';
    const sum = (typeof plannerSnapshotSummary === 'function') ? plannerSnapshotSummary(stage, r.payload) : '';
    const origin = (typeof plannerSnapshotOrigin === 'function') ? plannerSnapshotOrigin(r, ids) : '';
    return `<button type="button" class="pdm-row" data-snap="${esc(r.id)}" data-stage="${esc(stage)}">${esc(name)}`
      + `<span class="pdm-meta">${esc(when)}${sum ? ' · ' + esc(sum) : ''}`
      + (origin ? ` · <span class="pdm-origin">${esc(origin)}</span>` : '') + `</span></button>`;
  }

  async function render() {
    menu.innerHTML = '<div class="pdm-note">불러오는 중…</div>';
    const parts = [];
    // ① 계정과 무관한 첫 줄 (배치 단계: 이 브라우저 마지막 저장)
    // localRow 를 넘긴 단계(배치)만 이 구역이 있다. 안 넘겼으면(구조·디테일) 통째로 없다.
    const hasLocal = typeof o.localRow === 'function';
    const local = hasLocal ? o.localRow() : null;
    if (hasLocal) {
      parts.push('<div class="pdm-stage"><span>이 브라우저</span></div>');
      parts.push(local
        ? `<button type="button" class="pdm-row" data-local="1">${esc(local.label)}<span class="pdm-meta">${esc(local.meta || '')}</span></button>`
        : `<div class="pdm-empty">이 브라우저에 저장된 ${esc(label)} 도면이 없습니다</div>`);
      parts.push('<div class="pdm-sep"></div>');
    }
    // ② 계정
    const hasStore = typeof PlannerStore !== 'undefined';
    const ids = idsNow();
    const ready = hasStore ? await PlannerStore.ready(ids.designId !== undefined ? ids : undefined) : { ok: false, reason: 'no-sdk' };
    const noScope = !ready.ok && (ready.reason === 'no-scope' || ready.reason === 'no-item');
    const ses = (hasStore && noScope) ? await PlannerStore.session() : null;
    const canList = ready.ok || !!(ses && ses.ok);
    if (!ready.ok && scope === 'item' && canList) scope = 'all';
    parts.push(`<div class="pdm-stage"><span>계정에 저장된 ${esc(label)}</span>`
      + `<button type="button" data-save="1"${(ready.ok || ready.reason === 'no-scope') ? '' : ' disabled title="' + esc(plannerDrawingExcuse(ready.reason)) + '"'}>현재 ${esc(label)} 저장…</button></div>`);
    parts.push('<div class="pdm-scope">'
      + `<button type="button" data-scope="item" class="${scope === 'item' ? 'on' : ''}"${ready.ok ? '' : ' disabled'}>이 품목</button>`
      + `<button type="button" data-scope="all" class="${scope === 'all' ? 'on' : ''}"${canList ? '' : ' disabled'}>내 모든 설계</button></div>`);
    if (!canList) {
      // 설계 미저장(no-scope)이면서 로그인도 안 돼 있으면 로그인 안내가 맞는 말이다
      const why = (ses && !ses.ok) ? ses.reason : ready.reason;
      parts.push(`<div class="pdm-note">${esc(plannerDrawingExcuse(why))}</div>`);
    } else {
      if (noScope) parts.push(`<div class="pdm-note">${esc(plannerDrawingExcuse(ready.reason))}</div>`);
      const list = scope === 'all' ? await PlannerStore.listAll(stage) : await PlannerStore.list(stage, 20, ids);
      const rows = list.rows || [];
      parts.push(rows.length ? rows.map((r) => rowHTML(r, ids)).join('')
        : `<div class="pdm-empty">${scope === 'all' ? `계정에 저장된 ${esc(label)} 도면이 없습니다` : `이 품목에 저장된 ${esc(label)} 도면이 없습니다`}</div>`);
    }
    menu.innerHTML = parts.join('');
    const localBtn = menu.querySelector('[data-local]');
    if (localBtn && local) localBtn.onclick = (e) => { e.stopPropagation(); close(); local.apply(); };
    const saveEl = menu.querySelector('[data-save]');
    if (saveEl) saveEl.onclick = (e) => { e.stopPropagation(); saveNamed(); };
    menu.querySelectorAll('[data-scope]').forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); scope = el.dataset.scope; render(); };
    });
    menu.querySelectorAll('[data-snap]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        close();
        const originEl = el.querySelector('.pdm-origin');
        pickSnapshot(el.dataset.snap, originEl ? originEl.textContent : '');
      };
    });
  }

  /**
   * 불러오기는 **파괴적**이다 — 지금 그린 것을 덮어쓴다. 확인을 받고 페이지에 넘긴다.
   * 되쓰기·자동 저장 한 벌 남기기·화면 갱신은 페이지(o.pick)가 한다 — 단계마다 다르다.
   */
  async function pickSnapshot(id, origin) {
    const what = origin ? `다른 설계의 ${label}(${origin})` : `저장된 ${label} 도면`;
    if (!confirm(`${what}을(를) 불러옵니다.\n\n지금 화면의 ${label} 내용은 덮어씁니다.\n(계정에 저장할 수 있는 상태면 현재 상태를 자동 저장으로 한 벌 남깁니다.)\n\n계속하시겠습니까?`)) return;
    try {
      await o.pick(id, origin);
    } catch (e) {
      toast('⚠ 불러오기 실패: ' + (e && e.message ? e.message : e));
    }
  }

  async function saveNamed() {
    const name = prompt(`${label} 도면 이름:`, `${label} ${new Date().toLocaleString('ko-KR')}`);
    if (!name) return null;
    let r;
    try { r = await o.save(name); } catch (e) { r = { ok: false, reason: 'error', message: e && e.message }; }
    if (!r) return null;
    if (!r.ok && r.reason === 'no-scope' && typeof o.onNoScope === 'function' && o.onNoScope(name)) {
      toast('설계가 아직 저장되지 않았습니다 — 먼저 설계를 저장합니다 (이름을 입력하세요)');
      return r;
    }
    toast(r.ok ? `💾 ${label} 저장 완료 — ${name}`
               : `⚠ 저장 실패: ${r.message || plannerDrawingExcuse(r.reason) || r.reason}`);
    if (r.ok && !menu.hidden) render();
    return r;
  }

  function close() { menu.hidden = true; }

  if (btn && menu) {
    btn.onclick = (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      if (!menu.hidden) render();
    };
    document.addEventListener('click', (e) => {
      if (menu.hidden) return;
      if (!menu.contains(e.target) && e.target !== btn) menu.hidden = true;
    });
  }
  if (o.saveBtn) o.saveBtn.onclick = () => saveNamed();

  return { render, saveNamed, close };
}

if (typeof window !== 'undefined') {
  window.mountPlannerDrawingMenu = mountPlannerDrawingMenu;
  window.plannerDrawingExcuse = plannerDrawingExcuse;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mountPlannerDrawingMenu, plannerDrawingExcuse, PLANNER_DRAWING_MENU_CSS };
}
