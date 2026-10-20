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
 * 일자(또는 모양 모름)이고 꺾인 벽(walls[])이 없을 때만 — 런은 왼쪽 모서리에 붙는다 (buildPlannerPrompt runAnchor 'left').
 */

import { DESIGN_SECTIONS, isHoodCell, plannerLayout, plannerWalls } from './prompts.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (...vs) => vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

/**
 * design_spec → 칠할 줄 덩어리 (mm, 런 왼쪽 끝 기준). 칠할 수 없는 도면이면 null.
 * @returns {{runMm:number, blocks:{key:string, x0:number, x1:number, bottom:number, top:number, depth:number, cuts:number[], holes:number[][]}[]}|null}
 */
export function plannerPlaceBlocks(spec) {
  if (!spec || typeof spec !== 'object') return null;
  if (plannerWalls(spec).length) return null;
  const layout = plannerLayout(spec);
  if (layout && layout.shape !== 'straight') return null;
  const sections = spec.sections && typeof spec.sections === 'object' ? spec.sections : {};
  const keys = DESIGN_SECTIONS.filter(
    (k) => sections[k] && Array.isArray(sections[k].modules) && sections[k].modules.length
  );
  if (!keys.length) return null;
  const anchored = !!spec.ceilingMm || keys.some((k) => sections[k].fromFloorMm !== undefined);
  const blocks = [];
  for (const k of keys) {
    const sec = sections[k];
    const width = sec.widthMm || sec.modules.reduce((n, m) => n + (m.widthMm || 0), 0);
    const bottom =
      sec.fromFloorMm !== undefined ? sec.fromFloorMm : anchored && k !== 'upper' ? 0 : null;
    if (!(width > 0) || !(sec.heightMm > 0) || !(sec.depthMm > 0) || bottom === null) continue;
    const x0 = sec.fromLeftMm || 0;
    const cuts = [];
    const holes = [];
    let x = x0;
    sec.modules.forEach((m, i) => {
      const w = m.widthMm || 0;
      if (isHoodCell(m)) holes.push([x, x + w]); // 후드 칸은 장이 아니다 — 비워 둔다
      x += w;
      if (i < sec.modules.length - 1) cuts.push(x);
    });
    blocks.push({
      key: k,
      x0,
      x1: x0 + width,
      bottom,
      top: bottom + sec.heightMm,
      depth: sec.depthMm,
      cuts,
      holes,
    });
  }
  if (!blocks.length) return null;
  const runMm = spec.wallRunMm || Math.max(...blocks.map((b) => b.x1));
  return { runMm, blocks };
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

/**
 * 풀린 카메라(kitchen.js solveKitchenCamera) 위의 면 목록 — kitchenFaces 와 같은 모양, 먼 면부터.
 * @param {object} cam
 * @param {{runMm:number, blocks:object[]}} place plannerPlaceBlocks 결과
 */
export function plannerPlaceFaces(cam, place) {
  if (!cam || !place) return [];
  const wall = cam.xR - cam.xL;
  const s = place.runMm > wall ? wall / place.runMm : 1; // 사진이 이긴다
  const X = (x) => cam.xL + x * s;
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
