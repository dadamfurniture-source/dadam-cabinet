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
//   (색공간·재질은 디테일 모드가 주인이다 — 건드리지 않는다. **조명은 P2 부터 사진 모드가
//    직접 맡는다** — 아래 "G6" 참고.)
//   `__tests__/photo-mode.test.js` 가 들어가기 전 값을 찍어 두고 나온 뒤와 대조한다.
//
// ── 도어 테두리 (G7) ────────────────────────────────────
//
//   `keepDoorEdgesVisible` 는 멀어져도 도어가 낱장으로 읽히게 검은 막대를 매 프레임 키운다.
//   사진 위에서는 그 검은 선이 만화처럼 읽힌다. 사진 모드에서는 끄고, 나갈 때 되돌린다.
//   씬은 `renderAll3D` 가 언제든 다시 만들므로 **매 프레임** 숨긴다 (원래 값은 처음 본 것만 적어 둔다).
//
// ── P2: 그림자 · 빛 · 톤 (계획 §5 P2) ─────────────────────
//
//   가구가 바닥에 그림자를 드리우지 않으면 사진 위에 **떠 보인다**. 그래서 셋을 더한다:
//     ① 그림자 받개 — y=0 의 `ShadowMaterial` 평면. `entityKind:'shadow-catcher'` 로 표시해
//        캡처 바운즈(`plannerCaptureBoundsOf`)에서 빠진다. 씬의 자식이라 `paintScene`(moduleGroup 순회)
//        에도, 화면 클릭 레이캐스트(moduleGroup.children)에도 걸리지 않는다.
//     ② 빛 — 방위각·고도로 주광을 반구 위에 놓고, 그림자 카메라를 가구에 조인다.
//
//   ⚠ **G6 — 왜 저장·복원이 여기 있는가.** `planner-detail.js applyScene` 은 조명의 **세기만**
//   적어 둔다 (`planner-detail.js:423` — 그 모드는 세기만 건드리니 그것으로 충분하다). 사진 모드는
//   위치·타깃·그림자 설정까지 바꾸므로 그 목록으로는 되돌릴 수 없다. **다른 도메인의 규율을 넓히는
//   대신** 여기서 `_savedLight` 를 따로 둔다 — 내가 바꾼 것은 내가 되돌린다. 적어 두는 것:
//   position · target(과 그 부모) · castShadow · shadow.camera(경계·near·far) · shadow.mapSize ·
//   shadow.radius · shadow.bias · color · intensity · renderer.shadowMap.type · toneMappingExposure.
//
//   ⚠ **그림자 품질 — 무엇을 고르고 왜인가** (three r0.183 소스 근거):
//     · **가장 큰 것부터**: 그림자 카메라 프러스텀이다. `DirectionalLightShadow` 의 기본값은
//       `OrthographicCamera(-5, 5, 5, -5, 0.5, 500)` 이다 (`DirectionalLightShadow.js:16`).
//       이 씬의 단위는 **mm** 이므로 그것은 10mm × 10mm 짜리, 깊이 500mm 인 상자다. 주광은
//       (5000, 8000, 5000) 에 서 있고 가구는 수천 mm 를 차지한다 — **하나도 안 들어간다.**
//       페이지가 `castShadow` 와 `shadowMap.enabled` 를 켜 두었는데도 지금 화면에 그림자가
//       안 보이는 진짜 이유가 이것이다. 품질을 올리는 일이 아니라 **없던 것을 켜는 일**이다.
//       → 사진 모드는 프러스텀을 **가구 바운즈에 맞춘다**. 그 다음이 해상도다 — 텍셀 크기 =
//         프러스텀 폭 / mapSize 이므로 mapSize 를 2048² 로 올려 한 번 더 조인다.
//     · 부드럽기는 `shadow.radius` 다. 단, radius 를 **읽는 셰이더는 PCF 와 VSM 뿐이다**
//       (`WebGLProgram.js:344-352` — 그 표에 없는 값은 전부 `SHADOWMAP_TYPE_BASIC` 로 떨어지고
//       BASIC 은 한 탭이라 radius 를 아예 안 쓴다). 게다가 페이지가 켜 둔 `PCFSoftShadowMap` 은
//       이 판에서 **폐기**됐다 — `WebGLShadowMap.render` 가 첫 렌더에 경고와 함께 `PCFShadowMap`
//       으로 바꿔 버린다 (`WebGLShadowMap.js:99-104`). 그래서 사진 모드는 **PCFShadowMap 을 명시**하고
//       radius 를 쓴다. VSM 은 쓰지 않는다 — VSM 에서는 "모든 그림자 받개가 그림자를 **드리우기도**
//       한다" (`constants.js:78`). 받개 평면이 사진 전체에 그림자를 드리워 합성이 통째로 죽는다.
//     · radius 의 단위는 **텍셀**이다 (`shadowmap_pars_fragment.glsl.js:132`). 그래서 카메라를
//       조이면 같은 radius 가 세계 단위로는 더 좁아진다 — 접지면이 또렷해지는 쪽이라 원하는 방향이다.
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

// ── P2 상수 ─────────────────────────────────────────────

/** 그림자 받개의 이름표. `plannerCaptureBoundsOf` 의 제외 목록과 **같은 문자열**이어야 한다 */
const PLANNER_PHOTO_MODE_CATCHER_KIND = 'shadow-catcher';
/** 받개 평면 여백 — 가구 발자국의 이 배수만큼 더 넓게 (기울어진 빛의 긴 그림자를 받으려면 넓어야 한다) */
const PLANNER_PHOTO_MODE_CATCHER_PAD = 0.9;
/** 받개 최소 여백 (mm) — 작은 모듈 하나만 있을 때도 그림자가 잘리지 않게 */
const PLANNER_PHOTO_MODE_CATCHER_PAD_MIN_MM = 900;
/** 주광을 놓는 반구의 반지름 = 가구 크기 × 이 배수 (최소 mm) */
const PLANNER_PHOTO_MODE_LIGHT_R = 2.2;
const PLANNER_PHOTO_MODE_LIGHT_R_MIN_MM = 4000;
/** 사진 모드에서 쓰는 그림자 지도 크기 — 기본 1024² 의 두 배 (머리말 "그림자 품질") */
const PLANNER_PHOTO_MODE_SHADOW_MAP = 2048;
/** 그림자 카메라 여유 (가구 대각선의 배수) */
const PLANNER_PHOTO_MODE_SHADOW_PAD = 1.15;
/** 슬라이더 한 칸. 값의 성질이 다르니 칸도 다르다 (각도는 1°, 세기는 0.05) */
const PLANNER_PHOTO_MODE_LOOK_STEP = {
  shadowOpacity: 0.01, shadowSoftness: 0.5, azimuthDeg: 1, elevationDeg: 1,
  intensity: 0.05, ambient: 0.05, exposure: 0.05, temperature: 1, tint: 1,
};

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
.pb-group{border-top:1px solid var(--line,#e5e0d4);padding-top:7px;margin-top:2px;display:flex;flex-direction:column;gap:6px}
.pb-group>.pb-title{font-size:10.5px;font-weight:700;color:var(--brand-deep,#6a4b2a)}
`;

/**
 * 겹쳐 놓은 레이어를 보이고 숨긴다.
 *
 * `el.hidden = true` 로는 둘 다 안 숨는다 (2026-09-17 브라우저 확인):
 *   · `#photoBgLayer` 는 이 파일 CSS 가 `display:block` 을 직접 박아 둬서
 *     `[hidden]` 의 UA 기본값(`display:none`)을 이긴다.
 *   · `#photoQuadEditor` 는 SVGElement 라 `hidden` 프로퍼티가 내용 속성으로
 *     반영된다는 보장이 없다 — 속성이 안 붙으면 `[hidden]` 규칙 자체가 안 걸린다.
 * 그래서 인라인 `style.display` 로 못박는다. 켤 때는 빈 문자열로 되돌려
 * CSS 가 정한 값(이미지는 block, SVG 는 기본)을 그대로 쓰게 둔다.
 */
function plannerPhotoModeShow(el, on) {
  if (!el || !el.style) return;
  el.style.display = on ? '' : 'none';
  try { el.hidden = !on; } catch (e) { /* SVG 에서 막히면 style 만으로 충분하다 */ }
}

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

// ── P2 순수 셈 — three 도 DOM 도 없이 시험이 본다 ───────────

/**
 * 방위각·고도 → 주광의 자리. 가구 중심을 둘러싼 **반구** 위의 한 점이다.
 *
 *   방위각 0° = +Z (평면도에서 "앞", 보통 카메라가 선 쪽) · 90° = +X (오른쪽)
 *   고도   0° = 지평선 · 90° = 바로 위
 *
 *     x = cx + R·cos(고도)·sin(방위)
 *     y = cy + R·sin(고도)
 *     z = cz + R·cos(고도)·cos(방위)
 *
 * 이 한 줄이 "빛 맞추기" 의 전부다 — 방향만 정하고 거리는 R 이 정한다 (평행광이라 거리는 그림자
 * 카메라 프러스텀에만 쓰인다). 순수 함수라 시험이 **정확한 벡터**로 못 박는다.
 *
 * @param {number} azimuthDeg
 * @param {number} elevationDeg
 * @param {number[]} centre [x, y, z]
 * @param {number} radius mm
 * @returns {number[]} [x, y, z]
 */
function plannerPhotoModeLightPos(azimuthDeg, elevationDeg, centre, radius) {
  const c = Array.isArray(centre) ? centre : [0, 0, 0];
  const R = Number(radius) > 0 ? Number(radius) : 1;
  const a = (Number(azimuthDeg) || 0) * Math.PI / 180;
  const e = (Number(elevationDeg) || 0) * Math.PI / 180;
  const h = R * Math.cos(e);
  return [
    (Number(c[0]) || 0) + h * Math.sin(a),
    (Number(c[1]) || 0) + R * Math.sin(e),
    (Number(c[2]) || 0) + h * Math.cos(a),
  ];
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
  /**
   * P2 (G6): 조명·렌더러의 빛 관련 값. `planner-detail.js` 의 저장 목록은 **세기뿐**이라
   * 여기서 따로 적어 둔다 — 그 파일은 다른 도메인의 규율이고, 내가 바꾼 것은 내가 되돌린다.
   */
  _savedLight: null,
  /** P2: 그림자 받개 (씬 자식). 사진 모드에 있는 동안만 존재한다 */
  _catcher: null,
  /** 받개·그림자 카메라를 다시 잰 시점의 모듈 수 — 바뀌면 다시 잰다 */
  _catcherAt: -1,
  /** 별도 카메라 (three). 화면 카메라는 건드리지 않는다 */
  _cam: null,
  /** 마지막으로 그린 레터박스 — 바뀔 때만 DOM 을 건드린다 */
  _box: null,
  _drag: null,

  Box: plannerPhotoModeBox,
  LightPos: plannerPhotoModeLightPos,

  mount(o) {
    this._o = o || {};
    const BG = this.bg();
    if (BG) {
      BG.load();
      BG.onChange = () => { this.solve(); this.applyLook(); this.paint(); };
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
    this.applyLook();
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
    plannerPhotoModeShow(img, false);
    const svg = document.getElementById(PLANNER_PHOTO_MODE_SVG_ID);
    plannerPhotoModeShow(svg, false);
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
      // P2 — 빛·그림자·톤. 저장이 **먼저**, 그 다음에 받개와 값이 들어간다 (G6).
      this._saveLight(t, T);
      this._ensureCatcher(t, T);
      return true;
    }
    const saved = this._saved;
    if (!saved) return false;
    this._saved = null;
    // P2 — 넣은 순서의 반대로 뺀다: 받개를 먼저 치우고, 그 다음 조명·렌더러를 되돌린다
    this._dropCatcher(t);
    this._restoreLight(t);
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

  // ── P2: 그림자 · 빛 · 톤 ──────────────────────────────

  /**
   * 씬의 조명을 갈래별로 모은다.
   *   key  주광 — `castShadow` 가 켜진 직사광 (없으면 첫 직사광). 방위각·고도가 이것을 움직인다
   *   fill 나머지 직사광 — 방향은 주광 반대쪽으로, 세기는 주광의 일부로 따라간다
   *   amb  주변광·반구광 — 「채움」 슬라이더가 맡는다
   */
  _lights(t) {
    const out = { key: null, fill: [], amb: [], all: [] };
    if (!t || !t.scene) return out;
    const kids = (t.scene.children || []);
    kids.forEach((ch) => {
      if (!ch) return;
      if (ch.isDirectionalLight) {
        out.all.push(ch);
        if (!out.key && ch.castShadow) out.key = ch;
        else out.fill.push(ch);
      } else if (ch.isAmbientLight || ch.isHemisphereLight) {
        out.all.push(ch);
        out.amb.push(ch);
      }
    });
    // 그림자를 켠 직사광이 하나도 없으면 첫 직사광을 주광으로 삼는다 (그때 castShadow 를 켠다)
    if (!out.key && out.fill.length) { out.key = out.fill.shift(); }
    return out;
  },

  /**
   * 지금 보이는 가구의 세계 경계. 빛의 반구 반지름 · 그림자 카메라 · 받개 크기가 전부 여기서 나온다.
   * 보이지 않는 것(숨긴 바닥판·도어 테두리)과 부재가 아닌 것은 뺀다 — `plannerCaptureBoundsOf` 와
   * 같은 뜻이지만 그 함수는 window 로 나오지 않아 바로 못 쓴다 (클래식 스크립트 경계).
   * @returns {{centre:number[], spanX:number, spanZ:number, spanY:number, diag:number}|null}
   */
  _bounds(t, T) {
    const g = t && t.moduleGroup;
    if (!g || !T || !T.Box3 || typeof g.traverse !== 'function') return null;
    try { g.updateWorldMatrix(true, true); } catch (e) { /* 순수 객체면 없다 */ }
    const box = new T.Box3();
    const tmp = new T.Box3();
    let any = false;
    try {
      g.traverse((obj) => {
        if (!obj || !obj.isMesh || !obj.geometry || obj.visible === false) return;
        const kind = obj.userData && obj.userData.entityKind;
        if (kind === 'area' || kind === 'pick' || kind === PLANNER_PHOTO_MODE_CATCHER_KIND) return;
        if (!obj.geometry.boundingBox && typeof obj.geometry.computeBoundingBox === 'function') obj.geometry.computeBoundingBox();
        if (!obj.geometry.boundingBox) return;
        tmp.copy(obj.geometry.boundingBox).applyMatrix4(obj.matrixWorld);
        if (tmp.isEmpty()) return;
        box.union(tmp);
        any = true;
      });
    } catch (e) { return null; }
    if (!any) return null;
    const spanX = Math.max(1, box.max.x - box.min.x);
    const spanY = Math.max(1, box.max.y - box.min.y);
    const spanZ = Math.max(1, box.max.z - box.min.z);
    return {
      centre: [(box.min.x + box.max.x) / 2, 0, (box.min.z + box.max.z) / 2],   // 빛은 **바닥 중심**을 돈다
      mid: [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2],
      spanX, spanY, spanZ,
      diag: Math.sqrt(spanX * spanX + spanY * spanY + spanZ * spanZ),
    };
  },

  /**
   * (G6) 빛과 관련해 **내가 건드릴 모든 것**을 적는다. `planner-detail.js` 는 세기만 적으므로
   * 이 목록이 없으면 사진 모드를 나가도 조명이 사진 자리에 남는다.
   */
  _saveLight(t, T) {
    if (this._savedLight || !t) return false;
    const L = this._lights(t);
    const r = t.renderer;
    const saved = { lights: [], renderer: null };
    if (r) {
      saved.renderer = {
        toneMappingExposure: r.toneMappingExposure,
        shadowEnabled: r.shadowMap ? r.shadowMap.enabled : null,
        shadowType: r.shadowMap ? r.shadowMap.type : null,
      };
    }
    L.all.forEach((light) => {
      const s = {
        light,
        intensity: light.intensity,
        color: (light.color && typeof light.color.getHex === 'function') ? light.color.getHex() : null,
        position: (light.position && typeof light.position.toArray === 'function') ? light.position.toArray() : null,
        castShadow: light.castShadow,
        target: light.target || null,
        targetParent: (light.target && light.target.parent) || null,
        targetPos: (light.target && light.target.position && typeof light.target.position.toArray === 'function')
          ? light.target.position.toArray() : null,
        shadow: null,
      };
      const sh = light.shadow;
      if (sh) {
        s.shadow = {
          radius: sh.radius,
          bias: sh.bias,
          normalBias: sh.normalBias,
          blurSamples: sh.blurSamples,
          mapSize: sh.mapSize ? [sh.mapSize.x, sh.mapSize.y] : null,
          camera: sh.camera ? {
            left: sh.camera.left, right: sh.camera.right, top: sh.camera.top, bottom: sh.camera.bottom,
            near: sh.camera.near, far: sh.camera.far,
          } : null,
        };
      }
      saved.lights.push(s);
    });
    this._savedLight = saved;
    return true;
  },

  /** 적어 둔 그대로 되돌린다. 하나라도 빠지면 구조 모드가 사진 모드의 빛을 물려받는다 (I2). */
  _restoreLight(t) {
    const saved = this._savedLight;
    if (!saved) return false;
    this._savedLight = null;
    const r = t && t.renderer;
    if (r && saved.renderer) {
      try {
        r.toneMappingExposure = saved.renderer.toneMappingExposure;
        if (r.shadowMap) {
          if (saved.renderer.shadowEnabled != null) r.shadowMap.enabled = saved.renderer.shadowEnabled;
          if (saved.renderer.shadowType != null) r.shadowMap.type = saved.renderer.shadowType;
        }
      } catch (e) { /* 값 주머니 renderer 면 없을 수 있다 */ }
    }
    saved.lights.forEach((s) => {
      const light = s.light;
      if (!light) return;
      try {
        light.intensity = s.intensity;
        if (s.color != null && light.color && typeof light.color.setHex === 'function') light.color.setHex(s.color);
        if (s.position && light.position && typeof light.position.fromArray === 'function') light.position.fromArray(s.position);
        light.castShadow = s.castShadow;
        if (s.target) {
          if (s.targetPos && s.target.position && typeof s.target.position.fromArray === 'function') {
            s.target.position.fromArray(s.targetPos);
          }
          // 타깃을 씬에 붙였다면 원래 부모(대개 없음)로 되돌린다 — 안 그러면 씬에 고아가 남는다
          if (s.target.parent !== s.targetParent) {
            if (s.target.parent && typeof s.target.parent.remove === 'function') s.target.parent.remove(s.target);
            if (s.targetParent && typeof s.targetParent.add === 'function') s.targetParent.add(s.target);
          }
        }
        const sh = light.shadow;
        if (sh && s.shadow) {
          sh.radius = s.shadow.radius;
          sh.bias = s.shadow.bias;
          if (s.shadow.normalBias != null) sh.normalBias = s.shadow.normalBias;
          if (s.shadow.blurSamples != null) sh.blurSamples = s.shadow.blurSamples;
          if (s.shadow.mapSize && sh.mapSize) this._setMapSize(sh, s.shadow.mapSize[0], s.shadow.mapSize[1]);
          if (s.shadow.camera && sh.camera) {
            Object.assign(sh.camera, s.shadow.camera);
            if (typeof sh.camera.updateProjectionMatrix === 'function') sh.camera.updateProjectionMatrix();
          }
        }
      } catch (e) { /* 하나가 막혀도 나머지는 되돌린다 */ }
    });
    return true;
  },

  /**
   * 그림자 지도 크기를 바꾼다. **이미 만들어진 지도는 버려야** 새 크기가 먹는다 —
   * three 는 `shadow.map` 이 있으면 그대로 다시 쓴다.
   */
  _setMapSize(shadow, w, h) {
    if (!shadow || !shadow.mapSize) return false;
    if (shadow.mapSize.x === w && shadow.mapSize.y === h) return false;
    shadow.mapSize.set(w, h);
    if (shadow.map) {
      try { if (typeof shadow.map.dispose === 'function') shadow.map.dispose(); } catch (e) { /* 무해 */ }
      shadow.map = null;
    }
    return true;
  },

  /**
   * 그림자 받개 — `y = 0` 의 `ShadowMaterial` 평면. 그림자만 알파로 남기므로 투명 배경 한 장에
   * 가구와 그림자가 함께 담긴다 (계획 §4.3 정정 — 따로 뽑지 않는다).
   *
   * · `entityKind:'shadow-catcher'` — `plannerCaptureBoundsOf` 의 제외 목록에 든 이름이다
   * · **씬의 자식**이라 `PlannerDetail.paintScene`(moduleGroup 순회)도, 화면 클릭 레이캐스트
   *   (`intersectObjects(moduleGroup.children)`)도 이 평면을 만나지 못한다
   * · `depthWrite = false` — y=0 에서 모듈 바닥면과 같은 평면에 놓이므로 깊이까지 쓰면 깜빡인다
   */
  _ensureCatcher(t, T) {
    const TT = T || this.T();
    if (!t || !t.scene || !TT || !TT.ShadowMaterial || !TT.PlaneGeometry || !TT.Mesh) return null;
    if (!this._catcher) {
      try {
        const mat = new TT.ShadowMaterial({ transparent: true, opacity: 0.35 });
        mat.depthWrite = false;
        const mesh = new TT.Mesh(new TT.PlaneGeometry(1, 1), mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.renderOrder = -1;
        mesh.userData = { entityKind: PLANNER_PHOTO_MODE_CATCHER_KIND };
        this._catcher = mesh;
        this._catcherAt = -1;
      } catch (e) { return null; }
    }
    if (this._catcher.parent !== t.scene) {
      try { t.scene.add(this._catcher); } catch (e) { return null; }
    }
    return this._catcher;
  },

  /** 받개를 씬에서 빼고 버린다. 사진 모드 밖에는 남지 않는다. */
  _dropCatcher(t) {
    const mesh = this._catcher;
    this._catcher = null;
    this._catcherAt = -1;
    if (!mesh) return false;
    try { if (mesh.parent && typeof mesh.parent.remove === 'function') mesh.parent.remove(mesh); } catch (e) { /* 무해 */ }
    try { if (mesh.geometry && typeof mesh.geometry.dispose === 'function') mesh.geometry.dispose(); } catch (e) { /* 무해 */ }
    try { if (mesh.material && typeof mesh.material.dispose === 'function') mesh.material.dispose(); } catch (e) { /* 무해 */ }
    return true;
  },

  /**
   * 지금 상태(light·grade)를 씬에 얹는다. 모드 안에서만 돈다 — 저장해 둔 값이 없으면 아무것도 안 한다.
   * 상태가 바뀔 때마다(`BG.onChange`) 다시 불린다.
   */
  applyLook() {
    const t = this.three();
    const T = this.T();
    const BG = this.bg();
    if (!this.active || !t || !T || !BG || !this._savedLight) return false;
    const st = BG.state;
    const L = st.light || {};
    const b = this._bounds(t, T);
    const spanX = b ? b.spanX : 3000;
    const spanZ = b ? b.spanZ : 2000;
    const centre = b ? b.centre : [0, 0, 0];
    const diag = b ? b.diag : 4000;
    const radius = Math.max(PLANNER_PHOTO_MODE_LIGHT_R_MIN_MM, diag * PLANNER_PHOTO_MODE_LIGHT_R);

    // ── 받개: 가구 발자국 + 여백 ──────────────────────────
    const pad = Math.max(PLANNER_PHOTO_MODE_CATCHER_PAD_MIN_MM, Math.max(spanX, spanZ) * PLANNER_PHOTO_MODE_CATCHER_PAD);
    const catcher = this._ensureCatcher(t, T);
    if (catcher) {
      const w = spanX + pad * 2, d = spanZ + pad * 2;
      const ud = catcher.userData;
      if (ud._w !== w || ud._d !== d) {
        try {
          const old = catcher.geometry;
          catcher.geometry = new T.PlaneGeometry(w, d);
          if (old && typeof old.dispose === 'function') old.dispose();
          ud._w = w; ud._d = d;
        } catch (e) { /* 무해 */ }
      }
      try { catcher.position.set(centre[0], 0, centre[2]); } catch (e) { /* 무해 */ }
      try {
        if (catcher.material) {
          catcher.material.opacity = Number(L.shadowOpacity) || 0;
          catcher.visible = catcher.material.opacity > 0;
        }
      } catch (e) { /* 무해 */ }
    }

    // ── 빛 ──────────────────────────────────────────────
    const lights = this._lights(t);
    const key = lights.key;
    if (key) {
      const pos = plannerPhotoModeLightPos(L.azimuthDeg, L.elevationDeg, centre, radius);
      try { key.position.set(pos[0], pos[1], pos[2]); } catch (e) { /* 무해 */ }
      try { key.intensity = Number(L.intensity) || 0; } catch (e) { /* 무해 */ }
      key.castShadow = true;
      // 타깃은 가구 중심. **씬에 붙여야** 매 프레임 matrixWorld 가 갱신된다 (three 의 규약).
      if (key.target) {
        try { key.target.position.set(centre[0], 0, centre[2]); } catch (e) { /* 무해 */ }
        try {
          if (key.target.parent !== t.scene && typeof t.scene.add === 'function') t.scene.add(key.target);
          if (typeof key.target.updateMatrixWorld === 'function') key.target.updateMatrixWorld(true);
        } catch (e) { /* 무해 */ }
      }
      this._tuneShadow(key, T, centre, diag, radius, L);
    }
    // 채움 직사광은 주광 반대쪽에서 낮게 — 그림자 안쪽이 새카맣게 죽지 않게
    lights.fill.forEach((f) => {
      const pos = plannerPhotoModeLightPos(Number(L.azimuthDeg) + 180, 25, centre, radius);
      try { f.position.set(pos[0], pos[1], pos[2]); } catch (e) { /* 무해 */ }
      try { f.intensity = (Number(L.intensity) || 0) * 0.33; } catch (e) { /* 무해 */ }
    });
    lights.amb.forEach((a) => {
      try { a.intensity = Number(L.ambient) || 0; } catch (e) { /* 무해 */ }
    });

    // ── 그림자 지도 ────────────────────────────────────
    const r = t.renderer;
    if (r) {
      try {
        if (r.shadowMap) {
          r.shadowMap.enabled = true;
          // radius 를 읽는 셰이더는 PCF·VSM 뿐이다. VSM 은 받개가 그림자를 드리워 못 쓴다 (머리말).
          if (T.PCFShadowMap !== undefined) r.shadowMap.type = T.PCFShadowMap;
        }
      } catch (e) { /* 무해 */ }
    }
    this._catcherAt = (t.moduleGroup && t.moduleGroup.children) ? t.moduleGroup.children.length : -1;
    return true;
  },

  /**
   * 그림자 카메라를 **가구에 맞춘다**. three 의 기본 프러스텀은 `(-5, 5, 5, -5, 0.5, 500)` —
   * 단위가 mm 인 이 씬에서는 10mm 짜리 상자라 가구가 하나도 안 들어간다. 그래서 이것은 "품질을
   * 올리는" 일이 아니라 **없던 그림자를 켜는** 일이다 (머리말 근거).
   * 부드럽기(`shadow.radius`)의 단위는 **텍셀**이라, 프러스텀을 좁힐수록 같은 값이 세계 단위로 좁아진다.
   */
  _tuneShadow(light, T, centre, diag, radius, L) {
    const sh = light && light.shadow;
    if (!sh) return false;
    const half = Math.max(500, diag * 0.5 * PLANNER_PHOTO_MODE_SHADOW_PAD);
    try {
      this._setMapSize(sh, PLANNER_PHOTO_MODE_SHADOW_MAP, PLANNER_PHOTO_MODE_SHADOW_MAP);
      sh.radius = Math.max(0, Number(L && L.shadowSoftness) || 0);
      if (sh.camera) {
        sh.camera.left = -half;
        sh.camera.right = half;
        sh.camera.top = half;
        sh.camera.bottom = -half;
        sh.camera.near = Math.max(1, radius - diag);
        sh.camera.far = radius + diag + 1000;
        if (typeof sh.camera.updateProjectionMatrix === 'function') sh.camera.updateProjectionMatrix();
      }
    } catch (e) { return false; }
    return true;
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
    // P2: 받개도 마찬가지다. 모듈이 늘거나 줄면 발자국이 바뀌므로 그때만 다시 잰다
    //   (`renderAll3D` 는 moduleGroup 을 통째로 다시 만든다 — 씬 자식인 받개는 살아남지만
    //    크기와 그림자 카메라는 새 가구에 맞춰야 한다).
    const kids = (t.moduleGroup && t.moduleGroup.children) ? t.moduleGroup.children.length : -1;
    if (!this._catcher || this._catcher.parent !== t.scene || kids !== this._catcherAt) this.applyLook();
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
      plannerPhotoModeShow(img, false);
      // 캔버스보다 **먼저** 와야 뒤에 깔린다 (둘 다 position:absolute · z-index auto)
      wrap.insertBefore(img, wrap.firstChild);
    }
    let svg = document.getElementById(PLANNER_PHOTO_MODE_SVG_ID);
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = PLANNER_PHOTO_MODE_SVG_ID;
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      plannerPhotoModeShow(svg, false);
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
      plannerPhotoModeShow(els.img, false);
      plannerPhotoModeShow(els.svg, false);
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
    plannerPhotoModeShow(els.img, true);
    plannerPhotoModeShow(els.svg, true);
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
    if (!this.active || !BG.image) { plannerPhotoModeShow(els.svg, false); return null; }
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
    plannerPhotoModeShow(els.svg, true);
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
    // 슬라이더를 끄는 동안은 다시 그리지 않는다 (`_bindPanel` 의 data-look 참고) — 손잡이를 잃는다
    if (this._skipPanel) return host;
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

    // ⑥ 그림자·빛·톤 (P2) — 가구를 사진 바닥에 붙이는 자리
    p.push(this._lookGroup());

    // ⑦ 건강 상태
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

  /**
   * 「그림자·빛」 묶음 — 받개 세기·부드럽기, 빛 방향·세기·채움, 노출·색온도·틴트, 자동 제안.
   * 슬라이더 하나하나는 `data-look="light:azimuthDeg"` 처럼 **어느 묶음의 어느 칸인지**를 달고 있고
   * `_bindPanel` 이 그것만 보고 `patchLight`/`patchGrade` 로 보낸다 — 칸이 늘어도 배선이 안 늘어난다.
   */
  _lookGroup() {
    const BG = this.bg();
    if (!BG) return '';
    const LIM = (typeof PLANNER_PHOTO_BG_LIGHT_LIMITS !== 'undefined') ? PLANNER_PHOTO_BG_LIGHT_LIMITS : null;
    const GLIM = (typeof PLANNER_PHOTO_BG_GRADE_LIMITS !== 'undefined') ? PLANNER_PHOTO_BG_GRADE_LIMITS : null;
    if (!LIM || !GLIM) return '';
    const L = BG.state.light, G = BG.state.grade;
    const p = ['<div class="pb-group"><div class="pb-title">그림자 · 빛 · 톤</div>'];
    const row = (bag, key) => {
      const lim = (bag === 'light' ? LIM : GLIM)[key];
      const value = (bag === 'light' ? L : G)[key];
      return `<div class="pb-row"><label>${plannerPhotoModeEsc(this._lookLabel(bag, key))}</label>`
        + `<input type="range" data-look="${bag}:${key}" min="${lim.min}" max="${lim.max}"`
        + ` step="${PLANNER_PHOTO_MODE_LOOK_STEP[key]}" value="${value}"></div>`;
    };
    ['shadowOpacity', 'shadowSoftness', 'azimuthDeg', 'elevationDeg', 'intensity', 'ambient']
      .forEach((k) => p.push(row('light', k)));
    p.push('<div class="pb-row"><button type="button" data-photo="resetlook">빛 되돌리기</button>'
      + '<span class="pb-meta">빛 방향을 사진의 그림자와 나란히 맞춰 보세요</span></div>');
    p.push('</div>');
    return p.join('');
  },

  /** 슬라이더 이름표 한 줄. 끄는 동안 이 글자만 바꿔 끼운다 (패널을 다시 그리지 않으려고). */
  _lookLabel(bag, key) {
    const BG = this.bg();
    if (!BG || !BG.state[bag]) return '';
    const v = Number(BG.state[bag][key]);
    if (!Number.isFinite(v)) return '';
    const r1 = Math.round(v * 10) / 10, r2 = Math.round(v * 100) / 100;
    const sign = v > 0 ? '+' : '';
    return {
      shadowOpacity: `그림자 ${Math.round(v * 100)}%`,
      shadowSoftness: `부드럽기 ${r1}`,
      azimuthDeg: `빛 방향 ${Math.round(v)}°`,
      elevationDeg: `빛 높이 ${Math.round(v)}°`,
      intensity: `빛 세기 ${r2}`,
      ambient: `채움 ${r2}`,
      exposure: `노출 ${r2}`,
      temperature: `색온도 ${sign}${Math.round(v)}`,
      tint: `틴트 ${sign}${Math.round(v)}`,
    }[key] || '';
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
          if (!self.active) self.enter();
          else { self.solve(); self.applyLook(); self.paint(); }
        },
      });
    }
    const area = host.querySelector('#photoArea');
    if (area) area.onchange = () => { self.setArea(area.value); };
    const fov = host.querySelector('#photoFov');
    if (fov) fov.oninput = () => { BG.patch({ fovDeg: Number(fov.value) }); };
    // P2 — 슬라이더 하나하나에 배선을 달지 않는다. 이름표(`light:azimuthDeg`)가 곧 배선이다.
    host.querySelectorAll('[data-look]').forEach((el) => {
      el.oninput = () => {
        const parts = String(el.getAttribute('data-look') || '').split(':');
        if (parts.length !== 2) return;
        const part = {};
        part[parts[1]] = Number(el.value);
        // 끄는 동안 패널을 통째로 다시 그리면 **지금 잡고 있는 손잡이가 사라진다** —
        // `patch` 는 onChange → paint → renderPanel 로 이어진다. 그래서 이 한 번만 막는다.
        self._skipPanel = true;
        try {
          if (parts[0] === 'light') BG.patchLight(part);
          else if (parts[0] === 'grade') BG.patchGrade(part);
        } finally { self._skipPanel = false; }
        // 슬라이더를 끄는 동안 패널을 통째로 다시 그리면 손잡이를 놓친다 — 이름표 글자만 고친다
        const lab = el.parentElement && el.parentElement.querySelector('label');
        if (lab) { const fresh = self._lookLabel(parts[0], parts[1]); if (fresh) lab.textContent = fresh; }
      };
    });
    host.querySelectorAll('[data-photo]').forEach((el) => {
      el.onclick = () => {
        const what = el.getAttribute('data-photo');
        if (what === 'toggle') { self.toggle(); self.renderPanel(); }
        else if (what === 'autofov') self.autoFov();
        else if (what === 'reset') { BG.resetQuad(); self.toast('사각형을 처음 자리로 되돌렸습니다'); }
        else if (what === 'resetlook') { BG.resetLook(); self.renderPanel(); self.toast('빛과 톤을 기본값으로 되돌렸습니다'); }
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
  window.plannerPhotoModeLightPos = plannerPhotoModeLightPos;
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
    PLANNER_PHOTO_MODE_CATCHER_KIND,
    PLANNER_PHOTO_MODE_SHADOW_MAP,
    PLANNER_PHOTO_MODE_LOOK_STEP,
    plannerPhotoModeLightPos,
    plannerPhotoModeBox,
    plannerPhotoModeViewport,
    plannerPhotoModeToBox,
    plannerPhotoModeFromBox,
    plannerPhotoModeEsc,
    PlannerPhotoMode,
  };
}
