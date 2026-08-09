// ============================================================
// P1: 플래너 뷰 상태와 좌표변환 — planner-view.js
//
// 두 HTML 이 `const view = { panX: 0, panY: 0, zoom: 1 }` 를 각자 갖고 있었고,
// 화면↔도면 좌표 변환식을 **인라인으로 6곳** 되풀이했다:
//     const wx = (sx - view.panX) / view.zoom;
//     const wy = (sy - view.panY) / view.zoom;
// zoom 한계값 `Math.max(0.05, Math.min(8, z))` 도 3곳에 흩어져 있었다.
//
// 이걸 모으는 이유는 중복 제거가 아니다. 앞으로 붙일 스냅·추론·도구(P4/P5)가
// **전부** 화면 픽셀을 도면 mm 로 되돌려야 하는데, 변환식이 흩어져 있으면
// 스냅 허용오차를 "화면상 8px" 로 정의하는 순간 zoom 마다 다른 값이 된다.
//
// ⚠ 클래식 스크립트라 최상위 const 가 **전역 렉시컬 스코프**에 들어간다.
//   인라인에서 같은 이름을 다시 선언하면 SyntaxError 로 그 스크립트 전체가 죽는다.
//
// applyView() 는 **여기 없다.** 두 페이지의 DOM 이 달라서다:
//   배치(shell)     — `.canvas-wrap svg.canvas-svg` > `g.content`, 이후 X버튼/치수팝업 보정
//   구조(structure) — `#contentG` / `#canvasWrap`, 이후 뷰포트 눈금자 재생성
//   공통분모는 transform 문자열과 grid 배경뿐이라 그 둘만 여기서 만든다.
// ============================================================

/** pan/zoom 뷰 상태. content 레이어의 transform 으로 적용된다. */
const view = { panX: 0, panY: 0, zoom: 1 };

/** zoom 한계 — 기존 인라인 `Math.max(0.05, Math.min(8, ...))` 과 같은 값 */
const PLANNER_ZOOM_MIN = 0.05;
const PLANNER_ZOOM_MAX = 8;

/** 배경 격자 간격(mm). 화면 격자는 이 값 × zoom. */
const PLANNER_GRID_MM = 50;

/** 화면 px → 도면 mm */
function toScene(sx, sy, v) {
  const s = v || view;
  const z = s.zoom || 1;
  return { x: (sx - s.panX) / z, y: (sy - s.panY) / z };
}

/** 도면 mm → 화면 px */
function toScreen(x, y, v) {
  const s = v || view;
  const z = s.zoom || 1;
  return { x: x * z + s.panX, y: y * z + s.panY };
}

/** 화면상 길이(px) → 도면 길이(mm). 스냅 허용오차를 zoom 무관하게 두는 데 쓴다. */
function screenToSceneLen(px, v) {
  const s = v || view;
  return px / (s.zoom || 1);
}

/** zoom 을 허용 범위로 자른다. */
function clampZoom(z) {
  return Math.max(PLANNER_ZOOM_MIN, Math.min(PLANNER_ZOOM_MAX, z));
}

/**
 * 화면 좌표 (sx, sy) 아래의 도면 점을 **제자리에 고정한 채** 확대·축소한다.
 * 휠 줌과 줌 버튼이 같은 식을 쓰던 것을 하나로 모았다. `v` 를 제자리에서 바꾼다.
 * @returns {number} 적용된 zoom
 */
function zoomAtPoint(v, sx, sy, nextZoom) {
  const s = v || view;
  const before = toScene(sx, sy, s);
  s.zoom = clampZoom(nextZoom);
  s.panX = sx - before.x * s.zoom;
  s.panY = sy - before.y * s.zoom;
  return s.zoom;
}

/** 배경 격자를 뷰에 맞춘 CSS 값. 두 페이지의 applyView 가 그대로 쓴다. */
function gridBackground(v) {
  const s = v || view;
  const sz = (PLANNER_GRID_MM * (s.zoom || 1)).toFixed(2) + 'px';
  return { size: sz + ' ' + sz, position: s.panX + 'px ' + s.panY + 'px' };
}

/** content 레이어에 넣을 transform 문자열. */
function viewTransform(v) {
  const s = v || view;
  return `translate(${s.panX} ${s.panY}) scale(${s.zoom})`;
}

/**
 * 주어진 도면 범위를 뷰포트에 맞춘다. `v` 를 제자리에서 바꾼다.
 * @param {{minX,minY,width,height}} box 도면 좌표계 범위(mm)
 * @param {number} cw 뷰포트 폭(px)
 * @param {number} ch 뷰포트 높이(px)
 * @param {number} pad 여백(px)
 */
function fitViewTo(v, box, cw, ch, pad) {
  const s = v || view;
  const p = Number.isFinite(pad) ? pad : 40;
  const w = box.width || 1;
  const h = box.height || 1;
  s.zoom = clampZoom(Math.min((cw - p * 2) / w, (ch - p * 2) / h));
  s.panX = p - box.minX * s.zoom + (cw - p * 2 - w * s.zoom) / 2;
  s.panY = p - box.minY * s.zoom + (ch - p * 2 - h * s.zoom) / 2;
  return s.zoom;
}

if (typeof window !== 'undefined') {
  window.view = view;
  window.PLANNER_ZOOM_MIN = PLANNER_ZOOM_MIN;
  window.PLANNER_ZOOM_MAX = PLANNER_ZOOM_MAX;
  window.PLANNER_GRID_MM = PLANNER_GRID_MM;
  window.toScene = toScene;
  window.toScreen = toScreen;
  window.screenToSceneLen = screenToSceneLen;
  window.clampZoom = clampZoom;
  window.zoomAtPoint = zoomAtPoint;
  window.gridBackground = gridBackground;
  window.viewTransform = viewTransform;
  window.fitViewTo = fitViewTo;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    view,
    PLANNER_ZOOM_MIN, PLANNER_ZOOM_MAX, PLANNER_GRID_MM,
    toScene, toScreen, screenToSceneLen,
    clampZoom, zoomAtPoint, gridBackground, viewTransform, fitViewTo,
  };
}
