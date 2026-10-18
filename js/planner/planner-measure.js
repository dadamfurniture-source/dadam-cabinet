// ============================================================
// 칸 내경 측정 — planner-measure.js (구조 페이지)
//
// ArchiWood 영상 분석 A (2026-10-18). 📏 내경 버튼을 켜고 3D 의 칸 안쪽(뒷판·선반 윗면·측판 안쪽)에 마우스를 올리면
// 그 칸의 안쪽 가로 × 세로를 딱지로 띄우고 빨간 선 네 줄로 잰 자리를 보여 준다.
//
// 규칙을 새로 두지 않는다 — 숫자는 이미 그려진 판(측판·천판·지판·칸막이·선반)에서 잰다.
//   1. 마우스 광선이 처음 맞는 "판"(INNER_KINDS)을 찾는다. 도어·손잡이는 건너뛴다(도어 너머 칸을 잰다).
//   2. 맞은 면은 모듈 축(±X · ±Y · 정면 +Z)을 봐야 한다 — 뒷판 안쪽, 선반·지판 윗면, 측판·칸막이 안쪽.
//      그 면에서 20mm 띄운 점이 잴 자리다.
//   3. 그 점에서 모듈 기준 ±X · ±Y 로 광선을 쏴 같은 모듈의 판까지 거리를 잰다.
//      넷 중 하나라도 빠지면(옆이 트였다 · 점이 몸통 밖이다) 표시하지 않는다.
//   가로 = 왼쪽 + 오른쪽 거리, 세로 = 위 + 아래 거리 (mm, 3D 단위가 mm 다).
//
// HTML 인라인은 버튼 한 개와 mount 한 줄만 건다.
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_MEASURE_ / plannerMeasure / PlannerMeasure 접두.
// ============================================================

/** 칸을 막는 판 — 이 종류만 광선이 멈춘다. */
const PLANNER_MEASURE_INNER_KINDS = [
  'carcass',
  'shelf',
  'wardrobeDivider',
  'wardrobeInnerTop',
  'wardrobeInnerModule',
  'drawerBox',
];
const PLANNER_MEASURE_LABEL_ID = 'plannerMeasureLabel';
// 맞은 면에서 20mm 띄운 점에서 잰다. 선반은 뒷판에서 몇 mm 떨어져 있어(깊이 D − T − 4) 뒷판 바로 앞에서 쏘면
//   선반 뒤로 광선이 빠진다. 20 이면 선반·칸막이에 맞는다. 띄운 거리는 그 방향 거리에 그대로 들어가 합이 맞다.
const PLANNER_MEASURE_OFFSET = 20;
const PLANNER_MEASURE_COLOR = 0xd32f2f;

/** 위로 올라가며 모듈 그룹(entityKind 'module')을 찾는다. */
function plannerMeasureModuleOf(obj) {
  let o = obj;
  while (o) {
    if (o.userData && o.userData.entityKind === 'module') return o;
    o = o.parent;
  }
  return null;
}

function plannerMeasureIsInner(obj) {
  return !!(
    obj &&
    obj.isMesh &&
    obj.userData &&
    PLANNER_MEASURE_INNER_KINDS.indexOf(obj.userData.entityKind) >= 0
  );
}

/** 0.1mm 로 반올림한 숫자 글자 (564 · 333.5). */
function plannerMeasureFmt(v) {
  const r = Math.round(v * 10) / 10;
  return String(r);
}

/**
 * 광선 맞음 목록(가까운 순)에서 칸 내경을 잰다. 순수 계산 — DOM 없음.
 * @param {Array} hits    raycaster.intersectObjects 결과
 * @param {object} THREE
 * @returns {null | {w:number, h:number, origin, ends:{left,right,up,down}, moduleId}}
 */
function plannerMeasureFromHits(hits, THREE) {
  const hit = (hits || []).find((h) => plannerMeasureIsInner(h.object));
  if (!hit || !hit.face) return null;
  const modG = plannerMeasureModuleOf(hit.object);
  if (!modG) return null;

  modG.updateMatrixWorld(true);
  const q = new THREE.Quaternion();
  modG.getWorldQuaternion(q);
  const ax = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(q).normalize();

  // 맞은 면의 바깥 방향 (월드). 모듈 축을 봐야 한다 — 뒷면(−Z)이나 비스듬한 면은 칸 안이 아니다.
  const nm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
  const normal = hit.face.normal.clone().applyMatrix3(nm).normalize();
  const along =
    Math.abs(normal.dot(ax(1, 0, 0))) > 0.9 ||
    Math.abs(normal.dot(ax(0, 1, 0))) > 0.9 ||
    normal.dot(ax(0, 0, 1)) > 0.9;
  if (!along) return null;

  const origin = hit.point.clone().addScaledVector(normal, PLANNER_MEASURE_OFFSET);
  const targets = [];
  modG.traverse((o) => {
    if (plannerMeasureIsInner(o)) targets.push(o);
  });

  const ray = new THREE.Raycaster();
  const dist = (dir) => {
    ray.set(origin, dir);
    ray.near = 0;
    ray.far = Infinity;
    const r = ray.intersectObjects(targets, false);
    return r.length ? r[0] : null;
  };
  const dirs = {
    left: ax(-1, 0, 0),
    right: ax(1, 0, 0),
    up: ax(0, 1, 0),
    down: ax(0, -1, 0),
  };
  const d = {};
  const ends = {};
  const by = {};
  for (const k of Object.keys(dirs)) {
    const h = dist(dirs[k]);
    if (!h) return null; // 옆이 트였다 — 칸이 아니다
    d[k] = h.distance;
    ends[k] = h.point.clone();
    by[k] = h.object.userData.entityKind;
  }
  return {
    w: d.left + d.right,
    h: d.up + d.down,
    origin,
    ends,
    by, // 어느 판에 막혔나 (left/right/up/down → entityKind)
    moduleId: modG.userData.moduleId,
  };
}

const PlannerMeasure = {
  on: false,
  _o: null,
  _lines: null,
  _raf: 0,
  _last: null,

  /**
   * @param {{three:Function, canvas:HTMLElement, button?:HTMLElement, toast?:Function}} o
   *   three() → { scene, camera, moduleGroup } (init3D 가 늦게 만들 수 있어 함수로 받는다)
   */
  mount(o) {
    this._o = o || {};
    const btn = this._o.button;
    if (btn) btn.onclick = () => this.toggle();
    const canvas = this._o.canvas;
    if (canvas) {
      canvas.addEventListener('pointermove', (e) => this._onMove(e));
      canvas.addEventListener('pointerleave', () => this.clear());
    }
    return this;
  },

  toggle(on) {
    this.on = typeof on === 'boolean' ? on : !this.on;
    const btn = this._o && this._o.button;
    if (btn) btn.classList.toggle('active', this.on);
    if (!this.on) this.clear();
    else if (this._o && typeof this._o.toast === 'function') {
      this._o.toast('📏 칸 안쪽(뒷판)에 마우스를 올리면 안쪽 가로 × 세로가 나옵니다');
    }
    return this.on;
  },

  _onMove(e) {
    if (!this.on) return;
    this._last = e;
    if (this._raf) return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => f();
    this._raf = 1;
    raf(() => {
      this._raf = 0;
      this.measureAtEvent(this._last);
    });
  },

  /** 마우스 위치에서 재고 그린다. 결과(또는 null)를 돌려준다. */
  measureAtEvent(e) {
    const t = this._o && typeof this._o.three === 'function' ? this._o.three() : null;
    const THREE = typeof window !== 'undefined' ? window.THREE : null;
    if (!t || !THREE || !e) return null;
    const canvas = this._o.canvas;
    const rect = canvas.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(p, t.camera);
    const hits = ray.intersectObjects(t.moduleGroup.children, true);
    const r = plannerMeasureFromHits(hits, THREE);
    this.draw(r, t.scene, THREE);
    this.label(r, e.clientX - rect.left, e.clientY - rect.top);
    return r;
  },

  /** 빨간 선 네 줄 — 장면에 따로 붙인다(모듈 그룹에 넣으면 클릭 고르기에 걸린다). */
  draw(r, scene, THREE) {
    if (this._lines && this._lines.parent) this._lines.parent.remove(this._lines);
    this._lines = null;
    if (!r || !scene) return null;
    const pts = [];
    ['left', 'right', 'up', 'down'].forEach((k) => pts.push(r.origin, r.ends[k]));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: PLANNER_MEASURE_COLOR, depthTest: false });
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 999;
    lines.userData = { entityKind: 'measure' };
    scene.add(lines);
    this._lines = lines;
    return lines;
  },

  label(r, x, y) {
    if (typeof document === 'undefined') return null;
    let el = document.getElementById(PLANNER_MEASURE_LABEL_ID);
    if (!r) {
      if (el) el.remove();
      return null;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = PLANNER_MEASURE_LABEL_ID;
      el.style.cssText =
        'position:absolute;z-index:30;pointer-events:none;background:#fff59d;color:#222;' +
        'border:1px solid #c9a800;border-radius:4px;padding:2px 6px;font:600 12px sans-serif;white-space:nowrap';
      const host = (this._o && this._o.canvas && this._o.canvas.parentElement) || document.body;
      host.appendChild(el);
    }
    el.textContent = '안쪽 ' + plannerMeasureFmt(r.w) + ' × ' + plannerMeasureFmt(r.h);
    el.style.left = Math.round(x + 14) + 'px';
    el.style.top = Math.round(y + 14) + 'px';
    return el;
  },

  clear() {
    if (this._lines && this._lines.parent) this._lines.parent.remove(this._lines);
    this._lines = null;
    this.label(null);
  },
};

if (typeof window !== 'undefined') {
  window.PlannerMeasure = PlannerMeasure;
  window.plannerMeasureFromHits = plannerMeasureFromHits;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PlannerMeasure,
    plannerMeasureFromHits,
    plannerMeasureFmt,
    PLANNER_MEASURE_INNER_KINDS,
  };
}
