// ============================================================
// D0: 디테일 모드 — planner-detail.js (구조 페이지 전용)
//
// 🎨 3.디테일 버튼은 여태 **핸들러가 없었다** (계획 §1.1). 디테일 단계 화면이 없어
// 색·마감은 상세설계의 상/하 두 값으로만 정해졌다.
//
// 별도 페이지를 만들지 않는다 (계획 §4.1). 부재 피킹(raycaster + userData.entityKind)과
// 3D 씬이 이미 mockup-structure.html 에 있으므로, 그 페이지 안의 **모드**로 시작한다:
//   · 🎨 버튼 또는 ?stage=detail → enter(). 다시 누르면 exit().
//   · 모드에서는 (a) 좌측이 마감 팔레트로 바뀌고 (b) 3D 부재를 누르면 고른 마감을 그 부재에
//     칠하며 (c) renderAll3D 뒤에 부재 색을 카탈로그 hex 로 덮는다 (paintScene).
//   · 모드 밖에서는 **아무것도 하지 않는다** — 구조 단계 화면·피킹 색은 그대로다 (I2).
//
// 상태의 정본은 planner-finish.js 의 모델 하나(this.detail)다. 이 파일은 그 모델을
// 저장소(dadam_detail_v1, 스코프 키)와 화면(팔레트·카드·3D) 사이에서 나른다.
//   저장:  localStorage → plannerAutosave('detail') → 부모에 PLANNER_DETAIL_CHANGE
//   (부모(detaildesign)가 아직 안 받아도 무해하다 — 받는 쪽은 D1, Design UI 도메인)
//   되돌리기: JSON 사본 10장 (undoStack)
//
// 카탈로그: window.DadamBomFinishColor (js/detaildesign/bom-finish-color.js 를 script 로 싣는다).
//   없으면 planner-finish.js 의 폴백(같은 코드)으로 간다 — 팔레트 머리에 "폴백" 을 표시한다.
//
// 페이지가 넘기는 것 (PlannerDetail.mount(o)):
//   modules()        지금 모듈 목록 (섹션을 알기 위해)
//   renderAll3D(opt) 3D 다시 그리기 — 모드 진입·이탈·칠하기 뒤에 부른다
//   toast(text)      알림
//   sectionLabel(s)  섹션 → 사람이 읽는 이름 (없으면 섹션 키 그대로)
//
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_DETAIL_ / plannerDetail / PlannerDetail 접두.
//   HTML 인라인은 mount 와 두 훅(handleEntityClick → pickMesh, renderAll3D → paintScene)만 건다.
// ============================================================

/** 저장 키 base. planner-store.js 의 PLANNER_STAGE_KEYS.detail.detail 과 같은 값이어야 한다. */
const PLANNER_DETAIL_KEY_BASE = 'dadam_detail_v1';
const PLANNER_DETAIL_UNDO_MAX = 10;
const PLANNER_DETAIL_AUTOSAVE_MS = 1500;

const PLANNER_DETAIL_CSS = `
/* 모드 스위치 — body.detail-mode 하나로 좌·우 패널과 상단 메뉴가 바뀐다.
   applyPanelLayout 이 섹션에 인라인 display 를 쓰므로 !important 로 이긴다. */
#detailPalette{display:none;flex:1;min-height:0;overflow-y:auto;flex-direction:column;gap:8px;padding:8px 8px 12px;font-size:11px;color:var(--text,#2b2620)}
body.detail-mode #detailPalette{display:flex}
body.detail-mode #mlBody,body.detail-mode .ml-mode-toggle{display:none}
body.detail-mode #rightPanel .section[data-sec]:not([data-sec="detail"]){display:none!important}
body.detail-mode #rightPanel .section[data-sec="detail"]{display:block!important}
.pd-only{display:none}
body.detail-mode .pd-only{display:inline-flex}
body.detail-mode #loadDrawingBtn,body.detail-mode #saveDrawingBtn{display:none}
.pd-head{display:flex;align-items:baseline;justify-content:space-between;gap:6px;font-weight:700;color:var(--brand-deep,#6a4b2a)}
.pd-head .pd-src{font-size:10px;font-weight:500;color:var(--text-faint,#a89c84)}
.pd-sel{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid var(--line,#e5e0d4);border-radius:6px;background:#fff;min-height:30px}
.pd-sel .pd-chip{width:16px;height:16px;border-radius:4px;border:1px solid rgba(0,0,0,.25);flex-shrink:0}
.pd-sel code{font-size:10px;color:var(--text-dim,#7a7062)}
.pd-label{font-size:10px;font-weight:600;color:var(--text-dim,#7a7062);margin-top:2px}
.pd-slots,.pd-bulk{display:flex;flex-wrap:wrap;gap:4px}
.pd-slots button,.pd-bulk button,.pd-tools button,.pd-card-actions button{border:1px solid var(--line,#e5e0d4);background:#fff;color:var(--text,#2b2620);padding:3px 8px;border-radius:999px;font-size:10.5px;cursor:pointer;font-family:inherit}
.pd-slots button.on{background:var(--brand-deep,#6a4b2a);border-color:var(--brand-deep,#6a4b2a);color:#fff}
.pd-bulk button:disabled,.pd-tools button:disabled,.pd-card-actions button:disabled{opacity:.4;cursor:not-allowed}
.pd-hint{font-size:10px;color:var(--text-faint,#a89c84);line-height:1.5}
.pd-tools{display:flex;align-items:center;justify-content:space-between;gap:6px}
.pd-group-title{font-size:10.5px;font-weight:600;color:var(--text-dim,#7a7062);margin:4px 0 3px}
.pd-swatches{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.pd-swatch{position:relative;height:26px;border-radius:5px;border:1px solid rgba(0,0,0,.2);cursor:pointer;padding:0;font-family:inherit}
.pd-swatch:hover{transform:translateY(-1px)}
.pd-swatch.on{outline:2px solid var(--pick,#1d6fe0);outline-offset:1px}
.pd-swatch .pd-code{position:absolute;left:0;right:0;bottom:1px;font-size:7.5px;text-align:center;color:rgba(0,0,0,.55);mix-blend-mode:multiply;pointer-events:none}
.pd-swatch.dark .pd-code{color:rgba(255,255,255,.75);mix-blend-mode:normal}
.pd-card{display:flex;flex-direction:column;gap:6px;font-size:11px}
.pd-card-title{font-weight:700;color:var(--brand-deep,#6a4b2a)}
.pd-card-row{display:flex;align-items:center;gap:6px}
.pd-card-row .pd-chip{width:18px;height:18px;border-radius:4px;border:1px solid rgba(0,0,0,.25);flex-shrink:0}
.pd-card-level{font-size:10.5px;color:var(--text-dim,#7a7062)}
.pd-card-actions{display:flex;flex-wrap:wrap;gap:4px}
.pd-items{margin-top:8px;border-top:1px solid var(--line,#e5e0d4);padding-top:6px}
.pd-items .pd-item{display:flex;align-items:center;gap:6px;padding:2px 0;font-size:10.5px}
.pd-items .pd-item .pd-chip{width:12px;height:12px;border-radius:3px;border:1px solid rgba(0,0,0,.25)}
.pd-items .pd-item code{color:var(--text-dim,#7a7062)}
.pd-items .pd-item button{margin-left:auto;border:none;background:transparent;cursor:pointer;color:var(--text-faint,#a89c84);font-size:11px}
`;

function plannerDetailInjectCss() {
  if (typeof document === 'undefined' || document.getElementById('planner-detail-css')) return;
  const st = document.createElement('style');
  st.id = 'planner-detail-css';
  st.textContent = PLANNER_DETAIL_CSS;
  document.head.appendChild(st);
}

function plannerDetailEsc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** ?stage=detail 인가. */
function plannerDetailWantsStage(search) {
  try { return new URLSearchParams(search || '').get('stage') === 'detail'; } catch (e) { return false; }
}

/**
 * 쿼리스트링에 stage=detail 을 붙이거나 뗀다. 다른 파라미터(design·item)는 그대로다.
 * 배치 단계로 돌아갈 때 떼지 않으면 배치 → 구조로 왔을 때 디테일 모드가 따라온다.
 */
function plannerDetailSearchWith(search, on) {
  try {
    const q = new URLSearchParams(search || '');
    if (on) q.set('stage', 'detail'); else q.delete('stage');
    const s = q.toString();
    return s ? '?' + s : '';
  } catch (e) { return search || ''; }
}

/** 어두운 색이면 스와치 글자를 밝게. */
function plannerDetailIsDark(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) < 110;
}

const PlannerDetail = {
  active: false,
  detail: null,
  catalog: null,
  selectedCode: null,
  slot: 'door',
  picked: null,
  undoStack: [],
  _o: null,
  _prevTitle: null,

  key() {
    return (typeof scopedKey === 'function') ? scopedKey(PLANNER_DETAIL_KEY_BASE) : PLANNER_DETAIL_KEY_BASE;
  },

  /** 페이지가 한 번 부른다. ?stage=detail 이면 바로 모드로 들어간다. */
  mount(o) {
    this._o = o || {};
    plannerDetailInjectCss();
    // 카탈로그: 캐시/로컬 정본으로 먼저 그리고, DB 를 읽어 오면 갈아 끼운다 (planner-catalog.js).
    this.catalog = this.catalogSync();
    this.loadCatalog();
    this.detail = this.load();
    const pill = document.getElementById('detailStageBtn');
    if (pill) pill.onclick = () => this.toggle();
    // D1 이 부모 쪽에서 마감을 되돌려 줄 때의 수신부. 같은 오리진만 받는다 (planner-store 와 같은 규칙).
    try {
      window.addEventListener('message', (e) => {
        if (!e.data || e.data.type !== 'DADAM_DETAIL_SET' || !e.data.detail) return;
        if (e.origin !== location.origin) return;
        this.replace(e.data.detail);
      });
    } catch (e) { /* window 가 없으면 메시지도 없다 */ }
    let search = '';
    try { search = location.search; } catch (e) { search = ''; }
    if (plannerDetailWantsStage(search)) this.enter({ quiet: true });
    return this;
  },

  // ── 카탈로그 ────────────────────────────────────────────
  /** 네트워크 없이 지금 쓸 카탈로그. planner-catalog.js 가 없으면 D0 의 로컬 정본. */
  catalogSync() {
    if (typeof PlannerCatalog !== 'undefined' && PlannerCatalog && typeof PlannerCatalog.sync === 'function') {
      try { return PlannerCatalog.sync(); } catch (e) { /* 아래 폴백 */ }
    }
    return plannerFinishCatalog(typeof window !== 'undefined' ? window.DadamBomFinishColor : null);
  },

  /**
   * DB 에서 카탈로그를 읽어 갈아 끼운다. 언제나 resolve 한다 (실패해도 지금 카탈로그 유지).
   * 재질 캐시는 코드→재질이라 카탈로그가 바뀌면 비운다.
   */
  loadCatalog(opt) {
    if (typeof PlannerCatalog === 'undefined' || !PlannerCatalog || typeof PlannerCatalog.load !== 'function') {
      return Promise.resolve(this.catalog);
    }
    // 여러 번 부르면 **나중에 시작한 것**이 이긴다 — 먼저 시작한 느린 응답이 새 카탈로그를 덮지 않게.
    const seq = (this._catalogSeq = (this._catalogSeq || 0) + 1);
    let p;
    try { p = PlannerCatalog.load(opt); } catch (e) { return Promise.resolve(this.catalog); }
    return Promise.resolve(p).then((cat) => {
      if (!cat || !Array.isArray(cat.entries) || seq !== this._catalogSeq) return this.catalog;
      this.catalog = cat;
      if (typeof PlannerMaterials !== 'undefined' && PlannerMaterials) { try { PlannerMaterials.dispose(); } catch (e) { /* 무해 */ } }
      if (this.active) this.refresh();
      return cat;
    }, () => this.catalog);
  },

  /** 코드 → 카탈로그 항목. byCode 가 있으면 O(1), 없으면 목록 검색. */
  entryOf(code) {
    if (!code || !this.catalog) return null;
    if (this.catalog.byCode) return this.catalog.byCode[code] || null;
    return plannerFinishLookup(this.catalog, code);
  },

  // ── 저장소 ──────────────────────────────────────────────
  load() {
    let raw = null;
    try { raw = localStorage.getItem(this.key()); } catch (e) { raw = null; }
    return plannerFinishNormalize(raw);
  },

  /** localStorage → 계정 자동 저장 → 부모. 셋 다 실패해도 던지지 않는다. */
  save() {
    try { localStorage.setItem(this.key(), JSON.stringify(this.detail)); } catch (e) { /* 저장소 막힘 */ }
    if (typeof plannerAutosave === 'function') plannerAutosave('detail', PLANNER_DETAIL_AUTOSAVE_MS);
    this.notifyParent();
    return true;
  },

  notifyParent() {
    try {
      if (typeof window === 'undefined' || !window.parent || window.parent === window) return false;
      let origin = '*';
      try { origin = location.origin || '*'; } catch (e) { origin = '*'; }
      window.parent.postMessage({ type: 'PLANNER_DETAIL_CHANGE', source: 'mockup-structure', detail: this.detail }, origin);
      return true;
    } catch (e) { return false; }
  },

  /** 저장소에서 다시 읽는다 — 스냅샷을 되쓴 뒤. 되돌리기 이력은 버린다. */
  reload() {
    this.detail = this.load();
    this.undoStack = [];
    this.refresh();
    return this.detail;
  },

  /** 바깥에서 온 모델로 갈아 끼운다 (부모 · 시험). */
  replace(raw) {
    this.pushUndo();
    this.detail = plannerFinishNormalize(raw);
    this.save();
    this.refresh();
    return this.detail;
  },

  /**
   * 스냅샷 메뉴가 PlannerStore.loadAny 결과를 넘긴다.
   *   새 형식 {detail}         → 키가 이미 되써졌으니(applied) 다시 읽고 그린다
   *   옛 형식 {specs, modules} → 이 페이지가 해석할 수 없다. 부모(상세설계)에 DADAM_RESTORE_DETAIL 로 넘긴다
   */
  applySnapshotResult(r) {
    if (!r || !r.ok) return false;
    const applied = Array.isArray(r.applied) ? r.applied : [];
    if (applied.indexOf('detail') >= 0) {
      this.reload();
      this.toast('📥 마감 불러오기 완료 (' + plannerFinishCount(this.detail) + '건)');
      return true;
    }
    const payload = r.row && r.row.payload;
    if (payload && (payload.specs || payload.modules)) {
      let sent = false;
      try {
        if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
          let origin = '*';
          try { origin = location.origin || '*'; } catch (e) { origin = '*'; }
          window.parent.postMessage({ type: 'DADAM_RESTORE_DETAIL', payload }, origin);
          sent = true;
        }
      } catch (e) { sent = false; }
      this.toast(sent ? '📥 옛 형식 디테일 저장본 — 상세설계 화면으로 넘겼습니다'
                      : '⚠ 옛 형식 디테일 저장본은 상세설계 화면 안에서만 불러올 수 있습니다');
      return sent;
    }
    this.toast('⚠ 이 저장본에는 마감 정보가 없습니다');
    return false;
  },

  // ── 모드 ────────────────────────────────────────────────
  isActive() { return this.active; },

  enter(opt) {
    if (this.active) return false;
    this.active = true;
    const o = opt || {};
    try { document.body.classList.add('detail-mode'); } catch (e) { /* DOM 없음 */ }
    this._pills(true);
    const head = document.querySelector('.ml-header-title');
    if (head) { this._prevTitle = head.textContent; head.textContent = '마감 팔레트'; }
    this._syncUrl(true);
    this.refresh();
    if (!o.quiet) this.toast('🎨 디테일 모드 — 팔레트에서 마감을 고르고 3D 부재를 누르세요 (Shift+클릭 = 모듈 전체)');
    return true;
  },

  exit() {
    if (!this.active) return false;
    this.active = false;
    try { document.body.classList.remove('detail-mode'); } catch (e) { /* DOM 없음 */ }
    this._pills(false);
    const head = document.querySelector('.ml-header-title');
    if (head && this._prevTitle != null) head.textContent = this._prevTitle;
    this._syncUrl(false);
    this.picked = null;
    this.rerender3D();   // 구조 색으로 되돌린다 — renderAll3D 가 처음부터 다시 만든다
    return true;
  },

  toggle() { return this.active ? this.exit() : this.enter(); },

  _pills(on) {
    const d = document.getElementById('detailStageBtn');
    const s = document.getElementById('structureStageBtn');
    if (d) d.classList.toggle('active', on);
    if (s) s.classList.toggle('active', !on);
  },

  /** 새로고침해도 모드가 남게 URL 에 적는다. 실패해도 모드는 켜진다. */
  _syncUrl(on) {
    try {
      if (typeof history === 'undefined' || !history.replaceState) return;
      const next = location.pathname + plannerDetailSearchWith(location.search, on) + (location.hash || '');
      history.replaceState(history.state, '', next);
    } catch (e) { /* 다른 오리진·시험 환경 */ }
  },

  rerender3D() {
    if (this._o && typeof this._o.renderAll3D === 'function') {
      try { this._o.renderAll3D({ fit: false }); } catch (e) { /* three 가 아직 없을 수 있다 */ }
    }
  },

  toast(text) {
    if (this._o && typeof this._o.toast === 'function') { try { this._o.toast(text); } catch (e) { /* 무해 */ } }
  },

  modules() {
    if (!this._o || typeof this._o.modules !== 'function') return [];
    try { return this._o.modules() || []; } catch (e) { return []; }
  },

  moduleOf(id) { return this.modules().find((m) => m && m.id === id) || null; },

  moduleLabel(m) {
    if (!m) return '모듈';
    const s = m.section || '';
    const lbl = (this._o && typeof this._o.sectionLabel === 'function') ? this._o.sectionLabel(s) : s;
    return (lbl || s || '모듈') + (m.part ? ' · ' + m.part : '');
  },

  // ── 3D 픽 ───────────────────────────────────────────────
  /**
   * handleEntityClick 이 모드일 때 먼저 부른다. true 를 돌려주면 구조 단계의 선택 흐름은 타지 않는다.
   * userData 는 mesh 자신 것을 쓰고, moduleId 만 없으면 부모(모듈 그룹)에서 보충한다
   * (doorEdge 처럼 moduleId 없이 만들어지는 mesh 가 있다).
   */
  pickMesh(mesh, ev) {
    if (!this.active || !mesh) return false;
    const ud = Object.assign({}, mesh.userData || {});
    let cur = mesh;
    while (!ud.moduleId && cur) {
      if (cur.userData && cur.userData.moduleId) ud.moduleId = cur.userData.moduleId;
      cur = cur.parent;
    }
    if (!ud.entityKind || ud.entityKind === 'area') {
      this.toast('배치 영역입니다 — 마감은 모듈의 부재(도어·몸통·상판…)를 누르세요');
      return true;
    }
    return this.pickPart(ud, { module: !!(ev && ev.shiftKey) });
  },

  /**
   * 부재 하나를 고른다. 팔레트에 고른 마감이 있으면 곧 칠하고, 없으면 카드만 보여 준다(스포이드).
   * @param {object} ud   userData (moduleId 포함)
   * @param {{module?:boolean}} [opt] module:true 면 그 모듈의 같은 슬롯 전부 (Shift+클릭)
   */
  pickPart(ud, opt) {
    const o = opt || {};
    const slot = plannerFinishSlotOf(ud);
    const partKey = plannerFinishPartKeyOf(ud);
    const moduleId = ud && ud.moduleId;
    if (!slot || !moduleId) {
      this.toast('이 부재에는 마감을 지정하지 않습니다 (' + ((ud && ud.entityKind) || '?') + ')');
      return true;
    }
    const m = this.moduleOf(moduleId);
    this.picked = { moduleId, section: m ? m.section : null, slot, partKey, kind: ud.entityKind, module: m };
    this.slot = slot;
    if (this.selectedCode) {
      if (o.module || !partKey) this.apply('module', slot, { moduleId, section: this.picked.section });
      else this.apply('part', slot, { moduleId, section: this.picked.section, partKey });
    } else {
      this.renderCard();
      this.renderPalette();
    }
    return true;
  },

  // ── 편집 ────────────────────────────────────────────────
  selectCode(code) {
    this.selectedCode = (code && code !== this.selectedCode) ? code : null;
    this.renderPalette();
    this.renderCard();
    return this.selectedCode;
  },

  selectSlot(slot) {
    if (PLANNER_FINISH_SLOTS.indexOf(slot) >= 0) this.slot = slot;
    this.renderPalette();
    return this.slot;
  },

  pushUndo() {
    this.undoStack.push(JSON.stringify(this.detail));
    while (this.undoStack.length > PLANNER_DETAIL_UNDO_MAX) this.undoStack.shift();
  },

  undo() {
    const raw = this.undoStack.pop();
    if (raw == null) { this.toast('되돌릴 것이 없습니다'); return false; }
    this.detail = plannerFinishNormalize(raw);
    this.save();
    this.refresh();
    return true;
  },

  /** 고른 마감을 한 단계에 적는다. 코드는 팔레트에서 고른 것(selectedCode)이거나 넘긴 것. */
  apply(level, slot, ctx, code) {
    const c = code || this.selectedCode;
    if (!c) { this.toast('팔레트에서 먼저 마감을 고르세요'); return false; }
    this.pushUndo();
    if (!plannerFinishSet(this.detail, level, slot, c, ctx || {})) { this.undoStack.pop(); return false; }
    this.save();
    this.refresh();
    const entry = plannerFinishLookup(this.catalog, c);
    const where = level === 'item' ? '품목 전체'
      : level === 'section' ? ((ctx && plannerFinishSectionGroup(ctx.section) === 'upper') ? '상부 전체' : '하부 전체')
      : level === 'module' ? '이 모듈'
      : (ctx && ctx.partKey) || '부재';
    this.toast('🎨 ' + where + ' · ' + PLANNER_FINISH_SLOT_LABEL[slot] + ' ← ' + (entry ? entry.label : c));
    return true;
  },

  clearAt(level, slot, ctx) {
    this.pushUndo();
    if (!plannerFinishClear(this.detail, level, slot, ctx || {})) { this.undoStack.pop(); return false; }
    this.save();
    this.refresh();
    return true;
  },

  /** 팔레트의 일괄 적용 줄. `section:upper` / `section:lower` / `item` / `module`. */
  applyBulk(target) {
    if (target === 'item') return this.apply('item', this.slot, {});
    if (target === 'section:upper') return this.apply('section', this.slot, { section: 'upper' });
    if (target === 'section:lower') return this.apply('section', this.slot, { section: 'lower' });
    if (target === 'module') {
      if (!this.picked) { this.toast('먼저 3D 에서 모듈의 부재를 하나 누르세요'); return false; }
      return this.apply('module', this.slot, { moduleId: this.picked.moduleId, section: this.picked.section });
    }
    return false;
  },

  // ── 3D 색 ───────────────────────────────────────────────
  /** 이 mesh 가 받을 hex. 지정이 없거나 칠하지 않는 종류면 null (구조 색 그대로). */
  colorFor(ud) {
    const slot = plannerFinishPaintSlotOf(ud);
    if (!slot || !ud.moduleId) return null;
    const m = this.moduleOf(ud.moduleId);
    const r = plannerFinishResolve(this.detail, slot, ud.moduleId, m ? m.section : null, plannerFinishPartKeyOf(ud));
    return r ? plannerFinishHex(this.catalog, r.code) : null;
  },

  /**
   * renderAll3D 가 다 그린 뒤 부르는 후처리. mesh 를 만들지도 지우지도 않고 material.color 만 바꾼다
   * (makeBox 가 mesh 마다 재질을 새로 만들므로 공유 재질을 더럽힐 걱정이 없다).
   * 모드가 아니면 0 을 돌려주고 손대지 않는다.
   * @returns {number} 칠한 mesh 수
   */
  paintScene(group) {
    if (!this.active || !group || typeof group.traverse !== 'function') return 0;
    let n = 0;
    group.traverse((obj) => {
      if (!obj || !obj.isMesh || !obj.material || !obj.material.color || typeof obj.material.color.set !== 'function') return;
      const ud = obj.userData || {};
      let hex = null;
      if (ud.moduleId) hex = this.colorFor(ud);
      else {
        // moduleId 없는 mesh 는 부모 그룹에서 찾는다 (없으면 칠하지 않는다)
        let cur = obj.parent, mid = null;
        while (cur && !mid) { if (cur.userData && cur.userData.moduleId) mid = cur.userData.moduleId; cur = cur.parent; }
        if (mid) hex = this.colorFor(Object.assign({}, ud, { moduleId: mid }));
      }
      if (!hex) return;
      obj.material.color.set(hex);
      n++;
    });
    return n;
  },

  // ── 화면 ────────────────────────────────────────────────
  refresh() {
    this.renderPalette();
    this.renderCard();
    this.rerender3D();
  },

  renderPalette() {
    const host = (typeof document !== 'undefined') ? document.getElementById('detailPalette') : null;
    if (!host || !this.catalog) return;
    const esc = plannerDetailEsc;
    const sel = plannerFinishLookup(this.catalog, this.selectedCode);
    const parts = [];
    // 카탈로그 크기는 정본이 정한다 (C0 가 색을 더하면 7×10 처럼 따라 바뀐다 — 숫자를 박지 않는다).
    const nF = this.catalog.finishes.length;
    const nC = nF ? Math.round(this.catalog.entries.length / nF) : 0;
    parts.push(`<div class="pd-head"><span>마감 팔레트</span><span class="pd-src">${this.catalog.fallback ? '폴백 목록' : `카탈로그 ${nF}×${nC}`}</span></div>`);
    parts.push('<div class="pd-sel">' + (sel
      ? `<span class="pd-chip" style="background:${esc(sel.hex)}"></span><b>${esc(sel.label)}</b><code>${esc(sel.code)}</code>`
      : '<span class="pd-hint">아래에서 마감을 고르세요 — 고르지 않고 부재를 누르면 지정된 마감을 보여 줍니다</span>') + '</div>');
    parts.push('<div class="pd-label">슬롯 (일괄 적용 대상)</div>');
    parts.push('<div class="pd-slots">' + PLANNER_FINISH_SLOTS.map((s) =>
      `<button type="button" data-slot="${s}" class="${s === this.slot ? 'on' : ''}">${esc(PLANNER_FINISH_SLOT_LABEL[s])}</button>`).join('') + '</div>');
    const dis = sel ? '' : ' disabled';
    parts.push('<div class="pd-label">고른 마감을 한꺼번에</div>');
    parts.push('<div class="pd-bulk">'
      + `<button type="button" data-bulk="item"${dis}>품목 전체</button>`
      + `<button type="button" data-bulk="section:upper"${dis}>상부 전체</button>`
      + `<button type="button" data-bulk="section:lower"${dis}>하부 전체</button>`
      + `<button type="button" data-bulk="module"${(sel && this.picked) ? '' : ' disabled'}>이 모듈</button>`
      + '</div>');
    parts.push('<div class="pd-hint">3D 부재 클릭 = 그 부재만 · Shift+클릭 = 그 모듈의 같은 슬롯 전부</div>');
    parts.push('<div class="pd-tools">'
      + `<button type="button" data-undo="1"${this.undoStack.length ? '' : ' disabled'}>↶ 되돌리기 (${this.undoStack.length})</button>`
      + `<span class="pd-hint">지정 ${plannerFinishCount(this.detail)}건</span></div>`);
    this.catalog.finishes.forEach((f) => {
      const rows = this.catalog.entries.filter((e) => e.finish === f.value);
      if (!rows.length) return;
      parts.push(`<div class="pd-group"><div class="pd-group-title">${esc(f.label)}</div><div class="pd-swatches">`
        + rows.map((e) => `<button type="button" class="pd-swatch${e.code === this.selectedCode ? ' on' : ''}${plannerDetailIsDark(e.hex) ? ' dark' : ''}" `
          + `data-code="${esc(e.code)}" title="${esc(e.label)} · ${esc(e.code)}" style="background:${esc(e.hex)}"><span class="pd-code">${esc(e.colorLabel)}</span></button>`).join('')
        + '</div></div>');
    });
    host.innerHTML = parts.join('');
    host.querySelectorAll('[data-code]').forEach((el) => { el.onclick = () => this.selectCode(el.dataset.code); });
    host.querySelectorAll('[data-slot]').forEach((el) => { el.onclick = () => this.selectSlot(el.dataset.slot); });
    host.querySelectorAll('[data-bulk]').forEach((el) => { el.onclick = () => this.applyBulk(el.dataset.bulk); });
    const u = host.querySelector('[data-undo]');
    if (u) u.onclick = () => this.undo();
  },

  renderCard() {
    const host = (typeof document !== 'undefined') ? document.getElementById('detailBody') : null;
    if (!host) return;
    const esc = plannerDetailEsc;
    const parts = [];
    const p = this.picked;
    if (!p) {
      parts.push('<div class="empty-msg">3D 에서 부재를 누르세요<br><span style="font-size:10px">고른 부재의 마감과 어느 단계에서 정해졌는지 보여 줍니다</span></div>');
    } else {
      const r = plannerFinishResolve(this.detail, p.slot, p.moduleId, p.section, p.partKey);
      const e = r ? plannerFinishLookup(this.catalog, r.code) : null;
      parts.push('<div class="pd-card">');
      parts.push(`<div class="pd-card-title">${esc(this.moduleLabel(p.module || this.moduleOf(p.moduleId)))} · ${esc(PLANNER_FINISH_SLOT_LABEL[p.slot])}`
        + (p.partKey ? ` <code>${esc(p.partKey)}</code>` : '') + '</div>');
      if (r) {
        parts.push(`<div class="pd-card-row"><span class="pd-chip" style="background:${esc(e ? e.hex : '#ccc')}"></span>`
          + `<b>${esc(e ? e.label : r.code)}</b><code>${esc(r.code)}</code></div>`);
        parts.push(`<div class="pd-card-level">${esc(PLANNER_FINISH_LEVEL_LABEL[r.level] || r.level)} 단계 지정</div>`);
      } else {
        parts.push('<div class="pd-card-level">지정 없음 — 구조 단계 색 그대로</div>');
      }
      const can = !!this.selectedCode;
      const hasPart = !!(p.partKey && this.detail.parts[p.moduleId] && this.detail.parts[p.moduleId][p.partKey]);
      const hasMod = !!(this.detail.modules[p.moduleId] && this.detail.modules[p.moduleId][p.slot]);
      parts.push('<div class="pd-card-actions">'
        + `<button type="button" data-act="part"${(can && p.partKey) ? '' : ' disabled'}>이 부재에 적용</button>`
        + `<button type="button" data-act="module"${can ? '' : ' disabled'}>모듈 ${esc(PLANNER_FINISH_SLOT_LABEL[p.slot])} 전부</button>`
        + `<button type="button" data-act="clear-part"${hasPart ? '' : ' disabled'}>부재 지정 해제</button>`
        + `<button type="button" data-act="clear-module"${hasMod ? '' : ' disabled'}>모듈 지정 해제</button>`
        + '</div></div>');
    }
    // 품목 기본값 — 슬롯별
    const items = PLANNER_FINISH_SLOTS.filter((s) => this.detail.item[s]);
    parts.push('<div class="pd-items"><div class="pd-label">품목 기본값</div>');
    if (!items.length) parts.push('<div class="pd-hint">없음 — 팔레트의 "품목 전체" 로 정합니다</div>');
    items.forEach((s) => {
      const code = this.detail.item[s].code;
      const e = plannerFinishLookup(this.catalog, code);
      parts.push(`<div class="pd-item"><span class="pd-chip" style="background:${esc(e ? e.hex : '#ccc')}"></span>`
        + `${esc(PLANNER_FINISH_SLOT_LABEL[s])} <code>${esc(code)}</code>`
        + `<button type="button" data-clear-item="${s}" title="품목 기본값 해제">✕</button></div>`);
    });
    parts.push('</div>');
    host.innerHTML = parts.join('');
    host.querySelectorAll('[data-act]').forEach((el) => {
      el.onclick = () => {
        if (!this.picked) return;
        const q = this.picked;
        const ctx = { moduleId: q.moduleId, section: q.section, partKey: q.partKey };
        if (el.dataset.act === 'part') this.apply('part', q.slot, ctx);
        else if (el.dataset.act === 'module') this.apply('module', q.slot, ctx);
        else if (el.dataset.act === 'clear-part') this.clearAt('part', q.slot, ctx);
        else if (el.dataset.act === 'clear-module') this.clearAt('module', q.slot, ctx);
      };
    });
    host.querySelectorAll('[data-clear-item]').forEach((el) => {
      el.onclick = () => this.clearAt('item', el.dataset.clearItem, {});
    });
  },
};

if (typeof window !== 'undefined') {
  window.PlannerDetail = PlannerDetail;
  window.PLANNER_DETAIL_KEY_BASE = PLANNER_DETAIL_KEY_BASE;
  window.plannerDetailWantsStage = plannerDetailWantsStage;
  window.plannerDetailSearchWith = plannerDetailSearchWith;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_DETAIL_KEY_BASE,
    PLANNER_DETAIL_UNDO_MAX,
    PLANNER_DETAIL_AUTOSAVE_MS,
    PLANNER_DETAIL_CSS,
    plannerDetailWantsStage,
    plannerDetailSearchWith,
    plannerDetailIsDark,
    PlannerDetail,
  };
}
