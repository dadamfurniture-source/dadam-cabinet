/**
 * 플래너 도면 덩어리 (2026-10-20, 연구 보고서 /mnt/project-files/imggen-composite-research/).
 *
 * 플래너 연출컷은 방 사진 + 정면 입면 + 글만으로 그리면 줄 길이를 늘린다 (싱크대 26건 실측: 일자 15장 중 14장이
 * 하부장 오른끝을 도면보다 오른쪽으로, 중앙 +223 mm). 싱크대 연출컷의 덩어리 합성(kitchen.js)과 같은 카메라 풀기로
 * 도면의 실제 줄(폭·높이·깊이·바닥 높이·왼쪽 끝)을 사진에 무광 판으로 칠해 편집 대상으로 준다 — 형태·개수는 여전히
 * 입면과 글이 말하고, 덩어리는 자리와 크기만 잡는다.
 *
 * 값은 전부 design_spec 에서 읽는다. depthMm 이 없거나 바닥 높이를 모르는 줄(fromFloorMm 없는 상부장, 높이 기준이
 * 하나도 없는 도면)은 칠하지 않는다 — prompts.js plannerHeights 와 같은 규칙. 런이 사진의 벽보다 넓으면 사진이 이긴다
 * (design-spec-prompt.md "벽보다 넓은 런") — 줄을 같은 비율로 줄여 맞춘다.
 * 일자(또는 모양 모름)이고 꺾인 벽(walls[])이 없으면 — 런은 왼쪽 모서리에 붙는다 (buildPlannerPrompt runAnchor 'left').
 *
 * 2026-10-20: ㄱ자·ㄷ자 (꺾인 벽 walls[], o.corners 일 때만 — 스위치 PLANNER_PLACE_CORNERS). 꺾인 줄은 제 옆벽에 붙어
 *   모서리(주벽 면, fromCornerMm 0)에서 방 쪽으로 간다 (buildPlannerCornerLayout "along its side wall"). 주벽 줄이 붙는 끝은
 *   buildPlannerPrompt runAnchor 와 같다 — 왼쪽 꺾인 벽이 있으면 왼쪽 모서리(주벽 좌표 0 = 모든 모듈의 왼쪽 끝 = 왼쪽 벽 면,
 *   js/planner/ai-photo.js), 오른쪽만 꺾였으면 주벽 바닥 줄이 오른쪽 모서리까지 갈 때(corner 'main')만 그 끝이 오른쪽 벽 면.
 *   그 밖(오른쪽만 꺾이고 corner 'return'·'open', 펴진 ㄱ자·ㄷ자)은 자리를 몰라 칠하지 않는다.
 *   사진에서 그 옆벽이 보여야 한다(선 찾기 left_end/right_end side_wall) — 안 보이면 칠하지 않는다.
 */

import { DESIGN_SECTIONS, isHoodCell, plannerLayout, plannerWalls } from './prompts.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (...vs) => vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

/** 한 벽의 sections → 줄 덩어리. pos = 자리 필드 (주벽 fromLeftMm, 꺾인 벽 fromCornerMm). */
function rowBlocks(sections, pos, anchored, wall) {
  const keys = DESIGN_SECTIONS.filter(
    (k) => sections[k] && Array.isArray(sections[k].modules) && sections[k].modules.length
  );
  const blocks = [];
  for (const k of keys) {
    const sec = sections[k];
    const width = sec.widthMm || sec.modules.reduce((n, m) => n + (m.widthMm || 0), 0);
    const bottom =
      sec.fromFloorMm !== undefined ? sec.fromFloorMm : anchored && k !== 'upper' ? 0 : null;
    if (!(width > 0) || !(sec.heightMm > 0) || !(sec.depthMm > 0) || bottom === null) continue;
    const x0 = sec[pos] || 0;
    const cuts = [];
    const holes = [];
    let x = x0;
    sec.modules.forEach((m, i) => {
      const w = m.widthMm || 0;
      if (isHoodCell(m)) holes.push([x, x + w]); // 후드 칸은 장이 아니다 — 비워 둔다
      x += w;
      if (i < sec.modules.length - 1) cuts.push(x);
    });
    const b = {
      key: k,
      x0,
      x1: x0 + width,
      bottom,
      top: bottom + sec.heightMm,
      depth: sec.depthMm,
      cuts,
      holes,
    };
    if (wall) b.wall = wall;
    blocks.push(b);
  }
  return blocks;
}

/** 바닥 줄(하부, 없으면 키큰장) — buildPlannerPrompt plannerCornerUnit 과 같은 고르기 */
const floorRow = (blocks) =>
  blocks.find((b) => b.key === 'lower') || blocks.find((b) => b.key === 'tall') || null;

/**
 * design_spec → 칠할 줄 덩어리 (mm). 칠할 수 없는 도면이면 null.
 *   blocks: 주벽 줄 (런 왼쪽 끝 기준 x). 꺾인 벽이 있으면 returns: 그 벽 줄 (wall 'left'|'right', 모서리에서 잰 x),
 *   anchor: 주벽 줄이 붙는 벽 끝, rightMm: anchor 'right' 일 때 오른쪽 벽 면의 주벽 좌표.
 * @param {object} spec
 * @param {{corners?:boolean}} [o] corners — ㄱ자·ㄷ자(walls[])도 칠한다 (스위치 PLANNER_PLACE_CORNERS)
 * @returns {{runMm:number, anchor?:'left'|'right', rightMm?:number, blocks:object[], returns?:object[]}|null}
 */
export function plannerPlaceBlocks(spec, o = {}) {
  if (!spec || typeof spec !== 'object') return null;
  const walls = plannerWalls(spec);
  const layout = plannerLayout(spec);
  if (walls.length) {
    if (!o.corners || (layout && layout.shape === 'straight')) return null;
  } else if (layout && layout.shape !== 'straight') return null;
  const sections = spec.sections && typeof spec.sections === 'object' ? spec.sections : {};
  const all = [sections, ...walls.map((w) => w.sections)];
  const anchored =
    !!spec.ceilingMm ||
    all.some((secs) => DESIGN_SECTIONS.some((k) => secs[k] && secs[k].fromFloorMm !== undefined));
  const blocks = rowBlocks(sections, 'fromLeftMm', anchored);
  if (!walls.length) {
    if (!blocks.length) return null;
    const runMm = spec.wallRunMm || Math.max(...blocks.map((b) => b.x1));
    return { runMm, blocks };
  }
  // ── ㄱ자·ㄷ자 ──
  const left = walls.find((w) => w.side === 'left');
  const right = walls.find((w) => w.side === 'right');
  let anchor = null;
  let rightMm;
  if (left) anchor = 'left';
  else if (right && right.corner === 'main') {
    const f = floorRow(blocks);
    if (f) {
      anchor = 'right';
      rightMm = f.x1;
    }
  }
  if (!anchor) return null;
  const returns = walls.flatMap((w) => rowBlocks(w.sections, 'fromCornerMm', anchored, w.side));
  if (!blocks.length && !returns.length) return null;
  const runMm =
    anchor === 'right'
      ? rightMm
      : spec.wallRunMm || (blocks.length ? Math.max(...blocks.map((b) => b.x1)) : 0);
  return { runMm, anchor, ...(anchor === 'right' ? { rightMm } : {}), blocks, returns };
}

/** [x0, x1] 에서 holes 를 뺀 구간들 */
function spans(x0, x1, holes) {
  const out = [];
  let a = x0;
  for (const [h0, h1] of holes.slice().sort((p, q) => p[0] - q[0])) {
    if (h0 > a) out.push([a, Math.min(h0, x1)]);
    a = Math.max(a, h1);
  }
  if (a < x1) out.push([a, x1]);
  return out.filter(([p, q]) => q - p > 1);
}

const quadX = (x, h0, h1, z0, z1) => [
  [x, h0, z0],
  [x, h0, z1],
  [x, h1, z1],
  [x, h1, z0],
];
const quadZ = (z, x0, x1, h0, h1) => [
  [x0, h1, z],
  [x1, h1, z],
  [x1, h0, z],
  [x0, h0, z],
];
const quadH = (h, x0, x1, z0, z1) => [
  [x0, h, z0],
  [x1, h, z0],
  [x1, h, z1],
  [x0, h, z1],
];

/**
 * 꺾인 줄 앞면이 사진 안(renderFacesMassing 의 "말이 안 되는 투영" 검사 안쪽)에 머무는 가장 먼 z.
 * 꺾인 줄은 카메라 쪽으로 오므로 사진 밖으로 나가는 앞쪽 끝을 자른다. z0 에서부터 안 되면 null.
 */
function returnClipZ(cam, xf, b) {
  const W = 2 * cam.cx,
    H = 2 * cam.cy;
  const inside = (z) =>
    [b.bottom, b.top].every((h) => {
      const p = cam.project(xf, h, z);
      return p.depth > 100 && p.x > -0.9 * W && p.x < 1.9 * W && p.y > -0.9 * H && p.y < 1.9 * H;
    });
  if (!inside(b.x0)) return null;
  if (inside(b.x1)) return b.x1;
  let lo = b.x0,
    hi = b.x1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * 풀린 카메라(kitchen.js solveKitchenCamera) 위의 면 목록 — kitchenFaces 와 같은 모양, 먼 면부터.
 * @param {object} cam
 * @param {{runMm:number, anchor?:string, rightMm?:number, blocks:object[], returns?:object[]}} place plannerPlaceBlocks 결과
 */
export function plannerPlaceFaces(cam, place) {
  if (!cam || !place) return [];
  const returns = place.returns || [];
  // ㄱ자·ㄷ자: 꺾인 줄이 붙을 옆벽, 주벽 줄이 붙을 끝이 사진에 보여야 한다
  if (returns.some((b) => !(b.wall === 'left' ? cam.leftWall : cam.rightWall))) return [];
  if (place.anchor === 'left' && place.returns && !cam.leftWall) return [];
  if (place.anchor === 'right' && !cam.rightWall) return [];
  const wall = cam.xR - cam.xL;
  const s = place.runMm > wall ? wall / place.runMm : 1; // 사진이 이긴다
  const X =
    place.anchor === 'right' ? (x) => cam.xR - (place.rightMm - x) * s : (x) => cam.xL + x * s;
  const faces = [];
  const push = (pts, shade, kind, normal) => faces.push({ pts, shade, kind, normal });
  for (const b of place.blocks) {
    for (const [a0, a1] of spans(b.x0, b.x1, b.holes)) {
      const x0 = X(a0),
        x1 = X(a1);
      if (b.bottom > 0) push(quadH(b.bottom, x0, x1, 0, b.depth), 0.72, 'bottom', [0, -1, 0]);
      push(quadH(b.top, x0, x1, 0, b.depth), 0.88, 'top', [0, 1, 0]);
      push(quadX(x0, b.bottom, b.top, 0, b.depth), 0.86, 'end', [-1, 0, 0]);
      push(quadX(x1, b.bottom, b.top, 0, b.depth), 0.86, 'end', [1, 0, 0]);
      push(quadZ(b.depth, x0, x1, b.bottom, b.top), 0.96, 'front', [0, 0, 1]);
      // 모듈 경계 — 얇은 띠라 원근이 저절로 맞는다 (kitchenFaces 의 문짝 틈과 같은 그리기)
      for (const c of b.cuts) {
        if (c <= a0 || c >= a1) continue;
        push(quadZ(b.depth + 0.5, X(c) - 3, X(c) + 3, b.bottom, b.top), 0.45, 'gap', [0, 0, 1]);
      }
    }
  }
  // 꺾인 줄 — 옆벽 면(xL·xR)에서 깊이만큼 방 안쪽, 모서리(z 0)에서 방 쪽(z +)으로. 옆벽을 따라서는 줄이지 않는다.
  for (const b of returns) {
    const sg = b.wall === 'left' ? 1 : -1;
    const xw = b.wall === 'left' ? cam.xL : cam.xR; // 벽 면
    const xf = xw + sg * b.depth; // 앞면
    const zc = returnClipZ(cam, xf, b);
    if (zc === null) continue;
    const [xa, xb] = sg > 0 ? [xw, xf] : [xf, xw];
    for (const [a0, a10] of spans(b.x0, b.x1, b.holes)) {
      if (a0 >= zc) continue;
      const a1 = Math.min(a10, zc);
      if (b.bottom > 0) push(quadH(b.bottom, xa, xb, a0, a1), 0.72, 'bottom', [0, -1, 0]);
      push(quadH(b.top, xa, xb, a0, a1), 0.88, 'top', [0, 1, 0]);
      push(quadZ(a0, xa, xb, b.bottom, b.top), 0.86, 'end', [0, 0, -1]);
      if (a1 === a10) push(quadZ(a1, xa, xb, b.bottom, b.top), 0.86, 'end', [0, 0, 1]); // 잘린 끝은 끝면이 아니다
      push(quadX(xf, b.bottom, b.top, a0, a1), 0.96, 'front', [sg, 0, 0]);
      for (const c of b.cuts) {
        if (c <= a0 || c >= a1) continue;
        push(quadX(xf + sg * 0.5, b.bottom, b.top, c - 3, c + 3), 0.45, 'gap', [sg, 0, 0]);
      }
    }
  }
  // 카메라 쪽을 보는 면만, 먼 것부터 (덩어리가 볼록하고 서로 겹치지 않아 이 순서로 충분하다)
  const depthOf = (fc) => fc.pts.reduce((n, p) => n + cam.camOf(...p)[2], 0) / fc.pts.length;
  return faces
    .filter((fc) => {
      const c = cam.camOf(...fc.pts[0]);
      const n = add(
        scale(cam.r1, fc.normal[0]),
        scale(cam.r3, -fc.normal[2]),
        scale(cam.r2, -fc.normal[1])
      );
      return dot(scale(c, -1), n) > 0;
    })
    .map((fc) => ({ fc, d: depthOf(fc) - (fc.kind === 'gap' ? 1e6 : 0) }))
    .sort((p, q) => q.d - p.d)
    .map((p) => p.fc);
}
