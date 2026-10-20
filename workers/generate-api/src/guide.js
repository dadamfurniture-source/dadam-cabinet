/**
 * 사진 위 가이드 선 (깊이 계획 3a, 2026-10-18).
 *
 * 글로 "튀어나온 벽 앞면에 맞춰라" 해도 Gemini·GPT 모두 붙박이장 앞면을 그 벽까지 끌어내지 못했다
 * (10/18 붙박이장: 장 앞면 바닥선 74 / 튀어나온 벽 앞 모서리 80, 사진 높이 100 기준).
 * 시각 지시(사진 위 표시)는 글보다 잘 지켜진다 (VIBE 벤치마크). 그래서:
 *   1. 텍스트 모델이 사진에서 "보이는 선·모서리" 의 2D 위치만 찾는다 — 깊이·거리는 묻지 않는다
 *   2. 코드가 뒷벽 바닥선·천장선으로 소실점을 구하고, 튀어나온 벽 앞 모서리를 지나는
 *      뒷벽과 평행한 선(= 장 앞면이 바닥·천장에 닿는 선)을 계산한다
 *   3. 방 사진 사본에 장 윤곽(앞면 사각형 + 벽으로 물러나는 모서리)을 자홍색으로 그린다
 * 어느 단계든 실패하면 null — 호출하는 쪽은 글 지시만으로 그린다.
 *
 * 워커에는 캔버스가 없다: JPEG 는 jpeg-js 로 풀고(useTArray — Buffer 없이), PNG 는 여기서 직접 쓴다
 * (CompressionStream 'deflate' = zlib, PNG IDAT 형식).
 */

import decodeJpeg from 'jpeg-js/lib/decoder.js';
import encodeJpegLib from 'jpeg-js/lib/encoder.js';

/**
 * RGBA → JPEG 바이트 (2026-10-20). 추천안 되붙이기 결과를 PNG(1.6~2.3MB)로 올려 휴대폰에서 늦게 떴다.
 * jpeg-js 인코더는 끝에서 Buffer.from(바이트 배열) 한 번만 쓰는데 워커에는 Buffer 가 없다 —
 * 인코딩하는 그 순간에만 Uint8Array 로 대신한다. 동기 코드라 그 사이 다른 요청이 끼어들지 않는다.
 */
export function encodeJpeg({ width, height, data }, quality = 88) {
  const had = typeof globalThis.Buffer !== 'undefined';
  if (!had) globalThis.Buffer = { from: (a) => Uint8Array.from(a) };
  try {
    return new Uint8Array(encodeJpegLib({ width, height, data }, quality).data);
  } finally {
    if (!had) delete globalThis.Buffer;
  }
}

// ─── 1. 선·모서리 찾기 (텍스트 모델) ───

/**
 * @param {'left'|'right'|'both'} side 튀어나온 벽이 있는 쪽 (분석의 side_return)
 * @param {{width:number, height:number}} [size] 주면 그 크기의 픽셀 [x, y] (Claude — 2026-10-18 사장님 "선 찾기는 Haiku 5.5"),
 *   안 주면 Gemini 관례인 0~1000 정규화 [y, x]
 */
export function buildGuidePointsPrompt(side, size) {
  const anchor = side === 'left' ? 'left' : 'right';
  const far = anchor === 'left' ? 'right' : 'left';
  const coords = size
    ? `The image is ${size.width} x ${size.height} pixels. Every point is [x, y] in those pixels, with [0, 0] at the top-left corner.`
    : 'Coordinates are [y, x] normalized to 0-1000, with [0, 0] at the top-left of the image.';
  const p = size ? '[x,y]' : '[y,x]';
  return `Find lines and corners in this room photo. Return JSON only, no prose.
${coords}
The main wall faces the camera; a built-in wardrobe will fill it. At its ${anchor} end a wall section protrudes toward the camera.
{"back_floor":[${p},${p}],"back_ceiling":[${p},${p}],"return_front":{"top":${p},"bottom":${p}},"return_back":{"top":${p},"bottom":${p}},"far_floor":[${p},${p}]|null,"far_ceiling":[${p},${p}]|null}
back_floor = two points far apart on the line where the main wall meets the floor.
back_ceiling = two points far apart on the line where the main wall meets the ceiling.
return_front = the front vertical edge of the protruding ${anchor} wall: its top where it meets the ceiling and its bottom where it meets the floor.
return_back = the inner corner where the protruding ${anchor} wall meets the main wall: top and bottom.
far_floor / far_ceiling = two points far apart on the line where the ${far} side wall (or a protruding ${far} wall's inner face) meets the floor / the ceiling; null if not visible.`;
}

/**
 * 튀어나온 옆벽 다시 보기 (2026-10-20). 분석(Gemini)이 side_return 을 자주 놓쳤다 — 같은 붙박이장 사진 6번 중
 * 3번만 잡았다. 놓치면 덩어리 합성 없이 글로만 그려 깊이 검사에 걸리고 한 번 더 그린다(30~60초).
 * 분석이 null 일 때만 Haiku 에게 이것 하나만 묻는다. 확실할 때(high)만 받는다 — 틀린 쪽을 받아도
 * 다음 단계(선 찾기 → computeGuide)가 앞면이 뒷벽보다 앞에 있지 않으면 그리지 않는다.
 */
export function buildSideReturnCheckPrompt() {
  return `This photo shows a room. The main wall faces the camera; a built-in wardrobe will fill it from side to side.
Look at the left and right ends of the main wall. Is there a wall section, partition or column at either end whose own front face is parallel to the main wall but stands closer to the camera, so the main wall sits in a recess between or beside it? You would see that section's short side face (its return) running from the main wall toward the camera, then its front face.
An ordinary side wall that simply meets the main wall at an inside corner and runs toward the camera does NOT count. A door frame, window or a piece of furniture does NOT count.
Answer JSON: side = "left", "right", "both" or "none"; confidence = "high" only when the protruding section is clearly visible, otherwise "medium" or "low"; note = a few words on what you saw.`;
}

export const SIDE_RETURN_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    side: { type: 'string', enum: ['left', 'right', 'both', 'none'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    note: { type: 'string' },
  },
  required: ['side', 'confidence', 'note'],
  additionalProperties: false,
};

/** 답 → 'left'|'right'|'both' (확실할 때만) 또는 null */
export function parseSideReturnCheck(j) {
  if (!j || typeof j !== 'object') return null;
  if (j.confidence !== 'high') return null;
  return ['left', 'right', 'both'].includes(j.side) ? j.side : null;
}

/** Claude 구조화 출력용 — buildGuidePointsPrompt(side, size) 의 픽셀 [x, y] 모양 */
const XY = { type: 'array', items: { type: 'number' } };
const XY_PAIR = { type: 'array', items: XY };
const CORNER = {
  type: 'object',
  properties: { top: XY, bottom: XY },
  required: ['top', 'bottom'],
  additionalProperties: false,
};
export const GUIDE_POINTS_SCHEMA = {
  type: 'object',
  properties: {
    back_floor: XY_PAIR,
    back_ceiling: XY_PAIR,
    return_front: CORNER,
    return_back: { anyOf: [CORNER, { type: 'null' }] },
    far_floor: { anyOf: [XY_PAIR, { type: 'null' }] },
    far_ceiling: { anyOf: [XY_PAIR, { type: 'null' }] },
  },
  required: ['back_floor', 'back_ceiling', 'return_front', 'return_back', 'far_floor', 'far_ceiling'],
  additionalProperties: false,
};

/** 점 하나 → 0~1. size 가 있으면 픽셀 [x, y], 없으면 0~1000 [y, x] */
function pt(v, size) {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const a = Number(v[0]);
  const b = Number(v[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const x = size ? a / size.width : b / 1000;
  const y = size ? b / size.height : a / 1000;
  if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) return null;
  return { x, y }; // 0~1
}
function pair(v, size) {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const a = pt(v[0], size);
  const b = pt(v[1], size);
  return a && b ? [a, b] : null;
}
function corner(v, size) {
  if (!v || typeof v !== 'object') return null;
  const top = pt(v.top, size);
  const bottom = pt(v.bottom, size);
  return top && bottom ? { top, bottom } : null;
}

/**
 * 모델 응답(문자열 또는 이미 풀린 객체) → 0~1 좌표.
 * 필수(뒷벽 바닥선·천장선·튀어나온 벽 앞 모서리)가 없으면 null.
 * @param {{width:number, height:number}} [size] 픽셀 [x, y] 로 받았을 때 그 이미지 크기
 */
export function parseGuidePoints(input, side, size) {
  let j = input && typeof input === 'object' ? input : null;
  if (!j) {
    const m = typeof input === 'string' && input.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      j = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  const out = {
    side: side === 'left' ? 'left' : 'right',
    backFloor: pair(j.back_floor, size),
    backCeiling: pair(j.back_ceiling, size),
    returnFront: corner(j.return_front, size),
    returnBack: corner(j.return_back, size),
    farFloor: pair(j.far_floor, size),
    farCeiling: pair(j.far_ceiling, size),
  };
  return out.backFloor && out.backCeiling && out.returnFront ? out : null;
}

// ─── 2. 소실점·앞면 선 계산 (픽셀 좌표, 동차 좌표) ───

const h = (p) => [p.x, p.y, 1];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lineOf = (a, b) => cross(h(a), h(b));
function meet(l1, l2) {
  const p = cross(l1, l2);
  if (Math.abs(p[2]) < 1e-9) return null; // 평행
  return { x: p[0] / p[2], y: p[1] / p[2] };
}
/** 선 위, 주어진 x 에서의 y */
function yAt(l, x) {
  return Math.abs(l[1]) < 1e-12 ? NaN : -(l[0] * x + l[2]) / l[1];
}

/**
 * 장 윤곽 선분을 계산한다 (픽셀). 앞면이 뒷벽보다 카메라 쪽에 있지 않으면 null.
 * @param {object} g  parseGuidePoints 결과 (0~1)
 * @param {number} W @param {number} H  그릴 이미지 크기
 * @returns {{segments: Array<[{x,y},{x,y}]>, front: object}|null}
 */
export function computeGuide(g, W, H) {
  if (!g) return null;
  const P = (p) => ({ x: p.x * W, y: p.y * H });
  const bf = lineOf(P(g.backFloor[0]), P(g.backFloor[1]));
  const bc = lineOf(P(g.backCeiling[0]), P(g.backCeiling[1]));
  // 뒷벽 바닥선·천장선은 실제로 평행 → 사진에서 만나는 점이 벽 방향 소실점. 평행이면 무한점(방향)
  const v = cross(bf, bc);
  const vp = Math.abs(v[2]) < 1e-9 * Math.hypot(v[0], v[1])
    ? (() => {
        const a = P(g.backFloor[0]);
        const b = P(g.backFloor[1]);
        return [b.x - a.x, b.y - a.y, 0];
      })()
    : v;

  const rb = P(g.returnFront.bottom);
  const rt = P(g.returnFront.top);
  const front = cross(h(rb), vp); // 앞면이 바닥에 닿는 선
  const frontTop = cross(h(rt), vp); // 앞면이 천장에 닿는 선

  // 반대쪽 끝: 옆벽(또는 반대쪽 튀어나온 벽 안쪽 면) 바닥선과 만나는 점, 없으면 사진 가장자리
  const edgeX = g.side === 'right' ? 0 : W;
  const edge = [1, 0, -edgeX];
  const ff = g.farFloor ? lineOf(P(g.farFloor[0]), P(g.farFloor[1])) : null;
  const fc = g.farCeiling ? lineOf(P(g.farCeiling[0]), P(g.farCeiling[1])) : null;
  const ob = (ff && meet(front, ff)) || meet(front, edge);
  const ot = (fc && meet(frontTop, fc)) || meet(frontTop, edge);
  if (!ob || !ot) return null;

  // 앞면이 뒷벽보다 앞(아래)에 있는지 — 튀어나온 벽 앞 모서리 x 에서 비교
  const yBack = yAt(bf, rb.x);
  if (!(rb.y > yBack + 2)) return null;
  // 말이 안 되는 점(사진 밖으로 크게 벗어남) 은 버린다
  const ok = (p) => p.x > -0.3 * W && p.x < 1.3 * W && p.y > -0.3 * H && p.y < 1.3 * H;
  if (![ob, ot, rb, rt].every(ok)) return null;

  const segments = [
    [ob, rb], // 앞면 바닥
    [ot, rt], // 앞면 천장
    [ob, ot], // 반대쪽 앞 모서리
    [rb, rt], // 튀어나온 벽 쪽 앞 모서리
  ];
  // 벽으로 물러나는 모서리 (깊이)
  if (g.returnBack) {
    segments.push([rb, P(g.returnBack.bottom)], [rt, P(g.returnBack.top)]);
  }
  const bb = ff && meet(bf, ff);
  const bt = fc && meet(bc, fc);
  if (bb && ok(bb)) segments.push([ob, bb]);
  if (bt && ok(bt)) segments.push([ot, bt]);
  return { segments, front: { ob, ot, rb, rt } };
}

// ─── 3. 그리기 ───

const MAGENTA = [255, 0, 255];
const MAX_EDGE = 1024; // 가이드는 지시용 — 크게 보낼 까닭이 없다 (PNG 는 사진에 무겁다)

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** RGBA → RGB, 긴 변 maxEdge 로 상자 평균 축소 */
export function downscale(img, maxEdge) {
  const { width: w, height: hgt, data } = img;
  const s = Math.min(1, maxEdge / Math.max(w, hgt));
  const W = Math.max(1, Math.round(w * s));
  const H = Math.max(1, Math.round(hgt * s));
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y * hgt) / H);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * hgt) / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * w) / W);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / W));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      const o = (y * W + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return { width: W, height: H, rgb: out };
}

/** 굵은 선분 — 선을 따라 촘촘히 정사각 붓을 찍는다. 사진 밖은 버린다. */
export function drawSegment(img, a, b, thick, color = MAGENTA) {
  const { width: W, height: H, rgb } = img;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(len));
  const r = Math.max(1, Math.floor(thick / 2));
  for (let i = 0; i <= steps; i++) {
    const cx = Math.round(a.x + ((b.x - a.x) * i) / steps);
    const cy = Math.round(a.y + ((b.y - a.y) * i) / steps);
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= H) continue;
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= W) continue;
        const o = (y * W + x) * 3;
        rgb[o] = color[0]; rgb[o + 1] = color[1]; rgb[o + 2] = color[2];
      }
    }
  }
}

let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zlib(bytes) {
  const cs = new CompressionStream('deflate'); // zlib 형식 — PNG IDAT 가 요구하는 것
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** RGB 8비트 PNG */
export async function encodePng({ width: W, height: H, rgb }) {
  const raw = new Uint8Array(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0; // 필터 없음
    raw.set(rgb.subarray(y * W * 3, (y + 1) * W * 3), y * (W * 3 + 1) + 1);
  }
  const idat = await zlib(raw);
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 2; // RGB
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    png.set(p, off);
    off += p.length;
  }
  return png;
}

/**
 * 방 사진(JPEG) → 가이드용 바탕: 긴 변 1024 로 줄인 RGB 와 그 깨끗한 PNG.
 * 선 찾는 모델에 이 PNG 를 그대로 보내고 그 픽셀 좌표로 받는다 — 받은 좌표를 같은 그림에 그리니 어긋나지 않는다.
 * JPEG 가 아니면 null.
 * @returns {Promise<{img:object, width:number, height:number, png:{base64:string, mimeType:'image/png'}}|null>}
 */
export async function prepareGuideCanvas(room) {
  if (!room || room.mimeType !== 'image/jpeg') return null;
  const decoded = decodeJpeg(b64ToBytes(room.base64), { useTArray: true, formatAsRGBA: true });
  const img = downscale(decoded, MAX_EDGE);
  const png = await encodePng(img);
  return { img, width: img.width, height: img.height, png: { base64: bytesToB64(png), mimeType: 'image/png' } };
}

/**
 * 바탕 사본에 장 윤곽을 그린 PNG. 계산이 안 되면 null. 바탕(canvas.img)은 건드리지 않는다.
 * @returns {Promise<{base64:string, mimeType:'image/png', width:number, height:number, guide:object}|null>}
 */
export async function drawGuide(canvas, points) {
  if (!canvas || !points) return null;
  const guide = computeGuide(points, canvas.width, canvas.height);
  if (!guide) return null;
  const img = { width: canvas.width, height: canvas.height, rgb: canvas.img.rgb.slice() };
  const thick = Math.max(3, Math.round(Math.max(img.width, img.height) / 220));
  for (const [a, b] of guide.segments) drawSegment(img, a, b, thick);
  const png = await encodePng(img);
  return { base64: bytesToB64(png), mimeType: 'image/png', width: img.width, height: img.height, guide };
}

// ─── 4. 덩어리 합성 (2026-10-19) ───
// 윤곽선만 보냈더니 GPT 가 선은 지우고 장은 원래 벽면에 그렸다 (10/18 두 건: 가이드 앞면 79, 결과 73·74).
// 그래서 계산한 앞면 사각형을 무광 흰 판으로 **채워** 사진에 먼저 합성하고, 모델에게는 다듬기만 시킨다.
// 뒷벽이 덩어리에 가려져 있으니 장을 뒷벽으로 되돌릴 여지가 없다.

/** 단위 정사각형 (u,v) → 사각형. 꼭짓점 순서: 왼위(0,0) 오위(1,0) 오아래(1,1) 왼아래(0,1). Heckbert */
export function squareToQuad([p0, p1, p2, p3]) {
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  let a, b, c, d, e, f, g, hh;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = p1.x - p0.x; b = p2.x - p1.x; c = p0.x;
    d = p1.y - p0.y; e = p2.y - p1.y; f = p0.y;
    g = 0; hh = 0;
  } else {
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    hh = (dx1 * sy - sx * dy1) / den;
    a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + hh * p3.x; c = p0.x;
    d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + hh * p3.y; f = p0.y;
  }
  const M = [a, b, c, d, e, f, g, hh, 1];
  const fwd = (u, v) => {
    const w = M[6] * u + M[7] * v + 1;
    return { x: (M[0] * u + M[1] * v + M[2]) / w, y: (M[3] * u + M[4] * v + M[5]) / w };
  };
  // 3×3 역행렬
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = M;
  const A = m4 * m8 - m5 * m7, B = m5 * m6 - m3 * m8, C = m3 * m7 - m4 * m6;
  const det = m0 * A + m1 * B + m2 * C;
  const I = [
    A / det, (m2 * m7 - m1 * m8) / det, (m1 * m5 - m2 * m4) / det,
    B / det, (m0 * m8 - m2 * m6) / det, (m2 * m3 - m0 * m5) / det,
    C / det, (m1 * m6 - m0 * m7) / det, (m0 * m4 - m1 * m3) / det,
  ];
  const inv = (x, y) => {
    const w = I[6] * x + I[7] * y + I[8];
    return { u: (I[0] * x + I[1] * y + I[2]) / w, v: (I[3] * x + I[4] * y + I[5]) / w };
  };
  return { fwd, inv };
}

const PANEL = [236, 234, 229]; // 무광 오프화이트 — 마감색은 모델이 FINISH 대로 입힌다

/**
 * 앞면 사각형을 채운 덩어리를 img(RGB) 위에 직접 그린다.
 * @param {object} img {width, height, rgb}
 * @param {object} front computeGuide().front — ob/ot(반대쪽), rb/rt(튀어나온 벽 쪽)
 * @param {{doors?:number, plinth?:number, lines?:{vertical?:number[], horizontal?:{v:number,u0:number,u1:number}[]}}} [o]
 *   문짝 수(같은 폭으로 나눔), 걸레받이 높이(앞면 높이 대비 비율),
 *   lines — 2026-10-20 냉장고장: 같은 폭이 아닌 나눔선. vertical 은 앞면 폭의 0~1 (왼쪽부터), horizontal 은 높이 0~1 (위부터)에
 *   u0~u1 구간만. 주면 doors 는 쓰지 않는다.
 */
export function paintMassing(img, front, o = {}) {
  const lines = o.lines && (Array.isArray(o.lines.vertical) || Array.isArray(o.lines.horizontal)) ? o.lines : null;
  const vLines = lines ? (lines.vertical || []).filter((u) => u > 0 && u < 1) : [];
  const hLines = lines ? (lines.horizontal || []).filter((h) => h && h.v > 0 && h.v < 1) : [];
  const doors = lines ? 1 : Math.max(1, o.doors || 1);
  const plinth = o.plinth ?? 0.026; // 60mm / 2300mm 쯤
  const left = front.ob.x <= front.rb.x;
  const [tl, tr, br, bl] = left ? [front.ot, front.rt, front.rb, front.ob] : [front.rt, front.ot, front.ob, front.rb];
  const H = squareToQuad([tl, tr, br, bl]);
  const { width: W, height: Ht, rgb } = img;
  const xs = [tl.x, tr.x, br.x, bl.x];
  const ys = [tl.y, tr.y, br.y, bl.y];
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(Ht - 1, Math.ceil(Math.max(...ys)));
  const frontW = Math.max(1, Math.hypot(br.x - bl.x, br.y - bl.y));
  const frontH = Math.max(1, Math.hypot(bl.x - tl.x, bl.y - tl.y));
  const gapU = 1.3 / frontW; // 문짝 틈 반폭 ≈ 1.3px
  const edgeV = 1.5 / frontH;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const { u, v } = H.inv(x + 0.5, y + 0.5);
      if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) continue;
      let k = 1.02 - 0.06 * v; // 위가 살짝 밝다 (천장 조명)
      const du = (u * doors) % 1;
      if (Math.min(du, 1 - du) * (1 / doors) < gapU && u > gapU && u < 1 - gapU) k *= 0.55; // 문짝 틈
      if (lines) {
        if (vLines.some((lu) => Math.abs(u - lu) < gapU)) k *= 0.55; // 자리·통 나눔선
        if (hLines.some((h) => u >= h.u0 && u <= h.u1 && Math.abs(v - h.v) < edgeV)) k *= 0.55; // 단 나눔선
      }
      if (v > 1 - plinth) k *= 0.72; // 걸레받이 (안으로 들어간 띠)
      else if (v > 1 - plinth - 2 * edgeV) k *= 0.55; // 문짝 아래 그림자선
      if (v < 2 * edgeV) k *= 0.8; // 천장 이음 그림자
      const o3 = (y * W + x) * 3;
      rgb[o3] = Math.min(255, PANEL[0] * k);
      rgb[o3 + 1] = Math.min(255, PANEL[1] * k);
      rgb[o3 + 2] = Math.min(255, PANEL[2] * k);
    }
  }
}

/**
 * 방 사진(JPEG) 원본 해상도에 덩어리를 합성한 PNG — 편집 대상(첫 사진)으로 쓴다. 계산이 안 되면 null.
 * jpeg-js 의 인코더는 워커에서 Buffer 를 찾아 쓸 수 없어 PNG 로 쓴다.
 */
export async function renderMassingImage(room, points, o = {}) {
  if (!room || room.mimeType !== 'image/jpeg' || !points) return null;
  const decoded = decodeJpeg(b64ToBytes(room.base64), { useTArray: true, formatAsRGBA: true });
  const img = downscale(decoded, Infinity); // 같은 크기 RGB
  const guide = computeGuide(points, img.width, img.height);
  if (!guide) return null;
  paintMassing(img, guide.front, o);
  const png = await encodePng(img);
  return { base64: bytesToB64(png), mimeType: 'image/png', width: img.width, height: img.height, guide };
}

// ─── 5. 추천안 되붙이기 (2026-10-19) ───
// 범위 문장을 넣어도 GPT 추천안이 붙박이장 바로 옆 세면대 서랍까지 칠했다. 덩어리 합성을 쓴 건은 장 앞면이
// 사진 어디인지 코드가 안다 → 그 영역(조금 넓게)만 추천안 픽셀, 나머지는 기본안 픽셀. 경계는 feather 만큼 섞는다.

/**
 * @param {{base64,mimeType}} base     기본안 (JPEG)
 * @param {{base64,mimeType}} variant  추천안 (JPEG)
 * @param {object} points              parseGuidePoints 결과 (0~1)
 * @param {{grow?:number, feather?:number}} [o] 영역을 넓힐 폭·섞는 폭 (사진 너비 대비 비율)
 * @returns {Promise<{base64:string, mimeType:'image/jpeg'}|null>} 크기가 다르거나 JPEG 가 아니면 null (2026-10-20 PNG → JPEG)
 */
export async function pasteVariantInside(base, variant, points, o = {}) {
  if (!base || !variant || base.mimeType !== 'image/jpeg' || variant.mimeType !== 'image/jpeg' || !points) return null;
  const B = decodeJpeg(b64ToBytes(base.base64), { useTArray: true, formatAsRGBA: true });
  const V = decodeJpeg(b64ToBytes(variant.base64), { useTArray: true, formatAsRGBA: true });
  if (B.width !== V.width || B.height !== V.height) return null;
  const W = B.width;
  const H = B.height;
  const g = computeGuide(points, W, H);
  if (!g) return null;
  const f = g.front;
  const left = f.ob.x <= f.rb.x;
  const [tl, tr, br, bl] = left ? [f.ot, f.rt, f.rb, f.ob] : [f.rt, f.ot, f.ob, f.rb];
  const Hq = squareToQuad([tl, tr, br, bl]);
  const frontW = Math.max(1, Math.hypot(br.x - bl.x, br.y - bl.y));
  const frontH = Math.max(1, Math.hypot(bl.x - tl.x, bl.y - tl.y));
  const grow = (o.grow ?? 0.008) * W; // 끝 측판·걸레받이 그림자까지 담는다
  const feather = Math.max(1, (o.feather ?? 0.005) * W);
  // 기본안 RGBA 에 그대로 섞는다 (메모리 — 2K 사진 한 장이 12MB 다)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i4 = (y * W + x) * 4;
      const { u, v } = Hq.inv(x + 0.5, y + 0.5);
      // 사각형 밖으로 얼마나 나갔는지(픽셀 근사)
      const du = Math.max(0, -u, u - 1) * frontW;
      const dv = Math.max(0, -v, v - 1) * frontH;
      const d = Number.isFinite(du + dv) ? Math.max(du, dv) : Infinity;
      const a = d <= grow ? 1 : d >= grow + feather ? 0 : 1 - (d - grow) / feather;
      if (a <= 0) continue;
      B.data[i4] = V.data[i4] * a + B.data[i4] * (1 - a);
      B.data[i4 + 1] = V.data[i4 + 1] * a + B.data[i4 + 1] * (1 - a);
      B.data[i4 + 2] = V.data[i4 + 2] * a + B.data[i4 + 2] * (1 - a);
    }
  }
  return { base64: bytesToB64(encodeJpeg(B)), mimeType: 'image/jpeg' };
}

/**
 * 되붙이기 — 다각형 여러 개(0~1, 싱크대의 칠한 면들) 안은 추천안, 밖은 기본안. 경계는 섞는다.
 * 각 다각형은 볼록이다. 크기가 다르거나 JPEG 가 아니면 null.
 */
export async function pasteVariantInPolys(base, variant, polys, o = {}) {
  if (!base || !variant || base.mimeType !== 'image/jpeg' || variant.mimeType !== 'image/jpeg' || !Array.isArray(polys) || !polys.length) return null;
  const B = decodeJpeg(b64ToBytes(base.base64), { useTArray: true, formatAsRGBA: true });
  const V = decodeJpeg(b64ToBytes(variant.base64), { useTArray: true, formatAsRGBA: true });
  if (B.width !== V.width || B.height !== V.height) return null;
  const W = B.width;
  const H = B.height;
  const grow = (o.grow ?? 0.006) * W;
  const feather = Math.max(1, (o.feather ?? 0.005) * W);
  const alpha = new Float32Array(W * H);
  const reach = grow + feather;
  for (const poly of polys) {
    const P = poly.map((p) => ({ x: p.x * W, y: p.y * H }));
    if (P.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) continue;
    let area = 0;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      area += a.x * b.y - b.x * a.y;
    }
    const sgn = area >= 0 ? 1 : -1;
    const xs = P.map((p) => p.x), ys = P.map((p) => p.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - reach)), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs) + reach));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - reach)), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys) + reach));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        let inside = true;
        let dmin = Infinity;
        for (let i = 0; i < P.length; i++) {
          const a = P[i], b = P[(i + 1) % P.length];
          const ex = b.x - a.x, ey = b.y - a.y;
          if (sgn * (ex * (py - a.y) - ey * (px - a.x)) < 0) inside = false;
          const L2 = ex * ex + ey * ey || 1;
          const t = Math.max(0, Math.min(1, ((px - a.x) * ex + (py - a.y) * ey) / L2));
          dmin = Math.min(dmin, Math.hypot(px - (a.x + t * ex), py - (a.y + t * ey)));
        }
        const d = inside ? 0 : dmin;
        const a = d <= grow ? 1 : d >= reach ? 0 : 1 - (d - grow) / feather;
        const k = y * W + x;
        if (a > alpha[k]) alpha[k] = a;
      }
    }
  }
  for (let k = 0; k < W * H; k++) {
    const a = alpha[k];
    if (a <= 0) continue;
    const i4 = k * 4;
    B.data[i4] = V.data[i4] * a + B.data[i4] * (1 - a);
    B.data[i4 + 1] = V.data[i4 + 1] * a + B.data[i4 + 1] * (1 - a);
    B.data[i4 + 2] = V.data[i4 + 2] * a + B.data[i4 + 2] * (1 - a);
  }
  return { base64: bytesToB64(encodeJpeg(B)), mimeType: 'image/jpeg' };
}

/** 한 번에 (시험·도구용): 방 사진 사본에 윤곽을 그린 PNG. JPEG 가 아니거나 계산이 안 되면 null. */
export async function renderGuideImage(room, points) {
  const canvas = await prepareGuideCanvas(room);
  return canvas ? drawGuide(canvas, points) : null;
}
