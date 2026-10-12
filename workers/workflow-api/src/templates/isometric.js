/**
 * 코너 품목의 아이소메트릭 그림 — 사장님 결정 Q4 (2026-10-13, 계획 work-order-stage.plan.md §7).
 *
 * ㄱ자·ㄷ자처럼 벽이 둘 이상인 품목은 정면도 한 장으로 그릴 수 없다. 플래너 브리지가 모듈마다 싣는
 * `_place`(ui-step1.js _plannerPlaceOf) 로 평면 자리를 되살려 30° 아이소메트릭으로 그린다.
 *   _place = { cx, cy, w(진행 방향 폭), d(깊이), run:[x,y], front:[x,y], z0(바닥에서), h(전체 높이), ceil }
 *   회전 규약은 플래너 3D 와 같다: 0° 진행 +x · 앞 +y, 90° 진행 +y · 앞 −x, 180° 진행 −x · 앞 −y, 270° 진행 −y · 앞 +x.
 *
 * 보는 방향: 평면을 90° 단위로 돌려 **앞면이 가장 많이 보이는** 방향을 고른다 (보이는 면 = +x · +y).
 * 일자 품목(앞면 방향이 하나)은 여기서 그리지 않는다 — 치수 정면도(elevation.js)가 더 잘 읽힌다.
 */

import { esc, num } from './html.js';

const C30 = Math.cos(Math.PI / 6);
const DIM = '#1d4f91';
const S30 = 0.5;

function n(v) {
  const x = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(x) ? x : null;
}

function placeOf(m) {
  const p = m && m._place;
  if (!p || typeof p !== 'object') return null;
  const ok = ['cx', 'cy', 'w', 'd', 'h'].every((k) => n(p[k]) !== null) && Array.isArray(p.run) && Array.isArray(p.front);
  return ok && n(p.w) > 0 && n(p.d) > 0 && n(p.h) > 0 ? p : null;
}

const dirKey = (v) => `${Math.sign(n(v[0]) || 0)},${Math.sign(n(v[1]) || 0)}`;

/** 모든 모듈에 자리가 있고 앞면 방향이 둘 이상이면 코너 품목 — 아이소메트릭으로 그린다. */
export function isCornerItem(item) {
  const modules = Array.isArray(item && item.modules) ? item.modules : [];
  if (modules.length < 2 || !modules.every((m) => placeOf(m))) return false;
  return new Set(modules.map((m) => dirKey(m._place.front))).size > 1;
}

/** 평면 벡터를 k×90° (반시계) 돌린다. */
function rot(v, k) {
  let [x, y] = v;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) [x, y] = [-y, x];
  return [x === 0 ? 0 : x, y === 0 ? 0 : y]; // -0 정리
}

/** 앞면이 가장 많이 +x · +y 를 보게 하는 회전 (같으면 적게 돌린 것). */
export function bestTurn(fronts) {
  let best = 0;
  let bestScore = -1;
  for (let k = 0; k < 4; k++) {
    const score = fronts.reduce((s, f) => {
      const [x, y] = rot(f, k);
      return s + (x > 0 || y > 0 ? 1 : 0);
    }, 0);
    if (score > bestScore) { best = k; bestScore = score; }
  }
  return best;
}

/**
 * 품목 → 아이소메트릭 모델 (순수, 시험용으로 노출).
 * boxes: [{ no, m, x0, x1, y0, y1, z0, z1, run, front }] — 돌린 평면 좌표(mm)
 */
export function isoModel(item) {
  const modules = Array.isArray(item && item.modules) ? item.modules : [];
  const placed = modules.map((m, i) => ({ m, no: i + 1, p: placeOf(m) })).filter((e) => e.p);
  const turn = bestTurn(placed.map((e) => e.p.front));
  const boxes = placed.map(({ m, no, p }) => {
    const [cx, cy] = rot([n(p.cx), n(p.cy)], turn);
    const run = rot(p.run, turn);
    const front = rot(p.front, turn);
    const alongX = run[0] !== 0;
    const hx = (alongX ? n(p.w) : n(p.d)) / 2;
    const hy = (alongX ? n(p.d) : n(p.w)) / 2;
    const z0 = n(p.z0) || 0;
    return { no, m, alongX, x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy, z0, z1: z0 + n(p.h), run, front, w: n(p.w) };
  });
  const ceil = Math.max(0, ...placed.map((e) => n(e.p.ceil) || 0), ...boxes.map((b) => b.z1));
  return { turn, boxes, ceil };
}

/**
 * 보이는 앞면(+x 또는 +y)에서 다른 상자에 막히지 않은 가장 긴 구간의 가운데 (진행 축 좌표).
 * ㄱ자 코너 멍장은 앞면 절반이 옆벽 모듈 뒤에 숨는다 — 가운데에 번호를 달면 옆 모듈 번호와 겹친다.
 * 다 막혔으면 null (윗면에 단다). (순수, 시험용으로 노출)
 */
export function visibleFrontMid(b, boxes) {
  const alongX = b.front[1] > 0; // 앞이 +y 면 진행 축은 x
  const [s0, s1] = alongX ? [b.x0, b.x1] : [b.y0, b.y1];
  const line = alongX ? b.y1 : b.x1;
  const blocks = boxes
    .filter((o) => o !== b && o.z0 < b.z1 && b.z0 < o.z1)
    .filter((o) => (alongX ? o.y0 <= line + 1 && o.y1 > line + 1 : o.x0 <= line + 1 && o.x1 > line + 1))
    .map((o) => (alongX ? [o.x0, o.x1] : [o.y0, o.y1]))
    .sort((a, c) => a[0] - c[0]);
  let best = null;
  let cur = s0;
  const consider = (a, c) => {
    if (c - a > 1 && (!best || c - a > best[1] - best[0])) best = [a, c];
  };
  for (const [a, c] of blocks) {
    if (c <= cur || a >= s1) continue;
    consider(cur, Math.min(a, s1));
    cur = Math.max(cur, c);
  }
  consider(cur, s1);
  return best ? (best[0] + best[1]) / 2 : null;
}

/** 같은 벽 줄 — 진행 축·앞면 방향·앞선 좌표가 같은 바닥 모듈들. */
function floorRuns(boxes) {
  const runs = new Map();
  for (const b of boxes) {
    if (b.m && b.m.pos === 'upper') continue;
    const alongX = b.run[0] !== 0;
    const frontLine = alongX ? (b.front[1] > 0 ? b.y1 : b.y0) : (b.front[0] > 0 ? b.x1 : b.x0);
    const key = `${alongX ? 'x' : 'y'}|${dirKey(b.front)}|${Math.round(frontLine / 50)}`;
    if (!runs.has(key)) runs.set(key, { alongX, front: b.front, frontLine, boxes: [] });
    runs.get(key).boxes.push(b);
  }
  return [...runs.values()];
}

/**
 * 바닥 줄마다 길이 (첫 모듈 시작 ~ 마지막 모듈 끝, 틈 포함) — 그림 아래 글로 적는다 (순수, 시험용).
 * 줄 순서: 모듈 번호가 작은 줄부터.
 */
export function runLengths(item) {
  if (!isCornerItem(item)) return [];
  const { boxes } = isoModel(item);
  return floorRuns(boxes)
    .map((run) => {
      const span = run.boxes.map((b) => (run.alongX ? [b.x0, b.x1] : [b.y0, b.y1]));
      const first = Math.min(...run.boxes.map((b) => b.no));
      return {
        first,
        length: Math.round(Math.max(...span.map((x) => x[1])) - Math.min(...span.map((x) => x[0]))),
        nos: run.boxes.map((b) => b.no).sort((a, b) => a - b),
      };
    })
    .sort((a, b) => a.first - b.first);
}

export function isoSvg(item) {
  if (!isCornerItem(item)) return '';
  const { boxes, ceil } = isoModel(item);
  if (!boxes.length) return '';

  const P = (x, y, z) => [(x - y) * C30, (x + y) * S30 - z];
  const xs = [];
  const ys = [];
  const track = ([sx, sy]) => { xs.push(sx); ys.push(sy); };
  for (const b of boxes) {
    for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) track(P(x, y, z));
  }
  const spanX = Math.max(...xs) - Math.min(...xs);
  const fs = Math.min(120, Math.max(55, spanX / 34));
  const off = fs * 5; // 그림 틀 여백 · 전체 높이 선이 앞으로 나가는 거리 (mm)
  // 치수 사슬 자리까지 포함해 틀을 잡는다
  for (const b of boxes) {
    for (const x of [b.x0 - off, b.x1 + off]) for (const y of [b.y0 - off, b.y1 + off]) track(P(x, y, 0));
  }
  const minX = Math.min(...xs) - fs * 2;
  const minY = Math.min(...ys) - fs * 2.5;
  const vbW = Math.max(...xs) - minX + fs * 2;
  const vbH = Math.max(...ys) - minY + fs * 2;
  const Q = (x, y, z) => {
    const [sx, sy] = P(x, y, z);
    return [Math.round((sx - minX) * 10) / 10, Math.round((sy - minY) * 10) / 10];
  };
  const pts = (arr) => arr.map((p) => p.join(',')).join(' ');
  const sw = Math.max(2, fs * 0.05);
  const parts = [];
  const labels = []; // 번호는 맨 위층에 — 코너 멍장처럼 앞이 반쯤 가려진 모듈도 번호는 보이게

  // 앞에서 먼(x+y 가 작은) 것부터, 같은 자리면 아래부터 — 화가 순서
  const order = boxes.slice().sort((a, b) => (a.x0 + a.y0) - (b.x0 + b.y0) || a.z0 - b.z0);
  for (const b of order) {
    const top = [Q(b.x0, b.y0, b.z1), Q(b.x1, b.y0, b.z1), Q(b.x1, b.y1, b.z1), Q(b.x0, b.y1, b.z1)];
    const faceX = [Q(b.x1, b.y0, b.z0), Q(b.x1, b.y1, b.z0), Q(b.x1, b.y1, b.z1), Q(b.x1, b.y0, b.z1)];
    const faceY = [Q(b.x0, b.y1, b.z0), Q(b.x1, b.y1, b.z0), Q(b.x1, b.y1, b.z1), Q(b.x0, b.y1, b.z1)];
    const frontIsX = b.front[0] > 0;
    const frontIsY = b.front[1] > 0;
    parts.push(`<polygon points="${pts(faceX)}" fill="${frontIsX ? '#fff' : '#d9d9d9'}" stroke="#000" stroke-width="${sw}"/>`);
    parts.push(`<polygon points="${pts(faceY)}" fill="${frontIsY ? '#fff' : '#d9d9d9'}" stroke="#000" stroke-width="${sw}"/>`);
    parts.push(`<polygon points="${pts(top)}" fill="#eee" stroke="#000" stroke-width="${sw}"/>`);

    // 폭 — 윗면 앞 모서리 조금 안쪽에 짧은 치수선 + 값. 상자와 같은 순서로 그려 앞 상자에 가리면 같이 가린다
    {
      const inset = Math.min((b.alongX ? b.y1 - b.y0 : b.x1 - b.x0) * 0.2, 120);
      const pad = b.w * 0.06;
      const [e1, e2] = b.alongX
        ? (() => { const o = b.front[1] > 0 ? b.y1 - inset : b.y0 + inset; return [Q(b.x0 + pad, o, b.z1), Q(b.x1 - pad, o, b.z1)]; })()
        : (() => { const o = b.front[0] > 0 ? b.x1 - inset : b.x0 + inset; return [Q(o, b.y0 + pad, b.z1), Q(o, b.y1 - pad, b.z1)]; })();
      parts.push(`<line x1="${e1[0]}" y1="${e1[1]}" x2="${e2[0]}" y2="${e2[1]}" stroke="${DIM}" stroke-width="${fs * 0.06}"/>`);
      parts.push(`<circle cx="${e1[0]}" cy="${e1[1]}" r="${fs * 0.1}" fill="${DIM}"/><circle cx="${e2[0]}" cy="${e2[1]}" r="${fs * 0.1}" fill="${DIM}"/>`);
      parts.push(`<text x="${(e1[0] + e2[0]) / 2}" y="${(e1[1] + e2[1]) / 2 - fs * 0.25}" font-size="${fs * 0.85}" text-anchor="middle" fill="${DIM}">${num(b.w)}</text>`);
    }

    // 2도어는 앞면 가운데에 세로선
    const m = b.m || {};
    if (!m.isOpen && Number(m.doorCount) === 2 && (frontIsX || frontIsY)) {
      const [a1, a2] = frontIsX
        ? [Q(b.x1, (b.y0 + b.y1) / 2, b.z0), Q(b.x1, (b.y0 + b.y1) / 2, b.z1)]
        : [Q((b.x0 + b.x1) / 2, b.y1, b.z0), Q((b.x0 + b.x1) / 2, b.y1, b.z1)];
      parts.push(`<line x1="${a1[0]}" y1="${a1[1]}" x2="${a2[0]}" y2="${a2[1]}" stroke="#000" stroke-width="${sw * 0.8}"/>`);
    }

    // 번호 — 보이는 앞면 가운데, 앞면이 안 보이면 윗면 가운데
    const zc = (b.z0 + b.z1) / 2;
    const t = frontIsX || frontIsY ? visibleFrontMid(b, boxes) : null;
    const [lx, ly] = t === null ? Q((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1)
      : frontIsX ? Q(b.x1, t, zc) : Q(t, b.y1, zc);
    const r = fs * 0.75;
    labels.push(`<circle cx="${lx}" cy="${ly}" r="${r}" fill="#fff" stroke="#000" stroke-width="${sw}"/>`);
    labels.push(`<text x="${lx}" y="${ly + fs * 0.36}" font-size="${fs}" font-weight="700" text-anchor="middle">${num(b.no)}</text>`);
  }

  // 전체 높이 — 가장 앞(화면 아래) 모서리에
  const front = boxes.slice().sort((a, b) => (b.x1 + b.y1) - (a.x1 + a.y1))[0];
  const hx = front.x1 + off * 0.5;
  const hy = front.y1 + off * 0.5;
  const [hx1, hy1] = Q(hx, hy, 0);
  const [, hy2] = Q(hx, hy, ceil);
  parts.push(`<line x1="${hx1}" y1="${hy1}" x2="${hx1}" y2="${hy2}" stroke="${DIM}" stroke-width="${fs * 0.06}"/>`);
  parts.push(`<text x="${hx1 + fs * 0.4}" y="${(hy1 + hy2) / 2}" font-size="${fs}" fill="${DIM}">H ${num(ceil)}</text>`);
  parts.push(...labels);

  return (
    `<svg class="elevation iso" viewBox="0 0 ${Math.round(vbW)} ${Math.round(vbH)}" xmlns="http://www.w3.org/2000/svg" font-family="'Malgun Gothic', sans-serif">` +
    parts.join('') +
    '</svg>'
  );
}
