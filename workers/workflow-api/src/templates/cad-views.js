/**
 * 모듈 제작도 — 3면도(정면 · 측면 · 평면) + 등각, CAD 식 (2026-11-21 사장님 「조립 도면 및 상판 도면은 캐드 스킬 등을 사용해서 정확하게 표현」 ·
 *   질문 창 「3D 등각 + 3면도」).
 *
 * 그림은 동결본 조립 명세(bom_payload.assembly, dadam.assembly/1)만 쓴다 — 판 자리 · 따내기 · 철물 자리를 새로 만들지 않는다.
 *   판 = 재단면 frame + cut + 두께, 따내기(notch)는 판에서 뺀다 (엔진 bom-assembly.js solidsOf 와 같은 셈 — 겹치지 않는 상자 여럿).
 *   배치 = 3각법: 평면도는 정면도 위, 우측면도는 정면도 오른쪽, 등각은 오른쪽 위.
 *   정투영의 가림 = 보는 쪽 깊이 순서 (겹치지 않는 상자는 그림이 겹치면 보는 축으로 떨어져 있다 — 앞 상자가 뒤를 가린다).
 *   숨은선 = 모든 판 외곽을 가는 점선으로 한 번 더 (보이는 선은 실선이 덮는다). 도어 · 서랍 앞판은 일점쇄선(속이 보이게).
 *   등각의 가림 = 상자끼리 앞뒤(떨어진 축)로 위상 정렬.
 *   치수 = 연장선 · 화살표 · 치수선 위 글자, 연속 치수 (전면 높이 · 문 폭 · 다리발 · 몸통 · 선반 · 따내기 · 도어 앞).
 *   축척 = 그림 전체가 종이(CAD.PAGE_W_MM × CAD.PAGE_H_MM)에 드는 가장 작은 표준 축척 — svg 폭을 mm 로 적어 인쇄하면 그 축척 그대로다.
 *   글자 · 선 굵기는 종이 mm 로 정한다 (CAD.TEXT_MM 등 — 그림용 값).
 * 철물: 다리발(상자) · 레일(측면도 · 평면도에 길이 선, 정면도에 자리 표시) · 경첩 컵(정면도 원 — 도어 뒤라 가는 선).
 */
import { esc, num } from './html.js';

export const CAD = Object.freeze({
  SCALES: Object.freeze([5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100]),
  PAGE_W_MM: 186,
  PAGE_H_MM: 176,
  TEXT_MM: 2.6,
  TITLE_MM: 3.0,
  LINE_MM: 0.35,
  THIN_MM: 0.18,
  GAP_MM: 8,
});

const AX = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
const FRONT_RE = /^(도어|서랍도어)$/;
const SHELF_RE = /^선반/;
const f1 = (v) => (Math.round(v * 10) / 10).toString();

function pointOf(frame, u, v, n) {
  const U = AX[frame.u], V = AX[frame.v], N = AX[frame.n];
  return [0, 1, 2].map((i) => frame.o[i] + U[i] * u + V[i] * v + N[i] * n);
}

/**
 * 판 → 겹치지 않는 상자들 (관통 따내기를 뺀다) — 엔진 bom-assembly.js solidsOf 와 같은 셈.
 *   frame · cut · t 가 없으면 box 하나.
 * @returns {Array<{min:number[], max:number[]}>}
 */
export function solidsOfPart(p) {
  const box = p && p.box && Array.isArray(p.box.min) && Array.isArray(p.box.max) ? { min: p.box.min.map(Number), max: p.box.max.map(Number) } : null;
  const fr = p && p.frame;
  const w = Number(p && p.cut && p.cut.w), h = Number(p && p.cut && p.cut.h), t = Number(p && p.t);
  if (!fr || !AX[fr.u] || !AX[fr.v] || !AX[fr.n] || !Array.isArray(fr.o) || !(w > 0) || !(h > 0) || !(t > 0)) return box ? [box] : [];
  const notches = (Array.isArray(p.features) ? p.features : []).filter((f) => f && f.type === 'notch')
    .map((f) => ({ u0: Number(f.u0), u1: Number(f.u1), v0: Number(f.v0), v1: Number(f.v1) }))
    .filter((f) => [f.u0, f.u1, f.v0, f.v1].every(Number.isFinite));
  const us = [...new Set([0, w].concat(...notches.map((f) => [f.u0, f.u1])))].filter((u) => u >= 0 && u <= w).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < us.length; i++) {
    const u0 = us[i], u1 = us[i + 1], um = (u0 + u1) / 2;
    const cuts = notches.filter((f) => f.u0 < um && um < f.u1).map((f) => [f.v0, f.v1]).sort((a, b) => a[0] - b[0]);
    let v = 0;
    const spans = [];
    cuts.forEach(([a, b]) => { if (a > v) spans.push([v, a]); v = Math.max(v, b); });
    if (v < h) spans.push([v, h]);
    spans.forEach(([v0, v1]) => {
      const a = pointOf(fr, u0, v0, 0), b = pointOf(fr, u1, v1, t);
      out.push({ min: [0, 1, 2].map((k) => Math.min(a[k], b[k])), max: [0, 1, 2].map((k) => Math.max(a[k], b[k])) });
    });
  }
  return out.length ? out : box ? [box] : [];
}

/** 명세 모듈 → 그릴 것 { parts[{name, front, leg, shelf, solids}], rails[], hinges[], notches[] } */
export function cadModelOf(mod) {
  const parts = [];
  for (const p of Array.isArray(mod && mod.parts) ? mod.parts : []) {
    const solids = solidsOfPart(p).filter((s) => [...s.min, ...s.max].every(Number.isFinite));
    if (!solids.length) continue;
    parts.push({ name: String(p.part || ''), front: FRONT_RE.test(String(p.part || '')), shelf: SHELF_RE.test(String(p.part || '')), leg: false, solids, src: p });
  }
  const rails = [], hinges = [];
  for (const h of Array.isArray(mod && mod.hardware) ? mod.hardware : []) {
    if (!h || !Array.isArray(h.at) || h.at.some((v) => !Number.isFinite(Number(v)))) continue;
    const at = h.at.map(Number);
    if (h.kind === 'leg' && Array.isArray(h.size) && h.size.every((v) => Number(v) > 0)) {
      const [sx, sy, sz] = h.size.map(Number);
      parts.push({ name: '다리발', front: false, shelf: false, leg: true, solids: [{ min: [at[0] - sx / 2, at[1], at[2] - sz / 2], max: [at[0] + sx / 2, at[1] + sy, at[2] + sz / 2] }] });
    } else if (h.kind === 'rail' && Number(h.len) > 0) {
      rails.push({ at, len: Number(h.len), t: Number(h.thickness) || 0 });
    } else if (h.kind === 'hinge' && Number(h.cupD) > 0) {
      hinges.push({ at, d: Number(h.cupD) });
    }
  }
  return { parts, rails, hinges };
}

// ── 투영 ─────────────────────────────────────────────────────────
//   그림 좌표 (sx 오른쪽, sy 아래) + 깊이 d (클수록 보는 사람 쪽)
const VIEWS = {
  front: (x, y, z) => [x, -y, z],
  side: (x, y, z) => [-z, -y, x],      // 오른쪽에서 — 앞(+z)이 왼쪽
  top: (x, y, z) => [x, z, y],         // 위에서 — 앞(+z)이 아래 (정면도 쪽)
};
const ISO_C = Math.cos(Math.PI / 6);
const isoP = (x, y, z) => [(x - z) * ISO_C, (x + z) * 0.5 - y];

function rectOf(view, s) {
  const P = VIEWS[view];
  const c = [];
  for (const x of [s.min[0], s.max[0]]) for (const y of [s.min[1], s.max[1]]) for (const z of [s.min[2], s.max[2]]) c.push(P(x, y, z));
  return { x0: Math.min(...c.map((q) => q[0])), x1: Math.max(...c.map((q) => q[0])), y0: Math.min(...c.map((q) => q[1])), y1: Math.max(...c.map((q) => q[1])), d: Math.max(...c.map((q) => q[2])) };
}

/**
 * 직사각형 합집합의 외곽 선분 — 칸 격자로 덮인 칸 · 안 덮인 칸 사이 변만.
 * @param {Array<{x0,x1,y0,y1}>} rects @returns {Array<[number,number,number,number]>} [x0,y0,x1,y1]
 */
export function unionEdges(rects) {
  const E = 1e-6;
  const rs = rects.filter((r) => r.x1 - r.x0 > E && r.y1 - r.y0 > E);
  if (!rs.length) return [];
  const xs = [...new Set(rs.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(rs.flatMap((r) => [r.y0, r.y1]))].sort((a, b) => a - b);
  const cov = (i, j) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false;
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    return rs.some((r) => r.x0 < cx && cx < r.x1 && r.y0 < cy && cy < r.y1);
  };
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    const c = cov(i, j);
    if (c !== cov(i, j - 1)) out.push([xs[i], ys[j], xs[i + 1], ys[j]]);
    if (c !== cov(i - 1, j)) out.push([xs[i], ys[j], xs[i], ys[j + 1]]);
    if (j === ys.length - 2 && c) out.push([xs[i], ys[j + 1], xs[i + 1], ys[j + 1]]);
    if (i === xs.length - 2 && c) out.push([xs[i + 1], ys[j], xs[i + 1], ys[j + 1]]);
  }
  return mergeSegs(out);
}

/** 한 줄로 이어지는 선분을 합친다 */
function mergeSegs(segs) {
  const key = (s) => (s[1] === s[3] ? `h${s[1]}` : `v${s[0]}`);
  const groups = new Map();
  segs.forEach((s) => { const k = key(s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); });
  const out = [];
  groups.forEach((list, k) => {
    const hz = k[0] === 'h';
    const iv = list.map((s) => (hz ? [Math.min(s[0], s[2]), Math.max(s[0], s[2])] : [Math.min(s[1], s[3]), Math.max(s[1], s[3])])).sort((a, b) => a[0] - b[0]);
    const c = hz ? list[0][1] : list[0][0];
    let cur = iv[0].slice();
    for (let i = 1; i <= iv.length; i++) {
      if (i < iv.length && iv[i][0] <= cur[1] + 1e-6) { cur[1] = Math.max(cur[1], iv[i][1]); continue; }
      out.push(hz ? [cur[0], c, cur[1], c] : [c, cur[0], c, cur[1]]);
      if (i < iv.length) cur = iv[i].slice();
    }
  });
  return out;
}

const segInRect = (s, r) => {
  const E = 1e-6;
  return Math.min(s[0], s[2]) >= r.x0 - E && Math.max(s[0], s[2]) <= r.x1 + E && Math.min(s[1], s[3]) >= r.y0 - E && Math.max(s[1], s[3]) <= r.y1 + E;
};

// ── svg 조각 ──────────────────────────────────────────────────────

function line(s, sw, extra) {
  return `<line x1="${f1(s[0])}" y1="${f1(s[1])}" x2="${f1(s[2])}" y2="${f1(s[3])}" stroke-width="${f1(sw)}"${extra || ''}/>`;
}

/**
 * 정투영 하나 — 판(겹치지 않는 상자)을 먼 것부터 칠하고 그 판의 외곽 실선을 같이, 위에 숨은선 점선 · 도어 일점쇄선.
 * @returns {{svg:string, bounds:{x0,x1,y0,y1}, rects:object[]}}
 */
function orthoView(model, view, k) {
  const pieces = [];   // {r, part}
  const edgesOfPart = new Map();
  model.parts.forEach((part, pi) => {
    const rs = part.solids.map((s) => rectOf(view, s));
    rs.forEach((r) => pieces.push({ r, part, pi }));
    edgesOfPart.set(pi, unionEdges(rs));
  });
  const all = pieces.map((p) => p.r);
  const bounds = {
    x0: Math.min(...all.map((r) => r.x0)), x1: Math.max(...all.map((r) => r.x1)),
    y0: Math.min(...all.map((r) => r.y0)), y1: Math.max(...all.map((r) => r.y1)),
  };
  const solidP = pieces.filter((p) => !p.part.front).sort((a, b) => a.r.d - b.r.d);
  // 판 외곽 선분은 그 선분을 품은 조각 가운데 가장 가까운 것과 같이 긋는다 (같은 판의 앞 조각 칠에 덮이지 않게)
  const owner = new Map();
  solidP.slice().reverse().forEach((p) => (edgesOfPart.get(p.pi) || []).forEach((s, i) => {
    const key = `${p.pi}:${i}`;
    if (!owner.has(key) && segInRect(s, p.r)) owner.set(key, p);
  }));
  const vis = solidP.map((p) => {
    const segs = (edgesOfPart.get(p.pi) || []).filter((s, i) => owner.get(`${p.pi}:${i}`) === p);
    const fill = p.part.leg ? '#c8c8c8' : '#ffffff';
    return `<rect x="${f1(p.r.x0)}" y="${f1(p.r.y0)}" width="${f1(p.r.x1 - p.r.x0)}" height="${f1(p.r.y1 - p.r.y0)}" fill="${fill}" stroke="none"/>`
      + segs.map((s) => line(s, k.line, ' stroke="#000" stroke-linecap="square"')).join('');
  }).join('');
  // 판 사이 선분 중 가로지른 판 조각이 다른 조각 안쪽에 남긴 것 — 덮인 뒤에도 남는 실선이 없게 (위에서 이미 조각마다 그렸다)
  const hidden = [...edgesOfPart.entries()].filter(([pi]) => !model.parts[pi].front)
    .flatMap(([, segs]) => segs).map((s) => line(s, k.thin, ` stroke="#555" stroke-dasharray="${f1(k.dash)} ${f1(k.dash * 0.7)}"`)).join('');
  const fronts = [...edgesOfPart.entries()].filter(([pi]) => model.parts[pi].front)
    .flatMap(([, segs]) => segs).map((s) => line(s, k.thin * 1.3, ` stroke="#1d4f91" stroke-dasharray="${f1(k.dash * 2.4)} ${f1(k.dash * 0.6)} ${f1(k.dash * 0.4)} ${f1(k.dash * 0.6)}"`)).join('');
  // 철물
  const P = VIEWS[view];
  const hw = [];
  model.rails.forEach((r) => {
    const a = P(r.at[0], r.at[1], r.at[2]), b = P(r.at[0], r.at[1], r.at[2] + r.len);
    if (view === 'front') hw.push(`<rect x="${f1(a[0] - k.text * 0.35)}" y="${f1(a[1] - k.text * 0.35)}" width="${f1(k.text * 0.7)}" height="${f1(k.text * 0.7)}" fill="#1d4f91"/>`);
    else hw.push(line([a[0], a[1], b[0], b[1]], k.line * 2.2, ' stroke="#1d4f91" stroke-opacity="0.85"'));
  });
  if (view === 'front') {
    model.hinges.forEach((h) => {
      const a = P(...h.at);
      hw.push(`<circle cx="${f1(a[0])}" cy="${f1(a[1])}" r="${f1(h.d / 2)}" fill="none" stroke="#1d4f91" stroke-width="${f1(k.thin)}"/>`);
    });
  }
  return { svg: `<g>${vis}${hidden}${fronts}${hw.join('')}</g>`, bounds, rects: pieces };
}

// ── 치수 ─────────────────────────────────────────────────────────

/**
 * 연속 치수 — 한 축(가로 'h' · 세로 'v')의 점들(정렬)을 at 자리 치수선으로. from = 연장선이 시작하는 자리(그림 쪽).
 *   글자가 칸보다 길면 다음 줄로 비켜 적는다 (겹치지 않게).
 */
function chainDim(points, axis, at, from, k, sideSign) {
  const ps = [...new Set(points.map((p) => Math.round(p * 10) / 10))].sort((a, b) => a - b);
  if (ps.length < 2) return '';
  const st = ' stroke="#1d4f91"';
  const out = [];
  const ext = k.text * 0.6 * sideSign;
  ps.forEach((p) => {
    const gap = k.text * 0.4 * sideSign;
    out.push(axis === 'h' ? line([p, from + gap, p, at + ext], k.thin, st) : line([from + gap, p, at + ext, p], k.thin, st));
  });
  out.push(axis === 'h' ? line([ps[0], at, ps[ps.length - 1], at], k.thin, st) : line([at, ps[0], at, ps[ps.length - 1]], k.thin, st));
  let lift = 0;
  for (let i = 0; i + 1 < ps.length; i++) {
    const a = ps[i], b = ps[i + 1], len = b - a;
    const label = num(Math.round(len));
    const tw = String(label).length * k.text * 0.62;
    // 화살표 (칸이 좁으면 바깥으로)
    const ah = Math.min(k.text * 0.9, len / 2.5);
    if (axis === 'h') {
      out.push(arrow(a, at, 1, 0, ah, k), arrow(b, at, -1, 0, ah, k));
    } else {
      out.push(arrow(at, a, 0, 1, ah, k), arrow(at, b, 0, -1, ah, k));
    }
    const fits = tw + k.text * 0.4 < len;
    lift = fits ? 0 : lift === 1 ? 2 : 1;
    const off = (k.text * 0.35 + lift * k.text * 1.15) * sideSign;
    const m = (a + b) / 2;
    if (axis === 'h') {
      const ty = sideSign > 0 ? at + off + k.text * 0.8 : at + off - k.text * 0.25;
      out.push(`<text x="${f1(m)}" y="${f1(ty)}" font-size="${f1(k.text)}" text-anchor="middle" fill="#0b2545">${label}</text>`);
    } else {
      const tx = sideSign > 0 ? at + off + k.text * 0.8 : at + off - k.text * 0.25;
      out.push(`<text x="${f1(tx)}" y="${f1(m)}" font-size="${f1(k.text)}" text-anchor="middle" fill="#0b2545" transform="rotate(-90 ${f1(tx)} ${f1(m)})">${label}</text>`);
    }
  }
  return out.join('');
}

function arrow(x, y, dx, dy, len, k) {
  const w = len * 0.32;
  const bx = x + dx * len, by = y + dy * len;
  const px = -dy * w, py = dx * w;
  return `<path d="M${f1(x)} ${f1(y)} L${f1(bx + px)} ${f1(by + py)} L${f1(bx - px)} ${f1(by - py)} Z" fill="#1d4f91" stroke="none"/>`;
  // k 는 굵기 맞춤 자리 (지금은 채운 삼각형)
}

const uniq = (a) => [...new Set(a.map((v) => Math.round(v * 10) / 10))];

/** 정면도 치수 — 아래 폭, 왼쪽 다리발 + 몸통, 오른쪽 전면 높이 연속, 위 전면 폭 연속 */
function frontDims(model, b, mod, k) {
  const W = Number(mod.box && mod.box.W) || b.x1 - b.x0;
  const H = Number(mod.box && mod.box.H) || -b.y0;
  const out = [];
  const step = k.text * 2.4;
  // 아래 — 몸통 폭 (x −W/2 … W/2)
  out.push(chainDim([-W / 2, W / 2], 'h', b.y1 + step * 1.2, b.y1, k, 1));
  // 왼쪽 — 다리발 · 좌대(있으면) + 몸통 높이, 바깥 줄 전체 (도어가 몸통 밑으로 내려온 것은 오른쪽 전면 줄에)
  const foot = Math.max(0, ...model.parts.filter((p) => !p.front).flatMap((p) => p.solids.map((s) => -s.min[1])));
  const ys = [0, -H].concat(foot > 0.5 ? [foot] : []);
  out.push(chainDim(ys, 'v', b.x0 - step * 1.2, b.x0, k, -1));
  if (foot > 0.5) out.push(chainDim([-H, foot], 'v', b.x0 - step * 2.6, b.x0, k, -1));
  // 오른쪽 — 전면(도어 · 서랍 앞판) 높이 연속
  const fr = model.parts.filter((p) => p.front).flatMap((p) => p.solids.map((s) => rectOf('front', s)));
  if (fr.length) {
    out.push(chainDim(uniq(fr.flatMap((r) => [r.y0, r.y1])), 'v', b.x1 + step * 1.2, b.x1, k, 1));
    const xs = uniq(fr.flatMap((r) => [r.x0, r.x1]));
    if (xs.length > 2) out.push(chainDim(xs, 'h', b.y0 - step * 1.2, b.y0, k, -1));
  }
  return out.join('');
}

/** 측면도 치수 — 아래 몸통 깊이 + 도어 앞, 왼쪽(앞 쪽) 선반 높이 연속, 따내기 */
function sideDims(model, b, mod, k) {
  const D = Number(mod.box && mod.box.D) || b.x1 - b.x0;
  const H = Number(mod.box && mod.box.H) || -b.y0;
  const out = [];
  const step = k.text * 2.4;
  // 아래 — 앞(왼쪽, sx = −z)부터: 도어 앞 · 몸통 앞 · 몸통 뒤
  const zf = Math.max(D / 2, ...model.parts.filter((p) => p.front).flatMap((p) => p.solids.map((s) => s.max[2])));
  const xs = [-zf, -D / 2, D / 2];
  out.push(chainDim(xs, 'h', b.y1 + step * 1.2, b.y1, k, 1));
  // 오른쪽(뒤 쪽) — 선반 윗면 높이 연속 (몸통 바닥 0 · 선반 · 몸통 위)
  const shelves = model.parts.filter((p) => p.shelf).flatMap((p) => p.solids.map((s) => -s.max[1]));
  if (shelves.length) out.push(chainDim([0, -H].concat(shelves), 'v', b.x1 + step * 1.2, b.x1, k, 1));
  // 따내기 — 오른쪽 측판의 따내기 자리 (높이 · 깊이)
  const side = model.parts.filter((p) => p.src && p.src.part === '측판' && p.src.frame && AX[p.src.frame.u] && Array.isArray(p.src.features) && p.src.features.some((f) => f && f.type === 'notch'))
    .sort((a, c) => c.solids[0].max[0] - a.solids[0].max[0])[0];
  if (side) {
    const fr = side.src.frame;
    side.src.features.filter((f) => f && f.type === 'notch').slice(0, 3).forEach((f) => {
      const a = VIEWS.side(...pointOf(fr, Number(f.u0), Number(f.v0), 0));
      const c = VIEWS.side(...pointOf(fr, Number(f.u1), Number(f.v1), 0));
      const nx0 = Math.min(a[0], c[0]), nx1 = Math.max(a[0], c[0]), ny0 = Math.min(a[1], c[1]), ny1 = Math.max(a[1], c[1]);
      // 따낸 자리 안쪽에 작은 치수 (깊이 · 높이)
      out.push(`<rect x="${f1(nx0)}" y="${f1(ny0)}" width="${f1(nx1 - nx0)}" height="${f1(ny1 - ny0)}" fill="none" stroke="#c0392b" stroke-width="${f1(k.thin * 1.4)}"/>`);
      out.push(`<text x="${f1(nx1 + k.text * 0.5)}" y="${f1(ny0 + k.text * 1.0)}" font-size="${f1(k.text * 0.9)}" fill="#c0392b">따내기 ${num(Math.round(nx1 - nx0))}×${num(Math.round(ny1 - ny0))}</text>`);
    });
  }
  return out.join('');
}

/** 평면도 치수 — 오른쪽 깊이 (몸통) */
function topDims(model, b, mod, k) {
  const D = Number(mod.box && mod.box.D) || b.y1 - b.y0;
  return chainDim([-D / 2, D / 2], 'v', b.x1 + k.text * 2.9, b.x1, k, 1);
}

// ── 등각 ─────────────────────────────────────────────────────────

function isoView(model, k) {
  const items = [];
  model.parts.forEach((part, pi) => part.solids.forEach((s) => items.push({ s, part, pi })));
  // 앞뒤: 어느 축으로든 떨어져 있으면 그 축의 큰 쪽이 앞 (등각은 +x · +y · +z 가 보는 사람 쪽)
  const behind = (a, b) => {
    for (let i = 0; i < 3; i++) {
      if (a.s.max[i] <= b.s.min[i] + 1e-6) return true;
      if (b.s.max[i] <= a.s.min[i] + 1e-6) return false;
    }
    return null;
  };
  const bbox = (it) => {
    const pts = cornersOf(it.s).map((p) => isoP(...p));
    return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) };
  };
  const bb = items.map(bbox);
  const n = items.length;
  const before = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const A = bb[i], B = bb[j];
    if (A.x1 <= B.x0 || B.x1 <= A.x0 || A.y1 <= B.y0 || B.y1 <= A.y0) continue;
    const r = behind(items[i], items[j]);
    if (r === true) { before[i].push(j); indeg[j]++; } else if (r === false) { before[j].push(i); indeg[i]++; }
  }
  const order = [];
  const key = (it) => it.s.min[0] + it.s.min[1] + it.s.min[2];
  const ready = [];
  for (let i = 0; i < n; i++) if (!indeg[i]) ready.push(i);
  const done = new Array(n).fill(false);
  while (order.length < n) {
    if (!ready.length) {
      // 고리 — 남은 것 가운데 가장 먼 것부터
      let best = -1;
      for (let i = 0; i < n; i++) if (!done[i] && (best < 0 || key(items[i]) < key(items[best]))) best = i;
      ready.push(best);
      indeg[best] = 0;
    }
    ready.sort((a, b) => key(items[b]) - key(items[a]));
    const i = ready.pop();
    if (done[i]) continue;
    done[i] = true;
    order.push(i);
    before[i].forEach((j) => { if (--indeg[j] === 0 && !done[j]) ready.push(j); });
  }
  // 같은 판 안 이음(따내기로 나눈 상자 사이)은 선을 긋지 않는다 — 면마다 합집합 외곽만
  const faceEdges = new Map();
  model.parts.forEach((part, pi) => {
    for (const [kk, axis, side, a1, a2] of [['top', 1, 'max', 0, 2], ['front', 2, 'max', 0, 1], ['right', 0, 'max', 2, 1]]) {
      const planes = new Map();
      part.solids.forEach((s) => {
        const c = Math.round(s[side][axis] * 10) / 10;
        if (!planes.has(c)) planes.set(c, []);
        planes.get(c).push({ x0: s.min[a1], x1: s.max[a1], y0: s.min[a2], y1: s.max[a2] });
      });
      planes.forEach((rs, c) => {
        unionEdges(rs).forEach((e) => {
          const p = (u, v) => { const q = [0, 0, 0]; q[axis] = c; q[a1] = u; q[a2] = v; return q; };
          const key3 = `${pi}|${kk}|${c}`;
          if (!faceEdges.has(key3)) faceEdges.set(key3, []);
          faceEdges.get(key3).push({ a: p(e[0], e[1]), b: p(e[2], e[3]), used: false });
        });
      });
    }
  });
  const onFace = (e, s, axis, a1, a2) => [e.a, e.b].every((q) => q[a1] >= s.min[a1] - 1e-6 && q[a1] <= s.max[a1] + 1e-6 && q[a2] >= s.min[a2] - 1e-6 && q[a2] <= s.max[a2] + 1e-6);
  const poly = (pts) => pts.map((p) => isoP(...p).map(f1).join(',')).join(' ');
  const FILL = { top: '#f1f1f1', front: '#ffffff', right: '#dcdcdc' };
  // 면 외곽 선분은 그 면을 가진 상자 가운데 가장 나중(가까이) 그리는 것과 같이
  const drawn = order.filter((i) => !items[i].part.front);
  const FACE = [['top', 1, 0, 2], ['front', 2, 0, 1], ['right', 0, 2, 1]];
  drawn.slice().reverse().forEach((i) => {
    const { s, pi } = items[i];
    FACE.forEach(([kk, axis, a1, a2]) => {
      const c = Math.round(s.max[axis] * 10) / 10;
      (faceEdges.get(`${pi}|${kk}|${c}`) || []).forEach((e) => { if (e.owner === undefined && onFace(e, s, axis, a1, a2)) e.owner = i; });
    });
  });
  const body = drawn.map((i) => {
    const { s, part, pi } = items[i];
    const [x0, y0, z0] = s.min, [x1, y1, z1] = s.max;
    const faces = [
      ['top', 1, 0, 2, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]],
      ['front', 2, 0, 1, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      ['right', 0, 2, 1, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]],
    ];
    return faces.map(([kk, axis, a1, a2, pts]) => {
      const c = Math.round(s.max[axis] * 10) / 10;
      const list = faceEdges.get(`${pi}|${kk}|${c}`) || [];
      const segs = list.filter((e) => e.owner === i);
      return `<polygon points="${poly(pts)}" fill="${part.leg ? '#bdbdbd' : FILL[kk]}" stroke="none"/>`
        + segs.map((e) => { const A = isoP(...e.a), B = isoP(...e.b); return line([A[0], A[1], B[0], B[1]], k.line, ' stroke="#000" stroke-linecap="round"'); }).join('');
    }).join('');
  }).join('');
  const fronts = items.filter((it) => it.part.front).map((it) => {
    const [x0, y0, z0] = it.s.min, [x1, y1, z1] = it.s.max;
    return [[[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]]
      .map((pts) => `<polygon points="${poly(pts)}" fill="#1d4f91" fill-opacity="0.04" stroke="#1d4f91" stroke-width="${f1(k.thin * 1.3)}" stroke-dasharray="${f1(k.dash * 2.4)} ${f1(k.dash * 0.6)} ${f1(k.dash * 0.4)} ${f1(k.dash * 0.6)}"/>`).join('');
  }).join('');
  const pts = items.flatMap((it) => cornersOf(it.s).map((p) => isoP(...p)));
  const bounds = { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) };
  return { svg: `<g>${body}${fronts}</g>`, bounds };
}

function cornersOf(s) {
  const out = [];
  for (const x of [s.min[0], s.max[0]]) for (const y of [s.min[1], s.max[1]]) for (const z of [s.min[2], s.max[2]]) out.push([x, y, z]);
  return out;
}

// ── 한 장 ─────────────────────────────────────────────────────────

/**
 * 모듈 제작도 한 장 — 3면도 + 등각, 축척 1:S (종이 mm). 그릴 판이 없으면 ''.
 * @param {object} mod 조립 명세 모듈
 * @returns {string} svg
 */
export function moduleCadSvg(mod) {
  const model = cadModelOf(mod);
  if (!model.parts.length) return '';
  for (const S of CAD.SCALES) {
    const out = layout(model, mod, S);
    if (out.wMm <= CAD.PAGE_W_MM && out.hMm <= CAD.PAGE_H_MM) return out.svg;
    if (S === CAD.SCALES[CAD.SCALES.length - 1]) return out.svg;
  }
  return '';
}

function layout(model, mod, S) {
  const k = { text: CAD.TEXT_MM * S, title: CAD.TITLE_MM * S, line: CAD.LINE_MM * S, thin: CAD.THIN_MM * S, dash: 1.4 * S, gap: CAD.GAP_MM * S };
  const F = orthoView(model, 'front', k);
  const Sd = orthoView(model, 'side', k);
  const T = orthoView(model, 'top', k);
  const I = isoView(model, k);
  const m = k.text * 6;   // 치수 자리
  // 정면도 원점 (0,0) — 평면도는 위, 측면도는 오른쪽 (3각법). x 는 정면도 · 평면도가 같고, y 는 정면도 · 측면도가 같다
  const sideDx = F.bounds.x1 + m + k.gap - Sd.bounds.x0;
  const topDy = F.bounds.y0 - m - k.gap - T.bounds.y1;
  const isoW = I.bounds.x1 - I.bounds.x0, isoH = I.bounds.y1 - I.bounds.y0;
  const isoDx = sideDx + Sd.bounds.x0 - I.bounds.x0;
  const isoDy = topDy + T.bounds.y1 - I.bounds.y1;
  const title = (x, y, text) => `<text x="${f1(x)}" y="${f1(y)}" font-size="${f1(k.title)}" font-weight="700" fill="#000">${esc(text)}</text>`;
  const g = (dx, dy, inner) => `<g transform="translate(${f1(dx)} ${f1(dy)})">${inner}</g>`;
  const parts = [
    g(0, 0, F.svg + frontDims(model, F.bounds, mod, k) + title(F.bounds.x0, F.bounds.y1 + m + k.title * 0.6, '정면도')),
    g(sideDx, 0, Sd.svg + sideDims(model, Sd.bounds, mod, k) + title(Sd.bounds.x0, Sd.bounds.y1 + m + k.title * 0.6, '우측면도')),
    g(0, topDy, T.svg + topDims(model, T.bounds, mod, k) + title(T.bounds.x0, T.bounds.y0 - k.title * 0.8, '평면도')),
    g(isoDx, isoDy, I.svg + title(I.bounds.x0, I.bounds.y0 - k.title * 0.8, '등각')),
  ];
  const x0 = Math.min(F.bounds.x0, T.bounds.x0) - m - k.text * 2;
  const x1 = Math.max(sideDx + Sd.bounds.x1, isoDx + I.bounds.x0 + isoW) + m;
  const y0 = Math.min(topDy + T.bounds.y0, isoDy + I.bounds.y0) - k.title * 2.4;
  const y1 = Math.max(F.bounds.y1, Sd.bounds.y1) + m + k.title * 2.2;
  const legend = `축척 1:${S} · mm · 실선 = 보이는 선 · 점선 = 숨은 선 · 일점쇄선 = 도어 · 서랍 앞판 · 파란 선 = 레일 · 원 = 경첩 컵`;
  const xr = Math.max(x1, x0 + legend.length * k.text * 0.62);
  const note = `<text x="${f1(x0)}" y="${f1(y1 - k.text * 0.5)}" font-size="${f1(k.text)}" fill="#333">${esc(legend)}</text>`;
  const vw = xr - x0, vh = y1 - y0;
  void isoH;
  const svg = `<svg class="mod-cad" viewBox="${f1(x0)} ${f1(y0)} ${f1(vw)} ${f1(vh)}" width="${f1(vw / S)}mm" height="${f1(vh / S)}mm" xmlns="http://www.w3.org/2000/svg" font-family="'Malgun Gothic', 'Pretendard', sans-serif">${parts.join('')}${note}</svg>`;
  return { svg, wMm: vw / S, hMm: vh / S };
}
