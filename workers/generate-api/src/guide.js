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

// ─── 1. 선·모서리 찾기 (텍스트 모델) ───

/** @param {'left'|'right'|'both'} side 튀어나온 벽이 있는 쪽 (분석의 side_return) */
export function buildGuidePointsPrompt(side) {
  const anchor = side === 'left' ? 'left' : 'right';
  const far = anchor === 'left' ? 'right' : 'left';
  return `Find lines and corners in this room photo. Return JSON only, no prose.
Coordinates are [y, x] normalized to 0-1000, with [0, 0] at the top-left of the image.
The main wall faces the camera; a built-in wardrobe will fill it. At its ${anchor} end a wall section protrudes toward the camera.
{"back_floor":[[y,x],[y,x]],"back_ceiling":[[y,x],[y,x]],"return_front":{"top":[y,x],"bottom":[y,x]},"return_back":{"top":[y,x],"bottom":[y,x]},"far_floor":[[y,x],[y,x]]|null,"far_ceiling":[[y,x],[y,x]]|null}
back_floor = two points far apart on the line where the main wall meets the floor.
back_ceiling = two points far apart on the line where the main wall meets the ceiling.
return_front = the front vertical edge of the protruding ${anchor} wall: its top where it meets the ceiling and its bottom where it meets the floor.
return_back = the inner corner where the protruding ${anchor} wall meets the main wall: top and bottom.
far_floor / far_ceiling = two points far apart on the line where the ${far} side wall (or a protruding ${far} wall's inner face) meets the floor / the ceiling; null if not visible.`;
}

function pt(v) {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [y, x] = v.map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -50 || x > 1050 || y < -50 || y > 1050) return null;
  return { x: x / 1000, y: y / 1000 }; // 0~1
}
function pair(v) {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const a = pt(v[0]);
  const b = pt(v[1]);
  return a && b ? [a, b] : null;
}
function corner(v) {
  if (!v || typeof v !== 'object') return null;
  const top = pt(v.top);
  const bottom = pt(v.bottom);
  return top && bottom ? { top, bottom } : null;
}

/** 모델 응답 → 0~1 좌표. 필수(뒷벽 바닥선·천장선·튀어나온 벽 앞 모서리) 가 없으면 null. */
export function parseGuidePoints(text, side) {
  const m = text && text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const out = {
    side: side === 'left' ? 'left' : 'right',
    backFloor: pair(j.back_floor),
    backCeiling: pair(j.back_ceiling),
    returnFront: corner(j.return_front),
    returnBack: corner(j.return_back),
    farFloor: pair(j.far_floor),
    farCeiling: pair(j.far_ceiling),
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

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** RGBA → RGB, 긴 변 maxEdge 로 상자 평균 축소 */
function downscale(img, maxEdge) {
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
 * 방 사진(JPEG base64) 사본에 장 윤곽을 그린 PNG. JPEG 가 아니거나 계산이 안 되면 null.
 * @returns {Promise<{base64:string, mimeType:'image/png', width:number, height:number, guide:object}|null>}
 */
export async function renderGuideImage(room, points) {
  if (!room || room.mimeType !== 'image/jpeg' || !points) return null;
  const decoded = decodeJpeg(b64ToBytes(room.base64), { useTArray: true, formatAsRGBA: true });
  const img = downscale(decoded, MAX_EDGE);
  const guide = computeGuide(points, img.width, img.height);
  if (!guide) return null;
  const thick = Math.max(3, Math.round(Math.max(img.width, img.height) / 220));
  for (const [a, b] of guide.segments) drawSegment(img, a, b, thick);
  const png = await encodePng(img);
  return { base64: bytesToB64(png), mimeType: 'image/png', width: img.width, height: img.height, guide };
}
