// ============================================================
// D3: 렌더 스냅샷 — planner-capture.js (구조 페이지 · 디테일 모드 전용)
//
// 3D 씬을 **오프스크린 렌더타깃**에 찍어 PNG 로 만든다 (계획 §4.4 R2 · §5 D3).
// 화면 캔버스는 건드리지 않는다 — preserveDrawingBuffer 를 켜지 않고, 크기·pixelRatio 도 바꾸지 않는다.
// 렌더타깃은 제 크기(2048 / 4096 긴 변)를 갖고, 카메라는 찍을 때만 새로 만든다 (화면 카메라·OrbitControls 불변).
//
// 두 패스다. three 는 렌더타깃에 그릴 때 톤매핑·sRGB 출력을 **하지 않는다**
// (WebGLPrograms: currentRenderTarget !== null → NoToneMapping · LinearSRGB). 그래서
//   ① 씬 → rtA (HalfFloat, MSAA 4)                       linear
//   ② OutputPass(rtA → rtB, UnsignedByte)                 renderer.toneMapping · outputColorSpace 를 그대로 적용
//   ③ readRenderTargetPixels(rtB) → 위아래 뒤집기 → canvas 2D → toBlob('image/png')
// OutputPass 는 importmap 모듈 스크립트가 window.OutputPass 로 올린다 (RoomEnvironment 와 같은 패턴).
// 없으면 ①을 UnsignedByte 로 찍고 CPU 에서 sRGB 곡선만 입힌다 (톤매핑은 없다 — 폴백, 표시한다).
//
// 룩: 구조 모드에서 눌러도 **디테일 룩**(sRGB·ACES·환경광·PBR 재질)으로 찍는다. 켜고 끄는 것은
//   PlannerDetail.pushLook / popLook — enter/exit 와 같은 applyScene · paintScene 을 타므로 두 벌이 아니다.
//   디테일 모드면 pushLook 은 아무것도 하지 않는 토큰을 준다. 캡처 한 장은 동기(픽셀 읽기까지)라
//   animate 루프가 그 사이에 화면을 그릴 일이 없다 — 구조 모드 화면은 바이트 하나 달라지지 않는다 (I2).
//
// 카메라 프리셋 (plannerCaptureFrame, 순수):
//   front  정면 입면 — 씬 경계 중심을 −Z 로 보는 원근 카메라, fov 12° (직교에 가깝다). 종횡비 = 경계 W/H.
//   iso    3/4 — fitCameraToBounds 와 같은 (0.7, 0.5, 1)·1.4 배 거리, fov 45°. 종횡비 = 화면 캔버스.
//   plan   평면 — 위에서 −Y, up = −Z (뒷벽이 위). fov 12°. 종횡비 = 경계 W/D.
//   module:<id>  그 모듈 하나의 경계로 iso.
//   경계는 mesh 만 센다 — 배치 공간 상자(area)·선택 테두리(pick)·원점 마커(선)는 뺀다.
//
// 저장 (PlannerStore.saveRender, planner-store.js): 버킷 renders 의 {design}/{item}/{kind}-{yyyymmddHHMMss}.png
//   + design_renders 행 (kind · path · width/height · camera · detail_hash). 스코프가 없으면(design=local ·
//   로그인 전) <a download> 로 이 브라우저에 내려받는다 — 이 페이지는 앱 페이지라 다운로드가 된다.
//   detail_hash 는 마감 모델 JSON(키 정렬)의 sha-256 — 렌더가 어느 마감 상태였는지 맞춰 본다.
//
// 페이지가 넘기는 것 (PlannerCapture.mount(o)):
//   three()          { renderer, scene, camera, controls, moduleGroup } — init3D 전이면 null
//   toast(text)      알림
//   ids()            선택 — 스코프 {designId, itemId}. 기본 plannerScopeIds()
//   activeModuleId() 선택 — "이 모듈" 메뉴가 찍을 모듈
//   moduleLabel(id)  선택 — 토스트·파일명용 모듈 이름
//   detail()         선택 — 해시할 마감 모델. 기본 PlannerDetail.detail
//
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_CAPTURE_ / plannerCapture / PlannerCapture 접두.
//   three 는 전역 window.THREE. 없으면 capture 가 { ok:false, reason:'no-three' } 를 돌려준다.
// ============================================================

/** Storage 버킷. database/design-renders.sql 과 같은 이름이어야 한다. */
const PLANNER_CAPTURE_BUCKET = 'renders';
/** "렌더 저장" 한 번에 찍는 프리셋 순서 */
const PLANNER_CAPTURE_KINDS = ['front', 'iso', 'plan'];
const PLANNER_CAPTURE_KIND_LABEL = { front: '정면', iso: '3/4', plan: '평면', module: '모듈' };
const PLANNER_CAPTURE_LONG_EDGE = 2048;
const PLANNER_CAPTURE_LONG_EDGE_HI = 4096;
/** 경계 둘레 여백 (8%) */
const PLANNER_CAPTURE_MARGIN = 1.08;
const PLANNER_CAPTURE_FOV = { front: 12, plan: 12, iso: 45, module: 45 };
/**
 * 경계 계산에서 빼는 entityKind — 부재가 아니다.
 * `shadow-catcher` 는 P2 의 그림자 받개다 (`photo-mode.js`). 가구보다 훨씬 넓은 y=0 평면이라
 * 세면 프레이밍이 통째로 어긋난다 — 계획 §1.4 G5 가 이 이름표를 두라고 정한 이유다.
 */
const PLANNER_CAPTURE_BOUNDS_SKIP = { area: true, pick: true, 'shadow-catcher': true };
/** 종횡비 한계 — 아주 납작하거나 긴 씬도 화면에 들어오게 */
const PLANNER_CAPTURE_ASPECT_MIN = 0.5;
const PLANNER_CAPTURE_ASPECT_MAX = 3;

/** 우측 "최근 렌더" 띠의 CSS. 메뉴는 planner-drawing-menu.js 의 .pdm-* 를 그대로 쓴다. */
const PLANNER_CAPTURE_CSS = `
.pc-head{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:10.5px;font-weight:600;color:var(--text-dim,#7a7062);margin-bottom:6px}
.pc-head .pc-refresh{border:1px solid var(--line,#e5e0d4);background:#fff;color:var(--text-dim,#7a7062);border-radius:999px;padding:1px 7px;font-size:11px;cursor:pointer;font-family:inherit}
.pc-hint{font-size:10px;color:var(--text-faint,#a89c84);line-height:1.5}
.pc-thumbs{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
.pc-thumb{display:flex;flex-direction:column;gap:2px;border:1px solid var(--line,#e5e0d4);border-radius:6px;background:#fff;padding:3px;text-decoration:none;color:var(--text,#2b2620);min-width:0}
.pc-thumb img{display:block;width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:4px;background:#f4efe7}
.pc-thumb .pc-cap{font-size:9.5px;color:var(--text-dim,#7a7062);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pc-thumb .pc-nourl{display:block;aspect-ratio:3/2;font-size:10px;color:var(--text-faint,#a89c84);text-align:center;line-height:60px}
a.pc-thumb:hover{border-color:var(--brand-mid,#b8956c)}
`;

function plannerCaptureInjectCss() {
  if (typeof document === 'undefined' || document.getElementById('planner-capture-css')) return;
  const st = document.createElement('style');
  st.id = 'planner-capture-css';
  st.textContent = PLANNER_CAPTURE_CSS;
  document.head.appendChild(st);
}

// ── 순수 함수 ────────────────────────────────────────────

/** 'module:lower-0' → {kind:'module', moduleId:'lower-0'}. 나머지는 그대로. */
function plannerCaptureParseKind(kind, moduleId) {
  const k = String(kind || 'iso');
  if (k.indexOf('module:') === 0) return { kind: 'module', moduleId: k.slice(7) };
  if (k === 'module') return { kind: 'module', moduleId: moduleId == null ? null : String(moduleId) };
  return { kind: PLANNER_CAPTURE_FOV[k] ? k : 'iso', moduleId: null };
}

/** yyyymmddHHMMss — 파일명용 (지역 시각). */
function plannerCaptureStamp(date) {
  const d = date instanceof Date ? date : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

/** 파일명·경로에 들어갈 수 있는 글자만 */
function plannerCaptureSafeId(s) {
  return String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}

/** 파일 이름 — {kind}-{stamp}.png / module-{id}-{stamp}.png */
function plannerCaptureFileName(kind, moduleId, date) {
  const k = plannerCaptureParseKind(kind, moduleId);
  const stamp = plannerCaptureStamp(date);
  return k.kind === 'module'
    ? 'module-' + plannerCaptureSafeId(k.moduleId) + '-' + stamp + '.png'
    : k.kind + '-' + stamp + '.png';
}

/**
 * 버킷 안의 객체 키 — {designId}/{itemId}/{fileName}. 첫 폴더가 design_id 라 Storage 정책이 소유자를 판정한다.
 * 스코프가 없으면 null (올릴 곳이 없다).
 */
function plannerCapturePath(ids, kind, moduleId, date) {
  if (!ids || !ids.designId || ids.itemId == null) return null;
  return String(ids.designId) + '/' + String(ids.itemId) + '/' + plannerCaptureFileName(kind, moduleId, date);
}

/** 키를 정렬한 JSON — 같은 지정이면 같은 문자열. */
function plannerCaptureStableJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(plannerCaptureStableJson).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + plannerCaptureStableJson(v[k])).join(',') + '}';
}

/**
 * sha-256 (동기, 순수 JS). crypto.subtle 은 비동기라 jsdom·워커에서 다르게 굴고, 여기 입력은 몇 KB 라 이게 낫다.
 * 입력은 UTF-8 로 바꿔 해시한다. 결과는 64자 소문자 hex.
 */
function plannerCaptureSha256(text) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  // UTF-8
  const s = String(text == null ? '' : text);
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00); i++; }
    }
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => ('00000000' + x.toString(16)).slice(-8)).join('');
}

/** 마감 모델 → detail_hash. 모델이 없으면 null 의 해시 (빈 지정도 값이 있어야 "그때 아무것도 없었다" 를 안다). */
function plannerCaptureDetailHash(detail) {
  return plannerCaptureSha256(plannerCaptureStableJson(detail == null ? null : detail));
}

/** 긴 변·종횡비 → 정수 픽셀 크기. 둘 다 ≥ 1. */
function plannerCaptureSizeFor(longEdge, aspect) {
  const L = Math.max(1, Math.round(Number(longEdge) || PLANNER_CAPTURE_LONG_EDGE));
  const a = (typeof aspect === 'number' && aspect > 0 && Number.isFinite(aspect)) ? aspect : 1.5;
  if (a >= 1) return { width: L, height: Math.max(1, Math.round(L / a)) };
  return { width: Math.max(1, Math.round(L * a)), height: L };
}

function plannerCaptureClampAspect(a) {
  if (!(typeof a === 'number') || !Number.isFinite(a) || a <= 0) return 1.5;
  return Math.min(PLANNER_CAPTURE_ASPECT_MAX, Math.max(PLANNER_CAPTURE_ASPECT_MIN, a));
}

/** 프리셋별 종횡비 — front 는 경계 W/H, plan 은 W/D, iso·module 은 화면 캔버스(없으면 3:2). */
function plannerCaptureAspectFor(kind, bounds, canvasAspect) {
  const k = plannerCaptureParseKind(kind).kind;
  if (bounds && (k === 'front' || k === 'plan')) {
    const W = bounds.max.x - bounds.min.x, H = bounds.max.y - bounds.min.y, D = bounds.max.z - bounds.min.z;
    const den = k === 'front' ? H : D;
    if (W > 0 && den > 0) return plannerCaptureClampAspect(W / den);
  }
  return plannerCaptureClampAspect(canvasAspect);
}

/**
 * 경계 → 카메라. 순수 — three 없이 시험한다.
 * @param {string} kind front | iso | plan | module
 * @param {{min:{x,y,z}, max:{x,y,z}}} bounds
 * @param {number} aspect 가로/세로
 * @returns {{kind, fov, aspect, position:number[], target:number[], up:number[], near, far, dist}|null}
 */
function plannerCaptureFrame(kind, bounds, aspect) {
  if (!bounds || !bounds.min || !bounds.max) return null;
  const k = plannerCaptureParseKind(kind).kind;
  const W = Math.max(1, bounds.max.x - bounds.min.x);
  const H = Math.max(1, bounds.max.y - bounds.min.y);
  const D = Math.max(1, bounds.max.z - bounds.min.z);
  const c = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
  const a = plannerCaptureClampAspect(aspect);
  const M = PLANNER_CAPTURE_MARGIN;
  const fov = PLANNER_CAPTURE_FOV[k] || 45;
  const t = Math.tan((fov / 2) * Math.PI / 180);
  let dist, position, up;
  if (k === 'front') {
    // 앞면(max.z)에서 H·W 가 다 들어오는 거리 + 중심까지 D/2
    dist = Math.max((H * M) / (2 * t), (W * M) / (2 * t * a)) + D / 2;
    position = [c.x, c.y, c.z + dist];
    up = [0, 1, 0];
  } else if (k === 'plan') {
    // 윗면(max.y)에서 D·W 가 다 들어오는 거리 + H/2. up = −Z 라 뒷벽이 그림 위쪽.
    dist = Math.max((D * M) / (2 * t), (W * M) / (2 * t * a)) + H / 2;
    position = [c.x, c.y + dist, c.z];
    up = [0, 0, -1];
  } else {
    // iso — mockup-structure.html fitCameraToBounds 와 같은 비율
    const size = Math.max(W, H, D);
    dist = size * 1.4;
    position = [c.x + dist * 0.7, c.y + dist * 0.5, c.z + dist];
    up = [0, 1, 0];
  }
  const diag = Math.sqrt(W * W + H * H + D * D);
  return {
    kind: k,
    fov,
    aspect: a,
    position,
    target: [c.x, c.y, c.z],
    up,
    near: 10,
    far: Math.ceil(dist * 4 + diag + 20000),
    dist,
  };
}

/** design_renders.camera 에 넣을 모양 — 좌표는 정수 mm 로 줄인다. */
function plannerCaptureCameraJson(frame, longEdge, moduleId) {
  if (!frame) return null;
  const r = (v) => Math.round(v);
  const out = {
    kind: frame.kind,
    fov: frame.fov,
    aspect: Math.round(frame.aspect * 1000) / 1000,
    position: frame.position.map(r),
    target: frame.target.map(r),
    up: frame.up,
    longEdge: longEdge,
  };
  if (moduleId != null) out.moduleId = String(moduleId);
  return out;
}

/**
 * mesh 만 모아 세계 좌표 경계를 잰다. area·pick 은 뺀다 (부재가 아니다). 선(LineSegments)도 뺀다 — 원점 마커.
 * @param {object} root three Object3D (moduleGroup 또는 모듈 그룹)
 * @param {object} T three 네임스페이스
 * @returns {{min:{x,y,z}, max:{x,y,z}}|null} mesh 가 없으면 null
 */
function plannerCaptureBoundsOf(root, T) {
  if (!root || !T || typeof root.traverse !== 'function') return null;
  try { root.updateWorldMatrix(true, true); } catch (e) { /* 순수 객체면 없다 */ }
  const box = new T.Box3();
  const tmp = new T.Box3();
  let any = false;
  root.traverse((obj) => {
    if (!obj || !obj.isMesh || !obj.geometry) return;
    const ud = obj.userData || {};
    if (ud.entityKind && PLANNER_CAPTURE_BOUNDS_SKIP[ud.entityKind]) return;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    if (!obj.geometry.boundingBox) return;
    tmp.copy(obj.geometry.boundingBox).applyMatrix4(obj.matrixWorld);
    if (tmp.isEmpty()) return;
    box.union(tmp);
    any = true;
  });
  if (!any) return null;
  return { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } };
}

/** moduleGroup 안에서 그 모듈의 그룹 (createModuleMesh 가 userData.entityKind='module' 을 붙인다). */
function plannerCaptureModuleObject(group, moduleId) {
  if (!group || moduleId == null || typeof group.traverse !== 'function') return null;
  let found = null;
  group.traverse((obj) => {
    if (found || !obj || !obj.userData) return;
    if (obj.userData.entityKind === 'module' && String(obj.userData.moduleId) === String(moduleId)) found = obj;
  });
  return found;
}

/**
 * readRenderTargetPixels 는 아래 줄부터 준다 — 위아래를 뒤집고 알파는 255 로 (배경은 불투명하다).
 * @param {Uint8Array|Uint8ClampedArray} src RGBA, 아래→위
 * @returns {Uint8ClampedArray} RGBA, 위→아래
 */
function plannerCaptureFlipRows(src, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * row;
    out.set(src.subarray(from, from + row), y * row);
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

/** linear → sRGB (8비트 LUT). OutputPass 가 없을 때의 폴백. */
let PLANNER_CAPTURE_SRGB_LUT = null;
function plannerCaptureSrgbLut() {
  if (PLANNER_CAPTURE_SRGB_LUT) return PLANNER_CAPTURE_SRGB_LUT;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    lut[i] = Math.round(s * 255);
  }
  PLANNER_CAPTURE_SRGB_LUT = lut;
  return lut;
}
function plannerCaptureApplySrgb(px) {
  const lut = plannerCaptureSrgbLut();
  for (let i = 0; i < px.length; i += 4) { px[i] = lut[px[i]]; px[i + 1] = lut[px[i + 1]]; px[i + 2] = lut[px[i + 2]]; }
  return px;
}

// ── 캡처 ────────────────────────────────────────────────

const PlannerCapture = {
  BUCKET: PLANNER_CAPTURE_BUCKET,
  KINDS: PLANNER_CAPTURE_KINDS,
  LONG_EDGE: PLANNER_CAPTURE_LONG_EDGE,
  LONG_EDGE_HI: PLANNER_CAPTURE_LONG_EDGE_HI,
  frame: plannerCaptureFrame,
  path: plannerCapturePath,
  fileName: plannerCaptureFileName,
  detailHash: plannerCaptureDetailHash,
  _o: null,
  /** PNG 인코더 — 시험이 갈아 끼운다. 기본은 canvas 2D toBlob. */
  _encode: null,
  _outputPass: null,
  /** 캡처 중인가 (메뉴가 버튼을 잠근다) */
  busy: false,

  mount(o) {
    this._o = o || {};
    return this;
  },

  three() {
    if (!this._o || typeof this._o.three !== 'function') return null;
    try { return this._o.three() || null; } catch (e) { return null; }
  },

  T() {
    return (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
  },

  toast(text) {
    if (this._o && typeof this._o.toast === 'function') { try { this._o.toast(text); } catch (e) { /* 무해 */ } }
  },

  ids() {
    if (this._o && typeof this._o.ids === 'function') { try { return this._o.ids() || {}; } catch (e) { return {}; } }
    return (typeof plannerScopeIds === 'function') ? plannerScopeIds() : {};
  },

  /** 해시할 마감 모델 — 기본은 PlannerDetail.detail */
  detailModel() {
    if (this._o && typeof this._o.detail === 'function') { try { return this._o.detail(); } catch (e) { return null; } }
    return (typeof PlannerDetail !== 'undefined' && PlannerDetail) ? (PlannerDetail.detail || null) : null;
  },

  /** 화면 캔버스 종횡비 — iso 프리셋용. renderer.getSize 가 없으면 3:2. */
  canvasAspect() {
    const t = this.three();
    const T = this.T();
    try {
      if (t && t.renderer && typeof t.renderer.getSize === 'function' && T && T.Vector2) {
        const v = t.renderer.getSize(new T.Vector2());
        if (v.x > 0 && v.y > 0) return v.x / v.y;
      }
    } catch (e) { /* 아래 폴백 */ }
    return 1.5;
  },

  /** OutputPass 하나를 재사용한다 (셰이더 컴파일은 한 번). 없으면 null → 폴백 경로. */
  outputPass() {
    if (this._outputPass) return this._outputPass;
    const OP = (typeof window !== 'undefined') ? window.OutputPass : null;
    if (!OP) return null;
    try { this._outputPass = new OP(); } catch (e) { this._outputPass = null; }
    return this._outputPass;
  },

  /**
   * 한 장을 픽셀까지 **동기로** 찍는다. 렌더타깃·카메라는 여기서 만들고 여기서 놓는다.
   * 룩(pushLook/popLook)도 이 안에서 켜고 끈다 — 돌아올 때 씬·renderer 는 들어올 때 값이다.
   * @param {{kind:string, moduleId?:string, longEdge?:number}} opt
   * @returns {{ok:true, kind, moduleId, width, height, camera, frame, pixels:Uint8ClampedArray, toneMapped:boolean}
   *         | {ok:false, reason:string, message:string}}
   */
  capturePixels(opt) {
    opt = opt || {};
    const t = this.three();
    const T = this.T();
    if (!t || !t.renderer || !t.scene || !T) return { ok: false, reason: 'no-three', message: '3D 가 아직 준비되지 않았습니다' };
    const k = plannerCaptureParseKind(opt.kind, opt.moduleId);
    const r = t.renderer;
    let longEdge = Number(opt.longEdge) || PLANNER_CAPTURE_LONG_EDGE;
    const cap = r.capabilities && r.capabilities.maxTextureSize;
    if (cap && longEdge > cap) longEdge = cap;

    const PD = (typeof PlannerDetail !== 'undefined' && PlannerDetail && typeof PlannerDetail.pushLook === 'function') ? PlannerDetail : null;
    const look = PD ? PD.pushLook() : null;
    const prevRT = (typeof r.getRenderTarget === 'function') ? r.getRenderTarget() : null;
    let rtA = null, rtB = null;
    try {
      // 경계 — 룩을 켠 뒤에 잰다 (mesh 는 그대로지만 순서를 한 곳에 둔다)
      const root = k.kind === 'module' ? plannerCaptureModuleObject(t.moduleGroup, k.moduleId) : t.moduleGroup;
      const bounds = plannerCaptureBoundsOf(root, T);
      if (!bounds) {
        return { ok: false, reason: 'empty', message: k.kind === 'module' ? '그 모듈이 3D 에 없습니다' : '3D 에 찍을 모듈이 없습니다' };
      }
      const aspect = plannerCaptureAspectFor(k.kind, bounds, this.canvasAspect());
      const frame = plannerCaptureFrame(k.kind, bounds, aspect);
      const size = plannerCaptureSizeFor(longEdge, frame.aspect);
      const width = size.width, height = size.height;

      const cam = new T.PerspectiveCamera(frame.fov, width / height, frame.near, frame.far);
      cam.position.set(frame.position[0], frame.position[1], frame.position[2]);
      cam.up.set(frame.up[0], frame.up[1], frame.up[2]);
      cam.lookAt(frame.target[0], frame.target[1], frame.target[2]);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);

      const out = this.outputPass();
      rtA = new T.WebGLRenderTarget(width, height, {
        type: out && T.HalfFloatType !== undefined ? T.HalfFloatType : T.UnsignedByteType,
        samples: 4,
        depthBuffer: true,
      });
      r.setRenderTarget(rtA);
      r.render(t.scene, cam);
      let src = rtA;
      if (out) {
        rtB = new T.WebGLRenderTarget(width, height, { type: T.UnsignedByteType, depthBuffer: false });
        out.render(r, rtB, rtA);   // renderer.toneMapping · outputColorSpace 를 그대로 입힌다
        src = rtB;
      }
      const raw = new Uint8Array(width * height * 4);
      r.readRenderTargetPixels(src, 0, 0, width, height, raw);
      const pixels = plannerCaptureFlipRows(raw, width, height);
      if (!out) plannerCaptureApplySrgb(pixels);   // 폴백: 톤매핑 없이 sRGB 곡선만
      return {
        ok: true,
        kind: k.kind,
        moduleId: k.moduleId,
        width,
        height,
        frame,
        camera: plannerCaptureCameraJson(frame, longEdge, k.moduleId),
        pixels,
        toneMapped: !!out,
      };
    } catch (e) {
      return { ok: false, reason: 'error', message: (e && e.message) || String(e) };
    } finally {
      try { r.setRenderTarget(prevRT); } catch (e) { /* 무해 */ }
      if (rtA) { try { rtA.dispose(); } catch (e) { /* 무해 */ } }
      if (rtB) { try { rtB.dispose(); } catch (e) { /* 무해 */ } }
      if (PD && look) PD.popLook(look);
    }
  },

  /** RGBA 픽셀 → PNG Blob. 시험은 _encode 로 갈아 끼운다. */
  encode(pixels, width, height) {
    if (typeof this._encode === 'function') return Promise.resolve(this._encode(pixels, width, height));
    return new Promise((resolve, reject) => {
      try {
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const ctx = c.getContext('2d');
        if (!ctx) { reject(new Error('canvas 2D 를 만들 수 없습니다')); return; }
        ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 인코딩 실패'))), 'image/png');
      } catch (e) { reject(e); }
    });
  },

  /**
   * 한 장 — 찍고 PNG 로. { ok, kind, moduleId, width, height, camera, blob, fileName, toneMapped } | { ok:false, reason, message }
   * @param {{kind:string, moduleId?:string, longEdge?:number, date?:Date}} opt
   */
  async capture(opt) {
    opt = opt || {};
    const shot = this.capturePixels(opt);
    if (!shot.ok) return shot;
    let blob;
    try { blob = await this.encode(shot.pixels, shot.width, shot.height); }
    catch (e) { return { ok: false, reason: 'encode', message: (e && e.message) || String(e) }; }
    return {
      ok: true,
      kind: shot.kind,
      moduleId: shot.moduleId,
      width: shot.width,
      height: shot.height,
      camera: shot.camera,
      toneMapped: shot.toneMapped,
      blob,
      fileName: plannerCaptureFileName(shot.kind, shot.moduleId, opt.date),
    };
  },

  /**
   * 정면·3/4·평면 (+ 모듈들). 한 장씩 차례로 — 픽셀 버퍼를 겹쳐 들지 않는다.
   * @param {{longEdge?:number, modules?:string[], kinds?:string[], onProgress?:(i,n,kind)=>void}} [opt]
   * @returns {Promise<{shots:object[], failed:object[]}>}
   */
  async captureAll(opt) {
    opt = opt || {};
    const date = opt.date || new Date();
    const jobs = (opt.kinds || PLANNER_CAPTURE_KINDS).map((kind) => ({ kind }));
    (opt.modules || []).forEach((id) => jobs.push({ kind: 'module', moduleId: id }));
    const shots = [], failed = [];
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      if (typeof opt.onProgress === 'function') { try { opt.onProgress(i, jobs.length, j.kind); } catch (e) { /* 무해 */ } }
      const s = await this.capture({ kind: j.kind, moduleId: j.moduleId, longEdge: opt.longEdge, date });
      if (s.ok) shots.push(s);
      else failed.push(Object.assign({ kind: j.kind, moduleId: j.moduleId }, s));
    }
    return { shots, failed };
  },

  // ── 저장 흐름 (📷 렌더 저장) ────────────────────────────

  /** <a download> — 앱 페이지라 된다 (아티팩트 샌드박스가 아니다). 시험은 이 메서드를 스파이한다. */
  download(blob, name) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name || 'render.png';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* 무해 */ } }, 10000);
      return true;
    } catch (e) { return false; }
  },

  /** 계정에 못 올리는 이유를 사람 말로. 이유마다 할 일이 다르다. */
  excuse(reason) {
    if (reason === 'no-scope') return '설계를 아직 저장하지 않아 이 브라우저에 내려받았습니다 — 설계를 저장한 뒤 다시 누르면 계정에 올라갑니다';
    if (reason === 'no-item') return "품목이 아직 없어 이 브라우저에 내려받았습니다 — 좌측 '품목' 아이콘으로 품목을 먼저 추가하세요";
    if (reason === 'no-session') return '로그인하지 않아 이 브라우저에 내려받았습니다 — 로그인하면 계정에 저장됩니다';
    if (reason === 'no-sdk') return '이 화면에서는 계정 저장을 쓸 수 없어 이 브라우저에 내려받았습니다';
    if (reason === 'no-bucket') return 'Storage 버킷 renders 가 없습니다 — Supabase 에서 비공개 버킷 renders 를 만들고 database/design-renders.sql 을 실행하세요';
    if (reason === 'empty') return '3D 에 찍을 모듈이 없습니다';
    if (reason === 'no-three') return '3D 가 아직 준비되지 않았습니다';
    if (reason === 'busy') return '렌더가 진행 중입니다';
    return '';
  },

  /**
   * 찍고 올린다. 스코프가 없으면(설계 미저장·로그인 전) 내려받는다.
   * @param {{longEdge?:number, modules?:string[], kinds?:string[]}} [opt]
   * @returns {Promise<{ok:boolean, mode:'upload'|'download'|null, saved:number, total:number, failed:object[], reason?:string}>}
   */
  async saveAll(opt) {
    opt = opt || {};
    if (this.busy) return { ok: false, reason: 'busy', mode: null, saved: 0, total: 0, failed: [] };
    this.busy = true;
    const date = new Date();
    const longEdge = Number(opt.longEdge) || PLANNER_CAPTURE_LONG_EDGE;
    this._setBusy(true, '📷 렌더 중…');
    try {
      const ready = (typeof PlannerStore !== 'undefined' && PlannerStore)
        ? await PlannerStore.ready(this.ids())
        : { ok: false, reason: 'no-sdk' };
      const res = await this.captureAll({
        longEdge, date, kinds: opt.kinds, modules: opt.modules,
        onProgress: (i, n, kind) => this._setBusy(true, `📷 ${PLANNER_CAPTURE_KIND_LABEL[plannerCaptureParseKind(kind).kind] || kind} ${i + 1}/${n}`),
      });
      const total = res.shots.length + res.failed.length;
      if (!res.shots.length) {
        const why = res.failed[0] || {};
        this.toast('⚠ 렌더 실패: ' + (why.message || this.excuse(why.reason) || why.reason || '알 수 없음'));
        return { ok: false, reason: why.reason || 'error', mode: null, saved: 0, total, failed: res.failed };
      }
      if (!ready.ok) {
        // 올릴 곳이 없다 — 이 브라우저에 내려받는다
        let n = 0;
        res.shots.forEach((s) => { if (this.download(s.blob, s.fileName)) n++; });
        this.toast(`📷 렌더 ${n}장 — ${this.excuse(ready.reason) || ready.reason}`);
        return { ok: n > 0, reason: ready.reason, mode: 'download', saved: n, total, failed: res.failed };
      }
      const detailHash = plannerCaptureDetailHash(this.detailModel());
      let saved = 0;
      const failed = res.failed.slice();
      for (let i = 0; i < res.shots.length; i++) {
        const s = res.shots[i];
        this._setBusy(true, `☁ 올리는 중 ${i + 1}/${res.shots.length}`);
        const path = plannerCapturePath(ready.ids, s.kind, s.moduleId, date);
        const r = await PlannerStore.saveRender({
          ids: ready.ids, blob: s.blob, path, kind: s.kind, moduleId: s.moduleId,
          width: s.width, height: s.height, camera: s.camera, detailHash,
        });
        if (r.ok) { saved++; continue; }
        failed.push(Object.assign({ kind: s.kind, moduleId: s.moduleId }, r));
        if (r.reason === 'no-bucket') break;   // 나머지도 같은 이유로 실패한다
      }
      const bucketMissing = failed.some((f) => f.reason === 'no-bucket');
      if (bucketMissing) {
        // 계정에 못 올렸으니 최소한 내려받게 한다
        res.shots.forEach((s) => this.download(s.blob, s.fileName));
        this.toast('⚠ ' + this.excuse('no-bucket') + ' (렌더는 이 브라우저에 내려받았습니다)');
      } else if (failed.length) {
        this.toast(`📷 렌더 ${saved}/${total}장 저장 — 실패: ${failed.map((f) => f.message || f.reason).join(', ')}`);
      } else {
        this.toast(`📷 렌더 ${saved}장을 계정에 저장했습니다 (${longEdge}px${res.shots.some((s) => !s.toneMapped) ? ' · 톤매핑 없음' : ''})`);
      }
      if (saved && typeof this.refreshStrip === 'function') { try { this.refreshStrip(); } catch (e) { /* 무해 */ } }
      if (saved && this._o && typeof this._o.onSaved === 'function') { try { this._o.onSaved(saved); } catch (e) { /* 무해 */ } }
      return { ok: saved > 0, reason: bucketMissing ? 'no-bucket' : undefined, mode: 'upload', saved, total, failed };
    } finally {
      this.busy = false;
      this._setBusy(false);
    }
  },

  // ── 최근 렌더 띠 (우측 패널 #detailRendersBody) ────────────

  /** 디테일 모드에 들어올 때 PlannerDetail.enter 가 부른다. */
  onDetailEnter() {
    plannerCaptureInjectCss();
    return this.refreshStrip();
  },

  /**
   * 이 품목의 최근 렌더를 서명 URL 썸네일로. 스코프가 없으면 그 이유를 한 줄로.
   * @returns {Promise<{ok:boolean, rows:object[]}>}
   */
  async refreshStrip() {
    const host = (typeof document !== 'undefined') ? document.getElementById('detailRendersBody') : null;
    if (!host) return { ok: false, rows: [] };
    plannerCaptureInjectCss();
    if (typeof PlannerStore === 'undefined' || !PlannerStore) {
      host.innerHTML = '<div class="empty-msg">이 화면에서는 계정 렌더를 볼 수 없습니다</div>';
      return { ok: false, rows: [] };
    }
    const seq = (this._stripSeq = (this._stripSeq || 0) + 1);
    const r = await PlannerStore.listRenders(this.ids(), { limit: 12 });
    if (seq !== this._stripSeq) return r;   // 나중에 시작한 갱신이 이긴다
    this.renderStrip(host, r);
    return r;
  },

  renderStrip(host, r) {
    const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    if (!r || !r.ok) {
      const why = r && r.reason;
      const text = why === 'no-scope' ? '설계를 저장하면 계정의 렌더가 여기 보입니다'
        : why === 'no-session' ? '로그인하면 계정의 렌더가 여기 보입니다'
        : why === 'no-item' ? '품목을 먼저 추가하세요'
        : why === 'no-sdk' ? '이 화면에서는 계정 렌더를 볼 수 없습니다'
        : '렌더 목록을 읽지 못했습니다' + (r && r.message ? ' — ' + r.message : '');
      host.innerHTML = `<div class="empty-msg">${esc(text)}</div>`;
      return;
    }
    const rows = r.rows || [];
    const parts = [`<div class="pc-head"><span>${rows.length ? `최근 ${rows.length}장` : '아직 없음'}</span><button type="button" class="pc-refresh" title="다시 읽기">↻</button></div>`];
    if (!rows.length) {
      parts.push('<div class="pc-hint">📷 렌더 저장을 누르면 정면·3/4·평면이 계정에 저장됩니다</div>');
    } else {
      parts.push('<div class="pc-thumbs">');
      rows.forEach((row) => {
        const when = (typeof plannerSnapshotWhen === 'function') ? plannerSnapshotWhen(row.created_at) : '';
        const label = (PLANNER_CAPTURE_KIND_LABEL[row.kind] || row.kind) + (row.kind === 'module' && row.module_id ? ' ' + row.module_id : '');
        const size = (row.width && row.height) ? `${row.width}×${row.height}` : '';
        const inner = row.url
          ? `<img src="${esc(row.url)}" alt="${esc(label)}" loading="lazy">`
          : '<span class="pc-nourl">URL 없음</span>';
        parts.push(row.url
          ? `<a class="pc-thumb" href="${esc(row.url)}" target="_blank" rel="noopener" title="${esc(label)} · ${esc(when)} · ${esc(size)}">${inner}<span class="pc-cap">${esc(label)} · ${esc(when)}</span></a>`
          : `<div class="pc-thumb" title="${esc(label)}">${inner}<span class="pc-cap">${esc(label)} · ${esc(when)}</span></div>`);
      });
      parts.push('</div>');
    }
    host.innerHTML = parts.join('');
    const btn = host.querySelector('.pc-refresh');
    if (btn) btn.onclick = () => this.refreshStrip();
  },

  _menu: null,

  /** 버튼 잠금·진행 표시. mountMenu 전이면 아무것도 안 한다. */
  _setBusy(on, text) {
    const m = this._menu;
    if (!m) return;
    if (m.btn) {
      if (on && m._label == null) m._label = m.btn.textContent;
      m.btn.disabled = !!on;
      m.btn.textContent = on ? (text || '📷 렌더 중…') : (m._label != null ? m._label : m.btn.textContent);
      if (!on) m._label = null;
    }
    if (m.menuBtn) m.menuBtn.disabled = !!on;
  },

  /**
   * 📷 렌더 저장 버튼 + 📷▾ 옵션 메뉴. CSS 는 planner-drawing-menu.js 의 .pdm-* 를 그대로 쓴다.
   * @param {{btn:Element, menuBtn?:Element, menu?:Element}} o
   */
  mountMenu(o) {
    o = o || {};
    this._menu = { btn: o.btn || null, menuBtn: o.menuBtn || null, menu: o.menu || null, _label: null };
    const m = this._menu;
    if (m.btn) m.btn.onclick = () => { this.saveAll({ longEdge: PLANNER_CAPTURE_LONG_EDGE }); };
    if (m.menuBtn && m.menu) {
      const close = () => { m.menu.hidden = true; };
      const render = () => {
        const activeId = (this._o && typeof this._o.activeModuleId === 'function') ? this._o.activeModuleId() : null;
        const label = (id) => (this._o && typeof this._o.moduleLabel === 'function') ? this._o.moduleLabel(id) : String(id);
        const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        m.menu.innerHTML = [
          '<div class="pdm-stage"><span>렌더 저장</span></div>',
          `<button type="button" class="pdm-row" data-render="std">정면 · 3/4 · 평면 — ${PLANNER_CAPTURE_LONG_EDGE}px<span class="pdm-meta">기본. 버튼과 같다</span></button>`,
          `<button type="button" class="pdm-row" data-render="hi">정면 · 3/4 · 평면 — ${PLANNER_CAPTURE_LONG_EDGE_HI}px<span class="pdm-meta">인쇄용. 시간이 더 걸린다</span></button>`,
          `<button type="button" class="pdm-row" data-render="module"${activeId == null ? ' disabled' : ''}>이 모듈 — ${PLANNER_CAPTURE_LONG_EDGE}px<span class="pdm-meta">${activeId == null ? '좌측 목록에서 모듈을 고르세요' : esc(label(activeId))}</span></button>`,
          '<div class="pdm-sep"></div>',
          '<div class="pdm-note">디테일 룩(마감·광택·환경광)으로 찍습니다. 설계를 저장했고 로그인했으면 계정(Storage renders)에, 아니면 이 브라우저에 내려받습니다.</div>',
        ].join('');
        m.menu.querySelectorAll('[data-render]').forEach((el) => {
          el.onclick = (e) => {
            e.stopPropagation();
            close();
            const what = el.dataset.render;
            if (what === 'hi') this.saveAll({ longEdge: PLANNER_CAPTURE_LONG_EDGE_HI });
            else if (what === 'module') { if (activeId != null) this.saveAll({ longEdge: PLANNER_CAPTURE_LONG_EDGE, kinds: [], modules: [activeId] }); }
            else this.saveAll({ longEdge: PLANNER_CAPTURE_LONG_EDGE });
          };
        });
      };
      m.menuBtn.onclick = (e) => {
        e.stopPropagation();
        m.menu.hidden = !m.menu.hidden;
        if (!m.menu.hidden) render();
      };
      try {
        document.addEventListener('click', (e) => {
          if (m.menu.hidden) return;
          if (m.menu.contains(e.target) || m.menuBtn.contains(e.target)) return;
          close();
        });
      } catch (e) { /* DOM 없음 */ }
      m.render = render;
      m.close = close;
    }
    return m;
  },
};

if (typeof window !== 'undefined') {
  window.PlannerCapture = PlannerCapture;
  window.plannerCaptureFrame = plannerCaptureFrame;
  window.plannerCapturePath = plannerCapturePath;
  window.plannerCaptureDetailHash = plannerCaptureDetailHash;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_CAPTURE_BUCKET,
    PLANNER_CAPTURE_KINDS,
    PLANNER_CAPTURE_KIND_LABEL,
    PLANNER_CAPTURE_LONG_EDGE,
    PLANNER_CAPTURE_LONG_EDGE_HI,
    PLANNER_CAPTURE_MARGIN,
    PLANNER_CAPTURE_FOV,
    plannerCaptureParseKind,
    plannerCaptureStamp,
    plannerCaptureSafeId,
    plannerCaptureFileName,
    plannerCapturePath,
    plannerCaptureStableJson,
    plannerCaptureSha256,
    plannerCaptureDetailHash,
    plannerCaptureSizeFor,
    plannerCaptureAspectFor,
    plannerCaptureFrame,
    plannerCaptureCameraJson,
    plannerCaptureBoundsOf,
    plannerCaptureModuleObject,
    plannerCaptureFlipRows,
    plannerCaptureApplySrgb,
    PlannerCapture,
  };
}
