// ============================================================
// P1: 방 사진 배경 — photo-bg.js (사진 들이기 · 대략 사각형 상태 · 화각 자동 맞춤)
//
// P0(`photo-solve.js`)이 "네 점 → 카메라" 를 풀었다. 이 파일은 그 네 점이 **어디서 오는지**,
// 사진이 **어떤 모양으로 들어오는지**, 그리고 사용자가 찍은 사각형이 **쓸 만한지**를 맡는다.
// 화면(사진 레이어·사각형 편집기·우측 패널)은 `photo-mode.js` 가 맡는다 — 여기는 상태와 계산이다.
//
// ── 2026-09-17 결정이 이 파일의 모양을 정한다 ────────────────
//
//   바닥 사각형은 **대략적인 위치**만 표시한다. 가구의 치수는 언제나 플래너의 배치 공간에서 온다
//   (계획 §9-2). 사용자에게 "정확히 찍으세요" 라고 요구하지 않는다 — 대신 합성 결과를 **즉시 보여 주고**
//   눈으로 맞을 때까지 밀게 한다.
//
//   그래서 이 파일이 지는 책임은 셋이다:
//     ① 처음부터 그럴듯한 사각형을 깔아 준다      `plannerPhotoBgQuadDefault`
//     ② 실제 치수를 배치 공간에서 자동으로 가져온다  `plannerPhotoBgRectFromArea`
//     ③ 틀렸을 때 **무엇이 틀렸는지 사람 말로** 알려 준다 `plannerPhotoBgQuadHealth`
//
// ── 왜 "미세조정" 을 카메라가 아니라 **사각형** 에 적용하는가 ──
//
//   사용자가 "가구를 조금 오른쪽으로" 라고 할 때 실제로 바꾸는 것은 `plannerPhotoBgSolveRect` 가
//   내주는 사각형의 원점이다. 사각형을 세계에서 (−dx, −dz) 옮겨 풀면 카메라가 그만큼 옮겨 풀리고,
//   세계에 고정된 가구는 사진 위에서 정확히 (+dx, +dz) 만큼 움직여 보인다. 씬(모듈 mesh)을 한 톨도
//   건드리지 않으므로 BOM·도면·골든 페이로드와 어긋날 수가 없다 (I1).
//
// ── 재투영 오차가 왜 "맞았다" 의 잣대인가 ────────────────────
//
//   P0 이 측정했다 (docs/02-design/features/photo-solve.md): **틀린 화각은 재투영 오차로 드러난다.**
//   그래서 화각은 슬라이더로 더듬지 않아도 된다 — 오차가 가장 작은 화각을 훑어 고르면 그만이다
//   (`plannerPhotoBgFitFov`). 정면 사진(method:'assumed')에서는 항상 이 길로 간다.
//
// ⚠ 재투영 오차로 **못 잡는 것이 하나** 있다 — 시작 귀퉁이가 180° 어긋난 경우.
//   직사각형은 180° 회전에 대해 자기 자신이라 대각선 반대에서 시작하면 재투영 오차가 정확히 0 인,
//   **방 반대편에서 본 카메라**가 나온다 (photo-solve.md "이 수학이 못 하는 것" 4번). 숫자로는 못 막는다.
//   그래서 두 가지를 같이 한다:
//     · UI 는 귀퉁이에 이름표를 붙인다 (앞-좌·앞-우·뒤-우·뒤-좌 — photo-mode.js)
//     · 여기서 **물리 검사**를 한다 — 바닥 아래 카메라 · 30m 밖 · 사각형 뒤 · 말도 안 되는 눈높이
//   둘 다 있어야 한다. 하나만으로는 조용히 틀린 합성을 내보낸다.
//
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 plannerPhotoBg / PLANNER_PHOTO_BG_ / PlannerPhotoBg 접두.
//   photo-solve.js 는 plannerPhoto* 를 쓰므로 이름이 겹치지 않는다 (planner-assets.test.js 가 지킨다).
//   저장은 localStorage(스코프 키)까지다 — Storage·DB 는 P3 (계획 §5).
// ============================================================

/** 저장 키 base. scopedKey(planner-scope.js) 로 스코프를 붙인다. */
const PLANNER_PHOTO_BG_KEY_BASE = 'dadam_photo_bg_v1';
/** 긴 변 상한 (px). 계획 §4.3 — 합성 캔버스도 같은 크기를 쓴다. */
const PLANNER_PHOTO_BG_MAX_EDGE = 4096;
/** 다시 인코딩할 때의 JPEG 품질 */
const PLANNER_PHOTO_BG_JPEG_QUALITY = 0.9;
/** 받는 파일 종류·크기 */
const PLANNER_PHOTO_BG_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];
const PLANNER_PHOTO_BG_MAX_BYTES = 20 * 1024 * 1024;

/** 화각 훑기 범위 (가로, 도) — 실제 렌즈: 초광각 ~120°, 표준 ~65°, 망원 ~25° */
const PLANNER_PHOTO_BG_FOV_MIN = 15;
const PLANNER_PHOTO_BG_FOV_MAX = 130;
/** 훑기 단계 — 거친 훑기 → 두 번 조인다. 값 하나 평가가 8×8 하나라 이 정도는 즉시 끝난다. */
const PLANNER_PHOTO_BG_FOV_STEPS = [2.5, 0.25, 0.02];

/** 물리 검사 한계 — 이 밖이면 귀퉁이 순서가 틀린 것이다 (재투영 오차로는 안 잡힌다) */
const PLANNER_PHOTO_BG_EYE_MIN_MM = 300;     // 바닥에 누워 찍지 않는다
const PLANNER_PHOTO_BG_EYE_MAX_MM = 4000;    // 천장을 뚫지 않는다
const PLANNER_PHOTO_BG_DIST_MAX_MM = 30000;  // 30m 밖에서 찍은 주방 사진은 없다

/** 건강 등급 경계 — 사진 긴 변에 비례한다. 계획의 완료 기준이 "긴 변의 1%" 다 (§2) */
const PLANNER_PHOTO_BG_GOOD_RATIO = 0.0025;  // 4032px 사진에서 약 10px
const PLANNER_PHOTO_BG_ROUGH_RATIO = 0.01;   // 40px — 계획의 완료 기준
const PLANNER_PHOTO_BG_GOOD_MIN_PX = 4;
const PLANNER_PHOTO_BG_ROUGH_MIN_PX = 12;
/**
 * 너무 얕은 사각형 — 짧은 변 / 긴 변. P0 측정: 3600×700(0.19)은 2400×1500(0.63)보다
 * 손떨림에 **3~4배** 약하다 (photo-solve.md "손떨림"). 거절하지는 않고 안내만 한다.
 */
const PLANNER_PHOTO_BG_SHALLOW = 0.3;

/** 귀퉁이 이름표 — photo-solve 의 정본 순서(0 뒤-왼 · 1 뒤-오른 · 2 앞-오른 · 3 앞-왼) 그대로 */
const PLANNER_PHOTO_BG_CORNER_LABEL = ['뒤-좌', '뒤-우', '앞-우', '앞-좌'];

/**
 * 처음 까는 사각형 — 사진 아래쪽 한가운데의 사다리꼴.
 * **클릭이 아니라 드래그로 시작하게** 하려는 것이다: 빈 사진에 네 점을 찍으라고 하면 사람은
 * 어디를 어느 순서로 찍을지부터 고민한다. 이름표 붙은 네 귀퉁이가 이미 놓여 있으면 "밀어서 맞추기" 가 된다.
 * 순서는 정본 그대로라 사진 좌표(y 아래)에서 시계 방향이다.
 */
const PLANNER_PHOTO_BG_QUAD_DEFAULT = [
  [0.30, 0.55],   // 뒤-좌
  [0.70, 0.55],   // 뒤-우
  [0.86, 0.80],   // 앞-우
  [0.14, 0.80],   // 앞-좌
];

const PLANNER_PHOTO_BG_D2R = Math.PI / 180;

// ── photo-solve 찾기 ─────────────────────────────────────
// 브라우저에서는 photo-solve.js 가 먼저 실려 window.PlannerPhotoSolve 가 있다.
// jest(CJS)에서는 require 로 찾는다 — 순수 시험이 브라우저 전역을 세우지 않아도 돌아야 한다.

let PLANNER_PHOTO_BG_SOLVE = null;
function plannerPhotoBgSolve() {
  if (PLANNER_PHOTO_BG_SOLVE) return PLANNER_PHOTO_BG_SOLVE;
  if (typeof window !== 'undefined' && window.PlannerPhotoSolve) {
    PLANNER_PHOTO_BG_SOLVE = window.PlannerPhotoSolve;
  } else if (typeof PlannerPhotoSolve !== 'undefined' && PlannerPhotoSolve) {
    PLANNER_PHOTO_BG_SOLVE = PlannerPhotoSolve;
  } else if (typeof require === 'function') {
    try { PLANNER_PHOTO_BG_SOLVE = require('./photo-solve').PlannerPhotoSolve; } catch (e) { /* 브라우저 */ }
  }
  return PLANNER_PHOTO_BG_SOLVE;
}

function plannerPhotoBgNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 숫자로 읽되 못 읽으면 기본값 */
function plannerPhotoBgN(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ── ① 사진 들이기 ───────────────────────────────────────

/**
 * 받을 수 있는 파일인가. **거절 이유는 한국어 그대로** 화면에 뜬다.
 * @returns {{ok:boolean, message:string|null}}
 */
function plannerPhotoBgAccept(file) {
  if (!file) return { ok: false, message: '사진 파일을 고르세요' };
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  const byName = /\.(jpe?g|png)$/.test(name);
  if (type ? PLANNER_PHOTO_BG_TYPES.indexOf(type) < 0 : !byName) {
    return { ok: false, message: 'JPEG 또는 PNG 사진만 올릴 수 있습니다' };
  }
  const size = Number(file.size);
  if (Number.isFinite(size) && size > PLANNER_PHOTO_BG_MAX_BYTES) {
    const mb = Math.round(size / (1024 * 1024) * 10) / 10;
    return { ok: false, message: `사진이 너무 큽니다 (${mb}MB) — 20MB 이하로 올려 주세요` };
  }
  return { ok: true, message: null };
}

/**
 * JPEG 의 EXIF 방향값 (1~8). 없거나 JPEG 이 아니면 0.
 *
 * 의존성을 들이지 않고 APP1 블록을 직접 읽는다 (photo-solve.js 가 8×8 을 직접 푼 것과 같은 이유).
 * 마커를 따라가며 APP1(0xFFE1) 에서 "Exif\0\0" 를 확인하고, TIFF 머리(바이트 순서 II/MM)를 읽어
 * IFD0 에서 태그 0x0112 를 찾는다.
 *
 * @param {ArrayBuffer|Uint8Array} buf
 */
function plannerPhotoBgExifOrientation(buf) {
  const b = plannerPhotoBgBytes(buf);
  if (!b || b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return 0;
  let off = 2;
  while (off + 4 <= b.length) {
    if (b[off] !== 0xFF) return 0;                       // 마커가 아니다 — 더 볼 것이 없다
    const marker = b[off + 1];
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { off += 2; continue; }
    if (marker === 0xDA || marker === 0xD9) return 0;    // 이미지 데이터 시작 — EXIF 는 그 앞에만 있다
    const size = (b[off + 2] << 8) | b[off + 3];
    if (size < 2) return 0;
    if (marker === 0xE1 && off + 10 < b.length &&
        b[off + 4] === 0x45 && b[off + 5] === 0x78 && b[off + 6] === 0x69 && b[off + 7] === 0x66 &&
        b[off + 8] === 0x00 && b[off + 9] === 0x00) {
      const tiff = off + 10;
      if (tiff + 8 > b.length) return 0;
      const le = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
      const big = b[tiff] === 0x4D && b[tiff + 1] === 0x4D;
      if (!le && !big) return 0;
      const u16 = (p) => (le ? (b[p] | (b[p + 1] << 8)) : ((b[p] << 8) | b[p + 1]));
      const u32 = (p) => (le
        ? ((b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0)
        : (((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0));
      if (u16(tiff + 2) !== 0x002A) return 0;
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > b.length) return 0;
      const n = u16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > b.length) return 0;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);                           // SHORT — 값이 4바이트 칸에 그대로 들어간다
          return (v >= 1 && v <= 8) ? v : 0;
        }
      }
      return 0;
    }
    off += 2 + size;
  }
  return 0;
}

/**
 * JPEG 안에 **저장된** 픽셀 크기 (SOF 마커). 브라우저가 이미 돌려서 디코딩했는지 가르는 데 쓴다.
 * @returns {{width:number, height:number}|null}
 */
function plannerPhotoBgJpegSize(buf) {
  const b = plannerPhotoBgBytes(buf);
  if (!b || b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let off = 2;
  while (off + 4 <= b.length) {
    if (b[off] !== 0xFF) return null;
    const marker = b[off + 1];
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { off += 2; continue; }
    if (marker === 0xDA || marker === 0xD9) return null;
    const size = (b[off + 2] << 8) | b[off + 3];
    if (size < 2) return null;
    // SOF0~SOF15 중 DHT(C4)·JPG(C8)·DAC(CC) 를 뺀 것이 프레임 머리다
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      if (off + 9 > b.length) return null;
      return { height: (b[off + 5] << 8) | b[off + 6], width: (b[off + 7] << 8) | b[off + 8] };
    }
    off += 2 + size;
  }
  return null;
}

function plannerPhotoBgBytes(buf) {
  if (!buf) return null;
  if (typeof Uint8Array !== 'undefined' && buf instanceof Uint8Array) return buf;
  if (typeof ArrayBuffer !== 'undefined' && buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (Array.isArray(buf)) return Uint8Array.from(buf);
  return null;
}

/**
 * EXIF 방향값 → 캔버스 변환. `setTransform(...matrix)` 뒤에 `drawImage(img, 0, 0)` 하면 바로 선다.
 *
 * @param {number} orientation 1~8 (그 밖은 1 로 본다)
 * @param {number} w 디코딩된 가로
 * @param {number} h 디코딩된 세로
 * @returns {{matrix:number[], width:number, height:number, swap:boolean, rotateDeg:number, flip:boolean}}
 */
function plannerPhotoBgOrientTransform(orientation, w, h) {
  const o = (orientation >= 1 && orientation <= 8) ? orientation : 1;
  const swap = o >= 5;
  const W = swap ? h : w, H = swap ? w : h;
  //              a  b  c  d  e  f       회전(도)   좌우뒤집기
  const T = {
    1: [[1, 0, 0, 1, 0, 0], 0, false],
    2: [[-1, 0, 0, 1, w, 0], 0, true],
    3: [[-1, 0, 0, -1, w, h], 180, false],
    4: [[1, 0, 0, -1, 0, h], 180, true],
    5: [[0, 1, 1, 0, 0, 0], 90, true],
    6: [[0, 1, -1, 0, h, 0], 90, false],
    7: [[0, -1, -1, 0, h, w], 270, true],
    8: [[0, -1, 1, 0, 0, w], 270, false],
  }[o];
  return { matrix: T[0], width: W, height: H, swap, rotateDeg: T[1], flip: T[2] };
}

/**
 * **두 번 돌리기 방지.** 요즘 브라우저는 `<img>` 를 디코딩할 때 EXIF 방향을 스스로 적용한다
 * (CSS `image-orientation: from-image` 가 기본값). 그 위에 우리가 또 돌리면 사진이 옆으로 눕는다.
 *
 * 가르는 법:
 *   · 방향 5~8 은 가로·세로가 **맞바뀐다**. JPEG 안에 저장된 크기(SOF)와 디코딩된 크기를 비교하면
 *     브라우저가 이미 돌렸는지 **확실히** 안다.
 *   · 방향 2·3·4 는 크기가 그대로라 비교로 못 가른다. 이때는 CSS `image-orientation` 지원 여부를
 *     대리 신호로 쓴다 — 지원하면 기본값이 from-image 라 브라우저가 이미 돌렸다고 본다.
 *     (`opt.browserOrients` 로 덮을 수 있다. 시험은 그 길로 두 경우를 다 본다.)
 *
 * @returns {boolean} true 면 **우리가** 돌려야 한다
 */
function plannerPhotoBgNeedsRotate(orientation, stored, decoded, opt) {
  const o = Number(orientation);
  if (!(o >= 2 && o <= 8)) return false;                  // 1·0 은 할 일이 없다
  const O = opt || {};
  const sw = stored && plannerPhotoBgNum(Number(stored.width)) ? Number(stored.width) : 0;
  const sh = stored && plannerPhotoBgNum(Number(stored.height)) ? Number(stored.height) : 0;
  const dw = decoded && plannerPhotoBgNum(Number(decoded.width)) ? Number(decoded.width) : 0;
  const dh = decoded && plannerPhotoBgNum(Number(decoded.height)) ? Number(decoded.height) : 0;
  // 정사각형 사진(sw === sh)은 맞바뀌어도 크기가 같아 **증거가 되지 못한다** — 아래 대리 신호로 간다
  if (o >= 5 && sw && sh && dw && dh && sw !== sh) {
    if (dw === sh && dh === sw) return false;              // 이미 돌아 있다
    if (dw === sw && dh === sh) return true;               // 저장된 그대로 왔다 — 우리가 돌린다
  }
  if (O.browserOrients != null) return !O.browserOrients;
  return !plannerPhotoBgBrowserOrients();
}

/** CSS image-orientation 을 아는 브라우저인가 — 알면 기본값이 from-image 라 EXIF 를 이미 적용한다. */
function plannerPhotoBgBrowserOrients() {
  try {
    if (typeof document === 'undefined' || !document.documentElement) return false;
    return 'imageOrientation' in document.documentElement.style;
  } catch (e) { return false; }
}

/**
 * 긴 변을 maxEdge 로 줄이는 크기. 이미 작으면 그대로 (키우지 않는다 — 없는 화소를 만들지 않는다).
 * @returns {{width:number, height:number, scale:number}}
 */
function plannerPhotoBgFitSize(w, h, maxEdge) {
  const W = Math.max(1, Math.round(Number(w) || 0));
  const H = Math.max(1, Math.round(Number(h) || 0));
  const M = Math.max(1, Math.round(Number(maxEdge) || PLANNER_PHOTO_BG_MAX_EDGE));
  const long = Math.max(W, H);
  if (long <= M) return { width: W, height: H, scale: 1 };
  const scale = M / long;
  return {
    width: Math.max(1, Math.round(W * scale)),
    height: Math.max(1, Math.round(H * scale)),
    scale,
  };
}

// ── ② 배치 공간 → 실제 바닥 사각형 ────────────────────────

/**
 * 배치 공간(area) 의 바닥 사각형 — **`renderAreas3D` 와 글자 그대로 같은 규약**으로 낸다
 * (mockup-structure.html `renderAreas3D` · `planeBoxOf`). 이 값이 photo-solve 의 `rect` 다.
 *
 *   중심 = (a.x + W/2, a.y + D/2) − 원점 오프셋      3D 의 box.position.x / .z
 *   회전 = a.rotation                                  3D 는 rotation.y = −rotation 으로 돈다
 *   w·d  = a.W · a.D (**맞바꾸기 전 원값**)            90/270 은 회전이 대신한다
 *
 * **사람이 치수를 넣는 칸은 없다** (2026-09-17 결정, 계획 §9-2). 도면이 이미 정답을 갖고 있고,
 * 손으로 넣으면 도면과 어긋난 값이 섞인다.
 *
 * @param {object} area 배치 공간 {id, section, x, y, W, D, rotation}
 * @param {{x:number, y:number}} origin `originPos2D` (평면도 원점)
 * @returns {{w, d, originMm:{x,z}, rotationDeg, areaId, section}|null}
 */
function plannerPhotoBgRectFromArea(area, origin) {
  if (!area || typeof area !== 'object') return null;
  const W = Number(area.W), D = Number(area.D);
  if (!plannerPhotoBgNum(W) || !plannerPhotoBgNum(D) || !(W > 0) || !(D > 0)) return null;
  const ox = plannerPhotoBgN(origin && origin.x, 0);
  const oy = plannerPhotoBgN(origin && origin.y, 0);
  const cx = plannerPhotoBgN(area.x, 0) + W / 2;
  const cy = plannerPhotoBgN(area.y, 0) + D / 2;
  const rot = ((plannerPhotoBgN(area.rotation, 0) % 360) + 360) % 360;
  return {
    w: W,
    d: D,
    originMm: { x: cx - ox, z: cy - oy },
    rotationDeg: rot,
    areaId: area.id == null ? null : area.id,
    section: area.section || null,
  };
}

/** 처음 까는 사각형 (정규 좌표 4점). 사진 크기는 받아 두지만 지금은 비율로만 쓴다. */
function plannerPhotoBgQuadDefault(imgW, imgH) {
  return PLANNER_PHOTO_BG_QUAD_DEFAULT.map((p) => [p[0], p[1]]);
}

/**
 * 미세조정을 얹은 사각형 — **카메라를 풀 때 실제로 쓰는 rect**.
 *
 * 사각형을 세계에서 (−dx, −dz) 옮겨 풀면 카메라가 그만큼 옮겨 풀리고, 세계에 고정된 가구는
 * 사진 위에서 (+dx, +dz) 만큼 움직여 보인다. 회전도 같다 — 사각형을 −dRot 돌리면 가구가 +dRot 돈다.
 * 씬을 건드리지 않고 "가구를 민다" 를 얻는 길이다 (머리말 참고).
 */
function plannerPhotoBgSolveRect(rect, nudge) {
  if (!rect) return null;
  const n = nudge || {};
  const dx = plannerPhotoBgN(n.x, 0);
  const dz = plannerPhotoBgN(n.z, 0);
  const dr = plannerPhotoBgN(n.rotationDeg, 0);
  return {
    w: rect.w,
    d: rect.d,
    originMm: { x: plannerPhotoBgN(rect.originMm && rect.originMm.x, 0) - dx,
                z: plannerPhotoBgN(rect.originMm && rect.originMm.z, 0) - dz },
    rotationDeg: plannerPhotoBgN(rect.rotationDeg, 0) - dr,
  };
}

// ── ③ 화각 자동 맞춤 ────────────────────────────────────

/**
 * 재투영 오차가 가장 작은 **가로 화각**을 찾는다.
 *
 * 근거는 P0 의 측정이다 — 3600×700 바닥을 정면(퇴화)에서 찍은 사진에서 진짜 45°/60°/75° 를
 * 60° 로 가정했을 때 재투영 RMS 가 158.8 / 0.0 / 133.2 px 로 갈렸다 (photo-solve.md).
 * 즉 **틀린 화각은 오차로 드러난다.** 그러니 슬라이더를 손으로 더듬을 필요가 없다.
 *
 * 쓰는 곳 둘 (계획 §5 P1):
 *   (a) `method:'assumed'` 로 떨어졌을 때 — 자동으로
 *   (b) 「화각 자동 맞춤」 버튼 — 사용자가 누를 때
 *
 * @returns {{fovDeg:number, reprojectionPx:number, camera:object}|null}
 */
function plannerPhotoBgFitFov(quad, rect, imgW, imgH, opt) {
  const S = plannerPhotoBgSolve();
  if (!S || typeof S.camera !== 'function') return null;
  const O = opt || {};
  const at = (deg) => {
    const cam = S.camera(quad, rect, imgW, imgH, { fovDeg: deg, near: O.near, far: O.far });
    if (!cam || !plannerPhotoBgNum(cam.reprojectionPx)) return null;
    return cam;
  };
  let lo = plannerPhotoBgN(O.min, PLANNER_PHOTO_BG_FOV_MIN);
  let hi = plannerPhotoBgN(O.max, PLANNER_PHOTO_BG_FOV_MAX);
  let best = null, bestDeg = null;
  for (let s = 0; s < PLANNER_PHOTO_BG_FOV_STEPS.length; s++) {
    const step = PLANNER_PHOTO_BG_FOV_STEPS[s];
    for (let deg = lo; deg <= hi + 1e-9; deg += step) {
      const cam = at(Math.round(deg * 1e6) / 1e6);
      if (!cam) continue;
      if (!best || cam.reprojectionPx < best.reprojectionPx) { best = cam; bestDeg = deg; }
    }
    if (bestDeg == null) return null;
    // 다음 단계는 찾은 값 둘레만 — 거친 격자의 한 칸 안에 참값이 있다
    lo = Math.max(PLANNER_PHOTO_BG_FOV_MIN, bestDeg - step);
    hi = Math.min(PLANNER_PHOTO_BG_FOV_MAX, bestDeg + step);
  }
  if (!best) return null;
  return { fovDeg: best.fovDeg, reprojectionPx: best.reprojectionPx, camera: best };
}

// ── ④ 사각형이 쓸 만한가 ───────────────────────────────

/**
 * 사용자가 놓은 사각형의 건강 상태. **숫자가 아니라 할 일을 돌려준다.**
 *
 * @returns {{level:'good'|'rough'|'bad', reprojectionPx:number|null, reason:string,
 *            hint:string|null, camera:object|null, method:string|null, shallow:boolean}}
 *
 * 등급은 재투영 오차로 가른다 (사진 긴 변에 비례 — 계획 §2 의 완료 기준이 "긴 변의 1%").
 * 그 **앞에** 물리 검사가 온다. 재투영 오차 0 인데도 틀린 경우(시작 귀퉁이 180° 어긋남)가
 * 실재하기 때문이다 — 그때 나오는 카메라는 방 반대편·바닥 아래·수십 미터 밖 중 하나로 티가 난다.
 */
function plannerPhotoBgQuadHealth(quad, rect, imgW, imgH, opt) {
  const S = plannerPhotoBgSolve();
  const O = opt || {};
  const bad = (reason, extra) => Object.assign({
    level: 'bad', reprojectionPx: null, reason, hint: null, camera: null, method: null, shallow: false,
  }, extra || {});
  if (!S || typeof S.camera !== 'function') return bad('사진 계산 모듈을 찾지 못했습니다');
  if (!rect) return bad('배치 공간을 먼저 고르세요');

  const sane = S.quadSane(quad);
  if (!sane.ok) return bad('틀림 — ' + sane.reason);

  const solveRect = plannerPhotoBgSolveRect(rect, O.nudge);
  const cam = S.camera(quad, solveRect, imgW, imgH, O.fovDeg != null ? { fovDeg: O.fovDeg } : undefined);
  if (!cam) return bad('틀림 — 이 네 점에서는 카메라를 풀 수 없습니다 (귀퉁이 순서를 확인하세요)');

  const shallow = Math.min(rect.w, rect.d) / Math.max(rect.w, rect.d) < PLANNER_PHOTO_BG_SHALLOW;
  const hint = shallow
    ? '너른 사각형이 얇은 띠보다 정확합니다 — 가구가 설 자리 전체를 잡아 보세요 (측정: 약 4배)'
    : null;

  // ── 물리 검사 — 숫자(재투영 오차)로는 못 잡는 것들 ──────────
  // 직사각형은 180° 회전에 대해 자기 자신이라, 대각선 반대 귀퉁이에서 시작하면 재투영 오차가
  // **정확히 0** 인 카메라가 나온다 (photo-solve.md 4번). 그 카메라는 방 반대편에 서 있다.
  const eye = cam.position[1];
  if (!(eye > 0)) {
    return bad('틀림 — 카메라가 바닥 아래로 풀렸습니다. 귀퉁이 순서(뒤-좌 → 뒤-우 → 앞-우 → 앞-좌)를 확인하세요',
      { camera: cam, reprojectionPx: cam.reprojectionPx, method: cam.method, shallow });
  }
  if (eye < PLANNER_PHOTO_BG_EYE_MIN_MM || eye > PLANNER_PHOTO_BG_EYE_MAX_MM) {
    return bad(`틀림 — 카메라 눈높이가 ${Math.round(eye)}mm 로 풀렸습니다. 귀퉁이 순서를 확인하세요`,
      { camera: cam, reprojectionPx: cam.reprojectionPx, method: cam.method, shallow });
  }
  if (cam.dist > PLANNER_PHOTO_BG_DIST_MAX_MM) {
    return bad(`틀림 — 카메라가 ${(cam.dist / 1000).toFixed(1)}m 밖으로 풀렸습니다. 귀퉁이 순서를 확인하세요`,
      { camera: cam, reprojectionPx: cam.reprojectionPx, method: cam.method, shallow });
  }
  if (plannerPhotoBgCameraBehind(cam, solveRect)) {
    return bad('틀림 — 카메라가 사각형 **뒤**(벽 쪽)에 섰습니다. 첫 점이 뒤-좌 귀퉁이가 맞는지 보세요',
      { camera: cam, reprojectionPx: cam.reprojectionPx, method: cam.method, shallow });
  }

  const rms = cam.reprojectionPx;
  const long = Math.max(Number(imgW) || 0, Number(imgH) || 0);
  const goodPx = Math.max(PLANNER_PHOTO_BG_GOOD_MIN_PX, long * PLANNER_PHOTO_BG_GOOD_RATIO);
  const roughPx = Math.max(PLANNER_PHOTO_BG_ROUGH_MIN_PX, long * PLANNER_PHOTO_BG_ROUGH_RATIO);
  const px = plannerPhotoBgNum(rms) ? Math.round(rms * 10) / 10 : null;
  const out = { reprojectionPx: px, camera: cam, method: cam.method, shallow, hint };
  if (px == null) {
    return Object.assign(out, { level: 'rough', reason: '대충 맞음 — 재투영 오차를 잴 수 없습니다 (사각형이 화면 밖으로 나갔습니다)' });
  }
  if (px <= goodPx) return Object.assign(out, { level: 'good', reason: `맞음 · 재투영 오차 ${px}px` });
  if (px <= roughPx) {
    return Object.assign(out, {
      level: 'rough',
      reason: `대충 맞음 · 재투영 오차 ${px}px — 사각형을 조금 더 넓게 잡아 보세요`,
    });
  }
  return Object.assign(out, {
    level: 'bad',
    reason: `틀림 · 재투영 오차 ${px}px — 귀퉁이 순서와 자리를 확인하세요`,
  });
}

/**
 * 카메라가 사각형 **뒤**(벽 쪽, 지역 −Z)에 있는가.
 * 사각형의 지역 축으로 되돌려 z 성분의 부호를 본다. 뒤에 섰다면 사람이 벽을 뚫고 찍었다는 뜻이라
 * 십중팔구 시작 귀퉁이가 180° 어긋난 것이다.
 */
function plannerPhotoBgCameraBehind(camera, rect) {
  if (!camera || !rect || !Array.isArray(camera.position)) return false;
  const th = -plannerPhotoBgN(rect.rotationDeg, 0) * PLANNER_PHOTO_BG_D2R;
  const c = Math.cos(th), s = Math.sin(th);
  const dx = camera.position[0] - plannerPhotoBgN(rect.originMm && rect.originMm.x, 0);
  const dz = camera.position[2] - plannerPhotoBgN(rect.originMm && rect.originMm.z, 0);
  // 세계 → 지역: Ez = (sinθ, 0, cosθ) 방향의 성분 (plannerPhotoRectCorners 의 역)
  const v = dx * s + dz * c;
  return v < 0;
}

// ── ⑤ 상태 ─────────────────────────────────────────────

/**
 * 저장하는 상태 — 계획 §4.4 `design_backgrounds` 의 모양을 그대로 따른다.
 * P3 에서 이 객체가 그대로 행이 된다. 지금은 localStorage 까지다.
 *
 *   quad     사진 정규 좌표 4점 (사진을 줄여도 안 깨진다)
 *   plane    { kind:'floor', areaId, rectMm:{w,d}, originMm:{x,z}, rotationDeg } — 어느 배치 공간의 바닥인가
 *   camera   푼 결과 (plannerCaptureFrame 과 같은 모양 + f·method·reprojectionPx)
 *   fovDeg   사용자가 고정한 **가로** 화각. null 이면 소실점으로 푼다
 *   nudge    { x, z, rotationDeg } — 가구 미세조정 (사각형에 반대로 얹는다, 머리말 참고)
 *   locked   사각형 편집기를 잠갔는가 (실수로 끌지 않게)
 *
 * 사진 자체는 **저장하지 않는다** — 비공개 버킷 업로드는 P3 다 (계획 §4.5). 새로고침하면
 * 사각형·화각은 남고 사진만 다시 올리면 된다.
 */
function plannerPhotoBgDefaultState() {
  return {
    quad: plannerPhotoBgQuadDefault(0, 0),
    plane: { kind: 'floor', areaId: null, rectMm: null, originMm: null, rotationDeg: 0 },
    camera: null,
    fovDeg: null,
    nudge: { x: 0, z: 0, rotationDeg: 0 },
    locked: false,
  };
}

/** 바깥에서 온 값(저장본·부모)을 믿지 않고 모양을 맞춘다. 나쁜 값은 기본값으로 떨어진다. */
function plannerPhotoBgNormalize(raw) {
  const out = plannerPhotoBgDefaultState();
  if (!raw || typeof raw !== 'object') return out;
  if (Array.isArray(raw.quad) && raw.quad.length === 4) {
    const q = [];
    for (let i = 0; i < 4; i++) {
      const p = raw.quad[i];
      const x = Array.isArray(p) ? Number(p[0]) : Number(p && p.x);
      const y = Array.isArray(p) ? Number(p[1]) : Number(p && p.y);
      if (!plannerPhotoBgNum(x) || !plannerPhotoBgNum(y)) { q.length = 0; break; }
      q.push([Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]);
    }
    if (q.length === 4) out.quad = q;
  }
  const p = raw.plane;
  if (p && typeof p === 'object') {
    out.plane.areaId = p.areaId == null ? null : p.areaId;
    out.plane.rotationDeg = plannerPhotoBgN(p.rotationDeg, 0);
    if (p.rectMm && plannerPhotoBgNum(Number(p.rectMm.w)) && plannerPhotoBgNum(Number(p.rectMm.d))) {
      out.plane.rectMm = { w: Number(p.rectMm.w), d: Number(p.rectMm.d) };
    }
    if (p.originMm && plannerPhotoBgNum(Number(p.originMm.x)) && plannerPhotoBgNum(Number(p.originMm.z))) {
      out.plane.originMm = { x: Number(p.originMm.x), z: Number(p.originMm.z) };
    }
  }
  if (raw.fovDeg != null && plannerPhotoBgNum(Number(raw.fovDeg)) && Number(raw.fovDeg) > 0 && Number(raw.fovDeg) < 180) {
    out.fovDeg = Number(raw.fovDeg);
  }
  if (raw.nudge && typeof raw.nudge === 'object') {
    out.nudge = {
      x: plannerPhotoBgN(raw.nudge.x, 0),
      z: plannerPhotoBgN(raw.nudge.z, 0),
      rotationDeg: plannerPhotoBgN(raw.nudge.rotationDeg, 0),
    };
  }
  if (raw.camera && typeof raw.camera === 'object') out.camera = raw.camera;
  out.locked = !!raw.locked;
  return out;
}

/** 상태의 plane 칸을 배치 공간에서 채운다 (rect → plane). */
function plannerPhotoBgPlaneFromRect(rect) {
  if (!rect) return { kind: 'floor', areaId: null, rectMm: null, originMm: null, rotationDeg: 0 };
  return {
    kind: 'floor',
    areaId: rect.areaId == null ? null : rect.areaId,
    rectMm: { w: rect.w, d: rect.d },
    originMm: { x: rect.originMm.x, z: rect.originMm.z },
    rotationDeg: rect.rotationDeg,
  };
}

/** plane → rect (photo-solve 가 먹는 모양). 저장본에서 되살릴 때 쓴다. */
function plannerPhotoBgRectFromPlane(plane) {
  if (!plane || !plane.rectMm || !plane.originMm) return null;
  return {
    w: plane.rectMm.w,
    d: plane.rectMm.d,
    originMm: { x: plane.originMm.x, z: plane.originMm.z },
    rotationDeg: plannerPhotoBgN(plane.rotationDeg, 0),
    areaId: plane.areaId == null ? null : plane.areaId,
  };
}

// ── 화면에 붙는 부분 (DOM) ────────────────────────────────

const PlannerPhotoBg = {
  /** 지금 상태 (plannerPhotoBgNormalize 모양) */
  state: plannerPhotoBgDefaultState(),
  /** 준비된 사진 — { blob, url, width, height, name, orientation, rotated } 또는 null. 저장하지 않는다. */
  image: null,
  /** 상태가 바뀔 때마다 부른다 (photo-mode.js 가 건다) */
  onChange: null,
  /** 시험이 갈아 끼우는 자리 — 실제 디코딩 대신 크기만 준다 */
  _decode: null,

  KEY_BASE: PLANNER_PHOTO_BG_KEY_BASE,
  MAX_EDGE: PLANNER_PHOTO_BG_MAX_EDGE,
  CORNER_LABEL: PLANNER_PHOTO_BG_CORNER_LABEL,

  key() {
    return (typeof scopedKey === 'function')
      ? scopedKey(PLANNER_PHOTO_BG_KEY_BASE)
      : ((typeof window !== 'undefined' && typeof window.scopedKey === 'function')
        ? window.scopedKey(PLANNER_PHOTO_BG_KEY_BASE)
        : PLANNER_PHOTO_BG_KEY_BASE);
  },

  /** 저장소에서 읽는다. 없거나 깨졌으면 기본값 (던지지 않는다). */
  load() {
    let raw = null;
    try { raw = localStorage.getItem(this.key()); } catch (e) { raw = null; }
    if (!raw) { this.state = plannerPhotoBgDefaultState(); return this.state; }
    try { this.state = plannerPhotoBgNormalize(JSON.parse(raw)); }
    catch (e) { this.state = plannerPhotoBgDefaultState(); }
    return this.state;
  },

  /** 저장소에 적는다. 실패해도(사생활 모드·용량) 모드는 돈다. */
  save() {
    try { localStorage.setItem(this.key(), JSON.stringify(this.state)); return true; }
    catch (e) { return false; }
  },

  /** 상태를 고치고 저장 + 알림. 한 곳으로 모아야 "바뀌었는데 안 그려졌다" 가 안 생긴다. */
  patch(part) {
    this.state = plannerPhotoBgNormalize(Object.assign({}, this.state, part || {}));
    this.save();
    if (typeof this.onChange === 'function') { try { this.onChange(this.state); } catch (e) { /* 무해 */ } }
    return this.state;
  },

  /** 사각형을 처음 자리로 되돌린다 (「사각형 다시 놓기」). */
  resetQuad() {
    const img = this.image;
    return this.patch({ quad: plannerPhotoBgQuadDefault(img ? img.width : 0, img ? img.height : 0) });
  },

  /**
   * 파일 하나를 받아 EXIF 방향을 세우고 긴 변 4096 으로 줄여 다시 인코딩한다.
   * @returns {Promise<{ok:true, image:object} | {ok:false, message:string}>} — 던지지 않는다
   */
  async prepareFile(file) {
    const gate = plannerPhotoBgAccept(file);
    if (!gate.ok) return { ok: false, message: gate.message };
    let buf = null;
    try { buf = await file.arrayBuffer(); } catch (e) { buf = null; }
    const orientation = buf ? plannerPhotoBgExifOrientation(buf) : 0;
    const stored = buf ? plannerPhotoBgJpegSize(buf) : null;

    let decoded;
    try { decoded = await this.decode(file); }
    catch (e) { return { ok: false, message: '사진을 읽지 못했습니다 — 다른 파일로 올려 주세요' }; }
    if (!decoded || !(decoded.width > 0) || !(decoded.height > 0)) {
      return { ok: false, message: '사진을 읽지 못했습니다 — 다른 파일로 올려 주세요' };
    }

    const rotate = plannerPhotoBgNeedsRotate(orientation, stored, decoded);
    const T = plannerPhotoBgOrientTransform(rotate ? orientation : 1, decoded.width, decoded.height);
    const fit = plannerPhotoBgFitSize(T.width, T.height, PLANNER_PHOTO_BG_MAX_EDGE);
    const out = await this.render(decoded, T, fit, file);
    if (!out) return { ok: false, message: '사진을 다시 그리지 못했습니다' };

    this.setImage({
      blob: out.blob || file,
      url: out.url,
      width: fit.width,
      height: fit.height,
      name: file.name || 'photo.jpg',
      orientation,
      rotated: rotate,
      scaled: fit.scale !== 1,
    });
    return { ok: true, image: this.image };
  },

  /** 파일 → 디코딩된 이미지. 시험은 `_decode` 로 갈아 끼운다 (jsdom 에는 디코더가 없다). */
  decode(file) {
    if (typeof this._decode === 'function') return Promise.resolve(this._decode(file));
    return new Promise((resolve, reject) => {
      let url = null;
      try { url = URL.createObjectURL(file); } catch (e) { reject(new Error('createObjectURL 없음')); return; }
      const img = new Image();
      img.onload = () => resolve({ el: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, url });
      img.onerror = () => { try { URL.revokeObjectURL(url); } catch (e) { /* 무해 */ } reject(new Error('디코딩 실패')); };
      img.src = url;
    });
  },

  /** 방향을 세우고 줄여 다시 그린다 → { blob, url }. 캔버스가 없으면 원본을 그대로 쓴다. */
  async render(decoded, T, fit, file) {
    if (typeof document === 'undefined' || !decoded.el) {
      let url = decoded.url || null;
      if (!url) { try { url = URL.createObjectURL(file); } catch (e) { url = null; } }
      return { blob: file, url };
    }
    try {
      const c = document.createElement('canvas');
      c.width = fit.width; c.height = fit.height;
      const ctx = c.getContext('2d');
      if (!ctx) return { blob: file, url: decoded.url || null };
      // 줄이기(fit)와 방향 세우기(T)를 한 번의 변환으로 — 두 번 그리면 화질이 두 번 깎인다
      const k = fit.scale;
      const m = T.matrix;
      ctx.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k);
      ctx.drawImage(decoded.el, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const blob = await new Promise((res) => {
        try { c.toBlob((b) => res(b), 'image/jpeg', PLANNER_PHOTO_BG_JPEG_QUALITY); }
        catch (e) { res(null); }
      });
      if (decoded.url) { try { URL.revokeObjectURL(decoded.url); } catch (e) { /* 무해 */ } }
      if (!blob) return { blob: file, url: null };
      let url = null;
      try { url = URL.createObjectURL(blob); } catch (e) { url = null; }
      return { blob, url };
    } catch (e) {
      return { blob: file, url: decoded.url || null };
    }
  },

  /** 준비된 사진을 건다. 앞의 객체 URL 은 놓는다 (안 놓으면 사진을 바꿀 때마다 메모리가 샌다). */
  setImage(img) {
    if (this.image && this.image.url && (!img || img.url !== this.image.url)) {
      try { URL.revokeObjectURL(this.image.url); } catch (e) { /* 무해 */ }
    }
    this.image = img || null;
    if (typeof this.onChange === 'function') { try { this.onChange(this.state); } catch (e) { /* 무해 */ } }
    return this.image;
  },

  clearImage() { return this.setImage(null); },

  /**
   * 파일 고르기·끌어다 놓기를 건다. 두 길이 같은 `prepareFile` 로 모인다.
   * @param {{drop:Element, input:Element, onDone:(res)=>void}} o
   */
  mountIntake(o) {
    o = o || {};
    const done = (res) => { if (typeof o.onDone === 'function') { try { o.onDone(res); } catch (e) { /* 무해 */ } } };
    const take = (file) => { this.prepareFile(file).then(done); };
    if (o.input) {
      o.input.onchange = (e) => {
        const f = e && e.target && e.target.files && e.target.files[0];
        if (f) take(f);
        try { e.target.value = ''; } catch (err) { /* 같은 파일을 다시 고를 수 있게 */ }
      };
    }
    if (o.drop) {
      const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
      o.drop.addEventListener('dragover', (e) => { stop(e); o.drop.classList.add('pb-over'); });
      o.drop.addEventListener('dragleave', (e) => { stop(e); o.drop.classList.remove('pb-over'); });
      o.drop.addEventListener('drop', (e) => {
        stop(e);
        o.drop.classList.remove('pb-over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) take(f);
      });
      if (o.input) o.drop.addEventListener('click', () => { try { o.input.click(); } catch (e) { /* 무해 */ } });
    }
    return this;
  },
};

// ── 내보내기 ─────────────────────────────────────────────

// 브라우저에서는 최상위 const·function 이 전역 렉시컬 스코프에 올라 photo-mode.js 가 맨이름으로 본다.
// 시험(jsdom 하네스)은 스크립트마다 함수 스코프를 만들므로 **window 에 올린 것만** 건너간다 —
// photo-mode.js 가 쓰는 것은 하나도 빠짐없이 여기 있어야 한다 (planner-harness.js 머리말 참고).
if (typeof window !== 'undefined') {
  window.PlannerPhotoBg = PlannerPhotoBg;
  window.PLANNER_PHOTO_BG_FOV_MIN = PLANNER_PHOTO_BG_FOV_MIN;
  window.PLANNER_PHOTO_BG_FOV_MAX = PLANNER_PHOTO_BG_FOV_MAX;
  window.plannerPhotoBgRectFromArea = plannerPhotoBgRectFromArea;
  window.plannerPhotoBgQuadDefault = plannerPhotoBgQuadDefault;
  window.plannerPhotoBgQuadHealth = plannerPhotoBgQuadHealth;
  window.plannerPhotoBgFitFov = plannerPhotoBgFitFov;
  window.plannerPhotoBgSolveRect = plannerPhotoBgSolveRect;
  window.plannerPhotoBgPlaneFromRect = plannerPhotoBgPlaneFromRect;
  window.plannerPhotoBgRectFromPlane = plannerPhotoBgRectFromPlane;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_PHOTO_BG_KEY_BASE,
    PLANNER_PHOTO_BG_MAX_EDGE,
    PLANNER_PHOTO_BG_MAX_BYTES,
    PLANNER_PHOTO_BG_TYPES,
    PLANNER_PHOTO_BG_FOV_MIN,
    PLANNER_PHOTO_BG_FOV_MAX,
    PLANNER_PHOTO_BG_EYE_MIN_MM,
    PLANNER_PHOTO_BG_EYE_MAX_MM,
    PLANNER_PHOTO_BG_DIST_MAX_MM,
    PLANNER_PHOTO_BG_SHALLOW,
    PLANNER_PHOTO_BG_CORNER_LABEL,
    PLANNER_PHOTO_BG_QUAD_DEFAULT,
    plannerPhotoBgAccept,
    plannerPhotoBgExifOrientation,
    plannerPhotoBgJpegSize,
    plannerPhotoBgOrientTransform,
    plannerPhotoBgNeedsRotate,
    plannerPhotoBgBrowserOrients,
    plannerPhotoBgFitSize,
    plannerPhotoBgRectFromArea,
    plannerPhotoBgQuadDefault,
    plannerPhotoBgSolveRect,
    plannerPhotoBgFitFov,
    plannerPhotoBgQuadHealth,
    plannerPhotoBgCameraBehind,
    plannerPhotoBgDefaultState,
    plannerPhotoBgNormalize,
    plannerPhotoBgPlaneFromRect,
    plannerPhotoBgRectFromPlane,
    PlannerPhotoBg,
  };
}
