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
//   massing 실내 3/4 — 눈높이 1500mm, 경계 중심을 향해 앞(+Z)에서 오른쪽으로 30° 비껴, 가로 화각 40°, 16:9.
//          옆면과 상판 앞코가 보이는 사람 눈 시점. 거리는 경계 여덟 꼭짓점이 여백 8% 안에 들어오는 가장 가까운 값.
//   경계는 mesh 만 센다 — 배치 공간 상자(area)·선택 테두리(pick)·원점 마커(선)는 뺀다.
//
// 2026-10-08: clean 캡처 (docs/01-plan/planner-render-realize.plan.md §5 · §9 P1).
//   capture({ kind, longEdge, clean: true }) — 이미지 모델에 줄 "참고 그림" 용. **찍는 순간에만**
//   ① 흰 배경 — 배경을 비우고 알파 0 으로 지운 뒤, 읽은 픽셀을 흰색 위에 얹는다 (plannerCaptureOverWhite).
//      흰색을 배경색으로 넣으면 OutputPass 의 ACES 가 회색(#e7e7e7 근처)으로 눌러 버린다.
//   ② 숨김 — 씬 바로 아래의 조명·moduleGroup 이 아닌 것(그리드·바닥 판), moduleGroup 바로 아래의 모듈이 아닌 것
//      (배치 상자·그 윤곽선·선택 테두리·원점 마커). plannerCaptureCleanTargets 가 고른다.
//   ③ 가전 대역 — 반투명 마커(entityKind 'marker') 대신 불투명 단순 형태 (plannerCaptureStandInSpec).
//      마커가 있는 가전만 만든다. 지금 마커 섹션은 sink·hood 둘뿐 (PLANNER_MARKER_SECTIONS).
//   ④ 그림자 — castShadow 방향광의 그림자 카메라를 경계(mm)에 맞추고 (plannerCaptureShadowFrustum),
//      바닥에 그림자만 받는 판(ShadowMaterial)을 깐다. 평소 화면에는 켜지 않는다 (계획서 §11-⑥).
//   전부 finally 에서 되돌린다 — 캡처 뒤 작업 화면(배경·그리드·마커·그림자·재질)은 그대로다. 예외가 나도.
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
const PLANNER_CAPTURE_KIND_LABEL = { front: '정면', iso: '3/4', plan: '평면', module: '모듈', massing: '실내 3/4' };
const PLANNER_CAPTURE_LONG_EDGE = 2048;
const PLANNER_CAPTURE_LONG_EDGE_HI = 4096;
/** 경계 둘레 여백 (8%) */
const PLANNER_CAPTURE_MARGIN = 1.08;
/**
 * 2026-10-08: massing 프리셋 — 실내 눈높이 3/4 (계획서 §5).
 *   eyeY  눈높이 (mm, 바닥 y=0 기준)   yawDeg  앞(+Z)에서 오른쪽(+X)으로 비끼는 각
 *   hfov  가로 화각 (°)               aspect  16:9 고정 — 방 사진(16:9)과 같은 틀
 */
const PLANNER_CAPTURE_MASSING = { eyeY: 1500, yawDeg: 30, hfov: 40, aspect: 16 / 9 };
/** 가로 화각 → three 가 받는 세로 화각 (°) */
function plannerCaptureVfov(hfovDeg, aspect) {
  const h = (hfovDeg / 2) * Math.PI / 180;
  return 2 * Math.atan(Math.tan(h) / aspect) * 180 / Math.PI;
}
/** 프리셋별 **세로** 화각 (three PerspectiveCamera.fov). massing 은 가로 40° 에서 나온 값 (약 23.1°). */
const PLANNER_CAPTURE_FOV = {
  front: 12, plan: 12, iso: 45, module: 45,
  massing: plannerCaptureVfov(PLANNER_CAPTURE_MASSING.hfov, PLANNER_CAPTURE_MASSING.aspect),
};
/** 경계 계산에서 빼는 entityKind — 부재가 아니다 */
const PLANNER_CAPTURE_BOUNDS_SKIP = { area: true, pick: true };
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

/** 프리셋별 종횡비 — front 는 경계 W/H, plan 은 W/D, massing 은 16:9 고정, iso·module 은 화면 캔버스(없으면 3:2). */
function plannerCaptureAspectFor(kind, bounds, canvasAspect) {
  const k = plannerCaptureParseKind(kind).kind;
  if (k === 'massing') return PLANNER_CAPTURE_MASSING.aspect;
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
  // massing 은 화각이 16:9 에서 나온 값이라 종횡비도 16:9 로 묶는다
  const a = k === 'massing' ? PLANNER_CAPTURE_MASSING.aspect : plannerCaptureClampAspect(aspect);
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
  } else if (k === 'massing') {
    // 실내 3/4 — 눈높이 고정, 경계 중심을 향해 30° 비껴 선다. 거리는 꼭짓점이 다 들어오는 가장 가까운 값.
    const P = PLANNER_CAPTURE_MASSING;
    const yaw = P.yawDeg * Math.PI / 180;
    const dir = [Math.sin(yaw), Math.cos(yaw)];   // 수평 (x, z)
    up = [0, 1, 0];
    const at = (d) => [c.x + dir[0] * d, P.eyeY, c.z + dir[1] * d];
    const corners = plannerCaptureCorners(bounds);
    const target = [c.x, c.y, c.z];
    const fits = (d) => plannerCaptureFits(at(d), target, up, fov, a, corners, M, 10);
    let lo = 0, hi = Math.max(W, H, D, 1000);
    for (let i = 0; i < 40 && !fits(hi); i++) hi *= 2;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid; else lo = mid;
    }
    dist = hi;   // 수평 거리 (경계 중심 → 카메라)
    position = at(dist);
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

/** 경계의 여덟 꼭짓점 [[x,y,z], …] */
function plannerCaptureCorners(bounds) {
  const out = [];
  [bounds.min.x, bounds.max.x].forEach((x) => [bounds.min.y, bounds.max.y].forEach((y) => [bounds.min.z, bounds.max.z].forEach((z) => out.push([x, y, z]))));
  return out;
}

/**
 * eye → target 을 보는 카메라의 축 (x 오른쪽, y 위, z 뒤 = eye − target). three Matrix4.lookAt 과 같은 규칙 —
 * 위 벡터와 나란하면 z 를 조금 틀어 축을 만든다. 그림자 카메라도 이 규칙으로 선다 (LightShadow.updateMatrices).
 */
function plannerCaptureLookBasis(eye, target, up) {
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const len2 = (p) => p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  const norm = (p) => { const l = Math.sqrt(len2(p)) || 1; return [p[0] / l, p[1] / l, p[2] / l]; };
  let z = sub(eye, target);
  if (len2(z) === 0) z = [0, 0, 1];
  z = norm(z);
  let x = cross(up, z);
  if (len2(x) === 0) {
    if (Math.abs(up[2]) === 1) z[0] += 0.0001; else z[2] += 0.0001;
    z = norm(z);
    x = cross(up, z);
  }
  x = norm(x);
  const y = cross(z, x);
  return { x, y, z };
}

/**
 * 원근 카메라에 점들이 다 들어오는가 — 화면 가장자리에서 여백(margin) 안쪽으로. 순수.
 * @param {number[]} eye @param {number[]} target @param {number[]} up
 * @param {number} vfovDeg 세로 화각 @param {number} aspect 가로/세로
 * @param {number[][]} points @param {number} margin 1.08 이면 화면의 1/1.08 안 @param {number} near
 */
function plannerCaptureFits(eye, target, up, vfovDeg, aspect, points, margin, near) {
  const B = plannerCaptureLookBasis(eye, target, up);
  const tv = Math.tan((vfovDeg / 2) * Math.PI / 180);
  const th = tv * aspect;
  const lim = 1 / (margin || 1);
  for (let i = 0; i < points.length; i++) {
    const v = [points[i][0] - eye[0], points[i][1] - eye[1], points[i][2] - eye[2]];
    const depth = -(v[0] * B.z[0] + v[1] * B.z[1] + v[2] * B.z[2]);
    if (!(depth > (near || 0))) return false;
    const vx = v[0] * B.x[0] + v[1] * B.x[1] + v[2] * B.x[2];
    const vy = v[0] * B.y[0] + v[1] * B.y[1] + v[2] * B.y[2];
    if (Math.abs(vx / (depth * th)) > lim || Math.abs(vy / (depth * tv)) > lim) return false;
  }
  return true;
}

/**
 * 방향광 그림자 카메라(직교)를 경계에 맞춘다. 순수 — docs/02-design/features/shadow-frustum.md 의 수정 방향.
 * 기본 프러스텀(±5 · near 0.5 · far 500)은 mm 씬에서 10mm 상자라 그림자가 한 픽셀도 안 그려진다.
 * 그림자 카메라는 조명 자리에서 타깃을 본다. 꼭짓점을 그 축에 투영해 좌우·상하·깊이를 잰다.
 * 바닥(floorY)에 떨어지는 그림자도 받도록, 꼭짓점을 빛 방향으로 바닥까지 민 점도 깊이에 넣는다.
 * @param {number[]} lightPos 조명 세계 좌표 @param {number[]} targetPos 조명 타깃 세계 좌표
 * @param {{min,max}} bounds @param {number} [pad=50] mm @param {number} [floorY=0]
 * @returns {{left,right,top,bottom,near,far}|null}
 */
function plannerCaptureShadowFrustum(lightPos, targetPos, bounds, pad, floorY) {
  if (!bounds || !bounds.min || !bounds.max || !lightPos || !targetPos) return null;
  const P = pad == null ? 50 : pad;
  const fy = floorY == null ? 0 : floorY;
  const B = plannerCaptureLookBasis(lightPos, targetPos, [0, 1, 0]);
  const pts = plannerCaptureCorners(bounds);
  // 빛이 가는 방향 = −z. 아래로 가면 꼭짓점을 바닥까지 민다.
  const d = [-B.z[0], -B.z[1], -B.z[2]];
  if (d[1] < -1e-9) {
    plannerCaptureCorners(bounds).forEach((p) => {
      const t = (fy - p[1]) / d[1];
      if (t > 0) pts.push([p[0] + d[0] * t, fy, p[2] + d[2] * t]);
    });
  }
  let l = Infinity, r = -Infinity, b = Infinity, tp = -Infinity, n = Infinity, f = -Infinity;
  pts.forEach((p) => {
    const v = [p[0] - lightPos[0], p[1] - lightPos[1], p[2] - lightPos[2]];
    const x = v[0] * B.x[0] + v[1] * B.x[1] + v[2] * B.x[2];
    const y = v[0] * B.y[0] + v[1] * B.y[1] + v[2] * B.y[2];
    const depth = -(v[0] * B.z[0] + v[1] * B.z[1] + v[2] * B.z[2]);
    l = Math.min(l, x); r = Math.max(r, x); b = Math.min(b, y); tp = Math.max(tp, y);
    n = Math.min(n, depth); f = Math.max(f, depth);
  });
  return {
    left: l - P, right: r + P, bottom: b - P, top: tp + P,
    near: Math.max(1, n - P), far: Math.max(2, f + P),
  };
}

/**
 * clean 캡처에서 숨길 것과 가전 대역으로 바꿀 마커를 고른다. 순수 — 읽기만 한다.
 *   씬 바로 아래: 조명·카메라·moduleGroup 이 아닌 보이는 것 → 숨김 (그리드·바닥 판)
 *   moduleGroup 바로 아래: entityKind 'module' 이 아닌 보이는 것 → 숨김
 *     (배치 상자 area · 그 윤곽선 edge · 배치 선택 테두리 · 모듈 선택 테두리 pick · 원점 마커 선)
 *   모듈 그룹 안에 entityKind 'marker' 가 있으면 가전 자리 표시 — 그 그룹의 보이는 자식을 다 숨기고 markers 에 넣는다.
 *   나머지(모듈 그룹 안의 부재·부재 테두리)는 가구라 그대로 둔다.
 * @returns {{hide:object[], markers:{group:object, marker:object, section:string|null, moduleId:string|null}[]}}
 */
function plannerCaptureCleanTargets(scene, moduleGroup) {
  const hide = [];
  const markers = [];
  const kids = (o) => (o && Array.isArray(o.children) ? o.children : []);
  kids(scene).forEach((ch) => {
    if (!ch || ch === moduleGroup || ch.isLight || ch.isCamera) return;
    if (ch.visible !== false) hide.push(ch);
  });
  kids(moduleGroup).forEach((ch) => {
    if (!ch) return;
    const ud = ch.userData || {};
    if (ud.entityKind === 'module') {
      const marker = kids(ch).find((c) => c && c.userData && c.userData.entityKind === 'marker');
      if (!marker) return;
      kids(ch).forEach((c) => { if (c && c.visible !== false) hide.push(c); });
      markers.push({ group: ch, marker, section: marker.userData.section || null, moduleId: ud.moduleId != null ? ud.moduleId : null });
      return;
    }
    if (ch.visible !== false) hide.push(ch);
  });
  return { hide, markers };
}

/** 대역이 상판 높이를 못 찾을 때 — 하부장 기본 높이 (PLANNER_SECTIONS.lower.moduleH) */
const PLANNER_CAPTURE_COUNTER_TOP = 870;
/** 상판을 찾을 때 이보다 높이 올라가는 부재는 하부가 아니다 (상부장·키큰장) */
const PLANNER_CAPTURE_LOWER_MAX_Y = 1200;
/** 가전 대역 색 — 불투명, 무채색. 모델이 "가전 자리" 로 읽되 가구 마감과 헷갈리지 않게. */
const PLANNER_CAPTURE_STANDIN_COLOR = {
  bowl: 0x2e3134, faucet: 0xa3a9ae, cooktop: 0x141516, hood: 0x9aa0a6, refrigerator: 0xd8dcdf, dishwasher: 0x8e959b,
};

/**
 * 가전 대역의 상자 목록. 순수. 좌표는 **마커 그룹의 로컬** — 원점이 마커 바닥 가운데, +Z 앞, mm.
 *   sink         상판 위 어두운 사각 볼(얇은 판) + 뒤쪽 수전 기둥 + 앞으로 나온 토수구
 *   hood         마커 자리 그대로 회색 상자 (천장 아래)
 *   refrigerator 마커 자리 그대로 연회색 몸체
 *   dishwasher   마커 자리 그대로 회색 몸체 (앞면이 회색 판으로 읽힌다)
 *   cooktop      상판 위 검은 얇은 판 — 지금은 쿡탑 섹션이 없어 만들어지지 않는다 (마커가 있는 가전만 만든다)
 * @param {string} section
 * @param {{W:number, H:number, D:number, baseY?:number}} dims 마커 상자 크기 · 마커 그룹의 세계 y
 * @param {{top:number, zMin:number, zMax:number}|null} support 밑에 받친 하부 부재의 윗면·앞뒤 (로컬). 없으면 870 · 마커 깊이
 * @returns {{part:string, size:number[], pos:number[], color:number, metalness:number, roughness:number}[]}
 */
function plannerCaptureStandInSpec(section, dims, support) {
  if (!dims) return [];
  const W = Math.max(1, Number(dims.W) || 0), H = Math.max(1, Number(dims.H) || 0), D = Math.max(1, Number(dims.D) || 0);
  const C = PLANNER_CAPTURE_STANDIN_COLOR;
  const box = (part, size, pos, color, metalness, roughness) => ({ part, size, pos, color, metalness: metalness || 0, roughness: roughness == null ? 0.6 : roughness });
  const top = support && Number.isFinite(support.top) ? support.top : PLANNER_CAPTURE_COUNTER_TOP - (Number(dims.baseY) || 0);
  const zMin = support && Number.isFinite(support.zMin) ? support.zMin : -D / 2;
  const zMax = support && Number.isFinite(support.zMax) ? support.zMax : D / 2;
  const depth = Math.max(1, zMax - zMin);
  const zc = (zMin + zMax) / 2;
  if (section === 'sink') {
    const bw = Math.max(300, W - 80);
    const bd = Math.min(480, Math.max(300, depth * 0.7));
    const postZ = Math.max(zMin + 30, zc - bd / 2 - 45);
    return [
      box('bowl', [bw, 6, bd], [0, top + 3, zc], C.bowl, 0, 0.5),
      box('faucet', [36, 300, 36], [0, top + 150, postZ], C.faucet, 0.3, 0.35),
      box('spout', [32, 32, 210], [0, top + 300 - 16, postZ + 105], C.faucet, 0.3, 0.35),
    ];
  }
  if (section === 'cooktop') {
    return [box('cooktop', [Math.min(600, Math.max(300, W - 40)), 8, Math.min(520, Math.max(300, depth * 0.8))], [0, top + 4, zc], C.cooktop, 0, 0.3)];
  }
  if (section === 'hood') return [box('hood', [W, H, D], [0, H / 2, 0], C.hood, 0.2, 0.45)];
  if (section === 'refrigerator') return [box('refrigerator', [W, H, D], [0, H / 2, 0], C.refrigerator, 0, 0.5)];
  if (section === 'dishwasher') return [box('dishwasher', [W, H, D], [0, H / 2, 0], C.dishwasher, 0.1, 0.5)];
  return [];
}

/**
 * clean 캡처 — 알파 0 으로 지운 배경을 흰색으로. rgb 는 덮인 만큼(알파) 이미 곱해져 있다(검정 위에 그렸다)
 * 고 보고 rgb + (1 − a)·255. 끝나면 알파 255. 바닥 그림자(검정 · 알파 0.2)는 옅은 회색이 된다.
 * @param {Uint8ClampedArray} px RGBA
 */
function plannerCaptureOverWhite(px) {
  for (let i = 0; i < px.length; i += 4) {
    const k = 255 - px[i + 3];
    if (k) { px[i] += k; px[i + 1] += k; px[i + 2] += k; px[i + 3] = 255; }
  }
  return px;
}

/** design_renders.camera 에 넣을 모양 — 좌표는 정수 mm 로 줄인다. clean 이면 clean:true 를 남긴다. */
function plannerCaptureCameraJson(frame, longEdge, moduleId, clean) {
  if (!frame) return null;
  const r = (v) => Math.round(v);
  const out = {
    kind: frame.kind,
    fov: Math.round(frame.fov * 100) / 100,
    aspect: Math.round(frame.aspect * 1000) / 1000,
    position: frame.position.map(r),
    target: frame.target.map(r),
    up: frame.up,
    longEdge: longEdge,
  };
  if (moduleId != null) out.moduleId = String(moduleId);
  if (clean) out.clean = true;
  return out;
}

/**
 * mesh 만 모아 세계 좌표 경계를 잰다. area·pick 은 뺀다 (부재가 아니다). 선(LineSegments)도 뺀다 — 원점 마커.
 * @param {object} root three Object3D (moduleGroup 또는 모듈 그룹)
 * @param {object} T three 네임스페이스
 * @param {{visibleOnly?:boolean}} [opt] visibleOnly: 숨긴 것(과 그 아래)은 세지 않는다 — clean 캡처가 쓴다
 * @returns {{min:{x,y,z}, max:{x,y,z}}|null} mesh 가 없으면 null
 */
function plannerCaptureBoundsOf(root, T, opt) {
  if (!root || !T || typeof root.traverse !== 'function') return null;
  try { root.updateWorldMatrix(true, true); } catch (e) { /* 순수 객체면 없다 */ }
  const box = new T.Box3();
  const tmp = new T.Box3();
  let any = false;
  const walk = (opt && opt.visibleOnly && typeof root.traverseVisible === 'function') ? 'traverseVisible' : 'traverse';
  root[walk]((obj) => {
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
 * keepAlpha 면 알파를 그대로 둔다 — clean 캡처가 plannerCaptureOverWhite 로 흰색에 얹는다.
 * @param {Uint8Array|Uint8ClampedArray} src RGBA, 아래→위
 * @returns {Uint8ClampedArray} RGBA, 위→아래
 */
function plannerCaptureFlipRows(src, width, height, keepAlpha) {
  const out = new Uint8ClampedArray(width * height * 4);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * row;
    out.set(src.subarray(from, from + row), y * row);
  }
  if (!keepAlpha) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

/**
 * 마커 밑에 받친 하부 부재의 윗면·앞뒤를 **마커 그룹 로컬**로 잰다 — 싱크 볼이 앉을 상판.
 * 마커와 가로(로컬 x)가 겹치고 세계 높이 PLANNER_CAPTURE_LOWER_MAX_Y 아래에서 끝나는 부재 mesh 만 센다
 * (상부장·키큰장은 빠진다). 마커 모듈끼리는 서로 받치지 않는다. 없으면 null.
 */
function plannerCaptureSupportOf(markerGroup, markerW, moduleGroup, T) {
  if (!markerGroup || !moduleGroup || !T || !T.Matrix4 || !T.Box3) return null;
  try { moduleGroup.updateWorldMatrix(true, true); } catch (e) { /* 순수 객체면 없다 */ }
  const inv = new T.Matrix4().copy(markerGroup.matrixWorld).invert();
  const wb = new T.Box3(), lb = new T.Box3();
  const half = Math.max(1, Number(markerW) || 0) / 2;
  let top = -Infinity, zMin = Infinity, zMax = -Infinity;
  (moduleGroup.children || []).forEach((mod) => {
    if (!mod || mod === markerGroup || !mod.userData || mod.userData.entityKind !== 'module') return;
    if ((mod.children || []).some((c) => c && c.userData && c.userData.entityKind === 'marker')) return;
    mod.traverse((o) => {
      if (!o || !o.isMesh || !o.geometry) return;
      const ud = o.userData || {};
      if (ud.entityKind && (PLANNER_CAPTURE_BOUNDS_SKIP[ud.entityKind] || ud.entityKind === 'standin')) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (!o.geometry.boundingBox) return;
      wb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (wb.isEmpty() || wb.max.y > PLANNER_CAPTURE_LOWER_MAX_Y) return;
      lb.copy(wb).applyMatrix4(inv);
      if (lb.max.x <= -half || lb.min.x >= half) return;
      top = Math.max(top, lb.max.y);
      zMin = Math.min(zMin, lb.min.z);
      zMax = Math.max(zMax, lb.max.z);
    });
  });
  return Number.isFinite(top) ? { top, zMin, zMax } : null;
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

  // ── clean 캡처 (2026-10-08, 계획서 §5) ──────────────────
  // 세 단계로 나눈다: begin(숨김·가전 대역·배경) → 경계 → shadows(경계로 그림자 맞춤·바닥 그림자 받이) → … → end.
  // 상태 주머니(st)를 먼저 만들고 바꿀 때마다 거기 적는다 — 중간에 던져도 end 가 바꾼 만큼만 되돌린다.

  _cleanState() {
    return { hidden: [], added: [], bg: null, clear: null, lights: [], shadowMap: null };
  },

  /** 숨김 · 가전 대역 · 흰 배경(알파 0 으로 지우기). 바꾼 것은 전부 st 에 적는다. */
  _cleanBegin(t, T, st) {
    const sel = plannerCaptureCleanTargets(t.scene, t.moduleGroup);
    sel.hide.forEach((o) => { st.hidden.push(o); o.visible = false; });
    sel.markers.forEach((mk) => {
      // buildMarkerMesh 는 마커 상자를 그룹 로컬 (0, H/2, 0) 에 W×H×D 로 둔다
      const geo = mk.marker.geometry;
      const p = (geo && geo.parameters) || {};
      let W = p.width, H = p.height, D = p.depth;
      if (!(W > 0 && H > 0 && D > 0) && geo) {
        if (!geo.boundingBox && typeof geo.computeBoundingBox === 'function') geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (bb) { W = bb.max.x - bb.min.x; H = bb.max.y - bb.min.y; D = bb.max.z - bb.min.z; }
      }
      if (!(W > 0 && H > 0 && D > 0)) return;
      try { mk.group.updateWorldMatrix(true, false); } catch (e) { /* 무해 */ }
      const baseY = mk.group.matrixWorld ? mk.group.matrixWorld.elements[13] : 0;
      const needsTop = mk.section === 'sink' || mk.section === 'cooktop';
      const support = needsTop ? plannerCaptureSupportOf(mk.group, W, t.moduleGroup, T) : null;
      const spec = plannerCaptureStandInSpec(mk.section, { W, H, D, baseY }, support);
      if (!spec.length) return;
      const g = new T.Group();
      g.userData = { entityKind: 'standin', section: mk.section, moduleId: mk.moduleId };
      spec.forEach((s) => {
        const mat = new T.MeshStandardMaterial({ color: s.color, metalness: s.metalness, roughness: s.roughness });
        const mesh = new T.Mesh(new T.BoxGeometry(s.size[0], s.size[1], s.size[2]), mat);
        mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { entityKind: 'standin', part: s.part, moduleId: mk.moduleId };
        g.add(mesh);
      });
      mk.group.add(g);
      st.added.push(g);
    });
    // 배경 — 비우고 알파 0 으로 지운다. 흰색은 픽셀을 읽은 뒤 plannerCaptureOverWhite 가 얹는다.
    st.bg = { value: t.scene.background };
    t.scene.background = null;
    const r = t.renderer;
    if (r && typeof r.getClearColor === 'function' && typeof r.setClearColor === 'function' && T.Color) {
      st.clear = { color: r.getClearColor(new T.Color()), alpha: typeof r.getClearAlpha === 'function' ? r.getClearAlpha() : 1 };
      r.setClearColor(0x000000, 0);
    }
  },

  /**
   * 그림자 — castShadow 방향광의 그림자 카메라를 경계에 맞추고, 바닥(y=0)에 그림자만 받는 판을 깐다.
   * 바닥 판은 숨겼으니 이것이 없으면 가구가 바닥에 떨어뜨리는 그림자가 갈 곳이 없다.
   */
  _cleanShadows(t, T, bounds, st) {
    const r = t.renderer;
    if (r && r.shadowMap) {
      st.shadowMap = { enabled: r.shadowMap.enabled, needsUpdate: r.shadowMap.needsUpdate };
      r.shadowMap.enabled = true;
      r.shadowMap.needsUpdate = true;
    }
    const floorY = Math.min(0, bounds.min.y);
    (t.scene.children || []).forEach((L) => {
      if (!L || !L.isDirectionalLight || !L.castShadow || !L.shadow || !L.shadow.camera) return;
      try { L.updateWorldMatrix(true, false); } catch (e) { /* 무해 */ }
      const le = L.matrixWorld.elements;
      const te = (L.target && L.target.matrixWorld) ? L.target.matrixWorld.elements : null;
      const fr = plannerCaptureShadowFrustum([le[12], le[13], le[14]], te ? [te[12], te[13], te[14]] : [0, 0, 0], bounds, 50, floorY);
      if (!fr) return;
      const cam = L.shadow.camera;
      st.lights.push({
        light: L,
        cam: { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom, near: cam.near, far: cam.far },
        bias: L.shadow.bias,
        normalBias: L.shadow.normalBias,
      });
      Object.assign(cam, fr);
      cam.updateProjectionMatrix();
      // 깊이 지도 한 칸 크기만큼 법선 쪽으로 민다 — 그림자 여드름(acne) 막기. mm 단위.
      const mapW = (L.shadow.mapSize && L.shadow.mapSize.x) || 1024;
      L.shadow.bias = -0.0005;
      L.shadow.normalBias = Math.max(fr.right - fr.left, fr.top - fr.bottom) / mapW;
      L.shadow.needsUpdate = true;
    });
    if (st.lights.length && T.ShadowMaterial && T.PlaneGeometry) {
      const W = (bounds.max.x - bounds.min.x) + 4000, D = (bounds.max.z - bounds.min.z) + 4000;
      const plane = new T.Mesh(new T.PlaneGeometry(W, D), new T.ShadowMaterial({ opacity: 0.22 }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.set((bounds.min.x + bounds.max.x) / 2, floorY, (bounds.min.z + bounds.max.z) / 2);
      plane.receiveShadow = true;
      plane.userData = { entityKind: 'standin', part: 'shadow-catcher' };
      t.scene.add(plane);
      st.added.push(plane);
    }
  },

  /** begin·shadows 가 바꾼 것을 거꾸로 되돌린다. 단계마다 따로 try — 하나가 던져도 나머지는 돌아간다. */
  _cleanEnd(t, st) {
    if (!st) return;
    st.added.splice(0).reverse().forEach((o) => {
      try { if (o.parent) o.parent.remove(o); } catch (e) { /* 무해 */ }
      try {
        o.traverse((x) => {
          if (x.geometry && typeof x.geometry.dispose === 'function') x.geometry.dispose();
          if (x.material && typeof x.material.dispose === 'function') x.material.dispose();
        });
      } catch (e) { /* 무해 */ }
    });
    st.hidden.splice(0).forEach((o) => { try { o.visible = true; } catch (e) { /* 무해 */ } });
    if (st.bg) { try { t.scene.background = st.bg.value; } catch (e) { /* 무해 */ } st.bg = null; }
    if (st.clear) { try { t.renderer.setClearColor(st.clear.color, st.clear.alpha); } catch (e) { /* 무해 */ } st.clear = null; }
    st.lights.splice(0).forEach((s) => {
      try {
        Object.assign(s.light.shadow.camera, s.cam);
        s.light.shadow.camera.updateProjectionMatrix();
        s.light.shadow.bias = s.bias;
        s.light.shadow.normalBias = s.normalBias;
        s.light.shadow.needsUpdate = true;
      } catch (e) { /* 무해 */ }
    });
    if (st.shadowMap) {
      try { t.renderer.shadowMap.enabled = st.shadowMap.enabled; t.renderer.shadowMap.needsUpdate = st.shadowMap.needsUpdate; } catch (e) { /* 무해 */ }
      st.shadowMap = null;
    }
  },

  /**
   * 한 장을 픽셀까지 **동기로** 찍는다. 렌더타깃·카메라는 여기서 만들고 여기서 놓는다.
   * 룩(pushLook/popLook)도 이 안에서 켜고 끈다 — 돌아올 때 씬·renderer 는 들어올 때 값이다.
   * clean 이면 흰 배경·작업용 표시 숨김·가전 대역·그림자로 찍고, finally 에서 전부 되돌린다 (머리 주석).
   * @param {{kind:string, moduleId?:string, longEdge?:number, clean?:boolean}} opt
   * @returns {{ok:true, kind, moduleId, width, height, camera, frame, pixels:Uint8ClampedArray, toneMapped:boolean, clean:boolean}
   *         | {ok:false, reason:string, message:string}}
   */
  capturePixels(opt) {
    opt = opt || {};
    const t = this.three();
    const T = this.T();
    if (!t || !t.renderer || !t.scene || !T) return { ok: false, reason: 'no-three', message: '3D 가 아직 준비되지 않았습니다' };
    const k = plannerCaptureParseKind(opt.kind, opt.moduleId);
    const r = t.renderer;
    const clean = !!opt.clean;
    let longEdge = Number(opt.longEdge) || PLANNER_CAPTURE_LONG_EDGE;
    const cap = r.capabilities && r.capabilities.maxTextureSize;
    if (cap && longEdge > cap) longEdge = cap;

    const PD = (typeof PlannerDetail !== 'undefined' && PlannerDetail && typeof PlannerDetail.pushLook === 'function') ? PlannerDetail : null;
    const look = PD ? PD.pushLook() : null;
    const prevRT = (typeof r.getRenderTarget === 'function') ? r.getRenderTarget() : null;
    let rtA = null, rtB = null;
    const cleanSt = clean ? this._cleanState() : null;
    try {
      if (clean) this._cleanBegin(t, T, cleanSt);
      // 경계 — 룩을 켠 뒤에 잰다 (mesh 는 그대로지만 순서를 한 곳에 둔다). clean 이면 숨긴 것은 빼고 대역은 센다.
      const root = k.kind === 'module' ? plannerCaptureModuleObject(t.moduleGroup, k.moduleId) : t.moduleGroup;
      const bounds = plannerCaptureBoundsOf(root, T, clean ? { visibleOnly: true } : null);
      if (!bounds) {
        return { ok: false, reason: 'empty', message: k.kind === 'module' ? '그 모듈이 3D 에 없습니다' : '3D 에 찍을 모듈이 없습니다' };
      }
      if (clean) this._cleanShadows(t, T, bounds, cleanSt);
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
      const pixels = plannerCaptureFlipRows(raw, width, height, clean);
      if (!out) plannerCaptureApplySrgb(pixels);   // 폴백: 톤매핑 없이 sRGB 곡선만
      if (clean) plannerCaptureOverWhite(pixels);  // 알파 0 배경 → 흰색
      return {
        ok: true,
        kind: k.kind,
        moduleId: k.moduleId,
        width,
        height,
        frame,
        camera: plannerCaptureCameraJson(frame, longEdge, k.moduleId, clean),
        pixels,
        toneMapped: !!out,
        clean,
      };
    } catch (e) {
      return { ok: false, reason: 'error', message: (e && e.message) || String(e) };
    } finally {
      try { r.setRenderTarget(prevRT); } catch (e) { /* 무해 */ }
      if (rtA) { try { rtA.dispose(); } catch (e) { /* 무해 */ } }
      if (rtB) { try { rtB.dispose(); } catch (e) { /* 무해 */ } }
      if (cleanSt) this._cleanEnd(t, cleanSt);   // 룩보다 먼저 — 들어온 순서의 거꾸로
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
   * 한 장 — 찍고 PNG 로. { ok, kind, moduleId, width, height, camera, blob, fileName, toneMapped, clean } | { ok:false, reason, message }
   * @param {{kind:string, moduleId?:string, longEdge?:number, clean?:boolean, date?:Date}} opt
   *   clean: 이미지 모델 참고 그림용 — 흰 배경·작업용 표시 숨김·가전 대역·그림자 (2026-10-08, 계획서 §5)
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
      clean: shot.clean,
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
    PLANNER_CAPTURE_MASSING,
    PLANNER_CAPTURE_COUNTER_TOP,
    PLANNER_CAPTURE_STANDIN_COLOR,
    plannerCaptureVfov,
    plannerCaptureCorners,
    plannerCaptureLookBasis,
    plannerCaptureFits,
    plannerCaptureShadowFrustum,
    plannerCaptureCleanTargets,
    plannerCaptureStandInSpec,
    plannerCaptureSupportOf,
    plannerCaptureOverWhite,
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
