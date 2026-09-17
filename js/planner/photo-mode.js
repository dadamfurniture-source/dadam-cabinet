// ============================================================
// P1: 사진 모드 — photo-mode.js (사진을 3D 뒤에 깔고, 푼 카메라로 렌더, 사각형을 끌어 맞춘다)
//
// `photo-bg.js` 가 상태와 계산을 맡고, 여기는 **화면**을 맡는다. 계획 §5 P1.
//
//   ┌ #canvasWrap ─────────────────────────────┐
//   │  <img>  사진          ← 3D 캔버스 **뒤**   │  scene.background = null 이라 알파로 비친다
//   │  <canvas id=canvas3d> 가구                │  푼 카메라로, 사진과 같은 종횡비의 레터박스 안에
//   │  <svg>  사각형 편집기 ← 맨 위              │  이름표 붙은 네 귀퉁이 + 원근 격자
//   └──────────────────────────────────────────┘
//
// ── 왜 화면 카메라를 쓰지 않는가 (G3·G4) ────────────────────
//
//   화면 카메라는 OrbitControls 의 것이고 매 프레임 `controls.update()` 가 덮어쓴다. 리사이즈와
//   뷰 전환도 `camera.aspect` 를 덮는다. 그래서 캡처가 한 선례를 그대로 따른다 — **별도 카메라**를
//   세워 그 카메라로만 그린다 (`planner-capture.js:469-474` 의 조립과 같은 모양이다. `plannerPhotoCamera`
//   가 `plannerCaptureFrame` 과 같은 모양을 내주기 때문에 코드가 두 벌이 아니다).
//   사진 모드에서 궤도·줌은 **끈다** — 카메라는 사진의 것이지 사용자의 것이 아니다.
//
// ── 레터박스 ────────────────────────────────────────────
//
//   사진의 종횡비와 캔버스의 종횡비는 다르다. 캔버스 전체에 그리면 원근이 늘어나 합성이 통째로
//   어긋난다. 그래서 캔버스 안에 사진 종횡비의 상자를 잡고 (`plannerPhotoModeBox`), 렌더는
//   scissor+viewport 로 그 상자에만, 사진 `<img>` 와 편집기 `<svg>` 도 **같은 상자**에 놓는다.
//   셋이 정확히 같은 사각형을 쓰는 것이 이 모드의 전부다.
//
// ── 복원 규율 (I2) ──────────────────────────────────────
//
//   `applyScene` 이 세운 규율 그대로다 — **바꾸기 전 값을 전부 적어 두고, 나갈 때 그대로 되돌린다.**
//   여기서 적어 두는 것: scene.background · controls.enabled · 바닥판/그리드/원점 마커의 visible ·
//   도어 테두리 막대의 visible · renderer 의 viewport/scissor/scissorTest.
//   (조명·색공간·재질은 디테일 모드가 이미 주인이다 — 건드리지 않는다.)
//   `__tests__/photo-mode.test.js` 가 들어가기 전 값을 찍어 두고 나온 뒤와 대조한다.
//
// ── 도어 테두리 (G7) ────────────────────────────────────
//
//   `keepDoorEdgesVisible` 는 멀어져도 도어가 낱장으로 읽히게 검은 막대를 매 프레임 키운다.
//   사진 위에서는 그 검은 선이 만화처럼 읽힌다. 사진 모드에서는 끄고, 나갈 때 되돌린다.
//   씬은 `renderAll3D` 가 언제든 다시 만들므로 **매 프레임** 숨긴다 (원래 값은 처음 본 것만 적어 둔다).
//
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 plannerPhotoMode / PLANNER_PHOTO_MODE_ / PlannerPhotoMode 접두.
//   three 는 전역 window.THREE. 없으면 모드는 상태만 바꾸고 조용히 아무것도 그리지 않는다 (jsdom).
// ============================================================

/** 사진 레이어·편집기의 DOM id */
const PLANNER_PHOTO_MODE_IMG_ID = 'photoBgLayer';
const PLANNER_PHOTO_MODE_SVG_ID = 'photoQuadEditor';
/** 우측 패널 섹션 (data-sec="photo") 의 본문 */
const PLANNER_PHOTO_MODE_PANEL_ID = 'photoBgBody';
/** 원근 격자 칸 수 (가로·세로 각각) */
const PLANNER_PHOTO_MODE_GRID = 4;
/** 미세조정 한 번에 움직이는 양 (mm · 도) */
const PLANNER_PHOTO_MODE_STEP_MM = 50;
const PLANNER_PHOTO_MODE_STEP_BIG_MM = 200;
const PLANNER_PHOTO_MODE_STEP_DEG = 2;
/** 사진 모드에서 숨기는 씬 자식 — 바닥판·그리드는 init3D 가, 원점 마커는 renderAll3D 가 만든다 */
const PLANNER_PHOTO_MODE_HIDE_KINDS = { ground: true, grid: true, origin: true };

const PLANNER_PHOTO_MODE_CSS = `
#${PLANNER_PHOTO_MODE_IMG_ID}{position:absolute;display:block;object-fit:fill;pointer-events:none;background:#000}
#${PLANNER_PHOTO_MODE_SVG_ID}{position:absolute;overflow:visible;touch-action:none}
#${PLANNER_PHOTO_MODE_SVG_ID} .pq-edge{fill:none;stroke:#ffd54a;stroke-width:2;stroke-linejoin:round}
#${PLANNER_PHOTO_MODE_SVG_ID} .pq-fill{fill:rgba(255,213,74,.10);stroke:none}
#${PLANNER_PHOTO_MODE_SVG_ID} .pq-grid{fill:none;stroke:rgba(255,213,74,.55);stroke-width:1}
#${PLANNER_PHOTO_MODE_SVG_ID} .pq-handle{fill:#fff;stroke:#6a4b2a;stroke-width:2;cursor:grab}
#${PLANNER_PHOTO_MODE_SVG_ID} .pq-handle:hover{fill:#ffd54a}
#${PLANNER_PHOTO_MODE_SVG_ID}.pq-locked .pq-handle{cursor:not-allowed;opacity:.5}
#${PLANNER_PHOTO_MODE_SVG_ID} .pq-tag{font:600 11px/1 system-ui,sans-serif;fill:#2b2620;paint-order:stroke;stroke:#fff;stroke-width:3;pointer-events:none;user-select:none}
.pb-panel{display:flex;flex-direction:column;gap:8px;font-size:11px;color:var(--text,#2b2620)}
.pb-drop{border:1px dashed var(--brand-mid,#c8ab86);border-radius:6px;background:var(--brand-soft,#f6efe4);padding:10px 8px;text-align:center;cursor:pointer;line-height:1.5}
.pb-drop.pb-over{background:#fff4dd;border-color:var(--brand-deep,#6a4b2a)}
.pb-drop b{display:block;font-size:11.5px;color:var(--brand-deep,#6a4b2a)}
.pb-drop span{font-size:10px;color:var(--text-dim,#7a7062)}
.pb-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pb-row label{font-size:10px;font-weight:600;color:var(--text-dim,#7a7062);min-width:52px}
.pb-row select,.pb-row input[type=range]{flex:1;min-width:0;font-family:inherit;font-size:11px}
.pb-row button,.pb-tools button{border:1px solid var(--line,#e5e0d4);background:#fff;color:var(--text,#2b2620);padding:3px 8px;border-radius:999px;font-size:10.5px;cursor:pointer;font-family:inherit}
.pb-row button:disabled{opacity:.4;cursor:not-allowed}
.pb-nudge{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
.pb-nudge button{padding:4px 0}
.pb-health{border-radius:6px;padding:6px 8px;line-height:1.5;font-size:10.5px;border:1px solid}
.pb-health.good{background:#eef7ec;border-color:#8fbf86;color:#2f5c29}
.pb-health.rough{background:#fdf5e3;border-color:#d8b871;color:#6a4b2a}
.pb-health.bad{background:#fbecec;border-color:#d99a9a;color:#8a2f2f}
.pb-hint{font-size:10px;color:var(--text-faint,#a89c84);line-height:1.5}
.pb-meta{font-size:9.5px;color:var(--text-faint,#a89c84)}
`;

function plannerPhotoModeInjectCss() {
  if (typeof document === 'undefined' || document.getElementById('planner-photo-mode-css')) return;
  const st = document.createElement('style');
  st.id = 'planner-photo-mode-css';
  st.textContent = PLANNER_PHOTO_MODE_CSS;
  document.head.appendChild(st);
}

function plannerPhotoModeEsc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 캔버스 안에 사진 종횡비로 잡는 상자 (레터박스). 좌상단 기준 CSS 픽셀.
 * 순수 함수 — 시험이 three 없이 본다.
 * @returns {{x:number, y:number, width:number, height:number}}
 */
function plannerPhotoModeBox(canvasW, canvasH, aspect) {
  const W = Math.max(1, Number(canvasW) || 1);
  const H = Math.max(1, Number(canvasH) || 1);
  const a = (Number(aspect) > 0 && Number.isFinite(Number(aspect))) ? Number(aspect) : W / H;
  let w = W, h = W / a;
  if (h > H) { h = H; w = H * a; }
  return { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h };
}

/** 레터박스 상자 → three 뷰포트 (y 가 아래에서 센다) */
function plannerPhotoModeViewport(box, canvasH) {
  return { x: box.x, y: Math.max(0, (Number(canvasH) || 0) - box.y - box.height), width: box.width, height: box.height };
}

/** 사진 정규 좌표 → 상자 안 CSS 픽셀 */
function plannerPhotoModeToBox(pt, box) {
  return [box.x + pt[0] * box.width, box.y + pt[1] * box.height];
}

/** 상자 안 CSS 픽셀 → 사진 정규 좌표 (0~1 로 자른다 — 사각형은 사진 안에 있어야 한다) */
function plannerPhotoModeFromBox(x, y, box) {
  const u = box.width > 0 ? (x - box.x) / box.width : 0;
  const v = box.height > 0 ? (y - box.y) / box.height : 0;
  return [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))];
}

const PlannerPhotoMode = {
  active: false,
  /** 페이지가 넘긴 것 (mount) */
  _o: null,
  /** 지금 푼 카메라 프레임 (plannerCaptureFrame 과 같은 모양) */
  frame: null,
  /** 지금 건강 상태 (photo-bg 의 quadHealth) */
  health: null,
  /** 들어올 때 적어 둔 값 — 나갈 때 이대로 되돌린다 */
  _saved: null,
  /** 별도 카메라 (three). 화면 카메라는 건드리지 않는다 */
  _cam: null,
  /** 마지막으로 그린 레터박스 — 바뀔 때만 DOM 을 건드린다 */
  _box: null,
  _drag: null,

  Box: plannerPhotoModeBox,

  mount(o) {
    this._o = o || {};
    const BG = this.bg();
    if (BG) {
      BG.load();
      BG.onChange = () => { this.solve(); this.paint(); };
    }
    return this;
  },

  /** photo-bg.js. 없으면 모드가 뜨지 않는다 (스크립트 순서가 틀린 것이다). */
  bg() {
    if (typeof PlannerPhotoBg !== 'undefined' && PlannerPhotoBg) return PlannerPhotoBg;
    if (typeof window !== 'undefined' && window.PlannerPhotoBg) return window.PlannerPhotoBg;
    return null;
  },

  /** photo-solve.js */
  solver() {
    if (typeof PlannerPhotoSolve !== 'undefined' && PlannerPhotoSolve) return PlannerPhotoSolve;
    if (typeof window !== 'undefined' && window.PlannerPhotoSolve) return window.PlannerPhotoSolve;
    return null;
  },

  T() { return (typeof window !== 'undefined' && window.THREE) ? window.THREE : null; },

  three() {
    if (!this._o || typeof this._o.three !== 'function') return null;
    try { return this._o.three() || null; } catch (e) { return null; }
  },

  toast(text) {
    if (this._o && typeof this._o.toast === 'function') { try { this._o.toast(text); } catch (e) { /* 무해 */ } }
  },

  areas() {
    if (!this._o || typeof this._o.areas !== 'function') return [];
    try { return this._o.areas() || []; } catch (e) { return []; }
  },

  origin() {
    if (!this._o || typeof this._o.origin !== 'function') return { x: 0, y: 0 };
    try { return this._o.origin() || { x: 0, y: 0 }; } catch (e) { return { x: 0, y: 0 }; }
  },

  isActive() { return this.active; },

  // ── 배치 공간 ──────────────────────────────────────────

  /** 지금 고른 배치 공간 id. 없으면 스코프(디테일 모드)가 보고 있는 것 → 첫 배치. */
  areaId() {
    const BG = this.bg();
    const saved = BG && BG.state && BG.state.plane ? BG.state.plane.areaId : null;
    const list = this.areas();
    if (saved != null && list.some((a) => a && a.id === saved)) return saved;
    let want = null;
    if (this._o && typeof this._o.activeAreaId === 'function') {
      try { want = this._o.activeAreaId(); } catch (e) { want = null; }
    }
    if (want != null && list.some((a) => a && a.id === want)) return want;
    return list.length ? list[0].id : null;
  },

  /** 지금 배치 공간의 **실제** 바닥 사각형. 치수는 언제나 여기서 온다 (2026-09-17 결정). */
  rect() {
    const BG = this.bg();
    if (!BG) return null;
    const id = this.areaId();
    const area = this.areas().find((a) => a && a.id === id);
    if (area) return plannerPhotoBgRectFromArea(area, this.origin());
    // 배치가 사라진 저장본 — 적어 둔 치수로 버틴다 (P3 에서 행이 정본이 된다)
    return (typeof plannerPhotoBgRectFromPlane === 'function')
      ? plannerPhotoBgRectFromPlane(BG.state.plane)
      : null;
  },

  /** 배치 공간을 바꾼다 — plane 을 다시 적고 카메라를 다시 푼다. */
  setArea(id) {
    const BG = this.bg();
    if (!BG) return false;
    const area = this.areas().find((a) => a && String(a.id) === String(id));
    if (!area) return false;
    const rect = plannerPhotoBgRectFromArea(area, this.origin());
    if (!rect) return false;
    BG.patch({ plane: plannerPhotoBgPlaneFromRect(rect) });
    return true;
  },

  // ── 풀기 ───────────────────────────────────────────────

  /**
   * 지금 사각형·배치 공간·화각으로 카메라를 다시 푼다. 모드의 심장이다 — 사각형을 한 픽셀 끌 때마다
   * 여기로 온다. 8×8 하나라 매 드래그마다 풀어도 사람 눈에는 즉시다.
   *
   * 화각은 세 갈래다:
   *   ① 사용자가 슬라이더로 고정했다      → 그 값으로
   *   ② 소실점으로 풀린다 (method:'vanishing') → 그대로 둔다
   *   ③ 퇴화라 못 푼다 (method:'assumed')  → **자동으로 훑어** 오차가 가장 작은 화각을 고른다
   *      (P0 측정: 틀린 화각은 재투영 오차로 드러난다 — photo-solve.md)
   */
  solve() {
    const BG = this.bg();
    const S = this.solver();
    this.frame = null;
    this.health = null;
    if (!BG || !S) return null;
    const img = BG.image;
    const rect = this.rect();
    if (!img || !rect) return null;
    const st = BG.state;
    const opt = { nudge: st.nudge };
    if (st.fovDeg != null) opt.fovDeg = st.fovDeg;
    let health = plannerPhotoBgQuadHealth(st.quad, rect, img.width, img.height, opt);
    // ③ 퇴화 — 가정 화각(60°)으로 떨어졌다면 훑어서 더 나은 값을 찾는다. 숨기지 않고 슬라이더에도 적는다.
    if (st.fovDeg == null && health.camera && health.camera.method === 'assumed') {
      const fit = plannerPhotoBgFitFov(st.quad, plannerPhotoBgSolveRect(rect, st.nudge), img.width, img.height);
      if (fit && fit.reprojectionPx < (health.reprojectionPx == null ? Infinity : health.reprojectionPx)) {
        health = plannerPhotoBgQuadHealth(st.quad, rect, img.width, img.height,
          Object.assign({}, opt, { fovDeg: fit.fovDeg }));
        this._autoFov = fit.fovDeg;
      }
    } else {
      this._autoFov = null;
    }
    this.health = health;
    this.frame = health.camera || null;
    return this.frame;
  },

  /** 「화각 자동 맞춤」 — 재투영 오차가 가장 작은 화각을 찾아 **슬라이더에 박는다**. */
  autoFov() {
    const BG = this.bg();
    const img = BG && BG.image;
    const rect = this.rect();
    if (!BG || !img || !rect) return null;
    const fit = plannerPhotoBgFitFov(BG.state.quad, plannerPhotoBgSolveRect(rect, BG.state.nudge), img.width, img.height);
    if (!fit) { this.toast('⚠ 화각을 찾지 못했습니다 — 사각형을 먼저 맞춰 보세요'); return null; }
    BG.patch({ fovDeg: Math.round(fit.fovDeg * 10) / 10 });
    this.toast(`화각 ${Math.round(fit.fovDeg)}° · 재투영 오차 ${Math.round(fit.reprojectionPx * 10) / 10}px`);
    return fit.fovDeg;
  },

  // ── 모드 ───────────────────────────────────────────────

  enter() {
    if (this.active) return false;
    const BG = this.bg();
    if (!BG) return false;
    if (!BG.image) {
      // 사진이 없어도 들어간다 — 패널이 "사진을 올리세요" 를 보여 주는 것이 이 모드의 첫 화면이다.
      this.toast('🖼 사진 모드 — 우측에서 방 사진을 올리세요');
    }
    this.active = true;
    plannerPhotoModeInjectCss();
    try { document.body.classList.add('photo-mode'); } catch (e) { /* DOM 없음 */ }
    this._pill(true);
    // 배치 공간을 아직 안 골랐으면 지금 보고 있는 것으로 채운다
    if (!BG.state.plane || BG.state.plane.areaId == null) {
      const id = this.areaId();
      if (id != null) this.setArea(id);
    }
    this.applyScene(true);
    this.solve();
    this.paint();
    return true;
  },

  exit() {
    if (!this.active) return false;
    this.active = false;
    try { document.body.classList.remove('photo-mode'); } catch (e) { /* DOM 없음 */ }
    this._pill(false);
    this.applyScene(false);
    this._box = null;
    this._drag = null;
    const img = document.getElementById(PLANNER_PHOTO_MODE_IMG_ID);
    if (img) img.hidden = true;
    const svg = document.getElementById(PLANNER_PHOTO_MODE_SVG_ID);
    if (svg) svg.hidden = true;
    this.renderPanel();
    return true;
  },

  toggle() { return this.active ? this.exit() : this.enter(); },

  _pill(on) {
    const b = (typeof document !== 'undefined') ? document.getElementById('photoModeBtn') : null;
    if (b) b.classList.toggle('on', !!on);
  },

  /**
   * 씬을 사진 합성용으로 바꾸고(on) 되돌린다(off). **바꾸기 전 값을 전부 적어 둔다** —
   * `PlannerDetail.applyScene` 의 규율 그대로다 (I2: 나가면 들어오기 전과 같아야 한다).
   * three 가 없으면(jsdom) 아무것도 하지 않고 false — 모드 자체는 돈다.
   */
  applyScene(on) {
    const t = this.three();
    if (on) {
      if (this._saved || !t || !t.scene) return false;
      const saved = { background: t.scene.background, controls: null, hidden: [], viewport: null, scissor: null, scissorTest: null };
      try { t.scene.background = null; } catch (e) { /* 무해 */ }
      if (t.controls && 'enabled' in t.controls) {
        saved.controls = t.controls.enabled;
        try { t.controls.enabled = false; } catch (e) { /* 무해 */ }
      }
      // 바닥판·그리드·원점 마커 — 사진 위에 깔리면 바닥이 두 겹이 된다
      this._hideProps(t, saved.hidden);
      const T = this.T();
      const r = t.renderer;
      if (r && T && T.Vector4 && typeof r.getViewport === 'function') {
        try {
          saved.viewport = r.getViewport(new T.Vector4());
          if (typeof r.getScissor === 'function') saved.scissor = r.getScissor(new T.Vector4());
          if (typeof r.getScissorTest === 'function') saved.scissorTest = r.getScissorTest();
        } catch (e) { /* 값 주머니 renderer 면 없을 수 있다 */ }
      }
      this._saved = saved;
      return true;
    }
    const saved = this._saved;
    if (!saved) return false;
    this._saved = null;
    if (t && t.scene) { try { t.scene.background = saved.background; } catch (e) { /* 무해 */ } }
    if (t && t.controls && saved.controls != null) { try { t.controls.enabled = saved.controls; } catch (e) { /* 무해 */ } }
    saved.hidden.forEach((h) => { try { h.obj.visible = h.visible; delete h.obj.userData._photoHidden; } catch (e) { /* 무해 */ } });
    const r = t && t.renderer;
    if (r) {
      try {
        if (typeof r.setScissorTest === 'function') r.setScissorTest(saved.scissorTest == null ? false : saved.scissorTest);
        if (saved.viewport && typeof r.setViewport === 'function') r.setViewport(saved.viewport);
        if (saved.scissor && typeof r.setScissor === 'function') r.setScissor(saved.scissor);
      } catch (e) { /* 무해 */ }
    }
    return true;
  },

  /**
   * 사진 위에 있으면 안 되는 것들을 숨긴다 — 바닥판·그리드(씬 자식) · 원점 마커 · 도어 테두리(G7).
   * 원래 값은 **처음 본 것만** 적어 둔다 (`renderAll3D` 가 씬을 다시 만들어도 두 번 적지 않는다).
   */
  _hideProps(t, into) {
    const list = into || (this._saved && this._saved.hidden);
    if (!list || !t) return 0;
    let n = 0;
    const take = (obj) => {
      if (!obj || !obj.userData || obj.userData._photoHidden) return;
      obj.userData._photoHidden = true;
      list.push({ obj, visible: obj.visible !== false });
      obj.visible = false;
      n++;
    };
    try {
      (t.scene && t.scene.children ? t.scene.children : []).forEach((ch) => {
        if (!ch) return;
        const kind = ch.userData && ch.userData.entityKind;
        if ((kind && PLANNER_PHOTO_MODE_HIDE_KINDS[kind]) || ch.isGridHelper) take(ch);
      });
    } catch (e) { /* children 이 없으면 숨길 것도 없다 */ }
    try {
      if (t.moduleGroup && typeof t.moduleGroup.traverse === 'function') {
        t.moduleGroup.traverse((obj) => {
          const kind = obj && obj.userData && obj.userData.entityKind;
          if (kind === 'origin' || kind === 'doorEdge') take(obj);
        });
      }
    } catch (e) { /* 무해 */ }
    return n;
  },

  // ── 매 프레임 ─────────────────────────────────────────

  /**
   * `animate()` 가 사진 모드일 때 대신 부른다 (`mockup-structure.html` init3D).
   * 화면 카메라·컨트롤은 **건드리지 않는다** — 별도 카메라로 레터박스 안에만 그린다.
   * @returns {boolean} 그렸으면 true. false 면 페이지가 평소대로 그린다.
   */
  renderFrame(t) {
    if (!this.active) return false;
    const T = this.T();
    if (!t || !t.renderer || !t.scene || !T) return false;
    // 씬이 다시 만들어졌을 수 있다 — 숨길 것은 매 프레임 확인한다 (원래 값은 처음 본 것만 적힌다)
    this._hideProps(t, null);
    const f = this.frame;
    if (!f) { this._unscissor(t.renderer); return false; }   // 아직 못 풀었다 — 평소대로 그리게 두되 잘라내기는 푼다
    const r = t.renderer;
    let size = null;
    try { size = (T.Vector2 && typeof r.getSize === 'function') ? r.getSize(new T.Vector2()) : null; } catch (e) { size = null; }
    const cw = size && size.x > 0 ? size.x : 0;
    const ch = size && size.y > 0 ? size.y : 0;
    if (!cw || !ch) return false;
    const box = plannerPhotoModeBox(cw, ch, f.aspect);
    const cam = this._camera(T, f, box);
    if (!cam) return false;
    const vp = plannerPhotoModeViewport(box, ch);
    try {
      if (typeof r.setViewport === 'function') r.setViewport(vp.x, vp.y, vp.width, vp.height);
      if (typeof r.setScissor === 'function') r.setScissor(vp.x, vp.y, vp.width, vp.height);
      if (typeof r.setScissorTest === 'function') r.setScissorTest(true);
      r.render(t.scene, cam);
    } catch (e) { return false; }
    this.layout(box);
    return true;
  },

  /** 레터박스 잘라내기를 푼다 — 사진 모드인데 아직 못 푼 프레임에서 화면이 잘려 보이지 않게. */
  _unscissor(r) {
    if (!r || typeof r.setScissorTest !== 'function') return false;
    try { r.setScissorTest(false); } catch (e) { /* 무해 */ }
    return true;
  },

  /** 별도 카메라를 세운다 — `PlannerCapture.capturePixels` 의 조립과 같은 줄이다 (모양이 같기 때문). */
  _camera(T, f, box) {
    try {
      if (!this._cam) this._cam = new T.PerspectiveCamera(f.fov, f.aspect, f.near, f.far);
      const cam = this._cam;
      cam.fov = f.fov;
      cam.aspect = box && box.height > 0 ? box.width / box.height : f.aspect;
      cam.near = f.near;
      cam.far = f.far;
      cam.position.set(f.position[0], f.position[1], f.position[2]);
      cam.up.set(f.up[0], f.up[1], f.up[2]);
      cam.lookAt(f.target[0], f.target[1], f.target[2]);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      return cam;
    } catch (e) { return null; }
  },

  // ── 화면 ──────────────────────────────────────────────

  /** 사진·편집기·패널을 한꺼번에 다시 그린다. */
  paint() {
    this.layout();
    this.renderEditor();
    this.renderPanel();
  },

  /** #canvasWrap 안의 사진 레이어와 편집기를 만들거나 찾는다 (사진은 캔버스 **뒤**). */
  _els() {
    if (typeof document === 'undefined') return null;
    const wrap = document.getElementById('canvasWrap');
    if (!wrap) return null;
    let img = document.getElementById(PLANNER_PHOTO_MODE_IMG_ID);
    if (!img) {
      img = document.createElement('img');
      img.id = PLANNER_PHOTO_MODE_IMG_ID;
      img.alt = '방 사진';
      img.hidden = true;
      // 캔버스보다 **먼저** 와야 뒤에 깔린다 (둘 다 position:absolute · z-index auto)
      wrap.insertBefore(img, wrap.firstChild);
    }
    let svg = document.getElementById(PLANNER_PHOTO_MODE_SVG_ID);
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = PLANNER_PHOTO_MODE_SVG_ID;
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.hidden = true;
      wrap.appendChild(svg);
    }
    return { wrap, img, svg };
  },

  /** 사진·편집기를 레터박스 상자에 맞춘다. 상자가 안 바뀌었으면 DOM 을 건드리지 않는다. */
  layout(box) {
    const els = this._els();
    if (!els) return null;
    const BG = this.bg();
    const image = BG && BG.image;
    if (!this.active || !image) {
      els.img.hidden = true;
      els.svg.hidden = true;
      return null;
    }
    let b = box;
    if (!b) {
      const w = els.wrap.clientWidth || 0, h = els.wrap.clientHeight || 0;
      const rect = (!w || !h) && typeof els.wrap.getBoundingClientRect === 'function' ? els.wrap.getBoundingClientRect() : null;
      b = plannerPhotoModeBox(w || (rect && rect.width) || 1, h || (rect && rect.height) || 1, image.width / image.height);
    }
    const same = this._box && this._box.x === b.x && this._box.y === b.y && this._box.width === b.width && this._box.height === b.height;
    this._box = b;
    if (els.img.getAttribute('src') !== image.url && image.url) els.img.setAttribute('src', image.url);
    els.img.hidden = false;
    els.svg.hidden = false;
    if (!same) {
      const px = (v) => Math.round(v * 100) / 100 + 'px';
      els.img.style.left = px(b.x); els.img.style.top = px(b.y);
      els.img.style.width = px(b.width); els.img.style.height = px(b.height);
      els.svg.style.left = px(b.x); els.svg.style.top = px(b.y);
      els.svg.style.width = px(b.width); els.svg.style.height = px(b.height);
      els.svg.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`);
      this.renderEditor();
    }
    return b;
  },

  /**
   * 사각형 편집기 — 이름표 붙은 네 귀퉁이 + 변 + **원근 격자**.
   *
   * 귀퉁이에 이름을 붙이는 것은 장식이 아니다. 직사각형은 180° 회전에 대해 자기 자신이라
   * 대각선 반대에서 시작하면 재투영 오차가 **정확히 0 인 틀린 카메라**가 나온다
   * (photo-solve.md 4번). 숫자로는 못 막으니 순서를 사람에게 보여 주는 수밖에 없다.
   *
   * 원근 격자는 "이 평면이 진짜 바닥에 앉았는가" 를 눈으로 보는 장치다 — 푼 카메라로 실제 바닥
   * 격자를 사진에 되투영해 그린다. 격자가 바닥 무늬와 나란하면 맞은 것이다.
   */
  renderEditor() {
    const els = this._els();
    const BG = this.bg();
    if (!els || !BG) return null;
    if (!this.active || !BG.image) { els.svg.hidden = true; return null; }
    const b = this._box || this.layout();
    if (!b) return null;
    const q = BG.state.quad;
    const pts = q.map((p) => plannerPhotoModeToBox(p, b));
    const rel = pts.map((p) => [p[0] - b.x, p[1] - b.y]);          // svg 는 상자 좌상단이 원점이다
    const poly = rel.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const parts = [`<polygon class="pq-fill" points="${poly}"></polygon>`];
    parts.push(this._gridPath(b));
    parts.push(`<polygon class="pq-edge" points="${poly}"></polygon>`);
    const labels = (BG.CORNER_LABEL || ['뒤-좌', '뒤-우', '앞-우', '앞-좌']);
    rel.forEach((p, i) => {
      parts.push(`<circle class="pq-handle" data-corner="${i}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="9"></circle>`);
      const dx = (i === 1 || i === 2) ? 13 : -13;
      const anchor = (i === 1 || i === 2) ? 'start' : 'end';
      const dy = (i <= 1) ? -12 : 20;
      parts.push(`<text class="pq-tag" x="${(p[0] + dx).toFixed(1)}" y="${(p[1] + dy).toFixed(1)}" text-anchor="${anchor}">${plannerPhotoModeEsc(labels[i])}</text>`);
    });
    els.svg.innerHTML = parts.join('');
    els.svg.classList.toggle('pq-locked', !!BG.state.locked);
    els.svg.hidden = false;
    this._bindHandles(els.svg, b);
    return els.svg;
  },

  /** 푼 카메라로 실제 바닥 격자를 사진에 되투영한다. 못 풀었으면 빈 문자열. */
  _gridPath(box) {
    const S = this.solver();
    const BG = this.bg();
    const f = this.frame;
    if (!S || !BG || !f || !BG.image || typeof S.basis !== 'function') return '';
    const rect = plannerPhotoBgSolveRect(this.rect(), BG.state.nudge);
    if (!rect) return '';
    const basis = S.basis(f);
    if (!basis) return '';
    const W = BG.image.width, H = BG.image.height;
    const th = -(rect.rotationDeg || 0) * Math.PI / 180;
    const c = Math.cos(th), s = Math.sin(th);
    const hw = rect.w / 2, hd = rect.d / 2;
    const at = (u, v) => [rect.originMm.x + u * c + v * s, 0, rect.originMm.z - u * s + v * c];
    const toSvg = (P) => {
      const px = S.project(f, basis, W, H, P);
      if (!px) return null;
      const p = plannerPhotoModeToBox([px[0] / W, px[1] / H], box);
      return [(p[0] - box.x).toFixed(1), (p[1] - box.y).toFixed(1)];
    };
    const n = PLANNER_PHOTO_MODE_GRID;
    const out = [];
    for (let i = 1; i < n; i++) {
      const u = -hw + (rect.w * i) / n;
      const v = -hd + (rect.d * i) / n;
      const a1 = toSvg(at(u, -hd)), a2 = toSvg(at(u, hd));
      if (a1 && a2) out.push(`<line class="pq-grid" x1="${a1[0]}" y1="${a1[1]}" x2="${a2[0]}" y2="${a2[1]}"></line>`);
      const b1 = toSvg(at(-hw, v)), b2 = toSvg(at(hw, v));
      if (b1 && b2) out.push(`<line class="pq-grid" x1="${b1[0]}" y1="${b1[1]}" x2="${b2[0]}" y2="${b2[1]}"></line>`);
    }
    return out.join('');
  },

  /**
   * 귀퉁이 끌기 — 끄는 동안 **매번 다시 푼다**. 그래야 "대충 놓고 눈으로 맞춘다" 가 성립한다
   * (2026-09-17 결정: 정확히 찍으라고 요구하지 않는다).
   */
  _bindHandles(svg, box) {
    const BG = this.bg();
    if (!BG) return;
    const self = this;
    svg.querySelectorAll('.pq-handle').forEach((h) => {
      h.onpointerdown = (e) => {
        if (BG.state.locked) return;
        const i = Number(h.getAttribute('data-corner'));
        if (!(i >= 0 && i <= 3)) return;
        e.preventDefault();
        e.stopPropagation();
        self._drag = { i, box: self._box || box };
        try { h.setPointerCapture(e.pointerId); } catch (err) { /* jsdom */ }
      };
      h.onpointermove = (e) => {
        if (!self._drag || self._drag.i !== Number(h.getAttribute('data-corner'))) return;
        self.dragTo(self._drag.i, e.clientX, e.clientY);
      };
      h.onpointerup = () => { self._drag = null; if (BG.save) BG.save(); };
      h.onpointercancel = () => { self._drag = null; };
    });
  },

  /**
   * 귀퉁이 하나를 화면 좌표로 옮긴다. 화면 → 상자 → 정규 좌표.
   * 시험이 직접 부르는 입구이기도 하다 (jsdom 에는 진짜 포인터 캡처가 없다).
   */
  dragTo(i, clientX, clientY) {
    const BG = this.bg();
    const els = this._els();
    if (!BG || !els || !(i >= 0 && i <= 3)) return null;
    const box = this._box || this.layout();
    if (!box) return null;
    let ox = 0, oy = 0;
    try {
      const r = els.wrap.getBoundingClientRect();
      ox = r.left; oy = r.top;
    } catch (e) { /* jsdom 기본값 0 */ }
    const quad = BG.state.quad.map((p) => [p[0], p[1]]);
    quad[i] = plannerPhotoModeFromBox(clientX - ox, clientY - oy, box);
    BG.state.quad = quad;          // 끄는 중에는 저장하지 않는다 — 놓을 때 한 번 (BG.save)
    this.solve();
    this.renderEditor();
    this.renderHealth();
    return quad[i];
  },

  // ── 우측 패널 ─────────────────────────────────────────

  renderPanel() {
    const host = (typeof document !== 'undefined') ? document.getElementById(PLANNER_PHOTO_MODE_PANEL_ID) : null;
    if (!host) return null;
    plannerPhotoModeInjectCss();
    const BG = this.bg();
    if (!BG) { host.innerHTML = '<div class="empty-msg">사진 합성 모듈을 싣지 못했습니다</div>'; return host; }
    const esc = plannerPhotoModeEsc;
    const img = BG.image;
    const st = BG.state;
    const areas = this.areas();
    const id = this.areaId();
    const p = [];
    p.push('<div class="pb-panel">');
    // ① 사진
    p.push(`<div class="pb-drop" id="photoDrop"><b>${img ? '사진 바꾸기' : '방 사진 올리기'}</b>`
      + `<span>${img ? esc(img.name || '') + ` · ${img.width}×${img.height}` : '여기로 끌어다 놓거나 눌러서 고르세요 (JPEG·PNG, 20MB)'}</span></div>`);
    p.push('<input type="file" id="photoFile" accept="image/jpeg,image/png" style="display:none">');
    if (img && (img.rotated || img.scaled)) {
      p.push(`<div class="pb-meta">${img.rotated ? 'EXIF 방향을 세웠습니다 · ' : ''}${img.scaled ? `긴 변 ${BG.MAX_EDGE}px 로 줄였습니다` : ''}</div>`);
    }
    if (!img) { p.push('</div>'); host.innerHTML = p.join(''); this._bindPanel(host); return host; }

    // ② 모드 스위치
    p.push(`<div class="pb-row"><button type="button" data-photo="toggle">${this.active ? '사진 모드 끄기' : '사진 모드 켜기'}</button>`
      + '<span class="pb-meta">사진 모드에서는 화면 돌리기·줌이 꺼집니다 — 카메라는 사진의 것입니다</span></div>');

    // ③ 배치 공간 — 치수는 여기서 자동으로 온다
    const rect = this.rect();
    p.push('<div class="pb-row"><label>배치 공간</label><select id="photoArea">'
      + areas.map((a) => `<option value="${esc(a.id)}"${a.id === id ? ' selected' : ''}>${esc(this._areaLabel(a))}</option>`).join('')
      + '</select></div>');
    p.push(`<div class="pb-meta">실제 치수는 배치 공간에서 자동으로 옵니다${rect ? ` — 가로 ${Math.round(rect.w)} · 깊이 ${Math.round(rect.d)}mm` : ''}. 손으로 넣는 칸은 없습니다.</div>`);

    // ④ 화각
    const fov = st.fovDeg != null ? st.fovDeg : (this.frame ? this.frame.fovDeg : 60);
    p.push(`<div class="pb-row"><label>화각 ${Math.round(fov)}°</label>`
      + `<input type="range" id="photoFov" min="${PLANNER_PHOTO_BG_FOV_MIN}" max="${PLANNER_PHOTO_BG_FOV_MAX}" step="0.5" value="${fov}">`
      + '<button type="button" data-photo="autofov">자동 맞춤</button></div>');
    if (this.frame && this.frame.method === 'assumed' && st.fovDeg == null) {
      p.push('<div class="pb-meta">정면에서 찍은 사진이라 화각이 소실점으로는 정해지지 않습니다 — 오차가 가장 작은 값을 자동으로 골랐습니다.</div>');
    }

    // ⑤ 미세조정 — 대략 사각형을 "눈으로" 마무리하는 자리
    const nz = st.nudge;
    p.push('<div class="pb-row"><label>미세조정</label><span class="pb-meta">'
      + `가구를 밀어 사진에 맞춥니다 (지금 ${Math.round(nz.x)} · ${Math.round(nz.z)}mm · ${Math.round(nz.rotationDeg)}°)</span></div>`);
    p.push('<div class="pb-nudge">'
      + '<button type="button" data-nudge="x:-1">◀ 좌</button>'
      + '<button type="button" data-nudge="x:1">우 ▶</button>'
      + '<button type="button" data-nudge="z:-1">▲ 뒤</button>'
      + '<button type="button" data-nudge="z:1">앞 ▼</button>'
      + '<button type="button" data-nudge="r:-1">↺ 회전</button>'
      + '<button type="button" data-nudge="r:1">회전 ↻</button>'
      + '<button type="button" data-nudge="reset">조정 0</button>'
      + '<button type="button" data-photo="reset">사각형 다시 놓기</button>'
      + '</div>');
    p.push(`<div class="pb-meta">Shift 를 누르고 누르면 ${PLANNER_PHOTO_MODE_STEP_BIG_MM}mm 씩 (기본 ${PLANNER_PHOTO_MODE_STEP_MM}mm)</div>`);

    // ⑥ 건강 상태
    p.push('<div id="photoHealth"></div>');
    p.push('<div class="pb-hint">사각형은 <b>대략적인 위치</b>만 표시합니다 — 합성을 보며 미세조정으로 맞추세요. '
      + '귀퉁이는 <b>뒤-좌 → 뒤-우 → 앞-우 → 앞-좌</b> 순서입니다. '
      + '<b>너른 사각형이 얇은 띠보다 정확</b>합니다 (측정: 약 4배) — 가구가 설 자리 전체를 잡으세요.</div>');
    p.push('</div>');
    host.innerHTML = p.join('');
    this.renderHealth();
    this._bindPanel(host);
    return host;
  },

  _areaLabel(a) {
    if (!a) return '배치';
    let label = a.section || '배치';
    if (this._o && typeof this._o.sectionLabel === 'function') {
      try { label = this._o.sectionLabel(a.section) || label; } catch (e) { /* 무해 */ }
    }
    return `${label} W${Math.round(a.W || 0)} × D${Math.round(a.D || 0)}`;
  },

  /** 건강 한 줄 — 등급·재투영 오차·할 일. 끄는 동안 이것만 다시 그린다 (패널 전체는 무겁다). */
  renderHealth() {
    const host = (typeof document !== 'undefined') ? document.getElementById('photoHealth') : null;
    if (!host) return null;
    const h = this.health;
    if (!h) { host.innerHTML = '<div class="pb-health rough">사진과 배치 공간을 고르면 상태가 여기 보입니다</div>'; return host; }
    const esc = plannerPhotoModeEsc;
    const extra = [];
    if (h.camera) extra.push(h.camera.method === 'vanishing' ? '소실점으로 풀었습니다' : '화각을 정해 풀었습니다');
    if (h.camera) extra.push(`카메라 높이 ${Math.round(h.camera.position[1])}mm · ${(h.camera.dist / 1000).toFixed(1)}m`);
    host.innerHTML = `<div class="pb-health ${esc(h.level)}" data-level="${esc(h.level)}">${esc(h.reason)}`
      + (extra.length ? `<div class="pb-meta">${esc(extra.join(' · '))}</div>` : '')
      + (h.hint ? `<div class="pb-meta">${esc(h.hint)}</div>` : '')
      + '</div>';
    return host;
  },

  _bindPanel(host) {
    const BG = this.bg();
    if (!BG || !host) return;
    const self = this;
    const drop = host.querySelector('#photoDrop');
    const input = host.querySelector('#photoFile');
    if (drop || input) {
      BG.mountIntake({
        drop, input,
        onDone: (res) => {
          if (!res || !res.ok) { self.toast('⚠ ' + ((res && res.message) || '사진을 올리지 못했습니다')); return; }
          self.toast('🖼 사진을 올렸습니다 — 사각형을 가구가 설 바닥에 대충 맞춰 주세요');
          if (!self.active) self.enter(); else { self.solve(); self.paint(); }
        },
      });
    }
    const area = host.querySelector('#photoArea');
    if (area) area.onchange = () => { self.setArea(area.value); };
    const fov = host.querySelector('#photoFov');
    if (fov) fov.oninput = () => { BG.patch({ fovDeg: Number(fov.value) }); };
    host.querySelectorAll('[data-photo]').forEach((el) => {
      el.onclick = () => {
        const what = el.getAttribute('data-photo');
        if (what === 'toggle') { self.toggle(); self.renderPanel(); }
        else if (what === 'autofov') self.autoFov();
        else if (what === 'reset') { BG.resetQuad(); self.toast('사각형을 처음 자리로 되돌렸습니다'); }
      };
    });
    host.querySelectorAll('[data-nudge]').forEach((el) => {
      el.onclick = (e) => { self.nudge(el.getAttribute('data-nudge'), e && e.shiftKey); };
    });
  },

  /**
   * 미세조정 한 칸. `'x:1'` · `'z:-1'` · `'r:1'` · `'reset'`.
   * 씬이 아니라 사각형을 움직인다 (photo-bg.js 의 `plannerPhotoBgSolveRect` 머리말 참고).
   */
  nudge(what, big) {
    const BG = this.bg();
    if (!BG) return null;
    const n = Object.assign({}, BG.state.nudge);
    if (what === 'reset') { BG.patch({ nudge: { x: 0, z: 0, rotationDeg: 0 } }); return BG.state.nudge; }
    const parts = String(what || '').split(':');
    const dir = Number(parts[1]) < 0 ? -1 : 1;
    const step = big ? PLANNER_PHOTO_MODE_STEP_BIG_MM : PLANNER_PHOTO_MODE_STEP_MM;
    if (parts[0] === 'x') n.x += dir * step;
    else if (parts[0] === 'z') n.z += dir * step;
    else if (parts[0] === 'r') n.rotationDeg += dir * PLANNER_PHOTO_MODE_STEP_DEG;
    else return BG.state.nudge;
    BG.patch({ nudge: n });
    return BG.state.nudge;
  },
};

// photo-bg.js 의 함수·상수는 **맨이름**으로 쓴다. 브라우저에서는 전역 렉시컬 스코프를 공유하고,
// 시험(jsdom)에서는 photo-bg.js 가 window 에 올린 것이 전역이 된다. 그래서 싣는 순서가 정해져 있다 —
// photo-solve.js → photo-bg.js → photo-mode.js (planner-assets.test.js 가 지킨다).

if (typeof window !== 'undefined') {
  window.PlannerPhotoMode = PlannerPhotoMode;
  window.plannerPhotoModeBox = plannerPhotoModeBox;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_PHOTO_MODE_IMG_ID,
    PLANNER_PHOTO_MODE_SVG_ID,
    PLANNER_PHOTO_MODE_PANEL_ID,
    PLANNER_PHOTO_MODE_GRID,
    PLANNER_PHOTO_MODE_STEP_MM,
    PLANNER_PHOTO_MODE_STEP_BIG_MM,
    PLANNER_PHOTO_MODE_HIDE_KINDS,
    plannerPhotoModeBox,
    plannerPhotoModeViewport,
    plannerPhotoModeToBox,
    plannerPhotoModeFromBox,
    plannerPhotoModeEsc,
    PlannerPhotoMode,
  };
}
