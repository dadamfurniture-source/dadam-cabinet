/**
 * 싱크대 덩어리 합성 (2026-10-19, 사장님 "싱크대에도 덩어리 합성 방식 적용").
 *
 * 붙박이장은 튀어나온 벽 앞 모서리가 자였다. 싱크대는 깊이가 다른 덩어리 여럿(하부장 600·상판 650·상부장 350)이고
 * 기준 모서리가 없다 → 사진에서 카메라를 풀어 mm 로 재고, 3D 상자를 사진에 투영해 칠한다.
 *   1. 텍스트 모델(Haiku 5.5)이 보이는 선만 찾는다: 뒷벽 바닥·천장선, 옆벽 바닥·천장선, 뒷벽 양 끝
 *   2. 뒷벽 선 교점 = 벽 방향 소실점, 옆벽 선 교점 = 깊이 방향 소실점. 두 소실점이 직교한다는 조건으로
 *      초점거리(믿을 만할 때만, 아니면 폰 기본 26mm 환산)와 방향을 구하고, 벽 높이(mm)로 카메라 높이·벽 거리를 정한다
 *      (예전 4점 호모그래피 역산은 오차가 25배 커져 접었다 — 이건 소실점 둘 + 벽 높이)
 *   3. 하부장·걸레받이·상판·상부장·개수대·쿡탑 면을 투영해 무광 판으로 칠한다
 * 어느 단계든 말이 안 되면 null — 호출하는 쪽은 글 지시로 그린다.
 */

import decodeJpeg from 'jpeg-js/lib/decoder.js';
import { b64ToBytes, bytesToB64, downscale, encodePng } from './guide.js';

// ─── 1. 선 찾기 ───

/** @param {{width:number, height:number}} size 보내는 그림의 픽셀 크기 — 좌표는 그 픽셀 [x, y] */
export function buildKitchenPointsPrompt(size) {
  return `Find lines and corners in this room photo. Return JSON only, no prose.
The image is ${size.width} x ${size.height} pixels. Every point is [x, y] in those pixels, with [0, 0] at the top-left corner.
The main wall faces the camera; a built-in kitchen will run along it.
{"back_floor":[[x,y],[x,y]],"back_ceiling":[[x,y],[x,y]],"left_end":{"floor":[x,y],"ceiling":[x,y],"side_wall":boolean}|null,"right_end":{"floor":[x,y],"ceiling":[x,y],"side_wall":boolean}|null,"side_floor":[[x,y],[x,y]]|null,"side_ceiling":[[x,y],[x,y]]|null}
back_floor = two points far apart on the line where the main wall meets the floor.
back_ceiling = two points far apart on the line where the main wall meets the ceiling.
left_end / right_end = where the main wall ends on that side inside the photo: the floor point and the ceiling point of that end; side_wall = true when a side wall continues toward the camera from there, false when the wall simply ends (open space or a column). null when the main wall runs past the photo edge.
side_floor / side_ceiling = two points far apart on the line where a side wall that runs toward the camera (either side) meets the floor / the ceiling; null if no side wall is visible.`;
}

const XY = { type: 'array', items: { type: 'number' } };
const XY_PAIR = { type: 'array', items: XY };
const END = {
  type: 'object',
  properties: { floor: XY, ceiling: XY, side_wall: { type: 'boolean' } },
  required: ['floor', 'ceiling', 'side_wall'],
  additionalProperties: false,
};
export const KITCHEN_POINTS_SCHEMA = {
  type: 'object',
  properties: {
    back_floor: XY_PAIR,
    back_ceiling: XY_PAIR,
    left_end: { anyOf: [END, { type: 'null' }] },
    right_end: { anyOf: [END, { type: 'null' }] },
    side_floor: { anyOf: [XY_PAIR, { type: 'null' }] },
    side_ceiling: { anyOf: [XY_PAIR, { type: 'null' }] },
  },
  required: ['back_floor', 'back_ceiling', 'left_end', 'right_end', 'side_floor', 'side_ceiling'],
  additionalProperties: false,
};

function pt(v, size) {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const x = Number(v[0]) / size.width;
  const y = Number(v[1]) / size.height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) return null;
  return { x, y };
}
function pair(v, size) {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const a = pt(v[0], size);
  const b = pt(v[1], size);
  return a && b ? [a, b] : null;
}
function end(v, size) {
  if (!v || typeof v !== 'object') return null;
  const floor = pt(v.floor, size);
  const ceiling = pt(v.ceiling, size);
  return floor && ceiling ? { floor, ceiling, sideWall: v.side_wall === true } : null;
}

/** 모델 응답 → 0~1 좌표. 뒷벽 바닥·천장선과 옆벽 바닥·천장선(깊이 방향)이 모두 있어야 한다. */
export function parseKitchenPoints(input, size) {
  let j = input && typeof input === 'object' ? input : null;
  if (!j && typeof input === 'string') {
    const m = input.match(/\{[\s\S]*\}/);
    try {
      j = m ? JSON.parse(m[0]) : null;
    } catch {
      j = null;
    }
  }
  if (!j) return null;
  const out = {
    backFloor: pair(j.back_floor, size),
    backCeiling: pair(j.back_ceiling, size),
    leftEnd: end(j.left_end, size),
    rightEnd: end(j.right_end, size),
    sideFloor: pair(j.side_floor, size),
    sideCeiling: pair(j.side_ceiling, size),
  };
  return out.backFloor && out.backCeiling && out.sideFloor && out.sideCeiling ? out : null;
}

// ─── 2. 카메라 풀기 ───

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (...vs) => vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
const norm = (a) => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/**
 * @param {object} g parseKitchenPoints 결과
 * @param {number} W @param {number} H 그릴 이미지 픽셀 크기
 * @param {{wallH?:number, focalMm?:number}} [o] 벽 높이(mm, 분석값), 기본 초점거리(35mm 환산)
 * @returns {object|null} {f, cx, cy, r1, r2, r3, hf, D, xL, xR, leftOpen, rightOpen, project(X,h,z)}
 */
export function solveKitchenCamera(g, W, H, o = {}) {
  if (!g) return null;
  const wallH = o.wallH || 2400;
  const P = (p) => [p.x * W, p.y * H, 1];
  const line = (pr) => cross(P(pr[0]), P(pr[1]));
  const bf = line(g.backFloor);
  const bc = line(g.backCeiling);
  const vx = cross(bf, bc); // 벽 방향 소실점 (평행이면 w≈0)
  const vz = cross(line(g.sideFloor), line(g.sideCeiling)); // 깊이 방향 소실점
  if (Math.abs(vz[2]) < 1e-9 * Math.hypot(vz[0], vz[1])) return null; // 깊이 방향이 평행 — 정면 아닌 사진에서 옆벽이 이상하다
  const cx = W / 2;
  const cy = H / 2;
  const fDefault = ((o.focalMm || 26) / 43.27) * Math.hypot(W, H);
  let f = fDefault;
  if (Math.abs(vx[2]) > 1e-9 * Math.hypot(vx[0], vx[1])) {
    const ax = vx[0] / vx[2] - cx, ay = vx[1] / vx[2] - cy;
    const bx = vz[0] / vz[2] - cx, by = vz[1] / vz[2] - cy;
    const f2 = -(ax * bx + ay * by);
    // 거의 정면인 사진은 벽 방향 소실점이 사진 밖 아주 멀리 있다 — 선이 한두 픽셀만 틀어져도 f 가 크게 흔들린다
    //   (10/19 공사 현장 싱크대: f 798px 로 벽 거리 7.1m, 시멘트 띠로 검산하면 3m 남짓). 대각선 2.5배 밖이면 쓰지 않는다.
    if (f2 > 0 && Math.hypot(ax, ay) < 2.5 * Math.hypot(W, H)) {
      const fv = Math.sqrt(f2);
      if (fv > 0.5 * fDefault && fv < 2.2 * fDefault) f = fv; // 두 소실점이 그럴듯할 때만 믿는다
    }
  }
  const Kinv = (p) => [(p[0] - cx * p[2]) / f, (p[1] - cy * p[2]) / f, p[2]];
  let r1 = norm(Kinv(vx));
  if (r1[0] < 0) r1 = scale(r1, -1); // 오른쪽이 +X
  const dz = Kinv(vz);
  let r3 = norm(sub(dz, scale(r1, dot(dz, r1))));
  if (r3[2] < 0) r3 = scale(r3, -1); // 카메라에서 벽 쪽이 +
  let r2 = cross(r3, r1);
  if (r2[1] < 0) r2 = scale(r2, -1); // 아래가 +
  const mid = (pr) => ({ x: (pr[0].x + pr[1].x) / 2, y: (pr[0].y + pr[1].y) / 2 });
  const d = Kinv(P(mid(g.backFloor)));
  const dc = Kinv(P(mid(g.backCeiling)));
  if (!(dot(d, r2) > 0) || !(dot(dc, r2) < 0)) return null; // 바닥선이 눈높이 아래, 천장선이 위여야
  const a = dot(d, r3) / dot(d, r2);
  const b = dot(dc, r3) / dot(dc, r2);
  const hf = (-wallH * b) / (a - b); // 카메라 높이(바닥에서)
  const D = hf * a; // 뒷벽까지 거리
  if (!(hf > 500 && hf < 2200 && D > 700 && D < 9000)) return null;
  // 바닥선 위 픽셀 → 벽을 따라 X(mm)
  const floorX = (p) => {
    const dq = Kinv(P(p));
    const t = hf / dot(dq, r2);
    return dot(scale(dq, t), r1);
  };
  const edgeFloor = (xPx) => {
    // 뒷벽 바닥선과 사진 가장자리 세로선의 교점
    const e = cross(bf, [1, 0, -xPx]);
    return { x: e[0] / e[2] / W, y: e[1] / e[2] / H };
  };
  const xL = floorX(g.leftEnd ? g.leftEnd.floor : edgeFloor(0));
  const xR = floorX(g.rightEnd ? g.rightEnd.floor : edgeFloor(W));
  if (!(xR - xL > 900 && xR - xL < 9000)) return null;
  /** 세계(X: 벽을 따라 mm, h: 바닥에서 높이 mm, z: 뒷벽에서 카메라 쪽 mm) → 픽셀 */
  const project = (X, h, z) => {
    const c = add(scale(r1, X), scale(r2, hf - h), scale(r3, D - z));
    return { x: (f * c[0]) / c[2] + cx, y: (f * c[1]) / c[2] + cy, depth: c[2] };
  };
  const camOf = (X, h, z) => add(scale(r1, X), scale(r2, hf - h), scale(r3, D - z));
  return {
    f, cx, cy, r1, r2, r3, hf, D, xL, xR, wallH,
    leftOpen: !(g.leftEnd && g.leftEnd.sideWall) && !!g.leftEnd,
    rightOpen: !(g.rightEnd && g.rightEnd.sideWall) && !!g.rightEnd,
    project, camOf,
  };
}

// ─── 3. 싱크대 상자 ───

/** 다담 표준 (mm): 걸레받이 150, 하부장 높이 850(상판 아래), 상판 30, 하부 깊이 600, 상판 650, 상부 350 */
export const KITCHEN_DIMS = {
  plinthH: 150, plinthSet: 50, lowerTop: 850, topT: 30, lowerD: 600, topD: 650,
  upperBottom: 1500, upperD: 350, moduleW: 600, upperDoorW: 500,
};

/**
 * 칠할 면 목록(뒤에서 앞 순서). 각 면은 세계 좌표 사각형 + 밝기 + 종류.
 * @param {object} cam solveKitchenCamera 결과
 * @param {{waterPct?:number, exhaustPct?:number}} [o]
 */
export function kitchenFaces(cam, o = {}) {
  const K = KITCHEN_DIMS;
  const L = cam.xL;
  const R = cam.xR;
  const Htop = cam.wallH; // 상부장은 천장까지
  const faces = [];
  const quadX = (X, h0, h1, z0, z1) => [[X, h0, z0], [X, h0, z1], [X, h1, z1], [X, h1, z0]]; // X 고정 면
  const quadZ = (z, X0, X1, h0, h1) => [[X0, h1, z], [X1, h1, z], [X1, h0, z], [X0, h0, z]]; // 앞면
  const quadH = (h, X0, X1, z0, z1) => [[X0, h, z0], [X1, h, z0], [X1, h, z1], [X0, h, z1]]; // 수평면
  const push = (pts, shade, kind, normal) => faces.push({ pts, shade, kind, normal });
  // 상부장: 아랫면 → 끝면 → 앞면
  push(quadH(K.upperBottom, L, R, 0, K.upperD), 0.72, 'upper-bottom', [0, -1, 0]);
  if (cam.leftOpen) push(quadX(L, K.upperBottom, Htop, 0, K.upperD), 0.86, 'upper-end', [-1, 0, 0]);
  if (cam.rightOpen) push(quadX(R, K.upperBottom, Htop, 0, K.upperD), 0.86, 'upper-end', [1, 0, 0]);
  push(quadZ(K.upperD, L, R, K.upperBottom, Htop), 0.98, 'upper-front', [0, 0, 1]);
  // 하부장: 끝면 → 걸레받이 → 앞면 → 상판 윗면 → 상판 앞 모서리 → 상판 끝
  const top = K.lowerTop + K.topT;
  if (cam.leftOpen) push(quadX(L, 0, top, 0, K.topD), 0.86, 'lower-end', [-1, 0, 0]);
  if (cam.rightOpen) push(quadX(R, 0, top, 0, K.topD), 0.86, 'lower-end', [1, 0, 0]);
  push(quadZ(K.lowerD - K.plinthSet, L, R, 0, K.plinthH), 0.5, 'plinth', [0, 0, 1]);
  push(quadZ(K.lowerD, L, R, K.plinthH, K.lowerTop), 0.96, 'lower-front', [0, 0, 1]);
  push(quadH(top, L, R, 0, K.topD), 0.88, 'counter-top', [0, 1, 0]);
  push(quadZ(K.topD, L, R, K.lowerTop, top), 0.8, 'counter-edge', [0, 0, 1]);
  // 개수대·쿡탑 (상판 위)
  const span = R - L;
  const at = (pct, fallback) => L + (span * (Number.isFinite(pct) ? pct : fallback)) / 100;
  const sinkX = at(o.waterPct, 30);
  const cookX = at(o.exhaustPct, 70);
  push(quadH(top + 1, sinkX - 400, sinkX + 400, 100, 520), 0.42, 'sink', [0, 1, 0]);
  push(quadH(top + 1, cookX - 300, cookX + 300, 80, 600), 0.14, 'cooktop', [0, 1, 0]);
  // 문짝 틈 (얇은 상자 면) — 원근이 저절로 맞는다
  const gap = 3;
  const lowerN = Math.max(1, Math.round(span / K.moduleW));
  for (let i = 1; i < lowerN; i++) {
    const X = L + (span * i) / lowerN;
    push(quadZ(K.lowerD + 0.5, X - gap, X + gap, K.plinthH, K.lowerTop), 0.45, 'gap', [0, 0, 1]);
  }
  // 쿡탑 아래 두 단 서랍
  push(quadZ(K.lowerD + 0.5, cookX - 300, cookX + 300, 498, 504), 0.45, 'gap', [0, 0, 1]);
  const upperN = Math.max(1, Math.round(span / K.upperDoorW));
  for (let i = 1; i < upperN; i++) {
    const X = L + (span * i) / upperN;
    push(quadZ(K.upperD + 0.5, X - gap, X + gap, K.upperBottom, Htop), 0.45, 'gap', [0, 0, 1]);
  }
  // 보이지 않는 면(뒷면) 버리기 — 카메라에서 면 바깥쪽이 보일 때만
  return faces.filter((fc) => {
    if (fc.kind !== 'upper-end' && fc.kind !== 'lower-end') return true;
    const c = cam.camOf(...fc.pts[0]);
    const n = add(scale(cam.r1, fc.normal[0]), scale(cam.r3, -fc.normal[2]), scale(cam.r2, -fc.normal[1]));
    return dot(scale(c, -1), n) > 0;
  });
}

/** 면 → 픽셀 다각형 */
export function projectFaces(cam, faces) {
  return faces.map((fc) => ({ ...fc, poly: fc.pts.map(([X, h, z]) => cam.project(X, h, z)) }));
}

const PANEL = [236, 234, 229];

/** 볼록 다각형 칠하기 (img: {width,height,rgb}) */
export function fillPolygon(img, poly, rgb) {
  const { width: W, height: H } = img;
  if (poly.some((p) => !(p.depth > 0))) return; // 카메라 뒤
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  const n = poly.length;
  // 감김 방향
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const sgn = area >= 0 ? 1 : -1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = true;
      for (let i = 0; i < n && inside; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        if (sgn * ((b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x)) < 0) inside = false;
      }
      if (!inside) continue;
      const o = (y * W + x) * 3;
      img.rgb[o] = rgb[0]; img.rgb[o + 1] = rgb[1]; img.rgb[o + 2] = rgb[2];
    }
  }
}

/**
 * 방 사진(JPEG) 원본 해상도에 싱크대 덩어리를 합성한 PNG. 카메라가 안 풀리면 null.
 * @returns {Promise<{base64, mimeType:'image/png', width, height, mask:Array<Array<{x,y}>>, cam:object}|null>}
 *   mask = 칠한 면들의 0~1 다각형 (추천안 되붙이기용)
 */
export async function renderKitchenMassing(room, points, o = {}) {
  if (!room || room.mimeType !== 'image/jpeg' || !points) return null;
  const decoded = decodeJpeg(b64ToBytes(room.base64), { useTArray: true, formatAsRGBA: true });
  const img = downscale(decoded, Infinity);
  const cam = solveKitchenCamera(points, img.width, img.height, { wallH: o.wallH, focalMm: o.focalMm });
  if (!cam) return null;
  const faces = projectFaces(cam, kitchenFaces(cam, o));
  // 말이 안 되는 투영(사진 밖으로 크게)이면 버린다
  const big = faces.filter((fc) => fc.kind === 'lower-front' || fc.kind === 'upper-front');
  const ok = big.every((fc) => fc.poly.every((p) => p.depth > 0 && p.x > -img.width && p.x < 2 * img.width && p.y > -img.height && p.y < 2 * img.height));
  if (!ok) return null;
  for (const fc of faces) {
    const k = fc.shade;
    fillPolygon(img, fc.poly, [Math.min(255, PANEL[0] * k), Math.min(255, PANEL[1] * k), Math.min(255, PANEL[2] * k)]);
  }
  const png = await encodePng(img);
  const mask = faces
    .filter((fc) => fc.kind !== 'gap')
    .map((fc) => fc.poly.map((p) => ({ x: p.x / img.width, y: p.y / img.height })));
  return { base64: bytesToB64(png), mimeType: 'image/png', width: img.width, height: img.height, mask, cam: { f: cam.f, hf: cam.hf, D: cam.D, xL: cam.xL, xR: cam.xR } };
}
