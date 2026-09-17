// ============================================================
// D0: 디테일 모드 — planner-detail.js (구조 페이지 전용)
//
// 🎨 3.디테일 버튼은 여태 **핸들러가 없었다** (계획 §1.1). 디테일 단계 화면이 없어
// 색·마감은 상세설계의 상/하 두 값으로만 정해졌다.
//
// 별도 페이지를 만들지 않는다 (계획 §4.1). 부재 피킹(raycaster + userData.entityKind)과
// 3D 씬이 이미 mockup-structure.html 에 있으므로, 그 페이지 안의 **모드**로 시작한다:
//   · 🎨 버튼 또는 ?stage=detail → enter(). 다시 누르면 exit().
//   · 모드에서는 (a) 우측에 마감 팔레트가 서고 (b) 3D 를 누르면 **범위**가 정해지며
//     (c) renderAll3D 뒤에 부재 색을 카탈로그 hex 로 덮는다 (paintScene).
//   · 모드 밖에서는 **아무것도 하지 않는다** — 구조 단계 화면·피킹 색은 그대로다 (I2).
//
// 선택 범위 (2026-09-16): PlannerDetail.scope = 'part' | 'module' | 'area' | 'item'.
//   좌측 목록의 전체/배치/개별 과 **같은 것**이다 — 목록에서 고르면 범위가 되고, 범위를 바꾸면
//   목록이 따라온다 (onListMode ↔ syncListMode). 3D 에서 배치 상자를 누르면 배치 범위,
//   개별 모드에서 부재를 누르면 부재 범위(Shift 면 모듈).
//   범위를 고른 뒤 팔레트에서 색을 고르면 **그 범위 전체**가 곧 칠해진다 (applyScope).
//
//   ⚠ 마감 모델에는 '배치' 단계가 없다 — 단계는 여전히 부재 > 모듈 > 섹션 > 품목 넷뿐이다
//   (planner-finish.js PLANNER_FINISH_LEVELS). 배치 범위는 **그 배치 안 모듈마다 모듈 단계로
//   펼쳐** 적는다. 이유: js/detaildesign/extractors.js(BOM 도메인)가 같은 4단계 우선순위를
//   자기 쪽에 한 벌 더 갖고 있고 design_items.detail 이 D1 을 왕복한다 — 단계를 하나 더 만들면
//   BOM 과 도면이 조용히 갈라진다. 모듈 단계로 펼치면 BOM·3D·저장본이 같은 것을 본다.
//   범위를 칠할 때는 그 안의 **아래 단계 지정을 지운다** (모듈/배치 → 부재, 품목 → 모듈·섹션·부재).
//   안 지우면 아래 단계가 이겨서 "전체가 칠해졌다" 가 거짓말이 된다. 한 범위 = 되돌리기 한 장.
//   어느 슬롯이 실제로 있는지는 3D mesh 에서 읽는다 (plannerFinishPaintSlotOf) — 상판이 없는
//   모듈에 top 지정을 적지 않기 위해서다.
//
// 상태의 정본은 planner-finish.js 의 모델 하나(this.detail)다. 이 파일은 그 모델을
// 저장소(dadam_detail_v1, 스코프 키)와 화면(팔레트·카드·3D) 사이에서 나른다.
//   저장:  localStorage → plannerAutosave('detail') → 부모에 PLANNER_DETAIL_CHANGE
//   (부모(detaildesign)가 아직 안 받아도 무해하다 — 받는 쪽은 D1, Design UI 도메인)
//   되돌리기: JSON 사본 10장 (undoStack)
//
// 카탈로그 (D2): planner-catalog.js 가 materials 표(예림 LUX 144 + 상판)를 읽어 그룹으로 준다.
//   DB 를 못 읽으면 bom-finish-color.js 의 구 7×7 만 남는다 (fallback:true, 머리에 표시).
//   mount 는 동기로 캐시/로컬 정본을 먼저 그리고, PlannerCatalog.load() 가 끝나면 갈아 끼운다.
//
// 3D (D2, R1 실시간): 모드에 들어갈 때만 renderer 를 sRGB·ACES·환경광(RoomEnvironment PMREM)으로
//   바꾸고 직사광을 낮춘다(applyScene). paintScene 은 부재 mesh 의 재질을 코드별 PBR
//   (planner-materials.js, 색+광택)로 **바꿔 끼운다** — 원래 재질은 userData._origMaterial 에 둔다.
//   나갈 때 renderer·scene·조명 값을 **저장해 둔 값 그대로** 되돌린다 (I2: 구조 모드는 바이트 동일).
//   three 가 없으면(jsdom) D0 처럼 material.color 만 덮는다.
//
// 페이지가 넘기는 것 (PlannerDetail.mount(o)):
//   modules()        지금 모듈 목록 (섹션을 알기 위해)
//   renderAll3D(opt) 3D 다시 그리기 — 모드 진입·이탈·칠하기 뒤에 부른다
//   toast(text)      알림
//   sectionLabel(s)  섹션 → 사람이 읽는 이름 (없으면 섹션 키 그대로)
//   three()          { renderer, scene, camera, controls, moduleGroup } — init3D 전이면 null
//
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_DETAIL_ / plannerDetail / PlannerDetail 접두.
//   HTML 인라인은 mount 와 두 훅(handleEntityClick → pickMesh, renderAll3D → paintScene)만 건다.
// ============================================================

/** 저장 키 base. planner-store.js 의 PLANNER_STAGE_KEYS.detail.detail 과 같은 값이어야 한다. */
const PLANNER_DETAIL_KEY_BASE = 'dadam_detail_v1';
const PLANNER_DETAIL_UNDO_MAX = 10;
const PLANNER_DETAIL_AUTOSAVE_MS = 1500;

/** 칠할 범위. 넓은 것부터 — 좌측 목록의 전체/배치/개별 과 짝이다. */
const PLANNER_DETAIL_SCOPES = ['item', 'area', 'module', 'part'];

/** 슬롯 필터의 '전체'. PLANNER_FINISH_SLOTS 에는 없는 값이라 따로 둔다. */
const PLANNER_DETAIL_SLOT_ALL = 'all';

/**
 * 좌측 목록 모드 ↔ 범위.
 *   개별(single) 은 모듈·부재 둘 다 담는다 — 목록에서 모듈을 고르면 모듈, 3D 에서 부재를 누르면 부재.
 *   그래서 목록 → 범위는 모듈로 열고(MODE_SCOPE), 범위 → 목록은 둘 다 single 로 접는다(SCOPE_MODE).
 */
const PLANNER_DETAIL_MODE_SCOPE = { all: 'item', area: 'area', single: 'module' };
const PLANNER_DETAIL_SCOPE_MODE = { item: 'all', area: 'area', module: 'single', part: 'single' };

/** 슬롯 이름 — '전체' 를 앞에 붙인 PLANNER_FINISH_SLOT_LABEL. 클래식 스크립트라 함수로 늦게 읽는다. */
function plannerDetailSlotLabel(slot) {
  if (!slot || slot === PLANNER_DETAIL_SLOT_ALL) return '전체';
  const T = (typeof PLANNER_FINISH_SLOT_LABEL !== 'undefined') ? PLANNER_FINISH_SLOT_LABEL : null;
  return (T && T[slot]) || slot;
}

const PLANNER_DETAIL_CSS = `
/* 모드 스위치 — body.detail-mode 하나로 좌·우 패널과 상단 메뉴가 바뀐다.
   applyPanelLayout 이 섹션에 인라인 display 를 쓰므로 !important 로 이긴다.

   2026-09-16: 팔레트가 **우측 패널**로 갔다 (#rightPanel .section[data-sec="detail-palette"]).
   좌측은 구조 단계와 같은 전체/배치/개별 목록 그대로다 — 목록에서 고른 것이 곧 칠할 범위다.
   개별 모듈 패널(#modulePanel)만 숨긴다: 그 안의 '적용' 은 구조(분할·칸·선반)를 바꾸는
   버튼이라 마감을 고르러 온 화면에 있으면 안 된다. */
#detailPalette{display:none;flex-direction:column;gap:8px;font-size:11px;color:var(--text,#2b2620)}
body.detail-mode #detailPalette{display:flex}
body.detail-mode #modulePanel{display:none!important}
body.detail-mode #rightPanel .section[data-sec]:not([data-sec="detail-palette"]):not([data-sec="detail"]):not([data-sec="detail-renders"]):not([data-sec="photo"]){display:none!important}
body.detail-mode #rightPanel .section[data-sec="detail-palette"],body.detail-mode #rightPanel .section[data-sec="detail"],body.detail-mode #rightPanel .section[data-sec="detail-renders"],body.detail-mode #rightPanel .section[data-sec="photo"]{display:block!important}
/* 스와치 묶음만 따로 구른다 — 머리(범위·슬롯·검색)는 붙어 있어야 지금 무엇을 칠하는지 보인다. */
#detailPalette .pd-groups{max-height:44vh;overflow-y:auto;padding-right:2px}
.pd-scope{display:flex;align-items:flex-start;gap:6px;padding:6px 8px;border:1px solid var(--brand-mid,#c8ab86);border-radius:6px;background:var(--brand-soft,#f6efe4)}
.pd-scope .pd-scope-text{flex:1;line-height:1.45;font-size:10.5px;color:var(--text,#2b2620)}
.pd-scope .pd-scope-text b{color:var(--brand-deep,#6a4b2a)}
.pd-scope .pd-scope-sub{display:block;font-size:9.5px;color:var(--text-dim,#7a7062)}
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
.pd-search{width:100%;box-sizing:border-box;border:1px solid var(--line,#e5e0d4);border-radius:6px;padding:4px 8px;font-size:11px;font-family:inherit;color:var(--text,#2b2620);background:#fff}
.pd-groups{display:flex;flex-direction:column;gap:4px}
.pd-group{border:1px solid var(--line,#e5e0d4);border-radius:6px;background:#fff;padding:0 6px 6px}
.pd-group[open]{padding-bottom:6px}
.pd-group:not([open]){padding-bottom:0}
.pd-group summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:5px 0;font-size:10.5px;font-weight:600;color:var(--text-dim,#7a7062)}
.pd-group summary::-webkit-details-marker{display:none}
.pd-group summary::before{content:'▸';font-size:9px;margin-right:4px;color:var(--text-faint,#a89c84)}
.pd-group[open] summary::before{content:'▾'}
.pd-group summary .pd-count{font-weight:500;color:var(--text-faint,#a89c84)}
.pd-group.compat summary{color:var(--text-faint,#a89c84)}
.pd-swatches{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
.pd-swatch{position:relative;display:flex;flex-direction:column;gap:2px;border-radius:5px;border:1px solid rgba(0,0,0,.12);cursor:pointer;padding:2px;font-family:inherit;background:#fff;text-align:center;min-width:0}
.pd-swatch:hover{transform:translateY(-1px)}
.pd-swatch.on{outline:2px solid var(--pick,#1d6fe0);outline-offset:1px}
.pd-swatch .pd-chipbox{height:22px;border-radius:4px;border:1px solid rgba(0,0,0,.18)}
.pd-swatch .pd-name{font-size:8.5px;line-height:1.15;color:var(--text,#2b2620);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pd-swatch .pd-code{font-size:7.5px;color:var(--text-faint,#a89c84);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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
  /** 슬롯 필터. 'all' 이면 범위 안에 실제로 있는 슬롯 전부다. */
  slot: 'door',
  /** 칠할 범위 — 'part' | 'module' | 'area' | 'item'. 좌측 목록 모드와 짝이다. */
  scope: 'part',
  /** 배치 범위일 때의 영역 id (배치 단계의 areas[].id). */
  areaId: null,
  picked: null,
  /** 3D mesh 에서 읽은 모듈별 { slots:{slot:true}, parts:{partKey:slot} }. paintScene 이 갱신한다. */
  _paintMap: null,
  undoStack: [],
  /** 팔레트 검색어 · 그룹 접힘 상태 (키 → open). 다시 그려도 남는다. */
  query: '',
  groupOpen: {},
  _o: null,
  _prevTitle: null,
  /** applyScene(true) 가 바꾸기 전 값. null 이면 씬을 건드리지 않은 상태다. */
  _sceneSaved: null,
  /** 환경맵을 만드는 함수 — 시험이 갈아 끼운다. 기본은 RoomEnvironment PMREM. */
  _makeEnv: null,

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
    if (head) { this._prevTitle = head.textContent; head.textContent = '칠할 범위'; }
    this._syncUrl(true);
    this.applyScene(true);   // three 가 아직 없으면 paintScene 이 처음 불릴 때 켠다
    // 좌측 목록이 지금 보고 있는 것이 곧 범위다 — 모드를 바꾸지 않고 읽기만 한다.
    this.setScope(PLANNER_DETAIL_MODE_SCOPE[this.listMode()] || 'module', { fromList: true });
    this.refresh();
    // D3: 우측 "최근 렌더" 띠 — planner-capture.js 가 있을 때만 (없어도 모드는 돈다)
    if (typeof PlannerCapture !== 'undefined' && PlannerCapture && typeof PlannerCapture.onDetailEnter === 'function') {
      try { PlannerCapture.onDetailEnter(); } catch (e) { /* 무해 */ }
    }
    // P1: 우측 "사진 합성" 섹션 — photo-mode.js 가 있을 때만. 사진 모드 자체는 버튼으로 켠다.
    if (typeof PlannerPhotoMode !== 'undefined' && PlannerPhotoMode && typeof PlannerPhotoMode.renderPanel === 'function') {
      try { PlannerPhotoMode.renderPanel(); } catch (e) { /* 무해 */ }
    }
    if (!o.quiet) this.toast('🎨 디테일 모드 — 좌측에서 전체·배치·개별 로 범위를 고르고 우측 팔레트에서 색을 누르세요');
    return true;
  },

  exit() {
    if (!this.active) return false;
    // P1: 사진 모드는 디테일 모드 **안의** 모드다. 먼저 내보내야 씬(배경·바닥·그리드·도어 테두리·
    //   컨트롤)이 디테일 룩을 되돌리기 전에 제 값으로 돌아온다 — 안 그러면 구조 모드가 사진 모드의
    //   씬을 물려받는다 (I2: 구조 모드 화면은 바이트 동일해야 한다).
    if (typeof PlannerPhotoMode !== 'undefined' && PlannerPhotoMode && PlannerPhotoMode.isActive()) {
      try { PlannerPhotoMode.exit(); } catch (e) { /* 무해 */ }
    }
    this.active = false;
    try { document.body.classList.remove('detail-mode'); } catch (e) { /* DOM 없음 */ }
    this._pills(false);
    const head = document.querySelector('.ml-header-title');
    if (head && this._prevTitle != null) head.textContent = this._prevTitle;
    this._syncUrl(false);
    this.picked = null;
    // 재질 → 원래 것, renderer·조명 → 저장해 둔 값. 그 다음 renderAll3D 가 처음부터 다시 만든다.
    const t = this.three();
    if (t && t.moduleGroup) this.unpaintScene(t.moduleGroup);
    this.applyScene(false);
    this.rerender3D();   // 구조 색으로 되돌린다 — renderAll3D 가 처음부터 다시 만든다
    return true;
  },

  /** 페이지의 three 묶음. init3D 전이거나 넘기지 않았으면 null. */
  three() {
    if (!this._o || typeof this._o.three !== 'function') return null;
    try { return this._o.three() || null; } catch (e) { return null; }
  },

  // ── 3D 씬 (색공간·톤매핑·환경광·조명) ────────────────────
  /**
   * 모드 진입: renderer 를 sRGB 출력·ACES 톤매핑으로, scene.environment 를 RoomEnvironment PMREM 으로,
   * 직사광·주변광은 절반으로 (환경광이 채운다). 바꾸기 전 값을 전부 _sceneSaved 에 둔다.
   * 모드 이탈(on=false): 그 값들을 **그대로** 되돌리고 환경맵을 놓는다.
   * three 가 없으면 아무것도 하지 않고 false. 두 번 켜거나 두 번 꺼도 무해하다.
   */
  applyScene(on) {
    const t = this.three();
    const T = (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
    if (on) {
      if (this._sceneSaved || !t || !t.renderer || !t.scene || !T) return false;
      const r = t.renderer, s = t.scene;
      const saved = {
        outputColorSpace: r.outputColorSpace,
        toneMapping: r.toneMapping,
        toneMappingExposure: r.toneMappingExposure,
        environment: s.environment,
        lights: [],
        envTarget: null,
      };
      try {
        (s.children || []).forEach((ch) => {
          if (ch && (ch.isDirectionalLight || ch.isAmbientLight || ch.isHemisphereLight)) {
            saved.lights.push({ light: ch, intensity: ch.intensity });
          }
        });
      } catch (e) { /* children 이 없으면 조명도 없다 */ }
      this._sceneSaved = saved;
      try {
        if (T.SRGBColorSpace !== undefined) r.outputColorSpace = T.SRGBColorSpace;
        if (T.ACESFilmicToneMapping !== undefined) r.toneMapping = T.ACESFilmicToneMapping;
        r.toneMappingExposure = 1.0;
      } catch (e) { /* renderer 가 값을 거부해도 나머지는 간다 */ }
      const env = this.makeEnvironment(T, r);
      if (env) { saved.envTarget = env.target || null; s.environment = env.texture; }
      // 환경광이 들어오니 직사광·주변광은 절반 — 그대로 두면 하얗게 날아간다.
      saved.lights.forEach((L) => { try { L.light.intensity = L.intensity * 0.5; } catch (e) { /* 무해 */ } });
      return true;
    }
    const saved = this._sceneSaved;
    if (!saved) return false;
    this._sceneSaved = null;
    if (t && t.renderer) {
      try {
        t.renderer.outputColorSpace = saved.outputColorSpace;
        t.renderer.toneMapping = saved.toneMapping;
        t.renderer.toneMappingExposure = saved.toneMappingExposure;
      } catch (e) { /* 무해 */ }
    }
    if (t && t.scene) { try { t.scene.environment = saved.environment; } catch (e) { /* 무해 */ } }
    saved.lights.forEach((L) => { try { L.light.intensity = L.intensity; } catch (e) { /* 무해 */ } });
    if (saved.envTarget && typeof saved.envTarget.dispose === 'function') { try { saved.envTarget.dispose(); } catch (e) { /* 무해 */ } }
    return true;
  },

  /**
   * RoomEnvironment → PMREM. { texture, target } 또는 null (RoomEnvironment 가 안 실렸거나 WebGL 이 없을 때).
   * 시험은 _makeEnv 로 갈아 끼운다.
   */
  makeEnvironment(T, renderer) {
    if (typeof this._makeEnv === 'function') { try { return this._makeEnv(T, renderer) || null; } catch (e) { return null; } }
    const RoomEnv = (typeof window !== 'undefined') ? window.RoomEnvironment : null;
    if (!T || !renderer || !RoomEnv || !T.PMREMGenerator) return null;
    let pmrem = null;
    try {
      pmrem = new T.PMREMGenerator(renderer);
      const room = new RoomEnv();
      const target = pmrem.fromScene(room, 0.04);
      pmrem.dispose();
      return { texture: target.texture, target };
    } catch (e) {
      try { if (pmrem) pmrem.dispose(); } catch (e2) { /* 무해 */ }
      return null;
    }
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

  /** 배치 단계의 영역 목록. 페이지가 넘기지 않으면 빈 배열 (배치 범위가 그냥 안 쓰이는 것뿐이다). */
  areas() {
    if (!this._o || typeof this._o.areas !== 'function') return [];
    try { return this._o.areas() || []; } catch (e) { return []; }
  },

  areaOf(id) { return id ? (this.areas().find((a) => a && a.id === id) || null) : null; },

  /**
   * 모듈이 속한 영역 id. 페이지가 정본(areaIdOf)을 넘긴다 — 옛 설계의 모듈에는 areaId 가 없어
   * 섹션·회전·X 겹침으로 찾아야 하고, 그 규칙은 구조 단계(pickAreaFirst)와 **같아야** 한다.
   */
  areaIdOf(m) {
    if (!m) return null;
    if (this._o && typeof this._o.areaIdOf === 'function') {
      try { return this._o.areaIdOf(m) || null; } catch (e) { /* 아래 폴백 */ }
    }
    return m.areaId || null;
  },

  modulesInArea(areaId) {
    if (!areaId) return [];
    return this.modules().filter((m) => this.areaIdOf(m) === areaId);
  },

  areaLabel(a) {
    if (!a) return '배치';
    const lbl = (this._o && typeof this._o.sectionLabel === 'function') ? this._o.sectionLabel(a.section) : a.section;
    return (lbl || a.section || '배치') + ' W' + Math.round(a.W || 0);
  },

  // ── 범위 ────────────────────────────────────────────────
  /** 좌측 목록이 보고 있는 모드. 페이지가 안 넘기면 '개별' 로 본다. */
  listMode() {
    if (!this._o || typeof this._o.listMode !== 'function') return 'single';
    try { return this._o.listMode() || 'single'; } catch (e) { return 'single'; }
  },

  /** 범위에 맞게 좌측 목록을 바꾼다. 이미 그 모드면 아무것도 하지 않는다 (되먹임 방지). */
  syncListMode() {
    const want = PLANNER_DETAIL_SCOPE_MODE[this.scope];
    if (!want || this.listMode() === want) return false;
    if (!this._o || typeof this._o.setListMode !== 'function') return false;
    this._syncing = true;
    try { this._o.setListMode(want); } catch (e) { /* 무해 */ }
    this._syncing = false;
    return true;
  },

  /**
   * 범위를 바꾼다.
   * @param {string} scope 'part'|'module'|'area'|'item'
   * @param {{fromList?:boolean}} [opt] fromList:true 면 좌측 목록을 되부르지 않는다
   */
  setScope(scope, opt) {
    const o = opt || {};
    if (PLANNER_DETAIL_SCOPES.indexOf(scope) < 0) return this.scope;
    const changed = this.scope !== scope;
    this.scope = scope;
    // 슬롯 기본값: 부재는 고른 부재의 슬롯 하나, 나머지는 '전체'("전체가 다 칠해진다").
    // 범위가 **바뀔 때만** 되돌린다 — 사람이 좁혀 둔 필터를 다시 그린다고 풀면 안 된다.
    if (changed) {
      if (scope === 'part') {
        if (this.slot === PLANNER_DETAIL_SLOT_ALL) this.slot = (this.picked && this.picked.slot) || 'door';
      } else {
        this.slot = PLANNER_DETAIL_SLOT_ALL;
      }
    }
    if (!o.fromList) this.syncListMode();
    this.renderPalette();
    this.renderCard();
    return this.scope;
  },

  /** 페이지의 setViewMode 가 부른다 — 좌측 목록 모드가 바뀌면 범위도 따라온다. */
  onListMode(mode) {
    if (!this.active) return false;
    // 개별(single) 안에서 부재 → 모듈로 되돌리지 않는다: 둘 다 같은 목록 모드다.
    if (PLANNER_DETAIL_SCOPE_MODE[this.scope] === mode) { this.renderPalette(); return false; }
    const sc = PLANNER_DETAIL_MODE_SCOPE[mode];
    if (!sc) return false;
    this.setScope(sc, { fromList: true });
    return true;
  },

  /**
   * 페이지의 setActiveArea 가 부른다.
   *
   * 2026-09-16: **목록이 '배치' 일 때만** 범위를 배치로 옮긴다. 페이지는 불러오는 도중에도
   * setActiveArea 를 부르는데(마지막으로 보던 배치 복원), 그때 범위까지 배치로 끌고 가면
   * 좌측은 '개별' 인데 팔레트는 "배치 전체" 라고 적힌 어긋난 화면으로 들어오게 된다.
   * 배치 id 는 어느 모드에서나 기억해 둔다 — 나중에 '배치' 로 바꾸면 그 배치가 이미 골라져 있다.
   * 3D 에서 배치 상자를 직접 누른 경우는 pickArea 가 따로 범위를 옮긴다.
   */
  onAreaPick(areaId) {
    if (!this.active) return false;
    this.areaId = areaId || null;
    if (this.listMode() !== 'area') { this.refresh(); return true; }
    this.setScope('area', { fromList: true });
    return true;
  },

  /** 페이지의 setActiveModule 이 부른다 — 목록에서 모듈을 고르면 모듈 범위다. */
  onModulePick(moduleId) {
    if (!this.active || !moduleId) return false;
    const m = this.moduleOf(moduleId);
    const keep = this.picked && this.picked.moduleId === moduleId ? this.picked : null;
    this.picked = { moduleId, section: m ? m.section : null, slot: (keep && keep.slot) || 'door', partKey: null, kind: 'module', module: m };
    this.setScope('module', { fromList: true });
    return true;
  },

  /** 3D 에서 배치 상자를 눌렀을 때. 페이지가 노란 윤곽선·목록 선택을 맡는다 (setActiveArea). */
  pickArea(areaId) {
    if (!areaId) { this.toast('이 배치를 찾지 못했습니다'); return false; }
    this.areaId = areaId;
    if (this._o && typeof this._o.selectArea === 'function') {
      try { this._o.selectArea(areaId); } catch (e) { /* 무해 */ }
    }
    this.setScope('area');
    const a = this.areaOf(areaId);
    this.toast('🎯 배치 "' + this.areaLabel(a) + '" — 색을 고르면 이 배치 전체가 칠해집니다');
    return true;
  },

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
    // 배치 상자 — 그 배치가 범위가 된다 (칠하지는 않는다. 색을 고르는 순간 칠해진다).
    if (ud.entityKind === 'area') return this.pickArea(ud.areaId) || true;
    if (!ud.entityKind) {
      this.toast('무엇을 눌렀는지 알 수 없습니다 — 모듈의 부재(도어·몸통·상판…)를 누르세요');
      return true;
    }
    // 좌측 목록이 보고 있는 넓이가 곧 3D 클릭의 넓이다 — 배치 목록에서 도어를 눌러도 배치가 골라진다.
    const mode = this.listMode();
    if (mode === 'area') return this.pickArea(this.areaIdOf(this.moduleOf(ud.moduleId))) || true;
    if (mode === 'all') {
      this.setScope('item', { fromList: true });
      this.toast('🎯 품목 전체 — 색을 고르면 모든 모듈이 칠해집니다');
      return true;
    }
    return this.pickPart(ud, { module: !!(ev && ev.shiftKey) });
  },

  /**
   * 부재 하나를 고른다. 팔레트에 고른 마감이 있으면 곧 칠하고, 없으면 카드만 보여 준다(스포이드).
   * @param {object} ud   userData (moduleId 포함)
   * @param {{module?:boolean}} [opt] module:true 면 그 모듈의 **같은 슬롯** 전부 (Shift+클릭)
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
    // setScope 를 타지 않는다: Shift+클릭은 **누른 부재의 슬롯**으로 좁힌 모듈 범위다
    // (D0 때부터의 지름길 — 모듈 범위의 기본값 '전체' 로 덮으면 그 뜻이 사라진다).
    this.scope = (o.module || !partKey) ? 'module' : 'part';
    this.slot = slot;
    if (this.selectedCode) return this.applyScope() || true;
    this.renderCard();
    this.renderPalette();
    return true;
  },

  // ── 편집 ────────────────────────────────────────────────
  /**
   * 팔레트에서 색을 고른다. **고른 범위가 있으면 그 자리에서 칠한다** — 사용자가 말한 흐름이
   * "배치를 고른 뒤 색을 고르면 그 배치가 칠해진다" 이기 때문이다.
   * 범위가 비어 있으면(아직 아무것도 안 고름) 예전처럼 고르기만 한다 — 그 뒤 3D 를 누르면 칠해진다.
   */
  selectCode(code) {
    const next = (code && code !== this.selectedCode) ? code : null;
    this.selectedCode = next;
    if (next && this.hasScopeTarget()) { this.applyScope(next); return this.selectedCode; }
    this.renderPalette();
    this.renderCard();
    return this.selectedCode;
  },

  selectSlot(slot) {
    if (slot === PLANNER_DETAIL_SLOT_ALL || PLANNER_FINISH_SLOTS.indexOf(slot) >= 0) this.slot = slot;
    this.renderPalette();
    return this.slot;
  },

  // ── 범위 칠하기 ─────────────────────────────────────────
  /** 지금 슬롯 필터. null 이면 '전체'(범위 안에 실제로 있는 슬롯 전부). */
  slotFilter() {
    return (this.slot && this.slot !== PLANNER_DETAIL_SLOT_ALL) ? this.slot : null;
  },

  /** 지금 범위가 가리키는 모듈 id 들. */
  scopeModuleIds() {
    if (this.scope === 'item') return this.modules().map((m) => m.id);
    if (this.scope === 'area') return this.modulesInArea(this.areaId).map((m) => m.id);
    return this.picked ? [this.picked.moduleId] : [];
  },

  /** 색을 고르는 순간 칠할 것이 있는가. */
  hasScopeTarget() {
    if (this.scope === 'part') return !!this.picked;
    return this.scopeModuleIds().length > 0;
  },

  /**
   * 3D mesh 를 훑어 모듈마다 **실제로 있는 슬롯**과 부재 키→슬롯 표를 만든다.
   * 상판이 없는 모듈에 top 지정을 적지 않기 위해서다. paintScene 이 그릴 때마다 갱신한다.
   */
  scanPaintMap(group) {
    if (!group || typeof group.traverse !== 'function') return this._paintMap || {};
    const map = {};
    group.traverse((obj) => {
      if (!obj || !obj.isMesh) return;
      const ud = this._udWithModule(obj);
      if (!ud || !ud.moduleId) return;
      const slot = plannerFinishPaintSlotOf(ud);
      if (!slot) return;
      const rec = map[ud.moduleId] || (map[ud.moduleId] = { slots: {}, parts: {} });
      rec.slots[slot] = true;
      const pk = plannerFinishPartKeyOf(ud);
      if (pk) rec.parts[pk] = slot;
    });
    this._paintMap = map;
    return map;
  },

  /** 지금 3D 가 있으면 새로 훑고, 없으면 마지막에 훑은 것을 쓴다. */
  paintMap() {
    const t = this.three();
    const g = t && t.moduleGroup;
    if (g && typeof g.traverse === 'function') return this.scanPaintMap(g);
    return this._paintMap || {};
  },

  /**
   * 이 모듈들에 적을 슬롯. 3D 에 있는 슬롯만 적되, 사람이 슬롯을 **골라 두었으면** 그 하나다.
   * 3D 를 아직 못 읽었고(빈 표) 고른 슬롯도 없으면 빈 배열 — 무엇이 있는지 모르는 채로 적지 않는다.
   */
  slotsFor(moduleIds) {
    const filter = this.slotFilter();
    const map = this.paintMap();
    const seen = {};
    (moduleIds || []).forEach((id) => {
      const rec = map[id];
      if (rec) Object.keys(rec.slots).forEach((s) => { seen[s] = true; });
    });
    const found = PLANNER_FINISH_SLOTS.filter((s) => seen[s]);
    if (!filter) return found;
    if (found.length) return found.indexOf(filter) >= 0 ? [filter] : [];
    return [filter];   // 3D 를 못 읽었어도 사람이 고른 슬롯은 적는다
  },

  /** 이 모듈들의 부재 지정 중 이 슬롯에 걸리는 것을 지운다 — 안 지우면 아래 단계가 이긴다. */
  clearPartsIn(moduleIds, slots) {
    const all = !this.slotFilter();
    const map = this.paintMap();
    const want = {};
    (slots || []).forEach((s) => { want[s] = true; });
    (moduleIds || []).forEach((id) => {
      const parts = this.detail.parts && this.detail.parts[id];
      if (!parts) return;
      Object.keys(parts).forEach((pk) => {
        if (!all) {
          const s = map[id] && map[id].parts[pk];
          if (!s || !want[s]) return;
        }
        plannerFinishClear(this.detail, 'part', null, { moduleId: id, partKey: pk });
      });
    });
  },

  /**
   * 지금 범위 전체를 한 색으로 칠한다 — **되돌리기 한 장**.
   *   부재  → part 단계 한 칸 (D0 그대로)
   *   모듈  → 그 모듈의 module 단계, 있는 슬롯마다
   *   배치  → 그 배치 안 **모듈마다** module 단계 (모델에 배치 단계를 만들지 않는 이유는 파일 머리에)
   *   품목  → item 단계 + 섹션·모듈 지정 정리
   */
  applyScope(code) {
    const c = code || this.selectedCode;
    if (!c) { this.toast('팔레트에서 먼저 마감을 고르세요'); return false; }
    const sc = this.scope;
    if (sc === 'part') {
      const p = this.picked;
      if (!p) { this.toast('먼저 3D 에서 부재를 하나 누르세요'); return false; }
      if (!p.partKey) return this.apply('module', p.slot, { moduleId: p.moduleId, section: p.section }, c);
      return this.apply('part', p.slot, { moduleId: p.moduleId, section: p.section, partKey: p.partKey }, c);
    }
    const ids = this.scopeModuleIds();
    if (!ids.length) { this.toast('칠할 모듈이 없습니다 — 범위를 먼저 고르세요'); return false; }
    const slots = this.slotsFor(ids);
    if (!slots.length) {
      this.toast('3D 를 먼저 그려야 범위 전체를 칠할 수 있습니다 — 슬롯을 하나 골라도 됩니다');
      return false;
    }
    this.pushUndo();
    let n = 0;
    if (sc === 'item') {
      const groups = (typeof PlannerFinish !== 'undefined' && PlannerFinish && PlannerFinish.SECTION_GROUPS) || ['upper', 'lower'];
      slots.forEach((slot) => {
        if (!plannerFinishSet(this.detail, 'item', slot, c, {})) return;
        n++;
        groups.forEach((g) => plannerFinishClear(this.detail, 'section', slot, { section: g }));
        ids.forEach((id) => plannerFinishClear(this.detail, 'module', slot, { moduleId: id }));
      });
    } else {
      ids.forEach((id) => {
        this.slotsFor([id]).forEach((slot) => {
          if (plannerFinishSet(this.detail, 'module', slot, c, { moduleId: id })) n++;
        });
      });
    }
    this.clearPartsIn(ids, slots);
    if (!n) { this.undoStack.pop(); return false; }
    this.save();
    this.refresh();
    const entry = this.entryOf(c);
    this.toast('🎨 ' + this.scopeLabel() + ' ← ' + (entry ? entry.label : c) + ' (' + n + '건)');
    return true;
  },

  /** 팔레트 머리에 적는 한 줄 — 다음 색 클릭이 무엇을 칠하는가. */
  scopeLabel() {
    if (this.scope === 'item') return '품목 전체';
    if (this.scope === 'area') {
      const a = this.areaOf(this.areaId);
      if (!a && !this.areaId) return '배치 (고르지 않음)';
      return '배치 "' + this.areaLabel(a) + '" 전체 (모듈 ' + this.modulesInArea(this.areaId).length + '개)';
    }
    if (this.scope === 'module') {
      return this.picked ? ('모듈 ' + this.picked.moduleId + ' 전체') : '모듈 (고르지 않음)';
    }
    const p = this.picked;
    return p ? ('부재 ' + (p.partKey || plannerDetailSlotLabel(p.slot))) : '부재 (고르지 않음)';
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

  /**
   * 팔레트의 일괄 적용 줄. `section:upper` / `section:lower` (버튼) · `item` / `module` (프로그램용).
   * 범위 칠하기(applyScope)와 달리 **아래 단계를 지우지 않는다** — 섹션 기본값을 깔아 두는 손놀림이다.
   */
  applyBulk(target) {
    const c = this.selectedCode;
    if (!c) { this.toast('팔레트에서 먼저 마감을 고르세요'); return false; }
    const ids = this.modules().map((m) => m.id);
    if (target === 'item') return this.applyLevel('item', [{}], ids, c, '품목 전체');
    if (target === 'module') {
      if (!this.picked) { this.toast('먼저 3D 에서 모듈의 부재를 하나 누르세요'); return false; }
      const p = this.picked;
      return this.applyLevel('module', [{ moduleId: p.moduleId, section: p.section }], [p.moduleId], c, '이 모듈');
    }
    if (target === 'section:upper' || target === 'section:lower') {
      const g = target.split(':')[1];
      const mine = this.modules().filter((m) => plannerFinishSectionGroup(m.section) === g).map((m) => m.id);
      return this.applyLevel('section', [{ section: g }], mine.length ? mine : ids, c,
        g === 'upper' ? '상부 전체' : '하부 전체');
    }
    return false;
  },

  /** 한 단계에 여러 슬롯을 한꺼번에 적는다 — 되돌리기 한 장. */
  applyLevel(level, ctxs, scopeIds, code, where) {
    const slots = this.slotsFor(scopeIds);
    if (!slots.length) {
      this.toast('3D 를 먼저 그려야 한꺼번에 칠할 수 있습니다 — 슬롯을 하나 골라도 됩니다');
      return false;
    }
    this.pushUndo();
    let n = 0;
    (ctxs || []).forEach((ctx) => slots.forEach((slot) => {
      if (plannerFinishSet(this.detail, level, slot, code, ctx || {})) n++;
    }));
    if (!n) { this.undoStack.pop(); return false; }
    this.save();
    this.refresh();
    const entry = this.entryOf(code);
    this.toast('🎨 ' + (where || level) + ' ← ' + (entry ? entry.label : code) + ' (' + n + '건)');
    return true;
  },

  // ── 3D 색·재질 ──────────────────────────────────────────
  /** 이 mesh 가 받을 카탈로그 항목. 지정이 없거나 칠하지 않는 종류·모르는 코드면 null (구조 색 그대로). */
  entryFor(ud) {
    const slot = plannerFinishPaintSlotOf(ud);
    if (!slot || !ud.moduleId) return null;
    const m = this.moduleOf(ud.moduleId);
    const r = plannerFinishResolve(this.detail, slot, ud.moduleId, m ? m.section : null, plannerFinishPartKeyOf(ud));
    return r ? this.entryOf(r.code) : null;
  },

  /** 이 mesh 가 받을 hex. 지정이 없거나 칠하지 않는 종류면 null (구조 색 그대로). */
  colorFor(ud) {
    const e = this.entryFor(ud);
    return e ? e.hex : null;
  },

  /** mesh 자신에 moduleId 가 없으면 부모 그룹에서 보충한 userData. 못 찾으면 null. */
  _udWithModule(obj) {
    const ud = obj.userData || {};
    if (ud.moduleId) return ud;
    let cur = obj.parent, mid = null;
    while (cur && !mid) { if (cur.userData && cur.userData.moduleId) mid = cur.userData.moduleId; cur = cur.parent; }
    return mid ? Object.assign({}, ud, { moduleId: mid }) : null;
  },

  /**
   * renderAll3D 가 다 그린 뒤 부르는 후처리. mesh 를 만들지도 지우지도 않는다.
   *   three 가 있으면: 재질을 코드별 PBR(PlannerMaterials)로 **바꿔 끼운다**. 원래 재질은
   *                    userData._origMaterial 에 남겨 unpaintScene 이 되돌린다. 테두리(LineSegments)는 mesh 가 아니라 그대로.
   *   three 가 없으면: D0 처럼 material.color 만 덮는다 (makeBox 가 mesh 마다 재질을 새로 만드니 공유 재질을 더럽히지 않는다).
   * 모드가 아니면 0 을 돌려주고 손대지 않는다. 씬 설정(applyScene)이 아직이면 여기서 켠다 —
   * init3D 가 모드 진입보다 늦게 올 수 있어서다.
   * @param {{force?:boolean}} [opt] force: 모드 밖에서도 칠한다 — pushLook(렌더 캡처, D3)만 쓴다.
   * @returns {number} 칠한 mesh 수
   */
  paintScene(group, opt) {
    const force = !!(opt && opt.force);
    if ((!this.active && !force) || !group || typeof group.traverse !== 'function') return 0;
    if (!this._sceneSaved) this.applyScene(true);
    const T = (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
    const PM = (T && typeof PlannerMaterials !== 'undefined') ? PlannerMaterials : null;
    // 범위 칠하기가 "이 모듈에 상판이 있는가" 를 물을 표. 그리는 김에 같이 모은다.
    this.scanPaintMap(group);
    let n = 0;
    group.traverse((obj) => {
      if (!obj || !obj.isMesh || !obj.material) return;
      const ud = this._udWithModule(obj);
      if (!ud) return;
      const entry = this.entryFor(ud);
      if (!entry) return;
      if (PM) {
        const mat = PM.forMesh(entry, obj, T);
        if (!mat) return;
        if (obj.material !== mat) {
          if (!obj.userData._origMaterial) obj.userData._origMaterial = obj.material;
          obj.material = mat;
        }
        n++;
        return;
      }
      if (!obj.material.color || typeof obj.material.color.set !== 'function') return;
      obj.material.color.set(entry.hex);
      n++;
    });
    return n;
  },

  /**
   * D3: 디테일 룩(색공간·톤매핑·환경광·조명 절반 + PBR 재질)을 **잠깐** 켠다 — 렌더 캡처용.
   *   디테일 모드면 이미 켜져 있으니 아무것도 하지 않는 토큰을 돌려준다.
   *   구조 모드면 applyScene(true) + paintScene({force}) 로 켜고, 토큰에 "내가 켰다" 를 적는다.
   * popLook(token) 이 그 토큰대로만 되돌린다 — 모드에서 켠 것은 건드리지 않는다 (I2: 구조 모드는 캡처 전후 바이트 동일).
   * enter/exit 와 같은 함수(applyScene · paintScene · unpaintScene)를 타므로 두 벌이 아니다.
   * @returns {{scene:boolean, paint:boolean, group:object|null}}
   */
  pushLook() {
    const t = this.three();
    const tok = { scene: false, paint: false, group: (t && t.moduleGroup) || null };
    if (this.active) {
      // 모드가 주인이다. three 가 늦게 와서 아직 안 켜졌다면 여기서 켜 주되(paintScene 이 applyScene 을 부른다) 되돌리지 않는다.
      if (tok.group) this.paintScene(tok.group);
      return tok;
    }
    if (!this._sceneSaved) tok.scene = this.applyScene(true);
    if (tok.group) {
      this.paintScene(tok.group, { force: true });
      tok.paint = true;
    }
    return tok;
  },

  /** pushLook 의 토큰대로 되돌린다. 두 번 불러도 무해. */
  popLook(tok) {
    if (!tok) return false;
    if (tok.paint && tok.group) this.unpaintScene(tok.group);
    if (tok.scene) this.applyScene(false);
    tok.paint = false;
    tok.scene = false;
    return true;
  },

  /** paintScene 이 바꿔 끼운 재질을 원래 것으로 되돌린다. 모드와 무관하게 동작한다 (이탈 경로). */
  unpaintScene(group) {
    if (!group || typeof group.traverse !== 'function') return 0;
    let n = 0;
    group.traverse((obj) => {
      if (!obj || !obj.isMesh || !obj.userData || !obj.userData._origMaterial) return;
      obj.material = obj.userData._origMaterial;
      delete obj.userData._origMaterial;
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

  /**
   * 팔레트 머리의 출처 표시.
   *   db      → "예림 LUX 144"       (materials 표를 읽었다)
   *   local   → "카탈로그 7×10"      (DB 없음 — bom-finish-color.js 의 구 표만)
   *   builtin → "폴백 목록"          (그것도 없음 — planner-finish.js 의 내장 표)
   * 크기는 정본이 정한다 — 숫자를 박지 않는다.
   */
  catalogSourceLabel() {
    const c = this.catalog;
    if (!c) return '';
    if (c.source === 'db') return `예림 LUX ${c.yerim}`;
    if (c.source === 'builtin' || (c.source == null && c.fallback)) return '폴백 목록';
    const finishes = Array.isArray(c.finishes) ? c.finishes : [];
    const nF = finishes.length;
    // 마감×색 표의 크기다 — C2b 호환 코드({COLOR}-M/G, compatTone)는 같은 호환 그룹에 있지만 표의 칸이 아니라 뺀다.
    const entries = Array.isArray(c.entries) ? c.entries : [];
    const compatGroup = Array.isArray(c.groups) ? c.groups.find((g) => g.compat) : null;
    const local = compatGroup
      ? entries.filter((e) => e.group === compatGroup.key && !e.compatTone).length
      : entries.filter((e) => !e.compatTone).length;
    const nC = nF ? Math.round(local / nF) : 0;
    return `카탈로그 ${nF}×${nC}`;
  },

  renderPalette() {
    const host = (typeof document !== 'undefined') ? document.getElementById('detailPalette') : null;
    if (!host || !this.catalog) return;
    const esc = plannerDetailEsc;
    const sel = this.entryOf(this.selectedCode);
    const parts = [];
    parts.push(`<div class="pd-head"><span>마감 팔레트</span><span class="pd-src">${esc(this.catalogSourceLabel())}</span></div>`);
    // 범위 한 줄 — 다음 색 클릭이 무엇을 칠하는가. 되돌리기도 여기 붙는다.
    parts.push('<div class="pd-scope"><span class="pd-scope-text">다음 색 → <b>' + esc(this.scopeLabel()) + '</b>'
      + `<span class="pd-scope-sub">슬롯 ${esc(plannerDetailSlotLabel(this.slot))} · 좌측 목록의 전체·배치·개별 이 곧 범위입니다</span></span>`
      + `<button type="button" data-undo="1"${this.undoStack.length ? '' : ' disabled'} title="마지막 칠하기를 되돌립니다">↶ 되돌리기 (${this.undoStack.length})</button></div>`);
    parts.push('<div class="pd-sel">' + (sel
      ? `<span class="pd-chip" style="background:${esc(sel.hex)}"></span><b>${esc(sel.label)}</b><code>${esc(sel.code)}</code>`
      : '<span class="pd-hint">아래에서 마감을 고르세요 — 고르지 않고 부재를 누르면 지정된 마감을 보여 줍니다</span>') + '</div>');
    parts.push('<div class="pd-label">슬롯 (칠할 대상 좁히기)</div>');
    parts.push('<div class="pd-slots">'
      + `<button type="button" data-slot="${PLANNER_DETAIL_SLOT_ALL}" class="${this.slot === PLANNER_DETAIL_SLOT_ALL ? 'on' : ''}" title="범위 안에 있는 슬롯 전부">전체</button>`
      + PLANNER_FINISH_SLOTS.map((s) =>
        `<button type="button" data-slot="${s}" class="${s === this.slot ? 'on' : ''}">${esc(plannerDetailSlotLabel(s))}</button>`).join('')
      + '</div>');
    const dis = sel ? '' : ' disabled';
    // 섹션(상/하)은 범위가 아니다 — 목록에 없는 묶음이라 버튼으로 남긴다.
    parts.push('<div class="pd-label">섹션 기본값 한꺼번에</div>');
    parts.push('<div class="pd-bulk">'
      + `<button type="button" data-bulk="section:upper"${dis}>상부 전체</button>`
      + `<button type="button" data-bulk="section:lower"${dis}>하부 전체</button>`
      + '</div>');
    parts.push('<div class="pd-hint">3D: 배치 상자 = 그 배치 전체 · 부재 = 그 부재 · Shift+부재 = 그 모듈의 같은 슬롯</div>');
    parts.push(`<div class="pd-tools"><span class="pd-hint">지정 ${plannerFinishCount(this.detail)}건</span></div>`);
    parts.push(`<input type="search" class="pd-search" data-search="1" placeholder="이름·코드 검색" value="${esc(this.query)}" autocomplete="off">`);
    parts.push('<div class="pd-groups" data-groups="1"></div>');
    host.innerHTML = parts.join('');
    host.querySelectorAll('[data-slot]').forEach((el) => { el.onclick = () => this.selectSlot(el.dataset.slot); });
    host.querySelectorAll('[data-bulk]').forEach((el) => { el.onclick = () => this.applyBulk(el.dataset.bulk); });
    const u = host.querySelector('[data-undo]');
    if (u) u.onclick = () => this.undo();
    const q = host.querySelector('[data-search]');
    if (q) q.oninput = () => this.setQuery(q.value);
    this.renderGroups();
  },

  /** 검색어를 바꾸고 그룹만 다시 그린다 — 입력칸을 다시 만들면 포커스가 날아간다. */
  setQuery(q) {
    this.query = String(q == null ? '' : q);
    this.renderGroups();
    return this.query;
  },

  /**
   * 지금 슬롯·검색어에 맞는 그룹 목록. [{group, entries}] — entries 가 빈 그룹은 뺀다.
   * 슬롯 필터: 그룹의 slots 에 지금 슬롯이 없으면 숨긴다 (몸통 → body_material, 상판 → countertop,
   * 도어·서랍 앞판 → door_material). 호환 그룹은 슬롯 전부를 가져 언제나 남는다.
   */
  visibleGroups() {
    const c = this.catalog;
    if (!c || !Array.isArray(c.entries)) return [];
    const byCode = c.byCode || {};
    const lookup = (code) => byCode[code] || plannerFinishLookup(c, code);
    const q = String(this.query || '').trim().toLowerCase();
    const match = (e) => !q || [e.code, e.colorLabel, e.label, e.vendorCode].some((s) => String(s || '').toLowerCase().indexOf(q) >= 0);
    // planner-catalog.js 가 없을 때(D0 모양의 카탈로그) — finishes 를 그룹으로 본다
    const groups = Array.isArray(c.groups) ? c.groups
      : (c.finishes || []).map((f) => ({ key: f.value, label: f.label, codes: c.entries.filter((e) => e.finish === f.value).map((e) => e.code), slots: PLANNER_FINISH_SLOTS.slice(), compat: false, collapsed: false }));
    const out = [];
    const filter = this.slotFilter();   // '전체' 면 그룹을 걸러내지 않는다
    groups.forEach((g) => {
      if (filter && Array.isArray(g.slots) && g.slots.indexOf(filter) < 0) return;
      const entries = g.codes.map(lookup).filter((e) => e && match(e));
      if (!entries.length) return;
      out.push({ group: g, entries });
    });
    return out;
  },

  renderGroups() {
    const host = (typeof document !== 'undefined') ? document.querySelector('#detailPalette [data-groups]') : null;
    if (!host) return;
    const esc = plannerDetailEsc;
    const vis = this.visibleGroups();
    if (!vis.length) {
      host.innerHTML = `<div class="pd-hint">${this.query ? '검색 결과가 없습니다' : `${esc(plannerDetailSlotLabel(this.slot))} 슬롯에 맞는 자재가 없습니다`} — 슬롯·검색어를 바꿔 보세요</div>`;
      return;
    }
    host.innerHTML = vis.map(({ group: g, entries }) => {
      const open = (g.key in this.groupOpen) ? this.groupOpen[g.key] : (!!this.query || !g.collapsed);
      return `<details class="pd-group${g.compat ? ' compat' : ''}" data-group="${esc(g.key)}"${open ? ' open' : ''}>`
        + `<summary><span>${esc(g.label)}</span><span class="pd-count">${entries.length}</span></summary>`
        + '<div class="pd-swatches">'
        + entries.map((e) => `<button type="button" class="pd-swatch${e.code === this.selectedCode ? ' on' : ''}${plannerDetailIsDark(e.hex) ? ' dark' : ''}" `
          + `data-code="${esc(e.code)}" title="${esc(e.label)} · ${esc(e.code)}">`
          + `<span class="pd-chipbox" style="background:${esc(e.hex)}"></span>`
          + `<span class="pd-name">${esc(e.colorLabel || e.label)}</span>`
          + `<span class="pd-code">${esc(e.vendorCode || e.code)}</span></button>`).join('')
        + '</div></details>';
    }).join('');
    host.querySelectorAll('[data-code]').forEach((el) => { el.onclick = () => this.selectCode(el.dataset.code); });
    host.querySelectorAll('details[data-group]').forEach((el) => {
      el.ontoggle = () => { this.groupOpen[el.dataset.group] = !!el.open; };
    });
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
  window.PLANNER_DETAIL_SCOPES = PLANNER_DETAIL_SCOPES;
  window.PLANNER_DETAIL_SLOT_ALL = PLANNER_DETAIL_SLOT_ALL;
  window.plannerDetailWantsStage = plannerDetailWantsStage;
  window.plannerDetailSearchWith = plannerDetailSearchWith;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_DETAIL_KEY_BASE,
    PLANNER_DETAIL_UNDO_MAX,
    PLANNER_DETAIL_AUTOSAVE_MS,
    PLANNER_DETAIL_CSS,
    PLANNER_DETAIL_SCOPES,
    PLANNER_DETAIL_SLOT_ALL,
    PLANNER_DETAIL_MODE_SCOPE,
    PLANNER_DETAIL_SCOPE_MODE,
    plannerDetailSlotLabel,
    plannerDetailWantsStage,
    plannerDetailSearchWith,
    plannerDetailIsDark,
    PlannerDetail,
  };
}
